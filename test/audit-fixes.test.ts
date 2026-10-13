// Fixes from the 2026-10 audit: a trainer sees a client's progress photos only with the client's
// "body" consent, and a user-chosen name never reaches a Telegram HTML message unescaped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { addProgressPhoto, listProgressPhotos } from "../src/adapters/d1/v2Tracking";
import { handlePhotoApi } from "../src/webapp/miscApi";
import { buildClientCardPayload } from "../src/webapp/clientCard";
import type { UserDoc } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const photoCall = (db: ReturnType<typeof newDb>, viewer: number, id: number) => {
  const p = `/api/v2/photo?id=${id}&debugUser=${viewer}`;
  return handlePhotoApi(new Request(`https://x${p}`), new URL(`https://x${p}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never, ctx);
};

async function setup(share: { body: boolean; health: boolean }) {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Тренер");
  await getOrCreateUser(db, 2, 2, "uk", "Клієнт");
  await updateUser(db, 1, { role: "trainer" } as Parameters<typeof updateUser>[2]);
  await updateUser(db, 2, { role: "client", trainerId: 1, profile: { name: "Клієнт", shareWithTrainer: share } } as Parameters<typeof updateUser>[2]);
  await addProgressPhoto(db, 2, "tg-file");
  const [photo] = await listProgressPhotos(db, 2, 1);
  return { db, photoId: photo.id };
}

test("photos: without body consent the trainer gets a 404 and an empty gallery", async () => {
  const { db, photoId } = await setup({ body: false, health: true });
  assert.equal((await photoCall(db, 1, photoId)).status, 404);
  const card = await buildClientCardPayload(db as unknown as D1Database, (await getUser(db, 1)) as UserDoc, (await getUser(db, 2)) as UserDoc);
  assert.deepEqual(card.photos, []);
});

test("photos: with body consent the trainer passes the check and sees the gallery", async () => {
  const { db, photoId } = await setup({ body: true, health: false });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch; // no Telegram here
  try {
    assert.notEqual((await photoCall(db, 1, photoId)).status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
  const card = await buildClientCardPayload(db as unknown as D1Database, (await getUser(db, 1)) as UserDoc, (await getUser(db, 2)) as UserDoc);
  assert.equal(card.photos?.length, 1);
});

test("names in HTML notifications are escaped (injury → trainer, at-risk alert, referral joined)", () => {
  for (const [file, needle] of [
    ["src/bot/injury.ts", "const who = escapeHtml(ctx.user.profile.name"],
    ["src/schedulerJobs/trainerAtRisk.ts", "const name = escapeHtml(user.profile.name"],
    ["src/scheduler.ts", "const name = escapeHtml(user.profile.name"],
  ] as const) {
    assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes(needle), file);
  }
});
