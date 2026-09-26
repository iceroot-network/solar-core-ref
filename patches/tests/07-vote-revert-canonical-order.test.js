#!/usr/bin/env node
// Patch 07 vote-revert-canonical-order.
// VoteTransactionHandler.revertForSender stores the restored votes in sortVotes order (percent
// descending, then name in byte order), as bootstrap and applyToSender already do. s1-ref-v1
// stored them in the order in which the earlier vote transaction was signed. That order is not
// checked at decode, and Wallet.calculateVoteAmount gives the i-th remainder unit to the i-th
// delegate in the votes Map, so a node that reverted a block could credit a remainder unit to a
// different delegate than a node that did not (or that rebuilt its state from history).
//
// The handler runs with real Wallet objects and stub repositories. The base class's
// applyToSender and revertForSender (nonce, fee) are stubbed out, so the sender's balance stays
// 101 and only the vote logic is exercised.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/07-vote-revert-canonical-order.test.js
// Exit code 0 when every check passes, 1 otherwise.
"use strict";

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");

let failed = 0;
let passed = 0;
const pass = (name) => {
    passed++;
    console.log(`PASS ${name}`);
};
const fail = (name, detail) => {
    failed++;
    console.log(`FAIL ${name}: ${detail}`);
};
const check = async (name, fn) => {
    try {
        const detail = await fn();
        if (detail === true) {
            pass(name);
        } else {
            fail(name, detail);
        }
    } catch (error) {
        fail(
            name,
            `threw ${error && error.constructor ? error.constructor.name : typeof error}: ${error && error.message}`,
        );
    }
};

const devnetConfig = () => ({
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
            blockTime: 8,
            block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
            blocksToRevokeDelegateResignation: 106,
            epoch: "2026-09-25T20:05:04.000Z",
            reward: 0,
            burn: { feeBasisPoints: 9000, txAmount: 2000000 },
            donations: {},
            fees: { staticFees: { vote: 9000000 } },
            legacyTransfer: false,
            legacyVote: false,
            acceptLegacySchnorrTransactions: false,
            bip340: true,
        },
    ],
    genesisBlock: { transactions: [] },
    exceptions: {},
});

const PASSPHRASE = "patch 07 vote sender";
const DELEGATES = ["a9", "a10", "a", "b", "genesis_1"];

const main = async () => {
    let Crypto;
    let Kernel;
    let State;
    let Transactions;
    try {
        Crypto = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
        Kernel = require(path.join(SOLAR_DIR, "packages/kernel/dist"));
        State = require(path.join(SOLAR_DIR, "packages/state/dist"));
        Transactions = require(path.join(SOLAR_DIR, "packages/transactions/dist"));
    } catch (error) {
        fail("load Solar packages", error.message);
        return;
    }

    Crypto.Managers.configManager.setConfig(devnetConfig());
    Crypto.Managers.configManager.setHeight(1);

    const { BigNumber } = Crypto.Utils;
    const { TransactionHandler, Solar } = Transactions.Handlers;

    // Stub the base class: only the vote logic of the Solar vote handler runs.
    TransactionHandler.prototype.applyToSender = async function () {};
    TransactionHandler.prototype.revertForSender = async function () {};

    const attributeSet = new Kernel.Services.Attributes.AttributeSet();
    for (const key of [
        "votes",
        "delegate",
        "delegate.username",
        "delegate.voteBalance",
        "delegate.voters",
        "htlc.lockedBalance",
    ]) {
        attributeSet.set(key);
    }
    const makeWallet = (address) =>
        new State.Wallets.Wallet(address, new Kernel.Services.Attributes.AttributeMap(attributeSet), false);

    const senderAddress = Crypto.Identities.Address.fromPassphrase(PASSPHRASE, 90);

    // A fresh world: the sender with a balance of 101 and five delegates with no votes.
    const makeWorld = () => {
        const sender = makeWallet(senderAddress);
        sender.setBalance(BigNumber.make(101));
        const delegates = new Map();
        for (const name of DELEGATES) {
            const wallet = makeWallet(`delegate-${name}`);
            wallet.setAttribute("delegate.username", name);
            wallet.setAttribute("delegate.voteBalance", BigNumber.ZERO);
            wallet.setAttribute("delegate.voters", 0);
            delegates.set(name, wallet);
        }
        const walletRepository = {
            findByAddress: (address) => {
                if (address !== senderAddress) {
                    throw new Error(`unexpected address ${address}`);
                }
                return sender;
            },
            findByUsername: (name) => {
                if (!delegates.has(name)) {
                    throw new Error(`unexpected delegate ${name}`);
                }
                return delegates.get(name);
            },
            hasByUsername: (name) => delegates.has(name),
            index: () => {},
        };
        return { sender, delegates, walletRepository };
    };

    // A history stub: listByCriteria answers with `previous` (or nothing), streamByCriteria yields `history`.
    const makeHandler = (walletRepository, { previous, history = [] } = {}) => {
        const handler = Object.create(Solar.VoteTransactionHandler.prototype);
        const queries = [];
        handler.walletRepository = walletRepository;
        handler.transactionHistoryService = {
            listByCriteria: async (criteria, sorting, pagination) => {
                queries.push({ criteria, sorting, pagination });
                return { results: previous ? [previous] : [] };
            },
            streamByCriteria: async function* () {
                yield* history;
            },
        };
        return { handler, queries };
    };

    // A signed vote whose asset is written in exactly the given key order. The SDK builder sorts
    // the votes, so the builder's asset is replaced before signing, as any other signer may do.
    // The transaction goes through strict fromBytes, as a block's transactions do, and its data
    // is what the history service returns (Solar's model converter decodes the stored bytes).
    const signedVote = (votes, nonce, blockHeight) => {
        const builder = Crypto.Transactions.BuilderFactory.vote().votesAsset(votes).nonce(String(nonce)).network(90);
        builder.data.asset.votes = { ...votes };
        const built = builder.sign(PASSPHRASE).build();
        const decoded = Crypto.Transactions.TransactionFactory.fromBytes(built.serialised);
        decoded.data.blockHeight = blockHeight;
        if (decoded.data.senderId === undefined) {
            decoded.data.senderId = senderAddress;
        }
        return decoded;
    };

    const votesOf = (wallet) =>
        [...wallet.getAttribute("votes").entries()].map(([name, percent]) => `${name}:${percent}`).join(", ");
    const splitOf = (wallet) =>
        [...wallet.getVoteBalances().entries()].map(([name, amount]) => `${name}=${amount.toString()}`).join(", ");
    const delegateBalances = (delegates) =>
        [...delegates.entries()]
            .map(([name, wallet]) => `${name}=${wallet.getAttribute("delegate.voteBalance").toString()}`)
            .join(", ");

    // Applies `previousVotes` (block 10), then a vote for genesis_1 (block 20), then reverts the
    // second vote. Returns the states before the second vote and after its revert.
    const applyThenRevert = async (previousVotes) => {
        const { sender, delegates, walletRepository } = makeWorld();
        const previous = previousVotes === undefined ? undefined : signedVote(previousVotes, 2, 10);
        const { handler, queries } = makeHandler(walletRepository, { previous: previous && previous.data });

        if (previous) {
            await handler.applyToSender(previous);
        }
        const before = { votes: votesOf(sender), split: splitOf(sender), delegates: delegateBalances(delegates) };

        const next = signedVote({ genesis_1: 100 }, 3, 20);
        await handler.applyToSender(next);
        const during = { votes: votesOf(sender), delegates: delegateBalances(delegates) };

        await handler.revertForSender(next);
        const after = { votes: votesOf(sender), split: splitOf(sender), delegates: delegateBalances(delegates) };

        return { before, during, after, queries, previous };
    };

    await check("a vote signed as {a9: 50, a10: 50} keeps that key order through strict fromBytes", () => {
        const keys = Object.keys(signedVote({ a9: 50, a10: 50 }, 2, 10).data.asset.votes).join(", ");
        return keys === "a9, a10" ? true : `key order ${keys}`;
    });

    const nameOrder = await applyThenRevert({ a9: 50, a10: 50 });

    await check("the reverted vote was applied (genesis_1 holds 101)", () =>
        nameOrder.during.votes === "genesis_1:100" && nameOrder.during.delegates.includes("genesis_1=101")
            ? true
            : `votes ${nameOrder.during.votes}; delegates ${nameOrder.during.delegates}`,
    );

    await check("the revert asks for the sender's last vote below the reverted block's height", () => {
        const [query] = nameOrder.queries.slice(-1);
        const [criteria] = query.criteria;
        return criteria.blockHeight.to === 19 && criteria.senderId === senderAddress && query.pagination.limit === 1
            ? true
            : JSON.stringify(query);
    });

    await check("revert restores the votes previously signed as {a9: 50, a10: 50} in the order a10, a9", () =>
        nameOrder.after.votes === "a10:50, a9:50" ? true : `votes Map ${nameOrder.after.votes}`,
    );

    await check("revert splits the balance 101 as a10 51 and a9 50", () =>
        nameOrder.after.split === "a10=51, a9=50" ? true : `sender vote balances ${nameOrder.after.split}`,
    );

    await check("revert sets the delegates' voteBalance to a10 51, a9 50, genesis_1 0", () =>
        nameOrder.after.delegates === "a9=50, a10=51, a=0, b=0, genesis_1=0"
            ? true
            : `delegate voteBalance ${nameOrder.after.delegates}`,
    );

    await check("apply then revert returns the votes Map and the delegates' voteBalance to their prior state", () =>
        nameOrder.after.votes === nameOrder.before.votes && nameOrder.after.delegates === nameOrder.before.delegates
            ? true
            : `before: ${nameOrder.before.votes} / ${nameOrder.before.delegates}; ` +
              `after: ${nameOrder.after.votes} / ${nameOrder.after.delegates}`,
    );

    await check(
        "a node that rebuilds from history (bootstrap) gets the same votes Map as the reverting node",
        async () => {
            const { sender, walletRepository } = makeWorld();
            const { handler } = makeHandler(walletRepository, {
                history: [signedVote({ a9: 50, a10: 50 }, 2, 10).data],
            });
            await handler.bootstrap();
            const rebuilt = votesOf(sender);
            return rebuilt === nameOrder.after.votes ? true : `bootstrap ${rebuilt}, revert ${nameOrder.after.votes}`;
        },
    );

    const percentOrder = await applyThenRevert({ a: 30, b: 70 });

    await check("revert restores the votes previously signed as {a: 30, b: 70} in the order b, a", () =>
        percentOrder.after.votes === "b:70, a:30" ? true : `votes Map ${percentOrder.after.votes}`,
    );

    await check("revert splits the balance 101 as b 71 and a 30", () =>
        percentOrder.after.split === "b=71, a=30" ? true : `sender vote balances ${percentOrder.after.split}`,
    );

    const canonical = await applyThenRevert({ a10: 50, a9: 50 });

    await check("a previous vote signed in canonical order {a10: 50, a9: 50} is restored as a10, a9 (a10 51)", () =>
        canonical.after.votes === "a10:50, a9:50" && canonical.after.split === "a10=51, a9=50"
            ? true
            : `votes Map ${canonical.after.votes}; split ${canonical.after.split}`,
    );

    const none = await applyThenRevert(undefined);

    await check("with no earlier vote, revert leaves an empty votes Map and every voteBalance at 0", () =>
        none.after.votes === "" && none.after.delegates === "a9=0, a10=0, a=0, b=0, genesis_1=0"
            ? true
            : `votes Map ${none.after.votes}; delegates ${none.after.delegates}`,
    );
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
