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

### 3. In a sample of significant contracts, 81% are verifiable by neither path

A 45-account sample of well-known mainnet contracts — DEXes, liquid staking, bridged assets,
oracles, NFT marketplaces, consumer apps, protocol infrastructure:

| | |
|---|---|
| Contracts inspected | **42** |
| Publish NEP-330 metadata | 8 |
| …of those, actually include a repo link | 7 |
| Present in the SourceScan registry | 3 |
| **Verifiable by either path** | **8** |
| **Verifiable by neither** | **34** |
| Coverage | **19.0%** |

Contracts with no published source by either route include `wrap.near`, `v2.ref-finance.near`,
`usdt.tether-token.near`, `aurora`, `social.near`, `meta-pool.near` and `priceoracle.near` — among
the highest-value contracts on the chain.

One contract (`game.hot.tg`) publishes metadata *without* a source link: it declares version 1.2.0
and points nowhere.

## What this does and does not claim

**This measures verification coverage, not honesty.** A contract that publishes no source is
unverifiable, which is not evidence that anyone is lying. No project here is accused of anything,
and the fix is a single command — see below.

**Both paths are checked.** An earlier version of this README reported only NEP-330 metadata and
flagged that SourceScan records might change the picture. They were then checked, and they do not:
the three registry entries in the sample are contracts that already publish metadata.

**Not a census.** No RPC method lists every contract on NEAR, so finding 3 is a sample, with its
rule documented in `data/targets.json`. Findings 1 and 2 are *complete* — they enumerate the whole
registry.

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

Check any single contract:

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
- [ ] `npx sourcecheck <account.near>`

## Dependencies and prior code

Written from scratch for the NEAR hackathon. No templates or starter kits. Runtime dependencies:
none — the RPC client is plain `fetch`. Dev dependencies: `typescript`, `tsx`, `@types/node`.

## Licence

MIT — see [LICENSE](./LICENSE).
