// FLAPPY 3D — tap to flap through the pipes, rendered with the projection3d library (Space).
//
// The bird flies along +x; z is up, y points into the screen. Tap, click, Space, W or ↑ gives an instant flap.
// Pipes get a little closer and faster as the score climbs, and the sky turns from day to sunset, night and dawn.
//
// Rendering: the sky, meadow, hills, mountains, trees and clouds live in Space's buffers and are rebuilt in
// big chunks as the camera travels. Pipes, the bird, its shadow and all effects are rebuilt every frame into
// GameSpace's dynamic buffers.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Audio } from "./audio.js";

const params = new URLSearchParams(location.search);
const AUTO = params.has("autoplay");               // demo / testing: the bird flies itself
const ZOOM = Math.max(1, Math.min(3, +params.get("zoom") || 1));   // screenshots: frame the bird closer
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ tuning

const GROUND = 0, CEIL = 15.5;                     // playfield floor and ceiling
const GRAV = -34, FLAP = 10.8, MAX_FALL = -17;     // units / s
const HIT_R = 0.42;                                // collision radius (the bird is drawn ~0.7 wide: forgiving)
const BIRD_SCALE = 1.15;
const PR = 1.15, LR = 1.4, LIP = 0.6;              // pipe radius, lip radius, lip height
const SPACING = 9.5;                               // distance between pipes
const SPEED0 = 5.6, SPEED_MAX = 7.6;
const GAP0 = 6.0, GAP_MIN = 4.4;
const STEP = 1 / 120;                              // fixed physics step
const START_Z = 7.6;

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

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

// vertical cylinder at (x, y) from z0 to z1; alternate facets are shaded a touch differently for a crafted look
function cylinder(m, x, y, z0, z1, r, seg, col, mat, capTop = false, capBot = false) {
    const dark = [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9];
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const x0 = x + Math.cos(a0) * r, y0 = y + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, y1 = y + Math.sin(a1) * r;
        m.quad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], i % 2 ? col : dark, mat);
        if (capTop) m.tri([x, y, z1], [x0, y0, z1], [x1, y1, z1], col, mat);
        if (capBot) m.tri([x, y, z0], [x1, y1, z0], [x0, y0, z0], col, mat);
    }
}
function disc(m, x, y, z, r, seg, col, mat) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        m.tri([x, y, z], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z], col, mat);
    }
}
function cone(m, x, y, z0, h, r, seg, col, mat = 0) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2 + 0.3, a1 = ((i + 1) / seg) * Math.PI * 2 + 0.3;
        m.tri([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [x, y, z0 + h], i % 2 ? col : [col[0] * 0.88, col[1] * 0.88, col[2] * 0.88], mat);
    }
}
// low-poly ellipsoid; colFn(averageLocalZ) picks a colour per triangle
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

// ------------------------------------------------------------------ the bird (built once in local space)

const YELLOW = [1.0, 0.78, 0.16], CREAM = [1.0, 0.93, 0.72], ORANGE = [1.0, 0.5, 0.12], WING = [0.98, 0.64, 0.1];
const BIRD = [];
blob(BIRD, 0, 0, 0, 0.62, 0.5, 0.52, 10, 7, (z) => (z < -0.12 ? CREAM : YELLOW));
for (const s of [-1, 1]) {
    blob(BIRD, 0.32, s * 0.31, 0.2, 0.17, 0.12, 0.18, 7, 5, () => [1, 1, 1]);                         // eye
    blob(BIRD, 0.42, s * 0.39, 0.22, 0.08, 0.05, 0.1, 6, 4, () => [0.04, 0.04, 0.07]);               // pupil
    blob(BIRD, 0.44, s * 0.42, 0.27, 0.025, 0.02, 0.03, 4, 3, () => [3, 3, 3], 2);                   // glint
    blob(BIRD, 0.26, s * 0.43, -0.08, 0.1, 0.03, 0.06, 6, 3, () => [1.0, 0.5, 0.5]);                 // cheek
}
{   // beak
    const b1 = [0.5, -0.15, 0.02], b2 = [0.5, 0.15, 0.02], b3 = [0.48, 0.13, -0.15], b4 = [0.48, -0.13, -0.15], tip = [0.9, 0, -0.06];
    BIRD.push([b1, b2, tip, ORANGE, 0], [b2, b3, tip, [0.86, 0.38, 0.08], 0], [b3, b4, tip, [0.86, 0.38, 0.08], 0], [b4, b1, tip, ORANGE, 0]);
}
{   // tail and crest
    const base = [-0.55, 0, 0.05];
    BIRD.push([base, [-0.98, -0.2, 0.28], [-1.02, 0, 0.12], WING, 0], [base, [-1.02, 0, 0.12], [-0.98, 0.2, 0.28], WING, 0]);
    BIRD.push([[0.0, 0, 0.47], [0.24, 0, 0.5], [0.06, 0, 0.74], ORANGE, 0], [[0.18, 0, 0.48], [0.38, 0, 0.44], [0.3, 0, 0.66], ORANGE, 0]);
}

// ------------------------------------------------------------------ static scenery (rebuilt in chunks)

const stat = new Mesh(150000);
let solidCount = 0, cloudCount = 0, staticX0 = -1e9;
const hillZ = (row, x) => {
    const k = [[0.11, 0.043, 4, 7], [0.06, 0.023, 7, 12], [0.035, 0.013, 11, 20]][row];
    return k[2] + Math.sin(x * k[0] + row * 2.1) * k[2] * 0.45 + Math.sin(x * k[1] + row * 5.3) * k[3] * 0.5 + k[3] * 0.3;
};
function buildStatic(x0) {
    const m = stat; m.reset();
    const xa = x0 - 300, xb = x0 + 520;
    m.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
    // meadow
    for (let gx = Math.floor(xa / 60) * 60; gx < xb; gx += 60) for (let gy = -60; gy < 360; gy += 60)
        m.quad([gx, gy, 0], [gx + 60, gy, 0], [gx + 60, gy + 60, 0], [gx, gy + 60, 0], [0, 0, 0], 6);
    // rolling hills in three rows, darker and bluer with distance
    const rows = [[42, 5, [0.22, 0.52, 0.2]], [82, 8, [0.24, 0.5, 0.3]], [135, 12, [0.3, 0.48, 0.44]]];
    rows.forEach(([y, step, col], row) => {
        for (let x = Math.floor(xa / step) * step; x < xb; x += step) {
            const h0 = hillZ(row, x), h1 = hillZ(row, x + step), t = 0.92 + hash(x * 0.37 + row) * 0.16;
            const c = [col[0] * t, col[1] * t, col[2] * t];
            m.quad([x, y, -0.5], [x + step, y, -0.5], [x + step, y + 8, h1], [x, y + 8, h0], c);
            m.quad([x, y + 8, h0], [x + step, y + 8, h1], [x + step, y + 18, -0.5], [x, y + 18, -0.5], [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85]);
        }
    });
    // mountains with snow caps
    for (let i = Math.floor(xa / 46); i * 46 < xb; i++) {
        const cx = i * 46 + (hash(i * 3.3) - 0.5) * 20, h = 45 + hash(i * 1.7) * 55, w = 55 + hash(i * 9.1) * 30, y = 250 + hash(i * 4.2) * 40;
        const peak = [cx, y, h], L = [cx - w, y - 10, -1], R = [cx + w, y - 10, -1], B = [cx, y + 40, -1];
        const rock = [0.44, 0.49, 0.62], snow = [0.95, 0.97, 1.0], k = 0.68;
        const cut = (a) => [lerp(a[0], peak[0], k), lerp(a[1], peak[1], k), lerp(a[2], peak[2], k)];
        m.quad(L, R, cut(R), cut(L), rock); m.tri(cut(L), cut(R), peak, snow);
        m.quad(R, B, cut(B), cut(R), [rock[0] * 0.8, rock[1] * 0.8, rock[2] * 0.8]); m.tri(cut(R), cut(B), peak, [0.82, 0.86, 0.95]);
        m.quad(B, L, cut(L), cut(B), [rock[0] * 0.8, rock[1] * 0.8, rock[2] * 0.8]); m.tri(cut(B), cut(L), peak, [0.82, 0.86, 0.95]);
    }
    // trees and bushes behind the course
    const tmp = [];
    for (let i = Math.floor(xa / 3); i * 3 < xb; i++) {
        if (hash(i * 7.31) > 0.6) continue;
        const x = i * 3 + hash(i * 3.1) * 3, y = 9 + hash(i * 5.7) * 40, s = 0.8 + hash(i * 2.3) * 0.7;
        if (hash(i * 1.9) < 0.55) {                                      // pine
            cylinder(m, x, y, -0.2, 1.2 * s, 0.22 * s, 5, [0.42, 0.27, 0.15], 0);
            const g = [0.12 + hash(i) * 0.06, 0.38 + hash(i * 1.3) * 0.12, 0.18];
            cone(m, x, y, 1.0 * s, 2.6 * s, 1.5 * s, 7, g); cone(m, x, y, 2.2 * s, 2.2 * s, 1.15 * s, 7, [g[0] * 1.15, g[1] * 1.15, g[2] * 1.15]); cone(m, x, y, 3.3 * s, 1.8 * s, 0.75 * s, 7, [g[0] * 1.3, g[1] * 1.3, g[2] * 1.3]);
        } else {                                                         // round tree
            cylinder(m, x, y, -0.2, 1.6 * s, 0.2 * s, 5, [0.45, 0.3, 0.17], 0);
            const g = [0.3 + hash(i * 4.4) * 0.15, 0.6 + hash(i * 1.1) * 0.12, 0.2];
            tmp.length = 0; blob(tmp, x, y, 2.4 * s, 1.35 * s, 1.35 * s, 1.2 * s, 7, 5, (z) => (z > 0.3 ? [g[0] * 1.15, g[1] * 1.15, g[2]] : g));
            for (const [a, b, c, col] of tmp) m.tri(a, b, c, col);
        }
    }
    for (let i = Math.floor(xa / 5); i * 5 < xb; i++) {                   // low bushes just behind the pipes
        if (hash(i * 13.7) > 0.45) continue;
        const x = i * 5 + hash(i * 2.9) * 4, y = 4 + hash(i * 6.1) * 3, r = 0.6 + hash(i * 8.3) * 0.6;
        tmp.length = 0; blob(tmp, x, y, r * 0.4, r * 1.3, r, r * 0.8, 6, 4, (z) => (z > 0 ? [0.3, 0.66, 0.24] : [0.22, 0.52, 0.18]));
        for (const [a, b, c, col] of tmp) m.tri(a, b, c, col);
    }
    solidCount = m.n;
    // clouds
    for (let i = Math.floor(xa / 22); i * 22 < xb; i++) {
        const cx = i * 22 + hash(i * 5.1) * 18, cy = 55 + hash(i * 2.2) * 150, cz = 17 + hash(i * 8.8) * 26;
        const n = 4 + Math.floor(hash(i * 3.9) * 4);
        for (let k = 0; k < n; k++) m.sprite(cx + (hash(i * 11 + k) - 0.5) * 14, cy + (hash(i * 17 + k) - 0.5) * 6, cz + (hash(i * 23 + k) - 0.5) * 3, 5 + hash(i * 29 + k) * 6, hash(i + k), hash(i * 2 + k), 0.55 + hash(i * 31 + k) * 0.45, 7);
    }
    cloudCount = m.n - solidCount;
    space.setStatic(m.pos, m.col, m.n);
    staticX0 = x0;
}

// ------------------------------------------------------------------ time of day (follows the score)

const SKY = {   // top, horizon, sun dir, sun colour, ambient, night, fog
    day: [[0.1, 0.42, 1.0], [0.6, 0.82, 1.0], [0.35, 1, 0.42], [1.0, 0.95, 0.85], [0.55, 0.62, 0.76], 0, 0.0032],
    sunset: [[0.24, 0.24, 0.58], [1.0, 0.6, 0.38], [0.55, 1, 0.06], [1.0, 0.58, 0.3], [0.55, 0.42, 0.46], 0.15, 0.0036],
    night: [[0.015, 0.025, 0.09], [0.09, 0.12, 0.27], [-0.3, 1, 0.45], [0.42, 0.5, 0.78], [0.2, 0.24, 0.4], 1, 0.004],
    dawn: [[0.32, 0.42, 0.8], [1.0, 0.76, 0.66], [-0.45, 1, 0.1], [1.0, 0.72, 0.55], [0.6, 0.52, 0.56], 0.25, 0.0034],
};
const CYCLE = [[0, "day"], [11, "day"], [16, "sunset"], [22, "night"], [33, "night"], [39, "dawn"], [45, "day"]];
function skyAt(s) {
    s = s % 45;
    let i = 0;
    while (i < CYCLE.length - 2 && s > CYCLE[i + 1][0]) i++;
    const [f0, n0] = CYCLE[i], [f1, n1] = CYCLE[i + 1];
    const t = clamp((s - f0) / (f1 - f0), 0, 1), e = t * t * (3 - 2 * t), A = SKY[n0], B = SKY[n1];
    return { top: lerp3(A[0], B[0], e), hor: lerp3(A[1], B[1], e), sun: lerp3(A[2], B[2], e), sunCol: lerp3(A[3], B[3], e), amb: lerp3(A[4], B[4], e), night: lerp(A[5], B[5], e), fog: lerp(A[6], B[6], e) };
}

// ------------------------------------------------------------------ game state

const save = (() => { try { return Object.assign({ best: 0, games: 0 }, JSON.parse(localStorage.getItem("flappy3d.save")) || {}); } catch { return { best: 0, games: 0 }; } })();
const persist = () => { try { localStorage.setItem("flappy3d.save", JSON.stringify(save)); } catch { } };

let state = "ready";            // ready | play | paused | dying | over
const bird = { x: 0, z: START_Z, vz: 0, pitch: 0, flapT: 1, wing: 0, vx: 0 };
let pipes = [], feathers = [], sparks = [], rings = [], puffs = [];
let score = 0, spawned = 0, nextPipeX = 0, lastC = START_Z, speed = SPEED0;
let lastDeath = null;
let time = 0, overT = 0, landT = -1, shake = 0, flash = 0, skyS = 0, camX = 0, newBest = false;

function reset() {
    bird.x = 0; bird.z = START_Z; bird.vz = 0; bird.pitch = 0; bird.flapT = 1; bird.vx = 0;
    pipes = []; feathers = []; sparks = []; rings = []; puffs = [];
    score = 0; spawned = 0; lastC = START_Z; speed = SPEED0; landT = -1; newBest = false; overT = 0;
    state = "ready";
    ui.score(); ui.ready(true);
}
function addPipe() {
    const gap = Math.max(GAP_MIN, GAP0 - spawned * 0.055);
    const lo = GROUND + 1.7 + gap / 2, hi = CEIL - 1.6 - gap / 2;
    const swing = Math.min(4.2, 2.2 + spawned * 0.12);                 // the first few stay close to centre
    let c = clamp(lastC + (Math.random() * 2 - 1) * swing, lo, hi);
    if (Math.abs(c - lastC) < 0.8 && spawned > 2) c = clamp(lastC + (c > (lo + hi) / 2 ? -1.6 : 1.6), lo, hi);
    pipes.push({ x: nextPipeX, c, gap, scored: false, glow: 0 });
    lastC = c; nextPipeX += SPACING; spawned++;
}
function startPlay() {
    state = "play";
    nextPipeX = bird.x + 15;
    while (nextPipeX < bird.x + 80) addPipe();
    ui.ready(false); ui.show("hud");
}
function flap() {
    if (state === "ready") startPlay();
    bird.vz = FLAP; bird.flapT = 0;
    audio.flap();
    for (let i = 0; i < 2; i++) feather(bird.x - 0.4, bird.z - 0.1, 0.6, 0.35);
    puffs.push({ x: bird.x - 0.5, z: bird.z - 0.25, t: 0 });
}
function feather(x, z, spread, life) {
    feathers.push({ x, y: (Math.random() - 0.5) * 0.6, z, vx: -1 - Math.random() * 2 * spread, vy: (Math.random() - 0.5) * 2 * spread, vz: (Math.random() - 0.2) * 3 * spread,
        a: Math.random() * 6, w: (Math.random() - 0.5) * 10, life: life + Math.random() * life, col: Math.random() < 0.5 ? YELLOW : CREAM, s: 0.12 + Math.random() * 0.1 });
}
function onScore(p) {
    score++;
    p.glow = 1;
    audio.score(score);
    rings.push({ x: p.x, z: p.c, t: 0 });
    for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 3;
        sparks.push({ x: p.x, y: 0, z: p.c, vx: Math.cos(a) * v * 0.6, vy: (Math.random() - 0.5) * 2, vz: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, col: [1.4, 1.1, 0.4] });
    }
    ui.score(true);
    if (score % 10 === 0) ui.banner(score === 10 ? "NICE!" : score === 25 ? "AMAZING!" : score === 50 ? "LEGENDARY!" : `${score}!`);
    if (score === save.best + 1 && save.best > 0) { ui.toast("New best!"); audio.best(); }
}
function die(kind) {
    if (state !== "play") return;
    state = "dying";
    { const p = pipes.find((q) => Math.abs(q.x - bird.x) < LR + 1); lastDeath = { kind, x: +bird.x.toFixed(2), z: +bird.z.toFixed(2), vz: +bird.vz.toFixed(2), pipe: p && { x: +p.x.toFixed(2), lo: +(p.c - p.gap / 2).toFixed(2), hi: +(p.c + p.gap / 2).toFixed(2) } }; }
    audio.hit(); if (kind === "pipe") audio.fall();
    shake = 1; flash = 0.5;
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(45); } catch { }
    for (let i = 0; i < 14; i++) feather(bird.x, bird.z, 1.4, 0.8);
    bird.vx = kind === "pipe" ? -1.2 : 0;
    bird.vz = kind === "pipe" ? Math.max(bird.vz, 3) : 0;
    newBest = score > save.best;
    if (newBest) save.best = score;
    save.games++; persist();
    ui.show("hud");
}
function pause() {
    if (state !== "play") return;
    state = "paused";
    ui.show("paused");
}

// one handler for every kind of input: instant, no click delay
function action() {
    audio.init();
    if (state === "ready" || state === "play") { flap(); return; }
    if (state === "paused") { state = "play"; ui.show("hud"); flap(); return; }
    if (state === "over" && overT > 0.55) { reset(); flap(); }
}

// ------------------------------------------------------------------ simulation

function collides(p) {
    const lo = p.c - p.gap / 2, hi = p.c + p.gap / 2, r = HIT_R;
    const hit = (x0, x1, z0, z1) => { const nx = clamp(bird.x, x0, x1), nz = clamp(bird.z, z0, z1); return (bird.x - nx) ** 2 + (bird.z - nz) ** 2 < r * r; };
    return hit(p.x - PR, p.x + PR, -10, lo - LIP) || hit(p.x - LR, p.x + LR, lo - LIP, lo) || hit(p.x - LR, p.x + LR, hi, hi + LIP) || hit(p.x - PR, p.x + PR, hi + LIP, 100);
}
function autopilot() {
    const next = pipes.find((p) => p.x + LR > bird.x - 0.3);
    const target = next && next.x - bird.x < 14 ? next.c - 0.9 : START_Z;      // a flap rises ~1.7: hover low in the gap
    if (bird.z < target && bird.vz <= 0) flap();
}

function step(dt) {
    time += dt;
    bird.flapT += dt;
    if (state === "ready") {
        bird.x += SPEED0 * dt;
        bird.z = START_Z + Math.sin(time * 3.2) * 0.35;
        bird.vz = Math.cos(time * 3.2) * 1.1;
        if (AUTO) flap();
    } else if (state === "play") {
        if (AUTO) autopilot();
        speed = Math.min(SPEED_MAX, SPEED0 + score * 0.045);
        bird.vz = Math.max(MAX_FALL, bird.vz + GRAV * dt);
        bird.z += bird.vz * dt;
        bird.x += speed * dt;
        if (bird.z > CEIL - 0.4) { bird.z = CEIL - 0.4; bird.vz = Math.min(bird.vz, 0); }
        while (nextPipeX < bird.x + 80) addPipe();
        for (const p of pipes) if (!p.scored && bird.x > p.x) { p.scored = true; onScore(p); }
        if (bird.z - HIT_R <= GROUND + 0.05) die("ground");
        else for (const p of pipes) if (Math.abs(p.x - bird.x) < LR + 1 && collides(p)) { die("pipe"); break; }
    } else if (state === "dying") {
        bird.vz = Math.max(MAX_FALL, bird.vz + GRAV * dt);
        bird.z += bird.vz * dt;
        bird.x += bird.vx * dt; bird.vx *= Math.exp(-dt * 2);
        if (bird.z - 0.45 <= GROUND) {
            bird.z = GROUND + 0.45; bird.vz = 0;
            if (landT < 0) { landT = 0; shake = Math.max(shake, 0.45); for (let i = 0; i < 6; i++) feather(bird.x, bird.z, 0.8, 0.6); }
        }
        if (landT >= 0) { landT += dt; if (landT > 0.45) { state = "over"; overT = 0; ui.over(score, save.best, newBest); if (newBest) audio.best(); } }
    } else if (state === "over") {
        overT += dt;
        if (AUTO && overT > 1.2) { reset(); flap(); }
    }
    pipes = pipes.filter((p) => p.x > bird.x - 40);
    for (const p of pipes) p.glow = Math.max(0, p.glow - dt * 1.5);
    for (const f of feathers) { f.vz -= 5 * dt; f.vx *= Math.exp(-dt * 1.5); f.vy *= Math.exp(-dt * 1.5); f.vz *= Math.exp(-dt * 1.2); f.x += f.vx * dt; f.y += f.vy * dt; f.z = Math.max(0.03, f.z + f.vz * dt); f.a += f.w * dt; f.life -= dt; }
    feathers = feathers.filter((f) => f.life > 0);
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 4 * dt; s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < 0.7);
    for (const p of puffs) p.t += dt;
    puffs = puffs.filter((p) => p.t < 0.45);
    // the bird noses up on a flap and dips as it falls
    let target = clamp(Math.atan2(bird.vz, speed * 1.5), -1.3, 0.5);
    if (state === "ready") target = bird.vz * 0.06;
    if (bird.flapT < 0.12 && state === "play") target = 0.5;
    if (state === "dying" || state === "over") target = -1.45;
    bird.pitch += (target - bird.pitch) * Math.min(1, dt * (target < bird.pitch ? 7 : 16));
    shake *= Math.exp(-dt * 6); flash = Math.max(0, flash - dt * 2.2);
    skyS += (score - skyS) * Math.min(1, dt * 0.7);
}

// ------------------------------------------------------------------ per-frame geometry

const solid = new Mesh(40000), alpha = new Mesh(4000), glow = new Mesh(8000);

function birdMesh() {
    const p = bird.pitch, cp = Math.cos(p), sp = Math.sin(p);
    const e = state === "play" || state === "ready" ? Math.exp(-bird.flapT * 14) : 0;  // squash & stretch on a flap
    const sx = (1 - 0.1 * e) * BIRD_SCALE, sz = (1 + 0.14 * e) * BIRD_SCALE, sy = BIRD_SCALE;
    const T = (q) => { const x = q[0] * sx, z = q[2] * sz; return [bird.x + x * cp - z * sp, q[1] * sy, bird.z + x * sp + z * cp]; };
    for (const [a, b, c, col, mat] of BIRD) solid.tri(T(a), T(b), T(c), col, mat);
    // wings: a quick full stroke after each flap, a lazy glide otherwise
    let ang;
    if (state === "dying" || state === "over") ang = 0.9;
    else if (bird.flapT < 0.3) ang = 0.15 + 0.85 * Math.cos((bird.flapT / 0.3) * Math.PI * 2);
    else ang = 0.25 + Math.sin(time * (state === "ready" ? 10 : 7)) * 0.3;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (const s of [-1, 1]) {
        const W = (u, v) => T([u, s * (0.42 + v * ca), 0.06 + v * sa]);
        const rf = W(0.22, 0), rb = W(-0.32, 0), tf = W(0.12, 0.62), tm = W(-0.12, 0.8), tb = W(-0.48, 0.58);
        solid.tri(rf, tf, tm, WING); solid.tri(rf, tm, rb, WING); solid.tri(rb, tm, tb, [0.92, 0.56, 0.08]);
    }
}

function pipeMesh(p, night) {
    const lo = p.c - p.gap / 2, hi = p.c + p.gap / 2;
    const body = [0.26, 0.8, 0.22], lip = [0.44, 0.95, 0.3], hole = [0.04, 0.16, 0.05];
    cylinder(solid, p.x, 0, -0.4, lo - LIP, PR, 18, body, 1);
    cylinder(solid, p.x, 0, lo - LIP, lo, LR, 18, lip, 1, true, true);
    disc(solid, p.x, 0, lo + 0.005, LR * 0.72, 18, hole, 0);
    cylinder(solid, p.x, 0, hi, hi + LIP, LR, 18, lip, 1, true, true);
    disc(solid, p.x, 0, hi - 0.005, LR * 0.72, 18, hole, 0);
    cylinder(solid, p.x, 0, hi + LIP, CEIL + 40, PR, 18, body, 1);
    // glowing rings at the gap edges: they light up after dark and flash when you pass
    const g = Math.max(night * 0.9, p.glow * 1.6);
    if (g > 0.02) {
        const c = [1.3 * g, 1.05 * g, 0.5 * g];
        cylinder(solid, p.x, 0, lo - 0.1, lo - 0.02, LR + 0.03, 18, c, 2);
        cylinder(solid, p.x, 0, hi + 0.02, hi + 0.1, LR + 0.03, 18, c, 2);
    }
    alpha.sprite(p.x, 0, 0.02, 2.0, 0.35, 0, 0, 8);                   // contact shadow
}

function buildDynamic(night) {
    solid.reset(); alpha.reset(); glow.reset();
    for (const p of pipes) if (Math.abs(p.x - camX) < 70) pipeMesh(p, night);
    birdMesh();
    for (const f of feathers) {
        const ca = Math.cos(f.a) * f.s, sa = Math.sin(f.a) * f.s;
        solid.tri([f.x + ca, f.y, f.z + sa], [f.x - sa * 0.4, f.y + 0.02, f.z + ca * 0.4], [f.x - ca, f.y, f.z - sa], f.col);
        solid.tri([f.x + ca, f.y, f.z + sa], [f.x - ca, f.y, f.z - sa], [f.x + sa * 0.4, f.y - 0.02, f.z - ca * 0.4], f.col);
    }
    const h = clamp(bird.z / 16, 0, 1);
    alpha.sprite(bird.x, 0, 0.03, 0.85 - h * 0.35, 0.5 * (1 - h * 0.75), 0, 0, 8);
    for (const s of sparks) { const k = Math.min(1, s.life * 2); glow.sprite(s.x, s.y, s.z, 0.12, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
    for (const r of rings) {
        const k = 1 - r.t / 0.7, rad = 0.6 + r.t * 3.2;
        for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; glow.sprite(r.x, Math.sin(a) * rad * 0.35, r.z + Math.cos(a) * rad, 0.16, 1.2 * k, 1.0 * k, 0.45 * k); }
    }
    for (const p of puffs) { const k = 1 - p.t / 0.45; glow.sprite(p.x - p.t * 2, 0, p.z - p.t * 0.6, 0.25 + p.t * 0.8, 0.22 * k, 0.22 * k, 0.24 * k); }
    const sN = solid.n, aN = alpha.n;
    solid.append(alpha); solid.append(glow);
    space.setDynamic(solid.pos, solid.col, solid.n);
    return { sN, aN, gN: glow.n };
}

// ------------------------------------------------------------------ render

const D = 24, SIDE = 5.5, De = Math.hypot(D, SIDE);
function render() {
    const aspect = canvas.width / canvas.height;
    const needW = 18, needH = 17.5;
    space.magnifier = Math.min(1.6 * De / (needW / 2), 1.6 * De / ((needH / 2) * aspect)) * ZOOM;
    const hw = 1.6 * De / space.magnifier;
    camX = bird.x + hw * 0.34;
    if (Math.abs(camX - staticX0) > 140) buildStatic(camX);
    // on tall (portrait) screens there is spare height: aim higher so the course sits low, where thumbs are,
    // and the pipes tower above instead of a wide strip of meadow filling the bottom
    const vh = 1.6 * De / (space.magnifier * aspect);
    const follow = (bird.z - 7.6) * 0.12, tz = Math.max(7.6, vh * 0.5) + follow, camZ = tz + 1.1;
    const s = shake * (reducedMotion ? 0.1 : 0.4), sx = (Math.random() - 0.5) * s, sz = (Math.random() - 0.5) * s;
    space.lookAt(camX - SIDE + sx, -D, camZ + sz, camX + sx, 0, tz + sz);
    const S = skyAt(skyS);
    const { sN, aN, gN } = buildDynamic(S.night);

    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uTop, S.top); gl.uniform3fv(U.uHor, S.hor);
    gl.uniform3fv(U.uSunDir, S.sun); gl.uniform3f(U.uLight, S.sun[0] * 0.5 + 0.25, -0.75, Math.max(S.sun[2], 0.25) + 0.45); gl.uniform3fv(U.uSunCol, S.sunCol); gl.uniform3fv(U.uAmb, S.amb);
    gl.uniform1f(U.uNight, S.night); gl.uniform1f(U.uFog, S.fog);
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
    score(bump) {
        const el = $("score");
        el.textContent = score;
        if (bump) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    },
    ready(on) { $("ready").classList.toggle("show", on && this.shown !== "title"); },
    banner(t) { const el = $("banner"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show"; },
    over(s, best, isNew) {
        this.show("over");
        $("o-score").textContent = s;
        $("o-best").textContent = best;
        $("o-new").classList.toggle("hidden", !isNew);
        const m = MEDALS.find(([n]) => s >= n);
        $("medal").className = "medal " + (m ? m[1] : "none");
        $("medal-label").textContent = m ? m[2] : `${(MEDALS.slice().reverse().find(([n]) => s < n) || [10])[0] - s} more for a medal`;
        $("again").classList.remove("arm"); void $("again").offsetWidth; $("again").classList.add("arm");
    },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1400); },
    mute() { $("mute").setAttribute("aria-pressed", audio.muted); $("mute").title = audio.muted ? "Sound off (M)" : "Sound on (M)"; },
};
$("t-best").textContent = save.best;
ui.mute();

// ------------------------------------------------------------------ input

const interactive = (t) => t instanceof Element && t.closest("button, a, .no-flap");
addEventListener("pointerdown", (e) => {
    if (interactive(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (ui.shown === "title") ui.show("hud");
    action();
}, { passive: false });
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { audio.init(); ui.toast(audio.toggleMute() ? "Sound off" : "Sound on"); ui.mute(); return; }
    if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) { if (state === "play") pause(); else if (state === "paused") action(); return; }
    if (e.repeat) return;
    if (["Space", "ArrowUp", "KeyW", "Enter"].includes(e.code)) {
        if (e.target instanceof HTMLButtonElement && e.code !== "Space" && e.code !== "ArrowUp" && e.code !== "KeyW") return;
        e.preventDefault();
        if (ui.shown === "title") ui.show("hud");
        action();
    }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
addEventListener("blur", pause);
$("pause").addEventListener("click", () => { audio.init(); audio.ui(); if (state === "play") pause(); else if (state === "paused") action(); });
$("mute").addEventListener("click", () => { audio.init(); audio.toggleMute(); ui.mute(); ui.toast(audio.muted ? "Sound off" : "Sound on"); });
$("again").addEventListener("click", () => action());
$("resume").addEventListener("click", () => action());
$("share").addEventListener("click", async () => {
    audio.init(); audio.ui();
    const url = location.origin + location.pathname, text = `I scored ${score} in Flappy 3D! Can you beat it?`;
    try {
        if (navigator.share) await navigator.share({ title: "Flappy 3D", text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); ui.toast("Link copied"); }
    } catch { }
});

// ------------------------------------------------------------------ loop

reset();
ui.show(AUTO ? "hud" : "title");
window.__flappy3d = () => ({ state, score, best: save.best, x: +bird.x.toFixed(2), z: +bird.z.toFixed(2), pipes: pipes.length, lastDeath });
let last = performance.now(), acc = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (state !== "paused") {
        acc += dt;
        while (acc >= STEP) { step(STEP); acc -= STEP; }
    }
    render();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
