import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../src/locales/en";
import { uk } from "../src/locales/uk";

// Key parity is enforced by the type system (uk: Dict). These cover what the types cannot.
const placeholders = (s: string) => [...s.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map((m) => m[1]).sort();

test("bot locales: every {placeholder} in en appears in uk and vice versa", () => {
  const bad: string[] = [];
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    const a = placeholders(String(en[key]));
    const b = placeholders(String(uk[key]));
    if (JSON.stringify([...new Set(a)]) !== JSON.stringify([...new Set(b)])) bad.push(`${key}: en {${a}} uk {${b}}`);
  }
  assert.deepEqual(bad, []);
});

test("bot locales: no string is empty", () => {
  const empty = (Object.keys(en) as Array<keyof typeof en>).filter((k) => !String(en[k]).trim() || !String(uk[k]).trim());
  assert.deepEqual(empty, []);
});
