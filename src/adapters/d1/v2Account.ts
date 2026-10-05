// Account erasure (/deleteme, owner delete, cleanup of blocked accounts). Moved out of the legacy
// repo layer (src/db/repos, removed): every row the app reads lives in v2_* tables, which is what
// the v2 statements below clear. The pre-v2 tables are still DELETEd from until they are dropped
// -- they hold old copies of the same personal data, and a deletion request covers those too.
// legacyFreeze.ts lets DELETEs through for exactly this reason. When a new table gets an
// accountId/userId/trainerId/clientId/ownerId column, add it here (test/delete-user-data-coverage).
import type { Env } from "../../types";
import { r2Key } from "../../webapp/photoStorage";
import { logError } from "../../log";
import { nowIso } from "./shared";

export async function deleteUserData(env: Env, userId: number): Promise<void> {
  const db = env.DB;
  // If this account is a trainer, its remaining clients would otherwise be left forever pointing
  // at a now-nonexistent trainerId (role='client', nothing to route through) — unlink them first,
  // same as unlinkClient() does when a client leaves on their own.
  const clientRows = await db.prepare("SELECT clientId FROM v2_trainer_relationships WHERE trainerId = ?").bind(userId).all<{ clientId: number }>();
  const clientIds = (clientRows.results ?? []).map((r) => r.clientId);

  // Progress photos cached in R2 are addressed by v2_progress_photos.id, not by userId — the
  // DELETE statement below removes the rows that NAME that id, but nothing removes the R2 object
  // itself. Read the ids and clear the bucket BEFORE the batch deletes the rows that reveal them.
  // Best-effort: an R2 outage must not block the rest of GDPR erasure, but it must not go unlogged
  // either, or an orphaned photo becomes invisible instead of merely rare.
  if (env.R2_PHOTOS) {
    const photoRows = await db.prepare("SELECT id FROM v2_progress_photos WHERE accountId = ?").bind(userId).all<{ id: number }>();
    const keys = (photoRows.results ?? []).map((r) => r2Key(r.id));
    for (let i = 0; i < keys.length; i += 1000) {
      // R2 batch delete caps at 1000 keys per call (photoStorage.ts's enforceStorageBudget uses
      // the same chunking for the same reason).
      await env.R2_PHOTOS.delete(keys.slice(i, i + 1000)).catch((e) =>
        logError("delete_user_data_r2", e, { userId, keys: keys.length }),
      );
    }
  }

  const statements = [
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    db.prepare("DELETE FROM plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM workout_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM nutrition_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM strength_records WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM body_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM step_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM progress_photos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM water_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM challenges WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM injuries WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM client_notes WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_cards WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM daily_checkins WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_adjustments WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM achievements WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM meal_plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM user_exercise_videos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM event_counts WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM feedback WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM trainers WHERE trainerId = ?").bind(userId),
    db.prepare("DELETE FROM client_requests WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_questions WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM messages WHERE fromId = ? OR toId = ?").bind(userId, userId),
    // Per-user telemetry — /deleteme means ALL personal rows, not just product data.
    // (admin_audit is intentionally kept: it's the owner's action trail, not user data.)
    db.prepare("DELETE FROM ai_usage WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM ai_call_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM error_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_source_logs WHERE userId = ?").bind(userId),
    // Tables added after this function was first written — each of these has been found missing
    // here at least once in review. When a new table gets a userId/trainerId/ownerId column, add
    // its delete here too.
    db.prepare("DELETE FROM rest_timers WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM trainer_templates WHERE trainerId = ?").bind(userId),
    db.prepare("DELETE FROM shared_programs WHERE ownerId = ?").bind(userId),
    db.prepare("DELETE FROM trainer_prospects WHERE trainerId = ?").bind(userId),
    db.prepare("DELETE FROM food_corrections WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM client_note_history WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
    db.prepare("DELETE FROM squad_members WHERE userId = ?").bind(userId),
    // source is checked alongside entityId: entityId is polymorphic (userId for 'user'
    // rows, a squad chatId for 'squad' rows) and Telegram user ids and group chat ids
    // occupy overlapping numeric ranges, so entityId alone is not a safe match.
    db.prepare("DELETE FROM scheduler_dryrun_log WHERE source = 'user' AND entityId = ?").bind(userId),
    db.prepare("DELETE FROM idempotency_keys WHERE userId = ?").bind(userId),
     db.prepare("DELETE FROM plan_change_log WHERE userId = ?").bind(userId),
     db.prepare("DELETE FROM notification_outbox WHERE userId = ?").bind(userId),
     // v2 is a projection of the legacy account, so deleting the account must remove its
     // projection as well. Child rows cascade from v2_accounts; audit rows need an explicit
     // decision because they intentionally do not have a foreign key cascade.
     db.prepare("DELETE FROM v2_audit_events WHERE actorId = ? OR targetId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_trainer_relationships WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_preferences WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_onboarding WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_plan_changes WHERE accountId = ? OR actorId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_workout_cardio_metrics WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_nutrition_corrections WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_activity_days WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_water_logs WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_step_logs WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_injuries WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_progress_photos WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_trainer_requests WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_trainer_questions WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_messages WHERE fromAccountId = ? OR toAccountId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_trainer_templates WHERE trainerId = ?").bind(userId),
     db.prepare("DELETE FROM v2_trainers WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_client_cards WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_client_notes WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
     // v2_client_note_history/v2_shared_programs: added by migrations/0077_v2_trainer_complete.sql
     // (Domain 7) -- new user-identifying tables, so deleteUserData must cover them too (enforced
     // by test/delete-user-data-coverage.test.ts).
     db.prepare("DELETE FROM v2_client_note_history WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_shared_programs WHERE ownerId = ?").bind(userId),
     // Trainer schedule/money: migrations/0082_v2_trainer_schedule_finance.sql. Both sides are
     // user-identifying (a session names its client, a payment names who paid), so a deletion
     // has to clear rows where the user is EITHER party, not just the trainer.
     db.prepare("DELETE FROM v2_trainer_sessions WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_trainer_payments WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_trainer_prospects WHERE trainerId = ?").bind(userId),
     db.prepare("DELETE FROM v2_achievements WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_challenges WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_leaderboard_entries WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_buddies WHERE accountId = ? OR buddyAccountId = ?").bind(userId, userId),
     db.prepare("DELETE FROM v2_squad_members WHERE accountId = ?").bind(userId),
     db.prepare("UPDATE v2_squads SET createdByAccountId = NULL WHERE createdByAccountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_idempotency WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_ai_calls WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_error_events WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_analytics_events WHERE accountId = ?").bind(userId),
     // v2_feedback/v2_ai_usage/v2_plan_source_logs/v2_rest_timers: added by
     // migrations/0081_v2_admin_complete.sql (Domain 9) -- new user-identifying tables, so
     // deleteUserData must cover them too (enforced by test/delete-user-data-coverage.test.ts;
     // same pattern Domain 7 used for v2_client_note_history/v2_shared_programs above).
     db.prepare("DELETE FROM v2_feedback WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_ai_usage WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_plan_source_logs WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_rest_timers WHERE accountId = ?").bind(userId),
     db.prepare("DELETE FROM v2_accounts WHERE id = ? OR legacyUserId = ?").bind(userId, userId),
     // A squad outlives the person who happened to run /squad first: the group chat and everyone
    // else in it are unaffected, so createdBy is cleared to a tombstone rather than the squad
    // being deleted out from under its remaining members.
    db.prepare("DELETE FROM squads WHERE chatId NOT IN (SELECT chatId FROM squad_members)").bind(),
    db.prepare("DELETE FROM v2_squads WHERE id NOT IN (SELECT squadId FROM v2_squad_members)").bind(),
    // Attribution only (nullable, no code treats it as a live FK) — a deleted trainer's
    // previously-authored plans just stop being credited to them instead of pointing at a ghost.
    db.prepare("UPDATE v2_plans SET authoredBy = NULL WHERE authoredBy = ?").bind(userId),
  ];
  for (const clientId of clientIds) {
    // Same as unlinkClient() (v2Trainer.ts): the relationship rows go with the batch above.
    statements.push(db.prepare("UPDATE v2_accounts SET role='solo', updatedAt=? WHERE id=? AND role='client'").bind(nowIso(), clientId));
    statements.push(db.prepare("UPDATE v2_plans SET active=0 WHERE accountId=? AND active=1").bind(clientId));
  }
  await db.batch(statements);
}
