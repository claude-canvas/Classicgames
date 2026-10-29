// Lanternfall static world (DESIGN.md §3): terrain, water, grass and props, built in 25 m tiles (O opaque,
// G grass, W water, A additive) so only nearby tiles are drawn. Also bakes the dapple/shadow map from tree crowns
// and buildings along the chapter's sun (or moon) direction. Runs in worker.js (falls back to the main thread).
import { Mesh, MAT, limb, blob, tube, mulberry32, fbm, vnoise, clamp, lerp, smooth, mixc } from "./mesh.js";
import { HALF, ENVS } from "./maps.js";

export const TILE = 25, NT = (2 * HALF) / TILE;
const TAU = Math.PI * 2;
function setW(m, from, w) { for (let i = from; i < m.n; i++) m.pos[i * 4 + 3] = typeof w === "function" ? w(m.pos[i * 4 + 2]) : w; }
const rot2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
// oriented box: centre o, yaw rot, half sizes
function box(m, o, rot, hx, hy, hz, col, mat, bottom = false) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (a, b, z) => [o[0] + c * a * hx - s * b * hy, o[1] + s * a * hx + c * b * hy, o[2] + z * hz];
  m.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), col, mat);
  m.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), col, mat);
  m.quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), col, mat);
  m.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), col, mat);
  m.quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), col, mat);
  if (bottom) m.quad(P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), col, mat);
}
// a natural rock (noise-displaced sphere with fracture planes); pos.w = water level for the wet line
export function rock(m, c, rx, ry, rz, col, wz, R, seg = 10, rings = 7) {
  const from = m.n, o1 = R() * 50, o2 = R() * 50, cuts = [];
  for (let k = 0; k < 3; k++) { const a = R() * TAU, e = (R() - 0.3) * 1.2; cuts.push([Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e), 0.72 + R() * 0.18]); }
  const P = [], C = [];
  for (let j = 0; j <= rings; j++) {
    const row = [], crow = [];
    for (let i = 0; i < seg; i++) {
      const th = (j / rings) * Math.PI, ph = (i / seg) * TAU, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      let k = 0.78 + 0.32 * vnoise(d[0] * 1.6 + d[2] + o1, d[1] * 1.6 - d[2] + o2, 3) + 0.1 * vnoise(d[0] * 4.5 + o2, d[1] * 4.5 + d[2] * 3, 5);
      for (const q of cuts) { const t = d[0] * q[0] + d[1] * q[1] + d[2] * q[2]; if (t * k > q[3]) k = q[3] / Math.max(0.2, t); }
      let z = d[2] * rz * k; if (z < 0) z *= 0.45;
      row.push([c[0] + d[0] * rx * k, c[1] + d[1] * ry * k, c[2] + z]);
      const v = 0.85 + 0.3 * vnoise(d[0] * 3 + o1, d[1] * 3 + d[2] * 2, 8); crow.push([col[0] * v, col[1] * v, col[2] * v]);
    }
    P.push(row); C.push(crow);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const i1 = (i + 1) % seg; m.quad4(P[j][i], P[j + 1][i], P[j + 1][i1], P[j][i1], C[j][i], C[j + 1][i], C[j + 1][i1], C[j][i1], MAT.ROCK); }
  setW(m, from, wz);
}

// ------------------------------------------------------------------ trees: shape data (shared with the shadow bake)
export function treeShape(p) {
  const R = mulberry32(p.seed), s = p.s, z0 = p.z - 0.3;
  const T = { trunk: [], branches: [], crowns: [], kind: p.kind };
  if (p.kind === "pine") {
    const H = (9 + R() * 5) * s; T.trunk = [[p.x, p.y, z0], [p.x, p.y, z0 + H]]; T.r0 = 0.22 * s;
    for (let k = 0; k < 4; k++) { const t = 0.25 + k * 0.19; T.crowns.push({ c: [p.x, p.y, z0 + H * t], r: (2.6 - k * 0.5) * s, h: H * 0.32, cone: 1 }); }
    return T;
  }
  const H = (p.kind === "willow" ? 7 : p.kind === "dead" ? 7 : 8) * s + R() * 3 * s, r0 = (0.2 + R() * 0.1) * s * (p.kind === "oak" ? 1.4 : 1);
  T.r0 = r0;
  const lx = (R() - 0.5) * 0.12 * H, ly = (R() - 0.5) * 0.12 * H;
  for (let k = 0; k <= 4; k++) { const t = k / 4; T.trunk.push([p.x + lx * t * t + (k ? (R() - 0.5) * 0.2 : 0), p.y + ly * t * t + (k ? (R() - 0.5) * 0.2 : 0), z0 + t * H]); }
  const at = (h) => { const f = h * 4, k = Math.min(3, Math.floor(f)), t = f - k; return T.trunk[k].map((v, j) => v + (T.trunk[k + 1][j] - v) * t); };
  const nb = p.kind === "dead" ? 5 : 4 + Math.floor(R() * 3);
  for (let b = 0; b < nb; b++) {
    const h = 0.42 + R() * 0.45, base = at(h), az = R() * TAU, len = (1.4 + R() * 2.2) * s * (p.kind === "oak" ? 1.3 : 1), up = p.kind === "willow" ? 0.5 : 0.35 + R() * 0.6;
    const end = [base[0] + Math.cos(az) * len, base[1] + Math.sin(az) * len, base[2] + up * len];
    T.branches.push([base, end, r0 * (0.5 - h * 0.25)]);
    if (p.kind !== "dead") T.crowns.push({ c: [end[0], end[1], end[2] + 0.2], r: (1.2 + R() * 1.0) * s * (p.kind === "oak" ? 1.25 : 1) });
  }
  if (p.kind !== "dead") T.crowns.push({ c: [...at(1)].map((v, j) => (j === 2 ? v + 0.6 : v)), r: (1.5 + R() * 0.8) * s * (p.kind === "oak" ? 1.3 : 1) });
  return T;
}
const LEAF = { oak: [[0.16, 0.27, 0.06], [0.22, 0.32, 0.08]], birch: [[0.3, 0.42, 0.1], [0.4, 0.5, 0.14]], pine: [[0.08, 0.2, 0.1], [0.1, 0.24, 0.12]], autumn: [[0.72, 0.32, 0.07], [0.85, 0.58, 0.12]], willow: [[0.22, 0.34, 0.1], [0.3, 0.42, 0.12]], dead: [[0, 0, 0], [0, 0, 0]] };
function tree(O, p) {
  const T = treeShape(p), R = mulberry32(p.seed + 9);
  const bark = p.kind === "birch" ? [0.82, 0.8, 0.74] : p.kind === "dead" ? [0.26, 0.24, 0.24] : [0.27, 0.2, 0.15];
  for (let k = 0; k < T.trunk.length - 1; k++) limb(O, T.trunk[k], T.trunk[k + 1], T.r0 * (1 - k * 0.18) * (k === 0 ? 1.35 : 1), T.r0 * (1 - (k + 1) * 0.18) + 0.02, bark, MAT.BARK, 6);
  for (const [a, b, r] of T.branches) { limb(O, a, b, Math.max(0.04, r), 0.025, bark, MAT.BARK, 4); if (p.kind === "dead") { const m = [lerp(a[0], b[0], 0.6), lerp(a[1], b[1], 0.6), lerp(a[2], b[2], 0.6)]; limb(O, m, [m[0] + (R() - 0.5) * 1.5, m[1] + (R() - 0.5) * 1.5, m[2] + 0.8], 0.03, 0.01, bark, MAT.BARK, 3); } }
  const L = LEAF[p.kind], leaf = mixc(L[0], L[1], R());
  for (const c of T.crowns) {
    const from = O.n;
    if (c.cone) tube(O, c.c[0], c.c[1], 9, c.r, c.c[2], 0, c.c[2] + c.h, leaf, MAT.FOLIAGE, R() * 3, false);
    else {
      const n = 2 + (R() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const r = c.r * (k ? 0.6 + R() * 0.3 : 0.9), cc = k ? [c.c[0] + (R() - 0.5) * c.r, c.c[1] + (R() - 0.5) * c.r, c.c[2] + (R() - 0.5) * c.r * 0.6] : c.c;
        blob(O, cc, r, r * (0.85 + R() * 0.3), r * (p.kind === "willow" ? 1.0 : 0.72), leaf, MAT.FOLIAGE, 7, 5, (i, j) => 0.82 + 0.3 * vnoise(i * 1.1 + k * 3, j * 1.4 + p.seed % 97, 3), (i, j) => mixc([leaf[0] * 1.45, leaf[1] * 1.4, leaf[2] * 1.2], [leaf[0] * 0.55, leaf[1] * 0.6, leaf[2] * 0.6], j / 5));
      }
      if (p.kind === "willow") for (let k = 0; k < 10; k++) { const a = R() * TAU, r = c.r * 0.9, top = [c.c[0] + Math.cos(a) * r, c.c[1] + Math.sin(a) * r, c.c[2]]; limb(O, top, [top[0] + Math.cos(a) * 0.3, top[1] + Math.sin(a) * 0.3, top[2] - 2.5 - R() * 1.5], 0.22, 0.06, leaf, MAT.FOLIAGE, 4); }
    }
    setW(O, from, 0.06);
  }
}

// ------------------------------------------------------------------ props
const PLASTERS = [[0.86, 0.8, 0.68], [0.78, 0.72, 0.6], [0.9, 0.84, 0.74], [0.74, 0.66, 0.56]];
const ROOFS = [[0.42, 0.18, 0.12], [0.3, 0.32, 0.38], [0.55, 0.42, 0.22], [0.36, 0.22, 0.14]];
const TIMBER = [0.22, 0.14, 0.09];
function cottage(O, A, p, LIGHTS) {
  const { x, y, rot, v } = p, gz = p.z - 0.15, hx = p.hx, hy = p.hy, wallH = 2.7, c = Math.cos(rot), s = Math.sin(rot);
  const L = (a, b, z) => [x + c * a - s * b, y + s * a + c * b, gz + z];
  const plaster = PLASTERS[v % 4], roof = ROOFS[v % 4];
  box(O, L(0, 0, -0.4), rot, hx + 0.1, hy + 0.1, 0.75, [0.48, 0.45, 0.4], MAT.ROCK); setW(O, O.n - 30, -99);
  box(O, L(0, 0, wallH / 2 + 0.35), rot, hx, hy, wallH / 2, plaster, MAT.PLASTER);
  for (const a of [-1, -0.33, 0.33, 1]) for (const b of [-1, 1]) box(O, L(a * hx, b * (hy + 0.02), wallH / 2 + 0.35), rot, 0.09, 0.03, wallH / 2, TIMBER, MAT.WOOD);
  for (const b of [-1, 1]) box(O, L(0, b * (hy + 0.02), wallH + 0.3), rot, hx, 0.035, 0.07, TIMBER, MAT.WOOD);
  const rh = 2.1, ov = 0.5, top = wallH + 0.35;
  for (const b of [-1, 1]) {
    const e0 = L(-hx - ov, b * (hy + ov), top - 0.3), e1 = L(hx + ov, b * (hy + ov), top - 0.3), r0 = L(-hx - ov, 0, top + rh), r1 = L(hx + ov, 0, top + rh);
    // roof made of overlapping tile rows
    for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6 + 0.02, a0 = e0.map((v, i) => lerp(v, r0[i], t0)), a1 = e1.map((v, i) => lerp(v, r1[i], t0)), b0 = e0.map((v, i) => lerp(v, r0[i], t1)), b1 = e1.map((v, i) => lerp(v, r1[i], t1)); const sh = 0.85 + (k % 2) * 0.12; O.quad(a0, a1, b1, b0, roof.map((q) => q * sh), MAT.MATTE); }
    const d = [0, 0, -0.12]; O.quad(e0.map((q, i) => q + d[i]), r0.map((q, i) => q + d[i]), r1.map((q, i) => q + d[i]), e1.map((q, i) => q + d[i]), [0.12, 0.08, 0.06], MAT.MATTE);
  }
  for (const a of [-1, 1]) O.tri(L(a * hx, -hy, top), L(a * hx, hy, top), L(a * hx, 0, top + rh - 0.1), plaster, MAT.PLASTER);
  box(O, L(hx * 0.5, hy * 0.35, top + rh * 0.75), rot, 0.32, 0.32, rh * 0.6, [0.45, 0.4, 0.36], MAT.ROCK); setW(O, O.n - 30, -99);
  for (const b of [-1, 1]) for (const a of [-0.6, 0.6]) {
    box(O, L(a * hx, b * (hy + 0.04), 1.7), rot, 0.45, 0.035, 0.5, TIMBER, MAT.WOOD);
    const g = L(a * hx, b * (hy + 0.08), 1.7), q = (u, z) => [g[0] + c * u, g[1] + s * u, g[2] + z];
    O.quad(q(-0.36, -0.42), q(0.36, -0.42), q(0.36, 0.42), q(-0.36, 0.42), [1.7, 1.0, 0.45], MAT.EMIT);
    O.quad(q(-0.025, -0.42), q(0.025, -0.42), q(0.025, 0.42), q(-0.025, 0.42), TIMBER, MAT.WOOD);
    // window box with flowers
    box(O, L(a * hx, b * (hy + 0.18), 1.12), rot, 0.42, 0.1, 0.07, [0.35, 0.24, 0.15], MAT.WOOD);
    for (let k = 0; k < 5; k++) blob(O, L(a * hx - 0.32 + k * 0.16, b * (hy + 0.2), 1.25), 0.07, 0.07, 0.06, [[0.9, 0.3, 0.4], [0.95, 0.8, 0.3], [0.7, 0.5, 0.9]][(k + v) % 3], MAT.SOFT, 5, 3);
    A.sprite(...L(a * hx, b * (hy + 0.5), 1.7), 1.0, 0.12, 0.07, 0.025);
    if (b < 0 && a > 0) LIGHTS.push(L(a * hx, b * (hy + 1.2), 1.7));
  }
  box(O, L(-hx * 0.15, -(hy + 0.05), 1.35), rot, 0.48, 0.05, 1.0, [0.36, 0.22, 0.13], MAT.WOOD);
  blob(O, L(-hx * 0.15 + 0.3, -(hy + 0.11), 1.3), 0.04, 0.04, 0.04, [0.8, 0.65, 0.3], MAT.METAL, 5, 3);
}
function lampPost(O, p) {
  const z = p.z, h = p.small ? 2.1 : 2.8;
  limb(O, [p.x, p.y, z - 0.2], [p.x, p.y, z + h], 0.06, 0.045, [0.16, 0.15, 0.16], MAT.METAL, 6);
  limb(O, [p.x, p.y, z + h], [p.x + 0.4, p.y, z + h + 0.08], 0.03, 0.03, [0.16, 0.15, 0.16], MAT.METAL, 4);
  box(O, [p.x + 0.4, p.y, z + h - 0.2], 0, 0.15, 0.15, 0.02, [0.16, 0.15, 0.16], MAT.METAL);
  box(O, [p.x + 0.4, p.y, z + h + 0.02], 0, 0.16, 0.16, 0.03, [0.16, 0.15, 0.16], MAT.METAL);
  for (const [dx, dy] of [[-0.14, -0.14], [0.14, -0.14], [0.14, 0.14], [-0.14, 0.14]]) limb(O, [p.x + 0.4 + dx, p.y + dy, z + h - 0.2], [p.x + 0.4 + dx, p.y + dy, z + h], 0.012, 0.012, [0.16, 0.15, 0.16], MAT.METAL, 3);
  p.flame = [p.x + 0.4, p.y, z + h - 0.1];
}
function fence(O, a, b, R, H) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 2.2)), wood = [0.4, 0.3, 0.2];
  const pt = (t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  for (let i = 0; i <= n; i++) { const [x, y] = pt(i / n), z = H(x, y); limb(O, [x, y, z - 0.2], [x + (R() - 0.5) * 0.05, y, z + 1.05], 0.06, 0.05, wood.map((v) => v * (0.8 + R() * 0.3)), MAT.WOOD, 5); }
  for (let i = 0; i < n; i++) { const [x0, y0] = pt(i / n), [x1, y1] = pt((i + 1) / n); for (const hh of [0.45, 0.85]) limb(O, [x0, y0, H(x0, y0) + hh], [x1, y1, H(x1, y1) + hh + (R() - 0.5) * 0.06], 0.035, 0.035, wood, MAT.WOOD, 4); }
}
function deck(O, p, R) {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, vx = -uy, vy = ux, n = Math.ceil(L / 0.32);
  const zAt = (t) => lerp(p.za, p.zb, t) + (p.t === "bridge" ? Math.sin(t * Math.PI) * 0.5 : 0);
  if (p.log) { for (const o of [-0.45, 0.45]) limb(O, [p.a[0] + vx * o, p.a[1] + vy * o, zAt(0) - 0.15], [p.b[0] + vx * o, p.b[1] + vy * o, zAt(1) - 0.15], 0.38, 0.34, [0.33, 0.24, 0.16], MAT.BARK, 8); return; }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cx = p.a[0] + dx * t, cy = p.a[1] + dy * t, z = zAt(t);
    box(O, [cx, cy, z - 0.04], Math.atan2(vy, vx), p.w / 2 + (R() - 0.5) * 0.08, 0.14, 0.045, [0.42, 0.31, 0.2].map((v) => v * (0.8 + R() * 0.35)), MAT.WOOD);
  }
  for (const o of [-p.w / 2 + 0.15, p.w / 2 - 0.15]) for (let i = 0; i <= Math.ceil(L / 2); i++) { const t = i / Math.ceil(L / 2), cx = p.a[0] + dx * t + vx * o, cy = p.a[1] + dy * t + vy * o, z = zAt(t); limb(O, [cx, cy, Math.min(z, -1.5 + z)], [cx, cy, z + (p.t === "bridge" ? 0.95 : p.t === "dock" ? 0.6 : -0.05)], 0.07, 0.07, [0.3, 0.22, 0.15], MAT.WOOD, 5); }
  if (p.t === "bridge") for (const o of [-p.w / 2 + 0.15, p.w / 2 - 0.15]) for (let i = 0; i < 12; i++) { const t0 = i / 12, t1 = (i + 1) / 12; limb(O, [p.a[0] + dx * t0 + vx * o, p.a[1] + dy * t0 + vy * o, zAt(t0) + 0.92], [p.a[0] + dx * t1 + vx * o, p.a[1] + dy * t1 + vy * o, zAt(t1) + 0.92], 0.04, 0.04, [0.38, 0.28, 0.18], MAT.WOOD, 4); }
}
function prop(O, A, p, S, R, LIGHTS) {
  const H = S.h, z = p.z;
  switch (p.t) {
    case "cottage": cottage(O, A, p, LIGHTS); break;
    case "tree": tree(O, p); break;
    case "rock": rock(O, [p.x, p.y, z + p.s * 0.1], p.s, p.s * (0.7 + R() * 0.5), p.s * (0.5 + R() * 0.4), [[0.5, 0.49, 0.46], [0.56, 0.5, 0.42], [0.42, 0.44, 0.47]][Math.floor(R() * 3)], S.waterZ, R); break;
    case "bush": { const n = 3 + Math.floor(R() * 3), base = mixc([0.12, 0.22, 0.06], [0.2, 0.3, 0.08], R()); for (let k = 0; k < n; k++) { const r = (0.35 + R() * 0.35) * p.s, from = O.n; blob(O, [p.x + (R() - 0.5) * p.s, p.y + (R() - 0.5) * p.s, z + r * 0.6], r, r, r * 0.8, base, MAT.FOLIAGE, 7, 5, (i, j) => 0.85 + 0.3 * vnoise(i * 1.3 + k, j * 1.7, 5)); setW(O, from, 0.02); } if (R() < 0.3) for (let k = 0; k < 6; k++) blob(O, [p.x + (R() - 0.5) * p.s, p.y + (R() - 0.5) * p.s, z + 0.5 * p.s + R() * 0.3], 0.05, 0.05, 0.05, [[0.9, 0.2, 0.3], [0.95, 0.9, 0.95], [0.5, 0.4, 0.95]][Math.floor(R() * 3)], MAT.SOFT, 5, 3); break; }
    case "well": { tube(O, p.x, p.y, 14, 1.1, z - 0.2, 1.1, z + 0.75, [0.55, 0.52, 0.47], MAT.ROCK, 0, false); setW(O, O.n - 84, -99); tube(O, p.x, p.y, 14, 0.9, z + 0.75, 0.9, z + 0.2, [0.4, 0.38, 0.34], MAT.ROCK, 0, false); O.quad([p.x - 0.9, p.y - 0.9, z + 0.4], [p.x + 0.9, p.y - 0.9, z + 0.4], [p.x + 0.9, p.y + 0.9, z + 0.4], [p.x - 0.9, p.y + 0.9, z + 0.4], [0.05, 0.08, 0.1], MAT.MATTE); for (const sx of [-1, 1]) limb(O, [p.x + sx * 1.0, p.y, z + 0.7], [p.x + sx * 1.0, p.y, z + 2.3], 0.08, 0.07, [0.35, 0.25, 0.16], MAT.WOOD, 5); for (const sy of [-1, 1]) O.quad([p.x - 1.4, p.y + sy * 0.1, z + 2.2], [p.x + 1.4, p.y + sy * 0.1, z + 2.2], [p.x + 1.4, p.y + sy * 0.9, z + 1.75], [p.x - 1.4, p.y + sy * 0.9, z + 1.75], [0.4, 0.2, 0.14], MAT.MATTE); limb(O, [p.x - 1, p.y, z + 1.85], [p.x + 1, p.y, z + 1.85], 0.06, 0.06, [0.3, 0.22, 0.15], MAT.WOOD, 5); box(O, [p.x, p.y, z + 1.3], 0, 0.18, 0.18, 0.2, [0.4, 0.3, 0.2], MAT.WOOD); break; }
    case "lanternTower": { tube(O, p.x, p.y, 10, 1.5, z - 0.3, 1.2, z + 0.8, [0.5, 0.48, 0.44], MAT.ROCK, 0); setW(O, O.n - 90, -99); for (const a of [0, 1, 2, 3]) { const an = a * TAU / 4 + 0.4; limb(O, [p.x + Math.cos(an) * 0.9, p.y + Math.sin(an) * 0.9, z + 0.8], [p.x + Math.cos(an) * 0.35, p.y + Math.sin(an) * 0.35, z + 5.2], 0.13, 0.08, [0.3, 0.22, 0.15], MAT.WOOD, 5); } tube(O, p.x, p.y, 8, 0.7, z + 5.2, 0.7, z + 5.3, [0.2, 0.18, 0.18], MAT.METAL, 0); for (let a = 0; a < 6; a++) { const an = a * TAU / 6; limb(O, [p.x + Math.cos(an) * 0.6, p.y + Math.sin(an) * 0.6, z + 5.3], [p.x + Math.cos(an) * 0.5, p.y + Math.sin(an) * 0.5, z + 6.6], 0.03, 0.03, [0.2, 0.18, 0.18], MAT.METAL, 3); } tube(O, p.x, p.y, 8, 0.85, z + 6.6, 0, z + 7.6, [0.25, 0.22, 0.22], MAT.METAL, 0); p.flame = [p.x, p.y, z + 6.0]; break; }
    case "lamp": lampPost(O, p); break;
    case "stall": { const c = Math.cos(p.rot), s = Math.sin(p.rot), L = (a, b, zz) => [p.x + c * a - s * b, p.y + s * a + c * b, z + zz]; box(O, L(0, 0, 0.8), p.rot, 1.3, 0.6, 0.08, [0.45, 0.33, 0.22], MAT.WOOD); for (const a of [-1.2, 1.2]) for (const b of [-0.5, 0.5]) limb(O, L(a, b, 0), L(a, b, b > 0 ? 2.1 : 1.8), 0.05, 0.05, [0.35, 0.25, 0.16], MAT.WOOD, 4); const cols = [[0.85, 0.2, 0.2], [0.95, 0.9, 0.8]]; for (let k = 0; k < 6; k++) O.quad(L(-1.35 + k * 0.45, -0.75, 1.75), L(-0.9 + k * 0.45, -0.75, 1.75), L(-0.9 + k * 0.45, 0.65, 2.15), L(-1.35 + k * 0.45, 0.65, 2.15), cols[k % 2], MAT.SOFT); for (let k = 0; k < 7; k++) blob(O, L(-1 + k * 0.32, 0, 0.95), 0.12, 0.12, 0.1, [[0.9, 0.3, 0.15], [0.95, 0.75, 0.2], [0.5, 0.75, 0.25], [0.8, 0.55, 0.3]][k % 4], MAT.SOFT, 6, 4); break; }
    case "barrel": tube(O, p.x, p.y, 10, 0.42, z - 0.05, 0.42, z + 0.95, [0.45, 0.3, 0.18], MAT.WOOD, R() * 3); for (const zz of [0.15, 0.8]) tube(O, p.x, p.y, 10, 0.44, z + zz, 0.44, z + zz + 0.06, [0.25, 0.24, 0.24], MAT.METAL, 0, false); break;
    case "crate": box(O, [p.x, p.y, z + 0.45], p.rot || 0, 0.48, 0.48, 0.48, [0.55, 0.42, 0.26], MAT.WOOD); break;
    case "hay": blob(O, [p.x, p.y, z + 0.55], 0.9, 0.9, 0.62, [0.85, 0.7, 0.35], MAT.MATTE, 10, 6); break;
    case "gate": { for (const sx of [-1, 1]) { box(O, [p.x + sx * 3.1, p.y, z + 1.7], 0, 0.28, 0.28, 1.9, [0.38, 0.28, 0.18], MAT.WOOD); } box(O, [p.x, p.y, z + 3.7], 0, 3.6, 0.3, 0.2, [0.32, 0.23, 0.15], MAT.WOOD); box(O, [p.x, p.y - 0.35, z + 3.2], 0, 1.4, 0.04, 0.32, [0.5, 0.38, 0.24], MAT.WOOD); for (const sx of [-1, 1]) { const q = [p.x + sx * 3.1, p.y - 0.4, z + 2.9]; blob(O, q, 0.14, 0.14, 0.18, [1.8, 0.85, 0.35], MAT.EMIT, 6, 4); A.sprite(...q, 0.8, 0.14, 0.07, 0.02); LIGHTS.push(q); } break; }
    case "fence": fence(O, p.a, p.b, R, H); break;
    case "bridge": case "plank": case "dock": deck(O, p, R); break;
    case "signpost": limb(O, [p.x, p.y, z - 0.2], [p.x, p.y, z + 2], 0.06, 0.05, [0.35, 0.25, 0.16], MAT.WOOD, 5); for (const [a, zz] of [[0.5, 1.7], [-1.2, 1.4], [2.4, 1.1]]) box(O, [p.x + Math.cos(a) * 0.45, p.y + Math.sin(a) * 0.45, z + zz], a, 0.5, 0.03, 0.1, [0.5, 0.38, 0.24], MAT.WOOD); break;
    case "flowers": for (let k = 0; k < 40; k++) { const x = p.x + (R() - 0.5) * 3, y = p.y + (R() - 0.5) * 2, zz = H(x, y), h = 0.2 + R() * 0.25; limb(O, [x, y, zz], [x, y, zz + h], 0.008, 0.006, [0.2, 0.35, 0.1], MAT.FOLIAGE, 3); blob(O, [x, y, zz + h], 0.05, 0.05, 0.03, [[0.95, 0.3, 0.4], [0.98, 0.85, 0.3], [0.6, 0.45, 0.95], [0.98, 0.98, 0.95]][k % 4], MAT.SOFT, 5, 3); } break;
    case "pedestal": tube(O, p.x, p.y, 8, 0.8, z - 0.2, 0.55, z + 1.0, [0.55, 0.53, 0.5], MAT.ROCK, 0.3); setW(O, O.n - 72, -99); tube(O, p.x, p.y, 8, 0.7, z + 1.0, 0.7, z + 1.15, [0.6, 0.58, 0.55], MAT.ROCK, 0.3); p.top = z + 1.15; break;
    case "pillar": { const hh = p.broken ? 1.6 + R() * 1.5 : 4.2, col = p.dark ? [0.26, 0.22, 0.26] : [0.62, 0.6, 0.55]; tube(O, p.x, p.y, 8, 0.85, z - 0.3, 0.85, z + 0.3, col, MAT.ROCK, 0); tube(O, p.x, p.y, 10, 0.55, z + 0.3, 0.5, z + hh, col, MAT.ROCK, R()); if (!p.broken) tube(O, p.x, p.y, 8, 0.8, z + hh, 0.8, z + hh + 0.3, col, MAT.ROCK, 0); else rock(O, [p.x + 1.3, p.y + 0.4, z + 0.2], 0.5, 0.45, 0.4, col, -99, R, 7, 5); break; }
    case "shrine": { for (let k = 0; k < 3; k++) tube(O, p.x, p.y, 16, 3.4 - k * 0.8, z - 0.3 + k * 0.3, 3.4 - k * 0.8, z + k * 0.3, [0.58, 0.56, 0.52], MAT.ROCK, 0); box(O, [p.x, p.y, z + 1.3], 0, 0.9, 0.6, 0.5, [0.62, 0.6, 0.56], MAT.ROCK); p.top = z + 1.8; for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + Math.PI / 2; p["socket" + k] = [p.x + Math.cos(a) * 0.55, p.y + Math.sin(a) * 0.35, z + 1.85]; } break; }
    case "log": { const c = Math.cos(p.rot), s = Math.sin(p.rot); limb(O, [p.x - c * p.hx, p.y - s * p.hx, z + 0.35], [p.x + c * p.hx, p.y + s * p.hx, H(p.x + c * p.hx, p.y + s * p.hx) + 0.3], 0.45, 0.38, [0.3, 0.22, 0.15], MAT.BARK, 8); for (let k = 0; k < 6; k++) blob(O, [p.x + c * (R() - 0.5) * p.hx * 2, p.y + s * (R() - 0.5) * p.hx * 2, z + 0.75], 0.06, 0.06, 0.04, [1.2, 0.5, 0.9], MAT.EMIT, 5, 3); break; }
    case "campfire": for (let k = 0; k < 8; k++) { const a = k * TAU / 8; rock(O, [p.x + Math.cos(a) * 0.7, p.y + Math.sin(a) * 0.7, z], 0.22, 0.2, 0.16, [0.45, 0.43, 0.4], -99, R, 6, 4); } for (let k = 0; k < 3; k++) { const a = k * 1.05; limb(O, [p.x + Math.cos(a) * 0.5, p.y + Math.sin(a) * 0.5, z + 0.05], [p.x - Math.cos(a) * 0.5, p.y - Math.sin(a) * 0.5, z + 0.15], 0.07, 0.07, [0.25, 0.17, 0.1], MAT.BARK, 5); } p.flame = [p.x, p.y, z + 0.3]; break;
    case "brazier": { const col = p.dark ? [0.15, 0.12, 0.16] : [0.3, 0.28, 0.27]; tube(O, p.x, p.y, 8, 0.35, z - 0.1, 0.22, z + 0.9, col, MAT.METAL, 0); tube(O, p.x, p.y, 10, 0.25, z + 0.9, 0.62, z + 1.25, col, MAT.METAL, 0, false); O.quad([p.x - 0.5, p.y - 0.5, z + 1.15], [p.x + 0.5, p.y - 0.5, z + 1.15], [p.x + 0.5, p.y + 0.5, z + 1.15], [p.x - 0.5, p.y + 0.5, z + 1.15], [0.05, 0.04, 0.04], MAT.MATTE); p.flame = [p.x, p.y, z + 1.35]; break; }
    case "mill": { cottage(O, A, { ...p, hx: 5, hy: 4, v: 3 }, LIGHTS); const ax = [p.x, p.y + 4.6, p.z + 1.8]; limb(O, [ax[0] - 0.6, ax[1], ax[2]], [ax[0] + 0.6, ax[1], ax[2]], 0.15, 0.15, [0.2, 0.2, 0.22], MAT.METAL, 8); for (let k = 0; k < 14; k++) { const a = k * TAU / 14; const q = [0, Math.cos(a) * 2.6, Math.sin(a) * 2.6]; box(O, [ax[0], ax[1] + q[1], ax[2] + q[2]], 0, 0.5, 0.06, 0.38, [0.35, 0.26, 0.17], MAT.WOOD); limb(O, ax, [ax[0], ax[1] + q[1], ax[2] + q[2]], 0.05, 0.05, [0.3, 0.22, 0.15], MAT.WOOD, 4); } break; }
    case "table": box(O, [p.x, p.y, z + 0.75], 0.3, 0.8, 0.5, 0.05, [0.4, 0.28, 0.17], MAT.WOOD); for (const [a, b] of [[-0.7, -0.4], [0.7, -0.4], [0.7, 0.4], [-0.7, 0.4]]) { const [dx, dy] = rot2(a, b, 0.3); limb(O, [p.x + dx, p.y + dy, z], [p.x + dx, p.y + dy, z + 0.72], 0.04, 0.04, [0.35, 0.24, 0.15], MAT.WOOD, 4); } p.top = z + 0.82; break;
    case "spire": { const col = [0.13, 0.11, 0.15]; tube(O, p.x, p.y, 12, 6.5, z - 1, 5.5, z + 4, col, MAT.ROCK, 0); setW(O, O.n - 108, -99); tube(O, p.x, p.y, 12, 5.2, z + 4, 3.2, z + 26, col, MAT.ROCK, 0.13); tube(O, p.x, p.y, 12, 3.6, z + 26, 0.4, z + 36, [0.1, 0.08, 0.12], MAT.ROCK, 0.13); for (let k = 0; k < 9; k++) { const a = k * TAU / 9, zz = z + 6 + k * 2.3, rr = lerp(5.2, 3.2, (zz - z - 4) / 22) + 0.05; const q = [p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, zz]; box(O, q, a, 0.04, 0.45, 0.8, [1.0, 0.25, 1.4], MAT.EMIT); A.sprite(q[0] + Math.cos(a), q[1] + Math.sin(a), zz, 2.2, 0.12, 0.03, 0.18); } for (let k = 0; k < 8; k++) { const a = k * TAU / 8; limb(O, [p.x + Math.cos(a) * 3.5, p.y + Math.sin(a) * 3.5, z + 26], [p.x + Math.cos(a) * 6, p.y + Math.sin(a) * 6, z + 31], 0.4, 0.02, [0.1, 0.08, 0.12], MAT.ROCK, 4); } p.top = [p.x, p.y, z + 37]; break; }
    case "banner": { limb(O, [p.x, p.y, z - 0.2], [p.x, p.y, z + 4], 0.06, 0.05, [0.12, 0.1, 0.12], MAT.METAL, 5); const c = Math.cos(p.rot), s = Math.sin(p.rot); O.quad([p.x, p.y, z + 3.9], [p.x + c * 1.1, p.y + s * 1.1, z + 3.9], [p.x + c * 1.0, p.y + s * 1.0, z + 1.6], [p.x, p.y, z + 1.8], [0.45, 0.06, 0.12], MAT.SOFT); break; }
    case "farTower": { const zz = 6, col = [0.06, 0.05, 0.08]; tube(O, p.x, p.y, 10, 10, zz, 6, zz + 50, col, MAT.ROCK, 0); tube(O, p.x, p.y, 10, 7, zz + 50, 0.5, zz + 75, col, MAT.ROCK, 0); for (let k = 0; k < 5; k++) A.sprite(p.x - 7, p.y - 6 + k, zz + 20 + k * 8, 3, 0.3, 0.08, 0.45); break; }
    default: break;
  }
}
// grass tufts across grassy ground
function grass(G, S, x0, y0, R) {
  const dens = 2.2 * S.grass, n = Math.floor(TILE * TILE * dens);
  const TIPS = S.env === "night" ? [[0.16, 0.3, 0.2], [0.2, 0.32, 0.18]] : S.env === "eclipse" ? [[0.3, 0.26, 0.2], [0.35, 0.3, 0.22]] : [[0.3, 0.5, 0.1], [0.22, 0.42, 0.2], [0.48, 0.56, 0.14], [0.62, 0.58, 0.3]];
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * TILE, y = y0 + R() * TILE, z = S.h(x, y);
    if (z < S.waterZ + 0.12 || S.dirt(x, y) > 0.35) continue;
    if (Math.abs(S.h(x + 0.6, y) - z) > 0.5) continue;
    const nb = 3 + Math.floor(R() * 2), tip = TIPS[Math.floor(vnoise(x * 0.2, y * 0.2, 9) * TIPS.length * 0.999)].map((v) => v * (0.85 + R() * 0.3));
    for (let b = 0; b < nb; b++) {
      const h = 0.18 + R() * 0.35, az = R() * TAU, lean = 0.2 + R() * 0.35, w = 0.025 + R() * 0.02, dx = Math.cos(az), dy = Math.sin(az), bx = x + (R() - 0.5) * 0.15, by = y + (R() - 0.5) * 0.15;
      G.tri3([bx - dy * w, by + dx * w, z - 0.03, 0], [bx + dy * w, by - dx * w, z - 0.03, 0], [bx + dx * lean * h, by + dy * lean * h, z + h, 1], [0.04, 0.07, 0.02], [0.04, 0.07, 0.02], tip, MAT.GRASS);
    }
  }
}
function terrainTile(O, W, S, x0, y0) {
  const n = TILE / 1, P = [];
  for (let j = 0; j <= n; j++) { const row = []; for (let i = 0; i <= n; i++) { const x = x0 + i, y = y0 + j, z = S.h(x, y), d = S.dirt(x, y), sand = smooth(S.waterZ + 0.9, S.waterZ + 0.1, z); row.push([[x, y, z, 0], [d, sand, vnoise(x * 0.15, y * 0.15, 3)]]); } P.push(row); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i]; O.quad4(a[0], b[0], c[0], d[0], a[1], b[1], c[1], d[1], MAT.GROUND); }
  // water plane where the ground dips under the water level (pos.w = depth)
  const wz = S.waterZ;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i, y = y0 + j;
    if (Math.min(S.h(x, y), S.h(x + 1, y), S.h(x, y + 1), S.h(x + 1, y + 1)) > wz + 0.02) continue;
    const D = (xx, yy) => [xx, yy, wz, Math.max(0, wz - S.h(xx, yy))];
    W.quad4(D(x, y), D(x + 1, y), D(x + 1, y + 1), D(x, y + 1), [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], MAT.WATER);
  }
}
// build one tile → packed arrays + ranges
const MS = { O: new Mesh(200000), G: new Mesh(60000), W: new Mesh(8000), A: new Mesh(2000) };
export function buildTile(S, ti, tj) {
  const x0 = -HALF + ti * TILE, y0 = -HALF + tj * TILE, R = mulberry32(ti * 131 + tj * 977 + S.ch * 17);
  const { O, G, W, A } = MS; O.reset(); G.reset(); W.reset(); A.reset();
  const LIGHTS = [];
  terrainTile(O, W, S, x0, y0);
  if (S.grass > 0) grass(G, S, x0, y0, R);
  for (const p of S.props) {
    const px = p.x ?? (p.a[0] + p.b[0]) / 2, py = p.y ?? (p.a[1] + p.b[1]) / 2;
    if (px < x0 || px >= x0 + TILE || py < y0 || py >= y0 + TILE) continue;
    prop(O, A, p, S, R, LIGHTS);
  }
  const n = O.n + G.n + W.n + A.n, pos = new Float32Array(n * 4), col = new Float32Array(n * 4), rec = { ti, tj, n, pos, col, lights: LIGHTS };
  let o = 0;
  for (const [k, m] of [["O", O], ["G", G], ["W", W], ["A", A]]) { pos.set(m.pos.subarray(0, m.n * 4), o * 4); col.set(m.col.subarray(0, m.n * 4), o * 4); rec[k] = [o, m.n]; o += m.n; }
  return rec;
}
// far props outside the map (always drawn)
export function buildFar(S) {
  const O = new Mesh(20000), A = new Mesh(500), L = [];
  for (const p of S.props) if (p.t === "farTower") prop(O, A, p, S, mulberry32(5), L);
  return { O, A };
}

// ------------------------------------------------------------------ shadow (dapple) map
export const SRES = 0.5;
export function bakeShade(S) {
  const env = ENVS[S.env], SUN = env.sun, W = Math.round((2 * HALF) / SRES), Hh = W, A = new Float32Array(W * Hh).fill(1);
  const sx = SUN[0] / Math.max(0.12, SUN[2]), sy = SUN[1] / Math.max(0.12, SUN[2]), dl = Math.hypot(SUN[0], SUN[1]) || 1, ax = -SUN[0] / dl, ay = -SUN[1] / dl, stretch = 1 / Math.max(0.14, SUN[2]);
  const HOLE = new Float32Array(W * Hh);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) HOLE[j * W + i] = clamp((0.75 - vnoise((-HALF + i * SRES) * 0.9, (-HALF + j * SRES) * 0.9, 31)) * 3, 0, 1);
  const stamp = (cx, cy, a, b, op, holes) => {
    const Rr = Math.max(a, b), i0 = Math.max(0, Math.floor((cx - Rr + HALF) / SRES)), i1 = Math.min(W - 1, Math.ceil((cx + Rr + HALF) / SRES)), j0 = Math.max(0, Math.floor((cy - Rr + HALF) / SRES)), j1 = Math.min(Hh - 1, Math.ceil((cy + Rr + HALF) / SRES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -HALF + i * SRES - cx, py = -HALF + j * SRES - cy, u = (px * ax + py * ay) / a, v = (px * -ay + py * ax) / b, q = u * u + v * v;
      if (q >= 1) continue;
      let o = op * (1 - q * q * q); if (holes) o *= HOLE[j * W + i];
      A[j * W + i] *= 1 - o;
    }
  };
  for (const p of S.props) {
    if (p.t === "tree") { const T = treeShape(p); for (const c of T.crowns) { const h = c.c[2] - p.z + (c.cone ? c.h * 0.4 : 0); stamp(c.c[0] - sx * h, c.c[1] - sy * h, c.r * Math.min(stretch, 5), c.r * 0.95, 0.62, true); } const n = 6; for (let k = 0; k <= n; k++) { const h = (k / n) * 6 * p.s; stamp(p.x - sx * h, p.y - sy * h, 0.9, 0.3, 0.45, false); } }
    if (p.t === "cottage" || p.t === "mill") { for (let k = 0; k <= 8; k++) { const h = (k / 8) * 4.5; stamp(p.x - sx * h, p.y - sy * h, Math.max(p.hx, p.hy) * 0.9, Math.max(p.hx, p.hy) * 0.9, 0.5, false); } }
    if (p.t === "spire") for (let k = 0; k <= 20; k++) { const h = (k / 20) * 30; stamp(p.x - sx * h, p.y - sy * h, 5, 5, 0.4, false); }
  }
  const out = new Uint8Array(W * Hh);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) { let v = A[j * W + i] * (0.75 + 0.5 * fbm(i * 0.025, j * 0.025, 77, 3)) - 0.04; out[j * W + i] = Math.round(clamp((v - 0.25) * 1.5 + 0.25, 0, 1) * 255); }
  return { W, H: Hh, data: out };
}
