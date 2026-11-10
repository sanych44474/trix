// DO alarms must stay on the hour. setAlarm(now + 1h) drifted later every hour, and hour-exact
// slots (water every N hours from 09:00) are eventually skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextHourlyAlarm } from "../src/domain/alarmTiming";

test("nextHourlyAlarm: the next hour boundary plus a minute, whatever the current offset", () => {
  const hour = 3_600_000;
  const base = Date.UTC(2026, 10, 4, 10, 0, 0);
  assert.equal(nextHourlyAlarm(base + 61_000), base + hour + 60_000, "an alarm that ran a second late");
  assert.equal(nextHourlyAlarm(base + 59 * 60_000), base + hour + 60_000);
  assert.equal(nextHourlyAlarm(base + 30_000), base + 60_000, "before this hour's slot: this hour's slot");
  // Run late every hour for a day: still lands on hh:01.
  let at = base + 60_000;
  for (let i = 0; i < 24; i++) at = nextHourlyAlarm(at + 4_000);
  assert.equal(new Date(at).getUTCMinutes(), 1);
  assert.equal(new Date(at).getUTCSeconds(), 0);
});
