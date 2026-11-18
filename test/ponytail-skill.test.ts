// The vendored Ponytail skill: a plain markdown file (no hooks, no scripts) that records where it
// came from, and CLAUDE.md says the repository's own rules win over it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const dir = ".claude/skills/ponytail";

test("the skill is one markdown file with a name, a description and its source", () => {
  assert.deepEqual(readdirSync(dir), ["SKILL.md"], "no hooks or scripts are vendored");
  const text = readFileSync(`${dir}/SKILL.md`, "utf8");
  assert.match(text, /^---\nname: ponytail\n/);
  assert.match(text, /description:/);
  assert.match(text, /github\.com\/DietrichGebert\/ponytail/);
  assert.match(text, /MIT/);
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
