import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, renderReport, type ReportInput, type VerFile } from "../src/report.js";
import type { ScanRecord, Status } from "../src/scan.js";
import type { LinkSummary } from "../src/links.js";

const at = "2026-11-01T00:00:00.000Z";

function rec(accountId: string, status: Status, opts: { link?: string; hash?: string; near?: number } = {}): ScanRecord {
  return {
    accountId,
    status,
    checkedAt: at,
    codeHash: opts.hash ?? `h-${accountId}`,
    balanceYocto: (BigInt(opts.near ?? 1) * 10n ** 24n).toString(),
    storageBytes: 1000,
    ...(status === "metadata" ? { metadata: opts.link ? { link: opts.link } : {} } : {}),
  };
}

const links: LinkSummary = {
  inspected: 4,
  contractsWithLink: 2,
  placeholder: 1,
  otherHost: 0,
  githubContracts: 1,
  distinctRepos: 1,
  reposResolving: 1,
  reposNotFound: 0,
  reposUnknown: 0,
  contractsResolving: 1,
  contractsNotFound: 0,
  contractsPinned: 1,
  contractsRebuildable: 1,
  withLinkPct: 50,
  resolvingPct: 25,
  rebuildablePct: 25,
};

function ver(over: Partial<VerFile> = {}): VerFile {
  return {
    generatedAt: at,
    registries: {
      v2: { account: "v2-verifier.sourcescan.near", records: 10 },
      legacy: { account: "sourcescan.near", records: 2 },
    },
    unionRecords: 12,
    legacyOnly: ["a.near", "b.near"],
    v2: { total: 10, byLanguage: { rust: 10 }, current: 4, redeployed: 4, deleted: 1, codeRemoved: 0, unresolved: 1 },
    staleToday: { publishesLink: 3, publishesPinnedLink: 2, metadataNoLink: 0, publishesNothing: 1, brokenContract: 0, unresolved: 0 },
    testLikeAccounts: { inUnion: 2, inCurrent: 1 },
    stale: [
      { accountId: "s1.near", today: "link", link: "https://github.com/a/b/tree/abc1234", pinned: true },
      { accountId: "s2.near", today: "none" },
    ],
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    scan: {
      generatedAt: at,
      records: [
        rec("wrap.near", "no_metadata", { near: 900 }),
        rec("meta.near", "metadata", { link: "https://github.com/a/b/tree/abc1234" }),
        rec("nolink.near", "metadata"),
        rec("dark.near", "no_metadata"),
      ],
      verifiedInSample: [],
    },
    ver: ver(),
    links: { generatedAt: at, summary: links },
    kinds: new Map([
      ["wrap.near", "ft"],
      ["meta.near", "ft"],
      ["nolink.near", "nft"],
      ["dark.near", "nft"],
    ]),
    generatedAt: at,
    ...over,
  };
}

test("renders without undefined, NaN or object leaks", () => {
  const html = renderReport(input());
  assert.ok(!/undefined|NaN|\[object|Infinity/.test(html), html.match(/.{0,40}(undefined|NaN|\[object|Infinity).{0,40}/)?.[0]);
  assert.match(html, /^<!doctype html>/);
});

test("the headline figures come from the data, not from the template", () => {
  const html = renderReport(input());
  assert.match(html, /Only 1 of 4 token contracts publish source that could be rebuilt/);
  assert.match(html, />12</, "union of both registries");
  assert.match(html, />4</, "current records");
  assert.match(html, /3 \(2 pinned to a commit\)/);
});

test("the concentration disclosure always accompanies the headline", () => {
  const html = renderReport(input());
  assert.match(html, /Quote the headline with this table, never without it/);
  assert.match(html, /wrap\.near/);
});

test("it states the limits that would embarrass it if left out", () => {
  const html = renderReport(input());
  assert.match(html, /Nothing has been rebuilt/);
  assert.match(html, /404 is ambiguous/);
  assert.match(html, /Rust-only/);
  assert.match(html, /not random/i, "the sample is not described as unweighted");
});

test("without a links file it says so instead of inventing the figure", () => {
  const html = renderReport(input({ links: null }));
  assert.match(html, /npm run links/);
  assert.ok(!/could be rebuilt<\/strong>/.test(html), "no rebuildable row without data");
  assert.ok(!/undefined|NaN/.test(html));
});

test("it only says 'mostly' when most redeployed contracts really did move on", () => {
  const moved = renderReport(input());
  assert.match(moved, /mostly not a trust gap/);

  const notMoved = renderReport(
    input({
      ver: ver({
        staleToday: { publishesLink: 1, publishesPinnedLink: 0, metadataNoLink: 0, publishesNothing: 3, brokenContract: 0, unresolved: 0 },
      }),
    }),
  );
  assert.ok(!/mostly not a trust gap/.test(notMoved), "a claim the numbers do not support must not appear");
  assert.match(notMoved, /What a stale record means/);
});

test("account names and links are HTML-escaped", () => {
  const evil = input({
    ver: ver({ stale: [{ accountId: "<script>alert(1)</script>.near", today: "link", link: 'https://x/"><img src=x>', pinned: false }] }),
  });
  const html = renderReport(evil);
  assert.ok(!html.includes("<script>alert(1)"), "raw script tag leaked");
  assert.ok(!html.includes('"><img src=x>'), "attribute breakout leaked");
  assert.match(html, /&lt;script&gt;/);
});

test("it copes with an empty sample", () => {
  const html = renderReport(input({ scan: { generatedAt: at, records: [], verifiedInSample: [] }, kinds: new Map() }));
  assert.ok(!/undefined|NaN|Infinity/.test(html));
});

test("esc escapes the characters that matter", () => {
  assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});
