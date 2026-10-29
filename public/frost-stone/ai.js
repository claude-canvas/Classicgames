// Frost Stone CPU skip (DESIGN.md §4): candidate shots → solve aim/weight with the real physics → simulate → evaluate.
import { throwStone, simulate, score, hogCheck, TEE, HOUSE, R, makeStone } from "./physics.js";

const clone = (st) => st.map((s) => ({ ...s }));
// solve aim & speed so a lone stone stops at (px, py)
export function solveDraw(px, py, spin) {
  let aim = Math.atan2(px, py), speed = Math.sqrt(2 * 0.105 * py);
  for (let it = 0; it < 7; it++) {
    const s = simulate([throwStone(0, aim, speed, spin)])[0];
    if (!s.alive && s.out === "side") { aim *= 0.5; continue; }
    aim += Math.atan2(px - s.x, py) * 0.95;
    speed *= Math.sqrt(Math.max(0.5, py / Math.max(1, s.y)));
  }
  return { aim, speed, spin };
}
// solve the aim so a fast stone passes through (px, py)
export function solveHit(px, py, spin, speed = 3.5) {
  let aim = Math.atan2(px, py);
  for (let it = 0; it < 6; it++) {
    const s = throwStone(0, aim, speed, spin); let t = 0;
    while (s.y < py && t < 30) { const stones = [s]; import_step(stones, 0.02); t += 0.02; if (!s.alive) break; }
    aim += Math.atan2(px - s.x, py) * 0.95;
  }
  return { aim, speed, spin };
}
import { step as import_step } from "./physics.js";

function evaluate(stones, team) {
  const sc = score(stones);
  let v = 0;
  if (sc.team === team) v += 10 + 4 * (sc.n - 1); else if (sc.team !== null) v -= 8 * sc.n + 2;
  for (const s of stones) if (s.alive) {
    const d = Math.hypot(s.x, s.y - TEE);
    if (d < HOUSE + R) v += s.team === team ? 1.2 * (1 - d / HOUSE) : -1.2 * (1 - d / HOUSE);
    if (s.team === team && s.y > 31 && s.y < 34.2 && Math.abs(s.x) < 0.8) v += 0.8;   // a centre guard
  }
  return v;
}

export function chooseShot(stones, team, noise = 0) {
  const cands = [];
  for (const spin of [1, -1]) {
    cands.push(solveDraw(0, TEE, spin));
    for (const [dx, dy] of [[0.5, 0], [-0.5, 0], [0, 0.6], [0, -0.6], [0.3, -0.9]]) cands.push(solveDraw(dx, TEE + dy, spin));
    cands.push(solveDraw(0.15, 32.6, spin));
    for (const s of stones) if (s.alive && s.team !== team && Math.hypot(s.x, s.y - TEE) < HOUSE + 1.2) { cands.push(solveHit(s.x, s.y, spin, 3.5)); cands.push(solveHit(s.x + 0.12, s.y, spin, 3.0)); cands.push(solveHit(s.x - 0.12, s.y, spin, 3.0)); }
  }
  let best = null, bestV = -1e9;
  for (const c of cands) {
    let v = 0;
    for (const jitter of [0, 1]) {   // average over a slightly imperfect delivery so fragile shots score lower
      const st = clone(stones), s = throwStone(team, c.aim + (jitter ? 0.002 : 0), c.speed * (jitter ? 1.006 : 1), c.spin);
      st.push(s); simulate(st); hogCheck(s); v += evaluate(st, team) / 2;
    }
    if (v > bestV) { bestV = v; best = c; }
  }
  const g = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return u / 2 - 1; };
  return { aim: best.aim + g() * noise * 0.01, speed: best.speed * (1 + g() * noise * 0.02), spin: best.spin, value: bestV };
}
export { makeStone };
