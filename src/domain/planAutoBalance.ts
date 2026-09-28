// Fixes a freshly generated plan's muscle balance before anyone sees it: whatever planBalance
// (./muscleLoad.ts) flags -- a key muscle nothing trains, or the weak side of a lopsided pair --
// gets its suggested exercise appended to the day that already trains its neighbours, as an
// accessory. Deterministic (no second AI round trip, which would double the slowest step of plan
// generation for a problem one exercise solves). Days already at the exercise cap are skipped in
// favour of the next best day; if every day is full the issue is left for the plan's balance note.
// Pure; test/plan-auto-balance.test.ts.
import type { Lang, PlanDay, PlanExercise } from "../types";
import { planBalance, type BalanceIssue } from "./muscleLoad";

/** What to write into the plan for each suggested exercise (the suggestion table's companions). */
const DETAILS: Record<string, { canonicalName: string; sets: string; metric?: "time"; technique: { uk: string; en: string }; muscles: { uk: string; en: string } }> = {
  "Push-up": {
    canonicalName: "Pushups", sets: "3 × 8–15",
    technique: { uk: "Тіло пряме від п'ят до голови, груди опускай майже до підлоги, лікті під кутом ~45°.", en: "Body straight from heels to head, lower the chest almost to the floor, elbows at ~45°." },
    muscles: { uk: "Груди, трицепс", en: "Chest, triceps" },
  },
  "Dumbbell row": {
    canonicalName: "One-Arm Dumbbell Row", sets: "3 × 10–12",
    technique: { uk: "Спина рівна, тягни гантель ліктем до поясу, внизу повністю випрямляй руку.", en: "Flat back, drive the elbow toward the hip, fully straighten the arm at the bottom." },
    muscles: { uk: "Спина, біцепс", en: "Back, biceps" },
  },
  "Lateral raise": {
    canonicalName: "Side Lateral Raise", sets: "3 × 12–15",
    technique: { uk: "Лікті трохи зігнуті, піднімай гантелі в сторони до рівня плечей без ривка.", en: "Soft elbows, raise the dumbbells out to shoulder height without swinging." },
    muscles: { uk: "Плечі", en: "Shoulders" },
  },
  "Goblet squat": {
    canonicalName: "Goblet Squat", sets: "3 × 10–12",
    technique: { uk: "Гантель біля грудей, коліна за носками, сідай до паралелі зі стегнами, спина рівна.", en: "Dumbbell at the chest, knees over toes, sit to thigh-parallel with a flat back." },
    muscles: { uk: "Квадрицепс, сідниці", en: "Quads, glutes" },
  },
  "Romanian deadlift": {
    canonicalName: "Romanian Deadlift", sets: "3 × 8–10",
    technique: { uk: "Коліна злегка зігнуті, відводь таз назад, вага ковзає вздовж ніг до натягу задньої поверхні.", en: "Soft knees, push the hips back, slide the weight down the legs until the hamstrings stretch." },
    muscles: { uk: "Біцепс стегна, сідниці", en: "Hamstrings, glutes" },
  },
  "Glute bridge": {
    canonicalName: "Barbell Glute Bridge", sets: "3 × 12–15",
    technique: { uk: "Лопатки на підлозі, піднімай таз до прямої лінії, стискаючи сідниці вгорі.", en: "Shoulders on the floor, drive the hips up to a straight line, squeeze the glutes at the top." },
    muscles: { uk: "Сідниці", en: "Glutes" },
  },
  "Dumbbell curl": {
    canonicalName: "Dumbbell Bicep Curl", sets: "3 × 10–12",
    technique: { uk: "Лікті притиснуті до корпусу, піднімай без розгойдування, опускай повільно.", en: "Elbows pinned to the sides, curl without swinging, lower slowly." },
    muscles: { uk: "Біцепс", en: "Biceps" },
  },
  "Bench dips": {
    canonicalName: "Bench Dips", sets: "3 × 10–15",
    technique: { uk: "Руки на краю лави, лікті назад, опускайся до кута 90° у ліктях.", en: "Hands on the bench edge, elbows back, lower until the elbows reach 90°." },
    muscles: { uk: "Трицепс", en: "Triceps" },
  },
  Plank: {
    canonicalName: "Plank", sets: "3 × 30–45 s", metric: "time",
    technique: { uk: "Лікті під плечима, тіло пряме, прес і сідниці напружені, не прогинайся в попереку.", en: "Elbows under the shoulders, body straight, abs and glutes tight, don't sag at the lower back." },
    muscles: { uk: "Прес", en: "Abs" },
  },
};

export interface AutoBalanceResult {
  split: PlanDay[];
  added: Array<{ weekday: number; name: string; issue: BalanceIssue["kind"]; slug: string }>;
}

/** Append the suggested exercise for each balance issue (at most one per muscle, `maxPerDay` cap). */
export function autoBalanceSplit(split: PlanDay[], lang: Lang, maxPerDay: number): AutoBalanceResult {
  const days = split.map((d) => ({ ...d, exercises: [...d.exercises] }));
  const added: AutoBalanceResult["added"] = [];
  for (const issue of planBalance(days)) {
    const s = issue.suggestion;
    const detail = s ? DETAILS[s.en] : undefined;
    if (!s || !detail) continue;
    const name = s[lang];
    // The suggested day first, then any other day with room, fewest exercises first.
    const order = [...days].sort((a, b) =>
      (a.weekday === s.weekday ? -1 : b.weekday === s.weekday ? 1 : 0) || a.exercises.length - b.exercises.length || a.weekday - b.weekday);
    const day = order.find((d) => d.exercises.length < maxPerDay && !d.exercises.some((e) => e.name.toLowerCase() === name.toLowerCase()));
    if (!day) continue;
    const exercise: PlanExercise = {
      name,
      canonicalName: detail.canonicalName,
      sets: detail.sets,
      startWeight: detail.metric === "time" ? (lang === "uk" ? "Власна вага" : "Bodyweight") : (lang === "uk" ? "Підбери робочу вагу" : "Pick a working weight") /* no digits: the logger prefills the first number as kg */,
      technique: detail.technique[lang],
      muscles: detail.muscles[lang],
      role: "accessory",
      ...(detail.metric ? { metric: detail.metric } : {}),
    };
    day.exercises.push(exercise);
    added.push({ weekday: day.weekday, name, issue: issue.kind, slug: issue.slug });
  }
  // One accessory at 3 sets can't close a big gap (0 back sets vs 12 chest): whatever is still
  // lopsided gets its added exercise bumped to 5 sets. What remains after that stays visible in
  // the plan's balance note rather than piling more exercises onto the day.
  const ours = new Set(added.map((a) => a.name.toLowerCase()));
  for (const issue of planBalance(days)) {
    const name = issue.suggestion?.[lang]?.toLowerCase();
    if (!name || !ours.has(name)) continue;
    for (const d of days) {
      d.exercises = d.exercises.map((e) => (e.name.toLowerCase() === name && e.metric !== "time" ? { ...e, sets: e.sets.replace(/^\s*\d+/, "5") } : e));
    }
  }
  return { split: days, added };
}
