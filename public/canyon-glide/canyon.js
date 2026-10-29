// Canyon Glide world (DESIGN.md §2): an endless canyon along +y. Pure height function (shared with collision) +
// per-chunk features (rings, arches, spires, thermals, wind gates) from a seeded RNG, and chunk mesh building.
import { MAT, tube, limb, blob, mulberry32, fbm, vnoise, smooth, clamp, mixc } from "./mesh.js";

export const CHUNK = 120;
export const cx = (y) => 60 * Math.sin(y / 300) + 35 * Math.sin(y / 131 + 1) + 14 * Math.sin(y / 57 + 2);
export const width = (y) => Math.max(38, 86 + 34 * Math.sin(y / 410) + 18 * Math.sin(y / 97 + 0.5) - 30 * Math.max(0, Math.sin(y / 260 + 2)) ** 6);
const wallH = (y, side) => 70 + 60 * fbm(y * 0.004 + side * 13, side * 7, 3, 3);
const terrace = (t) => { const k = t * 5, f = k - Math.floor(k); return (Math.floor(k) + smooth(0.55, 1, f)) / 5; };
export function H(x, y) {
  const w = width(y) / 2, u = (x - cx(y)) / w, au = Math.abs(u), side = u < 0 ? -1 : 1;
  if (au < 0.14) return -1.2 + au * 4;
  let z = 1.2 + 5 * smooth(0.14, 0.75, au) + (vnoise(x * 0.08, y * 0.08, 2) - 0.5) * 1.2;
  if (au > 0.72) {
    const t = clamp((au - 0.72) / 0.42, 0, 1), hw = wallH(y, side);
    z = 6 + hw * terrace(t) * (0.92 + 0.16 * vnoise(x * 0.05, y * 0.05, 4));
    if (au > 1.14) z = 6 + hw + 4 * fbm(x * 0.01, y * 0.01, 6, 3);
  }
  return z;
}
// unit tangent of the path at y (direction of travel)
export function tangent(y) { const d = (cx(y + 1) - cx(y - 1)) / 2; const l = Math.hypot(d, 1); return [d / l, 1 / l]; }

// ---------------------------------------------------------------- features
export function features(ci) {
  const rnd = mulberry32(ci * 9973 + 17), y0 = ci * CHUNK, f = { rings: [], arches: [], spires: [], thermals: [], gates: [], bushes: [] };
  if (ci < 1) return f;
  // a line of rings that follows the path, weaving and climbing
  for (let s = 0; s < 1 + (rnd() < 0.5 ? 1 : 0); s++) {
    const ys = y0 + 15 + rnd() * 60, off = (rnd() - 0.5) * 0.5, z0 = 12 + rnd() * 35, amp = (rnd() - 0.5) * 16, n = 5;
    for (let i = 0; i < n; i++) { const y = ys + i * 11, x = cx(y) + off * width(y) * 0.5 + Math.sin(i * 0.8) * amp * 0.4, z = z0 + Math.sin(i * 0.9) * amp * 0.3; if (z > H(x, y) + 6) f.rings.push({ x, y, z, r: 4.2, set: ci * 10 + s, i, got: false }); }
  }
  if (rnd() < 0.38) {   // a stone arch spanning the canyon
    const y = y0 + 40 + rnd() * 50, w = width(y) / 2, c = cx(y), top = Math.min(wallH(y, -1), wallH(y, 1)) * (0.45 + rnd() * 0.3) + 10;
    f.arches.push({ y, x0: c - w * 1.0, x1: c + w * 1.0, top, thick: 7 + rnd() * 4, sag: 10 + rnd() * 10, through: false });
  }
  const nS = Math.floor(rnd() * 3);
  for (let i = 0; i < nS; i++) { const y = y0 + rnd() * CHUNK, x = cx(y) + (rnd() < 0.5 ? -1 : 1) * width(y) * (0.22 + rnd() * 0.3); f.spires.push({ x, y, r: 3.5 + rnd() * 3, h: 18 + rnd() * 34, z: H(x, y) - 1 }); }
  const nT = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < nT; i++) { const y = y0 + rnd() * CHUNK, x = cx(y) + (rnd() - 0.5) * width(y) * 0.8; f.thermals.push({ x, y, r: 13 + rnd() * 12, lift: 4.5 + rnd() * 4 }); }
  if (rnd() < 0.18) { const y = y0 + 60, x = cx(y); f.gates.push({ x, y, z: 14 + rnd() * 20, r: 9, got: false }); }
  for (let i = 0; i < 18; i++) { const y = y0 + rnd() * CHUNK, x = cx(y) + (rnd() - 0.5) * width(y) * 1.3, z = H(x, y); if (z < 9 && Math.abs(x - cx(y)) > width(y) * 0.1) f.bushes.push([x, y, z, 0.8 + rnd() * 1.6]); }
  return f;
}

// ---------------------------------------------------------------- chunk mesh
export function buildChunk(O, W, A, ci, f) {
  const y0 = ci * CHUNK, NX = 56, NY = 26, rnd = mulberry32(ci * 31 + 5);
  const row = (j) => y0 + (j / NY) * CHUNK;
  const P = (i, j) => { const y = row(j), w = width(y) * 0.5 * 1.45, x = cx(y) - w + (i / NX) * 2 * w; return [x, y, H(x, y)]; };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const top = Math.min(a[2], b[2], c[2], d[2]);
    const col = top < 7 ? mixc([0.62, 0.42, 0.28], [0.55, 0.5, 0.32], rnd() * 0.6) : [0.78, 0.42, 0.26];
    O.quad(a, b, c, d, col, MAT.ROCK);
  }
  // the river
  for (let j = 0; j < NY; j++) { const ya = row(j), yb = row(j + 1), wa = width(ya) * 0.07, wb = width(yb) * 0.07; W.quad([cx(ya) - wa, ya, 0], [cx(ya) + wa, ya, 0], [cx(yb) + wb, yb, 0], [cx(yb) - wb, yb, 0], [0.15, 0.3, 0.35], MAT.WATER); }
  // distant mesas beyond the rim so the horizon isn't empty
  for (const s of [-1, 1]) { const y = y0 + CHUNK / 2, x = cx(y) + s * (width(y) * 0.75 + 260 + rnd() * 200), hgt = 90 + rnd() * 90, r = 60 + rnd() * 80; tube(O, x, y, 7, r, -5, r * 0.8, hgt, [0.7, 0.36, 0.24], MAT.FAR, rnd() * 6); }
  for (const s of f.spires) {
    tube(O, s.x, s.y, 9, s.r, s.z, s.r * 0.75, s.z + s.h * 0.75, [0.8, 0.45, 0.28], MAT.ROCK, rnd() * 6);
    tube(O, s.x, s.y, 9, s.r * 0.75, s.z + s.h * 0.75, s.r * 0.5, s.z + s.h, [0.74, 0.4, 0.26], MAT.ROCK, rnd() * 6);
    blob(O, [s.x, s.y, s.z + s.h + 1.5], s.r * 0.95, s.r * 0.95, 2.6, [0.5, 0.3, 0.22], MAT.ROCK, 8, 4);
  }
  for (const a of f.arches) {
    const N = 20;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N, X = (t) => a.x0 + (a.x1 - a.x0) * t;
      const zt = (t) => archZt(a, X(t)), zb = (t) => archZb(a, X(t)), hw = 5;
      const q = (t, z, s) => [X(t), a.y + s * hw, z];
      O.quad(q(t0, zt(t0), -1), q(t1, zt(t1), -1), q(t1, zt(t1), 1), q(t0, zt(t0), 1), [0.78, 0.44, 0.27], MAT.ROCK);
      O.quad(q(t0, zb(t0), -1), q(t1, zb(t1), -1), q(t1, zt(t1), -1), q(t0, zt(t0), -1), [0.72, 0.4, 0.25], MAT.ROCK);
      O.quad(q(t0, zb(t0), 1), q(t1, zb(t1), 1), q(t1, zt(t1), 1), q(t0, zt(t0), 1), [0.72, 0.4, 0.25], MAT.ROCK);
      O.quad(q(t0, zb(t0), -1), q(t1, zb(t1), -1), q(t1, zb(t1), 1), q(t0, zb(t0), 1), [0.6, 0.34, 0.22], MAT.ROCK);
    }
  }
  for (const [x, y, z, s] of f.bushes) blob(O, [x, y, z + s * 0.4], s, s, s * 0.7, mixc([0.35, 0.4, 0.2], [0.45, 0.42, 0.22], rnd()), MAT.SCRUB, 6, 3);
}
// the arch's underside height at lateral position x (flying below it scores; hitting it crashes)
export function archZb(a, x) { const t = clamp((x - a.x0) / (a.x1 - a.x0), 0, 1), sag = a.sag * (1 - (2 * t - 1) ** 2); return a.top - a.thick - (1 - sag / a.sag) * a.sag; }
export function archZt(a, x) { const t = clamp((x - a.x0) / (a.x1 - a.x0), 0, 1); return a.top + 2 * (1 - (2 * t - 1) ** 2); }
