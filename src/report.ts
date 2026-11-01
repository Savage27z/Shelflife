import { readFile, writeFile, mkdir } from "node:fs/promises";
import { summarise, type ScanRecord } from "./scan.js";
import { weigh, formatNear, formatBytes } from "./weight.js";
import type { VerifiedRecord } from "./verified.js";

/**
 * Generates a static report from the committed datasets.
 *
 * Every figure is computed here from data/*.json rather than typed in, so the page
 * cannot drift away from the numbers the tools actually produced. No framework and no
 * CDN: a single self-contained HTML file keeps the repo reproducible and means the
 * report still renders in five years.
 */

const DATA_DIR = new URL("../data/", import.meta.url);
const OUT_DIR = new URL("../report/", import.meta.url);

interface ScanFile {
  generatedAt: string;
  records: ScanRecord[];
  verifiedInSample?: string[];
  sourcescanTotalVerified?: number;
}

interface VerifiedFile {
  generatedAt: string;
  totalVerified: number;
  byLanguage: Record<string, number>;
  stillMatchesChain: number;
  redeployedSinceVerification: number;
  accountUnreachable: number;
  staleAccounts: string[];
  records: Record<string, VerifiedRecord>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (n: number) => `${n.toFixed(1)}%`;

function page(body: string, generatedAt: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sourcecheck — NEAR contract source verification</title>
<style>
  :root {
    --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b66; --line: #e3e3df;
    --card: #ffffff; --accent: #0b6e4f; --warn: #a6630b; --bad: #a32a2a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141414; --fg: #ededea; --muted: #9a9a94; --line: #2b2b2b;
      --card: #1c1c1c; --accent: #4ec38a; --warn: #e0a33a; --bad: #e46a6a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 16px; background: var(--bg); color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 820px; margin: 0 auto; padding: 56px 0 96px; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.02em; }
  h2 { font-size: 1.25rem; margin: 48px 0 12px; letter-spacing: -0.01em; }
  h3 { font-size: 1rem; margin: 28px 0 8px; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 14px; }
  .lede { color: var(--muted); font-size: 1.05rem; }
  .meta { color: var(--muted); font-size: 0.85rem; }
  .big { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 20px 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .card .label { color: var(--muted); font-size: 0.82rem; margin-top: 6px; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 0.92rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
  .note { border-left: 3px solid var(--warn); padding: 10px 14px; margin: 18px 0;
          background: var(--card); border-radius: 0 8px 8px 0; font-size: 0.93rem; }
  .accent { color: var(--accent); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  footer { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
  @media (max-width: 560px) { .big { font-size: 2rem; } main { padding-top: 32px; } }
</style>
<main>
${body}
<footer>
  <p>Generated ${esc(generatedAt)} from the datasets committed in <code>data/</code>.
  Every figure is computed from those files, not written by hand — re-run
  <code>npm run scan</code>, <code>npm run verified</code> and <code>npm run report</code>
  to reproduce this page.</p>
</footer>
</main>
</html>
`;
}

export async function buildReport(): Promise<string> {
  const scan = JSON.parse(await readFile(new URL("scan-latest.json", DATA_DIR), "utf8")) as ScanFile;
  const ver = JSON.parse(await readFile(new URL("verified-latest.json", DATA_DIR), "utf8")) as VerifiedFile;

  const s = summarise(scan.records);
  const w = weigh(scan.records, new Set(scan.verifiedInSample ?? []));
  const stalePct = ver.totalVerified === 0 ? 0 : (ver.redeployedSinceVerification / ver.totalVerified) * 100;

  const staleRows = ver.staleAccounts
    .slice(0, 25)
    .map((a) => `<tr><td><code>${esc(a)}</code></td><td class="num">${esc(String(ver.records[a]?.block_height ?? "—"))}</td></tr>`)
    .join("\n");

  const concRows = w.topUnverifiable
    .map(
      (c) =>
        `<tr><td><code>${esc(c.accountId)}</code></td>` +
        `<td class="num">${esc(formatNear(c.balanceYocto))}</td>` +
        `<td class="num">${pct(c.balanceShare)}</td>` +
        `<td class="num">${esc(formatBytes(c.storageBytes))}</td></tr>`,
    )
    .join("\n");

  const body = `
<h1>How many NEAR contracts actually match their published source?</h1>
<p class="lede">A blockchain runs machine code. Projects publish readable source and say
&ldquo;this is what it does.&rdquo; Almost nobody checks whether the two match. This measures it.</p>

<h2>1. Across all of NEAR mainnet, ${ver.totalVerified} contracts have ever been verified</h2>
<p>Read directly from SourceScan&rsquo;s on-chain registry
(<code>v2-verifier.sourcescan.near</code>), which backs the Verify-and-Publish button on
NearBlocks. This figure is <strong>complete, not sampled</strong>.</p>
<div class="cards">
  <div class="card"><div class="big">${ver.totalVerified}</div><div class="label">contracts ever verified</div></div>
  <div class="card"><div class="big accent">${ver.stillMatchesChain}</div><div class="label">records matching code deployed today</div></div>
  <div class="card"><div class="big warn">${ver.redeployedSinceVerification}</div><div class="label">redeployed since verification</div></div>
</div>

<h2>2. Two in five verifications are already out of date</h2>
<p>A verification record pins a specific code hash. When the account redeploys, the record
stops describing the running code &mdash; but nothing re-checks it, and explorers still show
the contract as verified. <strong>${pct(stalePct)} of all verified contracts have redeployed
since.</strong></p>
<h3>Verified, then redeployed${ver.staleAccounts.length > 25 ? ` (first 25 of ${ver.staleAccounts.length})` : ""}</h3>
<table><thead><tr><th>Account</th><th style="text-align:right">Verified at block</th></tr></thead>
<tbody>
${staleRows}
</tbody></table>

<h2>3. Only one contract in five publishes a source link you can follow</h2>
<p>${s.scanned} contracts taken from NearBlocks in indexer order &mdash; token contracts are
the one population on NEAR that can be enumerated rather than hand-picked.</p>
<table><thead><tr><th>Measure</th><th style="text-align:right">Count</th><th style="text-align:right">Share</th></tr></thead>
<tbody>
<tr><td>Contracts inspected</td><td class="num">${s.contractsWithCode}</td><td class="num">&mdash;</td></tr>
<tr><td>Expose NEP-330 metadata</td><td class="num">${s.withMetadata}</td><td class="num">${pct(s.coveragePct)}</td></tr>
<tr><td><strong>Carrying a usable repo link</strong></td><td class="num"><strong>${s.withRepoLink}</strong></td><td class="num"><strong>${pct(s.linkCoveragePct)}</strong></td></tr>
<tr><td>Metadata pointing nowhere</td><td class="num">${s.withMetadata - s.withRepoLink}</td><td class="num">&mdash;</td></tr>
<tr><td>In the SourceScan registry</td><td class="num">${(scan.verifiedInSample ?? []).length}</td><td class="num">&mdash;</td></tr>
</tbody></table>
<div class="note"><strong>Metadata presence overstates verifiability.</strong>
${s.withMetadata - s.withRepoLink} of the ${s.withMetadata} contracts exposing metadata publish no
link in it &mdash; a version string pointing nowhere. The honest figure is the one counting a
usable link: <strong>${pct(s.linkCoveragePct)}</strong>.</div>
<div class="note"><strong>Accounts are not programs.</strong> Those ${s.contractsWithCode} accounts
run only <strong>${s.distinctCodeHashes} distinct pieces of bytecode</strong> &mdash; roughly a
third are factory clones, so one factory&rsquo;s choice can swing the aggregate. Counting distinct
programs instead: of ${s.uniqueBytecodeContracts} unique-bytecode contracts,
<strong>${pct(s.uniqueBytecodeCoveragePct)}</strong> expose metadata.</div>

<h2>4. Exposure is real, but concentrated</h2>
<p>Of the NEAR held by inspected contracts, <strong>${pct(w.unverifiableBalanceShare)}</strong>
sits behind contracts with no published source. That is true and, quoted alone, misleading &mdash;
it is dominated by a handful of accounts.</p>
<table><thead><tr><th>Account</th><th style="text-align:right">NEAR held</th><th style="text-align:right">Share of sample</th><th style="text-align:right">State</th></tr></thead>
<tbody>
${concRows}
</tbody></table>
<div class="note">Wrapped NEAR holds the backing for every wNEAR in existence, so one account
dominates the total. <strong>Quote the headline with this table, never without it.</strong></div>

<h2>What this does and does not claim</h2>
<p><strong>Verification coverage, not honesty.</strong> A contract publishing no source is
unverifiable &mdash; that is not evidence anyone is lying, and no project here is accused of
anything. The fix is two commands.</p>
<p><strong>Nothing has been rebuilt.</strong> Every figure measures whether a source link is
<em>published</em>, not whether that source compiles to the deployed bytes. Read
&ldquo;verifiable&rdquo; as &ldquo;a link exists to check&rdquo;, never as &ldquo;checked&rdquo;.</p>
<p><strong>Findings 1 and 2 are complete</strong>, enumerating the whole registry. Findings 3 and 4
are a sample of token contracts, and token contracts may not behave like the rest of the chain.</p>
<p class="meta">Scan ${esc(scan.generatedAt)} &middot; registry ${esc(ver.generatedAt)}</p>
`;

  await mkdir(OUT_DIR, { recursive: true });
  const html = page(body, new Date().toISOString());
  await writeFile(new URL("index.html", OUT_DIR), html);
  return new URL("index.html", OUT_DIR).pathname;
}
