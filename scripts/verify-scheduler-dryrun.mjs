// Compare a scheduler DO type's dry-run log (what UserSchedulerDO/SquadSchedulerDO/
// GlobalSchedulerDO WOULD have done for real) against what the still-live cron path actually
// did, for the same time window -- the pre-flip sanity check called for in the DO-cutover
// rollout plan (see docs/adr and the cutover procedure notes). This is a count-based, per-entity
// sanity check, not a byte-exact comparison -- same posture as scripts/verify-v2-backfill.mjs.
//
// Usage:
//   node scripts/verify-scheduler-dryrun.mjs --type=user   [--since=<ISO>] [--until=<ISO>] [--local|--remote]
//   node scripts/verify-scheduler-dryrun.mjs --type=squad  [--since=<ISO>] [--until=<ISO>] [--local|--remote]
//   node scripts/verify-scheduler-dryrun.mjs --type=global [--since=<ISO>] [--until=<ISO>] [--local|--remote]
//
// --since/--until default to the last 24 hours. --local is the default target (matching
// verify-v2-backfill.mjs); --remote reads the live database and needs the same per-session
// approval as any other `wrangler d1 execute --remote` command.
import { execSync } from "node:child_process";

const args = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? "1"];
}));

const type = args.get("type");
if (!["user", "squad", "global"].includes(type)) {
  console.error('Usage: node scripts/verify-scheduler-dryrun.mjs --type=user|squad|global [--since=<ISO>] [--until=<ISO>] [--remote]');
  process.exit(1);
}

const target = args.has("remote") ? "--remote" : "--local";
const until = args.get("until") ?? new Date().toISOString();
const since = args.get("since") ?? new Date(Date.parse(until) - 24 * 60 * 60 * 1000).toISOString();

function d1(sql) {
  const out = execSync(`npx wrangler d1 execute trix ${target} --json --command "${sql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

console.log(`Scheduler dry-run parity — type=${type} target=${target} window=[${since}, ${until})\n`);

const dryRun = d1(
  `SELECT entityId, kind, COUNT(*) AS n FROM scheduler_dryrun_log
   WHERE source = '${type}' AND createdAt >= '${since}' AND createdAt < '${until}'
   GROUP BY entityId, kind ORDER BY entityId`,
);
const wouldSend = new Map(dryRun.filter((r) => r.kind === "send").map((r) => [Number(r.entityId), Number(r.n)]));
const wouldWrite = new Map(dryRun.filter((r) => r.kind === "write").map((r) => [Number(r.entityId), Number(r.n)]));
const entities = [...new Set(dryRun.map((r) => Number(r.entityId)))];

if (!entities.length) {
  console.log("No dry-run activity recorded for this type in the window — nothing to compare.");
  console.log(`\n(If this is unexpected, confirm scheduler_cutover_${type} is still '0' -- a cut-over type stops writing to this log.)`);
  process.exit(0);
}

let mismatches = 0;

if (type === "global") {
  // Global has a single logical actor (no per-entity real counterpart table to diff against) --
  // report the dry-run summary for a human to eyeball against Workers Logs / /ownerreport → AI
  // & Errors for the same window, rather than a false-precision automated diff.
  const totalSends = [...wouldSend.values()].reduce((a, b) => a + b, 0);
  const totalWrites = [...wouldWrite.values()].reduce((a, b) => a + b, 0);
  console.log(`Dry-run recorded ${totalSends} would-be send(s) and ${totalWrites} would-be write(s) in the window.`);
  console.log("Cross-check manually against /ownerreport → Errors and Workers Logs for the same window before flipping scheduler_cutover_global.");
  process.exit(0);
}

if (type === "user") {
  const real = d1(
    `SELECT accountId, COUNT(*) AS n FROM v2_notifications
     WHERE createdAt >= '${since}' AND createdAt < '${until}' AND accountId IN (${entities.join(",")})
     GROUP BY accountId`,
  );
  const realSent = new Map(real.map((r) => [Number(r.accountId), Number(r.n)]));
  for (const id of entities) {
    const dry = wouldSend.get(id) ?? 0;
    const actual = realSent.get(id) ?? 0;
    const ok = (dry > 0) === (actual > 0);
    console.log(`${ok ? "✅" : "❌"} user ${id}: dry-run would-send=${dry}, cron actually sent=${actual}`);
    if (!ok) mismatches++;
  }
}

if (type === "squad") {
  const rows = d1(`SELECT chatId, lastRecapWeek FROM v2_squads WHERE chatId IN (${entities.join(",")})`);
  const byChat = new Map(rows.map((r) => [Number(r.chatId), r.lastRecapWeek]));
  // The window's ISO week, matching src/domain/records.ts's isoWeekKey format (YYYY-Www) --
  // approximated here rather than importing the domain function into a standalone script.
  const d = new Date(until);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - jan1) / 86400000) + jan1.getUTCDay() + 1) / 7);
  const windowWeekKey = `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  for (const id of entities) {
    const dry = wouldWrite.get(id) ?? 0;
    const recapped = byChat.get(id) === windowWeekKey;
    const ok = dry === 0 || recapped;
    console.log(`${ok ? "✅" : "❌"} squad ${id}: dry-run would-write=${dry}, lastRecapWeek=${byChat.get(id) ?? "(unknown)"} (window week ${windowWeekKey})`);
    if (!ok) mismatches++;
  }
}

console.log(`\nScheduler dry-run parity (${type}, ${target}): ${mismatches ? `${mismatches} mismatch(es) — investigate before flipping scheduler_cutover_${type}` : "all checks passed"}.`);
process.exit(mismatches ? 1 : 0);
