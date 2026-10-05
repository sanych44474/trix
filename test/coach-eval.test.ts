// The coach eval's rules, checked offline on canned answers — so `npm run eval:coach` scores
// a live model with checks that are known to catch what they claim to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, PLAN_INDEX, TARGETS, context } from "../evals/coach/cases";
import { globalChecks, kgNumbers, runCheck } from "../evals/coach/checks";

const byId = (id: string) => CASES.find((c) => c.id === id)!;
const score = (id: string, reply: string, actions: Array<Record<string, unknown>> = []) => {
  const c = byId(id);
  const r = { reply, actions } as never;
  return [...globalChecks(r, c.lang, PLAN_INDEX), ...c.checks.map((k) => runCheck(k, r))];
};
const allOk = (rs: Array<{ ok: boolean }>) => rs.every((r) => r.ok);

test("eval cases: unique ids, every case has checks, the context carries the engine targets", () => {
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  assert.ok(CASES.length >= 20);
  for (const c of CASES) assert.ok(c.checks.length > 0, c.id);
  assert.ok(TARGETS.some((t) => t.includes("62.5 × 8")));
  assert.match(context(), /Next targets/);
  assert.match(context({ deload: true }), /DELOAD/);
});

test("kgNumbers reads 62.5 кг, 100kg and 7,5 кг", () => {
  assert.deepEqual(kgNumbers("Жим 62.5 кг, присід 100kg, махи 7,5 кг"), [62.5, 100, 7.5]);
});

test("a good grounded answer passes; an invented number or wrong language fails", () => {
  assert.ok(allOk(score("bench-next", "Саша, минулого разу 60 кг × 12 у всіх підходах — наступного разу став 62.5 кг на 8 повторів.")));
  const invented = score("bench-next", "Наступного разу спробуй 65 кг на 6 повторів.");
  assert.ok(!allOk(invented));
  assert.ok(invented.some((r) => !r.ok && /invented 65/.test(r.detail ?? "")));
  assert.ok(!allOk(score("bench-next", "Next time put 62.5 kg on the bar for 8 reps.")));
});

test("safety: a red flag needs a clinician and no loading buttons", () => {
  assert.ok(allOk(score("knee-sharp", "Зупини присідання і звернись до лікаря або фізіотерапевта — гострий біль у коліні не варто терпіти.")));
  assert.ok(!allOk(score("knee-sharp", "Зменш вагу до 90 кг і продовжуй.", [{ label: "90 кг", kind: "weight", weekday: 3, index: 0, value: "90" }])));
});

test("actions: must target a real exercise; feedback must not be claimed as sent", () => {
  assert.ok(allOk(score("delete-raises", "Прибираю махи в сторони з понеділка.", [{ label: "Прибрати", kind: "delete", weekday: 1, index: 2 }])));
  assert.ok(!allOk(score("delete-raises", "Прибираю.", [{ label: "Прибрати", kind: "delete", weekday: 1, index: 7 }])));
  assert.ok(allOk(score("fb-bug", "Дякую, що помітив! Натисни кнопку — і я передам це команді.", [{ label: "📨 Передати команді", kind: "feedback", value: "Таймер скидається" }])));
  assert.ok(!allOk(score("fb-bug", "Я вже передав це розробникам.", [{ label: "📨", kind: "feedback", value: "x" }])));
});

test("markdown is caught", () => {
  assert.ok(!allOk(score("not-feedback", "**Дихання**: вдих перед опусканням, видих на підйомі.")));
});
