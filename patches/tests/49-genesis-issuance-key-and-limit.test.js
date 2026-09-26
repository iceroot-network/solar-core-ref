#!/usr/bin/env node
// Patch 49 genesis-issuance-key-and-limit.
//
// Two follow-ups to patch 40:
// 1. TransferTransactionHandler.bootstrap() takes the genesis generator key from the decoded genesis
//    block (StateStore.getGenesisBlock().data.generatorPublicKey), the key StateStore.setGenesisBlock()
//    counts `issued` with, instead of the raw config string. A genesisBlock.json that writes the key in
//    upper case is the same block (same bytes, id and signature), but in s1-ref-v1 the bootstrap did not
//    recognise the issuance record, debited the generator by the whole supply and left it negative.
// 2. `issued` is at most 2^63 - 1: StateStore.setGenesisBlock() refuses a genesis whose issuance items
//    sum to more, and DatabaseInteraction.initialise() then terminates the node ("Invalid genesis block",
//    exit code 1). Solar's state saver writes every balance as a signed 64-bit integer, so a wallet at 2^63
//    or more at height 1 would make every saved-state write fail, so a u64 limit (2^64 - 1) is too high.
//
// Usage: SOLAR_DIR=<built Solar checkout> node 49-genesis-issuance-key-and-limit.test.js
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));

const load = (pkg) => require(path.join(SOLAR_DIR, "packages", pkg, "dist"));
const { Blocks, Crypto, Identities, Managers, Transactions, Utils } = load("crypto");
const { Services } = load("kernel");
const { Handlers } = load("transactions");
const { DatabaseInteraction, Stores, Wallets } = load("state");
const { StateSaver } = require(path.join(SOLAR_DIR, "packages", "state", "dist", "state-saver"));
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
function makeConfig(genesisBlock) {
    return {
        network: {
            name: "devnet",
            messagePrefix: "Solar devnet message:\n",
            addressCharacter: "d",
            bip32: { public: 70617039, private: 70615956 },
            pubKeyHash: 90,
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
                epoch: "2026-01-01T00:00:00.000Z",
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

// Sets the crypto configuration. Solar caches the genesis transaction ids per network byte
// (Utils.isGenesisTransaction), so the cache is reset first by a call under another network byte.
function configure(config) {
    Managers.configManager.setFromPreset("testnet");
    Utils.isGenesisTransaction("");
    Managers.configManager.setConfig(config);
}

const GENERATOR = Identities.Keys.fromPassphrase("patch 49 generator");
const RECIPIENTS = ["one", "two", "three"].map((name) =>
    Identities.Address.fromPublicKey(Identities.PublicKey.fromPassphrase(`patch 49 recipient ${name}`), 90),
);
const AUX = Buffer.alloc(32, 9);
const U64_MAX = "18446744073709551615";
const THIRD = "6148914691236517205"; // 3 x THIRD = 2^64 - 1
const I64_MAX = "9223372036854775807"; // 2^63 - 1

// A genesis block JSON with one 1/6 issuance transfer from the generator paying the given amounts.
function genesisJson(amounts) {
    const data = {
        version: 3,
        network: 90,
        typeGroup: 1,
        type: 6,
        nonce: BigNumber.ONE,
        senderPublicKey: GENERATOR.publicKey.secp256k1,
        fee: BigNumber.ZERO,
        asset: { transfers: amounts.map((amount, i) => ({ amount: BigNumber.make(amount), recipientId: RECIPIENTS[i] })) },
    };
    const txHash = Transactions.Utils.toHash(data, { excludeSignature: true, excludeSecondSignature: true });
    data.signature = Crypto.Hash.signSchnorrBip340(txHash, GENERATOR, AUX);
    data.id = Transactions.Utils.getId(data);
    const transaction = {
        ...data,
        nonce: "1",
        fee: "0",
        asset: { transfers: data.asset.transfers.map((t) => ({ amount: t.amount.toFixed(), recipientId: t.recipientId })) },
    };

    const header = {
        version: 0,
        timestamp: 0,
        height: 1,
        previousBlock: "0".repeat(64),
        numberOfTransactions: 1,
        totalAmount: BigNumber.ZERO,
        totalFee: BigNumber.ZERO,
        reward: BigNumber.ZERO,
        payloadLength: 32,
        payloadHash: Crypto.HashAlgorithms.sha256([Buffer.from(data.id, "hex")]).toString("hex"),
        generatorPublicKey: GENERATOR.publicKey.secp256k1,
    };
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(header, false));
    header.blockSignature = Crypto.Hash.signSchnorrBip340(hash, GENERATOR, AUX);
    header.id = Blocks.Block.getId(header);
    return { ...header, totalAmount: "0", totalFee: "0", reward: "0", transactions: [transaction] };
}

class StubWallet {
    constructor(address) {
        this.address = address;
        this.balance = BigNumber.ZERO;
        this.publicKey = undefined;
    }
    getAddress() {
        return this.address;
    }
    getPublicKey() {
        return this.publicKey;
    }
    setPublicKey(publicKey) {
        this.publicKey = publicKey;
    }
    getBalance() {
        return this.balance;
    }
    increaseBalance(amount) {
        this.balance = this.balance.plus(amount);
        return this;
    }
    decreaseBalance(amount) {
        this.balance = this.balance.minus(amount);
        return this;
    }
}

class StubWalletRepository {
    constructor() {
        this.wallets = new Map();
    }
    findByAddress(address) {
        if (!this.wallets.has(address)) {
            this.wallets.set(address, new StubWallet(address));
        }
        return this.wallets.get(address);
    }
    index() {}
    allByAddress() {
        return [...this.wallets.values()];
    }
}

// A real StateStore holding the decoded genesis block, as DatabaseInteraction.initialise() leaves it.
function stateStoreWith(block) {
    const store = Object.create(Stores.StateStore.prototype);
    store.setGenesisBlock(block);
    return store;
}

// TransferTransactionHandler.bootstrap() over the genesis transactions as the database returns them.
async function bootstrapTransfers(block, store) {
    const repository = new StubWalletRepository();
    const handler = Object.create(Handlers.Core.TransferTransactionHandler.prototype);
    handler.walletRepository = repository;
    handler.app = { get: () => store };
    handler.transactionHistoryService = {
        async *streamByCriteria(criteria) {
            for (const { data } of block.transactions) {
                if (data.typeGroup === criteria.typeGroup && data.type === criteria.type) {
                    yield data;
                }
            }
        },
    };
    await handler.bootstrap();
    return repository;
}

// DatabaseInteraction.initialise() with a real StateStore; process.exit is stubbed (it records the code
// and throws, as the real exit never returns).
async function initialise() {
    const outcome = { terminated: [], exits: [], errors: [], store: Object.create(Stores.StateStore.prototype) };
    const interaction = Object.create(DatabaseInteraction.prototype);
    interaction.events = { dispatch() {} };
    interaction.app = {
        terminate: async (reason) => {
            if (outcome.exits.length === 0) {
                outcome.terminated.push(reason);
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
    interaction.handlerRegistry = { getActivatedHandlerForData: async () => ({}) };
    interaction.stateStore = outcome.store;
    interaction.initialiseLastBlock = async () => {};
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

// The real StateSaver writes one real wallet with the given balance to a temporary directory. Returns the
// error lines it logged (it catches its own errors) and whether the state file was written.
function saveState(balance) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-49-"));
    const errors = [];
    const attributes = new Services.Attributes.AttributeSet();
    attributes.set("votes");
    const wallet = new Wallets.Wallet(RECIPIENTS[0], new Services.Attributes.AttributeMap(attributes), false);
    wallet.setBalance(BigNumber.make(balance));
    const saver = Object.create(StateSaver.prototype);
    saver.app = { version: () => "4.3.1" };
    saver.configuration = { get: (key) => (key === "savedStatesPath" ? dir : 0) };
    saver.logger = { error: (message) => errors.push(String(message).split("\n")[0]) };
    saver.stateMachine = { stateStore: { getLastBlock: () => ({ data: { height: 1, id: "a".repeat(64) } }) } };
    saver.walletRepository = { allByAddress: () => [wallet] };
    saver.byteBufferArray = new Utils.ByteBufferArray();
    return saver.run().then(() => {
        const written = fs.existsSync(path.join(dir, "a".repeat(64)));
        fs.rmSync(dir, { recursive: true, force: true });
        return { errors, written };
    });
}

const generatorAddress = () => Identities.Address.fromPublicKey(GENERATOR.publicKey.secp256k1, 90);
const expectEqual = (actual, expected) =>
    String(actual) === String(expected) ? true : `got ${actual}, expected ${expected}`;

async function main() {
    console.log(`SOLAR_DIR=${SOLAR_DIR}`);
    // Network 90 must be configured before the genesis transactions are built.
    configure(makeConfig({ payloadHash: "0".repeat(64), transactions: [] }));
    const SUPPLY = "10000000000000000";

    // 1. The generator key as the decoded block has it, not as the config file spells it.
    const lower = genesisJson([SUPPLY]);
    const upper = { ...JSON.parse(JSON.stringify(lower)), generatorPublicKey: lower.generatorPublicKey.toUpperCase() };

    configure(makeConfig(JSON.parse(JSON.stringify(upper))));
    const upperBlock = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(upper)));
    await check("upper-case generator key in genesisBlock.json: the same block (id, verified, key decoded in lower case)", () =>
        upperBlock.data.id === lower.id &&
        upperBlock.verification.verified &&
        upperBlock.data.generatorPublicKey === lower.generatorPublicKey
            ? true
            : `id ${upperBlock.data.id}, errors ${JSON.stringify(upperBlock.verification.errors)}`,
    );
    const upperStore = stateStoreWith(upperBlock);
    await check(`upper-case generator key: getGenesisIssuance() is ${SUPPLY} (unchanged)`, () =>
        expectEqual(upperStore.getGenesisIssuance().toFixed(), SUPPLY),
    );
    const upperState = await bootstrapTransfers(upperBlock, upperStore);
    await check("upper-case generator key: the bootstrap leaves the generator at 0 (base: -10000000000000000)", () =>
        expectEqual(upperState.findByAddress(generatorAddress()).getBalance().toFixed(), "0"),
    );
    await check("upper-case generator key: sum of balances equals issued", () => {
        const sum = upperState.allByAddress().reduce((s, w) => s.plus(w.getBalance()), BigNumber.ZERO);
        return expectEqual(sum.toFixed(), upperStore.getGenesisIssuance().toFixed());
    });

    configure(makeConfig(JSON.parse(JSON.stringify(lower))));
    const lowerBlock = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(lower)));
    await check("lower-case generator key: the bootstrap leaves the generator at 0 (unchanged)", async () => {
        const state = await bootstrapTransfers(lowerBlock, stateStoreWith(lowerBlock));
        return expectEqual(state.findByAddress(generatorAddress()).getBalance().toFixed(), "0");
    });

    // 2. issued is at most 2^63 - 1, the largest balance the state saver can write.
    const atLimit = genesisJson([I64_MAX]);
    configure(makeConfig(JSON.parse(JSON.stringify(atLimit))));
    const atLimitBlock = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(atLimit)));
    await check(`issuance of exactly 2^63 - 1 to one wallet: accepted, issued = ${I64_MAX} (unchanged)`, () =>
        expectEqual(stateStoreWith(atLimitBlock).getGenesisIssuance().toFixed(), I64_MAX),
    );
    await check("issuance of exactly 2^63 - 1: initialise() goes on (unchanged)", async () => {
        const outcome = await initialise();
        return outcome.terminated.length === 0 && outcome.exits.length === 0
            ? expectEqual(outcome.store.getGenesisIssuance().toFixed(), I64_MAX)
            : `terminated ${JSON.stringify(outcome.terminated)}, errors ${JSON.stringify(outcome.errors)}`;
    });
    await check("issuance of exactly 2^63 - 1: the wallet holds it after the bootstrap and the state saver writes it", async () => {
        const state = await bootstrapTransfers(atLimitBlock, stateStoreWith(atLimitBlock));
        const balance = state.findByAddress(RECIPIENTS[0]).getBalance().toFixed();
        if (balance !== I64_MAX) {
            return `balance ${balance}`;
        }
        const saved = await saveState(balance);
        return saved.written && saved.errors.length === 0 ? true : `written ${saved.written}, errors ${JSON.stringify(saved.errors)}`;
    });
    await check("a balance of 2^63 cannot be saved: the state saver's signed 64-bit field (the reason for the limit; unchanged)", async () => {
        const saved = await saveState("9223372036854775808");
        return !saved.written && saved.errors.length > 0 ? true : `written ${saved.written}, errors ${JSON.stringify(saved.errors)}`;
    });

    // 2^63 in three items, each well below the limit.
    const overLimit = genesisJson(["3074457345618258603", "3074457345618258603", "3074457345618258602"]);
    configure(makeConfig(JSON.parse(JSON.stringify(overLimit))));
    const overBlock = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(overLimit)));
    await check("issuance of 2^63: the block itself verifies (only the issuance limit refuses it)", () =>
        overBlock.verification.verified ? true : `errors ${JSON.stringify(overBlock.verification.errors)}`,
    );
    await check("issuance of 2^63: StateStore.setGenesisBlock() refuses it and stores nothing (before this patch: issued 9223372036854775808)", () => {
        const store = Object.create(Stores.StateStore.prototype);
        try {
            store.setGenesisBlock(overBlock);
        } catch (error) {
            if (error.message !== "The genesis block issues 9223372036854775808, more than 2^63 - 1") {
                return `threw "${error.message}"`;
            }
            try {
                store.getGenesisBlock();
                return "the genesis block was stored";
            } catch {
                return true;
            }
        }
        return `accepted, issued ${store.getGenesisIssuance().toFixed()}`;
    });
    await check('issuance of 2^63: initialise() terminates with "Invalid genesis block" and exits 1 (before this patch: accepted)', async () => {
        const outcome = await initialise();
        if (outcome.terminated.length !== 1 || outcome.terminated[0] !== "Invalid genesis block") {
            return `terminate calls ${JSON.stringify(outcome.terminated)}`;
        }
        if (outcome.exits.length !== 1 || outcome.exits[0] !== 1) {
            return `process.exit calls ${JSON.stringify(outcome.exits)}`;
        }
        return outcome.errors.some((line) => /Invalid genesis block: .*more than 2\^63 - 1/.test(line))
            ? true
            : `logged ${JSON.stringify(outcome.errors)}`;
    });

    // 2^64 - 1, the largest sum that a u64 limit would accept, and one above it.
    for (const [label, amounts, total] of [
        ["2^64 - 1", [THIRD, THIRD, THIRD], U64_MAX],
        ["2^64", ["6148914691236517206", THIRD, THIRD], "18446744073709551616"],
    ]) {
        const json = genesisJson(amounts);
        configure(makeConfig(JSON.parse(JSON.stringify(json))));
        const block = Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(json)));
        await check(`issuance of ${label}: StateStore.setGenesisBlock() refuses it (before this patch: accepted)`, () => {
            try {
                stateStoreWith(block);
            } catch (error) {
                return error.message === `The genesis block issues ${total}, more than 2^63 - 1` ? true : `threw "${error.message}"`;
            }
            return "accepted";
        });
    }

    console.log(`49-genesis-issuance-key-and-limit: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.log(`FAIL test harness: ${error && error.stack}`);
    process.exit(1);
});
