import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignalState, readSignals } from "../src/domain/trainingSignals";
import type { DailyCheckinDoc, WorkoutLogDoc } from "../src/types";

const TODAY = "2026-10-29";
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

type SetIn = { reps: number; weight: number; rpe?: number };
function log(daysAgo: number, exercises: Record<string, SetIn[]>, extra: Partial<WorkoutLogDoc> = {}): WorkoutLogDoc {
  return {
    userId: 1,
    date: ago(daysAgo),
    weekday: 1,
    exercises: Object.entries(exercises).map(([name, setsDone]) => ({ name, setsDone, skipped: false })),
    completed: true,
    createdAt: new Date(),
    ...extra,
  } as WorkoutLogDoc;
}

const squat = (w: number, r: number, rpe?: number): SetIn[] => [
  { weight: w, reps: r, rpe },
  { weight: w, reps: r, rpe },
];

test("a lift needs at least 3 sessions in the window before it gets a question", () => {
  const two = [log(3, { Squat: squat(100, 5) }), log(10, { Squat: squat(100, 5) })];
  assert.equal(buildSignalState({ logs: two, checkins: [], today: TODAY, calendarDeload: false }).lifts.length, 0);

  const three = [...two, log(17, { Squat: squat(95, 5) })];
  const plan = buildSignalState({ logs: three, checkins: [], today: TODAY, calendarDeload: false });
  assert.deepEqual(plan.lifts, [{ id: "lift_0", name: "Squat" }]);
  const q = plan.questions.lift_0;
  assert.equal(q.type, "choice");
  assert.deepEqual(Object.keys(q.type === "choice" ? q.criteria : {}).sort(), ["progressing", "regressing", "stalled"]);
});

test("sessions older than 42 days, incomplete logs, skipped lifts and bodyweight-only sets are ignored", () => {
  const logs = [
    log(3, { Squat: squat(100, 5) }),
    log(10, { Squat: squat(100, 5) }),
    log(50, { Squat: squat(100, 5) }), // outside the window
    log(20, { Squat: squat(100, 5) }, { completed: false }), // not finished
    log(24, { Pullup: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }] }),
    log(25, { Pullup: [{ weight: 0, reps: 8 }] }),
    log(26, { Pullup: [{ weight: 0, reps: 8 }] }),
  ];
  const plan = buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: false });
  assert.deepEqual(plan.lifts, []); // Squat has 2 usable sessions, Pullup has no weighted sets
});

test("at most 12 lifts are asked, most-trained first", () => {
  const logs: WorkoutLogDoc[] = [];
  for (let i = 0; i < 14; i++) {
    for (let d = 0; d < 3; d++) logs.push(log(1 + d * 4 + (i % 3), { [`Lift ${i}`]: squat(20 + i, 5) }));
  }
  logs.push(log(2, { Extra: squat(50, 5) }), log(5, { Extra: squat(50, 5) }), log(9, { Extra: squat(50, 5) }), log(12, { Extra: squat(50, 5) }));
  const plan = buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: false });
  assert.equal(plan.lifts.length, 12);
  assert.equal(plan.lifts[0].name, "Extra");
  assert.deepEqual(plan.lifts.map((l) => l.id), plan.lifts.map((_, i) => `lift_${i}`));
});

test("the state carries each session's date, top weight, reps at that weight and RPE, oldest first", () => {
  const logs = [
    log(3, { Squat: [{ weight: 100, reps: 5, rpe: 8 }, { weight: 100, reps: 4 }, { weight: 90, reps: 8 }] }),
    log(10, { Squat: squat(100, 5, 7) }),
    log(17, { Squat: squat(97.5, 6) }),
  ];
  const plan = buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: false });
  const state = plan.state as { lifts: Array<{ id: string; sessions: Array<{ date: string; top: number; reps: number; rpe?: number }> }> };
  const sessions = state.lifts[0].sessions;
  assert.deepEqual(sessions.map((s) => s.date), [ago(17), ago(10), ago(3)]);
  assert.deepEqual(sessions[2], { date: ago(3), top: 100, reps: 9, rpe: 8 });
});

test("the deload question needs 3 completed sessions in 21 days and no calendar deload", () => {
  const logs = [log(2, { Squat: squat(100, 5) }), log(9, { Squat: squat(100, 5) }), log(16, { Squat: squat(100, 5) })];
  const on = buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: false });
  assert.equal(on.questions.deload?.type, "noul");
  assert.equal(on.hasDeloadQuestion, true);

  assert.equal(buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: true }).hasDeloadQuestion, false);
  assert.equal(buildSignalState({ logs: logs.slice(0, 2), checkins: [], today: TODAY, calendarDeload: false }).hasDeloadQuestion, false);
});

test("the deload state summarises weekly volume, RPE, rep drop-off and recent check-ins", () => {
  const logs = [
    log(1, { Squat: [{ weight: 100, reps: 8, rpe: 9 }, { weight: 100, reps: 5, rpe: 9 }] }),
    log(8, { Squat: [{ weight: 100, reps: 8, rpe: 8 }, { weight: 100, reps: 8, rpe: 8 }] }),
  ];
  const checkins: DailyCheckinDoc[] = [
    { userId: 1, date: ago(1), energy: 2, sleep: 2, stress: 4, createdAt: new Date() },
  ];
  const plan = buildSignalState({ logs, checkins, today: TODAY, calendarDeload: false });
  const deload = (plan.state as { deload: { weeks: Array<{ sessions: number; sets: number; volume: number; avgRpe: number | null; repDrop: number | null }>; checkins: { n: number; energy: number; sleep: number; stress: number } } }).deload;
  assert.equal(deload.weeks[0].sessions, 1);
  assert.equal(deload.weeks[0].sets, 2);
  assert.equal(deload.weeks[0].volume, 1300);
  assert.equal(deload.weeks[0].avgRpe, 9);
  assert.ok(deload.weeks[0].repDrop !== null && Math.abs(deload.weeks[0].repDrop - 3 / 8) < 1e-9);
  assert.deepEqual(deload.checkins, { n: 1, energy: 2, sleep: 2, stress: 4 });
});

test("readSignals keeps choice answers at confidence 0.6 or more and drops the rest", () => {
  const plan = buildSignalState({
    logs: [log(3, { Squat: squat(100, 5) }), log(10, { Squat: squat(100, 5) }), log(17, { Squat: squat(100, 5) }),
      log(4, { Bench: squat(80, 5) }), log(11, { Bench: squat(80, 5) }), log(18, { Bench: squat(80, 5) })],
    checkins: [],
    today: TODAY,
    calendarDeload: false,
  });
  const out = readSignals({
    lift_0: { type: "choice", choice: "stalled", probabilities: {}, confidence: 0.61 },
    lift_1: { type: "choice", choice: "regressing", probabilities: {}, confidence: 0.59 },
  } as never, plan);
  assert.deepEqual(out.exercises, [{ name: "Squat", status: "stalled", confidence: 0.61 }]);
});

test("readSignals ignores a choice outside the criteria", () => {
  const plan = buildSignalState({
    logs: [log(3, { Squat: squat(100, 5) }), log(10, { Squat: squat(100, 5) }), log(17, { Squat: squat(100, 5) })],
    checkins: [], today: TODAY, calendarDeload: false,
  });
  const out = readSignals({ lift_0: { type: "choice", choice: "exploding", probabilities: {}, confidence: 0.99 } } as never, plan);
  assert.deepEqual(out.exercises, []);
});

test("readSignals suggests a lighter week only at probability 0.7 or more", () => {
  const logs = [log(2, { Squat: squat(100, 5) }), log(9, { Squat: squat(100, 5) }), log(16, { Squat: squat(100, 5) })];
  const plan = buildSignalState({ logs, checkins: [], today: TODAY, calendarDeload: false });
  assert.deepEqual(readSignals({ deload: { type: "noul", noul: 0.69 } } as never, plan).deload, { probability: 0.69, suggested: false });
  assert.deepEqual(readSignals({ deload: { type: "noul", noul: 0.7 } } as never, plan).deload, { probability: 0.7, suggested: true });
});

test("readSignals with no answers returns no exercises and no deload", () => {
  const plan = buildSignalState({ logs: [], checkins: [], today: TODAY, calendarDeload: false });
  assert.deepEqual(readSignals(null, plan), { exercises: [], deload: null });
});
