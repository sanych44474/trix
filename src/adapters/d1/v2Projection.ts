import type { MealEntry, PlanDoc, UserDoc, WorkoutLogDoc } from "../../types";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function statementList(statements: D1PreparedStatement[]): D1PreparedStatement[] {
  return statements.filter(Boolean);
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], chunkSize = 50): Promise<void> {
  const ready = statementList(statements);
  for (let i = 0; i < ready.length; i += chunkSize) {
    await db.batch(ready.slice(i, i + chunkSize));
  }
}

/**
 * Idempotent projection adapter used by the staged v2 rollout.
 *
 * The legacy repository remains the source of truth for now. The projection uses stable
 * ids derived from the legacy owner/day positions, so a retry is an update, never a duplicate.
 */
export async function projectUserCore(db: D1Database, user: UserDoc): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, username, blocked, botBlocked,
       flagged, progressionRate, lastSeenAt, doWokenAt, vacationUntil, comebackDone, inactiveAskedAt,
       inactiveReply, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(legacyUserId) DO UPDATE SET chatId=excluded.chatId, role=excluded.role,
       status=excluded.status, username=excluded.username, blocked=excluded.blocked,
       botBlocked=excluded.botBlocked, flagged=excluded.flagged, progressionRate=excluded.progressionRate,
       lastSeenAt=excluded.lastSeenAt, doWokenAt=excluded.doWokenAt, vacationUntil=excluded.vacationUntil,
       comebackDone=excluded.comebackDone, inactiveAskedAt=excluded.inactiveAskedAt,
       inactiveReply=excluded.inactiveReply, updatedAt=excluded.updatedAt`,
    ).bind(
      user._id,
      user._id,
      user.chatId,
      user.role,
      user.blocked ? "blocked" : "active",
      user.username ?? null,
      user.blocked ? 1 : 0,
      user.botBlocked ? 1 : 0,
      user.flagged ? 1 : 0,
      user.progressionRate ?? "normal",
      user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
      user.doWokenAt ? user.doWokenAt.toISOString() : null,
      user.vacationUntil ? user.vacationUntil.toISOString() : null,
      user.comebackDone ? user.comebackDone.toISOString() : null,
      user.inactiveAskedAt ? user.inactiveAskedAt.toISOString() : null,
      user.inactiveReply ?? null,
      user.createdAt.toISOString(),
      now,
    ),
    db.prepare(
      `INSERT INTO v2_profiles (accountId, lang, name, timezone, sex, age, heightCm, weightKg, goal,
       goalWeight, level, equipment, limitations, dietPrefs, trainingWeekdays, shareWithTrainer,
       profile, nutrition, referredBy, buddyId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET lang=excluded.lang, name=excluded.name,
       timezone=excluded.timezone, sex=excluded.sex, age=excluded.age, heightCm=excluded.heightCm,
       weightKg=excluded.weightKg, goal=excluded.goal, goalWeight=excluded.goalWeight,
       level=excluded.level, equipment=excluded.equipment, limitations=excluded.limitations,
       dietPrefs=excluded.dietPrefs, trainingWeekdays=excluded.trainingWeekdays,
       shareWithTrainer=excluded.shareWithTrainer, profile=excluded.profile,
       nutrition=excluded.nutrition, referredBy=excluded.referredBy, buddyId=excluded.buddyId,
       updatedAt=excluded.updatedAt`,
    ).bind(
      user._id,
      user.lang,
      user.profile.name ?? null,
      user.profile.timezone ?? null,
      user.profile.sex ?? null,
      user.profile.age ?? null,
      user.profile.heightCm ?? null,
      user.profile.weightKg ?? null,
      user.profile.goal ?? null,
      user.profile.goalWeight ?? null,
      user.profile.level ?? null,
      user.profile.equipment ?? null,
      user.profile.limitations ?? null,
      user.profile.dietPrefs ?? null,
       json(user.profile.trainingWeekdays ?? []),
       json(user.profile.shareWithTrainer ?? {}),
       json(user.profile),
       user.nutrition ? json(user.nutrition) : null,
       user.profile.referredBy ?? null,
       user.profile.buddyId ?? null,
       now,
     ),
     db.prepare("DELETE FROM v2_trainer_relationships WHERE clientId = ?").bind(user._id),
     ...(user.trainerId ? [db.prepare(
       `INSERT INTO v2_trainer_relationships (clientId, trainerId, status, consent, createdAt, updatedAt)
        VALUES (?, ?, 'active', ?, ?, ?)
        ON CONFLICT(clientId, trainerId) DO UPDATE SET status='active', consent=excluded.consent, updatedAt=excluded.updatedAt`,
     ).bind(user._id, user.trainerId, json(user.profile.shareWithTrainer ?? {}), user.createdAt.toISOString(), now)] : []),
     db.prepare(
       `INSERT INTO v2_preferences (accountId, lang, timezone, waterGoalMl, stepsGoal, competeOptIn, alias, reminders, userReminders, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(accountId) DO UPDATE SET lang=excluded.lang, timezone=excluded.timezone,
        waterGoalMl=excluded.waterGoalMl, stepsGoal=excluded.stepsGoal, competeOptIn=excluded.competeOptIn,
        alias=excluded.alias, reminders=excluded.reminders, userReminders=excluded.userReminders,
        updatedAt=excluded.updatedAt`,
     ).bind(
       user._id,
       user.lang,
       user.profile.timezone ?? null,
       user.profile.waterGoalMl ?? null,
       user.profile.stepsGoal ?? null,
       user.competeOptIn ? 1 : 0,
       user.alias ?? null,
       json({ reminderHour: user.profile.reminderHour, remindersOff: user.profile.remindersOff ?? [] }),
       user.reminders ? json(user.reminders) : null,
       now,
     ),
     db.prepare(
       `INSERT INTO v2_onboarding (accountId, status, step, answers, completedAt, session, sessionMode, sessionRetryAfter, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(accountId) DO UPDATE SET status=excluded.status, step=excluded.step,
        answers=excluded.answers, completedAt=excluded.completedAt, session=excluded.session,
        sessionMode=excluded.sessionMode, sessionRetryAfter=excluded.sessionRetryAfter,
        updatedAt=excluded.updatedAt`,
     ).bind(
       user._id,
       user.onboarded ? "completed" : "in_progress",
       user.session.mode,
       json(user.profile),
       user.onboarded ? user.updatedAt.toISOString() : null,
       json(user.session),
       user.session.mode,
       user.session.retryAfter ?? null,
       now,
     ),
   ]);
}

// version is a real per-account plan-generation counter (correlated MAX(version)+1 subquery,
// same shape as v2Plans.ts's setActivePlan/saveDraftPlan — see migrations/0078's header comment
// for why this is NOT the same thing as schemaVersion/PLAN_SCHEMA_VERSION, which has its own
// column below). Passing `plan.schemaVersion || 1` as `version` here used to collide with
// v2_plans' UNIQUE(accountId, version) the moment an account got a second plan row (any
// re-generation), since schemaVersion is virtually always 1 — that bug is what 0078 fixes.
// `version` is deliberately absent from the ON CONFLICT SET clause: a re-projection of an
// EXISTING plan id must keep the version it was first assigned, not recompute a new one.
export async function projectPlan(db: D1Database, plan: PlanDoc): Promise<void> {
  const planId = plan.id ?? plan.userId;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO v2_plans (id, accountId, version, schemaVersion, status, source, active, authoredBy,
       nutrition, supplements, methodology, meta, mesocycle, createdAt, updatedAt)
       VALUES (?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM v2_plans WHERE accountId = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET schemaVersion=excluded.schemaVersion, status=excluded.status,
       source=excluded.source, active=excluded.active, authoredBy=excluded.authoredBy,
       nutrition=excluded.nutrition, supplements=excluded.supplements, methodology=excluded.methodology,
       meta=excluded.meta, mesocycle=excluded.mesocycle, updatedAt=excluded.updatedAt`,
    ).bind(
      planId,
      plan.userId,
      plan.userId,
      plan.schemaVersion || 1,
      plan.status,
      plan.authoredBy ? "trainer" : "ai",
      plan.active ? 1 : 0,
      plan.authoredBy ?? null,
      json(plan.nutrition),
      json(plan.supplements),
      plan.methodology,
      json({
        ...(typeof plan.stepsTarget === "number" ? { stepsTarget: plan.stepsTarget } : {}),
        ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
        ...(plan.movementAudit ? { movementAudit: plan.movementAudit } : {}),
        ...(typeof plan.deloadInterval === "number" ? { deloadInterval: plan.deloadInterval } : {}),
      }),
      plan.mesocycle ? json(plan.mesocycle) : null,
      plan.generatedAt.toISOString(),
      now,
    ),
    db.prepare("DELETE FROM v2_plan_days WHERE planId = ?").bind(planId),
  ];
  for (const day of plan.split) {
    const dayId = planId * 10 + day.weekday;
    const { exercises, ...dayRest } = day;
    statements.push(db.prepare(`INSERT INTO v2_plan_days (id, planId, weekday, name, muscleGroup, warmup, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(dayId, planId, day.weekday, day.muscleGroup, day.muscleGroup, day.warmUp ? json(day.warmUp) : null, json(dayRest)));
    exercises.forEach((exercise, position) => {
      statements.push(db.prepare(`INSERT INTO v2_plan_exercises (id, dayId, position, catalogId, name, sets, startWeight, technique, metric, supersetGroup, weightMode, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(dayId * 100 + position + 1, dayId, position, exercise.exerciseId ?? null, exercise.name, exercise.sets, exercise.startWeight, exercise.technique, exercise.metric ?? "reps", exercise.supersetGroup ?? null, exercise.weightMode ?? null, json(exercise)));
    });
  }
  await batchInChunks(db, statements);
}

export async function projectWorkout(db: D1Database, log: WorkoutLogDoc): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, rawText, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET weekday=excluded.weekday,
       completed=excluded.completed, rawText=excluded.rawText, updatedAt=excluded.updatedAt`,
    ).bind(log.userId, log.date, log.weekday, log.completed ? 1 : 0, log.notes ?? null, log.createdAt.toISOString(), now),
  ]);
  const current = await db.prepare("SELECT id FROM v2_workout_sessions WHERE accountId = ? AND date = ?").bind(log.userId, log.date).first<{ id: number }>();
  if (!current) return;
  const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM v2_workout_exercises WHERE sessionId = ?").bind(current.id)];
  log.exercises.forEach((exercise, position) => {
    const exerciseId = current.id * 100 + position + 1;
    const metric = exercise.setsDone.some((set) => set.meters != null) ? "distance" : exercise.setsDone.some((set) => set.seconds != null) ? "time" : "reps";
    statements.push(db.prepare("INSERT INTO v2_workout_exercises (id, sessionId, position, name, metric, skipped, rpe) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(exerciseId, current.id, position, exercise.name, metric, exercise.skipped ? 1 : 0, exercise.rpe ?? null));
    exercise.setsDone.forEach((set, setPosition) => {
      // rpe (migrations/0079_v2_workouts_complete.sql) -- per-set RPE, distinct from the
      // exercise-level rpe bound two lines up.
      statements.push(db.prepare("INSERT INTO v2_workout_sets (id, exerciseId, position, weight, reps, seconds, meters, rpe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(exerciseId * 100 + setPosition + 1, exerciseId, setPosition, set.weight, set.reps, set.seconds ?? null, set.meters ?? null, set.rpe ?? null));
    });
  });
  await batchInChunks(db, statements);
}

export async function projectNutrition(db: D1Database, log: { userId: number; date: string; meals: MealEntry[]; updatedAt: Date }): Promise<void> {
  const updatedAtIso = log.updatedAt.toISOString();
  await batchInChunks(db, [
    // createdAt (migrations/0075_v2_nutrition_complete.sql) is COALESCE-protected the same way
    // v2Nutrition.ts's appendMeals/setDayMeals do it: it's only in the INSERT's VALUES, never in
    // the ON CONFLICT SET clause, so a re-projection of an existing day leaves it untouched.
    db.prepare("INSERT INTO v2_nutrition_days (accountId, date, target, createdAt, updatedAt) VALUES (?, ?, NULL, ?, ?) ON CONFLICT(accountId, date) DO UPDATE SET updatedAt=excluded.updatedAt").bind(log.userId, log.date, updatedAtIso, updatedAtIso),
    db.prepare("DELETE FROM v2_nutrition_entries WHERE accountId = ? AND date = ?").bind(log.userId, log.date),
    ...log.meals.map((meal, position) => db.prepare("INSERT INTO v2_nutrition_entries (accountId, date, position, description, grams, kcal, protein, fats, carbs, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(log.userId, log.date, position, meal.desc, meal.grams ?? null, meal.kcal, meal.protein, meal.fats, meal.carbs, meal.query ?? null)),
  ]);
}
