import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, type ScanRecord, type Status } from "../src/scan.js";

const at = "2026-11-01T00:00:00.000Z";

function rec(
  accountId: string,
  status: Status,
  opts: { codeHash?: string; link?: string; balance?: string; storage?: number } = {},
): ScanRecord {
  const r: ScanRecord = { accountId, status, checkedAt: at };
  if (opts.codeHash) r.codeHash = opts.codeHash;
  if (opts.balance) r.balanceYocto = opts.balance;
  if (opts.storage !== undefined) r.storageBytes = opts.storage;
  if (status === "metadata") r.metadata = opts.link ? { link: opts.link } : {};
  return r;
}

test("empty input produces zeros, never NaN", () => {
  const s = summarise([]);
  assert.equal(s.scanned, 0);
  assert.equal(s.coveragePct, 0);
  assert.equal(s.linkCoveragePct, 0);
  assert.equal(s.uniqueBytecodeCoveragePct, 0);
  assert.ok(!Number.isNaN(s.coveragePct));
});

test("coverage denominator excludes accounts we could not inspect", () => {
  // The bug this guards: folding missing accounts or failed lookups into the
  // denominator quietly moves the headline.
  const s = summarise([
    rec("a.near", "metadata", { codeHash: "h1", link: "https://x" }),
    rec("b.near", "no_metadata", { codeHash: "h2" }),
    rec("c.near", "no_account"),
    rec("d.near", "no_contract", { codeHash: "11111111111111111111111111111111" }),
    rec("e.near", "error"),
  ]);

  assert.equal(s.scanned, 5);
  assert.equal(s.contractsWithCode, 2, "only deployed contracts count");
  assert.equal(s.coveragePct, 50);
});

test("errors are never counted as a finding either way", () => {
  const s = summarise([
    rec("a.near", "error"),
    rec("b.near", "error"),
    rec("c.near", "metadata", { codeHash: "h1", link: "https://x" }),
  ]);
  assert.equal(s.byStatus.error, 2);
  assert.equal(s.contractsWithCode, 1);
  assert.equal(s.coveragePct, 100, "one inspected contract, and it has metadata");
});

test("metadata without a link does not count toward usable coverage", () => {
  // Real case: game.hot.tg publishes a version and no link at all.
  const s = summarise([
    rec("linked.near", "metadata", { codeHash: "h1", link: "https://github.com/x/y" }),
    rec("nolink.near", "metadata", { codeHash: "h2" }),
    rec("none.near", "no_metadata", { codeHash: "h3" }),
  ]);

  assert.equal(s.withMetadata, 2);
  assert.equal(s.withRepoLink, 1);
  assert.ok(s.coveragePct > s.linkCoveragePct, "metadata presence overstates verifiability");
  assert.equal(Math.round(s.linkCoveragePct), 33);
});

test("factory clones are counted once as bytecode, many times as accounts", () => {
  // The real shape: 34 bridged-token accounts sharing one deployment, none with
  // metadata, dragging the account-weighted average down on their own.
  const clones = Array.from({ length: 5 }, (_, i) =>
    rec(`clone${i}.near`, "no_metadata", { codeHash: "shared" }),
  );
  const uniques = [
    rec("u1.near", "metadata", { codeHash: "u1", link: "https://x" }),
    rec("u2.near", "no_metadata", { codeHash: "u2" }),
  ];

  const s = summarise([...clones, ...uniques]);

  assert.equal(s.contractsWithCode, 7);
  assert.equal(s.distinctCodeHashes, 3, "shared + u1 + u2");
  assert.equal(s.uniqueBytecodeContracts, 2, "clones are excluded, they are not unique");
  assert.equal(s.uniqueBytecodeWithMetadata, 1);
  assert.equal(s.uniqueBytecodeCoveragePct, 50);

  // Account-weighted coverage is dragged down by the clone cluster.
  assert.ok(
    s.coveragePct < s.uniqueBytecodeCoveragePct,
    "one factory should not be able to swing the aggregate unnoticed",
  );
});

test("a contract with no code hash cannot be counted as unique bytecode", () => {
  const s = summarise([rec("weird.near", "no_metadata")]);
  assert.equal(s.uniqueBytecodeContracts, 0);
  assert.equal(s.distinctCodeHashes, 0);
});
