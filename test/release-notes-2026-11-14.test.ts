// The bundle keeps the latest two release notes; every note is bilingual, fits one Telegram
// message, carries no raw markup, and docs/release-notes.md keeps the same text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELEASE_NOTES, latestRelease, releaseBody } from "../src/releaseNotes";

test("the latest note is 2026-11-14 and the bundle keeps two", () => {
  assert.equal(latestRelease().version, "2026-11-14");
  assert.deepEqual(RELEASE_NOTES.map((n) => n.version), ["2026-11-14", "2026-10-26"]);
});

test("each note has both languages, fits a Telegram message and has no raw angle brackets or ampersands", () => {
  for (const note of RELEASE_NOTES) {
    for (const lang of ["en", "uk"] as const) {
      const text = note[lang];
      assert.ok(text.length > 100, `${note.version} ${lang}`);
      assert.ok(releaseBody(lang, note).length < 4096, `${note.version} ${lang} length`);
      assert.doesNotMatch(text, /[<>&]/, `${note.version} ${lang}`);
    }
  }
});

test("the same note is in docs/release-notes.md, newest first", () => {
  const doc = readFileSync("docs/release-notes.md", "utf8");
  assert.ok(doc.indexOf("## 2026-11-14") < doc.indexOf("## 2026-10-26"));
  assert.match(doc, /Your own limits/);
  assert.match(doc, /Твої власні ліміти/);
});
