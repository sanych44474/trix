import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyVolume, projectWeight, VOLUME_LANDMARKS } from "../src/domain/analysis";
import type { WorkoutLogDoc } from "../src/types";

const wlog = (date: string, completed: boolean, exercises: { name: string; sets: number; skipped?: boolean }[]): WorkoutLogDoc => ({
  userId: 1,
  date,
  weekday: 1,
  completed,
  createdAt: new Date(0),
  exercises: exercises.map((e) => ({
    name: e.name,
    skipped: e.skipped ?? false,
    setsDone: Array.from({ length: e.sets }, () => ({ reps: 10, weight: 50 })),
  })),
});

test("weeklyVolume: sums sets per muscle group within the window", () => {
  const logs = [
    wlog("2026-06-20", true, [{ name: "Bench Press", sets: 4 }, { name: "Squat", sets: 5 }]),
    wlog("2026-06-22", true, [{ name: "Bench Press", sets: 3 }]),
    wlog("2026-06-10", true, [{ name: "Bench Press", sets: 9 }]), // before window → ignored
  ];
  const v = weeklyVolume(logs, "2026-06-17");
  const chest = v.find((x) => x.group === "chest")!;
  assert.equal(chest.sets, 7); // 4 + 3, not the older 9
  const legs = v.find((x) => x.group === "legs")!;
  assert.equal(legs.sets, 5);
});

test("weeklyVolume: skips incomplete sessions and skipped/unmapped exercises", () => {
  const logs = [
    wlog("2026-06-20", false, [{ name: "Bench Press", sets: 4 }]), // not completed
    wlog("2026-06-21", true, [{ name: "Bench Press", sets: 4, skipped: true }]), // skipped
    wlog("2026-06-21", true, [{ name: "Some Random Thing", sets: 4 }]), // unmapped
  ];
  const v = weeklyVolume(logs, "2026-06-17");
  assert.equal(v.find((x) => x.group === "chest")!.sets, 0);
});

test("weeklyVolume: classifies zones against landmarks", () => {
  const lm = VOLUME_LANDMARKS.chest; // mev 10 mav 22
  const below = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mev - 1 }])], "2026-06-17");
  assert.equal(below.find((x) => x.group === "chest")!.zone, "below");
  const optimal = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mev }])], "2026-06-17");
  assert.equal(optimal.find((x) => x.group === "chest")!.zone, "optimal");
  const above = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mav + 1 }])], "2026-06-17");
  assert.equal(above.find((x) => x.group === "chest")!.zone, "above");
});

test("projectWeight: estimates ETA on a losing trend toward a lower goal", () => {
  const weights = [
    { date: "2026-06-01", weight: 80 },
    { date: "2026-06-08", weight: 79 },
    { date: "2026-06-15", weight: 78 },
  ]; // -1 kg/week
  const p = projectWeight(weights, 75)!;
  assert.ok(p);
  assert.equal(p.slopePerWeek, -1);
  assert.equal(p.onTrack, true);
  assert.equal(p.reached, false);
  assert.equal(p.etaWeeks, 3); // 78 → 75 at 1/week
});

test("projectWeight: not on track when trend moves away from goal", () => {
  const weights = [
    { date: "2026-06-01", weight: 78 },
    { date: "2026-06-15", weight: 80 },
  ]; // gaining
  const p = projectWeight(weights, 75)!; // wants to lose
  assert.equal(p.onTrack, false);
  assert.equal(p.etaWeeks, undefined);
});

test("projectWeight: reached when already at goal", () => {
  const p = projectWeight([{ date: "2026-06-01", weight: 75 }, { date: "2026-06-15", weight: 75 }], 75)!;
  assert.equal(p.reached, true);
  assert.equal(p.onTrack, true);
});

test("projectWeight: null with insufficient data", () => {
  assert.equal(projectWeight([{ date: "2026-06-01", weight: 80 }], 75), null);
  assert.equal(projectWeight([], 75), null);
});

test("weeklyVolume agrees with the body map (Denis's week: chest flyes on a bench were read as shoulders)", async () => {
  const { weeklyMuscleSets } = await import("../src/domain/muscleLoad");
  const { toLoggedDays } = await import("../src/domain/recoverySwap");
  const logs = [wlog("2026-09-28", true, [
    { name: "Розведення гантелей у сторони лежачи на лаві", sets: 3 },
    { name: "Віджимання широким хватом", sets: 3 },
    { name: "Підйом гантелей перед собою", sets: 3 },
    { name: "Жим гантелей з підлоги", sets: 3 },
  ])];
  const chest = weeklyVolume(logs, "2026-09-27").find((v) => v.group === "chest")!;
  const mapChest = weeklyMuscleSets(toLoggedDays(logs), "2026-09-27").find((m) => m.slug === "chest")!;
  assert.equal(chest.sets, 10.5); // 3 flyes + 3 push-ups + 3 floor press + ½ × 3 front raises
  assert.equal(chest.sets, mapChest.sets);
  assert.equal(chest.zone, "optimal");
});
