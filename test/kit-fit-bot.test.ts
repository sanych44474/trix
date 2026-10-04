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

test("statedKit: a passing mention or a barbell owner is not a kit change", () => {
  assert.equal(statedKit("сьогодні тренувався вдома, все ок"), null);
  assert.equal(statedKit("в мене є штанга і гантелі"), null);
  assert.equal(statedKit("у мене вдома гантелі"), "home");
  assert.equal(statedKit("я тренуюсь вдома"), "home");
  assert.equal(statedKit("нема залу поруч"), "home");
  assert.equal(statedKit("маю гантелі, без штанги"), "dumbbells");
});
