// The Android owner console's roster has a Plan button (as the Mini App's roster does): the owner
// opens any person's plan, and the plan route takes the person's id. Gradle cannot run here, so this
// checks the source wiring; the Mobile workflow compiles it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kt = "mobile/shared/src/commonMain/kotlin/app/hacklimits/shared";

test("the roster's Plan button opens that person's plan, not for people still in onboarding", () => {
  const screen = readFileSync(`${kt}/owner/OwnerScreen.kt`, "utf8");
  assert.match(screen, /if \(user\.status != "onboarding"\) \{\s*OutlinedButton\(onClick = onOpenPlan\)/);
  assert.match(screen, /onOpenPlan = \{ onOpenPlan\(user\.id\) \}/);
  const app = readFileSync(`${kt}/App.kt`, "utf8");
  assert.match(app, /OwnerScreen\(onBack = \{ nav\.popBackStack\(\) \}, onOpenPlan = \{ id -> nav\.navigate\(PlanRoute\(id\)\) \}\)/);
});

