// The 30-level journey. Each level: board mask (" " = no cell, "." = cell, "1"/"2" = cell with frost layers),
// colours, moves, goals and three star score thresholds. Thresholds were calibrated by simulating a greedy bot
// (see DESIGN.md) — `SCORE_PER_MOVE` is the bot's typical points per move for that board.

const SHAPES = {
    small: Array(6).fill("......"),
    seven: Array(7).fill("......."),
    full: Array(8).fill("........"),
    corners: ["  ....  ", "........", "........", "........", "........", "........", "........", "  ....  "],
    diamond: ["   ..   ", "  ....  ", " ...... ", "........", "........", " ...... ", "  ....  ", "   ..   "],
    octagon: ["  ....  ", " ...... ", "........", "........", "........", "........", " ...... ", "  ....  "],
    bowl: ["........", "........", "........", "........", "........", " ...... ", "  ....  ", "   ..   "],
    tower: ["   ..   ", "  ....  ", " ...... ", "........", "........", "........", "........", "........"],
    wide: Array(7).fill("........"),
};
// frost painters: return the layer count (0..2) for cell (r, c) on an R×C board
const FROST = {
    none: () => 0,
    center: (r, c, R, C) => (Math.abs(r - (R - 1) / 2) < 1.6 && Math.abs(c - (C - 1) / 2) < 1.6 ? 1 : 0),
    bottom: (r, c, R) => (r >= R - 2 ? 1 : 0),
    checker: (r, c) => ((r + c) % 2 === 0 ? 1 : 0),
    ring: (r, c, R, C) => (r === 0 || c === 0 || r === R - 1 || c === C - 1 ? 1 : 0),
    thick: (r, c, R, C) => (Math.abs(r - (R - 1) / 2) < 1.1 && Math.abs(c - (C - 1) / 2) < 1.1 ? 2 : Math.abs(r - (R - 1) / 2) < 2.6 && Math.abs(c - (C - 1) / 2) < 2.6 ? 1 : 0),
    stripes: (r, c) => (c % 3 === 1 ? 2 : 0),
    all: (r, c, R) => (r >= 2 ? 1 : 0),
};
const COLOR_NAMES = ["Ruby", "Sapphire", "Emerald", "Topaz", "Amethyst", "Diamond"];

//  shape, colours, moves, goal kind, frost pattern, collect colours
const TABLE = [
    ["small", 5, 18, "score", "none"], ["small", 5, 20, "collect", "none", [0, 1]], ["seven", 5, 20, "frost", "center"],
    ["seven", 5, 22, "score", "none"], ["full", 5, 22, "collect", "none", [2, 3]], ["corners", 5, 22, "frost", "bottom"],
    ["full", 6, 24, "score", "none"], ["diamond", 5, 22, "frost", "center"], ["octagon", 6, 24, "collect", "none", [4, 0, 1]],
    ["full", 6, 25, "frost", "checker"], ["bowl", 5, 24, "score", "none"], ["tower", 6, 25, "collect", "none", [5, 2]],
    ["wide", 6, 26, "frost", "bottom"], ["diamond", 6, 24, "mixed", "center", [3]], ["full", 6, 26, "score", "none"],
    ["octagon", 6, 26, "frost", "thick"], ["corners", 6, 25, "collect", "none", [0, 1, 2]], ["bowl", 6, 26, "frost", "stripes"],
    ["full", 6, 25, "mixed", "checker", [4]], ["tower", 6, 26, "score", "none"], ["wide", 6, 26, "frost", "all"],
    ["diamond", 6, 25, "collect", "none", [1, 3, 5]], ["full", 6, 27, "frost", "thick"], ["octagon", 6, 26, "mixed", "ring", [2, 5]],
    ["bowl", 6, 26, "score", "none"], ["corners", 6, 30, "frost", "all"], ["full", 6, 26, "collect", "none", [0, 2, 4]],
    ["tower", 6, 30, "mixed", "stripes", [1]], ["octagon", 6, 28, "frost", "thick"], ["full", 6, 28, "mixed", "all", [0, 3]],
];
const SCORE_PER_MOVE = { 5: 820, 6: 500 };

export const LEVELS = TABLE.map(([shape, colors, moves0, kind, frostKind, collect], i) => {
    const moves = moves0 + (kind === "frost" ? 6 : kind === "mixed" ? 6 : collect && collect.length > 2 ? 3 : 0);
    const n = i + 1;
    const base = SHAPES[shape];
    const R = base.length, C = base[0].length;
    const frost = kind === "frost" || kind === "mixed" ? FROST[frostKind] : FROST.none;
    const mask = base.map((row, r) => row.split("").map((ch, c) => (ch === " " ? " " : String(frost(r, c, R, C) || ".")).replace("0", ".")).join(""));
    const cells = base.join("").replace(/ /g, "").length;
    const expect = SCORE_PER_MOVE[colors] * moves * (1 + n * 0.012) * Math.pow(cells / 64, 0.7);
    const stars = [Math.round(expect * 0.55 / 100) * 100, Math.round(expect * 0.85 / 100) * 100, Math.round(expect * 1.15 / 100) * 100];
    const goals = [];
    if (kind === "score") goals.push({ kind: "score", target: stars[0] });
    if (kind === "collect" || kind === "mixed") for (const col of collect) goals.push({ kind: "collect", color: col, target: Math.round((kind === "mixed" ? 12 : collect.length > 2 ? 14 + n * 0.2 : 18 + n * 0.4) * (colors === 5 ? 1.15 : 1)) });
    if (kind === "frost" || kind === "mixed") goals.push({ kind: "frost" });
    return { n, shape, colors, moves, goals, stars, mask, name: `Level ${n}` };
});
export { COLOR_NAMES };
