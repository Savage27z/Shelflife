import type { ScanRecord } from "./scan.js";

/**
 * Turns a count into an exposure figure.
 *
 * "81% of contracts publish no source" is a statistic. "N NEAR and M megabytes of
 * state sit behind code nobody can check" is a consequence. The second is what an
 * investor or a protocol team would actually act on, and it is the thing that makes
 * this honestly claimable under the Investment Thesis brief rather than a stretch.
 *
 * Deliberately computed from data the scan already collected — balance and storage
 * come back with `view_account`, so weighting costs zero extra requests and cannot be
 * rate-limited into a partial answer.
 */

const YOCTO_PER_NEAR = 10n ** 24n;

export interface Bucket {
  label: string;
  contracts: number;
  balanceYocto: bigint;
  storageBytes: number;
}

export interface Contributor {
  accountId: string;
  balanceYocto: bigint;
  storageBytes: number;
  /** This account's share of the whole sample's balance, as a percentage. */
  balanceShare: number;
  storageShare: number;
}

export interface Weighting {
  buckets: Bucket[];
  totalContracts: number;
  totalBalanceYocto: bigint;
  totalStorageBytes: number;
  /** Share of NEAR held by contracts that publish no source by either path. */
  unverifiableBalanceShare: number;
  unverifiableStorageShare: number;
  /**
   * The largest unverifiable contracts, reported alongside the aggregate on purpose.
   *
   * These totals are dominated by a handful of accounts — wrapped NEAR holds the
   * backing for every wNEAR in existence, and the EVM holds all of its own state. An
   * aggregate percentage without that context reads as though exposure is spread
   * across the ecosystem when it is mostly one or two contracts. Quoting the headline
   * without the concentration would be a misleading use of a true number.
   */
  topUnverifiable: Contributor[];
}

/** NEAR, to 2dp, from a yoctoNEAR amount. Avoids float until the very last step. */
export function toNear(yocto: bigint): number {
  return Number((yocto * 100n) / YOCTO_PER_NEAR) / 100;
}

export function formatNear(yocto: bigint): string {
  return toNear(yocto).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * @param records   scan output
 * @param verified  account ids present in the SourceScan registry
 */
export function weigh(records: ScanRecord[], verified: Set<string>): Weighting {
  const inspected = records.filter(
    (r) => r.status === "metadata" || r.status === "no_metadata",
  );

  const make = (label: string): Bucket => ({
    label,
    contracts: 0,
    balanceYocto: 0n,
    storageBytes: 0,
  });

  const selfPublished = make("publishes NEP-330 source metadata");
  const registryOnly = make("in SourceScan registry only");
  const neither = make("no published source by either path");

  for (const r of inspected) {
    const bucket =
      r.status === "metadata"
        ? selfPublished
        : verified.has(r.accountId)
          ? registryOnly
          : neither;

    bucket.contracts++;
    bucket.balanceYocto += BigInt(r.balanceYocto ?? "0");
    bucket.storageBytes += r.storageBytes ?? 0;
  }

  const buckets = [selfPublished, registryOnly, neither];
  const totalBalanceYocto = buckets.reduce((a, b) => a + b.balanceYocto, 0n);
  const totalStorageBytes = buckets.reduce((a, b) => a + b.storageBytes, 0);

  // Guard the denominators: an empty or zero-balance sample must not produce NaN.
  const balanceShare =
    totalBalanceYocto === 0n
      ? 0
      : Number((neither.balanceYocto * 10_000n) / totalBalanceYocto) / 100;
  const storageShare =
    totalStorageBytes === 0 ? 0 : (neither.storageBytes / totalStorageBytes) * 100;

  const unverifiableRecords = inspected.filter(
    (r) => r.status === "no_metadata" && !verified.has(r.accountId),
  );

  const topUnverifiable: Contributor[] = unverifiableRecords
    .map((r) => ({
      accountId: r.accountId,
      balanceYocto: BigInt(r.balanceYocto ?? "0"),
      storageBytes: r.storageBytes ?? 0,
      balanceShare:
        totalBalanceYocto === 0n
          ? 0
          : Number((BigInt(r.balanceYocto ?? "0") * 10_000n) / totalBalanceYocto) / 100,
      storageShare:
        totalStorageBytes === 0 ? 0 : ((r.storageBytes ?? 0) / totalStorageBytes) * 100,
    }))
    .sort((a, b) => (b.balanceYocto > a.balanceYocto ? 1 : -1))
    .slice(0, 5);

  return {
    buckets,
    totalContracts: inspected.length,
    totalBalanceYocto,
    totalStorageBytes,
    unverifiableBalanceShare: balanceShare,
    unverifiableStorageShare: storageShare,
    topUnverifiable,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
