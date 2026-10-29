// MOONLAKE — a calm fishing game, rendered with the projection3d library (Space, via GameSpace) + bloom.
// See DESIGN.md. fish.js defines the species and their 3D model, lake.js the scenery; this file runs the clock,
// the fish in the lake, casting / bites / the tension fight, and the UI (journal, lures, catch card).

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, limb, blob, tube } from "./mesh.js";
import { SPECIES, LURES, RARITY, drawFish, speciesWeights } from "./fish.js";
import { buildLake, ZONES, zoneAt, inLake, ROD_BASE, LANTERN, DOCK_END } from "./lake.js";

const Q = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(8, +Q.get("speed") || 1));
const K = 1.75, DAY_LEN = 480;

// ------------------------------------------------------------------ canvas + library
const canvas = document.getElementById("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
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
const save = (() => { try { return { caught: {}, lure: "spinner", volume: 0.8, music: 0.6, timeScale: 1, clock: 0.02, ...JSON.parse(localStorage.getItem("moonlake.save")) }; } catch { return { caught: {}, lure: "spinner", volume: 0.8, music: 0.6, timeScale: 1, clock: 0.02 }; } })();
const persist = () => { save.clock = clock; try { localStorage.setItem("moonlake.save", JSON.stringify(save)); } catch { } };
const species = () => Object.keys(save.caught).length;
const lureOk = (id) => species() >= LURES[id].unlock;
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static scene
const stat = new Mesh(220000);
let sS = 0, sSh = 0, sA = 0;
{
    const S = new Mesh(200000), Sh = new Mesh(10000), A = new Mesh(200);
    buildLake(S, Sh, A);
    stat.append(S); stat.append(Sh); stat.append(A);
    sS = S.n; sSh = Sh.n; sA = A.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ the clock
let clock = Q.has("time") ? +Q.get("time") : save.clock || 0.02;
const KEYS = [
    // t, skyTop, skyHor, sunCol, fog, day, night
    [0.0, [0.16, 0.18, 0.4], [1.15, 0.52, 0.3], [1.35, 0.62, 0.3], [0.55, 0.32, 0.3], 0.55, 0.12],
    [0.1, [0.06, 0.07, 0.2], [0.42, 0.24, 0.34], [0.9, 0.4, 0.3], [0.16, 0.12, 0.2], 0.12, 0.55],
    [0.2, [0.012, 0.018, 0.06], [0.05, 0.07, 0.14], [0.3, 0.3, 0.4], [0.03, 0.04, 0.08], 0, 1],
    [0.55, [0.012, 0.018, 0.06], [0.05, 0.07, 0.14], [0.3, 0.3, 0.4], [0.03, 0.04, 0.08], 0, 1],
    [0.64, [0.06, 0.08, 0.2], [0.38, 0.3, 0.45], [0.8, 0.5, 0.45], [0.2, 0.18, 0.26], 0.1, 0.55],
    [0.72, [0.3, 0.44, 0.75], [1.2, 0.72, 0.58], [1.35, 0.85, 0.55], [0.6, 0.5, 0.5], 0.6, 0.08],
    [0.84, [0.34, 0.52, 0.88], [0.92, 0.82, 0.7], [1.3, 1.05, 0.8], [0.6, 0.62, 0.66], 0.95, 0],
    [1.0, [0.16, 0.18, 0.4], [1.15, 0.52, 0.3], [1.35, 0.62, 0.3], [0.55, 0.32, 0.3], 0.55, 0.12],
];
function sky(t) {
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
    const a = KEYS[i], b = KEYS[i + 1], u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1), e = u * u * (3 - 2 * u);
    const m = (p, q) => p.map((v, k) => lerp(v, q[k], e));
    // the sun sets ahead-left and rises ahead-right; the moon crosses during the night
    const sunE = t < 0.5 ? lerp(0.07, -0.55, clamp(t / 0.35, 0, 1)) : lerp(-0.55, 0.42, clamp((t - 0.6) / 0.3, 0, 1));
    const sunA = t < 0.5 ? 1.95 : 1.15;
    const moonP = clamp((t - 0.08) / 0.6, 0, 1), moonE = Math.sin(moonP * Math.PI) * 0.42 - 0.05, moonA = lerp(1.25, 1.95, moonP);
    const dir = (az, el) => [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    return { top: m(a[1], b[1]), hor: m(a[2], b[2]), sunCol: m(a[3], b[3]), fog: m(a[4], b[4]), day: lerp(a[5], b[5], e), night: lerp(a[6], b[6], e), sun: dir(sunA, sunE), moon: dir(moonA, moonE) };
}
const todName = (t) => (t < 0.1 || t > 0.92 ? "dusk" : t < 0.62 ? "night" : t < 0.79 ? "dawn" : "day");
const todLabel = { dusk: ["Dusk", "the light is going"], night: ["Night", "moonlight on the water"], dawn: ["Dawn", "mist over the lake"], day: ["Golden hour", "warm and still"] };

// ------------------------------------------------------------------ fish in the lake
let fish = [];
const rand = (a, b) => a + Math.random() * (b - a);
function spawnFish(near = null) {
    const tod = todName(clock);
    let zone, x, y;
    if (near) { zone = zoneAt(...near); const a = Math.random() * 6.28; x = near[0] + Math.cos(a) * 9; y = near[1] + Math.sin(a) * 9; }
    else { const zs = Object.keys(ZONES); zone = zs[Math.floor(Math.random() * zs.length)]; const Z = ZONES[zone]; x = rand(Z.x0, Z.x1); y = rand(Z.y0, Z.y1); }
    if (!inLake(x, y, 3)) { x *= 0.7; y = 8 + (y - 8) * 0.7; }
    const w = speciesWeights(zone, tod), tot = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot, k = 0;
    while (k < w.length - 1 && (r -= w[k]) > 0) k++;
    const sp = SPECIES[k], f = Math.pow(Math.random(), 1.8);
    const fishy = { sp, weight: lerp(sp.w[0], sp.w[1], f), len: lerp(sp.len[0], sp.len[1], f), x, y, h: Math.random() * 6.28, speed: rand(0.6, 1.4), zone, state: "wander", t: 0, life: rand(40, 90), wp: null, beat: Math.random() * 6 };
    fish.push(fishy);
    return fishy;
}
function populate() { while (fish.length < 9) spawnFish(); }

// ------------------------------------------------------------------ state
let state = "loading";            // loading | title | idle | charge | flying | wait | bite | fight | leap | card | paused
let time = 0, charge = 0, aimPt = null, held = false, idleWait = 0;
let lure = null;                   // { x, y, z, vz, flying: {from,to,t} }
let engaged = null;                // the fish interested in the lure
let hooked = null, tension = 0, overT = 0, slackT = 0, fightMsg = "";
let ripples = [], parts = [], leap = null, card = null;
const isLure = (id) => save.lure === id;

function setHint(t) { ui.set("hint", t); }
function startFishing() {
    state = "idle"; ui.show("hud"); ui.hud(); populate(); setHint("Press and hold on the water to cast");
    audio.init();
}

// ------------------------------------------------------------------ input
function waterAt(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect);
    if (d[2] >= -1e-4) return null;
    const t = -space.Zc / d[2];
    return [space.Xc + d[0] * t, space.Yc + d[1] * t];
}
let ptr = [innerWidth / 2, innerHeight / 2];
function press() {
    audio.init(); held = true;
    if (state === "idle") { state = "charge"; charge = 0; }
    else if (state === "bite") strike();
    else if (state === "wait" && engaged && engaged.state === "nibble") { ui.toast("Too early — it spooked"); engaged.state = "flee"; engaged = null; }
}
function release() {
    held = false;
    if (state === "charge") cast();
}
canvas.addEventListener("pointerdown", (e) => { ptr = [e.clientX, e.clientY]; aimPt = waterAt(...ptr); press(); });
canvas.addEventListener("pointermove", (e) => { ptr = [e.clientX, e.clientY]; aimPt = waterAt(...ptr); });
addEventListener("pointerup", release);
addEventListener("keydown", (e) => {
    if (e.code === "Escape") { if (ui.open) { if (ui.open !== "m-catch") ui.close(); } else if (["idle", "wait", "charge", "fight", "bite"].includes(state)) menu(); return; }
    if (e.code === "Space" && !e.repeat) { e.preventDefault(); if (!aimPt) aimPt = [0, 14]; press(); }
    if (e.code === "KeyJ") ui.journal();
});
addEventListener("keyup", (e) => { if (e.code === "Space") release(); });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("blur", () => { held = false; });

function cast() {
    const tgt = aimPt || [0, 14];
    const ox = ROD_BASE[0], oy = ROD_BASE[1] + 1.2;
    let dx = tgt[0] - ox, dy = tgt[1] - oy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const dist = 5 + charge * 36;
    let tx = ox + dx * dist, ty = Math.max(oy + 3, oy + dy * dist);
    if (!inLake(tx, ty, 1.5)) { for (let k = 0; k < 40 && !inLake(tx, ty, 1.5); k++) { tx = lerp(tx, 0, 0.08); ty = lerp(ty, 10, 0.08); } }
    lure = { x: ox, y: oy, z: 3, fly: { from: rodTip(), to: [tx, ty], t: 0, dur: 0.6 + charge * 0.5 } };
    state = "flying"; charge = 0; audio.cast();
    setHint("…");
}
function strike() {
    if (!engaged) return;
    hooked = { f: engaged, sp: engaged.sp, weight: engaged.weight, len: engaged.len, stamina: engaged.sp.stamina * (0.7 + (engaged.weight / engaged.sp.w[1]) * 0.6), max: 0, ang: Math.atan2(lure.x - ROD_BASE[0], lure.y - ROD_BASE[1]), phase: Math.random() * 6, burst: 0 };
    hooked.max = hooked.stamina;
    hooked.dist = Math.hypot(lure.x - ROD_BASE[0], lure.y - ROD_BASE[1]);
    tension = 0.45; overT = 0; slackT = 0;
    engaged.state = "hooked"; fish = fish.filter((f) => f !== engaged);
    state = "fight"; ui.fight(true); ui.bite(false); audio.splash();
    splash(lure.x, lure.y, 1);
    setHint("Hold to reel · release to give line");
}
function endFight(result) {
    ui.fight(false);
    if (result === "caught") {
        const h = hooked;
        leap = { sp: h.sp, len: h.len, weight: h.weight, from: [lure.x, lure.y], t: 0 };
        state = "leap"; audio.splash(); splash(lure.x, lure.y, 2);
    } else {
        ui.toast(result === "snap" ? "Snap! The line broke" : "Slack line — it shook the hook");
        if (result === "snap") audio.snap();
        state = "idle"; setHint("Press and hold on the water to cast");
    }
    hooked = null; lure = null; engaged = null;
}

// ------------------------------------------------------------------ simulation
function rodTip() {
    const aim = lure && !lure.fly ? Math.atan2(lure.x - ROD_BASE[0], lure.y - ROD_BASE[1]) : aimPt ? Math.atan2(aimPt[0] - ROD_BASE[0], aimPt[1] - ROD_BASE[1]) : 0;
    const bend = state === "fight" ? tension * 0.9 : state === "charge" ? -charge * 0.5 : 0;
    const L = 3.6, a = clamp(aim, -0.9, 0.9), up = 0.42 - bend * 0.32;
    return [ROD_BASE[0] + Math.sin(a) * Math.cos(up) * L, ROD_BASE[1] + Math.cos(a) * Math.cos(up) * L, ROD_BASE[2] + Math.sin(up) * L];
}
function splash(x, y, big) {
    ripples.push({ x, y, t: 0, max: 1.6 + big });
    for (let i = 0; i < 10 + big * 18; i++) { const a = Math.random() * 6.28, s = rand(0.5, 2) * (1 + big * 0.5); parts.push({ x, y, z: 0.1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1.5, 3.5) * (1 + big * 0.4), life: rand(0.5, 0.9), max: 0.9, size: 0.06, c: [0.55, 0.65, 0.75], g: 9 }); }
}
function update(dt) {
    time += dt;
    clock = (clock + (dt / DAY_LEN) * save.timeScale) % 1;
    const sk = sky(clock);
    audio.night = sk.night; audio.dawn = todName(clock) === "dawn" ? 1 : todName(clock) === "day" ? 0.4 : 0;
    // fish wander
    for (const f of fish) {
        f.t += dt; f.life -= dt; f.beat += dt * (4 + f.speed * 3);
        if (f.state === "flee") { f.speed = 3; f.life = Math.min(f.life, 2.5); }
        let tx, ty;
        if (f.state === "interested" || f.state === "nibble" || f.state === "bite") { tx = lure.x; ty = lure.y; }
        else { if (!f.wp || Math.hypot(f.wp[0] - f.x, f.wp[1] - f.y) < 1) { const Z = ZONES[f.zone]; f.wp = [rand(Z.x0, Z.x1), rand(Z.y0, Z.y1)]; } [tx, ty] = f.wp; }
        const want = Math.atan2(ty - f.y, tx - f.x), dh = Math.atan2(Math.sin(want - f.h), Math.cos(want - f.h));
        f.h += clamp(dh, -dt * 1.6, dt * 1.6);
        const d = Math.hypot(tx - f.x, ty - f.y);
        const sp = f.state === "nibble" || f.state === "bite" ? 0 : f.speed * (f.state === "interested" ? Math.min(1, d / 2) * 1.3 : 1);
        f.x += Math.cos(f.h) * sp * dt; f.y += Math.sin(f.h) * sp * dt;
        if (!inLake(f.x, f.y, 2)) { f.h += Math.PI * 0.6; f.x = lerp(f.x, 0, 0.02); f.y = lerp(f.y, 14, 0.02); }
    }
    fish = fish.filter((f) => f.life > 0 || f === engaged);
    if (state !== "title" && state !== "loading") populate();

    if (state === "charge") { charge = Math.min(1, charge + dt / 1.1); }
    if (state === "flying") {
        const fl = lure.fly; fl.t += dt / fl.dur;
        const u = Math.min(1, fl.t);
        lure.x = lerp(fl.from[0], fl.to[0], u); lure.y = lerp(fl.from[1], fl.to[1], u); lure.z = lerp(fl.from[2], 0, u) + Math.sin(u * Math.PI) * (2 + fl.dur * 2);
        if (u >= 1) { lure.fly = null; lure.z = 0; state = "wait"; idleWait = 0; splash(lure.x, lure.y, 0); audio.plop(); setHint("Wait for a bite… hold to reel in"); }
    }
    if (state === "wait" || state === "bite") waitStep(dt);
    if (state === "fight") fightStep(dt);
    if (state === "leap") {
        leap.t += dt / 1.0;
        if (leap.t >= 1) { state = "card"; card = { ...leap, t: 0 }; leap = null; catchCard(card); }
    }
    for (const r of ripples) r.t += dt;
    ripples = ripples.filter((r) => r.t < r.max);
    for (const p of parts) { p.vz -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt; if (p.z < 0 && p.g > 0) p.life = 0; }
    parts = parts.filter((p) => p.life > 0);
    if (Q.has("autoplay")) bot(dt);
    if (state !== "title") ui.hud();
}
function waitStep(dt) {
    idleWait += dt;
    lure.z = Math.sin(time * 2.2) * 0.03;
    if (held && state === "wait") {
        // reel the lure in
        const dx = ROD_BASE[0] - lure.x, dy = ROD_BASE[1] + 2 - lure.y, d = Math.hypot(dx, dy);
        lure.x += (dx / d) * 3 * dt; lure.y += (dy / d) * 3 * dt; audio.reel(1);
        if (Math.random() < dt * 3) ripples.push({ x: lure.x, y: lure.y, t: 0, max: 1 });
        if (d < 4 || !inLake(lure.x, lure.y, 0)) { lure = null; if (engaged) { engaged.state = "wander"; engaged = null; } state = "idle"; setHint("Press and hold on the water to cast"); return; }
    }
    if (!engaged) {
        for (const f of fish) {
            if (f.state !== "wander") continue;
            const d = Math.hypot(f.x - lure.x, f.y - lure.y);
            if (d > 11) continue;
            const sp = f.sp, lf = sp.lure === save.lure ? 1 : sp.glowOnly ? 0 : 0.4, tf = sp.time === "any" || sp.time === todName(clock) ? 1 : 0.35;
            if (Math.random() < dt * 0.45 * lf * tf * (held ? 1.4 : 1)) { engaged = f; f.state = "interested"; f.nibbles = 1 + Math.floor(Math.random() * 3); f.t = 0; break; }
        }
        if (!engaged && idleWait > 14) { idleWait = 6; const f = spawnFish([lure.x, lure.y]); f.wp = [lure.x, lure.y]; }
        return;
    }
    const f = engaged, d = Math.hypot(f.x - lure.x, f.y - lure.y);
    if (f.state === "interested" && d < 0.9) { f.state = "nibble"; f.t = 0; f.next = rand(0.8, 2.2); }
    if (f.state === "nibble") {
        if (f.t > f.next) {
            if (f.nibbles-- > 0) { f.t = 0; f.next = rand(0.9, 2.0); lure.dip = 0.35; audio.nibble(); ripples.push({ x: lure.x, y: lure.y, t: 0, max: 1.1 }); }
            else { f.state = "bite"; f.t = 0; state = "bite"; lure.dip = 1; audio.bite(); splash(lure.x, lure.y, 0); ui.bite(true); setHint("Strike now!"); }
        }
    }
    if (f.state === "bite" && f.t > 0.8) { ui.bite(false); ui.toast("It took the bait and ran"); f.state = "flee"; engaged = null; state = "wait"; setHint("Wait for a bite… hold to reel in"); }
    if (lure.dip) { lure.dip = Math.max(0, lure.dip - dt * 2.5); lure.z -= lure.dip * 0.35; }
}
function fightStep(dt) {
    const h = hooked, sp = h.sp;
    h.phase += dt;
    if (h.burst > 0) h.burst -= dt; else if (Math.random() < dt * sp.erratic * 0.6) h.burst = rand(0.4, 0.9);
    const stam = clamp(h.stamina / h.max, 0, 1);
    const wf = clamp(h.weight / sp.w[1], 0.3, 1);
    const pull = sp.power * (0.55 + 0.35 * Math.sin(h.phase * 1.7) * sp.erratic + (h.burst > 0 ? 0.55 : 0)) * (0.35 + 0.65 * stam) * (0.75 + wf * 0.35);
    tension += ((held ? 0.95 : -1.15) + pull * 1.25 - 0.5) * dt * 0.95;
    tension = clamp(tension, 0, 1.25);
    const inBand = tension > 0.33 && tension < 0.84;
    if (held) { audio.reel(inBand ? 1 : 0.5); if (inBand) { h.stamina -= dt; h.dist -= (1.4 + 1.6 * (1 - Math.min(1, pull))) * dt; } else h.dist -= 0.5 * dt; }
    else h.dist += pull * 1.1 * dt;
    h.dist = Math.min(h.dist, 40);
    audio.creak(tension);
    overT = tension > 1.0 ? overT + dt : Math.max(0, overT - dt * 2);
    slackT = tension < 0.08 ? slackT + dt : Math.max(0, slackT - dt);
    fightMsg = overT > 0.15 ? "EASE OFF!" : slackT > 0.8 ? "REEL IN — THE LINE'S SLACK" : h.burst > 0 ? "IT'S RUNNING!" : held && inBand ? "PERFECT — KEEP IT THERE" : "HOLD TO REEL · RELEASE TO GIVE LINE";
    // the fish swims side to side out on the line
    h.ang += Math.sin(h.phase * 0.7) * dt * 0.5 * (h.burst > 0 ? 2.5 : 1);
    h.ang = clamp(h.ang, -0.8, 0.8);
    lure.x = ROD_BASE[0] + Math.sin(h.ang) * h.dist; lure.y = ROD_BASE[1] + Math.cos(h.ang) * h.dist;
    lure.z = 0;
    if (!inLake(lure.x, lure.y, 1)) { h.ang *= 0.95; }
    if (Math.random() < dt * (1.5 + (h.burst > 0 ? 5 : 0))) { ripples.push({ x: lure.x, y: lure.y, t: 0, max: 1.3 }); if (h.burst > 0 && Math.random() < 0.4) { splash(lure.x, lure.y, 0); audio.splash(); } }
    if (overT > 0.6) endFight("snap");
    else if (slackT > 2.2) endFight("slack");
    else if (h.dist < 3.2) endFight("caught");
}
function bot(dt) {
    if (state === "idle" && !ui.open) { const t = todName(clock); save.lure = t === "night" && lureOk("glow") ? "glow" : lureOk("fly") && Math.random() < 0.3 ? "fly" : "spinner"; aimPt = [rand(-14, 14), rand(6, 30)]; held = true; state = "charge"; charge = 0; bot.t = rand(0.5, 1); }
    else if (state === "charge") { bot.t -= dt; if (bot.t <= 0) { held = false; cast(); } }
    else if (state === "bite" && engaged && engaged.t > 0.25) strike();
    else if (state === "fight") held = tension < 0.6;
    else if (state === "card" && !Q.has("keepcard")) { ui.close(); closeCard(); }
}

// ------------------------------------------------------------------ catch card
function catchCard(c) {
    const rec = save.caught[c.sp.id];
    const isNew = !rec, record = rec && c.weight > rec.best;
    save.caught[c.sp.id] = { n: (rec?.n || 0) + 1, best: Math.max(rec?.best || 0, c.weight) };
    persist();
    audio.catch(c.sp.rarity); if (isNew) audio.newSpecies();
    ui.card(c, isNew, record);
    for (const [id, l] of Object.entries(LURES)) if (l.unlock && species() === l.unlock && isNew) setTimeout(() => ui.toast(`New lure unlocked: ${l.name}`), 1200);
}
function closeCard() { card = null; state = "idle"; setHint("Press and hold on the water to cast"); ui.hud(); }

// ------------------------------------------------------------------ camera
function updateCamera() {
    space.magnifier = K * 1.6;
    const sw = Math.sin(time * 0.4) * 0.05, aspect = canvas.width / canvas.height;
    let yaw = 0;
    if (state === "fight" || state === "wait" || state === "bite") yaw = clamp(Math.atan2(lure.x - ROD_BASE[0], lure.y - ROD_BASE[1]) * 0.35, -0.3, 0.3);
    if (state === "title") yaw = Math.sin(time * 0.05) * 0.15;
    camYaw = lerp(camYaw, yaw, 0.04);
    const eye = [0.2 + sw, -14.8, aspect < 1 ? 3.8 : 3.3], dist = 26;
    space.lookAt(...eye, eye[0] + Math.sin(camYaw) * dist, eye[1] + Math.cos(camYaw) * dist, aspect < 1 ? -1.6 : -0.5);
}
let camYaw = 0;
function project(x, y, z) {
    const v = [x - space.Xc, y - space.Yc, z - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
    return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(80000), dynSh = new Mesh(2000), dynA = new Mesh(20000);
const lightBuf = new Float32Array(24), lightColBuf = new Float32Array(18);
function beam(A, a, b, w, col) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], Z = space.zUnitVec;
    let n = [d[1] * Z[2] - d[2] * Z[1], d[2] * Z[0] - d[0] * Z[2], d[0] * Z[1] - d[1] * Z[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => (v / l) * w);
    A.quad([a[0] - n[0], a[1] - n[1], a[2] - n[2]], [b[0] - n[0], b[1] - n[1], b[2] - n[2]], [b[0] + n[0], b[1] + n[1], b[2] + n[2]], [a[0] + n[0], a[1] + n[1], a[2] + n[2]], col, MAT.ADD);
}
function fishShadow(Sh, x, y, h, len, k) {
    const c = Math.cos(h), s = Math.sin(h), L = len * 0.55 + 0.2, Wd = len * 0.2 + 0.1;
    const P = (a, b) => [x + c * a - s * b, y + s * a + c * b, 0.015];
    const v = (a, b, u, w) => { const p = P(a, b); Sh.v(p[0], p[1], p[2], u * 2 + w, k, 0, 0, MAT.SHADOW); };
    v(-L, -Wd, 0, 0); v(L, -Wd, 1, 0); v(L, Wd, 1, 1); v(-L, -Wd, 0, 0); v(L, Wd, 1, 1); v(-L, Wd, 0, 1);
}
function ring(A, x, y, r, col, w = 0.05) {
    for (let i = 0; i < 28; i++) {
        const a0 = (i / 28) * 6.283, a1 = ((i + 1) / 28) * 6.283;
        A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.02], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.02], [x + Math.cos(a1) * (r - w), y + Math.sin(a1) * (r - w), 0.02], [x + Math.cos(a0) * (r - w), y + Math.sin(a0) * (r - w), 0.02], col, MAT.ADD);
    }
}
function buildDynamic(sk) {
    const S = dyn, Sh = dynSh, A = dynA;
    S.reset(); Sh.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    const lights = [{ p: LANTERN, s: 1.2 + sk.night * 2.2, c: [1, 0.62, 0.28] }];
    const night = sk.night;
    // fish shadows under the surface (and a glimmer for glowing species at night)
    for (const f of fish) {
        fishShadow(Sh, f.x, f.y, f.h, f.len * 1.8, 0.32 + Math.min(0.25, f.len * 0.12));
        if ((f.sp.pattern === "glow" || f.sp.pattern === "ghost" || f.sp.pattern === "runes") && night > 0.4) A.sprite(f.x, f.y, -0.05, f.len * 1.2, 0.05 * night, 0.15 * night, 0.25 * night);
    }
    // rod, line, lure
    const tip = rodTip(), b = ROD_BASE;
    const mid = [lerp(b[0], tip[0], 0.55), lerp(b[1], tip[1], 0.55), lerp(b[2], tip[2], 0.55) + 0.15 - (state === "fight" ? tension * 0.35 : 0)];
    limb(S, b, mid, 0.05, 0.035, [0.22, 0.12, 0.06], MAT.GLOSS, 6);
    limb(S, mid, tip, 0.035, 0.015, [0.3, 0.18, 0.1], MAT.GLOSS, 5);
    limb(S, [b[0] + 0.05, b[1] - 0.6, b[2] - 0.4], b, 0.06, 0.055, [0.12, 0.1, 0.09], MAT.MATTE, 6);
    blob(S, [b[0] + 0.12, b[1] + 0.3, b[2] - 0.12], 0.12, 0.08, 0.12, [0.7, 0.7, 0.72], MAT.GLOSS, 7, 4);
    if (lure) {
        const lz = lure.z, lc = LURES[save.lure].color;
        const dist = Math.hypot(lure.x - tip[0], lure.y - tip[1]), sag = (state === "fight" ? (1.1 - tension) * 0.12 : 0.18) * dist;
        let prev = tip;
        for (let i = 1; i <= 12; i++) {
            const u = i / 12, p = [lerp(tip[0], lure.x, u), lerp(tip[1], lure.y, u), lerp(tip[2], lz + 0.06, u) - Math.sin(u * Math.PI) * sag];
            beam(A, prev, p, 0.008, [0.45 + night * 0.2, 0.47 + night * 0.2, 0.5 + night * 0.25]); prev = p;
        }
        if (state !== "fight") {
            blob(S, [lure.x, lure.y, lz + 0.08], 0.11, 0.11, 0.09, [0.95, 0.15, 0.12], MAT.GLOSS, 8, 3);
            blob(S, [lure.x, lure.y, lz + 0.18], 0.1, 0.1, 0.06, [0.95, 0.95, 0.92], MAT.GLOSS, 8, 3);
            limb(S, [lure.x, lure.y, lz + 0.2], [lure.x, lure.y, lz + 0.42], 0.015, 0.012, [0.95, 0.15, 0.12], MAT.MATTE, 4);
            if (isLure("glow")) { A.sprite(lure.x, lure.y, lz + 0.15, 0.55, lc[0] * 0.35, lc[1] * 0.35, lc[2] * 0.35); lights.push({ p: [lure.x, lure.y, 0.6], s: 1.2, c: lc }); }
        }
    }
    // hooked fish thrashing near the surface
    if (state === "fight" && hooked && hooked.burst > 0) drawFish(S, hooked.sp, hooked.len * 1.6, lure.x, lure.y, 0.05, hooked.ang + Math.PI / 2 + Math.sin(time * 9) * 0.5, 0.2, time * 18, Math.sin(time * 7) * 0.4, 1 + night);
    // leaping catch
    if (leap) {
        const u = leap.t, x = lerp(leap.from[0], ROD_BASE[0] + 0.2, u), y = lerp(leap.from[1], ROD_BASE[1] + 4, u), z = Math.sin(u * Math.PI) * 4.5 + u * 1.2;
        drawFish(S, leap.sp, Math.min(3, leap.len * 1.8), x, y, z, -Math.PI / 2 + u * 3, Math.cos(u * Math.PI) * 0.8, time * 20, u * 6, 1 + night);
        if (Math.random() < 0.6) parts.push({ x, y, z, vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(-1, 1), life: 0.6, max: 0.6, size: 0.05, c: [0.6, 0.7, 0.8], g: 6 });
    }
    // the catch on its card: rendered in front of the camera, in the card's clear window
    if (card) {
        card.t += 1 / 60;
        const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec, aspect = canvas.width / canvas.height, k = space.magnifier / 1.6;
        const el = document.getElementById("c-window").getBoundingClientRect();
        const sy = (el.top + el.height / 2) / innerHeight, ndcY = 1 - sy * 2, d = 7;
        const c = [0, 1, 2].map((i) => [space.Xc, space.Yc, space.Zc][i] + Z[i] * d + Y[i] * (ndcY * d / (k * aspect)));
        const disp = Math.min((el.width / innerWidth) * 2 * d / k * 0.62, 6);
        drawFish(S, card.sp, disp, c[0], c[1], c[2], Math.PI / 2 + Math.sin(card.t * 0.6) * 0.9, 0.12 * Math.sin(card.t * 0.8), card.t * 4, 0, 1.4);
        lights.push({ p: [c[0] - X[0] * 3, c[1] - X[1] * 3, c[2] + 2], s: 3.5, c: [1, 0.9, 0.75] });
    }
    // ripples, splashes
    for (const r of ripples) { const u = r.t / r.max; ring(A, r.x, r.y, 0.2 + u * (1.4 + r.max * 0.4), [0.22 * (1 - u), 0.26 * (1 - u), 0.3 * (1 - u)], 0.05); }
    for (const p of parts) { const k = p.life / p.max; A.sprite(p.x, p.y, p.z, p.size, p.c[0] * k, p.c[1] * k, p.c[2] * k); }
    // cast charge ring on the water
    if (state === "charge" && aimPt) {
        const ox = ROD_BASE[0], oy = ROD_BASE[1] + 1.2; let dx = aimPt[0] - ox, dy = aimPt[1] - oy; const l = Math.hypot(dx, dy) || 1;
        const dd = 5 + charge * 36, x = ox + dx / l * dd, y = oy + dy / l * Math.max(3, dd);
        ring(A, x, y, 0.9 + Math.sin(time * 8) * 0.08, [0.9, 0.7, 0.35], 0.09);
        for (let i = 1; i < 14; i++) { const u = i / 14; A.sprite(lerp(ox, x, u), lerp(oy + 2, y, u), 0.05, 0.05, 0.35, 0.28, 0.15); }
    }
    // fireflies at night, mist at dawn
    if (night > 0.3) for (let i = 0; i < 40; i++) {
        const x = Math.sin(i * 12.9 + time * 0.12 * (1 + (i % 3))) * 26 + (i % 2 ? 14 : -14), y = -8 + ((i * 7.31) % 22) + Math.cos(time * 0.2 + i) * 2, z = 0.6 + ((i * 3.7) % 2.5) + Math.sin(time + i) * 0.3;
        const k = Math.max(0, Math.sin(time * 1.4 + i * 2.3)) ** 3 * night;
        A.sprite(x, y, z, 0.08, 0.9 * k, 1.0 * k, 0.35 * k);
        if (k > 0.5 && i < 4) lights.push({ p: [x, y, z], s: 0.25 * k, c: [0.9, 1, 0.4] });
    }
    const dawn = todName(clock) === "dawn" ? 1 : 0;
    if (dawn) for (let i = 0; i < 24; i++) { const x = ((i * 11.3 + time * 0.6) % 70) - 35, y = 4 + ((i * 7.7) % 34); A.sprite(x, y, 0.8, 5, 0.035, 0.03, 0.035); }
    const sN = S.n, shN = Sh.n;
    S.append(Sh); S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, shN, aN: A.n, lights };
}
function render() {
    updateCamera();
    const sk = sky(clock);
    const { sN, shN, aN, lights } = buildDynamic(sk);
    const n = Math.min(6, lights.length);
    for (let i = 0; i < n; i++) { lightBuf.set([...lights[i].p, lights[i].s], i * 4); lightColBuf.set(lights[i].c, i * 3); }
    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, canvas.width / canvas.height);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uSun, sk.sun); gl.uniform3fv(U.uMoon, sk.moon);
    gl.uniform1f(U.uDay, sk.day); gl.uniform1f(U.uNight, sk.night);
    gl.uniform3fv(U.uSkyTop, sk.top); gl.uniform3fv(U.uSkyHor, sk.hor); gl.uniform3fv(U.uSunCol, sk.sunCol); gl.uniform3fv(U.uFog, sk.fog);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, n);
    space.applyCamera();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, sS);
    space.bind(true); space.draw(6, sN - 6);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    space.bind(false); space.draw(sS, sSh);
    space.bind(true); space.draw(sN, shN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(false); space.draw(sS + sSh, sA);
    space.bind(true); space.draw(sN + shN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: 0 });
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const MODALS = ["m-catch", "m-journal", "m-lure", "m-menu", "m-set", "m-how"];
const css = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
const fishSVG = (sp, known) => {
    const top = known ? css(sp.top) : "rgba(255,255,255,.12)", fl = known ? css(sp.flank) : "rgba(255,255,255,.08)", be = known ? css(sp.belly) : "rgba(255,255,255,.06)";
    const d = 10 + sp.depth * 26;
    return `<svg viewBox="0 0 120 54"><defs><linearGradient id="g${sp.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".55" stop-color="${fl}"/><stop offset="1" stop-color="${be}"/></linearGradient></defs><path d="M14 27 C 34 ${27 - d}, 88 ${27 - d}, 104 27 C 88 ${27 + d * 0.8}, 34 ${27 + d * 0.8}, 14 27 Z" fill="url(#g${sp.id})"/><path d="M16 27 L2 ${27 - d * 0.6} L6 27 L2 ${27 + d * 0.6} Z" fill="${fl}"/>${known ? `<circle cx="94" cy="${25}" r="2" fill="#111"/>` : ""}</svg>`;
};
const ui = {
    open: null, back: null, last: {},
    show(w) { $("title").classList.toggle("hidden", w !== "title"); $("hud").classList.toggle("hidden", w !== "hud"); },
    modal(id, back = null) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); this.open = id; this.back = back; },
    close() { const b = this.back; for (const m of MODALS) $(m).classList.add("hidden"); this.open = null; this.back = null; if (b) b(); },
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } },
    hud() {
        const tod = todName(clock), [t, s] = todLabel[tod];
        this.set("clk-t", t); this.set("clk-s", s);
        const day = tod === "day" || tod === "dusk" || tod === "dawn";
        const u = tod === "night" ? (clock - 0.1) / 0.52 : clock >= 0.62 ? (clock - 0.62) / 0.48 : (clock + 0.38) / 0.48;
        const a = Math.PI * (1 - clamp(u, 0, 1));
        $("clk-dot").setAttribute("cx", (37 + Math.cos(a) * 32).toFixed(1)); $("clk-dot").setAttribute("cy", (38 - Math.sin(a) * 32).toFixed(1));
        $("clk-dot").setAttribute("fill", day ? "#ffc477" : "#dfe8ff");
        this.set("j-count", `${species()}/${SPECIES.length}`);
        this.set("lure-name", LURES[save.lure].name);
        $("lure-dot").querySelector("i").style.background = $("lure-dot").querySelector("i").style.color = css(LURES[save.lure].color);
        if (state === "fight" && hooked) {
            const tn = clamp(tension / 1.2, 0, 1), ang = Math.PI * (1 - tn);
            $("t-needle").setAttribute("x2", (150 + Math.cos(ang) * 100).toFixed(1)); $("t-needle").setAttribute("y2", (110 - Math.sin(ang) * 100).toFixed(1));
            this.set("dist", `${Math.max(0, hooked.dist - 3).toFixed(1)} m`);
            $("stam").style.width = `${clamp(hooked.stamina / hooked.max, 0, 1) * 100}%`;
            this.set("fightmsg", fightMsg); $("fightmsg").classList.toggle("warn", fightMsg.startsWith("EASE") || fightMsg.startsWith("REEL IN"));
        }
        if (state === "bite") { const p = project(lure.x, lure.y, 0.6); $("bite").style.left = p[0] + "px"; $("bite").style.top = p[1] + "px"; }
    },
    fight(on) {
        $("fight").classList.toggle("hidden", !on); $("hint").classList.toggle("hidden", on);
        if (on) { const arc = (t) => { const a = Math.PI * (1 - t / 1.2); return `${(150 + Math.cos(a) * 130).toFixed(1)} ${(110 - Math.sin(a) * 130).toFixed(1)}`; }; $("t-band").setAttribute("d", `M${arc(0.33)} A130 130 0 0 1 ${arc(0.84)}`); }
    },
    bite(on) {
        let el = $("bite");
        if (on && !el) { el = document.createElement("div"); el.id = "bite"; el.textContent = "!"; document.body.appendChild(el); }
        if (!on && el) el.remove();
    },
    toast(t) { const h = $("hint"); h.textContent = t; this.last.hint = t; clearTimeout(this._t); this._t = setTimeout(() => { if (state === "idle") setHint("Press and hold on the water to cast"); else if (state === "wait") setHint("Wait for a bite… hold to reel in"); }, 2200); },
    card(c, isNew, record) {
        const r = RARITY[c.sp.rarity];
        $("c-rarity").textContent = r.name; $("c-rarity").style.color = r.css; $("c-rarity").style.background = `color-mix(in srgb, ${r.css} 15%, transparent)`;
        $("c-name").textContent = c.sp.name;
        $("c-w").textContent = c.weight < 1 ? `${Math.round(c.weight * 1000)} g` : `${c.weight.toFixed(c.weight < 10 ? 2 : 1)} kg`;
        $("c-l").textContent = `${Math.round(c.len * 100)} cm`;
        $("c-n").textContent = save.caught[c.sp.id].n;
        $("c-desc").textContent = c.sp.desc;
        $("c-ribbon").classList.toggle("hidden", !isNew && !record);
        $("c-ribbon").textContent = isNew ? "NEW SPECIES" : "NEW RECORD";
        this.modal("m-catch");
    },
    journal() {
        const n = species();
        $("j-sub").textContent = `${n} of ${SPECIES.length} species recorded · ${Object.values(save.caught).reduce((a, b) => a + b.n, 0)} fish caught`;
        $("j-fill").style.width = `${(n / SPECIES.length) * 100}%`;
        const where = { shallows: "lily shallows", reeds: "reed bed", rocks: "far rocks", deep: "deep middle" }, when = { any: "any hour", dusk: "dusk", night: "night", dawn: "dawn" };
        $("j-grid").innerHTML = SPECIES.map((sp) => {
            const c = save.caught[sp.id], r = RARITY[sp.rarity];
            return `<div class="jc ${c ? "got" : ""}" style="--rc:${r.css}"><span class="rr"></span>${fishSVG(sp, !!c)}<h4>${c ? sp.name : "???"}</h4><small>${c ? `Best ${c.best < 1 ? Math.round(c.best * 1000) + " g" : c.best.toFixed(1) + " kg"} · ×${c.n}` : `${r.name} · ${where[sp.zone]}, ${when[sp.time]}${sp.lure === "glow" ? " · glow" : ""}`}</small></div>`;
        }).join("");
        this.modal("m-journal", this.open === "m-menu" ? () => this.modal("m-menu") : null);
    },
    lures() {
        $("lure-list").innerHTML = Object.entries(LURES).map(([id, l]) => { const ok = lureOk(id); return `<button class="lure ${id === save.lure ? "on" : ""} ${ok ? "" : "locked"}" data-id="${id}" ${ok ? "" : "disabled"}><i style="background:${css(l.color)};color:${css(l.color)}"></i><span><b>${l.name}</b><small>${ok ? l.desc : `Record ${l.unlock} species to unlock`}</small></span></button>`; }).join("");
        $("lure-list").querySelectorAll(".lure:not(.locked)").forEach((b) => b.addEventListener("click", () => { save.lure = b.dataset.id; persist(); audio.click(); this.close(); this.hud(); }));
        this.modal("m-lure");
    },
    title() { const n = species(); $("t-meta").innerHTML = n ? `<b>${n}</b> of ${SPECIES.length} species in your journal` : "15 species · dusk to dawn · one old dock"; },
};
let resume = null;
function menu() { resume = state; state = "paused"; $("mm-sub").textContent = `${todLabel[todName(clock)][0]} · ${species()} species recorded`; ui.modal("m-menu"); }
$("t-play").addEventListener("click", () => { ui.close(); startFishing(); });
$("t-how").addEventListener("click", () => ui.modal("m-how"));
$("t-set").addEventListener("click", () => { setUI(); ui.modal("m-set"); });
$("b-journal").addEventListener("click", () => { audio.click(); ui.journal(); });
$("b-lure").addEventListener("click", () => { if (state === "idle") { audio.click(); ui.lures(); } else ui.toast("Reel in before changing lures"); });
$("b-menu").addEventListener("click", menu);
$("mm-resume").addEventListener("click", () => { state = resume || "idle"; ui.close(); });
$("mm-set").addEventListener("click", () => { setUI(); ui.modal("m-set", () => ui.modal("m-menu")); });
$("mm-how").addEventListener("click", () => ui.modal("m-how", () => ui.modal("m-menu")));
$("mm-title").addEventListener("click", () => { ui.close(); persist(); state = "title"; lure = null; hooked = null; engaged = null; ui.fight(false); ui.bite(false); ui.show("title"); ui.title(); });
$("c-ok").addEventListener("click", () => { ui.close(); closeCard(); });
$("c-release").addEventListener("click", () => { ui.close(); splash(ROD_BASE[0] + 0.3, ROD_BASE[1] + 5, 1); audio.splash(); closeCard(); });
for (const [x, m] of [["mj-x", "m-journal"], ["ml-x", "m-lure"], ["ms-x", "m-set"], ["mh-x", "m-how"]]) $(x).addEventListener("click", () => ui.close());
$("mh-ok").addEventListener("click", () => ui.close());
for (const m of ["m-journal", "m-lure", "m-set", "m-how"]) $(m).addEventListener("pointerdown", (e) => { if (e.target === $(m)) ui.close(); });
function setUI() {
    for (const [id, v] of [["s-vol", save.volume], ["s-mus", save.music]]) { $(id).value = Math.round(v * 100); $(id).style.setProperty("--v", `${v * 100}%`); }
    document.querySelectorAll("#s-time button").forEach((b) => b.classList.toggle("on", +b.dataset.t === save.timeScale));
}
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; persist(); audio.init(); audio.setVolume(save.volume); e.target.style.setProperty("--v", `${save.volume * 100}%`); });
$("s-mus").addEventListener("input", (e) => { save.music = e.target.value / 100; persist(); audio.init(); audio.setMusic(save.music); e.target.style.setProperty("--v", `${save.music * 100}%`); });
document.querySelectorAll("#s-time button").forEach((b) => b.addEventListener("click", () => { save.timeScale = +b.dataset.t; persist(); setUI(); }));
setInterval(persist, 15000);

// ------------------------------------------------------------------ boot
window.__lake = () => ({ state, clock: +clock.toFixed(3), tod: todName(clock), fish: fish.length, engaged: engaged?.sp.id, hooked: hooked?.sp.id, tension: +tension.toFixed(2), species: species(), caught: Object.values(save.caught).reduce((a, b) => a + b.n, 0), fps: fpsNow, post: post.ok });
let last = performance.now(), fpsNow = 0, fN = 0, fT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fN++; fT += (now - last) / 1000; if (fT > 1) { fpsNow = Math.round(fN / fT); fN = 0; fT = 0; }
    last = now;
    if (state !== "paused") for (let s = 0; s < SPEED; s++) update(dt);
    render();
    requestAnimationFrame(frame);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);
populate();
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.title();
    if (Q.has("autoplay") || Q.has("play")) startFishing();
}, 400);
