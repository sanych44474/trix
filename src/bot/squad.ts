// Squad mode — the bot in a group chat friends already use.
//
// Two things make this different from the global leaderboard the app already has. First, it lives
// where the conversation already happens instead of asking people to open another screen. Second,
// its own feature-audit says public boards demotivate at the current user count: a squad is a
// handful of people who know each other, where "nobody has trained yet this week" is a nudge
// rather than a ranking.
//
// SAFETY: group chats are handled entirely here and NEVER fall through to the private-chat
// router. Every other handler assumes a 1:1 chat — letting a group update reach them would dump
// someone's plan into the group, and would create their user row with the GROUP's chat id as
// their personal chatId, sending every future reminder to the group.
import type { Api } from "grammy";
import type { D1Database } from "@cloudflare/workers-types";
import { HTML, type MyContext } from "../bot";
import { getUser } from "../db/repos";
import {
  deleteSquad,
  getSquad,
  joinSquad,
  leaveSquad,
  squadCompletedDates,
  squadMembers,
  squadsForUser,
  upsertSquad,
} from "../db/repos";
import { weekStartStr } from "../domain/records";
import { squadMedal, squadWeek, type SquadWeek } from "../domain/squad";
import { escapeHtml, t } from "../locales/i18n";
import type { Lang } from "../types";

const GROUP_COMMAND = /^\/(squad|squadleave|squadboard)(?:@[\w_]+)?(?:\s|$)/i;

const displayName = (m: { userId: number; name: string | null; alias: string | null }): string =>
  (m.alias || m.name || `id ${m.userId}`).trim() || `id ${m.userId}`;

/** The language a group message goes out in: whatever most of its members use. */
function squadLang(members: { lang: string }[]): Lang {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.lang, (counts.get(m.lang) ?? 0) + 1);
  let best: Lang = "uk";
  let bestN = 0;
  for (const [lang, n] of counts) {
    if (n > bestN && (lang === "en" || lang === "uk")) {
      best = lang;
      bestN = n;
    }
  }
  return best;
}

export function renderSquadBoard(lang: Lang, week: SquadWeek, title: string | null, past: boolean): string {
  const head = t(lang, past ? "squad_recap_title" : "squad_board_title", {
    title: title?.trim() || t(lang, "squad_default_title"),
  });
  const rows = week.entries.map((e, i) => {
    const medal = squadMedal(week.entries, i);
    const count = e.workouts ? `<b>${e.workouts}</b>` : "0";
    return `${medal} ${escapeHtml(e.name)} — ${count}`;
  });
  const footer = week.total === 0
    ? t(lang, past ? "squad_recap_none" : "squad_board_none")
    : week.silent > 0
      ? t(lang, "squad_board_silent", { n: week.silent, total: week.total })
      : t(lang, "squad_board_all_in", { total: week.total });
  return [head, "", ...rows, "", footer].join("\n");
}

export interface DigestWindow {
  weekStart: string;
  until?: string; // exclusive; set for the Monday recap so a fresh week doesn't dilute the count
  past?: boolean; // wording: "last week" vs "this week"
}

/** Build and post a squad board for the given window. Returns false when the chat is gone (the
 * bot was kicked or the group was deleted) — the caller drops the squad. */
export async function postSquadDigest(db: D1Database, api: Api, chatId: number, win: DigestWindow): Promise<boolean> {
  const [squad, members] = await Promise.all([getSquad(db, chatId), squadMembers(db, chatId)]);
  if (!squad || members.length === 0) return true; // nothing to post, but the squad is still valid
  const lang = squadLang(members);
  const dates = await squadCompletedDates(db, chatId, win.weekStart, win.until);
  const week = squadWeek(members.map((m) => ({ userId: m.userId, name: displayName(m) })), dates, win.weekStart);
  try {
    await api.sendMessage(chatId, renderSquadBoard(lang, week, squad.title, win.past ?? false), HTML);
    return true;
  } catch (err) {
    // 403 = kicked / chat deleted / bot blocked there. Anything else is transient: keep the squad
    // and let the next run try again rather than deleting people's data on a network blip.
    const status = (err as { error_code?: number })?.error_code;
    if (status === 403 || status === 400) return false;
    console.error("squad digest", chatId, err);
    return true;
  }
}

/** Tell a user's squads about a personal record. Fire-and-forget: a squad post must never be able
 * to fail the workout save that triggered it. */
export async function announceSquadPr(db: D1Database, api: Api, userId: number, exercise: string, best: string): Promise<void> {
  const chats = await squadsForUser(db, userId).catch(() => [] as number[]);
  if (!chats.length) return;
  const user = await getUser(db, userId).catch(() => null);
  const who = user?.alias || user?.profile.name || `id ${userId}`;
  for (const chatId of chats) {
    const members = await squadMembers(db, chatId).catch(() => []);
    if (!members.length) continue;
    const text = t(squadLang(members), "squad_pr", { name: who, exercise, best });
    await api.sendMessage(chatId, text, HTML).catch(() => {});
  }
}

/**
 * Everything the bot does inside a group chat. Returns without a word for anything that isn't a
 * squad command — a group is not the place for the bot to have opinions unprompted.
 */
export async function handleGroupUpdate(ctx: MyContext, today: string): Promise<void> {
  const text = ctx.message?.text ?? "";
  const match = GROUP_COMMAND.exec(text);
  if (!match || !ctx.from || !ctx.chat) return;
  const command = match[1].toLowerCase();
  const chatId = ctx.chat.id;
  const title = "title" in ctx.chat ? (ctx.chat.title ?? null) : null;

  // Squad membership is for people who already use the bot: it reads their training log. Anyone
  // else gets pointed at a DM rather than silently added.
  const user = await getUser(ctx.db, ctx.from.id).catch(() => null);
  const lang: Lang = user?.lang ?? (ctx.from.language_code?.startsWith("uk") ? "uk" : "en");
  const say = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    ctx.reply(t(lang, key, vars), HTML).catch(() => {});

  if (!user || !user.onboarded) {
    await say("squad_dm_first");
    return;
  }

  if (command === "squad") {
    await upsertSquad(ctx.db, chatId, title, user._id);
    const added = await joinSquad(ctx.db, chatId, user._id);
    const members = await squadMembers(ctx.db, chatId);
    await say(added ? "squad_joined" : "squad_already_in", { name: user.alias || user.profile.name || "", n: members.length });
    return;
  }

  if (command === "squadleave") {
    const removed = await leaveSquad(ctx.db, chatId, user._id);
    const members = await squadMembers(ctx.db, chatId);
    if (!members.length) await deleteSquad(ctx.db, chatId); // last one out closes the squad
    await say(removed ? "squad_left" : "squad_not_in");
    return;
  }

  // squadboard
  const squad = await getSquad(ctx.db, chatId);
  if (!squad) {
    await say("squad_not_here");
    return;
  }
  await postSquadDigest(ctx.db, ctx.api, chatId, { weekStart: weekStartStr(today) });
}
