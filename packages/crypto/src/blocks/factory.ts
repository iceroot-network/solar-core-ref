import { Hash, HashAlgorithms } from "../crypto";
import { IBlock, IBlockData, IBlockJson, IKeyPair, ITransaction } from "../interfaces";
import { configManager } from "../managers/config";
import { BigNumber } from "../utils";
import { Block } from "./block";
import { Deserialiser } from "./deserialiser";
import { Serialiser } from "./serialiser";

export class BlockFactory {
    public static make(data: IBlockData, keys: IKeyPair, aux?: Buffer): IBlock {
        data.generatorPublicKey = keys.publicKey.secp256k1;

        const payloadHash: Buffer = Serialiser.serialise(data, false);
        const hash: Buffer = HashAlgorithms.sha256(payloadHash);

        // Blocks are always signed with BIP340, whatever the milestone's bip340 says
        data.blockSignature = Hash.signSchnorr(hash, keys, true, aux);
        data.id = Block.getId(data);

        return this.fromData(data)!;
    }

    public static fromHex(hex: string): IBlock {
        return this.fromSerialised(Buffer.from(hex, "hex"));
    }

    public static fromBytes(buff: Buffer): IBlock {
        return this.fromSerialised(buff);
    }

    public static fromJson(json: IBlockJson): IBlock | undefined {
        const data: IBlockData = { ...json } as unknown as IBlockData;
        data.totalAmount = BigNumber.make(data.totalAmount);
        data.totalFee = BigNumber.make(data.totalFee);
        data.reward = BigNumber.make(data.reward);

        if (data.transactions) {
            for (const transaction of data.transactions) {
                if (transaction.amount) {
                    transaction.amount = BigNumber.make(transaction.amount);
                }
                transaction.fee = BigNumber.make(transaction.fee);
            }
        }

        return this.fromData(data);
    }

    public static fromData(
        data: IBlockData,
        options: { deserialiseTransactionsUnchecked?: boolean } = {},
    ): IBlock | undefined {
        // The transactions of block H are validated under the milestone at H
        return configManager.runAtHeight(data.height, () => {
            const block: IBlockData | undefined = Block.applySchema(data);

            if (block) {
                const serialised: Buffer = Serialiser.serialiseWithTransactions(data);
                const block: IBlock = new Block({
                    ...Deserialiser.deserialise(serialised, false, options),
                });

                if (block.data.version === 0) {
                    const username = data.username;
                    if (!block.data.username && username) {
                        block.data.username = username;
                    }
                }

                block.serialised = serialised.toString("hex");

                return block;
            }

            return undefined;
        });
    }

    private static fromSerialised(serialised: Buffer): IBlock {
        // The deserialiser decodes the transactions at the block's height; the rest runs at that height too
        const deserialised: { data: IBlockData; transactions: ITransaction[] } = Deserialiser.deserialise(serialised);

        return configManager.runAtHeight(deserialised.data.height, () => {
            const validated: IBlockData | undefined = Block.applySchema(deserialised.data);

            if (validated) {
                deserialised.data = validated;
            }

            const block: IBlock = new Block(deserialised);
            block.serialised = Serialiser.serialiseWithTransactions(block.data).toString("hex");

            return block;
        });
    }
}
