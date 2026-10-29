// Golden Hare (from The Hollow Pines / Last Light) — a navigation grid: which spots of the forest floor a walker can stand on and
// step between, what is reachable from the start (so shrines are only ever placed where you can get to), and distance
// fields toward a target, so the auto mode finds its way around logs, rocks and trunks.
// opts: res (cell size), lo / hi (the wall band above the floor that blocks), step (the largest height step),
//       radius (a walker's body: a cell is standable only if 8 points on this circle are clear too)
export function buildNav(world, sx, sy, opts = {}) {
  const RES = opts.res ?? 0.15, HALF = 30, N = Math.round((2 * HALF) / RES), STEP_H = opts.step ?? 0.05, LO = opts.lo ?? 0.01, HI = opts.hi ?? 0.07;
  const h = new Float32Array(N * N).fill(NaN), ok = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * RES, y = -HALF + (j + 0.5) * RES, g = world.ground(x, y);
    if (g === null || world.kind !== "ground") continue;
    h[j * N + i] = g;
    const R = opts.radius || 0;
    let clear = !world.wall(x, y, g + LO, g + HI);
    for (let k = 0; k < 8 && clear && R; k++) { const a = (k / 8) * Math.PI * 2; if (world.wall(x + Math.cos(a) * R, y + Math.sin(a) * R, g + LO, g + HI)) clear = false; }
    if (clear) ok[j * N + i] = 1;
  }
  const cell = (x, y) => { const i = Math.floor((x + HALF) / RES), j = Math.floor((y + HALF) / RES); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const center = (k) => [-HALF + ((k % N) + 0.5) * RES, -HALF + (Math.floor(k / N) + 0.5) * RES, h[k]];
  // a step between neighbours: both standable, a small height change, and no wall halfway
  const linked = (a, b) => { if (!ok[a] || !ok[b] || Math.abs(h[a] - h[b]) > STEP_H) return false; const pa = center(a), pb = center(b), mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2; return !world.wall(mx, my, Math.max(h[a], h[b]) + LO, Math.max(h[a], h[b]) + HI); };
  const NB = [1, -1, N, -N];
  // cache the links (4 per cell)
  const link = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) { if (!ok[k]) continue; const i = k % N; NB.forEach((d, b) => { const n = k + d; if ((d === 1 && i === N - 1) || (d === -1 && i === 0) || n < 0 || n >= N * N) return; if (linked(k, n)) link[k] |= 1 << b; }); }
  const bfs = (start, out) => { out.fill(-1); if (start < 0 || !ok[start]) return out; const q = new Int32Array(N * N); let a = 0, b = 0; q[b++] = start; out[start] = 0; while (a < b) { const k = q[a++]; for (let n = 0; n < 4; n++) if (link[k] & (1 << n)) { const m = k + NB[n]; if (out[m] < 0) { out[m] = out[k] + 1; q[b++] = m; } } } return out; };
  // reachable from the start (snap the start to the nearest standable cell)
  let s0 = cell(sx, sy); if (s0 < 0 || !ok[s0]) s0 = nearestOk(s0);
  function nearestOk(k) { const ci = k % N, cj = Math.floor(k / N); for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < N && j < N && ok[j * N + i]) return j * N + i; } return -1; }
  const reach = bfs(s0, new Int32Array(N * N));
  const nav = {
    RES, reach,
    reachable: (x, y) => { const k = cell(x, y); return k >= 0 && reach[k] >= 0; },
    // the nearest reachable spot to (x, y) with every neighbour reachable too (room to stand), as [x, y, z]
    snap(x, y, room = 1) {
      const k0 = cell(clampC(x), clampC(y)), ci = k0 % N, cj = Math.floor(k0 / N);
      for (let r = 0; r < 60; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj; if (i < room || j < room || i >= N - room || j >= N - room) continue;
        let good = true; for (let b = -room; b <= room && good; b++) for (let a = -room; a <= room && good; a++) if (reach[(j + b) * N + i + a] < 0) good = false;
        if (good) return center(j * N + i);
      }
      return [x, y, 0];
    },
    // a distance field toward (x, y): steps from every reachable cell
    field(x, y) { let k = cell(x, y); if (k < 0 || reach[k] < 0) k = nearestReach(k); return bfs(k, new Int32Array(N * N)); },
    // the direction to walk from (x, y) along a field: toward the lowest neighbour a few cells away
    steer(F, x, y) {
      let k = cell(x, y); if (k < 0) return null; if (F[k] < 0) { k = nearestIn(F, k); if (k < 0) return null; }
      let cur = k;
      for (let s = 0; s < 4; s++) { let best = cur; for (let n = 0; n < 4; n++) if (link[cur] & (1 << n)) { const m = cur + NB[n]; if (F[m] >= 0 && F[m] < F[best]) best = m; } if (best === cur) break; cur = best; }
      const p = center(cur); return { x: p[0], y: p[1], d: F[k] * RES };
    },
  };
  const clampC = (v) => Math.max(-HALF + RES, Math.min(HALF - RES, v));
  function nearestReach(k) { return nearestIn(reach, k); }
  function nearestIn(F, k) { if (k < 0) return -1; const ci = k % N, cj = Math.floor(k / N); for (let r = 1; r < 60; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < N && j < N && F[j * N + i] >= 0) return j * N + i; } return -1; }
  let count = 0; for (let k = 0; k < N * N; k++) if (reach[k] >= 0) count++;
  nav.stats = { cells: N * N, reachable: count };
  return nav;
}
