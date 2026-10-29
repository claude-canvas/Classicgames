// Golden Hare — the bow and arrows (DESIGN.md §1–2). The bow is built in the camera frame (x right, y forward,
// z up, origin at the grip) and rebuilt each frame with the string and arrow pulled back by the draw (0–1).
// The flying arrow is a fixed mesh along +y (tip at +y), placed with a matrix.
import { Mesh, blob, limb, smoothNormals } from "./mesh.js";

const SOFT = 1;
const WOOD = [0.27, 0.15, 0.08], WOOD2 = [0.31, 0.18, 0.09], GRIP = [0.24, 0.14, 0.09], STRING = [0.92, 0.9, 0.82], SHAFT = [0.8, 0.66, 0.46], FLETCH_A = [0.82, 0.14, 0.1], FLETCH_B = [0.96, 0.95, 0.9], STEEL = [0.68, 0.7, 0.74];
const HALF = 0.62;
// the limb's curve: forward at the middle, sweeping back at the tips (a recurve), in the y–z plane
const curve = (z) => { const u = z / HALF; return 0.07 * (1 - u * u) - 0.035 * Math.max(0, Math.abs(u) - 0.82) * 8; };
function arrowInto(m, y0, len) {
  limb(m, [0, y0, 0], [0, y0 + len, 0], 0.0045, 0.0045, SHAFT, SOFT, 6);
  // three thin flat vanes, set 120° apart
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a), col = k === 0 ? FLETCH_A : FLETCH_B;
    const P = (r, y) => [c * r, y0 + y, s * r]; m.quad(P(0.004, 0.02), P(0.004, 0.09), P(0.011, 0.075), P(0.013, 0.03), col, SOFT); m.quad(P(0.013, 0.03), P(0.011, 0.075), P(0.004, 0.09), P(0.004, 0.02), col, SOFT); }
  limb(m, [0, y0 + len - 0.005, 0], [0, y0 + len + 0.045, 0], 0.011, 0.0005, STEEL, SOFT, 4);
  blob(m, [0, y0 + 0.004, 0], 0.006, 0.008, 0.006, FLETCH_A, SOFT, 6, 4);
}
export function buildBowFrame(draw) {
  const m = new Mesh(9000), N = 22;
  // limbs: tapered, laminated (two woods)
  for (let i = 0; i < N; i++) {
    const z0 = -HALF + (i / N) * 2 * HALF, z1 = -HALF + ((i + 1) / N) * 2 * HALF, w0 = 0.018 - Math.abs(z0) * 0.017, w1 = 0.018 - Math.abs(z1) * 0.017;
    limb(m, [0, curve(z0), z0], [0, curve(z1), z1], Math.max(0.006, w0), Math.max(0.006, w1), i % 4 < 2 ? WOOD : WOOD2, SOFT, 8);
  }
  // the grip and arrow shelf
  limb(m, [0, 0.07, -0.09], [0, 0.07, 0.09], 0.024, 0.024, GRIP, SOFT, 10);
  blob(m, [0.012, 0.08, 0.1], 0.012, 0.02, 0.012, WOOD2, SOFT, 8, 5);
  // the string: tip to the nock (pulled back by the draw) to tip
  const top = [0, curve(HALF), HALF], bot = [0, curve(-HALF), -HALF], nock = [0, -0.02 - draw * 0.5, 0.1];
  limb(m, top, nock, 0.0018, 0.0018, STRING, SOFT, 4); limb(m, nock, bot, 0.0018, 0.0018, STRING, SOFT, 4);
  // the arrow on the string, resting on the shelf
  const am = new Mesh(3000); arrowInto(am, 0, 0.78);
  const dir = [0, 0.08 + 0.02 - nock[1], 0.1 - nock[2]], L = Math.hypot(...dir);
  for (let i = 0; i < am.n; i++) { const o = i * 4, y = am.pos[o + 1]; am.pos[o] += 0.012; am.pos[o + 1] = nock[1] + y * (dir[1] / L); am.pos[o + 2] = am.pos[o + 2] + nock[2] + y * (dir[2] / L); }
  m.append(am);
  return { m, nrm: smoothNormals(m.pos, m.n) };
}
export function buildArrow() { const m = new Mesh(3000); arrowInto(m, -0.78, 0.78); return { m, nrm: smoothNormals(m.pos, m.n) }; }

// arrow flight: a point with gravity; returns what it hit along this step
export function stepArrow(a, dt, world, targets) {
  const steps = Math.max(1, Math.ceil((Math.hypot(a.vx, a.vy, a.vz) * dt) / 0.2));
  for (let s = 0; s < steps; s++) {
    const h = dt / steps, px = a.x, py = a.y, pz = a.z;
    a.vz -= 9.8 * h; a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
    for (const t of targets) { const c = t.c; if (segSphere(px, py, pz, a.x, a.y, a.z, c[0], c[1], c[2], t.r)) return { type: "hit", target: t.ref }; }
    const g = world.ground(a.x, a.y, a.z + 0.2);
    if (g !== null && a.z <= g + 0.02) { a.z = g + 0.02; return { type: "ground" }; }
    if (world.wall(a.x, a.y, a.z - 0.05, a.z + 0.05)) return { type: "wood" };
    if (!world.inside(a.x, a.y) || a.z < -5) return { type: "lost" };
  }
  return null;
}
function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2));
  const qx = ax + dx * t - cx, qy = ay + dy * t - cy, qz = az + dz * t - cz;
  return qx * qx + qy * qy + qz * qz < r * r;
}
// the elevation that lands an arrow of speed v on a target dx away (horizontally) and dz up (the flatter solution)
export function aimPitch(v, dx, dz) {
  const g = 9.8, v2 = v * v, disc = v2 * v2 - g * (g * dx * dx + 2 * dz * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
}
