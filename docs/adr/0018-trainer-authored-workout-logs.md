# ADR-0018: a trainer can log a client's workout, and speak commands about the client

- Status: accepted
- Date: 2026-11-23

## Context

A trainer who runs a session in person writes the client's sets down somewhere else, because only
the client could log their own workout: every `/workout/*` route acts on the signed-in account. The
trainer could already edit the client's plan (`/api/v2/plan?clientId=`), but not record what was
done. The owner also asked for voice control, so a trainer with a phone in one hand and a stopwatch
in the other can say the sets, or a plan change, instead of typing.

## Decision

- **Another account may write the client's log: their own trainer.** `GET/POST /api/v2/trainer/log`
  (`src/webapp/trainerLogApi.ts`) take `clientId`; access is the same as every trainer route (a
  trainer, and `getClientForTrainer`, so "not yours" is a 404). The day is checked against the
  CLIENT's calendar (`domain/editWindow.ts`: today back to 14 days in the client's timezone).
- **It counts in full.** The save runs the client's own path (`saveWorkout` → `completeWorkout`):
  records, level, badges, plan-weight adoption, the squad PR post. Two things differ: the trainer
  is not sent "your client trained" about their own log, and the client's unsaved draft is left
  alone. The client is told once per day (`trainer_logged_workout`, Telegram or push). The save is
  audited (`log_workout`).
- **The last writer owns the day.** `v2_workout_sessions.loggedBy` (migration 0109) holds the
  trainer's id, overwritten on every save, so the client re-saving the day clears it. It is
  attribution only, like `v2_plans.authoredBy`, and is cleared when the trainer's account is deleted.
  Both apps show "by trainer" in the client's history and on the day.
- **No blind overwrite.** The trainer's form is built from the day as loaded (`savedAt`) and sent
  back as `baseSavedAt`; if the day was saved since, the save is refused (409 `stale`) and the form
  reloads with what the client logged. No server-side merge: deciding whose sets are whose is the
  trainer's call, made on the screen.
- **Online only.** The trainer's form does not use the device's offline queue (that queue is the
  signed-in person's own saves) nor the client's draft. The version check above is what makes a
  late save safe; an offline replay would bypass it.
- **Voice is a proposal, never an action.** `POST /api/v2/trainer/voice` turns text (the apps
  transcribe speech first: on-device recognition, else `/media/transcribe`) into either workout
  entries for the form or plan-edit actions. Plain set dictation is parsed without the AI
  (`domain/trainerVoice.ts quickWorkoutProposal`); anything else is one `aiJSON` call, charged to the
  trainer's AI allowance and validated before it is shown. Workout entries go into the form and the
  trainer saves; plan actions are applied one by one through the existing plan editor (`POST
  /api/v2/plan` with `clientId`, `expectName` and `If-Match`), in an order that never shifts a later
  index, so injury checks, stale-plan checks and plan history apply as for a manual edit.
- **The model sees only what the trainer may see.** Its context (`features/trainer/trainerVoiceContext.ts`)
  is the plan, 14 days of workouts and the progression targets. Health limitations are included only
  when the client shares health data with the trainer; cycle phase, nutrition and the daily check-in
  never are.
- **The bot chat stays retired** (ADR-0012). The bot's part is the notification to the client.
- **Transcription now spends the per-user AI allowance** (`admitAiCall`), which it skipped before.

## Consequences

- A client can see that a day was logged by their trainer, and fixing it themselves takes the day
  back.
- A client's own offline save replayed later the same day still replaces the trainer's log (their
  queue predates this check). Accepted for now; the trainer sees it on the next open.
- Plan edits made by a trainer (by hand or by voice) still notify nobody, as before.
