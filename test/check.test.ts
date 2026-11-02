import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContract, exitCodeFor, renderCheck, type Deps } from "../src/check.js";
import type { ScanRecord, Status } from "../src/scan.js";
import type { RegistryState } from "../src/verified.js";
import type { RepoStatus } from "../src/links.js";

const SHA = "6ac0e219e2a560522a5f1b3c9d4e8f7a6b5c4d3e";

function deps(opts: {
  status: Status;
  link?: string;
  codeHash?: string;
  error?: string;
  registry?: RegistryState;
  repo?: RepoStatus;
}): Deps & { calls: { registry: string[]; repo: string[] } } {
  const calls = { registry: [] as string[], repo: [] as string[] };
  const record: ScanRecord = {
    accountId: "x.near",
    status: opts.status,
    codeHash: opts.codeHash ?? "HASH",
    checkedAt: "2026-11-01T00:00:00.000Z",
    ...(opts.link ? { metadata: { link: opts.link } } : opts.status === "metadata" ? { metadata: {} } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  };
  return {
    scan: async () => record,
    registry: async (_id, hash) => {
      calls.registry.push(hash);
      return opts.registry ?? { kind: "absent" };
    },
    repo: async (repo) => {
      calls.repo.push(repo);
      return opts.repo ?? "resolves";
    },
    calls,
  };
}

test("exit codes: readable 0, unreadable 1, not a contract 2, failed 3", async () => {
  const live = await checkContract("x.near", deps({ status: "metadata", link: `https://github.com/a/b/tree/${SHA}` }));
  assert.equal(exitCodeFor(live), 0);

  const dark = await checkContract("x.near", deps({ status: "no_metadata" }));
  assert.equal(exitCodeFor(dark), 1);

  assert.equal(exitCodeFor(await checkContract("x.near", deps({ status: "no_account" }))), 2);
  assert.equal(exitCodeFor(await checkContract("x.near", deps({ status: "no_contract" }))), 2);
  assert.equal(exitCodeFor(await checkContract("x.near", deps({ status: "error", error: "down" }))), 3);
});

test("REGRESSION: stale record and nothing else exits 1 through the whole flow", async () => {
  const d = deps({ status: "no_metadata", registry: { kind: "stale", verifiedHash: "OLD" } });
  const result = await checkContract("x.near", d);
  assert.equal(exitCodeFor(result), 1);
});

test("the deployed code hash is what the registry lookup is given", async () => {
  const d = deps({ status: "no_metadata", codeHash: "DEPLOYED" });
  await checkContract("x.near", d);
  assert.deepEqual(d.calls.registry, ["DEPLOYED"]);
});

test("only GitHub links are looked up, and placeholders never are", async () => {
  const gh = deps({ status: "metadata", link: "https://github.com/a/b" });
  await checkContract("x.near", gh);
  assert.deepEqual(gh.calls.repo, ["a/b"]);

  const placeholder = deps({ status: "metadata", link: "https://github.com/<xxx>/<xxx>" });
  await checkContract("x.near", placeholder);
  assert.deepEqual(placeholder.calls.repo, [], "a placeholder must not be sent to GitHub as a repo");

  const gitlab = deps({ status: "metadata", link: "https://gitlab.com/a/b" });
  await checkContract("x.near", gitlab);
  assert.deepEqual(gitlab.calls.repo, []);

  const none = deps({ status: "no_metadata" });
  await checkContract("x.near", none);
  assert.deepEqual(none.calls.repo, []);
});

test("a dead repository reads as dead, and exits 1", async () => {
  const result = await checkContract("x.near", deps({ status: "metadata", link: "https://github.com/a/b", repo: "not_found" }));
  assert.equal(exitCodeFor(result), 1);
  assert.match(renderCheck(result).join("\n"), /NOT FOUND/);
});

test("the report never contains undefined or NaN, in any outcome", async () => {
  const scenarios: Parameters<typeof deps>[0][] = [
    { status: "metadata", link: `https://github.com/a/b/tree/${SHA}` },
    { status: "metadata", link: "https://github.com/a/b" },
    { status: "metadata" },
    { status: "no_metadata" },
    { status: "no_metadata", registry: { kind: "stale", verifiedHash: "OLD" } },
    { status: "no_metadata", registry: { kind: "current" } },
    { status: "no_metadata", registry: { kind: "legacy" } },
    { status: "no_metadata", registry: { kind: "lookup_failed" } },
    { status: "metadata", link: "https://github.com/<xxx>/<xxx>" },
    { status: "no_account" },
    { status: "no_contract" },
    { status: "error", error: "down" },
  ];
  for (const s of scenarios) {
    const text = renderCheck(await checkContract("x.near", deps(s))).join("\n");
    assert.ok(!/undefined|NaN|\[object/.test(text), JSON.stringify(s) + "\n" + text);
  }
});

test("devhub-style: unpinned live link plus a stale record is a warning, not an alarm", async () => {
  const result = await checkContract(
    "devhub.near",
    deps({
      status: "metadata",
      link: "https://github.com/NEAR-DevHub/neardevhub-contract",
      registry: { kind: "stale", verifiedHash: "OLD" },
    }),
  );
  assert.equal(exitCodeFor(result), 0);
  if (result.kind !== "contract") throw new Error("expected a contract result");
  assert.equal(result.verdict.level, "warn");
  const text = renderCheck(result).join("\n");
  assert.ok(!/describes code that is no longer running/i.test(text), "the old misleading line must not return");
});
