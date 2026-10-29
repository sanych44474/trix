import { test } from "node:test";
import assert from "node:assert/strict";
import { readMultipartBody } from "../src/webapp/validate";

// Small cap and chunk size so the tests stay fast; the code path is identical at production sizes.
const CAP = 1024;
const CHUNK = 256;

async function multipartOf(fields: Record<string, Blob | string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const probe = new Request("https://x/upload", { method: "POST", body: fd });
  return { bytes: new Uint8Array(await probe.arrayBuffer()), contentType: probe.headers.get("content-type") ?? "" };
}

// A body delivered as a stream with no Content-Length, counting how many chunks the reader pulled.
// highWaterMark 0 means nothing is pulled until the handler reads, so `pulls` shows how far it got.
function streamRequest(bytes: Uint8Array, contentType: string, extraHeaders: Record<string, string> = {}) {
  const counter = { pulls: 0, total: Math.ceil(bytes.byteLength / CHUNK) };
  let offset = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        counter.pulls++;
        if (offset >= bytes.byteLength) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + CHUNK));
        offset += CHUNK;
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request("https://x/upload", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "content-type": contentType, ...extraHeaders },
  } as RequestInit);
  return { req, counter };
}

test("readMultipartBody: a small upload is parsed into FormData", async () => {
  const { bytes, contentType } = await multipartOf({ photo: new Blob(["hello"], { type: "image/jpeg" }), caption: "lunch" });
  const req = new Request("https://x/upload", { method: "POST", headers: { "content-type": contentType }, body: bytes });
  const r = await readMultipartBody(req, CAP);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const form = r.form as FormData;
  assert.equal(form.get("caption"), "lunch");
  assert.equal((form.get("photo") as Blob).size, 5);
});

test("readMultipartBody: a small streamed upload without Content-Length is parsed", async () => {
  const { bytes, contentType } = await multipartOf({ photo: new Blob(["hi"]) });
  const { req } = streamRequest(bytes, contentType);
  const r = await readMultipartBody(req, CAP);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const form = r.form as FormData;
  assert.equal((form.get("photo") as Blob).size, 2);
});

test("readMultipartBody: Content-Length over the cap is a 413 and the body is never read", async () => {
  const { bytes, contentType } = await multipartOf({ photo: new Blob([new Uint8Array(4 * CAP)]) });
  const { req, counter } = streamRequest(bytes, contentType, { "content-length": String(bytes.byteLength) });
  const r = await readMultipartBody(req, CAP);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.response.status, 413);
  assert.equal(counter.pulls, 0);
});

test("readMultipartBody: no Content-Length and an oversized body is a 413, and reading stops early", async () => {
  const { bytes, contentType } = await multipartOf({ photo: new Blob([new Uint8Array(8 * CAP)]) });
  const { req, counter } = streamRequest(bytes, contentType);
  const r = await readMultipartBody(req, CAP);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.response.status, 413);
  assert.ok(counter.pulls < counter.total, `read ${counter.pulls} of ${counter.total} chunks; expected to stop early`);
});

test("readMultipartBody: a lying Content-Length (small) cannot smuggle an oversized body past the cap", async () => {
  const { bytes, contentType } = await multipartOf({ photo: new Blob([new Uint8Array(8 * CAP)]) });
  const { req } = streamRequest(bytes, contentType, { "content-length": "10" });
  const r = await readMultipartBody(req, CAP);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.response.status, 413);
});
