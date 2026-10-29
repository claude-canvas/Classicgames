// The jellyfish: a pulsing translucent bell (two fresnel layers), four glowing gonad rings, a crown of rim
// lights that chase around the margin, four frilly oral arms and fourteen trailing tentacles (verlet chains).
// Facing: angle `a` in the X–Z plane, 0 = straight up, positive = leaning to +x.

import { MAT, ribbon } from "./mesh.js";

const TENTS = 14, TSEG = 13, ARMS = 4, ASEG = 9;
const R = 1.35, H = 1.25;

export class Jelly {
    constructor(x, z) { this.reset(x, z); }

    reset(x, z) {
        this.x = x; this.z = z; this.vx = 0; this.vz = 0;
        this.a = 0; this.cool = 0; this.pt = 9; this.hurtT = 0; this.inv = 0; this.time = 0;
        const mk = (n, len) => Array.from({ length: n }, (_, i) => [x, 0, z - i * len]);
        this.tents = Array.from({ length: TENTS }, () => { const p = mk(TSEG, 0.42); return { p, o: p.map((q) => q.slice()) }; });
        this.arms = Array.from({ length: ARMS }, () => { const p = mk(ASEG, 0.3); return { p, o: p.map((q) => q.slice()) }; });
    }

    get dir() { return [Math.sin(this.a), Math.cos(this.a)]; }
    // bell squeeze 0..1 shortly after a pulse
    get squeeze() { const t = this.pt; return t < 0.11 ? t / 0.11 : Math.exp(-(t - 0.11) * 4.5); }

    pulse(impulse, cooldown = 0.5) {
        if (this.cool > 0) return false;
        const [dx, dz] = this.dir;
        this.vx += dx * impulse; this.vz += dz * impulse;
        this.pt = 0; this.cool = cooldown;
        return true;
    }

    // local bell frame → world
    frame() {
        const ca = Math.cos(this.a), sa = Math.sin(this.a);
        return { up: [sa, 0, ca], side: [ca, 0, -sa] };
    }
    bellPoint(lat, lon, scale = 1, sq = this.squeeze) {
        const { up, side } = this.frame();
        const ph = lat * Math.PI * 0.5;
        let r = R * scale * Math.sin(ph * 0.96 + 0.04) * (1 - 0.3 * sq);
        r *= 1 + 0.045 * Math.sin(lon * 16) * lat ** 4;
        const h = H * scale * (Math.cos(ph) * (1 + 0.38 * sq) - 0.22) - (lat > 0.85 ? (lat - 0.85) * 0.9 * (1 - sq) : 0);
        const lx = Math.cos(lon) * r, ly = Math.sin(lon) * r * 0.9;
        return [this.x + side[0] * lx + up[0] * h, ly, this.z + side[2] * lx + up[2] * h];
    }

    updateChains(dt) {
        this.time += dt;
        const { up, side } = this.frame();
        const damp = Math.exp(-dt * 3.2);
        const step = (ch, root, seg, wob) => {
            const p = ch.p, o = ch.o;
            p[0][0] = root[0]; p[0][1] = root[1]; p[0][2] = root[2];
            for (let i = 1; i < p.length; i++) {
                const q = p[i], prev = o[i];
                const vx = (q[0] - prev[0]) * damp, vy = (q[1] - prev[1]) * damp, vz = (q[2] - prev[2]) * damp;
                prev[0] = q[0]; prev[1] = q[1]; prev[2] = q[2];
                q[0] += vx - up[0] * 0.9 * dt * dt * 6 + Math.sin(this.time * 2.3 + i * 0.7 + wob) * 0.004 * i;
                q[1] += vy * 0.5 - q[1] * 0.02;
                q[2] += vz - up[2] * 0.9 * dt * dt * 6 - 0.6 * dt * dt;
            }
            for (let it = 0; it < 2; it++) for (let i = 1; i < p.length; i++) {
                const a = p[i - 1], b = p[i];
                const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.hypot(dx, dy, dz) || 1e-6;
                const k = (d - seg) / d;
                b[0] -= dx * k; b[1] -= dy * k; b[2] -= dz * k;
            }
        };
        for (let t = 0; t < TENTS; t++) {
            const lon = (t / TENTS) * Math.PI * 2;
            step(this.tents[t], this.bellPoint(0.97, lon), 0.42 + (t % 3) * 0.05, t);
        }
        for (let k = 0; k < ARMS; k++) {
            const lon = (k / ARMS) * Math.PI * 2 + 0.4;
            const root = [this.x + side[0] * Math.cos(lon) * 0.18 + up[0] * -0.05, Math.sin(lon) * 0.18, this.z + side[2] * Math.cos(lon) * 0.18 + up[2] * -0.05];
            step(this.arms[k], root, 0.3, k * 2);
        }
    }

    // write the jelly into the additive mesh. `light` 0..1, `tint` rgb.
    draw(A, light, tint, time) {
        const glow = 0.25 + 0.75 * light;
        const hurt = this.hurtT > 0 ? this.hurtT : 0;
        const blink = this.inv > 0 ? 0.55 + 0.45 * Math.sin(time * 40) : 1;
        const tc = [tint[0] * (1 - hurt) + 1.2 * hurt, tint[1] * (1 - hurt) + 0.2 * hurt, tint[2] * (1 - hurt) + 0.35 * hurt].map((v) => v * glow * blink);
        const sq = this.squeeze;
        // bell: two layers, stripes along the radial canals
        const LAT = 7, LON = 22;
        for (const [scale, k] of [[1, 1], [0.78, 0.4]]) {
            for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) {
                const l0 = j / LAT, l1 = (j + 1) / LAT, o0 = (i / LON) * Math.PI * 2, o1 = ((i + 1) / LON) * Math.PI * 2;
                const P = (l, o) => { const p = this.bellPoint(l, o, scale, sq); p.push(l); return p; };
                const stripe = (i % 2 ? 0.7 : 1.0) * k;
                const c = [tc[0] * stripe * 0.9, tc[1] * stripe * 0.9, tc[2] * stripe];
                A.quad(P(l0, o0), P(l1, o0), P(l1, o1), P(l0, o1), c, MAT.JELLY);
            }
        }
        // inner glow: four gonad rings and a core
        const { up, side } = this.frame();
        const at = (lx, ly, h) => [this.x + side[0] * lx + up[0] * h, ly, this.z + side[2] * lx + up[2] * h];
        for (let g = 0; g < 4; g++) {
            const o = (g / 4) * Math.PI * 2 + 0.785;
            const p = at(Math.cos(o) * 0.36, Math.sin(o) * 0.3, 0.35 + 0.15 * sq);
            A.sprite(p[0], p[1] - 0.2, p[2], 0.32, 0.75 * glow, 0.3 * glow, 0.6 * glow);
        }
        const core = at(0, 0, 0.45);
        A.sprite(core[0], -0.3, core[2], 0.6, tc[0] * 0.3, tc[1] * 0.3, tc[2] * 0.35);
        A.sprite(core[0], -0.3, core[2], 2.6 + light * 3.4, tc[0] * 0.055, tc[1] * 0.055, tc[2] * 0.07);
        // rim lights chasing around the margin
        for (let i = 0; i < 16; i++) {
            const o = (i / 16) * Math.PI * 2;
            const p = this.bellPoint(0.96, o, 1, sq);
            const chase = Math.max(0, Math.sin(time * 3 - i * 0.785)) ** 4;
            const s = 0.12 + chase * 0.14;
            A.sprite(p[0], p[1] - 0.1, p[2], s, (0.4 + chase) * glow * tc[0], (0.4 + chase) * glow * tc[1], (0.5 + chase) * glow * tc[2]);
        }
        // tentacles and oral arms
        for (const t of this.tents) ribbon(A, t.p, (u) => 0.035 * (1 - u * 0.6), (u) => { const f = (1 - u) ** 1.4 * 0.7; return [tc[0] * f, tc[1] * f, tc[2] * f]; });
        for (const a of this.arms) {
            const pts = a.p.map((q, i) => [q[0] + Math.sin(time * 3 + i) * 0.05, q[1], q[2]]);
            ribbon(A, pts, (u) => 0.15 * (1 - u) + 0.02 + 0.05 * Math.sin(u * 20 + time * 4) ** 2, (u) => { const f = (1 - u * 0.8) * 0.55; return [1.0 * f * glow, 0.45 * f * glow, 0.8 * f * glow]; });
        }
    }
}
