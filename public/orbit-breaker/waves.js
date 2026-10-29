// Orbit Breaker waves (DESIGN.md §1): each wave is a list of brick layers. A layer: rings [r0, r1], a count of
// sectors with a gap fraction, a type pattern and an optional rotation speed.
// Types: c crystal (1 HP), d double, t triple, m metal (unbreakable), b bomb, p prism (drops a power-up).
const L = (r0, r1, n, types, opt = {}) => ({ r0, r1, n, types, gap: opt.gap ?? 0.08, spin: opt.spin ?? 0, skip: opt.skip ?? null, phase: opt.phase ?? 0 });

export const WAVES = [
  { name: "First Light", layers: [L(4.6, 5.4, 16, "c"), L(5.6, 6.4, 20, "cccp")] },
  { name: "Twin Shells", layers: [L(3.2, 4.0, 12, "d"), L(5.0, 5.8, 18, "ccpc"), L(6.6, 7.2, 24, "c")] },
  { name: "Petals", layers: [L(2.2, 4.6, 6, "dcd", { gap: 0.35 }), L(5.2, 6.0, 18, "cbcp", { gap: 0.1 }), L(6.4, 7.0, 12, "c", { gap: 0.4 })] },
  { name: "Turning Gate", layers: [L(3.0, 3.8, 10, "m", { gap: 0.55, spin: 0.25 }), L(4.4, 5.2, 16, "dp"), L(6.0, 6.8, 22, "cccb", { spin: -0.12 })] },
  { name: "Checker", layers: [L(2.6, 3.4, 14, "cd"), L(3.6, 4.4, 14, "dc", { phase: 0.5 }), L(4.6, 5.4, 18, "cd"), L(5.6, 6.4, 18, "dc", { phase: 0.5 }), L(6.6, 7.2, 24, "cp")] },
  { name: "Spiral Arms", layers: [2.4, 3.2, 4.0, 4.8, 5.6, 6.4].map((r, i) => L(r, r + 0.7, 8, i % 2 ? "cpcc" : "dccc", { gap: 0.45, phase: i * 0.18 }))},
  { name: "Bomb Bay", layers: [L(3.0, 3.8, 12, "bdbd"), L(4.4, 5.2, 18, "cbcc"), L(5.8, 6.6, 22, "cdpb")] },
  { name: "Iron Halo", layers: [L(2.2, 2.8, 8, "m", { gap: 0.5, spin: 0.3 }), L(3.4, 4.2, 14, "tdp"), L(4.8, 5.4, 16, "m", { gap: 0.62, spin: -0.2 }), L(6.0, 6.8, 22, "dcc")] },
  { name: "Clockwork", layers: [L(2.8, 3.6, 10, "dt", { spin: 0.35 }), L(4.0, 4.8, 14, "cb", { spin: -0.3 }), L(5.2, 6.0, 18, "pdc", { spin: 0.22 }), L(6.4, 7.2, 22, "c", { spin: -0.16 })] },
  { name: "Lotus", layers: [L(1.8, 3.4, 8, "tdt", { gap: 0.3 }), L(3.6, 5.6, 8, "dcpc", { gap: 0.3, phase: 0.5 }), L(5.8, 7.0, 16, "ccbc", { gap: 0.15 })] },
  { name: "Fortress", layers: [L(2.0, 2.6, 10, "m", { gap: 0.4, spin: 0.4 }), L(2.9, 3.7, 12, "t"), L(4.1, 4.7, 14, "m", { gap: 0.55, spin: -0.3 }), L(5.1, 5.9, 18, "dpd"), L(6.3, 7.1, 24, "cbc")] },
  { name: "Supernova", layers: [L(1.6, 2.2, 8, "m", { gap: 0.35, spin: 0.5 }), L(2.5, 3.3, 12, "tbt"), L(3.6, 4.4, 14, "dpd", { spin: 0.18 }), L(4.8, 5.4, 16, "m", { gap: 0.58, spin: -0.25 }), L(5.8, 6.6, 20, "tdcb"), L(6.9, 7.5, 26, "cpc", { spin: 0.1 })] },
];
const HP = { c: 1, d: 2, t: 3, m: 999, b: 1, p: 1 };
export function buildWave(i) {
  const W = WAVES[i % WAVES.length], bricks = [];
  W.layers.forEach((ly, li) => {
    const span = (Math.PI * 2) / ly.n;
    for (let k = 0; k < ly.n; k++) {
      const type = ly.types[k % ly.types.length];
      const a0 = (k + ly.phase) * span + (span * ly.gap) / 2, a1 = (k + 1 + ly.phase) * span - (span * ly.gap) / 2;
      bricks.push({ r0: ly.r0, r1: ly.r1, a0, a1, type, hp: HP[type], max: HP[type], layer: li, spin: ly.spin, alive: true, hitT: 0 });
    }
  });
  return { name: W.name, bricks };
}
