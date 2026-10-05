import { test } from "node:test";
import assert from "node:assert/strict";
import { weighInDue } from "../src/domain/weighIn";

const base = { today: "2026-10-05", hour: 8, hasGoalWeight: false };

test("weighInDue: a tracker 3+ days since the last weigh-in, in the morning", () => {
  assert.equal(weighInDue({ ...base, weightDates: ["2026-09-28", "2026-10-02"] }), 3);
  assert.equal(weighInDue({ ...base, weightDates: ["2026-09-28", "2026-10-03"] }), null); // 2 days
  assert.equal(weighInDue({ ...base, hour: 19, weightDates: ["2026-09-28", "2026-10-01"] }), null); // evening
});

test("weighInDue: not for people who don't track weight; not twice within 3 days; not after a long stop", () => {
  assert.equal(weighInDue({ ...base, weightDates: ["2026-09-20"] }), null); // one weigh-in, no goal
  assert.equal(weighInDue({ ...base, hasGoalWeight: true, weightDates: ["2026-09-20"] }), 15);
  assert.equal(weighInDue({ ...base, weightDates: ["2026-09-28", "2026-10-01"], lastSent: "2026-10-03" }), null);
  assert.equal(weighInDue({ ...base, hasGoalWeight: true, weightDates: ["2026-07-01"] }), null); // 96 days
});

test("measure mode takes a bare number as the weight (the weigh-in nudge asks for just that)", async () => {
  const { newDb, makeCtx } = await import("./harness");
  const { getOrCreateUser } = await import("../src/adapters/d1/v2Users");
  const { handleMeasure } = await import("../src/bot");
  const db = newDb();
  const user = await getOrCreateUser(db, 41, 41, "uk", "Ann");
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);
  await handleMeasure(ctx as never, "74,2 кг");
  const row = await db.prepare("SELECT weight FROM v2_measurements WHERE accountId = 41").first<{ weight: number }>();
  assert.equal(row?.weight, 74.2);
});
