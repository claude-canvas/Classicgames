// Prism Garden rules (DESIGN.md §1): pure beam tracing on a grid, shared by the game, the solver and the level
// generator. Directions 0 = N (+y), 1 = E (+x), 2 = S, 3 = W. Colours are RGB bit masks.

export const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0];
export const COL = { R: 1, G: 2, B: 4, Y: 3, M: 5, C: 6, W: 7 };
export const COL_RGB = { 1: [1, 0.2, 0.15], 2: [0.2, 1, 0.3], 4: [0.25, 0.45, 1], 3: [1, 0.85, 0.15], 5: [1, 0.2, 0.9], 6: [0.15, 0.95, 1], 7: [1, 1, 1] };
export const COL_NAME = { 1: "red", 2: "green", 4: "blue", 3: "yellow", 5: "magenta", 6: "cyan", 7: "white" };
// mirror reflection tables: r = 0 "/" , r = 1 "\"
export const MIR = [[1, 0, 3, 2], [3, 2, 1, 0]];

export const key = (x, y) => x + "," + y;
// board: { w, h, voids: Set<key>, at: Map<key, piece> }
export function makeBoard(level) {
  const at = new Map();
  for (const p of level.pieces) at.set(key(p.x, p.y), { ...p });
  return { w: level.w, h: level.h, voids: new Set((level.voids || []).map(([x, y]) => key(x, y))), at };
}

// trace every emitter. Returns segments [{ax, ay, bx, by, c}] in cell coordinates (cell centres on integers),
// the colour mask received by each target (Map key → mask) and the bounce points.
export function trace(board) {
  const segs = [], recv = new Map(), flares = [], seen = new Set();
  const queue = [];
  for (const p of board.at.values()) if (p.t === "emit") queue.push({ x: p.x, y: p.y, d: p.d, c: COL[p.c] ?? p.c });
  for (const p of board.at.values()) if (p.t === "target") recv.set(key(p.x, p.y), 0);
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    const b = queue.shift();
    const sk = b.x + "," + b.y + "," + b.d + "," + b.c; if (seen.has(sk)) continue; seen.add(sk);
    let x = b.x, y = b.y; const sx = x, sy = y;
    for (;;) {
      const nx = x + DX[b.d], ny = y + DY[b.d];
      if (nx < -1 || ny < -1 || nx > board.w || ny > board.h) { segs.push({ ax: sx, ay: sy, bx: x + DX[b.d] * 0.5, by: y + DY[b.d] * 0.5, c: b.c }); break; }
      const p = board.at.get(key(nx, ny));
      if (!p) { x = nx; y = ny; continue; }
      if (p.t === "rock" || p.t === "emit") { segs.push({ ax: sx, ay: sy, bx: nx - DX[b.d] * 0.45, by: ny - DY[b.d] * 0.45, c: b.c }); flares.push({ x: nx - DX[b.d] * 0.45, y: ny - DY[b.d] * 0.45, c: b.c, kind: "block" }); break; }
      segs.push({ ax: sx, ay: sy, bx: nx, by: ny, c: b.c });
      if (p.t === "target") { recv.set(key(nx, ny), recv.get(key(nx, ny)) | b.c); break; }
      if (p.t === "mirror") { queue.push({ x: nx, y: ny, d: MIR[p.r][b.d], c: b.c }); flares.push({ x: nx, y: ny, c: b.c, kind: "mirror" }); break; }
      if (p.t === "split") { queue.push({ x: nx, y: ny, d: b.d, c: b.c }, { x: nx, y: ny, d: MIR[p.r][b.d], c: b.c }); flares.push({ x: nx, y: ny, c: b.c, kind: "split" }); break; }
      if (p.t === "prism") {
        if (b.c & 2) queue.push({ x: nx, y: ny, d: b.d, c: 2 });
        if (b.c & 1) queue.push({ x: nx, y: ny, d: (b.d + 3) % 4, c: 1 });
        if (b.c & 4) queue.push({ x: nx, y: ny, d: (b.d + 1) % 4, c: 4 });
        flares.push({ x: nx, y: ny, c: b.c, kind: "prism" }); break;
      }
      if (p.t === "filter") { const c2 = b.c & (COL[p.c] ?? p.c); if (c2) queue.push({ x: nx, y: ny, d: b.d, c: c2 }); flares.push({ x: nx, y: ny, c: b.c, kind: "filter" }); break; }
      break;
    }
  }
  return { segs, recv, flares };
}
export function solved(board, tr = trace(board)) {
  let n = 0;
  for (const p of board.at.values()) if (p.t === "target") { n++; if (tr.recv.get(key(p.x, p.y)) !== (COL[p.c] ?? p.c)) return false; }
  return n > 0;
}
export function targetState(board, tr) {
  const out = [];
  for (const p of board.at.values()) if (p.t === "target") { const got = tr.recv.get(key(p.x, p.y)) || 0, want = COL[p.c] ?? p.c; out.push({ p, got, ok: got === want, wrong: got !== 0 && got !== want }); }
  return out;
}
// can the player change this piece?
export const mutable = (p) => (p.t === "mirror" || p.t === "split") ? !p.fixed : p.t === "emit" ? !!p.rot : false;
export function rotate(p) { if (p.t === "emit") p.d = (p.d + 1) % 4; else p.r = 1 - p.r; }
