// Borealis - a 3D glider run built on projection_library's Space.
// Space owns the WebGL buffers, camera maths and draw call; this file swaps in a custom
// shader (shaders.js), fills Space.posArr / colArr each frame and calls Space.reDraw().

import Space from "./Space.js"; // copy of projection_library/public/Space.js
import { VERT, FRAG } from "./shaders.js";
import { MESH, I3, rot, transformPoint } from "./meshes.js";
import { Sound } from "./audio.js";

const TAU = Math.PI * 2;
const HOVER = 1.3;          // glider's resting height
const ROAD_HALF = 11.2;     // how far the glider can steer either side
const WALL_H = 1.7;
const SPAWN_AHEAD = 235;
const PERIOD = 240;         // must match the terrain period in the vertex shader
const FOG = [0.34, 0.33, 0.56];
const LIGHT = norm([-0.38, -0.62, 0.69]);
const MAXV = 40000;

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
function norm(v) { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }
function load(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ } }

const el = {
    hud: $("hud"), score: $("score"), mult: $("mult"), embers: $("embers"), lives: $("lives"),
    pops: $("pops"), flash: $("flash"), title: $("title"), over: $("over"), pause: $("pause"),
    bestLine: $("bestLine"), finalScore: $("finalScore"), finalNote: $("finalNote"),
    statDist: $("statDist"), statEmbers: $("statEmbers"), mute: $("muteBtn"), err: $("err"),
};

function fail(msg) {
    el.err.textContent = msg;
    el.err.hidden = false;
    throw new Error(msg);
}

// ------------------------------------------------------------------ WebGL + Space

const canvas = $("view");
const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" });
if (!gl) fail("WebGL isn't available in this browser.\nOpen the game in Chrome or Firefox with hardware acceleration turned on.");

// Space binds Z, Q and P to debug zoom/depth tweaks; keep those keys from reaching it.
window.addEventListener("keydown", (e) => {
    if (e.code === "KeyZ" || e.code === "KeyQ" || e.code === "KeyP") e.stopPropagation();
}, true);

const space = new Space(gl);

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
    // keep the attribute slots Space already wired its buffers to
    gl.bindAttribLocation(program, space.posId, "pos");
    gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
} catch (err) {
    fail("The game's shader didn't compile on this device:\n\n" + err.message);
}

const U = (name) => gl.getUniformLocation(program, name);
// point Space.reDraw() at this program's uniforms
Object.assign(space, {
    program,
    cPointLoc: U("cPoint"), vPointLoc: U("vPoint"),
    xAxisLoc: U("xAxis"), yAxisLoc: U("yAxis"), zAxisLoc: U("zAxis"),
    varsLocation: U("veriables"),
});
gl.useProgram(program);
gl.uniform3fv(space.varsLocation, new Float32Array([space.zShifter, space.magnifier, 0]));
const loc = {
    aspect: U("uAspect"), scroll: U("uScroll"), warp: U("uWarp"), light: U("uLight"),
    time: U("fTime"), beat: U("fBeat"), fog: U("fFog"), fogRange: U("fFogRange"), ship: U("fShip"),
};
gl.uniform3fv(loc.light, new Float32Array(LIGHT));
gl.uniform3fv(loc.fog, new Float32Array(FOG));
gl.clearColor(FOG[0], FOG[1], FOG[2], 1);

// ------------------------------------------------------------------ canvas size

let dprScale = Math.min(window.devicePixelRatio || 1, 2);
let cssW = 1, cssH = 1, aspectFix = [1, 1];

function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dprScale);
    canvas.height = Math.round(cssH * dprScale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Space's projection assumes a 2:1 screen; correct it for whatever shape we have
    const a = cssW / cssH;
    aspectFix = a >= 2 ? [2 / a, 1] : a >= 1 ? [1, a / 2] : [1.35, a * 0.675];
    gl.uniform2fv(loc.aspect, new Float32Array(aspectFix));
}
window.addEventListener("resize", resize);
resize();

// drop resolution if the device can't keep up
let perfTime = 0, perfFrames = 0;
function adaptResolution(raw) {
    perfTime += raw;
    perfFrames++;
    if (perfTime < 2.5) return;
    const fps = perfFrames / perfTime;
    perfTime = perfFrames = 0;
    if (fps < 40 && dprScale > 1) {
        dprScale = Math.max(1, dprScale - 0.35);
        resize();
    }
}

// ------------------------------------------------------------------ geometry buffers

const POS = new Float32Array(MAXV * 4);
const COL = new Float32Array(MAXV * 4);
let vc = 0;

function vtx(x, y, z, m, r, g, b) {
    const o = vc << 2;
    POS[o] = x; POS[o + 1] = y; POS[o + 2] = z; POS[o + 3] = m;
    COL[o] = r; COL[o + 1] = g; COL[o + 2] = b; COL[o + 3] = 1;
    vc++;
}

// transform a mesh into the frame; material 1 gets flat, two-sided lighting
function emit(mesh, M, tx, ty, tz, mat, gain = 1) {
    if (vc + mesh.n * 3 > MAXV) return;
    const p = mesh.p, c = mesh.c;
    for (let t = 0; t < mesh.n; t++) {
        const o = t * 9;
        const ax = M[0] * p[o] + M[1] * p[o + 1] + M[2] * p[o + 2] + tx;
        const ay = M[3] * p[o] + M[4] * p[o + 1] + M[5] * p[o + 2] + ty;
        const az = M[6] * p[o] + M[7] * p[o + 1] + M[8] * p[o + 2] + tz;
        const bx = M[0] * p[o + 3] + M[1] * p[o + 4] + M[2] * p[o + 5] + tx;
        const by = M[3] * p[o + 3] + M[4] * p[o + 4] + M[5] * p[o + 5] + ty;
        const bz = M[6] * p[o + 3] + M[7] * p[o + 4] + M[8] * p[o + 5] + tz;
        const cx = M[0] * p[o + 6] + M[1] * p[o + 7] + M[2] * p[o + 8] + tx;
        const cy = M[3] * p[o + 6] + M[4] * p[o + 7] + M[5] * p[o + 8] + ty;
        const cz = M[6] * p[o + 6] + M[7] * p[o + 7] + M[8] * p[o + 8] + tz;
        let s = gain;
        if (mat === 1) {
            const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const len = Math.hypot(nx, ny, nz) || 1;
            const d = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len;
            s *= 0.36 + 0.64 * d + 0.1 * Math.abs(nz) / len;
        }
        vtx(ax, ay, az, mat, c[o] * s, c[o + 1] * s, c[o + 2] * s);
        vtx(bx, by, bz, mat, c[o + 3] * s, c[o + 4] * s, c[o + 5] * s);
        vtx(cx, cy, cz, mat, c[o + 6] * s, c[o + 7] * s, c[o + 8] * s);
    }
}

// camera-facing diamond for particles and snow
function spark(x, y, z, s, r, g, b) {
    if (vc + 6 > MAXV) return;
    const R = space.xUnitVec, Up = space.yUnitVec;
    const rx = R[0] * s, ry = R[1] * s, rz = R[2] * s, ux = Up[0] * s, uy = Up[1] * s, uz = Up[2] * s;
    vtx(x + ux, y + uy, z + uz, 5, r, g, b); vtx(x + rx, y + ry, z + rz, 5, r, g, b); vtx(x - ux, y - uy, z - uz, 5, r, g, b);
    vtx(x + ux, y + uy, z + uz, 5, r, g, b); vtx(x - ux, y - uy, z - uz, 5, r, g, b); vtx(x - rx, y - ry, z - rz, 5, r, g, b);
}

function depthOf(x, y, z) {
    const Z = space.zUnitVec;
    return (x - space.Xc) * Z[0] + (y - space.Yc) * Z[1] + (z - space.Zc) * Z[2];
}

// world point -> CSS pixel, using the same projection as the shader
function project(x, y, z) {
    const X = space.xUnitVec, Y = space.yUnitVec;
    const dx = x - space.Xc, dy = y - space.Yc, dz = z - space.Zc;
    const zp = depthOf(x, y, z);
    if (zp < 1) return null;
    const mw = (zp * 0.1) / space.magnifier;
    const nx = ((dx * X[0] + dy * X[1] + dz * X[2]) / (mw * 16)) * aspectFix[0];
    const ny = ((dx * Y[0] + dy * Y[1] + dz * Y[2]) / (mw * 8)) * aspectFix[1];
    return [(nx * 0.5 + 0.5) * cssW, (0.5 - ny * 0.5) * cssH];
}

// static part of the buffer: sky backdrop + terrain grid (heights come from the vertex shader)
function buildStatic() {
    vc = 0;
    const SY = 900, SX = 2000, Z0 = -700, Z1 = 1500;
    vtx(-SX, SY, Z0, 3, 0, 0, 0); vtx(SX, SY, Z0, 3, 0, 0, 0); vtx(SX, SY, Z1, 3, 0, 0, 0);
    vtx(-SX, SY, Z0, 3, 0, 0, 0); vtx(SX, SY, Z1, 3, 0, 0, 0); vtx(-SX, SY, Z1, 3, 0, 0, 0);

    // one wide cell across the flat river, finer cells on the slopes, coarse far away
    const xs = [];
    for (let x = -283; x < -83; x += 20) xs.push(x);
    for (let x = -83; x <= -13; x += 5) xs.push(x);
    for (let x = 13; x <= 83; x += 5) xs.push(x);
    for (let x = 103; x <= 283; x += 20) xs.push(x);
    for (let i = 0; i < 50; i++) {
        const y0 = -2 + i * 5, y1 = y0 + 5;
        for (let j = 0; j < xs.length - 1; j++) {
            const x0 = xs[j], x1 = xs[j + 1];
            vtx(x0, y0, 0, 2, 0, 0, 0); vtx(x1, y0, 0, 2, 0, 0, 0); vtx(x1, y1, 0, 2, 0, 0, 0);
            vtx(x0, y0, 0, 2, 0, 0, 0); vtx(x1, y1, 0, 2, 0, 0, 0); vtx(x0, y1, 0, 2, 0, 0, 0);
        }
    }
    return vc;
}
const STATIC_V = buildStatic();

// ------------------------------------------------------------------ game state

const S = {
    state: "title", paused: false, time: 0, timeScale: 1,
    dist: 0,          // total scroll (drives the scenery, never resets)
    run: 0,           // distance in the current run
    speed: 26, speedFrac: 0, nextAt: 0,
    score: 0, bonus: 0, embers: 0, streak: 0, lives: 3, shield: false,
    invuln: 0, penalty: 0, deathT: 0, jumpBuffer: 0, trailAcc: 0,
    best: Number(load("borealis-best", 0)) || 0,
};
const ship = { x: 0, tx: 0, vx: 0, z: HOVER, zv: HOVER, vz: 0, grounded: true, roll: 0, pitch: 0, alive: true, M: I3 };
const cam = { x: 0, shake: 0 };
const objs = [];
const parts = [];
const flakes = [];
const sound = new Sound(load("borealis-muted", "0") === "1");

const difficulty = () => clamp(S.run / 7000, 0, 1);
const multiplier = () => Math.min(5, 1 + Math.floor(S.streak / 5));

function newFlake(anywhere) {
    return { x: rand(-46, 46), y: anywhere ? rand(-2, 190) : rand(185, 200), z: rand(0.4, 24), s: rand(0.07, 0.15), ph: rand(0, TAU) };
}
for (let i = 0; i < 150; i++) flakes.push(newFlake(true));

// ------------------------------------------------------------------ obstacle patterns

function addObj(type, x, y, z = 0, extra = {}) {
    objs.push(Object.assign({ type, x, y, z, prevY: y, spin: Math.random() * TAU, alive: true }, extra));
}
const addSpire = (x, y) => addObj("spire", x, y, 0, { h: rand(6.5, 8.8) });
const addEmber = (x, y, z = HOVER + 0.35) => addObj("ember", x, y, z);

const PATTERNS = {
    trail(y0) {
        const phase = rand(0, TAU), amp = rand(5, 9);
        const shieldAt = !S.shield && S.run > 700 && Math.random() < 0.3 ? 4 : -1;
        for (let i = 0; i < 8; i++) {
            const x = Math.sin(phase + i * 0.55) * amp;
            if (i === shieldAt) addObj("shield", x, y0 + i * 7, HOVER + 0.6);
            else addEmber(x, y0 + i * 7);
        }
        return 56;
    },
    spires(y0, d) {
        const gap = rand(-7.5, 7.5);
        const count = 2 + (Math.random() < 0.3 + d * 0.5 ? 1 : 0);
        const xs = [];
        for (let tries = 0; xs.length < count && tries < 40; tries++) {
            const x = rand(-ROAD_HALF + 0.5, ROAD_HALF - 0.5);
            if (Math.abs(x - gap) < 3.6 || xs.some((o) => Math.abs(o - x) < 4.2)) continue;
            xs.push(x);
        }
        xs.forEach((x) => addSpire(x, y0 + rand(0, 6)));
        addEmber(gap, y0 + 2);
        return 14;
    },
    wall(y0) {
        addObj("wall", 0, y0, 0, { w: 26 });
        const ex = rand(-6, 6);
        for (let k = -2; k <= 2; k++) addEmber(ex, y0 + k * 4.5, HOVER + 0.3 + 2.3 * (1 - (k / 2.6) ** 2));
        return 16;
    },
    halfWall(y0, d) {
        const s = Math.random() < 0.5 ? -1 : 1;
        addObj("wall", s * 6.6, y0, 0, { w: 13.4 });
        for (let i = 0; i < 4; i++) addEmber(-s * 6.2, y0 - 6 + i * 5);
        if (d > 0.4) addSpire(-s * rand(8, 10.5), y0 + 26);
        return d > 0.4 ? 30 : 16;
    },
    slalom(y0, d) {
        const n = 3 + Math.round(d * 2);
        let side = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < n; i++, side = -side) {
            addSpire(side * rand(3.2, 7.5), y0 + i * 19);
            addEmber(-side * 5.5, y0 + i * 19);
        }
        return n * 19;
    },
    needle(y0) {
        const gx = rand(-6.5, 6.5);
        addSpire(gx - 3.7, y0);
        addSpire(gx + 3.7, y0);
        addEmber(gx, y0);
        addEmber(gx, y0 + 5);
        const other = gx > 0 ? rand(-10.5, gx - 8) : rand(gx + 8, 10.5);
        if (Math.abs(other - gx) > 7.5) addSpire(other, y0 + rand(8, 14));
        return 16;
    },
};

let lastPattern = "";
function spawnPattern(y0) {
    const d = difficulty();
    const table = [["trail", 1.2 - d * 0.6], ["spires", 1.0], ["wall", 0.6 + d * 0.3],
        ["halfWall", 0.3 + d * 0.6], ["slalom", 0.15 + d * 0.9], ["needle", 0.1 + d * 0.9]];
    const options = table.filter(([name]) => name !== lastPattern);
    let r = Math.random() * options.reduce((s, [, w]) => s + w, 0);
    let pick = options[0][0];
    for (const [name, w] of options) { r -= w; if (r <= 0) { pick = name; break; } }
    lastPattern = pick;
    return PATTERNS[pick](y0, d);
}

// ------------------------------------------------------------------ effects

function burst(x, y, z, n, colors, speed = 9, size = 0.2, life = 0.9, grav = 14) {
    for (let i = 0; i < n; i++) {
        const u = rand(-1, 1), a = rand(0, TAU), r = Math.sqrt(1 - u * u), sp = speed * rand(0.35, 1);
        parts.push({
            x, y, z, vx: r * Math.cos(a) * sp, vy: r * Math.sin(a) * sp, vz: Math.abs(u) * sp * 0.9 + 2,
            life: life * rand(0.6, 1), max: life, s: size * rand(0.6, 1.3), c: colors[i % colors.length], grav, trail: false,
        });
    }
    if (parts.length > 420) parts.splice(0, parts.length - 420);
}

function popup(text, x, y, z, cls = "") {
    const p = project(x, y, z);
    if (!p) return;
    const div = document.createElement("div");
    div.className = "pop " + cls;
    div.textContent = text;
    div.style.left = p[0] + "px";
    div.style.top = p[1] + "px";
    el.pops.appendChild(div);
    setTimeout(() => div.remove(), 1000);
}

function flash() {
    el.flash.classList.remove("go");
    void el.flash.offsetWidth;
    el.flash.classList.add("go");
}

// ------------------------------------------------------------------ gameplay events

function reward(points, label, x, y, z, cls) {
    S.bonus += points;
    popup(label + " +" + points, x, y, z, cls);
}

function collide(o) {
    const dx = Math.abs(o.x - ship.x);
    if (o.type === "spire") {
        if (dx < 1.9) {
            o.alive = false;
            burst(o.x, 0.5, 3, 26, [[0.85, 0.95, 1], [0.6, 0.72, 1], [1, 1, 1]], 11, 0.26, 1.1, 16);
            hurt();
        } else if (dx < 3.7) {
            reward(30, "Close call", o.x, 0, 3.5, "cool");
            sound.near();
        }
    } else if (o.type === "wall") {
        if (dx < o.w / 2 + 1.0) {
            if (ship.z - 0.4 < WALL_H) {
                burst(ship.x, 0.6, 1.4, 22, [[0.6, 0.9, 1], [0.9, 0.97, 1]], 9, 0.22, 0.9, 14);
                hurt();
            } else {
                reward(20, "Cleared", ship.x, 0, ship.z + 1.4, "cool");
            }
        }
    } else if (dx < 2.2 && Math.abs(o.z - ship.z) < 2.0) {
        o.alive = false;
        if (o.type === "ember") {
            S.embers++;
            S.streak++;
            const pts = 10 * multiplier();
            S.bonus += pts;
            burst(o.x, 0, o.z, 14, [[1, 0.8, 0.4], [1, 0.6, 0.25], [1, 0.95, 0.7]], 6, 0.16, 0.6, 6);
            popup("+" + pts, o.x, 0, o.z + 1.2);
            sound.ember(S.streak);
        } else {
            S.shield = true;
            burst(o.x, 0, o.z, 24, [[0.4, 1, 0.75], [0.62, 0.5, 1]], 7, 0.2, 0.8, 6);
            popup("Shield up", o.x, 0, o.z + 1.6, "aurora");
            sound.shield();
            renderLives();
        }
    }
}

function hurt() {
    if (S.invuln > 0) return;
    if (S.shield) {
        S.shield = false;
        S.invuln = 1.0;
        cam.shake = 0.5;
        burst(ship.x, 0, ship.z, 24, [[0.4, 1, 0.75], [0.62, 0.5, 1]], 10, 0.2, 0.8, 8);
        popup("Shield broke", ship.x, 0, ship.z + 1.6, "aurora");
        sound.shieldBreak();
        renderLives();
        return;
    }
    S.lives--;
    S.streak = 0;
    S.invuln = 1.8;
    S.penalty = 0.5;
    cam.shake = 1.1;
    flash();
    sound.hit();
    renderLives();
    if (navigator.vibrate) navigator.vibrate(S.lives > 0 ? 60 : [80, 40, 160]);
    if (S.lives <= 0) die();
}

function die() {
    ship.alive = false;
    S.timeScale = 0.35;
    S.deathT = 0;
    burst(ship.x, 0, ship.z, 70, [[1, 1, 1], [0.4, 1, 0.78], [0.62, 0.5, 1], [1, 0.72, 0.38]], 14, 0.26, 1.6, 12);
    sound.over();
}

function jump() {
    if (S.state !== "play" || S.paused || !ship.alive) return;
    if (!ship.grounded) { S.jumpBuffer = 0.14; return; }
    ship.vz = 13.5;
    ship.grounded = false;
    S.jumpBuffer = 0;
    sound.jump();
    burst(ship.x, -0.6, 0.4, 8, [[0.85, 0.92, 1]], 4, 0.13, 0.45, 10);
}

// ------------------------------------------------------------------ update

const keys = { l: 0, r: 0 };

function updateShip(dt) {
    if (!ship.alive) return;
    if (S.state === "title" || S.state === "over") {
        ship.tx = Math.sin(S.time * 0.45) * 7 + Math.sin(S.time * 1.1) * 2;
    } else {
        ship.tx = clamp(ship.tx + (keys.r - keys.l) * 30 * dt, -ROAD_HALF, ROAD_HALF);
    }
    const want = clamp((ship.tx - ship.x) * 9, -42, 42);
    ship.vx += (want - ship.vx) * Math.min(1, dt * 12);
    ship.x += ship.vx * dt;
    ship.roll += (clamp(ship.vx * 0.02, -0.75, 0.75) - ship.roll) * Math.min(1, dt * 8);

    if (!ship.grounded) {
        ship.vz -= 36 * dt;
        ship.z += ship.vz * dt;
        if (ship.z <= HOVER) {
            ship.z = HOVER;
            ship.vz = 0;
            ship.grounded = true;
            sound.land();
            burst(ship.x, -0.4, 0.3, 10, [[0.85, 0.92, 1], [0.7, 0.85, 1]], 4, 0.14, 0.5, 10);
            if (S.jumpBuffer > 0) jump();
        }
    }
    ship.pitch += (clamp(ship.vz * 0.035, -0.35, 0.45) - ship.pitch) * Math.min(1, dt * 10);
    ship.zv = ship.z + (ship.grounded ? Math.sin(S.time * 3) * 0.08 : 0);
    ship.M = rot(-ship.vx * 0.006, ship.pitch, ship.roll);

    // engine trail, left behind in the world
    S.trailAcc += dt * 60;
    while (S.trailAcc >= 1) {
        S.trailAcc--;
        for (const side of [-0.28, 0.28]) {
            const p = transformPoint(ship.M, [side, -1.6, 0.14], ship.x, 0, ship.zv);
            parts.push({ x: p[0], y: p[1], z: p[2], vx: rand(-0.4, 0.4), vy: -3, vz: rand(-0.2, 0.3),
                life: 0.5, max: 0.5, s: 0.15, c: null, grav: 0, trail: true });
        }
    }
}

function updateCamera(raw) {
    cam.x += (ship.x * 0.55 - cam.x) * Math.min(1, raw * 5);
    const sh = cam.shake;
    cam.shake *= Math.exp(-raw * 6);
    space.X0 = cam.x + (Math.random() - 0.5) * sh;
    // camera sits ~8 behind and ~5 above the glider, looking down on it so its top and nose show
    space.Y0 = 11.6;
    space.Z0 = 0.85 + (ship.z - HOVER) * 0.3 + (Math.random() - 0.5) * sh;
    space.alpha = -Math.PI / 2 - ship.vx * 0.0025;
    space.beta = 0.21;
    space.Rc = 20;
    const a = space.alpha, b = space.beta, r = space.Rc;
    space.Xc = space.X0 + Math.cos(b) * Math.cos(a) * r;
    space.Yc = space.Y0 + Math.cos(b) * Math.sin(a) * r;
    space.Zc = space.Z0 + Math.sin(b) * r;
    space.updateMyVectors();
}

function update(dt, raw) {
    S.time += dt;
    const playing = S.state === "play";
    if (playing && ship.alive) {
        S.penalty = Math.max(0, S.penalty - dt * 0.3);
        S.speed = (38 + 52 * Math.pow(difficulty(), 0.85)) * (1 - S.penalty);
    } else if (playing) {
        S.speed *= Math.exp(-raw * 1.5);
        S.deathT += raw;
        if (S.deathT > 1.6) gameOver();
    } else {
        S.speed = lerp(S.speed, S.state === "title" ? 26 : 14, Math.min(1, raw * 2));
    }
    S.speedFrac = clamp((S.speed - 38) / 52, 0, 1);

    const dy = S.speed * dt;
    S.dist += dy;
    if (playing && ship.alive) {
        S.run += dy;
        S.invuln = Math.max(0, S.invuln - dt);
        S.jumpBuffer = Math.max(0, S.jumpBuffer - dt);
        while (S.run + SPAWN_AHEAD > S.nextAt) {
            const len = spawnPattern(S.nextAt - S.run);
            S.nextAt += len + lerp(46, 22, difficulty());
        }
        S.score = Math.floor(S.run * 0.5) + S.bonus;
    }

    updateShip(dt);

    for (const o of objs) {
        o.prevY = o.y;
        o.y -= dy;
        o.spin += dt * (o.type === "spire" ? 0.5 : 2.2);
        if (S.state === "play" && ship.alive && o.alive && o.prevY > 0 && o.y <= 0) collide(o);
    }
    for (let i = objs.length - 1; i >= 0; i--) if (!objs[i].alive || objs[i].y < -6) objs.splice(i, 1);

    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        p.vz -= p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt - dy;
        p.z += p.vz * dt;
        if (p.z < 0.08) { p.z = 0.08; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
        if (p.life <= 0 || p.y < -6) parts.splice(i, 1);
    }

    for (const f of flakes) {
        f.y -= dy + 2 * dt;
        f.z -= 1.3 * dt;
        f.x += Math.sin(S.time * 0.8 + f.ph) * 0.9 * dt;
        if (f.y < -4 || f.z < 0) Object.assign(f, newFlake(false));
    }

    updateCamera(raw);
    if (playing) updateHud();
}

// ------------------------------------------------------------------ render

function drawLanterns(beat) {
    const off = S.dist % 20;
    for (let k = 0; k < 13; k++) {
        const y = k * 20 - off;
        if (y < -5) continue;
        for (const side of [-1, 1]) {
            const x = side * 15.5;
            emit(MESH.POLE, I3, x, y, 0, 1);
            const flicker = 0.85 + 0.15 * Math.sin(S.time * 9 + k * 1.7 + side) + 0.25 * beat;
            emit(MESH.LANTERN, I3, x, y, 3.1, 5, flicker);
        }
    }
}

function drawObjects(beat) {
    for (const o of objs) {
        if (!o.alive || o.y > SPAWN_AHEAD + 5 || o.y < -5) continue;
        if (o.type === "spire") {
            emit(MESH.SPIRE, rot(o.spin, 0, 0, 1.6, 1.6, o.h), o.x, o.y, 0, 1, 1.05);
            emit(MESH.FROST_RING, rot(o.spin * 0.5), o.x, o.y, 0.1, 5, 0.55 + 0.35 * beat);
        } else if (o.type === "wall") {
            const wide = o.w > 20;
            emit(wide ? MESH.WALL_WIDE : MESH.WALL_HALF, I3, o.x, o.y, 0, 1);
            emit(wide ? MESH.WALL_WIDE_GLOW : MESH.WALL_HALF_GLOW, I3, o.x, o.y, 0, 5, 0.8 + 0.5 * beat);
        } else if (o.type === "ember") {
            const z = o.z + Math.sin(S.time * 3 + o.spin) * 0.18;
            emit(MESH.EMBER, rot(o.spin, o.spin * 0.7, 0), o.x, o.y, z, 1, 1.35);
            emit(MESH.EMBER_RING, rot(o.spin * 1.3, 1.25, 0.2), o.x, o.y, z, 5, 0.9 + 0.3 * beat);
        } else {
            const z = o.z + Math.sin(S.time * 2.4 + o.spin) * 0.25;
            emit(MESH.SHIELD, rot(o.spin, 0, 0, 1, 1, 1.35), o.x, o.y, z, 1, 1.5);
            emit(MESH.SHIELD_RING, rot(o.spin * 1.6, 1.1, 0.4, 0.62, 0.62, 0.62), o.x, o.y, z, 5, 0.9);
        }
    }
}

function flameTri(a, b, tip) {
    if (vc + 3 > MAXV) return;
    vtx(a[0], a[1], a[2], 5, 0.85, 1, 0.95);
    vtx(b[0], b[1], b[2], 5, 0.85, 1, 0.95);
    vtx(tip[0], tip[1], tip[2], 5, 0.25, 0.85, 0.6);
}

function drawShip(beat) {
    if (!ship.alive) return;
    const lift = ship.z - HOVER, k = 1.5 / (1 + lift * 0.35);
    emit(MESH.SHADOW, rot(0, 0, 0, k, k * 1.4, 1), ship.x, -0.2, 0.12, 1);
    if (S.invuln > 0 && Math.floor(S.time * 14) % 2 === 0) return; // blink while recovering

    const M = ship.M, z = ship.zv;
    emit(MESH.GLIDER, M, ship.x, 0, z, 1, 1.05);
    emit(MESH.GLIDER_LIGHTS, M, ship.x, 0, z, 5, 1.1 + 0.3 * beat);
    const len = 0.9 + Math.random() * 0.35 + S.speedFrac * 0.8;
    const a = transformPoint(M, [-0.26, -1.48, 0.24], ship.x, 0, z);
    const b = transformPoint(M, [0.26, -1.48, 0.24], ship.x, 0, z);
    const c = transformPoint(M, [0, -1.48, 0.03], ship.x, 0, z);
    const tip = transformPoint(M, [0, -1.48 - len, 0.14], ship.x, 0, z);
    flameTri(a, b, tip); flameTri(b, c, tip); flameTri(c, a, tip);
    if (S.shield) {
        emit(MESH.SHIELD_RING, rot(S.time * 2.2, 1.2, 0.3), ship.x, 0, z + 0.2, 5, 0.9 + 0.4 * beat);
        emit(MESH.SHIELD_RING, rot(-S.time * 1.7, 0.3, 1.3), ship.x, 0, z + 0.2, 5, 0.7);
    }
}

function drawParticles() {
    for (const p of parts) {
        if (depthOf(p.x, p.y, p.z) < 2.5) continue;
        const t = Math.max(0, p.life / p.max);
        if (p.trail) {
            spark(p.x, p.y, p.z, p.s * (0.4 + 0.6 * t), lerp(0.6, 0.4, t), lerp(0.45, 1, t), lerp(1, 0.78, t));
        } else {
            spark(p.x, p.y, p.z, p.s * Math.min(1, t * 1.6), p.c[0], p.c[1], p.c[2]);
        }
    }
}

function drawSnow() {
    for (const f of flakes) {
        if (depthOf(f.x, f.y, f.z) < 3) continue;
        spark(f.x, f.y, f.z, f.s, 0.8, 0.88, 1.0);
    }
}

function render(beat) {
    vc = STATIC_V;
    drawLanterns(beat);
    drawObjects(beat);
    drawShip(beat);
    drawParticles();
    drawSnow();

    const bend = 0.0007 * Math.sin(S.dist * 0.0017) + 0.00035 * Math.sin(S.dist * 0.0041 + 1.3);
    gl.uniform1f(loc.scroll, S.dist % PERIOD);
    gl.uniform4f(loc.warp, 0.00042, bend, 1.5, S.time);
    gl.uniform1f(loc.time, S.time);
    gl.uniform1f(loc.beat, beat);
    gl.uniform2f(loc.ship, ship.x, ship.alive ? ship.z - HOVER : 40);
    gl.uniform2f(loc.fogRange, 70, 235);

    space.posArr = POS.subarray(0, vc * 4);
    space.colArr = COL.subarray(0, vc * 4);
    space.totalVert = vc;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.reDraw();
}

// ------------------------------------------------------------------ HUD and screens

let hudScore = -1, hudEmbers = -1, hudMult = 1;
function updateHud() {
    if (S.score !== hudScore) { hudScore = S.score; el.score.textContent = S.score.toLocaleString(); }
    if (S.embers !== hudEmbers) { hudEmbers = S.embers; el.embers.textContent = S.embers; }
    const m = multiplier();
    if (m !== hudMult) {
        hudMult = m;
        el.mult.textContent = m > 1 ? "\u00d7" + m : "";
        el.mult.classList.remove("bump");
        void el.mult.offsetWidth;
        el.mult.classList.add("bump");
    }
}

function renderLives() {
    el.lives.textContent = "";
    for (let i = 0; i < 3; i++) {
        const b = document.createElement("b");
        if (i >= S.lives) b.className = "lost";
        el.lives.appendChild(b);
    }
    if (S.shield) {
        const b = document.createElement("b");
        b.className = "shield";
        el.lives.appendChild(b);
    }
    el.lives.setAttribute("aria-label", S.lives + (S.lives === 1 ? " life" : " lives") + " left" + (S.shield ? ", shield on" : ""));
}

function show(screen) { screen.classList.remove("hidden"); screen.inert = false; }
function hide(screen) { screen.classList.add("hidden"); screen.inert = true; }

function showBest() {
    el.bestLine.hidden = S.best <= 0;
    el.bestLine.textContent = "Best run " + S.best.toLocaleString() + " points";
}

function goFullscreen() {
    const root = document.documentElement;
    if (!matchMedia("(pointer: coarse)").matches || document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen({ navigationUI: "hide" })
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {}))
        .catch(() => {});
}

function start() {
    sound.start();
    goFullscreen();
    objs.length = 0;
    parts.length = 0;
    Object.assign(S, {
        state: "play", paused: false, run: 0, nextAt: 110, score: 0, bonus: 0, embers: 0, streak: 0,
        lives: 3, shield: false, invuln: 0, penalty: 0, timeScale: 1, deathT: 0, jumpBuffer: 0,
    });
    Object.assign(ship, { tx: ship.x, vz: 0, z: HOVER, grounded: true, alive: true });
    lastPattern = "";
    hudScore = hudEmbers = -1;
    hudMult = 1;
    el.mult.textContent = "";
    renderLives();
    updateHud();
    hide(el.title); hide(el.over); hide(el.pause);
    el.hud.classList.add("on");
    canvas.focus({ preventScroll: true });
}

function gameOver() {
    S.state = "over";
    S.timeScale = 1;
    const isBest = S.score > S.best;
    if (isBest) { S.best = S.score; save("borealis-best", S.best); }
    el.finalScore.textContent = S.score.toLocaleString();
    el.finalNote.textContent = isBest ? "Your best run yet." : "Best run " + S.best.toLocaleString() + " points";
    el.statDist.textContent = Math.round(S.run).toLocaleString() + " m";
    el.statEmbers.textContent = S.embers;
    Object.assign(ship, { alive: true, z: HOVER, vz: 0, grounded: true, x: 0, tx: 0, vx: 0 });
    el.hud.classList.remove("on");
    show(el.over);
    $("againBtn").focus({ preventScroll: true });
}

function setPaused(p) {
    if (S.state !== "play" || !ship.alive) return;
    S.paused = p;
    if (p) { show(el.pause); sound.suspend(); $("resumeBtn").focus({ preventScroll: true }); }
    else { hide(el.pause); sound.resume(); canvas.focus({ preventScroll: true }); }
}

function setMuted(m) {
    sound.setMuted(m);
    save("borealis-muted", m ? "1" : "0");
    el.mute.setAttribute("aria-pressed", String(m));
    el.mute.setAttribute("aria-label", m ? "Turn sound on" : "Mute sound");
}

$("playBtn").addEventListener("click", start);
$("againBtn").addEventListener("click", start);
$("resumeBtn").addEventListener("click", () => setPaused(false));
$("pauseBtn").addEventListener("click", () => setPaused(!S.paused));
el.mute.addEventListener("click", () => setMuted(!sound.muted));
setMuted(sound.muted);
showBest();

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        if (S.state === "play" && ship.alive) setPaused(true);
        else sound.suspend();
    } else if (!S.paused) {
        sound.resume();
    }
});

// ------------------------------------------------------------------ input

window.addEventListener("keydown", (e) => {
    switch (e.code) {
        case "ArrowLeft": case "KeyA": keys.l = 1; break;
        case "ArrowRight": case "KeyD": keys.r = 1; break;
        case "Space": case "ArrowUp": case "KeyW":
            e.preventDefault();
            if (e.repeat) break;
            if (S.state === "play") { if (S.paused) setPaused(false); else jump(); }
            else start();
            break;
        case "Enter":
            if (S.state !== "play") { e.preventDefault(); start(); }
            break;
        case "Escape":
            setPaused(!S.paused);
            break;
    }
});
window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") keys.l = 0;
    if (e.code === "ArrowRight" || e.code === "KeyD") keys.r = 0;
});
window.addEventListener("blur", () => { keys.l = keys.r = 0; });

// drag anywhere to steer, flick up to jump; a second finger also jumps
const touch = { id: null, lastX: 0, anchorY: 0 };
canvas.addEventListener("pointerdown", (e) => {
    if (S.state !== "play" || S.paused) return;
    if (touch.id !== null && e.pointerId !== touch.id) { jump(); return; }
    touch.id = e.pointerId;
    touch.lastX = e.clientX;
    touch.anchorY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== touch.id || S.paused) return;
    const dx = e.clientX - touch.lastX;
    touch.lastX = e.clientX;
    ship.tx = clamp(ship.tx + dx * (32 / Math.max(320, cssW)), -ROAD_HALF, ROAD_HALF);
    if (e.clientY > touch.anchorY) touch.anchorY = e.clientY;
    if (touch.anchorY - e.clientY > 42) { jump(); touch.anchorY = e.clientY; }
});
const endTouch = (e) => { if (e.pointerId === touch.id) touch.id = null; };
canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------------ main loop

let last = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    adaptResolution(raw);
    if (!S.paused) update(raw * S.timeScale, raw);
    render(sound.beat());
}
updateCamera(0);
requestAnimationFrame(frame);
