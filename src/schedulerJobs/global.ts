// Account-wide scheduler jobs (owner alerts, leaderboard cache, pruning, metrics rollup,
// stale drafts, AI model watch) and the cron dead-man switch. Split out of scheduler.ts.
import { learnUnknownExercises } from "../exerciseMuscleLearning";
import { rollupDailyMetrics } from "../dailyMetricsRollup";
import { sweepStaleDrafts } from "../staleDrafts";
import { weeklyModelCheck } from "../aiModelWatch";
import { isoDateMinus } from "../features/gamification/boards";
import type { Env } from "../types";
import { getOwnerChatId, getAlertState, setAlertState, errorStatsSince, aiUsageSince, pruneOldLogs, pruneAiCache, getSetting, setSetting } from "../adapters/d1/v2Admin";
import { pruneNotificationOutbox } from "../adapters/d1/v2Notifications";
import { pruneIdempotencyKeys } from "../adapters/d1/v2Idempotency";
import { computeBoards } from "../bot";
import { logSchedulerError, type Sender } from "./shared";

// Push the owner an alert when something operationally wrong is happening (no need to open /report).
// Each alert type is throttled to once per hour via config.alertState so it never spams.
/** The account-wide (not per-user, not per-squad) jobs: owner alerts, the leaderboard cache,
 * and telemetry pruning. Extracted so the still-live cron path (below) and the dry-run
 * GlobalSchedulerDO (durable/globalScheduler.ts) run the EXACT same logic, not two copies that
 * can drift. Each sub-job already catches its own errors — one failing must not skip the rest. */
export async function runGlobalJobs(db: D1Database, bot: Sender, env?: Env): Promise<void> {
  // Proactive owner alerts — error spikes / AI provider outages, deduped to once per hour each.
  await checkOwnerAlerts(db, bot).catch((e) => logSchedulerError(db, "owner_alerts", e));

  // Leaderboards cache — computed once per hourly pass so /api/boards serves a stored JSON
  // instead of re-scanning every competitor's logs on each Mini App open (D1 rows-read grows
  // with the competitor count; this caps it at one scan per hour).
  try {
    const boards = await computeBoards(db, "Europe/Kyiv");
    await setSetting(db, "boards_cache", JSON.stringify({ computedAt: new Date().toISOString(), boards }));
  } catch (e) {
    logSchedulerError(db, "boards_cache", e);
  }

  // Trainer clients stuck on an unassigned first-plan draft: remind the trainer after a day,
  // activate it after three (staleDrafts.ts).
  await sweepStaleDrafts(db, (chatId, text, extra) => bot.api.sendMessage(chatId, text, extra))
    .catch((e) => logSchedulerError(db, "stale_drafts", e));

  // Weekly: alert the owner when a configured AI model id vanished from its provider's catalog
  // (aiModelWatch.ts). Needs the real env for the API keys; the shadow dry-run pass has none.
  if (env) {
    await weeklyModelCheck(env, (chatId, text) => bot.api.sendMessage(chatId, text, { parse_mode: "HTML" }))
      .catch((e) => logSchedulerError(db, "ai_model_check", e));
    // Muscles for exercise names the body map doesn't know yet (exerciseMuscleLearning.ts).
    await learnUnknownExercises(env).catch((e) => logSchedulerError(db, "exercise_muscles", e));
  }

  // AI-error stats are no longer auto-pushed (the every-minute cron + minute<5 window sent the
  // same report ~5× → spam). They are now part of the on-demand owner report (buildOwnerReport).

  // Weekly telemetry pruning (90-day retention) — cheap no-op when already done this week.
  const lastPrune = await getSetting(db, "last_log_prune").catch(() => null);
  if (!lastPrune || Date.parse(lastPrune) < Date.now() - 7 * 86_400_000) {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    await pruneOldLogs(db, cutoff.toISOString(), cutoff.toISOString().slice(0, 10)).catch((e) =>
      logSchedulerError(db, "log_prune", e),
    );
    await pruneAiCache(db).catch(() => {});
    // Idempotency keys only ever need to survive their 24h replay window (see
    // db/repos/idempotency.ts) -- riding the same weekly pass rather than a dedicated one.
    await pruneIdempotencyKeys(db, cutoff.toISOString()).catch(() => {});
    // Sent/failed/blocked outbox rows — pending rows are excluded regardless of age (see
    // pruneNotificationOutbox), so this never deletes something still awaiting delivery.
    await pruneNotificationOutbox(db, cutoff.toISOString()).catch(() => {});
    await setSetting(db, "last_log_prune", new Date().toISOString()).catch(() => {});
  }

  // Daily product-metrics rollup (roadmap item 4 / docs/slos.md §4) — once per day, for
  // YESTERDAY (the last day guaranteed complete; "today" is still accumulating and would give
  // dau/retention/etc. a moving-target value that changes every time the pass reruns).
  // 20h, not 24h: an exact 24h minimum gap can drift a run later each day until it eventually
  // skips a calendar day; a shorter buffer keeps it comfortably once-daily without that drift.
  const lastRollup = await getSetting(db, "last_daily_metrics_rollup").catch(() => null);
  if (!lastRollup || Date.parse(lastRollup) < Date.now() - 20 * 3_600_000) {
    const yesterday = isoDateMinus(new Date().toISOString().slice(0, 10), 1);
    await rollupDailyMetrics(db, yesterday).catch((e) => logSchedulerError(db, "daily_metrics_rollup", e));
    await setSetting(db, "last_daily_metrics_rollup", new Date().toISOString()).catch(() => {});
  }
}

async function checkOwnerAlerts(db: D1Database, bot: Sender): Promise<void> {
  const ownerChatId = await getOwnerChatId(db);
  if (ownerChatId === undefined) return;
  const sinceIso = new Date(Date.now() - 3_600_000).toISOString();
  const [errs, usage] = await Promise.all([
    errorStatsSince(db, sinceIso).catch(() => [] as { kind: string; errorType: string; n: number }[]),
    aiUsageSince(db, sinceIso).catch(() => [] as { provider: string; kind: string; ok: boolean }[]),
  ]);
  const state = await getAlertState(db).catch(() => ({}) as Record<string, string>);
  const now = Date.now();
  const fresh = (key: string, hours = 1) => {
    const last = state[key];
    return !last || now - Date.parse(last) > hours * 3_600_000;
  };
  const alerts: string[] = [];
  const errTotal = errs.reduce((a, e) => a + e.n, 0);
  if (errTotal >= 15 && fresh("errors")) {
    const top = errs.slice(0, 3).map((e) => `${e.kind}/${e.errorType}×${e.n}`).join(", ");
    alerts.push(`🚨 Error spike: ${errTotal} in 1h. Top: ${top}`);
    state.errors = new Date(now).toISOString();
  }
  if (usage.length >= 5) {
    const ok = usage.filter((u) => u.ok).length;
    if (ok === 0 && fresh("ai_down")) {
      alerts.push(`🚨 AI down: ${usage.length} calls in 1h, 0 succeeded — check provider keys.`);
      state.ai_down = new Date(now).toISOString();
    } else {
      const gem = usage.filter((u) => u.provider === "gemini");
      if (gem.length >= 5 && gem.every((u) => !u.ok) && fresh("gemini")) {
        alerts.push(`⚠️ Gemini failing/rate-limited (${gem.length} in 1h) — running on fallbacks.`);
        state.gemini = new Date(now).toISOString();
      }
    }
  }
  if (alerts.length) {
    await setAlertState(db, state).catch(() => {});
    // Deliberately a DIRECT send, not the outbox: this is the alert channel itself, and routing it
    // through the delivery machinery it exists to monitor would hide an outbox failure behind it.
    await bot.api.sendMessage(ownerChatId, ["🛠 <b>Proactive alert</b>", ...alerts].join("\n"), { parse_mode: "HTML" }).catch(() => {});
  }
}

// Dead-man switch: the cron stamps a heartbeat every run; the fetch path (dashboard opens)
// checks its age and alerts the owner ONCE per hour if the cron has silently died — a dead
// cron otherwise only shows up as "reminders stopped" days later.
export async function checkCronHeartbeat(env: Env): Promise<void> {
  const db = env.DB;
  const hb = await getSetting(db, "cron_heartbeat").catch(() => null);
  if (!hb) return; // never stamped (fresh deploy) — nothing to compare against
  const age = Date.now() - Date.parse(hb);
  if (age < 10 * 60_000) return;
  const alerted = await getSetting(db, "cron_alerted").catch(() => null);
  if (alerted && Date.now() - Date.parse(alerted) < 60 * 60_000) return;
  const ownerChatId = await getOwnerChatId(db).catch(() => undefined);
  if (!ownerChatId) return;
  await setSetting(db, "cron_alerted", new Date().toISOString()).catch(() => {});
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: ownerChatId,
      text: `🚨 <b>Cron is not running</b> — last heartbeat ${Math.round(age / 60_000)} min ago. Reminders and digests are NOT being sent. Check the Worker's triggers/limits.`,
      parse_mode: "HTML",
    }),
  }).catch(() => {});
}
