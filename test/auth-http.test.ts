import assert from "node:assert/strict";
import test from "node:test";
import { readAuthJson } from "../src/webapp/authHttp";

test("auth JSON reader accepts small JSON object requests", async () => {
  const request = new Request("https://trix.example/api/v2/auth/email/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com" }),
  });
  assert.deepEqual(await readAuthJson(request), { email: "user@example.com" });
});

test("auth JSON reader rejects wrong content types, oversized bodies, and non-object JSON", async () => {
  const form = new Request("https://trix.example/api/v2/auth/email/start", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
  });
  assert.equal(await readAuthJson(form), null);

  const tooLarge = new Request("https://trix.example/api/v2/auth/email/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(64) }),
  });
  assert.equal(await readAuthJson(tooLarge, 32), null);

  const array = new Request("https://trix.example/api/v2/auth/email/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: "[]",
  });
  assert.equal(await readAuthJson(array), null);
});
