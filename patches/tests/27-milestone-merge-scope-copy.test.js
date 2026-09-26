"use strict";

// Patch 27 milestone-merge-scope-copy.
// The replace rule of patch 20 applies only to dynamicReward.ranks and to the top-level donations. A key
// named ranks or donations anywhere else deep-merges like any other object. The replaced value is a copy,
// so a merged milestone never shares an object with the raw configuration it was built from.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/27-milestone-merge-scope-copy.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Managers } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));

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

const ADDRESS_A = "dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokA";
const ADDRESS_B = "dPiLD2Fi1dnQhnskBkSnDEPraaWtbTcYPj";

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

// A full table for 53 active delegates: the IceRoot reward tiers, or every rank at one value.
const ranks = (flat) => {
    const table = {};
    for (let rank = 1; rank <= 53; rank++) {
        table[rank] = flat ?? (rank <= 10 ? 180000000 : rank <= 21 ? 190000000 : rank <= 32 ? 200000000 : rank <= 43 ? 210000000 : 220000000);
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
    reward: 0,
    bip340: true,
    acceptLegacySchnorrTransactions: false,
    dynamicReward: { enabled: true, secondaryReward: 180000000, ranks: ranks() },
    donations: {
        [ADDRESS_A]: { basisPoints: 500, purpose: "purpose-a" },
        [ADDRESS_B]: { basisPoints: 500, purpose: "purpose-b" },
    },
    ...extra,
});

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

const cm = Managers.configManager;
const show = (value) => JSON.stringify(value);
const same = (got, expected, label) => show(got) === show(expected) || `${label} is ${show(got)}, expected ${show(expected)}`;
// A rank table comparison that names only the ranks that differ.
const sameTable = (got, expected, label) => {
    const keys = [...new Set([...Object.keys(got), ...Object.keys(expected)])];
    const differ = keys.filter((key) => show(got[key]) !== show(expected[key]));
    return differ.length === 0 || `${label} differs at ${differ.map((key) => `${key}: ${show(got[key])}`).join(", ")}`;
};

// Scope: keys named ranks or donations outside dynamicReward.ranks and the top-level donations still merge.

configure([
    heightOne({
        ranks: { r1: 1, r2: 2 },
        custom: { ranks: { a: 1, b: 2 }, donations: { x: 1, y: 2 }, deep: { ranks: { c: 3, d: 4 } } },
        dynamicReward: { enabled: true, secondaryReward: 180000000, ranks: ranks(), donations: { p: 1, q: 2 } },
    }),
    {
        height: 100,
        ranks: { r2: 20 },
        custom: { ranks: { b: 20 }, donations: { y: 20 }, deep: { ranks: { d: 40 } } },
        dynamicReward: { donations: { q: 20 } },
    },
]);

check("a top-level ranks key merges", () => same(cm.getMilestone(150).ranks, { r1: 1, r2: 20 }, "ranks"));
check("custom.ranks merges", () => same(cm.getMilestone(150).custom.ranks, { a: 1, b: 20 }, "custom.ranks"));
check("custom.donations merges", () => same(cm.getMilestone(150).custom.donations, { x: 1, y: 20 }, "custom.donations"));
check("custom.deep.ranks merges", () => same(cm.getMilestone(150).custom.deep.ranks, { c: 3, d: 40 }, "custom.deep.ranks"));
check("dynamicReward.donations merges", () =>
    same(cm.getMilestone(150).dynamicReward.donations, { p: 1, q: 20 }, "dynamicReward.donations"));
check("dynamicReward.ranks is untouched by a milestone that does not set it", () =>
    sameTable(cm.getMilestone(150).dynamicReward.ranks, ranks(), "dynamicReward.ranks"));

// The rule itself still holds: dynamicReward.ranks and the top-level donations are replaced whole.

const rawRanks = ranks(200000000);
const rawDonations = { [ADDRESS_B]: { basisPoints: 700, purpose: "purpose-b" } };
const milestone100 = { height: 100, dynamicReward: { ranks: rawRanks } };
const milestone200 = { height: 200, donations: rawDonations };

configure([heightOne(), milestone100, milestone200]);

check("dynamicReward.ranks is replaced whole", () =>
    sameTable(cm.getMilestone(150).dynamicReward.ranks, ranks(200000000), "dynamicReward.ranks"));
check("the top-level donations are replaced whole", () =>
    same(cm.getMilestone(250).donations, { [ADDRESS_B]: { basisPoints: 700, purpose: "purpose-b" } }, "donations"));

// Copy: the merged milestone does not alias the raw configuration.

check("the merged ranks are not the raw object", () =>
    cm.getMilestone(150).dynamicReward.ranks !== rawRanks || "getMilestone(150).dynamicReward.ranks is the raw milestone's object");
check("the merged donations are not the raw object", () =>
    cm.getMilestone(250).donations !== rawDonations || "getMilestone(250).donations is the raw milestone's object");
check("a merged donation entry is not the raw entry", () =>
    cm.getMilestone(250).donations[ADDRESS_B] !== rawDonations[ADDRESS_B] || "the entry is shared with the raw milestone");

// Changing the raw objects after setConfig must not change the validated values in force.
rawRanks[1] = "999";
delete rawRanks[53];
rawDonations[ADDRESS_B].basisPoints = 10001;
rawDonations[ADDRESS_A] = null;

check("a later change to the raw ranks does not reach the merged milestone", () =>
    sameTable(cm.getMilestone(150).dynamicReward.ranks, ranks(200000000), "getMilestone(150).dynamicReward.ranks"));
check("a later change to the raw donations does not reach the merged milestone", () =>
    same(cm.getMilestone(250).donations, { [ADDRESS_B]: { basisPoints: 700, purpose: "purpose-b" } }, "getMilestone(250).donations"));

// The merged value is also independent in the other direction.
check("a change to the merged donations does not reach the raw object", () => {
    const fresh = { [ADDRESS_A]: { basisPoints: 300 } };
    configure([heightOne(), { height: 200, donations: fresh }]);
    cm.getMilestone(250).donations[ADDRESS_A].basisPoints = 1;
    return fresh[ADDRESS_A].basisPoints === 300 || `the raw entry changed to ${fresh[ADDRESS_A].basisPoints}`;
});

console.log(`SUMMARY 27-milestone-merge-scope-copy: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
