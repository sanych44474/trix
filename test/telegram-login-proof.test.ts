import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/types";
import { confirmTelegramLogin, handleProviderAuth } from "../src/webapp/providerAuth";
import { makeCtx, newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { answerTelegramLogin, promptTelegramLogin } from "../src/bot/telegramLogin";
import { cmdStart } from "../src/bot/start";

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

async function startChallenge(env: Env) {
  const res = await handleProviderAuth(request("/api/v2/auth/telegram/start"), new URL(`${origin}/api/v2/auth/telegram/start`), env);
  return (await res!.json() as { data: { challengeId: string; completionToken: string; matchCode: string } }).data;
}
const complete = (env: Env, c: { challengeId: string; completionToken: string }) =>
  handleProviderAuth(request("/api/v2/auth/telegram/complete", c), new URL(`${origin}/api/v2/auth/telegram/complete`), env);
const authEnv = (db: ReturnType<typeof newDb>) => ({ DB: db, BOT_USERNAME: "trixbot", RL_AUTH: { limit: async () => ({ success: true }) } }) as unknown as Env;

test("Telegram sign-in: opening the deep link only asks, it never signs the app in", async () => {
  const db = newDb();
  const env = authEnv(db);
  await getOrCreateUser(db, 777, 777, "en", "Victim");
  const challenge = await startChallenge(env);
  assert.match(challenge.matchCode, /^\d{4}$/);

  const { ctx, sent } = makeCtx(db, (await getUser(db, 777)) as never);
  await cmdStart(ctx as never, `login_${challenge.challengeId}`);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes(challenge.matchCode), "the bot shows the same code as the app");
  assert.ok(sent[0].hasKb, "Confirm / This wasn't me buttons");
  assert.equal((await complete(env, challenge))!.status, 409, "still not confirmed: the link alone is not consent");
});

test("Telegram sign-in: Confirm signs in once; This wasn't me makes the request unusable", async () => {
  const db = newDb();
  const env = authEnv(db);
  await getOrCreateUser(db, 778, 778, "en", "Owner");
  const user = (await getUser(db, 778)) as never;

  const ok = await startChallenge(env);
  await answerTelegramLogin(makeCtx(db, user).ctx as never, ok.challengeId, true);
  assert.equal((await complete(env, ok))!.status, 200);

  const denied = await startChallenge(env);
  await answerTelegramLogin(makeCtx(db, user).ctx as never, denied.challengeId, false);
  await answerTelegramLogin(makeCtx(db, user).ctx as never, denied.challengeId, true);
  assert.equal((await complete(env, denied))!.status, 401, "a rejected request can't be confirmed or completed later");

  const { ctx, sent } = makeCtx(db, user);
  await promptTelegramLogin(ctx as never, denied.challengeId);
  assert.match(sent[0].text, /expired|already used/, "the old link no longer offers buttons");
  assert.equal(sent[0].hasKb, false);
});
