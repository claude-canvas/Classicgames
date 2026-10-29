// Storm Beacon ships (DESIGN.md §1, §4): models (local frame: +y forward, +x starboard, z up, waterline at 0),
// placement on the waves, and the blind/lit navigation.
import { MAT, Mesh, tube, limb, mixc } from "./mesh.js";
import { sea } from "./waves.js";
import { ROUTE } from "./levels.js";

export const TYPES = {
  fishing: { L: 13, B: 4.2, D: 1.6, speed: 8.5, hull: [0.12, 0.25, 0.45], cab: [0.85, 0.82, 0.75], pts: 80 },
  coaster: { L: 32, B: 7.5, D: 2.6, speed: 6.6, hull: [0.1, 0.1, 0.12], cab: [0.9, 0.9, 0.88], pts: 100 },
  schooner: { L: 26, B: 6, D: 2.2, speed: 6.2, hull: [0.22, 0.13, 0.08], cab: [0.6, 0.45, 0.3], pts: 120 },
  steamer: { L: 48, B: 9, D: 3.4, speed: 5.0, hull: [0.08, 0.08, 0.09], cab: [0.92, 0.9, 0.85], pts: 160 },
};

function hull(m, L, B, D, col) {
  const N = 12, sec = (t) => {
    const w = (B / 2) * (t < 0.12 ? 0.82 + t * 1.5 : t > 0.55 ? Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2)) : 1);
    const y = (t - 0.5) * L, sheer = D + (t > 0.7 ? (t - 0.7) * D * 1.2 : 0);
    return [[-w, y, sheer], [-w * 0.92, y, -0.2], [0, y, -D * 0.55], [w * 0.92, y, -0.2], [w, y, sheer]];
  };
  const bottom = mixc(col, [0.45, 0.08, 0.06], 0.75);
  for (let i = 0; i < N; i++) {
    const a = sec(i / N), b = sec((i + 1) / N);
    for (let k = 0; k < 4; k++) m.quad(a[k], b[k], b[k + 1], a[k + 1], k === 0 || k === 3 ? col : bottom, MAT.GLOSS);
    m.quad([a[0][0], a[0][1], a[0][2] - 0.05], [b[0][0], b[0][1], b[0][2] - 0.05], [b[4][0], b[4][1], b[4][2] - 0.05], [a[4][0], a[4][1], a[4][2] - 0.05], [0.32, 0.24, 0.16], MAT.MATTE);   // deck
  }
  const s = sec(0); m.quad(s[0], s[4], s[3], s[1], col, MAT.GLOSS); m.tri(s[1], s[3], s[2], bottom, MAT.GLOSS);   // transom
}
function cabin(m, x0, x1, y0, y1, z0, z1, col, win) {
  const q = (a, b, c, d, cc, mat = MAT.MATTE) => m.quad(a, b, c, d, cc, mat);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col); q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col);
  q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], col); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], col);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col.map((v) => v * 0.7));
  if (win) {   // a band of lit windows on both sides and the front
    const zw = z0 + (z1 - z0) * 0.55, h = (z1 - z0) * 0.22;
    for (const x of [x0 - 0.03, x1 + 0.03]) for (let y = y0 + 0.6; y < y1 - 0.6; y += 1.4) q([x, y, zw], [x, y + 0.7, zw], [x, y + 0.7, zw + h], [x, y, zw + h], [1.5, 0.9, 0.45], MAT.EMIT);
    q([x0 + 0.4, y1 + 0.03, zw], [x1 - 0.4, y1 + 0.03, zw], [x1 - 0.4, y1 + 0.03, zw + h], [x0 + 0.4, y1 + 0.03, zw + h], [1.2, 0.8, 0.45], MAT.EMIT);
  }
}
export function buildShip(type) {
  const T = TYPES[type], m = new Mesh(8000), { L, B, D } = T;
  hull(m, L, B, D, T.hull);
  const lights = [];   // [x, y, z, r, g, b, size] in the local frame
  if (type === "fishing") {
    cabin(m, -1.3, 1.3, -1.5, 1.6, D, D + 2.2, T.cab, true);
    limb(m, [0, 2.5, D], [0, 2.5, D + 6], 0.1, 0.07, [0.2, 0.2, 0.2], MAT.GLOSS, 4);
    limb(m, [0, 2.5, D + 4], [0, -5, D + 1.5], 0.06, 0.05, [0.2, 0.2, 0.2], MAT.GLOSS, 3);
    lights.push([0, 2.5, D + 6.2, 1, 1, 0.95, 0.6]);
  } else if (type === "coaster") {
    cabin(m, -3, 3, -L / 2 + 2, -L / 2 + 8, D, D + 5.5, T.cab, true);
    cabin(m, -2.2, 2.2, -L / 2 + 3, -L / 2 + 6.5, D + 5.5, D + 7, T.cab, true);
    for (const y of [-2, 7]) { limb(m, [0, y, D], [0, y, D + 7], 0.18, 0.12, [0.7, 0.55, 0.15], MAT.GLOSS, 4); limb(m, [0, y, D + 6], [0, y + 6, D + 2], 0.1, 0.1, [0.7, 0.55, 0.15], MAT.GLOSS, 3); }
    for (let k = 0; k < 3; k++) cabin(m, -2.8, 2.8, -3 + k * 5.5, 1.5 + k * 5.5, D, D + 1.4, [0.18, 0.3, 0.45], false);
    lights.push([0, 7, D + 7.3, 1, 1, 0.95, 0.7], [0, -L / 2 + 5, D + 8.5, 1, 1, 0.95, 0.6]);
  } else if (type === "schooner") {
    cabin(m, -1.6, 1.6, -L / 2 + 3, -L / 2 + 7, D, D + 1.6, T.cab, true);
    for (const [y, h] of [[-3, 17], [5, 19]]) {
      limb(m, [0, y, D], [0, y, D + h], 0.18, 0.1, [0.3, 0.2, 0.12], MAT.MATTE, 4);
      const sail = [0.72, 0.7, 0.64];
      m.quad([0, y - 0.3, D + 2], [0, y - 7.5, D + 2.5], [0, y - 6, D + h - 3], [0, y - 0.3, D + h - 1], sail, MAT.MATTE);
    }
    m.tri([0, 6, D + 17], [0, L / 2 + 3, D + 1.5], [0, 6.5, D + 3], [0.72, 0.7, 0.64], MAT.MATTE);
    limb(m, [0, L / 2 - 1, D + 0.6], [0, L / 2 + 4, D + 1.2], 0.08, 0.06, [0.3, 0.2, 0.12], MAT.MATTE, 3);
    lights.push([0, 5, D + 19.3, 1, 1, 0.95, 0.6]);
  } else {
    cabin(m, -3.6, 3.6, -6, 6, D, D + 4, T.cab, true);
    cabin(m, -3, 3, -4, 3, D + 4, D + 7, T.cab, true);
    cabin(m, -2, 2, 1.5, 3.2, D + 7, D + 8.5, T.cab, true);
    tube(m, 0, -9, 12, 1.6, D, 1.5, D + 10, [0.65, 0.1, 0.06], MAT.GLOSS);
    tube(m, 0, -9, 12, 1.52, D + 10, 1.52, D + 12, [0.06, 0.06, 0.06], MAT.GLOSS);
    for (const y of [-L / 2 + 6, L / 2 - 8]) limb(m, [0, y, D], [0, y, D + 14], 0.15, 0.1, [0.15, 0.15, 0.15], MAT.GLOSS, 4);
    for (let k = 0; k < 9; k++) { const y = -L / 2 + 6 + k * 4.2; for (const x of [-B / 2 - 0.02, B / 2 + 0.02]) m.quad([x, y, D - 1.2], [x, y + 0.6, D - 1.2], [x, y + 0.6, D - 0.6], [x, y, D - 0.6], [1.4, 0.85, 0.4], MAT.EMIT); }
    lights.push([0, L / 2 - 8, D + 14.3, 1, 1, 0.95, 0.8], [0, -L / 2 + 6, D + 14.3, 1, 1, 0.95, 0.6]);
  }
  // sidelights: red to port (left, −x), green to starboard
  lights.push([-B / 2 - 0.1, L * 0.18, D + 1.2, 1, 0.12, 0.08, 0.5], [B / 2 + 0.1, L * 0.18, D + 1.2, 0.1, 1, 0.25, 0.5]);
  return { m, lights, T };
}

// ship pose on the waves: heave, pitch and roll from the sea slope under it
export function pose(s, t, storm) {
  const fw = sea(s.x, s.y, t, storm);
  s.heave = fw.h;
  const fx = Math.sin(s.hd), fy = Math.cos(s.hd);
  const k = 1 / (1 + s.T.L * 0.02);
  s.pitch = Math.atan(fw.gx * fx + fw.gy * fy) * k;
  s.roll = Math.atan(fw.gx * fy - fw.gy * fx) * k * 1.3;
}
// write a ship model into M with its pose (+ list), returning its world-space lights
export function putShip(M, A, model, s, sink = 0) {
  const ch = Math.cos(s.hd), sh = Math.sin(s.hd), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch), roll = s.roll + (s.list || 0), cr = Math.cos(roll), sr = Math.sin(roll);
  const z0 = s.heave - sink;
  const X = (x, y, z) => {
    // roll about the local y axis, then pitch about local x, then yaw (heading clockwise from +y)
    let x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
    let y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    return [s.x + x1 * ch + y2 * sh, s.y - x1 * sh + y2 * ch, z0 + z2];
  };
  const P = model.m.pos, C = model.m.col;
  for (let i = 0; i < model.m.n; i++) { const o = i * 4, p = X(P[o], P[o + 1], P[o + 2]); M.v(p[0], p[1], p[2], P[o + 3], C[o], C[o + 1], C[o + 2], C[o + 3]); }
  const out = [];
  if (sink < model.T.D * 2) for (const [x, y, z, r, g, b, size] of model.lights) { const p = X(x, y, z); if (p[2] < -0.5) continue; A.sprite(p[0], p[1], p[2], size * 2.2, r * 0.5, g * 0.5, b * 0.5); A.sprite(p[0], p[1], p[2], size * 0.5, r, g, b); out.push(p); }
  return out;
}

// navigation: steer for the next channel waypoint with a bearing error that grows in the dark
export function navigate(s, dt, night, current, rnd, hold) {
  if (s.wp < ROUTE.length) {
    const [wx, wy] = ROUTE[s.wp];
    if (Math.hypot(wx - s.x, wy - s.y) < 45 || s.y < wy - 15) s.wp++;
  }
  const [tx, ty] = s.wp < ROUTE.length ? ROUTE[s.wp] : ROUTE[ROUTE.length - 1];
  if (s.lit) s.conf = Math.min(1, s.conf + dt * 1.6); else s.conf = Math.max(0, s.conf - dt / 9);
  if (s.conf > 0.25) s.err *= Math.exp(-dt * 1.8 * s.conf);
  else s.err += (rnd() - 0.5) * 2 * 0.42 * night.storm * Math.sqrt(dt) + s.errBias * dt;
  s.err = Math.max(-1.4, Math.min(1.4, s.err));
  const want = Math.atan2(tx - s.x, ty - s.y) + s.err;
  let d = want - s.hd; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  s.hd += Math.max(-0.22 * dt, Math.min(0.22 * dt, d));
  const sp = s.T.speed * (hold ? 0.18 : 1) * s.spdMul;
  s.v += (sp - s.v) * Math.min(1, dt * 0.5);
  s.x += (Math.sin(s.hd) * s.v + current[0] * (1 - s.conf * 0.6)) * dt;
  s.y += (Math.cos(s.hd) * s.v + current[1] * (1 - s.conf * 0.6)) * dt;
}
