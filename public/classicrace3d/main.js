// CLASSIC RACE 3D — weave through traffic on a coastal highway at sunset, rendered with the projection3d library (Space).
//
// Steer with ← → / A D, drag anywhere, or hold the on-screen arrows. The car steers freely (not lane-locked), the speed
// keeps climbing, oncoming cars use the left lanes and slower cars the right. Passing close earns a near-miss bonus.
// The further you drive, the later it gets: golden hour → dusk → a starry night with glowing lamps and headlights.
//
// World: x across the road, y along it (forward), z up. Scenery (road, cliffs, beach, ocean, palms, lamps, rails,
// mountains, clouds) lives in Space's buffers, rebuilt in chunks as you drive; cars and effects are rebuilt every
// frame into GameSpace's dynamic buffers. The world is shifted back every 2880 units to keep numbers small.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Audio } from "./audio.js";

const params = new URLSearchParams(location.search);
const AUTO = params.has("autoplay");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ tuning

const LANES = [-5.25, -1.75, 1.75, 5.25];           // left two oncoming, right two same direction
const X_MAX = 6.05;                                  // how far the car can go before the guard rail
const V0 = 24, VMAX = 60, VRAMP = 0.32;              // units / s (shown ×4 as km/h)
const STEER_V = 10.5, STEER_A = 48;                  // lateral speed and acceleration
const CAR_L = 4.2, CAR_W = 1.86;
const SHIFT = 2880;                                  // world re-centring step (multiple of the 9 m dashes and 40 m lamps)

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
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
function box(m, x, y, z0, sx, sy, h, col, mat = 0) {
    const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z1 = z0 + h, d = shade(col, 0.8);
    m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], d, mat);
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

// ------------------------------------------------------------------ car model (local: x right, y forward, z up)
// parts: [a, b, c, slot] where slot is "paint", "dark" (trim), "glass", "tyre", "rim", "head", "tail", "chrome"

const CAR = (() => {
    const out = [];
    const T = (a, b, c, s) => out.push([a, b, c, s]);
    const Q = (a, b, c, d, s) => { T(a, b, c, s); T(a, c, d, s); };
    const W = CAR_W / 2, L = CAR_L / 2;
    // lower body: a wedge with a sloped nose and a rounded tail, sides slightly tucked under
    const z0 = 0.32, zs = 0.98, zn = 0.78, ins = 0.08;
    const P = {
        fl: [-W, L, zn], fr: [W, L, zn], ftl: [-W + 0.12, L - 0.45, zs], ftr: [W - 0.12, L - 0.45, zs],
        rl: [-W, -L, zs - 0.06], rr: [W, -L, zs - 0.06], btl: [-W + ins, L, z0], btr: [W - ins, L, z0], bbl: [-W + ins, -L, z0], bbr: [W - ins, -L, z0],
        sl: [-W, 0, zs], sr: [W, 0, zs],
    };
    Q(P.btl, P.btr, P.fr, P.fl, "dark");                                      // front fascia
    Q(P.fl, P.fr, P.ftr, P.ftl, "paint");                                     // hood slope
    Q(P.ftl, P.ftr, [W - 0.12, -L + 0.3, zs], [-W + 0.12, -L + 0.3, zs], "paint");   // deck
    Q([-W + 0.12, -L + 0.3, zs], [W - 0.12, -L + 0.3, zs], P.rr, P.rl, "paint");     // tail slope
    Q(P.bbr, P.bbl, P.rl, P.rr, "paint");                                     // rear panel
    for (const s of [-1, 1]) {                                                // sides
        const a = [s * (W - ins), L, z0], b = [s * (W - ins), -L, z0], c = [s * W, -L, zs - 0.06], d = [s * W, L - 0.45, zs], e = [s * W, L, zn];
        if (s > 0) { Q(a, b, c, d, "paint"); T(a, d, e, "paint"); } else { Q(b, a, d, c, "paint"); T(d, a, e, "paint"); }
    }
    // cabin: a glass canopy with a painted roof
    const cz0 = zs, cz1 = 1.5, cw0 = W - 0.18, cw1 = W - 0.42, cy0 = -1.25, cy1 = 0.75, ry0 = -0.85, ry1 = 0.15;
    const C = { a: [-cw0, cy1, cz0], b: [cw0, cy1, cz0], c: [cw1, ry1, cz1], d: [-cw1, ry1, cz1], e: [-cw0, cy0, cz0], f: [cw0, cy0, cz0], g: [cw1, ry0, cz1], h: [-cw1, ry0, cz1] };
    Q(C.a, C.b, C.c, C.d, "glass");                                           // windscreen
    Q(C.d, C.c, C.g, C.h, "paint");                                           // roof
    Q(C.h, C.g, C.f, C.e, "glass");                                           // rear window
    Q(C.b, C.f, C.g, C.c, "glass"); Q(C.e, C.a, C.d, C.h, "glass");           // side windows
    // lights: headlight strips and full-width tail light bar
    for (const s of [-1, 1]) Q([s * (W - 0.12), L + 0.01, zn - 0.12], [s * (W - 0.55), L + 0.01, zn - 0.12], [s * (W - 0.55), L + 0.01, zn - 0.02], [s * (W - 0.12), L + 0.01, zn - 0.02], "head");
    Q([W - 0.1, -L - 0.01, zs - 0.28], [-W + 0.1, -L - 0.01, zs - 0.28], [-W + 0.1, -L - 0.01, zs - 0.14], [W - 0.1, -L - 0.01, zs - 0.14], "tail");
    // wheels
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const cx = sx * (W - 0.12), cy = sy * 1.38, r = 0.36, hw = 0.16;
        for (let i = 0; i < 12; i++) {
            const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
            const p = (a, dx) => [cx + dx, cy + Math.cos(a) * r, r + Math.sin(a) * r];
            Q(p(a0, -hw), p(a1, -hw), p(a1, hw), p(a0, hw), "tyre");
            T([cx + sx * hw, cy, r], p(a0, sx * hw), p(a1, sx * hw), i % 2 ? "rim" : "chrome");
        }
    }
    return out;
})();
// the player's car also gets a rear wing
const WING = (() => {
    const out = [], W = CAR_W / 2 - 0.1, y0 = -CAR_L / 2 + 0.05, y1 = y0 + 0.45, z = 1.28;
    out.push([[-W, y0, z], [W, y0, z], [W, y1, z + 0.04], "dark"], [[-W, y0, z], [W, y1, z + 0.04], [-W, y1, z + 0.04], "dark"]);
    for (const s of [-0.55, 0.55]) out.push([[s - 0.05, y0 + 0.15, 0.95], [s + 0.05, y0 + 0.15, 0.95], [s + 0.05, y0 + 0.2, z], "dark"], [[s - 0.05, y0 + 0.15, 0.95], [s + 0.05, y0 + 0.2, z], [s - 0.05, y0 + 0.2, z], "dark"]);
    return out;
})();
const PAINTS = [[0.12, 0.42, 0.95], [0.95, 0.75, 0.15], [0.95, 0.95, 0.97], [0.15, 0.7, 0.45], [0.55, 0.3, 0.85], [0.95, 0.45, 0.12], [0.2, 0.22, 0.26], [0.0, 0.65, 0.75]];

// ------------------------------------------------------------------ scenery, rebuilt in chunks along the road

const stat = new Mesh(220000);
let solidCount = 0, cloudCount = 0, chunkY = -1e9;
const cliffH = (x, y) => {   // left side: grassy verge rising into rocky cliffs and mountains
    const d = -x - 8.5;
    const n = Math.sin(y * 0.031 + 1.7) * 0.5 + Math.sin(y * 0.083) * 0.3 + Math.sin(y * 0.011 + 4) * 0.8;
    return d <= 0 ? 0 : Math.pow(d, 1.15) * (0.32 + 0.12 * n) + Math.max(0, d - 40) * 0.5 * (0.8 + 0.4 * Math.sin(y * 0.006 + x * 0.01));
};
function buildStatic(y0) {
    const m = stat; m.reset();
    const ya = Math.floor((y0 - 80) / 12) * 12, yb = y0 + 620;
    m.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
    // road and shoulders
    for (let y = ya; y < yb; y += 24) {
        m.quad([-7, y, 0], [7, y, 0], [7, y + 24, 0], [-7, y + 24, 0], [0, 0, 0], 6);
        m.quad([7, y, 0], [8.4, y, 0], [8.4, y + 24, 0], [7, y + 24, 0], [0.42, 0.4, 0.38]);
        m.quad([-8.4, y, 0], [-7, y, 0], [-7, y + 24, 0], [-8.4, y + 24, 0], [0.42, 0.4, 0.38]);
    }
    // the ocean and the beach on the right
    for (let y = Math.floor(ya / 120) * 120; y < yb + 600; y += 120) for (let x = 14; x < 900; x += x < 200 ? 60 : 200)
        m.quad([x, y, -0.55], [x + (x < 200 ? 60 : 200), y, -0.55], [x + (x < 200 ? 60 : 200), y + 120, -0.55], [x, y + 120, -0.55], [0, 0, 0], 4);
    for (let y = ya; y < yb; y += 12) {
        const t = 0.92 + hash(y * 0.31) * 0.12, sand = [0.86 * t, 0.74 * t, 0.52 * t], wet = [0.62 * t, 0.52 * t, 0.36 * t];
        m.quad([8.4, y, 0], [11, y, -0.05], [11, y + 12, -0.05], [8.4, y + 12, 0], [0.5, 0.46, 0.38]);
        m.quad([11, y, -0.05], [18, y, -0.35], [18, y + 12, -0.35], [11, y + 12, -0.05], sand);
        m.quad([18, y, -0.35], [22, y, -0.65], [22, y + 12, -0.65], [18, y + 12, -0.35], wet);
    }
    // cliffs and mountains on the left
    const XS = [-8.4, -9.6, -11, -13, -15.5, -19, -24, -32, -48, -75, -120, -200, -320];
    for (let y = ya; y < yb + 300; y += 8) for (let i = 0; i < XS.length - 1; i++) {
        const xa = XS[i], xb = XS[i + 1], h = (x, yy) => cliffH(x, yy);
        const d = -xa - 8.4, k = 0.86 + hash(y * 0.7 + i * 1.3) * 0.26, hm = (h(xa, y) + h(xb, y)) / 2;
        let col;
        if (d < 2.5) col = [0.34 * k, 0.58 * k, 0.24 * k];                                  // grassy verge
        else if (d < 70) {
            const strata = Math.sin(hm * 1.3 + Math.sin(y * 0.02) * 2) > 0.55 ? 0.78 : 1;    // darker rock bands
            col = [0.62 * k * strata, 0.5 * k * strata, 0.38 * k * strata];
            if (hash(y * 1.9 + i * 7.7) < 0.22 && d < 30) col = [0.3 * k, 0.48 * k, 0.24 * k];  // patches of scrub
        } else col = [0.46 * k, 0.5 * k, 0.6 * k];                                        // distant blue mountains
        m.quad([xa, y, h(xa, y)], [xa, y + 8, h(xa, y + 8)], [xb, y + 8, h(xb, y + 8)], [xb, y, h(xb, y)], col);
    }
    // guard rails
    for (const sx of [-1, 1]) {
        const x = sx * 8.25;
        for (let y = Math.floor(ya / 4) * 4; y < yb; y += 4) box(m, x, y, 0, 0.14, 0.14, 0.75, [0.55, 0.55, 0.58]);
        for (let y = ya; y < yb; y += 24) { box(m, x, y + 12, 0.48, 0.08, 24, 0.24, [0.82, 0.83, 0.86]); }
    }
    // street lamps every 40 m on the right, arms over the road
    for (let y = Math.ceil(ya / 40) * 40; y < yb; y += 40) {
        cylinder(m, 9.0, y, 0, 6.8, 0.1, 6, [0.32, 0.34, 0.38]);
        box(m, 7.9, y, 6.75, 2.3, 0.14, 0.12, [0.32, 0.34, 0.38]);
        box(m, 6.9, y, 6.55, 0.6, 0.32, 0.2, [0.25, 0.26, 0.3]);
        box(m, 6.9, y, 6.5, 0.5, 0.26, 0.05, [1.0, 0.82, 0.55], 9);
    }
    // palm trees on the beach, shrubs and boulders on the verge
    const tmpCol = [[0.18, 0.55, 0.2], [0.24, 0.62, 0.25], [0.14, 0.48, 0.18]];
    for (let i = Math.floor(ya / 9); i * 9 < yb; i++) {
        if (hash(i * 3.7) < 0.45) {
            const x = 12 + hash(i * 1.3) * 7, y = i * 9 + hash(i * 2.9) * 6, hgt = 6 + hash(i * 5.1) * 3.5, lean = 0.6 + hash(i * 7.3) * 0.9;
            let px = x, pz = -0.2;
            for (let s = 0; s < 6; s++) {
                const nx = x + lean * Math.pow((s + 1) / 6, 2), nz = (s + 1) / 6 * hgt;
                const r0 = 0.24 - s * 0.022, r1 = r0 - 0.022;
                for (let k = 0; k < 6; k++) {
                    const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
                    m.quad([px + Math.cos(a0) * r0, y + Math.sin(a0) * r0, pz], [px + Math.cos(a1) * r0, y + Math.sin(a1) * r0, pz], [nx + Math.cos(a1) * r1, y + Math.sin(a1) * r1, nz], [nx + Math.cos(a0) * r1, y + Math.sin(a0) * r1, nz], s % 2 ? [0.5, 0.36, 0.22] : [0.44, 0.31, 0.19]);
                }
                px = nx; pz = nz;
            }
            for (let f = 0; f < 8; f++) {                                       // drooping fronds
                const a = f / 8 * Math.PI * 2 + hash(i + f), len = 3 + hash(i * f + 1) * 1.2, col = tmpCol[f % 3];
                const dx = Math.cos(a), dy = Math.sin(a), side = [-dy * 0.42, dx * 0.42];
                const mid = [px + dx * len * 0.5, y + dy * len * 0.5, pz + 0.55], tip = [px + dx * len, y + dy * len, pz - 1.0];
                m.tri([px, y, pz + 0.1], [mid[0] + side[0], mid[1] + side[1], mid[2]], mid, col);
                m.tri([px, y, pz + 0.1], mid, [mid[0] - side[0], mid[1] - side[1], mid[2]], shade(col, 0.85));
                m.tri(mid, [mid[0] + side[0], mid[1] + side[1], mid[2]], tip, col);
                m.tri(mid, tip, [mid[0] - side[0], mid[1] - side[1], mid[2]], shade(col, 0.85));
            }
            for (let k = 0; k < 3; k++) box(m, px + Math.cos(k * 2.1) * 0.22, y + Math.sin(k * 2.1) * 0.22, pz - 0.35, 0.22, 0.22, 0.22, [0.42, 0.3, 0.16]);
        }
        if (hash(i * 9.1) < 0.5) {
            const x = -9.5 - hash(i * 4.2) * 4, y = i * 9 + hash(i * 6.6) * 7, r = 0.6 + hash(i * 8.8) * 0.8, z = cliffH(x, y);
            const g = hash(i * 1.1) < 0.6 ? [0.2 + hash(i) * 0.1, 0.48 + hash(i * 2) * 0.12, 0.18] : [0.5, 0.48, 0.45];
            for (let k = 0; k < 6; k++) {
                const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
                m.tri([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z], [x, y, z + r * 1.2], k % 2 ? g : shade(g, 0.85));
            }
        }
    }
    // distant islands in the sea
    for (let i = Math.floor(ya / 160); i * 160 < yb + 400; i++) {
        if (hash(i * 2.2) < 0.5) continue;
        const cx = 140 + hash(i * 3.3) * 260, cy = i * 160 + hash(i * 4.4) * 80, r = 18 + hash(i * 5.5) * 30, h = 8 + hash(i * 6.6) * 22;
        for (let k = 0; k < 8; k++) {
            const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2;
            m.tri([cx + Math.cos(a0) * r, cy + Math.sin(a0) * r * 0.6, -0.6], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r * 0.6, -0.6], [cx, cy, h], k % 2 ? [0.32, 0.42, 0.38] : [0.26, 0.36, 0.32]);
        }
    }
    solidCount = m.n;
    for (let i = Math.floor(ya / 60); i * 60 < yb + 500; i++) {
        const cx = (hash(i * 3.1) - 0.3) * 400, cy = i * 60 + 200 + hash(i * 2.7) * 60, cz = 55 + hash(i * 8.1) * 70, n = 4 + Math.floor(hash(i * 5.9) * 4);
        for (let k = 0; k < n; k++) m.sprite(cx + (hash(i * 11 + k) - 0.5) * 40, cy + (hash(i * 17 + k) - 0.5) * 20, cz + (hash(i * 23 + k) - 0.5) * 8, 14 + hash(i * 29 + k) * 16, hash(i + k), hash(i * 2 + k), 0.5 + hash(i * 31 + k) * 0.5, 7);
    }
    cloudCount = m.n - solidCount;
    space.setStatic(m.pos, m.col, m.n);
    chunkY = y0;
}

// ------------------------------------------------------------------ time of day follows the distance

const SKY = {   // top, horizon, sun dir, sun colour, ambient, night, fog
    sunset: [[0.16, 0.24, 0.55], [1.0, 0.6, 0.36], [0.42, 1, 0.07], [1.0, 0.62, 0.32], [0.52, 0.44, 0.5], 0.08, 0.0026],
    dusk: [[0.06, 0.06, 0.2], [0.58, 0.3, 0.42], [0.5, 1, -0.03], [0.95, 0.42, 0.32], [0.3, 0.28, 0.42], 0.6, 0.003],
    night: [[0.01, 0.015, 0.06], [0.06, 0.08, 0.2], [-0.3, 1, 0.35], [0.42, 0.5, 0.78], [0.17, 0.19, 0.32], 1, 0.0034],
    dawn: [[0.26, 0.36, 0.72], [1.0, 0.74, 0.6], [-0.4, 1, 0.06], [1.0, 0.7, 0.5], [0.56, 0.5, 0.56], 0.2, 0.0028],
    day: [[0.12, 0.4, 0.92], [0.62, 0.82, 1.0], [0.3, 1, 0.5], [1.0, 0.95, 0.86], [0.56, 0.62, 0.76], 0, 0.0022],
};
const CYCLE = [[0, "sunset"], [900, "sunset"], [1700, "dusk"], [2500, "night"], [3700, "night"], [4500, "dawn"], [5300, "day"], [6500, "day"], [7300, "sunset"]];
function skyAt(d) {
    d %= 7300;
    let i = 0;
    while (i < CYCLE.length - 2 && d > CYCLE[i + 1][0]) i++;
    const [f0, n0] = CYCLE[i], [f1, n1] = CYCLE[i + 1];
    const t = clamp((d - f0) / (f1 - f0), 0, 1), e = t * t * (3 - 2 * t), A = SKY[n0], B = SKY[n1];
    return { top: lerp3(A[0], B[0], e), hor: lerp3(A[1], B[1], e), sun: lerp3(A[2], B[2], e), sunCol: lerp3(A[3], B[3], e), amb: lerp3(A[4], B[4], e), night: lerp(A[5], B[5], e), fog: lerp(A[6], B[6], e) };
}

// ------------------------------------------------------------------ game state

const save = (() => { try { return Object.assign({ best: 0 }, JSON.parse(localStorage.getItem("classicrace3d.save")) || {}); } catch { return { best: 0 }; } })();
const persist = () => { try { localStorage.setItem("classicrace3d.save", JSON.stringify(save)); } catch { } };

let state = "title";                 // title | count | play | paused | crash | over
const car = { x: 1.75, y: 0, vx: 0, v: 0, yaw: 0, roll: 0, spin: 0 };
let traffic = [], sparks = [], smoke = [], pops = [];
let dist = 0, offset = 0, bonus = 0, nearChain = 0, nextSpawnY = 0, time = 0, crashT = 0, shake = 0, flash = 0, scrapeT = 0;
let steerKeys = 0, dragX = null, padDir = 0, newBest = false, cam = { x: 0, y: -10, z: 4, tx: 0, ty: 12 }, lastMilestone = 0;
const score = () => Math.floor(dist + bonus);

function reset(demo) {
    car.x = 1.75; car.y = 0; car.vx = 0; car.v = demo ? V0 : 0; car.yaw = 0; car.roll = 0; car.spin = 0;
    traffic = []; sparks = []; smoke = []; pops.length = 0;
    dist = 0; offset = 0; bonus = 0; nearChain = 0; nextSpawnY = demo ? 60 : 120; crashT = 0; newBest = false; lastMilestone = 0;
    cam = { x: car.x * 0.6, y: car.y - 10, z: 4, tx: car.x * 0.8, ty: car.y + 14 };
    chunkY = -1e9;
    ui.hud();
}
function spawnRow() {
    // one or two cars at this distance, never blocking every lane, keeping clear of nearby cars in the same lane
    const used = new Set();
    const n = Math.random() < Math.min(0.55, 0.15 + dist / 6000) ? 2 : 1;
    for (let k = 0; k < n; k++) {
        let lane, tries = 0;
        const early = dist < 150 && state !== "title";
        do { lane = early ? 2 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4); tries++; } while ((used.has(lane) || traffic.some((t) => t.lane === lane && Math.abs(t.y - nextSpawnY) < 22)) && tries < 10);
        if (tries >= 10) continue;
        used.add(lane);
        const oncoming = lane < 2;
        traffic.push({ lane, x: LANES[lane] + (Math.random() - 0.5) * 0.4, y: nextSpawnY, v: oncoming ? -(15 + Math.random() * 6) : 11 + Math.random() * 6, paint: PAINTS[Math.floor(Math.random() * PAINTS.length)], passed: false });
    }
    const gap = Math.max(13, 34 - dist / 140) * (0.75 + Math.random() * 0.5);
    nextSpawnY += gap;
}
function start() {
    audio.init();
    reset(false);
    state = "count";
    ui.show("hud");
    countdown();
}
async function countdown() {
    for (const t of ["3", "2", "1", "GO!"]) {
        ui.count(t); audio.beep(t === "GO!");
        await new Promise((r) => setTimeout(r, t === "GO!" ? 450 : 700));
        if (state !== "count") return;
    }
    state = "play";
}
function crash(other) {
    if (state !== "play") return;
    state = "crash"; crashT = 0;
    car.spin = (car.x < (other ? other.x : 0) ? -1 : 1) * (5 + Math.random() * 3);
    shake = 1; flash = 0.55;
    audio.crash();
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate([60, 40, 90]); } catch { }
    for (let i = 0; i < 46; i++) { const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 8; sparks.push({ x: car.x, y: car.y + 2, z: 0.7, vx: Math.cos(a) * s, vy: Math.sin(a) * s + car.v * 0.3, vz: 2 + Math.random() * 5, life: 0.5 + Math.random() * 0.6, col: [1.6, 1.0 + Math.random() * 0.4, 0.35] }); }
    for (let i = 0; i < 14; i++) smoke.push({ x: car.x + (Math.random() - 0.5), y: car.y + (Math.random() - 0.5) * 3, z: 0.6, vz: 0.8 + Math.random(), life: 1.4 + Math.random(), s: 0.8 + Math.random() });
    if (other) { other.v *= 0.2; other.spin = (Math.random() - 0.5) * 6; }
    const s = score();
    newBest = s > save.best;
    if (newBest) { save.best = s; persist(); }
}

// ------------------------------------------------------------------ the demo driver (title screen and ?autoplay)

function autopilot() {
    let bestLane = 0, bestClear = -1;
    for (let l = 0; l < 4; l++) {
        let clear = 300;
        for (const t of traffic) {
            if (Math.abs(t.x - LANES[l]) > 1.9) continue;
            const rel = t.y - car.y, closing = car.v - t.v;
            if (rel < -3) continue;
            const tHit = closing > 0 ? rel / closing : 99;
            clear = Math.min(clear, tHit * 30 + rel * 0.2);
        }
        clear -= Math.abs(LANES[l] - car.x) * 2.2;
        if (clear > bestClear) { bestClear = clear; bestLane = l; }
    }
    const dx = LANES[bestLane] - car.x;
    return Math.abs(dx) < 0.25 ? 0 : Math.sign(dx);
}

// ------------------------------------------------------------------ simulation

function update(dt) {
    time += dt;
    if (state === "paused") return;
    const playing = state === "play";
    const demo = state === "title" || AUTO;
    if (state === "play" || state === "title") car.v = Math.min(VMAX, (car.v || V0 * 0.6) + VRAMP * dt * (state === "title" ? 0 : 1) + (car.v < V0 ? 22 * dt : 0));
    if (state === "count") car.v = Math.max(0, car.v);
    if (state === "crash" || state === "over") car.v *= Math.exp(-dt * 2.2);
    // steering
    let dir = demo && state !== "crash" && state !== "over" ? autopilot() : steerKeys + padDir;
    if (!demo && dragX !== null && (playing || state === "count")) {
        const want = clamp(car.x + dragX, -X_MAX, X_MAX); dragX = null;
        const dx = want - car.x; car.x = want; car.vx = dx / Math.max(dt, 1 / 120) * 0.25;
        dir = 0;
    } else if (state === "play" || state === "title") {
        const target = clamp(dir, -1, 1) * STEER_V * (0.85 + car.v / VMAX * 0.3);
        car.vx += clamp(target - car.vx, -STEER_A * dt, STEER_A * dt);
        car.x += car.vx * dt;
    }
    if (Math.abs(car.x) > X_MAX) {                                     // scraping the guard rail
        car.x = Math.sign(car.x) * X_MAX; car.vx = 0;
        if (playing) { scrapeT += dt; car.v *= Math.exp(-dt * 0.6); if (Math.random() < 0.6) sparks.push({ x: car.x + Math.sign(car.x) * 1, y: car.y + (Math.random() - 0.5) * 3, z: 0.6, vx: -Math.sign(car.x) * 2, vy: -car.v * 0.2, vz: 2 + Math.random() * 2, life: 0.4, col: [1.6, 1.1, 0.4] }); }
    }
    car.y += car.v * dt;
    car.yaw = state === "crash" || state === "over" ? car.yaw + car.spin * dt : lerp(car.yaw, -car.vx * 0.04, Math.min(1, dt * 10));
    car.spin *= Math.exp(-dt * 1.5);
    car.roll = lerp(car.roll, car.vx * 0.018, Math.min(1, dt * 8));
    if (playing || state === "crash") { dist += car.v * dt * (playing ? 1 : 0); }
    // traffic
    while (nextSpawnY < car.y + 230) spawnRow();
    for (const t of traffic) {
        t.y += t.v * dt;
        if (t.spin) { t.yaw = (t.yaw || 0) + t.spin * dt; t.spin *= Math.exp(-dt); }
        const rel = t.y - car.y;
        if (playing) {
            if (Math.abs(t.x - car.x) < CAR_W - 0.2 && Math.abs(rel) < CAR_L - 0.35) { crash(t); break; }
            if (!t.passed && rel < -CAR_L * 0.5) {
                t.passed = true;
                const gap = Math.abs(t.x - car.x);
                audio.whoosh(gap < 3 ? 1 : 0.4);
                if (gap < 2.75) { nearChain++; const b = 25 * Math.min(nearChain, 5); bonus += b; audio.nearMiss(nearChain); ui.pop(nearChain > 1 ? `NEAR MISS ×${nearChain}  +${b}` : `NEAR MISS  +${b}`); }
                else nearChain = 0;
            }
        }
    }
    traffic = traffic.filter((t) => t.y > car.y - 40 && t.y < car.y + 400);
    if (state === "crash") { crashT += dt; if (crashT > 1.4) { state = "over"; ui.over(); } }
    if (playing) {
        const m = Math.floor(dist / 1000);
        if (m > lastMilestone) { lastMilestone = m; audio.milestone(); ui.banner(`${m * 1000} m`); }
    }
    // effects
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 12 * dt; if (s.z < 0.05) { s.z = 0.05; s.vz *= -0.4; } s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    for (const s of smoke) { s.z += s.vz * dt; s.s += dt * 0.8; s.life -= dt; }
    smoke = smoke.filter((s) => s.life > 0);
    shake *= Math.exp(-dt * 4); flash = Math.max(0, flash - dt * 2);
    // keep numbers small: shift the whole world back now and then
    if (car.y > SHIFT) {
        car.y -= SHIFT; nextSpawnY -= SHIFT; offset += SHIFT; cam.y -= SHIFT; cam.ty -= SHIFT;
        for (const t of traffic) t.y -= SHIFT;
        for (const s of sparks) s.y -= SHIFT;
        for (const s of smoke) s.y -= SHIFT;
        chunkY -= SHIFT;
    }
    audio.engine(state === "play" || state === "count" || state === "crash", clamp(car.v / VMAX, 0, 1), car.vx / STEER_V);
    ui.hud();
}

// ------------------------------------------------------------------ per-frame geometry

const solid = new Mesh(80000), alpha = new Mesh(4000), glow = new Mesh(16000);
function drawCar(c, paint, wing, night, yaw, roll, player) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    const T = (p) => { const x = p[0] * cr - (p[2] - 0.6) * sr, z = p[0] * sr + (p[2] - 0.6) * cr + 0.6; return [c.x + x * cy - p[1] * sy, c.y + x * sy + p[1] * cy, z]; };
    const glass = [0.05, 0.07, 0.1], dark = [0.06, 0.06, 0.07], tyre = [0.04, 0.04, 0.045], rim = [0.55, 0.57, 0.6], chrome = [0.8, 0.82, 0.85];
    const head = [1.4 + night * 1.5, 1.35 + night * 1.4, 1.1 + night], tail = [0.9 + night * 2.2, 0.08, 0.06];
    const slot = { paint: [paint, 1], dark: [dark, 1], glass: [glass, 1], tyre: [tyre, 0], rim: [rim, 1], chrome: [chrome, 1], head: [head, 2], tail: [tail, 2] };
    for (const [a, b, d, s] of CAR) { const [col, mat] = slot[s]; solid.tri(T(a), T(b), T(d), col, mat); }
    if (wing) for (const [a, b, d, s] of WING) { const [col, mat] = slot[s]; solid.tri(T(a), T(b), T(d), col, mat); }
    alpha.sprite(c.x, c.y, 0.02, 2.3, 0.5, 0, 0, 8);
    // lamp glows: headlights in front, tail lights behind (stronger after dark)
    const L = CAR_L / 2, k = 0.25 + night * 0.9;
    for (const s of [-1, 1]) {
        const h = T([s * 0.62, L + 0.1, 0.72]), t = T([s * 0.7, -L - 0.1, 0.78]);
        glow.sprite(h[0], h[1], h[2], 0.55 + night * 0.5, 1.0 * k, 0.95 * k, 0.8 * k);
        glow.sprite(t[0], t[1], t[2], 0.45 + night * 0.35, 1.0 * k, 0.1 * k, 0.06 * k);
    }
    if (player && night > 0.3) { const f = T([0, L + 9, 0.05]); glow.sprite(f[0], f[1], 0.1, 5.5, 0.22 * night, 0.2 * night, 0.15 * night); }
}
function buildDynamic(S) {
    solid.reset(); alpha.reset(); glow.reset();
    for (const t of traffic) {
        if (t.y < cam.y - 5 || t.y > cam.y + 330) continue;
        drawCar(t, t.paint, false, S.night, (t.v < 0 ? Math.PI : 0) + (t.yaw || 0), 0, false);
    }
    drawCar(car, [0.85, 0.06, 0.08], true, S.night, car.yaw, car.roll, true);
    // street-lamp glows at night (every 40 m)
    if (S.night > 0.05) for (let y = Math.ceil((cam.y - 10) / 40) * 40; y < cam.y + 260; y += 40) {
        const k = S.night;
        glow.sprite(6.9, y, 6.3, 1.4, 1.0 * k, 0.75 * k, 0.45 * k);
        glow.sprite(6.0, y, 0.15, 6.5, 0.16 * k, 0.12 * k, 0.07 * k);
    }
    for (const s of sparks) { const k = Math.min(1, s.life * 2.5); glow.sprite(s.x, s.y, s.z, 0.1, s.col[0] * k, s.col[1] * k, s.col[2] * k); }
    for (const s of smoke) { const k = Math.min(1, s.life) * 0.12; glow.sprite(s.x, s.y, s.z, s.s, k, k, k); }
    // speed streaks along the road edges when going fast
    const sp = clamp((car.v - 36) / (VMAX - 36), 0, 1);
    if (sp > 0 && state === "play") for (let i = 0; i < 14; i++) {
        const y = car.y + ((time * car.v * 1.3 + i * 23) % 120) - 10, x = (i % 2 ? 1 : -1) * (7.4 + (i % 3) * 0.3);
        glow.sprite(x, y, 0.4 + (i % 4) * 0.5, 0.18, 0.5 * sp, 0.5 * sp, 0.55 * sp);
    }
    const sN = solid.n, aN = alpha.n;
    solid.append(alpha); solid.append(glow);
    space.setDynamic(solid.pos, solid.col, solid.n);
    return { sN, aN, gN: glow.n };
}

// ------------------------------------------------------------------ chase camera and render

function render(dt) {
    const aspect = canvas.width / canvas.height;
    if (car.y - chunkY > 240 || car.y < chunkY) buildStatic(car.y);
    const sp = clamp(car.v / VMAX, 0, 1);
    const k = 1 - Math.exp(-dt * 6);
    const tall = aspect < 0.8;
    const back = (tall ? 9.5 : 11) - sp * 1.5, height = (tall ? 4.6 : 4.4) - sp * 0.4;
    cam.x = lerp(cam.x, car.x * 0.72, k); cam.y = car.y - back; cam.z = lerp(cam.z, height, k);
    cam.tx = lerp(cam.tx, car.x * 0.85 + car.vx * 0.12, k); cam.ty = car.y + (tall ? 13 : 16);
    const s = shake * (reducedMotion ? 0.15 : 0.5), jx = (Math.random() - 0.5) * s, jz = (Math.random() - 0.5) * s;
    space.lookAt(cam.x + jx, cam.y, cam.z + jz, cam.tx + jx, cam.ty, 0.9 + jz);
    space.magnifier = (aspect < 0.8 ? 2.4 : aspect < 1.2 ? 1.5 : 1.7) / (1 + sp * 0.22);
    const S = skyAt(dist);
    const { sN, aN, gN } = buildDynamic(S);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uTop, S.top); gl.uniform3fv(U.uHor, S.hor);
    gl.uniform3fv(U.uSunDir, S.sun); gl.uniform3fv(U.uSunCol, S.sunCol); gl.uniform3fv(U.uAmb, S.amb);
    gl.uniform1f(U.uNight, S.night); gl.uniform1f(U.uFog, S.fog);
    gl.uniform1f(U.uFlash, reducedMotion ? flash * 0.3 : flash);
    gl.uniform1f(U.uOrigin, 0);
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
let shownKmh = -1, shownScore = -1;
const ui = {
    shown: "title",
    show(which) { this.shown = which; for (const id of ["title", "paused", "over"]) $(id).classList.toggle("hidden", id !== which); document.body.dataset.state = which; },
    hud() {
        const kmh = Math.round(car.v * 4);
        if (kmh !== shownKmh) { shownKmh = kmh; $("kmh").textContent = kmh; $("needle").style.transform = `rotate(${-120 + clamp(car.v / VMAX, 0, 1) * 240}deg)`; }
        const s = score();
        if (s !== shownScore) { shownScore = s; $("score").textContent = s.toLocaleString(); }
        $("best").textContent = Math.max(save.best, state === "play" ? s : 0).toLocaleString();
    },
    pop(t) { const el = $("pop"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show"; },
    banner(t) { const el = $("banner"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show"; },
    count(t) { const el = $("count"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show"; },
    over() {
        this.show("over");
        $("o-score").textContent = score().toLocaleString();
        $("o-dist").textContent = Math.floor(dist).toLocaleString() + " m";
        $("o-bonus").textContent = "+" + bonus.toLocaleString();
        $("o-best").textContent = save.best.toLocaleString();
        $("o-new").classList.toggle("hidden", !newBest);
        $("again").classList.remove("arm"); void $("again").offsetWidth; $("again").classList.add("arm");
    },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1300); },
    mute() { $("mute").setAttribute("aria-pressed", audio.muted); },
};
$("t-best").textContent = save.best.toLocaleString();
ui.mute();

// ------------------------------------------------------------------ input

let overAt = 0;
const goOrRestart = () => { if (ui.shown === "title") start(); else if (state === "over" && performance.now() - overAt > 700) start(); else if (state === "paused") resume(); };
function pause() { if (state !== "play" && state !== "count") return; state = "paused"; ui.show("paused"); }
function resume() { if (state !== "paused") return; state = "play"; ui.show("hud"); }
const keys = new Set();
const keySteer = () => (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { audio.init(); ui.toast(audio.toggleMute() ? "Sound off" : "Sound on"); ui.mute(); return; }
    if (e.code === "KeyP" || e.code === "Escape") { if (state === "play") pause(); else if (state === "paused") resume(); return; }
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(e.code)) { e.preventDefault(); keys.add(e.code); steerKeys = keySteer(); return; }
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); goOrRestart(); }
});
addEventListener("keyup", (e) => { keys.delete(e.code); steerKeys = keySteer(); });
addEventListener("blur", () => { keys.clear(); steerKeys = 0; padDir = 0; pause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
// drag anywhere: the car follows the finger sideways
let drag = null;
const interactive = (t) => t instanceof Element && t.closest("button, a, .pad");
addEventListener("pointerdown", (e) => { if (interactive(e.target) || ui.shown !== "hud") return; e.preventDefault(); audio.init(); drag = { id: e.pointerId, x: e.clientX }; }, { passive: false });
addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x; drag.x = e.clientX;
    dragX = (dragX || 0) + dx * (16 / Math.min(innerWidth, 900));
});
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointercancel", () => { drag = null; });
for (const b of document.querySelectorAll(".pad")) {
    const d = +b.dataset.dir;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.init(); padDir = d; b.classList.add("on"); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { if (padDir === d) padDir = 0; b.classList.remove("on"); });
}
$("play").addEventListener("click", () => start());
$("again").addEventListener("click", () => goOrRestart());
$("resume").addEventListener("click", () => { audio.init(); resume(); });
$("restart").addEventListener("click", () => start());
$("pause").addEventListener("click", () => { audio.init(); audio.ui(); state === "paused" ? resume() : pause(); });
$("mute").addEventListener("click", () => { audio.init(); audio.toggleMute(); ui.mute(); });
$("share").addEventListener("click", async () => {
    audio.init(); audio.ui();
    const url = location.origin + location.pathname, text = `I drove ${score().toLocaleString()} points down the coast in Classic Race 3D! Can you beat it?`;
    try { if (navigator.share) await navigator.share({ title: "Classic Race 3D", text, url }); else { await navigator.clipboard.writeText(`${text} ${url}`); ui.toast("Link copied"); } } catch { }
});
const origOver = ui.over.bind(ui);
ui.over = () => { overAt = performance.now(); origOver(); };

// ------------------------------------------------------------------ loop

reset(true);
if (AUTO) { state = "play"; car.v = V0; ui.show("hud"); } else ui.show("title");
window.__race3d = () => ({ state, score: score(), dist: Math.floor(dist), x: +car.x.toFixed(2), v: +car.v.toFixed(1), traffic: traffic.length });
let last = performance.now();
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    update(dt);
    if (AUTO && state === "over" && performance.now() - overAt > 1500) { reset(false); state = "play"; car.v = V0; ui.show("hud"); }
    render(dt);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
