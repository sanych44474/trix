// The Mini App's media endpoints (meal photo, form check, voice) and the meal-photo logging step.
// The AI calls themselves need the network; these pin the gates in front of them (auth, missing
// or oversized files, the form-check length/size/quota gate) and the add_items validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getDayMeals } from "../src/adapters/d1/v2Nutrition";
import { localParts } from "../src/domain/localTime";
import { handleMediaApi, MAX_PHOTO_BYTES } from "../src/webapp/mediaApi";
import { handleNutritionApi } from "../src/webapp/nutritionApi";
import { fitWithin, mp4Seconds, reweigh, sumMeal, videoCheck, pickAudioType, MAX_VIDEO_BYTES } from "../apps/mini-app/src/logic/media";

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" }) as never;

async function upload(db: ReturnType<typeof newDb>, userId: number | null, path: string, fields: Record<string, Blob | string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const full = `${path}${userId ? `?debugUser=${userId}` : ""}`;
  return handleMediaApi(new Request(`https://x${full}`, { method: "POST", body: form }), new URL(`https://x${full}`), env(db));
}

async function nutrition(db: ReturnType<typeof newDb>, userId: number, body: unknown) {
  const full = `/api/nutrition?debugUser=${userId}`;
  return handleNutritionApi(new Request(`https://x${full}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), new URL(`https://x${full}`), env(db));
}

test("media: unauthorized without a user", async () => {
  const res = await upload(newDb(), null, "/api/media/meal-photo", { photo: new Blob(["x"]) });
  assert.equal(res.status, 401);
});

test("meal photo: a missing or oversized photo is rejected before any AI call", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await upload(db, 1, "/api/media/meal-photo", {})).status, 400);
  const big = new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type: "image/jpeg" });
  const res = await upload(db, 1, "/api/media/meal-photo", { photo: big });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "too_big" });
});

test("form check: a clip over 60 s is turned away with its reason", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await upload(db, 1, "/api/media/form-check", { video: new Blob(["v"], { type: "video/mp4" }), seconds: "95" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { reason: string }).reason, "too_long");
});

test("form check: the daily quota counts successful checks", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const now = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    await db.prepare("INSERT INTO v2_ai_calls (accountId, kind, provider, latencyMs, ok, createdAt) VALUES (1, 'form_check', 'gemini', 100, 1, ?)").bind(now).run();
  }
  const res = await upload(db, 1, "/api/media/form-check", { video: new Blob(["v"], { type: "video/mp4" }), seconds: "20" });
  assert.equal(((await res.json()) as { reason: string }).reason, "limit");
});

test("transcribe: no audio → 400; no speech backend → 502, not a crash", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await upload(db, 1, "/api/media/transcribe", {})).status, 400);
  assert.equal((await upload(db, 1, "/api/media/transcribe", { audio: new Blob(["a"], { type: "audio/webm" }) })).status, 502);
});

test("add_items: logs the confirmed photo items for today", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await nutrition(db, 1, { action: "add_items", items: [
    { desc: "Rice", kcal: 260, protein: 5, fats: 0.6, carbs: 57, grams: 200, query: "rice cooked" },
    { desc: "Chicken", kcal: 248, protein: 46, fats: 5.4, carbs: 0, grams: 150 },
  ] });
  assert.equal(res.status, 200);
  const meals = await getDayMeals(db, 1, localParts(undefined).date);
  assert.deepEqual(meals.map((m) => [m.desc, m.kcal, m.grams]), [["Rice", 260, 200], ["Chicken", 248, 150]]);
});

test("add_items: out-of-range macros or an empty list are rejected", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await nutrition(db, 1, { action: "add_items", items: [] })).status, 400);
  assert.equal((await nutrition(db, 1, { action: "add_items", items: [{ desc: "X", kcal: 99999, protein: 1, fats: 1, carbs: 1 }] })).status, 400);
  assert.equal((await nutrition(db, 1, { action: "add_items", items: [{ desc: "", kcal: 100, protein: 1, fats: 1, carbs: 1 }] })).status, 400);
});

test("mini app media logic: re-weighing scales macros; unknown weight stays", () => {
  const rice = { desc: "Rice", kcal: 260, protein: 5, fats: 0.6, carbs: 57, grams: 200 };
  assert.deepEqual(reweigh(rice, 100), { ...rice, grams: 100, kcal: 130, protein: 2.5, fats: 0.3, carbs: 28.5 });
  const soup = { desc: "Soup", kcal: 200, protein: 8, fats: 6, carbs: 20 };
  assert.equal(reweigh(soup, 300), soup);
  assert.equal(reweigh(rice, 0), rice);
  assert.deepEqual(sumMeal([rice, soup]), { kcal: 460, protein: 13, fats: 6.6, carbs: 77 });
});

test("mini app media logic: image fit, video gate, recorder type", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.equal(videoCheck(MAX_VIDEO_BYTES + 1, 10), "too_big");
  assert.equal(videoCheck(1000, 75), "too_long");
  assert.equal(videoCheck(1000, undefined), "ok");
  assert.equal(pickAudioType((t) => t === "audio/mp4"), "audio/mp4");
  assert.equal(pickAudioType(() => false), undefined);
});

function mvhdBox(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(version === 1 ? 108 : 96);
  const v = new DataView(body.buffer);
  v.setUint8(0, version);
  if (version === 1) { v.setUint32(20, timescale); v.setBigUint64(24, BigInt(duration)); }
  else { v.setUint32(12, timescale); v.setUint32(16, duration); }
  const box = new Uint8Array(8 + body.length + 16);
  new DataView(box.buffer).setUint32(16, 8 + body.length);
  box.set([0x6d, 0x76, 0x68, 0x64], 20); // "mvhd" after 16 bytes of other data
  box.set(body, 24);
  return box;
}

test("mini app media logic: clip length from the MP4/MOV movie header", () => {
  assert.equal(mp4Seconds(mvhdBox(0, 600, 27_000)), 45);
  assert.equal(mp4Seconds(mvhdBox(1, 1000, 95_500)), 95.5);
  assert.equal(mp4Seconds(new Uint8Array(200)), undefined, "no header -> unknown, the server's size cap still applies");
});
