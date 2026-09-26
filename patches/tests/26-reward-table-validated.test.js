"use strict";

// Patch 26 reward-table-validated.
// When a merged milestone has dynamicReward.enabled, setConfig refuses it unless dynamicReward.ranks is a
// plain object with a reward for every rank from 1 to activeDelegates and dynamicReward.secondaryReward is a
// reward too. A reward is a non-negative safe integer, or a decimal integer string of at most 2^64 - 1 (the
// block's u64 reward field). Without the check a missing rank throws in calculateReward and a bad value
// throws or mis-serialises when the block is built, so the chain halts instead of the node refusing to start.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/26-reward-table-validated.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Errors, Managers, Utils } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));

let passed = 0;
let failed = 0;
const check = (name, fn) => {
    try {
        const detail = fn();
        if (detail === true) {
            passed++;
            console.log(`PASS ${name}`);
        } else {
            failed++;
            console.log(`FAIL ${name}: ${detail}`);
        }
    } catch (error) {
        failed++;
        console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`);
    }
};

const network = {
    name: "devnet",
    messagePrefix: "Solar devnet message:\n",
    addressCharacter: "d",
    bip32: { public: 70617039, private: 70615956 },
    pubKeyHash: 90,
    nethash: "c9b03ab996ef3ac216a2ac53eaee71118cbf7995fa44449a7fb7f94bbe18bcca",
    wif: 252,
    slip44: 1,
    client: { token: "dROOT", symbol: "dRT", explorer: "" },
};

// IceRoot's reward table for ranks 1 to count: 1-10 1.8 ROOT, 11-21 1.9, 22-32 2.0, 33-43 2.1, 44-53 2.2 (8 decimals).
const ranks = (count, asString = false) => {
    const table = {};
    for (let rank = 1; rank <= count; rank++) {
        const reward = rank <= 10 ? 180000000 : rank <= 21 ? 190000000 : rank <= 32 ? 200000000 : rank <= 43 ? 210000000 : 220000000;
        table[rank] = asString ? String(reward) : reward;
    }
    return table;
};

const heightOne = (dynamicReward) => ({
    height: 1,
    activeDelegates: 53,
    block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
    blocksToRevokeDelegateResignation: 106,
    blockTime: 8,
    burn: { feeBasisPoints: 9000, txAmount: 2000000 },
    epoch: "2026-09-25T20:05:04.000Z",
    fees: { staticFees: { transfer: 50000000 } },
    legacyTransfer: false,
    legacyVote: false,
    p2p: { minimumVersions: [">=4.3.0"] },
    transfer: { maximum: 256, minimum: 1 },
    reward: 0,
    bip340: true,
    acceptLegacySchnorrTransactions: false,
    dynamicReward,
    donations: {},
});

const table = (overrides = {}, count = 53) => ({ enabled: true, secondaryReward: 180000000, ranks: { ...ranks(count), ...overrides } });

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

const accepted = (name, milestones, verify) =>
    check(`accepted: ${name}`, () => {
        configure(milestones);
        return verify ? verify() : true;
    });

// A refusal must be InvalidMilestoneConfigurationError and name the height and every given part (the rank).
const refused = (name, milestones, height, ...parts) =>
    check(`refused: ${name}`, () => {
        try {
            configure(milestones);
        } catch (error) {
            if (!(error instanceof Errors.InvalidMilestoneConfigurationError)) {
                return `threw ${error.constructor.name}: ${error.message}`;
            }
            for (const part of [`height: ${height}.`, ...parts]) {
                if (!error.message.includes(part)) {
                    return `message "${error.message}" does not name "${part}"`;
                }
            }
            return true;
        }
        return "setConfig accepted it";
    });

const reward = (height, rank) => String(Utils.calculateReward(height, rank));

// Accepted tables.

accepted("the IceRoot reward table with 53 number values", [heightOne(table())], () => {
    const got = [1, 11, 22, 33, 44, 53].map((rank) => reward(1, rank)).join(",");
    return got === "180000000,190000000,200000000,210000000,220000000,220000000" || `ranks 1, 11, 22, 33, 44, 53 gave ${got}`;
});
accepted("decimal strings for every rank and for secondaryReward", [
    heightOne({ enabled: true, secondaryReward: "180000000", ranks: ranks(53, true) }),
]);
accepted("0, \"0\" and the u64 maximum as a string", [
    heightOne(table({ 1: 0, 2: "0", 3: "18446744073709551615" })),
]);
accepted("2^53 - 1 as a number", [heightOne(table({ 7: 9007199254740991 }))]);
accepted("ranks beyond activeDelegates are not checked", [heightOne(table({ 54: 180000000, 55: "not checked" }))]);
accepted("dynamicReward disabled without a table", [heightOne({ enabled: false })]);
accepted("a later dynamicReward: null", [heightOne(table()), { height: 100, dynamicReward: null }]);
accepted("a shrink to 51 ranks where activeDelegates becomes 51", [
    heightOne(table()),
    { height: 107, activeDelegates: 51, dynamicReward: { ranks: ranks(51) } },
]);
for (const preset of ["mainnet", "testnet"]) {
    check(`accepted: the ${preset} preset`, () => {
        Managers.configManager.setFromPreset(preset);
        return true;
    });
}

// Missing ranks.

refused("rank 53 missing at height 1", [heightOne({ enabled: true, secondaryReward: 180000000, ranks: ranks(52) })], 1, "rank 53");
refused("a shrink to 51 ranks while activeDelegates stays 53", [heightOne(table()), { height: 100, dynamicReward: { ranks: ranks(51) } }], 100, "rank 52");
refused("activeDelegates raised to 55 without extending the table", [heightOne(table()), { height: 107, activeDelegates: 55 }], 107, "rank 54");
refused("a later milestone enables a table that is not there", [heightOne({ enabled: false }), { height: 100, dynamicReward: { enabled: true, secondaryReward: 0 } }], 100, "ranks");
refused("ranks: null", [heightOne({ enabled: true, secondaryReward: 180000000, ranks: null })], 1, "ranks");
refused("ranks as an array", [heightOne({ enabled: true, secondaryReward: 180000000, ranks: Object.values(ranks(53)) })], 1, "ranks");
refused("ranks as a string", [heightOne({ enabled: true, secondaryReward: 180000000, ranks: "180000000" })], 1, "ranks");

// Bad values for one rank.

const badValues = [
    ["null", null],
    ["-1", -1],
    ["1.5", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["2^53", 9007199254740992],
    ["true", true],
    ["an object", { amount: 180000000 }],
    ["an array", [180000000]],
    ["\"\"", ""],
    ["\"abc\"", "abc"],
    ["\"-1\"", "-1"],
    ["\"1.5\"", "1.5"],
    ["\"1e8\"", "1e8"],
    ["\"0x10\"", "0x10"],
    ["\"+5\"", "+5"],
    ["\" 5\"", " 5"],
    ["\"007\"", "007"],
    ["2^64 as a string", "18446744073709551616"],
];
for (const [label, value] of badValues) {
    refused(`rank 22 = ${label}`, [heightOne(table({ 22: value }))], 1, "rank 22");
}
refused("a bad value in a later table", [heightOne(table()), { height: 200, dynamicReward: { ranks: { ...ranks(53), 44: "2.2" } } }], 200, "rank 44");

// secondaryReward, the same rule.

const withSecondary = (value) => {
    const dynamicReward = table();
    if (value === undefined) {
        delete dynamicReward.secondaryReward;
    } else {
        dynamicReward.secondaryReward = value;
    }
    return [heightOne(dynamicReward)];
};
refused("secondaryReward missing", withSecondary(undefined), 1, "secondaryReward");
for (const [label, value] of [["null", null], ["-1", -1], ["1.5", 1.5], ["\"abc\"", "abc"], ["\"1.8\"", "1.8"], ["2^64 as a string", "18446744073709551616"]]) {
    refused(`secondaryReward = ${label}`, withSecondary(value), 1, "secondaryReward");
}

console.log(`SUMMARY 26-reward-table-validated: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
