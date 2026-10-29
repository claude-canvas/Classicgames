// Storm Beacon static world (DESIGN.md §4): the sea grid (displaced on the GPU), the coast and its cliffs, the
// headland with the lighthouse and keeper's cottage, the harbour town and its breakwaters. Reef rocks and buoys
// depend on the night and are built by main.js.

import { MAT, tube, limb, blob, mulberry32, fbm, vnoise, smooth, mixc } from "./mesh.js";

export const LIGHT = { x: 0, y: 18, base: 22, lens: 48.2 };
export const MOUTH = { x: -215, y: 80, w: 24 };      // harbour entrance between the breakwater heads
export const TOWN_LIGHTS = [];
export const HARBOUR_LIGHTS = [[-190, 80, 6.5, [0.2, 1, 0.35]], [-240, 80, 6.5, [1, 0.2, 0.15]]];

export function coastY(x) {
  let y = -6 + 12 * Math.sin(x / 90) + 6 * Math.sin(x / 37 + 1);
  y += 44 * Math.exp(-((x / 48) ** 2));                          // the headland
  y -= 26 * smooth(-120, -150, x) * smooth(-330, -300, x);       // the harbour bay
  return y;
}
export function landH(x, y) {
  const t = coastY(x) - y;                                        // distance inland
  if (t < 0) return -2 + t * 0.12;
  const cliff = x > -140 || x < -330 ? 13 + 7 * fbm(x * 0.01, 3, 2) + 9 * Math.exp(-((x / 60) ** 2)) : 3 + 0.08 * Math.max(0, -y - 10);
  return cliff * smooth(0, x > -140 || x < -330 ? 7 : 25, t) + 6 * fbm(x * 0.012, y * 0.012, 4) * smooth(10, 60, t) + (vnoise(x * 0.2, y * 0.2, 1) - 0.5) * 1.2;
}

export function buildScene(O, A, S) {
  const rnd = mulberry32(31);
  // ---- the sea: polar grid around the headland, fine near the camera
  {
    const NA = 168, cx = 0, cy = 20, ring = (i) => 5 * Math.pow(1.043, i) - 5;
    let NR = 0; while (ring(NR) < 3800) NR++;
    const P = (i, j) => { const a = (i / NA) * Math.PI * 2, r = ring(j); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]; };
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const p = P(i, j); if (p[1] < -60 && Math.hypot(p[0], p[1]) < 900) continue;   // under the land
      S.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), [0, 0, 0], MAT.SEA);
    }
  }
  // ---- land
  {
    const X0 = -900, X1 = 900, Y0 = -500, Y1 = 90, DX = 7, DY = 5;
    const nx = Math.round((X1 - X0) / DX), ny = Math.round((Y1 - Y0) / DY);
    const H = []; for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) H.push(landH(X0 + i * DX, Y0 + j * DY));
    const P = (i, j) => [X0 + i * DX, Y0 + j * DY, H[j * (nx + 1) + i]];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (Math.max(a[2], b[2], c[2], d[2]) < -1.5) continue;
      const slope = Math.max(Math.abs(a[2] - c[2]), Math.abs(b[2] - d[2])), t = coastY(a[0]) - a[1];
      const rock = slope > 3.2 || t < 4;
      const col = rock ? mixc([0.2, 0.19, 0.2], [0.3, 0.28, 0.27], rnd()) : mixc([0.12, 0.17, 0.08], [0.18, 0.2, 0.1], rnd());
      O.quad(a, b, c, d, col, rock ? MAT.ROCK : MAT.GRASS);
    }
  }
  // boulders at the foot of the cliffs
  for (let k = 0; k < 260; k++) {
    const x = (rnd() * 2 - 1) * 800; if (x < -135 && x > -335) continue;
    const y = coastY(x) + 2 - rnd() * 10, s = 1.5 + rnd() * 4;
    blob(O, [x, y, -1 + rnd()], s * 1.3, s, s * 0.8, [0.2, 0.2, 0.21], MAT.ROCK, 6, 4, (i, j) => 0.8 + 0.4 * vnoise(i * 1.7 + k, j * 1.3, 3));
  }
  lighthouse(O, A);
  cottage(O, A, -16, 4);
  town(O, A, rnd);
  breakwaters(O, A);
}

function lighthouse(O, A) {
  const { x, y, base, lens } = LIGHT, top = lens - 2.2;
  // rocky plinth
  tube(O, x, y, 14, 6.5, base - 3, 5.2, base + 0.8, [0.42, 0.4, 0.38], MAT.MATTE);
  // tower: white with two red bands, slightly tapering
  const N = 20, segs = 12, r0 = 4.1, r1 = 2.7;
  for (let j = 0; j < segs; j++) {
    const z0 = base + 0.8 + (j / segs) * (top - base - 0.8), z1 = base + 0.8 + ((j + 1) / segs) * (top - base - 0.8);
    const rr0 = r0 + (r1 - r0) * (j / segs), rr1 = r0 + (r1 - r0) * ((j + 1) / segs);
    const red = j === 3 || j === 4 || j === 8 || j === 9;
    tube(O, x, y, N, rr0, z0, rr1, z1, red ? [0.62, 0.08, 0.06] : [0.86, 0.86, 0.84], MAT.GLOSS, 0, false);
  }
  // windows up the tower
  for (let k = 0; k < 4; k++) { const z = base + 5 + k * 5.5, a = -Math.PI / 2 + (k % 2 ? 0.4 : -0.4), r = r0 - (r0 - r1) * ((z - base) / (top - base)) + 0.05; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; O.quad([px - 0.4, py, z], [px + 0.4, py, z], [px + 0.4, py, z + 1.1], [px - 0.4, py, z + 1.1], [1.2, 0.7, 0.3], MAT.EMIT); }
  // gallery
  tube(O, x, y, N, 3.9, top, 3.9, top + 0.35, [0.12, 0.12, 0.13], MAT.GLOSS);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; limb(O, [x + Math.cos(a) * 3.75, y + Math.sin(a) * 3.75, top + 0.35], [x + Math.cos(a) * 3.75, y + Math.sin(a) * 3.75, top + 1.4], 0.04, 0.04, [0.1, 0.1, 0.1], MAT.GLOSS, 3); }
  tube(O, x, y, N, 3.78, top + 1.35, 3.78, top + 1.45, [0.1, 0.1, 0.1], MAT.GLOSS, 0, false);
  // lantern room: glass that glows from the lamp, astragal bars, red dome
  tube(O, x, y, 12, 2.25, top + 0.35, 2.25, lens + 1.6, [1.0, 0.85, 0.55], MAT.GLASS, 0, false);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; limb(O, [x + Math.cos(a) * 2.28, y + Math.sin(a) * 2.28, top + 0.35], [x + Math.cos(a) * 2.28, y + Math.sin(a) * 2.28, lens + 1.6], 0.05, 0.05, [0.08, 0.08, 0.08], MAT.GLOSS, 3); }
  tube(O, x, y, 16, 2.6, lens + 1.6, 0.4, lens + 4.0, [0.45, 0.05, 0.04], MAT.GLOSS);
  blob(O, [x, y, lens + 4.2], 0.45, 0.45, 0.45, [0.1, 0.1, 0.1], MAT.GLOSS, 8, 5);
  limb(O, [x, y, lens + 4.5], [x, y, lens + 6.5], 0.04, 0.02, [0.1, 0.1, 0.1], MAT.GLOSS, 3);
  A.sprite(x, y, lens, 5.5, 0.55, 0.45, 0.3);
}
function box(O, x, y, z, w, d, h, rot, col, roofCol) {
  const c = Math.cos(rot), s = Math.sin(rot), P = (u, v, zz) => [x + u * c - v * s, y + u * s + v * c, zz];
  const u0 = -w / 2, u1 = w / 2, v0 = -d / 2, v1 = d / 2, zb = z - 2, zt = z + h, dark = col.map((v) => v * 0.8);
  O.quad(P(u0, v0, zb), P(u1, v0, zb), P(u1, v0, zt), P(u0, v0, zt), col, MAT.MATTE);
  O.quad(P(u1, v0, zb), P(u1, v1, zb), P(u1, v1, zt), P(u1, v0, zt), dark, MAT.MATTE);
  O.quad(P(u1, v1, zb), P(u0, v1, zb), P(u0, v1, zt), P(u1, v1, zt), col, MAT.MATTE);
  O.quad(P(u0, v1, zb), P(u0, v0, zb), P(u0, v0, zt), P(u0, v1, zt), dark, MAT.MATTE);
  const rh = Math.min(w, d) * 0.45;
  O.quad(P(u0 - 0.3, v0 - 0.3, zt), P(u1 + 0.3, v0 - 0.3, zt), P(u1 + 0.3, 0, zt + rh), P(u0 - 0.3, 0, zt + rh), roofCol, MAT.GLOSS);
  O.quad(P(u0 - 0.3, v1 + 0.3, zt), P(u1 + 0.3, v1 + 0.3, zt), P(u1 + 0.3, 0, zt + rh), P(u0 - 0.3, 0, zt + rh), roofCol, MAT.GLOSS);
  O.tri(P(u0, v0, zt), P(u0, v1, zt), P(u0, 0, zt + rh), col, MAT.MATTE); O.tri(P(u1, v0, zt), P(u1, v1, zt), P(u1, 0, zt + rh), dark, MAT.MATTE);
  return P;
}
function cottage(O, A, x, y) {
  const z = landH(x, y), P = box(O, x, y, z, 8, 5, 3.4, 0.15, [0.82, 0.8, 0.74], [0.18, 0.2, 0.24]);
  for (const u of [-2.2, 1.6]) O.quad(P(u, 2.56, z + 1), P(u + 1, 2.56, z + 1), P(u + 1, 2.56, z + 2.2), P(u, 2.56, z + 2.2), [1.5, 0.85, 0.4], MAT.EMIT);
  tube(O, ...P(2.6, -1, 0).slice(0, 2), 4, 0.45, z + 3, 0.45, z + 6.4, [0.35, 0.3, 0.3], MAT.MATTE);
  TOWN_LIGHTS.push([...P(-1.5, 4, z + 1.6)]);
}
function town(O, A, rnd) {
  for (let k = 0; k < 120; k++) {
    const x = -320 + rnd() * 175, y = -90 + rnd() * 80; if (coastY(x) - y < 6) continue;
    const z = landH(x, y), w = 5 + rnd() * 5, d = 4 + rnd() * 4, h = 3 + rnd() * 5, rot = (rnd() - 0.5) * 0.5;
    const col = mixc([0.7, 0.66, 0.6], [0.55, 0.5, 0.48], rnd()), roof = rnd() < 0.5 ? [0.32, 0.12, 0.08] : [0.16, 0.18, 0.22];
    const P = box(O, x, y, z, w, d, h, rot, col, roof);
    const nW = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nW; i++) {
      const u = -w / 2 + 0.8 + (i / nW) * (w - 1.6), lit = rnd() < 0.55, wz = z + 1 + (h > 5 && rnd() < 0.5 ? 2.5 : 0);
      O.quad(P(u, d / 2 + 0.05, wz), P(u + 0.9, d / 2 + 0.05, wz), P(u + 0.9, d / 2 + 0.05, wz + 1.1), P(u, d / 2 + 0.05, wz + 1.1), lit ? [1.6, 0.9, 0.4] : [0.08, 0.08, 0.1], lit ? MAT.EMIT : MAT.MATTE);
      if (lit && rnd() < 0.08 && TOWN_LIGHTS.length < 10) TOWN_LIGHTS.push(P(u + 0.45, d / 2 + 2, wz + 0.5));
      if (lit) A.sprite(...P(u + 0.45, d / 2 + 0.4, wz + 0.55), 1.4, 0.28, 0.15, 0.05);
    }
  }
  // church with a spire
  { const x = -250, y = -55, z = landH(x, y); box(O, x, y, z, 9, 16, 7, 0.1, [0.62, 0.6, 0.56], [0.2, 0.22, 0.26]); tube(O, x, y - 9, 4, 2.4, z, 2.4, z + 14, [0.6, 0.58, 0.54], MAT.MATTE, Math.PI / 4); tube(O, x, y - 9, 4, 2.6, z + 14, 0, z + 24, [0.2, 0.22, 0.26], MAT.GLOSS, Math.PI / 4); }
  // street lamps along the quay
  for (let x = -300; x < -150; x += 18) { const y = coastY(x) - 3, z = landH(x, y); tube(O, x, y, 4, 0.12, z, 0.1, z + 4.5, [0.1, 0.1, 0.1], MAT.GLOSS); A.sprite(x, y, z + 4.6, 1.6, 0.6, 0.38, 0.14); A.sprite(x, y, z + 4.6, 0.35, 1, 0.85, 0.5); }
}
function breakwaters(O, A) {
  const wall = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / 5);
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; blob(O, [x, y, 1.2], 4.2, 4.2, 3.2, [0.36, 0.35, 0.33], MAT.ROCK, 6, 3, (a, b) => 0.85 + 0.3 * vnoise(a + x, b + y, 7)); }
      limb(O, [x0, y0, 3.6], [x1, y1, 3.6], 1.6, 1.6, [0.5, 0.48, 0.45], MAT.MATTE, 4);
    }
  };
  wall([[-145, -4], [-148, 50], [-190, 80]]);
  wall([[-305, -4], [-300, 55], [-240, 80]]);
  for (const [x, y, z, c] of HARBOUR_LIGHTS) { tube(O, x, y, 8, 1.2, 2, 1.0, z, [0.85, 0.85, 0.85], MAT.GLOSS); tube(O, x, y, 8, 0.7, z, 0.7, z + 1.2, c.map((v) => v * 1.4), MAT.EMIT); A.sprite(x, y, z + 0.6, 3.5, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5); }
}
