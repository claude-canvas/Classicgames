// GOLDEN HARE — a sunrise bow hunt for rabbits in the pine forest, and the one golden hare. See DESIGN.md.
// Rendered with Space.js (via GameSpace) + the arcade's shaders and post chain. The forest engine (forest / lod /
// world / nav) comes from The Hollow Pines; bunny.js is the rabbits, bow.js the bow and arrows, sound.js the audio.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, clamp, lerp, mulberry32, blob, limb, smoothNormals } from "./mesh.js";
import { loadForest, worldTriangles } from "./forest.js";
import { buildWorld } from "./world.js";
import { groupTrees, bakeImpostors, impostorGeometry, drawFloor } from "./lod.js";
import { buildNav } from "./nav.js";
import { buildBunny, makeBunny, stepBunny, startle, bunnyBones } from "./bunny.js";
import { buildBowFrame, buildArrow, stepArrow, aimPitch } from "./bow.js";
import { sound } from "./sound.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const Q = new URLSearchParams(location.search), AUTO = Q.has("auto"), DEV = Q.has("dev"), PROF = Q.has("prof");
const HUNT_LEN = 240, QUIVER = 12, RABBITS = 10, GOLDEN_AT = 115, GOLDEN_FOR = 40, RADIUS = 0.3;
const EYE = 1.62, EYE_LOW = 1.05, WALK = 1.7, SNEAK = 0.85, RUN = 3.6;

// ------------------------------------------------------------------ dev: live reload when a source file changes
if (DEV) {
  const files = ["main.js", "bunny.js", "bow.js", "sound.js", "forest.js", "world.js", "lod.js", "nav.js", "shaders.js", "post.js", "mesh.js", "GameSpace.js", "index.html"];
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
// debug switches for performance hunting: ?nowind, ?nodither, ?noimp
if (Q.has("nodither")) { const o = gl.uniform4f.bind(gl); gl.uniform4f = (l, ...v) => (l === U.uDither ? o(l, 1, 0, 0, 0) : o(l, ...v)); }
if (Q.has("nowind")) { const o = gl.uniform2f.bind(gl); gl.uniform2f = (l, ...v) => (l === U.uSway ? o(l, 0, v[1]) : o(l, ...v)); }
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
const vbuf = (d, usage = gl.STATIC_DRAW) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o); gl.bufferData(gl.ARRAY_BUFFER, d, usage); return o; };
const upload = (M) => ({ pb: vbuf(M.m.pos.subarray(0, M.m.n * 4)), cb: vbuf(M.m.col.subarray(0, M.m.n * 4)), nb: vbuf(M.nrm), n: M.m.n });

// ------------------------------------------------------------------ the morning: sunrise (0) → mid-morning (1)
const KEYS = [
  { t: 0, el: 3.5, sunC: [1.75, 0.98, 0.56], top: [0.34, 0.44, 0.7], hor: [1.0, 0.7, 0.52], ambS: [0.46, 0.41, 0.46], ambG: [0.25, 0.18, 0.12], fog: [0.96, 0.76, 0.62, 0.03] },
  { t: 0.45, el: 11, sunC: [1.75, 1.2, 0.78], top: [0.32, 0.48, 0.78], hor: [0.98, 0.8, 0.66], ambS: [0.48, 0.47, 0.5], ambG: [0.26, 0.2, 0.13], fog: [0.92, 0.82, 0.72, 0.02] },
  { t: 1, el: 22, sunC: [1.65, 1.36, 1.05], top: [0.3, 0.5, 0.84], hor: [0.84, 0.84, 0.8], ambS: [0.5, 0.53, 0.57], ambG: [0.27, 0.23, 0.15], fog: [0.84, 0.84, 0.82, 0.013] },
];
const SUN_AZ = 0.55;
function morning(t) {
  t = clamp(t, 0, 1); const i = t > KEYS[1].t ? 1 : 0, a = KEYS[i], b = KEYS[i + 1], k = (t - a.t) / (b.t - a.t);
  const m = (x, y) => (Array.isArray(x) ? x.map((v, j) => lerp(v, y[j], k)) : lerp(x, y, k)), el = (m(a.el, b.el) * Math.PI) / 180;
  return { sun: [Math.cos(SUN_AZ) * Math.cos(el), Math.sin(SUN_AZ) * Math.cos(el), Math.sin(el)], sunC: m(a.sunC, b.sunC), top: m(a.top, b.top), hor: m(a.hor, b.hor), ambS: m(a.ambS, b.ambS), ambG: m(a.ambG, b.ambG), fog: m(a.fog, b.fog) };
}

// ------------------------------------------------------------------ loading
let F = null, W = null, nav = null, state = "loading", trees = [], imps = new Map(), floorTex = null;
let bunnyBufs = {}, arrowBuf = null, bowBuf = null, satchelBuf = null;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
const LOD = { ring: 20, young: 9 };
const byMat = new Map();
// the world as the rabbits and arrows see it (the playable clearing is ±27 m)
const ARENA = 27;
const world = { ground: (x, y, z) => W.ground(x, y, z ?? 1e6, 0), wall: (x, y, lo, hi) => W.wall(x, y, lo, hi), inside: (x, y) => Math.abs(x) < ARENA && Math.abs(y) < ARENA };
async function load() {
  F = await loadForest(gl, (k) => ($("ld-bar").style.width = Math.round(k * 75) + "%"));
  $("ld-msg").textContent = "The dew is on the grass…"; await new Promise((r) => setTimeout(r, 20));
  const tris = worldTriangles(F, ["ground", "rock", "log", "grass", "hero", "young"]);
  W = buildWorld(tris.map((L) => ({ pos: L.pos, kind: L.kind, ground: ["ground", "rock", "log"].includes(L.kind), twoSided: L.kind === "ground", walls: ["rock", "log", "hero", "young"].includes(L.kind), wallBelow: ["hero", "young"].includes(L.kind) ? 2.2 : undefined, cover: L.kind === "grass" })));
  $("ld-bar").style.width = "82%"; await new Promise((r) => setTimeout(r, 20));
  nav = buildNav(W, 0, 0, { res: 0.3, lo: 0.35, hi: 1.7, step: 0.3, radius: RADIUS + 0.05 });
  $("ld-bar").style.width = "90%"; $("ld-msg").textContent = "The sun is coming up through the pines…"; await new Promise((r) => setTimeout(r, 20));
  for (const it of F.instances) { const k = it.mesh.mat; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(it); }
  for (const L of byMat.values()) L.sort((a, b) => a.mesh.name < b.mesh.name ? -1 : 1);
  for (const m of F.materials) if (/ground/i.test(m.name)) m.mode = 5;
  floorTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawFloor()); gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const an = gl.getExtension("EXT_texture_filter_anisotropic"); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  trees = groupTrees(F);
  gl.useProgram(U.program); gl.uniform1f(U.uImp, 0); gl.uniform4f(U.uDither, 1, 0, 0, 0); gl.uniform2f(U.uSway, 0, 0); gl.uniform1f(U.uBake, 1); gl.uniform1f(U.uInst, 1); gl.uniform1i(U.uTex, 0); gl.uniform1f(U.uMode, 0); gl.uniform1f(U.uWind, 0); gl.uniform1f(U.uBlend, 1);
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
  for (const c of ["brown", "grey", "gold"]) bunnyBufs[c] = upload(buildBunny(c));
  arrowBuf = upload(buildArrow());
  bowBuf = { pb: gl.createBuffer(), cb: gl.createBuffer(), nb: gl.createBuffer(), n: 0, draw: -1 };
  satchelBuf = upload(buildSatchel());
  newHunt();
  sizeCanvas();
  $("loading").classList.add("out"); $("hud").classList.remove("hide");
  state = "title"; $("title").classList.remove("hide");
  try { const b = JSON.parse(localStorage.getItem("golden-hare-best") || "null"); if (b) $("t-best").textContent = `Best: ${b.score.toLocaleString()} points${b.golden ? " · caught the Golden Hare" : ""}`; } catch (e) { }
  if (AUTO) begin();
}
// the satchel at the start, where the quiver refills: a wicker basket with a handle, a checked cloth and spare arrows
function buildSatchel() {
  const m = new Mesh(9000), WICKER = [0.62, 0.45, 0.26], DARK = [0.42, 0.29, 0.16];
  blob(m, [0.6, 0.3, 0.13], 0.2, 0.15, 0.13, WICKER, 0, 18, 10, (i, j) => (j > 6 ? 0.55 : 1) * (1 + 0.04 * Math.sin(i * 3)), (i, j) => ((i + j) % 2 ? WICKER : DARK));
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI; limb(m, [0.6 + Math.cos(a) * 0.17, 0.3, 0.22 + Math.sin(a) * 0.17], [0.6 + Math.cos(a + Math.PI / 12) * 0.17, 0.3, 0.22 + Math.sin(a + Math.PI / 12) * 0.17], 0.012, 0.012, DARK, 0, 5); }
  blob(m, [0.6, 0.3, 0.24], 0.17, 0.13, 0.03, [0.85, 0.8, 0.72], 0, 14, 5, null, (i) => (Math.floor(i / 2) % 2 ? [0.82, 0.78, 0.7] : [0.6, 0.18, 0.15]));
  for (let k = 0; k < 6; k++) { const x = 0.52 + k * 0.03; limb(m, [x, 0.27, 0.15], [x + 0.05, 0.35, 0.62], 0.004, 0.004, [0.8, 0.66, 0.46], 0, 4); blob(m, [x + 0.045, 0.345, 0.6], 0.012, 0.004, 0.03, k % 2 ? [0.95, 0.95, 0.9] : [0.82, 0.14, 0.1], 0, 6, 4); }
  return { m, nrm: smoothNormals(m.pos, m.n) };
}

// ------------------------------------------------------------------ a hunt
const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, eye: EYE, crouch: false, speed: 0, bob: 0, noise: 2, moving: false, arrows: QUIVER, draw: 0, drawT: 0, sway: 0 };
let bunnies = [], arrows = [], sparks = [], motes = [], huntT = 0, score = 0, bagged = 0, shots = 0, hits = 0, longest = 0, golden = null, goldenDone = false, goldenCaught = false, endT = 0, spawnT = 0, start = [0, 0, 0];
const rnd = mulberry32(99);
function farSpot(minD) {
  for (let k = 0; k < 60; k++) { const x = (Math.random() * 2 - 1) * (ARENA - 3), y = (Math.random() * 2 - 1) * (ARENA - 3); if (!nav.reachable(x, y) || Math.hypot(x - player.x, y - player.y) < minD) continue; if (k < 40 && W.grassAt(x, y) < 1) continue; return nav.snap(x, y, 1); }
  return nav.snap((Math.random() * 2 - 1) * 20, (Math.random() * 2 - 1) * 20, 1);
}
function newHunt() {
  // start in the most open spot near the middle, facing the low sun
  let st = nav.snap(0, 0, 4), best = -1;
  for (let k = 0; k < 40; k++) { const c = nav.snap((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 4); let open = 0; for (let a = 0; a < TAU; a += TAU / 16) for (let r = 0.5; r <= 5; r += 0.5) { if (W.wall(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 0.35, c[2] + 1.7)) break; open++; } if (open > best) { best = open; st = c; } }
  start = st;
  Object.assign(player, { x: st[0], y: st[1], z: st[2], yaw: SUN_AZ + 0.5, pitch: 0.02, eye: EYE, crouch: false, arrows: QUIVER, draw: 0, drawT: 0, sway: 0 });
  bunnies = []; for (let i = 0; i < RABBITS; i++) { const p = farSpot(12); bunnies.push(Object.assign(makeBunny(p[0], p[1], p[2]), { coat: Math.random() < 0.65 ? "brown" : "grey" })); }
  arrows = []; sparks = []; huntT = 0; score = 0; bagged = 0; shots = 0; hits = 0; longest = 0; golden = null; goldenDone = false; goldenCaught = false; endT = 0; spawnT = 0;
  motes = Array.from({ length: 150 }, () => ({ x: (rnd() - 0.5) * 24, y: (rnd() - 0.5) * 24, z: rnd() * 4, ph: rnd() * 100, seed: rnd() < 0.18 }));
  story.q = []; story.shown = new Set();
}
function begin() {
  sound.init(); newHunt();
  $("title").classList.add("hide"); $("end").classList.add("hide");
  state = "play"; if (!AUTO) lockPointer();
  say("a", "First light. The rabbits are out in the dew.", 4); say("b", "Sneak (C) to get close. Hold the mouse to draw, let go to shoot.", 6);
}
function finish() {
  state = "done"; endT = 0; sound.end(); try { document.exitPointerLock?.(); } catch (e) { }
  const rank = score >= 6000 ? "Legend of the Pines" : score >= 3500 ? "Marksman" : score >= 1800 ? "Hunter" : score >= 600 ? "Forager" : "Novice";
  try { const b = JSON.parse(localStorage.getItem("golden-hare-best") || "null"); if (!b || score > b.score) localStorage.setItem("golden-hare-best", JSON.stringify({ score, golden: goldenCaught })); } catch (e) { }
  setTimeout(() => {
    $("e-rank").textContent = rank; $("e-score").textContent = score.toLocaleString();
    $("e-stats").innerHTML = `<div><b>${bagged}</b>rabbits</div><div><b>${shots ? Math.round((hits / shots) * 100) : 0}%</b>accuracy</div><div><b>${longest.toFixed(0)} m</b>longest shot</div><div><b>${goldenCaught ? "yes" : "no"}</b>golden hare</div>`;
    $("e-text").textContent = goldenCaught ? "Old Maud will tell the whole village: you brought home the Golden Hare." : bagged ? "The sun is up, and Maud's patch is safe for another day." : "The rabbits had the better of you this morning.";
    $("end").classList.remove("hide"); $("again").focus(); if (AUTO) setTimeout(begin, 6000);
  }, 1200);
}
const story = { shown: new Set(), q: [], t: 0, cur: null };
function say(key, text, dur = 4) { if (story.shown.has(key)) return; story.shown.add(key); story.q.push({ text, dur }); }
function stepStory(dt) {
  if (story.cur && (story.t -= dt) <= 0) { story.cur = null; $("sub").classList.remove("show"); }
  if (!story.cur && story.q.length) { story.cur = story.q.shift(); story.t = story.cur.dur; $("sub").textContent = story.cur.text; $("sub").classList.add("show"); }
}

// ------------------------------------------------------------------ input
const keys = new Set(); let mouseDown = false;
function lockPointer() { try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { }); } catch (e) { } }
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  sound.init(); keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyM") sound.mute();
  if (e.code === "KeyR" && state === "play") refill();
  if (e.code === "Enter" && (state === "title" || !$("end").classList.contains("hide"))) begin();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); mouseDown = false; });
canvas.addEventListener("mousedown", (e) => { sound.init(); if (state === "play" && document.pointerLockElement !== canvas) { lockPointer(); return; } if (e.button === 0) mouseDown = true; });
addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mousemove", (e) => { if (document.pointerLockElement !== canvas || state !== "play") return; const k = 0.0021 / (1 + player.draw * 0.3); player.yaw -= e.movementX * k; player.pitch = clamp(player.pitch - e.movementY * k, -1.3, 1.3); });
$("start").addEventListener("click", begin); $("again").addEventListener("click", begin);
function playerInput() {
  const k = keys;
  return { f: (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0), r: (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0), run: k.has("ShiftLeft") || k.has("ShiftRight"), sneak: k.has("KeyC") || k.has("ControlLeft"), draw: mouseDown };
}
function refill() { if (Math.hypot(player.x - start[0], player.y - start[1]) < 3) { player.arrows = QUIVER; say("refill" + Math.floor(huntT), "You fill the quiver from the satchel.", 2.5); } else say("far" + Math.floor(huntT / 20), "The satchel is back where you started.", 2.5); }

// ------------------------------------------------------------------ the bot (?auto): stalk the nearest calm rabbit, solve the arc, shoot
const bot = { target: null, field: null, fieldFor: null, fieldT: 0, aimT: 0, lx: 0, ly: 0, stuck: 0, unT: 0, side: 1 };
const ang = (d) => { while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
function botInput(dt) {
  // a rabbit it has missed three times (something in the way) is left alone for 20 s
  const live = bunnies.filter((b) => b.state !== "hit" && b.state !== "gone" && !((b.botMiss || 0) >= 3 && time < (b.botUntil || 0)));
  const pick = (golden && golden.state !== "hit" && golden.state !== "gone" ? [golden] : []).concat(live).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  // low on arrows: gather the spent ones nearby
  const spent = arrows.filter((a) => a.state === "stuck").sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  let goal = null, sneak = false, shoot = false;
  const reachSpent = arrows.filter((a) => a.state === "stuck" && nav.reachable(a.x, a.y) && !bot.skip?.has(a)).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  void spent;
  if (player.arrows === 0 && !reachSpent) { if (Math.hypot(player.x - start[0], player.y - start[1]) < 2.5) refill(); else goal = { x: start[0], y: start[1] }; }
  else if (player.arrows < 3 && reachSpent) { goal = reachSpent; if (bot.goalFor !== goal) { bot.goalFor = goal; bot.goalT = 0; } if ((bot.goalT += dt) > 12) { (bot.skip ||= new Set()).add(goal); } }
  else if (pick && player.arrows > 0) {
    const d = Math.hypot(pick.x - player.x, pick.y - player.y);
    if (d < 24 && pick.state !== "flee") {
      // aim: lead a hopping rabbit a little, and lift for the drop
      const v = 18 + 42 * Math.min(1, player.draw), tx = pick.x + (pick.hopTo ? (pick.hopTo[0] - pick.x) * 0.5 : 0), ty = pick.y + (pick.hopTo ? (pick.hopTo[1] - pick.y) * 0.5 : 0);
      const dz = pick.z + 0.13 - (player.z + player.eye), dd = Math.hypot(tx - player.x, ty - player.y);
      player.yaw += ang(Math.atan2(ty - player.y, tx - player.x) - player.yaw) * Math.min(1, dt * 7);
      player.pitch += (aimPitch(60, dd, dz) - player.pitch) * Math.min(1, dt * 7);
      bot.aimT += dt;
      shoot = player.draw < 1 || bot.aimT < 1.3;
      if (!shoot) { bot.aimT = 0; pick.botMiss = (pick.botMiss || 0) + 1; if (pick.botMiss >= 3) pick.botUntil = time + 20; if (pick.botMiss > 3) pick.botMiss = 1; }
      return { f: 0, r: 0, run: false, sneak: true, draw: shoot };
    }
    goal = pick; sneak = d < 30;
  }
  bot.aimT = 0;
  if (!goal) return { f: 0, r: 0, run: false, sneak: false, draw: false };
  if (bot.fieldFor !== goal || (bot.fieldT -= dt) < 0) { bot.field = nav.field(goal.x, goal.y); bot.fieldFor = goal; bot.fieldT = 1.5; }
  const way = nav.steer(bot.field, player.x, player.y) || goal;
  player.yaw += ang(Math.atan2(way.y - player.y, way.x - player.x) - player.yaw) * Math.min(1, dt * 4); player.pitch += (-0.05 - player.pitch) * dt * 2;
  if (Math.hypot(player.x - bot.lx, player.y - bot.ly) > 0.15) { bot.lx = player.x; bot.ly = player.y; bot.stuck = 0; } else if ((bot.stuck += dt) > 1) { bot.stuck = 0; bot.unT = 0.7; bot.side = Math.random() < 0.5 ? -1 : 1; }
  if (bot.unT > 0) { bot.unT -= dt; return { f: -0.6, r: bot.side, run: false, sneak: false, draw: false }; }
  return { f: 1, r: 0, run: false, sneak, draw: false };
}

// ------------------------------------------------------------------ the player: walking, sneaking, the bow
function stepPlayer(inp, dt) {
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), mag = Math.hypot(inp.f, inp.r) || 1;
  player.crouch = inp.sneak;
  const run = inp.run && !inp.sneak && inp.f > 0 && player.draw === 0;
  const sp = (inp.f || inp.r ? (run ? RUN : inp.sneak ? SNEAK : WALK) : 0) * (player.draw > 0 ? 0.5 : 1);
  const vx = ((cy * inp.f + sy * inp.r) / mag) * sp, vy = ((sy * inp.f - cy * inp.r) / mag) * sp;
  const blocked = (x, y) => { const g = W.ground(x, y, player.z + 0.4, 0) ?? player.z; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; if (W.wall(x + Math.cos(a) * RADIUS, y + Math.sin(a) * RADIUS, g + 0.35, g + 1.7)) return true; } return W.wall(x, y, g + 0.35, g + 1.7) || !world.inside(x, y); };
  let nx = player.x + vx * dt, ny = player.y + vy * dt;
  if (blocked(nx, ny)) { if (!blocked(nx, player.y)) ny = player.y; else if (!blocked(player.x, ny)) nx = player.x; else { nx = player.x; ny = player.y; } }
  const g = W.ground(nx, ny, player.z + 0.4, 0), moved = Math.hypot(nx - player.x, ny - player.y) / Math.max(dt, 1e-4);
  if (g !== null) { player.x = nx; player.y = ny; player.z += (g - player.z) * Math.min(1, dt * 12); }
  player.speed = g !== null && moved > 0.2 ? sp : 0; player.moving = player.speed > 0;
  player.eye += ((inp.sneak ? EYE_LOW : EYE) - player.eye) * Math.min(1, dt * 8);
  // how far away the rabbits can hear you
  player.noise = !player.moving ? 2 : run ? 18 : inp.sneak ? 3.5 : 9;
  if (player.moving) { const before = player.bob; player.bob += dt * sp * 2.2; if (Math.floor(before / Math.PI) !== Math.floor(player.bob / Math.PI)) sound.step(inp.sneak); }
  // the bow: hold to draw, release to shoot; held too long, the aim starts to shake
  if (inp.draw && player.arrows > 0) { const was = player.draw; player.draw = Math.min(1, player.draw + dt / 0.8); player.drawT += dt; if (Math.floor(was * 6) !== Math.floor(player.draw * 6) && player.draw < 1) sound.creak(player.draw); }
  else if (player.draw > 0) { if (player.draw > 0.2) shoot(); player.draw = 0; player.drawT = 0; }
  player.sway = player.drawT > 3 ? Math.min(1, (player.drawT - 3) / 3) : 0;
  // pick up spent arrows by walking over them
  for (const a of arrows) if (a.state === "stuck" && Math.hypot(a.x - player.x, a.y - player.y) < 1.2 && player.arrows < QUIVER) { a.state = "gone"; player.arrows++; sound.step(true); }
  $("prompt").textContent = Math.hypot(player.x - start[0], player.y - start[1]) < 3 && player.arrows < QUIVER ? "R — refill the quiver" : player.arrows === 0 ? "Out of arrows — pick some up, or go back to the satchel" : "";
}
function aimDir() {
  const sw = player.sway * 0.03, yaw = player.yaw + Math.sin(time * 1.7) * sw + Math.sin(time * 4.1) * sw * 0.4, pitch = player.pitch + Math.sin(time * 2.3) * sw * 0.8;
  return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
}
function shoot() {
  const d = aimDir(), v = 18 + 42 * player.draw, e = cam.e;
  arrows.push({ x: e[0] + Math.sin(player.yaw) * 0.08, y: e[1] - Math.cos(player.yaw) * 0.08, z: e[2] - 0.05, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, state: "fly", from: [player.x, player.y], t: 0 });
  player.arrows--; shots++; sound.twang(player.draw);
}

// ------------------------------------------------------------------ simulation
function simulate(dt) {
  if (state === "play") {
    huntT += dt;
    stepPlayer(AUTO ? botInput(dt) : playerInput(), dt);
    const events = [], pp = { x: player.x, y: player.y, z: player.z, noise: player.noise, moving: player.moving };
    for (const b of bunnies) stepBunny(b, pp, dt, world, events);
    if (golden) { stepBunny(golden, pp, dt, world, events); golden.life -= dt; if (golden.life <= 0 && golden.state !== "hit" && golden.state !== "gone") { golden.state = "gone"; say("gone", "The Golden Hare is gone into the morning.", 4); } }
    for (const ev of events) if (ev.type === "flee") { sound.rustle(); if (ev.b.golden) say("gflee", "It's seen you — the Golden Hare is off!", 3); }
    // arrows in flight: rabbits, earth, wood
    const targets = bunnies.concat(golden ? [golden] : []).filter((b) => b.state !== "hit" && b.state !== "gone").flatMap((b) => {
      const fx = Math.cos(b.h), fy = Math.sin(b.h); return [{ c: [b.x, b.y, b.z + 0.13], r: 0.15, ref: b }, { c: [b.x + fx * 0.13, b.y + fy * 0.13, b.z + 0.21], r: 0.07, ref: b }];
    });
    for (const a of arrows) {
      if (a.state !== "fly") continue;
      a.t += dt; const res = stepArrow(a, dt, world, targets);
      if (!res) continue;
      if (res.type === "hit") { const b = res.target; hitRabbit(b, a); Object.assign(a, { state: "stuck", x: b.x, y: b.y, z: (W.ground(b.x, b.y, b.z + 0.5, 0) ?? b.z) + 0.05, dir: [a.vx, a.vy, -Math.abs(a.vz) - 4] }); }
      else if (res.type === "lost") a.state = "gone";
      else { a.state = "stuck"; sound.thunk(res.type === "wood"); for (const b of bunnies.concat(golden ? [golden] : [])) if (Math.hypot(b.x - a.x, b.y - a.y) < 4) startle(b, { x: a.x, y: a.y }); }
    }
    // rabbits come back in from the edges
    bunnies = bunnies.filter((b) => b.state !== "gone");
    if (bunnies.length < RABBITS && (spawnT -= dt) <= 0) { spawnT = 5; const p = farSpot(18); bunnies.push(Object.assign(makeBunny(p[0], p[1], p[2]), { coat: Math.random() < 0.65 ? "brown" : "grey" })); }
    // the Golden Hare
    if (!goldenDone && huntT > GOLDEN_AT) { goldenDone = true; const p = farSpot(20); golden = Object.assign(makeBunny(p[0], p[1], p[2], true), { coat: "gold", life: GOLDEN_FOR }); sound.chime(); banner("The Golden Hare", "Somewhere in the clearing — listen for the chime"); }
    if (huntT >= HUNT_LEN) finish();
  } else if (state === "done") endT += dt;
  for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz += (s.fluff ? -0.15 : -1.2) * dt; s.vx *= 1 - dt * (s.fluff ? 1.5 : 0.5); s.vy *= 1 - dt * (s.fluff ? 1.5 : 0.5); s.life -= dt; }
  sparks = sparks.filter((s) => s.life > 0);
  sound.ambience(dt); stepStory(dt);
  if (bannerT > 0 && (bannerT -= dt) <= 0) $("banner").classList.remove("show");
}
function hitRabbit(b, a) {
  const dist = Math.hypot(b.x - a.from[0], b.y - a.from[1]), moving = b.speed > 0.5 || b.state === "flee";
  const pts = b.golden ? 1000 : Math.round((100 + dist * 8) * (moving ? 1.6 : 1));
  score += pts; bagged++; hits++; longest = Math.max(longest, dist);
  b.state = "hit"; b.hitT = 0; b.hitV = [a.vx * 0.05, a.vy * 0.05];
  if (b.golden) { goldenCaught = true; banner("You caught the Golden Hare!", "+1,000"); }
  sound.hit(b.golden);
  for (let i = 0; i < 26; i++) sparks.push({ x: b.x, y: b.y, z: b.z + 0.15, vx: (Math.random() - 0.5) * 1.4, vy: (Math.random() - 0.5) * 1.4, vz: Math.random() * 1.6, life: 0.8 + Math.random() * 0.8, gold: b.golden || Math.random() < 0.5 });
  for (let i = 0; i < 14; i++) sparks.push({ x: b.x, y: b.y, z: b.z + 0.15, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, vz: Math.random() * 0.5, life: 1.5 + Math.random(), fluff: true });
  popText(b, `+${pts.toLocaleString()}`, `${dist.toFixed(0)} m${moving ? " · on the run" : ""}`);
}
let bannerT = 0;
function banner(t, s) { $("b-title").textContent = t; $("b-sub").textContent = s; $("banner").classList.add("show"); bannerT = 3.5; }
// floating hit text, anchored to where the rabbit was
const pops = [];
function popText(b, big, small) { const el = document.createElement("div"); el.className = "pop"; el.innerHTML = `<b>${big}</b><span>${small}</span>`; $("pops").appendChild(el); pops.push({ el, x: b.x, y: b.y, z: b.z + 0.4, t: 0 }); }

// ------------------------------------------------------------------ camera: first person, with a gentle walking bob; the view narrows a little at full draw
const cam = { e: [0, 0, 0], t: [0, 0, 0] };
function updateCamera() {
  const bob = Math.sin(player.bob) * (player.crouch ? 0.012 : 0.025) * (player.moving ? 1 : 0);
  const d = aimDir();
  cam.e = [player.x, player.y, player.z + player.eye + bob];
  cam.t = [cam.e[0] + d[0], cam.e[1] + d[1], cam.e[2] + d[2]];
  space.magnifier = 1.3 + player.draw * 0.32;
  space.lookAt(...cam.e, ...cam.t);
}

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
function project(x, y, z) {
  const k = space.magnifier / 1.6, vx = x - view.e[0], vy = y - view.e[1], vz = z - view.e[2], d = vx * view.z[0] + vy * view.z[1] + vz * view.z[2];
  return { x: (-(vx * view.x[0] + vy * view.x[1] + vz * view.x[2]) * k) / d, y: ((vx * view.y[0] + vy * view.y[1] + vz * view.y[2]) * k * (canvas.width / canvas.height)) / d, behind: d <= 0 };
}

// ------------------------------------------------------------------ render
const dyn = new Mesh(20000);
let drawn = 0, time = 0, byKind = {};
const FAR = { ring: 70, young: 60, hero: 150, rock: 50, log: 55, grass: 32, ground: 150 };
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
    const mat = F.materials[mi]; if ((mat.alpha === "cut") !== cut) continue;
    gl.bindTexture(gl.TEXTURE_2D, mat.tex || white);
    gl.uniform1f(U.uUseTex, mat.tex ? 1 : 0); gl.uniform1f(U.uCut, cut ? mat.cutoff : 0); gl.uniform1f(U.uMode, mat.mode);
    for (const it of list) {
      const T = it.tree;
      if (T && T.lod !== "full" && T.lod !== "both") continue;
      if (!inView(it.c, it.r, FAR[it.kind])) continue;
      const me = it.mesh, lite = me.lite && Math.hypot(it.c[0] - view.e[0], it.c[1] - view.e[1]) > 4;
      bindMesh(me); if (lite) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.lite.ib); bound = null; }
      gl.uniform4fv(U.uBone, it.m);
      // trees bend in the wind and cross-fade with their impostors; everything else dissolves at its draw distance
      if (T) { gl.uniform2f(U.uSway, 1, T.base); gl.uniform4f(U.uDither, T.lod === "both" ? T.fade : 1, 0, 0, 0); }
      else { gl.uniform2f(U.uSway, 0, it.c[2] - it.r); gl.uniform4f(U.uDither, 1, 0, FAR[it.kind] - 7, FAR[it.kind]); }
      if (me.tiles) { for (const t of me.tiles) if (inView(t.c, t.r, FAR[it.kind])) { if (it.kind === "grass") gl.uniform2f(U.uSway, 0, t.mn[2]); gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, t.first * 4); drawn += t.count; byKind[it.kind] = (byKind[it.kind] || 0) + t.count; } }
      else { const ni = lite ? me.lite.ni : me.ni; gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0); drawn += ni; byKind[it.kind] = (byKind[it.kind] || 0) + ni; }
    }
  }
}
// per tree: full mesh near, impostor far, and a 4 m band between where both are drawn with complementary dither
// (T.fade = the full mesh's share); impostors dissolve between 135 and 150 m
const BAND = 3, IMP_FADE = Q.has("near") ? [95, 110] : [135, 150];
function chooseLod() {
  for (const T of trees) {
    if (!T.type) { T.lod = "full"; T.fade = 1; continue; }
    const d = Math.hypot(T.c[0] - view.e[0], T.c[1] - view.e[1]), L = LOD[T.kind];
    T.fade = clamp((L + BAND - d) / BAND, 0, 1);
    T.lod = T.fade >= 1 ? "full" : T.fade > 0 ? "both" : d < IMP_FADE[1] && inView(T.c, T.r, IMP_FADE[1] + 10) ? "imp" : "off";
  }
}
function drawImpostors() {
  if (Q.has("noimp")) return;
  gl.uniform1f(U.uImp, 1);
  gl.uniform1f(U.uInst, 0); gl.uniform1f(U.uUseTex, 1); gl.uniform1f(U.uCut, 0.45); gl.uniform1f(U.uMode, 3);
  for (const [type, g] of imps) {
    if (Q.has("noyoung") && type.startsWith("young")) continue;
    gl.bindTexture(gl.TEXTURE_2D, g.tex); bound = null;
    gl.bindBuffer(gl.ARRAY_BUFFER, g.pb); gl.enableVertexAttribArray(space.posId); gl.vertexAttribPointer(space.posId, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.cb); gl.enableVertexAttribArray(space.colId); gl.vertexAttribPointer(space.colId, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.enableVertexAttribArray(space.nrmId); gl.vertexAttribPointer(space.nrmId, 3, gl.BYTE, true, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.ub); gl.enableVertexAttribArray(space.uvId); gl.vertexAttribPointer(space.uvId, 2, gl.FLOAT, false, 0, 0);
    // impostors sway with their tree's base; those in the cross-fade band are drawn one by one with the complementary
    // dither, the rest in merged runs, all dissolving into the distance
    let a = -1, b = -1;
    const flush = () => { if (a >= 0) { gl.drawArrays(gl.TRIANGLES, a, b - a); drawn += b - a; } a = -1; };
    gl.uniform2f(U.uSway, 1, g.list[0].base); gl.uniform4f(U.uDither, 1, 0, IMP_FADE[0], IMP_FADE[1]);
    for (const T of g.list) {
      if (T.lod === "both") { flush(); gl.uniform4f(U.uDither, 1 - T.fade, 1, 0, 0); gl.drawArrays(gl.TRIANGLES, T.imp.first, T.imp.count); drawn += T.imp.count; gl.uniform4f(U.uDither, 1, 0, IMP_FADE[0], IMP_FADE[1]); continue; }
      if (T.lod !== "imp") { flush(); continue; }
      if (T.imp.first === b) b += T.imp.count; else { flush(); a = T.imp.first; b = a + T.imp.count; }
    }
    flush();
  }
  gl.uniform1f(U.uImp, 0);
}
const drawSkinned = (B, bones) => { gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uMode, 0); gl.uniform4fv(U.uBone, bones); space.bindBuf(B.pb, B.cb, B.nb); space.noUV(); space.draw(0, B.n); };
// a 3×4 matrix that places a +y-pointing mesh at p along direction d
function along(p, d) {
  const f = d, l = Math.hypot(...f) || 1, y = [f[0] / l, f[1] / l, f[2] / l], up = Math.abs(y[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  let x = [y[1] * up[2] - y[2] * up[1], y[2] * up[0] - y[0] * up[2], y[0] * up[1] - y[1] * up[0]]; const xl = Math.hypot(...x); x = x.map((v) => v / xl);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return new Float32Array([x[0], y[0], z[0], p[0], x[1], y[1], z[1], p[1], x[2], y[2], z[2], p[2]]);
}
const NO_LIGHTS = new Float32Array(16);
function render(dt) {
  const L = morning(huntT / HUNT_LEN);
  dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
  // multiply: soft shadows under the rabbits
  const live = bunnies.concat(golden && golden.state !== "gone" ? [golden] : []);
  for (const b of live) { const g = (W.ground(b.x, b.y, b.z + 0.3, 0) ?? b.z) + 0.005, s = 0.14; dyn.quad4([b.x - s, b.y - s, g], [b.x + s, b.y - s, g], [b.x + s, b.y + s, g], [b.x - s, b.y + s, g], [-1, -1, 0.5], [1, -1, 0.5], [1, 1, 0.5], [-1, 1, 0.5], 6); }
  const SPR = dyn.n;
  // additive: pollen and dandelion seeds drifting in the sunbeams, sparkles and fluff, the golden hare's glow
  const sunFace = (x, y, z) => Math.max(0, ((x - cam.e[0]) * L.sun[0] + (y - cam.e[1]) * L.sun[1] + (z - cam.e[2]) * L.sun[2]) / (Math.hypot(x - cam.e[0], y - cam.e[1], z - cam.e[2]) || 1));
  for (const m of motes) {
    m.ph += dt;
    const wx = ((m.x + Math.sin(m.ph * 0.13) * 1.5 - cam.e[0] + 12) % 24 + 24) % 24 - 12 + cam.e[0], wy = ((m.y + Math.cos(m.ph * 0.11) * 1.5 - cam.e[1] + 12) % 24 + 24) % 24 - 12 + cam.e[1], wz = (W.ground(wx, wy) ?? cam.e[2] - 1.6) + 0.2 + ((m.z + m.ph * (m.seed ? 0.05 : 0.02)) % 4);
    const tw = 0.5 + 0.5 * Math.sin(m.ph * 2.3), glint = 0.25 + Math.pow(sunFace(wx, wy, wz), 6) * 2.2;
    if (m.seed) dyn.sprite(wx, wy, wz, 0.012, 0.55 * glint, 0.55 * glint, 0.5 * glint); else dyn.sprite(wx, wy, wz, 0.007, 0.9 * tw * glint, 0.75 * tw * glint, 0.4 * tw * glint);
  }
  for (const s of sparks) { const k = Math.min(1, s.life); if (s.fluff) dyn.sprite(s.x, s.y, s.z, 0.018, 0.35 * k, 0.33 * k, 0.3 * k); else dyn.sprite(s.x, s.y, s.z, 0.012, (s.gold ? 1.3 : 0.9) * k, (s.gold ? 1.0 : 0.9) * k, (s.gold ? 0.4 : 0.8) * k); }
  if (golden && golden.state !== "gone" && golden.state !== "hit") { const p = 0.7 + 0.3 * Math.sin(time * 5); dyn.sprite(golden.x, golden.y, golden.z + 0.15, 0.45, 0.35 * p, 0.25 * p, 0.06 * p); for (let i = 0; i < 4; i++) { const a = time * 2 + (i * TAU) / 4; dyn.sprite(golden.x + Math.cos(a) * 0.25, golden.y + Math.sin(a) * 0.25, golden.z + 0.15 + Math.sin(time * 3 + i) * 0.08, 0.02, 1.2, 1.0, 0.4); } }
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform1i(U.uTex, 0); gl.uniform1f(U.uWind, 1);
  gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunC, L.sunC); gl.uniform3fv(U.uSkyTop, L.top); gl.uniform3fv(U.uSkyHor, L.hor);
  gl.uniform3fv(U.uAmbS, L.ambS); gl.uniform3fv(U.uAmbG, L.ambG); gl.uniform4fv(U.uFog, L.fog); gl.uniform1f(U.uNight, 0);
  gl.uniform4f(U.uSpot, 0.99, 0.98, 0, 0); gl.uniform3f(U.uSpotP, 0, 0, -999); gl.uniform3f(U.uSpotD, 0, 0, 1); gl.uniform2f(U.uGhost, 0, 0);
  gl.uniform4fv(U.uLights, NO_LIGHTS);
  // depth of field: focus on what you aim at (a rabbit under the crosshair, else 12 m)
  gl.uniform3f(U.uDof, 12, 0.45, 0.0);
  space.applyCamera(); setupCull(); drawn = 0; byKind = {}; bound = null;
  gl.uniform1f(U.uInst, 0); gl.uniform1f(U.uMode, 0); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uBlend, 0);
  gl.uniform4f(U.uDither, 1, 0, 0, 0); gl.uniform2f(U.uSway, 0, 0);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.noNormals(); space.noUV(); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.uniform1i(U.uDetail, 1); gl.activeTexture(gl.TEXTURE0);
  chooseLod();
  gl.uniform1f(U.uInst, 1);
  drawForest(false); drawForest(true);
  drawImpostors();
  gl.uniform1f(U.uInst, 0); bound = null; gl.uniform4f(U.uDither, 1, 0, 0, 0); gl.uniform2f(U.uSway, 0, 0);
  // rabbits
  for (const b of live) { if (!inView([b.x, b.y, b.z + 0.15], 0.4, 70)) continue; drawSkinned(bunnyBufs[b.coat || "brown"], bunnyBones(b, time, b.golden ? 1.1 : 1)); }
  // arrows: flying and stuck
  gl.uniform1f(U.uInst, 1);
  for (const a of arrows) { if (a.state === "gone" || !inView([a.x, a.y, a.z], 0.5, 60)) continue; if (!a.dir || a.state === "fly") a.dir = [a.vx, a.vy, a.vz]; gl.uniform4fv(U.uBone, along([a.x, a.y, a.z], a.dir)); gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uMode, 0); space.bindBuf(arrowBuf.pb, arrowBuf.cb, arrowBuf.nb); space.noUV(); space.draw(0, arrowBuf.n); }
  // the satchel at the start
  gl.uniform4fv(U.uBone, new Float32Array([1, 0, 0, start[0], 0, 1, 0, start[1], 0, 0, 1, start[2]]));
  if (satchelBuf.n) { space.bindBuf(satchelBuf.pb, satchelBuf.cb, satchelBuf.nb); space.noUV(); space.draw(0, satchelBuf.n); }
  // the bow in your hand, drawn over the world (rebuilt when the draw changes)
  if (state === "play" || state === "title") {
    const dq = Math.round(player.draw * 30) / 30;
    if (dq !== bowBuf.draw) { const B = buildBowFrame(dq); gl.bindBuffer(gl.ARRAY_BUFFER, bowBuf.pb); gl.bufferData(gl.ARRAY_BUFFER, B.m.pos.subarray(0, B.m.n * 4), gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, bowBuf.cb); gl.bufferData(gl.ARRAY_BUFFER, B.m.col.subarray(0, B.m.n * 4), gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, bowBuf.nb); gl.bufferData(gl.ARRAY_BUFFER, B.nrm, gl.DYNAMIC_DRAW); bowBuf.n = B.m.n; bowBuf.draw = dq; }
    const d = aimDir(), cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), right = [sy, -cy, 0], up = [-Math.sin(player.pitch) * cy, -Math.sin(player.pitch) * sy, Math.cos(player.pitch)];
    const bob = Math.sin(player.bob) * 0.012 * (player.moving ? 1 : 0), k = player.draw;
    // at rest the bow is held low and canted; drawn, it comes up to the eye line
    const ox = lerp(0.3, -0.05, k), oz = lerp(-0.46, -0.1, k) + bob, of = lerp(0.62, 0.66, k), cant = lerp(0.75, 0.16, k);
    const P = [cam.e[0] + d[0] * of + right[0] * ox + up[0] * oz, cam.e[1] + d[1] * of + right[1] * ox + up[1] * oz, cam.e[2] + d[2] * of + up[2] * oz];
    const cr = Math.cos(cant), sr = Math.sin(cant), R = right.map((v, i) => v * cr - up[i] * sr), Up = up.map((v, i) => v * cr + right[i] * sr);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform4fv(U.uBone, new Float32Array([R[0], d[0], Up[0], P[0], R[1], d[1], Up[1], P[1], R[2], d[2], Up[2], P[2]]));
    space.bindBuf(bowBuf.pb, bowBuf.cb, bowBuf.nb); space.noUV(); space.draw(0, bowBuf.n);
  }
  gl.uniform1f(U.uInst, 0);
  // shadows (multiply) and glows (additive, keeping the depth-of-field alpha)
  gl.enable(gl.BLEND); gl.depthMask(false); space.bind(true); space.noNormals(); space.noUV();
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.draw(6, SPR - 6);
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); space.draw(SPR, dyn.n - SPR);
  gl.disable(gl.BLEND); gl.depthMask(true);
  gl.disableVertexAttribArray(space.nrmId); gl.disableVertexAttribArray(space.uvId); space.noNormals(); space.noUV();
  // god rays toward the low sun
  const sun = project(view.e[0] + L.sun[0] * 100, view.e[1] + L.sun[1] * 100, view.e[2] + L.sun[2] * 100);
  const sunK = !sun.behind ? clamp(1.1 - L.sun[2] * 1.5, 0.3, 1) : 0;
  post.end({ time, fade: Math.min(1, time * 0.5), flash: 0, sunUV: [sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5], sunK, maxR: canvas.height * 0.004, skyCoc: 0.22, fear: 0, red: 0 });
}

// ------------------------------------------------------------------ HUD
function hud(dt) {
  $("score").textContent = score.toLocaleString(); $("bag").textContent = `${bagged} rabbit${bagged === 1 ? "" : "s"}`;
  const left = Math.max(0, HUNT_LEN - huntT); $("clock").textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
  const a = Math.PI * (1 - (huntT / HUNT_LEN) * 0.6) , r = 30; $("sundot").setAttribute("cx", 40 + Math.cos(a) * r); $("sundot").setAttribute("cy", 36 - Math.sin(a) * r);
  $("quiver").innerHTML = Array.from({ length: QUIVER }, (_, i) => `<i class="${i < player.arrows ? "on" : ""}"></i>`).join("");
  $("noise").className = player.noise >= 18 ? "loud" : player.noise >= 9 ? "mid" : player.noise > 2 ? "soft" : "still";
  $("noise-t").textContent = player.noise >= 18 ? "running — they hear you" : player.noise >= 9 ? "walking" : player.noise > 2 ? "sneaking" : "still";
  $("ring").style.transform = `translate(-50%, -50%) scale(${(1.6 - player.draw * 0.8).toFixed(3)})`; $("ring").style.opacity = player.draw > 0 ? 0.35 + player.draw * 0.6 : 0;
  $("ring").classList.toggle("full", player.draw >= 1); $("ring").classList.toggle("shaky", player.sway > 0);
  for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.t += dt; p.z += dt * 0.25; const s = project(p.x, p.y, p.z); if (s.behind || p.t > 1.8) { if (p.t > 1.8) { p.el.remove(); pops.splice(i, 1); } else p.el.style.opacity = 0; continue; } p.el.style.left = `${(s.x * 0.5 + 0.5) * 100}%`; p.el.style.top = `${(0.5 - s.y * 0.5) * 100}%`; p.el.style.opacity = Math.min(1, 2.2 - p.t * 1.2); }
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
    try { const t0 = performance.now(); simulate(dt); updateCamera(); render(dt); hud(dt); if (PROF) { prof.cpu += (performance.now() - t0 - prof.cpu) * 0.05; prof.gap += (ms - prof.gap) * 0.05; } }
    catch (e) { if (!frame.err) { frame.err = 1; console.error("Golden Hare:", e); } }
  }
  requestAnimationFrame(frame);
}
window.__gh = () => ({ state, fps, drawn, byKind, px: canvas.width * canvas.height, t: +huntT.toFixed(1), score, bagged, shots, hits, arrows: player.arrows, rabbits: bunnies.map((b) => b.state).join(","), golden: golden && golden.state, p: [+player.x.toFixed(1), +player.y.toFixed(1)], prof: { cpu: +prof.cpu.toFixed(2), gap: +prof.gap.toFixed(2) } });
window.__ff = (sec, dt = 1 / 60) => { for (let k = 0; k < sec / dt; k++) { time += dt; simulate(dt); updateCamera(); setupCull(); } return window.__gh(); };
window.__imps = () => imps; window.__trees = () => trees; window.__LOD = LOD;
window.__player = () => player; window.__bunnies = () => bunnies; window.__begin = begin; window.__world = () => W; window.__nav = () => nav;
load().catch((e) => { console.error(e); $("ld-msg").textContent = "Could not load: " + e.message; });
requestAnimationFrame(frame);
