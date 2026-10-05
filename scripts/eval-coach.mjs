// Coach eval: runs every case in evals/coach/cases.ts through the real coach prompt
// (coachEditSystem) and the real provider chain (aiJSON), then scores the answers with the
// deterministic checks in evals/coach/checks.ts. Use it before shipping a prompt change or
// switching models: same questions, same rules, a pass rate you can compare.
//
// Run: npm run eval:coach                 (all cases once)
//      npm run eval:coach -- --only bench-next,knee-sharp
//      npm run eval:coach -- --repeat 3     (each case 3×: answers vary, a flaky pass shows up)
//      npm run eval:coach -- --min 0.9      (exit 1 below this pass rate; default 0.85)
// Reads provider keys from .dev.vars (same as scripts/check-ai-models.mjs). AI call logs go to an
// in-memory database, nothing touches production.
import { readFileSync } from "node:fs";
import { aiJSON } from "../src/ai/index.ts";
import * as P from "../src/ai/prompts.ts";
import { validateCoachEditResult } from "../src/domain/coachActions.ts";
import { CASES, PLAN_INDEX, PROFILE, context } from "../evals/coach/cases.ts";
import { globalChecks, runCheck } from "../evals/coach/checks.ts";
import { newDb } from "../test/harness.ts";

function readDevVars() {
  try {
    return Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n")
      .map((l) => l.match(/^([A-Z_]+)="?([^"\n]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch { return {}; }
}
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const only = arg("only", "")?.split(",").filter(Boolean) ?? [];
const repeat = Math.max(1, Number(arg("repeat", "1")));
const min = Number(arg("min", "0.85"));

const vars = readDevVars();
const env = { ...process.env, ...vars, DB: newDb() };
if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY && !env.OPENROUTER_API_KEY && !env.OLLAMA_API_KEY) {
  console.error("No AI provider key in .dev.vars / env — nothing to evaluate against.");
  process.exit(2);
}

const cases = CASES.filter((c) => !only.length || only.includes(c.id));
let passed = 0, total = 0;
const failures = [];
for (const c of cases) {
  for (let run = 0; run < repeat; run++) {
    total++;
    let result;
    try {
      result = await aiJSON(env, {
        system: P.coachEditSystem(c.lang, { ...PROFILE, ...(c.profile ?? {}) }, c.context ?? context()),
        user: c.question, schema: P.COACH_EDIT_SCHEMA, temperature: 0.35, kind: "coach", db: env.DB,
        validate: (parsed) => validateCoachEditResult(parsed),
      });
    } catch (e) {
      failures.push({ id: c.id, why: "AI call failed", detail: String(e?.message ?? e).slice(0, 160) });
      console.log(`✗ ${c.id}  (AI call failed)`);
      continue;
    }
    const results = [...globalChecks(result, c.lang, PLAN_INDEX), ...c.checks.map((k) => runCheck(k, result))];
    const bad = results.filter((r) => !r.ok);
    if (!bad.length) { passed++; console.log(`✓ ${c.id}`); continue; }
    console.log(`✗ ${c.id}`);
    for (const b of bad) { console.log(`    - ${b.why}${b.detail ? ` (${b.detail})` : ""}`); failures.push({ id: c.id, ...b }); }
    console.log(`    reply: ${result.reply.replace(/\s+/g, " ").slice(0, 240)}`);
  }
}
const rate = total ? passed / total : 0;
console.log(`\n${passed}/${total} answers passed every check (${(rate * 100).toFixed(0)}%), threshold ${(min * 100).toFixed(0)}%`);
process.exit(rate >= min ? 0 : 1);
