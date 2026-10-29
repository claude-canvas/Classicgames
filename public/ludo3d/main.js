// LUDO 3D — the classic race game on a polished board, rendered with the projection3d library (Space).
//
// Rules (same as the 2D version): roll a 6 to bring a pawn out; pawns run once round the 52-square track and up their
// own coloured lane to the pyramid in the middle (exact roll needed). Landing on an opponent outside a star square
// sends it back to its yard. A 6, a capture or bringing a pawn home earns another roll. First with all four home wins.
//
// The turn plays out as a sequence of awaited steps (think → roll → show → choose → hop, hop, hop …) on a game clock,
// so computer players move at a calm, readable pace (Relaxed / Normal / Fast), pausing stops everything, and captures
// can briefly run in slow motion. The camera leans toward whoever is playing and drifts after the moving pawn.
//
// Rendering: the table, board, tiles, yards and pyramid live in Space's buffers (built once). Pawns, the die and all
// effects are rebuilt every frame into GameSpace's dynamic buffers. Board cells are 1 unit; the board is centred on 0.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Audio } from "./audio.js";

const params = new URLSearchParams(location.search);
const AUTO = params.has("autoplay");              // demo / tests: four computer players, no title screen
const ZOOM = Math.max(1, Math.min(3, +params.get("zoom") || 1));   // screenshots: frame closer
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ rules data (rows/cols of the classic 15 × 15 board)

const GLOBAL_PATH = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8],
    [13, 8], [14, 8], [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];
const START_INDEX = [0, 13, 26, 39];
const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const HOME_STRETCH = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];
const CORNER_ORIGIN = [[0, 0], [0, 9], [9, 9], [9, 0]];
const SLOT_REL = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];
const NAMES = ["Red", "Green", "Yellow", "Blue"];
const COLORS = [[0.92, 0.18, 0.16], [0.16, 0.72, 0.3], [1.0, 0.76, 0.1], [0.2, 0.45, 0.95]];
const CSS = ["#ef4444", "#22c55e", "#eab308", "#3b82f6"];
const FACE_DIR = [[-1, 0], [0, -1], [1, 0], [0, 1]];       // which side of the pyramid each colour's lane arrives at
const PACES = { relaxed: 0.7, normal: 1, fast: 1.8 };

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeInOut = (t) => t * t * (3 - 2 * t);
const mix3 = (a, b, k) => [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

class Mesh {
    constructor(verts = 65536) { this.pos = new Float32Array(verts * 4); this.col = new Float32Array(verts * 4); this.n = 0; }
    reset() { this.n = 0; }
    grow() { const p = new Float32Array(this.pos.length * 2), c = new Float32Array(this.col.length * 2); p.set(this.pos); c.set(this.col); this.pos = p; this.col = c; }
    v(x, y, z, w, r, g, b, mat) {
        if ((this.n + 1) * 4 > this.pos.length) this.grow();
        const o = this.n++ * 4;
        this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.pos[o + 3] = w;
        this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b; this.col[o + 3] = mat;
    }
    tri(a, b, c, col, mat = 0) { this.v(a[0], a[1], a[2], 1, col[0], col[1], col[2], mat); this.v(b[0], b[1], b[2], 1, col[0], col[1], col[2], mat); this.v(c[0], c[1], c[2], 1, col[0], col[1], col[2], mat); }
    quad(a, b, c, d, col, mat = 0) { this.tri(a, b, c, col, mat); this.tri(a, c, d, col, mat); }
    sprite(x, y, z, size, r, g, b, mat = 5) { for (const k of [0, 1, 2, 0, 2, 3]) this.v(x, y, z, size + k * 100, r, g, b, mat); }
    append(o) {
        while ((this.n + o.n) * 4 > this.pos.length) this.grow();
        this.pos.set(o.pos.subarray(0, o.n * 4), this.n * 4); this.col.set(o.col.subarray(0, o.n * 4), this.n * 4);
        this.n += o.n;
    }
}
// box centred on (x, y) from z0 to z0 + h, with a slightly darker skirt
function box(m, x, y, z0, sx, sy, h, col, mat = 0) {
    const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z1 = z0 + h, d = shade(col, 0.82);
    m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], d, mat);
    m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], d, mat);
    m.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], d, mat);
    m.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], d, mat);
}
// tile with a bevelled top edge
function tile(m, x, y, z0, s, h, col, mat = 0) {
    const b = 0.05, d = shade(col, 0.8);
    box(m, x, y, z0, s, s, h - b, d, mat);
    const x0 = x - s / 2, x1 = x + s / 2, y0 = y - s / 2, y1 = y + s / 2, zt = z0 + h, zb = zt - b;
    m.quad([x0 + b, y0 + b, zt], [x1 - b, y0 + b, zt], [x1 - b, y1 - b, zt], [x0 + b, y1 - b, zt], col, mat);
    const bev = shade(col, 0.93);
    m.quad([x0, y0, zb], [x1, y0, zb], [x1 - b, y0 + b, zt], [x0 + b, y0 + b, zt], bev, mat);
    m.quad([x1, y0, zb], [x1, y1, zb], [x1 - b, y1 - b, zt], [x1 - b, y0 + b, zt], bev, mat);
    m.quad([x1, y1, zb], [x0, y1, zb], [x0 + b, y1 - b, zt], [x1 - b, y1 - b, zt], bev, mat);
    m.quad([x0, y1, zb], [x0, y0, zb], [x0 + b, y0 + b, zt], [x0 + b, y1 - b, zt], bev, mat);
}
function cylinder(m, x, y, z0, z1, r, seg, col, mat = 0, cap = true) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r];
        m.quad([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], shade(col, 0.85), mat);
        if (cap) m.tri([x, y, z1], [p0[0], p0[1], z1], [p1[0], p1[1], z1], col, mat);
    }
}
function star(m, x, y, z, r, col, mat = 0) {
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2, a1 = a + Math.PI / 5, a2 = a - Math.PI / 5;
        const tip = [x + Math.cos(a) * r, y + Math.sin(a) * r, z], in1 = [x + Math.cos(a1) * r * 0.42, y + Math.sin(a1) * r * 0.42, z], in2 = [x + Math.cos(a2) * r * 0.42, y + Math.sin(a2) * r * 0.42, z];
        m.tri(in2, tip, in1, col, mat); m.tri([x, y, z], in2, in1, col, mat);
    }
}
// rotation matrices (row-major 3 × 3)
const matMul = (A, B) => { const R = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return R; };
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const rotAxis = (ax, a) => { const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c; return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]; };
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ------------------------------------------------------------------ canvas + library

const canvas = document.getElementById("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: params.has("shot") });
function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);

const space = new GameSpace(gl);
const U = createProgram(gl, space);
const audio = new Audio();

// ------------------------------------------------------------------ board geometry (world coordinates)

const TILE_TOP = 0.13, YARD_TOP = 0.3;
const cellXY = (r, c) => [c - 7, r - 7];
const slotXY = (p, i) => { const o = CORNER_ORIGIN[p], s = SLOT_REL[i]; return [o[1] + s[1] - 7.5, o[0] + s[0] - 7.5]; };
const yardCentre = (p) => { const o = CORNER_ORIGIN[p]; return [o[1] + 3 - 7.5, o[0] + 3 - 7.5]; };
const pyramidZ = (x, y) => TILE_TOP + 1.6 * Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(y)) / 1.5);
const globalIndex = (p, pos) => (START_INDEX[p] + pos - 1) % 52;
// where a pawn stands for a given progress value (0 yard · 1-51 track · 52-56 own lane · 57 home)
function basePos(p, i, pos) {
    if (pos === 0) { const [x, y] = slotXY(p, i); return [x, y, YARD_TOP]; }
    if (pos <= 51) { const [r, c] = GLOBAL_PATH[globalIndex(p, pos)]; const [x, y] = cellXY(r, c); return [x, y, TILE_TOP]; }
    if (pos <= 56) { const [r, c] = HOME_STRETCH[p][pos - 52]; const [x, y] = cellXY(r, c); return [x, y, TILE_TOP]; }
    const d = FACE_DIR[p], t = [-d[1], d[0]], x = d[0] * 1.02 + t[0] * (i - 1.5) * 0.5, y = d[1] * 1.02 + t[1] * (i - 1.5) * 0.5;
    return [x, y, pyramidZ(x, y) - 0.04];
}

const stat = new Mesh(120000);
let tableCount = 0;
function buildStatic() {
    const m = stat;
    m.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
    for (let gx = -60; gx < 60; gx += 20) for (let gy = -60; gy < 60; gy += 20) m.quad([gx, gy, -0.62], [gx + 20, gy, -0.62], [gx + 20, gy + 20, -0.62], [gx, gy + 20, -0.62], [0, 0, 0], 4);
    tableCount = m.n;
    // board: wooden frame and cream surface
    const wood = [0.42, 0.23, 0.11], woodTop = [0.55, 0.32, 0.16];
    box(m, 0, 0, -0.62, 16.6, 16.6, 0.5, wood);
    for (const [x, y, sx, sy] of [[0, -7.95, 16.6, 0.7], [0, 7.95, 16.6, 0.7], [-7.95, 0, 0.7, 15.2], [7.95, 0, 0.7, 15.2]]) box(m, x, y, -0.12, sx, sy, 0.2, woodTop);
    m.quad([-7.6, -7.6, -0.04], [7.6, -7.6, -0.04], [7.6, 7.6, -0.04], [-7.6, 7.6, -0.04], [0.95, 0.91, 0.82], 6);
    // yards: coloured platform, white court, four pedestals
    for (let p = 0; p < 4; p++) {
        const [cx, cy] = yardCentre(p), col = COLORS[p];
        tile(m, cx, cy, -0.04, 5.9, 0.18, col);
        tile(m, cx, cy, 0.14, 4.1, 0.06, [0.97, 0.95, 0.9]);
        for (let i = 0; i < 4; i++) {
            const [x, y] = slotXY(p, i);
            cylinder(m, x, y, 0.2, YARD_TOP, 0.52, 20, shade(col, 0.95), 1);
            cylinder(m, x, y, YARD_TOP - 0.002, YARD_TOP + 0.003, 0.4, 20, mix3(col, [1, 1, 1], 0.35), 1);
        }
    }
    // the track, lanes, start squares and stars
    const lane = new Map();
    HOME_STRETCH.forEach((cells, p) => cells.slice(0, 5).forEach(([r, c]) => lane.set(r + "," + c, p)));
    const startOf = new Map(START_INDEX.map((g, p) => [GLOBAL_PATH[g].join(","), p]));
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
        const cross = (r >= 6 && r <= 8) || (c >= 6 && c <= 8), centre = r >= 6 && r <= 8 && c >= 6 && c <= 8;
        if (!cross || centre) continue;
        const key = r + "," + c, [x, y] = cellXY(r, c);
        let col = [0.98, 0.97, 0.94];
        if (lane.has(key)) col = mix3(COLORS[lane.get(key)], [1, 1, 1], 0.12);
        if (startOf.has(key)) col = COLORS[startOf.get(key)];
        tile(m, x, y, -0.04, 0.94, 0.17, col);
        const gi = GLOBAL_PATH.findIndex(([gr, gc]) => gr === r && gc === c);
        if (gi >= 0 && SAFE_SET.has(gi)) star(m, x, y, TILE_TOP + 0.004, 0.36, startOf.has(key) ? [1, 1, 1] : [0.75, 0.68, 0.55], 0);
    }
    // the home pyramid: four glossy faces rising to a gold cap
    const apex = [0, 0, TILE_TOP + 1.6], B = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
    box(m, 0, 0, -0.04, 3.0, 3.0, 0.17, [0.98, 0.97, 0.94]);
    const faces = [[3, 0, 0], [0, 1, 1], [1, 2, 2], [2, 3, 3]];    // [corner a, corner b, colour] for -x, -y, +x, +y
    for (const [a, b, p] of faces) {
        const A = [...B[a], TILE_TOP], Bc = [...B[b], TILE_TOP], k = 0.82;
        const cut = (q) => lerp3(q, apex, k);
        m.quad(A, Bc, cut(Bc), cut(A), COLORS[p], 1);
        m.tri(cut(A), cut(Bc), apex, [1.0, 0.82, 0.35], 1);
    }
    space.setStatic(m.pos, m.col, m.n);
}
buildStatic();

// ------------------------------------------------------------------ pawn and die templates (local space, z up)

// pawn: a lathe profile plus a ball head; each vertex carries a shade factor so the collar reads lighter
const PAWN = (() => {
    const prof = [[0.33, 0], [0.33, 0.06], [0.28, 0.1], [0.21, 0.14], [0.145, 0.36], [0.115, 0.46], [0.19, 0.5], [0.19, 0.545], [0.1, 0.575], [0, 0.575]];
    const tone = [0.8, 0.9, 1, 1, 1, 1, 1.25, 1.25, 1.1, 1.1];
    const seg = 16, out = [];
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (k, a) => [prof[k][0] * Math.cos(a), prof[k][0] * Math.sin(a), prof[k][1]];
        const s = tone[j];
        out.push([P(j, a0), P(j, a1), P(j + 1, a1), s], [P(j, a0), P(j + 1, a1), P(j + 1, a0), s]);
    }
    const rings = 7, hr = 0.175, hz = 0.72;
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const P = (jj, ii) => { const th = (jj / rings) * Math.PI, ph = (ii / seg) * Math.PI * 2; return [hr * Math.sin(th) * Math.cos(ph), hr * Math.sin(th) * Math.sin(ph), hz + hr * Math.cos(th)]; };
        const s = 1.05 + 0.1 * Math.cos((j / rings) * Math.PI);
        if (j > 0) out.push([P(j, i), P(j, i + 1), P(j + 1, i + 1), s]);
        if (j < rings - 1) out.push([P(j, i), P(j + 1, i + 1), P(j + 1, i), s]);
    }
    const pos = new Float32Array(out.length * 9), sh = new Float32Array(out.length);
    out.forEach(([a, b, c, s], k) => { pos.set([...a, ...b, ...c], k * 9); sh[k] = s; });
    return { pos, sh };
})();

// die: a chamfered cube with pips. Faces: +z 1, -z 6, +x 2, -x 5, +y 3, -y 4
const DIE_H = 0.33, DIE_I = 0.27;
const DIE = (() => {
    const out = [];   // [a, b, c, colour]
    const ivory = [0.98, 0.96, 0.9], edge = [0.9, 0.88, 0.82];
    const faces = [[[0, 0, 1], [1, 0, 0], [0, 1, 0], 1], [[0, 0, -1], [1, 0, 0], [0, -1, 0], 6], [[1, 0, 0], [0, 1, 0], [0, 0, 1], 2], [[-1, 0, 0], [0, -1, 0], [0, 0, 1], 5], [[0, 1, 0], [-1, 0, 0], [0, 0, 1], 3], [[0, -1, 0], [1, 0, 0], [0, 0, 1], 4]];
    const add = (n, u, v, a, b, d) => [n[0] * d + u[0] * a + v[0] * b, n[1] * d + u[1] * a + v[1] * b, n[2] * d + u[2] * a + v[2] * b];
    const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] };
    for (const [n, u, v, val] of faces) {
        const q = (a, b) => add(n, u, v, a, b, DIE_H);
        out.push([q(-DIE_I, -DIE_I), q(DIE_I, -DIE_I), q(DIE_I, DIE_I), ivory], [q(-DIE_I, -DIE_I), q(DIE_I, DIE_I), q(-DIE_I, DIE_I), ivory]);
        for (const [pu, pv] of PIPS[val]) {
            const r = val === 1 ? 0.085 : 0.055, cx = pu * 0.14, cy = pv * 0.14, col = val === 1 ? [0.8, 0.08, 0.1] : [0.08, 0.07, 0.1];
            for (let i = 0; i < 10; i++) {
                const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
                const c0 = add(n, u, v, cx, cy, DIE_H + 0.003);
                out.push([c0, add(n, u, v, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, DIE_H + 0.003), add(n, u, v, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, DIE_H + 0.003), col]);
            }
        }
    }
    // chamfered edges and corners
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const A = axes[a].map((x) => x * sa), Bv = axes[b].map((x) => x * sb), E = axes[3 - a - b];
        const P = (n1, n2, e) => [n1[0] * DIE_H + n2[0] * DIE_I + E[0] * e, n1[1] * DIE_H + n2[1] * DIE_I + E[1] * e, n1[2] * DIE_H + n2[2] * DIE_I + E[2] * e];
        out.push([P(A, Bv, -DIE_I), P(A, Bv, DIE_I), P(Bv, A, DIE_I), edge], [P(A, Bv, -DIE_I), P(Bv, A, DIE_I), P(Bv, A, -DIE_I), edge]);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
        out.push([[sx * DIE_H, sy * DIE_I, sz * DIE_I], [sx * DIE_I, sy * DIE_H, sz * DIE_I], [sx * DIE_I, sy * DIE_I, sz * DIE_H], edge]);
    return out;
})();
const FACE_UP = { 1: IDENT, 6: rotX(Math.PI), 2: rotY(-Math.PI / 2), 5: rotY(Math.PI / 2), 3: rotX(Math.PI / 2), 4: rotX(-Math.PI / 2) };

// ------------------------------------------------------------------ game state

const save = (() => { try { return Object.assign({ games: 0, wins: 0, pace: "normal", humans: [true, false, false, false] }, JSON.parse(localStorage.getItem("ludo3d.save")) || {}); } catch { return { games: 0, wins: 0, pace: "normal", humans: [true, false, false, false] }; } })();
const persist = () => { try { localStorage.setItem("ludo3d.save", JSON.stringify(save)); } catch { } };
if (params.get("pace") && PACES[params.get("pace")]) save.pace = params.get("pace");
const pace = () => (AUTO && params.get("speed") ? +params.get("speed") : PACES[save.pace] || 1);

let players = [], current = 0, winner = null, gen = 0, paused = false;
let pawns = [];             // render state per pawn: { p, i, anim, land, flash }
let movable = [], selIdx = 0, humanWait = null, focus = null, capFocus = 0, timeScale = 1, slowT = 0;
let dice = { value: 6, p: 0, roll: null, pos: [...yardCentre(0), YARD_TOP - 0.1 + DIE_H], R: IDENT };
let sparks = [], rings = [], confetti = [], dusts = [];
let time = 0, shake = 0, flash = [0, 0, 0], camYaw = 0, camFocus = [0, -0.6], camZoom = 1;
const waiters = [];

function wait(sec) {
    const g = gen;
    return new Promise((res, rej) => waiters.push({ t: sec, res, rej, g }));
}
function abortAll() { gen++; for (const w of waiters.splice(0)) w.rej("abort"); if (humanWait) { humanWait.rej("abort"); humanWait = null; } }
function human(kind) { return new Promise((res, rej) => { humanWait = { kind, res, rej }; ui.prompt(); }); }

function newGame(humans) {
    abortAll();
    players = [0, 1, 2, 3].map((p) => ({ human: humans[p], tokens: [0, 0, 0, 0] }));
    if (params.has("endgame")) players.forEach((pl, p) => { pl.tokens = [57, 57, 57, 46 + p]; });   // tests: jump to the finish
    pawns = []; for (let p = 0; p < 4; p++) for (let i = 0; i < 4; i++) pawns.push({ p, i, anim: null, land: 0 });
    current = 0; winner = null; movable = []; selIdx = 0; focus = null; capFocus = 0; timeScale = 1;
    sparks = []; rings = []; confetti = []; dusts = [];
    dice = { value: 6, p: 0, roll: null, pos: [...yardCentre(0), YARD_TOP - 0.1 + DIE_H], R: matMul(rotZ(0.4), FACE_UP[6]) };
    ui.players(); ui.turn();
    run(gen);
}
const pawnOf = (p, i) => pawns[p * 4 + i];

function legalMoves(p, roll) {
    const out = [];
    players[p].tokens.forEach((pos, i) => {
        if (pos === 0) { if (roll === 6) out.push(i); return; }
        if (pos < 57 && pos + roll <= 57) out.push(i);
    });
    return out;
}
function opponentsAt(g, p) {
    const hits = [];
    players.forEach((pl, q) => { if (q !== p) pl.tokens.forEach((pos, i) => { if (pos >= 1 && pos <= 51 && globalIndex(q, pos) === g) hits.push([q, i]); }); });
    return hits;
}

// ------------------------------------------------------------------ the computer: weighs captures, safety and progress

function aiChoose(p, roll, moves) {
    let best = moves[0], bestScore = -1e9;
    for (const i of moves) {
        const pos = players[p].tokens[i], np = pos === 0 ? 1 : pos + roll;
        let s = Math.random() * 6 + np * 0.4;
        if (pos === 0) s += 38;
        if (np === 57) s += 85;
        else if (np > 51 && pos <= 51) s += 32;
        if (np <= 51) {
            const g = globalIndex(p, np), safe = SAFE_SET.has(g);
            if (!safe && opponentsAt(g, p).length) s += 110;
            if (safe) s += 14;
            if (!safe && threatened(p, g)) s -= 34;
        }
        if (pos >= 1 && pos <= 51) { const g0 = globalIndex(p, pos); if (!SAFE_SET.has(g0) && threatened(p, g0)) s += 22; }
        if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
}
function threatened(p, g) {
    for (let q = 0; q < 4; q++) if (q !== p) for (const pos of players[q].tokens) {
        if (pos < 1 || pos > 51) continue;
        const d = (g - globalIndex(q, pos) + 52) % 52;
        if (d >= 1 && d <= 6) return true;
    }
    return false;
}

// ------------------------------------------------------------------ a turn, step by step

async function run(g) {
    try {
        while (winner === null && g === gen) {
            await playTurn(current);
        }
    } catch (e) { if (e !== "abort") throw e; }
}

async function playTurn(p) {
    const ai = !players[p].human;
    ui.turn(); audio.turn();
    if (ai) { ui.msg(`${NAMES[p]} is thinking…`, p); await wait(0.9 / pace()); }
    else { ui.msg(players.filter((x) => x.human).length > 1 ? `${NAMES[p]}: tap to roll the die` : "Your turn: tap to roll the die", p); await human("roll"); }
    const roll = await rollDice(p);
    ui.msg(`${ai ? NAMES[p] : players.filter((x) => x.human).length > 1 ? NAMES[p] : "You"} rolled ${roll}${roll === 6 ? "!" : ""}`, p);
    if (roll === 6) audio.six();
    await wait((ai ? 0.7 : 0.35) / pace());
    const moves = legalMoves(p, roll);
    if (!moves.length) {
        ui.msg(roll === 6 ? "No pawn can move" : players[p].tokens.every((t) => t === 0) ? "Need a 6 to leave the yard" : "No move possible", p);
        await wait(1.0 / pace());
        current = (p + 1) % 4;
        return;
    }
    let choice;
    if (ai) {
        choice = aiChoose(p, roll, moves);
        movable = [choice]; selIdx = 0;
        await wait(0.65 / pace());
    } else if (moves.length === 1) {
        movable = moves; selIdx = 0;
        await wait(0.35);
        choice = moves[0];
    } else {
        movable = moves; selIdx = 0;
        ui.msg("Pick a pawn to move", p);
        choice = await human("pick");
    }
    movable = [];
    const r = await doMove(p, choice, roll);
    if (r.win) { winner = p; await celebrate(p); return; }
    if (r.extra) ui.msg(r.captured ? "Capture! Roll again" : r.home ? "Pawn home! Roll again" : "Six! Roll again", p);
    await wait(0.5 / pace());
    if (!r.extra) current = (p + 1) % 4;
}

async function rollDice(p) {
    const value = 1 + Math.floor(Math.random() * 6);
    const [tx, ty] = yardCentre(p), from = [tx * 0.35, ty * 0.35 - 1, 3.2];
    const axis = (() => { const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], l = Math.hypot(...a); return a.map((x) => x / l); })();
    const yaw = (Math.random() - 0.5) * 1.2;
    dice.roll = { from, to: [tx + (Math.random() - 0.5) * 0.5, ty + (Math.random() - 0.5) * 0.5, YARD_TOP - 0.1 + DIE_H], t: 0, dur: 1.0, axis, spin: 9 + Math.random() * 5, final: matMul(rotZ(yaw), FACE_UP[value]), bounces: 0 };
    dice.p = p; dice.value = value;
    audio.rattle();
    await wait(1.05);
    dice.roll = null;
    return value;
}

async function hop(pw, from, to, dur, h) {
    pw.anim = { type: "hop", from, to, t: 0, dur, h };
    focus = pw;
    await wait(dur);
    pw.anim = null; pw.land = 1;
    dust(to, 6, 0.6);
}

async function doMove(p, i, roll) {
    const pl = players[p], before = pl.tokens[i], pw = pawnOf(p, i);
    const steps = before === 0 ? [1] : Array.from({ length: roll }, (_, k) => before + k + 1);
    if (before === 0) audio.leave();
    for (let k = 0; k < steps.length; k++) {
        const from = basePos(p, i, k === 0 ? before : steps[k - 1]), to = basePos(p, i, steps[k]);
        const big = before === 0 || steps[k] === 57;
        await hop(pw, from, to, (big ? 0.55 : 0.28) / Math.min(1.6, pace()), big ? 1.5 : 0.55);
        pl.tokens[i] = steps[k];
        audio.hop(k);
    }
    const after = pl.tokens[i];
    let captured = false;
    if (after <= 51) {
        const g = globalIndex(p, after);
        if (!SAFE_SET.has(g)) {
            const hits = opponentsAt(g, p);
            if (hits.length) { captured = true; await captureSequence(p, i, hits); }
        }
    }
    const home = after === 57;
    if (home) await homeSequence(p, i);
    focus = null;
    return { extra: roll === 6 || captured || home, captured, home, win: pl.tokens.every((t) => t === 57) };
}

async function captureSequence(p, i, hits) {
    const at = basePos(p, i, players[p].tokens[i]), col = COLORS[p];
    // the slam: shockwave, dust, sparks, a brief slow-motion push-in
    audio.capture();
    shake = 1; flash = shade(col, 0.22); slowT = 0.55; capFocus = 1;
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate([30, 40, 60]); } catch { }
    rings.push({ x: at[0], y: at[1], z: at[2] + 0.03, t: 0, col: mix3(col, [1, 1, 1], 0.3) });
    rings.push({ x: at[0], y: at[1], z: at[2] + 0.03, t: -0.12, col: [1, 0.9, 0.7] });
    dust(at, 18, 1.6);
    for (let k = 0; k < 36; k++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4; sparks.push({ x: at[0], y: at[1], z: at[2] + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 5, life: 0.6 + Math.random() * 0.6, col: mix3(col, [1.4, 1.2, 1], 0.4) }); }
    pawnOf(p, i).land = 1.4;
    ui.banner(`${NAMES[p]} knocks out ${[...new Set(hits.map(([q]) => NAMES[q]))].join(" & ")}!`, p);
    await wait(0.18);
    // the victims tumble back to their yards
    const flights = hits.map(([q, j], k) => (async () => {
        await wait(k * 0.12);
        const pw = pawnOf(q, j), from = basePos(q, j, players[q].tokens[j]), to = basePos(q, j, 0);
        const ax = (() => { const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.3], l = Math.hypot(...a); return a.map((x) => x / l); })();
        pw.anim = { type: "fly", from, to, t: 0, dur: 1.25, h: 4.6, axis: ax, spin: 2 + Math.random() };
        await wait(1.25);
        pw.anim = null; pw.land = 1.2;
        players[q].tokens[j] = 0;
        dust(to, 10, 1); audio.thud();
    })());
    await Promise.all(flights);
    await wait(0.35);
    capFocus = 0;
}

async function homeSequence(p, i) {
    const col = COLORS[p], top = [0, 0, TILE_TOP + 1.7];
    audio.home();
    for (let k = 0; k < 50; k++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, v = 3 + Math.random() * 3; sparks.push({ x: top[0], y: top[1], z: top[2], vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(a) * Math.cos(e) * v, vz: Math.sin(e) * v + 2, life: 0.8 + Math.random() * 0.7, col: mix3(col, [1.5, 1.4, 1.2], 0.35) }); }
    rings.push({ x: 0, y: 0, z: TILE_TOP + 0.05, t: 0, col: mix3(col, [1, 1, 1], 0.4), big: true });
    const home = players[p].tokens.filter((t) => t === 57).length;
    ui.banner(home === 4 ? `${NAMES[p]} wins!` : `${NAMES[p]} pawn home! (${home}/4)`, p);
    ui.players();
    await wait(0.6);
}

async function celebrate(p) {
    const real = players.some((x) => x.human);
    if (real) { audio.win(); save.games++; if (players[p].human) save.wins++; persist(); }
    for (let k = 0; k < 260; k++) confetti.push({ x: (Math.random() - 0.5) * 18, y: (Math.random() - 0.5) * 18, z: 8 + Math.random() * 8, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, vz: -1 - Math.random() * 2, a: Math.random() * 6, w: (Math.random() - 0.5) * 9, col: k % 3 === 0 ? COLORS[p] : COLORS[Math.floor(Math.random() * 4)], life: 6 + Math.random() * 3 });
    await wait(1.2);
    if (!real && !AUTO) { await wait(3); newGame([false, false, false, false]); return; }   // the demo behind the menu just starts over
    ui.win(p);
    for (let n = 0; n < 6; n++) { await wait(0.45); firework(); }
    if (AUTO) { await wait(3); startGame(); }
}
function firework() {
    const x = (Math.random() - 0.5) * 12, y = (Math.random() - 0.5) * 10, z = 4 + Math.random() * 3, col = COLORS[Math.floor(Math.random() * 4)];
    for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI, v = 2 + Math.random() * 2; sparks.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(a) * Math.cos(e) * v, vz: Math.sin(e) * v, life: 0.8 + Math.random() * 0.6, col: mix3(col, [1.6, 1.5, 1.3], 0.4) }); }
    audio.six();
}
function dust(at, n, s) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random()) * s; dusts.push({ x: at[0], y: at[1], z: at[2] + 0.05, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.3 + Math.random() * 0.6, life: 0.5 + Math.random() * 0.4, size: 0.12 + Math.random() * 0.12 * s }); }
}

// ------------------------------------------------------------------ simulation clock

function update(dtReal) {
    if (paused) return;
    if (slowT > 0) { slowT -= dtReal; timeScale = reducedMotion ? 1 : 0.4; } else timeScale += (1 - timeScale) * Math.min(1, dtReal * 6);
    const dt = dtReal * timeScale;
    time += dt;
    for (let k = waiters.length - 1; k >= 0; k--) { const w = waiters[k]; w.t -= dt; if (w.t <= 0) { waiters.splice(k, 1); if (w.g === gen) w.res(); } }
    for (const pw of pawns) {
        if (pw.anim) pw.anim.t += dt;
        pw.land = Math.max(0, pw.land - dt * 5);
        if (pw.anim && pw.anim.type === "fly" && Math.random() < 0.8) {           // a spark trail behind a knocked-out pawn
            const a = pw.anim, t = clamp(a.t / a.dur, 0, 1);
            sparks.push({ x: lerp(a.from[0], a.to[0], t), y: lerp(a.from[1], a.to[1], t), z: lerp(a.from[2], a.to[2], t) + a.h * 4 * t * (1 - t) + 0.4, vx: 0, vy: 0, vz: 0.2, life: 0.45, col: mix3(COLORS[pw.p], [1.3, 1.3, 1.3], 0.3) });
        }
    }
    if (dice.roll) {
        const r = dice.roll; r.t += dt;
        const bounceAt = [0.5, 0.74, 0.88];
        while (r.bounces < 3 && r.t >= bounceAt[r.bounces]) { audio.clack(1 - r.bounces * 0.3); r.bounces++; if (r.bounces === 1) dust(r.to, 5, 0.5); }
    }
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 6 * dt; s.vx *= Math.exp(-dt); s.vy *= Math.exp(-dt); s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    for (const d of dusts) { d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vx *= Math.exp(-dt * 3); d.vy *= Math.exp(-dt * 3); d.life -= dt; }
    dusts = dusts.filter((d) => d.life > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 0.8);
    for (const c of confetti) { c.vz = Math.max(c.vz - 2 * dt, -2.2); c.x += (c.vx + Math.sin(time * 2 + c.a) * 0.6) * dt; c.y += c.vy * dt; c.z = Math.max(TILE_TOP + 0.01, c.z + c.vz * dt); c.a += c.w * dt; c.life -= dt; }
    confetti = confetti.filter((c) => c.life > 0);
    shake *= Math.exp(-dtReal * 5);
    flash = flash.map((f) => f * Math.exp(-dtReal * 4));
}

// ------------------------------------------------------------------ per-frame geometry

const solid = new Mesh(60000), alpha = new Mesh(4000), glow = new Mesh(12000);

function drawPawn(x, y, z, col, R, sx, sz, lit) {
    const P = PAWN.pos, S = PAWN.sh, c = lit ? mix3(col, [1, 1, 1], 0.18) : col;
    for (let t = 0, k = 0; t < P.length; t += 9, k++) {
        const s = S[k], cr = Math.min(1.4, c[0] * s), cg = Math.min(1.4, c[1] * s), cb = Math.min(1.4, c[2] * s);
        for (let v = 0; v < 9; v += 3) {
            const lx = P[t + v] * sx, ly = P[t + v + 1] * sx, lz = (P[t + v + 2] - 0.4) * sz;
            solid.v(x + R[0] * lx + R[1] * ly + R[2] * lz, y + R[3] * lx + R[4] * ly + R[5] * lz, z + 0.4 * sz + R[6] * lx + R[7] * ly + R[8] * lz, 1, cr, cg, cb, 1);
        }
    }
}
function ringFlat(m, x, y, z, r, w, seg, col) {
    for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        m.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z], [x + Math.cos(a1) * (r + w), y + Math.sin(a1) * (r + w), z], [x + Math.cos(a0) * (r + w), y + Math.sin(a0) * (r + w), z], col, 2);
    }
}
const surfaceZ = (x, y) => {
    if (Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5) return pyramidZ(x, y);
    for (let p = 0; p < 4; p++) for (let i = 0; i < 4; i++) { const [sx, sy] = slotXY(p, i); if (Math.hypot(x - sx, y - sy) < 0.52) return YARD_TOP; }
    return TILE_TOP;
};

function pawnPositions() {
    // pawns sharing a square stand together in a small cluster
    const groups = new Map(), out = [];
    for (const pw of pawns) {
        if (pw.anim) continue;
        const b = basePos(pw.p, pw.i, players[pw.p].tokens[pw.i]), key = b[0].toFixed(2) + "," + b[1].toFixed(2);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push([pw, b]);
    }
    const OFF = { 1: [[0, 0]], 2: [[-0.2, 0.08], [0.2, -0.08]], 3: [[-0.2, -0.12], [0.2, -0.12], [0, 0.2]], 4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] };
    for (const list of groups.values()) {
        const n = Math.min(4, list.length), off = OFF[n];
        list.forEach(([pw, b], k) => { const o = off[k % n]; out.push({ pw, x: b[0] + o[0], y: b[1] + o[1], z: b[2], scale: n > 1 ? 0.8 : 1, R: IDENT }); });
    }
    for (const pw of pawns) {
        if (!pw.anim) continue;
        const a = pw.anim, t = clamp(a.t / a.dur, 0, 1);
        if (a.type === "hop") {
            const e = easeInOut(t);
            out.push({ pw, x: lerp(a.from[0], a.to[0], e), y: lerp(a.from[1], a.to[1], e), z: lerp(a.from[2], a.to[2], e) + a.h * 4 * t * (1 - t), scale: 1, R: IDENT, stretch: Math.sin(t * Math.PI) * 0.12 });
        } else {
            const x = lerp(a.from[0], a.to[0], t), y = lerp(a.from[1], a.to[1], t), z = lerp(a.from[2], a.to[2], t) + a.h * 4 * t * (1 - t);
            out.push({ pw, x, y, z, scale: 1, R: rotAxis(a.axis, a.spin * Math.PI * 2 * easeInOut(t)) });
        }
    }
    return out;
}

function buildDynamic() {
    solid.reset(); alpha.reset(); glow.reset();
    const list = pawnPositions();
    const pick = humanWait && humanWait.kind === "pick";
    for (const { pw, x, y, z, scale, R, stretch = 0 } of list) {
        const mv = movable.includes(pw.i) && pw.p === current && winner === null;
        const sel = mv && movable[selIdx] === pw.i;
        const bob = mv ? Math.abs(Math.sin(time * 4 + pw.i)) * (sel || !pick ? 0.16 : 0.08) : 0;
        const l = pw.land, sx = scale * (1 + l * 0.12 - stretch * 0.5), sz = scale * (1 - l * 0.2 + stretch);
        drawPawn(x, y, z + bob, COLORS[pw.p], R, sx, sz, mv);
        const gz = surfaceZ(x, y), h = Math.max(0, z + bob - gz);
        alpha.sprite(x, y, gz + 0.006, 0.36 * scale + h * 0.05, 0.42 / (1 + h * 0.5), 0, 0, 8);
        if (mv) {
            const pulse = 0.55 + 0.45 * Math.sin(time * 5), k = sel ? 1.25 : 0.75, c = mix3(COLORS[pw.p], [1, 1, 1], 0.45);
            ringFlat(glow, x, y, gz + 0.01, 0.38 + pulse * 0.06, 0.07, 24, shade(c, k * (0.6 + pulse * 0.6)));
            if (sel && pick) glow.sprite(x, y, z + 1.25 + Math.sin(time * 5) * 0.08, 0.16, 1.4, 1.3, 1.1);
        }
    }
    // the die
    let dpos = dice.pos, R = dice.R;
    if (dice.roll) {
        const r = dice.roll, t = clamp(r.t / r.dur, 0, 1), e = 1 - Math.pow(1 - t, 3);
        const x = lerp(r.from[0], r.to[0], e), y = lerp(r.from[1], r.to[1], e);
        let z;
        if (t < 0.5) { const u = t / 0.5; z = lerp(r.from[2], r.to[2], u * u); }
        else if (t < 0.74) { const u = (t - 0.5) / 0.24; z = r.to[2] + 0.55 * 4 * u * (1 - u); }
        else if (t < 0.88) { const u = (t - 0.74) / 0.14; z = r.to[2] + 0.15 * 4 * u * (1 - u); }
        else z = r.to[2];
        R = matMul(rotAxis(r.axis, r.spin * Math.pow(1 - t, 2.2)), r.final);
        dpos = [x, y, z];
        dice.pos = [r.to[0], r.to[1], r.to[2]]; dice.R = r.final;
    }
    for (const [a, b, c, col] of DIE) {
        const T = (q) => [dpos[0] + R[0] * q[0] + R[1] * q[1] + R[2] * q[2], dpos[1] + R[3] * q[0] + R[4] * q[1] + R[5] * q[2], dpos[2] + R[6] * q[0] + R[7] * q[1] + R[8] * q[2]];
        solid.tri(T(a), T(b), T(c), col, 1);
    }
    { const gz = surfaceZ(dpos[0], dpos[1]) < 0.2 && Math.hypot(dpos[0] - yardCentre(dice.p)[0], dpos[1] - yardCentre(dice.p)[1]) < 2.1 ? YARD_TOP - 0.1 : surfaceZ(dpos[0], dpos[1]), h = Math.max(0, dpos[2] - DIE_H - gz);
      alpha.sprite(dpos[0], dpos[1], gz + 0.006, 0.42 + h * 0.12, 0.45 / (1 + h * 1.5), 0, 0, 8); }
    if (humanWait && humanWait.kind === "roll") {
        const p = 0.5 + 0.5 * Math.sin(time * 4.5), c = COLORS[current];
        glow.sprite(dpos[0], dpos[1], dpos[2] + 0.1, 0.75 + p * 0.25, c[0] * 0.25 + 0.15, c[1] * 0.25 + 0.12, c[2] * 0.25 + 0.1);
    }
    // the current player's yard glows softly
    if (winner === null && players.length) { const [cx, cy] = yardCentre(current), c = COLORS[current], p = 0.6 + 0.4 * Math.sin(time * 2.5); ringFlat(glow, cx, cy, TILE_TOP + 0.02, 2.75, 0.08, 48, shade(c, 0.45 * p)); }
    // effects
    for (const s of sparks) { const k = Math.min(1, s.life * 2); glow.sprite(s.x, s.y, s.z, 0.09, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
    for (const d of dusts) { const k = Math.min(1, d.life * 2) * 0.22; glow.sprite(d.x, d.y, d.z, d.size, k, k * 0.92, k * 0.82); }
    for (const r of rings) {
        if (r.t < 0) continue;
        const k = 1 - r.t / 0.8, rad = (r.big ? 0.8 : 0.3) + r.t * (r.big ? 5 : 3.2);
        ringFlat(glow, r.x, r.y, r.z, rad, 0.12 * k + 0.03, 40, shade(r.col, 1.4 * k));
    }
    for (const c of confetti) {
        const ca = Math.cos(c.a) * 0.09, sa = Math.sin(c.a) * 0.09;
        solid.quad([c.x - ca, c.y - 0.06, c.z - sa], [c.x + ca, c.y - 0.06, c.z + sa], [c.x + ca, c.y + 0.06, c.z + sa], [c.x - ca, c.y + 0.06, c.z - sa], c.col, 1);
    }
    const sN = solid.n, aN = alpha.n;
    solid.append(alpha); solid.append(glow);
    space.setDynamic(solid.pos, solid.col, solid.n);
    return { sN, aN, gN: glow.n };
}

// ------------------------------------------------------------------ camera: leans toward the current player, drifts after the moving pawn

const FIT = [];
for (const x of [-8.4, 8.4]) for (const y of [-8.4, 8.4]) for (const z of [-0.6, 0.4]) FIT.push([x, y, z]);
FIT.push([0, 0, 1.9]);
const YAW = [-0.1, 0.1, 0.12, -0.12];
let view = { k: 1, sx: 0, sy: 0 };
function render(dt) {
    const aspect = canvas.width / canvas.height;
    const EL = aspect > 1.2 ? 0.86 : 0.98, R = 26;
    // targets
    const yawT = (winner === null && players.length ? YAW[current] : Math.sin(time * 0.3) * 0.25) + (reducedMotion ? 0 : Math.sin(time * 0.21) * 0.03);
    let fT = [0, -0.6], zT = 1;
    const mover = focus && pawns.length ? pawnPositions().find((q) => q.pw === focus) : null;
    if (mover) { fT = [mover.x * 0.25, mover.y * 0.25 - 0.6]; zT = 1.06; }
    if (capFocus && mover) { fT = [mover.x * 0.55, mover.y * 0.55 - 0.4]; zT = 1.32; }
    const kk = 1 - Math.exp(-dt * 2.2);
    camYaw += (yawT - camYaw) * kk; camFocus = [lerp(camFocus[0], fT[0], kk), lerp(camFocus[1], fT[1], kk)]; camZoom += (zT - camZoom) * kk;
    const s = shake * (reducedMotion ? 0.1 : 0.3), jx = (Math.random() - 0.5) * s, jy = (Math.random() - 0.5) * s;
    const look = (fx, fy) => space.lookAt(fx + Math.sin(camYaw) * R * Math.cos(EL) + jx, fy - Math.cos(camYaw) * R * Math.cos(EL) + jy, R * Math.sin(EL), fx + jx, fy + jy, 0);
    // fit the board at the neutral framing, then apply the drift and zoom
    look(0, -0.6);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const C = [space.Xc, space.Yc, space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    for (const p of FIT) {
        const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
        const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]) / zp, yp = (v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2]) / zp;
        minX = Math.min(minX, xp); maxX = Math.max(maxX, xp); minY = Math.min(minY, yp); maxY = Math.max(maxY, yp);
    }
    const H = innerHeight, top = (innerWidth < 520 ? 150 : H > 600 ? 128 : 96) / H * 2, bottom = (H > 600 ? 118 : 92) / H * 2;
    const yHi = 1 - top, yLo = -1 + bottom;
    const k = Math.min(1.94 / (maxX - minX), (yHi - yLo) / ((maxY - minY) * aspect));
    view = { k: k * camZoom * ZOOM, sx: -k * (maxX + minX) / 2, sy: (yHi + yLo) / 2 - k * aspect * (maxY + minY) / 2 };
    look(camFocus[0], camFocus[1]);
    space.magnifier = view.k * 1.6;

    const { sN, aN, gN } = buildDynamic();
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uShift, view.sx, view.sy);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3f(U.uLight, -0.35, -0.55, 0.85);
    gl.uniform3f(U.uFlash, flash[0], flash[1], flash[2]);
    space.applyCamera();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.bind(false); space.draw(0, stat.n);
    space.bind(true); space.draw(0, sN);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    space.draw(sN, aN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.draw(sN + aN, gN);
    gl.depthMask(true); gl.disable(gl.BLEND);
}
// world point → CSS pixels (same maths as the vertex shader), for tapping pawns
function toScreen(p) {
    const C = [space.Xc, space.Yc, space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec, aspect = canvas.width / canvas.height;
    const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    const nx = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]) / zp * view.k + view.sx, ny = (v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2]) / zp * view.k * aspect + view.sy;
    return [(nx + 1) / 2 * innerWidth, (1 - ny) / 2 * innerHeight];
}

// ------------------------------------------------------------------ UI

const $ = (id) => document.getElementById(id);
const ui = {
    shown: "title",
    show(which) { this.shown = which; for (const id of ["title", "paused", "win"]) $(id).classList.toggle("hidden", id !== which); document.body.dataset.state = which; },
    players() {
        $("chips").innerHTML = players.map((pl, p) => `<div class="chip${p === current && winner === null ? " on" : ""}" style="--c:${CSS[p]}"><i></i><span>${pl.human ? (players.filter((x) => x.human).length > 1 ? NAMES[p] : "You") : NAMES[p]}</span><b>${"★".repeat(pl.tokens.filter((t) => t === 57).length)}<em>${"☆".repeat(4 - pl.tokens.filter((t) => t === 57).length)}</em></b></div>`).join("");
    },
    turn() { this.players(); this.prompt(); },
    msg(t, p) { const el = $("msg"); el.textContent = t; el.style.setProperty("--c", CSS[p ?? current]); el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); },
    prompt() {
        const rolling = humanWait && humanWait.kind === "roll", picking = humanWait && humanWait.kind === "pick";
        $("roll").disabled = !rolling;
        $("roll").style.setProperty("--c", CSS[current]);
        $("roll").classList.toggle("ready", !!rolling);
        $("pickhint").classList.toggle("show", !!picking);
    },
    banner(t, p) { const el = $("banner"); el.textContent = t; el.style.setProperty("--c", CSS[p]); el.className = ""; void el.offsetWidth; el.className = "show"; },
    win(p) {
        this.show("win");
        const order = [0, 1, 2, 3].sort((a, b) => (b === p) - (a === p) || players[b].tokens.reduce((s, t) => s + t, 0) - players[a].tokens.reduce((s, t) => s + t, 0));
        $("w-title").textContent = players[p].human ? (players.filter((x) => x.human).length > 1 ? `${NAMES[p]} wins!` : "You win!") : `${NAMES[p]} wins`;
        $("w-title").style.color = CSS[p];
        $("w-list").innerHTML = order.map((q, k) => `<li style="--c:${CSS[q]}"><span>${k + 1}</span><i></i>${NAMES[q]}${players[q].human ? " (you)" : ""}<b>${players[q].tokens.filter((t) => t === 57).length}/4 home</b></li>`).join("");
        $("w-stats").textContent = players.some((x) => x.human) ? `You have won ${save.wins} of ${save.games} game${save.games === 1 ? "" : "s"}` : "Computer-only game";
    },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1400); },
    mute() { $("mute").setAttribute("aria-pressed", audio.muted); },
    setup() {
        $("setup").innerHTML = NAMES.map((n, p) => `<button class="seat${save.humans[p] ? " you" : ""}" data-p="${p}" style="--c:${CSS[p]}"><i></i><span>${n}</span><b>${save.humans[p] ? "You" : "Computer"}</b></button>`).join("");
        for (const b of document.querySelectorAll(".seat")) b.onclick = () => { audio.init(); audio.ui(); const p = +b.dataset.p; save.humans[p] = !save.humans[p]; persist(); this.setup(); };
        for (const b of document.querySelectorAll("[data-pace]")) { b.classList.toggle("on", b.dataset.pace === save.pace); b.onclick = () => { audio.init(); audio.ui(); save.pace = b.dataset.pace; persist(); this.setup(); ui.toast(`Computer speed: ${b.textContent}`); }; }
    },
};

// ------------------------------------------------------------------ input

function tryRoll() { if (humanWait && humanWait.kind === "roll") { audio.init(); const w = humanWait; humanWait = null; ui.prompt(); w.res(); } }
function choose(i) { if (humanWait && humanWait.kind === "pick" && movable.includes(i)) { audio.init(); audio.ui(); const w = humanWait; humanWait = null; ui.prompt(); w.res(i); } }
function pauseGame() { if (ui.shown !== "hud") return; paused = true; ui.show("paused"); }
function resumeGame() { paused = false; ui.show("hud"); }

const interactive = (t) => t instanceof Element && t.closest("button, a, .panel");
addEventListener("pointerdown", (e) => {
    if (ui.shown !== "hud" || interactive(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    audio.init();
    if (humanWait && humanWait.kind === "roll") { tryRoll(); return; }
    if (humanWait && humanWait.kind === "pick") {
        let best = null, bd = 1e9;
        for (const q of pawnPositions()) {
            if (q.pw.p !== current || !movable.includes(q.pw.i)) continue;
            for (const zz of [0.2, 0.75]) { const [sx, sy] = toScreen([q.x, q.y, q.z + zz]); const d = Math.hypot(sx - e.clientX, sy - e.clientY); if (d < bd) { bd = d; best = q.pw.i; } }
        }
        if (best !== null && bd < 70) choose(best);
        else ui.toast("Tap one of the glowing pawns");
    }
});
addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { audio.init(); ui.toast(audio.toggleMute() ? "Sound off" : "Sound on"); ui.mute(); return; }
    if (ui.shown === "title") { if ((e.code === "Enter" || e.code === "Space") && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); startFromTitle(); } return; }
    if (e.code === "KeyP" || e.code === "Escape") { if (ui.shown === "hud") pauseGame(); else if (ui.shown === "paused") resumeGame(); return; }
    if (ui.shown !== "hud" || e.repeat) return;
    if (humanWait && humanWait.kind === "roll" && (e.code === "Space" || e.code === "Enter" || e.code === "KeyR")) { e.preventDefault(); tryRoll(); return; }
    if (humanWait && humanWait.kind === "pick") {
        if (/^Digit[1-4]$/.test(e.code)) { choose(+e.code.slice(5) - 1); return; }
        if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Tab"].includes(e.code)) { e.preventDefault(); selIdx = (selIdx + (e.code === "ArrowLeft" || e.code === "ArrowUp" || (e.code === "Tab" && e.shiftKey) ? movable.length - 1 : 1)) % movable.length; audio.ui(); return; }
        if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); choose(movable[selIdx]); }
    }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });
$("roll").addEventListener("click", tryRoll);
$("pause").addEventListener("click", () => { audio.init(); audio.ui(); if (ui.shown === "hud") pauseGame(); else if (ui.shown === "paused") resumeGame(); });
$("mute").addEventListener("click", () => { audio.init(); audio.toggleMute(); ui.mute(); ui.toast(audio.muted ? "Sound off" : "Sound on"); });
$("resume").addEventListener("click", () => { audio.init(); resumeGame(); });
$("restart").addEventListener("click", () => { audio.init(); paused = false; startGame(); });
$("menu").addEventListener("click", () => { audio.init(); paused = false; toTitle(); });
$("again").addEventListener("click", () => { audio.init(); startGame(); });
$("w-menu").addEventListener("click", () => { audio.init(); toTitle(); });
$("play").addEventListener("click", () => startFromTitle());
$("share").addEventListener("click", async () => {
    audio.init(); audio.ui();
    const url = location.origin + location.pathname, text = winner !== null && players[winner].human ? "I just won a game of Ludo 3D! Your turn:" : "Play Ludo 3D free in your browser:";
    try { if (navigator.share) await navigator.share({ title: "Ludo 3D", text, url }); else { await navigator.clipboard.writeText(`${text} ${url}`); ui.toast("Link copied"); } } catch { }
});

function startGame() { ui.show("hud"); newGame(AUTO ? [false, false, false, false] : save.humans.slice()); }
function startFromTitle() { audio.init(); audio.ui(); startGame(); }
function toTitle() { ui.show("title"); ui.setup(); newGame([false, false, false, false]); }   // a quiet demo plays behind the menu

// ------------------------------------------------------------------ loop

ui.mute(); ui.setup();
if (AUTO) startGame(); else toTitle();
window.__ludo3d = () => ({ screen: ui.shown, current, winner, tokens: players.map((p) => p.tokens.slice()), waiting: humanWait && humanWait.kind, movable: movable.slice(), capture: capFocus });
let last = performance.now();
function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    update(dt);
    render(dt);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
