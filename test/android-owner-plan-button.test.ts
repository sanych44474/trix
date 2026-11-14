// The Android owner console's roster has a Plan button (as the Mini App's roster does): the owner
// opens any person's plan, and the plan route takes the person's id. Gradle cannot run here, so this
// checks the source wiring; the Mobile workflow compiles it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kt = "mobile/shared/src/commonMain/kotlin/app/hacklimits/shared";
const res = "mobile/shared/src/commonMain/composeResources";

test("the roster's Plan button opens that person's plan, not for people still in onboarding", () => {
  const screen = readFileSync(`${kt}/owner/OwnerScreen.kt`, "utf8");
  assert.match(screen, /if \(user\.status != "onboarding"\) \{\s*OutlinedButton\(onClick = onOpenPlan\)/);
  assert.match(screen, /onOpenPlan = \{ onOpenPlan\(user\.id\) \}/);
  const app = readFileSync(`${kt}/App.kt`, "utf8");
  assert.match(app, /OwnerScreen\(onBack = \{ nav\.popBackStack\(\) \}, onOpenPlan = \{ id -> nav\.navigate\(PlanRoute\(id\)\) \}\)/);
});

test("the button's label exists in both languages", () => {
  for (const dir of ["values", "values-uk"]) {
    assert.match(readFileSync(`${res}/${dir}/strings_owner.xml`, "utf8"), /name="ow_roster_plan_btn"/, dir);
  }
});

test("the Mini App's roster has the same button, so the two owner consoles agree", () => {
  assert.match(readFileSync("apps/mini-app/src/OwnerRoster.tsx", "utf8"), /r\.status !== "onboarding" && <button.*roster_plan_btn/);
});
