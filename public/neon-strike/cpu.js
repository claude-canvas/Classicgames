// Neon Strike CPU bowler (DESIGN.md §3): sample candidate throws, simulate them with the real physics, keep the
// one that knocks down the most pins, then add skill noise.
import { makeBall, rack, simulateRoll, makePin } from "./physics.js";

export function plan(standing, skill, rnd = Math.random) {
  // standing: [{id, x, y}] pins still up (null or 10 pins = full rack)
  const full = !standing || standing.length === 0 || standing.length === 10;
  const mk = () => (full ? rack() : standing.map((p) => makePin(p.id, p.x, p.y)));
  const cands = [];
  if (full) { for (let k = 0; k < 24; k++) cands.push({ x: 0.26 + rnd() * 0.14, angle: (rnd() - 0.5) * 0.004, speed: 7.6 + rnd() * 1.4, hook: 0.6 + rnd() * 0.4 }); }
  else {
    // a straighter ball at the cluster of remaining pins
    const cx = standing.reduce((a, p) => a + p.x, 0) / standing.length;
    for (let k = 0; k < 26; k++) { const tx = cx + (rnd() - 0.5) * 0.25, x0 = (rnd() - 0.5) * 0.6; cands.push({ x: x0, angle: Math.atan2(tx - x0, 18.4), speed: 8 + rnd() * 1.5, hook: (rnd() - 0.5) * 0.3 }); }
  }
  let best = null, bestN = -1;
  for (const c of cands) {
    let n = 0;
    for (const j of [0, 1]) { const b = makeBall(c.x + j * 0.008, c.angle, c.speed * (1 + j * 0.01), c.hook); n += simulateRoll(b, mk()).length; }
    if (n > bestN) { bestN = n; best = c; }
  }
  const noise = [0.05, 0.024, 0.01][skill];
  const g = () => { let u = 0; for (let i = 0; i < 4; i++) u += rnd(); return u / 2 - 1; };
  return { x: best.x + g() * noise, angle: best.angle + g() * noise * 0.02, speed: best.speed * (1 + g() * noise * 0.4), hook: best.hook + g() * noise * 3, expect: bestN / 2 };
}
