// LANTERNFALL — a story-driven 3D action RPG in four chapters. Rendered with the projection3d library (Space, via
// GameSpace) + custom shaders + bloom / god rays / depth of field. See DESIGN.md.
// maps.js / world.js / worker.js make the world, chars.js the cast, combat.js the foes, story.js the chapters;
// this file runs the game: loading, input, player, companions, camera, dialogue, the story API `G`, HUD, save.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, limb, blob, tube, mixc } from "./mesh.js";
import { buildMap, buildWalk, ENVS, HALF, segDist } from "./maps.js";
import { TILE, NT, SRES, rock as rockMesh } from "./world.js";
import { CAST, makeChar, stepChar, setAct, poseChar, charMesh, drawWisp } from "./chars.js";
import { makeEnemy, stepEnemy, damageEnemy } from "./combat.js";
import { CHAPTERS } from "./story.js";
import { portrait } from "./portraits.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const audio = new Audio();
let U = null, post = null;
let pxCap = 2.0e6;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post?.resize(canvas.width, canvas.height);
}
const DEF = { ch: 0, cp: 0, flags: {}, pos: null, potions: 0, sunstaff: false, unlocked: 0, volume: 0.8, music: 0.6, started: false };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("lanternfall.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("lanternfall.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;
const bot = Q.has("auto");

// ------------------------------------------------------------------ world loading (worker → per-tile GL buffers)
let S = null, walk = null, tiles = [], far = null, shadeTex = gl.createTexture(), shadeReady = false, worker = null, loadToken = 0, tilesLoaded = 0, tileLights = [];
function freeWorld() {
  for (const t of tiles) if (t) { gl.deleteBuffer(t.pb); gl.deleteBuffer(t.cb); }
  if (far) { gl.deleteBuffer(far.pb); gl.deleteBuffer(far.cb); }
  tiles = new Array(NT * NT).fill(null); far = null; shadeReady = false; tilesLoaded = 0; tileLights = [];
  if (worker) worker.terminate(); worker = null;
}
function upload(pos, col) { const pb = gl.createBuffer(), cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW); return { pb, cb }; }
function onWorld(m) {
  if (m.token !== loadToken) return;
  if (m.type === "tile") { tiles[m.tj * NT + m.ti] = { ...upload(m.pos, m.col), O: m.O, G: m.G, W: m.W, A: m.A, cx: -HALF + (m.ti + 0.5) * TILE, cy: -HALF + (m.tj + 0.5) * TILE }; tilesLoaded++; tileLights.push(...m.lights); }
  else if (m.type === "far") far = { ...upload(m.pos, m.col), O: m.O, A: m.A };
  else if (m.type === "shade") {
    gl.bindTexture(gl.TEXTURE_2D, shadeTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, m.W, m.H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, m.data);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    shadeReady = true;
  }
}
async function loadWorld(ch, startOf) {
  freeWorld();
  const token = ++loadToken;
  S = buildMap(ch); walk = buildWalk(S); buildGrid();
  const start = startOf(S);
  env.cur = { ...ENVS[S.env] }; env.from = null; env.dim = 0;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => onWorld(e.data);
    worker.onerror = (e) => { console.warn("Lanternfall: worker failed", e.message); worker = null; buildSyncWorld(ch, token, start); };
    worker.postMessage({ ch, start, token });
  } catch { await buildSyncWorld(ch, token, start); }
  await new Promise((r) => setTimeout(r, 0));
  // wait for the tiles around the start and the shadow map
  await new Promise((res) => { const chk = () => { if (token !== loadToken) return; const need = tiles.filter((t, k) => { const cx = -HALF + ((k % NT) + 0.5) * TILE, cy = -HALF + (Math.floor(k / NT) + 0.5) * TILE; return Math.hypot(cx - start[0], cy - start[1]) < 60; }); const ok = shadeReady && tiles.every((t, k) => t || Math.hypot(-HALF + ((k % NT) + 0.5) * TILE - start[0], -HALF + (Math.floor(k / NT) + 0.5) * TILE - start[1]) >= 60); $("ld-bar").style.width = Math.min(100, (tilesLoaded / (NT * NT)) * 160) + "%"; void need; if (ok) res(); else setTimeout(chk, 50); }; chk(); });
}
async function buildSyncWorld(ch, token, start) {
  const W = await import("./world.js");
  onWorld({ type: "shade", token, ...W.bakeShade(S) });
  const f = W.buildFar(S); const fo = f.O, fa = f.A, pos = new Float32Array((fo.n + fa.n) * 4), col = new Float32Array((fo.n + fa.n) * 4); pos.set(fo.pos.subarray(0, fo.n * 4)); col.set(fo.col.subarray(0, fo.n * 4)); pos.set(fa.pos.subarray(0, fa.n * 4), fo.n * 4); col.set(fa.col.subarray(0, fa.n * 4), fo.n * 4);
  onWorld({ type: "far", token, pos, col, O: [0, fo.n], A: [fo.n, fa.n] });
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) onWorld({ type: "tile", token, ...W.buildTile(S, i, j) });
  void start;
}

// ------------------------------------------------------------------ environment (lighting) with transitions
const env = { cur: { ...ENVS.sunset }, from: null, to: null, t: 0, dur: 1, dim: 0, bolt: 0, boltT: 3 };
function setEnv(name, dur, opts = {}) { env.from = { ...env.cur }; env.to = { ...ENVS[name] }; if (opts.dim) { env.to.sunCol = env.to.sunCol.map((v) => v * 0.55); env.to.glow = env.to.glow.map((v) => v * 0.5); } env.t = 0; env.dur = Math.max(0.01, dur); }
function stepEnv(dt) {
  if (env.to) { env.t += dt; const k = clamp(env.t / env.dur, 0, 1), e = k * k * (3 - 2 * k); for (const key in env.to) { const a = env.from[key], b = env.to[key]; env.cur[key] = Array.isArray(b) ? b.map((v, i) => lerp(a[i], v, e)) : lerp(a, b, e); } if (k >= 1) env.to = null; }
  // lightning in the eclipse
  if (env.cur.eclipse > 0.5) { env.boltT -= dt; if (env.boltT < 0) { env.bolt = 1; env.boltT = 4 + Math.random() * 7; } }
  env.bolt = Math.max(0, env.bolt - dt * 3.5);
}

// ------------------------------------------------------------------ coarse nav grid + A* (bot and companions)
let NAV = null;
function buildGrid() { const N = 200, G = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -HALF + i + 0.5, y = -HALF + j + 0.5; let free = 0; for (const [dx, dy] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) if (!walk.blocked(x + dx, y + dy)) free++; G[j * N + i] = free >= 2 ? 0 : 1; } NAV = { N, G }; }
function astar(from, to) {
  const N = NAV.N, G = NAV.G, ci = (p) => [clamp(Math.floor(p[0] + HALF), 0, N - 1), clamp(Math.floor(p[1] + HALF), 0, N - 1)];
  let [sx, sy] = ci(from); const [tx, ty] = ci(to);
  const goal = ty * N + tx, start = sy * N + sx, g = new Float32Array(N * N).fill(1e9), came = new Int32Array(N * N).fill(-1), heap = [];
  const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  g[start] = 0; push(start, 0); let it = 0, best = start, bestH = 1e9;
  while (heap.length && it++ < 60000) {
    const [, k] = pop(); if (k === goal) { best = k; break; }
    const x = k % N, y = (k / N) | 0, h = Math.hypot(x - tx, y - ty); if (h < bestH) { bestH = h; best = k; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx; if (G[nk] && nk !== goal) continue; if (dx && dy && (G[y * N + nx] || G[ny * N + x])) continue;
      const ng = g[k] + (dx && dy ? 1.414 : 1); if (ng < g[nk]) { g[nk] = ng; came[nk] = k; push(nk, ng + Math.hypot(nx - tx, ny - ty)); }
    }
  }
  const path = []; let k = best; while (k !== -1 && k !== start) { path.push([-HALF + (k % N) + 0.5, -HALF + ((k / N) | 0) + 0.5]); k = came[k]; }
  return path.reverse();
}

// ------------------------------------------------------------------ game state
let state = "loading", time = 0, chIdx = 0, runToken = 0, hitStop = 0, shake = 0, flash = 0, fadeK = 0;
const P = { ch: makeChar("mira", 0, 0, 0), x: 0, y: 0, z: 0, face: 0, hp: 100, max: 100, light: 100, potions: 0, sunstaff: false, inv: 0, rollCd: 0, rollDir: 0, hitDone: false, burstDone: false, dead: false, stepT: 0 };
let npcs = new Map(), enemies = [], fight = null, orbs = [], waves = [], items = [], parts = [], waiters = [], lit = {}, flags = {}, objective = null, focusKey = null, burnWait = new Set();
const inter = {}; // id → {x, y, z} interactables
function resetRun() { npcs = new Map(); enemies = []; fight = null; orbs = []; waves = []; items = []; parts = []; waiters = []; lit = {}; burnWait = new Set(); objective = null; focusKey = null; dlg.active = false; $("dlg").classList.add("hidden"); $("boss").classList.add("hidden"); }
function registerInteractables() {
  for (const k in inter) delete inter[k];
  for (const p of S.props) if (p.id) { inter[p.id] = { x: p.x, y: p.y, z: p.z, p }; if (p.t === "lamp" || p.t === "lanternTower" || p.t === "brazier" || p.t === "campfire") lit[p.id] = !!p.lit; if (p.t === "thorns") lit[p.id] = false; }
  for (const p of S.props) if (p.t === "shrine") inter.shrine = { x: p.x, y: p.y - 2.6, z: p.z, p };
  if (S.ch === 3) inter.heart = { x: S.spots.vesper[0], y: S.spots.vesper[1] - 2, z: S.h(...S.spots.vesper), p: null };
  if (S.ch === 1) for (const s of ["shardA", "shardB", "shardC"]) lit[s] = false;
}

// ------------------------------------------------------------------ input
const input = { keys: new Set(), mouse: { down: false, rdown: false, x: 0, y: 0, drag: 0, dragging: false }, stick: { x: 0, y: 0, id: null }, pressed: new Set() };
const press = (k) => input.pressed.add(k);
const KEYMAP = { KeyJ: "atk", KeyK: "burst", Space: "roll", ShiftLeft: "roll", ShiftRight: "roll", KeyF: "talk", Enter: "talk", KeyH: "pot", Digit1: "c1", Digit2: "c2", Digit3: "c3", ArrowUp: "up", ArrowDown: "down" };
addEventListener("keydown", (e) => {
  audio.init();
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
  if (!e.repeat && KEYMAP[e.code]) press(KEYMAP[e.code]);
  input.keys.add(e.code);
  if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) { if (state === "play") pause(); else if (state === "paused") resume(); }
});
addEventListener("keyup", (e) => input.keys.delete(e.code));
addEventListener("blur", () => { input.keys.clear(); if (state === "play" && !dlg.active) pause(); });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  audio.init();
  if (e.pointerType === "touch") { if (e.clientX < innerWidth * 0.45 && input.stick.id === null) { input.stick.id = e.pointerId; input.stick.ox = e.clientX; input.stick.oy = e.clientY; } else { input.mouse.tid = e.pointerId; input.mouse.x = e.clientX; input.mouse.y = e.clientY; input.mouse.down = true; input.mouse.drag = 0; } return; }
  input.mouse.x = e.clientX; input.mouse.y = e.clientY; input.mouse.drag = 0;
  if (e.button === 2) { input.mouse.rdown = true; } else input.mouse.down = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId === input.stick.id) { const dx = e.clientX - input.stick.ox, dy = e.clientY - input.stick.oy, l = Math.hypot(dx, dy), m = Math.min(l, 55); input.stick.x = l ? (dx / l) * (m / 55) : 0; input.stick.y = l ? (-dy / l) * (m / 55) : 0; $("stick").firstElementChild.style.transform = `translate(${input.stick.x * 38}px, ${-input.stick.y * 38}px)`; return; }
  if (!input.mouse.down && !input.mouse.rdown) return;
  const dx = e.clientX - input.mouse.x, dy = e.clientY - input.mouse.y; input.mouse.x = e.clientX; input.mouse.y = e.clientY;
  input.mouse.drag += Math.abs(dx) + Math.abs(dy);
  if (input.mouse.drag > 6) input.mouse.dragging = true;
});
const endPtr = (e) => {
  if (e.pointerId === input.stick.id) { input.stick.id = null; input.stick.x = input.stick.y = 0; $("stick").firstElementChild.style.transform = ""; return; }
  if (input.mouse.down && input.mouse.drag < 8 && e.pointerType !== "touch") { if (dlg.active) press("talk"); else press("atk"); }
  if (input.mouse.rdown && input.mouse.drag < 8) press("burst");
  input.mouse.down = false; input.mouse.rdown = false; input.mouse.dragging = false;
};
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
for (const [id, k] of [["t-atk", "atk"], ["t-bst", "burst"], ["t-roll", "roll"], ["t-talk", "talk"], ["t-pot", "pot"]]) $(id).addEventListener("pointerdown", (e) => { audio.init(); press(dlg.active ? "talk" : k); e.preventDefault(); e.stopPropagation(); });
$("dlg").addEventListener("pointerdown", (e) => { if (e.target.tagName !== "BUTTON") press("talk"); });
function moveInput() {
  const k = input.keys;
  let f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0), r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  if (input.stick.id !== null) { f = input.stick.y; r = input.stick.x; }
  if (bot) { f = botIn.f; r = botIn.r; }
  const l = Math.hypot(f, r); if (l > 1) { f /= l; r /= l; }
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw);
  return { x: fx * f + fy * r, y: fy * f - fx * r, m: Math.min(1, Math.hypot(f, r)) };
}

// ------------------------------------------------------------------ player
function nearestEnemy(x, y, maxD, dir = null, cone = 1.4) {
  let best = null, bd = maxD;
  for (const e of enemies) { if (e.dead) continue; const d = Math.hypot(e.x - x, e.y - y); if (d > bd) continue; if (dir !== null && Math.abs(dAng(dir, Math.atan2(e.y - y, e.x - x))) > cone) continue; bd = d; best = e; }
  return best;
}
function hurtPlayer(dmg, sx, sy) {
  if (P.inv > 0 || P.dead || state !== "play") return;
  P.hp -= dmg; P.ch.hurt = 0.25; P.inv = 0.5; shake = Math.min(1, shake + 0.4); flash = Math.max(flash, 0.15);
  const a = Math.atan2(P.y - sy, P.x - sx); P.kx = Math.cos(a) * 6; P.ky = Math.sin(a) * 6;
  if (!P.ch.act || P.ch.act.kind !== "roll") setAct(P.ch, "hurt", 0.3);
  num(`-${dmg}`, [P.x, P.y, P.z + 1.8], "p"); audio.sfx("hurt");
  if (P.hp <= 0) { P.hp = 0; playerDown(); }
}
function playerDown() {
  P.dead = true; setAct(P.ch, "die", 1.2); audio.sfx("down");
  setTimeout(() => { $("fade").textContent = "The light endures…"; $("fade").classList.add("show"); }, 900);
  setTimeout(() => {
    P.dead = false; P.ch.act = null; P.hp = P.max; P.light = 100; P.inv = 1.5;
    const sp = fight ? fight.start : (save.pos || S.spots.start);
    placePlayer(sp, P.face);
    if (fight) { enemies = enemies.filter((e) => !fight.list.includes(e)); fight.list = fight.spawns.map((s) => spawnEnemy(...s, fight.opts)); orbs = []; waves = []; }
    $("fade").classList.remove("show"); setTimeout(() => ($("fade").textContent = ""), 900);
  }, 2600);
}
function placePlayer(p, face = P.face) { P.x = p[0]; P.y = p[1]; P.z = S.ground(p[0], p[1]); P.face = face; cam.snap = true; for (const n of npcs.values()) if (n.follow) { n.ch.x = P.x - Math.cos(face) * 2 + (Math.random() - 0.5) * 2; n.ch.y = P.y - Math.sin(face) * 2 + (Math.random() - 0.5) * 2; n.ch.z = S.ground(n.ch.x, n.ch.y); } }
function tryMove(o, dx, dy, r = 0.35) {
  const nx = o.x + dx, ny = o.y + dy;
  const free = (x, y) => !walk.blocked(x, y) && !thornBlock(x, y, r);
  if (free(nx + Math.sign(dx) * r, o.y) && free(nx, o.y)) o.x = nx;
  if (free(o.x, ny + Math.sign(dy) * r) && free(o.x, ny)) o.y = ny;
}
function thornBlock(x, y, r) { for (const id in lit) if (lit[id] && inter[id]?.p?.t === "thorns") { const t = inter[id]; const d = Math.hypot(x - t.x, y - t.y); if (t.p.ring ? Math.abs(d - t.p.r) < 0.6 + r : d < t.p.r + r) return true; } return false; }
function stepPlayer(dt) {
  const c = P.ch, act = c.act, mi = state === "play" && !dlg.active && !P.dead ? moveInput() : { x: 0, y: 0, m: 0 };
  P.inv = Math.max(0, P.inv - dt); P.rollCd = Math.max(0, P.rollCd - dt);
  if (P.sunstaff) P.light = Math.min(100, P.light + dt * 4);
  const can = state === "play" && !dlg.active && !P.dead;
  // actions
  if (can && input.pressed.has("pot") && P.potions > 0 && P.hp < P.max) { P.potions--; P.hp = Math.min(P.max, P.hp + 45); audio.sfx("heal"); for (let i = 0; i < 16; i++) parts.push({ p: [P.x, P.y, P.z + 0.6 + Math.random()], v: [(Math.random() - 0.5), (Math.random() - 0.5), 1 + Math.random()], life: 1, c: [0.5, 1.4, 0.7], s: 0.12 }); num("+45", [P.x, P.y, P.z + 2], ""); }
  if (can && input.pressed.has("roll") && P.rollCd <= 0 && (!act || act.kind !== "roll")) { P.rollDir = mi.m > 0.1 ? Math.atan2(mi.y, mi.x) : P.face; P.face = P.rollDir; setAct(c, "roll", 0.45); P.inv = Math.max(P.inv, 0.38); P.rollCd = 0.7; audio.sfx("roll"); }
  if (can && input.pressed.has("burst")) {
    if (!P.sunstaff) hint("The Sunstaff's Light Burst isn't yours yet.");
    else if (P.light < 35) num("Not enough light", [P.x, P.y, P.z + 2.2], "t");
    else if (!act || act.kind !== "roll") { setAct(c, "burst", 0.6); P.burstDone = false; P.light -= 35; }
  }
  if (can && input.pressed.has("atk") && (!act || (act.kind === "attack" && act.t > act.dur * 0.55 && (act.step ?? 0) < 2))) {
    const step = act && act.kind === "attack" ? act.step + 1 : 0, dur = [0.42, 0.42, 0.62][step];
    const aim = nearestEnemy(P.x, P.y, 5, mi.m > 0.1 ? Math.atan2(mi.y, mi.x) : P.face, 1.6);
    if (aim) P.face = Math.atan2(aim.y - P.y, aim.x - P.x); else if (mi.m > 0.1) P.face = Math.atan2(mi.y, mi.x);
    setAct(c, "attack", dur, { step }); P.hitDone = false; audio.sfx("swing");
  }
  // movement
  let spd = 0;
  const A = c.act;
  if (A && A.kind === "roll") { const s = 7.5 * dt; tryMove(P, Math.cos(P.rollDir) * s, Math.sin(P.rollDir) * s); }
  else if (A && A.kind === "attack") {
    if (A.t < A.dur * 0.35) tryMove(P, Math.cos(P.face) * 3 * dt, Math.sin(P.face) * 3 * dt);
    if (!P.hitDone && A.t >= A.dur * 0.4) {
      P.hitDone = true; const st = A.step, range = st === 2 ? 2.9 : 2.4, cone = st === 2 ? 1.3 : 1.05, dmg = [12, 12, 22][st];
      let hit = false;
      for (const e of enemies) { if (e.dead) continue; const d = Math.hypot(e.x - P.x, e.y - P.y); if (d > range + e.r) continue; if (Math.abs(dAng(P.face, Math.atan2(e.y - P.y, e.x - P.x))) > cone) continue; const got = damageEnemy(e, dmg, P, W); if (got) { hit = true; num(String(got), [e.x, e.y, e.z + (e.kind === "wisp" ? 0.8 : 2)], ""); sparks([e.x, e.y, e.z + 1], [1.6, 1.2, 0.6], 10); P.light = Math.min(100, P.light + 3); } }
      if (hit) { hitStop = 0.06; shake = Math.min(1, shake + 0.15); audio.sfx("hit"); }
    }
  } else if (A && A.kind === "burst") {
    if (!P.burstDone && A.t > 0.22) {
      P.burstDone = true; audio.sfx("burst"); shake = Math.min(1, shake + 0.5); flash = Math.max(flash, 0.35);
      const tip = P.tip || [P.x, P.y, P.z + 1.5];
      for (let i = 0; i < 60; i++) { const a = Math.random() * TAU, v = 4 + Math.random() * 5; parts.push({ p: [...tip], v: [Math.cos(a) * v, Math.sin(a) * v, (Math.random() - 0.3) * 3], life: 0.7, c: [1.8, 1.3, 0.5], s: 0.12, drag: 3 }); }
      rings.push({ x: P.x, y: P.y, z: P.z + 0.1, r: 0.5, max: 4.8, life: 0.45 });
      for (const e of enemies) { if (e.dead) continue; const d = Math.hypot(e.x - P.x, e.y - P.y); if (d < 4.6 + e.r) { const got = damageEnemy(e, 30, P, W, "burst"); if (got) num(String(got), [e.x, e.y, e.z + 2], ""); } }
      for (const id in lit) if (lit[id] && inter[id]?.p?.t === "thorns" && Math.hypot(inter[id].x - P.x, inter[id].y - P.y) < inter[id].p.r + 4.5) burnThorns(id);
    }
  } else if (!P.dead && !(A && (A.kind === "hurt" && A.t < 0.15))) {
    if (mi.m > 0.05) { spd = mi.m; P.face += dAng(P.face, Math.atan2(mi.y, mi.x)) * Math.min(1, dt * 12); const s = 5.2 * mi.m * dt; tryMove(P, mi.x * s / mi.m * mi.m, mi.y * s / mi.m * mi.m); }
  }
  if (P.kx) { tryMove(P, P.kx * dt, P.ky * dt); P.kx *= Math.exp(-dt * 8); P.ky *= Math.exp(-dt * 8); if (Math.abs(P.kx) < 0.05) P.kx = 0; }
  P.z = S.ground(P.x, P.y);
  c.x = P.x; c.y = P.y; c.z = P.z; c.face = P.face; c.speed = lerp(c.speed, spd, 0.25);
  if (spd > 0.3) { P.stepT -= dt * spd; if (P.stepT < 0) { P.stepT = 0.33; audio.sfx("step"); } }
}
function burnThorns(id) { lit[id] = false; const t = inter[id]; for (let i = 0; i < 50; i++) parts.push({ p: [t.x + (Math.random() - 0.5) * t.p.r * 2, t.y + (Math.random() - 0.5) * t.p.r * 2, t.z + Math.random() * 1.5], v: [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 1 + Math.random() * 2], life: 1.2, c: [1.6, 0.8, 0.3], s: 0.15 }); audio.sfx("shatter"); }
const rings = [];
function sparks(p, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 2 + Math.random() * 4; parts.push({ p: [...p], v: [Math.cos(a) * v, Math.sin(a) * v, Math.random() * 3], life: 0.4, c, s: 0.07, g: 9 }); } }

// ------------------------------------------------------------------ enemies, fights, projectiles
const W = {
  P, get S() { return S; }, get walk() { return walk; }, get time() { return time; }, orbs, waves,
  hurt: (d, x, y) => hurtPlayer(d, x, y), sfx: (n) => audio.sfx(n), shake: (k) => (shake = Math.min(1, shake + k)),
  spawn: (kind, x, y) => { const e = spawnEnemy(kind, x, y, {}); if (fight) fight.list.push(e); },
  count: (kind) => enemies.filter((e) => !e.dead && e.kind === kind).length,
  dust: (x, y, r) => { for (let i = 0; i < 24; i++) { const a = Math.random() * TAU; parts.push({ p: [x + Math.cos(a) * r * Math.random(), y + Math.sin(a) * r * Math.random(), S.ground(x, y) + 0.2], v: [Math.cos(a) * 2, Math.sin(a) * 2, 1 + Math.random()], life: 0.8, c: [0.3, 0.25, 0.3], s: 0.4, smoke: 1 }); } },
  text: (t, e, col) => num(t, [e.x, e.y, e.z + 2.6], "t"),
};
function spawnEnemy(kind, x, y, opts) {
  const isBoss = kind === "morrow" || kind === "vesper";
  if (walk.blocked(x, y)) { let best = null, bd = 1e9; for (let r = 0.5; r < 14 && !best; r += 0.5) for (let a = 0; a < TAU; a += 0.4) { const qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r; if (!walk.blocked(qx, qy)) { const d = Math.hypot(qx - P.x, qy - P.y); if (d < bd + r) { best = [qx, qy]; bd = d; } } } if (best) [x, y] = best; }
  const e = makeEnemy(kind, x, y, S, isBoss ? { hp: opts.hp, resume: opts.resume, burstBonus: opts.burstBonus } : {});
  e.z = kind === "wisp" ? S.ground(x, y) + 1.2 : S.ground(x, y); e.face = Math.atan2(P.y - y, P.x - x);
  enemies.push(e);
  for (let i = 0; i < 20; i++) parts.push({ p: [x + (Math.random() - 0.5), y + (Math.random() - 0.5), e.z + Math.random() * 1.5], v: [(Math.random() - 0.5), (Math.random() - 0.5), 1 + Math.random()], life: 1, c: [0.25, 0.1, 0.35], s: 0.5, smoke: 1 });
  return e;
}
function stepCombat(dt) {
  for (const e of enemies) stepEnemy(e, dt, W);
  // a foe that cannot reach Mira for a while (water, cliffs) melts into shadow and re-forms beside her
  for (const e of enemies) {
    if (e.dead || e.kind === "wisp" || e.kind === "vesper") continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d < 3.5 || Math.hypot(e.x - (e.lx ?? 1e9), e.y - (e.ly ?? 1e9)) > 0.6) { e.lx = e.x; e.ly = e.y; e.stuckT = 0; continue; }
    e.stuckT = (e.stuckT || 0) + dt;
    if (e.stuckT > 4) {
      for (let a = 0; a < TAU; a += 0.5) { const qx = P.x + Math.cos(a + e.t0) * 4, qy = P.y + Math.sin(a + e.t0) * 4; if (!walk.blocked(qx, qy)) { W.dust(e.x, e.y, 1); e.x = qx; e.y = qy; e.z = S.ground(qx, qy); W.dust(qx, qy, 1); break; } }
      e.stuckT = 0; e.lx = e.x; e.ly = e.y;
    }
  }
  // corpses dissolve; kills drop light motes
  for (const e of enemies) if (e.dead && !e.dropped && e.deadT > 0.4) { e.dropped = true; for (let i = 0; i < 18; i++) parts.push({ p: [e.x + (Math.random() - 0.5), e.y + (Math.random() - 0.5), e.z + Math.random() * 1.5], v: [(Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5], life: 1.1, c: [0.3, 0.12, 0.4], s: 0.4, smoke: 1 }); if (P.sunstaff) P.light = Math.min(100, P.light + 6); motes.push({ x: e.x, y: e.y, z: e.z + 1, t: 0 }); }
  enemies = enemies.filter((e) => !e.dead || e.deadT < 1.4);
  for (const o of orbs) {
    const dx = P.x - o.x, dy = P.y - o.y, d = Math.hypot(dx, dy) || 1;
    o.vx += (dx / d) * o.home * dt * 4; o.vy += (dy / d) * o.home * dt * 4; const v = Math.hypot(o.vx, o.vy), vm = 7; if (v > vm) { o.vx *= vm / v; o.vy *= vm / v; }
    o.x += o.vx * dt; o.y += o.vy * dt; o.z = lerp(o.z, S.ground(o.x, o.y) + 1.1, dt * 2); o.life -= dt;
    if (d < 0.7) { hurtPlayer(o.dmg, o.x, o.y); o.life = 0; sparks([o.x, o.y, o.z], [1.2, 0.4, 1.6], 8); }
  }
  orbs.splice(0, orbs.length, ...orbs.filter((o) => o.life > 0));
  for (const w of waves) { w.r += w.v * dt; const d = Math.hypot(P.x - w.x, P.y - w.y); if (!w.hit && Math.abs(d - w.r) < 0.6) { w.hit = true; hurtPlayer(w.dmg, w.x, w.y); } }
  waves.splice(0, waves.length, ...waves.filter((w) => w.r < w.max));
  // fight resolution
  if (fight) {
    const boss = fight.list.find((e) => e.kind === "morrow" || e.kind === "vesper");
    if (fight.opts.boss && boss) { $("boss").classList.remove("hidden"); $("boss-n").textContent = fight.opts.boss; $("boss-i").style.width = (boss.hp / boss.max) * 100 + "%"; $("boss-s").textContent = boss.kind === "vesper" ? (boss.shield ? "SHADOW SHIELD — USE A LIGHT BURST" : "SHIELD BROKEN!") : ""; }
    const until = fight.opts.until;
    const done = until ? boss && boss.hp / boss.max <= until : fight.list.every((e) => e.dead);
    if (done && !P.dead) {
      const f = fight; fight = null; $("boss").classList.add("hidden");
      if (boss) { const key = boss.kind; enemies = enemies.filter((e) => e !== boss); for (const e of enemies) if (!e.dead) { e.hp = 0; e.dead = true; e.deadT = 0; } spawnNpc(key, key, [boss.x, boss.y], boss.face); }
      setTimeout(() => f.resolve(), boss ? 400 : 900);
      audio.setMood(moodFor());
    }
  }
}

// ------------------------------------------------------------------ NPCs and companions
function spawnNpc(id, key, pos, face = 0) { const c = makeChar(id, pos[0], pos[1], S.ground(pos[0], pos[1]), face); const n = { key, ch: c, follow: false, fighter: false, chatter: null, ci: 0, walkTo: null, cd: 0, slot: npcs.size }; npcs.set(key, n); return n; }
function stepNpcs(dt) {
  let slot = 0;
  for (const n of npcs.values()) {
    const c = n.ch; let spd = 0;
    if (n.walkTo) { const dx = n.walkTo[0] - c.x, dy = n.walkTo[1] - c.y, d = Math.hypot(dx, dy); if (d < 0.3) { const r = n.walkRes; n.walkTo = null; r && r(); } else { const s = Math.min(d, 3.2 * dt); c.x += (dx / d) * s; c.y += (dy / d) * s; c.face += dAng(c.face, Math.atan2(dy, dx)) * Math.min(1, dt * 8); spd = 0.7; } }
    else if (n.follow && !dlg.active && state === "play") {
      const target = n.fighter && fight ? nearestEnemy(c.x, c.y, 14) : null;
      if (target) {
        const d = Math.hypot(target.x - c.x, target.y - c.y);
        c.face += dAng(c.face, Math.atan2(target.y - c.y, target.x - c.x)) * Math.min(1, dt * 8);
        if (d > 1.8 + target.r) { const s = 4.2 * dt; c.x += Math.cos(c.face) * s; c.y += Math.sin(c.face) * s; spd = 0.9; }
        else { n.cd -= dt; if (n.cd < 0) { n.cd = 1.1 + Math.random() * 0.4; setAct(c, "attack", 0.5, { step: Math.floor(Math.random() * 3) }); setTimeout(() => { if (!target.dead) { const got = damageEnemy(target, 7, c, W); if (got) { num(String(got), [target.x, target.y, target.z + 2], ""); sparks([target.x, target.y, target.z + 1], [1.3, 1.3, 1.6], 6); } } }, 220); } }
      } else {
        const side = slot % 2 ? 1 : -1, back = 1.8 + Math.floor(slot / 2) * 1.2;
        const tx = P.x - Math.cos(P.face) * back + Math.cos(P.face + Math.PI / 2) * side * 1.3, ty = P.y - Math.sin(P.face) * back + Math.sin(P.face + Math.PI / 2) * side * 1.3;
        const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
        if (d > 22) { c.x = tx; c.y = ty; }
        else if (d > 0.6) { const s = Math.min(d, (d > 4 ? 6 : 4.2) * dt); const nx = c.x + (dx / d) * s, ny = c.y + (dy / d) * s; if (!walk.blocked(nx, ny) || d > 8) { c.x = nx; c.y = ny; } c.face += dAng(c.face, Math.atan2(dy, dx)) * Math.min(1, dt * 8); spd = d > 4 ? 1 : 0.6; }
        else c.face += dAng(c.face, P.face) * Math.min(1, dt * 2);
      }
      slot++;
    } else {
      // idle: glance at the player when near
      const d = Math.hypot(P.x - c.x, P.y - c.y);
      c.look = d < 6 ? clamp(dAng(c.face, Math.atan2(P.y - c.y, P.x - c.x)), -1, 1) : null;
    }
    c.z = S.ground(c.x, c.y);
    c.speed = lerp(c.speed, spd, 0.2);
    stepChar(c, dt);
  }
}

// ------------------------------------------------------------------ dialogue
const dlg = { active: false, lines: [], i: 0, shown: 0, full: "", choice: null, sel: 0, resolve: null, result: null, blip: 0 };
function sayLines(lines) {
  return new Promise((res) => { dlg.active = true; dlg.lines = lines; dlg.i = -1; dlg.resolve = res; dlg.result = null; $("dlg").classList.remove("hidden"); nextLine(); });
}
function nextLine() {
  dlg.i++;
  if (dlg.i >= dlg.lines.length) { dlg.active = false; $("dlg").classList.add("hidden"); for (const n of npcs.values()) n.ch.talk = 0; const r = dlg.resolve; dlg.resolve = null; r && r(dlg.result); return; }
  const L = dlg.lines[dlg.i];
  if (L.choice) {
    dlg.choice = L.choice; dlg.sel = 0;
    $("dlg-n").textContent = "MIRA"; $("dlg-pf").innerHTML = portrait("mira"); $("dlg-t").textContent = "";
    $("dlg-c").innerHTML = L.choice.map(([t], i) => `<button data-i="${i}" class="${i === 0 ? "sel" : ""}">${i + 1}. ${t}</button>`).join("");
    $("dlg-c").querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); pickChoice(+b.dataset.i); }));
    $("dlg-nx").style.display = "none";
    return;
  }
  dlg.choice = null; $("dlg-c").innerHTML = ""; $("dlg-nx").style.display = "";
  dlg.full = L.t; dlg.shown = 0; dlg.who = L.w;
  $("dlg-n").textContent = (CAST[L.w]?.name || L.w).toUpperCase();
  $("dlg-pf").innerHTML = portrait(L.w, L.m || ""); $("dlg-pf").classList.remove("pop"); void $("dlg-pf").offsetWidth; $("dlg-pf").classList.add("pop");
  $("dlg-t").textContent = "";
}
function pickChoice(i) { dlg.result = dlg.choice[i][1]; audio.sfx("ui"); $("dlg-c").innerHTML = ""; nextLine(); }
function stepDialogue(dt) {
  if (!dlg.active) return;
  if (dlg.choice) {
    if (input.pressed.has("c1")) pickChoice(0); else if (input.pressed.has("c2") && dlg.choice[1]) pickChoice(1); else if (input.pressed.has("c3") && dlg.choice[2]) pickChoice(2);
    else if (input.pressed.has("up") || input.pressed.has("down")) { dlg.sel = (dlg.sel + (input.pressed.has("down") ? 1 : dlg.choice.length - 1)) % dlg.choice.length; $("dlg-c").querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === dlg.sel)); }
    else if (input.pressed.has("talk") || (bot && (botIn.dlgT += dt) > 0.5)) { botIn.dlgT = 0; pickChoice(dlg.sel); }
    return;
  }
  const before = dlg.shown;
  dlg.shown = Math.min(dlg.full.length, dlg.shown + dt * 48);
  const nc = Math.floor(dlg.shown);
  if (nc !== Math.floor(before)) { $("dlg-t").textContent = dlg.full.slice(0, nc); if (nc % 3 === 0) audio.blip(CAST[dlg.who]?.voice || 1); }
  const speaker = [...npcs.values()].find((n) => n.ch.id === dlg.who) || (dlg.who === "mira" ? { ch: P.ch } : null);
  if (speaker && dlg.shown < dlg.full.length) speaker.ch.talk = 0.3;
  if (input.pressed.has("talk") || (bot && (botIn.dlgT += dt) > (dlg.shown >= dlg.full.length ? 0.35 : 9))) {
    botIn.dlgT = 0;
    if (dlg.shown < dlg.full.length) { dlg.shown = dlg.full.length; $("dlg-t").textContent = dlg.full; }
    else { audio.sfx("ui"); nextLine(); }
  }
}

// ------------------------------------------------------------------ story API
let G = null;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
function waiter(test, extra = {}) { return new Promise((res) => waiters.push({ test, res, token: runToken, ...extra })); }
function targetPos(t) {
  if (!t) return null;
  if (typeof t === "string") { const n = npcs.get(t); if (n) return [n.ch.x, n.ch.y]; const it = inter[t] || items.find((i) => i.id === t); return it ? [it.x, it.y] : null; }
  if (Array.isArray(t) && typeof t[0] === "string") { let best = null, bd = 1e9; for (const id of t) { const p = targetPos(id); if (p && dist2(p, [P.x, P.y]) < bd) { bd = dist2(p, [P.x, P.y]); best = p; } } return best; }
  return t;
}
function makeG(ch, from) {
  const tok = runToken;
  const live = () => tok === runToken;
  return {
    map: S, from,
    chapterCard: async (i) => { const C = CHAPTERS[i]; $("card-k").textContent = `CHAPTER ${C.n}`; $("card-t").textContent = C.title; $("card-s").textContent = C.sub; $("card").classList.add("show"); await sleep(3.4); $("card").classList.remove("show"); await sleep(0.6); },
    say: (lines) => (live() ? sayLines(lines) : new Promise(() => { })),
    npc: (id, key, pos, face) => { if (!npcs.has(key)) spawnNpc(id, key, pos, face); },
    npcIf: (key, pos) => { if (!npcs.has(key)) spawnNpc(key, key, pos, 0); },
    npcAt: (key, pos, face) => { const n = npcs.get(key) || spawnNpc(key, key, pos, face); n.ch.x = pos[0]; n.ch.y = pos[1]; n.ch.z = S.ground(...pos); if (face !== undefined) n.ch.face = face; },
    remove: (key) => npcs.delete(key),
    swap: (key, id) => { const n = npcs.get(key); if (!n) return; const c = makeChar(id, n.ch.x, n.ch.y, n.ch.z, n.ch.face); c.act = n.ch.act; npcs.delete(key); const m = spawnNpc(id, id, [c.x, c.y], c.face); m.ch.act = c.act; },
    act: (key, kind, dur) => { const n = key === "mira" ? { ch: P.ch } : npcs.get(key); if (n) setAct(n.ch, kind, dur); },
    follow: (key, fighter = false) => { const n = npcs.get(key); if (n) { n.follow = true; n.fighter = fighter; } },
    chatter: (key, sets) => { const n = npcs.get(key); if (n) n.chatter = sets; },
    focus: (key) => { focusKey = key; },
    placePlayer: (p, face) => placePlayer(p, face),
    objective: (text, target) => { objective = text ? { text, target } : null; $("obj").classList.toggle("hidden", !text); if (text) { $("obj-t").textContent = text; $("obj").classList.remove("flash"); void $("obj").offsetWidth; $("obj").classList.add("flash"); audio.sfx("quest"); } },
    reach: (p, r) => waiter(() => dist2([P.x, P.y], p) < r),
    reachAny: (list, r) => new Promise((res) => { const w = { token: runToken, test: () => { for (const [id, p] of list) if (dist2([P.x, P.y], p) < r) { w.hit = id; return true; } return false; }, res: () => res(w.hit) }; waiters.push(w); }),
    talkTo: (key) => waiter(() => false, { talk: key }),
    interactAny: (ids, label) => new Promise((res) => waiters.push({ token: runToken, test: () => false, inter: ids, label, res })),
    burned: (id) => { burnWait.add(id); return waiter(() => !lit[id]); },
    fight: (list, opts = {}) => new Promise((res) => { const spawns = list.map((s) => [s[0], s[1], s[2]]); fight = { spawns, opts, resolve: res, start: [P.x, P.y], list: [] }; for (const [k] of list) if (npcs.has(k)) npcs.delete(k); fight.list = spawns.map((s) => spawnEnemy(...s, opts)); audio.setMood(opts.boss ? "boss" : "battle"); }),
    wait: (s) => sleep(s),
    setEnv: (name, dur, opts) => setEnv(name, dur, opts),
    lit: (id, v) => { lit[id] = v; },
    isLit: (id) => !!lit[id],
    flag: (k, v) => { if (v !== undefined) flags[k] = v; return flags[k]; },
    give: (item, n = 1) => { if (item === "sunstaff") { P.sunstaff = true; P.light = 100; } if (item === "potion") P.potions += n; },
    drop: (id, pos) => { items.push({ id, x: pos[0], y: pos[1], z: S.ground(...pos) }); inter[id] = { x: pos[0], y: pos[1], z: S.ground(...pos), p: null, item: 1 }; },
    hint: (t) => hint(t),
    bark: (key, t) => bark(key, t),
    sfx: (n) => audio.sfx(n),
    flash: (k) => (flash = Math.max(flash, k)),
    fx: (kind, p) => { for (let i = 0; i < 40; i++) parts.push({ p: [p[0] + (Math.random() - 0.5) * 1.5, p[1] + (Math.random() - 0.5) * 1.5, S.ground(p[0], p[1]) + Math.random() * 2.5], v: [(Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 2], life: 1.6, c: [0.3, 0.1, 0.4], s: 0.7, smoke: 1 }); },
    checkpoint: (cp) => { if (!live()) return; save.ch = ch; save.cp = cp; save.flags = { ...flags }; save.pos = [P.x, P.y]; save.potions = P.potions; save.sunstaff = P.sunstaff; save.started = true; save.unlocked = Math.max(save.unlocked, ch); persist(); },
    endChapter: async () => {
      if (!live()) return;
      $("card-k").textContent = "CHAPTER COMPLETE"; $("card-t").textContent = CHAPTERS[ch].title; $("card-s").textContent = ch < 3 ? "The journey continues…" : ""; $("card").classList.add("show"); audio.sfx("item");
      save.ch = Math.min(3, ch + 1); save.cp = 0; save.flags = { ...flags }; save.pos = null; save.potions = P.potions; save.sunstaff = P.sunstaff; save.unlocked = Math.max(save.unlocked, ch + 1); persist();
      await sleep(3.2); $("card").classList.remove("show");
      if (ch < 3) startChapter(ch + 1, 0);
    },
    ending: async () => {
      await sleep(1);
      $("cr-p").innerHTML = `The Last Lantern of Willowmere was lit again that night — by Keeper Mira.<br><br>${flags.spared ? "Aldric stood the north gate beside his brother, and the two of them were never seen apart again." : "Aldric kept the gate's lamps lit, every night, until his brother came home."} ${flags.forgave ? "And every autumn, a quiet old man with violet eyes helps Bram hang the festival lanterns." : "Vesper answered to the valley, and in time, the valley answered back with mercy."}<br><br>Tobi became the most famous fox in the valley. He would like you to know he was very brave.`;
      $("credits").classList.remove("hidden"); $("hud").classList.add("hidden"); state = "credits"; save.unlocked = 3; save.ch = 3; save.cp = 0; persist(); audio.setMood("dawn");
    },
  };
}
function hint(t) { $("hint").textContent = t; $("hint").classList.add("show"); clearTimeout(hint.t); hint.t = setTimeout(() => $("hint").classList.remove("show"), 6500); }
const barks = [];
function bark(key, t) { const n = key === "mira" ? { ch: P.ch } : npcs.get(key); if (!n) return; const el = document.createElement("div"); el.className = "bark"; el.textContent = t; $("barks").appendChild(el); barks.push({ el, ch: n.ch, life: 2.6 }); audio.blip(CAST[n.ch.id]?.voice || 1); }
function num(t, p, cls) { const el = document.createElement("div"); el.className = "num " + cls; el.textContent = t; $("nums").appendChild(el); nums.push({ el, p, life: 0.9 }); }
const nums = [], motes = [];
function stepWaiters() {
  for (let i = waiters.length - 1; i >= 0; i--) { const w = waiters[i]; if (w.token !== runToken) { waiters.splice(i, 1); continue; } if (w.test()) { waiters.splice(i, 1); w.res(); } }
}

// ------------------------------------------------------------------ interaction prompt (F)
function stepInteract() {
  let best = null, bd = 1e9;
  if (state !== "play" || dlg.active || fight || P.dead) { $("prompt").classList.remove("show"); return; }
  for (const w of waiters) {
    if (w.talk) { const n = npcs.get(w.talk); if (n) { const d = Math.hypot(n.ch.x - P.x, n.ch.y - P.y); if (d < 3 && d < bd) { bd = d; best = { story: 1, label: `Talk to ${CAST[n.ch.id].name}`, go: () => { waiters.splice(waiters.indexOf(w), 1); faceEach(n); w.res(); } }; } } }
    if (w.inter) for (const id of w.inter) { const it = inter[id]; if (!it) continue; const d = Math.hypot(it.x - P.x, it.y - P.y); if (d < 2.6 && d < bd) { bd = d; best = { story: 1, label: w.label, go: () => { waiters.splice(waiters.indexOf(w), 1); P.face = Math.atan2(it.y - P.y, it.x - P.x); setAct(P.ch, "cast", 0.5); if (it.item) { items = items.filter((x) => x.id !== id); } w.res(id); } }; } }
  }
  if (!best) for (const n of npcs.values()) if (n.chatter && !n.follow) { const d = Math.hypot(n.ch.x - P.x, n.ch.y - P.y); if (d < 2.6 && d < bd) { bd = d; best = { label: `Talk to ${CAST[n.ch.id].name}`, go: () => { faceEach(n); sayLines(n.chatter[n.ci % n.chatter.length]); n.ci++; } }; } }
  $("prompt").classList.toggle("show", !!best);
  if (best) $("prompt").innerHTML = `<kbd>F</kbd>${best.label}`;
  if (best && (input.pressed.has("talk") || (bot && botIn.wantTalk && best.story))) { botIn.wantTalk = false; best.go(); }
  stepInteract.best = best;
}
function faceEach(n) { n.ch.face = Math.atan2(P.y - n.ch.y, P.x - n.ch.x); P.face = Math.atan2(n.ch.y - P.y, n.ch.x - P.x); }

// ------------------------------------------------------------------ bot (?auto): follows objectives with A*, fights, talks
const botIn = { f: 0, r: 0, path: [], pathT: 0, dlgT: 0, wantTalk: false, stuck: 0, last: [0, 0] };
function stepBot(dt) {
  botIn.f = 0; botIn.r = 0;
  if (state !== "play" || dlg.active || P.dead) return;
  let goal = null;
  const foe = nearestEnemy(P.x, P.y, 40);
  if (foe) {
    const d = Math.hypot(foe.x - P.x, foe.y - P.y);
    if (P.hp < 40 && P.potions > 0) press("pot");
    const close = enemies.filter((e) => !e.dead && Math.hypot(e.x - P.x, e.y - P.y) < 4.2).length;
    if (P.sunstaff && P.light >= 35 && (close >= 2 || (foe.kind === "vesper" && foe.shield && d < 4.2) || (foe.kind === "morrow" && d < 4))) press("burst");
    if (foe.tele && Math.hypot(foe.tele.x - P.x, foe.tele.y - P.y) < 3 && foe.tele.k > 0.7 && Math.random() < 0.15) press("roll");
    if (d < 2.2 + foe.r) { P.face = Math.atan2(foe.y - P.y, foe.x - P.x); press("atk"); return; }
    goal = [foe.x, foe.y];
  }
  for (const id of burnWait) if (lit[id]) { const t = inter[id]; const d = Math.hypot(t.x - P.x, t.y - P.y); if (d < t.p.r + 4.3) { if (P.light >= 35) press("burst"); return; } goal = goal || [t.x - (t.x - P.x) / d * (t.p.r + 2.5), t.y - (t.y - P.y) / d * (t.p.r + 2.5)]; }
  if (stepInteract.best?.story) { botIn.wantTalk = true; return; }
  if (!goal) {
    const w = waiters.find((w) => w.talk || w.inter);
    if (w) goal = w.talk ? targetPos(w.talk) : targetPos(w.inter);
    if (!goal && objective) goal = targetPos(objective.target);
  }
  if (!goal) return;
  botIn.pathT -= dt;
  if (botIn.pathT < 0 || !botIn.path.length) { botIn.path = astar([P.x, P.y], goal); botIn.pathT = 1.0; }
  while (botIn.path.length && dist2(botIn.path[0], [P.x, P.y]) < 0.8) botIn.path.shift();
  const nxt = botIn.path[0] || goal, dx = nxt[0] - P.x, dy = nxt[1] - P.y, d = Math.hypot(dx, dy);
  if (dist2(goal, [P.x, P.y]) < 1.2) return;
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw);
  botIn.f = (dx * fx + dy * fy) / (d || 1); botIn.r = (dx * fy - dy * fx) / (d || 1);
  botIn.stuck = dist2(botIn.last, [P.x, P.y]) < 0.02 ? botIn.stuck + dt : 0; botIn.last = [P.x, P.y];
  if (botIn.stuck > 1.5) { botIn.stuck = 0; botIn.path = []; press("roll"); }
}

// ------------------------------------------------------------------ camera
const cam = { yaw: Math.PI / 2, pitchT: 0.78, lead: [0, 0], t: [0, 0, 0], e: [0, 0, 0], snap: true, title: 0 };
// A fixed, diorama-style camera (DESIGN.md §2): a constant view angle (looking north, ~45° down) that smoothly
// follows Mira and leads a little in the direction she moves. It pushes in for dialogue (framing both speakers),
// pulls back for fights, and tilts more top-down when a building would hide her.
function updateCamera(dt) {
  let T, dist, pitch = 0.78;
  const yaw = Math.PI / 2;
  if (state === "title" || state === "credits") {
    cam.title += dt;
    T = [Math.sin(cam.title * 0.05) * 3, -4 + Math.cos(cam.title * 0.04) * 2, S.h(0, -4) + 1.2];
    dist = 24; pitch = 0.62;
  } else if (dlg.active || focusKey) {
    const who = dlg.active ? dlg.who : null, n = who && who !== "mira" ? [...npcs.values()].find((m) => m.ch.id === who) : focusKey ? npcs.get(focusKey) : null;
    const A = [P.x, P.y, P.z + 1.0], B = n ? [n.ch.x, n.ch.y, n.ch.z + 1.0 * (n.ch.spec.scale || 1)] : A;
    T = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2 + 0.2];
    dist = clamp(5.5 + Math.hypot(A[0] - B[0], A[1] - B[1]) * 0.9, 6, 13); pitch = 0.55;
  } else {
    const mv = P.ch.speed;
    cam.lead[0] += (Math.cos(P.face) * 1.6 * mv - cam.lead[0]) * Math.min(1, dt * 1.5); cam.lead[1] += (Math.sin(P.face) * 1.6 * mv - cam.lead[1]) * Math.min(1, dt * 1.5);
    T = [P.x + cam.lead[0], P.y + cam.lead[1], P.z + 0.9];
    dist = fight?.opts.boss ? 15 : fight ? 12 : 9.5;
  }
  // occlusion: tilt toward top-down if something solid stands between Mira and the camera
  let occ = 0;
  if (state === "play" && !dlg.active) for (let s = 1; s < 6.5; s += 0.5) if (walk.solid(T[0], T[1] - s)) { occ = 1; break; }
  cam.pitchT += ((occ ? 0.98 : pitch) - cam.pitchT) * Math.min(1, dt * 2.5);
  const p = cam.pitchT, E = [T[0] - Math.cos(yaw) * Math.cos(p) * dist, T[1] - Math.sin(yaw) * Math.cos(p) * dist, T[2] + Math.sin(p) * dist];
  E[2] = Math.max(E[2], S.h(E[0], E[1]) + 1.5);
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * (dlg.active ? 2.5 : 4));
  for (let i = 0; i < 3; i++) { cam.t[i] += (T[i] - cam.t[i]) * k; cam.e[i] += (E[i] - cam.e[i]) * k; }
  cam.snap = false; cam.yaw = yaw;
  const sx = (Math.sin(time * 47) + Math.sin(time * 31)) * shake * 0.08;
  space.magnifier = 1.75 * 1.6;
  space.lookAt(cam.e[0] + sx, cam.e[1], cam.e[2] + sx * 0.5, cam.t[0], cam.t[1], cam.t[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(200000), A = new Mesh(40000), SH = new Mesh(4000), dyn = new Mesh(260000);
const FLAME = [1.9, 1.05, 0.4];
function flame(p, k = 1, col = FLAME) {
  for (let i = 0; i < 3; i++) { const f = Math.sin(time * (9 + i * 3) + i) * 0.04; A.sprite(p[0] + f, p[1], p[2] + i * 0.12 * k, (0.35 - i * 0.08) * k, col[0] * 0.35, col[1] * 0.35, col[2] * 0.35); }
  A.sprite(p[0], p[1], p[2], 1.4 * k, col[0] * 0.08, col[1] * 0.06, col[2] * 0.04);
  if (Math.random() < 0.3 * k) parts.push({ p: [p[0] + (Math.random() - 0.5) * 0.2, p[1] + (Math.random() - 0.5) * 0.2, p[2] + 0.2], v: [(Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 1 + Math.random()], life: 0.8, c: col, s: 0.04 });
}
function contactShadow(x, y, z, r, k = 0.6) { const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x + u * r, y + v * r, z + 0.04]); SH.quad4(q[0], q[1], q[2], q[3], [-1, -1, k], [1, -1, k], [1, 1, k], [-1, 1, k], MAT.SHADOW); }
function decal(T) {
  const k = clamp(T.k, 0, 1), col = (a) => [0.55 * a, 0.08 * a, 0.08 * a], z = (x, y) => S.ground(x, y) + 0.06;
  if (T.type === "circle") { const n = 28; for (let i = 0; i < n; i++) { const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, P0 = (a, r) => [T.x + Math.cos(a) * r, T.y + Math.sin(a) * r, z(T.x, T.y)]; A.quad4(P0(a0, T.r * k), P0(a1, T.r * k), P0(a1, T.r * k - 0.12), P0(a0, T.r * k - 0.12), col(1.2), col(1.2), col(0.6), col(0.6), MAT.ADD); A.tri3([T.x, T.y, z(T.x, T.y)], P0(a0, T.r), P0(a1, T.r), col(0.25), col(0.45), col(0.45), MAT.ADD); } }
  if (T.type === "cone") { const n = 14; for (let i = 0; i < n; i++) { const a0 = T.a - T.half + (i / n) * T.half * 2, a1 = T.a - T.half + ((i + 1) / n) * T.half * 2, P0 = (a, r) => [T.x + Math.cos(a) * r, T.y + Math.sin(a) * r, z(T.x, T.y)]; A.tri3([T.x, T.y, z(T.x, T.y)], P0(a0, T.r * k), P0(a1, T.r * k), col(0.2), col(0.9), col(0.9), MAT.ADD); A.tri3([T.x, T.y, z(T.x, T.y)], P0(a0, T.r), P0(a1, T.r), col(0.1), col(0.3), col(0.3), MAT.ADD); } }
  if (T.type === "line" || T.type === "beam") { const c = Math.cos(T.a), s = Math.sin(T.a), w = T.w / 2, L = T.len, beam = T.type === "beam"; const p = (u, v) => [T.x + c * u - s * v, T.y + s * u + c * v, z(T.x + c * u, T.y + s * u)]; const cc = beam ? [1.4, 0.4, 1.6] : col(0.8); A.quad4(p(0, -w), p(L * (beam ? 1 : k), -w), p(L * (beam ? 1 : k), w), p(0, w), cc, cc, cc, cc, MAT.ADD); if (beam) for (let i = 0; i < 12; i++) A.sprite(T.x + c * L * i / 12, T.y + s * L * i / 12, S.ground(T.x + c * L * i / 12, T.y + s * L * i / 12) + 1.2, 1.1, 0.5, 0.12, 0.6); }
}
function drawThorns(t) {
  const R = mulberry(t.p.x * 13 + t.p.y), n = t.p.ring ? 26 : 30;
  for (let i = 0; i < n; i++) {
    const a = t.p.ring ? (i / n) * TAU : R() * TAU, r = t.p.ring ? t.p.r : Math.sqrt(R()) * t.p.r, x = t.x + Math.cos(a) * r, y = t.y + Math.sin(a) * r, z = S.ground(x, y), h = 0.8 + R() * 1.0;
    const tip = [x + (R() - 0.5) * 0.8, y + (R() - 0.5) * 0.8, z + h + Math.sin(time * 2 + i) * 0.05];
    limb(D, [x, y, z - 0.1], tip, 0.09, 0.01, [0.1, 0.05, 0.12], MAT.DARK, 4);
    limb(D, [lerp(x, tip[0], 0.5), lerp(y, tip[1], 0.5), lerp(z, tip[2], 0.5)], [tip[0] + (R() - 0.5), tip[1] + (R() - 0.5), tip[2] - 0.2], 0.04, 0.005, [0.1, 0.05, 0.12], MAT.DARK, 3);
    if (i % 4 === 0) A.sprite(tip[0], tip[1], tip[2], 0.3, 0.12, 0.02, 0.18);
  }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SHARD = new Mesh(200); { const c = [1.9, 1.4, 0.5]; const top = [0, 0, 0.5], bot = [0, 0, -0.3]; for (let i = 0; i < 6; i++) { const a0 = i / 6 * TAU, a1 = (i + 1) / 6 * TAU, p0 = [Math.cos(a0) * 0.18, Math.sin(a0) * 0.18, 0], p1 = [Math.cos(a1) * 0.18, Math.sin(a1) * 0.18, 0]; SHARD.tri(p0, p1, top, c, MAT.EMIT); SHARD.tri(p1, p0, bot, c.map((v) => v * 0.7), MAT.EMIT); } }
function drawShard(p, k = 1) { const r = time * 1.2; for (let i = 0; i < SHARD.n; i++) { const o = i * 4, x = SHARD.pos[o], y = SHARD.pos[o + 1], z = SHARD.pos[o + 2]; D.v(p[0] + (x * Math.cos(r) - y * Math.sin(r)) * k, p[1] + (x * Math.sin(r) + y * Math.cos(r)) * k, p[2] + z * k + Math.sin(time * 2) * 0.08, 1, SHARD.col[o], SHARD.col[o + 1], SHARD.col[o + 2], SHARD.col[o + 3]); } A.sprite(p[0], p[1], p[2] + 0.1, 1.2 * k, 0.25, 0.18, 0.06); }
function buildDynamic() {
  perf.t0 = performance.now();
  D.reset(); A.reset(); SH.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const cx = cam.t[0], cy = cam.t[1];
  // story props: lamps, braziers, shards, shrine, thorns, cage, heart, items
  for (const id in inter) {
    const it = inter[id], p = it.p;
    if (Math.hypot(it.x - cx, it.y - cy) > 110) continue;
    if (p?.t === "lamp" && lit[id] && p.flame) flame(p.flame, 0.9);
    if (p?.t === "lanternTower" && lit[id]) { flame(p.flame, 2.2); A.sprite(...p.flame, 5, 0.25, 0.15, 0.05); }
    if ((p?.t === "brazier" || p?.t === "campfire") && lit[id] && p.flame) flame(p.flame, 1.6);
    if (p?.t === "pedestal" && lit[id]) drawShard([p.x, p.y, p.top + 0.45]);
    if (p?.t === "thorns" && lit[id]) drawThorns(it);
    if (id === "cage" && lit.cage) { for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; limb(D, [it.x + Math.cos(a) * 1.2, it.y + Math.sin(a) * 1.2, it.z - 0.1], [it.x + Math.cos(a) * 0.8, it.y + Math.sin(a) * 0.8, it.z + 2.6], 0.05, 0.04, [0.12, 0.1, 0.14], MAT.METAL, 4); } tube(D, it.x, it.y, 14, 1.25, it.z + 0.05, 1.25, it.z + 0.2, [0.1, 0.08, 0.12], MAT.METAL, 0); A.sprite(it.x, it.y, it.z + 1.3, 1.6, 0.1, 0.02, 0.16); }
    if (id === "shrine" && lit.shrine) { for (let k = 0; k < 3; k++) drawShard(p["socket" + k], 0.7); for (let i = 0; i < 10; i++) A.sprite(p.x, p.y, p.top + i * 1.4, 1.8 - i * 0.1, 0.18, 0.13, 0.05); }
  }
  for (const p of S.props) if (p.t === "brazier" && p.dark && p.flame) flame(p.flame, 1.3, [1.2, 0.35, 1.8]);
  for (const p of S.props) if (p.t === "lamp" && p.lit && !p.id && p.flame) flame(p.flame, 0.7);
  if (S.ch === 3) { const h = inter.heart, c = [S.spots.vesper[0], S.spots.vesper[1], S.h(...S.spots.vesper) + 9 + Math.sin(time) * 0.3], dawn = env.cur.eclipse < 0.5; A.sprite(...c, 4 + Math.sin(time * 3) * 0.3, dawn ? 0.5 : 0.25, dawn ? 0.35 : 0.05, dawn ? 0.12 : 0.35); A.sprite(...c, 1.6, dawn ? 1 : 0.4, dawn ? 0.8 : 0.1, dawn ? 0.3 : 0.6); void h; }
  for (const it of items) { drawShard([it.x, it.y, it.z + 0.6], 0.45); }
  for (const p of S.props) if (p.t === "boat") { const z = S.waterZ + 0.05 + Math.sin(time * 1.2) * 0.04; for (let k = 0; k < 7; k++) { const x = p.x - 1.2 + k * 0.4; tube(D, x, p.y, 6, 0.2, z, 0.2, z + 0.15, [0.35, 0.25, 0.16], MAT.WOOD, 0); } blob(D, [p.x, p.y, z + 0.1], 1.5, 2.6, 0.25, [0.3, 0.22, 0.15], MAT.WOOD, 10, 4); limb(D, [p.x + 1, p.y + 2, z], [p.x + 1, p.y + 2, z + 1.8], 0.04, 0.04, [0.2, 0.2, 0.2], MAT.METAL, 4); flame([p.x + 1, p.y + 2, z + 1.9], 0.6); }
  perf.t1 = performance.now();
  // characters
  const all = [{ ch: P.ch, me: 1 }, ...[...npcs.values()].map((n) => ({ ch: n.ch }))];
  charDraws.length = 0;
  for (const { ch, me } of all) {
    const d = Math.hypot(ch.x - cx, ch.y - cy); if (d > 90) continue;
    if (ch.alpha <= 0) continue;
    const o = poseChar(ch, time); charDraws.push({ id: ch.id, B: o.B, hit: ch.hurt > 0 ? 0.6 : 0 });
    if (me) P.tip = o.tip;
    if (o.tip && (ch.spec.weapon === "lantern" || ch.spec.weapon === "staff")) { A.sprite(...o.tip, 0.9, 0.35, 0.22, 0.08); A.sprite(...o.tip, 0.25, 0.9, 0.7, 0.3); }
    if (o.tip && ch.spec.weapon === "voidstaff") A.sprite(...o.tip, 1.2, 0.3, 0.06, 0.4);
    contactShadow(ch.x, ch.y, ch.z, 0.55 * (ch.spec.scale || 1), 0.55);
  }
  perf.t2 = performance.now();
  for (const e of enemies) {
    if (Math.hypot(e.x - cx, e.y - cy) > 80) continue;
    const fade = e.dead ? 1 - e.deadT / 1.2 : 1;
    if (fade <= 0) continue;
    if (e.kind === "wisp") { if (!e.dead || e.deadT < 0.2) drawWisp(D, A, e, time); contactShadow(e.x, e.y, S.ground(e.x, e.y), 0.45, 0.35); }
    else { e.ch.z -= e.dead ? e.deadT * 0.3 : 0; const o = poseChar(e.ch, time); charDraws.push({ id: e.ch.id, B: o.B, hit: e.hurt > 0 ? 0.6 : 0 }); if (o.tip && e.kind === "vesper") A.sprite(...o.tip, 1.4, 0.35, 0.08, 0.5); contactShadow(e.x, e.y, e.z, 0.6 * (e.ch.spec.scale || 1), 0.6); if (e.kind === "vesper" && e.shield) { const n = 18; for (let i = 0; i < n; i++) { const a = i / n * TAU + time; A.sprite(e.x + Math.cos(a) * 1.4, e.y + Math.sin(a) * 1.4, e.z + 1.5 + Math.sin(a * 3 + time * 2) * 0.6, 0.6, 0.12, 0.03, 0.2); } } if (e.ch.spec.glow) A.sprite(e.x, e.y, e.z + 1.6 * (e.ch.spec.scale || 1), 1.0, 0.08, 0.02, 0.1); }
    if (e.tele) decal(e.tele);
  }
  for (const o of orbs) { A.sprite(o.x, o.y, o.z, 0.7, 0.4, 0.08, 0.55); A.sprite(o.x, o.y, o.z, 0.22, 1.4, 0.6, 1.8); }
  for (const w of waves) { const n = 40; for (let i = 0; i < n; i++) { const a = i / n * TAU, x = w.x + Math.cos(a) * w.r, y = w.y + Math.sin(a) * w.r; A.sprite(x, y, S.ground(x, y) + 0.4, 0.7, 0.25, 0.05, 0.35); } }
  for (const r of rings) { const n = 36; for (let i = 0; i < n; i++) { const a = i / n * TAU, x = r.x + Math.cos(a) * r.r, y = r.y + Math.sin(a) * r.r; A.sprite(x, y, S.ground(x, y) + 0.5, 0.6, 0.6 * r.life * 2, 0.45 * r.life * 2, 0.15 * r.life * 2); } }
  for (const q of parts) { const k = Math.max(0, q.life) * (q.smoke ? 0.18 : 0.9); A.sprite(...q.p, q.s * (q.smoke ? 1 + (1.6 - q.life) : 1), q.c[0] * k, q.c[1] * k, q.c[2] * k); }
  for (const m of motes) A.sprite(m.x, m.y, m.z, 0.25, 0.6, 0.45, 0.15);
  // ambient life: fireflies at dusk / night, embers at the Spire
  const amb = S.env;
  if (amb === "dusk" || amb === "night") for (let i = 0; i < 70; i++) { const ph = i * 7.13, x = cx + ((i * 37.3) % 60) - 30 + Math.sin(time * 0.3 + ph) * 2, y = cy + ((i * 53.7) % 60) - 30 + Math.cos(time * 0.27 + ph) * 2, k = Math.max(0, Math.sin(time * 1.5 + ph)) ** 3 * 0.5; if (k > 0.02) { const z = S.h(x, y) + 0.6 + Math.sin(time * 0.6 + ph) * 0.5 + (i % 3) * 0.5; A.sprite(x, y, z, 0.12, k * 0.7, k, k * 0.3); } }
  if (env.cur.eclipse > 0.3) for (let i = 0; i < 60; i++) { const ph = i * 3.7, x = cx + ((i * 41.3) % 50) - 25, y = cy + ((i * 29.7) % 50) - 25, z = S.h(x, y) + ((time * 0.8 + ph) % 8); A.sprite(x + Math.sin(time + ph), y, z, 0.07, 0.5, 0.12, 0.08); }
  // objective beacon
  const tp = objective && !dlg.active ? targetPos(objective.target) : null;
  if (tp && !fight) { const z = S.ground(tp[0], tp[1]); for (let i = 0; i < 14; i++) A.sprite(tp[0], tp[1], z + i * 1.2, 0.9 - i * 0.04, 0.16 * (1 - i / 16), 0.12 * (1 - i / 16), 0.04); }
  perf.t3 = performance.now();
  const oD = 6; dyn.append(D); const oSH = dyn.n; dyn.append(SH); const oA = dyn.n; dyn.append(A);
  perf.t4 = performance.now(); space.setDynamic(dyn.pos, dyn.col, dyn.n); perf.t5 = performance.now();
  perf.s = [perf.t1 - perf.t0, perf.t2 - perf.t1, perf.t3 - perf.t2, perf.t4 - perf.t3, perf.t5 - perf.t4].map((v) => +v.toFixed(2));
  return { oD, nD: oSH - oD, oSH, nSH: oA - oSH, oA, nA: dyn.n - oA };
}
const charDraws = [], charBufs = {};
function drawCharacters() {
  for (const c of charDraws) {
    let b = charBufs[c.id];
    if (!b) { const M = charMesh(c.id).m; b = charBufs[c.id] = { ...upload(M.pos.subarray(0, M.n * 4), M.col.subarray(0, M.n * 4)), n: M.n }; }
    gl.uniform4fv(U.uBone, c.B); gl.uniform1f(U.uHit, c.hit);
    space.bindBuf(b.pb, b.cb); space.draw(0, b.n);
  }
  gl.uniform1f(U.uHit, 0);
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [], c = cam.t, night = env.cur.ambT[0] < 0.2 ? 1 : env.cur.ambT[0] < 0.3 ? 0.6 : 0.25;
  if (P.tip) L.push({ p: P.tip, c: [1, 0.68, 0.3], k: 1.2 + night * 2.2, d: -1 });
  for (const id in inter) { const it = inter[id], p = it.p; if (!p || !lit[id] || !p.flame) continue; L.push({ p: p.flame, c: p.t === "lanternTower" ? [1, 0.75, 0.4] : [1, 0.6, 0.25], k: p.t === "lanternTower" ? 8 : p.t === "lamp" ? 2.5 : 4, d: Math.hypot(p.flame[0] - c[0], p.flame[1] - c[1]) }); }
  for (const p of S.props) if (p.flame && ((p.t === "lamp" && p.lit) || (p.t === "brazier" && p.dark))) L.push({ p: p.flame, c: p.dark ? [0.8, 0.25, 1] : [1, 0.6, 0.25], k: 3, d: Math.hypot(p.flame[0] - c[0], p.flame[1] - c[1]) + 2 });
  for (const q of tileLights) L.push({ p: q, c: [1, 0.62, 0.3], k: 1.6, d: Math.hypot(q[0] - c[0], q[1] - c[1]) + 6 });
  for (const e of enemies) if (e.kind === "vesper" && !e.dead) L.push({ p: [e.x, e.y, e.z + 2.5], c: [0.7, 0.2, 1], k: 5, d: 0 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
function render(dt) {
  updateCamera(dt);
  const tb0 = performance.now(); const o = buildDynamic(); perf.b = perf.b * 0.95 + (performance.now() - tb0) * 0.05; perf.n = dyn.n; const nL = collectLights(), E = env.cur;
  post.begin();
  gl.useProgram(U.program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadeTex); gl.uniform1i(U.uShade, 0);
  gl.uniform4f(U.uShadeRect, -HALF, -HALF, 1 / (2 * HALF), 1 / (2 * HALF));
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform1f(U.uHit, 0);
  gl.uniform3fv(U.uSun, E.sun); gl.uniform3fv(U.uSunCol, E.sunCol); gl.uniform3fv(U.uAmbT, E.ambT); gl.uniform3fv(U.uAmbB, E.ambB);
  gl.uniform3fv(U.uSkyTop, E.skyTop); gl.uniform3fv(U.uSkyHor, E.skyHor); gl.uniform3fv(U.uGlow, E.glow); gl.uniform4f(U.uMisc, E.fog, E.moon, E.stars, E.eclipse); gl.uniform1f(U.uBolt, env.bolt);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  const focus = Math.hypot(cam.e[0] - cam.t[0], cam.e[1] - cam.t[1], cam.e[2] - cam.t[2]);
  gl.uniform3f(U.uDof, focus, 0.4, 0.8);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  const cx = cam.t[0], cy = cam.t[1];
  const vis = tiles.filter((t) => t && Math.hypot(t.cx - cx, t.cy - cy) < 150);
  for (const t of vis) { space.bindBuf(t.pb, t.cb); space.draw(...t.O); if (Math.hypot(t.cx - cx, t.cy - cy) < 52) space.draw(...t.G); space.draw(...t.W); }
  if (far) { space.bindBuf(far.pb, far.cb); space.draw(...far.O); }
  space.bind(true); space.draw(o.oD, o.nD);
  drawCharacters(); space.bind(true);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.draw(o.oSH, o.nSH);
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
  for (const t of vis) { space.bindBuf(t.pb, t.cb); space.draw(...t.A); }
  if (far) { space.bindBuf(far.pb, far.cb); space.draw(...far.A); }
  space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  const xp = -E.sun[0] * space.xUnitVec[0] - E.sun[1] * space.xUnitVec[1] - E.sun[2] * space.xUnitVec[2], yp = E.sun[0] * space.yUnitVec[0] + E.sun[1] * space.yUnitVec[1] + E.sun[2] * space.yUnitVec[2], zp = E.sun[0] * space.zUnitVec[0] + E.sun[1] * space.zUnitVec[1] + E.sun[2] * space.zUnitVec[2];
  const k = space.magnifier / 1.6, asp = canvas.width / canvas.height; let sunUV = [0.5, 1.6], sunK = 0;
  if (zp > 0.05) { sunUV = [(xp * k / zp) * 0.5 + 0.5, (yp * k * asp / zp) * 0.5 + 0.5]; sunK = 0.55 * clamp((1.1 - Math.max(Math.abs(sunUV[0] - 0.5), Math.abs(sunUV[1] - 0.5))) / 0.5, 0, 1) * (E.moon ? 0.5 : 1); }
  post.end({ time, fade: fadeK, flash, sunUV, sunK, maxR: canvas.height * 0.012, skyCoc: 0.5 });
}

// ------------------------------------------------------------------ HUD
function projectToScreen(p) {
  const v = [p[0] - space.Xc, p[1] - space.Yc, p[2] - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
  if (zp < 0.1) return null;
  const k = space.magnifier / 1.6, asp = innerWidth / innerHeight;
  return [(xp * k / zp * 0.5 + 0.5) * innerWidth, (1 - (yp * k * asp / zp * 0.5 + 0.5)) * innerHeight];
}
function stepHud(dt) {
  $("hp").firstElementChild.style.width = (P.hp / P.max) * 100 + "%";
  $("lt").firstElementChild.style.width = P.light + "%"; $("lt").style.opacity = P.sunstaff ? 1 : 0.25;
  $("pot").innerHTML = `Potions <b>${P.potions}</b> · <span style="opacity:.7">H</span>`;
  const tp = objective ? targetPos(objective.target) : null;
  $("compass").style.opacity = tp && !dlg.active ? 1 : 0;
  if (tp) { const a = Math.atan2(tp[1] - P.y, tp[0] - P.x), rel = dAng(cam.yaw, a); $("compass-i").style.transform = `rotate(${-rel}rad)`; $("obj-d").textContent = `${Math.round(dist2(tp, [P.x, P.y]))} m`; } else $("obj-d").textContent = "";
  $("obj").style.opacity = dlg.active ? 0 : 1;
  for (let i = barks.length - 1; i >= 0; i--) { const b = barks[i]; b.life -= dt; const s = projectToScreen([b.ch.x, b.ch.y, b.ch.z + 2.1 * (b.ch.spec.scale || 1)]); if (s) { b.el.style.left = s[0] + "px"; b.el.style.top = s[1] + "px"; } b.el.style.opacity = Math.min(1, b.life * 2); if (b.life <= 0) { b.el.remove(); barks.splice(i, 1); } }
  for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; n.life -= dt; const s = projectToScreen(n.p); if (s) { n.el.style.left = s[0] + "px"; n.el.style.top = s[1] + "px"; } if (n.life <= 0) { n.el.remove(); nums.splice(i, 1); } }
}

// ------------------------------------------------------------------ main update
function moodFor() { return S.env === "sunset" ? "village" : S.env === "dusk" ? "woods" : S.env === "night" ? "night" : env.cur.eclipse > 0.5 ? "spire" : "dawn"; }
function update(dt) {
  time += dt;
  stepEnv(dt);
  if (state === "paused" || state === "loading") { input.pressed.clear(); return; }
  if (hitStop > 0) { hitStop -= dt; dt *= 0.15; }
  if (state === "play") { if (bot) stepBot(dt); stepDialogue(dt); stepInteract(); stepWaiters(); }
  stepPlayer(dt); stepChar(P.ch, dt);
  stepNpcs(dt);
  if (state === "play" && !dlg.active) stepCombat(dt);
  for (const q of parts) { q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt; if (q.g) q.v[2] -= q.g * dt; if (q.drag) { q.v[0] *= Math.exp(-q.drag * dt); q.v[1] *= Math.exp(-q.drag * dt); } q.life -= dt; }
  parts = parts.filter((q) => q.life > 0).slice(-900);
  for (const r of rings) { r.r += (r.max - r.r) * dt * 9; r.life -= dt; } rings.splice(0, rings.length, ...rings.filter((r) => r.life > 0));
  for (const m of motes) { m.t += dt; const dx = P.x - m.x, dy = P.y - m.y, dz = P.z + 1.2 - m.z, d = Math.hypot(dx, dy, dz) || 1, s = Math.min(d, (2 + m.t * 10) * dt); m.x += dx / d * s; m.y += dy / d * s; m.z += dz / d * s; if (d < 0.4) m.t = -1; } motes.splice(0, motes.length, ...motes.filter((m) => m.t >= 0));
  shake = Math.max(0, shake - dt * 2.2); flash = Math.max(0, flash - dt * 1.4);
  if (state === "play") stepHud(dt);
  input.pressed.clear();
}

// ------------------------------------------------------------------ flow: title, chapters, pause
async function startChapter(ch, cp) {
  runToken++; state = "loading"; chIdx = ch;
  $("loading").classList.remove("out"); $("ld-k").textContent = `CHAPTER ${CHAPTERS[ch].n}`; $("ld-t").textContent = CHAPTERS[ch].title; $("ld-bar").style.width = "0";
  $("hud").classList.add("hidden"); $("title").classList.add("hidden"); $("credits").classList.add("hidden");
  let start = null;
  await loadWorld(ch, (M) => (start = cp > 0 && save.pos && save.ch === ch ? save.pos : M.spots.start));
  resetRun(); registerInteractables();
  flags = cp > 0 || ch > 0 ? { ...save.flags } : {};
  P.hp = P.max; P.light = 100; P.dead = false; P.ch.act = null;
  P.sunstaff = ch > 0; P.potions = ch > 0 || cp > 0 ? Math.max(save.potions, ch > 0 ? 3 : 0) : 0;
  placePlayer(start, Math.PI / 2);
  audio.setMood(moodFor()); audio.setAmb(S.env === "sunset" ? "day" : S.env === "night" ? "river" : S.env === "eclipse" ? "spire" : "dusk");
  $("loading").classList.add("out"); $("hud").classList.remove("hidden"); $("pf-mira").innerHTML = portrait("mira");
  state = "play"; fadeK = 0;
  const tok = runToken;
  G = makeG(ch, cp);
  CHAPTERS[ch].run(G).catch((e) => console.error("Lanternfall story error", e)).then(() => void tok);
}
async function toTitle() {
  runToken++; state = "loading";
  for (const m of ["m-pause", "m-set", "m-chap"]) $(m).classList.add("hidden");
  $("credits").classList.add("hidden"); $("hud").classList.add("hidden"); $("dlg").classList.add("hidden");
  $("loading").classList.remove("out"); $("ld-k").textContent = "LANTERNFALL"; $("ld-t").textContent = "Kindling the lanterns…";
  await loadWorld(0, () => [0, 0]);
  resetRun(); registerInteractables();
  for (const id of ["lamp1", "lamp2", "lamp3", "last"]) lit[id] = true;
  for (const [id, key] of [["bram", "bram"], ["sela", "sela"], ["hob", "hob"], ["lila", "lila"], ["rook", "rook"]]) spawnNpc(id, key, S.spots[key], Math.random() * TAU);
  placePlayer([2, 4], 1); P.sunstaff = true;
  state = "title"; audio.setMood("village"); audio.setAmb("day");
  $("loading").classList.add("out"); $("title").classList.remove("hidden");
  $("b-continue").classList.toggle("hidden", !save.started);
  $("b-continue").textContent = save.started ? `Continue — Chapter ${CHAPTERS[save.ch].n}` : "Continue";
}
function pause() { state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); state = "play"; }
$("b-new").onclick = () => { audio.init(); Object.assign(save, { ch: 0, cp: 0, flags: {}, pos: null, potions: 0, sunstaff: false, started: true }); persist(); startChapter(0, 0); };
$("b-continue").onclick = () => { audio.init(); startChapter(save.ch, save.cp); };
$("b-chapters").onclick = () => { $("chap-list").innerHTML = CHAPTERS.map((c, i) => `<button data-i="${i}" ${i > save.unlocked ? "disabled" : ""}><b>CHAPTER ${c.n}</b><span>${c.title}</span><i>${c.sub}</i></button>`).join(""); $("chap-list").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("m-chap").classList.add("hidden"); audio.init(); save.flags = save.flags || {}; startChapter(+b.dataset.i, 0); })); $("m-chap").classList.remove("hidden"); };
$("chap-close").onclick = () => $("m-chap").classList.add("hidden");
$("b-pause").onclick = pause; $("p-resume").onclick = resume; $("p-title").onclick = toTitle;
$("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); startChapter(save.ch === chIdx ? chIdx : chIdx, save.ch === chIdx ? save.cp : 0); };
$("cr-done").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("b-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };

window.__foes = () => enemies.map((e) => ({ k: e.kind, x: +e.x.toFixed(1), y: +e.y.toFixed(1), z: +e.z.toFixed(1), hp: e.hp, dead: e.dead, st: e.state, stuck: +(e.stuckT || 0).toFixed(1), blk: walk.blocked(e.x, e.y) }));
window.__rpg = () => ({ state, ch: chIdx, hp: Math.round(P.hp), light: Math.round(P.light), x: +P.x.toFixed(1), y: +P.y.toFixed(1), obj: objective?.text || "", foes: enemies.filter((e) => !e.dead).length, dlg: dlg.active ? dlg.lines[dlg.i]?.t?.slice(0, 40) : "", fps, tiles: tilesLoaded, cp: save.cp, flags });
const perf = { u: 0, r: 0, b: 0, n: 0 }; window.__perf = perf;
let last = performance.now(), fps = 0, fN = 0, fT = 0, slow = 0;
function adapt() { if (state !== "play" && state !== "title") return; if (fps < 45 && pxCap > 0.6e6) { if (++slow >= 3) { pxCap *= 0.75; slow = 0; sizeCanvas(); } } else if (fps > 58 && pxCap < 2.0e6) { if (--slow <= -8) { pxCap = Math.min(2.0e6, pxCap * 1.15); slow = 0; sizeCanvas(); } } else slow = 0; }
function frameLoop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; adapt(); }
  fadeK = Math.min(1, fadeK + dt * 0.8);
  const t0 = performance.now();
  try { update(dt); } catch (e) { if (!frameLoop.err) { frameLoop.err = 1; console.error("Lanternfall update error", e); } }
  const t1 = performance.now();
  try { if (S && state !== "loading") render(dt); } catch (e) { if (!frameLoop.rerr) { frameLoop.rerr = 1; console.error("Lanternfall render error", e); } }
  const t2 = performance.now(); perf.u = perf.u * 0.95 + (t1 - t0) * 0.05; perf.r = perf.r * 0.95 + (t2 - t1) * 0.05;
  requestAnimationFrame(frameLoop);
}
// boot: the world worker starts first; shaders link meanwhile (the D3D backend can take seconds)
{
  const first = Q.has("ch") ? +Q.get("ch") - 1 : bot ? 0 : -1;
  if (first >= 0) { Object.assign(save, { ch: first, cp: Q.has("cp") ? +Q.get("cp") : 0, started: true }); startChapter(first, save.cp); } else toTitle();
  U = createProgram(gl, space); post = new Post(gl, space.posId); sizeCanvas(); addEventListener("resize", sizeCanvas);
  requestAnimationFrame(frameLoop);
}
