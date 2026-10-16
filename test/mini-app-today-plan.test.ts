import { test } from "node:test";
import assert from "node:assert/strict";
import { todayPlan, type TodayInput } from "../apps/mini-app/src/logic/todayPlan";
import type { LoggerDraft } from "../apps/mini-app/src/logic/logger";

// 2026-10-14 is a Wednesday; the plan trains Mon/Wed/Fri.
const base: TodayInput = {
  today: "2026-10-14",
  planExercises: ["Squat", "Bench press", "Row"],
  plannedWeekdays: [1, 3, 5],
  days: [{ date: "2026-10-12", s: "done" }, { date: "2026-10-13", s: "rest" }],
  logs: [],
  draft: null,
};

const draft = (over: Partial<LoggerDraft>): LoggerDraft => ({
  v: 2, date: "2026-10-14", logDate: null, copiedFrom: null, editedAt: 1,
  exercises: [
    { index: 0, name: "Squat", metric: "reps", sets: 3, setsDone: [{ weight: 60, reps: 8 }, { weight: 60, reps: 0 }] },
    { index: 1, name: "Bench press", metric: "reps", sets: 3, setsDone: [] },
  ],
  ...over,
} as LoggerDraft);

test("start: today's plan, and the week as Monday..Sunday with done / planned / rest", () => {
  const p = todayPlan(base);
  assert.equal(p.state, "start");
  assert.deepEqual(p.exercises, ["Squat", "Bench press", "Row"]);
  assert.deepEqual(p.week.map((d) => d.mark), ["done", "rest", "planned", "rest", "planned", "rest", "rest"]);
  assert.equal(p.week[2].today, true);
  assert.equal(p.weekDone, 1);
  assert.equal(p.weekPlanned, 3);
});

test("continue: a draft for today with a logged set; an untouched or back-filled draft does not count", () => {
  const p = todayPlan({ ...base, draft: draft({}) });
  assert.equal(p.state, "continue");
  assert.equal(p.started, 1);
  assert.equal(p.sets, 1);
  assert.equal(todayPlan({ ...base, draft: draft({ exercises: [] }) }).state, "start");
  assert.equal(todayPlan({ ...base, draft: draft({ logDate: "2026-10-10" }) }).state, "start");
  assert.equal(todayPlan({ ...base, draft: draft({ date: "2026-10-13" }) }).state, "start");
});

test("done: today's saved log wins over a draft and marks today done in the week", () => {
  const p = todayPlan({ ...base, draft: draft({}), logs: [{ date: "2026-10-14", done: true, ex: [{ n: "Squat", s: 3 }, { n: "Row", s: 2 }] }] });
  assert.equal(p.state, "done");
  assert.equal(p.sets, 5);
  assert.equal(p.week[2].mark, "done");
  assert.equal(p.weekDone, 2);
});

test("rest: no exercises today; a past missed day stays missed, today is never 'missed'", () => {
  const p = todayPlan({ ...base, planExercises: [], days: [{ date: "2026-10-12", s: "missed" }, { date: "2026-10-14", s: "missed" }] });
  assert.equal(p.state, "rest");
  assert.equal(p.week[0].mark, "missed");
  assert.equal(p.week[2].mark, "planned");
});
