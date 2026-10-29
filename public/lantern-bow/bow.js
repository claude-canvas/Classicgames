// Lantern Bow: the first-person yumi and the arrows (DESIGN.md §5).
// The bow is built every frame in world space from the camera basis (E eye, f forward, r right, u up).
import { MAT, limb, blob, mixc } from "./mesh.js";

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function basis(yaw, pitch) {
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  return { f, r, u };
}

// draw: 0..1, spin: 0..1 (yugaeri: the bow turning in the hand after the shot), hasArrow
export function drawBow(D, E, B, draw, spin, hasArrow, t) {
  const { f, r, u } = B;
  // the bow plane turns about the vertical through the grip during yugaeri
  const ang = spin * Math.PI * 0.9, cs = Math.cos(ang), sn = Math.sin(ang);
  const fr = [f[0] * cs + r[0] * sn, f[1] * cs + r[1] * sn, f[2] * cs + r[2] * sn];
  const G = add(add(add(E, f, 0.82), r, -0.27), u, -0.1);            // grip (left hand), well left of the sight line
  const pt = (s) => {                                                  // s: −0.85 (lower tip) … +1.45 (upper tip)
    const L = s > 0 ? 1.45 : 0.85, q = s / L, bend = (0.16 + 0.13 * draw) * q * q;
    const flick = Math.max(0, Math.abs(q) - 0.88) * 0.9;              // recurved tips
    return add(add(add(G, u, s), fr, -bend + flick), r, -0.02 * q);
  };
  const N = 26, pts = []; for (let k = 0; k <= N; k++) pts.push(pt(-0.85 + (k / N) * 2.3));
  const lac = [0.13, 0.07, 0.05], bamboo = [0.55, 0.36, 0.18], grip = [0.62, 0.42, 0.28], band = [0.86, 0.8, 0.66];
  for (let k = 0; k < N; k++) {
    const s = -0.85 + ((k + 0.5) / N) * 2.3, onGrip = s > -0.1 && s < 0.12, isBand = Math.abs(((s * 7) % 1 + 1) % 1 - 0.5) < 0.05;
    const c = onGrip ? grip : isBand ? band : k % 3 === 0 ? bamboo : lac;
    limb(D, pts[k], pts[k + 1], onGrip ? 0.012 : 0.0085, onGrip ? 0.012 : 0.008, c, MAT.GLOSS, 6);
  }
  // string: tips → nock point (pulled back toward the cheek)
  const top = pts[N], bot = pts[0];
  const rest = add(add(G, fr, -0.2), r, 0.03), cheek = add(add(add(E, f, 0.14), r, 0.07), u, -0.09);
  const nock = lerp3(rest, cheek, draw);
  limb(D, top, nock, 0.0012, 0.0012, [0.95, 0.92, 0.84], MAT.MATTE, 3);
  limb(D, nock, bot, 0.0012, 0.0012, [0.95, 0.92, 0.84], MAT.MATTE, 3);
  // hands: glove at the nock, bow hand on the grip
  if (draw > 0.05) blob(D, add(add(nock, r, 0.03), u, -0.01), 0.022, 0.026, 0.03, [0.42, 0.28, 0.18], MAT.MATTE, 10, 7);
  blob(D, add(G, r, 0.01), 0.018, 0.022, 0.036, [0.84, 0.64, 0.5], MAT.MATTE, 10, 7);
  if (hasArrow) {
    const pass = add(add(G, r, 0.016), fr, 0.01), dir = norm([pass[0] - nock[0], pass[1] - nock[1], pass[2] - nock[2]]);
    drawArrow(D, nock, dir, 1.0, B);
  }
  return nock;
}

// an arrow lying along dir from the nock end p (length L)
export function drawArrow(D, p, dir, L = 1.0, B = null) {
  const tip = add(p, dir, L);
  limb(D, add(p, dir, 0.02), add(tip, dir, -0.06), 0.0055, 0.0055, [0.74, 0.6, 0.38], MAT.MATTE, 4);
  limb(D, add(tip, dir, -0.06), tip, 0.0065, 0.0, [0.7, 0.72, 0.76], MAT.GLOSS, 4);
  // fletching: three feathers near the nock (hawk-banded)
  const side = norm(cross(dir, Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), up = cross(side, dir);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3, o = add([0, 0, 0], side, Math.cos(a)), w = add(o, up, Math.sin(a));
    const f0 = add(p, dir, 0.04), f1 = add(p, dir, 0.2);
    const c = k === 0 ? [0.9, 0.86, 0.78] : [0.36, 0.24, 0.16];
    D.quad(f0, f1, add(f1, w, 0.016), add(f0, w, 0.028), c, MAT.MATTE);
    D.quad(add(f0, dir, 0.06), add(f0, dir, 0.08), add(add(f0, dir, 0.08), w, 0.025), add(add(f0, dir, 0.06), w, 0.027), [0.12, 0.1, 0.08], MAT.MATTE);
  }
  limb(D, p, add(p, dir, 0.02), 0.006, 0.006, [0.2, 0.12, 0.1], MAT.MATTE, 4);
}
