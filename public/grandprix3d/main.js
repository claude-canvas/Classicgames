// GRAND PRIX 3D — a Formula-style race on a 2.2 km circuit, rendered with the projection3d library (Space).
//
// ↑/W throttle, ↓/S brake (and reverse), ←→/A D steer, Space handbrake. Brake hard while turning (or pull the
// handbrake) and the rear steps out into a drift: hold the angle with throttle and steering, counter-steer to catch it.
// Five rivals follow the racing line with their own pace; start from the back of the grid when the five red lights go
// out, and fight your way to the front over 1, 3 or 5 laps. Day, sunset or a floodlit night race.
//
// World: x east, y north, z up, metres. The circuit (road, kerbs, gravel, barriers, tyre walls, grandstands, pit
// building, start gantry, bridge, floodlights, trees, lake, hills, clouds) is built once into Space's buffers; cars,
// shadows, skid marks, smoke and glows are rebuilt every frame into GameSpace's dynamic buffers.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Audio } from "./audio.js";
import { buildTrack, locate, pointAt, STEP, HALF, KERB, WALL, VMAX, latGrip } from "./track.js";
import { BODY, WHEELS, wheel } from "./car.js";

const params = new URLSearchParams(location.search);
const AUTO = params.has("autoplay");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fmt = (t) => { if (t == null || !isFinite(t)) return "–:––.–––"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`; };

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
    // explicit quad that knows its corners (shadows, skid marks)
    uvquad(a, b, c, d, col, mat) { const P = [a, b, c, d]; for (const k of [0, 1, 2, 0, 2, 3]) this.v(P[k][0], P[k][1], P[k][2], 1 + k * 100, col[0], col[1], col[2], mat); }
    sprite(x, y, z, size, r, g, b, mat = 5) { for (const k of [0, 1, 2, 0, 2, 3]) this.v(x, y, z, size + k * 100, r, g, b, mat); }
    append(o) {
        while ((this.n + o.n) * 4 > this.pos.length) this.grow();
        this.pos.set(o.pos.subarray(0, o.n * 4), this.n * 4); this.col.set(o.col.subarray(0, o.n * 4), this.n * 4);
        this.n += o.n;
    }
}
function box(m, x, y, z0, sx, sy, h, col, mat = 0) {
    const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z1 = z0 + h, d = shade(col, 0.82);
    m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], d, mat);
    m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], d, mat);
    m.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], d, mat);
    m.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], d, mat);
}
// a box centred at (x, y) whose sides follow the unit vector (ax, ay)
function obox(m, x, y, z0, ax, ay, ha, hw, h, col, mat = 0) {
    const bx = -ay, by = ax, C = (i, j, z) => [x + ax * ha * i + bx * hw * j, y + ay * ha * i + by * hw * j, z], z1 = z0 + h, d = shade(col, 0.82);
    m.quad(C(-1, -1, z1), C(1, -1, z1), C(1, 1, z1), C(-1, 1, z1), col, mat);
    m.quad(C(-1, -1, z0), C(1, -1, z0), C(1, -1, z1), C(-1, -1, z1), d, mat);
    m.quad(C(1, -1, z0), C(1, 1, z0), C(1, 1, z1), C(1, -1, z1), d, mat);
    m.quad(C(1, 1, z0), C(-1, 1, z0), C(-1, 1, z1), C(1, 1, z1), d, mat);
    m.quad(C(-1, 1, z0), C(-1, -1, z0), C(-1, -1, z1), C(-1, 1, z1), d, mat);
}
function cylinder(m, x, y, z0, z1, r, seg, col, mat = 0, cap = false) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        m.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z1], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z1], i % 2 ? col : shade(col, 0.9), mat);
        if (cap) m.tri([x, y, z1], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z1], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z1], shade(col, 1.1), mat);
    }
}
function cone(m, x, y, z0, z1, r, seg, col, mat = 0) {
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        m.tri([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [x, y, z1], i % 2 ? col : shade(col, 0.86), mat);
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

// ------------------------------------------------------------------ the circuit

const TR = buildTrack();
const N = TR.N, L = TR.L;
const I = (i) => ((i % N) + N) % N;
const P = (i, u, z) => { i = I(i); return [TR.px[i] + TR.nx[i] * u, TR.py[i] + TR.ny[i] * u, z]; };
const inRange = (i, a, b) => { i = I(i); a = I(a); b = I(b); return a <= b ? i >= a && i <= b : i >= a || i <= b; };
const dilate = (f, r) => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) if (f[i]) for (let j = -r; j <= r; j++) o[I(i + j)] = 1; return o; };
const KERBS = dilate(Uint8Array.from({ length: N }, (_, i) => Math.abs(TR.ks[i]) > 1 / 170), 5);
const outside = (i, lim, r) => [1, -1].map((sg) => dilate(Uint8Array.from({ length: N }, (_, j) => Math.abs(TR.ks[j]) > lim && -Math.sign(TR.ks[j]) === sg), r));
const [GRAVEL_L, GRAVEL_R] = outside(0, 1 / 110, 10);
const [TYRES_L, TYRES_R] = outside(0, 1 / 65, 6);
const argmaxK = (a, b) => { let best = a, bk = 0; for (let i = a; i <= b; i++) if (Math.abs(TR.ks[I(i)]) > bk) { bk = Math.abs(TR.ks[I(i)]); best = I(i); } return best; };
const C_HAIR = argmaxK(0, N - 1), C_T1 = argmaxK(110, 260);
const STANDS = [
    { a: N - 75, b: 65, sg: 1, u0: WALL + 5, rows: 10, seat: [0.18, 0.24, 0.5], roof: true },
    { a: C_T1 - 24, b: C_T1 + 24, sg: -Math.sign(TR.ks[C_T1]), u0: WALL + 6, rows: 8, seat: [0.14, 0.38, 0.3], roof: true },
    { a: C_HAIR - 26, b: C_HAIR + 26, sg: -Math.sign(TR.ks[C_HAIR]), u0: WALL + 6, rows: 7, seat: [0.5, 0.14, 0.14], roof: false },
];
const PITS = { a: N - 70, b: 70 };
const LAMPS = [];        // floodlight heads (for the night glows)
const LIGHTS = [];       // the five start lights
const ADS = [[0.1, 0.3, 0.85], [0.9, 0.14, 0.1], [0.98, 0.78, 0.1], [0.08, 0.55, 0.32], [0.94, 0.94, 0.96], [0.12, 0.12, 0.15], [0.95, 0.42, 0.08]];

const stat = new Mesh(400000);
let solidCount = 0, cloudCount = 0;
function buildScene() {
    const m = stat; m.reset();
    m.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], 3);
    // ground
    for (let x = -1600; x < 2000; x += 200) for (let y = -1800; y < 1900; y += 200) m.quad([x, y, -0.2], [x + 200, y, -0.2], [x + 200, y + 200, -0.2], [x, y + 200, -0.2], [0, 0, 0], 10);
    // road, verges, kerbs, gravel, barriers with advertising, tyre walls
    for (let i = 0; i < N; i++) {
        const j = i + 1, s0 = i * TR.step, s1 = j * TR.step;
        const a = P(i, HALF, 0), b = P(i, -HALF, 0), c = P(j, -HALF, 0), d = P(j, HALF, 0);
        m.v(...a, 1, HALF, s0, 0, 6); m.v(...b, 1, -HALF, s0, 0, 6); m.v(...c, 1, -HALF, s1, 0, 6);
        m.v(...a, 1, HALF, s0, 0, 6); m.v(...c, 1, -HALF, s1, 0, 6); m.v(...d, 1, HALF, s1, 0, 6);
        for (const sg of [1, -1]) {
            const Q = (u0, z0, u1, z1, col, mat = 0) => sg > 0 ? m.quad(P(i, u0 * sg, z0), P(i, u1 * sg, z1), P(j, u1 * sg, z1), P(j, u0 * sg, z0), col, mat) : m.quad(P(i, u0 * sg, z0), P(j, u0 * sg, z0), P(j, u1 * sg, z1), P(i, u1 * sg, z1), col, mat);
            if (KERBS[i]) {
                const red = i % 2 === 0, col = red ? [0.86, 0.1, 0.1] : [0.95, 0.95, 0.95];
                Q(HALF, 0.0, HALF + KERB, 0.07, col);
                Q(HALF + KERB, 0.07, HALF + KERB + 0.6, -0.2, [0.3, 0.5, 0.2], 10);
            } else Q(HALF, 0, HALF + 1.6, -0.2, [0.3, 0.5, 0.2], 10);
            const grav = sg > 0 ? GRAVEL_L[i] : GRAVEL_R[i];
            if (grav) Q(HALF + 3.0, -0.12, WALL - 0.15, -0.12, [0, 0, 0], 14);
            // barrier: concrete wall with an advertising board on the track side
            const W0 = WALL, W1 = WALL + 0.5, ad = ADS[Math.floor(i / 6) % ADS.length], logo = i % 6 === 2 || i % 6 === 3;
            Q(W0, -0.2, W0, 1.05, [0.78, 0.78, 0.76]);
            Q(W0, 1.05, W1, 1.05, [0.86, 0.86, 0.84]);
            Q(W1, 1.05, W1, -0.2, [0.7, 0.7, 0.68]);
            Q(W0 - 0.03, 0.22, W0 - 0.03, 0.98, ad);
            if (logo) Q(W0 - 0.05, 0.45, W0 - 0.05, 0.75, ad[0] + ad[1] + ad[2] > 2.4 ? [0.85, 0.1, 0.1] : [0.97, 0.97, 0.97]);
            // tyre walls with a conveyor-belt cover on the outside of slow corners
            const tyres = sg > 0 ? TYRES_L[i] : TYRES_R[i];
            if (tyres) {
                Q(W0 - 1.0, -0.2, W0 - 1.0, 0.8, Math.floor(i / 2) % 2 ? [0.1, 0.28, 0.85] : [0.94, 0.94, 0.95]);
                Q(W0 - 1.0, 0.8, W0 - 0.1, 0.8, [0.08, 0.08, 0.09]);
                for (let k = 0; k < 3; k++) { const q2 = lerp3p(P(i, (W0 - 0.5) * sg, 0), P(j, (W0 - 0.5) * sg, 0), k / 3); cylinder(m, q2[0], q2[1], 0.8, 1.02, 0.3, 6, [0.07, 0.07, 0.08], 0, true); }
            }
        }
    }
    // pit lane and pit building on the right of the main straight
    for (let k = 0; k <= I(PITS.b - PITS.a); k += 2) {
        const i = PITS.a + k, j = i + 2, sg = -1, Q = (u0, z0, u1, z1, col, mat = 0) => m.quad(P(i, u0 * sg, z0), P(j, u0 * sg, z0), P(j, u1 * sg, z1), P(i, u1 * sg, z1), col, mat);
        Q(WALL + 0.5, -0.08, WALL + 6, -0.08, [0.17, 0.17, 0.19]);
        Q(WALL + 1.3, -0.07, WALL + 1.45, -0.07, [0.9, 0.9, 0.9]);
        const u = WALL + 6, garage = k % 8 !== 0, team = ADS[Math.floor(k / 10) % ADS.length];
        Q(u, -0.2, u, 4.2, garage ? [0.05, 0.05, 0.06] : [0.86, 0.86, 0.88]);
        if (garage) Q(u - 0.02, 3.6, u - 0.02, 4.2, team);
        Q(u, 4.2, u, 7.2, [0.12, 0.18, 0.26], 1);
        Q(u, 7.2, u, 8.4, team);
        Q(u, 8.4, u + 14, 8.4, [0.62, 0.62, 0.65]);
        Q(u + 14, 8.4, u + 14, -0.2, [0.7, 0.7, 0.72]);
    }
    // grandstands packed with fans
    for (const st of STANDS) {
        const { a, b, sg, u0, rows, seat, roof } = st, cnt = I(b - a), top = rows * 0.8 + 0.4, uEnd = u0 + rows * 1.9;
        for (let k = 0; k < cnt; k += 2) {
            const i = a + k, j = a + Math.min(k + 2, cnt);
            const Q = (u0_, z0, u1, z1, col, mat = 0) => sg > 0 ? m.quad(P(i, u0_ * sg, z0), P(i, u1 * sg, z1), P(j, u1 * sg, z1), P(j, u0_ * sg, z0), col, mat) : m.quad(P(i, u0_ * sg, z0), P(j, u0_ * sg, z0), P(j, u1 * sg, z1), P(i, u1 * sg, z1), col, mat);
            Q(u0 - 0.3, -0.2, u0 - 0.3, 1.5, [0.85, 0.85, 0.87]);
            Q(u0 - 0.3, 1.5, u0, 1.5, ADS[Math.floor(k / 8) % ADS.length]);
            for (let r = 0; r < rows; r++) {
                const uA = u0 + r * 1.9, uB = uA + 1.9, z = r * 0.8 + 0.4;
                Q(uA, z, uA, z + 0.8, seat, 12);
                Q(uA, z + 0.8, uB, z + 0.8, shade(seat, 0.8), 12);
            }
            Q(uEnd, top + 0.4, uEnd, top + 3.0, [0.75, 0.75, 0.78]);
            Q(uEnd, top + 3.0, uEnd + 0.4, top + 3.0, [0.75, 0.75, 0.78]);
            Q(uEnd + 0.4, top + 3.0, uEnd + 0.4, -0.2, [0.66, 0.66, 0.7]);
            if (roof) {
                Q(uEnd + 0.4, top + 5.2, u0 + 1.0, top + 6.6, [0.93, 0.93, 0.95]);
                if (k % 8 === 0) { const p = P(i, (uEnd + 0.2) * sg, 0); cylinder(m, p[0], p[1], top + 3.0, top + 5.3, 0.22, 6, [0.5, 0.5, 0.55]); }
            }
        }
        for (const i of [a, b]) for (let r = 0; r < rows; r++) {           // side walls
            const uA = u0 + r * 1.9, uB = uA + 1.9, z = r * 0.8 + 1.2;
            m.quad(P(i, uA * sg, -0.2), P(i, uB * sg, -0.2), P(i, uB * sg, z), P(i, uA * sg, z), [0.72, 0.72, 0.75]);
        }
    }
    // floodlights along the left side (they light the track at night)
    for (let i = 10; i < N; i += 20) {
        if (STANDS.some((st) => st.sg > 0 && inRange(i, st.a - 4, st.b + 4))) continue;
        const sg = 1, base = P(i, (WALL + 2.4) * sg, 0), arm = P(i, (WALL - 0.6) * sg, 13.2);
        cylinder(m, base[0], base[1], -0.2, 13.4, 0.18, 6, [0.42, 0.44, 0.48]);
        const n = [TR.nx[i] * sg, TR.ny[i] * sg];
        obox(m, (base[0] + arm[0]) / 2, (base[1] + arm[1]) / 2, 13.2, n[0], n[1], 1.6, 0.12, 0.18, [0.42, 0.44, 0.48]);
        obox(m, arm[0], arm[1], 12.7, n[0], n[1], 0.55, 0.9, 0.5, [0.25, 0.26, 0.3]);
        obox(m, arm[0], arm[1], 12.62, n[0], n[1], 0.45, 0.8, 0.08, [1.0, 0.95, 0.85], 9);
        LAMPS.push([arm[0], arm[1], 12.5, i]);
    }
    // start gantry with the five start lights
    {
        const i = 0, t = [TR.tx[i], TR.ty[i]], n = [TR.nx[i], TR.ny[i]];
        for (const u of [-(HALF + 2.2), HALF + 2.2]) { const p = P(i, u, 0); obox(m, p[0], p[1], -0.2, t[0], t[1], 0.3, 0.3, 7.6, [0.3, 0.32, 0.36]); }
        const c = P(i, 0, 0);
        obox(m, c[0], c[1], 6.6, n[0], n[1], HALF + 2.6, 0.35, 0.9, [0.16, 0.17, 0.2]);
        obox(m, c[0] - t[0] * 0.37, c[1] - t[1] * 0.37, 6.72, n[0], n[1], HALF + 2.3, 0.02, 0.66, [0.85, 0.08, 0.08]);
        for (let k = 0; k < 5; k++) {
            const u = (k - 2) * 1.15, p = P(i, u, 0);
            obox(m, p[0], p[1], 5.5, t[0], t[1], 0.25, 0.42, 1.1, [0.06, 0.06, 0.07]);
            LIGHTS.push([p[0] - t[0] * 0.3, p[1] - t[1] * 0.3, 5.75], [p[0] - t[0] * 0.3, p[1] - t[1] * 0.3, 6.25]);
        }
    }
    // a footbridge over the back section
    {
        let bi = 500, bk = 1;
        for (let i = 420; i < 640; i++) { const k = Math.abs(TR.ks[i]) + Math.abs(TR.ks[I(i + 10)]) + Math.abs(TR.ks[I(i - 10)]); if (k < bk) { bk = k; bi = i; } }
        const t = [TR.tx[bi], TR.ty[bi]], n = [TR.nx[bi], TR.ny[bi]], c = P(bi, 0, 0), span = WALL + 4;
        obox(m, c[0], c[1], 6.2, n[0], n[1], span, 1.6, 0.6, [0.86, 0.86, 0.88]);
        for (const f of [-1, 1]) {
            obox(m, c[0] + t[0] * f * 1.62, c[1] + t[1] * f * 1.62, 6.8, n[0], n[1], WALL - 0.5, 0.04, 1.3, [0.9, 0.12, 0.12]);
            for (let k = -2; k <= 2; k++) { const q = [c[0] + t[0] * f * 1.65 + n[0] * k * 4.6, c[1] + t[1] * f * 1.65 + n[1] * k * 4.6]; obox(m, q[0], q[1], 7.05, n[0], n[1], 1.4, 0.05, 0.8, [0.97, 0.97, 0.97]); }
        }
        for (const u of [-span + 1, span - 1]) for (const f of [-1, 1]) { const p = P(bi, u, 0); obox(m, p[0] + t[0] * f * 1.1, p[1] + t[1] * f * 1.1, -0.2, t[0], t[1], 0.25, 0.25, 6.4, [0.55, 0.56, 0.6]); }
    }
    // the lake in the infield
    const lake = (() => {
        let best = null, bd = 0;
        for (let x = 40; x < 330; x += 10) for (let y = -120; y < 380; y += 10) {
            let d = Infinity; for (let i = 0; i < N; i += 3) d = Math.min(d, Math.hypot(TR.px[i] - x, TR.py[i] - y));
            if (d > bd) { bd = d; best = [x, y]; }
        }
        return { x: best[0], y: best[1], r: Math.min(75, bd - 30) };
    })();
    for (let k = 0; k < 28; k++) {
        const a0 = (k / 28) * Math.PI * 2, a1 = ((k + 1) / 28) * Math.PI * 2;
        const r0 = lake.r * (0.85 + 0.15 * Math.sin(a0 * 3 + 1) + 0.06 * Math.sin(a0 * 7)), r1 = lake.r * (0.85 + 0.15 * Math.sin(a1 * 3 + 1) + 0.06 * Math.sin(a1 * 7));
        const p0 = [lake.x + Math.cos(a0) * r0, lake.y + Math.sin(a0) * r0], p1 = [lake.x + Math.cos(a1) * r1, lake.y + Math.sin(a1) * r1];
        m.tri([lake.x, lake.y, -0.1], [p0[0], p0[1], -0.1], [p1[0], p1[1], -0.1], [0, 0, 0], 4);
        const o0 = [lake.x + Math.cos(a0) * (r0 + 4), lake.y + Math.sin(a0) * (r0 + 4)], o1 = [lake.x + Math.cos(a1) * (r1 + 4), lake.y + Math.sin(a1) * (r1 + 4)];
        m.quad([p0[0], p0[1], -0.09], [p1[0], p1[1], -0.09], [o1[0], o1[1], -0.17], [o0[0], o0[1], -0.17], [0.62, 0.56, 0.42]);
    }
    // trees: pines and round trees everywhere the circuit isn't
    const coarse = []; for (let i = 0; i < N; i += 4) coarse.push([TR.px[i], TR.py[i]]);
    const clear = (x, y, d) => coarse.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > d * d);
    let placed = 0;
    for (let k = 0; k < 6000 && placed < 1700; k++) {
        const clump = Math.floor(k / 6), x = -620 + hash(clump * 1.37) * 1450 + (hash(k * 3.9) - 0.5) * 60, y = -900 + hash(clump * 2.71) * 1880 + (hash(k * 7.7) - 0.5) * 60;
        if (Math.hypot(x - lake.x, y - lake.y) < lake.r + 10) continue;
        if (x > -75 && x < 60 && y > -200 && y < 230) continue;           // grandstand and pits
        if (!clear(x, y, WALL + 14)) continue;
        const near = !clear(x, y, 60);
        if (near && hash(k * 9.3) < 0.55) continue;
        placed++;
        const h = 7 + hash(k * 4.1) * 9, kind = hash(k * 5.3);
        cylinder(m, x, y, -0.2, h * 0.35, 0.28 + h * 0.015, 5, [0.36, 0.25, 0.16]);
        if (kind < 0.55) {
            const g = [0.1 + hash(k) * 0.06, 0.3 + hash(k * 2) * 0.1, 0.14];
            for (let t = 0; t < 3; t++) cone(m, x, y, h * (0.25 + t * 0.22), h * (0.62 + t * 0.2), (3.0 - t * 0.75) * (h / 12), 7, shade(g, 1 + t * 0.08));
        } else {
            const g = [0.2 + hash(k) * 0.12, 0.42 + hash(k * 2) * 0.12, 0.16];
            for (let t = 0; t < 3; t++) {
                const cx = x + (hash(k + t) - 0.5) * 2.4, cy = y + (hash(k * 3 + t) - 0.5) * 2.4, cz = h * (0.55 + t * 0.12), r = h * (0.28 - t * 0.04);
                for (let q = 0; q < 6; q++) {
                    const a0 = (q / 6) * Math.PI * 2, a1 = ((q + 1) / 6) * Math.PI * 2, e0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz], e1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz];
                    m.tri(e0, e1, [cx, cy, cz + r * 0.9], q % 2 ? g : shade(g, 0.88));
                    m.tri(e0, e1, [cx, cy, cz - r * 0.7], shade(g, 0.7));
                }
            }
        }
    }
    // rolling hills around the horizon
    const cx = 170, cy = 40;
    for (const [r0, r1, hh, col] of [[1250, 1500, 150, [0.3, 0.42, 0.33]], [1700, 2000, 320, [0.42, 0.5, 0.6]]]) {
        for (let k = 0; k < 80; k++) {
            const a0 = (k / 80) * Math.PI * 2, a1 = ((k + 1) / 80) * Math.PI * 2;
            const h0 = hh * (0.45 + 0.35 * Math.sin(a0 * 5 + r0) + 0.2 * Math.sin(a0 * 13)), h1 = hh * (0.45 + 0.35 * Math.sin(a1 * 5 + r0) + 0.2 * Math.sin(a1 * 13));
            const k0 = 0.9 + hash(k + r0) * 0.15;
            m.quad([cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, -0.2], [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, -0.2], [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, h1], [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, h0], shade(col, k0));
        }
    }
    solidCount = m.n;
    for (let i = 0; i < 70; i++) {
        const x = cx + (hash(i * 3.1) - 0.5) * 2600, y = cy + (hash(i * 2.7) - 0.5) * 2600, z = 170 + hash(i * 8.1) * 140, n = 4 + Math.floor(hash(i * 5.9) * 4);
        for (let k = 0; k < n; k++) m.sprite(x + (hash(i * 11 + k) - 0.5) * 70, y + (hash(i * 17 + k) - 0.5) * 40, z + (hash(i * 23 + k) - 0.5) * 12, 26 + hash(i * 29 + k) * 26, hash(i + k), hash(i * 2 + k), 0.5 + hash(i * 31 + k) * 0.5, 7);
    }
    cloudCount = m.n - solidCount;
    space.setStatic(m.pos, m.col, m.n);
}
const lerp3p = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
buildScene();

// ------------------------------------------------------------------ sessions (time of day)

const SESSIONS = {   // top, horizon, sun dir, sun colour, ambient, night, fog
    day: [[0.13, 0.36, 0.85], [0.66, 0.8, 0.96], [0.45, -0.55, 0.62], [1.05, 0.98, 0.88], [0.5, 0.58, 0.72], 0, 0.0008],
    sunset: [[0.16, 0.22, 0.5], [1.0, 0.58, 0.36], [-0.3, 1, 0.09], [1.05, 0.62, 0.32], [0.5, 0.42, 0.52], 0.12, 0.0012],
    night: [[0.01, 0.015, 0.05], [0.06, 0.07, 0.16], [0.3, 0.4, 0.6], [0.3, 0.36, 0.52], [0.36, 0.38, 0.5], 1, 0.0015],
};

// ------------------------------------------------------------------ cars

const LIVERIES = [
    { name: "YOU", main: [0.86, 0.04, 0.06], acc: [0.95, 0.95, 0.95], helmet: [0.98, 0.84, 0.1], tyre: [0.9, 0.1, 0.1] },
    { name: "KOVA", main: [0.04, 0.58, 0.6], acc: [0.82, 0.85, 0.9], helmet: [0.9, 0.9, 0.92], tyre: [0.95, 0.85, 0.1] },
    { name: "MARIN", main: [1.0, 0.48, 0.04], acc: [0.08, 0.32, 0.92], helmet: [0.08, 0.32, 0.92], tyre: [0.9, 0.1, 0.1] },
    { name: "HALE", main: [0.05, 0.1, 0.38], acc: [0.95, 0.14, 0.2], helmet: [0.95, 0.95, 0.95], tyre: [0.95, 0.95, 0.95] },
    { name: "OKAFOR", main: [0.06, 0.42, 0.2], acc: [0.95, 0.78, 0.08], helmet: [0.95, 0.78, 0.08], tyre: [0.95, 0.85, 0.1] },
    { name: "SATO", main: [0.93, 0.93, 0.95], acc: [0.95, 0.18, 0.55], helmet: [0.95, 0.18, 0.55], tyre: [0.9, 0.1, 0.1] },
];
const LEVELS = { easy: 0.82, pro: 0.905, legend: 0.955 };     // × the racing-line pace: Pro ≈ 4% off a clean lap
const WHEEL_F = wheel(0.34, 0.3), WHEEL_R = wheel(0.36, 0.4);

const save = (() => { try { return Object.assign({ bestLap: null, wins: 0, prefs: { session: "day", laps: 3, level: "pro" } }, JSON.parse(localStorage.getItem("grandprix3d.save")) || {}); } catch { return { bestLap: null, wins: 0, prefs: { session: "day", laps: 3, level: "pro" } }; } })();
const persist = () => { try { localStorage.setItem("grandprix3d.save", JSON.stringify(save)); } catch { } };
if (params.get("session") in SESSIONS) save.prefs.session = params.get("session");

// state
let state = "title";            // title | grid | race | finish | results | paused
let pausedFrom = "race";
let player, rivals = [], cars = [];
let raceTime = 0, gridT = 0, goAt = 0, lightsOn = 0, laps = 3, time = 0, shake = 0, flash = 0;
let skids = [], smoke = [], sparks = [], wrongT = 0, stuckT = 0, finishShownAt = 0, results = null;
let driftScore = 0, driftRun = 0, posShown = 0, camMode = 0, titleCamT = 0;
const input = { steer: 0, gas: 0, brake: 0, hand: 0 };

function newCar(slot, liv) {
    const prog = -(7 + slot * 8), off = slot % 2 ? -2.8 : 2.8;
    const p = pointAt(TR, prog, off);
    return {
        liv, slot, prog, off, x: p.x, y: p.y, h: p.h, vx: 0, vy: 0, v: 0, r: 0, steer: 0, slip: 0, drift: 0, i: p.i, s: ((prog % L) + L) % L,
        roll: 0, pitch: 0, offV: 0, skill: 1, lineK: 1, bias: 0, finishT: null, lapStart: 0, lapTimes: [], best: null, surf: "road", wheelPrev: [null, null, null, null], gear: 1, lastPos: 0,
    };
}
function setupRace(demo) {
    laps = AUTO ? 3 : save.prefs.laps;
    const lvl = LEVELS[save.prefs.level] || LEVELS.pro;
    const order = [1, 2, 3, 4, 5];
    cars = []; rivals = [];
    (params.has("solo") ? [] : order).forEach((li, k) => {
        const c = newCar(k, LIVERIES[li]);
        c.skill = lvl * [0.985, 0.97, 0.955, 0.94, 0.925][k] + (Math.random() - 0.5) * 0.01;
        c.lineK = 0.85 + Math.random() * 0.2; c.bias = (Math.random() - 0.5) * 0.6;
        rivals.push(c); cars.push(c);
    });
    player = newCar(5, LIVERIES[0]);
    cars.push(player);
    skids = []; smoke = []; sparks = []; raceTime = 0; results = null; driftScore = 0; driftRun = 0; wrongT = 0; stuckT = 0;
    lightsOn = 0; gridT = 0; goAt = 4.4 + 0.4 + Math.random() * 1.0;
    if (demo) for (const c of cars) { c.v = 30; const f = [Math.cos(c.h), Math.sin(c.h)]; c.vx = f[0] * 30; c.vy = f[1] * 30; }
    camSnap = true;
    posShown = 6;
    ui.hud(true);
}

// ------------------------------------------------------------------ player physics

const SURF = { road: { grip: 1, drag: 0, power: 1 }, kerb: { grip: 0.94, drag: 0.02, power: 1 }, grass: { grip: 0.55, drag: 0.3, power: 0.6 }, gravel: { grip: 0.45, drag: 0.85, power: 0.45 } };
function surfaceAt(i, off) {
    const a = Math.abs(off);
    if (a <= HALF + 0.2) return "road";
    if (KERBS[i] && a <= HALF + KERB) return "kerb";
    if ((off > 0 ? GRAVEL_L[i] : GRAVEL_R[i]) && a > HALF + 3.0) return "gravel";
    return "grass";
}
function physics(c, inp, dt) {
    let fx = Math.cos(c.h), fy = Math.sin(c.h);
    let vF = c.vx * fx + c.vy * fy, vR = c.vx * fy - c.vy * fx;
    const speed = Math.hypot(c.vx, c.vy), S = SURF[c.surf];
    // steering: less lock at speed, the wheels turn at a finite rate
    const maxSteer = lerp(0.52, 0.075, Math.pow(clamp(speed / 78, 0, 1), 0.7));
    c.steer += clamp(inp.steer * maxSteer - c.steer, -2.6 * dt, 2.6 * dt);
    // throttle, brakes (reverse when stopped), drag
    let a = 0;
    if (inp.gas > 0) a += 14 * inp.gas * Math.max(0, 1 - Math.pow(Math.max(vF, 0) / 95, 2.5)) * S.power;
    if (inp.brake > 0) { if (vF > 0.5) a -= 33 * inp.brake * (0.4 + 0.6 * S.grip); else if (inp.gas === 0) a -= 7 * inp.brake * (vF > -9 ? 1 : 0); }
    a -= 0.0006 * vF * Math.abs(vF) + Math.sign(vF) * 0.25 + S.drag * vF;
    const before = vF;
    vF += a * dt;
    if (inp.brake > 0 && before > 0 && vF < 0) vF = 0;
    if (inp.gas === 0 && inp.brake === 0 && Math.abs(vF) < 0.3) vF = 0;
    // drift: handbrake, or hard braking while turning at speed. Throttle + steering keep it going.
    const intent = (inp.hand > 0 && speed > 12) || (inp.brake > 0.5 && Math.abs(inp.steer) > 0.55 && speed > 24);
    const keep = Math.abs(c.slip) > 0.12 && inp.gas > 0 && Math.abs(inp.steer) > 0.25;
    c.drift = intent ? Math.min(1, c.drift + dt * 5) : keep ? Math.max(0, c.drift - dt * 0.5) : Math.max(0, c.drift - dt * 2.8);
    // yaw: what the front wheels ask for, limited by grip (more freedom while drifting)
    const aLat = latGrip(speed) * S.grip;
    const rGrip = -vF * Math.tan(c.steer) / 3.4;              // steer > 0 = right = clockwise
    const rMax = aLat / Math.max(speed, 4);
    const rT = clamp(rGrip * (1 + 0.85 * c.drift), -rMax * (1 + 0.8 * c.drift), rMax * (1 + 0.8 * c.drift));
    c.r += (rT - c.r) * Math.min(1, dt * lerp(11, 4.5, c.drift));
    // velocity in the world, then turn the car under it
    const wx = vF * fx + vR * fy, wy = vF * fy - vR * fx;
    c.h += c.r * dt;
    fx = Math.cos(c.h); fy = Math.sin(c.h);
    vF = wx * fx + wy * fy; vR = wx * fy - wy * fx;
    // tyres pull the velocity back in line with the car: strongly with grip, loosely in a drift
    const kLat = lerp(12, 1.5, c.drift) * (0.5 + 0.5 * S.grip);
    const vR2 = vR * Math.exp(-kLat * dt);
    if (vF > 0) vF += Math.abs(vR - vR2) * 0.3 * c.drift;                  // a drift carries its speed through
    vR = vR2;
    if (vF > 0) vF = Math.max(0, vF - dt * 9 * c.drift * Math.min(1, Math.abs(c.slip) * 2.2));   // ...but scrubs a little
    c.slip = Math.atan2(vR, Math.max(Math.abs(vF), 2));
    c.vx = vF * fx + vR * fy; c.vy = vF * fy - vR * fx;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.v = vF;
    // body attitude: lean in corners, squat and dive
    c.roll = lerp(c.roll, clamp(-c.r * speed * 0.0016, -0.05, 0.05), Math.min(1, dt * 8));
    c.pitch = lerp(c.pitch, clamp(-a * 0.0012, -0.03, 0.03), Math.min(1, dt * 6));
}
// keep the car inside the barriers; returns the impact speed
function walls(c) {
    const loc = locate(TR, c.x, c.y, c.i);
    c.i = loc.i; c.off = loc.off;
    const lim = WALL - 1.05;
    if (Math.abs(loc.off) <= lim) return 0;
    const sg = Math.sign(loc.off), nx = TR.nx[loc.i] * sg, ny = TR.ny[loc.i] * sg, pen = Math.abs(loc.off) - lim;
    c.x -= nx * pen; c.y -= ny * pen; c.off = sg * lim;
    const vn = c.vx * nx + c.vy * ny;
    if (vn <= 0) return 0;
    c.vx -= nx * vn * 1.35; c.vy -= ny * vn * 1.35;
    const k = 1 - Math.min(0.45, vn * 0.02);
    c.vx *= k; c.vy *= k;
    c.r = c.r * 0.3 - sg * vn * 0.02 * Math.sign(c.vx * TR.tx[loc.i] + c.vy * TR.ty[loc.i]);
    c.drift *= 0.5;
    return vn;
}

// ------------------------------------------------------------------ drivers: rivals (track-following) and the autopilot

// what the physics car can really do on (roughly) the centre line: the autopilot drives to this
const VPL = (() => {
    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) { const k = Math.abs(TR.ks[i]) * 0.97; v[i] = k - 0.0042 <= 0 ? VMAX : Math.min(VMAX, Math.sqrt(16 / (k - 0.0042))); }
    for (let rep = 0; rep < 2; rep++) {
        for (let i = N - 1; i >= 0; i--) { const n = v[I(i + 1)]; v[i] = Math.min(v[i], Math.sqrt(n * n + 2 * 22 * STEP)); }
        for (let i = 0; i < N; i++) { const p = v[I(i - 1)]; v[i] = Math.min(v[i], Math.sqrt(p * p + 2 * 11 * STEP)); }
    }
    return v;
})();

function rubber(c) {
    if (state === "title") return 1;
    const d = player.prog - c.prog;
    return 1 + clamp(d / 160, -1, 1) * 0.035;
}
function driveRival(c, dt, go) {
    const s = ((c.prog % L) + L) % L, i = Math.floor(s / STEP) % N;
    let target = go ? Math.min(TR.vmax[i], TR.vmax[I(i + 3)]) * c.skill * rubber(c) : 0;
    if (c.finishT != null && state !== "title") target *= 0.7;
    let want = TR.line[I(i + 6)] * c.lineK + c.bias;
    for (const o of cars) {
        if (o === c) continue;
        const ds = o.prog - c.prog;
        if (ds <= 0 || ds > 24) continue;
        const doff = o.off - c.off;
        if (Math.abs(doff) > 2.7) continue;
        const left = o.off + 3.5, right = o.off - 3.5, canL = left < 5.6, canR = right > -5.6;
        if (ds < 16) { if (canL && (!canR || Math.abs(left - want) < Math.abs(right - want))) want = left; else if (canR) want = right; }
        if (ds < 10 && o.v < c.v + 1) target = Math.min(target, Math.max(0, o.v - 1 + ds * 0.25));
    }
    if (c.v < target) c.v += Math.min(target - c.v, 13 * Math.max(0.15, 1 - Math.pow(c.v / 95, 2.5)) * dt);
    else c.v -= Math.min(c.v - target, 30 * dt);
    const offV = clamp((clamp(want, -5.6, 5.6) - c.off) * 1.5, -4, 4);
    c.offV = lerp(c.offV, offV, Math.min(1, dt * 5));
    c.off = clamp(c.off + c.offV * dt, -5.8, 5.8);
    c.prog += c.v * dt;
    const p = pointAt(TR, c.prog, c.off);
    c.x = p.x; c.y = p.y; c.i = p.i; c.s = ((c.prog % L) + L) % L;
    c.h = p.h + Math.atan2(c.offV, Math.max(c.v, 2));
    c.steer = lerp(c.steer, clamp(-Math.atan(3.4 * TR.ks[i]) * 1.2 - c.offV * 0.03, -0.4, 0.4), Math.min(1, dt * 6));
    c.roll = lerp(c.roll, clamp(-TR.ks[i] * c.v * c.v * 0.0016 / 6, -0.04, 0.04), Math.min(1, dt * 5));
    c.vx = Math.cos(c.h) * c.v; c.vy = Math.sin(c.h) * c.v;
}
// steering/throttle that follows the racing line (title demo, ?autoplay, the cool-down lap)
function autopilot(c, pace) {
    const speed = Math.hypot(c.vx, c.vy);
    const ahead = c.s + 7 + speed * 0.42, k = I(Math.floor(ahead / STEP));
    const tp = pointAt(TR, ahead, TR.line[k] * 0.9);
    const want = Math.atan2(tp.y - c.y, tp.x - c.x);
    const err = wrapA(want - c.h) + c.slip * 0.3;            // > 0: target is to the left
    const i = c.i;
    let vt = Math.min(VPL[i], VPL[I(i + 2)], VPL[I(i + 4)]) * pace;
    if (Math.abs(c.off) > 5.2 && Math.sign(c.off) === -Math.sign(TR.ks[i])) vt *= 0.9;     // running wide: lift
    // keep off the gearbox of slower cars right ahead
    for (const o of cars) if (o !== c) { const ds = o.prog - c.prog; if (ds > 0 && ds < 12 && Math.abs(o.off - c.off) < 2.4) vt = Math.min(vt, o.v + ds * 0.5); }
    return { steer: clamp(-err * 3.2, -1, 1), gas: speed < vt - 0.5 ? 1 : 0, brake: speed > vt + 1.5 ? clamp((speed - vt) / 6, 0.2, 1) : 0, hand: 0 };
}

// ------------------------------------------------------------------ the race

function startRace() {
    audio.init();
    setupRace(false);
    state = "grid";
    ui.show("hud");
}
function bump(a, b) {
    // two circles per car (front, rear) — push apart, trade some speed
    let best = null;
    for (const fa of [-1.45, 1.45]) for (const fb of [-1.45, 1.45]) {
        const ax = a.x + Math.cos(a.h) * fa, ay = a.y + Math.sin(a.h) * fa, bx = b.x + Math.cos(b.h) * fb, by = b.y + Math.sin(b.h) * fb;
        const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy);
        if (d < 2.0 && (!best || d < best.d)) best = { d, nx: d > 1e-4 ? dx / d : 1, ny: d > 1e-4 ? dy / d : 0 };
    }
    if (!best) return 0;
    const pen = 2.0 - best.d;
    a.x += best.nx * pen * 0.6; a.y += best.ny * pen * 0.6;
    // the rival is moved along/across the track
    const ti = b.i, along = -(best.nx * TR.tx[ti] + best.ny * TR.ty[ti]) * pen * 0.4, across = -(best.nx * TR.nx[ti] + best.ny * TR.ny[ti]) * pen * 0.4;
    b.prog += along; b.off = clamp(b.off + across, -6, 6);
    const rel = (a.vx - b.vx) * best.nx + (a.vy - b.vy) * best.ny;
    if (rel < 0) {
        a.vx -= best.nx * rel * 0.75; a.vy -= best.ny * rel * 0.75;
        if (along > 0) b.v = Math.max(0, b.v + rel * 0.3); else b.v = Math.max(0, b.v - rel * 0.15);
        a.r += (Math.random() - 0.5) * Math.min(1.2, -rel * 0.08);
    }
    return -Math.min(0, rel);
}
let passCool = 0;
function update(dt) {
    time += dt;
    if (state === "paused") return;
    const title = state === "title";
    if (state === "grid") {
        gridT += dt;
        const on = Math.min(5, Math.floor((gridT - 0.4) / 0.8) + 1);
        if (gridT > 0.4 && on > lightsOn && on <= 5) { lightsOn = on; audio.light(); ui.lights(lightsOn); }
        if (gridT >= goAt) { lightsOn = 0; ui.lights(0, true); audio.go(); state = "race"; raceTime = 0; player.lapStart = 0; for (const c of rivals) c.lapStart = 0; }
    }
    const racing = state === "race" || state === "finish" || state === "results" || title;
    if (state === "race" || state === "finish" || state === "results") raceTime += dt;
    // player controls
    let inp = { steer: input.steer, gas: input.gas, brake: input.brake, hand: input.hand };
    if (title || AUTO) inp = autopilot(player, title ? 0.93 : 0.985);
    if (state === "finish" || state === "results") inp = autopilot(player, 0.6);
    if (state === "grid") { inp = { steer: 0, gas: 0, brake: 0, hand: 0 }; player.vx = player.vy = 0; }
    // physics in small steps
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    let impact = 0;
    for (let k = 0; k < steps; k++) {
        physics(player, inp, h);
        impact = Math.max(impact, walls(player));
        for (const c of rivals) driveRival(c, h, racing);
        for (const c of rivals) impact = Math.max(impact, bump(player, c) * 0.6);
    }
    // where is the player on the track
    const loc = locate(TR, player.x, player.y, player.i);
    let ds = loc.s - player.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    player.s = loc.s; player.i = loc.i; player.off = loc.off; player.prog += ds;
    player.surf = surfaceAt(loc.i, loc.off);
    const speed = Math.hypot(player.vx, player.vy);
    if (impact > 3) {
        audio.hit(Math.min(1, impact / 18)); shake = Math.min(1, shake + impact / 25); flash = Math.min(0.25, impact / 60);
        for (let i = 0; i < Math.min(30, impact * 2); i++) { const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6; sparks.push({ x: player.x, y: player.y, z: 0.5, vx: Math.cos(a) * s + player.vx * 0.5, vy: Math.sin(a) * s + player.vy * 0.5, vz: 2 + Math.random() * 4, life: 0.4 + Math.random() * 0.5 }); }
        if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(Math.min(80, impact * 4)); } catch { }
    }
    if (player.surf === "kerb" && speed > 15) shake = Math.max(shake, 0.12);
    if ((player.surf === "grass" || player.surf === "gravel") && speed > 8) shake = Math.max(shake, 0.18);
    // laps, timing, positions
    if (state === "race") {
        const lapNow = Math.floor(player.prog / L);
        if (lapNow >= 1 && lapNow > player.lapTimes.length) {
            const t = raceTime - player.lapStart;
            player.lapTimes.push(t); player.lapStart = raceTime;
            const fastest = player.best == null || t < player.best;
            if (fastest) player.best = t;
            const record = save.bestLap == null || t < save.bestLap;
            if (record && !AUTO) { save.bestLap = t; persist(); }
            if (lapNow >= laps) finishRace();
            else {
                const final = lapNow === laps - 1;
                audio.lap(final);
                ui.msg(final ? "FINAL LAP" : `LAP ${lapNow + 1}`, `${fmt(t)}${record ? "  ·  TRACK RECORD" : fastest && lapNow > 1 ? "  ·  FASTEST LAP" : ""}`, record || (fastest && lapNow > 1) ? "purple" : "");
                if (record || fastest) audio.fastest();
            }
        }
    }
    for (const c of rivals) {
        if (c.finishT == null && c.prog >= laps * L && (state === "race" || state === "finish" || state === "results")) c.finishT = raceTime - (c.prog - laps * L) / Math.max(c.v, 1);
        const lapNow = Math.floor(c.prog / L);
        if (lapNow >= 1 && lapNow > c.lapTimes.length && state !== "title") { const t = raceTime - c.lapStart; c.lapTimes.push(t); c.lapStart = raceTime; if (c.best == null || t < c.best) c.best = t; }
    }
    // rivals whooshing past
    passCool -= dt;
    for (const c of rivals) {
        const rel = c.prog - player.prog, was = c.lastRel ?? rel;
        c.lastRel = rel;
        if (passCool <= 0 && Math.sign(rel) !== Math.sign(was) && Math.abs(c.off - player.off) < 6 && state !== "title") { audio.pass(0.8); passCool = 0.4; }
    }
    // drift scoring
    if (state === "race") {
        if (player.drift > 0.45 && Math.abs(player.slip) > 0.14 && speed > 14 && player.surf !== "grass" && player.surf !== "gravel") driftRun += speed * Math.abs(player.slip) * dt * 12;
        else if (driftRun > 0 && player.drift < 0.2) { if (driftRun > 40) { driftScore += Math.round(driftRun); ui.pop(`DRIFT +${Math.round(driftRun).toLocaleString()}`); } driftRun = 0; }
        // wrong way / stuck → put the car back on track
        const fwd = Math.cos(player.h) * TR.tx[player.i] + Math.sin(player.h) * TR.ty[player.i];
        wrongT = fwd < -0.3 && speed > 2 ? wrongT + dt : Math.max(0, wrongT - dt * 2);
        stuckT = speed < 1.5 && input.gas > 0 ? stuckT + dt : 0;
        if (wrongT > 6 || stuckT > 3) recover();
    }
    // effects: skid marks and smoke from sliding or locked tyres
    const sliding = Math.abs(player.slip) > 0.1 && speed > 8;
    const locking = inp.brake > 0.6 && speed > 22 && state === "race";
    const offroad = (player.surf === "grass" || player.surf === "gravel") && speed > 6;
    const wl = wheelWorld(player);
    for (let k = 0; k < 4; k++) {
        const front = k < 2, mark = (sliding && !front) || (locking && Math.random() < 0.9) || (offroad && !front);
        const p = wl[k], prev = player.wheelPrev[k];
        if (mark && player.surf !== "gravel") {
            if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.7) { addSkid(prev, p, offroad ? 0.35 : Math.min(0.85, 0.35 + Math.abs(player.slip))); player.wheelPrev[k] = p; }
            else if (!prev) player.wheelPrev[k] = p;
        } else player.wheelPrev[k] = null;
        if (!front && (sliding && Math.abs(player.slip) > 0.16 || offroad) && smoke.length < 160 && Math.random() < (offroad ? 0.35 : 0.6)) {
            const dust = offroad;
            smoke.push({ x: p[0], y: p[1], z: 0.3, vx: player.vx * 0.15 + (Math.random() - 0.5) * 2, vy: player.vy * 0.15 + (Math.random() - 0.5) * 2, vz: 0.6 + Math.random() * 0.8, s: 0.5, life: 1.4, max: 1.4, b: dust ? 0.75 : 1.0, a: dust ? 0.35 : 0.42, seed: Math.random(), dust });
        }
    }
    for (const s of smoke) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vx *= Math.exp(-dt * 1.5); s.vy *= Math.exp(-dt * 1.5); s.s += dt * 1.8; s.life -= dt; }
    smoke = smoke.filter((s) => s.life > 0);
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 12 * dt; if (s.z < 0.05) { s.z = 0.05; s.vz *= -0.4; } s.life -= dt; }
    sparks = sparks.filter((s) => s.life > 0);
    shake *= Math.exp(-dt * 5); flash = Math.max(0, flash - dt * 2);
    // finish → results
    if (state === "finish" && raceTime - finishShownAt > 3.2) showResults();
    if (AUTO && state === "results" && raceTime - finishShownAt > 7) { setupRace(false); state = "grid"; ui.show("hud"); }
    // engine
    const g = gearOf(Math.max(0, player.v));
    player.gear = g.gear;
    audio.engine(state !== "title" && state !== "paused", state === "grid" ? 0.25 + input.gas * 0.6 : g.rpm, state === "grid" ? input.gas : inp.gas, Math.min(1, Math.abs(player.slip) * 2.5 + (locking ? 0.5 : 0)) * (speed > 6 ? 1 : 0), offroad ? Math.min(1, speed / 30) : player.surf === "kerb" && speed > 10 ? 0.4 : 0);
    ui.hud();
}
function recover() {
    const p = pointAt(TR, player.s + 4, 0);
    player.x = p.x; player.y = p.y; player.h = p.h; player.vx = player.vy = 0; player.v = 0; player.r = 0; player.drift = 0; player.slip = 0;
    player.i = locate(TR, p.x, p.y, -1).i;
    wrongT = 0; stuckT = 0;
    ui.msg("BACK ON TRACK", "", "");
}
function finishRace() {
    player.finishT = raceTime;
    state = "finish"; finishShownAt = raceTime;
    const pos = standings().indexOf(player) + 1;
    ui.msg(pos === 1 ? "WINNER!" : `FINISHED P${pos}`, fmt(raceTime), pos === 1 ? "gold" : "");
    audio.finish(pos === 1);
    if (pos === 1 && !AUTO) { save.wins++; persist(); }
}
function standings() {
    if (state === "finish" || state === "results") {
        // finished cars by time, the rest by estimated time
        const est = (c) => c.finishT != null ? c.finishT : raceTime + (laps * L - c.prog) / Math.max(5, c.prog / Math.max(raceTime, 1));
        return cars.slice().sort((a, b) => est(a) - est(b));
    }
    return cars.slice().sort((a, b) => b.prog - a.prog);
}
function showResults() {
    state = "results";
    const order = standings();
    const est = (c) => c.finishT != null ? c.finishT : raceTime + (laps * L - c.prog) / Math.max(5, c.prog / Math.max(raceTime, 1));
    results = order.map((c) => ({ name: c.liv.name, col: c.liv.main, t: est(c), best: c.best, me: c === player }));
    ui.results(results, order.indexOf(player) + 1);
}

// gears and revs from the speed
const GEARS = [0, 19, 30, 40, 49, 58, 66, 74, 999];
function gearOf(v) {
    let g = 1; while (g < 8 && v > GEARS[g]) g++;
    const lo = g === 1 ? 0 : GEARS[g - 1] * 0.78, hi = g === 8 ? 85 : GEARS[g];
    return { gear: g, rpm: clamp(0.35 + 0.65 * (v - lo) / (hi - lo), 0.3, 1) };
}

// ------------------------------------------------------------------ per-frame geometry

const solid = new Mesh(120000), alpha = new Mesh(30000), glow = new Mesh(20000);
const SKID_MAX = 1400;
function addSkid(a, b, k) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * 0.17, ny = dx / l * 0.17;
    skids.push([a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny, k]);
    if (skids.length > SKID_MAX) skids.splice(0, skids.length - SKID_MAX);
}
function carXform(c) {
    const a = c.h - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), cr = Math.cos(c.roll), sr = Math.sin(c.roll), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    return (p) => {
        const x1 = p[0] * cr - (p[2] - 0.35) * sr, z1 = p[0] * sr + (p[2] - 0.35) * cr;
        const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp + 0.35;
        return [c.x + x1 * ca - y2 * sa, c.y + x1 * sa + y2 * ca, z2];
    };
}
function wheelWorld(c) {
    const a = c.h - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    return WHEELS.map(([x, y]) => [c.x + x * ca - y * sa, c.y + x * sa + y * ca]);
}
const CARBON = [0.045, 0.045, 0.055], VISOR = [0.04, 0.05, 0.08], TYRE = [0.035, 0.035, 0.04], RIM = [0.32, 0.33, 0.36];
function drawCar(c, S, braking) {
    const X = carXform(c), lv = c.liv;
    const slot = { paint: [lv.main, 1], accent: [lv.acc, 1], carbon: [CARBON, 1], helmet: [lv.helmet, 1], visor: [VISOR, 1], tyre: [TYRE, 0], stripe: [lv.tyre, 0], rim: [RIM, 1], light: [[2.4, 0.15, 0.1], 2] };
    for (const [a, b, d, s] of BODY) { const [col, mat] = slot[s]; solid.tri(X(a), X(b), X(d), col, mat); }
    for (const [wx, wy, r, w, front] of WHEELS) {
        const st = front ? -c.steer : 0, cs = Math.cos(st), sn = Math.sin(st), tpl = front ? WHEEL_F : WHEEL_R;
        const W = (p) => X([wx + p[0] * cs - p[1] * sn, wy + p[0] * sn + p[1] * cs, r + p[2]]);
        for (const [a, b, d, s] of tpl) { const [col, mat] = slot[s]; solid.tri(W(a), W(b), W(d), col, mat); }
    }
    // soft shadow under the car
    const sh = (x, y) => { const p = X([x, y, 0]); return [p[0], p[1], 0.03]; };
    alpha.uvquad(sh(-1.25, -3.0), sh(1.25, -3.0), sh(1.25, 3.0), sh(-1.25, 3.0), [0.6, 0, 0], 8);
    // rain light: dim always, bright under braking and at night
    const rl = X([0, -2.95, 0.55]), k = 0.25 + S.night * 0.5 + (braking ? 0.6 : 0);
    glow.sprite(rl[0], rl[1], rl[2], 0.35 + k * 0.3, 1.0 * k, 0.08 * k, 0.05 * k);
}
function buildDynamic(S, camX, camY) {
    solid.reset(); alpha.reset(); glow.reset();
    for (const c of cars) {
        if ((c.x - camX) ** 2 + (c.y - camY) ** 2 > 700 * 700) continue;
        drawCar(c, S, c === player ? input.brake > 0 && state === "race" : c.v < (c.prevV ?? c.v) - 0.15);
        c.prevV = c.v;
    }
    for (const s of skids) {
        if ((s[0] - camX) ** 2 + (s[1] - camY) ** 2 > 260 * 260) continue;
        alpha.uvquad([s[0], s[1], 0.025], [s[2], s[3], 0.025], [s[4], s[5], 0.025], [s[6], s[7], 0.025], [s[8], 0, 0], 11);
    }
    for (const s of smoke) { const k = Math.min(1, s.life / s.max * 1.6) * s.a; alpha.sprite(s.x, s.y, s.z, s.s, k, s.b, s.seed, 13); }
    for (const s of sparks) { const k = Math.min(1, s.life * 2.5); glow.sprite(s.x, s.y, s.z, 0.09, 1.6 * k, 1.1 * k, 0.4 * k); }
    // start lights
    for (let k = 0; k < LIGHTS.length; k++) {
        const on = Math.floor(k / 2) < lightsOn, p = LIGHTS[k];
        glow.sprite(p[0], p[1], p[2], on ? 0.55 : 0.2, on ? 2.2 : 0.08, on ? 0.12 : 0.02, on ? 0.08 : 0.02);
    }
    // floodlights after dark
    if (S.night > 0.05) for (const [x, y, z] of LAMPS) {
        if ((x - camX) ** 2 + (y - camY) ** 2 > 600 * 600) continue;
        const k = S.night;
        glow.sprite(x, y, z, 3.2, 0.9 * k, 0.85 * k, 0.7 * k);
        glow.sprite(x, y, z, 9, 0.12 * k, 0.11 * k, 0.09 * k);
    }
    // speed lines at the screen edges when flat out
    const sN = solid.n, aN = alpha.n;
    solid.append(alpha); solid.append(glow);
    space.setDynamic(solid.pos, solid.col, solid.n);
    return { sN, aN, gN: glow.n };
}

// ------------------------------------------------------------------ cameras and render

const CAMS = [
    { name: "CHASE", back: 7.6, height: 2.45, ahead: 6, lookZ: 0.9, mag: 1 },
    { name: "FAR", back: 11.5, height: 3.9, ahead: 9, lookZ: 0.7, mag: 1.1 },
    { name: "ONBOARD", onboard: true, mag: 0.85 },
];
if (params.get("cam") === "far") camMode = 1;
let cam = { x: 0, y: 0, z: 3, yaw: 0, lx: 0, ly: 0, lz: 0 }, camSnap = true;
function render(dt) {
    const aspect = canvas.width / canvas.height;
    const S0 = SESSIONS[save.prefs.session] || SESSIONS.day;
    const S = { top: S0[0], hor: S0[1], sun: S0[2], sunCol: S0[3], amb: S0[4], night: S0[5], fog: S0[6] };
    const c = player, speed = Math.hypot(c.vx, c.vy), sp = clamp(speed / VMAX, 0, 1);
    let mode = CAMS[camMode];
    let ex, ey, ez, lx, ly, lz;
    const velYaw = speed > 3 ? Math.atan2(c.vy, c.vx) : c.h;
    if (state === "title") {
        // cinematic: alternate a low tracking shot, a trackside TV camera and the chase view
        titleCamT += dt;
        const shot = Math.floor(titleCamT / 6) % 3, f = [Math.cos(c.h), Math.sin(c.h)], n = [-f[1], f[0]];
        if (shot === 0) {
            if (cam.side == null || titleCamT - (cam.sideT || 0) > 6) { cam.sideT = titleCamT; cam.side = rivals.some((o) => o.prog > c.prog - 6 && o.prog < c.prog + 12 && o.off > c.off) ? -1 : 1; }
            n[0] *= cam.side; n[1] *= cam.side;
            ex = c.x + n[0] * 5.5 + f[0] * 3; ey = c.y + n[1] * 5.5 + f[1] * 3; ez = 0.9; lx = c.x + f[0] * 1.5; ly = c.y + f[1] * 1.5; lz = 0.6; camSnap = true; }
        else if (shot === 1) {
            if (!cam.tv || titleCamT - cam.tvT > 6) { const p = pointAt(TR, c.prog + 60, (WALL + 8) * (hash(Math.floor(titleCamT)) > 0.5 ? 1 : -1)); cam.tv = [p.x, p.y, 7]; cam.tvT = titleCamT; }
            [ex, ey, ez] = cam.tv; lx = c.x; ly = c.y; lz = 0.6; camSnap = true;
        } else { mode = CAMS[0]; cam.tv = null; }
        cam.mag = shot === 1 ? 2.6 : 1.3;
    }
    if (ex === undefined) {
        if (mode.onboard) {
            const f = [Math.cos(c.h), Math.sin(c.h)];
            ex = c.x - f[0] * 0.25; ey = c.y - f[1] * 0.25; ez = 1.3; lx = c.x + f[0] * 30; ly = c.y + f[1] * 30; lz = 0.75;
            cam.yaw = c.h;
        } else {
            const target = c.h + wrapA(velYaw - c.h) * 0.55;
            cam.yaw = camSnap ? target : cam.yaw + wrapA(target - cam.yaw) * Math.min(1, dt * 5.5);
            const tall = aspect < 0.8, back = mode.back * (tall ? 0.92 : 1) + sp * 0.8, f = [Math.cos(cam.yaw), Math.sin(cam.yaw)];
            ex = c.x - f[0] * back; ey = c.y - f[1] * back; ez = mode.height * (tall ? 1.18 : 1) + sp * 0.2;
            lx = c.x + f[0] * mode.ahead; ly = c.y + f[1] * mode.ahead; lz = mode.lookZ - (tall ? 0.7 : 0);
        }
        camSnap = false;
        cam.mag = (aspect < 0.8 ? 2.5 : aspect < 1.2 ? 1.5 : 1.4) * mode.mag / (1 + sp * 0.2);
    }
    const s = shake * (reducedMotion ? 0.1 : 0.22), jx = (Math.random() - 0.5) * s, jz = (Math.random() - 0.5) * s;
    space.lookAt(ex + jx, ey, ez + jz, lx + jx, ly, lz + jz);
    space.magnifier = cam.mag;
    const { sN, aN, gN } = buildDynamic(S, ex, ey);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uTop, S.top); gl.uniform3fv(U.uHor, S.hor);
    gl.uniform3fv(U.uSunDir, S.sun); gl.uniform3fv(U.uSunCol, S.sunCol); gl.uniform3fv(U.uAmb, S.amb);
    gl.uniform1f(U.uNight, S.night); gl.uniform1f(U.uFog, S.fog);
    gl.uniform1f(U.uFlash, reducedMotion ? flash * 0.3 : flash);
    gl.uniform1f(U.uLen, L);
    space.applyCamera();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.bind(false); space.draw(0, solidCount);
    space.bind(true); space.draw(0, sN);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    space.bind(true); space.draw(sN, aN);
    space.bind(false); space.draw(solidCount, cloudCount);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(true); space.draw(sN + aN, gN);
    gl.depthMask(true); gl.disable(gl.BLEND);
}

// ------------------------------------------------------------------ UI

const $ = (id) => document.getElementById(id);
const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
// minimap
const MAP = (() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, TR.px[i]); x1 = Math.max(x1, TR.px[i]); y0 = Math.min(y0, TR.py[i]); y1 = Math.max(y1, TR.py[i]); }
    const pad = 20, k = 100 / Math.max(x1 - x0 + pad * 2, y1 - y0 + pad * 2), w = (x1 - x0 + pad * 2) * k, h = (y1 - y0 + pad * 2) * k;
    const tx = (x) => ((x - x0 + pad) * k).toFixed(1), ty = (y) => ((y1 - y + pad) * k).toFixed(1);
    let d = ""; for (let i = 0; i < N; i += 3) d += (i ? "L" : "M") + tx(TR.px[i]) + " " + ty(TR.py[i]);
    $("map").setAttribute("viewBox", `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`);
    $("map-road").setAttribute("d", d + "Z"); $("map-edge").setAttribute("d", d + "Z");
    $("map-start").setAttribute("cx", tx(TR.px[0])); $("map-start").setAttribute("cy", ty(TR.py[0]));
    const dots = LIVERIES.map((lv, k) => { const el = document.createElementNS("http://www.w3.org/2000/svg", "circle"); el.setAttribute("r", k === 0 ? 3.2 : 2.4); el.setAttribute("fill", rgb(lv.main)); el.setAttribute("stroke", k === 0 ? "#fff" : "rgba(0,0,0,.6)"); el.setAttribute("stroke-width", k === 0 ? 1.2 : 0.6); return el; });
    for (let k = dots.length - 1; k >= 0; k--) $("map").appendChild(dots[k]);
    return { tx, ty, dots };
})();
const REV = [];
for (let k = 0; k < 15; k++) { const el = document.createElement("i"); el.className = k < 5 ? "g" : k < 10 ? "r" : "b"; $("rev").appendChild(el); REV.push(el); }
let shown = {};
const ui = {
    shown: "title",
    show(which) { this.shown = which; for (const id of ["title", "paused", "results"]) $(id).classList.toggle("hidden", id !== which); document.body.dataset.state = which; },
    hud(force) {
        if (!player) return;
        const set = (k, v, fn) => { if (force || shown[k] !== v) { shown[k] = v; fn(v); } };
        const speed = Math.hypot(player.vx, player.vy);
        set("kmh", Math.round(speed * 3.6), (v) => $("kmh").textContent = v);
        const g = gearOf(Math.max(0, player.v));
        set("gear", player.v < -0.5 ? "R" : state === "grid" ? "N" : g.gear, (v) => $("gear").textContent = v);
        const lit = state === "grid" ? Math.round((0.25 + input.gas * 0.6) * 15) : Math.round(g.rpm * 15);
        set("rev", lit, (v) => REV.forEach((el, k) => el.classList.toggle("on", k < v)));
        const order = standings(), pos = order.indexOf(player) + 1;
        set("pos", pos, (v) => $("pos").textContent = v);
        if (state === "race" && pos < posShown && raceTime > 2) ui.pop(`▲ P${pos}`, "up");
        if (state === "race" || state === "grid") posShown = pos;
        const lap = clamp(Math.floor(player.prog / L) + 1, 1, laps);
        set("lap", `${lap}/${laps}`, (v) => $("lap").textContent = v);
        const cur = state === "race" ? raceTime - player.lapStart : state === "grid" ? 0 : player.lapTimes.length ? player.lapTimes[player.lapTimes.length - 1] : 0;
        set("time", fmt(cur), (v) => $("time").textContent = v);
        set("best", player.best ?? save.bestLap, (v) => { $("bestlap").textContent = fmt(v); $("bestlabel").textContent = player.best != null ? "BEST" : "RECORD"; });
        set("total", fmt(raceTime), (v) => $("total").textContent = v);
        const dr = driftRun > 40 && state === "race" ? Math.round(driftRun) : 0;
        set("drift", dr, (v) => { $("drift").classList.toggle("show", v > 0); if (v) $("drift-n").textContent = v.toLocaleString(); });
        set("wrong", wrongT > 1.2, (v) => $("wrong").classList.toggle("show", v));
        for (let k = 0; k < cars.length; k++) {
            const c = cars[k], dot = MAP.dots[LIVERIES.indexOf(c.liv)];
            dot.setAttribute("cx", MAP.tx(c.x)); dot.setAttribute("cy", MAP.ty(c.y));
        }
    },
    lights(n, out) {
        const els = $("lights").children;
        for (let k = 0; k < 5; k++) els[k].classList.toggle("on", k < n);
        $("lights").classList.toggle("show", !out && n > 0);
        if (out) { $("lights").classList.remove("show"); ui.msg("GO!", "", "go"); }
    },
    msg(big, small, kind) {
        const el = $("msg"); $("msg-big").textContent = big; $("msg-small").textContent = small || "";
        el.className = ""; void el.offsetWidth; el.className = "show " + (kind || "");
    },
    pop(t, kind) { const el = $("pop"); el.textContent = t; el.className = ""; void el.offsetWidth; el.className = "show " + (kind || ""); },
    results(rows, pos) {
        this.show("results");
        $("r-pos").textContent = pos === 1 ? "1ST" : pos === 2 ? "2ND" : pos === 3 ? "3RD" : `${pos}TH`;
        $("r-pos").className = "logo " + (pos === 1 ? "gold" : pos <= 3 ? "podium" : "");
        $("r-title").textContent = pos === 1 ? "Victory! You won the Grand Prix" : pos <= 3 ? "On the podium!" : "Race complete";
        const lead = rows[0].t;
        $("r-table").innerHTML = rows.map((r, k) => `<tr class="${r.me ? "me" : ""}"><td>${k + 1}</td><td><i style="background:${rgb(r.col)}"></i>${r.name}</td><td class="num">${k === 0 ? fmt(r.t) : "+" + (r.t - lead).toFixed(3)}</td></tr>`).join("");
        $("r-best").textContent = fmt(player.best);
        $("r-drift").textContent = driftScore.toLocaleString();
        $("r-record").textContent = fmt(save.bestLap);
        $("again").classList.remove("arm"); void $("again").offsetWidth; $("again").classList.add("arm");
        resultsAt = performance.now();
    },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1300); },
    mute() { $("mute").setAttribute("aria-pressed", audio.muted); },
    prefs() {
        for (const b of document.querySelectorAll("[data-k]")) b.setAttribute("aria-pressed", String(save.prefs[b.dataset.k]) === b.dataset.v);
        $("t-record").textContent = fmt(save.bestLap); $("t-wins").textContent = save.wins;
    },
};
let resultsAt = 0;
ui.mute(); ui.prefs();

// ------------------------------------------------------------------ input

const keys = new Set();
const touch = { l: 0, r: 0, gas: 0, brake: 0 };
function readInput() {
    const k = (...c) => c.some((x) => keys.has(x));
    const steer = (k("ArrowRight", "KeyD") || touch.r ? 1 : 0) - (k("ArrowLeft", "KeyA") || touch.l ? 1 : 0);
    // digital steering is eased in, and recentres faster
    const rate = steer === 0 || Math.sign(steer) !== Math.sign(input.steer) ? 7 : 4.2;
    input.target = steer;
    input.gas = k("ArrowUp", "KeyW") || touch.gas ? 1 : 0;
    input.brake = k("ArrowDown", "KeyS") || touch.brake ? 1 : 0;
    input.hand = k("Space") && state === "race" ? 1 : 0;
    input.rate = rate;
}
function easeSteer(dt) { const t = input.target || 0; input.steer += clamp(t - input.steer, -input.rate * dt, input.rate * dt); }
const goOrRestart = () => {
    if (ui.shown === "title") startRace();
    else if (state === "results" && performance.now() - resultsAt > 700) startRace();
    else if (state === "paused") resume();
};
function pause() { if (state !== "race" && state !== "grid" && state !== "finish") return; pausedFrom = state; state = "paused"; ui.show("paused"); }
function resume() { if (state !== "paused") return; state = pausedFrom; ui.show("hud"); }
function toMenu() { demo(); state = "title"; ui.prefs(); ui.show("title"); }
// the title screen: everyone already lapping, mid-race
function demo() {
    setupRace(true);
    for (const c of cars) { c.prog += 300; const p = pointAt(TR, c.prog, c.off); c.x = p.x; c.y = p.y; c.h = p.h; c.s = ((c.prog % L) + L) % L; c.v = 40; c.vx = Math.cos(c.h) * 40; c.vy = Math.sin(c.h) * 40; c.i = locate(TR, c.x, c.y, -1).i; }
}
function cycleCam() { camMode = (camMode + 1) % CAMS.length; camSnap = true; ui.toast(CAMS[camMode].name + " CAMERA"); }
addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { audio.init(); ui.toast(audio.toggleMute() ? "Sound off" : "Sound on"); ui.mute(); return; }
    if (e.code === "KeyP" || e.code === "Escape") { if (state === "paused") resume(); else pause(); return; }
    if (e.code === "KeyC") { cycleCam(); return; }
    if (e.code === "KeyR" && state === "race") { recover(); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS", "Space"].includes(e.code)) {
        if (!(e.code === "Space" && ui.shown !== "hud")) { e.preventDefault(); keys.add(e.code); audio.init(); }
    }
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat && ui.shown !== "hud" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); goOrRestart(); }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); Object.keys(touch).forEach((k) => touch[k] = 0); pause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
for (const b of document.querySelectorAll(".ctl")) {
    const k = b.dataset.c;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.init(); touch[k] = 1; b.classList.add("on"); try { b.setPointerCapture(e.pointerId); } catch { } });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, () => { touch[k] = 0; b.classList.remove("on"); });
}
for (const b of document.querySelectorAll("[data-k]")) b.addEventListener("click", () => {
    audio.init(); audio.ui();
    const k = b.dataset.k; save.prefs[k] = k === "laps" ? +b.dataset.v : b.dataset.v; persist(); ui.prefs();
});
$("play").addEventListener("click", () => startRace());
$("again").addEventListener("click", () => goOrRestart());
$("resume").addEventListener("click", () => { audio.init(); resume(); });
$("restart").addEventListener("click", () => startRace());
$("quit").addEventListener("click", () => toMenu());
$("menu").addEventListener("click", () => toMenu());
$("pause").addEventListener("click", () => { audio.init(); audio.ui(); state === "paused" ? resume() : pause(); });
$("mute").addEventListener("click", () => { audio.init(); audio.toggleMute(); ui.mute(); });
$("cam").addEventListener("click", () => { audio.init(); cycleCam(); });
$("share").addEventListener("click", async () => {
    audio.init(); audio.ui();
    const pos = results ? results.findIndex((r) => r.me) + 1 : 0;
    const url = location.origin + location.pathname, text = `I finished P${pos} in Grand Prix 3D${player.best ? ` with a ${fmt(player.best)} best lap` : ""}! Can you beat it?`;
    try { if (navigator.share) await navigator.share({ title: "Grand Prix 3D", text, url }); else { await navigator.clipboard.writeText(`${text} ${url}`); ui.toast("Link copied"); } } catch { }
});

// ------------------------------------------------------------------ loop

demo();
if (AUTO) { setupRace(false); state = "grid"; ui.show("hud"); } else ui.show("title");
window.__gp = () => ({ state, lap: Math.floor(player.prog / L) + 1, pos: standings().indexOf(player) + 1, prog: Math.round(player.prog), v: +Math.hypot(player.vx, player.vy).toFixed(1), off: +player.off.toFixed(2), slip: +player.slip.toFixed(2), drift: +player.drift.toFixed(2), surf: player.surf, t: +raceTime.toFixed(2), best: player.best, rivals: rivals.map((c) => Math.round(c.prog)) });
window.__gpInput = (o) => Object.assign(touch, o);
let last = performance.now();
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    readInput(); easeSteer(dt);
    update(dt);
    render(dt);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
