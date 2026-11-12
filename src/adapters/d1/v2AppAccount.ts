// An account created by a sign-in that has no Telegram chat (email code, Google). The email and
// Google routes add their own identity rows to these statements and run them as one batch.
import { randomBelow } from "../../domain/secrets";
import type { Lang } from "../../types";
import type { DB } from "./shared";

/** A fresh id and the four rows every account needs. The ids are negative, so Telegram ids are
 * untouched; the chat id is synthetic and unreachable, and botBlocked keeps scheduled Telegram
 * delivery away from it. A random id can collide: the caller retries with a new call. */
export function newAppAccount(db: DB, lang: Lang, now: string): { accountId: number; statements: D1PreparedStatement[] } {
  const accountId = -(1_000_000_000 + randomBelow(1_000_000_000));
  const chatId = -(4_000_000_000_000_000 + randomBelow(1_000_000_000) * 1_000 + randomBelow(1_000));
  return {
    accountId,
    statements: [
      db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, botBlocked, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', 1, ?, ?)").bind(accountId, accountId, chatId, now, now),
      db.prepare("INSERT INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, ?, '{}', ?)").bind(accountId, lang, now),
      db.prepare("INSERT INTO v2_preferences (accountId, lang, updatedAt) VALUES (?, ?, ?)").bind(accountId, lang, now),
      db.prepare("INSERT INTO v2_onboarding (accountId, status, sessionMode, updatedAt) VALUES (?, 'in_progress', 'idle', ?)").bind(accountId, now),
    ],
  };
}
