// Ball textures and the sphere mesh. Each ball's surface is an equirectangular image in a 4×4 canvas atlas;
// the sphere template carries (u, v) per vertex, is rotated by the ball's quaternion every frame, and writes
// a smooth normal packed into pos.w / col.b (decoded in the vertex shader) so balls look perfectly round.

import { MAT } from "./mesh.js";
import { ballColor, isStripe, qrot, R } from "./physics.js";

export const CW = 256, CH = 128, ATLAS_W = 1024, ATLAS_H = 512;

export function buildAtlas() {
    const cv = document.createElement("canvas"); cv.width = ATLAS_W; cv.height = ATLAS_H;
    const g = cv.getContext("2d");
    for (let n = 0; n < 16; n++) {
        const x0 = (n % 4) * CW, y0 = Math.floor(n / 4) * CH;
        const col = ballColor(n).map((v) => Math.round(Math.min(1, v) * 255));
        const css = `rgb(${col[0]},${col[1]},${col[2]})`;
        g.fillStyle = n === 0 || isStripe(n) ? "#f4f1e6" : css; g.fillRect(x0, y0, CW, CH);
        if (isStripe(n)) { g.fillStyle = css; g.fillRect(x0, y0 + CH * 0.3, CW, CH * 0.4); }
        if (n === 0) {
            g.fillStyle = "#c8222a";
            for (const u of [0.25, 0.75]) { g.beginPath(); g.ellipse(x0 + u * CW, y0 + CH / 2, 9, 9, 0, 0, 7); g.fill(); }
            continue;
        }
        for (const u of [0.25, 0.75]) {
            const cx = x0 + u * CW, cy = y0 + CH / 2;
            g.fillStyle = "#f8f5ea"; g.beginPath(); g.ellipse(cx, cy, 26, 24, 0, 0, 7); g.fill();
            g.fillStyle = "#111"; g.font = `800 ${n > 9 ? 25 : 30}px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif`;
            g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), cx, cy + 1);
            if (n === 6 || n === 9) { g.fillRect(cx - 7, cy + 14, 14, 2.5); }
        }
    }
    return cv;
}

// unit sphere template: [x, y, z, u, v] per vertex, as triangles
const LAT = 12, LON = 22;
const TEMPLATE = (() => {
    const P = (i, j) => {
        const th = (j / LAT) * Math.PI, ph = (i / LON) * Math.PI * 2;
        return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th), i / LON, j / LAT];
    };
    const tris = [];
    for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        if (j > 0) tris.push(a, b, c);
        if (j < LAT - 1) tris.push(a, c, d);
    }
    return tris;
})();

// pack a unit normal into two floats the shader can unpack (x, y in 0..1023 each → one float; sign of z in col.b)
const pack = (nx, ny) => Math.round((nx * 0.5 + 0.5) * 1023) * 1024 + Math.round((ny * 0.5 + 0.5) * 1023);

export function drawBall(M, b, z, scale = 1, dim = 1) {
    const cx0 = (b.n % 4) * CW / ATLAS_W, cy0 = Math.floor(b.n / 4) * CH / ATLAS_H, cw = CW / ATLAS_W, ch = CH / ATLAS_H;
    const r = R * scale;
    for (const [x, y, zz, u, v] of TEMPLATE) {
        const n = qrot(b.q, [x, y, zz]);
        // col.b carries: sign of normal z (0 / 1) + dim × 2 (so 0..2 = dim, + 1 if nz ≥ 0)
        M.v(b.x + n[0] * r, b.y + n[1] * r, z + n[2] * r, pack(n[0], n[1]), cx0 + u * cw, cy0 + v * ch, (n[2] >= 0 ? 1 : 0) + Math.round(dim * 50) * 2, MAT.BALL);
    }
}
