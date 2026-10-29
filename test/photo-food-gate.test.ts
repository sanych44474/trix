// The meal-photo food gate: one Clef noul ("is this food?") before the expensive vision chain.
// Only a confident "not food" (< 0.15) short-circuits; anything else, a Clef failure, an image
// Clef cannot take (not png/jpeg/webp, over 4 MiB) runs the vision chain exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { CLEF_MODEL } from "../src/ai/models";
import { CLEF_MAX_IMAGE_BYTES, isNotFoodPhoto } from "../src/features/nutrition/photoFood";
import type { Env } from "../src/types";

const jpeg = (bytes: number) => ({ mimeType: "image/jpeg", dataBase64: Buffer.alloc(bytes, 1).toString("base64") });

function clefEnv(noul: number | "throw" | "no-answer") {
  const calls: string[] = [];
  const run = async (model: string) => {
    calls.push(model);
    if (noul === "throw") throw new Error("Clef down");
    if (noul === "no-answer") return { answers: {} };
    return { answers: { food: { type: "noul", noul } }, usage: { input_tokens: 500, output_tokens: 2 } };
  };
  return { env: { AI: { run }, DB: newDb() } as unknown as Env, calls };
}

test("food gate: a confident not-food noul (< 0.15) is a not-food photo", async () => {
  const { env, calls } = clefEnv(0.05);
  assert.equal(await isNotFoodPhoto(env, jpeg(1000)), true);
  assert.deepEqual(calls, [CLEF_MODEL]);
});

test("food gate: a noul of 0.15 or more is food, so the vision chain runs", async () => {
  assert.equal(await isNotFoodPhoto(clefEnv(0.15).env, jpeg(1000)), false);
  assert.equal(await isNotFoodPhoto(clefEnv(0.9).env, jpeg(1000)), false);
});

test("food gate: a Clef failure, a timeout or a bad answer never blocks a meal", async () => {
  assert.equal(await isNotFoodPhoto(clefEnv("throw").env, jpeg(1000)), false);
  assert.equal(await isNotFoodPhoto(clefEnv("no-answer").env, jpeg(1000)), false);
});

test("food gate: an image over 4 MiB skips Clef entirely", async () => {
  const { env, calls } = clefEnv(0.01);
  assert.equal(await isNotFoodPhoto(env, jpeg(CLEF_MAX_IMAGE_BYTES + 1)), false);
  assert.deepEqual(calls, []);
});

test("food gate: an image Clef cannot take (gif, heic) skips Clef entirely", async () => {
  const { env, calls } = clefEnv(0.01);
  assert.equal(await isNotFoodPhoto(env, { mimeType: "image/gif", dataBase64: jpeg(100).dataBase64 }), false);
  assert.equal(await isNotFoodPhoto(env, { mimeType: "image/heic", dataBase64: jpeg(100).dataBase64 }), false);
  assert.deepEqual(calls, []);
});
