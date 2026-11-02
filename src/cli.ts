import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scanAccount, scanAll, summarise, type ScanRecord, type Summary } from "./scan.js";
import {
  LEGACY_VERIFIER_ACCOUNT,
  VERIFIER_ACCOUNT,
  classifyRecord,
  fetchAllVerified,
  fetchLegacy,
  looksLikeTestAccount,
  type Outcome,
  type Today,
} from "./verified.js";
import { countTokens, dedupe, listTokens, type TokenContract } from "./enumerate.js";
import { formatBytes, formatNear, weigh } from "./weight.js";
import { buildReport } from "./report.js";
import { checkContract, exitCodeFor, renderCheck } from "./check.js";
import { buildRows, checkRepo, parseSourceLink, repoKey, summariseLinks, type RepoStatus } from "./links.js";

const DATA_DIR = new URL("../data/", import.meta.url);

const STATUS_LABEL: Record<string, string> = {
  no_account: "no account",
  no_contract: "no contract",
  no_metadata: "no metadata",
  metadata: "has metadata",
  error: "error",
};

const pct = (n: number) => `${n.toFixed(1)}%`;
const rule = (c = "-") => console.log(c.repeat(74));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, DATA_DIR), "utf8")) as T;
}

/**
 * Prefer the indexer-derived set when it exists; fall back to the hand-written seed
 * list. Which one was used is printed, because it changes what the numbers mean.
 */
async function loadTargets(): Promise<{ accounts: string[]; source: string }> {
  try {
    const { contracts } = await readJson<{ contracts: TokenContract[] }>("contracts.json");
    return { accounts: contracts.map((c) => c.contract), source: "indexer (data/contracts.json)" };
  } catch {
    const { accounts } = await readJson<{ accounts: string[] }>("targets.json");
    return { accounts, source: "hand-written seed list (data/targets.json)" };
  }
}

/** account -> "ft" | "nft", for splitting results by what kind of token contract it is. */
async function loadKinds(): Promise<Map<string, string>> {
  try {
    const { contracts } = await readJson<{ contracts: TokenContract[] }>("contracts.json");
    return new Map(contracts.map((c) => [c.contract, c.kind]));
  } catch {
    return new Map();
  }
}

function summariseByKind(records: ScanRecord[], kinds: Map<string, string>): Record<string, Summary> {
  const out: Record<string, Summary> = {};
  for (const kind of ["ft", "nft"]) {
    const subset = records.filter((r) => kinds.get(r.accountId) === kind);
    if (subset.length > 0) out[kind] = summarise(subset);
  }
  return out;
}

async function runEnumerate(maxPerKind: number) {
  const [ftTotal, nftTotal] = await Promise.all([countTokens("ft"), countTokens("nft")]);
  console.log(`NearBlocks indexes ${ftTotal} fungible-token and ${nftTotal} NFT contracts`);
  console.log(`taking up to ${maxPerKind} of each\n`);

  const ft = await listTokens("ft", maxPerKind, (n, t) =>
    process.stdout.write(`\r  fungible tokens  ${n}/${t}`),
  );
  process.stdout.write("\n");
  const nft = await listTokens("nft", maxPerKind, (n, t) =>
    process.stdout.write(`\r  nft contracts    ${n}/${t}`),
  );
  process.stdout.write("\n");

  const contracts = dedupe([ft.tokens, nft.tokens]);
  const truncated = ft.truncated || nft.truncated;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    new URL("contracts.json", DATA_DIR),
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "https://api.nearblocks.io/v1 (fts + nfts)",
        samplingRule:
          `The first ${maxPerKind} of each token kind, in the order the NearBlocks API returns them. ` +
          "That order is not random: the fungible-token list leads with the best-known tokens, and the " +
          "NFT list is dominated by airdrop and reward contracts. Token contracts are the only contract " +
          "population on NEAR that can be enumerated — no RPC method lists every contract.",
        indexedTotals: { fungibleTokens: ftTotal, nftContracts: nftTotal },
        truncatedByRateLimit: truncated,
        count: contracts.length,
        contracts,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`\n${contracts.length} unique contracts -> data/contracts.json`);
  if (truncated) {
    console.log(
      "note: the indexer rate-limited us before the requested size was reached.\n" +
        "      The sample is smaller than asked for; this is recorded in the file.",
    );
  }
}

async function runScan() {
  const { accounts, source } = await loadTargets();
  const kinds = await loadKinds();

  console.log(`target set: ${source}`);
  console.log(`scanning ${accounts.length} accounts on NEAR mainnet\n`);
  // A per-account line is useful for 45 contracts and unreadable for 2,000.
  const verbose = accounts.length <= 100;
  let withMeta = 0;

  const records = await scanAll(accounts, (r, i, total) => {
    if (r.status === "metadata") withMeta++;
    if (verbose) {
      const link = r.metadata?.link ? `  ${r.metadata.link}` : "";
      console.log(`[${String(i).padStart(4)}/${total}] ${r.accountId.padEnd(56)} ${STATUS_LABEL[r.status]}${link}`);
    } else if (i % 25 === 0 || i === total) {
      process.stdout.write(`\r  ${i}/${total} scanned, ${withMeta} with metadata`);
    }
  });
  if (!verbose) process.stdout.write("\n");

  console.log("\nreading both SourceScan registries...");
  const [v2, legacy] = [await fetchAllVerified(), await fetchLegacy()];
  const registryIds = new Set([...v2.keys(), ...legacy.keys()]);

  const summary = summarise(records);
  const inspected = records.filter((r) => r.status === "metadata" || r.status === "no_metadata");
  const inRegistry = inspected.filter((r) => registryIds.has(r.accountId));
  const neither = inspected.filter((r) => r.status === "no_metadata" && !registryIds.has(r.accountId));
  const byKind = summariseByKind(records, kinds);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    new URL("scan-latest.json", DATA_DIR),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        byKind,
        sourcescanRegistries: { v2: v2.size, legacy: legacy.size, union: registryIds.size },
        verifiedInSample: inRegistry.map((r) => r.accountId),
        records,
      },
      null,
      2,
    ) + "\n",
  );

  console.log();
  rule("=");
  console.log("accounts scanned           ", summary.scanned);
  console.log("  no such account          ", summary.byStatus.no_account);
  console.log("  account, no contract     ", summary.byStatus.no_contract);
  console.log("  errors (not counted)     ", summary.byStatus.error);
  rule();
  console.log("contracts inspected        ", summary.contractsWithCode);
  console.log("  expose NEP-330 metadata  ", summary.withMetadata, `(${pct(summary.coveragePct)})`);
  console.log("  ...carrying a link       ", summary.withRepoLink, `(${pct(summary.linkCoveragePct)})`);
  console.log("  ...metadata, no link     ", summary.withMetadata - summary.withRepoLink);
  console.log("  in a SourceScan registry ", inRegistry.length);
  console.log("  neither metadata nor one ", neither.length);
  rule();
  for (const [kind, s] of Object.entries(byKind)) {
    console.log(
      `${kind === "ft" ? "fungible tokens" : "NFT contracts  "}  ${String(s.contractsWithCode).padStart(4)} inspected, ` +
        `${pct(s.coveragePct)} metadata, ${pct(s.linkCoveragePct)} with a link`,
    );
  }
  rule();
  console.log("distinct bytecode          ", summary.distinctCodeHashes, `(from ${summary.contractsWithCode} accounts)`);
  console.log("unique-bytecode contracts  ", summary.uniqueBytecodeContracts);
  console.log("  of those, with metadata  ", summary.uniqueBytecodeWithMetadata, `(${pct(summary.uniqueBytecodeCoveragePct)})`);
  rule("=");
  console.log("\nwrote data/scan-latest.json");
  console.log("next: npm run links   (do those links resolve, and are they pinned?)");
}

/**
 * Every contract SourceScan has verified — across BOTH registries — and for each one,
 * what became of it. A stale record is not the end of the story: the contract may have
 * moved on to publishing source itself, so what it publishes today is checked too.
 */
async function runVerified() {
  console.log(`reading ${VERIFIER_ACCOUNT} and ${LEGACY_VERIFIER_ACCOUNT}...\n`);
  const v2 = await fetchAllVerified();
  const legacy = await fetchLegacy();
  const legacyOnly = [...legacy.keys()].filter((id) => !v2.has(id));

  const langs: Record<string, number> = {};
  for (const rec of v2.values()) langs[rec.lang] = (langs[rec.lang] ?? 0) + 1;

  const outcomes = new Map<string, Outcome>();
  const scans = new Map<string, ScanRecord>();

  for (const [accountId, record] of v2) {
    const scan = await scanAccount(accountId);
    scans.set(accountId, scan);
    outcomes.set(accountId, classifyRecord(record, scan));
    await sleep(150);
  }

  // A second and third look at anything we could not determine. An unresolved answer is
  // a failure of ours, not a finding, so it gets every chance to become a real one.
  for (let pass = 0; pass < 2; pass++) {
    const unresolved = [...outcomes].filter(([, o]) => o.kind === "unresolved" || (o.kind === "stale" && o.today === "unresolved"));
    if (unresolved.length === 0) break;
    await sleep(4_000);
    for (const [accountId] of unresolved) {
      const record = v2.get(accountId);
      if (!record) continue;
      const scan = await scanAccount(accountId);
      scans.set(accountId, scan);
      outcomes.set(accountId, classifyRecord(record, scan));
      await sleep(300);
    }
  }

  const ids = (kind: Outcome["kind"]) => [...outcomes].filter(([, o]) => o.kind === kind).map(([id]) => id);
  const current = ids("current");
  const deleted = ids("deleted");
  const codeRemoved = ids("code_removed");
  const unresolved = ids("unresolved");

  const stale = [...outcomes].flatMap(([accountId, o]) => {
    if (o.kind !== "stale") return [];
    const link = scans.get(accountId)?.metadata?.link;
    const parsed = link ? parseSourceLink(link) : undefined;
    return [{ accountId, today: o.today, ...(link ? { link } : {}), ...(parsed ? { pinned: parsed.pinned } : {}) }];
  });
  const todayCount = (t: Today) => stale.filter((s) => s.today === t).length;

  const unionIds = new Set([...v2.keys(), ...legacy.keys()]);
  const testLike = [...unionIds].filter(looksLikeTestAccount);

  const out = {
    generatedAt: new Date().toISOString(),
    registries: {
      v2: { account: VERIFIER_ACCOUNT, records: v2.size },
      legacy: { account: LEGACY_VERIFIER_ACCOUNT, records: legacy.size },
    },
    unionRecords: unionIds.size,
    legacyOnly,
    v2: {
      total: v2.size,
      byLanguage: langs,
      current: current.length,
      redeployed: stale.length,
      deleted: deleted.length,
      codeRemoved: codeRemoved.length,
      unresolved: unresolved.length,
    },
    staleToday: {
      publishesLink: todayCount("link"),
      publishesPinnedLink: stale.filter((s) => s.today === "link" && s.pinned).length,
      metadataNoLink: todayCount("nolink"),
      publishesNothing: todayCount("none"),
      brokenContract: todayCount("broken"),
      unresolved: todayCount("unresolved"),
    },
    testLikeAccounts: { inUnion: testLike.length, inCurrent: current.filter(looksLikeTestAccount).length },
    stale,
    deleted,
    current,
    records: Object.fromEntries(v2),
    legacyRecords: Object.fromEntries(legacy),
  };
  await writeFile(new URL("verified-latest.json", DATA_DIR), JSON.stringify(out, null, 2) + "\n");

  rule("=");
  console.log(`SourceScan registries: ${v2.size} current + ${legacy.size} older = ${unionIds.size} records ever`);
  console.log("language, current registry:", JSON.stringify(langs));
  rule();
  console.log(`of the ${v2.size} in the current registry:`);
  console.log("  record still matches deployed code ", current.length);
  console.log("  redeployed since verification      ", stale.length);
  console.log("  account deleted                    ", deleted.length);
  console.log("  code removed from the account      ", codeRemoved.length);
  console.log("  could not be determined            ", unresolved.length);
  rule();
  console.log(`of the ${stale.length} redeployed, what each publishes TODAY:`);
  console.log("  a source link of its own           ", out.staleToday.publishesLink, `(${out.staleToday.publishesPinnedLink} pinned to a commit)`);
  console.log("  metadata, but no link              ", out.staleToday.metadataNoLink);
  console.log("  nothing                            ", out.staleToday.publishesNothing);
  console.log("  broken (will not compile)          ", out.staleToday.brokenContract);
  console.log("  could not be determined            ", out.staleToday.unresolved);
  rule();
  console.log(`names that look like tests/staging: ${out.testLikeAccounts.inUnion} of ${unionIds.size} (heuristic)`);
  rule("=");
  console.log("\nwrote data/verified-latest.json");
}

/**
 * Do the published links go anywhere, and are they pinned to a commit?
 *
 * Kept as its own step: it talks to GitHub rather than NEAR, it is slow, and it should
 * not make the scan itself non-reproducible.
 */
async function runLinks() {
  const scan = await readJson<{ generatedAt: string; records: ScanRecord[] }>("scan-latest.json");
  const inspected = scan.records.filter((r) => r.status === "metadata" || r.status === "no_metadata").length;

  const repos = new Map<string, string>();
  for (const r of scan.records) {
    const link = r.metadata?.link;
    if (!link) continue;
    const p = parseSourceLink(link);
    if (p.kind === "github" && p.repo) repos.set(repoKey(p.repo), p.repo);
  }

  console.log(`checking ${repos.size} distinct GitHub repositories (from ${scan.records.length} scanned accounts)\n`);
  const statuses = new Map<string, RepoStatus>();
  let i = 0;
  for (const [key, repo] of repos) {
    const status = await checkRepo(repo);
    statuses.set(key, status);
    console.log(`  [${String(++i).padStart(2)}/${repos.size}] ${repo.padEnd(48)} ${status}`);
    await sleep(500);
  }

  const rows = buildRows(scan.records, statuses);
  const summary = summariseLinks(rows, inspected);

  await writeFile(
    new URL("links-latest.json", DATA_DIR),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scanGeneratedAt: scan.generatedAt,
        note: "not_found is a 404, which GitHub also returns for private repositories.",
        summary,
        repos: Object.fromEntries(statuses),
        rows: rows.map((r) => ({
          accountId: r.accountId,
          link: r.parsed.raw,
          kind: r.parsed.kind,
          repo: r.parsed.repo,
          ref: r.parsed.ref,
          pinned: r.parsed.pinned,
          repoStatus: r.repoStatus,
        })),
      },
      null,
      2,
    ) + "\n",
  );

  console.log();
  rule("=");
  console.log(`contracts inspected                ${summary.inspected}`);
  console.log(`  carry a source link              ${summary.contractsWithLink}  (${pct(summary.withLinkPct)})`);
  console.log(`    template placeholder           ${summary.placeholder}`);
  console.log(`    not GitHub                     ${summary.otherHost}`);
  console.log(`    GitHub                         ${summary.githubContracts}  (${summary.distinctRepos} distinct repos)`);
  console.log(`  ...whose repository resolves     ${summary.contractsResolving}  (${pct(summary.resolvingPct)})`);
  console.log(`  ...repository returns 404        ${summary.contractsNotFound}`);
  console.log(`  ...pinned to a commit            ${summary.contractsPinned}`);
  rule();
  console.log(`  REBUILDABLE (resolves + pinned)  ${summary.contractsRebuildable}  (${pct(summary.rebuildablePct)})   <- the number that matters`);
  rule("=");
  console.log("\nwrote data/links-latest.json");
}

/** NEAR held by contracts with no published source — and how concentrated it is. */
async function runWeigh() {
  const scan = await readJson<{ records: ScanRecord[]; verifiedInSample?: string[] }>("scan-latest.json");
  const w = weigh(scan.records, new Set(scan.verifiedInSample ?? []));

  rule("=");
  console.log(`NEAR custody across ${w.totalContracts} inspected contracts`);
  rule();
  for (const b of w.buckets) {
    console.log(`  ${b.label}`);
    console.log(
      `      ${String(b.contracts).padStart(4)} contracts   ` +
        `${formatNear(b.balanceYocto).padStart(14)} NEAR   ` +
        `${formatBytes(b.storageBytes).padStart(9)} state`,
    );
  }
  rule();
  console.log(`  total                 ${formatNear(w.totalBalanceYocto)} NEAR, ${formatBytes(w.totalStorageBytes)}`);
  console.log(`  held by contracts with no metadata and no registry record  ${w.unverifiableBalanceShare.toFixed(1)}%`);
  console.log(`  state held by them                                         ${w.unverifiableStorageShare.toFixed(1)}%`);
  rule();
  console.log("  concentration — these aggregates are not evenly spread:");
  for (const c of w.topUnverifiable) {
    console.log(
      `    ${c.accountId.padEnd(30)} ${formatNear(c.balanceYocto).padStart(14)} NEAR ` +
        `(${c.balanceShare.toFixed(1)}% of sample), ${formatBytes(c.storageBytes)}`,
    );
  }
  console.log(
    "\n  Quote the headline with this table, never without it: wrapped NEAR holds the backing\n" +
      "  for every wNEAR in existence, so one account dominates the total.\n" +
      "  This counts NEAR balance only. A token contract's value to its users is in the tokens\n" +
      "  it issues, which this does not capture — treat it as a floor, not a measure of risk.",
  );
  rule("=");
}

async function runCheck(accountId: string) {
  const result = await checkContract(accountId);
  console.log(renderCheck(result).join("\n"));
  process.exitCode = exitCodeFor(result);
}

const [command, arg] = process.argv.slice(2);

if (command === "scan") await runScan();
else if (command === "verified") await runVerified();
else if (command === "links") await runLinks();
else if (command === "weigh") await runWeigh();
else if (command === "report") console.log("wrote", await buildReport());
else if (command === "enumerate") await runEnumerate(Number(arg) || 400);
else if (command === "check" && arg) await runCheck(arg);
else {
  console.log(
    "usage:\n" +
      "  npm run enumerate -- [maxPerKind]   build the target set from the indexer\n" +
      "  npm run scan                        scan the target set\n" +
      "  npm run links                       do the published links resolve, and are they pinned?\n" +
      "  npm run verified                    audit both SourceScan registries\n" +
      "  npm run weigh                       NEAR custody and its concentration\n" +
      "  npm run report                      regenerate report/index.html\n" +
      "  npm run check -- <account.near>     check one contract",
  );
  process.exitCode = 1;
}
