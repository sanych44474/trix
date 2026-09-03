// Post-deploy smoke test — codifies the manual checks run after every deploy.
// Usage:  node scripts/smoke.mjs <baseUrl>     (or set $SMOKE_URL)
//   Set $TELEGRAM_WEBHOOK_SECRET to also exercise the webhook (optional).
// Exits non-zero if any check fails, so it can gate a deploy in CI or a shell chain.

const target = process.argv[2] || process.env.SMOKE_URL;
if (!target) {
  console.error("usage: node scripts/smoke.mjs <baseUrl>   (or set SMOKE_URL)");
  process.exit(2);
}
const BASE = target.replace(/\/$/, "");
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

let failed = 0;
const results = [];

function ok(name, cond, detail = "") {
  results.push(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

async function main() {
  // 1. health
  try {
    const r = await fetch(`${BASE}/health`);
    ok("GET /health 200", r.status === 200, `got ${r.status}`);
  } catch (e) {
    ok("GET /health 200", false, String(e));
  }

  // 2. D1 connectivity
  try {
    const r = await fetch(`${BASE}/health/db`);
    const body = await r.json().catch(() => ({}));
    ok("GET /health/db ok:true", r.status === 200 && body.ok === true, JSON.stringify(body));
  } catch (e) {
    ok("GET /health/db ok:true", false, String(e));
  }

  // 3. Mini App shell
  try {
    const r = await fetch(`${BASE}/app`);
    ok("GET /app 200", r.status === 200, `got ${r.status}`);
  } catch (e) {
    ok("GET /app 200", false, String(e));
  }

  // 4. /v redirect: rejects a non-YouTube / non-https target
  try {
    const r = await fetch(`${BASE}/v?u=${encodeURIComponent("javascript://youtube.com/%0aalert(1)")}&uid=1`, { redirect: "manual" });
    ok("GET /v rejects bad target (400)", r.status === 400, `got ${r.status}`);
  } catch (e) {
    ok("GET /v rejects bad target (400)", false, String(e));
  }

  // 5. /v redirect: 302 to a real YouTube URL
  try {
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const r = await fetch(`${BASE}/v?u=${encodeURIComponent(target)}&uid=0`, { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    ok("GET /v redirects to YouTube (302)", r.status === 302 && loc.includes("youtube.com"), `${r.status} → ${loc}`);
  } catch (e) {
    ok("GET /v redirects to YouTube (302)", false, String(e));
  }

  // 6. webhook auth: a wrong secret must be rejected
  try {
    const r = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "definitely-wrong" },
      body: "{}",
    });
    ok("POST /webhook rejects bad secret (401)", r.status === 401, `got ${r.status}`);
  } catch (e) {
    ok("POST /webhook rejects bad secret (401)", false, String(e));
  }

  // 7. optional: a valid /start update round-trips (only with the real secret)
  if (SECRET) {
    try {
      const upd = {
        update_id: Date.now(),
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 990990, type: "private", first_name: "Smoke" },
          from: { id: 990990, is_bot: false, first_name: "Smoke", language_code: "uk" },
          text: "/start",
        },
      };
      const r = await fetch(`${BASE}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
        body: JSON.stringify(upd),
      });
      ok("POST /webhook /start 200", r.status === 200, `got ${r.status}`);
    } catch (e) {
      ok("POST /webhook /start 200", false, String(e));
    }
  }

  console.log(`\nSmoke @ ${BASE}\n${results.join("\n")}\n`);
  if (failed) {
    console.error(`${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("All smoke checks passed.");
}

main();
