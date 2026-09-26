#!/usr/bin/env node
// Patch 03 vote-sum-integer.
// The sumOfVotesEquals100 schema keyword sums integer basis points, Math.round(value * 100),
// instead of adding floats, and requires exactly 10,000 (or no votes at all). The basis
// points are the u16 values that the vote codec writes and reads.
//
// Golden values: of the 9,999 two-way cent splits a/100 + (10000 - a)/100, Solar 4.3.1
// rejects exactly the 40 listed in BASE_REJECTED because the float sum is not exactly
// 10000. After the patch all 9,999 pass.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/03-vote-sum-integer.test.js
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

// The two-way splits (first/second, votes {a: first, b: second}) that Solar 4.3.1 rejects.
const BASE_REJECTED = [
    "18.10/81.90", "18.15/81.85", "18.35/81.65", "18.40/81.60", "18.60/81.40", "18.65/81.35", "18.85/81.15",
    "18.90/81.10", "19.10/80.90", "19.15/80.85", "19.35/80.65", "19.40/80.60", "19.60/80.40", "19.65/80.35",
    "19.85/80.15", "19.90/80.10", "20.10/79.90", "20.15/79.85", "20.35/79.65", "20.40/79.60", "79.60/20.40",
    "79.65/20.35", "79.85/20.15", "79.90/20.10", "80.10/19.90", "80.15/19.85", "80.35/19.65", "80.40/19.60",
    "80.60/19.40", "80.65/19.35", "80.85/19.15", "80.90/19.10", "81.10/18.90", "81.15/18.85", "81.35/18.65",
    "81.40/18.60", "81.60/18.40", "81.65/18.35", "81.85/18.15", "81.90/18.10",
]; // prettier-ignore

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

const main = async () => {
    let Crypto;
    try {
        Crypto = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
    } catch (error) {
        fail("load Solar packages", error.message);
        return;
    }

    Crypto.Managers.configManager.setConfig(devnetConfig());
    Crypto.Managers.configManager.setHeight(1);

    const { BuilderFactory, Serialiser, TransactionFactory, Verifier } = Crypto.Transactions;
    const passphrase = "patch 03 vote sender";

    // A signed vote struct; each check swaps in the votes under test and runs the strict vote schema.
    const template = BuilderFactory.vote().votesAsset({ a: 50, b: 50 }).nonce("1").network(90).sign(passphrase);
    const baseStruct = template.getStruct();
    const schemaError = (votes) => {
        const data = { ...baseStruct, asset: { votes } };
        return Verifier.verifySchema(data, true).error;
    };
    const cents = (a) => a / 100;
    const label = (a) => `${cents(a).toFixed(2)}/${cents(10000 - a).toFixed(2)}`;

    await check("golden list: the 40 splits are exactly those whose float sum is not 10000", () => {
        const floatRejected = [];
        for (let a = 1; a <= 9999; a++) {
            let total = 0;
            for (const value of [cents(a), cents(10000 - a)]) {
                total += value * 100;
            }
            if (total !== 10000) {
                floatRejected.push(label(a));
            }
        }
        return JSON.stringify(floatRejected) === JSON.stringify(BASE_REJECTED)
            ? true
            : `float-sum set has ${floatRejected.length} entries: ${floatRejected.slice(0, 5).join(" ")} ...`;
    });

    await check("all 9,999 two-way cent splits pass the vote schema", () => {
        const rejected = [];
        for (let a = 1; a <= 9999; a++) {
            const error = schemaError({ a: cents(a), b: cents(10000 - a) });
            if (error) {
                rejected.push(label(a));
            }
        }
        if (rejected.length === 0) {
            return true;
        }
        const sameAsBase = JSON.stringify(rejected) === JSON.stringify(BASE_REJECTED);
        return `${rejected.length} rejected${sameAsBase ? " (exactly the Solar 4.3.1 list)" : ""}: ${rejected
            .slice(0, 6)
            .join(" ")} ...`;
    });

    await check("each of the 40 splits Solar 4.3.1 rejected now passes", () => {
        const stillRejected = BASE_REJECTED.filter((split) => {
            const [first, second] = split.split("/").map(Number);
            return schemaError({ a: first, b: second });
        });
        return stillRejected.length === 0 ? true : `${stillRejected.length} still rejected, first ${stillRejected[0]}`;
    });

    await check("{a: 50, b: 49.99} is rejected by sumOfVotesEquals100", () => {
        const error = schemaError({ a: 50, b: 49.99 });
        return error && /sumOfVotesEquals100/.test(error) ? true : `error: ${error}`;
    });

    await check("{} is accepted", () => {
        const error = schemaError({});
        return error ? `error: ${error}` : true;
    });

    await check("{a: 100} is accepted", () => {
        const error = schemaError({ a: 100 });
        return error ? `error: ${error}` : true;
    });

    await check("{a: 33.33, b: 33.33, c: 33.34} is accepted", () => {
        const error = schemaError({ a: 33.33, b: 33.33, c: 33.34 });
        return error ? `error: ${error}` : true;
    });

    await check("a non-numeric value is still rejected", () => {
        const error = schemaError({ a: "fifty", b: 50 });
        return error ? true : "accepted";
    });

    await check("a vote decoded from bytes with basis points 1810 and 8190 passes strict fromBytes", () => {
        // Sign without the builder's schema check, then serialise the signed data directly.
        const builder = BuilderFactory.vote().votesAsset({ a: 18.1, b: 81.9 }).nonce("2").network(90).sign(passphrase);
        const bytes = Serialiser.getBytes(builder.data);
        const hex = bytes.toString("hex");
        // Asset: count 2, then "b" 8190 (fe1f) and "a" 1810 (1207), in sortVotes order.
        if (!hex.includes("020162fe1f01611207")) {
            return `vote asset bytes not found in ${hex}`;
        }
        const decoded = TransactionFactory.fromBytes(bytes, true);
        const votes = decoded.data.asset.votes;
        if (votes.a !== 18.1 || votes.b !== 81.9) {
            return `decoded votes ${JSON.stringify(votes)}`;
        }
        return decoded.isVerified === true ? true : "signature did not verify";
    });
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
