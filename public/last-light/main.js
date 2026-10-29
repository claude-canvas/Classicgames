// LAST LIGHT — a harvest mouse lights the forest's lantern-caps with fireflies before night falls. See DESIGN.md.
// Rendered with Space.js (via GameSpace) + the arcade's shaders and post chain. forest.js holds the instanced forest,
// world.js the ground / walls / cover, lod.js the impostors, wick.js the mouse, life.js fireflies / caps / owl.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, clamp, lerp } from "./mesh.js";
import { loadForest, worldTriangles } from "./forest.js";
import { buildWorld } from "./world.js";
import { groupTrees, bakeImpostors, impostorGeometry, drawFloor } from "./lod.js";
import { buildWick, makeWick, stepWick, wickBones, lanternPos } from "./wick.js";
import { makeCaps, makeFireflies, stepFireflies, countCarried, scatter, buildOwl, makeOwl, stepOwl, owlBones, NEED, CARRY } from "./life.js";
import { sound } from "./sound.js";
import { buildNav } from "./nav.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const Q = new URLSearchParams(location.search), AUTO = Q.has("auto"), DEV = Q.has("dev"), PROF = Q.has("prof");
const DAY_LEN = 420;            // seconds from golden hour to night
const OWL_FROM = 0.3;           // Old Hush wakes at this point of the evening
const COVER = 4;                // grass blade metres in Wick's 0.5 m cell that hide him from the owl (about a third of the floor)

// ------------------------------------------------------------------ dev: live reload when a source file changes
if (DEV) {
  const files = ["main.js", "forest.js", "world.js", "lod.js", "wick.js", "life.js", "sound.js", "shaders.js", "post.js", "mesh.js", "GameSpace.js", "index.html"];
  const tags = new Map();
  setInterval(async () => {
    for (const f of files) {
      try { const r = await fetch(f, { method: "HEAD", cache: "no-store" }); if (!r.ok) continue; const t = r.headers.get("etag") || r.headers.get("last-modified"); if (tags.has(f) && tags.get(f) !== t) { location.reload(); return; } tags.set(f, t); } catch (e) { }
    }
  }, 1500);
}

// ------------------------------------------------------------------ GL setup
const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const PX_MAX = 2.4e6, PX_MIN = 0.7e6;
let pxCap = PX_MAX, pxBad = Infinity;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
const white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
const vbuf = (d) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); return o; };

// ------------------------------------------------------------------ time of day: golden hour (0) → night (1)
const KEYS = [
  { t: 0.0, el: 13, sunC: [1.55, 1.12, 0.72], top: [0.32, 0.48, 0.74], hor: [1.0, 0.76, 0.52], ambS: [0.46, 0.43, 0.46], ambG: [0.26, 0.19, 0.12], fog: [0.95, 0.72, 0.52, 0.010], night: 0 },
  { t: 0.45, el: 4, sunC: [1.7, 0.78, 0.36], top: [0.28, 0.3, 0.55], hor: [1.0, 0.52, 0.3], ambS: [0.4, 0.31, 0.38], ambG: [0.22, 0.13, 0.1], fog: [0.88, 0.52, 0.4, 0.012], night: 0 },
  { t: 0.72, el: -3, sunC: [0.75, 0.3, 0.26], top: [0.12, 0.14, 0.33], hor: [0.55, 0.3, 0.34], ambS: [0.24, 0.23, 0.36], ambG: [0.1, 0.08, 0.11], fog: [0.33, 0.27, 0.38, 0.014], night: 0.35 },
  { t: 1.0, el: -14, sunC: [0, 0, 0], top: [0.02, 0.03, 0.08], hor: [0.07, 0.09, 0.17], ambS: [0.15, 0.18, 0.31], ambG: [0.045, 0.045, 0.075], fog: [0.06, 0.08, 0.15, 0.016], night: 1 },
];
const SUN_AZ = -2.45;   // the sun sets toward the south-west, behind the tall pines
function timeOfDay(t) {
  t = clamp(t, 0, 1); let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = (t - a.t) / (b.t - a.t), m = (x, y) => (Array.isArray(x) ? x.map((v, j) => lerp(v, y[j], k)) : lerp(x, y, k));
  const el = (m(a.el, b.el) * Math.PI) / 180;
  return { sun: [Math.cos(SUN_AZ) * Math.cos(el), Math.sin(SUN_AZ) * Math.cos(el), Math.sin(el)], sunC: m(a.sunC, b.sunC), top: m(a.top, b.top), hor: m(a.hor, b.hor), ambS: m(a.ambS, b.ambS), ambG: m(a.ambG, b.ambG), fog: m(a.fog, b.fog), night: m(a.night, b.night) };
}

// ------------------------------------------------------------------ the lantern-caps: where they grow, and their names
const CAP_SPOTS = [
  [1.6, -6.2, "the Elder Pine"], [-8.2, 2.8, "the West Pine"], [6.8, 5.2, "the Twin Pine"], [-19.5, -9.4, "the Fallen Log"],
  [20, -4, "the Old Log"], [-20.4, 13, "the Moss Log"], [-3, -21.6, "the South Log"],
];

// ------------------------------------------------------------------ loading
let F = null, W = null, state = "loading", trees = [], imps = new Map(), floorTex = null, wick = null, wickBuf = null, owlBuf = null;
let caps = [], flies = [], owl = null, nav = null;
const START = [3, -3.5];
const HIDE = new Set();          // debug: material indices not drawn (__hide)
window.__hide = (...ids) => { HIDE.clear(); ids.forEach((i) => HIDE.add(i)); };
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
// detail distances: trees nearer than this are full meshes, farther ones impostors
const LOD = { ring: 26, young: 10 };
const byMat = new Map();
// open forest floor near (x, y): terrain (not rock or log), clear of walls, searching outward
function findOpen(x, y) {
  for (let r = 0; r < 12; r += 0.25) for (let a = 0; a < TAU; a += 0.4) {
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r, g = W.ground(px, py);
    if (g !== null && W.kind === "ground" && !W.wall(px, py, g + 0.005, g + 0.1)) return [px, py, g];
  }
  return [x, y, W.ground(x, y) ?? 1.5];
}
async function load() {
  F = await loadForest(gl, (k) => ($("ld-bar").style.width = Math.round(k * 80) + "%"));
  $("ld-msg").textContent = "Mapping the forest floor…"; await new Promise((r) => setTimeout(r, 20));
  const tris = worldTriangles(F, ["ground", "rock", "log", "grass", "hero", "young"]);
  W = buildWorld(tris.map((L) => ({ pos: L.pos, kind: L.kind, ground: ["ground", "rock", "log"].includes(L.kind), twoSided: L.kind === "ground", walls: ["rock", "log", "hero", "young"].includes(L.kind), wallBelow: ["hero", "young"].includes(L.kind) ? 2.2 : undefined, cover: L.kind === "grass" })));
  $("ld-bar").style.width = "85%"; $("ld-msg").textContent = "Finding the mouse paths…"; await new Promise((r) => setTimeout(r, 20));
  nav = buildNav(W, START[0], START[1]);
  $("ld-bar").style.width = "92%"; $("ld-msg").textContent = "Painting the far pines…"; await new Promise((r) => setTimeout(r, 20));
  for (const it of F.instances) { const k = it.mesh.mat; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(it); }
  for (const L of byMat.values()) L.sort((a, b) => a.mesh.name < b.mesh.name ? -1 : 1);
  // the ground gets the forest-floor detail texture (unit 1); far trees become impostors baked now
  for (const m of F.materials) if (/ground/i.test(m.name)) m.mode = 5;
  floorTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawFloor()); gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const an = gl.getExtension("EXT_texture_filter_anisotropic"); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  trees = groupTrees(F);
  gl.useProgram(U.program); gl.uniform1f(U.uBake, 1); gl.uniform1f(U.uInst, 1); gl.uniform1i(U.uTex, 0); gl.uniform1f(U.uMode, 0); gl.uniform1f(U.uWind, 0); gl.uniform1f(U.uBlend, 1);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
  const pics = bakeImpostors(gl, space, U, trees, (parts) => {
    for (const p of parts) {
      const mat = F.materials[p.mesh.mat]; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mat.tex || white);
      gl.uniform1f(U.uUseTex, mat.tex ? 1 : 0); gl.uniform1f(U.uCut, mat.alpha === "cut" ? 0.5 : 0);
      bound = null; bindMesh(p.mesh); gl.uniform4fv(U.uBone, IDENTITY); gl.drawElements(gl.TRIANGLES, p.mesh.ni, gl.UNSIGNED_INT, 0);
    }
  });
  gl.uniform1f(U.uBake, 0); gl.uniform1f(U.uBlend, 0); bound = null;
  imps = impostorGeometry(gl, trees, pics);
  // Wick and Old Hush: static skinned buffers (pos.w = 1000 + bone)
  const Wm = buildWick(); wickBuf = { pb: vbuf(Wm.m.pos.subarray(0, Wm.m.n * 4)), cb: vbuf(Wm.m.col.subarray(0, Wm.m.n * 4)), nb: vbuf(Wm.nrm), n: Wm.m.n };
  const Om = buildOwl(); owlBuf = { pb: vbuf(Om.m.pos.subarray(0, Om.m.n * 4)), cb: vbuf(Om.m.col.subarray(0, Om.m.n * 4)), nb: vbuf(Om.nrm), n: Om.m.n };
  caps = makeCaps(gl, CAP_SPOTS.map(([x, y, name]) => [...nav.snap(x, y, 2), name]));
  newGame();
  sizeCanvas();
  $("loading").classList.add("out"); $("hud").classList.remove("hide");
  state = "title"; $("title").classList.remove("hide");
  try { const b = JSON.parse(localStorage.getItem("last-light-best") || "null"); if (b) $("t-best").textContent = `Best: ${b.lit} of 7 lights${b.lit === 7 ? `, with ${fmt(b.spare)} of dusk to spare` : ""}`; } catch (e) { }
  if (AUTO) begin();
}

// ------------------------------------------------------------------ a game: Wick, the fireflies, the owl, the evening
let dayT = 0, playT = 0, lightsLit = 0, caught = 0, endT = 0;
function newGame() {
  const sp = nav.snap(START[0], START[1], 2);
  wick = makeWick(sp[0], sp[1], sp[2], -Math.PI / 2); cam.yaw = wick.h; cam.snap = true; cam.pitch = 0.28;
  for (const c of caps) { c.have = 0; c.lit = false; c.litT = 0; c.next = 0; }
  // fireflies: two near each cap, the rest wherever the grass grows thick
  let ci = 0, n = 0;
  flies = makeFireflies(42, () => {
    n++;
    if (ci < caps.length * 2) { const c = caps[Math.floor(ci++ / 2)], a = Math.random() * TAU, r = 1.2 + Math.random() * 2; return nav.snap(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); }
    for (let k = 0; k < 40; k++) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 23, x = Math.cos(a) * r, y = Math.sin(a) * r; if ((W.grassAt(x, y) > 1.5 || k > 30) && nav.reachable(x, y)) return nav.snap(x, y); }
    return nav.snap(0, 0);
  });
  owl = makeOwl();
  dayT = 0; playT = 0; lightsLit = 0; caught = 0; endT = 0; story.shown = new Set(); story.q = [];
}
function begin() {
  sound.init(); newGame();
  $("title").classList.add("hide"); $("end").classList.add("hide");
  state = "play"; say("intro", "Wick's lantern is lit. The lantern-caps are not.", 4);
  setTimeout(() => say("gather", "Brush past the fireflies to gather them. You can carry six.", 6), 4200);
}
function finish(won) {
  state = won ? "won" : "night"; endT = 0;
  if (won) sound.win();
  const spare = (1 - dayT) * DAY_LEN;
  try { const b = JSON.parse(localStorage.getItem("last-light-best") || "null"); if (!b || lightsLit > b.lit || (lightsLit === b.lit && spare > (b.spare || 0))) localStorage.setItem("last-light-best", JSON.stringify({ lit: lightsLit, spare: won ? spare : 0 })); } catch (e) { }
  setTimeout(() => {
    $("e-title").textContent = won ? "The forest is lit" : "Night falls";
    $("e-text").textContent = won
      ? `Seven lantern-caps glow at the feet of the old pines, and the small ones of the forest find their way home. Wick made it with ${fmt(spare)} of dusk to spare${caught ? `, and lost his fireflies to Old Hush ${caught} time${caught > 1 ? "s" : ""}` : ", and Old Hush never caught him"}.`
      : `The stars are out. ${lightsLit} of the seven lantern-caps are glowing${lightsLit ? " — enough for some of the small ones to find their way home" : ""}. Tomorrow evening, Wick will try again.`;
    $("end").classList.remove("hide"); $("again").focus();
  }, won ? 4500 : 2500);
}
const fmt = (s) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m} min ${r} s` : `${r} s`; };

// story captions: each key is shown once, queued
const story = { shown: new Set(), q: [], t: 0, cur: null };
function say(key, text, dur = 4) { if (story.shown.has(key)) return; story.shown.add(key); story.q.push({ text, dur }); }
function stepStory(dt) {
  if (story.cur && (story.t -= dt) <= 0) { story.cur = null; $("caption").classList.remove("show"); }
  if (!story.cur && story.q.length) { story.cur = story.q.shift(); story.t = story.cur.dur; $("caption").textContent = story.cur.text; $("caption").classList.add("show"); }
}

// ------------------------------------------------------------------ input
const keys = new Set(); let jumpPressed = false;
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  sound.init();
  if (e.code === "Space" && !e.repeat) jumpPressed = true; keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "Enter" && (state === "title" || ((state === "won" || state === "night") && !$("end").classList.contains("hide")))) begin();
  if (e.code === "KeyM") $("mute").textContent = sound.mute() ? "sound on" : "sound off";
  if (e.code === "KeyH") $("help").classList.toggle("hide");
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
$("start").addEventListener("click", begin); $("again").addEventListener("click", begin);
// drag to orbit the camera
let drag = null;
canvas.addEventListener("pointerdown", (e) => { sound.init(); drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => { if (!drag) return; cam.yaw -= (e.clientX - drag.x) * 0.006; cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.004, -0.1, 0.9); drag = { x: e.clientX, y: e.clientY }; cam.held = 1.5; });
canvas.addEventListener("pointerup", () => (drag = null));
function playerInput() {
  const k = keys, f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0), r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  if (k.has("KeyQ")) { cam.yaw += 0.03; cam.held = 1; } if (k.has("KeyE")) { cam.yaw -= 0.03; cam.held = 1; }
  // relative to the camera: forward is where it looks
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw), mx = fx * f + fy * r, my = fy * f - fx * r, l = Math.hypot(mx, my) || 1;
  const s = Math.min(1, Math.hypot(f, r));
  const inp = { mx: (mx / l) * s, my: (my / l) * s, run: k.has("ShiftLeft") || k.has("ShiftRight"), jump: k.has("Space"), jumpPressed };
  jumpPressed = false; return inp;
}
const STILL = { mx: 0, my: 0, run: false, jump: false, jumpPressed: false };

// auto mode: gather fireflies until there are enough for the nearest unlit cap, then carry them there; hide in the
// grass when the owl locks on; jump when blocked
const pilot = { lastX: 0, lastY: 0, stuck: 0, detour: null, detourT: 0, cur: null, best: Infinity, since: 0, ban: new Map() };
function autoInput(dt) {
  const carried = countCarried(flies), open = caps.filter((c) => !c.lit);
  let target = null;
  // targets it could not get closer to recently are skipped for a while (a log or rock in the way)
  for (const [t, until] of pilot.ban) if (until < time) pilot.ban.delete(t);
  const near = (list) => list.filter((p) => !pilot.ban.has(p)).reduce((b, p) => (!b || Math.hypot(p.x - wick.x, p.y - wick.y) < Math.hypot(b.x - wick.x, b.y - wick.y) ? p : b), null);
  const cap = near(open);
  if (cap && carried >= Math.min(CARRY, NEED - cap.have)) target = cap;
  else { const f = near(flies.filter((q) => q.state === "free")); target = f || cap; }
  if (owl.seen && owl.lock > 0.1) { for (let r = 0.3; r < 3 && !pilot.hide; r += 0.3) for (let a = 0; a < TAU; a += 0.5) { const x = wick.x + Math.cos(a) * r, y = wick.y + Math.sin(a) * r; if (W.grassAt(x, y) > COVER * 1.3) { pilot.hide = { x, y }; break; } } if (pilot.hide) target = pilot.hide; } else pilot.hide = null;
  if (pilot.detourT > 0) { pilot.detourT -= dt; target = pilot.detour; }
  if (!target) return STILL;
  // route along the navigation grid (refreshed when the target changes or moves), straight in for the last few cm
  if (pilot.fieldFor !== target || (pilot.fieldT -= dt) < 0) { pilot.field = nav.field(target.x, target.y); pilot.fieldFor = target; pilot.fieldT = 2; }
  const way = Math.hypot(target.x - wick.x, target.y - wick.y) > 0.35 ? nav.steer(pilot.field, wick.x, wick.y) : null;
  const goal = way || target;
  const dx = goal.x - wick.x, dy = goal.y - wick.y, l = Math.hypot(dx, dy) || 1;
  const left = way ? way.d : l;
  if (pilot.cur !== target) { pilot.cur = target; pilot.best = left; pilot.since = 0; }
  if (left < pilot.best - 0.3) { pilot.best = left; pilot.since = 0; } else if ((pilot.since += dt) > 3 && !pilot.hide) { pilot.ban.set(target, time + 12); pilot.cur = null; }
  if (Math.hypot(wick.x - pilot.lastX, wick.y - pilot.lastY) < 0.04) pilot.stuck += dt; else { pilot.stuck = 0; pilot.lastX = wick.x; pilot.lastY = wick.y; }
  let jp = false;
  if (pilot.stuck > 0.4 && wick.ground) { jp = true; pilot.stuck = 0; if (Math.random() < 0.5) { const a = Math.atan2(dy, dx) + (Math.random() < 0.5 ? 1.4 : -1.4); pilot.detour = { x: wick.x + Math.cos(a) * 0.6, y: wick.y + Math.sin(a) * 0.6 }; pilot.detourT = 0.8; } }
  return { mx: dx / l, my: dy / l, run: left > 0.25, jump: !wick.ground && wick.vz < 0, jumpPressed: jp };
}

// ------------------------------------------------------------------ camera: low behind Wick, fixed distance (no zoom), drag to orbit
const cam = { e: [0, 0, 1], t: [1, 0, 1], yaw: 0, pitch: 0.28, held: 0, snap: true };
const CAM_D = 0.42;
function updateCamera(dt) {
  // the camera drifts behind Wick while he runs, unless the player has just orbited it; at the end it rises
  cam.held = Math.max(0, cam.held - dt);
  if (state === "won") { cam.yaw += dt * 0.12; cam.pitch += (0.75 - cam.pitch) * Math.min(1, dt * 0.4); }
  else if (!cam.held && wick.speed > 0.08) { let d = wick.h - cam.yaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; cam.yaw += d * Math.min(1, dt * 1.6); }
  const t = [wick.x, wick.y, wick.z + 0.035], cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const e = [t[0] - Math.cos(cam.yaw) * CAM_D * cp, t[1] - Math.sin(cam.yaw) * CAM_D * cp, t[2] + CAM_D * sp + 0.02];
  const g = W.ground(e[0], e[1], e[2] + 0.5, 0) ?? wick.z; e[2] = Math.max(e[2], g + 0.035);
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * 14);
  for (let i = 0; i < 3; i++) { cam.e[i] += (e[i] - cam.e[i]) * k; cam.t[i] += (t[i] - cam.t[i]) * k; }
  cam.snap = false;
  space.magnifier = 1.4;
  space.lookAt(...cam.e, cam.t[0], cam.t[1], cam.t[2] + 0.02);
}

// ------------------------------------------------------------------ simulation
let stepT = 0;
const unstick = { x: 0, y: 0, t: 0 };

function simulate(dt) {
  const playing = state === "play";
  const inp = !playing ? STILL : AUTO ? autoInput(dt) : playerInput();
  const wasGround = wick.ground;
  stepWick(wick, inp, dt, W);
  // boxed in (pushing for 2.5 s without getting anywhere): hop out to the nearest open floor
  if (playing && Math.hypot(inp.mx, inp.my) > 0.5) {
    if (Math.hypot(wick.x - unstick.x, wick.y - unstick.y) > 0.03) { unstick.x = wick.x; unstick.y = wick.y; unstick.t = 0; }
    else if ((unstick.t += dt) > 2.5) { const p = nav.snap(wick.x, wick.y, 1); Object.assign(wick, { x: p[0], y: p[1], z: p[2], vz: 0, ground: true }); unstick.t = 0; }
  }
  if (wick.ground && wick.speed > 0.1 && (stepT -= dt * (wick.speed * 9)) < 0) { stepT = 1; sound.step(); }
  if (!wasGround && wick.ground) sound.step();
  if (playing) { playT += dt; dayT = Math.min(1, dayT + dt / DAY_LEN); }
  const events = [];
  stepFireflies(flies, caps, wick, lanternPos(wick), dt, time, W, events);
  const exposed = W.grassAt(wick.x, wick.y) < COVER;
  stepOwl(owl, wick, exposed && playing, dt, playing && dayT > OWL_FROM, W, events);
  for (const ev of events) {
    if (ev.type === "collect") { sound.collect(countCarried(flies)); say("first", "Three fireflies wake a lantern-cap. Follow the blue glow.", 5); }
    if (ev.type === "deposit") sound.deposit(ev.cap.have);
    if (ev.type === "lit") { lightsLit++; sound.lit(); flash = 1; banner(`${capName(ev.cap)} is lit`, lightsLit === 1 ? "One light! Six more before dark." : lightsLit < 7 ? `${7 - lightsLit} more before dark.` : "Every light in the forest!"); }
    if (ev.type === "swoop") { sound.whoosh(); }
    if (ev.type === "strike") { const n = scatter(flies, wick, (x, y) => nav.snap(x, y, 0)); sound.screech(); shake = 1; if (n) { caught++; say("strike" + caught, n ? "Hush! The fireflies scatter. Gather them again." : "", 4); } }
    if (ev.type === "miss") { sound.whoosh(); say("miss", "Hush lost you in the grass. Keep to cover!", 4); }
  }
  if (playing && dayT > OWL_FROM) say("owl", "The sun is low. Old Hush is awake. Keep to the long grass.", 6);
  if (playing && dayT > 0.72) say("stars", "The first stars are coming out…", 4);
  if (playing && dayT > 0.9) say("hurry", "Hurry, Wick! The last light is going.", 4);
  if (playing && lightsLit === caps.length) finish(true);
  else if (playing && dayT >= 1) finish(false);
  if (state === "won" || state === "night") endT += dt;
  flash = Math.max(0, flash - dt * 1.5); shake = Math.max(0, shake - dt * 2);
  stepStory(dt);
}
const capName = (c) => c.name.charAt(0).toUpperCase() + c.name.slice(1);
let flash = 0, shake = 0, bannerT = 0;
function banner(title, sub) { $("b-title").textContent = title; $("b-sub").textContent = sub; $("banner").classList.add("show"); bannerT = 3.2; }

// ------------------------------------------------------------------ view culling
const view = { e: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], kx: 1, ky: 1, sx: 1, sy: 1 };
function setupCull() {
  const k = space.magnifier / 1.6, asp = canvas.width / canvas.height;
  Object.assign(view, { e: [space.Xc, space.Yc, space.Zc], x: space.xUnitVec, y: space.yUnitVec, z: space.zUnitVec, kx: 1 / k, ky: 1 / (k * asp) });
  view.sx = Math.sqrt(1 + view.kx * view.kx); view.sy = Math.sqrt(1 + view.ky * view.ky);
}
function inView(c, r, far) {
  const vx = c[0] - view.e[0], vy = c[1] - view.e[1], vz = c[2] - view.e[2];
  const d = vx * view.z[0] + vy * view.z[1] + vz * view.z[2];
  if (d < -r || d > far + r) return false;
  if (Math.abs(vx * view.x[0] + vy * view.x[1] + vz * view.x[2]) > d * view.kx + r * view.sx) return false;
  if (Math.abs(vx * view.y[0] + vy * view.y[1] + vz * view.y[2]) > d * view.ky + r * view.sy) return false;
  return true;
}
// screen position of a world point (null when behind the camera)
function project(x, y, z) {
  const k = space.magnifier / 1.6, vx = x - view.e[0], vy = y - view.e[1], vz = z - view.e[2], d = vx * view.z[0] + vy * view.z[1] + vz * view.z[2];
  const sx = (-(vx * view.x[0] + vy * view.x[1] + vz * view.x[2]) * k) / d, sy = ((vx * view.y[0] + vy * view.y[1] + vz * view.y[2]) * k * (canvas.width / canvas.height)) / d;
  return { x: sx, y: sy, behind: d <= 0 };
}

// ------------------------------------------------------------------ render
const dyn = new Mesh(16000);
let drawn = 0, time = 0, byKind = {};
const FAR = { ring: 75, young: 60, hero: 200, rock: 45, log: 60, grass: 30, ground: 200 };
let bound = null;
function bindMesh(me) {
  if (bound === me) return; bound = me;
  gl.bindBuffer(gl.ARRAY_BUFFER, me.pb); gl.enableVertexAttribArray(space.posId); gl.vertexAttribPointer(space.posId, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, me.cb); gl.enableVertexAttribArray(space.colId); gl.vertexAttribPointer(space.colId, 4, gl.UNSIGNED_BYTE, true, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, me.nb); gl.enableVertexAttribArray(space.nrmId); gl.vertexAttribPointer(space.nrmId, 3, gl.BYTE, true, 4, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, me.ub); gl.enableVertexAttribArray(space.uvId); gl.vertexAttribPointer(space.uvId, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.ib);
}
function drawForest(cut) {
  for (const [mi, list] of byMat) {
    const mat = F.materials[mi]; if ((mat.alpha === "cut") !== cut || HIDE.has(mi)) continue;
    gl.bindTexture(gl.TEXTURE_2D, mat.tex || white);
    gl.uniform1f(U.uUseTex, mat.tex ? 1 : 0); gl.uniform1f(U.uCut, cut ? mat.cutoff : 0); gl.uniform1f(U.uMode, mat.mode);
    for (const it of list) {
      if (it.tree && it.tree.lod !== "full") continue;
      if (!inView(it.c, it.r, FAR[it.kind])) continue;
      const me = it.mesh;
      // branches: the full mesh up close, the twig-less lite one farther away
      const lite = me.lite && Math.hypot(it.c[0] - view.e[0], it.c[1] - view.e[1]) > 5;
      bindMesh(me); if (lite) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.lite.ib); bound = null; }
      gl.uniform4fv(U.uBone, it.m);
      if (me.tiles) { for (const T of me.tiles) if (inView(T.c, T.r, FAR[it.kind])) { gl.drawElements(gl.TRIANGLES, T.count, gl.UNSIGNED_INT, T.first * 4); drawn += T.count; byKind[it.kind] = (byKind[it.kind] || 0) + T.count; } }
      else { const ni = lite ? me.lite.ni : me.ni; gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0); drawn += ni; byKind[it.kind] = (byKind[it.kind] || 0) + ni; }
    }
  }
}
// per tree: full mesh when near (and in view), impostor when far
function chooseLod() {
  for (const T of trees) {
    if (!T.type) { T.lod = "full"; continue; }
    const d = Math.hypot(T.c[0] - view.e[0], T.c[1] - view.e[1]);
    T.lod = d < LOD[T.kind] ? "full" : inView(T.c, T.r, 400) ? "imp" : "off";
  }
}
function drawImpostors() {
  gl.uniform1f(U.uInst, 0); gl.uniform1f(U.uUseTex, 1); gl.uniform1f(U.uCut, 0.45); gl.uniform1f(U.uMode, 3);
  for (const g of imps.values()) {
    gl.bindTexture(gl.TEXTURE_2D, g.tex); bound = null;
    gl.bindBuffer(gl.ARRAY_BUFFER, g.pb); gl.enableVertexAttribArray(space.posId); gl.vertexAttribPointer(space.posId, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.cb); gl.enableVertexAttribArray(space.colId); gl.vertexAttribPointer(space.colId, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.enableVertexAttribArray(space.nrmId); gl.vertexAttribPointer(space.nrmId, 3, gl.BYTE, true, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.ub); gl.enableVertexAttribArray(space.uvId); gl.vertexAttribPointer(space.uvId, 2, gl.FLOAT, false, 0, 0);
    // consecutive far trees merge into one draw
    let a = -1, b = -1;
    for (const T of g.list) { if (T.lod !== "imp") continue; if (T.imp.first === b) b += T.imp.count; else { if (a >= 0) { gl.drawArrays(gl.TRIANGLES, a, b - a); drawn += b - a; } a = T.imp.first; b = a + T.imp.count; } }
    if (a >= 0) { gl.drawArrays(gl.TRIANGLES, a, b - a); drawn += b - a; }
  }
}
const drawSkinned = (B, bones, mode = 0) => { gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uMode, mode); gl.uniform4fv(U.uBone, bones); space.bindBuf(B.pb, B.cb, B.nb); space.noUV(); space.draw(0, B.n); };
const lights = new Float32Array(16);
function render(dt) {
  const L = timeOfDay(dayT);
  if (Q.has("nofog")) L.fog[3] = 0;
  const wb = wickBones(wick, time), lpos = lanternPos(wick), night = L.night, glowK = 0.35 + night * 0.9;
  dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
  // multiply pass: Wick's contact shadow, and the owl's gaze on the ground (darker as it locks on)
  const shadowQuad = (x, y, z, s, k) => dyn.quad4([x - s, y - s, z], [x + s, y - s, z], [x + s, y + s, z], [x - s, y + s, z], [-1, -1, k], [1, -1, k], [1, 1, k], [-1, 1, k], 6);
  shadowQuad(wick.x, wick.y, (W.ground(wick.x, wick.y, wick.z + 0.02, 0) ?? wick.z) + 0.002, 0.035, 0.55);
  if (owl.vis > 0.02 && !owl.dive) { const g = W.ground(owl.hx, owl.hy, 10) ?? wick.z; shadowQuad(owl.hx, owl.hy, g + 0.01, 0.8, (0.45 + owl.aware * 0.3 + owl.lock * 0.4) * owl.vis); }
  const SPR = dyn.n;
  // glow sprites (additive): the lantern, fireflies, caps and their beacons
  dyn.sprite(lpos[0], lpos[1], lpos[2], 0.03, 1.0, 0.72, 0.3);
  dyn.sprite(lpos[0], lpos[1], lpos[2], 0.12, 0.3 * glowK, 0.18 * glowK, 0.05 * glowK);
  for (const f of flies) {
    if (f.state === "spent") continue;
    const b = f.state === "free" ? 0.35 + 0.65 * Math.max(0, Math.sin(f.ph * 2.2 + f.blink)) ** 3 : 0.9 + 0.1 * Math.sin(f.ph * 9);
    dyn.sprite(f.x, f.y, f.z, 0.009, 0.95 * b, 1.3 * b, 0.45 * b);
    dyn.sprite(f.x, f.y, f.z, 0.05, 0.16 * b * glowK, 0.24 * b * glowK, 0.05 * b * glowK);
  }
  for (const c of caps) {
    if (c.lit) {
      const p = 0.85 + 0.15 * Math.sin(time * 2 + c.x), boom = Math.max(0, 1 - c.litT * 0.8);
      dyn.sprite(c.x, c.y, c.z + 0.1, 0.3 + boom * 0.5, 0.55 * p * glowK + boom, 0.42 * p * glowK + boom * 0.8, 0.12 * p * glowK + boom * 0.4);
      // a soft column of light, and motes drifting up
      for (let i = 1; i <= 6; i++) dyn.sprite(c.x, c.y, c.z + 0.1 + i * 0.22, 0.12, 0.14 * glowK / i, 0.11 * glowK / i, 0.04 * glowK / i);
      for (let i = 0; i < 5; i++) { const t = (time * 0.25 + i / 5 + c.x) % 1; dyn.sprite(c.x + Math.sin(i * 7 + time) * 0.08, c.y + Math.cos(i * 5 + time) * 0.08, c.z + 0.12 + t * 0.9, 0.006, 1.0 * (1 - t), 0.9 * (1 - t), 0.4 * (1 - t)); }
    } else {
      // unlit: a cool, patient pulse and a faint column that can be seen across the clearing
      const p = 0.5 + 0.5 * Math.sin(time * 2.4 + c.y), f = c.have / NEED;
      dyn.sprite(c.x, c.y, c.z + 0.12, 0.08, (0.1 + f * 0.3) * p, (0.16 + f * 0.25) * p, 0.35 * p);
      for (let i = 1; i <= 8; i++) dyn.sprite(c.x, c.y, c.z + 0.1 + i * 0.3, 0.07, 0.03 * p, 0.05 * p, 0.12 * p);
    }
  }
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform1i(U.uTex, 0); gl.uniform1f(U.uWind, 1);
  gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunC, L.sunC); gl.uniform3fv(U.uSkyTop, L.top); gl.uniform3fv(U.uSkyHor, L.hor);
  gl.uniform3fv(U.uAmbS, L.ambS); gl.uniform3fv(U.uAmbG, L.ambG); gl.uniform4fv(U.uFog, L.fog); gl.uniform1f(U.uNight, night);
  // point lights: the lantern, then the three nearest lit caps
  lights.fill(0); lights.set([lpos[0], lpos[1], lpos[2], 0.0015 + night * 0.004], 0);
  caps.filter((c) => c.lit).sort((a, b) => Math.hypot(a.x - wick.x, a.y - wick.y) - Math.hypot(b.x - wick.x, b.y - wick.y)).slice(0, 3).forEach((c, i) => lights.set([c.x, c.y, c.z + 0.1, (0.006 + night * 0.018) * (1 + Math.max(0, 1 - c.litT) * 2)], 4 + i * 4));
  gl.uniform4fv(U.uLights, lights);
  const focus = Math.hypot(cam.t[0] - cam.e[0], cam.t[1] - cam.e[1], cam.t[2] - cam.e[2]);
  gl.uniform3f(U.uDof, focus, 0.5, 0.35);
  space.applyCamera(); setupCull(); drawn = 0; byKind = {}; bound = null;
  gl.uniform1f(U.uInst, 0); gl.uniform1f(U.uMode, 0); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uBlend, 0);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.noNormals(); space.noUV(); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.uniform1i(U.uDetail, 1); gl.activeTexture(gl.TEXTURE0);
  chooseLod();
  gl.uniform1f(U.uInst, 1);
  drawForest(false); drawForest(true);
  drawImpostors();
  gl.uniform1f(U.uInst, 0); bound = null;
  // the lantern-caps (dusky and lit by the scene, or glowing and unlit), Wick, Old Hush
  for (const c of caps) { if (!inView([c.x, c.y, c.z + 0.05], 0.15, 60)) continue; const B = c.lit ? c.glow : c.dark; gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uMode, c.lit ? 1 : 0); space.bindBuf(B.pb, B.cb, B.nb); space.noUV(); space.draw(0, B.n); }
  drawSkinned(wickBuf, wb);
  if (owl.vis > 0.02) drawSkinned(owlBuf, owlBones(owl));
  // contact shadows and gaze (multiply), glow sprites (additive, keeping the depth-of-field alpha)
  gl.enable(gl.BLEND); gl.depthMask(false); space.bind(true); space.noNormals(); space.noUV();
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.draw(6, SPR - 6);
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); space.draw(SPR, dyn.n - SPR);
  gl.disable(gl.BLEND); gl.depthMask(true);
  gl.disableVertexAttribArray(space.nrmId); gl.disableVertexAttribArray(space.uvId);
  space.noNormals(); space.noUV();
  // god rays toward the sun while it is up and in front of the camera
  const sun = project(view.e[0] + L.sun[0] * 100, view.e[1] + L.sun[1] * 100, view.e[2] + L.sun[2] * 100);
  const sunK = !sun.behind ? clamp(L.sun[2] * 6 + 0.2, 0, 1) * 0.9 : 0;
  post.end({ time, fade: Math.min(1, time * 0.6), flash: flash * 0.6, sunUV: [sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5], sunK: Q.has("norays") ? 0 : sunK, maxR: Q.has("nodof") ? 0 : canvas.height * 0.0055, skyCoc: 0.35 });
  return L;
}

// ------------------------------------------------------------------ HUD
function hud(dt) {
  const carried = countCarried(flies);
  $("caps").innerHTML = caps.map((c) => `<i class="cap ${c.lit ? "lit" : c.have ? "part" : ""}"></i>`).join("");
  $("flies").innerHTML = Array.from({ length: CARRY }, (_, i) => `<i class="fly ${i < carried ? "on" : ""}"></i>`).join("");
  $("count").textContent = `${lightsLit} / ${caps.length}`;
  // the sun sinks along its arc
  const a = Math.PI * (1 - dayT * 0.98), r = 46; $("sundot").setAttribute("cx", 60 + Math.cos(a) * r); $("sundot").setAttribute("cy", 56 - Math.sin(a) * r);
  $("sundot").setAttribute("fill", dayT < 0.5 ? "#ffd27a" : dayT < 0.75 ? "#ff8a5c" : "#9fb5ff");
  $("dusk").textContent = state === "play" ? (dayT < 0.72 ? "golden hour" : dayT < 0.9 ? "dusk" : "last light") : "";
  // the owl: watching, then locking on
  $("hush").className = "glass " + (owl.active && state === "play" ? (owl.lock > 0.05 || owl.dive ? "lock" : owl.seen ? "seen" : "") : "off");
  $("hush-t").textContent = owl.dive ? "Old Hush dives!" : owl.lock > 0.05 ? "Old Hush sees you!" : owl.seen ? "Old Hush is watching" : "Hidden in the grass";
  // a compass toward the nearest unlit cap (or the nearest one still needing fireflies)
  const open = caps.filter((c) => !c.lit), tgt = open.reduce((b, c) => (!b || Math.hypot(c.x - wick.x, c.y - wick.y) < Math.hypot(b.x - wick.x, b.y - wick.y) ? c : b), null);
  if (tgt && state === "play") {
    const ang = Math.atan2(tgt.y - wick.y, tgt.x - wick.x) - cam.yaw, dist = Math.hypot(tgt.x - wick.x, tgt.y - wick.y);
    $("arrow").style.transform = `rotate(${(-ang * 180) / Math.PI}deg)`; $("compass").classList.remove("hide");
    $("c-dist").textContent = dist < 1 ? "here" : `${Math.round(dist)} m`; $("c-name").textContent = tgt.name;
  } else $("compass").classList.add("hide");
  if (bannerT > 0 && (bannerT -= dt) <= 0) $("banner").classList.remove("show");
  $("shake").style.transform = shake ? `translate(${(Math.random() - 0.5) * 8 * shake}px, ${(Math.random() - 0.5) * 8 * shake}px)` : "";
}

// ------------------------------------------------------------------ loop
let fps = 0, fN = 0, fT = 0, last = performance.now();
const ar = { sum: 0, n: 0, t: 0, good: 0 };
function adaptRes(ms) {
  if (ms > 100) return;
  ar.sum += ms; ar.n++; ar.t += ms;
  if (ar.t < 2000) return;
  const avg = ar.sum / ar.n; ar.sum = ar.n = ar.t = 0;
  if (avg > 19 && pxCap > PX_MIN) { pxBad = Math.min(pxBad, pxCap); pxCap = Math.max(PX_MIN, pxCap * 0.75); ar.good = 0; sizeCanvas(); }
  else if (avg <= 17.5 && (ar.good += 2) >= 8 && pxCap < PX_MAX && pxCap * 1.15 < pxBad * 0.98) { pxCap = Math.min(PX_MAX, pxCap * 1.15); ar.good = 0; sizeCanvas(); }
}
const prof = { cpu: 0, gap: 0 };
function frame(now) {
  const ms = now - last, dt = clamp(ms / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; $("fps").textContent = `${fps} fps`; }
  if (state !== "loading") {
    adaptRes(ms); time += dt;
    try {
      const t0 = performance.now();
      simulate(dt); updateCamera(dt); render(dt); hud(dt); sound.ambience(dt, dayT);
      if (PROF) { prof.cpu += (performance.now() - t0 - prof.cpu) * 0.05; prof.gap += (ms - prof.gap) * 0.05; }
    } catch (e) { if (!frame.err) { frame.err = 1; console.error("Last Light:", e); } }
  }
  requestAnimationFrame(frame);
}
// debug hooks
window.__ll = () => ({ state, fps, drawn, byKind, px: canvas.width * canvas.height, dayT: +dayT.toFixed(3), lit: lightsLit, carried: flies.length ? countCarried(flies) : 0, caught, owl: owl && { active: owl.active, seen: owl.seen, lock: +owl.lock.toFixed(2) }, wick: wick && [+wick.x.toFixed(2), +wick.y.toFixed(2), +wick.z.toFixed(3)], prof: { cpu: +prof.cpu.toFixed(2), gap: +prof.gap.toFixed(2) } });
window.__world = () => W; window.__forest = () => F; window.__wick = () => wick; window.__caps = () => caps;
window.__day = (t) => (dayT = t); window.__nav = () => nav;
// fast-forward the simulation without rendering
window.__ff = (sec, dt = 1 / 60) => { for (let k = 0; k < sec / dt; k++) { time += dt; simulate(dt); } return window.__ll(); };
window.__begin = begin;
load().catch((e) => { console.error(e); $("ld-msg").textContent = "Could not load: " + e.message; });
requestAnimationFrame(frame);
