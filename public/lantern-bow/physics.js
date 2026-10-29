// Lantern Bow ballistics (pure, DESIGN.md §2). World: metres, z up, range along +y.
export const G = 9.81, K_DRAG = 0.0016, K_WIND = 0.55, V0 = 54;
export const launchSpeed = (power) => V0 * Math.pow(Math.max(0.25, power), 0.75);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// advance an arrow state {p, v} by dt (sub-stepped) under gravity, drag and crosswind; wind = [wx, wy, 0]
export function stepArrow(a, dt, wind) {
  const n = Math.max(1, Math.ceil(dt / 0.001)), h = dt / n;
  for (let k = 0; k < n; k++) {
    const v = a.v, sp = len(v) || 1e-6;
    const rel = sub(v, wind), rs = len(rel);
    // crosswind: the part of the wind perpendicular to the flight direction pushes the arrow sideways
    const d = [v[0] / sp, v[1] / sp, v[2] / sp], wd = dot(wind, d);
    const wp = [wind[0] - wd * d[0], wind[1] - wd * d[1], wind[2] - wd * d[2]];
    const ax = -K_DRAG * rs * rel[0] + K_WIND * wp[0], ay = -K_DRAG * rs * rel[1] + K_WIND * wp[1], az = -K_DRAG * rs * rel[2] + K_WIND * wp[2] - G;
    v[0] += ax * h; v[1] += ay * h; v[2] += az * h;
    a.p[0] += v[0] * h; a.p[1] += v[1] * h; a.p[2] += v[2] * h;
  }
}

// segment p0→p1 against a disc (centre c, unit normal nrm, radius r) → {t, point, rad} or null
export function segDisc(p0, p1, c, nrm, r) {
  const d = sub(p1, p0), den = dot(d, nrm);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(c, p0), nrm) / den;
  if (t < 0 || t > 1) return null;
  const q = [p0[0] + d[0] * t, p0[1] + d[1] * t, p0[2] + d[2] * t], rad = len(sub(q, c));
  return rad <= r ? { t, point: q, rad } : null;
}
// segment against a vertical capsule-ish lantern: cylinder radius r from z0 to z1 around (cx, cy)
export function segLantern(p0, p1, c, r, h) {
  const steps = 8;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, q = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
    if (Math.hypot(q[0] - c[0], q[1] - c[1]) < r && q[2] > c[2] - h / 2 && q[2] < c[2] + h / 2) return { t, point: q };
  }
  return null;
}

// aim direction from yaw (around z, 0 = +y) and pitch (up positive)
export const aimDir = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];

// trajectory preview for the aim guide: points until the arrow passes maxY or hits the ground
export function predict(origin, yaw, pitch, power, wind, maxY = 60, dt = 0.02) {
  const d = aimDir(yaw, pitch), s = launchSpeed(power);
  const a = { p: origin.slice(), v: [d[0] * s, d[1] * s, d[2] * s] }, pts = [a.p.slice()];
  for (let i = 0; i < 400; i++) { stepArrow(a, dt, wind); pts.push(a.p.slice()); if (a.p[2] < 0 || a.p[1] > maxY) break; }
  return pts;
}
// where the arrow crosses the plane y = Y (for the guide marker and the bot)
export function crossAt(origin, yaw, pitch, power, wind, Y) {
  const d = aimDir(yaw, pitch), s = launchSpeed(power);
  const a = { p: origin.slice(), v: [d[0] * s, d[1] * s, d[2] * s] };
  let prev = a.p.slice();
  for (let i = 0; i < 4000; i++) {
    stepArrow(a, 0.005, wind);
    if (a.p[1] >= Y) { const t = (Y - prev[1]) / (a.p[1] - prev[1]); return [prev[0] + (a.p[0] - prev[0]) * t, Y, prev[2] + (a.p[2] - prev[2]) * t]; }
    if (a.p[2] < -5) return null;
    prev = a.p.slice();
  }
  return null;
}
// aiming solver (bot / tests): yaw & pitch that put the arrow on point P at full power
export function solveAim(origin, P, wind, power = 1) {
  let yaw = Math.atan2(P[0] - origin[0], P[1] - origin[1]), pitch = Math.atan2(P[2] - origin[2], Math.hypot(P[0] - origin[0], P[1] - origin[1]));
  for (let it = 0; it < 12; it++) {
    const hit = crossAt(origin, yaw, pitch, power, wind, P[1]); if (!hit) { pitch += 0.05; continue; }
    const dist = Math.hypot(P[0] - origin[0], P[1] - origin[1]);
    yaw += Math.atan2(P[0] - hit[0], dist) * 0.9; pitch += Math.atan2(P[2] - hit[2], dist) * 0.9;
  }
  return { yaw, pitch };
}
