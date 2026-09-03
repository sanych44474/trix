// Seed the D1 `exercises` catalog from API Ninjas. Dev-time tool (NOT bundled in the Worker).
// Reads EXERCISES_API_KEY (one or more comma-separated keys) from env or .dev.vars, fetches
// across all muscles × difficulties (free tier = 10/request, no offset), dedups by a stable
// id = sha1(lower(name)), and writes _seed-exercises.sql (INSERT ... ON CONFLICT upserts).
// Then apply it:  npx wrangler d1 execute trix --local  --file _seed-exercises.sql
//                 npx wrangler d1 execute trix --remote --file _seed-exercises.sql
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

function fromDevVars(key) {
  try {
    const txt = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    return txt.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"))?.[1];
  } catch {
    return undefined;
  }
}

const raw = process.env.EXERCISES_API_KEY || fromDevVars("EXERCISES_API_KEY");
const keys = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!keys.length) {
  console.error("Set EXERCISES_API_KEY (comma-separated for multiple keys) in env or .dev.vars");
  process.exit(1);
}

const MUSCLES = [
  "abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes",
  "hamstrings", "lats", "lower_back", "middle_back", "neck", "quadriceps", "traps", "triceps",
];
const DIFFICULTIES = ["", "beginner", "intermediate", "expert"]; // "" = unfiltered base call

let keyIdx = 0;
async function fetchExercises(muscle, difficulty) {
  const qs = new URLSearchParams({ muscle });
  if (difficulty) qs.set("difficulty", difficulty);
  // Try each key in turn (rotate on rate-limit / failure).
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(keyIdx + attempt) % keys.length];
    try {
      const r = await fetch(`https://api.api-ninjas.com/v1/exercises?${qs}`, { headers: { "X-Api-Key": key } });
      if (r.ok) {
        keyIdx = (keyIdx + attempt) % keys.length; // stick with the working key
        return await r.json();
      }
      if (![401, 403, 429].includes(r.status)) {
        console.error(`  ${muscle}/${difficulty || "any"}: HTTP ${r.status}`);
        return [];
      }
    } catch (e) {
      console.error(`  ${muscle}/${difficulty || "any"}: ${e.message}`);
    }
  }
  return [];
}

const byId = new Map();
for (const muscle of MUSCLES) {
  for (const difficulty of DIFFICULTIES) {
    const list = await fetchExercises(muscle, difficulty);
    for (const e of Array.isArray(list) ? list : []) {
      if (!e?.name) continue;
      const id = createHash("sha1").update(e.name.toLowerCase()).digest("hex").slice(0, 16);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: e.name,
          type: e.type ?? "",
          muscle: e.muscle ?? muscle,
          difficulty: e.difficulty ?? "",
          equipments: Array.isArray(e.equipments) ? e.equipments : [],
          instructions: e.instructions ?? "",
          safety_info: e.safety_info ?? "",
        });
      }
    }
    process.stderr.write(".");
  }
}

const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const rows = [...byId.values()].map(
  (e) =>
    `INSERT INTO exercises (id, name, type, muscle, difficulty, equipments, instructions, safety_info, fetchedAt) VALUES (${esc(e.id)}, ${esc(e.name)}, ${esc(e.type)}, ${esc(e.muscle)}, ${esc(e.difficulty)}, ${esc(JSON.stringify(e.equipments))}, ${esc(e.instructions)}, ${esc(e.safety_info)}, ${esc(now)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, muscle=excluded.muscle, difficulty=excluded.difficulty, equipments=excluded.equipments, instructions=excluded.instructions, safety_info=excluded.safety_info, fetchedAt=excluded.fetchedAt;`,
);
writeFileSync("_seed-exercises.sql", rows.join("\n"));

const perMuscle = {};
for (const e of byId.values()) perMuscle[e.muscle] = (perMuscle[e.muscle] ?? 0) + 1;
console.error(`\nWrote _seed-exercises.sql — ${byId.size} unique exercises`);
console.error("Per muscle:", JSON.stringify(perMuscle));
