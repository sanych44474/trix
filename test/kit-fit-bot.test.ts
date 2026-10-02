import { test } from "node:test";
import assert from "node:assert/strict";
import { isEquipmentTalk, statedKit } from "../src/bot/kitFit";

test("coach chat: equipment talk and the kit a message states", () => {
  // The exact situation from user feedback: dumbbells at home, a plan full of barbell work.
  assert.ok(isEquipmentTalk("я вказав що маю тільки гантелі, а тут штанга"));
  assert.equal(statedKit("я вказав що маю тільки гантелі, а тут штанга"), "dumbbells");
  assert.ok(isEquipmentTalk("замініть вправи зі штангою"));
  assert.equal(statedKit("замініть вправи зі штангою"), null, "mentions a barbell, doesn't state a kit");
  assert.equal(statedKit("тренуюсь вдома, є гантелі і гуми"), "home");
  assert.equal(statedKit("в мене нічого немає, тільки власна вага"), "bodyweight");
  assert.equal(statedKit("I only have dumbbells"), "dumbbells");
  assert.ok(!isEquipmentTalk("як покращити сон?"));
});
