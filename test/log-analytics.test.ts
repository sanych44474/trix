// What may leave D1. docs/slos.md: "no raw username, chat ID, or health data as a metric label in any
// external system". The console line (Workers Logs) keeps userId for debugging; the Analytics Engine data
// point - external, kept for months - carries only allowlisted keys. These tests drive the real
// logError / logInfo through the ambient-context path the Worker uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsExtra, logError, logInfo, runWithRequestId } from "../src/log";
import type { Env } from "../src/types";

function capture() {
  const points: Array<{ indexes: string[]; blobs: string[]; doubles: number[] }> = [];
  const env = { ANALYTICS: { writeDataPoint: (p: (typeof points)[number]) => { points.push(p); } } } as unknown as Env;
  return { points, env };
}
const quiet = (fn: () => void) => {
  const e = console.error, l = console.log;
  console.error = () => {}; console.log = () => {};
  try { fn(); } finally { console.error = e; console.log = l; }
};

test("analyticsExtra: drops identifiers and anything not allowlisted", () => {
  const out = analyticsExtra({ userId: 42, chatId: 7, username: "alice", name: "Alice", text: "my knee hurts", message: "x", kind: "api_plan", status: 500 });
  assert.deepEqual(out, { kind: "api_plan", status: 500 });
});

test("analyticsExtra: a key nobody has reviewed is dropped by default", () => {
  assert.deepEqual(analyticsExtra({ brandNewField: "value", durationMs: 12 }), { durationMs: 12 });
});

test("analyticsExtra: paths lose their ids, long strings are cut, objects and arrays never pass", () => {
  assert.equal(analyticsExtra({ path: "/api/v2/trainer/client/20/card" }).path, "/api/v2/trainer/client/:id/card");
  assert.equal(analyticsExtra({ path: "/story/0f8fad5b-d9cb-469f-a165-70867728950e" }).path, "/story/:id");
  assert.equal((analyticsExtra({ kind: "x".repeat(500) }).kind as string).length, 64);
  assert.deepEqual(analyticsExtra({ kind: { id: 1 } as never, source: ["a"] as never }), {});
  assert.deepEqual(analyticsExtra(undefined), {});
});

test("logError: the data point has no user id, the console line still does", () => {
  const { points, env } = capture();
  const lines: string[] = [];
  const realErr = console.error;
  console.error = (...a: unknown[]) => { lines.push(String(a[0])); };
  try {
    runWithRequestId("req-1", env, () => logError("api_workout", new Error("boom"), { userId: 42, action: "save", status: 500 }));
  } finally { console.error = realErr; }

  assert.equal(points.length, 1);
  assert.deepEqual(JSON.parse(points[0]!.blobs[2]!), { action: "save", status: 500 });
  assert.ok(!points[0]!.blobs.join("|").includes("42"), "no id anywhere in the data point");
  assert.match(lines[0]!, /"userId":42/, "debugging context is kept in Workers Logs");
});

test("logInfo: the request summary is recorded with a route shape, not a concrete path", () => {
  const { points, env } = capture();
  quiet(() => runWithRequestId("req-2", env, () => logInfo("request", { method: "GET", path: "/api/v2/trainer/client/20/card", status: 200, durationMs: 31 })));
  assert.deepEqual(JSON.parse(points[0]!.blobs[2]!), { method: "GET", path: "/api/v2/trainer/client/:id/card", status: 200, durationMs: 31 });
});
