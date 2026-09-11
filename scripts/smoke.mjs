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

// Retries a check a couple of times before recording it as failed: a request landing right after
// `wrangler deploy` returns can hit an edge colo that hasn't picked up the new version yet, which
// looks identical to a real regression until it passes moments later on its own. A check that's
// genuinely broken still fails every attempt and reports the same either way; this only rescues
// the transient-propagation case, at the cost of a few seconds on a already-failing run.
async function check(name, fn, { retries = 2, delayMs = 3000 } = {}) {
  let lastDetail = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { cond, detail } = await fn();
      if (cond) {
        results.push(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
        return;
      }
      lastDetail = detail;
    } catch (e) {
      lastDetail = String(e);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  results.push(`❌ ${name}${lastDetail ? ` — ${lastDetail}` : ""}`);
  failed++;
}

async function main() {
  // 1. health
  await check("GET /health 200", async () => {
    const r = await fetch(`${BASE}/health`);
    return { cond: r.status === 200, detail: `got ${r.status}` };
  });

  // 2. D1 connectivity
  await check("GET /health/db ok:true", async () => {
    const r = await fetch(`${BASE}/health/db`);
    const body = await r.json().catch(() => ({}));
    return { cond: r.status === 200 && body.ok === true, detail: JSON.stringify(body) };
  });

  // 3. Mini App shell
  await check("GET /app 200", async () => {
    const r = await fetch(`${BASE}/app`);
    return { cond: r.status === 200, detail: `got ${r.status}` };
  });

  // 3b. Mini App shell ships its CSP (public/_headers) -- a regression here would silently widen
  // what the webview can load/connect to.
  await check("GET /app has a restrictive CSP", async () => {
    const r = await fetch(`${BASE}/app`);
    const csp = r.headers.get("content-security-policy") || "";
    return { cond: csp.includes("default-src 'none'"), detail: csp || "(missing)" };
  });

  // 4. /v redirect: rejects a non-YouTube / non-https target
  await check("GET /v rejects bad target (400)", async () => {
    const r = await fetch(`${BASE}/v?u=${encodeURIComponent("javascript://youtube.com/%0aalert(1)")}&uid=1`, { redirect: "manual" });
    return { cond: r.status === 400, detail: `got ${r.status}` };
  });

  // 5. /v redirect: 302 to a real YouTube URL
  await check("GET /v redirects to YouTube (302)", async () => {
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const r = await fetch(`${BASE}/v?u=${encodeURIComponent(target)}&uid=0`, { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    return { cond: r.status === 302 && loc.includes("youtube.com"), detail: `${r.status} → ${loc}` };
  });

  // 6. webhook auth: a wrong secret must be rejected
  await check("POST /webhook rejects bad secret (401)", async () => {
    const r = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "definitely-wrong" },
      body: "{}",
    });
    return { cond: r.status === 401, detail: `got ${r.status}` };
  });

  // 6b. admin auth: every /admin/* route shares isAdmin() (X-Admin-Secret header) -- a regression
  // there would open every admin action (send-as, mass replan, ...) to an unauthenticated caller.
  await check("POST /admin/replan rejects missing admin secret (401)", async () => {
    const r = await fetch(`${BASE}/admin/replan?hours=1`, { method: "POST" });
    return { cond: r.status === 401, detail: `got ${r.status}` };
  });

  // 6c. Mini App API auth: every /api/* handler shares miniAppUser() -- this is the one wall in
  // front of every user's private data, so a regression here is worse than any single feature
  // breaking. Can't exercise the happy path without signing real Telegram initData, but the
  // reject-when-absent path needs no secret and covers the auth check actually running at all.
  await check("GET /api/dashboard rejects missing auth (401)", async () => {
    const r = await fetch(`${BASE}/api/dashboard`);
    return { cond: r.status === 401, detail: `got ${r.status}` };
  });

  // 6d. unknown routes still fall through to a real 404, not e.g. a crash or an open proxy.
  await check("GET /this-route-does-not-exist -> 404", async () => {
    const r = await fetch(`${BASE}/this-route-does-not-exist`);
    return { cond: r.status === 404, detail: `got ${r.status}` };
  });

  // 7. optional: a valid /start update round-trips (only with the real secret)
  if (SECRET) {
    await check("POST /webhook /start 200", async () => {
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
      return { cond: r.status === 200, detail: `got ${r.status}` };
    });
  }

  console.log(`\nSmoke @ ${BASE}\n${results.join("\n")}\n`);
  if (failed) {
    console.error(`${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("All smoke checks passed.");
}

main();
