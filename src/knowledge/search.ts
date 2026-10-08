// Knowledge-base retrieval for the AI coach: a few passages from the AI Search instance
// (knowledge/docs.ts) that the coach's system prompt is grounded in.
//
// Free-tier discipline (AI Search on a third-party data source: about 1,000 queries a month):
//   - only real questions are searched (short chit-chat like "thanks" is skipped);
//   - answers are cached for 30 days in v2_ai_cache by normalised question and language, so a
//     repeated question never spends a query;
//   - a monthly counter (AI_SEARCH_MONTHLY_QUERIES, default 900) spread over the days of the
//     month as a daily cap, so one busy day can't spend the whole month;
//   - query rewriting and reranking stay off -- both would run an extra model and spend neurons.
// Everything fails open: no binding, quota spent, timeout or error → "" and the coach answers
// from its own context as before.
import { aiCacheStmt, getAiCache } from "../adapters/d1/v2AiTelemetry";
import type { Env, Lang } from "../types";

const DEFAULT_MONTHLY = 900;
const CACHE_TTL_MS = 30 * 86_400_000;
const TIMEOUT_MS = 3_000;
const MIN_QUESTION_CHARS = 15;
const MAX_PASSAGES = 4;
const MAX_PASSAGE_CHARS = 700;

export function monthlyQueryCap(env: Pick<Env, "AI_SEARCH_MONTHLY_QUERIES">): number {
  const n = Number(env.AI_SEARCH_MONTHLY_QUERIES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY;
}

/** Queries allowed per UTC day: the month's cap spread evenly, at least 1 while any are left. */
export function dailyQueryCap(monthly: number, now = new Date()): number {
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return monthly > 0 ? Math.max(1, Math.floor(monthly / days)) : 0;
}

/** Lower-case, collapse whitespace, strip punctuation at the ends -- the cache identity. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "").slice(0, 300);
}

/** Worth a search: long enough and not just greetings / thanks / emoji. */
export function isSearchable(q: string): boolean {
  const n = normalizeQuestion(q);
  if (n.length < MIN_QUESTION_CHARS) return false;
  return (n.match(/\p{L}+/gu) ?? []).length >= 3;
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function counter(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare("SELECT value FROM v2_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return Number(row?.value) || 0;
}

function bumpStmt(db: D1Database, key: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO v2_settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
    .bind(key);
}

/** Reserve one query against the monthly and daily caps. False when either is spent. */
async function takeQuota(db: D1Database, env: Pick<Env, "AI_SEARCH_MONTHLY_QUERIES">, now = new Date()): Promise<boolean> {
  const monthly = monthlyQueryCap(env);
  const day = now.toISOString().slice(0, 10);
  const monthKey = `kb_queries:${day.slice(0, 7)}`;
  const dayKey = `kb_queries:${day}`;
  const [m, d] = await Promise.all([counter(db, monthKey), counter(db, dayKey)]);
  if (m >= monthly || d >= dailyQueryCap(monthly, now)) return false;
  await db.batch([bumpStmt(db, monthKey), bumpStmt(db, dayKey)]);
  return true;
}

/** Queries used this month and the cap (owner AI report). */
export async function knowledgeQueryUsage(db: D1Database, env: Pick<Env, "AI_SEARCH_MONTHLY_QUERIES">): Promise<{ used: number; cap: number }> {
  const used = await counter(db, `kb_queries:${new Date().toISOString().slice(0, 7)}`).catch(() => 0);
  return { used, cap: monthlyQueryCap(env) };
}

type Chunk = { text: string; score: number; item: { key: string } };

/** The passages to use: the asker's language first, then the other language, best score first. */
export function pickPassages(chunks: Chunk[], lang: Lang): string[] {
  const mine = chunks.filter((c) => c.item.key.startsWith(`${lang}/`));
  const rest = chunks.filter((c) => !c.item.key.startsWith(`${lang}/`));
  const ordered = [...mine.sort((a, b) => b.score - a.score), ...rest.sort((a, b) => b.score - a.score)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of ordered) {
    const text = c.text.trim().replace(/\n{3,}/g, "\n\n").slice(0, MAX_PASSAGE_CHARS);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

/** Up to four knowledge-base passages relevant to `question`, or [] (never throws). */
export async function searchKnowledge(env: Pick<Env, "KNOWLEDGE" | "AI_SEARCH_MONTHLY_QUERIES">, db: D1Database, question: string, lang: Lang): Promise<string[]> {
  if (!env.KNOWLEDGE || !isSearchable(question)) return [];
  try {
    const norm = normalizeQuestion(question);
    const cacheKey = `kb:${lang}:${await sha(norm)}`;
    const cached = await getAiCache(db, cacheKey).catch(() => null);
    if (cached !== null) return JSON.parse(cached) as string[];
    if (!(await takeQuota(db, env))) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      env.KNOWLEDGE.search({
        query: norm,
        ai_search_options: {
          query_rewrite: { enabled: false },
          reranking: { enabled: false },
          retrieval: { max_num_results: 8, match_threshold: 0.4 },
        },
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("AI Search timeout")), TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    const passages = pickPassages(res.chunks ?? [], lang);
    await aiCacheStmt(db, cacheKey, JSON.stringify(passages), CACHE_TTL_MS).run();
    return passages;
  } catch {
    return [];
  }
}

/** The passages as a system-prompt block, or "" when there are none. */
export function knowledgeBlock(passages: string[]): string {
  if (!passages.length) return "";
  return (
    "\n\nReference notes from the app's knowledge base (use them when they answer the question; " +
    "prefer the athlete's own plan and data when they conflict; do not quote them verbatim):\n" +
    passages.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")
  );
}
