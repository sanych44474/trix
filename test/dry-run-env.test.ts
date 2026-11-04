// A Durable Object dry run must not reach a third party. It used to copy the whole env, so a
// push-only user's reminder went out as a real FCM push (and again every hour, because the dedup
// rows were shadowed), and AI-backed jobs spent real provider calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dryRunEnv, OUTBOUND_KEYS } from "../src/durable/dryRunEnv";
import { sendPush } from "../src/adapters/fcm/fcm";
import type { Env } from "../src/types";

const realDb = { real: true } as unknown as D1Database;
const shadowDb = { shadow: true } as unknown as D1Database;
const full = {
  DB: realDb,
  TELEGRAM_BOT_TOKEN: "1:t",
  WORKER_URL: "https://w.example",
  FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "p", client_email: "e@p", private_key: "k" }),
  GEMINI_API_KEY: "g",
  GROQ_API_KEY: "q",
  OPENROUTER_API_KEY: "o",
  AI: { run: () => { throw new Error("must not run"); } },
  YOUTUBE_API_KEY: "y",
} as unknown as Env;

test("dry-run env: the DB is the shadow and every outbound credential is gone", () => {
  const env = dryRunEnv(full, shadowDb);
  assert.equal(env.DB, shadowDb);
  for (const key of OUTBOUND_KEYS) assert.equal((env as unknown as Record<string, unknown>)[key], undefined, key);
  // What the decisions need stays: the bot token (for the logging sender) and links.
  assert.equal(env.TELEGRAM_BOT_TOKEN, "1:t");
  assert.equal(env.WORKER_URL, "https://w.example");
  // The real env is not mutated: the non-dry-run path still has its keys.
  assert.equal(full.FCM_SERVICE_ACCOUNT !== undefined, true);
});

test("dry-run env: a push for a push-only user makes no network call", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  try {
    const result = await sendPush(dryRunEnv(full, shadowDb), { token: "device" }, { title: "t", body: "b", data: {} } as never);
    assert.equal(result, "failed");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = real; }
});

test("dry-run env: every Durable Object that shadows the DB builds its env with dryRunEnv", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../src/durable/", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && f !== "shadowDb.ts" && f !== "dryRunEnv.ts")
    .filter((f) => {
      const src = readFileSync(new URL(f, dir), "utf8");
      // A spread of the real env next to a shadow DB is the leak: it carries every credential along.
      return /\{\s*\.\.\.this\.env,\s*DB:\s*shadowD1/.test(src);
    });
  assert.deepEqual(offenders, [], `build the dry-run env with dryRunEnv(), not { ...this.env, DB: shadowD1(...) }`);
});
