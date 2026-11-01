import { test } from "node:test";
import assert from "node:assert/strict";
import { weigh, toNear } from "../src/weight.js";
import type { ScanRecord, Status } from "../src/scan.js";
import { isCurrent, type VerifiedRecord } from "../src/verified.js";

const at = "2026-11-01T00:00:00.000Z";
const NEAR = (n: number) => (BigInt(n) * 10n ** 24n).toString();

function rec(
  accountId: string,
  status: Status,
  opts: { link?: string; near?: number; storage?: number } = {},
): ScanRecord {
  const r: ScanRecord = { accountId, status, checkedAt: at, codeHash: `h-${accountId}` };
  r.balanceYocto = NEAR(opts.near ?? 0);
  r.storageBytes = opts.storage ?? 0;
  if (status === "metadata") r.metadata = opts.link ? { link: opts.link } : {};
  return r;
}

test("balances are summed as BigInt, not floated", () => {
  // Real balances exceed Number.MAX_SAFE_INTEGER by many orders of magnitude;
  // wrap.near alone is ~3.5e31 yoctoNEAR.
  const w = weigh([rec("a.near", "no_metadata", { near: 34_798_938 })], new Set());
  assert.equal(w.totalBalanceYocto, 34_798_938n * 10n ** 24n);
  assert.equal(toNear(w.totalBalanceYocto), 34_798_938);
});

test("contracts land in the right bucket", () => {
  const records = [
    rec("meta.near", "metadata", { link: "https://x", near: 10 }),
    rec("registry.near", "no_metadata", { near: 20 }),
    rec("nothing.near", "no_metadata", { near: 70 }),
  ];
  const w = weigh(records, new Set(["registry.near"]));

  const [selfPublished, registryOnly, neither] = w.buckets;
  assert.equal(selfPublished!.contracts, 1);
  assert.equal(registryOnly!.contracts, 1, "registry membership rescues it from 'neither'");
  assert.equal(neither!.contracts, 1);
  assert.equal(w.unverifiableBalanceShare, 70);
});

test("accounts without a contract are excluded entirely", () => {
  const w = weigh(
    [
      rec("live.near", "no_metadata", { near: 100 }),
      rec("bare.near", "no_contract", { near: 9999 }),
      rec("gone.near", "no_account"),
      rec("broken.near", "error", { near: 5555 }),
    ],
    new Set(),
  );

  assert.equal(w.totalContracts, 1);
  assert.equal(toNear(w.totalBalanceYocto), 100, "balances of non-contracts must not leak in");
});

test("an all-zero sample does not divide by zero", () => {
  const w = weigh([rec("a.near", "no_metadata", { near: 0, storage: 0 })], new Set());
  assert.equal(w.unverifiableBalanceShare, 0);
  assert.equal(w.unverifiableStorageShare, 0);
  assert.ok(!Number.isNaN(w.unverifiableBalanceShare));
});

test("concentration is reported largest first, so a dominant account cannot hide", () => {
  // The honesty guard: 99.8% exposure is true but misleading when one account is
  // 90% of it. The table has to surface that by default.
  const w = weigh(
    [
      rec("whale.near", "no_metadata", { near: 900 }),
      rec("small.near", "no_metadata", { near: 50 }),
      rec("tiny.near", "no_metadata", { near: 50 }),
    ],
    new Set(),
  );

  assert.equal(w.topUnverifiable[0]!.accountId, "whale.near");
  assert.equal(w.topUnverifiable[0]!.balanceShare, 90);
  assert.ok(
    w.topUnverifiable[0]!.balanceShare > 50,
    "a single account dominating the headline must be visible in the output",
  );
});

test("verified contracts are kept out of the concentration list", () => {
  const w = weigh(
    [
      rec("published.near", "metadata", { link: "https://x", near: 900 }),
      rec("dark.near", "no_metadata", { near: 100 }),
    ],
    new Set(),
  );
  assert.equal(w.topUnverifiable.length, 1);
  assert.equal(w.topUnverifiable[0]!.accountId, "dark.near");
});

test("a verification record is stale once the contract redeploys", () => {
  const record: VerifiedRecord = {
    cid: "Qm...",
    lang: "rust",
    code_hash: "AUHmE71SPjnq8S3EW7m8ompfVBJxwCt4YfVvFLHtvVnr",
    block_height: 1,
  };

  assert.equal(isCurrent(record, record.code_hash), true);
  assert.equal(
    isCurrent(record, "EauRt8UydofJitWuttov1zPpcxRKhBLCttYUzw62Diaq"),
    false,
    "devhub.near: verified once, redeployed since",
  );
});
