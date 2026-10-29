// NEBULA DRIVE — a rhythm highway through a nebula. Rendered with the projection3d library (Space, via GameSpace) +
// custom shaders + bloom. See DESIGN.md. music.js composes, synthesizes and charts each song; this file runs the
// clock, judging, input, the highway and space visuals, and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, MAT, clamp, lerp, blob, mulberry32 } from "./mesh.js";
import { SONGS, compose, makeChart, Synth } from "./music.js";

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
const synth = new Synth();
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > 3.2e6) dpr *= Math.sqrt(3.2e6 / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
space.setStatic(new Float32Array(4), new Float32Array(4), 0);

// ------------------------------------------------------------------ save
const DEF = { best: {}, volume: 0.8, music: 0.8, offset: 0, speed: 3, nofail: false, diff: "normal", song: 0 };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("nebuladrive.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("nebuladrive.save", JSON.stringify(save)); } catch { } };
synth.volume = save.volume; synth.music = save.music;

// ------------------------------------------------------------------ song state
const LANE_COL = [[1.0, 0.3, 0.65], [1.0, 0.72, 0.2], [0.2, 0.9, 1.0], [0.65, 0.4, 1.0]];
const LANE_W = 1.0, LEAD = 2.0;
const S = { state: "loading", si: 0, comp: null, chart: [], start: 0, perf0: 0, t: -2, score: 0, combo: 0, maxCombo: 0, mult: 1, energy: 0.6, od: 0, odT: 0, counts: [0, 0, 0, 0], held: [false, false, false, false], flash: [0, 0, 0, 0], bursts: [], pops: [], ended: false, endT: 0, demo: true };
let time = 0;
const V = () => 6 * save.speed;            // metres per second of note travel
function songTime() {
  if (synth.ok && !S.demo) return synth.ctx.currentTime - S.start - save.offset / 1000;
  return performance.now() / 1000 - S.perf0;
}
function loadSong(i, demo) {
  S.si = i; const song = SONGS[i];
  S.comp = compose(song); S.chart = makeChart(S.comp, demo ? "normal" : save.diff).map((n) => ({ ...n, judged: false, j: -1, holding: false, broken: false, done: false }));
  S.demo = demo; S.ended = false; S.endT = 0;
  Object.assign(S, { score: 0, combo: 0, maxCombo: 0, mult: 1, energy: 0.6, od: 0, odT: 0, counts: [0, 0, 0, 0], bursts: [], pops: [] });
  S.gates = []; S.lastBar = -1;
  if (!demo) {
    if (!Q.has("mute")) synth.init();
    if (synth.ctx) { synth.setMusic(save.music); S.start = synth.ctx.currentTime + 1.6; synth.play(S.comp, S.start); }
    S.perf0 = performance.now() / 1000 + 1.6;
  } else S.perf0 = performance.now() / 1000 - 6;
}
function startSong(i) { if (!Q.has("mute")) synth.init(); loadSong(i, false); S.state = "play"; ui.show("hud"); $("h-song").textContent = SONGS[i].name.toUpperCase(); $("h-diff").textContent = save.diff.toUpperCase(); }
function endSong(failed) {
  if (S.ended) return; S.ended = true; synth.stop();
  const n = S.chart.length, c = S.counts, acc = n ? (c[0] + c[1] * 0.7 + c[2] * 0.4) / n : 0;
  const grade = failed ? "F" : acc >= 0.95 ? "S" : acc >= 0.88 ? "A" : acc >= 0.78 ? "B" : acc >= 0.65 ? "C" : "D";
  const key = `${S.si}:${save.diff}`, prev = save.best[key];
  const isBest = !failed && (!prev || S.score > prev.score);
  if (isBest) { save.best[key] = { score: S.score, grade, acc: Math.round(acc * 1000) / 10 }; persist(); }
  $("r-k").textContent = failed ? "Signal lost" : "Track complete"; $("r-song").textContent = SONGS[S.si].name; $("r-grade").textContent = grade; $("r-grade").className = "g" + grade;
  $("r-score").textContent = S.score.toLocaleString(); $("r-acc").textContent = `${(acc * 100).toFixed(1)}% · max combo ${S.maxCombo}`;
  $("r-counts").innerHTML = ["PERFECT", "GREAT", "GOOD", "MISS"].map((l, i) => `<div><span>${l}</span><b>${c[i]}</b></div>`).join("");
  $("r-best").textContent = isBest ? "New best!" : prev ? `Best ${prev.score.toLocaleString()} (${prev.grade})` : "";
  setTimeout(() => { $("m-res").classList.remove("hidden"); S.state = "results"; }, failed ? 600 : 1500);
}

// ------------------------------------------------------------------ judging
const WIN = [0.045, 0.09, 0.14];
const JNAME = ["PERFECT", "GREAT", "GOOD", "MISS"], JCOL = [[0.6, 1, 1], [0.6, 1, 0.5], [1, 0.85, 0.4], [1, 0.3, 0.3]];
function judge(n, j) {
  n.judged = true; n.j = j; S.counts[j]++;
  if (j < 3) {
    S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
    S.mult = S.combo >= 50 ? 4 : S.combo >= 25 ? 3 : S.combo >= 10 ? 2 : 1;
    S.score += [300, 200, 100][j] * S.mult * (S.odT > 0 ? 2 : 1);
    S.energy = Math.min(1, S.energy + [0.03, 0.02, 0.01][j]);
    if (j === 0 && S.odT <= 0) S.od = Math.min(1, S.od + 0.025);
    burst(n.lane, j); synth.hit(j);
    if (n.dur > 0) n.holding = true; else n.done = true;
  } else {
    if (S.combo >= 10) popText("COMBO BREAK", [1, 0.4, 0.4]);
    S.combo = 0; S.mult = 1; S.energy -= 0.08; synth.miss(); n.done = true;
    if (S.energy <= 0 && !save.nofail && !S.demo) { S.energy = 0; endSong(true); }
  }
  popText(JNAME[j], JCOL[j], n.lane);
}
function press(lane) {
  S.held[lane] = true; S.flash[lane] = 1;
  if (S.state !== "play") return;
  const t = songTime();
  let best = null;
  for (const n of S.chart) { if (n.judged || n.lane !== lane) continue; const d = n.t - t; if (d > WIN[2]) break; if (Math.abs(d) <= WIN[2] && (!best || Math.abs(d) < Math.abs(best.t - t))) best = n; }
  if (best) { const d = Math.abs(best.t - t); judge(best, d <= WIN[0] ? 0 : d <= WIN[1] ? 1 : 2); }
}
function release(lane) {
  S.held[lane] = false;
  const t = songTime();
  for (const n of S.chart) if (n.holding && n.lane === lane) { n.holding = false; if (t < n.t + n.dur - 0.12) { n.broken = true; popText("DROPPED", [1, 0.5, 0.3], lane); S.combo = 0; S.mult = 1; } else { n.done = true; S.score += 100 * S.mult; } }
}
function overdrive() { if (S.state === "play" && S.od >= 0.5 && S.odT <= 0) { S.odT = (8 * S.comp.spb) * (S.od / 0.5); S.od = 0; synth.od(); popText("OVERDRIVE", [1, 0.85, 0.3]); } }

// ------------------------------------------------------------------ input
const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  synth.init();
  if (e.code in KEYS) { press(KEYS[e.code]); e.preventDefault(); }
  if (e.code === "Space") { overdrive(); e.preventDefault(); }
  if (e.code === "Escape" && S.state === "play") quit();
});
addEventListener("keyup", (e) => { if (e.code in KEYS) release(KEYS[e.code]); });
const touchLane = new Map();
canvas.addEventListener("pointerdown", (e) => { synth.init(); if (S.state !== "play") return; const lane = clamp(Math.floor((e.clientX / innerWidth) * 4), 0, 3); touchLane.set(e.pointerId, lane); press(lane); });
const endTouch = (e) => { if (touchLane.has(e.pointerId)) { release(touchLane.get(e.pointerId)); touchLane.delete(e.pointerId); } };
canvas.addEventListener("pointerup", endTouch); canvas.addEventListener("pointercancel", endTouch);
$("b-od").addEventListener("pointerdown", (e) => { e.stopPropagation(); overdrive(); });

// ------------------------------------------------------------------ update
function update(dt) {
  time += dt;
  if (!S.comp) return;
  const t = songTime(), len = S.comp.beats * S.comp.spb;
  // demo / autoplay: hit everything perfectly
  if (S.demo || bot) {
    for (const n of S.chart) {
      if (!n.judged && n.t <= t) { S.flash[n.lane] = 1; if (!S.demo) judge(n, 0); else { n.judged = true; n.j = 0; burst(n.lane, 0); if (n.dur > 0) n.holding = true; } }
      if (n.holding && t >= n.t + n.dur) { n.holding = false; n.done = true; if (!S.demo) S.score += 100 * S.mult; }
    }
    if (S.demo && t > len + 1) loadSong(S.si, true);
  }
  if (S.state === "play") {
    for (const n of S.chart) {
      if (!n.judged && t - n.t > WIN[2]) judge(n, 3);
      if (n.holding) { if (S.held[n.lane] || bot) { if (Math.random() < dt * 8) { S.score += 2 * S.mult; burst(n.lane, 0, 2); } } if (t >= n.t + n.dur) { n.holding = false; n.done = true; S.score += 100 * S.mult; } }
    }
    if (S.odT > 0) S.odT -= dt;
    if (t > len + 0.8) endSong(false);
  }
  // downbeat gates fly toward the strike line and arrive on the next bar
  const bar = Math.floor((t / S.comp.spb) / 4);
  if (bar !== S.lastBar) { S.lastBar = bar; S.gates.push({ t: (bar + 1) * 4 * S.comp.spb + LEAD * 0 }); }
  S.gates = S.gates.filter((g) => g.t > t - 0.5);
  for (let i = 0; i < 4; i++) S.flash[i] = Math.max(S.held[i] ? 0.6 : 0, S.flash[i] - dt * 4);
  for (const b of S.bursts) { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= 8 * dt; b.life -= dt; }
  S.bursts = S.bursts.filter((b) => b.life > 0);
  for (const p of S.pops) p.life -= dt; S.pops = S.pops.filter((p) => p.life > 0);
  ui.frame(t);
}
function burst(lane, j, n = 14) {
  const c = j === 0 ? LANE_COL[lane] : JCOL[j], x = laneX(lane);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 1 + Math.random() * 4; S.bursts.push({ x: x + roadX(0), y: 0, z: 0.25, vx: Math.cos(a) * v * 0.5, vy: Math.abs(Math.sin(a)) * v, vz: 1.5 + Math.random() * 3, life: 0.4 + Math.random() * 0.4, c }); }
  if (n > 5) S.bursts.push({ ring: true, lane, life: 0.35, x, y: 0, z: 0.05, vx: 0, vy: 0, vz: 0, c });
}
function popText(text, col, lane) { S.pops = S.pops.filter((p) => p.lane !== lane || lane === undefined); S.pops.push({ text, col, lane, life: 0.6 }); ui.pop(text, col, lane); }

// ------------------------------------------------------------------ highway geometry
const laneX = (lane) => (lane - 1.5) * LANE_W;
function scrollS() { return Math.max(0, songTime()) * V(); }
const curveX = (s) => 6 * Math.sin(s * 0.006) + 3 * Math.sin(s * 0.017 + 1);
const curveZ = (s) => 2.2 * Math.sin(s * 0.009 + 2);
function roadX(y) { const s = scrollS(); return curveX(s + y) - curveX(s) - (curveX(s + 1) - curveX(s)) * y * 0.0; }
function roadZ(y) { const s = scrollS(); return curveZ(s + y) - curveZ(s); }

// ------------------------------------------------------------------ camera
const cam = { E: [0, -5, 3], T: [0, 14, 0] };
function beatPhase() { const t = songTime(); if (!S.comp || t < 0) return 0; const b = t / S.comp.spb; return Math.pow(1 - (b - Math.floor(b)), 3); }
function updateCamera(dt) {
  const p = beatPhase(), sway = Math.sin(songTime() / (S.comp ? S.comp.spb : 0.5) * Math.PI) * 0.06;
  const ahead = 14, E = [sway + roadX(-6) * 0.6, -6.4, 3.4 + roadZ(-6) * 0.5 + p * 0.03], T = [roadX(ahead) * 0.6, ahead, roadZ(ahead) * 0.6 - 1.5];
  const k = Math.min(1, dt * 5);
  cam.E = cam.E.map((v, i) => lerp(v, E[i], k)); cam.T = cam.T.map((v, i) => lerp(v, T[i], k));
  space.magnifier = (1.75 - p * 0.03) * 1.6;
  space.lookAt(cam.E[0], cam.E[1], cam.E[2], cam.T[0], cam.T[1], cam.T[2]);
  space.roll ? space.roll((roadX(30) - roadX(20)) * 0.04) : 0;
}

// ------------------------------------------------------------------ dynamic geometry
const D = new Mesh(60000), R = new Mesh(20000), A = new Mesh(60000), dyn = new Mesh(160000);
function ribbon(M, p0, p1, w, c0, c1) {
  const E = cam.E, d = sub(p1, p0), v = nrm(sub(p0, E)), s = nrm(cross(d, v));
  M.quad4([p0[0] - s[0] * w, p0[1] - s[1] * w, p0[2] - s[2] * w], [p0[0] + s[0] * w, p0[1] + s[1] * w, p0[2] + s[2] * w], [p1[0] + s[0] * w, p1[1] + s[1] * w, p1[2] + s[2] * w], [p1[0] - s[0] * w, p1[1] - s[1] * w, p1[2] - s[2] * w], c0, c0, c1, c1, MAT.ADD);
}
function gem(x, y, z, s, col, glow) {
  // an octahedron stretched along y, with a ring of facets
  const top = [x, y, z + s * 0.75], bot = [x, y, z - s * 0.2], N = 6, R0 = s * 0.55;
  const rim = Array.from({ length: N }, (_, i) => { const a = (i / N) * TAU + Math.PI / 6; return [x + Math.cos(a) * R0, y + Math.sin(a) * R0 * 0.6, z + s * 0.2]; });
  for (let i = 0; i < N; i++) { const a = rim[i], b = rim[(i + 1) % N]; for (const tri of [[top, a, b], [bot, b, a]]) for (const p of tri) D.v(p[0], p[1], p[2], glow, col[0], col[1], col[2], MAT.GEM); }
}
const planets = [{ a: 0.6, d: 900, z: 120, r: 160, col: [0.7, 0.45, 0.8], ring: true }, { a: -0.9, d: 1400, z: -60, r: 260, col: [0.3, 0.55, 0.8], ring: false }, { a: 2.6, d: 1100, z: 260, r: 90, col: [0.9, 0.6, 0.4], ring: true }];
const stars = Array.from({ length: 220 }, () => ({ x: (Math.random() - 0.5) * 120, y: Math.random() * 300, z: (Math.random() - 0.3) * 60 }));
const rocks = Array.from({ length: 26 }, (_, i) => { const r = mulberry32(i + 5); return { x: (r() < 0.5 ? -1 : 1) * (14 + r() * 40), y: r() * 400, z: (r() - 0.5) * 30, s: 1 + r() * 4, rot: r() * 6 }; });
function buildDynamic() {
  D.reset(); R.reset(); A.reset(); dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
  if (!S.comp) { space.setDynamic(dyn.pos, dyn.col, dyn.n); return { oD: 6, nD: 0, oR: 6, nR: 0, oA: 6, nA: 0 }; }
  const t = songTime(), v = V(), pal = SONGS[S.si].pal, beat = beatPhase();
  // planets far away, slowly drifting
  for (const p of planets) { const a = p.a + time * 0.002, x = Math.sin(a) * p.d, y = Math.cos(a) * p.d * 0.5 + 800, c = [x, y, p.z]; blob(D, c, p.r, p.r, p.r, p.col, MAT.PLANET, 28, 16); if (p.ring) for (let i = 0; i < 48; i++) { const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU; for (const [r0, r1, k] of [[1.35, 1.7, 0.18], [1.75, 2.1, 0.1]]) A.quad([c[0] + Math.cos(a0) * p.r * r0, c[1] + Math.sin(a0) * p.r * r0 * 0.3, c[2] + Math.sin(a0) * p.r * r0 * 0.25], [c[0] + Math.cos(a1) * p.r * r0, c[1] + Math.sin(a1) * p.r * r0 * 0.3, c[2] + Math.sin(a1) * p.r * r0 * 0.25], [c[0] + Math.cos(a1) * p.r * r1, c[1] + Math.sin(a1) * p.r * r1 * 0.3, c[2] + Math.sin(a1) * p.r * r1 * 0.25], [c[0] + Math.cos(a0) * p.r * r1, c[1] + Math.sin(a0) * p.r * r1 * 0.3, c[2] + Math.sin(a0) * p.r * r1 * 0.25], p.col.map((q) => q * k), MAT.ADD); } }
  // asteroids drifting past
  const sc = scrollS();
  for (const r of rocks) { const y = ((r.y - sc * 0.6) % 400 + 400) % 400 - 20; blob(D, [r.x, y, r.z], r.s * 1.3, r.s, r.s * 0.8, [0.3, 0.28, 0.32], MAT.ROCK, 6, 4); }
  // star streaks, speeding with the tempo
  for (const st of stars) { const y = ((st.y - sc * 1.5) % 300 + 300) % 300 - 10, k = 0.25 + beat * 0.3; ribbon(A, [st.x, y, st.z], [st.x, y + 1.5 + v * 0.08, st.z], 0.03, [k, k, k * 1.2], [0, 0, 0]); }
  // the road: a strip from behind the strike line to the horizon
  const NY = 70, Y0 = -8, Y1 = 150;
  for (let j = 0; j < NY; j++) {
    const ya = Y0 + (j / NY) * (Y1 - Y0), yb = Y0 + ((j + 1) / NY) * (Y1 - Y0), xa = roadX(ya), xb = roadX(yb), za = roadZ(ya), zb = roadZ(yb);
    for (let i = 0; i < 6; i++) {
      const u0 = -2.2 + (i / 6) * 4.4, u1 = -2.2 + ((i + 1) / 6) * 4.4;
      R.v(xa + u0 * LANE_W, ya, za, u0, 1, 1, 1, MAT.ROAD); R.v(xa + u1 * LANE_W, ya, za, u1, 1, 1, 1, MAT.ROAD); R.v(xb + u1 * LANE_W, yb, zb, u1, 1, 1, 1, MAT.ROAD);
      R.v(xa + u0 * LANE_W, ya, za, u0, 1, 1, 1, MAT.ROAD); R.v(xb + u1 * LANE_W, yb, zb, u1, 1, 1, 1, MAT.ROAD); R.v(xb + u0 * LANE_W, yb, zb, u0, 1, 1, 1, MAT.ROAD);
    }
  }
  // receptors at the strike line
  for (let l = 0; l < 4; l++) {
    const x = laneX(l) + roadX(0), c = LANE_COL[l], f = S.flash[l], N = 20, r = 0.36;
    for (let i = 0; i < N; i++) { const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU, k = 0.35 + f * 1.2; A.quad([x + Math.cos(a0) * r, Math.sin(a0) * r * 0.5, 0.02], [x + Math.cos(a1) * r, Math.sin(a1) * r * 0.5, 0.02], [x + Math.cos(a1) * (r + 0.06), Math.sin(a1) * (r + 0.06) * 0.5, 0.02], [x + Math.cos(a0) * (r + 0.06), Math.sin(a0) * (r + 0.06) * 0.5, 0.02], c.map((q) => q * k), MAT.ADD); }
    if (f > 0.05) A.sprite(x, 0, 0.3, 0.9, c[0] * f * 0.5, c[1] * f * 0.5, c[2] * f * 0.5);
  }
  // notes
  const horizon = (Y1 - 5) / v;
  for (const n of S.chart) {
    if (n.t - t > horizon) break;
    if (n.done && !n.holding) continue;
    if (n.j === 3) continue;
    const y = (n.t - t) * v, c = LANE_COL[n.lane], gold = S.odT > 0 ? [1, 0.85, 0.35] : c;
    if (n.dur > 0) {
      const y1 = Math.min(Y1, (n.t + n.dur - t) * v), y0 = n.holding ? 0 : y;
      if (y1 > y0 && !n.broken) { const segs = Math.max(1, Math.ceil((y1 - y0) / 3)); for (let k = 0; k < segs; k++) { const ya = y0 + ((y1 - y0) * k) / segs, yb = y0 + ((y1 - y0) * (k + 1)) / segs, x = laneX(n.lane); const w = n.holding ? 0.17 : 0.12, kk = n.holding ? 0.7 : 0.35; A.quad([x + roadX(ya) - w, ya, roadZ(ya) + 0.06], [x + roadX(ya) + w, ya, roadZ(ya) + 0.06], [x + roadX(yb) + w, yb, roadZ(yb) + 0.06], [x + roadX(yb) - w, yb, roadZ(yb) + 0.06], gold.map((q) => q * kk), MAT.ADD); } }
    }
    if (!n.judged) { const x = laneX(n.lane) + roadX(y), z = roadZ(y) + 0.28 + Math.sin(time * 6 + n.t) * 0.03; gem(x, y, z, 0.42, gold, 0.4 + (y < 3 ? 0.6 : 0)); A.sprite(x, y, z, 0.8, gold[0] * 0.18, gold[1] * 0.18, gold[2] * 0.18); }
  }
  // beat gates: rings that reach the strike line on each bar
  for (const g of S.gates) {
    const y = (g.t - t) * v; if (y < -2 || y > Y1) continue;
    const x0 = roadX(y), z0 = roadZ(y) + 1.4, N = 36, R = 3.8, k = 0.25 * (1 - y / Y1);
    for (let i = 0; i < N; i++) { const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU; A.quad([x0 + Math.cos(a0) * R, y, z0 + Math.sin(a0) * R], [x0 + Math.cos(a1) * R, y, z0 + Math.sin(a1) * R], [x0 + Math.cos(a1) * (R + 0.12), y, z0 + Math.sin(a1) * (R + 0.12)], [x0 + Math.cos(a0) * (R + 0.12), y, z0 + Math.sin(a0) * (R + 0.12)], pal[(i >> 2) % 3].map((q) => q * k), MAT.ADD); }
  }
  // bursts
  for (const b of S.bursts) {
    const k = b.life * 2;
    if (b.ring) { const r = 0.4 + (0.35 - b.life) * 4, x = b.x + roadX(0), N = 24; for (let i = 0; i < N; i++) { const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU; A.quad([x + Math.cos(a0) * r, Math.sin(a0) * r * 0.5, 0.05], [x + Math.cos(a1) * r, Math.sin(a1) * r * 0.5, 0.05], [x + Math.cos(a1) * (r + 0.08), Math.sin(a1) * (r + 0.08) * 0.5, 0.05], [x + Math.cos(a0) * (r + 0.08), Math.sin(a0) * (r + 0.08) * 0.5, 0.05], b.c.map((q) => q * k), MAT.ADD); } }
    else A.sprite(b.x, b.y, b.z, 0.06, b.c[0] * k, b.c[1] * k, b.c[2] * k);
  }
  const oD = 6; dyn.append(D); const oR = dyn.n; dyn.append(R); const oA = dyn.n; dyn.append(A);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  return { oD, nD: oR - oD, oR, nR: oA - oR, oA, nA: dyn.n - oA };
}

function render(dt) {
  updateCamera(dt);
  const o = buildDynamic(), pal = SONGS[S.si].pal;
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height);
  gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time); gl.uniform1f(U.uBeat, beatPhase()); gl.uniform1f(U.uScroll, scrollS()); gl.uniform1f(U.uOD, S.odT > 0 ? 1 : 0);
  gl.uniform3fv(U.uPalA, pal[0]); gl.uniform3fv(U.uPalB, pal[1]); gl.uniform3fv(U.uPalC, pal[2]);
  gl.uniform3f(U.uLaneFlash, S.flash[0], S.flash[1], S.flash[2]); gl.uniform1f(U.uLaneFlash3, S.flash[3]);
  space.applyCamera();
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  space.bind(true); space.draw(o.oD, o.nD);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
  space.draw(o.oR, o.nR); space.draw(o.oA, o.nA);
  gl.disable(gl.BLEND); gl.depthMask(true);
  post.end({ time, under: 0, fade: 1, hurt: S.odT > 0 ? 0.15 + beatPhase() * 0.2 : 0 });
}

// ------------------------------------------------------------------ UI
const ui = {
  show(w) { for (const id of ["title", "hud"]) $(id).classList.toggle("hidden", id !== w); },
  songs() {
    $("songs").innerHTML = SONGS.map((s, i) => {
      const len = compose(s).beats * (60 / s.bpm), b = save.best[`${i}:${save.diff}`];
      return `<button class="song ${i === save.song ? "on" : ""}" data-i="${i}" style="--a:rgb(${s.pal[0].map((v) => Math.round(v * 255))});--b:rgb(${s.pal[1].map((v) => Math.round(v * 255))})"><b>${s.name}</b><span>${s.bpm} BPM · ${Math.floor(len / 60)}:${String(Math.round(len % 60)).padStart(2, "0")}</span><em class="g${b ? b.grade : ""}">${b ? b.grade : "–"}</em></button>`;
    }).join("");
    $("songs").querySelectorAll(".song").forEach((b) => b.addEventListener("click", () => { synth.init(); save.song = +b.dataset.i; persist(); ui.songs(); loadSong(save.song, true); }));
    $("diff").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === save.diff));
  },
  frame(t) {
    if (S.state !== "play") return;
    $("h-score").textContent = S.score.toLocaleString(); $("h-combo").textContent = S.combo > 2 ? S.combo : ""; $("h-mult").textContent = S.mult > 1 ? `×${S.mult}` : "";
    $("energy-i").style.width = S.energy * 100 + "%"; $("energy").classList.toggle("low", S.energy < 0.25);
    $("od-i").style.width = (S.odT > 0 ? (S.odT / (8 * S.comp.spb)) : S.od) * 100 + "%"; $("od").classList.toggle("ready", S.od >= 0.5 && S.odT <= 0); $("od").classList.toggle("active", S.odT > 0);
    $("prog-i").style.width = clamp(t / (S.comp.beats * S.comp.spb), 0, 1) * 100 + "%";
    $("countdown").textContent = t < 0 ? Math.ceil(-t) : "";
  },
  pop(text, col, lane) {
    const el = document.createElement("div"); el.className = "jpop"; el.textContent = text; el.style.color = `rgb(${col.map((v) => Math.round(v * 255))})`;
    el.style.left = lane === undefined ? "50%" : `${(lane + 0.5) * 25}%`; $("pops").appendChild(el); setTimeout(() => el.remove(), 650);
  },
};
function quit() { synth.stop(); S.ended = true; toTitle(); }
function toTitle() { $("m-res").classList.add("hidden"); S.state = "title"; ui.show("title"); ui.songs(); loadSong(save.song, true); }
$("t-play").onclick = () => { synth.init(); startSong(save.song); };
$("diff").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.diff = b.dataset.v; persist(); ui.songs(); });
$("b-quit").onclick = quit;
$("r-again").onclick = () => { $("m-res").classList.add("hidden"); startSong(S.si); };
$("r-next").onclick = () => { $("m-res").classList.add("hidden"); save.song = (S.si + 1) % SONGS.length; persist(); startSong(save.song); };
$("r-title").onclick = toTitle;
function openSettings() { $("st-vol").value = save.volume * 100; $("st-mus").value = save.music * 100; $("st-off").value = save.offset; $("st-off-v").textContent = `${save.offset} ms`; $("st-spd").value = save.speed; $("st-spd-v").textContent = save.speed; $("st-nf").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (save.nofail ? "1" : "0"))); $("m-set").classList.remove("hidden"); }
$("t-set").onclick = openSettings; $("st-close").onclick = () => $("m-set").classList.add("hidden");
$("st-vol").oninput = (e) => { save.volume = e.target.value / 100; synth.init(); synth.setVolume(save.volume); persist(); };
$("st-mus").oninput = (e) => { save.music = e.target.value / 100; synth.init(); synth.setMusic(save.music); persist(); };
$("st-off").oninput = (e) => { save.offset = +e.target.value; $("st-off-v").textContent = `${save.offset} ms`; persist(); };
$("st-spd").oninput = (e) => { save.speed = +e.target.value; $("st-spd-v").textContent = save.speed; persist(); };
$("st-nf").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.nofail = b.dataset.v === "1"; persist(); $("st-nf").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

// ------------------------------------------------------------------ boot
const bot = Q.has("auto");
if (Q.has("diff")) save.diff = Q.get("diff");
window.__beats = () => ({ state: S.state, song: SONGS[S.si].name, t: +songTime().toFixed(2), notes: S.chart.length, score: S.score, combo: S.combo, counts: S.counts, energy: +S.energy.toFixed(2), fps });
let last = performance.now(), fps = 0, fN = 0, fT = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
  update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
loadSong(save.song, true);
requestAnimationFrame(frame);
setTimeout(() => {
  $("loading").classList.add("out"); S.state = "title"; ui.show("title"); ui.songs();
  if (bot || Q.has("song")) { save.song = clamp(+(Q.get("song") || 1) - 1, 0, SONGS.length - 1); startSong(save.song); }
}, 400);
