# Sourcecheck

**How many NEAR contracts actually match their published source?**

A blockchain runs machine code. Projects publish readable source on GitHub and say "this is what
it does." Almost nobody checks whether the two match — and you can check, by rebuilding the
published source and comparing it to the bytes running on chain.

NEAR already has the tooling: [NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md)
source metadata, `cargo near build reproducible-wasm`, Docker builds, SourceScan, and
Verify-and-Publish on NearBlocks. **What nobody has measured is whether any of it is used.**

This repo measures it. Every number below is reproduced by `npm run scan` and `npm run verified`.

## Findings

### 1. Across all of NEAR mainnet, 105 contracts have ever been verified

Read directly from SourceScan's on-chain registry (`v2-verifier.sourcescan.near`), which is what
backs the "Verify and Publish" button on NearBlocks. All 105 are Rust.

### 2. Two in five of those are already out of date

A verification record pins a specific code hash. If the account redeploys, the record no longer
describes the code that is running — but nothing re-checks it, and nothing marks it stale.

| Of the 105 verified contracts | |
|---|---|
| Record still matches deployed code | **54** |
| **Redeployed since verification** | **42 (40%)** |
| Account unreachable | 9 |

**So on the entire NEAR mainnet, 54 contracts have a verification record that matches the code
running today.**

### 3. Only one contract in five publishes a source link you can actually follow

180 contracts taken from NearBlocks in indexer order. Every NEP-141 token and NEP-171 NFT contract
is indexed, which makes this the one contract population on NEAR that can be enumerated rather than
hand-picked.

| | |
|---|---|
| Contracts inspected | **168** |
| Expose NEP-330 metadata | 53 (31.5%) |
| **...carrying a usable repo link** | **34 (20.2%)** |
| Publish metadata pointing nowhere | **19** |
| Present in the SourceScan registry | 6 |
| No published source at all | 115 |

**Metadata presence overstates verifiability.** 19 of the 53 contracts exposing metadata publish no
link in it -- they declare a version and point nowhere, which is unverifiable in practice. The
honest coverage figure is the one counting a usable link: **20.2%**.

**Accounts are not programs.** Those 168 accounts run only **101 distinct pieces of bytecode** --
roughly a third are factory clones. The largest cluster is **34 bridged-token contracts sharing
identical code, none with metadata**, so counting accounts lets one factory's choice swing the
aggregate. Counting distinct programs instead: of the **87 unique-bytecode contracts, 41.4% expose
metadata**.

Contracts with no published source include `wrap.near`, `v2.ref-finance.near`,
`usdt.tether-token.near`, `aurora`, `social.near` and `meta-pool.near` -- among the highest-value
contracts on the chain.

#### A prediction this got wrong

Before running it, I expected a broad sweep to score *worse* than the hand-picked set of major
protocols (19.0%), reasoning that big protocols are likelier to have bothered. The opposite
happened: 31.5% against 19.0%. Blue-chip contracts largely predate the tooling, while newer token
contracts are often deployed with toolchains that embed metadata by default. Recorded because a
measurement that only ever confirms its hypothesis is not worth much.

### 4. Exposure is real, but concentrated -- read both numbers together

Of the NEAR held by inspected contracts, **99.8% sits behind contracts with no published source**.
That is true and, quoted alone, misleading: **`wrap.near` alone is 90.1% of it**, because wrapped
NEAR holds the backing for every wNEAR in existence.

`npm run weigh` therefore always prints the concentration table beside the headline, so the
disclosure travels with the number instead of depending on whoever repeats it.

## What this does and does not claim

**This measures verification coverage, not honesty.** A contract that publishes no source is
unverifiable, which is not evidence that anyone is lying. No project here is accused of anything,
and the fix is a single command — see below.

**Both paths are checked.** An earlier version of this README reported only NEP-330 metadata and
flagged that SourceScan records might change the picture. They were then checked, and they do not
rescue the figure: 6 of the 168 inspected contracts appear in the registry.

**Not a census.** No RPC method lists every contract on NEAR, so findings 3 and 4 are a sample —
token contracts, taken from the indexer in its own order, with the rule recorded in
`data/contracts.json`. It is not weighted toward anything, but it is not the whole chain either,
and token contracts may not behave like the rest of it.

**Findings 1 and 2 are complete**, not sampled: they enumerate the entire SourceScan registry.

**Nothing here has been rebuilt yet.** Every figure measures whether a source link is *published*,
not whether that source actually compiles to the deployed bytes. A contract can publish a link to
code that does not match. That check needs Docker and is the main open item on the roadmap — until
it lands, read "verifiable" as "a source link exists to check", never as "checked".

## Quickstart

Requires Node 20+. No API keys, no wallet, no funds — every call is a free public RPC read.

```bash
npm install
npm run verified   # the whole SourceScan registry, and how much of it is stale
npm run scan       # the sample, cross-referenced against the registry
```

`npm run verified` ends with a table and writes `data/verified-latest.json`:

```
SourceScan-verified contracts, NEAR mainnet: 105
  record still matches deployed code  54
  REDEPLOYED since verification       42
```

### Check one contract

```bash
npm run build
node dist/bin.js devhub.near
```

```
devhub.near
  code hash   EauRt8UydofJitWuttov1zPpcxRKhBLCttYUzw62Diaq
  source      https://github.com/NEAR-DevHub/neardevhub-contract
  version     0.2.0
  SourceScan  verified once, but REDEPLOYED since
  verified    AUHmE71SPjnq8S3EW7m8ompfVBJxwCt4YfVvFLHtvVnr (no longer deployed)

  This contract was verified, then redeployed. The published source
  describes code that is no longer running.
```

That case is the one most likely to be misread, because explorers still show such a
contract as verified.

**Exit codes, so it can gate a pipeline:**

| Code | Meaning |
|---|---|
| `0` | a source link is published |
| `1` | no source published |
| `2` | not a contract |
| `3` | lookup failed |

```bash
# fail your own build if a dependency goes dark
node dist/bin.js some-dependency.near || echo "dependency publishes no source"
```

Or through the shorter script form:

```bash
npm run check -- wrap.near            # NO SOURCE LINK, not in registry
npm run check -- linear-protocol.near # publishes source metadata
npm run check -- devhub.near          # in the SourceScan registry
```

## How it works

1. `view_account` — does the account exist, and is code deployed? An account with no contract
   reports code hash `11111111111111111111111111111111`.
2. `call_function` on `contract_source_metadata` — the NEP-330 method. A contract without it fails
   with `MethodResolveError(MethodNotFound)`.
3. `get_contracts` / `get_contract` on `v2-verifier.sourcescan.near` — the registry path.
4. Compare each registry record's `code_hash` against the account's current code hash to find
   records that have gone stale.

Accounts we fail to reach are counted as errors, never folded into a finding. The coverage
denominator is contracts actually inspected.

### Two traps, documented because both produced wrong numbers here first

**A failed NEAR view call is not a JSON-RPC error.** The request returns HTTP 200 and the failure
is a string inside `result.error`. Treating it as an error made every contract lacking the method
look like an infrastructure failure — and the first run of this tool proudly reported **100%
coverage** with 34 "errors."

**`get_contracts` returns `[entries, pageCount]`, not `[entries, total]`.** The second element is
the number of pages at the requested limit: 53 at limit 2, 5 at limit 25, 1 at limit 500 — all
describing the same 105 records. Reading it as a total gives "53 verified contracts," which is
wrong by half.

## Fixing it, if this is your contract

Build reproducibly and the metadata is embedded automatically:

```bash
cargo near build reproducible-wasm
cargo near deploy <account>
```

Then verify and publish on NearBlocks, under the contract's Contract tab.

## Roadmap

- [x] NEP-330 metadata scan
- [x] SourceScan registry lookup, with staleness check
- [ ] Indexer-derived target set (top-N by traffic and balance)
- [ ] Reproducible rebuild via Docker + `cargo near`, hash comparison — does the published source
      actually produce the deployed bytes?
- [ ] Weight findings by value and transaction volume
- [x] `sourcecheck <account.near>` — single-contract checker with CI exit codes
- [x] Static report page (`npm run report` → `report/index.html`)

## Dependencies and prior code

Written from scratch for the NEAR hackathon. No templates or starter kits. Runtime dependencies:
none — the RPC client is plain `fetch`. Dev dependencies: `typescript`, `tsx`, `@types/node`.

## Licence

MIT — see [LICENSE](./LICENSE).
