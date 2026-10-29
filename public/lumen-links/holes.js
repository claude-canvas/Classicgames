// Lumen Links course (DESIGN.md §2): nine holes. Units are metres; +y runs from the tee toward the cup. Walls are
// generated along the fairway outline (except edges listed in `open`), plus any `walls` given explicitly.
const gauss = (x, y, cx, cy, s, a) => a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s));
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ellipse = (cx, cy, rx, ry, n = 20) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry]);

const RAW = [
  { name: "Lantern Lane", par: 2, tee: [0, 0.5], cup: [0, 6.3], fairway: rect(-0.6, 0, 0.6, 7),
    h: (x, y) => 0.12 - y * 0.012 + gauss(x, y, 0.25, 3.4, 0.35, 0.03), lanterns: [[-0.75, 1.5], [0.75, 3], [-0.75, 4.5], [0.75, 6]] },
  { name: "Dogleg Bend", par: 2, tee: [0, 0.5], cup: [3.9, 5.0], fairway: [[-0.6, 0], [0.6, 0], [0.6, 4.4], [4.6, 4.4], [4.6, 5.6], [-0.6, 5.6]],
    h: (x, y) => gauss(x, y, 0, 5.0, 0.6, 0.05), lanterns: [[-0.75, 2], [0.75, 3.8], [2.5, 5.75], [4.75, 4.2]] },
  { name: "Mushroom Ring", par: 3, tee: [0, 0.5], cup: [0, 4.7], fairway: rect(-1.6, 0, 1.6, 6.2),
    h: (x, y) => 0.1 * (1 - smoothstep(0.7, 1.15, Math.hypot(x, y - 4.7))),
    bumpers: [0, 1, 2, 3, 4].map((i) => { const a = Math.PI * (0.25 + i * 0.4); return { x: Math.cos(a) * 0.85, y: 4.7 + Math.sin(a) * 0.85, r: 0.16 }; }).concat([{ x: -0.9, y: 2.6, r: 0.2 }, { x: 0.9, y: 2.2, r: 0.2 }]),
    lanterns: [[-1.75, 1], [1.75, 1], [-1.75, 5], [1.75, 5]] },
  { name: "The Windmill", par: 3, tee: [0, 0.5], cup: [0, 8.1], fairway: rect(-0.8, 0, 0.8, 9),
    walls: [[-0.8, 5, -0.2, 5], [0.2, 5, 0.8, 5], [-0.2, 5, -0.2, 5.7], [0.2, 5, 0.2, 5.7], [-0.8, 5.7, -0.2, 5.7], [0.2, 5.7, 0.8, 5.7]],
    moving: [{ type: "windmill", x: 0, y: 4.94, w: 0.2, speed: 1.2, block: 0.32 }],
    h: (x, y) => gauss(x, y, 0, 7.4, 0.5, 0.04) - y * 0.004, windmill: [0, 5.35], lanterns: [[-0.95, 2], [0.95, 2], [-0.95, 7.5], [0.95, 7.5]] },
  { name: "Lily Pond", par: 3, tee: [0, 0.5], cup: [0, 8.1], fairway: rect(-1.6, 0, 1.6, 9),
    water: [ellipse(0, 4.5, 1.05, 1.5, 24)], bridges: [rect(-0.2, 2.95, 0.2, 6.05)],
    h: (x, y) => 0, lilies: [[-0.5, 4.0], [0.6, 5.0], [-0.4, 5.5], [0.5, 3.6]], lanterns: [[-1.75, 2], [1.75, 2], [-1.75, 7], [1.75, 7]] },
  { name: "Volcano", par: 3, tee: [0, 0.5], cup: [0, 4.9], fairway: rect(-1.4, 0, 1.4, 7.2),
    h: (x, y) => gauss(x, y, 0, 4.9, 0.7, 0.32) - gauss(x, y, 0, 4.9, 0.16, 0.035), lanterns: [[-1.55, 1.5], [1.55, 1.5], [-1.55, 6.5], [1.55, 6.5]] },
  { name: "Garden Gates", par: 3, tee: [0, 0.5], cup: [0, 9.2], fairway: rect(-1.0, 0, 1.0, 10),
    moving: [{ type: "gate", x0: -1.0, x1: 1.0, y: 3.5, cx: 0, amp: 0.6, gap: 0.5, speed: 1.1, ph: 0 }, { type: "gate", x0: -1.0, x1: 1.0, y: 6.5, cx: 0, amp: 0.6, gap: 0.5, speed: 1.45, ph: 2 }],
    h: (x, y) => -y * 0.006, lanterns: [[-1.15, 3.5], [1.15, 3.5], [-1.15, 6.5], [1.15, 6.5]] },
  { name: "Switchbacks", par: 4, tee: [0.6, 0.5], cup: [0.6, 10.5], fairway: [[0, 0], [1.2, 0], [1.2, 3.0], [4.4, 3.0], [4.4, 8.2], [1.2, 8.2], [1.2, 11.2], [0, 11.2], [0, 7.0], [3.2, 7.0], [3.2, 4.2], [0, 4.2]],
    h: (x, y) => 0.5 - y * 0.035 + gauss(x, y, 4.2, 3.2, 0.5, 0.06) + gauss(x, y, 0.2, 8.0, 0.5, 0.06), sand: [rect(3.3, 5.2, 4.3, 6.0)], lanterns: [[-0.15, 2], [4.55, 3.5], [4.55, 7.5], [-0.15, 9]] },
  { name: "Starfall Finale", par: 4, tee: [0, 0.5], cup: [0.22, 10.3], fairway: rect(-1.0, 0, 1.0, 12),
    pits: [rect(-1.0, 5.0, -0.22, 6.0), rect(0.22, 5.0, 1.0, 6.0)], bridges: [rect(-0.22, 5.0, 0.22, 6.0)],
    walls: [[-0.22, 5.0, -0.22, 6.0], [0.22, 5.0, 0.22, 6.0]],
    h: (x, y) => 0.15 - y * 0.01 - gauss(x, y, 0, 10.3, 0.75, 0.16) + gauss(x, y, 0, 2.8, 0.45, 0.06),
    bumpers: [{ x: -0.55, y: 8.2, r: 0.14 }, { x: 0.55, y: 8.2, r: 0.14 }], star: [0, 10.3], lanterns: [[-1.15, 3], [1.15, 3], [-1.15, 9], [1.15, 9], [-1.15, 11.5], [1.15, 11.5]] },
];
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export const HOLES = RAW.map((h, i) => {
  const walls = [], open = new Set(h.open || []), F = h.fairway;
  for (let k = 0; k < F.length; k++) if (!open.has(k)) { const a = F[k], b = F[(k + 1) % F.length]; walls.push([a[0], a[1], b[0], b[1], 0, 0]); }
  for (const w of h.walls || []) walls.push([...w, 0, 0]);
  // the starfall bridge sides are open pits: those two short walls guard only the bridge edges, keep them low
  return { ...h, index: i, staticWalls: walls };
});
