// Group-level weekly jobs: squad recaps posted into group chats and buddy duels. Split out of
// scheduler.ts.
import { Bot } from "grammy";
import { allWorkoutLogsSince } from "../adapters/d1/v2Workouts";
import { allBuddyPairs, awardAchievement, buddyDuelHistory, buddyWinCount, recordBuddyDuel, deleteSquad, markSquadRecapped, squadsDueForRecap } from "../adapters/d1/v2Gamification";
import { getUser } from "../adapters/d1/v2Users";
import { isoWeekKey, weekRangeOffset, weekStartStr } from "../domain/records";
import { currentWinStreak, decideDuel } from "../domain/buddyDuel";
import { postSquadDigest } from "../bot/squad";
import { escapeHtml, t } from "../locales/i18n";
import { HTML, logSchedulerError } from "./shared";

// Squad recaps go to GROUP chats, which have no timezone of their own — a single sensible UTC
// hour is the honest answer (09:00 UTC = noon in Kyiv, morning across Europe).
export const SQUAD_RECAP_HOUR_UTC = 9;
// Each recap post is one EXTERNAL subrequest, and the Workers Free plan allows 50 per
// invocation — shared with every reminder the per-user loop below sends in the same tick. The
// sweep therefore runs in small batches on consecutive minutes instead of fanning out at once.
export const SQUAD_RECAP_BATCH = 8;

// Weekly buddy-duel sweep — see the call site's comment for the gating rule. Runs once for the
// whole system per week, not per user: buddy PAIRS, not individual users, are the unit of work.
/** Post last week's board into every squad chat. A chat that rejects the message (bot kicked,
 * group deleted) is dropped — that is the only automatic squad deletion there is. */
export async function postSquadRecaps(db: D1Database, bot: Bot, todayUtc: string, weekKey: string): Promise<void> {
  const squads = await squadsDueForRecap(db, weekKey, SQUAD_RECAP_BATCH);
  if (!squads.length) return;
  const { from } = weekRangeOffset(todayUtc, 1); // Monday of the week that just ended
  const until = weekStartStr(todayUtc); // exclusive: this fresh week is not part of the recap
  for (const squad of squads) {
    const ok = await postSquadDigest(db, bot.api, squad.chatId, { weekStart: from, until, past: true });
    // Marked either way: a chat that is merely unreachable this minute must not be retried
    // every minute for the rest of the week.
    await markSquadRecapped(db, squad.chatId, weekKey).catch(() => {});
    if (!ok) await deleteSquad(db, squad.chatId).catch(() => {});
  }
}

export async function processBuddyDuels(db: D1Database, bot: Bot, todayStr: string): Promise<void> {
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
      await bot.api
        .sendMessage(
          winner.chatId,
          t(winner.lang, "duel_won", { name: escapeHtml(loser.profile.name ?? `id ${loser._id}`), mine: winnerCount, theirs: loserCount }),
          HTML,
        )
        .catch(() => {});
      await bot.api
        .sendMessage(
          loser.chatId,
          t(loser.lang, "duel_lost", { name: escapeHtml(winner.profile.name ?? `id ${winner._id}`), mine: loserCount, theirs: winnerCount }),
          HTML,
        )
        .catch(() => {});
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
