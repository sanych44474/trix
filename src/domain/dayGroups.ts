// Muscle-group templates a training day can be built from: the id is a locale key suffix
// (`pday_g_<id>` / `plan_day_g_<id>`), the muscles are catalog muscle names used to pick
// starter exercises.
//
// Pure data, kept in domain/ rather than in either adapter, because BOTH surfaces build days
// from it -- the bot's day manager (src/bot/planDays.ts) and the Mini App's plan editor
// (src/webapp/planApi.ts). It previously lived in the bot module; importing it from there made
// the webapp depend on the bot (and on grammY) for a list of strings, which inverts the layering
// the rest of the codebase keeps.
export const DAY_GROUPS: { id: string; muscles: string[] }[] = [
  { id: "chest", muscles: ["chest", "triceps"] },
  { id: "back", muscles: ["middle back", "lats", "biceps"] },
  { id: "legs", muscles: ["quadriceps", "hamstrings", "glutes", "calves"] },
  { id: "shoulders", muscles: ["shoulders", "traps"] },
  { id: "arms", muscles: ["biceps", "triceps"] },
  { id: "full", muscles: ["chest", "middle back", "quadriceps", "shoulders"] },
  { id: "core", muscles: ["abdominals"] },
];
