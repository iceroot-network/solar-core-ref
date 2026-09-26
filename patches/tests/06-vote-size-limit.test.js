#!/usr/bin/env node
// Patch 06 vote-size-limit.
// The 1,024-byte limit on the vote asset is an explicit rule. serialise() computes the asset
// size, 1 + sum(3 + byteLength(name)), and deserialise() measures the bytes it consumed; both
// throw VoteAssetTooLargeError ("Vote asset is <size> bytes, over the 1024-byte limit") above
// 1,024 bytes. Solar 4.3.1 had the same limit hidden in a fixed Buffer.alloc(1024), so the set
// of valid votes is unchanged: exactly 1,024 bytes stays valid.
//
// Golden values: 44 names of 20 characters plus one of 8 give an asset of exactly 1,024 bytes;
// with the last name at 9 characters the asset is 1,025 bytes.
//
// TransactionFactory.fromBytes wraps every decode error other than a few schema and version
// errors in InvalidTransactionBytesError, so on that path the check looks for the
// VoteAssetTooLargeError message inside the wrapped message, and checks the class on
// Deserialiser.deserialise, the decode step that fromBytes runs.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/06-vote-size-limit.test.js
// Exit code 0 when every check passes, 1 otherwise.
"use strict";

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");

let failed = 0;
let passed = 0;
const pass = (name) => {
    passed++;
    console.log(`PASS ${name}`);
};
const fail = (name, detail) => {
    failed++;
    console.log(`FAIL ${name}: ${detail}`);
};
const check = async (name, fn) => {
    try {
        const detail = await fn();
        if (detail === true) {
            pass(name);
        } else {
            fail(name, detail);
        }
    } catch (error) {
        fail(
            name,
            `threw ${error && error.constructor ? error.constructor.name : typeof error}: ${error && error.message}`,
        );
    }
};

const devnetConfig = () => ({
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
            blockTime: 8,
            block: { version: 0, maxTransactions: 150, maxPayload: 2097152 },
            blocksToRevokeDelegateResignation: 106,
            epoch: "2026-09-25T20:05:04.000Z",
            reward: 0,
            burn: { feeBasisPoints: 9000, txAmount: 2000000 },
            donations: {},
            fees: { staticFees: { vote: 9000000 } },
            legacyTransfer: false,
            legacyVote: false,
            acceptLegacySchnorrTransactions: false,
            bip340: true,
        },
    ],
    genesisBlock: { transactions: [] },
    exceptions: {},
});

// 44 names of 20 characters at 2.25 % each (225 basis points) and one last name at 1 %.
// 44 x 225 + 100 = 10,000 basis points; the float sum is exact too.
const makeVotes = (lastName) => {
    const votes = {};
    for (let i = 1; i <= 44; i++) {
        votes[`v${String(i).padStart(19, "0")}`] = 2.25;
    }
    votes[lastName] = 1;
    return votes;
};

// The asset bytes as Solar writes them: count, then per vote a length byte, the name and a u16 LE.
const assetBytes = (votes) => {
    const parts = [Buffer.from([Object.keys(votes).length])];
    for (const [name, percent] of Object.entries(votes)) {
        const basisPoints = Buffer.alloc(2);
        basisPoints.writeUInt16LE(Math.round(percent * 100));
        parts.push(Buffer.from([Buffer.byteLength(name)]), Buffer.from(name), basisPoints);
    }
    return Buffer.concat(parts);
};

const LIMIT_MESSAGE = "Vote asset is 1025 bytes, over the 1024-byte limit";

const main = async () => {
    let Crypto;
    try {
        Crypto = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
    } catch (error) {
        fail("load Solar packages", error.message);
        return;
    }

    Crypto.Managers.configManager.setConfig(devnetConfig());
    Crypto.Managers.configManager.setHeight(1);

    const { BuilderFactory, Deserialiser, TransactionFactory } = Crypto.Transactions;
    const { VoteAssetTooLargeError, InvalidTransactionBytesError, CryptoError } = Crypto.Errors;
    const passphrase = "patch 06 vote sender";

    const votes1024 = makeVotes("lastname"); // last name: 8 characters
    const votes1025 = makeVotes("lastnames"); // last name: 9 characters
    const sorted1024 = Crypto.Utils.sortVotes(votes1024);
    const sorted1025 = Crypto.Utils.sortVotes(votes1025);

    await check("golden sizes: the assets are 1,024 and 1,025 bytes", () => {
        const a = assetBytes(sorted1024).length;
        const b = assetBytes(sorted1025).length;
        return a === 1024 && b === 1025 ? true : `sizes ${a} and ${b}`;
    });

    await check("VoteAssetTooLargeError is exported from crypto Errors as a CryptoError", () => {
        if (typeof VoteAssetTooLargeError !== "function") {
            return "Errors.VoteAssetTooLargeError is missing";
        }
        const error = new VoteAssetTooLargeError(1025);
        if (!(error instanceof CryptoError)) {
            return "not a CryptoError";
        }
        return error.message === LIMIT_MESSAGE ? true : `message: ${error.message}`;
    });

    let transaction1024;
    await check("a 1,024-byte vote asset builds, and the asset bytes are in the transaction", () => {
        transaction1024 = BuilderFactory.vote().votesAsset(votes1024).nonce("1").network(90).sign(passphrase).build();
        return transaction1024.serialised.includes(assetBytes(sorted1024)) ? true : "asset bytes not found";
    });

    await check("the 1,024-byte vote round-trips through strict fromBytes", () => {
        const decoded = TransactionFactory.fromBytes(transaction1024.serialised, true);
        if (JSON.stringify(decoded.data.asset.votes) !== JSON.stringify(sorted1024)) {
            return `decoded votes differ: ${JSON.stringify(decoded.data.asset.votes)}`;
        }
        if (decoded.id !== transaction1024.id) {
            return `id changed: ${transaction1024.id} -> ${decoded.id}`;
        }
        return decoded.isVerified === true ? true : "signature did not verify";
    });

    await check("building a 1,025-byte vote asset throws VoteAssetTooLargeError mentioning 1025", () => {
        try {
            BuilderFactory.vote().votesAsset(votes1025).nonce("1").network(90).sign(passphrase).build();
        } catch (error) {
            if (typeof VoteAssetTooLargeError !== "function" || !(error instanceof VoteAssetTooLargeError)) {
                return `got ${error.constructor.name}: ${error.message}`;
            }
            return error.message === LIMIT_MESSAGE ? true : `message: ${error.message}`;
        }
        return "built without an error";
    });

    // Hand-made bytes: the valid 1,024-byte transaction with its asset replaced by the 1,025-byte one.
    const handMade = () => {
        const bytes = transaction1024.serialised;
        const oldAsset = assetBytes(sorted1024);
        const offset = bytes.indexOf(oldAsset);
        if (offset < 0) {
            throw new Error("asset bytes not found in the 1,024-byte transaction");
        }
        return Buffer.concat([bytes.slice(0, offset), assetBytes(sorted1025), bytes.slice(offset + oldAsset.length)]);
    };

    await check("decoding a 1,025-byte vote asset throws VoteAssetTooLargeError mentioning 1025", () => {
        try {
            Deserialiser.deserialise(handMade());
        } catch (error) {
            if (typeof VoteAssetTooLargeError !== "function" || !(error instanceof VoteAssetTooLargeError)) {
                return `got ${error.constructor.name}: ${error.message}`;
            }
            return error.message === LIMIT_MESSAGE ? true : `message: ${error.message}`;
        }
        return "decoded without an error";
    });

    await check("strict fromBytes rejects the 1,025-byte vote asset with the VoteAssetTooLargeError message", () => {
        try {
            TransactionFactory.fromBytes(handMade(), true);
        } catch (error) {
            if (!(error instanceof InvalidTransactionBytesError)) {
                return `got ${error.constructor.name}: ${error.message}`;
            }
            const expected = `Failed to deserialise transaction, encountered invalid bytes: ${LIMIT_MESSAGE}`;
            return error.message === expected ? true : `message: ${error.message}`;
        }
        return "decoded without an error";
    });
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
