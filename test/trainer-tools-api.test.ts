import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser, getUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { applyTrainer, approveTrainer, linkClient, updateTrainer } from "../src/adapters/d1/v2Trainer";
import { saveTrainerTemplate, listPublicPrograms, getSharedProgram } from "../src/adapters/d1/v2TrainerPrograms";
import { getActivePlan } from "../src/adapters/d1/v2Plans";
import { handleTrainerApi } from "../src/webapp/trainerApi";
import { handleOwnerApi } from "../src/webapp/ownerApi";
import type { BankPlan } from "../src/types";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function trainerCall(db: ReturnType<typeof newDb>, userId: number, method: string, path: string, body?: unknown) {
  const full = `${path}?debugUser=${userId}`;
  return handleTrainerApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", BOT_USERNAME: "hack_limits_test" } as never);
}
async function ownerCall(db: ReturnType<typeof newDb>, userId: number, method: string, path: string, body?: unknown) {
  const full = `${path}?debugUser=${userId}`;
  return handleOwnerApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}
function stubFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
async function trainerWithClient(db: ReturnType<typeof newDb>, instructor: boolean) {
  await getOrCreateUser(db, 10, 10, "en", "Coach");
  await updateUser(db, 10, { role: "trainer" });
  await applyTrainer(db, 10, { name: "Coach" });
  await approveTrainer(db, 10, "code10");
  if (instructor) await updateTrainer(db, 10, { isInstructor: true });
  await getOrCreateUser(db, 20, 20, "en", "Cli");
  await updateUser(db, 20, { role: "client", trainerId: 10, onboarded: true });
  await linkClient(db, 20, 10);
}
const PLAN = { split: [{ weekday: 1, muscleGroup: "Push", exercises: [] }], nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "" } as unknown as BankPlan;

test("trainer report: refused for a non-trainer, structured rows for a trainer", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Solo");
  assert.equal((await trainerCall(db, 1, "GET", "/api/trainer/report")).status, 403);

  await trainerWithClient(db, false);
  const res = await trainerCall(db, 10, "GET", "/api/trainer/report");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { clientCount: number; rows: { id: number; plan: { active: boolean } }[] };
  assert.equal(body.clientCount, 1);
  assert.deepEqual(body.rows.map((r) => r.id), [20]);
  assert.equal(body.rows[0]!.plan.active, false);
});

test("share template: a trainer without the instructor grant is refused", async () => {
  const db = newDb();
  await trainerWithClient(db, false);
  const tplId = await saveTrainerTemplate(db, 10, "PPL", PLAN);
  const res = await trainerCall(db, 10, "POST", "/api/trainer/share/template", { templateId: tplId, mode: "library" });
  assert.equal(res.status, 403);
});

test("share template: library publishes a public program; link returns a bot deep link", async () => {
  const db = newDb();
  await trainerWithClient(db, true);
  const tplId = await saveTrainerTemplate(db, 10, "PPL", PLAN);

  const lib = await trainerCall(db, 10, "POST", "/api/trainer/share/template", { templateId: tplId, mode: "library" });
  assert.equal(lib.status, 200);
  const libBody = (await lib.json()) as { code: string; link?: string };
  assert.equal(libBody.link, undefined);
  assert.ok((await listPublicPrograms(db, 20)).some((p) => p.code === libBody.code));

  const link = await trainerCall(db, 10, "POST", "/api/trainer/share/template", { templateId: tplId, mode: "link" });
  const linkBody = (await link.json()) as { code: string; link: string };
  assert.ok(linkBody.link.includes(`prog_${linkBody.code}`));
  assert.ok(await getSharedProgram(db, linkBody.code));
});

test("share plan: publishes the trainer's own active plan; 404 without one", async () => {
  const db = newDb();
  await trainerWithClient(db, true);
  const none = await trainerCall(db, 10, "POST", "/api/trainer/share/plan", { name: "Mine" });
  assert.equal(none.status, 404);
  const bad = await trainerCall(db, 10, "POST", "/api/trainer/share/plan", { name: "   " });
  assert.equal(bad.status, 400);
});

test("share assign: activates the template for the selected client only", async () => {
  const db = newDb();
  await trainerWithClient(db, true);
  const tplId = await saveTrainerTemplate(db, 10, "PPL", PLAN);
  const unstub = stubFetch();
  try {
    const res = await trainerCall(db, 10, "POST", "/api/trainer/share/assign", { templateId: tplId, clientIds: [20] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, assigned: 1, total: 1 });
  } finally {
    unstub();
  }
  assert.ok(await getActivePlan(db, 20));

  // A client that isn't this trainer's is not selectable.
  const none = await trainerCall(db, 10, "POST", "/api/trainer/share/assign", { templateId: tplId, clientIds: [999] });
  assert.equal(none.status, 400);
});

test("owner cleanup: opaque 404 for a non-owner; preview then confirm purges inactive users", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Owner");
  await setOwnerChatId(db, 5);
  await getOrCreateUser(db, 40, 40, "en", "Stale");
  await updateUser(db, 40, { lastSeenAt: new Date(Date.now() - 30 * 86_400_000) });
  await getOrCreateUser(db, 41, 41, "en", "Impostor");

  assert.equal((await ownerCall(db, 41, "POST", "/api/owner/cleanup", {})).status, 404);

  const preview = await ownerCall(db, 5, "POST", "/api/owner/cleanup", {});
  assert.equal(preview.status, 200);
  assert.equal(((await preview.json()) as { count: number }).count, 1);
  assert.ok(await getUser(db, 40));

  const confirm = await ownerCall(db, 5, "POST", "/api/owner/cleanup", { confirm: true });
  assert.equal(((await confirm.json()) as { deleted: number }).deleted, 1);
  assert.ok(!(await getUser(db, 40)));
});
