import { Blocks, Interfaces, Managers } from "@solar-network/crypto";
import { DatabaseService } from "@solar-network/database";
import { Container, Contracts, Enums } from "@solar-network/kernel";
import { Handlers } from "@solar-network/transactions";

import { RoundState } from "./round-state";

@Container.injectable()
export class DatabaseInteraction {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.DatabaseService)
    private readonly databaseService!: DatabaseService;

    @Container.inject(Container.Identifiers.BlockState)
    @Container.tagged("state", "blockchain")
    private readonly blockState!: Contracts.State.BlockState;

    @Container.inject(Container.Identifiers.StateStore)
    private readonly stateStore!: Contracts.State.StateStore;

    @Container.inject(Container.Identifiers.StateTransactionStore)
    private readonly stateTransactionStore!: Contracts.State.TransactionStore;

    @Container.inject(Container.Identifiers.StateBlockStore)
    private readonly stateBlockStore!: Contracts.State.BlockStore;

    @Container.inject(Container.Identifiers.TransactionHandlerRegistry)
    @Container.tagged("state", "blockchain")
    private readonly handlerRegistry!: Handlers.Registry;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.RoundState)
    private readonly roundState!: RoundState;

    public async initialise(): Promise<void> {
        try {
            this.events.dispatch(Enums.StateEvent.Starting);

            const genesisBlockJson = Managers.configManager.get("genesisBlock");

            // Fail closed: the node never starts on an invalid genesis block, one that cannot be decoded included.
            // terminate() alone leaves the process up; the exit is in a finally, so a failing terminate() still exits.
            let genesisBlock: Interfaces.IBlock | undefined;
            const genesisErrors: string[] = [];
            try {
                genesisBlock = Blocks.BlockFactory.fromJson(genesisBlockJson);
            } catch (error) {
                genesisErrors.push(`the genesis block could not be decoded: ${error.message}`);
            }
            if (genesisErrors.length === 0) {
                genesisErrors.push(...(await this.verifyGenesisBlock(genesisBlock)));
            }
            if (genesisErrors.length > 0) {
                this.logger.error(`Invalid genesis block: ${genesisErrors.join("; ")}`);
                try {
                    await this.app.terminate("Invalid genesis block");
                } finally {
                    process.exit(1);
                }
            }

            this.stateStore.setGenesisBlock(genesisBlock!);

            if (process.env.CORE_RESET_DATABASE) {
                await this.reset();
            }

            await this.initialiseLastBlock();
        } catch (error) {
            this.logger.error(error.stack);
            this.app.terminate("Failed to initialise database service", error);
        }
    }

    public async applyBlock(
        block: Interfaces.IBlock,
        transactionProcessing: {
            index: number | undefined;
        },
    ): Promise<void> {
        await this.roundState.detectMissedBlocks(block);

        await this.blockState.applyBlock(block, transactionProcessing);
        await this.roundState.applyBlock(block);

        for (const transaction of block.transactions) {
            await this.emitTransactionEvents(transaction);
        }

        this.events.dispatch(Enums.BlockEvent.Applied, block.getHeader());
    }

    public async revertBlock(block: Interfaces.IBlock): Promise<void> {
        await this.roundState.revertBlock(block);
        await this.blockState.revertBlock(block);

        for (let i = block.transactions.length - 1; i >= 0; i--) {
            this.events.dispatch(Enums.TransactionEvent.Reverted, block.transactions[i].data);
        }

        this.events.dispatch(Enums.BlockEvent.Reverted, block.getHeader());
    }

    public async restoreCurrentRound(): Promise<void> {
        await this.roundState.restore();
    }

    // The genesis block obeys the block rules and the transaction types of height 1, like any other
    // block (patches 01, 02, 43 and 44). The wall-clock timestamp check is left out: a node may start
    // before its network's epoch, when the genesis timestamp is still in the future.
    private async verifyGenesisBlock(genesisBlock: Interfaces.IBlock | undefined): Promise<string[]> {
        if (!genesisBlock) {
            return ["the genesis block could not be decoded"];
        }

        const errors: string[] = genesisBlock.verification.errors
            .filter((error) => error !== "Invalid block timestamp")
            .map((error) => String(error));

        await Managers.configManager.runAtHeight(1, async () => {
            for (const transaction of genesisBlock.transactions) {
                try {
                    await this.handlerRegistry.getActivatedHandlerForData(transaction.data);
                } catch (error) {
                    errors.push(`transaction ${transaction.id}: ${error.message}`);
                }
            }
        });

        return errors;
    }

    private async reset(): Promise<void> {
        await this.databaseService.reset();
        await this.createGenesisBlock();
    }

    private async initialiseLastBlock(): Promise<void> {
        // ? attempt to remove potentially corrupt blocks from database

        let lastBlock: Interfaces.IBlock | undefined;
        let tries = 5; // ! actually 6, but only 5 will be removed

        // Ensure the config manager is initialised, before attempting to call `fromData`
        // which otherwise uses potentially wrong milestones.
        let lastHeight: number = 1;
        const latest: Interfaces.IBlockData | undefined = await this.databaseService.findLatestBlock();
        if (latest) {
            lastHeight = latest.height;
        }

        Managers.configManager.setHeight(lastHeight);

        const getLastBlock = async (): Promise<Interfaces.IBlock | undefined> => {
            try {
                return await this.databaseService.getLastBlock();
            } catch (error) {
                this.logger.error(error.message);

                if (tries > 0) {
                    const block: Interfaces.IBlockData = (await this.databaseService.findLatestBlock())!;
                    await this.databaseService.deleteBlocks([block]);
                    tries--;
                } else {
                    this.app.terminate("Unable to deserialise last block from database", error);
                    throw new Error("Terminated (unreachable)");
                }

                return getLastBlock();
            }
        };

        lastBlock = await getLastBlock();

        if (!lastBlock) {
            this.logger.warning("No block found in database :hushed:");
            lastBlock = await this.createGenesisBlock();
        }

        this.configureState(lastBlock);
    }

    private async createGenesisBlock(): Promise<Interfaces.IBlock> {
        const genesisBlock = this.stateStore.getGenesisBlock();
        await this.databaseService.saveBlocks([genesisBlock]);
        return genesisBlock;
    }

    private configureState(lastBlock: Interfaces.IBlock): void {
        this.stateStore.setLastBlock(lastBlock);
        const { blockTime, block } = Managers.configManager.getMilestone();
        const blocksPerDay: number = Math.ceil(86400 / blockTime);
        this.stateBlockStore.resize(blocksPerDay);
        this.stateTransactionStore.resize(blocksPerDay * block.maxTransactions);
    }

    private async emitTransactionEvents(transaction: Interfaces.ITransaction): Promise<void> {
        this.events.dispatch(Enums.TransactionEvent.Applied, transaction.data);
        const handler = await this.handlerRegistry.getActivatedHandlerForData(transaction.data);
        // ! no reason to pass this.emitter
        handler.emitEvents(transaction, this.events);
    }
}
