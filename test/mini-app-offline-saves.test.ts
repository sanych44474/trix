import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedToday, cacheToday, enqueueSave, flushQueue, isNetworkError, readQueue, shouldRetry, type QueuedSave } from "../apps/mini-app/src/logic/offlineSaves";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const save = (key: string, date: string): QueuedSave => ({ key, date, body: { entries: [], date }, queuedAt: 1 });
const httpErr = (status: number) => Object.assign(new Error("x"), { status });

test("isNetworkError: fetch TypeError or offline yes; an HTTP error no", () => {
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(httpErr(500)), false);
  assert.equal(isNetworkError(httpErr(500), false), true);
  assert.equal(isNetworkError(new Error("boom")), false);
});

test("enqueueSave keeps one save per date (the newest)", () => {
  const s = memStore();
  enqueueSave(s, save("a", "2026-10-01"));
  enqueueSave(s, save("b", "2026-10-02"));
  enqueueSave(s, save("c", "2026-10-01"));
  assert.deepEqual(readQueue(s).map((q) => q.key), ["b", "c"]);
});

test("flushQueue: sends with the stored key, stops when still offline, keeps retryable, drops rejected", async () => {
  const s = memStore();
  ["a", "b", "c", "d"].forEach((k, i) => enqueueSave(s, save(k, `2026-10-0${i + 1}`)));
  const keys: string[] = [];
  const r = await flushQueue(s, async (q) => {
    keys.push(q.key);
    if (q.key === "b") throw Object.assign(httpErr(409), { retryable: true }); // still in flight → keep
    if (q.key === "c") throw httpErr(400); // too old → drop
    if (q.key === "d") throw new TypeError("Failed to fetch"); // offline again → keep
  });
  assert.deepEqual(keys, ["a", "b", "c", "d"]);
  assert.deepEqual(r, { sent: 1, dropped: 1, remaining: 2 });
  assert.deepEqual(readQueue(s).map((q) => q.key), ["b", "d"]);
  assert.deepEqual(await flushQueue(s, async () => {}), { sent: 2, dropped: 0, remaining: 0 });
  assert.equal(s.getItem("trix:v2:offline-saves"), null);
});

test("cachedToday only returns today's plan", () => {
  const s = memStore();
  cacheToday(s, { date: "2026-10-02" });
  assert.deepEqual(cachedToday(s, "2026-10-02"), { date: "2026-10-02" });
  assert.equal(cachedToday(s, "2026-10-03"), null);
});

test("flushQueue: the server's retryable flag decides a rejected save", async () => {
  const s = memStore();
  enqueueSave(s, save("login", "2026-10-05"));
  enqueueSave(s, save("flight", "2026-10-06"));
  enqueueSave(s, save("old", "2026-10-07"));
  const retryable = (status: number, flag: boolean) => Object.assign(new Error("x"), { status, retryable: flag });
  const sent: string[] = [];
  const r = await flushQueue(s, async (q) => {
    if (q.key === "login") throw retryable(401, true); // opened offline, no login data yet
    if (q.key === "flight") throw retryable(409, true); // same key still in flight
    throw retryable(400, false); // more than 14 days back
  });
  assert.deepEqual(r, { sent: 0, dropped: 1, remaining: 2 });
  assert.deepEqual(readQueue(s).map((q) => q.key), ["login", "flight"]);
  await flushQueue(s, async (q) => { sent.push(q.key); });
  assert.deepEqual(sent, ["login", "flight"]);
});

test("shouldRetry without the flag: no network, 429 and 5xx retry; other 4xx drop", () => {
  assert.equal(shouldRetry(new TypeError("Failed to fetch")), true);
  assert.equal(shouldRetry(httpErr(503)), true);
  assert.equal(shouldRetry(httpErr(429)), true);
  assert.equal(shouldRetry(httpErr(409)), false);
  assert.equal(shouldRetry(httpErr(403)), false);
  assert.equal(shouldRetry(Object.assign(new Error("x"), { status: 403, retryable: true })), true, "the flag wins");
});

test("the queue keeps the newest 20 saves", () => {
  const s = memStore();
  for (let i = 1; i <= 21; i++) enqueueSave(s, save(`k${i}`, `2026-10-${String(i).padStart(2, "0")}`));
  const keys = readQueue(s).map((q) => q.key);
  assert.equal(keys.length, 20);
  assert.equal(keys[0], "k2", "the oldest save is the one dropped");
  assert.equal(keys[19], "k21");
});
