// Lanternfall foes (DESIGN.md §3): wisps, shades, brutes and the two bosses (Morrow, Vesper).
// Every attack is telegraphed with a ground decal (e.tele) before it lands. Enemies are plain objects; humanoids
// carry a chars.js instance in e.ch. main.js supplies the world W: { P (player), S (map), walk, hurt(dmg, x, y),
// spawn(kind, x, y), orbs[], waves[], beams[], sfx(name), shake(k) }.
import { makeChar, setAct } from "./chars.js";
import { clamp, lerp } from "./mesh.js";

export const STATS = {
  wisp: { hp: 26, speed: 3.4, r: 0.45 },
  shade: { hp: 48, speed: 2.3, r: 0.5 },
  brute: { hp: 130, speed: 1.7, r: 0.9 },
  morrow: { hp: 320, speed: 3.0, r: 0.7 },
  vesper: { hp: 900, speed: 2.0, r: 0.8 },
};
export function makeEnemy(kind, x, y, S, opts = {}) {
  const st = STATS[kind], z = S.ground(x, y);
  const e = { kind, x, y, z, sx: x, sy: y, face: 0, hp: opts.hp || st.hp, max: opts.hp || st.hp, r: st.r, state: "idle", t: 0, cd: 1 + Math.random(), stun: 0, hurt: 0, kx: 0, ky: 0, tele: null, dead: false, deadT: 0, t0: Math.random() * 10, phase: 0, shield: kind === "vesper" ? 1 : 0, shieldT: 0, step: 0 };
  if (opts.resume) e.hp = e.max * opts.resume;
  if (kind !== "wisp") e.ch = makeChar(kind, x, y, z, 0);
  e.burstBonus = opts.burstBonus || 1;
  return e;
}
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function moveTo(e, tx, ty, spd, dt, W) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 0.05) return 0;
  const sx = (dx / d) * spd * dt, sy = (dy / d) * spd * dt;
  if (e.kind === "wisp" || !W.walk.blocked(e.x + sx + Math.sign(sx) * 0.3, e.y)) e.x += sx;
  if (e.kind === "wisp" || !W.walk.blocked(e.x, e.y + sy + Math.sign(sy) * 0.3)) e.y += sy;
  return d;
}
function turn(e, target, rate, dt) { e.face += clamp(dAng(e.face, target), -rate * dt, rate * dt); }

export function damageEnemy(e, dmg, src, W, kind = "staff") {
  if (e.dead) return 0;
  if (e.kind === "vesper" && e.shield > 0) {
    if (kind === "burst") { e.shield = 0; e.shieldT = 7; e.stun = 1.6; W.sfx("shatter"); W.shake(0.6); W.text("SHIELD BROKEN", e, "#ffd27a"); }
    else { W.sfx("block"); W.text("SHIELDED", e, "#c7a6ff"); return 0; }
  }
  if (kind === "burst") dmg *= e.burstBonus;
  e.hp -= dmg; e.hurt = 0.15; if (e.ch) e.ch.hurt = 0.15;
  const a = Math.atan2(e.y - src.y, e.x - src.x), kb = e.kind === "brute" || e.kind === "morrow" || e.kind === "vesper" ? 1.5 : kind === "burst" ? 7 : 4;
  e.kx = Math.cos(a) * kb; e.ky = Math.sin(a) * kb;
  if (kind === "burst" && e.kind !== "vesper") e.stun = Math.max(e.stun, e.kind === "morrow" ? 0.6 : 1.2);
  if (e.hp <= 0) { e.hp = 0; e.dead = true; e.deadT = 0; e.tele = null; if (e.ch) setAct(e.ch, "die", 1.2); W.sfx(e.kind === "wisp" ? "pop" : "die"); }
  return dmg;
}

// one enemy tick
export function stepEnemy(e, dt, W) {
  const P = W.P;
  e.hurt = Math.max(0, e.hurt - dt);
  if (e.dead) { e.deadT += dt; if (e.ch) { e.ch.speed = 0; } return; }
  e.x += e.kx * dt; e.y += e.ky * dt; e.kx *= Math.exp(-dt * 7); e.ky *= Math.exp(-dt * 7);
  const d = Math.hypot(P.x - e.x, P.y - e.y), toP = angTo(e, P);
  e.t += dt; e.cd -= dt;
  let spd = 0;
  if (e.stun > 0) { e.stun -= dt; e.tele = null; e.state = "idle"; }
  else if (e.kind === "wisp") {
    const gz = W.S.ground(e.x, e.y);
    if (e.state === "idle") {
      const orbit = 4.5 + Math.sin(e.t0) * 1.2, a = toP + Math.PI + Math.sin(e.t * 0.7 + e.t0) * 0.9;
      moveTo(e, P.x + Math.cos(a) * orbit, P.y + Math.sin(a) * orbit, STATS.wisp.speed, dt, W);
      turn(e, toP, 6, dt);
      if (e.cd < 0 && d < 9) { e.state = "aim"; e.t = 0; e.dir = toP; }
    } else if (e.state === "aim") {
      e.dir = lerp(e.dir, toP, 0.06); e.face = e.dir;
      e.tele = { type: "line", x: e.x, y: e.y, a: e.dir, len: 6.5, w: 0.9, k: e.t / 0.75 };
      if (e.t > 0.75) { e.state = "dash"; e.t = 0; e.tele = null; W.sfx("dash"); e.hit = false; }
    } else if (e.state === "dash") {
      e.x += Math.cos(e.dir) * 10 * dt; e.y += Math.sin(e.dir) * 10 * dt;
      if (!e.hit && d < 1.0) { e.hit = true; W.hurt(10, e.x, e.y); }
      if (e.t > 0.6) { e.state = "idle"; e.cd = 1.8 + Math.random() * 2; }
    }
    e.z = lerp(e.z, gz + 1.1 + Math.sin(W.time * 2.5 + e.t0) * 0.25, 1 - Math.exp(-dt * 4));
    return;
  } else if (e.kind === "shade" || e.kind === "brute") {
    const brute = e.kind === "brute", reach = brute ? 2.6 : 1.7;
    if (e.state === "idle") {
      if (d > reach) { const dd = moveTo(e, P.x, P.y, STATS[e.kind].speed, dt, W); spd = dd > 0 ? 0.6 : 0; }
      turn(e, toP, 5, dt);
      if (d < reach + 0.4 && e.cd < 0) { e.state = "wind"; e.t = 0; setAct(e.ch, brute ? "slam" : "swipe", brute ? 1.6 : 1.0, { step: e.step++ }); }
    } else if (e.state === "wind") {
      const wind = brute ? 1.0 : 0.55;
      if (!brute) turn(e, toP, 2.5, dt);
      e.tele = brute ? { type: "circle", x: e.x + Math.cos(e.face) * 1.5, y: e.y + Math.sin(e.face) * 1.5, r: 3.2, k: e.t / wind } : { type: "cone", x: e.x, y: e.y, a: e.face, r: 2.4, half: 0.9, k: e.t / wind };
      if (e.t > wind) {
        const T = e.tele; e.tele = null;
        if (brute) { if (Math.hypot(P.x - T.x, P.y - T.y) < T.r) W.hurt(24, e.x, e.y); W.sfx("slam"); W.shake(0.6); W.dust(T.x, T.y, 3); }
        else { const da = Math.abs(dAng(e.face, toP)); if (d < 2.4 && da < 0.95) W.hurt(14, e.x, e.y); W.sfx("claw"); }
        e.state = "rec"; e.t = 0;
      }
    } else if (e.state === "rec") { if (e.t > (brute ? 0.9 : 0.5)) { e.state = "idle"; e.cd = (brute ? 1.6 : 1.0) + Math.random() * 0.8; } }
  } else if (e.kind === "morrow") {
    if (e.state === "idle") {
      if (d > 2.2) { const dd = moveTo(e, P.x, P.y, STATS.morrow.speed, dt, W); spd = dd > 0 ? 0.8 : 0; }
      turn(e, toP, 4, dt);
      if (e.cd < 0) {
        const r = Math.random();
        if (d > 6 && r < 0.6) { e.state = "chargeAim"; e.t = 0; e.dir = toP; }
        else if (r < 0.25 && d < 7) { e.state = "waveWind"; e.t = 0; setAct(e.ch, "cast", 1.0); }
        else if (d < 3.4) { e.state = "combo"; e.t = 0; e.n = 0; }
        else e.cd = 0.3;
      }
    } else if (e.state === "combo") {
      const wind = 0.42;
      if (e.t < wind) { turn(e, toP, 3, dt); e.tele = { type: "cone", x: e.x, y: e.y, a: e.face, r: 3.0, half: 1.0, k: e.t / wind }; if (!e.ch.act) setAct(e.ch, "attack", 0.75, { step: e.n % 3 }); }
      else if (!e.swung) { e.swung = true; const T = e.tele; e.tele = null; W.sfx("swing2"); if (d < T.r + 0.3 && Math.abs(dAng(e.face, toP)) < T.half + 0.1) W.hurt(15, e.x, e.y); e.x += Math.cos(e.face) * 0.6; e.y += Math.sin(e.face) * 0.6; }
      if (e.t > wind + 0.35) { e.swung = false; e.n++; e.t = 0; if (e.n >= 3) { e.state = "rec"; e.t = 0; } }
    } else if (e.state === "chargeAim") {
      e.dir = lerp(e.dir, toP, 0.05); e.face = e.dir;
      e.tele = { type: "line", x: e.x, y: e.y, a: e.dir, len: 11, w: 1.6, k: e.t / 0.9 };
      if (e.t > 0.9) { e.state = "charge"; e.t = 0; e.tele = null; e.hit = false; W.sfx("charge"); }
    } else if (e.state === "charge") {
      spd = 1.4; const s = 12 * dt;
      if (!W.walk.blocked(e.x + Math.cos(e.dir) * (s + 0.6), e.y + Math.sin(e.dir) * (s + 0.6))) { e.x += Math.cos(e.dir) * s; e.y += Math.sin(e.dir) * s; } else e.t = 1;
      if (!e.hit && d < 1.4) { e.hit = true; W.hurt(20, e.x, e.y); }
      if (e.t > 0.75) { e.state = "rec"; e.t = 0; }
    } else if (e.state === "waveWind") {
      e.tele = { type: "circle", x: e.x, y: e.y, r: 2.0, k: e.t / 0.8 };
      if (e.t > 0.8) { e.tele = null; W.waves.push({ x: e.x, y: e.y, r: 0.5, v: 7, max: 11, dmg: 16, hit: false }); W.sfx("wave"); e.state = "rec"; e.t = 0; }
    } else if (e.state === "rec") { if (e.t > 0.8) { e.state = "idle"; e.cd = 0.6 + Math.random() * 0.8; } }
  } else if (e.kind === "vesper") {
    const frac = e.hp / e.max;
    e.phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (e.shield === 0) { e.shieldT -= dt; if (e.shieldT <= 0) { e.shield = 1; W.sfx("shield"); } }
    turn(e, toP, 3, dt);
    // keep distance, drift around the arena
    const want = 7 + Math.sin(e.t * 0.3) * 2, a = toP + Math.PI + Math.sin(e.t * 0.25) * 1.2;
    if (e.state === "idle" || e.state === "volley") { moveTo(e, clamp(P.x + Math.cos(a) * want, -14, 14), clamp(P.y + Math.sin(a) * want, -14, 10), STATS.vesper.speed, dt, W); spd = 0.4; }
    if (e.state === "idle" && e.cd < 0) {
      const r = Math.random();
      if (e.phase >= 2 && r < 0.25 && W.count("wisp") < 4) { e.state = "summon"; e.t = 0; setAct(e.ch, "cast", 1.2); }
      else if (e.phase === 3 && r < 0.55) { e.state = "beamWind"; e.t = 0; e.dir = toP - 0.9; setAct(e.ch, "cast", 3.2); }
      else { e.state = "volley"; e.t = 0; e.n = 0; setAct(e.ch, "cast", 1.4); }
    } else if (e.state === "volley") {
      const k = e.phase === 1 ? 5 : 7;
      if (e.t > 0.35 + e.n * 0.16 && e.n < k) { const ang = toP + (e.n - (k - 1) / 2) * 0.22; W.orbs.push({ x: e.x + Math.cos(ang), y: e.y + Math.sin(ang), z: e.z + 1.8, vx: Math.cos(ang) * (5 + e.phase), vy: Math.sin(ang) * (5 + e.phase), life: 4, dmg: 10, home: 0.8 }); e.n++; W.sfx("orb"); }
      if (e.n >= k && e.t > 1.6) { e.state = "idle"; e.cd = 1.2 + Math.random(); }
    } else if (e.state === "summon") {
      e.tele = { type: "circle", x: e.x, y: e.y, r: 2.5, k: e.t / 1.0 };
      if (e.t > 1.0) { e.tele = null; for (let i = 0; i < 3; i++) { const aa = i * 2.1 + e.t0; W.spawn("wisp", e.x + Math.cos(aa) * 3, e.y + Math.sin(aa) * 3); } W.sfx("summon"); e.state = "idle"; e.cd = 1.5; }
    } else if (e.state === "beamWind") {
      e.tele = { type: "line", x: e.x, y: e.y, a: e.dir, len: 18, w: 1.4, k: Math.min(1, e.t / 1.0) };
      if (e.t > 1.0) {
        const sweep = e.dir + (e.t - 1.0) * 0.85; e.tele = { type: "beam", x: e.x, y: e.y, a: sweep, len: 18, w: 1.4, k: 1 };
        const rel = dAng(sweep, toP);
        if (d < 18 && Math.abs(rel) < 0.09 + 0.7 / Math.max(1, d) && (e.beamHit || 0) < W.time) { e.beamHit = W.time + 0.5; W.hurt(18, e.x, e.y); }
        if (e.t > 3.2) { e.tele = null; e.state = "idle"; e.cd = 1.4; }
      }
    }
  }
  // separation from the player
  if (d < e.r + 0.45 && e.kind !== "wisp") { const a = Math.atan2(e.y - P.y, e.x - P.x); e.x = P.x + Math.cos(a) * (e.r + 0.45); e.y = P.y + Math.sin(a) * (e.r + 0.45); }
  e.z = W.S.ground(e.x, e.y);
  if (e.ch) { const c = e.ch; c.x = e.x; c.y = e.y; c.z = e.z + (e.kind === "vesper" ? 0.25 + Math.sin(W.time * 1.5) * 0.15 : 0); c.face = e.face; c.speed = lerp(c.speed, spd, 0.2); }
}
