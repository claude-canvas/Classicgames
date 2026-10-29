// JADE PAVILION — mahjong solitaire in a lantern-lit tea pavilion.
// Rendered with the projection3d library (Space, via GameSpace) + a bloom post pass. See DESIGN.md.
//
// Frame: update() advances timers and animations; render() rebuilds the dynamic mesh (tiles, shadows, lanterns,
// particles) and draws: BG → static opaque → dynamic opaque → contact shadows (multiply) → additive → post.

import GameSpace from "./GameSpace.js";
import { createProgram } from "./shaders.js";
import { Post } from "./post.js";
import { Audio } from "./audio.js";
import { Mesh, MAT, mulberry32, clamp, lerp, smooth } from "./mesh.js";
import { buildAtlas, faceUV, matches, faceCanvas, pairPool } from "./tiles.js";
import { LAYOUTS, neighbours, isFree, freeTiles, availableMatches, deal, reshuffle, bounds, previewSVG } from "./layouts.js";
import { THEMES, LANTERNS, buildScene, drawLantern } from "./scene.js";

const Q = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(10, +Q.get("speed") || 1));
const TW = 1.0, TD = 1.32, TH = 0.72, GAP = 0.05;                 // tile size and spacing
const HINTS = 3, SHUFFLES = 2, COMBO_WINDOW = 4;

// ------------------------------------------------------------------ canvas + library
const canvas = document.getElementById("view");
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
const space = new GameSpace(gl);
const U = createProgram(gl, space);
const post = new Post(gl, space.posId);
const audio = new Audio();
const aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");

function sizeCanvas() {
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = innerWidth * innerHeight * dpr * dpr;
    if (px > 3.2e6) dpr *= Math.sqrt(3.2e6 / px);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    post.resize(canvas.width, canvas.height);
}
sizeCanvas();
addEventListener("resize", () => { sizeCanvas(); fitCamera(false); });

// ------------------------------------------------------------------ save data
const DEFAULT_SAVE = { layouts: {}, settings: { theme: "jade", volume: 0.8, highlightFree: true, showIndex: false }, last: "garden" };
const save = (() => {
    try { const s = JSON.parse(localStorage.getItem("jadepavilion.save")); return s ? { ...DEFAULT_SAVE, ...s, settings: { ...DEFAULT_SAVE.settings, ...s.settings } } : structuredClone(DEFAULT_SAVE); }
    catch { return structuredClone(DEFAULT_SAVE); }
})();
const persist = () => { try { localStorage.setItem("jadepavilion.save", JSON.stringify(save)); } catch { } };
const rec = (id) => (save.layouts[id] ||= { best: 0, bestTime: 0, stars: 0, plays: 0, wins: 0 });
if (Q.has("theme") && THEMES[Q.get("theme")]) save.settings.theme = Q.get("theme");
audio.volume = save.settings.volume;

// ------------------------------------------------------------------ atlas texture
const atlasTex = gl.createTexture();
let atlasCanvas = null;
async function loadAtlas() {
    atlasCanvas = await buildAtlas(save.settings.showIndex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.activeTexture(gl.TEXTURE0);
}

// ------------------------------------------------------------------ static scene (per theme)
const stat = new Mesh(120000);
let statSolid = 0, statAdd = 0, theme = THEMES[save.settings.theme] || THEMES.jade, teapot = [0, 0, 0];
function buildStatic() {
    theme = THEMES[save.settings.theme] || THEMES.jade;
    const S = new Mesh(100000), A = new Mesh(2000);
    teapot = buildScene(S, A, theme).teapot;
    stat.reset(); stat.append(S); stat.append(A);
    statSolid = S.n; statAdd = A.n;
    space.setStatic(stat.pos, stat.col, stat.n);
}

// ------------------------------------------------------------------ game state
let state = "loading";               // loading | title | play | paused | won | stuck
let L = LAYOUTS.find((l) => l.id === (Q.get("layout") || save.last)) || LAYOUTS[0];
let nb = [], tiles = [], present = [], selected = -1, hover = -1, hintPair = null, hintT = 0;
let history = [], freeSet = new Set(), avail = { pairs: [], count: 0 };
let time = 0, elapsed = 0, score = 0, combo = 0, lastMatchT = -99, bestCombo = 1, hintsLeft = HINTS, shufflesLeft = SHUFFLES, hintsUsed = 0, shufflesUsed = 0;
let blockedTips = 0, particles = [], dealT = 0, endT = 0, rng = mulberry32(1);
let B = bounds(L.tiles);

function worldOf(t) { return [(t.x - B.cx) * (TW + GAP), (B.cy - t.y) * (TD + GAP), t.z * TH]; }

function newGame(layout, seed = (Math.random() * 1e9) | 0) {
    L = layout; B = bounds(L.tiles);
    rng = mulberry32(seed);
    nb = neighbours(L.tiles);
    const { faces } = deal(L.tiles, nb, pairPool(rng), rng);
    tiles = L.tiles.map(([x, y, z], i) => {
        const t = { i, x, y, z, face: faces[i], lift: 0, glow: 0, shake: 0, enter: 0, fly: null, dim: 1 };
        [t.wx, t.wy, t.wz] = worldOf(t);
        t.drop = z * 0.22 + ((x + y * 0.7) / 30) + Math.random() * 0.08;
        return t;
    });
    present = tiles.map(() => true);
    selected = -1; hover = -1; hintPair = null; history = []; particles = particles.filter((p) => p.ambient);
    elapsed = 0; score = 0; combo = 0; lastMatchT = -99; bestCombo = 1; hintsLeft = HINTS; shufflesLeft = SHUFFLES; hintsUsed = 0; shufflesUsed = 0;
    dealT = 0; endT = 0;
    refresh();
    fitCamera(true);
    save.last = L.id; persist();
}

function refresh() {
    freeSet = new Set(freeTiles(nb, present));
    avail = availableMatches(nb, present, tiles.map((t) => t.face));
    ui.hud();
}
const left = () => present.reduce((a, p) => a + (p ? 1 : 0), 0);

// ------------------------------------------------------------------ actions
function clickTile(i) {
    if (state !== "play" || dealT < 0.6) return;
    const t = tiles[i];
    if (!freeSet.has(i)) {
        t.shake = 1; audio.blocked();
        if (blockedTips < 4) {
            blockedTips++;
            const covered = nb[i].above.some((j) => present[j]);
            ui.toast(covered ? "That tile is <b>covered</b> — clear the tiles on top first" : "That tile is <b>blocked</b> — its left or right side must be open");
        }
        return;
    }
    hintPair = hintPair && hintPair.includes(i) ? hintPair : null;
    if (selected === -1) { selected = i; audio.select(); return; }
    if (selected === i) { selected = -1; audio.clack(0.4); return; }
    if (matches(tiles[selected].face, t.face)) { removePair(selected, i); return; }
    tiles[selected].shake = 0.7; audio.mismatch();
    selected = i;
}

function removePair(a, b) {
    present[a] = false; present[b] = false;
    history.push([a, b]);
    selected = -1; hintPair = null;
    combo = time - lastMatchT < COMBO_WINDOW ? Math.min(8, combo + 1) : 1;
    lastMatchT = time; bestCombo = Math.max(bestCombo, combo);
    score += 10 * combo;
    audio.match(combo);
    const A = tiles[a], Bt = tiles[b];
    const mid = [(A.wx + Bt.wx) / 2, (A.wy + Bt.wy) / 2, Math.max(A.wz, Bt.wz) + 2.4];
    for (const [t, s] of [[A, -1], [Bt, 1]]) t.fly = { t: 0, from: [t.wx, t.wy, t.wz + t.lift], to: [mid[0] + s * 0.56, mid[1], mid[2]], spin: s };
    if (combo > 1) ui.combo(combo);
    refresh();
    setTimeout(checkEnd, 650 / SPEED);
}

function checkEnd() {
    if (state !== "play") return;
    if (left() === 0) return win();
    if (avail.count === 0) { state = "stuck"; audio.lose(); ui.nomoves(); }
}

function undo() {
    if (!history.length || (state !== "play" && state !== "stuck")) return;
    const [a, b] = history.pop();
    for (const i of [a, b]) { present[i] = true; tiles[i].fly = null; tiles[i].enter = 1; }
    score = Math.max(0, score - 20); combo = 0; selected = -1; hintPair = null;
    audio.clack(0.8);
    if (state === "stuck") { state = "play"; ui.show("hud"); }
    refresh();
}

function hint() {
    if (state !== "play" || hintsLeft <= 0) { if (hintsLeft <= 0) ui.toast("No hints left this game"); return; }
    if (!avail.pairs.length) return;
    const withSel = selected >= 0 ? avail.pairs.find((p) => p.includes(selected)) : null;
    hintPair = withSel || avail.pairs[Math.floor(Math.random() * avail.pairs.length)];
    hintT = 4; hintsLeft--; hintsUsed++; score = Math.max(0, score - 50);
    audio.hint(); ui.hud();
}

function shuffle() {
    if ((state !== "play" && state !== "stuck") || shufflesLeft <= 0) { if (shufflesLeft <= 0) ui.toast("No shuffles left this game"); return; }
    const faces = reshuffle(nb, present, tiles.map((t) => t.face), rng);
    if (!faces) { ui.toast("These tiles can't be rearranged — try <b>Undo</b>"); return; }
    tiles.forEach((t, i) => { if (present[i]) { t.face = faces[i]; t.enter = 0.6 + Math.random() * 0.3; } });
    shufflesLeft--; shufflesUsed++; score = Math.max(0, score - 100);
    selected = -1; hintPair = null;
    audio.shuffle();
    if (state === "stuck") { state = "play"; ui.show("hud"); }
    refresh();
    ui.toast("Tiles reshuffled — still solvable");
}

function win() {
    state = "won"; endT = 0;
    const secs = Math.round(elapsed);
    score += Math.max(0, L.par * 2 - secs) * 2;
    const stars = hintsUsed === 0 && shufflesUsed === 0 && secs <= L.par ? 3 : hintsUsed <= 1 && shufflesUsed === 0 ? 2 : 1;
    const r = rec(L.id);
    const newBest = score > r.best;
    r.best = Math.max(r.best, score); r.wins++; r.stars = Math.max(r.stars, stars);
    r.bestTime = r.bestTime ? Math.min(r.bestTime, secs) : secs;
    persist();
    audio.win();
    for (let k = 0; k < 160; k++) burst(0, 0, 3, 1, k % 3 ? [1.6, 1.15, 0.55] : theme.motes, 9, 3, 0.12);
    setTimeout(() => ui.win(stars, secs, newBest), 1300);
}

// ------------------------------------------------------------------ particles
function burst(x, y, z, n, col, speed, life, size) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, e = Math.random() * 1.2 - 0.2, s = speed * (0.35 + Math.random() * 0.65);
        particles.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(a) * Math.cos(e) * s, vz: Math.sin(e) * s + 1.5, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.8), c: col });
    }
}
const motes = Array.from({ length: 70 }, () => ({ x: (Math.random() - 0.5) * 34, y: (Math.random() - 0.5) * 26, z: Math.random() * 10, ph: Math.random() * 6.28, s: 0.5 + Math.random() }));

// ------------------------------------------------------------------ camera
const cam = { yaw: 0, pitch: 0.98, dist: 20, tYaw: 0, tPitch: 0.98, tDist: 20, fit: 20 };
const K = 1.9;                                                   // projection scale (≈ 28° half field of view)
function fitCamera(reset) {
    const aspect = canvas.width / canvas.height;
    const bw = (B.x1 - B.x0 + 1) * (TW + GAP), bd = (B.y1 - B.y0 + 1) * (TD + GAP), p = cam.tPitch;
    const dW = K * bw * 0.5 * 1.08;
    const dH = K * aspect * 0.5 * (bd * Math.sin(p) + (B.z1 + 1) * TH * Math.cos(p) + 1.2) * (aspect < 1 ? 1.2 : 1.22);
    cam.fit = Math.max(dW, dH, 9);
    if (reset) { cam.tYaw = 0; cam.tPitch = 0.98; cam.tDist = cam.fit; }
    else cam.tDist = clamp(cam.tDist, cam.fit * 0.45, cam.fit * 1.6);
}
function updateCamera(dt) {
    const f = 1 - Math.exp(-dt * 8);
    cam.yaw += (cam.tYaw - cam.yaw) * f; cam.pitch += (cam.tPitch - cam.pitch) * f; cam.dist += (cam.tDist - cam.dist) * f;
    space.magnifier = K * 1.6;
    let yaw = cam.yaw, tx = 0, pitch = cam.pitch, dist = cam.dist;
    const tz = (B.z1 * TH) * 0.35;
    if (state === "title" || state === "loading") {
        // a lower, wider shot on the title so the pavilion shows; the board sits right of the text column
        yaw += Math.sin(time * 0.09) * 0.3; pitch = 0.62; dist = Math.max(cam.fit, 16) * 1.25;
        if (innerWidth > 900) tx = -Math.max(5, (B.x1 - B.x0 + 1) * (TW + GAP) * 0.5);
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ty = -0.35;
    space.lookAt(tx + dist * cp * Math.sin(yaw), ty - dist * cp * Math.cos(yaw), tz + dist * sp, tx, ty, tz);
}

// ------------------------------------------------------------------ input
function ray(sx, sy) {
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2, aspect = canvas.width / canvas.height, k = 1.6 / space.magnifier;
    const X = space.xUnitVec, Y = space.yUnitVec, Z = space.zUnitVec;
    return { o: [space.Xc, space.Yc, space.Zc], d: [0, 1, 2].map((i) => Z[i] - X[i] * nx * k + Y[i] * ny * k / aspect) };
}
function pick(sx, sy) {
    const { o, d } = ray(sx, sy);
    let best = -1, bt = 1e9;
    for (const t of tiles) {
        if (!present[t.i]) continue;
        const z0 = t.wz + t.lift;
        const lo = [t.wx - TW / 2, t.wy - TD / 2, z0], hi = [t.wx + TW / 2, t.wy + TD / 2, z0 + TH];
        let tmin = 0, tmax = 1e9, ok = true;
        for (let a = 0; a < 3 && ok; a++) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; continue; }
            let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
            if (t1 > t2) [t1, t2] = [t2, t1];
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) ok = false;
        }
        if (ok && tmin < bt) { bt = tmin; best = t.i; }
    }
    return best;
}
const ptrs = new Map();
let drag = null, pinch = null;
canvas.addEventListener("pointerdown", (e) => {
    audio.init();
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.tDist }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch, moved: false };
});
canvas.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        cam.tDist = clamp(pinch.dist * (pinch.d / Math.max(d, 1)), cam.fit * 0.45, cam.fit * 1.6); return;
    }
    if (drag && (state === "play" || state === "stuck")) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 7) { drag.moved = true; canvas.classList.add("drag"); }
        if (drag.moved) { cam.tYaw = clamp(drag.yaw - dx * 0.006, -0.95, 0.95); cam.tPitch = clamp(drag.pitch + dy * 0.005, 0.5, 1.4); }
    }
    if (!drag && state === "play") {
        const h = pick(e.clientX, e.clientY);
        hover = h;
        canvas.classList.toggle("point", h >= 0 && freeSet.has(h));
    }
});
const endPtr = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === "pointerup" && state === "play") { const i = pick(e.clientX, e.clientY); if (i >= 0) clickTile(i); else if (selected >= 0) { selected = -1; } }
    drag = null; canvas.classList.remove("drag");
};
canvas.addEventListener("pointerup", endPtr);
canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("pointerleave", () => { hover = -1; });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.tDist = clamp(cam.tDist * Math.exp(e.deltaY * 0.0012), cam.fit * 0.45, cam.fit * 1.6); }, { passive: false });
canvas.addEventListener("dblclick", () => fitCamera(true));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

addEventListener("keydown", (e) => {
    audio.init();
    const k = e.code;
    if (k === "KeyM") { const v = audio.volume > 0 ? 0 : save.settings.volume || 0.8; audio.setVolume(v); ui.toast(v ? "Sound on" : "Sound off"); return; }
    if (k === "Escape") { if (ui.open && ui.open !== "m-nomoves" && ui.open !== "m-win") { ui.closeModal(); return; } }
    if ((k === "KeyP" || k === "Escape") && (state === "play" || state === "paused")) { togglePause(); return; }
    if (state !== "play" && state !== "stuck") return;
    if (k === "KeyU" || (k === "KeyZ" && (e.ctrlKey || e.metaKey))) undo();
    else if (k === "KeyH") hint();
    else if (k === "KeyS") shuffle();
    else if (k === "KeyR") fitCamera(true);
});
addEventListener("blur", () => { if (state === "play") togglePause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") togglePause(); });

function togglePause() {
    if (state === "play") { state = "paused"; ui.modal("m-pause"); $("mp-sub").textContent = `${left()} tiles left · ${fmtTime(elapsed)} on the clock`; }
    else if (state === "paused") { state = "play"; ui.closeModal(); }
}

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt;
    if (state === "play") { dealT += dt; if (dealT > 1.2) elapsed += dt; }
    if (state === "title") dealT += dt;
    if (state === "won") endT += dt;
    hintT = Math.max(0, hintT - dt); if (hintT === 0) hintPair = null;
    if (combo > 1 && time - lastMatchT > COMBO_WINDOW) { combo = 0; ui.combo(0); }
    for (const t of tiles) {
        const want = !present[t.i] ? 0 : t.i === selected ? 0.18 : t.i === hover && freeSet.has(t.i) && state === "play" ? 0.06 : 0;
        t.lift += (want - t.lift) * Math.min(1, dt * 14);
        t.glow += ((t.i === selected ? 1 : t.i === hover && freeSet.has(t.i) && state === "play" ? 0.22 : 0) - t.glow) * Math.min(1, dt * 12);
        const dimWant = save.settings.highlightFree && state === "play" && present[t.i] && !freeSet.has(t.i) ? 0.62 : 1;
        t.dim += (dimWant - t.dim) * Math.min(1, dt * 6);
        t.shake = Math.max(0, t.shake - dt * 3);
        t.enter = Math.max(0, t.enter - dt * 2.6);
        if (t.fly) {
            t.fly.t += dt / 0.6;
            if (t.fly.t >= 1 && !t.fly.done) {
                t.fly.done = true;
                if (t.fly.spin < 0) {
                    const [x, y, z] = t.fly.to;
                    burst(x + 0.56, y, z + 0.4, 26, [1.5, 1.1, 0.5], 4, 1.1, 0.09);
                    burst(x + 0.56, y, z + 0.4, 10, theme.motes, 2.5, 1.6, 0.14);
                }
            }
        }
    }
    for (const p of particles) {
        if (p.ambient) continue;
        const k = Math.exp(-dt * 1.6);
        p.vx *= k; p.vy *= k; p.vz = p.vz * k - 2.2 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    if (state === "play") ui.tick();
}

// ------------------------------------------------------------------ rendering
const dyn = new Mesh(60000), shadows = new Mesh(8000), dynAdd = new Mesh(20000);
const lightBuf = new Float32Array(24), lightColBuf = new Float32Array(18);
const IVORY = [0.93, 0.89, 0.8];

function drawTile(S, Sh, A, t) {
    let x = t.wx, y = t.wy, z = t.wz + t.lift, rot = 0, scale = 1;
    if (!present[t.i] && t.fly) {
        const f = Math.min(1, t.fly.t), e = 1 - Math.pow(1 - f, 3);
        x = lerp(t.fly.from[0], t.fly.to[0], e); y = lerp(t.fly.from[1], t.fly.to[1], e);
        z = lerp(t.fly.from[2], t.fly.to[2], e) + Math.sin(f * Math.PI) * 0.6;
        rot = t.fly.spin * f * 0.5;
        if (t.fly.t > 1) scale = Math.max(0, 1 - (t.fly.t - 1) * 3.2);
        if (scale <= 0) return;
    }
    if (state === "title" || (state === "play" && dealT < 2.5)) {
        const d = clamp((dealT - t.drop) / 0.38, 0, 1);
        z += (1 - d) * (1 - d) * 7;
        if (d <= 0) return;
    }
    z += t.enter * t.enter * 3;
    if (t.shake > 0) x += Math.sin(t.shake * 40) * t.shake * 0.08;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (lx, ly, lz) => [x + (lx * cr - ly * sr) * scale, y + (lx * sr + ly * cr) * scale, z + lz * scale];
    const w = TW / 2, d = TD / 2, ch = 0.07, hb = 0.36, h2 = TH - ch;
    const g = t.glow, dim = t.dim;
    const back = theme.back.map((v) => v * dim), ivory = IVORY.map((v, k) => v * dim + g * [0.3, 0.2, 0.02][k]);
    const backLo = back.map((v) => v * 0.55), ivLo = ivory.map((v) => v * 0.82);
    const sides = [[[-w, -d], [w, -d]], [[w, -d], [w, d]], [[w, d], [-w, d]], [[-w, d], [-w, -d]]];
    for (const [[ax, ay], [bx, by]] of sides) {
        S.quad4(P(ax, ay, 0), P(bx, by, 0), P(bx, by, hb), P(ax, ay, hb), backLo, backLo, back, back, MAT.GLOSS);
        S.quad4(P(ax, ay, hb), P(bx, by, hb), P(bx, by, h2), P(ax, ay, h2), ivLo, ivLo, ivory, ivory, MAT.GLOSS);
        const ia = [ax - Math.sign(ax) * ch, ay - Math.sign(ay) * ch], ib = [bx - Math.sign(bx) * ch, by - Math.sign(by) * ch];
        S.quad(P(ax, ay, h2), P(bx, by, h2), P(ib[0], ib[1], TH), P(ia[0], ia[1], TH), ivory, MAT.GLOSS);
    }
    S.quad(P(-w, -d, 0), P(-w, d, 0), P(w, d, 0), P(w, -d, 0), backLo, MAT.GLOSS);
    // the carved face
    const [u0, v0, du, dv] = faceUV(t.face), e = 3 / 2048;
    const hintOn = hintPair && hintPair.includes(t.i) ? 2 : 0;
    const fd = dim + hintOn, fw = w - ch, fh = d - ch;
    const c = (u, v) => [u, v, fd];
    S.quad4([...P(-fw, fh, TH), g], [...P(fw, fh, TH), g], [...P(fw, -fh, TH), g], [...P(-fw, -fh, TH), g],
        c(u0 + e, v0 + e), c(u0 + du - e, v0 + e), c(u0 + du - e, v0 + dv - e), c(u0 + e, v0 + dv - e), MAT.FACE);
    // gold rim when selected, jade pulse when hinted
    if (g > 0.4 || hintOn) {
        const k = hintOn ? 0.5 + 0.5 * Math.sin(time * 6) : g * (0.75 + 0.25 * Math.sin(time * 5));
        const rc = hintOn ? [0.15 * k, 0.75 * k, 0.45 * k] : [0.9 * k, 0.62 * k, 0.2 * k];
        // a thin glowing ring just outside the top edge, and a faint glow down the sides
        const ring = (o) => [[-w - o, -d - o], [w + o, -d - o], [w + o, d + o], [-w - o, d + o]];
        const inn = ring(0.01), out = ring(0.075);
        for (let s = 0; s < 4; s++) {
            const s2 = (s + 1) % 4;
            A.quad(P(...inn[s], TH + 0.005), P(...inn[s2], TH + 0.005), P(...out[s2], TH + 0.005), P(...out[s], TH + 0.005), rc, MAT.ADD);
            A.quad(P(...inn[s], 0.05), P(...inn[s2], 0.05), P(...inn[s2], TH), P(...inn[s], TH), rc.map((v) => v * 0.18), MAT.ADD);
        }
        A.sprite(x, y - 0.2, z + TH + 0.2, 1.3, rc[0] * 0.25, rc[1] * 0.25, rc[2] * 0.25);
    }
    // soft contact shadow on whatever is below
    if (present[t.i] && scale === 1) {
        const sx = x + 0.1, sy = y - 0.12, sz = t.wz + 0.004, s = 0.32 + t.lift * 1.5;
        const strength = 0.5 - t.lift * 0.8;
        Sh.v(sx - w - s, sy - d - s, sz, 0 * 2 + 0, strength, 0, 0, MAT.SHADOW); Sh.v(sx + w + s, sy - d - s, sz, 1 * 2 + 0, strength, 0, 0, MAT.SHADOW); Sh.v(sx + w + s, sy + d + s, sz, 1 * 2 + 1, strength, 0, 0, MAT.SHADOW);
        Sh.v(sx - w - s, sy - d - s, sz, 0 * 2 + 0, strength, 0, 0, MAT.SHADOW); Sh.v(sx + w + s, sy + d + s, sz, 1 * 2 + 1, strength, 0, 0, MAT.SHADOW); Sh.v(sx - w - s, sy + d + s, sz, 0 * 2 + 1, strength, 0, 0, MAT.SHADOW);
    }
}

function buildDynamic() {
    const S = dyn, A = dynAdd, Sh = shadows;
    S.reset(); A.reset(); Sh.reset();
    S.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 0], MAT.BG);
    for (const t of tiles) if (present[t.i] || (t.fly && !(t.fly.t > 1.4))) drawTile(S, Sh, A, t);
    const lights = [];
    for (const l of LANTERNS) lights.push({ p: drawLantern(S, A, l, theme, time), s: 2.6 * l.s, c: theme.paper.map((v) => v / 1.4) });
    // drifting motes / petals / fireflies
    for (const m of motes) {
        const x = m.x + Math.sin(time * 0.2 + m.ph) * 1.5, y = m.y + Math.cos(time * 0.17 + m.ph) * 1.2, z = ((m.z - time * 0.25 * m.s) % 10 + 10) % 10 + 0.5;
        if (save.settings.theme === "sakura") {
            const a = time * 1.5 + m.ph, s = 0.09;
            S.tri([x, y, z], [x + Math.cos(a) * s, y + Math.sin(a) * s * 0.6, z + 0.03], [x + Math.cos(a + 1.3) * s, y, z + Math.sin(a) * s], [1.0, 0.68, 0.76], MAT.MATTE);
        } else {
            const k = save.settings.theme === "midnight" ? Math.max(0, Math.sin(time * 1.2 + m.ph * 3)) ** 3 : 0.35;
            A.sprite(x, y, z, 0.05 + k * 0.03, theme.motes[0] * k * 0.6, theme.motes[1] * k * 0.6, theme.motes[2] * k * 0.6);
        }
    }
    // steam from the teapot spout
    for (let i = 0; i < 9; i++) {
        const f = ((time * 0.25 + i / 9) % 1), x = teapot[0] + Math.sin(f * 7 + i) * 0.25 * f, z = teapot[2] + f * 2.6;
        const k = Math.sin(f * Math.PI) * 0.05;
        A.sprite(x, teapot[1], z, 0.25 + f * 0.6, k, k, k * 0.95);
    }
    for (const p of particles) {
        const k = Math.min(1, (p.life / p.max) * 1.6);
        A.sprite(p.x, p.y, p.z, p.size * (0.6 + 0.4 * k), p.c[0] * k, p.c[1] * k, p.c[2] * k);
    }
    const sN = S.n, shN = Sh.n;
    S.append(Sh); S.append(A);
    space.setDynamic(S.pos, S.col, S.n);
    return { sN, shN, aN: A.n, lights };
}

function render() {
    const { sN, shN, aN, lights } = buildDynamic();
    const aspect = canvas.width / canvas.height;
    const n = Math.min(6, lights.length);
    lights.sort((a, b) => Math.hypot(a.p[0], a.p[1]) - Math.hypot(b.p[0], b.p[1]));
    for (let i = 0; i < n; i++) { lightBuf.set([...lights[i].p, lights[i].s * (state === "won" ? 1.4 : 1)], i * 4); lightColBuf.set(lights[i].c, i * 3); }

    post.begin();
    gl.useProgram(U.program);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.aspect, aspect);
    gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1i(U.uAtlas, 3);
    gl.uniform4fv(U.uLights, lightBuf); gl.uniform3fv(U.uLightCol, lightColBuf); gl.uniform1f(U.uLightCount, n);
    const kd = theme.keyDir, kl = Math.hypot(...kd);
    gl.uniform3f(U.uKeyDir, kd[0] / kl, kd[1] / kl, kd[2] / kl);
    gl.uniform3fv(U.uKeyCol, theme.keyCol); gl.uniform3fv(U.uAmb, theme.amb);
    gl.uniform3fv(U.uBgTop, theme.bgTop); gl.uniform3fv(U.uBgBot, theme.bgBot); gl.uniform3fv(U.uFog, theme.fog);
    space.applyCamera();

    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    space.bind(true); space.draw(0, 6);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    space.bind(false); space.draw(0, statSolid);
    space.bind(true); space.draw(6, sN - 6);
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    space.draw(sN, shN);
    gl.blendFunc(gl.ONE, gl.ONE);
    space.bind(false); space.draw(statSolid, statAdd);
    space.bind(true); space.draw(sN + shN, aN);
    gl.disable(gl.BLEND); gl.depthMask(true);
    post.end({ time, under: 0, fade: 1, hurt: 0 });
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const MODALS = ["m-pause", "m-settings", "m-help", "m-nomoves", "m-win"];
const ui = {
    open: null, back: null, last: {},
    show(which) {
        $("title").classList.toggle("hidden", which !== "title");
        $("hud").classList.toggle("hidden", which !== "hud");
        document.body.dataset.state = which;
        if (which !== "modal") this.closeModal(true);
    },
    modal(id, back = null) {
        for (const m of MODALS) $(m).classList.toggle("hidden", m !== id);
        this.open = id; this.back = back;
        const first = $(id).querySelector(".btn.primary, .btn.jade, .btn");
        setTimeout(() => first?.focus({ preventScroll: true }), 50);
    },
    closeModal(silent) {
        const back = this.back;
        for (const m of MODALS) $(m).classList.add("hidden");
        this.open = null; this.back = null;
        if (!silent && back) back();
    },
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } },
    hud() {
        $("h-name").textContent = L.name; $("h-cn").textContent = L.cn;
        this.set("h-score", fmt(score));
        this.set("h-left", String(left()));
        this.set("h-pairs", String(avail.count));
        $("h-pairs-chip").classList.toggle("warn", avail.count <= 1 && left() > 0);
        $("h-progress").style.width = `${(1 - left() / L.tiles.length) * 100}%`;
        $("b-hint-n").textContent = hintsLeft; $("b-shuffle-n").textContent = shufflesLeft;
        $("b-hint").disabled = hintsLeft <= 0; $("b-shuffle").disabled = shufflesLeft <= 0; $("b-undo").disabled = !history.length;
        $("b-hint-n").classList.toggle("hidden", hintsLeft <= 0); $("b-shuffle-n").classList.toggle("hidden", shufflesLeft <= 0);
        this.tick();
    },
    tick() { this.set("h-time", fmtTime(elapsed)); },
    combo(c) {
        const el = $("h-combo");
        if (c > 1) { el.textContent = `×${c} combo`; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); }
        else el.classList.remove("on");
    },
    toast(html) {
        const el = $("toast"); el.innerHTML = html; el.classList.add("show");
        clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove("show"), 2200);
    },
    nomoves() {
        $("mn-left").textContent = left();
        $("mn-shuffle-n").textContent = shufflesLeft > 0 ? `(${shufflesLeft} left)` : "";
        $("mn-shuffle").disabled = shufflesLeft <= 0;
        $("mn-undo").disabled = !history.length;
        this.modal("m-nomoves");
    },
    win(stars, secs, newBest) {
        $("mw-title").textContent = L.name;
        $("mw-stars").innerHTML = [0, 1, 2].map((i) => `<b class="${i < stars ? "on" : ""}" style="animation-delay:${0.25 + i * 0.22}s">★</b>`).join("");
        $("mw-time").textContent = fmtTime(secs); $("mw-score").textContent = fmt(score);
        $("mw-combo").textContent = `×${bestCombo}`; $("mw-hints").textContent = hintsUsed + (shufflesUsed ? ` · ${shufflesUsed}⟳` : "");
        $("mw-msg").textContent = stars === 3 ? "Flawless — under par, no help needed." : stars === 2 ? `Beat ${fmtTime(L.par)} without hints or shuffles for three stars.` : "Fewer hints and no shuffles earn more stars.";
        $("mw-ribbon").classList.toggle("hidden", !newBest);
        const r = rec(L.id);
        $("mw-best").innerHTML = `Best score <b>${fmt(r.best)}</b> · fastest <b>${fmtTime(r.bestTime)}</b> · par ${fmtTime(L.par)}`;
        const next = LAYOUTS[(LAYOUTS.indexOf(L) + 1) % LAYOUTS.length];
        $("mw-next").textContent = `Next: ${next.name}`;
        this.modal("m-win");
    },
    gallery() {
        const g = $("gallery");
        g.innerHTML = LAYOUTS.map((l, i) => {
            const r = save.layouts[l.id] || {};
            return `<button class="card glass ${l.id === L.id ? "sel" : ""}" data-id="${l.id}" style="animation-delay:${0.08 * i + 0.2}s">
                <span class="wm">${l.cn}</span>
                <div class="pv">${previewSVG(l.tiles)}</div>
                <h3>${l.name} <span class="cn">${l.cn}</span></h3>
                <p>${l.desc}</p>
                <div class="meta"><span class="pips">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= l.difficulty ? "on" : ""}"></i>`).join("")}</span><span>${l.tiles.length} tiles</span></div>
                <div class="best"><span>${r.bestTime ? "Best " + fmtTime(r.bestTime) : "Not cleared yet"}</span><span class="stars">${[0, 1, 2].map((k) => (k < (r.stars || 0) ? "<b>★</b>" : "★")).join("")}</span></div>
            </button>`;
        }).join("");
        g.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => {
            const l = LAYOUTS.find((x) => x.id === c.dataset.id);
            if (l.id === L.id) { start(); return; }
            g.querySelectorAll(".card").forEach((x) => x.classList.toggle("sel", x === c));
            audio.init(); audio.select();
            newGame(l); state = "title";
            this.titleNote();
        }));
        this.titleNote();
    },
    titleNote() {
        $("t-play-name").textContent = L.name;
        const r = save.layouts[L.id];
        $("t-note").innerHTML = r && r.wins ? `<b>${L.name}</b> · cleared ${r.wins}× · best ${fmtTime(r.bestTime)} · ${"★".repeat(r.stars)}` : `<b>${L.name}</b> · ${L.tiles.length} tiles · par ${fmtTime(L.par)} · every deal is solvable`;
    },
    settings() {
        $("themes").innerHTML = Object.entries(THEMES).map(([id, t]) => `<button class="theme ${id === save.settings.theme ? "sel" : ""}" data-id="${id}"><span class="mini" style="background:${t.swatch[0]};--face:${t.swatch[1]}"></span>${t.name}</button>`).join("");
        $("themes").querySelectorAll(".theme").forEach((b) => b.addEventListener("click", () => {
            save.settings.theme = b.dataset.id; persist(); buildStatic(); this.settings(); audio.select();
        }));
        $("s-free").setAttribute("aria-checked", save.settings.highlightFree);
        $("s-index").setAttribute("aria-checked", save.settings.showIndex);
        $("s-vol").value = Math.round(save.settings.volume * 100);
        $("s-vol").style.setProperty("--v", `${save.settings.volume * 100}%`);
    },
    help() {
        const box = $("help-tiles");
        if (atlasCanvas && !box.children.length) for (const f of [4, 13, 22, 27, 31, 32, 34, 39]) box.appendChild(faceCanvas(atlasCanvas, f, 68));
        this.modal("m-help", this.open === "m-pause" ? () => ui.modal("m-pause") : null);
    },
};

function start(layout = L) {
    audio.init();
    newGame(layout, Q.has("seed") ? +Q.get("seed") : undefined);
    rec(L.id).plays++; persist();
    state = "play"; dealT = 0;
    ui.show("hud"); ui.hud();
    audio.deal(L.tiles.length);
    if (!localStorage.getItem("jadepavilion.helped")) { try { localStorage.setItem("jadepavilion.helped", "1"); } catch { } setTimeout(() => ui.toast("Click two matching <b>free</b> tiles · drag to turn the table"), 1400); }
}
function toMenu() { state = "title"; ui.show("title"); ui.gallery(); newGame(L); }

$("t-play").addEventListener("click", () => start());
$("t-howto").addEventListener("click", () => ui.help());
$("t-help").addEventListener("click", () => ui.help());
$("t-settings").addEventListener("click", () => { ui.settings(); ui.modal("m-settings"); });
$("b-undo").addEventListener("click", undo);
$("b-hint").addEventListener("click", hint);
$("b-shuffle").addEventListener("click", shuffle);
$("b-pause").addEventListener("click", togglePause);
$("mp-resume").addEventListener("click", togglePause);
$("mp-restart").addEventListener("click", () => { state = "title"; dealT = 1; start(); });
$("mp-settings").addEventListener("click", () => { ui.settings(); ui.modal("m-settings", () => ui.modal("m-pause")); });
$("mp-menu").addEventListener("click", toMenu);
$("ms-close").addEventListener("click", () => ui.closeModal());
$("mh-close").addEventListener("click", () => ui.closeModal());
$("mh-ok").addEventListener("click", () => ui.closeModal());
$("s-free").addEventListener("click", (e) => { save.settings.highlightFree = !save.settings.highlightFree; persist(); e.currentTarget.setAttribute("aria-checked", save.settings.highlightFree); });
$("s-index").addEventListener("click", async (e) => { save.settings.showIndex = !save.settings.showIndex; persist(); e.currentTarget.setAttribute("aria-checked", save.settings.showIndex); $("help-tiles").innerHTML = ""; await loadAtlas(); });
$("s-vol").addEventListener("input", (e) => { const v = e.target.value / 100; save.settings.volume = v; persist(); audio.init(); audio.setVolume(v); e.target.style.setProperty("--v", `${v * 100}%`); });
$("s-vol").addEventListener("change", () => audio.select());
$("s-cam").addEventListener("click", () => fitCamera(true));
$("mn-shuffle").addEventListener("click", () => { ui.closeModal(true); shuffle(); });
$("mn-undo").addEventListener("click", () => { ui.closeModal(true); undo(); });
$("mn-new").addEventListener("click", () => { state = "title"; dealT = 1; start(); });
$("mw-menu").addEventListener("click", toMenu);
$("mw-replay").addEventListener("click", () => { state = "title"; dealT = 1; start(); });
$("mw-next").addEventListener("click", () => { state = "title"; start(LAYOUTS[(LAYOUTS.indexOf(L) + 1) % LAYOUTS.length]); });
for (const m of MODALS) $(m).addEventListener("pointerdown", (e) => { if (e.target === $(m) && (m === "m-settings" || m === "m-help")) ui.closeModal(); });

// ------------------------------------------------------------------ autoplay (demos / headless checks)
if (Q.has("autoplay")) {
    setInterval(() => {
        if (state !== "play" || dealT < 1.5) { if (state === "stuck") { if (shufflesLeft > 0) shuffle(); else undo(); } return; }
        if (selected >= 0) { const p = avail.pairs.find((q) => q.includes(selected)); if (p) { clickTile(p[0] === selected ? p[1] : p[0]); return; } }
        const p = avail.pairs[Math.floor(Math.random() * avail.pairs.length)];
        if (p) clickTile(p[0]);
    }, 260 / SPEED);
}

// ------------------------------------------------------------------ boot
window.__jade = () => ({ state, layout: L.id, left: left(), pairs: avail.count, score, time: +elapsed.toFixed(1), hintsLeft, shufflesLeft, theme: save.settings.theme, post: post.ok, fps: fpsNow, selected });
let last = performance.now(), fpsNow = 0, fpsN = 0, fpsT = 0;
function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    fpsN++; fpsT += (now - last) / 1000; if (fpsT > 1) { fpsNow = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    last = now;
    if (state !== "paused") for (let s = 0; s < SPEED; s++) update(dt);
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}

(async function boot() {
    buildStatic();
    newGame(L, Q.has("seed") ? +Q.get("seed") : undefined);
    requestAnimationFrame(frame);
    await loadAtlas();
    $("loading").classList.add("out");
    state = "title"; dealT = 0;
    ui.show("title"); ui.gallery();
    if (Q.has("layout") || Q.has("autoplay")) start();
})();
