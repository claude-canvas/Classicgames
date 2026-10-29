// Last Light — the forest's ground, walls and cover, at mouse scale (DESIGN.md §4).
// ground: up-facing triangles (terrain, rock tops, log tops) in 1 m buckets, queried by exact barycentric height —
//         the highest surface at or below z + step
// walls:  steep faces (rocks, logs, trunks near the ground) in 0.1 m cells, each keeping separate height intervals
// cover:  grass blade density on a 0.5 m grid; dense cells are long grass, where the owl can't see Wick
// Only the clearing (|x|, |y| < LIMIT) is built.

const LIMIT = 42;

// lists: [{ pos: Float32Array (3 floats per vertex, 9 per triangle), kind, ground, walls, cover, wallBelow (optional z) }]
// after ground(), W.kind is the kind of the surface found ("ground", "rock", "log")
export function buildWorld(lists) {
  const x0 = -LIMIT, y0 = -LIMIT, RG = 1, RS = 0.1, RC = 0.5;
  const GW = Math.ceil((2 * LIMIT) / RG), SW = Math.ceil((2 * LIMIT) / RS), CW = Math.ceil((2 * LIMIT) / RC);
  let nG = 0; for (const L of lists) if (L.ground) nG += L.pos.length / 9;
  const T = new Float32Array(nG * 9), kindOf = new Uint8Array(nG), bucket = new Map(), steep = new Map(), cover = new Float32Array(CW * CW);
  let t = 0;
  const addBand = (k, lo, hi) => {
    let Bd = steep.get(k); if (!Bd) steep.set(k, (Bd = []));
    for (let i = 0; i < Bd.length; i++) { const e = Bd[i]; if (lo <= e[1] + 0.01 && hi >= e[0] - 0.01) { lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); Bd.splice(i, 1); i = -1; } }
    Bd.push([lo, hi]);
  };
  const inside = (x, y) => x > -LIMIT && x < LIMIT && y > -LIMIT && y < LIMIT;
  lists.forEach((L, li) => {
    const P = L.pos;
    for (let i = 0; i + 9 <= P.length; i += 9) {
      const ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[i + 3], by = P[i + 4], bz = P[i + 5], cx = P[i + 6], cy = P[i + 7], cz = P[i + 8];
      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3;
      if (!inside(mx, my)) continue;
      if (L.cover) { const k = Math.floor((my - y0) / RC) * CW + Math.floor((mx - x0) / RC); cover[k] += Math.max(az, bz, cz) - Math.min(az, bz, cz); continue; }
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (l < 1e-12) continue;
      const k = nz / l, mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx), mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
      if (L.ground && Math.abs(k) > 0.5 && (k > 0 || L.twoSided)) {
        T.set([ax, ay, az, bx, by, bz, cx, cy, cz], t * 9); kindOf[t] = li;
        for (let j = Math.floor((mny - y0) / RG); j <= Math.floor((mxy - y0) / RG); j++) for (let q = Math.floor((mnx - x0) / RG); q <= Math.floor((mxx - x0) / RG); q++) { const key = j * GW + q; let a = bucket.get(key); if (!a) bucket.set(key, (a = [])); a.push(t); }
        t++;
      } else if (L.walls && Math.abs(k) <= 0.5) {
        const zlo = Math.min(az, bz, cz), zhi = Math.max(az, bz, cz);
        if (L.wallBelow !== undefined && zlo > L.wallBelow) continue;
        const steps = Math.min(300, Math.max(2, Math.ceil(Math.max(mxx - mnx, mxy - mny, zhi - zlo) / (RS * 0.5))));
        const span = new Map();
        for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps - a; b++) {
          const s = a / steps, r = b / steps, x = ax + ux * s + vx * r, y = ay + uy * s + vy * r, z = az + uz * s + vz * r;
          if (!inside(x, y)) continue;
          const key = Math.floor((y - y0) / RS) * SW + Math.floor((x - x0) / RS), e = span.get(key);
          if (!e) span.set(key, [z, z]); else { if (z < e[0]) e[0] = z; if (z > e[1]) e[1] = z; }
        }
        const pad = (zhi - zlo) / steps * 0.5 + 0.005;
        for (const [key, [lo, hi]] of span) addBand(key, lo - pad, hi + pad);
      }
    }
  });
  const heightOn = (i, x, y) => {
    const o = i * 9, ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-14) return null;
    const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w3 = 1 - w1 - w2;
    if (w1 < -1e-5 || w2 < -1e-5 || w3 < -1e-5) return null;
    return w1 * T[o + 2] + w2 * T[o + 5] + w3 * T[o + 8];
  };
  const W = {
    LIMIT, kind: "",
    // highest ground at or below z + step (null outside the built area)
    ground(x, y, z = 1e6, step = 0.05) {
      if (!inside(x, y)) return null;
      const a = bucket.get(Math.floor((y - y0) / RG) * GW + Math.floor((x - x0) / RG)); if (!a) return null;
      let best = null, bk = 0;
      for (const i of a) { const h = heightOn(i, x, y); if (h !== null && h <= z + step && (best === null || h > best)) { best = h; bk = kindOf[i]; } }
      W.kind = lists[bk].kind; return best;
    },
    // a wall interval overlapping [lo, hi] at (x, y)
    wall(x, y, lo, hi) { if (!inside(x, y)) return true; const Bd = steep.get(Math.floor((y - y0) / RS) * SW + Math.floor((x - x0) / RS)); if (Bd) for (const e of Bd) if (e[1] > lo && e[0] < hi) return true; return false; },
    // grass density (blade metres per 0.5 m cell), smoothed over the 3 × 3 neighbourhood
    grass(x, y) { if (!inside(x, y)) return 0; const i = Math.floor((x - x0) / RC), j = Math.floor((y - y0) / RC); let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < CW && jj < CW) s += cover[jj * CW + ii] * (di || dj ? 0.5 : 1); } return s / 5; },
    // grass blade metres in the single 0.5 m cell at (x, y): clumps are dense, the gaps between them open
    grassAt(x, y) { if (!inside(x, y)) return 0; return cover[Math.floor((y - y0) / RC) * CW + Math.floor((x - x0) / RC)]; },
    stats: { ground: t, wallCells: steep.size },
  };
  return W;
}
