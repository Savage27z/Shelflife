import { callFunction } from "./rpc.js";

/**
 * SourceScan's verifier contract on NEAR mainnet. This is the registry behind the
 * "Verify and Publish" flow on NearBlocks, and it is the second verification path a
 * contract can take — entirely independent of whether the contract itself exposes
 * NEP-330 metadata.
 *
 * The testnet equivalent is v2-verifier.sourcescan.testnet.
 */
export const VERIFIER_ACCOUNT = "v2-verifier.sourcescan.near";

export interface VerifiedRecord {
  /** IPFS CID of the published source. */
  cid: string;
  lang: string;
  /** Code hash that was verified — compare against the account's current code hash. */
  code_hash: string;
  block_height: number;
  votes?: unknown[];
  comments?: unknown[];
}

/**
 * `get_contracts` returns a two-element tuple: [entries, pageCount].
 *
 * The second element is the number of PAGES at the requested limit, not the number of
 * contracts. At limit=2 it returns 53, at limit=25 it returns 5, at limit=500 it
 * returns 1 — all consistent with 105 records. Reading it as a total gives a wrong
 * headline, so the count here is derived from the entries actually fetched.
 */
type ContractsPage = [Array<[string, VerifiedRecord]>, number];

/** Every contract SourceScan has verified on mainnet. */
export async function fetchAllVerified(): Promise<Map<string, VerifiedRecord>> {
  const out = new Map<string, VerifiedRecord>();
  const limit = 100;
  let fromIndex = 0;

  for (;;) {
    const raw = await callFunction(VERIFIER_ACCOUNT, "get_contracts", {
      from_index: fromIndex,
      limit,
    });
    const [entries] = JSON.parse(raw) as ContractsPage;
    if (entries.length === 0) break;

    for (const [accountId, record] of entries) out.set(accountId, record);
    fromIndex += entries.length;

    if (entries.length < limit) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  return out;
}

/** Verification record for one account, or null if SourceScan has never verified it. */
export async function getVerified(accountId: string): Promise<VerifiedRecord | null> {
  const raw = await callFunction(VERIFIER_ACCOUNT, "get_contract", { account_id: accountId });
  const parsed = JSON.parse(raw) as VerifiedRecord | null;
  return parsed ?? null;
}

/**
 * A verification record pins a specific code hash. If the account has since redeployed,
 * the record is stale and the deployed code is no longer the code that was verified —
 * which is a materially different situation from "verified".
 */
export function isCurrent(record: VerifiedRecord, deployedCodeHash: string): boolean {
  return record.code_hash === deployedCodeHash;
}
