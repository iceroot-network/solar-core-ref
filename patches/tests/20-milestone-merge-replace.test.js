"use strict";

// Patch 20 milestone-merge-replace (L-57, L-64).
// A later milestone replaces dynamicReward.ranks and donations whole; everything else still deep-merges,
// and arrays are still overwritten.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/20-milestone-merge-replace.test.js

const assert = require("assert");
const fs = require("fs");
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

const ranks = (count) => {
    const table = {};
    for (let rank = 1; rank <= count; rank++) {
        table[rank] = rank <= 10 ? 180000000 : rank <= 21 ? 190000000 : rank <= 32 ? 200000000 : rank <= 43 ? 210000000 : 220000000;
    }
    return table;
};

const heightOne = () => ({
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
    dynamicReward: { enabled: true, secondaryReward: 180000000, ranks: ranks(53) },
    donations: {
        [ADDRESS_A]: { basisPoints: 500, purpose: "placeholder-1" },
        [ADDRESS_B]: { basisPoints: 500, purpose: "placeholder-2" },
    },
});

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

configure([
    heightOne(),
    { height: 100, dynamicReward: { ranks: ranks(51) } },
    {
        height: 200,
        donations: { [ADDRESS_A]: { basisPoints: 500, purpose: "placeholder-1" } },
        p2p: { minimumVersions: [">=4.3.1"] },
    },
    { height: 300, donations: {} },
]);

const cm = Managers.configManager;

check("ranks shrink from 53 to 51 keys at height 100", () => {
    const count = Object.keys(cm.getMilestone(150).dynamicReward.ranks).length;
    return count === 51 || `getMilestone(150).dynamicReward.ranks has ${count} keys, expected 51`;
});

check("the rest of dynamicReward still merges", () => {
    const { enabled, secondaryReward } = cm.getMilestone(150).dynamicReward;
    return (enabled === true && secondaryReward === 180000000) || `enabled=${enabled} secondaryReward=${secondaryReward}`;
});

check("donations {A,B} then {A} gives {A}", () => {
    const keys = Object.keys(cm.getMilestone(250).donations);
    return (keys.length === 1 && keys[0] === ADDRESS_A) || `getMilestone(250).donations keys are [${keys}]`;
});

check("a later donations {} clears the list", () => {
    const keys = Object.keys(cm.getMilestone(350).donations);
    return keys.length === 0 || `getMilestone(350).donations keys are [${keys}]`;
});

check("donations before any change keep {A,B}", () => {
    const keys = Object.keys(cm.getMilestone(50).donations);
    return (keys.length === 2 && keys.includes(ADDRESS_A) && keys.includes(ADDRESS_B)) || `keys are [${keys}]`;
});

check("arrays are still overwritten", () => {
    const versions = cm.getMilestone(250).p2p.minimumVersions;
    return (versions.length === 1 && versions[0] === ">=4.3.1") || `minimumVersions is ${JSON.stringify(versions)}`;
});

check("an unchanged key survives every merge", () => {
    return cm.getMilestone(350).burn.feeBasisPoints === 9000 || `burn is ${JSON.stringify(cm.getMilestone(350).burn)}`;
});

// Independent deep merge with Solar's old semantics: objects merge key by key, arrays and scalars replace.
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const oldMerge = (target, source) => {
    if (!isObject(target) || !isObject(source)) {
        return clone(source);
    }
    const result = clone(target);
    for (const key of Object.keys(source)) {
        result[key] = key in target && isObject(target[key]) && isObject(source[key])
            ? oldMerge(target[key], source[key])
            : clone(source[key]);
    }
    return result;
};

for (const preset of ["mainnet", "testnet"]) {
    check(`${preset} preset merges to the same values as Solar's deep merge`, () => {
        const dir = path.join(SOLAR_DIR, "packages/crypto/dist/networks", preset);
        const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        const raw = read("milestones.json").sort((a, b) => a.height - b.height);

        const expected = [raw[0]];
        for (let i = 1; i < raw.length; i++) {
            expected.push(oldMerge(expected[i - 1], raw[i]));
        }

        Managers.configManager.setConfig({
            network: read("network.json"),
            milestones: read("milestones.json"),
            exceptions: read("exceptions.json"),
            genesisBlock: read("genesisBlock.json"),
        });

        assert.deepStrictEqual(clone(Managers.configManager.getMilestones()), clone(expected));
        for (const milestone of expected) {
            assert.deepStrictEqual(clone(Managers.configManager.getMilestone(milestone.height)), clone(milestone));
        }
        return true;
    });
}

console.log(`SUMMARY 20-milestone-merge-replace: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
