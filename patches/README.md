# Solar Core reference patch series

This directory holds a numbered series of small patches to Solar Core 4.3.1, the TypeScript
reference that IceRoot's Heartwood Core is tested against. Each patch fixes one deterministic
consensus quirk of Solar, removes a feature that IceRoot drops, or closes a start-up or API gap,
and each patch comes with its own test. Wherever no patch changes it, Solar's behaviour stays as
it is.

- `series/NN-<slug>.patch`: the patches, one file each, made with `git format-patch`.
- `series/SERIES.md`: the register: the base commit, one row per patch and the SHA-256 of each
  patch file.
- `tests/NN-<slug>.test.js`: the test of each patch.

## Base

Solar Core 4.3.1, commit `b45369d7da143ab246f2d19b28ed9fb77fc99f36`. The history of this
repository is the base followed by one commit per patch, in the order the patches were made, and
a commit at each release that adds or updates the register. A tag marks each release; the register
lists them.

## Applying the series

The tree at a tag already holds every patch of that release. To apply the series to another
checkout of the base, copy `patches/series` out of this tree first, then:

```sh
git checkout -b patched b45369d7da143ab246f2d19b28ed9fb77fc99f36
git am /path/to/series/*.patch
```

The file names sort in number order, which is the order to apply them in. Each patch also adds
its test under `patches/tests/`.

## Building and running the tests

The tests run against a built checkout. The build needs Node 18.20.8, pnpm 6.32.11 (Solar's
lockfile is version 5.3) and Python 3.10 for the native addons:

```sh
npx -y pnpm@6.32.11 install --frozen-lockfile
npx -y pnpm@6.32.11 build
for t in patches/tests/*.test.js; do node "$t" || echo "FAILED: $t"; done
```

Each test prints one line per check, `PASS <name>` or `FAIL <name>: <detail>`, then a summary,
and exits with code 0 only if every check passed. A test loads Solar through the built `dist/`
directory of each package from `SOLAR_DIR`, by default the repository root two levels up. With
`SOLAR_DIR` pointing at a build of the unpatched base, a test shows the behaviour its patch
changes, and fails. A few tests also read the crypto directory of a generated devnet
(`network.json`, `milestones.json`, `genesisBlock.json`) from `DEVNET_CRYPTO`, by default
`patches/tests/devnet-crypto`, which the tree does not include; when it is absent they print
`SKIP` for those checks. Point it at a devnet made for the patched series, whose milestone file
passes the start-up checks of the series (it sets `burn.feeBasisPoints`, not Solar's
`burn.feePercent`). The check counts that the commit messages quote include these checks.

The tests use no test framework and no extra dependency. Kernel-level code (transaction
handlers, the block processor, round state, block state, the pool, the API filter) is tested
without booting a node: the test creates the instance with `Object.create(Class.prototype)`,
gives it stub collaborators and calls the method directly. A test that needs a network
configuration builds it inline from one template, so that it passes the start-up checks of the
series:

- `network`: a devnet `network.json` (name `devnet`, `pubKeyHash` 90, `wif` 252, `slip44` 1,
  testnet `bip32`, any 64-hex `nethash`);
- `milestones`: one height-1 milestone with the rules the test needs, including
  `burn: { feeBasisPoints: 9000, txAmount: 2000000 }` and `donations: {}`;
- `genesisBlock`: `{ transactions: [] }`, unless the test is about the genesis block;
- `exceptions`: `{}`.

## The Consensus column

Each patch's commit and its row in `SERIES.md` say how the patch affects consensus:

- `yes`: the patch changes which blocks or transactions are valid, or the state a block
  produces.
- `config-dependent only`: the change shows only under milestone configurations that use the
  affected feature, for example one that switches a removed transaction type back on; with
  Solar's mainnet and testnet presets the blocks and the state are as before.
- `no`: the patch changes node start, tooling, the pool or the API only, or adds a check at
  start that refuses a bad configuration file while every accepted file behaves as before.
- `error text only`: the same inputs are accepted and refused as before; only the error
  changes.
