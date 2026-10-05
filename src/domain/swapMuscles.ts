// Which catalog muscles a swap should draw from. Two inputs:
//  - the exercise being replaced: its primary muscle, read off its name by the same lookup the
//    body map uses (exerciseMuscles.ts). The day's muscle group is only a last resort -- on a
//    "legs + arms" day it turned a triceps pushdown's swap list into lunges and leg extensions;
//  - a muscle the person typed ("трицепс", "груди", "glutes"): five exercises for it.
// Catalog muscles are free-exercise-db's enum ("middle back", "abdominals", ...). Pure;
// test/swap-muscles.test.ts.
import { musclesForExercise, type Slug } from "./exerciseMuscles";

const SLUG_TO_CATALOG: Record<Slug, string[]> = {
  chest: ["chest"],
  "upper-back": ["lats", "middle back"],
  "lower-back": ["lower back"],
  trapezius: ["traps"],
  deltoids: ["shoulders"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearm: ["forearms"],
  abs: ["abdominals"],
  obliques: ["abdominals"],
  quadriceps: ["quadriceps"],
  hamstring: ["hamstrings"],
  gluteal: ["glutes"],
  calves: ["calves"],
  adductors: ["adductors"],
  tibialis: ["calves"],
  neck: ["neck"],
};

/** Catalog muscles for the exercise's main movers (empty when the name isn't recognised). */
export function catalogMusclesForExercise(name: string): string[] {
  const m = musclesForExercise(name);
  return m ? [...new Set(m.primary.slice(0, 1).flatMap((s) => SLUG_TO_CATALOG[s]))] : [];
}

// Typed muscle names (uk / ru / en), checked in order; a whole word or a clear stem only, so an
// exercise name typed into the same field ("Французький жим") isn't mistaken for a muscle.
const QUERY: Array<[Slug, RegExp]> = [
  ["triceps", /^(трицепс\p{L}*|трицеп\p{L}*|triceps?)$/iu],
  ["biceps", /^(біцепс\p{L}*|бицепс\p{L}*|biceps?)$/iu],
  ["forearm", /^(передпліч\p{L}*|предплеч\p{L}*|forearms?)$/iu],
  ["chest", /^(груди|грудні|грудь|грудные|chest|pecs?)$/iu],
  ["upper-back", /^(спина|спину|широчайш\p{L}*|найширш\p{L}*|back|lats?)$/iu],
  ["lower-back", /^(поперек|поясниц\p{L}*|lower back)$/iu],
  ["trapezius", /^(трапец\p{L}*|traps?)$/iu],
  ["deltoids", /^(плечі|плечи|дельт\p{L}*|shoulders?|delts?)$/iu],
  ["abs", /^(прес|пресс|живіт|живот|abs|core)$/iu],
  ["quadriceps", /^(ноги|квадрицепс\p{L}*|квадри\p{L}*|legs?|quads?)$/iu],
  ["hamstring", /^(біцепс стегна|задня поверхня стегна|hamstrings?)$/iu],
  ["gluteal", /^(сідниці|сідничні|ягодиц\p{L}*|glutes?)$/iu],
  ["calves", /^(ікри|литки|икры|calves|calf)$/iu],
  ["adductors", /^(привідні|приводящие|adductors?)$/iu],
];

/** A typed muscle name → its slug and catalog muscles; null when the text is not a muscle. */
export function muscleFromQuery(text: string): { slug: Slug; catalog: string[] } | null {
  const q = text.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = QUERY.find(([, re]) => re.test(q));
  return hit ? { slug: hit[0], catalog: SLUG_TO_CATALOG[hit[0]] } : null;
}
