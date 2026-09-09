// Improvement #10 from the 2026-09-09 production-readiness review: no backup/export step
// existed anywhere in scripts/ or CI for the sole datastore behind this bot. Cloudflare D1 has
// built-in Time Travel (point-in-time recovery) on every plan, but this repo has not verified
// the exact retention window for the account's current plan against Cloudflare's own docs/
// dashboard — check that yourself before relying on it as the only safety net. This script is
// the second, independent layer: a plain SQL dump you actually hold a copy of.
//
// Thin wrapper around `wrangler d1 export` with a timestamped filename — kept as a script
// (not just a documented command) so it's one command to remember and easy to wire into a
// scheduled job (cron, GitHub Actions, Windows Task Scheduler) later without further changes.
//
// Usage:
//   node scripts/backup-d1.mjs            # local dev DB
//   node scripts/backup-d1.mjs --remote   # LIVE production DB — needs the same per-session
//                                          # approval as any other `wrangler d1 ... --remote`
//                                          # command (see CLAUDE.md's golden rules); this script
//                                          # does not check that for you.
//
// Output lands in backups/ (gitignored — add it if it isn't already) as
// trix-<local|remote>-<ISO timestamp>.sql. Upload/rotate that directory (R2, a NAS, wherever)
// on whatever cadence the current backup gap is worth closing at — this script only produces
// the file, it doesn't move it anywhere.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const remote = process.argv.includes("--remote");
const outDir = join(root, "backups");
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(outDir, `trix-${remote ? "remote" : "local"}-${stamp}.sql`);

const args = ["wrangler", "d1", "export", "trix", remote ? "--remote" : "--local", "--output", outFile];
console.log(`Running: npx ${args.join(" ")}`);
execFileSync("npx", args, { stdio: "inherit", cwd: root });
console.log(`\nBackup written to ${outFile}`);
