// Verify the live D1 schema has everything the migrations create — catches a migration that never
// reached the database BEFORE a deploy 500s every request on a missing table or column. (Deploys
// apply migrations themselves — deploy.yml "Apply D1 migrations" — so this is for a manual
// `wrangler d1 execute`, a restored backup, or a local database.)
// The expectation is read from migrations/*.sql, not a hand-kept list (the old list still named
// the legacy tables 0089 dropped): every table created and not later dropped, and every column
// added with ALTER TABLE … ADD COLUMN (the kind a hand-applied migration forgets).
// Usage:  node scripts/verify-schema.mjs [--remote|--local]   (default --remote; remote needs CLOUDFLARE_API_TOKEN)
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Tables and added columns the migrations, applied in order, leave behind. */
export function expectedSchema(migrations) {
  const tables = new Set();
  const columns = new Map(); // table -> Set(column)
  for (const sql of migrations) {
    const clean = sql.replace(/--[^\n]*/g, "");
    for (const m of clean.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)) tables.add(m[1]);
    for (const m of clean.matchAll(/ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+["`]?(\w+)["`]?/gi)) {
      if (!columns.has(m[1])) columns.set(m[1], new Set());
      columns.get(m[1]).add(m[2]);
    }
    for (const m of clean.matchAll(/ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+RENAME\s+TO\s+["`]?(\w+)["`]?/gi)) {
      tables.delete(m[1]); tables.add(m[2]);
      if (columns.has(m[1])) { columns.set(m[2], columns.get(m[1])); columns.delete(m[1]); }
    }
    for (const m of clean.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi)) { tables.delete(m[1]); columns.delete(m[1]); }
  }
  for (const t of [...columns.keys()]) if (!tables.has(t)) columns.delete(t);
  return { tables: [...tables].sort(), columns: Object.fromEntries([...columns].map(([t, c]) => [t, [...c].sort()])) };
}

function readMigrations() {
  const dir = new URL("../migrations/", import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8"));
}

function main() {
  const target = process.argv.includes("--local") ? "--local" : "--remote";
  const d1 = (sql) => {
    // SQL is wrapped in double quotes (it only ever contains single quotes) so it survives as one
    // argument on both cmd.exe and POSIX shells.
    const out = execSync(`npx wrangler d1 execute trix ${target} --json --command "${sql}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? [];
  };
  const want = expectedSchema(readMigrations());
  let failed = 0;
  const note = (label, cond) => { if (!cond) { console.log(`❌ ${label}`); failed++; } };
  const have = new Set(d1("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
  for (const t of want.tables) note(`table ${t}`, have.has(t));
  for (const [t, cols] of Object.entries(want.columns)) {
    if (!have.has(t)) continue; // already reported
    const got = new Set(d1(`SELECT name FROM pragma_table_info('${t}')`).map((r) => r.name));
    for (const c of cols) note(`${t}.${c}`, got.has(c));
  }
  console.log(`\nSchema check (${target}): ${want.tables.length} tables, ${Object.values(want.columns).flat().length} added columns — ${failed ? `${failed} missing` : "all present"}.`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
