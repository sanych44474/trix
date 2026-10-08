// The knowledge base the AI Search instance indexes, built from what the app already knows:
//   {lang}/guides/{slug}.md         hand-written training / nutrition / recovery / app guides
//   {lang}/programs/{id}.md         the 45 ready programs, day by day (domain/programCatalog.ts)
//   {lang}/exercises/{muscle}.md    the 750-exercise library grouped by muscle, with the
//                                   step-by-step technique already cached in v2_technique_steps
//   {lang}/nutrition/{category}.md  the food catalog (domain/foodCatalogData.ts): kcal and
//                                   macros per 100 g and per typical portion
// Pure and deterministic: the same inputs give byte-identical documents, so sync.ts can skip
// everything that didn't change (re-indexing only what changed keeps AI Search ingest small).
import { FREE_EXERCISE_LIB } from "../../apps/mini-app/src/data/freeExerciseLib";
import { catalogFoods } from "../domain/foodCatalog";
import { PROGRAMS, buildProgram } from "../domain/programCatalog";
import { GUIDES } from "./guides";
import type { Lang } from "../types";

export interface KnowledgeDoc {
  key: string;
  body: string;
}

/** Cached technique per exercise and language: v2_technique_steps rows. */
export interface TechniqueRow {
  exerciseId: string;
  lang: string;
  steps: string;
  name: string | null;
}

export const KB_LANGS: Lang[] = ["uk", "en"];

const MUSCLE: Record<string, { en: string; uk: string }> = {
  abs: { en: "Abs and core", uk: "Прес і кор" },
  biceps: { en: "Biceps", uk: "Біцепс" },
  triceps: { en: "Triceps", uk: "Трицепс" },
  forearm: { en: "Forearms and grip", uk: "Передпліччя і хват" },
  chest: { en: "Chest", uk: "Груди" },
  deltoids: { en: "Shoulders (deltoids)", uk: "Плечі (дельти)" },
  trapezius: { en: "Trapezius", uk: "Трапеція" },
  "upper-back": { en: "Upper back (lats, rhomboids)", uk: "Верх спини (найширші, ромбоподібні)" },
  "lower-back": { en: "Lower back", uk: "Поперек" },
  gluteal: { en: "Glutes", uk: "Сідниці" },
  quadriceps: { en: "Quadriceps (front of thigh)", uk: "Квадрицепс (передня поверхня стегна)" },
  hamstring: { en: "Hamstrings (back of thigh)", uk: "Біцепс стегна (задня поверхня)" },
  adductors: { en: "Adductors (inner thigh)", uk: "Привідні м'язи (внутрішня поверхня стегна)" },
  calves: { en: "Calves", uk: "Литки" },
  neck: { en: "Neck", uk: "Шия" },
};

const EQUIPMENT: Record<string, { en: string; uk: string }> = {
  body: { en: "bodyweight", uk: "власна вага" },
  machine: { en: "machine", uk: "тренажер" },
  other: { en: "other equipment", uk: "інше обладнання" },
  kettlebell: { en: "kettlebell", uk: "гиря" },
  dumbbell: { en: "dumbbells", uk: "гантелі" },
  cable: { en: "cable machine", uk: "блочний тренажер" },
  barbell: { en: "barbell", uk: "штанга" },
  band: { en: "resistance band", uk: "еспандер (стрічка)" },
  ball: { en: "fitness / medicine ball", uk: "фітбол / медбол" },
  ezbar: { en: "EZ bar", uk: "EZ-гриф" },
};

const LEVEL: Record<string, { en: string; uk: string }> = {
  b: { en: "beginner", uk: "новачок" },
  i: { en: "intermediate", uk: "середній" },
  e: { en: "advanced", uk: "досвідчений" },
};

const PLACE: Record<string, { en: string; uk: string }> = {
  gym: { en: "gym", uk: "зал" },
  dumbbells: { en: "home with dumbbells", uk: "вдома з гантелями" },
  bodyweight: { en: "home, no equipment", uk: "вдома без обладнання" },
};
const AUDIENCE: Record<string, { en: string; uk: string }> = {
  men: { en: "men", uk: "чоловіків" },
  women: { en: "women", uk: "жінок" },
  all: { en: "everyone", uk: "всіх" },
};
const GOAL: Record<string, { en: string; uk: string }> = {
  fatloss: { en: "fat loss", uk: "схуднення" },
  muscle: { en: "muscle gain", uk: "набір м'язів" },
  recomp: { en: "recomposition", uk: "рекомпозиція" },
  strength: { en: "strength", uk: "сила" },
  endurance: { en: "endurance", uk: "витривалість" },
};
const DAY: Record<Lang, string[]> = {
  en: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  uk: ["", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота", "Неділя"],
};

const titleOf = (id: string) => id.replace(/_/g, " ").replace(/\s+/g, " ").trim();

function exerciseDocs(technique: TechniqueRow[]): KnowledgeDoc[] {
  const steps = new Map<string, { steps: string[]; name: string | null }>();
  for (const r of technique) {
    try {
      const parsed = JSON.parse(r.steps) as unknown;
      if (Array.isArray(parsed)) steps.set(`${r.lang}:${r.exerciseId}`, { steps: parsed.filter((s): s is string => typeof s === "string"), name: r.name });
    } catch {
      // a malformed cached row just goes without steps
    }
  }
  const byMuscle = new Map<string, string[][]>();
  for (const line of FREE_EXERCISE_LIB.split("\n")) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const list = byMuscle.get(parts[1]) ?? [];
    list.push(parts);
    byMuscle.set(parts[1], list);
  }
  const docs: KnowledgeDoc[] = [];
  for (const lang of KB_LANGS) {
    for (const [muscle, rows] of [...byMuscle].sort(([a], [b]) => a.localeCompare(b))) {
      const m = MUSCLE[muscle]?.[lang] ?? muscle;
      const head = lang === "uk" ? `# Вправи: ${m}\n\nВправи з бібліотеки застосунку, що тренують цей м'яз (${rows.length}).` : `# Exercises: ${m}\n\nExercises from the app's library that train this muscle (${rows.length}).`;
      const items = rows.map(([id, , eq, lvl, uk]) => {
        const cached = steps.get(`${lang}:${id}`);
        const en = titleOf(id);
        const name = lang === "uk" ? cached?.name || uk || en : en;
        const alt = lang === "uk" && name !== en ? ` (${en})` : "";
        const meta = `${EQUIPMENT[eq]?.[lang] ?? eq}, ${LEVEL[lvl]?.[lang] ?? lvl}`;
        const how = cached?.steps.length ? `\n${cached.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "";
        return `## ${name}${alt}\n${lang === "uk" ? "Обладнання і рівень" : "Equipment and level"}: ${meta}.${how}`;
      });
      docs.push({ key: `${lang}/exercises/${muscle}.md`, body: `${head}\n\n${items.join("\n\n")}\n` });
    }
  }
  return docs;
}

function programDocs(): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  for (const lang of KB_LANGS) {
    for (const p of PROGRAMS) {
      const plan = buildProgram(p.id, lang);
      if (!plan) continue;
      const uk = lang === "uk";
      const facts = uk
        ? `Місце: ${PLACE[p.place].uk}. Для ${AUDIENCE[p.audience].uk}. Ціль: ${GOAL[p.goal]?.uk ?? p.goal}. ${p.daysPerWeek} дні на тиждень, ~${p.minutes} хв.`
        : `Place: ${PLACE[p.place].en}. For ${AUDIENCE[p.audience].en}. Goal: ${GOAL[p.goal]?.en ?? p.goal}. ${p.daysPerWeek} days a week, ~${p.minutes} min.`;
      const days = plan.split.map((d) => {
        const ex = d.exercises.map((e) => `- ${e.name}: ${e.sets}${e.rpe ? `, RPE ${e.rpe}` : ""}${e.technique ? ` — ${e.technique}` : ""}`).join("\n");
        return `## ${DAY[lang][d.weekday]}: ${d.muscleGroup}\n${ex}`;
      });
      const apply = uk ? "Застосувати програму: Ще → Готові програми." : "Apply it: More → Ready programs.";
      docs.push({
        key: `${lang}/programs/${p.id}.md`,
        body: `# ${uk ? "Готова програма" : "Ready program"}: ${p.name[lang]}\n\n${p.summary[lang]}\n\n${facts}\n\n${plan.methodology}\n\n${days.join("\n\n")}\n\n${apply}\n`,
      });
    }
  }
  return docs;
}

const FOOD_CATEGORY: Record<string, { en: string; uk: string }> = {
  poultry: { en: "Poultry", uk: "Птиця" },
  meat: { en: "Meat and sausages", uk: "М'ясо і ковбаси" },
  fish: { en: "Fish and seafood", uk: "Риба і морепродукти" },
  eggs: { en: "Eggs", uk: "Яйця" },
  dairy: { en: "Dairy", uk: "Молочні продукти" },
  cheese: { en: "Cheese", uk: "Сири" },
  grains: { en: "Grains and cereals", uk: "Крупи і каші" },
  pasta: { en: "Pasta and noodles", uk: "Макарони і локшина" },
  bread: { en: "Bread and bakery", uk: "Хліб і випічка" },
  legumes: { en: "Legumes and soy", uk: "Бобові і соя" },
  veg: { en: "Vegetables and mushrooms", uk: "Овочі і гриби" },
  fruit: { en: "Fruit", uk: "Фрукти" },
  berries: { en: "Berries", uk: "Ягоди" },
  dried: { en: "Dried fruit", uk: "Сухофрукти" },
  nuts: { en: "Nuts and seeds", uk: "Горіхи і насіння" },
  fats: { en: "Oils and fats", uk: "Олії і жири" },
  sauce: { en: "Sauces, sugar and spreads", uk: "Соуси, цукор, мед" },
  sweets: { en: "Sweets and snacks", uk: "Солодощі і снеки" },
  drinks: { en: "Drinks", uk: "Напої" },
  sport: { en: "Sports nutrition", uk: "Спортивне харчування" },
  dishes: { en: "Dishes (typical home recipes)", uk: "Страви (типові домашні рецепти)" },
};

function nutritionDocs(): KnowledgeDoc[] {
  const byCat = new Map<string, ReturnType<typeof catalogFoods>>();
  for (const f of catalogFoods()) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
  const docs: KnowledgeDoc[] = [];
  for (const lang of KB_LANGS) {
    const uk = lang === "uk";
    for (const [cat, foods] of [...byCat].sort(([a], [b]) => a.localeCompare(b))) {
      const title = FOOD_CATEGORY[cat]?.[lang] ?? cat;
      const head = uk
        ? `# Калорійність і КБЖУ: ${title}\n\nНа 100 г: ккал, білки (Б), жири (Ж), вуглеводи (В); у дужках — типова порція. Значення довідкові, округлені.`
        : `# Calories and macros: ${title}\n\nPer 100 g: kcal, protein (P), fat (F), carbs (C); in brackets a typical portion. Reference values, rounded.`;
      const rows = foods.map((f) => {
        const k = f.portionG / 100;
        const portion = uk
          ? `порція ${f.portionG} г ≈ ${Math.round(f.per100.kcal * k)} ккал, Б ${Math.round(f.per100.p * k)} г`
          : `portion ${f.portionG} g ≈ ${Math.round(f.per100.kcal * k)} kcal, P ${Math.round(f.per100.p * k)} g`;
        const name = uk ? f.uk : f.en;
        const syn = f.synonyms.length ? ` (${f.synonyms.slice(0, 4).join(", ")})` : "";
        return uk
          ? `- ${name}${syn}: ${f.per100.kcal} ккал, Б ${f.per100.p}, Ж ${f.per100.f}, В ${f.per100.c} (${portion})`
          : `- ${name}: ${f.per100.kcal} kcal, P ${f.per100.p}, F ${f.per100.f}, C ${f.per100.c} (${portion})`;
      });
      docs.push({ key: `${lang}/nutrition/${cat}.md`, body: `${head}\n\n${rows.join("\n")}\n` });
    }
  }
  return docs;
}

function guideDocs(): KnowledgeDoc[] {
  return KB_LANGS.flatMap((lang) => GUIDES.map((g) => ({ key: `${lang}/guides/${g.slug}.md`, body: `${g[lang].trim()}\n` })));
}

/** Every knowledge-base document, sorted by key. */
export function buildKnowledgeDocs(technique: TechniqueRow[] = []): KnowledgeDoc[] {
  return [...guideDocs(), ...programDocs(), ...exerciseDocs(technique), ...nutritionDocs()].sort((a, b) => a.key.localeCompare(b.key));
}
