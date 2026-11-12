// Spire - stack glowing glass slabs into the sky. Built on the Space projection library:
// Space's orbit camera (alpha, beta, Rc around X0/Y0/Z0) frames the tower as it climbs, and its
// reDraw() renders every frame twice - once solid, once as an additive glow pass.
import Space from './Space.js';
import { buildShaders } from './shaders.js';
import * as sfx from './audio.js';
import { H, BASE, resolveDrop } from './rules.js';

const $ = (id) => document.getElementById(id);
function fail(msg) {
    const e = $('err');
    e.textContent = msg;
    e.hidden = false;
    throw new Error(msg);
}

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const smooth = (t) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ constants

const MAXV = 48000, MAXA = 30000;
const SLIDE = 9;                       // how far the sliding block swings either side of the tower
const CLOUD_Z = -8;                    // height of the cloud tops (matches the shader uniform)
const A0 = -Math.PI / 4;               // the camera's heading while you play
const MAT_SLAB = 1, MAT_SKY = 3, MAT_GLOW = 5;
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const KEY = unit([Math.cos(A0 - 0.9) * 0.7, Math.sin(A0 - 0.9) * 0.7, 0.72]);          // key light, from the front-left
const SUN = unit([Math.cos(A0 + Math.PI) * 0.98, Math.sin(A0 + Math.PI) * 0.98, 0.2]);  // low sun, behind the tower
const MOON = unit([Math.cos(A0 + Math.PI + 0.55) * 0.87, Math.sin(A0 + Math.PI + 0.55) * 0.87, 0.52]);

// ------------------------------------------------------------------ WebGL + Space

const canvas = $('view');
const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
if (!gl) fail('WebGL isn' + 't available in this browser.' + String.fromCharCode(10) + 'Open the game in Chrome or Firefox with hardware acceleration turned on.');

// Space binds Z, Q and P to debug zoom/depth tweaks; the key handler below keeps those from reaching it.
const space = new Space(gl);
const { VERT, FRAG } = buildShaders();

function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'compile failed');
    return s;
}
const program = gl.createProgram();
try {
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAG));
    // keep the attribute slots Space already wired its buffers to
    gl.bindAttribLocation(program, space.posId, 'pos');
    gl.bindAttribLocation(program, space.colId, 'col');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link failed');
} catch (err) {
    fail('The game shader did not compile on this device:' + String.fromCharCode(10, 10) + err.message);
}
const U = (name) => gl.getUniformLocation(program, name);
// point Space.reDraw() at this program's uniforms
Object.assign(space, {
    program,
    cPointLoc: U('cPoint'), vPointLoc: U('vPoint'),
    xAxisLoc: U('xAxis'), yAxisLoc: U('yAxis'), zAxisLoc: U('zAxis'),
    varsLocation: U('veriables'),
});
gl.useProgram(program);
gl.uniform3fv(space.varsLocation, new Float32Array([space.zShifter, space.magnifier, 0]));
const loc = {
    aspect: U('uAspect'), cam: U('fCam'), time: U('fTime'), beat: U('fBeat'), flash: U('fFlash'),
    zen: U('fZen'), hor: U('fHor'), haze: U('fHaze'), light: U('fLight'),
    mix: U('fMix'),
};
gl.uniform3f(U('fKey'), KEY[0], KEY[1], KEY[2]);
gl.uniform3f(U('fSunDir'), SUN[0], SUN[1], SUN[2]);
gl.uniform3f(U('fMoonDir'), MOON[0], MOON[1], MOON[2]);
gl.uniform1f(U('fCloudZ'), CLOUD_Z);

// ------------------------------------------------------------------ camera (Space's orbit)

const cam = { alpha: A0, beta: 0.42, rc: 26, fx: 0, fy: 0, fz: 4, shake: 0, punch: 0 };

function placeCamera() {
    const s = cam.shake;
    space.X0 = cam.fx + (Math.random() - 0.5) * s;
    space.Y0 = cam.fy + (Math.random() - 0.5) * s;
    space.Z0 = cam.fz + (Math.random() - 0.5) * s;
    const rc = cam.rc * (1 - 0.018 * cam.punch);
    space.alpha = cam.alpha;
    space.beta = cam.beta;
    space.Rc = rc;
    space.Xc = space.X0 + Math.cos(cam.beta) * Math.cos(cam.alpha) * rc;
    space.Yc = space.Y0 + Math.cos(cam.beta) * Math.sin(cam.alpha) * rc;
    space.Zc = space.Z0 + Math.sin(cam.beta) * rc;
    space.updateMyVectors();
}

// ------------------------------------------------------------------ canvas size

let renderScale = Math.min(window.devicePixelRatio || 1, 1.5);
let cssW = 1, cssH = 1, aspectFix = [1, 1], portrait = false;

function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * renderScale);
    canvas.height = Math.round(cssH * renderScale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Space's projection assumes a 2:1 screen; correct it for whatever shape we have
    const a = cssW / cssH;
    aspectFix = a >= 2 ? [2 / a, 1] : a >= 1 ? [1, a / 2] : [2.1, a * 1.05];
    portrait = a < 1;
    gl.uniform2fv(loc.aspect, new Float32Array(aspectFix));
}
window.addEventListener('resize', resize);
resize();

// camera distance at which a half-width hw by half-height hh of the world fits the screen
const fitRc = (hw, hh) => Math.max(hw * 1.09375 * aspectFix[0], hh * 2.1875 * aspectFix[1]);

// world point -> CSS pixel (same maths as the shader); null if behind the camera
function project(x, y, z) {
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const dx = x - space.Xc, dy = y - space.Yc, dz = z - space.Zc;
    const zp = dx * Z[0] + dy * Z[1] + dz * Z[2];
    if (zp < 0.5) return null;
    const mw = (zp * 0.1) / space.magnifier;
    const nx = ((dx * X[0] + dy * X[1] + dz * X[2]) / (mw * 16)) * aspectFix[0];
    const ny = ((dx * Y[0] + dy * Y[1] + dz * Y[2]) / (mw * 8)) * aspectFix[1];
    return [(nx * 0.5 + 0.5) * cssW, (0.5 - ny * 0.5) * cssH];
}

// ------------------------------------------------------------------ vertex buffers

const POS = new Float32Array(MAXV * 4), COL = new Float32Array(MAXV * 4);
let vc = 0;
function vtx(x, y, z, w, r, g, b, a) {
    if (vc >= MAXV) return;
    const o = vc << 2;
    POS[o] = x; POS[o + 1] = y; POS[o + 2] = z; POS[o + 3] = w;
    COL[o] = r; COL[o + 1] = g; COL[o + 2] = b; COL[o + 3] = a;
    vc++;
}

// a box, optionally rotated by the 3x3 matrix R. Corner k: bit 0 = +x, bit 1 = +y, bit 2 = +z.
const K = new Float64Array(24);
const RM = new Float64Array(9);
const FACES = [[0, [4, 5, 7, 6]], [2, [1, 3, 7, 5]], [3, [2, 0, 4, 6]], [4, [3, 2, 6, 7]], [5, [0, 1, 5, 4]], [1, [0, 1, 3, 2]]];
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRI = [0, 1, 2, 0, 2, 3];

function setRot(axis, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    if (axis === 0) {          // about y: tips the slab over along x
        RM[0] = c; RM[1] = 0; RM[2] = s; RM[3] = 0; RM[4] = 1; RM[5] = 0; RM[6] = -s; RM[7] = 0; RM[8] = c;
    } else {                   // about x: tips it over along y
        RM[0] = 1; RM[1] = 0; RM[2] = 0; RM[3] = 0; RM[4] = c; RM[5] = -s; RM[6] = 0; RM[7] = s; RM[8] = c;
    }
    return RM;
}

function box(cx, cy, cz, hx, hy, hz, R, idx, glow, top, bottom) {
    if (vc + 36 > MAXV) return;
    for (let k = 0; k < 8; k++) {
        const lx = (k & 1) ? hx : -hx, ly = (k & 2) ? hy : -hy, lz = (k & 4) ? hz : -hz;
        if (R) {
            K[k * 3] = cx + R[0] * lx + R[1] * ly + R[2] * lz;
            K[k * 3 + 1] = cy + R[3] * lx + R[4] * ly + R[5] * lz;
            K[k * 3 + 2] = cz + R[6] * lx + R[7] * ly + R[8] * lz;
        } else {
            K[k * 3] = cx + lx; K[k * 3 + 1] = cy + ly; K[k * 3 + 2] = cz + lz;
        }
    }
    for (let f = 0; f < 6; f++) {
        const face = FACES[f][0];
        if ((face === 0 && !top) || (face === 1 && !bottom)) continue;
        const ids = FACES[f][1];
        const w = MAT_SLAB * 8 + face;
        for (let q = 0; q < 6; q++) {
            const j = TRI[q], k = ids[j] * 3;
            vtx(K[k], K[k + 1], K[k + 2], w, UV[j][0], UV[j][1], idx, glow);
        }
    }
}

// static geometry: the sky quad, then the stem the tower stands on (it sinks into the clouds)
function buildStatic() {
    vc = 0;
    const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 6; i++) vtx(q[i][0], q[i][1], 0, MAT_SKY * 8, 0, 0, 0, 0);
    for (let z = -15; z < 0; z += 5) box(0, 0, z + 2.5, 2.2, 2.2, 2.5, null, -1, 0, false, false);
    return vc;
}
const STATIC_V = buildStatic();

// additive glow pass
const APOS = new Float32Array(MAXA * 4), ACOL = new Float32Array(MAXA * 4);
let ac = 0;
function av(x, y, z, r, g, b) {
    if (ac >= MAXA) return;
    const o = ac << 2;
    APOS[o] = x; APOS[o + 1] = y; APOS[o + 2] = z; APOS[o + 3] = MAT_GLOW * 8;
    ACOL[o] = r; ACOL[o + 1] = g; ACOL[o + 2] = b; ACOL[o + 3] = 1;
    ac++;
}
const GC = [], GS = [];
for (let i = 0; i < 6; i++) { GC.push(Math.cos((i / 6) * TAU)); GS.push(Math.sin((i / 6) * TAU)); }
// soft round glow: a camera-facing fan that fades to black at the rim
function glowAt(x, y, z, s, r, g, b) {
    if (ac + 18 > MAXA) return;
    const Z = space.zUnitVec;
    // skip anything too close to (or behind) the camera: the projection would smear it across the screen
    if ((x - space.Xc) * Z[0] + (y - space.Yc) * Z[1] + (z - space.Zc) * Z[2] < 4) return;
    const R = space.xUnitVec, Up = space.yUnitVec;
    for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        const c0 = GC[i] * s, s0 = GS[i] * s, c1 = GC[j] * s, s1 = GS[j] * s;
        av(x, y, z, r, g, b);
        av(x + R[0] * c0 + Up[0] * s0, y + R[1] * c0 + Up[1] * s0, z + R[2] * c0 + Up[2] * s0, 0, 0, 0);
        av(x + R[0] * c1 + Up[0] * s1, y + R[1] * c1 + Up[1] * s1, z + R[2] * c1 + Up[2] * s1, 0, 0, 0);
    }
}
// a soft rectangular outline lying flat at height z, grown outward by d, with a feathered width of w each side
const CS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function rectRing(cx, cy, z, hx, hy, d, w, r, g, b) {
    if (ac + 48 > MAXA) return;
    const lv = [[Math.max(0.01, hx + d - w), Math.max(0.01, hy + d - w), 0], [hx + d, hy + d, 1], [hx + d + w, hy + d + w, 0]];
    for (let band = 0; band < 2; band++) {
        const A = lv[band], B = lv[band + 1];
        const ka = A[2], kb = B[2];
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const ax0 = cx + CS[i][0] * A[0], ay0 = cy + CS[i][1] * A[1], ax1 = cx + CS[j][0] * A[0], ay1 = cy + CS[j][1] * A[1];
            const bx0 = cx + CS[i][0] * B[0], by0 = cy + CS[i][1] * B[1], bx1 = cx + CS[j][0] * B[0], by1 = cy + CS[j][1] * B[1];
            av(ax0, ay0, z, r * ka, g * ka, b * ka); av(ax1, ay1, z, r * ka, g * ka, b * ka); av(bx1, by1, z, r * kb, g * kb, b * kb);
            av(ax0, ay0, z, r * ka, g * ka, b * ka); av(bx1, by1, z, r * kb, g * kb, b * kb); av(bx0, by0, z, r * kb, g * kb, b * kb);
        }
    }
}

// ------------------------------------------------------------------ colour and sky

// the same cosine palette as the shader, for sparks and glows
const pal = (t) => [0.56 + 0.42 * Math.cos(TAU * (t + 0.02)), 0.46 + 0.42 * Math.cos(TAU * (0.92 * t + 0.27)), 0.6 + 0.4 * Math.cos(TAU * (0.84 * t + 0.55))];

// the sky changes as the tower climbs: sunset, magenta twilight, night, aurora, deep space
const KEYS = [
    { at: 0, zen: [0.17, 0.17, 0.45], hor: [1.0, 0.6, 0.44], haze: [1.0, 0.74, 0.66], light: [1.0, 0.84, 0.66], sun: 1.0, stars: 0.0, aur: 0.0, moon: 0.0 },
    { at: 16, zen: [0.09, 0.07, 0.3], hor: [0.95, 0.34, 0.55], haze: [0.82, 0.46, 0.66], light: [1.0, 0.66, 0.76], sun: 0.7, stars: 0.25, aur: 0.0, moon: 0.0 },
    { at: 36, zen: [0.02, 0.03, 0.15], hor: [0.14, 0.22, 0.52], haze: [0.3, 0.38, 0.66], light: [0.66, 0.76, 1.0], sun: 0.0, stars: 1.0, aur: 0.0, moon: 1.0 },
    { at: 64, zen: [0.0, 0.012, 0.06], hor: [0.04, 0.3, 0.38], haze: [0.14, 0.44, 0.5], light: [0.6, 1.0, 0.9], sun: 0.0, stars: 1.0, aur: 1.0, moon: 0.7 },
    { at: 100, zen: [0.01, 0.0, 0.04], hor: [0.26, 0.1, 0.42], haze: [0.4, 0.22, 0.6], light: [0.9, 0.7, 1.0], sun: 0.0, stars: 1.0, aur: 0.6, moon: 0.5 },
];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function skyAt(alt) {
    let i = 0;
    while (i < KEYS.length - 2 && alt >= KEYS[i + 1].at) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smooth(clamp((alt - a.at) / (b.at - a.at), 0, 1));
    return {
        zen: mix3(a.zen, b.zen, t), hor: mix3(a.hor, b.hor, t), haze: mix3(a.haze, b.haze, t), light: mix3(a.light, b.light, t),
        sun: lerp(a.sun, b.sun, t), stars: lerp(a.stars, b.stars, t), aur: lerp(a.aur, b.aur, t), moon: lerp(a.moon, b.moon, t),
    };
}
let sky = skyAt(0);

// ------------------------------------------------------------------ game state

const S = { mode: 'title', paused: false, time: 0, modeT: 0, score: 0, perfects: 0, streak: 0, bestStreak: 0, best: 0, beat: 0, flash: 0, altS: 0 };
let slabs = [{ cx: 0, cy: 0, sx: BASE, sy: BASE, glow: 0 }];
let cur = null;                      // the sliding block
let debris = [], ripples = [], sparks = [], motes = [];

try { S.best = +localStorage.getItem('spire.best') || 0; } catch (e) { S.best = 0; }
try { sfx.setMuted(localStorage.getItem('spire.muted') === '1'); } catch (e) { /* storage blocked */ }

for (let i = 0; i < 64; i++) {
    motes.push({ x: rand(-24, 24), y: rand(-24, 24), z: rand(-20, 30), vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(0.2, 0.9), s: rand(0.12, 0.3), f: rand(0.8, 2.4), ph: rand(0, TAU) });
}

const el = {
    score: $('score'), scoreBox: $('scoreBox'), combo: $('combo'), hud: $('hud'),
    muteBtn: $('muteBtn'), bestLine: $('bestLine'), flash: $('flash'), pops: $('pops'),
};

function show(id, on) {
    const e = $(id);
    e.classList.toggle('hidden', !on);
    if (on) e.removeAttribute('inert'); else e.setAttribute('inert', '');
}
function updateScore() {
    el.score.textContent = S.score;
    el.scoreBox.classList.remove('bump');
    void el.scoreBox.offsetWidth;
    el.scoreBox.classList.add('bump');
    el.combo.textContent = S.streak >= 2 ? 'perfect x' + S.streak : '';
}
function showBest() {
    el.bestLine.hidden = S.best <= 0;
    el.bestLine.textContent = 'Best tower: ' + S.best + ' slabs';
}
function pop(text, cls, x, y, z) {
    const p = project(x, y, z);
    if (!p) return;
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    d.style.left = p[0] + 'px';
    d.style.top = p[1] + 'px';
    el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1200);
}
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } }

// ------------------------------------------------------------------ the sliding block

function speedFor(score) { return 5 + Math.min(score, 70) * 0.1; }

function spawnBlock() {
    const n = slabs.length, top = slabs[n - 1];
    const side = (n % 4 < 2) ? -1 : 1;
    cur = {
        axis: n % 2 === 1 ? 0 : 1, off: side * SLIDE, dir: -side, sx: top.sx, sy: top.sy,
        speed: S.mode === 'title' ? 8 : speedFor(n - 1), idx: n, glow: 0.9,
        bot: Math.random() < 0.6 ? rand(0.02, 0.18) : rand(0.5, 1.6),      // how sloppy the attract-mode player is
    };
}
function advance(dt) {
    cur.off += cur.dir * cur.speed * dt;
    if (cur.off > SLIDE) { cur.off = 2 * SLIDE - cur.off; cur.dir = -1; }
    else if (cur.off < -SLIDE) { cur.off = -2 * SLIDE - cur.off; cur.dir = 1; }
}
const CC = [0, 0];
function curCenter() {
    const t = slabs[slabs.length - 1];
    if (cur.axis === 0) { CC[0] = t.cx + cur.off; CC[1] = t.cy; } else { CC[0] = t.cx; CC[1] = t.cy + cur.off; }
    return CC;
}

// a piece of slab that has come loose and tumbles away
function addDebris(b, idx, z, axis, side, push) {
    const dir = side || (Math.random() < 0.5 ? -1 : 1);
    const a = rand(1.1, 2.3);
    debris.push({
        cx: b.cx, cy: b.cy, cz: z + H / 2, hx: b.sx / 2, hy: b.sy / 2, hz: H / 2,
        vx: axis === 0 ? dir * push : rand(-0.6, 0.6), vy: axis === 1 ? dir * push : rand(-0.6, 0.6), vz: rand(0.5, 2),
        ang: 0, w: axis === 0 ? dir * a : -dir * a, ax: axis, idx,
    });
}

// the whole tower comes down (start of a run, or the attract-mode tower getting too tall)
function collapseTower() {
    for (let i = slabs.length - 1; i >= 1; i--) {
        addDebris(slabs[i], i, i * H, Math.random() < 0.5 ? 0 : 1, Math.random() < 0.5 ? -1 : 1, rand(1.5, 5));
        debris[debris.length - 1].vz = rand(1, 4);
    }
    slabs.length = 1;
}

function burst(slab, z, col, n) {
    for (let i = 0; i < n; i++) {
        let px = slab.cx + rand(-1, 1) * slab.sx / 2, py = slab.cy + rand(-1, 1) * slab.sy / 2;
        if (Math.random() < 0.5) px = slab.cx + (Math.random() < 0.5 ? -1 : 1) * slab.sx / 2;
        else py = slab.cy + (Math.random() < 0.5 ? -1 : 1) * slab.sy / 2;
        sparks.push({
            x: px, y: py, z: z + 0.05, vx: (px - slab.cx) * 0.35 + rand(-0.8, 0.8), vy: (py - slab.cy) * 0.35 + rand(-0.8, 0.8), vz: rand(2, 6),
            t: 0, life: rand(0.7, 1.3), s: rand(0.2, 0.42), col: [col[0] * 1.1 + 0.25, col[1] * 1.1 + 0.25, col[2] * 1.1 + 0.25],
        });
    }
}

function drop(bot) {
    if (!cur) return;
    const top = slabs[slabs.length - 1];
    const res = resolveDrop(top, cur, bot ? 0 : S.streak);
    const cc = curCenter();
    if (res.kind === 'miss') {
        addDebris({ cx: cc[0], cy: cc[1], sx: cur.sx, sy: cur.sy }, cur.idx, cur.idx * H, cur.axis, cur.dir, 2.5 + cur.speed * 0.25);
        cur = null;
        if (bot) spawnBlock(); else gameOver();
        return;
    }
    const z = cur.idx * H;
    const slab = { cx: res.slab.cx, cy: res.slab.cy, sx: res.slab.sx, sy: res.slab.sy, glow: res.kind === 'perfect' ? 1 : 0.5 };
    const col = pal(cur.idx * 0.03);
    slabs.push(slab);
    if (res.piece) addDebris(res.piece, cur.idx, z, cur.axis, res.side, 1.2 + Math.abs(cur.off) * 0.35);
    S.beat = 1;
    cam.punch = 1;

    if (res.kind === 'perfect') {
        ripples.push({ cx: slab.cx, cy: slab.cy, z: z + H + 0.08, hx: slab.sx / 2, hy: slab.sy / 2, t: 0, life: res.grew ? 0.95 : 0.7, big: res.grew, col: [col[0] * 0.6 + 0.5, col[1] * 0.6 + 0.5, col[2] * 0.6 + 0.5] });
        burst(slab, z + H, col, 14 + Math.min(S.streak, 10) * 2);
        if (!bot) {
            S.streak++; S.perfects++;
            S.bestStreak = Math.max(S.bestStreak, S.streak);
            sfx.perfect(S.streak - 1);
            pop(S.streak >= 2 ? 'Perfect x' + S.streak : 'Perfect', S.streak >= 5 ? 'pink' : '', slab.cx, slab.cy, z + H + 0.5);
            if (res.grew) { sfx.grow(); pop('Wider', 'mint small', slab.cx, slab.cy, z + H - 1.6); }
            buzz(14);
        }
    } else {
        burst({ cx: cc[0], cy: cc[1], sx: slab.sx, sy: slab.sy }, z + H, col, 5);
        if (!bot) { S.streak = 0; sfx.place(); sfx.cut(); }
    }
    if (!bot) {
        S.score = slabs.length - 1;
        updateScore();
        sfx.padLevel(true, S.score);
    }
    spawnBlock();
}

function start() {
    sfx.unlock();
    sfx.start();
    collapseTower();
    slabs[0].glow = 0;
    S.score = 0; S.perfects = 0; S.streak = 0; S.bestStreak = 0;
    S.mode = 'play'; S.paused = false; S.modeT = 0;
    spawnBlock();
    updateScore();
    el.combo.textContent = '';
    show('title', false); show('over', false); show('pause', false);
    el.hud.classList.add('on');
    sfx.padLevel(true, 0);
}

function gameOver() {
    S.mode = 'dying'; S.modeT = 0;
    cam.shake = 1.4;
    S.flash = 1;
    sfx.fail();
    sfx.padLevel(false, 0);
    el.flash.classList.remove('go');
    void el.flash.offsetWidth;
    el.flash.classList.add('go');
    buzz([40, 40, 90]);
}

function showOver() {
    S.mode = 'over'; S.modeT = 0;
    const fresh = S.score > S.best;
    if (fresh) { S.best = S.score; try { localStorage.setItem('spire.best', String(S.best)); } catch (e) { /* storage blocked */ } }
    $('finalScore').textContent = S.score;
    $('finalNote').textContent = fresh ? 'A new best!' : (S.score > 0 && S.score === S.best ? 'Level with your best.' : '');
    $('statPerfect').textContent = S.perfects;
    $('statStreak').textContent = S.bestStreak;
    $('statBest').textContent = S.best;
    show('over', true);
    el.hud.classList.remove('on');
    showBest();
}

function pause() {
    if (S.mode !== 'play' || S.paused) return;
    S.paused = true;
    show('pause', true);
    sfx.padLevel(false, S.score);
}
function resume() {
    if (!S.paused) return;
    S.paused = false;
    show('pause', false);
    sfx.unlock();
    sfx.padLevel(true, S.score);
}

function tap() {
    if (S.paused) return;
    if (S.mode === 'play') drop(false);
    else if (S.mode === 'title') start();
    else if (S.mode === 'over' && S.modeT > 0.8) start();
}

// ------------------------------------------------------------------ update

function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.vz -= 34 * dt;
        d.cx += d.vx * dt; d.cy += d.vy * dt; d.cz += d.vz * dt;
        d.ang += d.w * dt;
        if (d.cz < -16) debris.splice(i, 1);       // already swallowed by the clouds
    }
}

function updateFx(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].t += dt;
        if (ripples[i].t >= ripples[i].life) ripples.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.t += dt;
        if (p.t >= p.life) { sparks.splice(i, 1); continue; }
        p.vz -= 5 * dt;
        const drag = Math.exp(-dt * 1.2);
        p.vx *= drag; p.vy *= drag;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    // motes drift up and wrap around the camera focus, so there is always a little stardust in view
    for (const m of motes) {
        m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
        if (m.x - cam.fx > 24) m.x -= 48; else if (m.x - cam.fx < -24) m.x += 48;
        if (m.y - cam.fy > 24) m.y -= 48; else if (m.y - cam.fy < -24) m.y += 48;
        if (m.z - cam.fz > 28) m.z -= 52; else if (m.z - cam.fz < -24) m.z += 52;
    }
}

function updateCamera(dt) {
    const top = slabs[slabs.length - 1];
    const topZ = slabs.length * H;
    let tA, tB, tR, tX = 0, tY = 0, tZ;
    if (S.mode === 'over') {
        // pull back and circle the finished tower
        const bottom = -9, topV = topZ + 4;
        const hh = (topV - bottom) / 2 + 2;
        const mid = (topV + bottom) / 2;
        cam.alpha += 0.2 * dt;
        tA = cam.alpha; tB = 0.34;
        tR = Math.min(portrait ? fitRc(15, hh * 1.6) : fitRc(15, hh * 1.15), 420);
        tZ = portrait ? mid - hh * 0.5 : mid;
    } else if (S.mode === 'title') {
        cam.alpha += 0.16 * dt;
        tA = cam.alpha; tB = 0.38;
        tR = fitRc(12.5, 10.5) * 1.04;
        tX = top.cx; tY = top.cy;
        tZ = topZ + (portrait ? 3.6 : 2.6);
    } else {
        tA = A0 + Math.sin(S.time * 0.25) * 0.1; tB = 0.42;
        tR = fitRc(11.5, 10.5);
        tX = top.cx; tY = top.cy;
        tZ = topZ + (portrait ? 3.4 : 2.4);
    }
    const k = 1 - Math.exp(-dt * 2.6);
    cam.alpha += wrapPi(tA - cam.alpha) * k;
    cam.beta += (tB - cam.beta) * k;
    cam.rc += (tR - cam.rc) * k;
    cam.fx += (tX - cam.fx) * k;
    cam.fy += (tY - cam.fy) * k;
    cam.fz += (tZ - cam.fz) * Math.min(1, k * 1.3);
    cam.shake *= Math.exp(-dt * 6);
    cam.punch *= Math.exp(-dt * 6);
}

function update(dt) {
    if (S.paused) return;
    S.time += dt;
    S.modeT += dt;
    S.beat = Math.max(0, S.beat - dt * 2.2);
    S.flash = Math.max(0, S.flash - dt * 1.8);
    for (let i = 0; i < slabs.length; i++) if (slabs[i].glow > 0) slabs[i].glow = Math.max(0, slabs[i].glow - dt * 1.6);
    if (cur) cur.glow += (0.28 - cur.glow) * Math.min(1, dt * 3);

    if (S.mode === 'play' && cur) {
        advance(dt);
    } else if (S.mode === 'title' && cur) {
        // attract mode: a sloppy robot stacks a tower behind the title, then lets it fall
        advance(dt);
        if (Math.abs(cur.off) <= cur.bot) drop(true);
        if (slabs.length >= 15) { collapseTower(); spawnBlock(); }
    } else if (S.mode === 'dying' && S.modeT > 1.0) {
        showOver();
    }

    // the sky follows the climb
    const target = S.mode === 'title' ? 0 : S.score;
    S.altS += (target - S.altS) * (1 - Math.exp(-dt * 1.1));
    sky = skyAt(S.altS);

    updateDebris(dt);
    updateFx(dt);
    updateCamera(dt);
}

// ------------------------------------------------------------------ draw

function drawTower() {
    const n = slabs.length;
    const from = S.mode === 'over' ? 0 : Math.max(0, Math.floor((cam.fz - 38) / H));
    for (let i = from; i < n; i++) {
        const s = slabs[i];
        box(s.cx, s.cy, i * H + H / 2, s.sx / 2, s.sy / 2, H / 2, null, i, s.glow, true, false);
    }
}

function drawCur() {
    if (!cur) return;
    const c = curCenter();
    const g = cur.glow + 0.1 * Math.sin(S.time * 7);
    box(c[0], c[1], cur.idx * H + H / 2, cur.sx / 2, cur.sy / 2, H / 2, null, cur.idx, g, true, false);
    // a faint outline of the slab below, on top of the block, to line it up against
    const t = slabs[slabs.length - 1];
    const k = 0.34 + 0.14 * Math.sin(S.time * 5);
    rectRing(t.cx, t.cy, (cur.idx + 1) * H + 0.08, t.sx / 2, t.sy / 2, 0, 0.09, k, k * 0.95, k * 0.9);
}

function drawDebris() {
    for (let i = 0; i < debris.length; i++) {
        const d = debris[i];
        box(d.cx, d.cy, d.cz, d.hx, d.hy, d.hz, setRot(d.ax, d.ang), d.idx, 0, true, true);
    }
}

function drawFx() {
    for (const r of ripples) {
        const f = r.t / r.life, k = (1 - f) * (1 - f);
        const grow = f * (r.big ? 3.4 : 2.1);
        rectRing(r.cx, r.cy, r.z, r.hx, r.hy, grow, 0.16 + f * 0.3, r.col[0] * k, r.col[1] * k, r.col[2] * k);
        glowAt(r.cx, r.cy, r.z + 0.25, (r.hx + r.hy) * (0.45 + f * 0.5), r.col[0] * k * 0.35, r.col[1] * k * 0.35, r.col[2] * k * 0.35);
    }
    for (const p of sparks) {
        const f = 1 - p.t / p.life;
        glowAt(p.x, p.y, p.z, p.s * (0.5 + 0.5 * f), p.col[0] * f, p.col[1] * f, p.col[2] * f);
    }
    const L = sky.light;
    for (const m of motes) {
        const b = 0.2 + 0.45 * (0.5 + 0.5 * Math.sin(S.time * m.f + m.ph));
        glowAt(m.x, m.y, m.z, m.s, (L[0] * 0.7 + 0.3) * b, (L[1] * 0.7 + 0.3) * b, (L[2] * 0.7 + 0.3) * b);
    }
}

function render() {
    placeCamera();
    vc = STATIC_V;
    ac = 0;
    drawTower();
    drawCur();
    drawDebris();
    drawFx();

    gl.uniform3f(loc.cam, space.Xc, space.Yc, space.Zc);
    gl.uniform1f(loc.time, S.time);
    gl.uniform1f(loc.beat, S.beat);
    gl.uniform1f(loc.flash, S.flash * 0.25);
    gl.uniform3f(loc.zen, sky.zen[0], sky.zen[1], sky.zen[2]);
    gl.uniform3f(loc.hor, sky.hor[0], sky.hor[1], sky.hor[2]);
    gl.uniform3f(loc.haze, sky.haze[0], sky.haze[1], sky.haze[2]);
    gl.uniform3f(loc.light, sky.light[0], sky.light[1], sky.light[2]);
    gl.uniform4f(loc.mix, sky.sun, sky.stars, sky.aur, sky.moon);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // pass 1: sky, glass and debris
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
}

// ------------------------------------------------------------------ input

canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    sfx.unlock();
    tap();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ' || e.code === 'KeyQ' || e.code === 'KeyP') e.stopPropagation();
    if (e.repeat) return;
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if ((e.code === 'Space' || e.code === 'Enter') && !onButton) { e.preventDefault(); sfx.unlock(); tap(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') { if (S.paused) resume(); else pause(); }
}, true);
window.addEventListener('blur', () => pause());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

$('playBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);
$('resumeBtn').addEventListener('click', resume);
$('pauseBtn').addEventListener('click', pause);
function syncMute() {
    const m = sfx.isMuted();
    el.muteBtn.setAttribute('aria-pressed', String(m));
    el.muteBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
}
el.muteBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.setMuted(!sfx.isMuted());
    try { localStorage.setItem('spire.muted', sfx.isMuted() ? '1' : '0'); } catch (e) { /* storage blocked */ }
    syncMute();
});

// ------------------------------------------------------------------ main loop

let last = performance.now(), ema = 1 / 60, adaptN = 0;
function frame(now) {
    const raw = (now - last) / 1000;
    last = now;
    update(Math.min(raw, 1 / 20));
    render();
    // on a slow GPU, trade resolution for frame rate
    ema = ema * 0.95 + Math.min(raw, 0.1) * 0.05;
    if (++adaptN >= 90) {
        adaptN = 0;
        if (ema > 0.04 && renderScale > 0.66) { renderScale = Math.max(0.66, renderScale * 0.85); resize(); ema = 1 / 60; }
    }
    requestAnimationFrame(frame);
}

// boot: a few slabs already stacked behind the title, camera settled
syncMute();
showBest();
spawnBlock();
for (let i = 0; i < 7; i++) { cur.off = Math.random() < 0.5 ? 0.05 : rand(-1.4, 1.4); drop(true); }
updateCamera(10);
sky = skyAt(0);
requestAnimationFrame(frame);
