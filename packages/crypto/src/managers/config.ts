import { AsyncLocalStorage } from "async_hooks";
import { base58 } from "bstring";
import deepmerge from "deepmerge";
import get from "lodash.get";
import set from "lodash.set";

import { HashAlgorithms } from "../crypto/hash-algorithms";
import { InvalidMilestoneConfigurationError } from "../errors";
import { IMilestone } from "../interfaces";
import { NetworkConfig } from "../interfaces/networks";
import * as networks from "../networks";
import { NetworkName } from "../types";

export interface MilestoneSearchResult {
    found: boolean;
    height: number;
    data: any;
}

export class ConfigManager {
    private config: NetworkConfig | undefined;
    private height: number | undefined;
    private milestone: IMilestone | undefined;
    private milestones: Record<string, any> | undefined;
    private readonly ruleHeight = new AsyncLocalStorage<number>();

    public constructor() {
        this.setConfig(networks.testnet as unknown as NetworkConfig);
    }

    public setConfig(config: NetworkConfig): void {
        this.config = {
            network: config.network,
            exceptions: config.exceptions,
            milestones: config.milestones,
            genesisBlock: config.genesisBlock,
        };

        this.validateMilestones();
        this.buildConstants();
        this.validateMergedMilestones();
    }

    public setFromPreset(network: NetworkName): void {
        this.setConfig(this.getPreset(network));
    }

    public getPreset(network: NetworkName): NetworkConfig {
        return networks[network.toLowerCase()];
    }

    public all(): NetworkConfig | undefined {
        return this.config;
    }

    public set<T = any>(key: string, value: T): void {
        if (!this.config) {
            throw new Error();
        }

        set(this.config, key, value);
    }

    public get<T = any>(key: string): T {
        return get(this.config, key);
    }

    public setHeight(value: number): void {
        this.height = value;
    }

    public getHeight(): number | undefined {
        return this.ruleHeight.getStore() ?? this.height;
    }

    // Runs fn with a scoped height that getHeight() and getMilestone() honour, along fn's own async chain only.
    // Transaction rules of block H read the milestone at H; the pool reads it at tip + 1
    public runAtHeight<T>(height: number, fn: () => T): T {
        return this.ruleHeight.run(height, fn);
    }

    public isNewMilestone(height?: number): boolean {
        height = height || this.height;

        if (!this.milestones) {
            throw new Error();
        }

        return this.milestones.some((milestone) => milestone.height === height);
    }

    public getMilestone(height?: number): { [key: string]: any } {
        if (!this.milestone || !this.milestones) {
            throw new Error();
        }

        const currentHeight = this.getHeight();
        if (!height && currentHeight) {
            height = currentHeight;
        }

        if (!height) {
            height = 1;
        }

        while (
            this.milestone.index < this.milestones.length - 1 &&
            height >= this.milestones[this.milestone.index + 1].height
        ) {
            this.milestone.index++;
            this.milestone.data = this.milestones[this.milestone.index];
        }

        while (height < this.milestones[this.milestone.index].height) {
            this.milestone.index--;
            this.milestone.data = this.milestones[this.milestone.index];
        }

        return this.milestone.data;
    }

    public getNextMilestoneWithNewKey(previousMilestone: number, key: string): MilestoneSearchResult {
        if (!this.milestones || !this.milestones.length) {
            throw new Error(`Attempted to get next milestone but none were set`);
        }

        for (let i = 0; i < this.milestones.length; i++) {
            const milestone = this.milestones[i];
            if (
                milestone[key] &&
                milestone[key] !== this.getMilestone(previousMilestone)[key] &&
                milestone.height > previousMilestone
            ) {
                return {
                    found: true,
                    height: milestone.height,
                    data: milestone[key],
                };
            }
        }

        return {
            found: false,
            height: previousMilestone,
            data: null,
        };
    }

    public getMilestones(): any {
        return this.milestones;
    }

    private buildConstants(): void {
        if (!this.config) {
            throw new Error();
        }

        this.milestones = this.config.milestones.sort((a, b) => a.height - b.height);
        this.milestone = {
            index: 0,
            data: this.milestones[0],
        };

        let lastMerged = 0;

        const overwriteMerge = (dest, source, options) => source;
        // A later milestone replaces the rank table and the donation list whole
        const replaceMerge = (key: string) =>
            key === "ranks" || key === "donations" ? (dest: any, source: any) => source : undefined;

        while (lastMerged < this.milestones.length - 1) {
            this.milestones[lastMerged + 1] = deepmerge(this.milestones[lastMerged], this.milestones[lastMerged + 1], {
                arrayMerge: overwriteMerge,
                customMerge: replaceMerge,
            });
            lastMerged++;
        }
    }

    private validateMilestones(): void {
        if (!this.config) {
            throw new Error();
        }

        const delegateMilestones = this.config.milestones
            .sort((a, b) => a.height - b.height)
            .filter((milestone) => milestone.activeDelegates);

        for (let i = 1; i < delegateMilestones.length; i++) {
            const previous = delegateMilestones[i - 1];
            const current = delegateMilestones[i];

            if (previous.activeDelegates === current.activeDelegates) {
                continue;
            }

            if ((current.height - previous.height) % previous.activeDelegates !== 0) {
                throw new InvalidMilestoneConfigurationError(
                    `Bad milestone at height: ${current.height}. The number of delegates can only be changed at the beginning of a new round`,
                );
            }
        }
    }

    // Start-up checks on the merged milestones: a bad file refuses to start instead of halting the chain
    private validateMergedMilestones(): void {
        if (!this.config || !this.milestones) {
            throw new Error();
        }

        for (const milestone of this.getMilestones()) {
            const fail = (message: string): never => {
                throw new InvalidMilestoneConfigurationError(
                    `Bad milestone at height: ${milestone.height}. ${message}`,
                );
            };

            const burn = milestone.burn;
            if (typeof burn !== "object" || burn === null || Array.isArray(burn)) {
                fail("burn must be an object with feeBasisPoints (9000 = 90%)");
            }
            if (Object.prototype.hasOwnProperty.call(burn, "feePercent")) {
                fail("burn.feePercent is not supported: the fee burn is set by burn.feeBasisPoints (9000 = 90%)");
            }
            if (!Number.isSafeInteger(burn.feeBasisPoints) || burn.feeBasisPoints < 0 || burn.feeBasisPoints > 10000) {
                fail("burn.feeBasisPoints must be an integer from 0 to 10000");
            }

            if (Object.prototype.hasOwnProperty.call(milestone, "donations")) {
                const donations = milestone.donations;
                if (typeof donations !== "object" || donations === null || Array.isArray(donations)) {
                    fail("donations must be an object that maps each address to { basisPoints, purpose }");
                }

                let sum = 0;
                for (const [address, donation] of Object.entries<any>(donations)) {
                    if (!this.isNetworkAddress(address)) {
                        fail(`donations: ${address} is not a valid address of this network`);
                    }
                    if (typeof donation !== "object" || donation === null || Array.isArray(donation)) {
                        fail(`donations.${address} must be an object with basisPoints`);
                    }
                    for (const key of Object.keys(donation)) {
                        if (key !== "basisPoints" && key !== "purpose") {
                            fail(
                                `donations.${address}.${key} is not allowed: a share is set by basisPoints (500 = 5%)`,
                            );
                        }
                    }
                    if (
                        !Number.isSafeInteger(donation.basisPoints) ||
                        donation.basisPoints < 1 ||
                        donation.basisPoints > 10000
                    ) {
                        fail(`donations.${address}.basisPoints must be an integer from 1 to 10000`);
                    }
                    if (donation.purpose !== undefined && typeof donation.purpose !== "string") {
                        fail(`donations.${address}.purpose must be a string`);
                    }
                    sum += donation.basisPoints;
                }

                if (sum > 10000) {
                    fail(`donations add up to ${sum} basis points, over 10000`);
                }
            }
        }
    }

    private isNetworkAddress(address: string): boolean {
        try {
            const buffer: Buffer = base58.decode(address);
            const payload: Buffer = buffer.slice(0, -4);

            return (
                payload.length === 21 &&
                HashAlgorithms.hash256(payload).slice(0, 4).equals(buffer.slice(-4)) &&
                payload[0] === this.config!.network.pubKeyHash
            );
        } catch {
            return false;
        }
    }
}

export const configManager = new ConfigManager();
