import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcError, isMissingAccount, isMissingMethod, EMPTY_CODE_HASH } from "../src/rpc.js";

/**
 * These guard the bug that made the very first run of this tool report 100%
 * verification coverage: a contract lacking the metadata method was being classified
 * as an infrastructure error and dropped from the denominator.
 *
 * The fixtures below are the real shapes NEAR returns, copied from live responses.
 */

test("a missing method is recognised from the real NEAR response shape", () => {
  // NEAR returns HTTP 200 with the failure as a string inside result.error.
  const raw = {
    block_hash: "BBmAoVaXzKHTaaNmNFR5w5ghUCrKmuA3DG4jXzMYMKzD",
    block_height: 222414439,
    error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
    logs: [],
  };
  const err = new RpcError(raw.error, "CONTRACT_EXECUTION_ERROR", raw);

  assert.equal(isMissingMethod(err), true, "this is a finding, not a failure");
  assert.equal(isMissingAccount(err), false);
});

test("a missing account is recognised", () => {
  const err = new RpcError(
    "account nonexistent.near does not exist while viewing",
    "UNKNOWN_ACCOUNT",
    { cause: { name: "UNKNOWN_ACCOUNT" } },
  );

  assert.equal(isMissingAccount(err), true);
  assert.equal(isMissingMethod(err), false);
});

test("a genuine transport failure is classified as neither", () => {
  // Must stay an error: silently bucketing it would invent a finding from a timeout.
  const err = new RpcError("transport failure after retries: TypeError: terminated", undefined, null);

  assert.equal(isMissingAccount(err), false);
  assert.equal(isMissingMethod(err), false);
});

test("non-RpcError values are never classified as findings", () => {
  for (const value of [new Error("boom"), "boom", null, undefined, 42]) {
    assert.equal(isMissingAccount(value), false);
    assert.equal(isMissingMethod(value), false);
  }
});

test("a panic inside the contract is not a missing method", () => {
  // Observed on the verifier when called with the wrong argument shape. The method
  // exists; treating this as "no metadata" would understate coverage.
  const raw = {
    error: 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "Failed to deserialize" })',
  };
  const err = new RpcError(raw.error, "CONTRACT_EXECUTION_ERROR", raw);

  assert.equal(isMissingMethod(err), false);
});

test("the empty code hash constant matches what NEAR reports for a bare account", () => {
  assert.equal(EMPTY_CODE_HASH, "11111111111111111111111111111111");
  assert.equal(EMPTY_CODE_HASH.length, 32);
});

// ---- global contracts (NEP-591) ---------------------------------------------------------

import { effectiveCode, type AccountView } from "../src/rpc.js";

/**
 * Real shape, copied from view_account on vault2.ft-lockup.near: an account running a
 * global contract reports an all-ones code_hash, exactly like an empty account.
 */
const acct = (over: Partial<AccountView>): AccountView => ({
  amount: "1",
  code_hash: EMPTY_CODE_HASH,
  storage_usage: 100,
  ...over,
});

test("REGRESSION: a global-contract account is a contract, not an empty account", () => {
  // The scanner read the all-ones hash as "no contract" and threw these accounts away;
  // 12 of the 105 registry accounts were misfiled as "code removed" because of it.
  const e = effectiveCode(acct({ global_contract_hash: "GXiWVUxgNZvu94oFirzgthiLjiGiZzUMm1meEhNZjtMz" }));
  assert.equal(e.hash, "GXiWVUxgNZvu94oFirzgthiLjiGiZzUMm1meEhNZjtMz");
  assert.equal(e.usesGlobalContract, true);
});

test("an account with neither local nor global code runs nothing", () => {
  const e = effectiveCode(acct({}));
  assert.equal(e.hash, undefined);
  assert.equal(e.usesGlobalContract, false);
});

test("ordinary local code is reported as itself", () => {
  const e = effectiveCode(acct({ code_hash: "DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1" }));
  assert.equal(e.hash, "DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1");
  assert.equal(e.usesGlobalContract, false);
});

test("a global contract named by hash compares equal to a local deploy of the same bytes", () => {
  // That is what lets a verification record for local code still match after the
  // account moves to the identical global contract.
  const local = effectiveCode(acct({ code_hash: "SAMEBYTES" }));
  const global = effectiveCode(acct({ global_contract_hash: "SAMEBYTES" }));
  assert.equal(local.hash, global.hash);
});

test("a global contract named only by publisher gets an opaque identity that cannot match a record", () => {
  const e = effectiveCode(acct({ global_contract_account_id: "publisher.near" }));
  assert.equal(e.usesGlobalContract, true);
  assert.equal(e.hash, "global-account:publisher.near");
  assert.notEqual(e.hash, "publisher.near");
});

test("a local code_hash wins when both are somehow present", () => {
  const e = effectiveCode(acct({ code_hash: "LOCAL", global_contract_hash: "GLOBAL" }));
  assert.equal(e.hash, "LOCAL");
  assert.equal(e.usesGlobalContract, false);
});
