// Signup -> second workout funnel: the pure step logic, the per-account query against the schema,
// and the owner Onboarding tab that shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { computeFunnel, type FunnelAccount } from "../src/domain/funnel";
import { funnelAccounts } from "../src/adapters/d1/funnel";
import { FUNNEL_STARTED, bumpEvent } from "../src/adapters/d1/v2Analytics";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { funnelSection, orOnboarding } from "../src/features/owner/ownerReport";

const acct = (over: Partial<FunnelAccount>): FunnelAccount => ({
  signupDate: "2026-10-01", started: false, onboarded: false, planned: false, firstWorkout: null, secondWorkout: null, ...over,
});

test("computeFunnel: each account counts at every step up to the furthest it reached", () => {
  const f = computeFunnel([
    acct({}),
    acct({ started: true }),
    acct({ started: true, onboarded: true, planned: true }),
    acct({ started: true, onboarded: true, planned: true, firstWorkout: "2026-10-03", secondWorkout: "2026-10-05" }),
  ]);
  assert.deepEqual(f.counts, [4, 3, 2, 2, 1, 1]);
});

test("computeFunnel: a later step implies the earlier ones (no 'started' event before the event existed)", () => {
  const f = computeFunnel([acct({ started: false, onboarded: false, planned: false, firstWorkout: "2026-10-02" })]);
  assert.deepEqual(f.counts, [1, 1, 1, 1, 1, 0]);
});

test("computeFunnel: a second workout more than 7 days after the first is not a return", () => {
  assert.equal(computeFunnel([acct({ firstWorkout: "2026-10-02", secondWorkout: "2026-10-09" })]).counts[5], 1, "7 days is inside");
  assert.equal(computeFunnel([acct({ firstWorkout: "2026-10-02", secondWorkout: "2026-10-10" })]).counts[5], 0, "8 days is not");
});

test("computeFunnel: median days from signup to the first workout, null when nobody trained", () => {
  assert.equal(computeFunnel([acct({})]).medianDaysToFirstWorkout, null);
  assert.equal(computeFunnel([
    acct({ firstWorkout: "2026-10-01" }), acct({ firstWorkout: "2026-10-03" }), acct({ firstWorkout: "2026-10-11" }),
  ]).medianDaysToFirstWorkout, 2);
  assert.equal(computeFunnel([acct({ firstWorkout: "2026-10-02" }), acct({ firstWorkout: "2026-10-04" })]).medianDaysToFirstWorkout, 2);
});

test("funnelSection: the 30-day column only counts recent signups", () => {
  const text = funnelSection([acct({ signupDate: "2026-09-01" }), acct({ signupDate: "2026-10-10", firstWorkout: "2026-10-12" })], "2026-09-20").join("\n");
  assert.match(text, /Signed up\s+1 \(100%\)\s+2 \(100%\)/);
  assert.match(text, /1st workout\s+1 \(100%\)\s+1 \(50%\)/);
  assert.deepEqual(funnelSection([], "2026-09-20"), [], "no accounts, no section");
});

test("funnelAccounts: reads each milestone from its table and skips banned accounts", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Trained");
  await getOrCreateUser(db, 2, 2, "en", "Draft only");
  await getOrCreateUser(db, 3, 3, "en", "Banned");
  await bumpEvent(db, 1, FUNNEL_STARTED, "2026-10-01");
  await updateUser(db, 1, { onboarded: true });
  await db.prepare("INSERT INTO v2_plans (accountId, version, status, createdAt, updatedAt) VALUES (1, 1, 'active', '2026-10-01', '2026-10-01')").run();
  await db.prepare("INSERT INTO v2_plans (accountId, version, status, createdAt, updatedAt) VALUES (2, 1, 'draft', '2026-10-01', '2026-10-01')").run();
  for (const [date, completed] of [["2026-10-02", 1], ["2026-10-03", 0], ["2026-10-05", 1]] as const) {
    await db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (1, ?, 1, ?, ?, ?)").bind(date, completed, date, date).run();
  }
  await db.prepare("INSERT INTO v2_onboarding_drafts (accountId, answers, answered, total, updatedAt) VALUES (2, '{}', 1, 10, '2026-10-01')").run();
  await updateUser(db, 3, { blocked: true });

  const rows = await funnelAccounts(db);
  assert.equal(rows.length, 2, "the banned account is left out");
  const [trained, draft] = rows;
  assert.deepEqual({ ...trained, signupDate: undefined }, { signupDate: undefined, started: true, onboarded: true, planned: true, firstWorkout: "2026-10-02", secondWorkout: "2026-10-05" },
    "an incomplete day is not a workout");
  assert.equal(draft.started, true, "a Mini App draft with an answer counts as started");
  assert.equal(draft.planned, false, "a trainer's unapproved draft is not a plan");
});

test("orOnboarding: the funnel sits above the rest, and 'All clear' still shows when nobody is stuck", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await updateUser(db, 1, { onboarded: true });
  const html = await orOnboarding(db as never);
  assert.ok(html.indexOf("Signup → first workout") < html.indexOf("Onboarding"), html);
  assert.match(html, /Signed up/);
});
