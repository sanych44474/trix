// Per-iteration isolation in the scheduler's user/client loops. A bad item (a D1 read that throws,
// a client whose data is broken) used to abort the whole loop, so every later client or swap was
// silently dropped. Each test makes the FIRST iteration throw and checks the next one still runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { applySwaps } from "../src/schedulerJobs/plateauSwaps";
import { weeklyReport } from "../src/schedulerJobs/weeklyReport";
import type { Env, PlanDoc, UserDoc } from "../src/types";

type Db = ReturnType<typeof newDb>;

/** Makes the first prepare() of a statement starting with `prefix` throw; later calls run normally.
 *  Returns how many times that statement was prepared, so the test can see the next iteration ran. */
function failFirstPrepare(db: Db, prefix: string): () => number {
  const real = db.prepare.bind(db) as (sql: string) => unknown;
  let seen = 0;
  (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    if (sql.startsWith(prefix)) {
      seen++;
      if (seen === 1) throw new Error("simulated D1 failure on the first iteration");
    }
    return real(sql);
  };
  return () => seen;
}

test("applySwaps: a failing first swap does not drop the swaps for the names after it", async () => {
  const db = newDb();
  const lookups = failFirstPrepare(db, "SELECT * FROM v2_exercises WHERE id = ?");
  const plan = {
    split: [{ weekday: 1, exercises: [{ name: "Bench", exerciseId: "ex-bench" }, { name: "Row", exerciseId: "ex-row" }] }],
  } as unknown as PlanDoc;

  const lines = await applySwaps(db, "en", plan, [
    { name: "Bench", harder: false },
    { name: "Row", harder: false },
  ]);

  assert.deepEqual(lines, [], "no catalog rows in this fake DB, so no swap text; the point is the loop finished");
  assert.equal(lookups(), 2, "the second name's catalog lookup still ran after the first one threw");
});

test("trainer digest: one client whose workout read throws is skipped, the other client is still in the digest", async () => {
  const db = newDb();
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;
  await getOrCreateUser(db, 800, 800, "en", "Coach");
  await updateUser(db, 800, { role: "trainer" });
  await getOrCreateUser(db, 801, 801, "en", "Client A");
  await getOrCreateUser(db, 802, 802, "en", "Client B");
  for (const id of [801, 802]) {
    await linkClient(db, id, 800);
    await updateUser(db, id, { role: "client", trainerId: 800 });
  }
  // The digest's first per-client read fails; the second must still produce its line.
  failFirstPrepare(db, "SELECT * FROM v2_workout_sessions WHERE accountId = ? AND date >= ?");

  const sent: string[] = [];
  await weeklyReport({
    env,
    user: (await getUser(db, 800)) as UserDoc,
    pass: { planByUser: new Map(), boardsByDay: new Map() },
    db,
    lang: "en",
    tz: "UTC",
    date: "2026-10-12",
    markSent() {},
    send: async (text: string) => { sent.push(text); },
  } as unknown as Parameters<typeof weeklyReport>[0]);

  assert.equal(sent.length, 1, "the digest is still sent");
  assert.match(sent[0]!, /Client B/, "the surviving client's line is in the digest");
  assert.doesNotMatch(sent[0]!, /Client A/, "the client whose read threw is left out, not the whole digest");
});
