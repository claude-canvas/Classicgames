// Everything alive besides the jelly: coral halos, anglerfish, pufferfish, fish schools and siphonophore chains.
// Each has a mesh writer here; behaviour that touches the jelly lives in main.js.

import { MAT, tube, limb, blob, ribbon, lerp, mulberry32 } from "./mesh.js";

const TAU = Math.PI * 2;

// an oriented frame: forward f (in X–Z), side = +Y, up perpendicular to both
function frame(x, y, z, fx, fz) {
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const sgn = fx >= 0 ? 1 : -1;
    const up = [-fz * sgn, 0, fx * sgn];
    return (a, s, u) => [x + fx * a + up[0] * u, y + s, z + fz * a + up[2] * u];
}

// ellipsoid in a local frame P(a, s, u); colFn(i, j, latFrac) may vary the colour
function ell(m, P, ca, rs, ru, ox, col, mat = MAT.ROCK, seg = 10, rings = 6, bump = null, colFn = null) {
    const Q = (i, j) => {
        const th = (j / rings) * Math.PI, ph = (i / seg) * TAU, k = bump ? bump(i % seg, j) : 1;
        return P(ox + Math.cos(th) * ca * k, Math.sin(th) * Math.cos(ph) * rs * k, Math.sin(th) * Math.sin(ph) * ru * k);
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const c = colFn ? colFn(i, j) : col;
        if (j === 0) m.tri(Q(i, 0), Q(i, 1), Q(i + 1, 1), c, mat);
        else if (j === rings - 1) m.tri(Q(i, j), Q(i, j + 1), Q(i + 1, j), c, mat);
        else m.quad(Q(i, j), Q(i, j + 1), Q(i + 1, j + 1), Q(i + 1, j), c, mat);
    }
}

// ---------------------------------------------------------------- coral halo (the gates)
const HALO_TILT = 0.5;
export function drawHalo(S, A, h, time, zoneTint) {
    const ct = Math.cos(HALO_TILT), st = Math.sin(HALO_TILT);
    const ring = (t, rad, off = 0) => [h.x + Math.cos(t) * rad, Math.sin(t) * rad * ct + off * -st, h.z + Math.sin(t) * rad * st + off * ct];
    const N = 30, M = 6, rMinor = 0.24;
    const b = h.glow;                                            // 0 dormant → 1 bloomed
    const stone = [0.42 + b * 0.3, 0.3 + b * 0.16, 0.34 + b * 0.02];
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
        const t0 = (i / N) * TAU, t1 = ((i + 1) / N) * TAU, p0 = (j / M) * TAU, p1 = ((j + 1) / M) * TAU;
        const T = (t, p) => {
            const rr = h.R + Math.cos(p) * rMinor * (1 + 0.15 * Math.sin(t * 7));
            return ring(t, rr, Math.sin(p) * rMinor);
        };
        S.quad(T(t0, p0), T(t1, p0), T(t1, p1), T(t0, p1), stone, b > 0.5 ? MAT.EMIT : MAT.ROCK);
    }
    // polyps on top: glowing tips, brighter once bloomed
    const pc = b > 0 ? [1.4 * b + zoneTint[0] * (1 - b), 0.9 * b + zoneTint[1] * (1 - b), 0.5 * b + zoneTint[2] * (1 - b)] : zoneTint;
    for (let i = 0; i < 16; i++) {
        const t = (i / 16) * TAU + 0.1;
        const base = ring(t, h.R, rMinor * 0.8), sway = Math.sin(time * 2 + i) * 0.06;
        const tip = [base[0] + sway, base[1], base[2] + 0.28 + b * 0.18];
        limb(S, base, tip, 0.06, 0.035, pc.map((v) => v * 0.6), MAT.EMIT, 3);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3 - i * 0.6);
        A.sprite(tip[0], tip[1] - 0.15, tip[2], 0.2 + b * 0.12, pc[0] * (0.15 + 0.2 * pulse), pc[1] * (0.15 + 0.2 * pulse), pc[2] * (0.15 + 0.2 * pulse));
    }
    // a soft membrane of light inside the ring, shimmering while dormant
    const shimmer = 0.05 + 0.03 * Math.sin(time * 2.2 + h.i);
    A.sprite(h.x, -0.2, h.z, h.R * 1.15, zoneTint[0] * shimmer + b * 0.1, zoneTint[1] * shimmer + b * 0.07, zoneTint[2] * shimmer + b * 0.035);
}

// ---------------------------------------------------------------- anglerfish
export function drawAngler(S, A, f, time, lureCol) {
    const P = frame(f.x, f.y, f.z, f.dir[0], f.dir[1]);
    const sway = Math.sin(time * 1.3 + f.ph) * 0.08;
    const skin = [0.2, 0.15, 0.16], belly = [0.28, 0.22, 0.2];
    const mouth = f.mouth;
    // body: big round head tapering to the tail
    ell(S, P, 1.15, 0.8, 0.9, 0, skin, MAT.ROCK, 12, 7, (i, j) => 1 + 0.06 * Math.sin(i * 2.7 + j * 1.9), (i, j) => (i > 6 ? belly : skin));
    ell(S, P, 0.9, 0.42, 0.5, -1.2, skin, MAT.ROCK, 8, 5);
    // tail fin
    S.tri(P(-1.9, 0, 0), P(-2.7, 0, 0.7 + sway), P(-2.6, 0, -0.6 + sway), [0.16, 0.12, 0.13]);
    S.tri(P(-0.4, 0.75, -0.2), P(-0.9, 1.25, -0.5 + sway), P(-1.1, 0.7, 0.1), [0.17, 0.13, 0.14]);
    S.tri(P(-0.4, -0.75, -0.2), P(-0.9, -1.25, -0.5 - sway), P(-1.1, -0.7, 0.1), [0.17, 0.13, 0.14]);
    // lower jaw hinged under the head; the gape is dark inside
    const jawA = 0.25 + mouth * 0.75;
    const jl = (a, s) => P(0.15 + Math.cos(jawA) * a, s, -0.25 - Math.sin(jawA) * a);
    S.quad(jl(0, -0.7), jl(1.15, -0.25), jl(1.15, 0.25), jl(0, 0.7), [0.24, 0.17, 0.17]);
    S.tri(P(0.15, -0.65, -0.25), jl(1.15, -0.25), P(1.05, -0.3, -0.1), [0.03, 0.01, 0.02]);
    S.tri(P(0.15, 0.65, -0.25), jl(1.15, 0.25), P(1.05, 0.3, -0.1), [0.03, 0.01, 0.02]);
    // teeth: needles along both jaws
    const toothC = [0.95, 0.93, 0.85];
    for (let i = 0; i < 7; i++) {
        const s = -0.55 + i * 0.18, a = 0.75 + Math.cos(s * 2) * 0.35;
        const top = P(a, s, -0.05), tip = P(a + 0.08, s, -0.4 - (i % 2) * 0.12);
        S.tri(P(a - 0.05, s, -0.05), P(a + 0.05, s, -0.05), tip, toothC);
        const lb = jl(a * 0.95 + 0.1, s * 0.85), lt = [lb[0] + (top[0] - lb[0]) * 0.35, lb[1], lb[2] + (top[2] - lb[2]) * 0.35];
        S.tri([lb[0] - 0.04, lb[1], lb[2]], [lb[0] + 0.04, lb[1], lb[2]], lt, toothC);
    }
    // eyes: tiny and pale, flaring red when it decides to strike
    const eye = [0.4 + f.eye * 1.8, 0.45 + f.eye * 0.1, 0.4 + f.eye * 0.1];
    for (const s of [-0.5, 0.5]) {
        const e = P(0.55, s, 0.45);
        tube(S, e[0], e[1], 6, 0.09, e[2] - 0.09, 0.09, e[2] + 0.09, eye, MAT.EMIT);
        if (f.eye > 0.1) A.sprite(e[0], e[1] - 0.2, e[2], 0.4 * f.eye, f.eye * 0.9, 0.08, 0.06);
    }
    // the illicium: a stalk arcing forward from the forehead, ending in the lure
    const pts = [];
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(P(0.6 + t * 1.6 + Math.sin(time * 1.7 + f.ph + t * 2) * 0.12 * t, Math.sin(time * 1.1 + f.ph) * 0.2 * t, 0.85 + Math.sin(t * 2.6) * 1.1 - t * t * 0.4));
    }
    for (let i = 0; i < 6; i++) limb(S, pts[i], pts[i + 1], 0.05 - i * 0.005, 0.045 - i * 0.005, [0.24, 0.18, 0.18], MAT.ROCK, 4);
    const L = pts[6], pulse = 0.75 + 0.25 * Math.sin(time * 4 + f.ph);
    f.lure = L;
    tube(S, L[0], L[1], 6, 0.13, L[2] - 0.13, 0.13, L[2] + 0.1, lureCol.map((v) => v * 1.2), MAT.EMIT);
    A.sprite(L[0], L[1] - 0.2, L[2], 0.32, lureCol[0] * 0.8 * pulse, lureCol[1] * 0.8 * pulse, lureCol[2] * 0.8 * pulse);
    A.sprite(L[0], L[1] - 0.2, L[2], 1.6, lureCol[0] * 0.16 * pulse, lureCol[1] * 0.16 * pulse, lureCol[2] * 0.16 * pulse);
}

// ---------------------------------------------------------------- pufferfish
export function drawPuffer(S, A, p, time) {
    const P = frame(p.x, 0.3, p.z, p.face, 0);
    const inf = p.inflate, R = 0.55 + inf * 0.55;
    const base = p.hue < 0.5 ? [0.95, 0.78, 0.3] : [0.9, 0.55, 0.3], spot = [0.35, 0.25, 0.15], white = [0.92, 0.9, 0.82];
    ell(S, P, R * (1.25 - inf * 0.25), R * 0.85, R * 0.9, 0, base, MAT.ROCK, 12, 7, null,
        (i, j) => (i > 7 && i < 11 && j > 1 && j < 6 ? white : (i * 5 + j * 3) % 7 === 0 ? spot : base));
    // spikes when puffed
    if (inf > 0.15) {
        for (let j = 1; j < 6; j++) for (let i = 0; i < 9; i++) {
            const th = (j / 6) * Math.PI, ph = (i / 9) * TAU + j * 0.4;
            const d = [Math.cos(th), Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph)];
            const b = P(d[0] * R * 1.05, d[1] * R * 0.8, d[2] * R * 0.86), t = P(d[0] * R * (1.05 + 0.4 * inf), d[1] * R * (0.8 + 0.4 * inf), d[2] * R * (0.86 + 0.4 * inf));
            limb(S, b, t, 0.05, 0, [0.95, 0.9, 0.7], MAT.ROCK, 3);
        }
    }
    // eyes, fins, tail
    for (const s of [-1, 1]) {
        const e = P(R * 0.65, s * R * 0.5, R * 0.35);
        tube(S, e[0], e[1], 6, 0.16, e[2] - 0.12, 0.16, e[2] + 0.12, [0.95, 0.95, 0.9]);
        tube(S, e[0] + (p.face > 0 ? 0.04 : -0.04), e[1] + s * 0.06, 6, 0.08, e[2] - 0.08, 0.08, e[2] + 0.08, [0.03, 0.03, 0.05]);
    }
    const flap = Math.sin(time * 14 + p.ph) * 0.25;
    S.tri(P(-R * 1.1, 0, 0), P(-R * 1.1 - 0.5, flap * 0.5, 0.35), P(-R * 1.1 - 0.5, flap * 0.5, -0.35), base.map((v) => v * 0.8));
    for (const s of [-1, 1]) S.tri(P(0, s * R * 0.8, 0), P(-0.25, s * (R * 0.8 + 0.4), 0.2 + flap), P(-0.3, s * (R * 0.8 + 0.3), -0.15), base.map((v) => v * 0.85));
    if (inf > 0.5) A.sprite(p.x, -0.3, p.z, R * 1.6, 0.1 * inf, 0.03 * inf, 0.02 * inf);              // a warning blush
}

// ---------------------------------------------------------------- fish schools (decor, behind the play plane)
export function makeSchools(world, seed) {
    const r = mulberry32(seed * 3 + 11), schools = [];
    for (let i = 0; i < 7; i++) {
        const z = -230 + i * 32 + r() * 10;
        const kind = z > -110 ? (r() < 0.5 ? "gold" : "blue") : "silver";
        const fish = Array.from({ length: 18 + Math.floor(r() * 14) }, () => ({ o: [(r() - 0.5) * 3.5, (r() - 0.5) * 2.5, (r() - 0.5) * 2.5], ph: r() * TAU, s: 0.8 + r() * 0.5 }));
        schools.push({ z, y: 4 + r() * 3, cx: world.centerX(z), w: world.halfW(z) - 1, ph: r() * TAU, sp: 0.15 + r() * 0.12, kind, fish });
    }
    return schools;
}
export function drawSchools(S, schools, time, z0, z1) {
    for (const sc of schools) {
        if (sc.z < z0 - 6 || sc.z > z1 + 6) continue;
        const t = time * sc.sp + sc.ph;
        const cx = sc.cx + Math.sin(t) * sc.w * 0.8, cz = sc.z + Math.sin(t * 2) * 2.5;
        const vx = Math.cos(t) * sc.w * 0.8, vz = Math.cos(t * 2) * 5;
        const col = sc.kind === "gold" ? [1.0, 0.75, 0.25] : sc.kind === "blue" ? [0.3, 0.55, 1.0] : [0.7, 0.78, 0.85];
        for (const f of sc.fish) {
            const wig = Math.sin(time * 9 + f.ph);
            const x = cx + f.o[0] + Math.sin(time * 0.7 + f.ph) * 0.4, y = sc.y + f.o[1], z = cz + f.o[2] + Math.cos(time * 0.9 + f.ph) * 0.3;
            const P = frame(x, y, z, vx, vz * 0.3), s = 0.28 * f.s;
            S.quad(P(s, 0, 0), P(0, 0, s * 0.35), P(-s * 0.9, 0, 0), P(0, 0, -s * 0.35), col);
            S.tri(P(-s * 0.85, 0, 0), P(-s * 1.4, wig * 0.06, s * 0.35), P(-s * 1.4, wig * 0.06, -s * 0.35), col.map((v) => v * 0.8));
        }
    }
}

// ---------------------------------------------------------------- siphonophores (decor in the midnight zone)
export function makeSiphonophores(world, seed) {
    const r = mulberry32(seed * 5 + 7), list = [];
    for (let i = 0; i < 9; i++) {
        const z = -350 + r() * 110;
        list.push({ x: world.centerX(z) + (r() - 0.5) * world.halfW(z), y: 3 + r() * 5, z, ph: r() * TAU, len: 14 + Math.floor(r() * 16), hue: r() });
    }
    return list;
}
export function drawSiphonophores(A, list, time, z0, z1) {
    for (const s of list) {
        if (s.z < z0 - 12 || s.z > z1 + 12) continue;
        const c = s.hue < 0.5 ? [0.35, 0.55, 1.2] : [0.9, 0.35, 1.1];
        for (let i = 0; i < s.len; i++) {
            const t = time * 0.4 + s.ph + i * 0.22;
            const x = s.x + Math.sin(t) * 1.4 + i * 0.05, z = s.z - i * 0.38 + Math.cos(t * 0.7) * 0.4;
            const k = 0.5 + 0.5 * Math.sin(time * 3 - i * 0.5);
            A.sprite(x, s.y, z, 0.1 + k * 0.05, c[0] * (0.3 + k * 0.5), c[1] * (0.3 + k * 0.5), c[2] * (0.3 + k * 0.5));
            if (i % 4 === 0) A.sprite(x, s.y, z, 0.6, c[0] * 0.05, c[1] * 0.05, c[2] * 0.05);
        }
    }
}

// ---------------------------------------------------------------- stinger curtains
// The gap slides between the walls; everything outside it, from the stem down `len` metres, stings.
export function curtainGap(world, c, time) {
    const wl = world.wallLeft(c.z) + 0.3, wr = world.wallRight(c.z) - 0.3;
    const lo = wl + c.gap / 2 + 0.8, hi = wr - c.gap / 2 - 0.8;
    const gx = lerp(lo, hi, 0.5 + 0.5 * Math.sin(time * c.sp + c.ph));
    return { wl, wr, gx, g0: gx - c.gap / 2, g1: gx + c.gap / 2 };
}
export function drawCurtain(A, world, c, time) {
    const { wl, wr, g0, g1 } = curtainGap(world, c, time);
    const col = c.hue < 0.5 ? [1.0, 0.22, 0.42] : [1.0, 0.35, 0.2];
    for (const [a, b, edge] of [[wl, g0, g0], [g1, wr, g1]]) {
        const w = b - a;
        if (w < 0.2) continue;
        const n = Math.max(2, Math.ceil(w / 0.55));
        // the floating stem with its beads
        ribbon(A, [[a, 0, c.z], [b, 0, c.z]], 0.06, () => col.map((v) => v * 0.45));
        for (let i = 0; i <= n; i++) {
            const x = lerp(a, b, i / n);
            const pts = [];
            const L = c.len * (0.75 + 0.25 * Math.sin(x * 3.1 + c.z));
            for (let k = 0; k <= 7; k++) {
                const u = k / 7;
                pts.push([x + Math.sin(time * 1.7 + x * 1.3 + k * 0.8) * 0.16 * u, 0, c.z - L * u]);
            }
            const near = Math.abs(x - edge) < 0.3;
            ribbon(A, pts, (u) => 0.045 * (1 - u * 0.5), (u) => col.map((v) => v * (0.55 - u * 0.35) * (near ? 1.6 : 1)));
            const pulse = 0.5 + 0.5 * Math.sin(time * 4 - x * 2);
            A.sprite(x, -0.1, c.z - L * 0.33, 0.1, col[0] * 0.5 * pulse, col[1] * 0.5 * pulse, col[2] * 0.5 * pulse);
            if (i % 2 === 0) A.sprite(x, -0.1, c.z, 0.13, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6);
        }
        // bright markers on the edges of the gap so the way through is easy to read
        for (const zz of [c.z, c.z - c.len * 0.5]) {
            A.sprite(edge, -0.2, zz, 0.32, 1.0, 0.8, 0.6);
            A.sprite(edge, -0.2, zz, 1.2, 0.18, 0.1, 0.08);
        }
    }
}

// ---------------------------------------------------------------- moray eels
export function moraySegment(m) {
    const hx = m.wall - m.side * m.reach * m.out;
    return { x0: m.wall, z0: m.z, x1: hx, z1: m.z };
}
export function drawMoray(S, A, m, time) {
    const h = m.hole;
    blob(S, [h[0] + m.side * 0.15, h[1], h[2]], 0.75, 0.75, 0.62, [0.035, 0.03, 0.035], MAT.ROCK, 8, 5);                 // the recess
    blob(S, [h[0] - m.side * 0.25, h[1] - 0.1, h[2] + 0.62], 0.9, 0.7, 0.28, [0.3, 0.27, 0.3], MAT.ROCK, 8, 4);             // its rocky brow
    const eye = Math.max(0.12, m.eye);
    const head = m.out > 0.02
        ? [m.wall - m.side * m.reach * m.out, 0.1, m.z]
        : [h[0] - m.side * 0.9, h[1] - 0.9, h[2]];
    if (m.out > 0.02) {
        const N = 9, pts = [];
        for (let i = 0; i <= N; i++) {
            const u = i / N, w = Math.sin(u * Math.PI) * 0.35 * Math.sin(time * 9 + u * 6);
            pts.push([lerp(h[0] - m.side * 0.5, head[0], u), lerp(h[1] - 0.6, head[1], u), lerp(h[2], head[2], u) + w]);
        }
        for (let i = 0; i < N; i++) limb(S, pts[i], pts[i + 1], 0.34, 0.36, i % 2 ? [0.38, 0.44, 0.12] : [0.3, 0.36, 0.1], MAT.ROCK, 6);
        // head with a gaping jaw
        const P = frame(head[0], head[1], head[2], -m.side, 0);
        const gape = m.state === "strike" ? 0.55 : 0.2;
        ell(S, P, 0.65, 0.34, 0.3, 0.1, [0.42, 0.48, 0.14], MAT.ROCK, 8, 5);
        S.tri(P(0.15, -0.28, -0.1), P(0.8, 0, -0.1 - gape), P(0.15, 0.28, -0.1), [0.34, 0.38, 0.1]);
        S.tri(P(0.2, -0.2, -0.12), P(0.75, 0, -0.08), P(0.2, 0.2, -0.12), [0.05, 0.01, 0.02]);
        for (let k = 0; k < 4; k++) S.tri(P(0.35 + k * 0.1, -0.05, -0.08), P(0.4 + k * 0.1, 0, -0.08), P(0.38 + k * 0.1, 0, -0.22), [0.95, 0.93, 0.85]);
    }
    // eyes: a faint glint in the dark hole, a bright yellow stare when it's about to strike
    for (const s of [-0.16, 0.16]) {
        const e = m.out > 0.02 ? frame(head[0], head[1], head[2], -m.side, 0)(0.45, s, 0.2) : [head[0], head[1] + s, head[2] + 0.15];
        tube(S, e[0], e[1] - 0.05, 5, 0.07, e[2] - 0.06, 0.07, e[2] + 0.06, [1.6 * eye, 1.3 * eye, 0.2 * eye], MAT.EMIT);
        if (m.eye > 0.2) A.sprite(e[0], e[1] - 0.3, e[2], 0.35 * m.eye, 0.9 * m.eye, 0.7 * m.eye, 0.1 * m.eye);
    }
}

// ---------------------------------------------------------------- barracuda runs
export const BARRA_WARN = 1.4, BARRA_SPEED = 24;
export function barracudaState(world, lane, time) {
    const tt = (time + lane.ph) % lane.period, cycle = Math.floor((time + lane.ph) / lane.period);
    const wl = world.wallLeft(lane.z) - 3, wr = world.wallRight(lane.z) + 3;
    if (tt < BARRA_WARN) return { phase: "warn", k: tt / BARRA_WARN, fish: [], cycle, wl, wr };
    const run = (tt - BARRA_WARN) * BARRA_SPEED, start = lane.dir > 0 ? wl : wr, fish = [];
    for (let i = 0; i < lane.n; i++) {
        const x = start + lane.dir * (run - i * 1.7);
        if ((lane.dir > 0 && x > wl - 2 && x < wr + 2) || (lane.dir < 0 && x < wr + 2 && x > wl - 2)) fish.push({ x, z: lane.z + (i % 2 ? 0.45 : -0.45) * (i > 0 ? 1 : 0) });
    }
    return { phase: fish.length ? "run" : "idle", k: 1, fish, cycle, wl, wr };
}
export function drawBarracuda(S, A, world, lane, time) {
    const st = barracudaState(world, lane, time);
    if (st.phase === "warn") {
        // a silver shimmer along the lane, brightening, with chevrons pointing the way they'll come
        const k = st.k * st.k * (0.7 + 0.3 * Math.sin(time * 30));
        const c = [0.55 * k, 0.75 * k, 0.9 * k];
        A.quad4([st.wl, 0, lane.z - 0.03], [st.wr, 0, lane.z - 0.03], [st.wr, 0, lane.z + 0.03], [st.wl, 0, lane.z + 0.03], c, c, c, c, MAT.ADD);
        for (let i = 0; i < 6; i++) {
            const x = lerp(st.wl, st.wr, ((i + 0.5) / 6 + st.k * 0.3 * lane.dir + 1) % 1), d = lane.dir * 0.35;
            ribbon(A, [[x - d, 0, lane.z + 0.3], [x, 0, lane.z], [x - d, 0, lane.z - 0.3]], 0.04, () => c.map((v) => v * 1.4));
        }
    }
    for (const f of st.fish) {
        const P = frame(f.x, 0.15, f.z, lane.dir, 0), wig = Math.sin(time * 30 + f.x) * 0.08;
        const silver = [0.78, 0.82, 0.86], back = [0.36, 0.42, 0.5];
        ell(S, P, 1.15, 0.17, 0.22, 0, silver, MAT.ROCK, 8, 5, null, (i) => (i < 4 ? back : silver));
        S.tri(P(1.0, 0, 0.05), P(1.5, 0, -0.02), P(1.0, 0, -0.12), back);                       // pointed jaw
        S.tri(P(-1.05, 0, 0), P(-1.55, wig, 0.38), P(-1.35, wig, 0), back);
        S.tri(P(-1.05, 0, 0), P(-1.35, wig, 0), P(-1.55, wig, -0.38), back);
        S.tri(P(-0.2, 0, 0.18), P(-0.55, 0, 0.42), P(-0.6, 0, 0.18), back);
        const e = P(0.75, -0.14, 0.06);
        tube(S, e[0], e[1], 5, 0.05, e[2] - 0.05, 0.05, e[2] + 0.05, [0.02, 0.02, 0.02]);
        A.sprite(f.x - lane.dir * 2.2, 0, f.z, 0.5, 0.06, 0.09, 0.12);                          // wake
    }
}
