// PRISM GARDEN — a light-routing puzzle on floating night-garden islands. Rendered with the projection3d library
// (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md. logic.js traces beams, levels.js holds the 24
// solver-verified islands, scene.js builds the island and pieces; this file runs play, input, camera and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp } from "./mesh.js";
import { LEVELS } from "./levels.js";
import { makeBoard, trace, solved, targetState, mutable, rotate, key, COL, COL_RGB, COL_NAME } from "./logic.js";
import { buildIsland, buildBackdrop, drawPiece, toWorld, BEAM_Z } from "./scene.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
const DEF = { stars: {}, best: {}, unlocked: 0, volume: 0.8, music: 0.6 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("prismgarden.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("prismgarden.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static: backdrop + the current island
const backdrop = new Mesh(40000), backA = new Mesh(400);
buildBackdrop(backdrop, backA);
const seg = {};
function setIsland(lv, seed) {
  const O = new Mesh(80000), A = new Mesh(4000), W = new Mesh(2000), stat = new Mesh(140000);
  if (lv) buildIsland(O, A, W, lv, seed);
  for (const [k, m] of [["O", O], ["B", backdrop], ["W", W], ["A", A], ["BA", backA]]) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ level state
const G = { state: "loading", li: 0, lv: null, board: null, tr: null, moves: 0, undo: [], anim: new Map(), inv: { mirror: 0, split: 0 }, sel: null, hover: null, winT: 0, hintKey: null, hintT: 0, flies: [], lift: 0 };
let time = 0;
function startLevel(i) {
  G.li = i; const lv = (G.lv = LEVELS[i]);
  G.board = makeBoard(lv); G.moves = 0; G.undo = []; G.anim = new Map(); G.inv = { mirror: 0, split: 0, ...(lv.inv || {}) }; G.placed = [];
  for (const p of G.board.at.values()) G.anim.set(p, { a: targetAngle(p), bloom: 0, wrong: 0 });
  setIsland(lv, i * 13 + 5);
  retrace(true);
  G.state = "play"; G.winT = 0; G.lift = -6; G.flies = [];
  cam.dist = Math.max(lv.w, lv.h) * 1.25 + 4; cam.yaw = -0.5; cam.pitch = 0.9;
  ui.show("hud"); ui.hud(); ui.inv();
  $("h-name").textContent = lv.name; $("h-grove").textContent = `${lv.grove.toUpperCase()} · ${i + 1} / ${LEVELS.length}`;
  audio.rise();
}
function targetAngle(p) { return p.t === "emit" ? (p.d * Math.PI) / 2 : p.r === 0 ? Math.PI / 4 : -Math.PI / 4; }
function retrace(silent) {
  const before = G.tr ? targetState(G.board, G.tr).filter((t) => t.ok).length : 0;
  G.tr = trace(G.board);
  const ts = targetState(G.board, G.tr), now = ts.filter((t) => t.ok).length;
  if (!silent && now > before) audio.bloom(now);
  if (solved(G.board, G.tr) && G.state === "play") win();
  ui.hud();
}
function act(p) {
  if (G.state !== "play" || !mutable(p)) return;
  G.undo.push({ kind: "rot", p, r: p.r, d: p.d });
  rotate(p); G.moves++; audio.chime(p.t === "emit" ? 0 : p.r);
  retrace();
}
function place(x, y, kind) {
  if (G.state !== "play" || G.inv[kind] <= 0) return false;
  const k = key(x, y), vs = G.board.voids;
  if (x < 0 || y < 0 || x >= G.lv.w || y >= G.lv.h || vs.has(k) || G.board.at.has(k)) return false;
  const p = { t: kind, x, y, r: 0, placed: true };
  G.board.at.set(k, p); G.anim.set(p, { a: targetAngle(p), bloom: 0, wrong: 0, drop: 1 });
  G.inv[kind]--; G.moves++; G.undo.push({ kind: "place", p }); audio.place(); ui.inv(); retrace(); return true;
}
function unplace(p) { G.board.at.delete(key(p.x, p.y)); G.inv[p.t]++; ui.inv(); }
function undo() {
  const u = G.undo.pop(); if (!u || G.state !== "play") return;
  if (u.kind === "rot") { u.p.r = u.r; u.p.d = u.d; } else unplace(u.p);
  G.moves = Math.max(0, G.moves - 1); audio.click(); retrace(true);
}
function reset() { if (G.state === "play") { audio.click(); startLevel(G.li); } }
function hint() {
  if (G.state !== "play") return;
  const sol = G.lv.sol;
  for (const s of sol.set) { const p = G.board.at.get(key(s.x, s.y)); if (!p) continue; const want = s.r ?? s.d, have = s.r !== undefined ? p.r : p.d; if (want !== have) { G.hintKey = key(s.x, s.y); G.hintT = 3; audio.click(); return; } }
  for (const q of sol.place) { const p = G.board.at.get(key(q.x, q.y)); if (!p || p.t !== q.t) { G.hintKey = key(q.x, q.y); G.hintT = 3; G.hintPlace = q.t; audio.click(); return; } if (p.r !== q.r) { G.hintKey = key(q.x, q.y); G.hintT = 3; return; } }
  toast("Your pieces match a solution — check placed pieces' angles");
}
function win() {
  G.state = "win"; G.winT = 0;
  const lv = G.lv, stars = G.moves <= lv.par ? 3 : G.moves <= lv.par + 3 ? 2 : 1;
  save.stars[G.li] = Math.max(save.stars[G.li] || 0, stars); save.best[G.li] = Math.min(save.best[G.li] ?? 999, G.moves);
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length - 1, G.li + 1)); persist();
  for (let i = 0; i < 90; i++) G.flies.push({ x: (Math.random() - 0.5) * lv.w, y: (Math.random() - 0.5) * lv.h, z: Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, vz: 0.3 + Math.random() * 0.8, ph: Math.random() * TAU, life: 4 + Math.random() * 3 });
  audio.win();
  setTimeout(() => {
    $("w-k").textContent = G.li + 1 >= LEVELS.length ? "The last garden blooms" : "Island in bloom"; $("w-t").textContent = lv.name;
    $("w-moves").textContent = `${G.moves} moves · par ${lv.par}`;
    for (let i = 0; i < 3; i++) $("s" + i).classList.toggle("on", false);
    $("w-next").classList.toggle("hidden", G.li + 1 >= LEVELS.length);
    $("m-win").classList.remove("hidden");
    for (let i = 0; i < stars; i++) setTimeout(() => { $("s" + i).classList.add("on"); audio.star(i); }, 300 + i * 350);
    if (bot) setTimeout(() => { $("m-win").classList.add("hidden"); if (G.li + 1 < LEVELS.length) startLevel(G.li + 1); }, 1800);
  }, 1600);
}

// ------------------------------------------------------------------ input: tap to rotate, drag to orbit, drag from tray to place
const input = { down: null, drag: null };
function pickCell(cx, cy) {
  const mag = space.magnifier, aspect = canvas.width / canvas.height, nx = (cx / innerWidth) * 2 - 1, ny = 1 - (cy / innerHeight) * 2;
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const d = nrm([0, 1, 2].map((i) => Z[i] - X[i] * nx * (1.6 / mag) + Y[i] * ny * (1.6 / (mag * aspect))));
  const E = [space.Xc, space.Yc, space.Zc];
  // test pieces first (their bodies stand up to ~1 m), then the floor
  let best = null, bd = 1e9;
  for (const p of G.board.at.values()) {
    const [wx, wy] = toWorld(G.lv, p.x, p.y), c = [wx, wy, 0.5];
    const v = sub(c, E), t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; if (t < 0) continue;
    const q = [E[0] + d[0] * t - c[0], E[1] + d[1] * t - c[1], E[2] + d[2] * t - c[2]], dist = Math.hypot(q[0], q[1], q[2] * 0.6);
    if (dist < 0.48 && t < bd) { bd = t; best = p; }
  }
  const t = (0 - E[2]) / d[2], fx = E[0] + d[0] * t, fy = E[1] + d[1] * t;
  const cell = { x: Math.round(fx + (G.lv.w - 1) / 2), y: Math.round(fy + (G.lv.h - 1) / 2) };
  return { piece: best, cell };
}
canvas.addEventListener("pointerdown", (e) => { audio.init(); input.down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0, yaw: cam.yaw, pitch: cam.pitch }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (G.lv && G.state === "play") { const h = pickCell(e.clientX, e.clientY); G.hover = h.piece && mutable(h.piece) ? h.piece : null; canvas.style.cursor = G.hover ? "pointer" : "grab"; }
  const d = input.down; if (!d || d.id !== e.pointerId) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y; d.moved = Math.max(d.moved, Math.hypot(dx, dy));
  if (d.moved > 8) { cam.yaw = d.yaw - dx * 0.006; cam.pitch = clamp(d.pitch + dy * 0.004, 0.35, 1.35); }
});
canvas.addEventListener("pointerup", (e) => {
  const d = input.down; input.down = null; if (!d || d.moved > 8 || G.state !== "play") return;
  const h = pickCell(e.clientX, e.clientY);
  if (h.piece) { if (mutable(h.piece)) act(h.piece); else if (h.piece.placed) act(h.piece); else { audio.thunk(); } }
  else if (input.armed && place(h.cell.x, h.cell.y, input.armed)) { if (G.inv[input.armed] <= 0) input.armed = null; ui.inv(); }
});
canvas.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 5, 30); e.preventDefault(); }, { passive: false });
// placed pieces are mutable (they rotate); long-press/right-click returns them to the tray
canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); if (G.state !== "play") return; const h = pickCell(e.clientX, e.clientY); if (h.piece && h.piece.placed) { unplace(h.piece); G.moves++; retrace(); audio.click(); } });
addEventListener("keydown", (e) => {
  audio.init();
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" || e.code === "KeyU") undo();
  if (e.code === "KeyR" && !e.ctrlKey) reset();
  if (e.code === "KeyH") hint();
  if (e.code === "Escape") { if (G.state === "play") pause(); else if (G.state === "paused") resume(); }
  if (e.code === "ArrowLeft") cam.yaw += 0.15; if (e.code === "ArrowRight") cam.yaw -= 0.15;
});
$("b-undo").onclick = undo; $("b-reset").onclick = reset; $("b-hint").onclick = hint;
$("tray").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || G.inv[b.dataset.k] <= 0) return; input.armed = input.armed === b.dataset.k ? null : b.dataset.k; audio.click(); ui.inv(); });

// ------------------------------------------------------------------ update
function update(dt) {
  time += dt;
  if (G.lv && (G.state === "play" || G.state === "win" || G.state === "paused")) {
    G.lift = lerp(G.lift, G.state === "win" && G.winT > 2.6 ? 8 : 0, Math.min(1, dt * (G.state === "win" ? 0.8 : 2.2)));
    const ts = targetState(G.board, G.tr);
    for (const p of G.board.at.values()) {
      const an = G.anim.get(p); if (!an) continue;
      let d = targetAngle(p) - an.a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      an.a += d * Math.min(1, dt * 12);
      if (an.drop) an.drop = Math.max(0, an.drop - dt * 4);
    }
    for (const t of ts) { const an = G.anim.get(t.p); an.bloom = lerp(an.bloom, t.ok ? 1 : 0, Math.min(1, dt * 3)); an.wrong = lerp(an.wrong, t.wrong ? 1 : 0, Math.min(1, dt * 6)); }
    if (G.state === "win") G.winT += dt;
    G.hintT = Math.max(0, G.hintT - dt);
    if (bot && G.state === "play") botStep(dt);
  } else if (G.state === "title") { cam.yaw = time * 0.05; }
  for (const f of G.flies) { f.x += (f.vx + Math.sin(time * 2 + f.ph) * 0.2) * dt; f.y += (f.vy + Math.cos(time * 1.7 + f.ph) * 0.2) * dt; f.z += f.vz * dt; f.life -= dt; }
  G.flies = G.flies.filter((f) => f.life > 0);
  audio.hum(G.tr ? G.tr.segs.length : 0);
}

// ------------------------------------------------------------------ solver bot (?auto)
const bot = Q.has("auto") ? { t: 0.6 } : null;
function botStep(dt) {
  bot.t -= dt; if (bot.t > 0) return; bot.t = 0.45;
  const sol = G.lv.sol;
  for (const q of sol.place) { const p = G.board.at.get(key(q.x, q.y)); if (!p) { place(q.x, q.y, q.t); return; } if (p.r !== q.r) { act(p); return; } }
  for (const s of sol.set) { const p = G.board.at.get(key(s.x, s.y)); if (!p) continue; const want = s.r ?? s.d, have = s.r !== undefined ? p.r : p.d; if (want !== have) { act(p); return; } }
}

// ------------------------------------------------------------------ camera
const cam = { yaw: -0.5, pitch: 0.9, dist: 12, E: [0, -10, 8], T: [0, 0, 0] };
function updateCamera(dt) {
  const T = [0, 0, (G.lift || 0) + 0.2];
  const c = Math.cos(cam.pitch), E = [T[0] + Math.sin(cam.yaw) * c * cam.dist, T[1] - Math.cos(cam.yaw) * c * cam.dist, T[2] + Math.sin(cam.pitch) * cam.dist];
  const k = Math.min(1, dt * 6);
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k));
  space.magnifier = 1.75 * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(80000), A = new Mesh(40000), Gl = new Mesh(6000), Wd = new Mesh(2000), dyn = new Mesh(160000);
function ribbon(p0, p1, w, col) {
  const E = cam.E, d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v));
  A.quad([p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w], [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w], col, MAT.ADD);
}
function buildDynamic() {
  D.reset(); A.reset(); Gl.reset(); Wd.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  if (G.lv) {
    const lv = G.lv, lift = G.lift || 0, ctx = { glass: [], water: [] };
    const base = D.n, baseA = A.n;
    for (const p of G.board.at.values()) {
      const an = G.anim.get(p) || { a: 0, bloom: 0, wrong: 0 };
      an.hover = G.hover === p;
      drawPiece(D, ctx, A, lv, p, an, time);
      if (G.hintT > 0 && G.hintKey === key(p.x, p.y)) { const [wx, wy] = toWorld(lv, p.x, p.y), k = 0.5 + 0.5 * Math.sin(time * 8); for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; A.sprite(wx + Math.cos(a) * 0.5, wy + Math.sin(a) * 0.5, 0.05, 0.06, k, k * 0.9, k * 0.4); } }
    }
    if (G.hintT > 0 && G.hintPlace && G.hintKey && !G.board.at.has(G.hintKey)) { const [hx, hy] = G.hintKey.split(",").map(Number), [wx, wy] = toWorld(lv, hx, hy), k = 0.5 + 0.5 * Math.sin(time * 8); for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; A.sprite(wx + Math.cos(a) * 0.5, wy + Math.sin(a) * 0.5, 0.05, 0.06, k, k * 0.9, k * 0.4); } }
    for (const [a, b, c, col] of ctx.glass) Gl.tri(a, b, c, col, MAT.GLASS);
    for (const [x, y] of ctx.water) { const N = 12; for (let k = 0; k < N; k++) { const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU; Wd.tri([x, y, 0.09], [x + Math.cos(a0) * 0.4, y + Math.sin(a0) * 0.4, 0.09], [x + Math.cos(a1) * 0.4, y + Math.sin(a1) * 0.4, 0.09], [0.1, 0.15, 0.25], MAT.WATER); } }
    // armed placement ghost
    if (input.armed && G.hoverCell) { const [wx, wy] = toWorld(lv, G.hoverCell.x, G.hoverCell.y); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + time; A.sprite(wx + Math.cos(a) * 0.42, wy + Math.sin(a) * 0.42, 0.04, 0.05, 0.3, 0.6, 1); } }
    // beams
    for (const s of G.tr.segs) {
      const [ax, ay] = toWorld(lv, s.ax, s.ay), [bx, by] = toWorld(lv, s.bx, s.by), c = COL_RGB[s.c];
      const p0 = [ax, ay, BEAM_Z], p1 = [bx, by, BEAM_Z], L = Math.hypot(bx - ax, by - ay);
      ribbon(p0, p1, 0.022, [0.9 + c[0] * 0.6, 0.9 + c[1] * 0.6, 0.9 + c[2] * 0.6]);
      ribbon(p0, p1, 0.09, c.map((v) => v * 0.32));
      ribbon(p0, p1, 0.25, c.map((v) => v * 0.07));
      // a pool of light on the tiles under the beam and motes running along it
      const n = Math.max(1, Math.round(L * 2));
      for (let i = 0; i <= n; i++) { const t = i / n; A.sprite(ax + (bx - ax) * t, ay + (by - ay) * t, 0.02, 0.32, c[0] * 0.05, c[1] * 0.05, c[2] * 0.05); }
      for (let i = 0; i < Math.ceil(L * 1.5); i++) { const t = ((time * 0.9 + i / Math.max(1, L * 1.5) + s.ax * 0.13) % 1); A.sprite(ax + (bx - ax) * t, ay + (by - ay) * t, BEAM_Z + Math.sin(time * 5 + i) * 0.03, 0.035, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9); }
    }
    for (const f of G.tr.flares) { const [fx, fy] = toWorld(lv, f.x, f.y), c = COL_RGB[f.c]; A.sprite(fx, fy, BEAM_Z, f.kind === "block" ? 0.15 : 0.32, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7); }
    for (const f of G.flies) { const k = Math.min(1, f.life) * (0.5 + 0.5 * Math.sin(time * 9 + f.ph)); A.sprite(f.x, f.y, f.z, 0.05, 1 * k, 0.9 * k, 0.4 * k); }
    // lift the whole island (rising in / flying away)
    if (lift !== 0) { for (const M of [D, A, Gl, Wd]) for (let i = 0; i < M.n; i++) M.pos[i * 4 + 2] += lift; }
  }
  const oD = 6; dyn.append(D); const oW = dyn.n; dyn.append(Wd); const oA = dyn.n; dyn.append(A); const oG = dyn.n; dyn.append(Gl);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oW - oD, oW, nW: oA - oW, oA, nA: oG - oA, oG, nG: dyn.n - oG };
}

// ------------------------------------------------------------------ lights: crystals, blooming lotuses, beam bounces
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [];
  if (G.lv) {
    const lift = G.lift || 0;
    for (const p of G.board.at.values()) {
      const [x, y] = toWorld(G.lv, p.x, p.y);
      if (p.t === "emit") L.push({ p: [x, y, 1.3 + lift], c: COL_RGB[COL[p.c]], k: 1.4 });
      if (p.t === "target") { const an = G.anim.get(p); if (an && an.bloom > 0.05) L.push({ p: [x, y, 0.5 + lift], c: COL_RGB[COL[p.c]], k: 1.6 * an.bloom }); }
    }
    for (const f of G.tr.flares) if (f.kind !== "block") { const [x, y] = toWorld(G.lv, f.x, f.y); L.push({ p: [x, y, BEAM_Z + 0.2 + lift], c: COL_RGB[f.c], k: 0.7 }); }
  }
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
const MOON = nrm([-0.4, 0.75, 0.55]);
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform3fv(U.uMoonDir, MOON); gl.uniform1f(U.uWin, G.state === "win" ? 1 : 0);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { if (!seg[k]) return; space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  // the static island rides the lift too: it is drawn with a temporary camera offset
  const lift = G.lift || 0;
  if (lift !== 0) { space.lookAt(cam.E[0], cam.E[1], cam.E[2] - lift, cam.T[0], cam.T[1], cam.T[2] - lift); space.applyCamera(); }
  S("O"); S("W");
  if (lift !== 0) { space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]); space.applyCamera(); }
  S("B");
  space.bind(true); space.draw(o.oD, o.nD); space.draw(o.oW, o.nW);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  if (lift !== 0) { space.lookAt(cam.E[0], cam.E[1], cam.E[2] - lift, cam.T[0], cam.T[1], cam.T[2] - lift); space.applyCamera(); }
  S("A");
  if (lift !== 0) { space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]); space.applyCamera(); }
  S("BA");
  space.bind(true); space.draw(o.oG, o.nG); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: G.state === "win" ? Math.max(0, 0.5 - G.winT * 0.4) : 0 });
}

// ------------------------------------------------------------------ UI
let toastT = 0;
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.remove("show"), 2600); }
const ui = {
  show(w) { for (const id of ["title", "islands", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  hud() {
    if (!G.lv) return;
    $("h-moves").textContent = G.moves; $("h-par").textContent = G.lv.par;
    const ts = targetState(G.board, G.tr);
    $("legend").innerHTML = ts.map((t) => { const c = COL_RGB[COL[t.p.c]].map((v) => Math.round(Math.min(1, v) * 255)).join(","); return `<i class="${t.ok ? "ok" : t.wrong ? "bad" : ""}" style="--c:rgb(${c})" title="${COL_NAME[COL[t.p.c]]}"></i>`; }).join("");
  },
  inv() {
    const has = (G.inv.mirror || 0) + (G.inv.split || 0) > 0 || G.placed?.length;
    $("tray").classList.toggle("hidden", !((G.lv?.inv?.mirror || 0) + (G.lv?.inv?.split || 0)));
    $("tray").innerHTML = ["mirror", "split"].filter((k) => (G.lv?.inv?.[k] || 0) > 0).map((k) => `<button data-k="${k}" class="${input.armed === k ? "on" : ""} ${G.inv[k] <= 0 ? "dis" : ""}"><span class="ico ${k}"></span>${k === "mirror" ? "Mirror" : "Splitter"} × ${G.inv[k]}</button>`).join("") + `<small>${input.armed ? "tap an empty tile to place · right-click a placed piece to take it back" : "tap a piece, then an empty tile"}</small>`;
    void has;
  },
  islands() {
    $("grid").innerHTML = LEVELS.map((lv, i) => {
      const lock = i > save.unlocked, st = save.stars[i] || 0;
      return `${i % 6 === 0 ? `<div class="grove">${lv.grove}</div>` : ""}<button class="card" data-i="${i}" ${lock ? "disabled" : ""}><span class="num">${i + 1}</span><b>${lv.name}</b><span class="st">${[0, 1, 2].map((k) => (k < st ? "<i>★</i>" : "★")).join("")}</span>${lock ? '<span class="lock">🔒</span>' : ""}</button>`;
    }).join("");
    $("grid").querySelectorAll(".card").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); startLevel(+b.dataset.i); }));
  },
  title() { const n = Object.values(save.stars).reduce((a, b) => a + b, 0); $("t-foot").textContent = `★ ${n} / ${LEVELS.length * 3}  ·  tap pieces to turn them · drag to orbit · H hint · U undo`; },
};
canvas.addEventListener("pointermove", (e) => { if (input.armed && G.lv) G.hoverCell = pickCell(e.clientX, e.clientY).cell; });
function pause() { G.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = "play"; }
function toTitle() { for (const m of ["m-pause", "m-win", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; showcase(); ui.show("title"); ui.title(); }
function showcase() { const lv = LEVELS[12]; G.lv = lv; G.board = makeBoard(lv); for (const s of lv.sol.set) { const p = G.board.at.get(key(s.x, s.y)); if (p) { if (s.r !== undefined) p.r = s.r; if (s.d !== undefined) p.d = s.d; } } G.anim = new Map(); for (const p of G.board.at.values()) G.anim.set(p, { a: targetAngle(p), bloom: 1, wrong: 0 }); G.tr = trace(G.board); G.lift = 0; setIsland(lv, 3); cam.dist = 13; cam.pitch = 0.75; }
$("t-play").onclick = () => { audio.init(); audio.click(); startLevel(Math.min(save.unlocked, LEVELS.length - 1)); };
$("t-islands").onclick = () => { audio.init(); audio.click(); G.state = "islands"; ui.islands(); ui.show("islands"); };
$("i-back").onclick = () => { G.state = "title"; ui.show("title"); ui.title(); };
$("b-pause").onclick = pause; $("b-menu").onclick = () => { G.state = "islands"; ui.islands(); ui.show("islands"); };
$("p-resume").onclick = resume; $("p-title").onclick = toTitle;
$("w-next").onclick = () => { $("m-win").classList.add("hidden"); startLevel(G.li + 1); };
$("w-again").onclick = () => { $("m-win").classList.add("hidden"); startLevel(G.li); };
$("w-islands").onclick = () => { $("m-win").classList.add("hidden"); G.state = "islands"; ui.islands(); ui.show("islands"); };
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };

// ------------------------------------------------------------------ boot
window.__prism = () => ({ state: G.state, level: G.li + 1, moves: G.moves, par: G.lv?.par, solved: G.board ? solved(G.board) : false, targets: G.tr && G.board ? targetState(G.board, G.tr).map((t) => [t.p.c, t.got, t.ok]) : [], fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  if (G.state !== "paused") update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
showcase();
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); G.state = "title"; ui.show("title"); ui.title();
  if (Q.has("level")) startLevel(clamp(+Q.get("level") - 1, 0, LEVELS.length - 1)); else if (bot) startLevel(0);
}, 400);
