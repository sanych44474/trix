import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isTextEntry } from "../apps/mini-app/src/logic/typing";

test("typing: text inputs, textareas and selects raise the keyboard; buttons and toggles do not", () => {
  assert.equal(isTextEntry({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTextEntry({ tagName: "input", type: "number" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT" }), true, "an input with no type is a text input");
  assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntry({ tagName: "SELECT" }), true);
  for (const type of ["button", "checkbox", "radio", "range", "submit"]) assert.equal(isTextEntry({ tagName: "INPUT", type }), false, type);
  assert.equal(isTextEntry({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntry(null), false);
});

// apps/mini-app/CLAUDE.md: with a text field focused, MainButton must hide or it covers what is
// typed. Today showed it while the steps field (and the fine-tune / comeback cards) had focus.
test("every screen that shows Telegram's MainButton hides it while typing", () => {
  const root = join(process.cwd(), "apps/mini-app/src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".tsx")) files.push(full);
    }
  };
  walk(root);
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8");
    return src.includes("showMainButton(") && !src.includes("useTyping()");
  });
  assert.deepEqual(offenders.map((f) => f.slice(root.length + 1)), []);
});
