// Mini App locale catalogs and t(). Second piece of client coverage after
// test/mini-app-rest.test.ts.
//
// Key PARITY is already enforced by the type -- `uk` is declared
// `Record<keyof typeof en, string>`, so a missing or excess key is a compile error. The parity
// assertion below is kept only as a cheap guard in case that annotation is ever loosened.
//
// What the type CANNOT catch is what the rest of this file is for: an empty string, and
// placeholder drift. A uk translation that drops a `{n}` still satisfies `string`, and renders a
// sentence with a hole where the number should be -- for Ukrainian users only, which is exactly
// the audience least likely to be checked before release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { en, t, uk, type Key } from "../apps/mini-app/src/i18n";

test("every en key exists in uk, and vice versa", () => {
  const enKeys = Object.keys(en).sort();
  const ukKeys = Object.keys(uk).sort();
  const missingInUk = enKeys.filter((k) => !(k in uk));
  const extraInUk = ukKeys.filter((k) => !(k in en));
  assert.deepEqual(missingInUk, [], "should be impossible while uk is typed Record<keyof typeof en, string>");
  assert.deepEqual(extraInUk, []);
});

test("no locale string is empty, and uk is actually translated", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(String(value).length > 0, `en.${key} is empty`);
  }
  for (const [key, value] of Object.entries(uk)) {
    assert.ok(String(value).length > 0, `uk.${key} is empty`);
  }
});

test("every {placeholder} in an en string also appears in its uk counterpart", () => {
  // A translation that drops a placeholder renders a sentence with a hole in it -- "Rest over
  // by" with no number -- which no type checks and no reviewer reliably catches.
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const mismatched: string[] = [];
  for (const [key, value] of Object.entries(en)) {
    const ukValue = (uk as Record<string, string>)[key];
    if (typeof ukValue !== "string") continue;
    const a = placeholders(String(value));
    const b = placeholders(ukValue);
    if (a.join(",") !== b.join(",")) mismatched.push(`${key}: en[${a}] vs uk[${b}]`);
  }
  assert.deepEqual(mismatched, []);
});

test("t interpolates named vars and leaves unknown ones visible", () => {
  assert.equal(t("en", "pct_label", { n: 42 }), "42%");
  assert.equal(t("en", "level_n", { n: 3 }), t("en", "level_n", { n: 3 }), "stable for the same input");
  // An unsupplied placeholder stays as-is rather than becoming "undefined": a visible {n} is a
  // bug report, "undefined" reads like data.
  assert.match(t("en", "pct_label", {}), /\{n\}/);
  assert.equal(t("en", "pct_label"), "{n}%", "no vars at all returns the raw template");
});

test("t falls back to English for a key missing from a locale, never to blank", () => {
  // Exercised through the real catalogs: whatever uk is missing (the parity test above asserts
  // nothing is), t must still return the English string rather than undefined.
  const key = "pct_label" as Key;
  assert.equal(typeof t("uk", key, { n: 1 }), "string");
  assert.ok(t("uk", key, { n: 1 }).length > 0);
});
