// Roadmap item 5 end-to-end: cmdStart for a returning onboarded user now leads with ONE
// prioritized action instead of a bare "welcome back" + full menu. No prior test covered the
// returning-user /start path at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { cmdStart } from "../src/bot";
import { getOrCreateUser, recordDailyCheckin, setActivePlan, updateUser, upsertWorkoutLog } from "../src/db/repos";
import type { PlanDoc, UserDoc } from "../src/types";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoWeekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
}

function planFor(userId: number, weekday: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: weekday as PlanDoc["split"][number]["weekday"], muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50kg", technique: "" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [], methodology: "", generatedAt: new Date("2026-01-01"), schemaVersion: 1,
  };
}

async function onboardedUser(db: ReturnType<typeof newDb>, id: number): Promise<UserDoc> {
  const u = (await getOrCreateUser(db, id, id, "en", "Ann")) as unknown as UserDoc;
  await updateUser(db, id, { onboarded: true, profile: { ...u.profile, timezone: "UTC" } });
  return (await getOrCreateUser(db, id, id, "en", "Ann")) as unknown as UserDoc;
}

test("cmdStart: a returning solo user with zero completed workouts gets the first-workout nudge, not a bare menu", async () => {
  const db = newDb();
  const today = todayUtc();
  const user = await onboardedUser(db, 1);
  // Plan trains a DIFFERENT weekday than today, so this only passes if first_workout correctly
  // outranks "no session today" rather than falling through to a plain rest-day view.
  const otherWeekday = (isoWeekdayOf(today) % 7) + 1;
  await setActivePlan(db, planFor(1, otherWeekday));
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdStart(ctx as never);

  assert.ok(sent.some((m) => m.text.includes("first workout")), JSON.stringify(sent.map((m) => m.text)));
});

test("cmdStart: a returning user with history, checked in, no session today, no lapse gets the normal rest-day view", async () => {
  const db = newDb();
  const today = todayUtc();
  const user = await onboardedUser(db, 2);
  const otherWeekday = (isoWeekdayOf(today) % 7) + 1;
  await setActivePlan(db, planFor(2, otherWeekday));
  // History old enough to not read as a "lapse" (missedConsecutiveWorkouts only looks at the
  // last 2 PLANNED dates, which are all in the future/past far from this single old log).
  await upsertWorkoutLog(db, 2, "2026-01-05", otherWeekday as never, [{ name: "Bench", setsDone: [{ weight: 50, reps: 8 }], skipped: false }] as never, true, "raw");
  await recordDailyCheckin(db, 2, today, 7, 7, 3);
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdStart(ctx as never);

  // None of the priority nudges fired -- fell through to cmdToday's own rendering.
  assert.equal(sent.some((m) => m.text.includes("first workout")), false);
  assert.equal(sent.some((m) => m.text.includes("Quick check-in")), false);
  assert.equal(sent.some((m) => m.text.includes("missed a couple")), false);
});

test("cmdStart: no check-in yet today (with workout history) surfaces the check-in nudge before the menu", async () => {
  const db = newDb();
  const today = todayUtc();
  const user = await onboardedUser(db, 3);
  const otherWeekday = (isoWeekdayOf(today) % 7) + 1;
  await setActivePlan(db, planFor(3, otherWeekday));
  await upsertWorkoutLog(db, 3, "2026-01-05", otherWeekday as never, [{ name: "Bench", setsDone: [{ weight: 50, reps: 8 }], skipped: false }] as never, true, "raw");
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdStart(ctx as never);

  assert.ok(sent.some((m) => m.text.includes("check-in")), JSON.stringify(sent.map((m) => m.text)));
});
