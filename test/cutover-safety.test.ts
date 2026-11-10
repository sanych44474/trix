// Two things to settle before any scheduler flag flips (docs/scheduler-do-cutover-runbook.md):
// 1. The cron must FAIL CLOSED. isCutOver turns a flag read error into "not cut over", which is
//    the safe answer for a DO (it stays in dry run) but the dangerous one for the cron: after the
//    user cutover, one D1 blip would make the cron process every user for real while the DOs do too.
// 2. DO alarms must stay on the hour. setAlarm(now + 1h) drifted later every hour, and hour-exact
//    slots (water every N hours from 09:00) are eventually skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { cronOwns, isCutOver } from "../src/durable/cutover";
import { nextHourlyAlarm } from "../src/domain/alarmTiming";
import { setSetting } from "../src/adapters/d1/v2Admin";

test("cronOwns: the cron runs a job only when the flag was read and is off", async () => {
  const db = newDb();
  assert.equal(await cronOwns(db, "user"), true, "no flag yet: the cron owns the work");
  await setSetting(db, "scheduler_cutover_user", "1");
  assert.equal(await cronOwns(db, "user"), false, "cut over: the DO owns it");
  await setSetting(db, "scheduler_cutover_user", "0");
  assert.equal(await cronOwns(db, "user"), true);
});

test("cronOwns: a failed flag read skips the job for this tick (fail closed); the DO side stays safe too", async () => {
  const broken = { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database;
  assert.equal(await cronOwns(broken, "user"), false, "the cron does not act on a flag it could not read");
  assert.equal(await isCutOver(broken, "user"), false, "a DO stays in dry run on the same error");
});

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
