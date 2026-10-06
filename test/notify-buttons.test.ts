// The chat is retired: a reminder's buttons must open the Mini App (web_app), not chat callbacks.
// Without a Mini App URL (dev/tests) they fall back to the callbacks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { buildSinglePass, processUser, type Sender } from "../src/scheduler";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { appKeyboard, appLink } from "../src/notify/appKeyboard";
import type { Env, PlanDoc, UserDoc, Weekday } from "../src/types";

type Markup = { inline_keyboard: Array<Array<{ text: string; web_app?: { url: string }; callback_data?: string }>> };
const APP = { WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1" };

function everydayPlan(userId: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => ({ weekday, muscleGroup: "Full body", exercises: [{ name: "Back Squat", sets: "3x8", startWeight: "60kg", technique: "" }] })),
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [], methodology: "", generatedAt: new Date("2020-01-01"), schemaVersion: 1,
  };
}

function recorder() {
  const sent: Array<{ text: string; markup?: Markup }> = [];
  const bot: Sender = { api: ({ sendMessage: (async (_c: number, text: string, extra?: { reply_markup?: Markup }) => { sent.push({ text, markup: extra?.reply_markup }); return {} as never; }) }) as never };
  return { bot, sent };
}

test("appLink / appKeyboard: web_app buttons with deep-link params; callbacks only without the app", () => {
  assert.match(appLink(APP, "role", { client: 42 }) ?? "", /\/app-v2\?v=.+&view=role&client=42$/);
  assert.match(appLink(APP, "coach", { ask: "Що змінити?" }) ?? "", /&view=coach&ask=/);
  assert.equal(appLink({}, "today"), undefined);
  const withApp = appKeyboard(APP, [[{ text: "a", view: "train", fallback: "log:done" }], [{ text: "b", view: "plan" }]])!;
  assert.deepEqual(withApp.inline_keyboard.map((r) => r.map((b) => ("web_app" in b ? "app" : "cb"))), [["app"], ["app"]]);
  const noApp = appKeyboard({}, [[{ text: "a", view: "train", fallback: "log:done" }, { text: "b", view: "plan" }]])!;
  assert.deepEqual(noApp.inline_keyboard, [[{ text: "a", callback_data: "log:done" }]]);
  assert.equal(appKeyboard({}, [[{ text: "b", view: "plan" }]]), undefined);
});

test("workout reminder with the app: every button opens the Mini App, none is a chat callback", async () => {
  const db = newDb();
  await getOrCreateUser(db, 8001, 8001, "en", "Ann");
  await updateUser(db, 8001, { onboarded: true, profile: { timezone: "UTC", reminderHour: 0, trainingWeekdays: [1, 2, 3, 4, 5, 6, 7], name: "Ann" } } as never);
  await setActivePlan(db, everydayPlan(8001));
  const user = (await getUser(db, 8001)) as UserDoc;
  const { bot, sent } = recorder();
  await processUser({ DB: db, TELEGRAM_BOT_TOKEN: "t", ...APP } as unknown as Env, bot, user, await buildSinglePass(db, user._id));
  assert.ok(sent.length >= 1, "expected a reminder");
  for (const m of sent) {
    for (const b of m.markup?.inline_keyboard.flat() ?? []) {
      assert.equal(b.callback_data, undefined, `callback button "${b.text}" in: ${m.text.slice(0, 60)}`);
      assert.match(b.web_app?.url ?? "", /^https:\/\/trix\.example\/app-v2/);
    }
  }
  assert.ok(sent.some((m) => m.markup?.inline_keyboard.flat().some((b) => /view=train/.test(b.web_app?.url ?? ""))), "workout reminder opens the logger");
});

/** A fixed-offset zone whose local hour is one of the every-2h water slots (9, 11, …, 19). */
function zoneAtWaterSlot(): string | null {
  const utc = new Date().getUTCHours();
  for (const target of [9, 11, 13, 15, 17, 19]) {
    let off = target - utc;
    if (off > 14) off -= 24;
    if (off < -12) off += 24;
    if (off >= -12 && off <= 14) return off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
  }
  return null;
}

test("water reminder: a second pass in the same hour does not send it again", async (t) => {
  const tz = zoneAtWaterSlot();
  if (!tz || new Date().getUTCMinutes() > 57) { t.skip("too close to an hour boundary"); return; }
  const db = newDb();
  await getOrCreateUser(db, 8002, 8002, "en", "Bo");
  // No plan and no training days: nothing else competes for the one-nudge-per-pass budget.
  await updateUser(db, 8002, { onboarded: true, profile: { timezone: tz, reminderHour: 23, waterEvery: 2, name: "Bo", remindersOff: ["workout", "weighin", "quality", "digest", "plateau", "measure", "wellbeing", "tomorrow"] } } as never);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "t", ...APP } as unknown as Env;
  const waterCount = async () => {
    const { bot, sent } = recorder();
    await processUser(env, bot, (await getUser(db, 8002)) as UserDoc, await buildSinglePass(db, 8002));
    return sent.filter((m) => m.text.includes("💧")).length;
  };
  assert.equal(await waterCount(), 1);
  assert.equal(await waterCount(), 0);
});
