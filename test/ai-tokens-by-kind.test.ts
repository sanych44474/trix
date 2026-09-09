// aiTokensByKindSince — improvement #4 from the production-readiness list. aiCallStatsSince
// already rolled tokens up by provider; this adds the per-task (AiKind) breakdown so a runaway
// prompt in one flow shows up distinctly instead of only in the provider-wide total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiCallStmt, aiTokensByKindSince } from "../src/db/repos";

test("aiTokensByKindSince: sums tokens per kind, sorted by tokens desc, ignores rows outside the window", async () => {
  const db = newDb();
  await db.batch([
    aiCallStmt(db, { provider: "gemini", kind: "coach", latencyMs: 100, tokens: 50, wasFallback: false }),
    aiCallStmt(db, { provider: "gemini", kind: "coach", latencyMs: 100, tokens: 30, wasFallback: false }),
    aiCallStmt(db, { provider: "gemini", kind: "plan", latencyMs: 200, tokens: 500, wasFallback: false }),
    aiCallStmt(db, { provider: "groq", kind: "nutrition", latencyMs: 50, wasFallback: false }), // no tokens (failed/unknown)
  ]);
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
  await db.prepare("INSERT INTO ai_call_logs (userId, provider, kind, latency_ms, tokens, was_fallback, ts) VALUES (NULL,'gemini','plan',1,9999,0,?)").bind(old).run();

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const stats = await aiTokensByKindSince(db, since);

  assert.deepEqual(stats, [
    { kind: "plan", calls: 1, tokens: 500 },
    { kind: "coach", calls: 2, tokens: 80 },
    { kind: "nutrition", calls: 1, tokens: 0 },
  ]);
});
