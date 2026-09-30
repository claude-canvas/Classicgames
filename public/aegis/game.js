// Aegis - guard a tiny world from the falling sky. Built on the Space projection library:
// Space's orbit camera (alpha, beta, Rc around X0/Y0/Z0) circles the planet, and its
// reDraw() renders every frame twice - once solid, once as an additive glow pass.
import Space from "./Space.js";
import { buildShaders } from "./shaders.js";
import * as sfx from "./audio.js";

const $ = (id) => document.getElementById(id);
function fail(msg) {
    const e = $("err");
    e.textContent = msg;
    e.hidden = false;
    throw new Error(msg);
}

// ------------------------------------------------------------------ small vector helpers

const TAU = Math.PI * 2;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function randDir() { const u = rand(-1, 1), t = rand(0, TAU), q = Math.sqrt(1 - u * u); return [q * Math.cos(t), q * Math.sin(t), u]; }
function basis(n) {
    const a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t1 = norm3(cross3(a, n));
    return [t1, cross3(n, t1)];
}

// ------------------------------------------------------------------ constants

const P = 10;                                    // planet radius (matches the shader)
const SUN = norm3([0.8, -0.3, 0.5]);
const CITY_HP = 3;
const NOVA_KILLS = 10;
const MAXV = 60000, MAXA = 60000;

// ------------------------------------------------------------------ WebGL + Space

const canvas = $("view");
const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" });
if (!gl) fail("WebGL isn't available in this browser.\nOpen the game in Chrome or Firefox with hardware acceleration turned on.");
const deriv = !!gl.getExtension("OES_standard_derivatives");

// Space binds Z, Q and P to debug zoom/depth tweaks; keep those keys from reaching it.
window.addEventListener("keydown", (e) => {
    if (e.code === "KeyZ" || e.code === "KeyQ" || e.code === "KeyP") e.stopPropagation();
}, true);

const space = new Space(gl);
const { VERT, FRAG } = buildShaders(deriv);

function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "compile failed");
    return s;
}
const program = gl.createProgram();
try {
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos");
    gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
} catch (err) {
    fail("The game's shader didn't compile on this device:\n\n" + err.message);
}
const U = (name) => gl.getUniformLocation(program, name);
Object.assign(space, {
    program,
    cPointLoc: U("cPoint"), vPointLoc: U("vPoint"),
    xAxisLoc: U("xAxis"), yAxisLoc: U("yAxis"), zAxisLoc: U("zAxis"),
    varsLocation: U("veriables"),
});
gl.useProgram(program);
gl.uniform3fv(space.varsLocation, new Float32Array([space.zShifter, space.magnifier, 0]));
const loc = {
    aspect: U("uAspect"), cloud: U("uCloud"),
    sun: U("fSun"), time: U("fTime"), flash: U("fFlash"), nova: U("fNova"),
};
gl.uniform3fv(loc.sun, new Float32Array(SUN));

// ------------------------------------------------------------------ camera (Space's orbit)

const cam = { alpha: Math.atan2(SUN[1], SUN[0]) - 0.75, beta: 0.32, rc: 44, va: 0, vb: 0, shake: 0, lift: 0 };

function placeCamera() {
    cam.beta = clamp(cam.beta, -1.25, 1.25);
    cam.rc = clamp(cam.rc, 26, 80);
    const s = cam.shake;
    // on tall screens the menus sit low, so raise the planet above them
    const up = space.yUnitVec || [0, 0, 1];
    const lift = -cam.lift;
    space.X0 = (Math.random() - 0.5) * s + up[0] * lift;
    space.Y0 = (Math.random() - 0.5) * s + up[1] * lift;
    space.Z0 = (Math.random() - 0.5) * s + up[2] * lift;
    space.alpha = cam.alpha;
    space.beta = cam.beta;
    space.Rc = cam.rc;
    space.Xc = space.X0 + Math.cos(cam.beta) * Math.cos(cam.alpha) * cam.rc;
    space.Yc = space.Y0 + Math.cos(cam.beta) * Math.sin(cam.alpha) * cam.rc;
    space.Zc = space.Z0 + Math.sin(cam.beta) * cam.rc;
    space.updateMyVectors();
}
const camPos = () => [space.Xc, space.Yc, space.Zc];

// drag the world: the surface follows the finger
function orbit(dx, dy) {
    const a = cam.alpha, b = cam.beta;
    const ta = [-Math.sin(a), Math.cos(a), 0];
    const tb = [-Math.sin(b) * Math.cos(a), -Math.sin(b) * Math.sin(a), Math.cos(b)];
    const sx = Math.sign(dot3(ta, space.xUnitVec)) || 1;
    const sy = Math.sign(dot3(tb, space.yUnitVec)) || 1;
    const k = 0.0055 * (cam.rc / 44);
    const da = -dx * k * sx, db = dy * k * sy;
    cam.alpha += da;
    cam.beta += db;
    return [da, db];
}

// ------------------------------------------------------------------ canvas size

const dprScale = Math.min(window.devicePixelRatio || 1, 1.75);
let cssW = 1, cssH = 1, aspectFix = [1, 1], portrait = false;
const ui = $("ui"), ux = ui.getContext("2d");

function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dprScale);
    canvas.height = Math.round(cssH * dprScale);
    ui.width = Math.round(cssW * dprScale);
    ui.height = Math.round(cssH * dprScale);
    ux.setTransform(dprScale, 0, 0, dprScale, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Space's projection assumes a 2:1 screen; correct it for whatever shape we have
    const a = cssW / cssH;
    aspectFix = a >= 2 ? [2 / a, 1] : a >= 1 ? [1, a / 2] : [2.1, a * 1.05];
    portrait = a < 1;
    gl.uniform2fv(loc.aspect, new Float32Array(aspectFix));
}
window.addEventListener("resize", resize);
resize();

// world point -> CSS pixel (same maths as the shader); null if behind the camera
function project(p) {
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = sub3(p, camPos());
    const zp = dot3(d, Z);
    if (zp < 0.5) return null;
    const mw = (zp * 0.1) / space.magnifier;
    const nx = (dot3(d, X) / (mw * 16)) * aspectFix[0];
    const ny = (dot3(d, Y) / (mw * 8)) * aspectFix[1];
    return [(nx * 0.5 + 0.5) * cssW, (0.5 - ny * 0.5) * cssH, zp];
}
// does the segment a->b pass through the planet?
function blocked(a, b, r = P * 0.99) {
    const ab = sub3(b, a);
    const t = clamp(-dot3(a, ab) / dot3(ab, ab), 0, 1);
    if (t <= 0.001 || t >= 0.999) return false;
    return len3(add3(a, mul3(ab, t))) < r;
}

// ------------------------------------------------------------------ vertex buffers

const POS = new Float32Array(MAXV * 4), COL = new Float32Array(MAXV * 4);
let vc = 0;
function vtx(x, y, z, m, r, g, b, a = 0) {
    if (vc >= MAXV) return;
    const o = vc << 2;
    POS[o] = x; POS[o + 1] = y; POS[o + 2] = z; POS[o + 3] = m;
    COL[o] = r; COL[o + 1] = g; COL[o + 2] = b; COL[o + 3] = a;
    vc++;
}
function tri(a, b, c, m, col, al = 0) {
    vtx(a[0], a[1], a[2], m, col[0], col[1], col[2], al);
    vtx(b[0], b[1], b[2], m, col[0], col[1], col[2], al);
    vtx(c[0], c[1], c[2], m, col[0], col[1], col[2], al);
}

// additive glow pass
const APOS = new Float32Array(MAXA * 4), ACOL = new Float32Array(MAXA * 4);
let ac = 0;
function av(x, y, z, r, g, b) {
    if (ac >= MAXA) return;
    const o = ac << 2;
    APOS[o] = x; APOS[o + 1] = y; APOS[o + 2] = z; APOS[o + 3] = 5;
    ACOL[o] = r; ACOL[o + 1] = g; ACOL[o + 2] = b; ACOL[o + 3] = 1;
    ac++;
}
// soft round glow: a fan that fades to black at the rim
function glow(p, s, r, g, b) {
    if (ac + 18 > MAXA) return;
    const R = space.xUnitVec, Up = space.yUnitVec;
    for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU, a1 = ((i + 1) / 6) * TAU;
        const c0 = Math.cos(a0) * s, s0 = Math.sin(a0) * s, c1 = Math.cos(a1) * s, s1 = Math.sin(a1) * s;
        av(p[0], p[1], p[2], r, g, b);
        av(p[0] + R[0] * c0 + Up[0] * s0, p[1] + R[1] * c0 + Up[1] * s0, p[2] + R[2] * c0 + Up[2] * s0, 0, 0, 0);
        av(p[0] + R[0] * c1 + Up[0] * s1, p[1] + R[1] * c1 + Up[1] * s1, p[2] + R[2] * c1 + Up[2] * s1, 0, 0, 0);
    }
}
// glowing line with soft edges, facing the camera
function beam(a, b, w, r, g, bl) {
    const mid = mul3(add3(a, b), 0.5);
    const side = mul3(norm3(cross3(sub3(b, a), sub3(camPos(), mid))), w);
    const a1 = add3(a, side), a2 = sub3(a, side), b1 = add3(b, side), b2 = sub3(b, side);
    const q = (p0, c0, p1, c1, p2, c2) => { av(...p0, ...c0); av(...p1, ...c1); av(...p2, ...c2); };
    const k = [r, g, bl], z = [0, 0, 0];
    q(a1, z, a, k, b, k); q(a1, z, b, k, b1, z);
    q(a2, z, a, k, b, k); q(a2, z, b, k, b2, z);
}
// soft ring facing the camera
function ring(c, rad, w, r, g, b, segs = 40) {
    const R = space.xUnitVec, Up = space.yUnitVec;
    const pt = (ang, rr) => [c[0] + (R[0] * Math.cos(ang) + Up[0] * Math.sin(ang)) * rr, c[1] + (R[1] * Math.cos(ang) + Up[1] * Math.sin(ang)) * rr, c[2] + (R[2] * Math.cos(ang) + Up[2] * Math.sin(ang)) * rr];
    const k = [r, g, b], z = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
        if (ac + 12 > MAXA) return;
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        for (const [ri, ro] of [[rad - w, rad], [rad + w, rad]]) {
            const p0 = pt(a0, ri), p1 = pt(a1, ri), p2 = pt(a1, ro), p3 = pt(a0, ro);
            av(...p0, ...z); av(...p1, ...z); av(...p2, ...k);
            av(...p0, ...z); av(...p2, ...k); av(...p3, ...k);
        }
    }
}

// ------------------------------------------------------------------ procedural planet

function ihash(x, y, z, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const L = (a, b, t) => a + (b - a) * t;
    const h = (i, j, k) => ihash(xi + i, yi + j, zi + k, s);
    return L(L(L(h(0, 0, 0), h(1, 0, 0), fx), L(h(0, 1, 0), h(1, 1, 0), fx), fy),
             L(L(h(0, 0, 1), h(1, 0, 1), fx), L(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
function fbm(p, s, oct = 5, freq = 1.4) {
    let v = 0, amp = 0.5, tot = 0;
    for (let i = 0; i < oct; i++) {
        v += vnoise(p[0] * freq, p[1] * freq, p[2] * freq, s + i * 17) * amp;
        tot += amp; amp *= 0.5; freq *= 2.1;
    }
    return v / tot;
}

function icosphere(sub) {
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm3);
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) {
        const cache = new Map();
        const mid = (a, b) => {
            const key = a < b ? a * 100000 + b : b * 100000 + a;
            let i = cache.get(key);
            if (i === undefined) { i = V.length; V.push(norm3(add3(V[a], V[b]))); cache.set(key, i); }
            return i;
        };
        const NF = [];
        for (const [a, b, c] of F) {
            const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
            NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        F = NF;
    }
    return { V, F };
}

const SEED = Math.floor(Math.random() * 100000);
const sphere = icosphere(4);
const heightN = sphere.V.map((v) => fbm(v, SEED));
const sorted = heightN.slice().sort((a, b) => a - b);
const SEA = sorted[Math.floor(sorted.length * 0.58)];     // ~42% land on every planet
const TOP = sorted[sorted.length - 1];
const elev = heightN.map((n) => Math.max(0, (n - SEA) / (TOP - SEA)));
const radius = elev.map((e) => P * (1 + e * 0.075));
const vpos = sphere.V.map((v, i) => mul3(v, radius[i]));
const biome = sphere.V.map((v) => fbm(v, SEED + 999, 3, 2.2));

// cities: spread across the land, the first one facing the starting camera
const cities = [];
{
    const camDir = [Math.cos(cam.beta) * Math.cos(cam.alpha), Math.cos(cam.beta) * Math.sin(cam.alpha), Math.sin(cam.beta)];
    const cand = [];
    sphere.V.forEach((v, i) => { if (elev[i] > 0.04 && elev[i] < 0.45 && Math.abs(v[2]) < 0.78) cand.push(i); });
    if (cand.length) {
        let first = cand[0], best = -2;
        for (const i of cand) { const d = dot3(sphere.V[i], camDir) - Math.abs(dot3(sphere.V[i], SUN) - 0.35) * 0.3; if (d > best) { best = d; first = i; } }
        const picked = [first];
        while (picked.length < 5) {
            let bi = -1, bd = -1;
            for (const i of cand) {
                let md = 9;
                for (const j of picked) md = Math.min(md, len3(sub3(sphere.V[i], sphere.V[j])));
                if (md > bd) { bd = md; bi = i; }
            }
            if (bi < 0 || bd < 0.35) break;
            picked.push(bi);
        }
        for (const i of picked) cities.push(makeCity(sphere.V[i], radius[i]));
    }
    // a waterworld still needs somewhere to defend: raise islands under missing cities
    while (cities.length < 5) {
        const n = randDir();
        cities.push(makeCity(n, P * 1.02));
    }
}
function makeCity(n, r) {
    const [t1, t2] = basis(n);
    const towers = [];
    const count = 11;
    for (let i = 0; i < count; i++) {
        const ang = rand(0, TAU), d = i === 0 ? 0 : rand(0.3, 1.35);
        towers.push({ u: Math.cos(ang) * d, v: Math.sin(ang) * d, h: i === 0 ? 1.6 : rand(0.4, 1.1) * (1.25 - d * 0.4), w: rand(0.16, 0.26) });
    }
    return { n, r: r - 0.05, t1, t2, towers, hp: CITY_HP, pos: mul3(n, r), smoke: 0 };
}

// faces: flat colours, low-poly look
const FACE_N = sphere.F.length;
const faceCenter = new Array(FACE_N), faceAlb = new Array(FACE_N), faceAlb0 = new Array(FACE_N);
const faceLight = new Float32Array(FACE_N), faceBase = new Float32Array(FACE_N), faceScar = new Float32Array(FACE_N).fill(1);
function cityLightAt(c) {
    let l = 0;
    for (const ci of cities) if (ci.hp > 0) { const d = len3(sub3(c, ci.pos)); l += Math.exp(-(d * d) / 3.2) * (0.5 + 0.5 * ci.hp / CITY_HP); }
    return Math.min(l, 1.2);
}
sphere.F.forEach(([a, b, c], k) => {
    const e = (elev[a] + elev[b] + elev[c]) / 3;
    const n = (heightN[a] + heightN[b] + heightN[c]) / 3;
    const bio = (biome[a] + biome[b] + biome[c]) / 3;
    const cen = mul3(add3(add3(vpos[a], vpos[b]), vpos[c]), 1 / 3);
    const lat = Math.abs(norm3(cen)[2]);
    const jit = ihash(k, 7, 3, SEED) * 0.08 - 0.04;
    let col, light = 0;
    const ocean = elev[a] === 0 && elev[b] === 0 && elev[c] === 0;
    if (lat > 0.9 - jit || (ocean && lat > 0.84)) col = [0.86 + jit, 0.9 + jit, 0.96];
    else if (ocean) {
        const t = clamp((n - (SEA - 0.12)) / 0.12, 0, 1);
        col = [0.015 + t * 0.04, 0.07 + t * 0.2 + jit * 0.3, 0.2 + t * 0.22];
    } else if (e < 0.06) col = [0.74 + jit, 0.68 + jit, 0.48];
    else if (e < 0.42) {
        col = bio > 0.58 ? [0.62 + jit, 0.5 + jit, 0.28] : bio < 0.42 ? [0.1, 0.3 + jit, 0.13] : [0.2 + jit, 0.46 + jit, 0.17];
        light = ihash(k, 1, 9, SEED) > 0.9 ? 0.22 : 0;
    } else if (e < 0.72) col = [0.36 + jit, 0.33 + jit, 0.3 + jit];
    else col = [0.9, 0.92, 0.97];
    faceCenter[k] = cen;
    faceAlb[k] = col;
    faceAlb0[k] = col;
    faceBase[k] = ocean ? -1 : light;
    faceLight[k] = ocean ? -1 : light + cityLightAt(cen);
});

// ------------------------------------------------------------------ static geometry (sky, planet, clouds)

let PLANET_START = 0, STATIC_V = 0;
function buildStatic() {
    vc = 0;
    // sky quad (the vertex shader places it straight in clip space)
    vtx(-1, -1, 0, 3, 0, 0, 0); vtx(1, -1, 0, 3, 0, 0, 0); vtx(1, 1, 0, 3, 0, 0, 0);
    vtx(-1, -1, 0, 3, 0, 0, 0); vtx(1, 1, 0, 3, 0, 0, 0); vtx(-1, 1, 0, 3, 0, 0, 0);
    PLANET_START = vc;
    sphere.F.forEach(([a, b, c], k) => tri(vpos[a], vpos[b], vpos[c], 2, faceAlb[k], faceLight[k]));
    STATIC_V = vc;
}

// clouds live at the start of the additive buffer: translucent haze, lit in the shader
let ADD_STATIC = 0;
function buildClouds() {
    ac = 0;
    const cs = icosphere(4);
    const put = (v, r, g) => {
        const o = ac << 2;
        APOS[o] = v[0] * r; APOS[o + 1] = v[1] * r; APOS[o + 2] = v[2] * r; APOS[o + 3] = 6;
        ACOL[o] = g; ACOL[o + 1] = g; ACOL[o + 2] = g; ACOL[o + 3] = 1;
        ac++;
    };
    cs.F.forEach(([a, b, c]) => {
        const cen = norm3(add3(add3(cs.V[a], cs.V[b]), cs.V[c]));
        const n = fbm(cen, SEED + 555, 4, 2.0);
        if (n < 0.58) return;
        const g = clamp((n - 0.58) * 5, 0.25, 1);
        const r = P * 1.07;
        put(cs.V[a], r, g); put(cs.V[b], r, g); put(cs.V[c], r, g);
    });
    ADD_STATIC = ac;
}
buildClouds();
buildStatic();

function setFace(k, col, light) {
    faceAlb[k] = col; faceLight[k] = light;
    for (let j = 0; j < 3; j++) {
        const o = (PLANET_START + k * 3 + j) << 2;
        COL[o] = col[0]; COL[o + 1] = col[1]; COL[o + 2] = col[2]; COL[o + 3] = light;
    }
}
function scorch(p, rad) {
    for (let k = 0; k < FACE_N; k++) {
        const d = len3(sub3(faceCenter[k], p));
        if (d > rad) continue;
        const f = 0.25 + 0.55 * (d / rad);
        const c = faceAlb[k];
        faceScar[k] *= f;
        setFace(k, [c[0] * f + 0.03 * (1 - f), c[1] * f, c[2] * f], faceLight[k] < 0 ? -1 : faceLight[k] * f);
    }
}
function relight() {
    for (let k = 0; k < FACE_N; k++) {
        if (faceBase[k] < 0) continue;
        setFace(k, faceAlb[k], (faceBase[k] + cityLightAt(faceCenter[k])) * faceScar[k]);
    }
}

// ------------------------------------------------------------------ meshes drawn each frame

// jagged rock: an icosahedron with pushed-around corners
const ICO = icosphere(0);
function rockShape() { return ICO.V.map((v) => mul3(v, rand(0.72, 1.18))); }

function rotate(v, axis, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), d = dot3(axis, v), cr = cross3(axis, v);
    return [v[0] * c + cr[0] * s + axis[0] * d * (1 - c), v[1] * c + cr[1] * s + axis[1] * d * (1 - c), v[2] * c + cr[2] * s + axis[2] * d * (1 - c)];
}

function box(c, ax, ay, az, col, a = 0) {
    const p = (i, j, k) => [c[0] + ax[0] * i + ay[0] * j + az[0] * k, c[1] + ax[1] * i + ay[1] * j + az[1] * k, c[2] + ax[2] * i + ay[2] * j + az[2] * k];
    const q = (p0, p1, p2, p3) => { tri(p0, p1, p2, 4, col, a); tri(p0, p2, p3, 4, col, a); };
    q(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
    q(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
    q(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
    q(p(1, 1, -1), p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1));
    q(p(-1, 1, -1), p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1));
}

// ------------------------------------------------------------------ game state

const S = {
    mode: "title", time: 0, score: 0, best: 0,
    wave: 0, toSpawn: 0, spawnT: 0, rest: 0,
    combo: 0, comboT: 0, kills: 0, nova: 0, novaR: -1,
    flash: 0, cloud: 0, idle: 0,
};
let meteors = [], parts = [], beams = [], rings = [], overT = 0;
try { S.best = +localStorage.getItem("aegis.best") || 0; } catch { S.best = 0; }
try { sfx.setMuted(localStorage.getItem("aegis.muted") === "1"); } catch { /* storage blocked */ }

// three sentinel satellites on tilted orbits; they fire the lasers
const sentinels = [0, 1, 2].map((i) => ({ r: 15 + i * 1.6, inc: [0.35, -0.9, 1.3][i], node: i * 2.1, ph: i * 2.4, sp: 0.32 - i * 0.05, fire: 0 }));
function sentinelPos(s) {
    const a = s.ph;
    const p = [Math.cos(a) * s.r, Math.sin(a) * s.r * Math.cos(s.inc), Math.sin(a) * s.r * Math.sin(s.inc)];
    const c = Math.cos(s.node), sn = Math.sin(s.node);
    return [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c, p[2]];
}

function aliveCities() { return cities.filter((c) => c.hp > 0); }

// ------------------------------------------------------------------ waves and meteors

function startWave() {
    S.wave++;
    S.toSpawn = 5 + S.wave * 3;
    S.spawnT = 1.2;
    banner(`Wave ${S.wave}`, S.wave === 1 ? "Tap the meteors" : WAVE_NAMES[(S.wave - 2) % WAVE_NAMES.length]);
    sfx.wave();
}
const WAVE_NAMES = ["Heavier rocks", "They come faster", "Storm season", "Shattered sky", "The long night", "Starfall", "No rest"];

function spawnMeteor(attract = false) {
    const w = Math.max(1, S.wave);
    let kind = "rock";
    const r = Math.random();
    if (!attract) {
        if (w >= 3 && r < 0.05 && aliveCities().some((c) => c.hp < CITY_HP)) kind = "crystal";
        else if (w >= 2 && r < 0.12) kind = "comet";
        else if (w >= 2 && r < 0.12 + Math.min(0.04 * w, 0.28)) kind = "big";
        else if (w >= 3 && r < 0.3 + Math.min(0.04 * w, 0.25)) kind = "fast";
    }
    // aim: usually at a city, sometimes anywhere
    const alive = aliveCities();
    let target;
    if (alive.length && Math.random() < 0.65) {
        const c = alive[Math.floor(Math.random() * alive.length)];
        target = norm3(add3(c.n, mul3(randDir(), 0.12)));
    } else target = randDir();
    const start = norm3(add3(target, mul3(randDir(), 1.1)));
    const dist = rand(85, 100);
    const p = mul3(start, dist);
    const tp = mul3(target, P);
    const size = kind === "big" ? rand(1.6, 1.9) : kind === "fast" ? rand(0.55, 0.7) : kind === "comet" ? 0.7 : kind === "crystal" ? 0.85 : rand(0.85, 1.15);
    let speed = 5.2 + w * 0.65 + rand(-0.6, 0.6);
    if (kind === "big") speed *= 0.72;
    if (kind === "fast" || kind === "comet") speed *= 1.65;
    if (attract) speed = 7;
    meteors.push({
        kind, p, v: mul3(norm3(sub3(tp, p)), speed), s: size,
        hp: kind === "big" ? 3 : 1, shape: rockShape(), axis: randDir(), ang: 0, spin: rand(0.6, 2.2),
        hitT: 0, attract,
    });
}

function burst(p, n, col, spd, life, size) {
    for (let i = 0; i < n; i++) {
        const d = randDir(), s = rand(0.2, 1) * spd;
        parts.push({ p: p.slice(), v: mul3(d, s), life: rand(0.5, 1) * life, max: life, c: col, s: size * rand(0.6, 1.3), drag: 0.94 });
    }
}

const KIND_COL = { rock: [1, 0.55, 0.2], big: [1, 0.4, 0.15], fast: [1, 0.75, 0.35], comet: [1, 0.85, 0.3], crystal: [0.3, 0.95, 1] };

function destroy(m, byNova = false) {
    m.dead = true;
    const col = KIND_COL[m.kind];
    burst(m.p, m.kind === "big" ? 60 : 32, col, 9 * m.s, 0.9, 0.9 * m.s);
    burst(m.p, 14, [0.6, 0.6, 0.65], 6 * m.s, 1.2, 0.5 * m.s);
    rings.push({ p: m.p.slice(), r: 0.5, max: 4 * m.s, t: 0, life: 0.45, c: col });
    sfx.boom(m.kind === "big");
    if (m.attract) return;
    const now = S.time;
    S.combo = now - S.comboT < 1.4 ? S.combo + 1 : 1;
    S.comboT = now;
    const mult = Math.min(S.combo, 6);
    const base = m.kind === "big" ? 250 : m.kind === "comet" ? 300 : m.kind === "fast" ? 150 : m.kind === "crystal" ? 200 : 100;
    const pts = base * mult;
    S.score += pts;
    S.kills++;
    pop(`+${pts}${mult > 1 ? `  x${mult}` : ""}`, m.p, m.kind === "comet" ? "gold" : "");
    if (!byNova) {
        const before = S.nova;
        S.nova = Math.min(1, S.nova + (m.kind === "comet" ? 0.35 : 1 / NOVA_KILLS));
        if (before < 1 && S.nova >= 1) { sfx.charged(); pop("NOVA READY", [0, 0, P * 1.3], "gold"); }
    }
    if (m.kind === "crystal") {
        const hurt = aliveCities().filter((c) => c.hp < CITY_HP).sort((a, b) => a.hp - b.hp)[0];
        if (hurt) { hurt.hp++; relight(); pop("CITY REPAIRED", hurt.pos, "cyan"); sfx.repair(); burst(hurt.pos, 30, [0.3, 1, 0.9], 4, 1.2, 0.35); }
    }
    if (m.kind === "big") {
        // it splits into three fast shards
        for (let i = 0; i < 3; i++) {
            const d = norm3(add3(norm3(m.v), mul3(randDir(), 0.6)));
            meteors.push({
                kind: "fast", p: add3(m.p, mul3(randDir(), 0.8)), v: mul3(d, len3(m.v) * 1.5), s: 0.55,
                hp: 1, shape: rockShape(), axis: randDir(), ang: 0, spin: 3, hitT: 0,
            });
        }
    }
}

function shoot(m) {
    // the nearest satellite with a clear line of sight takes the shot
    let best = null, bd = 1e9;
    for (const s of sentinels) {
        const sp = sentinelPos(s);
        const d = len3(sub3(sp, m.p)) + (blocked(sp, m.p) ? 1000 : 0);
        if (d < bd) { bd = d; best = s; }
    }
    const from = best ? sentinelPos(best) : mul3(norm3(m.p), P);
    if (best) best.fire = 0.25;
    beams.push({ a: from, b: m.p.slice(), t: 0.16, c: m.kind === "crystal" ? [0.4, 1, 1] : [0.55, 0.9, 1] });
    sfx.zap(S.combo);
    m.hp--;
    if (m.hp <= 0) destroy(m);
    else {
        m.hitT = 0.15;
        m.v = mul3(m.v, 0.55);
        burst(m.p, 12, [1, 0.8, 0.5], 5, 0.5, 0.35);
        sfx.tink();
    }
}

function impact(m) {
    m.dead = true;
    const n = norm3(m.p);
    const hitP = mul3(n, P * 1.01);
    const big = m.kind === "big";
    burst(hitP, big ? 90 : 55, [1, 0.5, 0.15], 7 * m.s, 1.4, 1.1 * m.s);
    burst(hitP, 30, [0.5, 0.45, 0.4], 3.5, 2.2, 0.8 * m.s);
    rings.push({ p: hitP, r: 0.5, max: (big ? 7 : 4.5) * m.s, t: 0, life: 0.8, c: [1, 0.55, 0.2] });
    scorch(hitP, (big ? 2.6 : 1.7) * m.s);
    cam.shake = big ? 1.3 : 0.7;
    sfx.impact();
    if (m.attract) return;
    S.combo = 0;
    for (const c of cities) {
        if (c.hp <= 0) continue;
        if (len3(sub3(c.pos, hitP)) < 2.6 + m.s) {
            c.hp -= big ? 2 : 1;
            S.flash = 1;
            flashScreen();
            if (c.hp <= 0) { c.hp = 0; pop("CITY LOST", c.pos, "red"); sfx.cityLost(); }
            else pop("CITY HIT", c.pos, "red");
            relight();
        }
    }
    if (!aliveCities().length) {
        S.mode = "dying";
        overT = 2.2;
    }
}

function fireNova() {
    if (S.mode !== "play" || S.nova < 1) return;
    S.nova = 0;
    S.novaR = P;
    sfx.nova();
    cam.shake = 0.8;
}

// ------------------------------------------------------------------ HUD helpers

const popsEl = $("pops");
function pop(text, p, cls = "") {
    const s = project(p);
    if (!s) return;
    const d = document.createElement("div");
    d.className = "pop " + cls;
    d.textContent = text;
    d.style.left = clamp(s[0], 60, cssW - 60) + "px";
    d.style.top = clamp(s[1], 70, cssH - 40) + "px";
    popsEl.appendChild(d);
    setTimeout(() => d.remove(), 1100);
}
function banner(text, sub) {
    const b = $("banner");
    b.innerHTML = "";
    const t = document.createElement("strong"); t.textContent = text;
    const s = document.createElement("span"); s.textContent = sub;
    b.append(t, s);
    b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
}
function flashScreen() { const f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }

// ------------------------------------------------------------------ input

const ptrs = new Map();
let pinch = 0, dragMoved = 0, downT = 0, lastDrag = [0, 0];
const keys = new Set();

canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    sfx.unlock();
    if (ptrs.size === 1) { dragMoved = 0; downT = performance.now(); cam.va = 0; cam.vb = 0; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); dragMoved = 99; }
    S.idle = 0;
});
canvas.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) cam.rc *= pinch / d;
        pinch = d;
        return;
    }
    dragMoved = Math.max(dragMoved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
    if (dragMoved > 7) lastDrag = orbit(dx, dy);
    S.idle = 0;
});
function lift(e) {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!p) return;
    if (ptrs.size === 0) {
        if (dragMoved <= 7 && performance.now() - downT < 450) tap(e.clientX, e.clientY);
        else if (dragMoved > 7) { cam.va = lastDrag[0] * 60; cam.vb = lastDrag[1] * 60; }
        lastDrag = [0, 0];
    }
    if (ptrs.size < 2) pinch = 0;
}
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); pinch = 0; });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.rc *= Math.exp(e.deltaY * 0.001); }, { passive: false });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"].includes(e.code)) { keys.add(e.code); e.preventDefault(); }
    if (e.code === "Space") { e.preventDefault(); if (S.mode === "play") fireNova(); else if (S.mode === "title" || S.mode === "over") start(); }
    if (e.code === "Escape" || e.code === "KeyP") { if (S.mode === "play") pause(); else if (S.mode === "pause") resume(); }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); ptrs.clear(); if (S.mode === "play") pause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && S.mode === "play") pause(); });

function tap(x, y) {
    if (S.mode !== "play") return;
    const cp = camPos();
    let best = null, bd = 1e9;
    for (const m of meteors) {
        if (m.dead || blocked(cp, m.p)) continue;
        const s = project(m.p);
        if (!s) continue;
        const e = project(add3(m.p, mul3(space.xUnitVec, m.s)));
        const rpx = e ? Math.hypot(e[0] - s[0], e[1] - s[1]) : 10;
        const d = Math.hypot(s[0] - x, s[1] - y);
        const reach = Math.max(30, rpx * 1.4 + 22);
        if (d < reach && d - rpx < bd) { bd = d - rpx; best = m; }
    }
    if (best) shoot(best);
    else tapRipple(x, y);
}
function tapRipple(x, y) {
    const d = document.createElement("div");
    d.className = "ripple";
    d.style.left = x + "px"; d.style.top = y + "px";
    popsEl.appendChild(d);
    setTimeout(() => d.remove(), 500);
}

// ------------------------------------------------------------------ update

function update(dt) {
    S.time += dt;
    S.cloud += dt * 0.025;
    S.flash = Math.max(0, S.flash - dt * 2);
    cam.shake = Math.max(0, cam.shake - dt * 2.2);
    const playing = S.mode === "play";

    // camera: keys, inertia, and a slow drift when nobody touches it
    const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    const ky = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    if (kx || ky) { orbit(-kx * 420 * dt, -ky * 420 * dt); S.idle = 0; }
    if (!ptrs.size) {
        cam.alpha += cam.va * dt; cam.beta += cam.vb * dt;
        cam.va *= Math.pow(0.06, dt); cam.vb *= Math.pow(0.06, dt);
    }
    S.idle += dt;
    const liftTo = portrait && (S.mode === "title" || S.mode === "over") ? 17 : 0;
    cam.lift += (liftTo - cam.lift) * Math.min(1, dt * 2.5);
    if (S.mode === "title" || S.mode === "over") cam.alpha += dt * 0.07;
    else if (S.idle > 6) cam.alpha += dt * 0.03 * Math.min(1, (S.idle - 6) / 3);

    for (const s of sentinels) { s.ph += s.sp * dt; s.fire = Math.max(0, s.fire - dt); }

    // waves
    if (playing) {
        if (S.toSpawn > 0) {
            S.spawnT -= dt;
            if (S.spawnT <= 0) {
                spawnMeteor();
                S.toSpawn--;
                S.spawnT = Math.max(0.5, 2.1 * Math.pow(0.9, S.wave - 1)) * rand(0.6, 1.3);
                if (S.wave >= 4 && Math.random() < 0.18) { spawnMeteor(); S.toSpawn = Math.max(0, S.toSpawn - 1); }
            }
        } else if (!meteors.some((m) => !m.dead && !m.attract)) {
            if (S.rest <= 0) {
                S.rest = 3;
                const bonus = aliveCities().reduce((t, c) => t + c.hp, 0) * 50 * S.wave;
                S.score += bonus;
                if (S.wave > 0) banner(`Wave ${S.wave} cleared`, `+${bonus.toLocaleString()} city bonus`);
            }
            S.rest -= dt;
            if (S.rest <= 0) startWave();
        }
    } else if (S.mode === "title" && meteors.length < 3 && Math.random() < dt * 0.5) spawnMeteor(true);

    // meteors
    for (const m of meteors) {
        if (m.dead) continue;
        const d = len3(m.p);
        const pull = 1 + 3 / Math.max(d - P, 2);           // a little gravity near the planet
        m.p = add3(m.p, mul3(m.v, dt * pull));
        m.ang += m.spin * dt;
        m.hitT = Math.max(0, m.hitT - dt);
        // fiery trail
        const heat = clamp(1 - (d - P) / 60, 0.25, 1);
        const col = KIND_COL[m.kind];
        if (Math.random() < 0.9) parts.push({ p: add3(m.p, mul3(randDir(), m.s * 0.3)), v: mul3(m.v, 0.05), life: 0.55, max: 0.55, c: [col[0] * heat, col[1] * heat, col[2] * heat], s: m.s * 1.1, drag: 0.9 });
        if (m.attract && d < 32 && !m.dead) shoot(m);
        if (d < P * 1.02 + m.s * 0.5) impact(m);
    }
    if (S.novaR > 0) {
        S.novaR += dt * 55;
        for (const m of meteors) if (!m.dead && len3(m.p) < S.novaR) destroy(m, true);
        if (S.novaR > 90) S.novaR = -1;
    }
    meteors = meteors.filter((m) => !m.dead);

    // burning cities smoke
    for (const c of cities) {
        if (c.hp >= CITY_HP) continue;
        c.smoke -= dt;
        if (c.smoke <= 0) {
            c.smoke = c.hp <= 0 ? 0.08 : 0.25;
            const up = c.n;
            parts.push({ p: add3(c.pos, add3(mul3(c.t1, rand(-0.6, 0.6)), mul3(c.t2, rand(-0.6, 0.6)))), v: add3(mul3(up, rand(0.8, 1.5)), mul3(randDir(), 0.2)), life: 1.6, max: 1.6, c: c.hp <= 0 ? [0.9, 0.35, 0.1] : [0.5, 0.3, 0.15], s: 0.35, drag: 0.99 });
        }
    }

    for (const p of parts) {
        p.p = add3(p.p, mul3(p.v, dt));
        p.v = mul3(p.v, Math.pow(p.drag, dt * 60));
        p.life -= dt;
    }
    parts = parts.filter((p) => p.life > 0);
    if (parts.length > 1400) parts.splice(0, parts.length - 1400);
    for (const b of beams) b.t -= dt;
    beams = beams.filter((b) => b.t > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < r.life);

    if (S.mode === "dying") {
        overT -= dt;
        if (overT <= 0) gameOver();
    }
}

// ------------------------------------------------------------------ drawing

function drawMeteors() {
    const cp = camPos();
    for (const m of meteors) {
        if (dot3(sub3(m.p, cp), space.zUnitVec) < 2) continue;
        const col = m.kind === "crystal" ? [0.3, 0.75, 0.85] : m.kind === "comet" ? [0.75, 0.6, 0.35] : [0.38, 0.33, 0.3];
        const vd = norm3(m.v);
        const w = m.shape.map((v) => add3(m.p, mul3(rotate(v, m.axis, m.ang), m.s)));
        for (const [a, b, c] of ICO.F) {
            const n = norm3(cross3(sub3(w[b], w[a]), sub3(w[c], w[a])));
            const cen = mul3(add3(add3(w[a], w[b]), w[c]), 1 / 3);
            const out = dot3(sub3(cen, m.p), n) < 0 ? -1 : 1;
            let heat = clamp(dot3(n, vd) * out, 0, 1) * 0.9;
            if (m.hitT > 0) heat = 1;
            tri(w[a], w[b], w[c], 4, col, m.kind === "crystal" ? 0.1 : heat);
        }
        const g = KIND_COL[m.kind];
        glow(m.p, m.s * (m.kind === "comet" || m.kind === "crystal" ? 3.2 : 2.2), g[0] * 0.55, g[1] * 0.55, g[2] * 0.55);
    }
}

function drawCities() {
    for (const c of cities) {
        const dead = c.hp <= 0;
        const k = dead ? 0.25 : 0.6 + 0.4 * (c.hp / CITY_HP);
        let top = null, th = 0;
        for (const t of c.towers) {
            const base = add3(mul3(c.n, c.r), add3(mul3(c.t1, t.u), mul3(c.t2, t.v)));
            const h = t.h * k;
            const cen = add3(base, mul3(c.n, h / 2));
            const col = dead ? [0.12, 0.1, 0.09] : [0.55, 0.58, 0.66];
            box(cen, mul3(c.t1, t.w), mul3(c.t2, t.w), mul3(c.n, h / 2), col, dead ? 0 : 1.75);
            if (h > th) { th = h; top = add3(base, mul3(c.n, h + 0.15)); }
        }
        if (top && !dead) {
            const pulse = 0.5 + 0.5 * Math.sin(S.time * 3 + c.pos[0]);
            const col = c.hp === CITY_HP ? [0.3, 0.9, 1] : [1, 0.3, 0.2];
            glow(top, 0.45 + 0.25 * pulse, col[0] * (0.5 + pulse * 0.5), col[1] * (0.5 + pulse * 0.5), col[2] * (0.5 + pulse * 0.5));
        }
    }
}

function drawSentinels() {
    for (const s of sentinels) {
        const p = sentinelPos(s);
        const tang = norm3(sub3(sentinelPos({ ...s, ph: s.ph + 0.01 }), p));
        const up = norm3(p);
        const side = norm3(cross3(tang, up));
        box(p, mul3(tang, 0.28), mul3(side, 0.28), mul3(up, 0.28), [0.85, 0.85, 0.9]);
        for (const sgn of [-1, 1]) {
            const pc = add3(p, mul3(side, sgn * 1.05));
            box(pc, mul3(tang, 0.34), mul3(side, 0.7), mul3(up, 0.03), [0.12, 0.22, 0.6], 1.15);
        }
        const blink = (Math.sin(S.time * 4 + s.node * 3) > 0.7 ? 1 : 0.3) + s.fire * 4;
        glow(add3(p, mul3(up, 0.35)), 0.3 + s.fire * 1.8, 0.4 * blink, 0.9 * blink, 1 * blink);
    }
}

function drawEffects() {
    const cp = camPos();
    for (const p of parts) {
        if (dot3(sub3(p.p, cp), space.zUnitVec) < 1.5) continue;
        const k = Math.max(0, p.life / p.max);
        const kk = k * k;
        glow(p.p, p.s * (0.4 + 0.6 * k), p.c[0] * kk, p.c[1] * kk, p.c[2] * kk);
    }
    for (const b of beams) {
        const k = b.t / 0.16;
        beam(b.a, b.b, 0.12 + 0.18 * k, b.c[0] * k, b.c[1] * k, b.c[2] * k);
        glow(b.b, 1.6 * k, k, k * 0.95, k * 0.8);
        glow(b.a, 0.8 * k, b.c[0] * k, b.c[1] * k, b.c[2] * k);
    }
    for (const r of rings) {
        const f = r.t / r.life;
        const k = (1 - f) * (1 - f);
        ring(r.p, r.r + (r.max - r.r) * Math.sqrt(f), 0.25 + r.max * 0.12, r.c[0] * k, r.c[1] * k, r.c[2] * k, 28);
    }
    if (S.novaR > 0) {
        const f = clamp((S.novaR - P) / 80, 0, 1);
        const k = 1 - f;
        ring([0, 0, 0], S.novaR, 2.2 + S.novaR * 0.06, 1 * k, 0.8 * k, 0.35 * k, 64);
        ring([0, 0, 0], S.novaR * 0.85, 1.2, 0.3 * k, 0.6 * k, 1 * k, 64);
    }
}

function render() {
    placeCamera();
    vc = STATIC_V;
    ac = ADD_STATIC;
    drawCities();
    drawSentinels();
    drawMeteors();
    drawEffects();

    gl.uniform1f(loc.time, S.time);
    gl.uniform1f(loc.cloud, S.cloud);
    gl.uniform1f(loc.flash, S.flash * 0.25);
    gl.uniform1f(loc.nova, S.novaR > 0 ? Math.max(0, 1 - (S.novaR - P) / 40) * 0.35 : 0);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // pass 1: solid world
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    space.posArr = POS.subarray(0, vc * 4);
    space.colArr = COL.subarray(0, vc * 4);
    space.totalVert = vc;
    space.reDraw();
    // pass 2: additive glow (depth-tested, but not written)
    if (ac) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthMask(false);
        space.posArr = APOS.subarray(0, ac * 4);
        space.colArr = ACOL.subarray(0, ac * 4);
        space.totalVert = ac;
        space.reDraw();
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }
    // Space.js redraws on every keypress; leave it nothing to draw between our frames
    space.totalVert = 0;
    drawOverlay();
}

// 2D overlay: warnings for meteors you can't see, target brackets for close ones
function drawOverlay() {
    ux.clearRect(0, 0, cssW, cssH);
    if (S.mode !== "play" && S.mode !== "dying") return;
    const cp = camPos();
    const cx = cssW / 2, cy = cssH / 2;
    const ex = cssW / 2 - 26, ey = cssH / 2 - 26;
    for (const m of meteors) {
        if (m.dead) continue;
        const alt = len3(m.p) - P;
        const urgent = clamp(1 - alt / 70, 0, 1);
        const s = project(m.p);
        const onScreen = s && s[0] > 8 && s[0] < cssW - 8 && s[1] > 8 && s[1] < cssH - 8;
        const hidden = blocked(cp, m.p);
        const red = `rgba(255, ${Math.round(120 - urgent * 90)}, ${Math.round(90 - urgent * 60)}, `;
        if (onScreen && !hidden) {
            if (alt < 30) {
                const r = 14 + m.s * 6 + (1 - urgent) * 10;
                const blink = alt < 12 ? (Math.sin(S.time * 18) > 0 ? 1 : 0.35) : 0.8;
                ux.strokeStyle = red + blink + ")";
                ux.lineWidth = 2;
                for (let i = 0; i < 4; i++) {
                    const a = i * Math.PI / 2 + Math.PI / 4 + S.time;
                    ux.beginPath();
                    ux.arc(s[0], s[1], r, a - 0.35, a + 0.35);
                    ux.stroke();
                }
            }
            continue;
        }
        if (onScreen && hidden) {
            // behind the planet: a hollow pulse where it would be
            const pr = 8 + 4 * Math.sin(S.time * 6);
            ux.strokeStyle = red + (0.35 + 0.5 * urgent) + ")";
            ux.lineWidth = 1.5;
            ux.setLineDash([3, 4]);
            ux.beginPath(); ux.arc(s[0], s[1], pr + 6, 0, TAU); ux.stroke();
            ux.setLineDash([]);
            continue;
        }
        // off screen: an arrow on the edge pointing toward it
        const d = sub3(m.p, cp);
        let dx = dot3(d, space.xUnitVec) * aspectFix[0], dy = -dot3(d, space.yUnitVec) * aspectFix[1] * 2;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const t = 1 / Math.max(Math.abs(dx) / ex, Math.abs(dy) / ey);
        const x = cx + dx * t, y = cy + dy * t;
        const size = 8 + urgent * 9;
        const ang = Math.atan2(dy, dx);
        ux.save();
        ux.translate(x, y);
        ux.rotate(ang);
        ux.fillStyle = red + (0.45 + 0.55 * urgent) + ")";
        ux.beginPath();
        ux.moveTo(size, 0); ux.lineTo(-size * 0.6, size * 0.7); ux.lineTo(-size * 0.25, 0); ux.lineTo(-size * 0.6, -size * 0.7);
        ux.closePath(); ux.fill();
        ux.restore();
    }
}

// ------------------------------------------------------------------ screens and HUD

const el = {
    hud: $("hud"), score: $("score"), wave: $("wave"), combo: $("combo"), cities: $("cities"),
    novaBtn: $("novaBtn"), title: $("title"), over: $("over"), pause: $("pause"),
    finalScore: $("finalScore"), finalNote: $("finalNote"), statWave: $("statWave"), statKills: $("statKills"),
    bestLine: $("bestLine"), muteBtn: $("muteBtn"),
};
let hs = -1, hw = -1, hc = "", hcity = "", hn = -1;
function updateHud() {
    if (S.score !== hs) { hs = S.score; el.score.textContent = S.score.toLocaleString(); }
    if (S.wave !== hw) { hw = S.wave; el.wave.textContent = `Wave ${S.wave}`; }
    const comboOn = S.combo > 1 && S.time - S.comboT < 1.4;
    const ct = comboOn ? `x${Math.min(S.combo, 6)} chain` : "";
    if (ct !== hc) { hc = ct; el.combo.textContent = ct; if (ct) { el.combo.classList.remove("bump"); void el.combo.offsetWidth; el.combo.classList.add("bump"); } }
    const cs = cities.map((c) => c.hp).join(",");
    if (cs !== hcity) {
        hcity = cs;
        el.cities.innerHTML = "";
        for (const c of cities) {
            const b = document.createElement("b");
            b.className = c.hp <= 0 ? "lost" : c.hp < CITY_HP ? "hurt" : "";
            el.cities.appendChild(b);
        }
        el.cities.setAttribute("aria-label", `${aliveCities().length} of ${cities.length} cities standing`);
    }
    const n = Math.round(S.nova * 100);
    if (n !== hn) {
        hn = n;
        el.novaBtn.style.setProperty("--charge", `${n}%`);
        el.novaBtn.classList.toggle("ready", S.nova >= 1);
        el.novaBtn.setAttribute("aria-label", S.nova >= 1 ? "Fire nova" : `Nova charging, ${n} percent`);
    }
}

function show(screen, on) { screen.classList.toggle("hidden", !on); screen.inert = !on; }
function showBest() { if (S.best > 0) { el.bestLine.hidden = false; el.bestLine.textContent = `Best: ${S.best.toLocaleString()}`; } }

let firstGame = true;
function start() {
    sfx.unlock();
    if (!firstGame) {
        // a fresh day on the same world: rebuild the cities and wipe the scars
        for (const c of cities) { c.hp = CITY_HP; c.smoke = 0; }
        for (let k = 0; k < FACE_N; k++) { faceAlb[k] = faceAlb0[k]; faceScar[k] = 1; }
        buildStatic();
        relight();
    }
    firstGame = false;
    meteors = []; parts = []; beams = []; rings = [];
    Object.assign(S, { mode: "play", score: 0, wave: 0, toSpawn: 0, spawnT: 0, rest: 1.2, combo: 0, comboT: 0, kills: 0, nova: 0, novaR: -1, flash: 0, idle: 0 });
    hs = -1; hw = -1; hcity = ""; hn = -1;
    show(el.title, false); show(el.over, false); show(el.pause, false);
    el.hud.classList.add("on");
    sfx.ambience(true);
}

function gameOver() {
    S.mode = "over";
    const isBest = S.score > S.best;
    if (isBest) { S.best = S.score; try { localStorage.setItem("aegis.best", String(S.score)); } catch { /* ignore */ } }
    el.finalScore.textContent = S.score.toLocaleString();
    el.finalNote.textContent = isBest ? "New best defence!" : `Best: ${S.best.toLocaleString()}`;
    el.statWave.textContent = S.wave;
    el.statKills.textContent = S.kills;
    el.hud.classList.remove("on");
    show(el.over, true);
    sfx.ambience(false);
    $("againBtn").focus();
}
function pause() {
    if (S.mode !== "play") return;
    S.mode = "pause";
    show(el.pause, true);
    $("resumeBtn").focus();
}
function resume() {
    if (S.mode !== "pause") return;
    S.mode = "play";
    show(el.pause, false);
    last = performance.now();
}

$("playBtn").addEventListener("click", start);
$("againBtn").addEventListener("click", start);
$("resumeBtn").addEventListener("click", resume);
$("pauseBtn").addEventListener("click", pause);
el.novaBtn.addEventListener("click", fireNova);
function syncMute() {
    const m = sfx.isMuted();
    el.muteBtn.setAttribute("aria-pressed", String(m));
    el.muteBtn.setAttribute("aria-label", m ? "Unmute sound" : "Mute sound");
}
el.muteBtn.addEventListener("click", () => {
    sfx.unlock();
    sfx.setMuted(!sfx.isMuted());
    try { localStorage.setItem("aegis.muted", sfx.isMuted() ? "1" : "0"); } catch { /* ignore */ }
    syncMute();
});
syncMute();
showBest();

// ------------------------------------------------------------------ main loop

let last = performance.now();
function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (S.mode !== "pause") update(dt);
    render();
    if (S.mode === "play" || S.mode === "dying") updateHud();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

