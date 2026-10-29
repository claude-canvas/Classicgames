// The Matron (DESIGN.md §2). Grid BFS pathing through open or unlocked doors (she opens them as she goes),
// sight = line of sight + view cone + range, hearing = noise events from the game.
//   dormant → wander ⇄ investigate → chase → search → wander

export class Monster {
    constructor(world) {
        this.w = world; this.x = 0; this.y = 0; this.ang = 0; this.state = "dormant";
        this.path = []; this.repath = 0; this.speed = 1.25; this.chaseSpeed = 3.0;
        this.lastSeen = null; this.lostT = 0; this.searchT = 0; this.stepT = 0; this.breathT = 3; this.anim = 0; this.seeT = 0;
        this.sees = false; this.seenEnter = -99; this.relentless = 0; this.target = null;
    }
    spawn(x, y) { this.x = x + 0.5; this.y = y + 0.5; this.state = "wander"; this.path = []; }
    walkable(cx, cy) {
        const w = this.w;
        if (cx < 0 || cy < 0 || cx >= w.W || cy >= w.H) return false;
        const i = cy * w.W + cx;
        if (w.solidWall[i] || w.decorSolid[i]) return false;
        const d = w.doorAt[i];
        return !d || !d.locked;
    }
    bfs(tx, ty) {
        const w = this.w, W = w.W, sx = this.x | 0, sy = this.y | 0;
        if (!this.walkable(tx, ty)) return null;
        const prev = new Int32Array(W * w.H).fill(-1), q = [sy * W + sx]; prev[q[0]] = q[0];
        for (let h = 0; h < q.length; h++) {
            const c = q[h]; if (c === ty * W + tx) break;
            const cx = c % W, cy = (c / W) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
                if (prev[n] !== -1 || !this.walkable(nx, ny)) continue;
                prev[n] = c; q.push(n);
            }
        }
        const t = ty * W + tx; if (prev[t] === -1) return null;
        const path = []; for (let c = t; c !== sy * W + sx; c = prev[c]) path.push([c % W + 0.5, ((c / W) | 0) + 0.5]);
        return path.reverse();
    }
    pathLen(tx, ty) { const p = this.bfs(tx, ty); return p ? p.length : 999; }
    goTo(tx, ty) { const p = this.bfs(tx | 0, ty | 0); if (p) this.path = p; return !!p; }
    los(px, py) {
        const w = this.w; let x = this.x, y = this.y; const dx = px - x, dy = py - y, d = Math.hypot(dx, dy), n = Math.ceil(d / 0.2);
        for (let i = 1; i < n; i++) {
            const cx = (x + dx * i / n) | 0, cy = (y + dy * i / n) | 0, k = cy * w.W + cx;
            if (w.solidWall[k]) return false;
            const door = w.doorAt[k]; if (door && door.open < 0.6) return false;
        }
        return true;
    }
    hear(x, y, radius) {
        if (this.state === "dormant" || this.state === "chase") return;
        const d = Math.hypot(x - this.x, y - this.y);
        if (d > radius) return;
        if (this.goTo(x, y)) { this.state = "investigate"; this.target = [x, y]; }
    }
    update(dt, g) {
        if (this.state === "dormant") return;
        const p = g.player, w = this.w;
        const dx = p.x - this.x, dy = p.y - this.y, dist = Math.hypot(dx, dy);
        // --- sight
        const facing = Math.cos(Math.atan2(dy, dx) - this.ang);
        let range = 13;
        if (p.flash && Math.cos(Math.atan2(-dy, -dx) - p.ang) > 0.75) range = 19;
        if (p.crouch && !p.flash) range = 6;
        this.sees = !p.hidden && dist < range && (facing > 0.34 || dist < 2.5 || this.state === "chase") && this.los(p.x, p.y);
        if (this.sees) { this.seeT += dt; } else this.seeT = 0;
        if (this.relentless > 0) { this.relentless -= dt; if (!p.hidden) { this.sees = true; } }
        if (this.sees && (this.seeT > 0.25 || dist < 4 || this.state === "chase")) {
            if (this.state !== "chase") g.onSpotted();
            this.state = "chase"; this.lastSeen = [p.x, p.y]; this.lostT = 0;
        }
        // --- state machine
        if (this.state === "chase") {
            this.repath -= dt;
            if (!this.sees) { this.lostT += dt; if (this.lostT > 5) { this.state = "search"; this.searchT = 8; this.goTo(this.lastSeen[0], this.lastSeen[1]); } }
            if (this.repath <= 0) { this.repath = 0.25; const t = this.sees ? [p.x, p.y] : this.lastSeen; if (!this.goTo(t[0], t[1]) && this.sees) this.path = [[p.x, p.y]]; }
        } else if (this.state === "search") {
            this.searchT -= dt;
            if (!this.path.length) { const a = Math.random() * 6.28, r = 1 + Math.random() * 4; this.goTo(this.lastSeen[0] + Math.cos(a) * r, this.lastSeen[1] + Math.sin(a) * r); }
            if (this.searchT <= 0) this.state = "wander";
        } else if (this.state === "investigate") {
            if (!this.path.length) { this.state = "search"; this.searchT = 5; this.lastSeen = this.target || [this.x, this.y]; }
        } else if (this.state === "wander") {
            if (!this.path.length) {
                // keep the pressure on: often drift toward the player's part of the building
                for (let k = 0; k < 12; k++) {
                    const near = Math.random() < 0.45;
                    const c = near ? [p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16] : w.floorCells[(Math.random() * w.floorCells.length) | 0];
                    if (this.goTo(c[0], c[1])) break;
                }
            }
        }
        // --- move along the path
        const sp = this.state === "chase" ? this.chaseSpeed : this.state === "investigate" ? this.speed * 1.5 : this.speed;
        let moving = false;
        if (this.path.length) {
            const [tx, ty] = this.path[0];
            const nd = w.doorAt[(ty | 0) * w.W + (tx | 0)];
            if (nd && nd.open < 0.95) { if (nd.target < 1) { nd.target = 1; g.doorSound(nd, true); } }
            else {
                const ddx = tx - this.x, ddy = ty - this.y, d = Math.hypot(ddx, ddy);
                if (d < 0.08) this.path.shift();
                else {
                    const s = Math.min(d, sp * dt);
                    this.x += ddx / d * s; this.y += ddy / d * s; moving = true;
                    const ta = Math.atan2(ddy, ddx); this.ang += Math.atan2(Math.sin(ta - this.ang), Math.cos(ta - this.ang)) * Math.min(1, dt * 8);
                }
            }
        }
        if (this.state === "chase" && this.sees && dist < 2.2) { const ta = Math.atan2(dy, dx); this.ang = ta; if (dist > 0.6) { this.x += dx / dist * sp * dt * 0.6; this.y += dy / dist * sp * dt * 0.6; } }
        // --- footsteps / breath
        this.anim += dt * (moving ? sp * 2.2 : 0.5);
        this.stepT -= dt;
        if (moving && this.stepT <= 0) { this.stepT = 1.6 / Math.max(1.2, sp); g.monsterSound("step"); }
        this.breathT -= dt;
        if (this.breathT <= 0) { this.breathT = this.state === "chase" ? 1.4 : 3 + Math.random() * 4; g.monsterSound("breath"); }
        // --- catch
        if (dist < 0.75 && !p.hidden) g.caught();
        if (p.hidden && this.state === "chase" && g.time - this.seenEnter < 2 && dist < 1.4) g.caught();
    }
}
