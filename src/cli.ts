import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scanAccount, scanAll, summarise, type ScanRecord } from "./scan.js";
import { fetchAllVerified, getVerified, isCurrent, type VerifiedRecord } from "./verified.js";
import { viewAccount } from "./rpc.js";
import { countTokens, dedupe, listTokens, type TokenContract } from "./enumerate.js";
import { formatBytes, formatNear, weigh } from "./weight.js";

const DATA_DIR = new URL("../data/", import.meta.url);

const STATUS_LABEL: Record<string, string> = {
  no_account: "no account",
  no_contract: "no contract",
  no_metadata: "NO SOURCE LINK",
  metadata: "has metadata",
  error: "error",
};

const pct = (n: number) => `${n.toFixed(1)}%`;
const rule = (c = "-") => console.log(c.repeat(74));

/**
 * Prefer the indexer-derived set when it exists; fall back to the hand-written seed
 * list. Which one was used is printed, because it changes what the numbers mean.
 */
async function loadTargets(): Promise<{ accounts: string[]; source: string }> {
  try {
    const raw = await readFile(new URL("contracts.json", DATA_DIR), "utf8");
    const { contracts } = JSON.parse(raw) as { contracts: TokenContract[] };
    return { accounts: contracts.map((c) => c.contract), source: "indexer (data/contracts.json)" };
  } catch {
    const raw = await readFile(new URL("targets.json", DATA_DIR), "utf8");
    const { accounts } = JSON.parse(raw) as { accounts: string[] };
    return { accounts, source: "hand-written seed list (data/targets.json)" };
  }
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
        samplingRule: `Up to ${maxPerKind} of each token kind, in indexer order. Token contracts are the only contract population on NEAR that can be enumerated — no RPC method lists every contract.`,
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

  console.log("\ncross-referencing SourceScan verifier registry...");
  const verified = await fetchAllVerified();

  const summary = summarise(records);
  const inspected = records.filter((r) => r.status === "metadata" || r.status === "no_metadata");
  const verifiedInSample = inspected.filter((r) => verified.has(r.accountId));
  const eitherPath = inspected.filter(
    (r) => r.status === "metadata" || verified.has(r.accountId),
  );

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    new URL("scan-latest.json", DATA_DIR),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        sourcescanTotalVerified: verified.size,
        verifiedInSample: verifiedInSample.map((r) => r.accountId),
        records,
      },
      null,
      2,
    ) + "\n",
  );

  console.log();
  rule("=");
  console.log("accounts scanned          ", summary.scanned);
  console.log("  no such account         ", summary.byStatus.no_account);
  console.log("  account, no contract    ", summary.byStatus.no_contract);
  console.log("  errors                  ", summary.byStatus.error);
  rule();
  console.log("contracts inspected       ", summary.contractsWithCode);
  console.log("  publish NEP-330 metadata", summary.withMetadata);
  console.log("  of those, with a link   ", summary.withRepoLink);
  console.log("  in SourceScan registry  ", verifiedInSample.length);
  console.log("  verifiable by EITHER    ", eitherPath.length);
  console.log("  verifiable by NEITHER   ", summary.contractsWithCode - eitherPath.length);
  rule();
  console.log("coverage, metadata present", pct(summary.coveragePct));
  console.log("coverage, usable link     ", pct(summary.linkCoveragePct), " <- the honest one");
  console.log("coverage, either path     ", pct((eitherPath.length / summary.contractsWithCode) * 100));
  rule();
  console.log("distinct bytecode         ", summary.distinctCodeHashes, `(from ${summary.contractsWithCode} accounts)`);
  console.log("unique-bytecode contracts ", summary.uniqueBytecodeContracts);
  console.log("  of those, with metadata ", summary.uniqueBytecodeWithMetadata, `(${pct(summary.uniqueBytecodeCoveragePct)})`);
  rule();
  console.log("SourceScan total, chainwide", verified.size);
  rule("=");
  console.log("\nwrote data/scan-latest.json");
}

/** Every contract SourceScan has verified, and whether the record still matches chain. */
async function runVerified() {
  console.log(`reading ${"v2-verifier.sourcescan.near"}...\n`);
  const verified = await fetchAllVerified();

  const langs: Record<string, number> = {};
  for (const rec of verified.values()) langs[rec.lang] = (langs[rec.lang] ?? 0) + 1;

  let current = 0;
  let stale = 0;
  let gone = 0;
  const staleAccounts: string[] = [];

  for (const [accountId, record] of verified) {
    try {
      const account = await viewAccount(accountId);
      if (isCurrent(record, account.code_hash)) current++;
      else {
        stale++;
        staleAccounts.push(accountId);
      }
    } catch {
      gone++;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    verifier: "v2-verifier.sourcescan.near",
    totalVerified: verified.size,
    byLanguage: langs,
    stillMatchesChain: current,
    redeployedSinceVerification: stale,
    accountUnreachable: gone,
    staleAccounts,
    records: Object.fromEntries(verified),
  };
  await writeFile(new URL("verified-latest.json", DATA_DIR), JSON.stringify(out, null, 2) + "\n");

  rule("=");
  console.log("SourceScan-verified contracts, NEAR mainnet:", verified.size);
  console.log("by language:", JSON.stringify(langs));
  rule();
  console.log("  record still matches deployed code ", current);
  console.log("  REDEPLOYED since verification      ", stale);
  console.log("  account unreachable                ", gone);
  rule("=");
  if (staleAccounts.length) {
    console.log("\nredeployed since they were verified:");
    for (const a of staleAccounts) console.log("  " + a);
  }
  console.log("\nwrote data/verified-latest.json");
}

/** How much value and state sits behind code nobody can check. */
async function runWeigh() {
  const scan = JSON.parse(await readFile(new URL("scan-latest.json", DATA_DIR), "utf8")) as {
    records: ScanRecord[];
    verifiedInSample?: string[];
  };
  const verified = new Set(scan.verifiedInSample ?? []);
  const w = weigh(scan.records, verified);

  rule("=");
  console.log(`exposure across ${w.totalContracts} inspected contracts`);
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
  console.log(`  held behind no published source  ${w.unverifiableBalanceShare.toFixed(1)}% of NEAR`);
  console.log(`  state behind no published source ${w.unverifiableStorageShare.toFixed(1)}%`);
  rule();
  console.log("  concentration — these aggregates are not evenly spread:");
  for (const c of w.topUnverifiable) {
    console.log(
      `    ${c.accountId.padEnd(30)} ${formatNear(c.balanceYocto).padStart(14)} NEAR ` +
        `(${c.balanceShare.toFixed(1)}% of sample), ${formatBytes(c.storageBytes)}`,
    );
  }
  console.log(
    "\n  Quote the headline with this table, never without it. Wrapped NEAR holds the\n" +
      "  backing for every wNEAR in existence, so one account dominates the total.",
  );
  rule("=");
}

async function runCheck(accountId: string) {
  const r: ScanRecord = await scanAccount(accountId);
  let registry: VerifiedRecord | null = null;
  try {
    registry = await getVerified(accountId);
  } catch {
    /* registry lookup is best-effort; absence is reported, not asserted */
  }

  console.log(`\n${r.accountId}`);
  console.log(`  status        ${STATUS_LABEL[r.status] ?? r.status}`);
  if (r.codeHash) console.log(`  code hash     ${r.codeHash}`);
  if (r.storageBytes !== undefined) console.log(`  storage       ${r.storageBytes} bytes`);
  if (r.metadata) {
    console.log(`  version       ${r.metadata.version ?? "-"}`);
    console.log(`  source        ${r.metadata.link ?? "(metadata published, but no link)"}`);
  }
  if (registry && r.codeHash) {
    const fresh = isCurrent(registry, r.codeHash);
    console.log(`  SourceScan    verified (${registry.lang}), ${fresh ? "matches deployed code" : "STALE — redeployed since"}`);
    console.log(`  source CID    ${registry.cid}`);
  } else {
    console.log(`  SourceScan    not in registry`);
  }
  if (r.error) console.log(`  error         ${r.error}`);
  console.log();
}

const [command, arg] = process.argv.slice(2);

if (command === "scan") await runScan();
else if (command === "verified") await runVerified();
else if (command === "weigh") await runWeigh();
else if (command === "enumerate") await runEnumerate(Number(arg) || 400);
else if (command === "check" && arg) await runCheck(arg);
else {
  console.log(
    "usage:\n" +
      "  npm run enumerate -- [maxPerKind]   build the target set from the indexer\n" +
      "  npm run scan                        scan the target set\n" +
      "  npm run verified                    audit the SourceScan registry\n" +
      "  npm run check -- <account.near>     check one contract",
  );
  process.exit(1);
}
