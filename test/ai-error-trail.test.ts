// Improvement #3 from the production-readiness list: recordError used to log only the LAST
// provider's failure when the whole fallback chain failed, discarding why every earlier
// provider also failed. run() (ai/index.ts) now appends a short per-attempt trail
// ("provider:reason -> provider:reason") to the stored error message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiText } from "../src/ai/index";
import type { Env } from "../src/types";

test("run(): a fully-failed chain records a multi-provider trail, not just the last error", async () => {
  const db = newDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("simulated network failure"); }) as typeof fetch;
  try {
    const env = { GEMINI_API_KEY: "k1", GROQ_API_KEY: "k2" } as unknown as Env;
    await assert.rejects(() => aiText(env, { system: "s", user: "u", kind: "coach", db }));

    const row = await db
      .prepare("SELECT message FROM error_logs ORDER BY id DESC LIMIT 1")
      .first<{ message: string | null }>();
    assert.ok(row?.message, "expected an error_logs row to have been written");
    assert.match(row!.message!, /trail:/);
    assert.match(row!.message!, /gemini:/);
    assert.match(row!.message!, /groq:/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
