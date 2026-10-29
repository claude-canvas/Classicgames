// THE HOLLOW PINES — find the holy cross in the night forest and destroy the ghost of Agnes Wren. See DESIGN.md.
// Rendered with Space.js (via GameSpace) + the arcade's shaders and post chain. forest.js / lod.js / world.js / nav.js
// come from Last Light; agnes.js is the ghost, props.js the shrines and the cross, sound.js the audio.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, clamp } from "./mesh.js";
import { loadForest, worldTriangles } from "./forest.js";
import { buildWorld } from "./world.js";
import { groupTrees, bakeImpostors, impostorGeometry, drawFloor } from "./lod.js";
import { buildNav } from "./nav.js";
import { buildAgnes, makeAgnes, stepAgnes, agnesBones, headPoint, EYES, MX } from "./agnes.js";
import { buildShrine, buildHeldCross } from "./props.js";
import { sound } from "./sound.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const Q = new URLSearchParams(location.search), AUTO = Q.has("auto"), DEV = Q.has("dev"), PROF = Q.has("prof");
const EYE = 1.62, RADIUS = 0.3, WALK = 1.6, RUN = 3.3;
const NIGHT_LEN = 480;          // the night's anger builds over 8 minutes

// ------------------------------------------------------------------ dev: live reload when a source file changes
if (DEV) {
  const files = ["main.js", "agnes.js", "props.js", "sound.js", "forest.js", "world.js", "lod.js", "nav.js", "shaders.js", "post.js", "mesh.js", "GameSpace.js", "index.html"];
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
const upload = (M) => ({ pb: vbuf(M.m.pos.subarray(0, M.m.n * 4)), cb: vbuf(M.m.col.subarray(0, M.m.n * 4)), nb: vbuf(M.nrm), n: M.m.n });

// ------------------------------------------------------------------ the night: dark, overcast, thick fog (dawn after a win)
const NIGHT = { sun: [0.3, -0.5, -0.4], sunC: [0, 0, 0], top: [0.012, 0.016, 0.03], hor: [0.035, 0.045, 0.065], ambS: [0.07, 0.085, 0.13], ambG: [0.02, 0.022, 0.03], fog: [0.02, 0.026, 0.038, 0.075], night: 0.35 };
const DAWN = { sun: [0.3, -0.8, 0.05], sunC: [0.35, 0.3, 0.32], top: [0.25, 0.28, 0.36], hor: [0.55, 0.5, 0.52], ambS: [0.45, 0.46, 0.52], ambG: [0.18, 0.17, 0.17], fog: [0.45, 0.46, 0.5, 0.05], night: 0 };
const mixL = (a, b, k) => { const o = {}; for (const key in a) o[key] = Array.isArray(a[key]) ? a[key].map((v, i) => v + (b[key][i] - v) * k) : a[key] + (b[key] - a[key]) * k; return o; };

// ------------------------------------------------------------------ loading
let F = null, W = null, nav = null, state = "loading", trees = [], imps = new Map(), floorTex = null;
let agnesBuf = null, crossBuf = null, shrines = [];
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
// the fog hides everything past ~30 m: full trees only nearby, impostors to 60 m, nothing beyond
const LOD = { ring: 18, young: 8 };
const byMat = new Map();
const SHRINE_SPOTS = [[2, 4], [-12, -6], [14, -12], [-16, 14], [13, 15], [-3, -19], [-22, -3], [21, 2]];
const OFFERINGS = { doll: "A rag doll hangs by its neck from the post. Its dress is the colour of Ellie's.", shoe: "A child's shoe, caked with creek mud. Just one.", bones: "A bird's skull in a ring of stones. Someone has scratched a name into the cairn: AGNES.", wreath: "A wreath of black twigs. The candles here were lit tonight." };
async function load() {
  F = await loadForest(gl, (k) => ($("ld-bar").style.width = Math.round(k * 75) + "%"));
  $("ld-msg").textContent = "The fog is coming in…"; await new Promise((r) => setTimeout(r, 20));
  const tris = worldTriangles(F, ["ground", "rock", "log", "grass", "hero", "young"]);
  W = buildWorld(tris.map((L) => ({ pos: L.pos, kind: L.kind, ground: ["ground", "rock", "log"].includes(L.kind), twoSided: L.kind === "ground", walls: ["rock", "log", "hero", "young"].includes(L.kind), wallBelow: ["hero", "young"].includes(L.kind) ? 2.2 : undefined, cover: L.kind === "grass" })));
  $("ld-bar").style.width = "82%"; await new Promise((r) => setTimeout(r, 20));
  nav = buildNav(W, 0, 0, { res: 0.3, lo: 0.35, hi: 1.7, step: 0.3, radius: RADIUS + 0.05 });
  $("ld-bar").style.width = "90%"; $("ld-msg").textContent = "Something is watching from the trees…"; await new Promise((r) => setTimeout(r, 20));
  for (const it of F.instances) { const k = it.mesh.mat; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(it); }
  for (const L of byMat.values()) L.sort((a, b) => a.mesh.name < b.mesh.name ? -1 : 1);
  for (const m of F.materials) if (/ground/i.test(m.name)) m.mode = 5;
  floorTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawFloor()); gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
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
  agnesBuf = upload(buildAgnes()); crossBuf = upload(buildHeldCross());
  newGame();
  sizeCanvas();
  $("loading").classList.add("out"); $("hud").classList.remove("hide");
  state = "title"; $("title").classList.remove("hide");
  if (AUTO) begin();
}

// ------------------------------------------------------------------ a night
const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vz: 0, ground: true, stamina: 1, battery: 1, torch: true, cross: "none", bob: 0, speed: 0, panting: 0 };
let agnes = null, nightT = 0, searched = 0, endT = 0, fear = 0, red = 0, shake = 0, flicker = 0, dawn = 0, sparks = [];
function newGame() {
  // five shrines at reachable spots, the cross at one of them (never the nearest to the start)
  const spots = SHRINE_SPOTS.map(([x, y]) => nav.snap(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, 2)).sort(() => Math.random() - 0.5).slice(0, 5);
  spots.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  const crossAt = 1 + Math.floor(Math.random() * 4), offers = ["doll", "shoe", "bones", "wreath"].sort(() => Math.random() - 0.5);
  for (const s of shrines) for (const b of [s.buf]) for (const k of ["pb", "cb", "nb"]) gl.deleteBuffer(b[k]);
  let oi = 0;
  shrines = spots.map(([x, y, z], i) => { const off = i === crossAt ? "cross" : offers[oi++ % offers.length], S = buildShrine(x, y, z, 31 + i * 7, off); return { x, y, z, off, searched: false, flames: S.flames, cross: S.cross, buf: upload(S), taken: false, S }; });
  // start somewhere open: the reachable spot near the middle with the most clear floor around it
  let st = nav.snap(0.5, -1, 4), best = -1;
  for (let k = 0; k < 40; k++) { const c = nav.snap((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 4); let open = 0; for (let a = 0; a < TAU; a += TAU / 16) for (let r = 0.5; r <= 4; r += 0.5) { if (W.wall(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 0.35, c[2] + 1.7)) break; open++; } if (open > best) { best = open; st = c; } }
  Object.assign(player, { x: st[0], y: st[1], z: st[2], yaw: Math.atan2(shrines[0].y - st[1], shrines[0].x - st[0]), pitch: -0.05, vz: 0, stamina: 1, battery: 1, torch: true, cross: "none" });
  agnes = makeAgnes();
  nightT = 0; searched = 0; endT = 0; fear = 0; red = 0; shake = 0; flicker = 0; dawn = 0; sparks = []; scare.t = 25; story.q = []; story.shown = new Set();
}
function begin() {
  sound.init(); newGame();
  $("title").classList.add("hide"); $("end").classList.add("hide");
  state = "play"; if (!AUTO) try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { }); } catch (e) { }
  say("a", "“Ellie?”", 2.5); say("b", "Her lantern is lying in the needles, still warm.", 4); say("c", "The old shrines. If the priest's cross is anywhere, it's at one of them.", 5);
}
function die() {
  state = "caught"; endT = 0; sound.scare(); red = 0.6; shake = 1;
  document.exitPointerLock?.();
  setTimeout(() => { $("e-title").textContent = "She took you"; $("e-title").className = "red"; $("e-text").textContent = player.cross !== "none" ? "You had the cross in your hand. You just didn't raise it in time." : `${searched} of the five shrines searched. In the morning they found Ellie's lantern, and yours beside it.`; $("end").classList.remove("hide"); $("again").focus(); if (AUTO) setTimeout(begin, 4000); }, 1800);
}
function win() {
  state = "won"; endT = 0; sound.banish(); document.exitPointerLock?.();
  for (let i = 0; i < 160; i++) sparks.push({ x: agnes.x + (Math.random() - 0.5) * 0.5, y: agnes.y + (Math.random() - 0.5) * 0.5, z: agnes.z + Math.random() * 1.9, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: 0.4 + Math.random() * 1.6, life: 1.5 + Math.random() * 2.5 });
  setTimeout(() => { $("e-title").textContent = "Agnes is gone"; $("e-title").className = ""; $("e-text").textContent = `Grey light comes up through the pines. Somewhere near the creek, a small voice is calling your name. You found the cross in ${Math.round(nightT)} seconds of the longest night of your life.`; $("end").classList.remove("hide"); $("again").focus(); if (AUTO) setTimeout(begin, 6000); }, 5000);
}

// subtitles: each key once, queued
const story = { shown: new Set(), q: [], t: 0, cur: null };
function say(key, text, dur = 4) { if (story.shown.has(key)) return; story.shown.add(key); story.q.push({ text, dur }); }
function stepStory(dt) {
  if (story.cur && (story.t -= dt) <= 0) { story.cur = null; $("sub").classList.remove("show"); }
  if (!story.cur && story.q.length) { story.cur = story.q.shift(); story.t = story.cur.dur; $("sub").textContent = story.cur.text; $("sub").classList.add("show"); }
}

// ------------------------------------------------------------------ input: pointer-locked mouse look, WASD, Shift, E / right mouse, F
const keys = new Set(); let usePressed = false, rightDown = false;
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  sound.init(); keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyE") usePressed = true;
  if (e.code === "KeyF" && state === "play" && player.battery > 0) { player.torch = !player.torch; sound.flick(); }
  if (e.code === "KeyM") sound.mute();
  if (e.code === "Enter" && (state === "title" || (!$("end").classList.contains("hide")))) begin();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
canvas.addEventListener("mousedown", (e) => { sound.init(); if (state === "play" && document.pointerLockElement !== canvas) try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { }); } catch (err) { } if (e.button === 2) rightDown = true; });
addEventListener("mouseup", (e) => { if (e.button === 2) rightDown = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mousemove", (e) => { if (document.pointerLockElement !== canvas || state !== "play") return; player.yaw -= e.movementX * 0.0022; player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.35, 1.35); });
$("start").addEventListener("click", begin); $("again").addEventListener("click", begin);

function playerInput() {
  const k = keys, f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0), r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  if (k.has("ArrowLeft") && !k.has("KeyA")) player.yaw += 0.03; if (k.has("ArrowRight") && !k.has("KeyD")) player.yaw -= 0.03;
  const inp = { f, r, run: k.has("ShiftLeft") || k.has("ShiftRight"), use: usePressed, raise: k.has("KeyE") || rightDown };
  usePressed = false; return inp;
}

// the bot (?auto): search the nearest unsearched shrine; with the cross, turn on Agnes and raise it
const bot = { field: null, fieldFor: null, fieldT: 0, stuck: 0, lx: 0, ly: 0, unT: 0, side: 1 };
function botInput(dt) {
  let target = null;
  if (player.cross === "none") target = shrines.filter((s) => !s.searched).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  const aDist = Math.hypot(agnes.x - player.x, agnes.y - player.y), aVisible = agnes.vis > 0.25 && aDist < 14 && agnes.state !== "banished";
  // face Agnes when she is near and the cross is in hand; else look where we walk
  let raise = false, f = 0;
  if (player.cross !== "none" && aVisible) { player.yaw += ang(Math.atan2(agnes.y - player.y, agnes.x - player.x) - player.yaw) * Math.min(1, dt * 6); player.pitch += (0.05 - player.pitch) * dt * 3; raise = aDist < 11; return { f: 0, r: 0, run: false, use: false, raise }; }
  if (!target) target = { x: Math.cos(nightT * 0.1) * 6, y: Math.sin(nightT * 0.1) * 6 };
  const dist = Math.hypot(target.x - player.x, target.y - player.y);
  if (target.off && dist < 1.3) return { f: 0, r: 0, run: false, use: true, raise: false };
  if (bot.fieldFor !== target || (bot.fieldT -= dt) < 0) { bot.field = nav.field(target.x, target.y); bot.fieldFor = target; bot.fieldT = 2; }
  const way = nav.steer(bot.field, player.x, player.y) || target;
  player.yaw += ang(Math.atan2(way.y - player.y, way.x - player.x) - player.yaw) * Math.min(1, dt * 4); player.pitch += (-0.1 - player.pitch) * dt * 2;
  // wedged (no progress for a second): back off and sidestep for a moment, then route again
  if (Math.hypot(player.x - bot.lx, player.y - bot.ly) > 0.15) { bot.lx = player.x; bot.ly = player.y; bot.stuck = 0; } else if ((bot.stuck += dt) > 1) { bot.stuck = 0; bot.unT = 0.7; bot.side = Math.random() < 0.5 ? -1 : 1; }
  if (bot.unT > 0) { bot.unT -= dt; return { f: -0.6, r: bot.side, run: false, use: false, raise: false }; }
  f = 1;
  return { f, r: 0, run: agnes.state === "hunt" || dist > 6, use: false, raise: false };
}
const ang = (d) => { while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };

// ------------------------------------------------------------------ the player: walking on the forest floor, stamina, the torch
function stepPlayer(inp, dt) {
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), mag = Math.hypot(inp.f, inp.r) || 1;
  const wantRun = inp.run && player.stamina > 0.05 && inp.f > 0;
  const sp = (inp.f || inp.r ? (wantRun ? RUN : WALK) : 0) * (player.cross === "raised" ? 0.45 : 1);
  const vx = ((cy * inp.f + sy * inp.r) / mag) * sp, vy = ((sy * inp.f - cy * inp.r) / mag) * sp;
  player.stamina = clamp(player.stamina + (wantRun && sp ? -dt / 7 : dt / 9), 0, 1);
  if (player.stamina < 0.06 && !player.panting) { player.panting = 3; sound.breath(); }
  player.panting = Math.max(0, player.panting - dt);
  // move with a 0.3 m body against the walls (trunks, rocks, logs), sliding along them
  const blocked = (x, y) => { const g = W.ground(x, y, player.z + 0.4, 0) ?? player.z; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; if (W.wall(x + Math.cos(a) * RADIUS, y + Math.sin(a) * RADIUS, g + 0.35, g + 1.7)) return true; } return W.wall(x, y, g + 0.35, g + 1.7); };
  let nx = player.x + vx * dt, ny = player.y + vy * dt;
  if (blocked(nx, ny)) { if (!blocked(nx, player.y)) ny = player.y; else if (!blocked(player.x, ny)) nx = player.x; else { nx = player.x; ny = player.y; } }
  const g = W.ground(nx, ny, player.z + 0.4, 0), moved = Math.hypot(nx - player.x, ny - player.y) / Math.max(dt, 1e-4);
  if (g !== null) { player.x = nx; player.y = ny; player.z += (g - player.z) * Math.min(1, dt * 12); }
  player.speed = g !== null && moved > 0.2 ? sp : 0;
  if (player.speed > 0) { const before = player.bob; player.bob += dt * sp * 2.3; if (Math.floor(before / Math.PI) !== Math.floor(player.bob / Math.PI)) sound.step(wantRun); }
  // the torch drains slowly (about six minutes) and dies at zero
  if (player.torch) { player.battery = Math.max(0, player.battery - dt / 360); if (player.battery <= 0) { player.torch = false; say("dead-torch", "The torch dies.", 3); } }
  // the cross: E / right mouse raises it once you hold it
  if (player.cross !== "none") player.cross = inp.raise ? "raised" : "held";
  // searching a shrine
  const near = shrines.find((s) => Math.hypot(s.x - player.x, s.y - player.y) < 1.5);
  $("prompt").textContent = near && !near.searched ? "E — search the shrine" : near && near.off === "cross" && !near.taken ? "E — take the cross" : "";
  if (inp.use && near && player.cross === "none") {
    if (!near.searched) { near.searched = true; searched++; }
    if (near.off === "cross" && !near.taken) { near.taken = true; player.cross = "held"; sound.pickup(); flash(0.5); say("got", "The priest's cross. The wood is warm.", 4); say("got2", "She knows you have it now. When she comes, raise it — E, or hold the right mouse button.", 6); agnes.nextHunt = Math.min(agnes.nextHunt, 12); rebuildShrine(near); }
    else if (near.off !== "cross") say("off" + near.off, OFFERINGS[near.off], 5.5);
  }
}
function rebuildShrine(s) { for (const k of ["pb", "cb", "nb"]) gl.deleteBuffer(s.buf[k]); const S = buildShrine(s.x, s.y, s.z, 31 + shrines.indexOf(s) * 7, "taken"); s.buf = upload(S); }
let flashT = 0; function flash(k) { flashT = Math.max(flashT, k); }

// ------------------------------------------------------------------ scares: little things in the dark, timed and weighted by fear
const scare = { t: 25, peekT: 0, lastYaw: 0, yawT: 0 };
function stepScares(dt) {
  if (state !== "play") return;
  // turning around fast: sometimes she is right there for half a second
  scare.yawT += dt; if (scare.yawT > 0.5) { const d = Math.abs(ang(player.yaw - scare.lastYaw)); scare.lastYaw = player.yaw; scare.yawT = 0; if (d > 2.2 && agnes.state === "gone" && nightT > 70 && Math.random() < 0.4) { const a = player.yaw; Object.assign(agnes, { x: player.x + Math.cos(a) * 3.2, y: player.y + Math.sin(a) * 3.2, state: "peek", vis: 1, peek: 0.45 }); sound.scare(); shake = 0.6; red = 0.25; } }
  if (agnes.state === "peek") { agnes.peek -= dt; if (agnes.peek <= 0) { agnes.state = "gone"; agnes.vis = 0; agnes.gone = 10; } }
  if ((scare.t -= dt) > 0) return;
  scare.t = 14 + Math.random() * 22 - Math.min(10, nightT / 40);
  const pick = Math.random();
  if (pick < 0.2) { sound.snap(); say("snap", "", 0.1); }
  else if (pick < 0.38) sound.whisper();
  else if (pick < 0.5 && player.speed > 0) { sound.footstepsBehind(); say("steps", "Footsteps. Behind you.", 2.5); }
  else if (pick < 0.62) { flicker = 1.2; sound.flick(); }
  else if (pick < 0.72) sound.giggle();
  else if (pick < 0.84) sound.wail(0.05, 3, 300);
  else if (agnes.state === "gone") {
    // a shape crossing between the trunks at the edge of the light
    const a = player.yaw + (Math.random() < 0.5 ? 0.5 : -0.5);
    Object.assign(agnes, { x: player.x + Math.cos(a) * 16, y: player.y + Math.sin(a) * 16, state: "cross", crossT: 1.6, cdx: -Math.sin(a), cdy: Math.cos(a), vis: 0 });
  }
}

// ------------------------------------------------------------------ simulation
function simulate(dt) {
  if (state === "play") {
    nightT += dt;
    stepPlayer(AUTO ? botInput(dt) : playerInput(), dt);
    const events = [];
    const look = [Math.cos(player.pitch) * Math.cos(player.yaw), Math.cos(player.pitch) * Math.sin(player.yaw), Math.sin(player.pitch)];
    if (agnes.state === "cross") { agnes.crossT -= dt; agnes.x += agnes.cdx * 6 * dt; agnes.y += agnes.cdy * 6 * dt; agnes.vis = Math.min(0.8, agnes.vis + dt * 4); agnes.z = (W.ground(agnes.x, agnes.y) ?? player.z) + 0.08; agnes.h = Math.atan2(agnes.cdy, agnes.cdx); if (agnes.crossT <= 0) { agnes.state = "gone"; agnes.vis = 0; agnes.gone = 6; } }
    else if (agnes.state !== "peek") stepAgnes(agnes, { x: player.x, y: player.y, z: player.z, look, torch: player.torch, cross: player.cross }, dt, nightT / NIGHT_LEN, (x, y) => W.ground(x, y), events);
    for (const ev of events) {
      if (ev.type === "hunt") { sound.huntScream(); say("hunt", "She's coming. RUN.", 3); flicker = 2; }
      if (ev.type === "huntEnd") say("huntEnd" + Math.floor(nightT), "…quiet again.", 2.5);
      if (ev.type === "stalk" && agnes.stalkN === 1) say("first", "There's someone standing between the trees.", 4);
      if (ev.type === "vanish") { sound.vanish(); flicker = 0.4; }
      if (ev.type === "burn") { sound.burn(); shake = 0.4; }
      if (ev.type === "caught") die();
      if (ev.type === "banished") win();
    }
    // fear: how close and how present she is
    const d = Math.hypot(agnes.x - player.x, agnes.y - player.y);
    const target = agnes.state === "hunt" ? clamp(1.15 - d / 22, 0.25, 1) : agnes.state === "burn" ? 0.85 : agnes.state === "stalk" ? clamp(0.55 - d / 50, 0.05, 0.45) * agnes.vis : agnes.state === "peek" ? 1 : 0.04;
    fear += (target - fear) * Math.min(1, dt * 2);
    if (agnes.state === "hunt" && d < 12 && Math.random() < dt * 3) flicker = Math.max(flicker, 0.15);
  } else if (state === "caught") { endT += dt; agnes.vis = 1; agnes.reach = 1; fear = 1; }
  else if (state === "won") { endT += dt; dawn = Math.min(1, endT / 5); fear *= 1 - Math.min(1, dt * 2); agnes.vis = Math.max(0, agnes.vis - dt * 0.8); }
  for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz += 0.3 * dt; s.life -= dt; }
  sparks = sparks.filter((s) => s.life > 0);
  stepScares(dt);
  flicker = Math.max(0, flicker - dt); red = Math.max(0, red - dt * 0.8); shake = Math.max(0, shake - dt * 1.5); flashT = Math.max(0, flashT - dt * 1.5);
  sound.update(dt, fear, player.cross === "raised" && state === "play");
  stepStory(dt);
}

// ------------------------------------------------------------------ camera: first person, with a walking bob and fear shake
const cam = { e: [0, 0, 0], t: [0, 0, 0] };
function updateCamera() {
  const bob = Math.sin(player.bob) * 0.035 * (player.speed ? 1 : 0), sway = Math.cos(player.bob * 0.5) * 0.02 * (player.speed ? 1 : 0);
  const sh = shake * 0.06, jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
  const yaw = player.yaw + jx, pitch = player.pitch + jy;
  cam.e = [player.x + Math.sin(player.yaw) * sway, player.y - Math.cos(player.yaw) * sway, player.z + EYE + bob];
  cam.t = [cam.e[0] + Math.cos(pitch) * Math.cos(yaw), cam.e[1] + Math.cos(pitch) * Math.sin(yaw), cam.e[2] + Math.sin(pitch)];
  space.magnifier = 1.25;
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

// ------------------------------------------------------------------ render
const dyn = new Mesh(16000);
let drawn = 0, time = 0, byKind = {};
const FAR = { ring: 45, young: 35, hero: 70, rock: 35, log: 40, grass: 22, ground: 70 };
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
      if (it.tree && it.tree.lod !== "full") continue;
      if (!inView(it.c, it.r, FAR[it.kind])) continue;
      const me = it.mesh, lite = me.lite && Math.hypot(it.c[0] - view.e[0], it.c[1] - view.e[1]) > 3;
      bindMesh(me); if (lite) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.lite.ib); bound = null; }
      gl.uniform4fv(U.uBone, it.m);
      if (me.tiles) { for (const T of me.tiles) if (inView(T.c, T.r, FAR[it.kind])) { gl.drawElements(gl.TRIANGLES, T.count, gl.UNSIGNED_INT, T.first * 4); drawn += T.count; byKind[it.kind] = (byKind[it.kind] || 0) + T.count; } }
      else { const ni = lite ? me.lite.ni : me.ni; gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0); drawn += ni; byKind[it.kind + (lite ? "-lite" : "")] = (byKind[it.kind + (lite ? "-lite" : "")] || 0) + ni; }
    }
  }
}
function chooseLod() {
  for (const T of trees) {
    if (!T.type) { T.lod = "full"; continue; }
    const d = Math.hypot(T.c[0] - view.e[0], T.c[1] - view.e[1]);
    T.lod = d < LOD[T.kind] ? "full" : d < 60 && inView(T.c, T.r, 65) ? "imp" : "off";
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
    let a = -1, b = -1;
    for (const T of g.list) { if (T.lod !== "imp") continue; if (T.imp.first === b) b += T.imp.count; else { if (a >= 0) { gl.drawArrays(gl.TRIANGLES, a, b - a); drawn += b - a; } a = T.imp.first; b = a + T.imp.count; } }
    if (a >= 0) { gl.drawArrays(gl.TRIANGLES, a, b - a); drawn += b - a; }
  }
}
const drawStatic = (B, mode = 0) => { gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1f(U.uUseTex, 0); gl.uniform1f(U.uCut, 0); gl.uniform1f(U.uMode, mode); space.bindBuf(B.pb, B.cb, B.nb); space.noUV(); space.draw(0, B.n); };
const lights = new Float32Array(16);
function render() {
  const L = dawn > 0 ? mixL(NIGHT, DAWN, dawn) : NIGHT;
  // the jumpscare: she is right in your face
  let agnesOverride = null;
  if (state === "caught") {
    const k = Math.min(1, endT * 3), dist = 1.6 - k * 1.05, f = [Math.cos(player.yaw), Math.sin(player.yaw)];
    agnes.x = cam.e[0] + f[0] * dist; agnes.y = cam.e[1] + f[1] * dist; agnes.z = cam.e[2] - 1.74 + Math.sin(endT * 40) * 0.01; agnes.h = player.yaw + Math.PI;
    shake = Math.max(shake, 0.5 * (1 - Math.min(1, endT))); if (endT < 0.12) red = 0.55;
  }
  const ab = agnesBones(agnes, time, agnesOverride);
  dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
  const SPR = dyn.n;
  // candle flames (additive glow), her eyes, sparks when she burns away
  for (const s of shrines) for (const [fx, fy, fz] of s.flames) { const fl = 0.75 + 0.25 * Math.sin(time * 13 + fx * 7) * Math.sin(time * 7.3 + fy); dyn.sprite(fx, fy, fz, 0.018, 1.2 * fl, 0.8 * fl, 0.35 * fl); dyn.sprite(fx, fy, fz, 0.16, 0.25 * fl, 0.13 * fl, 0.04 * fl); }
  if (agnes.vis > 0.05 && agnes.state !== "banished") for (const e of EYES) { const p = headPoint(e); dyn.sprite(p[0], p[1], p[2], 0.012, 0.6 * agnes.vis, 0.75 * agnes.vis, 0.9 * agnes.vis); }
  if (agnes.state === "burn") for (let i = 0; i < 14; i++) dyn.sprite(agnes.x + (Math.random() - 0.5) * 0.6, agnes.y + (Math.random() - 0.5) * 0.6, agnes.z + Math.random() * 1.9, 0.03, 1.2, 0.5, 0.15);
  for (const s of sparks) { const k = Math.min(1, s.life); dyn.sprite(s.x, s.y, s.z, 0.025, 1.1 * k, 0.7 * k, 0.3 * k); }
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform1i(U.uTex, 0); gl.uniform1f(U.uWind, 1.4);
  gl.uniform3fv(U.uSun, L.sun); gl.uniform3fv(U.uSunC, L.sunC); gl.uniform3fv(U.uSkyTop, L.top); gl.uniform3fv(U.uSkyHor, L.hor);
  gl.uniform3fv(U.uAmbS, L.ambS); gl.uniform3fv(U.uAmbG, L.ambG); gl.uniform4fv(U.uFog, L.fog); gl.uniform1f(U.uNight, L.night);
  // the torch: flickers when she is near, when the battery is low, or when a scare kills it for a moment
  const low = player.battery < 0.15 ? 0.5 + 0.5 * (Math.sin(time * 23) > -0.6 ? 1 : 0) : 1;
  const flick = flicker > 0 ? (Math.random() < 0.55 ? 0.05 : 0.8) : 1;
  const torch = state === "caught" ? (Math.random() < 0.7 ? 2.6 : 0.3) : player.torch ? 2.4 * low * flick * (0.55 + player.battery * 0.45) : 0;
  const look = [cam.t[0] - cam.e[0], cam.t[1] - cam.e[1], cam.t[2] - cam.e[2]];
  gl.uniform3f(U.uSpotP, cam.e[0] + Math.sin(player.yaw) * 0.15, cam.e[1] - Math.cos(player.yaw) * 0.15, cam.e[2] - 0.25); gl.uniform3fv(U.uSpotD, look);
  gl.uniform4f(U.uSpot, 0.975, 0.86, torch, torch * 0.07);
  // candle lights: the four nearest shrines
  lights.fill(0);
  shrines.slice().sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)).slice(0, 4).forEach((s, i) => lights.set([s.x + 0.2, s.y, s.z + 0.8, 0.9 + Math.sin(time * 9 + i) * 0.15], i * 4));
  gl.uniform4fv(U.uLights, lights);
  gl.uniform3f(U.uDof, 4, 0.25, 0.0);
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
  // the shrines
  gl.uniform4fv(U.uBone, IDENTITY);
  for (const s of shrines) if (inView([s.x, s.y, s.z + 0.6], 1.2, 60)) drawStatic(s.buf);
  // the cross in your hand (lower right; raised to the centre when E is held), drawn over the world
  if (player.cross !== "none" && state === "play") {
    const up = player.cross === "raised", cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const fwd = [Math.cos(player.pitch) * cy, Math.cos(player.pitch) * sy, Math.sin(player.pitch)], right = [sy, -cy, 0], upv = [-Math.sin(player.pitch) * cy, -Math.sin(player.pitch) * sy, Math.cos(player.pitch)];
    const ox = up ? 0 : 0.2, oz = up ? -0.2 : -0.33, of = 0.55, bobv = Math.sin(player.bob) * 0.01;
    const P = [cam.e[0] + fwd[0] * of + right[0] * ox + upv[0] * (oz + bobv), cam.e[1] + fwd[1] * of + right[1] * ox + upv[1] * (oz + bobv), cam.e[2] + fwd[2] * of + upv[2] * (oz + bobv)];
    const M = [right[0], fwd[0], upv[0], P[0], right[1], fwd[1], upv[1], P[1], right[2], fwd[2], upv[2], P[2]];
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.uniform1f(U.uInst, 1); gl.uniform4fv(U.uBone, new Float32Array(M));
    gl.uniform4f(U.uSpot, 0.975, 0.86, up ? 1.2 : torch * 0.4, 0);
    if (up) { lights.set([P[0], P[1], P[2] + 0.2, 0.6], 0); gl.uniform4fv(U.uLights, lights); }
    drawStatic(crossBuf, up ? 1 : 0);
    gl.uniform1f(U.uInst, 0); gl.uniform4f(U.uSpot, 0.975, 0.86, torch, torch * 0.07);
  }
  // Agnes: blended, pale and half there
  if (agnes.vis > 0.02 && agnes.state !== "banished" || state === "won" && agnes.vis > 0.02) {
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
    gl.uniform1f(U.uBlend, 1); gl.uniform2f(U.uGhost, Math.min(1, agnes.vis * (state === "caught" ? 1.4 : 0.85)), agnes.state === "burn" ? Math.min(1, agnes.burn * 1.2) : 0);
    gl.uniform4fv(U.uBone, ab); space.bindBuf(agnesBuf.pb, agnesBuf.cb, agnesBuf.nb); space.noUV(); space.draw(0, agnesBuf.n);
    gl.uniform1f(U.uBlend, 0); gl.depthMask(true); gl.disable(gl.BLEND);
  }
  // glows (additive, keeping the depth-of-field alpha)
  gl.enable(gl.BLEND); gl.depthMask(false); space.bind(true); space.noNormals(); space.noUV();
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); space.draw(SPR, dyn.n - SPR);
  gl.disable(gl.BLEND); gl.depthMask(true);
  gl.disableVertexAttribArray(space.nrmId); gl.disableVertexAttribArray(space.uvId);
  space.noNormals(); space.noUV();
  post.end({ time, fade: Math.min(1, time * 0.4), flash: flashT, sunUV: [0.5, 2], sunK: 0, maxR: canvas.height * 0.003, skyCoc: 0.3, fear: Math.min(1, fear + red * 0.5), red });
}

// ------------------------------------------------------------------ HUD
function hud() {
  $("goal").textContent = player.cross === "none" ? `Find the holy cross · shrines searched ${searched} / 5` : agnes.state === "banished" ? "" : "Face Agnes and raise the cross (E / right mouse)";
  $("stam").style.width = `${Math.round(player.stamina * 100)}%`; $("stambar").classList.toggle("low", player.stamina < 0.25);
  $("batt").style.width = `${Math.round(player.battery * 100)}%`; $("battbar").classList.toggle("off", !player.torch);
  $("crossicon").className = player.cross === "none" ? "hide" : player.cross === "raised" ? "up" : "";
  $("shake").style.transform = shake ? `translate(${(Math.random() - 0.5) * 14 * shake}px, ${(Math.random() - 0.5) * 14 * shake}px)` : "";
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
      simulate(dt); updateCamera(); render(); hud();
      if (PROF) { prof.cpu += (performance.now() - t0 - prof.cpu) * 0.05; prof.gap += (ms - prof.gap) * 0.05; }
    } catch (e) { if (!frame.err) { frame.err = 1; console.error("Hollow Pines:", e); } }
  }
  requestAnimationFrame(frame);
}
window.__hp = () => ({ state, fps, drawn, byKind, px: canvas.width * canvas.height, t: +nightT.toFixed(1), searched, cross: player.cross, fear: +fear.toFixed(2), agnes: agnes && { s: agnes.state, d: +Math.hypot(agnes.x - player.x, agnes.y - player.y).toFixed(1), vis: +agnes.vis.toFixed(2), burn: +agnes.burn.toFixed(2), next: +agnes.nextHunt.toFixed(0) }, p: [+player.x.toFixed(1), +player.y.toFixed(1)], prof: { cpu: +prof.cpu.toFixed(2), gap: +prof.gap.toFixed(2) } });
window.__ff = (sec, dt = 1 / 60) => { for (let k = 0; k < sec / dt; k++) { time += dt; simulate(dt); updateCamera(); } return window.__hp(); };
window.__world = () => W; window.__nav = () => nav; window.__shrines = () => shrines; window.__bot = () => bot; window.__botInput = (dt = 1 / 60) => botInput(dt);
window.__trees = () => trees; window.__view = () => view; window.__forest = () => F;
window.__agnes = () => agnes; window.__player = () => player; window.__begin = begin;
load().catch((e) => { console.error(e); $("ld-msg").textContent = "Could not load: " + e.message; });
requestAnimationFrame(frame);
