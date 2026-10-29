// Blackmoor textures: everything is painted at load time with canvas 2D + per-pixel noise (nothing to download).
// A texture is { w, h, r, g, b, a, e }: r/g/b colour, a = opacity (sprites), e = emissive mask (0..255).
// Walls/doors/floors are 64×64; sprites are 64×64 or 64×128 (the Matron).

const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s = 0) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (hash(i, j, s) * (1 - u) + hash(i + 1, j, s) * u) * (1 - v) + (hash(i, j + 1, s) * (1 - u) + hash(i + 1, j + 1, s) * u) * v;
}
// tileable fbm on a period-p grid
function tnoise(x, y, p, s, oct = 4) {
    let a = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) {
        const P = p * f, X = x * f, Y = y * f;
        const i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const h = (a1, b1) => hash(((a1 % P) + P) % P, ((b1 % P) + P) % P, s + o);
        a += ((h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v) * amp;
        amp *= 0.5; f *= 2;
    }
    return a;
}

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d", { willReadFrequently: true }); return c; }
function toTex(c, emit) {
    const w = c.width, h = c.height, d = c.getContext("2d").getImageData(0, 0, w, h).data;
    const t = { w, h, r: new Uint8Array(w * h), g: new Uint8Array(w * h), b: new Uint8Array(w * h), a: new Uint8Array(w * h), e: new Uint8Array(w * h) };
    for (let i = 0; i < w * h; i++) { t.r[i] = d[i * 4]; t.g[i] = d[i * 4 + 1]; t.b[i] = d[i * 4 + 2]; t.a[i] = d[i * 4 + 3]; }
    if (emit) { const e = emit.getContext("2d").getImageData(0, 0, w, h).data; for (let i = 0; i < w * h; i++) t.e[i] = Math.max(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]) * (e[i * 4 + 3] / 255); }
    return t;
}
// per-pixel post pass over a canvas: f(x, y, [r,g,b,a]) → [r,g,b,a]
function pix(c, f) {
    const x2 = c.getContext("2d"), img = x2.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4, o = f(x, y, [d[i], d[i + 1], d[i + 2], d[i + 3]]);
        d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3] ?? 255;
    }
    x2.putImageData(img, 0, 0);
}
const grime = (s, k = 1) => (x, y, c) => { const n = tnoise(x / 16, y / 16, 4, s) - 0.5, m = 1 + n * 0.5 * k - (y / 64) * 0.08 * k; return [c[0] * m, c[1] * m, c[2] * m, c[3]]; };
function stains(c, s, n = 5) {
    const x = c.getContext("2d"), R = rng(s);
    for (let i = 0; i < n; i++) {
        const sx = R() * 64, len = 15 + R() * 45, w = 2 + R() * 7;
        const g = x.createLinearGradient(0, 0, 0, len);
        g.addColorStop(0, `rgba(70,45,20,${0.25 + R() * 0.3})`); g.addColorStop(1, "rgba(70,45,20,0)");
        x.fillStyle = g; x.fillRect(sx, 0, w, len);
    }
}
function cracks(c, s, n = 3, col = "rgba(20,18,15,0.7)") {
    const x = c.getContext("2d"), R = rng(s);
    x.strokeStyle = col; x.lineWidth = 1;
    for (let i = 0; i < n; i++) {
        let px = R() * 64, py = R() * 64; x.beginPath(); x.moveTo(px, py);
        for (let k = 0; k < 8; k++) { px += (R() - 0.5) * 10; py += R() * 8; x.lineTo(px, py); }
        x.stroke();
    }
}
function blood(c, s, n = 4, big = false) {
    const x = c.getContext("2d"), R = rng(s);
    for (let i = 0; i < n; i++) {
        const cx = R() * 64, cy = R() * 64, r = (big ? 6 : 2) + R() * (big ? 9 : 4);
        x.fillStyle = `rgba(${90 + R() * 40},8,8,${0.55 + R() * 0.35})`;
        x.beginPath(); x.ellipse(cx, cy, r, r * (0.6 + R() * 0.6), R() * 3, 0, 7); x.fill();
        for (let k = 0; k < 3; k++) { x.fillRect(cx - r + R() * r * 2, cy, 1 + R() * 1.5, 4 + R() * 18); }
    }
}

// ------------------------------------------------------------------ walls
function plaster(seed, writing) {
    const c = canvas(64, 64), x = c.getContext("2d");
    x.fillStyle = "#77836a"; x.fillRect(0, 0, 64, 38);
    x.fillStyle = "#34473f"; x.fillRect(0, 38, 64, 26);
    x.fillStyle = "#22302b"; x.fillRect(0, 37, 64, 2);
    x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(0, 60, 64, 4);
    stains(c, seed, 5); cracks(c, seed + 1, 3);
    // peeling paint
    const R = rng(seed + 9);
    for (let i = 0; i < 4; i++) { x.fillStyle = "rgba(150,140,110,0.5)"; const px = R() * 60, py = R() * 34; x.beginPath(); x.ellipse(px, py, 2 + R() * 4, 1 + R() * 3, R(), 0, 7); x.fill(); }
    if (writing) {
        x.save(); x.font = "bold 11px Impact, 'Arial Black', sans-serif"; x.textAlign = "center"; x.fillStyle = "rgba(120,5,5,0.92)";
        writing.forEach((l, i) => { x.save(); x.translate(32, 18 + i * 13); x.rotate((R() - 0.5) * 0.12); x.fillText(l, 0, 0); x.restore(); });
        x.restore();
        for (let i = 0; i < 14; i++) { x.fillStyle = "rgba(110,4,4,0.85)"; x.fillRect(8 + R() * 48, 14 + R() * 26, 1, 3 + R() * 14); }
    }
    pix(c, grime(seed));
    return toTex(c);
}
function brick(seed) {
    const c = canvas(64, 64), x = c.getContext("2d"), R = rng(seed);
    x.fillStyle = "#2a201c"; x.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) for (let k = -1; k < 4; k++) {
        const ox = (row % 2) * 8 + k * 16;
        const v = 60 + R() * 35; x.fillStyle = `rgb(${v + 30},${v * 0.55},${v * 0.42})`;
        x.fillRect(ox + 1, row * 8 + 1, 14, 6);
    }
    stains(c, seed + 3, 3); pix(c, grime(seed, 1.4));
    return toTex(c);
}
function wood(seed) {
    const c = canvas(64, 64), x = c.getContext("2d");
    pix(c, (px, py) => { const k = 16, plank = Math.floor(px / k), n = tnoise(px / 32, py / 4, 2, seed + plank) * 0.6 + Math.sin(py * 0.4 + plank * 3 + tnoise(px / 8, py / 16, 8, seed) * 6) * 0.08; const edge = px % k === 0 ? 0.5 : 1; const v = (0.35 + n * 0.5) * edge; return [110 * v, 66 * v, 40 * v, 255]; });
    x.fillStyle = "rgba(20,10,5,0.6)"; x.fillRect(0, 8, 64, 2); x.fillRect(0, 54, 64, 3);
    stains(c, seed, 2);
    return toTex(c);
}
function tile(seed, bloody) {
    const c = canvas(64, 64), x = c.getContext("2d");
    x.fillStyle = "#5c5e58"; x.fillRect(0, 0, 64, 64);
    const R = rng(seed);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const v = 175 + R() * 30; x.fillStyle = `rgb(${v},${v + 4},${v - 4})`; x.fillRect(i * 8 + 1, j * 8 + 1, 7, 7); }
    stains(c, seed, 4); cracks(c, seed + 2, 2, "rgba(40,40,40,0.6)");
    if (bloody) blood(c, seed + 5, 3, true);
    pix(c, grime(seed, 1.2));
    return toTex(c);
}
function windowTex(seed) {
    const c = canvas(64, 64), x = c.getContext("2d"), e = canvas(64, 64), ex = e.getContext("2d");
    const base = plaster(seed);
    const img = x.createImageData(64, 64); for (let i = 0; i < 4096; i++) { img.data[i * 4] = base.r[i]; img.data[i * 4 + 1] = base.g[i]; img.data[i * 4 + 2] = base.b[i]; img.data[i * 4 + 3] = 255; } x.putImageData(img, 0, 0);
    x.fillStyle = "#1b1712"; x.fillRect(14, 8, 36, 40);
    const g = x.createLinearGradient(0, 10, 0, 46); g.addColorStop(0, "#1c2a44"); g.addColorStop(1, "#0b111d"); x.fillStyle = g; x.fillRect(16, 10, 32, 36);
    ex.fillStyle = "#6f86b8"; ex.fillRect(16, 10, 32, 36);
    x.fillStyle = "#2a241d"; for (let i = 0; i < 5; i++) x.fillRect(19 + i * 6.5, 9, 2, 38); x.fillRect(15, 27, 34, 2);
    ex.fillStyle = "#000"; for (let i = 0; i < 5; i++) ex.fillRect(19 + i * 6.5, 9, 2, 38); ex.fillRect(15, 27, 34, 2);
    // rain streaks
    const R = rng(seed); x.strokeStyle = "rgba(140,160,200,0.25)"; for (let i = 0; i < 12; i++) { const px = 16 + R() * 32, py = 10 + R() * 30; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 1, py + 4 + R() * 5); x.stroke(); }
    x.fillStyle = "#3c3328"; x.fillRect(12, 46, 40, 3);
    return toTex(c, e);
}
function locker(seed) {
    const c = canvas(64, 64), x = c.getContext("2d");
    x.fillStyle = "#1e211f"; x.fillRect(0, 0, 64, 64);
    for (let k = 0; k < 2; k++) {
        const ox = 2 + k * 31;
        const g = x.createLinearGradient(ox, 0, ox + 29, 0); g.addColorStop(0, "#4d5a52"); g.addColorStop(0.5, "#5f6d64"); g.addColorStop(1, "#46524a");
        x.fillStyle = g; x.fillRect(ox, 2, 29, 61);
        x.fillStyle = "#151816"; for (let i = 0; i < 6; i++) x.fillRect(ox + 6, 7 + i * 3, 17, 1.5);
        x.fillStyle = "#9a9f98"; x.fillRect(ox + 23, 30, 3, 8);
        x.fillStyle = "#c6c09a"; x.fillRect(ox + 8, 44, 12, 6); x.fillStyle = "#333"; x.font = "5px monospace"; x.fillText(String(13 + k + seed % 7), ox + 10, 49);
    }
    stains(c, seed, 2); blood(c, seed + 1, 1); pix(c, grime(seed, 1.3));
    return toTex(c);
}
function generator(fuses, powered) {
    const c = canvas(64, 64), x = c.getContext("2d"), e = canvas(64, 64), ex = e.getContext("2d");
    x.fillStyle = "#3b3f38"; x.fillRect(0, 0, 64, 64);
    x.fillStyle = "#585e52"; x.fillRect(4, 4, 56, 56);
    x.fillStyle = "#2b2e28"; x.fillRect(8, 8, 48, 16);
    x.fillStyle = "#c8a83a"; x.fillRect(8, 26, 48, 4); x.fillStyle = "#222"; for (let i = 0; i < 8; i++) x.fillRect(9 + i * 6, 26, 3, 4);
    x.fillStyle = "#ddd"; x.font = "bold 6px monospace"; x.fillText("GENERATOR B", 12, 17);
    for (let i = 0; i < 3; i++) {
        const fx = 14 + i * 14;
        x.fillStyle = "#1a1a1a"; x.fillRect(fx, 36, 9, 18);
        if (i < fuses) { x.fillStyle = "#b7c4c9"; x.fillRect(fx + 2, 37, 5, 16); x.fillStyle = "#e3a23a"; x.fillRect(fx + 3, 41, 3, 8); ex.fillStyle = powered ? "#ffb040" : "#402000"; ex.fillRect(fx + 3, 41, 3, 8); }
    }
    for (let i = 0; i < 3; i++) { x.fillStyle = "#111"; x.beginPath(); x.arc(16 + i * 16, 16, 4, 0, 7); x.fill(); ex.fillStyle = powered ? "#ff3020" : i < fuses ? "#401000" : "#000"; ex.beginPath(); ex.arc(16 + i * 16, 16, 2.5, 0, 7); ex.fill(); }
    pix(c, grime(77, 1.3));
    return toTex(c, e);
}
function doorTex(kind, seed) {
    const c = canvas(64, 64), x = c.getContext("2d"), e = canvas(64, 64), ex = e.getContext("2d");
    if (kind === "D") {
        pix(c, (px, py) => { const n = tnoise(px / 32, py / 6, 2, seed) * 0.6, v = 0.45 + n * 0.5; return [118 * v, 82 * v, 52 * v, 255]; });
        x.strokeStyle = "rgba(20,10,5,0.7)"; x.lineWidth = 2; x.strokeRect(8, 6, 48, 24); x.strokeRect(8, 36, 48, 24);
        x.fillStyle = "#0b0c10"; x.fillRect(22, 10, 20, 14); x.fillStyle = "rgba(160,170,190,0.12)"; x.fillRect(22, 10, 20, 7);
        x.fillStyle = "#a69a7a"; x.fillRect(50, 36, 5, 3);
        x.fillStyle = "#d8d0b8"; x.fillRect(26, 27, 12, 6); x.fillStyle = "#222"; x.font = "bold 5px monospace"; x.fillText(String(seed % 40), 28, 32);
    } else if (kind === "Y") {
        x.fillStyle = "#53585a"; x.fillRect(0, 0, 64, 64);
        for (let i = -4; i < 10; i++) { x.fillStyle = i % 2 ? "#c9a51e" : "#151515"; x.save(); x.beginPath(); x.rect(0, 50, 64, 10); x.clip(); x.translate(i * 8, 50); x.transform(1, 0, -0.8, 1, 0, 0); x.fillRect(0, 0, 8, 10); x.restore(); }
        x.fillStyle = "#222"; x.fillRect(46, 24, 10, 14); ex.fillStyle = "#c08000"; ex.fillRect(48, 26, 6, 3);
        x.fillStyle = "#d8c040"; x.font = "bold 7px sans-serif"; x.fillText("WARD C", 10, 20);
        x.fillStyle = "#0c0d10"; x.fillRect(12, 26, 22, 18);
    } else if (kind === "R") {
        x.fillStyle = "#5a1414"; x.fillRect(0, 0, 64, 64); x.fillStyle = "#3a0b0b"; x.fillRect(31, 0, 2, 64);
        x.fillStyle = "#ddd"; x.font = "bold 7px sans-serif"; x.fillText("SURGERY", 6, 14);
        x.fillStyle = "#0c0d10"; x.beginPath(); x.arc(16, 30, 7, 0, 7); x.fill(); x.beginPath(); x.arc(48, 30, 7, 0, 7); x.fill();
        x.fillStyle = "#999"; x.fillRect(26, 40, 4, 10); x.fillRect(34, 40, 4, 10);
        ex.fillStyle = "#900"; ex.fillRect(28, 2, 8, 4);
        blood(c, seed, 2);
    } else {
        x.fillStyle = "#06070a"; x.fillRect(0, 0, 64, 64);
        const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, "#101828"); g.addColorStop(1, "#050608"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        ex.fillStyle = "#223050"; ex.fillRect(0, 0, 64, 30);
        x.fillStyle = "#2b2b2b"; for (let i = 0; i < 8; i++) { x.fillRect(3 + i * 8, 0, 3, 64); ex.fillStyle = "#000"; ex.fillRect(3 + i * 8, 0, 3, 64); }
        x.fillRect(0, 6, 64, 3); x.fillRect(0, 56, 64, 3);
        x.fillStyle = "#6b6b6b"; x.fillRect(27, 28, 10, 12); x.fillStyle = "#333"; x.fillRect(30, 31, 4, 5);
    }
    pix(c, grime(seed + 40, 1.1));
    return toTex(c, e);
}
function floorTex(kind, seed) {
    const c = canvas(64, 64), x = c.getContext("2d");
    if (kind === "lino") pix(c, (px, py) => { const chk = ((px >> 4) + (py >> 4)) & 1, n = tnoise(px / 16, py / 16, 4, seed); const v = (chk ? 0.62 : 0.4) * (0.75 + n * 0.5); return [130 * v, 128 * v, 110 * v, 255]; });
    else if (kind === "tile") pix(c, (px, py) => { const g = px % 16 === 0 || py % 16 === 0, n = tnoise(px / 16, py / 16, 4, seed); const v = (g ? 0.35 : 0.72) * (0.8 + n * 0.4); return [150 * v, 155 * v, 152 * v, 255]; });
    else if (kind === "wood") pix(c, (px, py) => { const pl = Math.floor(py / 8), n = tnoise(px / 4, py / 32, 16, seed + pl), v = (py % 8 === 0 ? 0.4 : 1) * (0.4 + n * 0.5); return [100 * v, 60 * v, 36 * v, 255]; });
    else if (kind === "concrete") pix(c, (px, py) => { const n = tnoise(px / 16, py / 16, 4, seed), v = 0.35 + n * 0.4; return [95 * v, 92 * v, 88 * v, 255]; });
    else if (kind === "ceil") pix(c, (px, py) => { const g = px % 32 === 0 || py % 32 === 0, n = tnoise(px / 16, py / 16, 4, seed), st = tnoise(px / 32, py / 32, 2, seed + 7); const v = (g ? 0.35 : 0.7) * (0.85 + n * 0.3) * (st > 0.62 ? 0.65 : 1); return [140 * v, 135 * v, 118 * v, 255]; });
    else if (kind === "ceilwood") pix(c, (px, py) => { const n = tnoise(px / 4, py / 32, 16, seed), v = (px % 16 === 0 ? 0.4 : 1) * (0.3 + n * 0.4); return [90 * v, 55 * v, 32 * v, 255]; });
    if (kind === "lino" || kind === "tile") { stains(c, seed + 1, 2); blood(c, seed + 3, kind === "tile" ? 2 : 1, kind === "tile"); }
    return toTex(c);
}

// ------------------------------------------------------------------ sprites
function sprite(w, h, draw, emit) {
    const c = canvas(w, h), x = c.getContext("2d");
    draw(x, c);
    let e = null;
    if (emit) { e = canvas(w, h); emit(e.getContext("2d")); }
    return toTex(c, e);
}
function shade(x, w, h) { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.35)"); x.globalCompositeOperation = "source-atop"; x.fillStyle = g; x.fillRect(0, 0, w, h); x.globalCompositeOperation = "source-over"; }

function matron(frame) {
    // the Matron: tall, gaunt, tattered nurse's dress, long black hair, no eyes, long fingers
    return sprite(64, 128, (x) => {
        const sway = frame === 1 ? 2 : frame === 0 ? -2 : 0, lunge = frame === 2;
        x.lineCap = "round";
        // legs
        x.strokeStyle = "#cfc8bd"; x.lineWidth = 3.5;
        x.beginPath(); x.moveTo(28, 92); x.lineTo(26 - sway, 126); x.stroke();
        x.beginPath(); x.moveTo(36, 92); x.lineTo(38 + sway, 126); x.stroke();
        // dress
        x.fillStyle = "#9aa39a";
        x.beginPath(); x.moveTo(24, 40); x.lineTo(40, 40); x.lineTo(46 + sway, 98); x.lineTo(41, 94); x.lineTo(37, 100); x.lineTo(32, 95); x.lineTo(27, 101); x.lineTo(22, 95); x.lineTo(18 + sway, 98); x.closePath(); x.fill();
        x.fillStyle = "rgba(110,10,10,0.85)"; x.beginPath(); x.ellipse(30, 66, 6, 11, 0.2, 0, 7); x.fill(); x.fillRect(27, 70, 2, 26); x.fillRect(33, 72, 1.5, 20);
        x.fillStyle = "#e9e6dc"; x.fillRect(27, 42, 10, 4);
        // arms — very long
        x.strokeStyle = "#d8d2c6"; x.lineWidth = 3;
        if (lunge) {
            x.beginPath(); x.moveTo(25, 44); x.lineTo(8, 30); x.lineTo(2, 12); x.stroke();
            x.beginPath(); x.moveTo(39, 44); x.lineTo(56, 30); x.lineTo(62, 12); x.stroke();
            x.lineWidth = 1.2; for (let f = 0; f < 4; f++) { x.beginPath(); x.moveTo(2, 12); x.lineTo(-2 + f * 2.5, 2); x.stroke(); x.beginPath(); x.moveTo(62, 12); x.lineTo(57 + f * 2.5, 2); x.stroke(); }
        } else {
            x.beginPath(); x.moveTo(25, 44); x.lineTo(17 - sway, 70); x.lineTo(15 - sway, 98); x.stroke();
            x.beginPath(); x.moveTo(39, 44); x.lineTo(47 + sway, 70); x.lineTo(50 + sway, 98); x.stroke();
            x.lineWidth = 1.1; for (let f = 0; f < 4; f++) { x.beginPath(); x.moveTo(15 - sway, 98); x.lineTo(12 - sway + f * 2, 110); x.stroke(); x.beginPath(); x.moveTo(50 + sway, 98); x.lineTo(47 + sway + f * 2, 110); x.stroke(); }
        }
        // neck + head (tilted)
        x.strokeStyle = "#d8d2c6"; x.lineWidth = 4; x.beginPath(); x.moveTo(32, 42); x.lineTo(33, 30); x.stroke();
        x.save(); x.translate(33, 22); x.rotate(lunge ? 0 : 0.35);
        // hair behind the head
        x.fillStyle = "#0a0908";
        x.beginPath(); x.moveTo(-9, -4); x.quadraticCurveTo(0, -15, 9, -4); x.lineTo(11, 22); x.lineTo(7, 14); x.lineTo(5, 26); x.lineTo(-5, 26); x.lineTo(-7, 14); x.lineTo(-11, 22); x.closePath(); x.fill();
        x.fillStyle = "#ece8de"; x.beginPath(); x.ellipse(0, 1, 7.5, 10.5, 0, 0, 7); x.fill();
        x.fillStyle = "rgba(120,110,100,0.5)"; x.beginPath(); x.ellipse(0, 4, 6, 6, 0, 0, Math.PI); x.fill();
        x.fillStyle = "#030303"; x.beginPath(); x.ellipse(-3.2, -0.5, 2.6, 3.4, 0, 0, 7); x.fill(); x.beginPath(); x.ellipse(3.2, -0.5, 2.6, 3.4, 0, 0, 7); x.fill();
        x.fillStyle = "rgba(110,0,0,0.9)"; x.fillRect(-4, 2.5, 0.8, 5); x.fillRect(3.4, 2.5, 0.8, 4);
        x.fillStyle = "#030303"; x.beginPath(); x.ellipse(0, lunge ? 6.5 : 6, lunge ? 3.8 : 2.6, lunge ? 4.5 : 1.6, 0, 0, 7); x.fill();
        if (lunge) { x.fillStyle = "#ddd"; for (let i = -2; i <= 2; i++) x.fillRect(i * 1.4 - 0.4, 3, 0.8, 2); }
        // strands falling over the face's edges
        x.strokeStyle = "#0a0908"; x.lineWidth = 1.4;
        for (const sx of [-7, -5.5, 5.5, 7]) { x.beginPath(); x.moveTo(sx, -8); x.quadraticCurveTo(sx * 0.7, 4, sx * 0.9, 16); x.stroke(); }
        x.restore();
        // nurse cap
        x.fillStyle = "#d9d5c8"; x.save(); x.translate(31, 12); x.rotate(0.35); x.fillRect(-5, -3, 10, 3); x.restore();
        shade(x, 64, 128);
    }, (e) => { e.fillStyle = "#ffffff"; e.save(); e.translate(33, 22); e.rotate(lunge(frame) ? 0 : 0.35); e.fillRect(-3.4, -1.5, 0.9, 0.9); e.fillRect(2.6, -1.5, 0.9, 0.9); e.restore(); });
}
const lunge = (f) => f === 2;

function bed() { return sprite(64, 64, (x) => { x.fillStyle = "#3a3d3f"; x.fillRect(4, 40, 3, 22); x.fillRect(57, 40, 3, 22); x.fillRect(4, 26, 3, 16); x.fillStyle = "#b9b4a2"; x.fillRect(4, 36, 56, 9); x.fillStyle = "#8f8a78"; x.fillRect(4, 43, 56, 3); x.fillStyle = "#d3cfc0"; x.fillRect(6, 31, 14, 6); x.fillStyle = "rgba(110,40,20,0.7)"; x.beginPath(); x.ellipse(36, 38, 9, 3, 0, 0, 7); x.fill(); x.fillStyle = "#2d2f31"; x.fillRect(4, 47, 56, 2); shade(x, 64, 64); }); }
function wheelchair() { return sprite(64, 64, (x) => { x.strokeStyle = "#5a5f62"; x.lineWidth = 2; x.beginPath(); x.arc(26, 50, 12, 0, 7); x.stroke(); x.beginPath(); x.arc(46, 57, 5, 0, 7); x.stroke(); x.fillStyle = "#25303a"; x.fillRect(18, 34, 22, 5); x.fillRect(18, 18, 4, 18); x.strokeStyle = "#7d8285"; x.beginPath(); x.moveTo(20, 18); x.lineTo(14, 16); x.stroke(); x.beginPath(); x.moveTo(40, 38); x.lineTo(46, 52); x.stroke(); shade(x, 64, 64); }); }
function gurney() { return sprite(64, 64, (x) => { x.fillStyle = "#4a4e50"; x.fillRect(6, 44, 2, 18); x.fillRect(56, 44, 2, 18); x.fillRect(4, 43, 56, 3); x.fillStyle = "#c9c7bc"; x.beginPath(); x.moveTo(4, 43); x.quadraticCurveTo(10, 28, 18, 33); x.quadraticCurveTo(26, 36, 34, 34); x.quadraticCurveTo(46, 30, 54, 36); x.lineTo(60, 43); x.closePath(); x.fill(); x.fillStyle = "rgba(120,10,10,0.8)"; x.beginPath(); x.ellipse(30, 38, 6, 3, 0, 0, 7); x.fill(); x.fillRect(29, 40, 1.5, 8); x.fillStyle = "#d8cfc0"; x.fillRect(55, 40, 4, 2); x.fillStyle = "#cbbfae"; x.fillRect(57, 42, 2, 5); shade(x, 64, 64); }); }
function iv() { return sprite(64, 64, (x) => { x.fillStyle = "#777"; x.fillRect(31, 6, 2, 56); x.fillRect(24, 60, 16, 2); x.fillRect(26, 6, 12, 1.5); x.fillStyle = "rgba(160,30,30,0.85)"; x.fillRect(27, 8, 6, 10); x.strokeStyle = "rgba(150,30,30,0.6)"; x.beginPath(); x.moveTo(30, 18); x.quadraticCurveTo(38, 40, 34, 58); x.stroke(); }); }
function pew() { return sprite(64, 64, (x) => { x.fillStyle = "#3d2414"; x.fillRect(2, 30, 60, 6); x.fillRect(2, 44, 60, 4); x.fillRect(4, 36, 4, 26); x.fillRect(56, 36, 4, 26); x.fillStyle = "#2b190e"; x.fillRect(2, 24, 60, 4); shade(x, 64, 64); }); }
function candles() {
    return sprite(64, 64, (x) => { x.fillStyle = "#2b1a10"; x.fillRect(16, 50, 32, 12); for (const [cx, h] of [[22, 16], [30, 22], [38, 12], [44, 18]]) { x.fillStyle = "#e5dcc0"; x.fillRect(cx, 50 - h, 4, h); x.fillStyle = "#ffcc55"; x.beginPath(); x.ellipse(cx + 2, 46 - h, 1.6, 3.5, 0, 0, 7); x.fill(); } },
        (e) => { for (const [cx, h] of [[22, 16], [30, 22], [38, 12], [44, 18]]) { e.fillStyle = "#ffd080"; e.beginPath(); e.ellipse(cx + 2, 46 - h, 2, 4, 0, 0, 7); e.fill(); } });
}
function opTable() { return sprite(64, 64, (x) => { x.fillStyle = "#606870"; x.fillRect(28, 44, 8, 18); x.fillRect(20, 60, 24, 3); x.fillStyle = "#8a959c"; x.fillRect(4, 38, 56, 6); x.fillStyle = "rgba(120,10,10,0.9)"; x.beginPath(); x.ellipse(28, 39, 14, 3, 0, 0, 7); x.fill(); for (let i = 0; i < 6; i++) x.fillRect(16 + i * 5, 43, 1.5, 6 + (i % 3) * 5); x.fillStyle = "#bbb"; x.fillRect(48, 34, 6, 1); x.fillRect(50, 33, 1, 3); shade(x, 64, 64); }); }
function crates() { return sprite(64, 64, (x) => { x.fillStyle = "#4a3a24"; x.fillRect(6, 34, 30, 28); x.fillRect(30, 44, 28, 18); x.strokeStyle = "#2a1f12"; x.lineWidth = 2; x.strokeRect(6, 34, 30, 28); x.strokeRect(30, 44, 28, 18); x.beginPath(); x.moveTo(6, 34); x.lineTo(36, 62); x.stroke(); shade(x, 64, 64); }); }
function desk() { return sprite(64, 64, (x) => { x.fillStyle = "#3b2618"; x.fillRect(4, 36, 56, 5); x.fillRect(6, 41, 4, 21); x.fillRect(54, 41, 4, 21); x.fillRect(38, 41, 16, 14); x.fillStyle = "#cfc6ae"; x.fillRect(12, 33, 10, 3); x.fillRect(16, 32, 9, 2); x.fillStyle = "#222"; x.fillRect(42, 26, 10, 10); shade(x, 64, 64); }); }
function ceilLamp() { return sprite(64, 64, (x) => { x.fillStyle = "#222"; x.fillRect(31, 0, 2, 10); x.fillStyle = "#3b3f3c"; x.beginPath(); x.moveTo(20, 16); x.lineTo(44, 16); x.lineTo(36, 10); x.lineTo(28, 10); x.closePath(); x.fill(); x.fillStyle = "#c8c0a0"; x.beginPath(); x.ellipse(32, 17, 5, 2.5, 0, 0, 7); x.fill(); }, (e) => { e.fillStyle = "#fff0c0"; e.beginPath(); e.ellipse(32, 17, 5, 2.5, 0, 0, 7); e.fill(); }); }
function redLamp() { return sprite(64, 64, (x) => { x.fillStyle = "#222"; x.fillRect(30, 0, 4, 4); x.fillStyle = "#8a1010"; x.beginPath(); x.arc(32, 7, 4, 0, 7); x.fill(); x.strokeStyle = "#333"; x.beginPath(); x.moveTo(28, 7); x.lineTo(36, 7); x.moveTo(32, 3); x.lineTo(32, 11); x.stroke(); }, (e) => { e.fillStyle = "#ff2010"; e.beginPath(); e.arc(32, 7, 4, 0, 7); e.fill(); }); }

function item(kind) {
    return sprite(64, 64, (x) => {
        x.save(); x.translate(32, 54);
        if (kind === "F") { x.rotate(-0.3); x.fillStyle = "#2b2d30"; x.fillRect(-12, -3, 18, 6); x.fillStyle = "#44474b"; x.fillRect(6, -5, 7, 10); x.fillStyle = "#e8e0b0"; x.fillRect(12, -4, 2, 8); }
        else if (kind === "+") { x.fillStyle = "#c08a20"; x.fillRect(-4, -12, 8, 14); x.fillStyle = "#222"; x.fillRect(-4, -12, 8, 5); x.fillStyle = "#aaa"; x.fillRect(-1.5, -14, 3, 2); }
        else if (kind === "y" || kind === "r") { x.fillStyle = kind === "y" ? "#e0b820" : "#c02020"; x.fillRect(-9, -8, 18, 12); x.fillStyle = "#111"; x.fillRect(-7, -5, 14, 2); x.fillStyle = "#eee"; x.fillRect(-7, -1, 6, 3); }
        else if (kind === "u") { x.fillStyle = "#9aa"; x.fillRect(-9, -6, 4, 8); x.fillRect(5, -6, 4, 8); x.fillStyle = "rgba(200,220,230,0.8)"; x.fillRect(-5, -5, 10, 6); x.fillStyle = "#e3a23a"; x.fillRect(-5, -3, 10, 2); }
        else if (kind === "n") { x.rotate(0.2); x.fillStyle = "#d9d0b4"; x.fillRect(-8, -4, 16, 5); x.fillStyle = "#7a6f58"; for (let i = 0; i < 3; i++) x.fillRect(-6, -3 + i * 1.4, 11, 0.6); }
        x.restore();
    }, (e) => {
        e.save(); e.translate(32, 54);
        const glow = { F: "#504a30", "+": "#402a08", y: "#5a4808", r: "#500808", u: "#5a3810", n: "#3a3628" }[kind];
        const g = e.createRadialGradient(0, -4, 0, 0, -4, 14); g.addColorStop(0, glow); g.addColorStop(1, "rgba(0,0,0,0)"); e.fillStyle = g; e.fillRect(-16, -20, 32, 28);
        e.restore();
    });
}

// a full-resolution face for the jump-scare
export function scareFace(size = 512) {
    const c = canvas(size, size), x = c.getContext("2d"), s = size / 512;
    x.scale(s, s);
    x.fillStyle = "#000"; x.fillRect(0, 0, 512, 512);
    const g = x.createRadialGradient(256, 250, 30, 256, 260, 240); g.addColorStop(0, "#efe9dc"); g.addColorStop(0.6, "#b9b2a3"); g.addColorStop(1, "#2a2622");
    x.fillStyle = g; x.beginPath(); x.ellipse(256, 270, 175, 240, 0, 0, 7); x.fill();
    // veins
    const R = rng(13); x.strokeStyle = "rgba(60,70,110,0.35)"; x.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { let px = 120 + R() * 270, py = 120 + R() * 300; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (R() - 0.5) * 30; py += (R() - 0.5) * 30; x.lineTo(px, py); } x.stroke(); }
    // eye sockets
    for (const ex of [176, 336]) {
        const eg = x.createRadialGradient(ex, 220, 5, ex, 220, 70); eg.addColorStop(0, "#000"); eg.addColorStop(0.7, "#0a0505"); eg.addColorStop(1, "rgba(40,20,20,0)");
        x.fillStyle = eg; x.beginPath(); x.ellipse(ex, 222, 66, 54, 0, 0, 7); x.fill();
        x.fillStyle = "#fff"; x.beginPath(); x.arc(ex + 4, 224, 5, 0, 7); x.fill();
        x.fillStyle = "rgba(120,0,0,0.9)"; x.fillRect(ex - 6, 262, 4, 70); x.fillRect(ex + 8, 268, 3, 50);
    }
    // mouth
    x.fillStyle = "#050202"; x.beginPath(); x.ellipse(256, 400, 92, 78, 0, 0, 7); x.fill();
    x.fillStyle = "#d8d0b8"; for (let i = 0; i < 11; i++) { const a = Math.PI * (0.1 + i * 0.08); x.beginPath(); x.moveTo(256 + Math.cos(a) * 92, 400 - Math.sin(a) * 74); x.lineTo(256 + Math.cos(a) * 64, 400 - Math.sin(a) * 50 + 14); x.lineTo(256 + Math.cos(a + 0.06) * 90, 400 - Math.sin(a + 0.06) * 72); x.fill(); x.beginPath(); x.moveTo(256 + Math.cos(-a) * 92, 400 - Math.sin(-a) * 74); x.lineTo(256 + Math.cos(-a) * 66, 400 - Math.sin(-a) * 52 - 14); x.lineTo(256 + Math.cos(-a - 0.06) * 90, 400 - Math.sin(-a - 0.06) * 72); x.fill(); }
    x.fillStyle = "rgba(110,0,0,0.8)"; x.fillRect(200, 470, 6, 42); x.fillRect(300, 460, 5, 52);
    // hair
    x.fillStyle = "#050404";
    x.beginPath(); x.moveTo(60, 512); x.quadraticCurveTo(40, 80, 256, 30); x.quadraticCurveTo(470, 80, 452, 512); x.lineTo(410, 512); x.quadraticCurveTo(430, 200, 330, 90); x.quadraticCurveTo(256, 150, 180, 90); x.quadraticCurveTo(80, 200, 100, 512); x.closePath(); x.fill();
    x.strokeStyle = "#050404"; x.lineWidth = 3; for (let i = 0; i < 30; i++) { const sx = 150 + R() * 210; x.beginPath(); x.moveTo(sx, 60); x.quadraticCurveTo(sx + (R() - 0.5) * 80, 200, sx + (R() - 0.5) * 120, 320 + R() * 120); x.stroke(); }
    // grain
    pix(c, (px, py, cc) => { const n = (Math.random() - 0.5) * 40; return [cc[0] + n, cc[1] + n, cc[2] + n, 255]; });
    return c;
}

export function buildTextures() {
    const T = {
        "#": plaster(1), B: brick(2), W: wood(3), T: tile(4), w: windowTex(5), L: locker(6),
        1: plaster(11, ["IT SEES", "YOU"]), 2: plaster(12, ["DON'T", "LOOK BACK"]), 3: plaster(13, ["SHE NEVER", "SLEEPS"]),
        D: doorTex("D", 7), Y: doorTex("Y", 8), R: doorTex("R", 9), E: doorTex("E", 10),
        Tb: tile(14, true),
    };
    T.gen = [0, 1, 2, 3].map((n) => generator(n, false)); T.genOn = generator(3, true);
    const F = { lino: floorTex("lino", 20), tile: floorTex("tile", 21), wood: floorTex("wood", 22), concrete: floorTex("concrete", 23), ceil: floorTex("ceil", 24), ceilwood: floorTex("ceilwood", 25) };
    const S = {
        b: bed(), c: wheelchair(), g: gurney(), i: iv(), p: pew(), k: candles(), o: opTable(), x: crates(), d: desk(), l: ceilLamp(), e: redLamp(),
        F: item("F"), "+": item("+"), y: item("y"), r: item("r"), u: item("u"), n: item("n"),
        m0: matron(0), m1: matron(1), m2: matron(2),
    };
    return { T, F, S };
}
