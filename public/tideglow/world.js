// The trench: a seeded undersea canyon from the sea floor (z = -DEPTH) to the surface (z = 0).
// Gameplay happens on the plane y = 0. The walls are a U-shaped cross-section (sides + back) whose y = 0 line
// is exactly what collision uses (wallLeft / wallRight). The route is a smooth path inside the walls along which
// halos, plankton and hazards are placed, so every dive is passable.

import { MAT, tube, limb, blob, mulberry32, vnoise, fbm, clamp, smooth, mixc, lerp, cross, norm } from "./mesh.js";

export const DEPTH = 480;
export const ZONES = [
    { name: "The Abyss", sub: "480 m · where the light has never been", top: -360 },
    { name: "The Midnight Zone", sub: "360 m · the hunters keep their own lights", top: -240 },
    { name: "The Twilight Zone", sub: "240 m · the first blue of day", top: -120 },
    { name: "The Sunlit Reef", sub: "120 m · colour returns", top: 0 },
];
export const zoneAt = (z) => (z < -360 ? 0 : z < -240 ? 1 : z < -120 ? 2 : 3);
export const HALO_COUNT = 16;
const YB = 9;                                    // how far back the canyon's back wall sits
const FLOOR = -DEPTH - 4;
const TOP = 7.5;

// the θ samples of the wall cross-section; 0 and π are included exactly (they are the collision line y = 0)
const THETAS = (() => {
    const t = [-0.6, -0.4, -0.2];
    for (let i = 0; i <= 26; i++) t.push((i / 26) * Math.PI);
    t.push(Math.PI + 0.2, Math.PI + 0.4, Math.PI + 0.6);
    return t;
})();
const DZ = 1.25;

export class World {
    constructor(seed) {
        this.seed = seed;
        const r = mulberry32(seed);
        this.p = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28, r() * 100];
        this.rng = mulberry32(seed * 7 + 3);
        this.place();
    }

    // ---------------------------------------------------------------- shape
    centerX(z) { const p = this.p; return 6.5 * Math.sin(z * 0.019 + p[0]) + 3.5 * Math.sin(z * 0.047 + p[1]); }
    halfW(z) {
        const p = this.p;
        let w = 9.2 + 2.2 * Math.sin(z * 0.034 + p[2]) + 1.3 * Math.sin(z * 0.011 + p[3]);
        w += Math.max(0, z + 115) * 0.065;                       // the reef opens up
        w += Math.max(0, -(z + DEPTH - 40)) * 0.16;              // the vent cavern at the bottom
        return w;
    }
    disp(th, z) {
        const s = this.seed & 1023;
        let d = (fbm(th * 2.1 + 3, z * 0.085, s) - 0.5) * 3.6;
        d += (vnoise(th * 6.5, z * 0.42, s + 9) - 0.5) * 1.0;
        return d;
    }
    wallRight(z) { return this.centerX(z) + this.halfW(z) + this.disp(0, z); }
    wallLeft(z) { return this.centerX(z) - this.halfW(z) - this.disp(Math.PI, z); }
    wallPoint(th, z) {
        const d = this.disp(th, z), r = this.halfW(z) + d;
        return [this.centerX(z) + Math.cos(th) * r, Math.sin(th) * (YB + d * 0.8), z];
    }
    routeX(z) {
        const cx = this.centerX(z), room = Math.max(1, this.halfW(z) - 4.5);
        return cx + (fbm(z * 0.011, 4.2, this.seed + 5, 3) - 0.5) * 2.4 * room;
    }
    floorZ(x, y) { return FLOOR + (fbm(x * 0.15, y * 0.15, this.seed + 21, 3) - 0.5) * 2.5; }

    // ---------------------------------------------------------------- placements
    place() {
        const r = this.rng;
        this.halos = [];
        const z0 = -DEPTH + 26, z1 = -16;
        for (let i = 0; i < HALO_COUNT; i++) {
            const z = lerp(z0, z1, i / (HALO_COUNT - 1)) + (r() - 0.5) * 6;
            const room = Math.max(0, this.halfW(z) - 5);
            const x = clamp(this.routeX(z) + (r() - 0.5) * 4, this.centerX(z) - room, this.centerX(z) + room);
            this.halos.push({ x, z, R: 2.25, bloomed: false, missed: false, glow: 0, i });
        }
        this.plankton = [];
        const zs = [-DEPTH + 8, ...this.halos.map((h) => h.z)];
        for (let k = 0; k < zs.length - 1; k++) {
            for (const f of [0.33, 0.7]) {
                const z = lerp(zs[k], zs[k + 1], f) + (r() - 0.5) * 4;
                const room = Math.max(0, this.halfW(z) - 3);
                const cx = clamp(this.routeX(z) + (r() - 0.5) * 7, this.centerX(z) - room, this.centerX(z) + room);
                const n = 5 + Math.floor(r() * 5), shape = r();
                for (let i = 0; i < n; i++) {
                    const t = i / n;
                    const x = shape < 0.5 ? cx + Math.cos(t * 6.28) * 1.6 : cx + (t - 0.5) * 5;
                    const zz = shape < 0.5 ? z + Math.sin(t * 6.28) * 1.6 : z + Math.sin(t * 3.14 * 2) * 1.0 + (t - 0.5) * 3;
                    this.plankton.push({ x, z: zz, ph: r() * 6.28, taken: false, fade: 1 });
                }
            }
        }
        // anglerfish — abyss and midnight, at alternating walls, away from halos
        this.anglers = [];
        let side = r() < 0.5 ? -1 : 1;
        for (let z = -DEPTH + 45; z < -250; z += 24 + r() * 14) {
            if (this.halos.some((h) => Math.abs(h.z - z) < 7)) z += 8;
            const wall = side > 0 ? this.wallRight(z) : this.wallLeft(z);
            const hx = wall - side * 2.0;
            this.anglers.push({ side, hx, hz: z, hy: 1.6, x: hx, y: 1.6, z, state: "lurk", t: 0, mouth: 0, eye: 0, dir: [-side, 0], ph: r() * 6.28, cool: 0 });
            side = -side;
        }
        // pufferfish — twilight and reef
        this.puffers = [];
        for (let z = -228; z < -14; z += 20 + r() * 14) {
            if (this.halos.some((h) => Math.abs(h.z - z) < 5)) z += 6;
            const room = Math.max(1, this.halfW(z) - 4);
            this.puffers.push({ x0: this.centerX(z) + (r() - 0.5) * room, z0: z, x: 0, z, range: 2 + r() * Math.min(5, room * 0.6), ph: r() * 6.28, inflate: 0, face: 1, hue: r() });
        }
        // currents — sideways streams in the midnight and twilight zones
        this.currents = [];
        for (let z = -330; z < -150; z += 32 + r() * 18) this.currents.push({ z0: z, z1: z + 5 + r() * 3, dir: r() < 0.5 ? -1 : 1, strength: 3.2 + r() * 1.2 });

        // ---- obstacles. Each keeps clear of halos and of the other obstacles, and always leaves a way through.
        const taken = [...this.anglers.map((a) => [a.hz - 2.5, a.hz + 2.5]), ...this.currents.map((c) => [c.z0 - 1, c.z1 + 1])];   // [z0, z1] bands already used
        const free = (z0, z1, pad = 3) => !this.halos.some((h) => h.z > z0 - 3.5 && h.z < z1 + 3.5) && !taken.some(([a, b]) => z1 + pad > a && z0 - pad < b);
        // stinger curtains: siphonophore tentacles hanging across the canyon; one gap slides side to side
        this.curtains = [];
        for (let z = -410; z < -128; z += 12 + r() * 8) {
            const len = 4 + r() * 2.5;
            if (!free(z - len, z + 0.5)) { z -= 10 + r() * 2; continue; }
            this.curtains.push({ z, len, gap: 5.2 + r() * 1.3, ph: r() * 6.28, sp: 0.13 + r() * 0.15, hue: r() });
            taken.push([z - len, z + 0.5]);
        }
        // barracuda runs: a silver shimmer warns, then a pack torpedoes across at that height
        this.barracuda = [];
        for (let z = -232; z < -18; z += 15 + r() * 10) {
            if (!free(z - 1.2, z + 1.2, 2.5)) { z -= 12 + r() * 2; continue; }
            this.barracuda.push({ z, dir: r() < 0.5 ? -1 : 1, period: 4.2 + r() * 2.2, ph: r() * 10, n: 3 + Math.floor(r() * 3), warned: -1 });
            taken.push([z - 1.2, z + 1.2]);
        }
        // moray eels: hide in holes in the walls and strike out across the canyon
        this.morays = [];
        for (let z = -440; z < -16; z += 22 + r() * 18) {
            if (!free(z - 1.5, z + 1.5, 2.5)) { z -= 19 + r() * 2; continue; }
            const side = r() < 0.5 ? -1 : 1;
            const wall = side > 0 ? this.wallRight(z) : this.wallLeft(z), other = side > 0 ? this.wallLeft(z) : this.wallRight(z);
            const hole = this.wallPoint(side > 0 ? 0.3 : Math.PI - 0.3, z);
            this.morays.push({ side, z, wall, hole, reach: Math.min(4.6, Math.abs(wall - other) - 4.5), out: 0, eye: 0, state: "hide", t: 0, cool: r() * 2, ph: r() * 6.28 });
            taken.push([z - 1.5, z + 1.5]);
        }
        // urchin outcrops: rock ledges jutting from a wall, crowned with spiny urchins
        this.outcrops = [];
        let oside = r() < 0.5 ? -1 : 1;
        for (const [a, b, n] of [[-462, -372, 5], [-236, -132, 4], [-112, -14, 6]]) {
            for (let i = 0; i < n; i++) {
                let z = lerp(a, b, (i + 0.5) / n) + (r() - 0.5) * 6;
                const R = 1.5 + r() * 0.7;
                for (let k = 0; k < 6 && !free(z - R - 1, z + R + 1, 3); k++) z += 2.5;
                if (!free(z - R - 1, z + R + 1, 3)) continue;
                const wall = oside > 0 ? this.wallRight(z) : this.wallLeft(z), other = oside > 0 ? this.wallLeft(z) : this.wallRight(z);
                const reach = Math.min(3 + r() * 2.5, Math.abs(wall - other) - 7);
                if (reach < 1.8) continue;
                const cx = wall - oside * (reach - R * 0.9);
                const urchins = [];
                for (let k = 0, m = 3 + Math.floor(r() * 3); k < m; k++) {
                    const phi = -0.9 + (k / Math.max(1, m - 1)) * 2.1 + (r() - 0.5) * 0.25;
                    urchins.push({ x: cx - oside * Math.cos(phi) * R * 0.95, z: z + Math.sin(phi) * R * 0.95, r: 0.32 + r() * 0.12 });
                }
                this.outcrops.push({ side: oside, x: cx, z, R, wall, urchins });
                taken.push([z - R - 0.5, z + R + 0.5]);
                oside = -oside;
            }
        }
        // anglerfish also haunt the upper twilight now
        for (let z = -232; z < -150; z += 30 + r() * 20) {
            if (!free(z - 2, z + 2, 0)) continue;
            const s2 = r() < 0.5 ? -1 : 1, wall = s2 > 0 ? this.wallRight(z) : this.wallLeft(z);
            this.anglers.push({ side: s2, hx: wall - s2 * 2.0, hz: z, hy: 1.6, x: wall - s2 * 2.0, y: 1.6, z, state: "lurk", t: 0, mouth: 0, eye: 0, dir: [-s2, 0], ph: r() * 6.28, cool: 0 });
        }
        // plankton never spawns inside rock
        this.plankton = this.plankton.filter((p) => !this.outcrops.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.R + 0.8));
        // hydrothermal vents on the floor
        this.vents = [];
        const cxF = this.centerX(FLOOR + 4);
        for (let i = 0; i < 4; i++) {
            const x = cxF + (i - 1.5) * 6.5 + (r() - 0.5) * 2.5, y = 2.5 + r() * 4.5;
            this.vents.push({ x, y, z: this.floorZ(x, y), h: 5 + r() * 6, r: 0.9 + r() * 0.6 });
        }
    }

    // ---------------------------------------------------------------- static mesh
    rockCol(z, n) {
        // [blend from, blend to, colour]
        const pal = [
            [-999, -999, [0.26, 0.21, 0.27]], [-380, -345, [0.25, 0.27, 0.36]], [-265, -225, [0.28, 0.34, 0.4]],
            [-150, -105, [0.42, 0.37, 0.33]], [-40, -5, [0.47, 0.41, 0.36]], [0.1, 0.9, [0.32, 0.25, 0.24]],
        ];
        let c = pal[0][2];
        for (let i = 1; i < pal.length; i++) c = mixc(c, pal[i][2], smooth(pal[i][0], pal[i][1], z));
        return c.map((v) => v * (0.75 + n * 0.5));
    }
    siltCol(z) {
        if (z > 0.3) return [0.42, 0.34, 0.3];
        return mixc(mixc([0.2, 0.19, 0.22], [0.36, 0.38, 0.42], smooth(-400, -200, z)), [0.92, 0.82, 0.62], smooth(-150, -90, z));
    }

    buildStatic(S, A) {
        const r = mulberry32(this.seed * 13 + 1);
        const s = this.seed & 1023;
        this.staticLights = [];
        const nz = Math.ceil((TOP - FLOOR) / DZ);
        const grid = [];
        for (let k = 0; k <= nz; k++) {
            const z = FLOOR + k * DZ;
            grid.push(THETAS.map((th) => this.wallPoint(th, z)));
        }
        const ledges = [];                           // up-facing wall faces: spots for coral, worms, kelp
        for (let k = 0; k < nz; k++) for (let j = 0; j < THETAS.length - 1; j++) {
            const a = grid[k][j], b = grid[k][j + 1], c = grid[k + 1][j + 1], d = grid[k + 1][j];
            let n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]));
            const thm = (THETAS[j] + THETAS[j + 1]) / 2;
            if (n[0] * -Math.cos(thm) + n[1] * -Math.sin(thm) < 0) n = [-n[0], -n[1], -n[2]];          // face into the canyon
            const zc = (a[2] + c[2]) / 2;
            const nn = fbm(a[0] * 0.3 + j, zc * 0.2, s + 2, 2);
            let col = this.rockCol(zc, nn);
            col = col.map((v) => v * (0.88 + 0.12 * Math.sin(zc * 0.9 + nn * 7)));                // strata
            const upness = n[2];
            if (upness > 0.42) col = mixc(col, this.siltCol(zc), smooth(0.42, 0.75, upness));
            const enc = zc > -115 && zc < -1 ? smooth(0.62, 0.85, fbm(j * 0.45, zc * 0.18, s + 4, 2)) : 0;     // encrusting reef life
            if (enc > 0) col = mixc(col, vnoise(j * 0.3, zc * 0.05, s + 8) < 0.5 ? [0.82, 0.42, 0.5] : [0.42, 0.6, 0.38], enc * 0.4);
            S.quad(a, b, c, d, col, MAT.ROCK);
            if (upness > 0.35) ledges.push({ p: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, zc], n, th: THETAS[j] });
            // bioluminescent lichen in the dark zones
            if (zc < -215 && zc > FLOOR + 2 && r() < 0.04) {
                const m = [(a[0] + c[0]) / 2 + n[0] * 0.06, (a[1] + c[1]) / 2 + n[1] * 0.06, zc + n[2] * 0.06];
                const hue = r(), k2 = smooth(-215, -290, zc) * 0.75 + 0.25;
                const gc = (hue < 0.5 ? [0.15, 0.85, 1.1] : hue < 0.8 ? [0.35, 0.4, 1.2] : [0.3, 1.1, 0.5]).map((v) => v * (0.5 + r() * 0.6) * k2);
                const sz = 0.05 + r() * 0.06;
                for (let q = 0; q < 7; q++) {
                    const ox = (r() - 0.5) * 0.9, oz = (r() - 0.5) * 0.9, sz2 = sz * (0.5 + r());
                    const tdir = norm(cross(n, [0, 0, 1])), up = cross(tdir, n);
                    const P = (u, v) => [m[0] + tdir[0] * (ox + u) + up[0] * (oz + v), m[1] + tdir[1] * (ox + u) + up[1] * (oz + v), m[2] + tdir[2] * (ox + u) + up[2] * (oz + v)];
                    S.quad(P(-sz2, 0), P(0, -sz2), P(sz2, 0), P(0, sz2), gc, MAT.EMIT);
                }
                if (r() < 0.25) A.sprite(m[0] + n[0] * 0.3, m[1] + n[1] * 0.3, m[2], 0.9, gc[0] * 0.18, gc[1] * 0.18, gc[2] * 0.18);
            }
        }
        this.ledges = ledges;
        const FL = [0, 1.5, 3.5, 6, 9.5, 14, 20, 28, 40, 65, 110];
        for (const side of [1, -1]) {
            const rows = grid.map((row) => {
                const lip = side > 0 ? row[0] : row[row.length - 1], z = lip[2];
                return FL.map((d, i) => {
                    const bump = i === 0 ? 0 : (fbm(d * 0.25 + side * 50, z * 0.16, s + 40, 3) - 0.5) * (3 + d * 0.1);
                    return [lip[0] + side * d, lip[1] - Math.min(d, 6) * 0.45 + bump, z + (i ? bump * 0.3 : 0)];
                });
            });
            for (let k = 0; k < rows.length - 1; k++) for (let i = 0; i < FL.length - 1; i++) {
                const a = rows[k][i], b = rows[k][i + 1], c = rows[k + 1][i + 1], d = rows[k + 1][i];
                const zc = (a[2] + c[2]) / 2;
                const col = this.rockCol(zc, fbm(i * 0.7 + side * 9, zc * 0.2, s + 41, 2)).map((v) => v * (0.85 - i * 0.025));
                S.quad(a, b, c, d, col, MAT.ROCK);
            }
        }

        // urchin outcrops: a lumpy rock ledge bonded into the wall, spiny urchins on its face
        for (const o of this.outcrops) {
            const rc = this.rockCol(o.z, 0.5).map((v) => v * 0.9);
            blob(S, [o.x, 0.6, o.z], o.R, o.R * 1.25, o.R * 0.85, rc, MAT.ROCK, 10, 6, (i, j) => 1 + 0.12 * Math.sin(i * 2.3 + j * 1.7 + o.z));
            blob(S, [(o.x + o.wall) / 2 + o.side * 0.8, 1.2, o.z - 0.2], Math.abs(o.wall - o.x) * 0.7 + 1, o.R * 1.5, o.R * 1.05, rc.map((v) => v * 0.9), MAT.ROCK, 9, 5);
            const dark = o.z < -300;
            for (const u of o.urchins) {
                blob(S, [u.x, 0, u.z], u.r * 0.8, u.r * 0.8, u.r * 0.7, dark ? [0.2, 0.08, 0.22] : [0.25, 0.1, 0.3], MAT.ROCK, 7, 4);
                for (let k = 0; k < 26; k++) {
                    const th = Math.acos(1 - 2 * ((k + 0.5) / 26)), ph = k * 2.39996;
                    const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
                    const len = u.r * (1.6 + r() * 0.9);
                    limb(S, [u.x + d[0] * u.r * 0.6, d[1] * u.r * 0.6, u.z + d[2] * u.r * 0.6], [u.x + d[0] * len, d[1] * len, u.z + d[2] * len], 0.035, 0, dark ? [0.75, 0.25, 0.9] : [0.35, 0.15, 0.4], dark ? MAT.EMIT : MAT.ROCK, 3);
                }
                if (dark) A.sprite(u.x, -0.4, u.z, 1.1, 0.12, 0.03, 0.16);
            }
        }

        // the sea floor (vent cavern)
        const fx0 = this.centerX(FLOOR) - this.halfW(FLOOR) - 6, fx1 = this.centerX(FLOOR) + this.halfW(FLOOR) + 6;
        for (let y = -6; y < YB + 4; y += 1.5) for (let x = fx0; x < fx1; x += 1.5) {
            const P = (a, b) => [a, b, this.floorZ(a, b)];
            const n = fbm(x * 0.4, y * 0.4, s + 30, 2);
            S.quad(P(x, y), P(x + 1.5, y), P(x + 1.5, y + 1.5), P(x, y + 1.5), [0.13 + n * 0.08, 0.11 + n * 0.06, 0.12 + n * 0.07], MAT.ROCK);
        }

        // hydrothermal vents: dark chimneys with glowing cracks, tube worms around them
        for (const v of this.vents) {
            const seg = 6;
            for (let i = 0; i < seg; i++) {
                const z0 = v.z + (i / seg) * v.h - 0.3, z1 = v.z + ((i + 1) / seg) * v.h;
                const r0 = v.r * (1.15 - i / seg * 0.55) * (0.9 + r() * 0.2), r1 = v.r * (1.15 - (i + 1) / seg * 0.55);
                const ox = (r() - 0.5) * 0.2;
                tube(S, v.x + ox, v.y, 7, r0, z0, r1, z1, [0.07, 0.06, 0.065], MAT.ROCK, i, false);
                if (i % 2 === 0) tube(S, v.x + ox, v.y - 0.02, 7, r1 * 1.02, z1 - 0.12, r1 * 1.02, z1 + 0.05, [1.3, 0.38, 0.08], MAT.EMIT, i, false);
            }
            tube(S, v.x, v.y, 7, v.r * 0.6, v.z + v.h, v.r * 0.45, v.z + v.h + 0.2, [1.6, 0.6, 0.15], MAT.EMIT);
            A.sprite(v.x, v.y, v.z + v.h + 0.6, 3.2, 0.5, 0.16, 0.03);
            A.sprite(v.x, v.y, v.z + v.h * 0.4, 2.5, 0.22, 0.06, 0.01);
            this.staticLights.push({ x: v.x, y: v.y - 1, z: v.z + v.h + 0.8, s: 2.6, c: [1.0, 0.45, 0.15], flicker: true });
            for (let w = 0; w < 26; w++) {
                const a = r() * 6.28, d = v.r + 0.6 + r() * 2.2, x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d;
                const z = this.floorZ(x, y), h = 0.8 + r() * 1.8, lean = (r() - 0.5) * 0.4;
                limb(S, [x, y, z - 0.1], [x + lean, y, z + h], 0.07, 0.06, [0.85, 0.82, 0.75], MAT.ROCK, 4);
                tube(S, x + lean, y, 5, 0.12, z + h, 0, z + h + 0.35, [1.4, 0.12, 0.15], MAT.EMIT);
            }
        }

        // coral & kelp on the ledges
        const wantY = (p) => p[1] > (p[2] > -120 ? 0.6 : 1.2);                                                // never in front of the play plane
        for (const L of ledges) {
            const [x, y, z] = L.p;
            if (!wantY(L.p)) continue;
            if (z > -240 && z < -125 && r() < 0.16) this.seaFan(S, x, y, z, r);
            else if (z > -118 && z < -2 && r() < 0.8) this.reefCoral(S, A, x, y, z - 0.1, r);
            else if (z > -360 && z < -240 && r() < 0.05) this.glowAnemone(S, A, x, y, z, r);
        }
        // kelp forest at the back and the sides of the reef
        for (let i = 0; i < 70; i++) {
            const z = -112 + r() * 92;
            const th = r() < 0.5 ? 0.35 + r() * 0.9 : Math.PI - 0.35 - r() * 0.9;
            const p = this.wallPoint(th, z);
            p[0] -= Math.cos(th) * 0.8; p[1] -= Math.sin(th) * 0.8;
            if (p[1] < 2) continue;
            this.kelp(S, p[0], p[1], p[2], Math.min(-z - 1.5, 9 + r() * 16), r);
        }

        // god rays from the surface
        for (let i = 0; i < 34; i++) {
            const zTop = 0, len = 50 + r() * 110;
            const zc = -len * 0.5;
            const x = this.centerX(zc) + (r() - 0.5) * 2 * (this.halfW(zc) + 2), y = 1.5 + r() * 7;
            const w = 0.8 + r() * 3.2, slant = len * (0.12 + r() * 0.1);
            const k = 0.06 + r() * 0.1, col = [0.5 * k, 0.85 * k, 0.75 * k];
            A.v(x - w, y, zTop, 0 * 2 + 0, ...col, MAT.SHAFT); A.v(x + w, y, zTop, 1 * 2 + 0, ...col, MAT.SHAFT); A.v(x + w * 1.8 + slant, y, zTop - len, 1 * 2 + 1, ...col, MAT.SHAFT);
            A.v(x - w, y, zTop, 0 * 2 + 0, ...col, MAT.SHAFT); A.v(x + w * 1.8 + slant, y, zTop - len, 1 * 2 + 1, ...col, MAT.SHAFT); A.v(x - w * 1.8 + slant, y, zTop - len, 0 * 2 + 1, ...col, MAT.SHAFT);
        }

        // the sea surface (one big plane) and a ring of distant islands on the horizon for the ending
        S.quad([-300, -40, 0], [300, -40, 0], [300, 420, 0], [-300, 420, 0], [0, 0, 0], MAT.SURFACE);
        for (let i = 0; i < 9; i++) {
            const x = -220 + i * 55 + (r() - 0.5) * 30, y = 250 + r() * 120, h = 6 + r() * 16, w = 25 + r() * 40;
            const col = [0.16, 0.1, 0.17];
            S.tri([x - w, y, -0.5], [x + w, y, -0.5], [x + (r() - 0.5) * w * 0.6, y + 5, h], col, MAT.ROCK);
        }
        // above-water cliff crowns get a little greenery
        for (let i = 0; i < 40; i++) {
            const th = r() < 0.5 ? r() * 1.2 : Math.PI - r() * 1.2;
            const p = this.wallPoint(th, TOP - 0.4);
            blob(S, [p[0] - Math.cos(th) * 0.6, p[1] - Math.sin(th) * 0.6, p[2] + 0.2], 0.9 + r(), 0.9 + r(), 0.5 + r() * 0.6, [0.16, 0.22, 0.12], MAT.ROCK, 6, 3);
        }
    }

    seaFan(S, x, y, z, r) {
        // a flat fan of branches with glowing tips, facing the canyon (the camera)
        const h = 1.2 + r() * 1.8, spread = 0.8 + r() * 0.5, base = r() < 0.5 ? [0.85, 0.3, 0.55] : [0.95, 0.55, 0.25];
        const tip = r() < 0.5 ? [0.9, 0.3, 1.1] : [0.2, 0.9, 1.2];
        const nb = 9;
        for (let i = 0; i < nb; i++) {
            const a = -spread + (i / (nb - 1)) * spread * 2;
            const ex = x + Math.sin(a) * h, ez = z + Math.cos(a) * h;
            const mx = x + Math.sin(a) * h * 0.5, mz = z + Math.cos(a) * h * 0.5;
            limb(S, [x, y, z], [mx, y, mz], 0.06, 0.04, base, MAT.ROCK, 3);
            limb(S, [mx, y, mz], [ex, y, ez], 0.04, 0.02, base, MAT.ROCK, 3);
            const ex2 = mx + Math.sin(a + 0.5) * h * 0.35, ez2 = mz + Math.cos(a + 0.5) * h * 0.35;
            limb(S, [mx, y, mz], [ex2, y, ez2], 0.03, 0.015, base, MAT.ROCK, 3);
            const g = tip.map((v) => v * 0.7);
            tube(S, ex, y - 0.05, 4, 0.06, ez - 0.06, 0.06, ez + 0.06, g, MAT.EMIT);
            tube(S, ex2, y - 0.05, 4, 0.05, ez2 - 0.05, 0.05, ez2 + 0.05, g, MAT.EMIT);
        }
        // a thin webbing between the branches
        for (let i = 0; i < nb - 1; i++) {
            const a0 = -spread + (i / (nb - 1)) * spread * 2, a1 = -spread + ((i + 1) / (nb - 1)) * spread * 2;
            S.tri([x, y + 0.02, z], [x + Math.sin(a0) * h * 0.85, y + 0.02, z + Math.cos(a0) * h * 0.85], [x + Math.sin(a1) * h * 0.85, y + 0.02, z + Math.cos(a1) * h * 0.85], base.map((v) => v * 0.55), MAT.ROCK);
        }
    }

    reefCoral(S, A, x, y, z, r) {
        const kind = r();
        const pal = [[0.95, 0.42, 0.55], [1.0, 0.6, 0.3], [0.62, 0.38, 0.85], [0.95, 0.85, 0.35], [0.35, 0.8, 0.65], [0.95, 0.35, 0.3]];
        const col = pal[Math.floor(r() * pal.length)];
        if (kind < 0.25) {                                         // brain coral
            const R = 0.5 + r() * 0.7;
            blob(S, [x, y, z + R * 0.3], R, R, R * 0.7, col, MAT.ROCK, 9, 5, (i, j) => 1 + 0.08 * Math.sin(i * 3 + j * 2));
        } else if (kind < 0.5) {                                   // branching staghorn
            const n = 5 + Math.floor(r() * 5);
            for (let i = 0; i < n; i++) {
                const a = r() * 6.28, l = 0.6 + r() * 1.1, tilt = 0.2 + r() * 0.6;
                const e = [x + Math.cos(a) * Math.sin(tilt) * l, y + Math.sin(a) * Math.sin(tilt) * l * 0.5, z + Math.cos(tilt) * l];
                limb(S, [x, y, z], e, 0.12, 0.05, col, MAT.ROCK, 4);
                tube(S, e[0], e[1], 4, 0.06, e[2] - 0.05, 0, e[2] + 0.12, col.map((v) => Math.min(1.4, v * 1.3)), MAT.ROCK);
            }
        } else if (kind < 0.6) {                                   // table coral
            const R = 0.5 + r() * 0.5, h = 0.3 + r() * 0.3;
            tube(S, x, y, 5, 0.12, z, 0.1, z + h, col.map((v) => v * 0.7));
            tube(S, x, y, 9, R * 0.3, z + h, R, z + h + 0.12, col);
        } else if (kind < 0.82) {                                  // tube sponges
            const n = 2 + Math.floor(r() * 3);
            for (let i = 0; i < n; i++) {
                const ox = (r() - 0.5) * 0.7, oy = (r() - 0.5) * 0.5, h = 0.7 + r() * 1.4, rr = 0.14 + r() * 0.12;
                tube(S, x + ox, y + oy, 7, rr * 0.8, z, rr, z + h, col, MAT.ROCK, 0, false);
                tube(S, x + ox, y + oy, 7, rr * 0.8, z + h - 0.02, rr * 0.8, z + h, col.map((v) => v * 0.3));
            }
        } else {                                                   // anemone with swaying glowing tips
            const n = 16, R = 0.35 + r() * 0.3;
            tube(S, x, y, 7, R, z, R * 0.9, z + 0.3, col.map((v) => v * 0.6));
            for (let i = 0; i < n; i++) {
                const a = (i / n) * 6.28, l = 0.5 + r() * 0.4;
                const b = [x + Math.cos(a) * R * 0.8, y + Math.sin(a) * R * 0.8, z + 0.3];
                const e = [b[0] + Math.cos(a) * l * 0.5, b[1] + Math.sin(a) * l * 0.3, b[2] + l];
                S.tri([b[0] - 0.04, b[1], b[2], 0], [b[0] + 0.04, b[1], b[2], 0], [e[0], e[1], e[2], 0.35], [0.95, 0.7, 0.85], MAT.KELP);
            }
        }
    }

    glowAnemone(S, A, x, y, z, r) {
        const n = 12, R = 0.3 + r() * 0.2, col = r() < 0.5 ? [0.3, 0.6, 1.3] : [1.0, 0.35, 1.2];
        tube(S, x, y, 6, R, z, R * 0.8, z + 0.25, [0.12, 0.1, 0.14]);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * 6.28, l = 0.5 + r() * 0.5;
            const e = [x + Math.cos(a) * (R + l * 0.4), y + Math.sin(a) * (R + l * 0.25), z + 0.25 + l];
            limb(S, [x + Math.cos(a) * R * 0.7, y + Math.sin(a) * R * 0.7, z + 0.25], e, 0.04, 0.015, col.map((v) => v * 0.5), MAT.EMIT, 3);
        }
        A.sprite(x, y - 0.4, z + 0.6, 1.4, col[0] * 0.12, col[1] * 0.12, col[2] * 0.12);
    }

    kelp(S, x, y, z, h, r) {
        const segs = Math.max(4, Math.floor(h / 1.1));
        const stem = [0.32, 0.36, 0.1], leaf = [0.5, 0.5, 0.14];
        let px = x, py = y;
        for (let i = 0; i < segs; i++) {
            const z0 = z + (i / segs) * h, z1 = z + ((i + 1) / segs) * h;
            const w0 = (i / segs), w1 = ((i + 1) / segs);
            const nx = px + (r() - 0.5) * 0.25;
            S.quad([px - 0.07, py, z0, w0], [px + 0.07, py, z0, w0], [nx + 0.07, py, z1, w1], [nx - 0.07, py, z1, w1], stem, MAT.KELP);
            const s = i % 2 ? 1 : -1, L = 0.7 + r() * 0.6;
            const lc = leaf.map((v) => v * (0.85 + r() * 0.3));
            S.quad([nx, py, z1 - 0.1, w1], [nx + s * L * 0.5, py - 0.05, z1 + 0.25, w1], [nx + s * L, py - 0.05, z1 + 0.65, w1], [nx + s * 0.1, py, z1 + 0.35, w1], lc, MAT.KELP);
            px = nx;
        }
        // a float bladder at the top
        blob(S, [px, py, z + h + 0.15], 0.14, 0.14, 0.2, [0.55, 0.5, 0.18], MAT.KELP, 5, 3);
    }
}
