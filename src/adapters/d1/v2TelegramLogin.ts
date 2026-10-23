// Telegram sign-in challenges for the native app (migrations 0100/0101): read by the bot's confirm
// prompt, answered by its buttons. The HTTP side (start/status/complete) is webapp/providerAuth.ts.
import type { DB } from "./shared";

/** The match code of a sign-in that is still waiting for a decision, or null if it expired, was used
 * or was already answered. Opening the deep link only shows this; it never signs anyone in. */
export async function pendingTelegramLogin(db: DB, challengeId: string): Promise<{ matchCode: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(challengeId)) return null;
  const row = await db.prepare("SELECT matchCode FROM v2_auth_telegram_challenges WHERE id = ? AND verifiedAccountId IS NULL AND consumedAt IS NULL AND expiresAt > ?")
    .bind(challengeId, new Date().toISOString()).first<{ matchCode: string }>();
  return row ? { matchCode: row.matchCode } : null;
}

/** "This wasn't me": the challenge can never be confirmed or completed afterwards. */
export async function rejectTelegramLogin(db: DB, challengeId: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(challengeId)) return false;
  const now = new Date().toISOString();
  const rejected = await db.prepare("UPDATE v2_auth_telegram_challenges SET consumedAt = ? WHERE id = ? AND verifiedAccountId IS NULL AND consumedAt IS NULL AND expiresAt > ? RETURNING id")
    .bind(now, challengeId, now).first<{ id: string }>();
  return !!rejected;
}

/** Called from the bot's Confirm button (never from the deep link itself), after grammY has
 * authenticated and loaded the sender. */
export async function confirmTelegramLogin(db: DB, challengeId: string, accountId: number): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(challengeId)) return false;
  const now = new Date().toISOString();
  const confirmed = await db.prepare("UPDATE v2_auth_telegram_challenges SET verifiedAccountId = ? WHERE id = ? AND verifiedAccountId IS NULL AND consumedAt IS NULL AND expiresAt > ? RETURNING id")
    .bind(accountId, challengeId, now).first<{ id: string }>();
  return !!confirmed;
}
