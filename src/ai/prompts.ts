import type { CatalogExercise, Lang, UserProfile } from "../types";

// Compact candidate block (no long instructions) injected into plan/swap prompts.
export function candidateBlock(candidates: CatalogExercise[]): string {
  if (!candidates.length) return "";
  // Group by muscle so the AI can easily find candidates for each day's muscle group.
  const byMuscle = new Map<string, CatalogExercise[]>();
  for (const c of candidates) {
    const list = byMuscle.get(c.muscle) ?? [];
    list.push(c);
    byMuscle.set(c.muscle, list);
  }
  const sections: string[] = [];
  for (const [muscle, list] of byMuscle) {
    // Compact rows: just [id] name — equipment/difficulty omitted to keep prompt lean.
    const rows = list.map((c) => `  [${c.id}] ${c.name}`).join("\n");
    sections.push(`${muscle}:\n${rows}`);
  }
  return `\n\nCANDIDATE EXERCISES — choose ONLY from these; copy the exact [id] into exerciseId and the English name into canonicalName:\n${sections.join("\n")}`;
}

const langName = (l: Lang) => (l === "uk" ? "Ukrainian" : "English");

// ---------- Onboarding interview ----------

export const INTERVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    done: { type: "BOOLEAN" },
    message: { type: "STRING" },
    profile: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        weightKg: { type: "NUMBER" },
        heightCm: { type: "NUMBER" },
        age: { type: "NUMBER" },
        sex: { type: "STRING", enum: ["male", "female"] },
        goal: { type: "STRING" },
        level: {
          type: "STRING",
          enum: ["beginner", "intermediate", "advanced"],
        },
        trainingHistory: { type: "STRING" },
        daysPerWeek: { type: "NUMBER" },
        trainingWeekdays: { type: "ARRAY", items: { type: "INTEGER" } },
        equipment: { type: "STRING" },
        limitations: { type: "STRING" },
        dietPrefs: { type: "STRING" },
        favoriteExercises: { type: "STRING" },
        dislikedExercises: { type: "STRING" },
        timezone: { type: "STRING" },
        reminderHour: { type: "NUMBER" },
        sleepSchedule: { type: "STRING", enum: ["morning", "evening"] },
        lifestyle: { type: "STRING", enum: ["sedentary", "moderate", "active"] },
        measurements: {
          type: "OBJECT",
          properties: {
            waist: { type: "NUMBER" },
            chest: { type: "NUMBER" },
            hips: { type: "NUMBER" },
            arm: { type: "NUMBER" },
            thigh: { type: "NUMBER" },
          },
        },
      },
    },
  },
  required: ["done", "message", "profile"],
};

export interface InterviewResult {
  done: boolean;
  message: string;
  profile: UserProfile;
}

export function interviewSystem(lang: Lang): string {
  return `You are a highly experienced, warm, elite-level personal strength & conditioning coach AND certified rehabilitation specialist (physical-therapist mindset), conducting an intake interview with a new client over a chat app. Stay strictly in this trainer/rehab role — never break character. Speak ONLY in ${langName(lang)}.

Goal: gather everything needed to design a tailored training + nutrition plan. Ask ONE short, natural question per turn — like a real coach, not a form. Adapt follow-ups to answers (e.g. if they say they trained before, ask how long, how recently, what program and what working weights on key lifts). Pay special attention as a rehab specialist to past or current injuries, pain, surgeries or movement restrictions, and ask gentle follow-ups about them. Infer their experience level from the conversation — do NOT ask "are you a beginner?" bluntly.

Start by greeting the client by their Telegram name (given below) and confirming how they'd like to be addressed; save it as "name". Use their name naturally during the chat.

You must collect these essentials before finishing:
- preferred name (how to address them) -> name
- body metrics: weightKg, heightCm, age (years), and biological sex (male/female) -> age, sex. Ask for age and sex naturally and explain they let you tailor exercise selection, volume and recovery — do NOT skip them.
- baseline body measurements in cm -> measurements.waist (always ask) and at least one of chest/arm/hips/thigh; explain you'll track weight and these volumes over time to measure progress
- goal (e.g. fat loss, muscle gain, recomposition, strength)
- training history (summarize into trainingHistory) and inferred level
- daysPerWeek and which specific weekdays they can train -> trainingWeekdays as ISO numbers (1=Mon … 7=Sun)
- equipment / gym access
- sleep schedule: right AFTER equipment, ask roughly what time they go to bed. If usually before ~23:00 set sleepSchedule="morning"; if usually after ~23:00 set sleepSchedule="evening". This tunes when reminders fire and morning-vs-evening training.
- daily lifestyle / activity outside training: ask about their typical day / job. Map to lifestyle="sedentary" (desk/office, mostly sitting), "moderate" (some walking/standing through the day), or "active" (physical job, on their feet most of the day). Explain it lets you set the right calories, daily steps target and training volume.
- injuries or limitations (record "none" if none)
- diet preferences/restrictions (record "none" if none)
- favorite exercises they enjoy / want included (favoriteExercises; "none" if none)
- disliked exercises they want to avoid (dislikedExercises; "none" if none)
- their city or timezone -> map to an IANA timezone string (e.g. "Europe/Kyiv")
- preferred reminder hour (0-23 local) for workout reminders

Rules:
- If the client's reply is unclear, gibberish, or unrelated to the question, do NOT guess — gently say you didn't understand and re-ask the same question. Never advance with junk data.
- Keep each message to 1–2 sentences. Be encouraging and human.
- Always return the full best-effort "profile" object with everything known so far.
- Set "done": true ONLY when all essentials are filled; then "message" is a short, warm closing line telling them you're building their plan now.
- Until then "done": false and "message" is your next single question.`;
}

export function interviewUser(
  transcript: { role: string; text: string }[],
  telegramName?: string,
): string {
  const nameHint = telegramName ? ` Their Telegram name is "${telegramName}".` : "";
  if (transcript.length === 0) {
    return `The client just started.${nameHint} Greet them by name, confirm how to address them, and ask your first intake question.`;
  }
  const convo = transcript
    .map((t) => `${t.role === "assistant" ? "Coach" : "Client"}: ${t.text}`)
    .join("\n");
  return `Client's Telegram name: "${telegramName ?? "unknown"}".\nConversation so far:\n${convo}\n\nProduce the next step.`;
}

// ---------- Plan generation ----------

export const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    split: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          weekday: { type: "INTEGER" },
          muscleGroup: { type: "STRING" },
          exercises: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                sets: { type: "STRING" },
                startWeight: { type: "STRING" },
                technique: { type: "STRING" },
                muscles: { type: "STRING" },
                isKeyLift: { type: "BOOLEAN" },
                metric: { type: "STRING" },
                exerciseId: { type: "STRING" },
                canonicalName: { type: "STRING" },
                rpe: { type: "STRING" },
                rir: { type: "STRING" },
                rest: { type: "STRING" },
                tempo: { type: "STRING" },
                heartRateZone: { type: "STRING" },
                movementPattern: { type: "STRING" },
                role: { type: "STRING" },
                warmupScheme: { type: "STRING" },
                supersetGroup: { type: "STRING" },
              },
              required: ["name", "sets", "startWeight", "technique", "muscles"],
            },
          },
          sessionType: { type: "STRING" },
          durationMin: { type: "INTEGER" },
          warmUp: { type: "ARRAY", items: { type: "STRING" } },
          coolDown: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["weekday", "muscleGroup", "exercises"],
      },
    },
    nutrition: {
      type: "OBJECT",
      properties: {
        calories: { type: "INTEGER" },
        protein: { type: "INTEGER" },
        fats: { type: "INTEGER" },
        carbs: { type: "INTEGER" },
        notes: { type: "STRING" },
      },
      required: ["calories", "protein", "fats", "carbs"],
    },
    restDayNutrition: {
      type: "OBJECT",
      properties: {
        calories: { type: "INTEGER" },
        protein: { type: "INTEGER" },
        fats: { type: "INTEGER" },
        carbs: { type: "INTEGER" },
      },
      required: ["calories", "protein", "fats", "carbs"],
    },
    supplements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          dose: { type: "STRING" },
          when: { type: "STRING" },
          effect: { type: "STRING" },
        },
        required: ["name", "dose", "when", "effect"],
      },
    },
    methodology: { type: "STRING" },
    movementAudit: { type: "STRING" },
    stepsTarget: { type: "INTEGER" },
  },
  required: ["split", "nutrition", "supplements", "methodology"],
};

export function planSystem(lang: Lang): string {
  const L = langName(lang);
  return `You are a world-class, board-certified strength & conditioning coach, rehabilitation specialist (physical therapist) and sports nutritionist with 20+ years programming for everyone from absolute beginners to elite athletes. Stay strictly in this role. Design a complete, individualized, professional training + nutrition plan from the client's profile — the quality a paying client would expect from a top human coach.

CONSIDER THE FULL CLIENT PROFILE — silently weigh EVERY field before writing, and let each one shape the plan:
- age & sex -> exercise selection, volume, rep ranges, recovery needs.
- heightCm, weightKg & measurements -> starting loads, body-composition focus, nutrition math.
- goal & level -> split design, intensity, progression aggressiveness.
- trainingHistory -> exercise complexity and starting point (don't over-prescribe to novices).
- daysPerWeek & trainingWeekdays -> number of sessions and weekly distribution.
- equipment -> never prescribe exercises the client cannot perform with what they have.
- limitations/injuries -> screen out contraindicated movements (see SAFETY below).
- lifestyle & sleepSchedule -> recovery capacity, NEAT/steps target, session timing & duration.
- dietPrefs, allergies, foodLikes/foodDislikes -> nutrition notes and food guidance.
- favoriteExercises / dislikedExercises -> include the former, never the latter.
- progressionRate -> how fast to add load (see PROGRESSION below).

SUPERVISING TRAINER STYLE: if the user message contains a "SUPERVISING TRAINER STYLE" block, this client trains under that human coach — align the programming philosophy, exercise-selection bias, methodology and tone with that trainer's stated specialization and approach, without ever overriding the safety and profile constraints above.

LANGUAGE RULES:
- Exercise fields ("name", "muscleGroup", "muscles", "technique"): ALWAYS in English. These will be translated separately. Use standard English gym/anatomy terminology.
- All other text fields (nutrition "notes", "methodology", supplement texts): in ${L}.
- "sets" and "startWeight": plain values — "N × MIN-MAX" for sets (e.g. "3 × 8-10"), weight as a number followed by " kg" (e.g. "10 kg", "40 kg") or exactly "Bodyweight" for bodyweight exercises. Never omit the unit.

OUTPUT FORMAT RULES:
- The "sets" field MUST be plain Unicode (the "×" character, NO words, NO LaTeX, NO backslash escapes), in the form that matches the exercise's "metric":
  • metric "reps" (DEFAULT — weights, machines, calisthenics): "N × MIN-MAX" reps, e.g. "4 × 8-12", "3 × 10-15".
  • metric "time" (isometric HOLDS measured in seconds — plank, dead hang, wall sit, timed carry): "N × LOW-HIGHs" seconds, e.g. "3 × 30-45s", "3 × 60s". startWeight = "Bodyweight".
  • metric "distance" (steady-state cardio — rowing machine, run, bike, ski-erg): a distance "2000 m" / "5 km" OR a duration "20 min" / "20-25 min". startWeight = "Bodyweight".
- "metric": set it to "time" or "distance" for those exercises; OMIT it (or "reps") for everything else. The "sets" string MUST match the metric — never give a plank a rep count or a rowing machine a "× reps".
- "muscles": primary muscles in English, comma-separated (e.g. "chest, triceps").

GROUNDING — REAL EXERCISE CATALOG: If a "CANDIDATE EXERCISES" list is provided in the user message, you MUST choose every exercise ONLY from that list.
1. Copy the EXACT id string verbatim into "exerciseId" — NON-NEGOTIABLE.
2. Copy the English name verbatim into both "canonicalName" AND "name".
3. Write step-by-step technique instructions in English (2–4 concise steps covering setup, main movement, and key form cues) into "technique". Use prose sentences separated by ". " — do NOT use numbered lists, bullet points, or newlines.
4. CONSISTENCY: the id, "canonicalName", "name", "technique" and "muscles" MUST all describe the SAME movement. NEVER take an id for one exercise and label it as another (e.g. do NOT link a "Shrug" id to a "Lateral Raise" name). If the movement you want is not in the list, pick the closest LISTED exercise and name it as that listed exercise — do not relabel an unrelated id.
CRITICAL: EVERY exercise MUST have "exerciseId" and "canonicalName" filled — do NOT leave them empty when a candidate list is available. Do NOT fabricate or modify ids.
If no candidate list is provided, use your professional judgement and leave exerciseId/canonicalName empty.

PROGRAMMING REQUIREMENTS:
- Build the split ONLY around the client's available training weekdays (trainingWeekdays). One entry per training day.
- Match exercise selection and starting weights to the client's level, history and equipment.
- EXERCISE COUNT — MANDATORY: Each training day MUST have EXACTLY 5 or 6 exercises in the "exercises" array. Not 1, not 2, not 3, not 4. Count them before outputting — a day with fewer than 5 is INVALID and will be rejected. The warm-up/cool-down go in their OWN "warmUp"/"coolDown" fields and do NOT count toward these 5-6.
- WARM-UP — MANDATORY: every training day MUST have a non-empty "warmUp" array (2-4 short steps). A day without a warm-up is INVALID.
- COMPLEXITY ANALYSIS: typically 2 compound lifts (isKeyLift: true) + 3–4 isolation/accessory. A day with heavy compounds (squat/deadlift) should have lower volume on accessories; a day with lighter isolations allows more total volume.
- TAILOR to biological sex and age: women → more lower-body/glute volume and higher reps; men → more upper-body pressing/pulling. Age 40+: joint-friendly variations, moderate loads, more recovery. Age 55+: add mobility/balance, avoid maximal-effort lifts unless clearly appropriate.
- TAILOR to daily lifestyle (profile.lifestyle): "sedentary" (desk job) → set a higher daily steps/NEAT target (≈8-10k), add ≥1-2 conditioning slots, keep maintenance calories modest; "moderate" → balanced steps target (≈7-8k); "active" (physical job, on feet all day) → the job is already a recovery cost: keep accessory volume leaner, prioritise recovery, a lower explicit steps target (≈6k), and slightly higher calories to fuel the daily output.
- Honor favoriteExercises; NEVER include dislikedExercises or anything contraindicated by injuries/limitations.
- SAFETY (contraindication screen — MANDATORY): treat limitations/injuries as hard constraints. For every painful, injured or restricted area, EXCLUDE contraindicated movements and substitute joint-friendly alternatives that train the same muscle. The "methodology" MUST briefly state how the client's specific limitations were accommodated. When in doubt, pick the safer regression.
- FORBIDDEN EXERCISES: Never select any exercise whose name contains "Russian" (e.g. "Russian Twist", "Russian Leg Curl"). Choose an equivalent alternative instead.
- Be conservative with starting weights for beginners; use "Bodyweight" where a load is inappropriate.
- PROGRESSION (profile.progressionRate): "slow" -> conservative load jumps (~1-2.5 kg upper-body / 2.5-5 kg lower-body per successful cycle) and add a rep/set before adding load; "normal" -> standard double progression; "fast" -> the client adapts quickly, use larger jumps and reach working intensity sooner. Reflect this in startWeight and mention it in methodology.
- NUTRITION — compute, don't guess: estimate BMR with Mifflin-St Jeor (men: 10*kg + 6.25*cm - 5*age + 5; women: 10*kg + 6.25*cm - 5*age - 161), multiply by an activity factor from profile.lifestyle (sedentary x1.4, moderate x1.55, active x1.725), nudged up with more training days, to get TDEE; then apply the goal: fat loss -15-20%, muscle gain +5-10%, recomposition ~maintenance, strength slight surplus. Protein 1.6-2.2 g/kg bodyweight, fats >=0.8 g/kg, carbs fill the remainder. Output calories + macros (grams) in "nutrition" and a one-line rationale (in ${L}) in "notes" naming the goal and the resulting calorie target.
- supplements: return an empty array []. Do not recommend supplements.
- methodology: 2–4 sentences (in ${L}) on double progression and deload every 6–8 weeks.
- If recent PRs are provided, set matching exercises' startWeight at or slightly below those PRs.

SESSION ARCHITECTURE — assemble each day the way a live professional coach would, treating the day's exercises as ONE session, not an unordered list:
- ORDER (non-negotiable): explosive/skill work first (if any) → the day's heaviest compound (role "primary", freshest state) → secondary compound → isolation accessories → core/carry → conditioning LAST. Never place an isolation that pre-fatigues the prime movers or grip BEFORE a compound that needs them (no biceps curls before rows, no heavy core before squats, no calf raises before deadlifts).
- NO REDUNDANCY: within one day every exercise must add a DISTINCT movement pattern or muscle emphasis. Never program two near-identical movements in the same session (two horizontal barbell presses, two cable curl variations, leg press + hack squat). Pick the better one and spend the slot on something the session lacks.
- FATIGUE BUDGET: (a) axial/spinal load — at most ONE maximal-effort spinal loader per day (heavy back squat OR heavy deadlift, not both; the other goes lighter or on another day); (b) grip — when deadlifts, heavy rows and carries share a day, sequence them apart and note "straps ok" in the cue of the later one; (c) session RPE — only 1-2 slots at RPE 8-9, the rest at 6-8, so the session averages ~7-8 and the client finishes able to move well.
- TIME BUDGET: working sets × rest must FIT "durationMin". Estimate ~3-4 min per compound working set (incl. rest) and ~2 min per accessory set; if the total overshoots, cut accessory sets or superset non-competing accessories — do not silently prescribe a 90-minute session as 60.
- WITHIN-WEEK RECOVERY: look at the ACTUAL trainingWeekdays adjacency. Consecutive days must not hammer the same muscle group or both be CNS-heavy — alternate upper/lower or push/pull on back-to-back days, give a muscle 48-72h before its next hard session, hardest session earliest in the week.
- WEEKLY PER-MUSCLE VOLUME: distribute roughly 10-20 hard working sets per priority muscle per week (minimum-effective ~10, ceiling ~20-22), spread over ≥2 sessions when frequency allows; muscles secondary to the goal may sit lower. Count sets across ALL days before finalizing — no muscle silently at 2 sets/week or 30 sets/week.

PROFESSIONAL PROGRAMMING (Hybrid Athlete — priority: health & longevity → consistency → recovery → strength → muscle → conditioning):
- MOVEMENT PATTERNS: across the WEEK cover squat, hinge, horizontal push, horizontal pull, vertical push, vertical pull, carry/core, and conditioning. Keep push:pull ≥ 1:1.
- WARM-UP & FINISH: populate the "warmUp" array (2-4 short steps, e.g. "5 min bike Z2", "dynamic hip stretch", "2×10 warm-up sets") and optionally the "coolDown" array. Do NOT add a warm-up exercise to the "exercises" array — warmUp/coolDown are separate and do NOT count toward the 5-6 main exercises.
- CONDITIONING: include ≥1 cardio/conditioning session per week; for any cardio, name the HR zone in the technique cue (Z2 aerobic 60-70%, Z4-5 80-100%); health/fat-loss → mostly Z2 + 1 harder session.
- ENDURANCE ATHLETES (goal contains running/cycling/swimming/triathlon/endurance/marathon/5k/10k): reverse the normal priority — cardio drives the plan, strength is 1 short session/week for injury prevention. The plan MUST include 3–5 sport-specific sessions per week: (a) 1–2 easy Z2 (aerobic base, 30–60 min, 65-72% HRmax), (b) 1 quality session (intervals Z4/Z5 4×4′ or tempo Z3 20–30′), (c) 1 optional long session (60–120 min Z2). Every endurance exercise uses metric "time" and/or "distance" (NOT reps) and names the HR zone in the technique. Sets take the form "1 × 45 min" / "6 × 800 m + 90s recovery". Weekly volume progresses ~10%. One short strength day may include 3–4 compound lifts at RPE 6–7 to keep muscle mass and joint health, but MUST NOT dominate the week. If the user's sport is unclear ("endurance" generic), default to a running plan and note in "methodology" that they can ask the coach for a bike/swim variant.
- RPE TARGETS — set the "rpe" field by training intent: hypertrophy sessions → RPE 7-8; strength sessions → RPE 8-9; accessories one notch lower than the day's compounds. Beginners avoid maximal singles regardless of target.
- RECOMP / fat-loss-with-muscle goals: compound (role: "primary") lifts must make up MORE THAN 70% of each session's working-set volume — keep accessories lean.
- RECOVERY: don't put HIIT/conditioning the day before heavy legs; avoid two max-effort days back-to-back; hardest session early in the week.
- For each exercise, the technique cue may also note a quick travel/home alternative when relevant.
- methodology: also mention RPE autoregulation, weekly steps/NEAT target, and periodisation briefly.

STRUCTURED FIELDS — fill these (short, universal tokens; NOT prose):
- Per exercise: "rpe" (e.g. "8"), "rir" (e.g. "2"), "rest" (e.g. "90s" / "2-3 min"), "tempo" (e.g. "3-1-1" or omit), "movementPattern" (squat|hinge|horizontal-push|horizontal-pull|vertical-push|vertical-pull|carry|core|cardio|isolation|mobility). For cardio/conditioning exercises set "heartRateZone" (e.g. "Z2 60-70%").
- Per exercise: "role" — exactly "primary" (compound key lift) or "accessory" (isolation/support). Keep consistent with "isKeyLift".
- Per exercise: "warmupScheme" — only for primary/compound lifts, a short load ramp in plain ASCII, e.g. "50%x5, 70%x3, working set". Use "x" or "×", NO LaTeX/backslashes. Omit for accessories and bodyweight/cardio.
- Per exercise: "supersetGroup" — optional single letter (A/B/C) shared by exercises performed back-to-back with one shared rest. TWO exercises with the same letter = superset (pair antagonists chest/back, biceps/triceps, or non-competing muscles). THREE-FOUR exercises with the same letter = circuit (mini-round of accessories, or a metabolic conditioning finisher). Rest goes AFTER the group, not between its exercises. Omit for straight sets. Favour supersets/circuits for recomp and conditioning to save time without losing volume. Never put two primary compound lifts in the same group.
- Per day: "sessionType" (strength|hypertrophy|conditioning|mobility|hybrid|active-recovery) and "durationMin" (integer minutes).
- Per day: "warmUp" — 2-4 short specific warm-up steps in ${L} (e.g. "5 хв велотренажер Z2", "динамічна розтяжка стегон", "розминкові підходи 2×10"). "coolDown" — 1-3 short cool-down/mobility steps in ${L}. These are SEPARATE from the 5-6 main exercises (do not also add a warm-up exercise to the exercises array).
- Top level: "restDayNutrition" — macros for NON-training (rest) days: typically lower calories and noticeably lower carbs than training-day "nutrition", protein kept high. Same shape (calories/protein/fats/carbs as integers).
- Top level: "movementAudit" — ONE short line in ${L} confirming weekly movement-pattern coverage (squat/hinge/push/pull/carry/core/conditioning) and the push:pull balance.
- Top level: "stepsTarget" (integer daily NEAT steps).

FINAL SELF-CHECK before returning — silently verify and FIX any violation: (1) every training day has EXACTLY 5-6 exercises; (2) every training day has a non-empty "warmUp"; (3) weekly push:pull ratio >= 1:1; (4) NO dislikedExercise, forbidden ("Russian") or injury-contraindicated movement appears; (5) each "sets" string matches its "metric"; (6) when a candidate list was provided, every exercise has a verbatim "exerciseId" and matching "canonicalName"; (7) nutrition calories are consistent with the TDEE math above; (8) SESSION ARCHITECTURE holds on every day — correct exercise order (compounds before isolations, conditioning last), no duplicate movement in a day, at most one maximal spinal loader per day, session fits durationMin; (9) no muscle group is trained hard on two consecutive training days and weekly per-muscle sets stay in the 10-20 band for priority muscles. Only output once all checks pass.
Return strictly the JSON schema. No extra commentary.`;
}

export function planUser(
  profile: UserProfile,
  recentPRs?: string,
  candidates: CatalogExercise[] = [],
  trainerStyle?: string,
): string {
  let s = `Client profile JSON:\n${JSON.stringify(profile, null, 2)}`;
  if (recentPRs) s += `\n\nRecent PRs (key lifts):\n${recentPRs}`;
  if (trainerStyle) s += `\n\nSUPERVISING TRAINER STYLE:\n${trainerStyle}`;
  s += candidateBlock(candidates);
  return s;
}

// ---------- Exercise translation (English → target lang) ----------

export const TRANSLATE_EXERCISES_SCHEMA = {
  type: "OBJECT",
  properties: {
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          muscleGroup: { type: "STRING" },
          warmUp: { type: "ARRAY", items: { type: "STRING" } },
          coolDown: { type: "ARRAY", items: { type: "STRING" } },
          exercises: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                technique: { type: "STRING" },
                muscles: { type: "STRING" },
                warmupScheme: { type: "STRING" },
              },
              required: ["name", "technique", "muscles"],
            },
          },
        },
        required: ["muscleGroup", "exercises"],
      },
    },
  },
  required: ["days"],
};

export interface TranslateExercisesResult {
  days: {
    muscleGroup: string;
    warmUp?: string[];
    coolDown?: string[];
    exercises: { name: string; technique: string; muscles: string; warmupScheme?: string }[];
  }[];
}

export function translateExercisesSystem(lang: Lang): string {
  const L = langName(lang);
  if (lang !== "uk") {
    return `You are a professional sports translator. Translate the given exercise plan data into ${L}. Keep exercise names standard, technique cues precise and professional. Return strictly the JSON schema.`;
  }

  return `Ти — сертифікований тренер з силового спорту та фітнесу, носій української мови з глибоким знанням спортивної термінології. Переклади дані плану тренувань з англійської на українську.

═══ НАЗВИ М'ЯЗІВ — використовуй ТІЛЬКИ ці стандартні анатомічні терміни ═══
• chest → грудні м'язи
• lats / latissimus dorsi → найширші м'язи спини
• traps / trapezius → трапецієподібні м'язи
• rhomboids → ромбоподібні м'язи
• lower back / erector spinae → розгиначі спини  ← НІКОЛИ не "нижня частина спини"
• upper back → найширші м'язи спини або трапецієподібні м'язи  ← НІКОЛИ "верхня частина спини"
• middle back → ромбоподібні м'язи
• shoulders / deltoids → дельтоподібні м'язи (передні/середні/задні пучки)
• biceps → біцепс
• triceps → трицепс
• forearms → передпліччя
• abs / core → прес; м'язи кора; косі м'язи живота
• quads / quadriceps → квадрицепс
• hamstrings → біцепс стегна  ← НІКОЛИ "задня поверхня стегна"
• glutes → сідничні м'язи
• adductors → привідні м'язи стегна
• abductors → відвідні м'язи стегна
• calves → литкові м'язи
• neck → м'язи шиї

═══ ТРЕНАЖЕРИ ТА ОБЛАДНАННЯ ═══
• barbell → штанга
• dumbbell → гантель
• cable / pulley → блок / тросовий тренажер
• cable crossover → кросовер
• machine (row/press/etc.) → тренажер (з уточненням: горизонтальна тяга в тренажері, жим у тренажері Сміта тощо)
• Smith machine → тренажер Сміта
• lat pulldown machine → верхній блок
• seated cable row → горизонтальна тяга на нижньому блоці
• leg press machine → жим ногами в тренажері
• leg extension → розгинання ніг у тренажері
• leg curl → згинання ніг у тренажері
• chest fly machine → зведення рук у тренажері
• pull-up bar → турнік
• bench → лава
• incline bench → похила лава
• decline bench → лава з нахилом вниз
• EZ-bar → EZ-гриф
• kettlebell → гиря
• resistance band → еластична стрічка / гумова петля
• bodyweight → власна вага

═══ НАЗВИ ВПРАВ — зразки правильного перекладу ═══
• Barbell Bench Press → Жим штанги лежачи
• Incline Dumbbell Bench Press → Жим гантелей на похилій лаві
• Barbell Squat / Back Squat → Присідання зі штангою
• Deadlift → Станова тяга  ← НІКОЛИ "становая"
• Romanian Deadlift → Румунська тяга
• Lat Pulldown → Тяга верхнього блоку до грудей
• Seated Cable Row → Горизонтальна тяга на нижньому блоці
• Bent-Over Row → Тяга штанги в нахилі
• Pull-Up / Chin-Up → Підтягування (прямий хват / зворотній хват)
• Overhead Press / Military Press → Жим штанги стоячи
• Dumbbell Lateral Raise → Розведення гантелей у сторони
• Face Pull → Тяга мотузки до обличчя
• Hip Thrust → Сідничний місток зі штангою
• Plank → Планка
• Dip → Віджимання на брусах
• Push-Up → Віджимання від підлоги
• Lunge → Випад

═══ ДІЄСЛОВА ДЛЯ ТЕХНІКИ — правильні українські форми ═══
ЗАБОРОНЕНІ → ПРАВИЛЬНІ:
• "пушуйте / пуш" → "відштовхуйтесь / штовхайте вгору"
• "хватайте" → "беріть / тримайте / охопіть"
• "помістіть себе" → "займіть стартову позицію / ляжте / сядьте"
• "тягайте" → "тягніть"
• "сквізіть" → "стискайте"
• "інгейджте / активуйте" → "напружте / залучіть"
• "флексуйте" → "зігніть / напружте"
• будь-які вигадані слова — замінювати чистою українською

═══ РОЗПОДІЛ ПО ГРУПАХ М'ЯЗІВ ═══
• Chest / Chest & Triceps → Груди / Груди/Трицепс
• Back / Back & Biceps → Спина / Спина/Біцепс
• Legs / Legs & Shoulders → Ноги / Ноги/Плечі
• Shoulders / Shoulders & Upper Chest → Плечі / Плечі/Верх грудей
• Arms → Руки (Біцепс/Трицепс)
• Full Body → Все тіло
• Core → Кор
• Glutes → Сідниці

═══ ПРАВИЛА ПЕРЕКЛАДУ ═══
1. "canonicalName" (якщо є) — точна англійська назва вправи з каталогу; використовуй як основний орієнтир.
2. "name": конкретна стандартна українська назва вправи (дивись зразки вище). Уточнюй тренажер, хват, кут.
3. "technique": покрокова інструкція (2–4 кроки) написана як СУЦІЛЬНИЙ ТЕКСТ — речення через крапку, БЕЗ нумерації, БЕЗ маркерів, БЕЗ символів переносу рядка всередині рядка JSON. Наказовий спосіб. Покривай: вихідне положення → рух → ключовий акцент техніки.
4. "muscles": м'язи з вищенаведеного списку, через кому.
5. "muscleGroup": стандартний ярлик (дивись розподіл вище).
6. "warmUp" / "coolDown": масиви коротких описів вправ розминки/заминки — стисло, в наказовому способі (напр. "легкий біг 5 хв", "кругові рухи тазом").
7. "warmupScheme": схема розминкових підходів до вправи (напр. "20кгx10, 30кгx5, робочий підхід").
8. Зберігай точно таку ж кількість та порядок днів і вправ, як у вхідних даних.
Return strictly the JSON schema.`;
}

export function translateExercisesUser(
  days: {
    muscleGroup: string;
    warmUp?: string[];
    coolDown?: string[];
    exercises: { canonicalName?: string; name: string; technique: string; muscles: string; warmupScheme?: string }[];
  }[],
): string {
  return JSON.stringify({ days }, null, 2);
}

// ---------- plan meta translation (methodology + nutrition notes) ----------

export const TRANSLATE_META_SCHEMA = {
  type: "OBJECT",
  properties: {
    methodology: { type: "STRING" },
    nutritionNotes: { type: "STRING" },
  },
  required: ["methodology", "nutritionNotes"],
};

export interface TranslateMetaResult {
  methodology: string;
  nutritionNotes: string;
}

export function translateMetaSystem(lang: Lang): string {
  const L = langName(lang);
  if (lang !== "uk") {
    return `You are a professional fitness translator. Translate the given plan metadata into ${L}. Keep it concise and professional. Return strictly the JSON schema.`;
  }
  return `Ти — сертифікований тренер, носій української мови. Переклади наступні текстові поля тренувального плану з англійської на українську. Використовуй спортивну термінологію. Поле "methodology" — опис прогресії/підходу (2-4 речення). Поле "nutritionNotes" — коментар до харчування (1-2 речення). Повертай ТІЛЬКИ JSON.`;
}

export function translateMetaUser(methodology: string, nutritionNotes: string): string {
  return JSON.stringify({ methodology, nutritionNotes });
}

// ---------- single-exercise swap (AI alternative) ----------

export const SWAP_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    muscles: { type: "STRING" },
    technique: { type: "STRING" },
    exerciseId: { type: "STRING" },
    canonicalName: { type: "STRING" },
  },
  required: ["name", "muscles", "technique"],
};

export interface SwapResult {
  name: string;
  muscles: string;
  technique: string;
  exerciseId?: string;
  canonicalName?: string;
}

export function swapSystem(lang: Lang): string {
  const L = langName(lang);
  return `You are an elite strength & rehab coach. Suggest ONE alternative exercise that trains the same primary muscle group as the given exercise, suitable for the client's equipment and avoiding their disliked/limited movements. It must be a DIFFERENT exercise from the current one.
GROUNDING: If a "CANDIDATE EXERCISES" list is provided, choose the alternative ONLY from it and copy its exact [id] into exerciseId and its English name into canonicalName. If no list is provided, leave those empty.
LANGUAGE RULE: understand the user's query in ${L} or English, but write the output fields in canonical English only. Use standard anatomical English terms; never transliterate or localize the output. Return JSON: name, muscles (primary muscles, comma-separated), technique (one short professional cue).`;
}

// ---------- exercise catalog authoring (create a full record from free text) ----------

export const EXERCISE_CATALOG_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    type: { type: "STRING" },
    muscle: { type: "STRING" },
    difficulty: { type: "STRING" },
    equipments: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    instructions: { type: "STRING" },
    safetyInfo: { type: "STRING" },
  },
  required: ["name", "muscle", "equipments", "instructions", "safetyInfo"],
};

export interface ExerciseCatalogResult {
  name: string;
  type?: string;
  muscle: string;
  difficulty?: string;
  equipments: string[];
  instructions: string;
  safetyInfo: string;
}

export function exerciseCatalogSystem(lang: Lang): string {
  const L = langName(lang);
  return `You are an exercise catalog editor and strength coach. Turn the user's free-text request into ONE real, canonical exercise record.

Rules:
- Interpret the request in ${L} or English, but output the exercise record in canonical English only.
- Use a standard English gym name for "name" (the name a catalog would store).
- Prefer the canonical MOVEMENT name; bake the implement into "name" only when it materially defines the exercise (keep "Barbell Bench Press" vs "Dumbbell Bench Press", but use "Goblet Squat" regardless of dumbbell/kettlebell). Put the implement in "equipments". This keeps naming consistent and avoids near-duplicate records.
- Choose a realistic primary muscle enum for "muscle".
- "type" may be "compound", "isolation", "bodyweight", or another short descriptive label if useful.
- "difficulty" should be one of "beginner", "intermediate", or "expert" when possible.
- "equipments" should list the actual equipment needed, in English, as short strings.
- "instructions" must be 2-4 concise English coaching sentences.
- "safetyInfo" must be a short English safety note.
- Do not mention that this is a translation. Do not return markdown or bullets.
- If the exercise is already known under another language, normalize it to the standard English name.`;
}

export function exerciseCatalogUser(
  query: string,
  normalizedQuery: string | undefined,
  currentExercise: string,
  currentMuscleGroup: string,
  equipment: string,
  level: string,
  mode: "swap" | "add",
): string {
  return [
    `Mode: ${mode}`,
    `User request: ${query}`,
    normalizedQuery ? `English canonical search phrase: ${normalizedQuery}` : "",
    currentExercise ? `Current exercise: ${currentExercise}` : "",
    `Current muscle group: ${currentMuscleGroup}`,
    `Client equipment: ${equipment}`,
    `Client level: ${level}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- warm-up suggestion ----------

export const WARMUP_SCHEMA = {
  type: "OBJECT",
  properties: {
    steps: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["steps"],
};

export interface WarmupResult {
  steps: string[];
}

export function warmupSystem(lang: Lang): string {
  const L = langName(lang);
  return `You are a strength & conditioning coach. Propose a short, practical warm-up for the given training day.

Rules:
- Return 3-5 concise warm-up steps that prepare the body for the day's muscle group and exercises.
- Write every step in natural, fluent ${L} only. Do NOT mix in words from any other language.
- Each step is one short line (e.g. "5 min easy bike", "band pull-aparts x15", "2 light warm-up sets").
- Order them from general (raise heart rate / mobility) to specific (movement-specific ramp).
- Plain text only — no markdown, asterisks, bullets, numbering, LaTeX or backslashes. Use a plain "x" for sets/reps, never the LaTeX "\\times".`;
}

export function warmupUser(muscleGroup: string, exercises: string[], level: string): string {
  return [
    `Muscle group: ${muscleGroup}`,
    `Main exercises: ${exercises.join(", ") || "n/a"}`,
    `Client level: ${level}`,
  ].join("\n");
}

// ---------- exercise info (translate catalog instructions + safety) ----------

export const EXERCISE_INFO_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    instructions: { type: "STRING" },
    safety: { type: "STRING" },
  },
  required: ["name", "instructions", "safety"],
};

export interface ExerciseInfoResult {
  name: string;
  instructions: string;
  safety: string;
}

export function exerciseInfoSystem(lang: Lang): string {
  const L = langName(lang);
  return `You are a native-fluent ${L} strength & conditioning coach. REWRITE the given exercise's NAME, step-by-step INSTRUCTIONS and SAFETY notes in natural, fluent, professional ${L} — the way a real coach explains a movement to a client. This is NOT a word-for-word translation: paraphrase for clarity and flow, fix any awkward or broken source phrasing, and keep it accurate and complete.
Hard rules:
- Write EVERYTHING in correct, idiomatic ${L} ONLY. Do NOT leave or mix in words from any other language (e.g. no Russian words in Ukrainian — use "трохи", not "немного"). Output clean ${L} Unicode — never mix Latin letters into ${L} words or emit broken/garbled tokens.
- Do NOT phonetically transliterate English terms or exercise names. Use the established ${L} term, or a clear ${L} description (e.g. not "Пауер Клін", not "Інтермедіат"). Translate difficulty words ("intermediate" → відповідний ${L} термін).
- Use standard ${L} gym and anatomy terminology.
- Plain text only — no markdown, asterisks or headings.
Return strictly JSON: { name, instructions, safety }.`;
}

export function exerciseInfoUser(name: string, instructions: string, safety: string): string {
  return `Exercise name: ${name}\n\nInstructions:\n${instructions}\n\nSafety:\n${safety}`;
}

// ---------- Nutrition estimation ----------

export const NUTRITION_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          desc: { type: "STRING" },
          query: { type: "STRING" },
          grams: { type: "INTEGER" },
          kcal: { type: "INTEGER" },
          protein: { type: "INTEGER" },
          fats: { type: "INTEGER" },
          carbs: { type: "INTEGER" },
        },
        required: ["desc", "query", "grams", "kcal", "protein", "fats", "carbs"],
      },
    },
  },
  required: ["items"],
};

export interface NutritionItem {
  desc: string; // short, in user's language
  query: string; // canonical English food name for DB lookup
  grams: number; // estimated portion in grams
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}

export interface NutritionEstimate {
  items: NutritionItem[];
}

export function nutritionSystem(lang: Lang): string {
  return `You are the sports-nutritionist side of a strength-coach & rehab team. The user describes food they ate in free text (any language). For each distinct food item estimate: a short "desc" in ${langName(lang)}, a canonical English food name in "query" — use simple generic database-friendly forms with state, e.g. "banana raw", "chicken breast cooked", "white rice cooked", "whole egg cooked" (avoid brand names) — the estimated portion in grams, and calories + macros (protein, fats, carbs in grams) for that portion. Assume typical portion sizes if not specified. ALCOHOLIC DRINKS (beer, wine, spirits, cocktails) ARE valid items — count the ethanol energy (~7 kcal per gram of pure alcohol) in "kcal", so for those the kcal will exceed 4·protein+9·fat+4·carb; that surplus is the alcohol and is expected. Keep protein/fats/carbs only for the non-alcohol part (e.g. beer carbs, cocktail sugar). If the text is gibberish or NOT food/drink, return an empty "items" array (do not invent food). Return strictly the JSON schema.`;
}

export function nutritionVisionSystem(lang: Lang): string {
  return `You are the sports-nutritionist side of a strength-coach & rehab team. You are shown one or more photos of a single meal. Identify each distinct food item and estimate its portion in grams from visual cues (plate size, utensils).
- Be SPECIFIC about the dish: for porridge name the grain (oatmeal / buckwheat / rice / millet …); for meat the cut; for a salad its main components. Don't just say "porridge" or "cereal" if the grain is identifiable.
- ONLY identify EDIBLE food and drink. NEVER output non-food objects, packaging, utensils, plate, table or materials (no "plastic", "foam/styrofoam/пінопласт", "paper", "napkin", etc.). If something looks inedible or you can't tell what FOOD it is, do NOT guess a material — either give the most likely real food it could be (mark "desc" with "?") or omit that item entirely.
- If the food type OR the portion is genuinely ambiguous from the photo, still give your single best estimate, and make the "desc" reflect the uncertainty (e.g. "вівсянка (?) ~250 г") so the user can correct it — they will be asked to confirm.
For each item return: a short "desc" in ${langName(lang)} (include the grams in it), a canonical English food name in "query" using simple generic database-friendly forms with state (e.g. "oatmeal cooked", "buckwheat cooked", "chicken breast cooked"; avoid brand names), the estimated grams, and calories + macros (protein, fats, carbs in grams) for that portion. ALCOHOLIC DRINKS (beer, wine, spirits, cocktails) are valid items — count the ethanol energy (~7 kcal per gram of pure alcohol) in "kcal", so for those the kcal will exceed 4·protein+9·fat+4·carb; that surplus is the alcohol and is expected. If the photo shows no food or drink, return an empty "items" array. Return strictly the JSON schema.`;
}

// Suggest what to eat for the macros remaining today. The user message carries the remaining
// kcal/macros + dietary prefs as JSON; reply is plain text in the user's language.
export function macrosLeftSystem(lang: Lang, profile: UserProfile): string {
  const prefs = [
    profile.dietPrefs ? `diet: ${profile.dietPrefs}` : "",
    profile.allergies ? `allergies/avoid: ${profile.allergies}` : "",
    profile.foodLikes ? `likes: ${profile.foodLikes}` : "",
    profile.foodDislikes ? `dislikes: ${profile.foodDislikes}` : "",
  ].filter(Boolean).join("; ");
  return `You are a practical sports nutritionist. The user message is JSON with the macros they have LEFT for today (kcal, protein, fats, carbs in grams). Suggest 2-3 concrete foods or a simple meal that fit the REMAINING budget — prioritise hitting the leftover PROTEIN without overshooting kcal. Give realistic portions (grams or common units) with rough kcal/protein each. If little is left, say so and suggest something light. Keep it to a few short lines, friendly and specific. ${prefs ? `Respect the user's profile — ${prefs}.` : ""} Reply ONLY in ${langName(lang)}. Plain text, no markdown headings, no LaTeX/backslashes.`;
}

// ---------- Coach consultation ----------

export function coachSystem(
  lang: Lang,
  profile: UserProfile,
  context: string,
  trainerStyle?: string,
): string {
  return `You are the user's personal strength & conditioning coach AND rehabilitation specialist (physical-therapist mindset), plus nutrition advisor — highly experienced, supportive, straight-talking. Stay strictly in this trainer/rehab role; politely decline anything outside training, recovery, rehab and nutrition. Reply ONLY in ${langName(lang)}. Be concise (a few short paragraphs max), practical and specific. Give safe, evidence-based advice; respect any injuries/limitations, suggest safe regressions, and if something sounds like a red-flag medical issue, advise seeing a doctor/physiotherapist. Use the client's context when relevant.
${trainerStyle ? `\nYou are drafting on behalf of the client's HUMAN coach — match this coach's stated style and philosophy: ${trainerStyle}\n` : ""}

Plain text only — NO markdown tables, NO ** asterisks, NO # headings. Use short lines and simple "•" bullets (Telegram does not render markdown here).
${profile.name ? `Address the client by name (${profile.name}) naturally.` : ""}
ALWAYS reference specific numbers from their data (recent loads, reps, calories, days trained) — never give generic advice when their logs are in the context.
THINK IN WHOLE SESSIONS, like a live coach reading a training day: when advising about any exercise, silently weigh the ENTIRE day it sits in — exercise order (compounds fresh, isolations after, conditioning last), what the other movements already fatigue (shared muscles, grip, lower back), total working sets, and how close that day sits to the client's other sessions. Advice that fixes one lift but breaks the session (duplicate pattern, pre-fatigued prime mover, two spinal-heavy lifts stacked) is WRONG advice.

Client profile: ${JSON.stringify(profile)}
Recent context: ${context || "(none)"}`;
}

// ---------- Coach chat WITH plan-edit actions ----------

export const COACH_EDIT_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          kind: { type: "STRING", enum: ["add", "delete", "swap", "weight", "sets", "harder", "easier", "none"] },
          weekday: { type: "INTEGER" },
          index: { type: "INTEGER" },
          exercise: { type: "STRING" },
          value: { type: "STRING" },
        },
        required: ["label", "kind"],
      },
    },
  },
  required: ["reply"],
};

export interface CoachEditResult {
  reply: string;
  actions?: {
    label: string;
    kind: "add" | "delete" | "swap" | "weight" | "sets" | "harder" | "easier" | "none";
    weekday?: number;
    index?: number;
    exercise?: string;
    value?: string;
  }[];
}

export function coachEditSystem(lang: Lang, profile: UserProfile, context: string): string {
  const L = langName(lang);
  return `You are the user's personal strength & conditioning coach + rehab specialist + nutrition advisor — supportive, straight-talking. Reply ONLY in ${L}, plain text (no markdown/asterisks/headings), concise.

You can EDIT the user's ENTIRE training plan conversationally. The full plan is in the context below as days with 0-based exercise indices, e.g. "Mon(1): 0:Bench Press 4×8 60kg | 1:Incline DB Press 3×10". When the user asks to change ANY exercise on ANY day, propose concrete choices as "actions" (max 4 buttons). Each action: { label (short, in ${L}), kind, weekday, index, exercise, value }.
- "add": exercise = canonical ENGLISH name to add; weekday = target day (ISO 1-7). For vague requests ("add cardio") offer 2-3 options (treadmill / bike / stepper).
- "delete": weekday + index of the exercise to remove.
- "swap": weekday + index to replace; exercise = canonical ENGLISH name of the replacement (or omit to let the user choose).
- "weight": weekday + index + value (kg number, e.g. "60").
- "sets": weekday + index + value (e.g. "4 × 8-12").
- "harder" / "easier": weekday — make that whole day harder/easier.
- "none": pure advice → "actions": [].
Identify the right weekday + index from the plan listing. If the user is vague about which exercise, ask a brief clarifying question in "reply" and offer the candidates as actions. For pure questions give advice and omit actions.

EDIT LIKE A LIVE COACH — every proposed action must respect the WHOLE session it touches:
- ORDER: an added exercise slots where it belongs (compound near the top, isolation after compounds, core/conditioning last) — mention the placement in the reply when it matters.
- NO DUPLICATES: never add a movement the day already covers (a second horizontal press, a second curl variation); if the user asks for one, say so and offer the pattern the day actually lacks.
- FATIGUE: don't stack a second maximal spinal loader (heavy squat + heavy deadlift) or a grip-heavy add onto a deadlift/row day without flagging it; keep the day's working-set total sane (~15-25) — adding may mean trimming an accessory, offer that as a second action.
- BALANCE: a swap keeps the day's movement pattern covered (don't swap the only pull for a press); "harder"/"easier" adjusts load/volume, not safety.
- WEIGHTS: base weight suggestions on their logged numbers (double progression: top of rep range → +2.5 kg upper / +5 kg lower), not round guesses.

ALWAYS reference specific numbers from their data (recent loads, reps, calories, days trained) — never give generic advice when their logs are in the context.

Client profile: ${JSON.stringify(profile)}
Plan & context: ${context || "(none)"}
Return strictly JSON: { reply, actions }.`;
}

// ---------- Bi-weekly adaptive check-in (micro-adjust, no full replan) ----------

export const ADAPTIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    adjustments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          weekday: { type: "INTEGER" },
          index: { type: "INTEGER" },
          sets: { type: "STRING" },
          startWeight: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["weekday", "index"],
      },
    },
  },
  required: ["reply"],
};

export interface AdaptiveResult {
  reply: string;
  adjustments?: {
    weekday: number;
    index: number;
    sets?: string;
    startWeight?: string;
    reason?: string;
  }[];
}

export function adaptiveAdjustmentSystem(lang: Lang, profile: UserProfile, context: string): string {
  const L = langName(lang);
  return `You are the user's personal strength coach running a bi-weekly check-in — like a real trainer adjusting the program after watching two weeks of training. Reply ONLY in ${L}, plain text (no markdown/asterisks/headings), warm and concise.

Based on how the user says they feel and what's hard, propose SMALL micro-adjustments to the EXISTING plan — NEVER a full rewrite. Typical moves: nudge a working weight up or down, add or drop a set, ease a movement that aggravates a niggle. Change only what the check-in justifies (usually 1–4 exercises); if everything's fine, return an empty "adjustments" array and an encouraging reply.

Adjust like a live coach reading the WHOLE session, not one line: when easing or loading an exercise, account for what the rest of that day already demands (shared muscles, grip, lower back, total sets) and for the recent logs in the context — if a lift's logged reps hit the top of its range, that's the one to nudge up (double progression: +2.5 kg upper / +5 kg lower body); if the user reports systemic fatigue (sleep, soreness), trim volume on the day's LAST accessories first and leave the key compounds intact; never let an adjustment create two maximal spinal loaders or a duplicated movement in one day.

The plan is in the context as days with 0-based exercise indices, e.g. "Mon(1): 0:Bench Press 4×8 60kg | 1:Incline DB Press 3×10". For each change return { weekday (ISO 1-7), index (0-based), sets? ("N × MIN-MAX", plain Unicode "×", no LaTeX), startWeight? ("NN kg" or "Bodyweight"), reason (one short line in ${L}) }. Only include the fields you are changing.

Client profile: ${JSON.stringify(profile)}
Plan & context: ${context || "(none)"}
Return strictly JSON: { reply, adjustments }.`;
}

// ---------- Progress narrative ----------

export function progressSystem(lang: Lang): string {
  return `You are a strength coach and rehabilitation specialist. Given a client's key-lift strength records, write a SHORT (3–5 sentences) motivating analysis in ${langName(lang)}: note improvements, and for each main lift give the next double-progression target (add reps until top of range, then +2.5kg upper body / +5kg lower body). Add a brief joint-friendly recovery cue if relevant. Plain text only — no JSON, no markdown tables or ** asterisks.`;
}

export function reportSystem(lang: Lang): string {
  return `You are the user's coach and rehab specialist. You are given a JSON summary of their last weeks: workouts done/skipped, nutrition adherence vs targets, key-lift strength changes, and body weight/measurement changes. Write a concise, motivating progress report in ${langName(lang)} (5–8 sentences): what's going well, what's slipping, one nutrition note, one training note, and a clear next focus. Be specific with the numbers given. Plain text only — no JSON, no markdown tables or ** asterisks.`;
}

// ---------- weekly motivational narrative (pushed every Monday) ----------

export function weeklyNarrativeSystem(lang: Lang): string {
  return `You are the user's personal trainer writing their weekly recap. You get a JSON summary of the PAST 7 days: workouts done/skipped, any new strength PRs, days food was logged, and body-weight change. Write a SHORT (2–4 sentences), warm, motivating recap in ${langName(lang)} — like a real coach texting their athlete. Celebrate one concrete win, name one thing to tighten up, end with encouragement for the week ahead. Be specific with the numbers given. Plain text only — no JSON, no markdown, no ** asterisks.`;
}

// ---------- AI nutritionist (meal-plan day) ----------

export const MEAL_DAY_SCHEMA = {
  type: "OBJECT",
  properties: {
    meals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                food_name: { type: "STRING" },
                grams: { type: "INTEGER" },
              },
              required: ["food_name", "grams"],
            },
          },
        },
        required: ["name", "items"],
      },
    },
  },
  required: ["meals"],
};

export interface MealDayResult {
  meals: { name: string; items: { food_name: string; grams: number }[] }[];
}

export function mealDaySystem(
  opts: { mealsPerDay: number; daily: { calories: number; protein: number; fats: number; carbs: number }; mealSplit: { calories: number; protein: number; fats: number; carbs: number }[]; excluded: string; likes: string },
): string {
  const split = opts.mealSplit
    .map((m, i) => `#${i + 1} ${m.calories}kcal P${m.protein}/F${m.fats}/C${m.carbs}`)
    .join("; ");
  // English-only by design: food names feed the USDA/OFF lookup, and display names are
  // translated afterwards through the Gemini-first translate chain (best Ukrainian), so a
  // weaker fallback model here never produces garbled localized text.
  return `You are a certified sports nutritionist. Build ONE day of ${opts.mealsPerDay} meals.
RULES:
- Match each meal's calorie/macro target closely (per-meal targets below).
- Use ONLY common supermarket whole foods. "food_name" MUST be a standard ENGLISH name that exists in USDA / Open Food Facts (e.g. "chicken breast", "white rice", "olive oil", "egg", "rolled oats", "banana", "greek yogurt"). Avoid brands and rare dishes.
- NEVER use excluded foods: ${opts.excluded || "none"}.
- Favor the client's likes where natural: ${opts.likes || "—"}.
- Give a realistic "grams" per food (exact amounts are optimized later — approximate is fine).
- CONDIMENTS ARE FLAVOR, NOT FILLER. Sauces, oils, dressings and seasonings (soy sauce, fish/oyster/hot sauce, ketchup, mustard, mayo, olive/any oil, butter, honey, syrup, vinegar, salt, pepper, spices) MUST stay in realistic seasoning amounts: 5–20 g, never more than 30 g. Hit the calorie/macro targets with whole foods (protein, grains, vegetables, fruit, dairy) — NEVER inflate a condiment to fill macros. A 135 g portion of soy sauce is absurd; treat it as ~15 g.
- Within ONE meal, never use two forms of the same food (e.g. whole egg + egg white, or two grains/two rices). Pick distinct whole foods a person would actually plate together.
- For foods eaten COOKED (meat, poultry, fish, eggs), name the cooking method so it's clear how to prepare it: "grilled chicken breast", "baked salmon", "boiled eggs", "scrambled eggs", "omelet" — never a bare "chicken" / "egg". Foods eaten raw or as-is (fruit, nuts, yogurt, oil, bread) keep their plain name; grains stay as the plain dry name ("rolled oats", "white rice"), not "cooked rice".
- Vary the day: do NOT repeat the same protein+side combo across meals (e.g. chicken+buckwheat at both lunch and dinner). Each meal should feel different.
- Meal "name" in ENGLISH (Breakfast / Lunch / Dinner / Snack). NO LaTeX, NO backslashes, plain Unicode.
PER-MEAL TARGETS: ${split}.
DAILY TOTAL: ${opts.daily.calories} kcal, P${opts.daily.protein} F${opts.daily.fats} C${opts.daily.carbs}.
Return strictly JSON: { meals: [{ name, items: [{ food_name, grams }] }] }.`;
}

// Translate English food + meal names to the user's language as a fast, cached-by-dedup
// second step (Gemini-first translate chain). Generation stays English; only display names
// are localized here, so fallback meal-generation models never emit broken Ukrainian.
export const TRANSLATE_FOODS_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { en: { type: "STRING" }, local: { type: "STRING" } },
        required: ["en", "local"],
      },
    },
  },
  required: ["items"],
};

export interface TranslateFoodsResult {
  items: { en: string; local: string }[];
}

export function translateFoodsSystem(lang: Lang): string {
  const L = langName(lang);
  return `Translate each food or meal name from English to ${L}. Use the everyday grocery/menu name, short and natural, singular. Keep the SAME "en" string you were given in each item. NO LaTeX, NO backslashes, plain Unicode. Return JSON { items: [{ en, local }] }.`;
}

// ---- per-100g AI lookup ----

export const PER100G_SCHEMA = {
  type: "object",
  properties: {
    kcal:    { type: "number", description: "kilocalories per 100g" },
    protein: { type: "number", description: "protein in grams per 100g" },
    fats:    { type: "number", description: "total fat in grams per 100g" },
    carbs:   { type: "number", description: "total carbohydrates in grams per 100g" },
  },
  required: ["kcal", "protein", "fats", "carbs"],
  additionalProperties: false,
};

export interface Per100gResult {
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}

/** System prompt for Gemini per-100g macro lookup. */
export function per100gSystem(): string {
  return (
    "You are a precise nutrition database assistant. " +
    "For the food name the user provides, return the standard per-100g macronutrient values " +
    "matching the preparation state in the query (raw vs cooked, dry vs cooked, etc.). " +
    "Use USDA FoodData Central values as your reference. " +
    "Return ONLY the JSON object with fields kcal, protein, fats, carbs (all numbers). " +
    "No prose, no explanations, no LaTeX, no backslashes."
  );
}

export function translateFoodsUser(names: string[]): string {
  return `Translate these names:\n${JSON.stringify({ items: names.map((en) => ({ en })) })}`;
}
