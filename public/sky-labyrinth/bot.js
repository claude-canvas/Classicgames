// Sky Labyrinth autopilot, used only with ?bot (debugging / attract mode). Same planner as the Node validator
// described in DESIGN.md section 6: a fine-grid Dijkstra through every crystal (and the switch) to the well, then a
// velocity controller that turns the path into board tilt.

import { Sim, R, HOLE_R, BUMP_R, MAX_TILT, G } from "./physics.js";

const STEP = 0.125;
function plan(L, opts = {}) {
    const sim = new Sim(L);
    const gw = Math.round(L.W / STEP), gh = Math.round(L.H / STEP);
    const x0 = -L.W / 2 + STEP / 2, y0 = -L.H / 2 + STEP / 2;
    const P = (i, j) => [x0 + i * STEP, y0 + j * STEP];
    function freeGrid(gatesOpen, broken, blockGoal) {
        sim.gatesOpen = gatesOpen;
        const ok = new Uint8Array(gw * gh), cost = new Float32Array(gw * gh);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            const [x, y] = P(i, j), [c, r] = sim.cellOf(x, y);
            if (!sim.floor(c, r) || sim.solid(c, r) || broken.has(r * L.W + c)) continue;
            let bad = false, near = 9;
            for (let dr = -1; dr <= 1 && !bad; dr++) for (let dc = -1; dc <= 1; dc++) {
                const cc = c + dc, rr = r + dr;
                const [wx, wy] = L.xy(cc, rr);
                const dx = Math.max(Math.abs(x - wx) - 0.5, 0), dy = Math.max(Math.abs(y - wy) - 0.5, 0), d = Math.hypot(dx, dy);
                if (sim.solid(cc, rr) && d < R + 0.03) { bad = true; break; }
                if ((!sim.floor(cc, rr) || broken.has(rr * L.W + cc)) && d < 0.12) { bad = true; break; }
                if (!sim.floor(cc, rr) || broken.has(rr * L.W + cc)) near = Math.min(near, d);
            }
            for (const o of L.holes) { const d = Math.hypot(o.x - x, o.y - y); if (d < HOLE_R + 0.1) bad = true; near = Math.min(near, d - HOLE_R); }
            for (const o of L.bumpers) if (Math.hypot(o.x - x, o.y - y) < R + BUMP_R + 0.08) bad = true;
            if (blockGoal && Math.hypot(L.goal.x - x, L.goal.y - y) < 0.62) bad = true;
            if (bad) continue;
            ok[j * gw + i] = 1; cost[j * gw + i] = 1 + (near < 0.35 ? (0.35 - near) * 6 : 0);
        }
                return { ok, cost };
    }
    const idx = (x, y) => { const i = Math.round((x - x0) / STEP), j = Math.round((y - y0) / STEP); return j * gw + i; };
    function dijkstra(grid, from, to) {
        const dist = new Float64Array(gw * gh).fill(1e9), prev = new Int32Array(gw * gh).fill(-1);
        const s = idx(from.x, from.y), t = idx(to.x, to.y);
        // the target may sit inside a "bad" area (goal next to a hole etc) – allow the 3x3 around it
        const okT = (k) => grid.ok[k] || Math.abs((k % gw) - (t % gw)) <= 2 && Math.abs(Math.floor(k / gw) - Math.floor(t / gw)) <= 2;
        const okS = (k) => Math.abs((k % gw) - (s % gw)) <= 2 && Math.abs(Math.floor(k / gw) - Math.floor(s / gw)) <= 2;
        dist[s] = 0;
        const heap = [[0, s]];
        const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
        while (heap.length) {
            const [d, k] = pop();
            if (d > dist[k]) continue;
            if (k === t) break;
            const i = k % gw, j = (k / gw) | 0;
            for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
                const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
                const nk = nj * gw + ni;
                if (!(grid.ok[nk] || okT(nk) || okS(nk))) continue;
                { const [qx, qy] = P(ni, nj), [qc, qr] = sim.cellOf(qx, qy), bc = L.cells[qr] && L.cells[qr][qc], B = { ">": [1, 0], "<": [-1, 0], "^": [0, 1], "v": [0, -1] }[bc]; if (B && di * B[0] + dj * B[1] < 0) continue; }
                const nd = d + w * STEP * (grid.cost[nk] || 3);
                if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nd, nk); }
            }
        }
        if (dist[t] >= 1e9) return null;
        const path = []; for (let k = t; k >= 0; k = prev[k]) path.push(P(k % gw, (k / gw) | 0));
        return { len: dist[t], path: path.reverse() };
    }
    // try every order of gems (+ the switch if there is one)
    const stops = [...L.gems.map((g) => ({ ...g, kind: "gem" })), ...L.switches.slice(0, 1).map((s) => ({ ...s, kind: "switch" }))];
    const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
    let best = null;
    for (const order of perms(stops)) {
        let gates = false, cur = L.start, total = 0, legs = [], broken = new Set(), fail = false;
        const gridCache = new Map();
        for (const tgt of [...order, { ...L.goal, kind: "goal" }]) {
            const fin = tgt.kind === "goal", key = gates + "|" + fin + "|" + [...broken].join(",");
            if (!gridCache.has(key)) gridCache.set(key, freeGrid(gates, broken, !fin));
            const r = dijkstra(gridCache.get(key), cur, tgt);
            if (!r) { fail = true; break; }
            total += r.len; legs.push(r.path); cur = tgt;
            if (tgt.kind === "switch") gates = true;
            for (const [x, y] of r.path) { const [c, rr] = sim.cellOf(x, y); if (L.cells[rr][c] === "x") broken.add(rr * L.W + c); }
            if (best && total > best.total) { fail = true; break; }
        }
        if (!fail && (!best || total < best.total)) best = { total, legs, order: order.map((o) => o.kind) };
    }
    return best;
}


export class Bot {
    constructor(L) { this.L = L; this.best = plan(L); this.leg = 0; this.idx = 0; }
    control(sim) {
        const best = this.best, b = sim.ball;
        if (!best || sim.state !== "roll") return [0, 0];
        let path = best.legs[this.leg];
        let bi = this.idx, bd = 1e9;
        for (let i = this.idx; i < Math.min(path.length, this.idx + 10); i++) { const d = Math.hypot(path[i][0] - b.x, path[i][1] - b.y); if (d < bd) { bd = d; bi = i; } }
        this.idx = bi;
        let end = path[path.length - 1];
        if (this.leg < best.legs.length - 1 && Math.hypot(end[0] - b.x, end[1] - b.y) < 0.22) { this.leg++; path = best.legs[this.leg]; this.idx = 0; end = path[path.length - 1]; }
        const [px, py] = path[Math.min(path.length - 1, this.idx + 4)];
        const dx = px - b.x, dy = py - b.y, dl = Math.hypot(dx, dy) || 1;
        let near = 9; for (const o of this.L.holes) near = Math.min(near, Math.hypot(o.x - b.x, o.y - b.y) - HOLE_R);
        const ahead = path[Math.min(path.length - 1, this.idx + 10)], turn = Math.hypot(ahead[0] - px, ahead[1] - py) < 0.55 ? 0.6 : 1;
        const v = Math.min(2.4 * turn, near < 0.6 ? 1.3 : 2.4, Math.hypot(end[0] - b.x, end[1] - b.y) * 2.5 + 0.5, dl * 3 + 0.4);
        const axd = ((dx / dl) * v - b.vx) * 4, ayd = ((dy / dl) * v - b.vy) * 4;
        const cl = (a) => Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.asin(Math.max(-1, Math.min(1, a / G)))));
        return [cl(axd) / MAX_TILT, cl(ayd) / MAX_TILT];
    }
    respawned(sim) {
        let bl = this.leg, bi = 0, bd = 1e9;
        for (let l = this.leg; l >= 0; l--) this.best.legs[l].forEach((q, i) => { const d = Math.hypot(q[0] - sim.ball.x, q[1] - sim.ball.y); if (d < bd - 1e-3) { bd = d; bl = l; bi = i; } });
        this.leg = bl; this.idx = bi;
    }
}
