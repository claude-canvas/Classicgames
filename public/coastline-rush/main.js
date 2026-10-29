// COASTLINE RUSH — sunset sports-car racing around an island against 7 CPU drivers. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. track.js is the skyway, physics.js the ships
// (fixed 120 Hz step, interpolated for rendering), ai.js the pilots; this file runs the race, input, camera, FX, UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, limb } from "./mesh.js";
import { F, LENGTH, HALF, frame, toWorld, wrapS } from "./track.js";
import { DT, makeShip, stepShip, collide, VMAX } from "./physics.js";
import { aiInput } from "./ai.js";
import { buildWorld, LAMPS, LIGHTHOUSE } from "./scene.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const audio = new Audio();
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > 2.4e6) dpr *= Math.sqrt(2.4e6 / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
const DEF = { best: 0, wins: 0, volume: 0.8, music: 0.6, diff: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("coastlinerush.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("coastlinerush.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const seg = {};
{ const O = new Mesh(600000), G = new Mesh(80000), A = new Mesh(8000), stat = new Mesh(700000); buildWorld(O, G, A); for (const [k, m] of [["O", O], ["W", G], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); } space.setStatic(stat.pos, stat.col, stat.n); }

// ------------------------------------------------------------------ ships
const PILOTS = [
  { name: "YOU", col: [0.85, 0.05, 0.05] }, { name: "MARCO", col: [0.05, 0.2, 0.75] }, { name: "LUNA", col: [0.95, 0.75, 0.05] },
  { name: "KAITO", col: [0.92, 0.92, 0.92] }, { name: "SOFIA", col: [0.05, 0.45, 0.2] }, { name: "DANTE", col: [0.08, 0.08, 0.09] },
  { name: "AYLA", col: [0.95, 0.35, 0.05] }, { name: "NIKO", col: [0.35, 0.65, 0.95] },
];
// a low wedge sports car: local frame x right, y forward, z up (wheels are drawn separately so they spin)
function shipModel(p) {
  const m = new Mesh(3000), c = p.col, dark = [0.05, 0.05, 0.06], W = 0.98;
  const sec = [[-2.25, 0.85, 0.3, 0.62], [-1.9, 0.98, 0.25, 0.78], [-0.9, 1.0, 0.22, 0.86], [0.4, 1.0, 0.22, 0.8], [1.4, 0.98, 0.22, 0.66], [2.2, 0.85, 0.26, 0.5], [2.35, 0.6, 0.3, 0.42]];
  for (let i = 0; i < sec.length - 1; i++) {
    const [y0, w0, b0, t0] = sec[i], [y1, w1, b1, t1] = sec[i + 1];
    for (const sd of [-1, 1]) m.quad([sd * w0 * W, y0, b0], [sd * w1 * W, y1, b1], [sd * w1 * W * 0.96, y1, t1], [sd * w0 * W * 0.96, y0, t0], c, MAT.HULL);
    m.quad([-w0 * W * 0.96, y0, t0], [w0 * W * 0.96, y0, t0], [w1 * W * 0.96, y1, t1], [-w1 * W * 0.96, y1, t1], c, MAT.HULL);
    m.quad([-w0 * W, y0, b0], [w0 * W, y0, b0], [w1 * W, y1, b1], [-w1 * W, y1, b1], dark, MAT.MATTE);
  }
  m.quad([-0.6, 2.35, 0.3], [0.6, 2.35, 0.3], [0.6, 2.35, 0.42], [-0.6, 2.35, 0.42], dark, MAT.MATTE);
  m.quad([-0.85, -2.25, 0.3], [0.85, -2.25, 0.3], [0.85, -2.25, 0.62], [-0.85, -2.25, 0.62], dark, MAT.MATTE);
  const g = [0.3, 0.35, 0.4], R = [[-0.78, -1.2, 0.84], [0.78, -1.2, 0.84], [0.8, 0.85, 0.82], [-0.8, 0.85, 0.82]], T = [[-0.6, -0.75, 1.28], [0.6, -0.75, 1.28], [0.6, 0.15, 1.3], [-0.6, 0.15, 1.3]];
  m.quad(R[3], R[2], T[2], T[3], g, MAT.GLASS); m.quad(R[0], R[1], T[1], T[0], g, MAT.GLASS); m.quad(R[1], R[2], T[2], T[1], g, MAT.GLASS); m.quad(R[0], T[0], T[3], R[3], g, MAT.GLASS);
  m.quad(T[0], T[1], T[2], T[3], c, MAT.HULL);
  for (const sd of [-0.6, 0.6]) limb(m, [sd, -1.95, 0.6], [sd, -2.05, 0.95], 0.04, 0.04, dark, MAT.METAL, 4);
  m.quad([-0.95, -2.25, 0.95], [0.95, -2.25, 0.95], [0.95, -1.8, 1.0], [-0.95, -1.8, 1.0], c, MAT.HULL);
  for (const sd of [-1, 1]) { m.quad([sd * 0.45, 2.3, 0.45], [sd * 0.82, 2.18, 0.48], [sd * 0.82, 2.18, 0.52], [sd * 0.45, 2.3, 0.49], [2.2, 2.1, 1.9], MAT.EMIT); m.quad([sd * 0.3, -2.26, 0.55], [sd * 0.82, -2.26, 0.55], [sd * 0.82, -2.26, 0.6], [sd * 0.3, -2.26, 0.6], [1.6, 0.05, 0.05], MAT.EMIT); }
  return m;
}
const MODELS = PILOTS.map(shipModel);

// ------------------------------------------------------------------ race state
let ships = [], ai = [], time = 0, state = "loading", raceT = 0, countdown = 0, acc = 0, demo = true, finishOrder = [];
const prev = new Map();
const input = { keys: new Set(), steer: 0, touch: { l: false, r: false, gas: false, brake: false, drift: 0 } };
function setupRace(isDemo) {
  ships = []; ai = []; finishOrder = []; demo = isDemo;
  const base = [[0.84, 0.9], [0.92, 0.98], [0.97, 1.03]][save.diff];
  for (let i = 0; i < 8; i++) {
    const slot = isDemo ? i : [5, 0, 1, 2, 3, 4, 6, 7][i], row = Math.floor(slot / 2);
    const sh = makeShip(i, wrapS(-12 - row * 11), slot % 2 ? 4.5 : -4.5); ships.push(sh);
    ai.push({ skill: base[0] + ((base[1] - base[0]) * ((i * 37) % 7)) / 6, lineOff: ((i % 3) - 1) * 2.2, top: 1 });
  }
  raceT = 0; countdown = isDemo ? 0 : 3.99; acc = 0;
  for (const sh of ships) { sh.u = isDemo ? 60 : 0; prev.set(sh, snap(sh)); trails.set(sh, []); }
}
const snap = (sh) => ({ s: sh.s, x: sh.x, psi: sh.psi, yaw: sh.yaw, bob: sh.bob });

// ------------------------------------------------------------------ input
const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS", "Space"]);
addEventListener("keydown", (e) => { audio.init(); input.keys.add(e.code); if (KEYS.has(e.code)) e.preventDefault(); if (e.code === "KeyC") cam.close = !cam.close; if (e.code === "Escape" || e.code === "KeyP") { if (state === "race") pause(); else if (state === "paused") resume(); } });
addEventListener("keyup", (e) => input.keys.delete(e.code));
const tbtn = (id, on, off) => { const el = $(id); el.addEventListener("pointerdown", (e) => { audio.init(); on(); e.preventDefault(); }); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, off); };
tbtn("t-left", () => (input.touch.l = true), () => (input.touch.l = false)); tbtn("t-right", () => (input.touch.r = true), () => (input.touch.r = false));
tbtn("t-gas", () => (input.touch.gas = true), () => (input.touch.gas = false)); tbtn("t-brake", () => (input.touch.brake = true), () => (input.touch.brake = false));
tbtn("t-dl", () => (input.touch.drift = -1), () => (input.touch.drift = 0)); tbtn("t-dr", () => (input.touch.drift = 1), () => (input.touch.drift = 0));
function playerInput(dt) {
  const k = input.keys, t = input.touch;
  const want = (k.has("ArrowRight") || t.r ? 1 : 0) - (k.has("ArrowLeft") || t.l ? 1 : 0);
  // smooth the digital steer so the ship glides into turns
  input.steer += (want - input.steer) * (1 - Math.exp(-dt * (want === 0 ? 9 : 6)));
  const drift = k.has("KeyA") ? -1 : k.has("KeyD") ? 1 : t.drift;
  return { steer: input.steer, drift, gas: k.has("KeyW") || k.has("ArrowUp") || t.gas ? 1 : 0, brake: k.has("KeyS") || k.has("ArrowDown") || t.brake ? 1 : 0, fire: k.has("Space") };
}

// ------------------------------------------------------------------ update (fixed step)
const fx = { sparks: [], streaks: [], smoke: [] };
const trails = new Map();
let shake = 0, flash = 0, lastBeep = 4;
const me = () => ships[0];
function simStep(dt) {
  const ev = [];
  if (countdown > 0) { for (const sh of ships) { sh.u = 0; } return ev; }
  raceT += dt;
  const p = me();
  for (let i = 0; i < ships.length; i++) {
    const sh = ships[i];
    let inp;
    if (sh.lap > 3) { inp = { steer: aiInput(sh, ships, ai[i]).steer, drift: 0, gas: 0.3, brake: 0, fire: false }; }
    else if (i === 0 && !demo && !bot) inp = playerInput(dt);
    else inp = aiInput(sh, ships, ai[i]);
    // rubber band relative to the player
    let top = 1;
    if (i > 0 && !demo) { const gap = sh.prog - p.prog; top = gap < -150 ? 1.05 : gap > 220 ? 0.95 : 1; }
    sh.braking = inp.brake > 0; sh.spin = (sh.spin || 0) + sh.u * dt / 0.36;
    stepShip(sh, inp, dt, (i > 0 || bot || demo ? ai[i].skill : 1) * top, ev);
    // slipstream
    sh.slip = 0; for (const o of ships) { if (o === sh) continue; let d = o.s - sh.s; if (d < -LENGTH / 2) d += LENGTH; if (d > 4 && d < 26 && Math.abs(o.x - sh.x) < 2.2) sh.slip = 1; }
  }
  collide(ships, ev);
  for (const e of ev) {
    if (e.type === "lap") { if (e.sh.lap === 2 || e.sh.lap === 3) e.sh.turbo = Math.min(2, e.sh.turbo + 1); if (e.sh.lap > 3 && !e.sh.finishT) { e.sh.finishT = raceT; finishOrder.push(e.sh); if (e.sh === p && !demo) onFinish(); } if (e.sh === p && !demo && e.sh.lap >= 2 && e.sh.lap <= 3) { audio.lap(); banner(e.sh.lap === 3 ? "FINAL LAP" : `LAP ${e.sh.lap}`); } }
    if (e.sh === p || e.a === p || e.b === p) {
      if (e.type === "wall") { audio.wall(e.hit); shake = Math.min(1, shake + e.hit * 0.03); for (let k = 0; k < 14; k++) fx.sparks.push(spark(p, Math.sign(p.x))); }
      if (e.type === "turbo") { audio.turbo(e.lvl); flash = 0.25; }
      if (e.type === "pad") { audio.turbo(2); flash = 0.2; }
      if (e.type === "bump") { audio.bump(); shake = Math.min(1, shake + 0.25); }
    }
  }
  if (demo && finishOrder.length >= 8) setupRace(true);
  return ev;
}
function spark(sh, side) { const w = toWorld(sh.s, sh.x + side * 1.2, 0.5), f = frame(sh.s); return { p: w, v: [f.t[0] * sh.u * 0.6 + (Math.random() - 0.5) * 8, f.t[1] * sh.u * 0.6 + (Math.random() - 0.5) * 8, Math.random() * 6], life: 0.5, c: [1, 0.7, 0.3] }; }
function update(dt) {
  time += dt;
  if (state !== "race" && state !== "title") return;
  if (countdown > 0) { countdown -= dt; const c = Math.ceil(countdown); if (c !== lastBeep && c >= 0 && !demo) { lastBeep = c; audio.beep(c === 0); $("count").textContent = c > 0 ? c : "GO!"; $("count").classList.add("show"); if (c === 0) setTimeout(() => $("count").classList.remove("show"), 700); } }
  acc += dt; let n = 0;
  while (acc >= DT && n < 12) { for (const sh of ships) prev.set(sh, snap(sh)); simStep(DT); acc -= DT; n++; }
  for (const sh of ships) sh.bob += dt;
  // FX
  const p = me();
  for (const sh of ships) { if ((sh.drift > 0.4 && sh.u > 15) || (sh.off && sh.u > 12)) for (const sd of [-0.9, 0.9]) if (Math.random() < (sh === p ? 0.9 : 0.35)) { const w = toWorld(sh.s - 1.6, sh.x + sd, 0.3), dirt = sh.off; fx.smoke.push({ p: w, v: [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.6 + Math.random()], life: dirt ? 1.4 : 1.8, max: dirt ? 1.4 : 1.8, c: dirt ? [0.55, 0.45, 0.32] : [0.75, 0.75, 0.78], s: 0.6 }); } }
  for (const q of fx.smoke) { q.p = [q.p[0] + q.v[0] * dt, q.p[1] + q.v[1] * dt, q.p[2] + q.v[2] * dt]; q.s += dt * 2.2; q.life -= dt; }
  fx.smoke = fx.smoke.filter((q) => q.life > 0).slice(-500);
  if (p.drift > 0.5 && p.u > 30) { const lvl = Math.floor(p.charge), c = lvl >= 3 ? [1, 0.3, 0.9] : lvl >= 2 ? [1, 0.6, 0.15] : lvl >= 1 ? [0.3, 0.7, 1] : [0.8, 0.8, 0.8]; for (const sd of [-1, 1]) if (Math.random() < 0.7) { const w = toWorld(p.s - 1.8, p.x + sd * 0.9, 0.2); fx.sparks.push({ p: w, v: [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, Math.random() * 4], life: 0.35, c }); } }
  for (const s of fx.sparks) { s.p = [s.p[0] + s.v[0] * dt, s.p[1] + s.v[1] * dt, s.p[2] + s.v[2] * dt]; s.v[2] -= 15 * dt; s.life -= dt; }
  fx.sparks = fx.sparks.filter((s) => s.life > 0).slice(-400);
  for (const sh of ships) { const tr = trails.get(sh); const r = renderState(sh); for (const sd of [-0.5, 0.5]) { } tr.push(toWorld(r.s - 2.0, r.x, 0.95 + Math.sin(r.bob * 3) * 0.05)); if (tr.length > 22) tr.shift(); }
  shake = Math.max(0, shake - dt * 2); flash = Math.max(0, flash - dt * 1.5);
  audio.update(p.u, p.drift, p.boostT > 0);
  ui.frame();
}
const alpha = () => acc / DT;
function renderState(sh) {
  const a = prev.get(sh) || snap(sh), t = alpha();
  let ds = sh.s - a.s; if (ds > LENGTH / 2) ds -= LENGTH; if (ds < -LENGTH / 2) ds += LENGTH;
  return { s: wrapS(a.s + ds * t), x: lerp(a.x, sh.x, t), psi: lerp(a.psi, sh.psi, t), yaw: lerp(a.yaw, sh.yaw, t), bob: sh.bob };
}

// ------------------------------------------------------------------ camera (smoothed in track space → never jitters)
const cam = { x: 0, psi: 0, roll: 0, mag: 1.6, close: false, init: false, s: 0 };
function updateCamera(dt) {
  const sh = demo && state === "title" ? ships[Math.floor(time / 9) % 8] : me(), r = renderState(sh);
  if (!cam.init) { cam.x = r.x; cam.init = true; }
  const k = 1 - Math.exp(-dt * 5);
  cam.x += (r.x - cam.x) * k; cam.psi += (r.psi - cam.psi) * (1 - Math.exp(-dt * 4));
  const f = frame(r.s), back = cam.close ? 0.2 : 7.2, up = cam.close ? 1.15 : 2.3;
  const bx = cam.x - Math.sin(cam.psi) * back * 0.6;
  const E = cam.close ? toWorld(r.s + 0.3, r.x, up) : toWorld(r.s - back, bx, up), T = toWorld(r.s + 16, r.x + Math.sin(r.psi) * 8, cam.close ? 0.9 : 1.1);
  const sx = (Math.sin(time * 53) + Math.sin(time * 37)) * shake * 0.18;
  E[0] += sx; E[2] += sx * 0.5;
  const speedK = clamp(sh.u / VMAX, 0, 1.4);
  cam.mag += ((1.6 - speedK * 0.3 - (sh.boostT > 0 ? 0.12 : 0)) - cam.mag) * k;
  cam.roll += ((f.bank * 0.7 - r.yaw * 0.035) - cam.roll) * (1 - Math.exp(-dt * 4));
  space.magnifier = cam.mag * 1.6;
  space.lookAt(E[0], E[1], E[2], T[0], T[1], T[2]);
  space.roll(cam.roll);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(80000), A = new Mesh(40000), Gl = new Mesh(4000), dyn = new Mesh(140000);
function ribbon(M, p0, p1, w, c0, c1) { const E = [space.Xc, space.Yc, space.Zc], d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v)); M.quad4([p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w], [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w], c0, c0, c1, c1, MAT.ADD); }
function drawShip(sh) {
  const r = renderState(sh), f = frame(r.s), cp = Math.cos(r.psi), sp = Math.sin(r.psi);
  const fwd = [f.t[0] * cp + f.r[0] * sp, f.t[1] * cp + f.r[1] * sp, f.t[2] * cp + f.r[2] * sp], rgt = [f.r[0] * cp - f.t[0] * sp, f.r[1] * cp - f.t[1] * sp, f.r[2] * cp - f.t[2] * sp], up0 = f.u;
  // body roll from cornering, slight dive under braking
  const roll = clamp(r.yaw * 0.06 * Math.min(1, sh.u / 30) + sh.drift * sh.driftDir * 0.03, -0.1, 0.1), cr = Math.cos(roll), sr = Math.sin(roll);
  const R = [rgt[0] * cr + up0[0] * sr, rgt[1] * cr + up0[1] * sr, rgt[2] * cr + up0[2] * sr], Uu = [up0[0] * cr - rgt[0] * sr, up0[1] * cr - rgt[1] * sr, up0[2] * cr - rgt[2] * sr];
  const pitch = sh.braking ? -0.025 : 0, Fw = [fwd[0] + Uu[0] * pitch, fwd[1] + Uu[1] * pitch, fwd[2] + Uu[2] * pitch];
  const O = toWorld(r.s, r.x, 0.08 + (sh.air || 0) * 0.15), m = MODELS[sh.i];
  const X = (x, y, z) => [O[0] + R[0] * x + Fw[0] * y + Uu[0] * z, O[1] + R[1] * x + Fw[1] * y + Uu[1] * z, O[2] + R[2] * x + Fw[2] * y + Uu[2] * z];
  for (let i = 0; i < m.n; i++) { const o = i * 4, q = X(m.pos[o], m.pos[o + 1], m.pos[o + 2]); const M = m.col[o + 3] === MAT.GLASS ? Gl : D; M.v(q[0], q[1], q[2], 1, m.col[o], m.col[o + 1], m.col[o + 2], m.col[o + 3]); }
  // wheels: spinning tyres with bright rims; the fronts steer
  const spin = sh.spin || 0, steerA = clamp(r.yaw * 0.25, -0.35, 0.35);
  for (const [wx, wy] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.4], [0.95, -1.4]]) {
    const N = 10, rad = 0.36, wd = 0.28, st = wy > 0 ? steerA : 0, ca = Math.cos(st), sa = Math.sin(st);
    const P = (a, side, rr) => { const ly = Math.cos(a) * rr, lz = Math.sin(a) * rr; return X(wx + side * ca + ly * sa, wy + ly * ca - side * sa, rad + lz); };
    for (let k = 0; k < N; k++) {
      const a0 = spin + (k / N) * TAU, a1 = spin + ((k + 1) / N) * TAU;
      D.quad(P(a0, -wd / 2, rad), P(a1, -wd / 2, rad), P(a1, wd / 2, rad), P(a0, wd / 2, rad), [0.04, 0.04, 0.045], MAT.MATTE);
      const so = Math.sign(wx) * wd / 2; D.tri(P(a0, so, 0), P(a0, so, rad * 0.92), P(a1, so, rad * 0.92), k % 2 ? [0.75, 0.75, 0.78] : [0.3, 0.3, 0.32], MAT.METAL);
    }
  }
  // head/tail lights glow, brake flare, nitro flame
  for (const q of [X(-0.62, 2.35, 0.48), X(0.62, 2.35, 0.48)]) A.sprite(...q, 0.5, 0.7, 0.65, 0.5);
  for (const q of [X(-0.6, -2.28, 0.58), X(0.6, -2.28, 0.58)]) A.sprite(...q, sh.braking ? 0.9 : 0.4, sh.braking ? 1.4 : 0.5, 0.05, 0.03);
  if (sh.boostT > 0) for (const sd of [-0.35, 0.35]) { A.sprite(...X(sd, -2.4, 0.38), 0.9, 0.4, 0.6, 1.4); A.sprite(...X(sd, -2.9, 0.38), 0.7, 0.9, 0.35, 0.1); }
  // contact shadow
  const s0 = toWorld(r.s, r.x, 0.04);
  D.quad([s0[0] - R[0] * 1.1 - fwd[0] * 2.4, s0[1] - R[1] * 1.1 - fwd[1] * 2.4, s0[2]], [s0[0] + R[0] * 1.1 - fwd[0] * 2.4, s0[1] + R[1] * 1.1 - fwd[1] * 2.4, s0[2]], [s0[0] + R[0] * 1.1 + fwd[0] * 2.4, s0[1] + R[1] * 1.1 + fwd[1] * 2.4, s0[2]], [s0[0] - R[0] * 1.1 + fwd[0] * 2.4, s0[1] - R[1] * 1.1 + fwd[1] * 2.4, s0[2]], [0.02, 0.02, 0.02], MAT.MATTE);
}
function buildDynamic() {
  D.reset(); A.reset(); Gl.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  for (const sh of ships) drawShip(sh);
  for (const s of fx.sparks) { const k = s.life * 2.5; A.sprite(...s.p, 0.08, s.c[0] * k, s.c[1] * k, s.c[2] * k); }
  for (const q of fx.smoke) { const k = (q.life / q.max) * 0.09; A.sprite(...q.p, q.s, q.c[0] * k, q.c[1] * k, q.c[2] * k); }
  if (LIGHTHOUSE.p) { const a = time * 0.9, L = LIGHTHOUSE.p; for (let i = 1; i < 12; i++) { const k = (1 - i / 12) * 0.25; A.sprite(L[0] + Math.cos(a) * i * 14, L[1] + Math.sin(a) * i * 14, L[2], 3 + i * 1.2, k, k * 0.85, k * 0.6); } }
  // speed streaks around the camera
  const p = me(), sp = p.u / VMAX;
  if (sp > 0.6) { const r = renderState(p); for (let i = 0; i < 26; i++) { const ss = r.s + 6 + ((i * 37.7 + time * p.u) % 70), xx = ((i * 53) % 30) - 15, hh = ((i * 29) % 9) - 1, k = (sp - 0.45) * 0.5; const a = toWorld(ss, xx, hh), b = toWorld(ss + 3 + sp * 4, xx, hh); ribbon(A, a, b, 0.03, [k, k, k * 1.2], [0, 0, 0]); } }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A); const oG = dyn.n; dyn.append(Gl);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: oG - oA, oG, nG: dyn.n - oG };
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [], pr = renderState(me()), camP = toWorld(pr.s, pr.x, 1);
  for (const sh of ships) { const r = renderState(sh); let d = r.s - pr.s; if (d < -LENGTH / 2) d += LENGTH; if (d > LENGTH / 2) d -= LENGTH; if (Math.abs(d) < 80) L.push({ p: toWorld(r.s + 5, r.x, 0.8), c: [1, 0.9, 0.7], k: 2.5, d: Math.abs(d) }); if (sh.braking && Math.abs(d) < 60) L.push({ p: toWorld(r.s - 3, r.x, 0.6), c: [1, 0.1, 0.05], k: 1.5, d: Math.abs(d) + 5 }); }
  for (const q of LAMPS) L.push({ p: q, c: [1, 0.7, 0.35], k: 6, d: Math.hypot(q[0] - camP[0], q[1] - camP[1], q[2] - camP[2]) * 0.5 + 10 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
const SUN = nrm([-0.75, 0.6, 0.12]);
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform3fv(U.uSun, SUN);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("O"); S("W"); space.bind(true); space.draw(o.oD, o.nD); space.draw(o.oG, o.nG);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: flash });
}

// ------------------------------------------------------------------ UI
const mini = $("mini").getContext("2d");
let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; for (const f of F) { bx0 = Math.min(bx0, f.p[0]); by0 = Math.min(by0, f.p[1]); bx1 = Math.max(bx1, f.p[0]); by1 = Math.max(by1, f.p[1]); }
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
let banT = 0;
function banner(t) { $("banner").textContent = t; $("banner").classList.add("show"); clearTimeout(banT); banT = setTimeout(() => $("banner").classList.remove("show"), 1600); }
function standings() { return ships.slice().sort((a, b) => (a.finishT && b.finishT ? a.finishT - b.finishT : a.finishT ? -1 : b.finishT ? 1 : b.prog - a.prog)); }
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  frame() {
    if (state !== "race") return;
    const p = me(), order = standings(), pos = order.indexOf(p) + 1;
    $("h-pos").innerHTML = `${pos}<small>/8</small>`; $("h-lap").textContent = `LAP ${clamp(p.lap, 1, 3)}/3`;
    $("h-time").textContent = fmt(raceT); $("h-spd").textContent = Math.round(p.u * 3.6);
    $("spd-i").style.width = clamp(p.u / 128, 0, 1) * 100 + "%"; $("spd").classList.toggle("boost", p.boostT > 0);
    const lvl = Math.floor(p.charge); $("drift-i").style.width = (p.charge / 3.2) * 100 + "%"; $("drift-i").className = "l" + lvl; $("drift").style.opacity = p.drift > 0.1 ? 1 : 0.3;
    $("turbo").textContent = p.turbo > 0 ? `NITRO ×${p.turbo} · SPACE` : ""; $("wrong").classList.toggle("show", p.wrong > 1.2);
    $("board").innerHTML = order.map((s, i) => `<div class="${s === p ? "me" : ""}"><b>${i + 1}</b><i style="background:rgb(${PILOTS[s.i].col.map((v) => v * 255)})"></i>${PILOTS[s.i].name}</div>`).join("");
    // minimap
    const c = mini, Wd = c.canvas.width, Hd = c.canvas.height, sc = Math.min((Wd - 20) / (bx1 - bx0), (Hd - 20) / (by1 - by0)), X = (x) => 10 + (x - bx0) * sc, Y = (y) => Hd - 10 - (y - by0) * sc;
    c.clearRect(0, 0, Wd, Hd); c.strokeStyle = "rgba(120,220,255,0.7)"; c.lineWidth = 3; c.beginPath(); F.forEach((f, i) => (i ? c.lineTo(X(f.p[0]), Y(f.p[1])) : c.moveTo(X(f.p[0]), Y(f.p[1])))); c.closePath(); c.stroke();
    for (const s of ships) { const w = toWorld(s.s, s.x); c.fillStyle = `rgb(${PILOTS[s.i].col.map((v) => v * 255)})`; c.beginPath(); c.arc(X(w[0]), Y(w[1]), s === p ? 5 : 3.5, 0, TAU); c.fill(); if (s === p) { c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke(); } }
  },
  title() { $("t-best").textContent = save.best ? `Best race ${fmt(save.best)} · ${save.wins} wins` : "← → steer · A/D handbrake drift · W throttle · S brake · Space nitro"; $("t-diff").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === save.diff)); },
};
function startRace() { setupRace(false); state = "race"; cam.init = false; lastBeep = 4; ui.show("hud"); }
function onFinish() {
  const p = me(), pos = standings().indexOf(p) + 1;
  audio.finish(pos);
  if (pos === 1) save.wins++; const nb = !save.best || p.finishT < save.best; if (nb) save.best = p.finishT; persist();
  banner(pos === 1 ? "VICTORY!" : `FINISHED P${pos}`);
  setTimeout(() => {
    state = "results"; const order = standings();
    $("r-k").textContent = pos === 1 ? "Champion of the skyway" : "Race complete"; $("r-pos").textContent = `P${pos}`;
    $("r-list").innerHTML = order.map((s, i) => `<div class="${s === p ? "me" : ""}"><b>${i + 1}</b><i style="background:rgb(${PILOTS[s.i].col.map((v) => v * 255)})"></i><span>${PILOTS[s.i].name}</span><em>${s.finishT ? fmt(s.finishT) : "—"}</em></div>`).join("");
    $("r-best").textContent = nb ? "New best time!" : `Best ${fmt(save.best)}`;
    $("m-res").classList.remove("hidden");
  }, 2500);
}
function pause() { state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); state = "race"; }
function toTitle() { for (const m of ["m-pause", "m-res", "m-set"]) $(m).classList.add("hidden"); setupRace(true); state = "title"; ui.show("title"); ui.title(); }
$("b-race").onclick = () => { audio.init(); startRace(); };
$("t-diff").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.diff = +b.dataset.v; persist(); ui.title(); });
$("b-pause").onclick = pause; $("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startRace(); }; $("p-title").onclick = toTitle;
$("r-again").onclick = () => { $("m-res").classList.add("hidden"); startRace(); }; $("r-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("b-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };

const bot = Q.has("auto");
window.__race = () => { const p = me(); return { state, t: +raceT.toFixed(1), lap: p.lap, pos: standings().indexOf(p) + 1, kmh: Math.round(p.u * 3.6), x: +p.x.toFixed(1), fps }; };
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frameLoop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  update(dt); render(dt);
  requestAnimationFrame(frameLoop);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
setupRace(true); state = "title";
requestAnimationFrame(frameLoop);
setTimeout(() => { $("loading").classList.add("out"); ui.show("title"); ui.title(); if (bot || Q.has("race")) startRace(); }, 400);
