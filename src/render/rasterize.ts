// A tiny SVG-path rasterizer used at BUILD time (scripts/build-bodymap-masks.ts) to turn
// react-muscle-highlighter's body paths into the pixel masks src/render/bodyMapMasks.ts ships:
// paths are flattened to polygons and scan-converted (nonzero winding, 4 sub-scanlines, exact
// coverage along x). Kept out of the Worker's hot path -- parsing ~600 paths costs tens of ms,
// over the free plan's CPU budget -- so the Worker only composites the precomputed masks.
import { bodyFront } from "../../node_modules/react-muscle-highlighter/dist/esm/assets/bodyFront.js";
import { bodyBack } from "../../node_modules/react-muscle-highlighter/dist/esm/assets/bodyBack.js";
import { bodyFemaleFront } from "../../node_modules/react-muscle-highlighter/dist/esm/assets/bodyFemaleFront.js";
import { bodyFemaleBack } from "../../node_modules/react-muscle-highlighter/dist/esm/assets/bodyFemaleBack.js";

export type Pt = [number, number];

// ---------- SVG path → polygons ----------

function tokenize(d: string): string[] {
  return d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
}

const isCmd = (tok: string | undefined) => tok !== undefined && /^[A-Za-z]$/.test(tok);

/** Arc arguments. The two flags are single characters that SVG lets you pack against the next
 *  number ("0 01.3" = large 0, sweep 1, x .3), so they're read character by character. */
function arcArgs(tokens: string[], i: number): { args: number[]; next: number } {
  const args: number[] = [];
  let j = i;
  while (args.length < 7 && j < tokens.length && !isCmd(tokens[j])) {
    const tok = tokens[j]!;
    if (args.length === 3 || args.length === 4) {
      args.push(tok[0] === "1" ? 1 : 0);
      if (tok.length > 1) tokens[j] = tok.slice(1); // the rest is the next flag or number
      else j++;
      continue;
    }
    args.push(Number(tok));
    j++;
  }
  return { args, next: j };
}

function arcPoints(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number, steps: number): Pt[] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const pts: Pt[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    pts.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return pts;
}

/** Flattens a path into closed polygons (curves into `steps` segments -- plenty at this size). */
export function pathToPolygons(d: string, steps = 4): Pt[][] {
  const t = tokenize(d);
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "";
  let lastCtrl: Pt | null = null;
  let i = 0;
  const num = () => Number(t[i++]);
  const close = () => { if (cur.length > 2) polys.push(cur); cur = []; };
  while (i < t.length) {
    if (isCmd(t[i])) cmd = t[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": { close(); x = ox + num(); y = oy + num(); sx = x; sy = y; cur.push([x, y]); cmd = rel ? "l" : "L"; lastCtrl = null; break; }
      case "L": { x = ox + num(); y = oy + num(); cur.push([x, y]); lastCtrl = null; break; }
      case "H": { x = (rel ? x : 0) + num(); cur.push([x, y]); lastCtrl = null; break; }
      case "V": { y = (rel ? y : 0) + num(); cur.push([x, y]); lastCtrl = null; break; }
      case "C": case "S": {
        let c1: Pt;
        if (cmd.toUpperCase() === "C") c1 = [ox + num(), oy + num()];
        else c1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c2: Pt = [ox + num(), oy + num()];
        const e: Pt = [ox + num(), oy + num()];
        for (let k = 1; k <= steps; k++) {
          const s = k / steps, u = 1 - s;
          cur.push([u * u * u * x + 3 * u * u * s * c1[0] + 3 * u * s * s * c2[0] + s * s * s * e[0], u * u * u * y + 3 * u * u * s * c1[1] + 3 * u * s * s * c2[1] + s * s * s * e[1]]);
        }
        lastCtrl = c2; x = e[0]; y = e[1];
        break;
      }
      case "Q": case "T": {
        const c: Pt = cmd.toUpperCase() === "Q" ? [ox + num(), oy + num()] : lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const e: Pt = [ox + num(), oy + num()];
        for (let k = 1; k <= steps; k++) {
          const s = k / steps, u = 1 - s;
          cur.push([u * u * x + 2 * u * s * c[0] + s * s * e[0], u * u * y + 2 * u * s * c[1] + s * s * e[1]]);
        }
        lastCtrl = c; x = e[0]; y = e[1];
        break;
      }
      case "A": {
        const { args, next } = arcArgs(t, i);
        i = next;
        const [rx, ry, rot, large, sweep, ax, ay] = args as [number, number, number, number, number, number, number];
        const ex = ox + ax, ey = oy + ay;
        cur.push(...arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey, steps));
        x = ex; y = ey; lastCtrl = null;
        break;
      }
      case "Z": { x = sx; y = sy; close(); lastCtrl = null; if (t[i] !== undefined && !isCmd(t[i])) cmd = "L"; break; }
      default: i++;
    }
  }
  close();
  return polys;
}

// ---------- scan conversion ----------

const SS = 4; // supersamples per axis

export interface Layer { polys: Pt[][]; rgb: [number, number, number] }

/** Paints layers in order onto an RGB buffer (nonzero winding; SS sub-scanlines per pixel row,
 *  exact fractional coverage along x). Edges are sorted by top y and swept with an active list,
 *  and only the touched span of the coverage row is cleared -- the whole image costs a few ms. */
export function paint(buf: Uint8Array, w: number, h: number, layers: Layer[]): void {
  const cov = new Float32Array(w + 1);
  const xs: number[] = [];
  const dirs: number[] = [];
  for (const layer of layers) {
    const y0s: number[] = [], y1s: number[] = [], x0s: number[] = [], ds: number[] = [], dirOf: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const poly of layer.polys) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
        if (a[1] === b[1]) continue;
        const up = a[1] < b[1];
        const p = up ? a : b, q = up ? b : a;
        y0s.push(p[1]); y1s.push(q[1]); x0s.push(p[0]); ds.push((q[0] - p[0]) / (q[1] - p[1])); dirOf.push(up ? 1 : -1);
        if (p[1] < minY) minY = p[1];
        if (q[1] > maxY) maxY = q[1];
      }
    }
    const n = y0s.length;
    if (!n) continue;
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => y0s[a]! - y0s[b]!);
    let nextEdge = 0;
    let active: number[] = [];
    const [r, g, bl] = layer.rgb;
    const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(h, Math.ceil(maxY));
    for (let py = yStart; py < yEnd; py++) {
      let lo = w, hi = -1;
      for (let sy = 0; sy < SS; sy++) {
        const yy = py + (sy + 0.5) / SS;
        while (nextEdge < n && y0s[order[nextEdge]!]! <= yy) active.push(order[nextEdge++]!);
        active = active.filter((e) => y1s[e]! > yy);
        xs.length = 0; dirs.length = 0;
        for (const e of active) {
          if (yy < y0s[e]!) continue;
          const x = x0s[e]! + (yy - y0s[e]!) * ds[e]!;
          let k = xs.length;
          xs.push(x); dirs.push(dirOf[e]!);
          while (k > 0 && xs[k - 1]! > x) { xs[k] = xs[k - 1]!; dirs[k] = dirs[k - 1]!; k--; }
          xs[k] = x; dirs[k] = dirOf[e]!;
        }
        let wind = 0;
        for (let k = 0; k < xs.length - 1; k++) {
          wind += dirs[k]!;
          if (wind === 0) continue;
          const xa = Math.max(0, xs[k]!), xb = Math.min(w, xs[k + 1]!);
          if (xb <= xa) continue;
          const ia = Math.floor(xa), ib = Math.floor(xb);
          if (ia < lo) lo = ia;
          if (ib > hi) hi = ib;
          if (ia === ib) { cov[ia]! += (xb - xa) / SS; continue; }
          cov[ia]! += (ia + 1 - xa) / SS;
          for (let x = ia + 1; x < ib; x++) cov[x]! += 1 / SS;
          cov[ib]! += (xb - ib) / SS;
        }
      }
      if (hi < 0) continue;
      for (let x = lo; x <= hi && x < w; x++) {
        const c = cov[x]! > 1 ? 1 : cov[x]!;
        cov[x] = 0;
        if (c <= 0) continue;
        const o = (py * w + x) * 3;
        buf[o] = buf[o]! + (r - buf[o]!) * c;
        buf[o + 1] = buf[o + 1]! + (g - buf[o + 1]!) * c;
        buf[o + 2] = buf[o + 2]! + (bl - buf[o + 2]!) * c;
      }
      cov[w] = 0;
    }
  }
}

// ---------- the figure's parts ----------

type Asset = { slug: string; path?: { common?: string[]; left?: string[]; right?: string[] } };

// Figure geometry from the library's own viewBoxes (SvgMaleWrapper / SvgFemaleWrapper).
export const VIEW = {
  male: { front: [0, 0, 724, 1448], back: [724, 0, 724, 1448] },
  female: { front: [-50, -40, 734, 1538], back: [756, 0, 774, 1448] },
} as const;

export function figureParts(sex: "male" | "female", side: "front" | "back"): Array<{ slug: string; polys: Pt[][] }> {
  const assets = (sex === "female" ? (side === "front" ? bodyFemaleFront : bodyFemaleBack) : side === "front" ? bodyFront : bodyBack) as Asset[];
  return assets.map((a) => ({
    slug: a.slug,
    polys: [...(a.path?.common ?? []), ...(a.path?.left ?? []), ...(a.path?.right ?? [])].flatMap((d) => pathToPolygons(d)),
  }));
}
