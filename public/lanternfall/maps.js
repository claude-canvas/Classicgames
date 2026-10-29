// Lanternfall chapter maps (DESIGN.md §3). Pure data + maths, shared by the main thread and worker.js.
// A map: 200×200 m heightfield (z up) shaped by a base function, flattened pads, rivers (with a water plane at
// waterZ), islands and roads (roads with a height per point become shelves, e.g. the Spire's spiral road).
// Props are placed explicitly (story locations) and scattered (trees, rocks, bushes) away from roads and water.
import { mulberry32, fbm, vnoise, clamp, lerp, smooth } from "./mesh.js";

export const HALF = 100, RES = 1;
const nrm = (v) => { const l = Math.hypot(...v); return v.map((a) => a / l); };

// ------------------------------------------------------------------ environments (lighting presets)
export const ENVS = {
  sunset: { sun: nrm([-1, 0.35, 0.16]), sunCol: [2.2, 1.55, 0.95], ambT: [0.34, 0.36, 0.48], ambB: [0.17, 0.14, 0.1], skyTop: [0.26, 0.42, 0.72], skyHor: [1.0, 0.72, 0.5], glow: [1.4, 0.85, 0.45], fog: 0.006, moon: 0, stars: 0, eclipse: 0 },
  dusk: { sun: nrm([-0.6, 0.8, 0.05]), sunCol: [0.9, 0.62, 0.75], ambT: [0.26, 0.3, 0.52], ambB: [0.1, 0.1, 0.16], skyTop: [0.1, 0.13, 0.34], skyHor: [0.72, 0.45, 0.6], glow: [0.9, 0.45, 0.5], fog: 0.012, moon: 0, stars: 0.35, eclipse: 0 },
  night: { sun: nrm([0.45, 0.8, 0.42]), sunCol: [0.42, 0.52, 0.78], ambT: [0.1, 0.13, 0.25], ambB: [0.04, 0.05, 0.08], skyTop: [0.02, 0.035, 0.09], skyHor: [0.1, 0.14, 0.26], glow: [0.35, 0.42, 0.6], fog: 0.009, moon: 1, stars: 1, eclipse: 0 },
  eclipse: { sun: nrm([0.2, 0.9, 0.38]), sunCol: [0.7, 0.32, 0.5], ambT: [0.18, 0.1, 0.22], ambB: [0.08, 0.03, 0.06], skyTop: [0.06, 0.02, 0.08], skyHor: [0.45, 0.12, 0.2], glow: [1.0, 0.3, 0.4], fog: 0.011, moon: 0, stars: 0.4, eclipse: 1 },
  dawn: { sun: nrm([0.2, 0.95, 0.2]), sunCol: [2.3, 1.75, 1.2], ambT: [0.36, 0.4, 0.52], ambB: [0.18, 0.15, 0.12], skyTop: [0.32, 0.5, 0.8], skyHor: [1.0, 0.8, 0.62], glow: [1.5, 1.0, 0.6], fog: 0.006, moon: 0, stars: 0, eclipse: 0 },
};

// ------------------------------------------------------------------ geometry helpers
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return { d: Math.hypot(px - ax - dx * t, py - ay - dy * t), t };
}
// nearest point on a polyline: distance and interpolated height (if points carry one)
export function polyDist(pts, x, y) {
  if (!pts.bb) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } pts.bb = [a - 25, b - 25, c + 25, d + 25]; }
  if (x < pts.bb[0] || y < pts.bb[1] || x > pts.bb[2] || y > pts.bb[3]) return { d: 1e9, h: null };
  let best = 1e9, hh = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], q = segDist(x, y, a[0], a[1], b[0], b[1]);
    if (q.d < best) { best = q.d; hh = a.length > 2 ? lerp(a[2], b[2], q.t) : null; }
  }
  return { d: best, h: hh };
}
// smooth Catmull-Rom resampling of a polyline (keeps a third coordinate if present)
function spline(pts, step = 2) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------ chapter specs
// spec: { name, env, base(x,y), pads[{x,y,r,h,blend,dirt}], rivers[{pts,w,depth}], islands[pads], roads[{pts,w}],
//         waterZ, props[], spots{}, treeDensity(x,y), treeKinds[[kind, weight]], grass }
function ch1() {
  const S = {
    name: "The Last Lantern", place: "Willowmere", env: "sunset", waterZ: 0.35, grass: 1,
    base: (x, y) => 2 + (fbm(x * 0.012, y * 0.012, 11, 4) - 0.5) * 9 + Math.max(0, Math.hypot(x, y) - 70) * 0.12,
    pads: [{ x: 0, y: 0, r: 22, h: 2.2, blend: 12, dirt: 0.55 }, { x: 0, y: 41, r: 7, h: 8.5, blend: 16 }, { x: 0, y: 78, r: 9, h: 3.2, blend: 10 }, { x: -10, y: -32, r: 9, h: 1.8, blend: 8 }, { x: 28, y: -26, r: 14, h: 1.8, blend: 10 }],
    rivers: [{ pts: spline([[-110, -60], [-60, -50], [-20, -55], [20, -54], [60, -62], [110, -55]], 3), w: 8, depth: 1.4 }],
    islands: [],
    roads: [
      { pts: spline([[-10, -30], [-6, -18], [0, -6], [0, 0]]), w: 3 }, { pts: spline([[0, 0], [0, 14], [1, 28], [0, 37]]), w: 3 },
      { pts: spline([[0, 14], [7, 30], [6, 52], [1, 66], [0, 78], [0, 102]]), w: 3.4 }, { pts: spline([[0, 0], [24, 3], [52, 8], [102, 12]]), w: 3 },
      { pts: spline([[0, 0], [-26, -3], [-60, 2], [-102, 4]]), w: 3 }, { pts: spline([[-6, -18], [0, -40], [0, -68], [3, -102]]), w: 3 },
    ],
    props: [], spots: {},
    treeDensity: (x, y) => { const r = Math.hypot(x, y); return r < 34 ? 0 : r < 55 ? 0.15 : 0.5 + 0.4 * smooth(80, 96, Math.max(Math.abs(x), Math.abs(y))); },
    treeKinds: [["oak", 5], ["birch", 2], ["pine", 2], ["autumn", 1.5]],
  };
  const P = S.props;
  // cottages around the square, Mira's home, Sela's herb house, Hob's bakery
  for (const [x, y, rot, v, name] of [[-15, -12, 0.6, 0, ""], [-21, 5, -0.25, 1, "sela"], [-11, 18, 0.45, 2, ""], [13, 17, -0.4, 0, ""], [20, 1, 1.6, 3, "hob"], [14, -14, -0.7, 1, ""], [-11, -36, 0.25, 2, "home"], [26, -28, 0.2, 0, ""]]) P.push({ t: "cottage", x, y, rot, v, name, hx: 3.4, hy: 2.7 });
  P.push({ t: "well", x: 0, y: 0, r: 1.3 });
  P.push({ t: "lanternTower", x: 0, y: 42, r: 1.6, id: "last" });
  for (const [x, y, id] of [[-11, -1, "lamp1"], [10, -7, "lamp2"], [5, 12, "lamp3"]]) P.push({ t: "lamp", x, y, id, r: 0.35 });
  for (const [x, y] of [[-4, -6], [6, 6], [-2, 22], [3, 33], [-3, 46], [4, 58]]) P.push({ t: "lamp", x, y, id: "", r: 0.3, small: 1 });
  for (const [x, y, rot] of [[15, -3, 1.6], [9, 4, 0.5], [-7, 8, -0.4]]) P.push({ t: "stall", x, y, rot, hx: 1.3, hy: 0.8 });
  for (let i = 0; i < 12; i++) { const a = i * 0.52; P.push({ t: "barrel", x: Math.cos(a) * 9 + (i % 2) * 0.6 + (i > 6 ? 30 : 0) * 0, y: Math.sin(a) * 9, r: 0.45 }); }
  P.splice(P.length - 12, 12);
  for (const [x, y] of [[17, 5], [18, 6.2], [-18, 8.6], [12, -11], [-13, -9]]) P.push({ t: "barrel", x, y, r: 0.45 });
  for (const [x, y] of [[16.5, -5.5], [-17, 9.5], [11, 13]]) P.push({ t: "crate", x, y, rot: x * 0.37, r: 0.6 });
  // the north gate and the fence line on either side
  P.push({ t: "gate", x: 0, y: 77, rot: 0, hx: 3.4, hy: 0.6 });
  P.push({ t: "fence", a: [-40, 77], b: [-3.6, 77] }); P.push({ t: "fence", a: [3.6, 77], b: [40, 77] });
  // fields, hay and fences south-east; a bridge over the brook on the south road
  for (let i = 0; i < 6; i++) P.push({ t: "hay", x: 22 + (i % 3) * 6, y: -30 - Math.floor(i / 3) * 6, r: 0.9 });
  P.push({ t: "fence", a: [16, -20], b: [40, -20] }); P.push({ t: "fence", a: [40, -20], b: [40, -42] }); P.push({ t: "fence", a: [16, -20], b: [16, -42] });
  P.push({ t: "fence", a: [-20, -26], b: [-2, -26] }); P.push({ t: "fence", a: [-20, -26], b: [-20, -44] });
  P.push({ t: "bridge", a: [0.6, -46], b: [1.2, -64], w: 3.2 });
  P.push({ t: "signpost", x: 3, y: -3.5, r: 0.3 });
  for (const [x, y] of [[-8, -26], [-14, -26], [24, -18], [32, -18]]) P.push({ t: "flowers", x, y });
  S.spots = { start: [-9, -29], bram: [2.2, 38], sela: [-15.5, 3.5], rook: [2.5, 73], hob: [16.5, -0.5], lila: [3, -4], gate: [0, 79], hill: [0, 36], vesper: [-1, 44.5] };
  return S;
}
function ch2() {
  const S = {
    name: "The Whispering Woods", place: "Whispering Woods", env: "dusk", waterZ: -0.2, grass: 0.8,
    base: (x, y) => 2 + (fbm(x * 0.016, y * 0.016, 21, 4) - 0.5) * 10,
    pads: [{ x: 0, y: -84, r: 8, h: 2, blend: 8 }, { x: -50, y: 12, r: 12, h: 2.5, blend: 10, dirt: 0.2 }, { x: 46, y: 22, r: 12, h: 3, blend: 10, dirt: 0.2 }, { x: 0, y: 55, r: 12, h: 3.2, blend: 10, dirt: 0.2 }, { x: 0, y: 84, r: 15, h: 4, blend: 12, dirt: 0.35 }, { x: -10, y: -50, r: 6, h: 2, blend: 6 }],
    rivers: [{ pts: spline([[-110, -32], [-50, -36], [0, -34], [50, -30], [110, -36]], 3), w: 6, depth: 1.0 }],
    islands: [],
    roads: [
      { pts: spline([[0, -102], [0, -84], [-4, -60], [-4, -40], [0, -12], [0, 20], [0, 55], [0, 84]]), w: 3 },
      { pts: spline([[0, -6], [-22, 0], [-50, 12]]), w: 2.6 }, { pts: spline([[0, 6], [24, 12], [46, 22]]), w: 2.6 },
      { pts: spline([[0, 84], [24, 88], [60, 90], [102, 92]]), w: 2.8 },
    ],
    props: [], spots: {},
    treeDensity: (x, y) => 0.85,
    treeKinds: [["pine", 3], ["oak", 3], ["birch", 1.5], ["dead", 0.6], ["autumn", 0.8]],
  };
  const P = S.props;
  P.push({ t: "bridge", a: [-4.3, -26], b: [-3.9, -43], w: 3, log: 1 });
  P.push({ t: "thorns", x: -10, y: -51, r: 2.6, id: "tobiThorns", ring: 1 });
  P.push({ t: "thorns", x: 0, y: -14, r: 3.2, id: "roadThorns" });
  P.push({ t: "thorns", x: 0, y: 96, r: 3.5, id: "shrineThorns", hidden: 1 });
  for (const [x, y, id] of [[-50, 12, "shardA"], [46, 22, "shardB"], [0, 55, "shardC"]]) { P.push({ t: "pedestal", x, y, id, r: 0.9 }); for (let k = 0; k < 5; k++) { const a = (k / 5) * 6.283 + 0.3; P.push({ t: "pillar", x: x + Math.cos(a) * 9, y: y + Math.sin(a) * 9, r: 0.8, broken: k % 2 }); } }
  P.push({ t: "shrine", x: 0, y: 86, r: 3.2 });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; P.push({ t: "pillar", x: Math.cos(a) * 12, y: 86 + Math.sin(a) * 12, r: 0.8, broken: k % 3 === 0 }); }
  for (const [x, y, rot] of [[-14, -66, 0.4], [12, -20, -0.8], [-28, 34, 1.2], [30, 50, 0.3]]) P.push({ t: "log", x, y, rot, hx: 3, hy: 0.5 });
  P.push({ t: "campfire", x: 3, y: -80, r: 0.8, id: "camp" });
  S.spots = { start: [0, -88], tobi: [-10, -51], shardA: [-50, 12], shardB: [46, 22], shardC: [0, 55], shrine: [0, 80], morrow: [0, 90], exit: [52, 89.5] };
  return S;
}
function ch3() {
  const S = {
    name: "The Drowned Mill", place: "Black River", env: "night", waterZ: 0.0, grass: 0.7,
    base: (x, y) => 2.4 + (fbm(x * 0.014, y * 0.014, 31, 4) - 0.5) * 8 + (y > 40 ? (y - 40) * 0.08 : 0),
    pads: [{ x: 0, y: -70, r: 8, h: 2.4, blend: 8 }, { x: -25, y: -4, r: 9, h: 1.4, blend: 8 }, { x: 46, y: -8, r: 16, h: 1.6, blend: 10, dirt: 0.35 }],
    rivers: [{ pts: spline([[-110, 18], [-60, 22], [-10, 20], [40, 16], [110, 22]], 3), w: 24, depth: 2.2 }],
    islands: [{ x: -45, y: 21, r: 5.5, h: 0.9, blend: 3 }, { x: -10, y: 21, r: 5, h: 0.9, blend: 3 }, { x: 24, y: 18, r: 5.5, h: 0.9, blend: 3 }],
    roads: [
      { pts: spline([[0, -102], [0, -70], [-10, -40], [-22, -14], [-25, -2]]), w: 3 }, { pts: spline([[-10, -40], [20, -26], [44, -10]]), w: 3 },
      { pts: spline([[-25, -2], [-45, 2], [-62, 0]]), w: 2.4 }, { pts: spline([[-22, -14], [-10, -4], [-10, 6]]), w: 2.2 }, { pts: spline([[20, -26], [24, -6], [24, 6]]), w: 2.2 },
    ],
    props: [], spots: {},
    treeDensity: (x, y) => (y > 36 ? 0.75 : 0.42),
    treeKinds: [["willow", 3], ["oak", 2], ["dead", 1.5], ["pine", 1.5]],
  };
  const P = S.props;
  P.push({ t: "dock", a: [-25, 2], b: [-25, 10.5], w: 3 });
  P.push({ t: "plank", a: [-45, 7], b: [-45, 16], w: 1.6 }); P.push({ t: "plank", a: [-10, 7], b: [-10, 16.5], w: 1.6 }); P.push({ t: "plank", a: [24, 6], b: [24, 13], w: 1.6 });
  for (const [x, y, id] of [[-45, 21, "b1"], [-10, 21, "b2"], [24, 18.5, "b3"], [58, 2, "b4"]]) P.push({ t: "brazier", x, y, id, r: 0.6 });
  P.push({ t: "mill", x: 46, y: 0, rot: 0, hx: 5, hy: 4 });
  P.push({ t: "table", x: 44, y: -6, r: 0.8, id: "journal" });
  for (const [x, y] of [[-20, -10], [-30, -9], [40, -16], [52, -16], [34, -6]]) P.push({ t: "lamp", x, y, id: "", r: 0.3, small: 1, lit: 1 });
  P.push({ t: "fence", a: [32, -20], b: [60, -20] }); P.push({ t: "fence", a: [60, -20], b: [62, 6] });
  for (const [x, y] of [[50, -14], [51, -12.5], [36, -12]]) P.push({ t: "barrel", x, y, r: 0.45 });
  P.push({ t: "boat", x: -27.5, y: 13.5, rot: 0, id: "ferry" });
  P.push({ t: "farTower", x: 0, y: 150 });
  S.spots = { start: [0, -72], oswin: [-23, 6], b1: [-45, 21], b2: [-10, 21], b3: [24, 18.5], b4: [58, 2], mill: [44, -8], journal: [44, -6], morrow: [46, -12], dock: [-25, 6], rookIn: [10, -40] };
  return S;
}
function ch4() {
  // the Spire mountain: a cone with a spiral road shelf and the summit arena
  const road = [];
  for (let i = 0; i <= 120; i++) { const t = i / 120, a = -Math.PI / 2 - t * Math.PI * 3, r = lerp(66, 21, t), h = lerp(2.5, 24, smooth(0, 1, t) * 0.7 + t * 0.3); road.push([Math.cos(a) * r, Math.sin(a) * r, h]); }
  road.push([0, -14, 24]);
  const S = {
    name: "The Hollow Spire", place: "The Hollow Spire", env: "eclipse", waterZ: -5, grass: 0.35,
    base: (x, y) => { const r = Math.hypot(x, y); return 1.5 + 27 * (1 - smooth(18, 74, r)) + (fbm(x * 0.03, y * 0.03, 41, 4) - 0.5) * 6 * smooth(10, 30, r); },
    pads: [{ x: 0, y: 0, r: 19, h: 24, blend: 5, dirt: 0.5 }, { x: 0, y: -82, r: 10, h: 2.5, blend: 10 }],
    rivers: [], islands: [],
    roads: [{ pts: road, w: 5.5 }, { pts: spline([[0, -102], [0, -82], [0, -66]]), w: 3.4 }],
    props: [], spots: {},
    treeDensity: (x, y) => (Math.hypot(x, y) > 72 ? 0.45 : 0.04),
    treeKinds: [["dead", 4], ["pine", 1]],
  };
  const P = S.props, at = (t) => road[Math.round(t * 120)];
  P.push({ t: "spire", x: 0, y: 12, r: 6 });
  for (let k = 0; k < 10; k++) { const a = (k / 10) * 6.283 + 0.2; if (Math.abs(a - 4.71) < 0.4) continue; P.push({ t: "pillar", x: Math.cos(a) * 17, y: Math.sin(a) * 17, r: 0.9, broken: k % 3 === 1, dark: 1 }); }
  const c = at(0.62); P.push({ t: "cage", x: c[0] * 1.06, y: c[1] * 1.06, r: 1.3, id: "cage" });
  for (const t of [0.12, 0.3, 0.5, 0.75, 0.9]) { const p = at(t); P.push({ t: "brazier", x: p[0] * 0.93, y: p[1] * 0.93, id: "", r: 0.5, dark: 1 }); }
  for (const t of [0.2, 0.42, 0.58, 0.83]) { const p = at(t), q = at(t + 0.008); P.push({ t: "banner", x: p[0] * 1.08, y: p[1] * 1.08, rot: Math.atan2(q[1] - p[1], q[0] - p[0]), r: 0.3 }); }
  S.spots = { start: [0, -86], w1: at(0.2), w2: at(0.45), cage: at(0.62), w3: at(0.8), summit: [0, -12], arena: [0, -6], vesper: [0, 2], road: road };
  return S;
}
export const MAPS = [ch1, ch2, ch3, ch4];

// ------------------------------------------------------------------ build: height grid, masks, scattered props
export function buildMap(ch) {
  const S = MAPS[ch]();
  const N = (2 * HALF) / RES + 1;
  const H = new Float32Array(N * N), DIRT = new Float32Array(N * N);
  const rawH = (x, y) => {
    let h = S.base(x, y), dirt = 0;
    for (const p of S.pads) { const k = 1 - smooth(p.r, p.r + (p.blend || 10), Math.hypot(x - p.x, y - p.y)); h = lerp(h, p.h, k); if (p.dirt) dirt = Math.max(dirt, p.dirt * (1 - smooth(p.r * 0.6, p.r, Math.hypot(x - p.x, y - p.y))) * (0.6 + 0.4 * vnoise(x * 0.3, y * 0.3, 5))); }
    for (const rv of S.rivers) { const q = polyDist(rv.pts, x, y), half = rv.w / 2; const k = 1 - smooth(half - 1, half + 5, q.d); const bed = S.waterZ - rv.depth * (1 - smooth(half * 0.4, half + 0.5, q.d)); h = lerp(h, Math.min(h, bed), k); }
    for (const p of S.islands) { const k = 1 - smooth(p.r, p.r + p.blend, Math.hypot(x - p.x, y - p.y)); h = lerp(h, p.h, k); }
    for (const rd of S.roads) {
      const q = polyDist(rd.pts, x, y), half = rd.w / 2;
      if (q.h !== null) { const k = 1 - smooth(half, half + 3.5, q.d); h = lerp(h, q.h, k); }
      else h -= 0.1 * (1 - smooth(half, half + 1, q.d));
      dirt = Math.max(dirt, (1 - smooth(half - 0.6, half + 0.6, q.d + (vnoise(x * 0.8, y * 0.8, 7) - 0.5) * 0.8)));
    }
    return [h, dirt];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const [h, d] = rawH(-HALF + i * RES, -HALF + j * RES); H[j * N + i] = h; DIRT[j * N + i] = d; }
  const sample = (A, x, y) => {
    const fx = clamp((x + HALF) / RES, 0, N - 1.001), fy = clamp((y + HALF) / RES, 0, N - 1.001), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    return (A[j * N + i] * (1 - tx) + A[j * N + i + 1] * tx) * (1 - ty) + (A[(j + 1) * N + i] * (1 - tx) + A[(j + 1) * N + i + 1] * tx) * ty;
  };
  S.N = N; S.H = H; S.DIRT = DIRT;
  S.h = (x, y) => sample(H, x, y);
  S.dirt = (x, y) => sample(DIRT, x, y);
  // walkable decks (bridges, planks, dock): segments with a deck height
  S.decks = [];
  for (const p of S.props) if (p.t === "bridge" || p.t === "plank" || p.t === "dock") {
    const ha = S.h(...p.a), hb = S.h(...p.b), top = p.t === "bridge" ? Math.max(ha, hb, S.waterZ + 0.9) + 0.25 : S.waterZ + 0.35;
    p.za = p.t === "bridge" ? Math.max(ha, S.waterZ + 0.6) + 0.2 : top; p.zb = p.t === "bridge" ? Math.max(hb, S.waterZ + 0.6) + 0.2 : top; p.top = top;
    S.decks.push(p);
  }
  // ground height for walking (decks override the terrain)
  S.ground = (x, y) => {
    let g = S.h(x, y);
    for (const d of S.decks) { const q = segDist(x, y, d.a[0], d.a[1], d.b[0], d.b[1]); if (q.d < d.w / 2 + 0.4) { const arch = d.t === "bridge" ? Math.sin(q.t * Math.PI) * 0.5 : 0; g = Math.max(g, lerp(d.za, d.zb, q.t) + arch); } }
    return g;
  };
  // scatter trees, rocks and bushes
  const R = mulberry32(1000 + ch * 77);
  const near = (x, y, pad) => {
    for (const rd of S.roads) if (polyDist(rd.pts, x, y).d < rd.w / 2 + pad) return true;
    for (const p of S.props) { const px = p.x ?? (p.a[0] + p.b[0]) / 2, py = p.y ?? (p.a[1] + p.b[1]) / 2, pr = p.r ?? Math.max(p.hx || 2, p.hy || 2, p.a ? Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1]) / 2 : 0); if (Math.hypot(x - px, y - py) < pr + pad) return true; }
    for (const p of S.pads) if (Math.hypot(x - p.x, y - p.y) < p.r * 0.85 + pad * 0.5) return true;
    return false;
  };
  const kinds = S.treeKinds, tot = kinds.reduce((a, k) => a + k[1], 0);
  const scattered = [];
  for (let y = -HALF + 2; y < HALF - 1; y += 3.2) for (let x = -HALF + 2; x < HALF - 1; x += 3.2) {
    const px = x + (R() - 0.5) * 2.6, py = y + (R() - 0.5) * 2.6, h = S.h(px, py);
    if (h < S.waterZ + 0.35) continue;
    const edge = smooth(86, 97, Math.max(Math.abs(px), Math.abs(py)));
    const dens = Math.max(S.treeDensity(px, py), edge) * (0.55 + 0.9 * fbm(px * 0.03, py * 0.03, 50 + ch, 2));
    const roll = R();
    if (roll < dens * 0.32) {
      if (near(px, py, 2.6)) continue;
      let k = R() * tot, kind = kinds[0][0]; for (const [n, w] of kinds) { if ((k -= w) < 0) { kind = n; break; } }
      scattered.push({ t: "tree", kind, x: px, y: py, s: 0.8 + R() * 0.5, r: 0.55, seed: Math.floor(R() * 1e6) });
    } else if (roll < dens * 0.32 + 0.05) { if (!near(px, py, 1.4)) scattered.push({ t: "rock", x: px, y: py, s: 0.4 + R() * 1.1, r: 0.6, seed: Math.floor(R() * 1e6) }); }
    else if (roll < dens * 0.32 + 0.14) { if (!near(px, py, 1.2)) scattered.push({ t: "bush", x: px, y: py, s: 0.6 + R() * 0.7, seed: Math.floor(R() * 1e6) }); }
  }
  for (const p of scattered) { if (p.t === "rock") p.r = p.s * 0.8; if (p.t === "bush") p.r = 0; }
  S.props.push(...scattered);
  for (const p of S.props) if (p.x !== undefined) p.z = S.h(p.x, p.y);
  // anchor points shared by the renderer and the game (flames, altar tops, shard sockets)
  for (const p of S.props) {
    const z = p.z;
    if (p.t === "lamp") p.flame = [p.x + 0.4, p.y, z + (p.small ? 2.1 : 2.8) - 0.1];
    if (p.t === "lanternTower") p.flame = [p.x, p.y, z + 6.0];
    if (p.t === "brazier") p.flame = [p.x, p.y, z + 1.35];
    if (p.t === "campfire") p.flame = [p.x, p.y, z + 0.3];
    if (p.t === "pedestal") p.top = z + 1.15;
    if (p.t === "table") p.top = z + 0.82;
    if (p.t === "shrine") { p.top = z + 1.8; for (let k = 0; k < 3; k++) { const a = k * 2.094 + Math.PI / 2; p["socket" + k] = [p.x + Math.cos(a) * 0.55, p.y + Math.sin(a) * 0.35, z + 1.85]; } }
  }
  S.ch = ch;
  return S;
}

// ------------------------------------------------------------------ walk grid (0.5 m): 1 = blocked
export const WRES = 0.5;
export function buildWalk(S) {
  const N = Math.round((2 * HALF) / WRES), G = new Uint8Array(N * N);
  const idx = (x, y) => { const i = Math.floor((x + HALF) / WRES), j = Math.floor((y + HALF) / WRES); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * WRES, y = -HALF + (j + 0.5) * WRES, h = S.h(x, y);
    const sl = Math.max(Math.abs(S.h(x + 0.5, y) - S.h(x - 0.5, y)), Math.abs(S.h(x, y + 0.5) - S.h(x, y - 0.5)));
    if (h < S.waterZ + 0.05 || sl > 0.8 || Math.max(Math.abs(x), Math.abs(y)) > 94) G[j * N + i] = 1;
  }
  const disc = (x, y, r) => { for (let yy = y - r; yy <= y + r; yy += WRES * 0.7) for (let xx = x - r; xx <= x + r; xx += WRES * 0.7) if (Math.hypot(xx - x, yy - y) <= r) { const k = idx(xx, yy); if (k >= 0) G[k] = 1; } };
  const rect = (x, y, rot, hx, hy) => { const c = Math.cos(rot), s = Math.sin(rot); for (let v = -hy; v <= hy; v += WRES * 0.6) for (let u = -hx; u <= hx; u += WRES * 0.6) { const k = idx(x + c * u - s * v, y + s * u + c * v); if (k >= 0) G[k] = 1; } };
  const seg = (a, b, w, val) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / (WRES * 0.5)); for (let i = 0; i <= n; i++) { const t = i / n, cx = lerp(a[0], b[0], t), cy = lerp(a[1], b[1], t), dx = (b[1] - a[1]) / L, dy = -(b[0] - a[0]) / L; for (let o = -w / 2; o <= w / 2; o += WRES * 0.5) { const k = idx(cx + dx * o, cy + dy * o); if (k >= 0) G[k] = val; } } };
  // solid: big props only (the camera keeps out of these)
  const SOL = new Uint8Array(N * N);
  for (const p of S.props) if ((p.hx && p.hx >= 2.5) || (p.r && p.r >= 3)) { const r = p.hx ? Math.max(p.hx, p.hy) : p.r; for (let yy = p.y - r; yy <= p.y + r; yy += WRES) for (let xx = p.x - r; xx <= p.x + r; xx += WRES) { if (p.hx) { const c = Math.cos(-(p.rot || 0)), s = Math.sin(-(p.rot || 0)), u = (xx - p.x) * c - (yy - p.y) * s, v = (xx - p.x) * s + (yy - p.y) * c; if (Math.abs(u) > p.hx + 0.4 || Math.abs(v) > p.hy + 0.4) continue; } else if (Math.hypot(xx - p.x, yy - p.y) > r) continue; const k = idx(xx, yy); if (k >= 0) SOL[k] = 1; } }
  for (const p of S.props) {
    if (p.t === "fence") seg(p.a, p.b, 0.4, 1);
    else if (p.hx) rect(p.x, p.y, p.rot || 0, p.hx + 0.3, p.hy + 0.3);
    else if (p.r && !p.ring && p.t !== "thorns" && p.t !== "tree") disc(p.x, p.y, p.r);
    else if (p.t === "tree") disc(p.x, p.y, 0.45 * p.s + 0.2);
  }
  for (const d of S.decks) { seg(d.a, d.b, d.w + 0.5, 0); seg([d.a[0] - (d.b[0] - d.a[0]) * 0.1, d.a[1] - (d.b[1] - d.a[1]) * 0.1], d.a, d.w + 0.5, 0); }
  // keep the gate opening clear
  for (const p of S.props) if (p.t === "gate") rect(p.x, p.y, 0, 2.6, 1.2), seg([p.x, p.y - 1.5], [p.x, p.y + 1.5], 4.4, 0);
  return { N, G, idx, blocked: (x, y) => { const k = idx(x, y); return k < 0 || G[k] === 1; }, solid: (x, y) => { const k = idx(x, y); return k >= 0 && SOL[k] === 1; } };
}
