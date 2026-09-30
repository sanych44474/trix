// Generates grafana/user-activity.json — the "trix — user activity" dashboard. Every panel reads
// GET <worker>/admin/metrics/activity through the Infinity datasource (the same one the owner
// metrics board uses; it carries the X-Admin-Secret header, so no secret lives in this JSON).
// Usage: node scripts/build-grafana-activity.mjs   (then scripts/grafana-push.mjs to upload)
import { writeFileSync } from "node:fs";

const DS = { type: "yesoreyeram-infinity-datasource", uid: "${ds}" };
const URL_ = "${worker}/admin/metrics/activity?days=${days}";
let id = 0;
const q = (root, columns, refId = "A") => ({
  refId, datasource: DS, type: "json", source: "url", format: "table", parser: "backend",
  url: URL_, url_options: { method: "GET", data: "" }, root_selector: root,
  columns: columns.map(([selector, text, type]) => ({ selector, text, type })),
});
const grid = (x, y, w, h) => ({ x, y, w, h });

const stat = (title, field, x, unit = "short", description = "") => ({
  id: ++id, type: "stat", title, description, datasource: DS, gridPos: grid(x, 0, 3, 4),
  targets: [q("summary", [[field, title, "number"]])],
  fieldConfig: { defaults: { unit, color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ color: "blue", value: null }] } }, overrides: [] },
  options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, colorMode: "value", graphMode: "none", textMode: "auto", justifyMode: "auto", orientation: "auto" },
});

const series = (title, columns, pos, draw = "line", description = "") => ({
  id: ++id, type: "timeseries", title, description, datasource: DS, gridPos: pos,
  targets: [q("daily", [["date", "date", "timestamp"], ...columns.map(([s, t]) => [s, t, "number"])])],
  fieldConfig: {
    defaults: { unit: "short", decimals: 0, custom: { drawStyle: draw, lineWidth: 2, fillOpacity: draw === "bars" ? 70 : 12, pointSize: 4, showPoints: "auto", stacking: { mode: "none" }, spanNulls: true } },
    overrides: [],
  },
  options: { legend: { displayMode: "list", placement: "bottom", showLegend: true }, tooltip: { mode: "multi", sort: "desc" } },
});

const table = (title, root, columns, pos, extra = {}) => ({
  id: ++id, type: "table", title, datasource: DS, gridPos: pos,
  targets: [q(root, columns)],
  fieldConfig: { defaults: { custom: { align: "auto", cellOptions: { type: "auto" } } }, overrides: extra.overrides ?? [] },
  options: { showHeader: true, cellHeight: "sm", footer: { show: false, reducer: ["sum"], fields: "" }, ...(extra.sortBy ? { sortBy: extra.sortBy } : {}) },
});

const pctCells = (names) => names.map((name) => ({
  matcher: { id: "byName", options: name },
  properties: [
    { id: "unit", value: "percent" },
    { id: "custom.cellOptions", value: { type: "color-background", mode: "gradient" } },
    { id: "color", value: { mode: "continuous-RdYlGr" } },
    { id: "min", value: 0 }, { id: "max", value: 100 },
  ],
}));

const panels = [
  stat("Користувачів усього", "totalUsers", 0),
  stat("DAU сьогодні", "dauToday", 3),
  stat("DAU, сер. 7 днів", "avgDau7", 6, "short", "Середня кількість активних користувачів на день за останні 7 днів"),
  stat("WAU", "wau", 9, "short", "Активні хоча б раз за 7 днів (тренування, їжа, вода, кроки, чек-ін або дія в боті/застосунку)"),
  stat("MAU", "mau", 12, "short", "Активні хоча б раз за 30 днів"),
  stat("Stickiness DAU/MAU", "stickinessPct", 15, "percent", "Середній DAU за 7 днів / MAU. 20%+ — добре для фітнес-застосунку"),
  stat("Тренувань за 7 днів", "workouts7", 18),
  stat("Нових за 7 днів", "signups7", 21),
  series("Активні користувачі за днями", [["dau", "DAU (будь-яка активність)"], ["workoutUsers", "тренувалися"], ["nutritionUsers", "записали їжу"], ["waterUsers", "вода"], ["stepsUsers", "кроки"]], grid(0, 4, 16, 9), "line",
    "Скільки різних людей щодня робили кожну дію"),
  {
    id: ++id, type: "bargauge", title: "Використання функцій (30 днів, % від усіх)", datasource: DS, gridPos: grid(16, 4, 8, 9),
    targets: [q("adoption", [["feature", "feature", "string"], ["sharePct", "% користувачів", "number"]])],
    fieldConfig: { defaults: { unit: "percent", min: 0, max: 100, color: { mode: "continuous-BlYlRd" }, displayName: "${__data.fields.feature}" }, overrides: [] },
    options: { orientation: "horizontal", displayMode: "gradient", showUnfilled: true, reduceOptions: { calcs: ["lastNotNull"], fields: "", values: true }, valueMode: "color", namePlacement: "left" },
  },
  series("Тренування і чек-іни за днями", [["workouts", "тренувань"], ["checkins", "чек-інів"]], grid(0, 13, 12, 8), "bars"),
  series("Реєстрації і дії в боті/застосунку", [["signups", "нових користувачів"], ["events", "дій (натискань)"]], grid(12, 13, 12, 8), "bars"),
  table("Утримання за тижнем реєстрації: хто тренувався на тижні 1/2/4/8", "retention",
    [["cohort", "Тиждень реєстрації", "string"], ["size", "Людей", "number"], ["w1", "Тиждень 1", "number"], ["w2", "Тиждень 2", "number"], ["w4", "Тиждень 4", "number"], ["w8", "Тиждень 8", "number"]],
    grid(0, 21, 12, 10), { overrides: pctCells(["Тиждень 1", "Тиждень 2", "Тиждень 4", "Тиждень 8"]) }),
  table("Найпопулярніші дії (7 днів)", "topEvents", [["event", "Дія", "string"], ["n", "Разів", "number"], ["users", "Людей", "number"]], grid(12, 21, 12, 10),
    { sortBy: [{ displayName: "Разів", desc: true }] }),
  table("Найактивніші користувачі (30 днів)", "topUsers",
    [["name", "Ім'я", "string"], ["activeDays", "Активних днів", "number"], ["workouts", "Тренувань", "number"], ["nutritionDays", "Днів з їжею", "number"], ["lastActive", "Остання активність", "string"], ["id", "id", "number"]],
    grid(0, 31, 24, 9), { sortBy: [{ displayName: "Активних днів", desc: true }] }),
];

const dashboard = {
  uid: "trix-user-activity",
  title: "trix — активність користувачів",
  tags: ["trix"],
  timezone: "browser",
  schemaVersion: 39,
  refresh: "1h",
  time: { from: "now-30d", to: "now" },
  editable: true,
  templating: {
    list: [
      { name: "ds", label: "Джерело (Infinity)", type: "datasource", query: "yesoreyeram-infinity-datasource", current: {}, hide: 0, refresh: 1 },
      { name: "worker", label: "Worker URL", type: "textbox", query: "https://trix.workers.dev", current: { text: "https://trix.workers.dev", value: "https://trix.workers.dev" }, hide: 0 },
      { name: "days", label: "Днів", type: "custom", query: "14,30,60,90", current: { text: "30", value: "30" }, options: [], hide: 0 },
    ],
  },
  panels,
};

writeFileSync(new URL("../grafana/user-activity.json", import.meta.url), JSON.stringify(dashboard, null, 2) + "\n");
console.log(`wrote grafana/user-activity.json (${panels.length} panels)`);
