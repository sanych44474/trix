// Account deletion on real D1, where foreign keys are enforced: the rows deleteUserData removes
// explicitly AND the ones that go by ON DELETE CASCADE from v2_accounts (sign-in methods, app
// sessions, push devices, notifications, workouts, nutrition). public/account-deletion.html promises
// all of these to users and to Google Play; this keeps that promise checked.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteUserData } from "../../src/adapters/d1/v2Account";
import type { Env } from "../../src/types";

const ID = 9701;
const TABLES = [
  "v2_accounts", "v2_profiles", "v2_auth_emails", "v2_auth_sessions", "v2_auth_identities", "v2_push_devices",
  "v2_notifications", "v2_workout_sessions", "v2_analytics_events",
];

async function count(table: string): Promise<number> {
  const column = table === "v2_accounts" ? "id" : "accountId";
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(ID).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("account erasure", () => {
  it("removes sign-in methods, sessions, push devices and activity, not just the account row", async () => {
    const t = "2026-10-20T09:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)").bind(ID, ID, ID, t, t),
      env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (?, 'en', 'Erase Me', ?)").bind(ID, t),
      env.DB.prepare("INSERT INTO v2_auth_emails (email, accountId, createdAt) VALUES ('erase@example.com', ?, ?)").bind(ID, t),
      env.DB.prepare("INSERT INTO v2_auth_sessions (tokenHash, accountId, authMethod, createdAt, expiresAt) VALUES ('h-erase', ?, 'email', ?, '2099-01-01T00:00:00.000Z')").bind(ID, t),
      env.DB.prepare("INSERT INTO v2_auth_identities (provider, subject, accountId, email, createdAt) VALUES ('google', 'sub-erase', ?, 'erase@example.com', ?)").bind(ID, t),
      env.DB.prepare("INSERT INTO v2_push_devices (token, accountId, platform, createdAt, updatedAt) VALUES ('tok-erase-0000000000000', ?, 'android', ?, ?)").bind(ID, t, t),
      env.DB.prepare("INSERT INTO v2_notifications (accountId, chatId, kind, idempotencyKey, payload, status, attempts, nextAttemptAt, createdAt) VALUES (?, 0, 'reminder', 'k-erase', '{}', 'sent', 1, ?, ?)").bind(ID, t, t),
      env.DB.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, '2026-10-19', 1, 1, ?, ?)").bind(ID, t, t),
      env.DB.prepare("INSERT INTO v2_analytics_events (accountId, event, date, count) VALUES (?, 'session', '2026-10-19', 1)").bind(ID),
    ]);
    for (const table of TABLES) expect(await count(table), `${table} seeded`).toBeGreaterThan(0);

    await deleteUserData(env as unknown as Env, ID);

    for (const table of TABLES) expect(await count(table), `${table} after deletion`).toBe(0);
  });
});
