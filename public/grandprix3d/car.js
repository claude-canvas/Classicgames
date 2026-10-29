// Grand Prix 3D open-wheel car, built from lofted cross-sections. Local space: x right, y forward, z up; the car is
// 5.6 m long and 2.0 m wide over the wheels. Triangles are [a, b, c, slot]; the renderer picks colour and material
// from the slot so every team can share one model:
//   paint, accent (livery), carbon, helmet, visor, tyre, stripe (tyre compound band), rim, light (rain light)

const out = [];
const T = (a, b, c, s) => out.push([a, b, c, s]);
const Q = (a, b, c, d, s) => { T(a, b, c, s); T(a, c, d, s); };

// a solid along y through trapezoid sections { y, cx, wb (half width at the bottom), wt (top), z0, z1 }
function loft(secs, slot, capSlot = slot, topSlot = slot) {
    const P = (s) => ({ bl: [s.cx - s.wb, s.y, s.z0], br: [s.cx + s.wb, s.y, s.z0], tl: [s.cx - s.wt, s.y, s.z1], tr: [s.cx + s.wt, s.y, s.z1] });
    for (let i = 0; i < secs.length - 1; i++) {
        const a = P(secs[i]), b = P(secs[i + 1]);
        Q(a.tl, a.tr, b.tr, b.tl, topSlot);
        Q(a.bl, a.tl, b.tl, b.bl, slot);
        Q(a.tr, a.br, b.br, b.tr, slot);
        Q(a.bl, b.bl, b.br, a.br, "carbon");
    }
    for (const s of [secs[0], secs[secs.length - 1]]) { const p = P(s); Q(p.bl, p.br, p.tr, p.tl, s === secs[0] ? capSlot : slot); }
}
function box(x0, x1, y0, y1, z0, z1, slot, topSlot = slot) { loft([{ y: y0, cx: (x0 + x1) / 2, wb: (x1 - x0) / 2, wt: (x1 - x0) / 2, z0, z1 }, { y: y1, cx: (x0 + x1) / 2, wb: (x1 - x0) / 2, wt: (x1 - x0) / 2, z0, z1 }], slot, slot, topSlot); }
// a thin square tube between two points
function bar(a, b, r, slot) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d), u = d.map((v) => v / l);
    const ref = Math.abs(u[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    let e1 = cr(u, ref); const l1 = Math.hypot(...e1); e1 = e1.map((v) => v / l1 * r);
    const e2 = cr(u, e1).map((v) => v);
    const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) => [e1[0] * i + e2[0] * j, e1[1] * i + e2[1] * j, e1[2] * i + e2[2] * j]);
    for (let k = 0; k < 4; k++) {
        const c0 = C[k], c1 = C[(k + 1) % 4];
        Q([a[0] + c0[0], a[1] + c0[1], a[2] + c0[2]], [a[0] + c1[0], a[1] + c1[1], a[2] + c1[2]], [b[0] + c1[0], b[1] + c1[1], b[2] + c1[2]], [b[0] + c0[0], b[1] + c0[1], b[2] + c0[2]], slot);
    }
}

// ---- floor and diffuser
box(-0.82, 0.82, -2.15, 1.2, 0.05, 0.09, "carbon");
loft([{ y: -2.15, cx: 0, wb: 0.55, wt: 0.55, z0: 0.06, z1: 0.1 }, { y: -2.75, cx: 0, wb: 0.55, wt: 0.55, z0: 0.3, z1: 0.34 }], "carbon");
// ---- front wing: main plane, an accent flap each side, end plates
box(-1.0, 1.0, 2.3, 2.75, 0.07, 0.11, "carbon");
for (const s of [-1, 1]) {
    loft([{ y: 2.32, cx: s * 0.68, wb: 0.32, wt: 0.32, z0: 0.16, z1: 0.19 }, { y: 2.52, cx: s * 0.68, wb: 0.32, wt: 0.32, z0: 0.12, z1: 0.15 }], "accent");
    box(s * 1.0 - 0.025, s * 1.0 + 0.025, 2.22, 2.78, 0.05, 0.36, "paint");
    box(s * 0.12 - 0.02, s * 0.12 + 0.02, 2.35, 2.6, 0.1, 0.26, "carbon");            // nose pylons
}
// ---- nose and chassis
loft([
    { y: 2.68, cx: 0, wb: 0.09, wt: 0.07, z0: 0.22, z1: 0.3 },
    { y: 2.1, cx: 0, wb: 0.18, wt: 0.15, z0: 0.24, z1: 0.44 },
    { y: 1.35, cx: 0, wb: 0.3, wt: 0.25, z0: 0.24, z1: 0.6 },
    { y: 0.6, cx: 0, wb: 0.4, wt: 0.33, z0: 0.14, z1: 0.68 },
    { y: -0.35, cx: 0, wb: 0.4, wt: 0.33, z0: 0.14, z1: 0.68 },
], "paint", "accent");
box(-0.2, 0.2, -0.3, 0.62, 0.66, 0.69, "carbon");                                     // cockpit opening
// helmet: a low-poly ball with a visor band
{
    const cx = 0, cy = 0.02, cz = 0.82, r = 0.15, lat = 5, lon = 10;
    const p = (i, j) => { const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2; return [cx + Math.sin(th) * Math.cos(ph) * r, cy + Math.sin(th) * Math.sin(ph) * r * 1.12, cz + Math.cos(th) * r]; };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
        const front = Math.sin((j + 0.5) / lon * Math.PI * 2) > 0.45 && i === 2;
        Q(p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1), front ? "visor" : "helmet");
    }
}
// halo: a centre strut and a hoop around the driver's head
{
    const z = 0.96, pts = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); pts.push([Math.cos(a) * 0.3, 0.08 + Math.sin(a) * 0.38, z]); }
    for (let k = 0; k < pts.length - 1; k++) bar(pts[k], pts[k + 1], 0.025, "carbon");
    bar([0, 0.78, 0.66], [0, 0.46, z], 0.03, "carbon");
    bar(pts[0], [0.32, -0.22, 0.68], 0.03, "carbon"); bar(pts[10], [-0.32, -0.22, 0.68], 0.03, "carbon");
}
// mirrors
for (const s of [-1, 1]) { bar([s * 0.34, 0.66, 0.64], [s * 0.5, 0.66, 0.74], 0.015, "carbon"); box(s * 0.5 - 0.08, s * 0.5 + 0.08, 0.6, 0.7, 0.7, 0.78, "paint"); }
// ---- sidepods (dark intakes at the front)
for (const s of [-1, 1]) loft([
    { y: 0.62, cx: s * 0.62, wb: 0.23, wt: 0.2, z0: 0.12, z1: 0.56 },
    { y: 0.3, cx: s * 0.66, wb: 0.26, wt: 0.22, z0: 0.1, z1: 0.6 },
    { y: -0.6, cx: s * 0.6, wb: 0.23, wt: 0.17, z0: 0.1, z1: 0.52 },
    { y: -1.55, cx: s * 0.4, wb: 0.12, wt: 0.07, z0: 0.12, z1: 0.36 },
], "paint", "carbon", "accent");
// ---- engine cover with the airbox above the driver, and a shark fin
loft([
    { y: -0.18, cx: 0, wb: 0.3, wt: 0.15, z0: 0.5, z1: 1.08 },
    { y: -0.55, cx: 0, wb: 0.3, wt: 0.12, z0: 0.4, z1: 1.02 },
    { y: -1.45, cx: 0, wb: 0.24, wt: 0.07, z0: 0.3, z1: 0.72 },
    { y: -2.4, cx: 0, wb: 0.1, wt: 0.04, z0: 0.28, z1: 0.42 },
], "paint", "carbon");
T([0, -0.6, 1.0], [0, -2.15, 0.84], [0, -2.15, 0.5], "accent");
T([0, -0.6, 1.0], [0, -2.15, 0.5], [0, -1.4, 0.72], "accent");
// ---- rear wing: main plane, flap, end plates, beam wing, pylon
loft([{ y: -2.42, cx: 0, wb: 0.6, wt: 0.6, z0: 0.86, z1: 0.9 }, { y: -2.75, cx: 0, wb: 0.6, wt: 0.6, z0: 0.92, z1: 0.96 }], "carbon");
loft([{ y: -2.62, cx: 0, wb: 0.6, wt: 0.6, z0: 1.0, z1: 1.03 }, { y: -2.88, cx: 0, wb: 0.6, wt: 0.6, z0: 1.07, z1: 1.1 }], "accent");
for (const s of [-1, 1]) box(s * 0.62 - 0.025, s * 0.62 + 0.025, -2.92, -2.3, 0.42, 1.14, "paint");
box(-0.5, 0.5, -2.75, -2.55, 0.5, 0.54, "carbon");
box(-0.03, 0.03, -2.6, -2.3, 0.4, 0.88, "carbon");
box(-0.06, 0.06, -2.94, -2.88, 0.5, 0.6, "light");
// ---- suspension arms to the wheel centres
export const WHEELS = [   // [x, y, radius, width, front]
    [-0.84, 1.8, 0.34, 0.3, true], [0.84, 1.8, 0.34, 0.3, true],
    [-0.82, -1.6, 0.36, 0.4, false], [0.82, -1.6, 0.36, 0.4, false],
];
for (const [x, y, r, w, front] of WHEELS) {
    const s = Math.sign(x), hub = [x - s * w * 0.4, y, r];
    const body = front ? 0.28 : 0.3;
    bar([s * body, y + 0.25, 0.42], hub, 0.022, "carbon");
    bar([s * body, y - 0.25, 0.42], hub, 0.022, "carbon");
    bar([s * body, y + 0.2, 0.2], [hub[0], hub[1], r - 0.1], 0.022, "carbon");
    bar([s * body, y - 0.3, 0.2], [hub[0], hub[1], r - 0.1], 0.022, "carbon");
}
export const BODY = out.slice();

// one wheel at the origin, axle along x
export function wheel(r, w) {
    const o = [], seg = 14, t = (a, b, c, s) => o.push([a, b, c, s]), q = (a, b, c, d, s) => { t(a, b, c, s); t(a, c, d, s); };
    const P = (a, rr, x) => [x, Math.cos(a) * rr, Math.sin(a) * rr];
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        q(P(a0, r, -w / 2), P(a1, r, -w / 2), P(a1, r, w / 2), P(a0, r, w / 2), "tyre");
        for (const x of [-w / 2, w / 2]) {
            q(P(a0, r, x), P(a1, r, x), P(a1, r * 0.86, x), P(a0, r * 0.86, x), "tyre");
            q(P(a0, r * 0.86, x), P(a1, r * 0.86, x), P(a1, r * 0.79, x), P(a0, r * 0.79, x), "stripe");
            q(P(a0, r * 0.79, x), P(a1, r * 0.79, x), P(a1, r * 0.68, x), P(a0, r * 0.68, x), "tyre");
            t(P(a0, r * 0.68, x * 0.7), P(a1, r * 0.68, x * 0.7), [x * 0.4, 0, 0], i % 2 ? "rim" : "carbon");
        }
    }
    return o;
}
