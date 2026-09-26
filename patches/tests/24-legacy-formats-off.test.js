"use strict";

// Patch 24 legacy-formats-off (L-43, L-57 removals, L-51).
// Only version 3 transactions are supported, whatever acceptLegacySchnorrTransactions and bip340 say,
// and BlockFactory.make always signs with BIP340.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/24-legacy-formats-off.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Blocks, Crypto, Errors, Identities, Managers, Transactions, Utils } = require(path.join(
    SOLAR_DIR,
    "packages/crypto/dist",
));

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
const SENDER = "g2 patch 24 test sender";
const FORGER = "g2 patch 24 test forger";

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

// The legacy formats are switched on in the milestone; the patched reference ignores both flags.
Managers.configManager.setConfig({
    network,
    milestones: [
        {
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
            bip340: false,
            acceptLegacySchnorrTransactions: true,
            donations: {},
        },
    ],
    exceptions: {},
    genesisBlock: { transactions: [] },
});
Managers.configManager.setHeight(2);

const transfer = (version) => {
    const builder = Transactions.BuilderFactory.transfer();
    if (version) {
        builder.version(version);
    }
    return builder.fee("50000000").nonce("1").addTransfer(RECIPIENT, "100").sign(SENDER).build();
};

check("a version 2 transfer fails strict fromBytes with TransactionVersionError", () => {
    const serialised = transfer(2).serialised;
    try {
        const transaction = Transactions.TransactionFactory.fromBytes(serialised);
        return `accepted (version ${transaction.data.version}, verified ${transaction.isVerified})`;
    } catch (error) {
        return error instanceof Errors.TransactionVersionError || `threw ${error.constructor.name}: ${error.message}`;
    }
});

check("a version 2 transfer fails strict fromData with TransactionVersionError", () => {
    const data = transfer(2).toJson();
    try {
        Transactions.TransactionFactory.fromJson(data);
        return "accepted";
    } catch (error) {
        return error instanceof Errors.TransactionVersionError || `threw ${error.constructor.name}: ${error.message}`;
    }
});

check("isSupportedTransactionVersion is true for 3 only", () => {
    const got = [1, 2, 3, 4].map((version) => Utils.isSupportedTransactionVersion(version)).join(",");
    return got === "false,false,true,false" || `versions 1-4 gave ${got}`;
});

check("a version 3 transfer is still accepted", () => {
    const transaction = Transactions.TransactionFactory.fromBytes(transfer().serialised);
    return (transaction.data.version === 3 && transaction.isVerified === true) || `version ${transaction.data.version}, verified ${transaction.isVerified}`;
});

check("BlockFactory.make signs with BIP340 under bip340: false", () => {
    const keys = Identities.Keys.fromPassphrase(FORGER);
    const block = Blocks.BlockFactory.make(
        {
            version: 0,
            timestamp: 16,
            height: 2,
            previousBlock: "a".repeat(64),
            numberOfTransactions: 0,
            totalAmount: Utils.BigNumber.ZERO,
            totalFee: Utils.BigNumber.ZERO,
            reward: Utils.BigNumber.ZERO,
            payloadLength: 0,
            payloadHash: Crypto.HashAlgorithms.sha256(Buffer.alloc(0)).toString("hex"),
            transactions: [],
        },
        keys,
        Buffer.alloc(32, 7),
    );
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(block.data, false));
    const { blockSignature, generatorPublicKey } = block.data;
    const bip340 = Crypto.Hash.verifySchnorr(hash, blockSignature, generatorPublicKey, true);
    const legacy = Crypto.Hash.verifySchnorr(hash, blockSignature, generatorPublicKey, false);
    return (bip340 && !legacy) || `BIP340 verify ${bip340}, legacy Schnorr verify ${legacy}`;
});

console.log(`SUMMARY 24-legacy-formats-off: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
