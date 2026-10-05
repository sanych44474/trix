import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFeedback } from "../src/domain/feedbackTriage";

test("classifyFeedback: uk/ru/en keywords, ratings first, bug beats idea", () => {
  assert.equal(classifyFeedback("⭐ 2/5 (rating)"), "rating");
  assert.equal(classifyFeedback("Таймер скидається коли згортаю застосунок"), "bug");
  assert.equal(classifyFeedback("[AI coach] Rest timer resets when minimised"), "bug");
  assert.equal(classifyFeedback("Не працює збереження, додайте кнопку"), "bug");
  assert.equal(classifyFeedback("Додайте темну тему для графіків"), "idea");
  assert.equal(classifyFeedback("Было бы круто видеть калории за неделю"), "idea");
  assert.equal(classifyFeedback("Дуже незручно вносити вагу"), "complaint");
  assert.equal(classifyFeedback("Дякую, бот топ!"), "praise");
  assert.equal(classifyFeedback("ок"), "other");
});
