import { configManager } from "../managers/config";
import { BigNumber } from "./big-number";

// The merged milestone at the height is the value in force; a later reward: 0 or dynamicReward: null applies (L-57, L-60)
const getReward = (height: number): BigNumber => {
    return BigNumber.make(configManager.getMilestone(height).reward ?? 0);
};

const getDynamicReward = (height: number) => {
    return configManager.getMilestone(height).dynamicReward || {};
};

export const calculateReward = (height: number, rank: number): BigNumber => {
    const dynamicReward = getDynamicReward(height);
    const reward = getReward(height);

    if (dynamicReward.enabled) {
        if (typeof dynamicReward.ranks === "object" && typeof dynamicReward.ranks[rank] !== "undefined") {
            return dynamicReward.ranks[rank];
        }

        throw new Error(`No dynamic reward configured for rank ${rank}`);
    } else {
        return reward;
    }
};
