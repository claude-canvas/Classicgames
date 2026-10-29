// Sunrise Drift balloon: flight physics (DESIGN.md §1) and the envelope/basket model (§5).
import { MAT, Mesh, tube, limb, mixc, clamp } from "./mesh.js";

// ---------------------------------------------------------------- physics
export const PHYS = { K: 0.012, T_HOVER: 70, DRAG: 0.05, BURN: 2.6, COOL: 0.012, VENT: 7, T_MAX: 140, FUEL_RATE: 0.3, TAU_H: 5 };

// wind for altitude z (m) from a flight's layers [{top, dir (deg, blowing toward; 0 = north), spd}], blended across
// each boundary over ±18 m, with a slow wobble in direction
export function windAt(layers, z, t = 0) {
  let wx = 0, wy = 0, wsum = 0;
  for (let i = 0; i < layers.length; i++) {
    const lo = i ? layers[i - 1].top : -1e9, hi = layers[i].top;
    const a = lo < -1e8 ? 1 : sm(lo - 18, lo + 18, z), b = hi > 1e8 ? 1 : 1 - sm(hi - 18, hi + 18, z), w = a * b;
    if (w <= 0) continue;
    // inside a layer the wind veers with height (about ±14°), so small altitude changes fine-tune the heading
    const L = layers[i], bot = lo < -1e8 ? 0 : lo, thick = hi > 1e8 ? 220 : hi - bot, f = clamp((z - bot) / thick, 0, 1.3) - 0.5;
    const d = ((L.dir + (L.veer ?? 28) * f + Math.sin(t * 0.03 + i * 2.1) * 4) * Math.PI) / 180;
    wx += Math.sin(d) * L.spd * w; wy += Math.cos(d) * L.spd * w; wsum += w;
  }
  return wsum > 0 ? [wx / wsum, wy / wsum] : [0, 0];
}
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function layerIndex(layers, z) { for (let i = 0; i < layers.length; i++) if (z < layers[i].top) return i; return layers.length - 1; }

export function makeBalloon(x, y, z) { return { x, y, z, vx: 0, vy: 0, vz: 0, T: 45, fuel: 100, burning: false, venting: false, ground: true, touch: null, rot: 0 }; }

// one physics step; groundH(x, y) gives the terrain. Returns a touchdown {vz} when the basket meets the ground.
export function stepBalloon(b, dt, layers, groundH, t) {
  const P = PHYS;
  const burn = b.burning && b.fuel > 0;
  b.T += ((burn ? P.BURN : 0) - b.T * P.COOL - (b.venting ? P.VENT : 0)) * dt;
  b.T = clamp(b.T, 0, P.T_MAX);
  if (burn) b.fuel = Math.max(0, b.fuel - P.FUEL_RATE * dt);
  const a = P.K * (b.T - P.T_HOVER) - P.DRAG * b.vz * Math.abs(b.vz);
  b.vz += a * dt;
  const [wx, wy] = windAt(layers, b.z, t);
  const gz = groundH(b.x, b.y);
  const hk = b.ground ? 0.15 : 1;                       // a basket on the ground barely moves
  b.vx += (wx - b.vx) * Math.min(1, (dt / P.TAU_H) * hk); b.vy += (wy - b.vy) * Math.min(1, (dt / P.TAU_H) * hk);
  if (b.ground) { b.vx *= Math.exp(-dt * 2.5); b.vy *= Math.exp(-dt * 2.5); }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.rot += dt * 0.02;
  let touch = null;
  if (b.z <= gz) {
    if (!b.ground && b.vz < -0.05) touch = { vz: -b.vz };
    b.z = gz; if (b.vz < 0) b.vz = 0; b.ground = true;
  } else if (b.z > gz + 0.3) b.ground = false;
  return touch;
}

// ---------------------------------------------------------------- model
// envelope profile: [height fraction, radius fraction]
const PROF = [[0, 0.19], [0.08, 0.3], [0.2, 0.55], [0.33, 0.78], [0.47, 0.94], [0.6, 1.0], [0.7, 0.98], [0.8, 0.9], [0.88, 0.76], [0.94, 0.56], [0.98, 0.3], [1, 0]];
export const ENV = { THROAT: 4.4, H: 20, R: 8.4 };
export const PATTERNS = [
  { kind: "stripes", cols: [[0.92, 0.18, 0.12], [0.98, 0.82, 0.2]] },
  { kind: "rainbow" },
  { kind: "bands", cols: [[0.1, 0.35, 0.75], [0.95, 0.95, 0.92], [0.85, 0.15, 0.12]] },
  { kind: "checker", cols: [[0.15, 0.55, 0.35], [0.95, 0.9, 0.75]] },
  { kind: "crown", cols: [[0.55, 0.15, 0.55], [0.98, 0.75, 0.2]] },
  { kind: "stripes", cols: [[0.1, 0.5, 0.75], [0.95, 0.95, 0.95]] },
  { kind: "bands", cols: [[0.95, 0.5, 0.1], [0.9, 0.2, 0.25], [0.98, 0.85, 0.3]] },
  { kind: "stripes", cols: [[0.2, 0.2, 0.25], [0.95, 0.45, 0.1]] },
  { kind: "checker", cols: [[0.85, 0.12, 0.25], [0.98, 0.95, 0.9]] },
  { kind: "crown", cols: [[0.1, 0.4, 0.7], [0.98, 0.98, 0.95]] },
];
const RAINBOW = [[0.9, 0.15, 0.15], [0.98, 0.5, 0.1], [0.98, 0.85, 0.15], [0.25, 0.7, 0.3], [0.15, 0.45, 0.85], [0.45, 0.25, 0.75]];

export function buildBalloonModel(pattern, detail = 1) {
  const m = new Mesh(6000);
  const G = detail ? 16 : 12, SUB = detail ? 2 : 1, NR = PROF.length - 1, { THROAT, H, R } = ENV;
  const colAt = (g, j) => {
    const p = pattern;
    if (p.kind === "rainbow") return RAINBOW[g % RAINBOW.length];
    if (p.kind === "stripes") return p.cols[g % 2];
    if (p.kind === "bands") return p.cols[Math.min(p.cols.length - 1, Math.floor((j / NR) * p.cols.length * 1.3) % p.cols.length)];
    if (p.kind === "checker") return p.cols[(g + Math.floor(j / 2)) % 2];
    if (p.kind === "crown") return j >= NR - 4 ? p.cols[1] : j >= NR - 5 ? [0.98, 0.98, 0.95] : p.cols[0];
    return [0.9, 0.9, 0.9];
  };
  for (let g = 0; g < G; g++) for (let s = 0; s < SUB; s++) for (let j = 0; j < NR; j++) {
    const f0 = (g + s / SUB) / G, f1 = (g + (s + 1) / SUB) / G;
    const bul0 = 1 + 0.035 * Math.sin((s / SUB) * Math.PI), bul1 = 1 + 0.035 * Math.sin(((s + 1) / SUB) * Math.PI);
    const P = (f, k, bul) => { const a = f * Math.PI * 2, [h, r] = PROF[k]; return [Math.cos(a) * r * R * bul, Math.sin(a) * r * R * bul, THROAT + h * H, h]; };
    let c = colAt(g, j);
    if (s === 0 && SUB > 1) c = c.map((v) => v * 0.93);
    m.quad(P(f0, j, bul0), P(f1, j, bul1), P(f1, j + 1, bul1), P(f0, j + 1, bul0), c, MAT.ENVELOPE);
  }
  // load tapes: thin dark seams up the gores (only in the detailed model)
  // basket
  const wick = [0.55, 0.38, 0.2], rim = [0.32, 0.2, 0.1];
  const bw = 0.7, bh = 1.15;
  const q = (a, b, c, d, col, mat = MAT.MATTE) => m.quad(a, b, c, d, col, mat);
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ux = sy, uy = -sx;
    q([sx * bw - ux * bw, sy * bw - uy * bw, 0, 1], [sx * bw + ux * bw, sy * bw + uy * bw, 0, 1], [sx * bw + ux * bw, sy * bw + uy * bw, bh, 1], [sx * bw - ux * bw, sy * bw - uy * bw, bh, 1], wick);
  }
  q([-bw, -bw, 0.02, 1], [bw, -bw, 0.02, 1], [bw, bw, 0.02, 1], [-bw, bw, 0.02, 1], rim);
  tube(m, 0, 0, 4, bw * 1.45, bh, bw * 1.45, bh + 0.1, rim, MAT.MATTE, Math.PI / 4, false);
  // ropes / frame to the throat + burner
  const tr = PROF[0][1] * R;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    limb(m, [sx * bw, sy * bw, bh + 0.05], [sx * 0.45, sy * 0.45, 2.7], 0.03, 0.03, [0.3, 0.3, 0.32], MAT.GLOSS, 3);
    limb(m, [sx * 0.45, sy * 0.45, 2.7], [sx * tr * 0.71, sy * tr * 0.71, THROAT], 0.02, 0.02, [0.2, 0.18, 0.16], MAT.MATTE, 3);
  }
  tube(m, 0, 0, 8, 0.32, 2.55, 0.32, 2.95, [0.75, 0.75, 0.78], MAT.GLOSS);
  tube(m, 0, 0, 8, 0.22, 2.95, 0.12, 3.3, [0.5, 0.5, 0.52], MAT.GLOSS);
  tube(m, 0, 0, 16, tr * 1.02, THROAT - 0.15, tr * 1.02, THROAT + 0.3, [0.15, 0.12, 0.1], MAT.MATTE, 0, false);   // scoop/skirt
  return m;
}

// copy a model into M at (x, y, z), rotated by rot, with the burner glow written into the envelope verts
export function putBalloon(M, T, x, y, z, rot, glow) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < T.n; i++) {
    const o = i * 4, px = T.pos[o], py = T.pos[o + 1], mat = T.col[o + 3];
    const w = mat === MAT.ENVELOPE ? glow * Math.max(0, 1.05 - T.pos[o + 3] * 0.9) : T.pos[o + 3];
    M.v(x + px * c - py * s, y + px * s + py * c, z + T.pos[o + 2], w, T.col[o], T.col[o + 1], T.col[o + 2], mat);
  }
}
