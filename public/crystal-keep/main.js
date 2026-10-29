// CRYSTAL KEEP — tower defense in an autumn valley, rendered with the projection3d library (Space, via GameSpace)
// + a bloom post pass. See DESIGN.md. The simulation lives in game.js; this file renders it, handles input and
// drives the UI. Behind the title screen a demo game plays itself with the same bot used for ?autoplay.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, clamp, lerp } from "./mesh.js";
import { MAPS, parseMap, previewSVG, worldToCell, cellX, cellY, W, H, CELL } from "./maps.js";
import { TOWERS, TOWER_ORDER, PRIORITIES, ENEMIES, ENEMY_CSS, DIFFS } from "./defs.js";
import { Game } from "./game.js";
import { buildScene } from "./scene.js";
import { drawTower, drawEnemy, healthBar, drawProjectile, drawKeep, drawRift, rangeRing, cellGlow } from "./models.js";

const Q = new URLSearchParams(location.search);
const SPEED_X = Math.max(1, Math.min(10, +Q.get("speed") || 1));
const K = 1.9;                                                    // projection scale

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
    fitCamera(false);
}

// ------------------------------------------------------------------ save
const DEF = { best: {}, settings: { volume: 0.8, dmg: true, ranges: false, auto: false }, map: "amber", diff: "normal" };
const save = (() => { try { const s = JSON.parse(localStorage.getItem("crystalkeep.save")); return s ? { ...DEF, ...s, settings: { ...DEF.settings, ...s.settings } } : structuredClone(DEF); } catch { return structuredClone(DEF); } })();
const persist = () => { try { localStorage.setItem("crystalkeep.save", JSON.stringify(save)); } catch { } };
if (Q.get("map")) save.map = MAPS.find((m) => m.id === Q.get("map") || m.id.startsWith(Q.get("map").slice(0, 4)))?.id || save.map;
if (Q.get("diff") && DIFFS[Q.get("diff")]) save.diff = Q.get("diff");
audio.volume = save.settings.volume;

// ------------------------------------------------------------------ state
let state = "loading";                 // loading | title | play | paused | end
let map = null, game = null, keepPos = [0, 0, 6], rifts = [];
let selected = null, placing = null, hoverCell = null, hoverTower = null, speed = 1, demo = false;
let time = 0, keepHurt = 0, shake = 0, endTimer = 0;
let particles = [], fx = [];
const stat = new Mesh(260000);
let sSolid = 0, sShadow = 0, sAdd = 0;

function loadMap(id) {
    const def = MAPS.find((m) => m.id === id) || MAPS[0];
    map = parseMap(def);
    const S = new Mesh(220000), Sh = new Mesh(8000), A = new Mesh(2000);
    keepPos = buildScene(S, Sh, A, map).keep;
    rifts = map.spawns.map(([i, j]) => [cellX(i) - 0.4, cellY(j)]);
    stat.reset(); stat.append(S); stat.append(Sh); stat.append(A);
    sSolid = S.n; sShadow = Sh.n; sAdd = A.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}
function newGame(isDemo) {
    demo = isDemo;
    if (!map || map.id !== save.map) loadMap(save.map);
    game = new Game(map, isDemo ? "casual" : save.diff, isDemo ? 3 : +Q.get("wave") || 0);
    if (isDemo) { game.gold = 900; game.timer = 2; }
    selected = null; placing = null; particles = []; fx = []; keepHurt = 0; endTimer = 0; bot.reset();
    clearFloaters();
}

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.95, dist: 40, tYaw: 0, tPitch: 0.95, tDist: 40, fit: 40 };
// on portrait screens the camera turns 90° so the board's long side runs up the screen
const portrait = () => canvas.width / canvas.height < 0.85;
const baseYaw = () => (portrait() ? -Math.PI / 2 : 0);
function fitCamera(reset) {
    const aspect = canvas.width / canvas.height, p = cam.tPitch;
    let bw = W * CELL + 2, bd = H * CELL + 2;
    if (portrait()) [bw, bd] = [bd + 9, bw + 2];
    const dW = K * bw * 0.5 * 1.04, dH = K * aspect * 0.5 * (bd * Math.sin(p) + 6 * Math.cos(p)) * (aspect < 1 ? 1.1 : 1.32);
    cam.fit = Math.max(dW, dH);
    if (reset || Math.abs(cam.tYaw - baseYaw()) > 1) { cam.tYaw = cam.yaw = baseYaw(); cam.tPitch = cam.pitch = portrait() ? 1.15 : 0.95; cam.tDist = cam.fit; }
    else cam.tDist = clamp(cam.tDist, cam.fit * 0.5, cam.fit * 1.25);
}
function updateCamera(dt) {
    const f = 1 - Math.exp(-dt * 7);
    cam.yaw += (cam.tYaw - cam.yaw) * f; cam.pitch += (cam.tPitch - cam.pitch) * f; cam.dist += (cam.tDist - cam.dist) * f;
    space.magnifier = K * 1.6;
    let yaw = cam.yaw, pitch = cam.pitch, dist = cam.dist, tx = 0, ty = -0.8, tz = 0;
    if (state === "title" || state === "loading") {
        yaw = baseYaw() + Math.sin(time * 0.07) * 0.25; pitch = 0.6; dist = cam.fit * 0.95;
        if (innerWidth > 900) { tx = -9; ty = 2; }
    }
    if (shake > 0) { tx += (Math.random() - 0.5) * shake; ty += (Math.random() - 0.5) * shake; }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    space.lookAt(tx + dist * cp * Math.sin(yaw), ty - dist * cp * Math.cos(yaw), tz + dist * sp, tx, ty, tz);
}
function project(x, y, z) {
    const v = [x - space.Xc, y - space.Yc, z - space.Zc], X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const xp = -(v[0] * X[0] + v[1] * X[1] + v[2] * X[2]), yp = v[0] * Y[0] + v[1] * Y[1] + v[2] * Y[2], zp = v[0] * Z[0] + v[1] * Z[1] + v[2] * Z[2];
    if (zp <= 0.1) return null;
    const k = space.magnifier / 1.6, aspect = canvas.width / canvas.height;
    return [((xp * k) / zp + 1) * 0.5 * innerWidth, (1 - (yp * k * aspect) / zp) * 0.5 * innerHeight];
}
function ground(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    const d = [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect);
    if (d[2] >= -1e-4) return null;
    const t = -space.Zc / d[2];
    return [space.Xc + d[0] * t, space.Yc + d[1] * t];
}
function cellAt(sx, sy) {
    const g = ground(sx, sy);
    if (!g) return null;
    const [i, j] = worldToCell(g[0], g[1]);
    return i >= 0 && j >= 0 && i < W && j < H ? [i, j] : null;
}
function towerAtScreen(sx, sy) {
    let best = null, bd = 34;
    for (const t of game.towers) {
        const a = project(t.x, t.y, 0.3), b = project(t.x, t.y, 2.6);
        if (!a || !b) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        const u = clamp(((sx - a[0]) * dx + (sy - a[1]) * dy) / l2, 0, 1);
        const d = Math.hypot(sx - (a[0] + dx * u), sy - (a[1] + dy * u));
        if (d < bd) { bd = d; best = t; }
    }
    if (!best) { const c = cellAt(sx, sy); if (c) best = game.towerAt(c[0], c[1]) || null; }
    return best;
}

// ------------------------------------------------------------------ input
const ptrs = new Map();
let drag = null, pinch = null;
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    if (e.button === 2) { cancel(); return; }
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.tDist }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch, moved: false };
    if (e.pointerType !== "mouse" && placing) hoverCell = cellAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; cam.tDist = clamp(pinch.dist * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cam.fit * 0.5, cam.fit * 1.25); return; }
    if (state !== "play") return;
    if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 8 && !(placing && e.pointerType !== "mouse")) { drag.moved = true; canvas.classList.add("drag"); }
        if (drag.moved) { cam.tYaw = clamp(drag.yaw - dx * 0.005, baseYaw() - 0.6, baseYaw() + 0.6); cam.tPitch = clamp(drag.pitch + dy * 0.004, 0.62, 1.3); return; }
    }
    hoverCell = cellAt(e.clientX, e.clientY);
    hoverTower = placing ? null : towerAtScreen(e.clientX, e.clientY);
    canvas.classList.toggle("point", !!hoverTower);
});
const endPtr = (e) => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === "pointerup" && state === "play") click(e.clientX, e.clientY, e.shiftKey);
    drag = null; canvas.classList.remove("drag");
};
canvas.addEventListener("pointerup", endPtr);
canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.tDist = clamp(cam.tDist * Math.exp(e.deltaY * 0.001), cam.fit * 0.5, cam.fit * 1.25); }, { passive: false });
canvas.addEventListener("dblclick", () => fitCamera(true));

function click(sx, sy, keep) {
    if (placing) {
        const c = cellAt(sx, sy);
        if (!c) { cancel(); return; }
        const r = game.build(placing, c[0], c[1]);
        if (!r.ok) { audio.error(); ui.toast(r.why, true); if (game.towerAt(c[0], c[1])) { select(game.towerAt(c[0], c[1])); placing = null; ui.build(); } return; }
        if (!keep || game.gold < TOWERS[placing].levels[0].cost) { placing = null; select(r.tower); }
        ui.build();
        return;
    }
    const t = towerAtScreen(sx, sy);
    if (t) { select(t); audio.click(); } else select(null);
}
function select(t) { selected = t; ui.inspector(); }
function cancel() { if (placing) { placing = null; ui.build(); } else if (selected) select(null); }
function startPlacing(type) {
    if (state !== "play") return;
    if (placing === type) { placing = null; ui.build(); return; }
    if (game.gold < TOWERS[type].levels[0].cost) { audio.error(); ui.toast(`Not enough gold for ${TOWERS[type].name}`, true); return; }
    placing = type; select(null); ui.build(); audio.click();
    canvas.classList.add("build");
}
function upgradeSel() {
    if (!selected) return;
    const r = game.upgrade(selected);
    if (!r.ok) { audio.error(); ui.toast(r.why, true); }
    ui.inspector();
}
function sellSel() { if (!selected) return; game.sell(selected); select(null); }
function cyclePrio() { if (!selected) return; selected.priority = PRIORITIES[(PRIORITIES.indexOf(selected.priority) + 1) % PRIORITIES.length]; ui.inspector(); audio.click(); }
function setSpeed(s) { speed = s; document.querySelectorAll("#speed button").forEach((b) => b.classList.toggle("on", +b.dataset.s === s)); }
function callWave() {
    if (state !== "play" || game.phase !== "build") return;
    const bonus = game.callWave();
    if (bonus > 0) { const p = project(keepPos[0], keepPos[1], 3); floater(`+${bonus} early bonus`, p, "gold"); audio.coin(); }
}

addEventListener("keydown", (e) => {
    audio.init();
    const k = e.code;
    if (k === "Escape") { if (ui.open) { if (ui.open !== "m-end") ui.closeModal(); return; } if (placing || selected) { cancel(); return; } if (state === "play") togglePause(); return; }
    if (k === "KeyP" && (state === "play" || state === "paused")) { togglePause(); return; }
    if (state !== "play") return;
    const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(k);
    if (n >= 0) startPlacing(TOWER_ORDER[n]);
    else if (k === "KeyU") upgradeSel();
    else if (k === "KeyX" || k === "Delete") sellSel();
    else if (k === "Tab") { e.preventDefault(); cyclePrio(); }
    else if (k === "Space") { e.preventDefault(); callWave(); }
    else if (k === "KeyF") setSpeed(speed % 3 + 1);
    else if (k === "KeyR") fitCamera(true);
});
addEventListener("blur", () => { if (state === "play") togglePause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") togglePause(); });
function togglePause() {
    if (state === "play") { state = "paused"; $("mp-sub").textContent = `Wave ${game.wave} of ${game.totalWaves} · ${game.lives} lives · ${game.gold} gold`; ui.modal("m-pause"); }
    else if (state === "paused") { state = "play"; ui.closeModal(); }
}

// ------------------------------------------------------------------ effects
function burst(x, y, z, n, col, sp, life, size, grav = 4) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, e = Math.random() * 1.3, s = sp * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(a) * Math.cos(e) * s, vz: Math.sin(e) * s, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.8), c: col, g: grav });
    }
}
const floatersEl = document.getElementById("floaters");
function floater(text, p, cls = "") {
    if (!p || floatersEl.childElementCount > 60) return;
    const el = document.createElement("div");
    el.className = "fl " + cls; el.textContent = text;
    el.style.left = p[0] + "px"; el.style.top = p[1] + "px";
    floatersEl.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
}
function clearFloaters() { floatersEl.innerHTML = ""; }

function handleEvents() {
    for (const ev of game.events) {
        const quiet = demo;
        switch (ev.type) {
            case "build": if (!quiet) audio.build(); burst(ev.tower.x, ev.tower.y, 0.4, 24, [0.6, 0.5, 0.35], 4, 0.8, 0.12); burst(ev.tower.x, ev.tower.y, 1.5, 14, ev.tower.def.crystal, 3, 1, 0.1, 1); break;
            case "upgrade": if (!quiet) audio.upgrade(); burst(ev.tower.x, ev.tower.y, 1.5, 36, [1.6, 1.2, 0.5], 4, 1.1, 0.1, 1); fx.push({ kind: "ring", x: ev.tower.x, y: ev.tower.y, t: 0, life: 0.6, r: 2.4, c: [1.2, 0.9, 0.4] }); break;
            case "sell": if (!quiet) audio.sell(); floater(`+${ev.gold}`, project(ev.tower.x, ev.tower.y, 2), "gold"); burst(ev.tower.x, ev.tower.y, 0.6, 20, [0.6, 0.5, 0.35], 3, 0.7, 0.12); break;
            case "shoot": if (!quiet) audio.shoot(ev.tower.type); break;
            case "hit": burst(ev.x, ev.y, ev.z, 5, ev.kind === "frost" ? [0.6, 1.0, 1.4] : [0.5, 0.9, 1.2], 3, 0.3, 0.06, 2); break;
            case "frost": if (!quiet) audio.frost(); fx.push({ kind: "ring", x: ev.x, y: ev.y, t: 0, life: 0.5, r: ev.r, c: [0.4, 0.8, 1.2] }); burst(ev.x, ev.y, 0.5, 12, [0.7, 1.0, 1.3], 2.5, 0.6, 0.08, 1); break;
            case "explode": if (!quiet) audio.explode(); fx.push({ kind: "boom", x: ev.x, y: ev.y, t: 0, life: 0.55, r: ev.r }); burst(ev.x, ev.y, 0.4, 26, [1.6, 0.7, 0.2], 7, 0.7, 0.14, 9); burst(ev.x, ev.y, 0.5, 10, [0.25, 0.22, 0.2], 3, 1.2, 0.35, -0.5); shake = Math.max(shake, 0.12); break;
            case "lightning": fx.push({ kind: "bolt", pts: ev.pts, t: 0, life: 0.2 }); break;
            case "dmg": if (save.settings.dmg && !quiet && ev.amount > 0) floater(String(ev.amount), project(ev.x, ev.y, ev.z), ev.amount >= 60 ? "big" : ""); break;
            case "kill": {
                const e = ev.enemy;
                if (!quiet) { audio.kill(e.def.boss); audio.coin(); floater(`+${ev.gold}`, project(e.x, e.y, e.z + e.def.size * 2.2), "gold"); }
                burst(e.x, e.y, e.z + e.def.size, e.def.boss ? 90 : 18, [0.2, 0.15, 0.25], e.def.boss ? 6 : 2.5, 0.9, e.def.boss ? 0.5 : 0.22, -0.8);
                burst(e.x, e.y, e.z + e.def.size, e.def.boss ? 70 : 10, [1.4, 1.0, 0.4], 4, 0.7, 0.07, 3);
                if (e.def.boss) shake = 0.5;
                break;
            }
            case "leak": if (!quiet) { audio.leak(); floater(`−${ev.lives} ♦`, project(keepPos[0], keepPos[1], keepPos[2] + 1), "leak"); ui.hurt(); } keepHurt = 1; break;
            case "wave": if (!quiet) { audio.horn(ev.boss); ui.banner(ev.boss ? "A GOLEM APPROACHES" : "WAVE", ev.boss ? `Wave ${ev.wave}` : String(ev.wave), ev.boss); } break;
            case "cleared": if (!quiet) { audio.cleared(); ui.banner(`WAVE ${ev.wave} CLEARED`, `+${ev.bonus} gold`); if (save.settings.auto) setTimeout(() => callWave(), 1200); } break;
            case "boss": if (!quiet) ui.boss = ev.enemy; break;
            case "won": case "lost": if (!quiet) endTimer = 1.6; break;
        }
    }
    game.events.length = 0;
}

// ------------------------------------------------------------------ bot (title demo + ?autoplay)
const bot = {
    reset() { this.cells = null; this.k = 0; this.t = 0; },
    step(dt) {
        this.t -= dt; if (this.t > 0) return; this.t = 0.4;
        const g = game, order = ["archer", "cannon", "archer", "frost", "storm", "archer", "cannon", "storm"];
        if (!this.cells) {
            this.cells = [];
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (map.buildable(i, j)) {
                let c = 0; for (const r of map.routes) for (const [x, y] of r.pts) if (Math.hypot(x - cellX(i), y - cellY(j)) <= 3 * CELL) c++;
                this.cells.push([i, j, c]);
            }
            this.cells.sort((a, b) => b[2] - a[2]);
        }
        const type = order[this.k % order.length], ups = g.towers.filter((t) => t.level < 2).sort((a, b) => g.upgradeCost(a) - g.upgradeCost(b));
        if (g.towers.length >= 6 && ups.length && g.gold >= g.upgradeCost(ups[0]) && g.towers.length % 2 === 0) g.upgrade(ups[0]);
        else if (g.gold >= TOWERS[type].levels[0].cost) { const c = this.cells.find(([i, j]) => g.canBuild(i, j)); if (c && g.build(type, c[0], c[1]).ok) this.k++; }
        if (g.phase === "build" && (demo || g.timer < g.diff.timer - 3)) g.callWave();
    },
};

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt;
    keepHurt = Math.max(0, keepHurt - dt * 1.5); shake = Math.max(0, shake - dt * 1.2);
    const running = state === "play" || state === "title";
    if (running && game) {
        if (demo || Q.has("autoplay")) bot.step(dt);
        let left = dt * (state === "play" ? speed : 1);
        while (left > 1e-6) { const s = Math.min(left, 1 / 30); game.update(s); left -= s; }
        handleEvents();
        if (demo && (game.phase === "won" || game.phase === "lost" || game.wave >= 12)) newGame(true);
    }
    for (const p of particles) { p.vz -= p.g * dt; const k = Math.exp(-dt * 1.4); p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0.05, p.z + p.vz * dt); p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 900) particles.splice(0, particles.length - 900);
    for (const f of fx) f.t += dt;
    fx = fx.filter((f) => f.t < f.life);
    if (endTimer > 0 && state === "play") { endTimer -= dt; if (endTimer <= 0) finish(); }
    if (state === "play") ui.hud();
}

function finish() {
    state = "end";
    const won = game.phase === "won", frac = game.lives / game.maxLives;
    const stars = won ? (frac >= 0.9 ? 3 : frac >= 0.5 ? 2 : 1) : 0;
    const b = (save.best[map.id] ||= {});
    b[save.diff] = Math.max(b[save.diff] || 0, stars); persist();
    won ? audio.won() : audio.lost();
    ui.end(won, stars);
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(140000), dynSh = new Mesh(8000), dynAdd = new Mesh(60000);
const lightBuf = new Float32Array(32), lightColBuf = new Float32Array(24);

function beam(A, a, b, w, col) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], Z = space.zUnitVec;
    let n = [d[1] * Z[2] - d[2] * Z[1], d[2] * Z[0] - d[0] * Z[2], d[0] * Z[1] - d[1] * Z[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => (v / l) * w);
    A.quad([a[0] - n[0], a[1] - n[1], a[2] - n[2]], [b[0] - n[0], b[1] - n[1], b[2] - n[2]], [b[0] + n[0], b[1] + n[1], b[2] + n[2]], [a[0] + n[0], a[1] + n[1], a[2] + n[2]], col, MAT.ADD);
}

function buildDynamic() {
    const S = dyn, Sh = dynSh, A = dynAdd;
    S.reset(); Sh.reset(); A.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    const lights = [];
    // keep + rifts
    const lf = game ? game.lives / game.maxLives : 1;
    drawKeep(S, A, keepPos, time, keepHurt, lf);
    lights.push({ p: keepPos, s: 3.5 + keepHurt * 3, c: [0.4 + keepHurt, 0.85 - keepHurt * 0.5, 1.2 - keepHurt * 0.8] });
    for (const r of rifts) { drawRift(S, A, r, time, game && game.phase === "wave"); lights.push({ p: [r[0] + 0.5, r[1], 1.4], s: 2.2, c: [0.7, 0.3, 1.2] }); }
    if (game) {
        const X = space.xUnitVec, Y = space.yUnitVec;
        for (const t of game.towers) {
            drawTower(S, A, Sh, t, time);
            if (t === selected || save.settings.ranges) rangeRing(A, t.x, t.y, t.def.levels[t.level].range * CELL, t === selected ? [0.9, 0.75, 0.35] : [0.25, 0.22, 0.12], time);
            if (t === hoverTower && t !== selected) rangeRing(A, t.x, t.y, t.def.levels[t.level].range * CELL, [0.35, 0.3, 0.16], time);
            if (t.type === "storm" || t.type === "frost") lights.push({ p: [t.x, t.y, 3], s: 0.8 + t.flash * 2, c: t.def.crystal.map((v) => v * 0.6), tower: true });
        }
        if (selected) cellGlow(A, selected.x, selected.y, [0.9, 0.7, 0.3]);
        // placement ghost
        if (placing && hoverCell && state === "play") {
            const [i, j] = hoverCell, ok = game.canBuild(i, j) && game.gold >= TOWERS[placing].levels[0].cost;
            const col = ok ? [0.25, 0.9, 0.45] : [1.0, 0.25, 0.2], x = cellX(i), y = cellY(j);
            cellGlow(A, x, y, col);
            drawTower(S, A, Sh, { type: placing, def: TOWERS[placing], level: 0, x, y, aim: Math.PI / 2, flash: 0, born: -9 }, time, col.map((v) => v * 0.16));
            rangeRing(A, x, y, TOWERS[placing].levels[0].range * CELL, col.map((v) => v * 0.8), time);
        }
        for (const e of game.enemies) {
            drawEnemy(S, A, Sh, e, time);
            if (e.hp < e.maxHp || e.def.boss) healthBar(S, e, X, Y, e.z + e.def.size * (e.type === "golem" ? 3.7 : 3.1) + 0.45);
        }
        for (const p of game.projectiles) drawProjectile(S, A, p);
    }
    for (const f of fx) {
        const u = f.t / f.life;
        if (f.kind === "boom") {
            A.sprite(f.x, f.y, 0.8, f.r * (0.4 + u), 1.4 * (1 - u), 0.6 * (1 - u), 0.15 * (1 - u));
            ringFx(A, f.x, f.y, f.r * (0.3 + u * 0.9), [1.2 * (1 - u), 0.55 * (1 - u), 0.15 * (1 - u)], 0.22);
            if (u < 0.3) lights.push({ p: [f.x, f.y, 1.2], s: 6 * (1 - u / 0.3), c: [1.3, 0.6, 0.2] });
        } else if (f.kind === "ring") {
            ringFx(A, f.x, f.y, f.r * (0.2 + u * 0.8), f.c.map((v) => v * (1 - u)), 0.16);
        } else if (f.kind === "bolt") {
            const k = 1 - u;
            for (let s = 0; s < f.pts.length - 1; s++) {
                const a = f.pts[s], b = f.pts[s + 1];
                let prev = a;
                for (let q = 1; q <= 6; q++) {
                    const t = q / 6, j = q === 6 ? 0 : 0.45;
                    const p = [lerp(a[0], b[0], t) + (Math.random() - 0.5) * j, lerp(a[1], b[1], t) + (Math.random() - 0.5) * j, lerp(a[2], b[2], t) + (Math.random() - 0.5) * j];
                    beam(A, prev, p, 0.12, [0.5 * k, 0.3 * k, 1.0 * k]); beam(A, prev, p, 0.035, [1.4 * k, 1.3 * k, 1.8 * k]);
                    prev = p;
                }
                A.sprite(b[0], b[1], b[2], 0.6, 0.8 * k, 0.6 * k, 1.4 * k);
            }
            lights.push({ p: f.pts[1] || f.pts[0], s: 3 * k, c: [0.7, 0.5, 1.3] });
        }
    }
    for (const p of particles) {
        const k = Math.min(1, (p.life / p.max) * 1.5);
        A.sprite(p.x, p.y, p.z, p.size * (0.5 + 0.5 * k), p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
    const sN = S.n, shN = Sh.n;
    S.append(Sh); S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, shN, aN: A.n, lights };
}
function ringFx(A, x, y, r, c, w) {
    const n = 40;
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 6.2832, a1 = ((i + 1) / n) * 6.2832;
        A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.12], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.12], [x + Math.cos(a1) * (r - w), y + Math.sin(a1) * (r - w), 0.12], [x + Math.cos(a0) * (r - w), y + Math.sin(a0) * (r - w), 0.12], c, MAT.ADD);
    }
}

function render() {
    const { sN, shN, aN, lights } = buildDynamic();
    const nonTower = lights.filter((l) => !l.tower), towers = lights.filter((l) => l.tower);
    const pick = [...nonTower, ...towers].slice(0, 8);
    pick.forEach((l, i) => { lightBuf.set([...l.p, l.s], i * 4); lightColBuf.set(l.c, i * 3); });
    const aspect = canvas.width / canvas.height;
    post.begin();
    gl.useProgram(U.program);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, pick.length);
    const sd = [-0.45, 0.78, 0.32], sl = Math.hypot(...sd);
    gl.uniform3f(U.uSunDir, sd[0] / sl, sd[1] / sl, sd[2] / sl);
    space.applyCamera();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, sSolid);
    space.bind(true); space.draw(6, sN - 6);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    space.bind(false); space.draw(sSolid, sShadow);
    space.bind(true); space.draw(sN, shN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(false); space.draw(sSolid + sShadow, sAdd);
    space.bind(true); space.draw(sN + shN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: keepHurt * 0.35 });
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const MODALS = ["m-pause", "m-settings", "m-help", "m-end"];
const coinSvg = `<svg><use href="#i-coin"/></svg>`;
const ui = {
    open: null, back: null, last: {}, boss: null,
    show(which) {
        $("title").classList.toggle("hidden", which !== "title");
        $("hud").classList.toggle("hidden", which !== "hud");
        document.body.dataset.state = which;
    },
    modal(id, back = null) { for (const m of MODALS) $(m).classList.toggle("hidden", m !== id); this.open = id; this.back = back; setTimeout(() => $(id).querySelector(".btn.gold, .btn")?.focus({ preventScroll: true }), 40); },
    closeModal() { const b = this.back; for (const m of MODALS) $(m).classList.add("hidden"); this.open = null; this.back = null; if (b) b(); },
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; return true; } return false; },
    hud() {
        const g = game;
        this.set("h-lives", String(g.lives));
        if (this.set("h-gold", String(g.gold))) { $("p-gold").classList.remove("bump"); void $("p-gold").offsetWidth; $("p-gold").classList.add("bump"); this.build(); if (selected) this.inspector(); }
        this.set("h-wave", String(g.wave)); this.set("h-waves", String(g.totalWaves));
        $("h-wbar").style.width = `${(g.wave / g.totalWaves) * 100}%`;
        const building = g.phase === "build";
        this.set("h-nextlab", building ? (g.wave === 0 ? "FIRST WAVE" : `NEXT · WAVE ${g.wave + 1}`) : "REMAINING");
        const key = building ? "n" + g.wave : "r" + (g.enemies.length + g.queue.length);
        if (this.last.next !== key) {
            this.last.next = key;
            $("h-next").innerHTML = building
                ? g.nextWavePreview().map((x) => `<span class="echip ${ENEMIES[x.type].boss ? "boss" : ""}" title="${ENEMIES[x.type].name}${ENEMIES[x.type].air ? " (flying)" : ""}"><i style="color:${ENEMY_CSS[x.type]};background:${ENEMY_CSS[x.type]}"></i>${ENEMIES[x.type].name} ×${x.count}</span>`).join("")
                : `<span class="echip"><i style="color:#ff6b5b;background:#ff6b5b"></i>${g.enemies.length + g.queue.length} shadows</span>`;
        }
        $("b-call").classList.toggle("hidden", !building);
        if (building) {
            const total = g.wave === 0 ? g.diff.timer + 10 : g.diff.timer, f = clamp(g.timer / total, 0, 1);
            $("call-arc").setAttribute("stroke-dasharray", `${(f * 69).toFixed(1)} 69`);
            this.set("call-bonus", `+${Math.floor(g.timer * 2)}`);
            this.set("call-txt", `${Math.ceil(g.timer)}s`);
        }
        const boss = this.boss && this.boss.alive ? this.boss : null;
        $("boss").classList.toggle("hidden", !boss);
        if (boss) $("boss-fill").style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    },
    build() {
        const bar = $("buildbar");
        if (!bar.children.length) {
            bar.innerHTML = TOWER_ORDER.map((id) => {
                const t = TOWERS[id], L = t.levels[0];
                return `<button class="tcard" id="bc-${id}" style="--tc:${t.css}" aria-label="${t.name}"><kbd>${t.key}</kbd>
                    <span class="tic"><svg><use href="#t-${id}"/></svg></span><span class="nm">${t.name.split(" ")[0]}</span>
                    <span class="cost">${coinSvg}${L.cost}</span>
                    <span class="tip"><b>${t.name}</b><p>${t.blurb}</p><span class="st"><span>Damage</span><em>${L.dmg}</em><span>Fire rate</span><em>${(1 / L.rate).toFixed(1)}/s</em><span>Range</span><em>${L.range}</em>${L.splash ? `<span>Splash</span><em>${L.splash}</em>` : ""}${L.slow ? `<span>Slow</span><em>${L.slow * 100}%</em>` : ""}${L.chain ? `<span>Chains</span><em>${L.chain}</em>` : ""}<span>Hits flyers</span><em>${t.air ? "Yes" : "No"}</em></span></span></button>`;
            }).join("");
            for (const id of TOWER_ORDER) $("bc-" + id).addEventListener("click", () => { audio.init(); startPlacing(id); });
        }
        for (const id of TOWER_ORDER) {
            const el = $("bc-" + id);
            el.classList.toggle("on", placing === id);
            el.classList.toggle("poor", !!game && game.gold < TOWERS[id].levels[0].cost);
        }
        canvas.classList.toggle("build", !!placing);
    },
    inspector() {
        const t = selected, box = $("insp");
        box.classList.toggle("hidden", !t);
        if (!t) return;
        const L = t.def.levels[t.level], N = t.def.levels[t.level + 1];
        box.style.setProperty("--tc", t.def.css);
        $("i-icon").innerHTML = `<svg><use href="#t-${t.type}"/></svg>`;
        $("i-name").textContent = t.def.name;
        $("i-pips").innerHTML = [0, 1, 2].map((k) => `<i class="${k <= t.level ? "on" : ""}"></i>`).join("");
        const d = (a, b, f = (x) => x) => (N && b !== a ? `<small>→ ${f(b)}</small>` : "");
        const rows = [
            ["Damage", L.dmg, d(L.dmg, N?.dmg)],
            ["Fire rate", `${(1 / L.rate).toFixed(2)}/s`, N ? d(L.rate, N.rate, (r) => (1 / r).toFixed(2) + "/s") : ""],
            ["Range", `${L.range} cells`, d(L.range, N?.range)],
        ];
        if (L.splash) rows.push(["Splash", L.splash, d(L.splash, N?.splash)]);
        if (L.slow) rows.push(["Slow", `${Math.round(L.slow * 100)}%`, N ? d(L.slow, N.slow, (s) => Math.round(s * 100) + "%") : ""]);
        if (L.chain) rows.push(["Chains", L.chain, d(L.chain, N?.chain)]);
        rows.push(["Flyers", t.def.air ? "Yes" : "No", ""]);
        $("i-stats").innerHTML = rows.map(([k, v, x]) => `<div><span>${k}</span><em>${v}${x}</em></div>`).join("");
        $("i-kills").textContent = t.kills; $("i-dmg").textContent = Math.round(t.dmg).toLocaleString();
        document.querySelectorAll("#i-prio button").forEach((b) => b.classList.toggle("on", b.dataset.p === t.priority));
        const cost = game.upgradeCost(t);
        $("i-up").disabled = cost == null || game.gold < cost;
        $("i-up-t").textContent = cost == null ? "Max level" : `Upgrade · U`;
        $("i-up-c").innerHTML = cost == null ? "★★★" : `${coinSvg}${cost}`;
        $("i-sell-c").innerHTML = `${coinSvg}${game.sellValue(t)}`;
    },
    banner(k, t, boss) {
        const el = $("banner"); $("bn-k").textContent = k; $("bn-t").textContent = t;
        el.classList.toggle("boss", !!boss); el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    },
    toast(t, err) { const el = $("toast"); el.textContent = t; el.classList.toggle("err", !!err); el.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 1800); },
    hurt() { const el = $("p-lives"); el.classList.remove("hurt"); void el.offsetWidth; el.classList.add("hurt"); },
    end(won, stars) {
        $("m-end").classList.toggle("lost", !won);
        $("e-k").textContent = won ? "Victory" : "Defeat";
        $("e-t").textContent = won ? "The Keep stands" : "The crystal has fallen";
        $("e-stars").innerHTML = won ? [0, 1, 2].map((i) => `<b class="${i < stars ? "on" : ""}" style="animation-delay:${0.2 + i * 0.22}s">★</b>`).join("") : "";
        $("e-msg").textContent = won ? (stars === 3 ? "Flawless. Barely a scratch on the crystal." : stars === 2 ? "Keep 90% of your lives for three stars." : "It held — just. Fewer leaks earn more stars.") : `The shadows broke through on wave ${game.wave}. Try a different mix of towers.`;
        $("e-waves").textContent = `${won ? game.totalWaves : Math.max(0, game.wave - 1)}/${game.totalWaves}`;
        $("e-lives").textContent = `${game.lives}/${game.maxLives}`;
        $("e-kills").textContent = game.stats.killed; $("e-towers").textContent = game.towers.length;
        $("e-gold").textContent = game.stats.goldEarned.toLocaleString(); $("e-time").textContent = fmtTime(game.time);
        this.modal("m-end");
    },
    maps() {
        $("maps").innerHTML = MAPS.map((m, i) => {
            const st = (save.best[m.id] || {})[save.diff] || 0;
            return `<button class="map glass ${m.id === save.map ? "sel" : ""}" data-id="${m.id}" style="animation-delay:${0.1 + i * 0.08}s">
                <div class="pv">${previewSVG(m)}</div>
                <h3>${m.name}<span class="skulls">${[1, 2, 3].map((k) => `<i class="${k <= m.difficulty ? "on" : ""}"></i>`).join("")}</span></h3>
                <p>${m.blurb}</p>
                <div class="foot"><span>${DIFFS[save.diff].name}</span><span class="stars">${[0, 1, 2].map((k) => (k < st ? "<b>★</b>" : "★")).join("")}</span></div></button>`;
        }).join("");
        document.querySelectorAll(".map").forEach((b) => b.addEventListener("click", () => {
            audio.init(); audio.click();
            if (save.map === b.dataset.id) { play(); return; }
            save.map = b.dataset.id; persist(); this.maps(); newGame(true); fitCamera(true);
        }));
        $("t-map").textContent = MAPS.find((m) => m.id === save.map).name;
        const D = DIFFS[save.diff];
        $("t-diffnote").textContent = `${D.lives} lives · ${D.gold} gold · enemy health ×${D.hp}`;
        document.querySelectorAll("#diff button").forEach((b) => b.classList.toggle("on", b.dataset.d === save.diff));
    },
    settings() {
        $("s-vol").value = Math.round(save.settings.volume * 100); $("s-vol").style.setProperty("--v", `${save.settings.volume * 100}%`);
        $("s-dmg").setAttribute("aria-checked", save.settings.dmg);
        $("s-ranges").setAttribute("aria-checked", save.settings.ranges);
        $("s-auto").setAttribute("aria-checked", save.settings.auto);
    },
};

function play() {
    audio.init();
    newGame(false);
    state = "play"; ui.boss = null; ui.last = {};
    ui.show("hud"); ui.build(); ui.inspector(); setSpeed(1);
    fitCamera(true);
    ui.banner(map.name.toUpperCase(), `Wave 1 in ${Math.ceil(game.timer)}s`);
    if (!localStorage.getItem("crystalkeep.helped")) { try { localStorage.setItem("crystalkeep.helped", "1"); } catch { } setTimeout(() => ui.toast("Pick a tower below, then click a meadow plot beside the road"), 2600); }
}
function toMenu() { state = "title"; ui.closeModal(); ui.show("title"); ui.maps(); newGame(true); }

$("t-play").addEventListener("click", play);
$("t-howto").addEventListener("click", () => ui.modal("m-help"));
$("t-help").addEventListener("click", () => ui.modal("m-help"));
$("t-settings").addEventListener("click", () => { ui.settings(); ui.modal("m-settings"); });
document.querySelectorAll("#diff button").forEach((b) => b.addEventListener("click", () => { save.diff = b.dataset.d; persist(); ui.maps(); audio.init(); audio.click(); }));
$("b-call").addEventListener("click", callWave);
$("b-pause").addEventListener("click", togglePause);
document.querySelectorAll("#speed button").forEach((b) => b.addEventListener("click", () => setSpeed(+b.dataset.s)));
$("i-close").addEventListener("click", () => select(null));
$("i-up").addEventListener("click", upgradeSel);
$("i-sell").addEventListener("click", sellSel);
document.querySelectorAll("#i-prio button").forEach((b) => b.addEventListener("click", () => { if (selected) { selected.priority = b.dataset.p; ui.inspector(); audio.click(); } }));
$("mp-resume").addEventListener("click", togglePause);
$("mp-settings").addEventListener("click", () => { ui.settings(); ui.modal("m-settings", () => ui.modal("m-pause")); });
$("mp-restart").addEventListener("click", () => { ui.closeModal(); play(); });
$("mp-menu").addEventListener("click", toMenu);
$("ms-close").addEventListener("click", () => ui.closeModal());
$("mh-close").addEventListener("click", () => ui.closeModal());
$("mh-ok").addEventListener("click", () => ui.closeModal());
$("e-menu").addEventListener("click", toMenu);
$("e-again").addEventListener("click", () => { ui.closeModal(); play(); });
$("s-vol").addEventListener("input", (e) => { const v = e.target.value / 100; save.settings.volume = v; persist(); audio.init(); audio.setVolume(v); e.target.style.setProperty("--v", `${v * 100}%`); });
for (const [id, key] of [["s-dmg", "dmg"], ["s-ranges", "ranges"], ["s-auto", "auto"]]) $(id).addEventListener("click", (e) => { save.settings[key] = !save.settings[key]; persist(); e.currentTarget.setAttribute("aria-checked", save.settings[key]); });
for (const m of ["m-settings", "m-help"]) $(m).addEventListener("pointerdown", (e) => { if (e.target === $(m)) ui.closeModal(); });

// ------------------------------------------------------------------ boot
window.__keep = () => game && ({ state, map: map.id, diff: save.diff, phase: game.phase, wave: game.wave, lives: game.lives, gold: game.gold, towers: game.towers.length, enemies: game.enemies.length, fps: fpsNow, post: post.ok, placing, selected: selected ? selected.type + selected.level : null, hover: hoverCell });
let last = performance.now(), fpsNow = 0, fpsN = 0, fpsT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fpsN++; fpsT += (now - last) / 1000; if (fpsT > 1) { fpsNow = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    last = now;
    if (state !== "paused" && state !== "end") for (let s = 0; s < SPEED_X; s++) update(dt);
    else if (state === "end") update(0);
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}
sizeCanvas();
addEventListener("resize", sizeCanvas);
newGame(true);
fitCamera(true);
requestAnimationFrame(frame);
setTimeout(() => {
    $("loading").classList.add("out");
    state = "title"; ui.show("title"); ui.maps();
    if (Q.has("autoplay") || Q.has("map")) play();
}, 400);
