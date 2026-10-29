// Last Light — the forest's life (DESIGN.md §1): fireflies, the seven lantern-caps, and Old Hush the owl.
// All positions in metres, Z-up, world frame. Meshes are built with mesh.js in Space's vertex format.
import { Mesh, blob, limb, smoothNormals, mulberry32 } from "./mesh.js";
import { MX } from "./wick.js";

const TAU = Math.PI * 2, SOFT = 1;
export const NEED = 3, CARRY = 6;

// ------------------------------------------------------------------ lantern-caps: a cluster of three mushrooms
// built twice: dusky (unlit, shaded by the scene) and glowing (drawn unlit with colours above 1, so they bloom)
function capMesh(x, y, z, seed, glow) {
  const m = new Mesh(6000), r = mulberry32(seed);
  // glowing colours sit just above 1 so the tone curve keeps them warm gold instead of washing them out to white
  const stem = glow ? [1.15, 0.95, 0.62] : [0.86, 0.8, 0.7], top = glow ? [1.75, 1.08, 0.36] : [0.42, 0.44, 0.52], gill = glow ? [1.5, 1.15, 0.5] : [0.7, 0.66, 0.6], spot = glow ? [2.1, 1.7, 0.9] : [0.82, 0.8, 0.78];
  const shrooms = [[0, 0, 0.1, 0.042], [0.05, 0.02, 0.07, 0.03], [-0.035, 0.04, 0.055, 0.024]];
  for (const [dx, dy, h, rc] of shrooms) {
    const lean = (r() - 0.5) * 0.25, bx = x + dx, by = y + dy, tx = bx + lean * h * 0.5, ty = by + (r() - 0.5) * 0.02;
    limb(m, [bx, by, z - 0.01], [tx, ty, z + h], rc * 0.28, rc * 0.2, stem, SOFT, 8);
    blob(m, [tx, ty, z + h + rc * 0.12], rc, rc, rc * 0.55, top, SOFT, 14, 7, (i, j) => (j > 3 ? 0.35 : 1), (i, j) => (j > 3 ? gill : top));
    for (let k = 0; k < 5; k++) { const a = r() * TAU, rr = rc * (0.3 + r() * 0.45); blob(m, [tx + Math.cos(a) * rr, ty + Math.sin(a) * rr, z + h + rc * 0.12 + rc * 0.5 * Math.sqrt(1 - (rr / rc) ** 2)], rc * 0.11, rc * 0.11, rc * 0.05, spot, SOFT, 6, 3); }
  }
  return { m, nrm: smoothNormals(m.pos, m.n) };
}
export function makeCaps(gl, spots) {
  const vb = (d) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); return o; };
  const upload = (M) => ({ pb: vb(M.m.pos.subarray(0, M.m.n * 4)), cb: vb(M.m.col.subarray(0, M.m.n * 4)), nb: vb(M.nrm), n: M.m.n });
  return spots.map(([x, y, z, name], i) => ({ x, y, z, name, have: 0, lit: false, litT: 0, dark: upload(capMesh(x, y, z, 101 + i * 17, false)), glow: upload(capMesh(x, y, z, 101 + i * 17, true)) }));
}

// ------------------------------------------------------------------ fireflies
export function makeFireflies(n, place, rnd = Math.random) {
  const flies = [];
  for (let i = 0; i < n; i++) { const [x, y, z] = place(); flies.push({ home: [x, y], gz: z, x, y, z: z + 0.08, state: "free", ph: rnd() * 100, blink: rnd() * 10, from: null, t: 0, cap: null }); }
  return flies;
}
// the chain of carried fireflies trails behind the lantern; free ones wander around home, blinking
export function stepFireflies(flies, caps, wick, lantern, dt, time, world, events) {
  let carried = 0;
  const chain = [lantern[0] - Math.cos(wick.h) * 0.02, lantern[1] - Math.sin(wick.h) * 0.02, lantern[2] + 0.01];
  for (const f of flies) {
    f.ph += dt;
    if (f.state === "free") {
      const ax = Math.sin(f.ph * 0.37) * 0.35 + Math.sin(f.ph * 0.91 + 2) * 0.12, ay = Math.cos(f.ph * 0.29) * 0.35 + Math.sin(f.ph * 0.73) * 0.12;
      const tx = f.home[0] + ax, ty = f.home[1] + ay, g = world.ground(tx, ty, f.gz + 0.3, 0.3) ?? f.gz;
      const tz = g + 0.045 + (Math.sin(f.ph * 0.8) * 0.5 + 0.5) * 0.06;
      const k = Math.min(1, dt * 1.5); f.x += (tx - f.x) * k; f.y += (ty - f.y) * k; f.z += (tz - f.z) * k;
      // Wick brushes past: it joins the chain
      if (Math.hypot(f.x - wick.x, f.y - wick.y) < 0.13 && Math.abs(f.z - (wick.z + 0.05)) < 0.16 && countCarried(flies) < CARRY) { f.state = "carried"; events.push({ type: "collect", x: f.x, y: f.y, z: f.z }); }
    } else if (f.state === "carried") {
      carried++;
      const k = Math.min(1, dt * (9 - carried * 0.9)), wob = 0.012;
      const tx = chain[0] + Math.sin(f.ph * 3.1) * wob, ty = chain[1] + Math.cos(f.ph * 2.7) * wob, tz = chain[2] + Math.sin(f.ph * 2.3) * wob;
      f.x += (tx - f.x) * k; f.y += (ty - f.y) * k; f.z += (tz - f.z) * k;
      chain[0] = f.x - Math.cos(wick.h) * 0.025; chain[1] = f.y - Math.sin(wick.h) * 0.025; chain[2] = f.z + 0.004;
    } else if (f.state === "flying") {
      // an arc from where it was to the target (a cap, or a new home when scattered)
      f.t += dt / f.dur; const t = Math.min(1, f.t), s = t * t * (3 - 2 * t);
      f.x = f.from[0] + (f.to[0] - f.from[0]) * s; f.y = f.from[1] + (f.to[1] - f.from[1]) * s; f.z = f.from[2] + (f.to[2] - f.from[2]) * s + Math.sin(t * Math.PI) * f.arc;
      if (t >= 1) {
        if (f.cap) { f.state = "spent"; f.cap.have++; events.push({ type: "deposit", cap: f.cap }); if (f.cap.have >= NEED && !f.cap.lit) { f.cap.lit = true; f.cap.litT = 0; events.push({ type: "lit", cap: f.cap }); } }
        else { f.state = "free"; f.home = [f.to[0], f.to[1]]; f.gz = world.ground(f.to[0], f.to[1], f.to[2] + 0.3, 0.3) ?? f.gz; }
      }
    }
  }
  // near an unlit cap: the carried fireflies fly in, one every 0.22 s
  for (const c of caps) {
    if (c.lit || Math.hypot(c.x - wick.x, c.y - wick.y) > 0.32) continue;
    const owed = NEED - c.have - flies.filter((f) => f.state === "flying" && f.cap === c).length;
    if (owed <= 0) continue;
    c.next = (c.next ?? 0) - dt; if (c.next > 0) continue;
    const f = flies.find((q) => q.state === "carried"); if (!f) continue;
    c.next = 0.22;
    Object.assign(f, { state: "flying", from: [f.x, f.y, f.z], to: [c.x, c.y, c.z + 0.11], t: 0, dur: 0.55, arc: 0.05, cap: c });
  }
  for (const c of caps) if (c.lit) c.litT += dt;
}
export const countCarried = (flies) => { let n = 0; for (const f of flies) if (f.state === "carried") n++; return n; };
// the owl strikes: every carried firefly scatters to a new home nearby
// snap(x, y) → [x, y, z] of reachable floor near (x, y), so a scattered firefly never lands out of reach
export function scatter(flies, wick, snap) {
  let n = 0;
  for (const f of flies) if (f.state === "carried") {
    const a = Math.random() * TAU, r = 0.5 + Math.random() * 1.2, [tx, ty, g] = snap(wick.x + Math.cos(a) * r, wick.y + Math.sin(a) * r);
    Object.assign(f, { state: "flying", from: [f.x, f.y, f.z], to: [tx, ty, g + 0.07], t: 0, dur: 0.9 + Math.random() * 0.5, arc: 0.25, cap: null }); n++;
  }
  return n;
}

// ------------------------------------------------------------------ Old Hush, the owl: body + two wings (bones 0–2)
export function buildOwl() {
  const m = new Mesh(5000), BR = [0.26, 0.19, 0.13], LT = [0.62, 0.52, 0.4], FACE = [0.78, 0.68, 0.55];
  const tag = (f, b) => { for (let i = f; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + b; };
  let f = m.n;
  blob(m, [0, 0, 0], 0.11, 0.16, 0.12, BR, SOFT, 14, 8, null, (i, j) => (j > 4 ? LT : BR));
  blob(m, [0, 0.13, 0.04], 0.1, 0.09, 0.09, BR, SOFT, 12, 8);
  blob(m, [0, 0.2, 0.04], 0.075, 0.025, 0.07, FACE, SOFT, 12, 6);
  for (const s of [-1, 1]) { blob(m, [s * 0.033, 0.223, 0.05], 0.018, 0.008, 0.018, [0.05, 0.04, 0.03], SOFT, 8, 4); blob(m, [s * 0.033, 0.229, 0.05], 0.008, 0.004, 0.008, [2.4, 1.9, 0.6], SOFT, 6, 3); }
  blob(m, [0, -0.2, -0.01], 0.07, 0.09, 0.02, BR, SOFT, 10, 4);
  tag(f, 0);
  for (const [s, b] of [[-1, 1], [1, 2]]) { f = m.n; blob(m, [s * 0.3, -0.01, 0.02], 0.27, 0.12, 0.018, BR, SOFT, 16, 4, (i) => 1 - 0.25 * Math.abs(Math.sin(i * 1.4)), (i, j) => (j > 2 ? LT : BR)); tag(f, b); }
  return { m, nrm: smoothNormals(m.pos, m.n) };
}
// the owl circles above its hunting point. Awareness fills while Wick is out in the open nearby and drains while he
// hides; the owl heads for where it last saw him, faster the surer it is, and at full awareness right over him it
// locks on and dives. A dive that arrives while he is back in the grass misses.
export function makeOwl() { return { hx: 8, hy: 8, a: 0, x: 0, y: 0, z: 8, h: 0, flap: 0, lock: 0, cool: 6, dive: 0, diveFrom: null, seen: false, aware: 0, last: null, active: false, vis: 0 }; }
export function stepOwl(o, wick, exposed, dt, active, world, events) {
  o.active = active; o.vis += ((active ? 1 : 0) - o.vis) * Math.min(1, dt * 0.5);
  if (!active && !o.dive) return;
  o.cool = Math.max(0, o.cool - dt);
  const d = Math.hypot(wick.x - o.hx, wick.y - o.hy);
  const sees = exposed && d < 12 && o.cool <= 0;
  o.aware = Math.max(0, Math.min(1, o.aware + (sees ? 0.55 : -0.3) * dt));
  if (sees) o.last = [wick.x, wick.y];
  o.seen = o.aware > 0.15;
  if (o.dive) {
    o.dive += dt / 1.3; const t = Math.min(1, o.dive);
    const k = t < 0.55 ? (t / 0.55) ** 2 : 1 - ((t - 0.55) / 0.45) ** 0.6 * 0.9;
    const tz = (world.ground(o.hx, o.hy, 10) ?? wick.z) + 0.08;
    o.x = o.diveFrom[0] + (o.hx - o.diveFrom[0]) * Math.min(1, t / 0.55); o.y = o.diveFrom[1] + (o.hy - o.diveFrom[1]) * Math.min(1, t / 0.55); o.z = o.diveFrom[2] + (tz - o.diveFrom[2]) * k;
    if (!o.struck && t >= 0.55) { o.struck = true; events.push({ type: Math.hypot(wick.x - o.hx, wick.y - o.hy) < 0.45 && exposed ? "strike" : "miss" }); }
    if (t >= 1) { o.dive = 0; o.cool = 14; o.lock = 0; o.aware = 0; }
    o.flap += dt * 3; return;
  }
  // the hunting point: toward Wick while he is seen, else a slow wander around the clearing
  // aware: it glides toward where it last saw him, up to faster than a mouse can scurry; else it patrols near him
  if (o.seen && o.last) { const lx = o.last[0] - o.hx, ly = o.last[1] - o.hy, ll = Math.hypot(lx, ly), k = Math.min(1, ((0.7 + o.aware * 0.8) * dt) / Math.max(ll, 1e-3)); o.hx += lx * k; o.hy += ly * k; }
  else {
    if (!o.patrol || Math.hypot(o.patrol[0] - o.hx, o.patrol[1] - o.hy) < 0.5) { const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6; o.patrol = [wick.x + Math.cos(a) * r, wick.y + Math.sin(a) * r]; }
    const px = o.patrol[0] - o.hx, py = o.patrol[1] - o.hy, pl = Math.hypot(px, py) || 1; o.hx += (px / pl) * 0.75 * dt; o.hy += (py / pl) * 0.75 * dt;
  }
  // locked on: half a second over him in the open, then the swoop
  if (o.aware > 0.85 && d < 0.8) { o.lock += dt; if (o.lock > 0.7) { o.dive = 1e-6; o.struck = false; o.diveFrom = [o.x, o.y, o.z]; o.hx = wick.x; o.hy = wick.y; events.push({ type: "swoop" }); } }
  else o.lock = Math.max(0, o.lock - dt * 0.5);
  o.a += dt * 0.35; const R = 4.5;
  o.x = o.hx + Math.cos(o.a) * R; o.y = o.hy + Math.sin(o.a) * R; o.z = (world.ground(o.hx, o.hy, 10) ?? 1.5) + 3.8 + Math.sin(o.a * 1.7) * 0.5;
  o.h = o.a + Math.PI / 2; o.flap += dt * (Math.sin(o.a * 2.3) > 0.6 ? 7 : 0.6);
}
const obones = new Float32Array(23 * 12);
export function owlBones(o) {
  const base = MX.mul(MX.mul(MX.T(o.x, o.y, o.z), MX.Z(o.h - Math.PI / 2)), MX.Y(o.dive ? 0 : -0.25));
  const f = Math.sin(o.flap) * 0.55 - (o.dive && o.dive < 0.55 ? 0.9 : 0);
  obones.set(base, 0);
  obones.set(MX.mul(base, MX.mul(MX.T(-0.06, 0, 0), MX.mul(MX.Y(f), MX.T(0.06, 0, 0)))), 12);
  obones.set(MX.mul(base, MX.mul(MX.T(0.06, 0, 0), MX.mul(MX.Y(-f), MX.T(-0.06, 0, 0)))), 24);
  return obones;
}
