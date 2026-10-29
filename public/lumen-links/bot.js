// Lumen Links bot (DESIGN.md §3): search angle × power with the real physics; prefer shots that hole out or stop
// close to the cup, and that still work with a little error. Used offline for validation and by ?auto.
import { simulate } from "./physics.js";

export function bestShot(hole, x, y, t, opts = {}) {
  const angStep = opts.angStep ?? 2, pows = opts.pows ?? 28, robust = opts.robust ?? true;
  const score = (b) => (b.wet ? 50 : b.holed ? -10 : Math.hypot(b.x - hole.cup[0], b.y - hole.cup[1]));
  let best = null;
  for (let a = 0; a < 360; a += angStep) {
    const ang = (a * Math.PI) / 180;
    for (let k = 0; k < pows; k++) {
      const sp = 0.6 + (k / (pows - 1)) * 4.6;
      const b = simulate(hole, x, y, ang, sp, t);
      let s = score(b);
      if (s > (best ? best.s + 1.5 : 1e9)) continue;
      if (robust) { const b2 = simulate(hole, x, y, ang + 0.012, sp * 1.03, t), b3 = simulate(hole, x, y, ang - 0.012, sp * 0.97, t); s = s * 0.5 + score(b2) * 0.25 + score(b3) * 0.25; }
      if (!best || s < best.s) best = { s, ang, sp, end: [b.x, b.y], holed: b.holed };
    }
  }
  return best;
}
