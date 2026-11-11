// Group-level weekly jobs: buddy duels. Split out of scheduler.ts. Squad recaps are posted by
// SquadSchedulerDO.
import { Bot } from "grammy";
import { allWorkoutLogsSince } from "../adapters/d1/v2Workouts";
import { allBuddyPairs, awardAchievement, buddyDuelHistory, buddyWinCount, recordBuddyDuel } from "../adapters/d1/v2Gamification";
import { getUser } from "../adapters/d1/v2Users";
import { isoWeekKey, weekRangeOffset } from "../domain/records";
import { currentWinStreak, decideDuel } from "../domain/buddyDuel";
import { escapeHtml, t } from "../locales/i18n";
import { HTML, logSchedulerError } from "./shared";
import { notify } from "../notify/notify";
import type { Env } from "../types";

// How many never-woken squads the cron arms per tick (scheduler.ts): each wake is a subrequest.
export const SQUAD_RECAP_BATCH = 8;

// Weekly buddy-duel sweep — see the call site's comment for the gating rule. Runs once for the
// whole system per week, not per user: buddy PAIRS, not individual users, are the unit of work.
export async function processBuddyDuels(env: Env, bot: Bot, todayStr: string): Promise<void> {
  const db = env.DB;
  const pairs = await allBuddyPairs(db);
  if (!pairs.length) return;
  const { from, to } = weekRangeOffset(todayStr, 1); // the week that just ended
  const weekKey = isoWeekKey(from);
  const logs = await allWorkoutLogsSince(db, from);
  const completedByUser = new Map<number, number>();
  for (const l of logs) {
    if (!l.completed || l.date > to) continue;
    completedByUser.set(l.userId, (completedByUser.get(l.userId) ?? 0) + 1);
  }
  // Each pair is fully independent — wrapped in its own try/catch so one pair's failure (a
  // transient DB error, a missing user) can't abort the rest. Without this, a mid-loop throw
  // would skip every pair after it for the WHOLE week: the call site marks the week processed
  // regardless of outcome (see its comment), so anything not reached here wouldn't get a second
  // chance until the following week's comparison.
  for (const { userA, userB } of pairs) {
    try {
      const aCount = completedByUser.get(userA) ?? 0;
      const bCount = completedByUser.get(userB) ?? 0;
      const result = decideDuel(userA, userB, weekKey, aCount, bCount);
      await recordBuddyDuel(db, userA, userB, weekKey, aCount, bCount, result.winnerId);
      if (result.winnerId == null) continue; // tie (incl. 0-0) — recorded, but no message/badge spam
      const loserId = result.winnerId === userA ? userB : userA;
      const [winner, loser] = await Promise.all([getUser(db, result.winnerId), getUser(db, loserId)]);
      if (!winner || !loser) continue;
      const winnerCount = result.winnerId === userA ? aCount : bCount;
      const loserCount = result.winnerId === userA ? bCount : aCount;
      // Through the outbox, keyed on the duel and the recipient: a Telegram hiccup retries instead
      // of dropping the result, and a re-run of the week (the gate retries a failed job) cannot
      // tell anyone twice.
      const duel = `${weekKey}:${Math.min(userA, userB)}:${Math.max(userA, userB)}`;
      await notify(env, bot, { userId: winner._id, chatId: winner.chatId }, {
        kind: "duel_won",
        key: `duel:${duel}:${winner._id}`,
        text: t(winner.lang, "duel_won", { name: escapeHtml(loser.profile.name ?? `id ${loser._id}`), mine: winnerCount, theirs: loserCount }),
        extra: HTML,
      }).catch((e) => logSchedulerError(db, "duel_notify", e, winner._id));
      await notify(env, bot, { userId: loser._id, chatId: loser.chatId }, {
        kind: "duel_lost",
        key: `duel:${duel}:${loser._id}`,
        text: t(loser.lang, "duel_lost", { name: escapeHtml(winner.profile.name ?? `id ${winner._id}`), mine: loserCount, theirs: winnerCount }),
        extra: HTML,
      }).catch((e) => logSchedulerError(db, "duel_notify", e, loser._id));
      // Badges: first-ever win, and a 4-in-a-row win streak against this same buddy.
      const wins = await buddyWinCount(db, result.winnerId).catch(() => 0);
      if (wins === 1) await awardAchievement(db, result.winnerId, "buddy_first_win").catch(() => {});
      const history = await buddyDuelHistory(db, userA, userB, 4).catch(() => []);
      if (currentWinStreak(result.winnerId, history) >= 4) {
        await awardAchievement(db, result.winnerId, "buddy_duel_streak_4").catch(() => {});
      }
    } catch (e) {
      logSchedulerError(db, "buddy_duel_pair", e, userA);
    }
  }
}
