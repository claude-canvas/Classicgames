// STORM BEACON — keep the light on a storm-lashed headland and guide ships past hidden reefs. Rendered with the
// projection3d library (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. waves.js is the sea,
// ships.js the vessels and their navigation, scene.js the coast; this file runs the nights, the beam, weather,
// camera and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, blob, tube, mulberry32, vnoise } from "./mesh.js";
import { NIGHTS, ROUTE } from "./levels.js";
import { buildScene, LIGHT, MOUTH, TOWN_LIGHTS, HARBOUR_LIGHTS, landH } from "./scene.js";
import { sea } from "./waves.js";
import { TYPES, buildShip, pose, putShip, navigate } from "./ships.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
  if (px > 3.0e6) dpr *= Math.sqrt(3.0e6 / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}

// ------------------------------------------------------------------ save
const DEF = { best: {}, stars: {}, unlocked: 0, volume: 0.8, music: 0.6, rain: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("stormbeacon.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("stormbeacon.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const stat = new Mesh(600000), seg = {};
{
  const O = new Mesh(300000), A = new Mesh(8000), S = new Mesh(160000);
  buildScene(O, A, S);
  for (const [k, m] of [["O", O], ["S", S], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
}
const MODELS = Object.fromEntries(Object.keys(TYPES).map((k) => [k, buildShip(k)]));
const LENS = [LIGHT.x, LIGHT.y, LIGHT.lens];

// ------------------------------------------------------------------ night state
const G = { state: "loading", ni: 0, N: NIGHTS[0], t: 0, ships: [], spawned: 0, nextSpawn: 0, saved: 0, wrecked: 0, lives: 3, score: 0, combo: 0, wrecks: [], hornT: 0, hornCd: 0, flash: 0, boltT: 8, bolt: null, reefMesh: null, buoys: [], storm: 0.7, rain: 0.6 };
let time = 0, rnd = mulberry32(5);
function startNight(i) {
  G.ni = i; const N = (G.N = NIGHTS[i]); rnd = mulberry32(100 + i * 7 + Math.floor(Math.random() * 1000));
  Object.assign(G, { t: 0, ships: [], spawned: 0, nextSpawn: 4, saved: 0, wrecked: 0, lives: i >= 3 ? 4 : 3, score: 0, combo: 0, wrecks: [], hornT: 0, hornCd: 0, boltT: 5, storm: N.storm, rain: N.rain });
  buildReefs(N); buildBuoys();
  G.state = "brief"; ui.show("brief");
  $("b-num").textContent = `NIGHT ${i + 1}`; $("b-name").textContent = N.name; $("b-tip").textContent = N.tip;
  $("b-tasks").textContent = `${N.ships} ships · ${G.lives} lives`;
  if (bot) setTimeout(go, 500);
}
function go() { if (G.state !== "brief") return; G.state = "play"; ui.show("hud"); ui.hud(); }
function buildReefs(N) {
  const m = new Mesh(30000), r = mulberry32(77);
  for (const [x, y, rad] of N.reefs) {
    const n = 4 + Math.floor(rad / 5);
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * rad * 0.75, s = 2 + r() * 4.5, h = 1 + r() * 5 * (1 - d / rad);
      blob(m, [x + Math.cos(a) * d, y + Math.sin(a) * d, h * 0.3 - 1.5], s * (1 + r() * 0.6), s, h + 1.5, [0.16, 0.16, 0.17], MAT.ROCK, 7, 4, (i, j) => 0.75 + 0.5 * vnoise(i * 1.9 + k * 3 + x, j * 1.4, 9));
    }
  }
  G.reefMesh = m;
  const arr = new Float32Array(48); N.reefs.slice(0, 12).forEach(([x, y, rr], i) => arr.set([x, y, rr, 0], i * 4)); G.reefU = arr;
}
function buildBuoys() {
  G.buoys = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [x0, y0] = ROUTE[i], [x1, y1] = ROUTE[i + 1], L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    // entering from sea: red to port (left of travel), green to starboard
    const px = -uy, py = ux;
    G.buoys.push({ x: x1 - px * 34, y: y1 - py * 34, red: false, ph: i * 0.7 }, { x: x1 + px * 34, y: y1 + py * 34, red: true, ph: i * 0.7 + 0.35 });
  }
  G.buoys = G.buoys.filter((b) => b.y > 95);
}
function spawnShip() {
  const N = G.N, types = Object.entries(N.types).flatMap(([k, v]) => Array(v).fill(k)), type = types[Math.floor(rnd() * types.length)];
  const x = -420 + rnd() * 700, y = 760 + rnd() * 140;
  G.ships.push({ type, T: TYPES[type], model: MODELS[type], x, y, hd: Math.atan2(ROUTE[0][0] - x, ROUTE[0][1] - y), v: TYPES[type].speed, wp: 0, conf: 0.55, err: (rnd() - 0.5) * 0.3, errBias: (rnd() - 0.5) * 0.02, spdMul: 0.9 + rnd() * 0.2, lit: false, litT: 0, heave: 0, pitch: 0, roll: 0, bellT: 3 + rnd() * 10, warn: 0 });
  G.spawned++;
}
function finish(win) {
  G.state = "done";
  const N = G.N, stars = win ? Math.max(1, 3 - G.wrecked) : 0;
  const isBest = !save.best[G.ni] || G.score > save.best[G.ni];
  if (win) { save.best[G.ni] = Math.max(save.best[G.ni] || 0, G.score); save.stars[G.ni] = Math.max(save.stars[G.ni] || 0, stars); save.unlocked = Math.max(save.unlocked, Math.min(NIGHTS.length - 1, G.ni + 1)); persist(); }
  $("d-k").textContent = win ? "Dawn breaks" : "The light failed them"; $("d-t").textContent = N.name;
  $("d-saved").textContent = `${G.saved} / ${N.ships}`; $("d-lost").textContent = G.wrecked; $("d-score").textContent = G.score + (win && isBest && G.score > 0 ? "  · new best" : "");
  $("d-next").classList.toggle("hidden", !win || G.ni >= NIGHTS.length - 1);
  for (let i = 0; i < 3; i++) $("s" + i).classList.remove("on");
  $("m-done").classList.remove("hidden");
  for (let i = 0; i < stars; i++) setTimeout(() => { $("s" + i).classList.add("on"); audio.star(i); }, 500 + i * 400);
}

// ------------------------------------------------------------------ the beam
const lens = { yaw: 0.25, pitch: -0.12, vy: 0, vp: 0, focus: false, aim: [-80, 420, 0] };
function beamDir() { const c = Math.cos(lens.pitch); return [Math.sin(lens.yaw) * c, Math.cos(lens.yaw) * c, Math.sin(lens.pitch)]; }
function beamParams() {
  const half = (lens.focus ? 1.7 : 2.8) * (Math.PI / 180), reach = (lens.focus ? 980 : 720) * (1 - G.rain * 0.22);
  return { half, reach };
}
function updateLens(dt) {
  const d = sub(lens.aim, LENS), wantYaw = Math.atan2(d[0], d[1]), wantPitch = Math.atan2(d[2], Math.hypot(d[0], d[1]));
  let dy = wantYaw - lens.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
  const dp = wantPitch - lens.pitch, MAXV = lens.focus ? 0.9 : 1.6, ACC = 5;
  const tvy = clamp(dy * 4, -MAXV, MAXV), tvp = clamp(dp * 4, -MAXV, MAXV);
  lens.vy += clamp(tvy - lens.vy, -ACC * dt, ACC * dt); lens.vp += clamp(tvp - lens.vp, -ACC * dt, ACC * dt);
  lens.yaw += lens.vy * dt; lens.pitch = clamp(lens.pitch + lens.vp * dt, -0.6, 0.05);
}
function inBeam(p, radius) {
  const { half, reach } = beamParams(), d = sub(p, LENS), L = Math.hypot(d[0], d[1], d[2]);
  if (L > reach) return 0;
  const c = dot(d, beamDir()) / L, ang = Math.acos(clamp(c, -1, 1));
  return ang < half * 1.25 + Math.atan(radius / L) ? 1 : 0;
}

// ------------------------------------------------------------------ input
const input = { keys: new Set() };
function pointerToSea(cx, cy) {
  const mag = space.magnifier, aspect = canvas.width / canvas.height, nx = (cx / innerWidth) * 2 - 1, ny = 1 - (cy / innerHeight) * 2;
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const d = nrm([Z[0] - X[0] * nx * (1.6 / mag) + Y[0] * ny * (1.6 / (mag * aspect)), Z[1] - X[1] * nx * (1.6 / mag) + Y[1] * ny * (1.6 / (mag * aspect)), Z[2] - X[2] * nx * (1.6 / mag) + Y[2] * ny * (1.6 / (mag * aspect))]);
  const E = [space.Xc, space.Yc, space.Zc];
  if (d[2] > -0.01) { const k = 1600; return [E[0] + d[0] * k, E[1] + d[1] * k, 0]; }
  const t = -E[2] / d[2]; return [E[0] + d[0] * t, E[1] + d[1] * t, 0];
}
addEventListener("pointermove", (e) => { if (G.state === "play" || G.state === "title") lens.aim = pointerToSea(e.clientX, e.clientY); });
canvas.addEventListener("pointerdown", (e) => { audio.init(); lens.aim = pointerToSea(e.clientX, e.clientY); if (G.state === "play" && e.pointerType === "mouse") lens.focus = true; });
addEventListener("pointerup", () => { lens.focus = false; });
$("c-focus").addEventListener("pointerdown", (e) => { lens.focus = true; e.stopPropagation(); e.preventDefault(); });
$("c-focus").addEventListener("pointerup", () => (lens.focus = false)); $("c-focus").addEventListener("pointerleave", () => (lens.focus = false));
$("c-horn").onclick = () => horn();
$("c-view").onclick = () => (cam.over = !cam.over);
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if (e.code === "Space") { e.preventDefault(); if (G.state === "brief") go(); else horn(); }
  if (e.code === "KeyF" || e.code === "ShiftLeft") lens.focus = true;
  if (e.code === "KeyC" && !e.repeat) cam.over = !cam.over;
  if (e.code === "Escape" || e.code === "KeyP") { if (G.state === "play") pause(); else if (G.state === "paused") resume(); }
});
addEventListener("keyup", (e) => { input.keys.delete(e.code); if (e.code === "KeyF" || e.code === "ShiftLeft") lens.focus = false; });
function horn() {
  if (G.state !== "play" || G.hornCd > 0) return;
  G.hornT = 4; G.hornCd = 9; audio.horn(); toast("Fog horn — ships hold position");
}

// ------------------------------------------------------------------ update
const rain = [];
for (let i = 0; i < 1100; i++) rain.push({ x: Math.random() * 160 - 80, y: Math.random() * 160 - 80, z: Math.random() * 60, s: 0.6 + Math.random() * 0.5 });
const spray = [];
function update(dt) {
  time += dt;
  const N = G.N;
  if (G.state === "play") {
    G.t += dt;
    const k = input.keys;
    if (k.has("ArrowLeft") || k.has("KeyA")) lens.aim = rotAim(-dt * 0.9); if (k.has("ArrowRight") || k.has("KeyD")) lens.aim = rotAim(dt * 0.9);
    if (k.has("ArrowUp") || k.has("KeyW")) lens.aim = farAim(dt * 260); if (k.has("ArrowDown") || k.has("KeyS")) lens.aim = farAim(-dt * 260);
    if (bot) botStep(dt);
    // spawning
    if (G.spawned < N.ships && G.t > G.nextSpawn) { spawnShip(); G.nextSpawn = G.t + N.every[0] + rnd() * (N.every[1] - N.every[0]); }
    G.hornT = Math.max(0, G.hornT - dt); G.hornCd = Math.max(0, G.hornCd - dt);
    const cur = N.gust ? [N.current[0] * Math.sin(G.t * 0.05) * 1.4, N.current[1]] : N.current;
    for (const s of G.ships) {
      s.lit = inBeam([s.x, s.y, s.heave + s.T.D + 2], s.T.L * 0.5) > 0;
      if (s.lit) s.litT += dt;
      const held = G.hornT > 0 && Math.hypot(s.x - LIGHT.x, s.y - LIGHT.y) < 520;
      navigate(s, dt, N, cur, rnd, held);
      pose(s, time, G.storm);
      s.bellT -= dt; if (s.bellT < 0) { s.bellT = 8 + rnd() * 14; if (Math.hypot(s.x, s.y) < 500) audio.bell(0.03); }
      let near = 1e9; for (const [x, y, r] of N.reefs) near = Math.min(near, Math.hypot(x - s.x, y - s.y) - r);
      s.near = near; s.warn = near < 70 && s.conf < 0.3 ? 1 : 0;
    }
    G.ships = G.ships.filter((s) => {
      const hitReef = N.reefs.some(([x, y, r]) => Math.hypot(x - s.x, y - s.y) < r + s.T.L * 0.3);
      const inMouth = Math.hypot(s.x - MOUTH.x, s.y - MOUTH.y) < MOUTH.w + 4 || (s.y < MOUTH.y + 4 && s.x < -150 && s.x > -290);
      const aground = !inMouth && landH(s.x, s.y) > -0.8;
      if (hitReef || aground || Math.abs(s.x) > 1400 || s.y > 1400) { wreck(s); return false; }
      if (inMouth) { saveShip(s); return false; }
      return true;
    });
    if (G.wrecked >= G.lives) { G.state = "ending"; G.endT = 2.5; G.win = false; }
    else if (G.spawned >= N.ships && G.ships.length === 0) { G.state = "ending"; G.endT = 2; G.win = true; }
  }
  if (G.state === "ending") { G.endT -= dt; if (G.endT <= 0) finish(G.win); }
  if (G.state === "title") { lens.aim = [Math.sin(time * 0.25) * 420 - 60, 380 + Math.cos(time * 0.17) * 160, 0]; G.storm = 0.75; G.rain = 0.6; }
  updateLens(dt);
  // wrecks sink, flares rise
  for (const w of G.wrecks) { w.t += dt; w.list = Math.min(0.7, w.t * 0.12) * w.side; if (w.t > 0.5 && w.flares < 3 && rnd() < dt * 0.6) { w.flares++; spray.push({ x: w.x, y: w.y, z: 6, vx: (rnd() - 0.5) * 4, vy: (rnd() - 0.5) * 4, vz: 34 + rnd() * 8, life: 4, max: 4, col: [1, 0.15, 0.08], flare: true }); } }
  G.wrecks = G.wrecks.filter((w) => w.t < 14);
  // lightning
  G.boltT -= dt;
  if (G.boltT <= 0 && G.state !== "loading") {
    G.boltT = N.bolt[0] + rnd() * (N.bolt[1] - N.bolt[0]);
    const x = -900 + rnd() * 1600, y = 500 + rnd() * 1300; G.bolt = { pts: boltPath([x, y, 520], [x + (rnd() - 0.5) * 150, y + (rnd() - 0.5) * 150, 0]), t: 0 };
    G.flash = 1; audio.thunder(Math.hypot(x, y));
  }
  if (G.bolt) { G.bolt.t += dt; if (G.bolt.t > 0.35) G.bolt = null; }
  G.flash = Math.max(0, G.flash - dt * 3.2) * (G.bolt && Math.sin(G.bolt.t * 60) > 0.3 ? 1 : 0.92);
  // spray off the reefs and flares
  if (N && G.state !== "loading") for (const [x, y, r] of N.reefs) if (rnd() < dt * 1.2 * G.storm) { const a = rnd() * TAU; for (let i = 0; i < 10; i++) spray.push({ x: x + Math.cos(a) * r * 0.8, y: y + Math.sin(a) * r * 0.8, z: 1, vx: (rnd() - 0.5) * 6, vy: (rnd() - 0.5) * 6, vz: 6 + rnd() * 10, life: 1.4, max: 1.4, col: [0.5, 0.55, 0.6] }); }
  for (const p of spray) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= (p.flare ? 6 : 9.8) * dt; p.life -= dt; }
  for (let i = spray.length - 1; i >= 0; i--) if (spray[i].life <= 0 || spray.length > 700 && i < 100) spray.splice(i, 1);
  audio.update(G.storm, G.rain * save.rain);
  ui.frame(dt);
}
function rotAim(da) { const d = sub(lens.aim, LENS), r = Math.hypot(d[0], d[1]), a = Math.atan2(d[0], d[1]) + da; return [LENS[0] + Math.sin(a) * r, LENS[1] + Math.cos(a) * r, 0]; }
function farAim(dr) { const d = sub(lens.aim, LENS), r = Math.hypot(d[0], d[1]), a = Math.atan2(d[0], d[1]), nr = clamp(r + dr, 60, 1200); return [LENS[0] + Math.sin(a) * nr, LENS[1] + Math.cos(a) * nr, 0]; }
function saveShip(s) {
  G.saved++; G.combo++; const mult = 1 + 0.25 * Math.min(4, G.combo - 1), pts = Math.round(s.T.pts * mult);
  G.score += pts; pop("Saved!", `+${pts}${mult > 1 ? `  ×${mult}` : ""}`); audio.saved(G.combo); ui.hud();
}
function wreck(s) {
  G.wrecked++; G.combo = 0; G.wrecks.push({ ...s, t: 0, side: rnd() < 0.5 ? -1 : 1, flares: 0, sink: 0 });
  pop("Wrecked!", `the ${s.type} struck the rocks`); audio.wreck(); G.shake = 1; ui.hud();
}
function boltPath(a, b) {
  const pts = [a]; let p = a.slice();
  for (let i = 1; i <= 14; i++) { const t = i / 14; p = [lerp(a[0], b[0], t) + (rnd() - 0.5) * 40, lerp(a[1], b[1], t) + (rnd() - 0.5) * 40, lerp(a[2], b[2], t)]; pts.push(p); }
  return pts;
}

// ------------------------------------------------------------------ beam bot (?auto)
const bot = Q.has("auto") ? { tgt: null, t: 0 } : null;
function botStep(dt) {
  bot.t -= dt;
  if (bot.t <= 0 || !G.ships.includes(bot.tgt)) {
    let best = null, bs = -1e9; for (const s of G.ships) { const sc = -s.conf * 3 - s.near / 60; if (sc > bs) { bs = sc; best = s; } }
    bot.tgt = best; bot.t = 2.5;
    if (G.ships.filter((s) => s.conf < 0.2 && s.near < 60).length > 1) horn();
  }
  if (bot.tgt) lens.aim = [bot.tgt.x + Math.sin(bot.tgt.hd) * 10, bot.tgt.y + Math.cos(bot.tgt.hd) * 10, 0];
}

// ------------------------------------------------------------------ camera
const cam = { over: false, E: [0, -30, 70], T: [-60, 400, 0] };
function updateCamera(dt) {
  let E, T, mag = 1.7;
  const spot = lens.aim;
  if (G.state === "title" || G.state === "loading") { E = [70 + Math.sin(time * 0.05) * 20, -95, 72]; T = [-60, 420, 8]; mag = 1.6; }
  else if (cam.over) { E = [-60, -170, 330]; T = [-80, 360, 0]; mag = 1.75; }
  else { E = [LENS[0] + 8, LENS[1] - 44, LENS[2] + 24]; T = [lerp(-80, spot[0], 0.45), lerp(400, clamp(spot[1], 100, 900), 0.4), 0]; mag = 1.8; }
  const k = Math.min(1, dt * 2.2);
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k));
  G.shake = Math.max(0, (G.shake || 0) - dt * 2);
  const sh = (G.shake * 0.4 + G.storm * 0.06) * (Math.sin(time * 37) + Math.sin(time * 23) * 0.5);
  space.magnifier = mag * 1.6;
  space.lookAt(cam.E[0] + sh, cam.E[1], cam.E[2] + sh * 0.5, cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(120000), A = new Mesh(60000), dyn = new Mesh(220000);
const camPos = () => [space.Xc, space.Yc, space.Zc];
function streak(p0, p1, w, col) {
  const E = camPos(), d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v));
  const a = [p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], b = [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w];
  const c = [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], e = [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w];
  A.quad(a, b, c, e, col, MAT.ADD);
}
function beamCone() {
  const { half, reach } = beamParams(), f = beamDir(), up = Math.abs(f[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  const u = nrm(cross(f, up)), v = cross(u, f), NS = 18;
  // three nested cones: a hot core and softer halos; brightness fades along the length
  for (const [k, inten] of [[0.4, 0.2], [1.0, 0.075], [1.9, 0.025]]) {
    const L = reach * (k > 1.5 ? 0.6 : 0.95), R = Math.tan(half * k) * L;
    for (let i = 0; i < NS; i++) {
      const a0 = (i / NS) * TAU, a1 = ((i + 1) / NS) * TAU;
      const P = (a, t) => [LENS[0] + f[0] * L * t + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * R * t + 0.0, LENS[1] + f[1] * L * t + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * R * t, LENS[2] + f[2] * L * t + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * R * t];
      for (const [t0, t1] of [[0.002, 0.08], [0.08, 0.3], [0.3, 1]]) {
        const c0 = inten * Math.pow(1 - t0, 2.2) * (1 + G.rain * 0.6), c1 = inten * Math.pow(1 - t1, 2.2) * (1 + G.rain * 0.6);
        const C0 = [c0, c0 * 0.9, c0 * 0.72], C1 = [c1, c1 * 0.9, c1 * 0.72];
        A.quad4(P(a0, t0), P(a1, t0), P(a1, t1), P(a0, t1), C0, C0, C1, C1, MAT.ADD);
      }
    }
  }
  // the lamp itself: a hard glare and a slowly turning lens flare
  A.sprite(LENS[0], LENS[1], LENS[2], 3.2, 1.6, 1.4, 1.05); A.sprite(LENS[0] + f[0] * 2, LENS[1] + f[1] * 2, LENS[2] + f[2] * 2, 9, 0.6, 0.5, 0.35);
}
function buildDynamic() {
  D.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  if (G.reefMesh) D.append(G.reefMesh);
  // buoys bob and blink
  for (const b of G.buoys) {
    const w = sea(b.x, b.y, time, G.storm), z = w.h, col = b.red ? [0.75, 0.1, 0.06] : [0.08, 0.55, 0.2];
    tube(D, b.x, b.y, 8, 1.4, z - 1, 1.1, z + 1.5, col, MAT.GLOSS); tube(D, b.x, b.y, 6, 0.3, z + 1.5, 0.15, z + 4.5, [0.15, 0.15, 0.15], MAT.GLOSS);
    const on = (time + b.ph * 2) % 2.5 < 0.5; if (on) { const c = b.red ? [1, 0.2, 0.1] : [0.2, 1, 0.35]; A.sprite(b.x, b.y, z + 4.8, 3.2, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6); A.sprite(b.x, b.y, z + 4.8, 0.7, c[0], c[1], c[2]); }
  }
  // ships + their condition halo
  for (const s of G.ships) {
    putShip(D, A, s.model, s);
    const k = 0.5 + 0.5 * Math.sin(time * 6);
    if (s.warn) A.sprite(s.x, s.y, s.heave + s.T.D + 12, 3.0, 0.9 * k, 0.12 * k, 0.05 * k);
    else if (s.conf > 0.3) A.sprite(s.x, s.y, s.heave + s.T.D + 12, 1.6, 0.25 * s.conf, 0.22 * s.conf, 0.16 * s.conf);
    // wake
    for (let i = 1; i < 6; i++) { const bx = s.x - Math.sin(s.hd) * (s.T.L * 0.5 + i * 5), by = s.y - Math.cos(s.hd) * (s.T.L * 0.5 + i * 5); A.sprite(bx, by, sea(bx, by, time, G.storm).h + 0.3, 2 + i * 0.8, 0.06 / i, 0.07 / i, 0.08 / i); }
  }
  for (const w of G.wrecks) { putShip(D, A, w.model, w, w.t * 0.5); }
  // spray + flares
  for (const p of spray) { const k = p.life / p.max; if (p.flare) { A.sprite(p.x, p.y, p.z, 2.5, 1.2 * k, 0.2 * k, 0.1 * k); A.sprite(p.x, p.y, p.z, 0.6, 1.4, 0.6, 0.4); } else A.sprite(p.x, p.y, p.z, 1.6, p.col[0] * k * 0.35, p.col[1] * k * 0.35, p.col[2] * k * 0.35); }
  // lightning bolt
  if (G.bolt) { const k = 1 - G.bolt.t / 0.35; for (let i = 1; i < G.bolt.pts.length; i++) { streak(G.bolt.pts[i - 1], G.bolt.pts[i], 2.2, [2.5 * k, 2.6 * k, 3 * k]); streak(G.bolt.pts[i - 1], G.bolt.pts[i], 9, [0.3 * k, 0.35 * k, 0.5 * k]); } }
  if (G.state !== "loading") beamCone();
  // rain: streaks around the camera, glittering where the beam crosses them
  const E = camPos(), { half, reach } = beamParams(), f = beamDir(), cosH = Math.cos(half * 1.3);
  const nRain = Math.floor(rain.length * G.rain * save.rain), wind = [3 + G.storm * 6, -2];
  for (let i = 0; i < nRain; i++) {
    const r = rain[i];
    r.z -= 26 * r.s * (1 / 60); if (r.z < 0) { r.z = 60; r.x = Math.random() * 160 - 80; r.y = Math.random() * 160 - 80; }
    const cx = E[0] + 10 + r.x, cy = E[1] + 70 + r.y, cz = E[2] - 30 + r.z;
    const p0 = [cx, cy, cz], p1 = [cx + wind[0] * 0.05, cy + wind[1] * 0.05, cz - 1.1 * r.s];
    const d = sub(p0, LENS), L = Math.hypot(d[0], d[1], d[2]), inb = L < reach && dot(d, f) / L > cosH ? 1 : 0;
    const k = 0.05 + inb * 0.6 + G.flash * 0.25;
    streak(p0, p1, 0.025, [k * 0.8, k * 0.85, k]);
  }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: dyn.n - oA };
}

// ------------------------------------------------------------------ lights
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [], E = cam.T;
  for (const p of TOWN_LIGHTS) L.push({ p, c: [1, 0.6, 0.28], k: 4, d: Math.hypot(p[0] - E[0], p[1] - E[1]) * 0.5 });
  for (const [x, y, z, c] of HARBOUR_LIGHTS) L.push({ p: [x, y, z + 1], c, k: 10, d: 0 });
  for (const w of G.wrecks) L.push({ p: [w.x, w.y, 8], c: [1, 0.25, 0.1], k: 14, d: -1 });
  for (const b of G.buoys) if ((time + b.ph * 2) % 2.5 < 0.5) L.push({ p: [b.x, b.y, 5], c: b.red ? [1, 0.15, 0.1] : [0.2, 1, 0.3], k: 2.2, d: Math.hypot(b.x - E[0], b.y - E[1]) * 0.4 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}

function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights(), { half, reach } = beamParams();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform1f(U.uStorm, G.storm); gl.uniform1f(U.uFlash, G.flash);
  gl.uniform3fv(U.uBeamPos, LENS); gl.uniform3fv(U.uBeamDir, beamDir()); gl.uniform1f(U.uBeamCos, Math.cos(half)); gl.uniform1f(U.uBeamReach, reach);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  gl.uniform4fv(U.uReefs, G.reefU || new Float32Array(48));
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("O"); S("S"); space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: G.flash * 0.6 });
}

// ------------------------------------------------------------------ UI
let popT = 0, toastT = 0;
function pop(t, s) { $("pop-t").textContent = t; $("pop-s").textContent = s; $("pop").classList.add("show"); popT = 2; }
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); toastT = 2.4; }
const marks = [];
function project(p) {
  const v = sub(p, camPos()), X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const xp = -dot(v, X), yp = dot(v, Y), zp = dot(v, Z), k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
  return { x: ((xp * k) / Math.abs(zp) + 1) * 0.5 * innerWidth, y: (1 - (yp * k * aspect) / Math.abs(zp)) * 0.5 * innerHeight, behind: zp < 0 };
}
const ui = {
  show(w) { for (const id of ["title", "nights", "brief", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  hud() {
    $("h-name").textContent = `NIGHT ${G.ni + 1} · ${G.N.name}`; $("h-saved").textContent = `${G.saved} / ${G.N.ships}`; $("h-score").textContent = G.score;
    $("lives").innerHTML = Array.from({ length: G.lives }, (_, i) => `<i class="${i < G.wrecked ? "lost" : ""}"></i>`).join("");
  },
  frame(dt) {
    if (popT > 0) { popT -= dt; if (popT <= 0) $("pop").classList.remove("show"); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("show"); }
    if (G.state !== "play") { $("edges").innerHTML = ""; return; }
    $("horn-i").style.setProperty("--p", `${(1 - G.hornCd / 9) * 360}deg`); $("c-horn").classList.toggle("dis", G.hornCd > 0);
    $("c-focus").classList.toggle("on", lens.focus);
    // edge markers for ships off screen
    let html = "";
    for (const s of G.ships) {
      const p = project([s.x, s.y, s.heave + 6]), off = p.behind || p.x < 20 || p.x > innerWidth - 20 || p.y < 20 || p.y > innerHeight - 20;
      if (!off && !s.warn) continue;
      if (off) {
        const cx = innerWidth / 2, cy = innerHeight / 2; let dx = p.x - cx, dy = p.y - cy; if (p.behind) { dx = -dx; dy = -dy; }
        const k = Math.min((cx - 30) / Math.abs(dx || 1e-3), (cy - 30) / Math.abs(dy || 1e-3)), ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
        html += `<i class="edge ${s.warn ? "warn" : ""}" style="left:${ex}px;top:${ey}px;transform:translate(-50%,-50%) rotate(${a}rad)"></i>`;
      } else html += `<i class="ring warn" style="left:${p.x}px;top:${p.y}px"></i>`;
    }
    $("edges").innerHTML = html;
  },
  title() { const n = Object.values(save.stars).reduce((a, b) => a + b, 0); $("t-foot").textContent = `★ ${n} / ${NIGHTS.length * 3}  ·  point to sweep the beam · hold to focus · Space fog horn · C overview`; },
  nights() {
    $("grid").innerHTML = NIGHTS.map((nn, i) => {
      const lock = i > save.unlocked, st = save.stars[i] || 0;
      return `<button class="card" data-i="${i}" ${lock ? "disabled" : ""}><span class="num">${["I", "II", "III", "IV", "V"][i]}</span>${lock ? '<span class="lock">🔒</span>' : ""}<b>${nn.name}</b><span class="best">${save.best[i] ? "best " + save.best[i] : nn.ships + " ships"}</span><span class="st">${[0, 1, 2].map((k) => (k < st ? "<i>★</i>" : "★")).join("")}</span></button>`;
    }).join("");
    $("grid").querySelectorAll(".card").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); startNight(+b.dataset.i); }));
  },
};
function pause() { G.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = "play"; }
function toTitle() { for (const m of ["m-pause", "m-done", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; G.ships = []; G.wrecks = []; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.click(); startNight(Math.min(save.unlocked, NIGHTS.length - 1)); };
$("t-nights").onclick = () => { audio.init(); audio.click(); G.state = "nights"; ui.nights(); ui.show("nights"); };
$("n-back").onclick = () => { G.state = "title"; ui.show("title"); ui.title(); };
$("b-go").onclick = () => { audio.init(); audio.click(); go(); };
$("b-pause").onclick = () => pause();
$("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startNight(G.ni); }; $("p-title").onclick = toTitle;
$("d-retry").onclick = () => { $("m-done").classList.add("hidden"); startNight(G.ni); };
$("d-nights").onclick = () => { $("m-done").classList.add("hidden"); G.state = "nights"; ui.nights(); ui.show("nights"); };
$("d-next").onclick = () => { $("m-done").classList.add("hidden"); startNight(G.ni + 1); };
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-rain").value = save.rain * 100; $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-rain").oninput = (e) => { save.rain = e.target.value / 100; persist(); };

// ------------------------------------------------------------------ boot
window.__storm = () => ({ state: G.state, night: G.ni + 1, t: +G.t.toFixed(1), ships: G.ships.map((s) => [s.type, Math.round(s.x), Math.round(s.y), +s.conf.toFixed(2), s.lit]), saved: G.saved, wrecked: G.wrecked, score: G.score, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (G.state !== "paused") update(bot && G.state === "play" ? dt * (+Q.get("speed") || 1) : dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
buildReefs(NIGHTS[1]); buildBuoys();
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); G.state = "title"; ui.show("title"); ui.title();
  if (Q.has("night")) startNight(clamp(+Q.get("night") - 1, 0, NIGHTS.length - 1)); else if (bot) startNight(0);
}, 400);
