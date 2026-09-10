import { test } from "node:test";
import assert from "node:assert/strict";
import { squadMedal, squadWeek, type SquadMember } from "../src/domain/squad";

const members: SquadMember[] = [
  { userId: 1, name: "Ana" },
  { userId: 2, name: "Bo" },
  { userId: 3, name: "Cy" },
];

test("squadWeek: counts this week's sessions, best first", () => {
  const dates = [
    { userId: 1, date: "2026-06-02" },
    { userId: 1, date: "2026-06-04" },
    { userId: 2, date: "2026-06-03" },
    { userId: 2, date: "2026-05-28" }, // before the week → ignored
  ];
  const w = squadWeek(members, dates, "2026-06-01");
  assert.deepEqual(w.entries.map((e) => [e.userId, e.workouts]), [[1, 2], [2, 1], [3, 0]]);
  assert.equal(w.total, 3);
});

test("squadWeek: members on zero stay on the board — that is the point", () => {
  const w = squadWeek(members, [], "2026-06-01");
  assert.equal(w.entries.length, 3);
  assert.equal(w.silent, 3);
  assert.equal(w.total, 0);
});

test("squadWeek: non-members and duplicate days are ignored", () => {
  const dates = [
    { userId: 99, date: "2026-06-02" }, // not in the squad
    { userId: 1, date: "2026-06-02" },
    { userId: 1, date: "2026-06-02" }, // same day logged twice
  ];
  const w = squadWeek(members, dates, "2026-06-01");
  assert.equal(w.total, 1);
});

test("squadWeek: ties break on name, so the order is stable between posts", () => {
  const dates = [
    { userId: 3, date: "2026-06-02" },
    { userId: 1, date: "2026-06-02" },
  ];
  const w = squadWeek(members, dates, "2026-06-01");
  assert.deepEqual(w.entries.map((e) => e.name), ["Ana", "Cy", "Bo"]);
});

test("squadMedal: a tie shares the medal, zero never gets one", () => {
  const w = squadWeek(members, [
    { userId: 1, date: "2026-06-02" },
    { userId: 2, date: "2026-06-02" },
  ], "2026-06-01");
  assert.equal(squadMedal(w.entries, 0), "🥇");
  assert.equal(squadMedal(w.entries, 1), "🥇"); // same count → same place
  assert.equal(squadMedal(w.entries, 2), "·"); // zero sessions
});
