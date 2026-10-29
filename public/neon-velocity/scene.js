// Neon Velocity static world (DESIGN.md §5): the skyway (road, barriers, rails, underside, pylons), holo arches,
// start gantry and a procedural neon megacity.
import { MAT, tube, limb, blob, mulberry32, mixc } from "./mesh.js";
import { F, LENGTH, HALF, PADS, ARCHES, toWorld, frame, wrapS } from "./track.js";

export function buildWorld(O, G, A) {
  const N = F.length, ds = LENGTH / N, cols = [-HALF, -8, -5.5, -3, 0, 3, 5.5, 8, HALF];
  const padAt = (s, x) => PADS.some(([ps, x0, x1]) => { const d = wrapS(s - ps); return d < 12 && x >= x0 && x <= x1; }) ? 1 : 0;
  for (let i = 0; i < N; i++) {
    const s0 = i * ds, s1 = (i + 1) * ds;
    for (let c = 0; c < cols.length - 1; c++) {
      const xa = cols[c], xb = cols[c + 1], pad = padAt(s0 + ds / 2, (xa + xb) / 2);
      const P = (s, x) => [...toWorld(s, x, 0), x];
      O.quad4(P(s0, xa), P(s0, xb), P(s1, xb), P(s1, xa), [s0, pad, 0], [s0, pad, 0], [s1, pad, 0], [s1, pad, 0], MAT.ROAD);
    }
    // underside slab + side skirts
    const a0 = toWorld(s0, -HALF - 0.6, -0.1), a1 = toWorld(s1, -HALF - 0.6, -0.1), b0 = toWorld(s0, HALF + 0.6, -0.1), b1 = toWorld(s1, HALF + 0.6, -0.1);
    const c0 = toWorld(s0, -HALF + 1, -1.8), c1 = toWorld(s1, -HALF + 1, -1.8), d0 = toWorld(s0, HALF - 1, -1.8), d1 = toWorld(s1, HALF - 1, -1.8);
    O.quad(a0, a1, c1, c0, [0.12, 0.12, 0.18], MAT.METAL); O.quad(b0, b1, d1, d0, [0.12, 0.12, 0.18], MAT.METAL); O.quad(c0, c1, d1, d0, [0.08, 0.08, 0.12], MAT.METAL);
    // barrier glass + neon rails
    for (const sd of [-1, 1]) {
      const x = sd * (HALF + 0.3), g0 = toWorld(s0, x, 0), g1 = toWorld(s1, x, 0), h0 = toWorld(s0, x, 1.6), h1 = toWorld(s1, x, 1.6);
      G.quad(g0, g1, h1, h0, sd < 0 ? [0.9, 0.2, 0.7] : [0.2, 0.8, 1.0], MAT.GLASS);
      const r0 = toWorld(s0, x, 1.6), r1 = toWorld(s1, x, 1.6), q0 = toWorld(s0, x, 1.75), q1 = toWorld(s1, x, 1.75);
      O.quad(r0, r1, q1, q0, sd < 0 ? [1.6, 0.25, 1.1] : [0.25, 1.2, 1.7], MAT.EMIT);
      if (i % 3 === 0) { const l0 = toWorld(s0, x, 0.05), l1 = toWorld(s1, x, 0.05); O.quad(l0, l1, toWorld(s1, x, 0.2), toWorld(s0, x, 0.2), [1.4, 1.4, 1.6], MAT.EMIT); }
    }
  }
  // pylons down into the city
  for (let s = 0; s < LENGTH; s += 44) { const f = frame(s), p = f.p; if (p[2] < 6) continue; tube(O, p[0], p[1], 8, 2.2, -70, 1.6, p[2] - 1.5, [0.1, 0.1, 0.14], MAT.METAL); for (let z = -60; z < p[2] - 6; z += 18) tube(O, p[0], p[1], 8, 2.25, z, 2.25, z + 0.5, [0.2, 0.9, 1.4], MAT.EMIT, 0, false); }
  // holo arches
  ARCHES.forEach((s, ai) => {
    const col = [[1.4, 0.3, 1.2], [0.3, 1.2, 1.6], [1.6, 0.8, 0.2]][ai % 3], f = frame(s);
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI, a1 = ((k + 1) / 24) * Math.PI, R = HALF + 2;
      const P = (a, rr) => toWorld(s, -Math.cos(a) * rr, Math.sin(a) * rr * 0.75);
      O.quad(P(a0, R), P(a1, R), P(a1, R + 0.7), P(a0, R + 0.7), [0.12, 0.12, 0.16], MAT.METAL);
      A.quad(P(a0, R - 0.1), P(a1, R - 0.1), P(a1, R - 0.45), P(a0, R - 0.45), col, MAT.ADD);
    }
    void f;
  });
  // start gantry with a checker banner
  for (let k = 0; k < 16; k++) { const x0 = -HALF + (k / 16) * 2 * HALF, x1 = -HALF + ((k + 1) / 16) * 2 * HALF; for (let r = 0; r < 2; r++) O.quad(toWorld(0, x0, 7 + r * 0.8), toWorld(0, x1, 7 + r * 0.8), toWorld(0, x1, 7.8 + r * 0.8), toWorld(0, x0, 7.8 + r * 0.8), (k + r) % 2 ? [1.5, 1.5, 1.5] : [0.05, 0.05, 0.08], MAT.EMIT); }
  for (const sd of [-1, 1]) limb(O, toWorld(0, sd * (HALF + 1), 0), toWorld(0, sd * (HALF + 1), 8.8), 0.4, 0.4, [0.15, 0.15, 0.2], MAT.METAL, 6);
  for (let k = 0; k < 2 * HALF; k += 1) O.quad(toWorld(-0.6, -HALF + k, 0.02), toWorld(-0.6, -HALF + k + 1, 0.02), toWorld(0.6, -HALF + k + 1, 0.02), toWorld(0.6, -HALF + k, 0.02), k % 2 ? [1.2, 1.2, 1.2] : [0.03, 0.03, 0.03], MAT.EMIT);
  // the city
  const rnd = mulberry32(42), near = (x, y) => { let best = 1e9; for (let i = 0; i < N; i += 6) { const p = F[i].p; best = Math.min(best, Math.hypot(p[0] - x, p[1] - y)); } return best; };
  for (let k = 0, placed = 0; k < 2600 && placed < 300; k++) {
    const x = -900 + rnd() * 2300, y = -700 + rnd() * 2600, d = near(x, y); if (d < 40) continue;
    const w = 14 + rnd() * 30, h = 30 + rnd() * (d < 250 ? 140 : 260), z0 = -80, c = mixc([0.25, 0.2, 0.4], [0.15, 0.3, 0.45], rnd());
    const rot = rnd() * 0.6, ca = Math.cos(rot), sa = Math.sin(rot), P = (u, v, z) => [x + u * ca - v * sa, y + u * sa + v * ca, z];
    const hw = w / 2, hd = (w * (0.6 + rnd() * 0.6)) / 2;
    O.quad(P(-hw, -hd, z0), P(hw, -hd, z0), P(hw, -hd, h), P(-hw, -hd, h), c, MAT.CITY); O.quad(P(hw, -hd, z0), P(hw, hd, z0), P(hw, hd, h), P(hw, -hd, h), c, MAT.CITY);
    O.quad(P(hw, hd, z0), P(-hw, hd, z0), P(-hw, hd, h), P(hw, hd, h), c, MAT.CITY); O.quad(P(-hw, hd, z0), P(-hw, -hd, z0), P(-hw, -hd, h), P(-hw, hd, h), c, MAT.CITY);
    O.quad(P(-hw, -hd, h), P(hw, -hd, h), P(hw, hd, h), P(-hw, hd, h), [0.04, 0.04, 0.07], MAT.MATTE);
    const nc = [[1.6, 0.3, 1.2], [0.3, 1.4, 1.8], [1.8, 0.9, 0.2], [0.5, 1.6, 0.6]][Math.floor(rnd() * 4)];
    O.quad(P(-hw, -hd - 0.1, h - 1.2), P(hw, -hd - 0.1, h - 1.2), P(hw, -hd - 0.1, h - 0.4), P(-hw, -hd - 0.1, h - 0.4), nc, MAT.EMIT);
    if (rnd() < 0.3) { tube(O, x, y, 6, 1.2, h, 0.2, h + 25 + rnd() * 30, [0.2, 0.2, 0.25], MAT.METAL); A.sprite(x, y, h + 40, 6, 1, 0.15, 0.15); }
    if (rnd() < 0.15) { const bz = h * (0.5 + rnd() * 0.3); O.quad(P(-hw * 0.8, -hd - 1.5, bz), P(hw * 0.8, -hd - 1.5, bz), P(hw * 0.8, -hd - 1.5, bz + 10), P(-hw * 0.8, -hd - 1.5, bz + 10), nc.map((v) => v * 0.6), MAT.EMIT); }
    placed++;
  }
  // haze glow at the city floor
  for (let k = 0; k < 60; k++) A.sprite(-900 + rnd() * 2300, -700 + rnd() * 2600, -60, 80, 0.05, 0.03, 0.09);
}
