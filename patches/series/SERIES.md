# Patch register

Base: Solar Core 4.3.1, commit `b45369d7da143ab246f2d19b28ed9fb77fc99f36`.

The patches below apply to the base with `git am`, in number order (the file names sort that way).
Each patch adds its own test, `patches/tests/NN-<slug>.test.js`. `patches/README.md` explains how to
apply the series, how to build and run the tests, and what the Consensus column means.

| No. | Slug | Description | Consensus | SHA-256 of the patch file |
|---|---|---|---|---|
| 01 | ipfs-type-removed | The IPFS type 1/5 is deactivated: pool admission and blocks reject it. | yes | `11a0eb476f6b21038abda71a6180f57fdd7e8e3ff4736b98d779f22cd0523e3f` |
| 02 | removed-types-inactive | Legacy transfer 1/0, legacy vote 1/3 and HTLC 1/8 to 1/10 stay inactive whatever the milestone flags say; the Solar vote 2/2 is always active. | config-dependent only | `5ea7eb2cc56139cd0e80cee0c4a197c21a6c8b1afa27252c6c67b0f389944ddd` |
| 03 | vote-sum-integer | The vote sum check adds integer basis points instead of floats. | yes | `d9c802398c95b43b71a64daeebdf8d6ce3de67589d4fb897a7b82abcfba0809e` |
| 04 | vote-order-bytewise | Votes with the same percent are ordered by name in byte order, not by locale collation. | yes | `580c3669e0b4c1153a17b636f7ae50dfcc0fcc54bed449d86cbe0f008771010c` |
| 05 | identical-vote-check | The identical-vote check of the Solar vote compares like with like, so it fires. | yes | `d445c0bce60f164520455465276392ab10e35671f6034ba6554e873c9c827eb3` |
| 06 | vote-size-limit | A vote asset over 1,024 bytes fails with VoteAssetTooLargeError; the accept set is unchanged. | error text only | `bd9cd13b2afad182ff998f00b5fe17594f276f338b4cd0c1e252cb9dd79c17e5` |
| 07 | vote-revert-canonical-order | A reverted Solar vote restores the votes in sortVotes order. | yes | `3b81cf25a41f68c6886c1a330d6aadcd195987eecb9a57ba4d87fab6e16e2c85` |
| 20 | milestone-merge-replace | A later milestone replaces dynamicReward.ranks and donations whole. | config-dependent only | `7e7616f377177714d060f3a1570f634b336da591dd095b915893292f7fa0ba83` |
| 21 | reward-lookup-merged | The block reward is read from the merged milestone at the height. | config-dependent only | `f746373793a13495b854bfb37960b1bedd93c92898ca7ab3cb5950ed4e4e481b` |
| 22 | donations-basis-points | Donation shares are integer basis points, validated at start. | yes | `18ec35440195f39caa3e2836f4cd4239331d3a2708f3a2ea2e08057cee706d76` |
| 23 | burn-basis-points | The fee burn is integer basis points (burn.feeBasisPoints), validated at start. | yes | `4738cc43fe78588dfa1690371a4d6388f81daccd9afe5ac2aa2825a8e6c8c53f` |
| 24 | legacy-formats-off | Only version 3 transactions are supported, and blocks are always signed with BIP340. | config-dependent only | `df23aa46f3cc2863fbe4def267b59c734615dbb955a227a3008a446262252eda` |
| 25 | rule-height-block | The transactions of block H follow the milestone at H; the pool judges by tip + 1. | yes | `8ca86a588aedd7c9cf4f4009f40709b5644affc09a8a541a93a9da06a723b91d` |
| 26 | reward-table-validated | An enabled dynamic reward table must pay every active rank; checked at start. | no | `454d8509f7cf4ae04948f0b0f0de9554c73192cadb967aa8bd6213d1fc7fe4aa` |
| 27 | milestone-merge-scope-copy | The replace rule applies only at dynamicReward.ranks and the top-level donations, with a copy. | config-dependent only | `5f1ecb4780c4f98735ccb526c1d9a6dde5882153496f2e2b129cc9703308347d` |
| 28 | milestone-span-refused | A milestone file that changes blockTime or activeDelegates after height 1 is refused at start. | no | `20143f7ccef9f4cb6c101537401234e79f5c5d63c19eb396eb26f29d16b6c764` |
| 29 | burn-min-validated | burn.txAmount must be a non-negative safe integer; checked at start. | no | `8ae04dc8f793bfcac05fb9e9f14977ececce9678bf0e416de1b788e0169dddf2` |
| 40 | genesis-issuance | The genesis supply is an explicit issuance, and no wallet may hold a negative balance. | yes | `4c39b61000a59dbaefc7d1836468f32fc3580db33e12b3f07565bd21178f3497` |
| 41 | generator-check-fail-closed | A block is rejected when the round has no delegate at its slot. | yes | `d2b1db699976e051b8a6df6c6e7e36574a73e354a45caa2d2675d47829907a40` |
| 42 | shuffle-unbiased | The forging order comes from an unbiased Fisher-Yates shuffle. | yes | `1e59d6c94fe2cd3c958f8f12d5f9506e51a31669ae0a1c015fdbd395f4a11fb8` |
| 43 | payload-length-check | A block's payloadLength must be 32 x numberOfTransactions. | yes | `1f5811de2765160e7c8c758b30d3a5df26f99c5a6ac0b4a9dfa142e1a205ade8` |
| 44 | block-signature-bip340-only | Block signatures are verified as BIP340 only. | config-dependent only | `4b07d3f4ab2bf22f9e0d1677613060b805f2bd57a4232bfe1066a7d04e66d5dc` |
| 45 | state-builder-fail-closed | A state build that fails or is inconsistent stops the node with exit code 1. | no | `b30cf964b4db98c37b8aad520c482b43c8ef255dd70aea7e3b3d7dff797bc40c` |
| 46 | genesis-validated | The genesis block must decode, verify and use only types active at height 1. | yes | `cb7200521821c79dea0ca4061950a9de46b8f348439e70688e83e8abe6eb3ae8` |
| 47 | restart-rank-consistency | A rebuilt or reverted state has the live node's round-start ranks. | no | `db887ac390f92a111378e33498ec90f0846de4de8b20242a4c61678fb2c16303` |
| 48 | snapshot-verifier-bip340 | The snapshot verifier uses the BIP340 block signature rule. | no | `51497ab0c1ba6d35701b55ba10ebeaa1eadec2f4c1b2c2d697b8166c07c2f829` |
| 49 | genesis-issuance-key-and-limit | Issuance is matched by the decoded genesis key and is at most 2^63 - 1. | yes | `c82c70570fd2883c0c3f238b9b38dac5b501abc93d19835308e53e83640b5ec6` |
| 50 | restart-state-complete | delegate.round marks exactly the current round's delegates, after a restart or revert too. | no | `8af22f89894f8b118e1b97aae281312c9d8c375c91712b0d410a8f46bf6b0b9c` |
| 60 | api-received-credits | The received-transactions search matches only transactions that credit the address. | no | `0ca5216e2a3de4ef1dd61fe15c74740c62a856d2e2c1ce6492c5f59c198dc057` |

## Checking the hashes

The SHA-256 is of the `.patch` file in this directory. From the repository root, this checks every
row of the table against its file:

```sh
cd patches/series
awk -F' *[|] *' '/^[|] [0-9][0-9] [|]/ { gsub(/`/, "", $6); print $6 "  " $2 "-" $3 ".patch" }' SERIES.md | sha256sum -c
```

`sha256sum *.patch` prints the same values.

## Releases

- `s1-ref-v1`: patches 01 to 06, 20 to 25, 40 to 44 and 60 (18 patches).
- `s1-ref-v2`: all 29 patches above. It adds 07, 26 to 29 and 45 to 50; the patch files of
  `s1-ref-v1` are unchanged. The tests of patches 20, 26 and 40 are changed by later patches (26
  and 28 for test 20, 28 for test 26, 49 for test 40), in those patches' own commits. The test of
  patch 42 gained rejection-path rounds in a commit of its own, which changes no source file and
  has no patch file.

Applied in number order to the base with `git am`, the patch files of a release give the tree of
its tag, apart from `patches/README.md`, this directory and, for `s1-ref-v2`, the rejection-path
rounds of test 42.
