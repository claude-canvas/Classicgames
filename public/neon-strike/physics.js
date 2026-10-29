// Neon Strike bowling physics (DESIGN.md §2). Pure functions on plain objects; fixed step DT.
// Lane frame: x across (+ = right as the bowler sees it), y down the lane from the foul line, metres.

export const LANE_HALF = 0.527, GUTTER = 0.235, HEAD_Y = 18.29, SPACING = 0.3048, PIN_H = 0.38, PIN_R = 0.061, BALL_R = 0.109;
export const ROW = SPACING * Math.sin(Math.PI / 3), PIT_Y = HEAD_Y + 3 * ROW + 0.86, KICK_X = LANE_HALF + GUTTER, OIL_END = 12.2;
export const DT = 1 / 600;
const G = 9.81, MB = 7.0, MP = 1.53, E_BP = 0.75, E_PP = 0.62, THETA_C = 0.17, FALL_K = (3 * G) / (2 * PIN_H);

// pin spots, numbered 1..10 (row by row, left to right from the bowler)
export const SPOTS = [];
for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) SPOTS.push([(k - r / 2) * SPACING, HEAD_Y + r * ROW]);

export function makePin(i, x, y) { return { id: i, x, y, vx: 0, vy: 0, th: 0, thv: 0, dx: 0, dy: 1, spin: 0, rot: Math.random() * 6, out: false, down: false }; }
export function rack(standing = null) { return SPOTS.map(([x, y], i) => (standing && !standing.includes(i) ? null : makePin(i, x, y))).filter(Boolean); }
export function makeBall(x, angle, speed, hook) {
  return { x, y: 0, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, w: hook, gutter: false, out: false, roll: 0, t: 0 };
}

// hook strength by distance down the lane: skids through the oil, bites on the dry back end
const hookAt = (y) => (y < OIL_END - 1 ? 0.05 : y > OIL_END + 1 ? 1.6 : 0.05 + (1.6 - 0.05) * ((y - OIL_END + 1) / 2));

function pinSeg(p) {   // the pin's collision segment on the deck (base → head projection), radius
  const L = PIN_H * Math.sin(Math.min(p.th, Math.PI / 2));
  return { ax: p.x, ay: p.y, bx: p.x + p.dx * L, by: p.y + p.dy * L, r: p.th > 0.6 ? 0.055 : PIN_R };
}
function closestSegSeg(a, b) {
  // closest points between segments a (p1→q1) and b (p2→q2) in 2D; returns {s, t, dx, dy, d}
  const d1x = a.bx - a.ax, d1y = a.by - a.ay, d2x = b.bx - b.ax, d2y = b.by - b.ay, rx = a.ax - b.ax, ry = a.ay - b.ay;
  const A = d1x * d1x + d1y * d1y, Eq = d2x * d2x + d2y * d2y, F = d2x * rx + d2y * ry;
  let s = 0, t = 0;
  if (A < 1e-9 && Eq < 1e-9) { s = t = 0; }
  else if (A < 1e-9) { t = Math.min(1, Math.max(0, F / Eq)); }
  else {
    const C = d1x * rx + d1y * ry;
    if (Eq < 1e-9) { s = Math.min(1, Math.max(0, -C / A)); }
    else {
      const B = d1x * d2x + d1y * d2y, den = A * Eq - B * B;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * Eq) / den)) : 0;
      t = (B * s + F) / Eq;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
    }
  }
  const px = a.ax + d1x * s, py = a.ay + d1y * s, qx = b.ax + d2x * t, qy = b.ay + d2y * t, dx = px - qx, dy = py - qy;
  return { s, t, dx, dy, d: Math.hypot(dx, dy) };
}
// velocity of a point a fraction s up the pin (falling pins sweep their heads)
function pointVel(p, s) {
  const k = PIN_H * Math.cos(Math.min(p.th, Math.PI / 2)) * p.thv * s;
  return [p.vx + p.dx * k, p.vy + p.dy * k];
}
// push a pin over in direction (nx, ny) with impulse j (N·s), applied at relative height hRel (0..1)
function tip(p, nx, ny, j, hRel) {
  p.vx += (nx * j) / MP * (1 - hRel * 0.6); p.vy += (ny * j) / MP * (1 - hRel * 0.6);
  const add = (j / MP) * (2.5 + hRel * 9);
  // combine the existing tilt with the new push as a 2D tilt-rate vector
  let tx = p.dx * p.thv + nx * add, ty = p.dy * p.thv + ny * add;
  const m = Math.hypot(tx, ty);
  if (m > 1e-6) {
    if (p.th > 0.25) { const along = tx * p.dx + ty * p.dy; p.thv = Math.max(p.thv, along); }   // a falling pin keeps its direction
    else { p.dx = tx / m; p.dy = ty / m; p.thv = m; }
  }
  p.spin += (Math.random() - 0.5) * j * 6;
}

export function step(ball, pins, h, events) {
  // ---- ball
  if (ball && !ball.out) {
    ball.t += h;
    if (!ball.gutter) {
      const sp = Math.hypot(ball.vx, ball.vy);
      ball.vx += -ball.w * hookAt(ball.y) * h * Math.min(1, sp / 4);
      ball.w *= Math.exp(-h * (ball.y > OIL_END ? 0.35 : 0.05));
      if (Math.abs(ball.x) > LANE_HALF + 0.02 && ball.y < HEAD_Y - 0.4) { ball.gutter = true; ball.vx = 0; ball.x = Math.sign(ball.x) * (LANE_HALF + GUTTER / 2); events.push({ type: "gutter" }); }
    }
    const sp = Math.hypot(ball.vx, ball.vy), dec = 0.07 * h;
    if (sp > dec) { ball.vx *= 1 - dec / sp; ball.vy *= 1 - dec / sp; }
    ball.x += ball.vx * h; ball.y += ball.vy * h; ball.roll += (sp / BALL_R) * h;
    if (Math.abs(ball.x) > KICK_X - BALL_R) { ball.x = Math.sign(ball.x) * (KICK_X - BALL_R); ball.vx *= -0.3; }
    if (ball.y > PIT_Y + 0.3) { ball.out = true; events.push({ type: "pit" }); }
    // ball vs pins
    if (!ball.gutter || ball.y > HEAD_Y - 0.3) for (const p of pins) {
      if (p.out) continue;
      const sg = pinSeg(p), c = closestSegSeg({ ax: ball.x, ay: ball.y, bx: ball.x, by: ball.y }, sg), rr = BALL_R + sg.r;
      if (c.d >= rr || c.d < 1e-9) continue;
      const nx = -c.dx / c.d, ny = -c.dy / c.d, pen = rr - c.d;                       // from ball to pin
      ball.x -= nx * pen * (MP / (MB + MP)); ball.y -= ny * pen * (MP / (MB + MP));
      p.x += nx * pen * (MB / (MB + MP)); p.y += ny * pen * (MB / (MB + MP));
      const [pvx, pvy] = pointVel(p, c.t), rv = (pvx - ball.vx) * nx + (pvy - ball.vy) * ny;
      if (rv < 0) {
        const j = (-(1 + E_BP) * rv) / (1 / MB + 1 / MP);
        ball.vx -= (j / MB) * nx; ball.vy -= (j / MB) * ny;
        tip(p, nx, ny, j, 0.35 + c.t * 0.3);
        events.push({ type: "hit", x: p.x, y: p.y, s: j / MP, pin: p.id, ball: true });
      }
    }
  }
  // ---- pins
  for (const p of pins) {
    if (p.out) continue;
    // toppling
    if (p.th < THETA_C) { p.thv += (-60 * p.th + (p.thv > 0 ? 0 : 0)) * h - p.thv * 7 * h; if (p.thv > 0 && p.th > THETA_C * 0.98) p.thv += 1 * h; }
    else if (p.th < Math.PI / 2) p.thv += FALL_K * Math.sin(p.th) * h;
    p.th += p.thv * h;
    if (p.th < 0) { p.th = 0; p.thv = Math.abs(p.thv) * 0.2; }
    if (p.th >= Math.PI / 2) { if (p.thv > 1.2) events.push({ type: "thud", x: p.x, y: p.y, s: p.thv * 0.12 }); p.th = Math.PI / 2; p.thv = 0; }
    // sliding on the deck
    const sp = Math.hypot(p.vx, p.vy), fr = (p.th > 1.2 ? 0.32 : 0.45) * G * h;
    if (sp > fr) { p.vx *= 1 - fr / sp; p.vy *= 1 - fr / sp; } else { p.vx = p.vy = 0; }
    p.x += p.vx * h; p.y += p.vy * h; p.rot += p.spin * h; p.spin *= Math.exp(-h * 2);
    // kickback plates
    if (Math.abs(p.x) > KICK_X - 0.06) { p.x = Math.sign(p.x) * (KICK_X - 0.06); p.vx *= -0.5; events.push({ type: "wall", x: p.x, y: p.y, s: Math.abs(p.vx) }); }
    if (p.y > PIT_Y || p.y < HEAD_Y - 1.2 || (Math.abs(p.x) > LANE_HALF + 0.07 && p.y < PIT_Y)) { p.out = true; p.down = true; }
  }
  // ---- pin vs pin
  for (let i = 0; i < pins.length; i++) for (let k = i + 1; k < pins.length; k++) {
    const a = pins[i], b = pins[k];
    if (a.out || b.out) continue;
    if (Math.abs(a.x - b.x) > 0.9 || Math.abs(a.y - b.y) > 0.9) continue;
    const sa = pinSeg(a), sb = pinSeg(b), c = closestSegSeg(sa, sb), rr = sa.r + sb.r;
    if (c.d >= rr || c.d < 1e-9) continue;
    const nx = -c.dx / c.d, ny = -c.dy / c.d, pen = (rr - c.d) / 2;     // from a to b
    a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
    const [avx, avy] = pointVel(a, c.s), [bvx, bvy] = pointVel(b, c.t), rv = (bvx - avx) * nx + (bvy - avy) * ny;
    if (rv < 0) {
      const j = (-(1 + E_PP) * rv) / (2 / MP);
      tip(b, nx, ny, j * 0.9, Math.max(c.t, 0.3)); tip(a, -nx, -ny, j * 0.6, Math.max(c.s, 0.3));
      if (a.th > 0.3) a.thv *= 0.85;   // the faller loses some of its swing
      events.push({ type: "hit", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s: j / MP });
    }
  }
  for (const p of pins) p.down = p.out || p.th > 0.45;
}
export function settled(ball, pins) {
  if (ball && !ball.out) return false;
  return pins.every((p) => p.out || (Math.hypot(p.vx, p.vy) < 0.02 && (Math.abs(p.thv) < 0.05 || p.th >= Math.PI / 2 - 1e-3)));
}
// run a whole roll headless (used by tests and by the CPU's spare planner)
export function simulateRoll(ball, pins, maxT = 7) {
  const ev = []; let t = 0;
  while (t < maxT) { step(ball, pins, DT, ev); t += DT; if (ball.out && t > 1 && settled(ball, pins)) break; if (ev.length > 2000) ev.length = 0; }
  return pins.filter((p) => p.down).map((p) => p.id);
}
