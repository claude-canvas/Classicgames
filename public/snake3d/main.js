// SNAKE 3D — the classic, on a grassy island in a shimmering lake, rendered with the projection3d library (Space).
//
// Steer with the arrow keys / WASD, swipe anywhere, or use the on-screen pad on phones. Turns are queued, so quick
// combinations (like a U-turn) never get lost, and a turn straight back into yourself is ignored. Eat apples to grow;
// now and then a golden fruit appears for a few seconds and is worth three. The sky warms toward sunset as you score.
//
// Rendering: the sky, lake, island, shore, trees, mountains and clouds are built once into Space's buffers. The
// snake, fruit, glows and effects are rebuilt every frame into GameSpace's dynamic buffers. The board is a grid of
// 1-unit cells on the z = 0 plane; the camera looks at it from the south, so screen up is always world +y.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Audio } from "./audio.js";

const params = new URLSearchParams(location.search);
const AUTO = params.has("autoplay");               // demo / testing: the snake plays itself
const ZOOM = Math.max(1, Math.min(4, +params.get("zoom") || 1));   // screenshots: a close-up that follows the head
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ tuning

const N = 17;                                      // board is N × N cells
const WATER = -1.4;
const START_LEN = 4;
const GOLD_EVERY = 5, GOLD_TTL = 7;                // a golden fruit after every 5 apples, for 7 seconds
const interval = () => Math.max(0.072, 0.145 - score * 0.0022);   // seconds per step: speeds up as you score
const DIRS = { up: { x: 0, y: 1 }, down: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const same = (a, b) => a.x === b.x && a.y === b.y;

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
// axis-aligned box from z0 to z0 + h, centred on (x, y)
function box(m, x, y, z0, sx, sy, h, col, mat = 0) {
    const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z1 = z0 + h;
    const d = [col[0] * 0.86, col[1] * 0.86, col[2] * 0.86];
    m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, mat);
    m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], d, mat);
    m.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], d, mat);
    m.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], d, mat);
}
function cylinder(m, x, y, z0, z1, r, seg, col, mat = 0) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        m.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z1], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z1], col, mat);
    }
}
function cone(m, x, y, z0, h, r, seg, col, mat = 0) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2 + 0.3, a1 = ((i + 1) / seg) * Math.PI * 2 + 0.3;
        m.tri([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [x, y, z0 + h], i % 2 ? col : [col[0] * 0.88, col[1] * 0.88, col[2] * 0.88], mat);
    }
}
// low-poly ellipsoid as a list of [a, b, c, colour, material]; colFn(localZ) picks a colour per triangle
function blob(out, cx, cy, cz, rx, ry, rz, seg, rings, colFn, mat = 0) {
    const P = (j, i) => {
        const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
        return [cx + rx * Math.sin(th) * Math.cos(ph), cy + ry * Math.sin(th) * Math.sin(ph), cz + rz * Math.cos(th)];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const a = P(j, i), b = P(j, i + 1), c = P(j + 1, i + 1), d = P(j + 1, i);
        const col = colFn((a[2] + c[2]) / 2 - cz);
        if (j > 0) out.push([a, b, c, col, mat]);
        if (j < rings - 1) out.push([a, c, d, col, mat]);
    }
}
// unit sphere template (8 × 5, light enough for a 100-segment snake) reused for every snake segment
const SPHERE = [];
blob(SPHERE, 0, 0, 0, 1, 1, 1, 8, 5, () => [1, 1, 1]);
const SPH = new Float32Array(SPHERE.flatMap(([a, b, c]) => [...a, ...b, ...c]));   // flat xyz list: no per-frame allocations
function sphere(m, x, y, z, r, col, mat = 1) {
    const cr = col[0], cg = col[1], cb = col[2];
    for (let i = 0; i < SPH.length; i += 3) m.v(x + SPH[i] * r, y + SPH[i + 1] * r, z + SPH[i + 2] * r, 1, cr, cg, cb, mat);
}

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

// ------------------------------------------------------------------ static scene: island, lake, shore

const CX = N / 2, CY = N / 2;
const stat = new Mesh(150000);
let solidCount = 0, cloudCount = 0;
const PILLARS = [[-0.75, -0.75], [N + 0.75, -0.75], [N + 0.75, N + 0.75], [-0.75, N + 0.75]];
const CRYSTAL = [[0.45, 0.95, 1.0], [1.0, 0.55, 0.9], [0.55, 1.0, 0.6], [1.0, 0.85, 0.4]];
function buildStatic() {
    const m = stat;
    m.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
    // lake
    for (let gx = -320; gx < 320; gx += 64) for (let gy = -320; gy < 320; gy += 64)
        m.quad([CX + gx, CY + gy, WATER], [CX + gx + 64, CY + gy, WATER], [CX + gx + 64, CY + gy + 64, WATER], [CX + gx, CY + gy + 64, WATER], [0, 0, 0], 4);
    // the board
    m.quad([0, 0, 0], [N, 0, 0], [N, N, 0], [0, N, 0], [0, 0, 0], 6);
    // stone rim, one block per cell, slightly irregular
    const stone = (i) => { const t = 0.85 + hash(i * 3.7) * 0.25; return [0.66 * t, 0.63 * t, 0.58 * t]; };
    for (let i = 0; i < N; i++) {
        const h = () => 0.42 + hash(i * 1.3 + 7) * 0.12;
        box(m, i + 0.5, -0.38, -0.2, 0.96, 0.72, h() + 0.2, stone(i));
        box(m, i + 0.5, N + 0.38, -0.2, 0.96, 0.72, h() + 0.2, stone(i + 50));
        box(m, -0.38, i + 0.5, -0.2, 0.72, 0.96, h() + 0.2, stone(i + 100));
        box(m, N + 0.38, i + 0.5, -0.2, 0.72, 0.96, h() + 0.2, stone(i + 150));
    }
    // the island beneath: grassy lip, earth, rock, getting narrower towards the water
    box(m, CX, CY, -0.85, N + 2.2, N + 2.2, 0.66, [0.36, 0.6, 0.24]);
    box(m, CX, CY, -1.9, N + 1.9, N + 1.9, 1.06, [0.5, 0.38, 0.26]);
    box(m, CX, CY, -3.6, N + 1.4, N + 1.4, 1.72, [0.48, 0.46, 0.44]);
    // corner pillars with crystals on top
    PILLARS.forEach(([x, y], k) => {
        box(m, x, y, -0.2, 1.1, 1.1, 0.35, [0.6, 0.57, 0.52]);
        box(m, x, y, 0.15, 0.82, 0.82, 1.1, [0.7, 0.67, 0.62]);
        box(m, x, y, 1.25, 1.0, 1.0, 0.18, [0.6, 0.57, 0.52]);
        const c = CRYSTAL[k], top = [x, y, 2.55], bot = [x, y, 1.45], r = 0.34;
        for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
            const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r, 1.95], p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 1.95];
            const cc = i % 2 ? c : [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
            m.tri(p0, p1, top, cc, 1); m.tri(p1, p0, bot, cc, 1);
        }
    });
    // lily pads on the water around the island
    for (let i = 0; i < 18; i++) {
        const a = hash(i * 2.1) * Math.PI * 2, r = 12.5 + hash(i * 5.3) * 5, x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r, s = 0.5 + hash(i * 7.7) * 0.4;
        for (let k = 0; k < 9; k++) {
            const a0 = (k / 10) * Math.PI * 2 + a, a1 = ((k + 1) / 10) * Math.PI * 2 + a;
            m.tri([x, y, WATER + 0.03], [x + Math.cos(a0) * s, y + Math.sin(a0) * s, WATER + 0.03], [x + Math.cos(a1) * s, y + Math.sin(a1) * s, WATER + 0.03], k % 2 ? [0.28, 0.6, 0.22] : [0.24, 0.54, 0.2]);
        }
        if (hash(i * 9.1) < 0.45) cone(m, x + 0.1, y, WATER + 0.03, 0.22, 0.18, 6, [1.0, 0.6, 0.78]);
    }
    // the shore: a ring of low hills around the lake
    const ringH = (a, r) => {
        const n = Math.sin(a * 5 + 1.3) * 1.6 + Math.sin(a * 11 + 0.4) * 0.8 + Math.sin(a * 2.0) * 2.2;
        return WATER - 0.6 + Math.max(0, (r - 21) * 0.24) + Math.max(0, n) * Math.min(1, (r - 21) / 10);
    };
    const RA = 72, RR = [19, 24, 31, 42, 60, 90];
    for (let i = 0; i < RA; i++) for (let j = 0; j < RR.length - 1; j++) {
        const a0 = (i / RA) * Math.PI * 2, a1 = ((i + 1) / RA) * Math.PI * 2, r0 = RR[j], r1 = RR[j + 1];
        const P = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r, ringH(a, r)];
        const t = 0.9 + hash(i * 3.1 + j) * 0.2;
        const col = j === 0 ? [0.82 * t, 0.74 * t, 0.52 * t] : j < 3 ? [0.32 * t, 0.58 * t, 0.22 * t] : [0.26 * t, 0.48 * t, 0.24 * t];
        m.quad(P(a0, r0), P(a1, r0), P(a1, r1), P(a0, r1), col);
    }
    // trees and rocks on the shore
    const tmp = [];
    for (let i = 0; i < 160; i++) {
        const a = hash(i * 1.37) * Math.PI * 2, r = 25 + hash(i * 2.71) * 36, x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
        const z = ringH(a, r) - 0.2, s = 1.2 + hash(i * 4.4) * 1.1;
        if (hash(i * 6.1) < 0.6) {
            cylinder(m, x, y, z, z + 1.2 * s, 0.25 * s, 5, [0.42, 0.27, 0.15]);
            const g = [0.12 + hash(i) * 0.06, 0.38 + hash(i * 1.3) * 0.12, 0.18];
            cone(m, x, y, z + 1.0 * s, 2.6 * s, 1.5 * s, 7, g); cone(m, x, y, z + 2.2 * s, 2.2 * s, 1.15 * s, 7, [g[0] * 1.15, g[1] * 1.15, g[2] * 1.15]); cone(m, x, y, z + 3.3 * s, 1.8 * s, 0.75 * s, 7, [g[0] * 1.3, g[1] * 1.3, g[2] * 1.3]);
        } else if (hash(i * 6.1) < 0.88) {
            cylinder(m, x, y, z, z + 1.6 * s, 0.22 * s, 5, [0.45, 0.3, 0.17]);
            const g = [0.3 + hash(i * 4.4) * 0.15, 0.6 + hash(i * 1.1) * 0.12, 0.2];
            tmp.length = 0; blob(tmp, x, y, z + 2.4 * s, 1.35 * s, 1.35 * s, 1.2 * s, 7, 5, (zz) => (zz > 0.3 ? [g[0] * 1.15, g[1] * 1.15, g[2]] : g));
            for (const [p, q, w, col] of tmp) m.tri(p, q, w, col);
        } else {
            tmp.length = 0; blob(tmp, x, y, z + 0.3 * s, 1.1 * s, 0.9 * s, 0.7 * s, 6, 4, () => [0.55, 0.53, 0.5]);
            for (const [p, q, w, col] of tmp) m.tri(p, q, w, col);
        }
    }
    // mountains far beyond
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + hash(i) * 0.15, r = 190 + hash(i * 4.2) * 60, cx = CX + Math.cos(a) * r, cy = CY + Math.sin(a) * r;
        const h = 45 + hash(i * 1.7) * 60, w = 55 + hash(i * 9.1) * 30;
        const tang = [-Math.sin(a), Math.cos(a)], out = [Math.cos(a), Math.sin(a)];
        const peak = [cx, cy, h], L = [cx - tang[0] * w - out[0] * 10, cy - tang[1] * w - out[1] * 10, -2], R = [cx + tang[0] * w - out[0] * 10, cy + tang[1] * w - out[1] * 10, -2], B = [cx + out[0] * 40, cy + out[1] * 40, -2];
        const rock = [0.44, 0.49, 0.62], k = 0.7;
        const cut = (p) => [lerp(p[0], peak[0], k), lerp(p[1], peak[1], k), lerp(p[2], peak[2], k)];
        m.quad(L, R, cut(R), cut(L), rock); m.tri(cut(L), cut(R), peak, [0.95, 0.97, 1.0]);
        m.quad(R, B, cut(B), cut(R), [rock[0] * 0.8, rock[1] * 0.8, rock[2] * 0.8]); m.tri(cut(R), cut(B), peak, [0.82, 0.86, 0.95]);
        m.quad(B, L, cut(L), cut(B), [rock[0] * 0.8, rock[1] * 0.8, rock[2] * 0.8]); m.tri(cut(B), cut(L), peak, [0.82, 0.86, 0.95]);
    }
    solidCount = m.n;
    for (let i = 0; i < 46; i++) {
        const a = hash(i * 3.3) * Math.PI * 2, r = 60 + hash(i * 5.9) * 150, cx = CX + Math.cos(a) * r, cy = CY + Math.sin(a) * r, cz = 16 + hash(i * 8.8) * 26;
        const n = 4 + Math.floor(hash(i * 3.9) * 4);
        for (let k = 0; k < n; k++) m.sprite(cx + (hash(i * 11 + k) - 0.5) * 14, cy + (hash(i * 17 + k) - 0.5) * 8, cz + (hash(i * 23 + k) - 0.5) * 3, 5 + hash(i * 29 + k) * 6, hash(i + k), hash(i * 2 + k), 0.55 + hash(i * 31 + k) * 0.45, 7);
    }
    cloudCount = m.n - solidCount;
    space.setStatic(m.pos, m.col, m.n);
}
buildStatic();

// ------------------------------------------------------------------ time of day (follows the score)

const SKY = {   // top, horizon, sun dir, sun colour, ambient, dusk, fog
    day: [[0.12, 0.42, 0.95], [0.62, 0.82, 1.0], [0.3, 1, 0.45], [1.0, 0.95, 0.86], [0.55, 0.62, 0.75], 0, 0.0025],
    golden: [[0.2, 0.36, 0.75], [1.0, 0.8, 0.55], [0.45, 1, 0.2], [1.0, 0.8, 0.52], [0.6, 0.56, 0.56], 0.05, 0.0028],
    sunset: [[0.22, 0.2, 0.5], [1.0, 0.56, 0.36], [0.5, 1, 0.05], [1.0, 0.56, 0.3], [0.56, 0.44, 0.5], 0.25, 0.003],
    dusk: [[0.04, 0.06, 0.18], [0.36, 0.3, 0.48], [-0.3, 1, 0.3], [0.6, 0.6, 0.85], [0.36, 0.36, 0.55], 1, 0.003],
};
const CYCLE = [[0, "day"], [15, "day"], [25, "golden"], [40, "sunset"], [52, "dusk"], [64, "dusk"], [80, "day"]];
function skyAt(s) {
    s = s % 80;
    let i = 0;
    while (i < CYCLE.length - 2 && s > CYCLE[i + 1][0]) i++;
    const [f0, n0] = CYCLE[i], [f1, n1] = CYCLE[i + 1];
    const t = clamp((s - f0) / (f1 - f0), 0, 1), e = t * t * (3 - 2 * t), A = SKY[n0], B = SKY[n1];
    return { top: lerp3(A[0], B[0], e), hor: lerp3(A[1], B[1], e), sun: lerp3(A[2], B[2], e), sunCol: lerp3(A[3], B[3], e), amb: lerp3(A[4], B[4], e), dusk: lerp(A[5], B[5], e), fog: lerp(A[6], B[6], e) };
}

// ------------------------------------------------------------------ game state

const save = (() => { try { return Object.assign({ best: 0, games: 0 }, JSON.parse(localStorage.getItem("snake3d.save")) || {}); } catch { return { best: 0, games: 0 }; } })();
const persist = () => { try { localStorage.setItem("snake3d.save", JSON.stringify(save)); } catch { } };

let state = "ready";            // ready | play | paused | dying | over
let snake = [], prev = [], dir = DIRS.right, queue = [], grow = 0;
let apple = null, gold = null, applesEaten = 0, score = 0;
let lumps = [], juice = [], sparks = [], popped = 0, popT = 0, bump = null;
let time = 0, stepT = 0, overT = 0, shake = 0, flash = 0, skyS = 0, newBest = false, lastDeath = null;
let blinkT = 2, tongueT = 1.5;

function freeCell(avoidHead) {
    const taken = new Set(snake.map((s) => s.x + "," + s.y));
    if (apple) taken.add(apple.x + "," + apple.y);
    if (gold) taken.add(gold.x + "," + gold.y);
    const h = snake[0];
    for (let tries = 0; tries < 500; tries++) {
        const c = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
        if (taken.has(c.x + "," + c.y)) continue;
        if (avoidHead && h && Math.abs(c.x - h.x) + Math.abs(c.y - h.y) < 3 && tries < 300) continue;
        return c;
    }
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!taken.has(x + "," + y)) return { x, y };
    return null;
}
function reset() {
    const cy = Math.floor(N / 2), cx = Math.floor(N / 2) - 2;
    snake = []; for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
    prev = snake.map((s) => ({ ...s }));
    dir = DIRS.right; queue = []; grow = 0;
    apple = null; gold = null; applesEaten = 0; score = 0;
    lumps = []; juice = []; sparks = []; popped = 0; popT = 0; bump = null;
    stepT = 0; overT = 0; newBest = false;
    apple = { ...freeCell(true), born: time };
    state = "ready";
    ui.score(); ui.ready(true);
}
function start(d) {
    state = "play";
    stepT = 0;
    if (d && !(d.x === -dir.x && d.y === -dir.y)) dir = d;
    ui.ready(false); ui.show("hud");
}
function queueDir(d) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (same(d, last) || (d.x === -last.x && d.y === -last.y)) return;
    if (queue.length < 3) queue.push(d);
}
function pause() { if (state === "play") { state = "paused"; ui.show("paused"); } }

// one entry point for every steering input (keys, swipes, pad)
function steer(d) {
    audio.init();
    if (ui.shown === "title") ui.show("hud");
    if (state === "ready") start(d);
    else if (state === "play") queueDir(d);
    else if (state === "paused") { state = "play"; ui.show("hud"); queueDir(d); }
    else if (state === "over" && overT > 0.6) { reset(); start(d); }
}
// taps and Space/Enter: start, resume or restart
function confirm() {
    audio.init();
    if (ui.shown === "title") { ui.show("hud"); ui.ready(true); return; }
    if (state === "ready") start(null);
    else if (state === "paused") { state = "play"; ui.show("hud"); }
    else if (state === "over" && overT > 0.6) reset();
}

function step() {
    if (queue.length) { dir = queue.shift(); audio.turn(); }
    const h = snake[0], nh = { x: h.x + dir.x, y: h.y + dir.y };
    prev = snake.map((s) => ({ ...s }));
    const growing = grow > 0;
    const body = growing ? snake : snake.slice(0, -1);
    if (nh.x < 0 || nh.y < 0 || nh.x >= N || nh.y >= N) return die("wall", nh);
    if (body.some((s) => same(s, nh))) return die("self", nh);
    snake.unshift(nh);
    if (growing) { grow--; prev.push({ ...prev[prev.length - 1] }); } else snake.pop();
    for (const l of lumps) l.p += 1;
    lumps = lumps.filter((l) => l.p < snake.length + 1);
    if (apple && same(nh, apple)) eat(apple, false);
    if (gold && same(nh, gold)) eat(gold, true);
}
function eat(f, isGold) {
    const gain = isGold ? 3 : 1;
    score += gain; grow += isGold ? 2 : 1;
    lumps.push({ p: 0 });
    const col = isGold ? [1.0, 0.8, 0.25] : [0.95, 0.18, 0.15];
    for (let i = 0; i < (isGold ? 26 : 14); i++) {
        const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3;
        juice.push({ x: f.x + 0.5, y: f.y + 0.5, z: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 4, life: 0.7 + Math.random() * 0.6, col, s: 0.06 + Math.random() * 0.06, a: Math.random() * 6 });
    }
    for (let i = 0; i < (isGold ? 30 : 12); i++) {
        const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5;
        sparks.push({ x: f.x + 0.5, y: f.y + 0.5, z: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 1 + Math.random() * 3, life: 0.5 + Math.random() * 0.5, col: isGold ? [1.6, 1.2, 0.4] : [1.4, 0.8, 0.5] });
    }
    ui.score(true, isGold ? "+3" : null);
    if (isGold) { gold = null; audio.golden(); ui.banner("GOLDEN +3"); }
    else {
        applesEaten++;
        audio.eat(snake.length);
        apple = null;
        const c = freeCell(true);
        if (c) apple = { ...c, born: time };
        if (applesEaten % GOLD_EVERY === 0 && !gold) { const g = freeCell(true); if (g) { gold = { ...g, born: time, ttl: GOLD_TTL }; audio.spawnGolden(); } }
    }
    if (score > save.best && save.best > 0 && score - gain <= save.best) { ui.toast("New best!"); audio.best(); }
}
function die(kind, at) {
    state = "dying";
    lastDeath = { kind, at, len: snake.length, score };
    bump = { dx: dir.x, dy: dir.y, t: 0 };
    prev = snake.map((s) => ({ ...s }));
    audio.crash();
    shake = 1; flash = 0.45;
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(60); } catch { }
    popped = 0; popT = -0.45;
    newBest = score > save.best;
    if (newBest) save.best = score;
    save.games++; persist();
}

// ------------------------------------------------------------------ autoplay (demo / tests): BFS to the fruit, else the roomiest move

function autopilot() {
    const blocked = new Set(snake.slice(0, -1).map((s) => s.x + "," + s.y));
    const target = gold || apple;
    const h = snake[0], inb = (c) => c.x >= 0 && c.y >= 0 && c.x < N && c.y < N;
    const nb = (c) => Object.values(DIRS).map((d) => ({ x: c.x + d.x, y: c.y + d.y, d })).filter((c2) => inb(c2) && !blocked.has(c2.x + "," + c2.y));
    const room = (c) => { const seen = new Set([c.x + "," + c.y]), q = [c]; while (q.length && seen.size < 120) { const p = q.shift(); for (const n2 of nb(p)) { const k = n2.x + "," + n2.y; if (!seen.has(k)) { seen.add(k); q.push(n2); } } } return seen.size; };
    let choice = null;
    if (target) {
        const seen = new Map([[h.x + "," + h.y, null]]), q = [h];
        while (q.length) {
            const p = q.shift();
            if (same(p, target)) { let k = p.x + "," + p.y, first = p; while (seen.get(k)) { const par = seen.get(k); if (same(par.from, h)) { first = par.step; break; } k = par.from.x + "," + par.from.y; } choice = first.d; break; }
            for (const n2 of nb(p)) { const k = n2.x + "," + n2.y; if (!seen.has(k)) { seen.set(k, { from: p, step: n2 }); q.push(n2); } }
        }
        if (choice) { const nx = { x: h.x + choice.x, y: h.y + choice.y }; if (room(nx) < snake.length) choice = null; }
    }
    if (!choice) { let best = -1; for (const n2 of nb(h)) { const r = room(n2); if (r > best) { best = r; choice = n2.d; } } }
    if (choice && !(choice.x === -dir.x && choice.y === -dir.y)) { queue = []; if (!same(choice, dir)) queue.push(choice); }
}

// ------------------------------------------------------------------ simulation

function update(dt) {
    time += dt;
    blinkT -= dt; if (blinkT < -0.14) blinkT = 2 + Math.random() * 3;
    tongueT -= dt; if (tongueT < -0.35) tongueT = 1.6 + Math.random() * 2.5;
    if (state === "ready" && AUTO) start(null);
    if (state === "play") {
        if (gold && time - gold.born > gold.ttl) gold = null;
        stepT += dt;
        let guard = 0;
        while (state === "play" && stepT >= interval() && guard++ < 4) {
            stepT -= interval();
            if (AUTO) autopilot();
            step();
        }
    } else if (state === "dying") {
        popT += dt;
        if (bump) bump.t += dt;
        while (popT > 0 && popped < snake.length) {
            const s = snake[popped];
            const col = segColor(popped, snake.length);
            for (let i = 0; i < 5; i++) {
                const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5;
                juice.push({ x: s.x + 0.5, y: s.y + 0.5, z: 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 3, life: 0.8 + Math.random() * 0.5, col, s: 0.08 + Math.random() * 0.06, a: Math.random() * 6 });
            }
            sparks.push({ x: s.x + 0.5, y: s.y + 0.5, z: 0.4, vx: 0, vy: 0, vz: 1.5, life: 0.5, col: [col[0] + 0.6, col[1] + 0.6, col[2] + 0.6] });
            audio.pop(popped);
            popped++; popT -= Math.max(0.018, 0.05 - snake.length * 0.0006);
        }
        if (popped >= snake.length && popT > 0.5) { state = "over"; overT = 0; ui.over(score, save.best, newBest, lastDeath.len); if (newBest) audio.best(); }
    } else if (state === "over") {
        overT += dt;
        if (AUTO && overT > 1.5) { reset(); start(null); }
    }
    for (const j of juice) { j.vz -= 14 * dt; j.x += j.vx * dt; j.y += j.vy * dt; j.z += j.vz * dt; if (j.z < 0.03 && Math.abs(j.x - CX) < CX && Math.abs(j.y - CY) < CY) { j.z = 0.03; j.vz *= -0.3; j.vx *= 0.6; j.vy *= 0.6; } j.a += dt * 8; j.life -= dt; }
    juice = juice.filter((j) => j.life > 0 && j.z > WATER);
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 3 * dt; s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    shake *= Math.exp(-dt * 7); flash = Math.max(0, flash - dt * 2);
    skyS += (score - skyS) * Math.min(1, dt * 0.6);
}

// ------------------------------------------------------------------ per-frame geometry

const solid = new Mesh(60000), alpha = new Mesh(6000), glow = new Mesh(10000);
const HEAD_COL = [0.22, 0.58, 1.0], TAIL_COL = [0.62, 0.3, 1.0], BAND = [1.0, 0.68, 0.08];
function segColor(i, n) {
    const t = n > 1 ? i / (n - 1) : 0;
    const c = lerp3(HEAD_COL, TAIL_COL, t);
    return i % 4 === 2 ? BAND : c;
}
// head parts in local space: +x forward, +y left, +z up
const HEAD = [];
blob(HEAD, 0.06, 0, 0.02, 0.62, 0.47, 0.38, 10, 7, (z) => (z < -0.12 ? [0.75, 0.88, 1.0] : HEAD_COL));
for (const s of [-1, 1]) blob(HEAD, 0.47, s * 0.11, 0.13, 0.04, 0.03, 0.03, 4, 3, () => [0.05, 0.12, 0.05]);    // nostrils
const EYE = [], PUPIL = [];
blob(EYE, 0, 0, 0, 0.18, 0.18, 0.18, 8, 5, () => [1.3, 1.3, 1.3]);
blob(PUPIL, 0, 0, 0, 0.095, 0.09, 0.11, 6, 4, () => [0.03, 0.03, 0.06]);

function headMesh(px, py, pz, yaw, scale) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const T = (q, ox = 0, oy = 0, oz = 0, sz = 1) => { const x = (q[0] + ox) * scale, y = (q[1] + oy) * scale, z = (q[2] * sz + oz) * scale; return [px + x * c - y * s, py + x * s + y * c, pz + z]; };
    for (const [a, b, d, col] of HEAD) solid.tri(T(a), T(b), T(d), col, 1);
    const blink = blinkT < 0 ? 0.15 : 1;
    for (const side of [-1, 1]) {
        for (const [a, b, d, col] of EYE) solid.tri(T(a, 0.2, side * 0.26, 0.3, blink), T(b, 0.2, side * 0.26, 0.3, blink), T(d, 0.2, side * 0.26, 0.3, blink), col, 1);
        if (blink > 0.5) for (const [a, b, d, col] of PUPIL) solid.tri(T(a, 0.33, side * 0.29, 0.33), T(b, 0.33, side * 0.29, 0.33), T(d, 0.33, side * 0.29, 0.33), col, 1);
        if (blink > 0.5) glow.sprite(...T([0.38, side * 0.26, 0.42]), 0.045 * scale, 1.3, 1.3, 1.3);
    }
    if (tongueT < 0 && state !== "dying" && state !== "over") {           // a quick forked flick
        const k = Math.sin((-tongueT / 0.35) * Math.PI), L = 0.25 + 0.3 * k, red = [0.95, 0.15, 0.25];
        const tip = T([0.6 + L, 0, -0.04]);
        solid.tri(T([0.58, -0.03, -0.04]), tip, T([0.58, 0.03, -0.04]), red, 0);
        solid.tri(tip, T([0.68 + L, -0.07, -0.04]), T([0.64 + L, 0, -0.04]), red, 0);
        solid.tri(tip, T([0.64 + L, 0, -0.04]), T([0.68 + L, 0.07, -0.04]), red, 0);
    }
}

function fruitMesh(f, isGold) {
    const age = time - f.born, pop = Math.min(1, age / 0.35), sc = pop < 1 ? Math.sin(pop * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) * (1 + 0.25 * Math.sin(pop * Math.PI)) : 1;
    const x = f.x + 0.5, y = f.y + 0.5, z = 0.45 + Math.sin(time * 3 + f.x) * 0.07, yaw = time * 1.3, r = 0.34 * sc;
    if (sc <= 0.01) return;
    const body = isGold ? [1.0, 0.78, 0.22] : [0.92, 0.12, 0.12];
    const tmp = [];
    blob(tmp, 0, 0, 0, r, r, r * 0.9, 9, 6, (zz) => (zz > r * 0.6 ? [body[0] * 0.75, body[1] * 0.75, body[2] * 0.75] : body), 1);
    const c = Math.cos(yaw), s = Math.sin(yaw), T = (q) => [x + q[0] * c - q[1] * s, y + q[0] * s + q[1] * c, z + q[2]];
    for (const [a, b, d, col, mat] of tmp) solid.tri(T(a), T(b), T(d), col, mat);
    solid.tri(T([0, -0.02, r * 0.8]), T([0.02, 0.02, r * 0.8]), T([0.03, 0, r * 0.8 + 0.18 * sc]), [0.4, 0.25, 0.1]);
    solid.tri(T([0.02, 0, r * 0.8 + 0.12 * sc]), T([0.22 * sc, 0.08 * sc, r * 0.8 + 0.2 * sc]), T([0.18 * sc, -0.06 * sc, r * 0.8 + 0.1 * sc]), [0.3, 0.75, 0.2]);
    const g = isGold ? [0.9, 0.7, 0.2] : [0.5, 0.12, 0.08];
    glow.sprite(x, y, z, 0.75 * sc, g[0] * 0.5, g[1] * 0.5, g[2] * 0.5);
    alpha.sprite(x, y, 0.015, 0.34 * sc, 0.35, 0, 0, 8);
    // a soft outline on the cell so the target is easy to spot
    const k = (0.25 + 0.12 * Math.sin(time * 4)) * sc, w = 0.06, x0 = f.x + 0.06, x1 = f.x + 0.94, y0 = f.y + 0.06, y1 = f.y + 0.94, zz = 0.012;
    const cc = isGold ? [1.6 * k, 1.2 * k, 0.4 * k] : [1.4 * k, 0.7 * k, 0.5 * k];
    solid.quad([x0, y0, zz], [x1, y0, zz], [x1, y0 + w, zz], [x0, y0 + w, zz], cc, 2);
    solid.quad([x0, y1 - w, zz], [x1, y1 - w, zz], [x1, y1, zz], [x0, y1, zz], cc, 2);
    solid.quad([x0, y0 + w, zz], [x0 + w, y0 + w, zz], [x0 + w, y1 - w, zz], [x0, y1 - w, zz], cc, 2);
    solid.quad([x1 - w, y0 + w, zz], [x1, y0 + w, zz], [x1, y1 - w, zz], [x1 - w, y1 - w, zz], cc, 2);
    if (isGold) {                                                      // countdown ring of sparkles
        const left = clamp(1 - age / f.ttl, 0, 1), n = Math.ceil(left * 16), blinkOn = left > 0.28 || Math.sin(time * 18) > 0;
        if (blinkOn) for (let i = 0; i < n; i++) { const a = (i / 16) * Math.PI * 2 + Math.PI / 2; glow.sprite(x + Math.cos(a) * 0.62, y + Math.sin(a) * 0.62, 0.1, 0.1, 1.5, 1.15, 0.35); }
        if (Math.random() < 0.3) sparks.push({ x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z: z + Math.random() * 0.4, vx: 0, vy: 0, vz: 0.8, life: 0.5, col: [1.4, 1.1, 0.4] });
    }
}

function snakeMesh() {
    const n = snake.length;
    const f = state === "play" ? clamp(stepT / interval(), 0, 1) : 1;
    const P = [];
    for (let i = 0; i < n; i++) {
        if (state !== "play" && state !== "ready" && i < popped) { P.push(null); continue; }
        const a = prev[i] || snake[i], b = snake[i];
        P.push([lerp(a.x, b.x, f) + 0.5, lerp(a.y, b.y, f) + 0.5]);
    }
    const rad = (i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let r = 0.4 * (1 - 0.48 * Math.pow(t, 1.4));
        for (const l of lumps) r *= 1 + 0.32 * Math.exp(-((i - (l.p - 1 + f)) ** 2) / 1.1);
        if (state === "ready") r *= 1 + 0.03 * Math.sin(time * 3 - i * 0.7);
        return r;
    };
    for (let i = n - 1; i >= 1; i--) {
        if (!P[i]) continue;
        const r = rad(i), col = segColor(i, n);
        sphere(solid, P[i][0], P[i][1], r * 0.95, r, col);
        if (P[i - 1]) {
            const r2 = (r + rad(i - 1)) / 2, mx = (P[i][0] + P[i - 1][0]) / 2, my = (P[i][1] + P[i - 1][1]) / 2;
            sphere(solid, mx, my, r2 * 0.95, r2, col);                        // same colour as its segment: crisp bands
        }
        alpha.sprite(P[i][0], P[i][1], 0.012, r * 1.25, 0.22, 0, 0, 8);
    }
    if (P[0]) {
        let yaw = Math.atan2(dir.y, dir.x);
        if (n > 1 && P[1]) { const dx = P[0][0] - P[1][0], dy = P[0][1] - P[1][1]; if (dx * dx + dy * dy > 1e-4) yaw = Math.atan2(dy, dx); }
        let hx = P[0][0], hy = P[0][1];
        if (bump && bump.t < 0.25) { const k = Math.sin((bump.t / 0.25) * Math.PI) * 0.25; hx += bump.dx * k; hy += bump.dy * k; }
        const lumpHead = lumps.length ? Math.max(...lumps.map((l) => Math.exp(-((l.p - 1 + f) ** 2) / 0.6))) : 0;
        headMesh(hx, hy, 0.44, yaw, 1.18 + lumpHead * 0.18);
        alpha.sprite(hx, hy, 0.012, 0.6, 0.28, 0, 0, 8);
    }
}

function buildDynamic(S) {
    solid.reset(); alpha.reset(); glow.reset();
    snakeMesh();
    if (apple) fruitMesh(apple, false);
    if (gold) fruitMesh(gold, true);
    for (const j of juice) {
        const c = Math.cos(j.a) * j.s, s = Math.sin(j.a) * j.s;
        solid.tri([j.x + c, j.y + s, j.z], [j.x - s, j.y + c, j.z + j.s], [j.x - c, j.y - s, j.z], j.col, 1);
    }
    for (const s of sparks) { const k = Math.min(1, s.life * 2); glow.sprite(s.x, s.y, s.z, 0.1, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
    // crystals pulse, brighter at dusk
    PILLARS.forEach(([x, y], k) => {
        const p = 0.55 + 0.45 * Math.sin(time * 2 + k * 1.7), b = (0.35 + S.dusk * 0.6) * p, c = CRYSTAL[k];
        glow.sprite(x, y, 2.0, 1.1 + p * 0.3, c[0] * b, c[1] * b, c[2] * b);
    });
    // fireflies drifting around the island
    for (let i = 0; i < 18; i++) {
        const a = hash(i * 1.9) * 6.28 + time * (0.08 + hash(i) * 0.1) * (i % 2 ? 1 : -1), r = 11 + hash(i * 3.7) * 8;
        const x = CX + Math.cos(a) * r + Math.sin(time * 0.7 + i) * 0.8, y = CY + Math.sin(a) * r, z = 0.8 + hash(i * 5.1) * 2.5 + Math.sin(time * 1.3 + i * 2) * 0.4;
        const tw = Math.max(0, Math.sin(time * (1.5 + hash(i * 7) * 2) + i * 4)) * (0.25 + S.dusk * 0.9);
        glow.sprite(x, y, z, 0.18, 1.2 * tw, 1.0 * tw, 0.35 * tw);
    }
    const sN = solid.n, aN = alpha.n;
    solid.append(alpha); solid.append(glow);
    space.setDynamic(solid.pos, solid.col, solid.n);
    return { sN, aN, gN: glow.n };
}

// ------------------------------------------------------------------ camera: fit the board between the HUD and the pad

const R = 30;                     // camera distance; the elevation depends on the screen shape
const FIT = [];
for (const x of [-1.3, N + 1.3]) for (const y of [-1.3, N + 1.3]) for (const z of [-0.85, 2.6]) FIT.push([x, y, z]);
function render() {
    const aspect = canvas.width / canvas.height;
    const sway = reducedMotion ? 0 : Math.sin(time * 0.25) * 0.6;
    const s = shake * (reducedMotion ? 0.1 : 0.35), sx = (Math.random() - 0.5) * s, sy = (Math.random() - 0.5) * s;
    const EL = aspect > 1.2 ? 0.6 : aspect > 0.8 ? 0.66 : 0.72;   // lower on wide screens so the shore and sky show
    space.lookAt(CX + sway + sx, CY - R * Math.cos(EL) + sy, R * Math.sin(EL), CX + sx, CY + 0.6 + sy, 0);
    // project the board's bounding box and choose zoom + screen offset so it fits the free area
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const C = [space.Xc, space.Yc, space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    for (const p of FIT) {
        const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
        const zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
        const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]) / zp, yp = (v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2]) / zp;
        minX = Math.min(minX, xp); maxX = Math.max(maxX, xp); minY = Math.min(minY, yp); maxY = Math.max(maxY, yp);
    }
    const H = innerHeight, padOn = document.body.classList.contains("pad-on");
    const yHi = 1 - 2 * (H > 600 ? 110 : 76) / H, yLo = -1 + 2 * (padOn ? 236 : 18) / H;
    let k = Math.min(1.9 / (maxX - minX), (yHi - yLo) / ((maxY - minY) * aspect));
    let shiftX = -k * (maxX + minX) / 2, shiftY = (yHi + yLo) / 2 - k * aspect * (maxY + minY) / 2;
    if (ZOOM > 1 && snake[0]) {
        const hx = snake[0].x + 0.5, hy = snake[0].y + 0.5;
        space.lookAt(hx + sway, hy - R * Math.cos(EL), R * Math.sin(EL), hx, hy + 0.6, 0);
        k *= ZOOM; shiftX = 0; shiftY = 0;
    }
    space.magnifier = k * 1.6;

    const S = skyAt(skyS);
    const { sN, aN, gN } = buildDynamic(S);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uShift, shiftX, shiftY);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uTop, S.top); gl.uniform3fv(U.uHor, S.hor);
    gl.uniform3fv(U.uSunDir, S.sun); gl.uniform3f(U.uLight, S.sun[0] * 0.4 + 0.2, -0.55, Math.max(S.sun[2], 0.3) + 0.5);
    gl.uniform3fv(U.uSunCol, S.sunCol); gl.uniform3fv(U.uAmb, S.amb);
    gl.uniform1f(U.uDusk, S.dusk); gl.uniform1f(U.uFog, S.fog);
    gl.uniform1f(U.uFlash, reducedMotion ? flash * 0.3 : flash);
    space.applyCamera();

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.bind(false); space.draw(0, solidCount);
    space.bind(true); space.draw(0, sN);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    space.bind(false); space.draw(solidCount, cloudCount);
    space.bind(true); space.draw(sN, aN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.draw(sN + aN, gN);
    gl.depthMask(true); gl.disable(gl.BLEND);
}

// ------------------------------------------------------------------ UI

const $ = (id) => document.getElementById(id);
const MEDALS = [[100, "platinum", "PLATINUM"], [50, "gold", "GOLD"], [25, "silver", "SILVER"], [10, "bronze", "BRONZE"]];
const ui = {
    shown: "title",
    show(which) {
        this.shown = which;
        for (const id of ["title", "paused", "over"]) $(id).classList.toggle("hidden", id !== which);
        document.body.dataset.state = which;
    },
    score(bumpIt, label) {
        const el = $("score");
        el.textContent = score;
        if (bumpIt) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
        if (label) { const p = $("plus"); p.textContent = label; p.className = ""; void p.offsetWidth; p.className = "show"; }
    },
    ready(on) { $("ready").classList.toggle("show", on && this.shown !== "title"); },
    banner(t) { const el = $("banner"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show"; },
    over(s, best, isNew, len) {
        this.show("over");
        $("o-score").textContent = s;
        $("o-best").textContent = best;
        $("o-len").textContent = len;
        $("o-new").classList.toggle("hidden", !isNew);
        const m = MEDALS.find(([n]) => s >= n);
        $("medal").className = "medal " + (m ? m[1] : "none");
        $("medal-label").textContent = m ? m[2] : `${((MEDALS.slice().reverse().find(([n]) => s < n)) || [10])[0] - s} more for a medal`;
        $("again").classList.remove("arm"); void $("again").offsetWidth; $("again").classList.add("arm");
    },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1400); },
    mute() { $("mute").setAttribute("aria-pressed", audio.muted); $("mute").title = audio.muted ? "Sound off (M)" : "Sound on (M)"; },
};
$("t-best").textContent = save.best;
ui.mute();

// ------------------------------------------------------------------ input

const KEYS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { audio.init(); ui.toast(audio.toggleMute() ? "Sound off" : "Sound on"); ui.mute(); return; }
    if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) { if (state === "play") pause(); else if (state === "paused") confirm(); return; }
    if (KEYS[e.code]) { e.preventDefault(); if (!e.repeat) steer(DIRS[KEYS[e.code]]); return; }
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
        if (e.target instanceof HTMLButtonElement && e.code === "Enter") return;
        e.preventDefault(); confirm();
    }
});
// swipes: a new direction every ~22px of travel, so one continuous gesture can make several turns
const interactive = (t) => t instanceof Element && t.closest("button, a, .no-swipe");
let swipe = null;
addEventListener("pointerdown", (e) => {
    if (interactive(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    swipe = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
}, { passive: false });
addEventListener("pointermove", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 22) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : (dy > 0 ? DIRS.down : DIRS.up));
    swipe.x = e.clientX; swipe.y = e.clientY; swipe.moved = true;
});
addEventListener("pointerup", (e) => { if (swipe && e.pointerId === swipe.id && !swipe.moved) confirm(); swipe = null; });
addEventListener("pointercancel", () => { swipe = null; });
addEventListener("contextmenu", (e) => e.preventDefault());
for (const b of document.querySelectorAll("#pad button")) b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); steer(DIRS[b.dataset.dir]); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
addEventListener("blur", pause);
$("pause").addEventListener("click", () => { audio.init(); audio.ui(); if (state === "play") pause(); else if (state === "paused") confirm(); });
$("mute").addEventListener("click", () => { audio.init(); audio.toggleMute(); ui.mute(); ui.toast(audio.muted ? "Sound off" : "Sound on"); });
$("again").addEventListener("click", () => confirm());
$("resume").addEventListener("click", () => confirm());
$("share").addEventListener("click", async () => {
    audio.init(); audio.ui();
    const url = location.origin + location.pathname, text = `I scored ${score} in Snake 3D! Can you beat it?`;
    try {
        if (navigator.share) await navigator.share({ title: "Snake 3D", text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); ui.toast("Link copied"); }
    } catch { }
});
// the on-screen pad appears on touch screens held upright
const coarse = matchMedia("(pointer: coarse)");
const layout = () => document.body.classList.toggle("pad-on", coarse.matches && innerHeight > innerWidth * 1.1);
layout(); addEventListener("resize", layout);

// ------------------------------------------------------------------ loop

reset();
ui.show(AUTO ? "hud" : "title");
window.__snake3d = () => ({ state, score, length: snake.length, best: save.best, head: snake[0], queue: queue.length, lastDeath });
let last = performance.now();
function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (state !== "paused") update(dt);
    render();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
