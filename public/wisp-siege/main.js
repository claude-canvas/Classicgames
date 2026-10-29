// WISP SIEGE — tower defense on a floating isle at night. Rendered with the projection3d library (Space, via
// GameSpace) + custom shaders + bloom. See DESIGN.md. game.js is the simulation; this file renders it, handles
// building/upgrading, the camera and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, tube, limb, blob } from "./mesh.js";
import { W, H, TOWER, ENEMY, WAVES, newGame, startNextWave, build, upgrade, sell, step, towerStats, upgradeCost, buildable, autoBuild, pathPos, PATH_LEN } from "./game.js";
import { buildIsland, tw, HEART } from "./scene.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const audio = new Audio();
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > 1.8e6) dpr *= Math.sqrt(1.8e6 / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
const DEF = { best: 0, wins: 0, volume: 0.8, music: 0.6 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("wispsiege.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("wispsiege.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// static island
const seg = {};
{ const O = new Mesh(120000), A = new Mesh(2000), stat = new Mesh(130000); buildIsland(O, A); seg.O = [0, O.n]; stat.append(O); seg.A = [stat.n, A.n]; stat.append(A); space.setStatic(stat.pos, stat.col, stat.n); }

// state
let g = newGame(), time = 0, state = "loading", speed = 1, sel = null, menu = null, demo = true, heartHit = 0;
const fx = { motes: [], rings: [] };
const bot = Q.has("auto");
function startGame(w = 0) { g = newGame(w); state = "play"; demo = false; speed = 1; sel = null; closeMenu(); ui.show("hud"); ui.hud(); }
function startDemo() { g = newGame(); demo = true; }

// ------------------------------------------------------------------ input
function pickTile(cx, cy) {
  const mag = space.magnifier, aspect = canvas.width / canvas.height, nx = (cx / innerWidth) * 2 - 1, ny = 1 - (cy / innerHeight) * 2;
  const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * (1.6 / mag) + Y[i] * ny * (1.6 / (mag * aspect)));
  const E = [space.Xc, space.Yc, space.Zc], t = -E[2] / (d[2] || -1e-6), wx = E[0] + d[0] * t, wy = E[1] + d[1] * t;
  return [Math.round(wx + W / 2 - 0.5), Math.round(wy + H / 2 - 0.5)];
}
function screenOf(p) {
  const v = sub(p, [space.Xc, space.Yc, space.Zc]), X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
  const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
  const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
  return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}
const drag = { d: null };
canvas.addEventListener("pointerdown", (e) => { audio.init(); drag.d = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: 0 }; });
addEventListener("pointermove", (e) => { const d = drag.d; if (!d) { if (state === "play") hover = pickTile(e.clientX, e.clientY); return; } d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y)); if (d.moved > 8) { cam.yaw = d.yaw - (e.clientX - d.x) * 0.005; cam.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.004, 0.5, 1.35); } });
addEventListener("pointerup", (e) => {
  const d = drag.d; drag.d = null; if (!d || d.moved > 8 || state !== "play" || e.target !== canvas) return;
  const [x, y] = pickTile(e.clientX, e.clientY);
  const t = g.towers.find((q) => q.x === x && q.y === y);
  if (t) { sel = t; closeMenu(); ui.panel(); audio.coin(); return; }
  sel = null; ui.panel();
  if (buildable(x, y)) openMenu(x, y); else closeMenu();
});
canvas.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 8, 24); e.preventDefault(); }, { passive: false });
let hover = null;
function openMenu(x, y) {
  menu = { x, y }; const m = $("menu");
  m.innerHTML = Object.entries(TOWER).map(([k, T]) => `<button data-k="${k}" class="${g.gold < T.cost ? "dis" : ""}"><i class="ico ${k}"></i><b>${T.name}</b><span>${T.cost}g</span></button>`).join("");
  m.classList.remove("hidden");
  m.querySelectorAll("button").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); if (build(g, b.dataset.k, menu.x, menu.y)) { audio.build(); sel = g.towers[g.towers.length - 1]; ui.panel(); } closeMenu(); ui.hud(); }));
  b_hover = null;
}
let b_hover = null;
function closeMenu() { menu = null; $("menu").classList.add("hidden"); }
addEventListener("keydown", (e) => {
  audio.init();
  if (e.code === "Space" && state === "play") { e.preventDefault(); nextWave(); }
  if (e.code === "KeyF") speed = speed === 1 ? 2 : 1;
  if (e.code === "Escape") { closeMenu(); sel = null; ui.panel(); }
  if (e.code === "KeyU" && sel) { upgrade(g, sel) && audio.build(); ui.panel(); }
});
function nextWave() { if (!g.waveActive && startNextWave(g)) { audio.horn(); ui.hud(); } }
$("b-wave").onclick = nextWave;
$("b-speed").onclick = () => { speed = speed === 1 ? 2 : 1; ui.hud(); };
$("p-up").onclick = () => { if (sel && upgrade(g, sel)) audio.build(); ui.panel(); ui.hud(); };
$("p-sell").onclick = () => { if (sel) { sell(g, sel); audio.coin(); sel = null; ui.panel(); ui.hud(); } };

// ------------------------------------------------------------------ update
function update(dt) {
  time += dt;
  if (state !== "play" && !demo) return;
  if (demo || bot) { autoBuild(g); if (!g.waveActive) startNextWave(g); }
  const n = speed === 2 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const ev = step(g, dt);
    for (const e of ev) {
      if (e.type === "kill") { const c = enemyCol(e.e.type); for (let i = 0; i < (e.e.type === "boss" ? 40 : 10); i++) { const a = Math.random() * TAU, v = 0.5 + Math.random() * 1.5; fx.motes.push({ x: e.e.x, y: e.e.y, z: 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.5 + Math.random() * 2, life: 0.8, c }); } if (!demo) audio.pop(); }
      if (e.type === "leak") { heartHit = 1; if (!demo) audio.leak(); }
      if (e.type === "boom") { fx.rings.push({ x: e.x, y: e.y, life: 0.4, c: [1, 0.6, 0.25] }); if (!demo) audio.boom(); }
      if (e.type === "fire" && !demo) audio.fire();
      if (e.type === "zap" && !demo) audio.zap();
      if (e.type === "chime") { fx.rings.push({ x: e.t.x - W / 2 + 0.5, y: e.t.y - H / 2 + 0.5, life: 0.6, c: [0.4, 0.7, 1], r: towerStats(e.t).range, world: true }); if (!demo) audio.chime(); }
      if (e.type === "cleared" && !demo) { audio.coin(); toast(`Wave cleared · +${e.bonus} gold`); }
      if (e.type === "wave" && !demo) banner(`WAVE ${e.n}`, WAVES[e.n - 1].map(([t, c]) => `${c} ${t}${c > 1 ? "s" : ""}`).join(" · "));
      if (e.type === "won") { if (demo) startDemo(); else end(true); }
      if (e.type === "lost") { if (demo) startDemo(); else end(false); }
    }
  }
  audio.hum(demo ? 0 : g.towers.filter((t) => t.type === "lamp" && t.target).length);
  for (const m of fx.motes) { m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt; m.vz -= 2 * dt; m.life -= dt; }
  fx.motes = fx.motes.filter((m) => m.life > 0); for (const r of fx.rings) r.life -= dt; fx.rings = fx.rings.filter((r) => r.life > 0);
  heartHit = Math.max(0, heartHit - dt * 1.5);
  if (!demo) ui.hud();
}
function end(win) {
  state = "over"; const waves = win ? WAVES.length : g.wave;
  save.best = Math.max(save.best, waves); if (win) save.wins++; persist();
  $("o-k").textContent = win ? "The Heart endures" : "The Heart has fallen"; $("o-t").textContent = win ? "Victory" : "Defeat";
  $("o-s").textContent = `${waves} / ${WAVES.length} waves · ${g.kills} shadows banished · ${g.lives} lives left`; $("o-b").textContent = `Best: ${save.best} waves`;
  $("m-over").classList.remove("hidden"); audio.fanfare(win);
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.95, dist: 14.5 };
function updateCamera() {
  const yaw = demo ? time * 0.06 : cam.yaw, c = Math.cos(cam.pitch);
  const E = [Math.sin(yaw) * c * cam.dist, -Math.cos(yaw) * c * cam.dist, Math.sin(cam.pitch) * cam.dist];
  space.magnifier = 1.7 * 1.6 * Math.min(1, innerWidth / innerHeight / 1.3 + 0.2);
  space.lookAt(E[0], E[1], E[2], 0, 0.3, 0);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(80000), A = new Mesh(40000), Gl = new Mesh(4000), dyn = new Mesh(140000);
const enemyCol = (t) => ({ wisp: [1, 0.55, 0.2], moth: [0.8, 0.9, 0.4], golem: [1, 0.35, 0.15], shade: [0.6, 0.4, 1], boss: [1, 0.2, 0.5] }[t]);
function ribbon(p0, p1, w, col) { const E = [space.Xc, space.Yc, space.Zc], d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v)); A.quad([p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w], [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w], col, MAT.ADD); }
function ring(x, y, z, r, w, col, n = 32) { for (let i = 0; i < n; i++) { const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU; A.quad([x + Math.cos(a0) * (r - w), y + Math.sin(a0) * (r - w), z], [x + Math.cos(a1) * (r - w), y + Math.sin(a1) * (r - w), z], [x + Math.cos(a1) * (r + w), y + Math.sin(a1) * (r + w), z], [x + Math.cos(a0) * (r + w), y + Math.sin(a0) * (r + w), z], col, MAT.ADD); } }
function drawTower(t) {
  const [x, y] = tw(t.x, t.y), L = t.level, stone = [0.5, 0.48, 0.55], brass = [0.85, 0.62, 0.3];
  tube(D, x, y, 8, 0.36, 0, 0.3, 0.18, stone, MAT.MATTE);
  for (let i = 1; i < L; i++) ring(x, y, 0.2 + i * 0.05, 0.33, 0.02, [0.6, 0.5, 0.2]);
  if (t.type === "lamp") {
    tube(D, x, y, 6, 0.06, 0.18, 0.05, 1.0 + L * 0.1, [0.2, 0.2, 0.22], MAT.GLOSS);
    const hz = 1.05 + L * 0.1; blob(D, [x, y, hz], 0.16, 0.16, 0.2, [1.6, 1.1, 0.5], MAT.EMIT, 8, 5); tube(D, x, y, 8, 0.2, hz + 0.15, 0, hz + 0.35, brass, MAT.GLOSS);
    A.sprite(x, y, hz, 0.7, 0.5, 0.32, 0.12);
    if (t.target) { const e = t.target, p0 = [x, y, hz], p1 = [e.x - W / 2 + 0.5, e.y - H / 2 + 0.5, 0.45]; ribbon(p0, p1, 0.04 + L * 0.01, [1.4, 1.0, 0.5]); ribbon(p0, p1, 0.14, [0.3, 0.2, 0.08]); A.sprite(...p1, 0.3, 0.8, 0.5, 0.2); }
  } else if (t.type === "mortar") {
    tube(D, x, y, 10, 0.3, 0.18, 0.26, 0.42, [0.42, 0.4, 0.45], MAT.MATTE);
    const a = t.aim, ex = x + Math.cos(a) * 0.15, ey = y + Math.sin(a) * 0.15; limb(D, [x, y, 0.42], [ex, ey, 0.8 + L * 0.05], 0.13 + L * 0.02, 0.11 + L * 0.02, [0.25, 0.24, 0.28], MAT.GLOSS, 10);
    blob(D, [ex, ey, 0.8 + L * 0.05], 0.09, 0.09, 0.04, [1.2, 0.5, 0.2], MAT.EMIT, 8, 3);
  } else if (t.type === "bell") {
    for (const s of [-1, 1]) limb(D, [x + s * 0.22, y, 0.18], [x + s * 0.22, y, 1.0], 0.04, 0.04, [0.4, 0.34, 0.3], MAT.MATTE, 5);
    limb(D, [x - 0.3, y, 1.0], [x + 0.3, y, 1.0], 0.05, 0.05, [0.4, 0.34, 0.3], MAT.MATTE, 5);
    const sw = Math.sin(time * 3) * 0.06; tube(D, x + sw, y, 12, 0.2 + L * 0.02, 0.5, 0.08, 0.92, [0.45, 0.65, 0.95], MAT.GLOSS);
    A.sprite(x, y, 0.6, 0.8, 0.12, 0.25, 0.5);
    ring(x, y, 0.04, towerStats(t).range, 0.03, [0.08, 0.15, 0.3], 48);
  } else {
    tube(D, x, y, 8, 0.14, 0.18, 0.08, 1.2 + L * 0.1, [0.7, 0.42, 0.25], MAT.GLOSS);
    for (let i = 0; i < 4 + L; i++) tube(D, x, y, 10, 0.22 - i * 0.025, 0.4 + i * 0.16, 0.22 - i * 0.025, 0.46 + i * 0.16, [0.8, 0.5, 0.3], MAT.GLOSS, 0, false);
    blob(D, [x, y, 1.3 + L * 0.1], 0.13, 0.13, 0.13, [1.0, 0.6, 1.6], MAT.EMIT, 8, 5); A.sprite(x, y, 1.3 + L * 0.1, 0.6, 0.35, 0.2, 0.55);
  }
  if (sel === t) ring(x, y, 0.05, towerStats(t).range, 0.03, [0.6, 0.55, 0.3], 64);
}
function drawEnemy(e) {
  const x = e.x - W / 2 + 0.5, y = e.y - H / 2 + 0.5, c = enemyCol(e.type), f = e.hitT > 0 ? 2 : 1, bob = Math.sin(time * 4 + e.ph) * 0.06;
  if (e.type === "wisp" || e.type === "moth") {
    const z = 0.45 + bob; blob(D, [x, y, z], e.size, e.size, e.size * 1.2, c.map((v) => v * 1.5 * f), MAT.EMIT, 8, 5); A.sprite(x, y, z, e.size * 3, c[0] * 0.35, c[1] * 0.35, c[2] * 0.35);
    if (e.type === "moth") { const fl = Math.sin(time * 30 + e.ph) * 0.15; for (const s of [-1, 1]) D.tri([x, y, z], [x + s * 0.3, y + 0.12, z + fl], [x + s * 0.28, y - 0.15, z - fl * 0.5], [0.6, 0.65, 0.4], MAT.MOSS); }
    else for (let i = 1; i < 5; i++) { const [px, py] = pathPos(e.s - i * 0.12); A.sprite(px - W / 2 + 0.5, py - H / 2 + 0.5, z, e.size * (1 - i * 0.18), c[0] * 0.2, c[1] * 0.15, c[2] * 0.1); }
  } else if (e.type === "golem" || e.type === "boss") {
    const s = e.size, step = Math.abs(Math.sin(time * 3 + e.ph)) * 0.05;
    blob(D, [x, y, s * 0.9 + step], s, s * 0.85, s * 0.9, [0.35, 0.3, 0.32].map((v) => v * f), MAT.MATTE, 8, 6, (i, j) => 0.85 + 0.3 * ((i * 7 + j * 3) % 5) / 5);
    blob(D, [x, y, s * 1.7 + step], s * 0.55, s * 0.5, s * 0.45, [0.3, 0.26, 0.28], MAT.MATTE, 7, 5);
    for (const sx of [-0.18, 0.18]) blob(D, [x + sx * s * 2, y - s * 0.4, s * 1.75 + step], s * 0.1, s * 0.1, s * 0.1, c.map((v) => v * 2), MAT.EMIT, 5, 3);
    A.sprite(x, y, s, s * 2.4, c[0] * 0.18, c[1] * 0.1, c[2] * 0.08);
  } else {
    const z = 0.55 + bob; blob(D, [x, y, z], e.size, e.size, e.size * 1.6, [0.08, 0.05, 0.12], MAT.MATTE, 8, 6); A.sprite(x, y, z, e.size * 3.5, c[0] * 0.25 * f, c[1] * 0.2 * f, c[2] * 0.35 * f); for (const sx of [-0.08, 0.08]) A.sprite(x + sx, y - e.size * 0.8, z + 0.12, 0.05, 1, 0.6, 1);
  }
  // HP bar
  if (e.hp < e.max) { const w = 0.5 * (e.type === "boss" ? 2 : 1), k = Math.max(0, e.hp / e.max), z = e.size * 2.6 + 0.3; ribbon([x - w / 2, y, z], [x + w / 2, y, z], 0.035, [0.15, 0.03, 0.03]); ribbon([x - w / 2, y, z + 0.001], [x - w / 2 + w * k, y, z + 0.001], 0.03, [0.3 + (1 - k), 1.2 * k, 0.2]); }
}
function buildDynamic() {
  D.reset(); A.reset(); Gl.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  // the Crystal Heart
  const [hx, hy] = HEART, crack = 1 - g.lives / 20, pulse = 0.6 + 0.4 * Math.sin(time * 2.5), hh = heartHit;
  const pts = [0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * TAU + time * 0.4; return [hx + Math.cos(a) * 0.35, hy + Math.sin(a) * 0.35, 0.9]; });
  const hc = [0.5 + hh, 0.8 - crack * 0.4, 1.2 - crack * 0.5];
  for (let k = 0; k < 6; k++) { const a = pts[k], b = pts[(k + 1) % 6]; Gl.tri([hx, hy, 1.7], a, b, hc, MAT.GLASS); Gl.tri([hx, hy, 0.3], b, a, hc.map((v) => v * 0.8), MAT.GLASS); }
  blob(D, [hx, hy, 0.9], 0.18, 0.18, 0.3, [0.5 + hh * 2, 0.9 * pulse, 1.6 * pulse], MAT.EMIT, 8, 5);
  A.sprite(hx, hy, 1.0, 1.6 + hh, 0.25 + hh, 0.4 * pulse, 0.7 * pulse);
  for (const t of g.towers) drawTower(t);
  for (const e of g.enemies) drawEnemy(e);
  // mortar shells in flight
  for (const s of g.shells) { const k = s.t / s.T, x = lerp(s.x0, s.x1, k) - W / 2 + 0.5, y = lerp(s.y0, s.y1, k) - H / 2 + 0.5, z = 0.8 + Math.sin(k * Math.PI) * 2.2; blob(D, [x, y, z], 0.1, 0.1, 0.1, [1.6, 0.7, 0.2], MAT.EMIT, 6, 4); A.sprite(x, y, z, 0.4, 0.6, 0.3, 0.08); }
  for (const b of g.bolts) { const k = b.life / 0.2; for (let i = 1; i < b.pts.length; i++) { const p0 = [b.pts[i - 1][0] - W / 2 + 0.5, b.pts[i - 1][1] - H / 2 + 0.5, i === 1 ? 1.3 : 0.5], p1 = [b.pts[i][0] - W / 2 + 0.5, b.pts[i][1] - H / 2 + 0.5, 0.5]; const m = [(p0[0] + p1[0]) / 2 + (Math.random() - 0.5) * 0.3, (p0[1] + p1[1]) / 2 + (Math.random() - 0.5) * 0.3, (p0[2] + p1[2]) / 2 + 0.2]; for (const [a, c] of [[p0, m], [m, p1]]) { ribbon(a, c, 0.03, [1.2 * k, 0.8 * k, 1.8 * k]); ribbon(a, c, 0.12, [0.25 * k, 0.12 * k, 0.4 * k]); } } }
  for (const r of fx.rings) { const t = r.r ? 1 - r.life / 0.6 : 1 - r.life / 0.4, R = r.r ? r.r * t : 0.3 + t * 1.0, k = r.life * (r.r ? 0.5 : 1.5); ring(r.x - (r.world ? 0 : W / 2 - 0.5), r.y - (r.world ? 0 : H / 2 - 0.5), 0.06, R, 0.05, r.c.map((v) => v * k), 32); }
  for (const m of fx.motes) { const k = m.life; A.sprite(m.x - W / 2 + 0.5, m.y - H / 2 + 0.5, m.z, 0.05, m.c[0] * k, m.c[1] * k, m.c[2] * k); }
  // build preview
  if (menu || (hover && state === "play" && buildable(...hover) && !g.towers.some((t) => t.x === hover[0] && t.y === hover[1]))) { const [tx, ty] = menu ? [menu.x, menu.y] : hover, [x, y] = tw(tx, ty); ring(x, y, 0.03, 0.45, 0.025, [0.3, 0.5, 0.3], 4); if (menu) ring(x, y, 0.04, TOWER.lamp.range, 0.02, [0.15, 0.2, 0.1], 48); }
  // path glow pulse toward the heart
  for (let s = (time * 2) % 1.5; s < PATH_LEN; s += 1.5) { const [px, py] = pathPos(s); A.sprite(px - W / 2 + 0.5, py - H / 2 + 0.5, 0.02, 0.3, 0.2, 0.1, 0.03); }
  const oD = 6; dyn.append(D); const oA = dyn.n; dyn.append(A); const oG = dyn.n; dyn.append(Gl);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oA - oD, oA, nA: oG - oA, oG, nG: dyn.n - oG };
}
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const L = [{ p: [HEART[0], HEART[1], 1.0], c: [0.5, 0.8, 1.2], k: 2.5 + heartHit * 4 }];
  for (const t of g.towers) { const [x, y] = tw(t.x, t.y); if (t.type === "lamp") L.push({ p: [x, y, 1.2], c: [1, 0.7, 0.35], k: 1.0 }); else if (t.type === "tesla") L.push({ p: [x, y, 1.4], c: [0.7, 0.4, 1], k: 0.8 }); }
  for (const r of fx.rings) if (!r.r) L.push({ p: [r.x - W / 2 + 0.5, r.y - H / 2 + 0.5, 0.5], c: r.c, k: r.life * 6 });
  const n = Math.min(6, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}
const MOON = nrm([-0.4, 0.75, 0.55]);
function render() {
  updateCamera();
  const o = buildDynamic(), nL = collectLights();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform3fv(U.uMoonDir, MOON); gl.uniform1f(U.uWin, 0);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  space.bind(false); space.draw(seg.O[0], seg.O[1]);
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  space.bind(false); space.draw(seg.A[0], seg.A[1]);
  space.bind(true); space.draw(o.oG, o.nG); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: heartHit * 0.4 });
}

// ------------------------------------------------------------------ UI
let toastT = 0, banT = 0;
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.remove("show"), 2000); }
function banner(t, s) { $("ban-t").textContent = t; $("ban-s").textContent = s; $("banner").classList.add("show"); clearTimeout(banT); banT = setTimeout(() => $("banner").classList.remove("show"), 2600); }
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  hud() {
    $("h-wave").textContent = `${Math.min(g.wave + (g.waveActive ? 1 : 0), WAVES.length)} / ${WAVES.length}`; $("h-lives").textContent = g.lives; $("h-gold").textContent = g.gold;
    $("b-wave").textContent = g.waveActive ? "Wave in progress" : g.wave >= WAVES.length ? "—" : `Start wave ${g.wave + 1}`; $("b-wave").classList.toggle("dis", g.waveActive);
    $("b-speed").textContent = speed === 2 ? "▶▶ ×2" : "▶ ×1";
    if (menu) $("menu").querySelectorAll("button").forEach((b) => b.classList.toggle("dis", g.gold < TOWER[b.dataset.k].cost));
    if (menu) { const [sx, sy] = screenOf([...tw(menu.x, menu.y), 0.3]); $("menu").style.left = `${sx}px`; $("menu").style.top = `${sy}px`; }
    if (sel) this.panel(true);
  },
  panel(quiet) {
    const p = $("panel"); if (!sel || !g.towers.includes(sel)) { sel = null; p.classList.add("hidden"); return; }
    const T = TOWER[sel.type], S = towerStats(sel);
    const st = sel.type === "lamp" ? `${Math.round(S.dps)} dps` : sel.type === "mortar" ? `${Math.round(S.dmg)} dmg / ${S.rate.toFixed(1)}s · splash` : sel.type === "bell" ? `slow ${Math.round((1 - S.slow) * 100)}% · ${S.tick}/s` : `${Math.round(S.dmg)} dmg ×${S.chain} chain`;
    $("p-name").textContent = `${T.name}  ${"★".repeat(sel.level)}`; $("p-stats").textContent = `${st} · range ${S.range.toFixed(1)}`;
    $("p-up").textContent = sel.level >= 3 ? "Max level" : `Upgrade ${upgradeCost(sel)}g`; $("p-up").classList.toggle("dis", sel.level >= 3 || g.gold < upgradeCost(sel));
    $("p-sell").textContent = `Sell ${Math.round(sel.spent * 0.7)}g`; p.classList.remove("hidden"); void quiet;
  },
  title() { $("t-best").textContent = save.best ? `Best: ${save.best} / ${WAVES.length} waves · ${save.wins} victories` : "Click grass to build · Space starts the next wave"; },
};
function toTitle() { for (const m of ["m-over", "m-set"]) $(m).classList.add("hidden"); state = "title"; startDemo(); closeMenu(); sel = null; ui.panel(); ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.build(); startGame(0); };
$("o-again").onclick = () => { $("m-over").classList.add("hidden"); startGame(0); }; $("o-title").onclick = toTitle; $("b-quit").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };

window.__siege = () => ({ state, wave: g.wave + 1, lives: g.lives, gold: g.gold, towers: g.towers.length, enemies: g.enemies.length, fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  update(dt); render();
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
startDemo();
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); state = "title"; ui.show("title"); ui.title();
  if (bot || Q.has("wave")) { startGame(clamp(+(Q.get("wave") || 1) - 1, 0, WAVES.length - 1)); if (bot) speed = 2; }
}, 400);
