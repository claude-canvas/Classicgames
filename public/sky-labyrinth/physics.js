// Sky Labyrinth physics: pure, no DOM. Shared by main.js and the Node bot (DESIGN.md §3, §6).
// Board-local coordinates: cell (c, r) is centred at x = c − (W−1)/2, y = (H−1)/2 − r, floor at z = 0.

export const R = 0.26, HOLE_R = 0.38, FALL_R = 0.25, BUMP_R = 0.24, WALL_H = 0.6;
export const MAX_TILT = 0.17, G = 26, MAX_V = 11, BOOST = 16, KICK = 4.5, CRUMBLE_T = 0.7;
const FRICTION = { ".": 0.45, "~": 0.05, ":": 3.2 };
const BOOSTS = { ">": [1, 0], "<": [-1, 0], "^": [0, 1], "v": [0, -1] };

export function parse(def) {
    const H = def.map.length, W = Math.max(...def.map.map((r) => r.length));
    const cells = def.map.map((row) => row.padEnd(W, " ").split(""));
    const L = { W, H, cells, name: def.name, par: def.par, start: null, goal: null, gems: [], holes: [], checks: [], switches: [], gates: [], bumpers: [], crumbles: [], boosts: [] };
    const xy = (c, r) => [c - (W - 1) / 2, (H - 1) / 2 - r];
    L.xy = xy;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const ch = cells[r][c], [x, y] = xy(c, r), o = { c, r, x, y };
        if (ch === "S") L.start = o;
        else if (ch === "G") L.goal = o;
        else if (ch === "*") L.gems.push(o);
        else if (ch === "O") L.holes.push(o);
        else if (ch === "c") L.checks.push(o);
        else if (ch === "k") L.switches.push(o);
        else if (ch === "=") L.gates.push(o);
        else if (ch === "b") L.bumpers.push(o);
        else if (ch === "x") L.crumbles.push(o);
        else if (BOOSTS[ch]) L.boosts.push({ ...o, d: BOOSTS[ch] });
    }
    return L;
}

// the board can't snap to a new angle: exponential approach with a rate limit (rad/s)
export function approachTilt(cur, target, dt) {
    const d = (target - cur) * Math.min(1, dt * 9);
    const lim = 1.6 * dt;
    return cur + Math.max(-lim, Math.min(lim, d));
}

export class Sim {
    constructor(L) {
        this.L = L;
        this.crumbleIdx = new Map(L.crumbles.map((o, i) => [o.r * L.W + o.c, i]));
        this.restart();
    }
    restart() {
        this.gems = this.L.gems.map(() => false);
        this.gatesOpen = false;
        this.check = this.L.start;
        this.time = 0; this.falls = 0; this.done = false;
        this.respawn();
    }
    respawn() {
        const s = this.check;
        this.ball = { x: s.x, y: s.y, z: 0, vx: 0, vy: 0 };
        this.state = "roll"; this.fall = null; this.goalT = 0;
        this.crumble = this.L.crumbles.map(() => ({ t: -1, broken: false }));
        this.lastBump = -1;
    }
    cellOf(x, y) { const L = this.L; return [Math.round(x + (L.W - 1) / 2), Math.round((L.H - 1) / 2 - y)]; }
    ch(c, r) { const L = this.L; return r < 0 || r >= L.H || c < 0 || c >= L.W ? " " : L.cells[r][c]; }
    solid(c, r) { const k = this.ch(c, r); return k === "#" || (k === "=" && !this.gatesOpen); }
    floor(c, r) {
        const k = this.ch(c, r);
        if (k === " ") return false;
        if (k === "x") return !this.crumble[this.crumbleIdx.get(r * this.L.W + c)].broken;
        return true;
    }

    step(dt, tx, ty) {
        const ev = [];
        if (this.state === "goal") { this.goalT += dt; return ev; }
        this.time += dt;
        const b = this.ball, L = this.L;
        // crumbling tiles
        this.crumble.forEach((s, i) => {
            if (s.t >= 0 && !s.broken) { s.t += dt; if (s.t >= CRUMBLE_T) { s.broken = true; ev.push({ type: "crumble", i }); } }
        });
        if (this.state === "fall") {
            const f = this.fall;
            f.t += dt;
            if (f.hole) { b.x += (f.hole.x - b.x) * Math.min(1, dt * 14); b.y += (f.hole.y - b.y) * Math.min(1, dt * 14); }
            else { b.x += b.vx * dt; b.y += b.vy * dt; }
            f.vz -= 22 * dt; b.z += f.vz * dt;
            if (f.t > 1.15) { this.respawn(); ev.push({ type: "respawn" }); }
            return ev;
        }
        const sp = Math.hypot(b.vx, b.vy);
        const n = Math.min(14, Math.ceil((sp * dt) / 0.06) + 1), h = dt / n;
        const ax0 = G * Math.sin(tx), ay0 = G * Math.sin(ty);
        let maxHit = 0;
        for (let k = 0; k < n && this.state === "roll"; k++) {
            const [c, r] = this.cellOf(b.x, b.y), here = this.ch(c, r);
            let ax = ax0, ay = ay0;
            const bo = BOOSTS[here];
            if (bo) { ax += bo[0] * BOOST; ay += bo[1] * BOOST; if (!this._boosting) ev.push({ type: "boost" }); this._boosting = true; } else this._boosting = false;
            for (const o of L.holes) {
                const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy);
                if (d < HOLE_R && d > 1e-4) { const p = 16 * (1 - d / HOLE_R); ax += (dx / d) * p; ay += (dy / d) * p; }
            }
            b.vx += ax * h; b.vy += ay * h;
            const fr = Math.exp(-(FRICTION[here] ?? 0.45) * h);
            b.vx *= fr; b.vy *= fr;
            const s = Math.hypot(b.vx, b.vy);
            if (s > MAX_V) { b.vx *= MAX_V / s; b.vy *= MAX_V / s; }
            b.x += b.vx * h; b.y += b.vy * h;
            // walls / closed gates (two passes so corners settle)
            for (let pass = 0; pass < 2; pass++) {
                const [cc, rr] = this.cellOf(b.x, b.y);
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                    if (!this.solid(cc + dc, rr + dr)) continue;
                    const [wx, wy] = L.xy(cc + dc, rr + dr);
                    const qx = Math.max(wx - 0.5, Math.min(wx + 0.5, b.x)), qy = Math.max(wy - 0.5, Math.min(wy + 0.5, b.y));
                    let nx = b.x - qx, ny = b.y - qy, d = Math.hypot(nx, ny);
                    if (d >= R) continue;
                    if (d < 1e-6) {                                 // centre inside the block: leave along the shallow axis
                        const px = 0.5 - Math.abs(b.x - wx), py = 0.5 - Math.abs(b.y - wy);
                        if (px < py) { nx = Math.sign(b.x - wx) || 1; ny = 0; d = -px; } else { nx = 0; ny = Math.sign(b.y - wy) || 1; d = -py; }
                    } else { nx /= d; ny /= d; }
                    b.x += nx * (R - d); b.y += ny * (R - d);
                    const vn = b.vx * nx + b.vy * ny;
                    if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vy -= 1.35 * vn * ny; b.vx *= 0.985; b.vy *= 0.985; maxHit = Math.max(maxHit, -vn); }
                }
            }
            // bumpers
            L.bumpers.forEach((o, i) => {
                const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
                if (d >= R + BUMP_R || d < 1e-6) return;
                const nx = dx / d, ny = dy / d;
                b.x = o.x + nx * (R + BUMP_R); b.y = o.y + ny * (R + BUMP_R);
                const vn = b.vx * nx + b.vy * ny;
                if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
                b.vx += nx * KICK; b.vy += ny * KICK;
                ev.push({ type: "bump", i });
            });
            // holes, edges
            for (const o of L.holes) if (Math.hypot(o.x - b.x, o.y - b.y) < FALL_R) { this.startFall(o, ev); break; }
            if (this.state !== "roll") break;
            const [fc, fr2] = this.cellOf(b.x, b.y);
            if (!this.floor(fc, fr2)) { this.startFall(null, ev); break; }
            const ci = this.crumbleIdx.get(fr2 * L.W + fc);
            if (ci !== undefined && this.crumble[ci].t < 0) { this.crumble[ci].t = 0; ev.push({ type: "crack", i: ci }); }
            // pickups
            L.gems.forEach((o, i) => { if (!this.gems[i] && Math.hypot(o.x - b.x, o.y - b.y) < 0.45) { this.gems[i] = true; ev.push({ type: "gem", i }); } });
            L.checks.forEach((o, i) => { if (this.check !== o && Math.hypot(o.x - b.x, o.y - b.y) < 0.45) { this.check = o; ev.push({ type: "check", i }); } });
            if (!this.gatesOpen) for (const o of L.switches) if (Math.hypot(o.x - b.x, o.y - b.y) < 0.4) { this.gatesOpen = true; ev.push({ type: "switch" }); break; }
            const g = L.goal;
            if (Math.hypot(g.x - b.x, g.y - b.y) < 0.34) { this.state = "goal"; this.done = true; this.goalT = 0; ev.push({ type: "goal" }); }
        }
        if (maxHit > 0.4) ev.push({ type: "hit", s: maxHit });
        return ev;
    }
    startFall(hole, ev) {
        this.state = "fall"; this.falls++;
        this.fall = { t: 0, hole, vz: hole ? -1 : 0 };
        ev.push({ type: "fall", hole: !!hole });
    }
    get gemCount() { return this.gems.filter(Boolean).length; }
}
