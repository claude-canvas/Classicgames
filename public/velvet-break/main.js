// VELVET BREAK — 8-ball pool in a midnight lounge, rendered with the projection3d library (Space, via GameSpace)
// + bloom. See DESIGN.md. physics.js simulates, rules.js referees, ai.js plays the house; this file renders,
// handles aiming / power / spin / ball-in-hand and drives the UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp, limb, tube } from "./mesh.js";
import { Table, rack, L, W, R, POCKETS, HEAD_X, ballColor, isStripe } from "./physics.js";
import { Match } from "./rules.js";
import { cpuShot, placeCue, LEVELS } from "./ai.js";
import { buildAtlas, drawBall } from "./balls.js";
import { buildScene, LAMP } from "./scene.js";

const Q = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(6, +Q.get("speed") || 1));
const K = 1.9;

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
    if (px > 3.2e6) dpr *= Math.sqrt(3.2e6 / px);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    post.resize(canvas.width, canvas.height);
}
const atlasTex = gl.createTexture();
{
    const cv = buildAtlas();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
}

// ------------------------------------------------------------------ save
const save = (() => { try { return { wins: {}, losses: {}, volume: 0.8, music: 0.6, guide: true, cpu: "normal", ...JSON.parse(localStorage.getItem("velvetbreak.save")) }; } catch { return { wins: {}, losses: {}, volume: 0.8, music: 0.6, guide: true, cpu: "normal" }; } })();
const persist = () => { try { localStorage.setItem("velvetbreak.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static scene
const stat = new Mesh(80000);
let sS = 0, sSh = 0, sA = 0;
{
    const S = new Mesh(70000), Sh = new Mesh(200), A = new Mesh(400);
    buildScene(S, Sh, A);
    stat.append(S); stat.append(Sh); stat.append(A);
    sS = S.n; sSh = Sh.n; sA = A.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ state
let state = "loading";               // loading | title | aim | place | cpu | rolling | paused | end
let mode = "cpu", table = new Table(rack()), match = null;
let aim = 0, power = 0, spin = { x: 0, y: 0 }, view = "aim", time = 0;
let cpu = null, charging = false, placeGhost = null, banner = null, settleT = 0;
const isCpuTurn = () => match && (Q.has("autoplay") || (mode === "cpu" && match.turn === 1));

function newGame(m) {
    mode = m;
    table = new Table(rack());
    const names = m === "cpu" ? [{ name: "You" }, { name: `House · ${LEVELS[save.cpu].name}`, cpu: true }] : m === "duo" ? [{ name: "Player 1" }, { name: "Player 2" }] : [{ name: "You" }, { name: "—" }];
    match = new Match(names, m === "practice");
    aim = 0; power = 0; spin = { x: 0, y: 0 }; view = "aim";
    state = "title";
    ui.show("hud"); ui.cards();
    nextTurn(true);
}
function nextTurn(first) {
    power = 0; spin = { x: 0, y: 0 }; ui.spin(); ui.power();
    const cue = table.cue;
    if (cue.potted || match.ballInHand) {
        if (cue.potted || !table.free(cue.x, cue.y, 0)) { Object.assign(cue, { potted: false, sink: 0, vx: 0, vy: 0, x: HEAD_X, y: 0 }); let k = 0; while (!table.free(cue.x, cue.y, 0) && k++ < 40) cue.y += 0.6 * (k % 2 ? k : -k); }
    }
    aim = defaultAim();
    if (isCpuTurn()) { state = "cpu"; cpu = { t: 0, stage: "think" }; }
    else state = match.ballInHand && !first ? "place" : "aim";
    if (match.breakShot && !isCpuTurn()) state = "place";
    ui.cards();
    if (!first || mode !== "practice") ui.banner(match.breakShot ? `${match.current.name} to break` : isCpuTurn() ? `${match.current.name}'s shot` : match.ballInHand ? `${match.current.name} — ball in hand` : `${match.current.name} to shoot`);
}
function defaultAim() {
    const c = table.cue, t = match.legalTargets(table);
    let best = null, bd = 1e9;
    for (const n of t) { const b = table.balls.find((x) => x.n === n); const d = Math.hypot(b.x - c.x, b.y - c.y); if (d < bd) { bd = d; best = b; } }
    return best ? Math.atan2(best.y - c.y, best.x - c.x) : 0;
}
function shoot() {
    if ((state !== "aim" && state !== "cpu") || power < 0.03) return;
    table.strike(aim, power, spin);
    audio.strike(power);
    state = "rolling"; settleT = 0; charging = false;
    ui.power();
}
function afterRoll() {
    const r = match.afterShot(table.shot, table);
    if (r.foul) audio.chime(false); else if (table.shot.potted.length) audio.chime(true);
    if (r.message) ui.banner(r.message, !!r.foul);
    if (r.end) {
        state = "end";
        const youWon = mode === "cpu" ? match.winner === 0 : null;
        if (mode === "cpu") { const k = save.cpu; if (youWon) save.wins[k] = (save.wins[k] || 0) + 1; else save.losses[k] = (save.losses[k] || 0) + 1; persist(); }
        if (youWon !== false) audio.win();
        setTimeout(() => ui.end(), 1400);
        return;
    }
    if (mode === "practice" && table.balls.every((b) => b.n === 0 || b.potted)) { ui.banner("Table cleared! Racking again…"); setTimeout(() => { table = new Table(rack()); match.breakShot = true; nextTurn(); }, 1600); state = "title"; return; }
    nextTurn();
}

// ------------------------------------------------------------------ input
function ground(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect);
    if (d[2] >= -1e-4) return null;
    const t = (R - space.Zc) / d[2];
    return [space.Xc + d[0] * t, space.Yc + d[1] * t];
}
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    if (state === "place") { const g = ground(e.clientX, e.clientY); if (g) tryPlace(g); return; }
    if (state !== "aim") return;
    canvas.setPointerCapture?.(e.pointerId);
    drag = { x: e.clientX, aim };
    if (view === "table") { const g = ground(e.clientX, e.clientY); if (g) aim = Math.atan2(g[1] - table.cue.y, g[0] - table.cue.x); }
});
canvas.addEventListener("pointermove", (e) => {
    if (state === "place") { placeGhost = ground(e.clientX, e.clientY); return; }
    if (!drag || state !== "aim") return;
    if (view === "table") { const g = ground(e.clientX, e.clientY); if (g) aim = Math.atan2(g[1] - table.cue.y, g[0] - table.cue.x); }
    else aim = drag.aim - (e.clientX - drag.x) * (e.shiftKey ? 0.0008 : 0.0035);
});
canvas.addEventListener("pointerup", () => { drag = null; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
function tryPlace(g) {
    let [x, y] = g;
    if (match.breakShot) x = Math.min(x, HEAD_X);
    x = clamp(x, -L / 2 + R, L / 2 - R); y = clamp(y, -W / 2 + R, W / 2 - R);
    if (!table.free(x, y, 0)) { ui.banner("Something's in the way", true); return; }
    Object.assign(table.cue, { x, y, potted: false, sink: 0, vx: 0, vy: 0 });
    state = "aim"; aim = defaultAim(); placeGhost = null; audio.click(); ui.cards();
    ui.banner(`${match.current.name} to shoot`);
}
// power cue: drag down along the track, release to shoot
const ptrack = document.getElementById("ptrack");
let pdrag = null;
ptrack.addEventListener("pointerdown", (e) => { audio.init(); if (state !== "aim") return; ptrack.setPointerCapture(e.pointerId); pdrag = { y: e.clientY, h: ptrack.getBoundingClientRect().height }; });
ptrack.addEventListener("pointermove", (e) => { if (!pdrag) return; power = clamp((e.clientY - pdrag.y) / (pdrag.h * 0.85), 0, 1); ui.power(); });
ptrack.addEventListener("pointerup", () => { if (!pdrag) return; pdrag = null; if (power > 0.03) shoot(); else { power = 0; ui.power(); } });
// spin ball
const sball = document.getElementById("sball");
let sdrag = false;
const setSpin = (e) => { const r = sball.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1; const d = Math.hypot(x, y); if (d > 0.72) { x *= 0.72 / d; y *= 0.72 / d; } spin = { x: x / 0.72, y: -y / 0.72 }; if (Math.hypot(spin.x, spin.y) < 0.12) spin = { x: 0, y: 0 }; ui.spin(); };
sball.addEventListener("pointerdown", (e) => { if (state !== "aim" && state !== "place") return; sdrag = true; sball.setPointerCapture(e.pointerId); setSpin(e); });
sball.addEventListener("pointermove", (e) => { if (sdrag) setSpin(e); });
sball.addEventListener("pointerup", () => { sdrag = false; audio.click(); });
sball.addEventListener("dblclick", () => { spin = { x: 0, y: 0 }; ui.spin(); });

addEventListener("keydown", (e) => {
    audio.init();
    if (e.code === "Escape") { if (ui.open) { if (ui.open !== "m-end") ui.close(); } else if (["aim", "place", "cpu", "rolling"].includes(state)) pause(); return; }
    if (e.code === "KeyP" && ["aim", "place", "cpu", "rolling"].includes(state)) { pause(); return; }
    if (state !== "aim") return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") { aim += (e.shiftKey ? 0.15 : 1) * Math.PI / 180; e.preventDefault(); }
    if (e.code === "ArrowRight" || e.code === "KeyD") { aim -= (e.shiftKey ? 0.15 : 1) * Math.PI / 180; e.preventDefault(); }
    if (e.code === "KeyV") toggleView();
    if (e.code === "Space" && !charging) { charging = true; power = 0; e.preventDefault(); }
});
addEventListener("keyup", (e) => { if (e.code === "Space" && charging) { charging = false; shoot(); } });
addEventListener("blur", () => { if (["aim", "place", "cpu", "rolling"].includes(state)) pause(); });
let resumeState = null;
function pause() { resumeState = state; state = "paused"; document.getElementById("mp-sub").textContent = mode === "practice" ? "Practice table" : `${match.players[0].name} vs ${match.players[1].name}`; ui.modal("m-pause"); }
function toggleView() { view = view === "aim" ? "table" : "aim"; document.getElementById("viewlab").textContent = view === "aim" ? "Table view" : "Aim view"; }

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt;
    if (charging) { power = Math.min(1, power + dt / 1.3); ui.power(); }
    if (state === "rolling") {
        table.step(dt);
        for (const ev of table.events) {
            if (ev.type === "clack") audio.clack(ev.speed);
            else if (ev.type === "rail") audio.rail(ev.speed);
            else if (ev.type === "pot") { audio.pot(); ui.cards(); }
        }
        table.events.length = 0;
        if (!table.moving()) { settleT += dt; if (settleT > 0.25) afterRoll(); }
    } else table.events.length = 0;
    if (state === "cpu") cpuStep(dt);
}
function cpuStep(dt) {
    cpu.t += dt;
    const lv = LEVELS[Q.has("autoplay") ? "hard" : save.cpu] || LEVELS.normal;
    if (cpu.stage === "think" && cpu.t > lv.think) {
        const targets = match.legalTargets(table);
        if (match.ballInHand && !match.breakShot) { const p = placeCue(table, targets); if (p) Object.assign(table.cue, { x: p.x, y: p.y, potted: false, sink: 0 }); }
        cpu.shot = match.breakShot ? { angle: Math.atan2(-table.cue.y, L / 4 - table.cue.x) + (Math.random() - 0.5) * 0.02, power: 0.95, spin: { x: 0, y: 0.1 } } : cpuShot(table, targets, Q.has("autoplay") ? "hard" : save.cpu);
        cpu.from = aim; cpu.stage = "aim"; cpu.t = 0;
        const d = Math.atan2(Math.sin(cpu.shot.angle - aim), Math.cos(cpu.shot.angle - aim)); cpu.to = aim + d;
    } else if (cpu.stage === "aim") {
        const u = Math.min(1, cpu.t / 0.9), e = u * u * (3 - 2 * u);
        aim = lerp(cpu.from, cpu.to, e);
        if (u >= 1) { cpu.stage = "power"; cpu.t = 0; spin = cpu.shot.spin; ui.spin(); }
    } else if (cpu.stage === "power") {
        power = Math.min(cpu.shot.power, cpu.t / 0.6 * cpu.shot.power); ui.power();
        if (cpu.t > 0.75) { power = cpu.shot.power; aim = cpu.shot.angle; shoot(); }
    }
}

// ------------------------------------------------------------------ camera
const camE = [0, -30, 30], camT = [0, 0, 0];
function updateCamera(dt) {
    space.magnifier = K * 1.6;
    const aspect = canvas.width / canvas.height;
    const fitD = Math.max(K * (L + 4) * 0.5 * 1.04, K * aspect * (W + 4) * 0.5 * 1.25);
    let e, t;
    const c = table.cue, dx = Math.cos(aim), dy = Math.sin(aim);
    if (state === "title" || state === "loading") { const a = time * 0.06; e = [Math.cos(a) * 30, Math.sin(a) * 22 - 4, 14]; t = [0, 0, -1]; }
    else if (state === "rolling" || state === "place" || state === "end" || view === "table") { e = [0, -fitD * Math.cos(1.2), fitD * Math.sin(1.2)]; t = [0, 0.4, 0]; }
    else { const back = aspect < 1 ? 13 : 10; e = [c.x - dx * back, c.y - dy * back, 4.4]; t = [c.x + dx * 7, c.y + dy * 7, -0.5]; }
    const f = 1 - Math.exp(-dt * (state === "rolling" ? 2.5 : 5));
    for (let i = 0; i < 3; i++) { camE[i] += (e[i] - camE[i]) * f; camT[i] += (t[i] - camT[i]) * f; }
    space.lookAt(...camE, ...camT);
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(80000), dynSh = new Mesh(2000), dynA = new Mesh(20000);
const lightBuf = new Float32Array(16), lightColBuf = new Float32Array(12);

// trace the aim line: first ball hit (or a cushion), the ghost ball, the object ball's path and the cue deflection
function traceAim() {
    const c = table.cue, dx = Math.cos(aim), dy = Math.sin(aim);
    let tHit = 1e9, hit = null;
    for (const b of table.balls) {
        if (b.n === 0 || b.potted) continue;
        const ox = b.x - c.x, oy = b.y - c.y, proj = ox * dx + oy * dy;
        if (proj <= 0) continue;
        const perp2 = ox * ox + oy * oy - proj * proj, r2 = 4 * R * R;
        if (perp2 > r2) continue;
        const t = proj - Math.sqrt(r2 - perp2);
        if (t < tHit) { tHit = t; hit = b; }
    }
    // cushion distance
    const lim = (v, d, half) => (d > 0 ? (half - R - v) / d : d < 0 ? (-half + R - v) / d : 1e9);
    const tRail = Math.min(lim(c.x, dx, L / 2), lim(c.y, dy, W / 2));
    if (hit && tHit < tRail) {
        const gx = c.x + dx * tHit, gy = c.y + dy * tHit;
        const nx = (hit.x - gx) / (2 * R), ny = (hit.y - gy) / (2 * R);
        const dot = dx * nx + dy * ny;
        return { gx, gy, hit, ox: nx, oy: ny, cx: dx - dot * nx, cy: dy - dot * ny, strength: dot };
    }
    return { gx: c.x + dx * tRail, gy: c.y + dy * tRail, hit: null };
}
function dots(A, x0, y0, x1, y1, col, gap = 0.32) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(d / gap);
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / Math.max(n, 1), x = lerp(x0, x1, t), y = lerp(y0, y1, t), s = 0.045;
        A.quad([x - s, y - s, 0.015], [x + s, y - s, 0.015], [x + s, y + s, 0.015], [x - s, y + s, 0.015], col, MAT.ADD);
    }
}
function ringAt(A, x, y, r, col, w = 0.04) {
    for (let i = 0; i < 32; i++) {
        const a0 = (i / 32) * 6.283, a1 = ((i + 1) / 32) * 6.283;
        A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.016], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.016], [x + Math.cos(a1) * (r - w), y + Math.sin(a1) * (r - w), 0.016], [x + Math.cos(a0) * (r - w), y + Math.sin(a0) * (r - w), 0.016], col, MAT.ADD);
    }
}
function drawCue(S, A) {
    const c = table.cue, dx = Math.cos(aim), dy = Math.sin(aim);
    const pull = 0.35 + power * 2.4 - (state === "rolling" ? 0.3 : 0);
    const tilt = 0.16, ux = -dx * Math.cos(tilt), uy = -dy * Math.cos(tilt), uz = Math.sin(tilt);
    const P = (d) => [c.x + ux * d, c.y + uy * d, R + 0.05 + uz * d];
    const seg = (a, b, ra, rb, col, mat = MAT.GLOSS) => limb(S, P(a), P(b), ra, rb, col, mat, 8);
    seg(pull, pull + 0.12, 0.055, 0.056, [0.25, 0.45, 0.75]);                 // chalked tip
    seg(pull + 0.12, pull + 0.4, 0.056, 0.06, [0.95, 0.94, 0.9]);             // ferrule
    seg(pull + 0.4, pull + 7.2, 0.06, 0.1, [0.86, 0.72, 0.5]);                // maple shaft
    seg(pull + 7.2, pull + 7.45, 0.105, 0.105, [0.95, 0.75, 0.35]);           // brass joint
    seg(pull + 7.45, pull + 13.6, 0.11, 0.15, [0.16, 0.07, 0.04]);            // ebony butt
    seg(pull + 9.5, pull + 9.9, 0.125, 0.128, [0.95, 0.75, 0.35]);
    seg(pull + 13.6, pull + 13.9, 0.15, 0.15, [0.05, 0.05, 0.05], MAT.MATTE);
}
function buildDynamic() {
    const S = dyn, Sh = dynSh, A = dynA;
    S.reset(); Sh.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    for (const b of table.balls) {
        if (b.potted && b.sink >= 1) continue;
        let z = R, x = b.x, y = b.y, sc = 1;
        if (b.potted) { const u = b.sink; x = lerp(b.x, b.px, Math.min(1, u * 2)); y = lerp(b.y, b.py, Math.min(1, u * 2)); z = R - u * 1.2; sc = 1 - u * 0.2; }
        drawBall(S, { ...b, x, y }, z, sc);
        if (!b.potted) {
            const ox = (b.x - LAMP[0]) * 0.03, oy = (b.y - LAMP[1]) * 0.05;
            const sx = b.x + ox, sy = b.y + oy, r = R * 1.35;
            Sh.v(sx - r, sy - r, 0.004, 0, 0.62, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy - r, 0.004, 2, 0.62, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy + r, 0.004, 3, 0.62, 0, 0, MAT.SHADOW);
            Sh.v(sx - r, sy - r, 0.004, 0, 0.62, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy + r, 0.004, 3, 0.62, 0, 0, MAT.SHADOW); Sh.v(sx - r, sy + r, 0.004, 1, 0.62, 0, 0, MAT.SHADOW);
        }
    }
    if (state === "aim" || state === "cpu") {
        drawCue(S, A);
        if (state === "aim") {
            const tr = traceAim(), c = table.cue, gcol = [0.5, 0.48, 0.42];
            dots(A, c.x, c.y, tr.gx, tr.gy, gcol);
            ringAt(A, tr.gx, tr.gy, R, [0.6, 0.58, 0.5]);
            if (tr.hit) {
                const legal = match.legalTargets(table).includes(tr.hit.n);
                const len = (save.guide ? 9 : 2.6) * Math.max(0.25, tr.strength);
                dots(A, tr.hit.x, tr.hit.y, tr.hit.x + tr.ox * len, tr.hit.y + tr.oy * len, legal ? [0.45, 0.85, 0.75] : [0.85, 0.35, 0.3]);
                const cl = 2.2 * (1 - Math.abs(tr.strength)) + 0.4;
                dots(A, tr.gx, tr.gy, tr.gx + tr.cx * cl, tr.gy + tr.cy * cl, [0.35, 0.34, 0.3], 0.26);
                ringAt(A, tr.hit.x, tr.hit.y, R + 0.08, legal ? [0.35, 0.75, 0.65] : [0.85, 0.3, 0.25], 0.03);
            }
        }
    }
    if (state === "place" && placeGhost) {
        let [x, y] = placeGhost; if (match.breakShot) x = Math.min(x, HEAD_X);
        const ok = table.free(x, y, 0);
        ringAt(A, x, y, R + 0.06, ok ? [0.6, 0.9, 0.7] : [0.95, 0.35, 0.3], 0.05);
        drawBall(S, { ...table.cue, x, y }, R, 1, 0.75);
    }
    if (state === "place" && match.breakShot) {
        const c = [0.12, 0.2, 0.18];
        A.quad([-L / 2, -W / 2, 0.01], [HEAD_X, -W / 2, 0.01], [HEAD_X, W / 2, 0.01], [-L / 2, W / 2, 0.01], c, MAT.ADD);
    }
    const sN = S.n, shN = Sh.n;
    S.append(Sh); S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, shN, aN: A.n };
}
function render() {
    const { sN, shN, aN } = buildDynamic();
    post.begin();
    gl.useProgram(U.program);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, canvas.width / canvas.height);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time); gl.uniform1i(U.uAtlas, 3);
    gl.uniform3f(U.uLamp, ...LAMP);
    lightBuf.set([-34, 31, 7, 2.5, 34, 31, 7, 2.5, -16, 31, 3, 1.5, 0, 0, 0, 0]); lightColBuf.set([1, 0.6, 0.3, 1, 0.6, 0.3, 0.9, 0.6, 0.4, 0, 0, 0]);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, 3);
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
const mini = (n, gone) => { const c = ballColor(n).map((v) => Math.round(Math.min(1, v) * 255)).join(","); const bg = isStripe(n) ? `linear-gradient(180deg,#f4f1e6 30%,rgb(${c}) 30% 70%,#f4f1e6 70%)` : `rgb(${c})`; return `<span class="mb ${gone ? "gone" : ""}" style="background:${bg}"></span>`; };
const MODALS = ["m-pause", "m-set", "m-how", "m-end"];
const ui = {
    open: null, back: null,
    show(w) { $("title").classList.toggle("hidden", w !== "title"); $("hud").classList.toggle("hidden", w !== "hud"); },
    modal(id, back = null) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); this.open = id; this.back = back; },
    close() { const b = this.back; for (const m of MODALS) $(m).classList.add("hidden"); this.open = null; this.back = null; if (b) b(); },
    cards() {
        if (!match) return;
        match.players.forEach((p, i) => {
            $(`p${i}`).classList.toggle("on", match.turn === i && !match.winner);
            $(`p${i}-n`).textContent = p.name;
            $(`p${i}-av`).textContent = p.name[0];
            $(`p${i}-g`).textContent = match.practice ? "Practice" : p.group || "Open";
            const set = p.group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : p.group === "stripes" ? [9, 10, 11, 12, 13, 14, 15] : [];
            const potted = (n) => table.balls.find((b) => b.n === n).potted;
            $(`p${i}-b`).innerHTML = set.map((n) => mini(n, potted(n))).join("") + (p.group ? mini(8, potted(8)) : "");
        });
        $("p1").classList.toggle("hidden", match.practice);
        $("bih").classList.toggle("hidden", state !== "place");
    },
    banner(t, foul) { const el = $("banner"); el.textContent = t; el.classList.toggle("foul", !!foul); el.classList.add("show"); clearTimeout(this._b); this._b = setTimeout(() => el.classList.remove("show"), 2600); },
    power() { $("pfill").style.height = `${power * 100}%`; $("pcue").style.top = `${power * 18}%`; $("pval").textContent = `${Math.round(power * 100)}%`; },
    spin() {
        $("sdot").style.left = `${50 + spin.x * 36}%`; $("sdot").style.top = `${50 - spin.y * 36}%`;
        $("spinlab").textContent = !spin.x && !spin.y ? "Centre" : `${spin.y > 0.3 ? "Follow" : spin.y < -0.3 ? "Draw" : ""}${spin.x > 0.3 ? " · right" : spin.x < -0.3 ? " · left" : ""}`.replace(/^ · /, "") || "Centre";
    },
    end() {
        const w = match.players[match.winner];
        $("e-k").textContent = "Game over";
        $("e-t").textContent = mode === "cpu" ? (match.winner === 0 ? "You win" : "The house wins") : `${w.name} wins`;
        $("e-msg").textContent = mode === "cpu" ? `Record vs ${LEVELS[save.cpu].name}: ${save.wins[save.cpu] || 0} – ${save.losses[save.cpu] || 0}` : "";
        const s = match.stats;
        $("e-grid").innerHTML = `<span class="h"></span><span class="h">${match.players[0].name.slice(0, 10)}</span><span class="h">${match.players[1].name.split(" ")[0].slice(0, 10)}</span>` +
            [["Balls potted", "potted"], ["Shots", "shots"], ["Fouls", "fouls"]].map(([l, k]) => `<span>${l}</span><b>${s[0][k]}</b><b>${s[1][k]}</b>`).join("");
        this.modal("m-end");
    },
    title() {
        const w = Object.values(save.wins).reduce((a, b) => a + b, 0), l = Object.values(save.losses).reduce((a, b) => a + b, 0);
        $("t-stats").innerHTML = w + l ? `Record vs the house: <b>${w}</b> wins · <b>${l}</b> losses` : "Three ways to play · real physics · spin & english";
        $("mb-cpu").innerHTML = [1, 9, 8].map((n) => mini(n)).join(""); $("mb-duo").innerHTML = [3, 11].map((n) => mini(n)).join(""); $("mb-pr").innerHTML = [5, 13, 2, 0].map((n) => mini(n)).join("");
        document.querySelectorAll("#cpu-diff button").forEach((b) => b.classList.toggle("on", b.dataset.d === save.cpu));
    },
};
const startMode = (m) => () => { audio.init(); ui.close(); newGame(m); };
$("m-cpu").addEventListener("click", startMode("cpu"));
$("m-duo").addEventListener("click", startMode("duo"));
$("m-pr").addEventListener("click", startMode("practice"));
document.querySelectorAll("#cpu-diff button").forEach((b) => b.addEventListener("click", () => { save.cpu = b.dataset.d; persist(); ui.title(); }));
$("t-how").addEventListener("click", () => ui.modal("m-how"));
$("t-set").addEventListener("click", () => { setUI(); ui.modal("m-set"); });
$("b-pause").addEventListener("click", pause);
$("b-view").addEventListener("click", toggleView);
$("mp-resume").addEventListener("click", () => { state = resumeState; ui.close(); });
$("mp-restart").addEventListener("click", () => { ui.close(); newGame(mode); });
$("mp-set").addEventListener("click", () => { setUI(); ui.modal("m-set", () => ui.modal("m-pause")); });
$("mp-menu").addEventListener("click", () => { ui.close(); state = "title"; match = null; ui.show("title"); ui.title(); });
$("ms-x").addEventListener("click", () => ui.close());
$("mh-x").addEventListener("click", () => ui.close());
$("mh-ok").addEventListener("click", () => ui.close());
$("e-menu").addEventListener("click", () => { ui.close(); state = "title"; match = null; ui.show("title"); ui.title(); });
$("e-again").addEventListener("click", () => { ui.close(); newGame(mode); });
function setUI() {
    for (const [id, v] of [["s-vol", save.volume], ["s-mus", save.music]]) { $(id).value = Math.round(v * 100); $(id).style.setProperty("--v", `${v * 100}%`); }
    document.querySelectorAll("#s-guide button").forEach((b) => b.classList.toggle("on", (b.dataset.g === "1") === save.guide));
}
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; persist(); audio.init(); audio.setVolume(save.volume); e.target.style.setProperty("--v", `${save.volume * 100}%`); });
$("s-mus").addEventListener("input", (e) => { save.music = e.target.value / 100; persist(); audio.init(); audio.setMusic(save.music); e.target.style.setProperty("--v", `${save.music * 100}%`); });
document.querySelectorAll("#s-guide button").forEach((b) => b.addEventListener("click", () => { save.guide = b.dataset.g === "1"; persist(); setUI(); }));
for (const m of ["m-set", "m-how"]) $(m).addEventListener("pointerdown", (e) => { if (e.target === $(m)) ui.close(); });

// ------------------------------------------------------------------ boot
window.__pool = () => ({ state, mode, turn: match?.turn, groups: match?.players.map((p) => p.group), winner: match?.winner, left: table.balls.filter((b) => !b.potted).length, shots: match?.shots, fps: fpsNow, post: post.ok });
let last = performance.now(), fpsNow = 0, fN = 0, fT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fN++; fT += (now - last) / 1000; if (fT > 1) { fpsNow = Math.round(fN / fT); fN = 0; fT = 0; }
    last = now;
    if (state !== "paused") for (let s = 0; s < SPEED; s++) update(dt);
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.title();
    const m = Q.get("mode") || (Q.has("autoplay") ? "cpu" : null);
    if (m) newGame(m);
}, 350);
