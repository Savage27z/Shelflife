import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, type VerdictInput } from "../src/verdict.js";
import { parseSourceLink } from "../src/links.js";
import type { RegistryState } from "../src/verified.js";

const SHA = "6ac0e219e2a560522a5f1b3c9d4e8f7a6b5c4d3e";
const pinned = parseSourceLink(`https://github.com/a/b/tree/${SHA}`);
const unpinned = parseSourceLink("https://github.com/a/b");
const placeholder = parseSourceLink("https://github.com/<xxx>/<xxx>");

const absent: RegistryState = { kind: "absent" };
const current: RegistryState = { kind: "current" };
const stale: RegistryState = { kind: "stale", verifiedHash: "OLD" };

function v(input: Partial<VerdictInput> & { registry: RegistryState }) {
  return judge(input as VerdictInput);
}

test("REGRESSION: a stale registry record with nothing else published exits 1", () => {
  // The bug: `link || inRegistry` returned "published" for any registry record at all,
  // so a contract with no readable source exited 0 and a CI gate waved it through.
  // Real case: e85f23b8...
  const verdict = v({ registry: stale });
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.level, "bad");
  assert.match(verdict.headline, /redeployed/i);
  assert.equal(verdict.offerFix, true);
});

test("a stale record does not matter when the contract publishes a live link of its own", () => {
  // 37 of the 42 'stale' records in the real data look like this.
  const verdict = v({ link: pinned, repoStatus: "resolves", registry: stale });
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.level, "ok");
  assert.ok(verdict.notes.some((n) => /earlier code/i.test(n)), "the stale record is still mentioned");
});

test("nothing published and not in any registry exits 1", () => {
  const verdict = v({ registry: absent });
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.headline, /No source you can read/);
});

test("a current registry record is readable source on its own", () => {
  const verdict = v({ registry: current });
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.offerFix, false);
});

test("a dead link exits 1, and is not rescued by being merely present", () => {
  const verdict = v({ link: pinned, repoStatus: "not_found", registry: absent });
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.headline, /dead/i);
});

test("a dead link is rescued by a current registry record", () => {
  // SourceScan stores the source itself, so a 404 on GitHub does not make it unreadable.
  const verdict = v({ link: pinned, repoStatus: "not_found", registry: current });
  assert.equal(verdict.exitCode, 0);
});

test("a template placeholder exits 1 and is never checked as a repository", () => {
  const verdict = v({ link: placeholder, registry: absent });
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.headline, /placeholder/i);
});

test("a live pinned link is ok; a live unpinned link is a warning but still exit 0", () => {
  const ok = v({ link: pinned, repoStatus: "resolves", registry: absent });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.level, "ok");

  const warn = v({ link: unpinned, repoStatus: "resolves", registry: absent });
  assert.equal(warn.exitCode, 0);
  assert.equal(warn.level, "warn");
  assert.match(warn.headline, /not pinned/i);
});

test("a link we could not check gets the benefit of the doubt, and says so", () => {
  // An unreadable answer must not fail someone's build.
  const verdict = v({ link: pinned, repoStatus: "unknown", registry: absent });
  assert.equal(verdict.exitCode, 0);
  assert.ok(verdict.notes.some((n) => /could not confirm/i.test(n)));
});

test("a failed registry lookup is reported as unknown and never as absent", () => {
  const verdict = v({ link: pinned, repoStatus: "resolves", registry: { kind: "lookup_failed" } });
  assert.ok(verdict.notes.some((n) => /unknown, not absent/i.test(n)));
  assert.equal(verdict.exitCode, 0, "the link alone is enough");
});

test("the older registry records no hash, so on its own it is not readable source", () => {
  const verdict = v({ registry: { kind: "legacy" } });
  assert.equal(verdict.exitCode, 1);
  assert.ok(verdict.notes.some((n) => /older registry/i.test(n)));
});

test("metadata without a link is called out", () => {
  const verdict = v({ metadataWithoutLink: true, registry: absent });
  assert.equal(verdict.exitCode, 1);
  assert.ok(verdict.notes.some((n) => /no source link/i.test(n)));
});

test("the fix is offered only when nothing is readable", () => {
  assert.equal(v({ registry: absent }).offerFix, true);
  assert.equal(v({ link: pinned, repoStatus: "resolves", registry: absent }).offerFix, false);
  assert.equal(v({ registry: current }).offerFix, false);
});
