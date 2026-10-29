// Maps (ASCII), parsing, BFS routes from each rift to the Keep, wave scripts and SVG previews.
//   .  buildable meadow   #  road   B  bridge (road over water)   ~  water   T  tree   R  rock
//   S  spawn rift (on the road)   K  the Keep (end of the road)

export const W = 18, H = 11, CELL = 2;

export const MAPS = [
    {
        id: "amber", name: "Amber Vale", difficulty: 1, blurb: "One long switchback through the meadow.",
        rows: [
            "..T....T.....T..T.",
            "S##############...",
            "..............#..T",
            ".T............#...",
            "...############...",
            "...#.........T....",
            "...#....T.........",
            "...#############..",
            "T..............#..",
            "...............##K",
            "..T.....T.....T...",
        ],
    },
    {
        id: "river", name: "Riverbend", difficulty: 2, blurb: "The road crosses the river three times.",
        rows: [
            "T.......~~...T....",
            "........~~........",
            "S#######BB####....",
            "........~~...#....",
            ".T......~~...#..T.",
            "........~~...#....",
            "....####BB####....",
            "....#...~~....T...",
            "....#...~~........",
            "....####BB#######K",
            "..T.....~~..T.....",
        ],
    },
    {
        id: "twin", name: "Twin Gates", difficulty: 3, goldBonus: 60, blurb: "Two rifts, one road home. Split your defence.",
        rows: [
            "S#########........",
            ".........#....T...",
            ".T.#######........",
            "...#.......T...R..",
            "...##########.....",
            "............#####K",
            "...##########.....",
            "...#.......T...R..",
            ".T.#######........",
            ".........#....T...",
            "S#########........",
        ],
    },
];

export const cellX = (i) => (i - (W - 1) / 2) * CELL;
export const cellY = (j) => ((H - 1) / 2 - j) * CELL;
export const worldToCell = (x, y) => [Math.round(x / CELL + (W - 1) / 2), Math.round((H - 1) / 2 - y / CELL)];

export function parseMap(m) {
    const grid = m.rows.map((r) => r.split(""));
    if (grid.length !== H || grid.some((r) => r.length !== W)) throw new Error(`map ${m.id} must be ${W}×${H}`);
    const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? null : grid[j][i]);
    const road = (c) => c === "#" || c === "B" || c === "S" || c === "K";
    const spawns = [], keep = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (grid[j][i] === "S") spawns.push([i, j]); if (grid[j][i] === "K") keep.push(i, j); }
    // BFS from the keep over road cells, then walk downhill from each spawn
    const dist = new Map(), key = (i, j) => i + "," + j, q = [keep];
    dist.set(key(...keep), 0);
    for (let h = 0; h < q.length; h++) {
        const [i, j] = q[h];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (road(at(ni, nj)) && !dist.has(key(ni, nj))) { dist.set(key(ni, nj), dist.get(key(i, j)) + 1); q.push([ni, nj]); }
        }
    }
    const routes = spawns.map((s) => {
        const r = [s];
        let [i, j] = s;
        while (dist.get(key(i, j)) > 0) {
            const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [i + di, j + dj]).find(([a, b]) => dist.get(key(a, b)) === dist.get(key(i, j)) - 1);
            if (!next) throw new Error(`map ${m.id}: spawn not connected to keep`);
            [i, j] = next; r.push([i, j]);
        }
        // as world points, with cumulative length for walking
        const pts = r.map(([a, b]) => [cellX(a), cellY(b)]);
        const lens = [0];
        for (let k = 1; k < pts.length; k++) lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        return { cells: r, pts, lens, total: lens[lens.length - 1] };
    });
    const buildable = (i, j) => at(i, j) === ".";
    return { ...m, grid, at, spawns, keep, routes, buildable, isRoad: (i, j) => road(at(i, j)) };
}

// position + heading along a route at distance d
export function routePoint(route, d) {
    const { pts, lens, total } = route;
    d = Math.max(0, Math.min(total, d));
    let k = 1;
    while (k < lens.length - 1 && lens[k] < d) k++;
    const a = pts[k - 1], b = pts[k], seg = lens[k] - lens[k - 1] || 1, t = (d - lens[k - 1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dy: (b[1] - a[1]) / seg };
}

// 20 waves: [{ type, count, gap (s), delay (s after wave start), spawn (index or -1 = alternate) }]
export function waveScript(spawnCount) {
    const waves = [];
    for (let w = 1; w <= 20; w++) {
        const g = [];
        const alt = spawnCount > 1;
        const imps = Math.round(5 + w * 1.4);
        g.push({ type: "imp", count: w % 5 === 0 ? Math.round(imps * 1.6) : imps, gap: Math.max(0.32, 0.85 - w * 0.025) * (w % 5 === 0 ? 0.55 : 1), delay: 0 });
        if (w >= 3) g.push({ type: "brute", count: Math.floor(w / 2), gap: Math.max(0.9, 1.8 - w * 0.04), delay: 3 });
        if (w >= 4 && w % 2 === 0) g.push({ type: "wisp", count: 3 + Math.floor(w / 2), gap: 0.9, delay: 6 });
        if (w >= 6 && w % 3 === 0) g.push({ type: "slime", count: 2 + Math.floor(w / 3), gap: 1.3, delay: 8 });
        if (w >= 11 && w % 2 === 1) g.push({ type: "wisp", count: 2 + Math.floor(w / 4), gap: 0.7, delay: 11 });
        if (w === 10) g.push({ type: "golem", count: 1, gap: 1, delay: 10 });
        if (w === 15) g.push({ type: "golem", count: 1, gap: 1, delay: 12 });
        if (w === 20) g.push({ type: "golem", count: 2, gap: 9, delay: 8 }, { type: "brute", count: 6, gap: 1.2, delay: 14 });
        g.forEach((x, k) => (x.spawn = alt ? k % spawnCount : 0));
        // with two rifts the imp swarm splits between them
        if (alt) { const imp = g[0], half = Math.ceil(imp.count / 2); imp.count = half; g.push({ ...imp, spawn: 1, delay: imp.delay + 1.2 }); }
        waves.push(g);
    }
    return waves;
}

// gallery preview
export function previewSVG(m) {
    const col = { ".": "#4f6b33", "#": "#c9a066", B: "#8d6a43", "~": "#3f8fb3", T: "#d36a2a", R: "#7a7f86", S: "#a46dff", K: "#7fe9ff" };
    let s = "";
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const c = m.rows[j][i];
        const fill = col[c] || col["."];
        if (c === "T") s += `<rect x="${i}" y="${j}" width="1" height="1" fill="${col["."]}"/><circle cx="${i + 0.5}" cy="${j + 0.5}" r="0.42" fill="${fill}"/>`;
        else if (c === "S" || c === "K") s += `<rect x="${i}" y="${j}" width="1" height="1" fill="${col["#"]}"/><circle cx="${i + 0.5}" cy="${j + 0.5}" r="0.48" fill="${fill}"/>`;
        else s += `<rect x="${i}" y="${j}" width="1.02" height="1.02" fill="${fill}"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${s}</svg>`;
}
