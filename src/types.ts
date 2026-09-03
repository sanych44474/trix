export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  DB: D1Database; // Cloudflare D1 datastore
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_LIGHT_MODEL?: string; // faster model for light tasks (interview/coach/nutrition)
  GEMINI_FALLBACK_MODELS?: string; // comma-separated Gemini fallback order
  // Optional / fallback configuration
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_FALLBACK_MODELS?: string;
  GROQ_VISION_MODEL?: string;
  GROQ_TRANSCRIBE_MODEL?: string; // Whisper model for voice messages
  OLLAMA_API_KEY?: string;
  OLLAMA_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_TRANSLATE_MODEL?: string;
  OPENROUTER_VISION_MODEL?: string;
  WORKERSAI_MODEL?: string;
  WORKERSAI_TRANSCRIBE_MODEL?: string; // Whisper model for voice (default @cf/openai/whisper-large-v3-turbo)
  AI?: Ai; // Cloudflare Workers AI binding (free, on-platform)
  USDA_FDC_API_KEY?: string;
  EXERCISES_API_KEY?: string; // API Ninjas — only the seed script uses it (runtime reads D1)
  FATSECRET_CLIENT_ID?: string; // FatSecret OAuth2 — food database search (primary, OFF fallback)
  FATSECRET_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string; // YouTube Data API v3 — exercise technique shorts (cache-first)
  ADMIN_SECRET?: string;
  WORKER_URL?: string; // public worker origin — enables the Mini App dashboard buttons when set
  // Bot identity. BOT_USERNAME builds the t.me invite/share links; BOT_ID + BOT_NAME let the
  // Worker skip a getMe round-trip on every webhook. Unset BOT_ID falls back to bot.init().
  BOT_USERNAME?: string;
  BOT_ID?: string;
  BOT_NAME?: string;
}

export type Lang = "uk" | "en";

export type Role = "solo" | "trainer" | "client";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface UserProfile {
  name?: string; // preferred name (seeded from Telegram, confirmed in onboarding)
  weightKg?: number;
  heightCm?: number;
  age?: number;
  sex?: "male" | "female";
  goal?: string;
  level?: ExperienceLevel;
  trainingHistory?: string;
  daysPerWeek?: number;
  trainingWeekdays?: Weekday[];
  equipment?: string;
  limitations?: string;
  dietPrefs?: string;
  favoriteExercises?: string; // exercises the user enjoys / wants included
  dislikedExercises?: string; // exercises to avoid
  timezone?: string; // IANA, e.g. "Europe/Kyiv"
  reminderHour?: number; // 0..23 local
  sleepSchedule?: "morning" | "evening"; // bedtime before/after ~23:00; default reminder timing
  lifestyle?: "sedentary" | "moderate" | "active"; // daily activity outside training (job/NEAT)
  measurements?: BodyMeasurements; // baseline circumferences captured at onboarding
  goalWeight?: number; // target bodyweight (kg) — drives the weight-goal projection
  allergies?: string; // food allergies/intolerances (incl. lactose/gluten) — meal plan excludes these
  foodLikes?: string; // foods the user enjoys — meal plan favors them
  foodDislikes?: string; // foods to avoid in the meal plan
  remindersOff?: string[]; // reminder keys the user disabled (workout/nutrition/steps/checkin/…)
  // Opt-in menstrual-cycle tracking (female users only). When on, the coach knows the current
  // phase (follicular/ovulation/luteal/menstruation) and can nudge deloads / carb bumps around
  // the period. Off by default and never inferred — the user must switch it on and log a start.
  cycleTracking?: boolean;
  referredBy?: number; // inviter's user id from a /start ref_<id> deep link (set once, pre-onboarding)
  buddyId?: number; // accountability partner's user id (mutual, set via /start buddy_<id>)
  waterGoalMl?: number; // personal daily water goal; absent → 35ml/kg formula
  waterEvery?: number; // opt-in water reminder interval in hours (0/undefined = off; e.g. 2/3/4)
  stepsGoal?: number; // personal daily steps goal; absent → 8000
  quietFrom?: number; // do-not-disturb window start hour (local); with quietTo suppresses nudges
  quietTo?: number; // do-not-disturb window end hour (local, exclusive)
  lastPeriodStart?: string; // YYYY-MM-DD of the most recent period start (updated per cycle)
  cycleLengthDays?: number; // typical cycle length; default 28 when omitted
  // What the client agreed to show their trainer on the client card. Absent/false = hidden.
  // Progress/plan/logs are always trainer-visible; only client-owned sensitive data is gated.
  shareWithTrainer?: { body?: boolean; health?: boolean };
}

export type ProgressionRate = "slow" | "normal" | "fast";

export type SessionMode =
  | "idle"
  | "onboarding"
  | "coach"
  | "nutrition"
  | "log"
  | "plan_pending"
  | "measure"
  | "body_edit"
  | "feedback"
  | "role_pick"
  | "trainer_setup"
  | "review_text"
  | "comeback"
  | "vacation_custom"
  | "inact_feedback"
  | "meal_confirm"
  | "meal_item"
  | "food_wt"
  | "food_prod"
  | "trainer_broadcast"
  | "client_code"
  | "client_note"
  | "trainer_note"
  | "trainer_health"
  | "trainer_personal"
  | "trainer_bday"
  | "edit_client_log"
  | "edit_own_log"
  | "edit_own_nutrition"
  | "meal_edit_macros"
  | "goal_weight"
  | "calc_weight"
  | "msg_client"
  | "msg_trainer"
  | "answer_q"
  | "records_alias"
  | "weight_edit"
  | "sets_edit"
  | "swap_custom"
  | "add_exercise"
  | "exercise_confirm"
  | "exercise_alt"
  | "warmup_edit"
  | "steps_log"
  | "cardio_log"
  | "checkin_energy"
  | "checkin_sleep"
  | "checkin_stress"
  | "checkin_adaptive"
  | "mp_allergens"
  | "mp_likes"
  | "mp_dislikes"
  | "video_url"
  | "announce"
  | "tpl_name"
  | "share_myplan_name"
  | "billing_paid"
  | "billing_sessions"
  | "sess_link"
  | "photo_review";

export interface BodyMeasurements {
  waist?: number; // cm
  chest?: number;
  hips?: number;
  arm?: number;
  thigh?: number;
}

export interface TranscriptTurn {
  role: "assistant" | "user";
  text: string;
}

export interface UserSession {
  mode: SessionMode;
  transcript?: TranscriptTurn[];
  targetId?: number; // contextual target (client id, trainer id, or question id)
  retryAfter?: string; // ISO timestamp — scheduler retries the AI call automatically when reached
  lastNudge?: string; // DEPRECATED — moved to users.reminders; kept only for a one-time read fallback
  lastReminders?: Record<string, string>; // DEPRECATED — moved to users.reminders (see UserReminders)
  editPlanOwner?: number; // a trainer/owner is editing THIS user's plan (else self). Used only by plan-edit fns.
  editPlanPrefix?: "cl" | "ou"; // which card owns the edit ("cl" trainer→client, "ou" owner→user) — for the edit-day re-render
  pendingExitResume?: string; // when leaving an unsaved guided log, the nav to run after Save/Discard ("menu:*" or "kbtext:<label>")
  shareTemplate?: number; // "share a program": the template id being assigned
  shareClients?: number[]; // "share a program": client ids selected to receive it
  groupPick?: number[]; // group session: client ids the trainer selected before picking a slot
  lastDeleted?: { ownerId: number; weekday: number; index: number; exercise: PlanExercise }; // for undo
  coachActions?: {
    label: string;
    kind: "add" | "delete" | "swap" | "weight" | "sets" | "harder" | "easier" | "none";
    weekday?: number;
    index?: number;
    exercise?: string;
    value?: string;
  }[];
  checkin?: { energy?: number; sleep?: number }; // partial answers during the /checkin flow
  // Button-guided workout logging (/log): one exercise at a time. "entries" are finished
  // exercises; "cur" is the exercise mid-entry, asking sets → weight → reps as text. Weight
  // and reps apply to every set of that exercise (uniform sets).
  logDraft?: {
    weekday: Weekday;
    date?: string; // target log date (YYYY-MM-DD); absent = today. Set when logging a missed past day.
    entries: { name: string; setsDone: SetEntry[]; rpe?: number }[];
    cur?: {
      name: string;
      metric?: ExerciseMetric; // reps (default) | time | distance — drives which fields are asked
      field: "line" | "sets" | "weight" | "reps" | "seconds" | "meters"; // "line" = one-message compact entry
      sets?: number;
      weight?: number;
      meters?: number;
    };
    editSet?: { entry: number; set: number }; // a just-logged set being corrected via its inline button
    // In-session exercise swaps ("bar taken, give me an alt"). Plan slot index → replacement name.
    // Only lasts for the current draft; the underlying PlanDay is not mutated so tomorrow's
    // session still uses the original exercise unless the user swaps it in plan edit.
    swaps?: Record<number, { name: string; canonicalName?: string }>;
  };
  step?: number; // current step index of the button-based onboarding wizard
  survey?: string; // YYYY-MM-DD the evening survey checklist is active for — re-shows remaining items after each log
  cardio?: string; // chosen cardio exercise name during the guided cardio quick-log (cardio_log mode)
  awaitText?: string; // wizard field currently awaiting a free-text reply (e.g. "limitations")
  pendingVoice?: string; // transcribed voice awaiting user confirmation before it's acted on
  mpAllergens?: string[]; // in-progress allergen multi-select during the meal-plan intake
  pendingVideo?: {
    key: string; // normalized exercise key
    name: string; // exercise display name (for confirmation copy)
    scope: "user" | "global"; // user = personal override; global = trainer/owner sets it for everyone
    ownerId: number; // whose personal override (scope=user) — the viewer's id
  };
  pendingExercise?:
    | {
        action: "swap" | "add";
        weekday: Weekday;
        index?: number;
        query: string;
        englishQuery: string;
        catalogId?: string;
      }
    | undefined;
  trainerDraft?: TrainerProfileInput; // in-progress answers during the trainer profile wizard
  editField?: string; // when editing a single trainer-profile field, which one (else full wizard)
  reviewRating?: number; // chosen star rating awaiting an optional comment (review_text mode)
  comeback?: { step: number; answers: Record<string, string> }; // post-vacation comeback interview
  // A photo/text meal awaiting the user's confirmation (verify the dish & portion before logging).
  pendingMeal?: { desc: string; query: string; grams: number; kcal: number; protein: number; fats: number; carbs: number }[];
  recentFoods?: MealEntry[]; // recent foods offered for one-tap re-log (index → item)
  photoReviewFor?: number; // trainer id awaiting this client's next photo (progress-photo review)
  photoSelf?: boolean; // self-serve "📸 progress photo" flow: the next photo goes to the gallery
}

/** Trainer-authored profile fields collected by the wizard and persisted to the trainers table. */
export interface TrainerProfileInput {
  name?: string;
  bio?: string;
  specialization?: string;
  tags?: string[]; // canonical specialization codes
  certifications?: string;
  experienceYears?: number;
  approach?: string;
  priceOnline?: number;
  priceOffline?: number;
  currency?: "UAH" | "USD" | "EUR";
  city?: string;
  contact?: string;
  languages?: string[]; // canonical language codes: uk | en | ru
  photoFileId?: string;
  profileComplete?: boolean;
}

// Scheduler-owned reminder dedup state. Lives in its own users.reminders column (NOT in session)
// so user-facing session writes can't wipe it.
export interface UserReminders {
  sent?: Record<string, string>; // reminder_type → YYYY-MM-DD, deduplicates daily reminders
  lastNudge?: string; // YYYY-MM-DD — last date a stuck-onboarding nudge was sent
  lastLevel?: number; // last celebrated XP level — a new log crossing it triggers the level-up message
  prCount?: number; // lifetime count of personal records set — drives PR-milestone badges
  lastVacation?: { from: string; until: string }; // most recent vacation window (freezes the week streak)
  lastRank?: number; // last weekly consistency-board rank — rank-change pushes compare against it
}

export interface UserDoc {
  _id: number; // telegram user id
  chatId: number;
  username?: string; // telegram @username (no @), captured on interaction; may be absent
  lang: Lang;
  onboarded: boolean;
  role: Role;
  trainerId?: number; // for clients: their trainer's user id
  competeOptIn?: boolean; // joined the global leaderboards
  alias?: string; // board display name; undefined = profile name, "" = anonymous
  profile: UserProfile;
  nutrition?: NutritionTargets;
  session: UserSession;
  reminders?: UserReminders; // scheduler dedup state, decoupled from session
  progressionRate?: ProgressionRate; // system-computed training pace (weekly)
  blocked?: boolean; // owner banned this user — the bot stops serving them
  botBlocked?: boolean; // the user blocked the bot (detected from a 403 on send)
  flagged?: boolean; // trainer marked this client as needing attention (shown in the digest)
  lastSeenAt?: Date; // last GENUINE user interaction (set in ingress, never by cron) — the only inactivity signal
  vacationUntil?: Date; // while now < this, the scheduler sends nothing (don't disturb)
  comebackDone?: Date; // last handled vacation-end (dedups the comeback interview)
  inactiveAskedAt?: Date; // when the owner-triggered "still here?" ask was sent (ask once)
  inactiveReply?: string; // 'leaving' = user asked to be removed; else undefined
  createdAt: Date;
  updatedAt: Date;
}

export interface AchievementDoc {
  userId: number;
  code: string;
  earnedAt: Date;
}

/** One plan swap made to accommodate an injury (so it can be restored on recovery). */
export interface InjurySwap {
  weekday: number;
  index: number;
  original: PlanExercise;
  replacementCanonical: string; // canonical/display name we put in the slot
}

export interface InjuryDoc {
  id: number;
  userId: number;
  area: string;
  severity: string; // mild | strong
  status: "active" | "recovered";
  reportedAt: string; // ISO
  checkAfter: string; // YYYY-MM-DD local
  lastAskedAt: string | null; // YYYY-MM-DD local
  swaps: InjurySwap[];
  resolvedAt: string | null;
  // Pain-score history for the "how has my knee trended?" view. Each entry is one follow-up.
  // Score 0..10 (0 = fully OK, 10 = severe). Migration 0046 backs this column.
  checkinsHistory: { date: string; score: number }[];
}

/** Trainer-authored notes about one client (migration 0047). All fields optional — the row
 * is created the first time the trainer writes any of them. */
export interface ClientCardDoc {
  trainerId: number;
  clientId: number;
  healthNotes: string | null;
  personalNotes: string | null;
  birthday: string | null; // 'YYYY-MM-DD' or 'MM-DD' (year unknown)
  updatedAt: string;
}

export interface TrainerDoc {
  trainerId: number;
  status: "pending" | "approved" | "rejected";
  inviteCode?: string;
  name: string;
  bio?: string;
  accepting: boolean;
  createdAt: Date;
  approvedAt?: Date;
  // Rich profile (migration 0025)
  specialization?: string;
  tags?: string[];
  certifications?: string;
  experienceYears?: number;
  approach?: string;
  priceOnline?: number;
  priceOffline?: number;
  currency?: "UAH" | "USD" | "EUR";
  city?: string;
  contact?: string;
  languages?: string[];
  photoFileId?: string;
  profileComplete: boolean;
  ratingAvg?: number; // undefined when no reviews yet
  ratingCount: number;
  maxClients?: number; // client capacity; undefined = unlimited. Full roster → new requests waitlist.
  isInstructor?: boolean; // owner-granted: can share programs broadly (assign to own clients / link / library)
}

export interface TrainerReviewDoc {
  id: number;
  trainerId: number;
  clientId: number;
  rating: number; // 1..5
  text?: string;
  createdAt: Date;
}

export interface SessionDoc {
  id: number;
  trainerId: number;
  clientId: number;
  date: string; // YYYY-MM-DD local
  hour: number; // 0..23
  kind: "offline" | "online";
  status: "proposed" | "confirmed" | "declined" | "cancelled" | "done";
  proposedBy: "trainer" | "client";
  note: string | null;
  remindedAt: string | null;
  createdAt: string;
  tz: string | null; // IANA zone the (date, hour) was booked in; NULL = v1 same-city assumption
  groupId?: string; // shared id for group/semi-private sessions (one row per participant)
  meetingLink: string | null; // optional online-session link, set by the trainer on confirm
}

export interface ClientRequestDoc {
  id: number;
  clientId: number;
  trainerId: number;
  note?: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: Date;
}

export interface ClientQuestionDoc {
  id: number;
  clientId: number;
  trainerId: number;
  text: string;
  aiDraft?: string;
  status: "pending" | "answered" | "dismissed";
  createdAt: Date;
}

export interface NutritionTargets {
  calories: number;
  protein: number;
  fats: number;
  carbs: number;
  notes?: string;
}

export interface PlanExercise {
  name: string;
  sets: string; // "4 × 8–10"
  startWeight: string; // "50 kg" / "Bodyweight"
  technique: string;
  isKeyLift?: boolean; // tracked for strength progression
  metric?: ExerciseMetric; // how it's measured/progressed (default "reps"); set for planks/cardio
  muscles?: string; // primary muscles (AI-provided)
  exerciseId?: string; // catalog id (API Ninjas), if grounded in the real catalog
  canonicalName?: string; // canonical English name (for log matching + info lookup)
  // Professional programming fields (promt.txt) — short/universal, rendered as-is.
  rpe?: string; // target RPE, e.g. "8"
  rir?: string; // target RIR, e.g. "2"
  // How the logged weight is meant: "perSide" = one arm/leg at a time (unilateral, e.g. one-arm
  // cable row), "perHand" = the weight of ONE dumbbell in a two-dumbbell exercise. Absent =
  // total/bilateral load (barbell, machine). Number is always stored/compared AS ENTERED; this
  // only drives the display label, AI context and strength-standard matching. Absent → inferred
  // from the exercise name (resolveWeightMode).
  weightMode?: "perSide" | "perHand";
  rest?: string; // rest between sets, e.g. "90s"
  tempo?: string; // e.g. "3-1-1"
  heartRateZone?: string; // for cardio/conditioning, e.g. "Z2"
  movementPattern?: string; // squat|hinge|push|pull|carry|core|cardio… (for coverage)
  role?: "primary" | "accessory"; // compound key lift vs isolation/accessory (deload logic)
  warmupScheme?: string; // per-exercise load ramp, e.g. "50%×5, 70%×3, working set"
  supersetGroup?: string; // shared label (A/B/C) pairs exercises into a superset
}

export interface PlanDay {
  weekday: Weekday;
  muscleGroup: string;
  exercises: PlanExercise[];
  sessionType?: string; // strength|hypertrophy|conditioning|mobility|hybrid|active-recovery
  durationMin?: number; // estimated session duration in minutes
  warmUp?: string[]; // short warm-up steps (e.g. "5 min bike Z2", "band pull-aparts ×15")
  coolDown?: string[]; // short cool-down / mobility steps
}

export interface Supplement {
  name: string;
  dose: string;
  when: string;
  effect: string;
}

export interface PlanDoc {
  userId: number;
  active: boolean;
  status: "draft" | "active";
  authoredBy?: number; // trainer id, or undefined = AI
  split: PlanDay[];
  nutrition: NutritionTargets;
  supplements: Supplement[];
  methodology: string;
  generatedAt: Date;
  stepsTarget?: number; // daily NEAT steps target
  restDayNutrition?: NutritionTargets; // lower-carb/calorie macros for non-training days
  movementAudit?: string; // one-line weekly movement-pattern coverage summary
  deloadInterval?: number; // weeks between automatic deload weeks (default 4)
  mesocycle?: import("./domain/mesocycle").Mesocycle; // opt-in block periodization overlay
}

// ---- Plan bank (pre-generated, zero-AI selection) ----

/** Normalized goal bucket the plan bank is keyed on (free-text goal → one of these). */
export type GoalBucket = "fatloss" | "muscle" | "recomp" | "strength" | "endurance";
/** Training-frequency bucket: 2-3 / 4 / 5-6 days per week. */
export type DaysBucket = "d23" | "d4" | "d56";
export type EquipmentBucket = "gym" | "home";

/** The five dimensions that select a bank archetype. */
export interface PlanBankKey {
  goal: GoalBucket;
  level: ExperienceLevel;
  daysBucket: DaysBucket;
  sex: "male" | "female";
  equipment: EquipmentBucket;
}

/** The JSON payload stored in plan_bank.plan — a PlanDoc minus the per-user fields
 * (userId/active/status/authoredBy/generatedAt), which are filled when adapted+saved. */
export interface BankPlan {
  split: PlanDay[];
  nutrition: NutritionTargets; // baseline for a reference body; recomputed per user on adapt
  restDayNutrition?: NutritionTargets;
  supplements: Supplement[];
  methodology: string;
  movementAudit?: string;
  stepsTarget?: number;
}

/** Stored plan grounded in BOTH languages (exercise names/technique from the translation
 * cache, structural text from the hand-authored archetypes) so the runtime never translates. */
export interface LocalizedBankPlan {
  en: BankPlan;
  uk: BankPlan;
}

/** One plan_bank row: the selection key + variant + the stored bilingual plan. */
export interface PlanBankEntry extends PlanBankKey {
  id: string;
  variant: number;
  plan: LocalizedBankPlan;
}

/** How an exercise is measured & progressed: classic weight×reps, an isometric/timed hold
 * (plank, dead hang), or distance/duration cardio (rowing machine, run). */
export type ExerciseMetric = "reps" | "time" | "distance";

export interface SetEntry {
  reps: number;
  weight: number; // kg; 0 = bodyweight
  seconds?: number; // work/hold duration for time-based exercises (plank, rowing-for-time)
  meters?: number; // distance for cardio (rowing, run, ski-erg)
  rpe?: number; // 0..10, per-set effort (from text log "@8" or the tap UI); the exercise-level rpe is still max()
}

export interface LoggedExercise {
  name: string;
  setsDone: SetEntry[];
  skipped: boolean;
  rpe?: number; // logged session RPE (rate of perceived exertion), drives autoregulation
}

export interface WorkoutLogDoc {
  userId: number;
  date: string; // YYYY-MM-DD local
  weekday: Weekday;
  exercises: LoggedExercise[];
  completed: boolean;
  notes?: string;
  createdAt: Date;
}

export interface MealEntry {
  desc: string;
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
  grams?: number; // portion (g) — enables in-place weight editing (recompute by scaling); optional for legacy rows
  query?: string; // canonical English food name (kept for possible re-lookup)
}

export interface NutritionLogDoc {
  userId: number;
  date: string; // YYYY-MM-DD local
  meals: MealEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StrengthRecordDoc {
  userId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  bestSeconds: number; // longest hold / timed work (time metric); 0 if none
  bestMeters: number; // farthest distance (distance metric); 0 if none
  metric: ExerciseMetric; // which axis this record is tracked on
  history: { date: string; weight: number; reps: number; seconds?: number; meters?: number; rpe?: number }[];
  updatedAt: Date;
}

export interface BodyLogDoc {
  userId: number;
  date: string; // YYYY-MM-DD local
  weight?: number; // kg
  measurements?: BodyMeasurements;
  createdAt: Date;
}

export interface StepLogDoc {
  userId: number;
  date: string; // YYYY-MM-DD local
  steps: number;
  createdAt: Date;
}

export interface DailyCheckinDoc {
  userId: number;
  date: string; // YYYY-MM-DD local
  energy: number; // 1-5
  sleep: number; // 1-5
  stress: number; // 1-5
  createdAt: Date;
}

export interface PlanAdjustmentDoc {
  userId: number;
  week: number; // weeks since plan start when applied
  changes: string; // JSON describing the micro-adjustment
  ts: Date;
}

export interface CatalogExercise {
  id: string; // hash(lower(name))
  name: string; // canonical English
  type?: string;
  muscle: string; // API enum
  difficulty?: string; // beginner | intermediate | expert
  equipments: string[];
  instructions: string;
  safetyInfo: string;
}

export interface ExerciseTranslation {
  name: string;
  instructions: string;
  safetyInfo: string;
}

// One cached YouTube technique short per exercise. `videoId`/`url` are null when the search
// found no acceptable video (negative cache). `locked` marks a manual trainer/owner override.
export interface ExerciseVideo {
  normalizedName: string;
  exerciseName: string;
  videoId: string | null;
  url: string | null;
  title: string | null;
  channelName: string | null;
  thumbnailUrl: string | null;
  locked: boolean;
}

export interface ConfigDoc {
  _id: string; // "config"
  ownerChatId?: number;
}

export interface SeenUpdateDoc {
  _id: number; // telegram update_id
  createdAt: Date;
}

export interface FeedbackDoc {
  userId: number;
  username?: string;
  text: string;
  date: string;
  createdAt: Date;
}

export type AiProvider = "gemini" | "groq" | "ollama" | "openrouter" | "workersai";
export type AiKind = "interview" | "plan" | "translate" | "nutrition" | "nutrition_photo" | "coach" | "progress" | "report" | "meal_plan";

// AI nutritionist: a generated day menu grounded in USDA/OFF.
export interface MealItem {
  food: string; // English canonical food name (translated for display)
  grams: number;
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}
export interface Meal {
  name: string; // "Breakfast" / "Lunch" / … (localized at render)
  items: MealItem[];
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}
export interface MealPlanDoc {
  userId: number;
  week: number; // 0 = current day menu (weekly chunking can use 1..N later)
  days: { label: string; meals: Meal[] }[];
  targets: NutritionTargets;
  generatedAt: Date;
}

export interface AiUsageDoc {
  userId?: number;
  provider: AiProvider;
  kind: AiKind;
  model: string;
  ok: boolean;
  date: string; // YYYY-MM-DD (UTC)
  ts: Date;
}

export interface AiCallLogDoc {
  userId?: number;
  provider: AiProvider;
  kind: AiKind;
  latencyMs: number;
  tokens?: number; // null until providers expose usage metadata
  wasFallback: boolean; // true for any attempt after the first provider in the chain
  ts: Date;
}
