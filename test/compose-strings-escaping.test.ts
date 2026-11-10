// Compose Multiplatform resources show string text as written: unlike Android's aapt, they do not
// turn \' into an apostrophe. The app showed "об\'єм" on the workout summary, and ~85 other
// strings ("м\'язи", "з\'явиться") carried the same backslash. A plain ' is valid XML text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RES = join(process.cwd(), "mobile/shared/src/commonMain/composeResources");

test("Android strings: no backslash-escaped apostrophes or quotes (shown literally by Compose)", () => {
  const offenders: string[] = [];
  for (const dir of readdirSync(RES).filter((d) => d.startsWith("values"))) {
    for (const file of readdirSync(join(RES, dir)).filter((f) => f.endsWith(".xml"))) {
      readFileSync(join(RES, dir, file), "utf8").split("\n").forEach((line, i) => {
        if (/\\['"]/.test(line)) offenders.push(`${dir}/${file}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});

// The rest bar's button ends the rest. It read "Далі", like the "Далі: <next exercise>" link under
// the sets, so a tester moving to the next exercise tapped it and the rest timer vanished.
test("Android strings: the rest bar's skip button does not read like the next-exercise link", () => {
  for (const dir of ["values", "values-uk"]) {
    const xml = readFileSync(join(RES, dir, "strings_workout.xml"), "utf8");
    const str = (name: string) => xml.match(new RegExp(`<string name="${name}">([^<]*)</string>`))?.[1];
    const skip = str("wk_train_rest_skip_btn");
    assert.ok(skip, `${dir}: wk_train_rest_skip_btn exists`);
    assert.notEqual(skip, str("wk_focus_next"), dir);
  }
});
