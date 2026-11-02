import { callFunction } from "./rpc.js";
import type { ScanRecord } from "./scan.js";

/**
 * SourceScan keeps two registries on NEAR mainnet, and counting only one undercounts.
 *
 *   v2-verifier.sourcescan.near   current registry; records pin the verified code hash
 *   sourcescan.near               older registry; records carry no code hash at all
 *
 * The older one is tiny and holds only developer and example accounts, but "every contract
 * ever verified" is only true of the union, and it is the union this module reports.
 */
export const VERIFIER_ACCOUNT = "v2-verifier.sourcescan.near";
export const LEGACY_VERIFIER_ACCOUNT = "sourcescan.near";

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

/** Older-registry record. No code hash, so staleness cannot be checked for these. */
export interface LegacyRecord {
  cid: string;
  lang: string;
  entry_point?: string;
  deploy_tx?: string;
  github?: string;
}

export interface Page<T> {
  entries: Array<[string, T]>;
  /** Number of PAGES at the requested limit. NOT a record count — see parsePage. */
  pages: number;
}

/**
 * `get_contracts` returns a two-element tuple: [entries, pageCount].
 *
 * The second element is the number of pages at the requested limit, not the number of
 * contracts: on the 105-record registry it returns 105 at limit 1, 53 at limit 2, 5 at
 * limit 25 and 1 at limit 500. Reading it as a total gives a wrong headline, so callers
 * count the entries they actually received.
 *
 * Strict on purpose. If the shape ever changes this should fail loudly rather than
 * silently produce a plausible-looking number.
 */
export function parsePage<T>(raw: string): Page<T> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("get_contracts returned something that is not JSON");
  }

  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[0]) || typeof value[1] !== "number") {
    throw new Error("unexpected get_contracts shape — expected [entries, pageCount]");
  }

  for (const entry of value[0] as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("unexpected get_contracts entry — expected [accountId, record]");
    }
  }

  return { entries: value[0] as Array<[string, T]>, pages: value[1] };
}

async function fetchAll<T>(registry: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const limit = 100;
  let fromIndex = 0;

  for (;;) {
    const raw = await callFunction(registry, "get_contracts", { from_index: fromIndex, limit });
    const { entries } = parsePage<T>(raw);
    if (entries.length === 0) break;

    for (const [accountId, record] of entries) out.set(accountId, record);
    fromIndex += entries.length;

    if (entries.length < limit) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  return out;
}

/** Every record in the current registry. */
export const fetchAllVerified = () => fetchAll<VerifiedRecord>(VERIFIER_ACCOUNT);

/** Every record in the older registry. */
export const fetchLegacy = () => fetchAll<LegacyRecord>(LEGACY_VERIFIER_ACCOUNT);

/** Current-registry record for one account, or null if never verified there. */
export async function getVerified(accountId: string): Promise<VerifiedRecord | null> {
  const raw = await callFunction(VERIFIER_ACCOUNT, "get_contract", { account_id: accountId });
  return (JSON.parse(raw) as VerifiedRecord | null) ?? null;
}

/**
 * A verification record pins a specific code hash. If the account has since redeployed,
 * the record no longer describes the deployed code.
 */
export function isCurrent(record: VerifiedRecord, deployedCodeHash: string): boolean {
  return record.code_hash === deployedCodeHash;
}

/** Where an account stands in the SourceScan registries. */
export type RegistryState =
  | { kind: "absent" }
  | { kind: "current" }
  | { kind: "stale"; verifiedHash: string }
  | { kind: "legacy" }
  | { kind: "lookup_failed" };

/**
 * Best-effort: a failed lookup is reported as `lookup_failed` — unknown — and never
 * collapsed into `absent`, because "we could not ask" is not "it is not there".
 */
export async function lookupRegistry(accountId: string, deployedHash: string): Promise<RegistryState> {
  try {
    const record = await getVerified(accountId);
    if (record) {
      return isCurrent(record, deployedHash)
        ? { kind: "current" }
        : { kind: "stale", verifiedHash: record.code_hash };
    }
    const legacy = await fetchLegacy();
    return legacy.has(accountId) ? { kind: "legacy" } : { kind: "absent" };
  } catch {
    return { kind: "lookup_failed" };
  }
}

/**
 * Names that suggest a throwaway deployment. A heuristic, reported as one: it exists so
 * the registry count is not read as "105 real projects", not to classify any account.
 */
const TESTLIKE = /test|staging|demo|(^|[-._])(qa|dev)([-._\d]|$)|(^|[-._])(stage|sandbox)([-._\d]|$)/i;

export function looksLikeTestAccount(accountId: string): boolean {
  return TESTLIKE.test(accountId);
}

/** What a contract whose registry record is out of date publishes today. */
export type Today = "link" | "nolink" | "none" | "broken" | "unresolved";

/** What became of one registry record, judged against the live account. */
export type Outcome =
  | { kind: "current" }
  | { kind: "stale"; today: Today }
  | { kind: "deleted" }
  | { kind: "code_removed" }
  | { kind: "unresolved" };

/**
 * Classify a registry record against what the chain says now.
 *
 * "Deleted" is kept distinct from "could not be determined": an account that provably
 * does not exist is a finding, a request that failed is not, and folding one into the
 * other — as an earlier version did, labelling every error "unreachable" — makes the
 * count depend on how flaky the RPC was that day.
 *
 * A stale record is not automatically a trust gap. The contract may have moved on to
 * publishing source of its own, so what it publishes *today* is recorded alongside.
 */
export function classifyRecord(record: VerifiedRecord, scan: ScanRecord): Outcome {
  if (scan.status === "no_account") return { kind: "deleted" };
  if (scan.status === "no_contract") return { kind: "code_removed" };
  if (!scan.codeHash) return { kind: "unresolved" };
  if (scan.codeHash === record.code_hash) return { kind: "current" };

  switch (scan.status) {
    case "metadata":
      return { kind: "stale", today: scan.metadata?.link ? "link" : "nolink" };
    case "no_metadata":
      return { kind: "stale", today: "none" };
    case "error":
      // The metadata call panicked. A contract that no longer compiles is a different
      // thing from one we merely failed to reach.
      return /CompilationError/i.test(scan.error ?? "")
        ? { kind: "stale", today: "broken" }
        : { kind: "stale", today: "unresolved" };
    default:
      return { kind: "unresolved" };
  }
}
