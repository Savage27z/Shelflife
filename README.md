# Shelflife

**How much NEAR contract source can anyone actually check?**

A blockchain runs machine code. Projects publish a link to their source and say "this is what it
does." That only helps if the link goes somewhere, is tied to the version that is actually
deployed, and could be rebuilt to prove the two match. NEAR has the tooling for all of it —
[NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md) source metadata,
`cargo near build reproducible-wasm`, SourceScan, and Verify-and-Publish on NearBlocks — and I could
not find anyone who had measured how much of it is used.

This repo measures it, and ships a checker you can point at any contract. Every number below is
computed by the commands in this README from free public reads: no API keys, no wallet, no funds.

## Findings

### 1. Only 6 of 168 token contracts publish source that could be rebuilt

| Stage | Contracts | Share of 168 |
|---|---|---|
| Inspected | 168 | — |
| Expose NEP-330 source metadata | 53 | 31.5% |
| …carrying a source link | 34 | 20.2% |
| …whose GitHub repository resolves | 28 | 16.7% |
| **…and the link is pinned to a commit — could be rebuilt** | **6** | **3.6%** |

Each stage is a different question, and each one loses contracts:

- **Metadata is not a link.** 19 of the 53 contracts exposing metadata publish a version and no
  link — a pointer to nowhere.
- **A link is not source.** The 34 links point at only 13 GitHub repositories plus one literal
  template placeholder, `https://github.com/<xxx>/<xxx>` (`initiate.nearlegion.near`). **4 of the
  13 repositories return 404** (5 contracts) — deleted, or private.
- **A repository is not a version.** Of the 33 GitHub links, only 8 name a commit. The rest point at
  a repository front page, which cannot be tied to what is deployed.

The six that clear the bar are `token.sweat`, `eth.bridge.near`, `zec.omft.near`, `sol.omft.near`,
`token.rhealab.near` and `token.publicailab.near`. Try `node dist/bin.js token.sweat`.

**Accounts are not programs.** The 168 accounts run only **101 distinct pieces of bytecode**,
because factories deploy clones. The largest cluster is 34 bridged-token contracts sharing identical
code, none with metadata, so counting accounts lets one factory swing the aggregate. Of the **87
contracts with unique bytecode, 41.4%** expose metadata.

| Kind | Inspected | Metadata | With a link |
|---|---|---|---|
| Fungible tokens | 84 | 26.2% | 17.9% |
| NFT contracts | 84 | 36.9% | 22.6% |

The NFT figure is flattered by clone families that happen to carry metadata — several families of 3
to 5 airdrop and reward contracts, each deployed from one toolchain that embeds it.

### 2. SourceScan holds 112 verifications; 64 still match what is deployed

SourceScan keeps two registries on mainnet: `v2-verifier.sourcescan.near` (105 records) and an older
`sourcescan.near` (7 records, none in the current one, and no code hash recorded, so they cannot be
checked against what is deployed). Both are read in full, so these counts are complete for those two
registries.

| The 105 current-registry records | | |
|---|---|---|
| Still match the deployed code | **64** | 61.0% |
| Redeployed since verification | **29** | 27.6% |
| Account deleted | 9 | |
| Code removed from the account | 3 | |

**A stale record is mostly not a trust gap.** Of the 29 redeployed contracts, **27 now publish a
source link of their own and 25 of those are pinned to a commit.** Two publish nothing
(`hello.sleet.near` and one 64-character implicit account). So the registry has largely been
*superseded* by NEP-330 metadata, rather than source going dark.

What a stale record does mean is narrower: SourceScan holds no rebuild of the **current** code, and
whether those links reproduce the deployed bytes has not been checked here.

All 105 current records are Rust. 17 of the 112 account names look like tests or staging
deployments (`buildtest-2.agruzdev.near`, `rug-testing.near`, `multi-feed-qa-1.atlas-oracle.near`) —
a name heuristic, not a classification. The registry is not 112 real projects.

### 3. NEAR held behind unpublished source is concentrated in one account

Of the 38.6M NEAR held by the inspected contracts, **99.8%** sits in contracts with neither metadata
nor a registry record. That is true and, quoted alone, misleading: **`wrap.near` is 90.1% of it**,
because wrapped NEAR holds the backing for every wNEAR in existence, and `meta-pool.near` is another
9.7%. `npm run weigh` therefore always prints the concentration table beside the headline.

This counts NEAR balance only. A token contract's value to its users is in the tokens it issues,
which this does not capture, so treat it as a floor, not a measure of risk.

## What this does and does not claim

**Verification coverage, not honesty.** A contract that publishes no source is unverifiable. That is
not evidence anyone is lying, and no project here is accused of anything. The fix is in
[Fixing it](#fixing-it-if-this-is-your-contract).

**Nothing has been rebuilt.** Every figure measures what is *published*, not whether it compiles to
the deployed bytes. "Rebuildable" means a rebuild would be possible, not that one was done. A
pinned, resolving link is still only a claim.

**The sample is token contracts, and it is not random.** It is the first 90 fungible-token and first
90 NFT contracts in the order the NearBlocks API returns them (3,862 and 2,258 are indexed). The
fungible list leads with the best-known tokens; the NFT list is dominated by airdrop and reward
contracts. No RPC method lists every contract, so a census is not available. Token contracts may
not behave like the rest of the chain. The sample contains no accounts that use global contracts.

**The tooling is Rust-only.** NEP-330 metadata comes from Rust tooling and every registry record is
Rust, so a contract written in another language cannot carry it. I did not measure the share of
non-Rust contracts in the sample, so part of the gap in finding 1 may be structural.

**A 404 is ambiguous.** GitHub returns the same for a deleted repository and a private one.

**Other explorers may hold their own records.** I could not check what NearBlocks displays for a
verified contract: its pages sit behind a bot check and its public API exposes no verification
field. Only the two SourceScan registries are read.

**It is a snapshot.** The chain moves, so re-running the scan gives slightly different numbers. The
committed datasets in `data/` are the reproducible artifact.

## Quickstart

Node 20+. `npm install` also builds, so there is no separate build step.

```bash
npm install
```

Check any contract. Each of these is a different outcome:

```bash
node dist/bin.js token.sweat              # source is published, pinned and matches
node dist/bin.js initiate.nearlegion.near # the "source" is a template placeholder
node dist/bin.js wrap.near                # nothing published
node dist/bin.js devhub.near              # a live link, not pinned, plus a stale record
```

```
token.sweat
  code hash  9EUtV11wgCZ4N16xa24ETnn8E78GjeSit1r7gMyQZ6Zi
  source     https://github.com/Sweat-Foundation/sweat-token/tree/75dc5b48dcc8b3f5303ab9f1d3dbf046901f6314
             pinned to 75dc5b4
  version    1.4.0
  link       repository resolves
  SourceScan verified, matches the deployed code

  Source is published, and a SourceScan record matches the deployed code.
  · The link is pinned to a commit, so a rebuild is possible.
```

```
initiate.nearlegion.near
  code hash  HgEFLxaHk47yWaZDYA3sWUZ7iZdEEVo978zQhFFWDnf
  source     https://github.com/<xxx>/<xxx>
  version    0.1.1
  SourceScan not in the registry

  The published source link is a template placeholder.
  · The published link is a template placeholder, not a repository.

  If this is yours, two commands fix it:
    cargo near build reproducible-wasm
    cargo near deploy <account>
```

(Output as of writing; it reflects the live chain.)

### Exit codes, so it can gate a pipeline

| Code | Meaning |
|---|---|
| `0` | readable source exists: a link that resolves (or could not be checked), or a SourceScan record matching the deployed code |
| `1` | no readable source: nothing published, a dead or placeholder link, or only a SourceScan record for code that has since been replaced |
| `2` | not a contract |
| `3` | lookup failed |

```bash
# fail your own build if a dependency stops publishing source
node dist/bin.js some-dependency.near || echo "dependency publishes no readable source"
```

A link that could not be checked (rate limiting, a non-GitHub host) gets the benefit of the doubt: an
unreadable answer must not fail someone's build.

### Every command

| Command | What it does | Runtime (approx.) |
|---|---|---|
| `npm test` | the test suite, no network | 3 s |
| `node dist/bin.js <account>` | check one contract | 3–15 s, depending on the public RPC |
| `npm run weigh` | NEAR custody and its concentration → finding 3 | instant |
| `npm run report` | regenerate `report/index.html` from `data/` | instant |
| `npm run enumerate -- <n>` | rebuild the target set from the indexer | 1 min |
| `npm run links` | do the published links resolve, and are they pinned? → finding 1 | 1 min |
| `npm run verified` | read both SourceScan registries → finding 2 | 10–15 min |
| `npm run scan` | scan the whole target set → finding 1 | 10–15 min |

The slow ones make one or two RPC calls per contract against a free public endpoint, and back off
when rate limited rather than hammering it. **The datasets they produce are committed**, so `weigh`
and `report` reproduce findings 2 and 3 immediately.

## Tests

```bash
npm test
```

85 tests, no network, no dependencies beyond Node's built-in runner. They cover the **pure logic**:
coverage denominators, the link parser (placeholder, pinned, unpinned, tag-versus-commit), repository
status handling, the verdict and exit code for every combination, registry page parsing and
classification, global-contract handling, BigInt balance sums, and report rendering — including
HTML escaping and that it never prints `undefined` or `NaN`.

**Not covered:** the network code (RPC retry and endpoint rotation, indexer paging, the GitHub
requests) and the CLI orchestration in `cli.ts` and `bin.ts`. Those are exercised by running them,
not by tests. Fixtures for the real response shapes are copied from live calls.

**The suite was mutation-tested**, because tests that pass prove nothing on their own. Each break
below was introduced deliberately and caught:

| Deliberate break | Failures |
|---|---|
| any registry record counts as readable source (the original exit-code bug) | 3 |
| any ref counts as "pinned" | 2 |
| a 429 from GitHub reported as "repo not found" | 2 |
| "rebuildable" ignores whether the repo resolves | 2 |
| deleted accounts folded into "could not tell" | 1 |
| registry page parser stops validating its shape | 1 |
| concentration disclosure removed from the report | 1 |
| report claims the sample is random | 1 |
| placeholder detection removed | 4 |
| global-contract hash ignored | 2 |

One further mutation survived and is not a gap: it removed a guard in `check.ts` that
`parseSourceLink` already makes redundant, so it changes nothing observable. I confirmed that by
breaking the real protection instead (the placeholder row above).

## How it works

1. `view_account` — what code does the account run? An all-ones `code_hash` means **no local code**,
   which is *not* the same as no contract; see the third trap below.
2. `call_function` on `contract_source_metadata` — the NEP-330 method. A contract without it fails
   with `MethodResolveError(MethodNotFound)`.
3. `get_contracts` / `get_contract` on both SourceScan registries.
4. Parse the link (`links.ts`), HEAD the GitHub repository, and check whether it names a commit.
5. One shared function (`verdict.ts`) turns all of that into a verdict and an exit code. The CLI and
   the checker both use it; they used to be two implementations that could disagree.

Accounts we fail to reach are counted as errors and never folded into a finding.

### Three traps that produced wrong numbers here first

**A failed NEAR view call is not a JSON-RPC error.** The request returns HTTP 200 and the failure is
a string inside `result.error`. Treating it as an error made every contract lacking the method look
like an infrastructure failure, and the first run of this tool reported **100% coverage** with 34
"errors".

**`get_contracts` returns `[entries, pageCount]`, not `[entries, total]`.** The second element is the
number of pages at the requested limit: 105 at limit 1, 53 at limit 2, 5 at limit 25, 1 at limit 500,
all describing the same 105 records. Reading it as a total gave "53 verified contracts". The parser
is now strict, so a changed shape fails loudly instead of producing a plausible wrong number.

**An all-ones `code_hash` is not an empty account.** NEAR's global contracts ([NEP-591]) report it
too, with a `global_contract_hash` instead. The scanner read it as "no contract" and threw those
accounts away. **12 of the 105 registry accounts run a global contract.** Misreading them made 10
records that do match look redeployed, which is why this repo first reported 54 matches instead of 64.

[NEP-591]: https://github.com/near/NEPs/blob/master/neps/nep-0591.md

## Corrections

A review of an earlier version of this repo found these claims wrong, and they were fixed:

- *"54 contracts on the whole chain match their verification"* — it was 64. Global-contract accounts
  were being misfiled (trap three).
- *"42 verifications are stale, so the published source describes code no longer running"* — 29 are
  redeployed, and 27 of those publish their own link. The framing was the real error: a stale
  registry record is not a trust gap.
- *"105 is complete"* — 112 across both registries.
- *"20.2% publish a usable link"* — a link that resolves **and** is pinned is 3.6%.
- *"The sample is not weighted toward anything"* — it follows the indexer's order, which is.
- *The checker exited 0 for a contract with no readable source* whenever any registry record existed.
- *"Explorers still show it as verified"* — never checked, and removed.

## Fixing it, if this is your contract

Build reproducibly so the metadata is embedded, and **make sure the link names a commit**:

```bash
cargo near build reproducible-wasm
cargo near deploy <account>
```

Then verify and publish on NearBlocks, under the contract's Contract tab.

## Repo map

```
src/rpc.ts         NEAR JSON-RPC client; retries, endpoint rotation, global-contract handling
src/scan.ts        per-account inspection and the summary statistics
src/links.ts       link parsing, repository resolution, rebuildability
src/verified.ts    both SourceScan registries: parsing, lookup, classification
src/verdict.ts     the one place that decides a verdict and an exit code
src/check.ts       check one contract; shared by the CLI and the checker
src/enumerate.ts   indexer-derived target set, rate-limit tolerant
src/weight.ts      NEAR custody by balance and state, with concentration disclosure
src/report.ts      static HTML report, a pure function of the datasets
src/bin.ts         the shelflife checker
src/cli.ts         command dispatch
test/              unit tests, no network
data/              committed datasets — scan, links, registries, target set
report/index.html  generated report
```

## Roadmap

- [x] NEP-330 metadata scan
- [x] Both SourceScan registries, with staleness and what each stale contract publishes today
- [x] Link resolution and pinned-to-commit check
- [x] `shelflife` checker with CI exit codes
- [x] Static report
- [ ] Reproducible rebuild via Docker and `cargo near`: does a pinned link actually produce the
      deployed bytes? This is what would turn "rebuildable" into "rebuilt".
- [ ] Measure the share of non-Rust contracts in the sample
- [ ] Check what NearBlocks displays for stale-verified contracts

## Dependencies and prior code

Written from scratch for the NEAR hackathon; no templates or starter kits. **Runtime dependencies:
none** — the RPC client is plain `fetch`. Dev dependencies are `typescript`, `tsx` and
`@types/node`. Verified to install and run from a clean clone.

## Licence

MIT — see [LICENSE](./LICENSE).
