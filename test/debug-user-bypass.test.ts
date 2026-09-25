// The ?debugUser= Mini App auth bypass used to be gated on `!env.WORKER_URL` -- a blank or unset
// WORKER_URL (exactly what a misconfigured deploy-time repo variable produces) silently reopened
// a full auth bypass on every /api/v2/* endpoint, including /api/v2/owner/*. It is now gated on an
// explicit ALLOW_DEBUG_USER opt-in instead, decoupled from WORKER_URL entirely.
import assert from "node:assert/strict";
import test from "node:test";
import { miniAppUser } from "../src/webapp/auth";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { newDb } from "./harness";
import type { Env } from "../src/types";

async function seededUser(db: ReturnType<typeof newDb>) {
  return getOrCreateUser(db, 4201, 4201, "en", "Test");
}

test("debugUser is refused when WORKER_URL is blank and ALLOW_DEBUG_USER is unset -- the exact misconfiguration this closes", async () => {
  const db = newDb();
  await seededUser(db);
  // No ALLOW_DEBUG_USER at all -- the state a deployed Worker is in by default.
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", WORKER_URL: "" } as unknown as Env;
  const req = new Request("https://x/api/v2/dashboard?debugUser=4201");
  const user = await miniAppUser(req, new URL(req.url), env);
  assert.equal(user, null, "an empty WORKER_URL alone must never authenticate a request");
});

test("debugUser is refused when ALLOW_DEBUG_USER is explicitly '0'", async () => {
  const db = newDb();
  await seededUser(db);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", ALLOW_DEBUG_USER: "0" } as unknown as Env;
  const req = new Request("https://x/api/v2/dashboard?debugUser=4201");
  assert.equal(await miniAppUser(req, new URL(req.url), env), null);
});

test("debugUser works when ALLOW_DEBUG_USER is '1', regardless of WORKER_URL", async () => {
  const db = newDb();
  const user = await seededUser(db);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", ALLOW_DEBUG_USER: "1", WORKER_URL: "https://example.test" } as unknown as Env;
  const req = new Request("https://x/api/v2/dashboard?debugUser=4201");
  const resolved = await miniAppUser(req, new URL(req.url), env);
  assert.equal(resolved?._id, user._id);
});

test("a non-numeric debugUser still resolves to no user even with the flag on", async () => {
  const db = newDb();
  await seededUser(db);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", ALLOW_DEBUG_USER: "1" } as unknown as Env;
  const req = new Request("https://x/api/v2/dashboard?debugUser=nope");
  assert.equal(await miniAppUser(req, new URL(req.url), env), null);
});
