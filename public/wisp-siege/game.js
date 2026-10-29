// Wisp Siege rules (DESIGN.md §1): pure tower-defense simulation in tile units. step(g, dt) advances everything
// and returns events for sound/fx.

export const W = 14, H = 9;
export const PATH = [[-1, 1], [3, 1], [3, 6], [7, 6], [7, 2], [10, 2], [10, 7], [13, 7]];
export const ROCKS = [[0, 4], [5, 3], [12, 1], [1, 8], [8, 8], [12, 4]];
// path tiles + cumulative lengths
const SEG = []; let TOTAL = 0;
for (let i = 0; i < PATH.length - 1; i++) { const [ax, ay] = PATH[i], [bx, by] = PATH[i + 1], L = Math.hypot(bx - ax, by - ay); SEG.push({ ax, ay, bx, by, L, s0: TOTAL }); TOTAL += L; }
export const PATH_LEN = TOTAL;
export const PATH_TILES = new Set();
for (const s of SEG) { const n = Math.round(s.L); for (let k = 0; k <= n; k++) { const x = Math.round(s.ax + ((s.bx - s.ax) * k) / n), y = Math.round(s.ay + ((s.by - s.ay) * k) / n); if (x >= 0 && x < W) PATH_TILES.add(x + "," + y); } }
export function pathPos(s) {
  s = Math.max(0, Math.min(TOTAL, s));
  for (const g of SEG) if (s <= g.s0 + g.L) { const t = (s - g.s0) / g.L; return [g.ax + (g.bx - g.ax) * t, g.ay + (g.by - g.ay) * t]; }
  const l = SEG[SEG.length - 1]; return [l.bx, l.by];
}
export const buildable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !PATH_TILES.has(x + "," + y) && !ROCKS.some(([a, b]) => a === x && b === y);

export const ENEMY = {
  wisp: { hp: 30, speed: 1.6, armor: 0, gold: 4, size: 0.22 },
  moth: { hp: 12, speed: 2.2, armor: 0, gold: 2, size: 0.15 },
  golem: { hp: 160, speed: 0.7, armor: 4, gold: 12, size: 0.36 },
  shade: { hp: 70, speed: 1.3, armor: 0, gold: 8, size: 0.26, noSlow: true },
  boss: { hp: 1600, speed: 0.55, armor: 6, gold: 120, size: 0.62, lives: 5 },
};
export const TOWER = {
  lamp: { name: "Arc Lamp", cost: 60, range: 2.6, dps: 22 },
  mortar: { name: "Mortar", cost: 90, range: 3.4, rate: 1.6, dmg: 40, splash: 0.9 },
  bell: { name: "Frost Bell", cost: 70, range: 2.0, slow: 0.55, tick: 4 },
  tesla: { name: "Tesla Spire", cost: 120, range: 2.8, rate: 0.9, dmg: 30, chain: 3 },
};
export const upgradeCost = (t) => Math.round(TOWER[t.type].cost * (t.level === 1 ? 0.7 : 1.1));
export function towerStats(t) {
  const B = TOWER[t.type], L = t.level;
  if (t.type === "lamp") return { range: B.range + 0.3 * (L - 1), dps: B.dps * Math.pow(1.6, L - 1) };
  if (t.type === "mortar") return { range: B.range + 0.2 * (L - 1), rate: B.rate * (L === 3 ? 0.85 : 1), dmg: B.dmg * Math.pow(1.55, L - 1), splash: B.splash + 0.1 * (L - 1) };
  if (t.type === "bell") return { range: B.range + 0.25 * (L - 1), slow: L === 3 ? 0.4 : L === 2 ? 0.48 : 0.55, tick: B.tick * L };
  return { range: B.range + 0.2 * (L - 1), rate: B.rate * (L === 3 ? 0.8 : 1), dmg: B.dmg * Math.pow(1.5, L - 1), chain: L === 3 ? 5 : B.chain };
}
const G_ = (t, n, gap) => [t, n, gap];
export const WAVES = [
  [G_("wisp", 8, 1.0)],
  [G_("wisp", 10, 0.8), G_("moth", 6, 0.4)],
  [G_("moth", 16, 0.35), G_("wisp", 6, 0.8)],
  [G_("golem", 3, 2.2), G_("wisp", 10, 0.7)],
  [G_("shade", 8, 1.0), G_("moth", 12, 0.3)],
  [G_("wisp", 16, 0.5), G_("golem", 4, 1.8)],
  [G_("moth", 30, 0.22), G_("shade", 6, 0.9)],
  [G_("golem", 8, 1.4), G_("shade", 8, 0.8)],
  [G_("wisp", 24, 0.35), G_("moth", 24, 0.25), G_("golem", 4, 1.5)],
  [G_("boss", 1, 1), G_("wisp", 14, 0.6)],
  [G_("shade", 18, 0.6), G_("golem", 8, 1.2)],
  [G_("moth", 50, 0.15), G_("wisp", 20, 0.4)],
  [G_("golem", 14, 1.0), G_("shade", 14, 0.6)],
  [G_("wisp", 30, 0.3), G_("golem", 10, 0.9), G_("shade", 16, 0.5)],
  [G_("boss", 2, 6), G_("golem", 10, 1.0), G_("moth", 40, 0.18)],
];

export function newGame(startWave = 0) { return { gold: 220, lives: 20, wave: startWave, enemies: [], towers: [], shells: [], queue: [], spawnT: 0, waveActive: false, won: false, lost: false, t: 0, bolts: [], events: [], kills: 0 }; }
export function startNextWave(g) {
  if (g.waveActive || g.wave >= WAVES.length) return false;
  const scale = Math.pow(1.2, g.wave); g.queue = [];
  let t = 0; for (const [type, n, gap] of WAVES[g.wave]) for (let i = 0; i < n; i++) { g.queue.push({ type, at: t, scale }); t += gap; }
  g.queue.sort((a, b) => a.at - b.at); g.spawnT = 0; g.waveActive = true; g.events.push({ type: "wave", n: g.wave + 1 });
  return true;
}
export function build(g, type, x, y) {
  if (!buildable(x, y) || g.towers.some((t) => t.x === x && t.y === y) || g.gold < TOWER[type].cost) return null;
  const t = { type, x, y, level: 1, spent: TOWER[type].cost, cd: 0, target: null, aim: 0 }; g.gold -= TOWER[type].cost; g.towers.push(t); return t;
}
export function upgrade(g, t) { if (t.level >= 3) return false; const c = upgradeCost(t); if (g.gold < c) return false; g.gold -= c; t.spent += c; t.level++; return true; }
export function sell(g, t) { g.gold += Math.round(t.spent * 0.7); g.towers.splice(g.towers.indexOf(t), 1); }

function damage(g, e, d, ev) {
  if (e.dead) return;
  e.hp -= Math.max(1, d - e.armor); e.hitT = 0.15;
  if (e.hp <= 0) { e.dead = true; g.gold += e.gold; g.kills++; ev.push({ type: "kill", e }); }
}
export function step(g, dt) {
  const ev = g.events; ev.length = 0;
  if (g.lost || g.won) return ev;
  g.t += dt;
  // spawning
  if (g.waveActive) {
    g.spawnT += dt;
    while (g.queue.length && g.queue[0].at <= g.spawnT) {
      const q = g.queue.shift(), E = ENEMY[q.type];
      g.enemies.push({ type: q.type, hp: E.hp * q.scale, max: E.hp * q.scale, speed: E.speed, armor: E.armor, gold: E.gold, size: E.size, s: 0, slow: 1, hitT: 0, ph: Math.random() * 6, dead: false });
    }
  }
  // enemies move
  for (const e of g.enemies) {
    e.s += e.speed * e.slow * dt; e.slow = 1; e.hitT = Math.max(0, e.hitT - dt);
    const [x, y] = pathPos(e.s); e.x = x; e.y = y;
    if (e.s >= PATH_LEN) { e.dead = true; e.leaked = true; g.lives -= ENEMY[e.type].lives || 1; ev.push({ type: "leak", e }); }
  }
  // towers
  const inRange = (t, r) => g.enemies.filter((e) => !e.dead && Math.hypot(e.x - t.x, e.y - t.y) <= r);
  for (const t of g.towers) {
    const S = towerStats(t);
    t.cd -= dt; t.target = null;
    if (t.type === "bell") {
      const es = inRange(t, S.range); for (const e of es) if (!ENEMY[e.type].noSlow) e.slow = Math.min(e.slow, S.slow);
      if (t.cd <= 0 && es.length) { t.cd = 1; for (const e of es) damage(g, e, S.tick, ev); ev.push({ type: "chime", t }); }
      continue;
    }
    const es = inRange(t, S.range).sort((a, b) => b.s - a.s);
    if (!es.length) continue;
    const tgt = es[0]; t.target = tgt; t.aim = Math.atan2(tgt.y - t.y, tgt.x - t.x);
    if (t.type === "lamp") { damage(g, tgt, 0, ev); tgt.hp -= S.dps * dt - 0; if (tgt.hp <= 0 && !tgt.dead) { tgt.dead = true; g.gold += tgt.gold; g.kills++; ev.push({ type: "kill", e: tgt }); } continue; }
    if (t.cd > 0) continue;
    if (t.type === "mortar") {
      t.cd = S.rate;
      // lead the target
      const fl = 0.9, [px, py] = pathPos(tgt.s + tgt.speed * tgt.slow * fl);
      g.shells.push({ x0: t.x, y0: t.y, x1: px, y1: py, t: 0, T: fl, dmg: S.dmg, splash: S.splash }); ev.push({ type: "fire", t });
    } else if (t.type === "tesla") {
      t.cd = S.rate; const hit = [tgt]; let cur = tgt;
      while (hit.length < S.chain) { const nx = g.enemies.filter((e) => !e.dead && !hit.includes(e) && Math.hypot(e.x - cur.x, e.y - cur.y) < 1.6).sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y))[0]; if (!nx) break; hit.push(nx); cur = nx; }
      const pts = [[t.x, t.y], ...hit.map((e) => [e.x, e.y])];
      hit.forEach((e, i) => damage(g, e, S.dmg * Math.pow(0.8, i), ev));
      g.bolts.push({ pts, life: 0.2 }); ev.push({ type: "zap", t });
    }
  }
  // lamp damage ignores armor half-way: armor reduces its dps by armor×2 per second (kept simple above), so handle golems:
  // mortar shells
  for (const s of g.shells) {
    s.t += dt;
    if (s.t >= s.T) { s.done = true; for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - s.x1, e.y - s.y1) <= s.splash) damage(g, e, s.dmg, ev); ev.push({ type: "boom", x: s.x1, y: s.y1 }); }
  }
  g.shells = g.shells.filter((s) => !s.done);
  for (const b of g.bolts) b.life -= dt; g.bolts = g.bolts.filter((b) => b.life > 0);
  g.enemies = g.enemies.filter((e) => !e.dead);
  if (g.lives <= 0) { g.lives = 0; g.lost = true; ev.push({ type: "lost" }); }
  if (g.waveActive && !g.queue.length && !g.enemies.length) {
    g.waveActive = false; g.wave++; const bonus = 20 + Math.min(40, Math.floor(g.gold * 0.15)); g.gold += bonus; ev.push({ type: "cleared", bonus });
    if (g.wave >= WAVES.length) { g.won = true; ev.push({ type: "won" }); }
  }
  return ev;
}

// heuristic builder for ?auto and tests
const COVER = (() => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buildable(x, y)) { const c = {}; for (const [k, T] of Object.entries(TOWER)) { let n = 0; for (let s = 0; s < PATH_LEN; s += 0.25) { const [px, py] = pathPos(s); if (Math.hypot(px - x, py - y) <= T.range) n++; } c[k] = n; } out.push({ x, y, c }); } return out; })();
const PLAN = ["lamp", "lamp", "bell", "mortar", "lamp", "tesla", "mortar", "bell", "tesla", "lamp", "mortar", "tesla", "lamp", "mortar", "tesla"];
export function autoBuild(g) {
  const next = PLAN[g.towers.length];
  if (next && g.gold >= TOWER[next].cost) {
    const spot = COVER.filter((s) => !g.towers.some((t) => t.x === s.x && t.y === s.y)).sort((a, b) => b.c[next] - a.c[next])[0];
    if (spot) return build(g, next, spot.x, spot.y);
  }
  // upgrade the cheapest
  const cands = g.towers.filter((t) => t.level < 3).sort((a, b) => upgradeCost(a) - upgradeCost(b));
  if (cands.length && (!next || g.towers.length >= 6) && g.gold >= upgradeCost(cands[0]) + (next ? TOWER[next].cost * 0.5 : 0)) upgrade(g, cands[0]);
  return null;
}
