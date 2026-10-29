// TIDEGLOW — a bioluminescent jellyfish's rise from the abyss to the evening surface.
// Rendered with the projection3d library (Space, via GameSpace) + a bloom post pass. See DESIGN.md.
//
// Frame: update() moves everything, render() rebuilds the dynamic mesh (jelly, halos, creatures, particles)
// and draws: background → static opaque → dynamic opaque → static additive → dynamic additive → post.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, mulberry32, clamp, lerp, smooth, mixc } from "./mesh.js";
import { World, DEPTH, ZONES, zoneAt, HALO_COUNT } from "./world.js";
import { Jelly } from "./jelly.js";
import { drawHalo, drawAngler, drawPuffer, makeSchools, drawSchools, makeSiphonophores, drawSiphonophores, curtainGap, drawCurtain, moraySegment, drawMoray, barracudaState, drawBarracuda } from "./creatures.js";

const Q = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(10, +Q.get("speed") || 1));       // test/demo fast-forward
const TUNE = {
    impulse: 3.9, cooldown: 0.5, drag: 1.45, sink: 0.6, turnKeys: 2.7, turnPointer: 6.0,
    drainDeep: 1.85 * (+Q.get("drain") || 1), drainTop: 1.25 * (+Q.get("drain") || 1), plankton: 1.6, halo: 10, bite: 30, sting: 18, inv: 1.5,
    curtain: 15, urchin: 14, moray: 22, barracuda: 20, anglerRange: 6.4,
    jellyR: 0.85, camDist: +Q.get("cam") || 24,
};
const ZONE_TINT = [[0.3, 0.85, 1.05], [0.6, 0.5, 1.15], [0.35, 1.05, 0.7], [1.1, 0.75, 0.45]];
const PLANKTON_COL = [[0.35, 1.0, 0.95], [0.6, 0.65, 1.25], [0.45, 1.15, 0.6], [1.25, 0.95, 0.45]];

// ------------------------------------------------------------------ canvas + library
const canvas = document.getElementById("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
if (!gl) { document.getElementById("nogl").classList.remove("hidden"); throw new Error("WebGL unavailable"); }
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
if (Q.has("nopost")) post.ok = false;
const audio = new Audio();

function sizeCanvas() {
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = innerWidth * innerHeight * dpr * dpr;
    if (px > 2.8e6) dpr *= Math.sqrt(2.8e6 / px);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    post.resize(canvas.width, canvas.height);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);

// ------------------------------------------------------------------ save
const save = (() => { try { return Object.assign({ best: 0, bestStars: 0, dives: 0 }, JSON.parse(localStorage.getItem("tideglow.save")) || {}); } catch { return { best: 0, bestStars: 0, dives: 0 }; } })();
const persist = () => { try { localStorage.setItem("tideglow.save", JSON.stringify(save)); } catch { } };

// ------------------------------------------------------------------ state
let state = "title";             // title | play | paused | dying | breach | over
let world, jelly, schools, sipho;
let light = 100, score = 0, combo = 0, bloomed = 0, eaten = 0, zone = 0, checkpoint = null, resumed = false;
let time = 0, stateT = 0, fade = 0, hurtFlash = 0, shake = 0;
let particles = [];
const stat = new Mesh(200000);
let statSolid = 0, statAdd = 0;
const cam = { x: 0, z: -DEPTH, vx: 0, lookZ: -DEPTH };

function newDive(seed) {
    world = new World(seed);
    const S = new Mesh(160000), A = new Mesh(20000);
    world.buildStatic(S, A);
    stat.reset(); stat.append(S); stat.append(A);
    statSolid = S.n; statAdd = A.n;
    space.setStatic(stat.pos, stat.col, stat.n);
    schools = makeSchools(world, seed);
    sipho = makeSiphonophores(world, seed);
    const z0 = Q.has("z") ? clamp(+Q.get("z"), -DEPTH + 6, -2) : -DEPTH + 6;
    jelly = new Jelly(world.routeX(z0), z0);
    light = 100; score = 0; combo = 0; bloomed = 0; eaten = 0; resumed = false; seen.clear();
    zone = zoneAt(z0); checkpoint = { z: z0, zone };
    particles = [];
    cam.x = jelly.x; cam.z = jelly.z + 2; cam.lookZ = cam.z;
    world.halos.forEach((h) => { if (h.z < z0) h.missed = true; });
}

// ------------------------------------------------------------------ input
const keys = new Set();
const pointer = { held: false, x: 0, y: 0, downAt: 0 };
let tapPulse = 0;
addEventListener("keydown", (e) => {
    audio.init();
    if (e.code === "KeyM") { ui.mute(audio.toggleMute()); return; }
    if ((e.code === "KeyP" || e.code === "Escape") && (state === "play" || state === "paused")) { togglePause(); return; }
    if (state === "title" && (e.code === "Space" || e.code === "Enter")) { start(); e.preventDefault(); return; }
    if (state === "over" && (e.code === "Enter")) { start(true); return; }
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); pointer.held = false; if (state === "play") togglePause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") togglePause(); });
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    if (state !== "play") return;
    pointer.held = true; pointer.x = e.clientX; pointer.y = e.clientY; pointer.downAt = time;
    tapPulse = 0.3;
    canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });
const release = () => { pointer.held = false; };
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// screen point → the play plane (y = 0)
function toPlane(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect);
    if (Math.abs(d[1]) < 1e-5) return null;
    const t = -space.Yc / d[1];
    return [space.Xc + d[0] * t, space.Zc + d[2] * t];
}

// from the title the dive built at boot is used (only the jelly moved); any later start builds a fresh canyon
function start(fresh = false) {
    audio.init();
    if (fresh) newDive(Q.has("seed") ? +Q.get("seed") : (Math.random() * 1e9) | 0);
    else { const z0 = checkpoint.z; jelly.reset(world.routeX(z0), z0); cam.x = jelly.x; cam.z = jelly.z + 2; }
    state = "play"; stateT = 0; fade = Math.min(fade, 0.4);
    save.dives++; persist();
    ui.show("hud");
    ui.banner(zone);
    audio.zone();
}
function togglePause() {
    if (state === "play") { state = "paused"; ui.show("paused"); }
    else if (state === "paused") { state = "play"; ui.show("hud"); }
}
function resume() {
    // back to the last checkpoint, at half the score
    const z = checkpoint.z;
    jelly.reset(world.routeX(z), z);
    light = 75; score = Math.floor(score / 2); combo = 0; resumed = true;
    for (const a of world.anglers) { a.state = "lurk"; a.x = a.hx; a.z = a.hz; a.y = a.hy; a.mouth = 0; a.eye = 0; a.cool = 1; }
    for (const m of world.morays) { m.state = "hide"; m.out = 0; m.eye = 0; m.cool = 1; }
    state = "play"; stateT = 0; fade = 0.3;
    cam.x = jelly.x; cam.z = jelly.z + 2;
    ui.show("hud");
}

// ------------------------------------------------------------------ particles
function burst(x, y, z, n, col, speed, life, size, up = 0) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, b = (Math.random() - 0.5) * 2, s = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, z, vx: Math.cos(a) * s, vy: b * s * 0.4, vz: Math.sin(a) * s + up, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.6), c: col, drag: 1.6 });
    }
}

// ------------------------------------------------------------------ gameplay
function hurt(amount, fromX, fromZ, label = "") {
    if (jelly.inv > 0) return;
    light -= amount;
    jelly.hurtT = 1; jelly.inv = TUNE.inv;
    hurtFlash = 1; shake = 0.6; combo = 0;
    const dx = jelly.x - fromX, dz = jelly.z - fromZ, d = Math.hypot(dx, dz) || 1;
    jelly.vx += (dx / d) * 8; jelly.vz += (dz / d) * 8;
    audio.hurt();
    burst(jelly.x, 0, jelly.z, 24, [1.2, 0.3, 0.45], 4, 0.8, 0.12);
    ui.toast(`${label ? label + "  " : ""}−${amount} light`);
}

function steer(dt) {
    let turning = false, wantPulse = false;
    const kl = keys.has("ArrowLeft") || keys.has("KeyA"), kr = keys.has("ArrowRight") || keys.has("KeyD");
    if (kl || kr) { jelly.a += (kr ? 1 : -1) * TUNE.turnKeys * dt; turning = true; }
    if (keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW")) wantPulse = true;
    if (keys.has("ArrowDown") || keys.has("KeyS")) { jelly.a += Math.sign(jelly.a || 1) * TUNE.turnKeys * dt; turning = true; }
    if (pointer.held || tapPulse > 0) {
        const p = toPlane(pointer.x, pointer.y);
        if (p) {
            const want = Math.atan2(p[0] - jelly.x, p[1] - jelly.z);
            const d = Math.atan2(Math.sin(want - jelly.a), Math.cos(want - jelly.a));
            jelly.a += clamp(d, -TUNE.turnPointer * dt, TUNE.turnPointer * dt);
            turning = true;
            if (Math.abs(d) < 0.6 || Math.hypot(p[0] - jelly.x, p[1] - jelly.z) < 1.5) wantPulse = true;
        }
    }
    if (bot) { const b = bot(); jelly.a += clamp(b.d, -TUNE.turnPointer * dt, TUNE.turnPointer * dt); turning = true; wantPulse = b.pulse; }
    if (!turning) jelly.a *= Math.exp(-dt * 0.9);                    // drift back upright
    jelly.a = Math.atan2(Math.sin(jelly.a), Math.cos(jelly.a));
    if (wantPulse && jelly.pulse(TUNE.impulse, TUNE.cooldown)) {
        tapPulse = 0;
        audio.pulse();
        const [dx, dz] = jelly.dir;
        for (let i = 0; i < 10; i++) {
            const o = (i / 10) * 6.283, side = Math.cos(o) * 1.1;
            particles.push({ x: jelly.x + dz * side, y: Math.sin(o) * 1.0, z: jelly.z - dx * side, vx: -dx * 2.5 + dz * Math.cos(o), vy: 0, vz: -dz * 2.5 - dx * Math.cos(o), life: 0.6, max: 0.6, size: 0.12, c: [0.4, 0.75, 1.0], drag: 3 });
        }
    }
}

function update(dt) {
    time += dt; stateT += dt;
    hurtFlash = Math.max(0, hurtFlash - dt * 2.2); shake = Math.max(0, shake - dt * 1.8);
    fade = Math.min(1, fade + dt * (state === "dying" ? 0 : 0.6));
    if (state === "dying") fade = Math.max(0.12, 1 - stateT * 0.5);

    if (state === "title") titleDemo(dt);
    if (state === "play") play(dt);
    if (state === "breach" || (state === "over" && jelly.z > -1)) breachAnim(dt);
    if (state === "dying" && stateT > 1.8 && !ui.resultShown) results(false);

    jelly.cool -= dt; jelly.pt += dt;
    jelly.hurtT = Math.max(0, jelly.hurtT - dt * 1.6); jelly.inv = Math.max(0, jelly.inv - dt);
    jelly.updateChains(dt);

    for (const h of world.halos) h.glow += ((h.bloomed ? 1 : 0) - h.glow) * Math.min(1, dt * 2.5);
    for (const p of particles) {
        const k = Math.exp(-dt * p.drag);
        p.vx *= k; p.vy *= k; p.vz *= k;
        p.vz += (p.buoy || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    // vent embers and reef bubbles near the camera
    if (cam.z < -DEPTH + 40) for (const v of world.vents) if (Math.random() < dt * 9) particles.push({ x: v.x + (Math.random() - 0.5) * v.r, y: v.y, z: v.z + v.h + 0.3, vx: (Math.random() - 0.5) * 0.4, vy: 0, vz: 1.5 + Math.random() * 2, buoy: 0.4, life: 3.5, max: 3.5, size: 0.06 + Math.random() * 0.05, c: [1.3, 0.5, 0.12], drag: 0.3 });
    if (cam.z > -130 && cam.z < -1 && Math.random() < dt * 6) {
        const x = cam.x + (Math.random() - 0.5) * 30, y = 2 + Math.random() * 6;
        particles.push({ x, y, z: cam.z - 16, vx: 0, vy: 0, vz: 1.2 + Math.random(), buoy: 0.6, life: 14, max: 14, size: 0.05 + Math.random() * 0.07, c: [0.4, 0.55, 0.55], drag: 0.2, bubble: true });
    }
    audio.setDepth(clamp(-jelly.z / DEPTH, 0, 1));
}

function play(dt) {
    tapPulse = Math.max(0, tapPulse - dt);
    steer(dt);
    const prevZ = jelly.z;
    // physics: sinking, currents, drag
    jelly.vz -= TUNE.sink * dt;
    for (const c of world.currents) {
        const k = smooth(c.z0 - 1.5, c.z0, jelly.z) * (1 - smooth(c.z1, c.z1 + 1.5, jelly.z));
        if (k > 0) jelly.vx += c.dir * c.strength * k * dt;
    }
    const drag = Math.exp(-TUNE.drag * dt);
    jelly.vx *= drag; jelly.vz *= drag;
    jelly.x += jelly.vx * dt; jelly.z += jelly.vz * dt;
    // walls and floor
    const r = TUNE.jellyR, wl = world.wallLeft(jelly.z) + r, wr = world.wallRight(jelly.z) - r;
    if (jelly.x > wr) { jelly.x = wr; if (jelly.vx > 0) { if (jelly.vx > 1.5) audio.bump(); jelly.vx *= -0.45; } }
    if (jelly.x < wl) { jelly.x = wl; if (jelly.vx < 0) { if (jelly.vx < -1.5) audio.bump(); jelly.vx *= -0.45; } }
    if (jelly.z < -DEPTH - 1) { jelly.z = -DEPTH - 1; jelly.vz = Math.max(0, jelly.vz); }

    // light drains faster in the deep
    const depthK = clamp(-jelly.z / DEPTH, 0, 1);
    light -= lerp(TUNE.drainTop, TUNE.drainDeep, depthK) * dt;

    // plankton: drawn in when close, eaten on touch
    for (const p of world.plankton) {
        if (p.taken || Math.abs(p.z - jelly.z) > 6) continue;
        const dx = jelly.x - p.x, dz = jelly.z - p.z, d = Math.hypot(dx, dz);
        if (d < 3.4) { const pull = (1 - d / 3.4) * 7 * dt; p.x += dx * pull; p.z += dz * pull; }
        if (d < 1.15) {
            p.taken = true; eaten++;
            light = Math.min(100, light + TUNE.plankton); score += 10;
            audio.plankton();
            const c = PLANKTON_COL[zoneAt(p.z)];
            burst(p.x, 0, p.z, 7, c, 2.2, 0.7, 0.08);
        }
    }
    // halos: swim up through the ring
    for (const h of world.halos) {
        if (h.bloomed) continue;
        if (prevZ < h.z && jelly.z >= h.z) {
            if (Math.abs(jelly.x - h.x) < h.R - 0.2) {
                h.bloomed = true; bloomed++; combo++;
                score += 100 * combo; light = Math.min(100, light + TUNE.halo);
                audio.halo(combo);
                burst(h.x, 0, h.z, 70, [1.3, 0.85, 0.45], 6, 1.6, 0.11, 1.2);
                burst(h.x, 0, h.z, 30, ZONE_TINT[zoneAt(h.z)], 3, 2.2, 0.16, 1.5);
                ui.toast(combo > 1 ? `Halo bloomed  ×${combo}` : "Halo bloomed");
            } else if (!h.missed) {
                h.missed = true; combo = 0; audio.missed(); ui.toast("Halo missed");
            }
        }
    }
    // anglerfish
    for (const f of world.anglers) {
        if (Math.abs(f.hz - jelly.z) > 34) continue;
        f.t += dt; f.cool -= dt;
        const mouthX = f.x + f.dir[0] * 1.3, mouthZ = f.z + f.dir[1] * 1.3;
        const dj = Math.hypot(jelly.x - mouthX, jelly.z - mouthZ);
        if (f.state === "lurk") {
            f.x = f.hx + Math.sin(time * 0.6 + f.ph) * 0.3; f.z = f.hz + Math.sin(time * 0.45 + f.ph) * 0.4; f.y += (f.hy - f.y) * dt;
            const tx = jelly.x - f.x, tz = jelly.z - f.z, l = Math.hypot(tx, tz) || 1;
            const want = dj < 12 ? [tx / l, tz / l] : [-f.side, 0];
            f.dir = [lerp(f.dir[0], want[0], dt * 1.5), lerp(f.dir[1], want[1], dt * 1.5)];
            f.mouth = Math.max(0, f.mouth - dt); f.eye = Math.max(0, f.eye - dt);
            if (dj < TUNE.anglerRange && f.cool <= 0 && state === "play") { f.state = "tell"; f.t = 0; audio.growl(); }
        } else if (f.state === "tell") {
            f.eye = Math.min(1, f.t / 0.3); f.mouth = Math.min(0.45, f.t);
            const tx = jelly.x - f.x, tz = jelly.z - f.z, l = Math.hypot(tx, tz) || 1;
            f.dir = [tx / l, tz / l];
            f.x -= f.dir[0] * dt * 1.2; f.z -= f.dir[1] * dt * 1.2;          // draws back before striking
            if (f.t > 0.55) { f.state = "lunge"; f.t = 0; f.ld = f.dir.slice(); }
        } else if (f.state === "lunge") {
            const sp = 17 * (1 - f.t / 0.5);
            f.x += f.ld[0] * sp * dt; f.z += f.ld[1] * sp * dt; f.y += (0.2 - f.y) * dt * 6;
            f.mouth = f.t < 0.3 ? 1 : Math.max(0, 1 - (f.t - 0.3) * 5);
            if (dj < 1.7 && f.t < 0.42) hurt(TUNE.bite, mouthX, mouthZ, "Bitten");
            if (f.t > 0.5) { f.state = "return"; f.t = 0; }
        } else if (f.state === "return") {
            const tx = f.hx - f.x, tz = f.hz - f.z, l = Math.hypot(tx, tz);
            f.eye = Math.max(0, f.eye - dt * 2); f.mouth = Math.max(0, f.mouth - dt * 2);
            if (l < 0.3) { f.state = "lurk"; f.cool = 2.2; }
            else { f.x += (tx / l) * Math.min(l, 4 * dt); f.z += (tz / l) * Math.min(l, 4 * dt); f.dir = [lerp(f.dir[0], -tx / l, dt * 3), lerp(f.dir[1], -tz / l, dt * 3)]; }
        }
    }
    // pufferfish
    for (const p of world.puffers) {
        if (Math.abs(p.z0 - jelly.z) > 34) continue;
        const nx = p.x0 + Math.sin(time * 0.35 + p.ph) * p.range;
        p.face = nx >= p.x ? 1 : -1;
        p.x = nx; p.z = p.z0 + Math.sin(time * 0.8 + p.ph) * 0.5;
        const d = Math.hypot(jelly.x - p.x, jelly.z - p.z);
        p.inflate = clamp(p.inflate + (d < 5.2 ? dt * 3.5 : -dt * 0.8), 0, 1);
        if (d < 0.55 + p.inflate * 0.75 + TUNE.jellyR * 0.8) hurt(TUNE.sting, p.x, p.z, "Spiked");
    }
    obstacles(dt);
    // zones: crossing up into a new one is a checkpoint
    const zi = zoneAt(jelly.z);
    if (zi > zone) {
        zone = zi; checkpoint = { z: jelly.z, zone };
        light = Math.max(light, 60);
        ui.banner(zone); audio.zone();
    }
    if (light <= 0) { light = 0; state = "dying"; stateT = 0; audio.fade(); }
    if (jelly.z > -0.35) {
        state = "breach"; stateT = 0;
        audio.breach();
        burst(jelly.x, 0, 0, 90, [0.9, 0.95, 1.0], 6, 1.4, 0.1, 3);
        burst(jelly.x, 0, 0, 40, [1.3, 0.7, 0.4], 4, 2.0, 0.14, 2);
        jelly.vz = 5.5;
    }
    ui.hud();
}

// the four obstacle types (placed in world.js, drawn in creatures.js)
const seen = new Set();
function firstSight(kind, z, text) {
    if (seen.has(kind) || Math.abs(z - jelly.z) > 15) return;
    seen.add(kind); ui.tip(text);
}
function obstacles(dt) {
    const jx = jelly.x, jz = jelly.z;
    // stinger curtains: only the sliding gap is safe
    for (const c of world.curtains) {
        if (Math.abs(c.z - jz) > 20) continue;
        firstSight("curtain", c.z, "Stinger curtain ahead — slip through the moving gap");
        if (jz > c.z - c.len - 0.3 && jz < c.z + 0.4) {
            const g = curtainGap(world, c, time);
            if (jx < g.g0 + 0.3 || jx > g.g1 - 0.3) hurt(TUNE.curtain, jx, jz + 1, "Stung");
        }
    }
    // urchin outcrops: the rock is solid, the urchins sting
    for (const o of world.outcrops) {
        if (Math.abs(o.z - jz) > 20) continue;
        firstSight("urchin", o.z, "Rock ledge — mind the urchins");
        const dx = jx - o.x, dz = jz - o.z, d = Math.hypot(dx, dz), min = o.R * 0.92 + TUNE.jellyR * 0.7;
        if (d < min) {
            const nx = dx / (d || 1), nz = dz / (d || 1);
            jelly.x = o.x + nx * min; jelly.z = o.z + nz * min;
            const vn = jelly.vx * nx + jelly.vz * nz;
            if (vn < 0) { if (vn < -1.5) audio.bump(); jelly.vx -= 1.5 * vn * nx; jelly.vz -= 1.5 * vn * nz; }
        }
        for (const u of o.urchins) if (Math.hypot(jx - u.x, jz - u.z) < u.r * 1.9 + TUNE.jellyR * 0.6) hurt(TUNE.urchin, u.x, u.z, "Spined");
    }
    // moray eels: eyes glow in the hole, then they strike across the canyon
    for (const m of world.morays) {
        if (Math.abs(m.z - jz) > 24) continue;
        m.t += dt; m.cool -= dt;
        const inReach = Math.abs(jz - m.z) < 3.4 && Math.abs(jx - m.wall) < m.reach + 1.6;
        if (m.state === "hide") {
            m.out = Math.max(0, m.out - dt * 2); m.eye = Math.max(0, m.eye - dt);
            if (inReach && m.cool <= 0 && state === "play") { m.state = "tell"; m.t = 0; audio.hiss(); firstSight("moray", m.z, "Moray eel! Watch for eyes in the walls"); }
        } else if (m.state === "tell") {
            m.eye = Math.min(1, m.t / 0.25);
            if (m.t > 0.55) { m.state = "strike"; m.t = 0; }
        } else if (m.state === "strike") {
            m.out = Math.min(1, m.out + dt / 0.13);
            if (m.t > 0.65) { m.state = "retract"; m.t = 0; }
        } else if (m.state === "retract") {
            m.out = Math.max(0, m.out - dt / 0.55); m.eye = Math.max(0, m.eye - dt * 1.5);
            if (m.out <= 0) { m.state = "hide"; m.cool = 2.6; }
        }
        if (m.out > 0.35) {
            const s = moraySegment(m);
            const t = clamp((jx - s.x0) / ((s.x1 - s.x0) || 1e-6), 0, 1);
            if (Math.hypot(jx - lerp(s.x0, s.x1, t), jz - s.z0) < 0.45 + TUNE.jellyR * 0.7) hurt(TUNE.moray, lerp(s.x0, s.x1, t), s.z0 - 0.5, "Bitten");
        }
    }
    // barracuda runs
    for (const lane of world.barracuda) {
        if (Math.abs(lane.z - jz) > 22) continue;
        const st = barracudaState(world, lane, time);
        if (st.phase === "warn" && lane.warned !== st.cycle) {
            lane.warned = st.cycle;
            if (Math.abs(lane.z - jz) < 14) { audio.whoosh(); firstSight("barracuda", lane.z, "Silver shimmer = barracuda run. Wait, then cross"); }
        }
        for (const f of st.fish) {
            const dx = (jx - f.x) / 1.65, dz = (jz - f.z) / 0.95;
            if (dx * dx + dz * dz < 1) hurt(TUNE.barracuda, f.x - lane.dir * 2, f.z, "Struck");
        }
    }
}

function breachAnim(dt) {
    // the jelly bobs up through the surface and settles, glowing, on the evening sea
    jelly.vz -= 6 * dt; jelly.vz *= Math.exp(-dt * 1.2);
    jelly.z += jelly.vz * dt;
    if (jelly.z < 0.25) { jelly.vz += (0.25 - jelly.z) * dt * 18; }
    jelly.a *= Math.exp(-dt * 2);
    if (Math.random() < dt * 3) jelly.pt = 0;
    if (state === "breach" && stateT > 3.2) results(true);
}

function titleDemo(dt) {
    // on the title screen the jelly drifts and pulses lazily near the vents
    const homeZ = -DEPTH + 7;
    jelly.vz -= TUNE.sink * 0.4 * dt;
    jelly.vx *= Math.exp(-dt); jelly.vz *= Math.exp(-dt);
    jelly.x += jelly.vx * dt; jelly.z += jelly.vz * dt;
    jelly.a = Math.sin(time * 0.4) * 0.35;
    if (jelly.z < homeZ && jelly.cool <= 0 && Math.random() < dt * 2) jelly.pulse(1.6, 0.6);
}

function stars() { return 1 + (bloomed >= 11 ? 1 : 0) + (bloomed >= HALO_COUNT ? 1 : 0); }
function results(won) {
    state = "over";
    let st = 0;
    if (won) { score += 1000 + Math.round(light) * 10; st = stars(); }
    const prevBest = save.best;
    save.best = Math.max(save.best, score);
    save.bestStars = Math.max(save.bestStars, st);
    persist();
    ui.result(won, st, score > prevBest && score > 0);
}

// ------------------------------------------------------------------ autoplay bot (demos / headless checks)
let bot = null;
if (Q.has("autoplay")) {
    bot = () => {
        const next = world.halos.find((h) => !h.bloomed && h.z > jelly.z - 1);
        let tx = next ? next.x : world.routeX(jelly.z + 8), tz = next ? next.z + 3 : jelly.z + 8;
        if (next && jelly.z < next.z - 1.5 && Math.abs(jelly.x - next.x) > 0.8) tz = next.z - 2.5;
        for (const f of world.anglers) if (f.state !== "lurk" && Math.hypot(f.x - jelly.x, f.z - jelly.z) < 7) { tx = jelly.x + (jelly.x - f.x) * 2; }
        for (const p of world.puffers) if (Math.hypot(p.x - jelly.x, p.z - jelly.z) < 3.5) { tx = jelly.x + (jelly.x - p.x) * 2; }
        let hold = false;
        for (const c of world.curtains) if (jelly.z > c.z - c.len - 6 && jelly.z < c.z + 0.5) {
            const g = curtainGap(world, c, time);
            tx = g.gx; tz = c.z + 2.5;
            // below the curtain and not lined up yet: hover under the gap until it is safe to rise
            if (jelly.z < c.z - c.len - 0.3 && Math.abs(jelly.x - g.gx) > c.gap / 2 - 1.3) tz = c.z - c.len - 2.2;
        }
        for (const o of world.outcrops) {
            const d = Math.hypot(jelly.x - o.x, jelly.z - o.z);
            if (d < o.R + 3.5 && jelly.z < o.z + o.R) tx = o.x - o.side * (o.R + 2.6);
        }
        for (const m of world.morays) if (Math.abs(jelly.z - m.z) < 4.5) tx = m.wall - m.side * (m.reach + 2.4);
        for (const lane of world.barracuda) {
            const st = barracudaState(world, lane, time), dz = lane.z - jelly.z;
            if (st.phase !== "idle" && dz > -1.4 && dz < 3.2) { if (dz > 0.4) { hold = true; tz = jelly.z - 1; } else tz = jelly.z + 4; }
        }
        const want = Math.atan2(tx - jelly.x, tz - jelly.z);
        const d = Math.atan2(Math.sin(want - jelly.a), Math.cos(want - jelly.a));
        return { d, pulse: !hold && Math.abs(d) < 0.5 };
    };
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(80000), dynAdd = new Mesh(40000);
const snow = Array.from({ length: 260 }, () => ({ x: (Math.random() - 0.5) * 56, y: -4 + Math.random() * 14, z: (Math.random() - 0.5) * 50, s: 0.025 + Math.random() * 0.05, ph: Math.random() * 6.28 }));
const wrap = (v, lo, hi) => lo + ((((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);

function jellyTint() { return mixc([0.22, 0.78, 1.25], [0.78, 0.36, 1.25], 0.5 + 0.5 * Math.sin(time * 0.25)); }

function updateCamera(dt) {
    const aspect = canvas.width / canvas.height;
    const D = TUNE.camDist, Vh = +Q.get("vh") || 12.5;
    const k = D / Math.max(Vh * aspect, Math.min(11.5, Vh * 2));
    space.magnifier = k * 1.6;
    let px, py, pz, lx, ly, lz;
    if (state === "breach" || (state === "over" && jelly.z > -1)) {
        const t = smooth(0, 2.4, stateT + (state === "over" ? 10 : 0));
        px = lerp(cam.x, jelly.x, t); py = lerp(-D, -13, t); pz = lerp(Math.min(cam.z, -0.6), 2.6, t);
        lx = jelly.x; ly = lerp(0, 40, t); lz = lerp(cam.lookZ, 1.6, t);
        if (state === "over") { px = jelly.x + Math.sin(time * 0.1) * 1.5; py = -13; pz = 2.6; ly = 40; lz = 1.6; }
    } else {
        const tx = lerp(world.centerX(jelly.z), jelly.x, 0.6);
        const tz = jelly.z + 2.2 + clamp(jelly.vz, -3, 6) * 0.35;
        const f = 1 - Math.exp(-dt * 3);
        cam.x += (tx - cam.x) * f; cam.z += (tz - cam.z) * f;
        cam.z = Math.min(cam.z, -0.7);
        cam.lookZ = cam.z + 0.5;
        const sway = state === "title" ? Math.sin(time * 0.15) * 3 : 0;
        px = cam.x + sway; py = -D; pz = cam.z; lx = cam.x; ly = 0; lz = cam.lookZ;
    }
    if (shake > 0) { px += (Math.random() - 0.5) * shake * 0.5; pz += (Math.random() - 0.5) * shake * 0.5; }
    space.lookAt(px, py, pz, lx, ly, lz);
}

function pickLights(tint) {
    const cands = [];
    const sunK = Math.exp(Math.min(0, jelly.z) / 110);                  // in bright water the jelly's light matters less
    const L = (0.8 + 4.2 * (light / 100)) * (1 - 0.8 * sunK);
    cands.push({ x: jelly.x, y: -0.6, z: jelly.z + 0.3, s: state === "dying" ? L * fade : L, c: tint, pin: true });
    for (const l of world.staticLights) cands.push({ ...l, s: l.s * (0.85 + 0.15 * Math.sin(time * 9 + l.x)) });
    const zc = space.Zc;
    for (const f of world.anglers) if (f.lure && Math.abs(f.z - zc) < 30) cands.push({ x: f.lure[0], y: f.lure[1] - 0.5, z: f.lure[2], s: 1.1, c: PLANKTON_COL[zoneAt(f.hz) > 0 ? 1 : 0] });
    for (const h of world.halos) if (Math.abs(h.z - zc) < 30) cands.push({ x: h.x, y: -0.5, z: h.z + 0.4, s: 0.5 + h.glow * 1.4, c: mixc(ZONE_TINT[zoneAt(h.z)], [1.2, 0.8, 0.45], h.glow) });
    cands.sort((a, b) => (b.pin ? 1e9 : 0) - (a.pin ? 1e9 : 0) || Math.abs(a.z - zc) - Math.abs(b.z - zc));
    const n = Math.min(8, cands.length);
    for (let i = 0; i < n; i++) {
        const l = cands[i];
        lightBuf.set([l.x, l.y, l.z, l.s], i * 4);
        lightColBuf.set(l.c, i * 3);
    }
    return n;
}

function buildDynamic(tint) {
    const S = dyn, A = dynAdd;
    S.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    const zc = space.Zc, z0 = zc - 36, z1 = zc + 36;
    const zn = zoneAt(clamp(zc, -DEPTH, -0.1));

    for (const h of world.halos) if (h.z > z0 && h.z < z1) drawHalo(S, A, h, time, ZONE_TINT[zoneAt(h.z)]);
    for (const f of world.anglers) if (f.z > z0 && f.z < z1) drawAngler(S, A, f, time, PLANKTON_COL[zoneAt(f.hz) > 0 ? 1 : 0]);
    for (const p of world.puffers) if (p.z0 > z0 && p.z0 < z1) drawPuffer(S, A, p, time);
    for (const c of world.curtains) if (c.z > z0 && c.z - c.len < z1) drawCurtain(A, world, c, time);
    for (const m of world.morays) if (m.z > z0 && m.z < z1) drawMoray(S, A, m, time);
    for (const l of world.barracuda) if (l.z > z0 && l.z < z1) drawBarracuda(S, A, world, l, time);
    drawSchools(S, schools, time, z0, z1);
    drawSiphonophores(A, sipho, time, z0, z1);
    // plankton motes
    for (const p of world.plankton) {
        if (p.taken || p.z < z0 || p.z > z1) continue;
        const c = PLANKTON_COL[zoneAt(p.z)], k = 0.75 + 0.25 * Math.sin(time * 3 + p.ph);
        const x = p.x + Math.sin(time * 0.9 + p.ph) * 0.15, z = p.z + Math.cos(time * 0.7 + p.ph) * 0.15;
        A.sprite(x, -0.1, z, 0.16, c[0] * k, c[1] * k, c[2] * k);
        A.sprite(x, -0.1, z, 0.75, c[0] * 0.13 * k, c[1] * 0.13 * k, c[2] * 0.13 * k);
    }
    // currents: streaks sliding sideways
    for (const c of world.currents) {
        if (c.z1 < z0 || c.z0 > z1) continue;
        const cx = world.centerX(c.z0), hw = world.halfW(c.z0) + 2;
        for (let i = 0; i < 46; i++) {
            const h = (i * 0.6180339) % 1, h2 = (i * 0.7548776) % 1;
            const x = cx - hw + wrap(h * 2 * hw + time * c.dir * c.strength * 2.2, 0, 2 * hw), z = lerp(c.z0, c.z1, h2), y = -1 + ((i * 0.381966) % 1) * 4;
            const len = 1.2 + h2 * 1.5, edge = Math.min(1, Math.min(x - (cx - hw), cx + hw - x) / 3);
            const k = 0.14 * edge;
            A.quad4([x, y, z - 0.025], [x + c.dir * len, y, z - 0.01], [x + c.dir * len, y, z + 0.01], [x, y, z + 0.025], [0, 0, 0], [0.5 * k, 0.8 * k, 1.0 * k], [0.5 * k, 0.8 * k, 1.0 * k], [0, 0, 0], MAT.ADD);
        }
    }
    // marine snow drifting around the camera
    const sc = zn === 3 ? [0.32, 0.4, 0.38] : zn === 2 ? [0.22, 0.32, 0.38] : [0.16, 0.18, 0.28];
    if (space.Zc < 0) for (const f of snow) {
        const x = space.Xc + wrap(f.x + Math.sin(time * 0.2 + f.ph) * 0.5 - space.Xc, -28, 28);
        const z = zc + wrap(f.z - time * 0.25 - zc, -25, 25);
        if (z > -0.2) continue;
        A.sprite(x, f.y, z, f.s, sc[0], sc[1], sc[2]);
    }
    // particles
    for (const p of particles) {
        const k = Math.min(1, p.life / p.max * 1.5);
        if (p.bubble) { if (p.z > -0.1) { p.life = 0; continue; } A.sprite(p.x, p.y, p.z, p.size, p.c[0] * 0.7, p.c[1] * 0.7, p.c[2] * 0.7); continue; }
        A.sprite(p.x, p.y, p.z, p.size * (0.5 + k * 0.5), p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
    // the jelly (additive) — it fades to nothing when its light runs out
    const lk = state === "dying" ? Math.max(0, 1 - stateT * 0.6) : 1;
    const sunK = Math.exp(Math.min(0, jelly.z) / 110), bright = jelly.z > 0 ? 0.55 : 1 - 0.55 * sunK;
    jelly.draw(A, clamp(light / 100, 0, 1) * lk * bright + (state === "title" ? 0.6 : 0), tint.map((v) => v * (0.35 + 0.65 * lk) * bright), time);
    const sN = S.n;
    S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, aN: A.n };
}

function render(dt) {
    updateCamera(dt);
    const tint = jellyTint();
    const { sN, aN } = buildDynamic(tint);
    const nl = pickLights(tint);
    const aspect = canvas.width / canvas.height;

    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform4fv(U.uLights, lightBuf);
    gl.uniform3fv(U.uLightCol, lightColBuf);
    gl.uniform1f(U.uLightCount, nl);
    space.applyCamera();

    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, statSolid);
    space.bind(true); space.draw(6, sN - 6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    space.bind(false); space.draw(statSolid, statAdd);
    space.bind(true); space.draw(sN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);

    post.end({ time, under: space.Zc < 0 ? 1 : 0, fade: state === "title" ? Math.min(1, fade) : fade, hurt: hurtFlash });
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const ui = {
    resultShown: false,
    last: {},
    show(which) {
        for (const id of ["title", "hud", "paused", "result"]) $(id).classList.toggle("hidden", id !== which && !(id === "hud" && which === "paused"));
        document.body.dataset.state = which;
        this.resultShown = which === "result";
    },
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } },
    hud() {
        const depth = Math.max(0, Math.round(-jelly.z));
        this.set("depth", `${depth} m`);
        this.set("score", fmt(score));
        this.set("halos", `${bloomed}/${HALO_COUNT}`);
        this.set("combo", combo > 1 ? `×${combo}` : "");
        const L = clamp(light / 100, 0, 1);
        const ring = $("lightring");
        const dash = (L * 264).toFixed(1);
        if (this.last.dash !== dash) { this.last.dash = dash; ring.style.strokeDasharray = `${dash} 264`; }
        $("lightbox").classList.toggle("low", L < 0.25);
        this.set("lightv", Math.ceil(light));
        const mk = $("gaugemark");
        const top = (clamp(-jelly.z / DEPTH, 0, 1) * 100).toFixed(1) + "%";
        if (this.last.mk !== top) { this.last.mk = top; mk.style.top = top; }
    },
    banner(z) {
        const el = $("banner");
        $("bname").textContent = ZONES[z].name; $("bsub").textContent = ZONES[z].sub;
        el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    },
    tip(t) { const el = $("tip"); el.textContent = t; el.classList.add("show"); clearTimeout(this._tip); this._tip = setTimeout(() => el.classList.remove("show"), 3800); },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1400); },
    mute(m) { $("mute").setAttribute("aria-pressed", m ? "true" : "false"); },
    result(won, st, newBest) {
        this.show("result");
        $("r-kicker").textContent = won ? "SURFACED" : `${Math.max(0, Math.round(-jelly.z))} m below`;
        $("r-title").textContent = won ? "You reached the evening light" : "Your light went out";
        $("r-stars").innerHTML = won ? [0, 1, 2].map((i) => `<b class="${i < st ? "on" : ""}" style="animation-delay:${0.2 + i * 0.25}s">✦</b>`).join("") : "";
        $("r-halos").textContent = `${bloomed}/${HALO_COUNT}`;
        $("r-plankton").textContent = eaten;
        $("r-score").textContent = fmt(score);
        $("r-best").textContent = newBest ? "New best!" : `Best ${fmt(save.best)}`;
        $("r-resume").classList.toggle("hidden", won);
        $("r-resume").textContent = `Resume from ${ZONES[checkpoint.zone].name.replace("The ", "")}`;
        $("r-msg").textContent = won
            ? (st === 3 ? "Every halo bloomed behind you. A perfect ascent." : `Bloom ${st === 1 ? 11 : HALO_COUNT} halos for the next star.`)
            : "Plankton keeps your glow alive — and anglerfish lures only look like food.";
    },
    title() {
        $("t-best").textContent = save.best ? fmt(save.best) : "—";
        $("t-dives").textContent = save.dives;
        $("t-stars").textContent = "✦".repeat(save.bestStars) || "—";
    },
};
$("begin").addEventListener("click", (e) => { e.stopPropagation(); start(); });
$("title").addEventListener("click", () => start());
$("pause").addEventListener("click", (e) => { e.stopPropagation(); togglePause(); });
$("p-resume").addEventListener("click", () => togglePause());
$("p-restart").addEventListener("click", () => start(true));
$("mute").addEventListener("click", (e) => { e.stopPropagation(); audio.init(); ui.mute(audio.toggleMute()); });
$("r-resume").addEventListener("click", () => resume());
$("r-again").addEventListener("click", () => start(true));
ui.mute(audio.muted);

// ------------------------------------------------------------------ boot
newDive(Q.has("seed") ? +Q.get("seed") : (Math.random() * 1e9) | 0);
ui.title();
ui.show("title");
if (Q.has("autoplay") && !Q.has("title")) start();
window.__tideglow = () => ({ t: +time.toFixed(1), state, z: +jelly.z.toFixed(2), x: +jelly.x.toFixed(2), light: +light.toFixed(1), score, bloomed, eaten, zone, post: post.ok, verts: stat.n, fps: fpsNow });

let last = performance.now(), fpsNow = 0, fpsN = 0, fpsT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fpsN++; fpsT += (now - last) / 1000; if (fpsT > 1) { fpsNow = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    last = now;
    if (state !== "paused") for (let s = 0; s < SPEED; s++) update(dt);
    render(state === "paused" ? 0 : dt);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
