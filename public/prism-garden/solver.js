// Prism Garden solver (DESIGN.md §2): fewest moves from a board state to a solved one. A move is turning a
// mirror/splitter once, turning an emitter a quarter (so up to 3 moves), or placing an inventory piece.
// Small boards only: searches piece changes by increasing count, then inventory placements.
import { makeBoard, trace, solved, mutable, key } from "./logic.js";

export function solve(level, state = null, maxMoves = 9) {
  const board = makeBoard(level);
  if (state) for (const s of state) { const p = board.at.get(key(s.x, s.y)); if (p) { if (s.r !== undefined) p.r = s.r; if (s.d !== undefined) p.d = s.d; } }
  const muts = [...board.at.values()].filter(mutable);
  const inv = level.inv || {};
  const nInv = (inv.mirror || 0) + (inv.split || 0);
  const free = [];
  for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) { const k = key(x, y); if (!board.at.has(k) && !board.voids.has(k)) free.push([x, y]); }
  const placements = [];
  // every way to place the inventory (pieces of each kind are interchangeable)
  const kinds = []; for (let i = 0; i < (inv.mirror || 0); i++) kinds.push("mirror"); for (let i = 0; i < (inv.split || 0); i++) kinds.push("split");
  (function rec(i, start, acc) {
    if (i === kinds.length) { placements.push(acc.slice()); return; }
    const s0 = i > 0 && kinds[i] === kinds[i - 1] ? start : 0;
    for (let f = s0; f < free.length; f++) for (const r of [0, 1]) { if (acc.some((a) => a.x === free[f][0] && a.y === free[f][1])) continue; acc.push({ t: kinds[i], x: free[f][0], y: free[f][1], r }); rec(i + 1, f + 1, acc); acc.pop(); }
  })(0, 0, []);
  if (!placements.length) placements.push([]);
  // try change-sets of increasing size
  const cost = (p, to) => (p.t === "emit" ? (to - p.d + 4) % 4 : to !== p.r ? 1 : 0);
  const states = (p) => (p.t === "emit" ? [0, 1, 2, 3] : [0, 1]);
  let best = null;
  for (const pl of placements) {
    for (const q of pl) board.at.set(key(q.x, q.y), q);
    // iterate all combinations of mutable states (small), keep the cheapest that solves
    const orig = muts.map((p) => (p.t === "emit" ? p.d : p.r));
    const n = muts.length, idx = new Array(n).fill(0), opts = muts.map(states);
    let total = 1; for (const o of opts) total *= o.length;
    if (total > 70000) { for (const q of pl) board.at.delete(key(q.x, q.y)); continue; }
    for (let it = 0; it < total; it++) {
      let c = pl.length, k = it;
      for (let i = 0; i < n; i++) { const v = opts[i][k % opts[i].length]; k = Math.floor(k / opts[i].length); idx[i] = v; c += cost({ t: muts[i].t, d: orig[i], r: orig[i] }, v); }
      if (c > maxMoves || (best && c >= best.moves)) continue;
      muts.forEach((p, i) => { if (p.t === "emit") p.d = idx[i]; else p.r = idx[i]; });
      if (solved(board)) best = { moves: c, set: muts.map((p, i) => ({ x: p.x, y: p.y, [p.t === "emit" ? "d" : "r"]: idx[i] })), place: pl.map((q) => ({ ...q })) };
    }
    muts.forEach((p, i) => { if (p.t === "emit") p.d = orig[i]; else p.r = orig[i]; });
    for (const q of pl) board.at.delete(key(q.x, q.y));
  }
  return best;
}
export { trace, solved };
