import "server-only";

/**
 * A small in-process cache for expensive, read-only results (job searches, match counts). Identical requests running
 * at the same moment share one computation; results are reused for a few minutes. Entries are dropped oldest-first.
 */
type Entry = { at: number; ttl: number; value?: unknown; pending?: Promise<unknown> };
const store = new Map<string, Entry>();
const MAX = 300;

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.pending) return hit.pending as Promise<T>;
  if (hit && now - hit.at < hit.ttl) return hit.value as T;
  const pending = fn().then(
    (value) => { store.set(key, { at: Date.now(), ttl: ttlMs, value }); return value; },
    (e) => { store.delete(key); throw e; },
  );
  store.set(key, { at: now, ttl: ttlMs, pending });
  if (store.size > MAX) store.delete(store.keys().next().value as string);
  return pending;
}

/** A short, stable key for any JSON-able input. */
export function keyOf(...parts: unknown[]) {
  const s = JSON.stringify(parts);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}
