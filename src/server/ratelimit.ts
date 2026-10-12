import "server-only";

// Fixed-window counters in memory. One Node process serves the app (`npm start` on a single VPS), so
// this is enough; a Postgres move would put the counters in a table or Redis instead.
const g = globalThis as unknown as { __ticketstubLimits?: Map<string, { count: number; resetAt: number }> };

/** Counts one hit. Returns 0 when allowed, otherwise the seconds to wait. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): number {
  const buckets = (g.__ticketstubLimits ??= new Map());
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  if (b.count >= limit) return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  b.count++;
  return 0;
}
