// Frost Stone curling physics (pure, DESIGN.md §3). Sheet coordinates: x across (±2.375 m), y along the sheet.
export const R = 0.145, HALF_W = 2.375, HOG = 30, TEE = 36, BACK = 37.83, HOUSE = 1.83;
export const MU = 0.105, MU_SWEEP = 0.079, CURL = 0.0175, CURL_SWEEP = 0.6, E = 0.9, DT = 1 / 240;

export function makeStone(team, x, y, vx, vy, spin) { return { team, x, y, vx, vy, spin, alive: true, out: null, swept: false }; }

// advance all stones by dt; returns list of collision impacts (for sound)
export function step(stones, dt) {
  const hits = [];
  const n = Math.max(1, Math.ceil(dt / DT)), h = dt / n;
  for (let k = 0; k < n; k++) {
    for (const s of stones) {
      if (!s.alive) continue;
      const v = Math.hypot(s.vx, s.vy);
      if (v < 1e-4) { s.vx = s.vy = 0; continue; }
      const dec = (s.swept ? MU_SWEEP : MU) * h;
      const ux = s.vx / v, uy = s.vy / v;
      // curl: perpendicular push, stronger as the stone slows
      const c = CURL * s.spin / (v + 0.35) * (s.swept ? CURL_SWEEP : 1) * h;
      s.vx += uy * c; s.vy += -ux * c;
      const nv = Math.max(0, v - dec), f = v > 0 ? nv / Math.hypot(s.vx, s.vy) : 0;
      s.vx *= f; s.vy *= f;
      s.x += s.vx * h; s.y += s.vy * h;
    }
    // collisions
    for (let i = 0; i < stones.length; i++) for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2 * R || d < 1e-9) continue;
      const nx = dx / d, ny = dy / d, ov = 2 * R - d;
      a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const j2 = -(1 + E) * rv / 2;
        a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny;
        hits.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s: -rv });
        // a struck stone keeps only a little of the spin
        b.spin *= 0.3; a.spin *= 0.5;
      }
    }
    for (const s of stones) {
      if (!s.alive) continue;
      if (Math.abs(s.x) > HALF_W - R * 0.2) { s.alive = false; s.out = "side"; }
      else if (s.y - R > BACK) { s.alive = false; s.out = "back"; }
    }
  }
  return hits;
}
export const moving = (stones) => stones.some((s) => s.alive && Math.hypot(s.vx, s.vy) > 1e-3);
// after everything stops: remove stones short of the hog line (only the stone just thrown can be)
export function hogCheck(s) { if (s.alive && s.y + R < HOG) { s.alive = false; s.out = "hog"; return true; } return false; }

// launch velocity from aim angle (rad, + = to the right), speed and spin (+1 in-turn / curls right, −1 out-turn)
export function throwStone(team, aim, speed, spin) { return makeStone(team, 0, 0, Math.sin(aim) * speed, Math.cos(aim) * speed, spin); }

export function simulate(stones, maxT = 40) {
  let t = 0;
  while (t < maxT && moving(stones)) { step(stones, 0.05); t += 0.05; }
  return stones;
}

// which team scores and how many (stones in the house closer than the opponent's best)
export function score(stones) {
  const inHouse = stones.filter((s) => s.alive && Math.hypot(s.x, s.y - TEE) < HOUSE + R).map((s) => ({ s, d: Math.hypot(s.x, s.y - TEE) })).sort((a, b) => a.d - b.d);
  if (!inHouse.length) return { team: null, n: 0, counting: [] };
  const team = inHouse[0].s.team; let n = 0; const counting = [];
  for (const e of inHouse) { if (e.s.team !== team) break; n++; counting.push(e.s); }
  return { team, n, counting };
}
