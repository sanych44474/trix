import { test } from "node:test";
import assert from "node:assert/strict";
import { repDropoffs } from "../apps/mini-app/src/logic/repDropoff";

type Ex = Parameters<typeof repDropoffs>[0][number];
const ex = (name: string, setsDone: Array<{ weight: number; reps: number }>, metric = "reps"): Ex => ({ name, metric, setsDone });

test("a steep drop at one weight is flagged with the reps in order", () => {
  const [hit] = repDropoffs([ex("Жим лежачи", [{ weight: 100, reps: 10 }, { weight: 100, reps: 8 }, { weight: 100, reps: 5 }])]);
  assert.deepEqual(hit, { name: "Жим лежачи", weight: 100, reps: [10, 8, 5] });
});

test("fewer than 3 working sets is never a drop-off", () => {
  assert.deepEqual(repDropoffs([ex("Присідання", [{ weight: 100, reps: 10 }, { weight: 100, reps: 5 }])]), []);
});

test("warm-up sets lighter than the working weight are ignored", () => {
  const [hit] = repDropoffs([ex("Присідання", [{ weight: 60, reps: 12 }, { weight: 100, reps: 10 }, { weight: 100, reps: 8 }, { weight: 100, reps: 5 }])]);
  assert.deepEqual(hit.reps, [10, 8, 5]);
});

test("warm-ups that leave only 2 working sets do not count", () => {
  assert.deepEqual(repDropoffs([ex("Присідання", [{ weight: 60, reps: 10 }, { weight: 100, reps: 8 }, { weight: 100, reps: 5 }])]), []);
});

test("a weight within 2.5 kg of the working weight counts as the same weight", () => {
  const [hit] = repDropoffs([ex("Тяга", [{ weight: 100, reps: 10 }, { weight: 97.5, reps: 8 }, { weight: 100, reps: 5 }])]);
  assert.deepEqual(hit.reps, [10, 8, 5]);
});

test("a set more than 2.5 kg lighter is not part of the same-weight run", () => {
  assert.deepEqual(repDropoffs([ex("Тяга", [{ weight: 100, reps: 10 }, { weight: 100, reps: 8 }, { weight: 95, reps: 5 }])]), []);
});

test("steady reps are not a drop-off", () => {
  assert.deepEqual(repDropoffs([ex("Жим", [{ weight: 80, reps: 10 }, { weight: 80, reps: 10 }, { weight: 80, reps: 9 }])]), []);
});

test("first set above 8 reps: the last set must be <= 60% of the first (boundary 10 -> 6 counts)", () => {
  assert.equal(repDropoffs([ex("Жим", [{ weight: 80, reps: 10 }, { weight: 80, reps: 8 }, { weight: 80, reps: 6 }])]).length, 1);
  assert.deepEqual(repDropoffs([ex("Жим", [{ weight: 80, reps: 10 }, { weight: 80, reps: 8 }, { weight: 80, reps: 7 }])]), []);
});

test("first set of 8 or fewer reps: a drop of 4 or more reps also counts", () => {
  assert.equal(repDropoffs([ex("Жим", [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }, { weight: 60, reps: 4 }])]).length, 1);
  assert.deepEqual(repDropoffs([ex("Жим", [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }, { weight: 60, reps: 5 }])]), []);
});

test("time and distance exercises are ignored", () => {
  const plank = ex("Планка", [{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }, { weight: 0, reps: 0 }], "time");
  const run = ex("Біг", [{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }, { weight: 0, reps: 0 }], "distance");
  assert.deepEqual(repDropoffs([plank, run]), []);
});

test("bodyweight at 0 kg is a valid working weight", () => {
  const [hit] = repDropoffs([ex("Віджимання", [{ weight: 0, reps: 12 }, { weight: 0, reps: 9 }, { weight: 0, reps: 6 }])]);
  assert.deepEqual(hit, { name: "Віджимання", weight: 0, reps: [12, 9, 6] });
});

test("sets with no reps (planned but not done) are not counted", () => {
  const [hit] = repDropoffs([ex("Жим", [{ weight: 100, reps: 10 }, { weight: 100, reps: 8 }, { weight: 100, reps: 0 }, { weight: 100, reps: 5 }])]);
  assert.deepEqual(hit.reps, [10, 8, 5]);
});

test("exercises without any sets are skipped", () => {
  assert.deepEqual(repDropoffs([{ name: "Жим", metric: "reps" }]), []);
});

test("results are sorted worst first (lowest last/first ratio)", () => {
  const hits = repDropoffs([
    ex("Мілкий", [{ weight: 50, reps: 10 }, { weight: 50, reps: 9 }, { weight: 50, reps: 6 }]),
    ex("Глибокий", [{ weight: 80, reps: 10 }, { weight: 80, reps: 6 }, { weight: 80, reps: 3 }]),
  ]);
  assert.deepEqual(hits.map((h) => h.name), ["Глибокий", "Мілкий"]);
});
