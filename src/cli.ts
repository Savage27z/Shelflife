import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scanAccount, scanAll, summarise, type ScanRecord } from "./scan.js";
import { fetchAllVerified, getVerified, isCurrent, type VerifiedRecord } from "./verified.js";
import { viewAccount } from "./rpc.js";

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

async function runScan() {
  const { accounts } = JSON.parse(
    await readFile(new URL("targets.json", DATA_DIR), "utf8"),
  ) as { accounts: string[] };

  console.log(`scanning ${accounts.length} accounts on NEAR mainnet\n`);
  const records = await scanAll(accounts, (r, i, total) => {
    const link = r.metadata?.link ? `  ${r.metadata.link}` : "";
    console.log(`[${String(i).padStart(3)}/${total}] ${r.accountId.padEnd(62)} ${STATUS_LABEL[r.status]}${link}`);
  });

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
  console.log("coverage, either path     ", pct((eitherPath.length / summary.contractsWithCode) * 100));
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
else if (command === "check" && arg) await runCheck(arg);
else {
  console.log("usage:\n  npm run scan\n  npm run verified\n  npm run check -- <account.near>");
  process.exit(1);
}
