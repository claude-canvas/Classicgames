// Blackmoor software renderer (DESIGN.md §4). Draws into a small RGBA buffer that the page scales up with
// crisp pixels. Walls via DDA (doors are slabs in the middle of their cell that slide open), floors and ceilings
// per pixel, depth-tested billboard sprites, a screen-space flashlight cone + a per-cell lightmap, and a
// post pass (vignette, grain, red danger pulse, chromatic split).

export const LMRES = 4;                      // lightmap samples per cell (each axis)

export class Renderer {
    constructor(canvas, assets) {
        this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: false });
        this.A = assets; this.W = 0; this.H = 0;
        this.noise = new Float32Array(65536); for (let i = 0; i < this.noise.length; i++) this.noise[i] = Math.random() - 0.5;
    }
    resize(W, H) {
        if (W === this.W && H === this.H) return;
        this.W = W; this.H = H; this.canvas.width = W; this.canvas.height = H;
        this.img = this.ctx.createImageData(W, H); this.buf = this.img.data;
        for (let i = 3; i < this.buf.length; i += 4) this.buf[i] = 255;
        this.copy = new Uint8ClampedArray(this.buf.length);
        this.z = new Float32Array(W);
        this.vig = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2 * (H / W) * 1.25; const r = Math.sqrt(dx * dx + dy * dy); this.vig[y * W + x] = Math.max(0, 1 - Math.pow(r * 0.78, 2.6)); }
        this.dx2 = new Float32Array(W); this.dy2 = new Float32Array(H * 3);
        this.coneLUT = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const r = Math.sqrt(i / 1023) * 1.6; this.coneLUT[i] = Math.max(0, 1 - smooth(0.12, 0.62, r)) * 0.92 + Math.max(0, 1 - smooth(0.3, 1.25, r)) * 0.16; }
    }

    render(world, cam, fx) {
        const { W, H, buf, z } = this, A = this.A;
        const grid = world.grid, GW = world.W, GH = world.H;
        const dirX = Math.cos(cam.ang), dirY = Math.sin(cam.ang), plane = 0.68, plX = -dirY * plane, plY = dirX * plane;
        const f = (W / 2) / plane;
        const horizon = Math.round(H / 2 + cam.pitch * H);
        const eye = cam.eyeZ;
        const LM = world.lm, LW = GW * LMRES, LH = GH * LMRES;
        const fl = fx.flash, flOn = fl.on && fl.k > 0.001, fr = fl.k * 1.9, fg = fl.k * 1.72, fb = fl.k * 1.42;
        const amb = world.ambient;
        // flashlight cone in screen space (centre sways with the walk)
        const cx = W / 2 + fl.sx * W, cy = horizon + fl.sy * H, invR = 1 / (W * 0.5);
        for (let x = 0; x < W; x++) { const d = (x - cx) * invR; this.dx2[x] = d * d; }
        const dy2 = new Float32Array(H); for (let y = 0; y < H; y++) { const d = (y - cy) * invR; dy2[y] = d * d; }
        const cone = this.coneLUT, coneK = 1023 / 2.56;
        const fall = (d) => 1 / (1 + d * d * 0.09);
        const lmAt = (wx, wy) => { let lx = (wx * LMRES) | 0, ly = (wy * LMRES) | 0; if (lx < 0) lx = 0; else if (lx >= LW) lx = LW - 1; if (ly < 0) ly = 0; else if (ly >= LH) ly = LH - 1; return (ly * LW + lx) * 3; };
        const floorT = world.floorT, ceilT = world.ceilT;
        // per-row distance + flashlight falloff (the same for every column)
        if (!this.rowD || this.rowD.length !== H) { this.rowD = new Float32Array(H); this.rowF = new Float32Array(H); }
        const rowDA = this.rowD, rowFA = this.rowF;
        for (let y = 0; y < H; y++) { const d = y > horizon ? eye * f / (y - horizon + 0.5) : y < horizon ? (1 - eye) * f / (horizon - y + 0.5) : 1e9; rowDA[y] = d; rowFA[y] = fall(d) * (y < horizon ? 0.8 : 1); }
        const LW3 = LW * 3;

        for (let x = 0; x < W; x++) {
            const camX = 2 * x / W - 1, rdx = dirX + plX * camX, rdy = dirY + plY * camX;
            let mx = Math.floor(cam.x), my = Math.floor(cam.y);
            const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
            let stepX, stepY, sdx, sdy;
            if (rdx < 0) { stepX = -1; sdx = (cam.x - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - cam.x) * ddx; }
            if (rdy < 0) { stepY = -1; sdy = (cam.y - my) * ddy; } else { stepY = 1; sdy = (my + 1 - cam.y) * ddy; }
            let side = 0, hit = null, dist = 30, texU = 0, tex = null, shadeSide = 1, guard = 0;
            while (guard++ < 96) {
                if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
                if (mx < 0 || my < 0 || mx >= GW || my >= GH) { dist = 30; break; }
                const ch = grid[my][mx];
                const door = world.doorAt[my * GW + mx];
                if (door) {
                    // slab through the middle of the cell
                    let t, u;
                    if (door.ns) { if (Math.abs(rdy) < 1e-6) continue; t = (my + 0.5 - cam.y) / rdy; u = cam.x + rdx * t - mx; }
                    else { if (Math.abs(rdx) < 1e-6) continue; t = (mx + 0.5 - cam.x) / rdx; u = cam.y + rdy * t - my; }
                    if (u < 0 || u >= 1 || t <= 0) continue;
                    if (u < door.open) continue;
                    dist = t; texU = u - door.open; tex = A.T[door.kind]; hit = door; shadeSide = door.ns ? 0.9 : 1; break;
                }
                if (world.solidWall[my * GW + mx]) {
                    dist = side === 0 ? sdx - ddx : sdy - ddy;
                    const wx = side === 0 ? cam.y + dist * rdy : cam.x + dist * rdx;
                    texU = wx - Math.floor(wx);
                    if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) texU = 1 - texU;
                    tex = world.wallTex(mx, my, ch); hit = ch; shadeSide = side ? 0.82 : 1; break;
                }
            }
            z[x] = dist;
            const lineH = f / dist;
            const top = horizon - (1 - eye) * lineH, bot = horizon + eye * lineH;
            const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H - 1, Math.floor(bot));
            const dx2 = this.dx2[x];
            if (tex) {
                // light at the hit point, nudged back toward the camera
                const hx = cam.x + rdx * dist * 0.985, hy = cam.y + rdy * dist * 0.985, li = lmAt(hx, hy);
                const lr = (LM[li] + amb) * shadeSide, lg = (LM[li + 1] + amb) * shadeSide, lb = (LM[li + 2] + amb) * shadeSide;
                const fd = fall(dist) * shadeSide;
                const tw = tex.w, th = tex.h, tu = Math.min(tw - 1, (texU * tw) | 0);
                const emitK = hit && hit.kind ? world.emit[hit.kind] || 0 : world.emit[hit] || 0;
                const tr = tex.r, tg = tex.g, tb = tex.b, te = tex.e;
                const vScale = th / lineH;
                for (let y = y0; y <= y1; y++) {
                    const tv = Math.min(th - 1, ((y - top) * vScale) | 0), ti = tv * tw + tu;
                    let k = 0;
                    if (flOn) { const r2 = (dx2 + dy2[y]) * coneK; k = cone[r2 > 1023 ? 1023 : r2 | 0] * fd; }
                    const e = te[ti] * emitK * 0.004;
                    const o = (y * W + x) * 4;
                    buf[o] = tr[ti] * (lr + k * fr + e); buf[o + 1] = tg[ti] * (lg + k * fg + e); buf[o + 2] = tb[ti] * (lb + k * fb + e);
                }
            }
            // floor + ceiling for this column
            for (let y = Math.max(y1 + 1, horizon + 1); y < H; y++) {
                const rowD = rowDA[y];
                const wx = cam.x + rdx * rowD, wy = cam.y + rdy * rowD;
                if (wx < 0 || wy < 0 || wx >= GW || wy >= GH) continue;
                const cxi = wx | 0, cyi = wy | 0;
                const t = floorT[cyi * GW + cxi];
                const ti = (((wy - cyi) * 64) & 63) * 64 + (((wx - cxi) * 64) & 63);
                const li = ((wy * LMRES) | 0) * LW3 + ((wx * LMRES) | 0) * 3;
                let k = 0;
                if (flOn) { const r2 = (dx2 + dy2[y]) * coneK; k = cone[r2 > 1023 ? 1023 : r2 | 0] * rowFA[y]; }
                const o = (y * W + x) * 4;
                buf[o] = t.r[ti] * (LM[li] + amb + k * fr); buf[o + 1] = t.g[ti] * (LM[li + 1] + amb + k * fg); buf[o + 2] = t.b[ti] * (LM[li + 2] + amb + k * fb);
            }
            for (let y = Math.min(y0 - 1, H - 1, horizon - 1); y >= 0; y--) {
                const rowD = rowDA[y];
                const wx = cam.x + rdx * rowD, wy = cam.y + rdy * rowD;
                if (wx < 0 || wy < 0 || wx >= GW || wy >= GH) continue;
                const cxi = wx | 0, cyi = wy | 0;
                const t = ceilT[cyi * GW + cxi];
                const ti = (((wy - cyi) * 64) & 63) * 64 + (((wx - cxi) * 64) & 63);
                const li = ((wy * LMRES) | 0) * LW3 + ((wx * LMRES) | 0) * 3;
                let k = 0;
                if (flOn) { const r2 = (dx2 + dy2[y]) * coneK; k = cone[r2 > 1023 ? 1023 : r2 | 0] * rowFA[y]; }
                const o = (y * W + x) * 4;
                buf[o] = t.r[ti] * ((LM[li] + amb) * 0.7 + k * fr); buf[o + 1] = t.g[ti] * ((LM[li + 1] + amb) * 0.7 + k * fg); buf[o + 2] = t.b[ti] * ((LM[li + 2] + amb) * 0.7 + k * fb);
            }
        }

        // sprites, far to near
        const invDet = 1 / (plX * dirY - dirX * plY);
        const list = [];
        for (const s of world.sprites) {
            if (s.hidden) continue;
            const sx = s.x - cam.x, sy = s.y - cam.y;
            const tx = invDet * (dirY * sx - dirX * sy), ty = invDet * (-plY * sx + plX * sy);
            if (ty < 0.15 || ty > 26) continue;
            list.push({ s, tx, ty });
        }
        list.sort((a, b) => b.ty - a.ty);
        for (const { s, tx, ty } of list) {
            const tex = s.tex, hW = s.h * (tex.w / tex.h) * (s.wScale || 1);
            const scrX = (W / 2) * (1 + tx / ty);
            const sh = f * s.h / ty, sw = f * hW / ty;
            const bottom = horizon + (eye - (s.z || 0)) * f / ty, top = bottom - sh;
            const x0 = Math.max(0, Math.ceil(scrX - sw / 2)), x1 = Math.min(W - 1, Math.floor(scrX + sw / 2));
            if (x1 < x0) continue;
            const yy0 = Math.max(0, Math.ceil(top)), yy1 = Math.min(H - 1, Math.floor(bottom));
            const li = lmAt(s.x, s.y);
            const lr = LM[li] + amb, lg = LM[li + 1] + amb, lb = LM[li + 2] + amb;
            const fd = fall(ty), emitK = (s.emit ?? 1) * 0.0045, tint = s.tint || 1;
            const tr = tex.r, tg = tex.g, tb = tex.b, ta = tex.a, te = tex.e, tw = tex.w, th = tex.h;
            for (let x = x0; x <= x1; x++) {
                if (ty >= z[x]) continue;
                let tu = (((x - (scrX - sw / 2)) / sw) * tw) | 0; if (s.flip) tu = tw - 1 - tu;
                if (tu < 0 || tu >= tw) continue;
                const dx2 = this.dx2[x];
                for (let y = yy0; y <= yy1; y++) {
                    const tv = (((y - top) / sh) * th) | 0;
                    if (tv < 0 || tv >= th) continue;
                    const ti = tv * tw + tu;
                    if (ta[ti] < 128) continue;
                    let k = 0;
                    if (flOn) { const r2 = (dx2 + dy2[y]) * coneK; k = cone[r2 > 1023 ? 1023 : r2 | 0] * fd; }
                    const e = te[ti] * emitK;
                    const o = (y * W + x) * 4;
                    buf[o] = tr[ti] * (lr + k * fr) * tint + tr[ti] * e; buf[o + 1] = tg[ti] * (lg + k * fg) * tint + tg[ti] * e; buf[o + 2] = tb[ti] * (lb + k * fb) * tint + tb[ti] * e;
                }
            }
            // glow halo for emissive sprites (lamps, candles)
            if (s.halo && s.halo[3] > 0.01) this.halo(scrX, (top + bottom) / 2 + (s.haloY || 0) * sh, Math.max(4, sh * 0.6), s.halo, ty);
        }
        if (fx.red > 0.01 || fx.chroma) this.post(fx);
        this.ctx.putImageData(this.img, 0, 0);
    }

    halo(cx, cy, r, c, depth) {
        const { W, H, buf, z } = this;
        const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(W - 1, (cx + r) | 0), y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(H - 1, (cy + r) | 0);
        for (let x = x0; x <= x1; x++) {
            if (depth > z[x] + 0.3) continue;
            for (let y = y0; y <= y1; y++) {
                const dx = (x - cx) / r, dy = (y - cy) / r, d = dx * dx + dy * dy;
                if (d >= 1) continue;
                const k = (1 - d) * (1 - d) * c[3] * 255, o = (y * W + x) * 4;
                buf[o] += c[0] * k; buf[o + 1] += c[1] * k; buf[o + 2] += c[2] * k;
            }
        }
    }

    post(fx) {
        const { W, H, buf, vig, noise } = this;
        const n0 = (Math.random() * 60000) | 0, grain = fx.grain * 255, red = fx.red, flick = fx.flicker || 1;
        const chroma = fx.chroma | 0;
        if (chroma) this.copy.set(buf);
        const cp = this.copy;
        for (let i = 0, p = 0; p < W * H; p++, i += 4) {
            const v = 1 - (1 - vig[p]) * red * 0.6, g = noise[(p + n0) & 65535] * grain * 0;
            let r = chroma ? cp[Math.min(W * H - 1, p + chroma) * 4] : buf[i];
            const gg = buf[i + 1], b = chroma ? cp[Math.max(0, p - chroma) * 4 + 2] : buf[i + 2];
            buf[i] = r * v * (1 + red * 0.8) + g + red * 30 * (1 - vig[p]);
            buf[i + 1] = gg * v * (1 - red * 0.35) + g;
            buf[i + 2] = b * v * (1 - red * 0.35) + g;
        }
    }
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
