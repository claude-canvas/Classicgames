// SKY LABYRINTH — tilt a stone tablet above the clouds and roll a glass marble to the golden well.
// Rendered with the projection3d library (Space, via GameSpace) + custom shaders + bloom. See DESIGN.md.
// physics.js is the simulation, board.js / scene.js build the geometry, this file runs the loop, input,
// camera, effects and UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, mulberry32, mixc } from "./mesh.js";
import { LEVELS, ISLES } from "./levels.js";
import { parse, Sim, R, MAX_TILT, approachTilt } from "./physics.js";
import { buildBoard, heightData, drawDynamic, drawBall, ringA, SLAB } from "./board.js";
import { buildScene, makeFlock, drawFlock, makeMotes, drawMotes } from "./scene.js";
import { Bot } from "./bot.js";

const Q_ = new URLSearchParams(location.search);
const K_ = 2.0;                       // focal length (veriables.y = K_ · 1.6)
const TAU = Math.PI * 2;
const CORES = [[1.0, 0.45, 0.25], [0.3, 0.75, 1.0], [1.0, 0.75, 0.2], [1.0, 0.3, 0.55]];
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const fmtPar = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

// ------------------------------------------------------------------ canvas + library
const canvas = document.getElementById("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const _t0 = performance.now();
const U = createProgram(gl, space);
if (Q_.has("perf")) console.log("compile ms", Math.round(performance.now() - _t0));
const post = new Post(gl, space.posId);
const audio = new Audio();
function sizeCanvas() {
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = innerWidth * innerHeight * dpr * dpr;
    if (px > 3.0e6) dpr *= Math.sqrt(3.0e6 / px);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    post.resize(canvas.width, canvas.height);
}

// ------------------------------------------------------------------ save
const DEF = { best: {}, unlocked: 0, volume: 0.8, music: 0.5, sens: 1, invert: false, motion: false };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("skylabyrinth.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("skylabyrinth.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;
const parOf = (i) => LEVELS[i].par || 60;
const nextLevel = () => { for (let i = 0; i < LEVELS.length; i++) if (!save.best[i]) return Math.min(i, save.unlocked); return 0; };

// ------------------------------------------------------------------ level state
let state = "loading", prevState = "play", levelIdx = 0, L = null, sim = null, isle = ISLES[0], isleIdx = -1, time = 0;
let tilt = [0, 0], buildT = 1, introT = 0, ballDrop = { z: 6, vz: 0, landed: false }, goalFrom = null, hurt = 0, bot = null, finished = false;
let ballRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const fx = { gateH: 1, crumbleFall: [], bumpFlash: [], gemPop: [], time: 0 };
let sparks = [], motes = [], flock = makeFlock(mulberry32(7));

// static buffers: [scene opaque][board opaque][scene additive][board additive]
const stat = new Mesh(250000);
let nSO = 0, nBO = 0, nSA = 0, nBA = 0, sceneCache = { idx: -1 };
function rebuildStatic() {
    if (sceneCache.idx !== isleIdx) { const O = new Mesh(160000), A = new Mesh(6000); buildScene(isleIdx, isle, O, A); sceneCache = { idx: isleIdx, O, A }; }
    const BO = new Mesh(80000), BA = new Mesh(2000);
    buildBoard(L, isle, BO, BA);
    stat.reset(); stat.append(sceneCache.O); stat.append(BO); stat.append(sceneCache.A); stat.append(BA);
    nSO = sceneCache.O.n; nBO = BO.n; nSA = sceneCache.A.n; nBA = BA.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}
const hTex = gl.createTexture();
function uploadHeight() {
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, hTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, L.W, L.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, heightData(L, sim, fx.gateH));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
}

function loadLevel(i, { quick = false, show = true } = {}) {
    levelIdx = i;
    L = parse(LEVELS[i]); sim = new Sim(L);
    const ni = Math.floor(i / 6);
    if (ni !== isleIdx) { isleIdx = ni; isle = ISLES[ni]; motes = makeMotes(mulberry32(ni * 19 + 3)); audio.isle = ni; }
    rebuildStatic();
    fx.gateH = 1; fx.crumbleFall = []; fx.bumpFlash = []; fx.gemPop = [];
    uploadHeight();
    tilt = [0, 0]; ballRot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; sparks = []; goalFrom = null; finished = false;
    buildT = quick ? 0.55 : 0; introT = quick ? 0.6 : 0; ballDrop = { z: 6, vz: 0, landed: false };
    bot = Q_.has("bot") ? new Bot(L) : null;
    if (show) { state = "intro"; ui.show("hud"); ui.hud(); ui.banner(); }
}

// ------------------------------------------------------------------ input
const input = { keys: new Set(), mouse: null, touch: null, motion: null, last: "mouse" };
const KEYMAP = { ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d" };
addEventListener("keydown", (e) => {
    audio.init();
    if (KEYMAP[e.code]) { input.keys.add(KEYMAP[e.code]); input.last = "keys"; e.preventDefault(); }
    if (e.code === "Escape" || e.code === "KeyP") { if (state === "play" || state === "intro") pause(); else if (state === "paused") resume(); }
    if (e.code === "KeyR" && (state === "play" || state === "intro" || state === "done")) restart();
    if ((e.code === "Enter" || e.code === "KeyN") && state === "done" && levelIdx < LEVELS.length - 1) { ui.close(); loadLevel(levelIdx + 1); }
});
addEventListener("keyup", (e) => { if (KEYMAP[e.code]) input.keys.delete(KEYMAP[e.code]); });
addEventListener("blur", () => { input.keys.clear(); input.touch = null; });
canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") { input.mouse = [e.clientX, e.clientY]; input.last = "mouse"; }
    else if (input.touch && input.touch.id === e.pointerId) { input.touch.x = e.clientX; input.touch.y = e.clientY; }
});
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") input.mouse = null; });
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    if (e.pointerType !== "mouse" && !input.touch) { input.touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; input.last = "touch"; canvas.setPointerCapture?.(e.pointerId); }
});
const endTouch = (e) => { if (input.touch && input.touch.id === e.pointerId) input.touch = null; };
canvas.addEventListener("pointerup", endTouch); canvas.addEventListener("pointercancel", endTouch);
function onOrient(e) {
    if (e.beta == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let x = e.gamma, y = e.beta;
    if (ang === 90) { x = e.beta; y = -e.gamma; } else if (ang === -90 || ang === 270) { x = -e.beta; y = e.gamma; } else if (ang === 180) { x = -e.gamma; y = -e.beta; }
    if (!input.motion) input.motion = { x0: x, y0: y };
    input.motion.x = x; input.motion.y = y;
}
async function enableMotion(on) {
    if (on && typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        try { if ((await DeviceOrientationEvent.requestPermission()) !== "granted") on = false; } catch { on = false; }
    }
    save.motion = on; persist();
    input.motion = null;
    if (on) addEventListener("deviceorientation", onOrient); else removeEventListener("deviceorientation", onOrient);
    return on;
}
if (save.motion) addEventListener("deviceorientation", onOrient);

// screen-space stick (x right, y away from the camera), magnitude ≤ 1
function readInput() {
    let ix = 0, iy = 0;
    const k = input.keys;
    if (input.last === "keys" && k.size) { ix = (k.has("r") ? 1 : 0) - (k.has("l") ? 1 : 0); iy = (k.has("u") ? 1 : 0) - (k.has("d") ? 1 : 0); }
    else if (input.touch) { const s = Math.min(innerWidth, innerHeight) * 0.15; ix = (input.touch.x - input.touch.x0) / s; iy = -(input.touch.y - input.touch.y0) / s; }
    else if (save.motion && input.motion && input.motion.x != null) { ix = (input.motion.x - input.motion.x0) / 20; iy = -(input.motion.y - input.motion.y0) / 20; }
    else if (input.last === "mouse" && input.mouse) {
        const [cx, cy] = project(0, 0, 0), s = Math.min(innerWidth, innerHeight) * 0.36;
        ix = (input.mouse[0] - cx) / s; iy = -(input.mouse[1] - cy) / s;
        const l = Math.hypot(ix, iy); if (l < 0.05) { ix = 0; iy = 0; } else { ix *= (l - 0.05) / (0.95 * l); iy *= (l - 0.05) / (0.95 * l); }
    }
    ix *= save.sens; iy *= save.sens;
    const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
    if (save.invert) { ix = -ix; iy = -iy; }
    return [ix, iy];
}
const camAxes = () => { const y = cam.yaw; return { rx: Math.cos(y), ry: Math.sin(y), ax: -Math.sin(y), ay: Math.cos(y) }; };

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt; fx.time = time;
    hurt = Math.max(0, hurt - dt * 2.2);
    let target = [0, 0];
    if (state === "play" && sim.state === "roll") {
        let [ix, iy] = bot ? bot.control(sim) : readInput();
        const a = camAxes();
        if (bot) target = [ix * MAX_TILT, iy * MAX_TILT];
        else target = [(ix * a.rx + iy * a.ax) * MAX_TILT, (ix * a.ry + iy * a.ay) * MAX_TILT];
    }
    tilt[0] = approachTilt(tilt[0], target[0], dt); tilt[1] = approachTilt(tilt[1], target[1], dt);
    if (state === "intro" || state === "title" || state === "levels") {
        buildT = Math.min(1, buildT + dt / 1.5);
        if (state === "intro") {
            introT += dt;
            if (introT > 1.05) {
                ballDrop.vz -= 30 * dt; ballDrop.z += ballDrop.vz * dt;
                if (ballDrop.z <= 0) { ballDrop.z = 0; if (ballDrop.vz < -1.2) { audio.hit(-ballDrop.vz * 0.5); burst(sim.ball.x, sim.ball.y, 0.05, CORES[isleIdx], 8, 1.2); } ballDrop.vz = -ballDrop.vz * 0.38; if (ballDrop.vz < 0.6) { ballDrop.vz = 0; ballDrop.landed = true; } }
            }
            if (ballDrop.landed && buildT >= 1) { state = "play"; }
        }
    }
    if (state === "play" || state === "done") {
        const ev = sim.step(dt, tilt[0], tilt[1]);
        for (const e of ev) onEvent(e);
        const b = sim.ball;
        if (sim.state === "roll") {
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > 1e-4) rotateBall(-b.vy / sp, b.vx / sp, (sp * dt) / R);
            const [c, r] = sim.cellOf(b.x, b.y);
            audio.roll(sp, sim.ch(c, r), false);
        } else audio.roll(0, ".", true);
    } else audio.roll(0, ".", true);
    if (state === "play" && sim.state === "goal" && sim.goalT > 1.4 && !finished) finish();
    // effects
    if (sim) {
        if (sim.gatesOpen && fx.gateH > 0) { fx.gateH = Math.max(0, fx.gateH - dt * 0.9); uploadHeight(); }
        sim.crumble.forEach((s, i) => { if (s.broken) fx.crumbleFall[i] = (fx.crumbleFall[i] || 0) + dt; else fx.crumbleFall[i] = 0; });
        fx.bumpFlash = fx.bumpFlash.map((v) => Math.max(0, v - dt * 3));
        fx.gemPop = fx.gemPop.map((v) => (v === undefined ? v : v + dt * 1.6));
    }
    for (const p of sparks) { p.vz -= 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt; }
    sparks = sparks.filter((p) => p.life > 0);
    if (state === "play" || state === "intro") ui.tick();
}
function rotateBall(ax, ay, ang) {
    // rot ← Rot(axis (ax, ay, 0), ang) · rot   (column-major 3×3)
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const m = [t * ax * ax + c, t * ax * ay, -s * ay, t * ax * ay, t * ay * ay + c, s * ax, s * ay, -s * ax, c];
    const r = ballRot, o = new Array(9);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) o[col * 3 + row] = m[row] * r[col * 3] + m[3 + row] * r[col * 3 + 1] + m[6 + row] * r[col * 3 + 2];
    // re-orthonormalise
    let x = [o[0], o[1], o[2]], y = [o[3], o[4], o[5]];
    const lx = Math.hypot(...x); x = x.map((v) => v / lx);
    const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2]; y = y.map((v, i) => v - d * x[i]); const ly = Math.hypot(...y); y = y.map((v) => v / ly);
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    ballRot = [...x, ...y, ...z];
}
function burst(x, y, z, col, n, sp = 2) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = sp * (0.4 + Math.random() * 0.8); sparks.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 1 + Math.random() * 2.5, life: 0.5 + Math.random() * 0.6, col }); }
}
const GEMC = [[0.4, 0.95, 1.0], [1.0, 0.45, 0.85], [0.6, 1.0, 0.45]];
function onEvent(e) {
    const b = sim.ball;
    switch (e.type) {
        case "hit": audio.hit(e.s); break;
        case "gem": audio.gem(e.i); fx.gemPop[e.i] = 0; burst(L.gems[e.i].x, L.gems[e.i].y, 0.45, GEMC[e.i % 3], 22, 2.5); ui.gems(); break;
        case "check": audio.check(); ui.toast("Lantern lit · checkpoint"); burst(b.x, b.y, 0.6, [1, 0.8, 0.4], 14); break;
        case "switch": audio.switch(); ui.toast("The brass gates are opening"); burst(b.x, b.y, 0.1, [0.3, 1, 0.6], 16); break;
        case "bump": audio.bump(); fx.bumpFlash[e.i] = 1; break;
        case "boost": audio.boost(); break;
        case "crack": audio.crack(); break;
        case "crumble": audio.crumble(); break;
        case "fall": audio.fall(e.hole); hurt = 1; ui.falls(); break;
        case "respawn": audio.respawn(); ballRot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; fx.crumbleFall = []; burst(b.x, b.y, 0.1, CORES[isleIdx], 16, 1.5); if (bot) bot.respawned(sim); break;
        case "goal": audio.goal(); goalFrom = { x: b.x, y: b.y }; burst(L.goal.x, L.goal.y, 0.3, [1, 0.8, 0.4], 40, 3); break;
    }
}
function finish() {
    finished = true; state = "done";
    const t = sim.time, gems = sim.gemCount, par = parOf(levelIdx);
    const stars = [true, gems === 3, t <= par];
    const n = stars.filter(Boolean).length;
    const old = save.best[levelIdx];
    const nb = { stars: Math.max(n, old ? old.stars : 0), time: Math.min(t, old ? old.time : 1e9), gems: Math.max(gems, old ? old.gems : 0), s: [0, 1, 2].map((k) => stars[k] || (old && old.s ? old.s[k] : false)) };
    nb.stars = nb.s.filter(Boolean).length;
    save.best[levelIdx] = nb; save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length - 1, levelIdx + 1)); persist();
    ui.done(stars, t, par, gems, sim.falls, !old || t < old.time);
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.4, dist: 40, tx: 0, ty: 0, tz: 0 };
function fitDist(yaw, pitch) {
    const aspect = canvas.width / canvas.height, k = K_;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [-Math.sin(yaw) * cp, Math.cos(yaw) * cp, -sp], r = [Math.cos(yaw), Math.sin(yaw), 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const hudT = (innerWidth < 640 ? 150 : 96) / innerHeight * 2, hudB = 40 / innerHeight * 2;
    const limX = 1 - 0.06, limY = 1 - (hudT + hudB) / 2 - 0.03;
    const pts = [];
    for (const x of [-L.W / 2 - 0.3, L.W / 2 + 0.3]) for (const y of [-L.H / 2 - 0.3, L.H / 2 + 0.3]) for (const z of [-SLAB - 0.5, 1.2]) pts.push([x, y, z]);
    let lo = 4, hi = 300;
    for (let it = 0; it < 30; it++) {
        const d = (lo + hi) / 2, eye = [-f[0] * d, -f[1] * d, -f[2] * d];
        let ok = true;
        for (const p of pts) {
            const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], zf = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
            const nx = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) * k / zf, ny = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) * k * aspect / zf;
            if (zf <= 0.5 || Math.abs(nx) > limX || Math.abs(ny) > limY) { ok = false; break; }
        }
        if (ok) hi = d; else lo = d;
    }
    return { dist: hi, shift: ((hudT - hudB) / 2) * hi / (k * aspect), up: u };
}
function updateCamera(dt) {
    space.magnifier = K_ * 1.6;
    const aspect = canvas.width / canvas.height, portrait = aspect < 0.85;
    let yaw, pitch, dist, tx = 0, ty = 0, tz = 0;
    if (state === "title" || state === "levels" || state === "loading") {
        yaw = Math.sin(time * 0.06) * 0.5; pitch = 0.17; dist = Math.max(30, L ? Math.max(L.W, L.H) * 2.6 : 30) * (portrait ? 1.6 : 1); tz = 6.5; ty = 4;
    } else {
        yaw = portrait && L.W > L.H ? -Math.PI / 2 : 0;
        pitch = portrait ? 1.08 : 0.9;
        const fit = fitDist(yaw, pitch);
        dist = fit.dist; tx = fit.up[0] * fit.shift; ty = fit.up[1] * fit.shift; tz = fit.up[2] * fit.shift;
        if (state === "intro" && buildT < 1) dist *= 1 + (1 - buildT) * (1 - buildT) * 0.5;
    }
    const k = Math.min(1, dt * (state === "title" || state === "levels" ? 1.5 : 3));
    cam.yaw += Math.atan2(Math.sin(yaw - cam.yaw), Math.cos(yaw - cam.yaw)) * k;
    cam.pitch += (pitch - cam.pitch) * k; cam.dist += (dist - cam.dist) * k;
    cam.tx += (tx - cam.tx) * k; cam.ty += (ty - cam.ty) * k; cam.tz += (tz - cam.tz) * k;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // a whisper of sway with the tilt so the motion reads
    const sx = tilt[0] * 2.0, sy = tilt[1] * 2.0;
    space.lookAt(cam.tx + Math.sin(cam.yaw) * cam.dist * cp - sx, cam.ty - Math.cos(cam.yaw) * cam.dist * cp - sy, cam.tz + cam.dist * sp, cam.tx, cam.ty, cam.tz);
}
function project(x, y, z) {
    const v = [x - space.Xc, y - space.Yc, z - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
    return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(40000), D = new Mesh(30000), WD = new Mesh(2000), Sh = new Mesh(2000), A = new Mesh(20000), WA = new Mesh(6000);
const IDENT = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const Mtx = new Float32Array(9), BallRotW = new Float32Array(9);
function tiltMatrix(tx, ty) {
    const cy = Math.cos(tx), sy = Math.sin(tx), cx = Math.cos(-ty), sx = Math.sin(-ty);
    // rows: [cy, sy·sx, sy·cx] [0, cx, −sx] [−sy, cy·sx, cy·cx] → column-major
    Mtx.set([cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx]);
}
const mulM = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const mulMT = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function ballPos() {
    const b = sim.ball;
    if (state === "intro" || (state !== "play" && state !== "done" && !goalFrom)) return [b.x, b.y, state === "intro" ? ballDrop.z : 0, 1];
    if (sim.state === "goal" && goalFrom) {
        const k = Math.min(1, sim.goalT / 1.1), g = L.goal;
        const a0 = Math.atan2(goalFrom.y - g.y, goalFrom.x - g.x) + sim.goalT * 9, rr = Math.hypot(goalFrom.x - g.x, goalFrom.y - g.y) * (1 - k);
        return [g.x + Math.cos(a0) * rr, g.y + Math.sin(a0) * rr, -k * k * 0.75, 1 - k * 0.5];
    }
    return [b.x, b.y, b.z, 1];
}
function buildDynamic() {
    D.reset(); WD.reset(); Sh.reset(); A.reset(); WA.reset(); dyn.reset();
    dyn.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    drawDynamic(D, Sh, A, L, sim, isle, fx);
    const [bx, by, bz, bs] = ballPos(), core = CORES[isleIdx];
    if (bz > -3) {
        drawBall(D, bx, by, R + bz, ballRot, R * bs);
        if (bz > -0.05) {
            const lL = mulMT(Mtx, lightDir);
            A.sprite(bx - lL[0] * 0.42, by - lL[1] * 0.42, 0.012, 0.32, core[0] * 0.22, core[1] * 0.22, core[2] * 0.22);
        }
    }
    for (const p of sparks) { const k = Math.min(1, p.life * 2); A.sprite(p.x, p.y, p.z, 0.07, p.col[0] * k, p.col[1] * k, p.col[2] * k); }
    drawFlock(WD, flock, time, mixc(isle.wall, [0.05, 0.04, 0.08], 0.75));
    drawMotes(WA, motes, time, lastDt, isle);
    const o = { D: 6, WD: 0, Sh: 0, A: 0, WA: 0 };
    dyn.append(D); o.WD = dyn.n; dyn.append(WD); o.Sh = dyn.n; dyn.append(Sh); o.A = dyn.n; dyn.append(A); o.WA = dyn.n; dyn.append(WA);
    space.setDynamic(dyn.pos, dyn.col, dyn.n);
    return o;
}
let lightDir = [0, 0.6, 0.8];
function render(dt) {
    updateCamera(dt);
    tiltMatrix(tilt[0], tilt[1]);
    const sky = isle.sky;
    const sun = norm3(sky.sunDir);
    lightDir = norm3([sun[0] * 0.55, sun[1] * 0.75, 0.82]);
    const o = buildDynamic();
    const [bx, by, bz, bs] = ballPos();
    const bl = [bx, by, R + bz];
    const bw = mulM(Mtx, bl);
    for (let c = 0; c < 3; c++) { const col = mulM(Mtx, [ballRot[c * 3], ballRot[c * 3 + 1], ballRot[c * 3 + 2]]); BallRotW.set(col, c * 3); }
    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, canvas.width / canvas.height);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uLightDir, lightDir); gl.uniform3fv(U.uLightL, mulMT(Mtx, lightDir));
    gl.uniform3fv(U.uSunDir, sun); gl.uniform3fv(U.uSunCol, sky.sun);
    gl.uniform3fv(U.uSkyTop, sky.top); gl.uniform3fv(U.uSkyMid, sky.mid); gl.uniform3fv(U.uSkyHor, sky.hor);
    gl.uniform3fv(U.uCloud, sky.cloud); gl.uniform3fv(U.uCloudShade, sky.cloudShade);
    gl.uniform1i(U.uHeight, 3); gl.uniform2f(U.uGrid, L.W, L.H);
    gl.uniform4f(U.uBall, bl[0], bl[1], bl[2], R * bs); gl.uniform3fv(U.uBallW, bw); gl.uniformMatrix3fv(U.uBallRot, false, BallRotW);
    gl.uniform3fv(U.uCore, CORES[isleIdx]);
    space.applyCamera();
    const bk = buildT < 1 ? buildT : 1;
    const world = () => { gl.uniformMatrix3fv(U.uModel, false, IDENT); gl.uniform1f(U.uBuild, 1); gl.uniform1f(U.uLocal, 0); };
    const board = () => { gl.uniformMatrix3fv(U.uModel, false, Mtx); gl.uniform1f(U.uBuild, bk); gl.uniform1f(U.uLocal, 1); };
    world();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, nSO);
    space.bind(true); space.draw(o.WD, o.Sh - o.WD);
    board();
    space.bind(false); space.draw(nSO, nBO);
    space.bind(true); space.draw(o.D, o.WD - o.D);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    space.draw(o.Sh, o.A - o.Sh);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(false); space.draw(nSO + nBO + nSA, nBA);
    space.bind(true); space.draw(o.A, o.WA - o.A);
    world();
    space.bind(false); space.draw(nSO + nBO, nSA);
    space.bind(true); space.draw(o.WA, dyn.n - o.WA);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: hurt * 0.8 });
    ui.frame();
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const MODALS = ["m-done", "m-pause", "m-set"];
let toastT = 0, bannerT = 0, lastTimeTxt = "";
const ui = {
    show(which) {
        $("title").classList.toggle("hidden", which !== "title");
        $("levels").classList.toggle("hidden", which !== "levels");
        $("hud").classList.toggle("hidden", which !== "hud");
    },
    open(id) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); },
    close() { for (const m of MODALS) $(m).classList.add("hidden"); },
    title() {
        const stars = Object.values(save.best).reduce((s, b) => s + b.stars, 0), done = Object.keys(save.best).length;
        $("t-stats").innerHTML = `<span><b>${stars}</b> / ${LEVELS.length * 3} stars</span><span><b>${done}</b> / ${LEVELS.length} levels</span>`;
        $("t-play").textContent = done === 0 ? "Play" : `Continue · Level ${nextLevel() + 1}`;
        $("t-hint").textContent = matchMedia("(pointer: coarse)").matches ? "Drag anywhere to tilt the board" : "Move the mouse to tilt · or WASD / arrow keys";
    },
    levels() {
        const nxt = nextLevel();
        $("isles").innerHTML = ISLES.map((s, k) => {
            const c = (v) => `rgb(${v.map((x) => Math.round(Math.min(1, x) * 255)).join(",")})`;
            const art = `linear-gradient(165deg, ${c(s.sky.top)} 0%, ${c(s.sky.mid)} 55%, ${c(s.sky.hor)} 100%)`;
            const got = [0, 1, 2, 3, 4, 5].reduce((a, j) => a + (save.best[k * 6 + j] ? save.best[k * 6 + j].stars : 0), 0);
            const btns = [0, 1, 2, 3, 4, 5].map((j) => {
                const i = k * 6 + j, b = save.best[i], lock = i > save.unlocked;
                const st = [0, 1, 2].map((q) => (b && b.s && b.s[q] ? "<i>★</i>" : "★")).join("");
                return `<button data-l="${i}" ${lock ? "disabled" : ""} class="${i === nxt ? "next" : ""}" aria-label="Level ${i + 1}"><b>${lock ? "🔒" : i + 1}</b><span class="st">${lock ? "" : st}</span></button>`;
            }).join("");
            return `<div class="isle" style="--art:${art}"><div class="num">ISLE ${["I", "II", "III", "IV"][k]}</div><h3>${s.name}</h3><p>${s.sub}</p><span class="cnt">★ ${got} / 18</span><div class="lv">${btns}</div></div>`;
        }).join("");
        $("isles").querySelectorAll("button[data-l]").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); loadLevel(+b.dataset.l); }));
    },
    hud() {
        $("h-isle").textContent = `${isle.name} · ${levelIdx % 6 + 1}`;
        $("h-name").textContent = L.name;
        $("h-par").textContent = `par ${fmtPar(parOf(levelIdx))}`;
        ui.gems(); ui.falls(); lastTimeTxt = "";
        $("gimbal").classList.toggle("hidden", !!input.touch && false);
    },
    gems() { for (let i = 0; i < 3; i++) $("g" + i).classList.toggle("on", !!sim.gems[i]); },
    falls() { $("h-falls").textContent = sim.falls; },
    tick() {
        const txt = fmt(sim.time);
        if (txt !== lastTimeTxt) { lastTimeTxt = txt; $("h-time").textContent = txt; $("h-timebox").classList.toggle("over", sim.time > parOf(levelIdx)); }
    },
    frame() {
        // gimbal: tilt in screen space
        const a = camAxes(), sx = (tilt[0] * a.rx + tilt[1] * a.ry) / MAX_TILT, sy = (tilt[0] * a.ax + tilt[1] * a.ay) / MAX_TILT;
        const g = $("gimbal"), rad = g.clientWidth * 0.36;
        $("gimbal-dot").style.transform = `translate(${sx * rad}px, ${-sy * rad}px)`;
        const j = $("joy");
        if (input.touch && state === "play") { j.classList.remove("hidden"); j.style.left = input.touch.x0 + "px"; j.style.top = input.touch.y0 + "px"; const s = Math.min(innerWidth, innerHeight) * 0.15; let dx = input.touch.x - input.touch.x0, dy = input.touch.y - input.touch.y0; const l = Math.hypot(dx, dy); if (l > s) { dx *= s / l; dy *= s / l; } $("joy-dot").style.transform = `translate(${dx * 37 / s}px, ${dy * 37 / s}px)`; }
        else j.classList.add("hidden");
        if (toastT && performance.now() > toastT) { $("toast").classList.remove("show"); toastT = 0; }
        if (bannerT && performance.now() > bannerT) { $("banner").classList.add("out"); bannerT = 0; }
    },
    banner() {
        $("bn-k").textContent = `${isle.name} · Level ${levelIdx % 6 + 1}`;
        $("bn-t").textContent = L.name;
        const tips = { "~": "Ice: the marble barely slows down", ":": "Moss: soft and slow", "x": "Cracked tiles fall away soon after you touch them", "k": "Press the brass switch to open the gates", "b": "Brass bumpers kick the marble away", ">": "Glowing arrows push hard", "<": "Glowing arrows push hard", "c": "Touch a lantern to save your place", "O": "Holes drop you into the sky" };
        let tip = "Collect the three crystals and reach the golden well";
        const flat = L.cells.flat();
        for (const ch of ["x", "k", "b", ">", "<", "~", ":", "c", "O"]) if (flat.includes(ch) && !LEVELS.slice(0, levelIdx).some((d) => d.map.join("").includes(ch))) { tip = tips[ch]; break; }
        $("bn-s").textContent = tip;
        $("banner").classList.remove("out"); bannerT = performance.now() + 2800;
    },
    toast(t) { $("toast").textContent = t; $("toast").classList.add("show"); toastT = performance.now() + 1800; },
    done(stars, t, par, gems, falls, best) {
        $("d-t").textContent = L.name;
        $("d-k").textContent = `${isle.name} · Level ${levelIdx % 6 + 1}`;
        $("d-time").textContent = fmt(t); $("d-time").className = t <= par ? "ok" : "no";
        $("d-par").textContent = fmtPar(par);
        $("d-gems").textContent = `${gems} / 3`; $("d-gems").className = gems === 3 ? "ok" : "no";
        $("d-falls").textContent = falls;
        $("d-best").innerHTML = best && save.best[levelIdx] && Object.keys(save.best).length > 0 ? `<span class="newbest">NEW BEST TIME</span>` : "";
        $("d-next").classList.toggle("hidden", levelIdx >= LEVELS.length - 1);
        for (let i = 0; i < 3; i++) $("s" + i).classList.remove("on");
        ui.open("m-done");
        stars.forEach((on, i) => { if (on) setTimeout(() => { $("s" + i).classList.add("on"); audio.star(i); }, 450 + i * 380); });
    },
};
function pause() { if (state !== "play" && state !== "intro") return; prevState = state; state = "paused"; $("p-t").textContent = L.name; $("p-s").textContent = `${isle.name} · Level ${levelIdx % 6 + 1} · ${fmt(sim.time)}`; ui.open("m-pause"); }
function resume() { ui.close(); state = prevState; }
function restart() { ui.close(); loadLevel(levelIdx, { quick: true }); }
function toTitle() {
    ui.close(); state = "title";
    loadLevel(nextLevel(), { show: false }); buildT = 1;
    ui.show("title"); ui.title();
}
$("t-play").addEventListener("click", () => { audio.init(); audio.click(); loadLevel(nextLevel()); });
$("t-levels").addEventListener("click", () => { audio.init(); audio.click(); state = "levels"; ui.levels(); ui.show("levels"); });
$("l-back").addEventListener("click", () => { audio.click(); state = "title"; ui.show("title"); ui.title(); });
$("t-set").addEventListener("click", () => { audio.init(); setUI(); ui.open("m-set"); });
$("b-menu").addEventListener("click", () => { audio.click(); pause(); });
$("b-restart").addEventListener("click", () => { audio.click(); restart(); });
$("p-resume").addEventListener("click", resume);
$("p-restart").addEventListener("click", restart);
$("p-levels").addEventListener("click", () => { ui.close(); state = "levels"; ui.levels(); ui.show("levels"); });
$("p-set").addEventListener("click", () => { setUI(); ui.open("m-set"); });
$("p-title").addEventListener("click", toTitle);
$("d-retry").addEventListener("click", restart);
$("d-levels").addEventListener("click", () => { ui.close(); state = "levels"; ui.levels(); ui.show("levels"); });
$("d-next").addEventListener("click", () => { ui.close(); loadLevel(Math.min(LEVELS.length - 1, levelIdx + 1)); });
$("ms-x").addEventListener("click", () => { if (state === "paused") ui.open("m-pause"); else ui.close(); });
$("m-set").addEventListener("pointerdown", (e) => { if (e.target === $("m-set")) { if (state === "paused") ui.open("m-pause"); else ui.close(); } });
function setUI() {
    for (const [id, v] of [["s-vol", save.volume], ["s-mus", save.music]]) { $(id).value = Math.round(v * 100); $(id).style.setProperty("--v", `${v * 100}%`); }
    $("s-sens").value = Math.round(save.sens * 100); $("s-sens").style.setProperty("--v", `${(save.sens - 0.4) / 1.2 * 100}%`);
    $("s-inv").setAttribute("aria-checked", save.invert); $("s-motion").setAttribute("aria-checked", save.motion);
    $("row-motion").classList.toggle("hidden", !("DeviceOrientationEvent" in window) || !matchMedia("(pointer: coarse)").matches);
}
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; persist(); audio.init(); audio.setVolume(save.volume); e.target.style.setProperty("--v", `${save.volume * 100}%`); });
$("s-mus").addEventListener("input", (e) => { save.music = e.target.value / 100; persist(); audio.init(); audio.setMusic(save.music); e.target.style.setProperty("--v", `${save.music * 100}%`); });
$("s-sens").addEventListener("input", (e) => { save.sens = e.target.value / 100; persist(); e.target.style.setProperty("--v", `${(save.sens - 0.4) / 1.2 * 100}%`); });
$("s-inv").addEventListener("click", (e) => { save.invert = !save.invert; persist(); e.currentTarget.setAttribute("aria-checked", save.invert); });
$("s-motion").addEventListener("click", async (e) => { const el = e.currentTarget; const on = await enableMotion(!save.motion); el.setAttribute("aria-checked", on); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") pause(); });

// ------------------------------------------------------------------ boot
window.__sky = () => ({ state, level: levelIdx + 1, name: L && L.name, time: sim && +sim.time.toFixed(2), gems: sim && sim.gemCount, falls: sim && sim.falls, ball: sim && [+sim.ball.x.toFixed(2), +sim.ball.y.toFixed(2)], simState: sim && sim.state, tilt: tilt.map((v) => +v.toFixed(3)), fps: fpsNow, js: +jsMs.toFixed(2), verts: [stat.n, dyn.n], sparks: sparks.length, post: post.ok, best: save.best });
let jsMs = 0, last = performance.now(), fpsNow = 0, fN = 0, fT = 0, lastDt = 0.016;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fN++; fT += (now - last) / 1000; if (fT > 1) { fpsNow = Math.round(fN / fT); fN = 0; fT = 0; }
    last = now; lastDt = dt;
    const j0 = performance.now();
    if (state !== "paused") update(dt);
    render(dt);
    jsMs = jsMs * 0.9 + (performance.now() - j0) * 0.1;
    requestAnimationFrame(frame);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);
loadLevel(nextLevel(), { show: false }); buildT = 1; state = "loading";
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.title();
    if (Q_.has("level")) loadLevel(clamp(+Q_.get("level") - 1, 0, LEVELS.length - 1));
    else if (Q_.has("play") || Q_.has("bot")) loadLevel(nextLevel());
}, 500);
