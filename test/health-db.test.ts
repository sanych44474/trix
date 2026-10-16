// /health/db is public. When D1 is down its body must not echo the thrown error (which can name
// tables, columns or binding details) to an anonymous caller; the real error goes to the logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index";
import type { Env } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

test("/health/db: a failing D1 returns a generic 500 body, never the thrown message", async () => {
  const secret = "SQLITE_CORRUPT: table v2_users page 7 unreadable";
  const brokenDb = { prepare() { throw new Error(secret); } };
  const env = { DB: brokenDb, TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;

  const res = await worker.fetch(new Request("https://w.example/health/db"), env, ctx);

  assert.equal(res.status, 500);
  const text = await res.text();
  assert.doesNotMatch(text, /SQLITE_CORRUPT|v2_users/, "the D1 error text stays out of the public body");
  assert.deepEqual(JSON.parse(text), { ok: false, error: "db unavailable" });
});
