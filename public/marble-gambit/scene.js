// The conservatory: a marble board (cream marble / green serpentine) with brass inlay and a walnut frame on a
// round table, velvet trays for captured pieces, candles, potted palms, a stone floor and tall glass walls.

import { MAT, tube, blob, limb, mulberry32 } from "./mesh.js";

export const CANDLES = [[-6.4, 4.6, 1.3], [6.6, 4.2, 1.6], [6.0, -5.4, 1.1]];
export const TRAY = { white: [-6.3, -1.2], black: [6.3, 1.2] };          // where each side's captures go

function box(S, x0, y0, z0, x1, y1, z1, col, mat, top = true) {
    const d = col.map((v) => v * 0.72);
    if (top) S.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    S.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], d, mat);
    S.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], d, mat);
    S.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], d, mat);
    S.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], d, mat);
}

export function buildScene(S, Sh, A) {
    const r = mulberry32(9);
    // the board: 8×8 marble squares
    for (let row = 0; row < 8; row++) for (let f = 0; f < 8; f++) {
        const x = f - 3.5, y = 3.5 - row, light = (row + f) % 2 === 0;
        const c = light ? [0.9, 0.86, 0.78] : [0.13, 0.32, 0.25];
        S.quad([x - 0.5, y - 0.5, 0], [x + 0.5, y - 0.5, 0], [x + 0.5, y + 0.5, 0], [x - 0.5, y + 0.5, 0], c, MAT.MARBLE);
    }
    // brass inlay, walnut frame, a bevel
    const brass = [0.95, 0.72, 0.36], walnut = [0.26, 0.13, 0.07];
    for (const [x0, y0, x1, y1] of [[-4.12, -4.12, 4.12, -4], [-4.12, 4, 4.12, 4.12], [-4.12, -4, -4, 4], [4, -4, 4.12, 4]]) S.quad([x0, y0, 0.002], [x1, y0, 0.002], [x1, y1, 0.002], [x0, y1, 0.002], brass, MAT.GLOSS);
    for (const [x0, y0, x1, y1] of [[-5, -5, 5, -4.12], [-5, 4.12, 5, 5], [-5, -4.12, -4.12, 4.12], [4.12, -4.12, 5, 4.12]]) box(S, x0, y0, -0.45, x1, y1, 0.04, walnut, MAT.GLOSS);
    // the round table
    tube(S, 0, 0, 48, 10.5, -0.5, 10.5, -0.45, [0.2, 0.1, 0.05], MAT.GLOSS);
    tube(S, 0, 0, 48, 10.6, -0.95, 10.5, -0.5, [0.16, 0.08, 0.04], MAT.GLOSS, 0, false);
    tube(S, 0, 0, 12, 1.2, -8, 0.8, -0.95, [0.14, 0.07, 0.04], MAT.GLOSS);
    tube(S, 0, 0, 12, 3.2, -8, 1.2, -7.2, [0.14, 0.07, 0.04], MAT.GLOSS);
    // velvet trays for captured pieces
    for (const [tx, ty] of [TRAY.white, TRAY.black]) {
        box(S, tx - 1.0, ty - 3.4, -0.45, tx + 1.0, ty + 3.4, -0.3, [0.35, 0.3, 0.2], MAT.GLOSS);
        S.quad([tx - 0.88, ty - 3.28, -0.29], [tx + 0.88, ty - 3.28, -0.29], [tx + 0.88, ty + 3.28, -0.29], [tx - 0.88, ty + 3.28, -0.29], [0.3, 0.05, 0.08], MAT.MATTE);
    }
    // candles
    for (const [x, y, h] of CANDLES) {
        tube(S, x, y, 14, 0.42, -0.45, 0.36, -0.36, brass, MAT.GLOSS);
        tube(S, x, y, 12, 0.17, -0.36, 0.17, -0.36 + h, [0.95, 0.92, 0.82], MAT.MARBLE);
        tube(S, x, y, 6, 0.045, -0.36 + h, 0, -0.1 + h, [2.4, 1.6, 0.7], MAT.EMIT);
        A.sprite(x, y, -0.2 + h, 0.5, 0.5, 0.3, 0.1); A.sprite(x, y, -0.2 + h, 1.6, 0.1, 0.06, 0.02);
    }
    // stone floor
    for (let y = -40; y < 40; y += 4) for (let x = -40; x < 40; x += 4) {
        const k = 0.8 + ((x * 7 + y * 13) % 5 + 5) % 5 * 0.05, c = ((x + y) / 4) % 2 ? [0.3, 0.28, 0.27] : [0.22, 0.21, 0.21];
        S.quad([x + 0.04, y + 0.04, -8], [x + 3.96, y + 0.04, -8], [x + 3.96, y + 3.96, -8], [x + 0.04, y + 3.96, -8], c.map((v) => v * k), MAT.GLOSS);
    }
    Sh.v(-12, -12, -7.98, 0, 0.6, 0, 0, MAT.SHADOW); Sh.v(12, -12, -7.98, 2, 0.6, 0, 0, MAT.SHADOW); Sh.v(12, 12, -7.98, 3, 0.6, 0, 0, MAT.SHADOW);
    Sh.v(-12, -12, -7.98, 0, 0.6, 0, 0, MAT.SHADOW); Sh.v(12, 12, -7.98, 3, 0.6, 0, 0, MAT.SHADOW); Sh.v(-12, 12, -7.98, 1, 0.6, 0, 0, MAT.SHADOW);
    // glass walls: dark iron mullions on three sides (the sky shows through)
    const iron = [0.08, 0.09, 0.1];
    for (const [ax, ay, bx, by] of [[-34, 30, 34, 30], [-34, -30, -34, 30], [34, -30, 34, 30]]) {
        const len = Math.hypot(bx - ax, by - ay), n = Math.round(len / 4.2);
        for (let k = 0; k <= n; k++) { const u = k / n, x = ax + (bx - ax) * u, y = ay + (by - ay) * u; limb(S, [x, y, -8], [x, y, 26], 0.18, 0.18, iron, MAT.GLOSS, 4); }
        for (const z of [-4, 6, 16, 26]) limb(S, [ax, ay, z], [bx, by, z], 0.14, 0.14, iron, MAT.GLOSS, 4);
        // gothic arches along the top of each pane
        for (let k = 0; k < n; k++) {
            const u0 = k / n, u1 = (k + 1) / n;
            let prev = null;
            for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI, u = (u0 + u1) / 2 + Math.cos(a) * (u1 - u0) / 2, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = 16 + Math.sin(a) * 4; if (prev) limb(S, prev, [x, y, z], 0.09, 0.09, iron, MAT.GLOSS, 3); prev = [x, y, z]; }
        }
    }
    // potted palms in the corners
    for (const [px, py] of [[-16, 20], [17, 18], [-22, -6], [22, -10]]) {
        tube(S, px, py, 12, 1.4, -8, 1.8, -5.6, [0.55, 0.32, 0.2], MAT.MATTE);
        limb(S, [px, py, -5.6], [px + 0.4, py, 1], 0.22, 0.16, [0.35, 0.26, 0.15], MAT.MATTE, 6);
        for (let k = 0; k < 9; k++) {
            const a = (k / 9) * 6.283 + r(), len = 3.5 + r() * 2;
            const tip = [px + 0.4 + Math.cos(a) * len, py + Math.sin(a) * len, 1 - len * 0.35];
            const mid = [px + 0.4 + Math.cos(a) * len * 0.5, py + Math.sin(a) * len * 0.5, 1.7];
            const side = [-Math.sin(a) * 0.6, Math.cos(a) * 0.6];
            const g = [0.1 + r() * 0.05, 0.3 + r() * 0.1, 0.14];
            S.tri([px + 0.4, py, 1], [mid[0] + side[0], mid[1] + side[1], mid[2]], mid, g, MAT.MATTE);
            S.tri([px + 0.4, py, 1], mid, [mid[0] - side[0], mid[1] - side[1], mid[2]], g.map((v) => v * 0.85), MAT.MATTE);
            S.tri([mid[0] + side[0], mid[1] + side[1], mid[2]], tip, mid, g, MAT.MATTE);
            S.tri(mid, tip, [mid[0] - side[0], mid[1] - side[1], mid[2]], g.map((v) => v * 0.85), MAT.MATTE);
        }
    }
    // a little fountain glow in the far back
    tube(S, 0, 22, 24, 4, -8, 4, -6.8, [0.4, 0.4, 0.42], MAT.MARBLE);
    tube(S, 0, 22, 24, 3.6, -6.85, 3.6, -6.8, [0.1, 0.25, 0.35], MAT.GLOSS);
    A.sprite(0, 22, -6.4, 4, 0.03, 0.08, 0.1);
}
