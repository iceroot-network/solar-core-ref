#!/usr/bin/env node
// Patch 42 shuffle-unbiased (L-97 (1)).
//
// RoundState.shuffleDelegates is a Durstenfeld Fisher-Yates shuffle over the input in Solar's order,
// driven by a SHA-256 byte stream:
//   seed    = SHA-256(UTF-8 decimal round number)
//   stream  = seed, SHA-256(seed), SHA-256 of that, ... (32 bytes per block)
//   draw(b) = next 4 bytes as u32 little-endian r; reject if r >= 2^32 - (2^32 mod b); else r mod b
//   for i from n-1 down to 1: j = draw(i + 1); swap a[i], a[j]
//
// Usage: SOLAR_DIR=<built Solar checkout> node 42-shuffle-unbiased.test.js
"use strict";

const crypto = require("crypto");
const path = require("path");

const SOLAR_DIR = path.resolve(process.env.SOLAR_DIR || path.join(__dirname, "..", ".."));
const { RoundState } = require(path.join(SOLAR_DIR, "packages/state/dist/round-state"));

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        const outcome = fn();
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

// Golden output indices: position k holds the input index shown (53 delegates).
const GOLDEN = {
    1: "8,15,41,21,36,47,40,50,38,10,35,16,20,31,4,48,1,18,34,0,25,46,42,9,3,22,17,13,39,28,45,33,30,6,44,7,26,51,24,43,19,37,12,29,32,49,14,2,23,5,11,52,27",
    2: "21,3,50,31,6,0,17,11,40,25,8,26,39,46,49,51,35,37,1,33,52,28,44,27,2,16,34,10,7,23,5,47,43,36,42,41,45,48,12,13,22,4,32,24,9,20,14,38,29,15,30,18,19",
    3: "29,28,24,31,26,2,23,11,33,5,43,1,32,37,51,50,42,18,21,49,45,19,40,0,12,34,27,20,39,10,46,22,9,44,3,48,47,13,8,35,14,36,25,6,17,7,15,52,16,4,41,30,38",
    100: "23,17,45,48,18,31,29,25,12,6,52,49,36,4,20,51,38,2,15,7,46,40,19,30,27,13,5,21,42,8,1,9,43,39,3,44,47,22,11,33,34,50,32,0,35,10,26,14,24,16,37,41,28",
    // Round 1,054,879 is the first round whose shuffle rejects a draw: for i = 51 (bound 52) the stream
    // gives r = 4294967283 >= 2^32 - (2^32 mod 52) = 4294967248, so the next 4 bytes are drawn. Without
    // the rejection the order would be 1,10,12,26,2,9,50,24,... instead.
    1054879:
        "17,7,10,1,12,14,35,11,8,40,26,20,3,28,18,16,4,43,5,27,31,48,29,15,39,34,42,32,49,44,41,38,45,24,13,46,50,33,37,51,21,2,25,47,30,9,0,36,19,52,6,22,23",
};

const STATS_ROUNDS = 200000;
const STAY_MIN = 0.0183;
const STAY_MAX = 0.0198;

const roundState = Object.create(RoundState.prototype);

const makeWallets = (count) =>
    Array.from({ length: count }, (_, index) => ({
        index,
        clone() {
            return { index, cloned: true };
        },
    }));

const shuffle = (round, wallets) => roundState.shuffleDelegates({ round }, wallets);
const order = (round, count) =>
    shuffle(round, makeWallets(count))
        .map((wallet) => wallet.index)
        .join(",");

// Solar 4.3.1's shuffle (round-state.ts:269-288), re-implemented here only to print its bias next to
// the shuffle under test.
function solar431Shuffle(round, count) {
    const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
    let currentSeed = sha256(Buffer.from(String(round), "utf8"));
    const delegates = Array.from({ length: count }, (_, index) => index);
    for (let i = 0, delCount = count; i < delCount; i++) {
        for (let x = 0; x < 4 && i < delCount; i++, x++) {
            const newIndex = currentSeed[x] % delCount;
            const b = delegates[newIndex];
            delegates[newIndex] = delegates[i];
            delegates[i] = b;
        }
        currentSeed = sha256(currentSeed);
    }
    return delegates;
}

function stayProbabilities(shuffleIndices) {
    const stays = new Array(53).fill(0);
    for (let round = 1; round <= STATS_ROUNDS; round++) {
        const indices = shuffleIndices(round);
        for (let position = 0; position < 53; position++) {
            if (indices[position] === position) {
                stays[position]++;
            }
        }
    }
    return stays.map((count) => count / STATS_ROUNDS);
}

function summary(probabilities) {
    const max = Math.max(...probabilities);
    const min = Math.min(...probabilities);
    return `min ${min.toFixed(5)} at position ${probabilities.indexOf(min)}, max ${max.toFixed(
        5,
    )} at position ${probabilities.indexOf(max)}`;
}

console.log(`SOLAR_DIR=${SOLAR_DIR}`);

for (const round of Object.keys(GOLDEN)) {
    check(`round ${round}, 53 delegates: golden order`, () => {
        const got = order(Number(round), 53);
        return got === GOLDEN[round] ? true : `got ${got}`;
    });
}

check("n = 1 gives 0", () => {
    const got = order(1, 1);
    return got === "0" ? true : `got ${got}`;
});
check("n = 2, round 7 gives 0,1", () => {
    const got = order(7, 2);
    return got === "0,1" ? true : `got ${got}`;
});
check("n = 3, round 7 gives 1,0,2", () => {
    const got = order(7, 3);
    return got === "1,0,2" ? true : `got ${got}`;
});
check("n = 0 gives an empty list", () => {
    const got = shuffle(1, []);
    return Array.isArray(got) && got.length === 0 ? true : `got ${JSON.stringify(got)}`;
});

check("the output is a permutation of clones and the input is not reordered", () => {
    const input = makeWallets(53);
    const output = shuffle(12345, input);
    const indices = output.map((wallet) => wallet.index).sort((a, b) => a - b);
    if (indices.join(",") !== input.map((wallet) => wallet.index).join(",")) {
        return `not a permutation: ${indices.join(",")}`;
    }
    if (!output.every((wallet) => wallet.cloned === true)) {
        return "an output entry is not a clone";
    }
    return input.every((wallet, position) => wallet.index === position) ? true : "the input array was reordered";
});

const solarProbabilities = stayProbabilities((round) => solar431Shuffle(round, 53));
console.log(`INFO Solar 4.3.1 shuffle, rounds 1-${STATS_ROUNDS}, P(stay): ${summary(solarProbabilities)}`);

const testedProbabilities = stayProbabilities((round) => shuffle(round, makeWallets(53)).map((wallet) => wallet.index));
console.log(`INFO shuffle under test, rounds 1-${STATS_ROUNDS}, P(stay): ${summary(testedProbabilities)}`);

check(`rounds 1-${STATS_ROUNDS}: P(stay) is between ${STAY_MIN} and ${STAY_MAX} at every position`, () => {
    const outside = testedProbabilities
        .map((probability, position) => ({ probability, position }))
        .filter(({ probability }) => probability < STAY_MIN || probability > STAY_MAX);
    return outside.length === 0
        ? true
        : `${outside.length} positions outside, for example ${outside
              .slice(0, 3)
              .map(({ probability, position }) => `${position}: ${probability.toFixed(4)}`)
              .join(", ")}`;
});

console.log(`42-shuffle-unbiased: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
