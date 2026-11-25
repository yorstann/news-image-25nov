// ONE DAY, ONE MAP — entry for make.fun bounty news-image-20261125.
// A cartographic front page for Wednesday 25 November 2026: one stylised
// world map on atlas paper, every story pinned where it happened.
// Node standard library only. Deterministic: no clock, no randomness,
// no network — the same bytes come out on every run.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   -> writes $MAKEFUN_OUTPUT_DIR/entry.png (1024 x 1024)

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- PNG out
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ framebuffer
// Everything is drawn on a 2x supersampled canvas, then averaged down.
const SS = 2;
const W = 1024;
const H = 1024;
const SW = W * SS;
const SH = H * SS;
const fb = new Uint8Array(SW * SH * 3);

type Rgb = [number, number, number];

function putPx(x: number, y: number, col: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  if (alpha >= 1) {
    fb[i] = col[0]; fb[i + 1] = col[1]; fb[i + 2] = col[2];
  } else if (alpha > 0) {
    fb[i] = Math.round(fb[i] + (col[0] - fb[i]) * alpha);
    fb[i + 1] = Math.round(fb[i + 1] + (col[1] - fb[i + 1]) * alpha);
    fb[i + 2] = Math.round(fb[i + 2] + (col[2] - fb[i + 2]) * alpha);
  }
}

// Filled disc in poster coordinates (1024-space).
function disc(cx: number, cy: number, r: number, col: Rgb, alpha = 1): void {
  const R = r * SS;
  const x0 = Math.floor((cx - r) * SS), x1 = Math.ceil((cx + r) * SS);
  const y0 = Math.floor((cy - r) * SS), y1 = Math.ceil((cy + r) * SS);
  const ccx = cx * SS, ccy = cy * SS;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ccx, dy = y - ccy;
      if (dx * dx + dy * dy <= R * R) putPx(x, y, col, alpha);
    }
  }
}

// Thick segment: discs stamped along the line.
function seg(x1: number, y1: number, x2: number, y2: number, w: number, col: Rgb, alpha = 1): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (w * 0.3)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + dx * t, y1 + dy * t, w / 2, col, alpha);
  }
}

function polyline(pts: number[][], w: number, col: Rgb, alpha = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, col, alpha);
}

function fillRect(x: number, y: number, w: number, h: number, col: Rgb, alpha = 1): void {
  const x0 = Math.round(x * SS), x1 = Math.round((x + w) * SS);
  const y0 = Math.round(y * SS), y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) putPx(xx, yy, col, alpha);
}

function strokeRect(x: number, y: number, w: number, h: number, lw: number, col: Rgb): void {
  seg(x, y, x + w, y, lw, col);
  seg(x + w, y, x + w, y + h, lw, col);
  seg(x + w, y + h, x, y + h, lw, col);
  seg(x, y + h, x, y, lw, col);
}

// Scanline polygon fill (poster coordinates).
function fillPoly(pts: number[][], col: Rgb): void {
  const sp = pts.map(p => [p[0] * SS, p[1] * SS]);
  let minY = Infinity, maxY = -Infinity;
  for (const p of sp) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const yA = Math.max(0, Math.floor(minY)), yB = Math.min(SH - 1, Math.ceil(maxY));
  for (let y = yA; y <= yB; y++) {
    const xs: number[] = [];
    for (let i = 0; i < sp.length; i++) {
      const a = sp[i], b = sp[(i + 1) % sp.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(SW - 1, Math.round(xs[k + 1]));
      for (let x = xa; x <= xb; x++) putPx(x, y, col, 1);
    }
  }
}

// ------------------------------------------------------- stroke typeface
// A hand-built grotesque: every glyph is a set of polylines on a 5 x 7 grid
// (x right, y down, 0 = cap top, 7 = baseline). Drawn with round joins, so
// stroke weight alone sets the tone from label to headline.
interface Glyph { w: number; s: number[][][] }
const GL: Record<string, Glyph> = {
  ' ': { w: 2.6, s: [] },
  A: { w: 5, s: [[[0, 7], [2.5, 0], [5, 7]], [[1.3, 4.6], [3.7, 4.6]]] },
  B: { w: 5, s: [[[0, 7], [0, 0], [3.1, 0], [4.3, 1.2], [3.1, 2.4], [0, 2.4]], [[0, 2.4], [3.4, 2.4], [4.6, 3.6], [3.4, 7], [0, 7]]] },
  C: { w: 5, s: [[[4.6, 1.6], [3.4, 0.4], [1.6, 0.4], [0.4, 1.6], [0.4, 5.4], [1.6, 6.6], [3.4, 6.6], [4.6, 5.4]]] },
  D: { w: 5, s: [[[0, 7], [0, 0], [3, 0], [4.6, 2.2], [4.6, 4.8], [3, 7], [0, 7]]] },
  E: { w: 5, s: [[[4.6, 0], [0, 0], [0, 7], [4.6, 7]], [[0, 3.5], [3.6, 3.5]]] },
  F: { w: 5, s: [[[4.6, 0], [0, 0], [0, 7]], [[0, 3.5], [3.6, 3.5]]] },
  G: { w: 5, s: [[[4.6, 1.6], [3.4, 0.4], [1.6, 0.4], [0.4, 1.6], [0.4, 5.4], [1.6, 6.6], [3.4, 6.6], [4.6, 5.4], [4.6, 3.9], [3.1, 3.9]]] },
  H: { w: 5, s: [[[0, 0], [0, 7]], [[5, 0], [5, 7]], [[0, 3.5], [5, 3.5]]] },
  I: { w: 3.4, s: [[[1.7, 0], [1.7, 7]], [[0, 0], [3.4, 0]], [[0, 7], [3.4, 7]]] },
  J: { w: 5, s: [[[4.6, 0], [4.6, 5.2], [3.2, 6.6], [1.4, 6.6], [0.4, 5.2]]] },
  K: { w: 5, s: [[[0, 0], [0, 7]], [[4.6, 0], [0.7, 3.3]], [[1.5, 2.7], [4.8, 7]]] },
  L: { w: 5, s: [[[0, 0], [0, 7], [4.6, 7]]] },
  M: { w: 5, s: [[[0, 7], [0, 0], [2.5, 2.9], [5, 0], [5, 7]]] },
  N: { w: 5, s: [[[0, 7], [0, 0], [5, 7], [5, 0]]] },
  O: { w: 5, s: [[[1.6, 0.4], [3.4, 0.4], [4.6, 1.6], [4.6, 5.4], [3.4, 6.6], [1.6, 6.6], [0.4, 5.4], [0.4, 1.6], [1.6, 0.4]]] },
  P: { w: 5, s: [[[0, 7], [0, 0], [3.4, 0], [4.6, 1.2], [3.4, 3.2], [0, 3.2]]] },
  Q: { w: 5, s: [[[1.6, 0.4], [3.4, 0.4], [4.6, 1.6], [4.6, 5.4], [3.4, 6.6], [1.6, 6.6], [0.4, 5.4], [0.4, 1.6], [1.6, 0.4]], [[2.8, 4.6], [5.2, 7.4]]] },
  R: { w: 5, s: [[[0, 7], [0, 0], [3.4, 0], [4.6, 1.2], [3.4, 3.2], [0, 3.2]], [[2.2, 3.2], [4.8, 7]]] },
  S: { w: 5, s: [[[4.6, 1.4], [3.4, 0.4], [1.6, 0.4], [0.5, 1.3], [0.9, 2.6], [4.1, 4.4], [4.6, 5.6], [3.4, 6.6], [1.6, 6.6], [0.4, 5.6]]] },
  T: { w: 5, s: [[[0, 0], [5, 0]], [[2.5, 0], [2.5, 7]]] },
  U: { w: 5, s: [[[0, 0], [0, 5.4], [1.2, 6.6], [3.8, 6.6], [5, 5.4], [5, 0]]] },
  V: { w: 5, s: [[[0, 0], [2.5, 7], [5, 0]]] },
  W: { w: 5, s: [[[0, 0], [1.2, 7], [2.5, 2.6], [3.8, 7], [5, 0]]] },
  X: { w: 5, s: [[[0, 0], [5, 7]], [[5, 0], [0, 7]]] },
  Y: { w: 5, s: [[[0, 0], [2.5, 2.8], [5, 0]], [[2.5, 2.8], [2.5, 7]]] },
  Z: { w: 5, s: [[[0, 0], [5, 0], [0, 7], [5, 7]]] },
  '0': { w: 5, s: [[[1.5, 0.4], [3.5, 0.4], [4.4, 1.6], [4.4, 5.4], [3.5, 6.6], [1.5, 6.6], [0.6, 5.4], [0.6, 1.6], [1.5, 0.4]]] },
  '1': { w: 5, s: [[[1.6, 1.5], [3.2, 0], [3.2, 7]], [[1.4, 7], [4.8, 7]]] },
  '2': { w: 5, s: [[[0.6, 1.5], [1.6, 0.4], [3.4, 0.4], [4.4, 1.5], [4.4, 2.6], [0.4, 7], [4.8, 7]]] },
  '3': { w: 5, s: [[[0.5, 1.3], [1.6, 0.4], [3.2, 0.4], [4.3, 1.4], [3.2, 2.6], [1.8, 2.6]], [[1.8, 2.6], [3.4, 2.6], [4.5, 3.8], [3.4, 6.6], [1.6, 6.6], [0.5, 5.7]]] },
  '4': { w: 5, s: [[[3.6, 7], [3.6, 0], [0.4, 5.2], [5, 5.2]]] },
  '5': { w: 5, s: [[[4.6, 0], [0.6, 0], [0.6, 3], [3.2, 2.7], [4.5, 3.9], [4.4, 5.6], [3.2, 6.6], [1.4, 6.6], [0.4, 5.5]]] },
  '6': { w: 5, s: [[[4.3, 1.4], [3, 0.4], [1.5, 0.6], [0.5, 2], [0.4, 5.2], [1.5, 6.6], [3.4, 6.6], [4.5, 5.3], [3.3, 3], [1, 3.2]]] },
  '7': { w: 5, s: [[[0.4, 0], [4.8, 0], [2.2, 7]]] },
  '8': { w: 5, s: [[[1.7, 2.5], [0.7, 1.6], [1.6, 0.4], [3.4, 0.4], [4.3, 1.6], [3.3, 2.5], [1.7, 2.5]], [[1.7, 2.5], [0.5, 3.9], [0.6, 5.6], [1.7, 6.6], [3.3, 6.6], [4.4, 5.6], [4.5, 3.9], [3.3, 2.5]]] },
  '9': { w: 5, s: [[[0.7, 5.5], [2, 6.6], [3.5, 6.3], [4.5, 4.8], [4.6, 1.9], [3.5, 0.4], [1.6, 0.4], [0.5, 1.8], [1.8, 4.1], [4.4, 3.9]]] },
  '.': { w: 2.6, s: [[[1.3, 6.2], [1.3, 6.9]]] },
  ',': { w: 2.6, s: [[[1.7, 6.1], [1.1, 7.6]]] },
  ':': { w: 2.6, s: [[[1.3, 1.7], [1.3, 2.4]], [[1.3, 5], [1.3, 5.7]]] },
  "'": { w: 2.2, s: [[[1.5, 0], [1, 1.7]]] },
  '-': { w: 4.4, s: [[[0.7, 3.5], [3.7, 3.5]]] },
  '+': { w: 4.6, s: [[[2.3, 1.8], [2.3, 5.2]], [[0.6, 3.5], [4, 3.5]]] },
  '$': { w: 5, s: [[[4.6, 1.4], [3.4, 0.4], [1.6, 0.4], [0.5, 1.3], [0.9, 2.6], [4.1, 4.4], [4.6, 5.6], [3.4, 6.6], [1.6, 6.6], [0.4, 5.6]], [[2.5, -0.5], [2.5, 7.5]]] },
  '·': { w: 3, s: [[[1.5, 3.2], [1.5, 3.9]]] },
};

interface TextOpts {
  cap: number;          // cap height in px
  col: Rgb;
  track?: number;       // extra advance, in grid units
  weight?: number;      // stroke width in px (default ~ cap * 0.12)
  align?: 'left' | 'center' | 'right';
  angle?: number;       // degrees, rotated about the anchor point
}

function textWidth(str: string, cap: number, track: number): number {
  const sc = cap / 7;
  let w = 0;
  for (const ch of str) {
    const g = GL[ch] ?? GL[' '];
    w += (g.w + track) * sc;
  }
  return str.length ? w - track * sc : 0;
}

function drawText(str: string, x: number, yBase: number, o: TextOpts): void {
  const track = o.track ?? 0.9;
  const weight = o.weight ?? o.cap * 0.12;
  const sc = o.cap / 7;
  const total = textWidth(str, o.cap, track);
  let cx = x;
  if (o.align === 'center') cx = x - total / 2;
  else if (o.align === 'right') cx = x - total;
  const ang = ((o.angle ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const top = yBase - o.cap;
  for (const ch of str) {
    const g = GL[ch] ?? GL[' '];
    for (const stroke of g.s) {
      const pts = stroke.map(([gx, gy]) => {
        let px = cx + gx * sc;
        let py = top + gy * sc;
        if (ang !== 0) {
          const dx = px - x, dy = py - yBase;
          px = x + dx * cosA - dy * sinA;
          py = yBase + dx * sinA + dy * cosA;
        }
        return [px, py];
      });
      polyline(pts, weight, o.col);
    }
    cx += (g.w + track) * sc;
  }
}

// ---------------------------------------------------------------- palette
const PAPER: Rgb = [243, 234, 214];
const INK: Rgb = [27, 42, 67];
const LAND: Rgb = [30, 48, 76];
const LAND_DOT: Rgb = [56, 80, 114];
const RED: Rgb = [198, 52, 32];
const PIN_RED: Rgb = [208, 58, 34];
const SLATE: Rgb = [74, 84, 104];
const GRAT: Rgb = [201, 188, 154];
const BOX_FILL: Rgb = [249, 242, 224];
const CREAM: Rgb = [250, 246, 230];

// ------------------------------------------------------------- projection
// Plate-carree style chart: longitude -180..180 across the map frame,
// latitude 80..-60 down it (a touch of vertical stretch, like old posters).
const MAP_X = 30;
const MAP_W = 964;
const MAP_Y = 196;
const PX_LON = MAP_W / 360;
const PX_LAT = 4.0;
const X = (lon: number): number => MAP_X + (lon + 180) * PX_LON;
const Y = (lat: number): number => MAP_Y + (80 - lat) * PX_LAT;
const LON = (x: number): number => (x - MAP_X) / PX_LON - 180;
const LAT = (y: number): number => 80 - (y - MAP_Y) / PX_LAT;

// ------------------------------------------------- continent silhouettes
// Simplified coastlines as [lon, lat] polygons, drawn from chart memory —
// deliberately coarse: this is a poster map, not a survey.
const LANDMASS: number[][][] = [
  // North America
  [[-168, 66], [-158, 71], [-145, 70], [-132, 70], [-120, 71], [-110, 68], [-100, 69], [-93, 66], [-86, 66], [-84, 58], [-81, 55], [-79, 58], [-77, 63], [-73, 62], [-65, 60], [-64, 52], [-66, 48], [-70, 44], [-74, 40], [-76, 36], [-80, 32], [-81, 26], [-84, 30], [-89, 29], [-94, 29], [-97, 26], [-97, 22], [-94, 18], [-91, 19], [-87, 21], [-88, 16], [-86, 13], [-83, 9], [-79, 9], [-84, 11], [-89, 13], [-93, 15], [-96, 16], [-102, 18], [-105, 20], [-110, 23], [-114, 29], [-117, 33], [-122, 37], [-124, 46], [-127, 52], [-133, 56], [-140, 60], [-150, 59], [-155, 56], [-161, 58], [-166, 60]],
  // Greenland
  [[-45, 60], [-32, 68], [-22, 70], [-19, 76], [-28, 82], [-48, 80], [-56, 76], [-54, 70], [-52, 64]],
  // South America
  [[-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -17], [-70, -19], [-70, -24], [-70, -30], [-72, -37], [-73, -44], [-74, -50], [-71, -54], [-67, -55], [-66, -52], [-68, -47], [-65, -41], [-62, -39], [-58, -35], [-52, -33], [-48, -28], [-42, -23], [-39, -18], [-35, -8], [-37, -5], [-44, -3], [-50, 0], [-52, 4], [-57, 7], [-61, 9], [-66, 10], [-71, 12], [-75, 11], [-77, 8]],
  // Africa
  [[-6, 35], [-9, 31], [-13, 28], [-16, 24], [-17, 20], [-17, 15], [-15, 11], [-12, 8], [-8, 5], [-4, 5], [2, 6], [6, 4], [9, -1], [12, -6], [13, -12], [14, -18], [15, -27], [17, -32], [19, -35], [26, -34], [31, -29], [33, -26], [35, -22], [36, -18], [39, -13], [40, -8], [46, -2], [51, 2], [51, 10], [47, 11], [43, 12], [40, 15], [38, 21], [35, 27], [33, 29], [32, 31], [28, 31], [22, 33], [17, 33], [12, 34], [10, 34], [10, 37], [6, 37], [2, 36], [-2, 35]],
  // Eurasia
  [[-9, 37], [-9, 43], [-4, 44], [-2, 46], [-5, 48], [-1, 50], [2, 51], [5, 53], [8, 55], [8, 57], [12, 56], [18, 56], [21, 55], [24, 57], [27, 59], [30, 60], [31, 63], [34, 66], [38, 68], [44, 68], [52, 68], [62, 69], [71, 71], [80, 73], [90, 75], [100, 76], [108, 77], [113, 74], [120, 73], [128, 72], [136, 71], [144, 72], [152, 71], [160, 70], [169, 69], [178, 66], [178, 64], [172, 61], [162, 60], [158, 56], [162, 52], [157, 50], [150, 59], [144, 57], [141, 52], [140, 47], [136, 44], [132, 43], [129, 40], [126, 39], [122, 38], [120, 34], [122, 30], [120, 26], [115, 23], [109, 19], [109, 15], [107, 11], [104, 8], [101, 6], [100, 2], [98, 6], [98, 10], [97, 14], [95, 16], [93, 17], [91, 22], [88, 22], [86, 20], [83, 18], [80, 14], [77, 8], [75, 13], [72, 19], [69, 22], [66, 25], [61, 25], [57, 26], [54, 27], [51, 29], [49, 27], [51, 25], [54, 24], [57, 24], [59, 22], [58, 20], [55, 17], [52, 15], [48, 13], [44, 12], [43, 12], [40, 15], [38, 20], [36, 27], [36, 33], [33, 36], [30, 36], [27, 37], [24, 36], [22, 37], [19, 40], [16, 38], [17, 40], [18, 40], [15, 38], [12, 40], [10, 44], [8, 44], [6, 43], [3, 42], [0, 39], [-2, 37], [-6, 36]],
  // Britain
  [[-5, 50], [-2, 51], [0, 52], [-1, 54], [-3, 56], [-5, 58], [-7, 57], [-6, 55], [-5, 53]],
  // Iceland
  [[-22, 64], [-15, 64], [-14, 66], [-20, 66], [-22, 65]],
  // Japan
  [[130, 31], [133, 33], [136, 34], [139, 35], [140, 37], [139, 39], [141, 41], [140, 43], [142, 44], [143, 43], [141, 42], [140, 40], [138, 38], [135, 36], [132, 34], [130, 32]],
  // Sumatra
  [[95, 5], [99, 2], [102, -1], [105, -4], [106, -6], [103, -5], [99, 0], [96, 3]],
  // Borneo
  [[109, 1], [111, 3], [114, 4], [117, 6], [119, 3], [118, 0], [116, -3], [112, -3], [110, -1]],
  // Java
  [[106, -6], [109, -6], [112, -7], [114, -8], [114, -9], [108, -8], [106, -7]],
  // New Guinea
  [[131, -1], [135, -2], [139, -2], [143, -3], [147, -5], [150, -9], [148, -9], [143, -6], [138, -4], [133, -3], [131, -2]],
  // Madagascar
  [[44, -16], [47, -14], [50, -16], [49, -20], [47, -24], [45, -25], [44, -21], [43, -17]],
  // Australia
  [[113, -22], [112, -26], [114, -31], [115, -34], [118, -35], [124, -33], [130, -32], [132, -32], [134, -33], [136, -35], [138, -36], [139, -37], [141, -38], [145, -38], [147, -38], [150, -37], [152, -33], [153, -28], [153, -24], [150, -22], [146, -19], [143, -15], [142, -11], [140, -13], [140, -17], [137, -16], [135, -12], [132, -11], [130, -13], [126, -14], [122, -17], [118, -20], [114, -22]],
  // New Zealand
  [[167, -45], [170, -43], [172, -41], [174, -39], [176, -38], [174, -41], [172, -43], [169, -46]],
];

function insideLand(lon: number, lat: number): boolean {
  let inside = false;
  for (const poly of LANDMASS) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ------------------------------------------------------------------ scene
function drawPaperAndFrames(): void {
  fillRect(0, 0, W, H, PAPER);
  strokeRect(16, 16, W - 32, H - 32, 2.6, INK);
  strokeRect(25, 25, W - 50, H - 50, 0.9, INK);
}

function drawTitleBand(): void {
  drawText('ONE DAY, ONE MAP', W / 2, 126, { cap: 57, col: INK, track: 1.7, weight: 7.4, align: 'center' });
  const sub = 'THE WORLD ON WEDNESDAY 25 NOVEMBER 2026';
  const subW = textWidth(sub, 15.5, 1.6);
  seg(120, 150, W / 2 - subW / 2 - 18, 150, 1.1, RED);
  seg(W / 2 + subW / 2 + 18, 150, 904, 150, 1.1, RED);
  drawText(sub, W / 2, 158, { cap: 15.5, col: SLATE, track: 1.6, weight: 2, align: 'center' });
}

function drawGraticule(): void {
  for (let lon = -150; lon <= 180; lon += 30) {
    seg(X(lon), Y(79), X(lon), Y(-58), 0.8, GRAT);
  }
  for (const lat of [60, 30, 0, -30]) {
    seg(X(-179), Y(lat), X(179), Y(lat), 0.8, GRAT);
  }
  strokeRect(X(-180), Y(80), MAP_W, 140 * PX_LAT, 1.6, INK);
}

function drawLand(): void {
  for (const poly of LANDMASS) fillPoly(poly.map(([lo, la]) => [X(lo), Y(la)]), LAND);
  // Halftone dot screen over the land only — the atlas texture.
  for (let gy = MAP_Y + 8; gy < MAP_Y + 140 * PX_LAT; gy += 13) {
    for (let gx = MAP_X + 7; gx < MAP_X + MAP_W; gx += 13) {
      const off = (Math.round(gy / 13) % 2) * 6.5;
      if (insideLand(LON(gx + off), LAT(gy))) disc(gx + off, gy, 1.5, LAND_DOT);
    }
  }
}

function drawCompass(cx: number, cy: number, r: number): void {
  // Expedition-chart compass rose: ring, four long points, four short.
  const ringSteps = 90;
  for (let i = 0; i < ringSteps; i++) {
    const a = (i / ringSteps) * Math.PI * 2;
    disc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.1, INK);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 - Math.PI / 2;
    const tip: [number, number] = [cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98];
    const l: [number, number] = [cx + Math.cos(a + 0.16) * r * 0.3, cy + Math.sin(a + 0.16) * r * 0.3];
    const rr: [number, number] = [cx + Math.cos(a - 0.16) * r * 0.3, cy + Math.sin(a - 0.16) * r * 0.3];
    fillPoly([tip, l, [cx, cy]], RED);
    fillPoly([tip, [cx, cy], rr], INK);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 - Math.PI / 4;
    seg(cx, cy, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, 1.6, INK);
  }
  disc(cx, cy, 3.2, CREAM);
  disc(cx, cy, 1.6, INK);
  drawText('N', cx, cy - r - 6, { cap: 15, col: INK, track: 0.4, weight: 2.2, align: 'center' });
}

// --------------------------------------------------------- pins & callouts
interface Callout {
  pinLon: number; pinLat: number;
  boxX: number; boxY: number; boxW: number;
  anchorX: number; anchorY: number; // where the leader line meets the box
  place: string;
  head: string[];
  headCap: number;
  tiny: string[];
  lead?: boolean;
}

function drawPin(lon: number, lat: number, lead = false): void {
  const cx = X(lon), cy = Y(lat);
  const r = lead ? 14 : 10.5;
  if (lead) {
    disc(cx, cy, r + 7, PIN_RED, 0.35);
    disc(cx, cy, r + 3.5, PIN_RED, 0.5);
  }
  disc(cx, cy, r, PIN_RED);
  disc(cx, cy, r * 0.62, CREAM);
  disc(cx, cy, r * 0.3, PIN_RED);
}

function drawCallout(c: Callout): void {
  const pad = c.lead ? 13 : 10;
  const placeCap = c.lead ? 14 : 12.5;
  const tinyCap = 10;
  const lineGap = 15;
  const accent = c.lead ? 8 : 6;
  let h = pad + accent + placeCap + 5;
  h += c.head.length * (c.headCap + 5);
  h += 4 + c.tiny.length * lineGap + 2 + pad;
  // shadow, body, frame, accent bar
  fillRect(c.boxX + 5, c.boxY + 6, c.boxW, h, INK, 0.16);
  fillRect(c.boxX, c.boxY, c.boxW, h, BOX_FILL);
  strokeRect(c.boxX, c.boxY, c.boxW, h, c.lead ? 2.4 : 1.7, INK);
  fillRect(c.boxX, c.boxY, c.boxW, accent, RED);
  let ty = c.boxY + pad + (c.lead ? 8 : 6) + placeCap - 2;
  drawText(c.place, c.boxX + pad, ty, { cap: placeCap, col: RED, track: 1.1, weight: placeCap * 0.15 });
  ty += 7;
  for (const line of c.head) {
    ty += c.headCap + 5;
    drawText(line, c.boxX + pad, ty, { cap: c.headCap, col: INK, track: 0.8, weight: c.headCap * 0.13 });
  }
  ty += 4;
  for (const line of c.tiny) {
    ty += lineGap;
    drawText(line, c.boxX + pad, ty, { cap: tinyCap, col: SLATE, track: 0.75, weight: 1.45 });
  }
}

const CALLOUTS: Callout[] = [
  {
    pinLon: 19, pinLat: 52, boxX: 306, boxY: 216, boxW: 290, anchorX: 545, anchorY: 302,
    place: 'POLAND', head: ['3 MISSILES CROSS IN'], headCap: 17,
    tiny: ['NATO RUSHES EARLY-WARNING PLANES'],
  },
  {
    pinLon: 31.5, pinLat: 49, boxX: 648, boxY: 204, boxW: 310, anchorX: 668, anchorY: 289,
    place: 'UKRAINE', head: ['700,000+ RUSSIAN DEAD'], headCap: 16,
    tiny: ["NEW ESTIMATE OF MOSCOW'S WAR LOSSES"],
  },
  {
    pinLon: 30.7, pinLat: 36.9, boxX: 680, boxY: 292, boxW: 278, anchorX: 680, anchorY: 372,
    place: 'ANTALYA · TURKIYE', head: ['CLIMATE TALKS:', 'NO DEAL'], headCap: 22,
    tiny: ['OIL AND GAS STATES BLOCK THE', 'FOSSIL-FUEL PHASE-OUT, CLIMATE', 'FINANCE LEFT IN LIMBO'],
    lead: true,
  },
  {
    pinLon: -77, pinLat: 38.9, boxX: 44, boxY: 282, boxW: 252, anchorX: 296, anchorY: 348,
    place: 'WASHINGTON', head: ['CIA HACKED', 'HUAWEI GUILTY'], headCap: 18,
    tiny: ['CYBERATTACK ON CLASSIFIED', 'SYSTEMS. JURY VERDICT:', 'GUILTY ON 10 OF 12 COUNTS'],
  },
  {
    pinLon: 20, pinLat: 32.1, boxX: 264, boxY: 430, boxW: 274, anchorX: 538, anchorY: 472,
    place: 'BENGHAZI · LIBYA', head: ['WARSHIP SUNK'], headCap: 18,
    tiny: ['UKRAINE STRIKES RUSSIAN WARSHIP', "MOSCOW CRIES 'TERRORISM'"],
  },
  {
    pinLon: 56.3, pinLat: 26.5, boxX: 700, boxY: 466, boxW: 258, anchorX: 712, anchorY: 498,
    place: 'STRAIT OF HORMUZ', head: ['TANKERS HIT MINES'], headCap: 17,
    tiny: ['IRAN SAYS THREE OIL', 'TANKERS STRUCK MINES'],
  },
  {
    pinLon: 29.5, pinLat: 1.5, boxX: 640, boxY: 580, boxW: 318, anchorX: 640, anchorY: 628,
    place: 'CONGO · ITURI', head: ['EBOLA: 5,775 DEAD'], headCap: 18,
    tiny: ['WORST-EVER OUTBREAK, WHO STAFF', 'EVACUATED AFTER 3 DAYS SHELTERING'],
  },
];

function drawLeadersAndPins(): void {
  for (const c of CALLOUTS) {
    seg(X(c.pinLon), Y(c.pinLat), c.anchorX, c.anchorY, 1.3, INK, 0.75);
    disc(c.anchorX, c.anchorY, 2.6, INK);
  }
  for (const c of CALLOUTS) drawPin(c.pinLon, c.pinLat, c.lead);
}

// ------------------------------------------------------------ bottom strip
function drawBottomStrip(): void {
  seg(44, 788, 980, 788, 1.6, INK);
  drawText('BY THE NUMBERS', W / 2, 826, { cap: 15, col: RED, track: 2.2, weight: 2.3, align: 'center' });
  drawText('700,000+ WAR DEAD · 74,746 GAZA TOLL', W / 2, 864, { cap: 16.5, col: INK, track: 0.9, weight: 2.1, align: 'center' });
  drawText("12,000 EVACUATED AT UK CONCERT · $34B HUANG'S ONE-DAY REBOUND", W / 2, 898, { cap: 16.5, col: INK, track: 0.9, weight: 2.1, align: 'center' });
  drawText("EVERY STORY PINNED WHERE IT HAPPENED · FIGURES AS REPORTED ON THE DAY'S WIRES", W / 2, 950, { cap: 9.5, col: SLATE, track: 1, weight: 1.4, align: 'center' });
}

// --------------------------------------------------------------- finishing
// Deterministic paper grain: integer hash of the pixel position.
function grain(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return (((n ^ (n >> 16)) >>> 0) % 9) - 4;
}

function finish(): Buffer {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = grain(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const vig = edge < 90 ? 1 - (90 - edge) * 0.0009 : 1;
      for (let ch = 0; ch < 3; ch++) {
        let v = 0;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) v += fb[((y * SS + dy) * SW + (x * SS + dx)) * 3 + ch];
        }
        v = v / (SS * SS);
        out[(y * W + x) * 3 + ch] = Math.max(0, Math.min(255, Math.round(v * vig + g)));
      }
    }
  }
  return encodePng(W, H, out);
}

// ------------------------------------------------------- chart furniture
function drawOceanLabels(): void {
  const col: Rgb = [122, 141, 161];
  drawText('PACIFIC OCEAN', 132, 486, { cap: 12.5, col, track: 3.2, weight: 1.7, align: 'center' });
  drawText('ATLANTIC OCEAN', 420, 596, { cap: 12.5, col, track: 3.2, weight: 1.7, align: 'center' });
  drawText('INDIAN OCEAN', 690, 716, { cap: 12.5, col, track: 3.2, weight: 1.7, align: 'center' });
}

function drawDateStamp(cx: number, cy: number): void {
  // Postmark-style badge, tilted like it was stamped onto the chart.
  const ang = -11;
  const w = 168, h = 74;
  const rad = (ang * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const corner = (dx: number, dy: number): [number, number] => [cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA];
  const c1 = corner(-w / 2, -h / 2), c2 = corner(w / 2, -h / 2), c3 = corner(w / 2, h / 2), c4 = corner(-w / 2, h / 2);
  polyline([c1, c2, c3, c4, c1], 2.4, RED);
  const i1 = corner(-w / 2 + 6, -h / 2 + 6), i2 = corner(w / 2 - 6, -h / 2 + 6), i3 = corner(w / 2 - 6, h / 2 - 6), i4 = corner(-w / 2 + 6, h / 2 - 6);
  polyline([i1, i2, i3, i4, i1], 0.9, RED);
  drawText('25 NOV 2026', cx, cy + 2, { cap: 19, col: RED, track: 1, weight: 2.6, align: 'center', angle: ang });
  drawText('DAILY CHART NO. 25', cx, cy + 26, { cap: 10, col: RED, track: 1.2, weight: 1.5, align: 'center', angle: ang });
}

function main(): void {
  drawPaperAndFrames();
  drawTitleBand();
  drawGraticule();
  drawLand();
  drawOceanLabels();
  drawCompass(118, 646, 36);
  drawDateStamp(862, 722);
  drawLeadersAndPins();
  for (const c of CALLOUTS) drawCallout(c);
  drawBottomStrip();
  const png = finish();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
  console.log(`entry.png written: ${png.length} bytes`);
}

main();
