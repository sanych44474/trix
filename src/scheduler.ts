import { Bot, GrammyError, InlineKeyboard } from "grammy";
import type { BodyLogDoc, Env, PlanDoc, PlanExercise, UserDoc, Weekday, WorkoutLogDoc } from "./types";
import {
  awardAchievement,
  bodyLogsByUser,
  competitorWorkoutDates,
  countAdjustmentWeeksSince,
  dailyCheckinsSince,
  findHarderExercise,
  getCatalogExercise,
  getDailyCheckin,
  getExerciseTranslation,
  getOwnerChatId,
  getAlertState,
  setAlertState,
  recordError,
  errorStatsSince,
  aiUsageSince,
  stepLogsSince,
  listStrength,
  listInjuriesDue,
  markInjuryAsked,
  sessionsBetween,
  markPastSessionsDone,
  getUser,
  getUsersByIds,
  listActivePlans,
  allWorkoutLogsSince,
  listCandidatesByMuscles,
  listClients,
  listBillingForTrainer,
  listOnboardedUsers,
  listOnboardingOwedReply,
  listPlanPendingUsers,
  listRetryUsers,
  pendingRecoveryCount,
  listStuckOnboardingUsers,
  listVacationEnded,
  markComebackDone,
  acquireScheduleLock,
  releaseScheduleLock,
  dueRestTimers,
  deleteRestTimers,
  decrementSessionsLeft,
  listBillingDue,
  markBillingNudged,
  nutritionLogsSince,
  pruneSeenUpdates,
  pruneOldLogs,
  pruneAiCache,
  getSetting,
  setSetting,
  recordAdjustment,
  recordPlanSource,
  saveDraftPlan,
  setActivePlan,
  setProgressionRate,
  updatePlanMesocycle,
  updateUser,
  workoutLogsSince,
  getWater,
} from "./db/repos";
import { resolveWaterGoal } from "./domain/challenges";
import {
  adherenceDeloadDue,
  applyProgression,
  computePlanProgression,
  deloadWeekDue,
  evaluateProgressionRate,
  fatLossGoalReached,
  gainGoalReached,
  inQuietHours,
  localParts,
  getPlanDay,
  shouldLevelUp,
  weeksSincePlan,
} from "./domain/progression";
import { rankOf, streakMilestones, weekStartStr, weekStreak } from "./domain/records";
import { stalledLifts } from "./domain/analysis";
import { ADJUST_COOLDOWN_DAYS, calorieAdjustment } from "./domain/adaptiveCalories";
import { suggestReminderHour } from "./domain/reminderTiming";
import { missedConsecutiveWorkouts, nutritionLapse } from "./domain/atrisk";
import { sessionTimeFor } from "./domain/sessionTz";
import { cleanAi, escapeHtml, t } from "./locales/i18n";
import { chunkReport, renderDay } from "./render";
import { aiText } from "./ai/index";
import { weeklyNarrativeSystem } from "./ai/prompts";
import { buildOwnerReport, computeBoards, finalizeOnboardingPlan, retryInterviewStep, surveyKb, surveyRemaining } from "./bot";
import { APP_VERSION } from "./webapp/appVersion";
import { advanceMesocycle, phaseGuidance, phaseKey } from "./domain/mesocycle";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/**
 * Persist a scheduler-internal failure to error_logs, where /ownerreport → Errors actually reads
 * from — console.error alone only reaches whoever happens to be running `wrangler tail` live.
 *
 * Deliberately NOT used for individual bot.api.sendMessage failures (blocked bot, deleted chat):
 * those are routine at any real user count and would drown the signal that matters — the
 * recovery sweeps and report generation breaking — under noise. This covers exactly the sites
 * that were already being console.error'd as "this needed someone's attention," so nothing about
 * the error taxonomy is invented here, only where each one goes.
 */
function logSchedulerError(db: D1Database, kind: string, e: unknown, userId?: number): void {
  console.error(kind, userId, e);
  recordError(db, { userId, kind, errorType: "exception", message: String(e).slice(0, 200) }).catch(() => {});
}
const CHECKIN_HOUR = 20;
const EVENING_HOUR = 21; // one combined evening survey (water / steps / food / check-in) — 9pm local
const QUALITY_EVERY_DAYS = 14; // recurring "rate trix + what's missing" quality/feedback ask

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string | undefined, toIso: string): number {
  if (!fromIso) return Infinity;
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

/** Drop a "60 kg" load by ~10% (rounded to 2.5 kg) to restart progression on a plateau swap. */
function deload10(s: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(s.trim());
  if (!m) return s; // "Bodyweight" etc.
  const kg = Math.max(2.5, Math.round((parseFloat(m[1]) * 0.9) / 2.5) * 2.5);
  return `${kg}${m[2] ? " " + m[2].trim() : " kg"}`;
}

/** Pick a same-muscle catalog alternative for a stalled/maxed exercise (EN+UK attached),
 * preserving the set scheme. `harder` aims one difficulty up (for maxed bodyweight lifts);
 * otherwise it's a fresh variation at a slightly reduced load to break a plateau. Best-effort. */
async function swapExercise(
  db: D1Database,
  lang: string,
  ex: PlanExercise,
  usedIds: Set<string>,
  harder: boolean,
): Promise<PlanExercise | null> {
  if (!ex.exerciseId) return null;
  const cat = await getCatalogExercise(db, ex.exerciseId);
  if (!cat) return null;
  let pick = harder ? await findHarderExercise(db, cat.muscle, cat.difficulty ?? "beginner", [...usedIds]) : null;
  if (!pick) {
    const cands = await listCandidatesByMuscles(db, [cat.muscle], { perMuscle: 25, total: 25 });
    pick = cands.find((c) => !usedIds.has(c.id) && c.id !== ex.exerciseId) ?? null;
  }
  if (!pick) return null;
  let name = pick.name;
  let technique = cleanAi(pick.instructions || "");
  if (lang !== "en") {
    const tr = await getExerciseTranslation(db, pick.id, lang);
    if (tr) { name = tr.name; technique = cleanAi(tr.instructions); }
  }
  return {
    ...ex,
    name,
    technique,
    exerciseId: pick.id,
    canonicalName: pick.name,
    startWeight: harder ? ex.startWeight : deload10(ex.startWeight),
  };
}

/** Apply plateau / maxed-bodyweight swaps to a (cloned) plan in place, returning the localized
 * notification lines. Mutates `plan.split` exercises. */
async function applySwaps(
  db: D1Database,
  lang: string,
  plan: PlanDoc,
  names: { name: string; harder: boolean }[],
): Promise<string[]> {
  const lines: string[] = [];
  const usedIds = new Set(plan.split.flatMap((d) => d.exercises.map((e) => e.exerciseId).filter(Boolean) as string[]));
  for (const { name, harder } of names) {
    for (const day of plan.split) {
      const i = day.exercises.findIndex((e) => e.name === name);
      if (i < 0) continue;
      const repl = await swapExercise(db, lang, day.exercises[i], usedIds, harder);
      if (repl) {
        if (repl.exerciseId) usedIds.add(repl.exerciseId);
        const from = day.exercises[i].name;
        day.exercises[i] = repl;
        lines.push(t(lang as "en" | "uk", harder ? "progression_levelup_ex" : "progression_swap_ex", { from, to: repl.name }));
      }
      break;
    }
  }
  return lines;
}

// Push the owner an alert when something operationally wrong is happening (no need to open /report).
// Each alert type is throttled to once per hour via config.alertState so it never spams.
async function checkOwnerAlerts(db: D1Database, bot: Bot): Promise<void> {
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

export async function runSchedule(env: Env): Promise<void> {
  const db = env.DB;
  // Only one cron run at a time. Heavy runs detached via waitUntil can outlive their minute; without
  // this lock the next cron starts concurrently and re-sends the same reminders (identical-spam).
  if (!(await acquireScheduleLock(db, Date.now(), 150_000).catch(() => true))) return;
  // Heartbeat for the dead-man switch above (stamped after the lock so concurrent runs don't race).
  await setSetting(db, "cron_heartbeat", new Date().toISOString()).catch(() => {});
  try {
    await runScheduleInner(env);
  } finally {
    await releaseScheduleLock(db).catch(() => {});
  }
}

async function runScheduleInner(env: Env): Promise<void> {
  const db = env.DB;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Rest-timer nudges — one-shot "rest over" pings scheduled from the guided logger.
  // Sends run in parallel (timeliness is the whole point) and the rows go in one DELETE.
  const rests = await dueRestTimers(db, new Date().toISOString()).catch(() => []);
  if (rests.length) {
    await Promise.allSettled(
      rests.map((r) => bot.api.sendMessage(r.chatId, t(r.lang as "en" | "uk", "rest_done"), HTML)),
    );
    await deleteRestTimers(db, rests.map((r) => r.userId)).catch(() => {});
  }

  // The three onboarding-recovery sweeps below run every tick; a single cheap COUNT gates them
  // so an idle system (no one mid-onboarding / plan-pending) does 1 query instead of 3.
  if ((await pendingRecoveryCount(db).catch(() => 1)) > 0) {
  // Auto-retry failed onboarding AI calls — fires every cron tick.
  const retryUsers = await listRetryUsers(db, new Date().toISOString()).catch(() => []);
  for (const u of retryUsers) {
    retryInterviewStep(env, db, u).catch((e) => logSchedulerError(db, "retry_interview", e, u._id));
  }

  // SAFETY NET: recover onboarding users the bot owes a reply but never sent one — the
  // webhook isolate died mid AI-call, so neither the answer nor a retryAfter was written
  // (no in-request code can self-heal a killed invocation). We pick users idle >90s (to
  // avoid racing a live reply) whose LAST transcript turn is the user's, and re-run the
  // interview step (which generates + sends the next question, or sets retryAfter on failure).
  const owed = await listOnboardingOwedReply(db, new Date(Date.now() - 90_000).toISOString()).catch(() => []);
  for (const u of owed) {
    const transcript = u.session.transcript ?? [];
    if (transcript[transcript.length - 1]?.role === "user") {
      // Awaited so the cron isolate (kept alive by waitUntil) doesn't get torn down before
      // the AI call + send finish. Sequential is fine — owed users are rare.
      await retryInterviewStep(env, db, u).catch((e) => logSchedulerError(db, "owed_onboarding_recover", e, u._id));
    }
  }

  // SAFETY NET 2: users whose interview finished but the plan never generated (the background
  // plan-gen died, or it failed). Process ONE per cron tick: each plan generation makes many
  // subrequests (AI provider chain), and processing multiple users per invocation triggers
  // Cloudflare's "Too many subrequests" limit.
  const pendingPlan = await listPlanPendingUsers(db, new Date(Date.now() - 90_000).toISOString()).catch(() => []);
  if (pendingPlan.length > 0) {
    // Recover with the zero-AI bank plan first: a slow AI chain here blocks the whole cron
    // invocation (and can exceed its CPU limit) before the reminder/check-in section runs.
    await finalizeOnboardingPlan(env, db, pendingPlan[0], { preferBank: true }).catch((e) => logSchedulerError(db, "plan_pending_recover", e, pendingPlan[0]._id));
  }
  } // end pendingRecoveryCount gate

  // Daily nudge for users stuck in onboarding (waiting for their reply, no AI failure).
  // Fires once per day at noon UTC to avoid spamming.
  const utcNow = localParts("UTC");
  if (utcNow.hour === 12 && utcNow.minute < 5) {
    const today = utcNow.date;
    const stuckUsers = await listStuckOnboardingUsers(db, today).catch(() => []);
    for (const u of stuckUsers) {
      try {
        const transcript = u.session.transcript ?? [];
        // Find the last bot question to re-send it as a reminder.
        const lastBotMsg = [...transcript].reverse().find((t) => t.role === "assistant");
        const nudgeText = lastBotMsg?.text ?? "Привіт! Продовжуємо? Надішли відповідь — і я складу план для тебе.";
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: u.chatId, text: nudgeText, parse_mode: "HTML" }),
        });
        // Mark today's nudge so we don't send it again today (in the reminders column, so a
        // user-facing session write can't wipe it).
        await updateUser(db, u._id, { reminders: { ...u.reminders, lastNudge: today } });
      } catch (e) {
        logSchedulerError(db, "stuck_onboarding_nudge", e, u._id);
      }
    }
  }

  // ---- HOURLY SECTION ----
  // Everything below is hour-grained (reminders are date-deduped, alerts hour-throttled), while
  // the cron fires every minute purely for the cheap onboarding-recovery sweeps above. Running
  // the full per-user pass every minute multiplied D1 reads ~60× for nothing. One settings row
  // marks the last completed hour so a lock-skipped :00 tick is retried next minute, not lost.
  const hourKey = `${utcNow.date}T${String(utcNow.hour).padStart(2, "0")}`;
  const lastPass = await getSetting(db, "last_user_pass").catch(() => null);
  if (lastPass === hourKey) return;
  await setSetting(db, "last_user_pass", hourKey).catch(() => {});

  // Housekeeping: drop dedup rows older than 1h (SQLite has no TTL). Moved out of the every-minute
  // path into the hourly pass — rows live at most ~2h instead of ~1h, which is harmless.
  await pruneSeenUpdates(db, new Date(Date.now() - 3_600_000).toISOString()).catch(() => {});

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
    await setSetting(db, "last_log_prune", new Date().toISOString()).catch(() => {});
  }

  // Weekly reports moved into processUser (per-user local timezone at 17:00).

  const users = await listOnboardedUsers(db);
  // Bulk-prefetch the two reads EVERY processUser needs — one query for all active plans and
  // one for recent workout logs (covers each timezone's "today") — instead of 2 queries × N
  // users. The rest of processUser's reads are conditional and stay per-user.
  const [activePlans, recentLogs] = await Promise.all([
    listActivePlans(db).catch(() => [] as PlanDoc[]),
    allWorkoutLogsSince(db, isoDaysAgo(1)).catch(() => []),
  ]);
  const pass: SharedPass = {
    planByUser: new Map(activePlans.map((p) => [p.userId, p])),
    logByUserDate: new Map(recentLogs.map((l) => [`${l.userId}:${l.date}`, l])),
    // Weekly-narrative AI budget per invocation — same idea as the plan-pending "one per tick"
    // cap: each narrative is a full AI-chain call (many subrequests). Unsent users keep their
    // dedup key unset, so the next hourly pass picks them up.
    narrativeBudget: 5,
    boardsByDay: new Map(),
  };
  for (const user of users) {
    try {
      await processUser(env, bot, user, pass);
    } catch (err) {
      logSchedulerError(db, "schedule_user", err, user._id);
    }
  }

  // Past confirmed sessions become "done" (single sweep, UTC today — a few hours' slack is fine).
  // Completed sessions decrement the client's prepaid package; then nudge trainers whose
  // client's paid period expired or package ran out (deduped per expiry via nudgedAt).
  const donePairs = await markPastSessionsDone(db, isoDaysAgo(0)).catch(() => [] as { trainerId: number; clientId: number }[]);
  for (const p of donePairs) await decrementSessionsLeft(db, p.trainerId, p.clientId).catch(() => {});
  const billingDue = await listBillingDue(db, isoDaysAgo(0)).catch(() => []);
  // A trainer whose whole roster expires together would be re-fetched per row — memoize.
  const userCache = new Map<number, UserDoc | null>();
  const cachedUser = async (id: number) => {
    if (!userCache.has(id)) userCache.set(id, await getUser(db, id));
    return userCache.get(id) ?? null;
  };
  for (const b of billingDue) {
    const [trainer, client] = await Promise.all([cachedUser(b.trainerId), cachedUser(b.clientId)]);
    if (trainer && client && !trainer.botBlocked) {
      const name = client.profile.name ?? `id ${client._id}`;
      const key = b.sessionsLeft === 0 ? "bill_nudge_sessions" : "bill_nudge_paid";
      const kb = new InlineKeyboard().text(t(trainer.lang, "cc_billing"), `cl:${client._id}:bill`);
      await bot.api.sendMessage(trainer.chatId, t(trainer.lang, key, { name }), { ...HTML, reply_markup: kb }).catch(() => {});
    }
    await markBillingNudged(db, b.trainerId, b.clientId, isoDaysAgo(0)).catch(() => {});
  }

  // Vacation ended → run the comeback interview once. Set the session and send the opener + first
  // (free-text) question; the user's replies are then handled by the normal bot flow.
  const nowIso = new Date().toISOString();
  const ended = await listVacationEnded(db, nowIso).catch(() => [] as UserDoc[]);
  for (const u of ended) {
    if (u.blocked || u.botBlocked) {
      await markComebackDone(db, u._id, nowIso).catch(() => {});
      continue;
    }
    try {
      await updateUser(db, u._id, { session: { mode: "comeback", comeback: { step: 0, answers: {} } } });
      await markComebackDone(db, u._id, nowIso);
      await bot.api.sendMessage(u.chatId, `${t(u.lang, "vacation_ended")}\n\n${t(u.lang, "comeback_q_feel")}`, HTML);
    } catch (err) {
      logSchedulerError(db, "comeback_opener", err, u._id);
    }
  }
}

interface SharedPass {
  planByUser: Map<number, PlanDoc>;
  logByUserDate: Map<string, import("./types").WorkoutLogDoc>;
  narrativeBudget: number;
  // Leaderboards memoized by the viewer's local "today" (1-2 distinct values per tick) —
  // computing them per competitor re-ran the same aggregate queries N times.
  boardsByDay: Map<string, Promise<import("./bot").BoardsResult>>;
}

async function processUser(env: Env, bot: Bot, user: UserDoc, pass: SharedPass) {
  const db = env.DB;
  const lang = user.lang;
  // Owner-banned or bot-blocked users are skipped entirely — no point sending into a dead chat,
  // and it stops the every-minute 403 retry loop.
  if (user.blocked || user.botBlocked) return;
  // On vacation → don't disturb (no reminders/nudges) until it ends.
  if (user.vacationUntil && user.vacationUntil > new Date()) return;
  // No timezone set → reminders would fire on the UTC clock (~3h late for UA users → at night).
  // Default UA-language users to the bot's home tz so nudges land at a sane local hour.
  const tz = user.profile.timezone ?? (user.lang === "uk" ? "Europe/Kyiv" : "UTC");
  const { date, weekday, hour } = localParts(tz);

  // All reminder sends to the user go through this so a single failure can't abort the rest of
  // processUser (which would skip flushReminders and re-fire next tick). A 403 means the user
  // blocked the bot → flag them so we stop trying.
  let botBlocked = false;
  const send = async (text: string, extra?: Parameters<typeof bot.api.sendMessage>[2]) => {
    if (botBlocked) return;
    try {
      await bot.api.sendMessage(user.chatId, text, extra ?? HTML);
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) {
        botBlocked = true;
        await updateUser(db, user._id, { botBlocked: true }).catch(() => {});
      } else {
        console.error("reminder send error", user._id, err);
      }
    }
  };
  // Explicit reminderHour wins; otherwise derive from sleep schedule (early risers get a
  // morning nudge, night owls keep the 18:00 default).
  const reminderHour = user.profile.reminderHour ?? (user.profile.sleepSchedule === "morning" ? 8 : 18);
  // Mini App deep link for reminder buttons — opens the app at a specific view in one tap.
  const appView = (view: string) => (env.WORKER_URL ? `${env.WORKER_URL}/app?v=${APP_VERSION}&view=${view}` : undefined);
  // A day is a "training day" if the ACTIVE PLAN has a session for it (the source of truth /today
  // uses) — falling back to the profile's chosen weekdays only when there's no plan. This keeps
  // reminders consistent with the plan even if profile.trainingWeekdays drifts / is empty.
  const activePlan = pass.planByUser.get(user._id) ?? null;
  const planDays = new Set((activePlan?.split ?? []).map((d) => d.weekday));
  const trainsOn = (wd: Weekday) =>
    planDays.size ? planDays.has(wd) : (user.profile.trainingWeekdays ?? []).includes(wd);
  const isTrainingDay = trainsOn(weekday as Weekday);
  // Today's workout log — from the bulk prefetch, reused by the workout/checkin/wellbeing/
  // tomorrow gates (so the same day's training nudges agree and don't each re-query).
  const loggedToday = pass.logByUserDate.get(`${user._id}:${date}`) ?? null;

  // Deduplication: each reminder key stores the last date it was sent.
  // We only send a reminder if it hasn't been sent today yet.
  // Reminder dedup state lives in the dedicated `reminders` column (decoupled from session, which
  // user-facing writes replace). Fall back to the old session field once, for users not yet migrated.
  const sent = user.reminders?.sent ?? user.session.lastReminders ?? {};
  const dirty: Record<string, string> = {};

  const already = (key: string) => sent[key] === date;
  const markSent = (key: string) => { dirty[key] = date; };
  // Send at most ONE user-facing reminder per tick. The cron runs every minute, so the rest fire
  // on subsequent ticks (a few minutes apart) instead of arriving as a 4-in-a-row burst.
  // Quiet hours: during the user's do-not-disturb window, suppress ALL personal nudges by
  // pre-setting `pinged` (session/trainer alerts are separate and stay). A missed nudge simply
  // fires on a later tick once the window ends — dedup keys are only written on actual sends.
  let pinged = inQuietHours(hour, user.profile.quietFrom, user.profile.quietTo);
  // Per-user reminder preferences: a type the user switched off in Settings is never sent.
  const remOff = (key: string) => user.profile.remindersOff?.includes(key) ?? false;
  const flushReminders = async () => {
    if (Object.keys(dirty).length === 0) return;
    const merged = { ...sent, ...dirty };
    await updateUser(db, user._id, { reminders: { ...user.reminders, sent: merged } });
  };

  // Dedup MUST persist even if a later block throws (heavy Monday work, owner report, AI calls).
  // Otherwise the every-minute cron never records what it already sent and re-fires every reminder
  // each minute → spam. The finally below guarantees the flush regardless of any exception.
  try {
  // Referral reward: this user came via a ref_<id> link and has now finished onboarding →
  // award the inviter the 🤝 badge once (permanent mark via reminders.sent["ref_reward"]).
  if (user.onboarded && user.profile.referredBy && !sent["ref_reward"]) {
    const inviter = await getUser(db, user.profile.referredBy).catch(() => null);
    if (inviter && !inviter.blocked) {
      await awardAchievement(db, inviter._id, "referral").catch(() => {});
      const name = user.profile.name ?? `id ${user._id}`;
      await bot.api.sendMessage(inviter.chatId, t(inviter.lang, "ref_joined", { name }), HTML).catch(() => {});
    }
    markSent("ref_reward");
  }
  // Trainer at-risk alert — client missed 2 consecutive planned days, or lapsed on food after
  // being regular. Sent to the TRAINER (independent of the user-facing one-per-tick cap) with the
  // existing "message client" button; deduped so it re-fires only on a NEW miss / lapse.
  // At-risk state (missed consecutive days / nutrition lapse) changes at DAY granularity, so the
  // two 21-day reads only need to run once per day, not every hour>=10 pass (~14×/day → 1×/day).
  if (user.role === "client" && user.trainerId && hour >= 10 && !already("atrisk_check")) {
    markSent("atrisk_check");
    const [wl, nl] = await Promise.all([
      workoutLogsSince(db, user._id, isoDaysAgo(21)),
      nutritionLogsSince(db, user._id, isoDaysAgo(21)),
    ]);
    // Workout at-risk needs an ACTIVE (assigned) plan — a client with only a draft has nothing to
    // follow. Floor the window to the later of plan-start / join date so a new client is never
    // credited with "missing" sessions that predate them (the false-alert bug).
    let missed: [string, string] | null = null;
    if (activePlan?.split.length) {
      const genD = activePlan.generatedAt.toISOString().slice(0, 10);
      const joinD = user.createdAt.toISOString().slice(0, 10);
      const floor = genD > joinD ? genD : joinD;
      missed = missedConsecutiveWorkouts(activePlan.split.map((d) => d.weekday), wl.filter((l) => l.completed).map((l) => l.date), date, floor);
    }
    const lapse = nutritionLapse(nl.map((l) => l.date), date);
    const fireWorkout = missed && sent["atrisk_workout"] !== missed[1];
    const fireNutrition = lapse && sent["atrisk_nutrition"] !== lapse.lastLogged;
    if (fireWorkout || fireNutrition) {
      const trainer = await getUser(db, user.trainerId);
      if (trainer) {
        const name = user.profile.name ?? `id ${user._id}`;
        const kb = new InlineKeyboard().text(t(trainer.lang, "cc_message"), `cl:${user._id}:msg`);
        if (fireWorkout) {
          await bot.api.sendMessage(trainer.chatId, t(trainer.lang, "atrisk_workout_alert", { name, d1: missed![0], d2: missed![1] }), { ...HTML, reply_markup: kb }).catch((e) => console.error("atrisk workout", e));
          dirty["atrisk_workout"] = missed![1];
        }
        if (fireNutrition) {
          await bot.api.sendMessage(trainer.chatId, t(trainer.lang, "atrisk_nutrition_alert", { name, n: lapse!.gapDays }), { ...HTML, reply_markup: kb }).catch((e) => console.error("atrisk nutrition", e));
          dirty["atrisk_nutrition"] = lapse!.lastLogged;
        }
      }
    }
  }

  // Session reminders (both roles): day-before at 20:00 and same-day ~2h before, per confirmed
  // booking. Deduped per session id via reminders.sent so each fires once.
  const sessRole: "trainer" | "client" | null = user.role === "trainer" ? "trainer" : user.role === "client" ? "client" : null;
  if (sessRole && !remOff("session")) {
    const tomorrow = new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
    // Fetch ±1 day around [today, tomorrow] on the STORED axis: the reminder filter compares
    // CONVERTED dates, and a cross-timezone session near midnight can live on an adjacent
    // stored date (fetching narrow silently dropped those reminders).
    const dayAfter = new Date(Date.parse(date) + 2 * 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
    const confirmed = (await sessionsBetween(db, user._id, sessRole, yesterday, dayAfter)).filter((s) => s.status === "confirmed");
    const counterpartId = (s: (typeof confirmed)[number]) => (sessRole === "trainer" ? s.clientId : s.trainerId);
    const others = await getUsersByIds(db, confirmed.map(counterpartId)); // one query, not one per session
    for (const s of confirmed) {
      if (pinged) break;
      const other = others.get(counterpartId(s));
      const withName = other?.profile.name ?? "…";
      // The stored wall time lives in the booker's zone — convert to THIS user's zone.
      const local = sessionTimeFor(s.date, s.hour, s.tz, tz);
      // Link goes into a parse_mode:HTML message — escape it or a "<" in a query string
      // 400s the send and the dedup key still burns, permanently losing the reminder.
      const linkLine = s.meetingLink ? `\n${escapeHtml(s.meetingLink)}` : "";
      if (local.date === tomorrow && hour >= 20 && sent[`sess_tomorrow_${s.id}`] !== s.date) {
        await send(t(lang, "sess_tomorrow", { hour: local.hour, name: withName }) + linkLine);
        dirty[`sess_tomorrow_${s.id}`] = s.date;
        pinged = true;
      } else if (local.date === date && hour >= Math.max(8, local.hour - 2) && sent[`sess_today_${s.id}`] !== s.date) {
        await send(t(lang, "sess_today", { hour: local.hour, name: withName }) + linkLine);
        dirty[`sess_today_${s.id}`] = s.date;
        pinged = true;
      }
    }
  }

  // Workout reminder — fires at user's chosen hour on training days if not logged yet.
  if (!pinged && !remOff("workout") && hour >= reminderHour && isTrainingDay && !already("workout")) {
    const plan = activePlan;
    const day = plan ? getPlanDay(plan, weekday) : undefined;
    if (day && !loggedToday) {
      const wd = weekday;
      const kb = new InlineKeyboard()
        .text(t(lang, "log_done"), "log:done")
        .text(t(lang, "log_skip"), "log:skip")
        .row()
        .text(t(lang, "swap_btn"), `swap:${wd}`).row()
        .text(t(lang, "plan_diff_edit_weight"), `wt:open:${wd}`);
      const logUrl = appView("log");
      if (logUrl) kb.row().webApp(t(lang, "app_log_btn"), logUrl);
      const text =
        t(lang, "reminder_workout", { group: day.muscleGroup }) + "\n\n" + renderDay(lang, day, undefined, "none");
      await send(text, { ...HTML, reply_markup: kb });
      markSent("workout");
      pinged = true;
    }
  }

  // Water reminders on a schedule (opt-in via profile.waterEvery = 2/3/4h). Fire at 9:00–20:00
  // local, every N hours from 9, only while today's goal isn't met yet. Off by default.
  const waterEvery = user.profile.waterEvery ?? 0;
  if (!pinged && waterEvery >= 2 && !remOff("water") && hour >= 9 && hour <= 20 && (hour - 9) % waterEvery === 0) {
    const goal = resolveWaterGoal(user.profile);
    const ml = (await getWater(db, user._id, date).catch(() => 0)) ?? 0;
    if (ml < goal) {
      const kb = new InlineKeyboard().text("💧 +250", "water:add:250").text("💧 +500", "water:add:500");
      await send(t(lang, "water_reminder", { ml, goal }), { ...HTML, reply_markup: kb });
      pinged = true;
    }
  }

  // Evening daily survey (EVENING_HOUR) — ONE message covering water / steps / food / check-in
  // instead of four separate nudges. Each button appears only when that item isn't done yet today
  // and the user hasn't switched it off. Deduped once per day via reminders.sent["survey"].
  if (!pinged && user.onboarded && hour >= EVENING_HOUR && !already("survey")) {
    // ALL applicable daily logs (food / water / steps / check-in) not yet done today. Buttons use
    // sv:* callbacks so completing one re-shows the checklist with what's still left (see bot.ts).
    const items = await surveyRemaining(db, user, date, lang);
    if (items.length) {
      const kb = surveyKb(items);
      const surveyUrl = appView("survey");
      if (surveyUrl) {
        if (kb.inline_keyboard[kb.inline_keyboard.length - 1]?.length) kb.row();
        kb.webApp(t(lang, "app_survey_btn"), surveyUrl);
      }
      await send(t(lang, "survey_prompt"), { ...HTML, reply_markup: kb });
      markSent("survey");
      pinged = true;
    }
  }

  // Pre-workout readiness check — on a TRAINING day, ~1h before the planned workout. Fired in
  // the morning/pre-session window (not the evening) so "sleep" means last night and the advice
  // ("train as planned" / "go lighter today") lands before the session, when it's actionable.
  const readinessHour = Math.max(6, reminderHour - 1);
  // Pre-session window ONLY (readinessHour..reminderHour) — keeps this a morning check so it no
  // longer doubles up with the evening workout/checkin nudges.
  if (!pinged && !remOff("wellbeing") && isTrainingDay && hour >= readinessHour && hour < reminderHour && !already("wellbeing")) {
    const done = await getDailyCheckin(db, user._id, date);
    if (!loggedToday && !done) {
      const kb = new InlineKeyboard().text(t(lang, "menu_checkin"), "checkin:start");
      await send(t(lang, "reminder_wellbeing"), { ...HTML, reply_markup: kb });
      markSent("wellbeing");
      pinged = true;
    }
  }

  // Day-before heads-up: in the evening, if TOMORROW is a training day.
  const tomorrow = (weekday === 7 ? 1 : weekday + 1) as Weekday;
  // Skip tomorrow's preview when today is still an unlogged training day — don't pile a 3rd
  // training ping on top of today's workout/checkin nudges.
  if (!pinged && !remOff("tomorrow") && hour >= CHECKIN_HOUR && trainsOn(tomorrow) && !(isTrainingDay && !loggedToday) && !already("tomorrow")) {
    const plan = activePlan;
    const day = plan ? getPlanDay(plan, tomorrow) : undefined;
    if (day) {
      const text =
        t(lang, "reminder_tomorrow", { group: day.muscleGroup }) + "\n\n" + renderDay(lang, day, undefined, "none");
      await send(text);
      markSent("tomorrow");
      pinged = true;
    }
  }

  // Injury follow-up — when a reported injury's check-after date arrives, ask how it feels.
  // Per-injury dedup via lastAskedAt (not reminders.sent), so it re-asks daily until resolved.
  if (!pinged && hour >= reminderHour) {
    const due = await listInjuriesDue(db, user._id, date);
    if (due.length) {
      const inj = due[0];
      const area = t(lang, `inj_area_${inj.area}` as Parameters<typeof t>[1]);
      // A 4-level pain scale beats binary OK/more — the trainer/coach and the trend view can
      // both use the score, and the user does one tap either way.
      const kb = new InlineKeyboard()
        .text(t(lang, "inj_score_0"), `inj:sc:${inj.id}:0`)
        .text(t(lang, "inj_score_3"), `inj:sc:${inj.id}:3`)
        .row()
        .text(t(lang, "inj_score_6"), `inj:sc:${inj.id}:6`)
        .text(t(lang, "inj_score_8"), `inj:sc:${inj.id}:8`);
      await send(t(lang, "inj_check_q", { area }), { ...HTML, reply_markup: kb });
      await markInjuryAsked(db, inj.id, date);
      pinged = true;
    }
  }

  // Recurring quality & feedback ask — every QUALITY_EVERY_DAYS, at the user's reminder hour.
  // Not a one-off campaign: keeps a rating + "what's missing" channel open for onboarded users.
  // Dedup reuses reminders.sent["quality"] but with a multi-day cadence (not the daily === check).
  if (!pinged && user.onboarded && !remOff("quality") && hour >= reminderHour) {
    const lastQ = sent["quality"];
    const dueQ = !lastQ || (Date.parse(date) - Date.parse(lastQ)) / 86_400_000 >= QUALITY_EVERY_DAYS;
    if (dueQ) {
      const kb = new InlineKeyboard()
        .text("⭐", "qr:1").text("⭐⭐", "qr:2").text("⭐⭐⭐", "qr:3")
        .row()
        .text("⭐⭐⭐⭐", "qr:4").text("⭐⭐⭐⭐⭐", "qr:5");
      await send(t(lang, "reminder_quality"), { ...HTML, reply_markup: kb });
      markSent("quality");
      pinged = true;
    }
  }

  // Weekly measurement check-in — Sunday at the user's reminder hour, once.
  if (!pinged && !remOff("measure") && weekday === 7 && hour >= reminderHour && !already("measure")) {
    const kb = new InlineKeyboard().text(t(lang, "menu_measure"), "menu:measure");
    await send(t(lang, "reminder_measure"), { ...HTML, reply_markup: kb });
    markSent("measure");
    pinged = true;
  }

  // Weekly digest — Sunday recap of the last 7 days. Only if there was some activity.
  if (!pinged && !remOff("digest") && weekday === 7 && hour >= reminderHour && !already("digest")) {
    const since = isoDaysAgo(7);
    const [wl, nl, sl, body] = await Promise.all([
      workoutLogsSince(db, user._id, since),
      nutritionLogsSince(db, user._id, since),
      stepLogsSince(db, user._id, since),
      bodyLogsByUser(db, user._id),
    ]);
    const doneN = wl.filter((w) => w.completed).length;
    if (doneN || nl.length) {
      const parts: string[] = [t(lang, "wdigest_header")];
      parts.push(t(lang, "wdigest_workouts", { n: doneN }));
      if (nl.length) {
        const avgKcal = Math.round(nl.reduce((s, n) => s + n.meals.reduce((m, x) => m + (x.kcal || 0), 0), 0) / nl.length);
        parts.push(t(lang, "wdigest_nutrition", { kcal: avgKcal, n: nl.length }));
      }
      if (sl.length) parts.push(t(lang, "wdigest_steps", { avg: Math.round(sl.reduce((s, l) => s + l.steps, 0) / sl.length) }));
      const recentBody = body.filter((b) => typeof b.weight === "number" && b.weight! > 0).slice(-2);
      if (recentBody.length === 2) {
        const d = +(recentBody[1].weight! - recentBody[0].weight!).toFixed(1);
        parts.push(t(lang, "wdigest_weight", { w: recentBody[1].weight!, delta: d > 0 ? `+${d}` : `${d}` }));
      }
      const kb = new InlineKeyboard()
        .text(t(lang, "menu_progress"), "menu:progress")
        .text(t(lang, "wcard_btn"), "share:week");
      await send(parts.join("\n"), { ...HTML, reply_markup: kb });
      markSent("digest");
      pinged = true;
    }
  }

  // Plateau heads-up — Monday, at most once every 2 weeks (a genuine plateau takes weeks to
  // confirm, and adding weight with a rep reset is NOT a plateau — see stalledLifts). Names the
  // stuck lifts and points at the coach; the cooldown stops it nagging every single Monday.
  if (!pinged && !remOff("plateau") && weekday === 1 && hour >= reminderHour && daysBetween(sent["plateau"], date) >= 14) {
    const stalled = stalledLifts(await listStrength(db, user._id), date);
    if (stalled.length) {
      const kb = new InlineKeyboard().text(t(lang, "menu_coach"), "menu:coach");
      await send(t(lang, "plateau_nudge", { lifts: stalled.slice(0, 2).map(escapeHtml).join(", ") }), { ...HTML, reply_markup: kb });
      markSent("plateau");
      pinged = true;
    }
  }

  // Weekly cycle-setup nudge — Monday, once per week. Sent to female users who are onboarded
  // but haven't yet enabled cycle tracking OR enabled it but never logged a period start.
  // The one-button CTA takes them straight to Settings → Cycle tracking.
  if (!pinged && weekday === 1 && hour >= reminderHour && user.onboarded && user.profile.sex === "female" && !already("cycle_nudge")) {
    const needsSetup = !user.profile.cycleTracking || !user.profile.lastPeriodStart;
    if (needsSetup) {
      const kb = new InlineKeyboard().text(t(lang, "cycle_nudge_btn"), "set:cycle");
      await send(t(lang, "cycle_nudge"), { ...HTML, reply_markup: kb });
      markSent("cycle_nudge");
      pinged = true;
    }
  }

  // The Monday weekly blocks below each re-read the same 21-day workout log and the full
  // body-log history; fetch each at most once per tick and reuse (sliced in memory per block).
  let w21p: Promise<WorkoutLogDoc[]> | undefined;
  const workouts21 = () => (w21p ??= workoutLogsSince(db, user._id, isoDaysAgo(21)));
  let bodyAllP: Promise<BodyLogDoc[]> | undefined;
  const bodyAll = () => (bodyAllP ??= bodyLogsByUser(db, user._id).catch(() => []));

  // Deload autopilot — Monday morning. Calendar trigger (~every 7th week) OR an adherence
  // trigger: several recent missed/grinding sessions → propose a lighter recovery week early.
  if (!pinged && weekday === 1 && hour >= reminderHour && user.role !== "client" && !already("deload")) {
    const plan = activePlan;
    if (plan) {
      const calendarDue = deloadWeekDue(plan.generatedAt.toISOString().slice(0, 10), date);
      const adherenceDue = !calendarDue && adherenceDeloadDue(await workouts21());
      if (calendarDue || adherenceDue) {
        const kb = new InlineKeyboard().text(t(lang, "menu_coach"), "menu:coach");
        await send(t(lang, adherenceDue ? "deload_adherence" : "deload_week"), { ...HTML, reply_markup: kb });
        markSent("deload");
        pinged = true;
      }
    }
  }

  // Adaptive calories — Monday, at most every 2 weeks. Compares the logged weight trend against
  // the goal's implied rate and nudges the kcal target (±150 max). Solo/trainer users only (a
  // client's targets belong to their trainer); requires a goal weight and consistent logging —
  // all the gates live in domain/adaptiveCalories.
  if (
    !pinged &&
    weekday === 1 &&
    hour >= reminderHour &&
    user.role !== "client" &&
    user.profile.goalWeight &&
    user.nutrition &&
    daysBetween(sent["cal_adjust"], date) >= ADJUST_COOLDOWN_DAYS
  ) {
    const windowDays = 21;
    const [bodyLogs, nLogs] = await Promise.all([
      bodyAll(),
      nutritionLogsSince(db, user._id, isoDaysAgo(windowDays)),
    ]);
    const since = isoDaysAgo(windowDays);
    const adj = calorieAdjustment({
      currentCalories: user.nutrition.calories,
      goalWeight: user.profile.goalWeight,
      weights: bodyLogs
        .filter((b) => b.date >= since && typeof b.weight === "number" && (b.weight as number) > 0)
        .map((b) => ({ date: b.date, weight: b.weight as number })),
      loggedNutritionDays: new Set(nLogs.map((l) => l.date)).size,
      windowDays,
    });
    if (adj) {
      await updateUser(db, user._id, { nutrition: { ...user.nutrition, calories: adj.newCalories } });
      await send(
        t(lang, adj.deltaKcal < 0 ? "cal_adjust_down" : "cal_adjust_up", {
          old: user.nutrition.calories,
          new: adj.newCalories,
          trend: Math.abs(adj.slopePerWeek).toFixed(2),
          target: Math.abs(adj.targetPerWeek).toFixed(2),
        }),
      );
      pinged = true;
    }
    // Cooldown runs from the last EVALUATION (even a no-op), so a borderline trend isn't re-tested daily.
    markSent("cal_adjust");
  }

  // Smart reminder timing — Monday, re-offered at most every 30 days. If the user consistently
  // logs workouts at a different time of day than their reminder assumes, offer to move it.
  if (
    !pinged &&
    !remOff("workout") &&
    weekday === 1 &&
    hour >= reminderHour &&
    daysBetween(sent["smart_hour"], date) >= 30
  ) {
    const recentLogs = (await workoutLogsSince(db, user._id, isoDaysAgo(45))).filter((l) => l.completed);
    const hours = recentLogs.map((l) => localParts(tz, l.createdAt).hour);
    const suggested = suggestReminderHour(hours, reminderHour);
    if (suggested !== null) {
      const kb = new InlineKeyboard()
        .text(t(lang, "smart_hour_yes", { h: suggested }), `shour:yes:${suggested}`)
        .text(t(lang, "smart_hour_no"), "shour:no");
      await send(t(lang, "smart_hour_offer", { habit: suggested + 1, cur: reminderHour, new: suggested }), {
        ...HTML,
        reply_markup: kb,
      });
      pinged = true;
      markSent("smart_hour"); // cooldown from the offer, whatever the answer
    }
  }

  // Bi-weekly adaptive check-in — Monday of every 2nd plan week. DMs the user and parks
  // them in "checkin_adaptive" so their reply drives AI micro-adjustments to the live plan.
  if (!pinged && weekday === 1 && hour >= reminderHour && user.role !== "client" && !already("adaptive_checkin")) {
    const plan = activePlan;
    if (plan) {
      const w = weeksSincePlan(plan.generatedAt.toISOString().slice(0, 10), date);
      if (w > 0 && w % 2 === 0) {
        await send(t(lang, "adaptive_checkin_prompt"));
        // Persist the mode now — flushReminders no longer writes the session column.
        user.session = { ...user.session, mode: "checkin_adaptive" };
        await updateUser(db, user._id, { session: user.session });
        markSent("adaptive_checkin");
        pinged = true;
      }
    }
  }

  // Weekly progression-rate re-evaluation — Monday, from the last 3 weeks of logs.
  // Silent: just persists users.progression_rate for later autoregulation use.
  if (weekday === 1 && hour >= reminderHour && !already("progression_rate")) {
    const logs = await workouts21();
    if (logs.length) {
      const rate = evaluateProgressionRate(logs);
      if (rate !== user.progressionRate) await setProgressionRate(db, user._id, rate);
    }
    markSent("progression_rate");
  }

  // Weekly dynamic progression — Monday, silent. Analyses the last 3 weeks of logs + recent
  // check-ins and nudges weights/reps via double progression (guarded by wellbeing & plateau
  // detection). Solo/trainer-own plans are applied silently and the user is told; a client's
  // changes are staged as a DRAFT for their trainer to accept, edit, or discard.
  if (weekday === 1 && hour >= reminderHour && !already("progression")) {
    markSent("progression");
    const plan = activePlan;
    if (plan && plan.split.length) {
      const [logs, checkins] = await Promise.all([
        workouts21(),
        dailyCheckinsSince(db, user._id, isoDaysAgo(7)),
      ]);
      const prog = computePlanProgression(plan, logs, checkins);
      const week = weeksSincePlan(plan.generatedAt.toISOString().slice(0, 10), date);
      const isClient = user.role === "client" && !!user.trainerId;
      const updated = applyProgression(plan, prog.changes);
      // Act on the dynamics: plateaued lifts → fresh same-muscle variation at −10%; maxed
      // bodyweight lifts → a harder variation. Applied to the (solo) plan or the client draft.
      const swapTargets = [
        ...prog.plateau.map((n) => ({ name: n, harder: false })),
        ...prog.maxedBodyweight.map((n) => ({ name: n, harder: true })),
      ];
      const swapLines = swapTargets.length ? await applySwaps(db, lang, updated, swapTargets) : [];
      if (swapLines.length) await recordPlanSource(db, user._id, "plateau_swap", "bank").catch(() => {});
      const changed = prog.changes.length > 0 || swapLines.length > 0;
      if (changed) {
        const lineFor = (l: typeof lang) =>
          prog.changes.map((c) => t(l, "progression_line", { exercise: c.exercise, from: c.from, to: c.to }));
        if (isClient) {
          updated.authoredBy = user.trainerId;
          await saveDraftPlan(db, updated);
          await recordAdjustment(db, user._id, week, JSON.stringify(prog.changes));
          const trainer = await getUser(db, user.trainerId!);
          if (trainer) {
            const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
            const text = [t(trainer.lang, "progression_trainer_header", { name: who }), ...lineFor(trainer.lang), t(trainer.lang, "progression_trainer_hint")].join("\n");
            const kb = new InlineKeyboard()
              .text(t(trainer.lang, "cc_assign"), `cl:${user._id}:assign`)
              .text(t(trainer.lang, "cc_edit"), `cl:${user._id}:edit`)
              .row()
              .text(t(trainer.lang, "cc_discard"), `cl:${user._id}:discard`);
            await bot.api.sendMessage(trainer.chatId, text, { ...HTML, reply_markup: kb }).catch((e) => console.error("progression trainer notify", e));
          }
        } else {
          await setActivePlan(db, updated);
          await recordAdjustment(db, user._id, week, JSON.stringify(prog.changes));
          const text = [t(lang, "progression_solo_header"), ...lineFor(lang), ...swapLines].join("\n");
          await bot.api.sendMessage(user.chatId, text, HTML).catch((e) => console.error("progression notify", e));
        }
      }

      // Level-up offer (solo/trainer-own only, ≤ once / 30 days): the trainee has outgrown the
      // plan (fast pace + consistent weekly progressions) → button to regenerate one tier harder.
      if (user.role !== "client" && daysBetween(sent["levelup"], date) >= 30) {
        const rate = evaluateProgressionRate(logs);
        const progWeeks = await countAdjustmentWeeksSince(db, user._id, isoDaysAgo(42));
        if (shouldLevelUp(user.profile.level ?? "beginner", rate, progWeeks)) {
          const kb = new InlineKeyboard().text(t(lang, "levelup_yes"), "levelup:yes").text(t(lang, "levelup_no"), "levelup:no");
          await bot.api.sendMessage(user.chatId, t(lang, "levelup_prompt"), { ...HTML, reply_markup: kb }).catch((e) => console.error("levelup notify", e));
          markSent("levelup");
        }
      }

      // Goal-reached offer (solo/trainer-own only, ≤ once / 30 days): a fat-loss cut has hit its
      // plateau → button to switch to maintenance/recomp and recompute calories.
      if (user.role !== "client" && daysBetween(sent["goalreached"], date) >= 30) {
        const weights = (await bodyAll())
          .filter((b) => typeof b.weight === "number")
          .map((b) => ({ date: b.date, weight: b.weight as number }));
        if (fatLossGoalReached(user.profile.goal, weights) || gainGoalReached(user.profile.goal, weights)) {
          const kb = new InlineKeyboard().text(t(lang, "goal_switch_yes"), "goal:maintain").text(t(lang, "levelup_no"), "goal:keep");
          await bot.api.sendMessage(user.chatId, t(lang, "goal_reached_prompt"), { ...HTML, reply_markup: kb }).catch((e) => console.error("goalreached notify", e));
          markSent("goalreached");
        }
      }
    }
  }

  // Weekly motivational narrative — Monday late morning, solo/trainer-own users with recent
  // activity. One AI call per user/week (gated on activity). NOTE: fires across timezones; if
  // same-tz cohorts grow large, add a per-invocation cap (like the plan-pending recovery above)
  // to stay under Cloudflare's subrequest limit.
  if (weekday === 1 && hour >= 11 && user.role !== "client" && !already("weekly_narrative") && pass.narrativeBudget > 0) {
    const since = isoDaysAgo(7);
    const wl = (await workouts21()).filter((l) => l.date >= since); // 7-day slice of the 21-day pull
    if (wl.length) {
      pass.narrativeBudget--;
      markSent("weekly_narrative");
      const nl = await nutritionLogsSince(db, user._id, since);
      const recentBody = (await bodyAll()).filter((b) => typeof b.weight === "number" && b.date >= since);
      const weightDelta =
        recentBody.length >= 2
          ? +(((recentBody[recentBody.length - 1].weight as number) - (recentBody[0].weight as number)).toFixed(1))
          : 0;
      const summary = {
        workoutsDone: wl.filter((l) => l.completed).length,
        workoutsSkipped: wl.filter((l) => !l.completed).length,
        nutritionDaysLogged: nl.length,
        weightDeltaKg: weightDelta,
      };
      try {
        const text = await aiText(env, {
          system: weeklyNarrativeSystem(lang),
          user: JSON.stringify(summary),
          temperature: 0.6,
          kind: "report",
          db,
          userId: user._id,
        });
        await send(`${t(lang, "weekly_narrative_header")}\n\n${escapeHtml(text)}`);
      } catch (err) {
        logSchedulerError(db, "weekly_narrative", err, user._id);
      }
    }
  }

  // Weekly report at 17:00 local time on Monday — trainer gets client digest,
  // owner gets full report, competitors get leaderboard nudge.
  if (weekday === 1 && hour >= 17 && !already("weekly_report")) {
    // Block periodization: advance the active plan's mesocycle one week (Monday, once).
    if (activePlan?.mesocycle) {
      const prev = activePlan.mesocycle;
      const nextMeso = advanceMesocycle(prev);
      await updatePlanMesocycle(db, user._id, nextMeso).catch(() => {});
      if (nextMeso.phase !== prev.phase) {
        const g = phaseGuidance(nextMeso.phase);
        await bot.api
          .sendMessage(user.chatId, t(lang, "meso_advanced", { phase: t(lang, phaseKey(nextMeso.phase) as Parameters<typeof t>[1]), reps: g.reps, intensity: g.intensity }), HTML)
          .catch(() => {});
      }
    }
    const ownerChatId = await getOwnerChatId(db);
    if (ownerChatId !== undefined && user.chatId === ownerChatId) {
      try {
        for (const chunk of chunkReport(await buildOwnerReport(db, env))) {
          await bot.api.sendMessage(user.chatId, chunk, HTML);
        }
      } catch (err) {
        logSchedulerError(db, "owner_report", err);
      }
    }
    if (user.role === "trainer") {
      const clients = await listClients(db, user._id);
      if (clients.length) {
        const cutoff = isoDaysAgo(7);
        const lines = [t(lang, "digest_header")];
        for (const c of clients) {
          const plan = pass.planByUser.get(c._id) ?? null;
          const streakLogs = await workoutLogsSince(db, c._id, isoDaysAgo(45));
          const logs = streakLogs.filter((l) => l.date >= cutoff); // 7-day slice of the 45-day pull
          const done = logs.filter((l) => l.completed).length;
          const skipped = logs.filter((l) => !l.completed).length;
          const planned = plan?.split.length ?? 0;
          const planWeekdays = new Set((plan?.split ?? []).map((d) => d.weekday));
          const offPlan = logs.filter((l) => l.completed && planWeekdays.size > 0 && !planWeekdays.has(l.weekday)).length;
          const streak = weekStreak(streakLogs.filter((l) => l.completed).map((l) => l.date), date, c.reminders?.lastVacation);
          // Traffic-light at a glance: hit the plan / partial / nothing.
          const emoji = planned > 0 ? (done >= planned ? "🟢" : done >= 1 ? "🟡" : "🔴") : done >= 1 ? "🟢" : "⚪";
          const who = (c.flagged ? "⚠️ " : "") + escapeHtml(c.profile.name ?? `id ${c._id}`);
          lines.push(
            t(lang, "digest_line", {
              emoji,
              name: who,
              done,
              planned: planned || done,
              skipped,
              streak,
              offplan: offPlan > 0 ? t(lang, "digest_offplan", { n: offPlan }) : "",
            }),
          );
        }
        // 💳 Renewals due — clients whose paid-until is overdue or within 3 days.
        try {
          const billing = await listBillingForTrainer(db, user._id);
          const nameById = new Map(clients.map((c) => [c._id, c.profile.name ?? `id ${c._id}`]));
          const soon = new Date(Date.parse(date) + 3 * 86_400_000).toISOString().slice(0, 10);
          const due = billing
            .filter((b) => b.paidUntil && b.paidUntil <= soon && nameById.has(b.clientId))
            .sort((a, z) => (a.paidUntil! < z.paidUntil! ? -1 : 1));
          if (due.length) {
            lines.push("", t(lang, "digest_renewals"));
            for (const b of due) {
              lines.push(t(lang, "digest_renewal_line", { name: escapeHtml(nameById.get(b.clientId)!), date: b.paidUntil!, status: t(lang, b.paidUntil! < date ? "digest_overdue" : "digest_soon") }));
            }
          }
        } catch {
          /* renewals optional */
        }
        await bot.api.sendMessage(user.chatId, lines.join("\n"), HTML).catch((e) => console.error("digest send", e));
      }
    }
    if (user.competeOptIn) {
      let boardsP = pass.boardsByDay.get(date);
      if (!boardsP) {
        boardsP = computeBoards(db, tz);
        pass.boardsByDay.set(date, boardsP);
      }
      const boards = await boardsP;
      const dates = await competitorWorkoutDates(db);
      const today = date;
      const weekStart = weekStartStr(today);
      const userDates = dates.filter((d) => d.userId === user._id).map((d) => d.date);
      const streak = weekStreak(userDates, today, user.reminders?.lastVacation);
      for (const code of streakMilestones(streak)) await awardAchievement(db, user._id, code);
      if (userDates.some((dt) => dt >= weekStart)) {
        const nut = await nutritionLogsSince(db, user._id, weekStart);
        if (nut.length) await awardAchievement(db, user._id, "balanced_week");
      }
      const rank = rankOf(boards.consistency, user._id);
      // Competitive hook: compare with last week's stored rank and call out the change —
      // "X overtook you" stings (in a good way), "you climbed" rewards. Opt-in users only.
      let rankLine = "";
      const prevRank = user.reminders?.lastRank;
      if (rank && prevRank && rank !== prevRank) {
        if (rank < prevRank) {
          rankLine = "\n" + t(lang, "rank_up", { prev: prevRank, rank });
        } else {
          const above = boards.consistency[rank - 2];
          const who = above ? (above.name || t(lang, "anon")) : "";
          rankLine = "\n" + (who ? t(lang, "rank_down", { name: who, rank }) : "");
        }
      }
      if (rank) {
        user.reminders = { ...user.reminders, lastRank: rank };
        await updateUser(db, user._id, { reminders: user.reminders }).catch(() => {});
      }
      await bot.api
        .sendMessage(user.chatId, t(lang, "weekly_nudge", { rank: rank || "—", streak }) + rankLine, HTML)
        .catch((e) => console.error("nudge send", e));
    }
    markSent("weekly_report");
  }
  } finally {
    await flushReminders();
  }
}



