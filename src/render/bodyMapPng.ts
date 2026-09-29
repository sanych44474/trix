// The weekly body map as a PNG for the Sunday digest, drawn in the Worker without a canvas: the
// figure was rasterized ahead of time into per-pixel part labels + edge coverage
// (./bodyMapMasks.ts, built by scripts/build-bodymap-masks.ts), so here each pixel is just a blend
// of the background and its part's colour, then encoded with the runtime's CompressionStream.
// That keeps it to a couple of ms of CPU, inside the free plan's budget.
import { MASKS, SLUGS } from "./bodyMapMasks";

type Rgb = [number, number, number];
const hex = (c: string): Rgb => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

async function inflate(b64: string): Promise<Uint8Array> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const planes = new Map<string, Promise<Uint8Array>>();
function maskFor(sex: "male" | "female"): Promise<Uint8Array> {
  let p = planes.get(sex);
  if (!p) { p = inflate(MASKS[sex].data); planes.set(sex, p); }
  return p;
}

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 8-bit RGB PNG from filter-prefixed rows. */
async function encodePng(raw: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export interface BodyMapImage {
  colors: Record<string, string>; // slug → #rrggbb for highlighted parts
  sex?: "male" | "female";
  base?: string; // every other part
  background?: string;
}

/** Front and back side by side, each part in its colour (unlisted parts in `base`). */
export async function renderBodyMapPng(opts: BodyMapImage): Promise<Uint8Array> {
  const sex = opts.sex ?? "male";
  const { w, h } = MASKS[sex];
  const planesBuf = await maskFor(sex);
  const bg = hex(opts.background ?? "#0E121A");
  const base = hex(opts.base ?? "#2a3140");
  const palette: Rgb[] = [bg, ...SLUGS.map((s) => (opts.colors[s] ? hex(opts.colors[s]!) : base))];
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    let o = y * (w * 3 + 1) + 1; // byte 0 of each row: filter type 0
    for (let x = 0; x < w; x++, o += 3) {
      const i = y * w + x;
      const label = planesBuf[i]!;
      if (!label) { raw[o] = bg[0]; raw[o + 1] = bg[1]; raw[o + 2] = bg[2]; continue; }
      const a = planesBuf[w * h + i]! / 255;
      const c = palette[label]!;
      raw[o] = bg[0] + (c[0] - bg[0]) * a;
      raw[o + 1] = bg[1] + (c[1] - bg[1]) * a;
      raw[o + 2] = bg[2] + (c[2] - bg[2]) * a;
    }
  }
  return encodePng(raw, w, h);
}
