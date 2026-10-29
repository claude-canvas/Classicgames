// Saratoga GP — car physics (DESIGN.md §5): an arcade bicycle model on the track's own surfaces.
// Car frame: x right, y forward, z up (metres). The wheel layout comes from assets/car.json (built from the model).
// stepCar(c, inp, dt, world) — world: { ground(x, y, z) → height | null (sets world.surf), wall(x, y, lo, hi) → bool }

export const VMAX = 62, VREV = -8;
const ACC = 12, BRAKE = 22;
// per surface (asphalt, grass, gravel): lateral grip (m/s²) and extra drag (per m/s of speed)
const GRIP = [18, 9, 6], SURF_DRAG = [0, 0.17, 0.4];
const WALL_LO = 0.3, WALL_HI = 1.3;      // walls between these heights above the wheels block the car

export function carGeometry(info) {
  const W = info.wheels, wx = Math.max(...W.map((w) => Math.abs(w.x))), wy = Math.max(...W.map((w) => Math.abs(w.y)));
  // the body footprint, checked for walls on a 3 × 5 grid
  const fx = [-1.0, 0, 1.0], fy = [-2.75, -1.4, 0, 1.4, 2.75];
  return { wx, wy, r: W[0].r, wb: wy * 2, foot: fx.flatMap((x) => fy.map((y) => [x, y])) };
}

// surf: worst wheel surface; sGrip / sDrag: the four wheels' mean grip and drag; grip: a multiplier (rubber band)
export function makeCar(x, y, z, h) { return { x, y, z, h, v: 0, slip: 0, steer: 0, spin: 0, pitch: 0, roll: 0, surf: 0, sGrip: GRIP[0], sDrag: 0, hit: 0, grip: 1 }; }

// all four wheels on the ground within 0.6 m of height z and the footprint clear of walls, at pose (x, y, h)
// → the four wheel heights, or null; out (optional) gets the worst wheel surface and the wheels' mean grip and drag
export function fitsPose(G, world, x, y, h, z, out = null) {
  const fx = Math.cos(h), fy = Math.sin(h), rx = Math.sin(h), ry = -Math.cos(h), hs = [];
  let worst = 0, grip = 0, drag = 0;
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const ox = sx * G.wx, oy = sy * G.wy, px = x + rx * ox + fx * oy, py = y + ry * ox + fy * oy, g = world.ground(px, py, z + 0.6);
    if (g === null || Math.abs(g - z) > 0.6 || world.wall(px, py, g + WALL_LO, g + WALL_HI)) return null;
    hs.push(g); worst = Math.max(worst, world.surf); grip += GRIP[world.surf] / 4; drag += SURF_DRAG[world.surf] / 4;
  }
  const zc = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
  for (const [ox, oy] of G.foot) if (world.wall(x + rx * ox + fx * oy, y + ry * ox + fy * oy, zc + WALL_LO, zc + WALL_HI)) return null;
  if (out) { out.surf = worst; out.grip = grip; out.drag = drag; }
  return hs;
}

// the steering lock available now: limited by grip, so the turn rate never exceeds grip / speed (max 1.6 rad/s)
export function maxSteer(c, G, hand = false) {
  const sp = Math.max(Math.abs(c.v), 0.5), yawCap = Math.min(1.6, (c.sGrip * c.grip * (hand ? 1.4 : 1)) / sp);
  return Math.min(0.6, Math.atan((yawCap * G.wb) / sp));
}

const tmp = { surf: 0, grip: 18, drag: 0 };
export function stepCar(c, inp, dt, G, world) {
  const grip = c.sGrip * c.grip;
  // throttle / brake / reverse, surface drag, rolling resistance
  if (inp.gas > 0) c.v += (c.v < 0 ? BRAKE : ACC * (1 - (Math.max(0, c.v) / VMAX) ** 2)) * inp.gas * dt;
  else if (inp.brake > 0) c.v -= (c.v > 0.5 ? BRAKE : c.v > VREV ? ACC * 0.5 : 0) * inp.brake * dt;
  else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (0.8 + c.v * c.v * 0.0012) * dt);
  c.v -= c.v * c.sDrag * dt;
  if (inp.hand) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), 7 * dt);
  // steering, within the grip-limited lock
  c.steer += (inp.steer * maxSteer(c, G, inp.hand) - c.steer) * Math.min(1, dt * 5);
  const yaw = (c.v * Math.tan(c.steer)) / G.wb;
  c.h += yaw * dt;
  // lateral slide: builds with cornering force beyond grip and with the handbrake, decays with grip
  c.slip += (-yaw * c.v * (inp.hand ? 0.06 : 0.012) - c.slip) * Math.min(1, dt * (inp.hand ? 1.5 : grip * 0.4));
  // move with the four wheels on the ground and the body clear of walls
  const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = Math.sin(c.h), ry = -Math.cos(c.h);
  const dx = (fx * c.v + rx * c.slip) * dt, dy = (fy * c.v + ry * c.slip) * dt;
  const fitsH = (x, y, h, out) => fitsPose(G, world, x, y, h, c.z, out);
  let hs = fitsH(c.x + dx, c.y + dy, c.h, tmp), bump = 0;
  if (hs) { c.x += dx; c.y += dy; }
  else if (!fitsH(c.x, c.y, c.h)) {
    // in a bad spot (spawned or pushed there): hop to the nearest pose that fits
    let found = null;
    for (let r = 0.2; r <= 4 && !found; r += 0.2) for (let a = 0; a < 6.283 && !found; a += 0.35) { const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r, f = fitsH(x, y, c.h, tmp); if (f) found = [x, y, f]; }
    if (found) { c.x = found[0]; c.y = found[1]; hs = found[2]; } else c.v *= 0.5;
  } else {
    // slide along the wall at any angle: the move turned progressively further (nearest side first), shortened by
    // the cosine; speed bleeds off with the deflection
    const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    let slide = null;
    for (const a of [0.15, -0.15, 0.35, -0.35, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.45, -1.45]) {
      const l = len * Math.cos(a), mx = Math.cos(ang + a) * l, my = Math.sin(ang + a) * l, f = fitsH(c.x + mx, c.y + my, c.h, tmp);
      if (f) { slide = [mx, my, f, a]; break; }
    }
    bump = Math.abs(c.v) * (slide ? Math.sin(Math.abs(slide[3])) : 1);
    if (slide) {
      const [mx, my, f, a] = slide;
      c.x += mx; c.y += my; hs = f;
      c.v *= Math.exp(-dt * 8 * (1 - Math.cos(a))); c.slip *= 0.5;
      if (c.v > 1) { let d = Math.atan2(my, mx) - c.h; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; c.h += d * Math.min(1, dt * 5); }
    } else {
      // pressed in at an angle: with the pedal down, pivot toward the side that frees the way, or turn while moving
      const dir = Math.sign(c.v) || 1, step = 1.2 * dt;
      let side = 0;
      if (inp.gas > 0 || inp.brake > 0) for (const k of [1, 3, 6, 12, 20]) for (const sd of [1, -1]) {
        const h = c.h + sd * step * k;
        if (!side && fitsH(c.x, c.y, h) && fitsH(c.x + Math.cos(h) * dir * 0.1, c.y + Math.sin(h) * dir * 0.1, h)) side = sd;
      }
      let turnMove = null;
      if (!side && Math.abs(c.v) > 0.05) for (const a of [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) for (const part of [0.5, 1]) {
        if (turnMove) break;
        const h = c.h + a * part, l = Math.max(len, 0.05), d = ang + a, f = fitsH(c.x + Math.cos(d) * l, c.y + Math.sin(d) * l, h, tmp);
        if (f) turnMove = [c.x + Math.cos(d) * l, c.y + Math.sin(d) * l, h, f, a];
      }
      if (side && fitsH(c.x, c.y, c.h + side * step)) { c.h += side * step; hs = fitsH(c.x, c.y, c.h, tmp); c.v *= Math.exp(-dt * 5); c.slip = 0; }
      else if (turnMove) { [c.x, c.y, c.h, hs] = turnMove; c.v *= Math.exp(-dt * 8 * (1 - Math.cos(turnMove[4]))); c.slip = 0; }
      else { hs = fitsH(c.x, c.y, c.h, tmp); c.v = c.v > 0 ? Math.max(-1, -c.v * 0.2) : Math.min(1, -c.v * 0.2); c.slip = 0; }
    }
  }
  if (hs) {
    c.surf = tmp.surf; c.sGrip = tmp.grip; c.sDrag = tmp.drag;
    const [fl, fr, rl, rr] = hs, z = (fl + fr + rl + rr) / 4;
    c.z += (z - c.z) * Math.min(1, dt * 20);
    c.pitch += (Math.atan2((fl + fr) / 2 - (rl + rr) / 2, G.wy * 2) - c.pitch) * Math.min(1, dt * 12);
    c.roll += (Math.atan2((fr + rr) / 2 - (fl + rl) / 2, G.wx * 2) - c.roll) * Math.min(1, dt * 12);
  }
  c.spin += (c.v / G.r) * dt;
  c.hit = Math.max(0, c.hit - dt);
  if (bump > 4) c.hit = 0.3;
  return bump;
}

// car vs car: two circles each (front and rear); overlapping pairs are pushed apart and trade some speed
export function collideCars(cars) {
  const R = 1.15, OFF = 1.45;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (Math.abs(a.x - b.x) > 8 || Math.abs(a.y - b.y) > 8 || Math.abs(a.z - b.z) > 2) continue;
    for (const sa of [-OFF, OFF]) for (const sb of [-OFF, OFF]) {
      const ax = a.x + Math.cos(a.h) * sa, ay = a.y + Math.sin(a.h) * sa, bx = b.x + Math.cos(b.h) * sb, by = b.y + Math.sin(b.h) * sb;
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
      if (d >= R * 2 || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      // velocities along the normal even out (an inelastic tap)
      const va = (Math.cos(a.h) * nx + Math.sin(a.h) * ny) * a.v, vb = (Math.cos(b.h) * nx + Math.sin(b.h) * ny) * b.v, dv = va - vb;
      if (dv > 0) { a.v -= dv * 0.4 * Math.sign(Math.cos(a.h) * nx + Math.sin(a.h) * ny || 1); b.v += dv * 0.4 * Math.sign(Math.cos(b.h) * nx + Math.sin(b.h) * ny || 1); a.hit = b.hit = 0.2; a.tap = b.tap = Math.min(1, dv / 10); }
    }
  }
}

// 3×4 row-major affine matrices for the bones
export const MX = {
  mul: (A, B) => [A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
};
