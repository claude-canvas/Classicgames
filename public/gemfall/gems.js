// Gem meshes. Each colour has its own cut (shape) so the board reads without relying on colour alone.
// Templates are built once in local space (unit size, z up, centred on the origin) and stamped per frame with
// a scale, a spin about z and a tilt, then written into the mesh as GEM material (flat facets).

import { MAT } from "./mesh.js";

const TAU = Math.PI * 2;
export const GEM_COLORS = [
    [1.0, 0.12, 0.2],    // ruby
    [0.18, 0.38, 1.0],   // sapphire
    [0.12, 0.85, 0.42],  // emerald
    [1.0, 0.72, 0.12],   // topaz
    [0.72, 0.28, 1.0],   // amethyst
    [0.85, 0.95, 1.05],  // diamond
];
export const GEM_CSS = ["#ff3a55", "#3f6bff", "#2fe07a", "#ffbb2a", "#b866ff", "#e8f6ff"];

// a ring-and-cone builder: list of rings [radius, z], first/last may be points; n sides, optional per-side radius warp
function lathe(rings, n, warp = () => 1, rot = 0) {
    const tris = [];
    const P = (i, k) => { const [rad, z] = rings[k], a = rot + (i / n) * TAU, w = warp(a); return [Math.cos(a) * rad * w, Math.sin(a) * rad * w, z]; };
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
        const a = P(i, k), b = P(i + 1, k), c = P(i + 1, k + 1), d = P(i, k + 1);
        if (rings[k][0] === 0) tris.push([a, c, d]);
        else if (rings[k + 1][0] === 0) tris.push([a, b, c]);
        else tris.push([a, b, c], [a, c, d]);
    }
    // close a flat table on top if the last ring has radius
    const t = rings[rings.length - 1];
    if (t[0] > 0) for (let i = 0; i < n; i++) tris.push([[0, 0, t[1]], P(i, rings.length - 1), P(i + 1, rings.length - 1)]);
    return tris;
}

const T = [];
// 0 ruby — round brilliant: pointed pavilion, crown, flat table
T[0] = lathe([[0, -0.42], [0.46, -0.04], [0.5, 0.02], [0.36, 0.2], [0.24, 0.26]], 10);
// 1 sapphire — emerald-cut rectangle (stretched octagon, stepped)
T[1] = lathe([[0, -0.32], [0.36, -0.1], [0.5, 0.02], [0.44, 0.16], [0.32, 0.24]], 8, (a) => 1 / Math.max(Math.abs(Math.cos(a)) * 0.95, Math.abs(Math.sin(a)) * 1.35, 0.8), Math.PI / 8);
// 2 emerald — square step cut
T[2] = lathe([[0, -0.3], [0.3, -0.16], [0.5, 0.0], [0.46, 0.14], [0.3, 0.24]], 4, () => 1, Math.PI / 4);
// 3 topaz — pear/teardrop
T[3] = lathe([[0, -0.36], [0.44, -0.02], [0.48, 0.04], [0.32, 0.22], [0.2, 0.27]], 12, (a) => 1 + 0.35 * Math.max(0, Math.cos(a - Math.PI / 2)) - 0.18 * Math.max(0, -Math.cos(a - Math.PI / 2)));
// 4 amethyst — trillion (rounded triangle)
T[4] = lathe([[0, -0.32], [0.44, -0.04], [0.52, 0.02], [0.36, 0.2], [0.22, 0.26]], 9, (a) => 0.82 + 0.22 * Math.cos(3 * (a + Math.PI / 6)), 0);
// 5 diamond — tall octahedron-ish kite
T[5] = lathe([[0, -0.48], [0.36, 0.0], [0.4, 0.04], [0.2, 0.3], [0, 0.46]], 6, () => 1, 0);
// prism — a rainbow star: 5 points
const star = [];
for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, r = i % 2 ? 0.22 : 0.52, b = ((i + 1) / 10) * TAU, rb = (i + 1) % 2 ? 0.22 : 0.52; star.push([[0, 0, 0.26], [Math.cos(a) * r, Math.sin(a) * r, 0], [Math.cos(b) * rb, Math.sin(b) * rb, 0]], [[0, 0, -0.22], [Math.cos(b) * rb, Math.sin(b) * rb, 0], [Math.cos(a) * r, Math.sin(a) * r, 0]]); }
export const PRISM_TRIS = star;
export const GEM_TRIS = T;

// write a gem: template tris → transformed → mesh. tint is the base colour (with brightness), `w` passes data
export function stampGem(M, tris, x, y, z, s, spin, tilt, col, rainbow = 0, hl = 0) {
    const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
    const tf = ([px, py, pz]) => {
        let X = px * cs - py * sn, Y = px * sn + py * cs, Z = pz;
        const Y2 = Y * ct - Z * st, Z2 = Y * st + Z * ct;                    // tilt about x so faces catch the light
        return [x + X * s, y + Y2 * s, z + Z2 * s, hl];
    };
    for (let i = 0; i < tris.length; i++) {
        const [a, b, c] = tris[i];
        let cc = col;
        if (rainbow) { const h = (i / tris.length + rainbow) % 1; cc = hsl(h); }
        M.tri(tf(a), tf(b), tf(c), cc, MAT.GEM);
    }
}
function hsl(h) {
    const f = (n) => { const k = (n + h * 12) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0) * 1.2 + 0.1, f(8) * 1.2 + 0.1, f(4) * 1.2 + 0.1];
}
