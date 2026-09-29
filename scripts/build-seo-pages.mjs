// Builds the landing's search pages (docs/<slug>/index.html, uk + en) and docs/sitemap.xml from
// the content below. The main landing (docs/index.html) is one bilingual page switched by JS, so
// crawlers only ever see its Ukrainian half and one topic; these pages give each real search
// intent ("free AI trainer in Telegram", "home workout plan", "macros from a photo") its own
// indexable URL, with FAQ structured data and links back to the bot. Everything stated here is a
// shipped feature (docs/features.md). Run: node scripts/build-seo-pages.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = "https://sanych44474.github.io/trix/";
const BOT = "https://t.me/hack_limits_bot";
const REPO = "https://github.com/sanych44474/trix";
const TODAY = new Date().toISOString().slice(0, 10);

/** Each topic exists in both languages; `pair` links the two for hreflang. */
const PAGES = [
  {
    lang: "uk", slug: "ai-trener-telegram", pair: "en/ai-fitness-coach-telegram",
    title: "Безкоштовний AI-тренер у Telegram — trix",
    description: "AI-тренер у Telegram: складає програму тренувань під твої дні, обладнання й травми, веде прогресію, рахує КБЖУ за фото і нагадує сам. Безкоштовно, без реклами.",
    kicker: "AI-тренер у Telegram",
    h1: "Безкоштовний AI-тренер прямо в Telegram",
    lead: "trix — це бот і міні-застосунок у Telegram, який працює як персональний тренер: розпитує про цілі й обмеження, складає програму, веде щоденник і сам вирішує, коли додати вагу. Нічого встановлювати не треба, підписки немає.",
    sections: [
      ["Програма під тебе, а не шаблон", "Коротке інтерв'ю кнопками: рівень, цілі, скільки днів на тиждень, яке обладнання є, які травми чи обмеження. Після нього — готовий спліт із підходами, вагами, відпочинком і технікою. План сам перевіряє баланс м'язів: якщо бракує спини чи задньої поверхні стегна, потрібна вправа додається ще до того, як ти його побачиш."],
      ["Прогресія без таблиць", "Записуєш підходи в міні-застосунку в один дотик або просто пишеш у чат текстом чи голосом. Бот бачить, коли ти готовий додати вагу, коли застряг на плато і коли потрібне розвантаження, і пояснює, чому."],
      ["Бачиш, що працює", "Карта тіла показує навантаження по кожному м'язу за тиждень, відновлення після тренувань і тренд за 12 тижнів. Якщо сьогоднішні м'язи ще втомлені, trix запропонує поміняти день із пізнішим."],
      ["Техніка і харчування", "Фото техніки та короткі кроки для кожної вправи, перевірка техніки за відео підходу. КБЖУ з тексту або фото тарілки, меню від AI і список покупок."],
      ["Приходить першим", "Бот сам пише в день тренування, нагадує про відпочинок між підходами і збирає вечірній підсумок. Саме тому про нього не забувають, як про окремий застосунок."],
    ],
    faq: [
      ["Це справді безкоштовно?", "Так. trix працює на безкоштовних тарифах Cloudflare і AI-провайдерів, без підписки й без реклами. Добровільно підтримати проєкт можна зірками Telegram, але нічого за це не відкривається."],
      ["Що треба встановити?", "Нічого. Відкрий бота в Telegram і натисни «Старт» — інтерв'ю, програма і міні-застосунок працюють прямо в Telegram на телефоні чи комп'ютері."],
      ["Чи підходить для новачків?", "Так. Програма враховує рівень, а для кожної вправи є фото техніки й короткі кроки. Можна тренуватись удома з власною вагою або в залі."],
      ["Чи можна тренуватись із тренером?", "Так. Живий тренер може під'єднати клієнтів, редагувати їхні плани, бачити щоденник і вести розклад та оплати. AI-режим працює і без тренера."],
      ["Чи замінює це лікаря?", "Ні. trix дає поради з тренувань і харчування, але не є медичною порадою. При болю чи травмі звернись до фахівця."],
    ],
    related: ["programa-trenuvan-vdoma", "kbzhu-za-foto"],
    cta: "Відкрити trix у Telegram",
  },
  {
    lang: "uk", slug: "programa-trenuvan-vdoma", pair: "en/home-workout-plan",
    title: "Програма тренувань вдома — безкоштовно в Telegram | trix",
    description: "Програма тренувань вдома з власною вагою, гантелями чи резинками: під твої дні й рівень, з технікою кожної вправи та прогресією. Безкоштовно в Telegram.",
    kicker: "Тренування вдома",
    h1: "Програма тренувань вдома — під твоє обладнання",
    lead: "Не треба шукати готовий план і підлаштовуватися під нього. trix питає, що в тебе є вдома — нічого, гантелі, резинки чи турнік, — скільки днів на тиждень ти можеш тренуватись, і складає програму саме під це.",
    sections: [
      ["Під будь-яке обладнання", "Тільки власна вага, пара гантелей, еспандери, турнік — програма використовує те, що є. Якщо сьогодні доступ до обладнання інший, кнопка «не мій зал сьогодні» замінить вправи на доступні."],
      ["Правильна техніка", "Для кожної вправи — фото початку й кінця руху та 3–5 коротких кроків українською. Можна надіслати відео підходу, і AI дасть 2–3 конкретні підказки щодо техніки."],
      ["Прогрес удома теж можливий", "Щоденник підходів у міні-застосунку, автоматична прогресія повторів і ваги, розвантажувальні тижні. Карта тіла показує, які м'язи ти навантажуєш, а які пропускаєш."],
      ["Збалансований план", "Програма сама стежить, щоб груди й спина, квадрицепс і задня поверхня стегна отримували співмірне навантаження, і додає вправу, якщо чогось бракує."],
      ["Нагадування", "У дні тренувань бот пише першим, а таймер відпочинку надішле сповіщення в Telegram, коли час на наступний підхід."],
    ],
    faq: [
      ["Скільки разів на тиждень тренуватись удома?", "Скільки тобі реально зручно: trix складає програму на 2–6 днів і розподіляє м'язи так, щоб вони встигали відновлюватися."],
      ["Можна без жодного обладнання?", "Так, програма може бути повністю з власною вагою: присідання, випади, віджимання, планки, ягідний місток та інші вправи з поступовим ускладненням."],
      ["Скільки часу займає тренування?", "Ти сам вказуєш тривалість сесії, і кількість вправ підбирається під неї — від коротких 30-хвилинних тренувань."],
      ["Що робити, якщо вправа не підходить?", "Її можна замінити в один дотик на альтернативу з того ж м'яза або ввести свою — застосунок запам'ятає заміну."],
    ],
    related: ["ai-trener-telegram", "kbzhu-za-foto"],
    shot: "app-summary.png",
    cta: "Отримати програму в Telegram",
  },
  {
    lang: "uk", slug: "kbzhu-za-foto", pair: "en/calorie-counter-from-photo",
    title: "Калькулятор КБЖУ за фото їжі — безкоштовно в Telegram | trix",
    description: "Сфотографуй тарілку — trix оцінить калорії, білки, жири й вуглеводи і порівняє з твоєю ціллю. Також за текстом і з базою продуктів Open Food Facts. Безкоштовно в Telegram.",
    kicker: "КБЖУ за фото",
    h1: "Калькулятор КБЖУ за фото — просто надішли тарілку",
    lead: "Рахувати калорії вручну довго, тому більшість кидає за тиждень. У trix достатньо сфотографувати їжу або написати «200 г курки, рис» — бот оцінить КБЖУ і покаже, скільки лишилось до цілі на день.",
    sections: [
      ["Фото або текст", "Надішли фото страви в чат — AI розпізнає продукти й порції. Або напиши, що з'їв, звичайними словами. Перед записом бот покаже, що розпізнав, і дасть виправити вагу чи продукт."],
      ["Точні дані з бази продуктів", "Для упакованих продуктів є пошук в Open Food Facts: точні значення на 100 г, обираєш продукт і грами."],
      ["Ціль, яка підлаштовується", "Калорії й макроси розраховуються під твою ціль — схуднення, набір чи підтримку, — а адаптивна ціль коригується за реальною динамікою ваги і пояснює, чому."],
      ["Меню й покупки", "AI складе меню на день у межах твоїх КБЖУ, а зі страв — список покупок, згрупований за відділами магазину."],
      ["Разом із тренуваннями", "Харчування, тренування, вага й заміри — в одному місці, тож видно, як усе впливає на результат."],
    ],
    faq: [
      ["Наскільки точно рахує за фото?", "Фото — це оцінка: AI визначає продукти й приблизну порцію. Тому бот завжди показує результат перед записом і дає виправити вагу в один дотик. Для точності можна зважити продукт або знайти його в базі."],
      ["Чи треба зважувати їжу?", "Не обов'язково. Для старту достатньо фото чи опису, а коли хочеться точності — вкажи грами."],
      ["Чи рахує алкоголь?", "Так, калорії алкоголю враховуються окремо."],
      ["Це безкоштовно?", "Так, без підписки й реклами, прямо в Telegram."],
    ],
    related: ["ai-trener-telegram", "programa-trenuvan-vdoma"],
    shot: "app-progress.png",
    cta: "Порахувати КБЖУ в Telegram",
  },
  {
    lang: "en", slug: "en/ai-fitness-coach-telegram", pair: "ai-trener-telegram",
    title: "Free AI Fitness Coach in Telegram — trix",
    description: "An AI personal trainer in Telegram: builds a workout plan around your days, equipment and injuries, runs progression, counts macros from a photo and reminds you first. Free, no ads, open source.",
    kicker: "AI coach in Telegram",
    h1: "A free AI fitness coach, right inside Telegram",
    lead: "trix is a Telegram bot and Mini App that works like a personal trainer: it asks about your goals and limits, writes the program, keeps the log and decides when to add weight. Nothing to install, no subscription.",
    sections: [
      ["A program built for you", "A short button interview — level, goals, days per week, equipment, injuries — and you get a full split with sets, weights, rest and technique. The plan checks its own muscle balance and adds what's missing before you ever see it."],
      ["Progression without spreadsheets", "Log sets in the Mini App with one tap, or just type or voice-message the chat. trix sees when you're ready to add weight, when you've plateaued and when a deload is due, and tells you why."],
      ["See what's working", "A body map shows each muscle's weekly load, recovery since your last sessions and a 12-week trend. If today's muscles are still tired, trix offers to swap the day with a later one."],
      ["Technique and nutrition", "Technique pictures and short steps for every exercise, a form check from a video of your set, macros from text or a photo of your plate, an AI meal plan and a shopping list."],
      ["It comes to you first", "The bot messages you on training days, pings you when rest is over and runs an evening check-in — which is why it doesn't get forgotten like another app."],
    ],
    faq: [
      ["Is it really free?", "Yes. trix runs on Cloudflare's and the AI providers' free tiers, with no subscription and no ads. You can support it with Telegram Stars, but nothing is unlocked by that."],
      ["What do I need to install?", "Nothing. Open the bot in Telegram and tap Start — the interview, the program and the Mini App all run inside Telegram on your phone or computer."],
      ["Is it suitable for beginners?", "Yes. The program adapts to your level and every exercise has technique pictures and short steps. Train at home with bodyweight or in a gym."],
      ["Can I train with a real coach?", "Yes. A trainer can connect clients, edit their plans, see their logs and manage schedule and payments. The AI mode works without a trainer too."],
      ["Is it open source?", "Yes, MIT-licensed on GitHub — you can fork it and run your own coach."],
    ],
    related: ["en/home-workout-plan", "en/calorie-counter-from-photo"],
    cta: "Open trix in Telegram",
  },
  {
    lang: "en", slug: "en/home-workout-plan", pair: "programa-trenuvan-vdoma",
    title: "Free Home Workout Plan in Telegram — trix",
    description: "A home workout plan for bodyweight, dumbbells or bands, built around your days and level, with technique for every exercise and automatic progression. Free in Telegram.",
    kicker: "Home workouts",
    h1: "A home workout plan built around your equipment",
    lead: "Stop bending yourself to a generic plan. trix asks what you have at home — nothing, dumbbells, bands or a pull-up bar — and how many days a week you can train, then writes a program for exactly that.",
    sections: [
      ["Any equipment", "Bodyweight only, a pair of dumbbells, resistance bands, a pull-up bar — the program uses what you have. If today is different, “not my gym today” swaps in exercises you can do."],
      ["Good technique", "Start and finish pictures plus 3–5 short steps for every exercise. Send a video of your set and the AI gives 2–3 concrete technique cues."],
      ["Real progress at home", "A set log in the Mini App, automatic rep and weight progression, deload weeks. The body map shows which muscles you train and which you skip."],
      ["A balanced plan", "The program keeps chest and back, quads and hamstrings in proportion, and adds an exercise when something is missing."],
      ["Reminders", "On training days the bot messages you first, and the rest timer pings you in Telegram when the next set is due."],
    ],
    faq: [
      ["How many days a week should I train at home?", "As many as you can realistically keep: trix builds 2–6 day programs and spreads muscles so they have time to recover."],
      ["Can I train with no equipment at all?", "Yes — a fully bodyweight program with squats, lunges, push-ups, planks, glute bridges and more, with progressions as you get stronger."],
      ["How long is a session?", "You set the session length and the number of exercises follows it, down to 30-minute workouts."],
      ["What if an exercise doesn't suit me?", "Swap it in one tap for an alternative for the same muscle, or type your own — the app remembers the swap."],
    ],
    related: ["en/ai-fitness-coach-telegram", "en/calorie-counter-from-photo"],
    shot: "app-summary.png",
    cta: "Get your plan in Telegram",
  },
  {
    lang: "en", slug: "en/calorie-counter-from-photo", pair: "kbzhu-za-foto",
    title: "Calorie & Macro Counter from a Photo — Free in Telegram | trix",
    description: "Snap your plate and trix estimates calories, protein, fat and carbs against your daily target. Also from plain text and the Open Food Facts database. Free in Telegram.",
    kicker: "Macros from a photo",
    h1: "Count calories and macros from a photo of your food",
    lead: "Logging food by hand is tedious, so most people quit within a week. With trix you just snap your meal or type “200 g chicken, rice” — it estimates the macros and shows what's left for the day.",
    sections: [
      ["Photo or text", "Send a photo of your meal and the AI recognises the foods and portions, or describe it in plain words. Before logging, the bot shows what it found and lets you fix the weight or the food."],
      ["Exact data from a food database", "For packaged food there's Open Food Facts search: exact per-100 g values, pick the product and the grams."],
      ["A target that adapts", "Calories and macros follow your goal — lose, gain or maintain — and the adaptive target adjusts to your real weight trend and explains why."],
      ["Meal plan and shopping", "The AI builds a day's menu within your macros and turns it into a shopping list grouped by store aisle."],
      ["Together with training", "Food, workouts, weight and measurements in one place, so you can see how it all moves the needle."],
    ],
    faq: [
      ["How accurate is counting from a photo?", "A photo is an estimate: the AI identifies foods and an approximate portion. That's why the bot always shows the result before logging and lets you fix the weight in one tap. For precision, weigh it or pick it from the database."],
      ["Do I have to weigh my food?", "No. A photo or description is enough to start; add grams when you want precision."],
      ["Does it count alcohol?", "Yes, alcohol calories are counted."],
      ["Is it free?", "Yes — no subscription, no ads, right in Telegram."],
    ],
    related: ["en/ai-fitness-coach-telegram", "en/home-workout-plan"],
    shot: "app-progress.png",
    cta: "Count macros in Telegram",
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (slug) => `${SITE}${slug}/`;
const bySlug = new Map(PAGES.map((p) => [p.slug, p]));
const UI = {
  uk: { home: "Головна", faq: "Часті питання", more: "Також може бути корисно", free: "Безкоштовно · без реклами · відкритий код", medical: "Не є медичною порадою", other: "English" },
  en: { home: "Home", faq: "FAQ", more: "You might also like", free: "Free · no ads · open source", medical: "Not medical advice", other: "Українською" },
};

function page(p) {
  const ui = UI[p.lang];
  const depth = p.slug.split("/").length; // docs/<slug>/index.html → assets are depth levels up
  const up = "../".repeat(depth);
  const pair = bySlug.get(p.pair);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "trix",
      applicationCategory: "HealthApplication",
      operatingSystem: "Telegram",
      url: BOT,
      description: p.description,
      inLanguage: p.lang,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: `${REPO}/blob/main/LICENSE`,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "trix", item: SITE },
        { "@type": "ListItem", position: 2, name: p.kicker, item: url(p.slug) },
      ],
    },
  ];
  return `<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url(p.slug)}">
<link rel="alternate" hreflang="${p.lang}" href="${url(p.slug)}">
<link rel="alternate" hreflang="${pair.lang}" href="${url(pair.slug)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="trix">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url(p.slug)}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏋️</text></svg>">
<link rel="stylesheet" href="${up}assets/seo.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<div class="wrap">
  <header class="bar">
    <a class="brand" href="${up}">tri<span>x</span></a>
    <nav><a class="ghost" href="${url(pair.slug)}" hreflang="${pair.lang}">${ui.other}</a></nav>
  </header>
  <nav class="crumbs" aria-label="breadcrumb"><a href="${up}">${ui.home}</a> › <span>${esc(p.kicker)}</span></nav>
  <main>
    <p class="kicker">${esc(p.kicker)}</p>
    <h1>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <p><a class="cta" href="${BOT}">${esc(p.cta)} →</a> <span class="note">${ui.free}</span></p>
    <figure class="shot"><img src="${up}img/${p.shot ?? "app-train.png"}" alt="${esc(p.kicker)} — trix" width="390" height="844" loading="lazy"></figure>
${p.sections.map(([h, t]) => `    <section><h2>${esc(h)}</h2><p>${esc(t)}</p></section>`).join("\n")}
    <section class="faq"><h2>${ui.faq}</h2>
${p.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
    </section>
    <p><a class="cta" href="${BOT}">${esc(p.cta)} →</a></p>
    <section class="more"><h2>${ui.more}</h2><ul>
${p.related.map((s) => `      <li><a href="${url(s)}">${esc(bySlug.get(s).h1)}</a></li>`).join("\n")}
      <li><a href="${up}">${p.lang === "uk" ? "trix — усі можливості" : "trix — everything it does"}</a></li>
    </ul></section>
  </main>
  <footer><span>© 2026 trix</span> <a href="${REPO}">GitHub</a> <a href="${REPO}/blob/main/LICENSE">MIT</a> <span>${ui.medical}</span></footer>
</div>
</body>
</html>
`;
}

for (const p of PAGES) {
  const dir = new URL(`../docs/${p.slug}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("index.html", dir), page(p));
}

const urls = [SITE, ...PAGES.map((p) => url(p.slug))];
writeFileSync(
  new URL("../docs/sitemap.xml", import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`,
);
console.log(`wrote ${PAGES.length} pages + sitemap (${urls.length} urls)`);
export { PAGES, SITE };
