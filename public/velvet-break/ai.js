// CPU opponent: ghost-ball aiming over every (target ball × pocket), rejecting blocked lines and steep cuts,
// scoring what's left by cut angle and distance, then adding aim/power error for the difficulty.

import { POCKETS, R, L, W } from "./physics.js";

export const LEVELS = {
    easy: { noise: 3.2, power: 0.18, think: 1.1, name: "Easy" },
    normal: { noise: 1.3, power: 0.1, think: 0.9, name: "Normal" },
    hard: { noise: 0.45, power: 0.05, think: 0.7, name: "Hard" },
};

function clearPath(table, x0, y0, x1, y1, ignore) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    for (const b of table.balls) {
        if (b.potted || ignore.includes(b.n)) continue;
        let t = ((b.x - x0) * dx + (b.y - y0) * dy) / l2;
        if (t < 0 || t > 1) continue;
        const px = x0 + dx * t, py = y0 + dy * t;
        if (Math.hypot(b.x - px, b.y - py) < 2 * R * 0.98) return false;
    }
    return true;
}

// best shot for cue position (cx, cy) against the legal targets
export function planShot(table, targets, cx = table.cue.x, cy = table.cue.y) {
    let best = null;
    for (const n of targets) {
        const b = table.balls.find((x) => x.n === n);
        if (!b || b.potted) continue;
        for (const p of POCKETS) {
            // aim a little inside the pocket so the ball drops cleanly
            const tx = p.x * 0.985, ty = p.y * 0.97;
            const bx = tx - b.x, by = ty - b.y, bd = Math.hypot(bx, by);
            const ux = bx / bd, uy = by / bd;
            const gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R;              // ghost ball
            const cxv = gx - cx, cyv = gy - cy, cd = Math.hypot(cxv, cyv);
            if (cd < 0.01) continue;
            const cut = Math.acos(Math.max(-1, Math.min(1, (cxv * ux + cyv * uy) / cd)));
            if (cut > (72 * Math.PI) / 180) continue;
            if (!clearPath(table, cx, cy, gx, gy, [0, n])) continue;
            if (!clearPath(table, b.x, b.y, tx, ty, [0, n])) continue;
            const score = Math.cos(cut) * 3 - cd * 0.05 - bd * 0.08 - (Math.abs(p.x) < 1 ? cut * 0.8 : 0);
            if (!best || score > best.score) {
                const need = Math.min(1, 0.22 + (cd + bd * 1.6) / 52 + cut * 0.12);
                best = { angle: Math.atan2(cyv, cxv), power: need, score, target: n, pocket: p, cut };
            }
        }
    }
    return best;
}

export function cpuShot(table, targets, level) {
    let plan = planShot(table, targets);
    if (!plan) {
        // safety: roll softly into the nearest legal ball
        let near = null, nd = 1e9;
        for (const n of targets) { const b = table.balls.find((x) => x.n === n); if (!b || b.potted) continue; const d = Math.hypot(b.x - table.cue.x, b.y - table.cue.y); if (d < nd) { nd = d; near = b; } }
        if (!near) return { angle: Math.random() * 6.28, power: 0.4, spin: { x: 0, y: 0 } };
        plan = { angle: Math.atan2(near.y - table.cue.y, near.x - table.cue.x), power: 0.3 + nd / 60 };
    }
    const L0 = LEVELS[level] || LEVELS.normal;
    const noise = ((Math.random() + Math.random() + Math.random() - 1.5) / 1.5) * L0.noise * Math.PI / 180;
    return {
        angle: plan.angle + noise,
        power: Math.max(0.12, Math.min(1, plan.power * (1 + (Math.random() - 0.5) * 2 * L0.power))),
        spin: { x: 0, y: plan.cut != null && plan.cut < 0.25 ? -0.25 : 0.1 },
    };
}

// ball in hand: try spots and keep the one with the best shot
export function placeCue(table, targets) {
    let best = null;
    for (let i = 0; i < 70; i++) {
        const x = (Math.random() - 0.5) * (L - 2), y = (Math.random() - 0.5) * (W - 2);
        if (!table.free(x, y)) continue;
        const p = planShot(table, targets, x, y);
        const s = p ? p.score : -9;
        if (!best || s > best.s) best = { x, y, s };
    }
    return best;
}
