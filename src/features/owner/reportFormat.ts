// Plain-text formatting for the owner reports: monospace tables, bars and sparklines.
import { escapeHtml } from "../../locales/i18n";

// Telegram renders no real tables — a monospace <pre> block with space-aligned columns is the
// only table-like option. First column left-aligned (labels), the rest right-aligned (numbers).
export function monoTable(headers: string[], rows: (string | number)[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (cells: (string | number)[]) =>
    cells.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ");
  const sep = w.map((n) => "-".repeat(n)).join("  ");
  return `<pre>${escapeHtml([fmt(headers), sep, ...rows.map(fmt)].join("\n"))}</pre>`;
}

// Visual helpers for report sections. Telegram renders no CSS/tables — unicode does the work:
// ▰▱ progress bars for shares, ▁▂▃▄▅▆▇█ sparklines for day-by-day trends.
export function pctBar(part: number, total: number, width = 10): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, part / total)) : 0;
  const filled = Math.round(ratio * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function sparkline(values: number[]): string {
  if (!values.length) return "";
  const chars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(chars.length - 1, Math.round((v / max) * (chars.length - 1)))]).join("");
}

export const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

// Ranked list with proportional bars: `  42 ▇▇▇▇▇▇▇▇ menu:today` — reads faster than a
// two-column count table when the point is "what dominates".
export function barList(rows: { label: string; n: number }[], maxBar = 8): string {
  const top = Math.max(...rows.map((r) => r.n), 1);
  const w = Math.max(...rows.map((r) => String(r.n).length));
  const lines = rows.map((r) => {
    const bar = "▇".repeat(Math.max(1, Math.round((r.n / top) * maxBar)));
    return `${String(r.n).padStart(w)} ${bar.padEnd(maxBar)} ${r.label}`;
  });
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}
