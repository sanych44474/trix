import { test } from "node:test";
import assert from "node:assert/strict";
import { healthcheckDue, healthcheckUrl, pingHealthcheck } from "../src/adapters/monitoring/healthchecks";

const at = (min: number) => Date.UTC(2026, 9, 14, 12, min);

test("healthcheck: success pings every fifth minute, failure always", () => {
  assert.equal(healthcheckDue("ok", at(0)), true);
  assert.equal(healthcheckDue("ok", at(35)), true);
  assert.equal(healthcheckDue("ok", at(36)), false);
  assert.equal(healthcheckDue("fail", at(36)), true);
});

test("healthcheck: URL is https only, /fail appended on failure", () => {
  assert.equal(healthcheckUrl(undefined, "ok"), null);
  assert.equal(healthcheckUrl("", "ok"), null);
  assert.equal(healthcheckUrl("http://hc-ping.com/abc", "ok"), null);
  assert.equal(healthcheckUrl(" https://hc-ping.com/abc/ ", "ok"), "https://hc-ping.com/abc");
  assert.equal(healthcheckUrl("https://hc-ping.com/abc", "fail"), "https://hc-ping.com/abc/fail");
});

test("healthcheck: ping posts the detail, and a network error never throws", async () => {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  try {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      return new Response("OK");
    }) as typeof fetch;
    await pingHealthcheck("https://hc-ping.com/abc", "fail", "boom");
    await pingHealthcheck(undefined, "ok");
    assert.deepEqual(calls, [{ url: "https://hc-ping.com/abc/fail", body: "boom" }]);

    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await pingHealthcheck("https://hc-ping.com/abc", "ok");
  } finally {
    globalThis.fetch = realFetch;
  }
});
