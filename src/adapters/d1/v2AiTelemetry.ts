// AI telemetry: usage and per-call logs (v2_ai_usage, v2_ai_calls), error events
// (v2_error_events), and the AI response cache (v2_ai_cache).
import type { AiKind, AiProvider, AiUsageDoc } from "../../types";
import { nowIso, type DB } from "./shared";

/** Prepared-statement builder so the AI orchestrator can flush all per-attempt telemetry
 * in ONE db.batch round-trip instead of awaiting two INSERTs per provider attempt. */
export function aiUsageStmt(db: DB, u: Omit<AiUsageDoc, "ts">): D1PreparedStatement {
  return db
    .prepare("INSERT INTO v2_ai_usage (accountId, provider, kind, model, ok, date, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(u.userId ?? null, u.provider, u.kind, u.model, u.ok ? 1 : 0, u.date, nowIso());
}

export async function aiUsageSince(
  db: DB,
  sinceIso: string,
): Promise<{ provider: string; kind: string; ok: boolean }[]> {
  const r = await db
    .prepare("SELECT provider, kind, ok FROM v2_ai_usage WHERE createdAt >= ?")
    .bind(sinceIso)
    .all<{ provider: string; kind: string; ok: number }>();
  return (r.results ?? []).map((x) => ({ provider: x.provider, kind: x.kind, ok: !!x.ok }));
}

/** Bounded AI/error summary for one daily_metrics rollup day (roadmap item 4) — the *Since
 * variants above are open-ended (through now), which is wrong for backfilling a past day. */
export async function aiAndErrorStatsBetween(db: DB, fromIso: string, toExclusiveIso: string): Promise<{ aiCalls: number; aiFallbacks: number; errors: number }> {
  const [usage, fallbacks, errors] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS c FROM v2_ai_usage WHERE createdAt >= ? AND createdAt < ?").bind(fromIso, toExclusiveIso).first<{ c: number }>(),
    db.prepare("SELECT COALESCE(SUM(wasFallback), 0) AS c FROM v2_ai_calls WHERE createdAt >= ? AND createdAt < ?").bind(fromIso, toExclusiveIso).first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM v2_error_events WHERE createdAt >= ? AND createdAt < ?").bind(fromIso, toExclusiveIso).first<{ c: number }>(),
  ]);
  return { aiCalls: usage?.c ?? 0, aiFallbacks: fallbacks?.c ?? 0, errors: errors?.c ?? 0 };
}

// ---------- ai call logs (per-attempt telemetry) ----------

/** Prepared-statement builder — see aiUsageStmt. */
export function aiCallStmt(
  db: DB,
  c: { userId?: number; provider: AiProvider; kind: AiKind; latencyMs: number; tokens?: number; wasFallback: boolean },
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO v2_ai_calls (accountId, provider, kind, latencyMs, tokens, wasFallback, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(c.userId ?? null, c.provider, c.kind, Math.round(c.latencyMs), c.tokens ?? null, c.wasFallback ? 1 : 0, nowIso());
}

export async function aiCallStatsSince(
  db: DB,
  sinceIso: string,
): Promise<{ provider: string; calls: number; fallbacks: number; avgLatencyMs: number; tokens: number }[]> {
  const r = await db
    .prepare(
      `SELECT provider,
              COUNT(*) AS calls,
              SUM(wasFallback) AS fallbacks,
              AVG(latencyMs) AS avgLatency,
              COALESCE(SUM(tokens), 0) AS tokens
       FROM v2_ai_calls WHERE createdAt >= ? GROUP BY provider`,
    )
    .bind(sinceIso)
    .all<{ provider: string; calls: number; fallbacks: number; avgLatency: number; tokens: number }>();
  return (r.results ?? []).map((x) => ({
    provider: x.provider,
    calls: x.calls,
    fallbacks: x.fallbacks ?? 0,
    avgLatencyMs: Math.round(x.avgLatency ?? 0),
    tokens: x.tokens ?? 0,
  }));
}

/** Count of provider ATTEMPTS (not logical calls — a single fallback chain writes one row per
 * provider tried) by one user since `sinceIso`. Used for the per-user AI rate limit — counting
 * attempts rather than top-level calls is deliberate: a user's request that falls back through
 * 3 providers really did burn 3 providers' worth of shared quota, which is exactly what the
 * limit exists to protect. */
export async function aiAttemptCountForUserSince(db: DB, userId: number, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_ai_calls WHERE accountId = ? AND createdAt >= ?")
    .bind(userId, sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

/** Same rollup as aiCallStatsSince, grouped by task (AiKind) instead of provider — surfaces
 * which KIND of call is actually driving token spend (e.g. a runaway prompt in one flow),
 * which the provider-only breakdown above can't show. */
export async function aiTokensByKindSince(
  db: DB,
  sinceIso: string,
): Promise<{ kind: string; calls: number; tokens: number }[]> {
  const r = await db
    .prepare(
      `SELECT kind, COUNT(*) AS calls, COALESCE(SUM(tokens), 0) AS tokens
       FROM v2_ai_calls WHERE createdAt >= ? GROUP BY kind ORDER BY tokens DESC`,
    )
    .bind(sinceIso)
    .all<{ kind: string; calls: number; tokens: number }>();
  return (r.results ?? []).map((x) => ({ kind: x.kind, calls: x.calls, tokens: x.tokens ?? 0 }));
}

// ---------- error logs (AI failures for the owner report) ----------

export async function recordError(
  db: DB,
  e: { userId?: number; kind: string; errorType: string; message?: string },
): Promise<void> {
  // 500 (was 200) to leave room for the AI orchestrator's per-attempt trail (provider:reason for
  // every provider tried, not just the last one) — the owner report's own display already
  // slices this down to 80 chars, so a longer stored message only helps someone querying
  // v2_error_events directly to debug a "why did the whole chain fail" incident.
  await db
    .prepare("INSERT INTO v2_error_events (accountId, kind, errorType, message, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(e.userId ?? null, e.kind, e.errorType, e.message?.slice(0, 500) ?? null, nowIso())
    .run();
}

export async function errorStatsSince(
  db: DB,
  sinceIso: string,
): Promise<{ kind: string; errorType: string; n: number }[]> {
  const r = await db
    .prepare("SELECT kind, errorType, COUNT(*) AS n FROM v2_error_events WHERE createdAt >= ? GROUP BY kind, errorType ORDER BY n DESC")
    .bind(sinceIso)
    .all<{ kind: string; errorType: string; n: number }>();
  return (r.results ?? []).map((x) => ({ kind: x.kind, errorType: x.errorType, n: x.n }));
}

export async function recentErrors(
  db: DB,
  sinceIso: string,
  limit = 6,
): Promise<{ kind: string; errorType: string; message: string | null; ts: string }[]> {
  const r = await db
    .prepare("SELECT kind, errorType, message, createdAt AS ts FROM v2_error_events WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT ?")
    .bind(sinceIso, limit)
    .all<{ kind: string; errorType: string; message: string | null; ts: string }>();
  return r.results ?? [];
}

export async function getAiCache(db: DB, key: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT response FROM v2_ai_cache WHERE key = ? AND expiresAt > ?")
    .bind(key, nowIso())
    .first<{ response: string }>();
  return r?.response ?? null;
}

/** Prepared-statement builder so the orchestrator can piggyback the cache write onto its
 * one-batch telemetry flush (no extra round trip). */
export function aiCacheStmt(db: DB, key: string, response: string, ttlMs: number): D1PreparedStatement {
  return db
    .prepare("INSERT OR REPLACE INTO v2_ai_cache (key, response, expiresAt) VALUES (?, ?, ?)")
    .bind(key, response, new Date(Date.now() + ttlMs).toISOString());
}

export async function pruneAiCache(db: DB): Promise<void> {
  await db.prepare("DELETE FROM v2_ai_cache WHERE expiresAt <= ?").bind(nowIso()).run();
}

// ---------- rest timers (one pending nudge per user, delivered by the minute cron) ----------
