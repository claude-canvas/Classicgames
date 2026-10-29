// MARBLE GAMBIT — 3D chess in a moonlit conservatory, rendered with the projection3d library (Space, via
// GameSpace) + bloom. See DESIGN.md. chess.js is the referee, engine.js (in worker.js) the opponent; this file
// animates the pieces, handles picking, clocks, hints, undo, and the UI.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp } from "./mesh.js";
import { Chess, P, N, B, R, Q, K, sqName } from "./chess.js";
import { search, LEVELS } from "./engine.js";
import { drawPiece } from "./pieces.js";
import { buildScene, CANDLES, TRAY } from "./scene.js";

const Q_ = new URLSearchParams(location.search);
const GLYPH = { 1: "♙", 2: "♘", 3: "♗", 4: "♖", 5: "♕", 6: "♔", "-1": "♟", "-2": "♞", "-3": "♝", "-4": "♜", "-5": "♛", "-6": "♚" };
const VAL = [0, 1, 3, 3, 5, 9, 0];
const K_ = 1.9;

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

// ------------------------------------------------------------------ save
const save = (() => { try { return { stats: {}, volume: 0.8, music: 0.5, legal: true, coords: true, autoQ: false, mode: "cpu", side: "w", level: 2, time: "0", ...JSON.parse(localStorage.getItem("marblegambit.save")) }; } catch { return { stats: {}, volume: 0.8, music: 0.5, legal: true, coords: true, autoQ: false, mode: "cpu", side: "w", level: 2, time: "0" }; } })();
const persist = () => { try { localStorage.setItem("marblegambit.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume; audio.music = save.music;

// ------------------------------------------------------------------ static scene
const stat = new Mesh(120000);
let sS = 0, sSh = 0, sA = 0;
{ const S = new Mesh(110000), Sh = new Mesh(100), A = new Mesh(200); buildScene(S, Sh, A); stat.append(S); stat.append(Sh); stat.append(A); sS = S.n; sSh = Sh.n; sA = A.n; space.setStatic(stat.pos, stat.col, stat.n); }

// ------------------------------------------------------------------ engine (worker with a main-thread fallback)
let worker = null, jobId = 0;
const pending = new Map();
try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { const cb = pending.get(e.data.id); pending.delete(e.data.id); cb && cb(e.data.result); };
    worker.onerror = () => { worker = null; };
} catch { worker = null; }
function think(fen, opts) {
    return new Promise((res) => {
        if (worker) { const id = ++jobId; pending.set(id, res); worker.postMessage({ id, fen, opts }); }
        else setTimeout(() => res(search(fen, opts)), 30);
    });
}

// ------------------------------------------------------------------ state
let state = "loading";               // loading | title | play | promo | over | paused
let game = new Chess(Q_.get("fen") || undefined);
let mode = save.mode, human = 1, level = save.level, view = 1;
let clocks = null, inc = 0, sans = [], lastMove = null, selected = -1, legalFrom = [], hint = null, thinking = false, ended = null;
let pieces = [], captured = { 1: [], "-1": [] }, time = 0, hover = -1, pendingPromo = null;
const sqXY = (s) => [(s & 7) - 3.5, 3.5 - (s >> 3)];
const isHumanTurn = () => !ended && !Q_.has("autoplay") && (mode === "duo" || game.turn === human);

function syncPieces() {
    pieces = [];
    for (let s = 0; s < 64; s++) if (game.b[s]) { const [x, y] = sqXY(s); pieces.push({ p: game.b[s], sq: s, x, y, z: 0, anim: null }); }
    captured = { 1: [], "-1": [] };
    for (const u of game.stack) if (u.m.captured) captured[Math.sign(u.m.captured)].push(u.m.captured);
    captured[1].forEach((p, i) => pieces.push(trayPiece(p, i)));
    captured[-1].forEach((p, i) => pieces.push(trayPiece(p, i)));
}
function trayPiece(p, i) {
    const [tx, ty] = p > 0 ? TRAY.black : TRAY.white;                     // white losses sit on black's tray and vice versa
    return { p, sq: -1, x: tx + (i % 2 ? 0.38 : -0.38), y: ty - 2.8 + Math.floor(i / 2) * 0.8 * (p > 0 ? 1 : 1), z: -0.29, s: 0.72, anim: null, tray: true };
}

function newGame() {
    game = new Chess(Q_.get("fen") || undefined);
    mode = save.mode; level = save.level;
    human = mode === "duo" ? 1 : save.side === "b" ? -1 : save.side === "r" ? (Math.random() < 0.5 ? 1 : -1) : 1;
    view = mode === "duo" ? 1 : human;
    const tc = save.time === "0" ? null : save.time.split(",").map(Number);
    clocks = tc ? { 1: tc[0] * 1000, "-1": tc[0] * 1000 } : null; inc = tc ? tc[1] * 1000 : 0;
    sans = []; lastMove = null; selected = -1; legalFrom = []; hint = null; thinking = false; ended = null;
    syncPieces();
    state = "play"; ui.show("hud"); ui.all();
    maybeEngine();
}

// ------------------------------------------------------------------ moves
function playMove(m, fromEngine = false) {
    const san = game.san(m);
    // animate on the board
    const mover = pieces.find((p) => p.sq === m.from && !p.tray);
    const capSq = m.flag === "ep" ? m.to + 8 * game.turn : m.to;
    const victim = m.captured ? pieces.find((p) => p.sq === capSq && !p.tray) : null;
    game.make(m);
    sans.push(san); lastMove = { from: m.from, to: m.to }; selected = -1; legalFrom = []; hint = null;
    const [tx, ty] = sqXY(m.to);
    if (mover) { mover.anim = { fx: mover.x, fy: mover.y, tx, ty, t: 0, dur: 0.38, hop: Math.abs(m.piece) === N ? 0.9 : 0.35 }; mover.sq = m.to; if (m.promo) mover.promo = m.promo; }
    if (victim) {
        captured[Math.sign(victim.p)].push(victim.p);
        const tp = trayPiece(victim.p, captured[Math.sign(victim.p)].length - 1);
        victim.sq = -1; victim.tray = true;
        victim.anim = { fx: victim.x, fy: victim.y, tx: tp.x, ty: tp.y, t: -0.25, dur: 0.6, hop: 2.2, tz: tp.z, ts: tp.s };
    }
    if (m.flag === "K" || m.flag === "Q") {
        const rf = m.flag === "K" ? m.to + 1 : m.to - 2, rt = m.flag === "K" ? m.to - 1 : m.to + 1;
        const rook = pieces.find((p) => p.sq === rf && !p.tray);
        if (rook) { const [rx, ry] = sqXY(rt); rook.anim = { fx: rook.x, fy: rook.y, tx: rx, ty: ry, t: -0.12, dur: 0.38, hop: 0.5 }; rook.sq = rt; }
    }
    if (clocks) clocks[-game.turn] += inc;
    setTimeout(() => { if (m.flag === "K" || m.flag === "Q") audio.castle(); else if (m.captured) audio.capture(); else audio.move(); if (game.inCheck()) { audio.check(); ui.toast("Check", true); } }, 330);
    const st = game.status();
    if (st) finish(st);
    ui.all();
    if (!ended) maybeEngine();
}
function finish(reason, winner = null) {
    if (reason === "checkmate") winner = -game.turn;
    if (reason === "time" || reason === "resign") winner = winner;
    ended = { reason, winner };
    if (mode === "cpu" && !Q_.has("autoplay")) {
        const k = LEVELS[level].name, s = (save.stats[k] ||= { w: 0, l: 0, d: 0 });
        if (winner == null) s.d++; else if (winner === human) s.w++; else s.l++;
        persist();
    }
    setTimeout(() => { winner == null ? audio.draw() : (mode === "duo" || winner === human ? audio.win() : audio.lose()); ui.end(); }, 900);
}
async function maybeEngine() {
    if (ended || thinking) return;
    const engineTurn = Q_.has("autoplay") || (mode === "cpu" && game.turn !== human);
    if (!engineTurn) return;
    thinking = true; ui.status();
    const t0 = performance.now(), fen = game.fen(), lv = LEVELS[Q_.has("autoplay") ? 2 : level];
    const res = await think(fen, { depth: lv.depth, time: lv.time, random: lv.random, margin: lv.margin });
    const wait = Math.max(0, 450 - (performance.now() - t0));
    setTimeout(() => {
        thinking = false;
        if (ended || game.fen() !== fen || state === "title") { ui.status(); return; }
        const m = res && game.moves().find((x) => x.from === res.from && x.to === res.to && (x.promo || 0) === (res.promo || 0));
        if (m) playMove(m, true);
        ui.status();
    }, wait);
}
function tryMove(from, to) {
    const ms = game.moves().filter((m) => m.from === from && m.to === to);
    if (!ms.length) return false;
    if (ms.length > 1 && ms[0].promo) {
        if (save.autoQ) { playMove(ms.find((m) => Math.abs(m.promo) === Q)); return true; }
        pendingPromo = ms; state = "promo"; ui.promo(); return true;
    }
    playMove(ms[0]);
    return true;
}
function clickSquare(s) {
    if (state !== "play" || !isHumanTurn() || thinking) return;
    const p = game.b[s];
    if (selected >= 0 && s !== selected && legalFrom.some((m) => m.to === s)) { tryMove(selected, s); return; }
    if (p && Math.sign(p) === game.turn) { selected = s; legalFrom = game.moves().filter((m) => m.from === s); audio.select(); hint = null; return; }
    if (selected >= 0) { selected = -1; legalFrom = []; if (p || s >= 0) audio.illegal(); }
}

// ------------------------------------------------------------------ picking
function ray(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    return { o: [space.Xc, space.Yc, space.Zc], d: [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect) };
}
function pick(sx, sy) {
    const { o, d } = ray(sx, sy);
    const dl = Math.hypot(...d), u = d.map((v) => v / dl);
    // pieces first: closest approach between the ray and each piece's vertical axis
    let best = -1, bt = 1e9;
    for (const pc of pieces) {
        if (pc.tray || pc.sq < 0) continue;
        const h = Math.abs(pc.p) === K || Math.abs(pc.p) === Q ? 1.0 : Math.abs(pc.p) === P ? 0.6 : 0.8;
        for (let z = 0.1; z <= h; z += 0.15) {
            const w = [pc.x - o[0], pc.y - o[1], z - o[2]], t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
            const c = [o[0] + u[0] * t - pc.x, o[1] + u[1] * t - pc.y, o[2] + u[2] * t - z];
            if (Math.hypot(...c) < 0.3 && t < bt) { bt = t; best = pc.sq; }
        }
    }
    if (best >= 0) return best;
    if (d[2] >= 0) return -1;
    const t = -o[2] / d[2], x = o[0] + d[0] * t, y = o[1] + d[1] * t;
    const f = Math.floor(x + 4), r = Math.floor(4 - y);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
}
canvas.addEventListener("pointerdown", (e) => { audio.init(); if (state === "play") clickSquare(pick(e.clientX, e.clientY)); });
canvas.addEventListener("pointermove", (e) => { if (state !== "play") return; hover = pick(e.clientX, e.clientY); canvas.classList.toggle("point", hover >= 0 && isHumanTurn() && (legalFrom.some((m) => m.to === hover) || (game.b[hover] && Math.sign(game.b[hover]) === game.turn))); });
addEventListener("keydown", (e) => { if (e.code === "Escape") { if (ui.open && ui.open !== "m-promo") { ui.close(); if (state === "paused") state = "play"; } else if (state === "play") { state = "paused"; ui.modal("m-menu"); } } if (e.code === "KeyF" && state === "play") flip(); });

function flip() { view = -view; audio.select(); }
function undo() {
    if (thinking || !game.stack.length) return;
    const n = mode === "cpu" ? (game.turn === human ? 2 : 1) : 1;
    for (let i = 0; i < n && game.stack.length; i++) { game.undo(); sans.pop(); }
    ended = null; selected = -1; legalFrom = []; hint = null;
    const last = game.stack[game.stack.length - 1]; lastMove = last ? { from: last.m.from, to: last.m.to } : null;
    syncPieces(); ui.all(); audio.move();
}
async function giveHint() {
    if (!isHumanTurn() || thinking) return;
    ui.toast("Thinking about it…");
    const res = await think(game.fen(), { depth: 3, time: 900, random: 0, margin: 0 });
    if (res && isHumanTurn()) { hint = { from: res.from, to: res.to, t: 0 }; ui.toast(`Try ${game.san(game.moves().find((m) => m.from === res.from && m.to === res.to && (m.promo || 0) === (res.promo || 0)))}`); }
}

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt;
    for (const pc of pieces) {
        const a = pc.anim; if (!a) continue;
        a.t += dt / a.dur;
        const u = clamp(a.t, 0, 1), e = u * u * (3 - 2 * u);
        pc.x = lerp(a.fx, a.tx, e); pc.y = lerp(a.fy, a.ty, e); pc.z = Math.sin(u * Math.PI) * a.hop + (a.tz != null ? lerp(0, a.tz, e) : 0);
        if (a.ts) pc.s = lerp(1, a.ts, e);
        if (a.t >= 1) { pc.anim = null; if (pc.promo) { pc.p = pc.promo; pc.promo = 0; } }
    }
    if (hint) hint.t += dt;
    if (state === "play" && clocks && !ended && (game.stack.length > 0 || game.turn !== 1)) {
        clocks[game.turn] -= dt * 1000;
        if (clocks[game.turn] <= 0) { clocks[game.turn] = 0; finish("time", -game.turn); }
        ui.clocks();
    }
}

// ------------------------------------------------------------------ camera
function updateCamera(dt) {
    space.magnifier = K_ * 1.6;
    const aspect = canvas.width / canvas.height, portrait = aspect < 0.9;
    let yaw = view > 0 ? 0 : Math.PI, pitch = portrait ? 1.18 : 0.98;
    const fit = Math.max(K_ * 9.5 * 0.5 * 1.05, K_ * aspect * 9.5 * 0.5 * (portrait ? 0.9 : 1.15) * Math.sin(pitch));
    let dist = fit * (portrait ? 1.08 : 1.14), tx = 0, ty = portrait ? -0.6 : 0, tz = 0;
    if (!portrait && state !== "title") tx = view * -1 * (innerWidth > 1100 ? 1.6 : 1.1) * 0;
    if (state === "title" || state === "loading") { yaw = time * 0.08; pitch = 0.62; dist = fit * 1.25; }
    cam.yaw += (Math.atan2(Math.sin(yaw - cam.yaw), Math.cos(yaw - cam.yaw))) * Math.min(1, dt * 4);
    cam.pitch += (pitch - cam.pitch) * Math.min(1, dt * 4); cam.dist += (dist - cam.dist) * Math.min(1, dt * 4);
    // shift the board left of the side panel on wide screens
    const shift = !portrait && state !== "title" && innerWidth > 860 ? 1.5 : 0;
    const right = [Math.cos(cam.yaw), Math.sin(cam.yaw)];
    const cx = tx + right[0] * shift, cy = ty + right[1] * shift;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    space.lookAt(cx + Math.sin(cam.yaw) * cam.dist * cp, cy - Math.cos(cam.yaw) * cam.dist * cp, tz + cam.dist * sp, cx, cy, tz);
}
const cam = { yaw: 0, pitch: 0.62, dist: 20 };
function project(x, y, z) {
    const v = [x - space.Xc, y - space.Yc, z - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
    return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(20000), dynSh = new Mesh(3000), dynA = new Mesh(10000), pm = new Mesh(140000);
const pmPos = gl.createBuffer(), pmCol = gl.createBuffer();
let pmKey = "", pmN = 0;
function buildPieces() {
    const key = pieces.map((p) => `${p.p},${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)},${(p.s || 1).toFixed(2)}`).join("|");
    if (key === pmKey) return;
    pmKey = key; pm.reset();
    for (const pc of pieces) drawPiece(pm, pc.p, pc.x, pc.y, pc.z, Math.abs(pc.p) === N ? (pc.p > 0 ? Math.PI / 2 : -Math.PI / 2) : pc.p > 0 ? 0.3 : -0.3, pc.s || 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, pmPos); gl.bufferData(gl.ARRAY_BUFFER, pm.pos.subarray(0, pm.n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pmCol); gl.bufferData(gl.ARRAY_BUFFER, pm.col.subarray(0, pm.n * 4), gl.DYNAMIC_DRAW);
    pmN = pm.n;
}
const lightBuf = new Float32Array(24), lightColBuf = new Float32Array(18);
function sqQuad(A, s, col, inset = 0.03, z = 0.004) {
    const [x, y] = sqXY(s), h = 0.5 - inset;
    A.quad([x - h, y - h, z], [x + h, y - h, z], [x + h, y + h, z], [x - h, y + h, z], col, MAT.ADD);
}
function disc(A, x, y, r, col, ring = 0) {
    for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * 6.283, a1 = ((i + 1) / 24) * 6.283;
        if (ring) A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.006], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.006], [x + Math.cos(a1) * (r - ring), y + Math.sin(a1) * (r - ring), 0.006], [x + Math.cos(a0) * (r - ring), y + Math.sin(a0) * (r - ring), 0.006], col, MAT.ADD);
        else A.tri([x, y, 0.006], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.006], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.006], col, MAT.ADD);
    }
}
function buildDynamic() {
    const S = dyn, Sh = dynSh, A = dynA;
    S.reset(); Sh.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    if (lastMove) { sqQuad(A, lastMove.from, [0.2, 0.14, 0.04]); sqQuad(A, lastMove.to, [0.26, 0.18, 0.05]); }
    if (game.inCheck() && !(ended && ended.reason === "checkmate" && false)) { const k = game.king(game.turn), pul = 0.6 + 0.4 * Math.sin(time * 6); sqQuad(A, k, [0.7 * pul, 0.1 * pul, 0.08 * pul], 0.0); }
    if (selected >= 0) sqQuad(A, selected, [0.45, 0.35, 0.1], 0.0);
    if (hover >= 0 && state === "play" && isHumanTurn() && hover !== selected) sqQuad(A, hover, [0.06, 0.06, 0.05], 0.0);
    if (save.legal) for (const m of legalFrom) { const [x, y] = sqXY(m.to); m.captured ? disc(A, x, y, 0.46, [0.5, 0.38, 0.12], 0.07) : disc(A, x, y, 0.13, [0.35, 0.28, 0.1]); }
    if (hint) {
        const [fx, fy] = sqXY(hint.from), [tx, ty] = sqXY(hint.to), k = 0.6 + 0.4 * Math.sin(time * 5);
        const dx = tx - fx, dy = ty - fy, l = Math.hypot(dx, dy), nx = -dy / l * 0.09, ny = dx / l * 0.09, ex = tx - dx / l * 0.35, ey = ty - dy / l * 0.35;
        const c = [0.15 * k, 0.55 * k, 0.45 * k];
        A.quad([fx + nx, fy + ny, 0.01], [ex + nx, ey + ny, 0.01], [ex - nx, ey - ny, 0.01], [fx - nx, fy - ny, 0.01], c, MAT.ADD);
        A.tri([ex + nx * 2.6, ey + ny * 2.6, 0.01], [tx, ty, 0.01], [ex - nx * 2.6, ey - ny * 2.6, 0.01], c, MAT.ADD);
    }
    for (const pc of pieces) {
        if (!pc.tray) {
            const r = 0.42 * (pc.s || 1) * (1 + pc.z * 0.4), k = 0.5 / (1 + pc.z);
            const sx = pc.x + 0.06, sy = pc.y + 0.08;
            Sh.v(sx - r, sy - r, 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy - r, 0.003, 2, k, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy + r, 0.003, 3, k, 0, 0, MAT.SHADOW);
            Sh.v(sx - r, sy - r, 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(sx + r, sy + r, 0.003, 3, k, 0, 0, MAT.SHADOW); Sh.v(sx - r, sy + r, 0.003, 1, k, 0, 0, MAT.SHADOW);
        }
    }
    const sN = S.n, shN = Sh.n;
    S.append(Sh); S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, shN, aN: A.n };
}
function render(dt) {
    updateCamera(dt);
    const { sN, shN, aN } = buildDynamic();
    buildPieces();
    const lights = CANDLES.map(([x, y, h]) => ({ p: [x, y, h - 0.1], s: 2.4 + Math.sin(time * 9 + x) * 0.15, c: [1, 0.62, 0.3] }));
    lights.forEach((l, i) => { lightBuf.set([...l.p, l.s], i * 4); lightColBuf.set(l.c, i * 3); });
    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, canvas.width / canvas.height);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, lights.length);
    space.applyCamera();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, sS);
    space.bind(true); space.draw(6, sN - 6);
    if (pmN) { gl.bindBuffer(gl.ARRAY_BUFFER, pmPos); gl.vertexAttribPointer(space.posId, 4, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, pmCol); gl.vertexAttribPointer(space.colId, 4, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, pmN); }
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    space.bind(false); space.draw(sS, sSh);
    space.bind(true); space.draw(sN, shN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(false); space.draw(sS + sSh, sA);
    space.bind(true); space.draw(sN + shN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: 0 });
    ui.coords();
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const MODALS = ["m-promo", "m-end", "m-menu", "m-set"];
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ui = {
    open: null, back: null,
    show(w) { $("title").classList.toggle("hidden", w !== "title"); $("hud").classList.toggle("hidden", w !== "hud"); $("coords").classList.toggle("hidden", w !== "hud" || !save.coords); },
    modal(id, back = null) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); this.open = id; this.back = back; },
    close() { const b = this.back; for (const m of MODALS) $(m).classList.add("hidden"); this.open = null; this.back = null; if (b) b(); },
    all() { this.plates(); this.moves(); this.status(); this.clocks(); },
    plates() {
        const bottom = view, top = -view;
        const name = (side) => mode === "duo" ? (side > 0 ? "White" : "Black") : side === human ? "You" : `Engine · ${LEVELS[level].name}`;
        for (const [k, side] of [["top", top], ["bot", bottom]]) {
            $(`n-${k}`).textContent = name(side);
            $(`d-${k}`).className = `dot ${side > 0 ? "w" : "b"}`; $(`d-${k}`).textContent = side > 0 ? "♔" : "♚";
            $(`pl-${k}`).classList.toggle("on", game.turn === side && !ended);
            const caps = captured[-side].slice().sort((a, b) => Math.abs(b) - Math.abs(a));
            const mat = captured[-side].reduce((a, p) => a + VAL[Math.abs(p)], 0) - captured[side].reduce((a, p) => a + VAL[Math.abs(p)], 0);
            $(`cap-${k}`).innerHTML = caps.map((p) => GLYPH[p]).join("") + (mat > 0 ? `<em>+${mat}</em>` : "");
        }
    },
    moves() {
        const box = $("movelist");
        if (!sans.length) { box.innerHTML = `<div class="empty">${mode === "cpu" && human < 0 ? "The engine opens…" : "White to move. Pick a piece."}</div>`; return; }
        let h = "";
        for (let i = 0; i < sans.length; i += 2) h += `<span class="n">${i / 2 + 1}.</span><span class="m ${i === sans.length - 1 ? "last" : ""}">${sans[i]}</span><span class="m ${i + 1 === sans.length - 1 ? "last" : ""}">${sans[i + 1] || ""}</span>`;
        box.innerHTML = h; box.scrollTop = box.scrollHeight;
    },
    status() {
        $("status").innerHTML = ended ? "" : thinking ? `<span class="spin"></span>The engine is thinking…` : game.inCheck() ? "Check!" : isHumanTurn() ? (mode === "duo" ? `${game.turn > 0 ? "White" : "Black"} to move` : "Your move") : "";
        $("a-undo").disabled = thinking || !game.stack.length; $("a-hint").disabled = thinking || !isHumanTurn();
        $("a-resign").innerHTML = $("a-resign").innerHTML.replace(/Resign|New/, ended ? "New" : "Resign");
        this.plates();
    },
    clocks() {
        for (const [k, side] of [["top", -view], ["bot", view]]) {
            const el = $(`c-${k}`);
            el.textContent = clocks ? fmt(clocks[side]) : "–";
            el.classList.toggle("low", !!clocks && clocks[side] < 20000);
        }
    },
    coords() {
        const box = $("coords");
        if (box.classList.contains("hidden")) return;
        if (!box.children.length) box.innerHTML = Array.from({ length: 16 }, () => "<span></span>").join("");
        const sp = box.children;
        for (let i = 0; i < 8; i++) {
            const f = view > 0 ? i : 7 - i, edgeY = view > 0 ? -4.45 : 4.45, edgeX = view > 0 ? -4.45 : 4.45;
            let p = project(f - 3.5, edgeY, 0.05); sp[i].textContent = "abcdefgh"[f]; sp[i].style.left = p[0] + "px"; sp[i].style.top = p[1] + "px";
            p = project(edgeX, 3.5 - i, 0.05); sp[8 + i].textContent = 8 - i; sp[8 + i].style.left = p[0] + "px"; sp[8 + i].style.top = p[1] + "px";
        }
    },
    toast(t, check) { const el = $("toast"); el.textContent = t; el.classList.toggle("check", !!check); el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1800); },
    promo() {
        const side = game.turn;
        $("promo").innerHTML = [Q, R, B, N].map((t) => `<button data-t="${t}">${GLYPH[t * side]}</button>`).join("");
        $("promo").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const m = pendingPromo.find((x) => Math.abs(x.promo) === +b.dataset.t); pendingPromo = null; state = "play"; this.close(); playMove(m); }));
        this.modal("m-promo");
    },
    end() {
        const { reason, winner } = ended;
        const R2 = { checkmate: "Checkmate", stalemate: "Stalemate", fifty: "Fifty-move rule", repetition: "Threefold repetition", material: "Insufficient material", time: "Flag fell", resign: "Resignation" };
        $("e-k").textContent = R2[reason];
        $("e-t").textContent = winner == null ? "A draw" : mode === "duo" ? `${winner > 0 ? "White" : "Black"} wins` : winner === human ? "You win" : "The engine wins";
        const s = mode === "cpu" ? save.stats[LEVELS[level].name] : null;
        $("e-p").textContent = `${Math.ceil(sans.length / 2)} moves.` + (s ? ` Record vs ${LEVELS[level].name}: ${s.w}–${s.l}–${s.d}` : "");
        state = "over"; this.modal("m-end"); this.status();
    },
    title() {
        $("o-lvl").innerHTML = LEVELS.map((l, i) => `<button data-v="${i}" class="${i === save.level ? "on" : ""}"><b>${i + 1}</b>${l.name}</button>`).join("");
        $("o-lvl").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { save.level = +b.dataset.v; persist(); this.title(); audio.init(); audio.select(); }));
        for (const [id, key] of [["o-mode", "mode"], ["o-side", "side"], ["o-time", "time"]]) document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(save[key])));
        $("row-side").classList.toggle("hidden", save.mode === "duo"); $("row-lvl").classList.toggle("hidden", save.mode === "duo");
        const tot = Object.values(save.stats).reduce((a, s) => ({ w: a.w + s.w, l: a.l + s.l, d: a.d + s.d }), { w: 0, l: 0, d: 0 });
        $("t-stats").innerHTML = tot.w + tot.l + tot.d ? `Your record against the engine: <b>${tot.w}</b> wins · <b>${tot.l}</b> losses · <b>${tot.d}</b> draws` : "Five strengths, from gentle Novice to ruthless Master";
    },
};
for (const [id, key] of [["o-mode", "mode"], ["o-side", "side"], ["o-time", "time"]]) document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener("click", () => { save[key] = b.dataset.v; persist(); ui.title(); audio.init(); audio.select(); }));
$("t-play").addEventListener("click", () => { audio.init(); newGame(); });
$("t-set").addEventListener("click", () => { setUI(); ui.modal("m-set"); });
$("b-menu").addEventListener("click", () => { if (state === "play") { state = "paused"; ui.modal("m-menu"); } });
$("a-undo").addEventListener("click", undo);
$("a-hint").addEventListener("click", giveHint);
$("a-flip").addEventListener("click", () => { flip(); ui.all(); });
$("a-resign").addEventListener("click", () => { if (ended) { newGame(); return; } if (mode === "duo") finish("resign", -game.turn); else finish("resign", -human); });
$("mm-resume").addEventListener("click", () => { state = "play"; ui.close(); });
$("mm-new").addEventListener("click", () => { ui.close(); newGame(); });
$("mm-set").addEventListener("click", () => { setUI(); ui.modal("m-set", () => ui.modal("m-menu")); });
$("mm-title").addEventListener("click", () => { ui.close(); state = "title"; game = new Chess(); syncPieces(); ended = null; ui.show("title"); ui.title(); });
$("e-again").addEventListener("click", () => { ui.close(); newGame(); });
$("e-menu").addEventListener("click", () => { ui.close(); state = "title"; ui.show("title"); ui.title(); });
$("e-review").addEventListener("click", () => { ui.close(); state = "play"; });
$("ms-x").addEventListener("click", () => ui.close());
$("m-set").addEventListener("pointerdown", (e) => { if (e.target === $("m-set")) ui.close(); });
function setUI() {
    for (const [id, v] of [["s-vol", save.volume], ["s-mus", save.music]]) { $(id).value = Math.round(v * 100); $(id).style.setProperty("--v", `${v * 100}%`); }
    $("s-legal").setAttribute("aria-checked", save.legal); $("s-coords").setAttribute("aria-checked", save.coords); $("s-auto").setAttribute("aria-checked", save.autoQ);
}
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; persist(); audio.init(); audio.setVolume(save.volume); e.target.style.setProperty("--v", `${save.volume * 100}%`); });
$("s-mus").addEventListener("input", (e) => { save.music = e.target.value / 100; persist(); audio.init(); audio.setMusic(save.music); e.target.style.setProperty("--v", `${save.music * 100}%`); });
for (const [id, key] of [["s-legal", "legal"], ["s-coords", "coords"], ["s-auto", "autoQ"]]) $(id).addEventListener("click", (e) => { save[key] = !save[key]; persist(); e.currentTarget.setAttribute("aria-checked", save[key]); if (key === "coords") $("coords").classList.toggle("hidden", !save.coords || state === "title"); });

// ------------------------------------------------------------------ boot
window.__chess = () => ({ state, fen: game.fen(), moves: sans.length, last: sans[sans.length - 1], thinking, ended, worker: !!worker, fps: fpsNow, post: post.ok });
let last = performance.now(), fpsNow = 0, fN = 0, fT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fN++; fT += (now - last) / 1000; if (fT > 1) { fpsNow = Math.round(fN / fT); fN = 0; fT = 0; }
    last = now;
    if (state !== "paused") update(dt);
    render(dt);
    requestAnimationFrame(frame);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);
syncPieces();
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.title();
    if (Q_.has("autoplay") || Q_.has("play")) newGame();
}, 400);
