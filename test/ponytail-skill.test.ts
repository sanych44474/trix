// The vendored Ponytail skill: a plain markdown file (no hooks, no scripts) that records where it
// came from, and CLAUDE.md says the repository's own rules win over it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const skills = ["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-review"];

test("each skill is one markdown file with a name, a description and its source", () => {
  for (const name of skills) {
    const folder = `.claude/skills/${name}`;
    assert.deepEqual(readdirSync(folder), ["SKILL.md"], `${name}: no hooks or scripts are vendored`);
    const text = readFileSync(`${folder}/SKILL.md`, "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`), name);
    assert.match(text, /description:/, name);
    assert.match(text, /github\.com\/DietrichGebert\/ponytail/, name);
    assert.match(text, /MIT/, name);
  }
  assert.deepEqual(readdirSync(".claude/skills").filter((d) => d.startsWith("ponytail")).sort(), skills.slice().sort(), "only the reviewed skills");
});

test("the report skills only read: no commands, downloads or file writes in their text", () => {
  for (const name of skills.slice(1)) {
    const text = readFileSync(`.claude/skills/${name}/SKILL.md`, "utf8");
    assert.doesNotMatch(text, /\b(curl|wget|npm install|rm -rf)\b|https?:\/\/(?!github\.com\/DietrichGebert\/ponytail)/, name);
  }
});

test("CLAUDE.md says the repository's rules win, notably tests for every change", () => {
  const claude = readFileSync("CLAUDE.md", "utf8");
  assert.match(claude, /## Ponytail skill/);
  assert.match(claude, /this file wins/);
  assert.match(claude, /every change is covered by tests/);
});

test("no plugin hook files for it exist in the repository", () => {
  assert.equal(existsSync(".claude/settings.json") && /ponytail/i.test(readFileSync(".claude/settings.json", "utf8")), false);
});
