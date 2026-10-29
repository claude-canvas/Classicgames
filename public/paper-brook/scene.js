// Paper Brook static world (DESIGN.md §3), built in 16 m chunks along the brook so only nearby chunks are drawn.
// Each chunk writes four meshes: O opaque (terrain, stones, trees, houses), G grass (near only), W water, A additive.
// Tree data (TREES) is generated first because shade.js bakes their long evening shadows into the dapple map.
import { Mesh, MAT, limb, blob, mulberry32, fbm, vnoise, clamp, lerp, smooth, mixc } from "./mesh.js";
import { S_MIN, S_MAX, frame, toWorld, groundZ, wallAt, wallH, ROCKS, LILIES, CASCADES, CHECKPOINTS, BRIDGES, COTTAGES, MILL, FINISH, wzAt } from "./brook.js";

export const CHUNK = 16;
export const NCHUNK = Math.ceil((S_MAX - S_MIN) / CHUNK);
export const chunkOf = (s) => clamp(Math.floor((s - S_MIN) / CHUNK), 0, NCHUNK - 1);
const TAU = Math.PI * 2;

// mark vertices [from, m.n) with pos.w = w (number or fn(z))
function setW(m, from, w) { for (let i = from; i < m.n; i++) m.pos[i * 4 + 3] = typeof w === "function" ? w(m.pos[i * 4 + 2]) : w; }
// a box in an arbitrary frame: centre o, unit axes ex ey ez, half sizes
function box(m, o, ex, ey, ez, hx, hy, hz, col, mat, skipBottom = true) {
  const P = (a, b, c) => [o[0] + ex[0] * a * hx + ey[0] * b * hy + ez[0] * c * hz, o[1] + ex[1] * a * hx + ey[1] * b * hy + ez[1] * c * hz, o[2] + ex[2] * a * hx + ey[2] * b * hy + ez[2] * c * hz];
  m.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), col, mat);
  m.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), col, mat);
  m.quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), col, mat);
  m.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), col, mat);
  m.quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), col, mat);
  if (!skipBottom) m.quad(P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), col, mat);
}
// a dry-stone block: irregular front corners and a bulging front (toward −ey), plus top, bottom and ends
function pillow(m, o, ex, ey, ez, hx, hy, hz, col, R) {
  const P = (a, b, c) => [o[0] + ex[0] * a + ey[0] * b + ez[0] * c, o[1] + ex[1] * a + ey[1] * b + ez[1] * c, o[2] + ex[2] * a + ey[2] * b + ez[2] * c];
  const j = () => 1 - R() * 0.14;
  const f = [P(-hx * j(), -hy, -hz * j()), P(hx * j(), -hy, -hz * j()), P(hx * j(), -hy, hz * j()), P(-hx * j(), -hy, hz * j())];
  const c = P((R() - 0.5) * hx * 0.3, -hy - 0.008 - R() * 0.012, (R() - 0.5) * hz * 0.3);
  for (let i = 0; i < 4; i++) m.tri(f[i], f[(i + 1) % 4], c, col, MAT.ROCK);
  const b = [P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
  m.quad(f[3], f[2], b[2], b[3], col, MAT.ROCK); m.quad(f[0], b[0], b[1], f[1], col, MAT.ROCK);
  m.quad(f[0], f[3], b[3], b[0], col, MAT.ROCK); m.quad(f[1], b[1], b[2], f[2], col, MAT.ROCK);
}
// a natural rock: a sphere grid whose radius follows smooth noise of the direction (no seams), a flattened base,
// a few planar "fracture" cuts for crisp faces, and per-vertex colour variation
function stone(m, c, rx, ry, rz, col, wz, R, seg = 7, rings = 5, small = false) {
  if (!small) { seg = Math.max(seg, 9); rings = Math.max(rings, 6); }
  const from = m.n, o1 = R() * 50, o2 = R() * 50, cuts = [];
  for (let k = 0; k < 3; k++) { const a = R() * TAU, e = (R() - 0.3) * 1.2; cuts.push([Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e), 0.72 + R() * 0.18]); }
  const P = [], C = [];
  for (let j = 0; j <= rings; j++) {
    const row = [], crow = [];
    for (let i = 0; i < seg; i++) {
      const th = (j / rings) * Math.PI, ph = (i / seg) * TAU;
      const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      let k = 0.78 + 0.32 * vnoise(d[0] * 1.6 + d[2] + o1, d[1] * 1.6 - d[2] + o2, 3) + 0.1 * vnoise(d[0] * 4.5 + o2, d[1] * 4.5 + d[2] * 3, 5);
      for (const q of cuts) { const t = d[0] * q[0] + d[1] * q[1] + d[2] * q[2]; if (t * k > q[3]) k = q[3] / Math.max(0.2, t); }
      let z = d[2] * rz * k;
      if (z < 0) z *= 0.45;
      row.push([c[0] + d[0] * rx * k, c[1] + d[1] * ry * k, c[2] + z]);
      const v = 0.85 + 0.3 * vnoise(d[0] * 3 + o1, d[1] * 3 + d[2] * 2, 8);
      crow.push([col[0] * v, col[1] * v, col[2] * v]);
    }
    P.push(row); C.push(crow);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const i1 = (i + 1) % seg;
    m.quad4(P[j][i], P[j + 1][i], P[j + 1][i1], P[j][i1], C[j][i], C[j + 1][i], C[j + 1][i1], C[j][i1], MAT.ROCK);
  }
  setW(m, from, wz);
}

// ------------------------------------------------------------------ trees (data)
export const TREES = [];
{
  const R = mulberry32(7);
  const clearOf = (wx, wy) => COTTAGES.every((c) => { const p = toWorld(c.s, c.x); return Math.hypot(p[0] - wx, p[1] - wy) > 11; }) && (() => { const p = toWorld(MILL.s, MILL.side * 7); return Math.hypot(p[0] - wx, p[1] - wy) > 10; })();
  const add = (s, x, kind) => {
    const [wx, wy] = toWorld(s, x);
    if (!clearOf(wx, wy)) return;
    for (let i = Math.max(0, TREES.length - 80); i < TREES.length; i++) { const t = TREES[i]; if (Math.hypot(t.wx - wx, t.wy - wy) < (kind === "far" ? 4 : 2.6)) return; }
    const i = TREES.length, Q = mulberry32(1000 + i), gz = groundZ(s, x);
    const H = (kind === "far" ? 11 : 9) + Q() * 7, r0 = 0.12 + Q() * 0.12 + H * 0.009;
    const lx = (Q() - 0.5) * 0.14 * H, ly = (Q() - 0.5) * 0.14 * H;
    const pts = []; for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([wx + lx * t * t + (k ? (Q() - 0.5) * 0.2 : 0), wy + ly * t * t + (k ? (Q() - 0.5) * 0.2 : 0), gz - 0.3 + t * H]); }
    const at = (h) => { const f = h * 5, k = Math.min(4, Math.floor(f)), t = f - k; return pts[k].map((v, j) => v + (pts[k + 1][j] - v) * t); };
    const branches = [], blobs = [], nb = 3 + Math.floor(Q() * 3);
    for (let b = 0; b < nb; b++) {
      const h = 0.48 + Q() * 0.4, base = at(h), az = Q() * TAU, len = (1.3 + Q() * 2.6) * (1.2 - h * 0.6), up = 0.5 + Q() * 0.7;
      const end = [base[0] + Math.cos(az) * len, base[1] + Math.sin(az) * len, base[2] + up * len];
      branches.push([base, end, r0 * (0.45 - h * 0.2)]); blobs.push({ c: [end[0], end[1], end[2] + 0.3], r: 1.0 + Q() * 1.2 });
    }
    const top = pts[5]; blobs.push({ c: [top[0], top[1], top[2] + 0.5], r: 1.3 + Q() * 1.0 });
    TREES.push({ s, x, wx, wy, gz, H, r0, pts, branches, blobs, kind, seed: 1000 + i, tint: Q() });
  };
  for (let s = S_MIN; s < S_MAX; s += 1) for (const side of [-1, 1]) {
    const f = frame(s);
    if (wallAt(s, side) === 2) { if (R() < 0.05) add(s, side * (f.hw + 3.5 + R() * 5), "near"); }
    else if (R() < 0.075) add(s, side * (f.hw + 2.6 + R() * 6), "near");
    if (R() < 0.13) add(s, side * (f.hw + 9 + R() * 24), "mid");
    if (R() < 0.17) add(s, side * (f.hw + 34 + R() * 36), "far");
  }
}

// ------------------------------------------------------------------ export lists used by main (lights, smoke)
export const LANTERNS = [];     // [x, y, z] lantern glows (checkpoints + finish)
export const WINDOWS = [];      // [x, y, z] lit windows (for point lights)
export const CHIMNEYS = [];     // [x, y, z] smoke sources

// ------------------------------------------------------------------ builders
const D = [-0.42, -0.2, -0.05, 0, 0.1, 0.24, 0.42, 0.66, 0.95, 1.35, 1.85, 2.5, 3.4, 4.6, 6.2, 8.5, 11.5, 15.5, 21, 28, 37, 48, 62, 78];
function terrain(O, s0, s1) {
  const rows = [];
  for (let s = s0; s <= s1 + 1e-6; s += 0.5) rows.push(s);
  for (const side of [-1, 1]) {
    const grid = rows.map((s) => {
      const f = frame(s);
      return D.map((d) => {
        const x = side * (f.hw + d), w = toWorld(s, x), z = groundZ(s, x);
        const n = 0.88 + 0.24 * vnoise(s * 0.4, x * 0.4, 13);
        return [w[0], w[1], z, d, n];
      });
    });
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < D.length - 1; j++) {
      let a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      if (side < 0) [b, d] = [d, b];
      const C = (p) => [p[4], p[4], p[4]];
      O.quad4([a[0], a[1], a[2], a[3]], [b[0], b[1], b[2], b[3]], [c[0], c[1], c[2], c[3]], [d[0], d[1], d[2], d[3]], C(a), C(b), C(c), C(d), MAT.GROUND);
    }
  }
}
function water(W, s0, s1) {
  const rows = [];
  for (let s = s0; s <= s1 + 1e-6;) { rows.push(s); s += CASCADES.some((c) => Math.abs(c.s - s) < 2) ? 0.2 : 0.5; }
  const NX = 10;
  const grid = rows.map((s) => { const f = frame(s); const out = []; for (let j = 0; j <= NX; j++) { const q = -1.12 + (j / NX) * 2.24, x = q * f.hw - Math.sign(q) * 0.0, w = toWorld(s, x); out.push({ p: [w[0], w[1], f.p[2], x], c: [s, q, f.ang] }); } return out; });
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < NX; j++) {
    const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
    W.quad4(a.p, d.p, c.p, b.p, a.c, d.c, c.c, b.c, MAT.WATER);
  }
}
// stone palette: weathered granite, warm sandstone, blue slate, ochre, pale limestone
const STONES = [[0.56, 0.55, 0.52], [0.66, 0.58, 0.46], [0.46, 0.5, 0.54], [0.62, 0.5, 0.34], [0.72, 0.7, 0.64], [0.5, 0.45, 0.4]];
function walls(O, s0, s1, R) {
  for (const side of [-1, 1]) {
    // dry-stone wall: irregular courses of pillow-faced stones, flat capstones, plants in the joints
    for (let s = s0; s < s1; s += 1.5) {
      const H = wallH(s + 0.75, side);
      if (H < 0.06) continue;
      const f = frame(s + 0.75), wz = f.p[2], total = H + 0.2;
      // course heights vary; they always add up to the wall height
      const hs = []; let acc = 0;
      while (acc < total - 0.12) { const h = Math.min(total - acc, 0.13 + R() * 0.15); hs.push(h); acc += h; }
      hs[hs.length - 1] += total - acc;
      let z0 = wz - 0.2;
      hs.forEach((hk, k) => {
        let ss = s + (k % 2) * 0.13 * R();
        while (ss < s + 1.5 && ss < s1) {
          const L = Math.min(0.22 + R() * 0.42, s + 1.5 - ss + 0.05), sm = ss + L / 2, ff = frame(sm), inset = (R() - 0.35) * 0.035;
          const xin = side * (ff.hw - 0.07 + inset), xo = side * (ff.hw + 0.32), xc = (xin + xo) / 2, o = toWorld(sm, xc, 0); o[2] = z0 + hk / 2;
          const base = STONES[Math.floor(R() * STONES.length)], g = 0.78 + R() * 0.32;
          const col = base.map((v) => v * g * (0.95 + R() * 0.1));
          const from = O.n;
          pillow(O, o, ff.t, [ff.r[0] * side, ff.r[1] * side, 0], [0, 0, 1], L / 2 - 0.008, Math.abs(xo - xin) / 2, hk / 2 - 0.006 - R() * 0.007, col, R);
          setW(O, from, wz);
          ss += L;
        }
        z0 += hk;
      });
      // capstones: flat slabs that overhang the water a little
      for (let ss = s; ss < s + 1.5 && ss < s1;) {
        const L = 0.3 + R() * 0.35, sm = ss + L / 2, ff = frame(sm), xin = side * (ff.hw - 0.11), xo = side * (ff.hw + 0.4), o = toWorld(sm, (xin + xo) / 2, 0);
        o[2] = wz + H + 0.035;
        const col = STONES[Math.floor(R() * 3)].map((v) => v * (0.85 + R() * 0.25)), from = O.n;
        pillow(O, o, ff.t, [ff.r[0] * side, ff.r[1] * side, 0], [0, 0, 1], L / 2 - 0.01, Math.abs(xo - xin) / 2, 0.035 + R() * 0.01, col, R);
        setW(O, from, wz);
        ss += L;
      }
      // trailing ivy and small ferns in the joints
      if (R() < 0.55) {
        const sp = s + R() * 1.5, ff = frame(sp), top = wz + H + 0.06, len = 0.25 + R() * Math.min(0.9, H * 0.7), from = O.n;
        const leaf = mixc([0.13, 0.3, 0.07], [0.3, 0.45, 0.1], R());
        for (let k = 0; k < 3 + Math.floor(R() * 4); k++) {
          const ds = (R() - 0.5) * 0.5;
          for (let z = 0; z < len * (0.5 + R() * 0.5); z += 0.05) {
            const x = side * (ff.hw - 0.12 - R() * 0.03), w = toWorld(sp + ds + Math.sin(z * 9 + k) * 0.03, x), zz = top - z, r = 0.035 + R() * 0.02, a = R() * TAU;
            O.tri([w[0], w[1], zz], [w[0] + Math.cos(a) * r, w[1] + Math.sin(a) * r, zz - r * 0.8], [w[0] + Math.cos(a + 1.2) * r, w[1] + Math.sin(a + 1.2) * r, zz - r * 0.5], leaf.map((v) => v * (0.75 + R() * 0.5)), MAT.FOLIAGE);
          }
        }
        setW(O, from, 0.01);
      }
      if (R() < 0.3) {
        const sp = s + R() * 1.5, ff = frame(sp), zc = wz + 0.15 + R() * (H - 0.2), x = side * (ff.hw - 0.08), w = toWorld(sp, x), from = O.n, col = mixc([0.22, 0.42, 0.08], [0.38, 0.52, 0.12], R());
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI - Math.PI / 2, dx = -ff.r[0] * side, dy = -ff.r[1] * side, tx = ff.t[0], ty = ff.t[1], L = 0.18 + R() * 0.12;
          const dirx = dx * Math.cos(a) * 0.6 + tx * Math.sin(a), diry = dy * Math.cos(a) * 0.6 + ty * Math.sin(a);
          O.tri([w[0], w[1], zc], [w[0] + dirx * L - ty * 0.03, w[1] + diry * L + tx * 0.03, zc + 0.05 - L * 0.3], [w[0] + dirx * L + ty * 0.03, w[1] + diry * L - tx * 0.03, zc + 0.03 - L * 0.4], col, MAT.FOLIAGE);
        }
        setW(O, from, 0.015);
      }
    }
  }
}
function bankStones(O, s0, s1, R) {
  for (let s = s0; s < s1; s += 1.2 + R() * 3.5) for (const side of [-1, 1]) {
    const f = frame(s), sec = f.sec, wl = wallAt(s, side);
    if (wl === 2) continue;
    const want = (sec === 0 && side < 0) ? 0.75 : sec === 2 ? 0.6 : sec === 3 ? 0.3 : 0.2;
    if (R() > want) continue;
    const d = -0.15 + R() * 0.9, x = side * (f.hw + d), w = toWorld(s, x), r = (sec === 0 && side < 0 ? 0.28 : 0.2) + R() * 0.3, gz = Math.min(groundZ(s, x), f.p[2] + 0.3);
    const col = STONES[Math.floor(R() * STONES.length)].map((v) => v * (0.85 + R() * 0.2));
    stone(O, [w[0], w[1], gz + r * 0.15], r, r * (0.8 + R() * 0.3), r * (0.55 + R() * 0.2), col, f.p[2], R, 9, 6);
    // a few pebbles around it
    for (let k = 0; k < 3; k++) { const ps = s + (R() - 0.5) * 1.2, pd = d + (R() - 0.5) * 0.6, px = side * (frame(ps).hw + pd), pw = toWorld(ps, px), pr = 0.04 + R() * 0.06; stone(O, [pw[0], pw[1], Math.min(groundZ(ps, px), wzAt(ps) + 0.1)], pr, pr * 0.8, pr * 0.5, mixc([0.5, 0.46, 0.4], [0.7, 0.64, 0.55], R()), wzAt(ps), R, 5, 3, true); }
  }
}
function rocks(O, A, s0, s1, R) {
  for (const r of ROCKS) {
    if (r.s < s0 || r.s >= s1) continue;
    const w = toWorld(r.s, r.x), rz = r.h + 0.12;
    const col = STONES[Math.floor(R() * STONES.length)].map((v) => v * (0.75 + R() * 0.2));
    stone(O, [w[0], w[1], r.z + r.h - rz], r.r * 1.05, r.r * (0.85 + R() * 0.25), rz, col, r.z, R, 14, 9);
    // foam: a ring around the stone with a tail downstream (uv in units of the stone radius)
    const f = frame(r.s), up = 1.9, down = 6.5, side = 2.3;
    const P = (ds, dx) => { const q = toWorld(r.s + ds * r.r, r.x + dx * r.r); return [q[0], q[1], r.z + 0.006]; };
    const k = clamp(0.4 + f.c * 0.25, 0.4, 1.4);
    const C = (u, v) => [u, v, k];
    A.quad4([...P(-up, -side), 0], [...P(-up, side), 0], [...P(down, side), 0], [...P(down, -side), 0], C(-side, -up), C(side, -up), C(side, down), C(-side, down), MAT.FOAM);
  }
  // cascades: white water bands below each drop
  for (const c of CASCADES) {
    if (c.s < s0 || c.s >= s1) continue;
    for (let i = 0; i < 6; i++) {
      const a = c.s - 0.3 + i * 0.9, b = a + 0.9, fa = frame(a), fb = frame(b);
      const P = (s, f, q) => { const w = toWorld(s, q * f.hw * 1.05); return [w[0], w[1], f.p[2] + 0.012, 1]; };
      const C = (q, v) => [q * 1.2, v, 1.3];
      A.quad4(P(a, fa, -1), P(a, fa, 1), P(b, fb, 1), P(b, fb, -1), C(-1, i * 0.9), C(1, i * 0.9), C(1, i * 0.9 + 0.9), C(-1, i * 0.9 + 0.9), MAT.FOAM);
    }
  }
}
function grass(G, O, s0, s1, R) {
  const blade = (bx, by, bz, h, lean, az, wdt, col0, col1, two) => {
    const dx = Math.cos(az), dy = Math.sin(az), px = -dy * wdt, py = dx * wdt;
    const tip = [bx + dx * lean * h, by + dy * lean * h, bz + h * (1 - lean * 0.3), 1];
    if (two) {
      const mid = [bx + dx * lean * h * 0.3, by + dy * lean * h * 0.3, bz + h * 0.55, 0.35], midc = mixc(col0, col1, 0.55);
      G.tri3([bx - px, by - py, bz, 0], [bx + px, by + py, bz, 0], [mid[0] + px * 0.7, mid[1] + py * 0.7, mid[2], 0.35], col0, col0, midc, MAT.GRASS);
      G.tri3([bx - px, by - py, bz, 0], [mid[0] + px * 0.7, mid[1] + py * 0.7, mid[2], 0.35], [mid[0] - px * 0.7, mid[1] - py * 0.7, mid[2], 0.35], col0, midc, midc, MAT.GRASS);
      G.tri3([mid[0] - px * 0.7, mid[1] - py * 0.7, mid[2], 0.35], [mid[0] + px * 0.7, mid[1] + py * 0.7, mid[2], 0.35], tip, midc, midc, col1, MAT.GRASS);
    } else G.tri3([bx - px, by - py, bz, 0], [bx + px, by + py, bz, 0], tip, col0, col0, col1, MAT.GRASS);
  };
  // tip colour: patches of fresh green, blue-green, yellow-green and dry straw, so the banks are not one flat green
  const TIPS = [[0.3, 0.5, 0.1], [0.22, 0.42, 0.2], [0.48, 0.56, 0.14], [0.66, 0.6, 0.34], [0.36, 0.46, 0.08]];
  const tip = (x, y) => { const n = vnoise(x * 0.35, y * 0.35, 41), m = vnoise(x * 1.7, y * 1.7, 43); const a = TIPS[Math.floor(n * 4.99)], b = TIPS[Math.floor(m * 4.99)]; return mixc(a, b, 0.35 + R() * 0.3).map((v) => v * (0.85 + R() * 0.3)); };
  for (const side of [-1, 1]) {
    const area = (s1 - s0);
    // the corner: a thick fringe right at the water's edge (or along the wall top, leaning out over the water)
    const nEdge = Math.floor(area * 0.9 * 34);
    for (let i = 0; i < nEdge; i++) {
      const s = s0 + R() * area, f = frame(s), walled = wallAt(s, side) === 2;
      const d = (walled ? 0.28 : 0.0) + Math.pow(R(), 1.6) * 0.9, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x);
      const toWater = Math.atan2(-f.r[1] * side, -f.r[0] * side), nb = 4 + Math.floor(R() * 3);
      for (let b = 0; b < nb; b++) {
        const h = (0.1 + R() * 0.26) * (0.75 + 0.5 * vnoise(s * 0.3, side * 9 + d, 21)), az = R() < 0.6 ? toWater + (R() - 0.5) * 1.6 : R() * TAU;
        blade(w[0] + (R() - 0.5) * 0.07, w[1] + (R() - 0.5) * 0.07, gz - 0.02, h, (walled ? 0.35 : 0.2) + R() * 0.4, az, 0.011 + R() * 0.009, [0.035, 0.07, 0.02], tip(w[0], w[1]), h > 0.24);
      }
    }
    // lush band up the bank
    const nNear = Math.floor(area * 2.2 * 7);
    for (let i = 0; i < nNear; i++) {
      const s = s0 + R() * area, f = frame(s), walled = wallAt(s, side) === 2;
      const d = (walled ? 0.5 : 0.6) + R() * 2.2, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x), nb = 3 + Math.floor(R() * 2);
      for (let b = 0; b < nb; b++) {
        const h = (0.12 + R() * 0.28) * (0.6 + 0.8 * vnoise(s * 0.2, side * 3 + d * 0.3, 21));
        blade(w[0] + (R() - 0.5) * 0.08, w[1] + (R() - 0.5) * 0.08, gz - 0.02, h, 0.15 + R() * 0.35, R() * TAU, 0.012 + R() * 0.009, [0.04, 0.08, 0.02], tip(w[0], w[1]), h > 0.3);
      }
    }
    // sparser grass further up the banks
    const nMid = Math.floor(area * 7 * 1.5);
    for (let i = 0; i < nMid; i++) {
      const s = s0 + R() * area, f = frame(s), d = 2.8 + R() * 7, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x);
      for (let b = 0; b < 3; b++) blade(w[0] + (R() - 0.5) * 0.1, w[1] + (R() - 0.5) * 0.1, gz - 0.02, 0.15 + R() * 0.3, 0.2 + R() * 0.3, R() * TAU, 0.018, [0.05, 0.09, 0.02], tip(w[0], w[1]), false);
    }
    // wild flowers: daisies, buttercups, forget-me-nots, campion, clover, poppies
    const FLOWERS = [[0.97, 0.96, 0.92], [1.0, 0.82, 0.12], [0.42, 0.58, 1.0], [0.95, 0.45, 0.7], [0.72, 0.5, 0.95], [0.95, 0.25, 0.12], [1.0, 0.95, 0.6]];
    for (let i = 0; i < area * 3.5; i++) {
      const s = s0 + R() * area, f = frame(s), walled = wallAt(s, side) === 2, d = (walled ? 0.35 : 0.15) + R() * 4, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x), h = 0.12 + R() * 0.22;
      blade(w[0], w[1], gz, h, 0.05, R() * TAU, 0.005, [0.06, 0.1, 0.03], [0.2, 0.32, 0.08], false);
      const col = FLOWERS[Math.floor(Math.pow(R(), 1.3) * FLOWERS.length)], c = [w[0], w[1], gz + h], r = 0.016 + R() * 0.014, np = 5 + Math.floor(R() * 3);
      for (let k = 0; k < np; k++) { const a = (k / np) * TAU; O.tri(c, [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 0.006], [c[0] + Math.cos(a + 0.7) * r, c[1] + Math.sin(a + 0.7) * r, c[2] + 0.006], col, MAT.PAPER); }
      O.tri([c[0] - 0.004, c[1], c[2] + 0.008], [c[0] + 0.004, c[1], c[2] + 0.008], [c[0], c[1] + 0.005, c[2] + 0.009], [1, 0.75, 0.1], MAT.MATTE);
    }
  }
}
function bushes(O, s0, s1, R) {
  for (let s = s0; s < s1; s += 1.5 + R() * 3) for (const side of [-1, 1]) {
    const f = frame(s);
    const want = side > 0 ? 0.45 : 0.25;
    if (R() > want) continue;
    const d = (wallAt(s, side) === 2 ? 0.8 : 0.5) + R() * 4.5, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x);
    const n = 5 + Math.floor(R() * 4), base = mixc([0.12, 0.2, 0.05], [0.2, 0.28, 0.07], R());
    for (let k = 0; k < n; k++) {
      const r = 0.22 + R() * 0.38, c = [w[0] + (R() - 0.5) * 1.0, w[1] + (R() - 0.5) * 1.0, gz + r * 0.6 + R() * 0.35], from = O.n;
      blob(O, c, r, r * (0.8 + R() * 0.4), r * 0.85, base, MAT.FOLIAGE, 7, 5, (i, j) => 0.85 + 0.3 * vnoise(i * 1.3 + k, j * 1.7, 5), (i, j) => mixc(base, [base[0] * 1.6, base[1] * 1.5, base[2]], j / 5));
      setW(O, from, (z) => clamp((z - gz) * 0.04, 0, 0.05));
    }
  }
  // ferns in the rapids and along the channel
  for (let s = s0; s < s1; s += 0.8 + R() * 2) for (const side of [-1, 1]) {
    const f = frame(s);
    if (f.sec !== 2 && !(f.sec === 1 && R() < 0.3)) continue;
    if (R() < 0.4) continue;
    const d = (wallAt(s, side) === 2 ? 0.45 : 0.15) + R() * 2.2, x = side * (f.hw + d), w = toWorld(s, x), gz = groundZ(s, x);
    const nf = 6 + Math.floor(R() * 4), col = mixc([0.2, 0.36, 0.06], [0.32, 0.46, 0.1], R());
    for (let k = 0; k < nf; k++) {
      const az = (k / nf) * TAU + R() * 0.4, L = 0.35 + R() * 0.35, from = O.n;
      let px = w[0], py = w[1], pz = gz;
      const dx = Math.cos(az), dy = Math.sin(az);
      for (let i = 0; i < 6; i++) {
        const t = (i + 1) / 6, nx = w[0] + dx * L * t, ny = w[1] + dy * L * t, nz = gz + Math.sin(t * 2.4) * L * 0.55, wd = 0.07 * (1 - t * 0.8);
        O.tri([px, py, pz], [nx - dy * wd, ny + dx * wd, nz], [nx, ny, nz + 0.01], col, MAT.FOLIAGE);
        O.tri([px, py, pz], [nx, ny, nz + 0.01], [nx + dy * wd, ny - dx * wd, nz], mixc(col, [0.1, 0.15, 0.03], 0.3), MAT.FOLIAGE);
        px = nx; py = ny; pz = nz;
      }
      setW(O, from, (z) => clamp((z - gz) * 0.12, 0, 0.04));
    }
  }
  // reeds around the pool
  for (let s = Math.max(s0, 388); s < Math.min(s1, 466); s += 0.25 + R() * 0.5) for (const side of [-1, 1]) {
    if (R() < 0.45) continue;
    const f = frame(s), x = side * (f.hw - 0.1 + R() * 0.5), w = toWorld(s, x), gz = Math.max(groundZ(s, x), f.p[2] - 0.05), h = 0.6 + R() * 0.7;
    const from = O.n;
    limb(O, [w[0], w[1], gz], [w[0] + (R() - 0.5) * 0.1, w[1] + (R() - 0.5) * 0.1, gz + h], 0.008, 0.004, [0.3, 0.4, 0.12], MAT.FOLIAGE, 3);
    if (R() < 0.4) limb(O, [w[0], w[1], gz + h * 0.8], [w[0], w[1], gz + h * 0.95], 0.02, 0.018, [0.3, 0.18, 0.08], MAT.MATTE, 5);
    setW(O, from, (z) => clamp((z - gz) * 0.05, 0, 0.06));
  }
}
function tree(O, T, lod) {
  const near = lod > 0;
  const R = mulberry32(T.seed), kind = (T.seed * 2654435761 >>> 0) % 100, birch = kind < 22, autumn = kind >= 22 && kind < 32, segs = near ? 6 : 4;
  const bark = birch ? [0.8, 0.78, 0.72] : mixc([0.24, 0.19, 0.15], [0.33, 0.27, 0.21], T.tint);
  for (let k = 0; k < 5; k++) limb(O, T.pts[k], T.pts[k + 1], T.r0 * (1 - k * 0.17) * (k === 0 ? 1.5 : 1), T.r0 * (1 - (k + 1) * 0.17), bark, MAT.BARK, segs);
  for (const [a, b, r] of T.branches) limb(O, a, b, Math.max(0.03, r), 0.02, bark, MAT.BARK, near ? 4 : 3);
  const leaf = autumn ? mixc([0.7, 0.3, 0.07], [0.82, 0.58, 0.12], T.tint) : birch ? mixc([0.3, 0.42, 0.1], [0.42, 0.5, 0.14], T.tint) : [[0.16, 0.26, 0.06], [0.12, 0.24, 0.12], [0.28, 0.36, 0.09], [0.2, 0.3, 0.05]][Math.floor(T.tint * 3.99)];
  for (const bl of T.blobs) {
    const n = lod === 2 ? 3 : lod === 1 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const r = bl.r * (k ? 0.55 + R() * 0.3 : 0.85), c = k ? [bl.c[0] + (R() - 0.5) * bl.r * 1.2, bl.c[1] + (R() - 0.5) * bl.r * 1.2, bl.c[2] + (R() - 0.5) * bl.r * 0.7] : bl.c, from = O.n;
      blob(O, c, r, r * (0.85 + R() * 0.3), r * 0.7, leaf, MAT.FOLIAGE, near ? 7 : 6, near ? 5 : 4, (i, j) => 0.8 + 0.35 * vnoise(i * 1.1 + k * 3, j * 1.4 + T.seed, 3), (i, j) => mixc([leaf[0] * 1.5, leaf[1] * 1.45, leaf[2] * 1.2], [leaf[0] * 0.55, leaf[1] * 0.6, leaf[2] * 0.6], j / 6));
      setW(O, from, 0.08 + 0.02 * k);
    }
  }
}
function cottage(O, A, s, x, rot, R, big = false) {
  const w = toWorld(s, x), f = frame(s), base = f.ang - Math.PI / 2 + rot;
  const ex = [Math.cos(base), Math.sin(base), 0], ey = [-Math.sin(base), Math.cos(base), 0], ez = [0, 0, 1];
  const hx = big ? 3.6 : 3, hy = big ? 2.6 : 2.2, wallH = big ? 3.2 : 2.6;
  let gz = 1e9; for (const a of [-1, 1]) for (const b of [-1, 1]) { const q = [w[0] + ex[0] * a * hx + ey[0] * b * hy, w[1] + ex[1] * a * hx + ey[1] * b * hy]; gz = Math.min(gz, groundZ(s + (a * ex[0] + b * ey[0]) * 0, x)); }
  gz = Math.min(gz, groundZ(s, x)) - 0.1;
  const L = (a, b, c) => [w[0] + ex[0] * a + ey[0] * b, w[1] + ex[1] * a + ey[1] * b, gz + c];
  const plaster = [0.8, 0.72, 0.6], timber = [0.2, 0.13, 0.08], roofC = [0.34, 0.17, 0.11];
  box(O, L(0, 0, -0.6), ex, ey, ez, hx + 0.1, hy + 0.1, 0.9, [0.45, 0.42, 0.37], MAT.ROCK); setW(O, O.n - 30, -99);
  box(O, L(0, 0, wallH / 2 + 0.3), ex, ey, ez, hx, hy, wallH / 2, plaster, MAT.MATTE);
  // timber frame
  for (const a of [-1, -0.33, 0.33, 1]) for (const b of [-1, 1]) box(O, L(a * hx, b * (hy + 0.02), wallH / 2 + 0.3), ex, ey, ez, 0.08, 0.03, wallH / 2, timber, MAT.WOOD);
  for (const b of [-1, 1]) box(O, L(0, b * (hy + 0.02), wallH + 0.25), ex, ey, ez, hx, 0.03, 0.07, timber, MAT.WOOD);
  // gable roof along ex
  const rh = big ? 2.4 : 2, ov = 0.45, top = wallH + 0.3;
  for (const b of [-1, 1]) {
    const e0 = L(-hx - ov, b * (hy + ov), top - 0.25), e1 = L(hx + ov, b * (hy + ov), top - 0.25), r0 = L(-hx - ov, 0, top + rh), r1 = L(hx + ov, 0, top + rh);
    O.quad(e0, e1, r1, r0, roofC, MAT.MATTE);
    const d = [0, 0, -0.12]; O.quad(e0.map((v, i) => v + d[i]), r0.map((v, i) => v + d[i]), r1.map((v, i) => v + d[i]), e1.map((v, i) => v + d[i]), [0.12, 0.08, 0.06], MAT.MATTE);
  }
  for (const a of [-1, 1]) O.tri(L(a * hx, -hy, top), L(a * hx, hy, top), L(a * hx, 0, top + rh - 0.1), plaster, MAT.MATTE);
  // chimney
  box(O, L(hx * 0.55, hy * 0.3, top + rh * 0.8), ex, ey, ez, 0.3, 0.3, rh * 0.6, [0.42, 0.38, 0.34], MAT.ROCK); setW(O, O.n - 30, -99);
  CHIMNEYS.push(L(hx * 0.55, hy * 0.3, top + rh * 1.45));
  // windows glow warm (both long sides), door
  for (const b of [-1, 1]) for (const a of big ? [-0.62, 0, 0.62] : [-0.6, 0.6]) {
    const c = L(a * hx, b * (hy + 0.04), 1.6);
    box(O, c, ex, ey, ez, 0.42, 0.03, 0.5, timber, MAT.WOOD);
    const g = L(a * hx, b * (hy + 0.075), 1.6), q = (u, v) => [g[0] + ex[0] * u, g[1] + ex[1] * u, g[2] + v];
    O.quad(q(-0.34, -0.42), q(0.34, -0.42), q(0.34, 0.42), q(-0.34, 0.42), [1.9, 1.05, 0.42], MAT.EMIT);
    O.quad(q(-0.02, -0.42), q(0.02, -0.42), q(0.02, 0.42), q(-0.02, 0.42), timber, MAT.WOOD);
    const gg = L(a * hx, b * (hy + 0.085), 1.6); O.quad([gg[0] - ex[0] * 0.34, gg[1] - ex[1] * 0.34, gg[2] - 0.01], [gg[0] + ex[0] * 0.34, gg[1] + ex[1] * 0.34, gg[2] - 0.01], [gg[0] + ex[0] * 0.34, gg[1] + ex[1] * 0.34, gg[2] + 0.01], [gg[0] - ex[0] * 0.34, gg[1] - ex[1] * 0.34, gg[2] + 0.01], timber, MAT.WOOD);
    A.sprite(...L(a * hx, b * (hy + 0.5), 1.6), 1.1, 0.16, 0.08, 0.02);
    WINDOWS.push(L(a * hx, b * (hy + 1.0), 1.6));
  }
  box(O, L(hx * 0.1, -(hy + 0.04), 1.3), ex, ey, ez, 0.45, 0.04, 1.0, [0.3, 0.2, 0.12], MAT.WOOD);
  // garden fence and a lantern by the door
  for (let a = -hx - 1.5; a <= hx + 1.5; a += 0.5) { box(O, L(a, -hy - 2.2, 0.45), ex, ey, ez, 0.04, 0.04, 0.5, [0.35, 0.27, 0.18], MAT.WOOD); }
  for (const zz of [0.5, 0.85]) box(O, L(0, -hy - 2.2, zz), ex, ey, ez, hx + 1.5, 0.025, 0.03, [0.38, 0.29, 0.2], MAT.WOOD);
}
function lantern(O, A, s, x, R) {
  const f = frame(s), w = toWorld(s, x), gz = Math.max(groundZ(s, x), f.p[2] + 0.1), side = Math.sign(x);
  limb(O, [w[0], w[1], gz - 0.1], [w[0], w[1], gz + 1.1], 0.035, 0.03, [0.25, 0.18, 0.12], MAT.WOOD, 5);
  const arm = toWorld(s, x - side * 0.35);
  limb(O, [w[0], w[1], gz + 1.05], [arm[0], arm[1], gz + 1.05], 0.02, 0.02, [0.25, 0.18, 0.12], MAT.WOOD, 4);
  const c = [arm[0], arm[1], gz + 0.88], ex = f.t, ey = f.r;
  box(O, c, ex, ey, [0, 0, 1], 0.1, 0.1, 0.14, [1.8, 0.75, 0.3], MAT.EMIT, false);
  box(O, [c[0], c[1], c[2] + 0.16], ex, ey, [0, 0, 1], 0.12, 0.12, 0.02, [0.15, 0.1, 0.07], MAT.WOOD, false);
  A.sprite(...c, 0.55, 0.5, 0.24, 0.07); A.sprite(...c, 0.18, 0.9, 0.55, 0.2);
  LANTERNS.push(c);
}
function bridge(O, A, s, R, fancy) {
  const f = frame(s), wz = f.p[2], span = f.hw + 1.6, deck = Math.max(groundZ(s, -span), groundZ(s, span), wz + 0.72) + 0.06;
  const P = (ds, x, z) => { const w = toWorld(s + ds, x); return [w[0], w[1], z]; };
  for (const ds of [-0.5, 0.5]) box(O, P(ds, 0, deck - 0.12), [f.r[0], f.r[1], 0], f.t, [0, 0, 1], span, 0.07, 0.08, [0.25, 0.18, 0.12], MAT.WOOD);
  for (let x = -span; x <= span; x += 0.17) box(O, P(0, x, deck), [f.r[0], f.r[1], 0], f.t, [0, 0, 1], 0.075, 0.62, 0.025, mixc([0.42, 0.32, 0.22], [0.55, 0.42, 0.28], R()), MAT.WOOD);
  for (const ds of [-0.6, 0.6]) {
    for (const x of [-span, -span / 2, 0, span / 2, span]) box(O, P(ds, x, deck + 0.45), [f.r[0], f.r[1], 0], f.t, [0, 0, 1], 0.035, 0.035, 0.45, [0.3, 0.22, 0.15], MAT.WOOD);
    box(O, P(ds, 0, deck + 0.9), [f.r[0], f.r[1], 0], f.t, [0, 0, 1], span, 0.03, 0.03, [0.36, 0.27, 0.18], MAT.WOOD);
  }
  for (const sd of [-1, 1]) { box(O, P(0, sd * (f.hw + 0.6), (deck + wz) / 2 - 0.2), [f.r[0], f.r[1], 0], f.t, [0, 0, 1], 0.55, 0.8, (deck - wz) / 2 + 0.25, [0.44, 0.41, 0.36], MAT.ROCK); setW(O, O.n - 30, wz); }
  if (fancy) {
    // paper bunting and hanging lanterns at the finish
    const cols = [[0.95, 0.4, 0.45], [0.98, 0.85, 0.4], [0.5, 0.75, 0.95], [0.95, 0.95, 0.9], [0.6, 0.85, 0.5]];
    for (const ds of [-0.62, 0.62]) for (let i = 0; i < 16; i++) {
      const x = -span + (i + 0.5) * (2 * span / 16), sag = 0.2 * (1 - ((x / span) ** 2)), top = deck + 0.88 - sag;
      const a = P(ds, x - 0.08, top), b = P(ds, x + 0.08, top), c = P(ds, x, top - 0.2);
      O.tri(a, b, c, cols[i % 5], MAT.PAPER);
    }
    for (const x of [-span * 0.5, span * 0.5]) { const c = P(0, x, deck - 0.4); limb(O, P(0, x, deck - 0.15), c, 0.008, 0.008, [0.1, 0.1, 0.1], MAT.MATTE, 3); box(O, c, f.t, [f.r[0], f.r[1], 0], [0, 0, 1], 0.1, 0.1, 0.13, [1.8, 0.7, 0.3], MAT.EMIT, false); A.sprite(...c, 0.6, 0.55, 0.25, 0.08); LANTERNS.push(c); }
  }
}
function lilies(O, s0, s1, R) {
  for (const l of LILIES) {
    if (l.s < s0 || l.s >= s1) continue;
    const w = toWorld(l.s, l.x), z = wzAt(l.s) + 0.012, n = 14, col = mixc([0.16, 0.3, 0.08], [0.26, 0.4, 0.12], R());
    for (let k = 0; k < n; k++) {
      const a0 = l.rot + 0.35 + (k / n) * (TAU - 0.35), a1 = l.rot + 0.35 + ((k + 1) / n) * (TAU - 0.35);
      O.tri([w[0], w[1], z + 0.004], [w[0] + Math.cos(a0) * l.r, w[1] + Math.sin(a0) * l.r, z], [w[0] + Math.cos(a1) * l.r, w[1] + Math.sin(a1) * l.r, z], col, MAT.LEAF);
    }
    if (l.flower >= 0) {
      const fc = l.flower ? [0.98, 0.95, 0.92] : [0.98, 0.62, 0.75], c = [w[0] + (R() - 0.5) * l.r * 0.6, w[1] + (R() - 0.5) * l.r * 0.6, z];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, r = 0.07; O.tri([c[0], c[1], c[2] + 0.02], [c[0] + Math.cos(a - 0.25) * r * 0.5, c[1] + Math.sin(a - 0.25) * r * 0.5, c[2] + 0.04], [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 0.07], fc, MAT.PAPER); O.tri([c[0], c[1], c[2] + 0.02], [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 0.07], [c[0] + Math.cos(a + 0.25) * r * 0.5, c[1] + Math.sin(a + 0.25) * r * 0.5, c[2] + 0.04], fc, MAT.PAPER); }
      blob(O, [c[0], c[1], c[2] + 0.03], 0.018, 0.018, 0.015, [1.4, 1.0, 0.2], MAT.EMIT, 5, 3);
    }
  }
}
function mill(O, A, s0, s1, R) {
  if (MILL.s < s0 || MILL.s >= s1) return;
  const f = frame(MILL.s);
  cottage(O, A, MILL.s - 1, MILL.side * (f.hw + 5.2), Math.PI / 2, R, true);
  // axle stub on the wall side
  const a = toWorld(MILL.s, MILL.side * (f.hw + 0.8)), b = toWorld(MILL.s, MILL.side * (f.hw + 2.0)), z = f.p[2] + 1.0;
  limb(O, [a[0], a[1], z], [b[0], b[1], z], 0.09, 0.09, [0.2, 0.2, 0.22], MAT.MATTE, 8);
}
// the mill wheel, modelled about its axle: local x = along the axle, (y, z) = wheel plane
export function wheelModel() {
  const m = new Mesh(6000), R = 1.55, wid = 0.42, N = 16, wood = [0.36, 0.26, 0.17], dark = [0.22, 0.16, 0.11];
  for (const sx of [-wid / 2, wid / 2]) for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * TAU, a1 = ((k + 1) / 24) * TAU;
    for (const [r0, r1] of [[R - 0.12, R]]) m.quad([sx, Math.cos(a0) * r0, Math.sin(a0) * r0], [sx, Math.cos(a1) * r0, Math.sin(a1) * r0], [sx, Math.cos(a1) * r1, Math.sin(a1) * r1], [sx, Math.cos(a0) * r1, Math.sin(a0) * r1], dark, MAT.WOOD);
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; for (const sx of [-wid / 2, wid / 2]) limb(m, [sx, 0, 0], [sx, Math.cos(a) * (R - 0.08), Math.sin(a) * (R - 0.08)], 0.045, 0.04, wood, MAT.WOOD, 4); }
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU, c = Math.cos(a), sn = Math.sin(a), r0 = R - 0.35, r1 = R + 0.08;
    m.quad([-wid / 2, c * r0, sn * r0], [wid / 2, c * r0, sn * r0], [wid / 2, c * r1, sn * r1], [-wid / 2, c * r1, sn * r1], wood, MAT.WOOD);
    const d = 0.025; m.quad([-wid / 2, c * r1 - sn * d, sn * r1 + c * d], [wid / 2, c * r1 - sn * d, sn * r1 + c * d], [wid / 2, c * r0 - sn * d, sn * r0 + c * d], [-wid / 2, c * r0 - sn * d, sn * r0 + c * d], dark, MAT.WOOD);
  }
  limb(m, [-wid, 0, 0], [wid, 0, 0], 0.13, 0.13, [0.2, 0.2, 0.22], MAT.MATTE, 8);
  return m;
}

// build one chunk; returns packed vertex arrays and the [first, count] ranges of its O, G, W and A parts
const MS = { O: new Mesh(90000), G: new Mesh(60000), W: new Mesh(6000), A: new Mesh(4000) };
export function buildChunk(ci) {
  const s0 = S_MIN + ci * CHUNK, s1 = Math.min(S_MAX, s0 + CHUNK), R = mulberry32(ci * 7919 + 3);
  const { O, G, W, A } = MS; O.reset(); G.reset(); W.reset(); A.reset();
  terrain(O, s0, s1); water(W, s0, s1);
  walls(O, s0, s1, R); bankStones(O, s0, s1, R); rocks(O, A, s0, s1, R);
  grass(G, O, s0, s1, R); bushes(O, s0, s1, R); lilies(O, s0, s1, R);
  for (const T of TREES) if (T.s >= s0 && T.s < s1) tree(O, T, T.kind === "near" ? 2 : T.kind === "mid" ? 1 : 0);
  for (const c of COTTAGES) if (c.s >= s0 && c.s < s1) cottage(O, A, c.s, c.x, c.rot, R);
  for (const b of BRIDGES) if (b >= s0 && b < s1) bridge(O, A, b, R, b === FINISH);
  for (const cp of CHECKPOINTS) if (cp >= s0 && cp < s1) { const f = frame(cp); for (const sd of [-1, 1]) lantern(O, A, cp, sd * (f.hw + 0.45), R); }
  mill(O, A, s0, s1, R);
  const n = O.n + G.n + W.n + A.n, pos = new Float32Array(n * 4), col = new Float32Array(n * 4), rec = { ci, s0, s1, n, pos, col };
  let o = 0;
  for (const [k, m] of [["O", O], ["G", G], ["W", W], ["A", A]]) { pos.set(m.pos.subarray(0, m.n * 4), o * 4); col.set(m.col.subarray(0, m.n * 4), o * 4); rec[k] = [o, m.n]; o += m.n; }
  return rec;
}
