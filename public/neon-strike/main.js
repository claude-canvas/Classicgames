// NEON STRIKE — synthwave ten-pin bowling. Rendered with the projection3d library (Space, via GameSpace) + custom
// shaders + bloom. See DESIGN.md. physics.js moves the ball and pins, scoring.js keeps the sheet, cpu.js (in a
// worker) is the CPU bowler, scene.js builds the alley; this file runs the game, input, camera, sign and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp } from "./mesh.js";
import { DT, HEAD_Y, PIT_Y, LANE_HALF, BALL_R, SPOTS, step, settled, rack, makeBall } from "./physics.js";
import { totals, marks, frameDone, score } from "./scoring.js";
import { layout } from "./font.js";
import { buildScene, buildPin, buildBall, LIGHTS, MASK_Y, NEON } from "./scene.js";

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
const DEF = { best: 0, games: 0, strikes: 0, volume: 0.8, music: 0.6, preview: "short", skill: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("neonstrike.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("neonstrike.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world
const stat = new Mesh(400000), seg = {};
{
  const O = new Mesh(200000), R = new Mesh(150000), L = new Mesh(200), A = new Mesh(400), Sh = new Mesh(100);
  buildScene(O, R, L, A, Sh);
  const mir = (src) => { const m = new Mesh(src.n + 8); m.append(src); for (let i = 0; i < m.n; i++) m.pos[i * 4 + 2] = -m.pos[i * 4 + 2]; return m; };
  for (const [k, m] of [["R", mir(R)], ["L", L], ["O", O], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
}
const PIN_T = buildPin(16);
const BALLS = [buildBall(BALL_R, [0.45, 0.1, 0.85], [0.1, 0.85, 0.95]), buildBall(BALL_R, [0.95, 0.25, 0.4], [1.0, 0.75, 0.2])];

// ------------------------------------------------------------------ game state
const G = {
  state: "loading", players: [], pi: 0, fi: 0, roll: 0, pins: rack(), ball: null, standingAtStart: 10, aimX: 0.22, angle: 0, hook: 0.6,
  timeScale: 1, slowT: 0, slowDone: false, settleT: 0, sweepT: 0, freshRack: true, sign: { text: "NEON STRIKE", t: 0, kind: "idle" }, lastSpeed: 0, meter: 0, meterDir: 1, charging: false,
  sparks: [], cpu: null, events: [], acc: 0, rollT: 0,
};
let time = 0;
function startGame(mode) {
  G.players = mode === "cpu" ? [{ name: "YOU", frames: [], cpu: false, ball: 0 }, { name: "CPU", frames: [], cpu: true, ball: 1, skill: save.skill }] : [{ name: "YOU", frames: [], cpu: false, ball: 0 }];
  if (bot) G.players[0].cpu = true, G.players[0].skill = 2;
  G.pi = 0; G.fi = 0; G.roll = 0; ui.show("hud"); newRack(); beginRoll(); ui.sheet();
  setSign(G.players.length > 1 ? "YOUR TURN" : "NEON STRIKE", "idle");
}
const cur = () => G.players[G.pi];
function newRack() { G.pins = rack(); G.freshRack = true; }
function beginRoll() {
  G.ball = null; G.timeScale = 1; G.slowDone = false; G.charging = false; G.meter = 0;
  G.standingAtStart = G.pins.filter((p) => !p.down).length;
  const p = cur();
  if (p.cpu) { G.state = "cpu"; cpuThink(); } else { G.state = "aim"; }
  ui.prompt(); ui.sheet();
}
function release(x, angle, speed, hook) {
  G.ball = makeBall(x, angle, speed, hook); G.lastSpeed = speed; G.state = "roll"; G.rollT = 0; G.acc = 0;
  audio.click(); ui.prompt();
  $("spd").textContent = `${(speed * 3.6).toFixed(1)} km/h`; $("spd").classList.add("show");
}
function finishRoll() {
  const standing = G.pins.filter((p) => !p.down);
  const knocked = G.standingAtStart - standing.length;
  const P = cur(), f = (P.frames[G.fi] ||= []);
  f.push(knocked);
  const firstOfRack = G.freshRack;
  // sign + sounds
  if (standing.length === 0 && firstOfRack) { setSign("STRIKE!", "strike"); audio.cheer(true); burst(30); P.strikes = (P.strikes || 0) + 1; if (!P.cpu) { save.strikes++; persist(); } }
  else if (standing.length === 0) { setSign("SPARE!", "spare"); audio.cheer(false); burst(16); }
  else if (knocked === 0 && G.ball && G.ball.gutter) { setSign("GUTTER", "gutter"); audio.gutter(); }
  else if (firstOfRack && isSplit(standing)) { setSign("SPLIT", "split"); }
  else setSign(String(knocked), "count");
  ui.sheet();
  // what next: more rolls in this frame?
  const done = frameDone(P.frames, G.fi);
  G.after = { done, clearAll: standing.length === 0 || done };
  G.state = "sweep"; G.sweepT = 0; audio.sweep();
}
function afterSweep() {
  const P = cur();
  if (G.after.done) {
    // next player / next frame
    let next = G.pi + 1, fi = G.fi;
    if (next >= G.players.length) { next = 0; fi++; }
    if (fi >= 10) return finishGame();
    G.pi = next; G.fi = fi; newRack();
    if (G.players.length > 1) setSign(cur().cpu ? "CPU" : "YOUR TURN", "idle");
  } else {
    // keep the standing pins re-stood where they are; a fresh rack after a strike/spare in the 10th
    if (G.after.clearAll) newRack();
    else { G.pins = G.pins.filter((p) => !p.down); for (const p of G.pins) { p.th = 0; p.thv = 0; p.vx = p.vy = 0; } G.freshRack = false; }
  }
  beginRoll();
}
function isSplit(standing) {
  if (standing.some((p) => p.id === 0)) return false;
  const cols = [...new Set(standing.map((p) => Math.round(SPOTS[p.id][0] / 0.1524)))].sort((a, b) => a - b);
  for (let i = 1; i < cols.length; i++) if (cols[i] - cols[i - 1] >= 2) return true;
  return false;
}
function finishGame() {
  G.state = "done";
  const you = G.players[0], s = score(you.frames), isBest = s > save.best;
  save.best = Math.max(save.best, s); save.games++; persist();
  let head = "Game over";
  if (G.players.length > 1) { const c = score(G.players[1].frames); head = s > c ? "You win!" : s < c ? "CPU wins" : "A tie!"; $("r-vs").textContent = `CPU ${c}`; } else $("r-vs").textContent = "";
  $("r-k").textContent = head; $("r-score").textContent = s; $("r-best").textContent = isBest ? "New best!" : `Best ${save.best}`;
  $("r-stats").textContent = `${you.strikes || 0} strikes · ${you.frames.filter((f, i) => i < 9 && f.length === 2 && f[0] + f[1] === 10).length} spares`;
  $("m-done").classList.remove("hidden"); audio.cheer(s >= 150);
  setSign(String(s), "strike");
}

// ------------------------------------------------------------------ CPU
let worker = null, reqId = 0;
try { worker = new Worker(new URL("./cpuworker.js", import.meta.url), { type: "module" }); worker.onmessage = (e) => { if (G.cpu && e.data.id === G.cpu.id) G.cpu.shot = e.data.shot; }; } catch { worker = null; }
function cpuThink() {
  const id = ++reqId, standing = G.freshRack ? null : G.pins.filter((p) => !p.down).map((p) => ({ id: p.id, x: p.x, y: p.y }));
  G.cpu = { id, shot: null, t: 0 };
  const skill = cur().skill ?? 1;
  if (worker) worker.postMessage({ id, standing, skill });
  else import("./cpu.js").then((m) => { if (G.cpu && G.cpu.id === id) G.cpu.shot = m.plan(standing, skill); });
}
function cpuStep(dt) {
  const c = G.cpu; c.t += dt;
  if (!c.shot) return;
  G.aimX = lerp(G.aimX, c.shot.x, Math.min(1, dt * 3)); G.hook = c.shot.hook; G.angle = c.shot.angle;
  if (c.t > 1.4 && Math.abs(G.aimX - c.shot.x) < 0.01) { const s = c.shot; G.cpu = null; release(s.x, s.angle, s.speed, s.hook); }
}

// ------------------------------------------------------------------ input: swipe to throw, drag the strip to position
const input = { keys: new Set(), swipe: null };
canvas.addEventListener("pointerdown", (e) => {
  audio.init();
  if (G.state !== "aim") return;
  const strip = e.clientY > innerHeight * 0.8;
  input.swipe = { id: e.pointerId, strip, pts: [[e.clientX, e.clientY, performance.now()]], x0: G.aimX };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const s = input.swipe; if (!s || s.id !== e.pointerId) return;
  s.pts.push([e.clientX, e.clientY, performance.now()]);
  if (s.strip) G.aimX = clamp(s.x0 + ((e.clientX - s.pts[0][0]) / innerWidth) * 1.4, -0.45, 0.45);
  else { const sh = swipeShot(s); if (sh) { G.angle = sh.angle; G.hook = sh.hook; } }
});
canvas.addEventListener("pointerup", (e) => {
  const s = input.swipe; if (!s || s.id !== e.pointerId) return; input.swipe = null;
  if (s.strip || G.state !== "aim") return;
  const sh = swipeShot(s); if (sh) release(G.aimX, sh.angle, sh.speed, sh.hook);
});
function swipeShot(s) {
  const p = s.pts, a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (dy > -60 || len < 60) return null;
  // speed from the last part of the swipe
  let k = p.length - 1; while (k > 0 && b[2] - p[k][2] < 120) k--;
  const dist = Math.hypot(b[0] - p[k][0], b[1] - p[k][1]), dtm = Math.max(16, b[2] - p[k][2]), pxps = (dist / dtm) * 1000;
  const speed = clamp(5.5 + ((pxps - 500) / 2600) * 4.5, 5.5, 10);
  const angle = clamp(Math.atan2(dx, -dy) * 0.06, -0.045, 0.045);
  // hook: signed bulge of the path to the right of the chord → the ball curves back left
  let dev = 0; for (const q of p) { const c = ((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / len; if (Math.abs(c) > Math.abs(dev)) dev = c; }
  const hook = clamp(-dev / (len * 0.22), -1, 1);
  return { speed, angle, hook };
}
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if (e.code === "Space" && !e.repeat && G.state === "aim") { G.charging = true; G.meter = 0; G.meterDir = 1; e.preventDefault(); }
  if (e.code === "KeyQ" && G.state === "aim") G.hook = clamp(G.hook - 0.1, -1, 1);
  if (e.code === "KeyE" && G.state === "aim") G.hook = clamp(G.hook + 0.1, -1, 1);
  if (e.code === "Escape" || e.code === "KeyP") { if (["aim", "roll", "cpu", "sweep"].includes(G.state)) pause(); else if (G.state === "paused") resume(); }
});
addEventListener("keyup", (e) => {
  input.keys.delete(e.code);
  if (e.code === "Space" && G.charging && G.state === "aim") { G.charging = false; release(G.aimX, G.angle, 5.5 + G.meter * 4.5, G.hook); }
});

// ------------------------------------------------------------------ update
function burst(n) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 1 + Math.random() * 3; G.sparks.push({ x: (Math.random() - 0.5) * 0.8, y: HEAD_Y + Math.random() * 0.8, z: 0.2, vx: Math.cos(a) * v * 0.4, vy: Math.sin(a) * v * 0.3, vz: 2 + Math.random() * 3, life: 1.2, col: NEON[i % 4] }); } }
function update(dt) {
  time += dt;
  const k = input.keys;
  if (G.state === "aim") {
    if (k.has("KeyA") || k.has("ArrowLeft")) G.aimX = clamp(G.aimX - dt * 0.5, -0.45, 0.45);
    if (k.has("KeyD") || k.has("ArrowRight")) G.aimX = clamp(G.aimX + dt * 0.5, -0.45, 0.45);
    if (k.has("KeyW") || k.has("ArrowUp")) G.angle = clamp(G.angle - dt * 0.012, -0.045, 0.045);
    if (k.has("KeyS") || k.has("ArrowDown")) G.angle = clamp(G.angle + dt * 0.012, -0.045, 0.045);
    if (G.charging) { G.meter += G.meterDir * dt / 1.3; if (G.meter > 1) { G.meter = 1; G.meterDir = -1; } if (G.meter < 0) { G.meter = 0; G.meterDir = 1; } }
  }
  if (G.state === "cpu" && G.cpu) cpuStep(dt);
  if (G.state === "roll") {
    const b = G.ball;
    // slow motion as the ball meets the rack
    if (!G.slowDone && !b.gutter && b.y > HEAD_Y - 0.55) { G.slowDone = true; G.slowT = 0.9; audio.boom(); }
    if (G.slowT > 0) { G.slowT -= dt; G.timeScale = lerp(G.timeScale, 0.3, Math.min(1, dt * 12)); } else G.timeScale = lerp(G.timeScale, 1, Math.min(1, dt * 4));
    G.acc += dt * G.timeScale; G.rollT += dt * G.timeScale;
    const ev = G.events; ev.length = 0;
    while (G.acc >= DT) { step(b, G.pins, DT, ev); G.acc -= DT; }
    for (const e of ev) {
      if (e.type === "hit") { audio.knock(Math.min(4, e.s), G.timeScale < 0.6 ? 1.8 : 1); if (e.s > 1.2 && G.sparks.length < 200) for (let i = 0; i < 3; i++) G.sparks.push({ x: e.x, y: e.y, z: 0.15 + Math.random() * 0.2, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: 1 + Math.random() * 2, life: 0.5, col: NEON[Math.floor(Math.random() * 4)] }); }
      if (e.type === "thud") audio.knock(e.s * 0.5, 1.4);
      if (e.type === "gutter") { setSign("GUTTER", "gutter"); }
    }
    audio.roll(b.out ? 0 : Math.hypot(b.vx, b.vy) * (b.gutter ? 0.5 : 1));
    if ((b.out && settled(b, G.pins)) || G.rollT > 7) { audio.roll(0); finishRoll(); }
  }
  if (G.state === "sweep") { G.sweepT += dt; if (G.sweepT > 1.7) afterSweep(); }
  for (const s of G.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 6 * dt; s.life -= dt; if (s.z < 0) { s.z = 0; s.vz *= -0.4; } }
  G.sparks = G.sparks.filter((s) => s.life > 0);
  G.sign.t += dt;
  ui.frame(dt);
}

// ------------------------------------------------------------------ camera
const cam = { E: [0, -3, 1.3], T: [0, 18, 0.2], mag: 2.2 };
function updateCamera(dt) {
  let E, T, mag = 2.2, k = Math.min(1, dt * 3);
  const b = G.ball;
  if (G.state === "title" || G.state === "loading") { const a = time * 0.1; E = [Math.sin(a) * 1.2, -4 + Math.sin(a * 0.7) * 0.5, 1.6]; T = [0, 14, 0.7]; mag = 1.9; }
  else if (G.state === "roll" && b && !b.out && b.y < HEAD_Y - 3.2) { E = [b.x * 0.6, b.y - 2.6, 0.75]; T = [b.x * 0.3, b.y + 7, 0.05]; mag = 2.0; k = Math.min(1, dt * 6); }
  else if (G.state === "roll" || G.state === "sweep" || (G.state === "done")) { E = [0.15, HEAD_Y - 3.0, 1.15]; T = [0, HEAD_Y + 0.55, 0.12]; mag = 2.4 + (G.timeScale < 0.6 ? 0.5 : 0); k = Math.min(1, dt * 3); }
  else { E = [G.aimX * 0.6, -3.2, 0.92]; T = [G.aimX * 0.25, HEAD_Y - 4, -0.9]; mag = 1.85; }
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k)); cam.mag = lerp(cam.mag, mag, k);
  space.magnifier = cam.mag * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(80000), DM = new Mesh(80000), Sh = new Mesh(2000), A = new Mesh(40000), dyn = new Mesh(220000);
function putPin(p, lift, alpha) {
  if (alpha <= 0) return;
  const c = Math.cos(p.rot), s = Math.sin(p.rot), th = Math.min(p.th, Math.PI / 2), ct = Math.cos(th), st = Math.sin(th);
  // tilt: rotate about the axis (−dy, dx, 0) so the pin's top leans toward (dx, dy)
  const ax = -p.dy, ay = p.dx, z0 = (p.out ? -0.3 : 0) + lift + st * 0.055;
  const T = PIN_T;
  for (let i = 0; i < T.n; i++) {
    const o = i * 4; let x = T.pos[o] * c - T.pos[o + 1] * s, y = T.pos[o] * s + T.pos[o + 1] * c, z = T.pos[o + 2];
    // Rodrigues about (ax, ay, 0)
    const d = ax * x + ay * y, cx = ay * z, cy = -ax * z, cz = ax * y - ay * x;
    const rx = x * ct + cx * st + ax * d * (1 - ct), ry = y * ct + cy * st + ay * d * (1 - ct), rz = z * ct + cz * st;
    const wx = p.x + rx, wy = p.y + ry, wz = z0 + rz;
    D.v(wx, wy, wz, 1, T.col[o], T.col[o + 1], T.col[o + 2], T.col[o + 3]);
    DM.v(wx, wy, -wz, 1, T.col[o], T.col[o + 1], T.col[o + 2], T.col[o + 3]);
  }
  shadowQ(p.x, p.y, 0.1, 0.45 * alpha);
}
function shadowQ(x, y, r, k) {
  Sh.v(x - r, y - r, 0.002, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, 0.002, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, 0.002, 3, k, 0, 0, MAT.SHADOW);
  Sh.v(x - r, y - r, 0.002, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, 0.002, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, 0.002, 1, k, 0, 0, MAT.SHADOW);
}
function putBall(x, y, z, rollA, dirX, dirY, model) {
  // rolling: rotate about the horizontal axis perpendicular to travel
  const ax = dirY, ay = -dirX, ct = Math.cos(rollA), st = Math.sin(rollA), T = model;
  for (let i = 0; i < T.n; i++) {
    const o = i * 4, px = T.pos[o], py = T.pos[o + 1], pz = T.pos[o + 2];
    const d = ax * px + ay * py, cx = ay * pz, cy = -ax * pz, cz = ax * py - ay * px;
    const rx = px * ct + cx * st + ax * d * (1 - ct), ry = py * ct + cy * st + ay * d * (1 - ct), rz = pz * ct + cz * st;
    D.v(x + rx, y + ry, z + rz, 1, T.col[o], T.col[o + 1], T.col[o + 2], T.col[o + 3]);
    DM.v(x + rx, y + ry, -(z + rz), 1, T.col[o], T.col[o + 1], T.col[o + 2], T.col[o + 3]);
  }
  shadowQ(x, y, 0.16, 0.6);
}
function tubeLine(p0, p1, w, col) {
  // a flat neon stroke facing −y (toward the bowler)
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * w, nz = (dx / l) * w;
  A.quad([p0[0] - nx, p0[1], p0[2] - nz], [p0[0] + nx, p0[1], p0[2] + nz], [p1[0] + nx, p1[1], p1[2] + nz], [p1[0] - nx, p1[1], p1[2] - nz], col, MAT.ADD);
}
const SIGN_COL = { idle: [0.3, 0.9, 1.0], strike: null, spare: [1.0, 0.3, 0.9], split: [1.0, 0.6, 0.15], gutter: [1.0, 0.25, 0.2], count: [0.5, 0.4, 1.0] };
let signCache = { text: "", lines: [] };
function setSign(text, kind) { G.sign = { text, kind, t: 0 }; }
function drawSign() {
  if (signCache.text !== G.sign.text) signCache = { text: G.sign.text, lines: layout(G.sign.text) };
  const sc = Math.min(0.05, 3.1 / Math.max(1, G.sign.text.length * 5.6)), cx = 0, cz = 2.4, y = MASK_Y - 0.03;
  const t = G.sign.t, kind = G.sign.kind;
  signCache.lines.forEach((line, li) => {
    // flicker on letter by letter
    const on = t * 14 - li * 0.6; if (on < 0) return;
    const fl = on < 1 ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
    let col = SIGN_COL[kind];
    if (!col) { const h = (time * 0.6 + li * 0.08) % 1; col = [0.5 + 0.5 * Math.cos(TAU * h), 0.5 + 0.5 * Math.cos(TAU * (h - 0.33)), 0.5 + 0.5 * Math.cos(TAU * (h - 0.66))]; }
    for (let i = 0; i < line.length - 1; i++) {
      const p0 = [cx + line[i][0] * sc, y, cz + line[i][1] * sc], p1 = [cx + line[i + 1][0] * sc, y, cz + line[i + 1][1] * sc];
      tubeLine(p0, p1, 0.012, col.map((v) => (0.6 + v * 1.2) * fl)); tubeLine(p0, p1, 0.05, col.map((v) => v * 0.16 * fl));
    }
  });
}
function buildDynamic() {
  D.reset(); DM.reset(); Sh.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  // pins (with the pinsetter animation)
  const sw = G.state === "sweep" ? G.sweepT : -1;
  for (const p of G.pins) {
    let lift = 0, alpha = 1;
    if (sw >= 0) {
      if (p.down) { alpha = Math.max(0, 1 - sw / 0.5); lift = -sw * 0.4; }
      else if (G.after && G.after.clearAll) { lift = sw < 0.6 ? 0 : -1; }
      else lift = sw < 0.3 ? 0 : sw < 0.7 ? (sw - 0.3) * 1.2 : sw < 1.2 ? 0.48 : Math.max(0, 0.48 - (sw - 1.2) * 1.2);
    }
    if (p.out && p.y > PIT_Y + 0.4) continue;
    if (lift > -0.9) putPin(p, lift, alpha);
  }
  // sweep bar
  if (sw >= 0) { const z = sw < 0.4 ? 0.9 - sw * 2.1 : sw < 1.3 ? 0.06 : 0.06 + (sw - 1.3) * 2.2; const y = HEAD_Y - 0.5 + (sw > 0.4 && sw < 1.3 ? (sw - 0.4) * 1.4 : 0); D.quad([-0.75, y, z], [0.75, y, z], [0.75, y, z + 0.08], [-0.75, y, z + 0.08], [0.15, 0.12, 0.22], MAT.GLOSS); D.quad([-0.75, y - 0.01, z + 0.06], [0.75, y - 0.01, z + 0.06], [0.75, y - 0.01, z + 0.08], [-0.75, y - 0.01, z + 0.08], [1.4, 0.3, 1.2], MAT.EMIT); }
  // new rack lowering
  // ball
  const P = G.players[G.pi], model = BALLS[P ? P.ball : 0];
  const b = G.ball;
  if (b && !b.out) {
    const sp = Math.hypot(b.vx, b.vy) || 1, z = b.gutter ? BALL_R - 0.07 : BALL_R;
    putBall(b.x, b.y, z, b.roll, b.vx / sp, b.vy / sp, model);
    for (let i = 1; i < 10; i++) { const k = (1 - i / 10) * 0.12; A.sprite(b.x - (b.vx / sp) * i * 0.12, b.y - (b.vy / sp) * i * 0.12, 0.05, 0.08, k * 0.6, k * 0.3, k); }
  } else if (G.state === "aim" || G.state === "cpu") {
    putBall(G.aimX, -0.35, BALL_R, time * 0.3, 0, 1, model);
    // aim guide: arrow on the lane + preview path
    const prev = save.preview;
    if (G.state === "aim" && prev !== "off") {
      const pb = makeBall(G.aimX, G.angle, 8, G.hook), lim = prev === "full" ? HEAD_Y : 8, ev = [];
      for (let t = 0; t < 3 && pb.y < lim && !pb.gutter; t += 0.02) { for (let k = 0; k < 12; k++) step(pb, [], DT, ev); const f = 1 - pb.y / (lim + 2); A.sprite(pb.x, pb.y, 0.01, 0.025, 0.2 * f, 0.6 * f, 0.9 * f); }
    }
    const k = 0.5 + 0.5 * Math.sin(time * 5);
    A.sprite(G.aimX, -0.35, 0.01, 0.18, 0.15 * k, 0.4 * k, 0.6 * k);
  }
  for (const s of G.sparks) { const k = s.life; A.sprite(s.x, s.y, s.z, 0.03, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
  drawSign();
  const oD = 6; dyn.append(D); const oM = dyn.n; dyn.append(DM); const oSh = dyn.n; dyn.append(Sh); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oM - oD, oM, nM: oSh - oM, oSh, nSh: oA - oSh, oA, nA: dyn.n - oA };
}

// ------------------------------------------------------------------ lights
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function setLights(pulse) {
  LIGHTS.forEach(([x, y, z, k, r, g, b], i) => { lightBuf.set([x, y, z, k * (i === 0 ? 1 + pulse * 1.5 : 1)], i * 4); lightColBuf.set([r, g, b], i * 3); });
  return LIGHTS.length;
}

function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), pulse = G.sign.kind === "strike" ? Math.max(0, 1 - G.sign.t * 0.7) * (0.5 + 0.5 * Math.sin(time * 14)) : 0, nL = setLights(pulse);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform1f(U.uPulse, pulse);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  // mirror world under the lane, then the lane blended over it
  S("R"); space.bind(true); space.draw(o.oM, o.nM);
  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); S("L"); gl.disable(gl.BLEND);
  S("O"); space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.bind(true); space.draw(o.oSh, o.nSh);
  gl.blendFunc(gl.ONE, gl.ONE); S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: pulse * 0.3 });
}

// ------------------------------------------------------------------ UI
const ui = {
  show(w) { $("title").classList.toggle("hidden", w !== "title"); $("hud").classList.toggle("hidden", w !== "hud"); },
  sheet() {
    $("sheet").innerHTML = G.players.map((P, pi) => {
      const tot = totals(P.frames);
      const cells = Array.from({ length: 10 }, (_, fi) => {
        const m = marks(P.frames[fi] || [], fi), n = fi === 9 ? 3 : 2;
        const boxes = Array.from({ length: n }, (_, k) => `<i>${m[k] ?? ""}</i>`).join("");
        return `<td class="${pi === G.pi && fi === G.fi && G.state !== "done" ? "cur" : ""} ${fi === 9 ? "tenth" : ""}"><div class="rolls">${boxes}</div><div class="tot">${tot[fi] ?? ""}</div></td>`;
      }).join("");
      return `<tr class="${pi === G.pi ? "me" : ""}"><th>${P.name}</th>${cells}<td class="sum">${score(P.frames)}</td></tr>`;
    }).join("");
  },
  prompt() {
    const p = $("prompt");
    if (G.state === "aim") p.innerHTML = "Drag the bottom strip to position · <b>swipe up</b> to bowl — curve your swipe to hook · or <kbd>A</kbd><kbd>D</kbd> <kbd>Q</kbd><kbd>E</kbd> + hold <kbd>Space</kbd>";
    else if (G.state === "cpu") p.innerHTML = "CPU is lining up…";
    else p.innerHTML = "";
    $("strip").classList.toggle("on", G.state === "aim");
  },
  frame() {
    $("meter").classList.toggle("on", G.charging); $("meter-i").style.width = G.meter * 100 + "%";
    $("hookv").textContent = G.state === "aim" || G.state === "cpu" ? `HOOK ${G.hook >= 0 ? "◀" : "▶"} ${Math.round(Math.abs(G.hook) * 100)}%` : "";
    if (G.state !== "roll" && G.state !== "sweep") $("spd").classList.remove("show");
  },
  title() { $("t-best").textContent = save.games ? `Best ${save.best} · ${save.games} games · ${save.strikes} strikes` : "Swipe to bowl · curve the swipe to hook"; $("t-skill").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === save.skill)); },
};
function pause() { G.prev = G.state; G.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = G.prev || "aim"; }
function toTitle() { for (const m of ["m-pause", "m-done", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; G.cpu = null; G.ball = null; G.pins = rack(); setSign("NEON STRIKE", "idle"); ui.show("title"); ui.title(); }
$("t-solo").onclick = () => { audio.init(); audio.click(); G.mode = "solo"; startGame("solo"); };
$("t-cpu").onclick = () => { audio.init(); audio.click(); G.mode = "cpu"; startGame("cpu"); };
$("t-skill").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.skill = +b.dataset.v; persist(); audio.init(); audio.click(); ui.title(); });
$("b-pause").onclick = () => pause();
$("p-resume").onclick = resume; $("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startGame(G.mode); }; $("p-title").onclick = toTitle;
$("r-again").onclick = () => { $("m-done").classList.add("hidden"); startGame(G.mode); }; $("r-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-prev").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === save.preview)); $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-prev").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.preview = b.dataset.v; persist(); $("st-prev").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ boot
const bot = Q.has("auto");
G.mode = Q.get("mode") || "solo";
window.__bowl = () => ({ state: G.state, frame: G.fi + 1, player: G.pi, roll: G.ball && { x: +G.ball.x.toFixed(2), y: +G.ball.y.toFixed(2) }, standing: G.pins.filter((p) => !p.down).map((p) => p.id + 1), sheets: G.players.map((p) => ({ frames: p.frames, score: score(p.frames) })), fps });
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
  if (bot || Q.has("play")) startGame(G.mode);
}, 400);
