import { test } from "node:test";
import assert from "node:assert/strict";
import { bodySignalFrom } from "../src/domain/bodySignal";

test("pain at or above 0.75 with an injury severity (confidence >= 0.6) is an injury signal", () => {
  assert.deepEqual(bodySignalFrom(0.75, { choice: "injury", confidence: 0.6 }), { kind: "injury" });
  assert.deepEqual(bodySignalFrom(0.95, { choice: "injury", confidence: 0.9 }), { kind: "injury" });
});

test("pain at or above 0.75 with an urgent severity (confidence >= 0.5) is an urgent signal", () => {
  assert.deepEqual(bodySignalFrom(0.75, { choice: "urgent", confidence: 0.5 }), { kind: "urgent" });
  assert.deepEqual(bodySignalFrom(0.99, { choice: "urgent", confidence: 0.8 }), { kind: "urgent" });
});

test("below the pain threshold there is no signal, whatever the severity", () => {
  assert.equal(bodySignalFrom(0.74, { choice: "injury", confidence: 0.99 }), null);
  assert.equal(bodySignalFrom(0.74, { choice: "urgent", confidence: 0.99 }), null);
});

test("an injury under its confidence floor is not a signal", () => {
  assert.equal(bodySignalFrom(0.9, { choice: "injury", confidence: 0.59 }), null);
});

test("an urgent answer under its confidence floor is not a signal", () => {
  assert.equal(bodySignalFrom(0.9, { choice: "urgent", confidence: 0.49 }), null);
});

test("mild soreness never produces a signal", () => {
  assert.equal(bodySignalFrom(0.95, { choice: "mild", confidence: 0.99 }), null);
});

test("missing answers or a missing confidence produce no signal", () => {
  assert.equal(bodySignalFrom(null, { choice: "injury", confidence: 0.9 }), null);
  assert.equal(bodySignalFrom(0.9, null), null);
  assert.equal(bodySignalFrom(0.9, { choice: "injury" }), null);
});
