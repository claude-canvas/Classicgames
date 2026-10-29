// Orbit Breaker rules (DESIGN.md §1): polar breakout. Pure state + step(); the renderer and the headless test both
// drive it. Angles in radians, counter-clockwise from +x.
import { buildWave } from "./waves.js";

export const ARENA = 10, PAD_R = 9.3, BALL_R = 0.18, CORE_R = 0.9, LOST_R = 10.2;
const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const angDiff = (a, b) => { let d = wrap(a - b); if (d > Math.PI) d -= TAU; return d; };

export function newGame() { return { wave: 0, lives: 3, score: 0, combo: 0, best: 0, pad: Math.PI * 1.5, padV: 0, balls: [], drops: [], bolts: [], fx: [], power: { wide: 0, laser: 0, slow: 0, magnet: 0 }, held: null, t: 0, spinT: 0, bricks: [], name: "", cleared: false, events: [] }; }
export function startWave(g, i) {
  const w = buildWave(i); g.wave = i; g.bricks = w.bricks; g.name = w.name; g.cleared = false;
  g.balls = []; g.drops = []; g.bolts = []; g.spinT = 0; serve(g);
}
export function serve(g) { const b = { x: 0, y: 0, vx: 0, vy: 0, speed: 8, stuck: true, off: 0 }; g.balls.push(b); g.held = b; placeOnPad(g, b); }
function placeOnPad(g, b) { const a = g.pad + b.off; b.x = Math.cos(a) * (PAD_R - BALL_R - 0.25); b.y = Math.sin(a) * (PAD_R - BALL_R - 0.25); }
export function launch(g) {
  const b = g.held; if (!b) return; g.held = null; b.stuck = false;
  const a = g.pad + b.off + Math.PI + (Math.random() - 0.5) * 0.4; b.vx = Math.cos(a) * b.speed; b.vy = Math.sin(a) * b.speed;
}
export const padWidth = (g) => (g.power.wide > 0 ? 0.7 : 0.42);
export function brickAngles(g, k) { const d = k.spin * g.spinT; return [k.a0 + d, k.a1 + d]; }

// closest point on an annular sector to p (polar clamp)
function sectorClosest(k, a0, a1, x, y) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x);
  const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, d = angDiff(th, mid);
  const tc = mid + Math.max(-half, Math.min(half, d)), rc = Math.max(k.r0, Math.min(k.r1, r));
  const inside = Math.abs(d) <= half && r >= k.r0 && r <= k.r1;
  if (!inside) return { px: Math.cos(tc) * rc, py: Math.sin(tc) * rc, inside };
  // inside: push out through the nearest face
  const dIn = r - k.r0, dOut = k.r1 - r, dA = (half - Math.abs(d)) * r;
  const m = Math.min(dIn, dOut, dA);
  if (m === dIn) return { px: Math.cos(th) * k.r0, py: Math.sin(th) * k.r0, inside, nx: -Math.cos(th), ny: -Math.sin(th) };
  if (m === dOut) return { px: Math.cos(th) * k.r1, py: Math.sin(th) * k.r1, inside, nx: Math.cos(th), ny: Math.sin(th) };
  const e = mid + Math.sign(d || 1) * half, s = Math.sign(d || 1);
  return { px: Math.cos(e) * r, py: Math.sin(e) * r, inside, nx: -Math.sin(e) * s, ny: Math.cos(e) * s };
}
function hitBrick(g, k, ev) {
  if (k.type === "m") { ev.push({ type: "metal", k }); k.hitT = 1; return; }
  k.hp--; k.hitT = 1;
  if (k.hp > 0) { ev.push({ type: "crack", k }); return; }
  k.alive = false; g.combo++; g.score += (k.max * 10 + (k.type === "p" ? 25 : 0)) * Math.max(1, g.combo);
  ev.push({ type: "break", k, combo: g.combo });
  for (const b of g.balls) b.speed = Math.min(15, b.speed * 1.02);
  if (k.type === "p" || Math.random() < 0.08) { const [a0, a1] = brickAngles(g, k), a = (a0 + a1) / 2, r = (k.r0 + k.r1) / 2; g.drops.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, a, r, kind: ["multi", "wide", "laser", "slow", "life", "magnet"][Math.floor(Math.random() * (Math.random() < 0.85 ? 4 : 6))] }); }
  if (k.type === "b") {
    const [a0, a1] = brickAngles(g, k), cx = Math.cos((a0 + a1) / 2) * (k.r0 + k.r1) / 2, cy = Math.sin((a0 + a1) / 2) * (k.r0 + k.r1) / 2;
    ev.push({ type: "bomb", x: cx, y: cy });
    for (const o of g.bricks) { if (!o.alive || o === k || o.type === "m") continue; const [b0, b1] = brickAngles(g, o), ox = Math.cos((b0 + b1) / 2) * (o.r0 + o.r1) / 2, oy = Math.sin((b0 + b1) / 2) * (o.r0 + o.r1) / 2; if (Math.hypot(ox - cx, oy - cy) < 1.9) { o.hp = 1; hitBrick(g, o, ev); } }
  }
}
export function step(g, dt, input) {
  const ev = g.events; ev.length = 0;
  g.t += dt; g.spinT += dt;
  for (const k of Object.keys(g.power)) g.power[k] = Math.max(0, g.power[k] - dt);
  // paddle: chase the target angle with a speed limit
  const target = input.pad ?? g.pad, d = angDiff(target, g.pad), maxV = 9;
  g.padV = Math.max(-maxV, Math.min(maxV, d * 18)); g.pad = wrap(g.pad + g.padV * dt);
  const pw = padWidth(g);
  if (input.fire) { if (g.held) launch(g); else if (g.power.laser > 0 && g.t - (g.lastBolt || 0) > 0.25) { g.lastBolt = g.t; for (const s of [-1, 1]) { const a = g.pad + s * pw * 0.4; g.bolts.push({ x: Math.cos(a) * PAD_R, y: Math.sin(a) * PAD_R, vx: -Math.cos(a) * 18, vy: -Math.sin(a) * 18 }); } ev.push({ type: "laser" }); } }
  // balls
  const slow = g.power.slow > 0 ? 0.65 : 1;
  for (const b of g.balls) {
    if (b.stuck) { placeOnPad(g, b); continue; }
    const n = 4, h = dt / n;
    for (let s = 0; s < n && !b.dead; s++) {
      const sp = Math.hypot(b.vx, b.vy) || 1, v = b.speed * slow; b.vx = (b.vx / sp) * v; b.vy = (b.vy / sp) * v;
      b.x += b.vx * h; b.y += b.vy * h;
      const r = Math.hypot(b.x, b.y);
      // core
      if (r < CORE_R + BALL_R) { const nx = b.x / r, ny = b.y / r, vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; const j = (Math.random() - 0.5) * 0.5, c = Math.cos(j), sn = Math.sin(j), vx = b.vx; b.vx = vx * c - b.vy * sn; b.vy = vx * sn + b.vy * c; ev.push({ type: "core" }); } b.x = nx * (CORE_R + BALL_R); b.y = ny * (CORE_R + BALL_R); }
      // paddle
      if (r > PAD_R - BALL_R - 0.12 && r < PAD_R + 0.25) {
        const th = Math.atan2(b.y, b.x), off = angDiff(th, g.pad), outward = (b.vx * b.x + b.vy * b.y) / r > 0;
        if (Math.abs(off) <= pw / 2 + BALL_R / PAD_R && outward) {
          const rel = Math.max(-1, Math.min(1, off / (pw / 2))), a = th + Math.PI - rel * 0.96 + (Math.random() - 0.5) * 0.03;
          b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v; b.x = Math.cos(th) * (PAD_R - BALL_R - 0.13); b.y = Math.sin(th) * (PAD_R - BALL_R - 0.13);
          g.combo = 0; ev.push({ type: "paddle", rel });
          if (g.power.magnet > 0 && !g.held) { b.stuck = true; b.off = off; g.held = b; }
        }
      }
      if (r > LOST_R) { b.dead = true; ev.push({ type: "lost", x: b.x, y: b.y }); break; }
      // bricks
      for (const k of g.bricks) {
        if (!k.alive) continue;
        if (r + BALL_R < k.r0 || r - BALL_R > k.r1) continue;
        const [a0, a1] = brickAngles(g, k), c = sectorClosest(k, a0, a1, b.x, b.y);
        let nx, ny, dd;
        if (c.inside) { nx = c.nx; ny = c.ny; dd = 0; }
        else { const ex = b.x - c.px, ey = b.y - c.py; dd = Math.hypot(ex, ey); if (dd >= BALL_R) continue; nx = ex / dd; ny = ey / dd; }
        b.x = c.px + nx * (BALL_R + 0.001); b.y = c.py + ny * (BALL_R + 0.001);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        // a spinning layer drags the ball a touch
        if (k.spin) { const tx = -Math.sin(Math.atan2(b.y, b.x)), ty = Math.cos(Math.atan2(b.y, b.x)); b.vx += tx * k.spin * 0.6; b.vy += ty * k.spin * 0.6; }
        hitBrick(g, k, ev);
        break;
      }
    }
  }
  const lost = g.balls.filter((b) => b.dead).length;
  g.balls = g.balls.filter((b) => !b.dead);
  if (lost && g.balls.length === 0) { g.lives--; g.combo = 0; g.power = { wide: 0, laser: 0, slow: 0, magnet: 0 }; ev.push({ type: "life" }); if (g.lives > 0) serve(g); else ev.push({ type: "over" }); }
  // laser bolts
  for (const bo of g.bolts) {
    bo.x += bo.vx * dt; bo.y += bo.vy * dt; const r = Math.hypot(bo.x, bo.y);
    if (r < CORE_R) { bo.dead = true; continue; }
    for (const k of g.bricks) { if (!k.alive || r < k.r0 || r > k.r1) continue; const [a0, a1] = brickAngles(g, k), th = Math.atan2(bo.y, bo.x); if (Math.abs(angDiff(th, (a0 + a1) / 2)) <= (a1 - a0) / 2) { hitBrick(g, k, ev); bo.dead = true; break; } }
  }
  g.bolts = g.bolts.filter((b) => !b.dead);
  // drops drift outward to the ring
  for (const p of g.drops) {
    p.r += 2.2 * dt; p.x = Math.cos(p.a) * p.r; p.y = Math.sin(p.a) * p.r;
    if (p.r > PAD_R - 0.3 && p.r < PAD_R + 0.3 && Math.abs(angDiff(p.a, g.pad)) < pw / 2 + 0.06) { p.got = true; applyPower(g, p.kind); ev.push({ type: "power", kind: p.kind }); }
    if (p.r > LOST_R + 0.5) p.got = true;
  }
  g.drops = g.drops.filter((p) => !p.got);
  if (!g.cleared && g.bricks.every((k) => !k.alive || k.type === "m")) { g.cleared = true; ev.push({ type: "clear" }); }
  return ev;
}
function applyPower(g, kind) {
  if (kind === "multi") { const src = g.balls.find((b) => !b.stuck) || g.balls[0]; if (src) for (const s of [-0.5, 0.5]) { const a = Math.atan2(src.vy, src.vx) + s; g.balls.push({ x: src.x, y: src.y, vx: Math.cos(a) * src.speed, vy: Math.sin(a) * src.speed, speed: src.speed, stuck: false }); } }
  else if (kind === "life") g.lives = Math.min(6, g.lives + 1);
  else g.power[kind] = kind === "wide" ? 12 : 8;
}
// a helper for ?auto and tests: aim the paddle under the ball most likely to escape soonest
export function autoPad(g) {
  let best = null, bt = 1e9;
  for (const b of g.balls) { if (b.stuck) continue; const r = Math.hypot(b.x, b.y), vr = (b.vx * b.x + b.vy * b.y) / (r || 1); if (vr <= 0) continue; const t = (PAD_R - r) / vr; if (t < bt) { bt = t; best = b; } }
  if (!best) return g.pad;
  // predict where the ball will cross the paddle circle, and meet it off-centre so it angles back into the bricks
  const t = bt, px = best.x + best.vx * t, py = best.y + best.vy * t;
  if (best.aimOff === undefined || best.aimFor !== g.t - (g.t % 1)) { best.aimOff = (Math.random() - 0.5) * padWidth(g) * 0.7; best.aimFor = g.t - (g.t % 1); }
  return Math.atan2(py, px) - best.aimOff;
}
