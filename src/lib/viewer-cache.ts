// Module-scope SWR cache for viewer GETs. A page remount (leaving /viewer
// and returning) refetches by default; this Map lives outside React, so
// remounts restore instantly from cache and revalidate in the background.
// Bump only on actual change so grids don't flicker/re-sort mid-scroll.
type CacheEntry<T> = { data: T; ts: number };

const cache = new Map<string, CacheEntry<unknown>>();
// Single-flight: dedupes concurrent requests for the same URL.
const inflight = new Map<string, Promise<any>>();
const REVALIDATE_MS = 30_000;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

// Serve cached instantly, refresh in background when older than the
// revalidate window, fetch fresh otherwise. Never rejects (falls back to
// cached data on refresh failure); last-known-good survives offline.
export function cachedGet<T>(url: string, opts?: { fresh?: boolean }): Promise<T> {
  if (opts?.fresh) {
    // Bypass cache (e.g. the scan poll) but still single-flight and
    // update the cache with the result.
    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;
    const p = fetchJson<T>(url).then((data: T) => {
      cache.set(url, { data, ts: Date.now() });
      return data;
    });
    inflight.set(url, p);
    void p.finally(() => inflight.delete(url));
    return p;
  }
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;
  const hit = cache.get(url);
  if (hit) {
    if (Date.now() - hit.ts > REVALIDATE_MS) {
      const p = fetchJson<T>(url)
        .then((data: T) => {
          cache.set(url, { data, ts: Date.now() });
          return data;
        })
        .catch(() => hit.data as T); // refresh failed: keep serving stale
      inflight.set(url, p);
      void p.finally(() => inflight.delete(url));
    }
    return Promise.resolve(hit.data as T);
  }
  const p = fetchJson<T>(url).then((data: T) => {
    cache.set(url, { data, ts: Date.now() });
    return data;
  });
  inflight.set(url, p as Promise<unknown>);
  void p.finally(() => inflight.delete(url));
  return p;
}

// Invalidate all cached entries+media lists (e.g. after an entry save or
// media scan) so the next cachedGet refetches.
export function invalidateViewerCache() {
  cache.clear();
}

// Debug hook for tests.
export function viewerCacheSize(): number {
  return cache.size;
}
