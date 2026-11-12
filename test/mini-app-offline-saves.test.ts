import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedToday, cacheToday, dequeueDate, enqueueSave, flushQueue, isNetworkError, readQueue, shouldRetry, type QueuedSave } from "../apps/mini-app/src/logic/offlineSaves";

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

// A flush used to take a snapshot of the queue and write its own result back at the end. A save
// queued while a slow send was in flight was erased by that write: the logger had already said
// "saved", and the workout was gone.
test("flushQueue: a save queued while a send is in flight is kept, not overwritten by the flush", async () => {
  const s = memStore();
  enqueueSave(s, { key: "key-old-0001", date: "2026-11-09", body: { date: "2026-11-09", v: 1 }, queuedAt: 1 });
  const sentKeys: string[] = [];
  const r = await flushQueue(s, async (q) => {
    sentKeys.push(q.key);
    // The user finishes another workout while the first request is still open.
    if (q.key === "key-old-0001") enqueueSave(s, { key: "key-new-0002", date: "2026-11-10", body: { date: "2026-11-10", v: 2 }, queuedAt: 2 });
  });
  assert.deepEqual(sentKeys, ["key-old-0001", "key-new-0002"], "the save queued mid-flush is sent too, not erased");
  assert.equal(r.sent, 2);
  assert.deepEqual(readQueue(s), []);
});

test("flushQueue: a save queued mid-flush survives when the network drops again", async () => {
  const s = memStore();
  enqueueSave(s, { key: "key-old-0001", date: "2026-11-09", body: { date: "2026-11-09" }, queuedAt: 1 });
  await flushQueue(s, async (q) => {
    if (q.key === "key-old-0001") { enqueueSave(s, { key: "key-new-0002", date: "2026-11-10", body: { date: "2026-11-10" }, queuedAt: 2 }); return; }
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(readQueue(s).map((q) => q.key), ["key-new-0002"]);
});

test("flushQueue: a queued save replaced by a newer one for the same date is not sent", async () => {
  const s = memStore();
  enqueueSave(s, { key: "key-a-000001", date: "2026-11-08", body: { date: "2026-11-08" }, queuedAt: 1 });
  enqueueSave(s, { key: "key-b-000002", date: "2026-11-09", body: { date: "2026-11-09", v: 1 }, queuedAt: 2 });
  const sentKeys: string[] = [];
  await flushQueue(s, async (q) => {
    sentKeys.push(q.key);
    // While the first is being sent, the 11-09 workout is saved again with more sets.
    if (q.key === "key-a-000001") enqueueSave(s, { key: "key-c-000003", date: "2026-11-09", body: { date: "2026-11-09", v: 2 }, queuedAt: 3 });
  });
  assert.deepEqual(sentKeys, ["key-a-000001", "key-c-000003"], "the stale body for 11-09 is never sent");
  assert.deepEqual(readQueue(s), []);
});

test("dequeueDate: a save that went through online removes the older queued save for that date", () => {
  const s = memStore();
  enqueueSave(s, { key: "key-a-000001", date: "2026-11-08", body: {}, queuedAt: 1 });
  enqueueSave(s, { key: "key-b-000002", date: "2026-11-09", body: {}, queuedAt: 2 });
  dequeueDate(s, "2026-11-09");
  assert.deepEqual(readQueue(s).map((q) => q.date), ["2026-11-08"]);
});

test("wiring: an online save dequeues its date, and a refused offline save is shown, not dropped silently", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("apps/mini-app/src/TrainView.tsx", "utf8"), /dequeueDate\(localStorage, targetDate \?\? workout\.date\)/);
  const sync = readFileSync("apps/mini-app/src/OfflineSync.tsx", "utf8");
  assert.match(sync, /if \(r\.dropped\) setDropped/);
  assert.match(sync, /t\(lang, "offline_dropped", \{ n: dropped \}\)/);
});
