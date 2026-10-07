/**
 * One fetch layer for every data source: in-memory + Cache Storage with a time-to-live,
 * request de-duplication, timeouts, cancellation and mirror fallback.
 */
const mem = new Map<string, { t: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const CACHE_NAME = 'ff-data-v1';

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${new URL(url).host}`);
  }
}

async function fromCacheStorage(url: string, ttlMs: number): Promise<unknown | undefined> {
  try {
    if (typeof caches === 'undefined') return undefined;
    const c = await caches.open(CACHE_NAME);
    const r = await c.match(url);
    if (!r) return undefined;
    const t = Number(r.headers.get('x-ff-time') || 0);
    if (Date.now() - t > ttlMs) return undefined;
    return await r.json();
  } catch {
    return undefined;
  }
}

async function toCacheStorage(url: string, data: unknown): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE_NAME);
    await c.put(url, new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json', 'x-ff-time': String(Date.now()) },
    }));
  } catch {
    /* storage full or unavailable: memory cache still works */
  }
}

export interface FetchOpts {
  ttlMs: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function fetchJson<T>(urls: string | string[], opts: FetchOpts): Promise<T> {
  const list = Array.isArray(urls) ? urls : [urls];
  const key = list[0];
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < opts.ttlMs) return hit.data as T;
  const stored = await fromCacheStorage(key, opts.ttlMs);
  if (stored !== undefined) {
    mem.set(key, { t: Date.now(), data: stored });
    return stored as T;
  }
  if (!opts.signal && inflight.has(key)) return inflight.get(key) as Promise<T>;

  const run = (async () => {
    let lastErr: unknown;
    for (const url of list) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (!r.ok) throw new HttpError(r.status, url);
        const data = await r.json();
        mem.set(key, { t: Date.now(), data });
        void toCacheStorage(key, data);
        return data as T;
      } catch (e) {
        lastErr = e;
        if (opts.signal?.aborted) throw e;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr;
  })();
  if (!opts.signal) {
    inflight.set(key, run);
    run.finally(() => inflight.delete(key)).catch(() => {});
  }
  return run;
}

export function clearMemoryCache(): void {
  mem.clear();
}
