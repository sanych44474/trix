// Sends the latest release note to users' chats, each in their own language, and marks each
// delivery (reminders.releaseSent) so a broadcast that stops -- a Worker limit, a tap on
// "continue" later -- resumes without sending anyone the same note twice. Used by the bot's
// /whatsnew owner button and by the owner console in the Mini App (in batches there).
import type { Env } from "../types";
import { listOnboardedUsers, updateUser } from "../adapters/d1/v2Users";
import { recordAudit } from "../adapters/d1/v2Admin";
import { latestRelease, releaseBody } from "../releaseNotes";
import { releaseRecipients } from "../domain/releaseDelivery";
import { appMarkup } from "../notify/appKeyboard";
import { t } from "../locales/i18n";

export interface ReleaseBroadcastResult { version: string; sent: number; failed: number; remaining: number }

/** Recipients still owed the latest note (for the owner's "send to N" labels). */
export async function pendingReleaseRecipients(env: Env): Promise<number> {
  return releaseRecipients(await listOnboardedUsers(env.DB), latestRelease().version).length;
}

export async function broadcastRelease(env: Env, ownerId: number, limit: number): Promise<ReleaseBroadcastResult> {
  const note = latestRelease();
  const due = releaseRecipients(await listOnboardedUsers(env.DB), note.version);
  const batch = due.slice(0, Math.max(0, limit));
  let sent = 0;
  let failed = 0;
  let blocked = 0;
  for (const u of batch) {
    // The chat is retired: the note ends with an Open-app button, not a menu instruction.
    const markup = appMarkup(env, t(u.lang, "launch_open_btn"), "today");
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: u.chatId, text: releaseBody(u.lang, note), parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
    }).catch(() => null);
    if (res?.ok) {
      sent++;
      await updateUser(env.DB, u._id, { reminders: { ...u.reminders, releaseSent: note.version } }).catch(() => {});
    } else {
      failed++;
      // 403 = the user blocked the bot: stop counting them as reachable (same as the bot's own sends).
      if (res?.status === 403) {
        blocked++;
        await updateUser(env.DB, u._id, { botBlocked: true }).catch(() => {});
      }
    }
  }
  // Still owed: everyone not reached yet, minus those who turned out to have blocked the bot.
  const remaining = due.length - sent - blocked;
  await recordAudit(env.DB, ownerId, "release_notes", undefined, `${note.version} ${sent}/${batch.length}`).catch(() => {});
  return { version: note.version, sent, failed, remaining: Math.max(0, remaining) };
}
