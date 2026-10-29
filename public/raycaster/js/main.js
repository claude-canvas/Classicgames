// BLACKMOOR: LIGHTS OUT — first-person survival horror on a software raycaster. See DESIGN.md.
// This file owns the world (grid, doors, sprites, lightmap), the player, the scripted beats, checkpoints,
// input and UI. renderer.js draws, monster.js hunts, audio.js screams.

import { MAP, WALLS, DOORS, SOLID_DECOR, NOTES, OBJECTIVES, ZONES, ZONE_NAMES } from "./map.js";
import { buildTextures, scareFace } from "./textures.js";
import { Renderer, LMRES } from "./renderer.js";
import { Monster } from "./monster.js";
import { Audio } from "./audio.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

const canvas = $("view");
const assets = buildTextures();
const R = new Renderer(canvas, assets);
const audio = new Audio();
const SCARE = scareFace(512);

const DEF = { volume: 0.85, sens: 1, bright: 1, checkpoint: null };
const save = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem("blackmoor.save")) }; } catch { return { ...DEF }; } })();
const persist = () => { try { localStorage.setItem("blackmoor.save", JSON.stringify(save)); } catch { } };
audio.volume = save.volume;

// ------------------------------------------------------------------ sprites
const SP = {
    b: { h: 0.62 }, c: { h: 0.55 }, g: { h: 0.62 }, i: { h: 0.92 }, p: { h: 0.55 }, o: { h: 0.66 }, x: { h: 0.62 }, d: { h: 0.62 },
    k: { h: 0.42, emit: 1.6, halo: [1, 0.55, 0.2, 0.18], haloY: -0.1 },
    l: { h: 0.42, z: 0.58, emit: 0, lamp: true }, e: { h: 0.32, z: 0.68, emit: 1, red: true },
    F: { h: 0.42, item: "flashlight" }, "+": { h: 0.42, item: "battery" }, y: { h: 0.42, item: "yellow key" }, r: { h: 0.42, item: "red key" }, u: { h: 0.42, item: "fuse" }, n: { h: 0.42, item: "note" },
};
const LIGHT = { moon: 0, candle: 1, red: 2, lamp: 3 };
const NOTE_AT = { "11,4": 0, "17,3": 1, "31,9": 2, "36,8": 3, "18,19": 4, "12,33": 5 };

// ------------------------------------------------------------------ world
let world, player, monster, ghost;
function buildWorld() {
    const H = MAP.length, W = MAP[0].length;
    const w = { W, H, grid: MAP.map((r) => r.split("")), solidWall: new Uint8Array(W * H), decorSolid: new Uint8Array(W * H), doorAt: new Array(W * H).fill(null), doors: [], sprites: [], items: [], lights: [], floorCells: [], emit: {}, ambient: 0.02 };
    let noteN = 0, start = null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = w.grid[y][x], i = y * W + x;
        if (WALLS.includes(ch)) { w.solidWall[i] = 1; continue; }
        if (DOORS.includes(ch)) {
            const solid = (cx, cy) => WALLS.includes(MAP[cy]?.[cx]);
            const d = { x, y, kind: ch, open: 0, target: 0, locked: ch !== "D", ns: solid(x - 1, y) && solid(x + 1, y), i: w.doors.length };
            w.doors.push(d); w.doorAt[i] = d; continue;
        }
        if (ch === "@") start = { x: x + 0.5, y: y + 0.5 };
        else if (SP[ch]) {
            const def = SP[ch], s = { x: x + 0.5, y: y + 0.5, kind: ch, tex: assets.S[ch], h: def.h, z: def.z || 0, emit: def.emit ?? 0.9, halo: def.halo, haloY: def.haloY, id: w.sprites.length };
            if (def.item) { s.item = def.item; if (ch === "n") s.note = NOTE_AT[x + "," + y] ?? noteN++; w.items.push(s); s.x += (hashf(x, y) - 0.5) * 0.3; s.y += (hashf(y, x) - 0.5) * 0.3; }
            if (SOLID_DECOR.includes(ch)) w.decorSolid[i] = 1;
            if (def.lamp) { s.lamp = true; w.lights.push({ x: x + 0.5, y: y + 0.5, c: [1.0, 0.86, 0.6], r: 6.5, g: LIGHT.lamp }); }
            if (def.red) { s.red = true; w.lights.push({ x: x + 0.5, y: y + 0.5, c: [0.8, 0.06, 0.04], r: 4.8, g: LIGHT.red }); }
            if (ch === "k") w.lights.push({ x: x + 0.5, y: y + 0.5, c: [1.0, 0.52, 0.18], r: 4.6, g: LIGHT.candle });
            w.sprites.push(s);
        }
        w.grid[y][x] = ".";
    }
    // moonlight through windows
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === "w") for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || WALLS.includes(MAP[ny][nx])) continue;
        w.lights.push({ x: x + 0.5 + dx * 0.9, y: y + 0.5 + dy * 0.9, c: [0.2, 0.27, 0.48], r: 3.6, g: LIGHT.moon });
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!w.solidWall[i] && !w.doorAt[i] && !w.decorSolid[i]) w.floorCells.push([x + 0.5, y + 0.5]); }
    // floor / ceiling materials by area: flood each room (doors split rooms) and look at its walls
    const floorKey = ["lino", "tile", "wood", "concrete"], F = assets.F;
    w.floorT = new Array(W * H).fill(F.lino); w.ceilT = new Array(W * H).fill(F.ceil);
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
        if (seen[i] || w.solidWall[i]) continue;
        const q = [i], cells = [], walls = {}; seen[i] = 1;
        for (let h = 0; h < q.length; h++) {
            const c = q[h]; cells.push(c); const cx = c % W, cy = (c / W) | 0;
            if (w.doorAt[c]) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const n = ny * W + nx;
                if (w.solidWall[n]) { const ch = MAP[ny][nx]; walls[ch] = (walls[ch] || 0) + 1; continue; }
                if (!seen[n] && !w.doorAt[n]) { seen[n] = 1; q.push(n); }
            }
        }
        const best = Object.entries(walls).filter(([k]) => "#BWT".includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0] || "#";
        const ft = best === "T" ? F.tile : best === "W" ? F.wood : best === "B" ? F.concrete : F.lino;
        const ct = best === "W" ? F.ceilwood : best === "B" ? F.concrete : F.ceil;
        for (const c of cells) { w.floorT[c] = ft; w.ceilT[c] = ct; }
    }
    void floorKey;
    w.wallTex = (x, y, ch) => {
        if (ch === "G") return game && game.power ? assets.T.genOn : assets.T.gen[Math.min(3, game ? game.fusesIn : 0)];
        if (ch === "T" && hashf(x, y) < 0.22) return assets.T.Tb;
        return assets.T[ch] || assets.T["#"];
    };
    buildLightGroups(w);
    w.start = start;
    return w;
}
function hashf(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildLightGroups(w) {
    const LW = w.W * LMRES, LH = w.H * LMRES;
    w.groups = [0, 1, 2, 3].map(() => new Float32Array(LW * LH * 3));
    w.lm = new Float32Array(LW * LH * 3);
    for (const L of w.lights) {
        const G = w.groups[L.g];
        const x0 = Math.max(0, Math.floor((L.x - L.r) * LMRES)), x1 = Math.min(LW - 1, Math.ceil((L.x + L.r) * LMRES));
        const y0 = Math.max(0, Math.floor((L.y - L.r) * LMRES)), y1 = Math.min(LH - 1, Math.ceil((L.y + L.r) * LMRES));
        for (let sy = y0; sy <= y1; sy++) for (let sx = x0; sx <= x1; sx++) {
            const px = (sx + 0.5) / LMRES, py = (sy + 0.5) / LMRES;
            if (w.solidWall[(py | 0) * w.W + (px | 0)]) continue;
            const d = Math.hypot(px - L.x, py - L.y); if (d >= L.r) continue;
            // line of sight to the light
            const n = Math.ceil(d / 0.2); let ok = true;
            for (let k = 1; k < n; k++) { const qx = L.x + (px - L.x) * k / n, qy = L.y + (py - L.y) * k / n; if (w.solidWall[(qy | 0) * w.W + (qx | 0)]) { ok = false; break; } }
            if (!ok) continue;
            const a = Math.pow(1 - d / L.r, 2), o = (sy * LW + sx) * 3;
            G[o] += L.c[0] * a; G[o + 1] += L.c[1] * a; G[o + 2] += L.c[2] * a;
        }
    }
}
function combineLights(mult) {
    const w = world, lm = w.lm, G = w.groups, n = lm.length;
    const [m0, m1, m2, m3] = mult;
    const g0 = G[0], g1 = G[1], g2 = G[2], g3 = G[3];
    if (m3 > 0.001) for (let i = 0; i < n; i++) lm[i] = g0[i] * m0 + g1[i] * m1 + g2[i] * m2 + g3[i] * m3;
    else for (let i = 0; i < n; i++) lm[i] = g0[i] * m0 + g1[i] * m1 + g2[i] * m2;
}

// ------------------------------------------------------------------ game state
let state = "loading", game = null, time = 0;
function newGame(cp = null) {
    world = buildWorld();
    game = {
        phase: "dark", fusesFound: 0, fusesIn: 0, power: false, inv: { flashlight: false, yellow: false, red: false, batteries: 0 },
        flags: {}, notesRead: [], deaths: cp ? cp.deaths || 0 : 0, startTime: performance.now(), taken: [], lightning: 0, flick: 1, nextBolt: 6, nextAmb: 20,
        zone: null, shake: 0, scare: 0, chroma: 0, toastT: 0, cp: null, fakeSteps: 0, powerT: -1, escapeT: 0,
    };
    player = { x: world.start.x, y: world.start.y, ang: -Math.PI / 2 + 0.45, pitch: 0, eyeZ: 0.5, crouch: false, run: false, flash: false, battery: 1, stamina: 1, hidden: null, bob: 0, stepD: 0, flashK: 0 };
    monster = new Monster(world);
    ghost = { x: 28.5, y: 6.5, kind: "ghost", tex: assets.S.m0, h: 0.98, tint: 0.55, emit: 0.8, hidden: true, id: -1 };
    world.sprites.push(ghost);
    world.monsterSprite = { x: 0, y: 0, kind: "m", tex: assets.S.m0, h: 0.98, tint: 0.85, emit: 1, hidden: true, id: -2 };
    world.sprites.push(world.monsterSprite);
    if (cp) applyCheckpoint(cp);
    if (Q.has("bright")) world.ambient = 0.6;
}
function snapshot() {
    return {
        p: { x: player.x, y: player.y, ang: player.ang, battery: player.battery }, phase: game.phase, fusesFound: game.fusesFound, fusesIn: game.fusesIn, power: game.power,
        inv: { ...game.inv }, flags: { ...game.flags }, notesRead: [...game.notesRead], taken: [...game.taken], doors: world.doors.map((d) => [d.locked, d.target]), deaths: game.deaths,
        monster: monster.state !== "dormant" ? { x: monster.x, y: monster.y } : null, chase: monster.chaseSpeed,
    };
}
function checkpoint(label) { game.cp = snapshot(); save.checkpoint = game.cp; persist(); if (label) toast(label, 2.2); }
function applyCheckpoint(cp) {
    Object.assign(player, { x: cp.p.x, y: cp.p.y, ang: cp.p.ang, battery: Math.max(0.35, cp.p.battery) });
    Object.assign(game, { phase: cp.phase, fusesFound: cp.fusesFound, fusesIn: cp.fusesIn, power: cp.power, inv: { ...cp.inv }, flags: { ...cp.flags }, notesRead: [...cp.notesRead], taken: [...cp.taken], deaths: cp.deaths || 0 });
    for (const id of game.taken) { const s = world.sprites[id]; if (s) s.hidden = true; }
    world.items = world.items.filter((s) => !s.hidden);
    cp.doors.forEach(([locked, target], i) => { const d = world.doors[i]; d.locked = locked; d.target = target; d.open = target; });
    player.flash = game.inv.flashlight;
    if (cp.monster) {
        // she wakes somewhere away from you
        const sp = farSpawn(10); monster.spawn(sp[0], sp[1]); monster.chaseSpeed = cp.chase || 3; monster.state = "wander";
    }
    if (game.power) { audio.hum && audio.power(); }
    game.cp = cp;
}

// ------------------------------------------------------------------ helpers
function toast(t, s = 2.6) { $("toast").textContent = t; $("toast").classList.add("show"); game.toastT = s; }
function objective() {
    const g = game;
    let t;
    if (g.phase === "dark") t = OBJECTIVES.dark;
    else if (g.phase === "ward") t = g.flags.triedWard ? OBJECTIVES.ward : "Find a way out of the ward";
    else if (g.phase === "key") t = OBJECTIVES.key;
    else if (g.phase === "power") t = OBJECTIVES.power;
    else if (g.phase === "fuses") t = g.fusesFound < 3 ? OBJECTIVES.fuses(g.fusesFound, g.fusesFound - g.fusesIn) : OBJECTIVES.gen;
    else t = OBJECTIVES.escape;
    if ($("obj-t").textContent !== t) { $("obj-t").textContent = t; const o = $("objective"); o.classList.remove("new"); void o.offsetWidth; o.classList.add("new"); }
}
function inventory() {
    const i = game.inv, out = [];
    if (i.yellow) out.push('<span class="it y">WARD KEY</span>');
    if (i.red) out.push('<span class="it r">RED KEY</span>');
    const carry = game.fusesFound - game.fusesIn;
    if (carry > 0) out.push(`<span class="it u">FUSE ×${carry}</span>`);
    if (game.fusesIn > 0 && !game.power) out.push(`<span class="it">GENERATOR ${game.fusesIn}/3</span>`);
    $("inv").innerHTML = out.join("");
}
function zoneOf(x, y) { for (const [k, [x0, y0, x1, y1]] of Object.entries(ZONES)) if (x >= x0 && x <= x1 + 0.99 && y >= y0 && y <= y1 + 0.99) return k; return null; }
function solidAt(x, y) {
    const cx = x | 0, cy = y | 0; if (cx < 0 || cy < 0 || cx >= world.W || cy >= world.H) return true;
    const i = cy * world.W + cx; if (world.solidWall[i] || world.decorSolid[i]) return true;
    const d = world.doorAt[i]; return !!d && d.open < 0.85;
}
function bfsDist(sx, sy, tx, ty) {
    const W = world.W, prev = new Int32Array(W * world.H).fill(-1), s = (sy | 0) * W + (sx | 0), t = (ty | 0) * W + (tx | 0), q = [s]; prev[s] = 0;
    const dist = new Int32Array(W * world.H);
    for (let h = 0; h < q.length; h++) { const c = q[h]; if (c === t) return dist[c]; const cx = c % W, cy = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy, n = ny * W + nx; if (prev[n] !== -1 || !monster.walkable(nx, ny)) continue; prev[n] = c; dist[n] = dist[c] + 1; q.push(n); } }
    return 999;
}
const SPAWNS = [[38, 16], [8, 28], [38, 6], [38, 30], [23, 27], [22, 17], [31, 3], [31, 32]];
function farSpawn(minD) {
    let best = SPAWNS[0], bd = -1;
    for (const s of SPAWNS) { const d = bfsDist(player.x, player.y, s[0] + 0.5, s[1] + 0.5); if (d < 900 && d >= minD && (bd < 0 || d < bd)) { best = s; bd = d; } }
    if (bd < 0) for (const s of SPAWNS) { const d = bfsDist(player.x, player.y, s[0] + 0.5, s[1] + 0.5); if (d < 900 && d > bd) { best = s; bd = d; } }
    return best;
}
function relPan(x, y) { const a = Math.atan2(y - player.y, x - player.x) - player.ang; return clamp(Math.sin(a), -1, 1); }
function losFromPlayer(x, y) { const dx = x - player.x, dy = y - player.y, d = Math.hypot(dx, dy), n = Math.ceil(d / 0.2); for (let i = 1; i < n; i++) { const cx = (player.x + dx * i / n) | 0, cy = (player.y + dy * i / n) | 0, k = cy * world.W + cx; if (world.solidWall[k]) return false; const door = world.doorAt[k]; if (door && door.open < 0.6) return false; } return true; }

// callbacks used by the Matron
const G = {
    get player() { return player; }, get time() { return time; },
    onSpotted() { audio.sting(0.8); game.shake = 0.5; audio.roar(relPan(monster.x, monster.y), 0.6); },
    caught() { if (Q.has("god") || state !== "play") return; die(); },
    doorSound(d, byMonster) { const dist = Math.hypot(d.x + 0.5 - player.x, d.y + 0.5 - player.y); audio.creak(relPan(d.x + 0.5, d.y + 0.5), clamp(1 - dist / 22, 0, 1), losFromPlayer(d.x + 0.5, d.y + 0.5) ? 0 : 1); },
    monsterSound(kind) {
        const d = Math.hypot(monster.x - player.x, monster.y - player.y), v = clamp(1 - d / 22, 0, 1) ** 1.5, m = losFromPlayer(monster.x, monster.y) ? 0 : 0.8;
        if (kind === "step") audio.monsterStep(relPan(monster.x, monster.y), v, m); else audio.breath(relPan(monster.x, monster.y), v * 0.8, m);
    },
};

// ------------------------------------------------------------------ interaction
let focus = null;
function findFocus() {
    if (player.hidden) return { type: "unhide" };
    let best = null, bd = 1.5;
    for (const s of world.items) {
        if (s.hidden) continue;
        const dx = s.x - player.x, dy = s.y - player.y, d = Math.hypot(dx, dy);
        if (d > 1.5) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - player.ang), Math.cos(Math.atan2(dy, dx) - player.ang)));
        if (da > 0.55 && d > 0.6) continue;
        if (d < bd) { bd = d; best = { type: "item", s }; }
    }
    if (best) return best;
    const dx = Math.cos(player.ang), dy = Math.sin(player.ang);
    for (let t = 0.2; t < 1.6; t += 0.05) {
        const x = player.x + dx * t, y = player.y + dy * t, cx = x | 0, cy = y | 0, i = cy * world.W + cx;
        const d = world.doorAt[i]; if (d) return { type: "door", d };
        if (world.solidWall[i]) { const ch = MAP[cy][cx]; if (ch === "L") return { type: "locker", cx, cy }; if (ch === "G") return { type: "gen" }; return null; }
    }
    return null;
}
function promptText(f) {
    if (!f) return "";
    if (f.type === "unhide") return "<b>[E]</b> Leave the locker";
    if (f.type === "item") return `<b>[E]</b> ${f.s.item === "note" ? "Read the note" : "Take the " + f.s.item}`;
    if (f.type === "locker") return "<b>[E]</b> Hide in the locker";
    if (f.type === "gen") { const carry = game.fusesFound - game.fusesIn; return game.power ? "The generator roars" : carry > 0 ? "<b>[E]</b> Insert a fuse" : `Generator — ${game.fusesIn}/3 fuses`; }
    if (f.type === "door") {
        const d = f.d;
        if (d.kind === "E") return d.locked ? "The main gate. Electric lock — no power." : "";
        if (d.locked) return d.kind === "Y" ? (game.inv.yellow ? "<b>[E]</b> Unlock with the ward key" : "Locked. Needs the ward key.") : (game.inv.red ? "<b>[E]</b> Unlock with the red key" : "Locked. A red key card is needed.");
        return d.target > 0.5 ? "<b>[E]</b> Close the door" : "<b>[E]</b> Open the door";
    }
    return "";
}
function interact() {
    const f = focus; if (!f) return;
    if (f.type === "unhide") { unhide(); return; }
    if (f.type === "item") { take(f.s); return; }
    if (f.type === "locker") { hide(f.cx, f.cy); return; }
    if (f.type === "gen") {
        if (game.power) return;
        if (game.fusesFound - game.fusesIn > 0) {
            game.fusesIn++; audio.clank(); monster.hear(player.x, player.y, 30); game.shake = 0.2; inventory(); objective();
            if (game.fusesIn >= 3) startPower(); else toast(`Fuse ${game.fusesIn}/3 seated. The clank echoes through the building.`);
        } else toast(game.fusesIn ? "It needs more fuses." : "Three empty fuse slots.");
        return;
    }
    if (f.type === "door") {
        const d = f.d;
        if (d.kind === "E") { if (d.locked) { audio.locked(); if (game.phase === "power") { game.phase = "fuses"; objective(); } toast("The gate is electric. No power, no way out."); } return; }
        if (d.locked) {
            const has = d.kind === "Y" ? game.inv.yellow : game.inv.red;
            if (!has) { audio.locked(); if (d.kind === "Y" && !game.flags.triedWard) { game.flags.triedWard = true; objective(); } toast(d.kind === "Y" ? "The ward door is locked." : "Locked. SURGERY — staff only."); return; }
            d.locked = false; audio.keys();
        }
        d.target = d.target > 0.5 ? 0 : 1;
        G.doorSound(d); monster.hear(d.x + 0.5, d.y + 0.5, 7);
        if (d.target === 0) audio.slam(0, 0.25, 0);
    }
}
function take(s) {
    s.hidden = true; world.items = world.items.filter((o) => o !== s); game.taken.push(s.id);
    const k = s.kind;
    if (k === "n") { audio.paper(); openNote(s.note); return; }
    audio.pickup();
    if (k === "F") {
        game.inv.flashlight = true; player.flash = true; game.phase = "ward"; audio.click();
        toast("A flashlight. [F] to switch it on and off. The batteries won't last forever.", 4);
        checkpoint();
        setTimeout(() => { if (state === "play") { audio.slam(-0.6, 0.9, 0.5); audio.sting(0.45); toast("…a door slammed somewhere in the ward.", 3); } }, 4200);
    } else if (k === "+") { player.battery = Math.min(1, player.battery + 0.5); toast("Batteries. The light steadies."); }
    else if (k === "y") {
        game.inv.yellow = true; game.phase = "key"; audio.keys(); toast("The ward key.");
        checkpoint();
        // first scare: the lights die, whispers, she is standing at the end of the corridor
        game.flags.ghost = true; ghost.hidden = false; game.ghostT = 0; game.flick = 0;
        setTimeout(() => audio.whisper(0.5, 0.9), 600);
        setTimeout(() => { audio.sting(0.6); }, 1500);
    } else if (k === "r") { game.inv.red = true; audio.keys(); toast("A red key card. SURGERY."); checkpoint(); }
    else if (k === "u") {
        game.fusesFound++; if (game.phase === "power" || game.phase === "key") game.phase = "fuses";
        audio.clank();
        if (game.fusesFound === 1) wakeMatron();
        else { monster.chaseSpeed += 0.25; monster.speed += 0.1; toast(`Fuse ${game.fusesFound}/3.`); setTimeout(() => audio.roar(relPan(monster.x, monster.y), 0.5, 0.6), 1500); }
        checkpoint();
    }
    inventory(); objective();
}
function wakeMatron() {
    toast("Something below you screams.", 3.5);
    game.shake = 1.2; audio.roar(0.3, 1, 0.5); setTimeout(() => audio.sting(1), 300);
    const sp = farSpawn(14); monster.spawn(sp[0], sp[1]); monster.hear(player.x, player.y, 999);
}
function startPower() {
    game.powerT = 0; audio.power(); toast("The generator coughs… and catches.", 3);
    setTimeout(() => {
        game.power = true; game.phase = "escape";
        const gate = world.doors.find((d) => d.kind === "E"); gate.locked = false; gate.target = 1;
        for (const s of world.sprites) if (s.lamp) { s.emit = 1.8; s.halo = [1, 0.85, 0.55, 0.12]; }
        if (monster.state === "dormant") { const sp = farSpawn(12); monster.spawn(sp[0], sp[1]); }
        monster.state = "chase"; monster.lastSeen = [player.x, player.y]; monster.relentless = 14; monster.chaseSpeed = 3.55;
        audio.roar(relPan(monster.x, monster.y), 1, 0.3); audio.sting(1); game.shake = 1;
        toast("The gate is open. RUN.", 3); objective(); checkpoint();
    }, 2600);
}
function hide(cx, cy) {
    player.hidden = { cx, cy, x: player.x, y: player.y, ang: player.ang };
    // face out of the locker
    let bx = player.x, by = player.y; const fx = cx + 0.5, fy = cy + 0.5;
    player.ang = Math.atan2(by - fy, bx - fx);
    player.x = fx + Math.cos(player.ang) * 0.62; player.y = fy + Math.sin(player.ang) * 0.62;
    player.flashWas = player.flash; player.flash = false;
    if (monster.sees) monster.seenEnter = time;
    audio.lockerIn(); $("vents").classList.remove("hidden");
}
function unhide() {
    const h = player.hidden; player.hidden = null; player.flash = player.flashWas && player.battery > 0;
    audio.lockerIn(); $("vents").classList.add("hidden");
    void h;
}
function openNote(i) {
    state = "note"; document.exitPointerLock?.();
    $("note-t").textContent = NOTES[i].title; $("note-b").textContent = NOTES[i].text; $("note").classList.remove("hidden");
    if (!game.notesRead.includes(i)) game.notesRead.push(i);
    if (i === 2 && (game.phase === "power" || game.phase === "key")) { game.phase = "fuses"; objective(); }
}
function closeNote() { $("note").classList.add("hidden"); state = "play"; lockPointer(); objective(); }

// ------------------------------------------------------------------ death / win
function die() {
    state = "scare"; game.deaths++; document.exitPointerLock?.();
    const sc = $("scare"); sc.innerHTML = ""; sc.appendChild(SCARE); sc.classList.remove("hidden");
    audio.scream(); audio.hb = 0; audio.dread = 0;
    setTimeout(() => {
        sc.classList.add("hidden");
        state = "dead";
        $("death-p").textContent = ["The Matron does not let her patients leave.", "She counts you. One more.", "Keep your light low. She likes the light.", "She heard you run.", "Lockers. She can't see you in the lockers."][game.deaths % 5];
        $("death").classList.remove("hidden"); $("hud").classList.add("hidden"); $("vents").classList.add("hidden");
    }, 1500);
}
function win() {
    state = "won"; document.exitPointerLock?.(); audio.win();
    const t = (performance.now() - game.startTime) / 1000;
    $("won-p").innerHTML = `The rain on your face has never felt so good.<br>Behind you, in the dark doorway, something stands very still and watches you go.<br><br>Time ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} · deaths ${game.deaths} · notes ${game.notesRead.length}/6`;
    $("won").classList.remove("hidden"); $("hud").classList.add("hidden");
    save.checkpoint = null; persist();
}

// ------------------------------------------------------------------ input
const keys = new Set();
let mouseDX = 0, mouseDY = 0, locked = false;
const touch = { move: null, look: null, run: false };
addEventListener("keydown", (e) => {
    audio.init();
    keys.add(e.code);
    if (state === "note" && (e.code === "KeyE" || e.code === "Escape" || e.code === "Space")) { closeNote(); e.preventDefault(); return; }
    if (state !== "play") return;
    if (e.code === "KeyE") interact();
    if (e.code === "KeyF") toggleFlash();
    if (e.code === "KeyC") player.crouch = !player.crouch;
    if (e.code === "Escape" || e.code === "KeyP") pause();
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
function toggleFlash() { if (!game.inv.flashlight || player.hidden) return; if (player.battery <= 0) { audio.click(); toast("The batteries are dead."); return; } player.flash = !player.flash; audio.click(); }
function lockPointer() { if (!coarse && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch { } }
canvas.addEventListener("click", () => { audio.init(); if (state === "play" && !locked) lockPointer(); });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === canvas; if (!locked && state === "play" && !coarse) pause(); });
addEventListener("mousemove", (e) => { if (locked) { mouseDX += e.movementX; mouseDY += e.movementY; } });
const coarse = matchMedia("(pointer: coarse)").matches;
// touch: left half = move stick, right half = look
addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || state !== "play" || e.target.closest(".tb")) return;
    audio.init();
    if (e.clientX < innerWidth * 0.45 && !touch.move) { touch.move = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; const s = $("stick"); s.classList.remove("hidden"); s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px"; }
    else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener("pointermove", (e) => {
    if (touch.move && e.pointerId === touch.move.id) { touch.move.x = e.clientX; touch.move.y = e.clientY; const dx = clamp(e.clientX - touch.move.x0, -50, 50), dy = clamp(e.clientY - touch.move.y0, -50, 50); $("stick-dot").style.transform = `translate(${dx}px,${dy}px)`; }
    if (touch.look && e.pointerId === touch.look.id) { mouseDX += (e.clientX - touch.look.x) * 2.2; mouseDY += (e.clientY - touch.look.y) * 2.2; touch.look.x = e.clientX; touch.look.y = e.clientY; }
});
const endTouch = (e) => { if (touch.move && e.pointerId === touch.move.id) { touch.move = null; $("stick").classList.add("hidden"); } if (touch.look && e.pointerId === touch.look.id) touch.look = null; };
addEventListener("pointerup", endTouch); addEventListener("pointercancel", endTouch);
$("t-use").addEventListener("pointerdown", (e) => { e.preventDefault(); audio.init(); if (state === "note") closeNote(); else if (state === "play") interact(); });
$("t-light").addEventListener("pointerdown", (e) => { e.preventDefault(); if (state === "play") toggleFlash(); });
$("t-run").addEventListener("pointerdown", (e) => { e.preventDefault(); touch.run = !touch.run; $("t-run").classList.toggle("on", touch.run); });
$("t-crouch").addEventListener("pointerdown", (e) => { e.preventDefault(); if (state === "play") { player.crouch = !player.crouch; $("t-crouch").classList.toggle("on", player.crouch); } });
$("t-pause").addEventListener("pointerdown", (e) => { e.preventDefault(); pause(); });
$("note").addEventListener("pointerdown", () => { if (state === "note") closeNote(); });

// ------------------------------------------------------------------ update
function update(dt) {
    time += dt;
    const p = player, g = game;
    // look
    const sens = 0.0024 * save.sens;
    p.ang += mouseDX * sens; p.pitch = clamp(p.pitch - mouseDY * sens * 0.55, -0.32, 0.32); mouseDX = 0; mouseDY = 0;
    if (keys.has("ArrowLeft")) p.ang -= dt * 2.2; if (keys.has("ArrowRight")) p.ang += dt * 2.2;
    // move
    let fx = 0, fy = 0;
    if (!p.hidden) {
        if (keys.has("KeyW") || keys.has("ArrowUp")) fy += 1; if (keys.has("KeyS") || keys.has("ArrowDown")) fy -= 1;
        if (keys.has("KeyD")) fx += 1; if (keys.has("KeyA")) fx -= 1;
        if (touch.move) { fx += clamp((touch.move.x - touch.move.x0) / 50, -1, 1); fy -= clamp((touch.move.y - touch.move.y0) / 50, -1, 1); }
    }
    const l = Math.hypot(fx, fy); if (l > 1) { fx /= l; fy /= l; }
    const wantRun = (keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.run) && fy > 0.2 && !p.crouch;
    p.run = wantRun && p.stamina > 0.02;
    const speed = p.crouch ? 1.2 : p.run ? 4.0 : 2.4;
    p.stamina = clamp(p.stamina + (p.run ? -dt / 4 : dt / 7), 0, 1);
    if (p.stamina <= 0.02 && wantRun && !g.flags.winded) { g.flags.winded = true; setTimeout(() => (g.flags.winded = false), 1500); }
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    const vx = (ca * fy - sa * fx) * speed * dt, vy = (sa * fy + ca * fx) * speed * dt;
    const r = 0.22;
    const free = (x, y) => !solidAt(x - r, y - r) && !solidAt(x + r, y - r) && !solidAt(x - r, y + r) && !solidAt(x + r, y + r);
    if (free(p.x + vx, p.y)) p.x += vx; if (free(p.x, p.y + vy)) p.y += vy;
    const moved = Math.hypot(vx, vy);
    p.bob += moved * 7; p.stepD += moved;
    if (p.stepD > (p.run ? 0.95 : 0.75)) {
        p.stepD = 0;
        const ft = world.floorT[(p.y | 0) * world.W + (p.x | 0)], surf = ft === assets.F.tile ? "tile" : ft === assets.F.wood ? "wood" : ft === assets.F.concrete ? "concrete" : "lino";
        audio.step(surf, p.crouch ? 0.35 : p.run ? 1.3 : 0.8);
        monster.hear(p.x, p.y, p.crouch ? 0 : p.run ? 11 : 4);
    }
    const crouchZ = p.crouch ? 0.3 : 0.5;
    p.eyeZ += (crouchZ + Math.sin(p.bob) * (p.run ? 0.018 : 0.011) - p.eyeZ) * Math.min(1, dt * 12);
    // flashlight
    if (p.flash) { p.battery = Math.max(0, p.battery - dt / 160); if (p.battery <= 0) { p.flash = false; audio.click(); toast("The flashlight dies.", 2.5); } }
    let k = p.flash ? 1 : 0;
    if (p.flash && p.battery < 0.15) { k *= 0.55 + 0.45 * (Math.random() < 0.08 ? 0 : 1); if (Math.random() < 0.004) audio.lowBattery(); }
    const md = monster.state !== "dormant" ? Math.hypot(monster.x - p.x, monster.y - p.y) : 99;
    if (p.flash && md < 8 && Math.random() < (8 - md) / 22) k *= 0.15;     // she makes the light stutter
    p.flashK += (k - p.flashK) * Math.min(1, dt * 25);
    // doors
    for (const d of world.doors) { const s = d.kind === "E" ? 0.35 : 1.8; d.open += clamp(d.target - d.open, -s * dt, s * dt); }
    // monster
    if (state === "play") monster.update(dt, G);
    // ---- scripted beats
    const z = zoneOf(p.x, p.y);
    if (z !== g.zone) { g.zone = z; if (z && !g.flags["z_" + z]) { g.flags["z_" + z] = true; showZone(ZONE_NAMES[z]); onEnterZone(z); } }
    if (g.flags.ghost && !ghost.hidden) {
        g.ghostT += dt;
        g.flick = g.ghostT < 2.5 ? (Math.random() < 0.5 ? 0.1 : 0.6) : 1;
        const gd = Math.hypot(ghost.x - p.x, ghost.y - p.y), ga = Math.abs(Math.atan2(Math.sin(Math.atan2(ghost.y - p.y, ghost.x - p.x) - p.ang), Math.cos(Math.atan2(ghost.y - p.y, ghost.x - p.x) - p.ang)));
        if (g.ghostT > 1 && ((p.flashK > 0.5 && ga < 0.12 && gd < 18) || gd < 4.5 || g.ghostT > 14)) {
            ghost.hidden = true; g.flick = 0.05; g.shake = 0.6; g.chroma = 0.6; audio.sting(1); audio.whisper(relPan(ghost.x, ghost.y), 1);
            setTimeout(() => (game.flick = 1), 400);
        }
    } else if (!g.power) g.flick += (1 - g.flick) * Math.min(1, dt * 3);
    // lightning
    g.nextBolt -= dt;
    if (g.nextBolt <= 0) { g.nextBolt = 12 + Math.random() * 26; g.lightning = 1; setTimeout(() => (game.lightning = 0.8), 140); setTimeout(() => audio.thunder(0.6 + Math.random() * 0.4), 300 + Math.random() * 1500); }
    g.lightning = Math.max(0, g.lightning - dt * 3.2);
    // ambient scares
    g.nextAmb -= dt;
    if (g.nextAmb <= 0 && monster.state !== "chase") {
        g.nextAmb = 22 + Math.random() * 35;
        const r2 = Math.random(), pan = (Math.random() - 0.5) * 1.6;
        if (r2 < 0.25) audio.whisper(pan, 0.7);
        else if (r2 < 0.45) audio.knock(pan, 0.6);
        else if (r2 < 0.6) audio.crying(pan, 0.5);
        else if (r2 < 0.8) audio.creak(pan, 0.4, 1);
        else if (monster.state === "dormant" && g.phase !== "dark") { g.fakeSteps = 4; g.fakeT = 0; }
        else audio.slam(pan, 0.4, 0.8);
    }
    if (g.fakeSteps > 0) { g.fakeT -= dt; if (g.fakeT <= 0) { g.fakeT = 0.55; g.fakeSteps--; audio.monsterStep(-Math.sin(0) * 0.1, 0.35, 0.5); } }
    // danger feedback
    const chase = monster.state === "chase";
    audio.hb = monster.state === "dormant" ? (g.flags.ghost && !ghost.hidden ? 0.5 : 0) : clamp((1 - md / 15) * (chase ? 1.3 : 0.9), 0, 1);
    audio.dread = clamp(audio.hb * 0.9 + (g.phase === "escape" ? 0.4 : g.phase === "fuses" ? 0.15 : 0), 0, 1);
    g.shake = Math.max(0, g.shake - dt * 1.5); g.chroma = Math.max(0, g.chroma - dt * 1.2);
    if (g.toastT > 0) { g.toastT -= dt; if (g.toastT <= 0) $("toast").classList.remove("show"); }
    if (g.zoneT > 0) { g.zoneT -= dt; if (g.zoneT <= 0) $("zone").classList.remove("show"); }
    // escape
    if (g.power && p.y > 34.25) win();
    // UI
    focus = findFocus();
    const pt = promptText(focus);
    const pe = $("prompt"); if (pt) { if (pe.innerHTML !== pt) pe.innerHTML = pt; pe.classList.remove("hidden"); } else pe.classList.add("hidden");
    $("bat").style.setProperty("--v", `${p.battery * 100}%`); $("bar-bat").classList.toggle("low", p.battery < 0.15); $("bar-bat").classList.toggle("hidden", !g.inv.flashlight);
    $("sta").style.setProperty("--v", `${p.stamina * 100}%`); $("bar-sta").classList.toggle("low", p.stamina < 0.2);
}
function showZone(name) { $("zone").textContent = name; $("zone").classList.add("show"); game.zoneT = 2.6; }
function onEnterZone(z) {
    const g = game;
    if (z === "hub" && (g.phase === "key" || g.phase === "ward")) {
        g.phase = "power"; objective(); checkpoint();
        setTimeout(() => audio.crying(-0.7, 0.8), 1500);
    }
    if (z === "chapel") { audio.whisper(0.2, 0.9); toast("The candles are lit. Who lit them?", 3); }
    if (z === "morgue") { audio.knock(0.4, 0.9, 4); setTimeout(() => toast("Something knocked from inside a drawer.", 3), 900); }
    if (z === "surgery") { game.flick = 0.2; audio.sting(0.5); }
    if (z === "boiler" && !g.power) toast("The backup generator. Three fuse slots, all empty.", 3.2);
    if (z === "lobby" && g.phase === "power") { g.phase = "fuses"; objective(); toast("The main gate is shut. Its lock needs power.", 3.2); }
}

// ------------------------------------------------------------------ render
function frame(dt) {
    const p = player, g = game;
    // lights: moon (+lightning), candles, red emergency, lamps (power)
    const fl = g.flick, t = time;
    const candle = (0.85 + Math.sin(t * 11) * 0.07 + Math.sin(t * 23.7) * 0.05) * fl;
    const red = (g.power ? 1.2 + Math.sin(t * 4.2) * 0.6 : (Math.random() < 0.03 ? 0.2 : 0.75 + Math.sin(t * 2.1) * 0.08)) * fl;
    const lamp = g.power ? (Math.random() < 0.02 ? 0.3 : 0.95) * fl : 0;
    combineLights([(1 + g.lightning * 9) * fl * (g.power ? 1 : 1), candle, red, lamp]);
    world.ambient = (Q.has("bright") ? 0.6 : 0.016 + g.lightning * 0.05) * save.bright;
    world.emit = { w: 0.25 + g.lightning * 3, G: g.power ? 1.5 : 0.35, E: 0.35 + g.lightning, Y: 0.8, R: 0.8 };
    for (const s of world.sprites) if (s.red) s.emit = red * 1.4;
    // the Matron's sprite
    const ms = world.monsterSprite;
    if (monster.state !== "dormant") {
        ms.hidden = false; ms.x = monster.x; ms.y = monster.y;
        const md = Math.hypot(monster.x - p.x, monster.y - p.y);
        ms.tex = monster.state === "chase" && md < 2.6 ? assets.S.m2 : (Math.floor(monster.anim) % 2 ? assets.S.m1 : assets.S.m0);
    } else ms.hidden = true;
    const sx = Math.sin(p.bob * 0.5) * 0.012 + (Math.random() - 0.5) * g.shake * 0.01, sy = Math.abs(Math.cos(p.bob * 0.5)) * 0.01;
    const cam = { x: p.x, y: p.y, ang: p.ang + (Math.random() - 0.5) * g.shake * 0.02, pitch: -p.pitch + (Math.random() - 0.5) * g.shake * 0.02, eyeZ: p.eyeZ };
    const danger = monster.state === "chase" ? clamp(1 - Math.hypot(monster.x - p.x, monster.y - p.y) / 10, 0, 1) : 0;
    R.render(world, cam, { flash: { on: p.flashK > 0.01, k: p.flashK * (0.4 + 0.6 * Math.min(1, p.battery * 4)), sx, sy }, grain: 0.07 + danger * 0.05, red: danger * 0.45 + (g.lightning > 0.6 ? 0 : 0), chroma: g.chroma > 0.05 || danger > 0.6 ? 2 : 0, flicker: 1 });
    $("shake").style.transform = g.shake > 0.01 ? `translate(${(Math.random() - 0.5) * g.shake * 14}px, ${(Math.random() - 0.5) * g.shake * 14}px)` : "";
}
function titleFrame(dt) {
    // slow look down the main hall; lightning shows her standing at the far end
    time += dt;
    const g = game;
    g.nextBolt -= dt;
    if (g.nextBolt <= 0) { g.nextBolt = 5 + Math.random() * 8; g.lightning = 1; setTimeout(() => (game.lightning = 0.9), 120); if (audio.ctx) setTimeout(() => audio.thunder(0.5), 600); }
    g.lightning = Math.max(0, g.lightning - dt * 2.5);
    const ms = world.monsterSprite; ms.hidden = g.lightning < 0.3; ms.x = 31.5; ms.y = 9.5; ms.tex = assets.S.m0;
    player.x = 31.5; player.y = 31.5; player.ang = -Math.PI / 2 + Math.sin(time * 0.15) * 0.18; player.pitch = 0; player.eyeZ = 0.5;
    combineLights([1 + g.lightning * 14, 0.8, 0.8 + Math.sin(time * 2) * 0.1, 0]);
    world.ambient = 0.012 + g.lightning * 0.12; world.emit = { w: 0.25 + g.lightning * 3, G: 0.3, E: 0.4, Y: 0.8, R: 0.8 };
    R.render(world, { x: player.x, y: player.y, ang: player.ang, pitch: 0, eyeZ: 0.5 }, { flash: { on: false, k: 0, sx: 0, sy: 0 }, grain: 0.09, red: 0, chroma: g.lightning > 0.5 ? 2 : 0 });
}

// ------------------------------------------------------------------ screens
function show(id) { for (const s of ["title", "hud", "death", "won", "pause", "settings"]) $(s).classList.toggle("hidden", s !== id && !(id === "play" && s === "hud")); $("touch").classList.toggle("hidden", !(coarse && id === "play")); }
function startPlay(cp) {
    newGame(cp);
    show("play"); state = "play"; lockPointer();
    inventory(); objective(); checkpoint();
    if (!cp) {
        state = "intro"; const intro = $("intro"); intro.classList.remove("hidden", "out");
        const ps = [...intro.querySelectorAll("p")]; ps.forEach((p) => p.classList.remove("on"));
        ps.forEach((p, i) => setTimeout(() => p.classList.add("on"), 400 + i * 1500));
        setTimeout(() => { intro.classList.add("out"); state = "play"; audio.thunder(1); game.lightning = 1; }, 400 + ps.length * 1500 + 600);
        setTimeout(() => intro.classList.add("hidden"), 400 + ps.length * 1500 + 2700);
    }
}
function pause() { if (state !== "play") return; state = "paused"; document.exitPointerLock?.(); $("pause").classList.remove("hidden"); }
function resume() { $("pause").classList.add("hidden"); state = "play"; lockPointer(); }
function toTitle() { state = "title"; for (const s of ["death", "won", "pause", "settings", "hud", "note", "vents"]) $(s).classList.add("hidden"); newGame(); game.nextBolt = 1.5; show("title"); $("b-cont").disabled = !save.checkpoint; audio.hb = 0; audio.dread = 0.1; }
let settingsFrom = "title";
function openSettings(from) { settingsFrom = from; $("settings").classList.remove("hidden"); $("s-vol").value = save.volume * 100; $("s-sens").value = save.sens * 100; $("s-bri").value = save.bright * 100; }
$("b-new").addEventListener("click", () => { audio.init(); save.checkpoint = null; persist(); startPlay(null); });
$("b-cont").addEventListener("click", () => { audio.init(); if (save.checkpoint) startPlay(save.checkpoint); });
$("b-set").addEventListener("click", () => openSettings("title"));
$("p-resume").addEventListener("click", resume);
$("p-set").addEventListener("click", () => openSettings("pause"));
$("p-cp").addEventListener("click", () => { $("pause").classList.add("hidden"); startPlay(game.cp); });
$("p-title").addEventListener("click", toTitle);
$("d-retry").addEventListener("click", () => { $("death").classList.add("hidden"); const cp = { ...game.cp, deaths: game.deaths }; startPlay(cp); });
$("d-title").addEventListener("click", toTitle);
$("w-title").addEventListener("click", toTitle);
$("s-back").addEventListener("click", () => $("settings").classList.add("hidden"));
$("s-vol").addEventListener("input", (e) => { save.volume = e.target.value / 100; audio.init(); audio.setVolume(save.volume); persist(); });
$("s-sens").addEventListener("input", (e) => { save.sens = e.target.value / 100; persist(); });
$("s-bri").addEventListener("input", (e) => { save.bright = e.target.value / 100; persist(); });
if (coarse) $("t-warn").innerHTML = "Headphones recommended. Play in the dark.<br>Left thumb moves · right thumb looks · E to use";

// ------------------------------------------------------------------ loop
// internal resolution adapts to the device: drop a step when frames are slow, climb back when there is room
const RES = [480, 420, 360, 320, 270];
let resI = 0, perfT = 0;
function sizeView() {
    const aspect = innerWidth / innerHeight, W = Math.round(RES[resI] * (aspect >= 1 ? 1 : 0.62));
    R.resize(W, Math.round(W / aspect));
}
function adaptRes(dt) {
    perfT += dt;
    if (perfT < 2) return;
    perfT = 0;
    if (jsMs > 13 && resI < RES.length - 1) { resI++; sizeView(); }
    else if (jsMs < 6 && resI > 0) { resI--; sizeView(); }
}
// film grain: a tiny noise canvas repainted a few times a second, blended over everything by CSS
const grainCv = $("grain"), grainCtx = grainCv.getContext("2d"), grainImg = grainCtx.createImageData(160, 90);
let grainT = 0;
function paintGrain(dt) {
    grainT -= dt; if (grainT > 0) return; grainT = 0.07;
    const d = grainImg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    grainCtx.putImageData(grainImg, 0, 0);
}
addEventListener("resize", sizeView);
window.__horror = () => ({ state, phase: game && game.phase, p: player && [+player.x.toFixed(2), +player.y.toFixed(2), +player.ang.toFixed(2)], monster: monster && [monster.state, +monster.x.toFixed(1), +monster.y.toFixed(1)], fuses: game && [game.fusesFound, game.fusesIn], power: game && game.power, fps, ms: +jsMs.toFixed(1) });
if (Q.has("debug")) window.__dbg = () => ({ R, combineLights, frame, update, monster, player, world, game, G, interact, findFocus, setFocus: (f) => (focus = f), objText: () => $("obj-t").textContent, state: () => state });
let last = performance.now(), fps = 0, fN = 0, fT = 0, jsMs = 0;
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fN++; fT += dt; if (fT > 1) { fps = Math.round(fN / fT); fN = 0; fT = 0; }
    const j0 = performance.now();
    if (state === "play") { update(dt); frame(dt); }
    else if (state === "title" || state === "loading") titleFrame(dt);
    else if (state === "intro" || state === "note" || state === "paused" || state === "scare" || state === "dead") frame(0);
    jsMs = jsMs * 0.9 + (performance.now() - j0) * 0.1;
    if (state === "play") adaptRes(dt);
    paintGrain(dt);
    requestAnimationFrame(loop);
}
sizeView();
newGame(); game.nextBolt = 1.5;
state = "title"; show("title"); $("b-cont").disabled = !save.checkpoint;
requestAnimationFrame(loop);
// debug: ?skip=1 (hub with the ward key) · ?skip=2 (three fuses, at the boiler room) · ?skip=3 (power on)
if (Q.has("skip") || Q.has("play")) {
    const k = +Q.get("skip") || 0;
    startPlay(null); $("intro").classList.add("hidden"); state = "play";
    if (k >= 1) { Object.assign(game.inv, { flashlight: true, yellow: true }); player.flash = true; world.doors.find((d) => d.kind === "Y").locked = false; player.x = 31.5; player.y = 6.5; player.ang = Math.PI / 2; game.phase = "fuses"; for (const s of world.items) if (s.kind === "F" || s.kind === "y") { s.hidden = true; } }
    if (k >= 2) { game.fusesFound = 3; game.inv.red = true; player.x = 32.5; player.y = 16.5; player.ang = 0; const sp = farSpawn(12); monster.spawn(sp[0], sp[1]); for (const s of world.items) if (s.kind === "u") s.hidden = true; }
    if (k >= 3) { game.fusesIn = 3; startPower(); }
    world.items = world.items.filter((s) => !s.hidden);
    inventory(); objective();
}
