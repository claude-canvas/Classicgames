// Per-frame models: towers (with a hologram "ghost" variant for placement), enemies, projectiles, the Keep's
// crystal, the rift portal, range rings, cell highlights and billboarded health bars.

import { MAT, tube, limb, blob } from "./mesh.js";
import { CELL } from "./maps.js";
import { shadow } from "./scene.js";

const TAU = Math.PI * 2;
const STONE = [0.66, 0.62, 0.56], STONE_D = [0.48, 0.45, 0.42], WOOD = [0.45, 0.29, 0.16], BRONZE = [0.72, 0.48, 0.22], GOLD = [0.95, 0.72, 0.3];

// A mesh wrapper that turns everything into one translucent additive colour (placement ghosts).
class Ghost {
    constructor(A, col) { this.A = A; this.c = col; }
    v(x, y, z, w) { this.A.v(x, y, z, w, this.c[0], this.c[1], this.c[2], MAT.ADD); }
    tri(a, b, c) { this.A.tri(a, b, c, this.c, MAT.ADD); }
    quad(a, b, c, d) { this.A.quad(a, b, c, d, this.c, MAT.ADD); }
    quad4(a, b, c, d) { this.A.quad(a, b, c, d, this.c, MAT.ADD); }
    sprite() { }
}

function gem(S, x, y, z, r, h, col, rot) {                    // a double-pointed crystal
    tube(S, x, y, 6, r, z, 0, z + h, col, MAT.EMIT, rot, false);
    tube(S, x, y, 6, r, z, 0, z - h * 0.6, col.map((v) => v * 0.75), MAT.EMIT, rot, false);
}

// ------------------------------------------------------------------ towers
export function drawTower(S, A, Sh, t, time, ghostCol = null) {
    const M = ghostCol ? new Ghost(A, ghostCol) : S;
    const { x, y } = t, L = t.level, c = t.def.crystal;
    const grow = Math.min(1, (time - (t.born ?? -9)) / 0.35), pop = 1 + Math.sin(Math.min(1, grow) * Math.PI) * 0.12;
    const bob = Math.sin(time * 2 + x) * 0.08;
    // common octagonal plinth with level bands
    tube(M, x, y, 8, 0.92 * pop, 0, 0.86 * pop, 0.38, STONE_D, MAT.MATTE, Math.PI / 8);
    for (let k = 0; k <= L; k++) tube(M, x, y, 8, 0.9 * pop, 0.12 + k * 0.08, 0.9 * pop, 0.16 + k * 0.08, GOLD, MAT.GLOSS, Math.PI / 8, false);
    const ca = Math.cos(t.aim), sa = Math.sin(t.aim);
    if (t.type === "archer") {
        const h = 2.0 + L * 0.4;
        tube(M, x, y, 8, 0.62, 0.38, 0.5, h, STONE, MAT.MATTE, Math.PI / 8);
        tube(M, x, y, 8, 0.75, h, 0.75, h + 0.18, WOOD, MAT.MATTE, Math.PI / 8);
        // crossbow on a swivel
        const hz = h + 0.42, bx = x + ca * 0.15, by = y + sa * 0.15;
        limb(M, [bx - ca * 0.45, by - sa * 0.45, hz], [bx + ca * 0.55, by + sa * 0.55, hz], 0.07, 0.06, WOOD, MAT.MATTE, 4);
        limb(M, [bx + ca * 0.3 - sa * 0.55, by + sa * 0.3 + ca * 0.55, hz], [bx + ca * 0.3 + sa * 0.55, by + sa * 0.3 - ca * 0.55, hz], 0.04, 0.04, BRONZE, MAT.GLOSS, 4);
        if (L >= 1) for (const s of [-1, 1]) M.tri([x + s * 0.52, y, h - 0.6], [x + s * 0.52, y, h - 0.05], [x + s * 0.9, y, h - 0.32], [0.25, 0.45, 0.85], MAT.MATTE);
        if (L >= 2) tube(M, x, y, 8, 0.85, h + 0.95, 0, h + 1.7, GOLD, MAT.GLOSS, Math.PI / 8);
        gem(M, x, y, h + (L >= 2 ? 2.0 : 1.05) + bob, 0.18, 0.45, c, time);
        if (!ghostCol) A.sprite(x, y - 0.2, h + (L >= 2 ? 2.0 : 1.05) + bob, 0.9 + t.flash * 0.6, c[0] * 0.18, c[1] * 0.18, c[2] * 0.18);
    } else if (t.type === "cannon") {
        tube(M, x, y, 10, 0.88, 0.38, 0.82, 1.0 + L * 0.12, STONE, MAT.MATTE);
        tube(M, x, y, 10, 0.92, 1.0 + L * 0.12, 0.92, 1.12 + L * 0.12, BRONZE, MAT.GLOSS);
        const hz = 1.38 + L * 0.12, len = 1.15 + L * 0.2, rr = 0.22 + L * 0.04, recoil = t.flash * 0.25;
        blob(M, [x, y, hz], 0.5, 0.5, 0.42, [0.32, 0.3, 0.3], MAT.GLOSS, 8, 5);
        const barrels = L >= 2 ? [-0.2, 0.2] : [0];
        for (const off of barrels) {
            const ox = -sa * off, oy = ca * off;
            limb(M, [x + ox - ca * (0.1 + recoil), y + oy - sa * (0.1 + recoil), hz + 0.05], [x + ox + ca * (len - recoil), y + oy + sa * (len - recoil), hz + 0.28], rr, rr * 0.8, [0.22, 0.2, 0.2], MAT.GLOSS, 8);
            const mx = x + ox + ca * (len - recoil), my = y + oy + sa * (len - recoil);
            tube(M, mx, my, 8, rr * 0.75, hz + 0.18, rr * 0.75, hz + 0.38, c, MAT.EMIT);
            if (!ghostCol && t.flash > 0) A.sprite(mx + ca * 0.3, my + sa * 0.3, hz + 0.3, 0.8 * t.flash, 1.6 * t.flash, 0.7 * t.flash, 0.2 * t.flash);
        }
        if (!ghostCol) A.sprite(x, y - 0.3, hz, 0.7, c[0] * 0.06, c[1] * 0.06, c[2] * 0.06);
    } else if (t.type === "frost") {
        tube(M, x, y, 6, 0.6, 0.38, 0.35, 1.25 + L * 0.15, [0.75, 0.82, 0.88], MAT.GLOSS);
        tube(M, x, y, 6, 0.55, 1.25 + L * 0.15, 0.62, 1.4 + L * 0.15, [0.85, 0.9, 0.95], MAT.GLOSS);
        const cz = 2.3 + L * 0.25 + bob;
        gem(M, x, y, cz, 0.32 + L * 0.05, 0.75 + L * 0.12, c, time * 0.8);
        for (let k = 0; k < 2 + L; k++) {
            const a = time * 1.4 + (k / (2 + L)) * TAU, rr = 0.85;
            gem(M, x + Math.cos(a) * rr, y + Math.sin(a) * rr, cz - 0.2 + Math.sin(a * 2) * 0.15, 0.08, 0.22, c, a);
        }
        if (!ghostCol) A.sprite(x, y - 0.3, cz, 1.4 + t.flash, c[0] * 0.15, c[1] * 0.15, c[2] * 0.15);
    } else if (t.type === "storm") {
        const h = 3.0 + L * 0.35;
        tube(M, x, y, 4, 0.6, 0.38, 0.32, h, [0.24, 0.22, 0.3], MAT.GLOSS, Math.PI / 4);
        for (let k = 0; k < 3 + L; k++) {                                         // glowing runes
            const z = 0.9 + k * ((h - 1.2) / (3 + L)), w = 0.58 - (z / h) * 0.28;
            tube(M, x, y, 4, w + 0.02, z, w, z + 0.08, c, MAT.EMIT, Math.PI / 4, false);
        }
        const cz = h + 0.6 + bob;
        gem(M, x, y, cz, 0.25 + L * 0.04, 0.55, c, time * 2);
        for (const s of [-1, 1]) limb(M, [x + s * 0.3, y, h - 0.1], [x + s * 0.55, y, h + 0.7], 0.06, 0.02, [0.3, 0.28, 0.36], MAT.GLOSS, 4);
        if (!ghostCol) {
            A.sprite(x, y - 0.3, cz, 1.2 + t.flash * 1.5, c[0] * 0.16, c[1] * 0.16, c[2] * 0.16);
            if (Math.sin(time * 13 + x) > 0.85) A.sprite(x + Math.sin(time * 40) * 0.4, y - 0.3, cz + 0.4, 0.25, 1.2, 1.0, 1.6);
        }
    }
    if (!ghostCol) shadow(Sh, x + 0.45, y + 0.3, 0.02, 1.25, 1.1, 0.42);
}

// ------------------------------------------------------------------ enemies
function eyes(S, A, x, y, z, hx, hy, sep, r, col) {
    const px = -hy, py = hx;
    for (const s of [-1, 1]) {
        const ex = x + hx * 0.02 + px * sep * s, ey = y + hy * 0.02 + py * sep * s;
        blob(S, [ex, ey, z], r, r, r, col, MAT.EMIT, 5, 3);
    }
    A.sprite(x + hx * 0.1, y + hy * 0.1, z, sep * 2.4, col[0] * 0.08, col[1] * 0.08, col[2] * 0.08);
}

// draws through a proxy that scales geometry about the enemy's feet, so models read well at board scale
class Scaled {
    constructor(m, cx, cy, cz, k) { this.m = m; this.cx = cx; this.cy = cy; this.cz = cz; this.k = k; }
    p(a) { return [this.cx + (a[0] - this.cx) * this.k, this.cy + (a[1] - this.cy) * this.k, this.cz + (a[2] - this.cz) * this.k, a[3]]; }
    v(x, y, z, w, r, g, b, mat) { const q = this.p([x, y, z]); this.m.v(q[0], q[1], q[2], w, r, g, b, mat); }
    tri(a, b, c, col, mat) { this.m.tri(this.p(a), this.p(b), this.p(c), col, mat); }
    quad(a, b, c, d, col, mat) { this.m.quad(this.p(a), this.p(b), this.p(c), this.p(d), col, mat); }
    quad4(a, b, c, d, ca, cb, cc, cd, mat) { this.m.quad4(this.p(a), this.p(b), this.p(c), this.p(d), ca, cb, cc, cd, mat); }
    sprite(x, y, z, s, r, g, b) { const q = this.p([x, y, z]); this.m.sprite(q[0], q[1], q[2], s * this.k, r, g, b); }
}
export const ENEMY_SCALE = { imp: 1.6, slimeling: 1.6, slime: 1.5, brute: 1.4, wisp: 1.35, golem: 1.25 };
export function drawEnemy(S0, A0, Sh, e, time) {
    const k = ENEMY_SCALE[e.type] || 1;
    const S = new Scaled(S0, e.x, e.y, e.air ? e.z : 0, k), A = new Scaled(A0, e.x, e.y, e.air ? e.z : 0, k);
    const { x, y } = e, hx = e.hx, hy = e.hy, s = e.def.size, ph = e.ph + time;
    const hit = e.hitT > 0 ? 1 : 0, frost = e.slowT > 0 ? 1 : 0;
    const tint = (c) => c.map((v, i) => (hit ? 1.4 : v * (frost ? [0.75, 0.9, 1.25][i] : 1)));
    const F = (f, side, up) => [x + hx * f - hy * side, y + hy * f + hx * side, up];         // forward / side / up
    if (e.type === "imp") {
        const hop = Math.abs(Math.sin(ph * 9)) * 0.18;
        blob(S, [x, y, 0.45 * s / 0.45 + hop], s * 0.75, s * 0.75, s * 0.85, tint([0.55, 0.12, 0.12]), MAT.MATTE, 7, 5);
        for (const sd of [-1, 1]) tube(S, ...F(0.05, sd * 0.2, 0).slice(0, 2), 4, 0.07, 0.8 + hop, 0, 1.15 + hop, tint([0.25, 0.15, 0.12]), MAT.MATTE);
        for (const sd of [-1, 1]) limb(S, F(0, sd * 0.18, 0.3 + hop), F(Math.sin(ph * 9 + sd) * 0.15, sd * 0.2, 0), 0.07, 0.05, tint([0.35, 0.08, 0.08]), MAT.MATTE, 4);
        eyes(S, A, ...F(0.28, 0, 0).slice(0, 2), 0.58 + hop, hx, hy, 0.13, 0.06, [1.6, 1.3, 0.2]);
    } else if (e.type === "brute") {
        const stomp = Math.abs(Math.sin(ph * 4)) * 0.08;
        blob(S, [x, y, 0.8 + stomp], 0.62, 0.62, 0.7, tint([0.42, 0.44, 0.5]), MAT.GLOSS, 9, 6);
        blob(S, [...F(0.15, 0, 0).slice(0, 2), 1.45 + stomp], 0.36, 0.36, 0.34, tint([0.5, 0.52, 0.58]), MAT.GLOSS, 7, 5);
        for (const sd of [-1, 1]) limb(S, F(0, sd * 0.3, 0.5 + stomp), F(Math.sin(ph * 4 + sd * 1.6) * 0.25, sd * 0.32, 0), 0.17, 0.15, tint([0.3, 0.28, 0.3]), MAT.MATTE, 5);
        const sh = F(0.55, -0.45, 0.85 + stomp);
        blob(S, sh, 0.12 + Math.abs(hy) * 0.35, 0.12 + Math.abs(hx) * 0.35, 0.5, tint([0.55, 0.36, 0.18]), MAT.GLOSS, 8, 4);
        eyes(S, A, ...F(0.42, 0, 0).slice(0, 2), 1.47 + stomp, hx, hy, 0.12, 0.05, [1.6, 0.25, 0.15]);
    } else if (e.type === "wisp") {
        const z = e.z, fl = Math.sin(ph * 7) * 0.08;
        tube(S, x, y, 7, 0.38, z - 0.35, 0, z + 0.65 + fl, tint([0.75, 0.35, 1.3]), MAT.EMIT, ph);
        blob(S, [x, y, z - 0.3], 0.38, 0.38, 0.3, tint([0.55, 0.25, 1.05]), MAT.EMIT, 7, 4);
        for (let k = 0; k < 3; k++) { const a = ph * 3 + k * 2.1; A.sprite(x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.5, z - 0.5 - k * 0.2, 0.12, 0.5, 0.25, 0.9); }
        A.sprite(x, y - 0.2, z, 1.2, 0.18, 0.08, 0.3);
        eyes(S, A, ...F(0.3, 0, 0).slice(0, 2), z + 0.05, hx, hy, 0.12, 0.05, [1.6, 1.5, 1.7]);
        shadow(Sh, x, y, 0.03, 0.6, 0.6, 0.25);
        return;
    } else if (e.type === "slime" || e.type === "slimeling") {
        const sq = Math.sin(ph * 6) * 0.15, k = s / 0.6;
        blob(S, [x, y, 0.42 * k * (1 - sq * 0.5)], 0.6 * k * (1 + sq * 0.3), 0.6 * k * (1 + sq * 0.3), 0.45 * k * (1 - sq), tint([0.35, 0.82, 0.38]), MAT.GLOSS, 9, 5);
        blob(S, [x, y, 0.5 * k], 0.28 * k, 0.28 * k, 0.2 * k, tint([0.65, 1.0, 0.55]), MAT.GLOSS, 6, 3);
        eyes(S, A, ...F(0.36 * k, 0, 0).slice(0, 2), 0.62 * k, hx, hy, 0.15 * k, 0.07 * k, [0.05, 0.08, 0.05]);
    } else if (e.type === "golem") {
        const step = Math.sin(ph * 2.2), sz = 1.0;
        blob(S, [x, y, 1.6], 1.0, 1.0, 1.1, tint([0.42, 0.38, 0.35]), MAT.MATTE, 9, 6, (i, j) => 0.9 + ((i * 3 + j * 5) % 4) * 0.05);
        blob(S, [...F(0.3, 0, 0).slice(0, 2), 2.85], 0.55, 0.55, 0.5, tint([0.45, 0.41, 0.37]), MAT.MATTE, 8, 5);
        for (const sd of [-1, 1]) {
            limb(S, F(0, sd * 0.95, 2.1), F(step * sd * 0.5 + 0.3, sd * 1.3, 0.6), 0.32, 0.4, tint([0.4, 0.36, 0.33]), MAT.MATTE, 6);
            limb(S, F(0, sd * 0.45, 0.9), F(step * sd * 0.45, sd * 0.5, 0), 0.38, 0.34, tint([0.38, 0.35, 0.32]), MAT.MATTE, 6);
        }
        for (let k = 0; k < 6; k++) {                                              // glowing cracks
            const a = k * 1.05 + 0.3, p = [x + Math.cos(a) * 0.98, y + Math.sin(a) * 0.98, 1.2 + (k % 3) * 0.4];
            limb(S, p, [p[0], p[1], p[2] + 0.35], 0.05, 0.03, [1.6, 0.6, 0.12], MAT.EMIT, 3);
        }
        eyes(S, A, ...F(0.78, 0, 0).slice(0, 2), 2.95, hx, hy, 0.2, 0.08, [1.8, 0.75, 0.15]);
        A.sprite(x, y - 0.5, 1.6, 2.4 * sz, 0.18, 0.07, 0.02);
    }
    if (frost) A.sprite(x, y - 0.3, 0.5 + s, s * 1.8, 0.1, 0.18, 0.28);
    shadow(Sh, x + 0.15, y + 0.1, 0.03, (s * 1.3 + 0.2) * k, (s * 1.3 + 0.2) * k, 0.4);
}

// health bar billboarded toward the camera (X / Y are the camera's screen axes)
export function healthBar(S, e, X, Y, z) {
    const f = Math.max(0, e.hp / e.maxHp), w = e.def.boss ? 1.6 : 0.62, h = e.def.boss ? 0.14 : 0.09;
    const c = [e.x, e.y, z];
    const P = (u, v) => [c[0] - X[0] * u + Y[0] * v, c[1] - X[1] * u + Y[1] * v, c[2] - X[2] * u + Y[2] * v];
    S.quad(P(-w - 0.03, -h - 0.03), P(w + 0.03, -h - 0.03), P(w + 0.03, h + 0.03), P(-w - 0.03, h + 0.03), [0.03, 0.02, 0.02], MAT.EMIT);
    const col = f > 0.6 ? [0.3, 0.75, 0.25] : f > 0.3 ? [0.8, 0.6, 0.1] : [0.8, 0.15, 0.1];
    S.quad(P(-w, -h), P(-w + 2 * w * f, -h), P(-w + 2 * w * f, h), P(-w, h), col, MAT.EMIT);
}

// ------------------------------------------------------------------ projectiles & world pieces
export function drawProjectile(S, A, p) {
    if (p.kind === "arrow") {
        const d = p.dir || [1, 0, 0];
        limb(S, [p.x - d[0] * 0.55, p.y - d[1] * 0.55, p.z - d[2] * 0.55], [p.x, p.y, p.z], 0.035, 0.03, WOOD, MAT.MATTE, 3);
        A.quad([p.x - d[0] * 1.6, p.y - d[1] * 1.6, p.z - d[2] * 1.6 - 0.02], [p.x, p.y, p.z - 0.02], [p.x, p.y, p.z + 0.02], [p.x - d[0] * 1.6, p.y - d[1] * 1.6, p.z - d[2] * 1.6 + 0.02], [0.15, 0.4, 0.55], MAT.ADD);
        A.sprite(p.x, p.y, p.z, 0.16, 0.3, 0.8, 1.0);
    } else if (p.kind === "shell") {
        blob(S, [p.x, p.y, p.z], 0.22, 0.22, 0.22, [0.15, 0.13, 0.12], MAT.GLOSS, 6, 4);
        A.sprite(p.x, p.y, p.z, 0.45, 0.7, 0.3, 0.08);
    } else if (p.kind === "frost") {
        A.sprite(p.x, p.y, p.z, 0.32, 0.5, 0.85, 1.2);
        A.sprite(p.x, p.y, p.z, 0.9, 0.08, 0.14, 0.2);
    }
}
export function drawKeep(S, A, k, time, hurt, livesFrac) {
    const [x, y, z] = k, bob = Math.sin(time * 1.3) * 0.15;
    const c = [0.4 + hurt * 1.2, 0.95 - hurt * 0.6, 1.35 - hurt * 0.9].map((v) => v * (0.6 + 0.4 * livesFrac));
    gem(S, x, y, z + bob, 0.55, 1.3, c, time * 0.5);
    for (let i = 0; i < 3; i++) { const a = time * 0.9 + i * 2.09; gem(S, x + Math.cos(a) * 1.1, y + Math.sin(a) * 1.1, z - 0.3 + Math.sin(a * 2) * 0.2, 0.12, 0.3, c, a); }
    A.sprite(x, y - 0.4, z + bob, 1.8 + hurt * 1.5, c[0] * 0.11, c[1] * 0.11, c[2] * 0.11);
    A.sprite(x, y - 0.4, z + bob, 4.5, c[0] * 0.025, c[1] * 0.025, c[2] * 0.025);
}
export function drawRift(S, A, s, time, active) {
    const [x, y] = s, cz = 1.35, k = active ? 1 : 0.55;
    for (let r = 0; r < 4; r++) {
        const rad = 1.15 - r * 0.25, n = 24;
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * TAU + time * (1.5 + r * 0.6) * (r % 2 ? -1 : 1), a1 = a0 + TAU / n * 0.6;
            const c = [0.55 * k, 0.2 * k, 1.1 * k].map((v) => v * (0.5 + r * 0.25));
            A.quad([x, y + Math.cos(a0) * rad, cz + Math.sin(a0) * rad * 1.3], [x, y + Math.cos(a1) * rad, cz + Math.sin(a1) * rad * 1.3], [x, y + Math.cos(a1) * (rad - 0.12), cz + Math.sin(a1) * (rad - 0.12) * 1.3], [x, y + Math.cos(a0) * (rad - 0.12), cz + Math.sin(a0) * (rad - 0.12) * 1.3], c, MAT.ADD);
        }
    }
    A.sprite(x + 0.3, y, cz, 1.6, 0.25 * k, 0.08 * k, 0.45 * k);
}
export function rangeRing(A, x, y, r, col, time) {
    const n = 72, pulse = 0.85 + 0.15 * Math.sin(time * 4);
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, c = col.map((v) => v * pulse);
        A.quad([x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.08], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.08], [x + Math.cos(a1) * (r - 0.09), y + Math.sin(a1) * (r - 0.09), 0.08], [x + Math.cos(a0) * (r - 0.09), y + Math.sin(a0) * (r - 0.09), 0.08], c, MAT.ADD);
        const f = col.map((v) => v * 0.05);
        A.tri([x, y, 0.07], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.07], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.07], f, MAT.ADD);
    }
}
export function cellGlow(A, x, y, col) {
    const h = CELL / 2 - 0.08;
    A.quad([x - h, y - h, 0.06], [x + h, y - h, 0.06], [x + h, y + h, 0.06], [x - h, y + h, 0.06], col.map((v) => v * 0.25), MAT.ADD);
    for (const [ax, ay, bx, by] of [[-h, -h, h, -h], [h, -h, h, h], [h, h, -h, h], [-h, h, -h, -h]]) {
        const nx = ay === by ? 0 : 0.07 * Math.sign(ax), ny = ax === bx ? 0 : 0.07 * Math.sign(ay);
        A.quad([x + ax, y + ay, 0.07], [x + bx, y + by, 0.07], [x + bx - nx, y + by - ny, 0.07], [x + ax - nx, y + ay - ny, 0.07], col, MAT.ADD);
    }
}
