// Shopping list from the meal plan — pure, no DB. The nutritionist side already produces a full
// day's menu down to gram amounts, and then leaves the user to work out what to actually buy.
// This turns the menu into an aisle-ordered list for N days, which is also the one weekly ritual
// that opens the bot to GET something rather than to report something.
//
// Note on the input: MealItem.food is stored ALREADY LOCALIZED (bot/router.ts runs it through
// dishName() before saving), so the keyword tables below have to read both English and Ukrainian.

export type GroceryCategory = "produce" | "protein" | "dairy" | "grains" | "pantry" | "other";

/** Aisle order — roughly the order a supermarket is walked, not alphabetical. */
export const GROCERY_ORDER: GroceryCategory[] = ["produce", "protein", "dairy", "grains", "pantry", "other"];

export interface GroceryLine {
  food: string; // display name, as it appears in the menu
  grams: number;
  category: GroceryCategory;
}

// Ordered most-specific first: a match wins immediately, so anything that could read as two
// categories ("cottage cheese" is dairy, not protein-aisle meat) is listed before the generic one.
const CATEGORY_RULES: [GroceryCategory, RegExp][] = [
  [
    "dairy",
    /молок|кефір|йогурт|сир(?!оїж|оп)|творог|вершк|ряжанк|сметан|\b(?:milk|kefir|yogh?urt|cottage cheese|curd|cheese|cream|butter|skyr|ricotta|mozzarella)\b/iu,
  ],
  [
    "protein",
    /куряч|курк|індич|яловичин|свинин|телятин|риб|лосос|тунец|тунц|креветк|тріск|хек|яйц|яєц|тофу|фарш|печінк|\b(?:chicken|turkey|beef|pork|veal|lamb|fish|salmon|tuna|cod|shrimp|prawn|egg|eggs|tofu|tempeh|mince|liver|whey|protein powder)\b/iu,
  ],
  [
    "grains",
    /рис|гречк|вівсян|овсян|булгур|кіноа|кускус|макарон|паст[аи]|спагет|хліб|лаваш|тортіль|борошн|крупа|крупи|перлов|\b(?:rice|buckwheat|oats?|oatmeal|bulgur|quinoa|couscous|pasta|spaghetti|noodle|bread|tortilla|wrap|flour|barley|couscous|cereal)\b/iu,
  ],
  [
    "produce",
    /овоч|фрукт|яблук|банан|апельсин|лимон|ягод|полуниц|чорниц|помідор|томат|огірк|перец|цибул|часник|морквин|морква|броколі|капуст|шпинат|салат|авокадо|картопл|гарбуз|кабач|буряк|зелен|гриб|печериц|\b(?:vegetable|fruit|apple|banana|orange|lemon|lime|berry|berries|strawberr|blueberr|tomato|cucumber|pepper|onion|garlic|carrot|broccoli|cabbage|spinach|lettuce|salad|avocado|potato|pumpkin|zucchini|courgette|beet|greens|mushroom|celery|kale)\b/iu,
  ],
  [
    "pantry",
    /олі[яї]|оліє|олив|горіх|мигдал|арахіс|насінн|мед|цукор|сіль|спеці|припра|соус|оцет|кетчуп|консерв|квасол|нут|сочевиц|горох|шоколад|\b(?:oil|olive|nut|nuts|almond|peanut|cashew|walnut|seed|seeds|honey|sugar|salt|spice|seasoning|sauce|vinegar|ketchup|canned|beans?|chickpea|lentil|peas|chocolate|cocoa|tahini|hummus)\b/iu,
  ],
];

/** Best-guess supermarket aisle for a food name (EN or UA). Unknown foods land in "other" — they
 * are still on the list, just not sorted into an aisle. */
export function categorizeFood(food: string): GroceryCategory {
  const s = (food || "").toLowerCase();
  for (const [category, re] of CATEGORY_RULES) if (re.test(s)) return category;
  return "other";
}

/** Round to a shopping-sane amount: nobody buys 173 g of rice. */
export function roundGrams(g: number): number {
  if (g <= 0) return 0;
  if (g < 100) return Math.max(5, Math.round(g / 5) * 5);
  if (g < 1000) return Math.round(g / 10) * 10;
  return Math.round(g / 50) * 50;
}

/** "1.2 kg" past a kilo, "450 g" below it. */
export function formatGrams(g: number): string {
  if (g >= 1000) {
    const kg = g / 1000;
    return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
  }
  return `${g} g`;
}

interface MenuLike {
  meals: { items: { food: string; grams: number }[] }[];
}

/**
 * Aggregate a menu into a shopping list, optionally repeated over `repeat` days (the meal plan
 * holds one day's menu, so shopping for a week is that day times seven). Foods are merged
 * case-insensitively, keeping the first spelling seen, and returned in aisle order with the
 * biggest amounts first inside each aisle.
 */
export function groceryList(days: MenuLike[], repeat = 1): GroceryLine[] {
  const times = Math.max(1, Math.floor(repeat));
  const byKey = new Map<string, { food: string; grams: number }>();
  for (const day of days) {
    for (const meal of day.meals ?? []) {
      for (const item of meal.items ?? []) {
        const food = (item.food || "").trim();
        const grams = Number(item.grams);
        if (!food || !Number.isFinite(grams) || grams <= 0) continue;
        const key = food.toLowerCase();
        const prev = byKey.get(key);
        if (prev) prev.grams += grams;
        else byKey.set(key, { food, grams });
      }
    }
  }
  const lines: GroceryLine[] = [];
  for (const { food, grams } of byKey.values()) {
    const total = roundGrams(grams * times);
    if (total > 0) lines.push({ food, grams: total, category: categorizeFood(food) });
  }
  lines.sort((a, b) => {
    const d = GROCERY_ORDER.indexOf(a.category) - GROCERY_ORDER.indexOf(b.category);
    return d !== 0 ? d : b.grams - a.grams;
  });
  return lines;
}
