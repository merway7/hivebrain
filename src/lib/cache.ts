// Simple in-memory TTL cache. Per-function-instance — Vercel Fluid Compute
// reuses warm instances across requests, so cache hits are common in practice.
// Stale-while-error: if the underlying fetcher throws and we have an expired
// entry, we serve the stale value rather than propagating the error. This is
// the resilience layer for transient Turso failures (e.g. quota errors).

type Entry<T> = { value: T; expires: number; stale: number };

const store = new Map<string, Entry<any>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts?: { staleMs?: number }
): Promise<T> {
  const now = Date.now();
  const staleMs = opts?.staleMs ?? ttlMs * 6;
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit && hit.expires > now) return hit.value;

  try {
    const value = await fn();
    store.set(key, { value, expires: now + ttlMs, stale: now + staleMs });
    return value;
  } catch (err) {
    if (hit && hit.stale > now) return hit.value;
    throw err;
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidateAll(): void {
  store.clear();
}
