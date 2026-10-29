// Paper Brook stream (DESIGN.md §2): an open Catmull-Rom spline sampled every STEP m into frames.
// Brook space: s = distance downstream along the centre line, x = lateral offset (+ right), z is world up.
// Everything here is deterministic data (rocks, cascades, petals, twig spawns) shared by scene, boat and main.
import { mulberry32, fbm, vnoise, smooth, clamp, lerp } from "./mesh.js";

export const STEP = 0.5;
export const SECTIONS = [
  { name: "The Hollow", s0: 0, hw: 1.4, c: 1.5 },
  { name: "Stone Channel", s0: 125, hw: 1.1, c: 2.1 },
  { name: "Fern Rapids", s0: 245, hw: 1.3, c: 3.0 },
  { name: "Willow Pool", s0: 380, hw: 1.6, c: 0.9 },
];
export const FINISH = 468;
// sun: low and generally ahead (downstream), ~7° elevation
export const SUN = (() => { const v = [-0.32, 1, 0.13], l = Math.hypot(...v); return v.map((a) => a / l); })();

const CP = [[0, -40], [0, -20], [1, 0], [4, 40], [10, 80], [9, 120], [2, 160], [-7, 200], [-9, 240], [-2, 280], [8, 320], [10, 360], [3, 400], [-5, 440], [-6, 480], [-4, 520], [-3, 560]];
const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)); };
const dense = [];
for (let i = 1; i < CP.length - 2; i++) for (let k = 0; k < 80; k++) dense.push(cr(CP[i - 1], CP[i], CP[i + 1], CP[i + 2], k / 80));
const cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
// s = 0 sits at the CP[2] point (y = 0); the spline starts 20 m earlier so the camera has scenery behind it
const S0 = cum[80];
export const S_MIN = -18, S_MAX = cum[cum.length - 1] - S0 - 2;
export const LENGTH = S_MAX;

// cascades: { s, drop (m) } — the water level falls smoothly over 1.2 m
export const CASCADES = [{ s: 242, drop: 0.35 }, { s: 300, drop: 0.45 }, { s: 352, drop: 0.55 }];
export const CHECKPOINTS = [2, 125, 245, 380];
export const BRIDGES = [182, FINISH];
export const COTTAGES = [{ s: 50, x: 12, rot: 0.3 }, { s: 168, x: 15, rot: 0.15 }, { s: 300, x: 30, rot: 0.4 }];
export const MILL = { s: 458, side: -1 };
export const WHIRL = { s: 428, x: 1.2, r: 1.7 };

function secAt(s) { let k = 0; for (let i = 0; i < SECTIONS.length; i++) if (s >= SECTIONS[i].s0) k = i; return k; }
// smoothly blended section values (6 m blends at the boundaries)
function blend(s, key) {
  let v = SECTIONS[0][key];
  for (let i = 1; i < SECTIONS.length; i++) v = lerp(v, SECTIONS[i][key], smooth(SECTIONS[i].s0 - 6, SECTIONS[i].s0 + 6, s));
  return v;
}
function hwRaw(s) {
  let hw = blend(s, "hw") * (1 + (vnoise(s * 0.05, 3.3, 7) - 0.5) * 0.22);
  hw = lerp(hw, 4.6, smooth(392, 430, s));                     // the pool opens up
  hw = lerp(hw, 2.2, smooth(452, 462, s));                     // narrows to the mill race
  if (s > 245 && s < 380) hw *= 1 + (vnoise(s * 0.11, 9.1, 3) - 0.5) * 0.3;
  return hw;
}
function wzRaw(s) { let z = 12 - s * 0.012; for (const c of CASCADES) z -= c.drop * smooth(c.s - 0.6, c.s + 0.6, s); return z; }
function curRaw(s) {
  let c = blend(s, "c") * (1 + (vnoise(s * 0.07, 1.7, 5) - 0.5) * 0.25);
  for (const q of CASCADES) c += 1.6 * Math.exp(-(((s - q.s) / 3) ** 2));
  c = lerp(c, 0.7, smooth(400, 420, s)); c = lerp(c, 1.4, smooth(450, 462, s));
  return c;
}

export const F = [];
{
  const N = Math.floor((S_MAX - S_MIN) / STEP) + 1;
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = S_MIN + i * STEP, u = s + S0;
    while (j < cum.length - 2 && cum[j + 1] < u) j++;
    const t = clamp((u - cum[j]) / (cum[j + 1] - cum[j]), 0, 1), a = dense[j], b = dense[j + 1];
    F.push({ s, p: [lerp(a[0], b[0], t), lerp(a[1], b[1], t), wzRaw(s)], hw: hwRaw(s), c: curRaw(s), sec: secAt(s) });
  }
  for (let i = 0; i < N; i++) {
    const a = F[Math.max(0, i - 1)].p, b = F[Math.min(N - 1, i + 1)].p, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    F[i].t = [dx / l, dy / l, 0]; F[i].r = [dy / l, -dx / l, 0]; F[i].ang = Math.atan2(dy / l, dx / l);
  }
  for (let i = 0; i < N; i++) { const a = F[Math.max(0, i - 6)], b = F[Math.min(N - 1, i + 6)]; let d = b.ang - a.ang; F[i].k = d / (12 * STEP); }
}
export function frame(s) {
  const fi = clamp((s - S_MIN) / STEP, 0, F.length - 1.001), i = Math.floor(fi), t = fi - i, A = F[i], B = F[i + 1];
  const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const tt = L(A.t, B.t), l = Math.hypot(tt[0], tt[1]); tt[0] /= l; tt[1] /= l;
  return { s, p: L(A.p, B.p), t: tt, r: [tt[1], -tt[0], 0], hw: lerp(A.hw, B.hw, t), c: lerp(A.c, B.c, t), sec: A.sec, k: lerp(A.k, B.k, t), ang: Math.atan2(tt[1], tt[0]) };
}
export const wzAt = (s) => frame(s).p[2];
export function toWorld(s, x, h = 0) { const f = frame(s); return [f.p[0] + f.r[0] * x, f.p[1] + f.r[1] * x, f.p[2] + h]; }
// world xy → nearest brook (s, x); `hint` = a nearby s to search around (fast path)
export function toBrook(x, y, hint = null) {
  let best = 1e18, bi = 0;
  const i0 = hint === null ? 0 : Math.max(0, Math.floor((hint - 40 - S_MIN) / STEP)), i1 = hint === null ? F.length : Math.min(F.length, Math.ceil((hint + 40 - S_MIN) / STEP));
  for (let i = i0; i < i1; i += hint === null ? 4 : 1) { const p = F[i].p, d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < best) { best = d; bi = i; } }
  const f = F[bi], dx = x - f.p[0], dy = y - f.p[1];
  return { s: f.s + dx * f.t[0] + dy * f.t[1], x: dx * f.r[0] + dy * f.r[1] };
}

// stone walls line much of the brook: {s0, s1, side (−1, 1 or 0 = both), h (m above the water)}; 2.5 m ramps at the ends
export const WALLS = [{ s0: 6, s1: 118, side: 1, h: 0.95 }, { s0: 58, s1: 118, side: -1, h: 0.8 }, { s0: 126, s1: 243, side: 0, h: 1.45 }, { s0: 449, s1: 472, side: 0, h: 1.35 }];
export function wallH(s, side) {
  let h = 0;
  for (const w of WALLS) if ((w.side === 0 || w.side === side) && s > w.s0 && s < w.s1) h = Math.max(h, w.h * smooth(w.s0, w.s0 + 2.5, s) * (1 - smooth(w.s1 - 2.5, w.s1, s)));
  return h;
}
// 2 = walled bank, 0 = natural bank
export function wallAt(s, side) { return wallH(s, side) > 0.06 ? 2 : 0; }
// bank / terrain height (world z) at brook (s, x) for |x| ≥ hw − 0.4
export function groundZ(s, x) {
  const f = frame(s), side = x < 0 ? -1 : 1, d = Math.abs(x) - f.hw, wz = f.p[2];
  const w = wallAt(s, side);
  if (d < 0) return w > 0 && d > -0.3 ? wz - 0.32 : wz - 0.14 + (d + 0.4) * 0.3 - 0.12;   // under the water (walls stand on a deeper footing)
  const n1 = vnoise(s * 0.13, side * 5 + 11, 2), n2 = fbm(s * 0.03, side * 7 + x * 0.03, 9, 3);
  let rise;
  if (w === 2) rise = wallH(s, side) + 0.05 * smooth(0.3, 2, d) + d * 0.04 + 0.3 * smooth(1, 5, d) * n2;
  else rise = (0.5 * smooth(0, 1.1, d) * (0.7 + 0.6 * n1)) + 0.5 * smooth(0.8, 5, d) * n2;
  const pool = smooth(392, 425, s) * (1 - smooth(450, 460, s));
  rise *= 1 - pool * 0.55;
  const hills = (fbm((f.p[0] + f.r[0] * x) * 0.02, (f.p[1] + f.r[1] * x) * 0.02, 4, 4) * 9 - 2.5) * smooth(4, 30, d) + d * 0.05;
  return wz + Math.max(0.02 * smooth(0, 0.3, d), rise + Math.max(-0.5, hills));
}

// rocks in the water: {s, x, r, h}. Rows always leave a gap ≥ 0.75 m.
export const ROCKS = [];
// petals: {s, x, kind} kind 0 pink, 1 white, 2 gold
export const PETALS = [];
// twig spawn points (s where a twig appears ahead of the boat)
export const TWIGS = [];
// lily pads in the pool: {s, x, r, rot}
export const LILIES = [];
{
  const R = mulberry32(42);
  const nearCasc = (s, m) => CASCADES.some((c) => Math.abs(c.s - s) < m);
  const nearBridge = (s) => BRIDGES.some((b) => Math.abs(b - s) < 3);
  // the Hollow: a few rocks along the edges, one or two mid-stream
  for (let s = 14; s < 122; s += 9 + R() * 8) { const f = frame(s), side = R() < 0.5 ? -1 : 1; ROCKS.push({ s, x: side * (f.hw - 0.25 - R() * 0.35), r: 0.16 + R() * 0.16, h: 0.05 + R() * 0.12 }); if (R() < 0.35) ROCKS.push({ s: s + 3, x: (R() - 0.5) * 0.6, r: 0.13 + R() * 0.1, h: 0.04 + R() * 0.06 }); }
  // stone channel: small stones
  for (let s = 132; s < 238; s += 11 + R() * 9) { if (nearBridge(s)) continue; const f = frame(s); ROCKS.push({ s, x: (R() - 0.5) * f.hw * 1.2, r: 0.12 + R() * 0.08, h: 0.03 + R() * 0.05 }); }
  // fern rapids: rows with one gap each
  for (let s = 250; s < 376; s += 4.2 + R() * 3.5) {
    if (nearCasc(s, 3.5)) continue;
    const f = frame(s), gap = (R() - 0.5) * (f.hw * 1.3), gw = 0.42 + R() * 0.12;
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const x = -f.hw + 0.15 + R() * (f.hw * 2 - 0.3), r = 0.13 + R() * 0.2;
      if (Math.abs(x - gap) < gw + r) continue;
      ROCKS.push({ s: s + (R() - 0.5) * 1.2, x, r, h: 0.06 + R() * 0.2 });
    }
  }
  // cascade lips: rocks at the sides of each drop
  for (const c of CASCADES) { const f = frame(c.s); for (const sd of [-1, 1]) ROCKS.push({ s: c.s - 0.4, x: sd * (f.hw - 0.2), r: 0.28, h: 0.25 }); }
  // pool: a few large flat stones near the edge
  for (let s = 384; s < 448; s += 10 + R() * 8) { const f = frame(s), side = R() < 0.5 ? -1 : 1; ROCKS.push({ s, x: side * (f.hw - 0.5 - R()), r: 0.3 + R() * 0.2, h: 0.06 + R() * 0.08 }); }
  for (const r of ROCKS) r.z = wzAt(r.s);

  const clear = (s, x, m = 0.3) => !ROCKS.some((r) => Math.abs(r.s - s) < r.r + m && Math.abs(r.x - x) < r.r + m);
  // petal lines: arcs and zigzags that reward a good line
  for (let s = 10; s < FINISH - 8; s += 6 + R() * 6) {
    const f = frame(s), sec = f.sec, n = 3 + Math.floor(R() * 4), x0 = (R() - 0.5) * f.hw * 1.2, dx = (R() - 0.5) * 0.25;
    for (let k = 0; k < n; k++) {
      const ss = s + k * 1.1, ff = frame(ss), x = clamp(x0 + dx * k + Math.sin(k * 0.9) * 0.15, -ff.hw + 0.35, ff.hw - 0.35);
      if (!clear(ss, x) || nearCasc(ss, 1.5)) continue;
      PETALS.push({ s: ss, x, kind: R() < 0.07 + sec * 0.02 ? 2 : R() < 0.5 ? 0 : 1 });
    }
    // gold petals tucked behind rocks in the rapids
    if (sec === 2 && R() < 0.5) { const rk = ROCKS.find((r) => r.s > s && r.s < s + 6); if (rk) { const x = clamp(rk.x, -f.hw + 0.3, f.hw - 0.3); if (clear(rk.s + rk.r + 0.5, x, 0.15)) PETALS.push({ s: rk.s + rk.r + 0.5, x, kind: 2 }); } }
  }
  // twigs: more in the rapids
  for (let s = 30; s < 376; s += 14 + R() * 14) { if (nearCasc(s, 6)) continue; TWIGS.push({ s, x: (R() - 0.5) * 1.2, len: 0.35 + R() * 0.35, rot: R() * Math.PI, hard: frame(s).sec === 2 }); if (frame(s).sec === 2 && R() < 0.5) s -= 6; }
  // lilies in the pool, keeping a channel open through the middle
  for (let i = 0; i < 70; i++) {
    const s = 396 + R() * 54, f = frame(s), x = (R() < 0.5 ? -1 : 1) * (0.9 + R() * (f.hw - 1.0));
    if (Math.abs(f.hw) < 2) continue;
    const r = 0.14 + R() * 0.16;
    if (Math.hypot((s - WHIRL.s) * 0.6, x - WHIRL.x) < WHIRL.r + 0.3) continue;
    if (LILIES.some((l) => Math.hypot(l.s - s, l.x - x) < l.r + r + 0.05)) continue;
    LILIES.push({ s, x, r, rot: R() * Math.PI * 2, flower: R() < 0.25 ? (R() < 0.5 ? 0 : 1) : -1 });
  }
}
export function curAt(s, x) {
  const f = frame(s), q = clamp(x / f.hw, -1.2, 1.2);
  return f.c * (1 - 0.55 * q * q);
}
