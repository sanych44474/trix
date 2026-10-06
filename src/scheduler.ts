import { Bot, } from "grammy";
import { deliverDueNotifications, enqueueAndDeliver, type DeliveryResult } from "./schedulerOutbox";
import { closeQuestWeek } from "./questClose";
import { isoDateMinus } from "./features/gamification/boards";
import type { BodyLogDoc, Env, PlanDoc, UserDoc, Weekday, WorkoutLogDoc } from "./types";
import { acquireScheduleLock, releaseScheduleLock, dueRestTimers, deleteRestTimers, pruneSeenUpdates, getSetting, setSetting } from "./adapters/d1/v2Admin";
import { countNotificationsSince } from "./adapters/d1/v2Notifications";
import { logInfo } from "./log";
import { allWorkoutLogsSince, workoutLogsSince } from "./adapters/d1/v2Workouts";
import { awardAchievement, markSquadWoken, squadsNeedingWake } from "./adapters/d1/v2Gamification";
import { getActivePlan, listActivePlans, setProgressionRate } from "./adapters/d1/v2Plans";
import { bodyLogsByUser, } from "./adapters/d1/v2Tracking";
import { getUser, listOnboardedUsers, listOnboardingOwedReply, listPlanPendingUsers, listRetryUsers, pendingRecoveryCount, listStuckOnboardingUsers, listVacationEnded, markComebackDone, updateUser } from "./adapters/d1/v2Users";
import { evaluateProgressionRate, } from "./domain/progression";
import { localParts } from "./domain/localTime";
import { isoWeekKey, } from "./domain/records";
import { wakeUserScheduler } from "./durable/userScheduler";
import { wakeSquadScheduler } from "./durable/squadScheduler";
import { wakeGlobalScheduler } from "./durable/globalScheduler";
import { isCutOver } from "./durable/cutover";
import { ADJUST_COOLDOWN_DAYS } from "./domain/adaptiveCalories";
import { DAILY_NUDGE_CAP, daysBetween, isQuietHour, nudgesSentToday } from "./domain/reminderTiming";
import { t } from "./locales/i18n";
import { onboardingAppMarkup, onboardingUrlFromEnv } from "./bot/onboardingApp";
import { appKeyboard, } from "./notify/appKeyboard";
import { finalizeOnboardingPlan, retryInterviewStep } from "./bot/plan";
import { APP_VERSION } from "./webapp/appVersion";
import { enforceStorageBudget } from "./webapp/photoStorage";
import { purgeExpiredStories } from "./webapp/storyMedia";
import { stravaAccountsDue } from "./adapters/d1/v2Strava";
import { syncStrava } from "./features/strava/stravaSync";
import { stravaConfig } from "./webapp/stravaApi";
import { runGlobalJobs } from "./schedulerJobs/global";
import { postSquadRecaps, processBuddyDuels, SQUAD_RECAP_HOUR_UTC, SQUAD_RECAP_BATCH } from "./schedulerJobs/social";
import { weeklyDigest } from "./schedulerJobs/weeklyDigest";
import type { UserPass } from "./schedulerJobs/userPass";
import { adaptiveCalories } from "./schedulerJobs/adaptiveCalories";
import { smartReminderHour } from "./schedulerJobs/smartReminderHour";
import { trainerAtRiskAlert } from "./schedulerJobs/trainerAtRisk";
import { activationNudge } from "./schedulerJobs/activation";
import { workoutReminder } from "./schedulerJobs/workoutReminder";
import { missedDay } from "./schedulerJobs/missedDay";
import { weeklyNarrative } from "./schedulerJobs/weeklyNarrative";
import { advanceMesocycleWeek, weeklyReport } from "./schedulerJobs/weeklyReport";
import { weeklyProgression } from "./schedulerJobs/weeklyProgression";
import { adaptiveCheckin, cycleNudge, deloadNudge, eveningSurvey, injuryFollowUp, plateauNudge, qualityAsk, readinessCheck, seasonalChallengeNudge, streakRescue, sundayMeasure, tomorrowPreview, waterReminder, weighInNudge } from "./schedulerJobs/nudges";
import { HTML, logSchedulerError, isoDaysAgo } from "./schedulerJobs/shared";
// Public surface kept here so existing `from "./scheduler"` imports keep working.
export { runGlobalJobs, checkCronHeartbeat } from "./schedulerJobs/global";
export { logSchedulerError, type Sender } from "./schedulerJobs/shared";
import type { Sender } from "./schedulerJobs/shared";


// The reminders of one pass in priority order (see the loop in processUser). `counted` ones use
// the daily cap; water is opt-in and sits outside it.
const NUDGES: Array<{ name: string; counted: boolean; run: (p: UserPass) => Promise<boolean> }> = [
  { name: "activation", counted: true, run: (p) => (p.user.onboarded && p.user.role !== "client" && p.hour >= p.reminderHour && !p.already("activation") ? activationNudge(p) : Promise.resolve(false)) },
  { name: "readiness", counted: true, run: readinessCheck },
  { name: "workout", counted: true, run: (p) => (!p.remOff("workout") && p.hour >= p.reminderHour && p.isTrainingDay && !p.already("workout") ? workoutReminder(p) : Promise.resolve(false)) },
  { name: "water", counted: false, run: waterReminder },
  { name: "streak_rescue", counted: true, run: streakRescue },
  { name: "survey", counted: true, run: eveningSurvey },
  { name: "missed_day", counted: true, run: (p) => (p.user.role !== "client" && p.hour >= p.reminderHour && !p.already("missed_day") ? missedDay(p) : Promise.resolve(false)) },
  { name: "tomorrow", counted: true, run: tomorrowPreview },
  { name: "injury", counted: true, run: injuryFollowUp },
  { name: "quality", counted: true, run: qualityAsk },
  { name: "weighin", counted: true, run: weighInNudge },
  { name: "measure", counted: true, run: sundayMeasure },
  { name: "digest", counted: true, run: (p) => (!p.remOff("digest") && p.weekday === 7 && p.hour >= p.reminderHour && !p.already("digest")
    ? weeklyDigest({ env: p.env, db: p.db, user: p.user, lang: p.lang, date: p.date, botBlocked: false, markSent: p.markSent, sendAndMark: p.sendAndMark })
    : Promise.resolve(false)) },
  { name: "season", counted: true, run: seasonalChallengeNudge },
  { name: "plateau", counted: true, run: plateauNudge },
  { name: "cycle", counted: true, run: cycleNudge },
  { name: "deload", counted: true, run: deloadNudge },
  { name: "calories", counted: true, run: (p) => (p.weekday === 1 && p.hour >= p.reminderHour && p.user.role !== "client" && p.user.profile.goalWeight && p.user.nutrition && daysBetween(p.sent["cal_adjust"], p.date) >= ADJUST_COOLDOWN_DAYS ? adaptiveCalories(p) : Promise.resolve(false)) },
  { name: "smart_hour", counted: true, run: (p) => (!p.remOff("workout") && p.weekday === 1 && p.hour >= p.reminderHour && daysBetween(p.sent["smart_hour"], p.date) >= 30 ? smartReminderHour(p) : Promise.resolve(false)) },
  { name: "adaptive_checkin", counted: true, run: adaptiveCheckin },
];



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

  // Retry sweep for reminder sends that backed off on an earlier tick (notification_outbox,
  // roadmap item 3) — cheap no-op when nothing is due. Runs every tick since this Worker's cron
  // trigger already fires every minute (wrangler.toml), giving the outbox fine-grained retry
  // timing for free without a second cron trigger.
  await deliverDueNotifications(env, bot).catch((e) => logSchedulerError(db, "outbox_delivery", e));

  // Rest-timer nudges — one-shot "rest over" pings scheduled from the guided logger.
  // Sends run in parallel (timeliness is the whole point) and the rows go in one DELETE.
  // Deliberately DIRECT, not through the outbox: a "your rest is over" that arrives on a backoff
  // minutes later is worse than one that never arrives at all — the set it refers to is long done.
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
  // Auto-retry failed onboarding AI calls — fires every cron tick. Awaited (like the "owed"
  // sweep below) so the cron isolate isn't torn down mid AI-call/send before it lands.
  const retryUsers = await listRetryUsers(db, new Date().toISOString()).catch(() => []);
  for (const u of retryUsers) {
    await retryInterviewStep(env, db, u).catch((e) => logSchedulerError(db, "retry_interview", e, u._id));
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
        // With the Mini App: its questionnaire button. Without: re-send the last bot question.
        const appUrl = onboardingUrlFromEnv(env);
        const lastBotMsg = [...transcript].reverse().find((m) => m.role === "assistant");
        const nudgeText = appUrl ? t(u.lang, "ob_app_reminder") : lastBotMsg?.text ?? t(u.lang, "ob_resume_nudge");
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: u.chatId, text: nudgeText, parse_mode: "HTML", ...(appUrl ? { reply_markup: onboardingAppMarkup(u.lang, appUrl) } : {}) }),
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

  if (!(await isCutOver(db, "global"))) await runGlobalJobs(db, bot, env);
  await wakeGlobalScheduler(env).catch((e) => logSchedulerError(db, "global_scheduler_wake", e));

  // R2 photo-cache budget: always the real env here (runSchedule is only ever invoked with the
  // live Worker env, never the DO's shadowed dry-run one) -- safe to run regardless of scheduler
  // cutover state. No-op until the bucket exists, and a no-op below 80% of the free tier's 10GB
  // even once it does; see photoStorage.ts for the eviction policy.
  const lastR2Check = await getSetting(db, "last_r2_budget_check").catch(() => null);
  if (!lastR2Check || Date.parse(lastR2Check) < Date.now() - 7 * 86_400_000) {
    const budget = await enforceStorageBudget(env).catch((e) => {
      logSchedulerError(db, "r2_budget", e);
      return null;
    });
    if (budget?.evictedCount) console.log(JSON.stringify({ level: "info", scope: "r2_budget", ...budget }));
    await setSetting(db, "last_r2_budget_check", new Date().toISOString()).catch(() => {});
  }

  // Story images (webapp/storyMedia.ts) live two days; sweep once a day.
  const lastStorySweep = await getSetting(db, "last_story_sweep").catch(() => null);
  if (!lastStorySweep || Date.parse(lastStorySweep) < Date.now() - 86_400_000) {
    await purgeExpiredStories(env).catch((e) => logSchedulerError(db, "story_sweep", e));
    await setSetting(db, "last_story_sweep", new Date().toISOString()).catch(() => {});
  }

  // Strava cardio import: a few linked accounts per hourly tick, each at most every 12 h. Small
  // batches keep one invocation inside the Workers subrequest budget (2-3 Strava calls each).
  const strava = stravaConfig(env, env.WORKER_URL || "");
  if (strava) {
    const due = await stravaAccountsDue(db, new Date(Date.now() - 12 * 3_600_000).toISOString(), 3).catch(() => [] as number[]);
    for (const accountId of due) {
      const owner = await getUser(db, accountId).catch(() => null);
      if (!owner) continue;
      await syncStrava(db, strava, accountId, owner.lang).catch((e) => logSchedulerError(db, "strava_sync", e));
    }
  }

  // Weekly buddy duels — compare last week's completed-workout counts for every paired buddy,
  // record the winner, and nudge both sides. Gated by ISO week (not a rolling N-day timer like
  // log pruning above) so it always processes the week that just ended, exactly once, on the
  // first hourly tick after the week rolls over.
  const thisWeekKey = isoWeekKey(utcNow.date);
  const lastDuelWeek = await getSetting(db, "last_buddy_duel_week").catch(() => null);
  if (lastDuelWeek !== thisWeekKey) {
    await processBuddyDuels(db, bot, utcNow.date).catch((e) => logSchedulerError(db, "buddy_duels", e));
    await setSetting(db, "last_buddy_duel_week", thisWeekKey).catch(() => {});
  }

  // Squad recap — one post per group chat, once per ISO week, covering the week that just
  // ended. Squads are chat-scoped, not user-scoped, so this sits outside the per-user loop.
  // Held to 09:00 UTC: the ISO-week gate alone fires on the first tick after the week rolls
  // over, i.e. Monday 00:00 UTC — the middle of the night for the users this bot has, and a
  // 3am post into a group chat is how a bot gets muted.
  if (utcNow.hour >= SQUAD_RECAP_HOUR_UTC && !(await isCutOver(db, "squad"))) {
    await postSquadRecaps(db, bot, utcNow.date, thisWeekKey).catch((e) => logSchedulerError(db, "squad_recaps", e));
  }

  // Catch-up wake for any squad that predates the wake-on-creation code path (bot/squad.ts).
  // Self-limiting the same way the user-side sweep is: bounded batch, only never-woken squads.
  const unwokenSquads = await squadsNeedingWake(db, SQUAD_RECAP_BATCH).catch(() => []);
  for (const squad of unwokenSquads) {
    try {
      await wakeSquadScheduler(env, squad.chatId);
      await markSquadWoken(db, squad.chatId);
    } catch (e) {
      logSchedulerError(db, "squad_scheduler_wake", e);
    }
  }

  // Weekly reports moved into processUser (per-user local timezone at 17:00).

  const userCutOver = await isCutOver(db, "user");
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
  // Instrumentation for the open question this loop carries: it iterates EVERY onboarded user in
  // ONE hourly invocation, with no cap, which is a free-tier ceiling (Workers caps external
  // subrequests per invocation, and every Telegram send in the tick shares that budget).
  // The right cap depends on numbers nobody has yet, so measure before capping. Note the shape a
  // cap must take when the time comes: reminders gate on `hour === reminderHour`, so every user
  // still has to be visited once an hour -- a "first N users" cursor would starve the tail of the
  // list out of its reminder window entirely. A send budget on SharedPass (like narrativeBudget
  // above) is the safe shape, since an unsent user simply keeps its dedup key and fires next hour.
  const passStartedAt = new Date().toISOString();
  const passStartMs = Date.now();
  let processed = 0;
  let failed = 0;
  for (const user of users) {
    // Self-limiting bootstrap for the DO dry-run: only a user who has NEVER been woken gets a
    // wake attempt, so this stays bounded by new users per hour rather than the whole onboarded
    // population every hour -- important because DO calls, like everything else in this loop,
    // still share the same per-invocation subrequest budget. doWokenAt is set only after a
    // successful wake, so a transient failure retries next hour rather than being lost.
    if (!user.doWokenAt) {
      try {
        await wakeUserScheduler(env, user._id);
        await updateUser(db, user._id, { doWokenAt: new Date() });
      } catch (err) {
        logSchedulerError(db, "user_scheduler_wake", err, user._id);
      }
    }
    // Once user reminders are cut over to UserSchedulerDO (see durable/cutover.ts), the cron
    // path must stop doing this for real -- both paths acting would double-send everything.
    if (userCutOver) continue;
    try {
      await processUser(env, bot, user, pass);
      processed++;
    } catch (err) {
      failed++;
      logSchedulerError(db, "schedule_user", err, user._id);
    }
  }
  if (!userCutOver) {
    // `sends` counts outbox rows created during the pass — every user-facing send goes through it,
    // so this is measured, not estimated. Rides logInfo, so it lands in Workers Logs AND Analytics
    // Engine (src/log.ts) and one real 08:00 pass answers "how close are we to the ceiling".
    const sends = await countNotificationsSince(db, passStartedAt).catch(() => -1);
    logInfo("user_pass", { users: users.length, processed, failed, sends, durationMs: Date.now() - passStartMs });
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
      // Deliver BEFORE committing the state change. The old order marked the interview done and
      // put the user in `comeback` mode first, so a failed send left them parked in a mode whose
      // opening question they never saw -- their next message was then read as an answer to a
      // question the bot never asked. Enqueue-and-deliver also means a transient failure retries
      // from the outbox instead of being lost, and an un-marked user is simply picked up again on
      // the next tick (a duplicate opener being the worst case, not a silent dead end).
      const delivered = await enqueueAndDeliver(env, bot, {
        userId: u._id,
        chatId: u.chatId,
        kind: "comeback_opener",
        idempotencyKey: `${nowIso.slice(0, 10)}:comeback:${u._id}`,
        text: `${t(u.lang, "vacation_ended")}\n\n${t(u.lang, "comeback_q_feel")}`,
        extra: HTML,
      });
      if (delivered === "failed" || delivered === "blocked") continue;
      await updateUser(db, u._id, { session: { mode: "comeback", comeback: { step: 0, answers: {} } } });
      await markComebackDone(db, u._id, nowIso);
    } catch (err) {
      logSchedulerError(db, "comeback_opener", err, u._id);
    }
  }
}

export interface SharedPass {
  planByUser: Map<number, PlanDoc>;
  logByUserDate: Map<string, import("./types").WorkoutLogDoc>;
  narrativeBudget: number;
  // Leaderboards memoized by the viewer's local "today" (1-2 distinct values per tick) —
  // computing them per competitor re-ran the same aggregate queries N times.
  boardsByDay: Map<string, Promise<import("./bot").BoardsResult>>;
}

/** Single-user equivalent of the bulk SharedPass built in runScheduleInner — for a DO
 * alarm processing exactly one user, not the whole hourly cron loop. narrativeBudget is
 * deliberately uncapped (Infinity): the bulk loop's budget of 5/tick exists ONLY because one
 * invocation used to serve every user's reminders, and this narrative call is one AI-chain
 * call that a single invocation can afford on its own. boardsByDay starts empty — the
 * memoization only pays off across many users sharing an invocation, which a per-user DO
 * alarm never does. */
export async function buildSinglePass(db: D1Database, userId: number): Promise<SharedPass> {
  const [plan, logs] = await Promise.all([
    getActivePlan(db, userId).catch(() => null),
    workoutLogsSince(db, userId, isoDaysAgo(1)).catch(() => []),
  ]);
  return {
    planByUser: plan ? new Map([[userId, plan]]) : new Map(),
    logByUserDate: new Map(logs.map((l) => [`${l.userId}:${l.date}`, l])),
    narrativeBudget: Infinity,
    boardsByDay: new Map(),
  };
}


export async function processUser(env: Env, bot: Sender, user: UserDoc, pass: SharedPass) {
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
  // processUser (which would skip flushReminders and re-fire next tick). Enqueues into the
  // notification_outbox and attempts delivery immediately (same latency as a direct send on the
  // happy path) — a failure is now retried with backoff on a later cron tick instead of being
  // silently dropped (roadmap item 3, see schedulerOutbox.ts). A 403 still means the user
  // blocked the bot → flag them so we stop trying for the rest of this invocation.
  let botBlocked = false;
  const send = async (text: string, extra?: Parameters<typeof bot.api.sendMessage>[2]): Promise<DeliveryResult> => {
    if (botBlocked) return "blocked";
    // Same message text to the same user on the same local day collapses to one outbox row —
    // defense in depth against a double-enqueue, not the primary dedup (that's the cutover
    // mutual-exclusion flag, durable/cutover.ts, which decides whether this call happens at all).
    const idempotencyKey = `${date}:${text.slice(0, 200)}`;
    const result = await enqueueAndDeliver(env, bot, {
      userId: user._id,
      chatId: user.chatId,
      kind: "reminder",
      idempotencyKey,
      text,
      extra: extra ?? HTML,
    }).catch((e) => {
      console.error("reminder enqueue error", user._id, e);
      return "failed" as const;
    });
    if (result === "blocked") botBlocked = true;
    return result;
  };
  // Sends to someone OTHER than the user this pass is about (their trainer, their inviter). The
  // `send` closure above is bound to user.chatId, which is why these used to bypass the outbox
  // entirely — enqueueAndDeliver takes the recipient explicitly, so they no longer have to.
  // The idempotency key names the SUBJECT (this user), not the recipient: two different clients'
  // at-risk alerts to the same trainer on the same day must not collapse into one row.
  const sendTo = (
    target: { _id: number; chatId: number },
    kind: string,
    text: string,
    extra?: Parameters<typeof bot.api.sendMessage>[2],
  ): Promise<DeliveryResult> =>
    enqueueAndDeliver(env, bot, {
      userId: target._id,
      chatId: target.chatId,
      kind,
      idempotencyKey: `${date}:${kind}:${user._id}`,
      text,
      extra: extra ?? HTML,
    }).catch((e) => {
      console.error("notify enqueue error", target._id, kind, e);
      return "failed" as const;
    });
  // A dedup key may only be written when the message is either delivered or DURABLY QUEUED.
  // "retrying" counts: the outbox row persists and deliverDueNotifications drains it on a later
  // tick. "failed"/"blocked" mean it is gone — writing the key there would consume the
  // once-per-user-per-day slot for a message nobody ever received (the bug this closes).
  const durable = (r: DeliveryResult) => r === "sent" || r === "retrying" || r === "duplicate";
  // Explicit reminderHour wins; otherwise derive from sleep schedule (early risers get a
  // morning nudge, night owls keep the 18:00 default).
  const reminderHour = user.profile.reminderHour ?? (user.profile.sleepSchedule === "morning" ? 8 : 18);
  // Mini App deep link for reminder buttons — opens the app at a specific view in one tap.
  // Computed from env directly (not bot.ts's APP_PATH module binding, which is only ever set by
  // the webhook path's createBot/router.ts call — the cron trigger that reaches this function
  // never runs that, so APP_PATH could read stale/default depending on isolate reuse).
  const appPath = env.V2_APP_ENABLED === "1" ? "/app-v2" : "/app";
  const appView = (view: string) => (env.WORKER_URL ? `${env.WORKER_URL}${appPath}?v=${APP_VERSION}&view=${view}` : undefined);
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
  // send + dedup-key write as ONE operation, because they are one invariant: the key may only be
  // written for a message that is durable (see `durable` above). Keeping the two separate is what
  // let call sites drift into marking a dropped send as delivered. A terminal failure self-limits
  // rather than looping: the next tick re-enqueues the same idempotencyKey, gets "duplicate"
  // back — which is durable — and marks then.
  // NOTE: this is only for keys that mean "this message was delivered". Keys written BEFORE a send
  // to throttle expensive work (missed_day, weekly_narrative, activation, atrisk_check) are a
  // different thing and must stay unconditional, or a send failure re-runs an AI call every tick.
  const sendAndMark = async (key: string, text: string, extra?: Parameters<typeof bot.api.sendMessage>[2]) => {
    const result = await send(text, extra);
    if (durable(result)) markSent(key);
    return result;
  };
  // Per-user reminder preferences: a type the user switched off in Settings is never sent.
  const remOff = (key: string) => user.profile.remindersOff?.includes(key) ?? false;
  let w21p: Promise<WorkoutLogDoc[]> | undefined;
  const workouts21 = () => (w21p ??= workoutLogsSince(db, user._id, isoDaysAgo(21)));
  let bodyAllP: Promise<BodyLogDoc[]> | undefined;
  const bodyAll = () => (bodyAllP ??= bodyLogsByUser(db, user._id).catch(() => []));
  // Everything the reminder blocks in schedulerJobs/* need (schedulerJobs/userPass.ts).
  const p: UserPass = {
    env, bot, user, pass, db, lang, tz, date, weekday, hour, reminderHour, activePlan, planDays, trainsOn, isTrainingDay,
    loggedToday, sent, already, markSent, setSent: (key, value) => { dirty[key] = value; }, remOff, send, sendTo, sendAndMark, durable, appView, appKb: (rows) => appKeyboard(env, rows), workouts21, bodyAll,
  };
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
      await sendTo(inviter, "ref_joined", t(inviter.lang, "ref_joined", { name }));
    }
    markSent("ref_reward");
  }
  // Trainer at-risk alert — client missed 2 consecutive planned days, or lapsed on food after
  // being regular. Sent to the TRAINER (independent of the user-facing one-per-tick cap) with the
  // existing "message client" button; deduped so it re-fires only on a NEW miss / lapse.
  // At-risk state (missed consecutive days / nutrition lapse) changes at DAY granularity, so the
  // two 21-day reads only need to run once per day, not every hour>=10 pass (~14×/day → 1×/day).
  if (user.role === "client" && user.trainerId && hour >= 10 && !already("atrisk_check")) {
    await trainerAtRiskAlert(p);
  }

  // User-facing reminders: one per pass, in NUDGES order (a reminder with a one-hour window runs
  // ahead of those that can fire in any hour), never in quiet hours (the person's own, or
  // 22:00–07:00 by default), and at most DAILY_NUDGE_CAP a day. Opt-in water nudges are outside
  // the cap. Anything not sent now fires on a later pass once allowed.
  const sentToday = nudgesSentToday(sent["nudges"], date);
  if (!isQuietHour(hour, reminderHour, user.profile.quietFrom, user.profile.quietTo)) {
    for (const nudge of NUDGES) {
      if (nudge.counted && sentToday >= DAILY_NUDGE_CAP) continue;
      if (!(await nudge.run(p))) continue;
      if (nudge.counted) dirty["nudges"] = `${date}:${sentToday + 1}`;
      break; // one reminder per pass; the rest fire on later passes, never as a burst
    }
  }

  // Silent Monday work below; the progression, narrative and report steps still message the user
  // (or their trainer) and are not part of the one-reminder budget.
  if (weekday === 1 && hour >= reminderHour && !already("meso_advance")) {
    markSent("meso_advance");
    await advanceMesocycleWeek(p).catch((e) => logSchedulerError(db, "meso_advance", e, user._id));
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

  // Monday: record the quests finished last week, whether or not the Mini App was opened to see
  // them (questClose.ts). Silent; idempotent per week and code.
  if (weekday === 1 && !already("quest_close")) {
    markSent("quest_close");
    await closeQuestWeek(db, user, isoDateMinus(date, 7)).catch((e) => logSchedulerError(db, "quest_close", e, user._id));
  }

  // Weekly dynamic progression — Monday, silent. Analyses the last 3 weeks of logs + recent
  // check-ins and nudges weights/reps via double progression (guarded by wellbeing & plateau
  // detection). Solo/trainer-own plans are applied silently and the user is told; a client's
  // changes are staged as a DRAFT for their trainer to accept, edit, or discard.
  if (weekday === 1 && hour >= reminderHour && !already("progression")) {
    await weeklyProgression({ db, user, lang, date, activePlan, workouts21, send, sendTo, markSent, sent, sendAndMark, bodyAll, appKb: p.appKb });
  }

  // Weekly motivational narrative — Monday late morning, solo/trainer-own users with recent
  // activity. One AI call per user/week (gated on activity). NOTE: fires across timezones; if
  // same-tz cohorts grow large, add a per-invocation cap (like the plan-pending recovery above)
  // to stay under Cloudflare's subrequest limit.
  if (weekday === 1 && hour >= 11 && user.role !== "client" && !already("weekly_narrative") && pass.narrativeBudget > 0) {
    await weeklyNarrative(p);
  }

  // Weekly report at 17:00 local time on Monday — trainer gets client digest,
  // owner gets full report, competitors get leaderboard nudge.
  if (weekday === 1 && hour >= 17 && !already("weekly_report")) {
    await weeklyReport(p);
  }
  } finally {
    await flushReminders();
  }
}



