// One-time codes and match codes: uniform digits from the CSPRNG (no modulo bias), right length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBelow, randomDigits } from "../src/domain/secrets";
import { telegramHtmlToPlain } from "../src/domain/plainText";

test("randomBelow stays in range and reaches both ends", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const n = randomBelow(10);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 10);
    seen.add(n);
  }
  assert.equal(seen.size, 10);
});

test("randomDigits pads to the requested length", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomDigits(6), /^\d{6}$/);
    assert.match(randomDigits(4), /^\d{4}$/);
  }
});

test("telegramHtmlToPlain leaves no tag even when markup is nested or split", () => {
  assert.equal(telegramHtmlToPlain("<scr<b>ipt>alert(1)</scr</b>ipt>"), "alert(1)");
  assert.equal(telegramHtmlToPlain("<b>Leg day</b> &amp; core"), "Leg day & core");
});
