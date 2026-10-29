// Vertex writer in Space's format (pos = x, y, z, w · col = r, g, b, material) and small geometry helpers.
// Materials are documented in shaders.js / DESIGN.md.

export const MAT = { MATTE: 0, GLOSS: 1, GEM: 2, BG: 3, SPRITE: 4, EMIT: 5, SHADOW: 6, ADD: 7, ICE: 8 };

export class Mesh {
    constructor(verts = 65536) { this.pos = new Float32Array(verts * 4); this.col = new Float32Array(verts * 4); this.n = 0; }
    reset() { this.n = 0; }
    grow() {
        const p = new Float32Array(this.pos.length * 2), c = new Float32Array(this.col.length * 2);
        p.set(this.pos); c.set(this.col); this.pos = p; this.col = c;
    }
    v(x, y, z, w, r, g, b, mat) {
        if ((this.n + 1) * 4 > this.pos.length) this.grow();
        const o = this.n++ * 4;
        this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.pos[o + 3] = w;
        this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b; this.col[o + 3] = mat;
    }
    tri(a, b, c, col, mat = 0) {
        this.v(a[0], a[1], a[2], a[3] ?? 1, col[0], col[1], col[2], mat);
        this.v(b[0], b[1], b[2], b[3] ?? 1, col[0], col[1], col[2], mat);
        this.v(c[0], c[1], c[2], c[3] ?? 1, col[0], col[1], col[2], mat);
    }
    // a triangle with a colour per corner
    tri3(a, b, c, ca, cb, cc, mat = 0) {
        this.v(a[0], a[1], a[2], a[3] ?? 1, ca[0], ca[1], ca[2], mat);
        this.v(b[0], b[1], b[2], b[3] ?? 1, cb[0], cb[1], cb[2], mat);
        this.v(c[0], c[1], c[2], c[3] ?? 1, cc[0], cc[1], cc[2], mat);
    }
    quad(a, b, c, d, col, mat = 0) { this.tri(a, b, c, col, mat); this.tri(a, c, d, col, mat); }
    quad4(a, b, c, d, ca, cb, cc, cd, mat = 0) { this.tri3(a, b, c, ca, cb, cc, mat); this.tri3(a, c, d, ca, cc, cd, mat); }
    // camera-facing soft glow (expanded in the vertex shader); size < 100
    sprite(x, y, z, size, r, g, b) { for (const k of [0, 1, 2, 0, 2, 3]) this.v(x, y, z, Math.min(99, size) + k * 100, r, g, b, MAT.SPRITE); }
    append(o) {
        while ((this.n + o.n) * 4 > this.pos.length) this.grow();
        this.pos.set(o.pos.subarray(0, o.n * 4), this.n * 4); this.col.set(o.col.subarray(0, o.n * 4), this.n * 4);
        this.n += o.n;
    }
}

const TAU = Math.PI * 2;

// a cone/prism ring from radius r0 at z0 to r1 at z1 around a vertical axis; r1 = 0 makes a cone
export function tube(m, cx, cy, n, r0, z0, r1, z1, col, mat = 0, rot = 0, cap = true) {
    const p = (r, a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
    for (let i = 0; i < n; i++) {
        const a0 = rot + (i / n) * TAU, a1 = rot + ((i + 1) / n) * TAU;
        if (r1 === 0) m.tri(p(r0, a0, z0), p(r0, a1, z0), [cx, cy, z1], col, mat);
        else m.quad(p(r0, a0, z0), p(r0, a1, z0), p(r1, a1, z1), p(r1, a0, z1), col, mat);
        if (cap && r1 > 0) m.tri([cx, cy, z1], p(r1, a0, z1), p(r1, a1, z1), col, mat);
    }
}

// a tube along an arbitrary segment a → b (radius ra → rb)
export function limb(m, a, b, ra, rb, col, mat = 0, n = 5) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const w = [d[0] / L, d[1] / L, d[2] / L];
    const up = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = cross(w, up); u = norm(u);
    const v = cross(w, u);
    const ring = (c, r, k) => { const t = (k / n) * TAU, cs = Math.cos(t) * r, sn = Math.sin(t) * r; return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]; };
    for (let k = 0; k < n; k++) {
        if (rb === 0) m.tri(ring(a, ra, k), ring(a, ra, k + 1), b, col, mat);
        else m.quad(ring(a, ra, k), ring(a, ra, k + 1), ring(b, rb, k + 1), ring(b, rb, k), col, mat);
    }
}

// lumpy sphere/ellipsoid: centre c, radii (rx, ry, rz), `bump(i, j)` returns a radius multiplier
export function blob(m, c, rx, ry, rz, col, mat = 0, seg = 8, rings = 6, bump = null, colFn = null) {
    const P = (i, j) => {
        const th = (j / rings) * Math.PI, ph = (i / seg) * TAU;
        const k = bump ? bump(i % seg, j) : 1;
        return [c[0] + Math.sin(th) * Math.cos(ph) * rx * k, c[1] + Math.sin(th) * Math.sin(ph) * ry * k, c[2] + Math.cos(th) * rz * k];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const cc = colFn ? colFn(i, j) : col;
        if (j === 0) m.tri(P(i, 0), P(i, 1), P(i + 1, 1), cc, mat);
        else if (j === rings - 1) m.tri(P(i, j), P(i, j + 1), P(i + 1, j), cc, mat);
        else m.quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), cc, mat);
    }
}

// a flat ribbon through a polyline, widened in the X–Z plane (the camera looks along +Y), colour per point
export function ribbon(m, pts, width, colAt, mat = MAT.ADD) {
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b[0] - a[0], dz = b[2] - a[2];
        const l = Math.hypot(dx, dz) || 1e-6; dx /= l; dz /= l;
        const wa = typeof width === "function" ? width(i / (pts.length - 1)) : width;
        const wb = typeof width === "function" ? width((i + 1) / (pts.length - 1)) : width;
        const nax = -dz * wa, naz = dx * wa, nbx = -dz * wb, nbz = dx * wb;
        const ca = colAt(i / (pts.length - 1)), cb = colAt((i + 1) / (pts.length - 1));
        m.quad4([a[0] - nax, a[1], a[2] - naz], [a[0] + nax, a[1], a[2] + naz], [b[0] + nbx, b[1], b[2] + nbz], [b[0] - nbx, b[1], b[2] - nbz], ca, ca, cb, cb, mat);
    }
}

export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// seeded RNG and value noise
export function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hash2(i, j, s) {
    let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, s = 0) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export function fbm(x, y, s = 0, oct = 4) {
    let a = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { a += vnoise(x * f, y * f, s + o * 17) * amp; f *= 2.03; amp *= 0.5; }
    return a;
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
