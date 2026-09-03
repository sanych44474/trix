// Per-key Gemini probe: tests each configured GEMINI_API_KEY against the flaky models to see
// whether a 2nd key adds usable quota (429 differs per key) or the 503s are Google-side load
// (same for both keys). Reads keys from .dev.vars. Run: node scripts/test-gemini-keys.mjs
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const keys = (raw.match(/^GEMINI_API_KEY="?([^"\n]*)"?/m)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const models = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];
const body = {
  contents: [{ role: "user", parts: [{ text: 'Reply JSON {"ok":true}' }] }],
  generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json" },
};

async function probe(key, model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const ms = Date.now() - t0;
    return res.ok ? `OK ${ms}ms` : `${res.status} ${ms}ms`;
  } catch (e) {
    return `${String(e.message).slice(0, 20)} ${Date.now() - t0}ms`;
  }
}

console.log(`keys: ${keys.length}`);
for (let i = 0; i < keys.length; i++) {
  for (const m of models) {
    console.log(`key#${i + 1}`.padEnd(7), m.padEnd(24), await probe(keys[i], m));
  }
}
