// The Mini App side of the progression limits: the exercise menu sets a ceiling, Settings turns
// automatic increases off and lists / removes ceilings. Static wiring checks (a broken link leaves
// the control out with nothing failing), plus the strings in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("logger: the exercise menu offers Max weight and TrainView saves it then re-reads the target", () => {
  const focus = read("apps/mini-app/src/train/FocusExercise.tsx");
  assert.match(focus, /t\(lang, "train_cap_btn"\)/);
  assert.match(focus, /props\.onSetCap\(kg, all\)/);
  assert.match(focus, /props\.onSetCap\(null, !!exercise\.capShared\)/);
  assert.match(focus, /exercise\.dumbbellOnly \? <label/);
  assert.match(focus, /exercise\.capKg \? <p className="focus-progress">\{t\(lang, "cap_note"/);
  const train = read("apps/mini-app/src/TrainView.tsx");
  assert.match(train, /onSetCap=\{\(kg, all\) => void setCap\(exercise, kg, all\)\}/);
  assert.match(train, /action: "progression", exercise: all \? "@dumbbell" : exercise\.name, capKg: kg/);
  assert.match(train, /\/api\/v2\/workout\/today/);
});

test("settings: a progression card with the off switch and the removable ceilings", () => {
  const profile = read("apps/mini-app/src/ProfileView.tsx");
  assert.match(profile, /run\("progression", "progression", \{ auto \}\)/);
  assert.match(profile, /run\(`cap:\$\{exercise\}`, "progression", \{ exercise, capKg: null \}\)/);
  assert.match(profile, /settings\.progression\.caps\.map/);
});

test("strings: every key the progression UI uses exists in en and uk", () => {
  const keys = ["train_cap_btn", "cap_save_btn", "cap_clear_btn", "cap_note", "prog_eyebrow", "prog_title", "prog_auto_label", "prog_caps_title", "prog_caps_empty", "prog_cap_remove", "cap_all_dumbbells"];
  for (const file of ["apps/mini-app/src/i18n/en.ts", "apps/mini-app/src/i18n/uk.ts"]) {
    const src = read(file);
    for (const k of keys) assert.match(src, new RegExp(`^\\s+${k}: "`, "m"), `${file}: ${k}`);
  }
});
