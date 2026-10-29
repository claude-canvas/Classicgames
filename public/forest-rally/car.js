// Forest Rally — the toy rally car (DESIGN.md §5): model, driving physics on the road surfaces, and pose.
// Model frame: x right, y forward, z up; about 1.0 m long, so the forest track feels wide and the canopy stays high
// above it. GPU-skinned like the characters: bone 0 = body, bones 1–4 = wheels (front left, front right, rear left,
// rear right), each wheel built around its own axle so it can spin and the front pair can steer.
import { Mesh, blob, limb, smoothNormals } from "./mesh.js";

const SOFT = 1, MATTE = 0;
// the model is authored at 1 m long and scaled by SC: 0.75 m fits the narrow fenced bends comfortably
export const SC = 0.75;
const BASE_WHEELS = [[-0.26, 0.33], [0.26, 0.33], [-0.26, -0.3], [0.26, -0.3]], BASE_R = 0.12;
export const WHEELS = BASE_WHEELS.map(([x, y]) => [x * SC, y * SC]);
export const WHEEL_R = BASE_R * SC;
// the wheel contact points are checked a little outside the wheels (× SPREAD), a small safety margin at the road edge
export const SPREAD = 1.05;
function tag(m, from, bone) { for (let i = from; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + bone; }
function box(m, c, hx, hy, hz, col, mat) {
  const P = (a, b, d) => [c[0] + a * hx, c[1] + b * hy, c[2] + d * hz];
  m.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), col, mat); m.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), col, mat);
  m.quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), col, mat); m.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), col, mat);
  m.quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), col, mat); m.quad(P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), col, mat);
}
export function buildCar() {
  const m = new Mesh(20000), RED = [0.92, 0.16, 0.12], DARK = [0.08, 0.08, 0.1], WHITE = [0.96, 0.95, 0.92], GLASS = [0.18, 0.3, 0.42], YEL = [1, 0.82, 0.2];
  let f = m.n;
  // rounded body, a cabin bubble, bumpers, stripes, lights, spoiler and a little driver's helmet
  blob(m, [0, 0.02, 0.2], 0.27, 0.5, 0.12, RED, SOFT, 18, 10);
  blob(m, [0, 0.0, 0.26], 0.25, 0.42, 0.1, RED, SOFT, 18, 10);
  blob(m, [0, -0.08, 0.36], 0.19, 0.22, 0.12, GLASS, SOFT, 16, 10);
  blob(m, [0, -0.06, 0.4], 0.17, 0.18, 0.1, RED, SOFT, 16, 8, (i, j) => (j > 4 ? 0.0001 : 1));
  for (const sx of [-0.05, 0.05]) box(m, [sx, 0.12, 0.315], 0.018, 0.3, 0.004, WHITE, SOFT);
  box(m, [0, 0.5, 0.14], 0.24, 0.035, 0.045, DARK, MATTE); box(m, [0, -0.48, 0.15], 0.24, 0.035, 0.05, DARK, MATTE);
  for (const sx of [-0.15, 0.15]) { blob(m, [sx, 0.5, 0.21], 0.04, 0.02, 0.03, [2.2, 2.1, 1.8], 5, 8, 5); blob(m, [sx, -0.5, 0.21], 0.04, 0.02, 0.025, [1.6, 0.1, 0.08], 5, 8, 5); }
  box(m, [0, -0.46, 0.38], 0.25, 0.05, 0.012, DARK, MATTE);
  for (const sx of [-0.18, 0.18]) limb(m, [sx, -0.44, 0.27], [sx, -0.46, 0.37], 0.015, 0.015, DARK, MATTE, 5);
  // the helmet and aerial last, as one vertex range the first-person view can skip (it would sit in the camera)
  const hideFrom = m.n;
  blob(m, [0, -0.1, 0.44], 0.07, 0.07, 0.07, YEL, SOFT, 12, 8);
  limb(m, [0.18, -0.05, 0.42], [0.2, -0.05, 0.62], 0.004, 0.004, DARK, MATTE, 3); blob(m, [0.2, -0.05, 0.63], 0.02, 0.02, 0.02, YEL, SOFT, 6, 4);
  const hideTo = m.n;
  tag(m, f, 0);
  // wheels: tyre, rim and hub around the x axle (local origin = wheel centre)
  BASE_WHEELS.forEach(([wx], i) => {
    f = m.n; const s = Math.sign(wx);
    const R = BASE_R, W = 0.09, N = 16;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, P = (x, a, r) => [x, Math.cos(a) * r, Math.sin(a) * r];
      m.quad(P(-W / 2, a0, R), P(W / 2, a0, R), P(W / 2, a1, R), P(-W / 2, a1, R), DARK, MATTE);
      for (const x of [-W / 2, W / 2]) m.tri([x, 0, 0], P(x, a0, R), P(x, a1, R), DARK, MATTE);
      m.tri([s * (W / 2 + 0.002), 0, 0], P(s * (W / 2 + 0.002), a0, R * 0.62), P(s * (W / 2 + 0.002), a1, R * 0.62), k % 4 < 2 ? [0.85, 0.85, 0.88] : [0.5, 0.5, 0.55], SOFT);
    }
    blob(m, [s * (W / 2 + 0.01), 0, 0], 0.02, 0.025, 0.025, YEL, SOFT, 8, 5);
    tag(m, f, 1 + i);
  });
  for (let i = 0; i < m.n; i++) { m.pos[i * 4] *= SC; m.pos[i * 4 + 1] *= SC; m.pos[i * 4 + 2] *= SC; }
  return { m, nrm: smoothNormals(m.pos, m.n), hideFrom, hideTo };
}

// ------------------------------------------------------------------ driving
// state: x, y, z, h (heading), v (forward speed), slip (lateral speed), steer, spin, pitch, roll
export function makeCar(x, y, z, h) { return { x, y, z, h, v: 0, slip: 0, steer: 0, spin: 0, pitch: 0, roll: 0, hit: 0, bump: 0 }; }
const VMAX = 11, VREV = -4, ACC = 8, BRAKE = 16, DRAG = 0.35, WB = 0.63 * SC, YAW_MAX = 2.1;
// all four wheels on the road within 0.45 m of height z and the footprint clear of walls, at pose (x, y, h);
// returns the four wheel heights, or null. why (optional) collects the reason it failed
export function fitsPose(x, y, h, z, road, wall, why = null) {
  const fx = Math.cos(h), fy = Math.sin(h), rx = Math.sin(h), ry = -Math.cos(h), hs = [];
  for (const [wx, wy] of WHEELS) {
    const px = x + (rx * wx + fx * wy) * SPREAD, py = y + (ry * wx + fy * wy) * SPREAD, g = road(px, py, z + 0.35);
    if (g === null || Math.abs(g - z) > 0.45 || wall(px, py, g)) { if (why) why.push(['wheel', +px.toFixed(2), +py.toFixed(2), g]); return null; }
    hs.push(g);
  }
  // walls across the whole footprint (a 3 × 4 grid), so a thin fence rail can't slip between the axles
  const zc = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
  for (const ox of [-0.3 * SC, 0, 0.3 * SC]) for (const oy of [-0.5 * SC, -0.17 * SC, 0.17 * SC, 0.5 * SC]) if (wall(x + rx * ox + fx * oy, y + ry * ox + fy * oy, zc)) { if (why) why.push(['body', ox, oy]); return null; }
  return hs;
}

// road(x, y, z) → surface height or null; wall(x, y, z) → true if blocked. Returns the bump strength (for effects).
export function stepCar(c, inp, dt, road, wall) {
  // throttle / brake / reverse
  if (inp.gas > 0) c.v += (c.v < 0 ? BRAKE : ACC * (1 - Math.max(0, c.v) / VMAX)) * inp.gas * dt;
  else if (inp.brake > 0) c.v -= (c.v > 0.3 ? BRAKE : (c.v > VREV ? ACC * 0.6 : 0)) * inp.brake * dt;
  else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (DRAG + Math.abs(c.v) * 0.05) * dt * 3);
  if (inp.hand) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), 6 * dt);
  // steering: the lock is limited so the car never turns faster than YAW_MAX, and the wheel turns in gradually;
  // the handbrake loosens the rear and lets it slide
  const maxSteer = Math.min(0.55, Math.atan((YAW_MAX * WB) / Math.max(Math.abs(c.v), 0.1)));
  c.steer += (inp.steer * maxSteer - c.steer) * Math.min(1, dt * 4.5);
  const yaw = (c.v * Math.tan(c.steer)) / WB;
  c.h += yaw * dt * (inp.hand ? 1.35 : 1);
  c.slip += (-yaw * c.v * 0.04 * (inp.hand ? 3 : 1) - c.slip) * Math.min(1, dt * (inp.hand ? 2 : 6));
  // move, keeping all four wheels on the road
  const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = Math.sin(c.h), ry = -Math.cos(c.h);
  const dx = (fx * c.v + rx * c.slip) * dt, dy = (fy * c.v + ry * c.slip) * dt;
  const fitsH = (x, y, h) => fitsPose(x, y, h, c.z, road, wall);
  const fits = (x, y) => fitsH(x, y, c.h);
  // how many wheels are on the road (used to climb back from a bad spot)
  const onRoad = (x, y) => { let k = 0; for (const [wx, wy] of WHEELS) { const px = x + (rx * wx + fx * wy) * SPREAD, py = y + (ry * wx + fy * wy) * SPREAD, g = road(px, py, c.z + 0.35); if (g !== null && Math.abs(g - c.z) <= 0.45 && !wall(px, py, g)) k++; } return k; };
  let hs = fits(c.x + dx, c.y + dy), bump = 0;
  if (hs) { c.x += dx; c.y += dy; }
  else if (!fits(c.x, c.y)) {
    // in a bad spot (spawned or pushed there): hop to the nearest spot where all four wheels fit, else only
    // allow moves that put more wheels on the road — never free movement off the track
    let found = null;
    for (let r = 0.1; r <= 2 && !found; r += 0.1) for (let a = 0; a < 6.283 && !found; a += 0.4) { const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r, f = fits(x, y); if (f) found = [x, y, f]; }
    if (found) { c.x = found[0]; c.y = found[1]; hs = found[2]; }
    else if (onRoad(c.x + dx, c.y + dy) > onRoad(c.x, c.y)) { c.x += dx; c.y += dy; }
    else c.v *= 0.5;
  } else {
    // slide along the edge, whatever its angle: try the move turned progressively further from the blocked
    // direction (nearest side first), shortened by the cosine; speed bleeds off with how sharp the deflection is
    const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    let slide = null;
    for (const a of [0.2, -0.2, 0.4, -0.4, 0.65, -0.65, 0.9, -0.9, 1.2, -1.2, 1.45, -1.45]) {
      const l = len * Math.cos(a), mx = Math.cos(ang + a) * l, my = Math.sin(ang + a) * l, f = fits(c.x + mx, c.y + my);
      if (f) { slide = [mx, my, f, a]; break; }
    }
    bump = Math.abs(c.v) * (slide ? Math.sin(Math.abs(slide[3])) : 1);
    if (slide) {
      const [mx, my, f, a] = slide;
      c.x += mx; c.y += my; hs = f;
      c.v *= Math.exp(-dt * 6 * (1 - Math.cos(a))); c.slip *= 0.5;
      // driving forward: turn gently toward the free direction
      if (c.v > 0.5) { let d = Math.atan2(my, mx) - c.h; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; c.h += d * Math.min(1, dt * 4); }
    } else {
      // pressed into it at an angle (a fence corner): with the pedal down, pivot toward the side that frees the way
      // (at most 2 rad/s), scraping along instead of stopping dead
      const dir = Math.sign(c.v) || 1, step = 2 * dt;
      let side = 0;
      if (inp.gas > 0 || inp.brake > 0) for (const k of [1, 3, 6, 12, 20]) for (const s of [1, -1]) {
        const h = c.h + s * step * k;
        if (!side && fitsH(c.x, c.y, h) && fitsH(c.x + Math.cos(h) * dir * 0.06, c.y + Math.sin(h) * dir * 0.06, h)) side = s;
      }
      // a bend's outer edge can make a pocket where neither sliding nor turning on the spot fits, but turning while
      // moving on does: try the move along a turned direction with the car turned (half, then all the way) to match
      let turnMove = null;
      if (!side && Math.abs(c.v) > 0.05) for (const a of [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.45, -1.45]) for (const part of [0.5, 1]) {
        const h = c.h + a * part, l = Math.max(len, 0.03), d = Math.atan2(dy, dx) + a, f = !turnMove && fitsH(c.x + Math.cos(d) * l, c.y + Math.sin(d) * l, h);
        if (f) turnMove = [c.x + Math.cos(d) * l, c.y + Math.sin(d) * l, h, f, a];
      }
      if (side && fitsH(c.x, c.y, c.h + side * step)) {
        c.h += side * step; hs = fits(c.x, c.y);
        c.v *= Math.exp(-dt * 5); c.slip = 0;
      } else if (turnMove) {
        [c.x, c.y, c.h, hs] = turnMove;
        c.v *= Math.exp(-dt * 6 * (1 - Math.cos(turnMove[4]))); c.slip = 0;
      } else {
        // truly head-on: stop with a tiny bounce (no sign flipping every step)
        hs = fits(c.x, c.y);
        c.v = c.v > 0 ? Math.max(-0.4, -c.v * 0.15) : Math.min(0.4, -c.v * 0.15); c.slip = 0;
      }
    }
  }
  if (hs) {
    // sit on the road: height from the four wheels, pitch and roll from their differences
    const [fl, fr, rl, rr] = hs, z = (fl + fr + rl + rr) / 4;
    c.z += (z - c.z) * Math.min(1, dt * 18);
    c.pitch += (Math.atan2((fl + fr) / 2 - (rl + rr) / 2, (WHEELS[0][1] - WHEELS[2][1]) * SPREAD) - c.pitch) * Math.min(1, dt * 12);
    c.roll += (Math.atan2((fr + rr) / 2 - (fl + rl) / 2, (WHEELS[1][0] - WHEELS[0][0]) * SPREAD) - c.roll) * Math.min(1, dt * 12);
  }
  c.spin += (c.v / 0.12) * dt;
  c.hit = Math.max(0, c.hit - dt);
  if (bump > 2) c.hit = 0.25;
  return bump;
}

// 3×4 row-major affine matrices for the bones
export const MX = {
  mul: (A, B) => [A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
};
