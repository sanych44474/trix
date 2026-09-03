// Verify the live D1 schema matches what the code expects — the migrations tracker is out of
// sync (migrations are applied by hand via `wrangler d1 execute`), so this catches a forgotten
// migration BEFORE a deploy 500s every request on a missing column/table.
// Usage:  node scripts/verify-schema.mjs [--remote|--local]   (default --remote; remote needs CLOUDFLARE_API_TOKEN)
import { execSync } from "node:child_process";

const target = process.argv.includes("--local") ? "--local" : "--remote";

// Expected schema surface introduced by migrations the tracker doesn't cover (0037+ and the
// key older ones). Add a line here whenever a migration adds a table or column.
const EXPECT_TABLES = [
  "users", "plans", "workout_logs", "nutrition_logs", "strength_records", "sessions",
  "trainers", "client_billing", "trainer_templates", "rest_timers", "ai_cache",
  "ai_usage", "ai_call_logs", "meal_plans", "water_logs", "challenges", "injuries",
];
const EXPECT_COLUMNS = {
  users: ["sessionMode", "sessionRetryAfter", "lastSeenAt", "vacationUntil"],
  sessions: ["tz", "meetingLink"],
  trainers: ["maxClients"],
  ai_call_logs: ["tokens"],
};

function d1(sql) {
  // SQL is wrapped in double quotes (it only ever contains single quotes) so it survives as one
  // argument on both cmd.exe and POSIX shells.
  const out = execSync(`npx wrangler d1 execute trix ${target} --json --command "${sql}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

let failed = 0;
const note = (label, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failed++;
};

const tables = new Set(d1("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
for (const t of EXPECT_TABLES) note(`table ${t}`, tables.has(t));

for (const [t, cols] of Object.entries(EXPECT_COLUMNS)) {
  if (!tables.has(t)) { note(`columns of ${t} (table missing)`, false); continue; }
  const have = new Set(d1(`SELECT name FROM pragma_table_info('${t}')`).map((r) => r.name));
  for (const c of cols) note(`${t}.${c}`, have.has(c));
}

console.log(`\nSchema check (${target}): ${failed ? `${failed} missing` : "all present"}.`);
process.exit(failed ? 1 : 0);
