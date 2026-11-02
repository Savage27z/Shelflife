#!/usr/bin/env node
/**
 * shelflife — can anyone read the source of this NEAR contract?
 *
 *   node dist/bin.js <account.near>
 *
 * Exits non-zero when no readable source exists, so it can gate a CI pipeline: a team
 * can fail their own build if a dependency they rely on goes dark.
 *
 * All the logic lives in check.ts and verdict.ts, where it is tested. This file only
 * decides colours and the process exit code.
 */
import { EXIT, checkContract, exitCodeFor, renderCheck, type Paint } from "./check.js";

const CODES = {
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  ok: "\u001b[32m",
  warn: "\u001b[33m",
  bad: "\u001b[31m",
} as const;
const RESET = "\u001b[0m";

/** Colour only when attached to a terminal, so piped output stays clean. */
const tty = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const paint: Paint = (style, text) => (tty ? `${CODES[style]}${text}${RESET}` : text);

function usage(): number {
  console.log(`shelflife — can anyone read the source of this NEAR contract?

  node dist/bin.js <account.near>

Exit codes:
  0  readable source exists (a link that resolves, or a SourceScan record matching
     the deployed code)
  1  no readable source: nothing published, a dead or placeholder link, or only a
     SourceScan record for code that has since been replaced
  2  not a contract
  3  lookup failed`);
  return EXIT.failed;
}

async function main(): Promise<number> {
  const accountId = process.argv[2];
  if (!accountId || accountId.startsWith("-")) return usage();

  const result = await checkContract(accountId);
  const lines = renderCheck(result, paint);
  (result.kind === "failed" ? console.error : console.log)(lines.join("\n"));
  return exitCodeFor(result);
}

/**
 * Set exitCode and let node unwind naturally. Calling process.exit() here races sockets
 * that are still closing, which on Windows aborts with a libuv assertion and returns 127
 * — destroying the exit code this tool exists to provide.
 */
process.exitCode = await main();
