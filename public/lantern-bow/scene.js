// Lantern Bow static world (DESIGN.md §5). Metres, z up, the archer stands at the origin looking along +y.
import { MAT, tube, limb, blob, mulberry32, fbm, mixc, lerp, clamp, smooth } from "./mesh.js";

export const DECK_Z = 0.35, EYE_Z = DECK_Z + 1.55;
export const POND = { x: -5.2, y: 11.5, rx: 3.6, ry: 5.2 };
export const TORO = [[-4.6, 7], [4.6, 7], [-4.8, 16], [4.8, 16], [-5, 26], [5, 26], [-5.4, 35], [5.4, 35]];
export const BANNERS = [[-7.2, 9], [7.2, 9], [-8, 27], [8, 27]];
export const TREES = [];

export function groundH(x, y) {
  const side = smooth(11, 40, Math.abs(x)) * (5 + fbm(x * 0.03, y * 0.03, 3) * 14);
  const back = smooth(48, 140, y) * (fbm(x * 0.02, y * 0.02, 7) * 18);
  return side + back;
}

export function buildScene(O, A, Sh) {
  const R = mulberry32(42);
  // ---------------------------------------------------------------- ground
  const lawn = [0.36, 0.42, 0.18], lawn2 = [0.46, 0.5, 0.22], sand = [0.82, 0.74, 0.58], dirt = [0.42, 0.34, 0.24];
  const colAt = (x, y, z) => {
    let c = mixc(lawn, lawn2, fbm(x * 0.15, y * 0.15, 1));
    if (Math.abs(x) < 1.3 && y > 1 && y < 36) c = mixc(sand, [0.7, 0.62, 0.48], fbm(x * 2, y * 2, 4) * 0.6);
    if (y > 33 && y < 44 && Math.abs(x) < 12) c = mixc(sand, [0.9, 0.84, 0.7], 0.3 + 0.2 * Math.sin(y * 9));   // raked gravel
    if (z > 6) c = mixc(c, [0.24, 0.3, 0.16], smooth(6, 20, z));
    return c;
  };
  const S = 2;
  for (let y = -12; y < 220; y += S) for (let x = -90; x < 90; x += S) {
    const q = [[x, y], [x + S, y], [x + S, y + S], [x, y + S]].map(([a, b]) => [a, b, groundH(a, b)]);
    const c = colAt(x + 1, y + 1, q[0][2]);
    O.quad(q[0], q[1], q[2], q[3], c, MAT.MATTE);
    O.pos[O.n * 4 - 1] = 0; // keep grass smooth
  }
  // far plain out to the ridges
  for (let y = 220; y < 2400; y += 120) for (let x = -2400; x < 2400; x += 240) {
    const h = (a, b) => groundH(a, Math.min(b, 220)) + (b - 220) * 0.004 + fbm(a * 0.004, b * 0.004, 9) * 20;
    O.quad([x, y, h(x, y)], [x + 240, y, h(x + 240, y)], [x + 240, y + 120, h(x + 240, y + 120)], [x, y + 120, h(x, y + 120)], mixc([0.26, 0.32, 0.16], [0.2, 0.24, 0.14], R()), MAT.MATTE);
  }
  // ---------------------------------------------------------------- pond
  {
    const n = 48, c = [0.05, 0.09, 0.1];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const w = (a) => 1 + 0.08 * Math.sin(a * 3) + 0.05 * Math.sin(a * 5 + 1);
      O.tri([POND.x, POND.y, 0.03], [POND.x + Math.cos(a0) * POND.rx * w(a0), POND.y + Math.sin(a0) * POND.ry * w(a0), 0.03], [POND.x + Math.cos(a1) * POND.rx * w(a1), POND.y + Math.sin(a1) * POND.ry * w(a1), 0.03], c, MAT.WATER);
      if (i % 2 === 0) { const rx = POND.x + Math.cos(a0) * (POND.rx * w(a0) + 0.25), ry = POND.y + Math.sin(a0) * (POND.ry * w(a0) + 0.25), s = 0.25 + R() * 0.35; blob(O, [rx, ry, 0.05], s * 1.3, s, s * 0.6, mixc([0.5, 0.48, 0.44], [0.36, 0.34, 0.32], R()), MAT.MATTE, 7, 4); }
    }
  }
  // ---------------------------------------------------------------- deck + eaves (foreground frame)
  {
    const wood = [0.55, 0.36, 0.2];
    for (let k = 0; k < 14; k++) {
      const x0 = -4.2 + k * 0.6, c = mixc(wood, [0.45, 0.28, 0.15], R() * 0.6);
      O.quad([x0, -4, DECK_Z], [x0 + 0.58, -4, DECK_Z], [x0 + 0.58, 1.2, DECK_Z], [x0, 1.2, DECK_Z], c, MAT.MATTE);
    }
    O.quad([-4.2, 1.2, DECK_Z], [4.2, 1.2, DECK_Z], [4.2, 1.2, 0], [-4.2, 1.2, 0], [0.32, 0.2, 0.12], MAT.MATTE);
    for (const x of [-3.9, 3.9]) tube(O, x, 0.9, 8, 0.12, DECK_Z, 0.12, 3.4, [0.36, 0.22, 0.12], MAT.MATTE);
    // roof edge overhead: beam, rafters and dark tiles catching the sun
    O.quad([-5.5, 1.0, 3.4], [5.5, 1.0, 3.4], [5.5, 1.0, 3.15], [-5.5, 1.0, 3.15], [0.3, 0.18, 0.1], MAT.MATTE);
    for (let k = 0; k < 24; k++) { const x = -5.4 + k * 0.47; O.quad([x, 1.0, 3.4], [x + 0.1, 1.0, 3.4], [x + 0.1, 1.6, 3.62], [x, 1.6, 3.62], [0.28, 0.16, 0.09], MAT.MATTE); }
    O.quad([-5.8, 1.55, 3.64], [5.8, 1.55, 3.64], [5.8, -2, 4.6], [-5.8, -2, 4.6], [0.16, 0.16, 0.18], MAT.GLOSS); O.pos[O.n * 4 - 1] = 0.2;
    for (let k = 0; k < 30; k++) { const x = -5.8 + k * 0.4; tube(O, x + 0.2, 1.62, 6, 0.09, 3.6, 0.09, 3.7, [0.22, 0.22, 0.25], MAT.GLOSS); }
  }
  // ---------------------------------------------------------------- sand bank (azuchi) with its little roof
  {
    const c = [0.86, 0.66, 0.44];
    for (let x = -12; x < 12; x += 1) {
      const h0 = 1.6 + Math.sin(x * 0.7) * 0.08, h1 = 1.6 + Math.sin((x + 1) * 0.7) * 0.08;
      O.quad([x, 41, 0], [x + 1, 41, 0], [x + 1, 43.5, h1], [x, 43.5, h0], mixc(c, [0.78, 0.56, 0.36], R() * 0.4), MAT.MATTE);
      O.quad([x, 43.5, h0], [x + 1, 43.5, h1], [x + 1, 46, 0.4], [x, 46, 0.4], [0.62, 0.52, 0.38], MAT.MATTE);
    }
    for (const x of [-11, -5.5, 5.5, 11]) tube(O, x, 44.6, 6, 0.1, 0, 0.1, 2.7, [0.3, 0.18, 0.1], MAT.MATTE);
    O.quad([-12.5, 44.2, 2.65], [12.5, 44.2, 2.65], [12.5, 46.4, 3.05], [-12.5, 46.4, 3.05], [0.42, 0.36, 0.34], MAT.GLOSS);
  }
  // ---------------------------------------------------------------- torii
  {
    const red = [0.78, 0.16, 0.08], blk = [0.08, 0.07, 0.07], y = 52, z0 = groundH(0, y);
    for (const x of [-3.4, 3.4]) { tube(O, x, y, 14, 0.32, z0, 0.28, z0 + 7.2, red, MAT.GLOSS); tube(O, x, y, 14, 0.38, z0, 0.38, z0 + 0.5, blk, MAT.GLOSS); }
    const beam = (zA, zB, x0, x1, c, lift = 0) => {
      const P = (x, z, d) => [x, y + d, z];
      O.quad(P(x0, zA, -0.35), P(x1, zA, -0.35), P(x1, zB + lift, -0.35), P(x0, zB + lift, -0.35), c, MAT.GLOSS);
      O.quad(P(x0, zB + lift, -0.35), P(x1, zB + lift, -0.35), P(x1, zB + lift, 0.35), P(x0, zB + lift, 0.35), c, MAT.GLOSS);
      O.quad(P(x0, zA, 0.35), P(x1, zA, 0.35), P(x1, zB + lift, 0.35), P(x0, zB + lift, 0.35), c, MAT.GLOSS);
    };
    beam(z0 + 5.5, z0 + 5.95, -4.3, 4.3, red);
    beam(z0 + 6.9, z0 + 7.45, -5.6, 5.6, red);
    beam(z0 + 7.45, z0 + 7.85, -6.1, 6.1, blk);
    tube(O, 0, y, 6, 0.25, z0 + 5.95, 0.25, z0 + 6.9, red, MAT.GLOSS);
  }
  // ---------------------------------------------------------------- stone lanterns
  for (const [x, y] of TORO) {
    const st = mixc([0.55, 0.53, 0.5], [0.45, 0.43, 0.4], R()), z = groundH(x, y);
    tube(O, x, y, 6, 0.32, z, 0.28, z + 0.2, st, MAT.MATTE, 0, true);
    tube(O, x, y, 8, 0.11, z + 0.2, 0.11, z + 0.9, st, MAT.MATTE);
    tube(O, x, y, 6, 0.3, z + 0.9, 0.26, z + 1.0, st, MAT.MATTE, 0, true);
    tube(O, x, y, 4, 0.22, z + 1.0, 0.22, z + 1.35, mixc(st, [0.2, 0.2, 0.2], 0.4), MAT.MATTE, Math.PI / 4, false);
    tube(O, x, y, 6, 0.45, z + 1.35, 0.06, z + 1.75, st, MAT.MATTE, 0, false);
    blob(O, [x, y, z + 1.8], 0.08, 0.08, 0.1, st, MAT.MATTE, 6, 4);
    shadow(Sh, x, y, z, 0.8, 0.5);
  }
  // ---------------------------------------------------------------- cherry trees
  const sides = [-1, 1];
  for (const s of sides) for (let k = 0; k < 9; k++) {
    const y = 4 + k * 5.2 + R() * 2.5, x = s * (8.2 + R() * 5 + (k % 2) * 2.5);
    cherry(O, Sh, R, x, y, groundH(x, y), 0.8 + R() * 0.5);
  }
  for (let k = 0; k < 10; k++) { const x = (R() - 0.5) * 70, y = 60 + R() * 60; if (Math.abs(x) < 9) continue; cherry(O, Sh, R, x, y, groundH(x, y), 1 + R() * 0.6); }
  // pines on the hills
  for (let k = 0; k < 70; k++) {
    const x = (R() < 0.5 ? -1 : 1) * (16 + R() * 70), y = -5 + R() * 210, z = groundH(x, y), s = 0.8 + R() * 1.4;
    tube(O, x, y, 5, 0.18 * s, z, 0.12 * s, z + 2 * s, [0.3, 0.2, 0.12], MAT.MATTE);
    for (let j = 0; j < 3; j++) tube(O, x, y, 7, (2.2 - j * 0.55) * s, z + (1.6 + j * 1.5) * s, 0, z + (3.6 + j * 1.5) * s, mixc([0.12, 0.24, 0.14], [0.18, 0.3, 0.16], R()), MAT.FOLIAGE, R() * 6, false);
  }
  // bamboo fence along the range
  for (const s of sides) for (let y = 2; y < 40; y += 0.25) { const x = s * 6.6, z = groundH(x, y); tube(O, x, y, 5, 0.05, z, 0.05, z + 1.1 + (Math.floor(y * 4) % 3) * 0.05, mixc([0.66, 0.6, 0.32], [0.5, 0.46, 0.24], R()), MAT.GLOSS, 0, true); }
  for (const s of sides) for (const z of [0.35, 0.85]) limb(O, [s * 6.62, 2, z], [s * 6.62, 40, z], 0.04, 0.04, [0.4, 0.3, 0.16], MAT.MATTE, 5);
  // ---------------------------------------------------------------- distant ridges + pagoda
  ridge(O, R, 320, 70, [0.28, 0.33, 0.24], 0, 1.0);
  ridge(O, R, 650, 160, [0.24, 0.28, 0.3], 0, 1.4);
  ridge(O, R, 1150, 320, [0.32, 0.36, 0.44], 0, 2.0);
  peak(O, 380, 1900, 1050);
  pagoda(O, -150, 330, 60);
}

function shadow(Sh, x, y, z, r, k) {
  Sh.v(x - r, y - r, z + 0.02, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, z + 0.02, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.02, 3, k, 0, 0, MAT.SHADOW);
  Sh.v(x - r, y - r, z + 0.02, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.02, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, z + 0.02, 1, k, 0, 0, MAT.SHADOW);
}
export { shadow };

function cherry(O, Sh, R, x, y, z, s) {
  TREES.push([x, y, z, s]);
  const bark = mixc([0.24, 0.16, 0.13], [0.32, 0.22, 0.17], R());
  const top = [x + (R() - 0.5) * 0.8 * s, y + (R() - 0.5) * 0.8 * s, z + 2.6 * s];
  limb(O, [x, y, z], top, 0.24 * s, 0.14 * s, bark, MAT.MATTE, 7);
  const pinks = [[1.0, 0.66, 0.78], [1.0, 0.8, 0.88], [1.0, 0.56, 0.72], [1.0, 0.9, 0.94], [0.96, 0.7, 0.84]];
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + R() * 0.6, L = (1.6 + R() * 1.6) * s;
    const end = [top[0] + Math.cos(a) * L, top[1] + Math.sin(a) * L, top[2] + (0.6 + R() * 1.4) * s];
    limb(O, top, end, 0.12 * s, 0.05 * s, bark, MAT.MATTE, 5);
    for (let c = 0; c < 7; c++) {
      const t = 0.3 + c * 0.11, p = [lerp(top[0], end[0], t) + (R() - 0.5) * 1.3 * s, lerp(top[1], end[1], t) + (R() - 0.5) * 1.3 * s, lerp(top[2], end[2], t) + (R() - 0.25) * 1.0 * s];
      const r = (0.42 + R() * 0.42) * s;
      blob(O, p, r, r, r * 0.8, pinks[Math.floor(R() * pinks.length)], MAT.FOLIAGE, 10, 6, (i, j) => 0.88 + ((i * 7 + j * 3 + b + c) % 5) * 0.05);
    }
  }
  shadow(Sh, x, y, z, 3.6 * s, 0.35);
}

// a mountain ridge band at distance d with height h (FAR material, pos.w = snow line or 0)
function ridge(O, R, d, h, col, snow, rough) {
  const pts = [];
  for (let x = -3000; x <= 3000; x += 60) pts.push([x, d + Math.sin(x * 0.002) * d * 0.15, h * (0.35 + fbm(x * 0.0016 * rough + d, d * 0.01, 3) * 1.1)]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (const [p, q, r2, s2] of [[[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1] + 40, b[2]], [a[0], a[1] + 40, a[2]]]]) {
      for (const v of [p, q, r2, p, r2, s2]) O.v(v[0], v[1], v[2], snow, col[0], col[1], col[2], MAT.FAR);
    }
  }
}
function peak(O, x0, y0, H) {
  const n = 40, base = H * 1.6;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const r = (a) => base * (0.85 + 0.25 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7));
    const p0 = [x0 + Math.cos(a0) * r(a0), y0 + Math.sin(a0) * r(a0) * 0.6, 0], p1 = [x0 + Math.cos(a1) * r(a1), y0 + Math.sin(a1) * r(a1) * 0.6, 0];
    const m0 = [x0 + Math.cos(a0) * r(a0) * 0.35, y0 + Math.sin(a0) * r(a0) * 0.2, H * 0.72], m1 = [x0 + Math.cos(a1) * r(a1) * 0.35, y0 + Math.sin(a1) * r(a1) * 0.2, H * 0.72];
    const c = [0.36, 0.38, 0.46];
    for (const v of [p0, p1, m1, p0, m1, m0, m0, m1, [x0, y0, H]]) O.v(v[0], v[1], v[2], H * 0.62, c[0], c[1], c[2], MAT.FAR);
  }
}
function pagoda(O, x, y, zBase) {
  const dark = [0.16, 0.12, 0.12], red = [0.4, 0.12, 0.08];
  for (let k = 0; k < 5; k++) {
    const z = zBase + k * 6, w = 7 - k * 1.0;
    tube(O, x, y, 4, w * 0.45, z, w * 0.42, z + 4.2, red, MAT.MATTE, Math.PI / 4, false);
    tube(O, x, y, 4, w, z + 4.2, w * 0.45, z + 6, dark, MAT.MATTE, Math.PI / 4, false);
  }
  tube(O, x, y, 6, 0.4, zBase + 30, 0.1, zBase + 40, [0.5, 0.4, 0.2], MAT.GLOSS);
}
