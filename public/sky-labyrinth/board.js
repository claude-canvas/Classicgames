// Sky Labyrinth tablet geometry, in board-local coordinates (DESIGN.md §2, §4).
//  buildBoard(L, isle, O, A) → static opaque (O) + additive (A) meshes for one level
//  heightData(L, sim, gateH) → RGBA bytes for the wall-height texture the floor shader ray-marches
//  the moving pieces (marble, gems, gates, crumble tiles, glows) are drawn every frame by drawDynamic()

import { MAT, tube, limb, blob, mulberry32, mixc, lerp, clamp } from "./mesh.js";
import { R, HOLE_R, WALL_H, BUMP_R, CRUMBLE_T } from "./physics.js";

export const SLAB = 0.5, BEVEL = 0.07;
const TAU = Math.PI * 2;
const isWall = (k) => k === "#";
const isVoid = (k) => k === " " || k === undefined;

export function buildBoard(L, isle, O, A) {
    const { W, H, cells } = L;
    const at = (c, r) => (r < 0 || r >= H || c < 0 || c >= W ? " " : cells[r][c]);
    const stone = isle.stone, wallC = isle.wall, trim = isle.trim;
    const top = mixc(wallC, [1, 0.95, 0.9], 0.22);
    const rnd = mulberry32(L.W * 131 + L.H * 7 + L.cells.flat().join("").length);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const k = at(c, r), [x, y] = L.xy(c, r);
        if (isVoid(k) || k === "x") continue;
        const x0 = x - 0.5, x1 = x + 0.5, y0 = y - 0.5, y1 = y + 0.5;
        // slab sides toward void (incl. crumble tiles, which can disappear) + gold trim + underside
        for (const [dc, dr, a, b] of [[-1, 0, [x0, y1], [x0, y0]], [1, 0, [x1, y0], [x1, y1]], [0, -1, [x0, y1], [x1, y1]], [0, 1, [x1, y0], [x0, y0]]]) {
            const n = at(c + dc, r + dr);
            if (!(isVoid(n) || n === "x")) continue;
            O.quad([a[0], a[1], -0.09], [b[0], b[1], -0.09], [b[0], b[1], 0], [a[0], a[1], 0], trim, MAT.GOLD);
            O.quad([a[0], a[1], -SLAB], [b[0], b[1], -SLAB], [b[0], b[1], -0.09], [a[0], a[1], -0.09], mixc(wallC, [0.3, 0.25, 0.3], 0.35), 1);
        }
        O.quad([x0, y0, -SLAB], [x0, y1, -SLAB], [x1, y1, -SLAB], [x1, y0, -SLAB], mixc(wallC, [0.2, 0.15, 0.2], 0.5), MAT.MATTE);
        if (isWall(k)) { wall(O, L, c, r, at, top, wallC, trim); continue; }
        // floor
        if (k === "O") { holeCell(O, x, y, stone, trim); continue; }
        if (k === "G") { goalCell(O, A, x, y, stone, trim); continue; }
        if (k === "~") { O.quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0.62, 0.8, 0.95], MAT.ICE); continue; }
        const st = k === ":" ? 1 : 0;
        const col = k === ":" ? [0.42, 0.62, 0.26] : stone;
        floorQuad(O, x0, y0, x1, y1, col, st);
        if (k === "k") { tube(O, x, y, 20, 0.33, 0, 0.33, 0.035, trim, MAT.GOLD, 0, true); tube(O, x, y, 20, 0.22, 0.035, 0.2, 0.05, mixc(trim, [1, 1, 1], 0.2), MAT.GOLD, 0, true); }
        if (k === "b") bumperBase(O, x, y, trim, rnd);
        if (k === "c") { for (let i = 0; i < 12; i++) { const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU; O.quad([x + Math.cos(a0) * 0.3, y + Math.sin(a0) * 0.3, 0.004], [x + Math.cos(a1) * 0.3, y + Math.sin(a1) * 0.3, 0.004], [x + Math.cos(a1) * 0.36, y + Math.sin(a1) * 0.36, 0.004], [x + Math.cos(a0) * 0.36, y + Math.sin(a0) * 0.36, 0.004], trim, MAT.GOLD); } }
    }
    underside(O, A, L, isle, rnd);
}

function floorQuad(O, x0, y0, x1, y1, col, st) {
    O.v(x0, y0, 0, st, col[0], col[1], col[2], MAT.FLOOR); O.v(x1, y0, 0, st, col[0], col[1], col[2], MAT.FLOOR); O.v(x1, y1, 0, st, col[0], col[1], col[2], MAT.FLOOR);
    O.v(x0, y0, 0, st, col[0], col[1], col[2], MAT.FLOOR); O.v(x1, y1, 0, st, col[0], col[1], col[2], MAT.FLOOR); O.v(x0, y1, 0, st, col[0], col[1], col[2], MAT.FLOOR);
}

function wall(O, L, c, r, at, top, side, trim) {
    const [x, y] = L.xy(c, r), h = WALL_H, b = BEVEL;
    const wl = isWall(at(c - 1, r)), wr = isWall(at(c + 1, r)), wd = isWall(at(c, r + 1)), wu = isWall(at(c, r - 1));
    // top: inset on open sides
    const tx0 = x - 0.5 + (wl ? 0 : b), tx1 = x + 0.5 - (wr ? 0 : b), ty0 = y - 0.5 + (wd ? 0 : b), ty1 = y + 0.5 - (wu ? 0 : b);
    const v = (px, py, pz, col, mat, w = 1) => O.v(px, py, pz, w, col[0], col[1], col[2], mat);
    const q = (a, bb, cc, d, col, mat, w = 1) => { for (const p of [a, bb, cc, a, cc, d]) v(p[0], p[1], p[2], col, mat, w); };
    q([tx0, ty0, h], [tx1, ty0, h], [tx1, ty1, h], [tx0, ty1, h], top, MAT.MATTE);
    // gold chamfers (mitred trapezoids) on open sides
    const bx0 = x - 0.5, bx1 = x + 0.5, by0 = y - 0.5, by1 = y + 0.5;
    if (!wl) q([bx0, wd ? ty0 : by0, h - b], [tx0, ty0, h], [tx0, ty1, h], [bx0, wu ? ty1 : by1, h - b], trim, MAT.GOLD, 0);
    if (!wr) q([bx1, wu ? ty1 : by1, h - b], [tx1, ty1, h], [tx1, ty0, h], [bx1, wd ? ty0 : by0, h - b], trim, MAT.GOLD, 0);
    if (!wd) q([wr ? tx1 : bx1, by0, h - b], [tx1, ty0, h], [tx0, ty0, h], [wl ? tx0 : bx0, by0, h - b], trim, MAT.GOLD, 0);
    if (!wu) q([wl ? tx0 : bx0, by1, h - b], [tx0, ty1, h], [tx1, ty1, h], [wr ? tx1 : bx1, by1, h - b], trim, MAT.GOLD, 0);
    // sides
    const zb = () => 0;
    if (!wl) { const n = at(c - 1, r); q([bx0, by1, zb(n)], [bx0, by0, zb(n)], [bx0, by0, h - b], [bx0, by1, h - b], side, MAT.MATTE); }
    if (!wr) { const n = at(c + 1, r); q([bx1, by0, zb(n)], [bx1, by1, zb(n)], [bx1, by1, h - b], [bx1, by0, h - b], side, MAT.MATTE); }
    if (!wd) { const n = at(c, r + 1); q([bx0, by0, zb(n)], [bx1, by0, zb(n)], [bx1, by0, h - b], [bx0, by0, h - b], side, MAT.MATTE); }
    if (!wu) { const n = at(c, r - 1); q([bx1, by1, zb(n)], [bx0, by1, zb(n)], [bx0, by1, h - b], [bx1, by1, h - b], side, MAT.MATTE); }
}

// square cell with a round opening: floor ring, gold lip, shaft, and a window onto the clouds at the bottom
function ringCell(O, x, y, rad, stone) {
    const n = 24;
    const sq = (a) => { const cs = Math.cos(a), sn = Math.sin(a), k = 0.5 / Math.max(Math.abs(cs), Math.abs(sn)); return [x + cs * k, y + sn * k]; };
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + TAU / 8, a1 = ((i + 1) / n) * TAU + TAU / 8;
        const s0 = sq(a0), s1 = sq(a1);
        // keep the square's corners: split at the corner angles (π/4 + k·π/2 are on the segment boundaries)
        const c0 = [x + Math.cos(a0) * rad, y + Math.sin(a0) * rad], c1 = [x + Math.cos(a1) * rad, y + Math.sin(a1) * rad];
        for (const p of [[c0[0], c0[1]], [s0[0], s0[1]], [s1[0], s1[1]], [c0[0], c0[1]], [s1[0], s1[1]], [c1[0], c1[1]]]) O.v(p[0], p[1], 0, 0, stone[0], stone[1], stone[2], MAT.FLOOR);
    }
}
function holeCell(O, x, y, stone, trim) {
    ringCell(O, x, y, HOLE_R, stone);
    const n = 24, dark = mixc(stone, [0.1, 0.08, 0.12], 0.6);
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        O.quad([x + c0 * HOLE_R, y + s0 * HOLE_R, 0.006], [x + c1 * HOLE_R, y + s1 * HOLE_R, 0.006], [x + c1 * (HOLE_R + 0.07), y + s1 * (HOLE_R + 0.07), 0.006], [x + c0 * (HOLE_R + 0.07), y + s0 * (HOLE_R + 0.07), 0.006], trim, MAT.GOLD);
        O.quad([x + c0 * HOLE_R, y + s0 * HOLE_R, -SLAB + 0.02], [x + c1 * HOLE_R, y + s1 * HOLE_R, -SLAB + 0.02], [x + c1 * HOLE_R, y + s1 * HOLE_R, 0.006], [x + c0 * HOLE_R, y + s0 * HOLE_R, 0.006], dark, MAT.HOLE);
        for (const p of [[x, y], [x + c1 * HOLE_R, y + s1 * HOLE_R], [x + c0 * HOLE_R, y + s0 * HOLE_R]]) O.v(p[0], p[1], -SLAB + 0.02, 1, 0, 0, 0, MAT.HOLE);
    }
}
function goalCell(O, A, x, y, stone, trim) {
    ringCell(O, x, y, 0.36, stone);
    const n = 28, dark = [0.25, 0.18, 0.1];
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const P = (c, s, r, z) => [x + c * r, y + s * r, z];
        O.quad(P(c0, s0, 0.46, 0), P(c1, s1, 0.46, 0), P(c1, s1, 0.43, 0.09), P(c0, s0, 0.43, 0.09), trim, MAT.GOLD);
        O.quad(P(c0, s0, 0.43, 0.09), P(c1, s1, 0.43, 0.09), P(c1, s1, 0.36, 0.09), P(c0, s0, 0.36, 0.09), trim, MAT.GOLD);
        O.quad(P(c0, s0, 0.36, 0.09), P(c1, s1, 0.36, 0.09), P(c1, s1, 0.36, -0.3), P(c0, s0, 0.36, -0.3), dark, MAT.HOLE);
        O.tri(P(c0, s0, 0.36, -0.3), P(c1, s1, 0.36, -0.3), [x, y, -0.3], [1.6, 1.15, 0.5], MAT.EMIT);
    }
    A.sprite(x, y, 0.05, 0.7, 0.25, 0.17, 0.06);
}
function bumperBase(O, x, y, trim, rnd) {
    tube(O, x, y, 16, BUMP_R + 0.04, 0, BUMP_R, 0.05, mixc(trim, [0.3, 0.2, 0.1], 0.4), MAT.GOLD, 0, false);
    tube(O, x, y, 16, BUMP_R, 0.05, BUMP_R, 0.3, trim, MAT.GOLD, 0, false);
    tube(O, x, y, 16, BUMP_R, 0.3, BUMP_R * 0.7, 0.38, mixc(trim, [1, 1, 1], 0.25), MAT.GOLD, 0, false);
    tube(O, x, y, 16, BUMP_R * 0.7, 0.38, 0, 0.44, mixc(trim, [1, 1, 1], 0.4), MAT.GOLD, 0, false);
}

// the tablet floats on a chunk of rock with hanging roots and crystals
function underside(O, A, L, isle, rnd) {
    let sx = 0, sy = 0, n = 0, maxR = 0;
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) if (!isVoid(L.cells[r][c])) { const [x, y] = L.xy(c, r); sx += x; sy += y; n++; }
    const cx = sx / n, cy = sy / n;
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) if (!isVoid(L.cells[r][c])) { const [x, y] = L.xy(c, r); maxR = Math.max(maxR, Math.hypot(x - cx, (y - cy) * 1.3)); }
    const rx = Math.min(L.W * 0.36, maxR * 0.75), ry = Math.min(L.H * 0.36, maxR * 0.6);
    const rock = mixc(isle.wall, [0.35, 0.3, 0.32], 0.55), rock2 = mixc(rock, [0.15, 0.12, 0.15], 0.5);
    const seg = 28, rings = 9, depth = Math.max(5, maxR * 0.8);
    const noise = [];
    for (let j = 0; j <= rings; j++) { noise.push([]); for (let i = 0; i < seg; i++) noise[j].push(0.8 + rnd() * 0.4); }
    const P = (i, j) => {
        const t = j / rings, a = (i % seg) / seg * TAU;
        const k = Math.pow(1 - t, 1.5) * noise[j][i % seg] * (j === 0 ? 1.05 : 1);
        return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, -SLAB - 0.05 - t * depth + (j === 0 ? 0 : (noise[j][(i + 3) % seg] - 1) * 0.6)];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const col = mixc(rock, rock2, j / rings + (noise[j][i] - 1));
        O.v(...P(i, j), 2, ...col, MAT.MATTE); O.v(...P(i + 1, j), 2, ...col, MAT.MATTE); O.v(...P(i + 1, j + 1), 2, ...col, MAT.MATTE);
        O.v(...P(i, j), 2, ...col, MAT.MATTE); O.v(...P(i + 1, j + 1), 2, ...col, MAT.MATTE); O.v(...P(i, j + 1), 2, ...col, MAT.MATTE);
    }
    // hanging roots and glowing crystals
    for (let i = 0; i < 9; i++) {
        const a = rnd() * TAU, rr = 0.4 + rnd() * 0.45, x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr, z = -SLAB - 0.3 - rnd() * 0.8;
        const len = 1 + rnd() * 2.2;
        limb(O, [x, y, z + 0.4], [x + (rnd() - 0.5) * 0.5, y + (rnd() - 0.5) * 0.5, z - len], 0.07, 0.01, [0.32, 0.26, 0.2], MAT.MATTE, 4);
    }
    for (let i = 0; i < 5; i++) {
        const a = rnd() * TAU, rr = 0.15 + rnd() * 0.35, x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr, z = -SLAB - 1.4 - rnd() * depth * 0.4;
        const col = mixc(isle.trim, [0.6, 0.9, 1.0], 0.5);
        crystal(O, x, y, z, 0.25 + rnd() * 0.3, col, true);
        A.sprite(x, y, z - 0.2, 1.6, col[0] * 0.25, col[1] * 0.25, col[2] * 0.25);
    }
}

// a hexagonal bipyramid crystal; down = hanging
export function crystal(M, x, y, z, s, col, down = false, rot = 0) {
    const n = 6, hTop = s * 1.6, hBot = s * 0.9, d = down ? -1 : 1;
    for (let i = 0; i < n; i++) {
        const a0 = rot + (i / n) * TAU, a1 = rot + ((i + 1) / n) * TAU;
        const p0 = [x + Math.cos(a0) * s * 0.55, y + Math.sin(a0) * s * 0.55, z], p1 = [x + Math.cos(a1) * s * 0.55, y + Math.sin(a1) * s * 0.55, z];
        M.tri(p0, p1, [x, y, z + hTop * d], mixc(col, [1, 1, 1], (i % 2) * 0.12), MAT.GEM);
        M.tri(p1, p0, [x, y, z - hBot * d], mixc(col, [0, 0, 0], 0.15 + (i % 2) * 0.1), MAT.GEM);
    }
}

// RGBA texture: R = occupancy, G = top height
export function heightData(L, sim, gateH) {
    const d = new Uint8Array(L.W * L.H * 4);
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
        const k = L.cells[r][c], o = (r * L.W + c) * 4;
        if (k === "#") { d[o] = 255; d[o + 1] = Math.round(WALL_H * 255); }
        else if (k === "=" && gateH > 0.02) { d[o] = 255; d[o + 1] = Math.round(0.5 * gateH * 255); }
        d[o + 3] = 255;
    }
    return d;
}

// ------------------------------------------------------------------ per-frame pieces (board-local)
export function drawDynamic(D, Sh, A, L, sim, isle, s) {
    const t = s.time;
    // crumble tiles
    L.crumbles.forEach((o, i) => {
        const st = sim.crumble[i], fallT = s.crumbleFall[i] || 0;
        if (st.broken && fallT > 1.4) return;
        let dx = 0, dy = 0, dz = 0;
        if (st.t >= 0 && !st.broken) { const k = st.t / CRUMBLE_T; dx = Math.sin(t * 60 + i) * 0.02 * k; dy = Math.cos(t * 53 + i) * 0.02 * k; }
        if (st.broken) dz = -fallT * fallT * 6;
        const x0 = o.x - 0.5 + dx, x1 = o.x + 0.5 + dx, y0 = o.y - 0.5 + dy, y1 = o.y + 0.5 + dy, z1 = dz, z0 = dz - 0.32;
        const col = mixc(isle.stone, [0.45, 0.32, 0.28], 0.35);
        const fade = st.broken ? clamp(1 - fallT / 1.4, 0, 1) : 1;
        const c = col.map((v) => v * fade);
        for (const p of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) D.v(p[0], p[1], z1, 2, c[0], c[1], c[2], MAT.FLOOR);
        const sc = mixc(isle.wall, [0.2, 0.12, 0.1], 0.4).map((v) => v * fade);
        D.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], sc, MAT.MATTE);
        D.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], sc, MAT.MATTE);
        D.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], sc, MAT.MATTE);
        D.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], sc, MAT.MATTE);
        if (st.t >= 0 && !st.broken) A.quad([x0 + 0.05, y0 + 0.05, 0.004], [x1 - 0.05, y0 + 0.05, 0.004], [x1 - 0.05, y1 - 0.05, 0.004], [x0 + 0.05, y1 - 0.05, 0.004], [0.5 * st.t / CRUMBLE_T, 0.14 * st.t / CRUMBLE_T, 0.02], MAT.ADD);
    });
    // gates: brass bars that sink
    for (const o of L.gates) {
        const h = 0.55 * s.gateH;
        if (h < 0.01) continue;
        const across = L.cells[o.r][o.c - 1] === "#" || L.cells[o.r][o.c + 1] === "#";      // bars run between the walls
        for (let i = 0; i < 5; i++) {
            const u = -0.4 + i * 0.2, bx = across ? o.x + u : o.x, by = across ? o.y : o.y + u;
            limb(D, [bx, by, 0], [bx, by, h], 0.045, 0.045, isle.trim, MAT.GOLD, 6);
        }
        const a = across ? [o.x - 0.5, o.y, h] : [o.x, o.y - 0.5, h], b = across ? [o.x + 0.5, o.y, h] : [o.x, o.y + 0.5, h];
        limb(D, a, b, 0.06, 0.06, mixc(isle.trim, [1, 1, 1], 0.2), MAT.GOLD, 6);
        limb(D, [a[0], a[1], h * 0.45], [b[0], b[1], h * 0.45], 0.035, 0.035, isle.trim, MAT.GOLD, 5);
    }
    // switches
    for (const o of L.switches) {
        const on = sim.gatesOpen, k = 0.6 + 0.4 * Math.sin(t * 4);
        const c = on ? [0.2, 0.9, 0.5] : [0.9 * k, 0.55 * k, 0.15 * k];
        ringA(A, o.x, o.y, 0.24, 0.3, 0.052, c);
        if (!on) A.sprite(o.x, o.y, 0.1, 0.45, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
    }
    // bumpers
    L.bumpers.forEach((o, i) => {
        const f = s.bumpFlash[i] || 0, k = 0.35 + f;
        ringA(A, o.x, o.y, BUMP_R + 0.02, BUMP_R + 0.1, 0.008, [0.9 * k, 0.6 * k, 0.25 * k]);
        if (f > 0.05) A.sprite(o.x, o.y, 0.3, 0.7, f, f * 0.7, f * 0.3);
        crystal(D, o.x, o.y, 0.44, 0.08, mixc([1, 0.5, 0.3], [1, 1, 0.8], f), false, t);
    });
    // boost chevrons
    for (const o of L.boosts) {
        const [dx, dy] = o.d, px = -dy, py = dx;
        for (let j = 0; j < 3; j++) {
            const ph = ((t * 1.8 + j / 3) % 1), u = -0.35 + ph * 0.7, k = Math.sin(ph * Math.PI) * 0.9;
            const cx = o.x + dx * u, cy = o.y + dy * u, w = 0.26, l = 0.14, th = 0.07;
            const col = [0.35 * k, 0.75 * k, 1.0 * k];
            const tip = [cx + dx * l, cy + dy * l], la = [cx - dx * l + px * w, cy - dy * l + py * w], lb = [cx - dx * l - px * w, cy - dy * l - py * w];
            A.quad([la[0], la[1], 0.006], [tip[0], tip[1], 0.006], [tip[0] - dx * th, tip[1] - dy * th, 0.006], [la[0] - dx * th, la[1] - dy * th, 0.006], col, MAT.ADD);
            A.quad([tip[0], tip[1], 0.006], [lb[0], lb[1], 0.006], [lb[0] - dx * th, lb[1] - dy * th, 0.006], [tip[0] - dx * th, tip[1] - dy * th, 0.006], col, MAT.ADD);
        }
    }
    // checkpoints: floating lanterns
    L.checks.forEach((o, i) => {
        const on = sim.check === o, z = 0.95 + Math.sin(t * 1.6 + i) * 0.06;
        const c = on ? [1.6, 1.1, 0.5] : [0.35, 0.45, 0.7];
        crystal(D, o.x, o.y, z, 0.1, on ? [1, 0.8, 0.4] : [0.5, 0.6, 0.85], false, t * 0.8);
        A.sprite(o.x, o.y, z + 0.05, on ? 0.7 : 0.4, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
        if (on) ringA(A, o.x, o.y, 0.3, 0.36, 0.008, [0.6, 0.4, 0.12]);
        shadowQuad(Sh, o.x + 0.1, o.y + 0.1, 0.25, 0.25);
    });
    // goal: light column + motes
    {
        const g = L.goal, pul = 0.75 + 0.25 * Math.sin(t * 2.2);
        const w = 0.3, hgt = 2.6;
        for (const [ax, ay] of [[1, 0], [0, 1], [0.707, 0.707], [0.707, -0.707]]) {
            const c0 = [0.3 * pul, 0.21 * pul, 0.06 * pul], c1 = [0, 0, 0];
            A.quad4([g.x - ax * w, g.y - ay * w, 0.05], [g.x + ax * w, g.y + ay * w, 0.05], [g.x + ax * w * 0.4, g.y + ay * w * 0.4, hgt], [g.x - ax * w * 0.4, g.y - ay * w * 0.4, hgt], c0, c0, c1, c1, MAT.ADD);
        }
        for (let i = 0; i < 7; i++) {
            const a = t * (0.9 + i * 0.13) + i * 0.9, rr = 0.28 + 0.1 * Math.sin(t + i), z = ((t * 0.35 + i / 7) % 1) * 1.8;
            A.sprite(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, z + 0.1, 0.12, 0.8 * (1 - z / 1.8), 0.6 * (1 - z / 1.8), 0.25 * (1 - z / 1.8));
        }
        A.sprite(g.x, g.y, 0.2, 0.9 * pul, 0.16, 0.11, 0.03);
    }
    // gems
    L.gems.forEach((o, i) => {
        const pop = s.gemPop[i];
        if (sim.gems[i] && (pop === undefined || pop > 1)) return;
        const k = sim.gems[i] ? 1 + pop * 1.5 : 1, z = 0.5 + Math.sin(t * 2 + i * 2) * 0.06 + (sim.gems[i] ? pop * 1.2 : 0);
        const col = [[0.4, 0.95, 1.0], [1.0, 0.45, 0.85], [0.6, 1.0, 0.45]][i % 3];
        if (!sim.gems[i]) { crystal(D, o.x, o.y, z, 0.27, col, false, t * 1.4 + i); shadowQuad(Sh, o.x + 0.06, o.y + 0.06, 0.2, 0.35); }
        const gk = sim.gems[i] ? (1 - pop) * 0.9 : 0.42;
        A.sprite(o.x, o.y, z + 0.05, 0.55 * k, col[0] * gk, col[1] * gk, col[2] * gk);
    });
}
export function ringA(A, x, y, r0, r1, z, col, n = 24) {
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        A.quad([x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, z], [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, z], [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, z], [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, z], col, MAT.ADD);
    }
}
export function shadowQuad(Sh, x, y, r, k) {
    Sh.v(x - r, y - r, 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y - r, 0.003, 2, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, 0.003, 3, k, 0, 0, MAT.SHADOW);
    Sh.v(x - r, y - r, 0.003, 0, k, 0, 0, MAT.SHADOW); Sh.v(x + r, y + r, 0.003, 3, k, 0, 0, MAT.SHADOW); Sh.v(x - r, y + r, 0.003, 1, k, 0, 0, MAT.SHADOW);
}

// the marble: unit-sphere directions (ball frame) → board-local positions via the rotation matrix rot (column-major)
const SPH = (() => {
    const out = [], seg = 22, rings = 14;
    const P = (i, j) => { const th = (j / rings) * Math.PI, ph = (i / seg) * TAU; return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
        if (j > 0) out.push(a, b, d);
        if (j < rings - 1) out.push(d, b, c); else out.push(a, b, d);
    }
    return out;
})();
export function drawBall(D, x, y, z, rot, rad = R) {
    for (const d of SPH) {
        const wx = rot[0] * d[0] + rot[3] * d[1] + rot[6] * d[2], wy = rot[1] * d[0] + rot[4] * d[1] + rot[7] * d[2], wz = rot[2] * d[0] + rot[5] * d[1] + rot[8] * d[2];
        D.v(x + wx * rad, y + wy * rad, z + wz * rad, 1, d[0], d[1], d[2], MAT.GLASS);
    }
}
