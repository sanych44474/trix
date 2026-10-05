import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REPORTS, toReport } from "../apps/mini-app/src/logic/errorReport";

test("toReport: message + first app frame; repeats, noise and API errors skipped; capped", () => {
  const seen = new Set<string>();
  const err = new TypeError("Cannot read properties of undefined (reading 'kg')");
  err.stack = "TypeError: Cannot read...\n    at Fe (https://x/app-v2/assets/index-B5XV5GJQ.js:12:345)";
  assert.deepEqual(toReport(err, seen), { message: "TypeError: Cannot read properties of undefined (reading 'kg')", source: "index-B5XV5GJQ.js", line: 12 });
  assert.equal(toReport(err, seen), null); // once per session
  assert.equal(toReport(new TypeError("Failed to fetch"), seen), null);
  assert.equal(toReport("ResizeObserver loop completed with undelivered notifications.", seen), null);
  assert.equal(toReport(Object.assign(new Error("Request failed"), { name: "ApiError" }), seen), null);
  for (let i = 0; i < 10; i++) toReport(new Error(`e${i}`), seen);
  assert.equal(seen.size, MAX_REPORTS);
});

test("toReport: only the bare cross-origin \"Script error.\" is dropped", () => {
  const seen = new Set<string>();
  assert.equal(toReport("Script error.", seen), null);
  assert.ok(toReport(new Error("Script error in plan editor"), seen));
});
