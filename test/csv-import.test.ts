import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImportFormat, parseCsvRows, parseWorkoutCsv } from "../src/domain/csvImport";

const STRONG_SAMPLE = [
  "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
  '2026-08-30 18:51:52,"Evening Workout",1h 12m,"Snatch (Barbell)",1,40.0,3,0,0,"","",',
  '2026-08-30 18:51:52,"Evening Workout",1h 12m,"Snatch (Barbell)",2,50.0,2,0,0,,,8.5',
  '2026-08-30 18:51:52,"Evening Workout",1h 12m,"Bench Press (Barbell)",1,80.0,5,0,0,,"Felt strong today",7',
  '2026-09-01 07:15:00,"Morning Workout",45m,"Running",1,0,0,5,1500,,,',
].join("\r\n");

const HEVY_SAMPLE = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  '"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","Felt great","Pull Up (Assisted)","","",1,"warmup",10,10,0,0,',
  '"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","Felt great","Pull Up (Assisted)","","",2,"normal",21,10,0,0,8.5',
  '"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","Felt great","Leg Press (Machine)","","",1,"normal",90,12,0,0,7.5',
].join("\n");

test("parseCsvRows: handles quoted fields with embedded commas and CRLF", () => {
  const rows = parseCsvRows('a,"b, with comma",c\r\n1,2,"3"\r\n');
  assert.deepEqual(rows, [["a", "b, with comma", "c"], ["1", "2", "3"]]);
});

test("detectImportFormat: recognizes Strong and Hevy headers, rejects unknown", () => {
  assert.equal(detectImportFormat(["Date", "Exercise Name", "Set Order"]), "strong");
  assert.equal(detectImportFormat(["exercise_title", "set_index"]), "hevy");
  assert.equal(detectImportFormat(["foo", "bar"]), null);
});

test("parseWorkoutCsv: Strong -- groups sets by date+exercise, strips equipment suffix, keeps RPE/notes", () => {
  const result = parseWorkoutCsv(STRONG_SAMPLE);
  assert.ok(result);
  assert.equal(result!.format, "strong");
  assert.equal(result!.days.length, 2);

  const day1 = result!.days.find((d) => d.date === "2026-08-30")!;
  assert.ok(day1);
  assert.equal(day1.exercises.length, 2);
  const snatch = day1.exercises.find((e) => e.name === "Snatch")!;
  assert.equal(snatch.setsDone.length, 2);
  assert.deepEqual(snatch.setsDone[1], { reps: 2, weight: 50, rpe: 8.5 });
  assert.equal(snatch.rpe, 8.5); // exercise-level rpe = max of its sets
  const bench = day1.exercises.find((e) => e.name === "Bench Press")!;
  assert.equal(bench.setsDone[0].weight, 80);
  assert.equal(day1.notes, "Felt strong today");

  const day2 = result!.days.find((d) => d.date === "2026-09-01")!;
  const run = day2.exercises.find((e) => e.name === "Running")!;
  assert.equal(run.setsDone[0].meters, 5000);
  assert.equal(run.setsDone[0].seconds, 1500);
});

test("parseWorkoutCsv: Strong -- converts lb weight when a Weight Unit column says lb", () => {
  const csv = [
    "Date,Exercise Name,Set Order,Weight,Weight Unit,Reps",
    "2026-09-01 08:00:00,Deadlift (Barbell),1,225,lb,5",
  ].join("\n");
  const result = parseWorkoutCsv(csv);
  const set = result!.days[0].exercises[0].setsDone[0];
  assert.equal(set.weight, Math.round(225 * 0.45359237 * 10) / 10);
});

test("parseWorkoutCsv: Hevy -- parses 'DD Mon YYYY, HH:MM' dates, skips warmup sets, converts distance to meters", () => {
  const result = parseWorkoutCsv(HEVY_SAMPLE);
  assert.ok(result);
  assert.equal(result!.format, "hevy");
  assert.equal(result!.days.length, 1);
  const day = result!.days[0];
  assert.equal(day.date, "2025-12-22");
  const pullup = day.exercises.find((e) => e.name === "Pull Up")!;
  assert.equal(pullup.setsDone.length, 1); // the warmup set was dropped
  assert.deepEqual(pullup.setsDone[0], { reps: 10, weight: 21, rpe: 8.5 });
  assert.equal(day.notes, "Felt great");
});

test("parseWorkoutCsv: unrecognized header returns null", () => {
  assert.equal(parseWorkoutCsv("foo,bar\n1,2\n"), null);
});

test("parseWorkoutCsv: empty input returns null", () => {
  assert.equal(parseWorkoutCsv(""), null);
});
