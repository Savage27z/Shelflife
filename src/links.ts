import type { ScanRecord } from "./scan.js";

/**
 * What a contract's published source link is actually worth.
 *
 * Having a `link` in NEP-330 metadata is not the same as having source anyone can read.
 * A link can be a template placeholder, can point at a repository that no longer exists,
 * and — even when it resolves — only identifies *which version* of the code it describes
 * if it names a commit. A link to a repo's front page says nothing about what is deployed.
 *
 * So there are three separate questions, kept separate on purpose:
 *   1. is it a real link at all            (parseSourceLink)
 *   2. does the repository resolve         (checkRepo)
 *   3. is it pinned to a commit            (ParsedLink.pinned)
 *
 * Only a link that passes all three could be rebuilt and compared to the deployed code.
 */

export type LinkKind = "github" | "placeholder" | "other";

/**
 * "not_found" is a 404, which GitHub also returns for private repositories — so it means
 * "an anonymous reader cannot see this", not necessarily "deleted".
 */
export type RepoStatus = "resolves" | "not_found" | "unknown";

export interface ParsedLink {
  raw: string;
  kind: LinkKind;
  /** owner/name, GitHub links only. */
  repo?: string;
  /** The ref named in the link, if any — a commit SHA, tag or branch. */
  ref?: string;
  /**
   * True only when the ref is a commit SHA. A tag or branch can move, so naming one does
   * not identify a version.
   */
  pinned: boolean;
}

const SHA = /^[0-9a-f]{7,40}$/i;

/** Angle brackets, URL-encoded angle brackets, and the usual template leftovers. */
const PLACEHOLDER = /[<>]|%3[CE]|\b(your[-_ ]?(org|user(name)?|repo|account)|owner\/repo)\b/i;

export function parseSourceLink(raw: string): ParsedLink {
  const link = raw.trim();

  if (PLACEHOLDER.test(link)) return { raw, kind: "placeholder", pinned: false };

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { raw, kind: "other", pinned: false };
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return { raw, kind: "other", pinned: false };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !name) return { raw, kind: "other", pinned: false };

  // .../tree/<ref>/..., .../commit/<sha>, .../blob/<ref>/...
  const verb = parts[2];
  const ref = verb === "tree" || verb === "commit" || verb === "blob" ? parts[3] : undefined;

  return {
    raw,
    kind: "github",
    repo: `${owner}/${name}`,
    ...(ref !== undefined ? { ref } : {}),
    pinned: ref !== undefined && SHA.test(ref),
  };
}

export const repoKey = (repo: string) => repo.toLowerCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CheckRepoOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
  delayMs?: number;
}

/**
 * HEAD the repository's front page. A 200 resolves, a 404 does not; anything else —
 * rate limiting, a 5xx, a dropped connection — is retried and, if it persists, reported
 * as "unknown" rather than guessed at. An unreadable answer must never become a finding.
 */
export async function checkRepo(repo: string, opts: CheckRepoOptions = {}): Promise<RepoStatus> {
  const doFetch = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 1_500;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(`https://github.com/${repo}`, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 200) return "resolves";
      if (res.status === 404) return "not_found";
      // 429, 5xx and anything unexpected: transient until proven otherwise.
    } catch {
      // network failure: also transient.
    }
    if (attempt < retries) await sleep(delayMs * (attempt + 1));
  }
  return "unknown";
}

export interface LinkRow {
  accountId: string;
  parsed: ParsedLink;
  repoStatus: RepoStatus;
}

/** One row per contract that publishes a link, joined to the status of its repository. */
export function buildRows(records: ScanRecord[], statuses: Map<string, RepoStatus>): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const r of records) {
    const link = r.metadata?.link;
    if (!link) continue;
    const parsed = parseSourceLink(link);
    const repoStatus =
      parsed.kind === "github" && parsed.repo
        ? (statuses.get(repoKey(parsed.repo)) ?? "unknown")
        : "unknown";
    rows.push({ accountId: r.accountId, parsed, repoStatus });
  }
  return rows;
}

export interface LinkSummary {
  inspected: number;
  contractsWithLink: number;
  placeholder: number;
  otherHost: number;
  githubContracts: number;
  distinctRepos: number;
  reposResolving: number;
  reposNotFound: number;
  reposUnknown: number;
  contractsResolving: number;
  contractsNotFound: number;
  contractsPinned: number;
  /** Resolves AND pinned to a commit — the minimum needed for anyone to rebuild it. */
  contractsRebuildable: number;
  withLinkPct: number;
  resolvingPct: number;
  rebuildablePct: number;
}

export function summariseLinks(rows: LinkRow[], inspected: number): LinkSummary {
  const github = rows.filter((r) => r.parsed.kind === "github");
  const repos = new Map<string, RepoStatus>();
  for (const r of github) repos.set(repoKey(r.parsed.repo ?? ""), r.repoStatus);

  const reposWith = (s: RepoStatus) => [...repos.values()].filter((v) => v === s).length;
  const resolving = github.filter((r) => r.repoStatus === "resolves");
  const pct = (n: number) => (inspected === 0 ? 0 : (n / inspected) * 100);

  return {
    inspected,
    contractsWithLink: rows.length,
    placeholder: rows.filter((r) => r.parsed.kind === "placeholder").length,
    otherHost: rows.filter((r) => r.parsed.kind === "other").length,
    githubContracts: github.length,
    distinctRepos: repos.size,
    reposResolving: reposWith("resolves"),
    reposNotFound: reposWith("not_found"),
    reposUnknown: reposWith("unknown"),
    contractsResolving: resolving.length,
    contractsNotFound: github.filter((r) => r.repoStatus === "not_found").length,
    contractsPinned: github.filter((r) => r.parsed.pinned).length,
    contractsRebuildable: resolving.filter((r) => r.parsed.pinned).length,
    withLinkPct: pct(rows.length),
    resolvingPct: pct(resolving.length),
    rebuildablePct: pct(resolving.filter((r) => r.parsed.pinned).length),
  };
}
