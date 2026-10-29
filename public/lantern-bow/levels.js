// Lantern Bow stages (DESIGN.md §4). tod: 0 golden hour · 0.35 late sun · 0.6 dusk · 1 night.
// mato: [x, y, z] centre of a 1 m festival target facing the archer; slide: lateral amplitude (m) and period (s).
// gong: [x, y, z]; lanterns: how many rise, spawn interval, festival = fireworks on hit.

export const STAGES = [
  {
    name: "First Light", sub: "Three targets in the golden hour. The guide shows where your arrow will cross the target line.",
    tod: 0.0, wind: 1.5, arrows: 8, guide: true, stars: [50, 90, 130],
    mato: [{ p: [-2.2, 15, 1.1] }, { p: [1.6, 22, 1.2] }, { p: [-0.4, 28, 1.3] }],
  },
  {
    name: "Bronze Voice", sub: "The great gong waits by the torii. Wind is picking up: read the banners.",
    tod: 0.12, wind: 3, arrows: 8, guide: "near", stars: [60, 110, 160],
    mato: [{ p: [-3.0, 18, 1.1] }, { p: [2.8, 26, 1.2] }], gong: [0.2, 38, 2.6],
  },
  {
    name: "Gliding Rings", sub: "Two targets glide on their rails. Lead them.",
    tod: 0.35, wind: 3.5, arrows: 10, guide: false, stars: [70, 130, 190],
    mato: [{ p: [0, 20, 1.2], slide: [3.5, 5.5] }, { p: [0, 30, 1.4], slide: [4.5, 7.5] }, { p: [3.6, 24, 1.1] }],
  },
  {
    name: "Lantern Dusk", sub: "Sky lanterns drift up from the garden as the sun goes down.",
    tod: 0.62, wind: 3, arrows: 10, guide: false, stars: [80, 150, 220],
    mato: [{ p: [-2.6, 22, 1.2] }], lanterns: { count: 7, every: 3.2 },
  },
  {
    name: "Moonrise", sub: "Moonlight, fireflies, and targets lit by their own lamps.",
    tod: 1, wind: 4, arrows: 12, guide: false, stars: [100, 180, 260],
    mato: [{ p: [-3.2, 19, 1.1] }, { p: [0, 27, 1.3], slide: [3.8, 6.5] }], lanterns: { count: 6, every: 4 }, night: true,
  },
  {
    name: "Festival of Lights", sub: "Every lantern you hit bursts into fireworks over the mountains.",
    tod: 1, wind: 5, arrows: 15, guide: false, stars: [150, 260, 380],
    mato: [{ p: [3.4, 24, 1.2] }], gong: [-2.4, 38, 2.6], lanterns: { count: 14, every: 2.3, festival: true }, night: true,
  },
];
