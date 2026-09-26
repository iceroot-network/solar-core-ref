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
| 20 | milestone-merge-replace | A later milestone replaces dynamicReward.ranks and donations whole. | config-dependent only | `7e7616f377177714d060f3a1570f634b336da591dd095b915893292f7fa0ba83` |
| 21 | reward-lookup-merged | The block reward is read from the merged milestone at the height. | config-dependent only | `f746373793a13495b854bfb37960b1bedd93c92898ca7ab3cb5950ed4e4e481b` |
| 22 | donations-basis-points | Donation shares are integer basis points, validated at start. | yes | `18ec35440195f39caa3e2836f4cd4239331d3a2708f3a2ea2e08057cee706d76` |
| 23 | burn-basis-points | The fee burn is integer basis points (burn.feeBasisPoints), validated at start. | yes | `4738cc43fe78588dfa1690371a4d6388f81daccd9afe5ac2aa2825a8e6c8c53f` |
| 24 | legacy-formats-off | Only version 3 transactions are supported, and blocks are always signed with BIP340. | config-dependent only | `df23aa46f3cc2863fbe4def267b59c734615dbb955a227a3008a446262252eda` |
| 25 | rule-height-block | The transactions of block H follow the milestone at H; the pool judges by tip + 1. | yes | `8ca86a588aedd7c9cf4f4009f40709b5644affc09a8a541a93a9da06a723b91d` |
| 40 | genesis-issuance | The genesis supply is an explicit issuance, and no wallet may hold a negative balance. | yes | `4c39b61000a59dbaefc7d1836468f32fc3580db33e12b3f07565bd21178f3497` |
| 41 | generator-check-fail-closed | A block is rejected when the round has no delegate at its slot. | yes | `d2b1db699976e051b8a6df6c6e7e36574a73e354a45caa2d2675d47829907a40` |
| 42 | shuffle-unbiased | The forging order comes from an unbiased Fisher-Yates shuffle. | yes | `1e59d6c94fe2cd3c958f8f12d5f9506e51a31669ae0a1c015fdbd395f4a11fb8` |
| 43 | payload-length-check | A block's payloadLength must be 32 x numberOfTransactions. | yes | `1f5811de2765160e7c8c758b30d3a5df26f99c5a6ac0b4a9dfa142e1a205ade8` |
| 44 | block-signature-bip340-only | Block signatures are verified as BIP340 only. | config-dependent only | `4b07d3f4ab2bf22f9e0d1677613060b805f2bd57a4232bfe1066a7d04e66d5dc` |
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

- `s1-ref-v1`: the 18 patches above. Applied in number order to the base with `git am`, the patch
  files give the tree of the tag, apart from `patches/README.md` and this directory.
