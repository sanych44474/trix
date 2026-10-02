import { test } from "node:test";
import assert from "node:assert/strict";
import { bySeenDesc, seenLabel } from "../apps/mini-app/src/logic/seen";

test("roster last-seen labels and order", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.deepEqual(seenLabel(undefined, now), { key: "seen_never" });
  assert.deepEqual(seenLabel("2026-10-02T01:00:00Z", now), { key: "seen_today" });
  assert.deepEqual(seenLabel("2026-10-01T23:00:00Z", now), { key: "seen_yesterday" });
  assert.deepEqual(seenLabel("2026-09-25T10:00:00Z", now), { key: "seen_days", n: 7 });
  assert.deepEqual(seenLabel("2026-07-01T10:00:00Z", now), { key: "seen_date", date: "2026-07-01" });
  const rows = [{ id: 1 }, { id: 2, lastSeen: "2026-09-01T00:00:00Z" }, { id: 3, lastSeen: "2026-10-01T00:00:00Z" }];
  assert.deepEqual([...rows].sort(bySeenDesc).map((r) => r.id), [3, 2, 1]);
});
