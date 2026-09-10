import { test } from "node:test";
import assert from "node:assert/strict";
import { categorizeFood, formatGrams, groceryList, roundGrams } from "../src/domain/groceryList";

const menu = (items: [string, number][]) => ({ meals: [{ items: items.map(([food, grams]) => ({ food, grams })) }] });

test("categorizeFood: English and Ukrainian names land in the same aisle", () => {
  assert.equal(categorizeFood("Chicken breast"), "protein");
  assert.equal(categorizeFood("Куряче філе"), "protein");
  assert.equal(categorizeFood("Broccoli"), "produce");
  assert.equal(categorizeFood("Броколі"), "produce");
  assert.equal(categorizeFood("Oatmeal"), "grains");
  assert.equal(categorizeFood("Вівсянка"), "grains");
  assert.equal(categorizeFood("Olive oil"), "pantry");
  assert.equal(categorizeFood("Оливкова олія"), "pantry");
  assert.equal(categorizeFood("Something unheard of"), "other");
});

test("categorizeFood: dairy wins over the protein aisle for cheese-like foods", () => {
  assert.equal(categorizeFood("Cottage cheese"), "dairy");
  assert.equal(categorizeFood("Сир кисломолочний"), "dairy");
  // …but the guard keeps the words that merely START like "сир" out of the dairy aisle. They
  // fall through to "other", which is the right failure: still on the list, just not sorted.
  assert.equal(categorizeFood("Сироп кленовий"), "other");
  assert.equal(categorizeFood("Сироїжки"), "other");
});

test("roundGrams: shopping-sane amounts, never zero for a real item", () => {
  assert.equal(roundGrams(173), 170);
  assert.equal(roundGrams(38), 40);
  assert.equal(roundGrams(3), 5);
  assert.equal(roundGrams(1234), 1250);
  assert.equal(roundGrams(0), 0);
});

test("formatGrams: kilos past a kilo", () => {
  assert.equal(formatGrams(450), "450 g");
  assert.equal(formatGrams(1000), "1 kg");
  assert.equal(formatGrams(1250), "1.3 kg");
});

test("groceryList: merges the same food across meals and multiplies by the day count", () => {
  const day = {
    meals: [
      { items: [{ food: "Chicken breast", grams: 150 }, { food: "Rice", grams: 80 }] },
      { items: [{ food: "chicken breast", grams: 100 }] }, // same food, different casing
    ],
  };
  const list = groceryList([day], 5);
  const chicken = list.find((l) => l.food.toLowerCase() === "chicken breast")!;
  assert.equal(chicken.grams, 1250); // (150 + 100) × 5
  assert.equal(chicken.food, "Chicken breast"); // first spelling seen wins
  assert.equal(list.find((l) => l.food === "Rice")!.grams, 400);
});

test("groceryList: aisle order first, biggest amount first inside an aisle", () => {
  const list = groceryList([menu([["Olive oil", 20], ["Chicken breast", 200], ["Broccoli", 300], ["Rice", 100]])]);
  assert.deepEqual(list.map((l) => l.category), ["produce", "protein", "grains", "pantry"]);
});

test("groceryList: junk entries are dropped, not rendered as 0 g", () => {
  const list = groceryList([menu([["", 100], ["Rice", 0], ["Salt", Number.NaN as unknown as number]])]);
  assert.deepEqual(list, []);
});

test("groceryList: a repeat below 1 still gives a single day's list", () => {
  const list = groceryList([menu([["Rice", 100]])], 0);
  assert.equal(list[0].grams, 100);
});
