// src/domain/progression.ts, the edges the typical-value tests did not reach (found by mutation):
// the unit maths of timed and distance prescriptions, how a name is matched to a catalog entry, how many
// sessions make a plateau and what counts as grinding, and the size of a timed step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanProgression, evaluateProgressionRate, loadJump, loadStep, planMetricMid, planNextTargets, reconcileGrounding, workingSets } from "../src/domain/progression";
import type { PlanDoc, PlanExercise, WorkoutLogDoc } from "../src/types";

const planOf = (ex: Partial<PlanExercise> & { name: string; sets: string }): PlanDoc =>
  ({
    userId: 1, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "x", exercises: [{ startWeight: "60 kg", technique: "", muscles: "x", role: "primary", ...ex }] }],
    nutrition: { calories: 0, protein: 0, fats: 0, carbs: 0 }, supplements: [], methodology: "", generatedAt: new Date(),
  }) as unknown as PlanDoc;

const logOf = (date: string, name: string, set: { reps?: number; weight?: number; seconds?: number; meters?: number }, rpe?: number): WorkoutLogDoc => ({
  userId: 1, date, weekday: 1, completed: true, createdAt: new Date(0),
  exercises: [{ name, setsDone: [{ reps: 0, weight: 0, ...set }], skipped: false, ...(rpe !== undefined ? { rpe } : {}) }],
});

test("planMetricMid: the middle of a time or distance prescription, in seconds or metres", () => {
  assert.equal(planMetricMid("3 × 1 min", "time"), 60);
  assert.equal(planMetricMid("20 min", "time"), 1200);
  assert.equal(planMetricMid("3 × 30-45s", "time"), 38, "37.5 rounds up");
  assert.equal(planMetricMid("5 km", "distance"), 5000);
  assert.equal(planMetricMid("5-6 km", "distance"), 5500);
  assert.equal(planMetricMid("2 × 800m", "distance"), 800);
  assert.equal(planMetricMid("plank", "time"), undefined, "no duration in it");
  assert.equal(planMetricMid("", "time"), undefined);
  assert.equal(planMetricMid(undefined as unknown as string, "time"), undefined);
});

test("reconcileGrounding: keeps a matching id, re-anchors a mislinked one, drops a hopeless one", () => {
  const catalog = [
    { id: "a", name: "Lateral Raise" },
    { id: "b", name: "Shrug" },
    { id: "d", name: "Bench Press" },
  ];
  assert.equal(reconcileGrounding("lateral raise", "a", catalog)?.id, "a", "the name matches its own id");
  assert.equal(reconcileGrounding("lateral raise", "b", catalog)?.id, "a", "linked to a shrug: moved to the lateral raise");
  assert.equal(reconcileGrounding("unrelated words here", "b", catalog), undefined, "nothing matches: ungrounded is safer");
  assert.equal(reconcileGrounding("lateral raise", undefined, catalog), undefined);
  assert.equal(reconcileGrounding("lateral raise", "missing", catalog), undefined, "an id the catalog does not have");
  assert.equal(reconcileGrounding("", "d", catalog)?.id, "d", "no name to compare: trust the id");
});

test("reconcileGrounding: half the words is enough for the linked id, three fifths for a replacement", () => {
  // score = shared words / words in the shorter name
  const linked = { id: "x", name: "alpha delta echo foxtrot" };
  assert.equal(reconcileGrounding("alpha bravo", "x", [linked])?.id, "x", "1 of 2 = 0.5 keeps the linked id");
  const farOff = { id: "y", name: "zulu yankee xray whiskey" };
  const five = "alpha bravo charlie delta echo";
  assert.equal(reconcileGrounding(five, "y", [farOff, { id: "z", name: "alpha bravo charlie foxtrot golf" }])?.id, "z", "3 of 5 = 0.6 replaces a wrong link");
  assert.equal(reconcileGrounding(five, "y", [farOff, { id: "w", name: "alpha bravo foxtrot golf hotel" }]), undefined, "2 of 5 = 0.4 is not enough");
});

test("planNextTargets: stops at max, skips repeats and timed exercises, and ignores exercises never logged", () => {
  const plan: PlanDoc = {
    ...planOf({ name: "Bench Press", sets: "3 × 8–12" }),
    split: [{ weekday: 1, muscleGroup: "x", exercises: [
      { name: "Bench Press", sets: "3 × 8–12", startWeight: "60 kg", technique: "", muscles: "x", role: "primary" },
      { name: "Bench Press", sets: "3 × 8–12", startWeight: "60 kg", technique: "", muscles: "x", role: "primary" },
      { name: "Squat", sets: "3 × 5", startWeight: "80 kg", technique: "", muscles: "x", role: "primary" },
      { name: "Plank", sets: "3 × 30-45s", startWeight: "Bodyweight", technique: "", muscles: "x", role: "primary", metric: "time" },
      { name: "Never Logged", sets: "3 × 10", startWeight: "20 kg", technique: "", muscles: "x", role: "primary" },
    ] }],
  } as unknown as PlanDoc;
  const logs = [logOf("2026-06-01", "Bench Press", { reps: 8, weight: 60 }), logOf("2026-06-01", "Squat", { reps: 5, weight: 80 }), logOf("2026-06-01", "Plank", { seconds: 40 })];
  const lines = (max?: number) => planNextTargets(plan, logs, max).map((l) => l.split(":")[0]);
  assert.deepEqual(lines(), ["Bench Press", "Squat"], "the duplicate, the timed one and the unlogged one are left out");
  assert.deepEqual(lines(1), ["Bench Press"], "max 1");
  assert.deepEqual(lines(2), ["Bench Press", "Squat"], "max 2 is exactly enough");
  assert.deepEqual(lines(0), []);
});

test("planNextTargets: a logged name matches the plan's when three fifths of the shorter name's words are shared", () => {
  const plan = planOf({ name: "alpha bravo charlie delta echo", sets: "3 × 8–12" });
  const match = (logged: string) => planNextTargets(plan, [logOf("2026-06-01", logged, { reps: 8, weight: 60 })]).length;
  assert.equal(match("alpha bravo charlie foxtrot golf"), 1, "3 of 5 = 0.6 matches");
  assert.equal(match("alpha bravo foxtrot golf hotel"), 0, "2 of 5 does not");
  assert.equal(match("ALPHA BRAVO CHARLIE DELTA ECHO"), 1, "case does not matter");
  assert.equal(match(""), 0, "a blank name matches nothing");
  assert.equal(match("   "), 0);
});

// ---- timed and distance steps

const timedPlan = (sets: string, name = "Plank") => planOf({ name, sets, startWeight: "Bodyweight", metric: "time" });
const timedChange = (sets: string, seconds: [number, number], rpe?: [number, number]) =>
  computePlanProgression(timedPlan(sets), [logOf("2026-06-01", "Plank", { seconds: seconds[0] }, rpe?.[0]), logOf("2026-06-03", "Plank", { seconds: seconds[1] }, rpe?.[1])], []).changes[0]?.to;

test("timed step: +5 s a session, doubled when the sessions were clearly easy", () => {
  assert.equal(timedChange("3 × 30-45s", [45, 48]), "3 × 35–50s", "no ratings, not far above the top: one step");
  assert.equal(timedChange("3 × 30-45s", [55, 56]), "3 × 40–55s", "no ratings, 10 s or more above the top: double");
  assert.equal(timedChange("3 × 30-45s", [54, 55]), "3 × 35–50s", "9 s above is not 10");
  assert.equal(timedChange("3 × 30-45s", [45, 45], [7, 7]), "3 × 40–55s", "RPE 7 both: easy, double");
  assert.equal(timedChange("3 × 30-45s", [45, 45], [7, 8]), "3 × 35–50s", "one RPE 8: not easy");
});

test("timed step: +1 minute for minute prescriptions, doubled when easy", () => {
  assert.equal(timedChange("3 × 1-2 min", [120, 125]), "3 × 2–3 min");
  assert.equal(timedChange("3 × 1-2 min", [120, 120], [6, 7]), "3 × 3–4 min");
});

test("timed step: a maxed-out session (RPE 9.5 or more) is not ready, 9.4 is", () => {
  assert.equal(timedChange("3 × 30-45s", [45, 45], [9.4, 9.4]), "3 × 35–50s");
  assert.equal(timedChange("3 × 30-45s", [45, 45], [9.5, 8]), undefined);
  assert.equal(timedChange("3 × 30-45s", [45, 45], [8, 10]), undefined);
});

test("distance step: half a kilometre, or about 10% in metres (at least 50), doubled when easy", () => {
  const distance = (sets: string, meters: [number, number], rpe?: [number, number]) =>
    computePlanProgression(
      planOf({ name: "Run", sets, startWeight: "Bodyweight", metric: "distance" }),
      [logOf("2026-06-01", "Run", { meters: meters[0] }, rpe?.[0]), logOf("2026-06-03", "Run", { meters: meters[1] }, rpe?.[1])],
      [],
    ).changes[0]?.to;
  assert.equal(distance("1 × 5 km", [5000, 5000]), "5.5 km");
  assert.equal(distance("1 × 5 km", [5000, 5000], [6, 7]), "6 km", "easy: a whole kilometre");
  assert.equal(distance("1 × 2000m", [2000, 2050]), "2200m");
  assert.equal(distance("1 × 2000m", [2000, 2000], [7, 7]), "2400m", "easy doubles the 200 m");
  assert.equal(distance("1 × 300m", [300, 300]), "350m", "never less than 50 m");
});

// ---- plateau: three sessions short of the top with at least one at RPE 9.5 or more

const plateauOf = (plan: PlanDoc, name: string, sessions: Array<{ reps?: number; weight?: number; seconds?: number; rpe?: number }>) =>
  computePlanProgression(
    plan,
    sessions.map((s, i) => logOf(`2026-06-0${i + 1}`, name, { reps: s.reps, weight: s.weight, seconds: s.seconds }, s.rpe)),
    [],
  ).plateau.includes(name);

test("plateau (loaded lift): three sessions short of the top with one grinding; two sessions or no grinding is not", () => {
  const plan = planOf({ name: "Bench Press", sets: "3 × 8–12", startWeight: "60 kg" });
  const s = (rpe: number | undefined) => ({ reps: 10, weight: 60, rpe });
  assert.equal(plateauOf(plan, "Bench Press", [s(9.5), s(8), s(8)]), true);
  assert.equal(plateauOf(plan, "Bench Press", [s(8), s(8), s(9.5)]), true, "the grind can be the oldest of the three");
  assert.equal(plateauOf(plan, "Bench Press", [s(9.4), s(9), s(8)]), false, "9.4 is not grinding");
  assert.equal(plateauOf(plan, "Bench Press", [s(9.5), s(9.5)]), false, "only two sessions");
  assert.equal(plateauOf(plan, "Bench Press", [s(undefined), s(undefined), s(undefined)]), false, "no ratings at all");
  assert.equal(plateauOf(plan, "Bench Press", [s(9.5), { reps: 12, weight: 60, rpe: 8 }, s(8)]), false, "one session reached the top");
});

test("plateau (bodyweight): the same rule", () => {
  const plan = planOf({ name: "Push-up", sets: "3 × 8–15", startWeight: "Bodyweight" });
  const s = (rpe: number | undefined) => ({ reps: 10, weight: 0, rpe });
  assert.equal(plateauOf(plan, "Push-up", [s(9.5), s(8), s(8)]), true);
  assert.equal(plateauOf(plan, "Push-up", [s(9.4), s(8), s(8)]), false);
  assert.equal(plateauOf(plan, "Push-up", [s(9.5), s(9.5)]), false, "only two sessions");
  assert.equal(plateauOf(plan, "Push-up", [s(undefined), s(undefined), s(undefined)]), false);
});

test("plateau (timed): three sessions short of the target time with one grinding", () => {
  const plan = timedPlan("3 × 30-45s");
  const s = (rpe: number | undefined) => ({ seconds: 35, rpe });
  assert.equal(plateauOf(plan, "Plank", [s(9.5), s(8), s(8)]), true);
  assert.equal(plateauOf(plan, "Plank", [s(9.5), s(9.5)]), false, "only two sessions");
  assert.equal(plateauOf(plan, "Plank", [s(undefined), s(undefined), s(undefined)]), false, "no ratings");
  assert.equal(plateauOf(plan, "Plank", [s(9.5), { seconds: 45, rpe: 8 }, s(8)]), false, "one reached the target");
});

// ---- how fast someone progresses, which sets count, how big a load step is

const sessionOf = (exercises: Array<{ sets: number; rpe?: number; skipped?: boolean }>): WorkoutLogDoc => ({
  userId: 1, date: "2026-06-01", weekday: 1, completed: true, createdAt: new Date(0),
  exercises: exercises.map((e, i) => ({ name: `Lift ${i}`, skipped: e.skipped ?? false, ...(e.rpe !== undefined ? { rpe: e.rpe } : {}), setsDone: Array.from({ length: e.sets }, () => ({ reps: 8, weight: 50 })) })),
});

test("evaluateProgressionRate: fast above 80% of sets that did not fail, slow below 50%, 80% and 50% are normal", () => {
  assert.equal(evaluateProgressionRate([]), "normal", "no logs");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 5 }])]), "fast");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 4 }, { sets: 1, rpe: 9.5 }])]), "normal", "exactly 80% is not above it");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 5 }, { sets: 1, rpe: 9.5 }])]), "fast", "5 of 6");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 1 }, { sets: 1, rpe: 9.5 }])]), "normal", "exactly 50% is not below it");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 1 }, { sets: 2, rpe: 9.5 }])]), "slow", "1 of 3");
});

test("evaluateProgressionRate: a skipped exercise and an RPE of 9.5 or more fail their sets, 9.4 does not", () => {
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 2, rpe: 9.4 }, { sets: 2, rpe: 9.4 }])]), "fast");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 3, skipped: true }])]), "slow");
  assert.equal(evaluateProgressionRate([sessionOf([{ sets: 0, skipped: true }, { sets: 3 }])]), "fast", "an exercise with no sets is ignored");
});

test("workingSets: the weight that most sets qualify at, the worst reps there, empty or zero-rep sets ignored", () => {
  assert.deepEqual(workingSets([{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 3, weight: 80 }], 8), { weight: 60, reps: 8, count: 2 }, "a heavy triple is not what you lift for 8");
  assert.deepEqual(workingSets([{ reps: 10, weight: 60 }, { reps: 8, weight: 60 }], 8), { weight: 60, reps: 8, count: 2 }, "reps is the worst set");
  assert.deepEqual(workingSets([{ reps: 8, weight: 60 }, { reps: 7, weight: 80 }], 8), { weight: 60, reps: 8, count: 1 }, "exactly the low end qualifies, one below does not");
  assert.deepEqual(workingSets([{ reps: 5, weight: 80 }], 8), { weight: 80, reps: 5, count: 1 }, "nothing reaches the low end: use what was done");
  assert.deepEqual(workingSets([{ reps: 0, weight: 100 }, { reps: 6, weight: 50 }]), { weight: 50, reps: 6, count: 1 }, "a 0-rep set is not a working set");
  assert.equal(workingSets([{ reps: 0, weight: 100 }]), undefined);
  assert.equal(workingSets([]), undefined);
});

test("loadStep: 5% of the load in plate-sized steps, at most 2.5 kg (5 kg for legs), small steps for dumbbells", () => {
  assert.equal(loadStep("Bench Press", 60), 2.5);
  assert.equal(loadStep("Bench Press", 20), 2.5, "never below the smallest plate");
  assert.equal(loadStep("Squat", 100), 5);
  assert.equal(loadStep("Squat", 60), 2.5);
  assert.equal(loadStep("Squat", 200), 5, "the cap for legs");
  assert.equal(loadStep("Dumbbell Curl", 8), 1, "light dumbbells go up by a kilo");
  assert.equal(loadStep("Dumbbell Curl", 20), 2);
  assert.equal(loadStep("Dumbbell Bench Press", 9), 1, "under 10 kg");
  assert.equal(loadStep("Dumbbell Bench Press", 10), 2, "10 kg is not under 10");
  assert.equal(loadStep("Гантелі жим", 14), 2);
});

test("loadJump: two steps after an easy session, but only while that stays within 10% of the load", () => {
  assert.equal(loadJump("Bench Press", 100, true), 5, "5 kg is 5%");
  assert.equal(loadJump("Bench Press", 100, false), 2.5);
  assert.equal(loadJump("Bench Press", 50, true), 5, "5 kg is exactly 10% of 50");
  assert.equal(loadJump("Bench Press", 40, true), 2.5, "5 kg would be 12.5%");
  assert.equal(loadJump("Dumbbell Curl", 6, true), 1, "light weights stay single");
});

// ---- when a session was easy enough for a double step (no RPE: reps two above the top)

const easyReps = (name: string, sets: string, startWeight: string, reps: number, rpe?: [number, number]) =>
  computePlanProgression(
    planOf({ name, sets, startWeight }),
    [logOf("2026-06-01", name, { reps, weight: startWeight === "Bodyweight" ? 0 : 60 }, rpe?.[0]), logOf("2026-06-03", name, { reps, weight: startWeight === "Bodyweight" ? 0 : 60 }, rpe?.[1])],
    [],
  ).changes[0]?.to;

test("easy session, loaded lift: reps two above the top (or RPE 7 or less) doubles the jump", () => {
  assert.equal(easyReps("Bench Press", "3 × 8–12", "60 kg", 14), "65 kg", "14 = top + 2: double");
  assert.equal(easyReps("Bench Press", "3 × 8–12", "60 kg", 13), "62.5 kg", "13 = top + 1: single");
  assert.equal(easyReps("Bench Press", "3 × 8–12", "60 kg", 12, [7, 7]), "65 kg", "RPE 7: easy");
  assert.equal(easyReps("Bench Press", "3 × 8–12", "60 kg", 14, [7, 8]), "62.5 kg", "an RPE 8 session is not easy, however many reps");
});

test("easy session, bodyweight: the same rule on reps (two more instead of one)", () => {
  assert.equal(easyReps("Push-up", "3 × 8–15", "Bodyweight", 17), "3 × 10–17", "17 = top + 2: two more reps");
  assert.equal(easyReps("Push-up", "3 × 8–15", "Bodyweight", 16), "3 × 9–16", "16 = top + 1: one more");
  assert.equal(easyReps("Push-up", "3 × 8–15", "Bodyweight", 15, [6, 7]), "3 × 10–17", "RPE 7 or less: easy");
  assert.equal(easyReps("Push-up", "3 × 8–15", "Bodyweight", 15, [7, 8]), "3 × 9–16");
});
