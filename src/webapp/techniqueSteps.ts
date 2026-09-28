// Step-by-step technique under the logger's technique pictures. free-exercise-db (Unlicense) only
// has English instructions, often long; the AI condenses them into 3–5 short steps in the user's
// language once per exercise and language, cached in v2_technique_steps (migration 0086). The id
// must be one of the database's own (the same index the Mini App matches against), so this never
// fetches an arbitrary URL or caches arbitrary keys.
import type { Env, Lang, UserDoc } from "../types";
import { aiText } from "../ai/index";
import { cleanAi } from "../locales/i18n";
import { FREE_EXERCISE_DB_COMMIT, FREE_EXERCISE_IDS } from "../../apps/mini-app/src/data/freeExerciseIds";

const KNOWN = new Set(FREE_EXERCISE_IDS);

/** Split the AI's answer into clean steps: one per line, list markers stripped, 3–6 kept. */
export function parseSteps(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => cleanAi(line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 6);
}

async function sourceInstructions(id: string): Promise<string[]> {
  const res = await fetch(`https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_COMMIT}/exercises/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`free-exercise-db ${res.status}`);
  const body = (await res.json()) as { instructions?: unknown };
  return Array.isArray(body.instructions) ? body.instructions.filter((s): s is string => typeof s === "string") : [];
}

export async function techniqueSteps(env: Env, user: UserDoc, id: string): Promise<{ steps: string[] } | null> {
  if (!KNOWN.has(id)) return null;
  const lang: Lang = user.lang === "en" ? "en" : "uk";
  const cached = await env.DB.prepare("SELECT steps FROM v2_technique_steps WHERE exerciseId = ? AND lang = ?").bind(id, lang).first<{ steps: string }>();
  if (cached) return { steps: JSON.parse(cached.steps) as string[] };
  const source = await sourceInstructions(id);
  if (!source.length) return { steps: [] };
  const answer = await aiText(env, {
    system:
      `You are a strength coach. Rewrite the exercise instructions as 3 to 5 short steps in ${lang === "uk" ? "Ukrainian" : "English"}, ` +
      "one step per line, each under 120 characters, imperative mood, keeping every safety cue. Plain text: no numbering, no markdown.",
    user: `${id.replace(/_/g, " ")}\n\n${source.join("\n")}`,
    temperature: 0.2,
    kind: "translate",
    db: env.DB,
    userId: user._id,
  });
  const steps = parseSteps(answer);
  if (steps.length >= 2) {
    await env.DB.prepare("INSERT OR REPLACE INTO v2_technique_steps (exerciseId, lang, steps, createdAt) VALUES (?, ?, ?, ?)")
      .bind(id, lang, JSON.stringify(steps), new Date().toISOString())
      .run();
  }
  return { steps };
}
