import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scanAccount, scanAll, summarise, type ScanRecord } from "./scan.js";

const DATA_DIR = new URL("../data/", import.meta.url);

const STATUS_LABEL: Record<string, string> = {
  no_account: "no account",
  no_contract: "no contract",
  no_metadata: "NO SOURCE LINK",
  metadata: "has metadata",
  error: "error",
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

async function runScan() {
  const targetsRaw = await readFile(new URL("targets.json", DATA_DIR), "utf8");
  const { accounts } = JSON.parse(targetsRaw) as { accounts: string[] };

  console.log(`scanning ${accounts.length} accounts on NEAR mainnet\n`);

  const records = await scanAll(accounts, (r, i, total) => {
    const label = STATUS_LABEL[r.status] ?? r.status;
    const link = r.metadata?.link ? `  ${r.metadata.link}` : "";
    console.log(`[${String(i).padStart(3)}/${total}] ${r.accountId.padEnd(62)} ${label}${link}`);
  });

  const summary = summarise(records);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    new URL("scan-latest.json", DATA_DIR),
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, records }, null, 2) + "\n",
  );

  console.log("\n" + "=".repeat(72));
  console.log("accounts scanned          ", summary.scanned);
  console.log("  no such account         ", summary.byStatus.no_account);
  console.log("  account, no contract    ", summary.byStatus.no_contract);
  console.log("  errors                  ", summary.byStatus.error);
  console.log("-".repeat(72));
  console.log("contracts inspected       ", summary.contractsWithCode);
  console.log("  expose source metadata  ", summary.withMetadata);
  console.log("  of those, with a link   ", summary.withRepoLink);
  console.log("  NO source metadata      ", summary.byStatus.no_metadata);
  console.log("-".repeat(72));
  console.log("metadata coverage         ", pct(summary.coveragePct));
  console.log("=".repeat(72));
  console.log("\nwrote data/scan-latest.json");
  console.log(
    "\nNote: no metadata != unverified. SourceScan and NearBlocks may hold a\n" +
      "verification record separately. That path is checked in a later step; until\n" +
      "then this measures NEP-330 self-published metadata only.",
  );
}

async function runCheck(accountId: string) {
  const r: ScanRecord = await scanAccount(accountId);
  console.log(`\n${r.accountId}`);
  console.log(`  status      ${STATUS_LABEL[r.status] ?? r.status}`);
  if (r.codeHash) console.log(`  code hash   ${r.codeHash}`);
  if (r.storageBytes !== undefined) console.log(`  storage     ${r.storageBytes} bytes`);
  if (r.metadata) {
    console.log(`  version     ${r.metadata.version ?? "-"}`);
    console.log(`  source      ${r.metadata.link ?? "(none published)"}`);
    const standards = r.metadata.standards?.map((s) => s.standard).filter(Boolean).join(", ");
    if (standards) console.log(`  standards   ${standards}`);
  }
  if (r.rawMetadata) console.log(`  raw         ${r.rawMetadata.slice(0, 200)}`);
  if (r.error) console.log(`  error       ${r.error}`);
  console.log();
}

const [command, arg] = process.argv.slice(2);

if (command === "scan") {
  await runScan();
} else if (command === "check" && arg) {
  await runCheck(arg);
} else {
  console.log("usage:\n  npm run scan\n  npm run check -- <account.near>");
  process.exit(1);
}
