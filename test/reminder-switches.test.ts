import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { handleSettingsApi } from "../src/webapp/settingsApi";
import type { UserDoc } from "../src/types";
import { REMINDER_KEYS } from "../src/domain/reminderTypes";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Every file that decides whether a reminder is sent: the pass list, the nudges, the evening survey.
function nudgeFiles(): string[] {
  const jobs = join(SRC, "schedulerJobs");
  const fromJobs = readdirSync(jobs).filter((f) => f.endsWith(".ts")).map((f) => join(jobs, f));
  return [join(SRC, "scheduler.ts"), join(SRC, "features", "survey", "eveningSurvey.ts"), ...fromJobs];
}

/** Keys read by a nudge: remOff("x") in the pass list and nudges, off("x") in the evening survey. */
function keysReadByNudges(): Set<string> {
  const keys = new Set<string>();
  for (const file of nudgeFiles()) {
    for (const m of readFileSync(file, "utf8").matchAll(/\b(?:remOff|off)\("(\w+)"\)/g)) keys.add(m[1]);
  }
  return keys;
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(db: ReturnType<typeof newDb>, userId: number, method: string, path: string, body?: unknown) {
  const full = `${path}?debugUser=${userId}`;
  return handleSettingsApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("every key a nudge checks is offered by the settings API", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const body = (await (await call(db, 1, "GET", "/api/settings")).json()) as { reminders: { key: string }[] };
  const offered = new Set(body.reminders.map((r) => r.key));
  const unreachable = [...keysReadByNudges()].filter((k) => !offered.has(k));
  assert.deepEqual(unreachable, [], "nudges check these keys, but no settings surface can switch them");
});

test("every switch offered is read by a nudge, and the API returns the shared list", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const body = (await (await call(db, 1, "GET", "/api/settings")).json()) as { reminders: { key: string }[] };
  assert.deepEqual(body.reminders.map((r) => r.key), REMINDER_KEYS.map(([k]) => k));
  const read = keysReadByNudges();
  const dead = REMINDER_KEYS.map(([k]) => k).filter((k) => k !== "all" && !read.has(k));
  assert.deepEqual(dead, [], "offered switches that no nudge reads");
});

test("the quality ask can be toggled through the settings API and persists", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const off = await call(db, 1, "POST", "/api/settings", { action: "remToggle", key: "quality" });
  assert.equal(off.status, 200);
  let u = (await getUser(db, 1)) as UserDoc;
  assert.deepEqual(u.profile.remindersOff, ["quality"]);

  await call(db, 1, "POST", "/api/settings", { action: "remToggle", key: "quality" });
  u = (await getUser(db, 1)) as UserDoc;
  assert.deepEqual(u.profile.remindersOff, []);
});
