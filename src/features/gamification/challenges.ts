// Challenges (join a consistency goal, track progress, celebrate completion) — part of the
// gamification feature slice (roadmap item 1), moved here from bot/challenges.ts. bot.ts's
// barrel seam still applies: `export * from "./features/gamification/challenges"`.
// The "Challenges" banner in bot.ts also held an unrelated cmdFeedback and the reminder on/off
// settings (REMINDER_TYPES/showReminderSettings/onReminderToggle) — those stayed in bot.ts,
// they aren't challenges code and moving them here would just relocate the same drift.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../../types";
import {
  activeChallengeCodes, activeChallenges, awardAchievement, countCompletedChallenges, countCompletedSeasons, joinChallenge, markChallengeDone,
} from "../../adapters/d1/v2Gamification";
import { workoutLogsSince } from "../../adapters/d1/v2Workouts";
import { stepLogsSince, waterLogsSince } from "../../adapters/d1/v2Tracking";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import {
  CHALLENGES, challengeByCode, challengeCurrent, challengeStatus, challengeWindow, challengeWindowCounts, progressBar,
  seasonalChallenge, seasonMilestones, type ChallengeData, type ChallengeTemplate,
} from "../../domain/challenges";
import { challengeTitleText } from "../../render";
import { challengeMilestones } from "../../domain/records";
import { localParts } from "../../domain/localTime";
import { escapeHtml, t } from "../../locales/i18n";
import { type MyContext, clearEditOwner, reply } from "../../adapters/telegram/context";
import { menuBtn } from "../../bot/keyboards";
import { waterGoalFor } from "../../bot/nutritionCmds";

// Gather the raw counts a challenge needs, over its [startDate, endDate] window. Progress is always
// recomputed live from logs (so editing/deleting a log keeps it honest); only enrollment is stored.
export async function challengeData(ctx: MyContext, startDate: string, endDate: string): Promise<ChallengeData> {
  const uid = ctx.user._id;
  const [wl, nl, sl, water] = await Promise.all([
    workoutLogsSince(ctx.db, uid, startDate),
    nutritionLogsSince(ctx.db, uid, startDate),
    stepLogsSince(ctx.db, uid, startDate),
    waterLogsSince(ctx.db, uid, startDate),
  ]);
  return challengeWindowCounts({ workouts: wl, nutrition: nl, steps: sl, water }, startDate, endDate, waterGoalFor(ctx));
}

export function challengeTitle(lang: Lang, tpl: ChallengeTemplate): string {
  return `${tpl.emoji} ${challengeTitleText(lang, tpl)}`;
}

export async function cmdChallenges(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const active = await activeChallenges(ctx.db, ctx.user._id, date);
  const blocks: string[] = [];
  const completedNow: string[] = [];
  let seasonWon = false;
  for (const ch of active) {
    const tpl = challengeByCode(ch.code);
    if (!tpl) continue;
    const data = await challengeData(ctx, ch.startDate, ch.endDate);
    const st = challengeStatus(tpl, challengeCurrent(tpl, data));
    if (st.done) {
      // Completion is recorded on the challenge row (completedAt) — counted by countCompletedChallenges.
      // ALSO now feeds its own badge tier (first_challenge/challenges_5, see records.ts) — a
      // separate counter from workoutMilestones/prMilestones on purpose, so it doesn't skew
      // those (a challenge win is its own kind of achievement, not just more workouts/PRs).
      await markChallengeDone(ctx.db, ch.id);
      completedNow.push(challengeTitle(lang, tpl));
      if (tpl.season) seasonWon = true;
      continue;
    }
    const daysLeft = Math.max(0, Math.round((Date.parse(ch.endDate) - Date.parse(date)) / 86_400_000));
    blocks.push(
      `<b>${escapeHtml(challengeTitle(lang, tpl))}</b>\n${progressBar(st.pct)} ${st.current}/${st.target} · ${t(lang, "chal_days_left", { n: daysLeft })}`,
    );
  }
  const won = await countCompletedChallenges(ctx.db, ctx.user._id);
  if (completedNow.length) {
    for (const code of challengeMilestones(won)) await awardAchievement(ctx.db, ctx.user._id, code);
    if (seasonWon) {
      for (const code of seasonMilestones(await countCompletedSeasons(ctx.db, ctx.user._id))) await awardAchievement(ctx.db, ctx.user._id, code);
    }
  }
  const parts: string[] = [t(lang, "chal_title")];
  for (const c of completedNow) parts.push(t(lang, "chal_completed_now", { title: c }));
  if (blocks.length) parts.push("", blocks.join("\n\n"));
  else if (!completedNow.length) parts.push("", t(lang, "chal_none"));
  if (won > 0) parts.push("", t(lang, "chal_won_total", { n: won }));
  const kb = new InlineKeyboard().text(t(lang, "chal_join_btn"), "chal:new").row().text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, parts.join("\n"), kb);
}

export async function showChallengePicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const taken = await activeChallengeCodes(ctx.db, ctx.user._id, date);
  // This month's seasonal challenge leads the list.
  const available = [seasonalChallenge(date), ...CHALLENGES].filter((c) => !taken.has(c.code));
  if (!available.length) { await reply(ctx, t(lang, "chal_all_joined"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  for (const tpl of available) {
    kb.text(`${challengeTitle(lang, tpl)}`.slice(0, 60), `chal:join:${tpl.code}`).row();
  }
  kb.text(t(lang, "back"), "menu:challenges");
  await reply(ctx, t(lang, "chal_pick"), kb);
}

export async function onChallengeJoin(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  const tpl = challengeByCode(code);
  if (!tpl) { await showChallengePicker(ctx); return; }
  const { date } = localParts(ctx.user.profile.timezone);
  const taken = await activeChallengeCodes(ctx.db, ctx.user._id, date);
  if (taken.has(code)) { await reply(ctx, t(lang, "chal_already")); await cmdChallenges(ctx); return; }
  const win = challengeWindow(tpl, date); // a seasonal one runs over its calendar month
  if (win.end < date) { await showChallengePicker(ctx); return; } // an old month's season
  await joinChallenge(ctx.db, ctx.user._id, code, win.start, win.end);
  const daysLeft = Math.round((Date.parse(win.end) - Date.parse(date)) / 86_400_000) + 1;
  await reply(ctx, t(lang, "chal_joined", { title: challengeTitle(lang, tpl), days: daysLeft }));
  await cmdChallenges(ctx);
}
