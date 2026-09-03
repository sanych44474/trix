// Ad-hoc provider/model benchmark: fires an interview-style (small JSON) and a plan-style
// (larger structured JSON) request at each candidate model and reports ok / latency / JSON-valid.
// Reads keys from .dev.vars. Run: node scripts/test-providers.mjs
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)="?([^"\n]*)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const firstKey = (raw) => (raw ?? "").split(",")[0].trim();
const GEMINI = firstKey(vars.GEMINI_API_KEY);
const GROQ = firstKey(vars.GROQ_API_KEY);
const OPENROUTER = firstKey(vars.OPENROUTER_API_KEY);

const SYS = "You are a fitness coach. Reply ONLY with JSON.";
const INTERVIEW_USER = 'Ask the next onboarding question. JSON: {"message": string, "done": boolean}.';
const PLAN_USER =
  'Build a tiny 1-day plan. JSON: {"day": {"muscleGroup": string, "exercises": [{"name": string, "sets": string, "rpe": string}]}}. Exactly 2 exercises.';
const TIMEOUT = 20000;

function validJson(text) {
  try { JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()); return true; } catch { return false; }
}

async function gemini(model, user, schema) {
  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: SYS }] },
    generationConfig: { temperature: 0.5, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json", responseSchema: schema },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

async function openaiStyle(url, key, model, user) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.5, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYS }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

const INTERVIEW_SCHEMA = { type: "OBJECT", properties: { message: { type: "STRING" }, done: { type: "BOOLEAN" } }, required: ["message", "done"] };
const PLAN_SCHEMA = { type: "OBJECT", properties: { day: { type: "OBJECT", properties: { muscleGroup: { type: "STRING" }, exercises: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, sets: { type: "STRING" }, rpe: { type: "STRING" } } } } } } } };

const targets = [
  ["gemini", "gemini-3.5-flash"],
  ["gemini", "gemini-3-flash-preview"],
  ["gemini", "gemini-3.1-flash-lite"],
  ["gemini", "gemini-2.5-flash"],
  ["gemini", "gemma-4-31b-it"],
  ["gemini", "gemma-3-27b-it"],
];

async function run(provider, model, task) {
  const user = task === "interview" ? INTERVIEW_USER : PLAN_USER;
  const t0 = Date.now();
  try {
    let text;
    if (provider === "gemini") text = await gemini(model, user, task === "interview" ? INTERVIEW_SCHEMA : PLAN_SCHEMA);
    else if (provider === "groq") text = await openaiStyle("https://api.groq.com/openai/v1/chat/completions", GROQ, model, user);
    else text = await openaiStyle("https://openrouter.ai/api/v1/chat/completions", OPENROUTER, model, user);
    const ms = Date.now() - t0;
    return { ok: true, ms, json: validJson(text), sample: text.replace(/\s+/g, " ").slice(0, 70) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: String(e.message).slice(0, 90) };
  }
}

console.log("provider/model".padEnd(34), "task".padEnd(10), "ok".padEnd(4), "ms".padEnd(7), "json", "note");
for (const [provider, model] of targets) {
  for (const task of ["interview", "plan"]) {
    const r = await run(provider, model, task);
    const note = r.ok ? r.sample : r.err;
    console.log(`${provider}/${model}`.padEnd(34), task.padEnd(10), String(r.ok).padEnd(4), String(r.ms).padEnd(7), String(r.ok ? r.json : "-").padEnd(5), note);
  }
}
