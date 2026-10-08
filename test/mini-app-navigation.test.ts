// Mini App navigation (apps/mini-app/src/logic/navigation.ts), lifted out of App.tsx unchanged. These
// pin the current behaviour so the move is provable: which screens a link may open and the tabs
// each role sees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationFor, viewFromSearch, VIEWS } from "../apps/mini-app/src/logic/navigation";

test("viewFromSearch: no parameter opens Today", () => {
  assert.equal(viewFromSearch(""), "today");
  assert.equal(viewFromSearch("?foo=bar"), "today");
});

test("viewFromSearch: every real screen opens itself, from ?view= and from Telegram's startapp", () => {
  for (const v of VIEWS) {
    assert.equal(viewFromSearch(`?view=${v}`), v);
    assert.equal(viewFromSearch(`?startapp=${v}`), v);
  }
});

test("viewFromSearch: the names notification buttons and old links use map to the right screen", () => {
  const expected: Record<string, string> = {
    home: "today", log: "train", workout: "train", survey: "progress", nutrition: "fuel", food: "fuel",
    profile: "settings", owner: "role", chat: "coach", ask: "coach",
  };
  for (const [alias, view] of Object.entries(expected)) assert.equal(viewFromSearch(`?view=${alias}`), view, alias);
});

test("viewFromSearch: ?view= wins over startapp, and an unknown screen falls back to Today", () => {
  assert.equal(viewFromSearch("?view=plan&startapp=fuel"), "plan");
  assert.equal(viewFromSearch("?view=nonsense"), "today");
  assert.equal(viewFromSearch("?startapp=nonsense"), "today");
  assert.equal(viewFromSearch("?view="), "today", "an empty value is no value");
});

test("viewFromSearch: other parameters (deep links into a client card or a coach question) do not interfere", () => {
  assert.equal(viewFromSearch("?view=role&client=20"), "role");
  assert.equal(viewFromSearch("?view=coach&ask=how%20much%20protein"), "coach");
});

test("navigationFor: the three working roles get the full tab bar, anything else only Today and role", () => {
  const full = ["today", "train", "plan", "fuel", "progress", "more", "role"];
  for (const role of ["trainer", "solo", "client"]) assert.deepEqual(navigationFor(role), full, role);
  assert.deepEqual(navigationFor(undefined), ["today", "role"]);
  assert.deepEqual(navigationFor("owner"), ["today", "role"]);
});

test("navigationFor: every tab is a screen a link can also open", () => {
  for (const tab of navigationFor("solo")) assert.ok(VIEWS.includes(tab), tab);
});
