// FROST STONE — curling on a frozen lake under the aurora. Rendered with the projection3d library (Space, via
// GameSpace) + custom shaders + bloom. See DESIGN.md. physics.js moves the stones, ai.js (in aiworker.js) is the CPU
// skip, scene.js builds the lake; this file runs the match, input, camera, lights, reflections and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, mixc, limb, tube, mulberry32 } from "./mesh.js";
import { R as SR, HALF_W, HOG, TEE, BACK, HOUSE, step, moving, hogCheck, throwStone, simulate, score } from "./physics.js";
import { buildScene, shadow, LANTERNS, HUT } from "./scene.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

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
const DEF = { wins: 0, losses: 0, played: 0, best: 0, volume: 0.8, music: 0.6, guide: "curl", diff: 1 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("froststone.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("froststone.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static world (+ its mirror image under the ice)
const stat = new Mesh(600000);
const seg = {};
{
  const O = new Mesh(300000), Rf = new Mesh(200000), I = new Mesh(20000), Sh = new Mesh(2000), A = new Mesh(2000);
  buildScene(O, Rf, I, Sh, A);
  const mir = (src) => { const m = new Mesh(src.n + 8); m.append(src); for (let i = 0; i < m.n; i++) m.pos[i * 4 + 2] = -m.pos[i * 4 + 2]; return m; };
  const parts = [["RM", mir(Rf)], ["RA", mir(A)], ["I", I], ["O", O], ["Sh", Sh], ["A", A]];
  for (const [k, m] of parts) { seg[k] = [stat.n, m.n]; stat.append(m); }
  space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ stone model (local coords, handle along +x)
const TEAM_COL = [[0.85, 0.09, 0.07], [0.98, 0.76, 0.12]];
const TEAM_NAME = ["Red", "Yellow"];
const stoneT = [0, 1].map((team) => {
  const m = new Mesh(4000), rnd = mulberry32(7 + team), N = 28;
  const prof = [[0, 0.004], [0.06, 0], [0.12, 0.008], [0.142, 0.03], [0.145, 0.048], [0.145, 0.066], [0.142, 0.084], [0.12, 0.104], [0.06, 0.113], [0, 0.114]];
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, [r0, z0] = prof[j], [r1, z1] = prof[j + 1];
    const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
    const band = j === 4, k = 0.72 + rnd() * 0.42, speck = rnd() < 0.08 ? 0.45 : rnd() < 0.1 ? 1.5 : 1;
    const c = band ? [0.62, 0.63, 0.66] : [0.38 * k * speck, 0.39 * k * speck, 0.43 * k * speck];
    m.quad(P(r0, a0, z0), P(r0, a1, z0), P(r1, a1, z1), P(r1, a0, z1), c, MAT.STONE);
  }
  const tc = TEAM_COL[team];
  tube(m, 0, 0, 16, 0.065, 0.113, 0.06, 0.124, tc, MAT.GLOSS);
  limb(m, [-0.045, 0, 0.118], [-0.045, 0, 0.168], 0.017, 0.015, tc, MAT.GLOSS, 6);
  limb(m, [-0.06, 0, 0.168], [0.115, 0, 0.152], 0.017, 0.016, tc, MAT.GLOSS, 6);
  return m;
});
function putStone(M, s, mirror) {
  const T = stoneT[s.team], c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0), zs = mirror ? -1 : 1, lift = s.lift || 0;
  for (let i = 0; i < T.n; i++) {
    const o = i * 4, x = T.pos[o], y = T.pos[o + 1];
    M.v(s.x + x * c - y * sn, s.y + x * sn + y * c, (T.pos[o + 2] + lift) * zs, T.pos[o + 3], T.col[o], T.col[o + 1], T.col[o + 2], T.col[o + 3]);
  }
}

// ------------------------------------------------------------------ match state
const G = {
  state: "loading", mode: "cpu", diff: save.diff, end: 0, ends: 4, scores: [[], []], first: 1, thrown: 0, stones: [],
  turn: 0, aimX: 0, spin: 1, weight: 0, wDir: 1, charging: false, shot: null, sweep: false, settleT: 0, endT: 0, t: 0,
  cpu: null, flashT: 0, extra: false,
};
let time = 0;
const totals = () => [0, 1].map((t) => G.scores[t].reduce((a, b) => a + b, 0));
function startMatch(mode) {
  Object.assign(G, { mode, end: 0, ends: mode === "practice" ? 99 : 4, scores: [[], []], first: 1, extra: false });
  ui.show("hud"); startEnd();
}
function startEnd() {
  G.stones = []; G.thrown = 0; G.shot = null; ui.board(); nextThrow();
}
function nextThrow() {
  if (G.thrown >= 8) return scoreEnd();
  G.turn = G.mode === "practice" ? 0 : (G.first + G.thrown) % 2;
  G.aimX = 0; G.weight = 0; G.wDir = 1; G.charging = false; G.sweep = false;
  G.shot = { team: G.turn, x: 0, y: 0, vx: 0, vy: 0, spin: G.spin, alive: true, out: null, swept: false, rot: 0, waiting: true };
  ui.stonesLeft();
  if (G.turn === 0 && !bot) { G.state = "aim"; ui.prompt(); }
  else { G.state = "cpu"; cpuThink(); }
}
function release(speed, aim, spin) {
  const s = G.shot, t = throwStone(s.team, aim, speed, spin);
  Object.assign(s, t, { rot: s.rot, waiting: false, launchT: time });
  G.stones.push(s); G.thrown++; G.state = "run"; G.camT = 0;
  audio.release(); ui.stonesLeft(); ui.prompt();
}
function scoreEnd() {
  const sc = score(G.stones);
  G.state = "endscore"; G.endT = 0;
  if (G.mode === "practice") {
    const n = G.stones.filter((s) => s.alive && Math.hypot(s.x, s.y - TEE) < HOUSE + SR).length;
    G.scores[0].push(n); G.scores[1].push(0); G.counting = G.stones.filter((s) => s.alive && Math.hypot(s.x, s.y - TEE) < HOUSE + SR);
    banner("End " + (G.end + 1), n ? `${n} stone${n > 1 ? "s" : ""} in the house` : "Nothing in the house");
    if (n) audio.chime(n); else audio.sad();
    save.best = Math.max(save.best, n); persist();
  } else {
    for (const t of [0, 1]) G.scores[t].push(sc.team === t ? sc.n : 0);
    G.counting = sc.counting;
    if (sc.team === null) banner("Blank end", "No stones in the house — the hammer stays");
    else { banner(sc.team === 0 ? "You score" : "Yellow scores", `${sc.n} point${sc.n > 1 ? "s" : ""}`); sc.team === 0 ? audio.chime(sc.n) : audio.sad(); }
    if (sc.team !== null) G.first = sc.team;               // the scoring side throws first next end (loses the hammer)
  }
  ui.board();
}
function afterEnd() {
  G.end++; G.counting = null;
  const [a, b] = totals();
  if (G.mode === "cpu" && G.end >= G.ends) {
    if (a === b && G.end < 6) { G.ends++; G.extra = true; banner("Extra end", "Tied — one more end decides it"); }
    else return finish();
  }
  startEnd();
}
function finish() {
  G.state = "result";
  const [a, b] = totals(), win = a > b;
  save.played++; if (win) save.wins++; else save.losses++; persist();
  $("r-k").textContent = win ? "Victory on the ice" : "Defeat"; $("r-t").textContent = win ? "You win the match" : "Yellow wins the match";
  $("r-score").textContent = `${a} – ${b}`; $("r-rec").textContent = `${save.wins} wins · ${save.losses} losses`;
  $("m-result").classList.remove("hidden"); audio.fanfare(win);
}

// ------------------------------------------------------------------ CPU skip (worker)
let worker = null, reqId = 0;
try { worker = new Worker(new URL("./aiworker.js", import.meta.url), { type: "module" }); worker.onmessage = (e) => { if (G.cpu && e.data.id === G.cpu.id) G.cpu.shot = e.data.shot; }; } catch { worker = null; }
const NOISE = [2.6, 1.2, 0.45];
function cpuThink() {
  const id = ++reqId, stones = G.stones.filter((s) => s.alive).map(({ team, x, y, vx, vy, spin, alive, out }) => ({ team, x, y, vx: 0, vy: 0, spin, alive, out, swept: false }));
  G.cpu = { id, shot: null, t: 0, aimX: 0 };
  const noise = G.turn === 1 ? NOISE[G.diff] : 0.4;
  if (worker) worker.postMessage({ id, stones, team: G.turn, noise });
  else import("./ai.js").then((m) => { if (G.cpu && G.cpu.id === id) G.cpu.shot = m.chooseShot(stones, G.turn, noise); });
  ui.prompt();
}
function cpuStep(dt) {
  const c = G.cpu; c.t += dt;
  if (!c.shot) return;
  const target = Math.tan(c.shot.aim) * TEE;
  G.aimX = lerp(G.aimX, target, Math.min(1, dt * 3)); G.spin = c.shot.spin; G.shot.spin = c.shot.spin;
  if (c.t > 1.6 && Math.abs(G.aimX - target) < 0.02) { G.cpu = null; release(c.shot.speed, c.shot.aim, c.shot.spin); }
}

// ------------------------------------------------------------------ weight meter (non-linear so the house zone is roomy)
const WZ = [[0, 2.3], [0.15, 2.51], [0.4, 2.68], [0.66, 2.84], [0.76, 3.0], [1, 3.85]];
const ZONES = [["HOG", 0, 0.15], ["GUARD", 0.15, 0.4], ["DRAW", 0.4, 0.66], ["HEAVY", 0.66, 0.76], ["TAKEOUT", 0.76, 1]];
function weightToSpeed(w) { for (let i = 0; i < WZ.length - 1; i++) if (w <= WZ[i + 1][0]) return lerp(WZ[i][1], WZ[i + 1][1], (w - WZ[i][0]) / (WZ[i + 1][0] - WZ[i][0])); return WZ[WZ.length - 1][1]; }
const aimAngle = () => Math.atan2(G.aimX, TEE);

// ------------------------------------------------------------------ input
const input = { drag: null, keys: new Set() };
function canAim() { return G.state === "aim" && !G.charging; }
canvas.addEventListener("pointerdown", (e) => {
  audio.init();
  if (G.state === "aim") { input.drag = { id: e.pointerId, x: e.clientX, x0: G.aimX, moved: false, t: performance.now() }; canvas.setPointerCapture(e.pointerId); }
  else if (G.state === "run") G.sweep = true;
});
canvas.addEventListener("pointermove", (e) => {
  if (!input.drag || input.drag.id !== e.pointerId || !canAim()) return;
  const dx = e.clientX - input.drag.x; if (Math.abs(dx) > 4) input.drag.moved = true;
  G.aimX = clamp(input.drag.x0 + dx * 0.006 * (900 / Math.max(500, innerWidth)), -2.1, 2.1);
});
canvas.addEventListener("pointerup", (e) => { if (input.drag && input.drag.id === e.pointerId) input.drag = null; G.sweep = false; });
const throwBtn = $("b-throw");
throwBtn.addEventListener("pointerdown", (e) => { audio.init(); beginCharge(); e.preventDefault(); });
throwBtn.addEventListener("pointerup", () => endCharge()); throwBtn.addEventListener("pointerleave", () => endCharge());
const sweepBtn = $("b-sweep");
sweepBtn.addEventListener("pointerdown", (e) => { G.sweep = true; e.preventDefault(); }); sweepBtn.addEventListener("pointerup", () => (G.sweep = false)); sweepBtn.addEventListener("pointerleave", () => (G.sweep = false));
$("b-in").onclick = () => setSpin(1); $("b-out").onclick = () => setSpin(-1);
function setSpin(s) { if (G.state !== "aim") return; G.spin = s; if (G.shot) G.shot.spin = s; audio.tick2(); ui.prompt(); }
addEventListener("keydown", (e) => {
  audio.init(); input.keys.add(e.code);
  if (e.code === "Space" && !e.repeat) { if (G.state === "aim") beginCharge(); else if (G.state === "run") G.sweep = true; e.preventDefault(); }
  if (e.code === "KeyQ") setSpin(-1); if (e.code === "KeyE") setSpin(1);
  if (e.code === "Escape" || e.code === "KeyP") { if (["aim", "run", "cpu", "settle", "endscore"].includes(G.state)) pause(); else if (G.state === "paused") resume(); }
  if ((e.code === "Enter" || e.code === "Space") && G.state === "endscore" && G.endT > 1) afterEnd();
});
addEventListener("keyup", (e) => { input.keys.delete(e.code); if (e.code === "Space") { endCharge(); G.sweep = false; } });
function beginCharge() { if (G.state === "aim" && !G.charging) { G.charging = true; G.weight = 0; G.wDir = 1; audio.tick2(); } }
function endCharge() { if (!G.charging) return; G.charging = false; release(weightToSpeed(G.weight), aimAngle(), G.spin); }

// ------------------------------------------------------------------ update
const fx = { snow: [], puffs: [], rings: [] };
const rnd = Math.random;
for (let i = 0; i < 420; i++) fx.snow.push({ x: (rnd() - 0.5) * 40, y: (rnd() - 0.5) * 40, z: rnd() * 14, s: 0.015 + rnd() * 0.025, ph: rnd() * TAU });
function puff(x, y, n, col = [0.5, 0.55, 0.65], sp = 1) { for (let i = 0; i < n; i++) { const a = rnd() * TAU, v = (0.3 + rnd()) * sp; fx.puffs.push({ x, y, z: 0.05 + rnd() * 0.1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.4 + rnd() * 1.2, life: 0.6 + rnd() * 0.8, max: 1.4, col, s: 0.03 + rnd() * 0.04 }); } }
function update(dt) {
  time += dt; G.t += dt;
  const k = input.keys;
  if (G.state === "aim") {
    const ks = 1.4 * dt;
    if (!G.charging) { if (k.has("ArrowLeft") || k.has("KeyA")) G.aimX -= ks; if (k.has("ArrowRight") || k.has("KeyD")) G.aimX += ks; G.aimX = clamp(G.aimX, -2.1, 2.1); }
    if (G.charging) { G.weight += G.wDir * dt / 2.2; if (G.weight >= 1) { G.weight = 1; G.wDir = -1; } if (G.weight <= 0) { G.weight = 0; G.wDir = 1; } }
    if (G.shot) G.shot.rot += G.spin * dt * 0.6;
  }
  if (G.state === "cpu" && G.cpu) { cpuStep(dt); if (G.shot) G.shot.rot += G.spin * dt * 0.6; }
  if (bot && G.state === "run" && G.shot && G.shot.team === 0) G.sweep = false;
  if (G.state === "run" || G.state === "settle") {
    const s = G.shot;
    const canSweep = s && s.alive && Math.hypot(s.vx, s.vy) > 0.05 && s.y < BACK && s.team === 0;
    if (s) s.swept = G.sweep && canSweep;
    const sdt = dt * (s && s.team === 0 && !bot ? 1.9 : 2.6);         // real stones take ~25 s; play it faster
    const hits = step(G.stones, sdt);
    for (const h of hits) { audio.clack(h.s); puff(h.x, h.y, Math.min(16, 3 + h.s * 6), [0.6, 0.65, 0.75], 0.6); G.flashT = Math.max(G.flashT, Math.min(0.5, h.s * 0.15)); }
    for (const st of G.stones) {
      const v = Math.hypot(st.vx, st.vy);
      if (st.alive && v > 0.01) st.rot = (st.rot || 0) + st.spin * dt * (0.25 + v * 0.18);
      if (!st.alive && !st.gone) { st.gone = true; st.fade = 1; puff(st.x, st.y, 14, [0.7, 0.75, 0.85], 1.2); if (st === s && st.out === "side") toast("Out of play"); if (st.out === "back") toast(st === s ? "Through the house" : "Knocked out"); }
    }
    if (s && s.swept) { s.sweptT = (s.sweptT || 0) + dt; if (rnd() < dt * 40) puff(s.x + (rnd() - 0.5) * 0.4, s.y + 0.4 + rnd() * 0.3, 1, [0.5, 0.55, 0.65], 0.4); }
    audio.update(Math.max(0, ...G.stones.filter((q) => q.alive).map((q) => Math.hypot(q.vx, q.vy))), s && s.swept ? 1 : 0);
    if (G.state === "run" && !moving(G.stones)) { G.state = "settle"; G.settleT = 0; const hog = hogCheck(s); (G.log ||= []).push([s.team, +s.x.toFixed(2), +s.y.toFixed(2), s.out]); if (hog) { toast("Hog line — stone removed"); puff(s.x, s.y, 12); s.gone = true; s.fade = 1; } }
    if (G.state === "settle") { G.settleT += dt; if (G.settleT > 1.3) { G.stones = G.stones.filter((q) => q.alive); nextThrow(); } }
  } else audio.update(0, 0);
  if (G.state === "endscore") { G.endT += dt; if (G.endT > (bot ? 3 : 6)) afterEnd(); }
  if (G.state === "title") titleWorld(dt);
  // fx
  for (const p of fx.puffs) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 2.5 * dt; p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; if (p.z < 0.02) { p.z = 0.02; p.vz = 0; } p.life -= dt; }
  fx.puffs = fx.puffs.filter((p) => p.life > 0);
  for (const st of G.stones) if (st.fade > 0) st.fade -= dt * 2;
  G.flashT = Math.max(0, G.flashT - dt * 2);
  ui.frame(dt);
}
function titleWorld(dt) {
  // a slow demo of stones gliding into the house behind the title
  if (!G.demo || G.demo.t > 9) {
    G.demo = { t: 0 }; G.stones = [];
    for (let i = 0; i < 5; i++) { const s = throwStone(i % 2, (rnd() - 0.5) * 0.04, 2.74 + rnd() * 0.08, rnd() < 0.5 ? 1 : -1); simulate([s]); Object.assign(s, { rot: rnd() * TAU }); G.stones.push(s); }
    G.shot = throwStone(1, 0.005, 2.95, -1); G.shot.rot = 0; G.stones.push(G.shot);
  }
  G.demo.t += dt; step(G.stones, dt);
  for (const st of G.stones) if (st.alive) st.rot += st.spin * dt * 0.4;
}

// ------------------------------------------------------------------ camera
const cam = { E: [0, -8, 2.5], T: [0, 30, 0], mag: 2.4 };
function updateCamera(dt) {
  let E, T, mag = 2.4, k = Math.min(1, dt * 2.5);
  const s = G.shot;
  if (G.state === "title" || G.state === "loading") {
    const a = time * 0.04;
    E = [Math.sin(a) * 12, 18 + Math.cos(a) * 10, 3.2]; T = [Math.sin(a * 0.7) * 3, 40, 4.6]; mag = 1.5;
  } else if (G.state === "aim" || G.state === "cpu") {
    E = [G.aimX * 0.08, -3.4, 1.3]; T = [G.aimX * 0.5, 30, -1.3]; mag = 1.85;
  } else if ((G.state === "run" || G.state === "settle") && s && (s.alive || s.fade > 0) && s.y < 27) {
    E = [s.x * 0.7, s.y - 4.6, 1.35]; T = [s.x * 0.6 + Math.sin(aimAngle()) * 4, s.y + 7, 0.1]; mag = 2.1; k = Math.min(1, dt * 5);
  } else {
    E = [0, TEE - 7.2, 4.4]; T = [0, TEE + 0.4, -0.3]; mag = 2.5;
    if (G.state === "endscore") { const a = G.endT * 0.15; E = [Math.sin(a) * 2.5, TEE - 6.4, 3.4 + G.endT * 0.15]; }
  }
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k)); cam.mag = lerp(cam.mag, mag, k);
  space.magnifier = cam.mag * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(80000), DM = new Mesh(80000), Sh = new Mesh(2000), A = new Mesh(30000), AM = new Mesh(8000), dyn = new Mesh(200000);
function ringAt(M, x, y, r, col, n = 28, z = 0.02, size = 0.05) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU + time * 0.6; M.sprite(x + Math.cos(a) * r, y + Math.sin(a) * r, z, size, col[0], col[1], col[2]); } }
function brooms(s) {
  // two sweepers' broom heads scrubbing in front of the stone
  const v = Math.hypot(s.vx, s.vy) || 1, ux = s.vx / v, uy = s.vy / v;
  for (const side of [-1, 1]) {
    const w = Math.sin(time * 16 + side) * 0.18, cx = s.x + ux * 0.42 + uy * w * side, cy = s.y + uy * 0.42 - ux * w * side;
    const hx = cx - uy * side * 0.9 - ux * 0.5, hy = cy + ux * side * 0.9 - uy * 0.5;
    limb(D, [cx, cy, 0.05], [hx, hy, 1.1], 0.014, 0.014, [0.12, 0.12, 0.14], MAT.GLOSS, 5);
    const bx = -uy * 0.11, by = ux * 0.11;
    D.quad([cx - bx - ux * 0.035, cy - by - uy * 0.035, 0.012], [cx + bx - ux * 0.035, cy + by - uy * 0.035, 0.012], [cx + bx + ux * 0.035, cy + by + uy * 0.035, 0.012], [cx - bx + ux * 0.035, cy - by + uy * 0.035, 0.012], side < 0 ? [0.1, 0.25, 0.75] : [0.85, 0.15, 0.12], MAT.MATTE);
    D.quad([cx - bx - ux * 0.035, cy - by - uy * 0.035, 0.06], [cx + bx - ux * 0.035, cy + by - uy * 0.035, 0.06], [cx + bx + ux * 0.035, cy + by + uy * 0.035, 0.06], [cx - bx + ux * 0.035, cy - by + uy * 0.035, 0.06], [0.08, 0.08, 0.1], MAT.MATTE);
  }
}
function buildDynamic() {
  D.reset(); DM.reset(); Sh.reset(); A.reset(); AM.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  const list = G.stones.filter((s) => s.alive || s.fade > 0);
  if (G.shot && G.shot.waiting) list.push(G.shot);
  for (const s of list) {
    if (!s.alive) { if (s.fade <= 0) continue; s.lift = (1 - s.fade) * -0.12; }
    putStone(D, s, false); putStone(DM, s, true); shadow(Sh, s.x, s.y, 0, 0.26, 0.65);
  }
  // stones waiting to be thrown, lined up beside the sheet behind the hack
  if (G.state !== "title" && G.state !== "loading") {
    const thrownBy = [0, 0]; for (let i = 0; i < G.thrown; i++) thrownBy[G.mode === "practice" ? 0 : (G.first + i) % 2]++;
    for (const t of G.mode === "practice" ? [0] : [0, 1]) {
      const left = (G.mode === "practice" ? 8 : 4) - thrownBy[t] - (G.shot && G.shot.waiting && G.shot.team === t ? 1 : 0);
      for (let i = 0; i < left; i++) { const q = { team: t, x: (t ? 1 : -1) * (3.0 + (i % 2) * 0.34), y: -2.5 - Math.floor(i / 2) * 0.34 - (i % 2) * 0.17, rot: t ? Math.PI : 0 }; putStone(D, q, false); putStone(DM, q, true); shadow(Sh, q.x, q.y, 0, 0.26, 0.6); }
    }
  }
  if (G.shot && G.shot.swept && G.shot.alive) brooms(G.shot);
  // aim: the skip's broom target + a guide
  if (G.state === "aim" || (G.state === "cpu" && G.cpu && G.cpu.shot)) {
    const bx = G.aimX, glow = 0.6 + 0.4 * Math.sin(time * 4);
    ringAt(A, bx, TEE, 0.18, [0.5 * glow, 0.8 * glow, 1.0 * glow], 16, 0.03, 0.04);
    A.sprite(bx, TEE, 0.05, 0.25, 0.2, 0.35, 0.6);
    const aim = aimAngle();
    for (let d = 1.2; d < 10; d += 0.45) A.sprite(Math.sin(aim) * d, Math.cos(aim) * d, 0.02, 0.025, 0.25, 0.4, 0.6);
    if (save.guide !== "off" && G.state === "aim") {
      const sp = save.guide === "full" ? weightToSpeed(G.charging ? G.weight : 0.53) : 2.76;
      const s = throwStone(0, aim, sp, G.spin); let t = 0;
      while (t < 30 && Math.hypot(s.vx, s.vy) > 0.01 && s.alive) { step([s], 0.15); t += 0.15; if (s.y > 6) { const f = 0.5 * Math.min(1, (s.y - 6) / 8); A.sprite(s.x, s.y, 0.02, 0.03, 0.2 * f, 0.55 * f, 0.9 * f); } }
      if (s.alive) ringAt(A, s.x, s.y, SR, [0.3, 0.6, 1.0], 14, 0.03, 0.035);
    }
  }
  // shot stone marker / counting stones
  if (G.state === "endscore" && G.counting) for (const s of G.counting) { ringAt(A, s.x, s.y, 0.22, s.team ? [1.0, 0.75, 0.2] : [1.0, 0.3, 0.2], 24, 0.03, 0.05); A.sprite(s.x, s.y, 0.3, 0.6, 0.35, 0.25, 0.1); }
  else if ((G.state === "settle" || G.state === "aim" || G.state === "cpu") && G.mode !== "practice") {
    const sc = score(G.stones.filter((s) => s.alive)); if (sc.team !== null) { const s = sc.counting[0]; ringAt(A, s.x, s.y, 0.2, [0.45, 0.45, 0.5], 18, 0.025, 0.03); }
  }
  // moving stone glow trail on the ice
  for (const s of G.stones) if (s.alive && Math.hypot(s.vx, s.vy) > 0.2) { const c = TEAM_COL[s.team]; A.sprite(s.x, s.y, 0.05, 0.35, c[0] * 0.12, c[1] * 0.12, c[2] * 0.12); }
  // snow
  const cx = cam.T[0] * 0.5 + cam.E[0] * 0.5, cy = cam.E[1] + 12;
  for (const f of fx.snow) {
    f.z -= 0.0075; f.x += Math.sin(time * 0.6 + f.ph) * 0.004;
    if (f.z < 0) { f.z = 14; }
    const x = cx + ((((f.x - cx) % 40) + 60) % 40) - 20, y = cy + ((((f.y - cy) % 40) + 60) % 40) - 20;
    A.sprite(x, y, f.z, f.s, 0.22, 0.24, 0.28);
  }
  for (const p of fx.puffs) { const k = p.life / p.max; A.sprite(p.x, p.y, p.z, p.s, p.col[0] * k, p.col[1] * k, p.col[2] * k); }
  // mirrored glows (lanterns are static; the stone trails are dynamic)
  for (let i = 0; i < A.n; i++) { /* additive reflections: only the nearby low sprites */ }
  const oD = 6; dyn.append(D); const oM = dyn.n; dyn.append(DM); const oSh = dyn.n; dyn.append(Sh); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oM - oD, oM, nM: oSh - oM, oSh, nSh: oA - oSh, oA, nA: dyn.n - oA };
}

// ------------------------------------------------------------------ lights: the 8 lanterns nearest the action + the hut
const LPOS = LANTERNS.map(([x, y]) => [x - Math.sign(x) * 0.38, y, 2.11]);
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);
function collectLights() {
  const f = cam.T, L = LPOS.map((p) => ({ p, c: [1, 0.58, 0.26], k: 0.85 * (0.93 + 0.07 * Math.sin(time * 9 + p[1])), d: Math.hypot(p[0] - f[0], p[1] - f[1]) * 0.7 + Math.hypot(p[0] - cam.E[0], p[1] - cam.E[1]) * 0.3 }));
  L.push({ p: [HUT.x - HUT.w / 2 - 0.8, HUT.y, 1.3], c: [1, 0.55, 0.22], k: 1.5, d: Math.hypot(HUT.x - f[0], HUT.y - f[1]) * 0.6 });
  L.sort((a, b) => a.d - b.d);
  const n = Math.min(8, L.length);
  for (let i = 0; i < n; i++) { lightBuf.set([...L[i].p, L[i].k], i * 4); lightColBuf.set(L[i].c, i * 3); }
  return n;
}

const MOON = nrm([-0.35, 0.9, 0.26]);
function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), nL = collectLights();
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform3fv(U.uMoonDir, MOON);
  gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, nL);
  space.applyCamera();
  const S = (k) => { space.bind(false); space.draw(seg[k][0], seg[k][1]); };
  // 1 sky
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  // 2 the world mirrored under the ice
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  S("RM"); space.bind(true); space.draw(o.oM, o.nM);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE); S("RA");
  // 3 the ice, blended over its reflection
  gl.depthMask(true); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); S("I");
  gl.disable(gl.BLEND);
  // 4 the world
  S("O"); space.bind(true); space.draw(o.oD, o.nD);
  // 5 shadows, glows
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); S("Sh"); space.bind(true); space.draw(o.oSh, o.nSh);
  gl.blendFunc(gl.ONE, gl.ONE); S("A"); space.bind(true); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: G.flashT * 0.3 });
}

// ------------------------------------------------------------------ UI
let toastT = 0, bannerT = 0;
function toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); toastT = 1.8; }
function banner(t, s) { $("ban-t").textContent = t; $("ban-s").textContent = s; $("banner").classList.add("show"); bannerT = 3.2; }
const mini = $("mini").getContext("2d");
const ui = {
  show(w) { $("title").classList.toggle("hidden", w !== "title"); $("hud").classList.toggle("hidden", w !== "hud"); },
  board() {
    const n = Math.max(G.mode === "practice" ? Math.min(G.scores[0].length + 1, 8) : G.ends, 1);
    const cell = (t, i) => { const v = G.scores[t][i]; return `<td class="${i === G.end ? "cur" : ""}">${v === undefined ? "" : v}</td>`; };
    const off = Math.max(0, n - 8);
    const idx = Array.from({ length: Math.min(n, 8) }, (_, i) => i + off);
    const [a, b] = totals();
    const rows = G.mode === "practice" ? [[0, "In house"]] : [[0, "You"], [1, "Yellow"]];
    $("board").innerHTML = `<tr><th></th>${idx.map((i) => `<th class="${i === G.end ? "cur" : ""}">${i + 1}</th>`).join("")}<th>T</th></tr>` +
      rows.map(([t, name]) => `<tr class="t${t}"><td class="nm"><i></i>${name}${G.mode !== "practice" && ((G.first + 1) % 2) === t ? '<b title="hammer">⚒</b>' : ""}</td>${idx.map((i) => cell(t, i)).join("")}<td class="tot">${t ? b : a}</td></tr>`).join("");
  },
  stonesLeft() {
    const thrownBy = [0, 0]; for (let i = 0; i < G.thrown; i++) thrownBy[G.mode === "practice" ? 0 : (G.first + i) % 2]++;
    const per = G.mode === "practice" ? 8 : 4;
    $("left0").innerHTML = Array.from({ length: per }, (_, i) => `<i class="${i < thrownBy[0] ? "used" : ""}"></i>`).join("");
    $("left1").innerHTML = G.mode === "practice" ? "" : Array.from({ length: 4 }, (_, i) => `<i class="${i < thrownBy[1] ? "used" : ""}"></i>`).join("");
  },
  prompt() {
    const p = $("prompt"), you = G.turn === 0;
    if (G.state === "aim") p.innerHTML = G.charging ? "Release to throw" : `Drag or <kbd>←</kbd><kbd>→</kbd> to aim · <kbd>Q</kbd>/<kbd>E</kbd> curl · hold <kbd>Space</kbd> or <b>THROW</b> for weight`;
    else if (G.state === "cpu") p.innerHTML = G.turn === 1 ? "Yellow's skip is reading the ice…" : "Thinking…";
    else if (G.state === "run") p.innerHTML = you && G.shot && G.shot.team === 0 ? "Hold <kbd>Space</kbd> or the mouse to <b>SWEEP</b> — carries further & curls less" : "";
    else p.innerHTML = "";
    $("turn").textContent = G.mode === "practice" ? "Practice" : you ? "Your stone" : "Yellow's stone"; $("turn").className = "turn t" + G.turn;
    $("b-in").classList.toggle("on", G.spin === 1); $("b-out").classList.toggle("on", G.spin === -1);
    $("controls").classList.toggle("off", G.state !== "aim");
  },
  frame(dt) {
    $("meter").classList.toggle("on", G.state === "aim" || (G.state === "cpu" && !!(G.cpu && G.cpu.shot)));
    $("m-fill").style.height = (G.charging ? G.weight * 100 : 0) + "%";
    const zone = ZONES.find(([, a, b]) => G.weight >= a && G.weight <= b);
    $("m-zone").textContent = G.charging && zone ? zone[0] : "";
    $("b-sweep").classList.toggle("show", G.state === "run" && G.shot && G.shot.team === 0 && G.shot.alive && Math.hypot(G.shot.vx, G.shot.vy) > 0.05);
    $("b-sweep").classList.toggle("on", !!(G.shot && G.shot.swept));
    $("sweepfx").style.opacity = G.shot && G.shot.swept ? 1 : 0;
    if (G.state !== this._st) { this._st = G.state; this.prompt(); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("show"); }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $("banner").classList.remove("show"); }
    this.mini();
  },
  mini() {
    const c = mini, W = c.canvas.width, H = c.canvas.height, sc = W / 4.9, cx = W / 2, cy = H * 0.52;
    c.clearRect(0, 0, W, H);
    const P = (x, y) => [cx + x * sc, cy - (y - TEE) * sc];
    c.fillStyle = "rgba(200,225,255,0.09)"; c.fillRect(cx - HALF_W * sc, 0, HALF_W * 2 * sc, H);
    for (const [r, col] of [[1.83, "rgba(40,90,220,0.85)"], [1.22, "rgba(235,240,250,0.8)"], [0.61, "rgba(215,40,30,0.85)"], [0.15, "rgba(235,240,250,0.9)"]]) { c.beginPath(); c.arc(cx, cy, r * sc, 0, TAU); c.fillStyle = col; c.fill(); }
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - HALF_W * sc, cy); c.lineTo(cx + HALF_W * sc, cy); c.moveTo(cx, 0); c.lineTo(cx, H); c.stroke();
    const [, by] = P(0, BACK); c.beginPath(); c.moveTo(cx - HALF_W * sc, by); c.lineTo(cx + HALF_W * sc, by); c.stroke();
    for (const s of G.stones) if (s.alive && s.y > TEE - 3.4) {
      const [x, y] = P(s.x, s.y); c.beginPath(); c.arc(x, y, SR * sc, 0, TAU); c.fillStyle = "#6c6f78"; c.fill();
      c.beginPath(); c.arc(x, y, SR * sc * 0.55, 0, TAU); c.fillStyle = s.team ? "#f6c21e" : "#e0261a"; c.fill();
    }
    if (G.state === "aim" || G.state === "cpu") { const [x, y] = P(G.aimX, TEE); c.strokeStyle = "rgba(140,200,255,0.9)"; c.beginPath(); c.arc(x, y, 5, 0, TAU); c.stroke(); }
  },
  title() { $("t-rec").textContent = save.played ? `${save.wins} wins · ${save.losses} losses` + (save.best ? ` · best practice end ${save.best}` : "") : "Four ends against the CPU skip · or practise your draw"; $("t-diff").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === G.diff)); },
};
function pause() { G.prev = G.state; G.state = "paused"; $("m-pause").classList.remove("hidden"); }
function resume() { $("m-pause").classList.add("hidden"); G.state = G.prev || "aim"; }
function toTitle() { for (const m of ["m-pause", "m-result", "m-set"]) $(m).classList.add("hidden"); G.state = "title"; G.cpu = null; G.demo = null; ui.show("title"); ui.title(); }
$("t-play").onclick = () => { audio.init(); audio.click(); startMatch("cpu"); };
$("t-practice").onclick = () => { audio.init(); audio.click(); startMatch("practice"); };
$("t-diff").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; G.diff = save.diff = +b.dataset.v; persist(); audio.init(); audio.tick2(); ui.title(); });
$("b-pause").onclick = () => pause();
$("p-resume").onclick = resume; $("p-title").onclick = toTitle;
$("p-restart").onclick = () => { $("m-pause").classList.add("hidden"); G.cpu = null; startMatch(G.mode); };
$("r-again").onclick = () => { $("m-result").classList.add("hidden"); startMatch(G.mode); };
$("r-title").onclick = toTitle;
$("banner").onclick = () => { if (G.state === "endscore" && G.endT > 1) afterEnd(); };
function openSettings() {
  $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100;
  $("st-guide").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === save.guide));
  $("m-set").classList.remove("hidden");
}
$("t-set").onclick = openSettings; $("p-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; audio.init(); audio.setMusic(save.music); persist(); };
$("st-guide").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.guide = b.dataset.v; persist(); $("st-guide").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ ?auto: both sides played by the AI
const bot = Q.has("auto");

// ------------------------------------------------------------------ boot
window.__curl = () => ({ log: G.log, state: G.state, mode: G.mode, end: G.end + 1, thrown: G.thrown, turn: G.turn, scores: G.scores, stones: G.stones.filter((s) => s.alive).map((s) => [s.team, +s.x.toFixed(2), +s.y.toFixed(2)]), fps });
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
  if (Q.has("auto") || Q.has("play")) startMatch(Q.get("mode") || "cpu");
}, 500);
