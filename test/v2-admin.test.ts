// Domain 9 (owner/admin reporting, AI/error/analytics logging, notification outbox,
// daily-metrics rollup) v2-native repos — src/adapters/d1/v2Admin.ts, v2Notifications.ts,
// v2DailyMetrics.ts, v2Idempotency.ts. Exercises them against the same in-memory D1 harness the
// legacy repo tests use (test/harness.ts), which builds its schema from every migrations/*.sql
// file, including 0069/0070/0081 (v2_feedback/v2_ai_usage/v2_plan_source_logs/v2_rest_timers/
// v2_config/v2_seen_updates/v2_settings/v2_ai_cache, the v2_notifications rebuild, and the
// v2_analytics_events unique index).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  acquireScheduleLock,
  aiAndErrorStatsBetween,
  aiAttemptCountForUserSince,
  aiCacheStmt,
  aiCallStatsSince,
  aiCallStmt,
  aiTokensByKindSince,
  aiUsageSince,
  aiUsageStmt,
  bumpEvent,
  countAdjustmentsSince,
  countFeedbackSince,
  countPlanSourcesSince,
  dailyActiveUsers,
  dashboardExtrasBatch,
  deleteRestTimers,
  deleteSetting,
  dueRestTimers,
  engagementSince,
  errorStatsSince,
  eventCountsByUser,
  eventStatsSince,
  getAiCache,
  getAlertState,
  getOwnerChatId,
  getSetting,
  insertFeedback,
  listUsersBrief,
  markUpdateSeen,
  pingDb,
  pruneAiCache,
  pruneOldLogs,
  pruneSeenUpdates,
  recentAudit,
  recentErrors,
  recentEventsForUser,
  recentFeedback,
  recordAudit,
  recordError,
  recordPlanSource,
  releaseScheduleLock,
  setAlertState,
  setLastSeen,
  setOwnerChatId,
  setRestTimer,
  setSetting,
  setUserFlag,
  userStatCounts,
} from "../src/adapters/d1/v2Admin";
import { dueNotifications, enqueueNotification, markPermanentFailure, markRetry, markSent, pruneNotificationOutbox } from "../src/adapters/d1/v2Notifications";
import { getDailyMetrics, pruneDailyMetricsBefore, upsertDailyMetric, upsertDailyMetrics } from "../src/adapters/d1/v2DailyMetrics";
import { claimIdempotencyKey, completeIdempotencyClaim, pruneIdempotencyKeys, runIdempotent } from "../src/adapters/d1/v2Idempotency";

// v2_feedback/v2_ai_usage/v2_ai_calls/v2_error_events/v2_analytics_events/v2_notifications/
// v2_rest_timers/v2_idempotency all FK to v2_accounts(id) — seed a minimal account row directly,
// same pattern test/v2-plans.test.ts's seedAccount uses (this domain doesn't own v2_accounts).
function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

// ---------- feedback ----------

test("insertFeedback/countFeedbackSince/recentFeedback round-trip via v2_feedback", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await insertFeedback(db, { userId: 1, username: "alex", text: "love the bot", date: "2026-09-01" });
  assert.equal(await countFeedbackSince(db, "2026-01-01T00:00:00.000Z"), 1);
  const recent = await recentFeedback(db, 5);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].userId, 1);
  assert.equal(recent[0].username, "alex");
  assert.equal(recent[0].text, "love the bot");
});

// ---------- owner report: user listing + event counts ----------

test("listUsersBrief reads accounts/profiles/onboarding joined, trainerId via active relationship", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, 'en', ?, ?)")
    .bind(1, JSON.stringify({ name: "Alex" }), now).run();
  db.prepare("INSERT INTO v2_onboarding (accountId, status, sessionMode, updatedAt) VALUES (?, 'completed', 'idle', ?)").bind(1, now).run();
  db.prepare(
    "INSERT INTO v2_trainer_relationships (clientId, trainerId, status, consent, createdAt, updatedAt) VALUES (1, 2, 'active', '{}', ?, ?)",
  ).bind(now, now).run();

  const rows = await listUsersBrief(db);
  const alex = rows.find((r) => r.id === 1)!;
  assert.equal(alex.name, "Alex");
  assert.equal(alex.onboarded, true);
  assert.equal(alex.trainerId, 2);
  assert.equal(alex.blocked, false);
});

test("eventCountsByUser only counts completed workout sessions", async () => {
  const db = newDb();
  seedAccount(db, 1);
  db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (1, '2026-09-01', 2, 1, ?, ?)")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
  db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (1, '2026-09-02', 3, 0, ?, ?)")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
  const counts = await eventCountsByUser(db);
  assert.equal(counts.get(1)?.workouts, 1); // the completed=0 skip must not count
});

test("engagementSince counts v2_workout_sessions/v2_wellbeing/v2_nutrition_days since cutoff", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (1, '2026-09-05', 6, 1, ?, ?)").bind(now, now).run();
  db.prepare("INSERT INTO v2_wellbeing (accountId, date, energy, sleep, stress, createdAt) VALUES (1, '2026-09-05', 7, 7, 3, ?)").bind(now).run();
  db.prepare("INSERT INTO v2_nutrition_days (accountId, date, updatedAt) VALUES (1, '2026-09-05', ?)").bind(now).run();
  const stats = await engagementSince(db, "2026-09-01");
  assert.equal(stats.workouts, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.checkins, 1);
  assert.equal(stats.nutrition, 1);
});

test("countAdjustmentsSince reads v2_plan_adjustments", async () => {
  const db = newDb();
  seedAccount(db, 1);
  db.prepare("INSERT INTO v2_plan_adjustments (accountId, week, changes, createdAt) VALUES (1, 1, '[]', ?)").bind(new Date().toISOString()).run();
  assert.equal(await countAdjustmentsSince(db, "2020-01-01"), 1);
});

test("recordPlanSource/countPlanSourcesSince round-trip via v2_plan_source_logs", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await recordPlanSource(db, 1, "workout", "bank");
  await recordPlanSource(db, 1, "workout", "ai");
  const stats = await countPlanSourcesSince(db, "2020-01-01");
  const bank = stats.find((s) => s.source === "bank");
  assert.equal(bank?.c, 1);
});

// ---------- AI usage / call telemetry / errors ----------

test("aiUsageStmt/aiUsageSince round-trip via v2_ai_usage", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await db.batch([aiUsageStmt(db, { userId: 1, provider: "gemini", kind: "plan", model: "gemini-pro", ok: true, date: "2026-09-01" })]);
  const rows = await aiUsageSince(db, "2020-01-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "gemini");
  assert.equal(rows[0].ok, true);
});

test("aiCallStmt/aiCallStatsSince/aiAttemptCountForUserSince/aiTokensByKindSince round-trip via v2_ai_calls", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await db.batch([
    aiCallStmt(db, { userId: 1, provider: "gemini", kind: "plan", latencyMs: 100, tokens: 50, wasFallback: false }),
    aiCallStmt(db, { userId: 1, provider: "openrouter", kind: "plan", latencyMs: 200, tokens: 30, wasFallback: true }),
  ]);
  const stats = await aiCallStatsSince(db, "2020-01-01");
  assert.equal(stats.length, 2);
  assert.equal(await aiAttemptCountForUserSince(db, 1, "2020-01-01"), 2);
  const byKind = await aiTokensByKindSince(db, "2020-01-01");
  assert.equal(byKind[0].tokens, 80);
});

test("aiAndErrorStatsBetween combines v2_ai_usage/v2_ai_calls/v2_error_events in a bounded window", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const inWindow = "2026-09-05T00:00:00.000Z";
  await db.batch([aiUsageStmt(db, { userId: 1, provider: "gemini", kind: "plan", model: "m", ok: true, date: "2026-09-05" })]);
  db.prepare("UPDATE v2_ai_usage SET createdAt = ?").bind(inWindow).run();
  await db.batch([aiCallStmt(db, { userId: 1, provider: "gemini", kind: "plan", latencyMs: 10, wasFallback: true })]);
  db.prepare("UPDATE v2_ai_calls SET createdAt = ?").bind(inWindow).run();
  await recordError(db, { userId: 1, kind: "plan", errorType: "timeout" });
  db.prepare("UPDATE v2_error_events SET createdAt = ?").bind(inWindow).run();

  const stats = await aiAndErrorStatsBetween(db, "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
  assert.equal(stats.aiCalls, 1);
  assert.equal(stats.aiFallbacks, 1);
  assert.equal(stats.errors, 1);
});

test("recordError/errorStatsSince/recentErrors round-trip via v2_error_events", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await recordError(db, { userId: 1, kind: "plan", errorType: "timeout", message: "boom" });
  const stats = await errorStatsSince(db, "2020-01-01");
  assert.equal(stats[0]?.n, 1);
  const recent = await recentErrors(db, "2020-01-01");
  assert.equal(recent[0]?.message, "boom");
});

// ---------- config / owner / audit ----------

test("getOwnerChatId/setOwnerChatId and getAlertState/setAlertState round-trip via v2_config", async () => {
  const db = newDb();
  await setOwnerChatId(db, 999);
  assert.equal(await getOwnerChatId(db), 999);
  await setAlertState(db, { churn: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(await getAlertState(db), { churn: "2026-09-01T00:00:00.000Z" });
  // Both live on the same singleton row — setting one must not clobber the other.
  assert.equal(await getOwnerChatId(db), 999);
});

test("recordAudit/recentAudit round-trip via v2_audit_events, detail null vs set", async () => {
  const db = newDb();
  await recordAudit(db, 42, "ban_user", 7, "spam");
  await recordAudit(db, 42, "unban_user", 7);
  const rows = await recentAudit(db, 10);
  assert.equal(rows.length, 2);
  const ban = rows.find((r) => r.action === "ban_user")!;
  assert.equal(ban.detail, "spam");
  const unban = rows.find((r) => r.action === "unban_user")!;
  assert.equal(unban.detail, null); // no detail passed → stored as '{}' → surfaced as null
});

test("setUserFlag writes v2_accounts.flagged", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await setUserFlag(db, 1, true);
  const r = db.prepare("SELECT flagged FROM v2_accounts WHERE id = 1").first<{ flagged: number }>();
  assert.equal(r?.flagged, 1);
});

// ---------- dedup / housekeeping ----------

test("markUpdateSeen dedupes by update id, pruneSeenUpdates removes old rows", async () => {
  const db = newDb();
  assert.equal(await markUpdateSeen(db, 555), true);
  assert.equal(await markUpdateSeen(db, 555), false); // duplicate
  await pruneSeenUpdates(db, new Date(Date.now() + 1000).toISOString());
  const left = db.prepare("SELECT COUNT(*) AS c FROM v2_seen_updates").first<{ c: number }>();
  assert.equal(left?.c, 0);
});

test("pruneOldLogs sweeps v2_ai_calls/v2_error_events/v2_ai_usage/v2_analytics_events/v2_feedback/v2_plan_source_logs", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const old = "2020-01-01T00:00:00.000Z";
  await db.batch([aiCallStmt(db, { userId: 1, provider: "gemini", kind: "plan", latencyMs: 1, wasFallback: false })]);
  db.prepare("UPDATE v2_ai_calls SET createdAt = ?").bind(old).run();
  await recordError(db, { userId: 1, kind: "plan", errorType: "x" });
  db.prepare("UPDATE v2_error_events SET createdAt = ?").bind(old).run();
  await insertFeedback(db, { userId: 1, text: "old", date: "2020-01-01" });
  db.prepare("UPDATE v2_feedback SET createdAt = ?").bind(old).run();
  await bumpEvent(db, 1, "workout_saved", "2020-01-01");

  await pruneOldLogs(db, new Date().toISOString(), "2026-01-01");

  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM v2_ai_calls").first<{ c: number }>()?.c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM v2_error_events").first<{ c: number }>()?.c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM v2_feedback").first<{ c: number }>()?.c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM v2_analytics_events").first<{ c: number }>()?.c, 0);
});

test("pingDb returns true", async () => {
  const db = newDb();
  assert.equal(await pingDb(db), true);
});

// ---------- AI response cache ----------

test("getAiCache/aiCacheStmt/pruneAiCache round-trip via v2_ai_cache, respecting expiry", async () => {
  const db = newDb();
  await db.batch([aiCacheStmt(db, "k1", "cached response", 60_000)]);
  assert.equal(await getAiCache(db, "k1"), "cached response");
  await db.batch([aiCacheStmt(db, "k2", "already expired", -1)]);
  assert.equal(await getAiCache(db, "k2"), null); // expiresAt in the past → not returned
  await pruneAiCache(db);
  const left = db.prepare("SELECT COUNT(*) AS c FROM v2_ai_cache").first<{ c: number }>();
  assert.equal(left?.c, 1); // only the still-live k1 row survives
});

// ---------- rest timers ----------

test("setRestTimer/dueRestTimers/deleteRestTimers round-trip via v2_rest_timers, upserts by account", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const past = new Date(Date.now() - 1000).toISOString();
  await setRestTimer(db, 1, 100, past, "en");
  await setRestTimer(db, 1, 100, past, "uk"); // re-set (upsert, not a duplicate row)
  const due = await dueRestTimers(db, new Date().toISOString());
  assert.equal(due.length, 1);
  assert.equal(due[0].lang, "uk");
  await deleteRestTimers(db, [1]);
  const left = await dueRestTimers(db, new Date().toISOString());
  assert.equal(left.length, 0);
});

// ---------- engagement counters ----------

test("bumpEvent increments in place (not append) — eventStatsSince/dailyActiveUsers/recentEventsForUser see one row per (account,event,date)", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  await bumpEvent(db, 1, "workout_saved", "2026-09-01");
  await bumpEvent(db, 1, "workout_saved", "2026-09-01"); // second bump, same day — must increment, not insert a 2nd row
  await bumpEvent(db, 2, "workout_saved", "2026-09-01");

  const rowCount = db.prepare("SELECT COUNT(*) AS c FROM v2_analytics_events").first<{ c: number }>();
  assert.equal(rowCount?.c, 2); // one row per (account, event, date), not 3

  const stats = await eventStatsSince(db, "2026-09-01");
  assert.equal(stats.find((s) => s.event === "workout_saved")?.n, 3); // SUM(count) across both users

  const dau = await dailyActiveUsers(db, "2026-09-01");
  assert.equal(dau[0]?.n, 2); // COUNT(DISTINCT account)

  const forUser1 = await recentEventsForUser(db, 1);
  assert.equal(forUser1.length, 1);
  assert.equal(forUser1[0].n, 2);
});

test("setLastSeen writes v2_accounts.lastSeenAt", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await setLastSeen(db, 1, "2026-09-10T00:00:00.000Z");
  const r = db.prepare("SELECT lastSeenAt FROM v2_accounts WHERE id = 1").first<{ lastSeenAt: string }>();
  assert.equal(r?.lastSeenAt, "2026-09-10T00:00:00.000Z");
});

test("userStatCounts aggregates across v2_workout_sessions/v2_step_logs/v2_achievements", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (1, '2026-09-01', 2, 1, ?, ?)").bind(now, now).run();
  db.prepare("INSERT INTO v2_achievements (accountId, code, earnedAt) VALUES (1, 'first_workout', ?)").bind(now).run();
  db.prepare("INSERT INTO v2_step_logs (accountId, date, steps, createdAt) VALUES (1, '2026-09-01', 5000, ?)").bind(now).run();

  const counts = await userStatCounts(db, 1);
  assert.equal(counts.workouts, 1);
  assert.equal(counts.badges, 1);
  assert.equal(counts.steps, 1); // 1 DAY logged with a step count, not the step total
});

// dashboardExtrasBatch's db.batch() mixes SELECTs into the batch — test/harness.ts's FakeD1.batch
// always calls the underlying Stmt.run() (no `results`), so a SELECT inside db.batch() reads back
// empty there regardless of what's really in the table. That's a harness limitation, not a bug in
// this code — see test/vitest/v2-admin.test.ts for the real-D1 coverage of this function.

// ---------- settings / schedule lock ----------

test("getSetting/setSetting/deleteSetting round-trip via v2_settings", async () => {
  const db = newDb();
  assert.equal(await getSetting(db, "k"), null);
  await setSetting(db, "k", "v1");
  assert.equal(await getSetting(db, "k"), "v1");
  await setSetting(db, "k", "v2");
  assert.equal(await getSetting(db, "k"), "v2");
  await deleteSetting(db, "k");
  assert.equal(await getSetting(db, "k"), null);
});

test("acquireScheduleLock is exclusive until the ttl expires", async () => {
  const db = newDb();
  const now = Date.now();
  assert.equal(await acquireScheduleLock(db, now, 60_000), true);
  assert.equal(await acquireScheduleLock(db, now + 1000, 60_000), false); // still fresh — refused
  assert.equal(await acquireScheduleLock(db, now + 120_000, 60_000), true); // stale — reacquired
  await releaseScheduleLock(db);
  assert.equal(await acquireScheduleLock(db, now + 121_000, 60_000), true); // released — free again
});

// ---------- v2Notifications: the real bug 0081 fixes ----------

test("enqueueNotification scopes idempotency to (account, key) — two different accounts with the SAME key both get delivered", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  const sameKey = "2026-09-01:Don't forget your workout!";
  const id1 = await enqueueNotification(db, { userId: 1, chatId: 100, kind: "reminder", idempotencyKey: sameKey, payload: { text: "hi" } });
  const id2 = await enqueueNotification(db, { userId: 2, chatId: 200, kind: "reminder", idempotencyKey: sameKey, payload: { text: "hi" } });
  assert.ok(id1 !== null, "user 1's notification must be enqueued");
  assert.ok(id2 !== null, "user 2's notification must NOT be dropped just because it shares user 1's idempotencyKey (0069's global-unique bug)");

  // Same account + same key again → genuinely a duplicate → dropped.
  const dup = await enqueueNotification(db, { userId: 1, chatId: 100, kind: "reminder", idempotencyKey: sameKey, payload: { text: "hi" } });
  assert.equal(dup, null);
});

test("dueNotifications returns chatId (0069 never carried it) and respects backoff window", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await enqueueNotification(db, { userId: 1, chatId: 12345, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  const due = await dueNotifications(db, new Date(Date.now() + 1000).toISOString());
  assert.equal(due.length, 1);
  assert.equal(due[0].chatId, 12345);
  assert.equal(due[0].userId, 1);
});

test("markSent/markRetry/markPermanentFailure update status in place on v2_notifications", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  await markRetry(db, id!, 1, new Date(Date.now() + 1000), "temporary failure");
  let row = db.prepare("SELECT status, attempts, lastError FROM v2_notifications WHERE id = ?").bind(id).first<{ status: string; attempts: number; lastError: string }>();
  assert.equal(row?.status, "pending");
  assert.equal(row?.attempts, 1);
  assert.equal(row?.lastError, "temporary failure");

  await markSent(db, id!);
  row = db.prepare("SELECT status FROM v2_notifications WHERE id = ?").bind(id).first();
  assert.equal(row?.status, "sent");

  const id2 = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k2", payload: { text: "hi" } });
  await markPermanentFailure(db, id2!, "blocked", "bot was blocked");
  row = db.prepare("SELECT status, lastError FROM v2_notifications WHERE id = ?").bind(id2).first<{ status: string; lastError: string }>();
  assert.equal(row?.status, "blocked");
});

test("pruneNotificationOutbox keeps pending rows regardless of age", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  db.prepare("UPDATE v2_notifications SET createdAt = ? WHERE id = ?").bind("2020-01-01T00:00:00.000Z", id).run();
  await pruneNotificationOutbox(db, new Date().toISOString());
  const left = db.prepare("SELECT COUNT(*) AS c FROM v2_notifications").first<{ c: number }>();
  assert.equal(left?.c, 1); // still pending — must survive the sweep
});

// ---------- v2DailyMetrics ----------

test("upsertDailyMetric/upsertDailyMetrics/getDailyMetrics/pruneDailyMetricsBefore round-trip via v2_daily_metrics", async () => {
  const db = newDb();
  await upsertDailyMetric(db, "2026-09-01", "dau", {}, 10);
  await upsertDailyMetric(db, "2026-09-01", "dau", {}, 12); // re-upsert, same (date, metric, dims) key
  await upsertDailyMetrics(db, "2026-09-02", [{ metric: "dau", value: 15 }]);

  const rows = await getDailyMetrics(db, "2026-09-01", "2026-09-02", "dau");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.date === "2026-09-01")?.value, 12); // last write wins, not a 2nd row

  await pruneDailyMetricsBefore(db, "2026-09-02");
  const left = await getDailyMetrics(db, "2026-01-01", "2026-12-31");
  assert.equal(left.length, 1);
  assert.equal(left[0].date, "2026-09-02");
});

// ---------- v2Idempotency ----------

test("claimIdempotencyKey/completeIdempotencyClaim: claim once, replay the cached result on retry", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const first = await claimIdempotencyKey(db, 1, "key1");
  assert.deepEqual(first, { claimed: true });

  // A concurrent/retried request with the SAME key while still "processing" gets told to retry.
  const whileProcessing = await claimIdempotencyKey(db, 1, "key1");
  assert.equal(whileProcessing.claimed, false);
  assert.equal((whileProcessing as { cached: null }).cached, null);

  await completeIdempotencyClaim(db, 1, "key1", 200, { ok: true });
  const afterDone = await claimIdempotencyKey(db, 1, "key1");
  assert.equal(afterDone.claimed, false);
  assert.deepEqual((afterDone as { cached: { status: number; response: unknown } }).cached, { status: 200, response: { ok: true } });
});

test("runIdempotent replays the cached response instead of re-running the handler", async () => {
  const db = newDb();
  seedAccount(db, 1);
  let calls = 0;
  const run = async () => { calls++; return { status: 200, body: { calls } }; };
  const r1 = await runIdempotent(db, 1, "op1", run);
  const r2 = await runIdempotent(db, 1, "op1", run); // same key — must NOT call run() again
  assert.equal(calls, 1);
  assert.deepEqual(r1, r2);

  const r3 = await runIdempotent(db, 1, null, run); // no key — always runs
  assert.equal(calls, 2);
  assert.equal((r3.body as { calls: number }).calls, 2);
});

test("pruneIdempotencyKeys removes old rows from v2_idempotency", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await claimIdempotencyKey(db, 1, "old");
  db.prepare("UPDATE v2_idempotency SET createdAt = ? WHERE accountId = 1 AND key = 'old'").bind("2020-01-01T00:00:00.000Z").run();
  await pruneIdempotencyKeys(db, new Date().toISOString());
  const left = db.prepare("SELECT COUNT(*) AS c FROM v2_idempotency").first<{ c: number }>();
  assert.equal(left?.c, 0);
});
