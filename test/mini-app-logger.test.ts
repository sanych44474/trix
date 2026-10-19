// The "save → leave → come back" flows of the Mini App workout logger
// (apps/mini-app/src/logic/logger.ts). This is where a real session went wrong: saved three
// times, left the app, came back to the plan's original exercises, empty, and re-logged
// everything. Each test below is one of those round-trips, with times passed in explicitly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSaveEntries, chooseStart, prefillFromLast, isDraftSaved, parseDraft, sessionElapsedSec, swapExercise,
  type LoggerDraft, type LoggerExercise,
} from "../apps/mini-app/src/logic/logger";
import { EMPTY_QUALITY } from "../apps/mini-app/src/logic/rest";
import type { WorkoutToday } from "../apps/mini-app/src/types";

const DAY = "2026-09-25";
const T0 = Date.parse("2026-09-25T17:00:00Z");
const MIN = 60_000;

const plan = (): LoggerExercise[] => ["Preacher Curl", "Alternating Curl", "Triceps Pushdown"].map((name, index) => ({ index, name, metric: "reps", sets: 3, reps: 10, restSec: 90 }));
const today = (extra: Partial<WorkoutToday> = {}): WorkoutToday => ({ date: DAY, weekday: 5, exercises: plan(), ...extra });
const done = (exercise: LoggerExercise): LoggerExercise => ({ ...exercise, setsDone: [{ weight: 12, reps: 10 }] });
const draft = (exercises: LoggerExercise[], extra: Partial<LoggerDraft> = {}): LoggerDraft => ({ v: 2, date: DAY, exercises, logDate: null, copiedFrom: null, editedAt: T0, ...extra });

test("swap remembers the plan exercise, and swapping back forgets it", () => {
  const swapped = swapExercise(plan(), 0, "Hammer Curl");
  assert.equal(swapped[0].name, "Hammer Curl");
  assert.equal(swapped[0].planName, "Preacher Curl");
  const twice = swapExercise(swapped, 0, "Cable Curl");
  assert.equal(twice[0].planName, "Preacher Curl", "a second swap still points at the plan slot");
  const back = swapExercise(twice, 0, "Preacher Curl");
  assert.equal(back[0].planName, undefined);
});

test("a swap drops the old exercise's technique, video and catalog name", () => {
  const withInfo = plan().map((e, i) => (i === 0 ? { ...e, technique: "Elbows on the pad", videoUrl: "https://x/v", videoTitle: "Preacher", canonicalName: "Preacher Curl Machine" } : e));
  const swapped = swapExercise(withInfo, 0, "Hammer Curl")[0];
  assert.equal(swapped.technique, undefined);
  assert.equal(swapped.videoUrl, undefined);
  assert.equal(swapped.videoTitle, undefined);
  assert.equal(swapped.canonicalName, undefined);
  assert.equal(swapped.restSec, 90, "plan timing still applies");
});

test("save entries carry the swap origin and skip untouched exercises", () => {
  const exercises = swapExercise(plan(), 0, "Hammer Curl").map((e, i) => i === 0 ? done(e) : e);
  assert.deepEqual(buildSaveEntries(exercises), [{ name: "Hammer Curl", sets: [{ weight: 12, reps: 10 }], planName: "Preacher Curl" }]);
});

test("fresh day: plan", () => {
  const start = chooseStart(today(), null);
  assert.equal(start.source, "plan");
  assert.equal(start.saved, false);
  assert.equal(start.drafted, false);
});

test("saved, left, came back on the same phone: the exact list, marked saved", () => {
  const exercises = swapExercise(plan(), 0, "Hammer Curl").map(done);
  const local = draft(exercises, { editedAt: T0, savedAt: T0 + 1000, clock: { startedAt: T0 - 90 * MIN, quality: EMPTY_QUALITY, endedAt: T0 } });
  const server = today({ saved: [{ name: "Hammer Curl", planName: "Preacher Curl", rpe: 0, sets: [{ w: 12, r: 10, sec: 0, m: 0 }] }], savedAt: new Date(T0 + 1500).toISOString() });
  const start = chooseStart(server, local);
  assert.equal(start.source, "local");
  assert.equal(start.saved, true);
  assert.deepEqual(start.exercises.map((e) => e.name), ["Hammer Curl", "Alternating Curl", "Triceps Pushdown"]);
  assert.equal(sessionElapsedSec(start.clock, T0 + 10 * MIN), 90 * 60, "a finished clock doesn't keep running");
});

test("saved, then came back on a phone with no local copy: swap restored in its slot from the log", () => {
  const server = today({
    saved: [
      { name: "Hammer Curl", planName: "Preacher Curl", rpe: 0, sets: [{ w: 12, r: 10, sec: 0, m: 0 }] },
      { name: "Alternating Curl", rpe: 0, sets: [{ w: 10, r: 12, sec: 0, m: 0 }] },
    ],
    savedAt: new Date(T0).toISOString(),
  });
  const start = chooseStart(server, null);
  assert.equal(start.source, "saved");
  assert.equal(start.saved, true);
  assert.deepEqual(start.exercises.map((e) => e.name), ["Hammer Curl", "Alternating Curl", "Triceps Pushdown"], "Preacher Curl is not brought back");
  assert.equal(start.exercises[0].planName, "Preacher Curl");
  assert.equal(start.exercises[0].restSec, 90, "the swap keeps its slot's planned rest");
});

test("unsaved work from another device wins over an older local copy", () => {
  const local = draft([done(plan()[0])], { editedAt: T0 });
  const remote = draft([done(plan()[0]), done(plan()[1])], { editedAt: T0 + 5 * MIN });
  const start = chooseStart(today({ draft: { body: JSON.stringify(remote), updatedAt: new Date(T0 + 5 * MIN).toISOString() } }), local);
  assert.equal(start.source, "server-draft");
  assert.equal(start.drafted, true);
  assert.equal(start.exercises.filter((e) => e.setsDone?.length).length, 2);
});

test("a newer local copy wins over the server's draft", () => {
  const local = draft([done(plan()[0]), done(plan()[1])], { editedAt: T0 + 5 * MIN });
  const remote = draft([done(plan()[0])], { editedAt: T0 });
  const start = chooseStart(today({ draft: { body: JSON.stringify(remote), updatedAt: new Date(T0).toISOString() } }), local);
  assert.equal(start.source, "local");
});

test("the day was re-saved elsewhere after this phone's copy: the log wins", () => {
  const local = draft([done(plan()[0])], { editedAt: T0, savedAt: T0 });
  const server = today({ saved: [{ name: "Triceps Pushdown", rpe: 0, sets: [{ w: 30, r: 12, sec: 0, m: 0 }] }], savedAt: new Date(T0 + 30 * MIN).toISOString() });
  const start = chooseStart(server, local);
  assert.equal(start.source, "saved");
  assert.equal(start.exercises[0].name, "Triceps Pushdown");
});

test("our own save isn't mistaken for a newer one from elsewhere (clock skew)", () => {
  const local = draft([done(plan()[0])], { editedAt: T0, savedAt: T0 });
  const server = today({ saved: [{ name: "Preacher Curl", rpe: 0, sets: [{ w: 12, r: 10, sec: 0, m: 0 }] }], savedAt: new Date(T0 + 40_000).toISOString() });
  assert.equal(chooseStart(server, local).source, "local");
});

test("yesterday's draft is ignored", () => {
  const stale = draft([done(plan()[0])], { date: "2026-09-24" });
  assert.equal(chooseStart(today(), stale).source, "plan");
});

test("a draft stored by the previous app version still restores", () => {
  const legacy = JSON.stringify({ date: DAY, weekday: 5, exercises: [done(plan()[0])], logDate: null, copiedFrom: null, savedAt: T0 });
  const parsed = parseDraft(legacy);
  assert.ok(parsed);
  assert.equal(parsed.editedAt, T0);
  assert.equal(isDraftSaved(parsed), true);
  assert.equal(parseDraft("{not json"), null);
  assert.equal(parseDraft(JSON.stringify({ date: DAY })), null);
});

test("session clock: running, finished, and stale", () => {
  const clock = { startedAt: T0, quality: EMPTY_QUALITY };
  assert.equal(sessionElapsedSec(clock, T0 + 42 * MIN), 42 * 60);
  assert.equal(sessionElapsedSec({ ...clock, endedAt: T0 + 60 * MIN }, T0 + 300 * MIN), 60 * 60);
  assert.equal(sessionElapsedSec(clock, T0 + 6 * 60 * MIN), 0, "a clock left over from the morning is not a session length");
  assert.equal(sessionElapsedSec(undefined, T0), 0);
});

test("removeLoggerSet: a planned set can be dropped for this session, an added one keeps the plan count", async () => {
  const { removeLoggerSet } = await import("../apps/mini-app/src/logic/logger");
  const base = { index: 0, name: "Curl", metric: "reps" as const, sets: 5, setsDone: [{ weight: 30, reps: 24 }, { weight: 30, reps: 24 }, { weight: 30, reps: 20 }, { weight: 30, reps: 20 }] };
  // The unlogged 5th planned set goes: 4 planned now, the logged ones untouched.
  const fewer = removeLoggerSet(base, 4);
  assert.equal(fewer.sets, 4);
  assert.equal(fewer.setsDone?.length, 4);
  // An added 6th set: the plan count stays.
  const added = { ...base, setsDone: [...base.setsDone, { weight: 30, reps: 20 }, { weight: 0, reps: 0 }] };
  const back = removeLoggerSet(added, 5);
  assert.equal(back.sets, 5);
  assert.equal(back.setsDone?.length, 5);
  // The last remaining set is never removed.
  const one = { ...base, sets: 1, setsDone: [] };
  assert.equal(removeLoggerSet(one, 0), one);
});

test("a swap drops the old exercise's target, weight and history, and re-derives the metric", () => {
  const bench: LoggerExercise = { index: 0, name: "Bench Press", metric: "reps", sets: 3, reps: 6, weightKg: 82.5, planWeight: "82.5 kg", last: [{ w: 80, r: 8, sec: 0, m: 0 }], target: { w: 82.5, r: 6, lastW: 80, lastR: 8, step: "load" } };
  const pushups = swapExercise([bench], 0, "Віджимання")[0];
  assert.equal(pushups.weightKg, undefined, "no bench-press weight on push-ups");
  assert.equal(pushups.target, undefined);
  assert.equal(pushups.last, undefined);
  assert.equal(pushups.planWeight, undefined);
  assert.equal(pushups.metric, "reps");
  assert.equal(swapExercise([bench], 0, "Планка")[0].metric, "time");
});

test("chooseStart: a plan changed by the trainer replaces an untouched draft of the old plan", () => {
  const oldPlan = ["Deep Squat", "Bench Press", "Pull-up"].map((name, index) => ({ index, name, metric: "reps" as const, sets: 3, reps: 10, restSec: 90 }));
  const opened = draft(oldPlan, { editedAt: 0 }); // the logger mirrored itself on open, nothing logged
  const start = chooseStart(today(), opened);
  assert.equal(start.source, "plan");
  assert.deepEqual(start.exercises.map((e) => e.name), plan().map((e) => e.name));
  const fromServer = chooseStart(today({ draft: { body: JSON.stringify(opened) } as WorkoutToday["draft"] }), null);
  assert.equal(fromServer.source, "plan", "the server copy of such a draft yields too");
});

test("chooseStart: logged sets, a swap or an added exercise keep the draft", () => {
  const logged = [done(plan()[0]!), ...["Deep Squat"].map((name, index) => ({ index: index + 1, name, metric: "reps" as const, sets: 3, reps: 10, restSec: 90 }))];
  assert.equal(chooseStart(today(), draft(logged)).source, "local", "work in progress is never dropped");
  const swapped = plan().map((e, i) => (i === 1 ? { ...e, name: "Hammer Curl", planName: e.name } : e));
  assert.equal(chooseStart(today(), draft(swapped)).source, "local");
  const added = [...plan(), { index: 3, name: "Face Pull", metric: "reps" as const, sets: 3, reps: 15, restSec: 60 }];
  assert.equal(chooseStart(today(), draft(added)).source, "local");
});

test("prefillFromLast: last session's numbers become suggestions, nothing is marked done", () => {
  const ex: LoggerExercise = { ...done(plan()[0]!), sets: 3, last: [{ w: 15, r: 60 }, { w: 15, r: 40 }, { w: 15, r: 30 }, { w: 17.5, r: 13 }, { w: 17.5, r: 13 }] as never };
  const next = prefillFromLast(ex);
  assert.deepEqual(next.setsDone, ex.setsDone, "the set already logged stays exactly as it was");
  assert.equal(next.prefill?.length, 5);
  assert.deepEqual(next.prefill?.[3], { weight: 17.5, reps: 13 });
  assert.equal(next.sets, 5, "the rows grow to the last session's count");
  assert.deepEqual(buildSaveEntries([{ ...plan()[1]!, ...prefillFromLast({ ...plan()[1]!, last: [{ w: 10, r: 10 }] as never }) }]), [], "a prefilled but unchecked exercise saves nothing");
});
