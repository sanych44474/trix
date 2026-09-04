import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleClientCardPayload } from "../src/webapp/clientCard";
import { assemblePayload } from "../src/webapp/dashboard";
import type { ClientCardDoc, InjuryDoc, UserDoc } from "../src/types";

const TODAY = "2026-07-01";

const client = (profile: Partial<UserDoc["profile"]> = {}, over: Partial<UserDoc> = {}): UserDoc =>
  ({
    _id: 42,
    chatId: 42,
    lang: "en",
    onboarded: true,
    role: "client",
    trainerId: 7,
    profile: { name: "Olha", timezone: "UTC", ...profile },
    session: { mode: "idle" },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }) as UserDoc;

// A real (empty) dashboard payload via the same pure assembler the fetch wrapper uses.
const dash = (u: UserDoc) =>
  assemblePayload(u, TODAY, { bodyLogs: [], workouts: [], records: [], nutrition: [], plan: null });

const injury = (over: Partial<InjuryDoc> = {}): InjuryDoc => ({
  id: 1,
  userId: 42,
  area: "knee",
  severity: "mild",
  status: "active",
  reportedAt: "2026-06-20T10:00:00.000Z",
  checkAfter: "2026-06-27",
  lastAskedAt: null,
  swaps: [],
  resolvedAt: null,
  checkinsHistory: [{ date: "2026-06-25", score: 4 }],
  ...over,
});

const cardRow: ClientCardDoc = {
  trainerId: 7,
  clientId: 42,
  healthNotes: "asthma",
  personalNotes: "two kids",
  birthday: "1990-05-10",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const rows = (u: UserDoc, over: Partial<Parameters<typeof assembleClientCardPayload>[2]> = {}) => ({
  card: null,
  note: null,
  injuries: [] as InjuryDoc[],
  dashboard: dash(u),
  ...over,
});

test("consent off: shared has neither body nor health, no cycle", () => {
  const u = client({
    sex: "female",
    cycleTracking: true,
    lastPeriodStart: "2026-06-29",
    heightCm: 170,
    limitations: "knee pain",
  });
  const p = assembleClientCardPayload(u, TODAY, rows(u, { injuries: [injury()] }));
  assert.equal(p.shared.body, undefined);
  assert.equal(p.shared.health, undefined);
  assert.equal(p.cycle, undefined);
});

test("explicit false is still hidden (strict opt-in)", () => {
  const u = client({ shareWithTrainer: { body: false, health: false }, heightCm: 170, limitations: "x" });
  const p = assembleClientCardPayload(u, TODAY, rows(u));
  assert.equal(p.shared.body, undefined);
  assert.equal(p.shared.health, undefined);
});

test("body consent: anthro fields + measurements present, health still hidden", () => {
  const u = client({
    shareWithTrainer: { body: true },
    heightCm: 170,
    weightKg: 64,
    age: 33,
    sex: "female",
    goalWeight: 60,
    measurements: { waist: 70, hips: 96 },
    limitations: "lower back",
  });
  const p = assembleClientCardPayload(u, TODAY, rows(u, { injuries: [injury()] }));
  assert.deepEqual(p.shared.body, {
    heightCm: 170,
    weightKg: 64,
    age: 33,
    sex: "female",
    goalWeight: 60,
    measurements: { waist: 70, hips: 96 },
  });
  assert.equal(p.shared.health, undefined);
  assert.equal(p.cycle, undefined); // cycle is health-gated, not body-gated
});

test("health consent: limitations + injuries present, cycle for female + tracking", () => {
  const u = client({
    shareWithTrainer: { health: true },
    sex: "female",
    cycleTracking: true,
    lastPeriodStart: "2026-06-29",
    limitations: "lower back",
    heightCm: 170,
  });
  const p = assembleClientCardPayload(u, TODAY, rows(u, { injuries: [injury()] }));
  assert.equal(p.shared.body, undefined);
  assert.equal(p.shared.health?.limitations, "lower back");
  assert.deepEqual(p.shared.health?.injuries, [
    { area: "knee", severity: "mild", since: "2026-06-20", lastScore: 4 },
  ]);
  // 2026-06-29 → 2026-07-01 is day 3 of the cycle: menstruation.
  assert.deepEqual(p.cycle, { phase: "menstruation", day: 3 });
});

test("health consent without tracking data: injuries but no cycle, no lastScore without check-ins", () => {
  const u = client({ shareWithTrainer: { health: true }, sex: "male" });
  const p = assembleClientCardPayload(u, TODAY, rows(u, { injuries: [injury({ checkinsHistory: [] })] }));
  assert.equal(p.cycle, undefined);
  assert.equal(p.shared.health?.limitations, undefined);
  assert.deepEqual(p.shared.health?.injuries, [{ area: "knee", severity: "mild", since: "2026-06-20" }]);
});

test("card null passes through as null; client identity mapped", () => {
  const u = client({}, { flagged: true, onboarded: false });
  const p = assembleClientCardPayload(u, TODAY, rows(u));
  assert.equal(p.card, null);
  assert.deepEqual(p.client, { id: 42, name: "Olha", onboarded: false, flagged: true });
});

test("card birthday passthrough (both stored forms), trainer-only fields dropped", () => {
  const u = client();
  const p = assembleClientCardPayload(u, TODAY, rows(u, { card: cardRow }));
  assert.deepEqual(p.card, { healthNotes: "asthma", personalNotes: "two kids", birthday: "1990-05-10" });
  const p2 = assembleClientCardPayload(u, TODAY, rows(u, { card: { ...cardRow, birthday: "05-10" } }));
  assert.equal(p2.card?.birthday, "05-10");
});

test("note passthrough; empty note normalizes to null", () => {
  const u = client();
  const p = assembleClientCardPayload(u, TODAY, rows(u, { note: "pays cash" }));
  assert.equal(p.note, "pays cash");
  const p2 = assembleClientCardPayload(u, TODAY, rows(u, { note: "" }));
  assert.equal(p2.note, null);
  assert.equal(p.dashboard.today, TODAY); // embedded dashboard payload is carried as-is
});
