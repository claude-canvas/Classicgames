// Frost Stone static world (DESIGN.md §5): the frozen lake (one big ICE surface), snowy shore and pines, the sheet's
// snow banks, lantern posts, the hack, a warming hut by the house end and a ring of far mountains.
// Everything that should reflect in the ice is written to R as well; main.js mirrors R below the surface.

import { MAT, tube, limb, blob, mulberry32, fbm, vnoise, smooth, mixc } from "./mesh.js";

export const LAKE = { x: 0, y: 25, rx: 70, ry: 95 };
export const LANTERNS = [];            // lantern centres (filled by buildScene)
export const HUT = { x: 7.5, y: 45, w: 4.2, d: 3.2 };
for (let y = -4; y <= 44; y += 6) for (const x of [-3.4, 3.4]) LANTERNS.push([x, y, 2.05]);

const TAU = Math.PI * 2;
const lakeT = (x, y) => Math.hypot((x - LAKE.x) / LAKE.rx, (y - LAKE.y) / LAKE.ry);
export function groundH(x, y) {
  const t = lakeT(x, y);
  if (t < 1) return 0;
  return smooth(1, 1.25, t) * 2.5 + smooth(1.15, 3, t) * 14 * fbm(x * 0.012, y * 0.012, 3) + (fbm(x * 0.08, y * 0.08, 5) - 0.5) * 1.2 * smooth(1, 1.1, t);
}

export function shadow(Sh, x, y, z, r, k) {
  Sh.v(x - r, y - r, z + 0.004, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, z + 0.004, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.004, 3, k, 0, 0, MAT.SHADOW);
  Sh.v(x - r, y - r, z + 0.004, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.004, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, z + 0.004, 1, k, 0, 0, MAT.SHADOW);
}

// O = opaque, R = reflected copy source, I = ice, Sh = shadows, A = additive
export function buildScene(O, R, I, Sh, A) {
  const rnd = mulberry32(1337);
  // ---- the ice: one big polar disk (fine near the sheet so the per-pixel work stays smooth)
  {
    const NA = 96, NR = 28, P = (i, j) => { const a = (i / NA) * TAU, t = Math.pow(j / NR, 1.6) * 1.0; return [LAKE.x + Math.cos(a) * LAKE.rx * t, LAKE.y + Math.sin(a) * LAKE.ry * t, 0]; };
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) I.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), [1, 1, 1], MAT.ICE);
  }
  // ---- snowy shore: polar grid from the lake edge outwards
  {
    const NA = 140, NR = 34, P = (i, j) => {
      const a = (i / NA) * TAU, t = 0.995 + Math.pow(j / NR, 2.2) * 14;
      const x = LAKE.x + Math.cos(a) * LAKE.rx * t, y = LAKE.y + Math.sin(a) * LAKE.ry * t;
      return [x, y, groundH(x, y) - (j === 0 ? 0.05 : 0)];
    };
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const c = mixc([0.82, 0.87, 0.96], [0.7, 0.76, 0.9], rnd() * 0.3);
      O.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), c, MAT.SNOW); if (j < 6) R.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), c, MAT.SNOW);
    }
  }
  // ---- pines around the shore
  for (let k = 0; k < 420; k++) {
    const a = rnd() * TAU, t = 1.06 + Math.pow(rnd(), 1.5) * 2.6;
    const x = LAKE.x + Math.cos(a) * LAKE.rx * t, y = LAKE.y + Math.sin(a) * LAKE.ry * t;
    pine(t < 1.6 ? R : O, x, y, groundH(x, y), 5 + rnd() * 9, rnd);
    if (t < 1.6) pine(O, x, y, groundH(x, y), 0, rnd, true);
  }
  // a few trees close to the sheet for scale (on a small snowy island behind the hack)
  for (const [x, y, s] of [[-9, -14, 7], [-12, -9, 9], [8, -16, 8], [13, -11, 6], [-15, 52, 10], [16, 58, 9], [-8, 60, 8]]) {
    blob(R, [x, y, -0.3], 4.5, 4.5, 1.0, [0.8, 0.85, 0.95], MAT.SNOW, 10, 4);
    pine(R, x, y, 0.2, s, rnd);
  }
  // ---- sheet snow banks
  for (const sx of [-1, 1]) {
    const N = 48;
    for (let i = 0; i < N; i++) {
      const y0 = -7 + (i / N) * 49, y1 = -7 + ((i + 1) / N) * 49, x = sx * 2.72;
      const h = (y) => 0.16 + 0.06 * vnoise(y * 0.7, sx * 3, 2);
      const q = (y, dx, z) => [x + sx * dx, y, z];
      O.quad(q(y0, -0.22, 0), q(y1, -0.22, 0), q(y1, 0, h(y1)), q(y0, 0, h(y0)), [0.86, 0.9, 0.98], MAT.SNOW);
      O.quad(q(y0, 0, h(y0)), q(y1, 0, h(y1)), q(y1, 0.3, 0), q(y0, 0.3, 0), [0.8, 0.85, 0.95], MAT.SNOW);
    }
  }
  // back board (snow wall) behind each end
  for (const [y0, dir] of [[40.4, 1], [-7.2, -1]]) {
    blob(O, [0, y0 + dir * 0.3, 0], 3.4, 0.6, 0.38, [0.85, 0.9, 0.98], MAT.SNOW, 16, 4);
  }
  // ---- the hack (rubber foothold) and a wooden bench
  O.quad([-0.22, -1.1, 0.012], [0.22, -1.1, 0.012], [0.22, -0.92, 0.012], [-0.22, -0.92, 0.012], [0.04, 0.04, 0.05], MAT.MATTE);
  // ---- lantern posts
  for (const [x, y] of LANTERNS) {
    const dark = [0.22, 0.13, 0.08];
    for (const M of [O, R]) {
      tube(M, x, y, 6, 0.07, 0, 0.06, 2.4, dark, MAT.MATTE);
      limb(M, [x, y, 2.35], [x - Math.sign(x) * 0.38, y, 2.35], 0.03, 0.03, dark, MAT.MATTE, 4);
      blob(M, [x, y, 2.43], 0.12, 0.12, 0.06, [0.9, 0.93, 1.0], MAT.SNOW, 6, 3);     // snow cap
      // the lantern itself: ribbed paper, lit from inside
      const lx = x - Math.sign(x) * 0.38, n = 10, r = 0.2, h = 0.42, z0 = 2.32 - h;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, bul = (z) => r * (1 + 0.18 * Math.sin((z / h) * Math.PI));
        for (let j = 0; j < 3; j++) {
          const za = (j * h) / 3, zb = ((j + 1) * h) / 3;
          const pa = (a, z) => [lx + Math.cos(a) * bul(z), y + Math.sin(a) * bul(z), z0 + z, 0.85];
          M.quad(pa(a0, za), pa(a1, za), pa(a1, zb), pa(a0, zb), [1.0, 0.62, 0.3], MAT.PAPER);
        }
      }
      tube(M, lx, y, n, r * 0.9, z0 + h, r * 0.9, z0 + h + 0.04, [0.1, 0.06, 0.05], MAT.MATTE, 0, true);
      tube(M, lx, y, n, r * 0.9, z0 - 0.03, r * 0.9, z0, [0.1, 0.06, 0.05], MAT.MATTE, 0, true);
    }
    shadow(Sh, x, y, 0, 0.35, 0.5);
    const lx = x - Math.sign(x) * 0.38;
    A.sprite(lx, y, 2.11, 1.3, 0.16, 0.085, 0.03); A.sprite(lx, y, 2.11, 0.4, 0.45, 0.27, 0.1);
  }
  // ---- warming hut
  hut(O, R, Sh, A);
  // ---- far mountains ring
  {
    const NA = 240, rows = [[0.9, 0], [1.0, 0.55], [1.08, 1], [1.3, 0.3]];   // [radius factor, height factor]
    const pts = (ii) => {
      const a = (ii / NA) * TAU, ca = Math.cos(a), sa = Math.sin(a), base = 1700 + 600 * vnoise(ca * 3 + 7, sa * 3, 9);
      const peak = 120 + 900 * Math.pow(fbm(ca * 5 + 10, sa * 5 + 10, 11, 5), 2.2) + 120 * vnoise(ca * 40, sa * 40, 4);
      return rows.map(([k, f]) => [ca * base * k, LAKE.y + sa * base * k, f ? peak * f : -30, peak]);
    };
    for (let i = 0; i < NA; i++) {
      const A0 = pts(i), A1 = pts(i + 1), w = Math.max(A0[2][3], A1[2][3]);
      for (let r = 0; r < rows.length - 1; r++) {
        const a = A0[r], b = A1[r], c = A1[r + 1], d = A0[r + 1];
        for (const M of [O, R]) M.quad([a[0], a[1], a[2], w], [b[0], b[1], b[2], w], [c[0], c[1], c[2], w], [d[0], d[1], d[2], w], [1, 1, 1], MAT.FAR);
      }
    }
  }
}

function pine(M, x, y, z, s, rnd, shadowOnly = false) {
  if (shadowOnly) return;
  const tiers = 4, green = mixc([0.05, 0.13, 0.1], [0.08, 0.17, 0.12], rnd());
  tube(M, x, y, 5, s * 0.035, z - 0.3, s * 0.025, z + s * 0.25, [0.18, 0.11, 0.07], MAT.MATTE);
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers, z0 = z + s * (0.15 + f * 0.62), r = s * (0.36 - f * 0.08), top = z0 + s * 0.42, rot = rnd() * TAU;
    tube(M, x, y, 7, r, z0, 0, top, green, MAT.MATTE, rot);
    tube(M, x, y, 7, r * 0.62, z0 + (top - z0) * 0.38 + 0.03, 0, top + 0.05, [0.85, 0.9, 1.0], MAT.SNOW, rot);   // snow on the boughs
  }
}

function hut(O, R, Sh, A) {
  const { x, y, w, d } = HUT, h = 2.4, wood = [0.34, 0.2, 0.12], dark = [0.18, 0.1, 0.06];
  for (const M of [O, R]) {
    // log walls
    for (let k = 0; k < 9; k++) {
      const z = 0.15 + k * 0.27, c = k % 2 ? wood : mixc(wood, dark, 0.3);
      limb(M, [x - w / 2 - 0.15, y - d / 2, z], [x + w / 2 + 0.15, y - d / 2, z], 0.14, 0.14, c, MAT.MATTE, 6);
      limb(M, [x - w / 2 - 0.15, y + d / 2, z], [x + w / 2 + 0.15, y + d / 2, z], 0.14, 0.14, c, MAT.MATTE, 6);
      limb(M, [x - w / 2, y - d / 2 - 0.15, z + 0.13], [x - w / 2, y + d / 2 + 0.15, z + 0.13], 0.14, 0.14, c, MAT.MATTE, 6);
      limb(M, [x + w / 2, y - d / 2 - 0.15, z + 0.13], [x + w / 2, y + d / 2 + 0.15, z + 0.13], 0.14, 0.14, c, MAT.MATTE, 6);
    }
    // gables + snowy roof
    for (const sy of [-1, 1]) M.tri([x - w / 2, y + sy * d / 2, h + 0.1], [x + w / 2, y + sy * d / 2, h + 0.1], [x, y + sy * d / 2, h + 1.5], wood, MAT.MATTE);
    for (const sx of [-1, 1]) {
      M.quad([x + sx * (w / 2 + 0.5), y - d / 2 - 0.5, h - 0.1], [x + sx * (w / 2 + 0.5), y + d / 2 + 0.5, h - 0.1], [x, y + d / 2 + 0.5, h + 1.6], [x, y - d / 2 - 0.5, h + 1.6], dark, MAT.MATTE);
      M.quad([x + sx * (w / 2 + 0.55), y - d / 2 - 0.55, h - 0.02], [x + sx * (w / 2 + 0.55), y + d / 2 + 0.55, h - 0.02], [x, y + d / 2 + 0.55, h + 1.75], [x, y - d / 2 - 0.55, h + 1.75], [0.88, 0.92, 1.0], MAT.SNOW);
    }
    // chimney
    tube(M, x + 1.1, y + 0.6, 4, 0.3, h, 0.3, h + 2.2, [0.3, 0.28, 0.3], MAT.MATTE, Math.PI / 4);
    // glowing windows (the side facing the sheet and the front)
    for (const wy of [-0.6, 0.6]) M.quad([x - w / 2 - 0.16, y + wy - 0.38, 0.9], [x - w / 2 - 0.16, y + wy + 0.38, 0.9], [x - w / 2 - 0.16, y + wy + 0.38, 1.55], [x - w / 2 - 0.16, y + wy - 0.38, 1.55], [1.4, 0.75, 0.32], MAT.EMIT);
    M.quad([x - 0.5, y - d / 2 - 0.16, 0.05], [x + 0.5, y - d / 2 - 0.16, 0.05], [x + 0.5, y - d / 2 - 0.16, 1.95], [x - 0.5, y - d / 2 - 0.16, 1.95], [0.9, 0.45, 0.18], MAT.EMIT);
  }
  shadow(Sh, x, y, 0, 3.8, 0.55);
  for (const wy of [-0.6, 0.6]) A.sprite(x - w / 2 - 0.4, y + wy, 1.2, 1.2, 0.35, 0.17, 0.05);
  A.sprite(x, y - d / 2 - 0.5, 1.0, 1.6, 0.3, 0.14, 0.04);
}
