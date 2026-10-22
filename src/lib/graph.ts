import { type ApiHost, apiUrl } from "./config";

export class GraphError extends Error {
  status: number;
  code?: number;
  subcode?: number;
  fbtraceId?: string;
  /** True for "you hit the hourly cap" — worth backing off rather than retrying. */
  rateLimited: boolean;

  constructor(
    message: string,
    opts: { status: number; code?: number; subcode?: number; fbtraceId?: string },
  ) {
    super(message);
    this.name = "GraphError";
    this.status = opts.status;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.fbtraceId = opts.fbtraceId;
    // 4 = app-level throttle, 17 = user-level, 32 = page-level, 613 = custom cap.
    this.rateLimited = [4, 17, 32, 613].includes(opts.code ?? -1);
  }
}

type Params = Record<string, string | number | undefined>;

interface Paged<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

async function request<T>(
  endpoint: string,
  params: Params,
  token: string,
  host: ApiHost,
): Promise<T> {
  const url = new URL(apiUrl(host, endpoint));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  // The OAuth token-exchange endpoints authenticate with app id/secret instead.
  if (token) url.searchParams.set("access_token", token);

  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message: string; code?: number; error_subcode?: number; fbtrace_id?: string } })
    | null;

  if (!res.ok || body?.error) {
    const e = body?.error;
    throw new GraphError(e?.message || `Graph API ответил ${res.status}`, {
      status: res.status,
      code: e?.code,
      subcode: e?.error_subcode,
      fbtraceId: e?.fbtrace_id,
    });
  }
  if (!body) throw new GraphError("Пустой ответ от Graph API", { status: res.status });
  return body as T;
}

export function graphGet<T>(
  endpoint: string,
  params: Params,
  token: string,
  host: ApiHost = "graph.facebook.com",
): Promise<T> {
  return request<T>(endpoint, params, token, host);
}

/**
 * Writes to the Graph API. Kept separate from `graphGet` so every call site that
 * changes something on the account is visible at a glance.
 */
export async function graphPost<T>(
  endpoint: string,
  body: Record<string, unknown>,
  token: string,
  host: ApiHost = "graph.facebook.com",
): Promise<T> {
  const res = await fetch(apiUrl(host, endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
    cache: "no-store",
  });

  const parsed = (await res.json().catch(() => null)) as
    | (T & { error?: { message: string; code?: number; error_subcode?: number; fbtrace_id?: string } })
    | null;

  if (!res.ok || parsed?.error) {
    const e = parsed?.error;
    throw new GraphError(e?.message || `Graph API ответил ${res.status}`, {
      status: res.status,
      code: e?.code,
      subcode: e?.error_subcode,
      fbtraceId: e?.fbtrace_id,
    });
  }
  if (!parsed) throw new GraphError("Пустой ответ от Graph API", { status: res.status });
  return parsed as T;
}

/**
 * Follows `paging.next` until Meta stops handing out cursors.
 * `maxItems` is a safety valve for accounts with thousands of comments.
 */
export async function graphGetAll<T>(
  endpoint: string,
  params: Params,
  token: string,
  host: ApiHost = "graph.facebook.com",
  maxItems = 10_000,
): Promise<T[]> {
  const out: T[] = [];
  let page = await request<Paged<T>>(endpoint, { limit: 100, ...params }, token, host);

  while (true) {
    out.push(...(page.data ?? []));
    const next = page.paging?.next;
    if (!next || out.length >= maxItems) break;

    // `next` is a fully-formed URL and already carries the token and cursor.
    const res = await fetch(next, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | (Paged<T> & { error?: { message: string; code?: number; fbtrace_id?: string } })
      | null;
    if (!res.ok || body?.error || !body) {
      throw new GraphError(body?.error?.message || `Graph API ответил ${res.status} при пагинации`, {
        status: res.status,
        code: body?.error?.code,
        fbtraceId: body?.error?.fbtrace_id,
      });
    }
    page = body;
  }

  return out.slice(0, maxItems);
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
