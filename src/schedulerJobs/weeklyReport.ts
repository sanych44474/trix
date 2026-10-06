// The Monday evening weekly report: last week's numbers, records and rank, the trainer's copy
// for clients. Called by processUser (scheduler.ts) on Mondays after 17:00 local.
import { getOwnerChatId } from "../adapters/d1/v2Admin";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { awardAchievement, competitorWorkoutDates } from "../adapters/d1/v2Gamification";
import { updatePlanMesocycle } from "../adapters/d1/v2Plans";
import { listClients } from "../adapters/d1/v2Trainer";
import { updateUser } from "../adapters/d1/v2Users";
import { nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { rankOf, streakMilestones, weekStartStr, weekStreak } from "../domain/records";
import { escapeHtml, t } from "../locales/i18n";
import { chunkReport } from "../render";
import { buildOwnerReport } from "../bot/ownerReport";
import { computeBoards } from "../features/gamification/boards";
import { advanceMesocycle, phaseGuidance, phaseKey } from "../domain/mesocycle";
import { HTML, logSchedulerError, isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

/** Block periodization: advance the active plan's mesocycle one week (Monday morning, once).
 *  Runs before the deload notice and the weekly progression so both read THIS week's phase. */
export async function advanceMesocycleWeek(p: UserPass): Promise<void> {
  const { db, user, lang, activePlan, send } = p;
  if (!activePlan?.mesocycle) return;
  const prev = activePlan.mesocycle;
  const nextMeso = advanceMesocycle(prev);
  await updatePlanMesocycle(db, user._id, nextMeso);
  activePlan.mesocycle = nextMeso;
  if (nextMeso.phase !== prev.phase && nextMeso.phase !== "deload") {
    // A deload gets its own notice (scheduler "deload"); announce only a new training block.
    const g = phaseGuidance(nextMeso.phase);
    await send(t(lang, "meso_advanced", { phase: t(lang, phaseKey(nextMeso.phase) as Parameters<typeof t>[1]), reps: g.reps, intensity: g.intensity }));
  }
}

export async function weeklyReport(p: UserPass): Promise<void> {
  const { env, bot, user, pass, db, lang, tz, date, markSent, send } = p;
  const ownerChatId = await getOwnerChatId(db);
  if (ownerChatId !== undefined && user.chatId === ownerChatId) {
    try {
      // Through the outbox like every other send, so a 429 at 17:00 (when the whole cohort's
      // sends share one invocation's subrequest budget) backs off instead of losing the report.
      // Caveat: the outbox gives no cross-row ordering guarantee, so if one chunk backs off and
      // a later one doesn't, the owner sees them out of order. Acceptable here -- the report is
      // re-runnable on demand via /ownerreport, and losing it entirely is the worse failure.
      for (const chunk of chunkReport(await buildOwnerReport(db, env))) {
        await send(chunk);
      }
    } catch (err) {
      logSchedulerError(db, "owner_report", err);
    }
  }
  // Each of these two blocks is independently try/catch'd (like the owner report above) so a
  // transient D1/send failure in one doesn't stop markSent below — without it, the whole
  // weekly_report block (including the non-idempotent mesocycle advance above) re-runs on
  // every later tick this same Monday.
  try {
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
      await send(lines.join("\n"));
    }
  }
  } catch (err) {
    logSchedulerError(db, "trainer_digest", err, user._id);
  }
  try {
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
    // Only send when there is something real behind it. `rank` exists only if they logged a
    // session THIS week (the consistency board drops zero-count entries), and `streak > 0`
    // means they trained recently — with neither, the message would read
    // "🏆 you're #— · 🔥 0-week streak. One more session keeps it alive!" to somebody who has
    // not trained at all. Re-engaging those users is the at-risk/activation machinery's job;
    // a leaderboard nudge congratulating nothing just teaches them to ignore the bot.
    if (rank || streak > 0) {
      await bot.api
        .sendMessage(user.chatId, t(lang, "weekly_nudge", { rank: rank || "—", streak }) + rankLine, HTML)
        .catch((e) => console.error("nudge send", e));
    }
  }
  } catch (err) {
    logSchedulerError(db, "weekly_nudge", err, user._id);
  }
  markSent("weekly_report");
}
