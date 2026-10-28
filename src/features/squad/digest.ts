// The weekly squad digest posted into a group chat by the cron. Moved from bot/squad.ts.
import type { Api } from "grammy";
import { HTML } from "../../adapters/telegram/context";
import { getSquad, isAppSquad, squadCompletedDates, squadMembers } from "../../adapters/d1/v2Gamification";
import { recordInbox } from "../../adapters/d1/v2Inbox";
import { squadMedal, squadWeek, type SquadWeek } from "../../domain/squad";
import { escapeHtml, t } from "../../locales/i18n";
import type { Lang } from "../../types";

const displayName = (m: { userId: number; name: string | null; alias: string | null }): string =>
  (m.alias || m.name || `id ${m.userId}`).trim() || `id ${m.userId}`;

/** The language a group message goes out in: whatever most of its members use. */
export function squadLang(members: { lang: string }[]): Lang {
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

// Telegram says "this chat is gone for good" in two ways: 403 (bot kicked, blocked, or removed
// from the group) and a 400 whose description names the chat. A bare 400 is NOT enough — the
// same status covers "message is too long" and other request faults, and treating those as
// fatal would delete a live squad's data because one week's board got big.
const CHAT_GONE = /chat not found|chat_id is empty|group chat was upgraded|chat was deleted|bot was kicked|bot is not a member|have no rights to send/i;
export function isChatGone(err: unknown): boolean {
  const e = err as { error_code?: number; description?: string };
  if (e?.error_code === 403) return true;
  return e?.error_code === 400 && CHAT_GONE.test(e.description ?? "");
}

/** Build and post a squad board for the given window. Returns false when the chat is gone (the
 * bot was kicked or the group was deleted) — the caller drops the squad. */
// Narrowed from the concrete grammY Api so a dry-run caller (SquadSchedulerDO's alarm) can
// pass a logging stand-in instead of a real api client, without an `as unknown as Api` cast
// -- same pattern as scheduler.ts's Sender for processUser.
export interface SquadApi {
  sendMessage: Api["sendMessage"];
}

export async function postSquadDigest(db: D1Database, api: SquadApi, chatId: number, win: DigestWindow): Promise<boolean> {
  const [squad, members] = await Promise.all([getSquad(db, chatId), squadMembers(db, chatId)]);
  if (!squad || members.length === 0) return true; // nothing to post, but the squad is still valid
  const lang = squadLang(members);
  const dates = await squadCompletedDates(db, chatId, win.weekStart, win.until);
  const week = squadWeek(members.map((m) => ({ userId: m.userId, name: displayName(m) })), dates, win.weekStart);
  // An app squad has no group chat (its id is not a Telegram chat -- NEVER send to it): the
  // board goes to each member's in-app feed instead, at no Telegram cost.
  if (isAppSquad(chatId)) {
    const top = week.entries.slice(0, 3).map((e, i) => ({ medal: squadMedal(week.entries, i), name: e.name, workouts: e.workouts }));
    for (const m of members) {
      await recordInbox(db, m.userId, "squad_week", { title: squad.title ?? "", past: win.past ?? false, total: week.total, silent: week.silent, top });
    }
    return true;
  }
  try {
    await api.sendMessage(chatId, renderSquadBoard(lang, week, squad.title, win.past ?? false), HTML);
    return true;
  } catch (err) {
    if (isChatGone(err)) return false;
    // Everything else is transient — keep the squad rather than deleting a group's data over a
    // network blip or an oversized message. The callers mark the week recapped either way, so
    // this week's board is skipped, not retried (a retry would run every minute all week).
    console.error("squad digest", chatId, err);
    return true;
  }
}
