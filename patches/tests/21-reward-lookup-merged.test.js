"use strict";

// Patch 21 reward-lookup-merged.
// calculateReward reads reward and dynamicReward from the merged milestone at the height, so a later
// reward: 0 or dynamicReward: null is honoured instead of an older value coming back.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/21-reward-lookup-merged.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Managers, Utils } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));

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

// The IceRoot reward table: ranks 1-10 1.8 ROOT, 11-21 1.9, 22-32 2.0, 33-43 2.1, 44-53 2.2 (8 decimals).
const tiers = () => {
    const table = {};
    for (let rank = 1; rank <= 53; rank++) {
        table[rank] = rank <= 10 ? 180000000 : rank <= 21 ? 190000000 : rank <= 32 ? 200000000 : rank <= 43 ? 210000000 : 220000000;
    }
    return table;
};

const heightOne = (extra) => ({
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
    bip340: true,
    acceptLegacySchnorrTransactions: false,
    donations: {},
    ...extra,
});

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

const reward = (height, rank) => String(Utils.calculateReward(height, rank));

check("a later reward: 0 gives 0", () => {
    configure([heightOne({ reward: "500000000", dynamicReward: { enabled: false } }), { height: 100, reward: 0 }]);
    const before = reward(50, 1);
    const after = reward(150, 1);
    return (before === "500000000" && after === "0") || `calculateReward(50, 1)=${before}, calculateReward(150, 1)=${after}, expected 500000000 and 0`;
});

check("a later dynamicReward: null disables the rank table", () => {
    configure([
        heightOne({ reward: 0, dynamicReward: { enabled: true, secondaryReward: 180000000, ranks: tiers() } }),
        { height: 100, dynamicReward: null },
    ]);
    const before = reward(50, 1);
    const after = reward(150, 1);
    return (before === "180000000" && after === "0") || `calculateReward(50, 1)=${before}, calculateReward(150, 1)=${after}, expected 180000000 and 0`;
});

check("the IceRoot reward tiers still give 1.8 to 2.2 ROOT", () => {
    configure([heightOne({ reward: 0, dynamicReward: { enabled: true, secondaryReward: 180000000, ranks: tiers() } })]);
    const got = [1, 11, 22, 33, 44].map((rank) => reward(1, rank)).join(",");
    const expected = "180000000,190000000,200000000,210000000,220000000";
    return got === expected || `ranks 1, 11, 22, 33, 44 gave ${got}, expected ${expected}`;
});

check("a later positive reward still applies", () => {
    configure([heightOne({ reward: 0, dynamicReward: { enabled: false } }), { height: 100, reward: "1000000000" }]);
    const got = `${reward(50, 1)},${reward(100, 1)}`;
    return got === "0,1000000000" || `heights 50, 100 gave ${got}`;
});

check("a missing reward gives 0", () => {
    configure([heightOne({ dynamicReward: { enabled: false } })]);
    return reward(10, 1) === "0" || `gave ${reward(10, 1)}`;
});

console.log(`SUMMARY 21-reward-lookup-merged: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
