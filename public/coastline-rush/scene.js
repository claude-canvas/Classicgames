// Coastline Rush static world (DESIGN.md §5): island terrain shaped around the road, the ocean, the road itself with
// curbs, guard rails, street lamps, palms, a lighthouse, a harbour village and moored sailboats.
import { MAT, tube, limb, blob, mulberry32, fbm, vnoise, mixc } from "./mesh.js";
import { F, LENGTH, HALF, RAIL, toWorld, frame, insideLoop, nearestTrack } from "./track.js";

export const LAMPS = [];
export const LIGHTHOUSE = { p: null };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function terrainH(x, y) {
  const n = nearestTrack(x, y), zt = n.f.p[2] - 0.5, d = Math.max(0, n.d - RAIL - 1);
  if (insideLoop(x, y)) { const hill = 14 + 46 * fbm(x * 0.003, y * 0.003, 3, 4); return zt + (hill - zt) * smooth(0, 140, d) - 0.1 * (vnoise(x * 0.1, y * 0.1, 1)); }
  const shore = -14 + 6 * fbm(x * 0.01, y * 0.01, 7, 3);
  return zt + (shore - zt) * smooth(0, 55 + zt * 1.2, d);
}

export function buildWorld(O, W, A) {
  const rnd = mulberry32(9);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const f of F) { x0 = Math.min(x0, f.p[0]); y0 = Math.min(y0, f.p[1]); x1 = Math.max(x1, f.p[0]); y1 = Math.max(y1, f.p[1]); }
  // ---- terrain grid
  const M = 380, S = 14, nx = Math.ceil((x1 - x0 + 2 * M) / S), ny = Math.ceil((y1 - y0 + 2 * M) / S), H = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) H.push(terrainH(x0 - M + i * S, y0 - M + j * S));
  const P = (i, j) => [x0 - M + i * S, y0 - M + j * S, H[j * (nx + 1) + i]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); if (Math.max(a[2], b[2], c[2], d[2]) < -3) continue; O.quad(a, b, c, d, mixc([1, 1, 1], [0.92, 0.95, 0.85], rnd()), MAT.LAND); }
  // ---- ocean: a big grid at z = 0 carrying water depth
  const WS = 40, wx = Math.ceil((x1 - x0 + 2 * 1800) / WS), wy = Math.ceil((y1 - y0 + 2 * 1800) / WS);
  const depth = (x, y) => (x > x0 - M && x < x1 + M && y > y0 - M && y < y1 + M ? Math.max(0, -terrainH(x, y)) : 30);
  const Wp = (i, j) => { const x = x0 - 1800 + i * WS, y = y0 - 1800 + j * WS; return [x, y, 0, depth(x, y)]; };
  for (let j = 0; j < wy; j++) for (let i = 0; i < wx; i++) W.quad(Wp(i, j), Wp(i + 1, j), Wp(i + 1, j + 1), Wp(i, j + 1), [1, 1, 1], MAT.SEA);
  // ---- road
  const N = F.length, ds = LENGTH / N, cols = [-RAIL, -HALF, -7.05, -3.6, 0, 3.6, 7.05, HALF, RAIL];
  for (let i = 0; i < N; i++) {
    const s0 = i * ds, s1 = (i + 1) * ds, curb = Math.abs(F[i].k) > 0.011 ? 1 : 0;
    for (let c = 0; c < cols.length - 1; c++) { const xa = cols[c], xb = cols[c + 1], Q = (s, x) => [...toWorld(s, x, 0.02), x]; O.quad4(Q(s0, xa), Q(s0, xb), Q(s1, xb), Q(s1, xa), [s0, curb, 0], [s0, curb, 0], [s1, curb, 0], [s1, curb, 0], MAT.ROAD); }
    // retaining walls under the road edge (visible on cliffs)
    for (const sd of [-1, 1]) { const a = toWorld(s0, sd * (RAIL + 0.2), 0), b = toWorld(s1, sd * (RAIL + 0.2), 0); O.quad(a, b, [b[0], b[1], b[2] - 7], [a[0], a[1], a[2] - 7], [0.55, 0.5, 0.46], MAT.MATTE); }
    // guard rails
    for (const sd of [-1, 1]) { const r0 = toWorld(s0, sd * (RAIL + 0.05), 0.55), r1 = toWorld(s1, sd * (RAIL + 0.05), 0.55), q0 = toWorld(s0, sd * (RAIL + 0.05), 0.85), q1 = toWorld(s1, sd * (RAIL + 0.05), 0.85); O.quad(r0, r1, q1, q0, [0.75, 0.75, 0.78], MAT.METAL); if (i % 2 === 0) limb(O, toWorld(s0, sd * (RAIL + 0.1), 0), toWorld(s0, sd * (RAIL + 0.1), 0.85), 0.06, 0.06, [0.4, 0.4, 0.42], MAT.METAL, 4); }
  }
  // ---- street lamps
  for (let s = 20, k = 0; s < LENGTH; s += 55, k++) {
    const sd = k % 2 ? 1 : -1, base = toWorld(s, sd * (RAIL + 0.8), 0), top = toWorld(s, sd * (RAIL + 0.8), 8.5), head = toWorld(s, sd * (RAIL - 1.5), 8.3);
    limb(O, base, top, 0.12, 0.09, [0.2, 0.2, 0.22], MAT.METAL, 6); limb(O, top, head, 0.08, 0.08, [0.2, 0.2, 0.22], MAT.METAL, 5);
    blob(O, head, 0.35, 0.35, 0.15, [2.0, 1.4, 0.7], MAT.EMIT, 6, 3); A.sprite(...head, 1.2, 0.35, 0.22, 0.08); LAMPS.push(head);
  }
  // ---- palms
  const palm = (x, y, z, h) => {
    const lean = [(rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25]; let p = [x, y, z];
    for (let k = 0; k < 5; k++) { const q = [x + lean[0] * h * (k + 1) / 5 * (k + 1) / 5, y + lean[1] * h * (k + 1) / 5 * (k + 1) / 5, z + h * (k + 1) / 5]; limb(O, p, q, 0.22 - k * 0.025, 0.2 - k * 0.025, [0.42, 0.33, 0.22], MAT.MATTE, 5); p = q; }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + rnd(), L = 3.2 + rnd(), tip = [p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L, p[2] - 1.3], mid = [p[0] + Math.cos(a) * L * 0.5, p[1] + Math.sin(a) * L * 0.5, p[2] + 0.4], w = 0.5, ox = -Math.sin(a) * w, oy = Math.cos(a) * w, c = mixc([0.2, 0.4, 0.12], [0.3, 0.48, 0.15], rnd());
      O.v(p[0], p[1], p[2], 0.4, ...c, MAT.FOLIAGE); O.v(mid[0] + ox, mid[1] + oy, mid[2], 0.8, ...c, MAT.FOLIAGE); O.v(mid[0] - ox, mid[1] - oy, mid[2], 0.8, ...c, MAT.FOLIAGE);
      O.v(mid[0] + ox, mid[1] + oy, mid[2], 0.8, ...c, MAT.FOLIAGE); O.v(...tip, 1.2, ...c, MAT.FOLIAGE); O.v(mid[0] - ox, mid[1] - oy, mid[2], 0.8, ...c, MAT.FOLIAGE); }
  };
  for (let k = 0, n = 0; k < 4000 && n < 360; k++) {
    const i = Math.floor(rnd() * N), f = F[i], sd = rnd() < 0.5 ? -1 : 1, off = RAIL + 3 + rnd() * 50, x = f.p[0] + f.r[0] * off * sd, y = f.p[1] + f.r[1] * off * sd, z = terrainH(x, y);
    if (z < 0.8) continue; if (nearestTrack(x, y).d < RAIL + 2) continue;
    palm(x, y, z - 0.3, 7 + rnd() * 6); n++;
  }
  // bushes/flowers on the hills
  for (let k = 0; k < 500; k++) { const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0); if (!insideLoop(x, y)) continue; const z = terrainH(x, y); if (z < 2 || nearestTrack(x, y).d < RAIL + 3) continue; const s = 1 + rnd() * 2.5; blob(O, [x, y, z + s * 0.4], s, s, s * 0.7, mixc([0.18, 0.32, 0.1], [0.3, 0.38, 0.12], rnd()), MAT.FOLIAGE, 6, 3); if (rnd() < 0.3) A.sprite(x, y, z + s, 0.6, 0.4, 0.15, 0.2); }
  // ---- lighthouse on the outermost headland
  let best = null; for (let i = 0; i < N; i += 10) { const f = F[i], p = [f.p[0] - f.r[0] * 40, f.p[1] - f.r[1] * 40]; const out = insideLoop(p[0], p[1]) ? [f.p[0] + f.r[0] * 40, f.p[1] + f.r[1] * 40] : p; const d = Math.hypot(out[0] - (x0 + x1) / 2, out[1] - (y0 + y1) / 2); if (!best || d > best.d) best = { d, out }; }
  { const [lx, ly] = best.out, z = Math.max(1, terrainH(lx, ly)); blob(O, [lx, ly, z - 2], 14, 14, 6, [0.5, 0.42, 0.36], MAT.LAND, 10, 4); for (let k = 0; k < 6; k++) tube(O, lx, ly, 12, 3.2 - k * 0.25, z + k * 4.5, 3.0 - k * 0.25, z + (k + 1) * 4.5, k % 2 ? [0.85, 0.15, 0.12] : [0.95, 0.94, 0.9], MAT.MATTE); const top = z + 27; tube(O, lx, ly, 12, 2.0, top, 2.0, top + 2.5, [2.0, 1.6, 0.9], MAT.EMIT); tube(O, lx, ly, 12, 2.4, top + 2.5, 0, top + 4.5, [0.2, 0.2, 0.22], MAT.METAL); LIGHTHOUSE.p = [lx, ly, top + 1.2]; A.sprite(lx, ly, top + 1.2, 8, 0.9, 0.7, 0.4); }
  // ---- harbour village: little houses on the island side of one stretch
  for (let k = 0; k < 70; k++) {
    const f = F[Math.floor(N * 0.62 + rnd() * N * 0.08) % N], sd = insideLoop(f.p[0] + f.r[0] * 30, f.p[1] + f.r[1] * 30) ? 1 : -1, off = RAIL + 10 + rnd() * 60;
    const x = f.p[0] + f.r[0] * off * sd + (rnd() - 0.5) * 20, y = f.p[1] + f.r[1] * off * sd + (rnd() - 0.5) * 20, z = terrainH(x, y); if (z < 1 || nearestTrack(x, y).d < RAIL + 6) continue;
    const w = 5 + rnd() * 4, d = 4 + rnd() * 3, h = 3 + rnd() * 3, col = [[0.95, 0.9, 0.82], [0.95, 0.75, 0.6], [0.7, 0.85, 0.9], [0.95, 0.85, 0.55]][Math.floor(rnd() * 4)], rot = rnd() * 3, ca = Math.cos(rot), sa = Math.sin(rot);
    const Q = (u, v, zz) => [x + u * ca - v * sa, y + u * sa + v * ca, zz];
    for (const [a, b, cc, dd] of [[[-w, -d], [w, -d]], [[w, -d], [w, d]], [[w, d], [-w, d]], [[-w, d], [-w, -d]]].map(([p, q]) => [Q(p[0] / 2, p[1] / 2, z - 1), Q(q[0] / 2, q[1] / 2, z - 1), Q(q[0] / 2, q[1] / 2, z + h), Q(p[0] / 2, p[1] / 2, z + h)])) O.quad(a, b, cc, dd, col, MAT.MATTE);
    O.quad(Q(-w / 2 - 0.3, -d / 2 - 0.3, z + h), Q(w / 2 + 0.3, -d / 2 - 0.3, z + h), Q(w / 2 + 0.3, 0, z + h + 2), Q(-w / 2 - 0.3, 0, z + h + 2), [0.75, 0.3, 0.2], MAT.MATTE); O.quad(Q(-w / 2 - 0.3, d / 2 + 0.3, z + h), Q(w / 2 + 0.3, d / 2 + 0.3, z + h), Q(w / 2 + 0.3, 0, z + h + 2), Q(-w / 2 - 0.3, 0, z + h + 2), [0.7, 0.28, 0.18], MAT.MATTE);
    if (rnd() < 0.7) { O.quad(Q(-0.6, -d / 2 - 0.05, z + 1), Q(0.6, -d / 2 - 0.05, z + 1), Q(0.6, -d / 2 - 0.05, z + 2.2), Q(-0.6, -d / 2 - 0.05, z + 2.2), [1.6, 1.0, 0.45], MAT.EMIT); }
  }
  // ---- sailboats out at sea
  for (let k = 0; k < 18; k++) { const a = rnd() * Math.PI * 2, R = 900 + rnd() * 700, x = (x0 + x1) / 2 + Math.cos(a) * R, y = (y0 + y1) / 2 + Math.sin(a) * R; blob(O, [x, y, 0.3], 1.4, 5, 0.8, [0.92, 0.92, 0.9], MAT.MATTE, 8, 3); limb(O, [x, y, 0.8], [x, y, 12], 0.1, 0.08, [0.6, 0.6, 0.6], MAT.METAL, 3); O.tri([x, y + 0.3, 1.5], [x, y + 0.3, 11.5], [x, y - 4, 1.8], [0.98, 0.95, 0.9], MAT.MATTE); }
}
