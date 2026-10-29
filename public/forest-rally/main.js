// FOREST RALLY — drive a little toy rally car around a forest kart track (assets/forest_r02.glb). Rendered with
// the projection3d library (Space, via GameSpace) + textured shaders + bloom / depth of field. See DESIGN.md.
// gltex.js loads the model; car.js is the car (model + driving); this file builds GPU buffers per material,
// collision from the model's own surfaces (all of it for walls, the road alone for the wheels), the chase camera.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Mesh, clamp, lerp } from "./mesh.js";
import { buildCar, makeCar, stepCar, fitsPose, WHEELS, WHEEL_R, SPREAD, SC, MX } from "./car.js";
import { loadTexturedGLB } from "./gltex.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const canvas = $("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
const MAX_ANISO = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
// render resolution cap (pixels); lowered automatically while frames run slow (see adaptRes)
const PX_MAX = 2.6e6, PX_MIN = 0.9e6;
let pxCap = PX_MAX, pxBad = Infinity;
function sizeCanvas() {
  let dpr = Math.min(2, devicePixelRatio || 1); const px = innerWidth * innerHeight * dpr * dpr;
  if (px > pxCap) dpr *= Math.sqrt(pxCap / px);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); post.resize(canvas.width, canvas.height);
}
sizeCanvas(); addEventListener("resize", sizeCanvas);
const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };

// ------------------------------------------------------------------ the map: GPU buffers per material
const SKY = /skydome/i, BLEND = /shadow|F_light|waterdrop/i, WATER = /F_water|F_sea|waterfall/i, UNLIT = /skydome|F_light|back01/i;
const ROADLIKE = /F_road|roadstart|bridge_set|tilegrass/i;
const SOFT_STUFF = /grass|leaf|mtree|flower|mushroom|pinegrass|branch|back01|ston00|pinetree00/i;
let groups = [], col = null;
function makeTexture(img) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, MAX_ANISO);
  return t;
}
async function loadMap() {
  const M = await loadTexturedGLB("assets/forest_r02.glb", (k) => ($("ld-bar").style.width = Math.round(k * 100) + "%"));
  const tex = M.images.map((im) => (im ? makeTexture(im) : null));
  for (const g of M.groups) {
    const name = g.mat.name, pos = new Float32Array(g.n * 4), c4 = new Float32Array(g.n * 4);
    for (let i = 0; i < g.n; i++) { pos[i * 4] = g.pos[i * 3]; pos[i * 4 + 1] = g.pos[i * 3 + 1]; pos[i * 4 + 2] = g.pos[i * 3 + 2]; pos[i * 4 + 3] = 1; c4[i * 4] = g.col[i * 4]; c4[i * 4 + 1] = g.col[i * 4 + 1]; c4[i * 4 + 2] = g.col[i * 4 + 2]; c4[i * 4 + 3] = 0; }
    const kind = SKY.test(name) ? "sky" : BLEND.test(name) ? "blend" : WATER.test(name) ? "water" : g.mat.alphaMode !== "OPAQUE" ? "cut" : "solid";
    groups.push({ name, kind, n: g.n, tex: g.mat.image !== null ? tex[g.mat.image] : null, mode: UNLIT.test(name) ? 1 : kind === "water" ? 2 : 0,
      pb: buf(pos), cb: buf(c4), nb: buf(g.nrm), ub: buf(g.uv), xyz: g.pos, raw: kind === "solid" || (kind === "cut" && !SOFT_STUFF.test(name)) ? g.pos : null });
  }
  // the order things are drawn in: opaque, cut-outs, water, then blended (shadows, light shafts) last
  const rank = { sky: 0, solid: 1, cut: 2, water: 3, blend: 4 };
  groups.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const colGroups = groups.filter((g) => g.raw);
  // the driving surfaces themselves (road, start line, bridge deck, grass tiles) are ground, never walls: their steep
  // bits are kerbs, seams, deck edges and the bridge's underside, and the wheels-on-the-road rule already keeps the
  // car from driving off them
  col = buildCollision(colGroups.map((g) => g.raw), colGroups.map((g) => ROADLIKE.test(g.name)));
  col.names = colGroups.map((g) => g.name);
  // spawn on the start line (the chequered start texture), facing along the road there
  const start = groups.find((g) => /roadstart/i.test(g.name)) || groups.find((g) => /ad_start/i.test(g.name));
  if (start) {
    let x = 0, y = 0; const v = start.xyz, n = v.length / 3; for (let i = 0; i < v.length; i += 3) { x += v[i]; y += v[i + 1]; } P.x = x / n; P.y = y / n;
    P.z = col.ground(P.x, P.y, 1e6) ?? 0;
    // the chequered strip lies across the road: the track runs perpendicular to its long axis
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < v.length; i += 3) { const dx = v[i] - P.x, dy = v[i + 1] - P.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    P.face = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
    // of the two directions along the road, pick the one with more open ground ahead
    const open = (a) => { let k = 0; for (let d = 2; d < 30; d += 2) if (col.ground(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, 1e6) !== null && !col.blocked(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, P.z)) k++; return k; };
    if (open(P.face + Math.PI) > open(P.face)) P.face += Math.PI;
  }
  for (const g of groups) delete g.xyz;
  const g0 = col.ground(P.x, P.y, 1e6); P.z = g0 ?? 0; P.lastSafe = [P.x, P.y, P.z]; cam.yaw = P.face;
}

// ------------------------------------------------------------------ collision from the model's own triangles
// walkable (up-facing) triangles in 1 m buckets, queried exactly by barycentric height; steep triangles mark
// cells (0.25 m, so a diagonal fence is a fine staircase, not 0.5 m steps poking into the road) with the height
// intervals they cover (walls, cliffs, fences, trunks, rock faces). Each cell keeps separate
// intervals, measured from the part of each triangle inside that cell, so a kerb at road level and a bridge or rock
// overhang above it stay two thin bands instead of merging into one solid wall from the road to the roof.
function buildCollision(lists, noWalls = [], upOnly = false) {
  let min = [1e9, 1e9], max = [-1e9, -1e9];
  for (const L of lists) for (let i = 0; i < L.length; i += 3) { min[0] = Math.min(min[0], L[i]); min[1] = Math.min(min[1], L[i + 1]); max[0] = Math.max(max[0], L[i]); max[1] = Math.max(max[1], L[i + 1]); }
  const RW = 1, RS = 0.25, WW = Math.ceil((max[0] - min[0]) / RW) + 1, WH = Math.ceil((max[1] - min[1]) / RW) + 1, SW = Math.ceil((max[0] - min[0]) / RS) + 1, SH = Math.ceil((max[1] - min[1]) / RS) + 1;
  const tris = [], walkB = new Map(), steep = new Map(), owner = [];
  // steep: cell → list of [lo, hi, owner] height intervals; overlapping ones (within 5 cm) merge
  const addBand = (k, lo, hi, who) => {
    let L = steep.get(k); if (!L) steep.set(k, (L = []));
    for (let i = 0; i < L.length; i++) { const e = L[i]; if (lo <= e[1] + 0.05 && hi >= e[0] - 0.05) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); L.splice(i, 1); i = -1; } }
    L.push([lo, hi, who]);
  };
  const cell = (x, y) => steep.get(Math.floor((y - min[1]) / RS) * SW + Math.floor((x - min[0]) / RS));
  const overlaps = (x, y, lo, hi) => { const L = cell(x, y); if (L) for (const e of L) if (e[1] > lo && e[0] < hi) return true; return false; };
  lists.forEach((L, li) => { for (let i = 0; i + 9 <= L.length; i += 9) owner.push(li); });
  for (const L of lists) for (let i = 0; i + 9 <= L.length; i += 9) tris.push(L[i], L[i + 1], L[i + 2], L[i + 3], L[i + 4], L[i + 5], L[i + 6], L[i + 7], L[i + 8]);
  const T = new Float32Array(tris), nT = T.length / 9;
  for (let t = 0; t < nT; t++) {
    const o = t * 9, ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue; nz /= l;
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
    if (upOnly ? nz > 0.55 : Math.abs(nz) > 0.55) {
      for (let j = Math.floor((y0 - min[1]) / RW); j <= Math.floor((y1 - min[1]) / RW); j++) for (let i = Math.floor((x0 - min[0]) / RW); i <= Math.floor((x1 - min[0]) / RW); i++) { const k = j * WW + i; let a = walkB.get(k); if (!a) walkB.set(k, (a = [])); a.push(t); }
    } else if (!noWalls[owner[t]]) {
      // sample the triangle finely (in x, y and z, so thin and tall walls are both covered) and record, per cell, the
      // height range of the samples that fall in it
      const zlo = Math.min(az, bz, cz), zhi = Math.max(az, bz, cz);
      const steps = Math.max(2, Math.ceil(Math.max(x1 - x0, y1 - y0, zhi - zlo) / (RS * 0.5)));
      const span = new Map();
      for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps - a; b++) {
        const s = a / steps, r = b / steps, x = ax + ux * s + vx * r, y = ay + uy * s + vy * r, z = az + uz * s + vz * r, k = Math.floor((y - min[1]) / RS) * SW + Math.floor((x - min[0]) / RS);
        const e = span.get(k); if (!e) span.set(k, [z, z]); else { if (z < e[0]) e[0] = z; if (z > e[1]) e[1] = z; }
      }
      const pad = (zhi - zlo) / steps * 0.5 + 0.02;
      for (const [k, [lo, hi]] of span) addBand(k, lo - pad, hi + pad, owner[t]);
    }
  }
  const heightOn = (t, x, y) => {
    const o = t * 9, ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-12) return null;
    const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w3 = 1 - w1 - w2;
    if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) return null;
    return w1 * T[o + 2] + w2 * T[o + 5] + w3 * T[o + 8];
  };
  return {
    min, max,
    ground(x, y, z) { const a = walkB.get(Math.floor((y - min[1]) / RW) * WW + Math.floor((x - min[0]) / RW)); if (!a) return null; let best = null; for (const t of a) { const h = heightOn(t, x, y); if (h !== null && h <= z + 0.55 && (best === null || h > best)) best = h; } return best; },
    blocked(x, y, feet) { return overlaps(x, y, feet + 0.4, feet + 1.6); },
    // a steep surface overlapping the height band [lo, hi] (the toy car checks 0.35–0.5 m above the road)
    blockedBand(x, y, lo, hi) { return overlaps(x, y, lo, hi); },
    // debug: the cell's intervals as [lo, hi, group name]
    wallAt(x, y) { const L = cell(x, y); return L ? L.map((e) => [+e[0].toFixed(2), +e[1].toFixed(2), this.names?.[e[2]]]) : null; },
    tris: nT,
    probe(x, y) { const a = walkB.get(Math.floor((y - min[1]) / RW) * WW + Math.floor((x - min[0]) / RW)) || []; return a.map((t) => [heightOn(t, x, y), owner[t]]).filter((q) => q[0] !== null).map((q) => [+q[0].toFixed(2), this.names[q[1]]]); },
  };
}

// ------------------------------------------------------------------ the car
const P = { x: 0, y: 0, z: 0, face: 0, lastSafe: [0, 0, 0], trail: [] };
let car = null, road = null;
const keys = new Set();
addEventListener("keydown", (e) => {
  audio.init();
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === "KeyH" && !e.repeat) $("help").classList.toggle("hide");
  if (e.code === "KeyR" && !e.repeat && car) resetCar();
  if (e.code === "KeyC" && !e.repeat) toggleView();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
const AUTO = new URLSearchParams(location.search).has("auto");
function resetCar() { car = makeCar(spawn.x, spawn.y, spawn.z, spawn.h); cam.snap = true; }
let spawn = null;
const roadAt = (x, y, z) => road.ground(x, y, z);
// walls for the car: anything steep between 0.35 and 0.5 m above the road. Low seams and kerbs roll under; the car is
// about 0.4 m tall, so banners, branches and the stone bridge's underside (0.57 m up) pass overhead
const wallAt = (x, y, z) => col.blockedBand(x, y, z + 0.35, z + 0.5);
// drivable = on a road surface near height z and not inside a fence / wall / cliff band
function drivable(x, y, z) { const g = road.ground(x, y, z + 1.5); return g !== null && Math.abs(g - z) < 1.5 && !wallAt(x, y, g); }
// autopilot (?auto): steer toward the heading with the longest drivable run ahead, preferring to keep straight
function autopilot() {
  let best = -1, bestA = 0, bestRun = 0;
  for (let k = -20; k <= 20; k++) {
    const a = car.h + k * 0.08; let run = 0;
    // check the car's full width (centre and both wheel tracks) in fine steps, so thin fence rails aren't skipped
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let d = 0.25; d <= 16; d += 0.25) { let ok = true; for (const o of [-0.27, 0, 0.27]) if (!drivable(car.x + ca * d + sa * o, car.y + sa * d - ca * o, car.z)) { ok = false; break; } if (!ok) break; run = d; }
    const score = run - Math.abs(k) * 0.15;
    if (score > best) { best = score; bestA = k * 0.08; bestRun = run; }
  }
  // keep to the middle of the corridor: compare the free space to the left and right, a little ahead
  const side = (s) => { const ax = car.x + Math.cos(car.h) * 0.8, ay = car.y + Math.sin(car.h) * 0.8, px = Math.sin(car.h) * s, py = -Math.cos(car.h) * s; let d = 0; for (; d < 3; d += 0.1) if (!drivable(ax + px * d, ay + py * d, car.z)) break; return d; };
  const centre = clamp((side(1) - side(-1)) * 0.6, -0.6, 0.6);   // > 0: more room on the right
  // positive steer turns left (counter-clockwise), the same sign as bestA
  // nose against something: back out for a moment with the wheel turned the other way, swinging the nose toward bestA
  if (bestRun < 0.9 || stuck.t > 1) backT = 1.0;
  if (backT > 0) return { gas: 0, brake: 1, steer: bestA >= 0 ? -1 : 1, hand: false };
  // slow down for bends: the target speed follows how much clear road lies ahead (the steering is rate-limited)
  const target = clamp(bestRun * 0.9 - Math.abs(bestA) * 4, 2, 11);
  return { gas: car.v < target ? 0.8 : 0, brake: car.v > target + 1 ? 0.6 : 0, steer: clamp(bestA * 3 - centre, -1, 1), hand: false };
}
let backT = 0;
// progress-based jam detection: pedal held but the car has moved less than 0.4 m in the last 1.5 s
const stuck = { t: 0, ref: null, refT: 0 };
function trackStuck(dt, pedal) {
  if (!stuck.ref || Math.hypot(car.x - stuck.ref[0], car.y - stuck.ref[1]) > 0.4) { stuck.ref = [car.x, car.y]; stuck.refT = 0; stuck.t = 0; return; }
  stuck.refT += dt; stuck.t = pedal && stuck.refT > 1.5 ? stuck.refT - 1.5 : 0;
}
function driveInput() {
  if (AUTO) return autopilot();
  const k = keys, t = touch;
  return {
    gas: k.has("KeyW") || k.has("ArrowUp") || t.gas ? 1 : 0,
    brake: k.has("KeyS") || k.has("ArrowDown") || t.brake ? 1 : 0,
    steer: clamp((k.has("KeyA") || k.has("ArrowLeft") || t.left ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") || t.right ? 1 : 0), -1, 1),
    hand: k.has("Space"),
  };
}
function stepDrive(dt) {
  const inp = driveInput();
  // physics in small steps so the road-edge test never skips over a thin gap
  const n = Math.max(1, Math.ceil(Math.abs(car.v) * dt / 0.12));
  let bump = 0;
  for (let i = 0; i < n; i++) bump = Math.max(bump, stepCar(car, inp, dt / n, roadAt, wallAt));
  if (bump > 3) audio.bump(Math.min(1, bump / 10));
  // jammed against something for a while → put the car back on the road behind
  backT = Math.max(0, backT - dt);
  trackStuck(dt, inp.gas || inp.brake);
  // a trail of good poses (moving freely), one every 0.5 m; a reset goes back to one at least 3 m behind the jam,
  // so holding the pedal doesn't drive straight back into the same spot
  if (Math.abs(car.v) > 2 && stuck.refT < 0.5) {
    const t = P.trail, l = t[t.length - 1];
    if (!l || Math.hypot(car.x - l[0], car.y - l[1]) > 0.5) { t.push([car.x, car.y, car.z, car.h]); if (t.length > 40) t.shift(); }
    P.lastSafe = t.findLast((q) => Math.hypot(car.x - q[0], car.y - q[1]) >= 3) || t[0];
  }
  // jammed with the pedal down for ~3 s → back to the last good spot on the road
  if (stuck.t > 1.5 && !AUTO && P.lastSafe.length === 4) { [car.x, car.y, car.z, car.h] = P.lastSafe; car.v = 0; car.slip = 0; stuck.ref = null; cam.snap = true; P.trail.length = 0; }
  if (stuck.t > 4 && AUTO) { car.h += Math.PI * 0.5; stuck.ref = null; }
  audio.engine(Math.abs(car.v) / 13, inp.gas);
}

// ------------------------------------------------------------------ chase camera: fixed distance, no zoom
const cam = { yaw: 0, t: [0, 0, 0], e: [0, 0, 0], snap: true, fp: false };
// C (or the CAM button) switches between the chase camera and the driver's view; the choice is remembered
try { cam.fp = localStorage.getItem("forest-rally-view") === "fp"; } catch (e) {}
function toggleView() { cam.fp = !cam.fp; cam.snap = true; try { localStorage.setItem("forest-rally-view", cam.fp ? "fp" : "chase"); } catch (e) {} }
// first person: just in front of the driver's helmet, looking along the car (heading and pitch, no lag, no zoom)
const FP_EYE = [0, 0.04 * SC, 0.53 * SC], FP_LOOK = 6;
function fpCamera() {
  const B = carBase(), p = (x, y, z) => [B[0] * x + B[1] * y + B[2] * z + B[3], B[4] * x + B[5] * y + B[6] * z + B[7], B[8] * x + B[9] * y + B[10] * z + B[11]];
  const E = p(...FP_EYE), T = p(FP_EYE[0], FP_EYE[1] + FP_LOOK, FP_EYE[2] - FP_LOOK * 0.09);
  cam.e = E; cam.t = T; cam.yaw = car.h; cam.snap = false;
  space.magnifier = 1.6;
  space.lookAt(E[0], E[1], E[2], T[0], T[1], T[2]);
}
const CAM_BACK = 2.5, CAM_UP = 0.95, CAM_AHEAD = 1.4;
function updateCamera(dt) {
  if (cam.fp) return fpCamera();
  // the camera trails the car's direction of travel (reversing doesn't swing it round)
  cam.yaw += dAng(cam.yaw, car.h) * (cam.snap ? 1 : damp(4, dt));
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw);
  const T = [car.x + fx * CAM_AHEAD, car.y + fy * CAM_AHEAD, car.z + 0.35];
  const E = [car.x - fx * CAM_BACK, car.y - fy * CAM_BACK, 0];
  const g = roadAt(E[0], E[1], car.z + 2) ?? col.ground(E[0], E[1], car.z + 2) ?? car.z;
  E[2] = Math.max(car.z, g) + CAM_UP;
  const k = cam.snap ? 1 : damp(10, dt);
  for (let i = 0; i < 3; i++) { cam.t[i] += (T[i] - cam.t[i]) * k; cam.e[i] += (E[i] - cam.e[i]) * k; }
  cam.snap = false;
  space.magnifier = 1.25 * 1.6;
  space.lookAt(cam.e[0], cam.e[1], cam.e[2], cam.t[0], cam.t[1], cam.t[2]);
}

// touch: on-screen pedals and steering
const touch = { gas: false, brake: false, left: false, right: false };
$("t-cam").addEventListener("pointerdown", (e) => { toggleView(); e.preventDefault(); });
for (const [id, k] of [["t-gas", "gas"], ["t-brake", "brake"], ["t-left", "left"], ["t-right", "right"]]) {
  const el = $(id); el.addEventListener("pointerdown", (e) => { audio.init(); touch[k] = true; e.preventDefault(); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, () => (touch[k] = false));
}

// ------------------------------------------------------------------ engine sound (Web Audio)
const audio = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.out = ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(ctx.destination);
    this.o1 = ctx.createOscillator(); this.o2 = ctx.createOscillator(); this.o1.type = "sawtooth"; this.o2.type = "square";
    this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 700; this.g = ctx.createGain(); this.g.gain.value = 0;
    this.o1.connect(this.lp); this.o2.connect(this.lp); this.lp.connect(this.g).connect(this.out); this.o1.start(); this.o2.start();
  },
  engine(k, gas) { if (!this.ctx) return; const t = this.ctx.currentTime, f = 55 + k * 150 + gas * 12; this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05); this.lp.frequency.setTargetAtTime(500 + k * 1500, t, 0.05); this.g.gain.setTargetAtTime(0.03 + k * 0.05 + gas * 0.015, t, 0.08); },
  bump(k) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15); g.gain.setValueAtTime(0.25 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.22); },
};

// ------------------------------------------------------------------ render
const dyn = new Mesh(2000);
// a 1×1 white texture for untextured draws, so the sampler never reads the post-process target (feedback loop)
const white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
let carBuf = null, time = 0;
const SUN = (() => { const v = [-0.45, 0.35, 0.82], l = Math.hypot(...v); return v.map((a) => a / l); })();
const bones = new Float32Array(23 * 12);
const carBase = () => MX.mul(MX.mul(MX.mul(MX.T(car.x, car.y, car.z + Math.max(0, Math.sin(time * 40) * car.hit * 0.03)), MX.Z(car.h - Math.PI / 2)), MX.X(car.pitch)), MX.Y(-car.roll));
function carBones() {
  const base = carBase();
  // body leans a little out of turns and squats under throttle
  bones.set(MX.mul(base, MX.mul(MX.Y(clamp(-car.steer * car.v * 0.03, -0.08, 0.08)), MX.T(0, 0, 0))), 0);
  WHEELS.forEach(([wx, wy], i) => bones.set(MX.mul(MX.mul(MX.mul(base, MX.T(wx, wy, WHEEL_R)), MX.Z(wy > 0 ? car.steer : 0)), MX.X(-car.spin)), (1 + i) * 12));
  return bones;
}
function render(dt) {
  updateCamera(dt);
  dyn.reset();
  dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
  // soft shadow under the car, oriented with it
  const fx = Math.cos(car.h), fy = Math.sin(car.h), rx = Math.sin(car.h), ry = -Math.cos(car.h), z = car.z + 0.02, L = 0.62 * SC, Wd = 0.4 * SC;
  const q = (a, b) => [car.x + rx * a + fx * b, car.y + ry * a + fy * b, z];
  dyn.quad4(q(-Wd, -L), q(Wd, -L), q(Wd, L), q(-Wd, L), [-1, -1, 0.6], [1, -1, 0.6], [1, 1, 0.6], [-1, 1, 0.6], 6);
  space.setDynamic(dyn.pos, dyn.col, dyn.n);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white);
  post.begin();
  gl.useProgram(U.program);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(U.aspect, canvas.width / canvas.height); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
  gl.uniform1f(U.uTime, time % 1000); gl.uniform3fv(U.uSun, SUN); gl.uniform1i(U.uTex, 0); gl.uniform4f(U.uLight, 0, 0, -999, 0);
  const focus = Math.hypot(cam.e[0] - car.x, cam.e[1] - car.y, cam.e[2] - car.z);
  gl.uniform3f(U.uDof, focus, 0.14, 0.15);
  space.applyCamera();
  const setMat = (useTex, cut, mode, blend) => { gl.uniform1f(U.uUseTex, useTex); gl.uniform1f(U.uCut, cut); gl.uniform1f(U.uMode, mode); gl.uniform1f(U.uBlend, blend); };
  setMat(0, 0, 0, 0); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); space.bind(true); space.noUV(); space.draw(0, 6);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  const drawGroup = (g) => { gl.bindTexture(gl.TEXTURE_2D, g.tex || white); setMat(g.tex ? 1 : 0, g.kind === "cut" ? 0.42 : g.kind === "blend" ? 0.01 : 0, g.mode, g.kind === "blend" ? 1 : 0); space.bindTex(g.pb, g.cb, g.nb, g.ub); space.draw(0, g.n); };
  for (const g of groups) if (g.kind !== "blend") drawGroup(g);
  // the car
  if (!carBuf) { const C = buildCar(); carBuf = { pb: buf(C.m.pos.subarray(0, C.m.n * 4)), cb: buf(C.m.col.subarray(0, C.m.n * 4)), nb: buf(C.nrm), n: C.m.n, h0: C.hideFrom, h1: C.hideTo }; }
  gl.bindTexture(gl.TEXTURE_2D, white); setMat(0, 0, 0, 0); gl.uniform4fv(U.uBone, carBones());
  space.bindBuf(carBuf.pb, carBuf.cb, carBuf.nb); space.noUV();
  if (cam.fp) { space.draw(0, carBuf.h0); space.draw(carBuf.h1, carBuf.n - carBuf.h1); } else space.draw(0, carBuf.n);
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); space.bind(true); space.noUV(); space.draw(6, 6);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  for (const g of groups) if (g.kind === "blend") drawGroup(g);
  gl.disable(gl.BLEND); gl.depthMask(true); space.noNormals(); space.noUV();
  post.end({ time, fade: Math.min(1, time * 0.8), flash: 0, sunUV: [0.5, 1.6], sunK: 0, maxR: cam.fp ? 0 : canvas.height * 0.004, skyCoc: 0.08 });
  $("spd").textContent = Math.round(Math.abs(car.v) * 3.6 * 2);
}

// ------------------------------------------------------------------ loop
let fps = 0, fN = 0, fT = 0, last = performance.now(), state = "loading";
// adaptive resolution: the game is fill-rate bound, so a slow GPU gets fewer pixels instead of a low frame rate.
// Every 2 s: average frame > 19 ms → cap × 0.75 (never below PX_MIN), remembering that size as too slow;
// a steady ≤ 17.5 ms for 8 s → cap × 1.15, but never back up to a size that was too slow.
const ar = { sum: 0, n: 0, t: 0, good: 0 };
function adaptRes(ms) {
  if (ms > 100) return;                                   // tab switch or a hitch: not a measure of the GPU
  ar.sum += ms; ar.n++; ar.t += ms;
  if (ar.t < 2000) return;
  const avg = ar.sum / ar.n; ar.sum = ar.n = ar.t = 0;
  if (avg > 19 && pxCap > PX_MIN) { pxBad = Math.min(pxBad, pxCap); pxCap = Math.max(PX_MIN, pxCap * 0.75); ar.good = 0; sizeCanvas(); }
  else if (avg <= 17.5 && (ar.good += 2) >= 8 && pxCap < PX_MAX && pxCap * 1.15 < pxBad * 0.98) { pxCap = Math.min(PX_MAX, pxCap * 1.15); ar.good = 0; sizeCanvas(); }
}
// ?prof: smoothed ms per frame for physics, render submission and the whole frame interval (gap − the rest ≈ GPU)
const PROF = new URLSearchParams(location.search).has("prof"), prof = { step: 0, cpu: 0, gap: 0 };
window.__prof = () => Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, +v.toFixed(2)]));
function frame(now) {
  const ms = now - last, dt = clamp(ms / 1000, 0, 0.05); last = now;
  fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; $("fps").textContent = `${fps} fps`; }
  if (state === "play") {
    time += dt; adaptRes(ms);
    try {
      const t0 = performance.now(); stepDrive(dt); const t1 = performance.now(); render(dt); const t2 = performance.now();
      if (PROF) { const a = 0.05; prof.step += (t1 - t0 - prof.step) * a; prof.cpu += (t2 - t1 - prof.cpu) * a; prof.gap += (ms - prof.gap) * a; }
    } catch (e) { if (!frame.err) { frame.err = 1; console.error("Forest Rally:", e); } }
  }
  requestAnimationFrame(frame);
}
window.__rally = () => ({ state, view: cam.fp ? "fp" : "chase", px: canvas.width * canvas.height, x: +car?.x.toFixed(2), y: +car?.y.toFixed(2), z: +car?.z.toFixed(2), v: +car?.v.toFixed(2), h: +car?.h.toFixed(2), onRoad: car ? roadAt(car.x, car.y, car.z + 0.5) !== null : null, fps });
window.__keys = keys;
window.__car = () => car;
// debug: does the car fit at pose (x, y, h)? → wheel heights, or the reason it does not
window.__fit = (x = car.x, y = car.y, h = car.h) => { const why = []; return fitsPose(x, y, h, car.z, roadAt, wallAt, why) || why; };
// debug: road levels and wall intervals at a point
window.__cell = (x, y) => ({ road: road.probe(x, y), walls: col.wallAt(x, y) });
// debug: top-down picture of the road (cx, cy centre, m per pixel): grey = drivable, red = blocked by the road / ground
// mesh itself, yellow = fences, orange = anything else, blue = the car
window.__topo = (cx = (road.min[0] + road.max[0]) / 2, cy = (road.min[1] + road.max[1]) / 2, mpp = 0.4, W = 1000, zTop = 1e6) => {
  let c = document.getElementById("topo"); if (!c) { c = document.createElement("canvas"); c.id = "topo"; c.style.cssText = "position:fixed;inset:0;z-index:99;width:100vw;height:100vh;background:#123"; document.body.appendChild(c); }
  c.width = c.height = W; const g2 = c.getContext("2d"), im = g2.createImageData(W, W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = cx + (i - W / 2) * mpp, y = cy - (j - W / 2) * mpp, g = road.ground(x, y, zTop); if (g === null) continue;
    let col = [150, 150, 150];
    const hit = (col_.wallAt(x, y) || []).filter((e) => e[1] > g + 0.35 && e[0] < g + 0.5);
    if (hit.length) { const n = hit[0][2] || ""; col = /F_road|roadstart|tilegrass/i.test(n) ? [230, 40, 40] : /fence/i.test(n) ? [240, 220, 40] : [240, 130, 30]; }
    const o = (j * W + i) * 4; im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255;
  }
  g2.putImageData(im, 0, 0);
  g2.fillStyle = "#3af"; g2.beginPath(); g2.arc(W / 2 + (car.x - cx) / mpp, W / 2 - (car.y - cy) / mpp, 5, 0, 7); g2.fill();
  g2.fillStyle = "#fff"; g2.font = "14px sans-serif"; for (let gx = Math.ceil((cx - W / 2 * mpp) / 20) * 20; gx < cx + W / 2 * mpp; gx += 20) g2.fillText(gx, W / 2 + (gx - cx) / mpp, 14);
  for (let gy = Math.ceil((cy - W / 2 * mpp) / 20) * 20; gy < cy + W / 2 * mpp; gy += 20) g2.fillText(gy, 2, W / 2 - (gy - cy) / mpp);
  return [cx, cy, road.min, road.max];
};
const col_ = { wallAt: (x, y) => col.wallAt(x, y) };
// debug: scan the whole road on a grid for wall hits with road all around them (≥ r m in 8 directions at the same
// height), i.e. blocks in the middle of the road; returns counts by the model group that causes them and examples
window.__scan = (step = 0.25, r = 0.6) => {
  const by = {}, ex = [];
  for (let y = road.min[1]; y <= road.max[1]; y += step) for (let x = road.min[0]; x <= road.max[0]; x += step) for (const [g] of road.probe(x, y)) {
    if (!wallAt(x, y, g)) continue;
    let inside = true;
    for (let k = 0; k < 8 && inside; k++) { const a = k * Math.PI / 4, h = road.ground(x + Math.cos(a) * r, y + Math.sin(a) * r, g + 0.4); if (h === null || Math.abs(h - g) > 0.45) inside = false; }
    if (!inside) continue;
    const hit = col.wallAt(x, y).filter((e) => e[1] > g + 0.35 && e[0] < g + 0.5);
    for (const e of hit) by[e[2]] = (by[e[2]] || 0) + 1;
    if (ex.length < 40) ex.push([+x.toFixed(2), +y.toFixed(2), +g.toFixed(2), hit]);
  }
  return { by, ex };
};
// debug: drivable run (m) in 16 directions from a point (default: the car), checked like the autopilot
window.__runs = (x = car.x, y = car.y) => Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * TAU, ca = Math.cos(a), sa = Math.sin(a); let run = 0; for (let d = 0.25; d <= 40; d += 0.25) { let ok = true; for (const o of [-0.36, 0, 0.36]) if (!drivable(x + ca * d + sa * o, y + sa * d - ca * o, car.z)) { ok = false; break; } if (!ok) break; run = d; } return [+(a).toFixed(2), run]; });
window.__spawn = () => spawn;
window.__dbg = (x, y, z) => { const g = road.ground(x, y, z + 1.5); if (g !== null && Math.abs(g - z) < 1.5) return wallAt(x, y, g) ? '#' : '.'; const h = col.ground(x, y, z + 1.5); return h !== null && wallAt(x, y, h) ? '#' : ' '; };
// debug: walk from (x, y) along angle a and report the first undrivable sample and why
window.__why = (x, y, a, z = car.z) => { for (let d = 0.25; d <= 40; d += 0.25) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, g = road.ground(px, py, z + 1.5); if (g === null || Math.abs(g - z) >= 1.5 || wallAt(px, py, g)) return { d, g, all: col.probe(px, py), wall: g !== null && wallAt(px, py, g), wallCell: col.wallAt ? col.wallAt(px, py) : null }; } return null; };
// debug: per wheel [road height, height − car z, wall?] at the car's current pose
window.__wheels = () => { const fx = Math.cos(car.h), fy = Math.sin(car.h), rx = Math.sin(car.h), ry = -Math.cos(car.h); return WHEELS.map(([wx, wy]) => { const px = car.x + (rx * wx + fx * wy) * SPREAD, py = car.y + (ry * wx + fy * wy) * SPREAD, g = roadAt(px, py, car.z + 0.35); return [g === null ? null : +g.toFixed(2), g === null ? null : +(g - car.z).toFixed(2), g === null ? null : wallAt(px, py, g), col.probe(px, py)]; }); };
loadMap().then(() => {
  // the road surfaces alone: road, start line, bridge deck and tunnel floor
  const roadGroups = groups.filter((g) => g.raw && /F_road|roadstart|bridge_set|tunnel/i.test(g.name));
  // up-facing triangles only: a tunnel ceiling or the bridge's underside is not something the wheels can stand on
  road = buildCollision(roadGroups.map((g) => g.raw), [], true); road.names = roadGroups.map((g) => g.name);
  // start on the road at the start line; if the line's centre isn't road, use the nearest road point
  let sx = P.x, sy = P.y;
  if (road.ground(sx, sy, P.z + 2) === null) { let best = 1e18; for (const g of roadGroups) for (let i = 0; i < g.raw.length; i += 3) { const d = (g.raw[i] - P.x) ** 2 + (g.raw[i + 1] - P.y) ** 2; if (d < best) { best = d; sx = g.raw[i]; sy = g.raw[i + 1]; } } }
  // face along the road: the direction with the longest run that is road and clear of fences and walls
  const sz = road.ground(sx, sy, P.z + 4) ?? P.z;
  let bestH = P.face, run = -1;
  for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU; let r = 0; for (let d = 0.5; d < 40; d += 0.5) { if (!drivable(sx + Math.cos(a) * d, sy + Math.sin(a) * d, sz)) break; r = d; } if (r > run) { run = r; bestH = a; } }
  spawn = { x: sx, y: sy, z: sz, h: bestH };
  resetCar(); cam.yaw = spawn.h;
  state = "play"; $("loading").classList.add("out"); $("hud").classList.remove("hide");
}).catch((e) => { console.error(e); $("ld-msg").textContent = "Could not load the map: " + e.message; });
requestAnimationFrame(frame);
