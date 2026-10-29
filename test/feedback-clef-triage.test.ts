import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { insertFeedback, listFeedback, updateFeedback } from "../src/adapters/d1/v2Feedback";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { triageFeedbackCategory } from "../src/features/feedback/triageFeedback";
import { clefCategory } from "../src/domain/feedbackTriage";
import type { Env } from "../src/types";

const DATE = "2026-10-29";

function clefAnswer(choice: string, confidence: number) {
  return {
    model: "clef-flash",
    answers: {
      category: {
        type: "choice",
        choice,
        probabilities: { bug: 0.1, idea: 0.1, complaint: 0.1, praise: 0.1, other: 0.6 },
        confidence,
      },
    },
    usage: { input_tokens: 80, output_tokens: 2 },
  };
}

/** A D1 with one feedback row whose text the rules leave as "other", and an env whose AI is `run`. */
async function setup(text: string, run: (model: string, input: unknown) => Promise<unknown>) {
  const db = newDb();
  await getOrCreateUser(db, 7, 7, "uk", "Ann");
  const id = (await insertFeedback(db as unknown as D1Database, { userId: 7, text, date: DATE }))!;
  const env = { AI: { run }, DB: db } as unknown as Env;
  const categoryOf = async () => (await listFeedback(db as unknown as D1Database, "all")).rows.find((r) => r.id === id)!.category;
  return { db: db as unknown as D1Database, env, id, categoryOf };
}

test("rules hit: Clef is not called and the rule category stays", async () => {
  let calls = 0;
  const { env, id, categoryOf } = await setup("Таймер скидається коли згортаю застосунок", async () => {
    calls++;
    return clefAnswer("idea", 0.99);
  });
  await triageFeedbackCategory(env, id, "Таймер скидається коли згортаю застосунок");
  assert.equal(calls, 0);
  assert.equal(await categoryOf(), "bug");
});

test("rules left it as other, Clef is confident: the row takes Clef's category", async () => {
  const text = "The coach kept suggesting oatmeal, which I can't eat";
  let seen: { state?: unknown; questions?: Record<string, { criteria?: Record<string, string> }> } = {};
  const { env, id, categoryOf } = await setup(text, async (_m, input) => {
    seen = input as typeof seen;
    return clefAnswer("complaint", 0.82);
  });
  await triageFeedbackCategory(env, id, text);
  assert.equal(await categoryOf(), "complaint");
  assert.equal(seen.state, text);
  assert.deepEqual(Object.keys(seen.questions!.category!.criteria!).sort(), ["bug", "complaint", "idea", "other", "praise"]);
});

test("low confidence (below 0.6): the row stays other", async () => {
  const text = "ок";
  const { env, id, categoryOf } = await setup(text, async () => clefAnswer("praise", 0.59));
  await triageFeedbackCategory(env, id, text);
  assert.equal(await categoryOf(), "other");
});

test("Clef answers other, or a category outside the four it may pick: the row stays other", async () => {
  const text = "hmm, what is this";
  const abstain = await setup(text, async () => clefAnswer("other", 0.95));
  await triageFeedbackCategory(abstain.env, abstain.id, text);
  assert.equal(await abstain.categoryOf(), "other");

  const rating = await setup(text, async () => clefAnswer("rating", 0.95));
  await triageFeedbackCategory(rating.env, rating.id, text);
  assert.equal(await rating.categoryOf(), "other");
});

test("Clef null (the AI call throws): the row stays other and nothing is thrown", async () => {
  const text = "ок";
  const { env, id, categoryOf } = await setup(text, async () => {
    throw new Error("Workers AI unavailable");
  });
  await triageFeedbackCategory(env, id, text);
  assert.equal(await categoryOf(), "other");
});

test("the owner re-sorted the row while Clef was running: Clef does not overwrite it", async () => {
  const text = "ok, what is this screen for";
  const { db, env, id, categoryOf } = await setup(text, async () => {
    await updateFeedback(db, id, { category: "idea" });
    return clefAnswer("bug", 0.9);
  });
  await triageFeedbackCategory(env, id, text);
  assert.equal(await categoryOf(), "idea");
});

test("clefCategory: only a confident bug/idea/complaint/praise is accepted", () => {
  assert.equal(clefCategory({ choice: "bug", confidence: 0.6 }), "bug");
  assert.equal(clefCategory({ choice: "bug", confidence: 0.59 }), null);
  assert.equal(clefCategory({ choice: "bug" }), null);
  assert.equal(clefCategory({ choice: "other", confidence: 0.99 }), null);
  assert.equal(clefCategory(null), null);
});
