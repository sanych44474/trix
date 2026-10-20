import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/types";
import { confirmTelegramLogin, handleProviderAuth } from "../src/webapp/providerAuth";
import { newDb } from "./harness";

const origin = "https://trix.example";

function request(path: string, body?: unknown): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

test("Telegram sign-in completion is bound to the initiating browser secret and remains one-time", async () => {
  const db = newDb();
  const now = new Date().toISOString();
  const accountId = 54321;
  db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)")
    .bind(accountId, accountId, accountId, now, now).run();
  const env = {
    DB: db,
    BOT_USERNAME: "trixbot",
    RL_AUTH: { limit: async () => ({ success: true }) },
  } as unknown as Env;

  const start = await handleProviderAuth(request("/api/v2/auth/telegram/start"), new URL(`${origin}/api/v2/auth/telegram/start`), env);
  assert.ok(start);
  assert.equal(start.status, 200);
  const { data: challenge } = await start.json() as { data: { challengeId: string; completionToken: string; telegramUrl: string } };
  assert.match(challenge.challengeId, /^[0-9a-f]{32}$/);
  assert.match(challenge.completionToken, /^[0-9a-f]{64}$/);
  assert.equal(challenge.telegramUrl.includes(challenge.completionToken), false);
  assert.equal(await confirmTelegramLogin(db, challenge.challengeId, accountId), true);

  const wrongProof = await handleProviderAuth(request("/api/v2/auth/telegram/complete", {
    challengeId: challenge.challengeId,
    completionToken: "0".repeat(64),
  }), new URL(`${origin}/api/v2/auth/telegram/complete`), env);
  assert.ok(wrongProof);
  assert.equal(wrongProof.status, 401);
  assert.equal(db.prepare("SELECT consumedAt FROM v2_auth_telegram_challenges WHERE id = ?").bind(challenge.challengeId).first<{ consumedAt: string | null }>()?.consumedAt, null);

  const complete = await handleProviderAuth(request("/api/v2/auth/telegram/complete", challenge), new URL(`${origin}/api/v2/auth/telegram/complete`), env);
  assert.ok(complete);
  assert.equal(complete.status, 200);
  assert.match(complete.headers.get("set-cookie") ?? "", /HttpOnly/);

  const replay = await handleProviderAuth(request("/api/v2/auth/telegram/complete", challenge), new URL(`${origin}/api/v2/auth/telegram/complete`), env);
  assert.ok(replay);
  assert.equal(replay.status, 401);
});
