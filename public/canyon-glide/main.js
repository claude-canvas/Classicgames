// CANYON GLIDE — a paper glider down an endless sunset canyon. Rendered with the projection3d library (Space, via
// GameSpace) + custom shaders + bloom. See DESIGN.md. flight.js flies the glider, canyon.js shapes and populates the
// canyon; this file streams chunks, runs scoring, input, camera, biomes and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, mixc } from "./mesh.js";
import { CHUNK, H, cx, width, tangent, features, buildChunk, archZb, archZt } from "./canyon.js";
import { makeGlider, stepGlider, flap, STALL } from "./flight.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
const DEF = { best: 0, bestDist: 0, runs: 0, volume: 0.8, music: 0.6, invert: false, sens: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("canyonglide.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("canyonglide.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ biomes
const BIOMES = [
  { name: "Sunset Red", sun: [0.3, 0.95, 0.12], sc: [1.9, 1.1, 0.6], top: [0.25, 0.35, 0.62], hor: [1.0, 0.62, 0.4], glow: [1.4, 0.6, 0.3], amb: [0.36, 0.3, 0.36], tint: [1, 1, 1], night: 0 },
  { name: "Violet Dusk", sun: [0.45, 0.89, 0.04], sc: [1.3, 0.55, 0.5], top: [0.12, 0.1, 0.32], hor: [0.85, 0.45, 0.58], glow: [1.1, 0.42, 0.52], amb: [0.28, 0.22, 0.38], tint: [0.95, 0.82, 1.0], night: 0.3 },
  { name: "Moonlit Blue", sun: [-0.3, 0.8, 0.5], sc: [0.45, 0.55, 0.85], top: [0.02, 0.04, 0.12], hor: [0.12, 0.16, 0.32], glow: [0.25, 0.3, 0.5], amb: [0.13, 0.16, 0.27], tint: [0.72, 0.8, 1.05], night: 1 },
  { name: "Dawn Gold", sun: [-0.3, 0.9, 0.15], sc: [1.85, 1.3, 0.8], top: [0.3, 0.46, 0.76], hor: [1.0, 0.8, 0.56], glow: [1.25, 0.8, 0.4], amb: [0.4, 0.38, 0.42], tint: [1.05, 1.0, 0.9], night: 0 },
];
function biomeAt(y) {
  const span = 1500, i = Math.floor(Math.max(0, y) / span), f = (Math.max(0, y) % span) / span, k = clamp((f - 0.85) / 0.15, 0, 1);
  const a = BIOMES[i % 4], b = BIOMES[(i + 1) % 4], L = (p, q) => p.map((v, j) => lerp(v, q[j], k));
  return { i, name: k > 0.5 ? b.name : a.name, sun: nrm(L(a.sun, b.sun)), sc: L(a.sc, b.sc), top: L(a.top, b.top), hor: L(a.hor, b.hor), glow: L(a.glow, b.glow), amb: L(a.amb, b.amb), tint: L(a.tint, b.tint), night: lerp(a.night, b.night, k) };
}

// ------------------------------------------------------------------ chunk streaming
const chunks = new Map();
let streamKey = "";
function ensureChunks(y) {
  const c0 = Math.floor(y / CHUNK) - 1, c1 = c0 + 6;
  for (const k of [...chunks.keys()]) if (k < c0 || k > c1) chunks.delete(k);
  let changed = false;
  for (let ci = Math.max(0, c0); ci <= c1; ci++) if (!chunks.has(ci)) {
    const f = features(ci), O = new Mesh(30000), W = new Mesh(400), A = new Mesh(100);
    buildChunk(O, W, A, ci, f); chunks.set(ci, { f, O, W, A }); changed = true;
  }
  const key = [...chunks.keys()].sort((a, b) => a - b).join(",");
  if (changed || key !== streamKey) {
    streamKey = key;
    const stat = new Mesh(250000), O = new Mesh(220000), W = new Mesh(4000);
    for (const c of chunks.values()) { O.append(c.O); W.append(c.W); }
    seg.O = [0, O.n]; stat.append(O); seg.W = [stat.n, W.n]; stat.append(W);
    space.setStatic(stat.pos, stat.col, stat.n);
  }
}
const seg = { O: [0, 0], W: [0, 0] };
const allFeat = (kind) => { const out = []; for (const c of chunks.values()) out.push(...c.f[kind]); return out; };
function air(x, y, z) {
  let up = 0;
  for (const th of allFeat("thermals")) { const d = Math.hypot(x - th.x, y - th.y); if (d < th.r && z < 160) up += th.lift * (1 - (d / th.r) ** 2); }
  return up;
}

// ------------------------------------------------------------------ run state
const R = { state: "loading", g: null, dist: 0, score: 0, chain: 0, best: 0, mult: 1, nearT: 0, inThermal: false, slow: 1, crashT: 0, bits: [], biome: -1, skimT: 0, arches: 0, rings: 0 };
let time = 0;
function startRun() {
  chunks.clear(); streamKey = "";
  R.g = makeGlider(cx(0), 0, 34); R.g.yaw = Math.atan2(tangent(0)[0], tangent(0)[1]);
  Object.assign(R, { state: "fly", dist: 0, score: 0, chain: 0, mult: 1, nearT: 0, slow: 1, crashT: 0, bits: [], biome: -1, skimT: 0, arches: 0, rings: 0 });
  ensureChunks(0); ui.show("hud"); audio.whoosh(0.2);
}
function crash(why) {
  if (god) return;
  R.state = "crash"; R.crashT = 0; audio.crash();
  const g = R.g;
  for (let i = 0; i < 40; i++) R.bits.push({ x: g.x, y: g.y, z: g.z, vx: (Math.random() - 0.5) * 8 + Math.sin(g.yaw) * g.v * 0.3, vy: (Math.random() - 0.5) * 8 + Math.cos(g.yaw) * g.v * 0.3, vz: Math.random() * 6, life: 2 + Math.random(), s: 0.12 + Math.random() * 0.2 });
  const s = Math.round(R.score), d = Math.round(R.dist), nb = s > save.best;
  save.best = Math.max(save.best, s); save.bestDist = Math.max(save.bestDist, d); save.runs++; persist();
  setTimeout(() => {
    $("c-why").textContent = why; $("c-dist").textContent = `${d} m`; $("c-score").textContent = s; $("c-best").textContent = nb ? "New best!" : `Best ${save.best} · ${save.bestDist} m`;
    $("c-stats").textContent = `${R.rings} rings · ${R.arches} arches`;
    $("m-crash").classList.remove("hidden");
    if (bot) setTimeout(() => { $("m-crash").classList.add("hidden"); startRun(); }, 2500);
  }, 1300);
}

// ------------------------------------------------------------------ input
const input = { keys: new Set(), mouse: null, stick: null, brake: false };
const coarse = matchMedia("(pointer: coarse)").matches;
addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") input.mouse = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5]; if (input.stick && input.stick.id === e.pointerId) { input.stick.x = e.clientX; input.stick.y = e.clientY; } });
canvas.addEventListener("pointerdown", (e) => {
  audio.init();
  if (e.pointerType !== "mouse") { input.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now() }; }
  else if (R.state === "fly" && e.button === 0) doFlap();
  if (e.button === 2) input.brake = true;
});
addEventListener("pointerup", (e) => { if (input.stick && input.stick.id === e.pointerId) { if (performance.now() - input.stick.t < 180 && Math.hypot(input.stick.x - input.stick.x0, input.stick.y - input.stick.y0) < 10) doFlap(); input.stick = null; } if (e.button === 2) input.brake = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyF") && !e.repeat) doFlap();
  if (e.code === "KeyC" && !e.repeat) cam.cockpit = !cam.cockpit;
  if (e.code === "Escape" || e.code === "KeyP") { if (R.state === "fly") pause(); else if (R.state === "paused") resume(); }
  if (e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => input.keys.delete(e.code));
$("c-boost").addEventListener("pointerdown", (e) => { e.stopPropagation(); doFlap(); });
$("c-brake").addEventListener("pointerdown", (e) => { e.stopPropagation(); input.brake = true; }); $("c-brake").addEventListener("pointerup", () => (input.brake = false)); $("c-brake").addEventListener("pointerleave", () => (input.brake = false));
function doFlap() { if (R.state === "fly" && flap(R.g)) { audio.whoosh(0.25); ui.boost(); } }
function readInput() {
  const k = input.keys; let bank = 0, pitch = 0;
  if (input.stick) { bank = clamp((input.stick.x - input.stick.x0) / 90, -1, 1); pitch = clamp(-(input.stick.y - input.stick.y0) / 90, -1, 1); }
  else if (input.mouse && !coarse) { bank = clamp(input.mouse[0] / 0.28, -1, 1); pitch = clamp(-input.mouse[1] / 0.28, -1, 1); }
  if (k.has("KeyA") || k.has("ArrowLeft")) bank = -1; if (k.has("KeyD") || k.has("ArrowRight")) bank = 1;
  if (k.has("KeyW") || k.has("ArrowUp")) pitch = -1; if (k.has("KeyS") || k.has("ArrowDown")) pitch = 1;
  if (save.invert) pitch = -pitch;
  // a small dead zone keeps level flight easy
  const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
  return { bank: dz(bank) * save.sens, pitch: dz(pitch) * save.sens, brake: input.brake || k.has("Space") };
}

// ------------------------------------------------------------------ autopilot (?auto and the title flythrough)
function autopilot(g) {
  // aim for the next uncollected ring if one is ahead, else the centreline; climb in thermals, boost when slow
  let tx = cx(g.y + 60), ty = g.y + 60, tz = 26;
  let best = null; for (const r of allFeat("rings")) if (!r.got && r.y > g.y + 8 && r.y < g.y + 90 && (!best || r.y < best.y)) best = r;
  if (best) { tx = best.x; ty = best.y; tz = best.z; }
  for (const a of allFeat("arches")) if (a.y > g.y && a.y < g.y + 120) tz = Math.min(tz, archZb(a, cx(a.y)) - 6);
  const floor = Math.max(H(g.x + Math.sin(g.yaw) * 30, g.y + Math.cos(g.yaw) * 30), H(g.x, g.y)) + 10; tz = Math.max(tz, floor);
  let dy = Math.atan2(tx - g.x, ty - g.y) - g.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
  if (g.v < 14 && g.boost > 0 && R.state === "fly") doFlap();
  return { bank: clamp(dy * 2.5, -1, 1), pitch: clamp((tz - g.z) * 0.05 - (g.v < 13 ? 0.35 : 0), -1, 1), brake: false };
}

// ------------------------------------------------------------------ update
const motes = Array.from({ length: 160 }, () => ({ x: (Math.random() - 0.5) * 80, y: Math.random() * 120, z: Math.random() * 50 }));
function update(dt) {
  time += dt;
  if (R.state === "title") {
    if (!R.g) { chunks.clear(); streamKey = ""; R.g = makeGlider(cx(0), 0, 30); R.g.yaw = Math.atan2(tangent(0)[0], tangent(0)[1]); R.g.boost = 99; }
    const g = R.g; stepGlider(g, autopilot(g), dt, air); ensureChunks(g.y);
    if (g.z - H(g.x, g.y) < 2 || g.v < 8) { g.z += 10; g.v = 22; g.boost = 99; }
  }
  if (R.state === "fly") {
    const g = R.g, inp = bot ? autopilot(g) : readInput();
    stepGlider(g, inp, dt, air);
    ensureChunks(g.y);
    R.dist = Math.max(R.dist, g.y);
    const clr = g.z - H(g.x, g.y);
    // river skim
    const overRiver = Math.abs(g.x - cx(g.y)) < width(g.y) * 0.07;
    const skim = overRiver && clr < 3.2;
    if (skim) { R.skimT += dt; if (Math.random() < dt * 30) R.bits.push({ x: g.x, y: g.y - 1, z: 0.2, vx: (Math.random() - 0.5) * 3, vy: -2, vz: 2 + Math.random() * 3, life: 0.6, s: 0.15, water: true }); } else R.skimT = 0;
    R.mult = (1 + Math.min(2, R.chain * 0.1)) * (skim ? 1.5 : 1);
    R.score += (g.v * dt / 10) * R.mult;
    // collisions
    if (clr < 0.8) return crash(overRiver && H(g.x, g.y) < 0 ? "Splashed into the river" : "Clipped the canyon wall");
    for (const s of allFeat("spires")) if (Math.hypot(g.x - s.x, g.y - s.y) < s.r + 0.8 && g.z < s.z + s.h + 4) return crash("Hit a hoodoo");
    for (const a of allFeat("arches")) {
      if (Math.abs(g.y - a.y) < 5.8 && g.x > a.x0 && g.x < a.x1) {
        const zb = archZb(a, g.x), zt = archZt(a, g.x);
        if (g.z > zb - 0.8 && g.z < zt + 0.8) return crash("Struck a stone arch");
      }
      if (!a.through && g.y > a.y + 6 && g.y < a.y + 20 && g.z < archZb(a, g.x)) { a.through = true; R.score += 25 * R.mult; R.arches++; pop("Through the arch!", "+25"); audio.gate(); }
    }
    // rings and gates
    for (const r of allFeat("rings")) {
      if (r.got || r.missed) continue;
      const [tx, ty] = tangent(r.y), along = (g.x - r.x) * tx + (g.y - r.y) * ty;
      if (Math.abs(along) < 1.6 && Math.hypot(g.x - r.x - tx * along, g.y - r.y - ty * along, g.z - r.z) < r.r) { r.got = true; R.chain++; R.rings++; R.score += 5 * R.mult; g.v = Math.min(62, g.v + 1.5); audio.ring(R.chain); if (r.i === 4) { g.boost = Math.min(3, g.boost + 1); pop("Ring set!", "+1 boost"); ui.boost(); } }
      else if (along > 3) { r.missed = true; if (R.chain > 2) toast("Chain broken"); R.chain = 0; }
    }
    for (const gt of allFeat("gates")) if (!gt.got && Math.abs(g.y - gt.y) < 2 && Math.hypot(g.x - gt.x, g.z - gt.z) < gt.r) { gt.got = true; g.v = Math.min(62, g.v + 12); R.score += 15 * R.mult; pop("Wind gate!", "speed +"); audio.gate(); }
    // near misses
    R.nearT -= dt;
    if (clr < 4 && clr > 0.8 && g.v > 20 && R.nearT <= 0 && !overRiver) { R.nearT = 1.2; R.score += 10 * R.mult; pop("Close call!", "+10"); audio.whoosh(0.2); }
    // thermals
    const inT = air(g.x, g.y, g.z) > 1; if (inT && !R.inThermal) audio.thermal(); R.inThermal = inT;
    // biome change
    const b = biomeAt(g.y); if (b.i !== R.biome) { if (R.biome >= 0) toast(b.name); R.biome = b.i; }
    audio.fly(g.v, inp.brake);
    g.trail.push([g.x, g.y, g.z]); if (g.trail.length > 30) g.trail.shift();
  } else if (R.state === "crash") { R.crashT += dt; audio.fly(0, false); }
  else audio.fly(R.g ? R.g.v * 0.5 : 0, false);
  for (const b of R.bits) { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= (b.water ? 9 : 3) * dt; b.vx *= 1 - dt; b.vy *= 1 - dt; b.life -= dt; }
  R.bits = R.bits.filter((b) => b.life > 0);
  ui.frame(dt);
}

// ------------------------------------------------------------------ camera
const cam = { E: [0, -10, 40], T: [0, 10, 30], cockpit: false, roll: 0, mag: 1.55 };
function updateCamera(dt) {
  const g = R.g; if (!g) return;
  const fx = Math.sin(g.yaw), fy = Math.cos(g.yaw);
  let E, T, mag = clamp(1.6 - (g.v - 20) * 0.007, 1.3, 1.7);
  if (cam.cockpit && R.state === "fly") { E = [g.x + fx * 0.6, g.y + fy * 0.6, g.z + 0.25]; T = [g.x + fx * 20, g.y + fy * 20, g.z + Math.sin(g.pitch) * 20]; }
  else if (R.state === "crash") { E = cam.E; T = [g.x, g.y, g.z]; }
  else { E = [g.x - fx * 7.5, g.y - fy * 7.5, g.z + 2.4 - Math.sin(g.pitch) * 3]; T = [g.x + fx * 12, g.y + fy * 12, g.z + Math.sin(g.pitch) * 8]; }
  // keep the camera out of the rock
  E[2] = Math.max(E[2], H(E[0], E[1]) + 1.5);
  const k = Math.min(1, dt * (cam.cockpit ? 20 : 6));
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k)); cam.mag = lerp(cam.mag, mag, Math.min(1, dt * 2));
  cam.roll = lerp(cam.roll, R.state === "crash" ? 0 : g.bank * (cam.cockpit ? 1 : 0.55), Math.min(1, dt * 5));
  space.magnifier = cam.mag * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
  space.roll(cam.roll);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(40000), A = new Mesh(40000), dyn = new Mesh(100000);
function ribbon(p0, p1, w, c0, c1) {
  const E = cam.E, d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v));
  A.quad4([p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w], [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w], c0, c0, c1, c1, MAT.ADD);
}
// the paper plane, local frame: +y nose, +x right wing, +z up
const PLANE = [
  [[0, 1.0, 0.02], [-0.78, -0.55, 0.12], [0, -0.55, 0.0], [0.97, 0.96, 0.93]],
  [[0, 1.0, 0.02], [0.78, -0.55, 0.12], [0, -0.55, 0.0], [0.93, 0.92, 0.9]],
  [[0, 1.0, 0.0], [0, -0.55, 0.0], [0, -0.5, -0.2], [0.85, 0.84, 0.82]],
  [[-0.78, -0.55, 0.12], [-0.7, -0.5, 0.2], [-0.25, 0.4, 0.06], [0.88, 0.87, 0.85]],
  [[0.78, -0.55, 0.12], [0.7, -0.5, 0.2], [0.25, 0.4, 0.06], [0.88, 0.87, 0.85]],
];
function drawGlider(g) {
  const cy = Math.cos(g.yaw), sy = Math.sin(g.yaw), cp = Math.cos(g.pitch), sp = Math.sin(g.pitch), cb = Math.cos(g.bank), sb = Math.sin(g.bank);
  const X = ([x, y, z]) => {
    let x1 = x * cb + z * sb, z1 = -x * sb + z * cb;            // bank about the nose axis
    let y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;            // pitch
    return [g.x + x1 * cy + y2 * sy, g.y - x1 * sy + y2 * cy, g.z + z2];
  };
  for (const [a, b, c, col] of PLANE) D.tri(X(a), X(b), X(c), col, MAT.PAPER);
  // wing-tip vapour at speed
  if (g.v > 24) { const k = Math.min(1, (g.v - 24) / 20) * 0.35; for (const s of [-1, 1]) { const tip = X([s * 0.78, -0.55, 0.12]); const back = [tip[0] - sy * 6, tip[1] - cy * 6, tip[2] - sp * 6]; ribbon(tip, back, 0.05, [k, k, k], [0, 0, 0]); } }
}
function ringMesh(r, col, w = 0.35) {
  const [tx, ty] = tangent(r.y), ux = ty, uy = -tx, N = 28;   // the ring plane: (ux, uy, 0) and z
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
    const P = (a, rr) => [r.x + ux * Math.cos(a) * rr, r.y + uy * Math.cos(a) * rr, r.z + Math.sin(a) * rr];
    A.quad(P(a0, r.r - w), P(a1, r.r - w), P(a1, r.r + w), P(a0, r.r + w), col, MAT.ADD);
  }
}
function buildDynamic() {
  D.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const g = R.g;
  if (g) {
    if (R.state !== "crash") drawGlider(g);
    const pulse = 0.7 + 0.3 * Math.sin(time * 5);
    for (const r of allFeat("rings")) { if (r.got) { continue; } const c = r.missed ? [0.08, 0.04, 0.02] : [0.6 * pulse, 0.42 * pulse, 0.14 * pulse]; ringMesh(r, c, 0.2); A.sprite(r.x, r.y, r.z, 0.8, c[0] * 0.1, c[1] * 0.1, c[2] * 0.1); }
    for (const gt of allFeat("gates")) if (!gt.got) { ringMesh({ ...gt }, [0.3 * pulse, 0.9 * pulse, 1.0 * pulse], 0.6); }
    // thermals: warm motes rising in columns
    for (const th of allFeat("thermals")) { if (Math.abs(th.y - g.y) > 260) continue; for (let i = 0; i < 14; i++) { const a = i * 2.4 + time * 0.3, rr = th.r * ((i * 0.37) % 1), z = ((time * th.lift * 2 + i * 9) % 70) + 3, k = 0.18 * (1 - z / 75); A.sprite(th.x + Math.cos(a) * rr, th.y + Math.sin(a) * rr, H(th.x, th.y) + z, 0.35, k, k * 0.75, k * 0.45); } }
    // trail of the glider
    for (const b of R.bits) { const k = Math.min(1, b.life); if (b.water) A.sprite(b.x, b.y, b.z, b.s, 0.3 * k, 0.4 * k, 0.45 * k); else D.tri([b.x, b.y, b.z], [b.x + b.s, b.y, b.z + b.s * 0.3], [b.x, b.y + b.s, b.z - b.s * 0.2], [0.95, 0.94, 0.9], MAT.PAPER); }
    // dust motes drifting in the air around the glider
    for (const m of motes) { const x = g.x + ((m.x - g.x * 0.0) % 80), y = g.y + (((m.y - g.y) % 120) + 120) % 120 - 20, z = Math.max(1, g.z - 20 + m.z); A.sprite(x, y, z, 0.07, 0.12, 0.1, 0.07); }
    // the sun's glare
    const b = biomeAt(g.y), s = b.sun; A.sprite(g.x + s[0] * 900, g.y + s[1] * 900, g.z + s[2] * 900, 70, b.glow[0] * 0.12, b.glow[1] * 0.12, b.glow[2] * 0.12);
    // birds circling
    for (let i = 0; i < 6; i++) { const a = time * 0.4 + i * 1.05, by = Math.floor(g.y / 300) * 300 + 220 + i * 25, bx = cx(by) + Math.cos(a) * 25, bz = 80 + Math.sin(a * 0.7) * 6, fl = Math.sin(time * 9 + i) * 0.4; D.tri([bx, by, bz], [bx - 1.2, by - 0.3, bz + fl], [bx, by - 0.5, bz], [0.15, 0.1, 0.1], MAT.MATTE); D.tri([bx, by, bz], [bx + 1.2, by - 0.3, bz + fl], [bx, by - 0.5, bz], [0.15, 0.1, 0.1], MAT.MATTE); }
  }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: dyn.n - oA };
}

function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), b = biomeAt(R.g ? R.g.y : 0);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time);
  gl.uniform3fv(U.uSunDir, b.sun); gl.uniform3fv(U.uSunCol, b.sc); gl.uniform3fv(U.uSkyTop, b.top); gl.uniform3fv(U.uSkyHor, b.hor); gl.uniform3fv(U.uSkyGlow, b.glow);
  gl.uniform3fv(U.uAmb, b.amb); gl.uniform3fv(U.uRockTint, b.tint); gl.uniform1f(U.uNight, b.night);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  space.bind(false); space.draw(seg.O[0], seg.O[1]); space.draw(seg.W[0], seg.W[1]);
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: R.state === "crash" ? Math.max(0, 0.6 - R.crashT) : 0 });
}

// ------------------------------------------------------------------ UI
let popT = 0, toastT = 0;
function pop(t, s) { $("pop-t").textContent = t; $("pop-s").textContent = s; $("pop").classList.add("show"); popT = 1.4; }
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); toastT = 2.5; }
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  boost() { $("boosts").innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="${i < R.g.boost ? "on" : ""}"></i>`).join(""); },
  frame(dt) {
    if (popT > 0) { popT -= dt; if (popT <= 0) $("pop").classList.remove("show"); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("show"); }
    if (R.state !== "fly") return;
    const g = R.g;
    $("h-dist").textContent = `${Math.round(R.dist)} m`; $("h-score").textContent = Math.round(R.score);
    $("h-mult").textContent = `×${R.mult.toFixed(1)}`; $("h-mult").classList.toggle("hot", R.mult > 1.4);
    $("h-chain").textContent = R.chain > 1 ? `${R.chain} ring chain` : "";
    $("spd-i").style.width = clamp((g.v - 4) / 50, 0, 1) * 100 + "%"; $("spd-v").textContent = `${Math.round(g.v * 3.6)} km/h`;
    $("spd").classList.toggle("stall", g.v < STALL + 2);
    $("h-alt").textContent = `${Math.round(g.z - H(g.x, g.y))} m`;
    this.boost();
  },
  title() { $("t-best").textContent = save.runs ? `Best ${save.best} · ${save.bestDist} m` : "Mouse to steer · click or Shift to flap · Space airbrake"; },
};
function pause() { R.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); R.state = "fly"; }
function toTitle() { for (const m of ["m-pause", "m-crash", "m-set"]) $(m).classList.add("hidden"); R.state = "title"; R.g = null; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.click(); startRun(); };
$("b-pause").onclick = pause; $("p-resume").onclick = resume; $("p-title").onclick = toTitle; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startRun(); };
$("c-retry").onclick = () => { $("m-crash").classList.add("hidden"); startRun(); }; $("c-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-sens").value = save.sens * 100; $("st-inv").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (save.invert ? "1" : "0"))); $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-sens").oninput = (e) => { save.sens = e.target.value / 100; persist(); };
$("st-inv").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.invert = b.dataset.v === "1"; persist(); $("st-inv").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ boot
const bot = Q.has("auto"), god = Q.has("god");
window.__glide = () => ({ state: R.state, dist: Math.round(R.dist), score: Math.round(R.score), v: R.g && +R.g.v.toFixed(1), z: R.g && +R.g.z.toFixed(1), clear: R.g && +(R.g.z - H(R.g.x, R.g.y)).toFixed(1), chain: R.chain, rings: R.rings, chunks: chunks.size, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (R.state !== "paused") update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
R.state = "title"; R.g = null; update(0);
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); ui.show("title"); ui.title();
  if (bot || Q.has("play")) startRun();
}, 400);
