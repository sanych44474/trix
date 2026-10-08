import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  ACTIVATE_H, POSTPONED_ACTIVATE_H, REMIND_H, WARN_BEFORE_H,
  autoActivationFor, postponeAutoActivation, staleDraftStep, sweepStaleDrafts,
} from "../src/staleDrafts";
import { getOrphanDraft, updateDraftSplit } from "../src/adapters/d1/v2Plans";

const H = 3_600_000;
const WARN_AT = ACTIVATE_H - WARN_BEFORE_H;

test("staleDraftStep: wait, remind once, warn once, then activate; no trainer activates at once", () => {
  assert.equal(staleDraftStep(REMIND_H - 1, true, {}), null);
  assert.equal(staleDraftStep(REMIND_H, true, {}), "remind");
  assert.equal(staleDraftStep(REMIND_H + 5, true, { reminded: "x" }), null);
  assert.equal(staleDraftStep(WARN_AT, true, { reminded: "x" }), "warn");
  assert.equal(staleDraftStep(WARN_AT + 1, true, { reminded: "x", warned: "y" }), null);
  assert.equal(staleDraftStep(ACTIVATE_H, true, { reminded: "x", warned: "y" }), "activate");
  assert.equal(staleDraftStep(ACTIVATE_H, true, {}), "activate");
  assert.equal(staleDraftStep(0, false, {}), "activate");
});

test("staleDraftStep: a missed reminder is skipped once the final warning is due", () => {
  // A cron outage must not send "waiting a day" at hour 70 right before the final warning.
  assert.equal(staleDraftStep(WARN_AT + 2, true, {}), "warn");
});

test("staleDraftStep: one postponement moves the deadline to six days and is silent until then", () => {
  const s = { reminded: "x", warned: "y", postponed: "z" };
  assert.equal(staleDraftStep(ACTIVATE_H, true, s), null, "no longer activates at three days");
  assert.equal(staleDraftStep(POSTPONED_ACTIVATE_H - 1, true, s), null);
  assert.equal(staleDraftStep(POSTPONED_ACTIVATE_H, true, s), "activate");
  assert.equal(staleDraftStep(0, false, s), "activate", "a client whose trainer left still gets the plan at once");
});

// ---- sweep against the in-memory D1 ----

type Db = ReturnType<typeof newDb>;
let nextId = 9000;
async function account(db: Db, role: string, opts: { blocked?: boolean } = {}): Promise<number> {
  const id = nextId++;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, blocked, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)").bind(id, id, id, role, opts.blocked ? 1 : 0, now, now),
    db.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (?, 'en', ?, ?)").bind(id, `u${id}`, now),
  ]);
  return id;
}
async function link(db: Db, client: number, trainer: number) {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO v2_trainer_relationships (clientId, trainerId, status, createdAt, updatedAt) VALUES (?, ?, 'active', ?, ?)").bind(client, trainer, now, now).run();
}
async function draft(db: Db, accountId: number, createdAt: string, status: "draft" | "active" = "draft", version = 1) {
  await db.prepare("INSERT INTO v2_plans (accountId, version, status, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(accountId, version, status, status === "active" ? 1 : 0, createdAt, createdAt).run();
}
// Rows from node:sqlite have a null prototype; copy them so deepEqual compares plain objects.
const planStatus = async (db: Db, accountId: number) =>
  ((await db.prepare("SELECT status, active FROM v2_plans WHERE accountId = ? ORDER BY version DESC").bind(accountId).all<{ status: string; active: number }>()).results ?? [])
    .map((r) => ({ status: r.status, active: r.active }));

function recorder(opts: { failFor?: (chatId: number, text: string) => boolean } = {}) {
  const sent: Array<[number, string]> = [];
  const send = async (chatId: number, text: string) => {
    if (opts.failFor?.(chatId, text)) throw new Error("telegram down");
    sent.push([chatId, text]);
  };
  return { sent, send };
}

test("sweep: reminder at a day, one final warning, activation at three days; progression proposals untouched", async () => {
  const db = newDb();
  const now = Date.parse("2026-10-08T12:00:00Z");
  const trainer = await account(db, "trainer");
  const a = await account(db, "client"), b = await account(db, "client"), c = await account(db, "client");
  for (const id of [a, b, c]) await link(db, id, trainer);
  await draft(db, a, new Date(now - 30 * H).toISOString()); // a day old
  await draft(db, b, new Date(now - 80 * H).toISOString()); // past three days
  await draft(db, c, new Date(now - 200 * H).toISOString(), "active", 1);
  await draft(db, c, new Date(now - 200 * H).toISOString(), "draft", 2); // proposal beside an active plan

  const { sent, send } = recorder();
  assert.deepEqual(await sweepStaleDrafts(db, send, now), { reminded: 1, warned: 0, activated: 1 });
  assert.deepEqual(await planStatus(db, b), [{ status: "active", active: 1 }]);
  assert.deepEqual((await planStatus(db, c))[0], { status: "draft", active: 0 });

  // 38 h later the first draft is 68 h old: the final warning, once.
  assert.deepEqual(await sweepStaleDrafts(db, send, now + 38 * H), { reminded: 0, warned: 1, activated: 0 });
  assert.deepEqual(await sweepStaleDrafts(db, send, now + 39 * H), { reminded: 0, warned: 0, activated: 0 }, "the warning is not repeated");
  assert.ok(sent.some(([chat, text]) => chat === trainer && /Wait 3 more days/.test(text)), "the warning names the postponement");

  assert.deepEqual(await sweepStaleDrafts(db, send, now + 45 * H), { reminded: 0, warned: 0, activated: 1 });
  assert.deepEqual(await planStatus(db, a), [{ status: "active", active: 1 }]);
});

test("sweep: after the one postponement the draft waits for six days, then activates", async () => {
  const db = newDb();
  const created = Date.parse("2026-10-01T00:00:00Z");
  const trainer = await account(db, "trainer");
  const client = await account(db, "client");
  await link(db, client, trainer);
  await draft(db, client, new Date(created).toISOString());
  const { send } = recorder();

  await sweepStaleDrafts(db, send, created + 30 * H); // reminder
  assert.equal(await postponeAutoActivation(db, client, created + 31 * H), "ok");
  assert.equal(await postponeAutoActivation(db, client, created + 32 * H), "already_used", "only once");

  assert.deepEqual(await sweepStaleDrafts(db, send, created + 80 * H), { reminded: 0, warned: 0, activated: 0 }, "past three days but postponed");
  assert.deepEqual(await planStatus(db, client), [{ status: "draft", active: 0 }]);
  assert.deepEqual(await sweepStaleDrafts(db, send, created + 145 * H), { reminded: 0, warned: 0, activated: 1 });
  assert.deepEqual(await planStatus(db, client), [{ status: "active", active: 1 }]);
});

test("sweep: a reminder that failed to send is not recorded as sent and is retried", async () => {
  const db = newDb();
  const now = Date.parse("2026-10-08T12:00:00Z");
  const trainer = await account(db, "trainer");
  const client = await account(db, "client");
  await link(db, client, trainer);
  await draft(db, client, new Date(now - 30 * H).toISOString());

  const failing = recorder({ failFor: (chat) => chat === trainer });
  assert.deepEqual(await sweepStaleDrafts(db, failing.send, now), { reminded: 0, warned: 0, activated: 0 });
  const working = recorder();
  assert.deepEqual(await sweepStaleDrafts(db, working.send, now + H), { reminded: 1, warned: 0, activated: 0 }, "retried on the next pass");
  assert.deepEqual(await sweepStaleDrafts(db, working.send, now + 2 * H), { reminded: 0, warned: 0, activated: 0 }, "then sent once");
});

test("sweep: reminders recorded by the older format (a bare timestamp) still count as sent", async () => {
  const db = newDb();
  const now = Date.parse("2026-10-08T12:00:00Z");
  const trainer = await account(db, "trainer");
  const client = await account(db, "client");
  await link(db, client, trainer);
  await draft(db, client, new Date(now - 30 * H).toISOString());
  const plan = await getOrphanDraft(db, client);
  await db.prepare("INSERT INTO v2_settings (key, value) VALUES ('stale_draft_reminders', ?)").bind(JSON.stringify({ [String(plan!.planId)]: "2026-10-07T12:00:00.000Z" })).run();
  const { send } = recorder();
  assert.deepEqual(await sweepStaleDrafts(db, send, now), { reminded: 0, warned: 0, activated: 0 });
});

test("sweep: blocked clients cannot crowd healthy ones out of the bounded query", async () => {
  const db = newDb();
  const now = Date.parse("2026-10-08T12:00:00Z");
  const trainer = await account(db, "trainer");
  // 60 blocked clients with the OLDEST drafts, then one healthy client with a newer one.
  for (let i = 0; i < 60; i++) {
    const id = await account(db, "client", { blocked: true });
    await link(db, id, trainer);
    await draft(db, id, new Date(now - (200 + i) * H).toISOString());
  }
  const healthy = await account(db, "client");
  await link(db, healthy, trainer);
  await draft(db, healthy, new Date(now - 80 * H).toISOString());
  const { send } = recorder();
  assert.deepEqual(await sweepStaleDrafts(db, send, now), { reminded: 0, warned: 0, activated: 1 });
  assert.deepEqual(await planStatus(db, healthy), [{ status: "active", active: 1 }]);
});

test("autoActivationFor: reports the deadline, extended by one postponement; null without a waiting draft", async () => {
  const db = newDb();
  const created = Date.parse("2026-10-01T00:00:00Z");
  const trainer = await account(db, "trainer");
  const client = await account(db, "client");
  await link(db, client, trainer);
  assert.equal(await autoActivationFor(db, client), null);
  await draft(db, client, new Date(created).toISOString());
  assert.deepEqual(await autoActivationFor(db, client), { activatesAt: new Date(created + ACTIVATE_H * H).toISOString(), postponed: false });
  await postponeAutoActivation(db, client);
  assert.deepEqual(await autoActivationFor(db, client), { activatesAt: new Date(created + POSTPONED_ACTIVATE_H * H).toISOString(), postponed: true });
  assert.equal(await postponeAutoActivation(db, 123456), "no_draft");
});

test("editing a draft moves updatedAt (the plan's single 'last touched' answer)", async () => {
  const db = newDb();
  const trainer = await account(db, "trainer");
  const client = await account(db, "client");
  await link(db, client, trainer);
  await draft(db, client, "2026-10-01T00:00:00.000Z");
  const before = await db.prepare("SELECT updatedAt FROM v2_plans WHERE accountId = ?").bind(client).first<{ updatedAt: string }>();
  const split = [{ weekday: 1, muscleGroup: "Legs", exercises: [{ name: "Squat", sets: "3x5", startWeight: "", technique: "" }] }];
  await updateDraftSplit(db, client, split);
  const after = await db.prepare("SELECT updatedAt FROM v2_plans WHERE accountId = ?").bind(client).first<{ updatedAt: string }>();
  assert.notEqual(after!.updatedAt, before!.updatedAt);
  assert.ok(Date.parse(after!.updatedAt) > Date.parse(before!.updatedAt));
  const written = await db.prepare("SELECT COUNT(*) AS n FROM v2_plan_exercises WHERE name = 'Squat'").first<{ n: number }>();
  assert.equal(written!.n, 1, "the edit itself still lands");
});
