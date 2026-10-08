// The period gate for scheduled jobs. The regression these pin: a job that throws must NOT consume
// its period (weekly AI model check, buddy duels and the daily rollup each lost a whole period to
// one failure), and a job that always throws must stop after MAX_ATTEMPTS instead of retrying on
// every tick forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { MAX_ATTEMPTS, runOncePer } from "../src/schedulerJobs/runOncePer";
import { getSetting, setSetting } from "../src/adapters/d1/v2Admin";

const HOUR = 3_600_000;
const quiet = () => {
  const orig = console.error;
  console.error = () => {};
  return () => { console.error = orig; };
};

test("a rolling-window job runs once, then is skipped inside the window", async () => {
  const db = newDb();
  let runs = 0;
  const opts = { key: "t_roll", period: { windowMs: 20 * HOUR } };
  assert.equal(await runOncePer(db, { ...opts, now: 1_000_000_000_000 }, async () => { runs++; }), "ran");
  assert.equal(await runOncePer(db, { ...opts, now: 1_000_000_000_000 + 19 * HOUR }, async () => { runs++; }), "skipped");
  assert.equal(await runOncePer(db, { ...opts, now: 1_000_000_000_000 + 21 * HOUR }, async () => { runs++; }), "ran");
  assert.equal(runs, 2);
});

test("a failing job does not consume the period and is retried on the next tick", async () => {
  const db = newDb();
  const restore = quiet();
  try {
    let fail = true;
    const opts = { key: "t_retry", period: { periodKey: "2026-W41" } };
    assert.equal(await runOncePer(db, opts, async () => { if (fail) throw new Error("boom"); }), "failed");
    assert.equal(await getSetting(db, "t_retry"), null, "no stamp after a failure");
    fail = false;
    assert.equal(await runOncePer(db, opts, async () => { if (fail) throw new Error("boom"); }), "ran");
    assert.equal(await getSetting(db, "t_retry"), "2026-W41");
  } finally { restore(); }
});

test("a job that always throws is closed after MAX_ATTEMPTS, not retried every tick", async () => {
  const db = newDb();
  const restore = quiet();
  try {
    let runs = 0;
    const opts = { key: "t_giveup", period: { periodKey: "2026-W41" } };
    const results: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      results.push(await runOncePer(db, opts, async () => { runs++; throw new Error("boom"); }));
    }
    assert.deepEqual(results, ["failed", "failed", "gave_up", "skipped", "skipped"]);
    assert.equal(runs, MAX_ATTEMPTS);
    assert.equal(await getSetting(db, "t_giveup"), "2026-W41", "the period is closed so it stops retrying");
  } finally { restore(); }
});

test("a success resets the attempt counter for the next period", async () => {
  const db = newDb();
  const restore = quiet();
  try {
    let fail = true;
    const job = async () => { if (fail) throw new Error("boom"); };
    assert.equal(await runOncePer(db, { key: "t_reset", period: { periodKey: "W1" } }, job), "failed");
    fail = false;
    assert.equal(await runOncePer(db, { key: "t_reset", period: { periodKey: "W1" } }, job), "ran");
    fail = true;
    // New period starts from zero attempts, not from the 1 left over from W1.
    assert.equal(await runOncePer(db, { key: "t_reset", period: { periodKey: "W2" } }, job), "failed");
    assert.equal(await runOncePer(db, { key: "t_reset", period: { periodKey: "W2" } }, job), "failed");
    assert.equal(await runOncePer(db, { key: "t_reset", period: { periodKey: "W2" } }, job), "gave_up");
  } finally { restore(); }
});

test("an existing stamp from before the gate existed is honoured (a deploy re-runs nothing)", async () => {
  const db = newDb();
  const now = Date.parse("2026-10-08T10:00:00Z");
  await setSetting(db, "t_legacy_roll", new Date(now - 3 * HOUR).toISOString());
  await setSetting(db, "t_legacy_week", "2026-W41");
  let runs = 0;
  assert.equal(await runOncePer(db, { key: "t_legacy_roll", period: { windowMs: 20 * HOUR }, now }, async () => { runs++; }), "skipped");
  assert.equal(await runOncePer(db, { key: "t_legacy_week", period: { periodKey: "2026-W41" }, now }, async () => { runs++; }), "skipped");
  assert.equal(runs, 0);
});

test("an unreadable stamp runs the job rather than blocking it forever", async () => {
  const db = newDb();
  await setSetting(db, "t_garbage", "not-a-date");
  let runs = 0;
  assert.equal(await runOncePer(db, { key: "t_garbage", period: { windowMs: HOUR } }, async () => { runs++; }), "ran");
  assert.equal(runs, 1);
});

// THE regression for the weekly AI model check: it used to stamp the week BEFORE running, so a
// failed owner alert (or a throw in the catalog read) meant no check for the next 7 days.
test("weeklyModelCheck: a failed owner alert does not consume the week", async () => {
  const { weeklyModelCheck } = await import("../src/aiModelWatch");
  const { setOwnerChatId } = await import("../src/adapters/d1/v2Admin");
  const db = newDb();
  await setOwnerChatId(db, 42);
  const env = { DB: db, GROQ_API_KEY: "k", GROQ_MODEL: "gone", GROQ_FALLBACK_MODELS: "" } as unknown as import("../src/types").Env;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: [{ id: "other" }] })) as typeof fetch;
  const restore = quiet();
  try {
    let fail = true;
    const sent: string[] = [];
    const send = async (_c: number, text: string) => { if (fail) throw new Error("telegram down"); sent.push(text); };
    await weeklyModelCheck(env, send);
    assert.equal(sent.length, 0);
    assert.equal(await getSetting(db, "last_ai_model_check"), null, "a failed alert must not close the week");
    fail = false;
    await weeklyModelCheck(env, send);
    assert.equal(sent.length, 1, "the next tick delivers the alert");
    assert.match(sent[0]!, /gone/);
    await weeklyModelCheck(env, send);
    assert.equal(sent.length, 1, "and then the week is closed");
  } finally {
    globalThis.fetch = origFetch;
    restore();
  }
});
