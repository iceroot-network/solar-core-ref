# Solar 4.3.1 reference patch series for IceRoot Stage 1 (S1)

| Item | Value |
|---|---|
| Status | Plan, written 2026-09-25. No patch is applied yet |
| Base | Solar Core 4.3.1, `b45369d7da143ab246f2d19b28ed9fb77fc99f36`, branch `iceroot-ref` of this repository (local clone, no remote) |
| Authority | `docs/iceroot/decision-ledger.md` (LOCKED rows). Row numbers below are `L-nn` |
| Result | Tag `s1-ref-v1`: Solar 4.3.1 plus the patches below. It is the TypeScript reference that Heartwood must match byte for byte in S1 |
| Read-only | `/home/vortex/workspace/solar-core` is never modified. All work happens here and in `/home/vortex/workspace/solar-ref-work/*` |

## Contents

1. What this series is
2. Verified build recipe
3. Ledger rows and the patches they require
4. Groups, worktrees, numbering and integration
5. Test conventions
6. Patch specifications, group by group (G1, G2, G3, G4)
7. Devnet switch-over after integration
8. What is not patched, and why
9. Risks and implementation notes

---

## 1. What this series is

- **Principle (L-51, L-57).** The TypeScript reference may be patched. Deterministic consensus quirks are fixed in S1, in the patched reference and in Heartwood alike, "each by a numbered TypeScript patch with test vectors, mirrored in Heartwood" (L-57, L-97). The removals of L-33 and L-43 are in the patch scope too. L-150 adds one API patch.
- **Mechanism (L-51, PROPOSED in the ledger, used here).** The pristine clone stays read-only. The reference is Solar 4.3.1 plus a numbered series, `patches/series/00NN-<slug>.patch`, applied in number order at build time. Each patch is minimal ("patch, don't refactor"), carries its own test script, and is mirrored by an identical rule in Heartwood, so differential tests stay clean.
- **A patched quirk is not a divergence.** Once both implementations carry the same rule, the difference from Solar 4.3.1 lives only in this series. Two existing register items end with it: L-33's intentional 1/5 divergence (patch 01) and ED-07, the fail-open generator check (patch 41).
- **Every rule stays as in Solar unless a patch below changes it.** L-24's REPRODUCE-until-ID rule still covers every quirk not listed here (section 8).
- **No activation height.** The series defines the rules of a new devnet from height 1; existing devnets are regenerated (section 7), which L-141 allows for devnets. L-133's activation heights govern rule changes on a running network, not this series.

---

## 2. Verified build recipe

Built from a clean checkout on 2026-09-25 (vortex, Linux 6.14, x86_64), twice: once warm and once after `git clean -xdf`. Both builds passed.

```sh
# Toolchain. env.sh gives Node 18.20.8 and Rust. Its Python entry points at py310/bin, which does
# not exist; the real Python 3.10 is under py310/python/bin, so it is put on PATH explicitly.
source /home/vortex/workspace/tools/toolchain/env.sh
export PATH=/home/vortex/workspace/tools/toolchain/py310/python/bin:$PATH
export npm_config_python=/home/vortex/workspace/tools/toolchain/py310/python/bin/python3.10
export npm_config_nodedir=$TOOLCHAIN_NODE      # native addons build against the pinned Node headers

# A clean checkout (a worktree here; any clean checkout of the same commit works).
git -C /home/vortex/workspace/solar-ref worktree add --detach /home/vortex/workspace/solar-ref-work/baseline-build b45369d7
cd /home/vortex/workspace/solar-ref-work/baseline-build

# pnpm 6.32.11 exactly (Solar's install.sh version; lockfile v5.3). Never the system pnpm (10.30.3).
npx -y pnpm@6.32.11 install --frozen-lockfile --prefer-offline \
    --store-dir /home/vortex/workspace/solar-ref-work/.pnpm-store
npx -y pnpm@6.32.11 build

# Checks.
node /home/vortex/workspace/solar-devnet/docker/check-native.js "$PWD"
git status --porcelain            # must be empty: node_modules/ and dist/ are git-ignored
```

| Step | Result |
|---|---|
| Versions | Node v18.20.8, Python 3.10.15, pnpm 6.32.11, commit `b45369d7…` |
| Install | 37 s warm, 53 s after `git clean -xdf`. 1,463 packages: 1,383 reused from the store, 1 downloaded (`ngrok` 3.4.1; its postinstall used the cached binary in `~/.ngrok`) |
| Build | 17 s. `pnpm build -r` runs `rimraf dist && tsc` per package. 17 `dist/` directories (16 packages and `plugins/sxp-swap`) |
| Native modules | all load: `bcrypto` 5.4.0 (native backend), `better-sqlite3` 7.4.3, `node-pty` 0.10.1, `nsfw` 2.1.2, `argon2` 0.28.2 |
| Working tree after build | clean |
| CLI smoke test | `HOME=<tmp with an empty .solar/.env> node packages/core/bin/run help` prints the 4.3.1 banner. Without `~/.solar/.env` the CLI stops with ENOENT, a known Solar gotcha |

**Traps found.**
- `--offline` fails: `ERR_PNPM_NO_OFFLINE_TARBALL` for `ngrok-3.4.1.tgz`, which the store does not hold. The recipe therefore needs registry access for that one tarball, or the tarball vendored into the store. `--prefer-offline` takes everything else from the store.
- The system `pnpm` on `PATH` is 10.30.3. Always call `npx -y pnpm@6.32.11`.
- `tools/toolchain/env.sh` puts a non-existent `py310/bin` on `PATH`. Without the explicit `PATH` and `npm_config_python` lines, node-gyp falls back to the system Python 3.12, which node-gyp 7.1.2 cannot use.

**Incremental builds in a patch worktree.** After editing one package, `npx -y pnpm@6.32.11 --filter @solar-network/<package> build` rebuilds only that package (about 4 s, measured for `crypto` and `state`). Run a full `pnpm build` before a patch's final test run, because packages consume each other's `dist/`.

**The unpatched baseline stays built** in `/home/vortex/workspace/solar-ref-work/baseline-build` (detached at `b45369d7`). Every patch test is run against it once, where it must FAIL, and against the patched build, where it must PASS (section 5).

---

## 3. Ledger rows and the patches they require

| Row | What it requires in S1 | Patch |
|---|---|---|
| L-33 | 1/5 IPFS rejected in pool admission and block validation; ends the TS/Rust split | 01 |
| L-43, L-57 (removals), L-51 | Removed types and legacy signature paths disabled in the reference (the owner named HTLC) | 02, 24, 44 |
| L-57 | f64 vote sum becomes an integer basis-points check | 03 |
| L-57 | ICU vote ordering becomes bytewise | 04 |
| L-97 (4) | The identical-vote check works | 05 |
| L-179 | The 1,024-byte vote limit becomes an explicit rule with a clear error | 06 |
| L-57, L-64 | Milestone deep-merge footguns: `ranks` cannot shrink, the donation list merges instead of replacing | 20 |
| L-57, L-60 | The falsy-`reward` trap (a later `reward: 0` is ignored) | 21 |
| L-64, L-61 | Donations in integer basis points, replace semantics, validated at node start | 20, 22 |
| L-97 (5), L-26 (amended by L-97) | Fee burn in integer basis points, validated at node start | 23 |
| L-97 (3) | Transaction rules read the milestone at the block's own height H, not H−1 | 25 |
| L-52 | Explicit genesis issuance with an issuance counter; no negative balance, the genesis sender included | 40 |
| L-57 | The fail-open generator check becomes fail-closed | 41 |
| L-97 (1) | An unbiased delegate shuffle | 42 |
| L-97 (2) | `payloadLength` is validated | 43 |
| L-150 | "Received" no longer matches delegate registrations (API) | 60 |

The ten quirk fixes of L-57 and L-97, one by one: f64 vote sum (03), ICU ordering (04), fail-open generator check (41), falsy `reward` trap (21), `ranks` that cannot shrink (20), unbiased shuffle (42), `payloadLength` (43), milestone at height H (25), identical-vote check (05), fee-burn basis points (23). Donations' replace semantics and basis points (20, 22) come from L-64, which L-57 cites.

Rows checked and found to require no S1 patch are listed in section 8, with the reason.

---

## 4. Groups, worktrees, numbering and integration

### 4.1 Groups and file ownership

The four groups work in parallel. **No source file is touched by two groups**, so integration is a plain `git am` of all patches in number order.

| Group | Numbers | Title | Patches | Files it owns (paths under `packages/`) |
|---|---|---|---|---|
| G1 | 01-19 | Transactions and pool | 01-06 | `transactions/src/handlers/core/{ipfs,legacy-transfer,vote,htlc-lock,htlc-claim,htlc-refund}.ts`, `transactions/src/handlers/solar/vote.ts`, `crypto/src/validation/index.ts`, `crypto/src/utils/sort-votes.ts`, `crypto/src/transactions/types/solar/vote.ts`, `crypto/src/errors.ts` |
| G2 | 20-39 | Crypto config and milestones | 20-25 | `crypto/src/managers/config.ts`, `crypto/src/utils/reward-calculator.ts`, `crypto/src/utils/index.ts`, `crypto/src/interfaces/donation.ts`, `crypto/src/networks/{mainnet,testnet}/milestones.json`, `crypto/src/transactions/types/transaction.ts`, `crypto/src/blocks/{factory,deserialiser}.ts`, `state/src/block-state.ts`, `pool/src/{processor,service,collator}.ts` |
| G3 | 40-59 | State, consensus and genesis | 40-44 | `transactions/src/handlers/core/transfer.ts`, `state/src/state-builder.ts`, `state/src/stores/state.ts`, `kernel/src/contracts/state/state-store.ts`, `blockchain/src/processor/block-processor.ts`, `state/src/round-state.ts`, `crypto/src/blocks/block.ts` |
| G4 | 60-69 | API | 60 | `database/src/transaction-filter.ts` |

Notes on the split:
- The pool files are in G2, not G1, because the only pool change is part of patch 25 (the height at which the pool judges a transaction). G1 has no pool change: none of its rows touches pool code.
- Patch 25 touches `state/src/block-state.ts`. No G3 patch touches that file.
- The legacy-signature removal is split by file: G2's patch 24 changes the signing and format side (`utils/index.ts`, `blocks/factory.ts`), G3's patch 44 changes block validity (`blocks/block.ts`).
- Test scripts are per patch (`patches/tests/NN-*.test.js`), so groups never edit the same test file.

### 4.2 Worktrees and branches

Created from `iceroot-ref` after this plan is committed (so each branch carries the plan, and its code is `b45369d7`):

```sh
cd /home/vortex/workspace/solar-ref
git worktree add -b s1/g1-tx-pool        /home/vortex/workspace/solar-ref-work/g1 iceroot-ref
git worktree add -b s1/g2-config         /home/vortex/workspace/solar-ref-work/g2 iceroot-ref
git worktree add -b s1/g3-state-genesis  /home/vortex/workspace/solar-ref-work/g3 iceroot-ref
git worktree add -b s1/g4-api            /home/vortex/workspace/solar-ref-work/g4 iceroot-ref
# then, in each worktree, the install and build of section 2 (the shared store makes install fast)
```

### 4.3 One commit per patch

- One patch = one commit on the group branch, in the order given in section 6. The commit holds the source change and its test script, and nothing else.
- Subject: `<slug>: <what changes, in plain English>`. Body: the rule in two or three sentences, then trailers `Patch: NN`, `Ledger: L-nn[, L-nn]`, `Consensus: yes|no`.
- No refactoring, no formatting changes outside the changed lines, no dependency changes. `pnpm lint` (eslint over `packages/*/src`) must stay clean for the touched files.
- Before handing over, each group rebases its branch on `iceroot-ref`, rebuilds from clean, and runs all of its tests against its branch (PASS) and against `baseline-build` (FAIL).

### 4.4 Integration

1. Export each group's commits into the series directory, numbered from the group's first number:
   ```sh
   cd /home/vortex/workspace/solar-ref
   git format-patch --start-number  1 -o patches/series iceroot-ref..s1/g1-tx-pool
   git format-patch --start-number 20 -o patches/series iceroot-ref..s1/g2-config
   git format-patch --start-number 40 -o patches/series iceroot-ref..s1/g3-state-genesis
   git format-patch --start-number 60 -o patches/series iceroot-ref..s1/g4-api
   ```
2. Write `patches/series/SERIES.md`: one line per patch (number, slug, ledger rows, consensus yes/no, SHA-256 of the `.patch` file). This is the reference-change register that L-51 asks for, and the oracle build (Heartwood B0) checks these hashes.
3. Commit `patches/series/` and `SERIES.md` on `iceroot-ref`.
4. Build the integration branch in its own worktree from the pristine base, and apply the series in number order:
   ```sh
   git -C /home/vortex/workspace/solar-ref worktree add -b s1-ref /home/vortex/workspace/solar-ref-work/s1-ref b45369d7
   cd /home/vortex/workspace/solar-ref-work/s1-ref
   git am /home/vortex/workspace/solar-ref/patches/series/*.patch     # no conflict and no fuzz allowed
   ```
5. Clean build (section 2), then run every test in `patches/tests/` (all PASS), then the devnet checks of section 7.
6. Tag `s1-ref-v1` on `s1-ref`.

Later fixes to a patch are made on its group branch and re-exported. A released series is never edited in place: a correction gets a new patch number and a new tag (`s1-ref-v2`).

---

## 5. Test conventions

- **Location and name.** `patches/tests/NN-<slug>.test.js`, one per patch, added by the patch's own commit.
- **Runtime.** Plain Node 18.20.8, no test framework, no new npm dependency. The script loads Solar from `SOLAR_DIR` (default: the repository root two levels up), through the built `dist/` of each package, for example `require(path.join(SOLAR_DIR, "packages/crypto/dist"))`.
- **Output.** One line per check, `PASS <name>` or `FAIL <name>: <detail>`, then a summary line. Exit code 0 only if every check passed.
- **Base versus patched.** `SOLAR_DIR=/home/vortex/workspace/solar-ref-work/baseline-build node patches/tests/NN-*.test.js` must exit 1 (the unpatched behaviour is shown), and the same script against the patched build must exit 0. A test that needs an API added by a later patch (for example `runAtHeight`) reports FAIL, not a crash, when the API is missing.
- **Self-contained.** No shared helper file across groups. A test that needs a network configuration builds it inline from this template, so every test is valid under the new start-up checks of patches 22 and 23:
  - `network`: the devnet `network.json` shape (name `devnet`, `pubKeyHash` 90, `wif` 252, `slip44` 1, testnet `bip32`, any 64-hex `nethash`);
  - `milestones`: one height-1 milestone with the merged D1 rules the test needs, using `burn: {feeBasisPoints: 9000, txAmount: 2000000}` and `donations: {}` (before patch 23 Solar ignores the unknown key, which no G1 test depends on);
  - `genesisBlock`: `{ transactions: [] }` unless the test is about genesis;
  - `exceptions`: `{}`.
- **Kernel-level code** (handlers, block processor, round state, block state, pool, filter) is tested without booting a node: the script creates the instance with `Object.create(Class.prototype)`, assigns stub objects to the injected properties the method uses, and calls the method directly. Stubs record what the code observed, for example the milestone height seen inside a handler.
- **Golden values** are written into the test as literals. The values in section 6 were computed for this plan with small independent scripts (plain Node `crypto` and `BigInt`, not Solar code); the patched code must reproduce them.
- **Devnet checks** (section 7) are separate. They show the rule on a running node; the unit test shows it on the function.

---

## 6. Patch specifications

Each entry gives: the ledger rows, the exact change, the files, the test with its golden values, the devnet impact (`/home/vortex/workspace/solar-devnet`, profile `iceroot-s1`), and how Heartwood mirrors the rule. Line numbers are at `b45369d7`.

### G1: transactions and pool (01-19)

#### 01 `ipfs-type-removed` (L-33; L-57 removals; consensus: yes)

- **Change.** `IpfsTransactionHandler.isActivated()` returns `false` (`transactions/src/handlers/core/ipfs.ts:55-57`). The handler stays bound (`transactions/src/service-provider.ts:59`), so the registry knows the type and throws `DeactivatedTransactionHandlerError` ("Transaction type Core/5 is deactivated"). That rejects 1/5 in pool admission (`pool/src/sender-state.ts:52`, pool code `ERR_OTHER`) and in block application (`state/src/block-state.ts:90`, the block is rejected). No other file changes.
- **Files.** `packages/transactions/src/handlers/core/ipfs.ts`.
- **Test** `01-ipfs-type-removed.test.js`. Build a `TransactionHandlerRegistry` from `Object.create` instances of all 13 handler classes with a stub provider; with the D1 height-1 milestone, `getActivatedHandlerForData({typeGroup: 1, type: 5})` rejects with `DeactivatedTransactionHandlerError` and the message `Transaction type Core/5 is deactivated`; the six kept types (1/1, 1/2, 1/6, 1/7, 2/0, 2/2) still resolve. A 1/5 built with `BuilderFactory.ipfs()` still serialises and decodes (the codec is untouched; only activation changes).
- **Devnet impact.** `tools/txgen.js` gains a negative scenario `removed-ipfs-1-5`, expected `R("ERR_OTHER", /Transaction type Core\/5 is deactivated/)`, built beside the other `removed-*` scenarios (lines 1191-1230); the builder's IPFS guard (line 270) is relaxed for that one negative scenario only. The DC-14 and DC-15 notes "TS Solar 4.3.1 still accepts 1/5" and the README item under "Not yet applied" are updated.
- **Heartwood mirror.** Heartwood has no 1/5 type (L-33): its decoder rejects type group 1, type 5, in pool admission and block validation. The accept/reject verdict now matches; the rejection stage and error code follow candidate C-2 of `docs/direction/06` §7.3. L-33's divergence entry is retired.

#### 02 `removed-types-inactive` (L-43; L-57 removals; L-51; consensus: yes, config-dependent only)

- **Change.** The removed types are inactive whatever the milestone says, and the Solar vote is active whatever `legacyVote` says:
  - `LegacyTransferTransactionHandler.isActivated()` (1/0, `legacy-transfer.ts:52-54`) returns `false` instead of `milestone.legacyTransfer`;
  - `LegacyVoteTransactionHandler.isActivated()` (1/3, `core/vote.ts:79-81`) returns `false` instead of `milestone.legacyVote`;
  - `HtlcLock`, `HtlcClaim` and `HtlcRefund` `isActivated()` (1/8-1/10, `htlc-lock.ts:85-87`, `htlc-claim.ts:55-57`, `htlc-refund.ts:61-63`) return `false` instead of `milestone.htlcEnabled`;
  - `VoteTransactionHandler.isActivated()` (2/2, `solar/vote.ts:56-58`) returns `true` instead of `!milestone.legacyVote`;
  - 1/4 (`multi-signature-registration.ts:60-62`) is already hard-coded `false` and is not touched.
- **Files.** `transactions/src/handlers/core/{legacy-transfer,vote,htlc-lock,htlc-claim,htlc-refund}.ts`, `transactions/src/handlers/solar/vote.ts` (the `isActivated` method only).
- **Test** `02-removed-types-inactive.test.js`. With a height-1 milestone that sets `legacyTransfer: true`, `legacyVote: true` and `htlcEnabled: true`, `isActivated()` is `false` for 1/0, 1/3, 1/4, 1/8, 1/9 and 1/10, and `true` for 2/2. The base build shows the opposite for all six configurable ones.
- **Devnet impact.** None on generated networks: their milestone already has `legacyTransfer: false`, `legacyVote: false` and no `htlcEnabled`, so the existing `removed-*` txgen scenarios keep their expected `ERR_OTHER … is deactivated` answers.
- **Heartwood mirror.** Heartwood never ports these types (L-43) and never reads the three flags. A milestone file that enables them is a config-only difference (Heartwood's strict schema refuses keys of removed features, L-137; section 8).

#### 03 `vote-sum-integer` (L-57; consensus: yes)

- **Change.** The `sumOfVotesEquals100` keyword (`crypto/src/validation/index.ts:33-41`) sums integer basis points instead of floats: `total += Math.round(+value * 100)`, then `total === 10000 || Object.keys(test).length === 0`. Each value has already passed `multipleOf: 0.01`, `minimum: 0.01` and `maximum: 100`, so `Math.round(value * 100)` is exactly the `u16` that the serialiser writes (`types/solar/vote.ts:28`) and the deserialiser reads (`:42`). A non-numeric value still gives `NaN` and fails, as before.
- **Files.** `packages/crypto/src/validation/index.ts`.
- **Test** `03-vote-sum-integer.test.js`. Golden values:
  - all 9,999 two-way cent splits (`a/100`, `(10000-a)/100`) pass the vote schema. The base build rejects exactly 40 of them, starting `18.10/81.90 18.15/81.85 18.35/81.65 18.40/81.60 18.60/81.40 18.65/81.35 18.85/81.15 18.90/81.10 19.10/80.90 19.15/80.85 19.35/80.65 19.40/80.60`; the test holds the full list of 40;
  - `{a: 50, b: 49.99}` is rejected, `{}` is accepted, `{a: 100}` is accepted;
  - a vote decoded from bytes with basis points `1810` and `8190` passes strict `TransactionFactory.fromBytes`.
- **Devnet impact.** txgen's `vote-float-18.10-81.90`, `vote-float-80.10-19.90` and `vote-float-3way` (lines 1260-1276, now `R("ERR_BAD_DATA", /sumOfVotesEquals100/)`) become accepted scenarios. `vote-sum-99.99` stays rejected. `docs/DESIGN-CHOICES.md` "Vote percentages" is updated.
- **Heartwood mirror.** The vote validator sums the decoded `u16` basis points as an integer and requires 10,000 (or no entries). From JSON input it applies Solar's `multipleOf 0.01` rule first, then converts with `round(value × 100)`. No `f64` addition remains on this path.

#### 04 `vote-order-bytewise` (L-57; consensus: yes)

- **Change.** `sortVotes` (`crypto/src/utils/sort-votes.ts:1-13`) keeps "percent descending" and replaces the tie-break `a[0].localeCompare(b[0], "en", { numeric: true })` with a plain code-unit comparison: `a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0`. Delegate names are ASCII (`[a-z0-9!@$&_.]`, `validation/schemas.ts:61-67`), so this is byte order. The names always contain a non-digit, so `Object.fromEntries` never reorders integer-like keys.
- **Where the order matters.** The builder (`builders/transactions/solar/vote.ts:45`) and the handler's wallet `votes` Map (`handlers/solar/vote.ts:52, 146`). The Map order decides which delegates receive the remainder units when a voter's balance is split (`state/src/wallets/wallet.ts:307-344`: the i-th remainder unit goes to the i-th Map key), so the order is consensus-visible through `delegate.voteBalance`.
- **Files.** `packages/crypto/src/utils/sort-votes.ts`.
- **Test** `04-vote-order-bytewise.test.js`. Golden values:
  - `sortVotes({a9: 25, a10: 25, b2: 25, b10: 25})` has key order `a10, a9, b10, b2` (base: `a9, a10, b2, b10`);
  - `sortVotes({x: 60, a: 40})` stays `x, a` (percent first);
  - `Wallet.calculateVoteAmount({balance: 101, lockedBalance: 0}, map)` with the Map built from `sortVotes({a9: 50, a10: 50})` gives `a10` 51 and `a9` 50 (base: `a9` 51).
- **Devnet impact.** Vote transactions built through the SDK builder list multi-entry votes in the new order, so the ids of txgen's multi-way vote transactions change (they stay reproducible for the same seeds). No expected verdict changes.
- **Heartwood mirror.** `utils::sort_votes` orders by basis points descending, then by the name's bytes ascending. The wallet's vote map is an `IndexMap` in that order, and the remainder distribution follows it. The ICU collation vectors for votes (06 §3.1 class 8) are dropped; the class keeps only the public-key tie-break of delegate ranking, which is bytewise already.

#### 05 `identical-vote-check` (L-97 (4); consensus: yes)

- **Change.** In `VoteTransactionHandler.throwIfCannotBeApplied` (`transactions/src/handlers/solar/vote.ts:73-78`), compare the new votes with the wallet's votes as plain objects: `AppUtils.isEqual(transaction.data.asset.votes, Object.fromEntries(wallet.getAttribute("votes", new Map())))`. Then, as before, `NoVoteError` when the new votes are empty, else `AlreadyVotedForSameDelegatesError`. `fast-deep-equal` compares objects regardless of key order, so the same names with the same percentages match in any order. The check keeps its place: after the more-than-`activeDelegates` check, before the unknown-delegate check.
- **Files.** `packages/transactions/src/handlers/solar/vote.ts` (this method only; patch 02 touched `isActivated` in the same file).
- **Test** `05-identical-vote-check.test.js`, with a stub wallet repository and a stub sender wallet:
  - wallet votes `Map{genesis_1: 60, genesis_2: 40}`, new votes `{genesis_2: 40, genesis_1: 60}`: throws `AlreadyVotedForSameDelegatesError` ("these votes are identical to the existing votes");
  - wallet votes empty `Map{}`, new votes `{}`: throws `NoVoteError` ("the wallet has not voted");
  - wallet votes `Map{genesis_1: 60, genesis_2: 40}`, new votes `{genesis_1: 100}` or `{}`: neither identity error (the test stubs the base-class check).
- **Devnet impact.** txgen's `revote-identical` (line 1467) and `unvote-without-vote` (line 1397), accepted today as Solar quirks, become rejections: `R("ERR_APPLY", /identical to the existing votes/)` and `R("ERR_APPLY", /has not voted/)`. The "Votes: identity checks never fire" paragraph of DESIGN-CHOICES and TESTED C.9 is updated.
- **Heartwood mirror.** The vote handler compares the new `(name, basis points)` set with the wallet's current set; equal and empty gives `NoVoteError`, equal and non-empty gives `AlreadyVotedForSameDelegatesError`, at the same point in the check order.

#### 06 `vote-size-limit` (L-179; consensus: yes, same accept set as Solar)

- **Change.** Solar's vote asset is written into a fixed `Buffer.alloc(1024)` (`crypto/src/transactions/types/solar/vote.ts:21`); a larger asset makes `serialise()` throw a `RangeError` or "Write over buffer boundary", which is why a 53-way vote with 20-character names (1,220 bytes) is invalid today. The patch makes the same limit explicit:
  - in `serialise()`, compute `size = 1 + Σ (3 + Buffer.byteLength(name))` first, and throw `VoteAssetTooLargeError(size)` when `size > 1024`;
  - in `deserialise()`, record `buf.getOffset()` before the asset and throw the same error when the asset consumed more than 1,024 bytes;
  - add `export class VoteAssetTooLargeError extends CryptoError` to `crypto/src/errors.ts`, message `Vote asset is <size> bytes, over the 1024-byte limit`.
  An asset of exactly 1,024 bytes stays valid (Solar's buffer holds it exactly).
- **Files.** `packages/crypto/src/transactions/types/solar/vote.ts`, `packages/crypto/src/errors.ts`.
- **Test** `06-vote-size-limit.test.js`. Golden values: 44 names of 20 characters plus one of 8 characters, with basis points summing to 10,000, give an asset of exactly **1,024** bytes: it builds, serialises and round-trips through strict `fromBytes`. Making the last name 9 characters gives **1,025** bytes: building throws `VoteAssetTooLargeError` with "1025", and hand-made bytes with that asset fail `fromBytes` with the same error. The base build rejects the 1,025-byte case too, with a different error, so this test checks the error class and message.
- **Devnet impact.** None: a vote for all 53 genesis names (`genesis_1` to `genesis_53`, 12 or 13 bytes per entry) is 681 bytes. Exercising the limit on a devnet would need about 45 extra 20-character delegates, so the unit test covers it.
- **Heartwood mirror.** The vote codec rejects an asset over 1,024 bytes with a typed error, at encode and at decode. The accept set is Solar's.

### G2: crypto config and milestones (20-39)

All start-up validation lives in one new private method of `ConfigManager`, `validateMergedMilestones()`, created by patch 22 and extended by patch 23. `setConfig()` (`crypto/src/managers/config.ts:27-37`) calls it after `buildConstants()`. It throws `InvalidMilestoneConfigurationError` naming the height and the key, so a node refuses to start on a bad file (L-64: "A bad configuration refuses to start instead of halting the chain"). Solar's built-in presets are loaded at import time (`new ConfigManager()` loads `testnet`), so patches 22 and 23 also convert `crypto/src/networks/{mainnet,testnet}/milestones.json` to the new keys.

#### 20 `milestone-merge-replace` (L-57, L-64; consensus: yes, config-dependent)

- **Change.** In `buildConstants()` (`config.ts:141-162`), pass `customMerge` to `deepmerge`: for the keys `ranks` (inside `dynamicReward`) and `donations`, the later milestone's value replaces the earlier one instead of being merged into it: `customMerge: (key) => (key === "ranks" || key === "donations" ? (_dest, source) => source : undefined)`. Arrays keep the existing overwrite rule. `deepmerge` 4.2.2 supports `customMerge`.
- **Files.** `packages/crypto/src/managers/config.ts`.
- **Test** `20-milestone-merge-replace.test.js`. Milestones `[{height 1, dynamicReward ranks 1..53, donations {A: …, B: …}}, {height 100, dynamicReward ranks 1..51}, {height 200, donations {A: …}}, {height 300, donations {}}]`: `getMilestone(150).dynamicReward.ranks` has 51 keys (base 53); `getMilestone(250).donations` has only `A` (base `A` and `B`); `getMilestone(350).donations` is `{}` (base `A` and `B`). Solar's mainnet and testnet presets give the same merged values as before at every milestone height (their later donation entries restate the full list).
- **Devnet impact.** None: generated networks have one height-1 milestone plus the height-2 donations milestone (DC-1), which merge the same way. HARDEN's milestone drills (L-167) rely on it.
- **Heartwood mirror.** The milestone loader deep-merges objects, replaces arrays, and replaces `dynamicReward.ranks` and `donations` as whole values.

#### 21 `reward-lookup-merged` (L-57, L-60; consensus: yes, config-dependent)

- **Change.** In `crypto/src/utils/reward-calculator.ts:4-32`, `getReward(height)` becomes `BigNumber.make(configManager.getMilestone(height).reward ?? 0)` and `getDynamicReward(height)` becomes `configManager.getMilestone(height).dynamicReward || {}`. Solar walks the milestone list backwards and skips a falsy value, so a later `reward: 0` (or `dynamicReward: null`) silently brings an older value back. The merged milestone at the height is the value in force.
- **Files.** `packages/crypto/src/utils/reward-calculator.ts`.
- **Test** `21-reward-lookup-merged.test.js`. Milestones `[{height 1, reward "500000000", dynamicReward {enabled: false}}, {height 100, reward 0}]`: `calculateReward(150, 1)` is `0` (base `500000000`). Milestones `[{height 1, reward 0, dynamicReward {enabled: true, ranks …, secondaryReward …}}, {height 100, dynamicReward null}]`: `calculateReward(150, 1)` is the height-1 `reward` 0 (base: the rank value). The five L-59 tiers at height 1 give 180,000,000 / 190,000,000 / 200,000,000 / 210,000,000 / 220,000,000 for ranks 1, 11, 22, 33, 44, unchanged.
- **Devnet impact.** None for the current single rule set.
- **Heartwood mirror.** `reward_calculator` reads the merged milestone at the height: `reward` (0 when absent) and `dynamicReward` (absent or null means disabled).

#### 22 `donations-basis-points` (L-64, L-61; consensus: yes)

- **Change.**
  - `IDonation` (`crypto/src/interfaces/donation.ts`) becomes `{ basisPoints: number; purpose?: string }`.
  - `calculateDonations` (`crypto/src/utils/index.ts:103-116`) pays `reward.times(basisPoints).dividedBy(10000)` per entry (floored, `BigNumber` over `BigInt`), in the entry order of the merged milestone.
  - `validateMergedMilestones()` checks every merged milestone that has `donations`: it must be a plain object (not `null`, not an array); each key a valid address of the network being configured (Base58Check decodes, 21-byte payload, first byte equal to `config.network.pubKeyHash`); each value a plain object whose `basisPoints` is a safe integer from 1 to 10,000, with an optional string `purpose` and no other key (so a leftover `percent` is refused with a message that names `basisPoints`); the sum at most 10,000. `{}` is valid.
  - Presets: every `{"percent": 5, "purpose": …}` becomes `{"basisPoints": 500, "purpose": …}` (mainnet heights 671,988 and 1,812,866; testnet height 502,431).
- **Files.** `packages/crypto/src/interfaces/donation.ts`, `packages/crypto/src/utils/index.ts`, `packages/crypto/src/managers/config.ts`, `packages/crypto/src/networks/{mainnet,testnet}/milestones.json`.
- **Test** `22-donations-basis-points.test.js`. Golden values: with `{P1: {basisPoints: 500}, P2: {basisPoints: 500}}` at height 2, `calculateDonations(2, r)` gives 9,000,000 / 9,500,000 / 10,000,000 / 10,500,000 / 11,000,000 per recipient for `r` = 180,000,000 / 190,000,000 / 200,000,000 / 210,000,000 / 220,000,000. `setConfig` throws `InvalidMilestoneConfigurationError` for: a sum of 10,001; an entry `null`; `basisPoints` `"500"`, `NaN`, `0`, `1.5` or `10001`; an unknown key; `{percent: 5}`; an address with a bad checksum; an address with byte 30 on a byte-90 network; `donations: null`. `{}` and a sum of exactly 10,000 are accepted. Both presets still load.
- **Devnet impact.** The generator (`tools/lib/profiles.js:63-66`, `gen-network.js` `--donations`) writes `{"basisPoints": 500, "purpose": "placeholder-1"}` entries; `verify-network.js`, `diff-milestones.py` (lines 159-166) and `check-economics.js` read `basisPoints`. The height-2 start stays (DC-1): the genesis-block donation defect of TESTED A.4 is not a ledger item and is not patched. Amounts paid are unchanged (5 % of every tier is exact).
- **Heartwood mirror.** Donations are `(address, basis points)` pairs, validated at start with the same rules and messages in spirit; payout is `floor(reward × bps / 10000)` per entry in file order. The same refusals are L0 config vectors (catalogue class V12 in `heartwood/docs/B0-B1-PLAN.md`).

#### 23 `burn-basis-points` (L-97 (5), L-26 as amended; consensus: yes, identical results at 9,000)

- **Change.**
  - `Transaction.setBurnedFee(height)` (`crypto/src/transactions/types/transaction.ts:76-86`) becomes `burnedFee = fee.times(burn.feeBasisPoints).dividedBy(10000)`; the `typeof … === "number"` guard and the `parseInt` go.
  - `validateMergedMilestones()` requires, at every merged milestone, `burn` to be an object with `feeBasisPoints` a safe integer from 0 to 10,000, and refuses a `feePercent` key with a message that names `feeBasisPoints` (9,000 = 90 %). `burn.txAmount` is not changed.
  - Presets: `"burn": {"feePercent": 90, …}` becomes `"burn": {"feeBasisPoints": 9000, …}` (height 1 of both).
- **Files.** `packages/crypto/src/transactions/types/transaction.ts`, `packages/crypto/src/managers/config.ts`, `packages/crypto/src/networks/{mainnet,testnet}/milestones.json`.
- **Test** `23-burn-basis-points.test.js`. Golden values: fee 1,000,026 burns **900,023**; fee 7,500,411,055 burns **6,750,369,949**; for every fee from 0 to 2,000,000 in steps of 7, `floor(fee × 9000 / 10000)` equals Solar's `floor(fee × 90 / 100)` (0 differences). `setConfig` throws for `feeBasisPoints` `"9000"`, `90.5`, `-1` and `10001`, for a missing `burn`, and for `{feePercent: 90}`. The base build accepts `feePercent: "90"` and burns 0.
- **Devnet impact.** The generator writes `"burn": {"feeBasisPoints": 9000, "txAmount": 2000000}`. `diff-milestones.py` must read the mainnet preset of the patched build (`SOLAR_DIR`, or `--mainnet`), not the read-only `solar-core`, whose preset still has `feePercent`. `check-economics.js` and `check-chain.js` keep their numbers (the burn equals Σ floor(fee × 0.9)).
- **Heartwood mirror.** The milestone field is `burn.fee_basis_points: u16` (0 to 10,000), validated at start; `burned = floor(fee × bps / 10000)` with a `u128` intermediate.

#### 24 `legacy-formats-off` (L-43; L-57 removals; L-51; consensus: yes, config-dependent only)

- **Change.**
  - `isSupportedTransactionVersion(version)` (`crypto/src/utils/index.ts:97-101`) returns `version === 3`, whatever `acceptLegacySchnorrTransactions` and `bip340` say. The deserialiser's `acceptLegacyVersion` and `disableVersionCheck` options (used by `fromBytesUnsafe` and the builders) are left as they are.
  - `BlockFactory.make` (`crypto/src/blocks/factory.ts:10-22`) always signs with BIP340 (`Hash.signSchnorr(hash, keys, true, aux)`) instead of reading `bip340` from the milestone.
- **Files.** `packages/crypto/src/utils/index.ts`, `packages/crypto/src/blocks/factory.ts`.
- **Test** `24-legacy-formats-off.test.js`. With a milestone that sets `bip340: false` and `acceptLegacySchnorrTransactions: true`: a version-2 transfer (built with `version(2)`) fails strict `TransactionFactory.fromBytes` with `TransactionVersionError`; a block from `BlockFactory.make` carries a signature that `Hash.verifySchnorr(hash, sig, key, true)` accepts. The base build accepts the v2 transfer and signs the block with legacy Schnorr.
- **Devnet impact.** None (`bip340: true`, `acceptLegacySchnorrTransactions: false` at height 1). txgen's `invalid-version-2` keeps `R("ERR_BAD_DATA", /Version 2 not supported/)`.
- **Heartwood mirror.** Heartwood has only v3 transactions and BIP340 block signatures in S1 (L-43); legacy Schnorr remains only for P2P status attestations (L-32).

#### 25 `rule-height-block` (L-97 (3); consensus: yes)

The rule, which Heartwood implements exactly:

| Context | Height whose milestone is read by transaction-level rules |
|---|---|
| Decoding and schema-checking the transactions of block H (bytes or data path) | H |
| Applying block H (every handler check), its events, and reverting block H | H |
| Pool admission (API, P2P), pool re-adds, and the collator's validation for the next block | tip + 1 |
| Everything else (API reads, P2P, the forger process, block-level rules that already pass an explicit height) | unchanged |

Transaction-level rules are those n09 Q08 lists: handler activation, the version gate, the dynamic fee, the vote cap (`activeDelegates`), `burn.txAmount`, transfer limits, `blocksToRevokeDelegateResignation` and the per-transaction serialiser buffer. The revoke delay itself (`lastBlock.height − R ≥ 106`, effectively R + 107) is a comparison with the last block, not a milestone lookup, and is not changed.

- **Change.**
  - `ConfigManager` (`config.ts`) gets a scoped height: `private readonly ruleHeight = new AsyncLocalStorage<number>()` (from Node's `async_hooks`), and `public runAtHeight<T>(height: number, fn: () => T): T { return this.ruleHeight.run(height, fn); }`. `getHeight()` (`:67-69`) returns `this.ruleHeight.getStore() ?? this.height`, and `getMilestone()` (`:81-108`) uses `this.ruleHeight.getStore() ?? this.height` when no height is passed. Outside a scope nothing changes. A scope follows its own `await` chain only, so concurrent API or P2P work never sees another task's height.
  - `blocks/deserialiser.ts:7-29`: the transaction part of `deserialise()` runs in `configManager.runAtHeight(block.height, …)` (synchronous).
  - `blocks/factory.ts:50-90`: the bodies of `fromData()` and `fromSerialised()` run in `runAtHeight(<block height>, …)`, which covers `Block.applySchema` (whose `block` schema validates the embedded transactions) and `serialiseWithTransactions`.
  - `state/src/block-state.ts:27-85`: `applyBlock` wraps the transaction loop, `applyBlockToForger` and `setLastBlock` in `await Managers.configManager.runAtHeight(block.data.height, async () => …)`; `revertBlock` wraps its body the same way (the global height is already H there; the scope makes it explicit). The events that `DatabaseInteraction` emits after `setLastBlock(H)` already read H.
  - Pool (`pool/src`): `Processor.process()` (`processor.ts:28`), `Service.readdTransactions()` (`service.ts:119`) and `Collator.getBlockCandidateTransactions()` (`collator.ts:26`) run their bodies in `runAtHeight(stateStore.getLastHeight() + 1, …)` (inject `StateStore` where it is not injected yet). The worker process gets the scoped height through `Managers.configManager.getHeight()` in `worker.ts:24`, which is called inside the scope, so `worker.ts` needs no change. The collator's block-size budget (`collator.ts:30-31`, milestone of the last block) is not changed: it is producer-side and not a transaction rule (n09 Q51).
- **Why the pool moves too.** With block apply at H and the pool still at the tip (H − 1), a milestone that tightens a transaction rule at H would let the pool and the collator put a transaction into block H that block H then rejects; every forger would retry the same invalid block. Judging pool transactions at the height of the block they are for keeps forging live across activation heights.
- **Files.** `packages/crypto/src/managers/config.ts`, `packages/crypto/src/blocks/deserialiser.ts`, `packages/crypto/src/blocks/factory.ts`, `packages/state/src/block-state.ts`, `packages/pool/src/processor.ts`, `packages/pool/src/service.ts`, `packages/pool/src/collator.ts`.
- **Test** `25-rule-height-block.test.js`. Milestones `[{height 1, transfer {minimum 1, maximum 256}}, {height 10, transfer {minimum 1, maximum 2}}]` and a 3-recipient transfer T:
  - `runAtHeight(9, () => fromBytes(T))` accepts, `runAtHeight(10, …)` rejects;
  - with the global height set to 9, a block at height 10 containing T is rejected by `BlockFactory.fromBytes` and by `fromData` (base: accepted); with the global height set to 10, a block at height 9 containing T is accepted (base: rejected), which is the sync case;
  - `BlockState.applyBlock` on a stub block at height 10, with a stub handler that records `configManager.getMilestone().height` inside `apply`, records 10 (base: 1, the height-1 milestone in force at 9);
  - `Processor.process` and `Collator.getBlockCandidateTransactions` with stubs, tip 9, record milestone height 10 inside the handler call;
  - two concurrent scopes (heights 9 and 10, interleaved with `await`) each see their own height.
- **Devnet impact.** None while the milestone file has no transaction-level change (heights 1 and 2 differ only in donations, a block-level value). HARDEN's milestone drills and the format-switch dry run (L-167) depend on it.
- **Heartwood mirror.** No global height: every rule takes `params_at(height)`. Block decode, apply, revert and events pass H; pool admission, re-adds and collation pass `tip + 1`. Scenario S-09 (06 §6) becomes a boundary test for exactly this table.

### G3: state, consensus and genesis (40-59)

#### 40 `genesis-issuance` (L-52; consensus: yes)

**The record (the encoding L-52 leaves to this patch).** The genesis bytes do not change. An *issuance record* is every transfer (type group 1, type 6) in the genesis block (height 1) whose `senderPublicKey` equals the genesis block's `generatorPublicKey`. Its transfer items credit their recipients; the sender is **not** debited (its nonce is still set, as for any transaction). The *issuance counter* `issued` is the sum of the amounts of those items (a `u64` in S1). S1 has no other issuance path, so `issued` is constant after genesis. After every block, Σ balances = issued + Σ rewards − Σ burned fees − Σ burn amounts (donations only move part of a reward), and no wallet balance is ever negative, the genesis sender included.

- **Change.**
  - `TransferTransactionHandler.bootstrap()` (`transactions/src/handlers/core/transfer.ts:24-48`): for a transaction with `blockHeight === 1` and `senderPublicKey === Managers.configManager.get("genesisBlock.generatorPublicKey")`, credit the recipients and skip `wallet.decreaseBalance(transfer.amount)`.
  - `StateBuilder.verifyWalletsConsistency()` (`state/src/state-builder.ts:113-147`): remove the exemption for the sender of `genesisBlock.transactions[0]`. A negative balance anywhere now fails the check. (The `negativeBalances` exceptions lookup stays; it is inert with `exceptions.json` = `{}`.)
  - `StateStore` (`state/src/stores/state.ts:54-66`) computes `issued` in `setGenesisBlock()` by the rule above and returns it from a new `getGenesisIssuance(): Utils.BigNumber`; the interface gains the method (`kernel/src/contracts/state/state-store.ts`).
  - Nothing applies the genesis block through `BlockState` on a running node (the block is saved and the state is built by `StateBuilder`), so `BlockState`'s height-1 branch is left alone.
- **Files.** `packages/transactions/src/handlers/core/transfer.ts`, `packages/state/src/state-builder.ts`, `packages/state/src/stores/state.ts`, `packages/kernel/src/contracts/state/state-store.ts`.
- **Test** `40-genesis-issuance.test.js`, on a stub genesis with the iceroot-s1 allocation (one 1/6 from the generator key with the three items below, written into the test as literals). When `$DEVNET_CRYPTO/genesisBlock.json` exists (default `/home/vortex/workspace/solar-devnet/networks/s1native/crypto`), the test also runs the checks on that real genesis:
  - the transfer bootstrap, with a stub history service that streams the genesis transfer and a stub wallet repository, leaves the generator at balance **0** (base: **−10,000,000,000,000,000**) and credits `team-placeholder-1` 3,400,000,000,000,000 and `genesis-1` and `genesis-2` 3,300,000,000,000,000 each;
  - `getGenesisIssuance()` is **10,000,000,000,000,000** (10¹⁶ units, 100,000,000 ROOT at 8 decimals);
  - a later transfer from the generator key (height 2) is debited normally;
  - `verifyWalletsConsistency()` throws when the genesis sender has a negative balance (base: exempt).
- **Devnet impact.**
  - The genesis bytes, nethash and genesis id are unchanged: the default seed still gives nethash `c9b03ab996ef3ac216a2ac53eaee71118cbf7995fa44449a7fb7f94bbe18bcca` and genesis id `fbdd5afb435e34729406ebc7d385727237bf386440799270536c39b9ee45605e` (107 transactions). The generator already emits the record in this shape (one 1/6 from the generator key, DC-2); it must keep every allocation in generator-signed genesis transfers, and it records `issued` in `network-summary.json`.
  - The generator key's wallet shows balance 0 in the API instead of −10¹⁶. `check-chain.js`'s supply invariant becomes Σ balances = issued + Σ rewards − Σ burned fees − Σ burned amounts (today it relies on the negative generator), and `check-economics.js` checks `issued` = 10¹⁶. The API's `supply` (sum of non-negative balances) keeps its value.
  - The DC-15 and README items "L-52: … the generator key holds −100,000,000 ROOT" are updated.
- **Heartwood mirror.** `heartwood-crypto::genesis` builds the same genesis bytes. `heartwood-state` applies the genesis block with the issuance rule and keeps `issued` as a state counter (the start of L-89's per-asset counters for ROOT). The supply invariant is a named invariant check after every block (06 §2.4).

#### 41 `generator-check-fail-closed` (L-57; consensus: yes)

- **Change.** In `BlockProcessor.validateGenerator` (`blockchain/src/processor/block-processor.ts:277-284`), when no delegate is found at the scheduled index (`!forgingDelegate`), log a warning and `return false` (reject the block) instead of logging at debug level and falling through to `return true`.
- **Files.** `packages/blockchain/src/processor/block-processor.ts`.
- **Test** `41-generator-check-fail-closed.test.js`. A `BlockProcessor` from `Object.create` with stubs: a wallet repository holding a ranked delegate whose public key matches the block; `triggers.call("getActiveDelegates")` returning a 10-entry list; a block timestamp whose slot maps to index 20. `validateGenerator(block)` resolves `false` (base: `true`). With the full 53-entry list and the right slot it resolves `true`; with the wrong delegate it resolves `false`, as before.
- **Devnet impact.** None on honest networks: the round list always has 53 entries there.
- **Heartwood mirror.** The generator check rejects when the schedule has no delegate at the index. ED-07 is retired: both implementations now reject.

#### 42 `shuffle-unbiased` (L-97 (1); consensus: yes; changes the forging order)

**The rule (the exact shuffle L-97 leaves to this patch).** Input: the round's delegates in the order Solar passes them today (rank order from `buildDelegateRanking`, or the saved round rows). Output: a permutation, by an unbiased Fisher-Yates (Durstenfeld) shuffle over a SHA-256 byte stream:

```text
seed   = SHA-256(UTF-8(decimal round number))            # Solar's seed source, unchanged
stream = bytes of seed, then SHA-256(seed), then SHA-256 of that, and so on (32 bytes per block)
draw(b)= repeat: r = next 4 stream bytes as u32 little-endian
                 if r < 2^32 − (2^32 mod b): return r mod b      # rejection keeps it unbiased
a      = copy of the input (clones, as today)
for i from n−1 down to 1: j = draw(i + 1); swap a[i], a[j]
return a
```

A draw never spans two blocks (32 is a multiple of 4). For n = 53 the shuffle makes 52 draws from 7 blocks, unless a draw is rejected (probability below 10⁻⁸ per draw).

- **Change.** Replace the body of `RoundState.shuffleDelegates` (`state/src/round-state.ts:269-288`) with the rule above, using `Crypto.HashAlgorithms.sha256` and `Buffer.readUInt32LE`.
- **Files.** `packages/state/src/round-state.ts`.
- **Test** `42-shuffle-unbiased.test.js`. `shuffleDelegates` is called on `Object.create(RoundState.prototype)` with 53 stub wallets (`clone()` returns an object carrying the input index). Golden output indices (position k holds the input index shown):
  - round 1: `8,15,41,21,36,47,40,50,38,10,35,16,20,31,4,48,1,18,34,0,25,46,42,9,3,22,17,13,39,28,45,33,30,6,44,7,26,51,24,43,19,37,12,29,32,49,14,2,23,5,11,52,27`
  - round 2: `21,3,50,31,6,0,17,11,40,25,8,26,39,46,49,51,35,37,1,33,52,28,44,27,2,16,34,10,7,23,5,47,43,36,42,41,45,48,12,13,22,4,32,24,9,20,14,38,29,15,30,18,19`
  - round 3: `29,28,24,31,26,2,23,11,33,5,43,1,32,37,51,50,42,18,21,49,45,19,40,0,12,34,27,20,39,10,46,22,9,44,3,48,47,13,8,35,14,36,25,6,17,7,15,52,16,4,41,30,38`
  - round 100: `23,17,45,48,18,31,29,25,12,6,52,49,36,4,20,51,38,2,15,7,46,40,19,30,27,13,5,21,42,8,1,9,43,39,3,44,47,22,11,33,34,50,32,0,35,10,26,14,24,16,37,41,28`
  - n = 1 gives `0`; n = 2, round 7 gives `0,1`; n = 3, round 7 gives `1,0,2`.
  - Over rounds 1 to 200,000 with n = 53, the probability that a delegate keeps its position lies between 0.0183 and 0.0198 at every position (1/53 = 0.0189). Solar's shuffle gives 0.5073 at position 44 and at least 0.0164 elsewhere; the test prints both.
- **Devnet impact.** The forging order changes from round 1 on, so a chain forged by unpatched Solar does not validate under the patched reference (from height 2). Every devnet is regenerated and restarted on the patched build or image; the archives in `solar-devnet/archives/` and the chains under `networks/` are pre-patch data. `check-chain.js` uses Solar's own `shuffleDelegates` from `SOLAR_DIR`, so it follows automatically. The Hetzner devnet `hz` runs the unpatched image; switching it is a separate owner go-ahead (section 7).
- **Heartwood mirror.** `heartwood-state` implements the same algorithm; the L0 schedule vectors (06 §3.1 class 9) are regenerated from the patched oracle for rounds 1 to 10⁴ and delegate counts 1 to 53.

#### 43 `payload-length-check` (L-97 (2); consensus: yes)

**The rule (the exact `payloadLength` rule L-97 leaves to this patch).** A block is valid only if `payloadLength = 32 × numberOfTransactions`. That is the value Solar's forger writes (`forger/src/delegate.ts:84`) and the devnet generator writes (DC-2), so honest blocks, headers and the devnet genesis (107 transactions, 3,424) all pass.

- **Change.** In `Block.verify()` (`crypto/src/blocks/block.ts:152-261`), after the "Invalid number of transactions" check: `if (block.payloadLength !== 32 * block.numberOfTransactions) result.errors.push("Invalid payload length");`. It uses the header's `numberOfTransactions`, so header-only verification (peer checks) applies the same rule.
- **Files.** `packages/crypto/src/blocks/block.ts` (`verify` only).
- **Test** `43-payload-length-check.test.js`. Blocks from `BlockFactory.make` (fixed aux, timestamps in the past) with 0 and 2 transactions: `payloadLength` 0 and 64 verify; 63, 65 and 0 (for the 2-transaction block) fail with "Invalid payload length" (base: all verify). The iceroot-s1 genesis still verifies.
- **Devnet impact.** None on honest networks. `verify-network.js` can add the rule to its genesis checks.
- **Heartwood mirror.** Block validation checks `payload_length == 32 × number_of_transactions` as a header rule.

#### 44 `block-signature-bip340-only` (L-43; L-57 removals; L-51; consensus: yes, config-dependent only)

- **Change.** `Block.verifySignature()` (`crypto/src/blocks/block.ts:129-139`) always verifies BIP340 (`Hash.verifySchnorr(hash, sig, key, true)`) instead of reading `bip340` from the milestone. Patch 24 makes the signing side match.
- **Files.** `packages/crypto/src/blocks/block.ts` (`verifySignature` only; patch 43 edits `verify` in the same file).
- **Test** `44-block-signature-bip340-only.test.js`. With a milestone that sets `bip340: false`, a block whose header hash is signed with `Hash.signSchnorrLegacy` fails `verify()` with "Failed to verify block signature" (base: verifies); a BIP340-signed block verifies.
- **Devnet impact.** None (`bip340: true` at height 1).
- **Heartwood mirror.** Block signatures are BIP340 only (L-43); the `legacy-schnorr` feature serves P2P status attestations alone (L-32).

### G4: API (60-69)

#### 60 `api-received-credits` (L-150; consensus: no)

- **Change.** `TransactionFilter.handleRecipientIdCriteria` (`database/src/transaction-filter.ts:132-169`) always returns `or(recipientId = X, a Core/6 transfer with an item paid to X)`. The branch that also matched delegate registrations sent by X goes. `/wallets/{id}/transactions/received` uses this criterion (`api/src/controllers/wallets.ts:178`), so it changes too. The broader `address` filter is `or(senderId, recipientId)` (`:110-119`), so it still finds a wallet's own registration through the sender side, as L-150 wants.
- **Files.** `packages/database/src/transaction-filter.ts`.
- **Test** `60-api-received-credits.test.js`. A `TransactionFilter` from `Object.create` with a stub wallet repository that knows address X: `getExpression({recipientId: X})` contains no `DelegateRegistration` clause (base: it does), and `getExpression({address: X})` still has the `senderId = X` clause. The expected expression trees are literals in the test.
- **Devnet impact.** None of the devnet tools reads "received". A route-by-route API comparison (05, L-147) expects the new rule on both sides.
- **Heartwood mirror.** `heartwood-api`'s `recipientId` filter and the "received" route match a top-level recipient or a transfer item, never a registration.

---

## 7. Devnet switch-over after integration

Once `s1-ref-v1` is tagged, the reference devnet moves to it. The steps, for the integrator:

1. **Native runs.** Point `SOLAR_DIR` at a built checkout of `s1-ref-v1` (for example `solar-ref-work/s1-ref`). `scripts/local-toolchain.env` sources `tools/toolchain/env.sh`, which sets `SOLAR_DIR=/home/vortex/workspace/solar-ref`; that tree must then be at `s1-ref-v1` and built, or the variable is overridden.
2. **Image.** Build the node image from the patched tree: `SOLAR_REPO=/home/vortex/workspace/solar-ref SOLAR_REF=s1-ref-v1 SOLAR_COMMIT=<commit of s1-ref-v1> scripts/make-context.sh`, then `docker/build-image.sh` through the `sudo docker` wrapper. (The alternative that L-51 describes, the pristine tarball plus `patches/series` applied in the Dockerfile, is what Heartwood's oracle container does; either gives the same tree.)
3. **Generator and verifiers** (per patch above): donations as `basisPoints` (22), burn as `feeBasisPoints` (23), `issued` recorded and checked (40), `payloadLength` checked (43); `diff-milestones.py` reads the patched mainnet preset (23).
4. **txgen expectations** (per patch above): `removed-ipfs-1-5` added (01); three `vote-float-*` scenarios accepted (03); `revote-identical` and `unvote-without-vote` rejected (05). Solar-quirk notes in DESIGN-CHOICES ("Observed Solar behaviours") and TESTED C.9 are marked as patched in `s1-ref-v1`.
5. **Regenerate and re-test.** Regenerate the iceroot-s1 networks. The default seed must still give nethash `c9b03ab9…bcca` and genesis id `fbdd5afb…605e` (no patch touches genesis bytes). Then re-run `scripts/test-native-single.sh` (TXGEN_ONCE=1) and the Docker 3-node test (`scripts/test-docker-multi.sh`), and archive new golden chains. Pre-patch archives stay as they are, labelled pre-patch.
6. **Hetzner.** The running devnet `hz` on `solar-devnet-1` is not touched by this plan. Moving it to `s1-ref-v1` needs the owner's go-ahead.

---

## 8. What is not patched, and why

| Row | Why there is no S1 TypeScript patch |
|---|---|
| L-137 | The strict milestone schema and the all-four-files rule are Heartwood start-up checks. The ledger leaves open whether TS mirrors them "by patch or … as config-only divergences". This plan records them as config-only divergences: they refuse configurations that no generated devnet contains, so they cannot change a block verdict on a network where both run. The parts already decided (merge traps, donation list, fee-burn basis points) are patches 20-23. A TS mirror can be added later as patch 26 if the owner asks |
| L-138 | A node-local digest of applied milestone entries, checked at start. Heartwood only; no consensus effect, and the ledger names no TS mirror |
| L-139 | From the fresh genesis (wire v2); "S1 keeps Solar's wire format for the TypeScript reference" |
| L-76, L-173, L-177, L-99 | The PQ milestone's TypeScript patch is test-only, a local file never committed or released (L-76). It carries the scheme id, witnesses, AssetID field, signature-free ids and the PQ-phase attestation key. Not S1 |
| L-43 (other removals) | BLS key: derived and never read, so no behaviour to disable. Exceptions mechanism: inert with `exceptions.json` = `{}`; a non-empty file is a config-only divergence (Heartwood refuses keys of removed features, L-137). Multi-span block time: a second `blockTime` value is already refused at load in 4.3.1. Historical milestones: data, not code; devnets carry one rule set. `sxp-swap`: already deactivated (6 lines). Plugin manager, self-update, pm2, `relay:share`, Postgres and `database:create`: tooling and storage of the TS node itself, outside consensus; the devnet never uses them, and Postgres is how the TS reference stores its chain |
| L-39, L-40, L-41, L-42 | Heartwood FIX-AND-DOCUMENT items (empty `remoteAccess` denies; the relay never reads forger keys; the signing record; key-file permissions). Node-local, not consensus; the ledger names them as divergences, not mirrored patches |
| L-29 | Non-canonical UTF-8 memos are rejected at decode by Heartwood (ED-12). Reachable only by adversarial input; a FIX-AND-DOCUMENT divergence (L-24) |
| L-25 | Solar's throw paths (for example a rank missing from the table) become typed rejections in Heartwood with a divergence entry; the verdict (block rejected) is the same |
| L-35 | `delegate.version` persistence: Solar's state saver already keeps it; Heartwood uses a non-consensus table. No TS change |
| L-22, L-47, L-56, L-59, L-61, L-65, L-96 | Values, not code: byte 90, rewards, donation recipients, `minFee` 6,173 and the 75 ROOT surcharge (`addonBytes` 1,214,968), the genesis split. The devnet's `iceroot-s1` profile already applies them as configuration |
| L-24 (reproduced quirks) | Quirks not named by L-57 or L-97 stay reproduced in both implementations, for example prefix-agnostic BIP340 key parsing, the effective 107-block revoke delay, the half-size dynamic fee, `totalAmount` excluding 1/6 amounts, and the collator's block budget read at the last block's milestone (n09 Q51) |
| L-36, L-58, L-32 | Kept as Solar has them: the unique-type-per-sender-per-block rule, the 27-of-53 forging gate, legacy Schnorr for P2P status attestations |
| L-49, L-114, L-146, L-147, L-156, L-176, L-178, L-180, L-183, L-188, L-189 | Later stages (ID, FIN) or API changes from the fresh genesis. S1 keeps Solar's formats, API and wire |
| L-167 | The test-only transaction version for the format-switch drill belongs to HARDEN test builds, not to the S1 reference series |
| (TESTED A.4) | Donations active at height 1 break Solar's `StateBuilder` (a genesis donation row with no username). No ledger row covers it; the generator keeps donations from height 2 (DC-1), and Heartwood records it as a divergence-register candidate |

---

## 9. Risks and implementation notes

- **Patch 25 is the largest and riskiest.** `AsyncLocalStorage` is stable in Node 18 and scopes the height per async chain, which avoids a race with concurrent API and P2P work. If it misbehaves in some path (for example a callback that escapes the scope), the fallback is explicit height arguments at the same call sites; the rule table in patch 25 does not change either way. The test's concurrency check guards the mechanism.
- **Import cycles in `config.ts`** (patch 22). `identities/address.ts` and `utils/index.ts` import `configManager`, and the manager validates the `testnet` preset while the module is loading. The address check should therefore use `Base58.decodeCheck` from `utils/base58.ts` (which imports only `bstring` and the hash functions), not `Identities.Address` or the `utils` index.
- **Presets must stay valid** (patches 22, 23): the crypto package loads `testnet` in the `ConfigManager` constructor, so a preset left with `feePercent` or `percent` stops every process at import.
- **Stubs in tests** depend on Solar's private fields and method names at `b45369d7`. They are allowed to, because the reference is frozen; a stub that breaks after a later patch is fixed in that later patch's commit.
- **Forging order** (patch 42) invalidates every chain made before it. Old TS-forged chains are not usable as L2 corpus for the patched reference.
- **Series hygiene.** `git am` must apply every patch with no fuzz. The integrator checks that each patch touches only the files its group owns (section 4.1).
