import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiCompatChat, readSse } from "../src/ai/http";

const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { const e = new TextEncoder(); for (const ch of chunks) c.enqueue(e.encode(ch)); c.close(); },
});

test("readSse: events split across chunks, CRLF, [DONE]", async () => {
  const got: string[] = [];
  await readSse(streamOf(['data: {"a":1}\r\n\r\nda', 'ta: {"a":2}\n\n', ": keep-alive\n\n", "data: [DONE]\n\n"]), (d) => got.push(d));
  assert.deepEqual(got, ['{"a":1}', '{"a":2}']);
});

test("openaiCompatChat streams deltas to onPartial and returns the full text", async () => {
  const orig = globalThis.fetch;
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    sentBody = JSON.parse(init.body);
    return new Response(streamOf([
      'data: {"choices":[{"delta":{"content":"{\\"reply\\":\\"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo\\"}"}}]}\n\n',
      "data: [DONE]\n\n",
    ]), { headers: { "content-type": "text/event-stream" } });
  }) as never;
  try {
    const partials: string[] = [];
    const text = await openaiCompatChat("https://x", "k", { model: "m" }, "T", 1000, undefined, undefined, (s) => partials.push(s));
    assert.equal(sentBody.stream, true);
    assert.equal(text, '{"reply":"Hello"}');
    assert.deepEqual(partials, ['{"reply":"Hel', '{"reply":"Hello"}']);
  } finally { globalThis.fetch = orig; }
});

test("openaiCompatChat without onPartial stays a plain JSON request", async () => {
  const orig = globalThis.fetch;
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    sentBody = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  }) as never;
  try {
    assert.equal(await openaiCompatChat("https://x", "k", { model: "m" }, "T"), "ok");
    assert.equal(sentBody.stream, undefined);
  } finally { globalThis.fetch = orig; }
});
