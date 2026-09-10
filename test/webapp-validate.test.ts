import { test } from "node:test";
import assert from "node:assert/strict";
import { arrayOf, bool, num, object, oneOf, optional, readJsonBody, str, validateBody } from "../src/webapp/validate";

test("str: min/max/pattern", () => {
  const s = str({ min: 2, max: 5, pattern: /^[a-z]+$/ });
  assert.equal(s.parse("ab", "x").ok, true);
  assert.equal(s.parse("a", "x").ok, false);
  assert.equal(s.parse("abcdef", "x").ok, false);
  assert.equal(s.parse("AB", "x").ok, false);
  assert.equal(s.parse(5, "x").ok, false);
});

test("num: accepts a numeric string (matches existing Number(body.x) convention), rejects NaN", () => {
  const n = num({ min: 1, max: 7, int: true });
  assert.deepEqual(n.parse("3", "x"), { ok: true, value: 3 });
  assert.deepEqual(n.parse(3, "x"), { ok: true, value: 3 });
  assert.equal(n.parse("abc", "x").ok, false);
  assert.equal(n.parse(0, "x").ok, false); // below min
  assert.equal(n.parse(8, "x").ok, false); // above max
  assert.equal(n.parse(3.5, "x").ok, false); // not an integer
  assert.equal(n.parse(Infinity, "x").ok, false);
  assert.equal(n.parse(NaN, "x").ok, false);
});

test("bool / oneOf", () => {
  assert.equal(bool().parse(true, "x").ok, true);
  assert.equal(bool().parse("true", "x").ok, false); // no string coercion for booleans
  const action = oneOf(["weight", "sets", "del"] as const);
  assert.equal(action.parse("weight", "x").ok, true);
  assert.equal(action.parse("nuke", "x").ok, false);
});

test("optional: undefined/null pass through, a present value is still validated", () => {
  const s = optional(str({ min: 3 }));
  assert.deepEqual(s.parse(undefined, "x"), { ok: true, value: undefined });
  assert.deepEqual(s.parse(null, "x"), { ok: true, value: undefined });
  assert.equal(s.parse("ab", "x").ok, false); // present but too short
});

test("arrayOf: validates every element and caps length", () => {
  const arr = arrayOf(num({ min: 0 }), { maxItems: 3 });
  assert.deepEqual(arr.parse([1, 2], "x"), { ok: true, value: [1, 2] });
  assert.equal(arr.parse([1, -1], "x").ok, false); // one bad element
  assert.equal(arr.parse([1, 2, 3, 4], "x").ok, false); // over maxItems
  assert.equal(arr.parse("not an array", "x").ok, false);
});

test("object: validates every declared field, reports the first failing field's path", () => {
  const schema = object({ weekday: num({ min: 1, max: 7, int: true }), action: oneOf(["weight", "sets"] as const) });
  const good = schema.parse({ weekday: 3, action: "weight" }, "$");
  assert.deepEqual(good, { ok: true, value: { weekday: 3, action: "weight" } });
  const bad = schema.parse({ weekday: 9, action: "weight" }, "$");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /weekday/);
  assert.equal(schema.parse(null, "$").ok, false);
  assert.equal(schema.parse([1, 2], "$").ok, false); // an array is not an object
});

test("validateBody: wraps a schema failure into a uniform 400 Response", async () => {
  const schema = object({ n: num({ min: 1 }) });
  const ok = validateBody({ n: 5 }, schema);
  assert.equal(ok.ok, true);
  const bad = validateBody({ n: 0 }, schema);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.response.status, 400);
    const json = (await bad.response.json()) as { error: string; detail: string };
    assert.equal(json.error, "invalid request");
    assert.match(json.detail, /n:/);
  }
});

function reqWithBody(bodyText: string, contentLength?: string): Request {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("https://example.com/api/x", { method: "POST", body: bodyText, headers });
}

test("readJsonBody: parses valid JSON", async () => {
  const r = await readJsonBody(reqWithBody('{"a":1}'));
  assert.deepEqual(r, { ok: true, body: { a: 1 } });
});

test("readJsonBody: rejects invalid JSON with a 400", async () => {
  const r = await readJsonBody(reqWithBody("{not json"));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.response.status, 400);
});

test("readJsonBody: rejects an oversized body via Content-Length before reading it", async () => {
  const r = await readJsonBody(reqWithBody("{}", String(300 * 1024)));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.response.status, 413);
});

test("readJsonBody: rejects an oversized body even when Content-Length lied (chunked/absent)", async () => {
  const big = '{"s":"' + "x".repeat(300 * 1024) + '"}';
  const r = await readJsonBody(reqWithBody(big)); // no content-length header set
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.response.status, 413);
});
