// Generates the native app's muscle classification from the server rules (src/domain/exerciseMuscles.ts):
//   mobile/shared/src/commonMain/kotlin/app/hacklimits/shared/muscles/MuscleRulesGenerated.kt  (rule table)
//   mobile/shared/src/commonTest/kotlin/app/hacklimits/shared/muscles/MuscleFixturesGenerated.kt (fixtures, embedded)
//   test/fixtures/muscle-classification.json                                                    (golden cases)
// The rule table is read from the TypeScript AST, so the TS file stays the only place rules are edited.
// Fixture expectations are computed by the TS classifier, never written by hand.
// Usage: npm run gen:kotlin-muscles   (test/muscle-classification.test.ts fails while outputs are stale)
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PATHS = {
  tsRules: join(ROOT, "src/domain/exerciseMuscles.ts"),
  kotlinRules: join(ROOT, "mobile/shared/src/commonMain/kotlin/app/hacklimits/shared/muscles/MuscleRulesGenerated.kt"),
  kotlinFixtures: join(ROOT, "mobile/shared/src/commonTest/kotlin/app/hacklimits/shared/muscles/MuscleFixturesGenerated.kt"),
  jsonFixtures: join(ROOT, "test/fixtures/muscle-classification.json"),
};

// Golden inputs, EN + UK, with the tricky patterns (ordering, negative lookaheads, region words, custom names).
// A learned entry's name must not be used by any other case (the TS side registers learned entries globally).
export const FIXTURE_CASES = [
  { name: "Bench Press" },
  { name: "Жим лежачи" },
  { name: "Жим штанги лежачи вузьким хватом" },
  { name: "Французький жим лежачи" },
  { name: "Розгинання рук на блоці" },
  { name: "Розгинання гантелі з-за голови" },
  { name: "Triceps pushdown" },
  { name: "Skull crusher" },
  { name: "Tate press" },
  { name: "Розгинання ніг" },
  { name: "Leg extension" },
  { name: "Згинання ніг лежачи" },
  { name: "Сгибание ног лежа" },
  { name: "Leg curl" },
  { name: "Nordic curl" },
  { name: "Згинання рук зі штангою" },
  { name: "Згинання гантелей сидячи" },
  { name: "Dumbbell curl" },
  { name: "Concentration curl" },
  { name: "Zottman curl" },
  { name: "Hammer curl" },
  { name: "Wrist curl" },
  { name: "Румунська тяга" },
  { name: "Romanian deadlift" },
  { name: "Deadlift" },
  { name: "Sumo deadlift" },
  { name: "Тяга сумо" },
  { name: "Станова тяга" },
  { name: "Ривкова тяга" },
  { name: "Power clean" },
  { name: "Power snatch" },
  { name: "Clean and press" },
  { name: "Crunch" },
  { name: "Скручування на підлозі" },
  { name: "Скручування з млинцем" },
  { name: "Russian twist" },
  { name: "Hanging leg raise" },
  { name: "Підйом колін у висі" },
  { name: "Squat" },
  { name: "Присідання з штангою" },
  { name: "Hack squat" },
  { name: "Жим ногами" },
  { name: "Lunges" },
  { name: "Болгарські спліт присідання" },
  { name: "Hip thrust" },
  { name: "Ягодичний міст" },
  { name: "Calf raise" },
  { name: "Підйом на носки стоячи" },
  { name: "Pull-up" },
  { name: "Підтягування" },
  { name: "Lat pulldown" },
  { name: "Тяга верхнього блоку" },
  { name: "Barbell Row" },
  { name: "Тяга штанги в нахилі" },
  { name: "One-Arm Row" },
  { name: "Rowing" },
  { name: "Веслування на тренажері" },
  { name: "Running" },
  { name: "Біг на доріжці" },
  { name: "Велосипед" },
  { name: "Скакалка" },
  { name: "Планка" },
  { name: "Plank" },
  { name: "Бічна планка" },
  { name: "Жим гантелей над головою" },
  { name: "Махи гантелями в сторони" },
  { name: "Face pull" },
  { name: "Шраги зі штангою" },
  { name: "Молотки" },
  { name: "Farmer's walk" },
  { name: "Ходьба фермера" },
  { name: "Ходьба" },
  { name: "Гіперекстензія" },
  { name: "Dips" },
  { name: "Брусья" },
  { name: "Отжимания" },
  { name: "Push-ups" },
  { name: "Burpees" },
  { name: "Mountain climbers" },
  { name: "Hip circles" },
  { name: "Knee circles" },
  { name: "Neck extension" },
  { name: "Пуловер" },
  { name: "Kettlebell swing" },
  { name: "Вправа на груди" },
  { name: "Leg day finisher" },
  { name: "Arm circles" },
  { name: "Warm-up" },
  { name: "Zumba Party" },
  { name: "Yoga flow" },
  { name: "Club Gizmo", learned: { primary: ["forearm", "not-a-slug"], secondary: ["abs"] } },
  { name: "Odd machine", learned: { primary: ["chest"], secondary: [] } },
  { name: "Squat Gizmo", learned: { primary: ["chest"], secondary: [] } },
  { name: "Mystery lever", learned: { primary: ["not-a-slug"], secondary: ["calves"] } },
];

const KOTLIN_FLAGS = "iu";

function fail(message) {
  throw new Error(`gen-kotlin-muscle-rules: ${message}`);
}

// The TS rule table as plain data: the RegExp's own source and flags, so the JS semantics carry over as-is.
function toRows(table, varName, arity) {
  return table.map((row) => {
    if (row.length !== arity) fail(`${varName} row has ${row.length} fields, expected ${arity}`);
    const [re, primary, secondary = []] = row;
    if (!(re instanceof RegExp)) fail(`${varName} row does not start with a RegExp`);
    if (re.flags !== KOTLIN_FLAGS) fail(`${varName} regex /${re.source}/${re.flags} has flags, expected "${KOTLIN_FLAGS}"`);
    if (re.source.includes("(?<")) fail(`${varName} regex /${re.source}/ uses lookbehind (iOS < 16.4, Kotlin/Native)`);
    return { source: re.source, primary: [...primary], secondary: [...secondary] };
  });
}

// Kotlin raw string: no triple quote, no trailing quote, and "$" escaped as a template.
function kotlinRaw(text) {
  if (text.includes('"""') || text.endsWith('"')) fail(`pattern cannot be a Kotlin raw string: ${text}`);
  return `"""${text.replace(/\$/g, () => "${'$'}")}"""`;
}

function kotlinList(items) {
  return items.length ? `listOf(${items.map((s) => JSON.stringify(s)).join(", ")})` : "emptyList()";
}

function renderRules(rules, region) {
  const line = (r) => `    MuscleRule(${kotlinRaw(r.source)}, ${kotlinList(r.primary)}, ${kotlinList(r.secondary)}),`;
  return [
    "// GENERATED by scripts/gen-kotlin-muscle-rules.mjs from src/domain/exerciseMuscles.ts. Do not edit.",
    "// Regenerate with: npm run gen:kotlin-muscles",
    "// Order matters: the first matching rule wins, exactly as in the TS table.",
    "package app.hacklimits.shared.muscles",
    "",
    "internal val MUSCLE_RULES: List<MuscleRule> = listOf(",
    ...rules.map(line),
    ")",
    "",
    "// Last resort: the coarse region a name mentions.",
    "internal val REGION_FALLBACK_RULES: List<MuscleRule> = listOf(",
    ...region.map(line),
    ")",
    "",
  ].join("\n");
}

function renderFixtures(json) {
  return [
    "// GENERATED by scripts/gen-kotlin-muscle-rules.mjs from test/fixtures/muscle-classification.json. Do not edit.",
    "// Regenerate with: npm run gen:kotlin-muscles",
    "package app.hacklimits.shared.muscles",
    "",
    `internal val MUSCLE_FIXTURES_JSON: String = ${kotlinRaw(json)}`,
    "",
  ].join("\n");
}

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns the generated text for every output, without touching the disk (the sync test compares these).
export async function buildArtifacts() {
  const classifier = await import(pathToFileURL(PATHS.tsRules).href);
  const rules = toRows(classifier.RULES, "RULES", 3);
  const region = toRows(classifier.REGION_FALLBACK, "REGION_FALLBACK", 2);

  const seen = new Set();
  for (const c of FIXTURE_CASES) {
    const key = normalizeName(c.name);
    if (seen.has(key)) fail(`duplicate fixture name ${c.name}`);
    seen.add(key);
  }

  // Register learned entries first, so the expectations see them exactly as a live caller would.
  for (const c of FIXTURE_CASES) {
    if (c.learned) classifier.registerLearnedMuscles([{ name: c.name, ...c.learned }]);
  }
  const cases = FIXTURE_CASES.map((c) => {
    const hit = classifier.musclesForExercise(c.name);
    const expected = hit ? { primary: hit.primary, secondary: hit.secondary } : null;
    return c.learned ? { name: c.name, learned: c.learned, expected } : { name: c.name, expected };
  });
  const json = `${JSON.stringify({ source: "src/domain/exerciseMuscles.ts", cases }, null, 2)}\n`;

  return {
    rulesKt: renderRules(rules, region),
    fixturesKt: renderFixtures(json),
    fixturesJson: json,
  };
}

// Line endings are normalized because git may check the files out with CRLF on Windows.
export function sameText(a, b) {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

async function main() {
  const { rulesKt, fixturesKt, fixturesJson } = await buildArtifacts();
  writeFileSync(PATHS.kotlinRules, rulesKt);
  writeFileSync(PATHS.kotlinFixtures, fixturesKt);
  writeFileSync(PATHS.jsonFixtures, fixturesJson);
  console.log(`wrote ${PATHS.kotlinRules}\nwrote ${PATHS.kotlinFixtures}\nwrote ${PATHS.jsonFixtures}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
