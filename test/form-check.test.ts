import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_CHECKS_PER_DAY, MAX_VIDEO_BYTES, formCheckGate, formCheckSystem } from "../src/bot/formCheck";

test("form check gate: size and length before the daily quota", () => {
  assert.equal(formCheckGate({ bytes: 5_000_000, seconds: 20 }, 0), "ok");
  assert.equal(formCheckGate({ bytes: MAX_VIDEO_BYTES + 1, seconds: 20 }, 0), "too_big");
  assert.equal(formCheckGate({ bytes: 1_000, seconds: 90 }, FORM_CHECKS_PER_DAY), "too_long", "a bad clip doesn't read as over quota");
  assert.equal(formCheckGate({ bytes: 1_000, seconds: 10 }, FORM_CHECKS_PER_DAY), "limit");
  assert.equal(formCheckGate({}, 0), "ok", "Telegram may omit size/duration; the download is re-checked");
});

test("form check prompt: user's language, visible-only remarks, no medical advice", () => {
  assert.match(formCheckSystem("uk"), /Ukrainian/);
  assert.match(formCheckSystem("en"), /English/);
  assert.match(formCheckSystem("uk"), /Never diagnose/);
  assert.match(formCheckSystem("uk"), /actually visible/);
});
