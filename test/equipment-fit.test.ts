import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSplitToKit, fitsKit, gearFor, kitFromEquipment, kitMismatches, SELF_SELECT_WEIGHT } from "../src/domain/equipmentFit";
import { musclesForExercise } from "../src/domain/exerciseMuscles";

const ex = (name: string, extra: Record<string, unknown> = {}) => ({ name, sets: "4 × 8–10", startWeight: "60 kg", technique: "t", ...extra });

test("kit from the onboarding answers and free text", () => {
  assert.equal(kitFromEquipment("full gym"), "gym");
  assert.equal(kitFromEquipment(undefined), "gym");
  assert.equal(kitFromEquipment("home basics (dumbbells, bands)"), "home");
  assert.equal(kitFromEquipment("dumbbells only"), "dumbbells");
  assert.equal(kitFromEquipment("bodyweight only"), "bodyweight");
  assert.equal(kitFromEquipment("тільки гантелі"), "dumbbells");
});

test("gear is read from Ukrainian and English names", () => {
  assert.deepEqual(gearFor("Присідання зі штангою"), ["barbell"]);
  assert.deepEqual(gearFor("Тяга верхнього блока широким хватом"), ["cable"]);
  assert.deepEqual(gearFor("Жим ногами"), ["machine"]);
  assert.deepEqual(gearFor("Махи гирею однією рукою"), ["kettlebell"]);
  assert.deepEqual(gearFor("Горизонтальне підтягування"), []);
  assert.deepEqual(gearFor("Підтягування колін лежачи"), []);
  assert.deepEqual(gearFor("Bench Dips"), []);
  assert.deepEqual(gearFor("Pullups"), ["bar"]);
  assert.ok(fitsKit({ name: "Кубковий присід" }, "dumbbells"));
  assert.ok(!fitsKit({ name: "Жим гантелей лежачи" }, "bodyweight"));
  assert.ok(!fitsKit({ name: "Жим лежачи", canonicalName: "Barbell Bench Press - Medium Grip" }, "dumbbells"), "the English canonical name counts too");
});

test("a dumbbells-only week loses its barbell, machine and cable work, keeping sets and muscles", () => {
  const split = [
    { weekday: 1, exercises: [ex("Присідання зі штангою"), ex("Жим ногами"), ex("Кубковий присід", { startWeight: "16 kg" })] },
    { weekday: 3, exercises: [ex("Жим штанги лежачи"), ex("Тяга верхнього блока"), ex("Розгинання рук на блоці"), ex("Біг на доріжці", { sets: "20 хв", startWeight: "—" })] },
  ];
  const { split: out, swaps } = fitSplitToKit(split, "dumbbells", "uk");
  assert.equal(kitMismatches(out, "dumbbells"), 0);
  assert.equal(kitMismatches(split, "dumbbells"), 6);
  assert.equal(swaps.length, 6);
  const day1 = out[0]!.exercises.map((e) => e.name);
  assert.equal(day1[2], "Кубковий присід", "fitting exercises stay");
  assert.ok(!day1.slice(0, 2).includes("Кубковий присід"), "no duplicate of an exercise already in the day");
  for (const e of out.flatMap((d) => d.exercises)) assert.equal(e.sets === "20 хв" || e.sets === "4 × 8–10", true);
  const press = out[1]!.exercises[0]!;
  assert.equal(press.name, "Жим гантелей лежачи на підлозі");
  assert.equal(press.startWeight, SELF_SELECT_WEIGHT.uk, "a barbell weight doesn't transfer to dumbbells");
  assert.equal(press.canonicalName, "Dumbbell Floor Press");
  assert.equal(out[1]!.exercises[3]!.name, "Швидка ходьба або біг на вулиці");
  assert.equal(split[0]!.exercises[0]!.name, "Присідання зі штангою", "input not mutated");
});

test("bodyweight only: dumbbells go too, loads become bodyweight; gym kit is untouched", () => {
  const split = [{ weekday: 2, exercises: [ex("Жим гантелей лежачи"), ex("Тяга гантелі однією рукою"), ex("Згинання рук з гантелями")] }];
  const { split: out } = fitSplitToKit(split, "bodyweight", "en");
  assert.equal(kitMismatches(out, "bodyweight"), 0);
  assert.ok(out[0]!.exercises.every((e) => e.startWeight === "Bodyweight"));
  assert.equal(fitSplitToKit(split, "gym", "en").split, split);
});

test("every stand-in is itself kit-legal and works the muscle it replaces", () => {
  const cases: Array<[string, string]> = [
    ["Barbell Bench Press", "chest"], ["Lat Pulldown", "upper-back"], ["Barbell Shoulder Press", "deltoids"], ["Barbell Curl", "biceps"],
    ["Cable Triceps Pushdown", "triceps"], ["Barbell Squat", "quadriceps"], ["Barbell Romanian Deadlift", "hamstring"],
    ["Barbell Hip Thrust", "gluteal"], ["Calf Raise Machine", "calves"], ["Barbell Shrug", "trapezius"],
  ];
  for (const kit of ["dumbbells", "bodyweight"] as const) {
    for (const [name, slug] of cases) {
      const { split } = fitSplitToKit([{ weekday: 1, exercises: [ex(name)] }], kit, "uk");
      const got = split[0]!.exercises[0]!;
      assert.ok(fitsKit(got, kit), `${kit}: ${got.name} must fit`);
      if (slug === "trapezius" && kit === "bodyweight") continue;
      // The plan carries the localized name; that's what the balance check and body map read.
      const m = musclesForExercise(got.name);
      assert.ok(m && [...m.primary, ...m.secondary].includes(slug as never), `${kit}: ${name} → ${got.name} should work ${slug}, got ${JSON.stringify(m)}`);
    }
  }
});

test("classic barbell lifts named without 'barbell' count as barbell work — unless done at bodyweight", () => {
  assert.deepEqual(gearFor("Bench Press", "50 kg"), ["barbell"]);
  assert.deepEqual(gearFor("Жим лежачи", "60 kg"), ["barbell"]);
  assert.deepEqual(gearFor("Станова тяга", "100 kg"), ["barbell"]);
  assert.deepEqual(gearFor("Присідання", "Власна вага"), []);
  assert.deepEqual(gearFor("Присідання без ваги"), []);
  assert.deepEqual(gearFor("Жим гантелей лежачи", "20 kg"), ["dumbbell"]);
});
