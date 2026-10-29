// Paper Brook boat (DESIGN.md §4): a paper boat carried by the current in brook space (s, x).
// Heading h is relative to downstream (+ = bow to the right). Fixed-step (DT) so the game is frame-rate independent.
import { frame, curAt, ROCKS, LILIES, CASCADES, WHIRL, wzAt } from "./brook.js";
import { clamp } from "./mesh.js";

export const DT = 1 / 120;
export const BOAT_R = 0.12;
export function makeBoat(s, x = 0) {
  return { s, x, vs: 1, vx: 0, h: 0, w: 0, spin: 0, drive: 0, z: wzAt(s), vz: 0, air: false, hopAir: false, wet: 0, breath: 1, hopCd: 0, puffCd: 0, sunT: 0, inSun: 0, white: 0, landT: 0, roll: 0 };
}

// rocks are sorted by s once so collision checks only look at a small window
const RS = ROCKS.slice().sort((a, b) => a.s - b.s);
function near(list, s, m) { const out = []; for (const r of list) { if (r.s < s - m) continue; if (r.s > s + m) break; out.push(r); } return out; }
const LS = LILIES.slice().sort((a, b) => a.s - b.s);

// W: { cur: current multiplier, wet: wetness multiplier, sun: (s, x) → 0..1, twigs: [] }
export function stepBoat(b, inp, dt, W, ev) {
  const f = frame(b.s), cur = curAt(b.s, b.x) * W.cur, wz = f.p[2];
  b.hopCd = Math.max(0, b.hopCd - dt); b.puffCd = Math.max(0, b.puffCd - dt); b.landT = Math.max(0, b.landT - dt);
  // heading: steer, spin impulses, weathervane back to downstream
  if (!b.air) b.w += (inp.steer * 2.4 - b.w) * Math.min(1, dt * 8); else b.w *= 1 - dt * 2;
  b.spin *= Math.exp(-dt * 2.2);
  b.h += (b.w + b.spin) * dt;
  b.h -= b.h * (0.45 + cur * 0.12) * dt * (inp.steer === 0 ? 1.6 : 0.6);
  b.h = clamp(b.h, -1.35, 1.35);
  // puff / breath
  b.breath = Math.min(1, b.breath + dt * 0.22);
  if (inp.puff && b.puffCd <= 0 && b.breath >= 0.3) { b.drive += 1.6; b.breath -= 0.3; b.puffCd = 0.32; ev.push({ type: "puff" }); }
  b.drive *= Math.exp(-dt * 0.9);
  // target velocity from the current, heading and drive
  const ch = Math.cos(b.h), sh = Math.sin(b.h);
  let vsT = cur * (inp.drag ? 0.45 : 1) + b.drive * ch, vxT = (cur * 0.75 + b.drive) * sh;
  // whirlpool
  const wd = Math.hypot(b.s - WHIRL.s, b.x - WHIRL.x);
  if (wd < WHIRL.r) {
    const k = 1 - wd / WHIRL.r, ns = (b.s - WHIRL.s) / (wd || 1), nx = (b.x - WHIRL.x) / (wd || 1);
    vsT += (-nx * 1.5 - ns * 0.35) * k; vxT += (ns * 1.5 - nx * 0.35) * k; b.spin += 1.6 * k * dt;
  }
  const rs = b.air ? 0.15 : 1.6, rx = b.air ? 0.15 : 2.2;
  b.vs += (vsT - b.vs) * (1 - Math.exp(-dt * rs));
  b.vx += (vxT - b.vx) * (1 - Math.exp(-dt * rx));
  b.s += b.vs * dt; b.x += b.vx * dt;

  // vertical: cascades launch the boat, hops, landing
  const wzN = wzAt(b.s);
  if (!b.air) {
    for (const c of CASCADES) if (b.s > c.s - 0.65 && b.s - b.vs * dt <= c.s - 0.65) { b.air = true; b.hopAir = false; b.vz = 0.5; b.z = wz; ev.push({ type: "launch" }); }
    if (inp.hop && b.hopCd <= 0 && !b.air) { b.air = true; b.hopAir = true; b.vz = 1.9; b.z = wz; b.hopCd = 1.1; ev.push({ type: "hop" }); }
  }
  if (b.air) {
    b.vz -= 9.8 * dt; b.z += b.vz * dt;
    if (b.z <= wzN && b.vz < 0) {
      b.air = false; b.z = wzN; const hard = Math.abs(b.vz);
      if (!b.hopAir) {
        if (Math.abs(b.h) > 0.45) { b.wet += 14 * W.wet; b.spin += Math.sign(b.h) * 2; ev.push({ type: "badland", v: hard }); }
        else ev.push({ type: "goodland", v: hard });
      } else ev.push({ type: "land", v: hard });
      b.landT = 0.4; b.vz = 0;
    }
  } else b.z = wzN;

  // banks and walls
  const lim = f.hw - 0.13;
  if (Math.abs(b.x) > lim) {
    const sd = Math.sign(b.x), imp = b.vx * sd;
    b.x = sd * lim;
    if (imp > 0) { b.vx = -b.vx * 0.3; b.spin -= sd * imp * 1.5; if (imp > 0.35) { b.wet += 4 * imp * W.wet; ev.push({ type: "bank", v: imp }); } }
  }
  const z0 = b.z - wzN;
  // stones
  for (const r of near(RS, b.s, 1.2)) {
    if (z0 > r.h + 0.04) continue;
    const ds = b.s - r.s, dx = b.x - r.x, d = Math.hypot(ds, dx), rr = r.r + BOAT_R;
    if (d >= rr) continue;
    const ns = ds / (d || 1), nx = dx / (d || 1);
    b.s = r.s + ns * rr; b.x = r.x + nx * rr;
    const vn = b.vs * ns + b.vx * nx;
    if (vn < 0) {
      b.vs -= 1.3 * vn * ns; b.vx -= 1.3 * vn * nx;
      const side = Math.sign(nx || 1);
      b.spin += side * -vn * 2.2;
      if (-vn > 0.3) { b.wet += (7 + 6 * -vn) * W.wet; ev.push({ type: "rock", v: -vn }); }
    }
  }
  // lily pads: soft
  for (const l of near(LS, b.s, 1)) {
    const ds = b.s - l.s, dx = b.x - l.x, d = Math.hypot(ds, dx), rr = l.r + BOAT_R * 0.8;
    if (d >= rr || z0 > 0.05) continue;
    const ns = ds / (d || 1), nx = dx / (d || 1), vn = b.vs * ns + b.vx * nx;
    b.s = l.s + ns * rr; b.x = l.x + nx * rr;
    if (vn < 0) { b.vs -= vn * ns; b.vx -= vn * nx; b.spin += Math.sign(nx || 1) * -vn * 0.8; if (-vn > 0.4) ev.push({ type: "lily" }); }
  }
  // twigs: capsules drifting with the current
  for (const t of W.twigs) {
    if (Math.abs(t.s - b.s) > 1.2 || t.cd > 0) continue;
    if (z0 > 0.07) continue;
    const ca = Math.cos(t.rot), sa = Math.sin(t.rot), L = t.len / 2;
    const ps = b.s - t.s, px = b.x - t.x, u = clamp(ps * ca + px * sa, -L, L), qs = t.s + ca * u, qx = t.x + sa * u;
    const ds = b.s - qs, dx = b.x - qx, d = Math.hypot(ds, dx), rr = BOAT_R + 0.035;
    if (d >= rr) continue;
    const ns = ds / (d || 1), nx = dx / (d || 1), vn = (b.vs - t.vs) * ns + b.vx * nx;
    b.s = qs + ns * rr; b.x = qx + nx * rr;
    if (vn < 0) { b.vs -= 1.2 * vn * ns; b.vx -= 1.2 * vn * nx; t.vr += (u > 0 ? 1 : -1) * 1.5; b.spin += Math.sign(nx || 1) * 1.6; }
    t.cd = 0.8; b.wet += (t.hard ? 11 : 7) * W.wet; ev.push({ type: "twig" });
  }
  // wetness: white water soaks, sunbeams dry
  let white = 0;
  for (const c of CASCADES) if (b.s > c.s - 0.5 && b.s < c.s + 4) white = 1;
  if (f.c * W.cur > 2.7) white = Math.max(white, 0.35);
  b.white = white;
  if (!b.air) b.wet += white * 2.5 * W.wet * dt;
  const sun = W.sun(b.s, b.x);
  b.inSun = sun;
  if (sun > 0.55) { b.wet -= 4.5 * dt * (sun - 0.35) / 0.65; b.sunT += dt; }
  b.wet = clamp(b.wet, 0, 100);
  if (b.wet >= 100) ev.push({ type: "sink" });
}

// autopilot: choose the clearest lateral line a few metres ahead, hop twigs, puff in calm water
export function autopilot(b, W, petals) {
  const f = frame(b.s), look = 1.6 + Math.max(0.5, b.vs) * 1.3, sA = b.s + look, fa = frame(sA);
  let best = -1e9, bx = b.x;
  for (let k = 0; k <= 14; k++) {
    const x = -fa.hw + 0.25 + (k / 14) * (fa.hw * 2 - 0.5);
    let sc = -Math.abs(x - b.x) * 0.4 - Math.abs(x) * 0.15;
    for (const r of near(RS, b.s + look * 0.6, look * 0.9)) { if (r.s < b.s - 0.2) continue; const m = r.r + BOAT_R + 0.18, t = clamp((r.s - b.s) / look, 0, 1), xi = b.x + (x - b.x) * t; if (Math.abs(xi - r.x) < m) sc -= 10 * (1.2 - t * 0.5); }
    for (const l of near(LS, b.s + look * 0.6, look)) { if (l.s < b.s) continue; const t = clamp((l.s - b.s) / look, 0, 1), xi = b.x + (x - b.x) * t; if (Math.abs(xi - l.x) < l.r + 0.15) sc -= 3; }
    for (const p of petals) { if (p.got || p.s < b.s + 0.3 || p.s > b.s + look * 1.3) continue; const t = clamp((p.s - b.s) / look, 0, 1), xi = b.x + (x - b.x) * t; if (Math.abs(xi - p.x) < 0.25) sc += p.kind === 2 ? 3 : 1.2; }
    if (Math.abs(WHIRL.s - sA) < WHIRL.r + 1 && Math.abs(x - WHIRL.x) < WHIRL.r) sc -= 6;
    if (sc > best) { best = sc; bx = x; }
  }
  let hDes = clamp(Math.atan2(bx - b.x, look) * 1.6, -0.9, 0.9);
  // straighten up before a cascade
  for (const c of CASCADES) if (c.s - b.s > -0.3 && c.s - b.s < 3.5) hDes = clamp((0 - b.x) * 0.5, -0.25, 0.25);
  const steer = clamp((hDes - b.h) * 3.2 - b.w * 0.3, -1, 1);
  let hop = false;
  for (const t of W.twigs) { const ds = t.s - b.s; if (ds > 0.15 && ds < 0.35 + b.vs * 0.18 && Math.abs(t.x - b.x) < t.len / 2 + 0.15) hop = true; }
  const busy = near(RS, b.s + 2, 2.5).length > 0;
  const puff = !busy && b.breath > 0.9 && f.c < 2.2;
  const drag = false;
  return { steer: Math.abs(steer) < 0.04 ? 0 : steer, puff, hop, drag };
}
