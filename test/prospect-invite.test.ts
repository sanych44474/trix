// Personal client invite (Phase 5, item 5) — a trainer names someone who hasn't opened Telegram
// yet, gets a one-time deep link, and /start trp_<code> auto-pairs + pre-fills the name. Real
// in-memory D1 + fake ctx, same pattern as handlers.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { applyTrainer, approveTrainer, getOrCreateUser, getUser, updateUser } from "../src/db/repos";
import { getProspect, listProspects } from "../src/db/repos/trainer";
import { handleProspectName, joinByCode, joinByProspectCode, startProspectInvite } from "../src/bot/trainer";
import type { UserDoc } from "../src/types";

async function setupApprovedTrainer(db: ReturnType<typeof newDb>, tid = 300) {
  const trainer = (await getOrCreateUser(db, tid, tid, "uk", "Coach")) as unknown as UserDoc;
  await updateUser(db, tid, { role: "trainer" });
  await applyTrainer(db, tid, { name: "Coach" });
  await approveTrainer(db, tid, `code${tid}`);
  return trainer;
}

test("startProspectInvite + handleProspectName: creates a prospect and sends the link", async () => {
  const db = newDb();
  const trainer = await setupApprovedTrainer(db);
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await startProspectInvite(ctx as never);
  await handleProspectName(ctx as never, "Jane");

  assert.equal(sent.length, 2); // the name prompt, then the link
  assert.match(sent[1].text, /Jane/);
  const reloaded = await getUser(db, 300);
  assert.equal(reloaded?.session.mode, "idle"); // handleProspectName resets the mode
});

test("joinByProspectCode: pairs the client, pre-fills the trainer's name, consumes the code", async () => {
  const db = newDb();
  const trainer = await setupApprovedTrainer(db);
  const { ctx: trainerCtx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await startProspectInvite(trainerCtx as never);
  await handleProspectName(trainerCtx as never, "Jane");

  // Pull the code back out the same way the trainer's link would carry it.
  const client = (await getOrCreateUser(db, 400, 400, "en", "SomeTelegramHandle")) as unknown as UserDoc;
  const prospects = await listProspects(db, 300);
  assert.equal(prospects.length, 1);
  const code = prospects[0].code;

  const { ctx: clientCtx } = makeCtx(db, client as unknown as Record<string, unknown>);
  await joinByProspectCode(clientCtx as never, code);

  const reloadedClient = await getUser(db, 400);
  assert.equal(reloadedClient?.role, "client");
  assert.equal(reloadedClient?.trainerId, 300);
  assert.equal(reloadedClient?.profile.name, "Jane"); // trainer's own name wins
  assert.equal(await getProspect(db, code), null); // single-use, consumed
});

test("joinByProspectCode: an unknown/already-used code shows code_invalid, doesn't crash", async () => {
  const db = newDb();
  await getOrCreateUser(db, 401, 401, "en", "Bob");
  const client = (await getUser(db, 401)) as unknown as UserDoc;
  const { ctx, sent } = makeCtx(db, client as unknown as Record<string, unknown>);

  await joinByProspectCode(ctx as never, "not-a-real-code");

  assert.equal(sent.length, 1);
  const reloaded = await getUser(db, 401);
  assert.equal(reloaded?.role, "solo"); // unchanged
});

test("joinByProspectCode: a raced double-claim of the same code pairs exactly one caller", async () => {
  // Simulates a duplicate Telegram webhook delivery (or two people opening the same personal
  // link) racing the same still-present prospect row — deleteProspect()'s atomic DELETE is the
  // gate that must let exactly one of them through.
  const db = newDb();
  const trainer = await setupApprovedTrainer(db, 300);
  const { ctx: trainerCtx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await startProspectInvite(trainerCtx as never);
  await handleProspectName(trainerCtx as never, "Jane");
  const code = (await listProspects(db, 300))[0].code;

  const a = (await getOrCreateUser(db, 500, 500, "en", "A")) as unknown as UserDoc;
  const b = (await getOrCreateUser(db, 501, 501, "en", "B")) as unknown as UserDoc;
  const { ctx: ctxA, sent: sentA } = makeCtx(db, a as unknown as Record<string, unknown>);
  const { ctx: ctxB, sent: sentB } = makeCtx(db, b as unknown as Record<string, unknown>);

  await Promise.all([joinByProspectCode(ctxA as never, code), joinByProspectCode(ctxB as never, code)]);

  const [reloadedA, reloadedB] = await Promise.all([getUser(db, 500), getUser(db, 501)]);
  const paired = [reloadedA, reloadedB].filter((u) => u?.role === "client");
  assert.equal(paired.length, 1, "exactly one racer should have been paired, not zero or two");
  // The loser got a reply (code_invalid) but was never paired.
  assert.equal(sentA.length >= 1 && sentB.length >= 1, true);
});

test("joinByCode still pairs correctly (regression: shared pairWithTrainer refactor)", async () => {
  const db = newDb();
  await setupApprovedTrainer(db, 300);
  const client = (await getOrCreateUser(db, 402, 402, "en", "Carl")) as unknown as UserDoc;
  const { ctx } = makeCtx(db, client as unknown as Record<string, unknown>);

  await joinByCode(ctx as never, "code300");

  const reloaded = await getUser(db, 402);
  assert.equal(reloaded?.role, "client");
  assert.equal(reloaded?.trainerId, 300);
  assert.equal(reloaded?.profile.name, "Carl"); // untouched — no prospect involved
});
