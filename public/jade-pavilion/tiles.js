// The 144-tile mahjong set, matching rules, and the face texture atlas (drawn on a canvas at load).
//
// Face index (0..41):
//   0–8 Dots 1–9 · 9–17 Bamboo 1–9 · 18–26 Characters 1–9 · 27–30 Winds E S W N · 31–33 Dragons red green white
//   34–37 Flowers plum orchid chrysanthemum bamboo · 38–41 Seasons spring summer autumn winter
// Any flower matches any flower, any season any season; everything else matches only itself.

export const FACES = 42;
export const ATLAS = 2048, CELL_W = 256, CELL_H = 320, COLS = 8;
export const GLYPHS = "一二三四五六七八九萬東南西北中發白梅蘭菊竹春夏秋冬筒條";

export function matchClass(f) { return f < 34 ? f : f < 38 ? 100 : 101; }
export const matches = (a, b) => matchClass(a) === matchClass(b);

export function faceName(f) {
    if (f < 9) return `${f + 1} of Dots`;
    if (f < 18) return `${f - 8} of Bamboo`;
    if (f < 27) return `${f - 17} of Characters`;
    if (f < 31) return ["East", "South", "West", "North"][f - 27] + " Wind";
    if (f < 34) return ["Red", "Green", "White"][f - 31] + " Dragon";
    if (f < 38) return ["Plum", "Orchid", "Chrysanthemum", "Bamboo"][f - 34] + " (Flower)";
    return ["Spring", "Summer", "Autumn", "Winter"][f - 38] + " (Season)";
}

// matched pairs of faces making up a full set: 34 kinds × 2 pairs + 2 flower pairs + 2 season pairs = 72 pairs
export function pairPool(rng) {
    const first = [], second = [];
    for (let f = 0; f < 34; f++) { first.push([f, f]); second.push([f, f]); }
    first.push([34, 35], [38, 39]); second.push([36, 37], [40, 41]);
    const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    return [...shuf(first), ...shuf(second)];
}

export function faceUV(f) {
    const c = f % COLS, r = Math.floor(f / COLS);
    return [(c * CELL_W) / ATLAS, (r * CELL_H) / ATLAS, CELL_W / ATLAS, CELL_H / ATLAS];
}

// ------------------------------------------------------------------ atlas drawing
const NAVY = "#1d2a5a", CRIMSON = "#b3172b", JADE = "#13774f", BLUE = "#1f4fa3", GOLD = "#b8862b";
const FONT = `"Noto Serif SC", "Songti SC", "SimSun", "Noto Serif CJK SC", serif`;

const DOTS = {
    1: [[0.5, 0.5]], 2: [[0.5, 0.27], [0.5, 0.73]], 3: [[0.27, 0.2], [0.5, 0.5], [0.73, 0.8]],
    4: [[0.3, 0.27], [0.7, 0.27], [0.3, 0.73], [0.7, 0.73]], 5: [[0.28, 0.22], [0.72, 0.22], [0.5, 0.5], [0.28, 0.78], [0.72, 0.78]],
    6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
    7: [[0.24, 0.15], [0.5, 0.27], [0.76, 0.39], [0.3, 0.62], [0.7, 0.62], [0.3, 0.85], [0.7, 0.85]],
    8: [[0.3, 0.14], [0.7, 0.14], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.3, 0.86], [0.7, 0.86]],
    9: [[0.24, 0.18], [0.5, 0.18], [0.76, 0.18], [0.24, 0.5], [0.5, 0.5], [0.76, 0.5], [0.24, 0.82], [0.5, 0.82], [0.76, 0.82]],
};
const DOT_COL = { 1: [CRIMSON], 2: [JADE, BLUE], 3: [BLUE, CRIMSON, JADE], 4: [BLUE, JADE, JADE, BLUE], 5: [BLUE, JADE, CRIMSON, JADE, BLUE],
    6: [JADE, JADE, CRIMSON, CRIMSON, CRIMSON, CRIMSON], 7: [JADE, JADE, JADE, CRIMSON, CRIMSON, CRIMSON, CRIMSON], 8: [BLUE],
    9: [BLUE, BLUE, BLUE, CRIMSON, CRIMSON, CRIMSON, JADE, JADE, JADE] };
const STICKS = {
    2: [[0.5, 0.28], [0.5, 0.72]], 3: [[0.5, 0.27], [0.3, 0.73], [0.7, 0.73]], 4: [[0.3, 0.28], [0.7, 0.28], [0.3, 0.72], [0.7, 0.72]],
    5: [[0.25, 0.28], [0.75, 0.28], [0.5, 0.5], [0.25, 0.72], [0.75, 0.72]],
    6: [[0.25, 0.28], [0.5, 0.28], [0.75, 0.28], [0.25, 0.72], [0.5, 0.72], [0.75, 0.72]],
    7: [[0.5, 0.17], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.25, 0.83], [0.5, 0.83], [0.75, 0.83]],
    8: [[0.2, 0.28], [0.4, 0.28], [0.6, 0.28], [0.8, 0.28], [0.2, 0.72], [0.4, 0.72], [0.6, 0.72], [0.8, 0.72]],
    9: [[0.25, 0.17], [0.5, 0.17], [0.75, 0.17], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.25, 0.83], [0.5, 0.83], [0.75, 0.83]],
};

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function dot(ctx, x, y, r, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = "#fbf7ea"; ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = r * 0.12;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3); ctx.lineTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); ctx.stroke(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, 7); ctx.fill();
}
function stick(ctx, x, y, h, w, col) {
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, col); g.addColorStop(0.45, "#7fd3a3"); g.addColorStop(1, col);
    ctx.fillStyle = g; rr(ctx, x - w / 2, y - h / 2, w, h, w / 2); ctx.fill();
    ctx.fillStyle = "rgba(10,60,35,0.75)";
    for (const t of [-0.5, 0, 0.5]) { ctx.fillRect(x - w / 2 - 1, y + (t * h) / 2 - 2.5, w + 2, 5); }
}

function drawFace(ctx, f, X, Y, W, H, showIndex) {
    // ivory face with a soft carved border
    const g = ctx.createLinearGradient(X, Y, X + W, Y + H);
    g.addColorStop(0, "#fffcf2"); g.addColorStop(1, "#ece3cb");
    ctx.fillStyle = g; ctx.fillRect(X, Y, W, H);
    ctx.strokeStyle = "rgba(150,120,70,0.28)"; ctx.lineWidth = 4; rr(ctx, X + 12, Y + 12, W - 24, H - 24, 18); ctx.stroke();
    const cx = X + W / 2, cy = Y + H / 2, iw = W - 56, ih = H - 64, ix = X + 28, iy = Y + 32;
    const P = (u, v) => [ix + u * iw, iy + v * ih];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let idx = "";
    if (f < 9) {                                                        // dots
        const n = f + 1, pts = DOTS[n], cols = DOT_COL[n];
        const r = n === 1 ? 70 : n <= 4 ? 34 : n <= 6 ? 29 : 25;
        pts.forEach(([u, v], i) => { const [x, y] = P(u, v); dot(ctx, x, y, r, cols[i % cols.length]); });
        if (n === 1) { ctx.strokeStyle = JADE; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, 86, 0, 7); ctx.stroke(); }
        idx = `${n}`;
    } else if (f < 18) {                                                // bamboo
        const n = f - 8;
        if (n === 1) {                                                  // the bamboo bird
            ctx.save(); ctx.translate(cx, cy + 6);
            for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; ctx.fillStyle = i % 2 ? JADE : "#1b9a68"; ctx.beginPath(); ctx.ellipse(Math.sin(a) * 60, 40 - Math.cos(a) * 30 + 30, 16, 48, a, 0, 7); ctx.fill(); ctx.fillStyle = CRIMSON; ctx.beginPath(); ctx.arc(Math.sin(a) * 92, 70 - Math.cos(a) * 54 + 30, 9, 0, 7); ctx.fill(); }
            ctx.fillStyle = BLUE; ctx.beginPath(); ctx.ellipse(0, -10, 40, 52, 0, 0, 7); ctx.fill();
            ctx.fillStyle = JADE; ctx.beginPath(); ctx.arc(0, -70, 26, 0, 7); ctx.fill();
            ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(22, -72); ctx.lineTo(48, -64); ctx.lineTo(22, -60); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(8, -74, 7, 0, 7); ctx.fill(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(10, -74, 3.5, 0, 7); ctx.fill();
            ctx.fillStyle = CRIMSON; ctx.beginPath(); ctx.arc(-6, -98, 9, 0, 7); ctx.fill();
            ctx.restore();
        } else {
            const pts = STICKS[n], h = n <= 4 ? 96 : n <= 6 ? 88 : 66, w = n === 8 ? 22 : 26;
            pts.forEach(([u, v], i) => { const [x, y] = P(u, v); stick(ctx, x, y, h, w, (n === 9 && i % 3 === 1) || (n === 7 && i === 0) || (n === 5 && i === 2) ? "#b3172b" : n === 8 && i % 2 ? "#1f4fa3" : "#1a7d52"); });
        }
        idx = `${n}`;
    } else if (f < 27) {                                                // characters
        const n = f - 17;
        ctx.fillStyle = NAVY; ctx.font = `700 120px ${FONT}`; ctx.fillText("一二三四五六七八九"[n - 1], cx, cy - 58);
        ctx.fillStyle = CRIMSON; ctx.font = `700 118px ${FONT}`; ctx.fillText("萬", cx, cy + 66);
        idx = `${n}`;
    } else if (f < 31) {                                                // winds
        ctx.fillStyle = NAVY; ctx.font = `700 176px ${FONT}`; ctx.fillText("東南西北"[f - 27], cx, cy + 6);
        idx = "ESWN"[f - 27];
    } else if (f < 34) {                                                // dragons
        if (f === 31) { ctx.fillStyle = CRIMSON; ctx.font = `700 186px ${FONT}`; ctx.fillText("中", cx, cy + 6); }
        else if (f === 32) { ctx.fillStyle = JADE; ctx.font = `700 170px ${FONT}`; ctx.fillText("發", cx, cy + 6); }
        else { ctx.strokeStyle = BLUE; ctx.lineWidth = 9; rr(ctx, cx - 72, cy - 98, 144, 196, 12); ctx.stroke(); ctx.lineWidth = 4; rr(ctx, cx - 52, cy - 78, 104, 156, 8); ctx.stroke(); }
        idx = ["R", "G", "W"][f - 31];
    } else {                                                            // flowers & seasons
        const fl = f < 38, k = (f - 34) % 4;
        ctx.save(); ctx.translate(cx, cy - 56);
        const pc = fl ? ["#d9467a", "#8a4bd6", "#e8a020", "#2f9a5a"][k] : ["#e45f86", "#e28a1e", "#c8541c", "#3f7fd0"][k];
        for (let i = 0; i < 5; i++) { ctx.rotate((Math.PI * 2) / 5); ctx.fillStyle = pc; ctx.beginPath(); ctx.ellipse(0, -26, 17, 28, 0, 0, 7); ctx.fill(); }
        ctx.fillStyle = "#f6d36b"; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
        ctx.restore();
        ctx.fillStyle = fl ? JADE : NAVY; ctx.font = `700 104px ${FONT}`; ctx.fillText((fl ? "梅蘭菊竹" : "春夏秋冬")[k], cx, cy + 74);
        ctx.fillStyle = CRIMSON; ctx.font = `700 34px ${FONT}`; ctx.fillText(`${k + 1}`, X + W - 40, Y + 44);
        idx = fl ? "F" : "S";
    }
    if (showIndex && idx) {
        ctx.fillStyle = "rgba(29,42,90,0.75)"; ctx.font = `700 36px "Manrope", system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(idx, X + 24, Y + 20);
    }
}

export async function buildAtlas(showIndex) {
    try { await Promise.race([document.fonts.load(`700 100px "Noto Serif SC"`, GLYPHS), new Promise((r) => setTimeout(r, 2500))]); } catch { }
    const cv = document.createElement("canvas");
    cv.width = ATLAS; cv.height = ATLAS;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#efe7d2"; ctx.fillRect(0, 0, ATLAS, ATLAS);
    for (let f = 0; f < FACES; f++) {
        const c = f % COLS, r = Math.floor(f / COLS);
        ctx.save(); ctx.beginPath(); ctx.rect(c * CELL_W, r * CELL_H, CELL_W, CELL_H); ctx.clip();
        drawFace(ctx, f, c * CELL_W, r * CELL_H, CELL_W, CELL_H, showIndex);
        ctx.restore();
    }
    return cv;
}

// a single face as a data URL (used by the UI, e.g. the hint preview / title decoration)
export function faceCanvas(atlas, f, w = 64) {
    const cv = document.createElement("canvas"), h = Math.round((w * CELL_H) / CELL_W);
    cv.width = w; cv.height = h;
    const c = f % COLS, r = Math.floor(f / COLS);
    cv.getContext("2d").drawImage(atlas, c * CELL_W, r * CELL_H, CELL_W, CELL_H, 0, 0, w, h);
    return cv;
}
