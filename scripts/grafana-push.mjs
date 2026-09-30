// Uploads the dashboards in grafana/*.json to a Grafana instance (creates or overwrites by uid).
// Credentials come from the environment only — never commit them:
//   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=glsa_... [WORKER_URL=https://...] \
//     node scripts/grafana-push.mjs
// WORKER_URL, when set, becomes the dashboards' default "worker" variable. The Infinity datasource
// must already exist with the X-Admin-Secret header and the Worker's host in its allowed hosts.
import { readdirSync, readFileSync } from "node:fs";

const base = process.env.GRAFANA_URL?.replace(/\/$/, "");
const token = process.env.GRAFANA_TOKEN;
if (!base || !token) {
  console.error("Set GRAFANA_URL and GRAFANA_TOKEN.");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const sources = await (await fetch(`${base}/api/datasources`, { headers })).json();
const infinity = Array.isArray(sources) ? sources.find((d) => d.type === "yesoreyeram-infinity-datasource") : undefined;
if (!infinity) console.warn("No Infinity datasource found — install the plugin and add one (with the X-Admin-Secret header) first.");

const dir = new URL("../grafana/", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const dashboard = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  for (const v of dashboard.templating?.list ?? []) {
    if (v.name === "ds" && infinity) v.current = { text: infinity.name, value: infinity.uid };
    if (v.name === "worker" && process.env.WORKER_URL) {
      const w = process.env.WORKER_URL.replace(/\/$/, "");
      v.query = w;
      v.current = { text: w, value: w };
    }
  }
  delete dashboard.id;
  const res = await fetch(`${base}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "scripts/grafana-push.mjs" }) });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? `✓ ${file} → ${base}${body.url ?? ""}` : `✗ ${file}: ${res.status} ${JSON.stringify(body)}`);
  if (!res.ok) process.exitCode = 1;
}
