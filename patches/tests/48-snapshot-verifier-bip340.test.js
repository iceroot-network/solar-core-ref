#!/usr/bin/env node
// Patch 48 snapshot-verifier-bip340.
//
// The snapshot verifier (snapshot:verify, snapshot:restore) checks a block's signature with
// Block.verifySignature(), the block rule itself, which is BIP340 only since patch 44. In s1-ref-v1 it
// still chose legacy Schnorr or BIP340 from the milestone's bip340 flag, so under bip340: false it
// accepted a legacy-Schnorr block signature that the node rejects, and refused a BIP340 one.
//
// Usage: SOLAR_DIR=<built Solar checkout> node 48-snapshot-verifier-bip340.test.js
"use strict";

const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));

const load = (pkg, sub = "") => require(path.join(SOLAR_DIR, "packages", pkg, "dist", sub));
const { Blocks, Crypto, Identities, Managers, Utils } = load("crypto");
const { Verifier } = load("snapshots", "verifier");
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

const FORGER = Identities.Keys.fromPassphrase("patch 48 forger");
const AUX = Buffer.alloc(32, 8);

// A block row as the snapshot reader gives it to the verifier: an empty block at height 2, its header
// hash signed with the given scheme.
function blockEntity(scheme, timestamp = 1000) {
    const data = {
        version: 0,
        timestamp,
        height: 2,
        previousBlock: "fbdd5afb435e34729406ebc7d385727237bf386440799270536c39b9ee45605e",
        numberOfTransactions: 0,
        totalAmount: BigNumber.ZERO,
        totalFee: BigNumber.ZERO,
        reward: BigNumber.ZERO,
        payloadLength: 0,
        payloadHash: Crypto.HashAlgorithms.sha256([]).toString("hex"),
        generatorPublicKey: FORGER.publicKey.secp256k1,
    };
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(data, false));
    data.blockSignature =
        scheme === "legacy"
            ? Crypto.Hash.signSchnorrLegacy(hash, FORGER)
            : Crypto.Hash.signSchnorrBip340(hash, FORGER, AUX);
    data.id = Blocks.Block.getId(data);
    return data;
}

const accepted = (entity) => {
    Verifier.verifyBlock(entity, undefined);
    return true;
};
const refused = (entity) => {
    try {
        Verifier.verifyBlock(entity, undefined);
    } catch (error) {
        return error.message === `Block with id ${entity.id} could not be verified. `
            ? true
            : `refused with "${error.message}"`;
    }
    return "accepted";
};

console.log(`SOLAR_DIR=${SOLAR_DIR}`);

Managers.configManager.setConfig(makeConfig(false));
check("bip340: false, legacy Schnorr block signature: the snapshot verifier refuses it (base: accepts)", () =>
    refused(blockEntity("legacy")),
);
check("bip340: false, BIP340 block signature: the snapshot verifier accepts it (base: refuses)", () =>
    accepted(blockEntity("bip340")),
);
check("bip340: false, the verifier agrees with Block.verifySignature() on both", () => {
    const legacy = Blocks.BlockFactory.fromData(blockEntity("legacy")).verifySignature();
    const bip340 = Blocks.BlockFactory.fromData(blockEntity("bip340")).verifySignature();
    return legacy === false && bip340 === true ? true : `verifySignature legacy ${legacy}, bip340 ${bip340}`;
});

Managers.configManager.setConfig(makeConfig(true));
check("bip340: true, BIP340 block signature: accepted (unchanged)", () => accepted(blockEntity("bip340")));
check("bip340: true, legacy Schnorr block signature: refused (unchanged)", () => refused(blockEntity("legacy")));
check("bip340: true, a BIP340 signature over another header: refused (unchanged)", () => {
    const entity = blockEntity("bip340");
    entity.blockSignature = blockEntity("bip340", 1008).blockSignature;
    return refused(entity);
});

console.log(`48-snapshot-verifier-bip340: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
