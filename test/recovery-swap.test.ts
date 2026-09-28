import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverySwap, recoverySwapFor, swapPlanDays } from "../src/domain/recoverySwap";
import { muscleRecovery } from "../src/domain/muscleLoad";
import type { PlanDay, PlanDoc, WorkoutLogDoc } from "../src/types";

const day = (weekday: number, group: string, names: string[]): PlanDay => ({
  weekday: weekday as PlanDay["weekday"], muscleGroup: group,
  exercises: names.map((name) => ({ name, sets: "4 × 8", startWeight: "40 kg", technique: "" })),
});
const split = [
  day(1, "Груди", ["Жим лежачи", "Жим під кутом", "Віджимання на брусах"]),
  day(3, "Спина", ["Підтягування", "Тяга штанги в нахилі", "Жим лежачи"]),
  day(4, "Ноги", ["Присідання", "Румунська тяга", "Жим ногами"]),
];
// Monday 2026-09-28; chest was hammered on Sunday.
const sundayChest = [{ date: "2026-09-27", done: true, ex: [{ n: "Жим лежачи", s: 5 }, { n: "Віджимання", s: 4 }] }];

test("tired chest on a chest day: swap with the nearest later day that doesn't need it", () => {
  const swap = recoverySwap(split, muscleRecovery(sundayChest, "2026-09-28"), 1);
  assert.ok(swap);
  assert.equal(swap!.other, 4, "Wednesday also benches (a third of its sets) -- Thursday's legs are fully fresh");
  assert.deepEqual(swap!.tired, ["chest", "triceps"], "push-ups drove the triceps too");
  assert.deepEqual(swap!.because, ["Жим лежачи", "Віджимання"]);
});

test("no swap when today's muscles are fresh, when only earlier days are free, or on a rest day", () => {
  assert.equal(recoverySwap(split, muscleRecovery([], "2026-09-28"), 1), null);
  const legsYesterday = [{ date: "2026-09-30", done: true, ex: [{ n: "Присідання", s: 5 }] }];
  assert.equal(recoverySwap(split, muscleRecovery(legsYesterday, "2026-10-01"), 4), null, "Thursday is the last day");
  assert.equal(recoverySwap(split, muscleRecovery(sundayChest, "2026-09-28"), 2), null, "no plan day on Tuesday");
});

test("swapPlanDays trades weekdays and keeps the set of days; unknown days are refused", () => {
  const swapped = swapPlanDays(split, 1, 4)!;
  assert.deepEqual(swapped.map((d) => [d.weekday, d.muscleGroup]), [[1, "Ноги"], [3, "Спина"], [4, "Груди"]]);
  assert.equal(swapPlanDays(split, 1, 2), null);
  assert.equal(swapPlanDays(split, 1, 1), null);
});

test("recoverySwapFor: nothing to offer once today already has logged sets", () => {
  const plan = { split } as unknown as PlanDoc;
  const log = (date: string, names: string[]): WorkoutLogDoc => ({ date, completed: true, exercises: names.map((name) => ({ name, setsDone: [{}, {}, {}], skipped: false })) }) as unknown as WorkoutLogDoc;
  const offer = recoverySwapFor(plan, [log("2026-09-27", ["Жим лежачи", "Віджимання"])], "2026-09-28", 1);
  assert.equal(offer?.otherGroup, "Ноги");
  assert.equal(offer?.todayGroup, "Груди");
  assert.equal(recoverySwapFor(plan, [log("2026-09-27", ["Жим лежачи"]), log("2026-09-28", ["Жим лежачи"])], "2026-09-28", 1), null);
});
