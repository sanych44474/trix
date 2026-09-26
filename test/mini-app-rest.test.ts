// First automated coverage of any Mini App code. The client was ~4.5k lines behind nothing but
// a typecheck and a build, which is how a `value`/`name` request mismatch reached production
// (see test/plan-api.test.ts's regression case). This covers the rest-timer and session-quality
// logic in apps/mini-app/src/logic/rest.ts -- the numbers a user reads mid-session, where a
// wrong answer mis-reports quietly instead of crashing.
//
// Runs in the existing node:test pool with no new dependency and no browser: the module is pure
// by construction, taking `now` as a parameter and parsing preferences from a raw string rather
// than touching Date.now() or localStorage. The thin wrappers that do touch them stay in
// TrainView.tsx and are not covered here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampRest,
  density,
  DEFAULT_REST_PREFS,
  DEFAULT_REST_SEC,
  EMPTY_QUALITY,
  fmtRest,
  parseRestPrefs,
  REST_MAX_SEC,
  REST_MIN_SEC,
  REST_ON_TARGET_TOLERANCE_SEC,
  restMetricKey,
  restProgress,
  restRingPct,
  scoreRest,
} from "../apps/mini-app/src/logic/rest";

test("clampRest keeps a rest inside the bounds the API also enforces", () => {
  assert.equal(clampRest(90), 90);
  assert.equal(clampRest(5), REST_MIN_SEC, "below the floor clamps up, it does not reject");
  assert.equal(clampRest(99999), REST_MAX_SEC);
  assert.equal(clampRest(90.4), 90, "rounded, since the server takes whole seconds");
  // 0 and NaN mean "no value", not "zero rest" -- `seconds || DEFAULT` is load-bearing here.
  assert.equal(clampRest(0), DEFAULT_REST_SEC);
  assert.equal(clampRest(Number.NaN), DEFAULT_REST_SEC);
});

test("fmtRest renders M:SS and never a negative or fractional value", () => {
  assert.equal(fmtRest(0), "0:00");
  assert.equal(fmtRest(9), "0:09");
  assert.equal(fmtRest(60), "1:00");
  assert.equal(fmtRest(125), "2:05");
  assert.equal(fmtRest(90.9), "1:30", "truncates rather than rounding up into the next second");
  // The overrun display passes a positive number and prepends its own "+", so a negative here
  // would be a caller bug -- render 0:00 rather than "-1:-30".
  assert.equal(fmtRest(-30), "0:00");
});

test("restMetricKey maps an exercise metric onto the per-metric preference", () => {
  assert.equal(restMetricKey("time"), "time");
  assert.equal(restMetricKey("distance"), "distance");
  assert.equal(restMetricKey("reps"), "reps");
  assert.equal(restMetricKey(undefined), "reps", "an absent metric is a reps exercise");
  assert.equal(restMetricKey("something-new"), "reps", "an unknown metric must not crash the timer");
});

test("parseRestPrefs survives whatever is actually in a viewer's storage", () => {
  assert.deepEqual(parseRestPrefs(null), DEFAULT_REST_PREFS, "first visit");
  assert.deepEqual(parseRestPrefs("not json"), DEFAULT_REST_PREFS);
  assert.deepEqual(parseRestPrefs("null"), DEFAULT_REST_PREFS);
  assert.deepEqual(parseRestPrefs('"a string"'), DEFAULT_REST_PREFS);

  // A value written before `sound`/`auto` existed: the missing flags take their defaults
  // rather than becoming undefined and disabling auto-start.
  const old = parseRestPrefs('{"reps":120,"time":45,"distance":60}');
  assert.equal(old.reps, 120);
  assert.equal(old.auto, true, "auto defaults ON when absent");
  assert.equal(old.sound, false, "sound defaults OFF when absent");

  // Hand-edited or corrupt numbers are clamped, not trusted.
  const silly = parseRestPrefs('{"reps":99999,"time":1,"distance":"abc","sound":true,"auto":false}');
  assert.equal(silly.reps, REST_MAX_SEC);
  assert.equal(silly.time, REST_MIN_SEC);
  assert.equal(silly.distance, DEFAULT_REST_SEC, "a non-number falls back, it does not become NaN");
  assert.equal(silly.sound, true);
  assert.equal(silly.auto, false);
});

test("restProgress counts down, then counts up past zero instead of vanishing", () => {
  const end = 1_000_000;
  assert.deepEqual(restProgress(end, end - 90_000), { left: 90, over: 0, done: false });
  // Ceil while counting down: 0.2s left must still read 1, not 0, or the bar shows 0:00 while
  // the timer is still running.
  assert.deepEqual(restProgress(end, end - 200), { left: 1, over: 0, done: false });
  assert.deepEqual(restProgress(end, end), { left: 0, over: 0, done: true });
  assert.deepEqual(restProgress(end, end + 42_000), { left: 0, over: 42, done: true });
});

test("restRingPct fills from the rest's original length, so +15s reads as over-plan", () => {
  assert.equal(restRingPct(90, 90), 0, "nothing elapsed yet");
  assert.equal(restRingPct(90, 45), 50);
  assert.equal(restRingPct(90, 0), 100);
  // After +15s the remaining time exceeds the original target; the ring pins at 0 rather than
  // going negative, which is what "more than planned" should look like.
  assert.equal(restRingPct(90, 105), 0);
  assert.equal(restRingPct(0, 0), 100, "a zero target cannot divide; treat as complete");
});

test("scoreRest builds an on-target streak and resets it on a miss", () => {
  const target = 90;
  let q = scoreRest(EMPTY_QUALITY, 90, target);
  assert.deepEqual(q, { restCount: 1, restTotalSec: 90, onTargetStreak: 1, bestStreak: 1 });

  // Inside the tolerance either way still counts.
  q = scoreRest(q, target + REST_ON_TARGET_TOLERANCE_SEC, target);
  q = scoreRest(q, target - REST_ON_TARGET_TOLERANCE_SEC, target);
  assert.equal(q.onTargetStreak, 3);
  assert.equal(q.bestStreak, 3);

  // One long rest breaks the streak but must not lose the best, or the summary would understate
  // a session that went well until the last set.
  q = scoreRest(q, target + REST_ON_TARGET_TOLERANCE_SEC + 1, target);
  assert.equal(q.onTargetStreak, 0);
  assert.equal(q.bestStreak, 3);
  assert.equal(q.restCount, 4);
  assert.equal(q.restTotalSec, 90 + 105 + 75 + 106);
});

test("scoreRest counts the REAL rest taken, including overrun", () => {
  // Armed for 60s, actually rested 5 minutes: the total must reflect the 300, otherwise the
  // density figure would flatter a session that was mostly standing around.
  const q = scoreRest(EMPTY_QUALITY, 300, 60);
  assert.equal(q.restTotalSec, 300);
  assert.equal(q.onTargetStreak, 0);
});

test("density reports the share of the session spent working", () => {
  const start = 1_000_000;
  assert.equal(density(null, 0, start), null, "no session started yet");

  // 10 minutes elapsed, 4 of them resting -> 60% working.
  assert.equal(density(start, 240, start + 600_000), 60);
  assert.equal(density(start, 0, start + 600_000), 100, "no rest taken yet reads as all work");

  // Rest measured longer than elapsed (clock skew, or a rest spanning a reload) must clamp to 0
  // rather than render a negative percentage.
  assert.equal(density(start, 9999, start + 60_000), 0);

  // Guard the divide: same instant must not produce NaN or Infinity.
  const sameInstant = density(start, 0, start);
  assert.ok(Number.isFinite(sameInstant as number), `expected a finite value, got ${sameInstant}`);
});

test("fmtDuration switches to h:mm:ss past an hour", async () => {
  const { fmtDuration } = await import("../apps/mini-app/src/logic/rest");
  assert.equal(fmtDuration(164), "2:44");
  assert.equal(fmtDuration(3600), "1:00:00");
  assert.equal(fmtDuration(2 * 3600 + 5 * 60 + 7), "2:05:07");
});
