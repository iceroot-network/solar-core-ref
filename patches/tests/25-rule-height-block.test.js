"use strict";

// Patch 25 rule-height-block.
// Transaction-level rules of block H (decode, schema, apply, revert) read the milestone at H; pool admission,
// pool re-adds and the collator's validation read it at tip + 1. ConfigManager.runAtHeight(h, fn) scopes the
// height along fn's own async chain; getHeight() and getMilestone() without a height honour it.
// The milestone file drops transfer.maximum from 256 to 2 at height 10; T is a transfer with 3 recipients.
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/25-rule-height-block.test.js

const path = require("path");

const SOLAR_DIR = process.env.SOLAR_DIR || path.resolve(__dirname, "../..");
const { Blocks, Crypto, Identities, Managers, Transactions, Utils } = require(path.join(
    SOLAR_DIR,
    "packages/crypto/dist",
));

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

const cm = Managers.configManager;
cm.setConfig({
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
            bip340: true,
            acceptLegacySchnorrTransactions: false,
            donations: {},
        },
        { height: 10, transfer: { maximum: 2, minimum: 1 } },
    ],
    exceptions: {},
    genesisBlock: { transactions: [] },
});

const runAtHeight = (height, fn) => {
    if (typeof cm.runAtHeight !== "function") {
        throw new Error("configManager.runAtHeight does not exist");
    }
    return cm.runAtHeight(height, fn);
};

cm.setHeight(1);
const RECIPIENTS = ["dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokA", "dPiLD2Fi1dnQhnskBkSnDEPraaWtbTcYPj", "dZDbtMv86KMqo8iPMtAJLhoT5BVKfyVokA"];
const builder = Transactions.BuilderFactory.transfer().fee("50000000").nonce("1");
for (const recipient of RECIPIENTS) {
    builder.addTransfer(recipient, "100");
}
const T = builder.sign("patch 25 test sender").build();

const accepts = (fn) => {
    try {
        fn();
        return "accepted";
    } catch (error) {
        return `rejected (${error.constructor.name})`;
    }
};

// A block at `height` holding T, built by hand so that no milestone rule is applied while building it.
const FORGER = Identities.Keys.fromPassphrase("patch 25 test forger");
const blockJson = (height) => {
    const transaction = Transactions.TransactionFactory.fromBytesUnsafe(T.serialised, T.id);
    const data = {
        version: 0,
        timestamp: height * 8,
        height,
        previousBlock: "ab".repeat(32),
        numberOfTransactions: 1,
        totalAmount: Utils.BigNumber.make(300),
        totalFee: Utils.BigNumber.make(50000000),
        reward: Utils.BigNumber.ZERO,
        payloadLength: 32,
        payloadHash: Crypto.HashAlgorithms.sha256(Buffer.from(T.id, "hex")).toString("hex"),
        generatorPublicKey: FORGER.publicKey.secp256k1,
        transactions: [transaction.data],
    };
    const hash = Crypto.HashAlgorithms.sha256(Blocks.Serialiser.serialise(data, false));
    data.blockSignature = Crypto.Hash.signSchnorr(hash, FORGER, true, Buffer.alloc(32, 1));
    data.id = Blocks.Block.getId(data);
    const json = JSON.parse(
        JSON.stringify({ ...data, transactions: undefined }, (key, value) =>
            value instanceof Utils.BigNumber ? value.toString() : value,
        ),
    );
    json.transactions = [transaction.toJson()];
    return { json, bytes: Blocks.Serialiser.serialiseWithTransactions(data) };
};

const milestoneHeight = () => cm.getMilestone().height;

const main = async () => {
    await check("T is valid at height 9 and invalid at height 10 through runAtHeight", () => {
        cm.setHeight(1);
        const at9 = runAtHeight(9, () => accepts(() => Transactions.TransactionFactory.fromBytes(T.serialised)));
        const at10 = runAtHeight(10, () => accepts(() => Transactions.TransactionFactory.fromBytes(T.serialised)));
        return (at9 === "accepted" && at10.startsWith("rejected")) || `height 9 ${at9}, height 10 ${at10}`;
    });

    await check("outside a scope getHeight() and getMilestone() still use the global height", () => {
        cm.setHeight(10);
        const inside = runAtHeight(9, () => `${cm.getHeight()}/${milestoneHeight()}`);
        const outside = `${cm.getHeight()}/${milestoneHeight()}`;
        const explicit = runAtHeight(10, () => cm.getMilestone(5).height);
        return (inside === "9/1" && outside === "10/10" && explicit === 1) || `inside ${inside}, outside ${outside}, explicit ${explicit}`;
    });

    const block10 = blockJson(10);
    const block9 = blockJson(9);

    await check("global height 9: block 10 holding T is rejected by BlockFactory.fromBytes", () => {
        cm.setHeight(9);
        const verdict = accepts(() => Blocks.BlockFactory.fromBytes(block10.bytes));
        return verdict.startsWith("rejected") || verdict;
    });

    await check("global height 9: block 10 holding T is rejected by BlockFactory.fromData", () => {
        cm.setHeight(9);
        const verdict = accepts(() => Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(block10.json))));
        return verdict.startsWith("rejected") || verdict;
    });

    await check("global height 10: block 9 holding T is accepted by BlockFactory.fromBytes (sync case)", () => {
        cm.setHeight(10);
        const verdict = accepts(() => Blocks.BlockFactory.fromBytes(block9.bytes));
        return verdict === "accepted" || verdict;
    });

    await check("global height 10: block 9 holding T is accepted by BlockFactory.fromData (sync case)", () => {
        cm.setHeight(10);
        const verdict = accepts(() => Blocks.BlockFactory.fromJson(JSON.parse(JSON.stringify(block9.json))));
        return verdict === "accepted" || verdict;
    });

    // BlockState, with stubs for everything it reads.
    const { BlockState } = require(path.join(SOLAR_DIR, "packages/state/dist/block-state"));
    const stubBlockState = (seen) => {
        const wallet = { getAttribute: () => ({}) };
        const handler = {
            apply: async () => seen.push(`apply:${milestoneHeight()}`),
            revert: async () => seen.push(`revert:${milestoneHeight()}`),
        };
        const blockState = Object.create(BlockState.prototype);
        Object.assign(blockState, {
            handlerRegistry: { getActivatedHandlerForData: async () => handler },
            walletRepository: { findByUsername: () => wallet, findByAddress: () => wallet, findByPublicKey: () => wallet },
            state: {
                getLastBlock: () => ({ data: { height: 9 } }),
                setLastBlock: () => seen.push(`setLastBlock:${milestoneHeight()}`),
            },
            logger: { error: () => undefined },
            applyBlockToForger: () => seen.push(`forger:${milestoneHeight()}`),
            revertBlockFromForger: async () => seen.push(`unforger:${milestoneHeight()}`),
            updateVoteBalances: () => undefined,
        });
        return blockState;
    };
    const stubBlock = () => ({
        data: { height: 10, username: "genesis_1" },
        transactions: [{ type: 6, typeGroup: 1, data: { senderId: RECIPIENTS[0] }, setBurnedFee: () => undefined }],
    });

    await check("BlockState.applyBlock(10) at global height 9: the handler sees the height-10 milestone", async () => {
        cm.setHeight(9);
        const seen = [];
        await stubBlockState(seen).applyBlock(stubBlock(), { index: undefined });
        const got = seen.join(",");
        return got === "apply:10,forger:10,setLastBlock:10" || `saw ${got}`;
    });

    await check("BlockState.revertBlock(10) at global height 9: the handler sees the height-10 milestone", async () => {
        cm.setHeight(9);
        const seen = [];
        await stubBlockState(seen).revertBlock(stubBlock());
        const got = seen.join(",");
        return got === "unforger:10,revert:10" || `saw ${got}`;
    });

    await check("BlockState.applyBlock(10): the revert after a failed transaction also sees height 10", async () => {
        cm.setHeight(9);
        const seen = [];
        const blockState = stubBlockState(seen);
        const block = stubBlock();
        block.transactions.push({
            type: 6,
            typeGroup: 1,
            data: { senderId: RECIPIENTS[0] },
            setBurnedFee: () => {
                throw new Error("second transaction fails");
            },
        });
        try {
            await blockState.applyBlock(block, { index: undefined });
            return "applyBlock did not throw";
        } catch {
            const got = seen.join(",");
            return got === "apply:10,revert:10,setLastBlock:10" || `saw ${got}`;
        }
    });

    // Pool: processor, collator and re-adds at tip 9 judge by height 10.
    const { Processor } = require(path.join(SOLAR_DIR, "packages/pool/dist/processor"));
    const { Collator } = require(path.join(SOLAR_DIR, "packages/pool/dist/collator"));
    const { Service } = require(path.join(SOLAR_DIR, "packages/pool/dist/service"));
    const { Utils: AppUtils } = require(path.join(SOLAR_DIR, "packages/kernel/dist"));

    await check("Processor.process at tip 9: the worker and the pool see height 10", async () => {
        cm.setHeight(9);
        const seen = [];
        const processor = Object.create(Processor.prototype);
        Object.assign(processor, {
            extensions: [],
            pool: { addTransaction: async () => seen.push(`pool:${milestoneHeight()}`) },
            workerPool: {
                getTransaction: async () => {
                    seen.push(`worker:${cm.getHeight()}/${milestoneHeight()}`);
                    return T;
                },
            },
            transactionBroadcaster: undefined,
            logger: { error: () => undefined },
            stateStore: { getLastHeight: () => 9 },
            cachedTransactions: new Map(),
        });
        const result = await processor.process([T.serialised]);
        const got = seen.join(",");
        return (got === "worker:10/10,pool:10" && result.accept.length === 1) || `saw ${got}, accepted ${result.accept.length}`;
    });

    await check("Collator.getBlockCandidateTransactions at tip 9: validation sees height 10", async () => {
        cm.setHeight(9);
        const seen = [];
        const collator = Object.create(Collator.prototype);
        Object.assign(collator, {
            createTransactionValidator: () => ({
                validate: async (transaction) => {
                    seen.push(`validate:${milestoneHeight()}`);
                    return transaction;
                },
            }),
            blockchain: { getLastBlock: () => ({ data: { height: 9 } }) },
            pool: { removeTransaction: async () => undefined },
            expirationService: { isExpired: () => false },
            poolQuery: { getFromHighestPriority: () => [T] },
            logger: { warning: () => undefined },
        });
        const candidates = await collator.getBlockCandidateTransactions(true, []);
        const got = seen.join(",");
        return (got === "validate:10" && candidates.length === 1) || `saw ${got}, ${candidates.length} candidates`;
    });

    await check("Service.readdTransactions at tip 9: re-added transactions see height 10", async () => {
        cm.setHeight(9);
        const seen = [];
        const service = Object.create(Service.prototype);
        Object.assign(service, {
            lock: new AppUtils.Lock(),
            disposed: false,
            mempool: { flush: () => undefined },
            storage: {
                getAllTransactions: () => [
                    { height: 9, id: T.id, recipientId: "", senderId: T.data.senderId, serialised: T.serialised },
                ],
                removeTransaction: () => undefined,
                addTransaction: () => undefined,
            },
            configuration: { getRequired: () => 2700 },
            stateStore: { getLastHeight: () => 9 },
            logger: { debug: () => undefined, info: () => undefined, warning: () => undefined },
            addTransactionToMempool: async () => seen.push(`readd:${milestoneHeight()}`),
        });
        await service.readdTransactions();
        const got = seen.join(",");
        return got === "readd:10" || `saw ${got}`;
    });

    await check("two concurrent scopes stay isolated", async () => {
        cm.setHeight(9);
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const observe = (height, pause) =>
            runAtHeight(height, async () => {
                const seen = [];
                for (let i = 0; i < 4; i++) {
                    await sleep(pause);
                    seen.push(`${cm.getHeight()}/${milestoneHeight()}`);
                }
                return seen.join(" ");
            });
        const [a, b] = await Promise.all([observe(9, 3), observe(10, 2)]);
        const after = `${cm.getHeight()}/${milestoneHeight()}`;
        return (a === "9/1 9/1 9/1 9/1" && b === "10/10 10/10 10/10 10/10" && after === "9/1") || `scope 9: ${a}; scope 10: ${b}; after: ${after}`;
    });

    console.log(`SUMMARY 25-rule-height-block: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
    console.log(`FAIL test harness: ${error.stack}`);
    process.exit(1);
});
