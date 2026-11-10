// The owner edits any user's plan in the app (the chat plan view is read-only since ADR-0012).
// The roster's Plan button has to reach App's openPlan through Workspace and OwnerWorkspace; a
// broken link in that chain leaves the button out with nothing failing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`apps/mini-app/src/${p}`, "utf8");

test("owner roster: the Plan button is wired from App through Workspace and OwnerWorkspace", () => {
  assert.match(read("App.tsx"), /<WorkspaceView [^>]*onOpenPlan=\{onOpenPlan\}/);
  assert.match(read("Workspace.tsx"), /<OwnerWorkspace lang=\{lang\} onOpenPlan=\{onOpenPlan\} \/>/);
  assert.match(read("workspace/OwnerWorkspace.tsx"), /<OwnerRoster lang=\{lang\}[^\n]*onOpenPlan=\{onOpenPlan\} \/>/);
  assert.match(read("OwnerRoster.tsx"), /onClick=\{\(\) => onOpenPlan\(r\.id\)\}>\{t\(lang, "roster_plan_btn"\)\}/);
});

test("owner roster: the Plan label exists in both languages", () => {
  assert.match(read("i18n/en.ts"), /roster_plan_btn: "Plan"/);
  assert.match(read("i18n/uk.ts"), /roster_plan_btn: "План"/);
});
