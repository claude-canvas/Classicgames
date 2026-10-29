// LANTERN BOW — first-person Japanese archery in a cherry-blossom garden. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. physics.js flies the arrows, scene.js builds the
// garden, bow.js the yumi, fx.js the particles; this file runs the stages, input, camera, lighting and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, mixc, limb, tube, blob } from "./mesh.js";
import { STAGES } from "./levels.js";
import { stepArrow, segDisc, segLantern, launchSpeed, aimDir, predict, solveAim } from "./physics.js";
import { buildScene, groundH, DECK_Z, EYE_Z, POND, TORO, BANNERS, shadow } from "./scene.js";
import { basis, drawBow, drawArrow } from "./bow.js";
import { FX, Ambient, streak } from "./fx.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
const DEF = { best: {}, stars: {}, unlocked: 0, volume: 0.8, music: 0.6, sens: 1, guide: "auto", arrowCam: true, invert: false };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("lanternbow.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("lanternbow.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const stat = new Mesh(400000);
let nO = 0, nSh = 0, nA = 0;
{ const O = new Mesh(380000), Sh = new Mesh(4000), A = new Mesh(2000); buildScene(O, A, Sh); stat.append(O); stat.append(Sh); stat.append(A); nO = O.n; nSh = Sh.n; nA = A.n; space.setStatic(stat.pos, stat.col, stat.n); }

// ------------------------------------------------------------------ time of day
const KEYS = [   // tod, sun dir (elev), sun col, sky top, sky horizon, glow, amb top, amb bottom, night
  { t: 0.0, sun: [-0.35, 0.93, 0.15], sc: [1.7, 1.08, 0.6], top: [0.26, 0.42, 0.7], hor: [1.0, 0.74, 0.48], glow: [1.25, 0.72, 0.36], at: [0.36, 0.38, 0.5], ab: [0.26, 0.19, 0.12], n: 0 },
  { t: 0.35, sun: [-0.32, 0.94, 0.06], sc: [1.8, 0.78, 0.38], top: [0.22, 0.3, 0.56], hor: [1.0, 0.6, 0.38], glow: [1.4, 0.6, 0.3], at: [0.32, 0.3, 0.42], ab: [0.22, 0.15, 0.1], n: 0.05 },
  { t: 0.62, sun: [-0.3, 0.95, -0.02], sc: [0.9, 0.3, 0.22], top: [0.1, 0.12, 0.3], hor: [0.95, 0.42, 0.38], glow: [1.0, 0.36, 0.32], at: [0.2, 0.19, 0.3], ab: [0.1, 0.08, 0.08], n: 0.35 },
  { t: 1.0, sun: [0.45, 0.8, 0.4], sc: [0.28, 0.32, 0.48], top: [0.02, 0.03, 0.09], hor: [0.1, 0.12, 0.22], glow: [0.12, 0.14, 0.24], at: [0.1, 0.11, 0.18], ab: [0.03, 0.03, 0.05], n: 1 },
];
function todAt(tod) {
  let i = 0; while (i < KEYS.length - 2 && tod > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = clamp((tod - a.t) / (b.t - a.t), 0, 1), L = (x, y) => x.map((v, j) => lerp(v, y[j], k));
  return { sun: nrm(L(a.sun, b.sun)), sc: L(a.sc, b.sc), top: L(a.top, b.top), hor: L(a.hor, b.hor), glow: L(a.glow, b.glow), at: L(a.at, b.at), ab: L(a.ab, b.ab), night: lerp(a.n, b.n, k) };
}

// ------------------------------------------------------------------ game state
const G = {
  state: "loading", stage: 0, S: STAGES[0], score: 0, arrowsLeft: 0, combo: 0, bestCombo: 0, hits: 0, shots: 0,
  wind: [0, 0, 0], targets: [], lanterns: [], stuck: [], arrow: null, draw: 0, drawing: false, holdT: 0, breath: 1, holdingBreath: false,
  yaw: 0, pitch: 0.035, spin: 0, nock: 1, timeScale: 1, camMode: "bow", camPlan: null, camHold: 0, t: 0, lanternT: 0, lanternN: 0, endT: -1, tod: 0.55,
};
const fx = new FX(), amb = new Ambient();
let time = 0;

function startStage(i) {
  G.stage = i; const S = (G.S = STAGES[i]);
  Object.assign(G, { score: 0, arrowsLeft: S.arrows, combo: 0, bestCombo: 0, hits: 0, shots: 0, stuck: [], arrow: null, draw: 0, drawing: false, holdT: 0, breath: 1, yaw: 0, pitch: 0.035, spin: 0, nock: 1, timeScale: 1, camMode: "bow", camPlan: null, lanternT: 1.5, lanternN: 0, endT: -1, tod: S.tod, lanterns: [] });
  G.targets = (S.mato || []).map((m) => ({ type: "mato", base: m.p.slice(), p: m.p.slice(), r: 0.5, slide: m.slide, ph: Math.random() * TAU, stuck: [] }));
  if (S.gong) G.targets.push({ type: "gong", pivot: [S.gong[0], S.gong[1], S.gong[2] + 1.4], L: 1.4, r: 0.8, ang: 0, angV: 0, stuck: [] });
  newWind(); fx.p = []; fx.shells = [];
  G.state = "aim"; audio.night = S.night ? 1 : 0;
  ui.show("hud"); ui.hud(); ui.quiver();
  $("hint").style.opacity = 1; setTimeout(() => ($("hint").style.opacity = 0), 6000);
}
function newWind() {
  const S = G.S, sp = S.wind * (0.25 + 0.75 * Math.random()), a = Math.random() * TAU;
  G.wind = [Math.cos(a) * sp, Math.sin(a) * sp * 0.6, 0];
}
function eye() { return [0, 0, EYE_Z]; }
function sway() {
  const amp = (0.0016 + Math.max(0, G.holdT - 2.5) * 0.0035) * (G.holdingBreath && G.breath > 0 ? 0.22 : 1) * (G.drawing ? 1 : 0.5);
  return [(Math.sin(time * 0.9) * 0.6 + Math.sin(time * 2.3 + 1) * 0.4) * amp, (Math.sin(time * 0.7 + 2) * 0.6 + Math.sin(time * 1.9) * 0.4) * amp + Math.sin(time * 1.3) * amp * 0.4];
}
function aimNow() { const s = sway(); return [G.yaw + s[0], G.pitch + s[1]]; }

// ------------------------------------------------------------------ targets
function matoBasis(t) { const n = nrm([-t.p[0], -t.p[1], 0]); const side = [n[1], -n[0], 0]; return { n, side, up: [0, 0, 1] }; }
function gongDisc(t) {
  const c = Math.cos(t.ang), s = Math.sin(t.ang);
  const down = [0, s, -c], n = [0, -c, -s];             // swings about the x axis
  return { c: add(t.pivot, down, t.L), n };
}
function updateTargets(dt) {
  for (const t of G.targets) {
    if (t.type === "mato" && t.slide) { const [amp, per] = t.slide; t.p[0] = t.base[0] + Math.sin((G.t / per) * TAU + t.ph) * amp; }
    if (t.type === "gong") { t.angV += (-9.81 / t.L * Math.sin(t.ang) - t.angV * 0.25) * dt; t.ang += t.angV * dt; }
  }
  const L = G.S.lanterns;
  if (L && G.lanternN < L.count && G.state !== "done") {
    G.lanternT -= dt;
    if (G.lanternT <= 0) { G.lanternT = L.every * (0.7 + Math.random() * 0.6); G.lanternN++; spawnLantern(L.festival); }
  }
  for (const l of G.lanterns) {
    l.p[0] += (G.wind[0] * 0.3 + Math.sin(G.t * 0.7 + l.ph) * 0.12) * dt; l.p[1] += (G.wind[1] * 0.3) * dt; l.p[2] += l.rise * dt;
    if (l.p[2] > 48) l.gone = true;
  }
  G.lanterns = G.lanterns.filter((l) => !l.gone);
}
function spawnLantern(festival) {
  const x = (Math.random() - 0.5) * 12, y = 12 + Math.random() * 20;
  G.lanterns.push({ p: [x, y, groundH(x, y) + 0.8], rise: 0.75 + Math.random() * 0.55, ph: Math.random() * TAU, festival, col: festival ? [[1, 0.55, 0.35], [1, 0.75, 0.4], [1, 0.45, 0.55]][Math.floor(Math.random() * 3)] : [1, 0.68, 0.38] });
}

// ------------------------------------------------------------------ shooting
function loose() {
  const power = G.draw, [yaw, pitch] = aimNow(), d = aimDir(yaw, pitch), s = launchSpeed(power), E = eye();
  const p = add(add(E, d, 0.35), [0, 0, -0.06]);
  G.arrow = { p, v: d.map((x) => x * s), t: 0, trail: [p.slice()], power, hitAny: false };
  G.arrowsLeft--; G.shots++; G.draw = 0; G.drawing = false; G.holdT = 0; G.spin = 0.001; G.nock = 0;
  audio.release(power); ui.quiver();
  // arrow cam: look ahead for an impact further than 25 m
  G.camPlan = null;
  if (save.arrowCam) {
    const a = { p: p.slice(), v: G.arrow.v.slice() };
    for (let tt = 0; tt < 3; tt += 0.01) {
      const p0 = a.p.slice(); stepArrow(a, 0.01, G.wind);
      const h = collide(p0, a.p, true);
      if (h && h.kind !== "ground") { if (Math.hypot(a.p[0], a.p[1]) > 25) G.camPlan = { start: Math.max(0, tt - 0.35) }; break; }
      if (a.p[2] < groundH(a.p[0], a.p[1])) break;
    }
  }
}
// test segment p0→p1 against everything; probe = don't apply effects
function collide(p0, p1, probe = false) {
  let best = null;
  for (const t of G.targets) {
    if (t.type === "mato") { const B = matoBasis(t), h = segDisc(p0, p1, t.p, B.n, t.r); if (h && (!best || h.t < best.t)) best = { ...h, kind: "mato", t: h.t, target: t }; }
    if (t.type === "gong") { const g = gongDisc(t), h = segDisc(p0, p1, g.c, g.n, t.r); if (h && (!best || h.t < best.t)) best = { ...h, kind: "gong", target: t }; }
  }
  for (const l of G.lanterns) { if (l.hit) continue; const h = segLantern(p0, p1, l.p, 0.33, 0.6); if (h && (!best || h.t < best.t)) best = { ...h, kind: "lantern", target: l }; }
  if (!best && p1[2] < groundH(p1[0], p1[1]) + (Math.abs(p1[0]) < 4.2 && p1[1] > -4 && p1[1] < 1.2 ? DECK_Z : 0)) best = { kind: "ground", point: p1, t: 1 };
  return best;
}
const RING = [[10, "Bullseye!"], [8, "Gold ring"], [6, "Inner ring"], [4, "Outer ring"], [2, "Edge"]];
function hit(h) {
  const a = G.arrow, dist = Math.hypot(h.point[0], h.point[1]), dir = nrm(a.v);
  const bonus = Math.max(0, Math.floor((dist - 20) / 5));
  const mult = [1, 1.25, 1.5, 2][Math.min(3, G.combo)];
  if (h.kind === "mato") {
    const ring = Math.min(4, Math.floor(h.rad / 0.1)), [base, label] = RING[ring], slide = h.target.slide ? 1.5 : 1;
    const pts = Math.round((base * slide + bonus) * mult);
    award(pts, label, ring === 0);
    h.target.stuck.push({ off: sub(h.point, h.target.p), dir });
    fx.sparks(h.point, [1, 0.85, 0.5], 14, 2.5); fx.shreds(h.point, ring % 2 ? [0.75, 0.12, 0.1] : [0.95, 0.93, 0.88]);
    audio.thunk(ring === 0); a.done = true;
  } else if (h.kind === "gong") {
    const pts = Math.round((20 + bonus) * mult); award(pts, "The gong sings", true);
    h.target.angV += 1.6; fx.sparks(h.point, [1, 0.75, 0.4], 30, 4); fx.flash = Math.max(fx.flash, 0.5); fx.light(h.point, [1, 0.7, 0.4], 6, 0.6);
    audio.gong(); a.v = a.v.map((x) => -x * 0.15); a.v[2] = -2; a.bounced = true;
  } else if (h.kind === "lantern") {
    const l = h.target; l.hit = true; l.gone = true;
    const pts = Math.round(((l.festival ? 25 : 15) + Math.floor(l.p[2]) + bonus) * mult);
    award(pts, l.festival ? "Festival lantern!" : "Lantern", true);
    fx.embers(l.p, 50); fx.shreds(l.p, l.col, 10); audio.pop();
    if (l.festival) { for (let k = 0; k < 2; k++) setTimeout(() => fx.firework([l.p[0] * 2 + (Math.random() - 0.5) * 20, 60 + Math.random() * 25, 4]), k * 450); audio.launch(); setTimeout(() => audio.boom(1.5), 2300); }
    a.hitAny = true;          // the arrow flies on through the paper
    return false;
  } else {   // ground / deck
    if (!a.hitAny) { G.combo = 0; pop("Miss", ""); audio.miss(); ui.hud(); }
    G.stuck.push({ p: h.point.slice(), dir }); fx.sparks(h.point, [0.8, 0.7, 0.5], 6, 1.5); a.done = true;
  }
  return true;
}
function award(pts, label, chime) {
  G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo); G.hits++; G.score += pts;
  const mult = [1, 1.25, 1.5, 2][Math.min(3, G.combo - 1)];
  pop(label, `+${pts}${mult > 1 ? `  ×${mult}` : ""}`); if (G.combo > 1) audio.combo(G.combo);
  ui.hud();
}
function updateArrow(dtReal) {
  const a = G.arrow; if (!a) return;
  if (G.camPlan && a.t >= G.camPlan.start && !a.done) { G.camMode = "arrow"; G.timeScale = 0.16; }
  const dt = dtReal * G.timeScale;
  if (!a.done) {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    for (let k = 0; k < n && !a.done; k++) {
      const p0 = a.p.slice(); stepArrow(a, dt / n, G.wind); a.t += dt / n;
      const h = collide(p0, a.p);
      if (h) { a.p = h.point.slice(); hit(h); }
      if (!a.done && (a.p[1] > 140 || Math.abs(a.p[0]) > 80 || a.t > 8)) { a.done = true; if (!a.hitAny) { G.combo = 0; pop("Miss", ""); audio.miss(); ui.hud(); } }
    }
    a.trail.push(a.p.slice()); if (a.trail.length > 16) a.trail.shift();
  }
  if (a.done) {
    G.camHold += dtReal;
    if (G.camHold > (G.camMode === "arrow" ? 0.9 : 0.25)) { G.timeScale = 1; G.camMode = "bow"; }
    if (G.camHold > 1.1) {
      G.arrow = null; G.camHold = 0; G.camPlan = null;
      if (G.arrowsLeft <= 0) G.endT = G.S.lanterns && G.S.lanterns.festival ? 3.5 : 1.2;
      else { newWind(); }
    }
  }
}

// ------------------------------------------------------------------ input
const input = { locked: false, keys: new Set(), touch: null };
const coarse = matchMedia("(pointer: coarse)").matches;
canvas.addEventListener("mousedown", (e) => {
  audio.init();
  if (G.state !== "aim") return;
  if (!input.locked && !coarse) { canvas.requestPointerLock?.(); }
  if (e.button === 0) beginDraw();
});
addEventListener("mouseup", (e) => { if (e.button === 0) endDraw(); });
document.addEventListener("pointerlockchange", () => { input.locked = document.pointerLockElement === canvas; });
addEventListener("mousemove", (e) => {
  if (G.state !== "aim" || G.camMode !== "bow") return;
  if (!input.locked && !G.drawing) return;
  const s = 0.0016 * save.sens * (1 - G.draw * 0.35);
  G.yaw = clamp(G.yaw + e.movementX * s, -0.9, 0.9); G.pitch = clamp(G.pitch + (save.invert ? 1 : -1) * e.movementY * s, -0.35, 0.6);
});
canvas.addEventListener("touchstart", (e) => { audio.init(); if (G.state !== "aim") return; const t = e.changedTouches[0]; input.touch = { id: t.identifier, x: t.clientX, y: t.clientY }; beginDraw(); e.preventDefault(); }, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  for (const t of e.changedTouches) if (input.touch && t.identifier === input.touch.id) {
    const s = 0.0028 * save.sens * (1 - G.draw * 0.35);
    G.yaw = clamp(G.yaw + (t.clientX - input.touch.x) * s, -0.9, 0.9); G.pitch = clamp(G.pitch - (t.clientY - input.touch.y) * s, -0.35, 0.6);
    input.touch.x = t.clientX; input.touch.y = t.clientY;
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (input.touch && t.identifier === input.touch.id) { input.touch = null; endDraw(); } });
$("steady").addEventListener("touchstart", (e) => { G.holdingBreath = true; e.preventDefault(); }, { passive: false });
$("steady").addEventListener("touchend", () => (G.holdingBreath = false));
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if (e.code === "Space" && G.state === "aim" && !e.repeat) { beginDraw(); e.preventDefault(); }
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") G.holdingBreath = true;
  if (e.code === "Escape" || e.code === "KeyP") { if (G.state === "aim") pause(); else if (G.state === "paused") resume(); }
});
addEventListener("keyup", (e) => {
  input.keys.delete(e.code);
  if (e.code === "Space") endDraw();
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") G.holdingBreath = false;
});
function beginDraw() { if (G.state === "aim" && !G.arrow && G.arrowsLeft > 0 && G.nock >= 1 && G.endT < 0) { G.drawing = true; } }
function endDraw() { if (!G.drawing) return; if (G.draw > 0.15) loose(); else { G.drawing = false; G.draw = 0; } }

// ------------------------------------------------------------------ update
function update(dt) {
  time += dt; G.t += dt;
  const sdt = dt * G.timeScale;
  if (G.state === "aim" || G.state === "title" || G.state === "stages") {
    // keyboard aim
    const k = input.keys, ks = 0.5 * save.sens * dt * (1 - G.draw * 0.35);
    if (G.state === "aim") {
      if (k.has("ArrowLeft") || k.has("KeyA")) G.yaw -= ks; if (k.has("ArrowRight") || k.has("KeyD")) G.yaw += ks;
      if (k.has("ArrowUp") || k.has("KeyW")) G.pitch += ks; if (k.has("ArrowDown") || k.has("KeyS")) G.pitch -= ks;
      G.yaw = clamp(G.yaw, -0.9, 0.9); G.pitch = clamp(G.pitch, -0.35, 0.6);
    }
    if (G.drawing) { G.draw = Math.min(1, G.draw + dt / 1.1); if (G.draw >= 1) G.holdT += dt; }
    if (G.holdingBreath && G.drawing) G.breath = Math.max(0, G.breath - dt / 3); else G.breath = Math.min(1, G.breath + dt / 4);
    audio.draw(G.drawing ? G.draw : 0);
    if (G.spin > 0) { G.spin = Math.min(1, G.spin + dt * 4); }
    if (!G.arrow && G.nock < 1) { G.nock = Math.min(1, G.nock + dt * 1.6); if (G.nock >= 1) G.spin = 0; }
    updateTargets(sdt);
    updateArrow(dt);
    if (G.endT > 0) { G.endT -= dt; if (G.endT <= 0) finish(); }
    if (bot) botStep(dt);
  }
  fx.update(sdt); amb.update(sdt, G.wind, time);
  if (G.state === "title" || G.state === "stages") titleWorld(dt);
  ui.frame();
}
function titleWorld(dt) {
  // a calm sunset with lanterns rising for the title screen
  G.tod = 0.55; G.wind = [1.2, 0.3, 0];
  G.lanternT -= dt; if (G.lanternT <= 0 && G.lanterns.length < 9) { G.lanternT = 1.8; spawnLantern(false); }
  for (const l of G.lanterns) { l.p[0] += 0.3 * dt; l.p[2] += l.rise * dt; if (l.p[2] > 40) l.gone = true; }
  G.lanterns = G.lanterns.filter((l) => !l.gone);
}

// ------------------------------------------------------------------ camera
const cam = { E: [0, 0, EYE_Z], look: [0, 1, 0], mag: 2.4 };
function updateCamera(dt) {
  let E, d, mag = 2.35;
  if (G.state === "title" || G.state === "stages" || G.state === "loading") {
    E = [Math.sin(time * 0.05) * 3, 3.5 + Math.sin(time * 0.037) * 1.5, 1.7 + Math.sin(time * 0.07) * 0.3]; d = nrm(sub([Math.sin(time * 0.04) * 3, 40, 6.5], E)); mag = 1.9;
  } else if (G.camMode === "arrow" && G.arrow) {
    const a = G.arrow, v = nrm(a.v), side = nrm([v[1], -v[0], 0]);
    E = add(add(add(a.p, v, -1.1), [0, 0, 1], 0.16), side, 0.14); d = nrm(sub(add(a.p, v, 3), E)); mag = 2.2;
  } else {
    const [y, p] = aimNow(); d = aimDir(y, p); E = add(eye(), d, G.draw * 0.04); mag = 2.0 * (1 + G.draw * 0.22);
  }
  const k = G.camMode === "arrow" || G.state !== "aim" ? Math.min(1, dt * 6) : 1;
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.look = nrm(cam.look.map((v, i) => lerp(v, d[i], k))); cam.mag = lerp(cam.mag, mag, Math.min(1, dt * 8));
  space.magnifier = cam.mag * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.E[0] + cam.look[0], cam.E[1] + cam.look[1], cam.E[2] + cam.look[2]);
}
function project(p) {
  const v = sub(p, [space.Xc, space.Yc, space.Zc]), X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
  const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
  return zp > 0.05 ? [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight] : null;
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(120000), Sh = new Mesh(4000), A = new Mesh(60000), RF = new Mesh(4000), dyn = new Mesh(200000);
function drawMato(t, night) {
  const B = matoBasis(t), c = t.p, n = B.n, sd = B.side, up = B.up, segs = 40;
  const rings = [[0.5, [0.96, 0.94, 0.88]], [0.4, [0.78, 0.13, 0.1]], [0.3, [0.96, 0.94, 0.88]], [0.2, [0.95, 0.72, 0.25]], [0.1, [0.82, 0.12, 0.1]]];
  const P = (r, a, d = 0) => add(add(add(c, sd, Math.cos(a) * r), up, Math.sin(a) * r), n, d);
  const glow = night ? 0.55 : 0;
  rings.forEach(([r, col], i) => {
    const r1 = i < 4 ? rings[i + 1][0] : 0;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * TAU, a1 = ((s + 1) / segs) * TAU;
      for (const p of [P(r, a0, 0.002 * i), P(r, a1, 0.002 * i), P(r1, a1, 0.002 * i), P(r, a0, 0.002 * i), P(r1, a1, 0.002 * i), P(r1, a0, 0.002 * i)]) D.v(p[0], p[1], p[2], glow, col[0], col[1], col[2], MAT.PAPER);
    }
  });
  // straw backing + stand
  for (let s = 0; s < segs; s++) { const a0 = (s / segs) * TAU, a1 = ((s + 1) / segs) * TAU; D.quad(P(0.52, a0), P(0.52, a1), P(0.52, a1, -0.16), P(0.52, a0, -0.16), [0.62, 0.5, 0.3], MAT.MATTE); }
  const gz = groundH(c[0], c[1]);
  for (const s of [-1, 1]) limb(D, add(add(c, sd, s * 0.35), n, -0.1), [c[0] + sd[0] * s * 0.5 - n[0] * 0.4, c[1] + sd[1] * s * 0.5 - n[1] * 0.4, gz], 0.035, 0.035, [0.36, 0.22, 0.12], MAT.MATTE, 5);
  shadow(Sh, c[0] - n[0] * 0.25, c[1] - n[1] * 0.25, gz, 0.9, 0.4);
  for (const s of t.stuck) drawArrow(D, add(add(c, s.off), s.dir, -0.72), s.dir, 1.0);
  if (night) A.sprite(c[0] + n[0] * 0.6, c[1] + n[1] * 0.6, c[2] + 0.9, 0.35, 0.5, 0.35, 0.15);
}
function drawGong(t) {
  const g = gongDisc(t), pv = t.pivot, gz = groundH(pv[0], pv[1]);
  for (const s of [-1, 1]) { tube(D, pv[0] + s * 1.3, pv[1], 8, 0.12, gz, 0.1, pv[2] + 0.3, [0.32, 0.18, 0.1], MAT.MATTE); }
  limb(D, [pv[0] - 1.6, pv[1], pv[2] + 0.25], [pv[0] + 1.6, pv[1], pv[2] + 0.25], 0.13, 0.13, [0.6, 0.14, 0.08], MAT.GLOSS, 6);
  const nn = g.n, sd = [1, 0, 0], up = nrm([0, -nn[2], nn[1]]);
  for (const s of [-1, 1]) limb(D, [pv[0] + s * 0.5, pv[1], pv[2] + 0.2], add(add(g.c, sd, s * 0.55), up, 0.55), 0.015, 0.015, [0.75, 0.62, 0.4], MAT.MATTE, 3);
  const segs = 40, P = (r, a, d = 0) => add(add(add(g.c, sd, Math.cos(a) * r), up, Math.sin(a) * r), nn, d);
  const bronze = [0.78, 0.52, 0.26];
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * TAU, a1 = ((s + 1) / segs) * TAU;
    for (const [r0, r1, d0, d1, c] of [[0.8, 0.7, 0.04, 0.02, mixc(bronze, [0.4, 0.25, 0.1], 0.3)], [0.7, 0.2, 0.02, 0.0, bronze], [0.2, 0.0, 0.0, 0.06, mixc(bronze, [1, 0.9, 0.6], 0.3)]]) {
      const q = [P(r0, a0, d0), P(r0, a1, d0), P(r1, a1, d1), P(r1, a0, d1)];
      for (const p of [q[0], q[1], q[2], q[0], q[2], q[3]]) D.v(p[0], p[1], p[2], 1, c[0], c[1], c[2], MAT.GLOSS);
    }
  }
  for (const s of t.stuck) { /* arrows bounce off the gong */ }
}
function drawLantern(l, night, mirror) {
  const [x, y, z] = l.p, r = 0.28, h = 0.5, n = 12, glow = 1.3 + 0.2 * Math.sin(time * 9 + l.ph), col = l.col;
  if (!mirror) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, bulge = (zz) => r * (1 + 0.12 * Math.sin((zz / h) * Math.PI));
      for (let j = 0; j < 3; j++) {
        const z0 = j * h / 3, z1 = (j + 1) * h / 3;
        const q = [[x + Math.cos(a0) * bulge(z0), y + Math.sin(a0) * bulge(z0), z - h / 2 + z0], [x + Math.cos(a1) * bulge(z0), y + Math.sin(a1) * bulge(z0), z - h / 2 + z0], [x + Math.cos(a1) * bulge(z1), y + Math.sin(a1) * bulge(z1), z - h / 2 + z1], [x + Math.cos(a0) * bulge(z1), y + Math.sin(a0) * bulge(z1), z - h / 2 + z1]];
        for (const p of [q[0], q[1], q[2], q[0], q[2], q[3]]) D.v(p[0], p[1], p[2], glow, col[0], col[1], col[2], MAT.PAPER);
      }
    }
    tube(D, x, y, n, r * 0.95, z + h / 2, r * 0.95, z + h / 2 + 0.03, [0.15, 0.08, 0.06], MAT.MATTE, 0, false);
    A.sprite(x, y, z, 1.2, col[0] * 0.28, col[1] * 0.22, col[2] * 0.14);
    A.sprite(x, y, z - h * 0.35, 0.18, 1.0, 0.8, 0.45);
  }
}
function drawBanner([x, y]) {
  const gz = groundH(x, y), w = G.wind, sp = Math.hypot(w[0], w[1]), dir = sp > 0.05 ? [w[0] / sp, w[1] / sp] : [0, 1];
  tube(D, x, y, 6, 0.04, gz, 0.035, gz + 4.2, [0.2, 0.18, 0.16], MAT.GLOSS);
  const col = (x < 0) === (y < 20) ? [0.14, 0.2, 0.5] : [0.78, 0.16, 0.1], len = 0.75, hang = clamp(sp / 3, 0.15, 1);
  const NX = 6, NZ = 6, P = (i, j) => {
    const u = i / NX, zz = gz + 1.2 + (j / NZ) * 2.8, flap = Math.sin(time * (3 + sp * 1.5) - u * 5 + j * 0.4) * 0.12 * u * (0.3 + hang);
    const ex = dir[0] * len * u * hang + (-dir[1]) * flap, ey = dir[1] * len * u * hang + dir[0] * flap;
    return [x + ex, y + ey, zz - u * (1 - hang) * 0.5];
  };
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const c = j === NZ - 2 || j === NZ - 3 ? [0.95, 0.92, 0.85] : col;
    D.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), c, MAT.FOLIAGE);
  }
}
function buildDynamic(td) {
  D.reset(); Sh.reset(); A.reset(); RF.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const night = td.night > 0.6;
  for (const b of BANNERS) drawBanner(b);
  for (const t of G.targets) t.type === "mato" ? drawMato(t, night) : drawGong(t);
  for (const l of G.lanterns) { drawLantern(l, night); reflect(l.p, [l.col[0] * 0.5, l.col[1] * 0.4, l.col[2] * 0.25], 1.0); }
  for (const s of G.stuck) drawArrow(D, add(s.p, s.dir, -0.55), s.dir, 1.0);
  const a = G.arrow;
  if (a) {
    const dir = nrm(a.v); drawArrow(D, add(a.p, dir, -1.0), dir, 1.0);
    for (let i = 1; i < a.trail.length; i++) { const k = i / a.trail.length; streak(A, a.trail[i - 1], a.trail[i], 0.012, [0.35 * k, 0.3 * k, 0.25 * k], cam.E); }
  }
  if (night || td.night > 0.2) for (const [x, y] of TORO) { const z = groundH(x, y) + 1.18; A.sprite(x, y, z, 0.5, 0.55 * td.night, 0.32 * td.night, 0.12 * td.night); reflect([x, y, z], [0.3 * td.night, 0.18 * td.night, 0.06 * td.night], 0.5); }
  amb.draw(D, A, td.night, time);
  fx.draw(A, D, cam.E);
  for (const q of fx.p) if (q.size > 0.3 && q.life > 0.2) reflect(q.x, q.col.map((v) => v * 0.15 * (q.life / q.max)), 0.4);
  // aim guide
  const guide = save.guide === "on" || (save.guide === "auto" && G.S.guide);
  if (G.state === "aim" && !G.arrow && guide && G.nock >= 1) {
    const [y, p] = aimNow(), pts = predict(add(eye(), aimDir(y, p), 0.35), y, p, Math.max(0.35, G.draw || 1), G.wind, 45, 0.03);
    const lim = G.S.guide === "near" && save.guide === "auto" ? Math.floor(pts.length * 0.45) : pts.length;
    for (let i = 3; i < lim; i += 2) { const k = 0.5 * (1 - i / pts.length); A.sprite(pts[i][0], pts[i][1], pts[i][2], 0.05, 0.9 * k, 0.75 * k, 0.4 * k); }
  }
  // first-person bow
  if (G.state === "aim" && G.camMode === "bow") { const [y, p] = aimNow(); drawBow(D, cam.E, basis(y, p), G.draw, G.spin, !G.arrow && G.nock > 0.5, time); }
  const oD = 6; dyn.append(D); const oSh = dyn.n; dyn.append(Sh); const oA = dyn.n; dyn.append(A); const oR = dyn.n; dyn.append(RF);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oSh - oD, oSh, nSh: oA - oSh, oA, nA: oR - oA, oR, nR: dyn.n - oR };
}
// lantern / firework reflections in the pond: a mirrored sprite, kept only if its sight line meets the water
function reflect(p, col, size) {
  const m = [p[0], p[1], -p[2] + 0.06], E = cam.E, t = (E[2] - 0.03) / (E[2] - m[2]);
  if (t <= 0 || t >= 1) return;
  const q = [E[0] + (m[0] - E[0]) * t, E[1] + (m[1] - E[1]) * t];
  if (((q[0] - POND.x) / (POND.rx * 0.95)) ** 2 + ((q[1] - POND.y) / (POND.ry * 0.95)) ** 2 > 1) return;
  RF.sprite(m[0], m[1], m[2], size, col[0], col[1], col[2]);
}

// ------------------------------------------------------------------ lights
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights(td) {
  const L = [];
  for (const l of fx.lights) L.push({ p: l.p, c: l.col, k: l.k * (l.life / l.max), pri: 3 });
  if (td.night > 0.2) {
    for (const l of G.lanterns) L.push({ p: l.p, c: [1, 0.6, 0.3], k: 1.4 * td.night, pri: 2 });
    for (const t of G.targets) if (td.night > 0.6) L.push(t.type === "mato" ? { p: add(t.p, matoBasis(t).n, 1.0), c: [1, 0.7, 0.4], k: 1.2, pri: 1.5 } : { p: add(gongDisc(t).c, [0, -1.6, 0.4]), c: [1, 0.72, 0.42], k: 2.2, pri: 1.6 });
    for (const [x, y] of TORO) L.push({ p: [x, y, groundH(x, y) + 1.2], c: [1, 0.55, 0.25], k: 0.9 * td.night * (0.9 + Math.sin(time * 11 + x) * 0.1), pri: 1 - Math.hypot(x, y) * 0.01 });
  }
  L.sort((a, b) => b.pri - a.pri);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}

function render(dt) {
  updateCamera(dt);
  const td = todAt(G.tod);
  const o = buildDynamic(td);
  const nL = collectLights(td);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time);
  gl.uniform3fv(U.uSunDir, td.sun); gl.uniform3fv(U.uSunCol, td.sc); gl.uniform3fv(U.uSkyTop, td.top); gl.uniform3fv(U.uSkyHor, td.hor); gl.uniform3fv(U.uSkyGlow, td.glow);
  gl.uniform3fv(U.uAmbTop, td.at); gl.uniform3fv(U.uAmbBot, td.ab); gl.uniform1f(U.uNight, td.night); gl.uniform3fv(U.uMoonDir, nrm([0.45, 0.8, 0.4]));
  gl.uniform2f(U.uWind, G.wind[0], G.wind[1]);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  space.bind(false); space.draw(0, nO);
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
  space.bind(false); space.draw(nO, nSh);
  space.bind(true); space.draw(o.oSh, o.nSh);
  gl.blendFunc(gl.ONE, gl.ONE);
  space.bind(false); space.draw(nO + nSh, nA);
  space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.DEPTH_TEST); space.draw(o.oR, o.nR); gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: fx.flash });
}

// ------------------------------------------------------------------ UI
let popT = 0;
function pop(t, s) { $("pop-t").textContent = t; $("pop-s").textContent = s; $("pop").classList.add("show"); popT = 1.4; }
const ui = {
  show(w) { $("title").classList.toggle("hidden", w !== "title"); $("stages").classList.toggle("hidden", w !== "stages"); $("hud").classList.toggle("hidden", w !== "hud"); },
  hud() {
    $("h-num").textContent = `STAGE ${G.stage + 1}`; $("h-name").textContent = G.S.name; $("h-pts").textContent = G.score;
    const m = [1, 1.25, 1.5, 2][Math.min(3, G.combo)];
    $("h-combo").textContent = `×${m} COMBO`; $("h-combo").classList.toggle("on", G.combo > 0 && m > 1);
  },
  quiver() { $("quiver").innerHTML = Array.from({ length: G.S.arrows }, (_, i) => `<i class="${i >= G.arrowsLeft ? "used" : ""}"></i>`).join("") + `<span>${G.arrowsLeft}</span>`; },
  frame() {
    if (G.state === "aim") {
      const arc = 2 * Math.PI * 22 * G.draw; $("r-arc").setAttribute("stroke-dasharray", `${arc} 200`);
      $("r-arc").setAttribute("stroke", G.draw >= 1 ? (G.holdT > 2.5 ? "#ff8a6a" : "#ffe8a0") : "#ffd58a");
      $("reticle").style.opacity = G.camMode === "bow" ? 1 : 0;
      $("breath").style.opacity = G.drawing ? 1 : 0; $("breath-i").style.width = G.breath * 100 + "%";
      const rel = Math.atan2(G.wind[0], G.wind[1]) - G.yaw;
      $("w-arrow").setAttribute("transform", `rotate(${(rel * 180) / Math.PI})`);
      $("w-spd").textContent = Math.hypot(G.wind[0], G.wind[1]).toFixed(1);
    }
    if (popT > 0) { popT -= 1 / 60; if (popT <= 0) $("pop").classList.remove("show"); }
  },
  title() {
    const total = Object.values(save.stars).reduce((a, b) => a + b, 0);
    $("t-foot").textContent = `★ ${total} / ${STAGES.length * 3}  ·  WASD or mouse to aim · hold to draw · Shift holds your breath`;
  },
  stages() {
    const art = (tod) => { const t = todAt(tod), c = (v) => `rgb(${v.map((x) => Math.round(Math.min(1, x) * 255)).join(",")})`; return `linear-gradient(180deg, ${c(t.top)} 0%, ${c(t.hor)} 70%, ${c(t.ab.map((v) => v * 1.4))} 100%)`; };
    $("grid").innerHTML = STAGES.map((s, i) => {
      const lock = i > save.unlocked, st = save.stars[i] || 0;
      return `<button class="card" data-i="${i}" ${lock ? "disabled" : ""} style="--art:${art(s.tod)}"><span class="num">${["一", "二", "三", "四", "五", "六"][i]}</span>${lock ? '<span class="lock">🔒</span>' : ""}<b>${s.name}</b><span class="best">${save.best[i] ? "best " + save.best[i] : s.arrows + " arrows"}</span><span class="st">${[0, 1, 2].map((k) => (k < st ? "<i>★</i>" : "★")).join("")}</span></button>`;
    }).join("");
    $("grid").querySelectorAll(".card").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); startStage(+b.dataset.i); }));
  },
};
function finish() {
  G.state = "done"; document.exitPointerLock?.();
  const S = G.S, stars = S.stars.filter((v) => G.score >= v).length;
  const isBest = !save.best[G.stage] || G.score > save.best[G.stage];
  save.best[G.stage] = Math.max(save.best[G.stage] || 0, G.score); save.stars[G.stage] = Math.max(save.stars[G.stage] || 0, stars);
  if (stars > 0) save.unlocked = Math.max(save.unlocked, Math.min(STAGES.length - 1, G.stage + 1)); persist();
  $("d-k").textContent = stars ? "Stage complete" : "Out of arrows"; $("d-t").textContent = S.name;
  $("d-score").textContent = G.score + (isBest && G.score > 0 ? "  · new best" : ""); $("d-hits").textContent = `${G.hits} / ${G.shots}`; $("d-combo").textContent = G.bestCombo; $("d-best").textContent = save.best[G.stage];
  $("d-next").classList.toggle("hidden", G.stage >= STAGES.length - 1 || stars === 0);
  for (let i = 0; i < 3; i++) $("s" + i).classList.remove("on");
  $("m-done").classList.remove("hidden");
  for (let i = 0; i < stars; i++) setTimeout(() => { $("s" + i).classList.add("on"); audio.star(i); }, 500 + i * 400);
}
function pause() { G.state = "paused"; document.exitPointerLock?.(); $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = "aim"; }
function toTitle() { for (const m of ["m-pause", "m-done", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; G.targets = []; G.lanterns = []; G.stuck = []; G.arrow = null; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.click(); startStage(Math.min(save.unlocked, STAGES.length - 1)); };
$("t-stages").onclick = () => { audio.init(); audio.click(); G.state = "stages"; ui.stages(); ui.show("stages"); };
$("s-back").onclick = () => { G.state = "title"; ui.show("title"); ui.title(); };
$("b-pause").onclick = () => pause();
$("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startStage(G.stage); }; $("p-title").onclick = toTitle;
$("d-retry").onclick = () => { $("m-done").classList.add("hidden"); startStage(G.stage); };
$("d-stages").onclick = () => { $("m-done").classList.add("hidden"); G.state = "stages"; G.targets = []; ui.stages(); ui.show("stages"); };
$("d-next").onclick = () => { $("m-done").classList.add("hidden"); startStage(G.stage + 1); };
function openSettings() {
  $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-sens").value = save.sens * 100;
  for (const [id, v] of [["st-guide", save.guide], ["st-cam", save.arrowCam ? "1" : "0"], ["st-inv", save.invert ? "1" : "0"]]) $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("m-set").classList.remove("hidden");
}
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-sens").oninput = (e) => { save.sens = e.target.value / 100; persist(); };
for (const [id, key, conv] of [["st-guide", "guide", (v) => v], ["st-cam", "arrowCam", (v) => v === "1"], ["st-inv", "invert", (v) => v === "1"]])
  $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save[key] = conv(b.dataset.v); persist(); $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ aiming bot (?auto) for testing and attract mode
const bot = Q.has("auto") ? { aim: null, tgt: null, wait: 0.6 } : null;
function botStep(dt) {
  if (G.state !== "aim" || G.arrow || G.nock < 1 || G.arrowsLeft <= 0) return;
  if (!bot.tgt || bot.tgt.gone) {
    bot.tgt = G.lanterns.filter((l) => l.p[2] < 22 && !l.hit).sort((a, b) => a.p[2] - b.p[2])[0] || G.targets[G.shots % G.targets.length];
    bot.wait = 0.4;
  }
  {
    // predicted intercept: time left to finish the draw + flight time
    const E = add(eye(), [0, 0, -0.06]), t = bot.tgt, left = (G.drawing ? (1 - G.draw) * 1.1 : 1.1 + Math.max(0, bot.wait)) + 0.05;
    let P;
    if (t.rise !== undefined) { const tf = left + Math.hypot(t.p[0], t.p[1]) / 50; P = [t.p[0] + G.wind[0] * 0.3 * tf, t.p[1] + G.wind[1] * 0.3 * tf, t.p[2] + t.rise * tf]; }
    else if (t.type === "gong") P = gongDisc(t).c;
    else { const tf = left + Math.hypot(t.p[0], t.p[1]) / 50; P = t.slide ? [t.base[0] + Math.sin(((G.t + tf) / t.slide[1]) * TAU + t.ph) * t.slide[0], t.p[1], t.p[2]] : t.p.slice(); }
    bot.aim = solveAim(E, P, G.wind, 1);
  }
  G.yaw += (bot.aim.yaw - G.yaw) * Math.min(1, dt * 8); G.pitch += (bot.aim.pitch - G.pitch) * Math.min(1, dt * 8);
  if (!G.drawing) { bot.wait -= dt; if (bot.wait <= 0) beginDraw(); }
  else if (G.draw >= 1 && Math.abs(bot.aim.yaw - G.yaw) < 0.0015 && Math.abs(bot.aim.pitch - G.pitch) < 0.0015) { G.holdingBreath = true; endDraw(); G.holdingBreath = false; bot.tgt = null; }
}

// ------------------------------------------------------------------ boot
window.__fw = () => { for (let k = 0; k < 3; k++) fx.firework([(Math.random() - 0.5) * 40, 60 + Math.random() * 25, 4], k); };
window.__bow = () => ({ state: G.state, stage: G.stage + 1, score: G.score, arrows: G.arrowsLeft, hits: G.hits, shots: G.shots, combo: G.combo, wind: G.wind.map((v) => +v.toFixed(2)), lanterns: G.lanterns.length, cam: G.camMode, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (G.state !== "paused") update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); G.state = "title"; ui.show("title"); ui.title();
  if (Q.has("stage")) startStage(clamp(+Q.get("stage") - 1, 0, STAGES.length - 1)); else if (Q.has("auto")) startStage(0);
}, 500);
