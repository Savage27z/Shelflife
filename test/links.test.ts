import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, checkRepo, parseSourceLink, summariseLinks, type RepoStatus } from "../src/links.js";
import type { ScanRecord } from "../src/scan.js";

const SHA = "6ac0e219e2a560522a5f1b3c9d4e8f7a6b5c4d3e";

test("a link naming a full commit SHA is pinned", () => {
  const p = parseSourceLink(`https://github.com/Near-One/btc-light-client-contract/tree/${SHA}`);
  assert.equal(p.kind, "github");
  assert.equal(p.repo, "Near-One/btc-light-client-contract");
  assert.equal(p.ref, SHA);
  assert.equal(p.pinned, true);
});

test("a short SHA still counts as pinned", () => {
  assert.equal(parseSourceLink("https://github.com/a/b/tree/6ac0e21").pinned, true);
});

test("a commit URL is pinned", () => {
  assert.equal(parseSourceLink(`https://github.com/a/b/commit/${SHA}`).pinned, true);
});

test("a branch or tag is NOT pinned, because it can move", () => {
  // The distinction that matters: naming `main` or `v1.2.0` does not identify a version.
  assert.equal(parseSourceLink("https://github.com/a/b/tree/main").pinned, false);
  assert.equal(parseSourceLink("https://github.com/a/b/tree/v1.2.0").pinned, false);
  assert.equal(parseSourceLink("https://github.com/a/b/tree/main").ref, "main");
});

test("a bare repository link is not pinned", () => {
  // devhub.near publishes exactly this, so it cannot be tied to what is deployed.
  const p = parseSourceLink("https://github.com/NEAR-DevHub/neardevhub-contract");
  assert.equal(p.kind, "github");
  assert.equal(p.repo, "NEAR-DevHub/neardevhub-contract");
  assert.equal(p.pinned, false);
  assert.equal(p.ref, undefined);
});

test("a .git suffix is stripped from the repo name", () => {
  assert.equal(parseSourceLink("https://github.com/a/b.git").repo, "a/b");
});

test("a hex-looking branch name of the wrong length is not mistaken for a SHA", () => {
  assert.equal(parseSourceLink("https://github.com/a/b/tree/abc").pinned, false); // 3 chars
  assert.equal(parseSourceLink("https://github.com/a/b/tree/deadbeefg").pinned, false); // not hex
});

test("template placeholders are recognised, not treated as repositories", () => {
  // Real: initiate.nearlegion.near publishes this as its source link.
  for (const link of [
    "https://github.com/<xxx>/<xxx>",
    "https://github.com/%3Cowner%3E/%3Crepo%3E",
    "https://github.com/your-org/your-repo",
    "https://github.com/owner/repo",
  ]) {
    const p = parseSourceLink(link);
    assert.equal(p.kind, "placeholder", link);
    assert.equal(p.pinned, false);
    assert.equal(p.repo, undefined, "a placeholder must never be looked up as a repo");
  }
});

test("a non-GitHub host or garbage is 'other', never an error", () => {
  assert.equal(parseSourceLink("https://gitlab.com/a/b").kind, "other");
  assert.equal(parseSourceLink("not a url at all").kind, "other");
  assert.equal(parseSourceLink("https://github.com/onlyowner").kind, "other");
});

// ---- checkRepo ---------------------------------------------------------------------

function fakeFetch(...responses: Array<number | "throw">): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next === "throw") throw new Error("network down");
    return { status: next } as Response;
  }) as typeof fetch;
}

const fast = { retries: 3, delayMs: 0 };

test("200 resolves and 404 does not", async () => {
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch(200) }), "resolves");
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch(404) }), "not_found");
});

test("rate limiting is retried rather than reported as a finding", async () => {
  // The rule that matters: a 429 is our problem, not evidence about the repository.
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch(429, 429, 200) }), "resolves");
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch(503, 404) }), "not_found");
});

test("a persistent failure is 'unknown', never 'not_found'", async () => {
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch(429) }), "unknown");
  assert.equal(await checkRepo("a/b", { ...fast, fetchImpl: fakeFetch("throw") }), "unknown");
});

// ---- summary -----------------------------------------------------------------------

function rec(accountId: string, link?: string): ScanRecord {
  return {
    accountId,
    status: link ? "metadata" : "no_metadata",
    checkedAt: "2026-11-01T00:00:00.000Z",
    codeHash: "h",
    ...(link ? { metadata: { link } } : {}),
  };
}

test("rebuildable means resolves AND pinned — either alone is not enough", () => {
  const records = [
    rec("pinned-alive.near", `https://github.com/a/alive/tree/${SHA}`),
    rec("unpinned-alive.near", "https://github.com/a/alive"),
    rec("pinned-dead.near", `https://github.com/a/dead/tree/${SHA}`),
    rec("placeholder.near", "https://github.com/<xxx>/<xxx>"),
    rec("nolink.near"),
  ];
  const statuses = new Map<string, RepoStatus>([
    ["a/alive", "resolves"],
    ["a/dead", "not_found"],
  ]);

  const s = summariseLinks(buildRows(records, statuses), 5);

  assert.equal(s.contractsWithLink, 4);
  assert.equal(s.placeholder, 1);
  assert.equal(s.githubContracts, 3);
  assert.equal(s.contractsResolving, 2);
  assert.equal(s.contractsNotFound, 1);
  assert.equal(s.contractsPinned, 2);
  assert.equal(s.contractsRebuildable, 1, "only pinned-alive.near can be rebuilt");
  assert.equal(s.rebuildablePct, 20);
});

test("clones sharing a repository count once as a repo and many times as contracts", () => {
  const link = `https://github.com/a/shared/tree/${SHA}`;
  const records = ["x.near", "y.near", "z.near"].map((id) => rec(id, link));
  const s = summariseLinks(buildRows(records, new Map([["a/shared", "resolves" as RepoStatus]])), 3);

  assert.equal(s.githubContracts, 3);
  assert.equal(s.distinctRepos, 1);
  assert.equal(s.reposResolving, 1);
  assert.equal(s.contractsRebuildable, 3);
});

test("repository names are matched case-insensitively", () => {
  const records = [rec("a.near", "https://github.com/Acme/Widget"), rec("b.near", "https://github.com/acme/widget")];
  const s = summariseLinks(buildRows(records, new Map([["acme/widget", "resolves" as RepoStatus]])), 2);
  assert.equal(s.distinctRepos, 1);
  assert.equal(s.contractsResolving, 2);
});

test("a repo we could not check is unknown, not dead", () => {
  const records = [rec("a.near", `https://github.com/a/b/tree/${SHA}`)];
  const s = summariseLinks(buildRows(records, new Map()), 1);
  assert.equal(s.reposUnknown, 1);
  assert.equal(s.contractsNotFound, 0);
  assert.equal(s.contractsRebuildable, 0, "unconfirmed is not rebuildable");
});

test("no inspected contracts gives zero percentages, never NaN", () => {
  const s = summariseLinks([], 0);
  assert.equal(s.rebuildablePct, 0);
  assert.equal(s.withLinkPct, 0);
  assert.ok(!Number.isNaN(s.resolvingPct));
});
