// Low-poly models for Borealis. Each mesh is a flat triangle list in local space
// (x right, y forward, z up) with per-vertex colours; game.js transforms and lights them.

const TAU = Math.PI * 2;

class MeshBuilder {
    constructor() { this.p = []; this.c = []; }
    tri(a, b, c, ca, cb = ca, cc = ca) {
        this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
        return this;
    }
    quad(a, b, c, d, col) { return this.tri(a, b, c, col).tri(a, c, d, col); }
    // axis-aligned box; bottom face omitted (never seen)
    box(cx, cy, z0, w, d, h, col, top = col) {
        const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, z1 = z0 + h;
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
        this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], col);
        this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], col);
        this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col);
        return this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], top);
    }
    pyramid(cx, cy, z0, half, h, col) {
        const a = [cx - half, cy - half, z0], b = [cx + half, cy - half, z0];
        const c = [cx + half, cy + half, z0], d = [cx - half, cy + half, z0], t = [cx, cy, z0 + h];
        return this.tri(a, b, t, col).tri(b, c, t, col).tri(c, d, t, col).tri(d, a, t, col);
    }
    // flat annulus in the xy plane
    ring(rIn, rOut, segs, col) {
        for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
            const i0 = [Math.cos(a0) * rIn, Math.sin(a0) * rIn, 0], o0 = [Math.cos(a0) * rOut, Math.sin(a0) * rOut, 0];
            const i1 = [Math.cos(a1) * rIn, Math.sin(a1) * rIn, 0], o1 = [Math.cos(a1) * rOut, Math.sin(a1) * rOut, 0];
            this.quad(i0, o0, o1, i1, col);
        }
        return this;
    }
    build() { return { p: Float32Array.from(this.p), c: Float32Array.from(this.c), n: this.p.length / 9 }; }
}

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// rotation Rz(yaw) * Ry(roll) * Rx(pitch), then per-axis scale; row-major 3x3
export function rot(yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
    const cy = Math.cos(yaw), sY = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const a00 = cr, a01 = sr * sp, a02 = sr * cp, a11 = cp, a12 = -sp, a20 = -sr, a21 = cr * sp, a22 = cr * cp;
    return [
        cy * a00 * sx, (cy * a01 - sY * a11) * sy, (cy * a02 - sY * a12) * sz,
        sY * a00 * sx, (sY * a01 + cy * a11) * sy, (sY * a02 + cy * a12) * sz,
        a20 * sx, a21 * sy, a22 * sz,
    ];
}

export function transformPoint(M, p, tx, ty, tz) {
    return [
        M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + tx,
        M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + ty,
        M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + tz,
    ];
}

// ------------------------------------------------------------------ glider

function glider() {
    const m = new MeshBuilder();
    const N = [0, 2.3, 0.1], T = [0, -0.2, 0.6], L = [-1.9, -1.35, -0.02], R = [1.9, -1.35, -0.02];
    const BL = [-0.55, -1.3, 0.34], BR = [0.55, -1.3, 0.34], B = [0, -0.45, -0.32], C = [0, -1.45, 0.04];
    const hull = [0.93, 0.96, 1.0], hull2 = [0.7, 0.76, 0.88], dark = [0.14, 0.17, 0.28], fin = [0.36, 0.9, 0.78];
    m.tri(N, L, T, hull).tri(N, T, R, hull)
        .tri(T, L, BL, hull2).tri(T, BR, R, hull2).tri(T, BL, BR, hull2)
        .tri(L, BL, C, dark).tri(BR, R, C, dark).tri(BL, BR, C, dark)
        .tri(N, B, L, dark).tri(N, R, B, dark).tri(L, B, C, dark).tri(B, R, C, dark);
    const F = [0, 1.25, 0.36], Lc = [-0.34, 0.05, 0.5], Rc = [0.34, 0.05, 0.5], K = [0, 0.35, 0.8];
    const glass = [0.26, 0.48, 0.78], glass2 = [0.52, 0.76, 0.96];
    m.tri(F, Lc, K, glass2).tri(F, K, Rc, glass2).tri(Lc, T, K, glass).tri(K, T, Rc, glass);
    m.tri(L, [-1.95, -1.85, -0.02], [-1.78, -1.62, 0.72], fin).tri(R, [1.95, -1.85, -0.02], [1.78, -1.62, 0.72], fin);
    return m.build();
}

function gliderLights() {
    const m = new MeshBuilder();
    m.tri([-0.3, -1.47, 0.24], [0.3, -1.47, 0.24], [0, -1.47, 0.02], [0.75, 1.0, 0.9]);
    m.tri([-1.92, -1.35, 0.0], [-1.72, -1.2, 0.03], [-1.86, -1.55, 0.06], [0.72, 0.56, 1.0]);
    m.tri([1.92, -1.35, 0.0], [1.72, -1.2, 0.03], [1.86, -1.55, 0.06], [0.4, 1.0, 0.72]);
    return m.build();
}

// ------------------------------------------------------------------ ice spire (hexagonal bipyramid, unit height)

function spire() {
    const m = new MeshBuilder();
    const n = 6, top = [0, 0, 1], bot = [0, 0, 0], zr = 0.3;
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        const r0 = [Math.cos(a0), Math.sin(a0), zr], r1 = [Math.cos(a1), Math.sin(a1), zr];
        const even = i % 2 === 0;
        const up = even ? [0.84, 0.94, 1.0] : [0.64, 0.76, 1.0];
        const down = even ? [0.36, 0.5, 0.86] : [0.28, 0.4, 0.78];
        m.tri(top, r0, r1, [0.98, 1.0, 1.0], up, up);
        m.tri(bot, r1, r0, [0.2, 0.3, 0.6], down, down);
    }
    return m.build();
}

// ------------------------------------------------------------------ ember (icosahedron) and pickups

function icosa(radius, colA, colB) {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const v = raw.map((p) => { const k = radius / Math.hypot(p[0], p[1], p[2]); return [p[0] * k, p[1] * k, p[2] * k]; });
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const m = new MeshBuilder();
    f.forEach((q, i) => m.tri(v[q[0]], v[q[1]], v[q[2]], i % 2 ? colA : colB));
    return m.build();
}

function octa(r, colA, colB) {
    const m = new MeshBuilder();
    const px = [r, 0, 0], nx = [-r, 0, 0], py = [0, r, 0], ny = [0, -r, 0], pz = [0, 0, r], nz = [0, 0, -r];
    m.tri(pz, px, py, colA).tri(pz, py, nx, colB).tri(pz, nx, ny, colA).tri(pz, ny, px, colB);
    m.tri(nz, py, px, colB).tri(nz, nx, py, colA).tri(nz, ny, nx, colB).tri(nz, px, ny, colA);
    return m.build();
}

// ------------------------------------------------------------------ frost wall (must be jumped)

function wallBody(w) {
    const m = new MeshBuilder();
    m.box(0, 0, 0, w, 1.1, 1.7, [0.56, 0.78, 0.94], [0.8, 0.93, 1.0]);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let x = -w / 2 + 0.55; x < w / 2 - 0.4; x += 1.2) {
        m.pyramid(x, 0, 1.7, 0.45, 0.35 + rnd() * 0.5, [0.84, 0.95, 1.0]);
    }
    return m.build();
}

function wallGlow(w) {
    return new MeshBuilder().box(0, -0.57, 0.05, w, 0.04, 0.24, [0.45, 0.95, 1.0]).build();
}

// ------------------------------------------------------------------ riverbank lanterns

function pole() {
    const m = new MeshBuilder();
    m.box(0, 0, 0, 0.26, 0.26, 3.1, [0.13, 0.16, 0.26]);
    m.pyramid(0, 0, 3.9, 0.52, 0.38, [0.1, 0.12, 0.2]);
    return m.build();
}

function disc(segs, col) {
    const m = new MeshBuilder();
    for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        m.tri([0, 0, 0], [Math.cos(a0), Math.sin(a0), 0], [Math.cos(a1), Math.sin(a1), 0], col);
    }
    return m.build();
}

export const MESH = {
    GLIDER: glider(),
    GLIDER_LIGHTS: gliderLights(),
    SPIRE: spire(),
    FROST_RING: new MeshBuilder().ring(1.9, 2.4, 6, [0.5, 0.85, 1.0]).build(),
    EMBER: icosa(0.72, [1.0, 0.74, 0.34], [1.0, 0.56, 0.2]),
    EMBER_RING: new MeshBuilder().ring(1.05, 1.22, 20, [1.0, 0.66, 0.3]).build(),
    SHIELD: octa(1.0, [0.45, 1.0, 0.72], [0.62, 0.5, 1.0]),
    SHIELD_RING: new MeshBuilder().ring(2.25, 2.45, 28, [0.4, 1.0, 0.75]).build(),
    WALL_WIDE: wallBody(26), WALL_WIDE_GLOW: wallGlow(26),
    WALL_HALF: wallBody(13.4), WALL_HALF_GLOW: wallGlow(13.4),
    POLE: pole(),
    LANTERN: new MeshBuilder().box(0, 0, 0, 0.62, 0.62, 0.78, [1.0, 0.72, 0.38]).build(),
    SHADOW: disc(14, [0.02, 0.06, 0.1]),
};
