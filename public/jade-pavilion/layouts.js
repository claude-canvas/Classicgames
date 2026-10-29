// Board layouts, the free-tile rule, and the solvable deal / shuffle generator.
// A layout is a list of [x, y, layer] in tile units; x/y may be .5 (half-offset tiles). Counts are always even.

import { matchClass } from "./tiles.js";

function rect(out, x0, x1, y0, y1, z, skip = () => false) {
    for (let y = y0; y <= y1 + 1e-6; y++) for (let x = x0; x <= x1 + 1e-6; x++) if (!skip(x, y)) out.push([x, y, z]);
    return out;
}

function garden() {
    const t = [];
    rect(t, 0, 6, 0, 3, 0);
    rect(t, 1, 5, 0.5, 2.5, 1);
    rect(t, 2, 4, 1, 2, 2);
    t.push([3, 1.5, 3]);
    return t;
}
function bridge() {
    const t = [];
    rect(t, 0, 11, 1, 3, 0);
    for (const x of [0, 1, 10, 11]) t.push([x, 0, 0], [x, 4, 0]);
    rect(t, 1, 10, 1.5, 2.5, 1);
    rect(t, 2, 9, 2, 2, 2);
    rect(t, 4, 7, 2, 2, 3);
    return t;
}
function pagoda() {
    const t = [];
    rect(t, 0, 9, 0, 4, 0);
    rect(t, 1, 8, 0.5, 3.5, 1);
    rect(t, 2.5, 6.5, 1, 3, 2);
    rect(t, 3.5, 5.5, 1.5, 2.5, 3);
    t.push([4.5, 2, 4]);
    return t;
}
function lotus() {
    const t = [];
    const corner = (x0, x1, y0, y1) => (x, y) => (x === x0 || x === x1) && (y === y0 || y === y1);
    rect(t, 0, 11, 0, 5, 0, corner(0, 11, 0, 5));
    rect(t, 2, 9, 0.5, 4.5, 1, corner(2, 9, 0.5, 4.5));
    rect(t, 3.5, 7.5, 1.5, 3.5, 2);
    rect(t, 4.5, 6.5, 2, 3, 3);
    t.push([5.5, 2.5, 4]);
    return t;
}
function turtle() {                                     // the classic 144-tile layout
    const t = [];
    rect(t, 1, 12, 0, 0, 0); rect(t, 3, 10, 1, 1, 0); rect(t, 2, 11, 2, 2, 0); rect(t, 1, 12, 3, 3, 0);
    rect(t, 1, 12, 4, 4, 0); rect(t, 2, 11, 5, 5, 0); rect(t, 3, 10, 6, 6, 0); rect(t, 1, 12, 7, 7, 0);
    t.push([0, 3.5, 0], [13, 3.5, 0], [14, 3.5, 0]);
    rect(t, 4, 9, 1, 6, 1);
    rect(t, 5, 8, 2, 5, 2);
    rect(t, 6, 7, 3, 4, 3);
    t.push([6.5, 3.5, 4]);
    return t;
}

export const LAYOUTS = [
    { id: "garden", name: "Garden", cn: "園", desc: "A gentle first pot of tea.", difficulty: 1, par: 180, tiles: garden() },
    { id: "bridge", name: "Moon Bridge", cn: "橋", desc: "A long, low arch over still water.", difficulty: 2, par: 270, tiles: bridge() },
    { id: "pagoda", name: "Pagoda", cn: "塔", desc: "Five storeys, every roof a puzzle.", difficulty: 3, par: 360, tiles: pagoda() },
    { id: "lotus", name: "Lotus", cn: "蓮", desc: "Rounded tiers that open like petals.", difficulty: 4, par: 450, tiles: lotus() },
    { id: "turtle", name: "Turtle", cn: "龜", desc: "The classic. All 144 tiles.", difficulty: 5, par: 540, tiles: turtle() },
];
for (const L of LAYOUTS) if (L.tiles.length % 2) throw new Error(`layout ${L.id} has an odd tile count (${L.tiles.length})`);

// ------------------------------------------------------------------ neighbours and the free rule
export function neighbours(tiles) {
    const n = tiles.length, nb = [];
    for (let i = 0; i < n; i++) {
        const [x, y, z] = tiles[i], above = [], left = [], right = [];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const [X, Y, Z] = tiles[j], dx = X - x, dy = Y - y;
            if (Z > z && Math.abs(dx) < 0.99 && Math.abs(dy) < 0.99) above.push(j);
            if (Z === z && Math.abs(dy) < 0.99) {
                if (dx > -1.01 && dx < -0.99) left.push(j);
                if (dx > 0.99 && dx < 1.01) right.push(j);
            }
        }
        nb.push({ above, left, right });
    }
    return nb;
}
export function isFree(i, nb, present) {
    const t = nb[i];
    if (t.above.some((j) => present[j])) return false;
    return !t.left.some((j) => present[j]) || !t.right.some((j) => present[j]);
}
export function freeTiles(nb, present) {
    const out = [];
    for (let i = 0; i < present.length; i++) if (present[i] && isFree(i, nb, present)) out.push(i);
    return out;
}
// every matching pair among the free tiles, grouped by match class
export function availableMatches(nb, present, faces) {
    const groups = new Map();
    for (const i of freeTiles(nb, present)) { const k = matchClass(faces[i]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    const pairs = [];
    for (const g of groups.values()) if (g.length >= 2) pairs.push([g[0], g[1]]);
    return { pairs, count: [...groups.values()].reduce((a, g) => a + Math.floor(g.length / 2), 0) };
}

// ------------------------------------------------------------------ solvable deals
// Remove random pairs of currently-free positions until the board is empty; give each removed pair one face
// pair from `pairs`. Playing those removals forward is a guaranteed solution.
export function solvableOrder(nb, present0, rng) {
    for (let attempt = 0; attempt < 400; attempt++) {
        const present = present0.slice(), order = [];
        let left = present.reduce((a, p) => a + (p ? 1 : 0), 0), ok = true;
        while (left > 0) {
            const free = freeTiles(nb, present);
            if (free.length < 2) { ok = false; break; }
            const a = free.splice(Math.floor(rng() * free.length), 1)[0];
            const b = free[Math.floor(rng() * free.length)];
            present[a] = false; present[b] = false; left -= 2;
            order.push([a, b]);
        }
        if (ok) return order;
    }
    return null;
}
export function deal(layoutTiles, nb, pairs, rng) {
    const present = layoutTiles.map(() => true);
    const order = solvableOrder(nb, present, rng);
    if (!order) throw new Error("could not build a solvable deal");
    const faces = new Array(layoutTiles.length);
    const use = pairs.slice(0, order.length);
    for (let i = use.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [use[i], use[j]] = [use[j], use[i]]; }
    order.forEach(([a, b], k) => { const p = use[k]; const s = rng() < 0.5; faces[a] = s ? p[0] : p[1]; faces[b] = s ? p[1] : p[0]; });
    return { faces, order };
}
// re-deal the tiles still on the board, keeping the same faces, so the rest is solvable again
export function reshuffle(nb, present, faces, rng) {
    const order = solvableOrder(nb, present, rng);
    if (!order) return null;
    const byClass = new Map();
    for (let i = 0; i < present.length; i++) if (present[i]) { const k = matchClass(faces[i]); if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(faces[i]); }
    const pairs = [];
    for (const list of byClass.values()) for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
    const out = faces.slice();
    order.forEach(([a, b], k) => { out[a] = pairs[k][0]; out[b] = pairs[k][1]; });
    return out;
}

export function bounds(tiles) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z1 = 0;
    for (const [x, y, z] of tiles) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
    return { x0, x1, y0, y1, z1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// small top-down SVG preview of a layout for the gallery cards
export function previewSVG(tiles) {
    const b = bounds(tiles), W = b.x1 - b.x0 + 1, H = (b.y1 - b.y0 + 1) * 1.32;
    const sorted = tiles.slice().sort((a, c) => a[2] - c[2]);
    const rects = sorted.map(([x, y, z]) => {
        const l = 0.12 + z * 0.17;
        return `<rect x="${(x - b.x0 + 0.06 - z * 0.06).toFixed(2)}" y="${((y - b.y0) * 1.32 + 0.06 - z * 0.08).toFixed(2)}" width="0.88" height="1.2" rx="0.14" fill="hsl(${150 - z * 4} 40% ${Math.round((0.32 + l) * 100)}%)" stroke="rgba(0,0,0,.35)" stroke-width="0.06"/>`;
    }).join("");
    return `<svg viewBox="-0.4 -0.6 ${W + 0.8} ${H + 1}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects}</svg>`;
}
