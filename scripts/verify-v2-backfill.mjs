// Compare the legacy source tables with the v2 projection after migration 0069.
// Usage: node scripts/verify-v2-backfill.mjs --local (default) or --remote
import { execSync } from "node:child_process";

const target = process.argv.includes("--remote") ? "--remote" : "--local";

function d1(sql) {
  const out = execSync(`npx wrangler d1 execute trix ${target} --json --command "${sql}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

const checks = [
  ["accounts", "SELECT (SELECT COUNT(*) FROM users) AS legacy, (SELECT COUNT(*) FROM v2_accounts) AS v2"],
  ["plans", "SELECT (SELECT COUNT(*) FROM plans) AS legacy, (SELECT COUNT(*) FROM v2_plans) AS v2"],
  ["plan days", "SELECT (SELECT COUNT(*) FROM plans p, json_each(p.split)) AS legacy, (SELECT COUNT(*) FROM v2_plan_days) AS v2"],
  ["plan exercises", "SELECT (SELECT COUNT(*) FROM plans p, json_each(p.split) d, json_each(json_extract(d.value, '$.exercises'))) AS legacy, (SELECT COUNT(*) FROM v2_plan_exercises) AS v2"],
  ["workout sessions", "SELECT (SELECT COUNT(*) FROM workout_logs) AS legacy, (SELECT COUNT(*) FROM v2_workout_sessions) AS v2"],
  ["workout exercises", "SELECT (SELECT COUNT(*) FROM workout_logs w, json_each(w.exercises)) AS legacy, (SELECT COUNT(*) FROM v2_workout_exercises) AS v2"],
  ["workout sets", "SELECT (SELECT COUNT(*) FROM workout_logs w, json_each(w.exercises) e, json_each(json_extract(e.value, '$.setsDone'))) AS legacy, (SELECT COUNT(*) FROM v2_workout_sets) AS v2"],
  ["nutrition days", "SELECT (SELECT COUNT(*) FROM nutrition_logs) AS legacy, (SELECT COUNT(*) FROM v2_nutrition_days) AS v2"],
  ["nutrition entries", "SELECT (SELECT COUNT(*) FROM nutrition_logs n, json_each(n.meals)) AS legacy, (SELECT COUNT(*) FROM v2_nutrition_entries) AS v2"],
  ["measurements", "SELECT (SELECT COUNT(*) FROM body_logs) AS legacy, (SELECT COUNT(*) FROM v2_measurements) AS v2"],
  ["wellbeing", "SELECT (SELECT COUNT(*) FROM daily_checkins) AS legacy, (SELECT COUNT(*) FROM v2_wellbeing) AS v2"],
  ["water logs", "SELECT (SELECT COUNT(*) FROM water_logs) AS legacy, (SELECT COUNT(*) FROM v2_water_logs) AS v2"],
  ["step logs", "SELECT (SELECT COUNT(*) FROM step_logs) AS legacy, (SELECT COUNT(*) FROM v2_step_logs) AS v2"],
  ["food references", "SELECT (SELECT COUNT(*) FROM food_cache) AS legacy, (SELECT COUNT(*) FROM v2_food_references) AS v2"],
  ["trainer profiles", "SELECT (SELECT COUNT(*) FROM trainers) AS legacy, (SELECT COUNT(*) FROM v2_trainers) AS v2"],
  ["client cards", "SELECT (SELECT COUNT(*) FROM client_cards) AS legacy, (SELECT COUNT(*) FROM v2_client_cards) AS v2"],
  ["client notes", "SELECT (SELECT COUNT(*) FROM client_notes) AS legacy, (SELECT COUNT(*) FROM v2_client_notes) AS v2"],
  ["preferences", "SELECT (SELECT COUNT(*) FROM users) AS legacy, (SELECT COUNT(*) FROM v2_preferences) AS v2"],
  ["onboarding", "SELECT (SELECT COUNT(*) FROM users) AS legacy, (SELECT COUNT(*) FROM v2_onboarding) AS v2"],
  ["plan changes", "SELECT (SELECT COUNT(*) FROM plan_change_log) AS legacy, (SELECT COUNT(*) FROM v2_plan_changes) AS v2"],
  ["nutrition corrections", "SELECT (SELECT COUNT(*) FROM food_corrections) AS legacy, (SELECT COUNT(*) FROM v2_nutrition_corrections) AS v2"],
  ["activity days", "SELECT (SELECT COUNT(*) FROM (SELECT userId, date FROM step_logs UNION SELECT userId, date FROM water_logs)) AS legacy, (SELECT COUNT(*) FROM v2_activity_days) AS v2"],
  ["injuries", "SELECT (SELECT COUNT(*) FROM injuries) AS legacy, (SELECT COUNT(*) FROM v2_injuries) AS v2"],
  ["progress photos", "SELECT (SELECT COUNT(*) FROM progress_photos) AS legacy, (SELECT COUNT(*) FROM v2_progress_photos) AS v2"],
  ["trainer requests", "SELECT (SELECT COUNT(*) FROM client_requests) AS legacy, (SELECT COUNT(*) FROM v2_trainer_requests) AS v2"],
  ["trainer questions", "SELECT (SELECT COUNT(*) FROM client_questions) AS legacy, (SELECT COUNT(*) FROM v2_trainer_questions) AS v2"],
  ["messages", "SELECT (SELECT COUNT(*) FROM messages) AS legacy, (SELECT COUNT(*) FROM v2_messages) AS v2"],
  ["trainer templates", "SELECT (SELECT COUNT(*) FROM trainer_templates) AS legacy, (SELECT COUNT(*) FROM v2_trainer_templates) AS v2"],
  ["achievements", "SELECT (SELECT COUNT(*) FROM achievements) AS legacy, (SELECT COUNT(*) FROM v2_achievements) AS v2"],
  ["challenges", "SELECT (SELECT COUNT(*) FROM challenges) AS legacy, (SELECT COUNT(*) FROM v2_challenges) AS v2"],
  ["squads", "SELECT (SELECT COUNT(*) FROM squads) AS legacy, (SELECT COUNT(*) FROM v2_squads) AS v2"],
  ["squad members", "SELECT (SELECT COUNT(*) FROM squad_members) AS legacy, (SELECT COUNT(*) FROM v2_squad_members) AS v2"],
  ["notification attempts", "SELECT (SELECT COUNT(*) FROM notification_outbox) AS legacy, (SELECT COUNT(*) FROM v2_notification_attempts) AS v2"],
  ["idempotency", "SELECT (SELECT COUNT(*) FROM idempotency_keys) AS legacy, (SELECT COUNT(*) FROM v2_idempotency) AS v2"],
  ["AI calls", "SELECT (SELECT COUNT(*) FROM ai_call_logs) AS legacy, (SELECT COUNT(*) FROM v2_ai_calls) AS v2"],
  ["error events", "SELECT (SELECT COUNT(*) FROM error_logs) AS legacy, (SELECT COUNT(*) FROM v2_error_events) AS v2"],
  ["analytics events", "SELECT (SELECT COUNT(*) FROM event_counts) AS legacy, (SELECT COUNT(*) FROM v2_analytics_events) AS v2"],
  ["daily metrics", "SELECT (SELECT COUNT(*) FROM daily_metrics) AS legacy, (SELECT COUNT(*) FROM v2_daily_metrics) AS v2"],
  ["trainer relationships", "SELECT (SELECT COUNT(*) FROM users WHERE trainerId IS NOT NULL) AS legacy, (SELECT COUNT(*) FROM v2_trainer_relationships) AS v2"],
  ["notifications", "SELECT (SELECT COUNT(*) FROM notification_outbox) AS legacy, (SELECT COUNT(*) FROM v2_notifications) AS v2"],
  ["audit events", "SELECT (SELECT COUNT(*) FROM admin_audit) AS legacy, (SELECT COUNT(*) FROM v2_audit_events) AS v2"],
];

let failed = 0;
const rows = new Map();
for (let i = 0; i < checks.length; i += 8) {
  const chunk = checks.slice(i, i + 8);
  const columns = chunk.flatMap(([, sql], index) => [
    `(SELECT legacy FROM (${sql})) AS c${i}l${index}`,
    `(SELECT v2 FROM (${sql})) AS c${i}v${index}`,
  ]).join(", ");
  const row = d1(`SELECT ${columns}`)[0] ?? {};
  chunk.forEach(([label], index) => rows.set(label, { legacy: row[`c${i}l${index}`], v2: row[`c${i}v${index}`] }));
}
for (const [label] of checks) {
  const row = rows.get(label) ?? {};
  const legacy = Number(row.legacy ?? -1);
  const v2 = Number(row.v2 ?? -1);
  const ok = legacy === v2;
  console.log(`${ok ? "✅" : "❌"} ${label}: legacy=${legacy} v2=${v2}`);
  if (!ok) failed++;
}

console.log(`\nBackfill parity (${target}): ${failed ? `${failed} mismatch(es)` : "all checks passed"}.`);
process.exit(failed ? 1 : 0);
