// ECHOES OF THE HOLLOW — a third-person walk through a forest valley. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom / god rays / depth of field. See DESIGN.md.
// maps.js / world.js / worker.js build the procedural forest, chars.js the villager (GPU-skinned), glb.js loads
// optional real models from ./assets; this file runs the player, the camera, the atmosphere and the HUD.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, MAT, clamp, lerp, smoothNormals } from "./mesh.js";
import { buildMap, buildWalk, ENVS, HALF } from "./maps.js";
import { TILE, NT } from "./world.js";
import { makeChar, stepChar, poseChar, charMesh, NBONE, MX } from "./chars.js";
import { loadGLB, buildCollision } from "./glb.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
let U = null, post = null, pxCap = 2.6e6;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post?.resize(canvas.width, canvas.height);
}
const upload = (pos, col) => { const pb = gl.createBuffer(), cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW); return { pb, cb }; };
const uploadN = (n) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, n, gl.STATIC_DRAW); return b; };

// ------------------------------------------------------------------ world: procedural forest (worker) or assets/forest.glb
const S = buildMap(0), walk = buildWalk(S), ENV = ENVS[S.env];
const tiles = new Array(NT * NT).fill(null), shadeTex = gl.createTexture();
let shadeReady = false, tilesLoaded = 0, envModel = null, envCol = null;
const assets = { forest: "procedural", villager: "procedural", notes: [] };
function setShade(W, H, data) {
  gl.bindTexture(gl.TEXTURE_2D, shadeTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, W, H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
  shadeReady = true;
}
function startProcedural() {
  const onMsg = (m) => {
    if (m.type === "tile") { tiles[m.tj * NT + m.ti] = { ...upload(m.pos, m.col), nb: uploadN(m.nrm), O: m.O, G: m.G, W: m.W, A: m.A, cx: -HALF + (m.ti + 0.5) * TILE, cy: -HALF + (m.tj + 0.5) * TILE }; tilesLoaded++; }
    else if (m.type === "shade") setShade(m.W, m.H, m.data);
  };
  try {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    w.onmessage = (e) => onMsg(e.data);
    w.onerror = async (e) => { console.warn("Echoes: worker failed, building on the main thread", e.message); await buildSync(onMsg); };
    w.postMessage({ ch: 0, start: S.spots.start, token: 0 });
  } catch { buildSync(onMsg); }
}
async function buildSync(onMsg) {
  const Wd = await import("./world.js");
  const sh = Wd.bakeShade(S); onMsg({ type: "shade", ...sh });
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) onMsg({ type: "tile", ...Wd.buildTile(S, i, j) });
}
// optional real models: assets/forest.glb (environment) and assets/villager.glb (player)
async function tryAsset(name) { try { const r = await fetch(`assets/${name}`, { method: "HEAD" }); return r.ok && +(r.headers.get("content-length") || 1) > 0; } catch { return false; } }
async function loadEnvironmentGLB() {
  const m = await loadGLB("assets/forest.glb");
  // centre it on the origin, ground at z = 0
  const cx = (m.min[0] + m.max[0]) / 2, cy = (m.min[1] + m.max[1]) / 2, z0 = m.min[2];
  for (let i = 0; i < m.n; i++) { m.tris[i * 3] -= cx; m.tris[i * 3 + 1] -= cy; m.tris[i * 3 + 2] -= z0; }
  m.min = [m.min[0] - cx, m.min[1] - cy, 0]; m.max = [m.max[0] - cx, m.max[1] - cy, m.max[2] - z0];
  const pos = new Float32Array(m.n * 4), col = new Float32Array(m.n * 4);
  for (let i = 0; i < m.n; i++) { pos.set([m.tris[i * 3], m.tris[i * 3 + 1], m.tris[i * 3 + 2], 1], i * 4); col.set([m.cols[i * 3], m.cols[i * 3 + 1], m.cols[i * 3 + 2], MAT.MATTE], i * 4); }
  const hasN = m.nrms.some((v) => v !== 0);
  envModel = { ...upload(pos, col), nb: uploadN(hasN ? m.nrms : smoothNormals(pos, m.n)), n: m.n };
  envCol = buildCollision(m);
  setShade(1, 1, new Uint8Array([255]));
}
let glbVillager = null;
async function loadVillagerGLB() {
  const m = await loadGLB("assets/villager.glb");
  const h = m.max[2] - m.min[2] || 1, s = 1.75 / h, cx = (m.min[0] + m.max[0]) / 2, cy = (m.min[1] + m.max[1]) / 2;
  const pos = new Float32Array(m.n * 4), col = new Float32Array(m.n * 4);
  // glTF characters face +Z, which becomes −Y here; turn them to face +Y (the rig's forward)
  for (let i = 0; i < m.n; i++) { pos.set([-(m.tris[i * 3] - cx) * s, -(m.tris[i * 3 + 1] - cy) * s, (m.tris[i * 3 + 2] - m.min[2]) * s, 1000], i * 4); col.set([m.cols[i * 3], m.cols[i * 3 + 1], m.cols[i * 3 + 2], MAT.SOFT], i * 4); }
  const n = new Float32Array(m.n * 3); for (let i = 0; i < m.n; i++) { n[i * 3] = -m.nrms[i * 3]; n[i * 3 + 1] = -m.nrms[i * 3 + 1]; n[i * 3 + 2] = m.nrms[i * 3 + 2]; }
  glbVillager = { ...upload(pos, col), nb: uploadN(m.nrms.some((v) => v !== 0) ? n : smoothNormals(pos, m.n)), n: m.n };
}

// ground and collision (procedural walk grid, or the GLB environment's own geometry)
const groundAt = (x, y, z) => (envCol ? envCol.ground(x, y, z) ?? 0 : S.ground(x, y));
const blockedAt = (x, y, feet) => (envCol ? envCol.blocked(x, y, feet) : walk.blocked(x, y));
// trunks and boulders for the camera's spring arm
const solids = S.props.filter((p) => p.t === "tree" || (p.t === "rock" && p.s > 0.8) || p.t === "pillar" || p.t === "cottage").map((p) => ({ x: p.x, y: p.y, r: p.t === "cottage" ? 4 : p.t === "tree" ? 0.45 * p.s + 0.25 : p.r || 0.8 }));

// ------------------------------------------------------------------ player
const P = { ch: makeChar("villager", 0, 0, 0, Math.PI / 2), x: S.spots.start[0], y: S.spots.start[1], z: 0, vx: 0, vy: 0, vz: 0, face: Math.PI / 2, ground: true, coyote: 0, jumpBuf: 0, stepT: 0, landT: 0 };
P.z = groundAt(P.x, P.y, 50);
const R = 0.32;
function tryMove(dx, dy) {
  const free = (x, y) => !blockedAt(x, y, P.z) && !blockedAt(x + R, y, P.z) && !blockedAt(x - R, y, P.z) && !blockedAt(x, y + R, P.z) && !blockedAt(x, y - R, P.z);
  let moved = false;
  if (free(P.x + dx, P.y)) { P.x += dx; moved = true; } else P.vx *= 0.3;
  if (free(P.x, P.y + dy)) { P.y += dy; moved = true; } else P.vy *= 0.3;
  return moved;
}
const keys = new Set(), pressed = new Set();
addEventListener("keydown", (e) => {
  audio.init();
  if (["Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
  if (e.code === "KeyH" && !e.repeat) $("help").classList.toggle("hide");
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
function stepPlayer(dt) {
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) + touch.f;
  const r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) + touch.r;
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.sprint;
  let mx = Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * r, my = Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * r;
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  const speed = sprint ? 7.0 : 3.4, tx = mx * speed, ty = my * speed;
  const k = damp(P.ground ? 11 : 2.2, dt);
  P.vx += (tx - P.vx) * k; P.vy += (ty - P.vy) * k;
  tryMove(P.vx * dt, P.vy * dt);
  P.x = clamp(P.x, -HALF + 3, HALF - 3); P.y = clamp(P.y, -HALF + 3, HALF - 3);
  const hs = Math.hypot(P.vx, P.vy);
  if (hs > 0.3 && ml > 0.05) P.face += dAng(P.face, Math.atan2(P.vy, P.vx)) * damp(sprint ? 9 : 11, dt);
  // jumping with coyote time and input buffering; gravity; landing on the terrain
  if (pressed.has("Space") || touch.jump) { P.jumpBuf = 0.15; touch.jump = false; }
  P.jumpBuf -= dt; P.coyote = P.ground ? 0.12 : P.coyote - dt;
  if (P.jumpBuf > 0 && P.coyote > 0) { P.vz = 6.4; P.ground = false; P.coyote = 0; P.jumpBuf = 0; audio.jump(); }
  P.vz -= 19 * dt; P.z += P.vz * dt;
  const g = groundAt(P.x, P.y, P.z);
  if (P.z <= g) { if (!P.ground && P.vz < -4) { P.landT = 0.25; audio.land(); dust(P.x, P.y, g, 10); } P.z = g; P.vz = 0; P.ground = true; }
  else if (P.ground && P.vz <= 0 && P.z - g < 0.35) { P.z = g; P.vz = 0; }   // stick to the ground walking downhill
  else P.ground = false;
  P.landT = Math.max(0, P.landT - dt);
  // drive the rig
  const c = P.ch;
  c.x = P.x; c.y = P.y; c.z = P.z - P.landT * 0.25; c.face = P.face;
  c.speed = lerp(c.speed, P.ground ? hs / 4.6 : 0.2, damp(10, dt));
  c.air = lerp(c.air || 0, P.ground ? 0 : 1, damp(12, dt));
  c.phase += dt * hs * 1.9 - dt * (2 + c.speed * 7.5);   // stride cadence follows real ground speed
  stepChar(c, dt);
  if (P.ground && hs > 0.6) { P.stepT -= dt * hs; if (P.stepT < 0) { P.stepT = 1.15; audio.step(sprint); } }
}

// ------------------------------------------------------------------ third-person camera (mouse orbit, spring arm)
const cam = { yaw: Math.PI / 2, pitch: 0.32, dist: 5.2, want: 5.2, arm: 5.2, t: [0, 0, 0], e: [0, 0, 0], snap: true, idle: 0 };
let locked = false, drag = null;
canvas.addEventListener("click", () => { audio.init(); if (!locked && !matchMedia("(pointer: coarse)").matches) canvas.requestPointerLock?.(); });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === canvas; $("lockhint").classList.toggle("hide", locked); });
addEventListener("mousemove", (e) => { if (locked) { cam.yaw -= e.movementX * 0.0024; cam.pitch = clamp(cam.pitch + e.movementY * 0.002, -0.35, 1.25); cam.idle = 0; } });
canvas.addEventListener("pointerdown", (e) => { if (!locked && e.pointerType !== "touch") drag = [e.clientX, e.clientY]; });
addEventListener("pointermove", (e) => { if (drag && !locked) { cam.yaw -= (e.clientX - drag[0]) * 0.005; cam.pitch = clamp(cam.pitch + (e.clientY - drag[1]) * 0.004, -0.35, 1.25); drag = [e.clientX, e.clientY]; cam.idle = 0; } });
addEventListener("pointerup", () => (drag = null));
addEventListener("wheel", (e) => { cam.want = clamp(cam.want * (1 + Math.sign(e.deltaY) * 0.1), 2.4, 11); }, { passive: true });
function armLength(T, dx, dy, dz, L) {
  // shorten the arm before terrain or a trunk / boulder / building gets between the camera and the player
  let len = L;
  for (let s = 0.4; s < L; s += 0.25) { const x = T[0] + dx * s, y = T[1] + dy * s, z = T[2] + dz * s; if (z < groundAt(x, y, z + 0.5) + 0.35) { len = Math.max(0.8, s - 0.3); break; } }
  for (const o of solids) {
    const ox = o.x - T[0], oy = o.y - T[1]; if (ox * ox + oy * oy > (L + 4) ** 2) continue;
    const hl = Math.hypot(dx, dy) || 1e-6, ux = dx / hl, uy = dy / hl, t = ox * ux + oy * uy; if (t < 0) continue;
    const px = ox - ux * t, py = oy - uy * t; if (px * px + py * py > o.r * o.r) continue;
    const s = (t - Math.sqrt(o.r * o.r - (px * px + py * py))) / hl; if (s > 0.3 && s < len) len = Math.max(0.8, s - 0.25);
  }
  return len;
}
function updateCamera(dt) {
  cam.idle += dt;
  // gently swing behind the player while walking if the mouse has been still for a while
  if (cam.idle > 2.5 && Math.hypot(P.vx, P.vy) > 1) cam.yaw += dAng(cam.yaw, P.face) * damp(0.6, dt);
  cam.dist += (cam.want - cam.dist) * damp(6, dt);
  const T = [P.x, P.y, P.z + 1.45 - P.landT * 0.2];
  const cp = Math.cos(cam.pitch), dx = -Math.cos(cam.yaw) * cp, dy = -Math.sin(cam.yaw) * cp, dz = Math.sin(cam.pitch);
  const want = armLength(T, dx, dy, dz, cam.dist);
  cam.arm = want < cam.arm ? want : cam.arm + (want - cam.arm) * damp(3, dt);   // pull in fast, ease back out
  const k = cam.snap ? 1 : damp(14, dt);
  for (let i = 0; i < 3; i++) cam.t[i] += (T[i] - cam.t[i]) * k;
  cam.e = [cam.t[0] + dx * cam.arm, cam.t[1] + dy * cam.arm, cam.t[2] + dz * cam.arm];
  cam.snap = false;
  space.magnifier = 1.18 * 1.6;
  space.lookAt(cam.e[0], cam.e[1], cam.e[2], cam.t[0], cam.t[1], cam.t[2]);
}

// ------------------------------------------------------------------ touch controls (virtual stick + buttons)
const touch = { f: 0, r: 0, sprint: false, jump: false, id: null, ox: 0, oy: 0, look: null };
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return; audio.init();
  if (e.clientX < innerWidth * 0.4 && touch.id === null) { touch.id = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; }
  else touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId === touch.id) { const dx = e.clientX - touch.ox, dy = e.clientY - touch.oy, l = Math.hypot(dx, dy), m = Math.min(1, l / 60); touch.r = l ? (dx / l) * m : 0; touch.f = l ? (-dy / l) * m : 0; touch.sprint = l > 75; }
  else if (touch.look && e.pointerId === touch.look.id) { cam.yaw -= (e.clientX - touch.look.x) * 0.006; cam.pitch = clamp(cam.pitch + (e.clientY - touch.look.y) * 0.004, -0.35, 1.25); touch.look.x = e.clientX; touch.look.y = e.clientY; cam.idle = 0; }
});
const tEnd = (e) => { if (e.pointerId === touch.id) { touch.id = null; touch.f = touch.r = 0; touch.sprint = false; } if (touch.look && e.pointerId === touch.look.id) touch.look = null; };
canvas.addEventListener("pointerup", tEnd); canvas.addEventListener("pointercancel", tEnd);
$("t-jump").addEventListener("pointerdown", (e) => { touch.jump = true; e.preventDefault(); });

// ------------------------------------------------------------------ ambience (Web Audio, synthesized)
const audio = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.out = ctx.createGain(); this.out.gain.value = 0.7; this.out.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource(), wf = ctx.createBiquadFilter(), wg = ctx.createGain(); wind.buffer = this.noise; wind.loop = true; wf.type = "lowpass"; wf.frequency.value = 420; wg.gain.value = 0.05; wind.connect(wf).connect(wg).connect(this.out); wind.start(); this.wg = wg;
    this.next = ctx.currentTime + 1.5; setInterval(() => this.birds(), 200);
  },
  hit(f, q, d, v, type = "bandpass") { if (!this.ctx) return; const t = this.ctx.currentTime, n = this.ctx.createBufferSource(), F = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); n.buffer = this.noise; F.type = type; F.frequency.value = f; F.Q.value = q; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); n.connect(F).connect(g).connect(this.out); n.start(t, Math.random()); n.stop(t + d + 0.05); },
  step(fast) { this.hit(300 + Math.random() * 300, 1.2, 0.07, fast ? 0.07 : 0.045, "lowpass"); this.hit(2500, 2, 0.04, 0.012); },
  jump() { this.hit(700, 1, 0.12, 0.05, "lowpass"); },
  land() { this.hit(250, 1, 0.18, 0.12, "lowpass"); },
  birds() {
    if (!this.ctx || this.ctx.currentTime < this.next) return;
    const ctx = this.ctx, t = ctx.currentTime, base = 2300 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 5), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null, g0 = ctx.createGain(); g0.gain.value = 0.5;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g0.connect(pan).connect(this.out); } else g0.connect(this.out);
    for (let i = 0; i < n; i++) { const tt = t + i * (0.08 + Math.random() * 0.08), o = ctx.createOscillator(), g = ctx.createGain(), f0 = base * (0.85 + Math.random() * 0.3); o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.45 : 0.7), tt + 0.07); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.02, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.09); o.connect(g).connect(g0); o.start(tt); o.stop(tt + 0.1); }
    this.next = t + 1.2 + Math.random() * 4;
  },
};

// ------------------------------------------------------------------ dynamic geometry: effects, sprites, contact shadows
const D = new Mesh(20000), A = new Mesh(20000), SH = new Mesh(400), dyn = new Mesh(60000);
let parts = [], time = 0;
function dust(x, y, z, n) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 0.6 + Math.random() * 1.2; parts.push({ p: [x, y, z + 0.05], v: [Math.cos(a) * v, Math.sin(a) * v, 0.3 + Math.random() * 0.6], life: 0.7, c: [0.5, 0.42, 0.32], s: 0.18, smoke: 1 }); } }
const camp = S.props.find((p) => p.id === "camp");
const motes = Array.from({ length: 110 }, (_, i) => ({ o: [Math.random() * 24 - 12, Math.random() * 24 - 12, Math.random() * 4], ph: i * 2.3 }));
const flies = Array.from({ length: 12 }, (_, i) => ({ ph: i * 1.7, c: [[1.4, 0.9, 0.2], [0.5, 0.8, 1.6], [1.5, 0.5, 0.8]][i % 3] }));
function buildDynamic() {
  D.reset(); A.reset(); SH.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  // campfire
  if (camp && !envModel) {
    const f = camp.flame;
    for (let i = 0; i < 3; i++) { const w = Math.sin(time * (9 + i * 3) + i) * 0.04; A.sprite(f[0] + w, f[1], f[2] + i * 0.14, 0.4 - i * 0.09, 0.66, 0.37, 0.14); }
    A.sprite(f[0], f[1], f[2], 2.2, 0.16, 0.1, 0.04);
    if (Math.random() < 0.5) parts.push({ p: [f[0] + (Math.random() - 0.5) * 0.3, f[1] + (Math.random() - 0.5) * 0.3, f[2] + 0.3], v: [(Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 1 + Math.random()], life: 0.9, c: [1.6, 0.8, 0.3], s: 0.04 });
    if (Math.random() < 0.25) parts.push({ p: [f[0], f[1], f[2] + 0.6], v: [0.25, 0.1, 0.8], life: 2.6, c: [0.32, 0.3, 0.3], s: 0.35, smoke: 1 });
  }
  // dust motes that glitter only in sunbeams, butterflies near the player
  const sun = ENV.sun;
  for (const m of motes) {
    const x = P.x + ((m.o[0] + Math.sin(time * 0.1 + m.ph) * 1.5 + 12) % 24) - 12, y = P.y + ((m.o[1] + time * 0.12 + 12) % 24) - 12, gz = groundAt(x, y, P.z + 5), z = gz + 0.6 + m.o[2] + Math.sin(time * 0.4 + m.ph) * 0.3;
    const k = 0.25 * (0.6 + 0.4 * Math.sin(time * 2.5 + m.ph));
    A.sprite(x, y, z, 0.02 + (m.ph % 1) * 0.015, k, k * 0.85, k * 0.55);
  }
  for (const b of flies) {
    const t = time * 0.5 + b.ph, x = P.x + Math.sin(t * 0.7) * 6 + Math.sin(t * 2.3) * 0.6, y = P.y + Math.cos(t * 0.5 + b.ph) * 6, z = groundAt(x, y, P.z + 5) + 0.8 + Math.sin(t * 3) * 0.4, fl = Math.abs(Math.sin(time * 18 + b.ph)) * 0.08;
    D.tri([x, y, z], [x - 0.07, y + fl, z + 0.06], [x - 0.07, y - fl, z + 0.06], b.c.map((v) => v * 0.5), MAT.SOFT); D.tri([x, y, z], [x + 0.07, y - fl, z + 0.06], [x + 0.07, y + fl, z + 0.06], b.c.map((v) => v * 0.5), MAT.SOFT);
  }
  for (const q of parts) { const k = Math.max(0, q.life) * (q.smoke ? 0.16 : 0.9); A.sprite(...q.p, q.s * (q.smoke ? 1 + (2.6 - q.life) * 0.6 : 1), q.c[0] * k, q.c[1] * k, q.c[2] * k); }
  // soft contact shadow under the player
  const r = 0.55, z = groundAt(P.x, P.y, P.z + 0.5) + 0.04, k = clamp(0.6 - (P.z - z) * 0.25, 0.15, 0.6);
  SH.quad4([P.x - r, P.y - r, z], [P.x + r, P.y - r, z], [P.x + r, P.y + r, z], [P.x - r, P.y + r, z], [-1, -1, k], [1, -1, k], [1, 1, k], [-1, 1, k], MAT.SHADOW);
  const oD = 6; dyn.append(D); const oSH = dyn.n; dyn.append(SH); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oSH - oD, oSH, nSH: oA - oSH, oA, nA: dyn.n - oA };
}
let charBuf = null;
function drawPlayer() {
  if (glbVillager) {
    // a rigid imported model: one bone, with a little walk bob and lean
    const c = P.ch, bob = Math.abs(Math.sin(c.phase)) * 0.06 * Math.min(1, c.speed), lean = Math.min(0.25, Math.hypot(P.vx, P.vy) * 0.025);
    const B = new Float32Array(NBONE * 12); B.set(MX.mul(MX.mul(MX.T(c.x, c.y, c.z + bob), MX.Z(c.face - Math.PI / 2)), MX.X(-lean)), 0);
    gl.uniform4fv(U.uBone, B); space.bindBuf(glbVillager.pb, glbVillager.cb, glbVillager.nb); space.draw(0, glbVillager.n); return;
  }
  const o = poseChar(P.ch, time);
  if (!charBuf) { const CM = charMesh("villager"), M = CM.m; charBuf = { ...upload(M.pos.subarray(0, M.n * 4), M.col.subarray(0, M.n * 4)), nb: uploadN(CM.nrm), n: M.n }; }
  gl.uniform4fv(U.uBone, o.B); space.bindBuf(charBuf.pb, charBuf.cb, charBuf.nb); space.draw(0, charBuf.n);
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic();
  let nL = 0;
  if (camp && !envModel) { lightBuf.set([...camp.flame, 4 + Math.sin(time * 13) * 0.4], 0); lightColBuf.set([1, 0.6, 0.25], 0); nL = 1; }
  post.begin();
  gl.useProgram(U.program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadeTex); gl.uniform1i(U.uShade, 0);
  gl.uniform4f(U.uShadeRect, -HALF, -HALF, 1 / (2 * HALF), 1 / (2 * HALF));
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform1f(U.uHit, 0); gl.uniform1f(U.uBolt, 0);
  const E = ENV;
  gl.uniform3fv(U.uSun, E.sun); gl.uniform3fv(U.uSunCol, E.sunCol); gl.uniform3fv(U.uAmbT, E.ambT); gl.uniform3fv(U.uAmbB, E.ambB);
  gl.uniform3fv(U.uSkyTop, E.skyTop); gl.uniform3fv(U.uSkyHor, E.skyHor); gl.uniform3fv(U.uGlow, E.glow); gl.uniform4f(U.uMisc, E.fog, 0, 0, 0);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  const focus = Math.hypot(cam.e[0] - cam.t[0], cam.e[1] - cam.t[1], cam.e[2] - cam.t[2]);
  gl.uniform3f(U.uDof, focus, 0.22, 0.25);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  const cx = cam.t[0], cy = cam.t[1];
  const vis = tiles.filter((t) => t && Math.hypot(t.cx - cx, t.cy - cy) < 160);
  if (envModel) { space.bindBuf(envModel.pb, envModel.cb, envModel.nb); space.draw(0, envModel.n); }
  else for (const t of vis) { space.bindBuf(t.pb, t.cb, t.nb); space.draw(...t.O); if (Math.hypot(t.cx - cx, t.cy - cy) < 60) space.draw(...t.G); space.draw(...t.W); }
  space.bind(true); space.draw(o.oD, o.nD);
  drawPlayer(); space.bind(true);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.draw(o.oSH, o.nSH);
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
  if (!envModel) for (const t of vis) { space.bindBuf(t.pb, t.cb, t.nb); space.draw(...t.A); }
  space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true); space.noNormals();
  // sun position on screen for the god rays
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec, s = E.sun;
  const xp = -(s[0] * X[0] + s[1] * X[1] + s[2] * X[2]), yp = s[0] * Y[0] + s[1] * Y[1] + s[2] * Y[2], zp = s[0] * Z[0] + s[1] * Z[1] + s[2] * Z[2];
  const kk = space.magnifier / 1.6, asp = canvas.width / canvas.height; let sunUV = [0.5, 1.6], sunK = 0;
  if (zp > 0.05) { sunUV = [(xp * kk / zp) * 0.5 + 0.5, (yp * kk * asp / zp) * 0.5 + 0.5]; sunK = 0.7 * clamp((1.1 - Math.max(Math.abs(sunUV[0] - 0.5), Math.abs(sunUV[1] - 0.5))) / 0.5, 0, 1); }
  post.end({ time, fade: fadeK, flash: 0, sunUV, sunK, maxR: canvas.height * 0.007, skyCoc: 0.2 });
}

// ------------------------------------------------------------------ loop, loading, HUD
let fadeK = 0, state = "loading", fps = 0, fN = 0, fT = 0, slow = 0, last = performance.now();
function adapt() { if (fps < 36 && pxCap > 1.2e6) { if (++slow >= 3) { pxCap *= 0.8; slow = 0; sizeCanvas(); } } else if (fps > 56 && pxCap < 2.6e6) { if (--slow <= -6) { pxCap = Math.min(2.6e6, pxCap * 1.15); slow = 0; sizeCanvas(); } } else slow = 0; }
function ready() { return envModel || (shadeReady && tiles.every((t, k) => t || Math.hypot(-HALF + ((k % NT) + 0.5) * TILE - P.x, -HALF + (Math.floor(k / NT) + 0.5) * TILE - P.y) > 40)); }
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; if (state === "play") adapt(); $("fps").textContent = `${fps} fps`; }
  if (state === "loading") {
    $("ld-bar").style.width = Math.min(100, (tilesLoaded / (NT * NT)) * 200) + "%";
    if (ready()) { state = "play"; P.z = groundAt(P.x, P.y, 60); cam.snap = true; $("loading").classList.add("out"); $("hud").classList.remove("hide"); }
    else { requestAnimationFrame(frame); return; }
  }
  time += dt; fadeK = Math.min(1, fadeK + dt * 0.7);
  try {
    stepPlayer(dt);
    for (const q of parts) { q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt; q.life -= dt; }
    parts = parts.filter((q) => q.life > 0).slice(-400);
    render(dt);
  } catch (e) { if (!frame.err) { frame.err = 1; console.error("Echoes of the Hollow:", e); } }
  pressed.clear();
  requestAnimationFrame(frame);
}
window.__hollow = () => ({ state, x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ground: P.ground, speed: +Math.hypot(P.vx, P.vy).toFixed(2), face: +P.face.toFixed(2), yaw: +cam.yaw.toFixed(2), arm: +cam.arm.toFixed(2), fps, tiles: tilesLoaded, assets });
window.__keys = keys; window.__pressed = pressed;

// boot: decide which assets to use, start building the world, then compile the shaders while it builds
(async () => {
  const [hasForest, hasVillager] = await Promise.all([tryAsset("forest.glb"), tryAsset("villager.glb")]);
  if (hasForest) { try { await loadEnvironmentGLB(); assets.forest = "assets/forest.glb"; } catch (e) { assets.notes.push(`forest.glb: ${e.message}`); envModel = null; envCol = null; } }
  if (!envModel) startProcedural();
  U = createProgram(gl, space); post = new Post(gl, space.posId); sizeCanvas(); addEventListener("resize", sizeCanvas);
  if (hasVillager) { try { await loadVillagerGLB(); assets.villager = "assets/villager.glb"; } catch (e) { assets.notes.push(`villager.glb: ${e.message}`); } }
  $("assets").innerHTML = `Forest: <b>${assets.forest === "procedural" ? "procedural stand-in" : "assets/forest.glb"}</b> · Villager: <b>${assets.villager === "procedural" ? "procedural stand-in" : "assets/villager.glb"}</b>${assets.notes.length ? `<br><span class="warn">${assets.notes.join(" · ")}</span>` : ""}`;
  requestAnimationFrame(frame);
})();
