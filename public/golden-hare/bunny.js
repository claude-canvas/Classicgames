// Golden Hare — the rabbits (DESIGN.md §1–2): a smooth procedural model (soft shading, GPU-skinned) and behaviour.
// Model frame: x right, y forward, z up, origin on the ground under the body. Bones: 0 body, 1 head, 2 left ear,
// 3 right ear, 4 hind feet, 5 front legs, 6 tail. Built as base · T(pivot) · R · T(−pivot).
import { Mesh, blob, limb, smoothNormals } from "./mesh.js";

const SOFT = 1, TAU = Math.PI * 2;
const PIV = { 1: [0, 0.09, 0.17], 2: [-0.022, 0.1, 0.245], 3: [0.022, 0.1, 0.245], 4: [0, -0.04, 0.06], 5: [0, 0.07, 0.085], 6: [0, -0.14, 0.13] };
const COATS = {
  brown: { fur: [0.56, 0.45, 0.35], cream: [0.93, 0.87, 0.77], tip: [0.33, 0.26, 0.2], pink: [0.96, 0.66, 0.66] },
  grey: { fur: [0.5, 0.48, 0.45], cream: [0.9, 0.88, 0.84], tip: [0.28, 0.27, 0.26], pink: [0.95, 0.68, 0.68] },
  gold: { fur: [1.15, 0.84, 0.36], cream: [1.2, 1.02, 0.72], tip: [0.9, 0.6, 0.22], pink: [1.2, 0.8, 0.6] },
};
export function buildBunny(coat = "brown") {
  const C = COATS[coat], m = new Mesh(30000);
  const tag = (f, b) => { for (let i = f; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + b; };
  const belly = (rings) => (i, j) => (j > rings * 0.62 ? C.cream : C.fur);
  let f = m.n;
  // body: a soft rounded back, big haunches, a cream belly and chest
  blob(m, [0, -0.02, 0.125], 0.085, 0.13, 0.095, C.fur, SOFT, 22, 16, null, belly(16));
  for (const s of [-1, 1]) blob(m, [s * 0.05, -0.065, 0.095], 0.055, 0.082, 0.072, C.fur, SOFT, 16, 12, null, belly(12));
  blob(m, [0, 0.065, 0.115], 0.062, 0.06, 0.078, C.fur, SOFT, 16, 12, null, (i, j) => (j > 5 ? C.cream : C.fur));
  tag(f, 0);
  // head: round skull, full cheeks, a short muzzle, a pink nose, big glossy eyes with a highlight, whiskers
  f = m.n;
  blob(m, [0, 0.125, 0.205], 0.054, 0.068, 0.056, C.fur, SOFT, 20, 14, null, (i, j) => (j > 9 ? C.cream : C.fur));
  for (const s of [-1, 1]) blob(m, [s * 0.03, 0.15, 0.188], 0.03, 0.032, 0.03, C.fur, SOFT, 12, 9, null, (i, j) => (j > 4 ? C.cream : C.fur));
  blob(m, [0, 0.178, 0.19], 0.026, 0.024, 0.021, C.cream, SOFT, 12, 8);
  blob(m, [0, 0.2, 0.198], 0.008, 0.005, 0.006, C.pink, SOFT, 8, 5);
  for (const s of [-1, 1]) {
    blob(m, [s * 0.038, 0.148, 0.218], 0.0135, 0.012, 0.0145, [0.03, 0.02, 0.02], SOFT, 12, 8);
    blob(m, [s * 0.043, 0.156, 0.224], 0.0035, 0.003, 0.0035, [2.6, 2.6, 2.6], SOFT, 6, 4);
    for (const dz of [-0.006, 0.002]) limb(m, [s * 0.014, 0.19, 0.19 + dz], [s * 0.065, 0.2, 0.193 + dz * 2], 0.0006, 0.0004, [0.95, 0.92, 0.88], SOFT, 3);
  }
  tag(f, 1);
  // ears: long, slightly cupped, pink inside, darker tips
  for (const [s, b] of [[-1, 2], [1, 3]]) {
    f = m.n;
    blob(m, [s * 0.028, 0.09, 0.322], 0.019, 0.009, 0.078, C.fur, SOFT, 14, 12, null, (i, j) => (j < 3 ? C.tip : C.fur));
    blob(m, [s * 0.028, 0.096, 0.318], 0.012, 0.004, 0.064, C.pink, SOFT, 12, 10);
    tag(f, b);
  }
  // hind feet: long, flat, furry
  f = m.n; for (const s of [-1, 1]) blob(m, [s * 0.048, -0.025, 0.016], 0.022, 0.062, 0.016, C.fur, SOFT, 12, 8, null, (i, j) => (j > 4 ? C.cream : C.fur)); tag(f, 4);
  // front legs: slim, with small paws
  f = m.n; for (const s of [-1, 1]) { limb(m, [s * 0.03, 0.075, 0.085], [s * 0.032, 0.1, 0.012], 0.013, 0.011, C.fur, SOFT, 8); blob(m, [s * 0.032, 0.106, 0.01], 0.014, 0.018, 0.01, C.cream, SOFT, 8, 5); } tag(f, 5);
  // the cotton tail: a white puff, lumpy
  f = m.n; blob(m, [0, -0.152, 0.135], 0.032, 0.03, 0.032, coat === "gold" ? C.cream : [0.98, 0.97, 0.95], SOFT, 12, 9, (i, j) => 0.85 + 0.25 * Math.abs(Math.sin(i * 2.1 + j * 1.3))); tag(f, 6);
  return { m, nrm: smoothNormals(m.pos, m.n) };
}

// 3×4 row-major affine matrices
export const MX = {
  mul: (A, B) => [A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  S: (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
};
const about = (b, R) => { const p = PIV[b]; return MX.mul(MX.mul(MX.T(p[0], p[1], p[2]), R), MX.T(-p[0], -p[1], -p[2])); };

// ------------------------------------------------------------------ behaviour
// states: graze → alert → flee → hide → graze …; hit (tumbling) → gone
export function makeBunny(x, y, z, golden = false) {
  return { x, y, z, h: Math.random() * TAU, state: "graze", t: 0, hop: 0, hopDur: 0.35, hopLen: 0, hopH: 0, hopFrom: null, hopTo: null, next: 1 + Math.random() * 3, alertT: 0, fleeT: 0, zig: 0, golden, home: [x, y], nibble: Math.random() * 10, earT: 0, look: 0, hitT: 0, hitV: null, speed: 0 };
}
// p: the player { x, y, z, noise (radius in metres), moving }; world: { ground, wall, inside(x, y) }; events: pushed
export function stepBunny(b, p, dt, world, events) {
  b.t += dt; b.nibble += dt; b.earT = Math.max(0, b.earT - dt);
  if (Math.random() < dt * 0.4) b.earT = 0.25;
  const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), hear = p.noise * (b.golden ? 1.7 : 1);
  if (b.state === "hit") {
    // the tumble: a short arc in the arrow's direction, rolling over
    b.hitT += dt; const k = Math.min(1, b.hitT / 0.6);
    b.x += b.hitV[0] * dt * (1 - k); b.y += b.hitV[1] * dt * (1 - k);
    b.z = (world.ground(b.x, b.y, b.z + 0.5) ?? b.z) + Math.sin(k * Math.PI) * 0.18;
    if (b.hitT > 1.4) b.state = "gone";
    return d;
  }
  // hearing and seeing: alert at the edge of earshot, bolt when close or when you keep coming
  if (b.state === "graze" || b.state === "hide") {
    if (d < hear * (b.state === "hide" ? 0.6 : 1)) { if (d < hear * 0.55) flee(b, p, events); else { b.state = "alert"; b.alertT = 1.6 + Math.random(); events.push({ type: "alert", b }); } }
  } else if (b.state === "alert") {
    b.alertT -= dt; b.look = Math.atan2(-dy, -dx);
    if (d < hear * 0.55 || (p.moving && d < hear)) flee(b, p, events);
    else if (b.alertT <= 0) b.state = "graze";
  }
  // a hop in progress: an arc from hopFrom to hopTo
  if (b.hopTo) {
    b.hop += dt / b.hopDur; const k = Math.min(1, b.hop);
    b.x = b.hopFrom[0] + (b.hopTo[0] - b.hopFrom[0]) * k; b.y = b.hopFrom[1] + (b.hopTo[1] - b.hopFrom[1]) * k;
    const g = world.ground(b.x, b.y, b.z + 0.6) ?? b.z; b.z = g + Math.sin(k * Math.PI) * b.hopH;
    if (k >= 1) { b.hopTo = null; b.z = g; }
  }
  const hopTo = (ang, len, dur, h) => {
    for (const da of [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8]) {
      const a = ang + da, tx = b.x + Math.cos(a) * len, ty = b.y + Math.sin(a) * len, g = world.ground(tx, ty, b.z + 0.6);
      if (g === null || !world.inside(tx, ty) || world.wall(tx, ty, g + 0.05, g + 0.25) || Math.abs(g - b.z) > 0.5) continue;
      b.hopFrom = [b.x, b.y]; b.hopTo = [tx, ty]; b.hop = 0; b.hopDur = dur; b.hopH = h; b.h = a; return true;
    }
    return false;
  };
  if (!b.hopTo) {
    if (b.state === "flee") {
      b.fleeT -= dt;
      if (b.fleeT <= 0) { b.state = Math.random() < 0.5 ? "hide" : "graze"; b.next = 2 + Math.random() * 3; }
      else { b.zig -= dt; if (b.zig <= 0) { b.zig = 0.3 + Math.random() * 0.3; b.fleeDir = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.3; } const sp = b.golden ? 9 : 6; hopTo(b.fleeDir, sp * 0.22, 0.22, 0.14); }
    } else if (b.state === "graze") {
      b.next -= dt;
      if (b.next <= 0) {
        b.next = 1.2 + Math.random() * 3.5;
        // short hops, drifting back toward home
        const toHome = Math.atan2(b.home[1] - b.y, b.home[0] - b.x), far = Math.hypot(b.home[0] - b.x, b.home[1] - b.y) > 4;
        hopTo(far ? toHome + (Math.random() - 0.5) : b.h + (Math.random() - 0.5) * 2.4, 0.3 + Math.random() * 0.35, 0.32, 0.07);
      }
    }
  }
  b.speed = b.hopTo ? Math.hypot(b.hopTo[0] - b.hopFrom[0], b.hopTo[1] - b.hopFrom[1]) / b.hopDur : 0;
  return d;
}
function flee(b, p, events) { b.state = "flee"; b.fleeT = 2.2 + Math.random() * 1.8; b.zig = 0; b.fleeDir = Math.atan2(b.y - p.y, b.x - p.x); events.push({ type: "flee", b }); }
export function startle(b, from) { if (b.state === "graze" || b.state === "alert" || b.state === "hide") flee(b, from, []); }

// the pose → bones
const bones = new Float32Array(23 * 12);
export function bunnyBones(b, t, scale = 1) {
  const k = b.hopTo ? Math.min(1, b.hop) : 0, inAir = !!b.hopTo;
  const sit = b.state === "alert" ? 1 : 0, nib = b.state === "graze" && !inAir ? Math.max(0, Math.sin(b.nibble * 1.3)) : 0;
  const pitch = inAir ? (k - 0.5) * 0.7 : -sit * 0.55 + nib * 0.12;
  let base = MX.mul(MX.mul(MX.T(b.x, b.y, b.z), MX.Z((b.state === "alert" ? b.look : b.h) - Math.PI / 2)), MX.S(scale));
  if (b.state === "hit") base = MX.mul(base, MX.mul(MX.T(0, 0, 0.12), MX.mul(MX.Y(b.hitT * 9), MX.T(0, 0, -0.12))));
  // sitting up pivots about the haunches
  const body = MX.mul(base, MX.mul(MX.T(0, -0.06, 0.06), MX.mul(MX.X(pitch), MX.T(0, 0.06, -0.06))));
  bones.set(body, 0);
  const nod = nib * 0.5 + Math.sin(t * 9) * 0.01 * (1 - nib);
  bones.set(MX.mul(body, about(1, MX.X(nod - sit * 0.35 + (inAir ? -0.15 : 0)))), 12);
  const earsUp = sit ? 0.2 : b.state === "flee" ? -0.8 : -0.15;
  bones.set(MX.mul(body, about(2, MX.mul(MX.X(earsUp + (b.earT > 0 ? 0.25 : 0)), MX.Y(-0.15)))), 24);
  bones.set(MX.mul(body, about(3, MX.mul(MX.X(earsUp + Math.sin(t * 0.8) * 0.05), MX.Y(0.15)))), 36);
  bones.set(MX.mul(body, about(4, MX.X(inAir ? (k < 0.5 ? 0.9 - k : -0.6) : sit * 0.4))), 48);
  bones.set(MX.mul(body, about(5, MX.X(inAir ? -0.8 + k * 1.2 : sit * -0.3))), 60);
  bones.set(MX.mul(body, about(6, MX.X(Math.sin(t * 3) * 0.08))), 72);
  return bones;
}
