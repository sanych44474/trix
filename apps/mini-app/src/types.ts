// This app's central shared types, sourced from the OpenAPI contract instead of hand-declared --
// packages/contracts/openapi.yaml is now the single source of truth for every /api/v2/* response
// shape (verified against the real src/webapp/*.ts handlers), and this file only re-exports or
// derives from its generated output. Run `npm run generate:contracts` (from the repo root) after
// editing the spec, before `npm run typecheck:webapp` -- a stale packages/contracts/generated.ts
// will typecheck against yesterday's contract, not today's.
//
// View-LOCAL response types (declared inline inside App.tsx/Workspace.tsx/etc. for a single
// screen's own fetch) are NOT centralized here -- that split is a deliberate, pre-existing
// convention of this app (see e.g. Workspace.tsx's own comment on ClientCardPayload), not
// something this contract migration changes.
import type { components } from "../../../packages/contracts/generated";

type Schemas = components["schemas"];

export interface V2Envelope<T> {
  data: T;
  meta?: { version: 2; requestId?: string };
}

export interface V2Failure {
  error: { code: string; message: string; requestId?: string };
}

export type Dashboard = Schemas["Dashboard"];
export type WorkoutToday = Schemas["WorkoutToday"];
export type WorkoutHistoryItem = Schemas["WorkoutHistoryItem"];
export type WorkoutCopyExercise = Schemas["WorkoutCopyExercise"];
export type Plan = Schemas["Plan"];
export type Nutrition = Schemas["Nutrition"];
export type ProfilePayload = Schemas["ProfilePayload"];
export type SettingsPayload = Schemas["SettingsPayload"];
export type BuddyInfo = Schemas["BuddyInfo"];
export type ChallengesPayload = Schemas["ChallengesPayload"];
export type InjuryPayload = Schemas["InjuryPayload"];
export type BoardsPayload = Schemas["BoardsPayload"];
export type RecordsPayload = Schemas["RecordsPayload"];
export type WeekCardStats = NonNullable<Schemas["WeekCardResponse"]["stats"]>;
export type WeekCardResponse = Schemas["WeekCardResponse"];
export type PlatesResponse = Schemas["PlatesResponse"];
export type LibraryProgram = Schemas["LibraryResponse"]["programs"][number];
export type LibraryResponse = Schemas["LibraryResponse"];
export type SquadInfo = Schemas["SquadInfo"];
export type SquadEntry = Schemas["SquadInfo"]["entries"][number];
export type TrainerRequest = Schemas["TrainerRequest"];
// What /api/v2/trainer/profile's GET returns for the caller's own v2_trainers row (null = never
// applied). Was a separate, narrower hand-typed `TrainerApplication` before this contract existed
// -- App.tsx's own copy didn't declare approach/experienceYears/priceOnline/accepting even though
// the backend always returns them (same route Workspace.tsx's richer edit screen already used).
export type TrainerProfile = Schemas["TrainerProfile"];
export type TrainerQuestion = Schemas["TrainerQuestion"];
export type TrainerTemplate = Schemas["TrainerTemplate"];
export type SchedulePayload = Schemas["SchedulePayload"];
export type FinancePayload = Schemas["FinancePayload"];
export type CoachThread = Schemas["CoachThread"];
export type ClientCardPayload = Schemas["ClientCardPayload"];
export type OwnerUsers = Schemas["OwnerUsers"];

export interface ProfilePhoto {
  id: number;
  takenAt: string;
}

export interface WorkoutCopySet {
  w: number;
  r: number;
  sec: number;
  m: number;
}

export interface FoodSearchItem {
  name: string;
  brand?: string;
  per100: { kcal: number; p: number; f: number; c: number };
}

// Mirrors src/domain/analysis.ts / src/domain/progression.ts -- codes, not prose. Derived by
// indexed access rather than hand-declared, so a new zone/group added to the domain and threaded
// through the contract shows up here automatically on the next `generate:contracts`.
export type MuscleGroup = Dashboard["volume"][number]["group"];
export type VolumeZone = Dashboard["volume"][number]["zone"];

// Mirrors src/domain/recovery.ts -- codes, not prose, so the UI renders them in the viewer's language.
export type RecoveryLabel = Dashboard["recovery"]["label"];
export type RecoveryFactor = Schemas["RecoveryFactor"];
export type RecoveryFactorCode = RecoveryFactor["code"];

// Mirrors src/domain/mesocycle.ts.
export type MesoPhase = NonNullable<Plan["mesocycle"]>["phase"];
export type Mesocycle = NonNullable<Plan["mesocycle"]>;
