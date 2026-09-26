# S1 reference patch series: register

This is the reference-change register that decision-ledger row L-51 asks for. The Solar TypeScript
reference for IceRoot Stage 1 is Solar Core 4.3.1 (`b45369d7da143ab246f2d19b28ed9fb77fc99f36`) plus
the patches below, applied in number order with `git am`. The plan and the rule behind each patch
are in `patches/PLAN.md`. Each patch carries its own test, `patches/tests/NN-<slug>.test.js`.

| Item | Value |
|---|---|
| Base | Solar Core 4.3.1, `b45369d7d`; branch `iceroot-ref` adds only `patches/PLAN.md` (`bf23d2432`) |
| Result | tag `s1-ref-v1` on branch `iceroot-ref` of `/home/vortex/workspace/solar-ref` |
| Apply | `git am patches/series/*.patch` on the base, in number order (the file names sort that way) |
| Authority | `/home/vortex/workspace/docs/iceroot/decision-ledger.md`, LOCKED rows |

## Patches

SHA-256 is of the `.patch` file in this directory. Consensus "yes" means the patch changes which
blocks or transactions are valid, or what state a block produces.

| No. | Slug | Group | Ledger rows | Consensus | SHA-256 of the patch file |
|---|---|---|---|---|---|
| 01 | ipfs-type-removed | G1 | L-33, L-57 | yes | `aa5149918f964555b4386123d04976ad52886471bfe6755baebe71fef03f7879` |
| 02 | removed-types-inactive | G1 | L-43, L-57, L-51 | yes (config-dependent only) | `e7948deeeeb5fc96ce6568e5253dd58f72ec4bc178378498cf31d5777ac276b1` |
| 03 | vote-sum-integer | G1 | L-57 | yes | `1ee40eb11cdfef6e7cd06f28c03fd04e49177c9f5ed11659863debf62f7d0d36` |
| 04 | vote-order-bytewise | G1 | L-57 | yes | `60d0623fed82d3d0426f7679714fca85b7beef5f26aafda59ffec49d7e276d33` |
| 05 | identical-vote-check | G1 | L-97 (4) | yes | `c297444dd7b4033dedb0b91aeb67014c53d9ee582b0c16b87b1b4d023573142f` |
| 06 | vote-size-limit | G1 | L-179 | yes (same accept set as Solar) | `055461db1eab57e224f568a9590f850fab2e6271dc9268ef60d7263ede351bed` |
| 20 | milestone-merge-replace | G2 | L-57, L-64 | yes (config-dependent) | `66d6506149b01a9553867122e2de39a460699b153bb9c7593e8e252e61e64d64` |
| 21 | reward-lookup-merged | G2 | L-57, L-60 | yes (config-dependent) | `9c69e55e40e8d7d8001f7c200fe96fb4b344b37f73a702aecae76d7c097d2ae7` |
| 22 | donations-basis-points | G2 | L-64, L-61 | yes | `8e56728e205841a1021288f1a7e0d3140a0068b90efd265c481c7cc97ebfbd70` |
| 23 | burn-basis-points | G2 | L-97 (5), L-26 | yes (identical results at 9000) | `70667af0fe02755ec3be961d85df520a8d3327c0f8102cf28eebbb21c2693001` |
| 24 | legacy-formats-off | G2 | L-43, L-57, L-51 | yes (config-dependent only) | `fe83bfdc7f3ff33724cef927d068878e2a50eefc6b0f56c4ab58b6b2358d0d04` |
| 25 | rule-height-block | G2 | L-97 (3) | yes | `aee944c977b9f67ea41d59b727e184fef7a083342f05d89f976a18fd898e6036` |
| 40 | genesis-issuance | G3 | L-52 | yes | `e7c5d9345af2e218bdabb7b208e5423d071d4d6c773ff40909df0550ec3d5f9a` |
| 41 | generator-check-fail-closed | G3 | L-57 | yes | `e90b382ab0e5fbe01187ab91c01647dad474ecbcad50aaa71eaf7fb80edea81a` |
| 42 | shuffle-unbiased | G3 | L-97 (1) | yes | `1114703a9f6f243b6b35ccbcffdc713f8f0387a928fafdcb83c42a8919df6d0e` |
| 43 | payload-length-check | G3 | L-97 (2) | yes | `325d9c3419ca2a7e33fbbecbb3a74327fc14c5ead34bf2b905b0a337ceb3d970` |
| 44 | block-signature-bip340-only | G3 | L-43, L-57, L-51 | yes (config-dependent only) | `7913a19e2d3a0bc3f3b77eb7e758a65d6430bd4a995e4fda385d11d5ad352ef0` |
| 60 | api-received-credits | G4 | L-150 | no | `79ac62aa99a80d019543a2fa78e5dc1229b380733aff8ed29591a9ff76900368` |

Check the hashes with:

```sh
cd /home/vortex/workspace/solar-ref/patches/series && sha256sum *.patch
```

## Integration record (2026-09-25)

- The four groups worked on branches `G1` to `G4` (worktrees `solar-ref-work/G1` to `G4`), not the
  `s1/g*` names of PLAN.md section 4.2. Patch files are named `NN-<slug>.patch`, not
  `00NN-<slug>.patch`. Commit subjects are `S1-NN: <slug> (<ledger rows>)`; each body keeps the
  plan's `Patch`, `Ledger` and `Consensus` trailers.
- The series was applied onto `iceroot-ref` in the main worktree, as the integration task asked,
  instead of a separate `s1-ref` branch from `b45369d7` (PLAN.md section 4.4, step 4). The code is
  the same either way: `iceroot-ref` differs from `b45369d7` only by `patches/`.
- Every patch touches only the files its group owns (PLAN.md section 4.1), plus its own test.
- A dry run of `git am --whitespace=error-all` of all 18 patches onto `iceroot-ref` applied with no
  conflict and no fuzz, and every one of the 50 changed files equals its group branch's version.
  No conflict needed resolving.
- Some files are changed by more than one patch, always within one group and in number order: `crypto/src/managers/config.ts`
  (20, 22, 23, 25), `crypto/src/blocks/factory.ts` (24, 25), `crypto/src/utils/index.ts` (22, 24),
  `crypto/src/networks/{mainnet,testnet}/milestones.json` (22, 23), `crypto/src/blocks/block.ts`
  (43, 44), `transactions/src/handlers/solar/vote.ts` (02, 05). No file is touched by two groups.

Later fixes are made on the group branch and re-exported. A released series is never edited in
place: a correction gets a new patch number and a new tag (`s1-ref-v2`).
