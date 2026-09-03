import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBucket,
  equipmentBucket,
  goalBucket,
  mapProfileToKey,
  MATCH_THRESHOLD,
  scoreEntry,
  selectBest,
} from "../src/domain/planBank";
import { adaptPlan, parsePrs } from "../src/domain/planAdapt";
import { buildTemplateMealDay, expandExclusions } from "../src/domain/mealTemplate";
import { CURATED } from "../src/ai/nutritionDb";
import type { BankPlan, PlanBankEntry, PlanDay, PlanExercise, UserProfile } from "../src/types";

// ---------- planBank: bucketing ----------

test("goalBucket maps free text (EN/UA) to a bucket", () => {
  assert.equal(goalBucket("fat loss"), "fatloss");
  assert.equal(goalBucket("схуднення"), "fatloss");
  assert.equal(goalBucket("набір м'язової маси"), "muscle");
  assert.equal(goalBucket("strength / powerlifting"), "strength");
  assert.equal(goalBucket("just general fitness"), "recomp");
  assert.equal(goalBucket(undefined), "recomp");
});

test("daysBucket from daysPerWeek / weekday count", () => {
  assert.equal(daysBucket({ daysPerWeek: 2 }), "d23");
  assert.equal(daysBucket({ daysPerWeek: 3 }), "d23");
  assert.equal(daysBucket({ daysPerWeek: 4 }), "d4");
  assert.equal(daysBucket({ daysPerWeek: 5 }), "d56");
  assert.equal(daysBucket({ trainingWeekdays: [1, 3, 5, 6] }), "d4");
});

test("equipmentBucket detects home vs gym", () => {
  assert.equal(equipmentBucket({ equipment: "full commercial gym" }), "gym");
  assert.equal(equipmentBucket({ equipment: "home, dumbbells only" }), "home");
  assert.equal(equipmentBucket({ equipment: "вдома, гантелі" }), "home");
  assert.equal(equipmentBucket({}), "gym");
});

test("mapProfileToKey combines all five dims", () => {
  const key = mapProfileToKey({ goal: "muscle gain", level: "intermediate", daysPerWeek: 4, sex: "female", equipment: "home" });
  assert.deepEqual(key, { goal: "muscle", level: "intermediate", daysBucket: "d4", sex: "female", equipment: "home" });
});

// ---------- planBank: selection ----------

function entry(id: string, k: Partial<PlanBankEntry>): PlanBankEntry {
  return {
    id,
    goal: "muscle",
    level: "intermediate",
    daysBucket: "d4",
    sex: "male",
    equipment: "gym",
    variant: 1,
    plan: { en: {} as BankPlan, uk: {} as BankPlan },
    ...k,
  };
}

const muscleProfile: UserProfile = { goal: "muscle gain", level: "intermediate", daysPerWeek: 4, sex: "male", equipment: "gym" };

test("selectBest returns exact match with score 1", () => {
  const entries = [entry("a", {}), entry("b", { goal: "fatloss" })];
  const m = selectBest(entries, muscleProfile, 1)!;
  assert.equal(m.entry.id, "a");
  assert.equal(m.score, 1);
});

test("selectBest rotates variants deterministically by seed", () => {
  const entries = [entry("v1", { variant: 1 }), entry("v2", { variant: 2 })];
  assert.equal(selectBest(entries, muscleProfile, 0)!.entry.id, "v1");
  assert.equal(selectBest(entries, muscleProfile, 1)!.entry.id, "v2");
  assert.equal(selectBest(entries, muscleProfile, 2)!.entry.id, "v1");
});

test("selectBest falls below threshold for a far-off only option", () => {
  // only a fatloss/beginner/d23/female/home plan exists for a muscle/adv/d56/male/gym user
  const far = entry("far", { goal: "fatloss", level: "beginner", daysBucket: "d23", sex: "female", equipment: "home" });
  const m = selectBest([far], { goal: "strength", level: "advanced", daysPerWeek: 6, sex: "male", equipment: "gym" }, 0)!;
  assert.ok(m.score < MATCH_THRESHOLD, `expected weak score, got ${m.score}`);
});

test("selectBest returns null for empty bank", () => {
  assert.equal(selectBest([], muscleProfile, 0), null);
});

test("scoreEntry gives partial credit to adjacent buckets", () => {
  const key = mapProfileToKey(muscleProfile); // muscle/intermediate/d4/male/gym
  const recomp = entry("r", { goal: "recomp" }); // neighbor of muscle
  const fatloss = entry("f", { goal: "fatloss" }); // not a neighbor of muscle
  assert.ok(scoreEntry(key, recomp) > scoreEntry(key, fatloss));
});

// ---------- planAdapt ----------

function ex(name: string, startWeight: string, canonical?: string): PlanExercise {
  return { name, sets: "4 × 8-10", startWeight, technique: "do it", muscles: "chest", role: "primary", isKeyLift: true, ...(canonical ? { canonicalName: canonical } : {}) };
}
function bankPlan(): BankPlan {
  const day = (wd: number): PlanDay => ({ weekday: wd as PlanDay["weekday"], muscleGroup: "Upper", exercises: [ex("Bench Press", "60 kg"), ex("Squat", "80 kg"), ex("Row", "50 kg"), ex("Curl", "12 kg"), ex("Plank", "Bodyweight")] });
  return { split: [day(1), day(2), day(3)], nutrition: { calories: 2500, protein: 180, fats: 70, carbs: 270 }, supplements: [], methodology: "progress" };
}

test("adaptPlan remaps weekdays and trims to the client's training days", () => {
  const profile: UserProfile = { sex: "male", weightKg: 80, trainingWeekdays: [2, 4], goal: "muscle gain" };
  const plan = adaptPlan(bankPlan(), profile, 123);
  assert.equal(plan.split.length, 2); // trimmed from 3 to 2
  assert.deepEqual(plan.split.map((d) => d.weekday), [2, 4]);
});

test("adaptPlan scales starting weight by bodyweight", () => {
  const light = adaptPlan(bankPlan(), { sex: "male", weightKg: 60, trainingWeekdays: [1] }, 1);
  const heavy = adaptPlan(bankPlan(), { sex: "male", weightKg: 100, trainingWeekdays: [1] }, 1);
  const lw = parseFloat(light.split[0].exercises[0].startWeight);
  const hw = parseFloat(heavy.split[0].exercises[0].startWeight);
  assert.ok(hw > lw, `heavier user should lift more: ${hw} vs ${lw}`);
});

test("adaptPlan honors recent PRs (starts ~92% of PR)", () => {
  const plan = adaptPlan(bankPlan(), { sex: "male", weightKg: 80, trainingWeekdays: [1] }, 1, { prs: "Bench Press: 100x3" });
  const w = parseFloat(plan.split[0].exercises[0].startWeight);
  assert.ok(w >= 90 && w <= 95, `expected ~92.5kg, got ${w}`);
});

test("adaptPlan applies caller replacements (movement only, scheme preserved)", () => {
  const repl = new Map<string, Partial<PlanExercise>>([["bench press", { name: "Push-Up", canonicalName: "Push-Up", exerciseId: "x1" }]]);
  const plan = adaptPlan(bankPlan(), { sex: "male", weightKg: 80, trainingWeekdays: [1] }, 1, { replacements: repl });
  const e = plan.split[0].exercises[0];
  assert.equal(e.name, "Push-Up");
  assert.equal(e.sets, "4 × 8-10"); // scheme kept
  assert.equal(e.exerciseId, "x1");
});

test("parsePrs parses the PR blob", () => {
  const m = parsePrs("Bench Press: 100x3\nSquat: BW x10\nDeadlift: 140x1");
  assert.equal(m.get("bench press"), 100);
  assert.equal(m.get("deadlift"), 140);
  assert.equal(m.has("squat"), false); // BW → no numeric weight
});

// ---------- mealTemplate ----------

test("expandExclusions expands allergen keywords to food groups", () => {
  const lac = expandExclusions("lactose");
  assert.ok(lac.includes("milk") && lac.includes("cheese"));
  const nuts = expandExclusions("nut allergy");
  assert.ok(nuts.includes("almond") && nuts.includes("peanut"));
  const free = expandExclusions("salmon, mushroom");
  assert.ok(free.includes("salmon") && free.includes("mushroom"));
  assert.deepEqual(expandExclusions("none"), []);
});

test("buildTemplateMealDay returns meals and excludes allergen foods", () => {
  const excluded = expandExclusions("lactose, seafood");
  const day = buildTemplateMealDay(4, { goal: "fatloss", excluded, seed: 42 });
  assert.equal(day.meals.length, 4);
  const allFoods = day.meals.flatMap((m) => m.items.map((it) => it.food_name.toLowerCase()));
  assert.ok(allFoods.length > 0);
  for (const f of allFoods) {
    assert.ok(!excluded.some((w) => f.includes(w)), `excluded food leaked: ${f}`);
    assert.ok(CURATED[f], `food not in curated catalog: ${f}`);
  }
});

test("buildTemplateMealDay never picks exotic / non-local foods", () => {
  const exotic = ["tempeh", "seitan", "edamame", "soybeans", "tofu", "scallops", "octopus", "squid", "coconut", "granola", "quinoa", "couscous", "lobster", "duck breast", "veal", "anchovy", "hummus"];
  for (const goal of ["fatloss", "muscle", "recomp", "strength"] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const day = buildTemplateMealDay(4, { goal, excluded: [], seed });
      for (const m of day.meals) for (const it of m.items) {
        assert.ok(!exotic.includes(it.food_name), `exotic food leaked: ${it.food_name} (goal=${goal} seed=${seed})`);
      }
    }
  }
});

test("buildTemplateMealDay keeps meat/fish off breakfast & snack", () => {
  const MEAT = /chicken|beef|pork|turkey|ground|salmon|tuna|cod|tilapia|trout|mackerel|herring|sardine|shrimp|steak|lamb|veal|duck|ham|bacon|sausage/i;
  for (const goal of ["fatloss", "muscle", "recomp", "strength"] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const day = buildTemplateMealDay(4, { goal, excluded: [], seed });
      const breakfast = day.meals[0];
      const snack = day.meals[day.meals.length - 1];
      for (const it of breakfast.items) assert.ok(!MEAT.test(it.food_name), `meat at breakfast: ${it.food_name} (goal=${goal} seed=${seed})`);
      for (const it of snack.items) assert.ok(!MEAT.test(it.food_name), `meat at snack: ${it.food_name} (goal=${goal} seed=${seed})`);
    }
  }
});

test("buildTemplateMealDay snack stays meat-free even lactose-free", () => {
  const MEAT = /chicken|beef|pork|turkey|ground|salmon|tuna|cod|shrimp|steak|lamb/i;
  const day = buildTemplateMealDay(4, { goal: "recomp", excluded: expandExclusions("lactose"), seed: 4242 });
  const snack = day.meals[day.meals.length - 1];
  for (const it of snack.items) assert.ok(!MEAT.test(it.food_name), `meat at lactose-free snack: ${it.food_name}`);
});

test("buildTemplateMealDay: no sour fruit paired with dairy + grain reused across meals", () => {
  const SOUR = /\b(plum|plums|orange|grapefruit|lemon|lime|cherries|blackcurrant|apricot)\b/i;
  for (const goal of ["recomp", "muscle"] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const day = buildTemplateMealDay(4, { goal, excluded: [], seed });
      // Fruit only appears at breakfast/snack (with dairy) — must be sweet, never sour.
      for (const m of day.meals) for (const it of m.items) {
        if (SOUR.test(it.food_name)) assert.fail(`sour fruit in menu: ${it.food_name}`);
      }
      // The main grain is cooked once and reused: lunch & dinner share a grain (non-fat-loss).
      const grainOf = (name: string) => day.meals.find((m) => m.name === name)?.items.find((i) => /rice|buckwheat|millet|barley|bulgur|pasta|oats|potato/.test(i.food_name))?.food_name;
      const lunchGrain = grainOf("Lunch");
      const dinnerGrain = grainOf("Dinner");
      if (lunchGrain && dinnerGrain) assert.equal(lunchGrain, dinnerGrain, `grain not reused (seed=${seed}): ${lunchGrain} vs ${dinnerGrain}`);
    }
  }
});

test("buildTemplateMealDay is deterministic for a fixed seed", () => {
  const a = buildTemplateMealDay(4, { goal: "muscle", excluded: [], seed: 7 });
  const b = buildTemplateMealDay(4, { goal: "muscle", excluded: [], seed: 7 });
  assert.deepEqual(a, b);
});
