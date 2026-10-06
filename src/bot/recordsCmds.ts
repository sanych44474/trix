// Records and leaderboards in the chat: weekly boards, hall of fame, badges, PRs, the compete
// toggle and the public alias. Split out of bot.ts (god-file split); bot.ts re-exports everything here.
import { listStrength, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { listAchievements } from "../adapters/d1/v2Gamification";
import { updateUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import { localParts } from "../domain/localTime";
import { formatRecordBest } from "../domain/setFormat";
import { weekStreak } from "../domain/records";
import { renderBoard } from "../render";
import { prDate } from "./exportData";
import { computeBoards, isoDateMinus, recordsTabs, renderBadges } from "../features/gamification/boards";
import { clearEditOwner, reply, setMode, type MyContext } from "../adapters/telegram/context";

export async function cmdRecords(ctx: MyContext, tab: "weekly" | "hall" | "badges" | "prs" = "weekly") {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const you = ctx.user._id;
  let body: string;
  if (tab === "prs") {
    // Personal PR ledger: each tracked lift with its best result and the date it was set —
    // the "when was my last PR?" answer without a trip to /export.
    const records = await listStrength(ctx.db, you);
    if (!records.length) {
      body = t(lang, "prs_empty");
    } else {
      const sorted = [...records].sort((a, b) => prDate(b).localeCompare(prDate(a)));
      const lines = sorted.slice(0, 20).map((r) => `• <b>${escapeHtml(r.exercise)}</b> — ${formatRecordBest(r)} · ${prDate(r)}`);
      body = `${t(lang, "prs_title")}\n${lines.join("\n")}`;
    }
  } else if (tab === "badges") {
    body = renderBadges(lang, await listAchievements(ctx.db, you));
  } else if (tab === "hall") {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    body = [
      renderBoard(lang, t(lang, "board_relative"), b.relative, you, (v) => `${v.toFixed(2)}× ${t(lang, "unit_bw")}`, true),
      "",
      renderBoard(lang, t(lang, "board_total"), b.total, you, (v) => `${v} 🏋️`),
      "",
      renderBoard(lang, t(lang, "board_recentprs"), b.recentPrs, you, (v) => `${v} 🏆`),
    ].join("\n");
  } else {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    const today = localParts(ctx.user.profile.timezone).date;
    const myDates = (await workoutLogsSince(ctx.db, you, isoDateMinus(today, 120)))
      .filter((l) => l.completed)
      .map((l) => l.date);
    const streak = weekStreak(myDates, today, ctx.user.reminders?.lastVacation);
    body = [
      renderBoard(lang, t(lang, "board_consistency"), b.consistency, you, (v) => `${v} 🏋️`),
      "",
      renderBoard(lang, t(lang, "board_improved"), b.improved, you, (v) => `+${v.toFixed(1)}%`, true),
      "",
      renderBoard(lang, t(lang, "board_streak"), b.streak, you, (v) => `${v} 🧊`),
      "",
      t(lang, "your_streak", { weeks: streak }),
    ].join("\n");
  }
  const note = ctx.user.competeOptIn ? "" : `\n\n${t(lang, "records_optin_hint")}`;
  await reply(ctx, `${t(lang, "records_title")}\n\n${body}${note}`, recordsTabs(lang, !!ctx.user.competeOptIn));
}

// Toggle leaderboard participation.
export async function toggleCompete(ctx: MyContext) {
  const next = !ctx.user.competeOptIn;
  await updateUser(ctx.db, ctx.user._id, { competeOptIn: next });
  ctx.user.competeOptIn = next;
  await reply(ctx, t(ctx.user.lang, next ? "compete_on" : "compete_off"));
  await cmdRecords(ctx);
}

export async function setAlias(ctx: MyContext, value: string) {
  await updateUser(ctx.db, ctx.user._id, { alias: value });
  ctx.user.alias = value;
  await setMode(ctx, "idle");
  await reply(ctx, t(ctx.user.lang, "alias_saved"));
  await cmdRecords(ctx);
}

export async function handleAliasInput(ctx: MyContext, text: string) {
  await setAlias(ctx, text.trim().slice(0, 24));
}
