import type { ParsedLink, RepoStatus } from "./links.js";
import type { RegistryState } from "./verified.js";

/**
 * One place decides what a contract's situation means and what the exit code is.
 *
 * It exists because the same logic was written twice, in the CLI and in the checker, and
 * the checker's copy had a bug: a contract with NO published source and only a stale
 * registry record exited 0 — "published" — because the test was `link || inRegistry`.
 * Any registry record, however old, counted. That is the wrong answer for a CI gate.
 *
 * The rule now is explicit: exit 0 means *source a reader can actually reach* exists —
 * a link that is not a placeholder and not known-dead, or a registry record that still
 * matches the deployed code. A stale record on its own is not that.
 */

export interface VerdictInput {
  /** The link the contract publishes, parsed. Undefined when it publishes none. */
  link?: ParsedLink;
  /** True when the contract exposes NEP-330 metadata that carries no link. */
  metadataWithoutLink?: boolean;
  /** Result of resolving the repository. Undefined when it was not checked. */
  repoStatus?: RepoStatus;
  registry: RegistryState;
}

export type Level = "ok" | "warn" | "bad";

export interface Verdict {
  /** 0 = readable source exists, 1 = it does not. (2 and 3 are decided before this.) */
  exitCode: 0 | 1;
  level: Level;
  headline: string;
  notes: string[];
  /** Offer the two-command fix. Only when there is nothing readable. */
  offerFix: boolean;
}

type LinkState = "none" | "placeholder" | "dead" | "ok" | "unchecked";

function linkState(input: VerdictInput): LinkState {
  const { link, repoStatus } = input;
  if (!link) return "none";
  if (link.kind === "placeholder") return "placeholder";
  if (repoStatus === "not_found") return "dead";
  if (link.kind === "github" && repoStatus === "resolves") return "ok";
  // A non-GitHub host, or a lookup that failed: unknown, not wrong. Benefit of the doubt
  // — an unreadable answer must not fail someone's build.
  return "unchecked";
}

export function judge(input: VerdictInput): Verdict {
  const state = linkState(input);
  const registry = input.registry;
  const linkReadable = state === "ok" || state === "unchecked";
  const registryCurrent = registry.kind === "current";
  const readable = linkReadable || registryCurrent;
  const pinned = input.link?.pinned === true;

  const notes: string[] = [];

  switch (state) {
    case "dead":
      notes.push("The published link returns 404 — the repository is gone, or private.");
      break;
    case "placeholder":
      notes.push("The published link is a template placeholder, not a repository.");
      break;
    case "unchecked":
      notes.push("Could not confirm the published link resolves.");
      break;
    case "none":
      if (input.metadataWithoutLink) notes.push("The contract publishes metadata, but no source link.");
      break;
    case "ok":
      break;
  }

  if (linkReadable) {
    notes.push(
      pinned
        ? "The link is pinned to a commit, so a rebuild is possible."
        : "The link is not pinned to a commit, so it cannot be tied to the deployed version.",
    );
  }

  switch (registry.kind) {
    case "stale":
      notes.push(
        "A SourceScan record exists, but for earlier code: the contract has redeployed since, " +
          "so that record no longer describes what is running.",
      );
      break;
    case "legacy":
      notes.push(
        "Listed in SourceScan's older registry, which records no code hash, so it cannot be " +
          "checked against what is deployed.",
      );
      break;
    case "lookup_failed":
      notes.push("The SourceScan lookup failed — unknown, not absent.");
      break;
    case "current":
    case "absent":
      break;
  }

  let level: Level;
  let headline: string;

  if (registryCurrent && linkReadable) {
    level = "ok";
    headline = "Source is published, and a SourceScan record matches the deployed code.";
  } else if (registryCurrent) {
    level = "ok";
    headline = "A SourceScan record matches the deployed code.";
  } else if (linkReadable) {
    level = pinned ? "ok" : "warn";
    headline = pinned
      ? "A source link is published and pinned to a commit. Nothing here has rebuilt it, so it is a claim, not a proof."
      : "A source link is published, but it is not pinned to a commit, so it cannot be tied to the deployed code.";
  } else if (registry.kind === "stale") {
    level = "bad";
    headline = "Verified once, then redeployed. Nothing readable is published for the code that is running now.";
  } else if (state === "dead") {
    level = "bad";
    headline = "The published source link is dead.";
  } else if (state === "placeholder") {
    level = "bad";
    headline = "The published source link is a template placeholder.";
  } else {
    level = "bad";
    headline = "No source you can read. You are trusting this code sight unseen.";
  }

  return { exitCode: readable ? 0 : 1, level, headline, notes, offerFix: !readable };
}
