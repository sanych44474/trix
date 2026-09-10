import { test } from "node:test";
import assert from "node:assert/strict";
import { recentCoachingReasons } from "../src/domain/coachMemory";

test("recentCoachingReasons: extracts and dedupes reasons across rows, newest first", () => {
  const rows = [
    { changes: JSON.stringify([{ exercise: "Bench", reason: "hit the top of the rep range" }]) },
    { changes: JSON.stringify([{ reason: "held for poor recovery" }]) },
    { changes: JSON.stringify([{ exercise: "Squat", reason: "hit the top of the rep range" }]) }, // dup, skipped
  ];
  assert.deepEqual(recentCoachingReasons(rows), ["hit the top of the rep range", "held for poor recovery"]);
});

test("recentCoachingReasons: caps at the limit", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ changes: JSON.stringify([{ reason: `reason ${i}` }]) }));
  assert.equal(recentCoachingReasons(rows, 3).length, 3);
});

test("recentCoachingReasons: a malformed row is skipped, not thrown on", () => {
  const rows = [{ changes: "not json" }, { changes: JSON.stringify([{ reason: "ok" }]) }];
  assert.deepEqual(recentCoachingReasons(rows), ["ok"]);
});

test("recentCoachingReasons: entries with no reason (or an empty one) contribute nothing", () => {
  const rows = [{ changes: JSON.stringify([{ exercise: "Bench", field: "weight", from: "60", to: "65" }, { reason: "" }]) }];
  assert.deepEqual(recentCoachingReasons(rows), []);
});

test("recentCoachingReasons: no history at all is an empty list, not an error", () => {
  assert.deepEqual(recentCoachingReasons([]), []);
});
