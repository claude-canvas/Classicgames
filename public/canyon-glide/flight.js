// Canyon Glide flight model (DESIGN.md §1): an energy glider. Yaw is the heading (0 = +y, clockwise), pitch is the
// nose angle (+ up), bank rolls the wings (+ right). Speed trades against height; thermals add free lift.
export const G = 9.81, STALL = 9, DRAG = 0.0017, BRAKE = 0.012;

export function makeGlider(x, y, z) { return { x, y, z, yaw: 0, pitch: -0.05, bank: 0, v: 22, vz: 0, boost: 2, lift: 0, trail: [] }; }

// input: { bank: −1..1, pitch: −1..1, brake: bool }; air(x, y, z) → upward wind m/s
export function stepGlider(g, inp, dt, air) {
  const tBank = inp.bank * 1.05, tPitch = inp.pitch * 0.62;
  g.bank += Math.max(-2.6 * dt, Math.min(2.6 * dt, tBank - g.bank));
  let want = tPitch;
  if (g.v < STALL) want = Math.min(want, -0.35 * (1 - g.v / STALL) - 0.05);   // stall: the nose drops
  g.pitch += Math.max(-1.3 * dt, Math.min(1.3 * dt, want - g.pitch));
  g.v += (-G * Math.sin(g.pitch) - DRAG * g.v * g.v - (inp.brake ? BRAKE * g.v * g.v : 0) - Math.abs(g.bank) * 0.25) * dt;
  g.v = Math.max(4, Math.min(62, g.v));
  g.yaw += (G * Math.tan(g.bank) / Math.max(8, g.v)) * dt;
  const up = air(g.x, g.y, g.z);
  g.lift += (up - g.lift) * Math.min(1, dt * 2);
  // below stall speed the glider also sinks
  const sink = g.v < STALL ? (STALL - g.v) * 0.8 : 0;
  const cp = Math.cos(g.pitch);
  g.x += Math.sin(g.yaw) * cp * g.v * dt; g.y += Math.cos(g.yaw) * cp * g.v * dt;
  g.vz = Math.sin(g.pitch) * g.v + g.lift - sink; g.z += g.vz * dt;
}
export function flap(g) { if (g.boost <= 0) return false; g.boost--; g.v = Math.min(62, g.v + 9); g.pitch = Math.max(g.pitch, 0.05); return true; }
