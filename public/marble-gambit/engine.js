// The engine: negamax alpha-beta with iterative deepening, quiescence search on captures, MVV-LVA ordering
// with the previous iteration's best move first, and a material + piece-square evaluation (king table blends
// from middlegame to endgame as material comes off). Pure — runs in worker.js or on the main thread.

import { Chess, P, N, B, R, Q, K } from "./chess.js";

const VAL = [0, 100, 320, 330, 500, 900, 0];
const PST = {
    [P]: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [N]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [B]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [R]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [Q]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K_MID: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    K_END: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};
const MATE = 100000;

export function evaluate(c) {
    const b = c.b;
    let score = 0, nonPawn = 0;
    for (let s = 0; s < 64; s++) { const p = b[s]; if (p && Math.abs(p) !== K && Math.abs(p) !== P) nonPawn += VAL[Math.abs(p)]; }
    const endW = Math.max(0, Math.min(1, 1 - (nonPawn - 1400) / 3800));
    for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p) continue;
        const t = Math.abs(p), side = Math.sign(p), idx = side > 0 ? s : s ^ 56;
        let v = VAL[t];
        if (t === K) v += PST.K_MID[idx] * (1 - endW) + PST.K_END[idx] * endW;
        else v += PST[t][idx];
        score += v * side;
    }
    return score * c.turn;
}

export const LEVELS = [
    { name: "Novice", depth: 1, time: 300, random: 0.35, margin: 150 },
    { name: "Casual", depth: 2, time: 500, random: 0.15, margin: 60 },
    { name: "Club", depth: 3, time: 900, random: 0, margin: 0 },
    { name: "Expert", depth: 4, time: 1200, random: 0, margin: 0 },
    { name: "Master", depth: 6, time: 2500, random: 0, margin: 0 },
];

export function search(fen, opts) {
    const c = new Chess(fen);
    const deadline = Date.now() + opts.time;
    let nodes = 0, stop = false, rootBest = null;
    const order = (moves, first) => moves
        .map((m) => ({ m, k: (first && m.from === first.from && m.to === first.to && m.promo === first.promo ? 1e6 : 0) + (m.captured ? 10 * VAL[Math.abs(m.captured)] - VAL[Math.abs(m.piece)] + 1000 : 0) + (m.promo ? 800 : 0) }))
        .sort((a, b) => b.k - a.k).map((x) => x.m);
    function quiesce(alpha, beta, ply) {
        if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true;
        const stand = evaluate(c);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (ply > 12) return alpha;
        for (const m of order(c.pseudo(true))) {
            if (stand + VAL[Math.abs(m.captured)] + 200 < alpha && !m.promo) continue;
            c.make(m);
            if (c.inCheck(-c.turn)) { c.undo(); continue; }
            const v = -quiesce(-beta, -alpha, ply + 1);
            c.undo();
            if (stop) return alpha;
            if (v >= beta) return beta;
            if (v > alpha) alpha = v;
        }
        return alpha;
    }
    function negamax(d, alpha, beta, ply) {
        if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true;
        if (ply > 0 && c.keys.slice(0, -1).includes(c.keys[c.keys.length - 1])) return 0;
        if (d <= 0) return quiesce(alpha, beta, ply);
        let legal = 0, best = -Infinity;
        for (const m of order(c.pseudo(), null)) {
            c.make(m);
            if (c.inCheck(-c.turn)) { c.undo(); continue; }
            legal++;
            const v = -negamax(d - 1 + (c.inCheck() ? 1 : 0) * (ply < 6 ? 1 : 0), -beta, -alpha, ply + 1);
            c.undo();
            if (stop) return best === -Infinity ? 0 : best;
            if (v > best) best = v;
            if (v > alpha) alpha = v;
            if (alpha >= beta) break;
        }
        if (!legal) return c.inCheck() ? -MATE + ply : 0;
        return best;
    }
    let scored = [], depthDone = 0;
    for (let d = 1; d <= opts.depth && !stop; d++) {
        const list = [];
        let alpha = -Infinity;
        for (const m of order(c.moves(), rootBest)) {
            c.make(m);
            const v = -negamax(d - 1, -Infinity, opts.random ? Infinity : -alpha, 1);
            c.undo();
            if (stop && d > 1) break;
            list.push({ m, v });
            if (v > alpha) alpha = v;
        }
        if (stop && d > 1) break;
        list.sort((a, b) => b.v - a.v);
        scored = list; rootBest = list[0]?.m; depthDone = d;
        if (Math.abs(list[0]?.v) > MATE - 100) break;
    }
    if (!scored.length) return null;
    let pick = scored[0];
    if (opts.random && Math.random() < opts.random) {
        const ok = scored.filter((x) => x.v >= scored[0].v - opts.margin);
        pick = ok[Math.floor(Math.random() * ok.length)];
    }
    return { from: pick.m.from, to: pick.m.to, promo: pick.m.promo, score: pick.v, depth: depthDone, nodes };
}
