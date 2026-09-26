#!/usr/bin/env node
// Patch 01 ipfs-type-removed (L-33, L-57 removals).
// The 1/5 IPFS handler stays registered but is never activated, so the handler registry
// rejects 1/5 with DeactivatedTransactionHandlerError. The pool and the block path both
// look the handler up through this registry. The 1/5 codec itself is unchanged.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/01-ipfs-type-removed.test.js
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
            fees: {
                staticFees: {
                    burn: 0,
                    delegateRegistration: 7500000000,
                    delegateResignation: 0,
                    ipfs: 5000000,
                    secondSignature: 5000000,
                    transfer: 50000000,
                    vote: 9000000,
                },
            },
            legacyTransfer: false,
            legacyVote: false,
            acceptLegacySchnorrTransactions: false,
            bip340: true,
        },
    ],
    genesisBlock: { transactions: [] },
    exceptions: {},
});

const main = async () => {
    let Crypto;
    let Transactions;
    try {
        Crypto = require(path.join(SOLAR_DIR, "packages/crypto/dist"));
        Transactions = require(path.join(SOLAR_DIR, "packages/transactions/dist"));
    } catch (error) {
        fail("load Solar packages", error.message);
        return;
    }

    Crypto.Managers.configManager.setConfig(devnetConfig());
    Crypto.Managers.configManager.setHeight(1);

    const { Core, Solar, Registry } = Transactions.Handlers;
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

    // The registry as the service provider builds it: all 13 handlers bound, no container.
    const registry = Object.create(Registry.prototype);
    registry.provider = { isRegistrationRequired: () => false, registerHandlers: () => {} };
    registry.handlers = handlerClasses.map((HandlerClass) => Object.create(HandlerClass.prototype));

    await check("registry holds 13 handlers", () =>
        registry.getRegisteredHandlers().length === 13 ? true : `got ${registry.getRegisteredHandlers().length}`,
    );

    await check("1/5 is still registered (known type, not an unknown one)", () => {
        const handler = registry.getRegisteredHandlerByType(Crypto.Transactions.InternalTransactionType.from(5, 1));
        return handler instanceof Core.IpfsTransactionHandler ? true : "wrong handler";
    });

    await check("1/5 IpfsTransactionHandler.isActivated() is false", async () => {
        const handler = Object.create(Core.IpfsTransactionHandler.prototype);
        const active = await handler.isActivated();
        return active === false ? true : `isActivated() returned ${active}`;
    });

    await check("getActivatedHandlerForData(1/5) rejects with DeactivatedTransactionHandlerError", async () => {
        try {
            await registry.getActivatedHandlerForData({ typeGroup: 1, type: 5 });
        } catch (error) {
            if (!(error instanceof Transactions.Errors.DeactivatedTransactionHandlerError)) {
                return `wrong error class ${error.constructor.name}: ${error.message}`;
            }
            if (error.message !== "Transaction type Core/5 is deactivated") {
                return `wrong message: ${error.message}`;
            }
            return true;
        }
        return "resolved a handler for 1/5";
    });

    await check("1/5 is not among the activated handlers", async () => {
        const activated = await registry.getActivatedHandlers();
        return activated.some((handler) => handler instanceof Core.IpfsTransactionHandler)
            ? "IPFS handler is activated"
            : true;
    });

    const kept = [
        [1, 1, Core.SecondSignatureRegistrationTransactionHandler],
        [1, 2, Core.DelegateRegistrationTransactionHandler],
        [1, 6, Core.TransferTransactionHandler],
        [1, 7, Core.DelegateResignationTransactionHandler],
        [2, 0, Solar.BurnTransactionHandler],
        [2, 2, Solar.VoteTransactionHandler],
    ];
    for (const [typeGroup, type, HandlerClass] of kept) {
        await check(`kept type ${typeGroup}/${type} still resolves`, async () => {
            const handler = await registry.getActivatedHandlerForData({ typeGroup, type });
            return handler instanceof HandlerClass ? true : `resolved ${handler.constructor.name}`;
        });
    }

    await check("a 1/5 built with BuilderFactory.ipfs() still serialises and decodes", () => {
        const ipfsHash = "QmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w";
        const transaction = Crypto.Transactions.BuilderFactory.ipfs()
            .ipfsAsset(ipfsHash)
            .nonce("1")
            .network(90)
            .sign("patch 01 ipfs sender")
            .build();
        const decoded = Crypto.Transactions.TransactionFactory.fromBytes(transaction.serialised);
        if (decoded.data.typeGroup !== 1 || decoded.data.type !== 5) {
            return `decoded type ${decoded.data.typeGroup}/${decoded.data.type}`;
        }
        if (decoded.data.asset.ipfs !== ipfsHash) {
            return `decoded asset ${JSON.stringify(decoded.data.asset)}`;
        }
        if (decoded.id !== transaction.id) {
            return `id changed: ${transaction.id} -> ${decoded.id}`;
        }
        return decoded.isVerified === true ? true : "signature did not verify";
    });
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
