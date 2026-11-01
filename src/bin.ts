#!/usr/bin/env node
/**
 * sourcecheck — can anyone read the source of this NEAR contract?
 *
 *   npx sourcecheck wrap.near
 *
 * Exits non-zero when no source is published, so it can gate a CI pipeline:
 * a team can fail their own build if a dependency they rely on goes dark.
 */
import { scanAccount } from "./scan.js";
import { getVerified, isCurrent } from "./verified.js";

const EXIT = {
  published: 0,
  unpublished: 1,
  notAContract: 2,
  failed: 3,
} as const;

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";

/** Colour only when attached to a terminal, so piped output stays clean. */
const tty = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const paint = (code: string, s: string) => (tty ? `${code}${s}${RESET}` : s);

function usage(): number {
  console.log(`sourcecheck — can anyone read the source of this NEAR contract?

  npx sourcecheck <account.near>

Exit codes:
  0  a source link is published
  1  no source published
  2  not a contract
  3  lookup failed`);
  return EXIT.failed;
}

async function main(): Promise<number> {
  const accountId = process.argv[2];
  if (!accountId || accountId.startsWith("-")) return usage();

  const record = await scanAccount(accountId);

  if (record.status === "error") {
    console.error(paint(RED, `could not reach ${accountId}: ${record.error ?? "unknown error"}`));
    return EXIT.failed;
  }
  if (record.status === "no_account") {
    console.log(`\n${paint(BOLD, accountId)}\n  ${paint(RED, "no such account")}\n`);
    return EXIT.notAContract;
  }
  if (record.status === "no_contract") {
    console.log(
      `\n${paint(BOLD, accountId)}\n  ${paint(DIM, "account exists, but no contract is deployed")}\n`,
    );
    return EXIT.notAContract;
  }

  // Registry lookup is best-effort: its absence is reported, never asserted as proof.
  let registry = null;
  let registryFailed = false;
  try {
    registry = await getVerified(accountId);
  } catch {
    registryFailed = true;
  }

  const link = record.metadata?.link;
  const inRegistry = registry !== null;
  const registryCurrent =
    registry && record.codeHash ? isCurrent(registry, record.codeHash) : false;
  const registryStale = inRegistry && !registryCurrent;

  console.log(`\n${paint(BOLD, accountId)}`);
  console.log(`  ${paint(DIM, "code hash")}   ${record.codeHash}`);

  if (link) {
    console.log(`  ${paint(DIM, "source")}      ${link}`);
    if (record.metadata?.version) {
      console.log(`  ${paint(DIM, "version")}     ${record.metadata.version}`);
    }
  } else if (record.metadata) {
    console.log(`  ${paint(DIM, "source")}      ${paint(YELLOW, "metadata published, but no link in it")}`);
  } else {
    console.log(`  ${paint(DIM, "source")}      ${paint(RED, "none published")}`);
  }

  if (registryFailed) {
    console.log(`  ${paint(DIM, "SourceScan")}  ${paint(YELLOW, "lookup failed — unknown, not absent")}`);
  } else if (registryStale) {
    console.log(`  ${paint(DIM, "SourceScan")}  ${paint(YELLOW, "verified once, but REDEPLOYED since")}`);
    console.log(`  ${paint(DIM, "verified")}    ${registry?.code_hash} ${paint(DIM, "(no longer deployed)")}`);
  } else if (inRegistry) {
    console.log(`  ${paint(DIM, "SourceScan")}  ${paint(GREEN, "verified, matches the deployed code")}`);
  } else {
    console.log(`  ${paint(DIM, "SourceScan")}  not in the registry`);
  }

  console.log();

  // A stale registry record is its own warning: it is the case most likely to be
  // misread, because explorers still show the contract as "verified".
  if (registryStale) {
    console.log(
      paint(YELLOW, "  This contract was verified, then redeployed. The published source") +
        paint(YELLOW, "\n  describes code that is no longer running."),
    );
  } else if (link && registryCurrent) {
    console.log(paint(GREEN, "  Source is published and the SourceScan record matches what is deployed."));
  } else if (link) {
    console.log(paint(YELLOW, "  Source is published, but nothing here proves it compiles to the deployed code."));
  } else if (registryCurrent) {
    console.log(paint(GREEN, "  Verified via SourceScan, though the contract publishes no link itself."));
  } else {
    console.log(paint(RED, "  No source you can read. You are trusting this code sight unseen."));
  }

  // Say what to do about it, rather than only what is wrong.
  if (!link && !inRegistry) {
    console.log(
      paint(DIM, "\n  If this is yours, two commands fix it:\n") +
        paint(DIM, "    cargo near build reproducible-wasm\n") +
        paint(DIM, "    cargo near deploy <account>"),
    );
  }
  console.log();

  return link || inRegistry ? EXIT.published : EXIT.unpublished;
}

/**
 * Set exitCode and let node unwind naturally. Calling process.exit() here races
 * sockets that are still closing, which on Windows aborts with a libuv assertion
 * and returns 127 — destroying the exit code this tool exists to provide.
 */
process.exitCode = await main();
