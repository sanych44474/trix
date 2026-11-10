// The onboarding funnel: "started" and "finished" counted by both surfaces. Before this, "started"
// fired only when the bot wizard's first step was answered by typing -- but that step is a button,
// and the Mini App form counted nothing at all, so the funnel read as zero starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { FUNNEL_FINISHED, FUNNEL_STARTED } from "../src/adapters/d1/v2Analytics";
import { handleOnboardingApi } from "../src/webapp/profileApi";

type Db = ReturnType<typeof newDb>;
const total = async (db: Db, event: string) =>
  (await db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM v2_analytics_events WHERE event = ?").bind(event).first<{ n: number }>())!.n;

function post(db: Db, userId: number, path: string, body: unknown) {
  const full = `${path}?debugUser=${userId}`;
  return handleOnboardingApi(
    new Request(`https://x${full}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    new URL(`https://x${full}`),
    { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never,
  );
}

test("Mini App form: the first saved answer is started, later saves are not, submit is finished", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "en", "Bo");
  const draft = (answered: number) => post(db, 2, "/api/v2/onboarding/draft", { answers: { sex: "male" }, answered, total: 10 });

  assert.equal((await draft(0)).status, 200);
  assert.equal(await total(db, FUNNEL_STARTED), 0, "opening the form without answering is not a start");
  await draft(1);
  await draft(2);
  assert.equal(await total(db, FUNNEL_STARTED), 1);

  const res = await post(db, 2, "/api/v2/onboarding", {
    sex: "male", age: 30, heightCm: 180, weightKg: 80,
    goal: "fat loss", level: "beginner", equipment: "full gym", trainingWeekdays: [1, 3, 5],
  });
  assert.equal(res.status, 200);
  assert.equal(await total(db, FUNNEL_FINISHED), 1);
});

test("Mini App form: an incomplete submission is not finished", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "en", "Cy");
  assert.equal((await post(db, 3, "/api/v2/onboarding", { sex: "male" })).status, 400);
  assert.equal(await total(db, FUNNEL_FINISHED), 0);
});
