#!/usr/bin/env node
// Patch 04 vote-order-bytewise (L-57).
// sortVotes orders by percent descending, then by name in plain code-unit order (byte order,
// since delegate names are ASCII), instead of localeCompare("en", { numeric: true }).
// The order is consensus-visible: the wallet's votes Map follows it, and
// Wallet.calculateVoteAmount gives the i-th remainder unit to the i-th delegate in the Map.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/04-vote-order-bytewise.test.js
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

const expectOrder = (actual, expected) => {
    const keys = Object.keys(actual);
    return JSON.stringify(keys) === JSON.stringify(expected) ? true : `key order ${keys.join(", ")}`;
};

const main = async () => {
    let Crypto;
    let State;
    try {
        Crypto = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
        State = require(path.join(SOLAR_DIR, "packages/state/dist"));
    } catch (error) {
        fail("load Solar packages", error.message);
        return;
    }

    Crypto.Managers.configManager.setConfig(devnetConfig());
    Crypto.Managers.configManager.setHeight(1);

    const { sortVotes, BigNumber } = Crypto.Utils;

    await check("sortVotes({a9, a10, b2, b10} at 25 each) orders a10, a9, b10, b2", () =>
        expectOrder(sortVotes({ a9: 25, a10: 25, b2: 25, b10: 25 }), ["a10", "a9", "b10", "b2"]),
    );

    await check("sortVotes({x: 60, a: 40}) keeps percent first: x, a", () =>
        expectOrder(sortVotes({ x: 60, a: 40 }), ["x", "a"]),
    );

    await check("sortVotes({a: 10, b: 50, c: 40}) orders b, c, a", () =>
        expectOrder(sortVotes({ a: 10, b: 50, c: 40 }), ["b", "c", "a"]),
    );

    await check("sortVotes orders punctuation by byte value (a!b a$b a&b a.b a0b a@b a_b ab)", () =>
        expectOrder(
            sortVotes({
                a_b: 12.5,
                "a!b": 12.5,
                "a.b": 12.5,
                "a@b": 12.5,
                "a&b": 12.5,
                a$b: 12.5,
                a0b: 12.5,
                ab: 12.5,
            }),
            ["a!b", "a$b", "a&b", "a.b", "a0b", "a@b", "a_b", "ab"],
        ),
    );

    await check("a prefix sorts before the longer name: ab, abc", () =>
        expectOrder(sortVotes({ abc: 50, ab: 50 }), ["ab", "abc"]),
    );

    await check("the vote builder writes the asset in the new order", () => {
        const transaction = Crypto.Transactions.BuilderFactory.vote()
            .votesAsset({ a9: 50, a10: 50 })
            .nonce("1")
            .network(90)
            .sign("patch 04 vote sender")
            .build();
        return expectOrder(transaction.data.asset.votes, ["a10", "a9"]);
    });

    await check("calculateVoteAmount(101) over sortVotes({a9: 50, a10: 50}) gives a10 51 and a9 50", () => {
        const wallet = Object.create(State.Wallets.Wallet.prototype);
        const delegates = new Map(Object.entries(sortVotes({ a9: 50, a10: 50 })));
        const votes = wallet.calculateVoteAmount(
            { balance: BigNumber.make(101), lockedBalance: BigNumber.ZERO },
            delegates,
        );
        const a10 = votes.get("a10").balance.toString();
        const a9 = votes.get("a9").balance.toString();
        return a10 === "51" && a9 === "50" ? true : `a10 ${a10}, a9 ${a9}`;
    });
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
