// The logger's soft (neumorphic) look, asked for by a tester: set inputs sit pressed into the card,
// set buttons and the remove ✕ stand out of it. The depth comes from two tokens that every theme
// must define, or a light theme would draw dark-theme shadows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("apps/mini-app/src/styles.css", "utf8");
const focus = readFileSync("apps/mini-app/src/train/FocusExercise.tsx", "utf8");

test("soft tokens: defined for the dark default, the light media query and the explicit light theme", () => {
  assert.match(css, /:root \{[^}]*--soft-lo:[^}]*--soft-hi:/);
  assert.match(css, /prefers-color-scheme: light\)\s*\{\s*:root \{[^}]*--soft-lo:[^}]*--soft-hi:/);
  assert.match(css, /:root\[data-theme="light"\] \{[^}]*--soft-lo:[^}]*--soft-hi:/);
});

test("removing a set is a ✕ button that still says what it does to a screen reader", () => {
  assert.match(focus, /className="soft-x" aria-label=\{t\(lang, "set_remove_btn"\)\}/);
});
