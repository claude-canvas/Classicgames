// Chess rules — pure. Board: 64 ints, a8 = 0 … h8 = 7 … a1 = 56 … h1 = 63. White > 0, black < 0.
// P 1 · N 2 · B 3 · R 4 · Q 5 · K 6. A move: { from, to, piece, captured, promo, flag } where flag is
// "" | "ep" | "K" | "Q" (castling) | "dbl" (pawn double push).

export const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const LET = " pnbrqk";
export const sqName = (s) => "abcdefgh"[s & 7] + (8 - (s >> 3));
export const sqOf = (n) => (8 - +n[1]) * 8 + "abcdefgh".indexOf(n[0]);
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const at = (r, f) => (r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1);

export class Chess {
    constructor(fen = START) { this.load(fen); }

    load(fen) {
        const [pos, side, cas, ep, half, full] = fen.trim().split(/\s+/);
        this.b = new Array(64).fill(0);
        let s = 0;
        for (const ch of pos) {
            if (ch === "/") continue;
            if (/\d/.test(ch)) { s += +ch; continue; }
            const t = LET.indexOf(ch.toLowerCase());
            this.b[s++] = ch === ch.toUpperCase() ? t : -t;
        }
        this.turn = side === "b" ? -1 : 1;
        this.cas = (cas.includes("K") ? 1 : 0) | (cas.includes("Q") ? 2 : 0) | (cas.includes("k") ? 4 : 0) | (cas.includes("q") ? 8 : 0);
        this.ep = ep && ep !== "-" ? sqOf(ep) : -1;
        this.half = +half || 0; this.full = +full || 1;
        this.stack = []; this.keys = [this.key()];
    }
    fen() {
        let out = "";
        for (let r = 0; r < 8; r++) {
            let e = 0;
            for (let f = 0; f < 8; f++) {
                const p = this.b[r * 8 + f];
                if (!p) { e++; continue; }
                if (e) { out += e; e = 0; }
                const c = LET[Math.abs(p)]; out += p > 0 ? c.toUpperCase() : c;
            }
            if (e) out += e;
            if (r < 7) out += "/";
        }
        const cs = (this.cas & 1 ? "K" : "") + (this.cas & 2 ? "Q" : "") + (this.cas & 4 ? "k" : "") + (this.cas & 8 ? "q" : "") || "-";
        return `${out} ${this.turn > 0 ? "w" : "b"} ${cs} ${this.ep >= 0 ? sqName(this.ep) : "-"} ${this.half} ${this.full}`;
    }
    key() { return this.b.join(",") + this.turn + this.cas + this.ep; }
    king(side) { for (let s = 0; s < 64; s++) if (this.b[s] === K * side) return s; return -1; }

    // is square s attacked by `side` (1 white, -1 black)?
    attacked(s, side) {
        const r = s >> 3, f = s & 7, b = this.b;
        const pr = r + side;                                    // a white pawn attacks upward (towards rank 8 = row 0)
        for (const df of [-1, 1]) { const t = at(pr, f + df); if (t >= 0 && b[t] === P * side) return true; }
        for (const [dr, df] of KN) { const t = at(r + dr, f + df); if (t >= 0 && b[t] === N * side) return true; }
        for (const [dr, df] of KG) { const t = at(r + dr, f + df); if (t >= 0 && b[t] === K * side) return true; }
        for (const [dr, df] of DIAG) for (let k = 1; ; k++) { const t = at(r + dr * k, f + df * k); if (t < 0) break; const p = b[t]; if (p) { if (p === B * side || p === Q * side) return true; break; } }
        for (const [dr, df] of ORTH) for (let k = 1; ; k++) { const t = at(r + dr * k, f + df * k); if (t < 0) break; const p = b[t]; if (p) { if (p === R * side || p === Q * side) return true; break; } }
        return false;
    }
    inCheck(side = this.turn) { const k = this.king(side); return k >= 0 && this.attacked(k, -side); }

    pseudo(capturesOnly = false) {
        const out = [], b = this.b, me = this.turn;
        const add = (from, to, piece, flag = "", promo = 0) => {
            const cap = flag === "ep" ? -me * P : b[to];
            if (capturesOnly && !cap && !promo) return;
            if (Math.abs(piece) === P && (to >> 3 === 0 || to >> 3 === 7) && !promo) { for (const pp of [Q, N, R, B]) out.push({ from, to, piece, captured: cap, promo: pp * me, flag }); return; }
            out.push({ from, to, piece, captured: cap, promo, flag });
        };
        for (let s = 0; s < 64; s++) {
            const p = b[s];
            if (!p || Math.sign(p) !== me) continue;
            const t = Math.abs(p), r = s >> 3, f = s & 7;
            if (t === P) {
                const dir = -me, one = at(r + dir, f);
                if (one >= 0 && !b[one]) {
                    add(s, one, p);
                    const startRow = me > 0 ? 6 : 1, two = at(r + 2 * dir, f);
                    if (r === startRow && !b[two] && !capturesOnly) add(s, two, p, "dbl");
                }
                for (const df of [-1, 1]) {
                    const c = at(r + dir, f + df);
                    if (c < 0) continue;
                    if (b[c] && Math.sign(b[c]) === -me) add(s, c, p);
                    else if (c === this.ep) add(s, c, p, "ep");
                }
            } else if (t === N || t === K) {
                for (const [dr, df] of t === N ? KN : KG) { const c = at(r + dr, f + df); if (c >= 0 && Math.sign(b[c]) !== me) add(s, c, p); }
                if (t === K && !capturesOnly) {
                    const home = me > 0 ? 60 : 4, kb = me > 0 ? 1 : 4, qb = me > 0 ? 2 : 8;
                    if (s === home && !this.attacked(s, -me)) {
                        if (this.cas & kb && !b[s + 1] && !b[s + 2] && b[s + 3] === R * me && !this.attacked(s + 1, -me) && !this.attacked(s + 2, -me)) add(s, s + 2, p, "K");
                        if (this.cas & qb && !b[s - 1] && !b[s - 2] && !b[s - 3] && b[s - 4] === R * me && !this.attacked(s - 1, -me) && !this.attacked(s - 2, -me)) add(s, s - 2, p, "Q");
                    }
                }
            } else {
                const dirs = t === B ? DIAG : t === R ? ORTH : [...DIAG, ...ORTH];
                for (const [dr, df] of dirs) for (let k = 1; ; k++) {
                    const c = at(r + dr * k, f + df * k);
                    if (c < 0) break;
                    if (!b[c]) { add(s, c, p); continue; }
                    if (Math.sign(b[c]) === -me) add(s, c, p);
                    break;
                }
            }
        }
        return out;
    }
    moves() { return this.pseudo().filter((m) => { this.make(m); const ok = !this.inCheck(-this.turn); this.undo(); return ok; }); }

    make(m) {
        const b = this.b, me = this.turn;
        this.stack.push({ m, cas: this.cas, ep: this.ep, half: this.half, full: this.full });
        b[m.to] = m.promo || m.piece; b[m.from] = 0;
        if (m.flag === "ep") b[m.to + 8 * me] = 0;
        if (m.flag === "K") { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = 0; }
        if (m.flag === "Q") { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = 0; }
        this.ep = m.flag === "dbl" ? (m.from + m.to) / 2 : -1;
        // castling rights
        const kill = (sq) => { if (sq === 63) this.cas &= ~1; if (sq === 56) this.cas &= ~2; if (sq === 7) this.cas &= ~4; if (sq === 0) this.cas &= ~8; };
        if (Math.abs(m.piece) === K) this.cas &= me > 0 ? ~3 : ~12;
        kill(m.from); kill(m.to);
        this.half = Math.abs(m.piece) === P || m.captured ? 0 : this.half + 1;
        if (me < 0) this.full++;
        this.turn = -me;
        this.keys.push(this.key());
    }
    undo() {
        const u = this.stack.pop(); if (!u) return null;
        const { m } = u, b = this.b, me = -this.turn;
        this.keys.pop();
        b[m.from] = m.piece; b[m.to] = m.flag === "ep" ? 0 : m.captured;
        if (m.flag === "ep") b[m.to + 8 * me] = m.captured;
        if (m.flag === "K") { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = 0; }
        if (m.flag === "Q") { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = 0; }
        this.cas = u.cas; this.ep = u.ep; this.half = u.half; this.full = u.full; this.turn = me;
        return m;
    }

    insufficient() {
        const left = this.b.filter((p) => p && Math.abs(p) !== K);
        if (!left.length) return true;
        if (left.length === 1 && (Math.abs(left[0]) === B || Math.abs(left[0]) === N)) return true;
        return false;
    }
    status() {
        const legal = this.moves();
        if (!legal.length) return this.inCheck() ? "checkmate" : "stalemate";
        if (this.half >= 100) return "fifty";
        if (this.insufficient()) return "material";
        const k = this.keys[this.keys.length - 1];
        if (this.keys.filter((x) => x === k).length >= 3) return "repetition";
        return null;
    }

    san(m) {
        const t = Math.abs(m.piece);
        let s;
        if (m.flag === "K") s = "O-O";
        else if (m.flag === "Q") s = "O-O-O";
        else {
            s = t === P ? "" : " PNBRQK"[t];
            if (t !== P) {
                const others = this.moves().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
                if (others.length) {
                    const sameFile = others.some((o) => (o.from & 7) === (m.from & 7)), sameRank = others.some((o) => o.from >> 3 === m.from >> 3);
                    s += !sameFile ? "abcdefgh"[m.from & 7] : !sameRank ? 8 - (m.from >> 3) : sqName(m.from);
                }
            }
            if (m.captured) s += (t === P ? "abcdefgh"[m.from & 7] : "") + "x";
            s += sqName(m.to);
            if (m.promo) s += "=" + " PNBRQK"[Math.abs(m.promo)];
        }
        this.make(m);
        const st = this.moves().length === 0 && this.inCheck() ? "#" : this.inCheck() ? "+" : "";
        this.undo();
        return s + st;
    }
}
