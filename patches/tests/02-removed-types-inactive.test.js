#!/usr/bin/env node
// Patch 02 removed-types-inactive.
// The removed types 1/0, 1/3, 1/4 and 1/8 to 1/10 are inactive whatever the milestone says,
// and the Solar vote 2/2 is active whatever legacyVote says. The check uses a height-1
// milestone that turns legacyTransfer, legacyVote and htlcEnabled on, which in Solar 4.3.1
// activates the removed types and deactivates 2/2.
//
// Usage: SOLAR_DIR=<built Solar checkout> node patches/tests/02-removed-types-inactive.test.js
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

const devnetConfig = (flags) => ({
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
            acceptLegacySchnorrTransactions: false,
            bip340: true,
            ...flags,
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

    const { Core, Solar, Registry } = Transactions.Handlers;
    const removed = [
        ["1/0 legacy transfer", 1, 0, Core.LegacyTransferTransactionHandler],
        ["1/3 legacy vote", 1, 3, Core.LegacyVoteTransactionHandler],
        ["1/4 multisignature registration", 1, 4, Core.MultiSignatureRegistrationTransactionHandler],
        ["1/8 HTLC lock", 1, 8, Core.HtlcLockTransactionHandler],
        ["1/9 HTLC claim", 1, 9, Core.HtlcClaimTransactionHandler],
        ["1/10 HTLC refund", 1, 10, Core.HtlcRefundTransactionHandler],
    ];

    const registry = Object.create(Registry.prototype);
    registry.provider = { isRegistrationRequired: () => false, registerHandlers: () => {} };
    registry.handlers = [
        ...removed.map(([, , , HandlerClass]) => Object.create(HandlerClass.prototype)),
        Object.create(Solar.VoteTransactionHandler.prototype),
    ];

    // Scenario A: the milestone turns every legacy flag on.
    Crypto.Managers.configManager.setConfig(
        devnetConfig({ legacyTransfer: true, legacyVote: true, htlcEnabled: true }),
    );
    Crypto.Managers.configManager.setHeight(1);

    await check("milestone under test has legacyTransfer, legacyVote and htlcEnabled true", () => {
        const milestone = Crypto.Managers.configManager.getMilestone(1);
        return milestone.legacyTransfer === true && milestone.legacyVote === true && milestone.htlcEnabled === true
            ? true
            : JSON.stringify(milestone);
    });

    for (const [label, typeGroup, type, HandlerClass] of removed) {
        await check(`flags on: ${label} isActivated() is false`, async () => {
            const active = await Object.create(HandlerClass.prototype).isActivated();
            return active === false ? true : `isActivated() returned ${active}`;
        });
        await check(`flags on: ${label} is rejected as deactivated by the registry`, async () => {
            try {
                await registry.getActivatedHandlerForData({ typeGroup, type });
            } catch (error) {
                if (!(error instanceof Transactions.Errors.DeactivatedTransactionHandlerError)) {
                    return `wrong error class ${error.constructor.name}: ${error.message}`;
                }
                return error.message === `Transaction type Core/${type} is deactivated`
                    ? true
                    : `wrong message: ${error.message}`;
            }
            return "resolved an active handler";
        });
    }

    await check("flags on: 2/2 Solar vote isActivated() is true", async () => {
        const active = await Object.create(Solar.VoteTransactionHandler.prototype).isActivated();
        return active === true ? true : `isActivated() returned ${active}`;
    });
    await check("flags on: 2/2 Solar vote resolves in the registry", async () => {
        const handler = await registry.getActivatedHandlerForData({ typeGroup: 2, type: 2 });
        return handler instanceof Solar.VoteTransactionHandler ? true : `resolved ${handler.constructor.name}`;
    });

    // Scenario B: a devnet milestone with the flags off and no htlcEnabled key.
    Crypto.Managers.configManager.setConfig(devnetConfig({ legacyTransfer: false, legacyVote: false }));
    Crypto.Managers.configManager.setHeight(1);

    for (const [label, , , HandlerClass] of removed) {
        await check(`flags off: ${label} is not active`, async () => {
            const active = await Object.create(HandlerClass.prototype).isActivated();
            return !active ? true : `isActivated() returned ${active}`;
        });
    }
    await check("flags off: 2/2 Solar vote is active", async () => {
        const active = await Object.create(Solar.VoteTransactionHandler.prototype).isActivated();
        return active === true ? true : `isActivated() returned ${active}`;
    });
};

main()
    .catch((error) => fail("test script", error && error.stack))
    .finally(() => {
        console.log(`${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed (SOLAR_DIR=${SOLAR_DIR})`);
        process.exit(failed === 0 ? 0 : 1);
    });
