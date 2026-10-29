// SUNRISE DRIFT — a hot-air balloon over a valley of fairy chimneys at sunrise. Rendered with the projection3d
// library (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. balloon.js flies the balloon and builds
// its model, terrain.js the valley, levels.js the flights, autopilot.js the ?auto pilot and marker ballistics.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, tube, limb, mulberry32 } from "./mesh.js";
import { FLIGHTS, TOD } from "./levels.js";
import { buildWorld, groundH, CHIMNEYS, LIGHTS, VILLAGE, shadowQ, SIZE, riverX } from "./terrain.js";
import { makeBalloon, stepBalloon, windAt, layerIndex, buildBalloonModel, putBalloon, PATTERNS, PHYS, ENV } from "./balloon.js";
import { autopilot, makeMarker, stepMarker, predictMarker } from "./autopilot.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

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
const DEF = { best: {}, stars: {}, unlocked: 0, volume: 0.8, music: 0.6, motes: true };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("sunrisedrift.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("sunrisedrift.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const stat = new Mesh(900000), seg = {};
{
  const O = new Mesh(700000), A = new Mesh(4000), Sh = new Mesh(30000), W = new Mesh(8000);
  buildWorld(O, A, Sh, W);
  for (const [k, m] of [["O", O], ["W", W], ["Sh", Sh], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ balloons
const models = PATTERNS.map((p) => buildBalloonModel(p, 0));
let playerModel = buildBalloonModel(PATTERNS[0], 1);
const rnd = mulberry32(99);
const fest = [];
function spawnFest(f, initial) {
  const L = G.F ? G.F.layers : FLIGHTS[1].layers;
  f.pattern = Math.floor(rnd() * models.length);
  if (initial) { f.x = (rnd() * 2 - 1) * 1000; f.y = (rnd() * 2 - 1) * 1000; f.z = groundH(f.x, f.y) + 40 + rnd() * 380; }
  else {
    // relaunch upwind of the play area, on the ground
    const [wx, wy] = windAt(L, 60, 0), s = Math.hypot(wx, wy) || 1, a = rnd() * TAU, r = 300 + rnd() * 500;
    f.x = clamp(-wx / s * 700 + Math.cos(a) * r * 0.5, -1100, 1100); f.y = clamp(-wy / s * 700 + Math.sin(a) * r * 0.5, -1100, 1100); f.z = groundH(f.x, f.y);
  }
  f.zt = groundH(f.x, f.y) + 40 + rnd() * 420; f.vz = 0; f.rot = rnd() * TAU; f.burn = 0; f.burnT = rnd() * 6;
}
function updateFest(dt, layers) {
  for (const f of fest) {
    const vzT = clamp((f.zt - f.z) * 0.03, -1.6, 1.8);
    f.vz += (vzT - f.vz) * dt * 0.4; f.z += f.vz * dt;
    const g = groundH(f.x, f.y); if (f.z < g) { f.z = g; f.vz = 0; }
    const [wx, wy] = windAt(layers, f.z, G.t); f.x += wx * dt; f.y += wy * dt; f.rot += dt * 0.03;
    f.burnT -= dt; if (f.burnT < 0) { f.burn = 1.2 + rnd() * 1.5; f.burnT = 4 + rnd() * 9 - (vzT > 0.5 ? 3 : 0); if (rnd() < 0.15 && Math.hypot(f.x - cam.E[0], f.y - cam.E[1]) < 500) audio.farBurner(0.04); }
    f.burn = Math.max(0, f.burn - dt);
    if (rnd() < dt * 0.02) f.zt = groundH(f.x, f.y) + 40 + rnd() * 420;
    if (Math.abs(f.x) > 1350 || Math.abs(f.y) > 1350) spawnFest(f, false);
  }
}

// ------------------------------------------------------------------ flight state
const G = { state: "loading", fi: 0, F: null, b: null, t: 0, markers: [], landedMarks: [], scores: [], used: [], penalty: 0, bumpT: 0, lifted: false, restT: 0, landQ: null, pal: TOD.sunrise, mist: 0.8, auto: null, endT: 0, lastTouch: null, lanterns: [] };
let time = 0;
const MARKERS_PER = 3;
for (let i = 0; i < 26; i++) { const f = {}; spawnFest(f, true); fest.push(f); }

function startFlight(i) {
  G.fi = i; const F = (G.F = FLIGHTS[i]);
  G.b = makeBalloon(F.start[0], F.start[1], groundH(F.start[0], F.start[1])); G.b.fuel = F.fuel;
  Object.assign(G, { t: 0, markers: [], landedMarks: [], scores: F.targets.map(() => null), used: F.targets.map(() => 0), penalty: 0, bumpT: 0, lifted: false, restT: 0, landQ: null, endT: 0, lastTouch: null, lanterns: [] });
  G.pal = TOD[F.tod]; G.mist = F.mist;
  playerModel = buildBalloonModel(PATTERNS[F.pattern], 1);
  for (const f of fest) spawnFest(f, true);
  G.state = "brief"; ui.show("brief");
  $("b-num").textContent = `FLIGHT ${i + 1}`; $("b-name").textContent = F.name; $("b-tip").textContent = F.tip;
  $("b-tasks").textContent = `${F.targets.length} target${F.targets.length > 1 ? "s" : ""} · land in the field · ${F.fuel}% propane`;
  cam.yaw = Math.atan2(F.targets[0][0] - F.start[0], F.targets[0][1] - F.start[1]) + Math.PI; cam.pitch = 0.25; cam.dist = 55;
  audio.birds = F.tod === "dusk" ? 0.2 : 1;
  if (bot) setTimeout(go, 600);
}
function go() { if (G.state !== "brief") return; G.state = "fly"; ui.show("hud"); ui.tasks(); toast("Hold BURN (Space) to take off"); }
const maxScore = (F) => F.targets.length * 100 + 60 + 50;
function finish() {
  G.state = "done";
  const F = G.F, tgt = G.scores.reduce((a, s) => a + (s || 0), 0), land = G.landQ ? G.landQ.pts : 0, fuel = Math.round(G.b.fuel * 0.5);
  const total = Math.max(0, tgt + land + fuel - G.penalty), mx = maxScore(F);
  const stars = [0.42, 0.62, 0.8].filter((k) => total >= k * mx).length;
  const isBest = !save.best[G.fi] || total > save.best[G.fi];
  save.best[G.fi] = Math.max(save.best[G.fi] || 0, total); save.stars[G.fi] = Math.max(save.stars[G.fi] || 0, stars);
  if (stars > 0) save.unlocked = Math.max(save.unlocked, Math.min(FLIGHTS.length - 1, G.fi + 1)); persist();
  $("d-k").textContent = stars ? "Flight complete" : "Flight over"; $("d-t").textContent = F.name;
  $("d-rows").innerHTML = G.scores.map((s, i) => `<div><span>Target ${i + 1}</span><b>${s === null ? "—" : s}</b></div>`).join("") +
    `<div><span>Landing · ${G.landQ ? G.landQ.label : "outside the field"}</span><b>${land}</b></div><div><span>Propane left</span><b>${fuel}</b></div>` + (G.penalty ? `<div><span>Bumps</span><b>−${G.penalty}</b></div>` : "");
  $("d-score").textContent = total + (isBest && total > 0 ? "  · new best" : "");
  $("d-next").classList.toggle("hidden", G.fi >= FLIGHTS.length - 1 || stars === 0);
  for (let i = 0; i < 3; i++) $("s" + i).classList.remove("on");
  $("m-done").classList.remove("hidden"); audio.fanfare();
  for (let i = 0; i < stars; i++) setTimeout(() => { $("s" + i).classList.add("on"); audio.star(i); }, 500 + i * 400);
}
// the target the next marker is meant for: the nearest one not yet scored
function activeTarget() {
  const F = G.F, b = G.b; let best = -1, bd = 1e9;
  F.targets.forEach(([x, y], i) => { if (G.scores[i] !== null) return; const d = Math.hypot(x - b.x, y - b.y); if (d < bd) { bd = d; best = i; } });
  return best;
}
function dropMarker() {
  if (G.state !== "fly" || G.b.ground) return;
  const ti = activeTarget(); if (ti < 0) return toast("All targets done — land in the field");
  if (G.used[ti] >= MARKERS_PER) return;
  G.used[ti]++; const m = makeMarker(G.b); m.ti = ti; m.col = [[1, 0.25, 0.2], [0.2, 0.6, 1], [1, 0.8, 0.2]][G.used[ti] - 1]; G.markers.push(m);
  audio.whoosh(); ui.tasks();
}
function markerLanded(m) {
  const [tx, ty] = G.F.targets[m.ti], d = Math.hypot(m.x - tx, m.y - ty), pts = Math.max(0, Math.round(100 * (1 - d / 60)));
  G.landedMarks.push(m); audio.thud();
  if (pts > 0) { G.scores[m.ti] = Math.max(G.scores[m.ti] || 0, pts); pop(pts >= 90 ? "Bullseye!" : pts >= 60 ? "Great drop" : "On the cloth", `${d.toFixed(1)} m · +${pts}`); audio.chime(pts); }
  else { pop("Missed", `${d.toFixed(0)} m from the X`); if (G.used[m.ti] >= MARKERS_PER && G.scores[m.ti] === null) G.scores[m.ti] = 0; }
  ui.tasks();
}
function nextGoal() {
  const ti = activeTarget();
  if (ti >= 0) return { x: G.F.targets[ti][0], y: G.F.targets[ti][1], kind: "target", i: ti };
  return { x: G.F.land[0], y: G.F.land[1], r: G.F.land[2], kind: "land" };
}

// ------------------------------------------------------------------ input
const input = { keys: new Set(), burn: false, vent: false, drag: null, pinch: null };
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if (e.code === "Space") { e.preventDefault(); if (G.state === "brief") go(); }
  if (e.code === "KeyM" && !e.repeat) dropMarker();
  if (e.code === "KeyC" && !e.repeat) cam.basket = !cam.basket;
  if (e.code === "Escape" || e.code === "KeyP") { if (G.state === "fly") pause(); else if (G.state === "paused") resume(); }
});
addEventListener("keyup", (e) => input.keys.delete(e.code));
const ptrs = new Map();
canvas.addEventListener("pointerdown", (e) => { audio.init(); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
    p.x = e.clientX; p.y = e.clientY; const [c, d] = [...ptrs.values()], d1 = Math.hypot(c.x - d.x, c.y - d.y);
    cam.dist = clamp(cam.dist * (d0 / Math.max(1, d1)), 22, 260); return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  cam.yaw -= dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, cam.basket ? -0.9 : -0.25, 1.3);
});
const endPtr = (e) => ptrs.delete(e.pointerId);
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 22, 260); e.preventDefault(); }, { passive: false });
const hold = (id, key) => { const el = $(id); el.addEventListener("pointerdown", (e) => { audio.init(); input[key] = true; el.classList.add("on"); e.preventDefault(); }); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, () => { input[key] = false; el.classList.remove("on"); }); };
hold("c-burn", "burn"); hold("c-vent", "vent");
$("c-drop").onclick = () => dropMarker(); $("c-cam").onclick = () => (cam.basket = !cam.basket);

// ------------------------------------------------------------------ update
const motes = [];
for (let i = 0; i < 520; i++) motes.push({ x: (Math.random() - 0.5) * 500, y: (Math.random() - 0.5) * 500, z: Math.random() * 600, ph: Math.random() * TAU });
const MOTE_COL = [[0.3, 0.9, 0.85], [1.0, 0.8, 0.35], [1.0, 0.45, 0.55], [0.7, 0.55, 1.0], [0.9, 0.95, 1.0]];
function update(dt) {
  time += dt;
  const F = G.F || FLIGHTS[1], layers = F.layers;
  if (G.state === "fly") {
    G.t += dt;
    const b = G.b, k = input.keys;
    let burn = input.burn || k.has("Space"), vent = input.vent || k.has("KeyV");
    if (bot) {
      const goal = nextGoal(), c = autopilot(b, goal, layers, G.t, groundH, bot);
      burn = c.burn; vent = c.vent;
      if (c.drop && !bot.dropCool) { dropMarker(); bot.dropCool = true; bot.lastPred = undefined; }
    }
    b.burning = burn && b.fuel > 0; b.venting = vent;
    // soft walls at the edge of the valley
    const wall = (v) => (Math.abs(v) > SIZE - 120 ? -Math.sign(v) * (Math.abs(v) - (SIZE - 120)) * 0.05 : 0);
    b.vx += wall(b.x) * dt; b.vy += wall(b.y) * dt;
    const touch = stepBalloon(b, dt, layers, groundH, G.t);
    if (!b.ground && b.z - groundH(b.x, b.y) > 4) G.lifted = true;
    if (touch && G.lifted) {
      G.lastTouch = touch.vz;
      if (touch.vz > 3) { G.penalty += 20; pop("Hard bump", "−20"); audio.bump(); }
      else if (touch.vz > 0.4) audio.thud();
    }
    // chimney collisions: the envelope is a ~8 m sphere-ish shape from z+4 to z+24
    G.bumpT -= dt;
    for (const [cx, cy, cz, r, ht] of CHIMNEYS) {
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d > 30) continue;
      const top = cz + ht + 4, zEnv = b.z + ENV.THROAT + ENV.H * 0.6;
      if (b.z > top) continue;
      const hEnv = clamp((top - b.z) / ENV.H, 0, 1), rr = r * 0.9 + (zEnv < top ? ENV.R * 0.85 : 1.2) * hEnv;
      if (d < rr) {
        const ux = dx / (d || 1), uy = dy / (d || 1), push = rr - d;
        b.x += ux * push; b.y += uy * push; const vn = b.vx * ux + b.vy * uy; if (vn < 0) { b.vx -= ux * vn * 1.6; b.vy -= uy * vn * 1.6; }
        if (G.bumpT <= 0) { G.bumpT = 2; G.penalty += 10; pop("Bumped a rock tower", "−10"); audio.bump(); }
      }
    }
    // markers
    for (const m of G.markers) {
      if (stepMarker(m, dt, layers, groundH, G.t)) { markerLanded(m); if (bot) bot.dropCool = false; }
      m.trail.push([m.x, m.y, m.z]); if (m.trail.length > 14) m.trail.shift();
    }
    G.markers = G.markers.filter((m) => !m.landed);
    // the flight ends when the basket rests on the ground after lifting off
    if (G.lifted && b.ground && Math.hypot(b.vx, b.vy) < 0.8 && b.T < PHYS.T_HOVER + 4) {
      G.restT += dt;
      if (G.restT > 2.2 && G.markers.length === 0) {
        const L = F.land, d = Math.hypot(b.x - L[0], b.y - L[1]), vz = G.lastTouch ?? 0;
        if (d <= L[2]) G.landQ = vz < 1.2 ? { pts: 60, label: "soft landing" } : vz < 3 ? { pts: 30, label: "firm landing" } : { pts: 0, label: "hard landing" };
        else G.landQ = null;
        G.state = "landed"; G.endT = 0; pop(G.landQ ? "Landed!" : "Landed outside the field", G.landQ ? `${G.landQ.label} · +${G.landQ.pts}` : `${d.toFixed(0)} m from the field`);
        audio.chime(G.landQ ? G.landQ.pts + 30 : 0);
      }
    } else G.restT = 0;
    if (b.fuel <= 0 && !G.noFuelMsg) { G.noFuelMsg = true; toast("Out of propane — you can only sink now"); }
    audio.update(b.burning, b.venting, Math.hypot(b.vx, b.vy) / 8, cam.basket ? 1 : clamp(60 / cam.dist, 0.2, 1));
    // dusk: sky lanterns from the village
    if (F.tod === "dusk" && rnd() < dt * 1.2 && G.lanterns.length < 60) { const x = VILLAGE.x + (rnd() - 0.5) * 200, y = VILLAGE.y + (rnd() - 0.5) * 200; G.lanterns.push({ x, y, z: groundH(x, y) + 2, v: 1 + rnd() * 1.2, ph: rnd() * 6 }); }
  } else if (G.state === "landed") {
    G.endT += dt; G.b.burning = false; audio.update(false, false, 0.1, 0.5);
    if (G.endT > 2.5) finish();
  } else audio.update(false, false, 0.2, 0);
  for (const l of G.lanterns) { const [wx, wy] = windAt(layers, l.z, G.t); l.x += wx * dt * 0.8; l.y += wy * dt * 0.8; l.z += l.v * dt; }
  G.lanterns = G.lanterns.filter((l) => l.z < 700);
  updateFest(dt, layers);
  // wind motes drift with their layer, wrapped around the focus
  const fx = G.b && G.state !== "title" ? G.b : { x: cam.T[0], y: cam.T[1], z: cam.T[2] };
  for (const m of motes) {
    const [wx, wy] = windAt(layers, m.z, G.t); m.x += wx * dt; m.y += wy * dt;
    if (m.x - fx.x > 250) m.x -= 500; if (m.x - fx.x < -250) m.x += 500; if (m.y - fx.y > 250) m.y -= 500; if (m.y - fx.y < -250) m.y += 500;
    if (m.z - fx.z > 200) m.z -= 400; if (m.z - fx.z < -200) m.z += 400;
  }
  G.mist = (G.F ? G.F.mist : 0.8) * Math.max(0.25, 1 - G.t / 500);
  ui.frame(dt);
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.25, dist: 55, basket: false, E: [0, -60, 80], T: [0, 0, 60] };
function updateCamera(dt) {
  let E, T, mag = 1.55;
  if (G.state === "title" || G.state === "loading" || !G.b) {
    const a = time * 0.03;
    T = [Math.sin(a * 0.7) * 200, Math.cos(a * 0.5) * 200, 120]; E = [T[0] + Math.sin(a) * 420, T[1] + Math.cos(a) * 420, 230];
  } else {
    const b = G.b, k = input.keys;
    if (k.has("ArrowLeft")) cam.yaw += dt * 1.2; if (k.has("ArrowRight")) cam.yaw -= dt * 1.2;
    if (k.has("ArrowUp")) cam.pitch = clamp(cam.pitch + dt, -0.9, 1.3); if (k.has("ArrowDown")) cam.pitch = clamp(cam.pitch - dt, -0.9, 1.3);
    const c = Math.cos(cam.pitch);
    if (cam.basket) {
      E = [b.x, b.y, b.z + 1.75]; const dir = [-Math.sin(cam.yaw) * c, -Math.cos(cam.yaw) * c, -Math.sin(cam.pitch)];
      T = [E[0] + dir[0] * 10, E[1] + dir[1] * 10, E[2] + dir[2] * 10]; mag = 1.3;
    } else {
      T = [b.x, b.y, b.z + 11];
      E = [T[0] + Math.sin(cam.yaw) * c * cam.dist, T[1] + Math.cos(cam.yaw) * c * cam.dist, T[2] + Math.sin(cam.pitch) * cam.dist];
      E[2] = Math.max(E[2], groundH(E[0], E[1]) + 3);
    }
  }
  const k = G.state === "fly" || G.state === "landed" ? 1 : Math.min(1, dt * 1.5);
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k));
  space.magnifier = mag * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(120000), Sh = new Mesh(4000), A = new Mesh(40000), dyn = new Mesh(200000);
function flame(x, y, z, k) {
  for (let i = 0; i < 5; i++) { const f = i / 5, j = (Math.random() - 0.5) * 0.15; A.sprite(x + j, y + j, z + f * 1.1, (0.55 - f * 0.25) * k, (0.5 + f * 0.6) * k, (0.55 + f * 0.25) * k, (1.0 - f * 0.75) * k); }
  A.sprite(x, y, z + 0.6, 1.3 * k, 0.35 * k, 0.2 * k, 0.07 * k);
}
function drawCloth(x, y, done, active) {
  // a big X of white cloth draped over the ground, with a red centre disc
  const col = done ? [0.95, 0.78, 0.3] : [0.97, 0.96, 0.93];
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux, L = 22, W = 2.8, N = 10;
    for (let i = 0; i < N; i++) {
      const s0 = -L + (i / N) * 2 * L, s1 = -L + ((i + 1) / N) * 2 * L;
      const P = (s, w) => { const px = x + ux * s + vx * w, py = y + uy * s + vy * w; return [px, py, groundH(px, py) + 0.35]; };
      D.quad(P(s0, -W), P(s1, -W), P(s1, W), P(s0, W), col, MAT.MATTE);
    }
  }
  const N = 16;
  for (let i = 0; i < N; i++) { const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, z = groundH(x, y) + 0.45; D.tri([x, y, z], [x + Math.cos(a0) * 4, y + Math.sin(a0) * 4, z], [x + Math.cos(a1) * 4, y + Math.sin(a1) * 4, z], done ? [0.9, 0.5, 0.15] : [0.85, 0.12, 0.1], MAT.MATTE); }
  if (active) { const p = 0.5 + 0.5 * Math.sin(time * 3); for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU + time * 0.3, px = x + Math.cos(a) * 30, py = y + Math.sin(a) * 30; A.sprite(px, py, groundH(px, py) + 1.2, 1.4, 0.5 * p, 0.35 * p, 0.12 * p); } A.sprite(x, y, groundH(x, y) + 30, 8, 0.25 * p, 0.18 * p, 0.06 * p); }
}
function drawField(L, active) {
  const [x, y, r] = L;
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, z = groundH(px, py); tube(D, px, py, 5, 0.9, z - 0.2, 0, z + 2.2, i % 2 ? [0.98, 0.95, 0.9] : [0.95, 0.45, 0.1], MAT.MATTE); if (active) A.sprite(px, py, z + 2.6, 1.2, 0.45, 0.25, 0.08); }
  // windsock pole
  const z = groundH(x, y), [wx, wy] = windAt(G.F.layers, z + 8, G.t), s = Math.hypot(wx, wy) || 1;
  tube(D, x, y, 6, 0.15, z, 0.12, z + 9, [0.85, 0.85, 0.88], MAT.GLOSS);
  limb(D, [x, y, z + 8.8], [x + (wx / s) * 4, y + (wy / s) * 4, z + 8.8 - (1 - Math.min(1, s / 4)) * 2], 0.6, 0.35, [0.95, 0.45, 0.1], MAT.MATTE, 6);
}
function buildDynamic() {
  D.reset(); Sh.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const pal = G.pal, sun = nrm(pal.sun);
  // festival
  for (const f of fest) {
    if (Math.hypot(f.x - cam.E[0], f.y - cam.E[1]) > 2600) continue;
    putBalloon(D, models[f.pattern], f.x, f.y, f.z, f.rot, f.burn > 0 ? 0.7 : 0.05 * pal.night);
    if (f.burn > 0) flame(f.x, f.y, f.z + 3.1, 1.6);
    const gz = groundH(f.x, f.y), h = f.z - gz;
    if (h < 300) shadowQ(Sh, f.x - (sun[0] / Math.max(0.2, sun[2])) * h * 0.25, f.y - (sun[1] / Math.max(0.2, sun[2])) * h * 0.25, groundH(f.x - (sun[0] / Math.max(0.2, sun[2])) * h * 0.25, f.y - (sun[1] / Math.max(0.2, sun[2])) * h * 0.25), 7, 0.25 * (1 - h / 300));
  }
  // flight objects
  if (G.F && G.state !== "title") {
    const F = G.F, goal = nextGoal();
    F.targets.forEach(([x, y], i) => drawCloth(x, y, G.scores[i] !== null, goal.kind === "target" && goal.i === i));
    drawField(F.land, goal.kind === "land");
    for (const m of G.markers) {
      tube(D, m.x, m.y, 6, 0.35, m.z - 0.3, 0.3, m.z + 0.3, [0.55, 0.42, 0.25], MAT.MATTE);
      for (let i = 1; i < m.trail.length; i++) { const k = i / m.trail.length, p = m.trail[i]; A.sprite(p[0], p[1], p[2] + 0.5 + (m.trail.length - i) * 0.4, 0.35 * k, m.col[0] * k, m.col[1] * k, m.col[2] * k); }
    }
    for (const m of G.landedMarks) { tube(D, m.x, m.y, 6, 0.4, m.z, 0.3, m.z + 0.4, [0.55, 0.42, 0.25], MAT.MATTE); for (let i = 0; i < 6; i++) { const a = m.ti * 1.3; D.quad([m.x + Math.cos(a) * i * 1.4, m.y + Math.sin(a) * i * 1.4, groundH(m.x, m.y) + 0.4], [m.x + Math.cos(a) * (i + 1) * 1.4, m.y + Math.sin(a) * (i + 1) * 1.4, groundH(m.x, m.y) + 0.4], [m.x + Math.cos(a) * (i + 1) * 1.4 - Math.sin(a) * 0.35, m.y + Math.sin(a) * (i + 1) * 1.4 + Math.cos(a) * 0.35, groundH(m.x, m.y) + 0.4], [m.x + Math.cos(a) * i * 1.4 - Math.sin(a) * 0.35, m.y + Math.sin(a) * i * 1.4 + Math.cos(a) * 0.35, groundH(m.x, m.y) + 0.4], m.col, MAT.MATTE); } }
    // the player's balloon
    const b = G.b, glow = b.burning ? 0.85 + Math.random() * 0.15 : Math.max(0, (b.T - 40) / 400);
    putBalloon(D, playerModel, b.x, b.y, b.z, b.rot, glow);
    if (b.burning) flame(b.x, b.y, b.z + 3.1, 2.2);
    const gz = groundH(b.x, b.y), h = b.z - gz, off = h / Math.max(0.2, sun[2]), sx = b.x - sun[0] * off * 0.6, sy = b.y - sun[1] * off * 0.6;
    if (h < 400) { shadowQ(Sh, sx, sy, groundH(sx, sy), 8, 0.4 * (1 - h / 400)); shadowQ(Sh, b.x, b.y, gz, 2.2 + h * 0.02, 0.5 * Math.max(0, 1 - h / 60)); }
    // predicted marker impact (helps aiming low and slow)
    if (G.state === "fly" && !b.ground && activeTarget() >= 0 && G.used[activeTarget()] < MARKERS_PER) {
      const p = predictMarker(b, F.layers, groundH, G.t), k = 0.6 + 0.4 * Math.sin(time * 6);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; A.sprite(p.x + Math.cos(a) * 3, p.y + Math.sin(a) * 3, p.z + 0.8, 0.6, 0.9 * k, 0.9 * k, 1.0 * k); }
    }
  }
  for (const l of G.lanterns) { const f = 0.8 + 0.2 * Math.sin(time * 9 + l.ph); A.sprite(l.x, l.y, l.z, 2.2, 0.5 * f, 0.25 * f, 0.08 * f); A.sprite(l.x, l.y, l.z, 0.5, 1.0, 0.7, 0.35); }
  // wind motes: faint, tinted by layer, longer as they move
  if (save.motes && G.F && G.state !== "title") {
    const L = G.F.layers;
    for (const m of motes) {
      const li = layerIndex(L, m.z), c = MOTE_COL[li % MOTE_COL.length], tw = 0.5 + 0.5 * Math.sin(time * 1.5 + m.ph);
      const d = Math.hypot(m.x - cam.E[0], m.y - cam.E[1], m.z - cam.E[2]), k = 0.09 * tw * clamp(1 - d / 320, 0, 1);
      if (k < 0.004) continue;
      const [wx, wy] = windAt(L, m.z, G.t);
      for (let j = 0; j < 3; j++) A.sprite(m.x - wx * j * 0.5, m.y - wy * j * 0.5, m.z, 0.9, c[0] * k * (1 - j * 0.3), c[1] * k * (1 - j * 0.3), c[2] * k * (1 - j * 0.3));
    }
  }
  const oD = 6; dyn.append(D); const oSh = dyn.n; dyn.append(Sh); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oSh - oD, oSh, nSh: oA - oSh, oA, nA: dyn.n - oA };
}

// ------------------------------------------------------------------ lights
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [];
  if (G.b && G.state !== "title") { const b = G.b; if (b.burning) L.push({ p: [b.x, b.y, b.z + 4.5], c: [1, 0.6, 0.3], k: 7, d: 0 }); }
  for (const f of fest) if (f.burn > 0) L.push({ p: [f.x, f.y, f.z + 4.5], c: [1, 0.6, 0.3], k: 5, d: Math.hypot(f.x - cam.E[0], f.y - cam.E[1], f.z - cam.E[2]) });
  if (G.pal.night > 0.3) for (const p of LIGHTS) L.push({ p, c: [1, 0.6, 0.3], k: 3 * G.pal.night, d: Math.hypot(p[0] - cam.E[0], p[1] - cam.E[1]) + 50 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}

function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights(), p = G.pal;
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time);
  gl.uniform3fv(U.uSunDir, nrm(p.sun)); gl.uniform3fv(U.uSunCol, p.sc); gl.uniform3fv(U.uSkyTop, p.top); gl.uniform3fv(U.uSkyHor, p.hor); gl.uniform3fv(U.uSkyGlow, p.glow);
  gl.uniform3fv(U.uAmbTop, p.at); gl.uniform3fv(U.uAmbBot, p.ab); gl.uniform1f(U.uNight, p.night); gl.uniform1f(U.uMist, G.mist);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("O"); S("W"); space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); S("Sh"); space.bind(true); space.draw(o.oSh, o.nSh);
  gl.blendFunc(gl.ONE, gl.ONE); S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: 0 });
}

// ------------------------------------------------------------------ UI
let popT = 0, toastT = 0;
function pop(t, s) { $("pop-t").textContent = t; $("pop-s").textContent = s; $("pop").classList.add("show"); popT = 2.2; }
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); toastT = 3; }
const alt = $("alt").getContext("2d");
const ui = {
  show(w) { for (const id of ["title", "flights", "brief", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  tasks() {
    const F = G.F;
    $("tasks").innerHTML = F.targets.map((_, i) => { const s = G.scores[i], left = MARKERS_PER - G.used[i]; return `<div class="${s !== null ? "ok" : ""}"><i>${s !== null ? "✓" : i + 1}</i><span>Target ${i + 1}</span><b>${s !== null ? s : "●".repeat(left) + "○".repeat(MARKERS_PER - left)}</b></div>`; }).join("") +
      `<div class="${G.landQ ? "ok" : ""}"><i>⚑</i><span>Land in the field</span></div>`;
  },
  frame(dt) {
    if (popT > 0) { popT -= dt; if (popT <= 0) $("pop").classList.remove("show"); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("show"); }
    if (G.state !== "fly" && G.state !== "landed") return;
    const b = G.b, F = G.F;
    $("fuel-i").style.width = b.fuel + "%"; $("fuel-v").textContent = Math.round(b.fuel) + "%"; $("fuel").classList.toggle("low", b.fuel < 20);
    $("temp-i").style.width = (b.T / PHYS.T_MAX) * 100 + "%"; $("temp-v").textContent = Math.round(b.T + 15) + "°C";
    $("temp-h").style.left = (PHYS.T_HOVER / PHYS.T_MAX) * 100 + "%";
    const g = nextGoal(), dx = g.x - b.x, dy = g.y - b.y, ang = Math.atan2(dx, dy) - Math.atan2(cam.T[0] - cam.E[0], cam.T[1] - cam.E[1]);
    $("cmp-a").style.transform = `rotate(${(ang * 180) / Math.PI}deg)`; $("cmp-d").textContent = `${Math.round(Math.hypot(dx, dy))} m`;
    $("cmp-l").textContent = g.kind === "land" ? "LANDING FIELD" : `TARGET ${g.i + 1}`;
    $("c-drop").classList.toggle("dis", g.kind !== "target" || G.used[g.i] >= MARKERS_PER || b.ground);
    this.altimeter();
  },
  altimeter() {
    const c = alt, W = c.canvas.width, H = c.canvas.height, b = G.b, L = G.F.layers, ZMAX = 640;
    const Y = (z) => H - 14 - (z / ZMAX) * (H - 28);
    c.clearRect(0, 0, W, H);
    const camYaw = Math.atan2(cam.T[0] - cam.E[0], cam.T[1] - cam.E[1]);
    let lo = 0;
    L.forEach((ly, i) => {
      const hi = Math.min(ZMAX, ly.top), col = MOTE_COL[i % MOTE_COL.length];
      c.fillStyle = `rgba(${col.map((v) => Math.round(v * 255)).join(",")},${0.1 + (layerIndex(L, b.z) === i ? 0.14 : 0)})`; c.fillRect(30, Y(hi), W - 34, Y(lo) - Y(hi));
      const zm = (lo + hi) / 2, [wx, wy] = windAt(L, zm, G.t), sp = Math.hypot(wx, wy), a = Math.atan2(wx, wy) - camYaw;
      c.save(); c.translate(W - 32, Y(zm)); c.rotate(a); c.strokeStyle = `rgb(${col.map((v) => Math.round(v * 255)).join(",")})`; c.lineWidth = 3; c.lineCap = "round";
      const len = 6 + sp * 2.2; c.beginPath(); c.moveTo(0, len); c.lineTo(0, -len); c.moveTo(-5, -len + 6); c.lineTo(0, -len); c.lineTo(5, -len + 6); c.stroke(); c.restore();
      c.fillStyle = "rgba(255,255,255,0.8)"; c.font = "600 18px Outfit, sans-serif"; c.fillText(`${sp.toFixed(0)}`, 36, Y(zm) + 6);
      lo = hi;
    });
    // ground under the balloon, the balloon, its vertical speed
    const gz = groundH(b.x, b.y); c.fillStyle = "rgba(120,80,50,0.65)"; c.fillRect(30, Y(gz), W - 34, H - Y(gz));
    const yb = Y(b.z); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(4, yb - 9); c.lineTo(24, yb); c.lineTo(4, yb + 9); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 2; c.beginPath(); c.moveTo(28, yb); c.lineTo(W - 4, yb); c.stroke();
    $("alt-v").textContent = `${Math.round(b.z - gz)} m`; $("vario").textContent = `${b.vz >= 0 ? "▲" : "▼"} ${Math.abs(b.vz).toFixed(1)} m/s`; $("vario").className = b.vz > 0.2 ? "up" : b.vz < -0.2 ? "dn" : "";
  },
  title() { const n = Object.values(save.stars).reduce((a, b) => a + b, 0); $("t-foot").textContent = `★ ${n} / ${FLIGHTS.length * 3}  ·  Space burn · V vent · M drop marker · C basket view · drag to look`; },
  flights() {
    const art = (tod) => { const t = TOD[tod], c = (v) => `rgb(${v.map((x) => Math.round(Math.min(1, x) * 255)).join(",")})`; return `linear-gradient(180deg, ${c(t.top)} 0%, ${c(t.hor)} 75%, ${c(t.ab.map((v) => v * 2))} 100%)`; };
    $("grid").innerHTML = FLIGHTS.map((f, i) => {
      const lock = i > save.unlocked, st = save.stars[i] || 0;
      return `<button class="card" data-i="${i}" ${lock ? "disabled" : ""} style="--art:${art(f.tod)}"><span class="num">${i + 1}</span>${lock ? '<span class="lock">🔒</span>' : ""}<b>${f.name}</b><span class="best">${save.best[i] ? "best " + save.best[i] : f.targets.length + " target" + (f.targets.length > 1 ? "s" : "")}</span><span class="st">${[0, 1, 2].map((k) => (k < st ? "<i>★</i>" : "★")).join("")}</span></button>`;
    }).join("");
    $("grid").querySelectorAll(".card").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); startFlight(+b.dataset.i); }));
  },
};
function pause() { G.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = "fly"; }
function toTitle() { for (const m of ["m-pause", "m-done", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; G.F = null; G.b = null; G.pal = TOD.sunrise; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.click(); startFlight(Math.min(save.unlocked, FLIGHTS.length - 1)); };
$("t-flights").onclick = () => { audio.init(); audio.click(); G.state = "flights"; ui.flights(); ui.show("flights"); };
$("f-back").onclick = () => { G.state = "title"; ui.show("title"); ui.title(); };
$("b-go").onclick = () => { audio.init(); audio.click(); go(); };
$("b-pause").onclick = () => pause();
$("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startFlight(G.fi); }; $("p-title").onclick = toTitle;
$("d-retry").onclick = () => { $("m-done").classList.add("hidden"); startFlight(G.fi); };
$("d-flights").onclick = () => { $("m-done").classList.add("hidden"); G.state = "flights"; ui.flights(); ui.show("flights"); };
$("d-next").onclick = () => { $("m-done").classList.add("hidden"); startFlight(G.fi + 1); };
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-motes").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (save.motes ? "1" : "0"))); $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-motes").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.motes = b.dataset.v === "1"; persist(); $("st-motes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ boot
const bot = Q.has("auto") ? {} : null;
window.__drift = () => { const b = G.b; return { state: G.state, flight: G.fi + 1, t: +G.t.toFixed(1), b: b && { x: +b.x.toFixed(0), y: +b.y.toFixed(0), z: +b.z.toFixed(0), T: +b.T.toFixed(0), fuel: +b.fuel.toFixed(0) }, scores: G.scores, penalty: G.penalty, fps }; };
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (G.state !== "paused") update(bot && G.state === "fly" ? dt * (+Q.get("speed") || 1) : dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); G.state = "title"; ui.show("title"); ui.title();
  if (Q.has("flight")) startFlight(clamp(+Q.get("flight") - 1, 0, FLIGHTS.length - 1)); else if (bot) startFlight(0);
}, 400);
