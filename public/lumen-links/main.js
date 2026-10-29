// LUMEN LINKS — fairy-lit mini golf at dusk. Rendered with the projection3d library (Space, via GameSpace) + custom
// shaders + bloom. See DESIGN.md. physics.js rolls the ball, holes.js lays out the course, bot.js (in a worker)
// plays ?auto; this file runs the round, aiming, camera, moving obstacles and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, tube, limb, blob } from "./mesh.js";
import { HOLES } from "./holes.js";
import { makeBall, shoot, step, simulate, heightAt, wallsAt, BALL_R } from "./physics.js";
import { buildHole, drawCup, FAIRY, LANTERNS } from "./scene.js";

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
const DEF = { best: null, rounds: 0, aces: 0, volume: 0.8, music: 0.6, guide: true };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("lumenlinks.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("lumenlinks.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ hole state
const seg = {};
const R = { state: "loading", hi: 0, hole: HOLES[0], ball: null, strokes: 0, card: [], t: 0, aim: null, fly: 0, trail: [], splash: [], bumpT: new Map(), practice: false, holedT: 0, msg: null };
let time = 0;
function loadHole(i) {
  R.hi = i; const h = (R.hole = HOLES[i]);
  const O = new Mesh(200000), A = new Mesh(8000), W = new Mesh(2000), stat = new Mesh(220000);
  buildHole(O, A, W, h);
  for (const [k, m] of [["O", O], ["W", W], ["A", A]]) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
  R.ball = makeBall(h.tee[0], h.tee[1]); R.strokes = 0; R.trail = []; R.aim = null; R.fly = 0; R.holedT = 0;
  R.state = "flyover"; cam.yaw = Math.atan2(h.cup[0] - h.tee[0], h.cup[1] - h.tee[1]);
  ui.show("hud"); ui.hud(); audio.ui();
  $("h-name").textContent = h.name; $("h-num").textContent = `HOLE ${i + 1}`; $("h-par").textContent = `PAR ${h.par}`;
}
function startRound(practiceHole = null) {
  R.practice = practiceHole !== null; R.card = [];
  loadHole(practiceHole ?? 0);
}
function holed() {
  const s = R.strokes, d = s - R.hole.par, name = s === 1 ? "Hole in one!" : d <= -2 ? "Eagle!" : d === -1 ? "Birdie!" : d === 0 ? "Par" : d === 1 ? "Bogey" : d === 2 ? "Double bogey" : `+${d}`;
  pop(name, `${s} stroke${s > 1 ? "s" : ""}`); audio.cup(); if (d <= 0) setTimeout(() => audio.fanfare(true), 500);
  if (s === 1) { save.aces++; persist(); }
  R.card[R.hi] = s; R.state = "holed"; R.holedT = 0; ui.card();
  for (let i = 0; i < 40; i++) { const a = Math.random() * TAU; R.splash.push({ x: R.hole.cup[0], y: R.hole.cup[1], z: heightAt(R.hole, ...R.hole.cup) + 0.05, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, vz: 1 + Math.random() * 1.5, life: 1.2, col: [[1, 0.8, 0.4], [1, 0.5, 0.7], [0.6, 0.8, 1]][i % 3] }); }
}
function nextHole() {
  if (R.practice) { toTitle(); return; }
  if (R.hi + 1 >= HOLES.length) return finishRound();
  loadHole(R.hi + 1);
}
function finishRound() {
  R.state = "done";
  const total = R.card.reduce((a, b) => a + b, 0), par = HOLES.reduce((a, h) => a + h.par, 0), isBest = save.best === null || total < save.best;
  if (isBest) save.best = total; save.rounds++; persist();
  $("f-total").textContent = total; $("f-vs").textContent = total - par === 0 ? "Even par" : total - par > 0 ? `${total - par} over par` : `${par - total} under par`;
  $("f-best").textContent = isBest ? "New best round!" : `Best ${save.best}`;
  ui.card(); $("f-card").innerHTML = $("card").innerHTML; $("m-done").classList.remove("hidden"); audio.fanfare(total <= par);
}

// ------------------------------------------------------------------ input: drag back from the ball to aim; drag elsewhere to orbit
const input = { drag: null };
function screenOf(p) {
  const v = [p[0] - space.Xc, p[1] - space.Yc, p[2] - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
  const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
  return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}
function groundAt(cx, cy, z0) {
  const mag = space.magnifier, aspect = canvas.width / canvas.height, nx = (cx / innerWidth) * 2 - 1, ny = 1 - (cy / innerHeight) * 2;
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * (1.6 / mag) + Y[i] * ny * (1.6 / (mag * aspect)));
  const E = [space.Xc, space.Yc, space.Zc], t = (z0 - E[2]) / (d[2] || -1e-6);
  return t > 0 ? [E[0] + d[0] * t, E[1] + d[1] * t] : null;
}
canvas.addEventListener("pointerdown", (e) => {
  audio.init();
  const b = R.ball; if (!b) return;
  const bz = heightAt(R.hole, b.x, b.y), sp = screenOf([b.x, b.y, bz + BALL_R]);
  const nearBall = Math.hypot(e.clientX - sp[0], e.clientY - sp[1]) < Math.max(70, innerWidth * 0.06);
  if (R.state === "aim" && nearBall) input.drag = { id: e.pointerId, mode: "aim" };
  else input.drag = { id: e.pointerId, mode: "orbit", x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const d = input.drag; if (!d || d.id !== e.pointerId) return;
  if (d.mode === "orbit") { cam.yaw = d.yaw - (e.clientX - d.x) * 0.006; cam.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.004, 0.25, 1.35); return; }
  const b = R.ball, bz = heightAt(R.hole, b.x, b.y), g = groundAt(e.clientX, e.clientY, bz);
  if (!g) return;
  const dx = b.x - g[0], dy = b.y - g[1], L = Math.hypot(dx, dy);
  R.aim = { ang: Math.atan2(dx, dy), power: clamp(L / 1.4, 0, 1) };
});
canvas.addEventListener("pointerup", (e) => {
  const d = input.drag; input.drag = null; if (!d || d.mode !== "aim" || R.state !== "aim") return;
  if (R.aim && R.aim.power > 0.04) putt(R.aim.ang, R.aim.power);
  R.aim = null;
});
canvas.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 1.2, 9); e.preventDefault(); }, { passive: false });
addEventListener("keydown", (e) => {
  audio.init();
  if (R.state === "aim") {
    if (!R.aim) R.aim = { ang: cam.yaw, power: 0.4 };
    if (e.code === "ArrowLeft" || e.code === "KeyA") R.aim.ang -= 0.03; if (e.code === "ArrowRight" || e.code === "KeyD") R.aim.ang += 0.03;
    if (e.code === "ArrowUp" || e.code === "KeyW") R.aim.power = clamp(R.aim.power + 0.04, 0.02, 1); if (e.code === "ArrowDown" || e.code === "KeyS") R.aim.power = clamp(R.aim.power - 0.04, 0.02, 1);
    if (e.code === "Space" || e.code === "Enter") { putt(R.aim.ang, R.aim.power); R.aim = null; e.preventDefault(); }
  } else if (R.state === "flyover" && (e.code === "Space" || e.code === "Enter")) R.fly = 99;
  if (e.code === "Tab") { e.preventDefault(); $("m-card").classList.toggle("hidden"); ui.card(); }
  if (e.code === "Escape") toTitle();
});
const powerToSpeed = (p) => 0.4 + p * 4.8;
function putt(ang, power) {
  const b = R.ball; shoot(b, ang, powerToSpeed(power)); R.strokes++; R.state = "roll"; R.trail = []; audio.putt(power); ui.hud();
}

// ------------------------------------------------------------------ update
let worker = null, reqId = 0, botReq = null;
const bot = Q.has("auto");
if (bot) try { worker = new Worker(new URL("./botworker.js", import.meta.url), { type: "module" }); worker.onmessage = (e) => { if (botReq && e.data.id === botReq.id) botReq.shot = e.data.shot; }; } catch { }
const flies = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), ph: Math.random() * TAU }));
function update(dt) {
  time += dt; R.t += dt;
  const h = R.hole, b = R.ball;
  if (R.state === "flyover") { R.fly += dt; if (R.fly > 3.2) R.state = "aim"; }
  if (R.state === "aim" && bot && worker) {
    if (!botReq) { botReq = { id: ++reqId, shot: null, t0: time }; worker.postMessage({ id: botReq.id, hi: R.hi, x: b.x, y: b.y, t: R.t + 1.2 }); }
    else if (botReq.shot) { const s = botReq.shot; R.aim = { ang: s.ang, power: (s.sp - 0.4) / 4.8 }; if (time - botReq.t0 > 1.2) { putt(s.ang, R.aim.power); R.aim = null; botReq = null; } }
  }
  if (R.state === "roll") {
    const ev = step(h, b, R.t, dt);
    for (const e of ev) {
      if (e.type === "wall") audio.click(e.s);
      if (e.type === "bump") { audio.boing(); R.bumpT.set(e.m, 1); }
      if (e.type === "lip") audio.click(2);
      if (e.type === "water") { audio.splash(); for (let i = 0; i < 24; i++) { const a = Math.random() * TAU; R.splash.push({ x: e.x, y: e.y, z: 0, vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.5, vz: 1 + Math.random(), life: 0.8, col: [0.5, 0.7, 0.9] }); } pop("Splash!", "+1 stroke"); R.strokes++; setTimeout(() => { b.x = b.rest[0]; b.y = b.rest[1]; b.wet = false; R.state = "aim"; ui.hud(); }, 1100); R.state = "wait"; }
      if (e.type === "cup") holed();
      if (e.type === "rest") { R.state = "aim"; if (R.strokes >= 10) { pop("Picked up", "max 10"); R.card[R.hi] = 10; R.state = "holed"; R.holedT = 0; } }
    }
    audio.roll(b.moving ? Math.hypot(b.vx, b.vy) : 0);
    R.trail.push([b.x, b.y]); if (R.trail.length > 24) R.trail.shift();
  } else audio.roll(0);
  if (R.state === "holed") { R.holedT += dt; if (R.holedT > 2.6) nextHole(); }
  for (const [m, v] of R.bumpT) { if (v - dt * 2 <= 0) R.bumpT.delete(m); else R.bumpT.set(m, v - dt * 2); }
  for (const s of R.splash) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 4 * dt; s.life -= dt; }
  R.splash = R.splash.filter((s) => s.life > 0);
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.62, dist: 3.2, E: [0, -3, 2], T: [0, 0, 0] };
function updateCamera(dt) {
  const h = R.hole, b = R.ball; if (!b) return;
  let T, dist = cam.dist, yaw = cam.yaw, pitch = cam.pitch;
  if (R.state === "flyover") {
    // sweep from the cup back to the tee
    const k = clamp(R.fly / 3.2, 0, 1), e = k * k * (3 - 2 * k);
    T = [lerp(h.cup[0], h.tee[0], e), lerp(h.cup[1], h.tee[1], e), 0]; dist = lerp(6.5, cam.dist, e); pitch = lerp(1.05, cam.pitch, e);
  } else {
    T = [b.x, b.y, heightAt(h, b.x, b.y)];
    if (R.state === "title" || R.state === "holes") { yaw = time * 0.08; T = [(h.tee[0] + h.cup[0]) / 2, (h.tee[1] + h.cup[1]) / 2, 0]; dist = 7.5; pitch = 0.75; }
  }
  const c = Math.cos(pitch), E = [T[0] - Math.sin(yaw) * c * dist, T[1] - Math.cos(yaw) * c * dist, T[2] + Math.sin(pitch) * dist];
  const k = Math.min(1, dt * (R.state === "roll" ? 3 : 4));
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k));
  space.magnifier = 1.7 * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(40000), A = new Mesh(30000), Sh = new Mesh(400), dyn = new Mesh(80000);
function shadowQ(x, y, z, r, k) { Sh.v(x - r, y - r, z + 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, z + 0.003, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.003, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y - r, z + 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, z + 0.003, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, z + 0.003, 1, k, 0, 0, MAT.SHADOW); }
function buildDynamic() {
  D.reset(); A.reset(); Sh.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const h = R.hole, b = R.ball;
  if (b) {
    const H = (x, y) => heightAt(h, x, y);
    // cup + flag (the flag lifts as the ball nears)
    const near = Math.hypot(b.x - h.cup[0], b.y - h.cup[1]);
    drawCup(D, A, h, clamp(0.6 - near, 0, 0.35), time);
    // ball
    if (!(R.state === "holed")) {
      const z = H(b.x, b.y) + BALL_R * 1.2;
      blob(D, [b.x, b.y, z], BALL_R * 1.2, BALL_R * 1.2, BALL_R * 1.2, [1, 1, 1], MAT.BALL, 12, 8);
      A.sprite(b.x, b.y, z, 0.16, 0.18, 0.18, 0.2); shadowQ(b.x, b.y, H(b.x, b.y), 0.1, 0.55);
      for (let i = 1; i < R.trail.length; i++) { const k = (i / R.trail.length) * 0.25, [tx, ty] = R.trail[i]; A.sprite(tx, ty, H(tx, ty) + 0.05, 0.04, k, k * 0.95, k * 0.8); }
    }
    // aim guide: dotted line + a short path preview
    if (R.state === "aim" && R.aim) {
      const sp = powerToSpeed(R.aim.power), path = [];
      if (save.guide) simulate(h, b.x, b.y, R.aim.ang, sp, R.t, 1.6, path);
      for (let i = 0; i < path.length; i += 3) { const [px, py] = path[i], k = 0.5 * (1 - i / path.length); A.sprite(px, py, H(px, py) + 0.03, 0.025, k, k, k * 0.7); }
      const L = 0.25 + R.aim.power * 0.9, col = [lerp(0.4, 1, R.aim.power), lerp(1, 0.35, R.aim.power), 0.3];
      for (let s = 0; s <= 1; s += 0.08) { const x = b.x + Math.sin(R.aim.ang) * L * s, y = b.y + Math.cos(R.aim.ang) * L * s; A.sprite(x, y, H(x, y) + 0.04, 0.03, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8); }
      // the putter head behind the ball
      const bx = b.x - Math.sin(R.aim.ang) * (0.12 + R.aim.power * 0.3), by = b.y - Math.cos(R.aim.ang) * (0.12 + R.aim.power * 0.3), bz = H(bx, by);
      const px = Math.cos(R.aim.ang) * 0.07, py = -Math.sin(R.aim.ang) * 0.07;
      limb(D, [bx - px, by - py, bz + 0.03], [bx + px, by + py, bz + 0.03], 0.025, 0.025, [0.8, 0.75, 0.6], MAT.GLOSS, 6);
      limb(D, [bx, by, bz + 0.05], [bx - Math.sin(R.aim.ang) * 0.2, by - Math.cos(R.aim.ang) * 0.2, bz + 0.9], 0.008, 0.008, [0.25, 0.25, 0.28], MAT.GLOSS, 4);
    }
    // windmill sails
    if (h.windmill) {
      const [wx, wy] = h.windmill, hub = [wx, wy - 0.36, 0.62], a0 = R.t * (h.moving.find((m) => m.type === "windmill")?.speed || 1);
      for (let k = 0; k < 4; k++) { const a = a0 + k * (Math.PI / 2) + Math.PI / 4, tip = [hub[0] + Math.cos(a) * 0.55, hub[1], hub[2] + Math.sin(a) * 0.55], side = [Math.cos(a + Math.PI / 2) * 0.09, 0, Math.sin(a + Math.PI / 2) * 0.09]; limb(D, hub, tip, 0.012, 0.012, [0.35, 0.22, 0.12], MAT.MATTE, 4); D.quad([hub[0] + Math.cos(a) * 0.12, hub[1] - 0.005, hub[2] + Math.sin(a) * 0.12], [tip[0], tip[1] - 0.005, tip[2]], [tip[0] + side[0], tip[1] - 0.005, tip[2] + side[2]], [hub[0] + Math.cos(a) * 0.12 + side[0], hub[1] - 0.005, hub[2] + Math.sin(a) * 0.12 + side[2]], [0.92, 0.88, 0.8], MAT.MATTE); }
      blob(D, hub, 0.05, 0.05, 0.05, [0.3, 0.2, 0.1], MAT.MATTE, 6, 3);
    }
    // sliding gates
    for (const w of wallsAt(h, R.t).slice(h.staticWalls.length)) {
      if (Math.abs(w[0] - w[2]) < 1e-6 && Math.abs(w[1] - w[3]) < 1e-6) continue;
      const [ax, ay, bx2, by2] = w, za = H(ax, ay), zb = H(bx2, by2), isBlade = h.windmill && Math.abs(ay - 4.94) < 0.01;
      if (isBlade) continue;
      D.quad([ax, ay - 0.04, za + 0.13], [bx2, by2 - 0.04, zb + 0.13], [bx2, by2 + 0.04, zb + 0.13], [ax, ay + 0.04, za + 0.13], [0.5, 0.32, 0.18], MAT.MATTE);
      D.quad([ax, ay - 0.04, za], [bx2, by2 - 0.04, zb], [bx2, by2 - 0.04, zb + 0.13], [ax, ay - 0.04, za + 0.13], [0.42, 0.27, 0.15], MAT.MATTE);
      D.quad([ax, ay + 0.04, za], [bx2, by2 + 0.04, zb], [bx2, by2 + 0.04, zb + 0.13], [ax, ay + 0.04, za + 0.13], [0.42, 0.27, 0.15], MAT.MATTE);
      for (const [x, y, z] of [[ax, ay, za], [bx2, by2, zb]]) blob(D, [x, y, z + 0.15], 0.03, 0.03, 0.03, [0.85, 0.65, 0.3], MAT.GLOSS, 6, 3);
    }
    // mushroom bumpers
    for (const m of h.bumpers || []) {
      const z = H(m.x, m.y), pulse = R.bumpT.get(m) || 0, c = [[1, 0.35, 0.55], [0.5, 0.6, 1], [0.6, 1, 0.6]][Math.floor(m.x * 7 + m.y * 3) % 3 >= 0 ? Math.abs(Math.floor(m.x * 7 + m.y * 3)) % 3 : 0];
      tube(D, m.x, m.y, 10, m.r * 0.55, z - 0.02, m.r * 0.5, z + 0.12, [0.92, 0.88, 0.8], MAT.MATTE);
      blob(D, [m.x, m.y, z + 0.15 + pulse * 0.03], m.r * (1.15 + pulse * 0.15), m.r * (1.15 + pulse * 0.15), m.r * 0.7, c.map((v) => v * (0.9 + pulse * 1.2)), MAT.EMIT, 12, 5);
      A.sprite(m.x, m.y, z + 0.2, m.r * 2.2, c[0] * (0.15 + pulse * 0.5), c[1] * (0.15 + pulse * 0.5), c[2] * (0.15 + pulse * 0.5));
    }
    // fairy lights twinkle
    for (const [x, y, z, r] of FAIRY) { const k = 0.55 + 0.45 * Math.sin(time * (1.5 + r * 3) + r * 40); const c = r < 0.6 ? [1, 0.75, 0.4] : r < 0.85 ? [1, 0.5, 0.6] : [0.6, 0.8, 1]; A.sprite(x, y, z, 0.022, c[0] * k, c[1] * k, c[2] * k); A.sprite(x, y, z, 0.07, c[0] * k * 0.12, c[1] * k * 0.12, c[2] * k * 0.12); }
    // fireflies
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of h.fairway) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (const f of flies) { const x = x0 - 1 + f.x * (x1 - x0 + 2) + Math.sin(time * 0.6 + f.ph) * 0.3, y = y0 - 1 + f.y * (y1 - y0 + 2) + Math.cos(time * 0.5 + f.ph) * 0.3, z = 0.15 + f.z * 0.9 + Math.sin(time + f.ph) * 0.1, k = Math.max(0, Math.sin(time * 1.3 + f.ph * 3)); A.sprite(x, y, z, 0.025, 0.8 * k, 0.9 * k, 0.3 * k); }
    for (const s of R.splash) { const k = s.life; A.sprite(s.x, s.y, s.z, 0.03, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
  }
  const oD = 6; dyn.append(D); const oSh = dyn.n; dyn.append(Sh); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oSh - oD, oSh, nSh: oA - oSh, oA, nA: dyn.n - oA };
}

// ------------------------------------------------------------------ lights: lanterns, the ball's glow and nearby fairy-light clusters
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [], f = cam.T;
  for (const p of LANTERNS) L.push({ p, c: [1, 0.55, 0.22], k: 0.9, d: Math.hypot(p[0] - f[0], p[1] - f[1]) });
  for (const m of R.hole.bumpers || []) { const pulse = R.bumpT.get(m) || 0; if (pulse > 0) L.push({ p: [m.x, m.y, 0.3], c: [1, 0.5, 0.8], k: pulse * 1.5, d: -1 }); }
  for (let i = 0; i < FAIRY.length; i += 6) { const p = FAIRY[i]; L.push({ p: [p[0], p[1], p[2] + 0.05], c: [1, 0.7, 0.4], k: 0.18, d: Math.hypot(p[0] - f[0], p[1] - f[1]) + 0.6 }); }
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
  const S = (k) => { if (!seg[k]) return; space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("O"); S("W"); space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.bind(true); space.draw(o.oSh, o.nSh);
  gl.blendFunc(gl.ONE, gl.ONE); S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: R.state === "holed" ? Math.max(0, 0.4 - R.holedT * 0.3) : 0 });
}

// ------------------------------------------------------------------ UI
let popT = 0;
function pop(t, s) { $("pop-t").textContent = t; $("pop-s").textContent = s; $("pop").classList.add("show"); clearTimeout(popT); popT = setTimeout(() => $("pop").classList.remove("show"), 2000); }
const ui = {
  show(w) { for (const id of ["title", "hud", "holes"]) $(id).classList.toggle("hidden", id !== w); },
  hud() { $("h-strokes").textContent = R.strokes; },
  card() {
    const par = HOLES.map((h) => h.par), tot = R.card.reduce((a, b) => a + (b || 0), 0);
    $("card").innerHTML = `<tr><th>HOLE</th>${HOLES.map((_, i) => `<th>${i + 1}</th>`).join("")}<th>TOT</th></tr><tr><td>PAR</td>${par.map((p) => `<td>${p}</td>`).join("")}<td>${par.reduce((a, b) => a + b, 0)}</td></tr><tr class="you"><td>YOU</td>${HOLES.map((h, i) => { const s = R.card[i]; return `<td class="${s === undefined ? "" : s < h.par ? "under" : s > h.par ? "over" : ""}">${s ?? ""}</td>`; }).join("")}<td>${tot || ""}</td></tr>`;
  },
  holes() { $("hgrid").innerHTML = HOLES.map((h, i) => `<button class="hc" data-i="${i}"><span>${i + 1}</span><b>${h.name}</b><small>PAR ${h.par}</small></button>`).join(""); $("hgrid").querySelectorAll(".hc").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.ui(); startRound(+b.dataset.i); })); },
  title() { $("t-best").textContent = save.rounds ? `Best round ${save.best} · ${save.rounds} rounds · ${save.aces} aces` : "Drag back from the ball to putt · drag elsewhere to look around"; },
};
function toTitle() { for (const m of ["m-done", "m-card", "m-set"]) $(m).classList.add("hidden"); R.state = "title"; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.ui(); startRound(); };
$("t-practice").onclick = () => { audio.init(); audio.ui(); ui.holes(); ui.show("holes"); R.state = "holes"; };
$("hl-back").onclick = toTitle;
$("b-card").onclick = () => { ui.card(); $("m-card").classList.toggle("hidden"); };
$("c-close").onclick = () => $("m-card").classList.add("hidden");
$("b-quit").onclick = toTitle;
$("f-again").onclick = () => { $("m-done").classList.add("hidden"); startRound(); };
$("f-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-guide").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (save.guide ? "1" : "0"))); $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-guide").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.guide = b.dataset.v === "1"; persist(); $("st-guide").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ boot
window.__golf = () => ({ state: R.state, hole: R.hi + 1, strokes: R.strokes, ball: R.ball && [+R.ball.x.toFixed(2), +R.ball.y.toFixed(2)], card: R.card, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
loadHole(3); R.state = "title"; cam.dist = 3.6; cam.pitch = 0.7;
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); ui.show("title"); ui.title();
  if (Q.has("hole")) startRound(clamp(+Q.get("hole") - 1, 0, HOLES.length - 1)); else if (bot) startRound();
}, 400);
