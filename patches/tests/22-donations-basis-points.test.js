"use strict";

// Patch 22 donations-basis-points.
// Donations are integer basis points, paid as floor(reward x basisPoints / 10000), and the merged
// milestones are validated in setConfig, so a bad donation list refuses to start.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/22-donations-basis-points.test.js

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

const P1 = "dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokA"; // byte 90
const P2 = "dPiLD2Fi1dnQhnskBkSnDEPraaWtbTcYPj"; // byte 90
const BAD_CHECKSUM = "dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokB"; // P1 with the last character changed
const BYTE_30 = "DSXP3m8MJhqZvybUMCnUkfAP5PQ4aVjozy"; // a valid testnet (byte 30) address

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
    donations: {},
});

const configure = (donations) =>
    Managers.configManager.setConfig({
        network,
        milestones: [heightOne(), { height: 2, donations }],
        exceptions: {},
        genesisBlock: { transactions: [] },
    });

check("5 % of every IceRoot reward tier, per recipient", () => {
    configure({ [P1]: { basisPoints: 500, purpose: "purpose-a" }, [P2]: { basisPoints: 500, purpose: "purpose-b" } });
    const got = [180000000, 190000000, 200000000, 210000000, 220000000].map((reward) => {
        const donations = Utils.calculateDonations(2, Utils.BigNumber.make(reward));
        return `${donations[P1]}/${donations[P2]}`;
    });
    const expected = ["9000000/9000000", "9500000/9500000", "10000000/10000000", "10500000/10500000", "11000000/11000000"];
    return got.join(" ") === expected.join(" ") || `got ${got.join(" ")}`;
});

check("the payout is floored", () => {
    configure({ [P1]: { basisPoints: 3333 } });
    const donation = String(Utils.calculateDonations(2, Utils.BigNumber.make(100000001))[P1]);
    return donation === "33330000" || `floor(100000001 x 3333 / 10000) gave ${donation}, expected 33330000`;
});

const refused = (name, donations, messagePart) =>
    check(`refused: ${name}`, () => {
        try {
            configure(donations);
        } catch (error) {
            if (!(error instanceof Errors.InvalidMilestoneConfigurationError)) {
                return `threw ${error.constructor.name}: ${error.message}`;
            }
            if (messagePart && !error.message.includes(messagePart)) {
                return `message "${error.message}" does not name "${messagePart}"`;
            }
            return true;
        }
        return "setConfig accepted it";
    });

refused("a sum of 10001", { [P1]: { basisPoints: 5001 }, [P2]: { basisPoints: 5000 } }, "10001");
refused("an entry null", { [P1]: null });
refused("basisPoints '500'", { [P1]: { basisPoints: "500" } }, "basisPoints");
refused("basisPoints NaN", { [P1]: { basisPoints: NaN } }, "basisPoints");
refused("basisPoints 0", { [P1]: { basisPoints: 0 } }, "basisPoints");
refused("basisPoints 1.5", { [P1]: { basisPoints: 1.5 } }, "basisPoints");
refused("basisPoints 10001", { [P1]: { basisPoints: 10001 } }, "basisPoints");
refused("an unknown key", { [P1]: { basisPoints: 500, share: 5 } }, "share");
refused("a leftover percent", { [P1]: { percent: 5, purpose: "development" } }, "basisPoints");
refused("an address with a bad checksum", { [BAD_CHECKSUM]: { basisPoints: 500 } }, BAD_CHECKSUM);
refused("a byte-30 address on a byte-90 network", { [BYTE_30]: { basisPoints: 500 } }, BYTE_30);
refused("donations: null", null, "donations");
refused("donations as an array", [], "donations");
refused("a purpose that is not a string", { [P1]: { basisPoints: 500, purpose: 5 } }, "purpose");

check("accepted: donations {}", () => {
    configure({});
    const donations = Utils.calculateDonations(2, Utils.BigNumber.make(200000000));
    return Object.keys(donations).length === 0 || `calculateDonations gave ${JSON.stringify(donations)}`;
});

check("accepted: a sum of exactly 10000", () => {
    configure({ [P1]: { basisPoints: 5000 }, [P2]: { basisPoints: 5000, purpose: "purpose-b" } });
    const donations = Utils.calculateDonations(2, Utils.BigNumber.make(200000000));
    return (String(donations[P1]) === "100000000" && String(donations[P2]) === "100000000") || `gave ${donations[P1]}/${donations[P2]}`;
});

check("the mainnet preset loads and pays 5 % to each recipient", () => {
    Managers.configManager.setFromPreset("mainnet");
    const donations = Utils.calculateDonations(1812866, Utils.BigNumber.make(1000000000));
    const got = Object.entries(donations).map(([address, amount]) => `${address}=${amount}`).join(",");
    const expected = "Sgymbo4rg9aBeJJ2YmV12xdRY2xo6b94U9=50000000,Sdao2USyAz9B6RBgZeFyNDePuQAxfzZZHE=50000000";
    return got === expected || `got ${got}`;
});

check("the testnet preset loads and pays 5 % to each recipient", () => {
    Managers.configManager.setFromPreset("testnet");
    const donations = Utils.calculateDonations(502431, Utils.BigNumber.make(1000000000));
    const got = Object.entries(donations).map(([address, amount]) => `${address}=${amount}`).join(",");
    const expected = "DSXP3m8MJhqZvybUMCnUkfAP5PQ4aVjozy=50000000,D646b6dx3sW5NAgMDTKAZ2hdC57K1BeRaK=50000000";
    return got === expected || `got ${got}`;
});

console.log(`SUMMARY 22-donations-basis-points: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
