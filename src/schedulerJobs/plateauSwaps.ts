// Plateau / maxed-bodyweight swaps applied by the Monday progression: a fresh same-muscle
// variation at -10% or a harder one. Split out of scheduler.ts.
import type { PlanDoc, PlanExercise } from "../types";
import { findHarderExercise, getCatalogExercise, getExerciseTranslation, listCandidatesByMuscles } from "../adapters/d1/v2Catalog";
import { cleanAi, t } from "../locales/i18n";

/** Drop a "60 kg" load by ~10% (rounded to 2.5 kg) to restart progression on a plateau swap. */
function deload10(s: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(s.trim());
  if (!m) return s; // "Bodyweight" etc.
  const kg = Math.max(2.5, Math.round((parseFloat(m[1]) * 0.9) / 2.5) * 2.5);
  return `${kg}${m[2] ? " " + m[2].trim() : " kg"}`;
}

/** Pick a same-muscle catalog alternative for a stalled/maxed exercise (EN+UK attached),
 * preserving the set scheme. `harder` aims one difficulty up (for maxed bodyweight lifts);
 * otherwise it's a fresh variation at a slightly reduced load to break a plateau. Best-effort. */
async function swapExercise(
  db: D1Database,
  lang: string,
  ex: PlanExercise,
  usedIds: Set<string>,
  harder: boolean,
): Promise<PlanExercise | null> {
  if (!ex.exerciseId) return null;
  const cat = await getCatalogExercise(db, ex.exerciseId);
  if (!cat) return null;
  let pick = harder ? await findHarderExercise(db, cat.muscle, cat.difficulty ?? "beginner", [...usedIds]) : null;
  if (!pick) {
    const cands = await listCandidatesByMuscles(db, [cat.muscle], { perMuscle: 25, total: 25 });
    pick = cands.find((c) => !usedIds.has(c.id) && c.id !== ex.exerciseId) ?? null;
  }
  if (!pick) return null;
  let name = pick.name;
  let technique = cleanAi(pick.instructions || "");
  if (lang !== "en") {
    const tr = await getExerciseTranslation(db, pick.id, lang);
    if (tr) { name = tr.name; technique = cleanAi(tr.instructions); }
  }
  return {
    ...ex,
    name,
    technique,
    exerciseId: pick.id,
    canonicalName: pick.name,
    startWeight: harder ? ex.startWeight : deload10(ex.startWeight),
  };
}

/** Apply plateau / maxed-bodyweight swaps to a (cloned) plan in place, returning the localized
 * notification lines. Mutates `plan.split` exercises. */
export async function applySwaps(
  db: D1Database,
  lang: string,
  plan: PlanDoc,
  names: { name: string; harder: boolean }[],
): Promise<string[]> {
  const lines: string[] = [];
  const usedIds = new Set(plan.split.flatMap((d) => d.exercises.map((e) => e.exerciseId).filter(Boolean) as string[]));
  for (const { name, harder } of names) {
    for (const day of plan.split) {
      const i = day.exercises.findIndex((e) => e.name === name);
      if (i < 0) continue;
      const repl = await swapExercise(db, lang, day.exercises[i], usedIds, harder);
      if (repl) {
        if (repl.exerciseId) usedIds.add(repl.exerciseId);
        const from = day.exercises[i].name;
        day.exercises[i] = repl;
        lines.push(t(lang as "en" | "uk", harder ? "progression_levelup_ex" : "progression_swap_ex", { from, to: repl.name }));
      }
      break;
    }
  }
  return lines;
}
