// The AI response cache keeps only answers worth replaying. A degraded provider's parseable but
// empty answer ({"items":[]}) used to be cached for 30 days under the food text, so everyone typing
// that food got "unreadable" with no provider even asked, long after the providers recovered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiJSON } from "../src/ai";
import type { Env } from "../src/types";

function provider(answer: unknown) {
  const real = globalThis.fetch;
  const state = { calls: 0, restore: () => { globalThis.fetch = real; } };
  globalThis.fetch = (async () => { state.calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 }); }) as typeof fetch;
  return state;
}

const ask = (db: ReturnType<typeof newDb>) => aiJSON<{ items: unknown[] }>({ GROQ_API_KEY: "k" } as unknown as Env, {
  system: "nutrition", user: "борщ 300 г", kind: "nutrition", db,
  cacheIf: (parsed) => Array.isArray((parsed as { items?: unknown[] }).items) && (parsed as { items: unknown[] }).items.length > 0,
});

test("an empty answer is returned but not cached: the next ask reaches a provider again", async () => {
  const db = newDb();
  const p = provider({ items: [] });
  try {
    assert.deepEqual(await ask(db), { items: [] });
    await ask(db);
    assert.equal(p.calls, 2);
  } finally { p.restore(); }
});

test("a useful answer is cached: the next ask calls no provider", async () => {
  const db = newDb();
  const p = provider({ items: [{ desc: "борщ", kcal: 150 }] });
  try {
    await ask(db);
    const again = await ask(db);
    assert.equal(p.calls, 1);
    assert.equal(again.items.length, 1);
  } finally { p.restore(); }
});
