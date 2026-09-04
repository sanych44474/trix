// Challenges (join a consistency goal, track progress, celebrate completion) — extracted from
// bot.ts (god-file split; same barrel seam via bot.ts's `export * from "./bot/challenges"`).
// The "Challenges" banner in bot.ts also held an unrelated cmdFeedback and the reminder on/off
// settings (REMINDER_TYPES/showReminderSettings/onReminderToggle) — those stayed in bot.ts,
// they aren't challenges code and moving them here would just relocate the same drift.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../types";
import {
  activeChallengeCodes, activeChallenges, countCompletedChallenges, joinChallenge, markChallengeDone,
  nutritionLogsSince, stepLogsSince, waterLogsSince, workoutLogsSince,
} from "../db/repos";
import {
  CHALLENGES, challengeByCode, challengeCurrent, challengeStatus, challengeWindowCounts, progressBar,
  type ChallengeData, type ChallengeTemplate,
} from "../domain/challenges";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { isoDateMinus } from "./boards";
import { type MyContext, type TKey, clearEditOwner, menuBtn, reply, waterGoalFor } from "../bot";

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
  return `${tpl.emoji} ${t(lang, `chal_${tpl.code}_title` as TKey)}`;
}

export async function cmdChallenges(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const active = await activeChallenges(ctx.db, ctx.user._id, date);
  const blocks: string[] = [];
  const completedNow: string[] = [];
  for (const ch of active) {
    const tpl = challengeByCode(ch.code);
    if (!tpl) continue;
    const data = await challengeData(ctx, ch.startDate, ch.endDate);
    const st = challengeStatus(tpl, challengeCurrent(tpl, data));
    if (st.done) {
      // Completion is recorded on the challenge row (completedAt) — counted by countCompletedChallenges.
      // Not an achievement badge (those are a fixed catalog and would skew the badge counter).
      await markChallengeDone(ctx.db, ch.id);
      completedNow.push(challengeTitle(lang, tpl));
      continue;
    }
    const daysLeft = Math.max(0, Math.round((Date.parse(ch.endDate) - Date.parse(date)) / 86_400_000));
    blocks.push(
      `<b>${escapeHtml(challengeTitle(lang, tpl))}</b>\n${progressBar(st.pct)} ${st.current}/${st.target} · ${t(lang, "chal_days_left", { n: daysLeft })}`,
    );
  }
  const won = await countCompletedChallenges(ctx.db, ctx.user._id);
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
  const available = CHALLENGES.filter((c) => !taken.has(c.code));
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
  const endDate = isoDateMinus(date, -(tpl.windowDays - 1)); // start + (windowDays - 1) days, inclusive
  await joinChallenge(ctx.db, ctx.user._id, code, date, endDate);
  await reply(ctx, t(lang, "chal_joined", { title: challengeTitle(lang, tpl), days: tpl.windowDays }));
  await cmdChallenges(ctx);
}
