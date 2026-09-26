#!/usr/bin/env node
// Patch 42 shuffle-unbiased.
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
    // Rejection-path rounds added in s1-ref-v2. Each was computed from the rule alone,
    // not from Solar code. For n = 53 about one round in
    // 6.75 million rejects a draw. Counting from round 1, these are the 2nd, 3rd and 9th such rounds
    // (round 1,054,879 above is the 1st).
    // Round 1,125,219: the second rejection round. For i = 44 (bound 45), stream bytes 32-35 (the
    // first word of the second block) give r = 4294967279 >= 2^32 - (2^32 mod 45) = 4294967265.
    // Without the rejection the order would be 49,29,1,8,3,46,35,31,... instead.
    1125219:
        "4,40,38,13,21,49,15,1,26,28,37,7,31,47,39,34,33,27,43,20,42,17,51,41,45,2,29,32,5,46,12,23,18,48,0,8,16,50,3,24,25,35,11,6,19,36,52,14,44,9,10,22,30",
    // Round 6,447,578: the rejected draw lies deepest in the stream. For i = 23 (bound 24), stream
    // bytes 116-119 (the fourth block) give r = 4294967284 >= 2^32 - (2^32 mod 24) = 4294967280.
    // Without the rejection the order would be 11,0,35,41,7,40,33,23,... instead.
    6447578:
        "41,35,23,40,19,8,43,0,32,9,51,52,33,7,25,44,11,45,17,14,28,22,4,34,3,50,15,26,48,36,13,30,39,10,18,47,37,24,49,1,38,12,6,31,27,42,2,46,5,29,21,16,20",
    // Round 57,852,255: the rejected word is 2^32 - 1. For i = 32 (bound 33), stream bytes 80-83
    // (the third block) give r = 4294967295 >= 2^32 - (2^32 mod 33) = 4294967292.
    // Without the rejection the order would be 0,51,32,50,31,21,23,17,... instead.
    57852255:
        "1,13,47,14,6,45,50,46,29,44,31,42,20,52,48,23,0,21,4,32,22,17,51,33,7,2,12,28,19,43,30,5,34,35,11,26,16,8,40,37,39,9,3,38,18,15,24,41,25,49,36,27,10",
};

// The golden rounds above in which a draw is rejected, with the draw that is rejected.
const REJECTED_DRAW = {
    1054879: "i = 51, bound 52",
    1125219: "i = 44, bound 45",
    6447578: "i = 23, bound 24",
    57852255: "i = 32, bound 33",
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
    const rejection = REJECTED_DRAW[round] ? ` (rejection path: ${REJECTED_DRAW[round]})` : "";
    check(`round ${round}, 53 delegates: golden order${rejection}`, () => {
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
