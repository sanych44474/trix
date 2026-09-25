// processUser's send routing. Before this, ~14 of its sends called bot.api.sendMessage directly
// with a swallowing .catch, and the per-user dedup key was written whether or not the send landed:
// one terminal Telegram error consumed the once-per-day (or once-per-30-days) key and the message
// was never retried, not on the next tick and not ever. These tests pin the invariant: a dedup key
// is written only for a message that is delivered or DURABLY QUEUED in the outbox
// (v2_notifications) -- and not for one that terminally failed.
//
// This is also the first test of any kind to drive processUser -- see the note at the top of
// scheduler-outbox.test.ts, which recorded that nothing exercised it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { newDb } from "./harness";
import { buildSinglePass, processUser, type Sender } from "../src/scheduler";
import { getOrCreateUser, updateUser, getUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { t } from "../src/locales/i18n";
import type { Env, PlanDoc, UserDoc, Weekday } from "../src/types";

const GROUP = "Full body";
// The tomorrow-preview reminder renders the same plan day, so matching on the exercise name alone
// would count both. Match the reminder's own opening line instead.
const WORKOUT_PREFIX = t("en", "reminder_workout", { group: GROUP });
const isWorkoutReminder = (text: string) => text.startsWith(WORKOUT_PREFIX);

function grammyErr(errorCode: number, retryAfterSeconds?: number): GrammyError {
  return new GrammyError(
    "Error",
    { ok: false, error_code: errorCode, description: "x", parameters: retryAfterSeconds ? { retry_after: retryAfterSeconds } : undefined },
    "sendMessage",
    {},
  );
}

/** Trains every weekday, so "is today a training day" holds whenever the suite happens to run. */
function everydayPlan(userId: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => ({
      weekday,
      muscleGroup: GROUP,
      exercises: [{ name: "Back Squat", sets: "3x8", startWeight: "60kg", technique: "" }],
    })),
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [], methodology: "", generatedAt: new Date("2020-01-01"), schemaVersion: 1,
  };
}

/**
 * A user the workout reminder is guaranteed to select, independent of wall-clock time:
 *  - reminderHour 0 so `hour >= reminderHour` always holds; no quiet hours configured
 *  - trains every weekday, active plan, nothing logged today
 *  - the account is created now, so the activation arc (which runs FIRST and would otherwise claim
 *    the one-nudge-per-tick budget) is below its `dayIndex >= 2` threshold and stays quiet
 */
async function reminderReadyUser(db: ReturnType<typeof newDb>, id: number): Promise<UserDoc> {
  await getOrCreateUser(db, id, id, "en", "Test");
  await updateUser(db, id, {
    onboarded: true,
    profile: { timezone: "UTC", reminderHour: 0, trainingWeekdays: [1, 2, 3, 4, 5, 6, 7], name: "Test" },
  } as Parameters<typeof updateUser>[2]);
  await setActivePlan(db, everydayPlan(id));
  return (await getUser(db, id)) as UserDoc;
}

const fakeEnv = (db: ReturnType<typeof newDb>): Env => ({ DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env);

function recordingSender(onSend: (text: string) => void): { bot: Sender; texts: string[] } {
  const texts: string[] = [];
  const bot: Sender = {
    api: ({
      sendMessage: (async (_chatId: number, text: string) => { texts.push(String(text)); onSend(String(text)); return {} as never; }),
    }) as never,
  };
  return { bot, texts };
}

async function workoutRow(db: ReturnType<typeof newDb>) {
  const r = await db
    .prepare("SELECT id, status, attempts, lastError, payload FROM v2_notifications ORDER BY id")
    .all<{ id: number; status: string; attempts: number; lastError: string | null; payload: string }>();
  const rows = (r.results ?? []).filter((row) => row.payload.includes("Time to train"));
  assert.equal(rows.length, 1, `expected exactly one workout-reminder outbox row, got ${JSON.stringify(r.results)}`);
  return rows[0];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// THE regression. A 400 is terminal (classifySendError: any non-429 4xx cannot be fixed by
// retrying), so the message is genuinely gone -- which is exactly when the dedup key must stay
// unwritten, so the next tick tries again instead of suppressing it for the rest of the day.
test("processUser: a terminal send failure does NOT consume the dedup key", async () => {
  const db = newDb();
  const user = await reminderReadyUser(db, 7001);
  const { bot, texts } = recordingSender((text) => { if (isWorkoutReminder(text)) throw grammyErr(400); });

  await processUser(fakeEnv(db), bot, user, await buildSinglePass(db, user._id));

  assert.ok(texts.some(isWorkoutReminder), "expected the workout reminder to be attempted");
  assert.equal((await workoutRow(db)).status, "failed");

  const after = await getUser(db, user._id);
  assert.equal(
    after?.reminders?.sent?.["workout"],
    undefined,
    "a message that never reached the user must not consume its dedup key",
  );
});

test("processUser: a blocked chat does NOT consume the dedup key either", async () => {
  const db = newDb();
  const user = await reminderReadyUser(db, 7004);
  const { bot } = recordingSender((text) => { if (isWorkoutReminder(text)) throw grammyErr(403); });

  await processUser(fakeEnv(db), bot, user, await buildSinglePass(db, user._id));

  assert.equal((await workoutRow(db)).status, "blocked");
  const after = await getUser(db, user._id);
  assert.equal(after?.reminders?.sent?.["workout"], undefined);
});

// A 429 is NOT loss: markRetry keeps the row pending with a later nextAttemptAt and
// deliverDueNotifications drains it on a subsequent cron tick. Writing the key here is correct and
// deliberate -- re-sending from processUser as well would duplicate the message.
test("processUser: a 429 keeps the message queued and DOES record the dedup key", async () => {
  const db = newDb();
  const user = await reminderReadyUser(db, 7005);
  const { bot } = recordingSender((text) => { if (isWorkoutReminder(text)) throw grammyErr(429, 30); });

  await processUser(fakeEnv(db), bot, user, await buildSinglePass(db, user._id));

  const row = await workoutRow(db);
  assert.equal(row.status, "pending", "a 429 must stay queued for the retry sweep");
  assert.equal(row.attempts, 1);
  assert.ok(row.lastError, "the backoff reason should be recorded");

  const after = await getUser(db, user._id);
  assert.equal(after?.reminders?.sent?.["workout"], todayIso());
});

test("processUser: a successful send writes the dedup key and marks the outbox row sent", async () => {
  const db = newDb();
  const user = await reminderReadyUser(db, 7002);
  const { bot, texts } = recordingSender(() => {});

  await processUser(fakeEnv(db), bot, user, await buildSinglePass(db, user._id));

  assert.ok(texts.some(isWorkoutReminder), "expected the workout reminder to be sent");
  assert.equal((await workoutRow(db)).status, "sent");

  const after = await getUser(db, user._id);
  assert.equal(after?.reminders?.sent?.["workout"], todayIso());
});

test("processUser: the dedup key suppresses the same reminder later the same day", async () => {
  const db = newDb();
  const user = await reminderReadyUser(db, 7003);
  const { bot, texts } = recordingSender(() => {});

  await processUser(fakeEnv(db), bot, user, await buildSinglePass(db, user._id));
  assert.equal(texts.filter(isWorkoutReminder).length, 1);

  const reloaded = (await getUser(db, user._id)) as UserDoc;
  await processUser(fakeEnv(db), bot, reloaded, await buildSinglePass(db, reloaded._id));

  assert.equal(
    texts.filter(isWorkoutReminder).length,
    1,
    "the workout reminder must not re-fire once its key is recorded",
  );
});
