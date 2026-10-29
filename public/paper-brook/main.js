// PAPER BROOK — guide a paper boat down a golden-hour forest brook. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom / god rays / depth of field. See DESIGN.md.
// brook.js is the stream, scene.js the chunked static world, shade.js the dapple map, boat.js the physics; this
// file runs the journey, input, camera, dynamic objects, effects and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, limb, blob, mixc, smooth, norm, cross as xcross } from "./mesh.js";
import { frame, toWorld, wzAt, curAt, SECTIONS, CHECKPOINTS, FINISH, PETALS, TWIGS, CASCADES, WHIRL, MILL, SUN, S_MAX } from "./brook.js";
import { buildChunk, NCHUNK, TREES, chunkOf, wheelModel, LANTERNS, WINDOWS, CHIMNEYS } from "./scene.js";
import { bakeShade, sampler, RES } from "./shade.js";
import { DT, makeBoat, stepBoat, autopilot } from "./boat.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const audio = new Audio();
let pxCap = 2.1e6;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
const DEF = { best: 0, bestTime: 0, stars: 0, volume: 0.8, music: 0.6, diff: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("paperbrook.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("paperbrook.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;
const DIFF = [{ cur: 0.85, wet: 0.6, name: "Gentle" }, { cur: 1, wet: 1, name: "Brook" }, { cur: 1.2, wet: 1.25, name: "Torrent" }];

// ------------------------------------------------------------------ static world (streamed from worker.js) + dapple map
const chunks = new Array(NCHUNK).fill(null);
let shadeMap = null, totalVerts = 0;
const shadeTex = gl.createTexture();
function addChunk(c) {
  const pb = gl.createBuffer(), cb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, c.pos, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, c.col, gl.STATIC_DRAW);
  chunks[c.ci] = { pb, cb, O: c.O, G: c.G, W: c.W, A: c.A };
  totalVerts += c.n;
  if (c.lanterns) { LANTERNS.push(...c.lanterns); WINDOWS.push(...c.windows); CHIMNEYS.push(...c.chimneys); }
}
function setShade(m) {
  shadeMap = sampler(m);
  gl.bindTexture(gl.TEXTURE_2D, shadeTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, m.W, m.H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, m.data);
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
}
function buildSync() { if (!shadeMap) setShade(bakeShade(TREES)); for (let ci = 0; ci < NCHUNK; ci++) if (!chunks[ci]) addChunk(buildChunk(ci)); }
const T0 = performance.now();
try {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => { const m = e.data; if (m.type === "shade") setShade(m); else if (m.type === "chunk") addChunk(m); else if (m.type === "done") console.log(`Paper Brook: world built in ${Math.round(performance.now() - T0)} ms (${totalVerts} verts)`); };
  worker.onerror = (e) => { console.warn("Paper Brook: worker failed, building on the main thread", e.message); buildSync(); };
  worker.postMessage({ start: chunkOf(Q.has("s") ? +Q.get("s") : 0) });
} catch (e) { buildSync(); }
const START_S = Q.has("s") ? +Q.get("s") : 2;
const worldReady = () => shadeMap && chunks.slice(chunkOf(START_S - 10), chunkOf(START_S + 130) + 1).every(Boolean);
const sunAtW = (x, y) => (shadeMap ? shadeMap.at(x, y) : 0.5);
const sunAtB = (s, x) => { const w = toWorld(s, x); return sunAtW(w[0], w[1]); };
const WHEEL = wheelModel();
// shaders compile while the worker is already building the world (the D3D backend can take seconds to link them)
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);

// ------------------------------------------------------------------ journey state
let state = "loading", demo = true, time = 0, acc = 0, runT = 0, score = 0, combo = 1, comboT = 0, got = 0, golds = 0, sinks = 0, cpIdx = 0, secIdx = 0, sinkT = 0, finishT = 0, cleanLands = 0;
let boat = makeBoat(2), prev = null, petals = [], twigs = [], twigNext = 0, extraTwigT = 0;
const W = { cur: 1, wet: 1, sun: sunAtB, twigs };
const bot = Q.has("auto");
function resetRun(isDemo, startS = 2) {
  demo = isDemo;
  const d = DIFF[isDemo ? 1 : save.diff]; W.cur = d.cur; W.wet = d.wet;
  boat = makeBoat(startS); boat.vs = curAt(startS, 0); prev = snap(boat);
  petals = PETALS.map((p, i) => ({ ...p, got: false, ph: i * 1.37 }));
  twigs.length = 0; twigNext = 0; extraTwigT = 4;
  while (twigNext < TWIGS.length && TWIGS[twigNext].s < startS + 4) twigNext++;
  runT = 0; score = 0; combo = 1; comboT = 0; got = 0; golds = 0; sinks = 0; cleanLands = 0; finishT = 0;
  cpIdx = 0; for (let i = 0; i < CHECKPOINTS.length; i++) if (startS >= CHECKPOINTS[i]) cpIdx = i;
  secIdx = frame(startS).sec; acc = 0;
  fx.splash.length = 0; fx.wake.length = 0; fx.rings.length = 0;
  cam.init = false;
}
const snap = (b) => ({ s: b.s, x: b.x, h: b.h, z: b.z });

// ------------------------------------------------------------------ input
const input = { keys: new Set(), steer: 0, touch: { l: false, r: false, puff: false, drag: false, hop: false } };
const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyS", "KeyA", "KeyD", "Space"]);
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code); if (KEYS.has(e.code)) e.preventDefault();
  if (e.code === "KeyC") cycleCam();
  if (e.code === "Escape" || e.code === "KeyP") { if (state === "play") pause(); else if (state === "paused") resume(); }
  if (e.code === "Enter" && state === "title") start();
});
addEventListener("keyup", (e) => input.keys.delete(e.code));
addEventListener("blur", () => { input.keys.clear(); if (state === "play") pause(); });
const tbtn = (id, k) => { const el = $(id); el.addEventListener("pointerdown", (e) => { audio.init(); input.touch[k] = true; e.preventDefault(); }); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, () => (input.touch[k] = false)); };
tbtn("t-left", "l"); tbtn("t-right", "r"); tbtn("t-puff", "puff"); tbtn("t-drag", "drag"); tbtn("t-hop", "hop");
function playerInput(dt) {
  const k = input.keys, t = input.touch;
  const want = (k.has("ArrowRight") || k.has("KeyD") || t.r ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") || t.l ? 1 : 0);
  input.steer += (want - input.steer) * (1 - Math.exp(-dt * (want === 0 ? 10 : 7)));
  if (Math.abs(input.steer) < 0.02 && want === 0) input.steer = 0;
  return { steer: input.steer, puff: k.has("KeyW") || k.has("ArrowUp") || t.puff, drag: k.has("KeyS") || k.has("ArrowDown") || t.drag, hop: k.has("Space") || t.hop };
}

// ------------------------------------------------------------------ simulation
const fx = { splash: [], wake: [], rings: [], bokeh: [], toast: [] };
let flash = 0, shake = 0;
function simStep(dt) {
  const ev = [];
  const auto = demo || bot || state === "done";
  const inp = state === "sink" ? { steer: 0, puff: false, drag: false, hop: false } : auto ? autopilot(boat, W, petals) : playerInput(dt);
  if (state === "done") { inp.puff = false; inp.hop = false; }
  rower.steer = inp.steer;
  stepBoat(boat, inp, dt, W, ev);
  for (const e of ev) if (e.type === "puff") rowStroke(Math.abs(inp.steer) > 0.3 ? -Math.sign(inp.steer) : -rower.side);
  // twigs: spawn ahead, drift, spin, stay inside the banks
  while (twigNext < TWIGS.length && TWIGS[twigNext].s < boat.s + 32) { const t = TWIGS[twigNext++]; if (t.s > boat.s + 3 && (save.diff > 0 || demo || twigNext % 2 === 0)) twigs.push({ ...t, vs: 0, vr: (Math.random() - 0.5) * 0.6, cd: 0, bob: Math.random() * 6 }); }
  if (!demo && save.diff === 2 && boat.s < 376) { extraTwigT -= dt; if (extraTwigT < 0) { extraTwigT = 7 + Math.random() * 5; const s = boat.s + 26; if (!CASCADES.some((c) => Math.abs(c.s - s) < 6)) twigs.push({ s, x: (Math.random() - 0.5) * 1.4, len: 0.3 + Math.random() * 0.35, rot: Math.random() * 3, hard: true, vs: 0, vr: 0.3, cd: 0, bob: 0 }); } }
  for (let i = twigs.length - 1; i >= 0; i--) {
    const t = twigs[i], f = frame(t.s);
    t.vs = curAt(t.s, t.x) * W.cur * 0.62; t.s += t.vs * dt; t.rot += t.vr * dt; t.vr *= Math.exp(-dt * 0.6); t.cd = Math.max(0, t.cd - dt);
    t.x += -t.x * 0.05 * dt; const lim = f.hw - 0.1 - Math.abs(Math.sin(t.rot)) * t.len / 2; if (Math.abs(t.x) > lim) { t.x = Math.sign(t.x) * lim; t.vr += 0.4 * dt * 60 * 0.01; }
    if (t.s < boat.s - 12 || t.s > S_MAX - 2) twigs.splice(i, 1);
  }
  for (const e of ev) onEvent(e);
  return ev;
}
function toast(text, cls = "") { const el = document.createElement("div"); el.className = "toast " + cls; el.textContent = text; $("toasts").appendChild(el); setTimeout(() => el.remove(), 1400); }
function onEvent(e) {
  if (demo) { if (e.type === "sink") { boat.wet = 0; } return; }
  const p = boat;
  if (e.type === "puff") audio.puff();
  if (e.type === "hop") audio.hop();
  if (e.type === "launch") audio.whoosh();
  if (e.type === "land" || e.type === "goodland" || e.type === "badland") { splash(0.6 + (e.v || 0) * 0.5, e.type === "badland" ? 1.6 : 1); audio.splash(e.type === "badland" ? 1 : 0.5); }
  if (e.type === "goodland") { cleanLands++; addScore(50, "+50 clean drop"); }
  if (e.type === "badland") { combo = 1; toast("Soaked!", "bad"); shake = 0.5; }
  if (e.type === "rock" || e.type === "twig" || e.type === "bank") { combo = 1; audio.bump(e.type === "rock" ? 1 : 0.6); shake = Math.min(1, shake + 0.35); splash(0.35, 0.6); }
  if (e.type === "lily") audio.lily();
  if (e.type === "sink" && state === "play") sink();
  void p;
}
function addScore(n, msg) { score += n; if (msg) toast(msg); }
function splash(k, big) {
  const w = toWorld(boat.s, boat.x), z = wzAt(boat.s);
  for (let i = 0; i < 22 * k; i++) { const a = Math.random() * TAU, v = 0.3 + Math.random() * 0.8 * big; fx.splash.push({ p: [w[0], w[1], z + 0.02], v: [Math.cos(a) * v * 0.6, Math.sin(a) * v * 0.6, 0.6 + Math.random() * 1.4 * big], life: 0.5 + Math.random() * 0.4 }); }
  fx.rings.push({ s: boat.s, x: boat.x, r: 0.08, life: 1.2, k: big });
}
function collectPetals() {
  for (const p of petals) {
    if (p.got || Math.abs(p.s - boat.s) > 0.5) continue;
    if (Math.hypot(p.s - boat.s, p.x - boat.x) < 0.27 && boat.z - wzAt(boat.s) < 0.18) {
      p.got = true; if (demo) continue;
      got++;
      if (comboT > 0) combo = Math.min(5, combo + 1); comboT = 2.5;
      if (p.kind === 2) { golds++; boat.breath = 1; addScore(50 * combo, `+${50 * combo} golden petal`); audio.petal(combo, true); }
      else { score += 10 * combo; audio.petal(combo, false); }
      const w = toWorld(p.s, p.x); for (let i = 0; i < 10; i++) fx.splash.push({ p: [w[0], w[1], wzAt(p.s) + 0.03], v: [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.5], life: 0.6, glow: p.kind });
    }
  }
}
function sink() {
  state = "sink"; sinkT = 0; sinks++; score = Math.max(0, score - 100); combo = 1; audio.sink();
  $("sunk").classList.add("show");
}
function respawn() {
  const cp = CHECKPOINTS[cpIdx] + 1.5;
  const keep = boat.sunT;
  boat = makeBoat(cp); boat.vs = curAt(cp, 0); boat.wet = 30; boat.sunT = keep; prev = snap(boat);
  twigs.length = 0; twigNext = 0; while (twigNext < TWIGS.length && TWIGS[twigNext].s < cp + 4) twigNext++;
  $("sunk").classList.remove("show"); state = "play"; cam.init = false;
}
function progress(dt) {
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 1; }
  collectPetals();
  const sec = frame(boat.s).sec;
  if (sec !== secIdx) { secIdx = sec; if (!demo) { banner(SECTIONS[sec].name); } }
  for (let i = cpIdx + 1; i < CHECKPOINTS.length; i++) if (boat.s >= CHECKPOINTS[i]) { cpIdx = i; if (!demo) { audio.chime(); addScore(100, "Lantern reached · +100"); } }
  if (state === "play" && boat.s >= FINISH) finish();
  if (demo && boat.s >= FINISH - 4) resetRun(true, 2);
}
function finish() {
  state = "done"; finishT = runT; audio.finish();
  const timeBonus = Math.max(0, Math.round((260 - runT) * 4)), dryBonus = Math.round((100 - boat.wet) * 3);
  score += timeBonus + dryBonus;
  const frac = got / PETALS.length, stars = frac >= 0.8 && sinks === 0 ? 3 : frac >= 0.55 ? 2 : 1;
  const nb = score > save.best; if (nb) save.best = score; if (!save.bestTime || runT < save.bestTime) save.bestTime = runT; save.stars = Math.max(save.stars, stars); persist();
  banner("Home at last");
  setTimeout(() => {
    $("r-stars").innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? "on" : ""}">✦</span>`).join("");
    $("r-list").innerHTML = [["Time", fmt(runT)], ["Petals", `${got} / ${PETALS.length}`], ["Golden petals", golds], ["Clean drops", cleanLands], ["Dryness", `${Math.round(100 - boat.wet)}%`], ["Sinkings", sinks], ["Time bonus", "+" + timeBonus], ["Dry bonus", "+" + dryBonus]].map(([a, b]) => `<div><span>${a}</span><em>${b}</em></div>`).join("");
    $("r-score").textContent = score.toLocaleString(); $("r-best").textContent = nb ? "New best score!" : `Best ${save.best.toLocaleString()}`;
    $("m-res").classList.remove("hidden"); state = "results";
  }, 2600);
}
function update(dt) {
  time += dt;
  if (state === "paused" || state === "loading") return;
  if (state === "play") runT += dt;
  acc += dt; let n = 0;
  while (acc >= DT && n < 10) { prev = snap(boat); simStep(DT); acc -= DT; n++; }
  if (n === 10) acc = 0;
  progress(dt);
  if (state === "sink") { sinkT += dt; if (sinkT > 2.4) respawn(); }
  // FX
  for (const q of fx.splash) { q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt; q.v[2] -= 6 * dt; q.life -= dt; }
  fx.splash = fx.splash.filter((q) => q.life > 0).slice(-300);
  for (const r of fx.rings) { r.r += dt * (0.25 + r.k * 0.15); r.life -= dt; }
  fx.rings = fx.rings.filter((r) => r.life > 0);
  if (!boat.air && state !== "sink") { fx.wake.push({ s: boat.s, x: boat.x, h: boat.h, age: 0, sp: Math.hypot(boat.vs - curAt(boat.s, boat.x) * W.cur, boat.vx) + 0.15 }); }
  for (const w of fx.wake) w.age += dt; fx.wake = fx.wake.filter((w) => w.age < 1.6).slice(-140);
  // foreground bokeh glints on the sun path
  if (Math.random() < 0.5 && fx.bokeh.length < 14) {
    const f = frame(cam.s + 0.55 + Math.random() * 0.5), x = cam.x + (Math.random() - 0.5) * 0.9, w = toWorld(f.s, x), vis = sunAtW(w[0], w[1]);
    if (vis > 0.4) fx.bokeh.push({ p: [w[0], w[1], f.p[2] + 0.005], life: 0.25 + Math.random() * 0.5, max: 0.6, sz: 0.012 + Math.random() * 0.03, k: vis });
  }
  for (const b of fx.bokeh) b.life -= dt; fx.bokeh = fx.bokeh.filter((b) => b.life > 0);
  updateRower(dt);
  shake = Math.max(0, shake - dt * 2); flash = Math.max(0, flash - dt * 1.5);
  audio.update(frame(boat.s).c * W.cur, boat.white, nearCascade(), boat.s > 380, state === "play" || demo);
  ui.frame();
}
function nearCascade() { let k = 0; for (const c of CASCADES) { const d = Math.abs(c.s - boat.s); k = Math.max(k, clamp(1 - d / 30, 0, 1)); } return k; }
function renderState() {
  const a = prev || snap(boat), t = acc / DT;
  return { s: lerp(a.s, boat.s, t), x: lerp(a.x, boat.x, t), h: lerp(a.h, boat.h, t), z: lerp(a.z, boat.z, t) };
}

// ------------------------------------------------------------------ camera
const cam = { s: 0, x: 0, z: 0, high: false, pip: false, mode: 0, init: false, mag: 1.55, look: [0, 0, 0] };
// C cycles: low chase (the reference shot) → high chase → Pip cam (a close three-quarter view of the rower)
function cycleCam() { cam.mode = (cam.mode + 1) % 3; cam.high = cam.mode === 1; cam.pip = cam.mode === 2; cam.init = false; }
function updateCamera(dt) {
  const r = renderState(), f = frame(r.s);
  const back = cam.high ? 3.2 : 1.25, up = cam.high ? 1.45 : 0.4;
  const ts = r.s - back, ft = frame(ts);
  const tx = clamp(r.x * 0.85 - Math.sin(r.h) * 0.25, -ft.hw + 0.25, ft.hw - 0.25);
  const tz = Math.max(r.z, wzAt(ts)) + up;
  if (!cam.init) { cam.s = ts; cam.x = tx; cam.z = tz; cam.init = true; }
  const k = 1 - Math.exp(-dt * 4.5);
  cam.s += (ts - cam.s) * (1 - Math.exp(-dt * 6)); cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 3.5));
  cam.z = Math.max(cam.z, wzAt(cam.s) + up * 0.6);
  const E = toWorld(cam.s, cam.x); E[2] = cam.z;
  const T = toWorld(r.s + (cam.high ? 4 : 3.4), r.x * 0.65 + cam.x * 0.35); T[2] = (cam.high ? r.z : Math.max(r.z, wzAt(r.s + 3.4))) + (cam.high ? -0.2 : 0.12);
  const sx = (Math.sin(time * 41) + Math.sin(time * 29)) * shake * 0.01;
  E[0] += sx; E[2] += Math.sin(time * 33) * shake * 0.006;
  space.magnifier = cam.mag * 1.6;
  if (cam.pip) {
    const ch = Math.cos(r.h), sh = Math.sin(r.h), fw = [f.t[0] * ch + f.r[0] * sh, f.t[1] * ch + f.r[1] * sh], rt = [fw[1], -fw[0]], B = toWorld(r.s, r.x), sd = r.x > 0 ? -1 : 1, lat = clamp(r.x + sd * (0.3 + Math.sin(time * 0.15) * 0.08), -f.hw + 0.15, f.hw - 0.15) - r.x;
    E[0] = B[0] + fw[0] * 0.5 + rt[0] * lat; E[1] = B[1] + fw[1] * 0.5 + rt[1] * lat; E[2] = r.z + 0.2;
    T[0] = B[0] - fw[0] * 0.06; T[1] = B[1] - fw[1] * 0.06; T[2] = r.z + 0.1;
  }
  space.lookAt(E[0], E[1], E[2], T[0], T[1], T[2]);
  space.roll(clamp(-boat.w * 0.012 + Math.sin(time * 0.7) * 0.004, -0.04, 0.04));
  void f;
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(30000), A = new Mesh(30000), dyn = new Mesh(70000);
const PAPER = [0.97, 0.95, 0.89];
// paper boat (local: x right, y forward, z up); faces carry a fold shading factor
const BOAT = (() => {
  const B = [0, 0.165, 0.075], S = [0, -0.165, 0.075], L1 = [-0.058, 0.088, 0.062], L2 = [-0.058, -0.088, 0.062], R1 = [0.058, 0.088, 0.062], R2 = [0.058, -0.088, 0.062];
  const b1 = [-0.03, 0.07, 0], b2 = [-0.03, -0.07, 0], c1 = [0.03, 0.07, 0], c2 = [0.03, -0.07, 0];
  const F = [];
  const q = (a, b, c, d, k) => { F.push([a, b, c, k], [a, c, d, k]); }, t = (a, b, c, k) => F.push([a, b, c, k]);
  q(L2, L1, b1, b2, 0.92); q(R1, R2, c2, c1, 0.98);
  t(L1, B, b1, 0.86); t(B, R1, c1, 0.9); t(b1, B, c1, 0.8);
  t(S, L2, b2, 0.86); t(R2, S, c2, 0.9); t(S, b2, c2, 0.8);
  q(b1, c1, c2, b2, 0.7);
  // inside floor (seen from above) and the folded sail
  const i1 = [-0.045, 0.08, 0.05], i2 = [-0.045, -0.08, 0.05], j1 = [0.045, 0.08, 0.05], j2 = [0.045, -0.08, 0.05];
  q(i1, j1, j2, i2, 0.78); t(i1, B.map((v, k) => (k === 2 ? 0.068 : v * 0.9)), j1, 0.8); t(j2, S.map((v, k) => (k === 2 ? 0.068 : v * 0.9)), i2, 0.8);
  const ap = [0, 0.045, 0.15], sl1 = [-0.02, 0.115, 0.058], sl2 = [-0.02, -0.025, 0.058], sr1 = [0.02, 0.115, 0.058], sr2 = [0.02, -0.025, 0.058];
  t(sl2, sl1, ap, 0.95); t(sr1, sr2, ap, 1.0); t(sl1, sr1, ap, 0.9); t(sr2, sl2, ap, 0.9);
  return F;
})();
// ------------------------------------------------------------------ Pip, the little rower (DESIGN.md §4)
// A round, chibi figure (big head, pear body, squishy knitted hat, mittens, boots) made of finely tessellated
// blobs and shaded with the SOFT material. The rigid parts are built once and posed every frame with 3×4
// matrices (boat → body → head), so a smooth Pip costs well under a millisecond.
// W (row) plays a full stroke on alternating sides; holding a turn paddles on the outside of the turn. Between
// strokes Pip blinks and breathes, and every few seconds does an idle act: peers down into the water, looks
// around, scoots along the boat, stretches, trails a mitten in the water, or turns round to wave.
const rower = { p: 0, side: 1, active: false, steer: 0, dipped: false, idle: null, nextIdle: 2.5, blinkT: 3, blink: 0, calm: 0 };
const IDLES = [["peek", 3], ["look", 2], ["scoot", 2], ["stretch", 1.5], ["trail", 2], ["wave", 1.4]];
function rowStroke(side) { rower.active = true; rower.p = 0; rower.side = side; rower.dipped = false; rower.idle = null; rower.calm = 0; }
function updateRower(dt) {
  const r = rower;
  if (r.active) { r.p += dt / 0.62; if (r.p >= 1) { r.active = false; r.p = 0; } }
  if (!r.active && !boat.air && state !== "sink" && Math.abs(r.steer) > 0.35) rowStroke(-Math.sign(r.steer));
  r.blinkT -= dt; if (r.blinkT < 0) { r.blink = 0.14; r.blinkT = 2 + Math.random() * 3.5; if (Math.random() < 0.2) r.blinkT = 0.25; }
  r.blink = Math.max(0, r.blink - dt);
  r.calm = r.active || Math.abs(r.steer) > 0.1 || boat.air ? 0 : r.calm + dt;
  if (r.idle) { r.idle.t += dt; if (r.idle.t >= r.idle.dur || r.active) r.idle = null; }
  else if (r.calm > 1.2 && state !== "sink") {
    r.nextIdle -= dt;
    if (r.nextIdle < 0) {
      let tot = 0; for (const [, w] of IDLES) tot += w; let k = Math.random() * tot, kind = IDLES[0][0];
      for (const [n, w] of IDLES) { if ((k -= w) < 0) { kind = n; break; } }
      r.idle = { kind, t: 0, dur: { peek: 3.4, look: 3, scoot: 2.2, stretch: 2.6, trail: 3.6, wave: 2.6 }[kind], sd: Math.random() < 0.5 ? -1 : 1, ripple: 0 };
      r.nextIdle = 2.5 + Math.random() * 4;
    }
  }
}
// 3×4 row-major affine matrices
const M = {
  mul: (A, B) => [A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]],
  T: (v) => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]],
  S: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
  ap: (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]],
};
const chain = (...ms) => ms.reduce((a, b) => M.mul(a, b));
// copy a cached mesh into D through matrix F (dim = wetness darkening; col overrides the vertex colour)
function emit(F, m, dim, col = null) {
  for (let i = 0; i < m.n; i++) {
    const o = i * 4, x = m.pos[o], y = m.pos[o + 1], z = m.pos[o + 2];
    D.v(F[0] * x + F[1] * y + F[2] * z + F[3], F[4] * x + F[5] * y + F[6] * z + F[7], F[8] * x + F[9] * y + F[10] * z + F[11], 1,
      (col ? col[0] : m.col[o]) * dim, (col ? col[1] : m.col[o + 1]) * dim, (col ? col[2] : m.col[o + 2]) * dim, m.col[o + 3]);
  }
}
const COAT = [0.99, 0.74, 0.16], COAT2 = [0.94, 0.62, 0.1], SKIN = [1.0, 0.83, 0.72], HAT = [0.86, 0.18, 0.2], HAT2 = [0.7, 0.1, 0.14], BOOT = [0.42, 0.25, 0.16], SCARF = [0.25, 0.62, 0.62], OAR = [0.58, 0.4, 0.23];
const S_ = MAT.SOFT;
let PIP = null;
function buildPip() {
  const body = new Mesh(4000), boots = new Mesh(2000), sphere = new Mesh(600);
  blob(body, [0, 0, 0.022], 0.024, 0.021, 0.026, COAT, S_, 16, 11, null, (i, j) => (j > 8 ? COAT2 : COAT));
  blob(body, [0, 0, 0.004], 0.026, 0.023, 0.012, COAT2, S_, 16, 8);
  for (const z of [0.016, 0.03]) blob(body, [0, 0.021, z], 0.0028, 0.0018, 0.0028, [0.96, 0.95, 0.9], S_, 8, 5);
  blob(body, [0, 0, 0.044], 0.019, 0.017, 0.0065, SCARF, S_, 16, 7);
  blob(body, [0.011, 0.012, 0.036], 0.005, 0.005, 0.012, SCARF, S_, 8, 6);
  for (const x of [-0.011, 0.011]) blob(boots, [x, 0.022, 0.006], 0.008, 0.012, 0.0075, BOOT, S_, 12, 8);
  blob(sphere, [0, 0, 0], 1, 1, 1, [1, 1, 1], S_, 10, 6);
  const head = (open) => {
    const m = new Mesh(6000);
    blob(m, [0, 0, 0.024], 0.0255, 0.0245, 0.024, SKIN, S_, 20, 14);
    blob(m, [0, -0.002, 0.034], 0.0268, 0.0262, 0.019, HAT, S_, 20, 12, (i, j) => (j > 7 ? 0.0001 : 1 + Math.sin(i * 1.2) * 0.015));
    blob(m, [0, -0.001, 0.031], 0.0275, 0.027, 0.0062, HAT2, S_, 20, 8);
    blob(m, [0, -0.006, 0.056], 0.0085, 0.0085, 0.0085, [0.99, 0.98, 0.95], S_, 12, 8);
    for (const ex of [-0.0092, 0.0092]) {
      blob(m, [ex, 0.0225, 0.022], 0.0042, 0.0022, open ? 0.0046 : 0.0008, [0.06, 0.05, 0.07], S_, 10, 7);
      if (open) blob(m, [ex + 0.0013, 0.0243, 0.0236], 0.0012, 0.0008, 0.0012, [2, 2, 2], MAT.EMIT, 6, 4);
      blob(m, [ex * 1.45, 0.02, 0.0145], 0.0045, 0.0018, 0.0028, [1.0, 0.55, 0.55], S_, 8, 5);
    }
    blob(m, [0, 0.0238, 0.0135], 0.0026, 0.0012, 0.0009, [0.5, 0.15, 0.15], S_, 8, 5);
    return m;
  };
  return { body, boots, sphere, open: head(true), closed: head(false), yawn: new Mesh(400) };
}
const TMP = new Mesh(2000);
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function drawRower(X, wet, MB) {
  if (!PIP) PIP = buildPip();
  const t = time, R = rower, id = R.idle, sinkK = state === "sink", cheer = state === "done" || state === "results";
  const env = id ? ease(Math.min(id.t / 0.5, (id.dur - id.t) / 0.5)) : 0, ik = id ? id.kind : "";
  // pose: body lean (forward / sideways), turn, scoot offset; head pitch (+ = look down) / yaw / tilt
  let leanF = Math.sin(t * 1.9) * 0.02, leanS = 0, turn = 0, sy = 0, hop = 0, pitch = Math.sin(t * 0.7) * 0.05, yaw = Math.sin(t * 0.43) * 0.15, tilt = Math.sin(t * 0.9) * 0.06, yawnK = 0;
  let handL = null, handR = null, paddleFree = false;
  if (ik === "peek") { leanF += 0.28 * env; leanS = id.sd * 0.35 * env; pitch += 0.75 * env; yaw += id.sd * 0.55 * env; tilt += id.sd * 0.2 * env; }
  if (ik === "look") { yaw += Math.sin(id.t * 2.1) * 0.9 * env; pitch -= 0.15 * env; }
  if (ik === "scoot") { const u = id.t / id.dur; sy = Math.sin(u * Math.PI * 2) * 0.016 * env; hop = Math.abs(Math.sin(u * Math.PI * 6)) * 0.004 * env; leanF += Math.sin(u * Math.PI * 6) * 0.08 * env; }
  if (ik === "stretch") { pitch -= 0.45 * env; leanF -= 0.18 * env; yawnK = env; paddleFree = true; handL = [-0.022, -0.07, 0.15 + 0.03 * env]; handR = [0.022, -0.07, 0.15 + 0.03 * env]; }
  if (ik === "trail") {
    leanS = id.sd * 0.45 * env; leanF += 0.15 * env; pitch += 0.55 * env; yaw += id.sd * 0.6 * env; paddleFree = true;
    const h = [id.sd * (0.09 * env + 0.02 * (1 - env)), -0.075, lerp(0.08, -0.004 + Math.sin(id.t * 3) * 0.006, env)];
    if (id.sd > 0) handR = h; else handL = h;
    if (env > 0.9 && (id.ripple -= 1 / 60) < 0) { id.ripple = 0.5; fx.rings.push({ s: boat.s - 0.07, x: boat.x + id.sd * 0.11, r: 0.02, life: 0.9, k: 0.5 }); }
  }
  if (ik === "wave" || cheer) { const e = cheer ? 1 : env; turn = 1.1 * e; yaw += 0.9 * e; pitch -= 0.1 * e; handR = [0.03, -0.06, 0.17 + Math.sin(t * 11) * 0.012 * e]; }
  if (sinkK) { pitch -= 0.3; handL = [-0.035, -0.07, 0.155 + Math.sin(t * 14) * 0.01]; handR = [0.035, -0.07, 0.155 + Math.cos(t * 14) * 0.01]; paddleFree = true; }
  // paddle stroke
  let sd = R.side, B, T, u = 0, pull = false;
  if (R.active) {
    const p = R.p;
    if (p < 0.55) { u = p / 0.55; B = [sd * 0.09, lerp(0.035, -0.13, u), -0.014]; pull = true; }
    else { u = (p - 0.55) / 0.45; B = [sd * (0.09 - Math.sin(u * Math.PI) * 0.02), lerp(-0.13, 0.035, u), -0.014 + Math.sin(u * Math.PI) * 0.06]; }
    T = [-sd * 0.006, -0.07 + B[1] * 0.22, 0.138 + (pull ? 0 : 0.008)];
    leanF += pull ? 0.18 * (1 - u) : 0.18 * u; yaw += sd * 0.2;
  } else { B = [0.078, -0.05, 0.066 + Math.sin(t * 1.3) * 0.002]; T = [-0.062, -0.068, 0.078]; }
  // pose matrices (boat-local), then world = MB × local
  const dim = 1 - Math.min(0.3, wet * 0.25), breath = 1 + Math.sin(t * 2.4) * 0.03;
  const hip = [0, -0.08 + sy, 0.045 + hop];
  const Lbody = chain(M.T(hip), M.Z(turn), M.X(-leanF), M.Y(leanS));
  const Lhead = chain(Lbody, M.T([0, 0.002, 0.048]), M.Z(yaw), M.X(-pitch), M.Y(tilt));
  emit(chain(MB, Lbody, M.S(1, 1, breath)), PIP.body, dim);
  emit(chain(MB, M.T([0, hip[1] - sy * 0.3 + 0.08, 0]), M.T([0, -0.08, 0.045])), PIP.boots, dim);
  emit(M.mul(MB, Lhead), R.blink > 0 ? PIP.closed : PIP.open, dim);
  if (yawnK > 0.05) emit(chain(MB, Lhead, M.T([0, 0.0235, 0.0128]), M.S(0.0026, 0.0012, 0.003 * yawnK)), PIP.sphere, dim, [0.45, 0.12, 0.12]);
  // arms: soft capsules from the shoulders to mitten hands (on the paddle, or free)
  const shL = M.ap(Lbody, [-0.021, 0.002, 0.036]), shR = M.ap(Lbody, [0.021, 0.002, 0.036]);
  const Lg = T.map((v, i) => v + (B[i] - v) * 0.38);
  let hL = T, hR = Lg;
  if (R.active && sd < 0) { hL = Lg; hR = T; }
  if (handL) hL = handL; if (handR) hR = handR;
  TMP.reset();
  const ball = (c, r, col) => emit(chain(MB, M.T(c), M.S(r, r, r)), PIP.sphere, dim, col);
  for (const [sh, hd] of [[shL, hL], [shR, hR]]) {
    const el = [(sh[0] + hd[0]) / 2 + Math.sign(sh[0]) * 0.006, (sh[1] + hd[1]) / 2, (sh[2] + hd[2]) / 2 - 0.006];
    limb(TMP, sh, el, 0.0075, 0.0068, COAT, S_, 10); limb(TMP, el, hd, 0.0068, 0.006, COAT, S_, 10);
    ball(sh, 0.0078, COAT); ball(el, 0.0068, COAT); ball(hd, 0.0068, HAT2);
  }
  // paddle (lies in the boat while Pip's hands are busy elsewhere)
  if (!sinkK) {
    if (paddleFree) { B = [0.075, -0.02, 0.055]; T = [-0.05, -0.12, 0.06]; }
    const dir = B.map((v, i) => v - T[i]), len = Math.hypot(...dir), dn = dir.map((v) => v / len);
    const top = T.map((v, i) => v - dn[i] * 0.012), sideV = norm(xcross(dn, [0, 1, 0])), bw = 0.012, b0 = B.map((v, i) => v - dn[i] * 0.04);
    limb(TMP, top, B, 0.0028, 0.0028, OAR, MAT.WOOD, 6);
    const P = (a, k) => [a[0] + sideV[0] * k, a[1] + sideV[1] * k, a[2] + sideV[2] * k];
    TMP.quad(P(b0, -bw * 0.6), P(b0, bw * 0.6), P(B, bw), P(B, -bw), [0.66, 0.46, 0.27], MAT.WOOD);
    ball(top, 0.004, OAR);
    const bp = X(B);
    if (R.active && pull && !R.dipped) { R.dipped = true; for (let i = 0; i < 8; i++) fx.splash.push({ p: [bp[0], bp[1], bp[2] + 0.02], v: [(Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.5], life: 0.4 }); fx.rings.push({ s: boat.s - 0.05, x: boat.x + sd * 0.1, r: 0.03, life: 0.8, k: 0.6 }); }
    if (R.active && pull && Math.random() < 0.3) fx.splash.push({ p: [bp[0], bp[1], bp[2] + 0.01], v: [(Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0.2], life: 0.3 });
  }
  emit(MB, TMP, dim);
}
function drawBoat(r) {
  const f = frame(r.s), ch = Math.cos(r.h), sh = Math.sin(r.h);
  const fwd = [f.t[0] * ch + f.r[0] * sh, f.t[1] * ch + f.r[1] * sh, 0], rgt = [f.r[0] * ch - f.t[0] * sh, f.r[1] * ch - f.t[1] * sh, 0];
  const wet = boat.wet / 100, sinkK = state === "sink" ? clamp(sinkT / 2, 0, 1) : 0;
  const roll = -boat.w * 0.07 + Math.sin(time * 2.3) * 0.035 * (1 + boat.white * 2) + Math.max(0, wet - 0.6) * 0.3 + sinkK * 0.7;
  const pitch = Math.sin(time * 1.7) * 0.03 + (boat.air && !boat.hopAir ? clamp(-boat.vz * 0.2, -0.45, 0.2) : 0) - boat.landT * 0.25;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const R = [rgt[0] * cr, rgt[1] * cr, sr], Uu0 = [-rgt[0] * sr, -rgt[1] * sr, cr];
  const Fw = [fwd[0] * cp + Uu0[0] * sp, fwd[1] * cp + Uu0[1] * sp, fwd[2] * cp + Uu0[2] * sp], Uu = [Uu0[0] * cp - fwd[0] * sp, Uu0[1] * cp - fwd[1] * sp, Uu0[2] * cp - fwd[2] * sp];
  const O = toWorld(r.s, r.x); O[2] = r.z - 0.012 - wet * 0.022 - sinkK * 0.16 + Math.sin(time * 2.1) * 0.003;
  const X = (q) => { const p = [q[0] * 1.2, q[1] * 1.2, q[2] * 1.2]; return [O[0] + R[0] * p[0] + Fw[0] * p[1] + Uu[0] * p[2], O[1] + R[1] * p[0] + Fw[1] * p[1] + Uu[1] * p[2], O[2] + R[2] * p[0] + Fw[2] * p[1] + Uu[2] * p[2]]; };
  const col = mixc(PAPER, [0.6, 0.64, 0.66], Math.min(1, wet * 0.9 + sinkK * 0.4));
  for (const [a, b, c, k] of BOAT) D.tri(X(a), X(b), X(c), [col[0] * k, col[1] * k, col[2] * k], MAT.PAPER);
  // little ripple ring around the hull
  drawRower(X, wet, [R[0] * 1.2, Fw[0] * 1.2, Uu[0] * 1.2, O[0], R[1] * 1.2, Fw[1] * 1.2, Uu[1] * 1.2, O[1], R[2] * 1.2, Fw[2] * 1.2, Uu[2] * 1.2, O[2]]);
  if (!boat.air) ring(A, r.s, r.x, 0.2 + Math.sin(time * 3) * 0.01, 0.03, 0.018);
}
function ring(M, s, x, rad, w, k) {
  const z = wzAt(s) + 0.004, c = toWorld(s, x), N = 20;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, p = (a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z];
    M.quad(p(a0, rad - w), p(a1, rad - w), p(a1, rad + w), p(a0, rad + w), [k, k * 0.92, k * 0.8], MAT.ADD);
  }
}
const PCOL = [[0.98, 0.6, 0.72], [0.98, 0.96, 0.93], [1.0, 0.8, 0.28]];
function drawPetal(p) {
  const f = frame(p.s), w = toWorld(p.s, p.x), z = f.p[2] + 0.008 + Math.sin(time * 2 + p.ph) * 0.003, a = p.ph + time * 0.25, c = PCOL[p.kind];
  const L = p.kind === 2 ? 0.05 : 0.04, ca = Math.cos(a), sa = Math.sin(a);
  for (let k = 0; k < (p.kind === 1 ? 5 : 1); k++) {
    const b = a + (k / 5) * TAU, cb = Math.cos(b), sb = Math.sin(b), l = p.kind === 1 ? 0.028 : L;
    const tip = [w[0] + cb * l, w[1] + sb * l, z + 0.008], s1 = [w[0] + cb * l * 0.45 - sb * l * 0.32, w[1] + sb * l * 0.45 + cb * l * 0.32, z + 0.012], s2 = [w[0] + cb * l * 0.45 + sb * l * 0.32, w[1] + sb * l * 0.45 - cb * l * 0.32, z + 0.012], o = [w[0] - cb * l * 0.15, w[1] - sb * l * 0.15, z];
    D.tri(o, s1, tip, c, MAT.PAPER); D.tri(o, tip, s2, c.map((v) => v * 0.9), MAT.PAPER);
  }
  void ca; void sa;
  const tw = p.kind === 2 ? 0.5 + 0.5 * Math.sin(time * 6 + p.ph) : 0.6;
  A.sprite(w[0], w[1], z + 0.02, p.kind === 2 ? 0.09 : 0.06, c[0] * 0.08 * tw, c[1] * 0.07 * tw, c[2] * 0.06 * tw);
}
function drawTwig(t) {
  const f = frame(t.s), ca = Math.cos(t.rot), sa = Math.sin(t.rot), L = t.len / 2, z = f.p[2] + 0.012 + Math.sin(time * 2 + t.bob) * 0.004;
  const a = toWorld(t.s - ca * L, t.x - sa * L), b = toWorld(t.s + ca * L, t.x + sa * L); a[2] = z; b[2] = z + 0.01;
  limb(D, a, b, 0.018, 0.012, t.hard ? [0.24, 0.17, 0.11] : [0.36, 0.27, 0.17], MAT.BARK, 5);
  const m = [lerp(a[0], b[0], 0.3), lerp(a[1], b[1], 0.3), z + 0.01], br = [m[0] + (b[1] - a[1]) * 0.25, m[1] - (b[0] - a[0]) * 0.25, z + 0.015];
  limb(D, m, br, 0.01, 0.005, [0.3, 0.22, 0.14], MAT.BARK, 4);
  const lc = t.hard ? [0.5, 0.35, 0.08] : [0.3, 0.42, 0.1];
  D.tri(br, [br[0] + 0.04, br[1] + 0.02, br[2]], [br[0] + 0.02, br[1] + 0.05, br[2] + 0.005], lc, MAT.LEAF);
}
function drawWake() {
  // two fading lines spreading behind the boat
  for (const sd of [-1, 1]) {
    let last = null;
    for (let i = fx.wake.length - 1; i >= 0; i -= 2) {
      const w = fx.wake[i], spread = 0.07 + w.age * (0.12 + w.sp * 0.15), k = Math.max(0, 1 - w.age / 1.6) ** 2 * 0.03 * clamp(w.sp, 0.2, 1.2);
      const p = toWorld(w.s - 0.12, w.x + sd * spread); p[2] = wzAt(w.s) + 0.004;
      if (last) { const dx = p[0] - last.p[0], dy = p[1] - last.p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * 0.012, ny = dx / l * 0.012; A.quad4([last.p[0] - nx, last.p[1] - ny, last.p[2]], [last.p[0] + nx, last.p[1] + ny, last.p[2]], [p[0] + nx, p[1] + ny, p[2]], [p[0] - nx, p[1] - ny, p[2]], [last.k, last.k * 0.95, last.k * 0.85], [last.k, last.k * 0.95, last.k * 0.85], [k, k * 0.95, k * 0.85], [k, k * 0.95, k * 0.85], MAT.ADD); }
      last = { p, k };
    }
  }
}
// ambient life
const motes = Array.from({ length: 90 }, (_, i) => ({ o: [Math.random() * 14 - 7, Math.random() * 18 - 2, Math.random() * 3], ph: i * 2.1 }));
const flies = Array.from({ length: 50 }, (_, i) => ({ s: 392 + Math.random() * 72, x: (Math.random() - 0.5) * 9, z: 0.3 + Math.random() * 1.5, ph: i * 1.7 }));
const dragon = Array.from({ length: 3 }, (_, i) => ({ ph: i * 2.4, s: 0, x: 0, z: 0 }));
const leaves = [];
function drawAmbient(r) {
  const camE = [space.Xc, space.Yc, space.Zc], fw = nrm(sub([space.X0, space.Y0, space.Z0], camE));
  // dust motes: glitter only inside sunbeams
  for (const m of motes) {
    const f = frame(cam.s), ox = ((m.o[0] + Math.sin(time * 0.1 + m.ph) * 0.8) % 14 + 14) % 14 - 7, oy = ((m.o[1] + time * 0.15) % 18 + 18) % 18 - 2;
    const p = [camE[0] + f.r[0] * ox + f.t[0] * oy, camE[1] + f.r[1] * ox + f.t[1] * oy, wzAt(cam.s + oy) + 0.1 + m.o[2] + Math.sin(time * 0.3 + m.ph) * 0.2];
    const v = sunAtW(p[0] - SUN[0] / SUN[2] * (p[2] - wzAt(cam.s)), p[1] - SUN[1] / SUN[2] * (p[2] - wzAt(cam.s)));
    const k = Math.max(0, v - 0.45) * 0.5 * (0.6 + 0.4 * Math.sin(time * 3 + m.ph)) * Math.max(0, dot(fw, SUN)) ;
    if (k > 0.01) A.sprite(p[0], p[1], p[2], 0.012 + (m.ph % 1) * 0.01, k, k * 0.8, k * 0.5);
  }
  // fireflies over the pool
  if (r.s > 360) for (const q of flies) { const p = toWorld(q.s + Math.sin(time * 0.3 + q.ph) * 1.2, q.x + Math.cos(time * 0.25 + q.ph) * 0.8); p[2] = wzAt(q.s) + q.z + Math.sin(time * 0.7 + q.ph) * 0.2; const k = Math.max(0, Math.sin(time * 1.6 + q.ph * 3)) ** 3 * 0.5; if (k > 0.01) { A.sprite(...p, 0.05, k * 0.8, k, k * 0.2); A.sprite(...p, 0.012, k * 2, k * 2, k); } }
  // dragonflies darting ahead of the boat
  for (const d of dragon) {
    const t = time * 0.6 + d.ph, hop = Math.floor(t), fr = t - hop, ease = smooth(0, 0.25, fr);
    const P = (h) => ({ s: r.s + 2.5 + ((h * 1.7 + d.ph) % 3), x: Math.sin(h * 2.3 + d.ph) * 0.9, z: 0.18 + ((h * 0.37 + d.ph) % 0.35) });
    const a = P(hop), b = P(hop + 1), s = lerp(a.s, b.s, ease), x = lerp(a.x, b.x, ease), z = lerp(a.z, b.z, ease) + Math.sin(time * 9 + d.ph) * 0.01;
    const f = frame(s), c = toWorld(s, x); c[2] = wzAt(s) + z;
    const head = [c[0] + f.t[0] * 0.035, c[1] + f.t[1] * 0.035, c[2]], tail = [c[0] - f.t[0] * 0.05, c[1] - f.t[1] * 0.05, c[2] + 0.005];
    limb(D, tail, head, 0.003, 0.005, [0.1, 0.35, 0.45], MAT.MATTE, 4);
    const fl = Math.sin(time * 60 + d.ph) * 0.4;
    for (const sd of [-1, 1]) for (const off of [0.01, -0.006]) { const o = [c[0] + f.t[0] * off, c[1] + f.t[1] * off, c[2] + 0.004], tip = [o[0] + f.r[0] * sd * 0.045, o[1] + f.r[1] * sd * 0.045, o[2] + fl * 0.02]; A.quad(o, [o[0] + f.t[0] * 0.008, o[1] + f.t[1] * 0.008, o[2]], [tip[0] + f.t[0] * 0.006, tip[1] + f.t[1] * 0.006, tip[2]], tip, [0.05, 0.06, 0.06], MAT.ADD); }
  }
  // drifting leaves
  while (leaves.length < 14) { const s = r.s + 2 + Math.random() * 24, f = frame(s); leaves.push({ s, x: (Math.random() - 0.5) * f.hw * 1.6, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.4, col: mixc([0.75, 0.42, 0.1], [0.85, 0.7, 0.2], Math.random()) }); }
  for (let i = leaves.length - 1; i >= 0; i--) {
    const l = leaves[i]; l.s += curAt(l.s, l.x) * W.cur * 0.55 * (1 / 60); l.rot += l.vr / 60;
    if (l.s < r.s - 3 || l.s > r.s + 34) { leaves.splice(i, 1); continue; }
    const w = toWorld(l.s, l.x), z = wzAt(l.s) + 0.006, ca = Math.cos(l.rot) * 0.035, sa = Math.sin(l.rot) * 0.035;
    D.quad([w[0] - ca, w[1] - sa, z], [w[0] - sa * 0.5, w[1] + ca * 0.5, z + 0.004], [w[0] + ca, w[1] + sa, z], [w[0] + sa * 0.5, w[1] - ca * 0.5, z + 0.004], l.col, MAT.LEAF);
  }
  // chimney smoke
  for (const c of CHIMNEYS) { const d = Math.hypot(c[0] - camE[0], c[1] - camE[1]); if (d > 140) continue; for (let i = 0; i < 8; i++) { const t = ((time * 0.12 + i / 8) % 1), k = (1 - t) * t * 0.12; A.sprite(c[0] + t * 2.5 + Math.sin(time + i) * 0.3, c[1] + t * 0.8, c[2] + t * 5, 0.5 + t * 1.8, k * 0.9, k * 0.75, k * 0.6); } }
}
function drawWheel() {
  const f = frame(MILL.s), axle = toWorld(MILL.s, MILL.side * (f.hw + 0.32)); axle[2] = f.p[2] + 1.0;
  if (Math.hypot(axle[0] - space.Xc, axle[1] - space.Yc) > 160) return;
  const a = -time * 0.9 * MILL.side, ca = Math.cos(a), sa = Math.sin(a), ex = [f.r[0], f.r[1], 0], ey = [f.t[0], f.t[1], 0];
  const m = WHEEL;
  for (let i = 0; i < m.n; i++) {
    const o = i * 4, x = m.pos[o], y = m.pos[o + 1], z = m.pos[o + 2], yy = y * ca - z * sa, zz = y * sa + z * ca;
    D.v(axle[0] + ex[0] * x + ey[0] * yy, axle[1] + ex[1] * x + ey[1] * yy, axle[2] + zz, 1, m.col[o], m.col[o + 1], m.col[o + 2], m.col[o + 3]);
  }
  for (let i = 0; i < 6; i++) { const t = (time * 1.3 + i / 6) % 1, p = [axle[0] - ey[0] * 1.2 * MILL.side, axle[1] - ey[1] * 1.2 * MILL.side, axle[2] + 1.0 - t * 1.6]; A.sprite(...p, 0.12, 0.08 * (1 - t), 0.08 * (1 - t), 0.07 * (1 - t)); }
}
function buildDynamic() {
  D.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const r = renderState();
  drawBoat(r);
  for (const p of petals) if (!p.got && p.s > r.s - 3 && p.s < r.s + 70) drawPetal(p);
  for (const t of twigs) if (t.s < r.s + 70) drawTwig(t);
  drawWake();
  for (const q of fx.rings) ring(A, q.s, q.x, q.r, 0.012, q.life * 0.08 * q.k);
  for (const q of fx.splash) { const k = Math.min(1, q.life * 2) * (q.glow !== undefined ? 0.35 : 0.22), c = q.glow !== undefined ? PCOL[q.glow] : [1, 0.95, 0.85]; A.sprite(...q.p, q.glow !== undefined ? 0.02 : 0.012, c[0] * k, c[1] * k, c[2] * k); }
  for (const b of fx.bokeh) { const t = b.life / b.max, k = Math.sin(Math.min(1, t) * Math.PI) * 0.22 * b.k; b.p && A.sprite(b.p[0], b.p[1], b.p[2], b.sz, k, k * 0.78, k * 0.45, MAT.BOKEH); }
  drawAmbient(r); drawWheel();
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: dyn.n - oA };
}
const lightBuf = new Float32Array(24), lightColBuf = new Float32Array(18);
function collectLights() {
  const E = [space.Xc, space.Yc, space.Zc], L = [];
  for (const q of LANTERNS) L.push({ p: q, c: [1, 0.55, 0.22], k: 0.9, d: Math.hypot(q[0] - E[0], q[1] - E[1], q[2] - E[2]) });
  for (const q of WINDOWS) L.push({ p: q, c: [1, 0.6, 0.3], k: 2.5, d: Math.hypot(q[0] - E[0], q[1] - E[1], q[2] - E[2]) + 4 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(6, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights(), r = renderState();
  post.begin();
  gl.useProgram(U.program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadeTex); gl.uniform1i(U.uShade, 0);
  gl.uniform4f(U.uShadeRect, shadeMap.x0, shadeMap.y0, 1 / (shadeMap.W * RES), 1 / (shadeMap.H * RES));
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform3fv(U.uSun, SUN);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  const E = [space.Xc, space.Yc, space.Zc], B = toWorld(r.s, r.x); B[2] = r.z;
  const focus = Math.max(0.4, Math.hypot(B[0] - E[0], B[1] - E[1], B[2] - E[2]));
  gl.uniform3f(U.uDof, focus, cam.high ? 0.25 : 0.4, cam.high ? 0.5 : 0.95);
  gl.uniform1f(U.uFlow, frame(r.s).c * W.cur);
  space.applyCamera();
  const c0 = chunkOf(cam.s - 10), c1 = chunkOf(cam.s + 200), cg = chunkOf(cam.s + 70);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  for (let i = c0; i <= c1; i++) { const c = chunks[i]; if (!c) continue; space.bindBuf(c.pb, c.cb); space.draw(...c.O); if (i <= cg) space.draw(...c.G); space.draw(...c.W); }
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
  for (let i = c0; i <= c1; i++) { const c = chunks[i]; if (!c) continue; space.bindBuf(c.pb, c.cb); space.draw(...c.A); }
  space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  // sun position on screen for the god rays
  const xp = -dot(SUN, space.xUnitVec), yp = dot(SUN, space.yUnitVec), zp = dot(SUN, space.zUnitVec), k = space.magnifier / 1.6, asp = canvas.width / canvas.height;
  let sunUV = [0.5, 1.5], sunK = 0;
  if (zp > 0.05) { sunUV = [(xp * k / zp) * 0.5 + 0.5, (yp * k * asp / zp) * 0.5 + 0.5]; const off = Math.max(Math.abs(sunUV[0] - 0.5), Math.abs(sunUV[1] - 0.5)); sunK = 0.6 * clamp((1.1 - off) / 0.5, 0, 1); }
  post.end({ time, fade: fadeK, flash, sunUV, sunK, maxR: canvas.height * 0.014, skyCoc: cam.high ? 0.25 : 0.4 });
}
let fadeK = 0;

// ------------------------------------------------------------------ UI
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
let banT = 0;
function banner(t) { $("banner").textContent = t; $("banner").classList.add("show"); clearTimeout(banT); banT = setTimeout(() => $("banner").classList.remove("show"), 2200); }
const PROG = $("prog-i"), PB = $("prog-b");
{ const el = $("prog"); for (const cp of CHECKPOINTS.slice(1)) { const d = document.createElement("i"); d.className = "cp"; d.style.left = (cp / FINISH) * 100 + "%"; el.appendChild(d); } }
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  frame() {
    if (demo || state === "title") return;
    $("h-sec").textContent = SECTIONS[secIdx].name;
    $("h-score").textContent = score.toLocaleString();
    $("h-pet").textContent = `${got}`; $("h-combo").textContent = combo > 1 ? `×${combo}` : ""; $("h-combo").classList.toggle("on", combo > 1);
    $("h-time").textContent = fmt(runT);
    const dry = 100 - boat.wet; $("dry-i").style.height = dry + "%"; $("dry-v").textContent = Math.round(dry) + "%"; $("dry").classList.toggle("low", dry < 30); $("dry").classList.toggle("sun", boat.inSun > 0.55 && boat.wet > 0.5);
    $("breath-i").style.width = boat.breath * 100 + "%"; $("hop").classList.toggle("ready", boat.hopCd <= 0);
    const t = clamp(boat.s / FINISH, 0, 1); PROG.style.width = t * 100 + "%"; PB.style.left = t * 100 + "%";
  },
  title() {
    $("t-best").textContent = save.best ? `Best ${save.best.toLocaleString()} · ${"✦".repeat(save.stars)}${"·".repeat(3 - save.stars)} · ${fmt(save.bestTime)}` : "";
    $("t-diff").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === save.diff));
  },
};
function start() { audio.init(); resetRun(false, Q.has("s") ? +Q.get("s") : 2); state = "play"; ui.show("hud"); banner(SECTIONS[secIdx].name); }
function pause() { state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); state = "play"; }
function toTitle() { for (const m of ["m-pause", "m-res", "m-set"]) $(m).classList.add("hidden"); $("sunk").classList.remove("show"); resetRun(true, 2); state = "title"; ui.show("title"); ui.title(); }
$("b-play").onclick = start;
$("t-diff").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.diff = +b.dataset.v; persist(); ui.title(); });
$("b-pause").onclick = pause; $("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); start(); }; $("p-title").onclick = toTitle;
$("r-again").onclick = () => { $("m-res").classList.add("hidden"); start(); }; $("r-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("b-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("b-cam").onclick = cycleCam;

window.__brook = () => ({ state, s: +boat.s.toFixed(1), x: +boat.x.toFixed(2), h: +boat.h.toFixed(2), wet: +boat.wet.toFixed(1), score, got, sinks, t: +runT.toFixed(1), fps, verts: totalVerts });
let last = performance.now(), fps = 0, fN = 0, fT = 0, slow = 0;
// adaptive resolution: drop the pixel budget when the frame rate sags for a few seconds (and recover slowly)
function adapt() {
  if (state === "loading" || document.hidden) return;
  if (fps < 48 && pxCap > 0.6e6) { if (++slow >= 3) { pxCap *= 0.75; slow = 0; sizeCanvas(); } }
  else if (fps > 58 && pxCap < 2.1e6) { if (--slow <= -8) { pxCap = Math.min(2.1e6, pxCap * 1.15); slow = 0; sizeCanvas(); } }
  else slow = 0;
}
function frameLoop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; adapt(); }
  if (state === "loading") {
    if (worldReady()) { state = "title"; $("loading").classList.add("out"); ui.show("title"); ui.title(); if (bot || Q.has("play")) start(); }
    else { requestAnimationFrame(frameLoop); return; }
  }
  fadeK = Math.min(1, fadeK + dt * 0.8);
  update(dt); render(dt);
  requestAnimationFrame(frameLoop);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
resetRun(true, Q.has("s") ? +Q.get("s") : 2);
if (Q.has("cam")) for (let i = 0; i < +Q.get("cam"); i++) cycleCam();
requestAnimationFrame(frameLoop);
