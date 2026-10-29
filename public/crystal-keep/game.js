// The simulation: waves, enemies, towers, targeting, projectiles, economy. No rendering here — the game pushes
// events into `this.events` (shots, hits, explosions, gold, leaks…) that main.js turns into effects, sound and UI.

import { TOWERS, ENEMIES, DIFFS, hpScale, SELL_REFUND } from "./defs.js";
import { CELL, cellX, cellY, routePoint, waveScript } from "./maps.js";

let nextId = 1;

export class Game {
    constructor(map, diffId, startWave = 0) {
        this.map = map;
        this.diff = DIFFS[diffId] || DIFFS.normal;
        this.waves = waveScript(map.spawns.length);
        this.lives = this.diff.lives; this.maxLives = this.diff.lives;
        this.gold = this.diff.gold + (map.goldBonus || 0) + startWave * 60;
        this.wave = startWave;                        // waves started so far
        this.phase = "build";                         // build | wave | won | lost
        this.timer = this.diff.timer + 10;            // countdown to the next wave
        this.towers = []; this.enemies = []; this.projectiles = []; this.queue = [];
        this.events = []; this.time = 0; this.waveTime = 0;
        this.stats = { killed: 0, goldEarned: 0, built: 0, leaked: 0, spent: 0 };
        this.occupied = new Set();
    }

    get totalWaves() { return this.waves.length; }
    emit(e) { this.events.push(e); }

    // ------------------------------------------------------------------ building
    canBuild(i, j) { return this.map.buildable(i, j) && !this.occupied.has(i + "," + j); }
    towerAt(i, j) { return this.towers.find((t) => t.i === i && t.j === j); }
    build(type, i, j) {
        const def = TOWERS[type], cost = def.levels[0].cost;
        if (!this.canBuild(i, j)) return { ok: false, why: "You can't build there" };
        if (this.gold < cost) return { ok: false, why: "Not enough gold" };
        this.gold -= cost; this.stats.spent += cost; this.stats.built++;
        const t = { id: nextId++, type, def, level: 0, i, j, x: cellX(i), y: cellY(j), cd: 0.3, aim: Math.PI / 2, priority: "first", spent: cost, kills: 0, dmg: 0, flash: 0, born: this.time };
        this.towers.push(t); this.occupied.add(i + "," + j);
        this.emit({ type: "build", tower: t });
        return { ok: true, tower: t };
    }
    upgradeCost(t) { return t.level < 2 ? t.def.levels[t.level + 1].cost : null; }
    upgrade(t) {
        const c = this.upgradeCost(t);
        if (c == null) return { ok: false, why: "Already at max level" };
        if (this.gold < c) return { ok: false, why: "Not enough gold" };
        this.gold -= c; t.spent += c; this.stats.spent += c; t.level++; t.born = this.time;
        this.emit({ type: "upgrade", tower: t });
        return { ok: true };
    }
    sellValue(t) { return Math.floor(t.spent * SELL_REFUND); }
    sell(t) {
        const v = this.sellValue(t);
        this.gold += v;
        this.towers = this.towers.filter((x) => x !== t); this.occupied.delete(t.i + "," + t.j);
        this.emit({ type: "sell", tower: t, gold: v });
    }

    // ------------------------------------------------------------------ waves
    nextWavePreview() {
        const w = this.waves[this.wave];
        if (!w) return [];
        const counts = {};
        for (const g of w) counts[g.type] = (counts[g.type] || 0) + g.count;
        return Object.entries(counts).map(([type, count]) => ({ type, count }));
    }
    callWave() {
        if (this.phase !== "build" || this.wave >= this.waves.length) return 0;
        const bonus = this.wave > 0 || this.timer < this.diff.timer + 10 ? Math.floor(this.timer * 2) : 0;
        this.gold += bonus; this.stats.goldEarned += bonus;
        this.startWave();
        return bonus;
    }
    startWave() {
        const w = this.waves[this.wave];
        this.wave++; this.phase = "wave"; this.waveTime = 0;
        for (const g of w) for (let k = 0; k < g.count; k++) this.queue.push({ type: g.type, at: g.delay + k * g.gap, spawn: g.spawn });
        this.queue.sort((a, b) => a.at - b.at);
        this.emit({ type: "wave", wave: this.wave, boss: w.some((g) => ENEMIES[g.type].boss) });
    }

    spawn(type, routeIdx, d = 0, hpOverride = null) {
        const def = ENEMIES[type], route = this.map.routes[routeIdx];
        const hp = hpOverride ?? Math.round(def.hp * hpScale(this.wave) * this.diff.hp);
        const e = { id: nextId++, type, def, hp, maxHp: hp, route, routeIdx, d, x: 0, y: 0, z: 0, hx: 1, hy: 0, slowT: 0, slowK: 0, hitT: 0, alive: true, air: !!def.air, ph: Math.random() * 6.28, lateral: (Math.random() - 0.5) * 0.5 };
        this.place(e);
        this.enemies.push(e);
        if (def.boss) this.emit({ type: "boss", enemy: e });
        return e;
    }
    place(e) {
        const p = routePoint(e.route, e.d);
        e.x = p.x - p.dy * e.lateral; e.y = p.y + p.dx * e.lateral; e.hx = p.dx; e.hy = p.dy;
        e.z = e.air ? 1.9 + Math.sin(this.time * 2.5 + e.ph) * 0.25 : 0;
    }

    // ------------------------------------------------------------------ combat
    damage(e, dmg, tower) {
        if (!e.alive) return;
        const eff = Math.max(dmg * 0.25, dmg - e.def.armor);
        e.hp -= eff; e.hitT = 0.12;
        if (tower) tower.dmg += eff;
        this.emit({ type: "dmg", x: e.x, y: e.y, z: e.z + e.def.size * 1.6, amount: Math.round(eff), enemy: e });
        if (e.hp <= 0) this.kill(e, tower);
    }
    kill(e, tower) {
        e.alive = false;
        const bounty = e.def.bounty;
        this.gold += bounty; this.stats.goldEarned += bounty; this.stats.killed++;
        if (tower) tower.kills++;
        this.emit({ type: "kill", enemy: e, gold: bounty });
        if (e.def.split) for (const s of [-0.5, 0.5]) {
            const c = this.spawn(e.def.split, e.routeIdx, Math.max(0, e.d + s * 0.8), Math.round(ENEMIES[e.def.split].hp * hpScale(this.wave) * this.diff.hp));
            c.lateral = s * 0.6;
        }
    }
    inRange(t, range) {
        const r = range * CELL, out = [];
        for (const e of this.enemies) {
            if (!e.alive || (e.air && !t.def.air)) continue;
            const d = Math.hypot(e.x - t.x, e.y - t.y);
            if (d <= r) out.push([e, d]);
        }
        return out;
    }
    pick(t, list) {
        if (!list.length) return null;
        const left = (e) => e.route.total - e.d;
        const by = {
            first: (a, b) => left(a[0]) - left(b[0]),
            last: (a, b) => left(b[0]) - left(a[0]),
            strong: (a, b) => b[0].hp - a[0].hp,
            close: (a, b) => a[1] - b[1],
        }[t.priority];
        return list.sort(by)[0][0];
    }
    fire(t, target) {
        const L = t.def.levels[t.level];
        const tz = t.type === "archer" ? 2.6 + t.level * 0.4 : t.type === "storm" ? 3.6 + t.level * 0.3 : t.type === "frost" ? 2.2 : 1.3;
        const from = [t.x + Math.cos(t.aim) * 0.6, t.y + Math.sin(t.aim) * 0.6, tz];
        t.flash = 1;
        if (t.type === "archer") this.projectiles.push({ kind: "arrow", x: from[0], y: from[1], z: from[2], target, speed: 30, dmg: L.dmg, tower: t, tx: target.x, ty: target.y, tz: target.z + 0.6 });
        else if (t.type === "frost") this.projectiles.push({ kind: "frost", x: from[0], y: from[1], z: from[2], target, speed: 18, dmg: L.dmg, tower: t, tx: target.x, ty: target.y, tz: target.z + 0.6 });
        else if (t.type === "cannon") {
            // lead the target a little, then fly a ballistic arc
            const flight = 0.65, lead = routePoint(target.route, target.d + target.def.speed * CELL * flight * (target.slowT > 0 ? 1 - target.slowK : 1));
            this.projectiles.push({ kind: "shell", x0: from[0], y0: from[1], z0: from[2], x1: lead.x, y1: lead.y, t: 0, flight, dmg: L.dmg, splash: L.splash, tower: t, x: from[0], y: from[1], z: from[2] });
        } else if (t.type === "storm") {
            const hit = [target], pts = [[t.x, t.y, tz]];
            let cur = target;
            while (hit.length < L.chain) {
                let best = null, bd = 2.3 * CELL;
                for (const e of this.enemies) if (e.alive && !hit.includes(e)) { const d = Math.hypot(e.x - cur.x, e.y - cur.y); if (d < bd) { bd = d; best = e; } }
                if (!best) break;
                hit.push(best); cur = best;
            }
            for (const e of hit) pts.push([e.x, e.y, e.z + e.def.size * 0.9]);
            this.emit({ type: "lightning", pts, tower: t });
            hit.forEach((e, k) => this.damage(e, L.dmg * Math.pow(0.85, k), t));
        }
        this.emit({ type: "shoot", tower: t });
    }

    // ------------------------------------------------------------------ step
    update(dt) {
        if (this.phase === "won" || this.phase === "lost") return;
        this.time += dt;
        if (this.phase === "build") {
            this.timer -= dt;
            if (this.timer <= 0) this.startWave();
        } else {
            this.waveTime += dt;
            while (this.queue.length && this.queue[0].at <= this.waveTime) {
                const q = this.queue.shift();
                this.spawn(q.type, Math.min(q.spawn, this.map.routes.length - 1));
            }
        }
        // enemies walk
        for (const e of this.enemies) {
            if (!e.alive) continue;
            e.slowT = Math.max(0, e.slowT - dt); if (e.slowT === 0) e.slowK = 0;
            e.hitT = Math.max(0, e.hitT - dt);
            e.d += e.def.speed * CELL * (1 - e.slowK) * dt;
            this.place(e);
            if (e.d >= e.route.total) {
                e.alive = false;
                this.lives = Math.max(0, this.lives - e.def.leak); this.stats.leaked += e.def.leak;
                this.emit({ type: "leak", enemy: e, lives: e.def.leak });
            }
        }
        this.enemies = this.enemies.filter((e) => e.alive);
        // towers aim and shoot
        for (const t of this.towers) {
            const L = t.def.levels[t.level];
            t.cd -= dt; t.flash = Math.max(0, t.flash - dt * 4);
            const target = this.pick(t, this.inRange(t, L.range));
            if (target) {
                const want = Math.atan2(target.y - t.y, target.x - t.x);
                const d = Math.atan2(Math.sin(want - t.aim), Math.cos(want - t.aim));
                t.aim += d * Math.min(1, dt * 12);
                if (t.cd <= 0) { this.fire(t, target); t.cd = L.rate; }
            }
        }
        // projectiles
        for (const p of this.projectiles) {
            if (p.kind === "shell") {
                p.t += dt / p.flight;
                const u = Math.min(1, p.t);
                p.x = p.x0 + (p.x1 - p.x0) * u; p.y = p.y0 + (p.y1 - p.y0) * u; p.z = p.z0 * (1 - u) + Math.sin(u * Math.PI) * 3.2;
                if (p.t >= 1) {
                    p.done = true;
                    const r = p.splash * CELL;
                    for (const e of this.enemies) if (e.alive && !e.air) { const d = Math.hypot(e.x - p.x1, e.y - p.y1); if (d <= r) this.damage(e, p.dmg * (1 - 0.4 * (d / r)), p.tower); }
                    this.emit({ type: "explode", x: p.x1, y: p.y1, r });
                }
                continue;
            }
            if (p.target.alive) { p.tx = p.target.x; p.ty = p.target.y; p.tz = p.target.z + p.target.def.size * 0.9; }
            const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, d = Math.hypot(dx, dy, dz), step = p.speed * dt;
            p.dir = [dx / (d || 1), dy / (d || 1), dz / (d || 1)];
            if (d <= step) {
                p.done = true;
                if (p.target.alive) {
                    if (p.kind === "frost") {
                        const L = p.tower.def.levels[p.tower.level], r = L.slowR * CELL;
                        for (const e of this.enemies) if (e.alive && Math.hypot(e.x - p.tx, e.y - p.ty) <= r) { e.slowK = Math.max(e.slowK, L.slow); e.slowT = Math.max(e.slowT, L.slowT); }
                        this.emit({ type: "frost", x: p.tx, y: p.ty, r });
                    }
                    this.damage(p.target, p.dmg, p.tower);
                    this.emit({ type: "hit", x: p.tx, y: p.ty, z: p.tz, kind: p.kind });
                }
            } else { p.x += dx / d * step; p.y += dy / d * step; p.z += dz / d * step; }
        }
        this.projectiles = this.projectiles.filter((p) => !p.done);
        // wave cleared / game over
        if (this.lives <= 0 && this.phase !== "lost") { this.phase = "lost"; this.emit({ type: "lost" }); return; }
        if (this.phase === "wave" && !this.queue.length && !this.enemies.length) {
            const bonus = 10 + 2 * this.wave;
            this.gold += bonus; this.stats.goldEarned += bonus;
            if (this.wave >= this.waves.length) { this.phase = "won"; this.emit({ type: "won" }); return; }
            this.phase = "build"; this.timer = this.diff.timer;
            this.emit({ type: "cleared", wave: this.wave, bonus });
        }
    }
}
