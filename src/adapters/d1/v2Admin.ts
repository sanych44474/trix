// Feedback, AI telemetry and engagement analytics moved to v2Feedback.ts, v2AiTelemetry.ts and
// v2Analytics.ts (re-exported below, so older imports keep working). What stays here: owner config
// and alert state, audit log, moderation flag, housekeeping sweeps, rest-timer nudges, settings,
// the cron lock and dashboardExtrasBatch.
// v2-native owner/admin repo (Domain 9 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of MOST of
// src/db/repos/admin.ts: feedback inbox, event counts/analytics, AI usage/call telemetry, error
// logs, owner config + proactive-alert state, audit log, moderation flag, housekeeping sweeps,
// AI response cache, rest-timer nudges, engagement counters, cron settings/lock, and the
// cross-domain report aggregators (loadActivityWindow, getRecentContext, dashboardExtrasBatch).
// Same exported names/signatures throughout, so a call site switches by changing one import;
// reads/writes v2_feedback, v2_ai_usage, v2_ai_calls, v2_error_events, v2_analytics_events,
// v2_audit_events, v2_config, v2_seen_updates, v2_settings, v2_ai_cache, v2_rest_timers,
// v2_plan_source_logs (all completed/created by migrations/0081_v2_admin_complete.sql — see its
// header for the real gaps that migration closed), plus v2_accounts/v2_profiles/v2_onboarding
// (Domain 1), v2_plan_adjustments (Domain 3), v2_workout_sessions/v2_strength_records
// (Domain 4), v2_nutrition_days (Domain 5), v2_wellbeing/v2_step_logs/v2_water_logs/
// bodyLogsByUser's v2_measurements (Domain 6), v2_messages/v2_client_note_history (Domain 7),
// and v2_achievements (Domain 8) for its cross-domain aggregate reads.
//
// ---------- deliberately NOT ported here: deleteUserData ----------
// admin.ts's deleteUserData is a single GDPR-delete sweep that spans BOTH schemas at once —
// legacy tables (users, plans, workout_logs, ...) AND v2 tables (v2_accounts, v2_workout_sessions,
// ...) in the same db.batch, because legacy is NOT frozen yet (docs/adr/0001's "keep the legacy
// schema read-only after cutover" is a deliberate LATER, separate, explicitly-approved step —
// see the migration plan's Context section) and both schemas can still hold live per-user data
// until it is. A "v2-native deleteUserData" that only deleted v2 rows would leave legacy rows
// behind for any user who has (or had) legacy data, which is a real GDPR regression, not a
// harmless intermediate state — so unlike every other export in this module, it is NOT
// duplicated here. This migration only ADDS four new DELETE statements to the EXISTING
// admin.ts#deleteUserData for the four new user-identifying tables this domain's migration
// created (v2_feedback/v2_ai_usage/v2_plan_source_logs/v2_rest_timers) — same pattern Domain 7
// (Trainer) already used for v2_client_note_history/v2_shared_programs, per that function's own
// comments. deleteUserData now lives in v2Account.ts (the legacy repo layer was removed).
import { nowIso, type DB } from "./shared";
export * from "./v2Analytics";
export * from "./v2AiTelemetry";
export * from "./v2Feedback";
// ---------- feedback ----------

export async function getOwnerChatId(db: DB): Promise<number | undefined> {
  const r = await db
    .prepare("SELECT ownerChatId FROM v2_config WHERE id = 'config'")
    .first<{ ownerChatId: number | null }>();
  return r?.ownerChatId ?? undefined;
}

export async function setOwnerChatId(db: DB, chatId: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO v2_config (id, ownerChatId) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET ownerChatId = excluded.ownerChatId",
    )
    .bind(chatId)
    .run();
}

// Owner-alert dedup state ({ "<alertKey>": "<iso>" }) — throttles proactive alerts.
export async function getAlertState(db: DB): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT alertState FROM v2_config WHERE id = 'config'").first<{ alertState: string | null }>();
  if (!r?.alertState) return {};
  try { return JSON.parse(r.alertState) as Record<string, string>; } catch { return {}; }
}

export async function setAlertState(db: DB, state: Record<string, string>): Promise<void> {
  await db
    .prepare("INSERT INTO v2_config (id, alertState) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET alertState = excluded.alertState")
    .bind(JSON.stringify(state))
    .run();
}

// ---------- admin audit log + client flag ----------

// v2_audit_events.payload is the migration's chosen home for the legacy `detail` string
// (0069's own backfill wrote it there verbatim: `COALESCE(detail, '{}')`, NOT JSON-wrapped) — so
// this mirrors that exact convention rather than re-encoding detail as a JSON value, keeping
// existing backfilled rows and freshly-written rows in the same shape.
export async function recordAudit(db: DB, actorId: number, action: string, targetId?: number, detail?: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_audit_events (actorId, targetId, kind, payload, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(actorId, targetId ?? null, action, detail !== undefined ? detail.slice(0, 200) : "{}", nowIso())
    .run();
}

export async function recentAudit(db: DB, limit = 10): Promise<{ ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }[]> {
  const r = await db
    .prepare("SELECT createdAt AS ts, actorId, kind AS action, targetId, payload AS detail FROM v2_audit_events ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<{ ts: string; actorId: number | null; action: string; targetId: number | null; detail: string | null }>();
  return (r.results ?? []).map((x) => ({
    ts: x.ts,
    actorId: x.actorId ?? 0,
    action: x.action,
    targetId: x.targetId,
    detail: x.detail === "{}" ? null : x.detail,
  }));
}

export async function setUserFlag(db: DB, userId: number, flagged: boolean): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET flagged = ? WHERE id = ?").bind(flagged ? 1 : 0, userId).run();
}

// ---------- dedup / housekeeping ----------

export async function markUpdateSeen(db: DB, updateId: number): Promise<boolean> {
  try {
    const r = await db
      .prepare("INSERT OR IGNORE INTO v2_seen_updates (id, createdAt) VALUES (?, ?)")
      .bind(updateId, nowIso())
      .run();
    return (r.meta?.changes ?? 0) > 0; // 0 changes → duplicate
  } catch (err) {
    console.error("markUpdateSeen error (processing anyway)", err);
    return true;
  }
}

export async function pruneSeenUpdates(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM v2_seen_updates WHERE createdAt < ?").bind(beforeIso).run();
}

// Telemetry tables grow unbounded (every AI call / error / button tap writes a row); D1 free
// tier caps the DB at 5 GB. Weekly sweep drops rows older than the retention window. Same table
// set as legacy pruneOldLogs, v2-native names: v2_ai_calls/v2_error_events/v2_ai_usage/
// v2_analytics_events/v2_messages(Domain 7)/v2_audit_events/v2_feedback/v2_plan_source_logs/
// v2_client_note_history(Domain 7, append-only journal of SUPERSEDED values — pruning old
// entries loses history, not state, same as legacy).
export async function pruneOldLogs(db: DB, beforeIso: string, beforeDay: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM v2_ai_calls WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_error_events WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_ai_usage WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_analytics_events WHERE date < ?").bind(beforeDay),
    db.prepare("DELETE FROM v2_messages WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_audit_events WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_feedback WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_plan_source_logs WHERE createdAt < ?").bind(beforeIso),
    db.prepare("DELETE FROM v2_client_note_history WHERE savedAt < ?").bind(beforeIso),
  ]);
}

// ---------- health ----------

export async function pingDb(db: DB): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return r?.ok === 1;
}

// ---------- AI response cache (identical prompts skip the provider chain) ----------

export async function setRestTimer(db: DB, userId: number, chatId: number, dueAtIso: string, lang: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_rest_timers (accountId, chatId, dueAt, lang) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET chatId = excluded.chatId, dueAt = excluded.dueAt, lang = excluded.lang`,
    )
    .bind(userId, chatId, dueAtIso, lang)
    .run();
}

export async function dueRestTimers(db: DB, nowIsoStr: string, limit = 20): Promise<{ userId: number; chatId: number; lang: string }[]> {
  const r = await db
    .prepare("SELECT accountId AS userId, chatId, lang FROM v2_rest_timers WHERE dueAt <= ? LIMIT ?")
    .bind(nowIsoStr, limit)
    .all<{ userId: number; chatId: number; lang: string }>();
  return r.results ?? [];
}

export async function deleteRestTimers(db: DB, userIds: number[]): Promise<void> {
  if (!userIds.length) return;
  await db
    .prepare(`DELETE FROM v2_rest_timers WHERE accountId IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds)
    .run();
}

// ---------- engagement: activity signal + usage counters ----------

// ── Settings (key-value store for one-time flags / scheduled tasks) ───────────
export async function getSetting(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM v2_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: DB, key: string): Promise<void> {
  await db.prepare("DELETE FROM v2_settings WHERE key = ?").bind(key).run();
}

// Cron mutual-exclusion: the scheduled handler runs in waitUntil (detached), so a heavy run can
// outlive its minute and the next cron starts a SECOND concurrent run → both read the same
// un-flushed reminder dedup and send the SAME message twice (the "identical messages" spam).
// A fresh lock (< ttl) means another run is active → skip this tick. Stale lock (crashed run) expires.
// Atomic check-and-set in one statement — the previous version read the lock then wrote it in
// two separate round-trips, so two overlapping invocations could both see the lock as free and
// both proceed. The WHERE clause on the conflict branch makes D1 only apply the update (and
// report a changed row) when the existing lock has actually expired.
export async function acquireScheduleLock(db: DB, nowMs: number, ttlMs: number): Promise<boolean> {
  const cutoff = nowMs - ttlMs;
  const res = await db
    .prepare(
      "INSERT INTO v2_settings (key, value) VALUES ('schedule_lock', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(v2_settings.value AS INTEGER) < ?",
    )
    .bind(String(nowMs), cutoff)
    .run();
  return (res.meta.changes ?? 0) > 0;
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
  statCounts: { workouts: number; nutrition: number; checkins: number; steps: number; badges: number; quests: number };
  achievements: string[];
  waterMl: number;
  steps: number;
}> {
  const [counts, ach, water, step] = await db.batch([
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM v2_workout_sessions WHERE accountId = ?1 AND completed = 1) AS workouts,
          (SELECT COUNT(*) FROM v2_nutrition_days WHERE accountId = ?1) AS nutrition,
          (SELECT COUNT(*) FROM v2_wellbeing WHERE accountId = ?1) AS checkins,
          (SELECT COUNT(*) FROM v2_step_logs WHERE accountId = ?1) AS steps,
          (SELECT COUNT(*) FROM v2_achievements WHERE accountId = ?1) AS badges,
        (SELECT COUNT(*) FROM v2_quests WHERE accountId = ?1) AS quests`,
      )
      .bind(userId),
    db.prepare("SELECT code FROM v2_achievements WHERE accountId = ? ORDER BY earnedAt ASC").bind(userId),
    db.prepare("SELECT ml FROM v2_water_logs WHERE accountId = ? AND date = ?").bind(userId, today),
    db.prepare("SELECT steps FROM v2_step_logs WHERE accountId = ? AND date = ?").bind(userId, today),
  ]);
  const c = (counts.results?.[0] ?? {}) as Partial<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number; quests: number }>;
  return {
    statCounts: {
      workouts: c.workouts ?? 0,
      nutrition: c.nutrition ?? 0,
      checkins: c.checkins ?? 0,
      steps: c.steps ?? 0,
      badges: c.badges ?? 0,
      quests: c.quests ?? 0,
    },
    achievements: ((ach.results ?? []) as { code: string }[]).map((x) => x.code),
    waterMl: ((water.results?.[0] as { ml?: number } | undefined)?.ml) ?? 0,
    steps: ((step.results?.[0] as { steps?: number } | undefined)?.steps) ?? 0,
  };
}
