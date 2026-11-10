// The hourly pass walked users in the same order every hour. When a pass is cut short (a Worker
// limit), the same tail of users lost their reminders every hour. The start moves each hour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotateForHour } from "../src/domain/passOrder";

const ids = Array.from({ length: 10 }, (_, i) => ({ _id: i + 1 }));

test("rotateForHour: every user is visited once, in id order from a start that moves each hour", () => {
  const a = rotateForHour(ids, 100);
  const b = rotateForHour(ids, 101);
  assert.deepEqual([...a].map((u) => u._id).sort((x, y) => x - y), ids.map((u) => u._id));
  assert.notEqual(a[0]._id, b[0]._id, "the next hour starts somewhere else");
  // Contiguous in id order after the start, wrapping around.
  const start = a[0]._id;
  assert.deepEqual(a.map((u) => u._id), [...ids.slice(start - 1), ...ids.slice(0, start - 1)].map((u) => u._id));
});

test("rotateForHour: over a day the start lands on many different users", () => {
  const starts = new Set(Array.from({ length: 24 }, (_, h) => rotateForHour(ids, 480_000 + h)[0]._id));
  assert.ok(starts.size >= 8, `only ${starts.size} distinct starts`);
});

test("rotateForHour: input order does not matter and empty is fine", () => {
  const shuffled = [ids[3], ids[0], ids[9], ids[5], ids[1], ids[2], ids[4], ids[6], ids[7], ids[8]];
  assert.deepEqual(rotateForHour(shuffled, 7), rotateForHour(ids, 7));
  assert.deepEqual(rotateForHour([], 7), []);
});
