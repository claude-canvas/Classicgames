// NEON VELOCITY — futuristic anti-gravity racing against 7 CPU pilots. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. track.js is the skyway, physics.js the ships
// (fixed 120 Hz step, interpolated for rendering), ai.js the pilots; this file runs the race, input, camera, FX, UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp } from "./mesh.js";
import { F, LENGTH, HALF, frame, toWorld, wrapS } from "./track.js";
import { DT, makeShip, stepShip, collide, VMAX } from "./physics.js";
import { aiInput } from "./ai.js";
import { buildWorld } from "./scene.js";

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
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("neonvelocity.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("neonvelocity.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const seg = {};
{ const O = new Mesh(600000), G = new Mesh(40000), A = new Mesh(8000), stat = new Mesh(660000); buildWorld(O, G, A); for (const [k, m] of [["O", O], ["G", G], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); } space.setStatic(stat.pos, stat.col, stat.n); }

// ------------------------------------------------------------------ ships
const PILOTS = [
  { name: "YOU", col: [0.1, 0.85, 1.0], trim: [1, 0.3, 0.8] }, { name: "VOLT", col: [1.0, 0.85, 0.1], trim: [0.2, 0.2, 0.25] }, { name: "NOVA", col: [1.0, 0.2, 0.55], trim: [1, 1, 1] },
  { name: "KAIJU", col: [0.35, 1.0, 0.35], trim: [0.1, 0.1, 0.1] }, { name: "ORION", col: [0.6, 0.4, 1.0], trim: [0.9, 0.9, 1] }, { name: "BLAZE", col: [1.0, 0.45, 0.1], trim: [0.15, 0.1, 0.1] },
  { name: "ECHO", col: [0.9, 0.9, 0.95], trim: [0.1, 0.6, 1] }, { name: "RIFT", col: [0.95, 0.15, 0.15], trim: [1, 0.85, 0.3] },
];
function shipModel(p) {
  const m = new Mesh(2000), c = p.col, t = p.trim, dark = [0.06, 0.06, 0.08];
  const N = [0, 2.9, 0.3], FL = [-0.85, 1.1, 0.25], FR = [0.85, 1.1, 0.25], ML = [-1.2, -0.7, 0.35], MR = [1.2, -0.7, 0.35], RL = [-1.0, -2.0, 0.42], RR = [1.0, -2.0, 0.42];
  const T1 = [0, 0.9, 0.72], T2 = [0, -1.2, 0.8], B = (p) => [p[0] * 0.85, p[1], 0.08];
  const tri = (a, b, cc, col, mat = MAT.HULL) => m.tri(a, b, cc, col, mat);
  tri(N, FR, T1, c); tri(N, T1, FL, c); tri(T1, FR, MR, c); tri(T1, ML, FL, c); tri(T1, MR, T2, t); tri(T1, T2, ML, t); tri(T2, MR, RR, c); tri(T2, RL, ML, c); tri(T2, RR, RL, dark);
  for (const [a, b] of [[N, FR], [FR, MR], [MR, RR], [RR, RL], [RL, ML], [ML, FL], [FL, N]]) m.quad(a, b, B(b), B(a), dark, MAT.HULL);
  m.quad(B(N), B(FR), B(MR), B(FL), dark, MAT.METAL); m.quad(B(FL), B(MR), B(RR), B(RL), dark, MAT.METAL);
  // canopy
  m.tri([0, 1.6, 0.62], [0.42, 0.55, 0.72], [-0.42, 0.55, 0.72], [0.4, 0.8, 1.0], MAT.GLASS); m.tri([0.42, 0.55, 0.72], [0, -0.3, 0.86], [-0.42, 0.55, 0.72], [0.4, 0.8, 1.0], MAT.GLASS);
  // wings + fins
  for (const sd of [-1, 1]) { tri([sd * 1.15, -0.4, 0.33], [sd * 2.1, -1.5, 0.22], [sd * 1.0, -1.7, 0.4], t); tri([sd * 0.7, -1.4, 0.75], [sd * 0.85, -2.3, 1.45], [sd * 0.9, -2.0, 0.6], c); }
  // neon side strips
  for (const sd of [-1, 1]) m.quad([sd * 0.86, 1.1, 0.2], [sd * 1.21, -0.7, 0.3], [sd * 1.21, -0.7, 0.25], [sd * 0.86, 1.1, 0.15], c.map((v) => v * 1.8), MAT.EMIT);
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
const fx = { sparks: [], streaks: [] };
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
  const f = frame(r.s), back = cam.close ? 6 : 9.5, up = cam.close ? 2.2 : 3.4;
  const bx = cam.x - Math.sin(cam.psi) * back * 0.6;
  const E = toWorld(r.s - back, bx, up), T = toWorld(r.s + 16, r.x + Math.sin(r.psi) * 8, 0.6);
  const sx = (Math.sin(time * 53) + Math.sin(time * 37)) * shake * 0.18;
  E[0] += sx; E[2] += sx * 0.5;
  const speedK = clamp(sh.u / VMAX, 0, 1.4);
  cam.mag += ((1.55 - speedK * 0.32 - (sh.boostT > 0 ? 0.1 : 0)) - cam.mag) * k;
  cam.roll += ((f.bank * 0.8 - r.yaw * 0.06) - cam.roll) * (1 - Math.exp(-dt * 4));
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
  const roll = clamp(-r.yaw * 0.28 - sh.drift * sh.driftDir * 0.25, -0.6, 0.6), cr = Math.cos(roll), sr = Math.sin(roll);
  const R = [rgt[0] * cr + up0[0] * sr, rgt[1] * cr + up0[1] * sr, rgt[2] * cr + up0[2] * sr], Uu = [up0[0] * cr - rgt[0] * sr, up0[1] * cr - rgt[1] * sr, up0[2] * cr - rgt[2] * sr];
  const h = 0.85 + Math.sin(r.bob * 3 + sh.i) * 0.07, O = toWorld(r.s, r.x, h), m = MODELS[sh.i];
  for (let i = 0; i < m.n; i++) { const o = i * 4, x = m.pos[o], y = m.pos[o + 1], z = m.pos[o + 2]; const M = m.col[o + 3] === MAT.GLASS ? Gl : D; M.v(O[0] + R[0] * x + fwd[0] * y + Uu[0] * z, O[1] + R[1] * x + fwd[1] * y + Uu[1] * z, O[2] + R[2] * x + fwd[2] * y + Uu[2] * z, 1, m.col[o], m.col[o + 1], m.col[o + 2], m.col[o + 3]); }
  const c = PILOTS[sh.i].col, boost = sh.boostT > 0;
  // underglow + engine flares
  A.sprite(O[0] - Uu[0] * 0.7, O[1] - Uu[1] * 0.7, O[2] - Uu[2] * 0.7, 2.6, c[0] * 0.18, c[1] * 0.18, c[2] * 0.18);
  for (const sd of [-0.5, 0.5]) { const e = [O[0] + R[0] * sd - fwd[0] * 2.05 + Uu[0] * 0.42, O[1] + R[1] * sd - fwd[1] * 2.05 + Uu[1] * 0.42, O[2] + R[2] * sd - fwd[2] * 2.05 + Uu[2] * 0.42]; const fl = boost ? [0.7, 0.9, 1.6] : [1.4, 0.55, 0.25]; A.sprite(...e, boost ? 1.1 : 0.7, fl[0] * 0.6, fl[1] * 0.6, fl[2] * 0.6); A.sprite(...e, 0.25, 1.5, 1.4, 1.3); }
  // light trail
  const tr = trails.get(sh) || [];
  for (let i = 1; i < tr.length; i++) { const k0 = (i - 1) / tr.length, k1 = i / tr.length; ribbon(A, tr[i - 1], tr[i], 0.07 + (boost ? 0.06 : 0), c.map((v) => v * k0 * 0.28), c.map((v) => v * k1 * 0.28)); }
}
function buildDynamic() {
  D.reset(); A.reset(); Gl.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  for (const sh of ships) drawShip(sh);
  for (const s of fx.sparks) { const k = s.life * 2.5; A.sprite(...s.p, 0.08, s.c[0] * k, s.c[1] * k, s.c[2] * k); }
  // speed streaks around the camera
  const p = me(), sp = p.u / VMAX;
  if (sp > 0.45) { const r = renderState(p); for (let i = 0; i < 26; i++) { const ss = r.s + 6 + ((i * 37.7 + time * p.u) % 70), xx = ((i * 53) % 30) - 15, hh = ((i * 29) % 9) - 1, k = (sp - 0.45) * 0.5; const a = toWorld(ss, xx, hh), b = toWorld(ss + 3 + sp * 4, xx, hh); ribbon(A, a, b, 0.03, [k, k, k * 1.2], [0, 0, 0]); } }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A); const oG = dyn.n; dyn.append(Gl);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: oG - oA, oG, nG: dyn.n - oG };
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [], camS = renderState(me()).s;
  for (const sh of ships) { const r = renderState(sh); let d = r.s - camS; if (d < -LENGTH / 2) d += LENGTH; if (d > LENGTH / 2) d -= LENGTH; L.push({ p: toWorld(r.s, r.x, 0.3), c: PILOTS[sh.i].col, k: sh.boostT > 0 ? 9 : 5, d: Math.abs(d) }); }
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("O"); space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  S("G"); S("A"); space.bind(true); space.draw(o.oG, o.nG); space.draw(o.oA, o.nA);
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
    $("turbo").textContent = p.turbo > 0 ? `TURBO ×${p.turbo} · SPACE` : ""; $("wrong").classList.toggle("show", p.wrong > 1.2);
    $("board").innerHTML = order.map((s, i) => `<div class="${s === p ? "me" : ""}"><b>${i + 1}</b><i style="background:rgb(${PILOTS[s.i].col.map((v) => v * 255)})"></i>${PILOTS[s.i].name}</div>`).join("");
    // minimap
    const c = mini, Wd = c.canvas.width, Hd = c.canvas.height, sc = Math.min((Wd - 20) / (bx1 - bx0), (Hd - 20) / (by1 - by0)), X = (x) => 10 + (x - bx0) * sc, Y = (y) => Hd - 10 - (y - by0) * sc;
    c.clearRect(0, 0, Wd, Hd); c.strokeStyle = "rgba(120,220,255,0.7)"; c.lineWidth = 3; c.beginPath(); F.forEach((f, i) => (i ? c.lineTo(X(f.p[0]), Y(f.p[1])) : c.moveTo(X(f.p[0]), Y(f.p[1])))); c.closePath(); c.stroke();
    for (const s of ships) { const w = toWorld(s.s, s.x); c.fillStyle = `rgb(${PILOTS[s.i].col.map((v) => v * 255)})`; c.beginPath(); c.arc(X(w[0]), Y(w[1]), s === p ? 5 : 3.5, 0, TAU); c.fill(); if (s === p) { c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke(); } }
  },
  title() { $("t-best").textContent = save.best ? `Best race ${fmt(save.best)} · ${save.wins} wins` : "← → steer · A/D drift · W accelerate · S brake"; $("t-diff").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === save.diff)); },
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
