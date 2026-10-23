// Renders the LinkedIn carousel slides (1080x1350) to PNG and one PDF.
//   PLAYWRIGHT_ROOT=$(npm root -g)/playwright node marketing/linkedin/render.mjs . marketing/linkedin
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(`${process.env.PLAYWRIGHT_ROOT}/`);
const { chromium } = require("playwright");
const [repo, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const img = (name) => `data:image/webp;base64,${readFileSync(`${repo}/docs/img/${name}`).toString("base64")}`;

const W = 1080, H = 1350;
const CSS = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; }
  body { background: #0E121A; color: #EDEFF3; font-family: "DejaVu Sans", system-ui, sans-serif; overflow: hidden; position: relative; }
  .slide { position: absolute; inset: 0; padding: 72px 72px 64px; display: flex; flex-direction: column; }
  .glow { position: absolute; inset: 0; background: radial-gradient(circle at 85% 8%, rgba(240,180,41,.20), transparent 50%), radial-gradient(circle at 5% 100%, rgba(80,140,255,.10), transparent 45%); }
  .kicker { position: relative; font-size: 22px; letter-spacing: .18em; text-transform: uppercase; color: #F0B429; font-weight: 700; }
  h1 { position: relative; font-size: 76px; line-height: 1.04; font-weight: 800; letter-spacing: -.035em; margin-top: 18px; }
  h2 { position: relative; font-size: 56px; line-height: 1.08; font-weight: 800; letter-spacing: -.03em; margin-top: 14px; }
  p.lead { position: relative; font-size: 28px; line-height: 1.4; color: #A9B1C1; margin-top: 22px; }
  em { color: #F0B429; font-style: normal; }
  .foot { position: absolute; left: 72px; right: 72px; bottom: 44px; display: flex; justify-content: space-between; font-size: 20px; color: #6B7488; }
  .box { background: #161C28; border: 2px solid #252D3B; border-radius: 22px; }
  .gold { border-color: #F0B429; }
  .tag { display: inline-block; font-size: 18px; padding: 6px 14px; border-radius: 999px; background: #1F2735; color: #C9D0DC; margin: 4px 6px 0 0; }
  .phone { border-radius: 30px; border: 2px solid #252D3B; box-shadow: 0 30px 70px rgba(0,0,0,.55); display: block; }
  .arrow { color: #F0B429; font-size: 38px; text-align: center; line-height: 1; }
</style>`;

const foot = (n) => `<div class="foot"><span>Hack Limits · github.com/sanych44474/trix</span><span>${n} / 6</span></div>`;

const SLIDES = [
  // 1. Cover: the journey.
  `<div class="glow"></div><div class="slide">
    <div class="kicker">Build your idea through AI</div>
    <h1>From a notebook<br>to a <em>Telegram bot</em><br>and an <em>Android app</em></h1>
    <p class="lead">How one fitness-coach idea became three surfaces on one backend, and what the AI actually did.</p>
    <div style="position:relative;display:flex;align-items:center;gap:14px;margin-top:46px">
      ${[["📓", "Notebook", "rough notes"], ["🤖", "Bot", "Telegram chat"], ["📱", "Mini App", "logger, food, plan"], ["📲", "Android", "Kotlin MP + Compose"]]
        .map(([e, t, s], i) => `${i ? '<div class="arrow">→</div>' : ""}<div class="box ${i === 3 ? "gold" : ""}" style="flex:1;padding:22px 14px;text-align:center">
          <div style="font-size:50px">${e}</div><div style="font-size:26px;font-weight:800;margin-top:8px">${t}</div>
          <div style="font-size:17px;color:#8A93A6;margin-top:4px">${s}</div></div>`).join("")}
    </div>
    <div style="position:relative;display:flex;gap:26px;justify-content:center;margin-top:50px">
      <img class="phone" src="${img("screen-today@2x.webp")}" style="height:440px;transform:rotate(-4deg)">
      <img class="phone" src="${img("screen-train@2x.webp")}" style="height:470px;margin-top:-16px">
      <img class="phone" src="${img("screen-nutrition@2x.webp")}" style="height:440px;transform:rotate(4deg)">
    </div>
  </div>${foot(1)}`,

  // 2. The loop.
  `<div class="glow"></div><div class="slide">
    <div class="kicker">Step 1 · One complete loop</div>
    <h2>Don't start with a platform.<br>Start with a <em>loop</em>.</h2>
    <p class="lead">Telegram removed all setup friction: no install, no sign-up. A short interview is enough to start coaching.</p>
    <svg viewBox="0 0 936 640" width="936" height="640" style="position:relative;margin-top:60px">
      <defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#F0B429"/></marker></defs>
      <circle cx="468" cy="320" r="210" fill="none" stroke="#252D3B" stroke-width="3" stroke-dasharray="10 10"/>
      <path d="M 590 150 A 210 210 0 0 1 660 260" stroke="#F0B429" stroke-width="4" fill="none" marker-end="url(#a)"/>
      <path d="M 640 440 A 210 210 0 0 1 560 505" stroke="#F0B429" stroke-width="4" fill="none" marker-end="url(#a)"/>
      <path d="M 350 500 A 210 210 0 0 1 275 400" stroke="#F0B429" stroke-width="4" fill="none" marker-end="url(#a)"/>
      <path d="M 280 220 A 210 210 0 0 1 350 145" stroke="#F0B429" stroke-width="4" fill="none" marker-end="url(#a)"/>
      <g font-family="DejaVu Sans" text-anchor="middle">
        <text x="468" y="305" font-size="30" font-weight="800" fill="#EDEFF3">AI coach</text>
        <text x="468" y="345" font-size="20" fill="#8A93A6">keeps context forward</text>
        ${[[468, 92, "1 · Understand", "goals, schedule, gear, injuries"], [780, 330, "2 · Plan", "weekly program"], [468, 575, "3 · Act", "reminders, logger, voice"], [156, 330, "4 · Learn", "progress → next week"]]
          .map(([x, y, t, s]) => `<rect x="${x - 150}" y="${y - 52}" width="300" height="100" rx="20" fill="#161C28" stroke="#F0B429" stroke-width="2"/>
            <text x="${x}" y="${y - 8}" font-size="27" font-weight="800" fill="#EDEFF3">${t}</text>
            <text x="${x}" y="${y + 26}" font-size="18" fill="#A9B1C1">${s}</text>`).join("")}
      </g>
    </svg>
    <div style="position:relative;display:flex;gap:14px;margin-top:40px">
      ${[["0", "installs to try it"], ["1", "chat to onboard"], ["uk · en", "languages from day one"]].map(([n, t]) => `<div class="box" style="flex:1;padding:20px 22px"><div style="font-size:40px;font-weight:800;color:#F0B429">${n}</div><div style="font-size:19px;color:#A9B1C1;margin-top:2px">${t}</div></div>`).join("")}
    </div>
  </div>${foot(2)}`,

  // 3. Architecture.
  `<div class="glow"></div><div class="slide">
    <div class="kicker">Step 3 · Mobile without a second product</div>
    <h2>Three surfaces.<br><em>One</em> backend.</h2>
    <svg viewBox="0 0 936 900" width="936" height="900" style="position:relative;margin-top:34px">
      <defs><marker id="b" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#6B7488"/></marker></defs>
      <g font-family="DejaVu Sans" text-anchor="middle">
        ${[[156, "🤖 Telegram bot", "grammY · chat + voice"], [468, "📱 Mini App", "Preact · in Telegram"], [780, "📲 Android", "KMP · Compose · Koin"]]
          .map(([x, t, s]) => `<rect x="${x - 145}" y="0" width="290" height="110" rx="20" fill="#161C28" stroke="#252D3B" stroke-width="2"/>
            <text x="${x}" y="48" font-size="26" font-weight="800" fill="#EDEFF3">${t}</text>
            <text x="${x}" y="82" font-size="18" fill="#8A93A6">${s}</text>
            <line x1="${x}" y1="112" x2="${x}" y2="196" stroke="#6B7488" stroke-width="3" marker-end="url(#b)"/>`).join("")}
        <text x="166" y="160" font-size="16" fill="#6B7488" text-anchor="start">webhook</text><text x="478" y="160" font-size="16" fill="#6B7488" text-anchor="start">initData</text><text x="790" y="160" font-size="16" fill="#6B7488" text-anchor="start">token · Keystore</text>
        <rect x="10" y="202" width="916" height="230" rx="24" fill="#1A1608" stroke="#F0B429" stroke-width="3"/>
        <text x="468" y="252" font-size="32" font-weight="800" fill="#F0B429">Cloudflare Worker · one API</text>
        <text x="468" y="290" font-size="19" fill="#C9D0DC">domain rules → application → adapters  (layering enforced by a test)</text>
        ${[[88, 128, "plans"], [226, 160, "progression"], [396, 224, "XP · streaks · quests"], [630, 136, "nutrition"], [776, 140, "auth · limits"]]
          .map(([x, w, t]) => `<rect x="${x}" y="318" width="${w}" height="44" rx="22" fill="#2A2410"/><text x="${x + w / 2}" y="347" font-size="17" fill="#EDEFF3">${t}</text>`).join("")}
        <text x="468" y="404" font-size="18" fill="#A9B1C1">AI providers: Gemini → Groq → OpenRouter → Workers AI → Ollama</text>
        ${[[86, "D1", "accounts, logs"], [242, "Durable Obj", "per-user cron"], [398, "Queues", "broadcasts + DLQ"], [554, "R2", "photos, KB"], [710, "Workers AI", "fallback model"], [856, "FCM", "push"]]
          .map(([x, t, s]) => `<line x1="${x}" y1="434" x2="${x}" y2="500" stroke="#6B7488" stroke-width="3" marker-end="url(#b)"/>
            <rect x="${x - 72}" y="506" width="144" height="100" rx="16" fill="#161C28" stroke="#252D3B" stroke-width="2"/>
            <text x="${x}" y="548" font-size="19" font-weight="800" fill="#EDEFF3">${t}</text>
            <text x="${x}" y="578" font-size="15" fill="#8A93A6">${s}</text>`).join("")}
        <rect x="10" y="660" width="916" height="210" rx="20" fill="#161C28" stroke="#252D3B" stroke-width="2"/>
        <text x="468" y="712" font-size="26" font-weight="800" fill="#EDEFF3">Why it matters</text>
        <text x="468" y="756" font-size="21" fill="#A9B1C1">A workout logged on Android shows up in Telegram instantly.</text>
        <text x="468" y="792" font-size="21" fill="#A9B1C1">Progression rules live in one place, not three.</text>
        <text x="468" y="828" font-size="21" fill="#A9B1C1">Each surface only owns its UI: chat, web view, native.</text>
      </g>
    </svg>
  </div>${foot(3)}`,

  // 4. AI with boundaries.
  `<div class="glow"></div><div class="slide">
    <div class="kicker">Step 4 · AI as an accelerator</div>
    <h2>The model call is <em>one box</em><br>in the pipeline</h2>
    <div style="position:relative;display:flex;flex-direction:column;gap:14px;margin-top:44px">
      ${[["👤", "User context", "goals, equipment, injuries, history, language", ""],
         ["🧩", "Prompt + schema", "structured JSON contract, not free text", ""],
         ["🔁", "Provider fallback", "Gemini → Groq → OpenRouter → Workers AI → Ollama, with budget and retries", "gold"],
         ["🛡️", "Validate against the user", "no barbell for a home user, swap exercises that hit an injury, sane sets/reps", "gold"],
         ["📋", "Deterministic fallback", "a catalog plan if every model fails: the user never sees an error", ""],
         ["💾", "Save + coach", "D1 state, reminders, follow-ups, progress", ""]]
        .map(([e, t, s, c], i) => `${i ? '<div class="arrow" style="font-size:28px">↓</div>' : ""}<div class="box ${c}" style="display:flex;align-items:center;gap:22px;padding:18px 26px">
          <div style="font-size:42px">${e}</div><div><div style="font-size:27px;font-weight:800">${t}</div>
          <div style="font-size:19px;color:#A9B1C1;margin-top:4px">${s}</div></div></div>`).join("")}
    </div>
  </div>${foot(4)}`,

  // 5. Numbers.
  `<div class="glow"></div><div class="slide">
    <div class="kicker">Step 5 · Test the whole journey</div>
    <h2>Proof, not vibes</h2>
    <div style="position:relative;display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:44px">
      ${[["1,457", "backend tests (Node)"], ["92", "Workers-runtime tests"], ["250+", "Android host tests"], ["100+", "D1 schema migrations"], ["10", "architecture decision records"], ["5", "AI providers behind one interface"]]
        .map(([n, t], i) => `<div class="box ${i < 3 ? "gold" : ""}" style="padding:30px 30px">
          <div style="font-size:76px;font-weight:800;letter-spacing:-.04em;color:${i < 3 ? "#F0B429" : "#EDEFF3"}">${n}</div>
          <div style="font-size:22px;color:#A9B1C1;margin-top:6px">${t}</div></div>`).join("")}
    </div>
    <div class="box" style="position:relative;margin-top:22px;padding:24px 30px;font-size:21px;line-height:1.55;color:#C9D0DC">
      CI on every PR: typecheck, lint, CodeQL, architecture rules, Android lint + build.<br>
      Secrets and signing keys never touch the repo.
    </div>
    <div class="box gold" style="position:relative;margin-top:22px;padding:24px 30px">
      <div style="font-size:24px;font-weight:800">…and a real tester still finds what tests miss</div>
      <div style="font-size:20px;line-height:1.6;color:#C9D0DC;margin-top:8px">
        · History list didn't scroll on a small phone<br>
        · Keyboard covered the field you were typing in<br>
        · Rest timer forgot that 90 s was your choice, not 60 s
      </div>
    </div>
  </div>${foot(5)}`,

  // 6. Takeaway.
  `<div class="glow"></div><div class="slide" style="justify-content:center">
    <div class="kicker">The lesson</div>
    <h1 style="font-size:70px">Pick the <em>lowest-friction</em> place to test one user problem.</h1>
    <p class="lead" style="font-size:32px">Expand only when the next surface improves the same loop.</p>
    <div style="position:relative;margin-top:50px;display:flex;flex-direction:column;gap:14px;font-size:26px;color:#C9D0DC">
      <div>📓 &nbsp;Notebook → write the loop in one sentence</div>
      <div>🤖 &nbsp;Bot → test it with real people this week</div>
      <div>📱 &nbsp;Mini App → when chat gets too cramped</div>
      <div>📲 &nbsp;Native → when you need sensors, push, offline</div>
    </div>
    <div class="box gold" style="position:relative;margin-top:56px;padding:28px 32px;font-size:26px">
      Open source → <em>github.com/sanych44474/trix</em>
    </div>
  </div>${foot(6)}`,
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const pdfPages = [];
for (const [i, html] of SLIDES.entries()) {
  await page.setContent(`<!doctype html><meta charset="utf-8">${CSS}<body>${html}</body>`, { waitUntil: "load" });
  await page.screenshot({ path: `${out}/slide-${i + 1}.png` });
  pdfPages.push(`<section style="width:${W}px;height:${H}px;position:relative;overflow:hidden;page-break-after:always">${html}</section>`);
}
await page.setContent(`<!doctype html><meta charset="utf-8">${CSS.replace("overflow: hidden; position: relative;", "")}<style>html,body{height:auto}</style><body>${pdfPages.join("")}</body>`, { waitUntil: "load" });
await page.pdf({ path: `${out}/hack-limits-carousel.pdf`, width: `${W}px`, height: `${H}px`, printBackground: true });
await browser.close();
writeFileSync(`${out}/done.txt`, "ok");
