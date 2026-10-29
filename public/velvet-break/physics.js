// Pool physics — pure, no rendering. World units = metres × 10, the table's playing area is centred on the
// origin: x ∈ [-L/2, L/2] (long axis), y ∈ [-W/2, W/2]. Balls roll on z = R.

export const L = 25.4, W = 12.7, R = 0.286, MAXV = 42;
const ROLL = 2.0, STOP = 0.035, E_BALL = 0.95, E_RAIL = 0.78, SUB = 1 / 240;

const CM = 0.82, SM = 0.62;                               // corner and side pocket mouths (distance along the rail)
export const POCKETS = [
    { x: -L / 2 - 0.12, y: W / 2 + 0.12, r: 0.62 }, { x: 0, y: W / 2 + 0.28, r: 0.56 }, { x: L / 2 + 0.12, y: W / 2 + 0.12, r: 0.62 },
    { x: -L / 2 - 0.12, y: -W / 2 - 0.12, r: 0.62 }, { x: 0, y: -W / 2 - 0.28, r: 0.56 }, { x: L / 2 + 0.12, y: -W / 2 - 0.12, r: 0.62 },
];

// cushion segments (with jaws angling into each pocket)
export const RAILS = (() => {
    const s = [], hx = L / 2, hy = W / 2, J = 0.5;
    const seg = (ax, ay, bx, by) => s.push({ ax, ay, bx, by });
    for (const sy of [1, -1]) {
        const y = sy * hy;
        seg(-hx + CM, y, -SM, y); seg(SM, y, hx - CM, y);
        seg(-hx + CM, y, -hx + CM - J * 0.6, y + sy * J); seg(hx - CM, y, hx - CM + J * 0.6, y + sy * J);
        seg(-SM, y, -SM + 0.12, y + sy * J); seg(SM, y, SM - 0.12, y + sy * J);
    }
    for (const sx of [1, -1]) {
        const x = sx * hx;
        seg(x, -hy + CM, x, hy - CM);
        seg(x, hy - CM, x + sx * J, hy - CM + J * 0.6); seg(x, -hy + CM, x + sx * J, -hy + CM - J * 0.6);
    }
    return s;
})();

export const COLORS = {
    1: [0.98, 0.78, 0.1], 2: [0.1, 0.3, 0.85], 3: [0.88, 0.12, 0.1], 4: [0.42, 0.16, 0.6], 5: [1.0, 0.45, 0.08], 6: [0.05, 0.5, 0.25], 7: [0.5, 0.08, 0.1], 8: [0.04, 0.04, 0.05],
};
export const ballColor = (n) => (n === 0 ? [0.95, 0.94, 0.9] : COLORS[n > 8 ? n - 8 : n]);
export const isSolid = (n) => n >= 1 && n <= 7, isStripe = (n) => n >= 9 && n <= 15;

const HEAD_X = -L / 4, FOOT_X = L / 4;
export function rack(rng = Math.random) {
    const balls = [{ n: 0, x: HEAD_X, y: 0 }];
    // classic rack: 8 in the centre, a solid and a stripe in the back corners, the rest shuffled
    const others = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const spots = [];
    for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) spots.push([FOOT_X + row * R * 2 * 0.866 * 1.005, (k - row / 2) * R * 2 * 1.005]);
    const order = new Array(15);
    order[4] = 8;                                               // centre of the third row
    const solid = others.find(isSolid), stripe = others.find(isStripe);
    order[10] = solid; order[14] = stripe;
    const rest = others.filter((n) => n !== solid && n !== stripe);
    for (let i = 0; i < 15; i++) if (order[i] == null) order[i] = rest.shift();
    spots.forEach(([x, y], i) => balls.push({ n: order[i], x, y }));
    return balls.map((b) => ({ ...b, vx: 0, vy: 0, q: [1, 0, 0, 0], potted: false, sink: 0 }));
}

export class Table {
    constructor(balls) { this.balls = balls; this.events = []; this.shot = null; }
    get cue() { return this.balls[0]; }
    moving() { return this.balls.some((b) => !b.potted && (b.vx || b.vy)) || this.balls.some((b) => b.potted && b.sink < 1); }

    strike(angle, power, spin = { x: 0, y: 0 }) {
        const c = this.cue, v = MAXV * Math.max(0.03, power);
        c.vx = Math.cos(angle) * v; c.vy = Math.sin(angle) * v;
        this.shot = { angle, power, spin: { ...spin }, first: null, potted: [], rails: 0, contacts: 0, cueSpinUsed: false };
        this.events.push({ type: "strike", power });
    }

    step(dt) {
        let t = dt;
        while (t > 1e-9) { const h = Math.min(SUB, t); this.sub(h); t -= h; }
        for (const b of this.balls) if (b.potted && b.sink < 1) b.sink = Math.min(1, b.sink + dt * 2.2);
    }

    sub(h) {
        const bs = this.balls;
        for (const b of bs) {
            if (b.potted || (!b.vx && !b.vy)) continue;
            const sp = Math.hypot(b.vx, b.vy);
            const dec = (ROLL + (sp < 1.2 ? 1.6 : 0)) * h;
            if (sp <= dec || sp < STOP) { b.vx = 0; b.vy = 0; continue; }
            const k = (sp - dec) / sp;
            b.vx *= k; b.vy *= k;
            b.x += b.vx * h; b.y += b.vy * h;
            // roll the ball's orientation about (up × v)
            const ang = (sp * h) / R, ax = -b.vy / sp, ay = b.vx / sp;
            rotate(b.q, ax, ay, 0, ang);
        }
        // ball–ball
        for (let i = 0; i < bs.length; i++) {
            const a = bs[i]; if (a.potted) continue;
            for (let j = i + 1; j < bs.length; j++) {
                const b = bs[j]; if (b.potted) continue;
                const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
                if (d2 >= 4 * R * R || d2 === 0) continue;
                const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
                const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
                const over = 2 * R - d;
                a.x -= nx * over / 2; a.y -= ny * over / 2; b.x += nx * over / 2; b.y += ny * over / 2;
                if (rel <= 0) continue;
                const jimp = rel * (1 + E_BALL) / 2;
                a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
                this.events.push({ type: "clack", speed: rel, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                if (this.shot) {
                    this.shot.contacts++;
                    const cueHit = a.n === 0 ? b : b.n === 0 ? a : null;
                    if (cueHit && this.shot.first == null) this.shot.first = cueHit.n;
                    // follow / draw / throw from the cue ball's spin, once, at its first contact
                    if (cueHit && !this.shot.cueSpinUsed) {
                        this.shot.cueSpinUsed = true;
                        const c = this.cue, s = this.shot.spin, ca = Math.cos(this.shot.angle), sa = Math.sin(this.shot.angle);
                        c.vx += ca * s.y * rel * 0.62; c.vy += sa * s.y * rel * 0.62;
                        c.vx += -sa * s.x * rel * 0.12; c.vy += ca * s.x * rel * 0.12;
                    }
                }
            }
        }
        // cushions
        for (const b of bs) {
            if (b.potted) continue;
            for (const s of RAILS) {
                const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey;
                let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / l2;
                t = Math.max(0, Math.min(1, t));
                const px = s.ax + ex * t, py = s.ay + ey * t, dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy;
                if (d2 >= R * R || d2 === 0) continue;
                const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
                b.x = px + nx * R; b.y = py + ny * R;
                const vn = b.vx * nx + b.vy * ny;
                if (vn >= 0) continue;
                b.vx -= (1 + E_RAIL) * vn * nx; b.vy -= (1 + E_RAIL) * vn * ny;
                if (b.n === 0 && this.shot && this.shot.spin.x) { const tx = -ny, ty = nx, k = this.shot.spin.x * -vn * 0.25; b.vx += tx * k; b.vy += ty * k; }
                if (this.shot) this.shot.rails++;
                this.events.push({ type: "rail", speed: -vn, x: b.x, y: b.y });
            }
            // pockets (and a safety net for anything that escapes the cushions)
            for (const p of POCKETS) {
                if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) { this.pot(b, p); break; }
            }
            if (!b.potted && (Math.abs(b.x) > L / 2 + 0.7 || Math.abs(b.y) > W / 2 + 0.7)) {
                let best = POCKETS[0], bd = 1e9;
                for (const p of POCKETS) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = p; } }
                this.pot(b, best);
            }
        }
    }
    pot(b, p) {
        b.potted = true; b.sink = 0; b.px = p.x; b.py = p.y; b.vx = 0; b.vy = 0;
        if (this.shot) this.shot.potted.push(b.n);
        this.events.push({ type: "pot", n: b.n, x: p.x, y: p.y });
    }

    // is (x, y) a legal free spot for the cue ball?
    free(x, y, ignore = 0) {
        if (Math.abs(x) > L / 2 - R || Math.abs(y) > W / 2 - R) return false;
        return this.balls.every((b) => b.n === ignore || b.potted || Math.hypot(b.x - x, b.y - y) > 2 * R + 0.02);
    }
    respot(n) {                                          // put a ball back on the foot spot (or just behind it)
        const b = this.balls.find((x) => x.n === n);
        let x = FOOT_X;
        while (!this.free(x, 0, n) && x < L / 2 - R) x += 0.1;
        Object.assign(b, { x, y: 0, vx: 0, vy: 0, potted: false, sink: 0 });
    }
}

// rotate quaternion q (w, x, y, z) by `ang` about the unit axis (ax, ay, az), in place
export function rotate(q, ax, ay, az, ang) {
    const s = Math.sin(ang / 2), c = Math.cos(ang / 2);
    const rw = c, rx = ax * s, ry = ay * s, rz = az * s;
    const [w, x, y, z] = q;
    q[0] = rw * w - rx * x - ry * y - rz * z;
    q[1] = rw * x + rx * w + ry * z - rz * y;
    q[2] = rw * y - rx * z + ry * w + rz * x;
    q[3] = rw * z + rx * y - ry * x + rz * w;
    const n = Math.hypot(q[0], q[1], q[2], q[3]); q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
}
export function qrot(q, v) {                            // rotate vector v by q
    const [w, x, y, z] = q, [vx, vy, vz] = v;
    const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export { HEAD_X, FOOT_X };
