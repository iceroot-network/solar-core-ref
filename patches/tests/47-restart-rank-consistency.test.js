#!/usr/bin/env node
// Patch 47 restart-rank-consistency.
//
// A running node ranks delegates only at round starts (DposState.buildDelegateRanking, called by
// RoundState.applyRound). A state rebuilt at start by the StateBuilder ranks every non-resigned
// delegate at once, and RoundState.restore() (calcPreviousActiveDelegates) then puts back the round-start
// rank only of the delegates that were ranked at the round start. A delegate that revoked its
// resignation inside the round of a restart therefore kept its fresh rank, next to the delegate that
// holds that rank on the live node (in the scenario below, genesis_53 and tx1n2290 both at rank 53).
// The live node is the canonical behaviour: calcPreviousActiveDelegates now also removes the rank of
// every delegate that was not ranked at the round start.
//
// The scenario runs with the real Wallet, DposState and RoundState classes and stub
// repositories: 53 genesis delegates and tx1n2290; genesis_53 resigns at 69 and revokes at 176;
// genesis_10 resigns at 170; newcomer registers at 180 with the largest vote balance; restart at 190.
//
// Usage: SOLAR_DIR=<built Solar checkout> node 47-restart-rank-consistency.test.js
"use strict";

const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));

const load = (pkg, sub = "") => require(path.join(SOLAR_DIR, "packages", pkg, "dist", sub));
const { Identities, Managers, Utils } = load("crypto");
const { Services, Utils: AppUtils } = load("kernel");
const { Wallets } = load("state");
const { DposState } = load("state", "dpos/dpos");
const { RoundState } = load("state", "round-state");
const { BigNumber } = Utils;

let passed = 0;
let failed = 0;

async function check(name, fn) {
    try {
        const outcome = await fn();
        if (outcome === true) {
            passed++;
            console.log(`PASS ${name}`);
        } else {
            failed++;
            console.log(`FAIL ${name}: ${outcome}`);
        }
    } catch (error) {
        failed++;
        console.log(`FAIL ${name}: threw ${error && error.stack}`);
    }
}

// Network configuration template (see patches/README.md).
function makeConfig() {
    return {
        network: {
            name: "devnet",
            messagePrefix: "Solar devnet message:\n",
            addressCharacter: "d",
            bip32: { public: 70617039, private: 70615956 },
            pubKeyHash: 90,
            nethash: "c9b03ab996ef3ac216a2ac53eaee71118cbf7995fa44449a7fb7f94bbe18bcca",
            wif: 252,
            slip44: 1,
            client: { token: "dROOT", symbol: "dRT", explorer: "" },
        },
        milestones: [
            {
                height: 1,
                activeDelegates: 53,
                block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
                blocksToRevokeDelegateResignation: 106,
                blockTime: 8,
                burn: { feeBasisPoints: 9000, txAmount: 2000000 },
                epoch: "2026-01-01T00:00:00.000Z",
                legacyTransfer: false,
                legacyVote: false,
                transfer: { maximum: 256, minimum: 1 },
                reward: 0,
                acceptLegacySchnorrTransactions: false,
                bip340: true,
                donations: {},
            },
        ],
        genesisBlock: { transactions: [] },
        exceptions: {},
    };
}

// Real wallets, with the attributes the delegate handlers register.
const attributeSet = new Services.Attributes.AttributeSet();
for (const key of [
    "votes",
    "delegate",
    "delegate.username",
    "delegate.voteBalance",
    "delegate.rank",
    "delegate.round",
    "delegate.resigned",
]) {
    attributeSet.set(key);
}

// Delegates: genesis_1 .. genesis_53 with falling vote balances, then tx1n2290 below all of them; newcomer
// (registered inside the round) has the largest balance.
const DELEGATES = [];
for (let i = 1; i <= 53; i++) {
    DELEGATES.push({ username: `genesis_${i}`, votes: BigNumber.make(1000 - i).times(1e8) });
}
DELEGATES.push({ username: "tx1n2290", votes: BigNumber.make(900).times(1e8) });
const NEWCOMER = { username: "newcomer", votes: BigNumber.make(5000).times(1e8) };

function makeWallet({ username, votes }, { rankKey }) {
    const publicKey = Identities.PublicKey.fromPassphrase(`patch 47 ${username}`);
    const wallet = new Wallets.Wallet(
        Identities.Address.fromPublicKey(publicKey, 90),
        new Services.Attributes.AttributeMap(attributeSet),
        false,
    );
    wallet.setPublicKey(publicKey);
    // DelegateRegistration: bootstrap() writes rank: undefined, applyToSender() writes no rank key.
    const delegate = { username, voteBalance: votes };
    if (rankKey) {
        delegate.rank = undefined;
    }
    wallet.setAttribute("delegate", delegate);
    return wallet;
}

class StubWalletRepository {
    constructor(wallets) {
        this.wallets = wallets;
    }
    allByUsername() {
        return this.wallets.filter((wallet) => wallet.hasAttribute("delegate.username"));
    }
    findByUsername(username) {
        const wallet = this.wallets.find((w) => w.getAttribute("delegate.username") === username);
        if (!wallet) {
            throw new Error(`no delegate ${username}`);
        }
        return wallet;
    }
}

const silentLogger = { debug() {}, info() {}, notice() {}, warning() {}, error() {} };

function makeDposState(repository) {
    const dpos = Object.create(DposState.prototype);
    dpos.logger = silentLogger;
    dpos.walletRepository = repository;
    dpos.activeDelegates = [];
    dpos.roundDelegates = [];
    dpos.roundInfo = null;
    return dpos;
}

const byUsername = (repository, username) => repository.findByUsername(username);
const resign = (repository, username) => byUsername(repository, username).setAttribute("delegate.resigned", 1);
const revoke = (repository, username) => byUsername(repository, username).forgetAttribute("delegate.resigned");

// The ranks the API shows: username -> rank (absent when the wallet has no rank).
function ranks(repository) {
    const result = {};
    for (const wallet of repository.allByUsername()) {
        const rank = wallet.hasAttribute("delegate.rank") ? wallet.getAttribute("delegate.rank") : undefined;
        if (rank !== undefined) {
            result[wallet.getAttribute("delegate.username")] = rank;
        }
    }
    return result;
}

// The state of the chain at round 4's start (after block 159): every delegate registered by then,
// genesis_53 resigned (at 69).
function roundStartWallets(rankKey) {
    const repository = new StubWalletRepository(DELEGATES.map((d) => makeWallet(d, { rankKey })));
    resign(repository, "genesis_53");
    return repository;
}

// Round 4's events up to the restart height: genesis_10 resigns (170), genesis_53 revokes (176),
// newcomer registers (180).
function applyRoundEvents(repository, { rankKey }) {
    resign(repository, "genesis_10");
    revoke(repository, "genesis_53");
    repository.wallets.push(makeWallet(NEWCOMER, { rankKey }));
}

// A RoundState with stubs; its previous-round state is round 4's start, ranked as DposPreviousRoundState
// does it (revert the round's blocks in a clone, build the ranking, set the round).
function makeRoundState(repository, lastHeight) {
    const roundState = Object.create(RoundState.prototype);
    roundState.app = { version: () => "4.3.1" };
    roundState.logger = silentLogger;
    roundState.events = { dispatch() {} };
    roundState.walletRepository = repository;
    roundState.dposState = makeDposState(repository);
    roundState.stateStore = { getLastBlock: () => ({ data: { height: lastHeight } }) };
    roundState.databaseService = { deleteRound: async () => {}, saveRound: async () => {} };
    roundState.triggers = { call: async () => [] };
    roundState.blocksInCurrentRound = [];
    roundState.forgingDelegates = [];
    roundState.getBlocksForRound = async () => [];
    roundState.getDposPreviousRoundState = async (_blocks, roundInfo) => {
        const previous = roundStartWallets(false);
        const dpos = makeDposState(previous);
        dpos.buildDelegateRanking();
        dpos.setDelegatesRound(roundInfo);
        return {
            getAllDelegates: () => dpos.getAllDelegates(),
            getActiveDelegates: () => dpos.getActiveDelegates(),
            getRoundDelegates: () => dpos.getRoundDelegates(),
        };
    };
    return roundState;
}

// LIVE: the running node. It ranked at the round 3 and round 4 starts (107, 160), then applied round 4's
// events without ranking.
function liveNode() {
    const repository = roundStartWallets(false);
    const dpos = makeDposState(repository);
    dpos.buildDelegateRanking(); // round 3 start (107)
    dpos.buildDelegateRanking(); // round 4 start (160)
    applyRoundEvents(repository, { rankKey: false });
    return repository;
}

// C: a restart at 190 without a saved state. The StateBuilder bootstraps the delegates from the chain
// (rank: undefined), ranks them (StateBuilder's final step), then Initialise restores the current round.
async function rebuiltNode() {
    const repository = roundStartWallets(true);
    applyRoundEvents(repository, { rankKey: true });
    makeDposState(repository).buildDelegateRanking();
    await makeRoundState(repository, 190).restore();
    return repository;
}

// B: a restart at 190 from the saved state, which holds the live attributes.
async function savedStateNode() {
    const repository = liveNode();
    await makeRoundState(repository, 190).restore();
    return repository;
}

function duplicates(rankMap) {
    const holders = {};
    for (const [username, rank] of Object.entries(rankMap)) {
        (holders[rank] = holders[rank] || []).push(username);
    }
    return Object.entries(holders)
        .filter(([, names]) => names.length > 1)
        .map(([rank, names]) => `rank ${rank}: ${names.join(", ")}`);
}

function diff(expected, actual) {
    const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const lines = [];
    for (const name of [...names].sort()) {
        if (expected[name] !== actual[name]) {
            lines.push(`${name} live ${expected[name]} rebuilt ${actual[name]}`);
        }
    }
    return lines;
}

async function main() {
    console.log(`SOLAR_DIR=${SOLAR_DIR}`);
    Managers.configManager.setConfig(makeConfig());
    const round4 = AppUtils.roundCalculator.calculateRound(190);
    console.log(`restart at 190: round ${round4.round}, round height ${round4.roundHeight}`);

    const live = ranks(liveNode());
    await check("live node at 190: genesis_53 has no rank, tx1n2290 is 53, genesis_10 keeps 10, newcomer has none", () =>
        live.genesis_53 === undefined &&
        live.tx1n2290 === 53 &&
        live.genesis_10 === 10 &&
        live.newcomer === undefined
            ? true
            : `genesis_53 ${live.genesis_53}, tx1n2290 ${live.tx1n2290}, genesis_10 ${live.genesis_10}, newcomer ${live.newcomer}`,
    );

    const rebuilt = ranks(await rebuiltNode());
    await check("StateBuilder restart at 190: every rank equals the live node's (base: genesis_53 and newcomer ranked)", () => {
        const lines = diff(live, rebuilt);
        return lines.length === 0 ? true : lines.join("; ");
    });
    await check("StateBuilder restart at 190: no two delegates share a rank (base: rank 53 twice)", () => {
        const lines = duplicates(rebuilt);
        return lines.length === 0 ? true : lines.join("; ");
    });
    await check("StateBuilder restart at 190: genesis_10, resigned inside the round, keeps its round-start rank 10 (unchanged)", () =>
        rebuilt.genesis_10 === 10 ? true : `genesis_10 ${rebuilt.genesis_10}`,
    );

    const saved = ranks(await savedStateNode());
    await check("saved-state restart at 190: every rank equals the live node's (unchanged)", () => {
        const lines = diff(live, saved);
        return lines.length === 0 ? true : lines.join("; ");
    });

    // The next round start ranks everyone again, on every path.
    await check("round 5 start (213): the rebuilt node ranks like the live node", async () => {
        const liveRepository = liveNode();
        makeDposState(liveRepository).buildDelegateRanking();
        const rebuiltRepository = await rebuiltNode();
        makeDposState(rebuiltRepository).buildDelegateRanking();
        const lines = diff(ranks(liveRepository), ranks(rebuiltRepository));
        return lines.length === 0 ? true : lines.join("; ");
    });

    // The same function serves a revert across a round boundary: the live node applies 212, starts
    // round 5 (213) and ranks everyone, then reverts 212 back into round 4.
    await check("revert of 212 into round 4: the ranks are round 4's again (base: genesis_53 and newcomer keep round 5 ranks)", async () => {
        const repository = liveNode();
        makeDposState(repository).buildDelegateRanking(); // round 5 start
        const roundState = makeRoundState(repository, 212);
        await roundState.revertRound(212);
        const lines = diff(live, ranks(repository));
        const doubled = duplicates(ranks(repository));
        return lines.length === 0 && doubled.length === 0 ? true : [...lines, ...doubled].join("; ");
    });

    console.log(`47-restart-rank-consistency: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.log(`FAIL test harness: ${error && error.stack}`);
    process.exit(1);
});
