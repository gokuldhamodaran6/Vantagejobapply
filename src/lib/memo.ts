import "server-only";

/**
 * A small in-process cache for expensive, read-only results (job searches, match counts). Identical requests running
 * at the same moment share one computation; results are reused for a few minutes. Each bucket keeps a bounded number
 * of entries (big ones, like raw searches, get a small bucket) and drops expired, then oldest, entries first.
 */
type Entry = { at: number; ttl: number; value?: unknown; pending?: Promise<unknown> };
const buckets = new Map<string, Map<string, Entry>>();

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts: { bucket?: string; max?: number } = {}): Promise<T> {
  const name = opts.bucket || "default";
  const max = opts.max ?? 300;
  let store = buckets.get(name);
  if (!store) buckets.set(name, (store = new Map()));
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.pending) return hit.pending as Promise<T>;
  if (hit && now - hit.at < hit.ttl) return hit.value as T;
  const s = store;
  const pending = fn().then(
    (value) => { s.set(key, { at: Date.now(), ttl: ttlMs, value }); return value; },
    (e) => { s.delete(key); throw e; },
  );
  store.delete(key);
  store.set(key, { at: now, ttl: ttlMs, pending });
  if (store.size > max) {
    for (const [k, e] of store) if (!e.pending && now - e.at >= e.ttl) store.delete(k);
    while (store.size > max) store.delete(store.keys().next().value as string);
  }
  return pending;
}

/** A fresh cached value, if there is one — never computes. */
export function peek<T>(key: string, bucket = "default"): T | undefined {
  const e = buckets.get(bucket)?.get(key);
  return e && !e.pending && Date.now() - e.at < e.ttl ? (e.value as T) : undefined;
}

/** A short, stable key for any JSON-able input. */
export function keyOf(...parts: unknown[]) {
  const s = JSON.stringify(parts);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}
