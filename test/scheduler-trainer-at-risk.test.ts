// The "client at risk" alert to a trainer (src/schedulerJobs/trainerAtRisk.ts): two planned sessions in a
// row missed, or a regular food logger who has gone quiet. The rules are pure (domain/atrisk.ts); this is
// the job around them: when it alerts, who gets it, and how it avoids repeating itself or going silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setDayMeals } from "../src/adapters/d1/v2Nutrition";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { trainerAtRiskAlert } from "../src/schedulerJobs/trainerAtRisk";
import type { UserPass } from "../src/schedulerJobs/userPass";
import type { PlanDoc, UserDoc, Weekday } from "../src/types";

const day = (from: string, n: number) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 as Weekday;
const meal = [{ desc: "oats", kcal: 400, protein: 20, fats: 10, carbs: 60 }] as never;

/** A client of trainer 4, on a plan that trains every day, who joined `joinedDaysAgo` days before "today". */
async function setup(opts: { joinedDaysAgo?: number; trainer?: boolean; plan?: boolean } = {}) {
  const db = newDb();
  await getOrCreateUser(db, 4, 4, "en", "Coach");
  await getOrCreateUser(db, 3, 3, "en", "Client");
  if (opts.trainer !== false) await updateUser(db, 3, { trainerId: 4 });
  const user = (await getUser(db, 3)) as UserDoc;
  const joined = user.createdAt.toISOString().slice(0, 10);
  const today = day(joined, opts.joinedDaysAgo ?? 10);
  const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, exercises: [] }));
  const activePlan = opts.plan === false ? null : ({ split: everyDay, generatedAt: new Date(`${day(joined, -30)}T00:00:00Z`) } as unknown as PlanDoc);
  const sent: Record<string, string> = {};
  const calls: Array<{ to: number; kind: string; text: string }> = [];
  const marked: string[] = [];
  let outcome: string = "sent";
  const run = () =>
    trainerAtRiskAlert({
      user, db, date: today, activePlan, sent,
      markSent: (k: string) => marked.push(k),
      setSent: (k: string, v: string) => { sent[k] = v; },
      sendTo: async (target: { _id: number }, kind: string, text: string) => { calls.push({ to: target._id, kind, text }); return outcome; },
      durable: (r: string) => r === "sent" || r === "retrying" || r === "duplicate",
      appKb: () => undefined,
    } as unknown as UserPass);
  return { db, user, today, sent, calls, marked, run, failDelivery: () => { outcome = "failed"; } };
}

test("two planned sessions in a row missed: the trainer is told once, with the dates, and the miss is remembered", async () => {
  const s = await setup();
  await s.run();
  assert.deepEqual(s.marked, ["atrisk_check"], "the check itself is marked");
  assert.equal(s.calls.length, 1);
  assert.deepEqual([s.calls[0].to, s.calls[0].kind], [4, "atrisk_workout"]);
  assert.match(s.calls[0].text, /Client/, "names the client");
  assert.match(s.calls[0].text, new RegExp(day(s.today, -2)), "the older missed day");
  assert.match(s.calls[0].text, new RegExp(day(s.today, -1)), "the newer missed day");
  assert.equal(s.sent.atrisk_workout, day(s.today, -1), "remembered by the miss itself, not by today");
});

test("the same miss is not reported twice, but a new one is", async () => {
  const s = await setup();
  s.sent.atrisk_workout = day(s.today, -1);
  await s.run();
  assert.equal(s.calls.length, 0, "already reported");
  s.sent.atrisk_workout = day(s.today, -2);
  await s.run();
  assert.equal(s.calls.length, 1, "last time's miss ended a day earlier: this is a new one");
});

test("one completed session in the last two planned days is enough to stay quiet", async () => {
  const newer = await setup();
  await upsertWorkoutLog(newer.db, 3, day(newer.today, -1), weekdayOf(day(newer.today, -1)), [], true);
  await newer.run();
  assert.equal(newer.calls.length, 0);
  const older = await setup();
  await upsertWorkoutLog(older.db, 3, day(older.today, -2), weekdayOf(day(older.today, -2)), [], true);
  await older.run();
  assert.equal(older.calls.length, 0);
  const skipped = await setup();
  await upsertWorkoutLog(skipped.db, 3, day(skipped.today, -1), weekdayOf(day(skipped.today, -1)), [], false);
  await skipped.run();
  assert.equal(skipped.calls.length, 1, "a skipped day is not a completed one");
});

test("a new client is not blamed for days before they joined, and a client with no active plan has nothing to miss", async () => {
  const fresh = await setup({ joinedDaysAgo: 1 });
  await fresh.run();
  assert.equal(fresh.calls.length, 0, "only one planned day since joining");
  const two = await setup({ joinedDaysAgo: 3 });
  await two.run();
  assert.equal(two.calls.length, 1, "two planned days since joining is enough");
  const noPlan = await setup({ plan: false });
  await noPlan.run();
  assert.equal(noPlan.calls.length, 0);
});

test("a delivery that was lost is not remembered, so it is tried again next pass", async () => {
  const s = await setup();
  s.failDelivery();
  await s.run();
  assert.equal(s.calls.length, 1);
  assert.equal(s.sent.atrisk_workout, undefined, "not marked as reported");
  await s.run();
  assert.equal(s.calls.length, 2, "tried again");
});

test("a client with no trainer alerts nobody", async () => {
  const s = await setup({ trainer: false });
  await s.run();
  assert.equal(s.calls.length, 0);
  assert.deepEqual(s.marked, ["atrisk_check"]);
});

async function logFood(db: Awaited<ReturnType<typeof setup>>["db"], today: string, daysAgo: number[]) {
  for (const d of daysAgo) await setDayMeals(db, 3, day(today, -d), meal);
}

test("food lapse: a regular logger who has been quiet for 3 days is reported, 2 days is not", async () => {
  const quiet = await setup({ plan: false });
  await logFood(quiet.db, quiet.today, [3, 4, 5, 6, 7, 8, 9]); // seven days, the last 3 days ago
  await quiet.run();
  assert.equal(quiet.calls.length, 1);
  assert.deepEqual([quiet.calls[0].to, quiet.calls[0].kind], [4, "atrisk_nutrition"]);
  assert.equal(quiet.sent.atrisk_nutrition, day(quiet.today, -3), "remembered by the last day logged");
  assert.match(quiet.calls[0].text, /Client/);
  assert.match(quiet.calls[0].text, /3/, "how many days");

  const recent = await setup({ plan: false });
  await logFood(recent.db, recent.today, [2, 3, 4, 5, 6, 7, 8]);
  await recent.run();
  assert.equal(recent.calls.length, 0, "2 days is not a lapse yet");
});

test("food lapse: seven logged days make a regular logger, six do not, and a lapse is reported once", async () => {
  const six = await setup({ plan: false });
  await logFood(six.db, six.today, [3, 4, 5, 6, 7, 8]);
  await six.run();
  assert.equal(six.calls.length, 0);
  const again = await setup({ plan: false });
  await logFood(again.db, again.today, [4, 5, 6, 7, 8, 9, 10]);
  await again.run();
  await again.run();
  assert.equal(again.calls.length, 1, "the second pass sees the same lapse and stays quiet");
});

test("a missed workout and a food lapse in the same pass are two alerts", async () => {
  const s = await setup();
  await logFood(s.db, s.today, [5, 6, 7, 8, 9, 10, 11]);
  await s.run();
  assert.deepEqual(s.calls.map((c) => c.kind).sort(), ["atrisk_nutrition", "atrisk_workout"]);
});
