// Saratoga GP — collision from the track model's own triangles (DESIGN.md §4).
// ground: up-facing triangles in 2 m buckets, queried by exact barycentric height (the highest surface at or below
//         z + 0.6, so the bridge crossover and the road under it both work); each triangle remembers its surface
//         (0 asphalt / kerb, 1 grass, 2 gravel) for drag
// walls:  steep triangles in 0.5 m cells; each cell keeps separate height intervals measured from the part of each
//         triangle inside it (a kerb and an overhang never merge into one solid wall)

export const ASPHALT = 0, GRASS = 1, GRAVEL = 2;

// lists: [{ pos: Float32Array (x, y, z per vertex, 3 per triangle), ground: bool, twoSided: bool, walls: bool, surf: 0|1|2 }]
// near(x, y) (optional): only triangles whose centre passes this test are kept (e.g. within reach of the track)
export function buildCollision(lists, near = null) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const L of lists) for (let i = 0; i < L.pos.length; i += 3) { const x = L.pos[i], y = L.pos[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const RG = 2, RS = 0.5, GW = Math.ceil((x1 - x0) / RG) + 1, SW = Math.ceil((x1 - x0) / RS) + 1;
  // ground triangles packed as [ax, ay, az, bx, by, bz, cx, cy, cz] + surface
  let nG = 0; for (const L of lists) if (L.ground) nG += L.pos.length / 9;
  const T = new Float32Array(nG * 9), surf = new Uint8Array(nG), owner = new Uint16Array(nG), bucket = new Map(), steep = new Map();
  let t = 0;
  const addBand = (k, lo, hi) => {
    let B = steep.get(k); if (!B) steep.set(k, (B = []));
    for (let i = 0; i < B.length; i++) { const e = B[i]; if (lo <= e[1] + 0.05 && hi >= e[0] - 0.05) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); B.splice(i, 1); i = -1; } }
    B.push([lo, hi]);
  };
  lists.forEach((L, li) => {
    const P = L.pos;
    for (let i = 0; i + 9 <= P.length; i += 9) {
      const ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[i + 3], by = P[i + 4], bz = P[i + 5], cx = P[i + 6], cy = P[i + 7], cz = P[i + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
      if (near && !near((ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
      const k = nz / l, mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx), mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
      if (L.ground && (L.twoSided ? Math.abs(k) : k) > 0.55) {
        // up-facing triangles; the track surfaces (twoSided) may be wound either way, so for them either facing counts
        // (structures stay up-facing only, so a bridge's underside is never a floor)
        T.set([ax, ay, az, bx, by, bz, cx, cy, cz], t * 9); surf[t] = L.surf || 0; owner[t] = li;
        for (let j = Math.floor((mny - y0) / RG); j <= Math.floor((mxy - y0) / RG); j++) for (let q = Math.floor((mnx - x0) / RG); q <= Math.floor((mxx - x0) / RG); q++) { const key = j * GW + q; let a = bucket.get(key); if (!a) bucket.set(key, (a = [])); a.push(t); }
        t++;
      } else if (L.walls && Math.abs(k) <= 0.55) {
        const zlo = Math.min(az, bz, cz), zhi = Math.max(az, bz, cz);
        const steps = Math.min(400, Math.max(2, Math.ceil(Math.max(mxx - mnx, mxy - mny, zhi - zlo) / (RS * 0.5))));
        const span = new Map();
        for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps - a; b++) {
          const s = a / steps, r = b / steps, x = ax + ux * s + vx * r, y = ay + uy * s + vy * r, z = az + uz * s + vz * r, key = Math.floor((y - y0) / RS) * SW + Math.floor((x - x0) / RS);
          const e = span.get(key); if (!e) span.set(key, [z, z]); else { if (z < e[0]) e[0] = z; if (z > e[1]) e[1] = z; }
        }
        const pad = (zhi - zlo) / steps * 0.5 + 0.02;
        for (const [key, [lo, hi]] of span) addBand(key, lo - pad, hi + pad);
      }
    }
  });
  const heightOn = (i, x, y) => {
    const o = i * 9, ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-12) return null;
    const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w3 = 1 - w1 - w2;
    if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) return null;
    return w1 * T[o + 2] + w2 * T[o + 5] + w3 * T[o + 8];
  };
  const C = {
    x0, y0, x1, y1,
    surf: 0,     // the surface of the last ground() hit
    // highest ground at or below z + 0.6, or null
    ground(x, y, z) {
      const a = bucket.get(Math.floor((y - y0) / RG) * GW + Math.floor((x - x0) / RG)); if (!a) return null;
      let best = null, bs = 0;
      for (const i of a) { const h = heightOn(i, x, y); if (h !== null && h <= z + 0.6 && (best === null || h > best)) { best = h; bs = surf[i]; } }
      C.surf = bs; return best;
    },
    // a wall interval overlapping [lo, hi] at (x, y)
    wall(x, y, lo, hi) { const B = steep.get(Math.floor((y - y0) / RS) * SW + Math.floor((x - x0) / RS)); if (B) for (const e of B) if (e[1] > lo && e[0] < hi) return true; return false; },
    // debug: every ground surface at (x, y) as [height, surface, list index]
    probe(x, y) { const a = bucket.get(Math.floor((y - y0) / RG) * GW + Math.floor((x - x0) / RG)) || []; return a.map((i) => [heightOn(i, x, y), surf[i], owner[i]]).filter((q) => q[0] !== null).map((q) => [+q[0].toFixed(2), q[1], q[2]]); },
    cell(x, y) { return steep.get(Math.floor((y - y0) / RS) * SW + Math.floor((x - x0) / RS)) || null; },
    stats: { ground: t, wallCells: steep.size },
  };
  return C;
}
