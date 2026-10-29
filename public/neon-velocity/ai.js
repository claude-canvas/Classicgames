// Neon Velocity CPU pilots (DESIGN.md §4): racing line toward the inside of upcoming curvature, speed from
// curvature look-ahead, overtaking around slower ships, drifting through tight corners.
import { kAt, LENGTH, HALF, wrapS } from "./track.js";

export function aiInput(sh, ships, me) {
  const v = Math.max(10, sh.u);
  // curvature ahead
  let kMax = 0, kSum = 0;
  for (let d = 20; d <= 160; d += 20) { const k = kAt(sh.s + d + v * 0.4); kSum += k; if (Math.abs(k) > Math.abs(kMax)) kMax = k; }
  const kAhead = kSum / 8;
  // line: inside of the turn, clamped
  let xt = Math.max(-HALF + 3, Math.min(HALF - 3, kAhead * 1400 + me.lineOff));
  // overtaking: dodge a ship close ahead in our lane
  for (const o of ships) {
    if (o === sh) continue;
    let ds = o.s - sh.s; if (ds < -LENGTH / 2) ds += LENGTH; if (ds > LENGTH / 2) ds -= LENGTH;
    if (ds > 0 && ds < 28 && Math.abs(o.x - xt) < 3.2 && o.u < sh.u + 3) xt = o.x + (o.x > 0 ? -4.5 : 4.5);
  }
  xt = Math.max(-HALF + 2.5, Math.min(HALF - 2.5, xt));
  const look = 14 + v * 0.5;
  const psiDes = Math.atan2(xt - sh.x, look);
  const steer = Math.max(-1, Math.min(1, (psiDes - sh.psi) * 2.6 - sh.yaw * 0.05));
  // speed control
  const vLim = Math.sqrt(62 / Math.max(1e-4, Math.abs(kMax))) * me.skill;
  const gas = sh.u < vLim ? 1 : 0, brake = sh.u > vLim + 8 ? 1 : 0;
  const drift = Math.abs(kMax) > 0.0085 && sh.u > 55 ? Math.sign(kMax) : 0;
  return { steer, drift, gas, brake, fire: sh.turbo > 0 && Math.abs(kAhead) < 0.001 };
}
