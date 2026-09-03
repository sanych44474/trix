import { CURATED, foodCategory, type FoodCategory, type Per100g } from "../ai/nutritionDb";
import type { GoalBucket, Lang } from "../types";

// Deterministic meal-plan builder: picks whole foods from the curated catalog to assemble a
// balanced day (a protein + a carb + veg/fruit + a fat per meal), honoring allergens/dislikes
// and the goal, with ZERO AI calls. Output mirrors the AI mealDay shape
// ({ meals: [{ name, items: [{ food_name, grams }] }] }) so the existing deliverMealPlan
// pipeline (lookupPer100gCached → solvePortions → localize) runs over it unchanged.

export interface TemplateMealDay {
  meals: { name: string; items: { food_name: string; grams: number }[] }[];
}

// Allergen chip → curated food-name substrings to exclude. Matched as substrings, so "egg"
// also drops "scrambled eggs", "fish" drops nothing here (handled by the explicit seafood
// list). Mirrors the 6 chips in MP_ALLERGENS (src/bot.ts).
const ALLERGEN_EXCLUDES: Record<string, string[]> = {
  lactose: ["milk", "yogurt", "kefir", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "gouda", "ricotta", "cream", "swiss", "whey protein", "butter", "ghee"],
  gluten: ["bread", "pasta", "noodles", "couscous", "bulgur", "semolina", "flour", "bagel", "tortilla", "granola", "cornflakes", "barley", "seitan"],
  nuts: ["almond", "peanut", "cashew", "pistachio", "hazelnut", "pecan", "macadamia", "brazil nut", "walnut", "pine nut"],
  eggs: ["egg", "omelet", "omelette"],
  seafood: ["salmon", "tuna", "cod", "tilapia", "trout", "mackerel", "sardine", "herring", "halibut", "sea bass", "shrimp", "crab", "lobster", "mussel", "squid", "anchovy", "scallop", "octopus", "fish"],
  soy: ["soy", "tofu", "tempeh", "edamame", "soybean"],
};

// Allergen keyword (as it might appear in free-text or a chip id) → the chip id whose food
// list should be excluded.
const ALLERGEN_SYNONYMS: Record<string, keyof typeof ALLERGEN_EXCLUDES> = {
  lactose: "lactose", dairy: "lactose", milk: "lactose",
  gluten: "gluten", wheat: "gluten",
  nuts: "nuts", nut: "nuts", peanut: "nuts", peanuts: "nuts",
  egg: "eggs", eggs: "eggs",
  seafood: "seafood", fish: "seafood", shellfish: "seafood",
  soy: "soy", soya: "soy",
};

/**
 * Build the set of food-name substrings to exclude from a combined free-text string
 * (allergies + dietPrefs + foodDislikes). Allergen keywords expand to their whole food group;
 * any other token is excluded literally.
 */
export function expandExclusions(text: string): string[] {
  const out = new Set<string>();
  for (const raw of (text || "").toLowerCase().split(/[,;]+|\band\b|\bor\b|\s+/)) {
    const tok = raw.replace(/[^a-z-]/g, "").trim();
    if (tok.length < 3 || tok === "none") continue;
    const chip = ALLERGEN_SYNONYMS[tok];
    if (chip) for (const w of ALLERGEN_EXCLUDES[chip]) out.add(w);
    else out.add(tok);
  }
  return [...out];
}

function isExcluded(name: string, excludes: string[]): boolean {
  const n = name.toLowerCase();
  return excludes.some((w) => n.includes(w));
}

// Lean proteins favored for fat-loss (lower fat per gram of protein).
const LEAN_PROTEINS = new Set([
  "chicken breast", "turkey breast", "ground turkey", "cod", "tilapia", "tuna", "shrimp",
  "egg white", "greek yogurt", "cottage cheese", "white fish", "halibut", "sea bass", "lentils",
]);
// Calorie-dense staples favored for muscle/strength bulking.
const DENSE_CARBS = new Set(["rolled oats", "oats", "white rice", "brown rice", "rice", "pasta", "buckwheat", "sweet potato", "potato"]);

// Everyday, locally-available foods (Ukraine / Eastern Europe). The deterministic builder picks
// ONLY from these so a menu never lists exotic/unfamiliar items (tempeh, seitan, edamame, raw
// soybeans, scallops, octopus, coconut, granola, quinoa…). Those stay in CURATED for AI menus
// and food logging, but are not chosen automatically. Names match the CURATED keys.
const STAPLE_FOODS = new Set<string>([
  // proteins
  "chicken breast", "chicken thigh", "chicken drumstick", "ground chicken", "turkey breast",
  "ground turkey", "beef", "ground beef", "pork", "pork chop", "ground pork", "salmon", "tuna",
  "cod", "tilapia", "trout", "mackerel", "herring", "sardines", "shrimp", "egg", "eggs",
  "scrambled eggs", "boiled eggs", "omelet", "cottage cheese", "greek yogurt", "lentils",
  "beans", "chickpeas", "white beans", "kidney beans",
  // grains / starches
  "rolled oats", "oats", "white rice", "brown rice", "rice", "buckwheat", "bulgur", "pasta",
  "noodles", "bread", "whole wheat bread", "white bread", "rye bread", "potato", "sweet potato",
  "semolina", "barley", "millet", "peas", "corn",
  // vegetables
  "broccoli", "cauliflower", "spinach", "cabbage", "tomato", "cucumber", "carrot", "bell pepper",
  "zucchini", "eggplant", "mushroom", "onion", "garlic", "celery", "green beans", "beetroot",
  "pumpkin", "radish", "leek", "lettuce", "sauerkraut", "spring onion", "cherry tomato",
  "brussels sprouts",
  // fruit
  "apple", "banana", "pear", "orange", "grapes", "peach", "plum", "apricot", "watermelon",
  "melon", "strawberries", "raspberries", "blueberries", "blackberries", "cherries", "blackcurrant",
  // fats / nuts
  "olive oil", "sunflower oil", "butter", "sour cream", "walnuts", "sunflower seeds",
  "pumpkin seeds", "almonds", "avocado",
  // dairy
  "milk", "skim milk", "kefir", "yogurt", "cream", "cheese", "cream cheese",
]);

interface Pool {
  protein: string[];
  grain: string[];
  veg: string[];
  fruit: string[];
  fat: string[];
  dairy: string[];
}

/** Curated foods grouped by category, filtered by exclusions and ordered by goal preference. */
function buildPool(goal: GoalBucket, excludes: string[]): Pool {
  const cats: Record<FoodCategory, string[]> = {
    protein: [], grain: [], veg: [], fruit: [], fat: [], dairy: [], condiment: [],
  };
  for (const name of Object.keys(CURATED)) {
    if (isExcluded(name, excludes)) continue;
    cats[foodCategory(name)].push(name);
  }
  // Restrict to local staples; only if a category is emptied (e.g. by allergen exclusions) fall
  // back to the full list so the user still gets a meal.
  const local = (list: string[]) => {
    const s = list.filter((n) => STAPLE_FOODS.has(n));
    return s.length ? s : list;
  };
  const protein = local(cats.protein);
  const grain = local(cats.grain);
  const dairy = local(cats.dairy);
  const fatLoss = goal === "fatloss";
  const rank = (a: string, b: string, set: Set<string>) =>
    (set.has(b) ? 1 : 0) - (set.has(a) ? 1 : 0);
  // Fat-loss prefers lean proteins + dense carbs deprioritized; bulking the opposite.
  protein.sort((a, b) => (fatLoss ? rank(a, b, LEAN_PROTEINS) : rank(b, a, LEAN_PROTEINS)));
  grain.sort((a, b) => (fatLoss ? rank(b, a, DENSE_CARBS) : rank(a, b, DENSE_CARBS)));
  return {
    protein,
    grain,
    veg: local(cats.veg),
    fruit: local(cats.fruit),
    fat: local(cats.fat),
    dairy, // may be empty (lactose-free) — the snack pick chain falls back to nuts/fruit, never meat
  };
}

// Breakfast-appropriate proteins: eggs + light dairy. Meat/fish stay on lunch/dinner.
const BREAKFAST_PROTEINS = new Set([
  "egg", "eggs", "scrambled eggs", "boiled eggs", "omelet", "cottage cheese", "greek yogurt", "yogurt", "kefir",
]);

// Sweet fruits that pair with dairy; sour/citrus are kept off dairy meals (no "milk + plums").
const DAIRY_FRUIT_OK = new Set(["banana", "apple", "pear", "strawberries", "raspberries", "blueberries", "blackberries", "peach"]);

// Human dish names (display only — lookup still uses the curated key). Cereals read as porridge,
// grains/legumes as cooked, so the menu looks like real food, not raw ingredients.
export const DISH_NAME: Record<string, { en: string; uk: string }> = {
  buckwheat: { en: "buckwheat porridge", uk: "гречана каша" },
  "rolled oats": { en: "oatmeal", uk: "вівсяна каша" },
  oats: { en: "oatmeal", uk: "вівсяна каша" },
  millet: { en: "millet porridge", uk: "пшоняна каша" },
  semolina: { en: "semolina porridge", uk: "манна каша" },
  barley: { en: "barley porridge", uk: "перлова каша" },
  "white rice": { en: "boiled rice", uk: "відварний рис" },
  "brown rice": { en: "boiled brown rice", uk: "відварний бурий рис" },
  rice: { en: "boiled rice", uk: "відварний рис" },
  bulgur: { en: "cooked bulgur", uk: "булгур" },
  pasta: { en: "pasta", uk: "макарони" },
  noodles: { en: "noodles", uk: "локшина" },
  potato: { en: "boiled potato", uk: "відварена картопля" },
  "sweet potato": { en: "baked sweet potato", uk: "запечений батат" },
  lentils: { en: "cooked lentils", uk: "відварена сочевиця" },
  chickpeas: { en: "cooked chickpeas", uk: "відварений нут" },
  beans: { en: "cooked beans", uk: "відварена квасоля" },
  "white beans": { en: "cooked white beans", uk: "відварена квасоля" },
  "kidney beans": { en: "cooked kidney beans", uk: "відварена червона квасоля" },
};

/** Human display name for a curated food key, or null to fall back to plain translation.
 * The curated dish dictionary is en/uk only; ru borrows the uk name (mutually readable). */
export function dishName(foodKey: string, lang: Lang): string | null {
  const l: "en" | "uk" = lang;
  return DISH_NAME[foodKey.toLowerCase().trim()]?.[l] ?? null;
}

/**
 * Compose ONE realistic day's menu — the way a person actually eats, not a textbook:
 *  - breakfast = eggs/dairy + a porridge + sweet fruit;
 *  - ONE main grain is cooked once and reused at lunch & dinner (no three tiny 100 g portions);
 *  - two distinct main proteins for lunch/dinner; veg with each;
 *  - fruit only appears alongside dairy and is always dairy-friendly (no milk + plums);
 *  - snack = dairy/nuts + fruit, never meat.
 * `seed` (userId) keeps it stable per user but varied between users. Deterministic — no random.
 */
export function buildTemplateMealDay(
  mealsPerDay: number,
  opts: { goal: GoalBucket; excluded: string[]; seed: number },
): TemplateMealDay {
  const pool = buildPool(opts.goal, opts.excluded);
  const fatloss = opts.goal === "fatloss";
  const seed = Math.abs(opts.seed);
  // off-th distinct item not already in `used`, rotated by seed; falls back to a repeat.
  const pick = (list: string[], off: number, used?: Set<string>): string | null => {
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const f = list[(seed + off + i) % list.length];
      if (!used || !used.has(f)) { used?.add(f); return f; }
    }
    return list[(seed + off) % list.length];
  };
  const isDairy = (f: string | null) => !!f && foodCategory(f) === "dairy";

  const usedProtein = new Set<string>();
  const bProtPool = [...pool.protein, ...pool.dairy].filter((n) => BREAKFAST_PROTEINS.has(n));
  const breakfastProtein = pick(bProtPool.length ? bProtPool : pool.protein, 0, usedProtein);

  const oats = pool.grain.find((n) => n === "rolled oats" || n === "oats") ?? null;
  const mainGrain = pick(pool.grain.filter((n) => n !== oats), 1) ?? oats;
  const breakfastGrain = oats ?? mainGrain;

  const mainProt = pool.protein.filter((n) => !BREAKFAST_PROTEINS.has(n));
  const protPool = mainProt.length ? mainProt : pool.protein;
  const proteinLunch = pick(protPool, 2, usedProtein);
  const proteinDinner = pick(protPool, 5, usedProtein);

  const usedVeg = new Set<string>();
  const veg1 = pick(pool.veg, 3, usedVeg);
  const veg2 = pick(pool.veg, 7, usedVeg);
  const fat1 = pick(pool.fat, 4);

  // Fruit only sits with dairy → always dairy-friendly (sweet) and never with meat/fish.
  const sweet = pool.fruit.filter((n) => DAIRY_FRUIT_OK.has(n));
  const fruitPool = sweet.length ? sweet : pool.fruit;
  const usedFruit = new Set<string>();
  const fruitB = pick(fruitPool, 6, usedFruit);
  const fruitS = pick(fruitPool, 9, usedFruit);

  const snackDairy = pool.dairy.find((n) => n !== breakfastProtein) ?? pool.dairy[0] ?? null;
  const snackNut = pool.fat.find((n) => /almond|walnut|\bnuts\b|seeds|peanut|cashew|pistachio/.test(n)) ?? null;
  const snackMain = snackDairy ?? snackNut;

  const g = (lean: number, full: number) => (fatloss ? lean : full);
  const it = (food: string | null, grams: number) => (food ? [{ food_name: food, grams }] : []);

  const all = [
    { name: "Breakfast", items: [...it(breakfastProtein, isDairy(breakfastProtein) ? 180 : 150), ...it(breakfastGrain, g(45, 70)), ...it(fruitB, 120)] },
    { name: "Lunch", items: [...it(proteinLunch, 160), ...it(mainGrain, g(60, 90)), ...it(veg1, 200), ...it(fat1, g(8, 15))] },
    // Dinner reuses the SAME main grain (cooked once); fat-loss dinner is grain-light.
    { name: "Dinner", items: [...it(proteinDinner, 160), ...it(fatloss ? null : mainGrain, 70), ...it(veg2, 200), ...it(fat1, g(8, 12))] },
    { name: "Snack", items: [...it(snackMain, isDairy(snackMain) ? 200 : 30), ...it(fruitS, 120)] },
  ];
  const meals = (mealsPerDay >= 4 ? all : mealsPerDay === 3 ? all.slice(0, 3) : all.slice(0, Math.max(1, mealsPerDay)))
    .filter((m) => m.items.length);
  return { meals };
}

/** Per-100g for a curated food (used by the builder's own callers/tests). */
export function curatedMacros(name: string): Per100g | null {
  return CURATED[name.toLowerCase().trim()] ?? null;
}
