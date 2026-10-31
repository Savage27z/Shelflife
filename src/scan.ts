import {
  EMPTY_CODE_HASH,
  callFunction,
  isMissingAccount,
  isMissingMethod,
  viewAccount,
} from "./rpc.js";

/**
 * What we learned about one account.
 *
 * The four statuses are deliberately distinct. "No contract" and "contract without
 * metadata" are very different facts, and collapsing them would inflate the headline.
 */
export type Status =
  | "no_account" // never existed
  | "no_contract" // account exists, nothing deployed
  | "no_metadata" // contract deployed, no NEP-330 metadata method
  | "metadata" // contract deployed and exposes metadata
  | "error"; // we failed to find out — not evidence of anything

/** NEP-330 contract source metadata, as published by the contract itself. */
export interface SourceMetadata {
  version?: string;
  link?: string;
  standards?: Array<{ standard?: string; version?: string }>;
  build_info?: Record<string, unknown>;
}

export interface ScanRecord {
  accountId: string;
  status: Status;
  codeHash?: string;
  storageBytes?: number;
  /** NEAR balance in yoctoNEAR, as a string — it does not fit in a JS number. */
  balanceYocto?: string;
  metadata?: SourceMetadata;
  /** Present only when metadata parsing failed, so the raw value is preserved. */
  rawMetadata?: string;
  error?: string;
  checkedAt: string;
}

/**
 * Inspect a single account.
 *
 * Note what this does NOT claim. A contract without metadata is *unverifiable by this
 * method*, which is not the same as unverified — SourceScan and NearBlocks may hold a
 * verification record independently. That second path is checked separately; nothing
 * here should be read as a judgement about a project.
 */
export async function scanAccount(accountId: string): Promise<ScanRecord> {
  const checkedAt = new Date().toISOString();

  let account;
  try {
    account = await viewAccount(accountId);
  } catch (err) {
    if (isMissingAccount(err)) return { accountId, status: "no_account", checkedAt };
    return { accountId, status: "error", error: String(err), checkedAt };
  }

  const base = {
    accountId,
    codeHash: account.code_hash,
    storageBytes: account.storage_usage,
    balanceYocto: account.amount,
    checkedAt,
  };

  if (account.code_hash === EMPTY_CODE_HASH) {
    return { ...base, status: "no_contract" };
  }

  let raw: string;
  try {
    raw = await callFunction(accountId, "contract_source_metadata");
  } catch (err) {
    if (isMissingMethod(err)) return { ...base, status: "no_metadata" };
    return { ...base, status: "error", error: String(err) };
  }

  try {
    return { ...base, status: "metadata", metadata: JSON.parse(raw) as SourceMetadata };
  } catch {
    // The method exists and returned something we cannot parse. Keep the raw value:
    // "malformed" is a finding too, and discarding it would hide it.
    return { ...base, status: "metadata", rawMetadata: raw };
  }
}

export interface Summary {
  scanned: number;
  byStatus: Record<Status, number>;
  /** Of contracts that exist, how many expose metadata at all. */
  contractsWithCode: number;
  withMetadata: number;
  /** Metadata is only useful if it points somewhere. */
  withRepoLink: number;
  coveragePct: number;
}

export function summarise(records: ScanRecord[]): Summary {
  const byStatus = {
    no_account: 0,
    no_contract: 0,
    no_metadata: 0,
    metadata: 0,
    error: 0,
  } as Record<Status, number>;

  for (const r of records) byStatus[r.status]++;

  // Denominator is contracts we could actually inspect. Accounts with no contract and
  // accounts we failed to reach are excluded — including them would flatter the number
  // in one direction and errors in the other.
  const contractsWithCode = byStatus.no_metadata + byStatus.metadata;
  const withMetadata = byStatus.metadata;
  const withRepoLink = records.filter((r) => Boolean(r.metadata?.link)).length;

  return {
    scanned: records.length,
    byStatus,
    contractsWithCode,
    withMetadata,
    withRepoLink,
    coveragePct: contractsWithCode === 0 ? 0 : (withMetadata / contractsWithCode) * 100,
  };
}

/** Scan a list of accounts, politely — the public RPC is free and shared. */
export async function scanAll(
  accountIds: string[],
  onProgress?: (record: ScanRecord, index: number, total: number) => void,
): Promise<ScanRecord[]> {
  const out: ScanRecord[] = [];
  for (const [i, id] of accountIds.entries()) {
    const record = await scanAccount(id);
    out.push(record);
    onProgress?.(record, i + 1, accountIds.length);
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}
