// Gemfall rules — pure logic, no rendering. Every action resolves instantly and returns a list of steps
// (swap, clear, fall, …) that main.js replays as animation. Rows count from the top (r = 0).
//
// gem = { id, color: 0..5 (-1 for a prism), special: null | "row" | "col" | "bomb" | "prism" }

let nextId = 1;
const key = (r, c) => r * 16 + c;

export class Board {
    constructor(level, rng) {
        this.rng = rng;
        this.rows = level.mask.length; this.cols = level.mask[0].length;
        this.mask = level.mask.map((row) => row.split("").map((ch) => ch !== " "));
        this.frost = level.mask.map((row) => row.split("").map((ch) => (ch === "2" ? 2 : ch === "1" ? 1 : 0)));
        this.colors = level.colors;
        this.cells = this.mask.map((row) => row.map(() => null));
        // per column: first and last playable row (playable cells in a column are contiguous)
        this.top = []; this.bot = [];
        for (let c = 0; c < this.cols; c++) {
            let t = -1, b = -1;
            for (let r = 0; r < this.rows; r++) if (this.mask[r][c]) { if (t < 0) t = r; b = r; }
            this.top.push(t); this.bot.push(b);
        }
        this.score = 0; this.collected = [0, 0, 0, 0, 0, 0];
        this.fill();
    }

    // ------------------------------------------------------------------ helpers
    ok(r, c) { return r >= 0 && c >= 0 && r < this.rows && c < this.cols && this.mask[r][c]; }
    gem(r, c) { return this.ok(r, c) ? this.cells[r][c] : null; }
    newGem(color = Math.floor(this.rng() * this.colors), special = null) { return { id: nextId++, color, special }; }
    frostLeft() { let n = 0; for (const row of this.frost) for (const f of row) n += f; return n; }
    each(fn) { for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.mask[r][c]) fn(r, c); }

    fill() {                                  // a starting board with no matches and at least one move
        for (let tries = 0; tries < 200; tries++) {
            this.each((r, c) => {
                let col, n = 0;
                do { col = Math.floor(this.rng() * this.colors); n++; }
                while (n < 30 && ((this.gem(r, c - 1)?.color === col && this.gem(r, c - 2)?.color === col) || (this.gem(r - 1, c)?.color === col && this.gem(r - 2, c)?.color === col)));
                this.cells[r][c] = this.newGem(col);
            });
            if (this.hasMove()) return;
        }
    }

    // ------------------------------------------------------------------ matching
    runs() {
        const out = [];
        const scan = (lines) => {
            for (const line of lines) {
                let s = 0;
                for (let k = 1; k <= line.length; k++) {
                    const a = line[s], b = line[k];
                    const ca = a && this.gem(...a), cb = b && this.gem(...b);
                    const same = cb && ca && ca.color >= 0 && cb.color === ca.color;
                    if (!same) { if (k - s >= 3 && ca && ca.color >= 0) out.push({ cells: line.slice(s, k), dir: line.dir }); s = k; }
                }
            }
        };
        const rowsL = [], colsL = [];
        for (let r = 0; r < this.rows; r++) { const l = []; l.dir = "h"; for (let c = 0; c < this.cols; c++) l.push(this.ok(r, c) ? [r, c] : null); rowsL.push(l); }
        for (let c = 0; c < this.cols; c++) { const l = []; l.dir = "v"; for (let r = 0; r < this.rows; r++) l.push(this.ok(r, c) ? [r, c] : null); colsL.push(l); }
        // split lines at holes
        const split = (lines) => lines.flatMap((l) => { const parts = []; let cur = []; cur.dir = l.dir; for (const x of l) { if (x) cur.push(x); else { if (cur.length) parts.push(cur); cur = []; cur.dir = l.dir; } } if (cur.length) parts.push(cur); return parts; });
        scan(split(rowsL)); scan(split(colsL));
        return out;
    }
    // runs → groups (shared cells merge), each with the special it forges
    groups(swapCells = []) {
        const runs = this.runs();
        const groups = [];
        for (const run of runs) {
            const ks = new Set(run.cells.map(([r, c]) => key(r, c)));
            const hit = groups.filter((g) => [...ks].some((k) => g.keys.has(k)));
            const g = { keys: new Set(ks), runs: [run] };
            for (const h of hit) { for (const k of h.keys) g.keys.add(k); g.runs.push(...h.runs); groups.splice(groups.indexOf(h), 1); }
            groups.push(g);
        }
        for (const g of groups) {
            const maxLen = Math.max(...g.runs.map((r) => r.cells.length));
            const dirs = new Set(g.runs.map((r) => r.dir));
            g.cells = [...g.keys].map((k) => [Math.floor(k / 16), k % 16]);
            g.special = maxLen >= 5 ? "prism" : dirs.size > 1 ? "bomb" : maxLen === 4 ? (g.runs[0].dir === "h" ? "row" : "col") : null;
            const sw = swapCells.find(([r, c]) => g.keys.has(key(r, c)));
            if (sw) g.at = sw;
            else if (g.special === "bomb") {
                const counts = new Map();
                for (const run of g.runs) for (const [r, c] of run.cells) counts.set(key(r, c), (counts.get(key(r, c)) || 0) + 1);
                const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
                g.at = [Math.floor(best / 16), best % 16];
            } else { const run = g.runs[0].cells; g.at = run[Math.floor(run.length / 2)]; }
            g.color = this.gem(...g.cells[0]).color;
        }
        return groups;
    }

    // ------------------------------------------------------------------ clearing
    // clears `cells`, firing any specials among them (chain reactions); returns the clear step
    clear(cells, chain, keepAt = new Set(), extraFx = []) {
        const out = new Map(), fx = [...extraFx], queue = cells.map(([r, c]) => [r, c, null]);
        let blastCount = 0;
        while (queue.length) {
            const [r, c, by] = queue.shift();
            const g = this.gem(r, c);
            if (!g || out.has(key(r, c))) continue;
            out.set(key(r, c), { r, c, gem: g, by });
            if (by) blastCount++;
            if (g.special && !keepAt.has(key(r, c))) {
                const add = (rr, cc) => { if (this.gem(rr, cc) && !out.has(key(rr, cc))) queue.push([rr, cc, g.special]); };
                if (g.special === "row") { fx.push({ kind: "row", r, c, color: g.color }); for (let cc = 0; cc < this.cols; cc++) add(r, cc); }
                else if (g.special === "col") { fx.push({ kind: "col", r, c, color: g.color }); for (let rr = 0; rr < this.rows; rr++) add(rr, c); }
                else if (g.special === "bomb") { fx.push({ kind: "bomb", r, c, color: g.color, size: 1 }); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc); }
                else if (g.special === "prism") {
                    const pick = this.randomColorOnBoard();
                    fx.push({ kind: "prism", r, c, color: pick });
                    this.each((rr, cc) => { if (this.cells[rr][cc]?.color === pick) add(rr, cc); });
                }
            }
        }
        const removed = [], frostHits = [];
        let gained = 0;
        for (const e of out.values()) {
            if (keepAt.has(key(e.r, e.c))) continue;
            this.cells[e.r][e.c] = null;
            if (e.gem.color >= 0) this.collected[e.gem.color]++;
            removed.push(e);
            if (this.frost[e.r][e.c] > 0) { this.frost[e.r][e.c]--; frostHits.push({ r: e.r, c: e.c, left: this.frost[e.r][e.c] }); gained += 40; }
        }
        gained += removed.length * 20 + blastCount * 20;
        gained = Math.round(gained * (1 + 0.5 * chain));
        this.score += gained;
        return { type: "clear", removed, fx, frost: frostHits, gained, chain };
    }
    randomColorOnBoard() {
        const present = new Set();
        this.each((r, c) => { const g = this.cells[r][c]; if (g && g.color >= 0) present.add(g.color); });
        const list = [...present];
        return list.length ? list[Math.floor(this.rng() * list.length)] : 0;
    }

    // matches → clear (+ forge specials) ; returns step or null
    resolveMatches(chain, swapCells = []) {
        const groups = this.groups(swapCells);
        if (!groups.length) return null;
        const cells = [], created = [], keep = new Set();
        let base = 0;
        for (const g of groups) {
            cells.push(...g.cells);
            const n = g.cells.length;
            base += n >= 5 ? 200 : n === 4 ? 120 : 60 + (n - 3) * 30;
            if (g.special) {
                // the gem at `at` turns into the special (if it was itself a special it still fires)
                const [r, c] = g.at, old = this.gem(r, c);
                const ng = this.newGem(g.special === "prism" ? -1 : g.color, g.special);
                created.push({ r, c, gem: ng, old, color: g.color });
            }
        }
        const step = this.clear(cells, chain);
        this.score += Math.round(base * (1 + 0.5 * chain));
        step.gained += Math.round(base * (1 + 0.5 * chain));
        for (const cr of created) { this.cells[cr.r][cr.c] = cr.gem; }
        step.created = created;
        return step;
    }

    gravity() {
        const moves = [], spawned = [];
        for (let c = 0; c < this.cols; c++) {
            if (this.top[c] < 0) continue;
            const gems = [];
            for (let r = this.bot[c]; r >= this.top[c]; r--) if (this.cells[r][c]) gems.push([r, this.cells[r][c]]);
            let r = this.bot[c];
            for (const [from, g] of gems) { this.cells[r][c] = g; if (from !== r) moves.push({ gem: g, from: [from, c], to: [r, c] }); r--; }
            let k = 1;
            for (; r >= this.top[c]; r--) {
                const g = this.newGem(); this.cells[r][c] = g;
                spawned.push({ gem: g, from: [this.top[c] - k, c], to: [r, c] }); k++;
            }
        }
        return { type: "fall", moves, spawned };
    }

    cascade(steps, chain) {
        for (let guard = 0; guard < 40; guard++) {
            const st = this.resolveMatches(chain);
            if (!st) break;
            steps.push(st, this.gravity());
            chain++;
        }
        if (!this.hasMove()) steps.push(this.shuffle());
        return chain;
    }

    // ------------------------------------------------------------------ actions
    swapCells(a, b) { const t = this.cells[a[0]][a[1]]; this.cells[a[0]][a[1]] = this.cells[b[0]][b[1]]; this.cells[b[0]][b[1]] = t; }
    adjacent(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1; }

    trySwap(a, b) {
        const ga = this.gem(...a), gb = this.gem(...b);
        if (!ga || !gb || !this.adjacent(a, b)) return { ok: false, steps: [] };
        const steps = [{ type: "swap", a, b }];
        this.swapCells(a, b);
        // special combinations fire immediately (b is where the dragged gem landed)
        const sa = this.gem(...b), sb = this.gem(...a);           // sa = the gem that was moved
        const combo = this.combo(sa, b, sb, a);
        if (combo) {
            steps.push(combo, this.gravity());
            this.cascade(steps, 1);
            return { ok: true, steps };
        }
        const st = this.resolveMatches(0, [a, b]);
        if (!st) { this.swapCells(a, b); steps.push({ type: "swapBack", a, b }); return { ok: false, steps }; }
        steps.push(st, this.gravity());
        this.cascade(steps, 1);
        return { ok: true, steps };
    }

    combo(g1, p1, g2, p2) {
        const s1 = g1.special, s2 = g2.special;
        if (!s1 && !s2) return null;
        const prism1 = s1 === "prism", prism2 = s2 === "prism";
        if (!prism1 && !prism2 && (!s1 || !s2)) return null;      // a single non-prism special needs a match
        const fx = [];
        const cells = [];
        const at = p1;
        if (prism1 && prism2) {
            fx.push({ kind: "nova", r: at[0], c: at[1] });
            this.each((r, c) => cells.push([r, c]));
        } else if (prism1 || prism2) {
            const other = prism1 ? g2 : g1, pp = prism1 ? p1 : p2, op = prism1 ? p2 : p1;
            fx.push({ kind: "prism", r: pp[0], c: pp[1], color: other.color });
            cells.push(pp, op);
            this.each((r, c) => {
                const g = this.cells[r][c];
                if (g && g.color === other.color) {
                    if (other.special && other.special !== "prism") g.special = other.special === "bomb" ? "bomb" : this.rng() < 0.5 ? "row" : "col";
                    cells.push([r, c]);
                }
            });
        } else {
            const lines = (s) => s === "row" || s === "col";
            const [r, c] = at;
            if (lines(s1) && lines(s2)) { fx.push({ kind: "row", r, c, color: g1.color }, { kind: "col", r, c, color: g1.color }); for (let k = 0; k < Math.max(this.rows, this.cols); k++) cells.push([r, k], [k, c]); }
            else if (s1 === "bomb" && s2 === "bomb") { fx.push({ kind: "bomb", r, c, color: g1.color, size: 2 }); for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) cells.push([r + dr, c + dc]); }
            else { fx.push({ kind: "row", r, c, color: g1.color, wide: true }, { kind: "col", r, c, color: g1.color, wide: true }); for (let d = -1; d <= 1; d++) for (let k = 0; k < Math.max(this.rows, this.cols); k++) cells.push([r + d, k], [k, c + d]); }
            g1.special = null; g2.special = null;                   // their effect is the combo
        }
        const valid = cells.filter(([r, c]) => this.gem(r, c));
        if (prism1) g1.special = null; if (prism2) g2.special = null;
        return this.clear(valid, 0, new Set(), fx);
    }

    hammer(r, c) {
        if (!this.gem(r, c)) return null;
        const steps = [];
        steps.push(this.clear([[r, c]], 0, new Set(), [{ kind: "hammer", r, c }]), this.gravity());
        this.cascade(steps, 1);
        return steps;
    }

    // ------------------------------------------------------------------ moves
    wouldMatch(a, b) {
        const ga = this.gem(...a), gb = this.gem(...b);
        if (!ga || !gb) return false;
        if (ga.special === "prism" || gb.special === "prism" || (ga.special && gb.special)) return true;
        this.swapCells(a, b);
        const line = (r, c) => {
            const g = this.gem(r, c); if (!g || g.color < 0) return false;
            let h = 1, v = 1;
            for (let k = c - 1; this.gem(r, k)?.color === g.color; k--) h++;
            for (let k = c + 1; this.gem(r, k)?.color === g.color; k++) h++;
            for (let k = r - 1; this.gem(k, c)?.color === g.color; k--) v++;
            for (let k = r + 1; this.gem(k, c)?.color === g.color; k++) v++;
            return h >= 3 || v >= 3;
        };
        const m = line(...a) || line(...b);
        this.swapCells(a, b);
        return m;
    }
    allMoves() {
        const out = [];
        this.each((r, c) => {
            for (const [dr, dc] of [[0, 1], [1, 0]]) if (this.ok(r + dr, c + dc) && this.wouldMatch([r, c], [r + dr, c + dc])) out.push([[r, c], [r + dr, c + dc]]);
        });
        return out;
    }
    hasMove() { return this.allMoves().length > 0; }

    shuffle() {
        const gems = [], spots = [];
        this.each((r, c) => { if (this.cells[r][c]) { gems.push(this.cells[r][c]); spots.push([r, c]); } });
        for (let tries = 0; tries < 300; tries++) {
            for (let i = gems.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [gems[i], gems[j]] = [gems[j], gems[i]]; }
            spots.forEach(([r, c], i) => (this.cells[r][c] = gems[i]));
            if (!this.runs().length && this.hasMove()) break;
            if (tries > 200) { this.fill(); break; }
        }
        const moves = [];
        spots.forEach(([r, c]) => moves.push({ gem: this.cells[r][c], to: [r, c] }));
        return { type: "shuffle", moves };
    }

    clone() {
        const b = Object.create(Board.prototype);
        Object.assign(b, this);
        b.cells = this.cells.map((row) => row.map((g) => (g ? { ...g } : null)));
        b.frost = this.frost.map((row) => row.slice());
        b.collected = this.collected.slice();
        return b;
    }
}
