import type { Env } from "../types";
import { getFoodCache, putFoodCache } from "../db/repos";
import { aiJSON } from "./index";
import { PER100G_SCHEMA, per100gSystem, type Per100gResult } from "./prompts";

export interface Per100g {
  source: "USDA" | "OpenFoodFacts" | "Gemini";
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}


// Curated per-100g for common whole foods, in their standard raw/dry form. This is the
// AUTHORITATIVE source, checked BEFORE the (stale) cache and the flaky USDA/OFF search —
// free-text search kept returning wrong forms ("egg"→egg white 55 kcal/0 fat, "banana"→
// dried 346 kcal, "rolled oats"→236 kcal), which the macro solver then turned into absurd
// portions. Grains/legumes are DRY (consistent with rice/oats); meats/fish/produce are raw.
const CURATED: Record<string, Per100g> = {
  // ---- poultry (cooked, skinless unless noted) ----
  "chicken breast": { source: "USDA", kcal: 165, protein: 31, fats: 4, carbs: 0 },
  "chicken thigh": { source: "USDA", kcal: 209, protein: 26, fats: 11, carbs: 0 },
  "chicken drumstick": { source: "USDA", kcal: 172, protein: 28, fats: 6, carbs: 0 },
  "chicken wing": { source: "USDA", kcal: 203, protein: 30, fats: 8, carbs: 0 },
  "ground chicken": { source: "USDA", kcal: 143, protein: 17, fats: 8, carbs: 0 },
  "turkey breast": { source: "USDA", kcal: 114, protein: 24, fats: 1, carbs: 0 },
  "ground turkey": { source: "USDA", kcal: 148, protein: 19, fats: 8, carbs: 0 },
  "duck breast": { source: "USDA", kcal: 201, protein: 24, fats: 11, carbs: 0 },
  // ---- red meat / pork ----
  beef: { source: "USDA", kcal: 217, protein: 26, fats: 12, carbs: 0 },
  steak: { source: "USDA", kcal: 217, protein: 26, fats: 12, carbs: 0 },
  "beef sirloin": { source: "USDA", kcal: 201, protein: 29, fats: 9, carbs: 0 },
  "ground beef": { source: "USDA", kcal: 250, protein: 17, fats: 20, carbs: 0 },
  pork: { source: "USDA", kcal: 143, protein: 21, fats: 6, carbs: 0 },
  "pork chop": { source: "USDA", kcal: 231, protein: 24, fats: 15, carbs: 0 },
  "ground pork": { source: "USDA", kcal: 263, protein: 17, fats: 21, carbs: 0 },
  bacon: { source: "USDA", kcal: 541, protein: 37, fats: 42, carbs: 1 },
  ham: { source: "USDA", kcal: 145, protein: 21, fats: 6, carbs: 1 },
  lamb: { source: "USDA", kcal: 294, protein: 25, fats: 21, carbs: 0 },
  veal: { source: "USDA", kcal: 172, protein: 24, fats: 8, carbs: 0 },
  sausage: { source: "USDA", kcal: 301, protein: 15, fats: 27, carbs: 2 },
  // ---- fish / seafood (raw unless noted) ----
  salmon: { source: "USDA", kcal: 208, protein: 20, fats: 13, carbs: 0 },
  tuna: { source: "USDA", kcal: 116, protein: 26, fats: 1, carbs: 0 },
  cod: { source: "USDA", kcal: 82, protein: 18, fats: 1, carbs: 0 },
  tilapia: { source: "USDA", kcal: 96, protein: 20, fats: 2, carbs: 0 },
  trout: { source: "USDA", kcal: 148, protein: 21, fats: 7, carbs: 0 },
  mackerel: { source: "USDA", kcal: 205, protein: 19, fats: 14, carbs: 0 },
  sardines: { source: "USDA", kcal: 208, protein: 25, fats: 11, carbs: 0 },
  herring: { source: "USDA", kcal: 158, protein: 18, fats: 9, carbs: 0 },
  halibut: { source: "USDA", kcal: 111, protein: 23, fats: 2, carbs: 0 },
  "sea bass": { source: "USDA", kcal: 97, protein: 18, fats: 2, carbs: 0 },
  shrimp: { source: "USDA", kcal: 99, protein: 24, fats: 0, carbs: 0 },
  crab: { source: "USDA", kcal: 97, protein: 19, fats: 2, carbs: 0 },
  lobster: { source: "USDA", kcal: 89, protein: 19, fats: 1, carbs: 1 },
  mussels: { source: "USDA", kcal: 86, protein: 12, fats: 2, carbs: 4 },
  squid: { source: "USDA", kcal: 92, protein: 16, fats: 1, carbs: 3 },
  // ---- eggs ----
  egg: { source: "USDA", kcal: 143, protein: 13, fats: 10, carbs: 1 },
  eggs: { source: "USDA", kcal: 143, protein: 13, fats: 10, carbs: 1 },
  "egg white": { source: "USDA", kcal: 52, protein: 11, fats: 0, carbs: 1 },
  "egg yolk": { source: "USDA", kcal: 322, protein: 16, fats: 27, carbs: 4 },
  "scrambled egg": { source: "USDA", kcal: 149, protein: 10, fats: 11, carbs: 2 },
  "scrambled eggs": { source: "USDA", kcal: 149, protein: 10, fats: 11, carbs: 2 },
  "boiled egg": { source: "USDA", kcal: 155, protein: 13, fats: 11, carbs: 1 },
  "boiled eggs": { source: "USDA", kcal: 155, protein: 13, fats: 11, carbs: 1 },
  "poached egg": { source: "USDA", kcal: 143, protein: 13, fats: 10, carbs: 1 },
  "fried egg": { source: "USDA", kcal: 196, protein: 14, fats: 15, carbs: 1 },
  omelet: { source: "USDA", kcal: 154, protein: 11, fats: 12, carbs: 1 },
  omelette: { source: "USDA", kcal: 154, protein: 11, fats: 12, carbs: 1 },
  // ---- dairy ----
  milk: { source: "USDA", kcal: 61, protein: 3, fats: 3, carbs: 5 },
  "skim milk": { source: "USDA", kcal: 34, protein: 3, fats: 0, carbs: 5 },
  yogurt: { source: "USDA", kcal: 61, protein: 4, fats: 3, carbs: 5 },
  "greek yogurt": { source: "USDA", kcal: 59, protein: 10, fats: 0, carbs: 4 },
  kefir: { source: "USDA", kcal: 41, protein: 3, fats: 1, carbs: 5 },
  "cottage cheese": { source: "USDA", kcal: 98, protein: 11, fats: 4, carbs: 3 },
  ricotta: { source: "USDA", kcal: 174, protein: 11, fats: 13, carbs: 3 },
  cheese: { source: "USDA", kcal: 403, protein: 25, fats: 33, carbs: 1 },
  cheddar: { source: "USDA", kcal: 403, protein: 25, fats: 33, carbs: 1 },
  mozzarella: { source: "USDA", kcal: 280, protein: 28, fats: 17, carbs: 3 },
  parmesan: { source: "USDA", kcal: 431, protein: 38, fats: 29, carbs: 4 },
  feta: { source: "USDA", kcal: 264, protein: 14, fats: 21, carbs: 4 },
  gouda: { source: "USDA", kcal: 356, protein: 25, fats: 27, carbs: 2 },
  "cream cheese": { source: "USDA", kcal: 342, protein: 6, fats: 34, carbs: 4 },
  "sour cream": { source: "USDA", kcal: 198, protein: 2, fats: 19, carbs: 5 },
  cream: { source: "USDA", kcal: 340, protein: 2, fats: 36, carbs: 3 },
  "whey protein": { source: "USDA", kcal: 400, protein: 80, fats: 6, carbs: 8 },
  // ---- grains / starches (DRY) ----
  "rolled oats": { source: "USDA", kcal: 379, protein: 13, fats: 7, carbs: 67 },
  oats: { source: "USDA", kcal: 379, protein: 13, fats: 7, carbs: 67 },
  "white rice": { source: "USDA", kcal: 360, protein: 7, fats: 1, carbs: 80 },
  "brown rice": { source: "USDA", kcal: 362, protein: 8, fats: 3, carbs: 76 },
  rice: { source: "USDA", kcal: 360, protein: 7, fats: 1, carbs: 80 },
  quinoa: { source: "USDA", kcal: 368, protein: 14, fats: 6, carbs: 64 },
  buckwheat: { source: "USDA", kcal: 343, protein: 13, fats: 3, carbs: 72 },
  bulgur: { source: "USDA", kcal: 342, protein: 12, fats: 1, carbs: 76 },
  couscous: { source: "USDA", kcal: 376, protein: 13, fats: 1, carbs: 77 },
  millet: { source: "USDA", kcal: 378, protein: 11, fats: 4, carbs: 73 },
  barley: { source: "USDA", kcal: 354, protein: 12, fats: 2, carbs: 73 },
  semolina: { source: "USDA", kcal: 360, protein: 13, fats: 1, carbs: 73 },
  cornmeal: { source: "USDA", kcal: 362, protein: 8, fats: 4, carbs: 76 },
  flour: { source: "USDA", kcal: 364, protein: 10, fats: 1, carbs: 76 },
  pasta: { source: "USDA", kcal: 371, protein: 13, fats: 2, carbs: 75 },
  noodles: { source: "USDA", kcal: 384, protein: 14, fats: 4, carbs: 71 },
  bread: { source: "USDA", kcal: 265, protein: 9, fats: 3, carbs: 49 },
  "whole wheat bread": { source: "USDA", kcal: 247, protein: 13, fats: 3, carbs: 41 },
  "white bread": { source: "USDA", kcal: 266, protein: 8, fats: 3, carbs: 49 },
  "rye bread": { source: "USDA", kcal: 259, protein: 9, fats: 3, carbs: 48 },
  bagel: { source: "USDA", kcal: 250, protein: 10, fats: 2, carbs: 49 },
  tortilla: { source: "USDA", kcal: 218, protein: 6, fats: 5, carbs: 37 },
  cornflakes: { source: "USDA", kcal: 357, protein: 8, fats: 1, carbs: 84 },
  granola: { source: "USDA", kcal: 471, protein: 10, fats: 20, carbs: 64 },
  potato: { source: "USDA", kcal: 77, protein: 2, fats: 0, carbs: 17 },
  "sweet potato": { source: "USDA", kcal: 86, protein: 2, fats: 0, carbs: 20 },
  // ---- legumes (DRY unless noted) ----
  lentils: { source: "USDA", kcal: 352, protein: 25, fats: 1, carbs: 63 },
  chickpeas: { source: "USDA", kcal: 364, protein: 19, fats: 6, carbs: 61 },
  beans: { source: "USDA", kcal: 333, protein: 21, fats: 1, carbs: 60 },
  "black beans": { source: "USDA", kcal: 341, protein: 21, fats: 1, carbs: 62 },
  "kidney beans": { source: "USDA", kcal: 333, protein: 24, fats: 1, carbs: 60 },
  "pinto beans": { source: "USDA", kcal: 347, protein: 21, fats: 1, carbs: 63 },
  "white beans": { source: "USDA", kcal: 333, protein: 23, fats: 1, carbs: 60 },
  "split peas": { source: "USDA", kcal: 341, protein: 25, fats: 1, carbs: 60 },
  soybeans: { source: "USDA", kcal: 446, protein: 36, fats: 20, carbs: 30 },
  edamame: { source: "USDA", kcal: 121, protein: 12, fats: 5, carbs: 9 },
  // ---- fruit (raw) ----
  banana: { source: "USDA", kcal: 89, protein: 1, fats: 0, carbs: 23 },
  apple: { source: "USDA", kcal: 52, protein: 0, fats: 0, carbs: 14 },
  orange: { source: "USDA", kcal: 47, protein: 1, fats: 0, carbs: 12 },
  pear: { source: "USDA", kcal: 57, protein: 0, fats: 0, carbs: 15 },
  grapes: { source: "USDA", kcal: 67, protein: 1, fats: 0, carbs: 17 },
  peach: { source: "USDA", kcal: 39, protein: 1, fats: 0, carbs: 10 },
  plum: { source: "USDA", kcal: 46, protein: 1, fats: 0, carbs: 11 },
  apricot: { source: "USDA", kcal: 48, protein: 1, fats: 0, carbs: 11 },
  pineapple: { source: "USDA", kcal: 50, protein: 1, fats: 0, carbs: 13 },
  mango: { source: "USDA", kcal: 60, protein: 1, fats: 0, carbs: 15 },
  watermelon: { source: "USDA", kcal: 30, protein: 1, fats: 0, carbs: 8 },
  melon: { source: "USDA", kcal: 34, protein: 1, fats: 0, carbs: 8 },
  kiwi: { source: "USDA", kcal: 61, protein: 1, fats: 1, carbs: 15 },
  cherries: { source: "USDA", kcal: 63, protein: 1, fats: 0, carbs: 16 },
  blueberries: { source: "USDA", kcal: 57, protein: 1, fats: 0, carbs: 14 },
  strawberries: { source: "USDA", kcal: 32, protein: 1, fats: 0, carbs: 8 },
  raspberries: { source: "USDA", kcal: 52, protein: 1, fats: 1, carbs: 12 },
  blackberries: { source: "USDA", kcal: 43, protein: 1, fats: 1, carbs: 10 },
  grapefruit: { source: "USDA", kcal: 42, protein: 1, fats: 0, carbs: 11 },
  lemon: { source: "USDA", kcal: 29, protein: 1, fats: 0, carbs: 9 },
  lime: { source: "USDA", kcal: 30, protein: 1, fats: 0, carbs: 11 },
  pomegranate: { source: "USDA", kcal: 83, protein: 2, fats: 1, carbs: 19 },
  fig: { source: "USDA", kcal: 74, protein: 1, fats: 0, carbs: 19 },
  papaya: { source: "USDA", kcal: 43, protein: 1, fats: 0, carbs: 11 },
  nectarine: { source: "USDA", kcal: 44, protein: 1, fats: 0, carbs: 11 },
  tangerine: { source: "USDA", kcal: 53, protein: 1, fats: 0, carbs: 13 },
  cranberries: { source: "USDA", kcal: 46, protein: 0, fats: 0, carbs: 12 },
  dates: { source: "USDA", kcal: 277, protein: 2, fats: 0, carbs: 75 },
  raisins: { source: "USDA", kcal: 299, protein: 3, fats: 0, carbs: 79 },
  coconut: { source: "USDA", kcal: 354, protein: 3, fats: 33, carbs: 15 },
  // ---- vegetables (raw) ----
  broccoli: { source: "USDA", kcal: 34, protein: 3, fats: 0, carbs: 7 },
  cauliflower: { source: "USDA", kcal: 25, protein: 2, fats: 0, carbs: 5 },
  spinach: { source: "USDA", kcal: 23, protein: 3, fats: 0, carbs: 4 },
  kale: { source: "USDA", kcal: 49, protein: 4, fats: 1, carbs: 9 },
  arugula: { source: "USDA", kcal: 25, protein: 3, fats: 1, carbs: 4 },
  lettuce: { source: "USDA", kcal: 15, protein: 1, fats: 0, carbs: 3 },
  cabbage: { source: "USDA", kcal: 25, protein: 1, fats: 0, carbs: 6 },
  tomato: { source: "USDA", kcal: 18, protein: 1, fats: 0, carbs: 4 },
  cucumber: { source: "USDA", kcal: 15, protein: 1, fats: 0, carbs: 4 },
  carrot: { source: "USDA", kcal: 41, protein: 1, fats: 0, carbs: 10 },
  "bell pepper": { source: "USDA", kcal: 26, protein: 1, fats: 0, carbs: 6 },
  zucchini: { source: "USDA", kcal: 17, protein: 1, fats: 0, carbs: 3 },
  eggplant: { source: "USDA", kcal: 25, protein: 1, fats: 0, carbs: 6 },
  mushroom: { source: "USDA", kcal: 22, protein: 3, fats: 0, carbs: 3 },
  onion: { source: "USDA", kcal: 40, protein: 1, fats: 0, carbs: 9 },
  garlic: { source: "USDA", kcal: 149, protein: 6, fats: 1, carbs: 33 },
  celery: { source: "USDA", kcal: 16, protein: 1, fats: 0, carbs: 3 },
  asparagus: { source: "USDA", kcal: 20, protein: 2, fats: 0, carbs: 4 },
  "green beans": { source: "USDA", kcal: 31, protein: 2, fats: 0, carbs: 7 },
  peas: { source: "USDA", kcal: 81, protein: 5, fats: 0, carbs: 14 },
  corn: { source: "USDA", kcal: 86, protein: 3, fats: 1, carbs: 19 },
  beetroot: { source: "USDA", kcal: 43, protein: 2, fats: 0, carbs: 10 },
  pumpkin: { source: "USDA", kcal: 26, protein: 1, fats: 0, carbs: 7 },
  radish: { source: "USDA", kcal: 16, protein: 1, fats: 0, carbs: 3 },
  "brussels sprouts": { source: "USDA", kcal: 43, protein: 3, fats: 0, carbs: 9 },
  leek: { source: "USDA", kcal: 61, protein: 1, fats: 0, carbs: 14 },
  artichoke: { source: "USDA", kcal: 47, protein: 3, fats: 0, carbs: 11 },
  okra: { source: "USDA", kcal: 33, protein: 2, fats: 0, carbs: 7 },
  turnip: { source: "USDA", kcal: 28, protein: 1, fats: 0, carbs: 6 },
  parsnip: { source: "USDA", kcal: 75, protein: 1, fats: 0, carbs: 18 },
  ginger: { source: "USDA", kcal: 80, protein: 2, fats: 1, carbs: 18 },
  "chili pepper": { source: "USDA", kcal: 40, protein: 2, fats: 0, carbs: 9 },
  // ---- nuts / seeds ----
  almonds: { source: "USDA", kcal: 579, protein: 21, fats: 50, carbs: 22 },
  peanuts: { source: "USDA", kcal: 567, protein: 26, fats: 49, carbs: 16 },
  cashews: { source: "USDA", kcal: 553, protein: 18, fats: 44, carbs: 30 },
  pistachios: { source: "USDA", kcal: 560, protein: 20, fats: 45, carbs: 28 },
  hazelnuts: { source: "USDA", kcal: 628, protein: 15, fats: 61, carbs: 17 },
  pecans: { source: "USDA", kcal: 691, protein: 9, fats: 72, carbs: 14 },
  "macadamia nuts": { source: "USDA", kcal: 718, protein: 8, fats: 76, carbs: 14 },
  "brazil nuts": { source: "USDA", kcal: 659, protein: 14, fats: 67, carbs: 12 },
  walnuts: { source: "USDA", kcal: 654, protein: 15, fats: 65, carbs: 14 },
  "pine nuts": { source: "USDA", kcal: 673, protein: 14, fats: 68, carbs: 13 },
  "sunflower seeds": { source: "USDA", kcal: 584, protein: 21, fats: 51, carbs: 20 },
  "pumpkin seeds": { source: "USDA", kcal: 559, protein: 30, fats: 49, carbs: 11 },
  "chia seeds": { source: "USDA", kcal: 486, protein: 17, fats: 31, carbs: 42 },
  "flax seeds": { source: "USDA", kcal: 534, protein: 18, fats: 42, carbs: 29 },
  "sesame seeds": { source: "USDA", kcal: 573, protein: 18, fats: 50, carbs: 23 },
  "almond butter": { source: "USDA", kcal: 614, protein: 21, fats: 55, carbs: 19 },
  "peanut butter": { source: "USDA", kcal: 588, protein: 25, fats: 50, carbs: 20 },
  // ---- fats / oils ----
  "olive oil": { source: "USDA", kcal: 884, protein: 0, fats: 100, carbs: 0 },
  "coconut oil": { source: "USDA", kcal: 892, protein: 0, fats: 100, carbs: 0 },
  "vegetable oil": { source: "USDA", kcal: 884, protein: 0, fats: 100, carbs: 0 },
  "sunflower oil": { source: "USDA", kcal: 884, protein: 0, fats: 100, carbs: 0 },
  butter: { source: "USDA", kcal: 717, protein: 1, fats: 81, carbs: 0 },
  ghee: { source: "USDA", kcal: 900, protein: 0, fats: 100, carbs: 0 },
  lard: { source: "USDA", kcal: 902, protein: 0, fats: 100, carbs: 0 },
  mayonnaise: { source: "USDA", kcal: 680, protein: 1, fats: 75, carbs: 1 },
  avocado: { source: "USDA", kcal: 160, protein: 2, fats: 15, carbs: 9 },
  // ---- plant proteins / alt milks ----
  tofu: { source: "USDA", kcal: 144, protein: 15, fats: 9, carbs: 3 },
  tempeh: { source: "USDA", kcal: 192, protein: 20, fats: 11, carbs: 8 },
  seitan: { source: "USDA", kcal: 370, protein: 75, fats: 2, carbs: 14 },
  "soy milk": { source: "USDA", kcal: 54, protein: 3, fats: 2, carbs: 6 },
  "almond milk": { source: "USDA", kcal: 17, protein: 1, fats: 1, carbs: 1 },
  "oat milk": { source: "USDA", kcal: 47, protein: 1, fats: 2, carbs: 7 },
  hummus: { source: "USDA", kcal: 166, protein: 8, fats: 10, carbs: 14 },
  // ---- condiments / sweeteners ----
  honey: { source: "USDA", kcal: 304, protein: 0, fats: 0, carbs: 82 },
  sugar: { source: "USDA", kcal: 387, protein: 0, fats: 0, carbs: 100 },
  "maple syrup": { source: "USDA", kcal: 260, protein: 0, fats: 0, carbs: 67 },
  jam: { source: "USDA", kcal: 278, protein: 0, fats: 0, carbs: 69 },
  ketchup: { source: "USDA", kcal: 101, protein: 1, fats: 0, carbs: 27 },
  mustard: { source: "USDA", kcal: 66, protein: 4, fats: 4, carbs: 5 },
  "soy sauce": { source: "USDA", kcal: 53, protein: 8, fats: 0, carbs: 5 },
  "dark chocolate": { source: "USDA", kcal: 546, protein: 5, fats: 31, carbs: 61 },
  "milk chocolate": { source: "USDA", kcal: 535, protein: 8, fats: 30, carbs: 59 },
  // ---- extras ----
  anchovy: { source: "USDA", kcal: 131, protein: 20, fats: 5, carbs: 0 },
  scallops: { source: "USDA", kcal: 88, protein: 17, fats: 1, carbs: 2 },
  octopus: { source: "USDA", kcal: 82, protein: 15, fats: 1, carbs: 2 },
  prosciutto: { source: "USDA", kcal: 250, protein: 26, fats: 16, carbs: 0 },
  salami: { source: "USDA", kcal: 336, protein: 22, fats: 26, carbs: 2 },
  "swiss cheese": { source: "USDA", kcal: 380, protein: 27, fats: 28, carbs: 5 },
  "spring onion": { source: "USDA", kcal: 32, protein: 2, fats: 0, carbs: 7 },
  sauerkraut: { source: "USDA", kcal: 19, protein: 1, fats: 0, carbs: 4 },
  blackcurrant: { source: "USDA", kcal: 63, protein: 1, fats: 0, carbs: 15 },
  "cherry tomato": { source: "USDA", kcal: 18, protein: 1, fats: 0, carbs: 4 },
};

// Curated whole-food catalog (read-only) — exported so the deterministic meal builder can
// pick foods by category without a network/AI call.
export { CURATED };
export const CURATED_NAMES = Object.keys(CURATED);

// Coarse food categories used by the deterministic meal builder (src/domain/mealTemplate.ts)
// to assemble a balanced plate (a protein + a carb + veg/fruit + a fat) per meal.
export type FoodCategory = "protein" | "grain" | "veg" | "fruit" | "fat" | "dairy" | "condiment";

// Explicit category by curated name. Keys not listed fall back to a keyword classifier below.
const CATEGORY_OVERRIDE: Record<string, FoodCategory> = {
  // dairy that doubles as protein — classified dairy so lactose exclusion catches them
  "greek yogurt": "dairy", "cottage cheese": "dairy", "whey protein": "protein",
  // legumes / plant proteins → protein
  lentils: "protein", chickpeas: "protein", beans: "protein", "black beans": "protein",
  "kidney beans": "protein", "pinto beans": "protein", "white beans": "protein",
  "split peas": "protein", soybeans: "protein", edamame: "protein", tofu: "protein",
  tempeh: "protein", seitan: "protein", hummus: "protein",
  // potatoes/starchy veg → grain (carb source)
  potato: "grain", "sweet potato": "grain", corn: "grain", peas: "grain",
  avocado: "fat", coconut: "fat",
};

const CAT_HINTS: { cat: FoodCategory; words: string[] }[] = [
  { cat: "protein", words: ["chicken", "turkey", "duck", "beef", "steak", "pork", "bacon", "ham", "lamb", "veal", "sausage", "salmon", "tuna", "cod", "tilapia", "trout", "mackerel", "sardines", "herring", "halibut", "sea bass", "shrimp", "crab", "lobster", "mussels", "squid", "egg", "omelet", "omelette", "anchovy", "scallops", "octopus", "prosciutto", "salami"] },
  { cat: "dairy", words: ["milk", "yogurt", "kefir", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "gouda", "ricotta", "cream", "swiss"] },
  { cat: "grain", words: ["oats", "rice", "quinoa", "buckwheat", "bulgur", "couscous", "millet", "barley", "semolina", "cornmeal", "flour", "pasta", "noodles", "bread", "bagel", "tortilla", "cornflakes", "granola"] },
  { cat: "fruit", words: ["banana", "apple", "orange", "pear", "grapes", "peach", "plum", "apricot", "pineapple", "mango", "watermelon", "melon", "kiwi", "cherries", "berries", "berry", "grapefruit", "lemon", "lime", "pomegranate", "fig", "papaya", "nectarine", "tangerine", "dates", "raisins", "currant"] },
  { cat: "fat", words: ["oil", "butter", "ghee", "lard", "mayonnaise", "almonds", "peanut", "cashews", "pistachios", "hazelnuts", "pecans", "macadamia", "brazil nuts", "walnuts", "pine nuts", "seeds", "chocolate"] },
  { cat: "condiment", words: ["honey", "sugar", "syrup", "jam", "ketchup", "mustard", "soy sauce", "sauerkraut"] },
  { cat: "veg", words: ["broccoli", "cauliflower", "spinach", "kale", "arugula", "lettuce", "cabbage", "tomato", "cucumber", "carrot", "bell pepper", "zucchini", "eggplant", "mushroom", "onion", "garlic", "celery", "asparagus", "green beans", "beetroot", "pumpkin", "radish", "brussels", "leek", "artichoke", "okra", "turnip", "parsnip", "ginger", "chili", "spring onion"] },
];

/** Classify a curated food into a coarse category for plate assembly. */
export function foodCategory(name: string): FoodCategory {
  const n = name.toLowerCase().trim();
  if (CATEGORY_OVERRIDE[n]) return CATEGORY_OVERRIDE[n];
  for (const { cat, words } of CAT_HINTS) {
    if (words.some((w) => n.includes(w))) return cat;
  }
  return "condiment"; // unknowns treated as filler (never a plate centerpiece)
}

// Cooking/prep adjectives stripped to map "grilled salmon" / "steamed broccoli" / "raw egg"
// onto their curated base entry.
const PREP_WORDS =
  /\b(raw|fresh|dry|dried|cooked|boiled|steamed|grilled|baked|roasted|fried|plain|skinless|boneless|lean|whole|large|medium|small)\b/g;

/** Authoritative curated lookup: exact name, then the name with prep adjectives removed. */
export function curatedPer100g(query: string): Per100g | null {
  const norm = query.toLowerCase().trim();
  if (CURATED[norm]) return CURATED[norm];
  const base = norm.replace(PREP_WORDS, "").replace(/\s+/g, " ").trim();
  if (base && CURATED[base]) return CURATED[base];
  return null;
}

// USDA descriptions that mean the WRONG form for a generic whole-food query.
const BAD_FORM = /dried|dehydrated|powder|chips?|juice|sauce|breaded|infant|baby food|candied|fried/i;

/** Look up reference macros per 100g for a food name.
 * Primary: USDA FoodData Central. Fallback: Gemini (replaces the flaky OFF search).
 * Returns null if no confident match — verification is best-effort. */
export async function lookupPer100g(env: Env, query: string): Promise<Per100g | null> {
  const q = query.trim();
  if (!q) return null;
  const curated = curatedPer100g(q);
  if (curated) return curated;
  const key = (env as Env & { USDA_FDC_API_KEY?: string }).USDA_FDC_API_KEY || "DEMO_KEY";
  try {
    const usda = await usdaLookup(key, q);
    if (usda) return usda;
  } catch { /* fall through to Gemini */ }
  return null; // no DB available here — Gemini fallback requires D1, use lookupPer100gCached
}

/** Cached per-100g lookup (D1 `food_cache`).
 * Order: CURATED → cache → USDA → Gemini.
 * Caches the result so subsequent calls (same food, same session) are free. */
export async function lookupPer100gCached(db: D1Database, env: Env, query: string): Promise<Per100g | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // Curated wins over any cached row for common foods (cache may be stale/wrong form).
  const curated = curatedPer100g(q);
  if (curated) return curated;
  const cached = (await getFoodCache(db, q).catch(() => null)) as Per100g | null;
  if (cached) return cached;
  // Try USDA first.
  const key = (env as Env & { USDA_FDC_API_KEY?: string }).USDA_FDC_API_KEY || "DEMO_KEY";
  let fresh: Per100g | null = null;
  try { fresh = await usdaLookup(key, q); } catch { /* ignore */ }
  // Gemini fallback — fires only when USDA has no match (unknown brand, regional food, etc.)
  if (!fresh) {
    try {
      const res = await aiJSON<Per100gResult>(env, {
        system: per100gSystem(),
        user: q,
        schema: PER100G_SCHEMA,
        temperature: 0.1,
        kind: "nutrition",
        db,
      });
      if (res.kcal > 0) fresh = { source: "Gemini", kcal: Math.round(res.kcal), protein: Math.round(res.protein), fats: Math.round(res.fats), carbs: Math.round(res.carbs) };
    } catch { /* Gemini also unavailable — give up */ }
  }
  if (fresh) await putFoodCache(db, q, fresh).catch(() => {});
  return fresh;
}

async function usdaLookup(apiKey: string, query: string): Promise<Per100g | null> {
  // Pull several candidates and pick the first whose description isn't a wrong form
  // (dried/powder/juice/…) — pageSize=1 used to grab e.g. "egg white" for "egg".
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    foods?: { description?: string; foodNutrients?: { nutrientId?: number; value?: number }[] }[];
  };
  const foods = data.foods ?? [];
  // Prefer candidates whose description doesn't read as a wrong form; fall back to any.
  const ordered = [...foods.filter((f) => !BAD_FORM.test(f.description ?? "")), ...foods];
  for (const food of ordered) {
    if (!food?.foodNutrients) continue;
    const byId = (id: number) => food.foodNutrients!.find((n) => n.nutrientId === id)?.value ?? 0;
    // Foundation foods report energy as Atwater (2047/2048); SR Legacy/Branded use 1008.
    const kcal = byId(1008) || byId(2047) || byId(2048);
    if (!kcal) continue;
    return {
      source: "USDA",
      kcal: Math.round(kcal),
      protein: Math.round(byId(1003)),
      fats: Math.round(byId(1004)),
      carbs: Math.round(byId(1005)),
    };
  }
  return null;
}

// offLookup (Open Food Facts) removed — replaced by Gemini fallback in lookupPer100gCached.
