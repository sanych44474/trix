import { test } from "node:test";
import assert from "node:assert/strict";
import { withHeader } from "../src/log";

test("withHeader: adds a header to an ordinary (mutable-headers) Response", async () => {
  const res = withHeader(new Response("ok", { status: 200 }), "X-Request-Id", "abc");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Request-Id"), "abc");
  assert.equal(await res.text(), "ok");
});

// The exact regression this locks in: Response.redirect() ships with an IMMUTABLE header guard
// per the Fetch spec, so a plain res.headers.set(...) throws -- this took GET /v down in
// production (500 instead of a 302 redirect) the first time this code shipped.
test("withHeader: adds a header to a Response.redirect() (immutable headers) without throwing", () => {
  const redirect = Response.redirect("https://youtube.com/watch?v=abc", 302);
  assert.throws(() => redirect.headers.set("X-Request-Id", "abc"), /immutable/i);

  const res = withHeader(redirect, "X-Request-Id", "abc");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "https://youtube.com/watch?v=abc");
  assert.equal(res.headers.get("X-Request-Id"), "abc");
});

test("withHeader: overwrites an existing header of the same name rather than duplicating it", () => {
  const res = withHeader(new Response(null, { headers: { "X-Request-Id": "old" } }), "X-Request-Id", "new");
  assert.equal(res.headers.get("X-Request-Id"), "new");
});
