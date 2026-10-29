// SARATOGA GP — a three-lap race around Suzuka (2001) in 1960 Chrysler Saratogas. See DESIGN.md.
// Rendered with Space.js (via GameSpace) + textured shaders + post chain. gltex.js loads the built GLBs, collide.js
// turns the track's own triangles into ground and walls, car.js drives, ai.js holds the racing line and the AI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, clamp } from "./mesh.js";
import { loadTexturedGLB } from "./gltex.js";
import { buildCollision, GRASS, GRAVEL } from "./collide.js";
import { carGeometry, makeCar, stepCar, fitsPose, collideCars, MX } from "./car.js";
import { makeLine, trackProgress, aiInput } from "./ai.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const Q = new URLSearchParams(location.search), AUTO = Q.has("auto"), PROF = Q.has("prof");
const PLAYER_SLOT = 4;
// race length: 1, 3 or 5 laps, chosen on the menu and remembered
let LAPS = 3;
try { LAPS = [1, 3, 5].includes(+localStorage.getItem("saratoga-gp-laps")) ? +localStorage.getItem("saratoga-gp-laps") : 3; } catch (e) {}

// ------------------------------------------------------------------ GL setup
const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
const MAX_ANISO = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
// render resolution cap (pixels); lowered automatically while frames run slow (see adaptRes)
const PX_MAX = 2.6e6, PX_MIN = 0.8e6;
let pxCap = PX_MAX, pxBad = Infinity;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
function makeTexture(img) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, MAX_ANISO);
  return t;
}
// a 1×1 white texture for untextured draws, so the sampler never reads the post-process target (feedback loop)
const white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

// ------------------------------------------------------------------ material classes (by name, DESIGN.md §3–4)
// track surfaces: ground for the wheels (either facing), never walls
const SURFACE = /ROAD|RMBL|GRASS|GRVL|PITROAD|groove|skid|RDCP|RDLT|GRLT|green|SAND|logo_.*grass|^grid$/i;
const SURF_GRAVEL = /GRVL|SAND|GREEN03/i, SURF_GRASS = /GRASS|green|logo_.*grass/i;
// scenery that is neither ground nor worth a wall test near the track (its tops are not floors)
const NOT_FLOOR = /TREE|SHRUB|LAMP|POLE|STANG|marshall|cameraman|LIGHTIN|DIANTA|CRANE|ZHUANPAN|TrafficLight|HORN/i;
const NOT_WALL = /TREE_SHADOW|skid|SKID|groove/i;
// small trackside detail (marshals, poles, lights, signs, crews, skid marks): drawn only within 300 m
const DETAIL = /marshall|cameraman|POLE|STANG|LIGHTIN|TrafficLight|LAMP|HORN|skid|SKID|NODE|flag|BOX\d|GREY|RDLT|GRLT|BLACKCASE|tiesiwang|TIESIWANG|^\d{3}$/i;

// ------------------------------------------------------------------ loading
let groups = [], world = null, line = null, G = null, carParts = null;
async function load() {
  const prog = (a, b) => (k) => ($("ld-bar").style.width = Math.round((a + (b - a) * k) * 100) + "%");
  $("ld-msg").textContent = "Loading the circuit…";
  const [track, carInfo, lineData] = await Promise.all([loadTexturedGLB("assets/suzuka.glb", prog(0, 0.8)), fetch("assets/car.json").then((r) => r.json()), fetch("assets/line.json").then((r) => r.json())]);
  $("ld-msg").textContent = "Loading the cars…";
  const carGLB = await loadTexturedGLB("assets/saratoga.glb", prog(0.8, 0.9));
  $("ld-msg").textContent = "Building the walls…"; await new Promise((r) => setTimeout(r, 30));
  const tex = track.images.map((im) => (im ? makeTexture(im) : null));
  const foliage = { tree: makeTexture(drawTree()), shadow: makeTexture(drawBlob()) };
  for (const g of track.groups) {
    // the model's tree cards lost their textures: they get a drawn tree (alpha-tested) and a soft shadow blob
    const name = g.mat.name, shadow = /TREE_SHADOW/i.test(name), tree = !shadow && /TREE|SHRUB/i.test(name), mode = 0;
    const kind = g.mat.alphaMode === "BLEND" || shadow ? "blend" : g.mat.alphaMode === "MASK" || tree ? "cut" : "solid";
    const { pos, c4, nrm, uv, tiles } = tileGroup(g);
    groups.push({ name, kind, mode, n: g.n, tiles, far: DETAIL.test(name) ? 300 : 1200, tex: tree ? foliage.tree : shadow ? foliage.shadow : g.mat.image !== null ? tex[g.mat.image] : null, pb: buf(pos), cb: buf(c4), nb: buf(nrm), ub: buf(uv), raw: g.pos });
  }
  const rank = { solid: 0, cut: 1, blend: 2 };
  groups.sort((a, b) => rank[a.kind] - rank[b.kind]);
  // collision near the track only: 10 m cells within ~45 m of the racing line
  const near = new Set(), NC = 10;
  for (const p of lineData.pts) for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) near.add(Math.floor(p[0] / NC + dx) + "," + Math.floor(p[1] / NC + dy));
  world = buildCollision(groups.map((g) => ({ pos: g.raw, ground: !NOT_FLOOR.test(g.name), twoSided: SURFACE.test(g.name), walls: !SURFACE.test(g.name) && !NOT_WALL.test(g.name), surf: SURF_GRAVEL.test(g.name) ? GRAVEL : SURF_GRASS.test(g.name) ? GRASS : 0 })), (x, y) => near.has(Math.floor(x / NC) + "," + Math.floor(y / NC)));
  for (const g of groups) delete g.raw;
  line = makeLine(lineData, world);
  // the car: body (paint), glass, four wheels (bones 1–4)
  G = carGeometry(carInfo);
  const ctex = carGLB.images.map((im) => (im ? makeTexture(im) : null));
  carParts = carGLB.groups.map((g) => {
    const name = g.mat.name, wi = /^wheel(\d)/.exec(name), bone = wi ? 1 + +wi[1] : 0, mat = name === "body" ? 2 : name === "glass" ? 2 : 0;
    const pos = new Float32Array(g.n * 4), c4 = new Float32Array(g.n * 4);
    for (let i = 0; i < g.n; i++) { pos.set([g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], 1000 + bone], i * 4); c4.set([1, 1, 1, mat], i * 4); }
    return { name, blend: name === "glass", tint: name === "body", n: g.n, tex: g.mat.image !== null ? ctex[g.mat.image] : white, pb: buf(pos), cb: buf(c4), nb: buf(g.nrm), ub: buf(g.uv) };
  });
  // wheel centres (bones) from car.json; front wheels are the ones ahead of centre (+y)
  wheels = carInfo.wheels.map((w) => ({ ...w, front: w.y > 0 }));
  drawMap();
  setupRace();
  $("loading").classList.add("out"); $("hud").classList.remove("hide");
  state = "menu"; $("menu").classList.remove("hide"); $("go").focus();
  if (AUTO) startRace();
}
let wheels = [];

// a tree for the textureless cards: canopy blobs speckled with leaves over a trunk, transparent around it (the card's
// UVs run 0..1 across and 0..−1 down, so v = 0 is the top of the image)
function drawTree() {
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#5a4130"; g.fillRect(S * 0.47, S * 0.55, S * 0.06, S * 0.45);
  for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.3, x = S * (0.5 + Math.cos(a) * r), y = S * (0.4 + Math.sin(a) * r * 0.85), R = S * (0.09 + rnd() * 0.08);
    const k = 0.65 + rnd() * 0.45; g.fillStyle = `rgb(${Math.round(200 * k)},${Math.round(235 * k)},${Math.round(190 * k)})`; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill(); }
  // leaf speckle: lighter on top, darker below
  for (let i = 0; i < 2600; i++) { const x = rnd() * S, y = rnd() * S * 0.8, k = 0.55 + rnd() * 0.6 - (y / S) * 0.3; g.fillStyle = `rgba(${Math.round(210 * k)},${Math.round(240 * k)},${Math.round(200 * k)},0.9)`; g.globalCompositeOperation = "source-atop"; g.fillRect(x, y, 3, 3); }
  return c;
}
function drawBlob() {
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return c;
}

// spatial tiles: each material's triangles are reordered by 100 m tile (by centroid), so a frame draws only the tiles
// in view — the whole circuit is ~1 M vertices, too many to push every frame
const TILE = 100;
function tileGroup(g) {
  const nt = g.n / 3, key = new Int32Array(nt), order = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) { const o = t * 9, cx = (g.pos[o] + g.pos[o + 3] + g.pos[o + 6]) / 3, cy = (g.pos[o + 1] + g.pos[o + 4] + g.pos[o + 7]) / 3; key[t] = (Math.floor(cy / TILE) + 500) * 1000 + Math.floor(cx / TILE) + 500; order[t] = t; }
  order.sort((a, b) => key[a] - key[b]);
  const pos = new Float32Array(g.n * 4), c4 = new Float32Array(g.n * 4), nrm = new Float32Array(g.n * 3), uv = new Float32Array(g.n * 2), tiles = [];
  let cur = null;
  for (let k = 0; k < nt; k++) {
    const t = order[k];
    if (!cur || cur.key !== key[t]) { cur = { key: key[t], first: k * 3, count: 0, mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] }; tiles.push(cur); }
    for (let j = 0; j < 3; j++) {
      const src = t * 3 + j, dst = k * 3 + j;
      for (let a = 0; a < 3; a++) { const v = g.pos[src * 3 + a]; pos[dst * 4 + a] = v; if (v < cur.mn[a]) cur.mn[a] = v; if (v > cur.mx[a]) cur.mx[a] = v; nrm[dst * 3 + a] = g.nrm[src * 3 + a]; c4[dst * 4 + a] = g.col[src * 4 + a]; }
      pos[dst * 4 + 3] = 1; c4[dst * 4 + 3] = 0; uv[dst * 2] = g.uv[src * 2]; uv[dst * 2 + 1] = g.uv[src * 2 + 1];
    }
    cur.count += 3;
  }
  for (const T of tiles) { T.c = T.mn.map((v, a) => (v + T.mx[a]) / 2); T.r = Math.hypot(T.mx[0] - T.mn[0], T.mx[1] - T.mn[1], T.mx[2] - T.mn[2]) / 2; }
  return { pos, c4, nrm, uv, tiles };
}
// view test for a tile's bounding sphere (set up once per frame from the camera)
const view = { e: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], kx: 1, ky: 1 };
function setupCull() {
  const k = space.magnifier / 1.6, asp = canvas.width / canvas.height;
  Object.assign(view, { e: [space.Xc, space.Yc, space.Zc], x: space.xUnitVec, y: space.yUnitVec, z: space.zUnitVec, kx: 1 / k, ky: 1 / (k * asp) });
  view.sx = Math.sqrt(1 + view.kx * view.kx); view.sy = Math.sqrt(1 + view.ky * view.ky);
}
function inView(T, far) {
  const vx = T.c[0] - view.e[0], vy = T.c[1] - view.e[1], vz = T.c[2] - view.e[2], r = T.r;
  const d = vx * view.z[0] + vy * view.z[1] + vz * view.z[2];
  if (d < -r || d > far + r) return false;
  if (Math.abs(vx * view.x[0] + vy * view.x[1] + vz * view.x[2]) > d * view.kx + r * view.sx) return false;
  if (Math.abs(vx * view.y[0] + vy * view.y[1] + vz * view.y[2]) > d * view.ky + r * view.sy) return false;
  return true;
}
let drawnVerts = 0;

// ------------------------------------------------------------------ race setup
const ROSTER = [
  { name: "Vega", tint: [0.82, 0.1, 0.08], alat: 14.4, pace: 1.0 },
  { name: "Okada", tint: [0.95, 0.78, 0.2], alat: 14.0, pace: 0.99 },
  { name: "Marlow", tint: [0.1, 0.1, 0.12], alat: 13.6, pace: 0.98 },
  { name: "Duarte", tint: [0.16, 0.26, 0.62], alat: 13.2, pace: 0.97 },
  { name: "You", tint: null },
  { name: "Lindqvist", tint: [0.92, 0.5, 0.62], alat: 12.6, pace: 0.96 },
];
let cars = [], player = null, raceT = 0, countT = 0, goAt = 0, state = "loading", lapStart = 0, lastLap = null, bestLap = null, finishOrder = [];
function placeOnLine(c, d, lat) {
  const p = line.at(d, lat), g = world.ground(p.x, p.y, p.z + 1.5);
  Object.assign(c, { x: p.x, y: p.y, z: g ?? p.z, h: p.h, v: 0, slip: 0, steer: 0 });
}
function setupRace() {
  cars = ROSTER.map((r, k) => {
    const c = makeCar(0, 0, 0, 0);
    Object.assign(c, { name: r.name, tint: r.tint, ai: !!r.tint || AUTO, alat: r.alat ?? 13.8, pace0: r.pace ?? 0.97, pace: r.pace ?? 0.97, lane: 0, finished: 0, lapsDone: 0, stuckT: 0 });
    c.speeds = line.speeds(c.alat);
    // grid: two staggered columns behind the start line
    const d = -12 - k * 9, side = k % 2 ? -1 : 1, i = line.nearest(line.at(d).x, line.at(d).y, line.at(d).z);
    placeOnLine(c, d, side * Math.min(3, (side > 0 ? line.wl[i] : line.wr[i]) - 1.5));
    c.li = undefined; c.prevS = undefined; trackProgress(line, c);
    if (c.prevS > line.len / 2) { c.lapsDone = -1; c.dist = c.prevS - line.len; }
    c.lane = side * 1.2; c.laneNow = c.lane; c.lastDist = c.dist;
    return c;
  });
  player = cars[PLAYER_SLOT];
  raceT = 0; countT = 0; lastLap = bestLap = null; finishOrder = [];
  cam.snap = true;
}
function startRace() {
  $("menu").classList.add("hide"); $("results").classList.add("hide");
  audio.init();
  setupRace();
  state = "count"; countT = 0; goAt = 5.6 + Math.random() * 0.9;
  $("lights").classList.remove("hide", "go"); [...$("lights").children].forEach((i) => i.classList.remove("on"));
}
function respawn(c) {
  const d = ((c.dist % line.len) + line.len) % line.len;
  placeOnLine(c, d, 0); c.laneNow = 0; c.stuckT = 0; cam.snap = c === player || cam.snap;
}

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  keys.add(e.code); audio.init();
  if (e.repeat) return;
  if (e.code === "Enter" && (state === "menu" || state === "done")) startRace();
  if (e.code === "KeyH") $("help").classList.toggle("hide");
  if (e.code === "KeyC") toggleView();
  if (e.code === "KeyM") audio.mute();
  if (e.code === "KeyR" && (state === "race" || state === "done") && !player.finished) respawn(player);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
$("go").addEventListener("click", startRace); $("again").addEventListener("click", startRace);
const showLaps = () => document.querySelectorAll(".seg").forEach((b) => b.setAttribute("aria-checked", +b.dataset.laps === LAPS));
document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => { LAPS = +b.dataset.laps; showLaps(); try { localStorage.setItem("saratoga-gp-laps", LAPS); } catch (e) {} }));
showLaps();
const touch = { gas: false, brake: false, left: false, right: false };
for (const [id, k] of [["t-gas", "gas"], ["t-brake", "brake"], ["t-left", "left"], ["t-right", "right"]]) {
  const el = $(id); el.addEventListener("pointerdown", (e) => { audio.init(); touch[k] = true; e.preventDefault(); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, () => (touch[k] = false));
}
$("t-cam").addEventListener("pointerdown", (e) => { toggleView(); e.preventDefault(); });
function playerInput() {
  if (player.ai || player.finished) return aiInput(line, player, cars, 1 / 60, G);
  const k = keys, t = touch;
  return {
    gas: k.has("KeyW") || k.has("ArrowUp") || t.gas ? 1 : 0,
    brake: k.has("KeyS") || k.has("ArrowDown") || t.brake ? 1 : 0,
    steer: clamp((k.has("KeyA") || k.has("ArrowLeft") || t.left ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") || t.right ? 1 : 0), -1, 1),
    hand: k.has("Space"),
  };
}

// ------------------------------------------------------------------ simulation
const NONE = { gas: 0, brake: 0, steer: 0, hand: false };
function simulate(dt) {
  if (state === "count") {
    countT += dt;
    const on = Math.min(5, Math.floor(countT));
    [...$("lights").children].forEach((el, i) => { const was = el.classList.contains("on"); el.classList.toggle("on", i < on && countT < goAt); if (!was && i < on && countT < goAt) audio.beep(440, 0.12); });
    if (countT >= goAt) { state = "race"; raceT = 0; lapStart = 0; $("lights").classList.add("go"); audio.beep(880, 0.35); banner("GO!", 1.2); setTimeout(() => $("lights").classList.add("hide"), 1200); }
  }
  const racing = state === "race" || state === "done";
  if (racing) raceT += dt;
  // rubber band: AI far ahead of the player ease off a little, far behind push a little
  for (const c of cars) if (c !== player) { let gap = c.dist - player.dist; c.pace = c.pace0 * (gap > 150 ? 0.96 : gap < -150 ? 1.04 : 1); c.grip = gap > 150 ? 0.96 : gap < -150 ? 1.04 : 1; }
  for (const c of cars) {
    const inp = !racing ? NONE : c === player ? playerInput() : aiInput(line, c, cars, dt, G);
    // physics in small steps (≤ 0.25 m) so the wall test never skips a thin barrier
    const n = Math.max(1, Math.ceil(Math.abs(c.v) * dt / 0.25));
    let bump = 0;
    for (let i = 0; i < n; i++) bump = Math.max(bump, stepCar(c, inp, dt / n, G, world));
    c.inp = inp;
    if (c === player && bump > 4) audio.crunch(Math.min(1, bump / 25));
  }
  collideCars(cars);
  for (const c of cars) {
    const before = c.lapsDone;
    trackProgress(line, c);
    if (!racing) continue;
    if (c.surf) c.offT = (c.offT || 0) + dt;
    // laps and the finish
    if (c.lapsDone > before && c.lapsDone >= 1 && !c.finished) {
      if (c === player) { const lt = raceT - lapStart; lastLap = lt; bestLap = bestLap === null ? lt : Math.min(bestLap, lt); lapStart = raceT; if (c.lapsDone < LAPS) banner(c.lapsDone === LAPS - 1 ? "FINAL LAP" : `LAP ${c.lapsDone + 1}`, 1.6); }
      if (c.lapsDone >= LAPS) { c.finished = raceT; finishOrder.push(c); if (c === player) finishRace(); }
    }
    // AI (and the player on autopilot) stuck for a while: back onto the line
    if (c.ai || c.finished) {
      if (c.dist - c.lastDist > 3) { c.lastDist = c.dist; c.stuckT = 0; } else if ((c.stuckT += dt) > 2.5) { respawn(c); c.lastDist = c.dist; c.resp = (c.resp || 0) + 1; }
    }
  }
}
function standings() {
  return cars.slice().sort((a, b) => (a.finished && b.finished ? a.finished - b.finished : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist));
}
function finishRace() {
  state = "done";
  const order = standings(), place = order.indexOf(player) + 1;
  banner(place === 1 ? "YOU WIN!" : `P${place}`, 2.5);
  setTimeout(() => {
    $("r-title").textContent = place === 1 ? "VICTORY" : `FINISHED P${place}`;
    $("r-table").innerHTML = standings().map((c, i) => `<tr class="${c === player ? "me" : ""}"><td>${i + 1}</td><td><span class="sw" style="background:${c.tint ? `rgb(${c.tint.map((v) => Math.round(v * 255))})` : "#3fd0c9"}"></span>${c.name}</td><td>${c.finished ? fmt(c.finished) : "running"}</td></tr>`).join("");
    $("r-sum").textContent = `Race ${fmt(player.finished)} · best lap ${bestLap ? fmt(bestLap) : "–"}`;
    $("results").classList.remove("hide"); $("again").focus();
  }, 2200);
}
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`; };
let bannerT = 0;
function banner(text, t) { $("banner").textContent = text; $("banner").classList.remove("hide"); bannerT = t; }

// ------------------------------------------------------------------ camera: chase (fixed distance, no zoom) or bonnet
const cam = { yaw: 0, z: 0, e: [0, 0, 0], t: [0, 0, 0], snap: true, fp: false };
try { cam.fp = localStorage.getItem("saratoga-gp-view") === "fp"; } catch (e) {}
function toggleView() { cam.fp = !cam.fp; cam.snap = true; try { localStorage.setItem("saratoga-gp-view", cam.fp ? "fp" : "chase"); } catch (e) {} }
const carBase = (c) => MX.mul(MX.mul(MX.mul(MX.T(c.x, c.y, c.z), MX.Z(c.h - Math.PI / 2)), MX.X(c.pitch)), MX.Y(-c.roll));
const xf = (B, x, y, z) => [B[0] * x + B[1] * y + B[2] * z + B[3], B[4] * x + B[5] * y + B[6] * z + B[7], B[8] * x + B[9] * y + B[10] * z + B[11]];
const FP_EYE = [0, 0.75, 1.3];
function updateCamera(dt) {
  const c = player;
  if (cam.fp) {
    const B = carBase(c), E = xf(B, ...FP_EYE), T = xf(B, 0, 40, 0.6);
    cam.e = E; cam.t = T; cam.yaw = c.h; space.magnifier = 1.55;
    space.lookAt(E[0], E[1], E[2], T[0], T[1], T[2]); cam.snap = false; return;
  }
  cam.yaw += dAng(cam.yaw, c.h) * (cam.snap ? 1 : damp(5, dt));
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw);
  const E = [c.x - fx * 9, c.y - fy * 9, 0], T = [c.x + fx * 4, c.y + fy * 4, c.z + 1.0];
  const g = world.ground(E[0], E[1], c.z + 3) ?? c.z;
  const ez = Math.max(c.z, g) + 3.0;
  cam.z = cam.snap ? ez : cam.z + (ez - cam.z) * damp(6, dt); E[2] = cam.z;
  cam.e = E; cam.t = T; cam.snap = false;
  space.magnifier = 1.75;
  space.lookAt(E[0], E[1], E[2], T[0], T[1], T[2]);
}

// ------------------------------------------------------------------ sound (Web Audio, synthesised)
const audio = {
  ctx: null, on: true,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.out = ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(ctx.destination);
    this.o1 = ctx.createOscillator(); this.o2 = ctx.createOscillator(); this.o1.type = "sawtooth"; this.o2.type = "sawtooth"; this.o2.detune.value = 9;
    this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 600; this.g = ctx.createGain(); this.g.gain.value = 0;
    this.o1.connect(this.lp); this.o2.connect(this.lp); this.lp.connect(this.g).connect(this.out); this.o1.start(); this.o2.start();
    // tyre squeal: filtered noise
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb; const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.bp = ctx.createBiquadFilter(); this.bp.type = "bandpass"; this.bp.frequency.value = 1800; this.bp.Q.value = 6; this.sq = ctx.createGain(); this.sq.gain.value = 0;
    ns.connect(this.bp).connect(this.sq).connect(this.out); ns.start();
  },
  mute() { this.on = !this.on; if (this.out) this.out.gain.value = this.on ? 0.5 : 0; },
  // four-speed rev model: the pitch climbs through each gear and drops at the shift
  engine(v, gas, slip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = Math.abs(v), edges = [0, 15, 28, 42, 64], gIdx = Math.max(0, edges.findIndex((e) => sp < e) - 1);
    const lo = edges[gIdx] ?? 42, hi = edges[gIdx + 1] ?? 64, rpm = clamp((sp - lo) / (hi - lo), 0, 1);
    const f = 48 + (0.3 + 0.7 * rpm) * (70 + gIdx * 14) + gas * 6;
    this.o1.frequency.setTargetAtTime(f, t, 0.04); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.lp.frequency.setTargetAtTime(400 + rpm * 1400 + gas * 400, t, 0.05); this.g.gain.setTargetAtTime(0.05 + gas * 0.05 + rpm * 0.03, t, 0.08);
    this.sq.gain.setTargetAtTime(clamp((Math.abs(slip) - 1.2) * 0.06, 0, 0.12), t, 0.06);
    $("gear").textContent = gIdx + 1;
  },
  beep(freq, len) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "square"; o.frequency.value = freq; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); o.connect(g).connect(this.out); o.start(t); o.stop(t + len + 0.02); },
  crunch(k) { if (!this.ctx || this.cool > this.ctx.currentTime) return; const t = this.ctx.currentTime; this.cool = t + 0.25; const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 900; g.gain.setValueAtTime(0.5 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); s.connect(f).connect(g).connect(this.out); s.start(t); s.stop(t + 0.32); },
  cool: 0,
};

// ------------------------------------------------------------------ minimap
let mapBase = null, mapXf = null;
function drawMap() {
  const P = line.P; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const W = $("map").width, pad = 18, k = (W - pad * 2) / Math.max(x1 - x0, y1 - y0), ox = (W - (x1 - x0) * k) / 2, oy = (W - (y1 - y0) * k) / 2;
  mapXf = (x, y) => [ox + (x - x0) * k, W - (oy + (y - y0) * k)];
  mapBase = document.createElement("canvas"); mapBase.width = mapBase.height = W;
  const g = mapBase.getContext("2d"); g.lineJoin = g.lineCap = "round";
  for (const [w, col] of [[11, "rgba(0,0,0,.45)"], [6, "#e8edf3"]]) { g.lineWidth = w; g.strokeStyle = col; g.beginPath(); P.forEach((p, i) => { const [a, b] = mapXf(p[0], p[1]); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.stroke(); }
  const s = line.at(0), [a, b] = mapXf(s.x, s.y); g.fillStyle = "#ff4a3d"; g.fillRect(a - 5, b - 5, 10, 10);
}
function renderMap() {
  const g = $("map").getContext("2d"); g.clearRect(0, 0, 340, 340); g.drawImage(mapBase, 0, 0);
  for (const c of cars) { const [a, b] = mapXf(c.x, c.y), me = c === player; g.fillStyle = me ? "#3fd0c9" : `rgb(${c.tint.map((v) => Math.round(v * 255))})`; g.strokeStyle = "#fff"; g.lineWidth = me ? 3 : 2; g.beginPath(); g.arc(a, b, me ? 9 : 7, 0, TAU); g.fill(); g.stroke(); }
}

// ------------------------------------------------------------------ render
const dyn = new Mesh(4000);
const SUN = (() => { const v = [-0.5, 0.42, 0.76], l = Math.hypot(...v); return v.map((a) => a / l); })();
const bones = new Float32Array(23 * 12);
function carBones(c) {
  const B = carBase(c);
  bones.set(MX.mul(B, MX.Y(clamp(-c.steer * c.v * 0.004, -0.03, 0.03))), 0);
  wheels.forEach((w, i) => bones.set(MX.mul(MX.mul(MX.mul(B, MX.T(w.x, w.y, w.z)), MX.Z(w.front ? c.steer : 0)), MX.X(c.spin)), (1 + i) * 12));
  return bones;
}
function render(dt) {
  updateCamera(dt);
  dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
  // soft shadows under the cars
  for (const c of cars) {
    const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = Math.sin(c.h), ry = -Math.cos(c.h), z = c.z + 0.04, L = 3.1, Wd = 1.25;
    const q = (a, b) => [c.x + rx * a + fx * b, c.y + ry * a + fy * b, z];
    dyn.quad4(q(-Wd, -L), q(Wd, -L), q(Wd, L), q(-Wd, L), [-1, -1, 0.7], [1, -1, 0.7], [1, 1, 0.7], [-1, 1, 0.7], 6);
  }
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, performance.now() / 1000 % 1000); gl.uniform3fv(U.uSun, SUN); gl.uniform1i(U.uTex, 0); gl.uniform4f(U.uLight, 0, 0, -999, 0);
  gl.uniform3f(U.uDof, 1e4, 0, 0); gl.uniform4f(U.uTint, 0, 0, 0, 0);
  space.applyCamera();
  const setMat = (useTex, cut, mode, blend) => { gl.uniform1f(U.uUseTex, useTex); gl.uniform1f(U.uCut, cut); gl.uniform1f(U.uMode, mode); gl.uniform1f(U.uBlend, blend); };
  setMat(0, 0, 0, 0); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.noUV(); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  setupCull(); drawnVerts = 0;
  const drawGroup = (g) => {
    const vis = g.tiles.filter((T) => inView(T, g.far)); if (!vis.length) return;
    gl.bindTexture(gl.TEXTURE_2D, g.tex || white); setMat(g.tex ? 1 : 0, g.kind === "cut" ? 0.42 : g.kind === "blend" ? 0.01 : 0, g.mode, g.kind === "blend" ? 1 : 0); space.bindTex(g.pb, g.cb, g.nb, g.ub);
    // neighbouring visible tiles are contiguous in the buffer: merge them into one draw
    let a = vis[0].first, b = a + vis[0].count;
    for (let i = 1; i < vis.length; i++) { const T = vis[i]; if (T.first === b) b += T.count; else { space.draw(a, b - a); drawnVerts += b - a; a = T.first; b = a + T.count; } }
    space.draw(a, b - a); drawnVerts += b - a;
  };
  for (const g of groups) if (g.kind !== "blend") drawGroup(g);
  // the cars (opaque parts)
  const drawCar = (c, blend) => {
    const T = { c: [c.x, c.y, c.z + 0.7], r: 3.2 }; if (!inView(T, 900)) return;
    const near = Math.hypot(c.x - view.e[0], c.y - view.e[1]) < 120;
    if (blend && !near) return;
    gl.uniform4fv(U.uBone, carBones(c));
    for (const p of carParts) {
      if (p.blend !== blend || (!near && p.name.startsWith("wheel") && c !== player)) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex); setMat(1, blend ? 0.01 : 0.3, 0, blend ? 1 : 0);
      gl.uniform4f(U.uTint, ...(p.tint && c.tint ? c.tint : [0, 0, 0]), p.tint && c.tint ? 1 : 0);
      space.bindTex(p.pb, p.cb, p.nb, p.ub); space.draw(0, p.n);
    }
    gl.uniform4f(U.uTint, 0, 0, 0, 0);
  };
  for (const c of cars) drawCar(c, false);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); gl.bindTexture(gl.TEXTURE_2D, white); setMat(0, 0, 0, 0); space.bind(true); space.noUV(); space.draw(6, dyn.n - 6);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  for (const g of groups) if (g.kind === "blend") drawGroup(g);
  for (const c of cars) drawCar(c, true);
  gl.disable(gl.BLEND); gl.depthMask(true); space.noNormals(); space.noUV();
  post.end({ time: performance.now() / 1000, fade: 1, flash: 0, sunUV: [0.5, 1.6], sunK: 0, maxR: 0, skyCoc: 0 });
}

// ------------------------------------------------------------------ HUD
function hud(dt) {
  const order = standings(), place = order.indexOf(player) + 1;
  $("pos").innerHTML = `P${place}<small> / ${cars.length}</small>`;
  $("lap").textContent = `LAP ${clamp(player.lapsDone + 1, 1, LAPS)} / ${LAPS}`;
  $("t-cur").textContent = fmt(state === "race" ? raceT - lapStart : 0);
  $("t-last").textContent = lastLap ? fmt(lastLap) : "–"; $("t-best").textContent = bestLap ? fmt(bestLap) : "–";
  $("spd").textContent = Math.round(Math.abs(player.v) * 3.6);
  $("wrong").classList.toggle("hide", !(player.wrong && state === "race"));
  if (bannerT > 0 && (bannerT -= dt) <= 0) $("banner").classList.add("hide");
  renderMap();
}

// ------------------------------------------------------------------ loop
let fps = 0, fN = 0, fT = 0, last = performance.now();
// adaptive resolution: a slow GPU gets fewer pixels instead of a low frame rate (from Forest Rally v2.3)
const ar = { sum: 0, n: 0, t: 0, good: 0 };
function adaptRes(ms) {
  if (ms > 100) return;
  ar.sum += ms; ar.n++; ar.t += ms;
  if (ar.t < 2000) return;
  const avg = ar.sum / ar.n; ar.sum = ar.n = ar.t = 0;
  if (avg > 19 && pxCap > PX_MIN) { pxBad = Math.min(pxBad, pxCap); pxCap = Math.max(PX_MIN, pxCap * 0.75); ar.good = 0; sizeCanvas(); }
  else if (avg <= 17.5 && (ar.good += 2) >= 8 && pxCap < PX_MAX && pxCap * 1.15 < pxBad * 0.98) { pxCap = Math.min(PX_MAX, pxCap * 1.15); ar.good = 0; sizeCanvas(); }
}
const prof = { sim: 0, cpu: 0, gap: 0 };
function frame(now) {
  const ms = now - last, dt = clamp(ms / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; $("fps").textContent = `${fps} fps`; }
  if (state !== "loading") {
    adaptRes(ms);
    try {
      const t0 = performance.now(); simulate(dt); const t1 = performance.now(); render(dt); hud(dt); const t2 = performance.now();
      audio.engine(player.v, player.inp?.gas || 0, player.slip);
      if (PROF) { const a = 0.05; prof.sim += (t1 - t0 - prof.sim) * a; prof.cpu += (t2 - t1 - prof.cpu) * a; prof.gap += (ms - prof.gap) * a; }
    } catch (e) { if (!frame.err) { frame.err = 1; console.error("Saratoga GP:", e); } }
  }
  requestAnimationFrame(frame);
}
// debug hooks
window.__race = () => ({ state, t: +raceT.toFixed(2), fps, px: canvas.width * canvas.height, verts: drawnVerts, view: cam.fp ? "bonnet" : "chase",
  cars: standings().map((c) => ({ n: c.name, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1), v: +c.v.toFixed(1), lap: c.lapsDone, d: Math.round(c.dist), s: c.surf, off: +(c.offT || 0).toFixed(1), resp: c.resp || 0, fin: c.finished ? +c.finished.toFixed(2) : 0 })) });
// debug: fast-forward the race by `sec` seconds of simulation without rendering; reports lap time and line-keeping
window.__ff = (sec, dt = 1 / 60) => {
  if (state === "menu") startRace();
  const lat = new Map(cars.map((c) => [c, 0])); const t0 = performance.now();
  for (let k = 0; k < sec / dt; k++) { simulate(dt); for (const c of cars) lat.set(c, Math.max(lat.get(c), Math.abs(c.lat || 0))); }
  return { ms: Math.round(performance.now() - t0), t: +raceT.toFixed(1), state, cars: standings().map((c) => ({ n: c.name, lap: c.lapsDone, d: Math.round(c.dist), off: +(c.offT || 0).toFixed(1), resp: c.resp || 0, maxLat: +lat.get(c).toFixed(1), fin: c.finished ? fmt(c.finished) : "" })), best: bestLap && fmt(bestLap) };
};
window.__prof = () => Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, +v.toFixed(2)]));
window.__probe = (x, y) => world.probe(x, y).map(([h, s, i]) => [h, s, groups[i].name]);
window.__groups = () => groups;
window.__keys = keys; window.__player = () => player; window.__world = () => world; window.__line = () => line;
window.__fit = (x = player.x, y = player.y, h = player.h) => fitsPose(G, world, x, y, h, player.z);
load().catch((e) => { console.error(e); $("ld-msg").textContent = "Could not load: " + e.message; });
requestAnimationFrame(frame);
