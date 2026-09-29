// Renders the listing images in marketing/img/ from HTML (the landing's colours and type), so
// they can be regenerated after a redesign or new screenshots. Needs Playwright with Chromium:
//   npx playwright install chromium   (once)
//   node marketing/build-images.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

const require = createRequire(process.env.PLAYWRIGHT_ROOT ? `${process.env.PLAYWRIGHT_ROOT}/` : import.meta.url);
const { chromium } = require("playwright");

const out = new URL("./img/", import.meta.url);
mkdirSync(out, { recursive: true });
const shot = (name) => `data:image/png;base64,${readFileSync(new URL(`../docs/img/${name}`, import.meta.url)).toString("base64")}`;

const BASE = `
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #0E121A; color: #EDEFF3; font-family: "Source Sans 3", system-ui, sans-serif; overflow: hidden; }
  h1, h2, .logo { font-family: Archivo, system-ui, sans-serif; letter-spacing: -.03em; }
  .logo span, em { color: #F0B429; font-style: normal; }
  .phone { border-radius: 36px; border: 2px solid #252D3B; box-shadow: 0 30px 80px rgba(0,0,0,.5); display: block; }
  .glow { position: absolute; inset: 0; background: radial-gradient(circle at 80% 20%, rgba(240,180,41,.18), transparent 55%); }
</style>`;

const IMAGES = [
  {
    // Bot profile photo: Telegram crops it to a circle, so the mark sits well inside.
    file: "avatar-512.png", w: 512, h: 512,
    html: `<div style="width:512px;height:512px;display:grid;place-items:center;background:radial-gradient(circle at 30% 25%,#2a2210,#0E121A 70%)">
      <div style="text-align:center"><div style="font-size:150px;line-height:1">🏋️</div>
      <div class="logo" style="font-size:108px;font-weight:800;margin-top:6px">tri<span>x</span></div></div></div>`,
  },
  {
    // BotFather "description picture": shown above the description in an empty chat (640×360).
    file: "botfather-description-640x360.png", w: 640, h: 360,
    html: `<div style="position:relative;width:640px;height:360px;padding:34px 36px;display:grid;grid-template-columns:1.25fr .75fr;gap:10px">
      <div class="glow"></div>
      <div style="position:relative;align-self:center">
        <div class="logo" style="font-size:30px;font-weight:800">tri<span>x</span></div>
        <h1 style="font-size:40px;line-height:1.02;margin:12px 0 12px">AI-тренер<br><em>у Telegram</em></h1>
        <div style="font-size:17px;color:#B6BECD;line-height:1.4">Програма під твої дні й обладнання · прогресія · КБЖУ за фото · карта м'язів</div>
        <div style="margin-top:14px;font-size:15px;color:#F0B429;font-weight:600">Безкоштовно · без реклами</div>
      </div>
      <img class="phone" src="${shot("app-train.png")}" style="position:relative;width:170px;margin:4px 0 0 auto">
    </div>`,
  },
];

const browser = await chromium.launch();
for (const img of IMAGES) {
  const page = await browser.newPage({ viewport: { width: img.w, height: img.h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${BASE}</head><body>${img.html}</body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(img.file, out).pathname, clip: { x: 0, y: 0, width: img.w, height: img.h } });
  await page.close();
  console.log("wrote", img.file);
}
await browser.close();
