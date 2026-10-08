import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeDocs } from "../src/knowledge/docs";
import { KB_WRITES_PER_RUN, syncKnowledge } from "../src/knowledge/sync";
import { dailyQueryCap, isSearchable, knowledgeBlock, normalizeQuestion, pickPassages, searchKnowledge } from "../src/knowledge/search";
import { GUIDES } from "../src/knowledge/guides";
import { PROGRAMS } from "../src/domain/programCatalog";
import { newDb } from "./harness";
import type { Env } from "../src/types";

test("docs: guides, programs and exercises in both languages, deterministic", () => {
  const docs = buildKnowledgeDocs();
  const keys = docs.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.filter((k) => k.includes("/guides/")).length, GUIDES.length * 2);
  assert.equal(keys.filter((k) => k.includes("/programs/")).length, PROGRAMS.length * 2);
  assert.ok(keys.includes("uk/exercises/chest.md") && keys.includes("en/exercises/chest.md"));
  assert.ok(keys.every((k) => /^(uk|en)\/[a-z-]+\/[\w-]+\.md$/.test(k)));
  assert.deepEqual(buildKnowledgeDocs(), docs);
  // Every guide is written in both languages.
  for (const g of GUIDES) assert.ok(g.uk.startsWith("# ") && g.en.startsWith("# "), g.slug);
  // Total stays far below AI Search's monthly free ingest.
  assert.ok(docs.reduce((s, d) => s + d.body.length, 0) < 1_000_000);
});

test("docs: cached technique steps join the exercise documents", () => {
  const docs = buildKnowledgeDocs([{ exerciseId: "Barbell_Full_Squat", lang: "uk", steps: JSON.stringify(["Стань під гриф", "Присядь"]), name: "Присідання зі штангою" }]);
  const quads = docs.find((d) => d.key === "uk/exercises/quadriceps.md")!.body;
  assert.match(quads, /## Присідання зі штангою \(Barbell Full Squat\)[^#]*1\. Стань під гриф\n2\. Присядь/);
});

function fakeBucket() {
  const store = new Map<string, { body: string; meta: Record<string, string> }>();
  let puts = 0;
  const bucket = {
    async list(o: { prefix: string; cursor?: string }) {
      const all = [...store.keys()].filter((k) => k.startsWith(o.prefix)).sort();
      const start = Number(o.cursor ?? 0);
      const page = all.slice(start, start + 50);
      return { objects: page.map((key) => ({ key, customMetadata: store.get(key)!.meta })), truncated: start + 50 < all.length, cursor: String(start + 50) };
    },
    async put(key: string, body: string, o: { customMetadata: Record<string, string> }) { puts++; store.set(key, { body, meta: o.customMetadata }); },
    async delete(keys: string[]) { for (const k of keys) store.delete(k); },
  };
  return { bucket, store, puts: () => puts };
}

test("sync: capped writes, continues, skips unchanged, deletes stale, keeps unmanaged keys, reindexes once", async () => {
  const { bucket, store, puts } = fakeBucket();
  let jobs = 0;
  store.set("manual/notes.md", { body: "mine", meta: {} });
  store.set("uk/guides/old.md", { body: "gone", meta: { sha256: "x" } });
  const env = { KB: bucket, KNOWLEDGE: { jobs: { create: async () => { jobs++; return {}; } } }, DB: newDb() } as unknown as Env;
  const docs = Array.from({ length: KB_WRITES_PER_RUN + 10 }, (_, i) => ({ key: `en/guides/g${i}.md`, body: `doc ${i}` }));
  const first = await syncKnowledge(env, docs);
  assert.deepEqual([first.put, first.more, first.reindexed], [KB_WRITES_PER_RUN, true, false]);
  const second = await syncKnowledge(env, docs);
  assert.deepEqual([second.put, second.deleted, second.unchanged, second.more, second.reindexed], [10, 1, KB_WRITES_PER_RUN, false, true]);
  assert.ok(store.has("manual/notes.md") && !store.has("uk/guides/old.md"));
  const third = await syncKnowledge(env, docs);
  assert.deepEqual([third.put, third.deleted, third.reindexed], [0, 0, false]);
  assert.equal(puts(), KB_WRITES_PER_RUN + 10);
  assert.equal(jobs, 1);
});

test("search helpers: normalising, what is worth a search, daily cap", () => {
  assert.equal(normalizeQuestion("  Скільки БІЛКА   треба?? "), "скільки білка треба");
  assert.equal(isSearchable("дякую!"), false);
  assert.equal(isSearchable("👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍"), false);
  assert.equal(isSearchable("Скільки відпочивати між підходами на присіданнях?"), true);
  assert.equal(dailyQueryCap(900, new Date("2026-10-08T00:00:00Z")), 29);
  assert.equal(dailyQueryCap(10, new Date("2026-10-08T00:00:00Z")), 1);
  assert.equal(dailyQueryCap(0), 0);
  const chunks = [
    { text: "en text", score: 0.9, item: { key: "en/guides/a.md" } },
    { text: "uk low", score: 0.5, item: { key: "uk/guides/a.md" } },
    { text: "uk high", score: 0.8, item: { key: "uk/guides/b.md" } },
    { text: "uk high", score: 0.7, item: { key: "uk/guides/c.md" } },
  ];
  assert.deepEqual(pickPassages(chunks, "uk"), ["uk high", "uk low", "en text"]);
  assert.equal(knowledgeBlock([]), "");
  assert.match(knowledgeBlock(["a"]), /\[1\] a/);
});

test("searchKnowledge: caches by question, respects the daily cap, fails open", async () => {
  const db = newDb() as unknown as D1Database;
  let calls = 0;
  const env = {
    AI_SEARCH_MONTHLY_QUERIES: "31",
    KNOWLEDGE: { search: async () => { calls++; return { chunks: [{ text: `passage ${calls}`, score: 0.8, item: { key: "uk/guides/rest.md" } }] }; } },
  } as unknown as Env;
  const q = "Скільки відпочивати між підходами на присіданнях?";
  assert.deepEqual(await searchKnowledge(env, db, q, "uk"), ["passage 1"]);
  assert.deepEqual(await searchKnowledge(env, db, `  ${q.toUpperCase()} `, "uk"), ["passage 1"]);
  assert.equal(calls, 1);
  // 31 a month over 31 days = 1 a day: the second distinct question today gets nothing.
  assert.deepEqual(await searchKnowledge(env, db, "Як правильно робити румунську тягу з гантелями?", "uk"), []);
  assert.equal(calls, 1);
  assert.deepEqual(await searchKnowledge(env, db, "дякую", "uk"), []);
  const broken = { AI_SEARCH_MONTHLY_QUERIES: "900", KNOWLEDGE: { search: async () => { throw new Error("down"); } } } as unknown as Env;
  assert.deepEqual(await searchKnowledge(broken, newDb() as unknown as D1Database, q, "uk"), []);
  assert.deepEqual(await searchKnowledge({} as Env, db, q, "uk"), []);
});
