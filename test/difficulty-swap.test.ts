import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDifficultySwaps } from "../src/domain/difficultySwap";
import type { CatalogExercise, PlanExercise } from "../src/types";

function ex(name: string, exerciseId?: string): PlanExercise {
  return { name, sets: "3 × 10", startWeight: "20 kg", technique: "t", ...(exerciseId ? { exerciseId } : {}) };
}

function cat(id: string, muscle: string, difficulty: string): CatalogExercise {
  return { id, name: id, muscle, difficulty, equipments: [], instructions: `do ${id}`, safetyInfo: "" };
}

const noRandom = () => 0; // deterministic: always picks the first eligible candidate

test("pickDifficultySwaps: 'up' picks a harder same-muscle candidate one tier above", () => {
  const exercises = [ex("Push-up", "pushup")];
  const catalogByExerciseId = new Map([["pushup", cat("pushup", "chest", "beginner")]]);
  const candidatesByMuscle = new Map([["chest", [cat("dip", "chest", "intermediate"), cat("bench", "chest", "advanced")]]]);
  const out = pickDifficultySwaps(exercises, "up", catalogByExerciseId, candidatesByMuscle, [], noRandom);
  assert.equal(out.swappedCount, 1);
  assert.equal(out.exercises[0].exerciseId, "dip"); // nearest tier (intermediate) wins over advanced
  assert.equal(out.exercises[0].name, "dip");
  assert.equal(out.exercises[0].technique, "do dip");
});

test("pickDifficultySwaps: 'up' falls through to a higher tier when the nearest one has no candidates", () => {
  const exercises = [ex("Push-up", "pushup")];
  const catalogByExerciseId = new Map([["pushup", cat("pushup", "chest", "beginner")]]);
  const candidatesByMuscle = new Map([["chest", [cat("bench", "chest", "advanced")]]]); // no intermediate
  const out = pickDifficultySwaps(exercises, "up", catalogByExerciseId, candidatesByMuscle, [], noRandom);
  assert.equal(out.exercises[0].exerciseId, "bench");
});

test("pickDifficultySwaps: 'up' from expert has nowhere to go — kept unchanged", () => {
  const exercises = [ex("Muscle-up", "mu")];
  const catalogByExerciseId = new Map([["mu", cat("mu", "back", "expert")]]);
  const candidatesByMuscle = new Map([["back", [cat("pullup", "back", "beginner")]]]);
  const out = pickDifficultySwaps(exercises, "up", catalogByExerciseId, candidatesByMuscle, [], noRandom);
  assert.equal(out.swappedCount, 0);
  assert.equal(out.exercises[0].exerciseId, "mu");
});

test("pickDifficultySwaps: 'down' from beginner falls back to another beginner-tier pick", () => {
  const exercises = [ex("Squat", "squat")];
  const catalogByExerciseId = new Map([["squat", cat("squat", "legs", "beginner")]]);
  const candidatesByMuscle = new Map([["legs", [cat("lunge", "legs", "beginner")]]]);
  const out = pickDifficultySwaps(exercises, "down", catalogByExerciseId, candidatesByMuscle, [], noRandom);
  assert.equal(out.exercises[0].exerciseId, "lunge");
});

test("pickDifficultySwaps: never picks an id already used elsewhere in the day", () => {
  const exercises = [ex("A", "a"), ex("B", "b")];
  const catalogByExerciseId = new Map([
    ["a", cat("a", "chest", "beginner")],
    ["b", cat("b", "chest", "beginner")],
  ]);
  // Only one intermediate candidate exists — "b" itself is already used (own-day exclusion).
  const candidatesByMuscle = new Map([["chest", [cat("b", "chest", "intermediate")]]]);
  const out = pickDifficultySwaps(exercises, "up", catalogByExerciseId, candidatesByMuscle, ["a", "b"], noRandom);
  assert.equal(out.swappedCount, 0);
});

test("pickDifficultySwaps: a swap made earlier in the same call is excluded from later picks", () => {
  const exercises = [ex("A", "a"), ex("C", "c")];
  const catalogByExerciseId = new Map([
    ["a", cat("a", "chest", "beginner")],
    ["c", cat("c", "chest", "beginner")],
  ]);
  const candidatesByMuscle = new Map([["chest", [cat("only-swap", "chest", "intermediate")]]]);
  const out = pickDifficultySwaps(exercises, "up", catalogByExerciseId, candidatesByMuscle, ["a", "c"], noRandom);
  assert.equal(out.swappedCount, 1); // "a" takes the only candidate; "c" has nothing left
  assert.equal(out.exercises[0].exerciseId, "only-swap");
  assert.equal(out.exercises[1].exerciseId, "c");
});

test("pickDifficultySwaps: exercises with no exerciseId or unknown catalog id are left as-is", () => {
  const exercises = [ex("Custom move"), ex("Unknown", "ghost")];
  const out = pickDifficultySwaps(exercises, "up", new Map(), new Map(), [], noRandom);
  assert.equal(out.swappedCount, 0);
  assert.deepEqual(out.exercises, exercises);
});
