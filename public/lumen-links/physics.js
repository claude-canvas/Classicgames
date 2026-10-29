// Lumen Links ball physics (DESIGN.md §1). 2.5D: the ball rolls on the hole's height field h(x, y); walls and
// obstacles are 2D segments/circles, some of them moving with time. Pure; shared by the game and the bot.

export const BALL_R = 0.06, CUP_R = 0.068, DT = 1 / 240, G = 9.81;
const ROLL = 0.55, SAND = 2.4, E_WALL = 0.72, E_BUMP = 1.15;

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// all wall segments active at time t: [[x0, y0, x1, y1, vx, vy], ...] (v = the wall's velocity at that point)
export function wallsAt(hole, t) {
  const out = hole.staticWalls.slice();
  for (const o of hole.moving || []) {
    if (o.type === "windmill") {
      // a blade sweeps down across the tunnel mouth for part of each quarter turn
      const a = (t * o.speed) % (Math.PI / 2), block = Math.abs(a - Math.PI / 4) < o.block;
      if (block) out.push([o.x - o.w, o.y, o.x + o.w, o.y, 0, 0]);
    } else if (o.type === "gate") {
      const xo = o.cx + o.amp * Math.sin(t * o.speed + o.ph), v = o.amp * o.speed * Math.cos(t * o.speed + o.ph);
      out.push([o.x0, o.y, xo - o.gap / 2, o.y, v, 0], [xo + o.gap / 2, o.y, o.x1, o.y, v, 0]);
    }
  }
  return out;
}
export function heightAt(hole, x, y) { return hole.h ? hole.h(x, y) : 0; }
function grad(hole, x, y) { const e = 0.01; return [(heightAt(hole, x + e, y) - heightAt(hole, x - e, y)) / (2 * e), (heightAt(hole, x, y + e) - heightAt(hole, x, y - e)) / (2 * e)]; }

export function makeBall(x, y) { return { x, y, vx: 0, vy: 0, t: 0, holed: false, wet: false, moving: false, rest: [x, y] }; }
export function shoot(b, angle, speed) { b.vx = Math.sin(angle) * speed; b.vy = Math.cos(angle) * speed; b.moving = true; }

// advance by dt (sub-stepped); time t is the course clock (for moving obstacles). Returns events.
export function step(hole, b, t, dt, ev = []) {
  const n = Math.max(1, Math.ceil(dt / DT)), h = dt / n;
  for (let k = 0; k < n && b.moving; k++) {
    const tt = t + k * h;
    const [gx, gy] = grad(hole, b.x, b.y);
    b.vx -= G * gx * (5 / 7) * h; b.vy -= G * gy * (5 / 7) * h;
    const sp = Math.hypot(b.vx, b.vy);
    const inSand = (hole.sand || []).some((p) => pointInPoly(b.x, b.y, p));
    const fr = (inSand ? SAND : ROLL) * h;
    if (sp > fr) { b.vx *= 1 - fr / sp; b.vy *= 1 - fr / sp; } else { b.vx = 0; b.vy = 0; }
    b.x += b.vx * h; b.y += b.vy * h;
    // walls
    for (const [x0, y0, x1, y1, wvx, wvy] of wallsAt(hole, tt)) {
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
      const s = Math.max(0, Math.min(1, ((b.x - x0) * dx + (b.y - y0) * dy) / (L2 || 1)));
      const px = x0 + dx * s, py = y0 + dy * s, ex = b.x - px, ey = b.y - py, d = Math.hypot(ex, ey);
      if (d >= BALL_R || d < 1e-9) continue;
      const nx = ex / d, ny = ey / d;
      b.x = px + nx * BALL_R; b.y = py + ny * BALL_R;
      const rvx = b.vx - wvx, rvy = b.vy - wvy, vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
        const nvn = -vn * E_WALL, nvt = vt * 0.92;
        b.vx = nx * nvn + tx * nvt + wvx; b.vy = ny * nvn + ty * nvt + wvy;
        ev.push({ type: "wall", s: -vn, x: b.x, y: b.y });
      }
    }
    // bumpers
    for (const m of hole.bumpers || []) {
      const ex = b.x - m.x, ey = b.y - m.y, d = Math.hypot(ex, ey), rr = m.r + BALL_R;
      if (d >= rr || d < 1e-9) continue;
      const nx = ex / d, ny = ey / d; b.x = m.x + nx * rr; b.y = m.y + ny * rr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { const out = Math.max(1.5, -vn * E_BUMP); b.vx += nx * (out - vn); b.vy += ny * (out - vn); ev.push({ type: "bump", m, s: out }); }
    }
    // the cup
    const cx = b.x - hole.cup[0], cy = b.y - hole.cup[1], cd = Math.hypot(cx, cy), sp2 = Math.hypot(b.vx, b.vy);
    if (cd < CUP_R) {
      if (sp2 < 1.3) { b.holed = true; b.moving = false; b.x = hole.cup[0]; b.y = hole.cup[1]; ev.push({ type: "cup" }); return ev; }
      if (!b.lipped) { b.lipped = true; const k = 0.75; const tx = -cy / (cd || 1), ty = cx / (cd || 1), side = Math.sign(b.vx * tx + b.vy * ty) || 1; b.vx = b.vx * k + tx * side * 0.25 * sp2; b.vy = b.vy * k + ty * side * 0.25 * sp2; ev.push({ type: "lip" }); }
    } else if (cd > CUP_R * 2) b.lipped = false;
    // hazards: water, and falling off the fairway
    const onBridge = (hole.bridges || []).some((p) => pointInPoly(b.x, b.y, p));
    const wet = !onBridge && ((hole.water || []).some((p) => pointInPoly(b.x, b.y, p)) || (hole.pits || []).some((p) => pointInPoly(b.x, b.y, p)) || !pointInPoly(b.x, b.y, hole.fairway));
    if (wet) { b.wet = true; b.moving = false; ev.push({ type: "water", x: b.x, y: b.y }); return ev; }
    // at rest?
    if (Math.hypot(b.vx, b.vy) < 0.03) {
      const [gx2, gy2] = grad(hole, b.x, b.y);
      if (Math.hypot(gx2, gy2) * G * (5 / 7) < (inSand ? SAND : ROLL) * 0.9) { b.vx = b.vy = 0; b.moving = false; b.rest = [b.x, b.y]; ev.push({ type: "rest" }); }
    }
  }
  b.t += dt;
  return ev;
}
// simulate a whole shot from time t; returns the final ball (used by the bot and the aim preview)
export function simulate(hole, x, y, angle, speed, t, maxT = 14, path = null) {
  const b = makeBall(x, y); shoot(b, angle, speed); let tt = t;
  while (b.moving && tt - t < maxT) { step(hole, b, tt, 1 / 60); tt += 1 / 60; if (path) path.push([b.x, b.y]); }
  b.endT = tt;
  return b;
}
