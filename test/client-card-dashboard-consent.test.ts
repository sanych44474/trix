// The client card embeds the client's dashboard. Its body data (weight history and forecast,
// measurements, body-fat estimate, sex) reaches the trainer only with the client's "body"
// consent, and the wellbeing check-in behind the readiness score only with "health" consent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { recordDailyCheckin, upsertBodyLog } from "../src/adapters/d1/v2Tracking";
import { buildClientCardPayload } from "../src/webapp/clientCard";
import { redactDashboardForTrainer } from "../src/domain/clientCard";
import { assemblePayload, isoDaysBefore } from "../src/domain/dashboardPayload";
import { localParts } from "../src/domain/localTime";
import type { UserDoc } from "../src/types";

const WELLBEING = ["low_energy", "poor_sleep", "high_stress"];

async function cardFor(share: { body: boolean; health: boolean }) {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Trainer");
  await getOrCreateUser(db, 2, 2, "uk", "Client");
  await updateUser(db, 1, { role: "trainer" } as Parameters<typeof updateUser>[2]);
  await updateUser(db, 2, {
    role: "client",
    trainerId: 1,
    profile: { name: "Client", sex: "male", heightCm: 180, goalWeight: 75, shareWithTrainer: share },
  } as Parameters<typeof updateUser>[2]);
  const today = localParts(undefined).date;
  await upsertBodyLog(db, 2, isoDaysBefore(today, 14), { weight: 82, measurements: { waist: 90, neck: 40 } });
  await upsertBodyLog(db, 2, isoDaysBefore(today, 7), { weight: 81, measurements: { waist: 89, neck: 40 } });
  await upsertBodyLog(db, 2, today, { weight: 80, measurements: { waist: 88, neck: 40 } });
  await recordDailyCheckin(db, 2, today, 1, 1, 5);
  return buildClientCardPayload(db as unknown as D1Database, (await getUser(db, 1)) as UserDoc, (await getUser(db, 2)) as UserDoc);
}

test("card dashboard: without body consent no weight, goal, forecast, measurements, body fat or sex", async () => {
  const { dashboard } = await cardFor({ body: false, health: true });
  assert.deepEqual(dashboard.weight, { points: [] });
  assert.equal(dashboard.measurements, undefined);
  assert.equal(dashboard.bodyFat, undefined);
  assert.equal(dashboard.sex, undefined);
});

test("card dashboard: with body consent the body data is there", async () => {
  const { dashboard } = await cardFor({ body: true, health: false });
  assert.equal(dashboard.weight.points.length, 3);
  assert.equal(dashboard.weight.goal, 75);
  assert.ok(dashboard.weight.projection);
  assert.deepEqual(dashboard.measurements?.map((m) => m.key), ["waist", "neck"]);
  assert.ok(dashboard.bodyFat);
  assert.equal(dashboard.sex, "male");
});

test("card dashboard: without health consent the readiness score ignores the wellbeing check-in", async () => {
  const { dashboard } = await cardFor({ body: true, health: false });
  assert.deepEqual(dashboard.recovery, { score: 100, label: "great", factors: [] });
});

test("card dashboard: with health consent the check-in factors are there", async () => {
  const { dashboard } = await cardFor({ body: false, health: true });
  assert.deepEqual(dashboard.recovery.factors.map((f) => f.code).sort(), [...WELLBEING].sort());
  assert.equal(dashboard.recovery.score, 55);
  assert.equal(dashboard.recovery.label, "fair");
});

test("redactDashboardForTrainer: keeps training-load factors and rescores them without the check-in", () => {
  const dash = assemblePayload(
    { _id: 2, lang: "en", profile: { timezone: "UTC" }, createdAt: new Date(0) } as unknown as UserDoc,
    "2026-07-01",
    { bodyLogs: [], workouts: [], records: [], nutrition: [], plan: null, checkin: null },
  );
  dash.recovery = {
    score: 0,
    label: "poor",
    factors: [{ code: "volume_above", count: 3 }, { code: "cardio_above" }, { code: "low_energy" }, { code: "grinding_rpe" }, { code: "poor_sleep" }, { code: "high_stress" }],
  };
  const out = redactDashboardForTrainer(dash, { shareWithTrainer: { body: true } });
  // 100 - 30 (volume) - 20 (cardio) - 15 (RPE) = 35, order heaviest first.
  assert.deepEqual(out.recovery, { score: 35, label: "poor", factors: [{ code: "volume_above", count: 3 }, { code: "cardio_above" }, { code: "grinding_rpe" }] });
  const kept = redactDashboardForTrainer(dash, { shareWithTrainer: { body: true, health: true } });
  assert.deepEqual(kept.recovery, dash.recovery);
});
