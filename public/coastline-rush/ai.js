// Coastline Rush CPU pilots (DESIGN.md §4): racing line toward the inside of upcoming curvature, speed from
// curvature look-ahead, overtaking around slower ships, drifting through tight corners.
import { kAt, LENGTH, HALF, wrapS } from "./track.js";

export function aiInput(sh, ships, me) {
  const v = Math.max(10, sh.u);
  // curvature ahead
  let kMax = 0, kSum = 0;
  for (let d = 20; d <= 160; d += 20) { const k = kAt(sh.s + d + v * 0.4); kSum += k; if (Math.abs(k) > Math.abs(kMax)) kMax = k; }
  const kAhead = kSum / 8;
  // line: inside of the turn, clamped
  let xt = Math.max(-HALF + 2, Math.min(HALF - 2, kAhead * 900 + me.lineOff * 0.6));
  // overtaking: dodge a ship close ahead in our lane
  for (const o of ships) {
    if (o === sh) continue;
    let ds = o.s - sh.s; if (ds < -LENGTH / 2) ds += LENGTH; if (ds > LENGTH / 2) ds -= LENGTH;
    if (ds > 0 && ds < 28 && Math.abs(o.x - xt) < 3.2 && o.u < sh.u + 3) xt = o.x + (o.x > 0 ? -3.4 : 3.4);
  }
  xt = Math.max(-HALF + 1.6, Math.min(HALF - 1.6, xt));
  const look = 14 + v * 0.5;
  const psiDes = Math.atan2(xt - sh.x, look);
  const steer = Math.max(-1, Math.min(1, (psiDes - sh.psi) * 2.6 - sh.yaw * 0.05));
  // speed control
  const vLim = Math.sqrt(46 / Math.max(1e-4, Math.abs(kMax))) * me.skill;
  // keep a gap to a car right ahead in the same lane
  let gapLim = 1e9;
  for (const o of ships) { if (o === sh) continue; let ds = o.s - sh.s; if (ds < -LENGTH / 2) ds += LENGTH; if (ds > 0 && ds < 9 && Math.abs(o.x - sh.x) < 2.2) gapLim = Math.min(gapLim, o.u - 1); }
  const vt = Math.min(vLim, gapLim);
  const gas = sh.u < vt ? 1 : 0, brake = sh.u > vt + 6 ? 1 : 0;
  const drift = Math.abs(kMax) > 0.012 && sh.u > 30 ? Math.sign(kMax) : 0;
  return { steer, drift, gas, brake, fire: sh.turbo > 0 && Math.abs(kAhead) < 0.001 };
}
