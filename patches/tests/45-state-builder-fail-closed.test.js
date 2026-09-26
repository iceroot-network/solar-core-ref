#!/usr/bin/env node
// Patch 45 state-builder-fail-closed.
//
// StateBuilder.run() no longer swallows its errors. When the state cannot be built or is
// inconsistent, such as a wallet with a negative balance (the genesis sender included), it
// terminates the application ("State Generation failed: Wallet with negative balance") and exits the
// process with code 1. In s1-ref-v1 run() only logged the error, and the node started on the
// inconsistent state. The exit is in a finally around the terminate, so a terminate that throws (a
// service provider whose dispose fails) still exits. process.exit is stubbed here: the stub records
// the code and throws, so the test process survives.
//
// Usage: SOLAR_DIR=<built Solar checkout> node 45-state-builder-fail-closed.test.js
"use strict";

const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));

const load = (pkg, sub = "") => require(path.join(SOLAR_DIR, "packages", pkg, "dist", sub));
const { Identities, Managers, Utils } = load("crypto");
const { Container, Enums } = load("kernel");
const { StateBuilder } = load("state");
const { Initialise } = load("blockchain", "state-machine/actions/initialise");
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
        console.log(`FAIL ${name}: threw ${error && error.message}`);
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

// The genesis generator key of a generated IceRoot devnet and a genesis wallet.
const GENERATOR_ADDRESS = Identities.Address.fromPublicKey(
    "0334f21b095dbab8c1c602ff0df73371605dd9b79193eb55c89b50d86be0defdea",
);
const GENESIS_WALLET = "dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn";

class StubWallet {
    constructor(address, balance, attributes = {}) {
        this.address = address;
        this.balance = BigNumber.make(balance);
        this.attributes = new Map(Object.entries(attributes));
    }
    getAddress() {
        return this.address;
    }
    getBalance() {
        return this.balance;
    }
    getNonce() {
        return BigNumber.ONE;
    }
    hasAttribute(key) {
        return this.attributes.has(key);
    }
    getAttribute(key, defaultValue) {
        return this.attributes.has(key) ? this.attributes.get(key) : defaultValue;
    }
}

function makeLogger() {
    const lines = [];
    const record = (level) => (message) => lines.push(`${level}: ${message}`);
    return {
        lines,
        debug: record("debug"),
        info: record("info"),
        notice: record("notice"),
        warning: record("warning"),
        error: record("error"),
    };
}

// process.exit, stubbed: it records the code and throws, as the real one never returns.
const exits = [];
class ProcessExit extends Error {
    constructor(code) {
        super(`process.exit(${code})`);
        this.code = code;
    }
}
const realExit = process.exit;
function stubExit() {
    exits.length = 0;
    process.exit = (code) => {
        exits.push(code);
        throw new ProcessExit(code);
    };
}
function restoreExit() {
    process.exit = realExit;
}

// A StateBuilder with stub collaborators: no handlers, no blocks, no sent transactions, and the given
// wallets as the final state. With terminateThrows, terminate() records the call and then throws, as it
// does when a service provider's dispose fails.
function makeStateBuilder(wallets, { terminateThrows = false } = {}) {
    const dispatched = [];
    const terminated = [];
    const events = { dispatch: (event) => dispatched.push(event) };
    const builder = Object.create(StateBuilder.prototype);
    builder.app = {
        get: (id) => {
            if (id === Container.Identifiers.EventDispatcherService) {
                return events;
            }
            throw new Error(`unexpected app.get(${String(id)})`);
        },
        getTagged: () => ({ getRegisteredHandlers: () => [] }),
        terminate: async (reason, error) => {
            terminated.push({ reason, error: error && error.message });
            if (terminateThrows) {
                throw new Error("a service provider failed to dispose");
            }
        },
    };
    builder.blockRepository = { getBlockRewards: async () => [], getDonations: async () => [] };
    builder.transactionRepository = { getSentTransactions: async () => [] };
    builder.walletRepository = { allByAddress: () => wallets, allByUsername: () => [] };
    builder.dposState = { buildVoteBalances() {}, buildDelegateRanking() {} };
    builder.logger = makeLogger();
    builder.configRepository = { get: (_key, defaultValue) => defaultValue };
    return { builder, dispatched, terminated };
}

// Runs StateBuilder.run() and reports how it ended.
async function runBuilder(wallets, options) {
    const { builder, dispatched, terminated } = makeStateBuilder(wallets, options);
    stubExit();
    try {
        await builder.run();
        return { exited: [...exits], dispatched, terminated, logger: builder.logger };
    } catch (error) {
        return { exited: [...exits], error, dispatched, terminated, logger: builder.logger };
    } finally {
        restoreExit();
    }
}

// The node is terminated with the reason and the process exits with code 1.
const expectExit = (result, message) => {
    if (result.exited.length === 0) {
        return `run() ${result.error ? `threw "${result.error.message}"` : "resolved"} without exiting (logged: ${JSON.stringify(
            result.logger.lines.filter((line) => line.startsWith("error")).map((line) => line.split("\n")[0]),
        )})`;
    }
    if (result.exited.length !== 1 || result.exited[0] !== 1) {
        return `process.exit calls ${JSON.stringify(result.exited)}`;
    }
    const reason = `State Generation failed: ${message}`;
    return result.terminated.length === 1 && result.terminated[0].reason === reason && result.terminated[0].error === message
        ? true
        : `terminate calls ${JSON.stringify(result.terminated)}, expected the reason "${reason}"`;
};

// The blockchain's Initialise action on the StateBuilder path (no saved state), with stubs. Returns
// what it dispatched to the state machine and what it did after the StateBuilder.
async function runInitialise(builder) {
    const dispatched = [];
    const after = [];
    stubExit();
    const action = Object.create(Initialise.prototype);
    action.app = {
        get: (id) => {
            if (id === Container.Identifiers.StateLoader) {
                return { run: async () => false };
            }
            if (id === Container.Identifiers.StateBuilder) {
                return builder;
            }
            throw new Error(`unexpected app.get(${String(id)})`);
        },
    };
    action.logger = makeLogger();
    action.blockchain = { dispatch: (event) => dispatched.push(event) };
    action.stateStore = {
        getLastBlock: () => ({ data: { height: 190, id: "f".repeat(64) } }),
        getRestoredDatabaseIntegrity: () => true,
        getNetworkStart: () => false,
    };
    action.databaseService = { deleteRound: async () => {}, verifyBlockchain: async () => true };
    action.missedBlockRepository = { hasMissedBlocks: async () => true };
    action.databaseInteraction = { restoreCurrentRound: async () => after.push("restoreCurrentRound") };
    action.pool = { readdTransactions: async () => after.push("readdTransactions") };
    action.networkMonitor = { boot: async () => after.push("networkMonitor.boot") };
    try {
        await action.handle();
    } finally {
        restoreExit();
    }
    return { dispatched, after, exited: [...exits] };
}

async function main() {
    console.log(`SOLAR_DIR=${SOLAR_DIR}`);
    Managers.configManager.setConfig(makeConfig());
    process.env.CORE_PATH_TEMP = path.join(__dirname, "does-not-exist-45");

    const negativeGenesisSender = () => [new StubWallet(GENERATOR_ADDRESS, "-10000000000000000")];
    const negativeOther = () => [new StubWallet(GENESIS_WALLET, "3000000000000000"), new StubWallet(GENERATOR_ADDRESS, "-1")];
    const negativeVoteBalance = () => [
        new StubWallet(GENESIS_WALLET, "1", { "delegate.voteBalance": BigNumber.make(-5) }),
    ];
    const consistent = () => [new StubWallet(GENESIS_WALLET, "3000000000000000"), new StubWallet(GENERATOR_ADDRESS, "0")];

    const sender = await runBuilder(negativeGenesisSender());
    await check('negative genesis sender: run() terminates with "State Generation failed: Wallet with negative balance" and exits 1 (base: resolves)', () =>
        expectExit(sender, "Wallet with negative balance"),
    );
    await check("negative genesis sender: BuilderFinished is not dispatched", () =>
        sender.dispatched.includes(Enums.StateEvent.BuilderFinished) ? "BuilderFinished was dispatched" : true,
    );
    await check("negative genesis sender: the wallet and its balance are logged", () =>
        sender.logger.lines.includes(
            `warning: Wallet ${GENERATOR_ADDRESS} has a negative balance of -10000000000000000`,
        )
            ? true
            : `log: ${JSON.stringify(sender.logger.lines)}`,
    );

    await check("negative balance of 1 unit: run() terminates and exits 1 (base: resolves)", async () =>
        expectExit(await runBuilder(negativeOther()), "Wallet with negative balance"),
    );
    await check('negative vote balance: run() terminates with "... Wallet with negative vote balance" and exits 1 (base: resolves)', async () =>
        expectExit(await runBuilder(negativeVoteBalance()), "Wallet with negative vote balance"),
    );

    await check("negative balance, terminate() throws: the process still exits 1 (base: resolves)", async () =>
        expectExit(await runBuilder(negativeGenesisSender(), { terminateThrows: true }), "Wallet with negative balance"),
    );

    await check("consistent state: run() resolves, dispatches BuilderFinished, does not exit (unchanged)", async () => {
        const result = await runBuilder(consistent());
        if (result.error || result.exited.length || result.terminated.length) {
            return `error ${result.error && result.error.message}, exits ${JSON.stringify(result.exited)}`;
        }
        return result.dispatched.includes(Enums.StateEvent.BuilderFinished) ? true : "BuilderFinished not dispatched";
    });

    // The node: Initialise runs the StateBuilder when no saved state loads.
    await check("node start, negative wallet: the process exits 1 inside the StateBuilder; nothing after it runs (base: STARTED)", async () => {
        const { builder } = makeStateBuilder(negativeGenesisSender());
        const { dispatched, after, exited } = await runInitialise(builder);
        if (exited.length !== 1 || exited[0] !== 1) {
            return `process.exit calls ${JSON.stringify(exited)}; dispatched ${JSON.stringify(dispatched)}, then ran ${JSON.stringify(after)}`;
        }
        return after.length === 0 && !dispatched.includes("STARTED")
            ? true
            : `dispatched ${JSON.stringify(dispatched)}, ran ${JSON.stringify(after)} after the StateBuilder`;
    });
    await check("node start, consistent state: Initialise dispatches STARTED (unchanged)", async () => {
        const { builder } = makeStateBuilder(consistent());
        const { dispatched, exited } = await runInitialise(builder);
        return dispatched.length === 1 && dispatched[0] === "STARTED" && exited.length === 0
            ? true
            : `dispatched ${JSON.stringify(dispatched)}, exits ${JSON.stringify(exited)}`;
    });

    console.log(`45-state-builder-fail-closed: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.log(`FAIL test harness: ${error && error.stack}`);
    process.exit(1);
});
