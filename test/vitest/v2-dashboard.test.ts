// Domain 10 (Mini App dashboard aggregator) against REAL D1 (workerd) — src/adapters/d1/
// dashboardReader.ts fans out to seven already-completed domains' own v2-native repo modules
// (v2Workouts/v2Plans/v2Nutrition/v2Tracking/v2Trainer/v2Gamification/v2Users) plus Domain 9's
// v2Admin.ts (dashboardExtrasBatch mixes SELECTs into one db.batch() — the node:sqlite-backed
// node:test harness fakes db.batch() as a sequential no-`results` `.run()` loop and cannot
// exercise that at all, see test/v2-admin.test.ts's own comment on this exact limitation), then
// hands the fetched rows to webapp/dashboard.ts's PURE assemblePayload (already covered,
// data-shape-wise, by test/dashboard-payload.test.ts's hand-built-row unit tests). This file's
// job is the wiring: seed a realistic multi-domain account with real D1 and confirm
// buildDashboardPayload assembles the derived sections (recovery, weekly volume, exercises,
// gamification/badges, today's water/steps, buddy card, trainer portfolio, owner analytics, and
// the today's-plan quick-log form) from those domains' real tables — plus the one write
// buildDashboardPayload itself performs as a side effect (the one-time "perfect_day" badge).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildDashboardPayload } from "../../src/adapters/d1/dashboardReader";
import { getOrCreateUser, getUser, updateUser } from "../../src/adapters/d1/v2Users";
import { setActivePlan } from "../../src/adapters/d1/v2Plans";
import { upsertStrengthRecord, upsertWorkoutLog } from "../../src/adapters/d1/v2Workouts";
import { appendMeals } from "../../src/adapters/d1/v2Nutrition";
import { recordDailyCheckin, setWater, upsertBodyLog, upsertStepLog } from "../../src/adapters/d1/v2Tracking";
import { awardAchievement } from "../../src/adapters/d1/v2Gamification";
import { setOwnerChatId } from "../../src/adapters/d1/v2Admin";
import { localParts } from "../../src/domain/progression";
import { isoDaysBefore, isoWeekdayOf } from "../../src/webapp/dashboard";
import type { PlanDoc, Weekday } from "../../src/types";

const today = localParts("UTC").date;
const todayWeekday: Weekday = isoWeekdayOf(today);
const weekAgo = isoDaysBefore(today, 7);

function makePlan(userId: number): PlanDoc {
  return {
    userId,
    active: true,
    status: "active",
    split: [{ weekday: todayWeekday, muscleGroup: "Push", exercises: [{ name: "Bench Press", sets: "4x8", startWeight: "60 kg", technique: "controlled" }] }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 230 },
    supplements: [],
    methodology: "Linear progression",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: 1,
  };
}

describe("dashboardReader: buildDashboardPayload composes v2-native domains for a solo user", () => {
  it("assembles weight/volume/recovery/exercises/gamification/todayStats/buddy from real multi-domain rows, and awards perfect_day", async () => {
    const userId = 9101;
    const mateId = 9102;
    await getOrCreateUser(env.DB, userId, userId, "en", "Alex");
    await getOrCreateUser(env.DB, mateId, mateId, "en", "Sam");

    await updateUser(env.DB, userId, {
      profile: {
        name: "Alex",
        timezone: "UTC",
        trainingWeekdays: [todayWeekday],
        goalWeight: 75,
        waterGoalMl: 1000, // deterministic threshold for the perfect_day check below
        buddyId: mateId,
      },
      nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 230 },
    });
    // Mate needs at least a name + a completed workout THIS week for the buddy card's count.
    await updateUser(env.DB, mateId, { profile: { name: "Sam", timezone: "UTC" } });
    await upsertWorkoutLog(env.DB, mateId, today, todayWeekday, [
      { name: "Squat", skipped: false, setsDone: [{ reps: 5, weight: 100 }] },
    ], true);

    await setActivePlan(env.DB, makePlan(userId));

    // Two completed workout sessions (today + a week ago) — feeds weeklyVolume/streak/totalWorkouts.
    await upsertWorkoutLog(env.DB, userId, today, todayWeekday, [
      { name: "Bench Press", skipped: false, setsDone: [{ reps: 8, weight: 62.5 }, { reps: 8, weight: 62.5 }, { reps: 8, weight: 62.5 }, { reps: 8, weight: 62.5 }] },
    ], true);
    await upsertWorkoutLog(env.DB, userId, weekAgo, isoWeekdayOf(weekAgo), [
      { name: "Bench Press", skipped: false, setsDone: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 8, weight: 60 }] },
    ], true);

    // Strength history (2 points, reps metric, weight>0) — feeds the exercises/e1RM section.
    await upsertStrengthRecord(env.DB, userId, "Bench Press", { metric: "reps", weight: 60, reps: 8 }, weekAgo);
    await upsertStrengthRecord(env.DB, userId, "Bench Press", { metric: "reps", weight: 62.5, reps: 8 }, today);

    // Two body-log points (weight trend needs >=1, the waist MEASUREMENT trend needs >=2).
    await upsertBodyLog(env.DB, userId, weekAgo, { weight: 82, measurements: { waist: 84 } });
    await upsertBodyLog(env.DB, userId, today, { weight: 80, measurements: { waist: 83 } });

    // Nutrition today: protein target (160) fully met — one of the perfect_day conditions.
    await appendMeals(env.DB, userId, today, [
      { desc: "chicken + rice", kcal: 900, protein: 90, fats: 20, carbs: 100 },
      { desc: "protein shake", kcal: 300, protein: 70, fats: 5, carbs: 20 },
    ]);

    await recordDailyCheckin(env.DB, userId, today, 8, 8, 2);
    await awardAchievement(env.DB, userId, "first_workout");
    await setWater(env.DB, userId, today, 1500); // >= waterGoalMl (1000) -> perfect_day condition met
    await upsertStepLog(env.DB, userId, today, 6000);

    const user = await getUser(env.DB, userId);
    expect(user).not.toBeNull();
    const payload = await buildDashboardPayload(env.DB, user!);

    // ---- weight ----
    expect(payload.weight.points).toEqual(expect.arrayContaining([{ date: weekAgo, kg: 82 }, { date: today, kg: 80 }]));
    expect(payload.weight.goal).toBe(75);

    // ---- measurements (waist, >=2 points) ----
    const waist = payload.measurements?.find((m) => m.key === "waist");
    expect(waist?.points).toEqual([{ date: weekAgo, v: 84 }, { date: today, v: 83 }]);

    // ---- calendar: today is "done" (completed workout logged) ----
    expect(payload.calendar.days).toHaveLength(84);
    expect(payload.calendar.days.find((d) => d.date === today)?.s).toBe("done");
    expect(payload.calendar.split).toEqual([{ weekday: todayWeekday, group: "Push", n: 1 }]);

    // ---- weekly volume: today's 4 sets of Bench Press -> chest group (weekAgo's 3 sets fall
    // outside the trailing-7-day window the same way test/dashboard-payload.test.ts checks) ----
    const chest = payload.volume.find((v) => v.group === "chest");
    expect(chest?.sets).toBe(4);

    // ---- recovery: a real number, computed from the seeded check-in ----
    expect(typeof payload.recovery.score).toBe("number");
    expect(payload.recovery.score).toBeGreaterThan(0);

    // ---- exercises: Bench Press classified as chest, 2 e1RM points ----
    const bench = payload.exercises.find((e) => e.name === "Bench Press");
    expect(bench?.group).toBe("chest");
    expect(bench?.points).toHaveLength(2);

    // ---- macros: today's kcal/protein sums, target passthrough from user.nutrition ----
    const macroToday = payload.macros.days.find((d) => d.date === today);
    expect(macroToday).toEqual({ date: today, kcal: 1200, p: 160, f: 25, c: 120, training: true });
    expect(payload.macros.targets).toEqual({ calories: 2200, protein: 160, fats: 70, carbs: 230 });

    // ---- gamification: totalWorkouts = 2 completed sessions; a real level/xp/streak ----
    expect(payload.gamification?.totalWorkouts).toBe(2);
    expect(typeof payload.gamification?.streak).toBe("number");
    expect(typeof payload.gamification?.level).toBe("number");

    // ---- badges: the achievement seeded via v2Gamification.awardAchievement ----
    expect(payload.badges?.some((b) => b.code === "first_workout")).toBe(true);
    expect(payload.badgeCatalog?.length).toBeGreaterThan(0);

    // ---- today's water/steps: v2_water_logs/v2_step_logs via v2Admin's dashboardExtrasBatch ----
    expect(payload.todayStats?.waterMl).toBe(1500);
    expect(payload.todayStats?.steps).toBe(6000);

    // ---- buddy card: mate's name + this-week completed-workout count ----
    expect(payload.buddy).toEqual({ name: "Sam", workouts: 1 });

    // ---- logForm: today's plan day's exercises (Bench Press), since todayWeekday is planned ----
    expect(payload.logForm?.exercises).toEqual(["Bench Press"]);

    // ---- side effect: perfect_day gets auto-awarded (workout done + water goal met + protein
    // target met) — same one-time-award behavior the legacy buildDashboardPayload had. ----
    const achievements = await env.DB.prepare("SELECT code FROM v2_achievements WHERE accountId = ? ORDER BY code").bind(userId).all<{ code: string }>();
    expect((achievements.results ?? []).map((r) => r.code)).toEqual(["first_workout", "perfect_day"]);
  });

  it("a fresh account with no logged activity gets a well-formed empty-state payload, not a throw", async () => {
    const userId = 9110;
    await getOrCreateUser(env.DB, userId, userId, "en", "NewUser");
    const user = await getUser(env.DB, userId);
    const payload = await buildDashboardPayload(env.DB, user!);
    expect(payload.calendar.days).toHaveLength(84);
    expect(payload.weight.points).toEqual([]);
    expect(payload.exercises).toEqual([]);
    expect(payload.trainer).toBeUndefined();
    expect(payload.owner).toBeUndefined();
  });
});

describe("dashboardReader: trainer portfolio section", () => {
  it("buildTrainerSection reads the client's compliance via v2Trainer/v2Plans/v2Workouts/v2Nutrition", async () => {
    const trainerId = 9201;
    const clientId = 9202;
    await getOrCreateUser(env.DB, trainerId, trainerId, "en", "Coach");
    await getOrCreateUser(env.DB, clientId, clientId, "en", "Client");
    await updateUser(env.DB, trainerId, { role: "trainer" });
    await updateUser(env.DB, clientId, { role: "client", trainerId, profile: { name: "Client", trainingWeekdays: [todayWeekday] } });

    await setActivePlan(env.DB, makePlan(clientId));
    await upsertWorkoutLog(env.DB, clientId, today, todayWeekday, [
      { name: "Bench Press", skipped: false, setsDone: [{ reps: 8, weight: 40 }] },
    ], true);

    const trainer = await getUser(env.DB, trainerId);
    const payload = await buildDashboardPayload(env.DB, trainer!);
    expect(payload.trainer?.clients).toHaveLength(1);
    const row = payload.trainer!.clients[0];
    expect(row.id).toBe(clientId);
    expect(row.name).toBe("Client");
    expect(row.workoutPct).toBeGreaterThan(0);
  });
});

describe("dashboardReader: owner analytics section", () => {
  it("is only attached for the configured owner chatId", async () => {
    const ownerId = 9301;
    const chatId = 93010;
    await getOrCreateUser(env.DB, ownerId, chatId, "en", "Owner");
    await setOwnerChatId(env.DB, chatId);

    const owner = await getUser(env.DB, ownerId);
    const payload = await buildDashboardPayload(env.DB, owner!);
    expect(payload.owner).toBeDefined();
    expect(payload.owner!.funnel.total).toBeGreaterThanOrEqual(1);

    // A non-owner (different chatId) never gets the section.
    const plainId = 9302;
    await getOrCreateUser(env.DB, plainId, plainId + 1000, "en", "Plain");
    const plain = await getUser(env.DB, plainId);
    const plainPayload = await buildDashboardPayload(env.DB, plain!);
    expect(plainPayload.owner).toBeUndefined();
  });
});
