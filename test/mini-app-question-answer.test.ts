import { test } from "node:test";
import assert from "node:assert/strict";
import { answerToSend } from "../apps/mini-app/src/logic/questionAnswer";

test("trainer answer: an untouched AI draft is what gets sent", () => {
  assert.equal(answerToSend(undefined, "  Add 2.5 kg next session.  "), "Add 2.5 kg next session.");
});

test("trainer answer: the trainer's edit wins, and clearing the box sends nothing", () => {
  assert.equal(answerToSend("Keep the weight, add a rep.", "Add 2.5 kg."), "Keep the weight, add a rep.");
  assert.equal(answerToSend("   ", "Add 2.5 kg."), "");
  assert.equal(answerToSend(undefined, ""), "");
});
