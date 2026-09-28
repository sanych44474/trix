// Portrait (9:16) cards for Telegram stories, drawn on a canvas and uploaded as a short-lived
// public image (src/webapp/storyMedia.ts) because shareToStory only takes a URL.
import { apiForm } from "./api";
import { shareToStory } from "./telegram";

export interface StoryCard {
  eyebrow: string; // small line on top, e.g. the date range
  title: string; // big headline, e.g. "New record"
  highlight?: string; // one accented line under it, e.g. the exercise
  rows: Array<[label: string, value: string]>;
  footer: string; // call to action at the bottom
}

const W = 1080;
const H = 1920;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function wrap(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawStoryCard(card: StoryCard): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#c9391a");
  bg.addColorStop(0.45, "#3a1a14");
  bg.addColorStop(1, "#0b0d11");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const x = 96;
  let y = 260;
  g.fillStyle = "rgba(255,255,255,.72)";
  g.font = `600 40px ${FONT}`;
  g.fillText(card.eyebrow.toUpperCase(), x, y);
  y += 120;
  g.fillStyle = "#ffffff";
  g.font = `800 112px ${FONT}`;
  for (const line of wrap(g, card.title, W - x * 2)) { g.fillText(line, x, y); y += 124; }
  if (card.highlight) {
    y += 10;
    g.fillStyle = "#ffb4a1";
    g.font = `700 60px ${FONT}`;
    for (const line of wrap(g, card.highlight, W - x * 2).slice(0, 3)) { g.fillText(line, x, y); y += 76; }
  }
  y += 70;
  // Telegram draws its own controls over the bottom of a story; rows stop well above the footer.
  const rowsBottom = H - 320;
  for (const [label, value] of card.rows.slice(0, 6)) {
    if (y + 150 > rowsBottom) break;
    g.fillStyle = "rgba(255,255,255,.08)";
    g.beginPath();
    g.roundRect(x, y, W - x * 2, 150, 28);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.7)";
    g.font = `500 40px ${FONT}`;
    g.fillText(label, x + 44, y + 90);
    g.fillStyle = "#ffffff";
    g.font = `800 64px ${FONT}`;
    g.textAlign = "right";
    g.fillText(value, W - x - 44, y + 98);
    g.textAlign = "left";
    y += 176;
  }
  g.fillStyle = "#ffffff";
  g.font = `800 64px ${FONT}`;
  g.fillText("trix", x, H - 200);
  g.fillStyle = "rgba(255,255,255,.72)";
  g.font = `500 40px ${FONT}`;
  g.fillText(card.footer, x, H - 136);
  return canvas;
}

/** Draws, uploads and opens Telegram's story editor. Throws when the upload fails. */
export async function shareStoryCard(card: StoryCard, caption?: string): Promise<void> {
  const canvas = drawStoryCard(card);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas export failed");
  const form = new FormData();
  form.append("photo", blob, "story.png");
  const { url } = await apiForm<{ url: string }>("/api/v2/story", form);
  shareToStory(url, caption);
}

/** An on-screen SVG (the body map figure) as an image the story canvas can draw. */
async function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.viewBox?.baseVal;
  const w = box?.width || svg.clientWidth || 200;
  const h = box?.height || svg.clientHeight || 400;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("style"); // the page's CSS sizing doesn't apply off-page
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await img.decode();
  return img;
}

/** The body map as a story: the card's header and footer, the front/back figures in the middle,
 *  and up to three short lines under them (top muscles, or what's still recovering). */
export async function drawBodyMapStory(card: Omit<StoryCard, "rows">, figures: SVGSVGElement[], lines: string[]): Promise<HTMLCanvasElement> {
  const canvas = drawStoryCard({ ...card, rows: [] });
  const g = canvas.getContext("2d")!;
  const images = await Promise.all(figures.slice(0, 2).map(svgImage));
  // Figures between the header and the text lines; the lines end above Telegram's own controls
  // and the "trix" footer (drawStoryCard puts it at H - 200).
  const top = 580;
  const boxH = 760;
  const gap = 40;
  const boxW = (W - 96 * 2 - gap) / Math.max(1, images.length);
  images.forEach((img, i) => {
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    g.drawImage(img, 96 + i * (boxW + gap) + (boxW - w) / 2, top + (boxH - h) / 2, w, h);
  });
  let y = top + boxH + 80;
  g.fillStyle = "#ffffff";
  g.font = `600 44px ${FONT}`;
  for (const line of lines.slice(0, 3)) {
    for (const part of wrap(g, line, W - 96 * 2).slice(0, 2)) { g.fillText(part, 96, y); y += 58; }
    y += 10;
  }
  return canvas;
}

export async function shareBodyMapStory(card: Omit<StoryCard, "rows">, figures: SVGSVGElement[], lines: string[], caption?: string): Promise<void> {
  const canvas = await drawBodyMapStory(card, figures, lines);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas export failed");
  const form = new FormData();
  form.append("photo", blob, "story.png");
  const { url } = await apiForm<{ url: string }>("/api/v2/story", form);
  shareToStory(url, caption);
}
