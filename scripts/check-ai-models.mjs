// Smoke-test every AI provider's DEFAULT model (the one actually used, given whatever is — or
// isn't — set in .dev.vars) with a trivial prompt, and report pass/fail per model. Improvement
// #5 from the 2026-09-09 production-readiness review: OpenRouter's free-tier roster in
// particular churns often, and a deprecated/renamed model silently degrades a live fallback
// chain rather than failing loudly — this catches that BEFORE a user hits it mid-chain.
//
// Deliberately imports the real default-model constants from source (src/ai/*.ts) instead of
// hand-copying them here, so this can never silently drift out of sync with what production
// actually uses — see the "Exported (not just a local literal)" comments in those files.
//
// Run: npm run check:ai-models
// Reads keys from .dev.vars (same convention as scripts/test-providers.mjs). Any provider whose
// key is unset is skipped, not failed — this is meant to run against whatever's actually
// configured, local dev or otherwise. Exits non-zero if any checked model failed, so it can be
// wired into a scheduled check or a pre-deploy gate later without further changes.
import { readFileSync } from "node:fs";
import { geminiFallbackModels } from "../src/ai/gemini.ts";
import { GROQ_DEFAULT_MODEL } from "../src/ai/groq.ts";
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_TRANSLATE_MODEL,
  OPENROUTER_DEFAULT_VISION_MODEL,
} from "../src/ai/openrouter.ts";
import { OLLAMA_DEFAULT_MODEL } from "../src/ai/ollama.ts";

function readDevVars() {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
        .split("\n")
        .map((l) => l.match(/^([A-Z_]+)="?([^"\n]*)"?$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    );
  } catch {
    return {}; // no .dev.vars locally — every provider below gets skipped, not failed
  }
}
const vars = readDevVars();
const firstKey = (raw) => (raw ?? "").split(",")[0].trim();
const GEMINI = firstKey(vars.GEMINI_API_KEY);
const GROQ = firstKey(vars.GROQ_API_KEY);
const OPENROUTER = firstKey(vars.OPENROUTER_API_KEY);
const OLLAMA = firstKey(vars.OLLAMA_API_KEY);

const SYS = "Reply with exactly one word.";
const USER = "Reply with exactly one word: ok";
const TIMEOUT = 15000;

async function checkGemini(model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: USER }] }],
      systemInstruction: { parts: [{ text: SYS }] },
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
}

async function checkOpenAiStyle(url, key, model) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: SYS }, { role: "user", content: USER }] }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
}

const targets = [];
if (GEMINI) {
  for (const m of geminiFallbackModels(vars)) targets.push(["gemini", m, () => checkGemini(m)]);
} else console.log("skip: gemini (no GEMINI_API_KEY in .dev.vars)");

if (GROQ) {
  const m = vars.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  targets.push(["groq", m, () => checkOpenAiStyle("https://api.groq.com/openai/v1/chat/completions", GROQ, m)]);
} else console.log("skip: groq (no GROQ_API_KEY)");

if (OPENROUTER) {
  const chat = "https://openrouter.ai/api/v1/chat/completions";
  const m1 = vars.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
  const m2 = vars.OPENROUTER_VISION_MODEL || OPENROUTER_DEFAULT_VISION_MODEL;
  const m3 = vars.OPENROUTER_TRANSLATE_MODEL || OPENROUTER_DEFAULT_TRANSLATE_MODEL;
  targets.push(["openrouter", m1, () => checkOpenAiStyle(chat, OPENROUTER, m1)]);
  targets.push(["openrouter (vision)", m2, () => checkOpenAiStyle(chat, OPENROUTER, m2)]);
  targets.push(["openrouter (translate)", m3, () => checkOpenAiStyle(chat, OPENROUTER, m3)]);
} else console.log("skip: openrouter (no OPENROUTER_API_KEY)");

if (OLLAMA) {
  const m = vars.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL;
  targets.push(["ollama", m, () => checkOpenAiStyle("https://ollama.com/v1/chat/completions", OLLAMA, m)]);
} else console.log("skip: ollama (no OLLAMA_API_KEY)");

console.log(
  "note: Workers AI has no standalone API — it only runs through a wrangler `AI` binding, not " +
    "a plain key — so it isn't checked here. Verify it via `npm run dev` and a live request instead.\n",
);

let failed = 0;
for (const [provider, model, check] of targets) {
  process.stdout.write(`${provider.padEnd(24)} ${model.padEnd(42)} `);
  try {
    await check();
    console.log("OK");
  } catch (e) {
    failed++;
    console.log(`FAIL — ${String(e.message ?? e).slice(0, 150)}`);
  }
}

if (targets.length === 0) {
  console.log("\nNo API keys found in .dev.vars — nothing to check.");
} else {
  console.log(`\n${targets.length - failed}/${targets.length} default model(s) responded.`);
}
process.exitCode = failed > 0 ? 1 : 0;
