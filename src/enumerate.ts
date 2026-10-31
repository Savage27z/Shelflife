/**
 * Builds the target set from an indexer instead of by hand.
 *
 * No NEAR RPC method lists every contract on the chain, so a true census is not
 * available. What *is* enumerable is the token contracts — NearBlocks indexes every
 * NEP-141 fungible token and NEP-171 NFT contract. That is a few thousand real
 * contracts with real users, which is a far better denominator than a hand-picked list
 * and, crucially, one nobody can accuse of being cherry-picked.
 *
 * Free, no API key required.
 */

const BASE = "https://api.nearblocks.io/v1";

export type TokenKind = "ft" | "nft";

export interface TokenContract {
  contract: string;
  name?: string;
  symbol?: string;
  kind: TokenKind;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pause between pages. The keyless tier is tight, so this is deliberately slow. */
const PAGE_DELAY_MS = 1_500;

async function get(path: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });

  // Free tier is rate limited and this is a public service someone else pays for.
  // Back off generously rather than hammering it.
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`nearblocks ${res.status} after retries: ${path}`);
    await sleep(5_000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`nearblocks ${res.status}: ${path}`);
  return res.json();
}

/** Total number of indexed contracts of a kind. */
export async function countTokens(kind: TokenKind): Promise<number> {
  const body = (await get(`/${kind}s/count`)) as { tokens?: Array<{ count?: string }> };
  return Number(body.tokens?.[0]?.count ?? 0);
}

export interface ListResult {
  tokens: TokenContract[];
  /** True when the indexer cut us off before `max` was reached. */
  truncated: boolean;
}

/**
 * Page through the token list. `max` bounds the work: the full set is a few thousand
 * and each contract later costs one RPC call, so the caller decides how much to take.
 *
 * Rate limiting is expected, not exceptional. When the indexer stops serving us we
 * keep what we have and report it as truncated — a smaller honest sample beats a
 * crash, and the caller records which it got.
 */
export async function listTokens(
  kind: TokenKind,
  max: number,
  onPage?: (fetched: number, total: number) => void,
): Promise<ListResult> {
  const total = Math.min(await countTokens(kind), max);
  const perPage = 50;
  const out: TokenContract[] = [];

  for (let page = 1; out.length < total; page++) {
    let tokens: Array<{ contract?: string; name?: string; symbol?: string }>;
    try {
      const body = (await get(`/${kind}s?per_page=${perPage}&page=${page}`)) as {
        tokens?: typeof tokens;
      };
      tokens = body.tokens ?? [];
    } catch (err) {
      process.stderr.write(`\n  indexer stopped at ${out.length} ${kind}: ${String(err)}\n`);
      return { tokens: out, truncated: true };
    }
    if (tokens.length === 0) break;

    for (const t of tokens) {
      if (!t.contract) continue;
      out.push({ contract: t.contract, name: t.name, symbol: t.symbol, kind });
      if (out.length >= total) break;
    }

    onPage?.(out.length, total);
    await sleep(PAGE_DELAY_MS);
  }

  return { tokens: out, truncated: false };
}

/** Unique contract ids across both token kinds, preserving indexer order. */
export function dedupe(lists: TokenContract[][]): TokenContract[] {
  const seen = new Set<string>();
  const out: TokenContract[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(t.contract)) continue;
      seen.add(t.contract);
      out.push(t);
    }
  }
  return out;
}
