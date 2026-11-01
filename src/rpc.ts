/**
 * Minimal NEAR JSON-RPC client.
 *
 * Deliberately dependency-free: the whole point of this project is that a judge can
 * clone it and get the same answers, so the fewer moving parts between the reader and
 * the chain, the better.
 */

/** An account with no contract deployed reports this code hash (32 zero bytes, base58). */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111";

/** Public endpoints, tried in order. All free, all rate limited. */
const ENDPOINTS = [
  "https://rpc.mainnet.near.org",
  "https://free.rpc.fastnear.com",
];

export class RpcError extends Error {
  constructor(
    message: string,
    readonly name_: string | undefined,
    readonly raw: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

let endpointIndex = 0;

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string; data?: unknown; cause?: { name?: string; info?: unknown } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON-RPC call, with retries. Rotates endpoints on transport failure or rate
 * limiting; a legitimate protocol error (missing account, missing method) is returned
 * to the caller rather than retried, because it is an answer, not a failure.
 */
export async function rpc<T>(method: string, params: unknown, attempt = 0): Promise<T> {
  const url = ENDPOINTS[endpointIndex % ENDPOINTS.length]!;
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "shelflife", method, params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    if (attempt >= 4) throw new RpcError(`transport failure after retries: ${String(cause)}`, undefined, cause);
    endpointIndex++;
    await sleep(400 * 2 ** attempt);
    return rpc<T>(method, params, attempt + 1);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new RpcError(`http ${res.status} after retries`, undefined, null);
    endpointIndex++;
    await sleep(600 * 2 ** attempt);
    return rpc<T>(method, params, attempt + 1);
  }

  const body = (await res.json()) as JsonRpcResponse<T>;

  if (body.error) {
    const name = body.error.cause?.name;
    const message = body.error.message ?? "unknown rpc error";
    throw new RpcError(`${name ?? "error"}: ${message}`, name, body.error);
  }

  if (body.result === undefined) throw new RpcError("empty rpc result", undefined, body);
  return body.result;
}

export interface AccountView {
  amount: string;
  code_hash: string;
  storage_usage: number;
}

export async function viewAccount(accountId: string): Promise<AccountView> {
  return rpc<AccountView>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
}

/**
 * Raw result of a view call: NEAR returns the return value as a byte array.
 *
 * Careful: a failed contract call does NOT arrive as a JSON-RPC error. The request
 * succeeds with HTTP 200 and the failure is a string inside `result.error`, e.g.
 * "wasm execution failed with error: MethodResolveError(MethodNotFound)". Miss that
 * and every contract without the method looks like an infrastructure failure.
 */
export async function callFunction(
  accountId: string,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const res = await rpc<{ result?: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });

  if (res.error) throw new RpcError(res.error, "CONTRACT_EXECUTION_ERROR", res);
  if (!res.result) throw new RpcError("view call returned no value", undefined, res);

  return Buffer.from(res.result).toString("utf8");
}

/** True when the RPC error means "this account has never existed". */
export function isMissingAccount(err: unknown): boolean {
  if (!(err instanceof RpcError)) return false;
  return err.name_ === "UNKNOWN_ACCOUNT" || /does not exist/i.test(err.message);
}

/** True when the RPC error means "the contract has no such method". */
export function isMissingMethod(err: unknown): boolean {
  if (!(err instanceof RpcError)) return false;
  return /MethodNotFound|MethodResolveError/i.test(JSON.stringify(err.raw ?? err.message));
}
