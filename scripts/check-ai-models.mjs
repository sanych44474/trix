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
// Run: npm run check:ai-models            (every configured model, fallbacks included)
//      npm run check:ai-models -- --catalog (also list what each provider offers right now:
//      Gemini/Gemma models, Groq models, OpenRouter's :free roster with vision flags, Ollama
//      Cloud models — and flag configured ids that are no longer listed)
// Reads keys from .dev.vars (same convention as scripts/test-providers.mjs). Any provider whose
// key is unset is skipped, not failed — this is meant to run against whatever's actually
// configured, local dev or otherwise. Exits non-zero if any checked model failed, so it can be
// wired into a scheduled check or a pre-deploy gate later without further changes.
import { readFileSync } from "node:fs";
import { geminiFallbackModels } from "../src/ai/gemini.ts";
import { GROQ_DEFAULT_MODEL } from "../src/ai/groq.ts";
import {
  OPENROUTER_DEFAULT_TRANSLATE_MODEL,
  OPENROUTER_DEFAULT_VISION_MODEL,
  openrouterTextModels,
} from "../src/ai/openrouter.ts";
import { ollamaModels } from "../src/ai/ollama.ts";

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
// Model ids that PRODUCTION actually uses live in wrangler.toml's [vars] block, not in
// .dev.vars — checking only the latter is why this script happily reported "all good" on
// 2026-09-09 while prod was pointing at four dead Groq ids and three dead OpenRouter ones.
// wrangler.toml wins where both define a key, mirroring what the deployed Worker sees.
function readWranglerVars() {
  try {
    const text = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const block = text.split(/^\[vars\]/m)[1];
    if (!block) return {};
    const out = {};
    for (const line of block.split(/\r?\n/)) {
      if (/^\[/.test(line)) break; // next TOML section — [vars] is over
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"([^"]*)"/);
      if (m && m[2]) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const vars = { ...readDevVars(), ...readWranglerVars() };
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

const list = (raw) => (raw ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const groqModels = [...new Set([vars.GROQ_MODEL || GROQ_DEFAULT_MODEL, ...list(vars.GROQ_FALLBACK_MODELS)])];
const orText = openrouterTextModels(vars);
const orVision = vars.OPENROUTER_VISION_MODEL || OPENROUTER_DEFAULT_VISION_MODEL;
const orTranslate = vars.OPENROUTER_TRANSLATE_MODEL || OPENROUTER_DEFAULT_TRANSLATE_MODEL;
const ollama = ollamaModels(vars);

if (GROQ) {
  for (const m of groqModels) targets.push(["groq", m, () => checkOpenAiStyle("https://api.groq.com/openai/v1/chat/completions", GROQ, m)]);
} else console.log("skip: groq (no GROQ_API_KEY)");

if (OPENROUTER) {
  const chat = "https://openrouter.ai/api/v1/chat/completions";
  for (const m of orText) targets.push(["openrouter", m, () => checkOpenAiStyle(chat, OPENROUTER, m)]);
  targets.push(["openrouter (vision)", orVision, () => checkOpenAiStyle(chat, OPENROUTER, orVision)]);
  if (!orText.includes(orTranslate)) targets.push(["openrouter (translate)", orTranslate, () => checkOpenAiStyle(chat, OPENROUTER, orTranslate)]);
} else console.log("skip: openrouter (no OPENROUTER_API_KEY)");

if (OLLAMA) {
  for (const m of ollama) targets.push(["ollama", m, () => checkOpenAiStyle("https://ollama.com/v1/chat/completions", OLLAMA, m)]);
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

// --catalog: what each provider offers right now, newest first, and which configured ids are gone.
if (process.argv.includes("--catalog")) {
  const getJson = async (url, headers = {}) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    return res.json();
  };
  const report = (title, ids, configured, notes = new Map()) => {
    console.log(`\n== ${title}: ${ids.length} model(s)`);
    for (const id of ids.slice(0, 40)) console.log(`  ${configured.includes(id) ? "*" : " "} ${id}${notes.get(id) ? `  ${notes.get(id)}` : ""}`);
    const gone = configured.filter((id) => !ids.includes(id));
    if (gone.length) console.log(`  !! configured but NOT listed: ${gone.join(", ")}`);
  };
  const safe = async (label, fn) => { try { await fn(); } catch (e) { console.log(`\n== ${label}: catalog unavailable — ${String(e.message ?? e).slice(0, 120)}`); } };
  if (GEMINI) await safe("gemini", async () => {
    const data = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "X-goog-api-key": GEMINI });
    const ids = (data.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name.replace(/^models\//, "")).filter((id) => /gemini|gemma/.test(id)).sort().reverse();
    report("gemini (generateContent)", ids, geminiFallbackModels(vars));
  });
  if (GROQ) await safe("groq", async () => {
    const data = await getJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${GROQ}` });
    const rows = (data.data ?? []).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    report("groq", rows.map((m) => m.id), groqModels, new Map(rows.map((m) => [m.id, m.context_window ? `ctx ${m.context_window}` : ""])));
  });
  if (OPENROUTER) await safe("openrouter", async () => {
    const data = await getJson("https://openrouter.ai/api/v1/models");
    const free = (data.data ?? []).filter((m) => m.id.endsWith(":free")).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const notes = new Map(free.map((m) => [m.id, [`ctx ${m.context_length}`, (m.architecture?.input_modalities ?? []).includes("image") ? "vision" : ""].filter(Boolean).join(", ")]));
    report("openrouter :free", free.map((m) => m.id), [...orText, orVision, orTranslate], notes);
  });
  if (OLLAMA) await safe("ollama", async () => {
    const data = await getJson("https://ollama.com/v1/models", { Authorization: `Bearer ${OLLAMA}` });
    report("ollama cloud", (data.data ?? []).map((m) => m.id).sort(), ollama);
  });
  console.log("\n(* = configured in wrangler.toml / defaults)");
}

if (targets.length === 0) {
  console.log("\nNo API keys found in .dev.vars — nothing to check.");
} else {
  console.log(`\n${targets.length - failed}/${targets.length} default model(s) responded.`);
}
process.exitCode = failed > 0 ? 1 : 0;
