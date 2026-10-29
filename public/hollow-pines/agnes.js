// The Hollow Pines — Agnes Wren (DESIGN.md §1–2): a procedural ghost (mat 7, GPU-skinned) and her behaviour.
// Model frame: x right, y forward (toward whoever she faces), z up, origin at her feet. Bones: 0 body, 1 head,
// 2 left arm, 3 right arm, 4 hair. She floats a hand's breadth above the ground.
import { Mesh, blob, limb, smoothNormals, mulberry32 } from "./mesh.js";

const GHOST = 7, TAU = Math.PI * 2;
const GOWN = [0.36, 0.38, 0.39], MUD = [0.15, 0.13, 0.11], SKIN = [0.9, 0.94, 0.98], HAIR = [0.012, 0.012, 0.016], HOLE = [0.0, 0.0, 0.0], LIP = [0.25, 0.2, 0.24];
export const EYES = [[-0.031, 0.104, 1.73], [0.031, 0.104, 1.73]];   // in the model frame, for the glow
const PIV = { 1: [0, 0.03, 1.55], 2: [-0.17, 0, 1.43], 3: [0.17, 0, 1.43] };

export function buildAgnes() {
  const m = new Mesh(60000), r = mulberry32(7);
  const tag = (f, b) => { for (let i = f; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + b; };
  let f = m.n;
  // the gown: a flared skirt dragging on the ground, mud-dark at the hem, a thin waist, a bony narrow chest
  const skirt = (z) => (z < 0.3 ? MUD : GOWN);
  limb(m, [0, 0, 0.12], [0, 0, 0.55], 0.27, 0.2, MUD, GHOST, 14);
  limb(m, [0, 0, 0.55], [0, 0, 1.02], 0.2, 0.115, GOWN, GHOST, 14);
  limb(m, [0, 0, 1.02], [0, 0.01, 1.4], 0.115, 0.14, GOWN, GHOST, 12);
  blob(m, [0, 0.02, 1.38], 0.17, 0.1, 0.07, GOWN, GHOST, 12, 6);
  // torn strips hanging from the hem, trailing behind
  for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU, len = 0.1 + r() * 0.22, x0 = Math.cos(a) * 0.26, y0 = Math.sin(a) * 0.26; limb(m, [x0, y0, 0.16], [x0 * 1.12, y0 * 1.12 - 0.04, 0.16 - len], 0.04 + r() * 0.03, 0.004, skirt(0), GHOST, 4); }
  // rents in the dress over the chest and skirt (dark slashes)
  for (let i = 0; i < 6; i++) { const a = r() * TAU * 0.5 + 0.8, z = 0.4 + r() * 0.9, rr = z < 1.02 ? 0.2 - (z - 0.55) * 0.18 : 0.13; limb(m, [Math.cos(a) * rr * 1.02, Math.sin(a) * rr * 1.02, z], [Math.cos(a + 0.12) * rr * 1.02, Math.sin(a + 0.12) * rr * 1.02, z - 0.12 - r() * 0.1], 0.012, 0.004, [0.08, 0.07, 0.07], GHOST, 3); }
  // the neck: long and thin, craning forward
  limb(m, [0, 0.01, 1.42], [0, 0.045, 1.6], 0.038, 0.032, SKIN, GHOST, 8);
  tag(f, 0);
  // the head: a narrow, long skull; tall black sockets; black tears down the cheeks; a stretched gaping mouth
  f = m.n;
  blob(m, [0, 0.025, 1.72], 0.068, 0.084, 0.122, SKIN, GHOST, 16, 12);
  blob(m, [0, 0.045, 1.6], 0.042, 0.05, 0.06, SKIN, GHOST, 12, 8);
  for (const s of [-1, 1]) blob(m, [s * 0.05, 0.055, 1.66], 0.022, 0.03, 0.03, [0.55, 0.58, 0.64], GHOST, 8, 5);   // hollow cheeks
  for (const [x, y, z] of EYES) {
    blob(m, [x, y - 0.012, z], 0.021, 0.02, 0.034, HOLE, GHOST, 10, 7);
    limb(m, [x, y - 0.004, z - 0.03], [x * 1.1, y - 0.008, z - 0.12], 0.006, 0.003, HOLE, GHOST, 4);           // black tears
  }
  blob(m, [0, 0.088, 1.59], 0.018, 0.016, 0.07, HOLE, GHOST, 10, 8);
  blob(m, [0, 0.083, 1.59], 0.024, 0.012, 0.076, LIP, GHOST, 10, 8);
  tag(f, 1);
  // arms: too long, elbows bent, claw fingers hanging past the knees
  for (const [s, b] of [[-1, 2], [1, 3]]) {
    f = m.n; const sh = [s * 0.17, 0.01, 1.43], el = [s * 0.25, -0.02, 1.06], wr = [s * 0.24, 0.1, 0.7];
    blob(m, sh, 0.045, 0.04, 0.035, GOWN, GHOST, 8, 5);
    limb(m, sh, el, 0.028, 0.022, SKIN, GHOST, 6); blob(m, el, 0.026, 0.026, 0.026, SKIN, GHOST, 6, 4); limb(m, el, wr, 0.022, 0.016, SKIN, GHOST, 6);
    blob(m, [wr[0], wr[1] + 0.01, wr[2] - 0.03], 0.02, 0.032, 0.04, SKIN, GHOST, 8, 5);
    for (let k = 0; k < 4; k++) { const fx = wr[0] + s * (k - 1.5) * 0.014, mid = [fx, wr[1] + 0.03, wr[2] - 0.12], tip = [fx + s * 0.004, wr[1] + 0.06, wr[2] - 0.2 - (k === 1 || k === 2 ? 0.025 : 0)]; limb(m, [fx, wr[1] + 0.015, wr[2] - 0.05], mid, 0.006, 0.005, SKIN, GHOST, 3); limb(m, mid, tip, 0.005, 0.0015, [0.3, 0.3, 0.32], GHOST, 3); }
    tag(f, b);
  }
  // hair: wet black, from a centre part; long down the back and sides, two curtains framing the face, a few strands across it
  f = m.n;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * TAU, fy = Math.sin(a), fx = Math.cos(a);
    const front = fy > 0.25, gap = front && Math.abs(fx) < 0.62;              // leave the face showing
    if (gap && r() > 0.12) continue;
    const top = [fx * 0.05, fy * 0.05 + 0.02, 1.835], len = front ? 0.55 + r() * 0.35 : 0.8 + r() * 0.5;
    const out = 0.1 + (front ? 0.02 : 0.04), mid = [fx * out, fy * out + 0.03, 1.72], end = [fx * out * 1.15 + (r() - 0.5) * 0.05, fy * out * 1.2 + 0.03 + (front ? 0.04 : -0.05), 1.83 - len];
    limb(m, top, mid, 0.017, 0.015, HAIR, GHOST, 3); limb(m, mid, end, 0.015, 0.002, HAIR, GHOST, 3);
  }
  blob(m, [0, -0.025, 1.805], 0.09, 0.085, 0.058, HAIR, GHOST, 12, 6);   // the crown, kept back off the brow
  tag(f, 1);                                                               // the hair moves with the head
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
const about = (b, R) => { const p = PIV[b]; return MX.mul(MX.mul(MX.T(p[0], p[1], p[2]), R), MX.T(-p[0], -p[1], -p[2])); };

// ------------------------------------------------------------------ behaviour
// states: dormant → stalk ⇄ gone → hunt → gone …; burn (before the raised cross) → banished; caught (the jumpscare)
export function makeAgnes() { return { state: "dormant", t: 0, x: 0, y: 30, z: 0, h: 0, vis: 0, want: 0, reach: 0, twitch: 0, burn: 0, nextHunt: 80, stalkN: 0, huntT: 0, gone: 0, seenT: 0 }; }

// p: the player { x, y, z, yaw, pitch, look (unit view vector), torch (0/1), cross ("none" | "held" | "raised") }
// ground(x, y) → floor height; events: pushed { type }
export function stepAgnes(a, p, dt, night, ground, events) {
  a.t += dt; a.twitch = Math.max(0, a.twitch - dt);
  if (Math.random() < dt * 0.6) a.twitch = 0.12;
  const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
  // is she in front of the player, and in the torch beam?
  const tx = -dx / Math.max(d, 1e-3), ty = -dy / Math.max(d, 1e-3), lookH = Math.hypot(p.look[0], p.look[1]) || 1;
  const facing = (tx * p.look[0] + ty * p.look[1]) / lookH;
  const inBeam = p.torch && facing > 0.96 && d < 26, inView = facing > 0.55;
  const anger = Math.min(1, night);
  const place = (dist, spread, behind = false) => {
    const base = Math.atan2(p.look[1], p.look[0]) + (behind ? Math.PI : 0), ang = base + (Math.random() - 0.5) * spread;
    a.x = p.x + Math.cos(ang) * dist; a.y = p.y + Math.sin(ang) * dist; a.x = Math.max(-27, Math.min(27, a.x)); a.y = Math.max(-27, Math.min(27, a.y));
  };
  a.z = (ground(a.x, a.y) ?? p.z) + 0.08 + Math.sin(a.t * 1.3) * 0.04;
  a.h = Math.atan2(dy, dx);

  // the raised cross: she burns while she is in front of it and close enough, and cannot come nearer than 2 m
  const crossOn = p.cross === "raised" && inView && facing > 0.8 && d < 12 && a.vis > 0.3 && (a.state === "hunt" || a.state === "stalk" || a.state === "burn");
  if (crossOn) { if (a.state !== "burn") { a.prev = a.state; a.state = "burn"; events.push({ type: "burn" }); } }
  else if (a.state === "burn") { a.state = a.prev === "stalk" ? "hunt" : a.prev || "hunt"; a.huntT = Math.max(a.huntT, 8); }

  switch (a.state) {
    case "dormant":
      a.want = 0; if (a.t > 40) { a.state = "gone"; a.gone = 2; }
      break;
    case "gone":
      a.want = 0; a.gone -= dt; a.nextHunt -= dt;
      if (a.gone <= 0) {
        if (a.nextHunt <= 0 || p.cross === "held" && a.nextHunt < 30) { a.state = "hunt"; a.huntT = 26; place(20, 1.2, true); a.vis = 0; events.push({ type: "hunt" }); }
        else { a.state = "stalk"; a.stalkN++; a.stalkT = 9 + Math.random() * 6; a.seenT = 0; place(Math.max(9, 26 - a.stalkN * 1.6 - anger * 6), 1.4); events.push({ type: "stalk" }); }
      }
      break;
    case "stalk":
      // she stands and watches; looking straight at her in the torchlight, or walking at her, makes her vanish
      a.want = 1; a.nextHunt -= dt; a.stalkT -= dt;
      if (inBeam || (inView && facing > 0.9 && d < 14)) a.seenT += dt;
      if (a.seenT > 0.35 || d < 6 || a.stalkT <= 0) { a.state = "gone"; a.gone = 5 + Math.random() * 8; if (a.seenT > 0.35) events.push({ type: "vanish", d }); }
      break;
    case "hunt": {
      a.want = 1; a.huntT -= dt;
      const sp = 1.75 + anger * 0.6;
      if (d > 1e-3) { a.x += (dx / d) * sp * dt; a.y += (dy / d) * sp * dt; }
      if (d < 1.0) { a.state = "caught"; a.t = 0; events.push({ type: "caught" }); }
      else if (a.huntT <= 0 || d > 34) { a.state = "gone"; a.gone = 8; a.nextHunt = Math.max(35, 70 - anger * 30) + Math.random() * 15; events.push({ type: "huntEnd" }); }
      break;
    }
    case "burn":
      // pushed back to 2.2 m by the cross, she strains toward you while she burns
      a.want = 1; a.burn += dt / 3.2; { const push = Math.max(0, 2.2 - d) * dt * 2, k = 1 / Math.max(d, 1e-3); a.x -= dx * k * push; a.y -= dy * k * push; }
      if (d > 2.4) { a.x += (dx / d) * 0.9 * dt; a.y += (dy / d) * 0.9 * dt; }
      if (a.burn >= 1) { a.state = "banished"; a.t = 0; events.push({ type: "banished" }); }
      break;
    case "banished":
      a.want = 0;
      break;
  }
  // fade in and out (a flicker as she appears), and how far she reaches toward you
  const tgt = a.want * (a.state === "stalk" ? 0.75 : 1);
  a.vis += (tgt - a.vis) * Math.min(1, dt * (tgt > a.vis ? 2.5 : 6));
  a.reach += ((a.state === "hunt" ? Math.min(1, 5 / Math.max(d, 1)) : a.state === "burn" ? 1 : 0) - a.reach) * Math.min(1, dt * 3);
  return d;
}

// the pose → bones (body sways; head tilts and twitches; arms reach as she nears; the hair drifts)
const bones = new Float32Array(23 * 12);
export function agnesBones(a, t, override = null) {
  const base = override || MX.mul(MX.T(a.x, a.y, a.z), MX.Z(a.h - Math.PI / 2));
  const sway = Math.sin(t * 0.9) * 0.04, burnShake = a.state === "burn" ? (Math.random() - 0.5) * 0.08 : 0;
  const body = MX.mul(base, MX.mul(MX.Y(sway + burnShake), MX.X(-0.06 - a.reach * 0.12)));
  bones.set(body, 0);
  // the head leans a little and twitches; straight on when she has you
  const tilt = a.state === "caught" ? 0.05 : 0.2 + Math.sin(t * 0.4) * 0.07 + (a.twitch > 0 ? 0.25 : 0);
  bones.set(MX.mul(body, about(1, MX.mul(MX.Y(tilt), MX.X(a.reach * 0.15 - 0.1)))), 12);
  for (const [b, s] of [[2, -1], [3, 1]]) bones.set(MX.mul(body, about(b, MX.mul(MX.X(-a.reach * 1.35 - Math.sin(t * 1.7 + s) * 0.05), MX.Y(s * a.reach * 0.25)))), b * 12);
  return bones;
}
// a point of the model, through the head bone (for the eye glows)
export function headPoint(p) { const M = bones.subarray(12, 24); return [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]]; }
