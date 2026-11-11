// A custom exercise's muscles are classified by AI when no rule or catalog entry knows the name.
// That call carried no userId, so the per-user AI limit and the per-user telemetry never saw it:
// POST /workout/custom could spend AI calls outside every per-user cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { learnExerciseMuscles } from "../src/features/exercise/muscleLearning";
import type { Env } from "../src/types";

test("learnExerciseMuscles: the AI classification is attributed to the user who added the exercise", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Ann");
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"primary":["biceps"],"secondary":[]}' } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  })) as typeof fetch;
  // The per-user AI limit counts the caller's recent attempts before any provider runs; it only
  // does so when the call names a user. Record the bound parameters of that count.
  const limitChecks: unknown[][] = [];
  const realPrepare = db.prepare.bind(db);
  (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
    const stmt = realPrepare(sql);
    if (!/FROM v2_ai_calls/.test(sql) || !/COUNT/i.test(sql)) return stmt;
    return { ...stmt, bind: (...args: unknown[]) => { limitChecks.push(args); return stmt.bind(...args); } } as typeof stmt;
  }) as typeof db.prepare;
  try {
    const env = { DB: db, GROQ_API_KEY: "k" } as unknown as Env;
    const muscles = await learnExerciseMuscles(env, "Zqx Tempo Flexor Drill", 5);
    assert.deepEqual(muscles?.primary, ["biceps"]);
  } finally { globalThis.fetch = real; }
  assert.equal(limitChecks.length, 1, "the per-user AI limit ran");
  assert.equal(limitChecks[0][0], 5, "for the user who added the exercise");
});
