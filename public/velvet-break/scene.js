// The lounge: table (felt, cushions, walnut rails with inlaid diamonds, brass pockets), the long green-glass lamp,
// a rug, panelled walls, a back bar with glowing bottles and a leather sofa. Built once into the static buffers.

import { MAT, tube, blob, limb } from "./mesh.js";
import { L, W, POCKETS, RAILS } from "./physics.js";

export const LAMP = [0, 0, 9.5];
const FELT = [0.035, 0.3, 0.31], RAILW = [0.3, 0.14, 0.07], BRASS = [0.95, 0.7, 0.32];

function box(S, x0, y0, z0, x1, y1, z1, col, mat, top = true) {
    const c = col, d = col.map((v) => v * 0.75);
    if (top) S.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, mat);
    S.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], d, mat);
    S.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], d, mat);
    S.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], d, mat);
    S.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], d, mat);
}

export function buildScene(S, Sh, A) {
    const hx = L / 2, hy = W / 2, IN = 0.5, OUT = 1.7, TOP = 0.46;
    // felt bed (slightly larger than the playing area so it runs under the cushions)
    S.quad([-hx - IN, -hy - IN, 0], [hx + IN, -hy - IN, 0], [hx + IN, hy + IN, 0], [-hx - IN, hy + IN, 0], FELT, MAT.FELT);
    // head string and foot spot, very faint
    S.quad([-hx / 2 - 0.015, -hy, 0.002], [-hx / 2 + 0.015, -hy, 0.002], [-hx / 2 + 0.015, hy, 0.002], [-hx / 2 - 0.015, hy, 0.002], FELT.map((v) => v * 1.25), MAT.FELT);
    tube(S, hx / 2, 0, 10, 0.07, 0.002, 0.07, 0.003, FELT.map((v) => v * 1.5), MAT.FELT);
    // cushion noses along the long segments (not the jaws)
    for (const s of RAILS) {
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
        if (len < 1) continue;
        const nx = Math.abs(s.ay - s.by) < 1e-6 ? 0 : Math.sign(s.ax), ny = Math.abs(s.ay - s.by) < 1e-6 ? Math.sign(s.ay) : 0;
        const o = (p) => [p[0] + nx * IN, p[1] + ny * IN];
        const a = [s.ax, s.ay], b = [s.bx, s.by], ao = o(a), bo = o(b);
        S.quad([a[0], a[1], 0.02], [b[0], b[1], 0.02], [b[0], b[1], 0.36], [a[0], a[1], 0.36], FELT.map((v) => v * 0.8), MAT.FELT);
        S.quad([a[0], a[1], 0.36], [b[0], b[1], 0.36], [bo[0], bo[1], TOP - 0.02], [ao[0], ao[1], TOP - 0.02], FELT.map((v) => v * 1.05), MAT.FELT);
    }
    // walnut rails
    const rail = (x0, y0, x1, y1) => box(S, x0, y0, -0.9, x1, y1, TOP, RAILW, MAT.GLOSS);
    rail(-hx - OUT, hy + IN, hx + OUT, hy + OUT); rail(-hx - OUT, -hy - OUT, hx + OUT, -hy - IN);
    rail(-hx - OUT, -hy - IN, -hx - IN, hy + IN); rail(hx + IN, -hy - IN, hx + OUT, hy + IN);
    // a rounded lip on the outer edge
    for (const [x0, y0, x1, y1] of [[-hx - OUT, hy + OUT - 0.25, hx + OUT, hy + OUT], [-hx - OUT, -hy - OUT, hx + OUT, -hy - OUT + 0.25]]) box(S, x0, y0, TOP, x1, y1, TOP + 0.08, RAILW.map((v) => v * 1.15), MAT.GLOSS);
    // inlaid mother-of-pearl diamonds
    const dia = (x, y) => S.quad([x - 0.12, y, TOP + 0.003], [x, y - 0.07, TOP + 0.003], [x + 0.12, y, TOP + 0.003], [x, y + 0.07, TOP + 0.003], [0.95, 0.92, 0.88], MAT.GLOSS);
    for (let k = 1; k < 8; k++) if (k !== 4) { const x = -hx + (k / 8) * L; dia(x, hy + (IN + OUT) / 2); dia(x, -hy - (IN + OUT) / 2); }
    for (let k = 1; k < 4; k++) { const y = -hy + (k / 4) * W; dia(-hx - (IN + OUT) / 2, y); dia(hx + (IN + OUT) / 2, y); }
    // pockets: dark mouths, brass rings, leather nets
    for (const p of POCKETS) {
        tube(S, p.x, p.y, 20, p.r + 0.05, 0.005, p.r + 0.05, 0.01, [0.01, 0.01, 0.01], MAT.MATTE);
        tube(S, p.x, p.y, 20, p.r + 0.05, TOP + 0.01, p.r + 0.05, TOP + 0.02, [0.01, 0.01, 0.01], MAT.MATTE);
        for (let i = 0; i < 20; i++) {
            const a0 = (i / 20) * 6.283, a1 = ((i + 1) / 20) * 6.283, r0 = p.r + 0.05, r1 = p.r + 0.28;
            S.quad([p.x + Math.cos(a0) * r0, p.y + Math.sin(a0) * r0, TOP + 0.03], [p.x + Math.cos(a1) * r0, p.y + Math.sin(a1) * r0, TOP + 0.03], [p.x + Math.cos(a1) * r1, p.y + Math.sin(a1) * r1, TOP + 0.03], [p.x + Math.cos(a0) * r1, p.y + Math.sin(a0) * r1, TOP + 0.03], BRASS, MAT.GLOSS);
        }
        blob(S, [p.x, p.y, -0.7], p.r * 0.9, p.r * 0.9, 0.6, [0.12, 0.06, 0.04], MAT.MATTE, 10, 4);
    }
    // table body and legs
    box(S, -hx - OUT + 0.3, -hy - OUT + 0.3, -2.4, hx + OUT - 0.3, hy + OUT - 0.3, -0.9, RAILW.map((v) => v * 0.8), MAT.GLOSS, false);
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 1]) {
        const x = sx * (hx - 0.4), y = sy * (hy + 0.5);
        tube(S, x, y, 10, 0.55, -8, 0.42, -2.4, RAILW.map((v) => v * 0.85), MAT.GLOSS);
        tube(S, x, y, 10, 0.68, -3.4, 0.68, -2.9, RAILW.map((v) => v * 1.1), MAT.GLOSS);
    }
    // floor, rug
    S.quad([-80, -60, -8], [80, -60, -8], [80, 80, -8], [-80, 80, -8], [0.12, 0.07, 0.04], MAT.GLOSS);
    S.quad([-hx - 6, -hy - 6, -7.98], [hx + 6, -hy - 6, -7.98], [hx + 6, hy + 6, -7.98], [-hx - 6, hy + 6, -7.98], [0.32, 0.05, 0.06], MAT.MATTE);
    S.quad([-hx - 5.4, -hy - 5.4, -7.97], [hx + 5.4, -hy - 5.4, -7.97], [hx + 5.4, -hy - 5.2, -7.97], [-hx - 5.4, -hy - 5.2, -7.97], [0.7, 0.5, 0.2], MAT.MATTE);
    S.quad([-hx - 5.4, hy + 5.2, -7.97], [hx + 5.4, hy + 5.2, -7.97], [hx + 5.4, hy + 5.4, -7.97], [-hx - 5.4, hy + 5.4, -7.97], [0.7, 0.5, 0.2], MAT.MATTE);
    Sh.v(-hx - 3, -hy - 3, -7.96, 0, 0.6, 0, 0, MAT.SHADOW); Sh.v(hx + 3, -hy - 3, -7.96, 2, 0.6, 0, 0, MAT.SHADOW); Sh.v(hx + 3, hy + 3, -7.96, 3, 0.6, 0, 0, MAT.SHADOW);
    Sh.v(-hx - 3, -hy - 3, -7.96, 0, 0.6, 0, 0, MAT.SHADOW); Sh.v(hx + 3, hy + 3, -7.96, 3, 0.6, 0, 0, MAT.SHADOW); Sh.v(-hx - 3, hy + 3, -7.96, 1, 0.6, 0, 0, MAT.SHADOW);
    // the long billiard lamp: green glass shade with a warm glowing underside
    const [lx, ly, lz] = LAMP, sw = 10, sd = 1.3;
    box(S, lx - sw, ly - sd, lz, lx + sw, ly + sd, lz + 1.1, [0.05, 0.3, 0.16], MAT.GLOSS);
    S.quad([lx - sw + 0.1, ly - sd + 0.1, lz - 0.01], [lx + sw - 0.1, ly - sd + 0.1, lz - 0.01], [lx + sw - 0.1, ly + sd - 0.1, lz - 0.01], [lx - sw + 0.1, ly + sd - 0.1, lz - 0.01], [1.6, 1.35, 1.0], MAT.EMIT);
    box(S, lx - sw - 0.1, ly - sd - 0.1, lz + 1.1, lx + sw + 0.1, ly + sd + 0.1, lz + 1.25, BRASS, MAT.GLOSS);
    for (const sx of [-1, 1]) limb(S, [lx + sx * (sw - 1.5), ly, lz + 1.25], [lx + sx * (sw - 1.5), ly, lz + 20], 0.05, 0.05, BRASS, MAT.GLOSS, 4);
    for (let k = -2; k <= 2; k++) A.sprite(lx + k * 4, ly, lz - 0.3, 2.2, 0.12, 0.1, 0.07);
    // room: panelled back wall, side walls, a bar with bottles, a sofa
    const wall = [0.09, 0.05, 0.035];
    S.quad([-60, 34, -8], [60, 34, -8], [60, 34, 30], [-60, 34, 30], wall, MAT.MATTE);
    for (let k = -5; k <= 5; k++) box(S, k * 9 - 3.6, 33.6, -2, k * 9 + 3.6, 33.9, 10, wall.map((v) => v * 1.35), MAT.GLOSS);
    S.quad([-44, -50, -8], [-44, 34, -8], [-44, 34, 30], [-44, -50, 30], wall.map((v) => v * 0.8), MAT.MATTE);
    S.quad([44, 34, -8], [44, -50, -8], [44, -50, 30], [44, 34, 30], wall.map((v) => v * 0.8), MAT.MATTE);
    box(S, -26, 28, -8, -6, 32, -3.5, [0.2, 0.09, 0.05], MAT.GLOSS);
    box(S, -26.4, 27.6, -3.5, -5.6, 32.4, -3.2, [0.35, 0.18, 0.09], MAT.GLOSS);
    for (let row = 0; row < 3; row++) {
        box(S, -26, 32, 0 + row * 3.4, -6, 33.5, 0.2 + row * 3.4, [0.3, 0.15, 0.08], MAT.GLOSS);
        for (let k = 0; k < 9; k++) {
            const x = -24.8 + k * 2.2, z = 0.2 + row * 3.4, hue = (k * 7 + row * 3) % 5;
            const col = [[1.2, 0.55, 0.15], [0.3, 0.9, 0.45], [0.9, 0.25, 0.3], [0.95, 0.85, 0.4], [0.35, 0.55, 1.1]][hue];
            tube(S, x, 32.7, 6, 0.32, z, 0.3, z + 1.6, col.map((v) => v * 0.5), MAT.EMIT);
            tube(S, x, 32.7, 6, 0.12, z + 1.6, 0.1, z + 2.4, col.map((v) => v * 0.35), MAT.EMIT);
            A.sprite(x, 32.2, z + 1, 0.9, col[0] * 0.05, col[1] * 0.05, col[2] * 0.05);
        }
    }
    const leather = [0.28, 0.1, 0.06];
    box(S, 8, 26, -8, 26, 31, -5.6, leather, MAT.GLOSS);
    box(S, 8, 30, -5.6, 26, 32, -1.4, leather.map((v) => v * 0.9), MAT.GLOSS);
    for (const sx of [8, 24.6]) box(S, sx, 26, -5.6, sx + 1.4, 31, -3.8, leather.map((v) => v * 1.1), MAT.GLOSS);
    // wall sconces
    for (const x of [-34, 34]) { tube(S, x, 33.4, 8, 0.6, 6, 0.9, 7.6, [1.4, 0.9, 0.5], MAT.EMIT); A.sprite(x, 33, 7, 3, 0.18, 0.11, 0.05); }
}
