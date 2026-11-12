// Spire rules: the pure maths of dropping a slab onto the tower. No DOM, no GL, so it can be tested in node.
export const H = 0.8;          // slab height
export const BASE = 8;         // width of the first slab, and the most any slab can regrow to
export const TOL = 0.32;       // how close counts as a perfect drop
export const GROW = 0.4;       // how much a slab regrows on a long perfect streak
export const GROW_FROM = 4;    // streak length at which regrowth starts
export const MIN_OVERLAP = 0.08;

// prev: the slab underneath {cx, cy, sx, sy}
// cur:  the sliding block {axis: 0 = x, 1 = y, off: distance from prev's centre along that axis, sx, sy}
// streak: perfect drops in a row before this one
// returns {kind: 'miss'} | {kind: 'perfect' | 'cut', slab, piece, side, grew}
export function resolveDrop(prev, cur, streak) {
    const ax = cur.axis;
    const pc = ax === 0 ? prev.cx : prev.cy;
    const ps = ax === 0 ? prev.sx : prev.sy;
    const cs = ax === 0 ? cur.sx : cur.sy;
    const off = cur.off;
    const c = pc + off;
    const mk = (center, size) => (ax === 0
        ? { cx: center, cy: prev.cy, sx: size, sy: cur.sy }
        : { cx: prev.cx, cy: center, sx: cur.sx, sy: size });

    if (Math.abs(off) <= TOL) {
        const grown = streak + 1 >= GROW_FROM ? Math.min(BASE, cs + GROW) : cs;
        return { kind: 'perfect', slab: mk(pc, grown), piece: null, side: 0, grew: grown > cs + 1e-9 };
    }
    const lo = Math.max(c - cs / 2, pc - ps / 2);
    const hi = Math.min(c + cs / 2, pc + ps / 2);
    const ov = hi - lo;
    if (ov < MIN_OVERLAP) return { kind: 'miss' };
    const side = off > 0 ? 1 : -1;
    const pLo = side > 0 ? hi : c - cs / 2;
    const pHi = side > 0 ? c + cs / 2 : lo;
    return { kind: 'cut', slab: mk((lo + hi) / 2, ov), piece: mk((pLo + pHi) / 2, pHi - pLo), side, grew: false };
}
