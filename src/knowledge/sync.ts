// Keeps the R2 bucket behind the AI Search instance (`KB` → trix-kb, indexed by
// wispy-breeze-ced3) equal to buildKnowledgeDocs(). Diff-based: each object carries the SHA-256
// of its body in customMetadata, so a run writes only new or changed documents and deletes
// documents that no longer exist -- unchanged documents cost nothing to re-index. Writes are
// capped per run (Workers subrequest budget); the scheduler calls again on the next tick while
// `more` is true. Only keys under the generated prefixes (uk/, en/) are managed, so documents
// the owner uploads elsewhere in the bucket (e.g. manual/) are indexed and never touched.
// After a run that changed something, an indexing job is requested so the changes are
// searchable within minutes rather than at the instance's next periodic sync.
import { KB_LANGS, type KnowledgeDoc, type TechniqueRow, buildKnowledgeDocs } from "./docs";
import type { Env } from "../types";

export const KB_WRITES_PER_RUN = 60;
const MANAGED = KB_LANGS.map((l) => `${l}/`);

export interface KbSyncResult {
  put: number;
  deleted: number;
  unchanged: number;
  more: boolean;
  reindexed: boolean;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** key → stored hash for every managed object in the bucket. */
async function storedHashes(bucket: R2Bucket): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const prefix of MANAGED) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
      for (const o of page.objects) out.set(o.key, o.customMetadata?.sha256 ?? "");
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return out;
}

export async function loadTechniqueRows(db: D1Database): Promise<TechniqueRow[]> {
  try {
    const r = await db.prepare("SELECT exerciseId, lang, steps, name FROM v2_technique_steps ORDER BY exerciseId, lang").all<TechniqueRow>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

/** One sync pass. `docs` is injectable for tests; defaults to the full knowledge base. */
export async function syncKnowledge(env: Pick<Env, "KB" | "KNOWLEDGE" | "DB">, docs?: KnowledgeDoc[]): Promise<KbSyncResult> {
  const all = docs ?? buildKnowledgeDocs(await loadTechniqueRows(env.DB));
  const stored = await storedHashes(env.KB);
  const wanted = new Set(all.map((d) => d.key));
  let budget = KB_WRITES_PER_RUN;
  let put = 0;
  let unchanged = 0;
  let pending = 0;
  for (const doc of all) {
    const hash = await sha256(doc.body);
    if (stored.get(doc.key) === hash) {
      unchanged++;
      continue;
    }
    if (budget <= 0) {
      pending++;
      continue;
    }
    await env.KB.put(doc.key, doc.body, { httpMetadata: { contentType: "text/markdown; charset=utf-8" }, customMetadata: { sha256: hash } });
    budget--;
    put++;
  }
  const stale = [...stored.keys()].filter((k) => !wanted.has(k));
  // R2 deletes up to 1000 keys per call; one call is plenty here.
  const toDelete = budget > 0 ? stale.slice(0, 1000) : [];
  if (toDelete.length) await env.KB.delete(toDelete);
  const deleted = toDelete.length;
  const more = pending > 0 || stale.length > deleted;
  let reindexed = false;
  if ((put || deleted) && !more) {
    // Best-effort: the instance also picks changes up on its own periodic sync.
    reindexed = await env.KNOWLEDGE.jobs.create().then(() => true, () => false);
  }
  return { put, deleted, unchanged, more, reindexed };
}
