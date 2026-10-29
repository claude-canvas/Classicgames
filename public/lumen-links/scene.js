// Lumen Links scenery (DESIGN.md §4): builds one hole's island — green, fringe, sand, ponds, pits, curbs strung
// with fairy lights, lanterns, the windmill tower, lily pads, bushes — plus helpers for the cup and flag.
import { MAT, tube, limb, blob, mulberry32, vnoise, mixc } from "./mesh.js";
import { pointInPoly, CUP_R, heightAt } from "./physics.js";

export const FAIRY = [];      // fairy-light positions for the current hole (for twinkle + lights)
export const LANTERNS = [];

function distToEdges(x, y, poly) { let d = 1e9; for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length], dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy, s = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (L2 || 1))); d = Math.min(d, Math.hypot(x - x0 - dx * s, y - y0 - dy * s)); } return d; }

export function buildHole(O, A, W, hole) {
  FAIRY.length = 0; LANTERNS.length = 0;
  const rnd = mulberry32(hole.index * 101 + 7), F = hole.fairway, H = (x, y) => heightAt(hole, x, y);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of F) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inAny = (x, y, list) => (list || []).some((p) => pointInPoly(x, y, p));
  // ---- the green: a fine grid clipped to the fairway (cells under water / pits are skipped)
  const S = 0.1;
  for (let y = y0; y < y1 - 1e-6; y += S) for (let x = x0; x < x1 - 1e-6; x += S) {
    const cx = x + S / 2, cy = y + S / 2;
    if (!pointInPoly(cx, cy, F) || inAny(cx, cy, hole.water) || inAny(cx, cy, hole.pits)) continue;
    const fr = distToEdges(cx, cy, F) < 0.14 ? 1 : 0, sand = inAny(cx, cy, hole.sand);
    const P = (px, py) => [px, py, H(px, py), fr];
    if (sand) O.quad(P(x, y), P(x + S, y), P(x + S, y + S), P(x, y + S), mixc([0.75, 0.66, 0.45], [0.82, 0.72, 0.5], rnd()), MAT.MATTE);
    else O.quad(P(x, y), P(x + S, y), P(x + S, y + S), P(x, y + S), [1, 1, 1], MAT.GREEN);
  }
  // ---- island ground around the course
  const M = 2.2, G = 0.3;
  for (let y = y0 - M; y < y1 + M; y += G) for (let x = x0 - M; x < x1 + M; x += G) {
    const cx = x + G / 2, cy = y + G / 2;
    if (pointInPoly(cx, cy, F) && !inAny(cx, cy, hole.pits)) continue;
    const ex = Math.max(0, x0 - cx, cx - x1) / M, ey = Math.max(0, y0 - cy, cy - y1) / M, edge = Math.max(ex, ey);
    if (edge > 1) continue;
    const z = (q, r) => -0.14 - Math.max(0, Math.max(Math.max(0, x0 - q, q - x1) / M, Math.max(0, y0 - r, r - y1) / M) - 0.75) * 1.2 + (vnoise(q * 2, r * 2, 4) - 0.5) * 0.05;
    if (inAny(cx, cy, hole.pits)) { O.quad([x, y, -0.7], [x + G, y, -0.7], [x + G, y + G, -0.7], [x, y + G, -0.7], [0.02, 0.02, 0.05], MAT.MATTE); continue; }
    O.quad([x, y, z(x, y)], [x + G, y, z(x + G, y)], [x + G, y + G, z(x + G, y + G)], [x, y + G, z(x, y + G)], mixc([0.08, 0.2, 0.08], [0.12, 0.26, 0.1], rnd()), MAT.FOLIAGE);
  }
  // rocky underside of the floating island
  const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2, rx = (x1 - x0) / 2 + M, ry = (y1 - y0) / 2 + M, N = 26;
  for (let j = 0; j < 5; j++) for (let i = 0; i < N; i++) {
    const P = (ii, jj) => { const a = (ii / N) * Math.PI * 2, t = jj / 5, k = (1 - t * 0.85) * (0.9 + 0.2 * vnoise(Math.cos(a) * 2, Math.sin(a) * 2 + jj, 3)); return [cxm + Math.cos(a) * rx * k * 0.98, cym + Math.sin(a) * ry * k * 0.98, -0.4 - t * (rx + ry) * 0.45]; };
    O.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), mixc([0.28, 0.22, 0.24], [0.18, 0.15, 0.18], j / 5), MAT.STONE);
  }
  // ---- ponds and bridges
  for (const p of hole.water || []) {
    let cx = 0, cy = 0; for (const [x, y] of p) { cx += x; cy += y; } cx /= p.length; cy /= p.length;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; W.tri([cx, cy, -0.05], [a[0], a[1], -0.05], [b[0], b[1], -0.05], [0.05, 0.12, 0.16], MAT.WATER); O.quad([a[0], a[1], 0.0], [b[0], b[1], 0.0], [b[0], b[1], -0.12], [a[0], a[1], -0.12], [0.3, 0.28, 0.26], MAT.STONE); }
  }
  for (const p of hole.bridges || []) {
    const [a, b, c, d] = p, z = 0.002;
    A.quad([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [d[0], d[1], z], [0.05, 0.08, 0.1], MAT.ADD);
    for (const [u, v] of [[a, d], [b, c]]) { const L = Math.hypot(v[0] - u[0], v[1] - u[1]); for (let s = 0; s <= L; s += 0.25) { const t = s / L; A.sprite(u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, 0.03, 0.04, 0.4, 0.7, 1.0); } }
  }
  for (const [x, y] of hole.lilies || []) { blob(O, [x, y, -0.035], 0.22, 0.18, 0.01, [0.15, 0.38, 0.14], MAT.FOLIAGE, 9, 2); blob(O, [x + 0.04, y, -0.0], 0.05, 0.05, 0.04, [1, 0.75, 0.85], MAT.FOLIAGE, 6, 3); A.sprite(x + 0.04, y, 0.03, 0.12, 0.2, 0.12, 0.16); }
  // ---- curbs with fairy lights
  for (const [ax, ay, bx, by] of hole.staticWalls) {
    const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * 0.045, ny = ux * 0.045;
    const za = Math.max(H(ax, ay), 0) , zb = Math.max(H(bx, by), 0), hgt = 0.11;
    const p = (x, y, z) => [x, y, z];
    const c = mixc([0.62, 0.6, 0.58], [0.7, 0.68, 0.64], rnd());
    O.quad(p(ax - nx, ay - ny, za + hgt), p(bx - nx, by - ny, zb + hgt), p(bx + nx, by + ny, zb + hgt), p(ax + nx, ay + ny, za + hgt), c, MAT.STONE);
    O.quad(p(ax - nx, ay - ny, za - 0.15), p(bx - nx, by - ny, zb - 0.15), p(bx - nx, by - ny, zb + hgt), p(ax - nx, ay - ny, za + hgt), c.map((v) => v * 0.85), MAT.STONE);
    O.quad(p(ax + nx, ay + ny, za - 0.15), p(bx + nx, by + ny, zb - 0.15), p(bx + nx, by + ny, zb + hgt), p(ax + nx, ay + ny, za + hgt), c.map((v) => v * 0.85), MAT.STONE);
    for (let s = 0.15; s < L; s += 0.32) { const t = s / L; FAIRY.push([ax + (bx - ax) * t, ay + (by - ay) * t, za + (zb - za) * t + hgt + 0.025, rnd()]); }
  }
  // ---- lanterns on posts
  for (const [x, y] of hole.lanterns || []) {
    const z = Math.max(0, H(x, y)) - 0.02;
    tube(O, x, y, 6, 0.025, z, 0.022, z + 0.75, [0.22, 0.14, 0.08], MAT.MATTE);
    limb(O, [x, y, z + 0.74], [x, y, z + 0.78], 0.06, 0.06, [0.2, 0.12, 0.08], MAT.MATTE, 6);
    const N = 10, r = 0.075, h0 = z + 0.55, hh = 0.17;
    for (let k = 0; k < N; k++) { const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, bul = (t) => r * (1 + 0.25 * Math.sin(t * Math.PI)); for (let j = 0; j < 2; j++) { const t0 = j / 2, t1 = (j + 1) / 2; const P = (a, t) => [x + Math.cos(a) * bul(t), y + Math.sin(a) * bul(t), h0 + t * hh, 1.3]; O.quad(P(a0, t0), P(a1, t0), P(a1, t1), P(a0, t1), [1, 0.55, 0.25], MAT.PAPER); } }
    A.sprite(x, y, h0 + hh / 2, 0.5, 0.35, 0.18, 0.06); LANTERNS.push([x, y, h0 + hh / 2]);
  }
  // ---- windmill tower behind the tunnel
  if (hole.windmill) {
    const [wx, wy] = hole.windmill;
    const tw = 0.32, tz0 = 0, tz1 = 1.1;
    for (const [sx, sy, ex, ey] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) O.quad([wx + sx * tw, wy + sy * tw, tz0], [wx + ex * tw, wy + ey * tw, tz0], [wx + ex * tw * 0.75, wy + ey * tw * 0.75, tz1], [wx + sx * tw * 0.75, wy + sy * tw * 0.75, tz1], [0.55, 0.38, 0.24], MAT.MATTE);
    tube(O, wx, wy, 4, tw * 1.05, tz1, 0, tz1 + 0.45, [0.5, 0.16, 0.12], MAT.GLOSS, Math.PI / 4);
    O.quad([wx - 0.2, wy - tw - 0.001, 0.0], [wx + 0.2, wy - tw - 0.001, 0.0], [wx + 0.2, wy - tw - 0.001, 0.22], [wx - 0.2, wy - tw - 0.001, 0.22], [0.03, 0.02, 0.02], MAT.MATTE);
    O.quad([wx - 0.08, wy - tw * 0.8, 0.6], [wx + 0.08, wy - tw * 0.8, 0.6], [wx + 0.08, wy - tw * 0.8, 0.75], [wx - 0.08, wy - tw * 0.8, 0.75], [1.4, 0.8, 0.35], MAT.EMIT);
  }
  // ---- star around the final cup
  if (hole.star) { const [sx, sy] = hole.star, pts = []; for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.32 : 0.75; pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]); } for (let k = 0; k < 10; k++) { const a = pts[k], b = pts[(k + 1) % 10]; for (let s = 0; s <= 1; s += 0.2) { const x = a[0] + (b[0] - a[0]) * s, y = a[1] + (b[1] - a[1]) * s; A.sprite(x, y, H(x, y) + 0.01, 0.035, 0.6, 0.5, 0.2); } } }
  // ---- bushes and flowers around the course
  for (let k = 0; k < 40; k++) {
    const x = x0 - M * 0.8 + rnd() * (x1 - x0 + M * 1.6), y = y0 - M * 0.8 + rnd() * (y1 - y0 + M * 1.6);
    if (pointInPoly(x, y, F) || distToEdges(x, y, F) < 0.25) continue;
    const s = 0.12 + rnd() * 0.22; blob(O, [x, y, -0.1 + s * 0.5], s, s, s * 0.8, mixc([0.1, 0.28, 0.12], [0.18, 0.36, 0.14], rnd()), MAT.FOLIAGE, 7, 4);
    if (rnd() < 0.4) { const c = [[1, 0.5, 0.7], [0.7, 0.6, 1], [1, 0.85, 0.4]][Math.floor(rnd() * 3)]; A.sprite(x, y, -0.1 + s * 1.3, 0.05, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3); }
  }
}
// the cup, rim and flag (drawn into the dynamic mesh so the flag can lift)
export function drawCup(D, A, hole, lift, time) {
  const [x, y] = hole.cup, z = heightAt(hole, x, y);
  const N = 16;
  for (let k = 0; k < N; k++) { const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2; D.tri([x, y, z + 0.0015], [x + Math.cos(a0) * CUP_R, y + Math.sin(a0) * CUP_R, z + 0.0015], [x + Math.cos(a1) * CUP_R, y + Math.sin(a1) * CUP_R, z + 0.0015], [0.01, 0.01, 0.01], MAT.MATTE); D.quad([x + Math.cos(a0) * CUP_R, y + Math.sin(a0) * CUP_R, z + 0.002], [x + Math.cos(a1) * CUP_R, y + Math.sin(a1) * CUP_R, z + 0.002], [x + Math.cos(a1) * (CUP_R + 0.012), y + Math.sin(a1) * (CUP_R + 0.012), z + 0.002], [x + Math.cos(a0) * (CUP_R + 0.012), y + Math.sin(a0) * (CUP_R + 0.012), z + 0.002], [0.9, 0.9, 0.88], MAT.GLOSS); }
  const pz = z + lift;
  limb(D, [x, y, pz], [x, y, pz + 0.85], 0.008, 0.008, [0.9, 0.85, 0.7], MAT.GLOSS, 4);
  const wave = Math.sin(time * 3) * 0.03;
  D.quad([x, y, pz + 0.85], [x + 0.22, y + wave, pz + 0.8], [x + 0.22, y + wave, pz + 0.68], [x, y, pz + 0.7], [0.85, 0.15, 0.25], MAT.MATTE);
  A.sprite(x, y, pz + 0.9, 0.12, 0.6, 0.45, 0.2);
  A.sprite(x, y, z + 0.02, 0.18, 0.08, 0.07, 0.03);
}
