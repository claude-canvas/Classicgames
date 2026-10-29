// Moonlake's scenery: the lake (an ellipse), shores rising into pine hills, distant mountains, reeds, lily pads,
// rocks and the old dock with its lantern. Also the fishing zones used to place fish.

import { MAT, tube, blob, limb, mulberry32, fbm } from "./mesh.js";

export const LAKE = { cx: 0, cy: 30, rx: 54, ry: 44 };
export const DOCK_END = [0, -6.5];
export const ROD_BASE = [1.5, -12.9, 1.35];
export const LANTERN = [-1.25, -6.9, 2.35];

export const ZONES = {
    shallows: { x0: -30, x1: -8, y0: -5, y1: 12, name: "the lily shallows" },
    reeds: { x0: 9, x1: 32, y0: -4, y1: 16, name: "the reed bed" },
    rocks: { x0: -34, x1: -10, y0: 20, y1: 44, name: "the far rocks" },
    deep: { x0: -10, x1: 14, y0: 12, y1: 50, name: "the deep middle" },
};
export function zoneAt(x, y) {
    for (const [k, z] of Object.entries(ZONES)) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return k;
    return y > 8 ? "deep" : x < 0 ? "shallows" : "reeds";
}
export const inLake = (x, y, pad = 0) => ((x - LAKE.cx) / (LAKE.rx - pad)) ** 2 + ((y - LAKE.cy) / (LAKE.ry - pad)) ** 2 < 1;

function landZ(x, y) {
    const e = Math.sqrt(((x - LAKE.cx) / LAKE.rx) ** 2 + ((y - LAKE.cy) / LAKE.ry) ** 2);
    const d = (e - 1) * 34;
    if (d < 0) return Math.max(-2.2, d * 0.25);
    let h = d * 0.2 + (fbm(x * 0.04, y * 0.04, 3, 3) - 0.4) * Math.min(1, d / 8) * 7;
    if (y > 80) h += (y - 80) * 0.12;
    return Math.max(0.15, h);
}
export function pine(S, Sh, x, y, z, s, r) {
    const g = [0.07 + r() * 0.04, 0.17 + r() * 0.06, 0.12 + r() * 0.04];
    limb(S, [x, y, z - 0.3], [x, y, z + 1.2 * s], 0.18 * s, 0.12 * s, [0.22, 0.14, 0.09], MAT.MATTE, 5);
    for (let k = 0; k < 3; k++) tube(S, x, y, 7, (1.5 - k * 0.38) * s, z + (0.9 + k * 1.1) * s, 0, z + (2.6 + k * 1.15) * s, g.map((v) => v * (0.9 + k * 0.1)), MAT.MATTE, r() * 6, false);
    if (Sh) { const v = (dx, dy, u, w) => Sh.v(x + 0.8 * s + dx * 1.6 * s, y + 0.6 * s + dy * 1.6 * s, z + 0.05, u * 2 + w, 0.35, 0, 0, MAT.SHADOW); v(-1, -1, 0, 0); v(1, -1, 1, 0); v(1, 1, 1, 1); v(-1, -1, 0, 0); v(1, 1, 1, 1); v(-1, 1, 0, 1); }
}

export function buildLake(S, Sh, A) {
    const r = mulberry32(42);
    // water: one big plane (shores cover the edges)
    S.quad([-200, -30, 0], [200, -30, 0], [200, 220, 0], [-200, 220, 0], [0.12, 0.3, 0.32], MAT.WATER);
    // land
    const st = 3;
    for (let y = -40; y < 170; y += st) for (let x = -150; x < 150; x += st) {
        const P = (a, b) => [a, b, landZ(a, b)];
        const p = [P(x, y), P(x + st, y), P(x + st, y + st), P(x, y + st)];
        if (Math.max(p[0][2], p[1][2], p[2][2], p[3][2]) < -0.05) continue;
        const h = (p[0][2] + p[2][2]) / 2, n = fbm(x * 0.1, y * 0.1, 5, 2);
        let c = h < 0.7 ? [0.4 + n * 0.1, 0.36 + n * 0.08, 0.24] : [0.16 + n * 0.08, 0.28 + n * 0.1, 0.13];
        if (h > 26) c = [0.42, 0.42, 0.45];
        S.quad(p[0], p[1], p[2], p[3], c, MAT.MATTE);
    }
    // pines on the hills
    for (let k = 0; k < 420; k++) {
        const x = (r() - 0.5) * 260, y = -30 + r() * 170, z = landZ(x, y);
        if (z < 0.6 || z > 24 || (Math.abs(x) < 7 && y < -10)) continue;
        pine(S, Sh, x, y, z, 1.2 + r() * 1.6, r);
    }
    // distant mountains with snow
    for (let k = 0; k < 13; k++) {
        const x = -260 + k * 44 + (r() - 0.5) * 20, y = 190 + r() * 60, h = 45 + r() * 50, rad = 40 + r() * 25;
        tube(S, x, y, 8, rad, 0, 0, h, [0.24, 0.26, 0.32], MAT.MATTE, r() * 6, false);
        tube(S, x, y - 0.5, 8, rad * 0.32, h * 0.68, 0, h + 0.4, [0.85, 0.88, 0.95], MAT.MATTE, r() * 6, false);
    }
    // the reed bed
    const Z = ZONES.reeds;
    for (let k = 0; k < 520; k++) {
        const x = Z.x0 + 6 + r() * (Z.x1 - Z.x0 + 10), y = Z.y0 - 6 + r() * (Z.y1 - Z.y0 + 6);
        if (inLake(x, y, 4) && x < 24) continue;
        const h = 1.4 + r() * 1.8, lean = (r() - 0.5) * 0.5, c = [0.3 + r() * 0.15, 0.36 + r() * 0.1, 0.12];
        S.tri([x - 0.05, y, -0.3], [x + 0.05, y, -0.3], [x + lean, y + lean * 0.3, h], c, MAT.MATTE);
        if (r() < 0.2) blob(S, [x + lean * 0.9, y + lean * 0.27, h - 0.2], 0.07, 0.07, 0.26, [0.32, 0.2, 0.12], MAT.MATTE, 5, 3);
    }
    // lily pads and flowers in the shallows
    const LZ = ZONES.shallows;
    for (let k = 0; k < 70; k++) {
        const x = LZ.x0 + r() * (LZ.x1 - LZ.x0), y = LZ.y0 + r() * (LZ.y1 - LZ.y0), rad = 0.5 + r() * 0.7, a0 = r() * 6.28;
        if (!inLake(x, y, 1)) continue;
        for (let i = 1; i < 14; i++) {
            const a = a0 + (i / 14) * 6.283, b = a0 + ((i + 1) / 14) * 6.283;
            S.tri([x, y, 0.03], [x + Math.cos(a) * rad, y + Math.sin(a) * rad, 0.03], [x + Math.cos(b) * rad, y + Math.sin(b) * rad, 0.03], i % 2 ? [0.14, 0.34, 0.14] : [0.17, 0.4, 0.17], MAT.MATTE);
        }
        if (r() < 0.3) for (let p = 0; p < 7; p++) { const a = (p / 7) * 6.28; S.tri([x, y, 0.06], [x + Math.cos(a - 0.3) * 0.12, y + Math.sin(a - 0.3) * 0.12, 0.08], [x + Math.cos(a) * 0.28, y + Math.sin(a) * 0.28, 0.3], [1.0, 0.62, 0.78], MAT.MATTE); }
    }
    // far rocks
    const RZ = ZONES.rocks;
    for (let k = 0; k < 16; k++) {
        const x = RZ.x0 - 4 + r() * 10, y = RZ.y0 + r() * (RZ.y1 - RZ.y0), s = 1 + r() * 2.2, g = 0.32 + r() * 0.1;
        blob(S, [x, y, -0.4], s * 1.2, s, s * 0.8, [g, g * 0.98, g * 0.95], MAT.GLOSS, 7, 4, (i, j) => 0.85 + ((i * 5 + j * 3 + k) % 4) * 0.07);
        if (r() < 0.5) blob(S, [x + s * 0.4, y, s * 0.4], s * 0.5, s * 0.5, s * 0.25, [0.2, 0.32, 0.15], MAT.MATTE, 6, 3);
    }
    // the dock
    const wood = [0.38, 0.27, 0.18];
    for (let k = 0; k < 26; k++) {
        const y0 = -19 + k * 0.48, c = wood.map((v) => v * (0.82 + ((k * 7) % 5) * 0.06));
        S.quad([-1.5, y0, 0.62], [1.5, y0, 0.62], [1.5, y0 + 0.44, 0.62], [-1.5, y0 + 0.44, 0.62], c, MAT.MATTE);
        S.quad([-1.5, y0, 0.5], [1.5, y0, 0.5], [1.5, y0, 0.62], [-1.5, y0, 0.62], c.map((v) => v * 0.6), MAT.MATTE);
    }
    for (const sx of [-1.45, 1.45]) for (let y = -18.5; y <= -6.5; y += 3) limb(S, [sx, y, -2], [sx, y, 0.95], 0.13, 0.12, wood.map((v) => v * 0.7), MAT.MATTE, 6);
    // tackle box and bucket
    S.quad([-1.1, -10.8, 0.95], [-0.3, -10.8, 0.95], [-0.3, -10.3, 0.95], [-1.1, -10.3, 0.95], [0.25, 0.4, 0.3], MAT.GLOSS);
    for (const [ax, ay, bx, by] of [[-1.1, -10.8, -0.3, -10.8], [-0.3, -10.8, -0.3, -10.3], [-0.3, -10.3, -1.1, -10.3], [-1.1, -10.3, -1.1, -10.8]]) S.quad([ax, ay, 0.62], [bx, by, 0.62], [bx, by, 0.95], [ax, ay, 0.95], [0.2, 0.33, 0.25], MAT.GLOSS);
    tube(S, -0.9, -8.6, 10, 0.3, 0.62, 0.36, 1.15, [0.55, 0.57, 0.6], MAT.GLOSS, 0, false);
    // lantern post at the end of the dock
    limb(S, [LANTERN[0], LANTERN[1], 0.6], [LANTERN[0], LANTERN[1], LANTERN[2] + 0.5], 0.06, 0.06, [0.2, 0.15, 0.1], MAT.MATTE, 5);
    tube(S, LANTERN[0], LANTERN[1], 6, 0.18, LANTERN[2] - 0.22, 0.18, LANTERN[2] + 0.22, [1.6, 1.0, 0.45], MAT.EMIT);
    tube(S, LANTERN[0], LANTERN[1], 6, 0.26, LANTERN[2] + 0.22, 0, LANTERN[2] + 0.48, [0.12, 0.1, 0.08], MAT.GLOSS);
    A.sprite(LANTERN[0], LANTERN[1], LANTERN[2], 1.3, 0.35, 0.22, 0.08);
}
