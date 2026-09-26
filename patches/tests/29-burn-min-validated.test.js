"use strict";

// Patch 29 burn-min-validated.
// burn.txAmount, the smallest amount a burn transaction (2/0) may burn, is checked at start like
// burn.feeBasisPoints (patch 23): at every merged milestone it must be a non-negative safe integer, or setConfig
// throws InvalidMilestoneConfigurationError naming the height and burn.txAmount. Without the check a text
// value such as "2000000" (or a missing key) silently turns the burn transaction off: its handler is active
// only while typeof burn.txAmount === "number". The burn handler itself is not changed.
// The value is the number that JSON.parse reads from the file: 2000000.0 and 2e6 are 2000000, -0 is accepted as
// a zero minimum, and 9007199254740993 reads as 2^53 and is refused. The checks marked "JSON text" parse their
// value from such text, so that a loader that reads the file differently (for example as u64) can be checked
// against them.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/29-burn-min-validated.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Errors, Managers } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
const { Handlers } = require(path.join(SOLAR_DIR, "packages/transactions/dist"));

let passed = 0;
let failed = 0;
const check = async (name, fn) => {
    try {
        const detail = await fn();
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

// The height-1 milestone of the test template (see patches/README.md) with the given burn object.
const heightOne = (burn) => ({
    height: 1,
    activeDelegates: 53,
    block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
    blocksToRevokeDelegateResignation: 106,
    blockTime: 8,
    burn,
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
});

const withTxAmount = (txAmount) => {
    const burn = { feeBasisPoints: 9000, txAmount };
    if (txAmount === undefined) {
        delete burn.txAmount;
    }
    return burn;
};

const configure = (milestones) =>
    Managers.configManager.setConfig({ network, milestones, exceptions: {}, genesisBlock: { transactions: [] } });

// The burn transaction's handler, as the node asks it at the given height.
const burnActive = async (height) => {
    const handler = Object.create(Handlers.Solar.BurnTransactionHandler.prototype);
    return Managers.configManager.runAtHeight(height, () => handler.isActivated());
};

const accepted = (name, milestones, verify) =>
    check(`accepted: ${name}`, async () => {
        configure(milestones);
        return verify ? verify() : true;
    });

// A refusal must be InvalidMilestoneConfigurationError and name the height and burn.txAmount. When the file
// loads instead (the base), the detail shows whether the burn transaction is still active.
const refused = (name, milestones, height) =>
    check(`refused: ${name}`, async () => {
        try {
            configure(milestones);
        } catch (error) {
            if (!(error instanceof Errors.InvalidMilestoneConfigurationError)) {
                return `threw ${error.constructor.name}: ${error.message}`;
            }
            for (const part of [`height: ${height}.`, "burn.txAmount"]) {
                if (!error.message.includes(part)) {
                    return `message "${error.message}" does not name "${part}"`;
                }
            }
            return true;
        }
        const value = Managers.configManager.getMilestone(height).burn.txAmount;
        return `setConfig accepted it; txAmount at ${height} is ${typeof value === "number" ? value : JSON.stringify(value)} and the burn transaction is ${
            (await burnActive(height)) ? "active" : "silently off"
        }`;
    });

const main = async () => {
    // Refused at height 1.
    for (const [label, value] of [
        ["\"2000000\" (text)", "2000000"],
        ["1.5", 1.5],
        ["-1", -1],
        ["NaN", NaN],
        ["null", null],
        ["missing", undefined],
        ["Infinity", Infinity],
        ["2^53", 9007199254740992],
        ["JSON text 9007199254740993 (JSON.parse reads 2^53)", JSON.parse("9007199254740993")],
        ["true", true],
        ["{}", {}],
    ]) {
        await refused(`txAmount ${label} at height 1`, [heightOne(withTxAmount(value))], 1);
    }

    // Refused at a later milestone, where the merged value is bad.
    await refused("a later txAmount \"3000000\"", [heightOne(withTxAmount(2000000)), { height: 100, burn: { txAmount: "3000000" } }], 100);
    await refused("a later txAmount null", [heightOne(withTxAmount(2000000)), { height: 100, burn: { txAmount: null } }], 100);
    await refused("a later txAmount -5", [heightOne(withTxAmount(2000000)), { height: 100, burn: { txAmount: -5 } }], 100);

    // Accepted.
    await accepted("txAmount 2000000", [heightOne(withTxAmount(2000000))], async () => (await burnActive(1)) || "the burn transaction is off");
    await accepted("txAmount 0", [heightOne(withTxAmount(0))], async () => (await burnActive(1)) || "the burn transaction is off");
    await accepted("txAmount 2^53 - 1", [heightOne(withTxAmount(9007199254740991))]);
    // JSON text: the value as JSON.parse reads it; the burn transaction stays active with the minimum it read.
    for (const [text, expected] of [
        ["2000000.0", 2000000],
        ["2e6", 2000000],
        ["-0", 0],
    ]) {
        await accepted(`JSON text txAmount ${text}`, [heightOne(withTxAmount(JSON.parse(text)))], async () => {
            const value = Managers.configManager.getMilestone(1).burn.txAmount;
            if (value !== expected) {
                return `txAmount read as ${value}`;
            }
            return (await burnActive(1)) || "the burn transaction is off";
        });
    }
    await accepted("a later milestone that sets only feeBasisPoints keeps txAmount (merged)", [
        heightOne(withTxAmount(2000000)),
        { height: 100, burn: { feeBasisPoints: 5000 } },
    ], () => {
        const burn = Managers.configManager.getMilestone(150).burn;
        return (burn.txAmount === 2000000 && burn.feeBasisPoints === 5000) || `burn at 150 is ${JSON.stringify(burn)}`;
    });
    await accepted("a later txAmount 3000000", [heightOne(withTxAmount(2000000)), { height: 100, burn: { txAmount: 3000000 } }], () => {
        const values = [99, 100].map((h) => Managers.configManager.getMilestone(h).burn.txAmount).join(",");
        return values === "2000000,3000000" || `txAmount at 99 and 100: ${values}`;
    });
    for (const preset of ["mainnet", "testnet"]) {
        await check(`accepted: the ${preset} preset`, async () => {
            Managers.configManager.setFromPreset(preset);
            return true;
        });
    }

    console.log(`SUMMARY 29-burn-min-validated: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
    console.log(`FAIL test harness: ${error && error.stack}`);
    process.exit(1);
});
