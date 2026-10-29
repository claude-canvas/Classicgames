// GEMFALL — a 3D match-3 rendered with the projection3d library (Space, via GameSpace) + bloom. See DESIGN.md.
// board.js resolves every move instantly into a list of steps; this file replays those steps as animation,
// renders the board and drives the UI (journey map, level card, HUD, results).

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, mulberry32, clamp, lerp } from "./mesh.js";
import { Board } from "./board.js";
import { LEVELS, COLOR_NAMES } from "./levels.js";
import { GEM_TRIS, PRISM_TRIS, GEM_COLORS, stampGem } from "./gems.js";

const Q = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(8, +Q.get("speed") || 1));
const CS = 1.1, GZ = 0.38, K = 2.0;
const CALL = ["", "", "Sweet", "Brilliant", "Dazzling", "Legendary", "Legendary"];

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
const save = (() => { try { return { stars: {}, best: {}, hints: true, volume: 0.8, ...JSON.parse(localStorage.getItem("gemfall.save")) }; } catch { return { stars: {}, best: {}, hints: true, volume: 0.8 }; } })();
const persist = () => { try { localStorage.setItem("gemfall.save", JSON.stringify(save)); } catch { } };
const unlocked = () => Math.min(LEVELS.length, 1 + Object.keys(save.stars).filter((k) => save.stars[k] > 0).reduce((m, k) => Math.max(m, +k), 0));
const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);
audio.volume = save.volume;

// ------------------------------------------------------------------ state
let state = "loading";        // loading | title | journey | play | paused | result
let L = LEVELS[0], board = null, rng = mulberry32(1);
let shown = 0, moves = 0, hammers = 2, shuffles = 1, hammerMode = false, rush = false, ended = false;
let queue = [], cur = null, curT = 0, idle = 0, hint = null, selected = null, time = 0;
const vis = new Map();                     // gem id → visual state
let particles = [], fx = [], lightsFx = [];
const stat = new Mesh(40000);
let statN = 0;

const cellXY = (r, c) => [(c - (board.cols - 1) / 2) * CS, ((board.rows - 1) / 2 - r) * CS];

function startLevel(n) {
    L = LEVELS[n - 1];
    rng = mulberry32(Q.has("seed") ? +Q.get("seed") : (Math.random() * 1e9) | 0);
    board = new Board(L, rng);
    shown = 0; moves = L.moves; hammers = 2; shuffles = 1; hammerMode = false; rush = false; ended = false;
    queue = []; cur = null; idle = 0; hint = null; selected = null; particles = []; fx = [];
    vis.clear();
    board.each((r, c) => {
        const g = board.cells[r][c], [x, y] = cellXY(r, c);
        vis.set(g.id, { gem: g, x, y: y + 9 + r * 0.6 + Math.random() * 0.4, fx: x, fy: y + 9 + r * 0.6, tx: x, ty: y, t: 0, dur: 0.55 + (board.rows - r) * 0.05, delay: c * 0.035, s: 1, spin: Math.random() * 6.28, pop: 0 });
    });
    buildStatic(); fitCamera();
    state = "play"; ui.show("hud"); ui.hud(true);
    audio.init();
}

// ------------------------------------------------------------------ static board
function buildStatic() {
    const S = new Mesh(40000), Sh = new Mesh(4000);
    const h = CS / 2;
    // the table and a lacquered tray beneath the board
    S.quad([-40, -30, -0.6], [40, -30, -0.6], [40, 40, -0.6], [-40, 40, -0.6], [0.09, 0.05, 0.07], MAT.MATTE);
    const bw = board.cols * CS / 2 + 0.55, bh = board.rows * CS / 2 + 0.55;
    const tray = (w, hh, z0, z1, col, mat) => {
        S.quad([-w, -hh, z1], [w, -hh, z1], [w, hh, z1], [-w, hh, z1], col, mat);
        for (const [ax, ay, bx, by] of [[-w, -hh, w, -hh], [w, -hh, w, hh], [w, hh, -w, hh], [-w, hh, -w, -hh]]) S.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], col.map((v) => v * 0.7), mat);
    };
    tray(bw + 0.35, bh + 0.35, -0.6, -0.08, [0.95, 0.7, 0.36], MAT.GLOSS);
    tray(bw + 0.18, bh + 0.18, -0.08, -0.05, [0.17, 0.05, 0.1], MAT.GLOSS);
    // velvet cells with a gold seam where the board's edge is
    board.each((r, c) => {
        const [x, y] = cellXY(r, c), alt = (r + c) % 2;
        const col = alt ? [0.2, 0.09, 0.22] : [0.25, 0.11, 0.27];
        S.quad([x - h + 0.02, y - h + 0.02, 0], [x + h - 0.02, y - h + 0.02, 0], [x + h - 0.02, y + h - 0.02, 0], [x - h + 0.02, y + h - 0.02, 0], col, MAT.MATTE);
        for (const [dr, dc, ax, ay, bx, by] of [[-1, 0, -h, h, h, h], [1, 0, -h, -h, h, -h], [0, -1, -h, -h, -h, h], [0, 1, h, -h, h, h]]) {
            if (board.ok(r + dr, c + dc)) continue;
            const nx = ax === bx ? Math.sign(ax) * 0.12 : 0, ny = ay === by ? Math.sign(ay) * 0.12 : 0;
            S.quad([x + ax, y + ay, 0.04], [x + bx, y + by, 0.04], [x + bx + nx, y + by + ny, 0.04], [x + ax + nx, y + ay + ny, 0.04], [0.95, 0.72, 0.38], MAT.GLOSS);
        }
    });
    // non-cells inside the tray: dark lacquer
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) if (!board.mask[r][c]) {
        const [x, y] = cellXY(r, c);
        S.quad([x - h, y - h, -0.02], [x + h, y - h, -0.02], [x + h, y + h, -0.02], [x - h, y + h, -0.02], [0.12, 0.04, 0.08], MAT.GLOSS);
    }
    // jeweller's tools on the table: a loupe and tweezers
    const lx = bw + 2.2, ly = -bh + 0.8;
    for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * 6.283, a1 = ((i + 1) / 24) * 6.283, R = 0.8, w = 0.12;
        S.quad([lx + Math.cos(a0) * R, ly + Math.sin(a0) * R, -0.45], [lx + Math.cos(a1) * R, ly + Math.sin(a1) * R, -0.45], [lx + Math.cos(a1) * (R + w), ly + Math.sin(a1) * (R + w), -0.45], [lx + Math.cos(a0) * (R + w), ly + Math.sin(a0) * (R + w), -0.45], [0.9, 0.68, 0.35], MAT.GLOSS);
        S.tri([lx, ly, -0.46], [lx + Math.cos(a0) * R, ly + Math.sin(a0) * R, -0.46], [lx + Math.cos(a1) * R, ly + Math.sin(a1) * R, -0.46], [0.3, 0.35, 0.45], MAT.GLOSS);
    }
    S.quad([lx + 0.6, ly - 0.6, -0.47], [lx + 2.4, ly - 2.0, -0.47], [lx + 2.55, ly - 1.85, -0.47], [lx + 0.75, ly - 0.45, -0.47], [0.25, 0.12, 0.08], MAT.GLOSS);
    // a velvet pouch of spare gems on the other side
    const px = -bw - 2.4, py = bh - 2;
    for (let k = 0; k < 7; k++) { const a = k * 2.4, d = 0.3 + (k % 3) * 0.35; stampGem(S, GEM_TRIS[k % 6], px + Math.cos(a) * d, py + Math.sin(a) * d, -0.35, 0.7, a, 0.9, GEM_COLORS[k % 6]); }
    stat.reset(); stat.append(S); statN = S.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ camera
const cam = { dist: 20, ty: 0 };
function fitCamera() {
    if (!board) return;
    const aspect = canvas.width / canvas.height, w = board.cols * CS + 1.6, h = board.rows * CS + 1.6;
    const topPx = innerWidth < 600 ? 104 : 118, botPx = 86, usable = 1 - (topPx + botPx) / innerHeight;
    const dW = K * w * 0.5 * 1.04, dH = K * aspect * h * 0.5 / usable;
    cam.dist = Math.max(dW, dH);
    cam.ty = -((topPx - botPx) / innerHeight) * (cam.dist / (K * aspect)) * 1.0;
}
function updateCamera() {
    space.magnifier = K * 1.6;
    const pitch = 1.3, ty = cam.ty;
    space.lookAt(0, ty - cam.dist * Math.cos(pitch), cam.dist * Math.sin(pitch), 0, ty, 0);
}
function project(x, y, z) {
    const v = [x - space.Xc, y - space.Yc, z - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
    return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}
function cellAt(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect);
    const t = (GZ - space.Zc) / d[2];
    const x = space.Xc + d[0] * t, y = space.Yc + d[1] * t;
    const c = Math.round(x / CS + (board.cols - 1) / 2), r = Math.round((board.rows - 1) / 2 - y / CS);
    return board.ok(r, c) ? [r, c] : null;
}

// ------------------------------------------------------------------ input
let press = null;
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    if (state !== "play" || busy()) return;
    const c = cellAt(e.clientX, e.clientY);
    press = c ? { cell: c, x: e.clientX, y: e.clientY, done: false } : null;
    if (c && hammerMode) { useHammer(c); press = null; }
});
canvas.addEventListener("pointermove", (e) => {
    if (!press || press.done || busy()) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (Math.hypot(dx, dy) < 22) return;
    press.done = true;
    const [r, c] = press.cell, to = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
    selected = null;
    if (board.ok(...to)) swap(press.cell, to);
});
canvas.addEventListener("pointerup", () => {
    if (press && !press.done) {
        const c = press.cell;
        if (selected && board.adjacent(selected, c)) { const s = selected; selected = null; swap(s, c); }
        else if (selected && selected[0] === c[0] && selected[1] === c[1]) selected = null;
        else { selected = c; audio.click(); }
    }
    press = null;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function busy() { return !!cur || queue.length > 0 || rush || ended; }
function swap(a, b) {
    if (busy() || moves <= 0) return;
    hint = null; idle = 0;
    const res = board.trySwap(a, b);
    if (res.ok) moves--;
    queue.push(...res.steps);
    audio.swap();
    ui.hud();
}
function useHammer(c) {
    if (hammers <= 0 || busy()) return;
    hammers--; hammerMode = false;
    const steps = board.hammer(...c);
    if (steps) queue.push(...steps);
    audio.hammer(); ui.hud();
}

// ------------------------------------------------------------------ step playback
function setTarget(g, r, c, dur, delay = 0, fromRow = null) {
    const [x, y] = cellXY(r, c);
    let v = vis.get(g.id);
    if (!v) { const [sx, sy] = fromRow != null ? cellXY(fromRow, c) : [x, y]; v = { x: sx, y: sy, s: 1, spin: Math.random() * 6.28, pop: 0 }; vis.set(g.id, v); }
    v.gem = g;
    v.fx = v.x; v.fy = v.y; v.tx = x; v.ty = y; v.t = 0; v.dur = dur; v.delay = delay;
}
function begin(step) {
    cur = step; curT = 0;
    if (step.type === "swap" || step.type === "swapBack") {
        const ga = board.gem(...step.a), gb = board.gem(...step.b);
        // after board.trySwap the logical cells are already final, so point each gem at its current cell
        if (step.type === "swap") {
            if (queue[0]?.type === "swapBack") { if (ga) setTarget(ga, ...step.b, 0.17); if (gb) setTarget(gb, ...step.a, 0.17); }
            else for (const [g, rc] of gemIdAtAfter(step)) setTarget(g, ...rc, 0.17);
        }
        else { if (ga) setTarget(ga, ...step.a, 0.17); if (gb) setTarget(gb, ...step.b, 0.17); audio.bad(); }
        step.dur = 0.18;
    } else if (step.type === "clear") {
        const bigFx = step.fx.filter((f) => f.kind !== "hammer");
        for (const e of step.removed) {
            const v = vis.get(e.gem.id);
            if (v) { v.pop = 0.001; v.popColor = e.gem.color; }
            const [x, y] = cellXY(e.r, e.c);
            const col = e.gem.color >= 0 ? GEM_COLORS[e.gem.color] : [1, 1, 1];
            burst(x, y, GZ, 7, col, 3.2, 0.55, 0.09);
        }
        for (const f of step.frost) { const [x, y] = cellXY(f.r, f.c); burst(x, y, 0.1, 10, [0.7, 0.9, 1.2], 2.5, 0.7, 0.07); }
        for (const f of bigFx) { fx.push({ ...f, t: 0, life: f.kind === "nova" ? 1 : 0.45 }); if (f.kind === "row" || f.kind === "col") audio.line(); else if (f.kind === "bomb") audio.bomb(); else if (f.kind === "prism" || f.kind === "nova") audio.prism(); }
        for (const cr of step.created || []) {
            if (cr.old) { const ov = vis.get(cr.old.id); if (ov) { ov.pop = 0.001; } }
            const [x, y] = cellXY(cr.r, cr.c);
            vis.set(cr.gem.id, { gem: cr.gem, x, y, fx: x, fy: y, tx: x, ty: y, t: 1, dur: 0.1, s: 0, grow: 0.001, spin: 0, pop: 0 });
            burst(x, y, GZ, 18, [1.6, 1.4, 1.1], 3, 0.8, 0.07);
            audio.create();
        }
        if (step.removed.length) {
            shown += step.gained;
            audio.clear(step.chain, step.removed.length);
            const mid = step.removed[Math.floor(step.removed.length / 2)];
            floater(`+${step.gained}`, project(...cellXY(mid.r, mid.c), GZ + 0.5));
            ui.hud();
            if (step.chain >= 2 && !rush) ui.callout(CALL[Math.min(step.chain, 6)]);
            if ((step.created || []).some((c) => c.gem.special === "prism") && !rush) ui.callout("Prism!");
        }
        step.dur = bigFx.length ? 0.4 : 0.26;
    } else if (step.type === "fall") {
        let maxD = 0;
        for (const m of step.moves) { setTarget(m.gem, ...m.to, 0, 0); const d = m.to[0] - m.from[0]; maxD = Math.max(maxD, d); vis.get(m.gem.id).dist = d; }
        for (const s of step.spawned) { setTarget(s.gem, ...s.to, 0, 0, s.from[0]); const d = s.to[0] - s.from[0]; maxD = Math.max(maxD, d); vis.get(s.gem.id).dist = d; }
        for (const m of [...step.moves, ...step.spawned]) { const v = vis.get(m.gem.id); v.dur = 0.14 + Math.sqrt(v.dist) * 0.1; }
        step.dur = 0.14 + Math.sqrt(maxD) * 0.1 + 0.04;
        setTimeout(() => audio.land(), step.dur * 1000 / SPEED);
    } else if (step.type === "shuffle") {
        for (const m of step.moves) setTarget(m.gem, ...m.to, 0.5, Math.random() * 0.15);
        step.dur = 0.7; ui.toast("No moves left — reshuffling");
    }
}
// the two gems of a swap step, paired with where they now are
function gemIdAtAfter(step) {
    const out = [];
    for (const rc of [step.a, step.b]) { const g = board.gem(...rc); if (g) out.push([g, rc]); }
    return out;
}
function finishStep() {
    if (cur.type === "clear") for (const e of cur.removed) vis.delete(e.gem.id);
    if (cur.type === "clear") for (const cr of cur.created || []) if (cr.old) vis.delete(cr.old.id);
    cur = null;
}

function afterIdle() {
    // called when all animation has finished
    if (ended) return;
    const met = goalsMet();
    if (rush) {
        if (moves > 0) {
            const cells = []; board.each((r, c) => { const g = board.cells[r][c]; if (g && !g.special) cells.push([r, c]); });
            if (cells.length) {
                const [r, c] = cells[Math.floor(Math.random() * cells.length)];
                board.cells[r][c].special = Math.random() < 0.5 ? "row" : "col";
                moves--; ui.hud();
                queue.push(...board.hammer(r, c));
                return;
            }
        }
        rush = false; return finish(true);
    }
    if (met) {
        if (moves > 0) { rush = true; ui.callout("Gem Rush!"); return; }
        return finish(true);
    }
    if (moves <= 0) return finish(false);
}
function goalsMet() {
    return L.goals.every((g) => (g.kind === "score" ? board.score >= g.target : g.kind === "collect" ? board.collected[g.color] >= g.target : board.frostLeft() === 0));
}
function finish(won) {
    ended = true;
    const stars = won ? (board.score >= L.stars[2] ? 3 : board.score >= L.stars[1] ? 2 : 1) : 0;
    if (won) {
        save.stars[L.n] = Math.max(save.stars[L.n] || 0, stars);
        save.best[L.n] = Math.max(save.best[L.n] || 0, board.score);
        persist();
    }
    setTimeout(() => { state = "result"; won ? audio.win() : audio.lose(); ui.result(won, stars); }, 700 / SPEED);
}

// ------------------------------------------------------------------ effects
function burst(x, y, z, n, col, sp, life, size) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, e = Math.random() * 1.2, s = sp * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(a) * Math.cos(e) * s, vz: Math.sin(e) * s + 1, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.8), c: col });
    }
}
const floaters = document.getElementById("floaters");
function floater(text, p) {
    if (!p || floaters.childElementCount > 30) return;
    const el = document.createElement("div"); el.className = "fl"; el.textContent = text;
    el.style.left = p[0] + "px"; el.style.top = p[1] + "px";
    floaters.appendChild(el); el.addEventListener("animationend", () => el.remove());
}

// ------------------------------------------------------------------ update
const ease = (t) => 1 - Math.pow(1 - t, 3);
const fallEase = (t) => { if (t < 0.82) return (t / 0.82) * (t / 0.82); const u = (t - 0.82) / 0.18; return 1 - Math.sin(u * Math.PI) * 0.06; };
function update(dt) {
    time += dt;
    for (const v of vis.values()) {
        if (v.delay > 0) { v.delay -= dt; continue; }
        if (v.t < 1) {
            v.t = Math.min(1, v.t + dt / (v.dur || 0.2));
            const e = v.dist ? fallEase(v.t) : ease(v.t);
            v.x = lerp(v.fx, v.tx, e); v.y = lerp(v.fy, v.ty, e);
            if (v.t >= 1) v.dist = 0;
        }
        if (v.pop > 0) v.pop += dt / 0.24;
        if (v.grow > 0) { v.grow += dt / 0.3; v.s = Math.min(1, v.grow < 0.7 ? v.grow / 0.7 * 1.25 : 1.25 - (v.grow - 0.7) / 0.3 * 0.25); if (v.grow >= 1) { v.grow = 0; v.s = 1; } }
    }
    if (state === "play" || state === "result") {
        if (cur) { curT += dt; if (curT >= cur.dur) finishStep(); }
        if (!cur && queue.length) begin(queue.shift());
        if (!cur && !queue.length && state === "play") { shown = board.score; afterIdle(); ui.hud(); }
        if (!busy() && state === "play") {
            idle += dt;
            if (save.hints && idle > 6 && !hint) { const m = board.allMoves(); hint = m[Math.floor(Math.random() * m.length)] || null; }
            if (Q.has("autoplay") && idle > 0.35 / SPEED) botMove();
        }
    }
    for (const p of particles) { p.vz -= 6 * dt; const k = Math.exp(-dt * 2); p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0.05, p.z + p.vz * dt); p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 700) particles.splice(0, particles.length - 700);
    for (const f of fx) f.t += dt;
    fx = fx.filter((f) => f.t < f.life);
}
function botMove() {
    let best = null, bv = -1;
    for (const [a, b] of board.allMoves()) {
        const cl = board.clone(); cl.rng = mulberry32(3);
        const s0 = cl.score, f0 = cl.frostLeft(); cl.trySwap(a, b);
        const v = cl.score - s0 + (f0 - cl.frostLeft()) * 150;
        if (v > bv) { bv = v; best = [a, b]; }
    }
    if (best) swap(...best);
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(90000), dynA = new Mesh(30000);
const lightBuf = new Float32Array(24), lightColBuf = new Float32Array(18);
function buildDynamic() {
    const S = dyn, A = dynA;
    S.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    const lights = [];
    if (board) {
        // frost
        const h = CS / 2 - 0.04;
        board.each((r, c) => {
            const f = board.frost[r][c];
            if (!f) return;
            const [x, y] = cellXY(r, c), col = f > 1 ? [0.55, 0.8, 1.1] : [0.35, 0.55, 0.8];
            for (let k = 0; k < f; k++) A.quad([x - h, y - h, 0.02 + k * 0.01, f], [x + h, y - h, 0.02 + k * 0.01, f], [x + h, y + h, 0.02 + k * 0.01, f], [x - h, y + h, 0.02 + k * 0.01, f], col, MAT.ICE);
        });
        // selection & hint rings
        const ringCell = (rc, col) => {
            const [x, y] = cellXY(...rc), o = CS / 2 - 0.05, w = 0.06;
            for (const [ax, ay, bx, by] of [[-o, -o, o, -o], [o, -o, o, o], [o, o, -o, o], [-o, o, -o, -o]]) {
                const nx = ax === bx ? -Math.sign(ax) * w : 0, ny = ay === by ? -Math.sign(ay) * w : 0;
                A.quad([x + ax, y + ay, 0.05], [x + bx, y + by, 0.05], [x + bx + nx, y + by + ny, 0.05], [x + ax + nx, y + ay + ny, 0.05], col, MAT.ADD);
            }
        };
        if (selected) ringCell(selected, [1.0, 0.7, 0.55]);
        const hp = hint ? 0.5 + 0.5 * Math.sin(time * 6) : 0;
        // gems
        const hintIds = hint ? hint.map((rc) => board.gem(...rc)?.id) : [], selId = selected ? board.gem(...selected)?.id : null;
        for (const v of vis.values()) if (v.gem && (v.pop === 0 || v.pop < 1)) drawGem(S, A, v.gem, v, hintIds.includes(v.gem.id) ? hp : 0, v.gem.id === selId);
        // effects
        for (const f of fx) {
            const u = f.t / f.life, k = 1 - u;
            const [x, y] = f.r != null ? cellXY(f.r, f.c) : [0, 0];
            const col = f.color >= 0 && f.color != null ? GEM_COLORS[f.color] : [1, 1, 1];
            if (f.kind === "row" || f.kind === "col") {
                const w = (f.wide ? 1.6 : 0.5) * (0.4 + k * 0.6), len = 12;
                const P = f.kind === "row" ? (a, b) => [x + a, y + b, GZ + 0.2] : (a, b) => [x + b, y + a, GZ + 0.2];
                A.quad(P(-len * Math.min(1, u * 4), -w / 2), P(len * Math.min(1, u * 4), -w / 2), P(len * Math.min(1, u * 4), w / 2), P(-len * Math.min(1, u * 4), w / 2), col.map((v) => v * 0.5 * k), MAT.ADD);
                A.quad(P(-len * Math.min(1, u * 4), -0.06), P(len * Math.min(1, u * 4), -0.06), P(len * Math.min(1, u * 4), 0.06), P(-len * Math.min(1, u * 4), 0.06), [1.4 * k, 1.4 * k, 1.4 * k], MAT.ADD);
                lights.push({ p: [x, y, 1.2], s: 3 * k, c: col });
            } else if (f.kind === "bomb" || f.kind === "hammer") {
                const rad = (f.kind === "hammer" ? 0.8 : CS * (1.6 + f.size)) * (0.3 + u);
                ring(A, x, y, rad, col.map((v) => v * k), 0.18);
                A.sprite(x, y, GZ + 0.3, rad * 0.8, col[0] * 0.5 * k, col[1] * 0.5 * k, col[2] * 0.5 * k);
                lights.push({ p: [x, y, 1.2], s: 5 * k, c: col });
            } else if (f.kind === "prism" || f.kind === "nova") {
                const rad = 2 + u * 10;
                for (let i = 0; i < 6; i++) ring(A, x, y, rad - i * 0.25, hsv(i / 6 + time).map((v) => v * k * 0.6), 0.12);
                A.sprite(x, y, GZ + 0.4, 2 * k + 0.5, k, k, k);
                lights.push({ p: [x, y, 1.5], s: 6 * k, c: [1, 0.9, 1] });
            }
        }
    }
    for (const p of particles) {
        const k = Math.min(1, (p.life / p.max) * 1.6);
        A.sprite(p.x, p.y, p.z, p.size * (0.5 + 0.5 * k), p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
    // twinkles on random gems
    if (board) for (let i = 0; i < 3; i++) {
        const s = Math.sin(time * 1.7 + i * 2.1);
        if (s > 0.92) { const r = Math.floor(((time * 0.3 + i * 0.37) % 1) * board.rows), c = Math.floor(((time * 0.21 + i * 0.61) % 1) * board.cols); if (board.ok(r, c)) { const [x, y] = cellXY(r, c); A.sprite(x + 0.15, y + 0.15, GZ + 0.35, 0.18 * (s - 0.92) * 12, 1.2, 1.2, 1.2); } }
    }
    const sN = S.n;
    S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, aN: A.n, lights };
}
function hsv(h) { h = ((h % 1) + 1) % 1; const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(Math.min(k, 4 - k, 1), 0); }; return [f(5) * 1.2, f(3) * 1.2, f(1) * 1.2]; }
function ring(A, x, y, r, c, w) {
    const n = 40;
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 6.283, a1 = ((i + 1) / n) * 6.283;
        A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, GZ], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, GZ], [x + Math.cos(a1) * (r - w), y + Math.sin(a1) * (r - w), GZ], [x + Math.cos(a0) * (r - w), y + Math.sin(a0) * (r - w), GZ], c, MAT.ADD);
    }
}
function drawGem(S, A, g, v, hl, sel) {
    if (!v) return;
    let s = v.s ?? 1, z = GZ;
    if (v.pop > 0) s *= v.pop < 0.35 ? 1 + v.pop : Math.max(0, 1.35 - (v.pop - 0.35) * 2.1);
    if (s <= 0.01) return;
    if (sel) { z += 0.25; s *= 1.12; }
    const wob = Math.sin(time * 1.3 + g.id) * 0.25;
    const spin = (v.spin || 0) + wob + (sel ? time * 2 : 0);
    const gs = 0.92 * s;
    if (g.special === "prism") {
        stampGem(S, PRISM_TRIS, v.x, v.y, z + 0.05, gs * 1.05, time * 1.5 + g.id, 0.5, [1, 1, 1], time * 0.3, 0.3 + hl);
        A.sprite(v.x, v.y, z + 0.2, 0.7 * s, 0.25, 0.22, 0.3);
        return;
    }
    const col = GEM_COLORS[g.color];
    stampGem(S, GEM_TRIS[g.color], v.x, v.y, z, gs, spin, 0.55, col, 0, hl * 0.8 + (sel ? 0.35 : 0));
    if (g.special === "row" || g.special === "col") {
        const k = 0.6 + 0.4 * Math.sin(time * 6 + g.id);
        for (const off of [-0.16, 0.16]) {
            const P = g.special === "row" ? (a, b) => [v.x + a, v.y + b + off, z + 0.32] : (a, b) => [v.x + b + off, v.y + a, z + 0.32];
            A.quad(P(-0.5 * s, -0.035), P(0.5 * s, -0.035), P(0.5 * s, 0.035), P(-0.5 * s, 0.035), [1.3 * k, 1.3 * k, 1.3 * k], MAT.ADD);
        }
        A.sprite(v.x, v.y, z + 0.3, 0.5 * s, col[0] * 0.25 * k, col[1] * 0.25 * k, col[2] * 0.25 * k);
    } else if (g.special === "bomb") {
        const k = 0.6 + 0.4 * Math.sin(time * 5 + g.id);
        A.sprite(v.x, v.y, z + 0.15, 0.55 * s, col[0] * 0.6 * k + 0.2, col[1] * 0.6 * k + 0.2, col[2] * 0.6 * k + 0.2);
        for (let i = 0; i < 6; i++) { const a = time * 2.5 + (i / 6) * 6.283; A.sprite(v.x + Math.cos(a) * 0.48 * s, v.y + Math.sin(a) * 0.48 * s, z + 0.1, 0.07, 1.2, 1.1, 0.9); }
    }
    if (hl > 0) A.sprite(v.x, v.y, z, 0.7, 0.3 * hl, 0.3 * hl, 0.35 * hl);
}

function render() {
    updateCamera();
    const { sN, aN, lights } = buildDynamic();
    const n = Math.min(6, lights.length);
    for (let i = 0; i < n; i++) { lightBuf.set([...lights[i].p, lights[i].s], i * 4); lightColBuf.set(lights[i].c, i * 3); }
    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, canvas.width / canvas.height);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, n);
    space.applyCamera();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    if (board) { space.bind(false); space.draw(0, statN); }
    space.bind(true); space.draw(6, sN - 6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    space.draw(sN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: 0 });
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const MODALS = ["m-level", "m-pause", "m-settings", "m-how", "m-result"];
const gemIcon = (c) => `<svg class="gemi"><use href="#g${c}"/></svg>`;
const ui = {
    open: null, back: null, last: {},
    show(w) { for (const id of ["title", "journey", "hud"]) $(id).classList.toggle("hidden", id !== w); },
    modal(id, back = null) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); this.open = id; this.back = back; },
    closeModal() { const b = this.back; for (const m of MODALS) $(m).classList.add("hidden"); this.open = null; this.back = null; if (b) b(); },
    goalHTML(g, live) {
        if (g.kind === "score") return { icon: `<span style="font-size:18px;color:var(--gold)">★</span>`, text: live ? `${Math.min(board.score, g.target).toLocaleString()}/${g.target.toLocaleString()}` : `Score ${g.target.toLocaleString()}`, done: live && board.score >= g.target, sub: "Reach the target score" };
        if (g.kind === "collect") { const have = live ? Math.min(board.collected[g.color], g.target) : 0; return { icon: gemIcon(g.color), text: live ? `${g.target - have}` : `Collect ${g.target} ${COLOR_NAMES[g.color]}`, done: live && have >= g.target, sub: "Match these jewels" }; }
        const left = live ? board.frostLeft() : 0;
        return { icon: `<span class="frosti"></span>`, text: live ? `${left}` : "Clear all frost", done: live && left === 0, sub: "Match on frosted cells to melt the ice" };
    },
    hud(force) {
        if (!board) return;
        $("h-moves").textContent = moves;
        $("moves").classList.toggle("low", moves <= 5 && moves > 0 && !rush);
        $("h-score").textContent = Math.min(shown, board.score).toLocaleString();
        $("h-level").textContent = `Level ${L.n}`;
        const key = L.goals.map((g) => { const h = this.goalHTML(g, true); return h.text + h.done; }).join("|");
        if (force || key !== this.last.goals) {
            const prev = this.last.goals; this.last.goals = key;
            $("goals").innerHTML = L.goals.map((g) => { const h = this.goalHTML(g, true); return `<span class="goal ${h.done ? "done" : ""} ${prev && !force ? "pop" : ""}">${h.icon}${h.done ? "✓" : h.text}</span>`; }).join("");
        }
        const max = L.stars[2] * 1.08;
        const sc = Math.min(shown, board.score);
        $("sfill").style.width = `${Math.min(100, (sc / max) * 100)}%`;
        L.stars.forEach((s, i) => { const t = $("tk" + i); t.style.left = `${(s / max) * 100}%`; t.classList.toggle("on", sc >= s); });
        $("c-hammer").textContent = hammers; $("c-shuffle").textContent = shuffles;
        $("b-hammer").disabled = hammers <= 0; $("b-shuffle").disabled = shuffles <= 0;
        $("b-hammer").classList.toggle("on", hammerMode);
    },
    callout(t) { const el = $("callout"); el.textContent = t; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); },
    toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1800); },
    journey() {
        const box = $("path"), un = unlocked(), H = 128;
        const pts = LEVELS.map((l, i) => [50 + Math.sin(i * 0.85) * 30, 70 + i * H]);
        box.style.height = `${pts.length * H + 80}px`;
        const d = pts.map(([x, y], i) => (i ? `L ${x} ${y}` : `M ${x} ${y}`)).join(" ");
        box.innerHTML = `<svg class="trail" viewBox="0 0 100 ${pts.length * H + 80}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="rgba(242,181,163,.35)" stroke-width="0.8" stroke-dasharray="1.6 1.6" vector-effect="non-scaling-stroke" style="stroke-width:3px"/></svg>` +
            LEVELS.map((l, i) => {
                const st = save.stars[l.n] || 0, cls = l.n < un || st ? "done" : l.n === un ? "cur" : "locked";
                return `<button class="node ${cls}" data-n="${l.n}" style="left:${pts[i][0]}%;top:${pts[i][1]}px" ${cls === "locked" ? "disabled" : ""}>${l.n}<span class="st">${[0, 1, 2].map((k) => (k < st ? "<b>★</b>" : "★")).join("")}</span></button>`;
            }).join("");
        box.querySelectorAll(".node:not(.locked)").forEach((b) => b.addEventListener("click", () => { audio.init(); audio.click(); this.levelCard(+b.dataset.n); }));
        $("j-stars").textContent = totalStars();
        setTimeout(() => { const c = box.querySelector(".node.cur") || box.querySelector(".node.done:last-of-type"); if (c) $("journey").scrollTo({ top: Math.max(0, c.offsetTop - innerHeight / 2), behavior: "smooth" }); }, 50);
    },
    levelCard(n) {
        const l = LEVELS[n - 1];
        $("ml-k").textContent = `Level ${n}`;
        $("ml-t").textContent = l.goals.some((g) => g.kind === "frost") ? "Thaw the board" : l.goals.some((g) => g.kind === "collect") ? "Gather jewels" : "Shine bright";
        $("ml-goals").innerHTML = l.goals.map((g) => { const h = this.goalHTML(g, false); return `<div class="lgoal">${h.icon}<div>${h.text}<small>${h.sub}</small></div></div>`; }).join("");
        $("ml-moves").textContent = l.moves;
        [1, 2, 3].forEach((k) => ($("ml-s" + k).textContent = l.stars[k - 1].toLocaleString()));
        $("ml-play").onclick = () => { this.closeModal(); startLevel(n); };
        this.modal("m-level");
    },
    result(won, stars) {
        $("r-k").textContent = won ? `Level ${L.n} complete` : `Level ${L.n}`;
        $("r-t").textContent = won ? ["", "Lovely", "Brilliant", "Dazzling"][stars] : "Out of moves";
        $("r-stars").innerHTML = won ? [0, 1, 2].map((i) => `<b class="${i < stars ? "on" : ""}" style="animation-delay:${0.25 + i * 0.25}s">★</b>`).join("") : "";
        if (won) for (let i = 0; i < stars; i++) setTimeout(() => audio.star(i), 450 + i * 250);
        $("r-score").textContent = board.score.toLocaleString();
        $("r-msg").textContent = won ? (stars < 3 ? `★★★ at ${L.stars[2].toLocaleString()} points · best ${(save.best[L.n] || 0).toLocaleString()}` : `Best ${(save.best[L.n] || 0).toLocaleString()}`) : "So close — try a different first move. Specials near the goals help most.";
        $("r-next").classList.toggle("hidden", !won || L.n >= LEVELS.length);
        this.modal("m-result");
    },
    title() { const s = totalStars(), un = unlocked(); $("t-meta").innerHTML = s ? `Level <b>${un}</b> awaits · <b>${s}</b> ★ collected` : "30 levels · 6 jewels · endless sparkle"; $("t-play").textContent = s ? `Continue · Level ${un}` : "Play"; },
};

function toJourney() { state = "journey"; board = null; ui.closeModal(); ui.show("journey"); ui.journey(); }
$("t-play").addEventListener("click", () => { audio.init(); audio.click(); toJourney(); ui.levelCard(unlocked()); });
$("t-how").addEventListener("click", () => ui.modal("m-how"));
$("t-settings").addEventListener("click", () => { settingsUI(); ui.modal("m-settings"); });
$("j-back").addEventListener("click", () => { state = "title"; ui.show("title"); ui.title(); });
$("ml-close").addEventListener("click", () => ui.closeModal());
$("b-pause").addEventListener("click", () => { if (state !== "play") return; state = "paused"; $("mp-sub").textContent = `Level ${L.n} · ${moves} moves left · ${board.score.toLocaleString()} points`; ui.modal("m-pause"); });
$("mp-resume").addEventListener("click", () => { state = "play"; ui.closeModal(); });
$("mp-retry").addEventListener("click", () => { ui.closeModal(); startLevel(L.n); });
$("mp-settings").addEventListener("click", () => { settingsUI(); ui.modal("m-settings", () => ui.modal("m-pause")); });
$("mp-map").addEventListener("click", toJourney);
$("ms-close").addEventListener("click", () => ui.closeModal());
$("mh-close").addEventListener("click", () => ui.closeModal());
$("mh-ok").addEventListener("click", () => ui.closeModal());
$("r-map").addEventListener("click", toJourney);
$("r-retry").addEventListener("click", () => { ui.closeModal(); startLevel(L.n); });
$("r-next").addEventListener("click", () => { ui.closeModal(); ui.levelCard(L.n + 1); });
$("b-hammer").addEventListener("click", () => { if (hammers > 0 && !busy()) { hammerMode = !hammerMode; selected = null; ui.hud(); if (hammerMode) ui.toast("Tap a gem to smash it"); } });
$("b-shuffle").addEventListener("click", () => { if (shuffles > 0 && !busy()) { shuffles--; queue.push(board.shuffle()); audio.swap(); ui.hud(); } });
function settingsUI() {
    $("s-vol").value = Math.round(save.volume * 100); $("s-vol").style.setProperty("--v", `${save.volume * 100}%`);
    $("s-hints").setAttribute("aria-checked", save.hints);
}
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; persist(); audio.init(); audio.setVolume(save.volume); e.target.style.setProperty("--v", `${save.volume * 100}%`); });
$("s-hints").addEventListener("click", (e) => { save.hints = !save.hints; persist(); e.currentTarget.setAttribute("aria-checked", save.hints); });
for (const m of ["m-settings", "m-how", "m-level"]) $(m).addEventListener("pointerdown", (e) => { if (e.target === $(m)) ui.closeModal(); });
addEventListener("keydown", (e) => {
    if (e.code === "Escape") { if (ui.open && ui.open !== "m-result") { if (ui.open === "m-pause") { state = "play"; } ui.closeModal(); } else if (state === "play") $("b-pause").click(); else if (hammerMode) { hammerMode = false; ui.hud(); } }
});
addEventListener("blur", () => { if (state === "play") $("b-pause").click(); });

// ------------------------------------------------------------------ boot
window.__gem = () => ({ state, level: L.n, moves, score: board?.score, collected: board?.collected, frost: board?.frostLeft(), busy: busy(), stars: totalStars(), fps: fpsNow, post: post.ok });
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
addEventListener("resize", () => { sizeCanvas(); fitCamera(); });
// a decorative board behind the title
board = new Board(LEVELS[6], mulberry32(7)); L = LEVELS[6];
board.each((r, c) => { const g = board.cells[r][c], [x, y] = cellXY(r, c); vis.set(g.id, { gem: g, x, y, fx: x, fy: y, tx: x, ty: y, t: 1, s: 1, spin: Math.random() * 6, pop: 0 }); });
buildStatic(); fitCamera();
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.title();
    if (Q.has("level")) startLevel(clamp(+Q.get("level"), 1, LEVELS.length));
}, 350);
