// The static valley for one map: meadow plots, cobbled road, river + bridges, autumn trees, rocks, the hills
// around the board, distant mountains, the Keep's walls and the rift's stone arch.
// Writes opaque geometry to S, multiply-blended contact shadows to Sh, additive glows to A.

import { MAT, tube, limb, blob, mulberry32, fbm } from "./mesh.js";
import { W, H, CELL, cellX, cellY } from "./maps.js";

const HX = (W / 2) * CELL, HY = (H / 2) * CELL;                  // half extents of the board (18, 11)
const LEAVES = [[0.98, 0.46, 0.12], [0.85, 0.24, 0.1], [1.0, 0.72, 0.18], [0.72, 0.5, 0.14], [0.95, 0.58, 0.2]];

export function shadow(Sh, x, y, z, rx, ry, k) {
    const v = (dx, dy, u, w) => Sh.v(x + dx * rx, y + dy * ry, z, u * 2 + w, k, 0, 0, MAT.SHADOW);
    v(-1, -1, 0, 0); v(1, -1, 1, 0); v(1, 1, 1, 1); v(-1, -1, 0, 0); v(1, 1, 1, 1); v(-1, 1, 0, 1);
}

export function tree(S, Sh, x, y, z, s, r) {
    const trunk = [0.32, 0.2, 0.12];
    limb(S, [x, y, z - 0.2], [x + (r() - 0.5) * 0.3, y, z + 1.6 * s], 0.18 * s, 0.11 * s, trunk, MAT.MATTE, 5);
    const n = 3 + Math.floor(r() * 3), leaf = LEAVES[Math.floor(r() * LEAVES.length)];
    for (let k = 0; k < n; k++) {
        const a = r() * 6.28, d = r() * 0.6 * s, h = (1.7 + r() * 1.1) * s, rr = (0.75 + r() * 0.45) * s;
        const c = leaf.map((v) => v * (0.85 + r() * 0.3));
        blob(S, [x + Math.cos(a) * d, y + Math.sin(a) * d, z + h], rr, rr, rr * 0.85, c, MAT.MATTE, 7, 4, (i, j) => 0.88 + ((i * 7 + j * 3 + k) % 5) * 0.05);
    }
    shadow(Sh, x + 0.5 * s, y + 0.35 * s, z + 0.03, 1.5 * s, 1.3 * s, 0.38);
}
function rock(S, Sh, x, y, z, s, r) {
    for (let k = 0; k < 3; k++) {
        const g = 0.46 + r() * 0.12;
        blob(S, [x + (r() - 0.5) * s, y + (r() - 0.5) * s, z + 0.25 * s], (0.45 + r() * 0.35) * s, (0.4 + r() * 0.3) * s, (0.35 + r() * 0.3) * s, [g, g * 0.97, g * 0.92], MAT.MATTE, 6, 4, (i, j) => 0.85 + ((i * 5 + j * 3) % 4) * 0.08);
    }
    shadow(Sh, x + 0.3, y + 0.2, z + 0.03, 1.2 * s, 1.0 * s, 0.4);
}

// height of the land around the board (0 on the board itself)
function landZ(x, y, riverX) {
    const dx = Math.max(0, Math.abs(x) - HX - 0.6), dy = Math.max(0, Math.abs(y) - HY - 0.6), d = Math.hypot(dx, dy);
    let h = d * 0.32 + (fbm(x * 0.05, y * 0.05, 7, 3) - 0.35) * Math.min(1, d / 5) * 7;
    if (y > 45) h += (y - 45) * 0.35;
    if (riverX != null) h *= Math.min(1, Math.max(0, (Math.abs(x - riverX) - 3) / 6));
    return Math.max(0, h) - (d > 0 ? 0 : 0.06);
}

export function buildScene(S, Sh, A, map) {
    const r = mulberry32(map.id.length * 977 + 13);
    const riverCols = [];
    for (let i = 0; i < W; i++) if (map.rows.every((row) => row[i] === "~" || row[i] === "B")) riverCols.push(i);
    const riverX = riverCols.length ? (cellX(riverCols[0]) + cellX(riverCols[riverCols.length - 1])) / 2 : null;

    // the land around the board
    const step = 3;
    for (let y = -42; y < 120; y += step) for (let x = -84; x < 84; x += step) {
        if (x >= -HX && x + step <= HX && y >= -HY && y + step <= HY) continue;
        const P = (a, b) => [a, b, landZ(a, b, riverX)];
        const p = [P(x, y), P(x + step, y), P(x + step, y + step), P(x, y + step)];
        const h = (p[0][2] + p[2][2]) / 2, n = fbm(x * 0.08, y * 0.08, 3, 2);
        const grass = [0.36 + n * 0.14, 0.5 + n * 0.1, 0.18], forest = [0.55 + n * 0.25, 0.3 + n * 0.1, 0.1], rocky = [0.55, 0.5, 0.45];
        const k = Math.min(1, h / 7), c = h > 22 ? rocky : grass.map((v, i) => v + (forest[i] - v) * k);
        S.quad(p[0], p[1], p[2], p[3], c, MAT.MATTE);
    }
    // the board's underlay (shows as thin dark seams between plots)
    // a rim of earth around the board (the plots draw their own dark seams)
    for (const [x0, y0, x1, y1] of [[-HX - 1, -HY - 1, HX + 1, -HY], [-HX - 1, HY, HX + 1, HY + 1], [-HX - 1, -HY, -HX, HY], [HX, -HY, HX + 1, HY]])
        S.quad([x0, y0, -0.05], [x1, y0, -0.05], [x1, y1, -0.05], [x0, y1, -0.05], [0.26, 0.36, 0.13], MAT.MATTE);

    // cells
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const c = map.rows[j][i], x = cellX(i), y = cellY(j), h = CELL / 2;
        const n = fbm(i * 0.6, j * 0.6, 11, 2);
        if (c === "." || c === "T" || c === "R") {
            const g = [0.34 + n * 0.12, 0.56 + n * 0.08, 0.18 + n * 0.04];
            const e = 0.045;
            S.quad([x - h, y - h, -0.01], [x + h, y - h, -0.01], [x + h, y + h, -0.01], [x - h, y + h, -0.01], [0.24, 0.36, 0.12], MAT.MATTE);
            S.quad([x - h + e, y - h + e, 0], [x + h - e, y - h + e, 0], [x + h - e, y + h - e, 0], [x - h + e, y + h - e, 0], g, MAT.MATTE);
            for (let k = 0; k < 4; k++) {                                             // little flowers and tufts
                const fx = x + (r() - 0.5) * 1.6, fy = y + (r() - 0.5) * 1.6;
                if (r() < 0.35) S.tri([fx, fy, 0.02], [fx + 0.12, fy, 0.02], [fx + 0.06, fy, 0.22], g.map((v) => v * 0.8), MAT.MATTE);
                else if (r() < 0.25) blob(S, [fx, fy, 0.05], 0.06, 0.06, 0.04, [[1, 0.9, 0.5], [0.95, 0.5, 0.4], [0.9, 0.85, 1]][k % 3], MAT.MATTE, 4, 2);
            }
            if (c === "T") tree(S, Sh, x, y, 0, 1 + r() * 0.2, r);
            if (c === "R") rock(S, Sh, x, y, 0, 1.1, r);
        } else if (c === "~" || c === "B") {
            S.quad([x - h, y - h, -0.7], [x + h, y - h, -0.7], [x + h, y + h, -0.7], [x - h, y + h, -0.7], [0.22, 0.24, 0.16], MAT.MATTE);
            S.quad([x - h, y - h, -0.22], [x + h, y - h, -0.22], [x + h, y + h, -0.22], [x - h, y + h, -0.22], [0.25, 0.55, 0.6], MAT.WATER);
            // banks where water meets land
            for (const [di, dj, ax, ay, bx, by] of [[-1, 0, -h, -h, -h, h], [1, 0, h, -h, h, h], [0, -1, -h, h, h, h], [0, 1, -h, -h, h, -h]]) {
                const nc = map.rows[j + dj]?.[i + di];
                if (nc && nc !== "~" && nc !== "B") S.quad([x + ax, y + ay, 0], [x + bx, y + by, 0], [x + bx, y + by, -0.7], [x + ax, y + ay, -0.7], [0.4, 0.3, 0.18], MAT.MATTE);
            }
            if (c === "B") {
                const along = map.rows[j][i - 1] !== "~" || map.rows[j][i + 1] !== "~";                 // road runs east–west
                for (let k = 0; k < 8; k++) {
                    const t = -h + (k + 0.5) * (CELL / 8), w = CELL / 8 - 0.04, col = k % 2 ? [0.5, 0.33, 0.19] : [0.58, 0.39, 0.22];
                    if (along) S.quad([x + t - w / 2, y - h + 0.1, 0.16], [x + t + w / 2, y - h + 0.1, 0.16], [x + t + w / 2, y + h - 0.1, 0.16], [x + t - w / 2, y + h - 0.1, 0.16], col, MAT.MATTE);
                }
                for (const s of [-1, 1]) {
                    limb(S, [x - h, y + s * (h - 0.1), 0.65], [x + h, y + s * (h - 0.1), 0.65], 0.06, 0.06, [0.4, 0.26, 0.15], MAT.MATTE, 4);
                    for (const px of [-h + 0.15, 0, h - 0.15]) limb(S, [x + px, y + s * (h - 0.1), -0.6], [x + px, y + s * (h - 0.1), 0.72], 0.08, 0.08, [0.35, 0.22, 0.13], MAT.MATTE, 4);
                }
            }
        } else {                                                                            // road
            S.quad([x - h, y - h, 0.012], [x + h, y - h, 0.012], [x + h, y + h, 0.012], [x - h, y + h, 0.012], [0.6 + n * 0.08, 0.48 + n * 0.06, 0.32], MAT.MATTE);
            for (let k = 0; k < 9; k++) {
                const sx = x + (r() - 0.5) * 1.7, sy = y + (r() - 0.5) * 1.7, s = 0.12 + r() * 0.14, g = 0.55 + r() * 0.2;
                S.quad([sx - s, sy - s * 0.8, 0.03], [sx + s * 0.9, sy - s, 0.03], [sx + s, sy + s * 0.9, 0.03], [sx - s * 0.8, sy + s, 0.03], [g, g * 0.92, g * 0.8], MAT.MATTE);
            }
            // low kerb stones where the road meets meadow
            for (const [di, dj, ax, ay, bx, by] of [[-1, 0, -h, -h, -h, h], [1, 0, h, -h, h, h], [0, -1, -h, h, h, h], [0, 1, -h, -h, h, -h]]) {
                const nc = map.rows[j + dj]?.[i + di];
                if (nc === "." || nc === "T" || nc === "R") {
                    const nx = ax === bx ? -Math.sign(ax) * 0.12 : 0, ny = ay === by ? -Math.sign(ay) * 0.12 : 0;
                    S.quad([x + ax, y + ay, 0.1], [x + bx, y + by, 0.1], [x + bx + nx, y + by + ny, 0.1], [x + ax + nx, y + ay + ny, 0.1], [0.66, 0.62, 0.55], MAT.MATTE);
                }
            }
        }
    }
    // the river continues beyond the board
    if (riverX != null) {
        const hw = (riverCols.length * CELL) / 2;
        for (const [y0, y1] of [[-42, -HY], [HY, 120]]) {
            S.quad([riverX - hw, y0, -0.7], [riverX + hw, y0, -0.7], [riverX + hw, y1, -0.7], [riverX - hw, y1, -0.7], [0.22, 0.24, 0.16], MAT.MATTE);
            S.quad([riverX - hw, y0, -0.22], [riverX + hw, y0, -0.22], [riverX + hw, y1, -0.22], [riverX - hw, y1, -0.22], [0.25, 0.55, 0.6], MAT.WATER);
        }
    }
    // forest on the hills
    for (let k = 0; k < 230; k++) {
        const x = (r() - 0.5) * 150, y = -36 + r() * 120;
        if (Math.abs(x) < HX + 2 && Math.abs(y) < HY + 2) continue;
        if (y < -HY && y > -HY - 18 && Math.abs(x) < HX + 8) continue;                // keep the view toward the board clear
        if (riverX != null && Math.abs(x - riverX) < 5) continue;
        tree(S, Sh, x, y, landZ(x, y, riverX), 1.1 + r() * 0.9, r);
    }
    // distant mountains
    for (let k = 0; k < 11; k++) {
        const x = -150 + k * 30 + (r() - 0.5) * 18, y = 150 + r() * 60, hgt = 30 + r() * 35, rad = 30 + r() * 20;
        tube(S, x, y, 7, rad, 0, 0, hgt, [0.42, 0.42, 0.5], MAT.MATTE, r() * 6);
        tube(S, x, y - 1, 7, rad * 0.3, hgt * 0.72, 0, hgt + 0.3, [0.95, 0.92, 0.9], MAT.MATTE, r() * 6);
    }

    // the Keep: a ring wall with crenellations around a tall tower (its crystal is drawn per frame)
    const [ki, kj] = map.keep, kx = cellX(ki) + 0.6, ky = cellY(kj);
    const stone = [0.68, 0.64, 0.58], dark = [0.5, 0.47, 0.43];
    tube(S, kx, ky, 12, 1.9, 0, 1.8, 1.5, stone, MAT.MATTE);
    for (let k = 0; k < 12; k += 2) {
        const a = (k / 12) * Math.PI * 2 + 0.26;
        tube(S, kx + Math.cos(a) * 1.75, ky + Math.sin(a) * 1.75, 4, 0.26, 1.5, 0.26, 1.85, stone, MAT.MATTE, a);
    }
    tube(S, kx, ky, 10, 0.95, 0, 0.85, 4.6, dark.map((v) => v * 1.15), MAT.MATTE);
    tube(S, kx, ky, 10, 1.15, 4.6, 1.15, 4.85, stone, MAT.MATTE);
    for (let k = 0; k < 10; k += 2) { const a = (k / 10) * Math.PI * 2; tube(S, kx + Math.cos(a) * 1.05, ky + Math.sin(a) * 1.05, 4, 0.2, 4.85, 0.2, 5.15, stone, MAT.MATTE, a); }
    tube(S, kx - 1.2, ky - 0.4, 6, 0.5, 0, 0.45, 3.1, stone, MAT.MATTE);
    tube(S, kx - 1.2, ky - 0.4, 6, 0.62, 3.1, 0, 4.2, [0.55, 0.16, 0.12], MAT.MATTE);
    limb(S, [kx - 1.2, ky - 0.4, 4.2], [kx - 1.2, ky - 0.4, 5.1], 0.03, 0.03, [0.3, 0.2, 0.1], MAT.MATTE, 3);
    S.tri([kx - 1.2, ky - 0.4, 5.05], [kx - 1.2, ky - 0.4, 4.6], [kx - 0.45, ky - 0.4, 4.85], [0.2, 0.55, 0.9], MAT.MATTE);
    shadow(Sh, kx + 0.6, ky + 0.4, 0.04, 3.0, 2.6, 0.5);

    // rift arches over each spawn
    for (const [si, sj] of map.spawns) {
        const sx = cellX(si) - 0.4, sy = cellY(sj);
        for (let k = 0; k <= 10; k++) {
            const a = Math.PI * (k / 10), g = 0.3 + (k % 3) * 0.04;
            blob(S, [sx, sy + Math.cos(a) * 1.35, 0.1 + Math.sin(a) * 2.2], 0.35, 0.32, 0.32, [g, g * 0.9, g * 1.05], MAT.MATTE, 6, 4);
        }
        shadow(Sh, sx + 0.3, sy, 0.04, 1.4, 2.0, 0.45);
    }
    return { keep: [kx, ky, 6.2] };
}
