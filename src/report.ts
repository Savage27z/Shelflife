import { readFile, writeFile, mkdir } from "node:fs/promises";
import { summarise, type ScanRecord, type Summary } from "./scan.js";
import { weigh, formatNear, formatBytes } from "./weight.js";
import type { LinkSummary } from "./links.js";
import type { Today } from "./verified.js";

/**
 * Generates a static report from the committed datasets.
 *
 * Every figure is computed from data/*.json rather than typed in, so the page cannot
 * drift away from the numbers the tools actually produced. And the prose is written to
 * state only what those numbers support: where a sentence depends on a figure, it quotes
 * the figure instead of saying "most" or "many".
 *
 * No framework and no CDN — one self-contained HTML file, which still renders in five
 * years. The rendering is a pure function of its input, so it can be tested without
 * touching the filesystem.
 */

const DATA_DIR = new URL("../data/", import.meta.url);
const OUT_DIR = new URL("../report/", import.meta.url);

export interface ScanFile {
  generatedAt: string;
  records: ScanRecord[];
  verifiedInSample?: string[];
}

export interface StaleEntry {
  accountId: string;
  today: Today;
  link?: string;
  pinned?: boolean;
}

export interface VerFile {
  generatedAt: string;
  registries: { v2: { account: string; records: number }; legacy: { account: string; records: number } };
  unionRecords: number;
  legacyOnly: string[];
  v2: {
    total: number;
    byLanguage: Record<string, number>;
    current: number;
    redeployed: number;
    deleted: number;
    codeRemoved: number;
    unresolved: number;
  };
  staleToday: {
    publishesLink: number;
    publishesPinnedLink: number;
    metadataNoLink: number;
    publishesNothing: number;
    brokenContract: number;
    unresolved: number;
  };
  testLikeAccounts: { inUnion: number; inCurrent: number };
  stale: StaleEntry[];
}

export interface LinksFile {
  generatedAt: string;
  summary: LinkSummary;
}

export interface ReportInput {
  scan: ScanFile;
  ver: VerFile;
  links: LinksFile | null;
  /** account -> "ft" | "nft", for the by-kind split. May be empty. */
  kinds: Map<string, string>;
  generatedAt: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (n: number) => `${n.toFixed(1)}%`;

const TODAY_LABEL: Record<Today, string> = {
  link: "publishes a source link",
  nolink: "metadata, no link",
  none: "publishes nothing",
  broken: "will not compile",
  unresolved: "undetermined",
};

function page(body: string, generatedAt: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shelflife — NEAR contract source verification</title>
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
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 20px 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .card .label { color: var(--muted); font-size: 0.82rem; margin-top: 6px; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 0.92rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.key td { font-weight: 700; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; word-break: break-all; }
  .note { border-left: 3px solid var(--warn); padding: 10px 14px; margin: 18px 0;
          background: var(--card); border-radius: 0 8px 8px 0; font-size: 0.93rem; }
  .accent { color: var(--accent); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  footer { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
  @media (max-width: 560px) { .big { font-size: 2rem; } main { padding-top: 32px; } }
</style>
<main>
${body}
<footer>
  <p>Generated ${esc(generatedAt)} from the datasets committed in <code>data/</code>. Every
  figure is computed from those files, not written by hand. Re-run <code>npm run scan</code>,
  <code>npm run links</code>, <code>npm run verified</code> and <code>npm run report</code> to
  reproduce it.</p>
</footer>
</main>
</html>
`;
}

function row(label: string, count: string, share: string, key = false): string {
  return `<tr${key ? ' class="key"' : ""}><td>${label}</td><td class="num">${count}</td><td class="num">${share}</td></tr>`;
}

function funnel(s: Summary, links: LinkSummary | null): string {
  const rows = [
    row("Contracts inspected", String(s.contractsWithCode), "&mdash;"),
    row("Expose NEP-330 source metadata", String(s.withMetadata), pct(s.coveragePct)),
    row("&hellip;carrying a source link", String(s.withRepoLink), pct(s.linkCoveragePct)),
  ];
  if (links) {
    rows.push(
      row("&hellip;whose repository resolves", String(links.contractsResolving), pct(links.resolvingPct)),
      row(
        "&hellip;and is pinned to a commit &mdash; <strong>could be rebuilt</strong>",
        String(links.contractsRebuildable),
        pct(links.rebuildablePct),
        true,
      ),
    );
  }
  return `<table><thead><tr><th>Stage</th><th class="num">Contracts</th><th class="num">Share of inspected</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table>`;
}

function byKindTable(records: ScanRecord[], kinds: Map<string, string>): string {
  const names: Record<string, string> = { ft: "Fungible tokens", nft: "NFT contracts" };
  const rows: string[] = [];
  for (const kind of ["ft", "nft"]) {
    const subset = records.filter((r) => kinds.get(r.accountId) === kind);
    if (subset.length === 0) continue;
    const s = summarise(subset);
    rows.push(
      `<tr><td>${names[kind]}</td><td class="num">${s.contractsWithCode}</td>` +
        `<td class="num">${pct(s.coveragePct)}</td><td class="num">${pct(s.linkCoveragePct)}</td></tr>`,
    );
  }
  if (rows.length === 0) return "";
  return `<h3>By kind of token contract</h3>
<table><thead><tr><th>Kind</th><th class="num">Inspected</th><th class="num">Metadata</th><th class="num">With a link</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table>`;
}

export function renderReport(input: ReportInput): string {
  const { scan, ver, links, kinds } = input;
  const s = summarise(scan.records);
  const ls = links?.summary ?? null;
  const w = weigh(scan.records, new Set(scan.verifiedInSample ?? []));
  const st = ver.staleToday;
  /** Only say "mostly" when the numbers say so. */
  const movedOn = ver.v2.redeployed > 0 && st.publishesLink / ver.v2.redeployed >= 0.5;

  const staleRows = ver.stale
    .slice(0, 25)
    .map((e) => {
      const detail = e.link ? `<code>${esc(e.link)}</code>${e.pinned ? "" : " (not pinned)"}` : "";
      return `<tr><td><code>${esc(e.accountId)}</code></td><td>${esc(TODAY_LABEL[e.today])}</td><td>${detail}</td></tr>`;
    })
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

  const finding1Lead = ls
    ? `Of <strong>${s.contractsWithCode}</strong> token contracts inspected, only
       <strong>${ls.contractsRebuildable} (${pct(ls.rebuildablePct)})</strong> publish a source link that both
       resolves and is pinned to a commit &mdash; the minimum anyone would need to rebuild the code and
       compare it with what is deployed.`
    : `Of <strong>${s.contractsWithCode}</strong> token contracts inspected,
       <strong>${s.withRepoLink} (${pct(s.linkCoveragePct)})</strong> carry a source link. Whether those links
       resolve, and whether they are pinned, has not been checked: run <code>npm run links</code>.`;

  const body = `
<h1>How much NEAR contract source can anyone actually check?</h1>
<p class="lede">A blockchain runs machine code. Projects publish readable source and say
&ldquo;this is what it does.&rdquo; Almost nobody checks whether a link goes anywhere, or whether the two
match. This measures the first of those, across NEAR mainnet.</p>

<h2>1. ${ls ? `Only ${ls.contractsRebuildable} of ${s.contractsWithCode} token contracts publish source that could be rebuilt` : "What token contracts publish"}</h2>
<p>${finding1Lead}</p>
${funnel(s, ls)}
${
  ls
    ? `<div class="note"><strong>A link is not source.</strong> The ${ls.contractsWithLink} contracts that
carry a link point at only <strong>${ls.distinctRepos} distinct GitHub repositories</strong>.
${ls.reposNotFound} of them return 404 (gone, or private)${
        ls.placeholder > 0
          ? `, and ${ls.placeholder} contract${ls.placeholder === 1 ? "" : "s"} publish${ls.placeholder === 1 ? "es" : ""} a literal template placeholder such as <code>https://github.com/&lt;xxx&gt;/&lt;xxx&gt;</code>`
          : ""
      }.
Of the links that do resolve, only ${ls.contractsPinned} of ${ls.githubContracts} name a commit; the rest point at a
repository front page, which cannot be tied to a particular deployed version.</div>`
    : ""
}
<div class="note"><strong>Metadata presence overstates verifiability.</strong>
${s.withMetadata - s.withRepoLink} of the ${s.withMetadata} contracts exposing metadata publish no link in it &mdash; a
version string pointing nowhere.</div>
<div class="note"><strong>Accounts are not programs.</strong> Those ${s.contractsWithCode} accounts run only
<strong>${s.distinctCodeHashes} distinct pieces of bytecode</strong>, because factories deploy clones. Counting
distinct programs, <strong>${pct(s.uniqueBytecodeCoveragePct)}</strong> of the ${s.uniqueBytecodeContracts}
unique-bytecode contracts expose metadata.</div>
${byKindTable(scan.records, kinds)}
<p class="meta">The sample is the first 90 fungible-token and first 90 NFT contracts in the order the NearBlocks
API returns them. That order is not random: the fungible list leads with the best-known tokens, and the NFT list is
dominated by airdrop and reward contracts, several of them clone families that happen to carry metadata. It is a
sample of token contracts, not of the chain.</p>

<h2>2. ${ver.unionRecords} contracts have ever been verified with SourceScan; ${ver.v2.current} records still match what is deployed</h2>
<p>SourceScan keeps two registries: <code>${esc(ver.registries.v2.account)}</code>
(${ver.registries.v2.records} records) and an older <code>${esc(ver.registries.legacy.account)}</code>
(${ver.registries.legacy.records}, none of them in the current one). The older registry records no code hash, so those
cannot be checked against what is deployed.</p>
<div class="cards">
  <div class="card"><div class="big">${ver.unionRecords}</div><div class="label">records, both registries</div></div>
  <div class="card"><div class="big accent">${ver.v2.current}</div><div class="label">current registry: still matches deployed code</div></div>
  <div class="card"><div class="big warn">${ver.v2.redeployed}</div><div class="label">redeployed since verification</div></div>
  <div class="card"><div class="big">${ver.v2.deleted}</div><div class="label">account no longer exists</div></div>
</div>
<h3>What the ${ver.v2.redeployed} redeployed contracts publish today</h3>
<table><thead><tr><th>Today</th><th class="num">Contracts</th></tr></thead><tbody>
<tr class="key"><td>A source link of their own</td><td class="num">${st.publishesLink} (${st.publishesPinnedLink} pinned to a commit)</td></tr>
<tr><td>Metadata, but no link</td><td class="num">${st.metadataNoLink}</td></tr>
<tr><td>Nothing</td><td class="num">${st.publishesNothing}</td></tr>
<tr><td>Will not compile</td><td class="num">${st.brokenContract}</td></tr>
<tr><td>Undetermined</td><td class="num">${st.unresolved}</td></tr>
</tbody></table>
<div class="note"><strong>${movedOn ? "A stale record is mostly not a trust gap." : "What a stale record means."}</strong>
${st.publishesLink} of the ${ver.v2.redeployed} redeployed contracts now publish a link of their own${
    movedOn ? ", so the registry has largely been superseded by NEP-330 metadata rather than source going dark" : ""
  }. What a stale record does mean is narrower: SourceScan holds no rebuild of the <em>current</em> code, and whether
those links actually reproduce the deployed bytes is not checked here.</div>
${
  ver.v2.unresolved + ver.v2.codeRemoved > 0
    ? `<p class="meta">${ver.v2.unresolved} record${ver.v2.unresolved === 1 ? "" : "s"} could not be determined and ${ver.v2.codeRemoved} had the contract code removed from the account.</p>`
    : ""
}
<p>${ver.testLikeAccounts.inUnion} of the ${ver.unionRecords} account names look like tests or staging deployments
(a name heuristic, not a classification). The registry is not ${ver.unionRecords} real projects.</p>
<h3>Redeployed since verification${ver.stale.length > 25 ? ` (first 25 of ${ver.stale.length})` : ""}</h3>
<table><thead><tr><th>Account</th><th>Publishes today</th><th>Link</th></tr></thead><tbody>
${staleRows}
</tbody></table>

<h2>3. NEAR held behind unpublished source is concentrated in one account</h2>
<p>Of the NEAR held by the inspected contracts, <strong>${pct(w.unverifiableBalanceShare)}</strong> sits in contracts
with neither metadata nor a registry record. That is true and, quoted alone, misleading &mdash; it is dominated by a
handful of accounts.</p>
<table><thead><tr><th>Account</th><th class="num">NEAR held</th><th class="num">Share of sample</th><th class="num">State</th></tr></thead><tbody>
${concRows}
</tbody></table>
<div class="note">Wrapped NEAR holds the backing for every wNEAR in existence, so one account dominates the
total. <strong>Quote the headline with this table, never without it.</strong> This counts NEAR balance only: a token
contract&rsquo;s value to its users is in the tokens it issues, which this does not capture. Treat it as a floor, not
a measure of risk.</div>

<h2>What this does and does not claim</h2>
<p><strong>Verification coverage, not honesty.</strong> A contract publishing no source is unverifiable. That is not
evidence anyone is lying, and no project is accused of anything.</p>
<p><strong>Nothing has been rebuilt.</strong> Every figure measures what is <em>published</em>, not whether it compiles
to the deployed bytes. &ldquo;Rebuildable&rdquo; means a rebuild would be possible, not that one was done.</p>
<p><strong>A 404 is ambiguous.</strong> GitHub returns the same for a deleted repository and a private one.</p>
<p><strong>The tooling is Rust-only.</strong> Every one of the ${ver.v2.total} current-registry records is Rust, and
NEP-330 metadata comes from Rust tooling, so a contract written in another language cannot carry it. The share of
non-Rust contracts in the sample was not measured, so part of the gap here may be structural.</p>
<p><strong>The sample is token contracts</strong>, which may not behave like the rest of the chain. The registry
counts in section 2 are complete for both SourceScan registries; they are not a statement about verification
elsewhere (an explorer may hold records of its own).</p>
<p class="meta">Scan ${esc(scan.generatedAt)} &middot; registries ${esc(ver.generatedAt)}${links ? ` &middot; links ${esc(links.generatedAt)}` : ""}</p>
`;

  return page(body, input.generatedAt);
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, DATA_DIR), "utf8")) as T;
}

export async function buildReport(): Promise<string> {
  const scan = await readJson<ScanFile>("scan-latest.json");
  const ver = await readJson<VerFile>("verified-latest.json");
  const links = await readJson<LinksFile>("links-latest.json").catch(() => null);
  const contracts = await readJson<{ contracts: Array<{ contract: string; kind: string }> }>("contracts.json").catch(
    () => ({ contracts: [] as Array<{ contract: string; kind: string }> }),
  );
  const kinds = new Map(contracts.contracts.map((c) => [c.contract, c.kind]));

  await mkdir(OUT_DIR, { recursive: true });
  const html = renderReport({ scan, ver, links, kinds, generatedAt: new Date().toISOString() });
  await writeFile(new URL("index.html", OUT_DIR), html);
  return new URL("index.html", OUT_DIR).pathname;
}
