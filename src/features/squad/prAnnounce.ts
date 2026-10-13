// Telling a squad about a member's new record (from the workout save, bot or Mini App). Moved from bot/squad.ts.
import type { Api } from "grammy";
import { HTML } from "../../adapters/telegram/context";
import { getUser } from "../../adapters/d1/v2Users";
import { getSquad, isAppSquad, squadMembers, squadsForUser } from "../../adapters/d1/v2Gamification";
import { recordInbox } from "../../adapters/d1/v2Inbox";
import { t } from "../../locales/i18n";
import { squadLang } from "./digest";

/** Tell a user's squads about a personal record. Fire-and-forget: a squad post must never be able
 * to fail the workout save that triggered it.
 *
 * Takes only the `sendMessage` surface, not a whole grammY Api, so the Mini App's ctx-free save
 * path can call it too (src/webapp/workout.ts) without constructing a Bot. */
export async function announceSquadPr(
  db: D1Database,
  api: { sendMessage: Api["sendMessage"] },
  userId: number,
  exercise: string,
  best: string,
): Promise<void> {
  const chats = await squadsForUser(db, userId).catch(() => [] as number[]);
  if (!chats.length) return;
  const user = await getUser(db, userId).catch(() => null);
  const who = user?.alias || user?.profile.name || `id ${userId}`;
  for (const chatId of chats) {
    const members = await squadMembers(db, chatId).catch(() => []);
    if (!members.length) continue;
    if (isAppSquad(chatId)) {
      const squad = await getSquad(db, chatId).catch(() => null);
      for (const m of members) {
        if (m.userId !== userId) await recordInbox(db, m.userId, "squad_pr", { name: who, exercise, best, title: squad?.title ?? "" });
      }
      continue;
    }
    const text = t(squadLang(members), "squad_pr", { name: who, exercise, best });
    await api.sendMessage(chatId, text, HTML).catch(() => {});
  }
}
