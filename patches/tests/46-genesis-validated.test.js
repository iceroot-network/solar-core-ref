#!/usr/bin/env node
// Patch 46 genesis-validated.
//
// DatabaseInteraction.initialise() now checks the configured genesis block before it uses it: the
// block must pass Block.verify() (patches 43 and 44 included), apart from the wall-clock timestamp
// check, and every genesis transaction's type must be active at height 1 (patches 01 and 02). An
// invalid genesis terminates the node with "Invalid genesis block" and exits the process with code 1.
// A genesis that BlockFactory.fromJson cannot decode (for example a transaction whose JSON id does not
// match its bytes) is refused the same way, and the exit is in a finally around the terminate, so a
// terminate that throws still exits. In s1-ref-v1 the genesis was decoded with BlockFactory.fromJson and
// used unchecked. process.exit is stubbed here: the stub records the code and throws, so the test
// process survives.
//
// Usage: SOLAR_DIR=<built Solar checkout> node 46-genesis-validated.test.js
// DEVNET_CRYPTO may point at a generated network's crypto directory (network.json, milestones.json,
// genesisBlock.json); when it exists the real genesis must pass too.
"use strict";

const fs = require("fs");
const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));
const DEVNET_CRYPTO = process.env.DEVNET_CRYPTO || path.join(__dirname, "devnet-crypto");

const load = (pkg) => require(path.join(SOLAR_DIR, "packages", pkg, "dist"));
const { Blocks, Crypto, Identities, Managers, Transactions, Utils } = load("crypto");
const { Handlers } = load("transactions");
const { DatabaseInteraction } = load("state");
const { BigNumber } = Utils;

let passed = 0;
let failed = 0;

async function check(name, fn) {
    try {
        const outcome = await fn();
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

// Network configuration template (see patches/README.md), with the genesis block under test.
function makeConfig(genesisBlock, epoch = "2026-01-01T00:00:00.000Z", pubKeyHash = 90) {
    return {
        network: {
            name: "devnet",
            messagePrefix: "Solar devnet message:\n",
            addressCharacter: pubKeyHash === 90 ? "d" : "D",
            bip32: { public: 70617039, private: 70615956 },
            pubKeyHash,
            nethash: genesisBlock.payloadHash,
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
                epoch,
                legacyTransfer: false,
                legacyVote: false,
                transfer: { maximum: 256, minimum: 1 },
                reward: 0,
                acceptLegacySchnorrTransactions: false,
                bip340: true,
                donations: {},
            },
        ],
        genesisBlock,
        exceptions: {},
    };
}

const GENERATOR = Identities.Keys.fromPassphrase("patch 46 generator");
const OTHER = Identities.Keys.fromPassphrase("patch 46 other sender");
const RECIPIENT = Identities.Address.fromPublicKey(Identities.PublicKey.fromPassphrase("patch 46 recipient"), 90);
const IPFS_HASH = "QmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w";
const AUX = Buffer.alloc(32, 7);

// A genesis transaction as a devnet genesis carries it: v3, fee 0 (unless given), BIP340-signed.
function genesisTransaction(typeGroup, type, nonce, keys, asset, fee = "0", network = 90) {
    const data = {
        version: 3,
        network,
        typeGroup,
        type,
        nonce: BigNumber.make(nonce),
        senderPublicKey: keys.publicKey.secp256k1,
        fee: BigNumber.make(fee),
        asset,
    };
    const hash = Transactions.Utils.toHash(data, { excludeSignature: true, excludeSecondSignature: true });
    data.signature = Crypto.Hash.signSchnorrBip340(hash, keys, AUX);
    data.id = Transactions.Utils.getId(data);
    const json = { ...data, nonce: data.nonce.toFixed(), fee: data.fee.toFixed() };
    if (asset.transfers) {
        json.asset = { transfers: asset.transfers.map((t) => ({ amount: t.amount.toFixed(), recipientId: t.recipientId })) };
    }
    return json;
}

const issuance = () =>
    genesisTransaction(1, 6, 1, GENERATOR, {
        transfers: [{ amount: BigNumber.make("10000000000000000"), recipientId: RECIPIENT }],
    });
// The 1/5 schema has no genesis exemption for a zero fee, so this one pays a fee.
const ipfs = () => genesisTransaction(1, 5, 1, OTHER, { ipfs: IPFS_HASH }, "5000000");

// A genesis block JSON (the shape of genesisBlock.json) over the given transactions.
function genesisJson(transactions, { payloadLength, scheme = "bip340" } = {}) {
    const header = {
        version: 0,
        timestamp: 0,
        height: 1,
        previousBlock: "0".repeat(64),
        numberOfTransactions: transactions.length,
        totalAmount: BigNumber.ZERO,
        totalFee: transactions.reduce((sum, t) => sum.plus(t.fee), BigNumber.ZERO),
        reward: BigNumber.ZERO,
        payloadLength: payloadLength === undefined ? 32 * transactions.length : payloadLength,
        payloadHash: Crypto.HashAlgorithms.sha256(transactions.map((t) => Buffer.from(t.id, "hex"))).toString("hex"),
        generatorPublicKey: GENERATOR.publicKey.secp256k1,
    };
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(header, false));
    header.blockSignature =
        scheme === "legacy"
            ? Crypto.Hash.signSchnorrLegacy(hash, GENERATOR)
            : Crypto.Hash.signSchnorrBip340(hash, GENERATOR, AUX);
    header.id = Blocks.Block.getId(header);
    return {
        ...header,
        totalAmount: "0",
        totalFee: header.totalFee.toFixed(),
        reward: "0",
        transactions,
    };
}

// Sets the crypto configuration. Solar caches the genesis transaction ids per network byte
// (Utils.isGenesisTransaction) and rebuilds the cache only when the byte changes, so the cache is reset
// first by a call under a byte that differs from the target's. (A reset through the testnet preset would
// not do for a byte-30 genesis: the preset has byte 30 itself, so the testnet ids would stay.)
function configure(config) {
    const reset = makeConfig({ payloadHash: "0".repeat(64), transactions: [] });
    reset.network.pubKeyHash = config.network.pubKeyHash === 23 ? 24 : 23;
    Managers.configManager.setConfig(reset);
    Utils.isGenesisTransaction("");
    Managers.configManager.setConfig(config);
}

function makeRegistry() {
    const { Core, Solar, Registry } = Handlers;
    const handlerClasses = [
        Core.LegacyTransferTransactionHandler,
        Core.SecondSignatureRegistrationTransactionHandler,
        Core.DelegateRegistrationTransactionHandler,
        Core.LegacyVoteTransactionHandler,
        Core.MultiSignatureRegistrationTransactionHandler,
        Core.IpfsTransactionHandler,
        Core.TransferTransactionHandler,
        Core.DelegateResignationTransactionHandler,
        Core.HtlcLockTransactionHandler,
        Core.HtlcClaimTransactionHandler,
        Core.HtlcRefundTransactionHandler,
        Solar.BurnTransactionHandler,
        Solar.VoteTransactionHandler,
    ];
    const registry = Object.create(Registry.prototype);
    registry.provider = { isRegistrationRequired: () => false, registerHandlers: () => {} };
    registry.handlers = handlerClasses.map((HandlerClass) => Object.create(HandlerClass.prototype));
    return registry;
}

// Runs DatabaseInteraction.initialise() with stubs on the configured genesis and reports what it did
// up to the first process.exit (the stub throws, as the real exit never returns). With terminateThrows,
// terminate("Invalid genesis block") records the call and then throws, as it does when a service
// provider's dispose fails.
async function initialise({ terminateThrows = false } = {}) {
    const outcome = { terminated: [], exits: [], genesisSet: false, lastBlockInitialised: false, errors: [] };
    const interaction = Object.create(DatabaseInteraction.prototype);
    interaction.events = { dispatch() {} };
    interaction.app = {
        terminate: async (reason) => {
            if (outcome.exits.length === 0) {
                outcome.terminated.push(reason);
            }
            if (terminateThrows && reason === "Invalid genesis block") {
                throw new Error("a service provider failed to dispose");
            }
        },
    };
    interaction.logger = {
        debug() {},
        info() {},
        notice() {},
        warning() {},
        error: (message) => outcome.errors.push(String(message).split("\n")[0]),
    };
    interaction.handlerRegistry = makeRegistry();
    interaction.stateStore = { setGenesisBlock: () => (outcome.genesisSet = true) };
    interaction.initialiseLastBlock = async () => (outcome.lastBlockInitialised = true);
    delete process.env.CORE_RESET_DATABASE;
    const realExit = process.exit;
    process.exit = (code) => {
        outcome.exits.push(code);
        throw new Error(`process.exit(${code})`);
    };
    try {
        await interaction.initialise();
    } finally {
        process.exit = realExit;
    }
    return outcome;
}

const expectAccepted = (outcome) =>
    outcome.terminated.length === 0 && outcome.exits.length === 0 && outcome.genesisSet && outcome.lastBlockInitialised
        ? true
        : `terminated ${JSON.stringify(outcome.terminated)}, exits ${JSON.stringify(outcome.exits)}, errors ${JSON.stringify(
              outcome.errors,
          )}`;
const expectRefused = (outcome, detail) => {
    if (outcome.terminated.length !== 1 || outcome.terminated[0] !== "Invalid genesis block") {
        return `terminate calls ${JSON.stringify(outcome.terminated)} (genesis used: ${outcome.genesisSet})`;
    }
    if (outcome.exits.length !== 1 || outcome.exits[0] !== 1) {
        return `process.exit calls ${JSON.stringify(outcome.exits)}`;
    }
    if (outcome.genesisSet || outcome.lastBlockInitialised) {
        return "the genesis was still used";
    }
    return outcome.errors.some((line) => line.startsWith("Invalid genesis block") && detail.test(line))
        ? true
        : `logged ${JSON.stringify(outcome.errors)}`;
};

async function main() {
    console.log(`SOLAR_DIR=${SOLAR_DIR}`);
    // Network 90 must be configured before the genesis transactions are built.
    configure(makeConfig({ payloadHash: "0".repeat(64), transactions: [] }));

    const valid = genesisJson([issuance()]);
    configure(makeConfig(JSON.parse(JSON.stringify(valid))));
    await check("valid genesis (1/6 issuance, BIP340): verifies", () => {
        const block = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(valid)));
        return block.verification.verified ? true : `errors ${JSON.stringify(block.verification.errors)}`;
    });
    await check("valid genesis: initialise() uses it and goes on (unchanged)", async () => expectAccepted(await initialise()));

    // A node may start before its epoch (a devnet may start it 90 s early): the genesis timestamp is then in
    // the future, which Block.verify() reports. That check is left out for the genesis.
    const future = new Date(Date.now() + 90000).toISOString();
    configure(makeConfig(JSON.parse(JSON.stringify(valid)), future));
    await check("valid genesis, 90 s before the epoch: Block.verify() reports only the timestamp", () => {
        const block = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(valid)));
        const errors = block.verification.errors.map(String);
        return errors.length === 1 && errors[0] === "Invalid block timestamp" ? true : `errors ${JSON.stringify(errors)}`;
    });
    await check("valid genesis, 90 s before the epoch: initialise() still accepts it", async () =>
        expectAccepted(await initialise()),
    );

    // 1/5 IPFS in the genesis: a well-formed block whose transaction type is deactivated (patch 01).
    const withIpfs = genesisJson([issuance(), ipfs()]);
    configure(makeConfig(JSON.parse(JSON.stringify(withIpfs))));
    await check("1/5 genesis: the block itself verifies (only the type is refused)", () => {
        const block = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(withIpfs)));
        return block.verification.verified ? true : `errors ${JSON.stringify(block.verification.errors)}`;
    });
    await check('1/5 genesis: initialise() terminates with "Invalid genesis block" and exits 1 (base: accepted)', async () =>
        expectRefused(await initialise(), /Transaction type Core\/5 is deactivated/),
    );

    // A bad payloadLength (patch 43), correctly signed over the bad header.
    const badPayload = genesisJson([issuance()], { payloadLength: 33 });
    configure(makeConfig(JSON.parse(JSON.stringify(badPayload))));
    await check('payloadLength 33 for 1 transaction: initialise() terminates with "Invalid genesis block" and exits 1 (base: accepted)', async () =>
        expectRefused(await initialise(), /Invalid payload length/),
    );

    // A legacy-Schnorr block signature (patch 44).
    const legacy = genesisJson([issuance()], { scheme: "legacy" });
    configure(makeConfig(JSON.parse(JSON.stringify(legacy))));
    await check('legacy Schnorr genesis signature: initialise() terminates with "Invalid genesis block" and exits 1 (base: accepted)', async () =>
        expectRefused(await initialise(), /Failed to verify block signature/),
    );

    // The same legacy-signed genesis, with a terminate() that throws: the exit is in a finally.
    await check("legacy Schnorr genesis signature, terminate() throws: the process still exits 1 (base: accepted)", async () =>
        expectRefused(await initialise({ terminateThrows: true }), /Failed to verify block signature/),
    );

    // A genesis that BlockFactory.fromJson cannot decode: the JSON id of the issuance transaction does not
    // match its bytes. The fee-0 genesis exemption is looked up by the JSON ids, so the strict decode of the
    // bytes (whose id differs) refuses the fee and throws inside fromJson.
    const tampered = JSON.parse(JSON.stringify(valid));
    const realId = tampered.transactions[0].id;
    tampered.transactions[0].id = (realId[0] === "0" ? "1" : "0") + realId.slice(1);
    configure(makeConfig(JSON.parse(JSON.stringify(tampered))));
    await check("tampered transaction id: BlockFactory.fromJson throws (the decode, not the check, refuses it)", () => {
        try {
            Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(tampered)));
        } catch (error) {
            return true;
        }
        return "fromJson accepted it";
    });
    await check('tampered transaction id: initialise() terminates with "Invalid genesis block" and exits 1 (before this patch: terminates, no exit)', async () =>
        expectRefused(await initialise(), /could not be decoded/),
    );

    // Network byte 30 (the testnet preset's byte, which generated devnets may use too): a harness check,
    // the code accepts such a genesis on every build.
    const recipient30 = Identities.Address.fromPublicKey(Identities.PublicKey.fromPassphrase("patch 46 recipient"), 30);
    configure(makeConfig({ payloadHash: "0".repeat(64), transactions: [] }, undefined, 30));
    const valid30 = genesisJson([
        genesisTransaction(1, 6, 1, GENERATOR, { transfers: [{ amount: BigNumber.make("10000000000000000"), recipientId: recipient30 }] }, "0", 30),
    ]);
    configure(makeConfig(JSON.parse(JSON.stringify(valid30)), undefined, 30));
    await check("valid genesis under network byte 30: initialise() accepts it (harness: the cache reset)", async () =>
        expectAccepted(await initialise()),
    );

    // The real genesis of a generated devnet, with that network's own configuration.
    const realGenesisFile = path.join(DEVNET_CRYPTO, "genesisBlock.json");
    if (!fs.existsSync(realGenesisFile)) {
        console.log(`SKIP real genesis: ${realGenesisFile} does not exist`);
    } else {
        await check(`real genesis (${DEVNET_CRYPTO}): initialise() accepts it`, async () => {
            const read = (name) => JSON.parse(fs.readFileSync(path.join(DEVNET_CRYPTO, `${name}.json`), "utf8"));
            configure({
                network: read("network"),
                milestones: read("milestones"),
                genesisBlock: read("genesisBlock"),
                exceptions: fs.existsSync(path.join(DEVNET_CRYPTO, "exceptions.json")) ? read("exceptions") : {},
            });
            return expectAccepted(await initialise());
        });
    }

    console.log(`46-genesis-validated: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.log(`FAIL test harness: ${error && error.stack}`);
    process.exit(1);
});
