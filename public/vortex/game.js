// Vortex - a neon tunnel runner built on the Space projection library.
// You skim the floor of a spinning tube; steering rolls the whole tunnel around you.
import Space from "./Space.js";
import { VERT, FRAG } from "./shaders.js";
import * as sfx from "./audio.js";

const $ = (id) => document.getElementById(id);

function fail(msg) {
    const e = $("err");
    e.textContent = msg;
    e.hidden = false;
    throw new Error(msg);
}

// ------------------------------------------------------------------ constants

const TAU = Math.PI * 2;
const R = 9;                 // tunnel radius
const CRAFT_Y = 10;          // craft sits this far ahead of the camera
const CRAFT_R = R - 1.15;    // and this far from the axis
const VIEW = 230;            // how far ahead things are drawn
const ROW = 4;               // tunnel ring spacing
const NA = 32;               // tunnel segments around
const MAXV = 70000;
const HULL = 3;

const ZONES = [
    { name: "Neon Throat", a: [0.1, 0.9, 1.0], b: [1.0, 0.22, 0.75] },
    { name: "Ultraviolet", a: [0.62, 0.36, 1.0], b: [1.0, 0.58, 0.16] },
    { name: "Verdant Coil", a: [0.3, 1.0, 0.45], b: [0.15, 0.72, 1.0] },
    { name: "Solar Core", a: [1.0, 0.28, 0.3], b: [1.0, 0.85, 0.3] },
];
const ZONE_LEN = 1500;

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
    aspect: U("uAspect"), roll: U("uRoll"), bend: U("uBend"),
    time: U("fTime"), scroll: U("fScroll"), beat: U("fBeat"), hit: U("fHit"),
    colA: U("fColA"), colB: U("fColB"), fog: U("fFog"), fogRange: U("fFogRange"),
};

let camBeta = 0.12;
// camera: just above the floor, looking down the tube (+y is forward, +z is up)
function placeCamera(shake) {
    const sx = (Math.random() - 0.5) * shake, sz = (Math.random() - 0.5) * shake;
    space.alpha = -Math.PI / 2;
    space.beta = camBeta;
    space.Rc = 14;
    space.Xc = sx;
    space.Yc = 0;
    space.Zc = -3.7 + sz;
    space.X0 = space.Xc;
    space.Y0 = space.Yc + Math.cos(space.beta) * space.Rc;
    space.Z0 = space.Zc - Math.sin(space.beta) * space.Rc;
    space.updateMyVectors();
}
placeCamera(0);

// ------------------------------------------------------------------ canvas size

const dprScale = Math.min(window.devicePixelRatio || 1, 2);
let cssW = 1, cssH = 1, aspectFix = [1, 1];

function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dprScale);
    canvas.height = Math.round(cssH * dprScale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Space's projection assumes a 2:1 screen; correct it for whatever shape we have
    const a = cssW / cssH;
    aspectFix = a >= 2 ? [2 / a, 1] : a >= 1 ? [1, a / 2] : [1.9, a * 0.95];
    // on tall screens zoom in and tip the view up so the craft sits low with the tunnel ahead of it
    camBeta = a >= 1 ? 0.12 : -0.05;
    gl.uniform2fv(loc.aspect, new Float32Array(aspectFix));
}
window.addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------ vertex buffer helpers

const POS = new Float32Array(MAXV * 4);
const COL = new Float32Array(MAXV * 4);
let vc = 0;

function vtx(x, y, z, m, r, g, b, a = 0) {
    const o = vc << 2;
    POS[o] = x; POS[o + 1] = y; POS[o + 2] = z; POS[o + 3] = m;
    COL[o] = r; COL[o + 1] = g; COL[o + 2] = b; COL[o + 3] = a;
    vc++;
}

function quad(p0, p1, p2, p3, m, c, a0 = 0, a1 = 0, a2 = 0, a3 = 0) {
    vtx(p0[0], p0[1], p0[2], m, c[0], c[1], c[2], a0);
    vtx(p1[0], p1[1], p1[2], m, c[0], c[1], c[2], a1);
    vtx(p2[0], p2[1], p2[2], m, c[0], c[1], c[2], a2);
    vtx(p0[0], p0[1], p0[2], m, c[0], c[1], c[2], a0);
    vtx(p2[0], p2[1], p2[2], m, c[0], c[1], c[2], a2);
    vtx(p3[0], p3[1], p3[2], m, c[0], c[1], c[2], a3);
}

// tunnel angle -> world point, with the current roll applied
let roll = 0;
function tp(phi, r, y) {
    const s = phi + roll;
    return [r * Math.cos(s), y, r * Math.sin(s)];
}

// camera-facing diamond for particles
function spark(x, y, z, s, r, g, b) {
    if (vc + 6 > MAXV) return;
    const Rt = space.xUnitVec, Up = space.yUnitVec;
    const rx = Rt[0] * s, ry = Rt[1] * s, rz = Rt[2] * s, ux = Up[0] * s, uy = Up[1] * s, uz = Up[2] * s;
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

// static tunnel: unrolled rings, the shader spins them by uRoll
function buildStatic() {
    vc = 0;
    const white = [1, 1, 1];
    for (let y = -4; y < VIEW + 40; y += ROW) {
        for (let i = 0; i < NA; i++) {
            const a0 = (i / NA) * TAU, a1 = ((i + 1) / NA) * TAU;
            const p = (a, yy) => [R * Math.cos(a), yy, R * Math.sin(a)];
            quad(p(a0, y), p(a1, y), p(a1, y + ROW), p(a0, y + ROW), 2, white);
        }
    }
    return vc;
}
const STATIC_V = buildStatic();

// ------------------------------------------------------------------ game state

const S = {
    mode: "title",     // title | play | pause | over
    time: 0, dist: 0, speed: 26,
    score: 0, orbs: 0, streak: 0, best: 0,
    zone: 0, hitFlash: 0, beat: 0, shake: 0, slow: 1,
};
const craft = { theta: 0, omega: 0, bank: 0, hull: HULL, shield: false, invuln: 0, alive: true };
let obstacles = [], orbs = [], pickups = [], particles = [], streaks = [];
let nextSpawn = 0, overTimer = 0;
const colA = ZONES[0].a.slice(), colB = ZONES[0].b.slice();

try { S.best = +localStorage.getItem("vortex.best") || 0; } catch { S.best = 0; }
try { sfx.setMuted(localStorage.getItem("vortex.muted") === "1"); } catch { /* storage blocked */ }

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => ((a % TAU) + TAU) % TAU;
// is angle x inside the arc [a0, a1] (a1 > a0, width < TAU), widened by m?
function inArc(x, a0, a1, m) {
    const d = wrap(x - (a0 - m));
    return d <= (a1 - a0) + 2 * m;
}
// angular distance from x to the arc [a0, a1] (0 if inside)
function arcDist(x, a0, a1) {
    if (inArc(x, a0, a1, 0)) return 0;
    const d0 = Math.abs(wrap(x - a0 + Math.PI) - Math.PI);
    const d1 = Math.abs(wrap(x - a1 + Math.PI) - Math.PI);
    return Math.min(d0, d1);
}

function difficulty() { return Math.min(S.dist / 7000, 1); }

// ------------------------------------------------------------------ level generation

function addOb(y, segs, spin = 0, h = 3.6) {
    obstacles.push({ y, segs, spin, h, t: 2.2, passed: false, hit: false, phase: rand(0, TAU) });
}
function addOrbArc(y, a, n, da = 0, step = 4) {
    for (let i = 0; i < n; i++) orbs.push({ y: y + i * step, a: a + da * i, taken: false });
}

function spawnPattern(y) {
    const d = difficulty();
    const pick = Math.random();
    const base = rand(0, TAU);
    let len = 0;

    if (y < 150) {
        // gentle opener
        addOb(y, [[base, base + 1.1]]);
        addOrbArc(y + 14, base + Math.PI, 5, 0.18);
        return 30;
    }
    if (pick < 0.2) {
        const w = rand(0.9, 1.5);
        addOb(y, [[base, base + w]]);
        addOrbArc(y - 12, base + w + 0.6, 4, 0);
        len = 0;
    } else if (pick < 0.38) {
        const w = rand(1.0, 1.35 + d * 0.3);
        addOb(y, [[base, base + w], [base + Math.PI, base + Math.PI + w]]);
        addOrbArc(y, base + w + (Math.PI - w) / 2, 1);
    } else if (pick < 0.56) {
        const gap = 1.7 - d * 0.75;
        addOb(y, [[base + gap, base + TAU]]);
        addOrbArc(y - 8, base + gap / 2, 3, 0);
    } else if (pick < 0.7 && d > 0.08) {
        const n = 3, w = 0.75 + d * 0.25, spin = rand(0.7, 1.1 + d) * (Math.random() < 0.5 ? -1 : 1);
        const segs = [];
        for (let i = 0; i < n; i++) segs.push([base + (i * TAU) / n, base + (i * TAU) / n + w]);
        addOb(y, segs, spin);
    } else if (pick < 0.84 && d > 0.2) {
        // corridor: gates whose gap drifts sideways
        const gap = 1.6 - d * 0.55, dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < 4; i++) {
            const g0 = base + dir * i * 0.55;
            addOb(y + i * 15, [[g0 + gap, g0 + TAU]]);
            addOrbArc(y + i * 15, g0 + gap / 2, 1);
        }
        len = 45;
    } else if (d > 0.35) {
        // fan of thin blades
        const n = 5, w = 0.5 + d * 0.15, spin = d > 0.6 ? rand(-0.5, 0.5) : 0;
        const segs = [];
        for (let i = 0; i < n; i++) segs.push([base + (i * TAU) / n, base + (i * TAU) / n + w]);
        addOb(y, segs, spin);
    } else {
        // spiral of orbs, free space to breathe
        addOrbArc(y, base, 10, 0.32, 3);
        len = 20;
    }
    if (Math.random() < 0.06 + d * 0.04 && !craft.shield) pickups.push({ y: y + len + 16, a: rand(0, TAU), taken: false });
    return len + 44 - d * 20;
}

function fillAhead() {
    while (nextSpawn < S.dist + VIEW) nextSpawn += spawnPattern(nextSpawn);
}

// ------------------------------------------------------------------ effects

function burst(x, y, z, n, c, spd = 12, size = 0.25) {
    for (let i = 0; i < n; i++) {
        const u = rand(-1, 1), th = rand(0, TAU), s = rand(0.3, 1) * spd, q = Math.sqrt(1 - u * u);
        particles.push({ x, y, z, vx: q * Math.cos(th) * s, vy: u * s, vz: q * Math.sin(th) * s, life: rand(0.4, 0.9), max: 0.9, c, size });
    }
}

const popsEl = $("pops");
function pop(text, x, y, z, cls = "") {
    const p = project(x, y, z);
    if (!p) return;
    const d = document.createElement("div");
    d.className = "pop " + cls;
    d.textContent = text;
    d.style.left = p[0] + "px";
    d.style.top = p[1] + "px";
    popsEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
}
function banner(text, sub) {
    const b = $("banner");
    b.innerHTML = "";
    const t = document.createElement("strong"); t.textContent = text;
    const s = document.createElement("span"); s.textContent = sub;
    b.append(t, s);
    b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
}
function flash() { const f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }

function craftWorld() { return [0, CRAFT_Y, -CRAFT_R]; }

// ------------------------------------------------------------------ input

const keys = new Set();
const touches = new Map();
window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(e.code)) { keys.add(e.code); e.preventDefault(); }
    if (e.code === "Escape" || e.code === "KeyP") { if (S.mode === "play") pause(); else if (S.mode === "pause") resume(); }
    if ((e.code === "Space" || e.code === "Enter") && (S.mode === "title" || S.mode === "over")) { e.preventDefault(); start(); }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); touches.clear(); if (S.mode === "play") pause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && S.mode === "play") pause(); });

canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, e.clientX);
    sfx.unlock();
});
canvas.addEventListener("pointermove", (e) => { if (touches.has(e.pointerId)) touches.set(e.pointerId, e.clientX); });
const lift = (e) => touches.delete(e.pointerId);
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function steerInput() {
    let s = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) s -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) s += 1;
    for (const x of touches.values()) s += x < cssW / 2 ? -1 : 1;
    // Space's screen-right is world -x, so rolling "left" means a growing tunnel angle
    return -Math.max(-1, Math.min(1, s));
}

// ------------------------------------------------------------------ update

function crash(ob) {
    const [cx, cy, cz] = craftWorld();
    ob.hit = true;
    if (craft.invuln > 0) return;
    S.streak = 0;
    if (craft.shield) {
        craft.shield = false;
        craft.invuln = 1.0;
        burst(cx, cy, cz, 40, [0.4, 1, 0.7], 14);
        pop("SHIELD", cx, cy, cz + 2, "green");
        sfx.shieldBreak();
        S.shake = 0.4;
        return;
    }
    craft.hull--;
    craft.invuln = 1.6;
    S.hitFlash = 1;
    S.shake = 0.9;
    S.slow = 0.55;
    burst(cx, cy, cz, 50, [1, 0.45, 0.25], 16);
    flash();
    if (navigator.vibrate) try { navigator.vibrate(120); } catch { /* ignore */ }
    if (craft.hull <= 0) {
        craft.alive = false;
        burst(cx, cy, cz, 140, colB.slice(), 24, 0.35);
        burst(cx, cy, cz, 80, [1, 1, 1], 18, 0.2);
        sfx.crash();
        S.mode = "dying";
        overTimer = 1.4;
    } else {
        sfx.hit();
    }
}

function update(dt) {
    S.time += dt;
    S.beat = Math.pow(0.5 + 0.5 * Math.sin(S.time * Math.PI * 2 * 2.1), 3);
    S.hitFlash = Math.max(0, S.hitFlash - dt * 2.5);
    S.shake = Math.max(0, S.shake - dt * 2);
    const playing = S.mode === "play";

    // speed
    if (playing) {
        const target = 34 + Math.min(S.time * 0.9, 58);
        S.slow = Math.min(1, S.slow + dt * 0.5);
        S.speed += (target * S.slow - S.speed) * Math.min(1, dt * 2);
    } else if (S.mode === "title") {
        S.speed += (24 - S.speed) * Math.min(1, dt);
    } else if (S.mode === "dying") {
        S.speed *= Math.pow(0.15, dt);
    }
    const step = S.speed * dt;
    S.dist += step;

    // steering
    if (S.mode === "title") {
        craft.omega = Math.sin(S.time * 0.45) * 0.9;
    } else if (playing) {
        const maxW = 2.7 + Math.min(S.speed / 90, 1) * 0.9;
        const want = steerInput() * maxW;
        craft.omega += (want - craft.omega) * Math.min(1, dt * 11);
    } else {
        craft.omega *= Math.pow(0.05, dt);
    }
    craft.theta = wrap(craft.theta + craft.omega * dt);
    craft.bank += (-craft.omega * 0.22 - craft.bank) * Math.min(1, dt * 8);
    craft.invuln = Math.max(0, craft.invuln - dt);
    roll = -Math.PI / 2 - craft.theta;

    // zones
    const z = Math.floor(S.dist / ZONE_LEN);
    if (playing && z !== S.zone) {
        S.zone = z;
        const Z = ZONES[z % ZONES.length];
        banner(`Sector ${z + 1}`, Z.name);
        sfx.zone();
        S.score += 250;
    }
    const Zc = ZONES[S.zone % ZONES.length];
    for (let i = 0; i < 3; i++) {
        colA[i] += (Zc.a[i] - colA[i]) * Math.min(1, dt * 1.5);
        colB[i] += (Zc.b[i] - colB[i]) * Math.min(1, dt * 1.5);
    }

    if (playing || S.mode === "dying") fillAhead();

    // collisions: obstacles
    const [cx, cy, cz] = craftWorld();
    const craftAbs = S.dist + CRAFT_Y;
    for (const ob of obstacles) {
        const dy = ob.y - craftAbs;
        if (!craft.alive || ob.hit) continue;
        if (Math.abs(dy) < ob.t / 2 + 1.0) {
            for (const s of ob.segs) {
                const off = ob.spin * S.time + (ob.spin ? ob.phase : 0);
                if (inArc(craft.theta, s[0] + off, s[1] + off, 0.08)) { if (playing) crash(ob); break; }
            }
        } else if (dy < -ob.t / 2 - 1.0 && !ob.passed) {
            ob.passed = true;
            if (!playing) continue;
            let best = 9;
            for (const s of ob.segs) {
                const off = ob.spin * S.time + (ob.spin ? ob.phase : 0);
                best = Math.min(best, arcDist(craft.theta, s[0] + off, s[1] + off));
            }
            if (best < 0.22) {
                const bonus = 25 * multiplier();
                S.score += bonus;
                pop(`CLOSE +${bonus}`, cx, cy + 2, cz + 2.4, "cool");
                sfx.nearMiss();
            }
        }
    }
    obstacles = obstacles.filter((o) => o.y - S.dist > -8);

    // orbs and pickups
    for (const o of orbs) {
        if (o.taken || !craft.alive) continue;
        const dy = o.y - craftAbs;
        if (Math.abs(dy) < 1.5 && arcDist(craft.theta, o.a, o.a) < 0.2 && playing) {
            o.taken = true;
            S.orbs++;
            S.streak++;
            const pts = 10 * multiplier();
            S.score += pts;
            const [x, y, zz] = tp(o.a, CRAFT_R, o.y - S.dist);
            burst(x, y, zz, 14, colB.slice(), 8, 0.18);
            if (S.streak % 5 === 0 && multiplier() > 1) { bumpMult(); pop(`x${multiplier()}`, x, y + 1, zz + 2.5, "cool"); }
            sfx.orb(S.streak % 11);
        }
    }
    orbs = orbs.filter((o) => o.y - S.dist > -6 && !o.taken);
    for (const p of pickups) {
        if (p.taken || !craft.alive) continue;
        const dy = p.y - craftAbs;
        if (Math.abs(dy) < 1.8 && arcDist(craft.theta, p.a, p.a) < 0.26 && playing) {
            p.taken = true;
            craft.shield = true;
            const [x, y, zz] = tp(p.a, CRAFT_R, p.y - S.dist);
            burst(x, y, zz, 30, [0.4, 1, 0.7], 10);
            pop("SHIELD UP", x, y + 1, zz + 2.5, "green");
            sfx.shield();
        }
    }
    pickups = pickups.filter((p) => p.y - S.dist > -6 && !p.taken);

    // particles live in screen space; scroll them past with the world
    for (const p of particles) {
        p.x += p.vx * dt; p.y += p.vy * dt - step; p.z += p.vz * dt;
        p.vx *= 0.97; p.vy *= 0.97; p.vz *= 0.97;
        p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    if (craft.alive && S.mode !== "over") {
        // engine exhaust
        const n = Math.random() < 0.8 ? 2 : 1;
        for (let i = 0; i < n; i++) particles.push({
            x: cx + rand(-0.15, 0.15), y: cy - 1.2, z: cz + rand(-0.05, 0.2),
            vx: rand(-0.6, 0.6), vy: -rand(2, 5), vz: rand(-0.3, 0.3), life: rand(0.08, 0.2), max: 0.2,
            c: colA.slice(), size: 0.07,
        });
    }

    // speed streaks drifting along the walls
    while (streaks.length < 70) streaks.push({ a: rand(0, TAU), r: rand(R * 0.35, R - 0.4), y: rand(0, VIEW) });
    for (const s of streaks) { s.y -= step * 0.6; if (s.y < -2) { s.y += VIEW; s.a = rand(0, TAU); } }

    // score from distance
    if (playing) S.score += Math.round(step * multiplier() * 0.5 * 10) / 10;

    if (S.mode === "dying") {
        overTimer -= dt;
        if (overTimer <= 0) gameOver();
    }
}

function multiplier() { return Math.min(1 + Math.floor(S.streak / 5), 5); }
function bumpMult() { const m = $("mult"); m.classList.remove("bump"); void m.offsetWidth; m.classList.add("bump"); }

// ------------------------------------------------------------------ drawing

function drawSector(yRel, a0, a1, h, t, c) {
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.13));
    const r0 = R + 0.25, r1 = R - h;
    const y0 = yRel - t / 2, y1 = yRel + t / 2;
    const cf = c, ci = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55], cc = [c[0] * 0.38, c[1] * 0.38, c[2] * 0.38];
    if (vc + n * 12 + 12 > MAXV) return;
    for (let i = 0; i < n; i++) {
        const p = a0 + ((a1 - a0) * i) / n, q = a0 + ((a1 - a0) * (i + 1)) / n;
        // front face, with a neon rim along the inner edge (col.a = 1 there)
        quad(tp(p, r0, y0), tp(q, r0, y0), tp(q, r1, y0), tp(p, r1, y0), 1, cf, 0, 0, 1, 1);
        // inner face
        quad(tp(p, r1, y0), tp(q, r1, y0), tp(q, r1, y1), tp(p, r1, y1), 1, ci, 0.95, 0.95, 0.3, 0.3);
    }
    quad(tp(a0, r0, y0), tp(a0, r1, y0), tp(a0, r1, y1), tp(a0, r0, y1), 1, cc, 0, 0.9, 0.9, 0);
    quad(tp(a1, r0, y0), tp(a1, r1, y0), tp(a1, r1, y1), tp(a1, r0, y1), 1, cc, 0, 0.9, 0.9, 0);
}

function drawObstacles() {
    const base = [0.06 + colA[0] * 0.2, 0.06 + colA[1] * 0.2, 0.1 + colA[2] * 0.22];
    for (const ob of obstacles) {
        const yRel = ob.y - S.dist;
        if (yRel > VIEW || yRel < -4) continue;
        const off = ob.spin * S.time + (ob.spin ? ob.phase : 0);
        const c = ob.hit ? [0.35, 0.05, 0.08] : base;
        // once behind the craft, walls sink back into the tunnel instead of swallowing the camera
        const h = ob.h * Math.min(1, Math.max(0.02, (yRel - 1.5) / 6.5));
        for (const s of ob.segs) drawSector(yRel, s[0] + off, s[1] + off, h, ob.t, c);
    }
}

// small spinning octahedron
function gem(x, y, z, s, spin, c, m = 5) {
    const ca = Math.cos(spin) * s, sa = Math.sin(spin) * s;
    const top = [x, y, z + s * 1.3], bot = [x, y, z - s * 1.3];
    const ring = [[x + ca, y + sa, z], [x - sa, y + ca, z], [x - ca, y - sa, z], [x + sa, y - ca, z]];
    for (let i = 0; i < 4; i++) {
        const a = ring[i], b = ring[(i + 1) % 4];
        const k = 0.7 + 0.3 * ((i % 2) ? 1 : 0.6);
        const cc = [c[0] * k, c[1] * k, c[2] * k];
        vtx(...top, m, ...cc); vtx(...a, m, ...cc); vtx(...b, m, ...cc);
        const d = [c[0] * k * 0.7, c[1] * k * 0.7, c[2] * k * 0.7];
        vtx(...bot, m, ...d); vtx(...b, m, ...d); vtx(...a, m, ...d);
    }
}

function drawOrbs() {
    const gold = [1, 0.85, 0.35];
    for (const o of orbs) {
        const yRel = o.y - S.dist;
        if (yRel > VIEW || yRel < -2 || vc + 30 > MAXV) continue;
        const [x, y, z] = tp(o.a, CRAFT_R + 0.1, yRel);
        const bob = Math.sin(S.time * 4 + o.y) * 0.12;
        gem(x, y, z + bob, 0.42, S.time * 3 + o.y, gold);
    }
    for (const p of pickups) {
        const yRel = p.y - S.dist;
        if (yRel > VIEW || yRel < -2 || vc + 40 > MAXV) continue;
        const [x, y, z] = tp(p.a, CRAFT_R, yRel);
        const g = 0.8 + 0.2 * S.beat;
        gem(x, y, z, 0.7, -S.time * 2, [0.35 * g, 1 * g, 0.65 * g]);
        spark(x, y, z, 0.95 + 0.2 * S.beat, 0.08, 0.3, 0.18);
    }
}

// the craft: a dart built in its own frame (lx right, ly forward, lz up), banked by steering
const CRAFT_TRIS = [
    // [p0, p1, p2, colour]
    [[0, 2.3, 0.05], [-0.95, -1.1, 0], [0, -0.7, 0.42], 0],
    [[0, 2.3, 0.05], [0, -0.7, 0.42], [0.95, -1.1, 0], 0],
    [[0, 2.3, 0.05], [0.95, -1.1, 0], [0, -0.7, -0.2], 1],
    [[0, 2.3, 0.05], [0, -0.7, -0.2], [-0.95, -1.1, 0], 1],
    [[-0.95, -1.1, 0], [0, -0.7, -0.2], [0, -0.7, 0.42], 2],
    [[0.95, -1.1, 0], [0, -0.7, 0.42], [0, -0.7, -0.2], 2],
    // canopy
    [[0, 0.9, 0.2], [-0.22, -0.2, 0.28], [0, -0.35, 0.55], 3],
    [[0, 0.9, 0.2], [0, -0.35, 0.55], [0.22, -0.2, 0.28], 3],
];
const LIGHT = (() => { const v = [0.35, -0.4, 0.85]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

function drawCraft() {
    if (!craft.alive) return;
    if (craft.invuln > 0 && Math.floor(craft.invuln * 14) % 2 === 0) return;
    const [cx, cy, cz] = craftWorld();
    const cb = Math.cos(craft.bank), sb = Math.sin(craft.bank);
    const hover = Math.sin(S.time * 5) * 0.06;
    const tr = (p) => [cx + p[0] * cb - p[2] * sb, cy + p[1], cz + hover + p[0] * sb + p[2] * cb];
    const hull = [0.82, 0.88, 0.98], dark = [0.22, 0.25, 0.36];
    for (const [a, b, c, k] of CRAFT_TRIS) {
        const A = tr(a), B = tr(b), C = tr(c);
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
        const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const d = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        let col;
        if (k === 3) col = [colA[0] * 0.9, colA[1] * 0.9, colA[2] * 0.9];
        else if (k === 2) col = [colB[0] * 0.55, colB[1] * 0.55, colB[2] * 0.55];
        else { const base = k === 0 ? hull : dark; const s = 0.35 + 0.65 * d; col = [base[0] * s, base[1] * s, base[2] * s]; }
        vtx(...A, 4, ...col); vtx(...B, 4, ...col); vtx(...C, 4, ...col);
    }
    const eg = 0.5 + 0.3 * S.beat;
    spark(cx, cy - 1.0, cz + 0.12, 0.28, colA[0] * eg, colA[1] * eg, colA[2] * eg);
    if (craft.shield) {
        const g = 0.25 + 0.1 * S.beat;
        for (let i = 0; i < 10; i++) {
            const a = S.time * 2 + (i / 10) * TAU;
            spark(cx + Math.cos(a) * 1.6, cy + Math.sin(a) * 1.6, cz + 0.2, 0.14, 0.4, 1, 0.7);
        }
        spark(cx, cy - 0.2, cz + 0.1, 0.01, g, g, g);
    }
}

function drawParticles() {
    for (const p of particles) {
        if (depthOf(p.x, p.y, p.z) < 6) continue;
        const k = Math.max(0, p.life / p.max);
        spark(p.x, p.y, p.z, p.size * (0.5 + k), p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
    const len = 0.6 + S.speed * 0.045;
    const k = 0.35;
    for (const s of streaks) {
        if (vc + 6 > MAXV) break;
        const a = tp(s.a, s.r, s.y), b = tp(s.a, s.r, s.y + len);
        const w = 0.05;
        const nx = -Math.sin(s.a + roll) * w, nz = Math.cos(s.a + roll) * w;
        quad([a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz], 5,
            [colA[0] * k, colA[1] * k, colA[2] * k]);
    }
}

function render() {
    placeCamera(S.shake);
    vc = STATIC_V;
    drawObstacles();
    drawOrbs();
    drawCraft();
    drawParticles();

    const fog = [0.01 + colA[0] * 0.2, 0.01 + colA[1] * 0.2, 0.03 + colA[2] * 0.24];
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.uniform1f(loc.roll, roll);
    gl.uniform3f(loc.bend, 0.0011 * Math.sin(S.dist * 0.0021), 0.0008 * Math.sin(S.dist * 0.0013 + 1.7), 24);
    gl.uniform1f(loc.time, S.time);
    gl.uniform1f(loc.scroll, S.dist % 4800);
    gl.uniform1f(loc.beat, S.beat);
    gl.uniform1f(loc.hit, S.hitFlash * 0.35);
    gl.uniform3fv(loc.colA, new Float32Array(colA));
    gl.uniform3fv(loc.colB, new Float32Array(colB));
    gl.uniform3fv(loc.fog, new Float32Array(fog));
    gl.uniform2f(loc.fogRange, 60, VIEW - 10);

    space.posArr = POS.subarray(0, vc * 4);
    space.colArr = COL.subarray(0, vc * 4);
    space.totalVert = vc;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.reDraw();
}

// ------------------------------------------------------------------ HUD and screens

const el = {
    hud: $("hud"), score: $("score"), mult: $("mult"), hull: $("hull"), dist: $("dist"),
    title: $("title"), over: $("over"), pause: $("pause"),
    finalScore: $("finalScore"), finalNote: $("finalNote"), statDist: $("statDist"), statOrbs: $("statOrbs"), statSector: $("statSector"),
    bestLine: $("bestLine"), muteBtn: $("muteBtn"),
};
let hudScore = -1, hudMult = -1, hudHull = "", hudDist = -1;
function updateHud() {
    const sc = Math.floor(S.score);
    if (sc !== hudScore) { hudScore = sc; el.score.textContent = sc.toLocaleString(); }
    const m = multiplier();
    if (m !== hudMult) { hudMult = m; el.mult.textContent = m > 1 ? `x${m}` : ""; }
    const hs = `${craft.hull}|${craft.shield}`;
    if (hs !== hudHull) {
        hudHull = hs;
        el.hull.innerHTML = "";
        for (let i = 0; i < HULL; i++) { const b = document.createElement("b"); if (i >= craft.hull) b.className = "lost"; el.hull.appendChild(b); }
        if (craft.shield) { const b = document.createElement("b"); b.className = "shield"; el.hull.appendChild(b); }
        el.hull.setAttribute("aria-label", `${craft.hull} hull left${craft.shield ? ", shield up" : ""}`);
    }
    const d = Math.floor(S.dist / 10) * 10;
    if (d !== hudDist) { hudDist = d; el.dist.textContent = `${d.toLocaleString()} m`; }
}

function show(screen, on) {
    screen.classList.toggle("hidden", !on);
    screen.inert = !on;
}

function showBest() {
    if (S.best > 0) { el.bestLine.hidden = false; el.bestLine.textContent = `Best: ${Math.floor(S.best).toLocaleString()}`; }
}

function start() {
    sfx.unlock();
    Object.assign(S, { mode: "play", time: 0, dist: 0, speed: 30, score: 0, orbs: 0, streak: 0, zone: 0, hitFlash: 0, shake: 0, slow: 1 });
    Object.assign(craft, { theta: craft.theta, omega: 0, bank: 0, hull: HULL, shield: false, invuln: 0, alive: true });
    obstacles = []; orbs = []; pickups = []; particles = [];
    nextSpawn = 70;
    hudHull = "";
    show(el.title, false); show(el.over, false); show(el.pause, false);
    el.hud.classList.add("on");
    banner("Sector 1", ZONES[0].name);
    canvas.focus();
}

function gameOver() {
    S.mode = "over";
    const sc = Math.floor(S.score);
    const isBest = sc > S.best;
    if (isBest) { S.best = sc; try { localStorage.setItem("vortex.best", String(sc)); } catch { /* ignore */ } }
    el.finalScore.textContent = sc.toLocaleString();
    el.finalNote.textContent = isBest ? "New best run!" : `Best: ${Math.floor(S.best).toLocaleString()}`;
    el.statDist.textContent = `${Math.floor(S.dist).toLocaleString()} m`;
    el.statOrbs.textContent = S.orbs;
    el.statSector.textContent = `${S.zone + 1} · ${ZONES[S.zone % ZONES.length].name}`;
    el.hud.classList.remove("on");
    show(el.over, true);
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
    keys.clear(); touches.clear();
    last = performance.now();
    canvas.focus();
}

$("playBtn").addEventListener("click", start);
$("againBtn").addEventListener("click", start);
$("resumeBtn").addEventListener("click", resume);
$("pauseBtn").addEventListener("click", pause);
function syncMute() {
    const m = sfx.isMuted();
    el.muteBtn.setAttribute("aria-pressed", String(m));
    el.muteBtn.setAttribute("aria-label", m ? "Unmute sound" : "Mute sound");
}
el.muteBtn.addEventListener("click", () => {
    sfx.unlock();
    sfx.setMuted(!sfx.isMuted());
    try { localStorage.setItem("vortex.muted", sfx.isMuted() ? "1" : "0"); } catch { /* ignore */ }
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
    sfx.engine(Math.min(S.speed / 92, 1), S.mode === "play");
    render();
    if (S.mode === "play") updateHud();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

