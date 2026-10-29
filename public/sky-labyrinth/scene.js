// Sky Labyrinth scenery (world coordinates): floating islands in the isle's style, waterfalls, birds and
// drifting particles. The tablet sits at the origin; the camera looks at it from −y, so islands are placed in
// front of and below it, where the view opens onto the sea of clouds.

import { MAT, limb, blob, tube, mulberry32, mixc, lerp } from "./mesh.js";

const TAU = Math.PI * 2;
const SPOTS = [
    [-22, 30, -18, 4.2], [24, 36, -20, 5.5], [-30, 48, -16, 8], [8, 58, -24, 9], [38, 46, -14, 6.5],
    [-20, 4, -30, 3.2], [22, 2, -32, 3.6], [-44, 18, -28, 6], [44, 12, -30, 6], [-6, 90, -30, 14], [30, 95, -26, 10],
];

export function buildScene(isleIndex, isle, O, A) {
    const rnd = mulberry32(977 + isleIndex * 131);
    SPOTS.forEach(([x, y, z, r], i) => island(O, A, isle, isleIndex, x + (rnd() - 0.5) * 4, y + (rnd() - 0.5) * 4, z, r, rnd, i));
}

function island(O, A, isle, kind, cx, cy, z0, r, rnd, idx) {
    const seg = 22, rim = [];
    for (let i = 0; i < seg; i++) rim.push(0.75 + rnd() * 0.4);
    const P = (i, k, z) => { const a = (i % seg) / seg * TAU; return [cx + Math.cos(a) * r * rim[i % seg] * k, cy + Math.sin(a) * r * rim[i % seg] * k * 0.8, z]; };
    const grass = [[0.55, 0.62, 0.32], [0.9, 0.94, 1.0], [0.42, 0.62, 0.3], [0.25, 0.18, 0.2]][kind];
    const rock = mixc(isle.wall, [0.4, 0.34, 0.36], 0.5), rock2 = mixc(rock, [0.12, 0.1, 0.12], 0.55);
    // grass top (a fan) with a lip
    for (let i = 0; i < seg; i++) {
        const g = mixc(grass, [0, 0, 0], rnd() * 0.12);
        O.tri([cx, cy, z0 + 0.25], P(i, 1, z0), P(i + 1, 1, z0), g, MAT.MATTE);
        O.quad(P(i, 1, z0), P(i + 1, 1, z0), P(i + 1, 1.02, z0 - r * 0.12), P(i, 1.02, z0 - r * 0.12), mixc(grass, rock, 0.5), MAT.MATTE);
    }
    // rocky underside: rings narrowing to a point
    const rings = 6, depth = r * 1.7;
    const noise = []; for (let j = 0; j <= rings; j++) { noise.push([]); for (let i = 0; i < seg; i++) noise[j].push(0.85 + rnd() * 0.3); }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const k0 = Math.pow(1 - j / rings, 1.3) * 1.02 * noise[j][i], k0b = Math.pow(1 - j / rings, 1.3) * 1.02 * noise[j][(i + 1) % seg];
        const k1 = Math.pow(1 - (j + 1) / rings, 1.3) * 1.02 * noise[j + 1][i], k1b = Math.pow(1 - (j + 1) / rings, 1.3) * 1.02 * noise[j + 1][(i + 1) % seg];
        const za = z0 - r * 0.12 - (j / rings) * depth, zb = z0 - r * 0.12 - ((j + 1) / rings) * depth;
        const col = mixc(rock, rock2, j / rings);
        const a = P(i, k0, za), b = P(i + 1, k0b, za), c = P(i + 1, k1b, zb), d = P(i, k1, zb);
        for (const p of [a, b, c, a, c, d]) O.v(p[0], p[1], p[2], 2, col[0], col[1], col[2], MAT.MATTE);
    }
    // trees / ruins
    const nT = Math.round(r * 0.9);
    for (let t = 0; t < nT; t++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.6, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8, s = 0.6 + rnd() * 0.6;
        const z = z0 + 0.25 * (1 - d / r);
        if (kind === 0) {           // cherry blossom
            limb(O, [x, y, z], [x + 0.2, y, z + 1.6 * s], 0.16 * s, 0.08 * s, [0.36, 0.24, 0.2], MAT.MATTE, 5);
            const pink = mixc([1.0, 0.68, 0.78], [1, 0.9, 0.92], rnd() * 0.5);
            for (let k = 0; k < 3; k++) blob(O, [x + (rnd() - 0.5) * 1.2 * s, y + (rnd() - 0.5) * 1.2 * s, z + (1.8 + rnd() * 0.6) * s], 0.9 * s, 0.9 * s, 0.7 * s, pink, MAT.MATTE, 7, 5, (i, j) => 0.85 + ((i * 7 + j * 3) % 5) * 0.06);
        } else if (kind === 1) {    // snowy pine
            limb(O, [x, y, z], [x, y, z + 0.6 * s], 0.12 * s, 0.1 * s, [0.3, 0.24, 0.22], MAT.MATTE, 5);
            for (let k = 0; k < 3; k++) {
                tube(O, x, y, 7, (1.0 - k * 0.25) * s, z + (0.5 + k * 0.7) * s, 0, z + (1.6 + k * 0.7) * s, k === 2 ? [0.92, 0.95, 1.0] : [0.2, 0.36, 0.34], MAT.MATTE, rnd(), false);
                tube(O, x, y, 7, (0.95 - k * 0.25) * s * 0.7, z + (0.9 + k * 0.7) * s, 0, z + (1.62 + k * 0.7) * s, [0.92, 0.95, 1.0], MAT.MATTE, rnd(), false);
            }
        } else if (kind === 2) {    // topiary + brass
            limb(O, [x, y, z], [x, y, z + 1.0 * s], 0.1 * s, 0.08 * s, [0.36, 0.26, 0.18], MAT.MATTE, 5);
            blob(O, [x, y, z + 1.4 * s], 0.75 * s, 0.75 * s, 0.75 * s, mixc([0.3, 0.55, 0.25], [0.5, 0.7, 0.3], rnd()), MAT.MATTE, 9, 6);
            if (t % 3 === 0) tube(O, x + 1, y, 10, 0.3 * s, z, 0.3 * s, z + 0.8 * s, isle.trim, MAT.GOLD, 0, true);
        } else {                    // charred trees + glowing cracks
            const top = [x + (rnd() - 0.5), y + (rnd() - 0.5), z + 1.8 * s];
            limb(O, [x, y, z], top, 0.14 * s, 0.05 * s, [0.12, 0.08, 0.08], MAT.MATTE, 5);
            for (let k = 0; k < 3; k++) limb(O, [lerp(x, top[0], 0.6), lerp(y, top[1], 0.6), lerp(z, top[2], 0.6)], [top[0] + (rnd() - 0.5) * 1.5 * s, top[1] + (rnd() - 0.5) * 1.5 * s, top[2] + rnd() * 0.5], 0.05 * s, 0.01, [0.12, 0.08, 0.08], MAT.MATTE, 4);
            A.sprite(x, y, z + 0.2, 0.9 * s, 0.35, 0.1, 0.02);
        }
    }
    // a few ruined columns
    if (r > 4) for (let k = 0; k < 3; k++) {
        const a = rnd() * TAU, d = r * (0.3 + rnd() * 0.35), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8, h = 1 + rnd() * 2;
        const col = mixc(isle.stone, [1, 1, 1], 0.1);
        tube(O, x, y, 8, 0.32, z0 + 0.1, 0.28, z0 + h, col, MAT.MATTE, 0, true);
        tube(O, x, y, 4, 0.45, z0 + h, 0.45, z0 + h + 0.2, col, MAT.MATTE, Math.PI / 4, true);
    }
    // waterfall (lava on the Ember isle, none on Frost)
    if (kind !== 1 && idx % 2 === 0) {
        const a = Math.PI * 1.5 + (rnd() - 0.5) * 0.8, ex = cx + Math.cos(a) * r * 0.95, ey = cy + Math.sin(a) * r * 0.76;
        const water = kind === 3 ? [1.0, 0.4, 0.1] : [0.55, 0.75, 0.95], len = r * 2.2, w = 0.35 + r * 0.05;
        const nx = -Math.sin(a), ny = Math.cos(a);
        for (let k = 0; k < 10; k++) {
            const t0 = k / 10, t1 = (k + 1) / 10, f0 = (1 - t0) * 0.55, f1 = (1 - t1) * 0.55;
            const o0 = Math.sqrt(t0) * 1.2, o1 = Math.sqrt(t1) * 1.2, w0 = w * (1 + t0 * 0.6), w1 = w * (1 + t1 * 0.6);
            A.quad4([ex - nx * w0 + Math.cos(a) * o0, ey - ny * w0 + Math.sin(a) * o0, z0 - t0 * len], [ex + nx * w0 + Math.cos(a) * o0, ey + ny * w0 + Math.sin(a) * o0, z0 - t0 * len],
                [ex + nx * w1 + Math.cos(a) * o1, ey + ny * w1 + Math.sin(a) * o1, z0 - t1 * len], [ex - nx * w1 + Math.cos(a) * o1, ey - ny * w1 + Math.sin(a) * o1, z0 - t1 * len],
                water.map((v) => v * f0), water.map((v) => v * f0), water.map((v) => v * f1), water.map((v) => v * f1), MAT.ADD);
        }
        A.sprite(ex + Math.cos(a) * 1.2, ey + Math.sin(a) * 1.2, z0 - len, 2.5, water[0] * 0.15, water[1] * 0.15, water[2] * 0.15);
    }
}

// ------------------------------------------------------------------ birds and drifting particles (per frame)
export function makeFlock(rnd) {
    const b = [];
    for (let i = 0; i < 9; i++) b.push({ r: 22 + rnd() * 18, a: rnd() * TAU, z: -4 + rnd() * 6, sp: (0.05 + rnd() * 0.04) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * TAU, cy: 18 + rnd() * 10 });
    return b;
}
export function drawFlock(D, flock, t, dark) {
    for (const b of flock) {
        const a = b.a + t * b.sp, x = Math.cos(a) * b.r, y = b.cy + Math.sin(a) * b.r * 0.6, z = b.z + Math.sin(t * 0.5 + b.ph) * 0.8;
        const hx = -Math.sin(a) * Math.sign(b.sp), hy = Math.cos(a) * 0.6 * Math.sign(b.sp), hl = Math.hypot(hx, hy), fx = hx / hl, fy = hy / hl;
        const sx = -fy, sy = fx, flap = Math.sin(t * 9 + b.ph) * 0.35, s = 0.55;
        D.tri([x + fx * 0.25 * s, y + fy * 0.25 * s, z], [x - fx * 0.2 * s, y - fy * 0.2 * s, z], [x + sx * 1.0 * s, y + sy * 1.0 * s, z + flap * s], dark, MAT.MATTE);
        D.tri([x + fx * 0.25 * s, y + fy * 0.25 * s, z], [x - fx * 0.2 * s, y - fy * 0.2 * s, z], [x - sx * 1.0 * s, y - sy * 1.0 * s, z + flap * s], dark, MAT.MATTE);
    }
}
export function makeMotes(rnd, n = 60) {
    const m = [];
    for (let i = 0; i < n; i++) m.push({ x: (rnd() - 0.5) * 30, y: (rnd() - 0.5) * 24, z: rnd() * 8 - 1, ph: rnd() * TAU, s: 0.6 + rnd() * 0.8 });
    return m;
}
export function drawMotes(A, motes, t, dt, isle) {
    const kind = isle.kind, c = isle.particle;
    for (const p of motes) {
        if (kind === "snow") { p.z -= dt * 0.6 * p.s; p.x += Math.sin(t * 0.7 + p.ph) * dt * 0.3; }
        else if (kind === "ember") { p.z += dt * 0.5 * p.s; p.x += Math.sin(t * 1.3 + p.ph) * dt * 0.4; }
        else { p.z -= dt * 0.25 * p.s; p.x += dt * 0.6 * p.s; p.y += Math.sin(t * 0.9 + p.ph) * dt * 0.3; }
        if (p.z < -2) p.z += 10; if (p.z > 8) p.z -= 10; if (p.x > 15) p.x -= 30; if (p.x < -15) p.x += 30;
        const tw = kind === "ember" ? 0.6 + 0.4 * Math.sin(t * 6 + p.ph) : 1;
        const k = (kind === "snow" ? 0.18 : kind === "ember" ? 0.3 : 0.16) * tw;
        A.sprite(p.x, p.y, p.z, kind === "ember" ? 0.07 : 0.09, c[0] * k, c[1] * k, c[2] * k);
    }
}
