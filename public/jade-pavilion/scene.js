// The tea pavilion around the board, and the three colour themes.
// Static: table (lacquer frame, felt, gold inlay), floor, back wall with a moon window, pillars, railing, a tea set.
// Lanterns are listed here but drawn every frame by main.js (they sway, and they are the point lights).

import { MAT, tube, blob, limb } from "./mesh.js";

export const THEMES = {
    jade: {
        name: "Jade", swatch: ["#1f8a62", "#f1e7cf"],
        back: [0.06, 0.38, 0.26], felt: [0.04, 0.16, 0.13], lacquer: [0.32, 0.06, 0.04], gold: [0.85, 0.62, 0.26],
        floor: [0.28, 0.17, 0.1], wall: [0.24, 0.15, 0.1], pillar: [0.5, 0.08, 0.06], paper: [1.4, 0.75, 0.32],
        amb: [0.19, 0.15, 0.13], keyDir: [-0.35, -0.45, 0.82], keyCol: [0.95, 0.8, 0.62],
        bgTop: [0.05, 0.03, 0.04], bgBot: [0.16, 0.08, 0.05], fog: [0.1, 0.06, 0.05], moon: [1.3, 1.1, 0.8], sky: [0.06, 0.06, 0.16],
        motes: [1.0, 0.7, 0.35],
    },
    midnight: {
        name: "Midnight", swatch: ["#2a3a8f", "#e9e6f5"],
        back: [0.08, 0.11, 0.38], felt: [0.03, 0.05, 0.12], lacquer: [0.05, 0.045, 0.06], gold: [0.75, 0.68, 0.5],
        floor: [0.12, 0.11, 0.14], wall: [0.1, 0.1, 0.15], pillar: [0.14, 0.13, 0.2], paper: [1.2, 0.85, 0.5],
        amb: [0.11, 0.12, 0.2], keyDir: [0.3, 0.55, 0.78], keyCol: [0.55, 0.65, 1.0],
        bgTop: [0.01, 0.015, 0.05], bgBot: [0.04, 0.05, 0.12], fog: [0.03, 0.04, 0.09], moon: [1.4, 1.45, 1.6], sky: [0.03, 0.05, 0.16],
        motes: [0.55, 0.7, 1.1],
    },
    sakura: {
        name: "Sakura", swatch: ["#d2577a", "#fff3ef"],
        back: [0.72, 0.24, 0.34], felt: [0.22, 0.08, 0.14], lacquer: [0.3, 0.17, 0.1], gold: [0.9, 0.72, 0.42],
        floor: [0.42, 0.29, 0.2], wall: [0.5, 0.36, 0.34], pillar: [0.6, 0.18, 0.18], paper: [1.4, 0.95, 0.85],
        amb: [0.25, 0.2, 0.23], keyDir: [-0.3, 0.4, 0.86], keyCol: [0.82, 0.7, 0.68],
        bgTop: [0.3, 0.18, 0.3], bgBot: [0.55, 0.32, 0.35], fog: [0.45, 0.3, 0.34], moon: [1.5, 1.2, 1.1], sky: [0.65, 0.42, 0.55],
        motes: [1.2, 0.6, 0.75],
    },
};

export const TABLE = { hx: 12.5, hy: 9.2, top: 0 };

// hanging lanterns: anchor positions (they sway in main.js)
export const LANTERNS = [
    { x: -9.5, y: 11, z: 7.5, s: 1.0 }, { x: 0, y: 14, z: 8.5, s: 1.25 }, { x: 9.5, y: 11, z: 7.5, s: 1.0 },
    { x: -15, y: 3, z: 6.5, s: 0.9 }, { x: 15, y: 3, z: 6.5, s: 0.9 }, { x: -5, y: 17, z: 10, s: 0.8 }, { x: 5, y: 17, z: 10, s: 0.8 },
];

export function buildScene(S, A, th) {
    const { hx, hy } = TABLE;
    const lac = th.lacquer, gold = th.gold;
    // felt playing surface, slightly below the frame
    S.quad([-hx + 1, -hy + 1, -0.02], [hx - 1, -hy + 1, -0.02], [hx - 1, hy - 1, -0.02], [-hx + 1, hy - 1, -0.02], th.felt, MAT.MATTE);
    // a subtle woven pattern on the felt: faint diamonds
    for (let x = -hx + 2; x < hx - 1.5; x += 1.6) for (let y = -hy + 2; y < hy - 1.5; y += 1.6) {
        const c = th.felt.map((v) => v * 1.12);
        S.quad([x, y + 0.35, -0.015], [x + 0.35, y, -0.015], [x, y - 0.35, -0.015], [x - 0.35, y, -0.015], c, MAT.MATTE);
    }
    // lacquer frame: four raised rails with bevelled inner edges
    const rail = (x0, y0, x1, y1, ix0, iy0, ix1, iy1) => {
        S.quad([x0, y0, 0.28], [x1, y1, 0.28], [ix1, iy1, 0.28], [ix0, iy0, 0.28], lac, MAT.GLOSS);
        S.quad([ix0, iy0, 0.28], [ix1, iy1, 0.28], [ix1, iy1, -0.02], [ix0, iy0, -0.02], lac.map((v) => v * 0.8), MAT.GLOSS);
        S.quad([x0, y0, 0.28], [x1, y1, 0.28], [x1, y1, -0.6], [x0, y0, -0.6], lac.map((v) => v * 0.7), MAT.GLOSS);
    };
    rail(-hx, -hy, hx, -hy, -hx + 1, -hy + 1, hx - 1, -hy + 1);
    rail(hx, -hy, hx, hy, hx - 1, -hy + 1, hx - 1, hy - 1);
    rail(hx, hy, -hx, hy, hx - 1, hy - 1, -hx + 1, hy - 1);
    rail(-hx, hy, -hx, -hy, -hx + 1, hy - 1, -hx + 1, -hy + 1);
    // gold inlay: a thin line inset on the rails and cloud-scroll corners
    const inl = (ax, ay, bx, by) => S.quad([ax, ay, 0.285], [bx, by, 0.285], [bx + (ay === by ? 0 : 0.06), by + (ay === by ? 0.06 : 0), 0.285], [ax + (ay === by ? 0 : 0.06), ay + (ay === by ? 0.06 : 0), 0.285], gold, MAT.GLOSS);
    inl(-hx + 0.47, -hy + 0.47, hx - 0.53, -hy + 0.47); inl(-hx + 0.47, hy - 0.53, hx - 0.53, hy - 0.53);
    inl(-hx + 0.47, -hy + 0.47, -hx + 0.47, hy - 0.53); inl(hx - 0.53, -hy + 0.47, hx - 0.53, hy - 0.53);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = sx * (hx - 0.5), cy = sy * (hy - 0.5);
        tube(S, cx, cy, 10, 0.32, 0.27, 0.3, 0.3, gold, MAT.GLOSS);
        tube(S, cx, cy, 10, 0.18, 0.3, 0.16, 0.32, lac, MAT.GLOSS);
    }
    // table apron and legs
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tube(S, sx * (hx - 1.2), sy * (hy - 1.2), 8, 0.55, -3, 0.45, -0.6, lac.map((v) => v * 0.8), MAT.GLOSS);

    // floor planks
    const FZ = -3;
    for (let y = -30; y < 40; y += 1.6) {
        for (let x = -40; x < 40; x += 8) {
            const off = (Math.floor(y / 1.6) % 2) * 4, k = 0.82 + ((Math.sin(x * 7.1 + y * 3.3) + 1) * 0.5) * 0.25;
            S.quad([x + off, y, FZ], [x + off + 7.95, y, FZ], [x + off + 7.95, y + 1.55, FZ], [x + off, y + 1.55, FZ], th.floor.map((v) => v * k), MAT.GLOSS);
        }
    }
    // back wall with a moon window
    const WY = 24;
    const wall = th.wall;
    const R = 6, mx = 0, mz = 9;
    const N = 40;
    for (let i = 0; i < N; i++) {                                       // wall around the round opening
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const p = (a, r) => [mx + Math.cos(a) * r, WY, mz + Math.sin(a) * r];
        const far = (a) => { const c = Math.cos(a), s = Math.sin(a), k = Math.min(40 / Math.max(Math.abs(c), 1e-3), 22 / Math.max(Math.abs(s), 1e-3)); return [mx + c * k, WY, mz + s * k]; };
        S.quad(p(a0, R), far(a0), far(a1), p(a1, R), wall, MAT.MATTE);
        S.quad(p(a0, R), p(a1, R), [mx + Math.cos(a1) * R, WY + 0.8, mz + Math.sin(a1) * R], [mx + Math.cos(a0) * R, WY + 0.8, mz + Math.sin(a0) * R], wall.map((v) => v * 0.7), MAT.MATTE);
        S.quad(p(a0, R + 0.35), p(a1, R + 0.35), p(a1, R), p(a0, R), th.lacquer, MAT.GLOSS);
    }
    // night/dusk sky behind the window, the moon, and a branch silhouette
    S.quad([mx - R - 1, WY + 6, mz - R - 1], [mx + R + 1, WY + 6, mz - R - 1], [mx + R + 1, WY + 6, mz + R + 1], [mx - R - 1, WY + 6, mz + R + 1], th.sky, MAT.EMIT);
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        S.tri([mx + 2.2, WY + 5.79, mz + 2], [mx + 2.2 + Math.cos(a) * 1.6, WY + 5.79, mz + 2 + Math.sin(a) * 1.6], [mx + 2.2 + Math.cos(a + 0.27) * 1.6, WY + 5.79, mz + 2 + Math.sin(a + 0.27) * 1.6], th.moon, MAT.EMIT);
    }
    A.sprite(mx + 2.2, WY + 5.5, mz + 2, 5, th.moon[0] * 0.12, th.moon[1] * 0.12, th.moon[2] * 0.12);
    const br = [0.05, 0.03, 0.04];
    let bx = mx - R - 1, bz = mz + 3.5;
    for (let i = 0; i < 9; i++) {
        const nx = bx + 1.3, nz = bz + Math.sin(i * 1.3) * 0.5 - 0.15;
        limb(S, [bx, WY + 5.6, bz], [nx, WY + 5.6, nz], 0.16 - i * 0.012, 0.15 - i * 0.012, br, MAT.MATTE, 4);
        if (i % 2) limb(S, [nx, WY + 5.6, nz], [nx + 0.6, WY + 5.6, nz + 0.9], 0.07, 0.03, br, MAT.MATTE, 3);
        for (let k = 0; k < 3; k++) blob(S, [nx + Math.sin(i * 5 + k) * 0.5, WY + 5.5, nz + 0.3 + Math.cos(i * 3 + k) * 0.4], 0.16, 0.08, 0.16, th === THEMES.sakura ? [1.3, 0.75, 0.85] : [1.1, 0.95, 0.9], MAT.EMIT, 5, 3);
        bx = nx; bz = nz;
    }
    // lattice in the window: thin bars
    for (const t of [-0.5, 0, 0.5]) {
        S.quad([mx + t * R * 1.6 - 0.06, WY + 0.4, mz - R], [mx + t * R * 1.6 + 0.06, WY + 0.4, mz - R], [mx + t * R * 1.6 + 0.06, WY + 0.4, mz + R], [mx + t * R * 1.6 - 0.06, WY + 0.4, mz + R], th.lacquer, MAT.GLOSS);
    }
    S.quad([mx - R, WY + 0.4, mz - 0.06], [mx + R, WY + 0.4, mz - 0.06], [mx + R, WY + 0.4, mz + 0.06], [mx - R, WY + 0.4, mz + 0.06], th.lacquer, MAT.GLOSS);
    // pillars and a low railing
    for (const [px, py] of [[-19, 20], [19, 20], [-24, 6], [24, 6]]) {
        tube(S, px, py, 10, 0.8, FZ, 0.75, 22, th.pillar, MAT.GLOSS);
        tube(S, px, py, 10, 1.1, FZ, 1.05, FZ + 0.6, th.gold.map((v) => v * 0.6), MAT.GLOSS);
    }
    for (let x = -18; x <= 18; x += 2) tube(S, x, 20, 6, 0.12, FZ, 0.12, FZ + 2.2, th.lacquer, MAT.GLOSS);
    S.quad([-18.5, 19.8, FZ + 2.2], [18.5, 19.8, FZ + 2.2], [18.5, 20.2, FZ + 2.35], [-18.5, 20.2, FZ + 2.35], th.lacquer, MAT.GLOSS);
    // a tea set on the table's corner
    const tx = hx - 2.3, ty = -hy + 2.2;
    const porcelain = [0.92, 0.9, 0.86], blue = [0.18, 0.3, 0.62];
    blob(S, [tx, ty, 0.62], 0.75, 0.75, 0.62, porcelain, MAT.GLOSS, 14, 8, null, (i, j) => (j === 3 || j === 4 ? blue : porcelain));
    tube(S, tx, ty, 14, 0.42, 1.18, 0.2, 1.3, porcelain, MAT.GLOSS);
    blob(S, [tx, ty, 1.36], 0.12, 0.12, 0.1, blue, MAT.GLOSS, 6, 4);
    limb(S, [tx + 0.65, ty, 0.6], [tx + 1.15, ty, 1.05], 0.12, 0.07, porcelain, MAT.GLOSS, 6);
    limb(S, [tx - 0.62, ty, 0.95], [tx - 0.95, ty, 0.75], 0.07, 0.07, porcelain, MAT.GLOSS, 5);
    limb(S, [tx - 0.95, ty, 0.75], [tx - 0.6, ty, 0.4], 0.07, 0.07, porcelain, MAT.GLOSS, 5);
    for (const [cx, cy] of [[tx - 1.9, ty + 0.2], [tx - 1.4, ty - 0.9]]) {
        tube(S, cx, cy, 12, 0.22, 0.0, 0.36, 0.42, porcelain, MAT.GLOSS, 0, false);
        tube(S, cx, cy, 12, 0.32, 0.36, 0.32, 0.37, [0.45, 0.3, 0.08], MAT.MATTE);
    }
    return { teapot: [tx + 1.15, ty, 1.1] };
}

// one paper lantern at (x, y, z) — ribbed paper globe, wooden caps, a red tassel
export function drawLantern(S, A, l, th, time) {
    const sway = Math.sin(time * 0.7 + l.x) * 0.08, sx = l.x + Math.sin(sway) * 2.5, sz = l.z - (1 - Math.cos(sway)) * 2.5;
    const s = l.s, paper = th.paper.map((v) => v * (0.92 + 0.08 * Math.sin(time * 9 + l.x * 3)));
    limb(S, [l.x, l.y, l.z + 6], [sx, l.y, sz + 1.0 * s], 0.025, 0.025, [0.08, 0.05, 0.04], MAT.MATTE, 3);
    blob(S, [sx, l.y, sz], 0.85 * s, 0.85 * s, 0.95 * s, paper, MAT.EMIT, 14, 8, (i, j) => (i % 2 ? 1 : 0.95), (i) => (i % 2 ? paper : paper.map((v) => v * 0.8)));
    tube(S, sx, l.y, 10, 0.45 * s, sz + 0.85 * s, 0.4 * s, sz + 1.05 * s, [0.12, 0.06, 0.04], MAT.GLOSS);
    tube(S, sx, l.y, 10, 0.45 * s, sz - 1.05 * s, 0.4 * s, sz - 0.85 * s, [0.12, 0.06, 0.04], MAT.GLOSS);
    limb(S, [sx, l.y, sz - 1.05 * s], [sx, l.y, sz - 1.9 * s], 0.08 * s, 0.14 * s, [0.75, 0.06, 0.08], MAT.MATTE, 5);
    A.sprite(sx, l.y - 0.6, sz, 2.6 * s, paper[0] * 0.09, paper[1] * 0.09, paper[2] * 0.09);
    A.sprite(sx, l.y - 0.6, sz, 6 * s, paper[0] * 0.03, paper[1] * 0.03, paper[2] * 0.03);
    return [sx, l.y - 0.4, sz];
}
