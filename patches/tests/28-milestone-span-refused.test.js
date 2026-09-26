"use strict";

// Patch 28 milestone-span-refused.
// The block time and the number of active delegates are fixed from height 1: the multi-span machinery is
// out of the rules, and a milestone file that changes either after height 1 is refused at start. setConfig
// refuses any configuration whose merged blockTime or activeDelegates at some milestone differs from the
// value at height 1, with InvalidMilestoneConfigurationError naming the height and the key, and it requires
// both keys at height 1 as positive safe integers. The merged values are compared (patch 20 changed the merge
// semantics), so a later milestone that restates the same value is accepted. Solar 4.3.1 and the series without
// this patch load such files and run the multi-span code in slots.ts, which stays in place and now only sees
// one span.
// The values are the numbers that JSON.parse reads from the file: 8.0, 8e0 and 8.0000000000000001 are all the
// number 8 and are accepted, and 9007199254740993 reads as 2^53 and is refused. The checks marked "JSON text"
// parse their values from such text, so that a loader that reads the file differently (for example as u64) can
// be checked against them.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/28-milestone-span-refused.test.js
// DEVNET_CRYPTO may point at a generated network's crypto directory; when it exists its milestones must load.

const fs = require("fs");
const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const DEVNET_CRYPTO = process.env.DEVNET_CRYPTO || path.join(__dirname, "devnet-crypto");
const { Crypto, Errors, Managers } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));

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

// The height-1 milestone of the test template (see patches/README.md), with the given overrides; a key whose
// override is undefined is removed.
const heightOne = (overrides = {}) => {
    const milestone = {
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
        dynamicReward: { enabled: false },
        donations: {},
        ...overrides,
    };
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
            delete milestone[key];
        }
    }
    return milestone;
};

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

const accepted = (name, milestones, verify) =>
    check(`accepted: ${name}`, () => {
        configure(milestones);
        return verify ? verify() : true;
    });

// A refusal must be InvalidMilestoneConfigurationError and name the height and the key.
const refused = (name, milestones, height, key) =>
    check(`refused: ${name}`, () => {
        try {
            configure(milestones);
        } catch (error) {
            if (!(error instanceof Errors.InvalidMilestoneConfigurationError)) {
                return `threw ${error.constructor.name}: ${error.message}`;
            }
            for (const part of [`height: ${height}.`, key]) {
                if (!error.message.includes(part)) {
                    return `message "${error.message}" does not name "${part}"`;
                }
            }
            return true;
        }
        const cm = Managers.configManager;
        return `setConfig accepted it; blockTime ${cm.getMilestone(1).blockTime} -> ${cm.getMilestone(height).blockTime}, activeDelegates ${cm.getMilestone(1).activeDelegates} -> ${cm.getMilestone(height).activeDelegates}`;
    });

// A change of either key after height 1.

refused("blockTime 8, then 6 at 107", [heightOne(), { height: 107, blockTime: 6 }], 107, "blockTime");
refused("blockTime 8, then 10 at 100 (not a round start)", [heightOne(), { height: 100, blockTime: 10 }], 100, "blockTime");
refused("activeDelegates 53, then 51 at 107 (a round start, which Solar's own check allows)", [heightOne(), { height: 107, activeDelegates: 51 }], 107, "activeDelegates");
refused("activeDelegates 53, then 55 at 107", [heightOne(), { height: 107, activeDelegates: 55 }], 107, "activeDelegates");
refused("activeDelegates 53, 51 at 107, back to 53 at 158 (round starts)", [heightOne(), { height: 107, activeDelegates: 51 }, { height: 158, activeDelegates: 53 }], 107, "activeDelegates");
refused("a file that changes both: blockTime 10 at 107, activeDelegates 51 at 213", [heightOne(), { height: 107, blockTime: 10 }, { height: 213, activeDelegates: 51 }], 107, "blockTime");
refused("a later blockTime \"8\" (a string, not the number 8)", [heightOne(), { height: 50, blockTime: "8" }], 50, "blockTime");
refused("a later blockTime null", [heightOne(), { height: 50, blockTime: null }], 50, "blockTime");
refused("a later activeDelegates 53.5 (at a round start)", [heightOne(), { height: 107, activeDelegates: 53.5 }], 107, "activeDelegates");
// Solar's own check on the raw list (validateMilestones) still runs first and refuses a change of the delegate
// count outside a round start with its own message (unchanged).
refused("activeDelegates 53, then 51 at 100 (not a round start: Solar's own check, unchanged)", [heightOne(), { height: 100, activeDelegates: 51 }], 100, "The number of delegates can only be changed at the beginning of a new round");
refused("the first change is named when two milestones change", [heightOne(), { height: 50, blockTime: 6 }, { height: 60, blockTime: 4 }], 50, "blockTime");

// Both keys at height 1, as positive safe integers.

for (const [label, value] of [
    ["missing", undefined],
    ["0", 0],
    ["-8", -8],
    ["1.5", 1.5],
    ["\"8\"", "8"],
    ["null", null],
    ["2^53", 9007199254740992],
]) {
    refused(`blockTime ${label} at height 1`, [heightOne({ blockTime: value })], 1, "blockTime");
    refused(`activeDelegates ${label} at height 1`, [heightOne({ activeDelegates: value })], 1, "activeDelegates");
}

// JSON text: the number as JSON.parse reads it from the file.
refused("JSON text blockTime 9007199254740993 at height 1 (JSON.parse reads 2^53)", [heightOne(JSON.parse('{"blockTime": 9007199254740993}'))], 1, "blockTime");
refused("JSON text activeDelegates 9007199254740993 at height 1 (JSON.parse reads 2^53)", [heightOne(JSON.parse('{"activeDelegates": 9007199254740993}'))], 1, "activeDelegates");
refused("JSON text activeDelegates -0 at height 1", [heightOne(JSON.parse('{"activeDelegates": -0}'))], 1, "activeDelegates");

// Accepted: one value throughout, restated or not.

accepted("blockTime 8 restated at 107, activeDelegates 53 restated at 213", [heightOne(), { height: 107, blockTime: 8 }, { height: 213, activeDelegates: 53 }], () => {
    const cm = Managers.configManager;
    const next = cm.getNextMilestoneWithNewKey(1, "blockTime");
    const values = [1, 107, 150, 213, 300].map((h) => `${cm.getMilestone(h).blockTime}/${cm.getMilestone(h).activeDelegates}`).join(" ");
    return (!next.found && values === "8/53 8/53 8/53 8/53 8/53") || `values ${values}, next blockTime milestone ${JSON.stringify(next)}`;
});
accepted("a later milestone that changes other keys only", [heightOne(), { height: 100, reward: 0, transfer: { maximum: 128 } }]);
// The values below come from JSON text; each check also confirms the value that JSON.parse produced.
const readAs = (height, blockTime, activeDelegates) => () => {
    const milestone = Managers.configManager.getMilestone(height);
    return (milestone.blockTime === blockTime && milestone.activeDelegates === activeDelegates) || `blockTime/activeDelegates at ${height}: ${milestone.blockTime}/${milestone.activeDelegates}`;
};
accepted("JSON text blockTime 8e0 and activeDelegates 5.3e1 at height 1", [heightOne(JSON.parse('{"blockTime": 8e0, "activeDelegates": 5.3e1}'))], readAs(1, 8, 53));
accepted("JSON text blockTime 8.0 and activeDelegates 53.0 restated at 107", [heightOne(), JSON.parse('{"height": 107, "blockTime": 8.0, "activeDelegates": 53.0}')], readAs(107, 8, 53));
accepted("JSON text blockTime 8.0000000000000001 restated at 107 (JSON.parse reads 8)", [heightOne(), JSON.parse('{"height": 107, "blockTime": 8.0000000000000001}')], readAs(107, 8, 53));
accepted("blockTime and activeDelegates 2^53 - 1 at height 1 (the largest accepted)", [heightOne({ blockTime: 9007199254740991, activeDelegates: 9007199254740991 })]);
accepted("one span in slots.ts: slot 1,000 starts 8,000 s after the epoch", [heightOne(), { height: 107, blockTime: 8 }], () => {
    const lookup = (height) => Managers.configManager.getMilestone(height).blockTime;
    const time = Crypto.Slots.getSlotTime(lookup, 1000);
    return time === 8000 || `getSlotTime(1000) = ${time}`;
});
check("accepted: the merged list fed back to setConfig, as the pool and snapshot workers do", () => {
    configure([heightOne(), { height: 107, activeDelegates: 53 }, { height: 213, reward: 0 }]);
    const merged = JSON.parse(JSON.stringify(Managers.configManager.getMilestones()));
    configure(merged);
    return true;
});
for (const preset of ["mainnet", "testnet"]) {
    check(`accepted: the ${preset} preset`, () => {
        Managers.configManager.setFromPreset(preset);
        return true;
    });
}
if (fs.existsSync(path.join(DEVNET_CRYPTO, "milestones.json"))) {
    check(`accepted: the generated devnet milestones (${DEVNET_CRYPTO})`, () => {
        const read = (name) => JSON.parse(fs.readFileSync(path.join(DEVNET_CRYPTO, `${name}.json`), "utf8"));
        Managers.configManager.setConfig({ network: read("network"), milestones: read("milestones"), exceptions: {}, genesisBlock: read("genesisBlock") });
        return true;
    });
} else {
    console.log(`SKIP generated devnet milestones: ${DEVNET_CRYPTO}/milestones.json does not exist`);
}

console.log(`SUMMARY 28-milestone-span-refused: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
