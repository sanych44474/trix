import { test } from "node:test";
import assert from "node:assert/strict";
import { firstClientProgress } from "../apps/mini-app/src/logic/firstClient";

test("the checklist names the next step on the first-client path", () => {
  assert.equal(firstClientProgress([], 0).next, "invite");
  assert.equal(firstClientProgress([], 2).next, "joined");
  assert.equal(firstClientProgress([{ id: 1, onboarded: false, plan: "none" }], 1).next, "intake");
  const draft = firstClientProgress([{ id: 7, onboarded: true, plan: "draft" }], 1);
  assert.equal(draft.next, "assigned");
  assert.equal(draft.draftClientId, 7);
  assert.equal(firstClientProgress([{ id: 1, onboarded: true, plan: "active" }], 0).next, null);
});
