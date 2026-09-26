#!/usr/bin/env node
// Patch 44 block-signature-bip340-only.
//
// Block.verifySignature() always verifies a BIP340 signature and no longer reads the milestone's
// bip340 flag, so a block signed with legacy Schnorr is invalid even under bip340: false. Patch 24
// is the signing half (BlockFactory.make always signs BIP340).
//
// Usage: SOLAR_DIR=<built Solar checkout> node 44-block-signature-bip340-only.test.js
"use strict";

const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));

const load = (pkg) => require(path.join(SOLAR_DIR, "packages", pkg, "dist"));
const { Blocks, Crypto, Identities, Managers, Utils } = load("crypto");
const { BigNumber } = Utils;

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        const outcome = fn();
        if (outcome === true) {
            passed++;
            console.log(`PASS ${name}`);
        } else {
            failed++;
            console.log(`FAIL ${name}: ${outcome}`);
        }
    } catch (error) {
        failed++;
        console.log(`FAIL ${name}: threw ${error && error.message}`);
    }
}

// Network configuration template (see patches/README.md), with the bip340 flag under test.
function makeConfig(bip340) {
    return {
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
                block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
                blocksToRevokeDelegateResignation: 106,
                blockTime: 8,
                burn: { feeBasisPoints: 9000, txAmount: 2000000 },
                epoch: "2026-01-01T00:00:00.000Z",
                legacyTransfer: false,
                legacyVote: false,
                transfer: { maximum: 256, minimum: 1 },
                reward: 0,
                acceptLegacySchnorrTransactions: false,
                bip340,
                donations: {},
            },
        ],
        genesisBlock: { transactions: [] },
        exceptions: {},
    };
}

const FORGER = Identities.Keys.fromPassphrase("patch 44 forger");
const AUX = Buffer.alloc(32, 9);

// An empty block at height 2, signed over its header hash with the given scheme.
function signedBlock(scheme) {
    const data = {
        version: 0,
        timestamp: 1000,
        height: 2,
        previousBlock: "fbdd5afb435e34729406ebc7d385727237bf386440799270536c39b9ee45605e",
        numberOfTransactions: 0,
        totalAmount: BigNumber.ZERO,
        totalFee: BigNumber.ZERO,
        reward: BigNumber.ZERO,
        payloadLength: 0,
        payloadHash: Crypto.HashAlgorithms.sha256([]).toString("hex"),
        generatorPublicKey: FORGER.publicKey.secp256k1,
        transactions: [],
    };
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(data, false));
    data.blockSignature =
        scheme === "legacy"
            ? Crypto.Hash.signSchnorrLegacy(hash, FORGER)
            : Crypto.Hash.signSchnorrBip340(hash, FORGER, AUX);
    data.id = Blocks.Block.getId(data);
    return Blocks.BlockFactory.fromData(data);
}

const verified = (block) =>
    block.verification.verified ? true : `errors: ${JSON.stringify(block.verification.errors)}`;
const signatureRejected = (block) => {
    const errors = block.verification.errors.map(String);
    if (block.verification.verified) {
        return "verified";
    }
    if (block.verifySignature() !== false) {
        return "verifySignature() is not false";
    }
    return errors.length === 1 && errors[0] === "Failed to verify block signature"
        ? true
        : `errors: ${JSON.stringify(errors)}`;
};

console.log(`SOLAR_DIR=${SOLAR_DIR}`);

Managers.configManager.setConfig(makeConfig(false));
check(
    'bip340: false, legacy Schnorr block signature: fails with "Failed to verify block signature" (base: verifies)',
    () => signatureRejected(signedBlock("legacy")),
);
check("bip340: false, BIP340 block signature: verifies (base: fails)", () => verified(signedBlock("bip340")));

Managers.configManager.setConfig(makeConfig(true));
check("bip340: true, BIP340 block signature: verifies", () => verified(signedBlock("bip340")));
check('bip340: true, legacy Schnorr block signature: fails with "Failed to verify block signature"', () =>
    signatureRejected(signedBlock("legacy")),
);

console.log(`44-block-signature-bip340-only: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
