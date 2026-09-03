import { test } from "node:test";
import assert from "node:assert/strict";
import { switchMode, unsavedLogCount, SESSION_CONTEXT_KEYS } from "../src/domain/session";
import type { UserSession } from "../src/types";

test("switchMode carries every context field across a mode change", () => {
  const s: UserSession = {
    mode: "log",
    editPlanOwner: 42,
    editPlanPrefix: "cl",
    photoReviewFor: 7,
    logDraft: { weekday: 1, entries: [{ name: "Bench", setsDone: [{ weight: 80, reps: 8 }] }] },
  };
  const next = switchMode(s, "nutrition");
  assert.equal(next.mode, "nutrition");
  assert.equal(next.editPlanOwner, 42);
  assert.equal(next.editPlanPrefix, "cl");
  assert.equal(next.photoReviewFor, 7);
});

test("switchMode drops ALL transient flow state (no leak into the next screen)", () => {
  const s: UserSession = {
    mode: "log",
    logDraft: { weekday: 1, entries: [{ name: "Bench", setsDone: [{ weight: 80, reps: 8 }] }] },
    targetId: 999,
    coachActions: [{ label: "x", kind: "none" }],
    pendingExitResume: "menu:nutrition",
  };
  const next = switchMode(s, "coach");
  assert.equal(next.logDraft, undefined);
  assert.equal(next.targetId, undefined);
  assert.equal(next.coachActions, undefined);
  assert.equal(next.pendingExitResume, undefined);
});

test("switchMode applies extra flow fields for the new mode", () => {
  const next = switchMode({ mode: "idle", editPlanOwner: 5, editPlanPrefix: "ou" }, "weight_edit", { targetId: 3005 });
  assert.equal(next.mode, "weight_edit");
  assert.equal(next.targetId, 3005);
  assert.equal(next.editPlanOwner, 5); // context still preserved alongside extra
  assert.equal(next.editPlanPrefix, "ou");
});

test("switchMode omits absent context fields (no undefined keys)", () => {
  const next = switchMode({ mode: "idle" }, "log");
  assert.deepEqual(next, { mode: "log" });
});

test("context keys list stays tiny and intentional", () => {
  assert.deepEqual([...SESSION_CONTEXT_KEYS], ["editPlanOwner", "editPlanPrefix", "photoReviewFor", "photoSelf"]);
});

test("unsavedLogCount: only a log with entered exercises is at risk", () => {
  assert.equal(unsavedLogCount({ mode: "log", logDraft: { weekday: 1, entries: [{ name: "A", setsDone: [] }, { name: "B", setsDone: [] }] } }), 2);
  assert.equal(unsavedLogCount({ mode: "log", logDraft: { weekday: 1, entries: [] } }), null); // opened but nothing entered
  assert.equal(unsavedLogCount({ mode: "nutrition", logDraft: { weekday: 1, entries: [{ name: "A", setsDone: [] }] } }), null); // not in log mode
  assert.equal(unsavedLogCount({ mode: "log" }), null); // no draft
});
