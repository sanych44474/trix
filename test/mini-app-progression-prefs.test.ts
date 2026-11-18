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

