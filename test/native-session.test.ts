// Sessions for the native app: the token comes back in the body only to a native request (no Origin,
// X-Client: native) and then works as a bearer token; a browser request only ever gets the HttpOnly
// cookie, so page script can never read a session token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { confirmTelegramLogin, handleProviderAuth } from "../src/webapp/providerAuth";
import { handleEmailAuth } from "../src/webapp/emailAuth";
import { isNativeClient } from "../src/webapp/appSessions";
import type { Env } from "../src/types";

const host = "https://hl.example";
const NATIVE = { "x-client": "native", "content-type": "application/json" };
const WEB = { origin: host, "content-type": "application/json" };

async function signIn(env: Env, headers: Record<string, string>, accountId: number) {
  const call = (path: string, body: unknown) =>
    handleProviderAuth(new Request(`${host}${path}`, { method: "POST", headers, body: JSON.stringify(body) }), new URL(`${host}${path}`), env);
  const start = (await (await call("/api/v2/auth/telegram/start", {}))!.json() as { data: { challengeId: string; completionToken: string } }).data;
  await confirmTelegramLogin(env.DB, start.challengeId, accountId);
  return (await call("/api/v2/auth/telegram/complete", start))!;
}

const session = (env: Env, headers: Record<string, string>) =>
  handleEmailAuth(new Request(`${host}/api/v2/auth/session`, { headers }), new URL(`${host}/api/v2/auth/session`), env);

test("isNativeClient: only a request that says so AND carries no Origin", () => {
  assert.equal(isNativeClient(new Request(host, { headers: { "x-client": "native" } })), true);
  assert.equal(isNativeClient(new Request(host, { headers: { "x-client": "native", origin: host } })), false, "a web page setting the header still sends Origin");
  assert.equal(isNativeClient(new Request(host)), false);
});

test("native sign-in returns a bearer token, sets no cookie, and the token authenticates and logs out", async () => {
  const db = newDb();
  await getOrCreateUser(db, 900, 900, "en", "Native");
  const env = { DB: db, BOT_USERNAME: "hacklimitsbot", RL_AUTH: { limit: async () => ({ success: true }) } } as unknown as Env;

  const res = await signIn(env, NATIVE, 900);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
  const { data } = await res.json() as { data: { sessionToken?: string } };
  assert.match(data.sessionToken ?? "", /^[0-9a-f]{64}$/);

  const bearer = { authorization: `Bearer ${data.sessionToken}` };
  const me = await (await session(env, bearer))!.json() as { data: { authenticated: boolean; accountId: number; method: string } };
  assert.deepEqual([me.data.authenticated, me.data.accountId, me.data.method], [true, 900, "telegram"]);

  const out = await handleEmailAuth(new Request(`${host}/api/v2/auth/logout`, { method: "POST", headers: bearer }), new URL(`${host}/api/v2/auth/logout`), env);
  assert.equal(out!.status, 200);
  const after = await (await session(env, bearer))!.json() as { data: { authenticated: boolean } };
  assert.equal(after.data.authenticated, false, "the revoked token no longer works");
});

test("web sign-in gets the HttpOnly cookie and never sees the token", async () => {
  const db = newDb();
  await getOrCreateUser(db, 901, 901, "en", "Web");
  const env = { DB: db, BOT_USERNAME: "hacklimitsbot", RL_AUTH: { limit: async () => ({ success: true }) } } as unknown as Env;
  const res = await signIn(env, WEB, 901);
  assert.match(res.headers.get("set-cookie") ?? "", /__Host-trix_session=[0-9a-f]{64};.*HttpOnly/);
  const { data } = await res.json() as { data: { sessionToken?: string } };
  assert.equal(data.sessionToken, undefined);
});
