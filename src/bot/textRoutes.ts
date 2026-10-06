// Free-text routing: which handler gets a plain message, by the user's current session mode.
import { handleAnnounce } from "./owner";
import { handleVideoUrl } from "./ownerVideos";
import { obProgress, onboardingStep } from "./onboarding";
import { handleAnswerQuestion } from "../features/trainer/trainerComms";
import { handleTemplateName } from "../features/trainer/clientCard";
import { handleTrainerBroadcast, trainerMenuActionFor } from "../features/trainer/trainer";
import { updateUser } from "../adapters/d1/v2Users";
import { t } from "../locales/i18n";
import { type SessionMode } from "../types";
import { MyContext, reply } from "../adapters/telegram/context";
import { handleAliasInput } from "./recordsCmds";
import { handleWeightEdit, handleSetsEdit, handleSwapCustom } from "./planExerciseEdit";
import { handleAddExercise, handleExerciseAltText } from "./exerciseCatalog";
import { handleWarmupEdit } from "./warmup";
import { menuActionFor } from "./menus";
import { guardLogExit } from "./guidedLog";
import { handleCoach } from "./coach";
import { handleNutrition } from "../features/nutrition/nutritionLog";
import { handleWorkoutLog } from "./workoutSave";
import { handleCardioLog } from "./survey";
import { handleClientLogEdit, handleClientReply, handleTrainerMessage } from "../features/trainer/trainerComms";
import { handleProspectName, joinByCode } from "../features/trainer/trainer";
import { handleShareMyPlanName } from "../features/trainer/programSharing";
import { handleTrainerBirthday, handleTrainerHealth, handleTrainerNote, handleTrainerPersonal } from "../features/trainer/clientCard";
import { handleTwText } from "../features/trainer/trainerWizard";
import { handleBodyEdit, handleGoalWeight, handleMeasure } from "./settingsCmds";
import { handleCalcWeight } from "./progressCmds";
import { handleComebackText, handleVacationCustom } from "./vacation";
import { handleFeedback } from "./feedbackIntake";
import { handleFoodProduct, handleFoodWeight, handleStepsLog } from "./nutritionCmds";
import { handleInactiveFeedback } from "./cleanup";
import { handleLogDraftInput } from "./guidedLog";
import { handleMealClarify, handleMealItemFix } from "../features/nutrition/nutritionLog";
import { handleMealMacroEdit, handleMyLogNutritionEdit, handleMyLogWorkoutEdit } from "./logSelfEdit";
import { resumePendingPlan } from "./planGen";
import { mealIntakeText } from "./mealPlanCmds";
import { handleAdaptiveCheckin } from "./checkinCmds";

// ===================== Text routing by session mode =====================
// EVERY SessionMode is classified in exactly one of the two structures below — a dedicated
// text handler, or the deliberate coach-fallthrough list. The `_ModeUnclassified` assertion
// makes adding a new SessionMode a compile error until it's placed here, so a mode can no
// longer silently leak typed text into the AI coach (the "answered 32 to the trainer" family
// of bugs).
export type TextHandler = (ctx: MyContext, text: string) => Promise<unknown>;

export const MODE_TEXT_HANDLERS = {
  onboarding: (ctx, text) => onboardingStep(ctx, text),
  plan_pending: (ctx) => resumePendingPlan(ctx),
  nutrition: (ctx, text) => handleNutrition(ctx, text),
  // A button-guided per-exercise entry (sets→weight→reps) takes the text first; if no
  // exercise is mid-entry, fall back to parsing a full free-text log.
  log: async (ctx, text) => { if (!(await handleLogDraftInput(ctx, text))) await handleWorkoutLog(ctx, text); },
  measure: (ctx, text) => handleMeasure(ctx, text),
  body_edit: (ctx, text) => handleBodyEdit(ctx, text),
  steps_log: (ctx, text) => handleStepsLog(ctx, text),
  cardio_log: (ctx, text) => handleCardioLog(ctx, text),
  feedback: (ctx, text) => handleFeedback(ctx, text),
  client_code: (ctx, text) => joinByCode(ctx, text),
  trainer_note: (ctx, text) => handleTrainerNote(ctx, text),
  trainer_prospect_name: (ctx, text) => handleProspectName(ctx, text),
  share_myplan_name: (ctx, text) => handleShareMyPlanName(ctx, text),
  trainer_health: (ctx, text) => handleTrainerHealth(ctx, text),
  trainer_personal: (ctx, text) => handleTrainerPersonal(ctx, text),
  trainer_bday: (ctx, text) => handleTrainerBirthday(ctx, text),
  edit_client_log: (ctx, text) => handleClientLogEdit(ctx, text),
  edit_own_log: (ctx, text) => handleMyLogWorkoutEdit(ctx, text),
  edit_own_nutrition: (ctx, text) => handleMyLogNutritionEdit(ctx, text),
  meal_edit_macros: (ctx, text) => handleMealMacroEdit(ctx, text),
  goal_weight: (ctx, text) => handleGoalWeight(ctx, text),
  calc_weight: (ctx, text) => handleCalcWeight(ctx, text),
  trainer_setup: (ctx, text) => handleTwText(ctx, text),
  trainer_broadcast: (ctx, text) => handleTrainerBroadcast(ctx, text),
  comeback: (ctx, text) => handleComebackText(ctx, text),
  vacation_custom: (ctx, text) => handleVacationCustom(ctx, text),
  inact_feedback: (ctx, text) => handleInactiveFeedback(ctx, text),
  meal_confirm: (ctx, text) => handleMealClarify(ctx, text),
  meal_item: (ctx, text) => handleMealItemFix(ctx, text),
  food_wt: (ctx, text) => handleFoodWeight(ctx, text),
  food_prod: (ctx, text) => handleFoodProduct(ctx, text),
  msg_client: (ctx, text) => handleTrainerMessage(ctx, text),
  msg_trainer: (ctx, text) => handleClientReply(ctx, text),
  answer_q: (ctx, text) => handleAnswerQuestion(ctx, text),
  records_alias: (ctx, text) => handleAliasInput(ctx, text),
  weight_edit: (ctx, text) => handleWeightEdit(ctx, text),
  sets_edit: (ctx, text) => handleSetsEdit(ctx, text),
  swap_custom: (ctx, text) => handleSwapCustom(ctx, text),
  add_exercise: (ctx, text) => handleAddExercise(ctx, text),
  exercise_alt: (ctx, text) => handleExerciseAltText(ctx, text),
  warmup_edit: (ctx, text) => handleWarmupEdit(ctx, text),
  video_url: (ctx, text) => handleVideoUrl(ctx, text),
  announce: (ctx, text) => handleAnnounce(ctx, text),
  checkin_adaptive: (ctx, text) => handleAdaptiveCheckin(ctx, text),
  mp_likes: (ctx, text) => mealIntakeText(ctx, text),
  mp_dislikes: (ctx, text) => mealIntakeText(ctx, text),
  tpl_name: (ctx, text) => handleTemplateName(ctx, text),
  // Typed text while we're waiting for a CSV file -- remind them what we're actually waiting on,
  // instead of routing a stray "hi" or an exercise name into the AI coach.
  awaiting_import: (ctx) => reply(ctx, t(ctx.user.lang, "import_prompt")),
} satisfies Partial<Record<SessionMode, TextHandler>>;

// Modes where typed text DELIBERATELY falls through to the AI coach: either the mode is
// button-driven (checkin_*, exercise_confirm, mp_allergens, role_pick, photo_review) or the
// coach IS the handler (idle, coach).
export const COACH_TEXT_MODES = [
  "idle", "coach", "role_pick", "photo_review", "exercise_confirm",
  "checkin_energy", "checkin_sleep", "checkin_stress", "mp_allergens",
] as const satisfies readonly SessionMode[];

// Compile-time exhaustiveness: this type is `never` only when every SessionMode is classified.
export type _ModeUnclassified = Exclude<SessionMode, keyof typeof MODE_TEXT_HANDLERS | (typeof COACH_TEXT_MODES)[number]>;

export const _assertAllModesClassified: _ModeUnclassified[] = []; // becomes unassignable if a mode is missed
void _assertAllModesClassified;

// Modes a NOT-yet-onboarded athlete may legitimately be in; anything else is drift → pull back.
export const PRE_ONBOARD_MODES = new Set<SessionMode>(["onboarding", "plan_pending", "role_pick", "client_code", "trainer_setup"]);

export async function routeUserText(ctx: MyContext, text: string) {
  const mode = ctx.user.session.mode;
  if (mode !== "onboarding") {
    // Common athlete actions apply to every role; trainers also match their extra buttons.
    const action =
      menuActionFor(ctx.user.lang, text) ??
      (ctx.user.role === "trainer" ? trainerMenuActionFor(ctx.user.lang, text) : undefined);
    if (action) {
      // Reply-keyboard tap away from an unsaved guided log → ask Save/Discard/Continue first.
      if (await guardLogExit(ctx, `kbtext:${text}`)) return;
      await action(ctx);
      return;
    }
  }
  // Safety net: a non-onboarded athlete (solo/client) must finish the interview first. If their
  // session drifted into a non-onboarding conversational mode (e.g. they tapped "message trainer"
  // and never sent, then answered an onboarding question), their typed answer used to route to
  // that stale mode — so they could NEVER complete registration. Pull them back into the wizard.
  if (!ctx.user.onboarded && (ctx.user.role === "solo" || ctx.user.role === "client") && !PRE_ONBOARD_MODES.has(mode)) {
    const step = obProgress(ctx.user.profile).next;
    ctx.user.session = { mode: "onboarding", step };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await onboardingStep(ctx, text);
    return;
  }
  const handler = (MODE_TEXT_HANDLERS as Partial<Record<SessionMode, TextHandler>>)[mode];
  if (handler) { await handler(ctx, text); return; }
  // While editing someone ELSE's plan (trainer -> client), free text now goes to the AI coach
  // grounded in THAT client's plan/history (coachContext resolves the target via planOwnerId —
  // see bot/coach.ts), not a silent edit of the operator's own plan as it used to before the
  // coach was made owner-aware. Roadmap item 0: the trainer gets the same AI-coach interface for
  // a client that a solo user has for themselves, with edits gated by the item-7 safety layer.
  await handleCoach(ctx, text);
}
