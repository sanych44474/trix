// "What changed in my plan and why" (cmdPlanChanges) — the bi-weekly adaptive check-in always
// recorded its micro-adjustments (reason field included) via recordAdjustment(), but
// recentAdjustments() had zero callers, so none of it ever reached the user. Real in-memory D1
// + fake ctx, same pattern as prospect-invite.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { cmdPlanChanges } from "../src/bot";
import { getOrCreateUser, recordAdjustment } from "../src/db/repos";
import type { UserDoc } from "../src/types";

async function ctxFor(db: ReturnType<typeof newDb>, id = 1) {
  const u = (await getOrCreateUser(db, id, id, "en", "Ann")) as unknown as UserDoc;
  return makeCtx(db, u as unknown as Record<string, unknown>);
}

test("cmdPlanChanges: no history yet → explains what will show up here later", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db);

  await cmdPlanChanges(ctx as never);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No plan adjustments yet/);
});

test("cmdPlanChanges: renders each adjustment with its reason, newest first", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db);
  await recordAdjustment(db, 1, 2, JSON.stringify([
    { weekday: 1, index: 0, startWeight: "60 kg", reason: "last two sessions felt easy" },
  ]));
  await recordAdjustment(db, 1, 4, JSON.stringify([
    { weekday: 3, index: 1, sets: "3x8", reason: "knee niggle — dropped a set" },
  ]));

  await cmdPlanChanges(ctx as never);

  const text = sent[0].text;
  assert.match(text, /Plan changes/);
  assert.match(text, /60 kg/);
  assert.match(text, /last two sessions felt easy/);
  assert.match(text, /3x8/);
  assert.match(text, /knee niggle/);
  assert.match(text, /week 2/);
  assert.match(text, /week 4/);
  // recentAdjustments orders by ts DESC — the later-recorded week 4 entry comes first.
  assert.ok(text.indexOf("week 4") < text.indexOf("week 2"), "newest adjustment should render first");
});

test("cmdPlanChanges: a malformed stored row is skipped, not fatal", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db);
  await recordAdjustment(db, 1, 1, "not-json-at-all");
  await recordAdjustment(db, 1, 2, JSON.stringify([{ weekday: 1, index: 0, sets: "4x6", reason: "progressing well" }]));

  await cmdPlanChanges(ctx as never);

  assert.match(sent[0].text, /4x6/);
  assert.match(sent[0].text, /progressing well/);
});

test("cmdPlanChanges: rows that parse but carry no adjustments read as no history", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db);
  await recordAdjustment(db, 1, 1, JSON.stringify([])); // check-in ran, nothing needed changing

  await cmdPlanChanges(ctx as never);

  assert.match(sent[0].text, /No plan adjustments yet/);
});
