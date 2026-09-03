import { test } from "node:test";
import assert from "node:assert/strict";
import { maxHr, zoneBpm, cardioTemplateByKey, CARDIO_TEMPLATES } from "../src/domain/cardioPlan";

test("maxHr: Fox formula with a floor", () => {
  assert.equal(maxHr(30), 190);
  assert.equal(maxHr(20), 200);
  assert.equal(maxHr(90), 150); // floored
});

test("zoneBpm: zone ranges scale with age", () => {
  const z2 = zoneBpm(30, 2); // 60-70% of 190
  assert.equal(z2.lo, 114);
  assert.equal(z2.hi, 133);
  const z5 = zoneBpm(30, 5);
  assert.equal(z5.hi, 190);
});

test("cardio templates: keys resolve and have steps", () => {
  for (const tpl of CARDIO_TEMPLATES) {
    assert.equal(cardioTemplateByKey(tpl.key)?.key, tpl.key);
    assert.ok(tpl.steps.length >= 1);
    assert.ok(tpl.steps.every((s) => s.zone >= 1 && s.zone <= 5));
  }
  assert.equal(cardioTemplateByKey("nope"), undefined);
});
