import { scanAccount, type ScanRecord } from "./scan.js";
import { checkRepo, parseSourceLink, type ParsedLink, type RepoStatus } from "./links.js";
import { lookupRegistry, type RegistryState } from "./verified.js";
import { judge, type Level, type Verdict } from "./verdict.js";

/**
 * Check one contract. Shared by `shelflife <account>` and `npm run check`, which used to
 * be two separate implementations that could — and did — disagree.
 */

export const EXIT = { readable: 0, unreadable: 1, notAContract: 2, failed: 3 } as const;

export type CheckResult =
  | { kind: "failed"; accountId: string; error: string }
  | { kind: "no_account"; accountId: string }
  | { kind: "no_contract"; accountId: string }
  | {
      kind: "contract";
      accountId: string;
      record: ScanRecord;
      link?: ParsedLink;
      repoStatus?: RepoStatus;
      registry: RegistryState;
      verdict: Verdict;
    };

/** Everything that touches the network, injectable so the whole flow can be tested offline. */
export interface Deps {
  scan: (accountId: string) => Promise<ScanRecord>;
  registry: (accountId: string, deployedHash: string) => Promise<RegistryState>;
  repo: (repo: string) => Promise<RepoStatus>;
}

export const defaultDeps: Deps = {
  scan: scanAccount,
  registry: lookupRegistry,
  repo: (repo) => checkRepo(repo),
};

export async function checkContract(accountId: string, deps: Deps = defaultDeps): Promise<CheckResult> {
  const record = await deps.scan(accountId);

  if (record.status === "error") {
    return { kind: "failed", accountId, error: record.error ?? "unknown error" };
  }
  if (record.status === "no_account") return { kind: "no_account", accountId };
  if (record.status === "no_contract") return { kind: "no_contract", accountId };

  const registry = await deps.registry(accountId, record.codeHash ?? "");

  const rawLink = record.metadata?.link;
  const link = rawLink ? parseSourceLink(rawLink) : undefined;
  const repoStatus =
    link?.kind === "github" && link.repo ? await deps.repo(link.repo) : undefined;

  const verdict = judge({
    ...(link ? { link } : {}),
    metadataWithoutLink: record.status === "metadata" && !rawLink,
    ...(repoStatus ? { repoStatus } : {}),
    registry,
  });

  return {
    kind: "contract",
    accountId,
    record,
    ...(link ? { link } : {}),
    ...(repoStatus ? { repoStatus } : {}),
    registry,
    verdict,
  };
}

export function exitCodeFor(result: CheckResult): number {
  switch (result.kind) {
    case "failed":
      return EXIT.failed;
    case "no_account":
    case "no_contract":
      return EXIT.notAContract;
    case "contract":
      return result.verdict.exitCode === 0 ? EXIT.readable : EXIT.unreadable;
  }
}

export type Paint = (style: "bold" | "dim" | Level, text: string) => string;

export const plain: Paint = (_style, text) => text;

const label = (s: string) => s.padEnd(11);

/** The report for one contract, as lines. Colour is the caller's business. */
export function renderCheck(result: CheckResult, paint: Paint = plain): string[] {
  if (result.kind === "failed") {
    return [paint("bad", `could not reach ${result.accountId}: ${result.error}`)];
  }
  if (result.kind === "no_account") {
    return ["", paint("bold", result.accountId), `  ${paint("bad", "no such account")}`, ""];
  }
  if (result.kind === "no_contract") {
    return [
      "",
      paint("bold", result.accountId),
      `  ${paint("dim", "account exists, but no contract is deployed")}`,
      "",
    ];
  }

  const { record, link, repoStatus, registry, verdict } = result;
  const lines: string[] = ["", paint("bold", result.accountId)];

  lines.push(`  ${paint("dim", label("code hash"))}${record.codeHash ?? "?"}`);

  if (link) {
    const pin = link.pinned ? `pinned to ${link.ref?.slice(0, 7)}` : "not pinned to a commit";
    lines.push(`  ${paint("dim", label("source"))}${link.raw}`);
    if (link.kind !== "placeholder") lines.push(`  ${paint("dim", label(""))}${paint("dim", pin)}`);
    if (record.metadata?.version) lines.push(`  ${paint("dim", label("version"))}${record.metadata.version}`);
  } else if (record.status === "metadata") {
    lines.push(`  ${paint("dim", label("source"))}${paint("warn", "metadata published, but no link in it")}`);
  } else {
    lines.push(`  ${paint("dim", label("source"))}${paint("bad", "none published")}`);
  }

  if (link && link.kind === "github") {
    const text =
      repoStatus === "resolves"
        ? paint("ok", "repository resolves")
        : repoStatus === "not_found"
          ? paint("bad", "NOT FOUND (404 — gone or private)")
          : paint("warn", "could not be checked");
    lines.push(`  ${paint("dim", label("link"))}${text}`);
  }

  switch (registry.kind) {
    case "current":
      lines.push(`  ${paint("dim", label("SourceScan"))}${paint("ok", "verified, matches the deployed code")}`);
      break;
    case "stale":
      lines.push(`  ${paint("dim", label("SourceScan"))}${paint("warn", "verified once, but redeployed since")}`);
      lines.push(`  ${paint("dim", label("verified"))}${registry.verifiedHash} ${paint("dim", "(no longer deployed)")}`);
      break;
    case "legacy":
      lines.push(`  ${paint("dim", label("SourceScan"))}${paint("warn", "older registry only (no code hash)")}`);
      break;
    case "lookup_failed":
      lines.push(`  ${paint("dim", label("SourceScan"))}${paint("warn", "lookup failed")}`);
      break;
    case "absent":
      lines.push(`  ${paint("dim", label("SourceScan"))}not in the registry`);
      break;
  }

  lines.push("", `  ${paint(verdict.level, verdict.headline)}`);
  for (const note of verdict.notes) lines.push(`  ${paint("dim", "· " + note)}`);

  if (verdict.offerFix) {
    lines.push(
      "",
      paint("dim", "  If this is yours, two commands fix it:"),
      paint("dim", "    cargo near build reproducible-wasm"),
      paint("dim", "    cargo near deploy <account>"),
    );
  }
  lines.push("");
  return lines;
}
