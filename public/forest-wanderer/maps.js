// Echoes of the Hollow map (DESIGN.md §3). Pure data + maths, shared by the main thread and worker.js.
// The Hollow: a 200×200 m heightfield (z up) shaped by a base function, flattened clearings (pads), a stream and a
// pond (rivers, with a water plane at waterZ) and dirt trails (roads). Props are placed explicitly or scattered.
// Props are placed explicitly (story locations) and scattered (trees, rocks, bushes) away from roads and water.
import { mulberry32, fbm, vnoise, clamp, lerp, smooth } from "./mesh.js";

export const HALF = 100, RES = 1;
const nrm = (v) => { const l = Math.hypot(...v); return v.map((a) => a / l); };

// ------------------------------------------------------------------ environments (lighting presets)
export const ENVS = {
  afternoon: { sun: nrm([-0.8, 0.45, 0.42]), sunCol: [2.25, 1.85, 1.35], ambT: [0.36, 0.42, 0.55], ambB: [0.18, 0.16, 0.11], skyTop: [0.3, 0.5, 0.85], skyHor: [0.95, 0.85, 0.7], glow: [1.2, 0.9, 0.6], fog: 0.009, moon: 0, stars: 0, eclipse: 0 },
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

// ------------------------------------------------------------------ the Hollow (the one map)
// spec: { name, env, base(x,y), pads[{x,y,r,h,blend,dirt}], rivers[{pts,w,depth}], islands[], roads[{pts,w}], waterZ,
//         props[], spots{}, treeDensity(x,y), treeKinds[[kind, weight]], grass }
function hollow() {
  const S = {
    name: "The Hollow", place: "The Hollow", env: "afternoon", waterZ: 2.6, grass: 1.25,
    base: (x, y) => 5.5 + (fbm(x * 0.013, y * 0.013, 61, 4) - 0.5) * 10 + (fbm(x * 0.05, y * 0.05, 62, 2) - 0.5) * 1.6 + Math.max(0, Math.max(Math.abs(x), Math.abs(y)) - 78) * 0.35,
    pads: [{ x: 0, y: 0, r: 13, h: 5.5, blend: 12, dirt: 0.15 }, { x: 36, y: 40, r: 10, h: 7, blend: 10, dirt: 0.25 }, { x: -42, y: 30, r: 9, h: 6, blend: 10, dirt: 0.15 }, { x: 56, y: -52, r: 8, h: 12, blend: 14 }, { x: -14, y: -16, r: 7, h: 5, blend: 8, dirt: 0.3 }],
    rivers: [
      { pts: spline([[-110, -22], [-70, -30], [-40, -36], [-5, -44], [30, -36], [60, -30], [110, -42]], 3), w: 6, depth: 1.0 },
      { pts: spline([[-34, 0], [-30, 4], [-25, 8]], 2), w: 14, depth: 1.4 },
    ],
    islands: [],
    roads: [
      { pts: spline([[0, -3], [6, 14], [20, 30], [36, 40]]), w: 2.4 }, { pts: spline([[0, 0], [-16, 12], [-30, 22], [-42, 30]]), w: 2.2 },
      { pts: spline([[0, 0], [4, -18], [2, -40], [3, -48], [8, -70], [6, -100]]), w: 2.4 }, { pts: spline([[2, -8], [24, -24], [44, -40], [56, -52]]), w: 2.2 },
      { pts: spline([[0, 0], [-8, -10], [-14, -16]]), w: 2 },
    ],
    props: [], spots: {},
    treeDensity: (x, y) => { const r = Math.hypot(x, y); return r < 18 ? 0 : 0.62 + 0.3 * smooth(80, 96, Math.max(Math.abs(x), Math.abs(y))); },
    treeKinds: [["pine", 3.2], ["oak", 3], ["birch", 1.6], ["autumn", 0.7], ["willow", 0.4], ["dead", 0.3]],
  };
  const P = S.props;
  P.push({ t: "bridge", a: [2.4, -38], b: [3.2, -50], w: 2.6, log: 1 });
  P.push({ t: "cottage", x: -16, y: -19, rot: 0.5, v: 2, hx: 3.4, hy: 2.7 });
  P.push({ t: "campfire", x: 5, y: 3, r: 0.8, id: "camp" });
  for (const [x, y, rot] of [[7.5, 1.5, 0.4], [3.8, 6.2, 2.2]]) P.push({ t: "log", x, y, rot, hx: 1.4, hy: 0.4 });
  P.push({ t: "signpost", x: -2.5, y: 3.5, r: 0.3 });
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2 + 0.3; P.push({ t: "pillar", x: 36 + Math.cos(a) * 8, y: 40 + Math.sin(a) * 8, r: 0.8, broken: k % 2 }); }
  P.push({ t: "shrine", x: 36, y: 42, r: 3.2 });
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; P.push({ t: "pillar", x: -42 + Math.cos(a) * 7, y: 30 + Math.sin(a) * 7, r: 0.8, broken: 1 }); }
  for (const [x, y, rot] of [[-20, -50, 0.4], [24, 8, -0.8], [-30, 44, 1.2], [44, 12, 0.3], [-58, -4, 1.9], [62, 30, 0.7]]) P.push({ t: "log", x, y, rot, hx: 3, hy: 0.5 });
  for (const [x, y] of [[-12, -13], [-11, -14.2]]) P.push({ t: "barrel", x, y, r: 0.45 });
  P.push({ t: "fence", a: [-24, -12], b: [-8, -12] });
  S.spots = { start: [0, -4] };
  return S;
}
export const MAPS = [hollow];


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
