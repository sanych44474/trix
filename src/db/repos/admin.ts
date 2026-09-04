// System/owner-level concerns: feedback inbox, AI usage + call telemetry, error logs, owner
// config + proactive-alert state, audit log, housekeeping sweeps, GDPR delete, AI response
// cache, rest-timer nudges, engagement counters, cron settings/lock, and the cross-domain report
// aggregators (loadActivityWindow, getRecentContext, dashboardExtrasBatch) that fan out across
// several other repos/*.ts files. Split out of repos.ts (god-file split, same barrel seam);
// behavior unchanged. Several functions here (engagementSince, recordPlanSource,
// countPlanSourcesSince, listUsersBrief, eventCountsByUser, pingDb) were previously filed under
// unrelated banners elsewhere in repos.ts — moved here where they actually belong.
import type {
  AiKind,
  AiProvider,
  AiUsageDoc,
  BodyLogDoc,
  DailyCheckinDoc,
  NutritionLogDoc,
  StepLogDoc,
  StrengthRecordDoc,
  UserProfile,
  WorkoutLogDoc,
} from "../../types";
import { nowIso, type DB } from "./shared";
import { bodyLogsByUser, dailyCheckinsSince, stepLogsSince, waterLogsSince } from "./tracking";
import { listStrength, workoutLogsSince } from "./workouts";
import { nutritionLogsSince } from "./nutrition";

// ---------- feedback ----------

export async function insertFeedback(
  db: DB,
  f: { userId: number; username?: string; text: string; date: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO feedback (userId, username, text, date, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(f.userId, f.username ?? null, f.text, f.date, nowIso())
    .run();
}

export async function countFeedbackSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM feedback WHERE createdAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function recentFeedback(
  db: DB,
  limit: number,
): Promise<{ userId: number; username?: string; text: string; date: string }[]> {
  const r = await db
    .prepare("SELECT userId, username, text, date FROM feedback ORDER BY createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ userId: number; username: string | null; text: string; date: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.userId,
    username: x.username ?? undefined,
    text: x.text,
    date: x.date,
  }));
}

// ---------- owner report: user listing + event counts ----------

export async function listUsersBrief(
  db: DB,
  limit?: number,
): Promise<{ id: number; name: string; username?: string; onboarded: boolean; updatedAt: string; lastSeenAt?: string; trainerId?: number; blocked: boolean; botBlocked: boolean; profile: UserProfile }[]> {
  // No limit → every user (owner report lists all). With a limit → most-recently-active first.
  const sql = "SELECT id, onboarded, profile, updatedAt, lastSeenAt, trainerId, username, blocked, botBlocked FROM users ORDER BY updatedAt DESC" + (limit ? " LIMIT ?" : "");
  const stmt = limit ? db.prepare(sql).bind(limit) : db.prepare(sql);
  const r = await stmt
    .all<{ id: number; onboarded: number; profile: string; updatedAt: string; lastSeenAt: string | null; trainerId: number | null; username: string | null; blocked: number | null; botBlocked: number | null }>();
  return (r.results ?? []).map((x) => {
    let profile: UserProfile = {};
    try {
      profile = JSON.parse(x.profile) as UserProfile;
    } catch {
      /* ignore */
    }
    return { id: x.id, name: profile.name || "", username: x.username ?? undefined, onboarded: !!x.onboarded, updatedAt: x.updatedAt, lastSeenAt: x.lastSeenAt ?? undefined, trainerId: x.trainerId ?? undefined, blocked: !!x.blocked, botBlocked: !!x.botBlocked, profile };
  });
}

/** All-time logged-event counts per user (workouts, check-ins, nutrition logs, step logs).
 * Four GROUP BY queries total — independent of user count — for the owner report. */
export async function eventCountsByUser(
  db: DB,
): Promise<Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>> {
  const q = (sql: string) => db.prepare(sql).all<{ userId: number; c: number }>();
  const [w, c, n, s] = await Promise.all([
    // Completed only — a skip writes a workout_logs row with completed=0 and must NOT count as a workout.
    q("SELECT userId, COUNT(*) AS c FROM workout_logs WHERE completed = 1 GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM daily_checkins GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM nutrition_logs GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM step_logs GROUP BY userId"),
  ]);
  const map = new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>();
  const get = (id: number) => {
    let e = map.get(id);
    if (!e) { e = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 }; map.set(id, e); }
    return e;
  };
  for (const r of w.results ?? []) get(r.userId).workouts = r.c;
  for (const r of c.results ?? []) get(r.userId).checkins = r.c;
  for (const r of n.results ?? []) get(r.userId).nutrition = r.c;
  for (const r of s.results ?? []) get(r.userId).steps = r.c;
  return map;
}

/** Engagement counts since a cutoff date (YYYY-MM-DD) for the owner report's product-pulse KPIs. */
export async function engagementSince(db: DB, cutoffDate: string): Promise<{ workouts: number; completed: number; checkins: number; nutrition: number }> {
  const one = async (sql: string) => (await db.prepare(sql).bind(cutoffDate).first<{ c: number }>())?.c ?? 0;
  const [workouts, completed, checkins, nutrition] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ? AND completed = 1"),
    one("SELECT COUNT(*) AS c FROM daily_checkins WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM nutrition_logs WHERE date >= ?"),
  ]);
  return { workouts, completed, checkins, nutrition };
}

/** Total weekly-progression rows since `cutoff` (ISO) — how many silent micro-adjustments fired. */
export async function countAdjustmentsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM plan_adjustments WHERE ts >= ?").bind(cutoff).first<{ c: number }>();
  return r?.c ?? 0;
}

/** Telemetry: record how a plan/meal was served, or a progression transition. `kind` is
 * 'workout' | 'meal' | 'level_up' | 'goal_switch' | 'plateau_swap'. Best-effort. */
export async function recordPlanSource(db: DB, userId: number, kind: string, source: "bank" | "template" | "ai"): Promise<void> {
  await db
    .prepare("INSERT INTO plan_source_logs (userId, kind, source, ts) VALUES (?, ?, ?, ?)")
    .bind(userId, kind, source, nowIso())
    .run();
}

/** Counts of plan sources since `cutoff` (ISO), for the owner report / Gemini-offload check. */
export async function countPlanSourcesSince(db: DB, cutoff: string): Promise<{ kind: string; source: string; c: number }[]> {
  try {
    const r = await db
      .prepare("SELECT kind, source, COUNT(*) AS c FROM plan_source_logs WHERE ts >= ? GROUP BY kind, source")
      .bind(cutoff)
      .all<{ kind: string; source: string; c: number }>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ---------- ai usage ----------

/** Prepared-statement builder so the AI orchestrator can flush all per-attempt telemetry
 * in ONE db.batch round-trip instead of awaiting two INSERTs per provider attempt. */
export function aiUsageStmt(db: DB, u: Omit<AiUsageDoc, "ts">): D1PreparedStatement {
  return db
    .prepare("INSERT INTO ai_usage (userId, provider, kind, model, ok, date, ts) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(u.userId ?? null, u.provider, u.kind, u.model, u.ok ? 1 : 0, u.date, nowIso());
}

export async function aiUsageSince(
  db: DB,
  sinceIso: string,
): Promise<{ provider: string; kind: string; ok: boolean }[]> {
  const r = await db
    .prepare("SELECT provider, kind, ok FROM ai_usage WHERE ts >= ?")
    .bind(sinceIso)
    .all<{ provider: string; kind: string; ok: number }>();
  return (r.results ?? []).map((x) => ({ provider: x.provider, kind: x.kind, ok: !!x.ok }));
}

// ---------- ai call logs (per-attempt telemetry) ----------

/** Prepared-statement builder — see aiUsageStmt. */
export function aiCallStmt(
  db: DB,
  c: { userId?: number; provider: AiProvider; kind: AiKind; latencyMs: number; tokens?: number; wasFallback: boolean },
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO ai_call_logs (userId, provider, kind, latency_ms, tokens, was_fallback, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
              SUM(was_fallback) AS fallbacks,
              AVG(latency_ms) AS avgLatency,
              COALESCE(SUM(tokens), 0) AS tokens
       FROM ai_call_logs WHERE ts >= ? GROUP BY provider`,
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

// ---------- error logs (AI failures for the owner report) ----------

export async function recordError(
  db: DB,
  e: { userId?: number; kind: string; errorType: string; message?: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO error_logs (userId, kind, errorType, message, ts) VALUES (?, ?, ?, ?, ?)")
    .bind(e.userId ?? null, e.kind, e.errorType, e.message?.slice(0, 200) ?? null, nowIso())
    .run();
}

export async function errorStatsSince(
  db: DB,
  sinceIso: string,
): Promise<{ kind: string; errorType: string; n: number }[]> {
  const r = await db
    .prepare("SELECT kind, errorType, COUNT(*) AS n FROM error_logs WHERE ts >= ? GROUP BY kind, errorType ORDER BY n DESC")
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
    .prepare("SELECT kind, errorType, message, ts FROM error_logs WHERE ts >= ? ORDER BY ts DESC LIMIT ?")
    .bind(sinceIso, limit)
    .all<{ kind: string; errorType: string; message: string | null; ts: string }>();
  return r.results ?? [];
}

/** All of a user's logged activity since `cutoff`, fetched in ONE parallel round-trip. Report
 * (`cmdReport`) and export (`buildExportMd`) built the identical 6-7 read fan-out separately —
 * this collapses that duplication so a new logged metric is added in exactly one place. */
export interface ActivitySnapshot {
  workouts: WorkoutLogDoc[];
  nutrition: NutritionLogDoc[];
  strength: StrengthRecordDoc[];
  body: BodyLogDoc[];
  steps: StepLogDoc[];
  water: { date: string; ml: number }[];
  checkins: DailyCheckinDoc[];
}
export async function loadActivityWindow(
  db: DB,
  userId: number,
  cutoff: string,
  opts: { strengthLimit?: number } = {},
): Promise<ActivitySnapshot> {
  const [workouts, nutrition, strength, body, steps, water, checkins] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
    listStrength(db, userId, opts.strengthLimit),
    bodyLogsByUser(db, userId),
    stepLogsSince(db, userId, cutoff),
    waterLogsSince(db, userId, cutoff),
    dailyCheckinsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition, strength, body, steps, water, checkins };
}

// ---------- combined recent context (for the data-grounded coach) ----------

export async function getRecentContext(
  db: DB,
  userId: number,
  days = 7,
): Promise<{ workouts: WorkoutLogDoc[]; nutrition: NutritionLogDoc[] }> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [workouts, nutrition] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition };
}

// ---------- config / owner ----------

export async function getOwnerChatId(db: DB): Promise<number | undefined> {
  const r = await db
    .prepare("SELECT ownerChatId FROM config WHERE id = 'config'")
    .first<{ ownerChatId: number | null }>();
  return r?.ownerChatId ?? undefined;
}

export async function setOwnerChatId(db: DB, chatId: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO config (id, ownerChatId) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET ownerChatId = excluded.ownerChatId",
    )
    .bind(chatId)
    .run();
}

// Owner-alert dedup state ({ "<alertKey>": "<iso>" }) — throttles proactive alerts.
export async function getAlertState(db: DB): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT alertState FROM config WHERE id = 'config'").first<{ alertState: string | null }>();
  if (!r?.alertState) return {};
  try { return JSON.parse(r.alertState) as Record<string, string>; } catch { return {}; }
}

export async function setAlertState(db: DB, state: Record<string, string>): Promise<void> {
  await db
    .prepare("INSERT INTO config (id, alertState) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET alertState = excluded.alertState")
    .bind(JSON.stringify(state))
    .run();
}

// ---------- admin audit log + client flag ----------

export async function recordAudit(db: DB, actorId: number, action: string, targetId?: number, detail?: string): Promise<void> {
  await db
    .prepare("INSERT INTO admin_audit (ts, actorId, action, targetId, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(nowIso(), actorId, action, targetId ?? null, detail?.slice(0, 200) ?? null)
    .run();
}

export async function recentAudit(db: DB, limit = 10): Promise<{ ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }[]> {
  const r = await db
    .prepare("SELECT ts, actorId, action, targetId, detail FROM admin_audit ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<{ ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }>();
  return r.results ?? [];
}

export async function setUserFlag(db: DB, userId: number, flagged: boolean): Promise<void> {
  await db.prepare("UPDATE users SET flagged = ? WHERE id = ?").bind(flagged ? 1 : 0, userId).run();
}

// ---------- dedup / housekeeping ----------

export async function markUpdateSeen(db: DB, updateId: number): Promise<boolean> {
  try {
    const r = await db
      .prepare("INSERT OR IGNORE INTO seen_updates (id, createdAt) VALUES (?, ?)")
      .bind(updateId, nowIso())
      .run();
    return (r.meta?.changes ?? 0) > 0; // 0 changes → duplicate
  } catch (err) {
    console.error("markUpdateSeen error (processing anyway)", err);
    return true;
  }
}

export async function pruneSeenUpdates(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM seen_updates WHERE createdAt < ?").bind(beforeIso).run();
}

// Telemetry tables grow unbounded (every AI call / error / button tap writes a row); D1 free
// tier caps the DB at 5 GB. Weekly sweep drops rows older than the retention window.
export async function pruneOldLogs(db: DB, beforeIso: string, beforeDay: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM ai_call_logs WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM error_logs WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM ai_usage WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM event_counts WHERE day < ?").bind(beforeDay),
  ]);
}

// ---------- delete / health ----------

export async function deleteUserData(db: DB, userId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    db.prepare("DELETE FROM plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM workout_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM nutrition_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM strength_records WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM body_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM step_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM progress_photos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM water_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM challenges WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM injuries WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM client_notes WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_cards WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM daily_checkins WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_adjustments WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM achievements WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM meal_plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM user_exercise_videos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM event_counts WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM feedback WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM trainers WHERE trainerId = ?").bind(userId),
    db.prepare("DELETE FROM client_requests WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_questions WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM messages WHERE fromId = ? OR toId = ?").bind(userId, userId),
    // Per-user telemetry — /deleteme means ALL personal rows, not just product data.
    // (admin_audit is intentionally kept: it's the owner's action trail, not user data.)
    db.prepare("DELETE FROM ai_usage WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM ai_call_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM error_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_source_logs WHERE userId = ?").bind(userId),
  ]);
}

export async function pingDb(db: DB): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return r?.ok === 1;
}

// ---------- AI response cache (identical prompts skip the provider chain) ----------

export async function getAiCache(db: DB, key: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT response FROM ai_cache WHERE key = ? AND expiresAt > ?")
    .bind(key, nowIso())
    .first<{ response: string }>();
  return r?.response ?? null;
}

/** Prepared-statement builder so the orchestrator can piggyback the cache write onto its
 * one-batch telemetry flush (no extra round trip). */
export function aiCacheStmt(db: DB, key: string, response: string, ttlMs: number): D1PreparedStatement {
  return db
    .prepare("INSERT OR REPLACE INTO ai_cache (key, response, expiresAt) VALUES (?, ?, ?)")
    .bind(key, response, new Date(Date.now() + ttlMs).toISOString());
}

export async function pruneAiCache(db: DB): Promise<void> {
  await db.prepare("DELETE FROM ai_cache WHERE expiresAt <= ?").bind(nowIso()).run();
}

// ---------- rest timers (one pending nudge per user, delivered by the minute cron) ----------

export async function setRestTimer(db: DB, userId: number, chatId: number, dueAtIso: string, lang: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rest_timers (userId, chatId, dueAt, lang) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET chatId = excluded.chatId, dueAt = excluded.dueAt, lang = excluded.lang`,
    )
    .bind(userId, chatId, dueAtIso, lang)
    .run();
}

export async function dueRestTimers(db: DB, nowIsoStr: string, limit = 20): Promise<{ userId: number; chatId: number; lang: string }[]> {
  const r = await db
    .prepare("SELECT userId, chatId, lang FROM rest_timers WHERE dueAt <= ? LIMIT ?")
    .bind(nowIsoStr, limit)
    .all<{ userId: number; chatId: number; lang: string }>();
  return r.results ?? [];
}

export async function deleteRestTimers(db: DB, userIds: number[]): Promise<void> {
  if (!userIds.length) return;
  await db
    .prepare(`DELETE FROM rest_timers WHERE userId IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds)
    .run();
}

// ---------- engagement: activity signal + usage counters ----------

export async function setLastSeen(db: DB, userId: number, iso: string): Promise<void> {
  await db.prepare("UPDATE users SET lastSeenAt = ? WHERE id = ?").bind(iso, userId).run();
}

export async function bumpEvent(db: DB, userId: number, event: string, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_counts (userId, event, day, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(userId, event, day) DO UPDATE SET n = n + 1`,
    )
    .bind(userId, event, day)
    .run();
}

export async function eventStatsSince(db: DB, sinceDay: string, limit = 20): Promise<{ event: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, SUM(n) AS n FROM event_counts WHERE day >= ? GROUP BY event ORDER BY n DESC LIMIT ?")
    .bind(sinceDay, limit)
    .all<{ event: string; n: number }>();
  return r.results ?? [];
}

/** One user's all-time activity counts — feeds the XP/level math (domain/gamification). */
export async function userStatCounts(
  db: DB,
  userId: number,
): Promise<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }> {
  const r = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM workout_logs WHERE userId = ?1 AND completed = 1) AS workouts,
        (SELECT COUNT(*) FROM nutrition_logs WHERE userId = ?1) AS nutrition,
        (SELECT COUNT(*) FROM daily_checkins WHERE userId = ?1) AS checkins,
        (SELECT COUNT(*) FROM step_logs WHERE userId = ?1) AS steps,
        (SELECT COUNT(*) FROM achievements WHERE userId = ?1) AS badges`,
    )
    .bind(userId)
    .first<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }>();
  return r ?? { workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 };
}

/** Distinct active users per day (from usage counters) — owner dashboard DAU chart. */
export async function dailyActiveUsers(db: DB, sinceDay: string): Promise<{ date: string; n: number }[]> {
  const r = await db
    .prepare("SELECT day AS date, COUNT(DISTINCT userId) AS n FROM event_counts WHERE day >= ? GROUP BY day ORDER BY day ASC")
    .bind(sinceDay)
    .all<{ date: string; n: number }>();
  return r.results ?? [];
}

/** One user's recent usage counters, newest first — owner per-user event timeline. */
export async function recentEventsForUser(db: DB, userId: number, limit = 30): Promise<{ event: string; day: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, day, n FROM event_counts WHERE userId = ? ORDER BY day DESC, n DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ event: string; day: string; n: number }>();
  return r.results ?? [];
}

// ── Settings (key-value store for one-time flags / scheduled tasks) ───────────
export async function getSetting(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: DB, key: string): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}

// Cron mutual-exclusion: the scheduled handler runs in waitUntil (detached), so a heavy run can
// outlive its minute and the next cron starts a SECOND concurrent run → both read the same
// un-flushed reminder dedup and send the SAME message twice (the "identical messages" spam).
// A fresh lock (< ttl) means another run is active → skip this tick. Stale lock (crashed run) expires.
export async function acquireScheduleLock(db: DB, nowMs: number, ttlMs: number): Promise<boolean> {
  const cur = await getSetting(db, "schedule_lock");
  const ts = cur ? Number(cur) : 0;
  if (ts && nowMs - ts < ttlMs) return false;
  await setSetting(db, "schedule_lock", String(nowMs));
  return true;
}

export async function releaseScheduleLock(db: DB): Promise<void> {
  await setSetting(db, "schedule_lock", "0");
}

/** Dashboard extras in ONE D1 roundtrip (db.batch): all-time stat counts, earned badge codes,
 * today's water total and steps. Four separate queries collapsed on the hot /api/dashboard
 * path — same rows read, one network round-trip and three fewer subrequests. */
export async function dashboardExtrasBatch(
  db: DB,
  userId: number,
  today: string,
): Promise<{
  statCounts: { workouts: number; nutrition: number; checkins: number; steps: number; badges: number };
  achievements: string[];
  waterMl: number;
  steps: number;
}> {
  const [counts, ach, water, step] = await db.batch([
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM workout_logs WHERE userId = ?1 AND completed = 1) AS workouts,
          (SELECT COUNT(*) FROM nutrition_logs WHERE userId = ?1) AS nutrition,
          (SELECT COUNT(*) FROM daily_checkins WHERE userId = ?1) AS checkins,
          (SELECT COUNT(*) FROM step_logs WHERE userId = ?1) AS steps,
          (SELECT COUNT(*) FROM achievements WHERE userId = ?1) AS badges`,
      )
      .bind(userId),
    db.prepare("SELECT code FROM achievements WHERE userId = ? ORDER BY earnedAt ASC").bind(userId),
    db.prepare("SELECT ml FROM water_logs WHERE userId = ? AND date = ?").bind(userId, today),
    db.prepare("SELECT steps FROM step_logs WHERE userId = ? AND date = ?").bind(userId, today),
  ]);
  const c = (counts.results?.[0] ?? {}) as Partial<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }>;
  return {
    statCounts: {
      workouts: c.workouts ?? 0,
      nutrition: c.nutrition ?? 0,
      checkins: c.checkins ?? 0,
      steps: c.steps ?? 0,
      badges: c.badges ?? 0,
    },
    achievements: ((ach.results ?? []) as { code: string }[]).map((x) => x.code),
    waterMl: ((water.results?.[0] as { ml?: number } | undefined)?.ml) ?? 0,
    steps: ((step.results?.[0] as { steps?: number } | undefined)?.steps) ?? 0,
  };
}
