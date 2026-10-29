// ORBIT BREAKER — polar breakout around a star core. Rendered with the projection3d library (Space, via GameSpace) +
// custom shaders + bloom. See DESIGN.md. game.js holds the rules, waves.js the brick patterns; this file runs input,
// the 3D arena, effects and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, blob } from "./mesh.js";
import { WAVES } from "./waves.js";
import { newGame, startWave, step, launch, padWidth, brickAngles, autoPad, PAD_R, BALL_R, CORE_R, ARENA } from "./game.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ canvas + library
const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const audio = new Audio();
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > 3.2e6) dpr *= Math.sqrt(3.2e6 / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}

// ------------------------------------------------------------------ save
const DEF = { best: 0, bestWave: 0, volume: 0.8, music: 0.6 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("orbitbreaker.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("orbitbreaker.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static arena: floor disc + outer ring
{
  const S = new Mesh(30000), N = 96;
  for (let j = 0; j < 12; j++) for (let i = 0; i < N; i++) {
    const r0 = (j / 12) * ARENA * 1.08, r1 = ((j + 1) / 12) * ARENA * 1.08, a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
    S.quad([Math.cos(a0) * r0, Math.sin(a0) * r0, 0], [Math.cos(a1) * r0, Math.sin(a1) * r0, 0], [Math.cos(a1) * r1, Math.sin(a1) * r1, 0], [Math.cos(a0) * r1, Math.sin(a0) * r1, 0], [1, 1, 1], MAT.FLOOR);
  }
  // rim wall outside the paddle orbit
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, R = ARENA * 1.08;
    S.quad([Math.cos(a0) * R, Math.sin(a0) * R, 0], [Math.cos(a1) * R, Math.sin(a1) * R, 0], [Math.cos(a1) * R, Math.sin(a1) * R, 0.5], [Math.cos(a0) * R, Math.sin(a0) * R, 0.5], [0.15, 0.17, 0.25], MAT.GLOSS);
    S.quad([Math.cos(a0) * R, Math.sin(a0) * R, 0.5], [Math.cos(a1) * R, Math.sin(a1) * R, 0.5], [Math.cos(a1) * (R + 0.6), Math.sin(a1) * (R + 0.6), 0.45], [Math.cos(a0) * (R + 0.6), Math.sin(a0) * (R + 0.6), 0.45], [0.2, 0.22, 0.32], MAT.GLOSS);
  }
  space.setStatic(S.pos, S.col, S.n);
  var STATIC_N = S.n;
}

// ------------------------------------------------------------------ state
const TYPE_COL = { c: [0.2, 0.85, 1.0], d: [0.6, 0.4, 1.0], t: [1.0, 0.3, 0.75], m: [0.55, 0.6, 0.7], b: [1.0, 0.45, 0.15], p: [1, 1, 1] };
let g = newGame(), time = 0, state = "loading", shake = 0, flash = 0, coreFlare = 0, demo = true;
const fx = { shards: [], sparks: [], rings: [] };
const input = { pad: null, fire: false, keys: new Set() };
function startGame(w = 0) { g = newGame(); startWave(g, w); state = "play"; demo = false; ui.show("hud"); banner(`WAVE ${w + 1}`, WAVES[w].name); ui.hud(); }
function startDemo() { g = newGame(); startWave(g, 3); demo = true; launch(g); }

// ------------------------------------------------------------------ input
function pointerAngle(cx, cy) {
  const mag = space.magnifier, aspect = canvas.width / canvas.height, nx = (cx / innerWidth) * 2 - 1, ny = 1 - (cy / innerHeight) * 2;
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * (1.6 / mag) + Y[i] * ny * (1.6 / (mag * aspect)));
  const E = [space.Xc, space.Yc, space.Zc], t = -E[2] / (d[2] || -1e-6);
  return Math.atan2(E[1] + d[1] * t, E[0] + d[0] * t);
}
addEventListener("pointermove", (e) => { if (state === "play") input.pad = pointerAngle(e.clientX, e.clientY); });
canvas.addEventListener("pointerdown", (e) => { audio.init(); if (state === "play") { input.pad = pointerAngle(e.clientX, e.clientY); input.fire = true; } });
addEventListener("pointerup", () => (input.fire = false));
addEventListener("keydown", (e) => { audio.init(); input.keys.add(e.code); if (e.code === "Space") { input.fire = true; e.preventDefault(); } if (e.code === "Escape" || e.code === "KeyP") { if (state === "play") pause(); else if (state === "paused") resume(); } });
addEventListener("keyup", (e) => { input.keys.delete(e.code); if (e.code === "Space") input.fire = false; });

// ------------------------------------------------------------------ update
function brickCenter(k) { const [a0, a1] = brickAngles(g, k), a = (a0 + a1) / 2, r = (k.r0 + k.r1) / 2; return [Math.cos(a) * r, Math.sin(a) * r]; }
function shatter(k) {
  const [x, y] = brickCenter(k), c = k.type === "p" ? [Math.random(), Math.random(), 1] : TYPE_COL[k.type];
  for (let i = 0; i < 9; i++) { const a = Math.random() * TAU, v = 2 + Math.random() * 4; fx.shards.push({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 4, s: 0.12 + Math.random() * 0.15, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 20, life: 1.2, c }); }
  for (let i = 0; i < 14; i++) { const a = Math.random() * TAU, v = 3 + Math.random() * 6; fx.sparks.push({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: Math.random() * 4, life: 0.5, c }); }
}
function update(dt) {
  time += dt;
  if (state === "play" || demo) {
    const k = input.keys;
    let pad = input.pad;
    if (k.has("ArrowLeft") || k.has("KeyA")) pad = g.pad + 3 * dt; if (k.has("ArrowRight") || k.has("KeyD")) pad = g.pad - 3 * dt;
    if ((k.has("ArrowLeft") || k.has("KeyA") || k.has("ArrowRight") || k.has("KeyD"))) input.pad = pad;
    if (demo || bot) pad = autoPad(g);
    const ev = step(g, dt, { pad, fire: input.fire || ((demo || bot) && (g.held || g.power.laser > 0)) });
    if (!bot && !demo) input.fire = input.fire && g.power.laser > 0;
    for (const e of ev) {
      if (e.type === "break") { shatter(e.k); audio.blip(e.combo); audio.shatter(); coreFlare = Math.min(1, coreFlare + 0.08); if (e.combo > 0 && e.combo % 5 === 0) popCombo(e.combo); }
      if (e.type === "crack") { audio.crack(); audio.blip(g.combo); }
      if (e.type === "metal") audio.clang();
      if (e.type === "bomb") { audio.boom(); shake = 0.6; flash = 0.5; fx.rings.push({ x: e.x, y: e.y, life: 0.6, c: [1, 0.5, 0.2] }); }
      if (e.type === "paddle") audio.paddle();
      if (e.type === "laser") audio.laser();
      if (e.type === "power") { audio.power(); toast(e.kind.toUpperCase()); }
      if (e.type === "lost") { fx.rings.push({ x: e.x, y: e.y, life: 0.6, c: [1, 0.3, 0.3] }); }
      if (e.type === "life" && !demo) { audio.lost(); shake = 0.4; ui.hud(); }
      if (e.type === "over" && !demo) gameOver();
      if (e.type === "clear") { if (demo) { startDemo(); break; } audio.clear(); coreFlare = 1; flash = 0.6; fx.rings.push({ x: 0, y: 0, life: 1.2, c: [1, 0.85, 0.5], big: true }); setTimeout(() => { if (state !== "play") return; const nw = g.wave + 1; if (nw >= WAVES.length) return victory(); const keep = { lives: g.lives, score: g.score }; startWave(g, nw); Object.assign(g, keep); banner(`WAVE ${nw + 1}`, WAVES[nw].name); ui.hud(); }, 1800); }
    }
    if (demo && g.lives < 3) g.lives = 3;
  }
  for (const s of fx.shards) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 12 * dt; if (s.z < 0.05) { s.z = 0.05; s.vz *= -0.3; s.vx *= 0.7; s.vy *= 0.7; } s.rot += s.spin * dt; s.life -= dt; }
  for (const s of fx.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 6 * dt; s.life -= dt; }
  for (const r of fx.rings) r.life -= dt;
  fx.shards = fx.shards.filter((s) => s.life > 0); fx.sparks = fx.sparks.filter((s) => s.life > 0); fx.rings = fx.rings.filter((r) => r.life > 0);
  shake = Math.max(0, shake - dt * 1.5); flash = Math.max(0, flash - dt * 1.5); coreFlare = Math.max(0, coreFlare - dt * 0.4);
  ui.frame();
}

// ------------------------------------------------------------------ camera
function updateCamera() {
  const sx = (Math.sin(time * 47) + Math.sin(time * 31)) * shake * 0.15, sy = Math.cos(time * 41) * shake * 0.15;
  const a = demo ? time * 0.05 : 0;
  const E = [Math.sin(a) * 15.5 + sx, -Math.cos(a) * 15.5 + sy, 16.5];
  space.magnifier = 1.62 * 1.6 * Math.min(1, (innerWidth / innerHeight) / 1.2 + 0.25);
  space.lookAt(E[0], E[1], E[2], 0, -0.6, -0.5);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(60000), A = new Mesh(40000), dyn = new Mesh(120000);
function sector(k, a0, a1, z0, z1, col, glow) {
  const N = Math.max(2, Math.ceil((a1 - a0) * (k.r1 + k.r0) * 0.5 / 0.35));
  const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
  const m = k.type === "m" ? MAT.GLOSS : MAT.GEM, w = glow;
  const v = (p) => D.v(p[0], p[1], p[2], w, col[0], col[1], col[2], m);
  const quad = (a, b, c, d) => { v(a); v(b); v(c); v(a); v(c); v(d); };
  for (let i = 0; i < N; i++) {
    const t0 = a0 + ((a1 - a0) * i) / N, t1 = a0 + ((a1 - a0) * (i + 1)) / N;
    quad(P(k.r0, t0, z1), P(k.r1, t0, z1), P(k.r1, t1, z1), P(k.r0, t1, z1));   // top
    quad(P(k.r1, t0, z0), P(k.r1, t1, z0), P(k.r1, t1, z1), P(k.r1, t0, z1));   // outer
    quad(P(k.r0, t1, z0), P(k.r0, t0, z0), P(k.r0, t0, z1), P(k.r0, t1, z1));   // inner
  }
  quad(P(k.r0, a0, z0), P(k.r0, a0, z1), P(k.r1, a0, z1), P(k.r1, a0, z0));
  quad(P(k.r1, a1, z0), P(k.r1, a1, z1), P(k.r0, a1, z1), P(k.r0, a1, z0));
}
function arcBand(A, r, a0, a1, w, z, col, n = 24) { for (let i = 0; i < n; i++) { const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n; A.quad([Math.cos(t0) * (r - w), Math.sin(t0) * (r - w), z], [Math.cos(t1) * (r - w), Math.sin(t1) * (r - w), z], [Math.cos(t1) * (r + w), Math.sin(t1) * (r + w), z], [Math.cos(t0) * (r + w), Math.sin(t0) * (r + w), z], col, MAT.ADD); } }
function buildDynamic() {
  D.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  // the core
  const left = g.bricks.filter((k) => k.alive && k.type !== "m").length, total = Math.max(1, g.bricks.filter((k) => k.type !== "m").length);
  const coreR = CORE_R * (1 + 0.06 * Math.sin(time * 3)) * (1 + coreFlare * 0.25);
  blob(D, [0, 0, 0.6], coreR, coreR, coreR, [1, 1, 1], MAT.CORE, 20, 12);
  A.sprite(0, 0, 0.6, 3.5 + coreFlare * 3, 0.5 * (0.6 + coreFlare), 0.3 * (0.6 + coreFlare), 0.15 * (0.6 + coreFlare));
  // bricks
  for (const k of g.bricks) {
    if (!k.alive) continue;
    const [a0, a1] = brickAngles(g, k);
    let col = TYPE_COL[k.type];
    if (k.type === "p") { const h = (time * 0.3 + k.a0) % 1; col = [0.5 + 0.5 * Math.cos(TAU * h), 0.5 + 0.5 * Math.cos(TAU * (h - 0.33)), 0.5 + 0.5 * Math.cos(TAU * (h - 0.66))]; }
    if (k.type === "b") col = col.map((v) => v * (0.8 + 0.3 * Math.sin(time * 8)));
    const glow = (k.max < 99 ? k.hp / k.max : 0.6) * 0.8 + k.hitT * 1.5;
    k.hitT = Math.max(0, k.hitT - 1 / 30);
    sector(k, a0, a1, 0.02, 0.55 + (k.max === 3 ? 0.12 : 0), col, glow);
  }
  // paddle
  const pw = padWidth(g), col = g.power.laser > 0 ? [1, 0.4, 0.4] : g.power.wide > 0 ? [0.5, 1, 0.6] : [0.4, 0.8, 1.0];
  arcBand(A, PAD_R, g.pad - pw / 2, g.pad + pw / 2, 0.14, 0.3, col.map((v) => v * 1.4), 16);
  arcBand(A, PAD_R, g.pad - pw / 2 - 0.05, g.pad + pw / 2 + 0.05, 0.4, 0.29, col.map((v) => v * 0.25), 16);
  arcBand(A, PAD_R, 0, TAU, 0.02, 0.05, [0.15, 0.25, 0.5], 128);
  // balls
  for (const b of g.balls) {
    blob(D, [b.x, b.y, 0.3], BALL_R, BALL_R, BALL_R, [1.4, 1.3, 1.1], MAT.EMIT, 10, 6);
    A.sprite(b.x, b.y, 0.3, 0.7, 0.5, 0.45, 0.35);
    if (!b.stuck) { const sp = Math.hypot(b.vx, b.vy) || 1; for (let i = 1; i < 8; i++) { const k = (1 - i / 8) * 0.3; A.sprite(b.x - (b.vx / sp) * i * 0.18, b.y - (b.vy / sp) * i * 0.18, 0.3, 0.12, k, k * 0.9, k * 0.7); } }
  }
  // drops
  for (const p of g.drops) { const c = { multi: [0.4, 0.8, 1], wide: [0.5, 1, 0.6], laser: [1, 0.4, 0.4], slow: [0.8, 0.6, 1], life: [1, 0.4, 0.7], magnet: [1, 0.85, 0.3] }[p.kind]; blob(D, [p.x, p.y, 0.35], 0.22, 0.22, 0.22, c.map((v) => v * 1.4), MAT.EMIT, 8, 5); A.sprite(p.x, p.y, 0.35, 0.8, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4); }
  for (const bo of g.bolts) A.sprite(bo.x, bo.y, 0.3, 0.2, 1, 0.4, 0.3);
  // effects
  for (const s of fx.shards) { const k = Math.min(1, s.life * 1.5), c = Math.cos(s.rot) * s.s, sn = Math.sin(s.rot) * s.s; D.tri([s.x + c, s.y + sn, s.z], [s.x - sn, s.y + c, s.z + s.s * 0.6], [s.x - c * 0.6, s.y - sn * 0.6, s.z - s.s * 0.3], s.c.map((v) => v * k), MAT.GEM); }
  for (const s of fx.sparks) { const k = s.life * 2; A.sprite(s.x, s.y, s.z, 0.06, s.c[0] * k, s.c[1] * k, s.c[2] * k); }
  for (const r of fx.rings) { const t = 1 - r.life / (r.big ? 1.2 : 0.6), R = (r.big ? 11 : 2.5) * t, k = (1 - t) * 0.6; arcBand(A, R, 0, TAU, 0.1 + t * 0.2, 0.1, r.c.map((v) => v * k), 48); }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: dyn.n - oA, left: left / total };
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [];
  for (const b of g.balls) L.push({ p: [b.x, b.y, 0.5], c: [1, 0.9, 0.7], k: 1.2 });
  for (const r of fx.rings) L.push({ p: [r.x, r.y, 0.8], c: r.c, k: r.life * 4 });
  const pw = padWidth(g); L.push({ p: [Math.cos(g.pad) * PAD_R, Math.sin(g.pad) * PAD_R, 0.6], c: [0.4, 0.8, 1], k: 1.5 + pw });
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
function render() {
  updateCamera();
  const o = buildDynamic(), nL = collectLights();
  const coreCol = [1.0, 0.55 + 0.25 * o.left, 0.25 + 0.2 * o.left];
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform3fv(U.uCoreCol, coreCol); gl.uniform1f(U.uCoreK, 0.6 + (1 - o.left) * 0.5 + coreFlare);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  space.bind(false); space.draw(0, STATIC_N);
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: flash });
}

// ------------------------------------------------------------------ UI
let toastT = 0, banT = 0;
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.remove("show"), 1400); }
function banner(t, s) { $("ban-t").textContent = t; $("ban-s").textContent = s; $("banner").classList.add("show"); clearTimeout(banT); banT = setTimeout(() => $("banner").classList.remove("show"), 2200); }
function popCombo(n) { toast(`${n} COMBO!`); }
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  hud() { $("lives").innerHTML = Array.from({ length: g.lives }, () => "<i></i>").join(""); $("h-wave").textContent = `WAVE ${g.wave + 1}`; },
  frame() {
    if (state !== "play") return;
    $("h-score").textContent = g.score.toLocaleString(); $("h-combo").textContent = g.combo > 2 ? `×${g.combo}` : "";
    $("powers").innerHTML = Object.entries(g.power).filter(([, v]) => v > 0).map(([k, v]) => `<span>${k.toUpperCase()} <b>${Math.ceil(v)}</b></span>`).join("");
    $("h-hint").style.opacity = g.held ? 1 : 0;
  },
  title() { $("t-best").textContent = save.best ? `Best ${save.best.toLocaleString()} · reached wave ${save.bestWave}` : "Move the pointer around the ring · click to launch"; },
};
function gameOver() {
  state = "over";
  const nb = g.score > save.best; save.best = Math.max(save.best, g.score); save.bestWave = Math.max(save.bestWave, g.wave + 1); persist();
  $("o-k").textContent = "Out of orbs"; $("o-score").textContent = g.score.toLocaleString(); $("o-wave").textContent = `Reached wave ${g.wave + 1} · ${WAVES[g.wave].name}`; $("o-best").textContent = nb ? "New best!" : `Best ${save.best.toLocaleString()}`;
  $("m-over").classList.remove("hidden");
}
function victory() { state = "over"; const nb = g.score > save.best; save.best = Math.max(save.best, g.score); save.bestWave = WAVES.length; persist(); $("o-k").textContent = "All shells shattered!"; $("o-score").textContent = g.score.toLocaleString(); $("o-wave").textContent = `All ${WAVES.length} waves cleared`; $("o-best").textContent = nb ? "New best!" : `Best ${save.best.toLocaleString()}`; $("m-over").classList.remove("hidden"); }
function pause() { state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); state = "play"; }
function toTitle() { for (const m of ["m-pause", "m-over", "m-set"]) $(m).classList.add("hidden"); state = "title"; startDemo(); ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.ui(); startGame(0); };
$("b-pause").onclick = pause; $("p-resume").onclick = resume; $("p-title").onclick = toTitle;
$("o-again").onclick = () => { $("m-over").classList.add("hidden"); startGame(0); }; $("o-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };

// ------------------------------------------------------------------ boot
const bot = Q.has("auto");
window.__orbit = () => ({ state, wave: g.wave + 1, score: g.score, lives: g.lives, balls: g.balls.length, bricks: g.bricks.filter((k) => k.alive && k.type !== "m").length, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.033); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (state !== "paused") update(dt);
  render();
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
startDemo();
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); state = "title"; ui.show("title"); ui.title();
  if (bot || Q.has("wave")) startGame(clamp(+(Q.get("wave") || 1) - 1, 0, WAVES.length - 1));
}, 400);
