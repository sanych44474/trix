// The `?tma=` initData query param is accepted only for the photo proxy's GET reads (<img src> cannot send
// headers). Anywhere else a query string would leak a live 24h initData into logs and WebView history.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { miniAppUser } from "../src/webapp/auth";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const TOKEN = "12345:TEST_TOKEN";

/** Forge initData the way Telegram signs it (double HMAC over the sorted data-check-string). */
function forge(fields: Record<string, string>): string {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

function signedInitData(userId: number): string {
  const authDate = String(Math.floor(Date.now() / 1000) - 60);
  return forge({ auth_date: authDate, user: JSON.stringify({ id: userId, first_name: "Test" }) });
}

async function setup() {
  const db = newDb();
  const user = await getOrCreateUser(db, 5301, 5301, "en", "Test");
  const env = { DB: db, TELEGRAM_BOT_TOKEN: TOKEN } as unknown as Env;
  return { env, user };
}

test("tma in the query authenticates GET /api/v2/photo", async () => {
  const { env, user } = await setup();
  const url = new URL(`https://x/api/v2/photo?id=abc&tma=${encodeURIComponent(signedInitData(5301))}`);
  const resolved = await miniAppUser(new Request(url), url, env);
  assert.equal(resolved?._id, user._id);
});

test("tma in the query still authenticates the legacy GET /api/photo path", async () => {
  const { env, user } = await setup();
  const url = new URL(`https://x/api/photo?id=abc&tma=${encodeURIComponent(signedInitData(5301))}`);
  const resolved = await miniAppUser(new Request(url), url, env);
  assert.equal(resolved?._id, user._id);
});

test("tma in the query is refused on a GET read route", async () => {
  const { env } = await setup();
  const url = new URL(`https://x/api/v2/dashboard?tma=${encodeURIComponent(signedInitData(5301))}`);
  assert.equal(await miniAppUser(new Request(url), url, env), null);
});

test("tma in the query is refused on a mutating request to the photo path", async () => {
  const { env } = await setup();
  const url = new URL(`https://x/api/v2/photo?id=abc&tma=${encodeURIComponent(signedInitData(5301))}`);
  const req = new Request(url, { method: "POST" });
  assert.equal(await miniAppUser(req, url, env), null);
});

test("tma in the query is refused on a mutating request to another route", async () => {
  const { env } = await setup();
  const url = new URL(`https://x/api/v2/owner/users?tma=${encodeURIComponent(signedInitData(5301))}`);
  const req = new Request(url, { method: "PUT" });
  assert.equal(await miniAppUser(req, url, env), null);
});

test("tma in the authorization header still authenticates a GET read route", async () => {
  const { env, user } = await setup();
  const url = new URL("https://x/api/v2/dashboard");
  const req = new Request(url, { headers: { authorization: `tma ${signedInitData(5301)}` } });
  assert.equal((await miniAppUser(req, url, env))?._id, user._id);
});

test("tma in the authorization header still authenticates a mutating request", async () => {
  const { env, user } = await setup();
  const url = new URL("https://x/api/v2/dashboard");
  const req = new Request(url, { method: "POST", headers: { authorization: `tma ${signedInitData(5301)}` } });
  assert.equal((await miniAppUser(req, url, env))?._id, user._id);
});
