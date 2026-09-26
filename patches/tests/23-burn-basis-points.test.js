"use strict";

// Patch 23 burn-basis-points (L-97 (5), L-26 as amended by L-97).
// The fee burn is floor(fee x burn.feeBasisPoints / 10000), and setConfig refuses a milestone whose burn
// is missing, whose feeBasisPoints is not a safe integer from 0 to 10000, or which still has feePercent.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/23-burn-basis-points.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Errors, Managers, Transactions, Utils } = require(path.join(SOLAR_DIR, "packages/crypto/dist"));

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

const RECIPIENT = "dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokA";

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

const heightOne = (burn) => {
    const milestone = {
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
        donations: {},
    };
    if (burn === undefined) {
        delete milestone.burn;
    }
    return milestone;
};

const configure = (burn, later = []) =>
    Managers.configManager.setConfig({
        network,
        milestones: [heightOne(burn), ...later],
        exceptions: {},
        genesisBlock: { transactions: [] },
    });

configure({ feeBasisPoints: 9000, txAmount: 2000000 });
const transaction = Transactions.BuilderFactory.transfer()
    .fee("1000026")
    .nonce("1")
    .addTransfer(RECIPIENT, "1")
    .sign("g2 patch 23 test sender")
    .build();

const burned = (fee, height = 1) => {
    transaction.data.fee = Utils.BigNumber.make(fee);
    transaction.setBurnedFee(height);
    return String(transaction.data.burnedFee);
};

check("fee 1,000,026 burns 900,023", () => {
    configure({ feeBasisPoints: 9000, txAmount: 2000000 });
    return burned("1000026") === "900023" || `burned ${burned("1000026")}`;
});

check("fee 7,500,411,055 burns 6,750,369,949", () => {
    configure({ feeBasisPoints: 9000, txAmount: 2000000 });
    return burned("7500411055") === "6750369949" || `burned ${burned("7500411055")}`;
});

check("9000 basis points equal Solar's floor(fee x 90 / 100) for fees 0 to 2,000,000 in steps of 7", () => {
    configure({ feeBasisPoints: 9000, txAmount: 2000000 });
    let differences = 0;
    let count = 0;
    for (let fee = 0; fee <= 2000000; fee += 7) {
        count++;
        if (burned(fee) !== String((BigInt(fee) * 90n) / 100n)) {
            differences++;
        }
    }
    return differences === 0 || `${differences} differences in ${count} fees`;
});

check("0 and 10000 basis points burn nothing and everything", () => {
    configure({ feeBasisPoints: 0, txAmount: 2000000 });
    const none = burned("1000026");
    configure({ feeBasisPoints: 10000, txAmount: 2000000 });
    const all = burned("1000026");
    return (none === "0" && all === "1000026") || `burned ${none} and ${all}`;
});

check("a later milestone changes the burn from its height", () => {
    configure({ feeBasisPoints: 9000, txAmount: 2000000 }, [{ height: 100, burn: { feeBasisPoints: 5000 } }]);
    const got = `${burned("1000026", 99)},${burned("1000026", 100)}`;
    return got === "900023,500013" || `heights 99, 100 burned ${got}`;
});

const refused = (name, burn, messagePart, later = []) =>
    check(`refused: ${name}`, () => {
        try {
            configure(burn, later);
        } catch (error) {
            if (!(error instanceof Errors.InvalidMilestoneConfigurationError)) {
                return `threw ${error.constructor.name}: ${error.message}`;
            }
            if (messagePart && !error.message.includes(messagePart)) {
                return `message "${error.message}" does not name "${messagePart}"`;
            }
            return true;
        }
        return `setConfig accepted it; a fee of 1,000,026 burned ${burned("1000026")}`;
    });

refused("feeBasisPoints '9000'", { feeBasisPoints: "9000", txAmount: 2000000 }, "feeBasisPoints");
refused("feeBasisPoints 90.5", { feeBasisPoints: 90.5, txAmount: 2000000 }, "feeBasisPoints");
refused("feeBasisPoints -1", { feeBasisPoints: -1, txAmount: 2000000 }, "feeBasisPoints");
refused("feeBasisPoints 10001", { feeBasisPoints: 10001, txAmount: 2000000 }, "feeBasisPoints");
refused("a missing burn", undefined, "burn");
refused("burn: null", null, "burn");
refused("feePercent: 90", { feePercent: 90, txAmount: 2000000 }, "feeBasisPoints");
refused("feePercent: '90' (Solar accepts it and burns 0)", { feePercent: "90", txAmount: 2000000 }, "feeBasisPoints");
refused("a bad value at a later height", { feeBasisPoints: 9000, txAmount: 2000000 }, "height: 100", [
    { height: 100, burn: { feeBasisPoints: "4500" } },
]);

for (const preset of ["mainnet", "testnet"]) {
    check(`the ${preset} preset loads and burns 90 %`, () => {
        Managers.configManager.setFromPreset(preset);
        return burned("1000026") === "900023" || `burned ${burned("1000026")}`;
    });
}

console.log(`SUMMARY 23-burn-basis-points: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
