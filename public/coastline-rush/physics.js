// Coastline Rush ship physics (DESIGN.md §3). Fixed 120 Hz step in track space; the renderer interpolates.
import { HALF, RAIL, LENGTH, kAt, wrapS, PADS, frame } from "./track.js";

export const DT = 1 / 120, VMAX = 74, BOOST_V = 92;
export function makeShip(i, s, x) {
  return { i, s, x, psi: 0, u: 0, w: 0, yaw: 0, steer: 0, lap: 0, done: false, finishT: 0, boostT: 0, drift: 0, driftDir: 0, charge: 0, wallT: 0, push: 0, bob: Math.random() * 6, prog: s, lastS: s, wrong: 0, slip: 0, turbo: 0, best: 0, lapStart: 0 };
}
// inp: { steer −1..1, drift −1/0/1, gas 0..1, brake 0..1, fire bool }, top: top-speed factor
export function stepShip(sh, inp, dt, top = 1, ev) {
  const k = kAt(sh.s), boosting = sh.boostT > 0;
  // --- speed
  const vmax = (boosting ? BOOST_V : VMAX) * top * (1 + sh.slip * 0.06);
  const off = Math.abs(sh.x) > HALF + 0.3;
  if (inp.gas > 0) sh.u += inp.gas * 26 * Math.pow(Math.max(0, 1 - sh.u / vmax), 0.8) * dt;
  if (off) sh.u -= sh.u * 0.5 * dt;
  sh.off = off;
  if (boosting) sh.u += 34 * (1 - sh.u / vmax) * dt;
  if (inp.brake > 0) sh.u -= inp.brake * 30 * dt;
  sh.u -= (0.0016 * sh.u * sh.u + (inp.gas > 0 ? 0 : 2.5)) * dt;
  if (sh.u > vmax) sh.u -= (sh.u - vmax) * 2 * dt;
  sh.u = Math.max(0, sh.u);
  // --- drift state
  const drifting = inp.drift !== 0 && sh.u > 18;
  if (drifting) { if (sh.driftDir !== inp.drift) { sh.driftDir = inp.drift; sh.charge = 0; } sh.charge = Math.min(3.2, sh.charge + dt * (0.55 + Math.abs(inp.steer) * 0.25)); sh.drift = Math.min(1, sh.drift + dt * 5); }
  else { if (sh.driftDir && sh.charge >= 1) { const lvl = Math.floor(sh.charge); sh.boostT = Math.max(sh.boostT, 0.4 + lvl * 0.35); ev && ev.push({ type: "turbo", sh, lvl }); } sh.driftDir = 0; sh.charge = 0; sh.drift = Math.max(0, sh.drift - dt * 4); }
  if (inp.fire && sh.turbo > 0 && !boosting) { sh.boostT = 1.0; sh.turbo--; ev && ev.push({ type: "turbo", sh, lvl: 3 }); }
  sh.boostT = Math.max(0, sh.boostT - dt);
  // --- yaw: feed-forward follows the road, the player's steer bends the line, drift adds a sharp extra yaw
  const vs = sh.u * Math.cos(sh.psi) - sh.w * Math.sin(sh.psi);
  const yawMax = (0.3 + 1.25 * Math.min(1, sh.u / 25)) * (1 - 0.35 * Math.min(1, sh.u / 74));
  const target = k * vs * 0.95 + inp.steer * yawMax + sh.driftDir * 0.9 * sh.drift - sh.psi * (drifting ? 0.6 : 2.2);
  // critically damped approach → no jitter
  sh.yaw += (target - sh.yaw) * (1 - Math.exp(-dt * 9));
  // the velocity stays put in the world while the nose turns: rotate (u, w) by −yaw·dt
  const a = -sh.yaw * dt, ca = Math.cos(a), sa = Math.sin(a), u = sh.u, w = sh.w;
  sh.u = u * ca - w * sa; sh.w = u * sa + w * ca;
  const crest = Math.max(0, -frame(sh.s).crest * sh.u * sh.u * 0.25); sh.air = Math.min(1, crest); const grip = (8 - 6.4 * sh.drift) * (1 - 0.6 * sh.air);
  const wl = sh.w * (1 - Math.exp(-grip * dt)); sh.w -= wl; sh.u += Math.abs(wl) * 0.55 * sh.drift;   // drifting keeps more momentum
  // --- integrate in track space
  const ds = (sh.u * Math.cos(sh.psi) - sh.w * Math.sin(sh.psi)) / Math.max(0.5, 1 - sh.x * k);
  const dx = sh.u * Math.sin(sh.psi) + sh.w * Math.cos(sh.psi) + sh.push;
  sh.push *= Math.exp(-dt * 6);
  sh.psi += (sh.yaw - k * ds) * dt;
  sh.psi = Math.max(-1.3, Math.min(1.3, sh.psi));
  sh.lastS = sh.s; sh.s = wrapS(sh.s + ds * dt); sh.x += dx * dt; sh.prog += ds * dt;
  if (ds < -2) sh.wrong += dt; else sh.wrong = Math.max(0, sh.wrong - dt * 2);
  // --- walls
  const lim = RAIL - 1.0;
  if (Math.abs(sh.x) > lim) {
    const side = Math.sign(sh.x); sh.x = side * lim;
    const vx = dx; if (vx * side > 0) { const hit = Math.abs(vx); sh.push = -side * hit * 0.3; sh.u *= Math.max(0.6, 1 - hit * 0.012); sh.psi *= 0.4; sh.w *= 0.2; if (hit > 4 && sh.wallT <= 0) { sh.wallT = 0.25; ev && ev.push({ type: "wall", sh, hit }); } }
  }
  sh.wallT -= dt;
  // --- boost pads
  for (const [ps, x0, x1] of PADS) { const d = wrapS(sh.s - ps); if (d < 4 && sh.x > x0 - 1 && sh.x < x1 + 1 && sh.boostT < 1) { sh.boostT = 1.2; ev && ev.push({ type: "pad", sh }); } }
  // --- laps
  if (sh.lastS > LENGTH - 50 && sh.s < 50) { sh.lap++; ev && ev.push({ type: "lap", sh }); }
  if (sh.s > LENGTH - 50 && sh.lastS < 50) sh.lap--;
}
// ship-ship collisions in track space (radius ~2.4 m)
export function collide(ships, ev) {
  for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
    const a = ships[i], b = ships[j];
    let ds = b.s - a.s; if (ds > LENGTH / 2) ds -= LENGTH; if (ds < -LENGTH / 2) ds += LENGTH;
    const dx = b.x - a.x, d = Math.hypot(ds * 0.55, dx);
    if (d > 2.6 || d < 1e-4) continue;
    const ns = (ds * 0.55) / d, nx = dx / d, pen = (2.6 - d) / 2;
    a.s = wrapS(a.s - ns * pen / 0.55); b.s = wrapS(b.s + ns * pen / 0.55); a.x -= nx * pen; b.x += nx * pen;
    const rel = (b.u - a.u) * ns; if (rel < 0) { a.u += rel * 0.5; b.u -= rel * 0.5; }
    a.push -= nx * 4; b.push += nx * 4;
    ev && ev.push({ type: "bump", a, b });
  }
}
