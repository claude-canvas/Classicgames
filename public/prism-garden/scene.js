// Prism Garden world (DESIGN.md §4): the floating island for a level (tiles, mossy rock underside, waterfalls) and
// the piece models drawn each frame (emitters, mirrors, splitters, prisms, filters, rocks, lotus lanterns).
import { MAT, tube, limb, blob, mulberry32, vnoise, mixc } from "./mesh.js";
import { COL, COL_RGB, key } from "./logic.js";

export const TZ = 0;                 // tile top
export const BEAM_Z = 0.55;
export const toWorld = (lv, x, y) => [x - (lv.w - 1) / 2, y - (lv.h - 1) / 2];

export function buildIsland(O, A, W, lv, seed = 1) {
  const rnd = mulberry32(seed), voids = new Set((lv.voids || []).map(([x, y]) => key(x, y)));
  const solid = (x, y) => x >= 0 && y >= 0 && x < lv.w && y < lv.h && !voids.has(key(x, y));
  // tiles: slightly irregular slabs with bevels
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    if (!solid(x, y)) continue;
    const [wx, wy] = toWorld(lv, x, y), s = 0.47, b = 0.04, hz = (rnd() - 0.5) * 0.02;
    const col = mixc([0.42, 0.4, 0.46], [0.52, 0.48, 0.5], rnd());
    const top = [[wx - s + b, wy - s + b], [wx + s - b, wy - s + b], [wx + s - b, wy + s - b], [wx - s + b, wy + s - b]];
    O.quad([...top[0], hz, 1], [...top[1], hz, 1], [...top[2], hz, 1], [...top[3], hz, 1], col, MAT.MATTE);
    const bot = [[wx - s, wy - s], [wx + s, wy - s], [wx + s, wy + s], [wx - s, wy + s]];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; O.quad([...top[i], hz, 0.6], [...bot[i], hz - 0.06, 0.6], [...bot[j], hz - 0.06, 0.6], [...top[j], hz, 0.6], col.map((v) => v * 0.85), MAT.MATTE); }
    // grout / ground between tiles
    O.quad([wx - 0.5, wy - 0.5, -0.06, 1], [wx + 0.5, wy - 0.5, -0.06, 1], [wx + 0.5, wy + 0.5, -0.06, 1], [wx - 0.5, wy + 0.5, -0.06, 1], [0.18, 0.2, 0.14], MAT.MATTE);
    // edge: a rocky rim where the island ends
    for (let d = 0; d < 4; d++) {
      const nx = x + [0, 1, 0, -1][d], ny = y + [1, 0, -1, 0][d];
      if (solid(nx, ny)) continue;
      const ex = [0, 0.5, 0, -0.5][d], ey = [0.5, 0, -0.5, 0][d], tx = Math.abs(ey) > 0 ? 0.5 : 0, ty = Math.abs(ex) > 0 ? 0.5 : 0;
      O.quad([wx + ex - tx, wy + ey - ty, -0.06], [wx + ex + tx, wy + ey + ty, -0.06], [wx + ex * 1.08 + tx, wy + ey * 1.08 + ty, -0.7], [wx + ex * 1.08 - tx, wy + ey * 1.08 - ty, -0.7], [0.26, 0.24, 0.27], MAT.MATTE);
      if (rnd() < 0.5) blob(O, [wx + ex * 0.95, wy + ey * 0.95, -0.02], 0.22, 0.22, 0.09, [0.2, 0.36, 0.16], MAT.MOSS, 6, 3);
      if (rnd() < 0.18) { const fx = wx + ex * 1.02, fy = wy + ey * 1.02; W.quad([fx - ty * 0.18, fy - tx * 0.18, -0.06], [fx + ty * 0.18, fy + tx * 0.18, -0.06], [fx + ty * 0.18 + ex * 0.3, fy + tx * 0.18 + ey * 0.3, -3.5], [fx - ty * 0.18 + ex * 0.3, fy - tx * 0.18 + ey * 0.3, -3.5], [0.4, 0.55, 0.8], MAT.WATER); A.sprite(fx + ex * 0.3, fy + ey * 0.3, -3.4, 0.6, 0.06, 0.08, 0.12); }
    }
    // tufts of grass and tiny flowers
    if (rnd() < 0.35) for (let k = 0; k < 3; k++) { const gx = wx + (rnd() - 0.5) * 0.8, gy = wy + (rnd() - 0.5) * 0.8; limb(O, [gx, gy, -0.02], [gx + (rnd() - 0.5) * 0.06, gy + (rnd() - 0.5) * 0.06, 0.12 + rnd() * 0.08], 0.012, 0.002, [0.25, 0.45, 0.2], MAT.MOSS, 3); }
    if (rnd() < 0.1) { const gx = wx + (rnd() - 0.5) * 0.7, gy = wy + (rnd() - 0.5) * 0.7; A.sprite(gx, gy, 0.05, 0.05, 0.25, 0.3, 0.5); }
  }
  // underside: a tapering, rough cone of rock
  const R = Math.hypot(lv.w, lv.h) * 0.48, N = 28, rings = 7;
  for (let j = 0; j < rings; j++) for (let i = 0; i < N; i++) {
    const P = (ii, jj) => {
      const a = (ii / N) * Math.PI * 2, t = jj / rings, rr = R * (1 - Math.pow(t, 0.8) * 0.92) * (0.85 + 0.3 * vnoise(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + jj * 0.7, 5));
      const sx = Math.max(0.5, lv.w / Math.max(lv.w, lv.h)), sy = Math.max(0.5, lv.h / Math.max(lv.w, lv.h));
      return [Math.cos(a) * rr * sx * 1.05, Math.sin(a) * rr * sy * 1.05, -0.55 - t * R * 1.6 - (jj === rings ? 1 : 0)];
    };
    const c = mixc([0.26, 0.22, 0.28], [0.18, 0.15, 0.2], j / rings);
    O.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), c, MAT.MATTE);
  }
  // hanging roots
  for (let k = 0; k < 14; k++) { const a = rnd() * Math.PI * 2, r = R * (0.4 + rnd() * 0.5); let p = [Math.cos(a) * r, Math.sin(a) * r, -1 - rnd()]; for (let s = 0; s < 3; s++) { const q = [p[0] + (rnd() - 0.5) * 0.4, p[1] + (rnd() - 0.5) * 0.4, p[2] - 0.5 - rnd() * 0.6]; limb(O, p, q, 0.05 - s * 0.012, 0.035 - s * 0.01, [0.2, 0.14, 0.1], MAT.MATTE, 4); p = q; } }
}
// distant islets drifting in the void (built once)
export function buildBackdrop(O, A) {
  const rnd = mulberry32(77);
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2, d = 40 + rnd() * 90, x = Math.cos(a) * d, y = Math.sin(a) * d, z = -10 + rnd() * 25, s = 1.5 + rnd() * 5;
    blob(O, [x, y, z], s, s * 0.9, s * 0.25, [0.22, 0.3, 0.2], MAT.MOSS, 10, 4);
    tube(O, x, y, 10, s * 0.95, z - 0.2, 0, z - s * 2.4, [0.22, 0.2, 0.26], MAT.MATTE, rnd() * 6);
    if (rnd() < 0.5) A.sprite(x, y, z + 0.6, s * 0.5, 0.3, 0.22, 0.12);
  }
}

// ---------------------------------------------------------------- pieces
// anim: { a: mirror yaw (rad), bloom: 0..1, wrong: 0..1, pulse: 0..1, hover }
export function drawPiece(D, G, A, lv, p, an, time) {
  const [x, y] = toWorld(lv, p.x, p.y);
  const stone = [0.5, 0.47, 0.52], bronze = [0.85, 0.6, 0.32];
  if (p.t === "rock") { blob(D, [x, y, 0.18], 0.4, 0.36, 0.34, [0.34, 0.33, 0.36], MAT.MATTE, 8, 5, (i, j) => 0.85 + 0.3 * vnoise(i * 1.3 + p.x, j * 1.1 + p.y, 2)); blob(D, [x + 0.05, y, 0.42], 0.3, 0.26, 0.1, [0.2, 0.36, 0.16], MAT.MOSS, 7, 3); return; }
  if (p.t === "emit") {
    const c = COL_RGB[COL[p.c]], d = an.a;   // a = facing angle (animated)
    tube(D, x, y, 6, 0.3, 0, 0.24, 0.32, stone, MAT.MATTE, Math.PI / 6);
    tube(D, x, y, 6, 0.2, 0.32, 0.12, 1.15, [0.2, 0.2, 0.26], MAT.GLOSS, Math.PI / 6);
    // crystal head + aperture pointing along the beam
    const fx = Math.sin(d), fy = Math.cos(d);
    blob(D, [x, y, 1.25], 0.16, 0.16, 0.22, c.map((v) => v * 1.6), MAT.EMIT, 6, 4);
    limb(D, [x, y, BEAM_Z], [x + fx * 0.42, y + fy * 0.42, BEAM_Z], 0.08, 0.06, bronze, MAT.GLOSS, 8);
    blob(D, [x + fx * 0.44, y + fy * 0.44, BEAM_Z], 0.055, 0.055, 0.055, c.map((v) => v * 2), MAT.EMIT, 6, 3);
    A.sprite(x, y, 1.25, 0.9, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
    if (p.rot) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + time * 0.5; A.sprite(x + Math.sin(a) * 0.42, y + Math.cos(a) * 0.42, 0.04, 0.05, 0.4, 0.35, 0.6); }
    return;
  }
  if (p.t === "target") {
    const want = COL_RGB[COL[p.c]], b = an.bloom, wr = an.wrong;
    // basin + water + lily pad
    tube(D, x, y, 14, 0.42, -0.02, 0.4, 0.12, stone, MAT.MATTE, 0, false);
    G.water.push([x, y]);
    blob(D, [x, y, 0.1], 0.33, 0.33, 0.015, [0.18, 0.4, 0.16], MAT.MOSS, 10, 2);
    // petals: an outer ring of 8 and an inner ring of 6 that open as it blooms
    const shiver = wr * Math.sin(time * 40) * 0.06;
    for (const [n, len, wdt, base, open0, open1, z0] of [[8, 0.36, 0.13, 0.08, 0.35, 1.25, 0.12], [6, 0.28, 0.11, 0.05, 0.15, 0.85, 0.14]]) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (n === 6 ? 0.3 : 0), ca = Math.cos(a), sa = Math.sin(a), tilt = open0 + (open1 - open0) * b + shiver;
        const bx = x + ca * base, by = y + sa * base, tipR = Math.sin(tilt) * len, tipZ = Math.cos(tilt) * len;
        const mid = [bx + ca * tipR * 0.55, by + sa * tipR * 0.55, z0 + tipZ * 0.55 + 0.02];
        const tip = [bx + ca * tipR, by + sa * tipR, z0 + tipZ];
        const px = -sa * wdt, py = ca * wdt, glow = 0.15 + b * 1.1;
        D.v(bx - px * 0.3, by - py * 0.3, z0, glow * 0.5, ...want, MAT.PETAL); D.v(bx + px * 0.3, by + py * 0.3, z0, glow * 0.5, ...want, MAT.PETAL); D.v(mid[0] + px, mid[1] + py, mid[2], glow, ...want, MAT.PETAL);
        D.v(bx - px * 0.3, by - py * 0.3, z0, glow * 0.5, ...want, MAT.PETAL); D.v(mid[0] + px, mid[1] + py, mid[2], glow, ...want, MAT.PETAL); D.v(mid[0] - px, mid[1] - py, mid[2], glow, ...want, MAT.PETAL);
        D.v(mid[0] - px, mid[1] - py, mid[2], glow, ...want, MAT.PETAL); D.v(mid[0] + px, mid[1] + py, mid[2], glow, ...want, MAT.PETAL); D.v(...tip, glow * 1.2, ...want, MAT.PETAL);
      }
    }
    blob(D, [x, y, 0.2], 0.06, 0.06, 0.05, [1, 0.85, 0.4].map((v) => v * (0.6 + b)), MAT.EMIT, 6, 3);
    // a hint of the colour it wants, and a glow when blooming
    A.sprite(x, y, 0.25, 0.5 + b * 0.6, want[0] * (0.08 + b * 0.5), want[1] * (0.08 + b * 0.5), want[2] * (0.08 + b * 0.5));
    if (b > 0.5) { const r = ((time * 0.6 + p.x * 0.3) % 1); for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; A.sprite(x + Math.cos(a) * 0.2 * (1 + r), y + Math.sin(a) * 0.2 * (1 + r), 0.3 + r * 1.6, 0.05, want[0] * (1 - r), want[1] * (1 - r), want[2] * (1 - r)); } }
    return;
  }
  // pedestal for the optical pieces
  tube(D, x, y, 8, 0.24, 0, 0.18, 0.2, stone, MAT.MATTE, 0);
  tube(D, x, y, 8, 0.07, 0.2, 0.07, 0.3, bronze, MAT.GLOSS, 0);
  const a = an.a;   // the pane's yaw; the pane lies along (cos a, sin a)
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  if (p.t === "mirror" || p.t === "split") {
    const R = 0.36, N = 18, zc = BEAM_Z;
    // an inlaid groove on the tile shows the pane's diagonal from any viewing angle
    const gw = 0.025, gl = 0.46, frame = p.fixed ? [0.32, 0.3, 0.34] : bronze;
    D.quad([x - ux * gl - nx * gw, y - uy * gl - ny * gw, 0.012], [x + ux * gl - nx * gw, y + uy * gl - ny * gw, 0.012], [x + ux * gl + nx * gw, y + uy * gl + ny * gw, 0.012], [x - ux * gl + nx * gw, y - uy * gl + ny * gw, 0.012], frame, MAT.GLOSS);
    if (!p.fixed) for (const s of [-1, 1]) A.sprite(x + ux * gl * s, y + uy * gl * s, 0.03, 0.05, 0.25, 0.2, 0.08);
    const P = (t, r) => [x + ux * Math.cos(t) * r, y + uy * Math.cos(t) * r, zc + Math.sin(t) * r];
    for (let k = 0; k < N; k++) {
      const t0 = (k / N) * Math.PI * 2, t1 = ((k + 1) / N) * Math.PI * 2;
      if (p.t === "mirror") { D.tri([x, y, zc], P(t0, R * 0.9), P(t1, R * 0.9), [1, 1, 1], MAT.MIRROR); D.tri([x - nx * 0.03, y - ny * 0.03, zc], P(t1, R * 0.9).map((v, i) => v - [nx, ny, 0][i] * 0.03), P(t0, R * 0.9).map((v, i) => v - [nx, ny, 0][i] * 0.03), [0.35, 0.22, 0.12], MAT.GLOSS); }
      else G.glass.push([[x, y, zc], P(t0, R * 0.9), P(t1, R * 0.9), [0.4, 0.55, 0.7]]);
      // bronze rim
      const o0 = P(t0, R), o1 = P(t1, R), i0 = P(t0, R * 0.88), i1 = P(t1, R * 0.88);
      D.quad(i0, o0, o1, i1, frame, MAT.GLOSS);
    }
    limb(D, [x, y, 0.3], [x, y, zc - R * 0.88], 0.03, 0.03, bronze, MAT.GLOSS, 4);
    if (an.hover) A.sprite(x, y, 0.02, 0.6, 0.12, 0.1, 0.2);
    return;
  }
  if (p.t === "prism") {
    const h0 = 0.25, h1 = 0.95, r = 0.3, pts = [0, 1, 2].map((k) => { const t = a + (k / 3) * Math.PI * 2 + Math.PI / 2; return [x + Math.cos(t) * r, y + Math.sin(t) * r]; });
    for (let k = 0; k < 3; k++) { const p0 = pts[k], p1 = pts[(k + 1) % 3]; G.glass.push([[p0[0], p0[1], h0], [p1[0], p1[1], h0], [p1[0], p1[1], h1], [0.75, 0.8, 0.95]]); G.glass.push([[p0[0], p0[1], h0], [p1[0], p1[1], h1], [p0[0], p0[1], h1], [0.75, 0.8, 0.95]]); }
    G.glass.push([[...pts[0], h1], [...pts[1], h1], [...pts[2], h1], [0.6, 0.65, 0.8]]);
    for (const q of pts) limb(D, [q[0], q[1], h0], [q[0], q[1], h1], 0.015, 0.015, bronze, MAT.GLOSS, 3);
    const t = time * 0.8; A.sprite(x, y, BEAM_Z, 0.5, 0.3 + 0.2 * Math.sin(t), 0.3 + 0.2 * Math.sin(t + 2), 0.3 + 0.2 * Math.sin(t + 4));
    return;
  }
  if (p.t === "filter") {
    // a stained-glass gate standing across... both axes: a square frame facing the four directions isn't needed, the
    // gate is an arch whose pane faces the camera-independent X and Y (two crossed panes)
    const c = COL_RGB[COL[p.c] ?? p.c];
    for (const [vx, vy] of [[1, 0], [0, 1]]) {
      const w = 0.32, z0 = 0.25, z1 = 0.9;
      G.glass.push([[x - vx * w, y - vy * w, z0], [x + vx * w, y + vy * w, z0], [x + vx * w, y + vy * w, z1], c.map((v) => v * 1.6)]);
      G.glass.push([[x - vx * w, y - vy * w, z0], [x + vx * w, y + vy * w, z1], [x - vx * w, y - vy * w, z1], c.map((v) => v * 1.6)]);
      limb(D, [x - vx * w, y - vy * w, z0], [x - vx * w, y - vy * w, z1], 0.025, 0.025, bronze, MAT.GLOSS, 4);
      limb(D, [x + vx * w, y + vy * w, z0], [x + vx * w, y + vy * w, z1], 0.025, 0.025, bronze, MAT.GLOSS, 4);
      limb(D, [x - vx * w, y - vy * w, z1], [x + vx * w, y + vy * w, z1], 0.025, 0.025, bronze, MAT.GLOSS, 4);
    }
    A.sprite(x, y, 0.6, 0.6, c[0] * 0.15, c[1] * 0.15, c[2] * 0.15);
  }
}
