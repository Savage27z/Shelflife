# Sourcecheck

**How many NEAR contracts actually match their published source?**

A blockchain runs machine code. Projects publish readable source on GitHub and say "this is what
it does." Almost nobody checks whether the two match — and you can check, by rebuilding the
published source and comparing it to the bytes running on chain.

NEAR already has the tooling: [NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md)
source metadata, `cargo near build reproducible-wasm`, Docker builds, SourceScan, and
Verify-and-Publish on NearBlocks. **What nobody has measured is whether any of it is used.**

This repo measures it.

## Current finding

From a 45-account sample of well-known mainnet contracts (DEXes, liquid staking, bridged assets,
oracles, NFT marketplaces, consumer apps, protocol infrastructure):

| | |
|---|---|
| Contracts inspected | **41** |
| Expose NEP-330 source metadata | **8** |
| …of those, actually publish a repo link | **7** |
| No source metadata at all | **33** |
| **Metadata coverage** | **19.5%** |

Contracts with **no published source link** include `wrap.near`, `v2.ref-finance.near`,
`usdt.tether-token.near`, `aurora`, `social.near`, `meta-pool.near` and `priceoracle.near` — among
the highest-value contracts on the chain.

One contract (`game.hot.tg`) publishes metadata *without* a source link, which is its own category.

## What this does and does not claim

**This measures verification coverage, not honesty.** A contract without metadata is unverifiable
*by this method*. It is not evidence that anyone is lying, and no project here is accused of
anything.

**Not yet checked:** SourceScan and NearBlocks may hold verification records *independently* of the
contract's own metadata method. Until that second path is checked, the headline above covers
NEP-330 self-published metadata only, and the true "unverifiable" number may be lower. That check
is the next milestone and the number will be restated when it lands.

**Not a census.** No RPC method lists every contract on NEAR. The sample is a hand-assembled seed
set of contracts that hold value or see traffic (see `data/targets.json`, which documents the
sampling rule). An indexer-derived top-N replaces it next.

## Quickstart

Requires Node 20+. No API keys, no wallet, no funds — every call is a free public RPC read.

```bash
npm install
npm run scan
```

Expected: a line per account, then a summary table ending in a coverage percentage, and
`data/scan-latest.json` written with the full records.

Check a single contract:

```bash
npm run check -- wrap.near
```

Expected output:

```
wrap.near
  status      NO SOURCE LINK
  code hash   <base58 hash>
  storage     <n> bytes
```

And one that publishes its source:

```bash
npm run check -- linear-protocol.near
```

```
linear-protocol.near
  status      has metadata
  version     1.6.2
  source      https://github.com/linear-protocol/LiNEAR
```

## How it works

1. `view_account` — does the account exist, and does it have code deployed? An account with no
   contract reports code hash `11111111111111111111111111111111`.
2. `call_function` on `contract_source_metadata` — the NEP-330 method. A contract without it fails
   with `MethodResolveError(MethodNotFound)`.
3. Results are bucketed into `no_account`, `no_contract`, `no_metadata`, `metadata`, `error`.

**Accounts we failed to reach are counted as `error`, never folded into a finding.** The coverage
denominator is contracts we actually inspected.

One implementation note worth knowing if you build on this: a failed NEAR view call does **not**
come back as a JSON-RPC error. The request returns HTTP 200 and the failure is a string inside
`result.error`. Miss that and every contract lacking the method looks like an infrastructure
failure — which is exactly what happened on the first run here.

## Roadmap

- [x] NEP-330 metadata scan
- [ ] SourceScan / NearBlocks verification-record lookup
- [ ] Indexer-derived target set (top-N by traffic and balance)
- [ ] Reproducible rebuild via Docker + `cargo near`, hash comparison
- [ ] Weight findings by value and transaction volume
- [ ] `npx sourcecheck <account.near>` for anyone to check their own contract

## Dependencies and prior code

Written from scratch for the NEAR hackathon. No templates or starter kits. Runtime dependencies:
none — the RPC client is plain `fetch`. Dev dependencies: `typescript`, `tsx`, `@types/node`.

## Licence

MIT — see [LICENSE](./LICENSE).
