// Saratoga GP — the racing line, race progress and the AI drivers (DESIGN.md §6).
// The line (assets/line.json) is a closed loop sampled every ~4 m, running in the race direction.

const TAU = Math.PI * 2;
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// line: { pts: [[x, y, z]], length }; world: collision (ground / wall) for the free width each side
export function makeLine(data, world) {
  const P = data.pts, N = P.length, s = new Float32Array(N + 1), tx = new Float32Array(N), ty = new Float32Array(N), curv = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = P[i], b = P[(i + 1) % N]; s[i + 1] = s[i] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  for (let i = 0; i < N; i++) { const a = P[(i - 1 + N) % N], b = P[(i + 1) % N], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; tx[i] = dx / l; ty[i] = dy / l; }
  // curvature from the heading change over ±3 samples
  for (let i = 0; i < N; i++) { const a = (i - 3 + N) % N, b = (i + 3) % N, d = wrapA(Math.atan2(ty[b], tx[b]) - Math.atan2(ty[a], tx[a])), ds = (((s[b] - s[a]) % s[N]) + s[N]) % s[N]; curv[i] = d / Math.max(1, ds); }
  // free width to the left and right: road that is close in height and clear of walls, up to 14 m
  const wl = new Float32Array(N), wr = new Float32Array(N);
  for (let i = 0; i < N; i++) for (const [side, out] of [[1, wl], [-1, wr]]) {
    const nx = -ty[i] * side, ny = tx[i] * side; let w = 0;
    for (let d = 0.5; d <= 14; d += 0.5) { const x = P[i][0] + nx * d, y = P[i][1] + ny * d, g = world.ground(x, y, P[i][2] + 0.6); if (g === null || Math.abs(g - P[i][2]) > 0.8 || world.surf !== 0 || world.wall(x, y, g + 0.3, g + 1.3)) break; w = d; }
    out[i] = w;
  }
  const L = { P, N, s, len: s[N], tx, ty, curv, wl, wr };
  // target speed per sample: v = √(a_lat · R) for the corner, then a backward braking pass (twice round the loop)
  L.speeds = (alat, brake = 15, vmax = 62) => {
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) { let k = 0; for (let j = -2; j <= 2; j++) k = Math.max(k, Math.abs(curv[(i + j + N) % N])); v[i] = Math.min(vmax, k > 1e-4 ? Math.sqrt(alat / k) : vmax); }
    for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) { const j = (i + 1) % N, ds = s[i + 1] - s[i]; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds)); }
    return v;
  };
  // the sample nearest (x, y, z), searching ±range around hint (or everywhere)
  L.nearest = (x, y, z, hint = -1, range = 25) => {
    let best = -1, bd = Infinity;
    const scan = (i) => { const p = P[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + ((p[2] - z) * 4) ** 2; if (d < bd) { bd = d; best = i; } };
    if (hint < 0) for (let i = 0; i < N; i++) scan(i); else for (let k = -range; k <= range; k++) scan((hint + k + N) % N);
    return best;
  };
  // distance along the line of (x, y) near sample i, and the signed lateral offset (+ = left)
  L.project = (i, x, y) => { const p = P[i], dx = x - p[0], dy = y - p[1]; return { s: s[i] + dx * tx[i] + dy * ty[i], lat: -dx * ty[i] + dy * tx[i] }; };
  // point at distance d along the line, shifted lat metres to the left
  L.at = (d, lat = 0) => {
    d = ((d % L.len) + L.len) % L.len;
    let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
    const a = P[lo], b = P[(lo + 1) % N], f = (d - s[lo]) / (s[lo + 1] - s[lo] || 1);
    const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
    const t0 = tx[lo] + (tx[(lo + 1) % N] - tx[lo]) * f, t1 = ty[lo] + (ty[(lo + 1) % N] - ty[lo]) * f, tl = Math.hypot(t0, t1) || 1;
    return { x: x - (t1 / tl) * lat, y: y + (t0 / tl) * lat, z, h: Math.atan2(t1, t0), i: lo };
  };
  return L;
}

// race progress for a car: total distance (laps × length + s), kept continuous across the line
export function trackProgress(L, c) {
  c.li = L.nearest(c.x, c.y, c.z, c.li ?? -1, c.li === undefined ? 0 : 25);
  const { s, lat } = L.project(c.li, c.x, c.y);
  if (c.prevS !== undefined) { let d = s - c.prevS; if (d < -L.len / 2) c.lapsDone++; else if (d > L.len / 2) c.lapsDone--; }
  c.prevS = s; c.lat = lat; c.dist = c.lapsDone * L.len + s;
  // heading against the line: wrong way
  c.wrong = Math.cos(c.h - Math.atan2(L.ty[c.li], L.tx[c.li])) < -0.3 && Math.abs(c.v) > 3;
}

import { maxSteer } from "./car.js";

// the AI driver: aim at a point ahead on the line (with its own lane offset), speed from the line's profile
export function aiInput(L, c, cars, dt, G) {
  const look = 9 + Math.abs(c.v) * 0.35, base = L.s[c.li] + (L.project(c.li, c.x, c.y).s - L.s[c.li]);
  // the lane drifts back to the line in corners; a car close ahead pushes it aside
  let lane = c.lane;
  for (const o of cars) {
    if (o === c) continue;
    let ahead = o.dist - c.dist; if (Math.abs(ahead) > L.len / 2) ahead -= Math.sign(ahead) * L.len;
    if (ahead > 0 && ahead < 18 && Math.abs((o.lat ?? 0) - (c.lat ?? 0)) < 2.6) lane = (o.lat ?? 0) > (c.lat ?? 0) ? (o.lat ?? 0) - 3 : (o.lat ?? 0) + 3;
  }
  const i2 = (c.li + Math.round(look / 4)) % L.N, room = lane > 0 ? L.wl[i2] - 1.4 : L.wr[i2] - 1.4;
  lane = Math.sign(lane) * Math.max(0, Math.min(Math.abs(lane), room));
  c.laneNow = (c.laneNow ?? 0) + (lane - (c.laneNow ?? 0)) * Math.min(1, dt * 1.5);
  const T = L.at(base + look, c.laneNow);
  // pure pursuit: the curvature that reaches the target point, as a steering angle, as a share of the available lock
  const dx = T.x - c.x, dy = T.y - c.y, Ld = Math.max(4, Math.hypot(dx, dy)), err = wrapA(Math.atan2(dy, dx) - c.h);
  const angle = Math.atan((2 * Math.sin(err) / Ld) * G.wb) * (c.v < 0 ? -1 : 1);
  const steer = Math.max(-1, Math.min(1, angle / Math.max(1e-3, maxSteer(c, G))));
  // speed: the slowest target over the next few samples, scaled by skill (and the rubber band)
  let vt = 99; for (let k = 0; k < 6; k++) vt = Math.min(vt, c.speeds[(c.li + k) % L.N]);
  vt *= c.pace;
  const v = c.v;
  return { gas: v < vt - 0.5 ? 1 : v < vt ? 0.4 : 0, brake: v > vt + 0.8 ? Math.min(1, (v - vt) / 3) : 0, steer, hand: false };
}
