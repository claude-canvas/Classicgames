// Chess piece models. Lathe-turned profiles (pawn, rook, bishop, queen, king) and a sculpted knight head built
// from an extruded side profile. Built once per type in local space (unit square, z up), stamped per frame.
// White pieces are MARBLE, black pieces OBSIDIAN.

import { MAT } from "./mesh.js";
import { P, N, B, R, Q, K } from "./chess.js";

const TAU = Math.PI * 2, SEG = 22;
const BASE = [[0.34, 0], [0.35, 0.035], [0.33, 0.07], [0.28, 0.09], [0.29, 0.12], [0.24, 0.15]];

function lathe(profile, seg = SEG) {
    const tris = [];
    for (let k = 0; k < profile.length - 1; k++) {
        const [r0, z0] = profile[k], [r1, z1] = profile[k + 1];
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
            const p = (r, z, a) => [Math.cos(a) * r, Math.sin(a) * r, z];
            if (r0 === 0) tris.push([p(0, z0, 0), p(r1, z1, a1), p(r1, z1, a0)]);
            else if (r1 === 0) tris.push([p(r0, z0, a0), p(r0, z0, a1), p(0, z1, 0)]);
            else tris.push([p(r0, z0, a0), p(r0, z0, a1), p(r1, z1, a1)], [p(r0, z0, a0), p(r1, z1, a1), p(r1, z1, a0)]);
        }
    }
    const top = profile[profile.length - 1];
    if (top[0] > 0) for (let i = 0; i < seg; i++) { const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU; tris.push([[0, 0, top[1]], [Math.cos(a0) * top[0], Math.sin(a0) * top[0], top[1]], [Math.cos(a1) * top[0], Math.sin(a1) * top[0], top[1]]]); }
    return tris;
}
function box(cx, cy, z0, w, d, h) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, z1 = z0 + h, t = [];
    const q = (a, b, c, d2) => t.push([a, b, c], [a, c, d2]);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
    return t;
}
function sphere(cz, r, rings = 8) {
    const prof = [];
    for (let j = 0; j <= rings; j++) { const th = Math.PI - (j / rings) * Math.PI; prof.push([Math.sin(th) * r, cz + Math.cos(th) * r]); }
    prof[0][0] = 0; prof[prof.length - 1][0] = 0;
    return lathe(prof, 16);
}

const MODELS = {};
MODELS[P] = [...lathe([...BASE, [0.15, 0.21], [0.11, 0.33], [0.17, 0.36], [0.17, 0.38], [0.1, 0.41]]), ...sphere(0.5, 0.125)];
MODELS[R] = (() => {
    const t = lathe([...BASE, [0.21, 0.2], [0.18, 0.5], [0.24, 0.55], [0.25, 0.7], [0.18, 0.7], [0.18, 0.66], [0, 0.66]]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; t.push(...box(Math.cos(a) * 0.205, Math.sin(a) * 0.205, 0.69, 0.1, 0.1, 0.1).map((tri) => tri.map(([x, y, z]) => { const ca = Math.cos(a), sa = Math.sin(a); const lx = x - Math.cos(a) * 0.205, ly = y - Math.sin(a) * 0.205; return [Math.cos(a) * 0.205 + lx * ca - ly * sa, Math.sin(a) * 0.205 + lx * sa + ly * ca, z]; }))); }
    return t;
})();
MODELS[B] = [...lathe([...BASE, [0.16, 0.21], [0.11, 0.48], [0.18, 0.51], [0.18, 0.53], [0.11, 0.55], [0.12, 0.6], [0.15, 0.68], [0.13, 0.78], [0.07, 0.86], [0.02, 0.9], [0, 0.905]]), ...sphere(0.94, 0.04)];
MODELS[Q] = (() => {
    const t = lathe([...BASE, [0.19, 0.21], [0.12, 0.6], [0.2, 0.64], [0.2, 0.66], [0.13, 0.69], [0.16, 0.8], [0.21, 0.9], [0.17, 0.9], [0.1, 0.96], [0, 0.97]]);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, a2 = a + TAU / 18; t.push([[Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0.9], [Math.cos(a2) * 0.2, Math.sin(a2) * 0.2, 0.99], [Math.cos(a + TAU / 9) * 0.21, Math.sin(a + TAU / 9) * 0.21, 0.9]]); }
    t.push(...sphere(1.01, 0.05));
    return t;
})();
MODELS[K] = [...lathe([...BASE, [0.2, 0.21], [0.13, 0.66], [0.21, 0.7], [0.21, 0.72], [0.14, 0.75], [0.18, 0.93], [0.12, 0.99], [0, 1.0]]), ...box(0, 0, 0.99, 0.055, 0.055, 0.24), ...box(0, 0, 1.09, 0.18, 0.055, 0.055)];
MODELS[N] = (() => {
    const t = lathe([...BASE, [0.2, 0.2], [0, 0.2]]);
    // side profile of the head and neck in (forward, up); extruded ±W across, with a bevelled rim
    const prof = [[-0.18, 0.18], [0.16, 0.18], [0.12, 0.3], [0.22, 0.4], [0.3, 0.48], [0.31, 0.55], [0.24, 0.6], [0.14, 0.63], [0.11, 0.72], [0.05, 0.8], [0.01, 0.72], [-0.05, 0.79], [-0.1, 0.68], [-0.18, 0.56], [-0.23, 0.4]];
    const W = 0.1, BV = 0.035, cx = -0.02, cz = 0.44;
    const inner = prof.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); return [x - dx / l * BV, z - dz / l * BV]; });
    const n = prof.length;
    for (const s of [-1, 1]) {
        for (let i = 0; i < n; i++) {
            const a = inner[i], b = inner[(i + 1) % n];
            t.push([[cx, s * W, cz], [a[0], s * W, a[1]], [b[0], s * W, b[1]]]);                                              // flat side
            const o0 = prof[i], o1 = prof[(i + 1) % n];
            t.push([[a[0], s * W, a[1]], [o0[0], s * (W - BV), o0[1]], [o1[0], s * (W - BV), o1[1]]], [[a[0], s * W, a[1]], [o1[0], s * (W - BV), o1[1]], [b[0], s * W, b[1]]]);   // bevel
        }
    }
    for (let i = 0; i < n; i++) { const o0 = prof[i], o1 = prof[(i + 1) % n]; t.push([[o0[0], -(W - BV), o0[1]], [o1[0], -(W - BV), o1[1]], [o1[0], W - BV, o1[1]]], [[o0[0], -(W - BV), o0[1]], [o1[0], W - BV, o1[1]], [o0[0], W - BV, o0[1]]]); }
    // a mane ridge down the back of the neck
    for (let k = 0; k < 5; k++) { const z = 0.66 - k * 0.09, x = -0.12 - k * 0.025; t.push([[x, -0.03, z], [x - 0.07, 0, z - 0.04], [x, 0.03, z]], [[x, 0.03, z], [x - 0.07, 0, z - 0.04], [x + 0.02, 0, z - 0.09]]); }
    return t;
})();
export const KNIGHT_EYES = [[0.17, 0.62], [0.17, 0.62]];

// stamp a piece: p = signed piece code; x, y = board position; z lift; yaw; scale; dim (for captured / ghost)
export function drawPiece(M, p, x, y, z, yaw = 0, s = 1, tint = null) {
    const t = Math.abs(p), white = p > 0, tris = MODELS[t];
    const col = tint || (white ? [0.93, 0.91, 0.86] : [0.07, 0.065, 0.08]);
    const mat = white ? MAT.MARBLE : MAT.OBSIDIAN;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const tf = ([lx, ly, lz]) => [x + (lx * c - ly * sn) * s, y + (lx * sn + ly * c) * s, z + lz * s];
    for (const [a, b, d] of tris) M.tri(tf(a), tf(b), tf(d), col, mat);
    if (t === N) for (const sd of [-1, 1]) { const e = tf([0.17, sd * 0.101, 0.62]); M.tri([e[0] - 0.02, e[1], e[2] - 0.02], [e[0] + 0.02, e[1], e[2] - 0.02], [e[0], e[1], e[2] + 0.025], white ? [0.15, 0.13, 0.12] : [0.6, 0.5, 0.75], MAT.GLOSS); }
}
