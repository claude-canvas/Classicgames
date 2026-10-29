// Sunrise Drift world (DESIGN.md §4): a river valley cut into a tuff plateau, fairy-chimney rock towers on the
// slopes, patchwork fields and vineyards near the river, a cave village, poplars, and a ring of far mountains.
// Coordinates: metres, z up, +y = north, +x = east. The playable area is about ±1200 m.

import { MAT, tube, blob, mulberry32, fbm, vnoise, smooth, clamp, mixc, lerp } from "./mesh.js";

export const SIZE = 1300;
export const riverX = (y) => 210 * Math.sin(y / 520) + 70 * Math.sin(y / 170 + 1.3) - 60;
const hashF = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// terrain height (m above the river)
export function groundH(x, y) {
  const d = Math.abs(x - riverX(y));
  let h = 45 + 42 * fbm(x * 0.0016, y * 0.0016, 1) + 22 * fbm(x * 0.006, y * 0.006, 2);
  // mesas: terraced tops
  const m = fbm(x * 0.0035 + 40, y * 0.0035, 3);
  if (m > 0.55) h += Math.min(1, (m - 0.55) * 12) * 28;
  // the valley
  const v = Math.exp(-((d / 230) ** 2));
  h = lerp(h, 6 + d * 0.02, v * 0.97);
  // side gullies feeding the river
  const g = Math.abs(Math.sin(y * 0.011 + fbm(x * 0.004, y * 0.004, 4) * 4));
  h -= (1 - g) * 22 * smooth(60, 260, d) * (1 - smooth(500, 800, d));
  if (d < 22) h = Math.min(h, -1.5 + d * 0.12);
  return h;
}
export const fieldMask = (x, y) => {
  const d = Math.abs(x - riverX(y));
  return d > 26 && d < 190 && groundH(x, y) < 26;
};

export const CHIMNEYS = [];      // [x, y, z, radius, height] for collisions
export const VILLAGE = { x: -450, y: 340 };
export const LIGHTS = [];        // village window lights (dusk)

// O = opaque, A = additive, Sh = shadow, W = water
export function buildWorld(O, A, Sh, W, opts = {}) {
  const rnd = mulberry32(2024);
  // ---- terrain grid
  const N = 170, S = SIZE * 2 / N;
  const H = new Float32Array((N + 1) * (N + 1)), C = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = -SIZE + i * S, y = -SIZE + j * S, h = groundH(x, y);
    H[j * (N + 1) + i] = h;
    const d = Math.abs(x - riverX(y));
    const tuff = mixc([0.86, 0.66, 0.52], [0.93, 0.82, 0.68], fbm(x * 0.01, y * 0.01, 7));   // pink-cream volcanic tuff
    const strata = 0.92 + 0.08 * Math.sin(h * 0.45);
    let c = tuff.map((v) => v * strata);
    const field = d > 26 && d < 190 && h < 26;
    if (field) {
      const k = hashF(Math.floor((x + 3000) / 60), Math.floor((y + 3000) / 45));
      const fc = k < 0.35 ? [0.42, 0.55, 0.22] : k < 0.6 ? [0.55, 0.6, 0.28] : k < 0.8 ? [0.7, 0.58, 0.3] : [0.36, 0.45, 0.2];
      c = mixc(c, fc, smooth(26, 40, d) * (1 - smooth(150, 190, d)));
    } else if (d < 26) c = mixc([0.45, 0.42, 0.33], c, smooth(10, 26, d));
    // greener in the gullies, pale on the mesas
    c = mixc(c, [0.55, 0.58, 0.36], 0.35 * (1 - smooth(10, 60, h)) * smooth(30, 60, d));
    C.push(c);
  }
  const P = (i, j) => [-SIZE + i * S, -SIZE + j * S, H[j * (N + 1) + i], fieldMask(-SIZE + i * S, -SIZE + j * S) ? 1 : 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const ca = C[j * (N + 1) + i], cb = C[j * (N + 1) + i + 1], cc = C[(j + 1) * (N + 1) + i + 1], cd = C[(j + 1) * (N + 1) + i];
    O.quad4(a, b, c, d, ca, cb, cc, cd, MAT.TERRAIN);
  }
  // outer apron so the horizon has no edge
  {
    const NA = 72;
    for (let k = 0; k < NA; k++) {
      const a0 = (k / NA) * Math.PI * 2, a1 = ((k + 1) / NA) * Math.PI * 2;
      const ring = (a, r, z) => [Math.cos(a) * r, Math.sin(a) * r, z, 0];
      const sq = (a) => { const c = Math.cos(a), s = Math.sin(a), m = Math.max(Math.abs(c), Math.abs(s)); return SIZE / m; };
      const e0 = sq(a0), e1 = sq(a1);
      const h0 = groundH(Math.cos(a0) * e0 * 0.999, Math.sin(a0) * e0 * 0.999), h1 = groundH(Math.cos(a1) * e1 * 0.999, Math.sin(a1) * e1 * 0.999);
      O.quad4(ring(a0, e0 * 0.995, h0), ring(a1, e1 * 0.995, h1), ring(a1, 4200, 60), ring(a0, 4200, 60), [0.8, 0.66, 0.54], [0.8, 0.66, 0.54], [0.7, 0.6, 0.55], [0.7, 0.6, 0.55], MAT.TERRAIN);
    }
  }
  // ---- river surface
  for (let j = 0; j < 260; j++) {
    const y0 = -SIZE + (j / 260) * SIZE * 2, y1 = -SIZE + ((j + 1) / 260) * SIZE * 2, w = 19;
    const x0 = riverX(y0), x1 = riverX(y1);
    W.quad([x0 - w, y0, 0], [x0 + w, y0, 0], [x1 + w, y1, 0], [x1 - w, y1, 0], [0.12, 0.22, 0.26], MAT.WATER);
  }
  // ---- fairy chimneys: clusters on the valley slopes
  for (let k = 0; k < 1400 && CHIMNEYS.length < 340; k++) {
    const x = (rnd() * 2 - 1) * (SIZE - 60), y = (rnd() * 2 - 1) * (SIZE - 60), d = Math.abs(x - riverX(y)), h = groundH(x, y);
    if (d < 45 || h > 95 || h < 4) continue;
    if (vnoise(x * 0.006, y * 0.006, 21) < 0.5) continue;          // clustered
    const near = CHIMNEYS.some((c) => Math.hypot(c[0] - x, c[1] - y) < c[3] + 9);
    if (near) continue;
    const ht = 12 + rnd() * 26, r = 4 + rnd() * 4;
    chimney(O, Sh, x, y, h, r, ht, rnd);
    CHIMNEYS.push([x, y, h, r, ht]);
  }
  // ---- poplars along the river and trees in the fields
  for (let k = 0; k < 1300; k++) {
    const y = (rnd() * 2 - 1) * SIZE, side = rnd() < 0.5 ? -1 : 1, x = riverX(y) + side * (24 + rnd() * 30);
    if (rnd() < 0.55) { const h = groundH(x, y); if (h > 20) continue; poplar(O, Sh, x, y, h, 9 + rnd() * 8, rnd); }
    else {
      const fx = riverX(y) + side * (40 + rnd() * 140), h = groundH(fx, y); if (!fieldMask(fx, y) || rnd() < 0.5) continue;
      blob(O, [fx, y, h + 3.2], 2.6, 2.6, 2.3, mixc([0.24, 0.36, 0.12], [0.36, 0.44, 0.16], rnd()), MAT.FOLIAGE, 6, 4);
      tube(O, fx, y, 4, 0.25, h - 0.5, 0.2, h + 1.6, [0.3, 0.2, 0.12], MAT.MATTE);
    }
  }
  // ---- the village: cube houses stepping up a slope, lit windows
  for (let k = 0; k < 160; k++) {
    const x = VILLAGE.x + (rnd() - 0.5) * 220, y = VILLAGE.y + (rnd() - 0.5) * 200, h = groundH(x, y);
    if (Math.abs(x - riverX(y)) < 34) continue;
    const w = 5 + rnd() * 5, dd = 5 + rnd() * 5, ht = 3.5 + rnd() * 4, rot = rnd() * 0.4;
    house(O, A, x, y, h, w, dd, ht, rot, rnd);
  }
  // minaret
  { const x = VILLAGE.x + 20, y = VILLAGE.y - 10, h = groundH(x, y); tube(O, x, y, 10, 1.4, h - 1, 1.2, h + 26, [0.92, 0.88, 0.82], MAT.MATTE); tube(O, x, y, 10, 2.0, h + 20, 2.0, h + 21, [0.85, 0.8, 0.74], MAT.MATTE); tube(O, x, y, 10, 1.25, h + 26, 0, h + 31, [0.4, 0.45, 0.5], MAT.GLOSS); }
  // ---- far mountains
  {
    const NA = 200, rows = [[0.92, 0], [1.0, 0.6], [1.08, 1], [1.3, 0.25]];
    const pts = (ii) => {
      const a = (ii / NA) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), base = 3600 + 700 * vnoise(ca * 3 + 2, sa * 3, 31);
      const peak = 120 + 650 * Math.pow(fbm(ca * 4 + 5, sa * 4 + 5, 33, 5), 2.0) + (ca > 0.6 && sa < 0 ? 600 * Math.exp(-(((a - 5.8) / 0.12) ** 2)) : 0);   // a lone volcano (Erciyes) on the horizon
      return rows.map(([k, f]) => [ca * base * k, sa * base * k, f ? peak * f : -20, peak]);
    };
    for (let i = 0; i < NA; i++) {
      const A0 = pts(i), A1 = pts(i + 1), w = Math.max(A0[2][3], A1[2][3]);
      for (let r = 0; r < 3; r++) { const a = A0[r], b = A1[r], c = A1[r + 1], d = A0[r + 1]; O.quad([a[0], a[1], a[2], w], [b[0], b[1], b[2], w], [c[0], c[1], c[2], w], [d[0], d[1], d[2], w], [0.62, 0.52, 0.55], MAT.FAR); }
    }
  }
}

function chimney(O, Sh, x, y, z, r, ht, rnd) {
  // a tapering cone of banded tuff topped by a darker basalt cap on a thin neck
  const N = 12, rings = 6, rot = rnd() * 6, lean = [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08];
  const base = mixc([0.92, 0.78, 0.64], [0.96, 0.88, 0.76], rnd());
  for (let j = 0; j < rings; j++) {
    const f0 = j / rings, f1 = (j + 1) / rings;
    const rad = (f) => r * (1 - f * 0.78) * (1 + 0.2 * Math.pow(1 - f, 4));
    const z0 = z - 3 + f0 * (ht + 3), z1 = z - 3 + f1 * (ht + 3);
    for (let i = 0; i < N; i++) {
      const a0 = rot + (i / N) * Math.PI * 2, a1 = rot + ((i + 1) / N) * Math.PI * 2;
      const wob = (a, f) => 1 + 0.08 * Math.sin(a * 3 + f * 5 + rot);
      const p = (a, f, zz) => [x + lean[0] * (zz - z) + Math.cos(a) * rad(f) * wob(a, f), y + lean[1] * (zz - z) + Math.sin(a) * rad(f) * wob(a, f), zz, ht];
      O.quad(p(a0, f0, z0), p(a1, f0, z0), p(a1, f1, z1), p(a0, f1, z1), base, MAT.ROCK);
    }
  }
  const tx = x + lean[0] * ht, ty = y + lean[1] * ht, tz = z + ht;
  if (rnd() < 0.8) {
    const cr = r * (0.38 + rnd() * 0.25), ch = 2.5 + rnd() * 3;
    tube(O, tx, ty, 9, cr * 0.7, tz - 0.5, cr, tz + ch * 0.4, [0.36, 0.3, 0.28], MAT.ROCK, rot);
    tube(O, tx, ty, 9, cr, tz + ch * 0.4, 0, tz + ch, [0.3, 0.25, 0.24], MAT.ROCK, rot);
  } else tube(O, tx, ty, 10, r * 0.22, tz, 0, tz + 4, base, MAT.ROCK, rot);
  // cave-dwelling windows
  if (rnd() < 0.5) for (let k = 0; k < 2; k++) { const a = rnd() * 6, zz = z + ht * (0.25 + rnd() * 0.4), rr = r * (1 - ((zz - z + 3) / (ht + 3)) * 0.78) + 0.05; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr, tx2 = -Math.sin(a) * 0.5, ty2 = Math.cos(a) * 0.5; O.quad([px - tx2, py - ty2, zz], [px + tx2, py + ty2, zz], [px + tx2, py + ty2, zz + 1.2], [px - tx2, py - ty2, zz + 1.2], [0.12, 0.08, 0.07], MAT.MATTE); }
  shadowQ(Sh, x, y, z, r * 1.5, 0.45);
}
function poplar(O, Sh, x, y, z, h, rnd) {
  const g = mixc([0.3, 0.42, 0.14], [0.5, 0.52, 0.18], rnd());
  tube(O, x, y, 4, 0.22, z - 0.5, 0.15, z + 2, [0.32, 0.24, 0.16], MAT.MATTE);
  tube(O, x, y, 6, 1.3, z + 1.5, 0, z + h, g, MAT.FOLIAGE, rnd() * 6);
  tube(O, x, y, 6, 0.9, z + 1.0, 1.3, z + 1.5, g, MAT.FOLIAGE, rnd() * 6, false);
}
function house(O, A, x, y, z, w, d, h, rot, rnd) {
  const c = Math.cos(rot), s = Math.sin(rot), P = (u, v, zz) => [x + u * c - v * s, y + u * s + v * c, zz];
  const col = mixc([0.9, 0.82, 0.7], [0.96, 0.9, 0.8], rnd()), dark = col.map((v) => v * 0.82);
  const zb = z - 2, zt = z + h;
  const u0 = -w / 2, u1 = w / 2, v0 = -d / 2, v1 = d / 2;
  O.quad(P(u0, v0, zb), P(u1, v0, zb), P(u1, v0, zt), P(u0, v0, zt), col, MAT.MATTE);
  O.quad(P(u1, v0, zb), P(u1, v1, zb), P(u1, v1, zt), P(u1, v0, zt), dark, MAT.MATTE);
  O.quad(P(u1, v1, zb), P(u0, v1, zb), P(u0, v1, zt), P(u1, v1, zt), col, MAT.MATTE);
  O.quad(P(u0, v1, zb), P(u0, v0, zb), P(u0, v0, zt), P(u0, v1, zt), dark, MAT.MATTE);
  O.quad(P(u0, v0, zt), P(u1, v0, zt), P(u1, v1, zt), P(u0, v1, zt), rnd() < 0.4 ? [0.72, 0.4, 0.28] : col.map((v) => v * 0.95), MAT.MATTE);
  // windows (emissive at dusk via EMIT intensity in pos.w — main scales them with uNight)
  const nW = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < nW; k++) {
    const u = lerp(u0 + 0.8, u1 - 1.6, (k + 0.5) / nW), wz = z + 1.2 + (h > 6 ? (rnd() < 0.5 ? 2.6 : 0) : 0), lit = rnd() < 0.6;
    O.quad(P(u, v0 - 0.05, wz), P(u + 0.8, v0 - 0.05, wz), P(u + 0.8, v0 - 0.05, wz + 1.1), P(u, v0 - 0.05, wz + 1.1), lit ? [1.3, 0.75, 0.35] : [0.15, 0.12, 0.12], lit ? MAT.EMIT : MAT.MATTE);
    if (lit && rnd() < 0.15) LIGHTS.push(P(u + 0.4, v0 - 1.5, wz + 0.5));
  }
}
function shadowQ(Sh, x, y, z, r, k) {
  Sh.v(x - r, y - r, z + 0.3, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, z + 0.3, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.3, 3, k, 0, 0, MAT.SHADOW);
  Sh.v(x - r, y - r, z + 0.3, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.3, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, z + 0.3, 1, k, 0, 0, MAT.SHADOW);
}
export { shadowQ };
