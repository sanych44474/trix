// Manual SQL export for the sole datastore behind this bot. Cloudflare D1 also provides Time
// Travel point-in-time recovery (7 days on Workers Free, 30 days on Workers Paid); verify the
// account plan and database backend before relying on that window. This export is an independent
// copy, but the script does not encrypt it, copy it offsite, or schedule recurring backups.
//
// Thin wrapper around the installed Wrangler CLI with a timestamped filename — kept as a script
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

// Launch Wrangler's JS entry point through the current Node executable. `npx` resolves to a
// Windows .cmd/.ps1 shim, which `execFileSync("npx", ...)` cannot spawn on Windows.
const wranglerCli = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const args = [wranglerCli, "d1", "export", "trix", remote ? "--remote" : "--local", "--output", outFile];
console.log(`Running: node ${args.join(" ")}`);
execFileSync(process.execPath, args, { stdio: "inherit", cwd: root });
console.log(`\nBackup written to ${outFile}`);
