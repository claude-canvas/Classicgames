// Last Light — Wick the harvest mouse (DESIGN.md §5): procedural model, GPU-skinned (pos.w = 1000 + bone), with run,
// idle, jump and glide poses, and movement over the forest floor at mouse scale (metres: he is 9 cm long).
// Model frame: x right, y forward, z up, origin between the feet. Bones are built as base · T(pivot) · R · T(−pivot).
import { Mesh, blob, limb, smoothNormals } from "./mesh.js";

const SOFT = 1;
const FUR = [0.66, 0.42, 0.24], BELLY = [0.93, 0.8, 0.62], PINK = [0.95, 0.62, 0.6], DARK = [0.05, 0.04, 0.04], EAR = [0.8, 0.5, 0.42], TAILC = [0.82, 0.58, 0.48];
export const B = { BODY: 0, HEAD: 1, T1: 2, T2: 3, T3: 4, FL: 5, FR: 6, BL: 7, BR: 8, ARM: 9, EARL: 10, EARR: 11, SEED: 12 };
// pivots in the model frame
const PIV = { [B.HEAD]: [0, 0.028, 0.036], [B.T1]: [0, -0.034, 0.026], [B.T2]: [0, -0.062, 0.022], [B.T3]: [0, -0.09, 0.024], [B.FL]: [-0.012, 0.018, 0.02], [B.FR]: [0.012, 0.018, 0.02], [B.BL]: [-0.014, -0.02, 0.022], [B.BR]: [0.014, -0.02, 0.022], [B.ARM]: [0.014, 0.024, 0.03], [B.EARL]: [-0.011, 0.036, 0.056], [B.EARR]: [0.011, 0.036, 0.056], [B.SEED]: [0, 0, 0.09] };
export const LANTERN = [0.024, 0.062, 0.078];    // the lantern's glass, in the model frame (for the glow and the light)

function tag(m, from, bone) { for (let i = from; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + bone; }
export function buildWick() {
  const m = new Mesh(9000); let f;
  // body: a soft pear, lighter belly
  f = m.n; blob(m, [0, -0.006, 0.026], 0.021, 0.032, 0.02, FUR, SOFT, 16, 10, null, (i, j) => (j > 6 ? BELLY : FUR)); tag(m, f, B.BODY);
  // head: round, a snout, pink nose, shiny black eyes, whiskers
  f = m.n;
  blob(m, [0, 0.036, 0.04], 0.016, 0.018, 0.016, FUR, SOFT, 14, 9, null, (i, j) => (j > 5 ? BELLY : FUR));
  blob(m, [0, 0.054, 0.036], 0.008, 0.012, 0.0075, FUR, SOFT, 10, 6, null, (i, j) => (j > 3 ? BELLY : FUR));
  blob(m, [0, 0.066, 0.037], 0.0032, 0.003, 0.0028, PINK, SOFT, 6, 4);
  for (const s of [-1, 1]) {
    blob(m, [s * 0.0085, 0.047, 0.046], 0.0034, 0.003, 0.0036, DARK, SOFT, 8, 5);
    blob(m, [s * 0.0092, 0.0488, 0.0472], 0.0009, 0.0008, 0.0009, [2.2, 2.2, 2.2], SOFT, 4, 3);
    for (const dz of [-0.002, 0.0015]) limb(m, [s * 0.006, 0.06, 0.036 + dz], [s * 0.024, 0.066, 0.038 + dz * 2.5], 0.0003, 0.0002, [0.95, 0.9, 0.85], SOFT, 3);
  }
  tag(m, f, B.HEAD);
  // ears: big thin round discs, pink inside
  for (const [s, bone] of [[-1, B.EARL], [1, B.EARR]]) { f = m.n; blob(m, [s * 0.012, 0.034, 0.062], 0.011, 0.0028, 0.0105, EAR, SOFT, 12, 6, null, (i, j) => (i > 6 ? PINK : EAR)); tag(m, f, bone); }
  // tail: three tapering segments
  const tp = [[0, -0.034, 0.026], [0, -0.062, 0.022], [0, -0.09, 0.024], [0, -0.118, 0.034]];
  [B.T1, B.T2, B.T3].forEach((bone, i) => { f = m.n; limb(m, tp[i], tp[i + 1], 0.0034 - i * 0.0009, 0.0026 - i * 0.0009, TAILC, SOFT, 6); tag(m, f, bone); });
  // legs: little paws
  for (const [bone, p] of [[B.FL, [-0.011, 0.02, 0.004]], [B.FR, [0.011, 0.02, 0.004]], [B.BL, [-0.014, -0.022, 0.005]], [B.BR, [0.014, -0.022, 0.005]]]) {
    f = m.n; const pv = PIV[bone]; limb(m, pv, [p[0], p[1], p[2] + 0.003], 0.0045, 0.003, FUR, SOFT, 6); blob(m, p, 0.0045, 0.0065, 0.0028, PINK, SOFT, 8, 4); tag(m, f, bone);
  }
  // the lantern on a stick, held up in the right paw: a little brass frame around warm glass
  f = m.n;
  limb(m, [0.014, 0.026, 0.028], [0.022, 0.058, 0.092], 0.0012, 0.0012, [0.42, 0.28, 0.14], SOFT, 4);
  blob(m, LANTERN, 0.0055, 0.0055, 0.0072, [3.0, 2.3, 1.1], SOFT, 10, 6);
  blob(m, [LANTERN[0], LANTERN[1], LANTERN[2] + 0.0078], 0.0045, 0.0045, 0.0018, [0.75, 0.55, 0.25], SOFT, 8, 4);
  blob(m, [LANTERN[0], LANTERN[1], LANTERN[2] - 0.0078], 0.0042, 0.0042, 0.0016, [0.75, 0.55, 0.25], SOFT, 8, 4);
  tag(m, f, B.ARM);
  // maple seed wing (shown only while gliding): a veined brown-red wing held overhead
  f = m.n;
  blob(m, [0, 0, 0.096], 0.05, 0.016, 0.0018, [0.72, 0.36, 0.2], SOFT, 14, 4);
  blob(m, [0, -0.002, 0.095], 0.008, 0.008, 0.005, [0.5, 0.32, 0.18], SOFT, 8, 5);
  limb(m, [0, 0.0, 0.094], [0.012, 0.026, 0.06], 0.0008, 0.0008, [0.42, 0.28, 0.14], SOFT, 3);
  tag(m, f, B.SEED);
  return { m, nrm: smoothNormals(m.pos, m.n) };
}

// 3×4 row-major affine matrices
export const MX = {
  mul: (A, C) => [A[0] * C[0] + A[1] * C[4] + A[2] * C[8], A[0] * C[1] + A[1] * C[5] + A[2] * C[9], A[0] * C[2] + A[1] * C[6] + A[2] * C[10], A[0] * C[3] + A[1] * C[7] + A[2] * C[11] + A[3],
    A[4] * C[0] + A[5] * C[4] + A[6] * C[8], A[4] * C[1] + A[5] * C[5] + A[6] * C[9], A[4] * C[2] + A[5] * C[6] + A[6] * C[10], A[4] * C[3] + A[5] * C[7] + A[6] * C[11] + A[7],
    A[8] * C[0] + A[9] * C[4] + A[10] * C[8], A[8] * C[1] + A[9] * C[5] + A[10] * C[9], A[8] * C[2] + A[9] * C[6] + A[10] * C[10], A[8] * C[3] + A[9] * C[7] + A[10] * C[11] + A[11]],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  S: (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
};
const about = (bone, R) => { const p = PIV[bone]; return MX.mul(MX.mul(MX.T(p[0], p[1], p[2]), R), MX.T(-p[0], -p[1], -p[2])); };

// ------------------------------------------------------------------ movement
export const WALK = 0.38, SCURRY = 0.95;     // m/s
const G = 6.5, JUMP = 1.05, GLIDE_FALL = 0.14, STEP = 0.035;
export function makeWick(x, y, z, h) { return { x, y, z, h, vx: 0, vy: 0, vz: 0, ground: true, glide: false, phase: 0, speed: 0, idleT: 0, land: 0, airT: 0 }; }

// inp: { mx, my (world-space wish direction, length ≤ 1), run, jump (held), jumpPressed }
export function stepWick(w, inp, dt, world) {
  const wish = Math.hypot(inp.mx, inp.my), top = inp.run ? SCURRY : WALK;
  // turn to face the way he runs; accelerate quickly on the ground, gently in the air
  if (wish > 0.05) { let d = Math.atan2(inp.my, inp.mx) - w.h; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; w.h += d * Math.min(1, dt * 12); }
  const tvx = inp.mx * top, tvy = inp.my * top, acc = w.ground ? 10 : w.glide ? 3 : 2;
  w.vx += (tvx - w.vx) * Math.min(1, dt * acc); w.vy += (tvy - w.vy) * Math.min(1, dt * acc);
  if (w.glide) { const f = Math.hypot(w.vx, w.vy), want = Math.max(0.55, f); if (f > 1e-3) { w.vx *= want / f; w.vy *= want / f; } else { w.vx = Math.cos(w.h) * want; w.vy = Math.sin(w.h) * want; } }
  // jump; hold the jump key while falling to glide on the maple seed
  if (w.ground && inp.jumpPressed) { w.vz = JUMP; w.ground = false; w.airT = 0; }
  if (!w.ground) {
    w.airT += dt;
    w.glide = inp.jump && w.vz < 0 && w.airT > 0.12;
    w.vz -= G * dt; if (w.glide) w.vz = Math.max(w.vz, -GLIDE_FALL);
  } else w.glide = false;
  // move with a small body radius against the walls, sliding along them
  const R = 0.022, lo = 0.01, hi = 0.07;
  // the centre and three points around the nose (ahead, ahead-left, ahead-right), so he can't squeeze diagonally
  // between two wall cells
  const blocked = (x, y, z) => { if (world.wall(x, y, z + lo, z + hi)) return true; for (const a of [0, 0.7, -0.7]) if (world.wall(x + Math.cos(w.h + a) * R, y + Math.sin(w.h + a) * R, z + lo, z + hi)) return true; return false; };
  let nx = w.x + w.vx * dt, ny = w.y + w.vy * dt;
  if (blocked(nx, ny, w.z)) { if (!blocked(nx, w.y, w.z)) { ny = w.y; w.vy *= 0.5; } else if (!blocked(w.x, ny, w.z)) { nx = w.x; w.vx *= 0.5; } else { nx = w.x; ny = w.y; w.vx *= 0.3; w.vy *= 0.3; } }
  // the ground under the new spot: a step up of STEP at most (higher is a wall for a mouse)
  const g = world.ground(nx, ny, w.z, STEP);
  if (g === null) { nx = w.x; ny = w.y; }
  w.x = nx; w.y = ny;
  const gh = world.ground(w.x, w.y, w.z, STEP) ?? w.z;
  if (w.ground) {
    if (gh < w.z - 0.03) { w.ground = false; w.vz = 0; w.airT = 0.12; }    // walked off an edge
    else w.z = gh;
  } else {
    w.z += w.vz * dt;
    if (w.z <= gh && w.vz <= 0) { w.land = Math.min(1, -w.vz / 2); w.z = gh; w.vz = 0; w.ground = true; w.glide = false; }
  }
  w.speed = Math.hypot(w.vx, w.vy);
  w.phase += dt * (6 + w.speed * 34) * (w.ground ? 1 : 0.3);
  w.idleT += dt; w.land = Math.max(0, w.land - dt * 4);
}

// the pose → bone matrices (12 floats each) for uBone
const bones = new Float32Array(23 * 12);
export function wickBones(w, t) {
  const run = Math.min(1, w.speed / SCURRY), ph = w.phase, air = !w.ground;
  const bob = Math.abs(Math.sin(ph)) * 0.004 * run - w.land * 0.004;
  const base = MX.mul(MX.mul(MX.T(w.x, w.y, w.z + bob), MX.Z(w.h - Math.PI / 2)), MX.X(air ? (w.glide ? 0.05 : -0.25 * Math.sign(w.vz)) : Math.sin(ph * 2) * 0.05 * run));
  const set = (b, M) => bones.set(MX.mul(base, M), b * 12);
  set(B.BODY, MX.S(1));
  set(B.HEAD, about(B.HEAD, MX.mul(MX.Z(Math.sin(t * 0.7) * 0.25 * (1 - run)), MX.X(Math.sin(ph * 2) * 0.06 * run + Math.sin(t * 1.9) * 0.04))));
  const sway = Math.sin(t * 2.2 + ph * 0.5) * (0.35 - run * 0.2);
  // tail: each segment bends a little more, about its own root (chained)
  let tail = MX.S(1);
  [B.T1, B.T2, B.T3].forEach((b, i) => { tail = MX.mul(tail, about(b, MX.mul(MX.Z(sway * (0.5 + i * 0.4)), MX.X(0.15 + (air ? 0.4 : 0) - run * 0.12)))); set(b, tail); });
  // legs: a gallop when running, tucked in the air
  const leg = (b, off) => set(b, about(b, MX.X(air ? (b < B.BL ? -0.7 : 0.7) : Math.sin(ph + off) * 0.9 * run)));
  leg(B.FL, 0); leg(B.FR, 0.5); leg(B.BL, Math.PI); leg(B.BR, Math.PI + 0.5);
  // ears twitch now and then; the lantern swings with the gait
  const tw = Math.max(0, Math.sin(t * 0.9) - 0.92) * 6;
  set(B.EARL, about(B.EARL, MX.Y(-0.2 - tw * 0.4))); set(B.EARR, about(B.EARR, MX.Y(0.2 + Math.max(0, Math.sin(t * 0.7 + 2) - 0.92) * 2.4)));
  set(B.ARM, about(B.ARM, MX.X(Math.sin(ph) * 0.12 * run + (w.glide ? -0.5 : 0))));
  set(B.SEED, w.glide ? about(B.SEED, MX.Z(t * 9)) : MX.mul(MX.T(0, 0, -1000), MX.S(0.0001)));
  return bones;
}
// where the lantern is in the world (for the glow and the light)
export function lanternPos(w) {
  const M = bones.subarray(B.ARM * 12, B.ARM * 12 + 12), [x, y, z] = LANTERN;
  return [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]];
}
