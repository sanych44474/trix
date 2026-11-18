// The weekly calorie adjustment job (src/schedulerJobs/adaptiveCalories.ts). The rule itself is pure and
// tested in adaptive-calories.test.ts; this is the part around it: which data it reads, what it saves,
// what it says, and when it starts its cooldown. The weigh-in data is built from the same clock the job
// uses, so the 21-day window is exercised at its edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setDayMeals } from "../src/adapters/d1/v2Nutrition";
import { adaptiveCalories } from "../src/schedulerJobs/adaptiveCalories";
import { isoDaysAgo } from "../src/schedulerJobs/shared";
import type { UserPass } from "../src/schedulerJobs/userPass";
import type { BodyLogDoc, UserDoc } from "../src/types";

const meal = [{ desc: "oats", kcal: 400, protein: 20, fats: 10, carbs: 60 }] as never;

async function setup(opts: { goalWeight?: number; nutrition?: UserDoc["nutrition"] | null; nutritionDays?: number } = {}) {
  const db = newDb();
  await getOrCreateUser(db, 71, 71, "en", "Ann");
  const base = (await getUser(db, 71)) as UserDoc;
  await updateUser(db, 71, {
    profile: { ...base.profile, goalWeight: opts.goalWeight ?? 75, sex: "male" },
    ...(opts.nutrition === null ? {} : { nutrition: opts.nutrition ?? { calories: 2200, protein: 160, fats: 70, carbs: 250 } }),
  });
  for (let d = 1; d <= (opts.nutritionDays ?? 13); d++) await setDayMeals(db, 71, isoDaysAgo(d), meal);
  const user = (await getUser(db, 71)) as UserDoc;
  const messages: string[] = [];
  const marked: string[] = [];
  const weighIns = (kgByDaysAgo: Array<[number, number]>) =>
    kgByDaysAgo.map(([ago, weight]) => ({ date: isoDaysAgo(ago), weight })) as unknown as BodyLogDoc[];
  const run = (bodyLogs: BodyLogDoc[]) =>
    adaptiveCalories({
      user, db, lang: "en",
      markSent: (k: string) => marked.push(k),
      send: async (text: string) => { messages.push(text); return "sent"; },
      bodyAll: async () => bodyLogs,
    } as unknown as UserPass);
  return { db, user, messages, marked, weighIns, run };
}

// 80 kg flat for three weeks while the goal is 75: the trend is 0, the goal wants about -0.5 kg a week.
const FLAT_80 = [[20, 80], [15, 80], [10, 80], [5, 80], [0, 80]] as Array<[number, number]>;
// 70 kg flat while the goal is 75: wants a slow gain.
const FLAT_70 = [[20, 70], [15, 70], [10, 70], [5, 70], [0, 70]] as Array<[number, number]>;

test("a stalled cut: the target drops by 150 kcal, carbs absorb it, the person is told, the cooldown starts", async () => {
  const s = await setup();
  assert.equal(await s.run(s.weighIns(FLAT_80)), true, "this tick's one message");
  const saved = ((await getUser(s.db, 71)) as UserDoc).nutrition;
  assert.equal(saved?.calories, 2050);
  assert.equal(saved?.carbs, 213, "250 - 150/4 = 212.5, rounded");
  assert.equal(saved?.protein, 160, "protein and fat are left alone");
  assert.equal(saved?.fats, 70);
  assert.equal(s.messages.length, 1);
  assert.match(s.messages[0], /2200/);
  assert.match(s.messages[0], /2050/);
  assert.match(s.messages[0], /0\.00\b/, "the trend, to two decimals");
  assert.match(s.messages[0], /0\.48\b/, "the goal's pace, to two decimals");
  assert.deepEqual(s.marked, ["cal_adjust"]);
});

test("a stalled gain: the target rises, and the message is the 'up' one", async () => {
  const s = await setup({ goalWeight: 75 });
  assert.equal(await s.run(s.weighIns(FLAT_70)), true);
  const saved = ((await getUser(s.db, 71)) as UserDoc).nutrition;
  assert.equal(saved?.calories, 2350);
  assert.equal(saved?.carbs, 288, "250 + 150/4 = 287.5, rounded");
  const down = await setup();
  await down.run(down.weighIns(FLAT_80));
  assert.notEqual(s.messages[0], down.messages[0], "up and down read differently");
});

test("poor food logging: nothing changes and nothing is said, but the cooldown still starts", async () => {
  const s = await setup({ nutritionDays: 12 });
  assert.equal(await s.run(s.weighIns(FLAT_80)), false);
  assert.equal(((await getUser(s.db, 71)) as UserDoc).nutrition?.calories, 2200);
  assert.equal(s.messages.length, 0);
  assert.deepEqual(s.marked, ["cal_adjust"], "an evaluation with no change is still an evaluation");
  const enough = await setup({ nutritionDays: 13 });
  assert.equal(await enough.run(enough.weighIns(FLAT_80)), true, "13 logged days of 21 is the least that counts");
});

test("on pace: no change", async () => {
  const s = await setup();
  const losing = [[20, 80], [15, 79], [10, 78], [5, 77], [0, 76]] as Array<[number, number]>; // about -1.4 kg a week
  const onPace = [[20, 80], [15, 79.66], [10, 79.33], [5, 79], [0, 78.66]] as Array<[number, number]>; // about -0.47 kg a week, the goal's pace for this weight
  assert.equal(await s.run(s.weighIns(onPace)), false);
  assert.equal(s.messages.length, 0);
  assert.equal(await s.run(s.weighIns(losing)), true, "far faster than planned: eat a little more");
});

test("only the last 21 days of weigh-ins are read", async () => {
  const s = await setup();
  const four = [[15, 80], [10, 80], [5, 80], [0, 80]] as Array<[number, number]>;
  assert.equal(await s.run(s.weighIns([[22, 80], ...four])), false, "a 22-day-old weigh-in is not the fifth point");
  assert.equal(await s.run(s.weighIns([[21, 80], ...four])), true, "21 days ago still counts");
  assert.equal(await s.run(s.weighIns([...four, [3, 0]])), false, "a 0 kg entry is not a weigh-in");
});

test("no nutrition target or no goal weight: the job does nothing and does not start a cooldown", async () => {
  const none = await setup({ nutrition: null });
  assert.equal(await none.run(none.weighIns(FLAT_80)), false);
  assert.deepEqual(none.marked, []);
  assert.equal(none.messages.length, 0);
  const noGoal = await setup();
  const user = { ...noGoal.user, profile: { ...noGoal.user.profile, goalWeight: undefined } };
  const result = await adaptiveCalories({ user, db: noGoal.db, lang: "en", markSent: (k: string) => noGoal.marked.push(k), send: async () => "sent", bodyAll: async () => noGoal.weighIns(FLAT_80) } as unknown as UserPass);
  assert.equal(result, false);
  assert.deepEqual(noGoal.marked, []);
});
