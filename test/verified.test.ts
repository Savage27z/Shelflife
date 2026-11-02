import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, isCurrent, looksLikeTestAccount, parsePage, type VerifiedRecord } from "../src/verified.js";
import { dedupe, type TokenContract } from "../src/enumerate.js";
import type { ScanRecord, Status } from "../src/scan.js";

// ---- parsePage: the trap that nearly published "53 verified contracts" -----------------

test("parsePage reads the real [entries, pageCount] shape", () => {
  const raw = JSON.stringify([[["a.near", { cid: "Qm", lang: "rust", code_hash: "H", block_height: 1 }]], 105]);
  const page = parsePage<VerifiedRecord>(raw);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]?.[0], "a.near");
});

test("the second element is a PAGE COUNT, so the record count comes from the entries", () => {
  // Real behaviour on the 105-record registry: the same 105 records come back as 105
  // pages at limit 1, 53 at limit 2, 5 at limit 25, and 1 at limit 500. Reading the
  // second element as a total yields 53 for a registry of 105.
  const entry = ["a.near", { cid: "Qm", lang: "rust", code_hash: "H", block_height: 1 }];
  const atLimit2 = parsePage(JSON.stringify([[entry, entry], 53]));
  assert.equal(atLimit2.pages, 53);
  assert.equal(atLimit2.entries.length, 2, "entries received, not the figure beside them");
  assert.notEqual(atLimit2.entries.length, atLimit2.pages);
});

test("parsePage fails loudly on a shape it does not recognise", () => {
  // Better a crash than a plausible-looking wrong number.
  assert.throws(() => parsePage("not json"), /not JSON/);
  assert.throws(() => parsePage("{}"), /unexpected get_contracts shape/);
  assert.throws(() => parsePage("[[],1,2]"), /unexpected get_contracts shape/);
  assert.throws(() => parsePage('[[], "5"]'), /unexpected get_contracts shape/);
  assert.throws(() => parsePage("[[[1,2]], 1]"), /unexpected get_contracts entry/);
  assert.throws(() => parsePage('[[["a.near"]], 1]'), /unexpected get_contracts entry/);
});

test("an empty page is valid", () => {
  assert.deepEqual(parsePage("[[], 0]").entries, []);
});

// ---- classifyRecord -------------------------------------------------------------------

const REC: VerifiedRecord = { cid: "Qm", lang: "rust", code_hash: "VERIFIED", block_height: 1 };

function scan(status: Status, extra: Partial<ScanRecord> = {}): ScanRecord {
  return { accountId: "x.near", status, checkedAt: "2026-11-01T00:00:00.000Z", ...extra };
}

test("a matching hash is current", () => {
  assert.deepEqual(classifyRecord(REC, scan("no_metadata", { codeHash: "VERIFIED" })), { kind: "current" });
});

test("a deleted account is 'deleted', which is not the same as 'could not tell'", () => {
  // An earlier version labelled every error "unreachable". Nine of those were deletions.
  assert.deepEqual(classifyRecord(REC, scan("no_account")), { kind: "deleted" });
  assert.deepEqual(classifyRecord(REC, scan("error", { error: "timeout" })), { kind: "unresolved" });
});

test("an account whose code was removed is its own outcome", () => {
  assert.deepEqual(classifyRecord(REC, scan("no_contract")), { kind: "code_removed" });
});

test("a different hash is stale, and records what the contract publishes today", () => {
  const withLink = scan("metadata", { codeHash: "NEW", metadata: { link: "https://github.com/a/b" } });
  const noLink = scan("metadata", { codeHash: "NEW", metadata: {} });
  const nothing = scan("no_metadata", { codeHash: "NEW" });

  assert.deepEqual(classifyRecord(REC, withLink), { kind: "stale", today: "link" });
  assert.deepEqual(classifyRecord(REC, noLink), { kind: "stale", today: "nolink" });
  assert.deepEqual(classifyRecord(REC, nothing), { kind: "stale", today: "none" });
});

test("a contract that no longer compiles is 'broken', not 'unresolved'", () => {
  const broken = scan("error", {
    codeHash: "NEW",
    error: "RpcError: wasm execution failed with error: CompilationError(PrepareError(Deserialization))",
  });
  assert.deepEqual(classifyRecord(REC, broken), { kind: "stale", today: "broken" });

  const flaky = scan("error", { codeHash: "NEW", error: "transport failure" });
  assert.deepEqual(classifyRecord(REC, flaky), { kind: "stale", today: "unresolved" });
});

test("no code hash and no verdict is unresolved", () => {
  assert.deepEqual(classifyRecord(REC, scan("metadata")), { kind: "unresolved" });
});

test("isCurrent compares hashes exactly", () => {
  assert.equal(isCurrent(REC, "VERIFIED"), true);
  assert.equal(isCurrent(REC, "verified"), false);
});

// ---- looksLikeTestAccount -------------------------------------------------------------

test("test and staging names are recognised", () => {
  for (const id of [
    "buidtest.agruzdev.near",
    "buildtest-2.agruzdev.near",
    "rug-testing.near",
    "rewards-claims-staging.near",
    "dev-unaudited-v0.oracle.intear.near",
    "multi-feed-qa-1.atlas-oracle.near",
    "demo.near",
  ]) {
    assert.equal(looksLikeTestAccount(id), true, id);
  }
});

test("ordinary names are not swept up", () => {
  for (const id of ["wrap.near", "token.sweat", "intents.near", "v1.signer", "devhub.near", "pyth-oracle.near", "advance.near"]) {
    assert.equal(looksLikeTestAccount(id), false, id);
  }
});

// ---- enumerate.dedupe -----------------------------------------------------------------

test("dedupe keeps the first occurrence and the indexer order", () => {
  const t = (contract: string, kind: "ft" | "nft"): TokenContract => ({ contract, kind });
  const out = dedupe([
    [t("a.near", "ft"), t("b.near", "ft")],
    [t("b.near", "nft"), t("c.near", "nft")],
  ]);
  assert.deepEqual(out.map((x) => x.contract), ["a.near", "b.near", "c.near"]);
  assert.equal(out[1]?.kind, "ft", "b.near keeps the kind it was first seen with");
});
