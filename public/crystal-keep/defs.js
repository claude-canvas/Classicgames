// Tower, enemy and difficulty definitions. Ranges and splash radii are in cells (1 cell = 2 world units),
// speeds in cells per second, rates in seconds between shots.

export const TOWERS = {
    archer: {
        id: "archer", name: "Archer Spire", key: "1", air: true, css: "#7fdcff", crystal: [0.35, 0.95, 1.35],
        blurb: "Fast, precise bolts. Hits flyers.",
        levels: [
            { cost: 60, dmg: 12, rate: 0.6, range: 3.2 },
            { cost: 70, dmg: 20, rate: 0.5, range: 3.4 },
            { cost: 120, dmg: 36, rate: 0.4, range: 3.7 },
        ],
    },
    cannon: {
        id: "cannon", name: "Ember Cannon", key: "2", air: false, css: "#ff9a4d", crystal: [1.5, 0.6, 0.15],
        blurb: "Explosive shells hit a crowd. Ground only.",
        levels: [
            { cost: 100, dmg: 32, rate: 1.6, range: 2.8, splash: 1.1 },
            { cost: 140, dmg: 55, rate: 1.45, range: 3.0, splash: 1.2 },
            { cost: 220, dmg: 90, rate: 1.3, range: 3.2, splash: 1.35 },
        ],
    },
    frost: {
        id: "frost", name: "Frost Crystal", key: "3", air: true, css: "#bfe9ff", crystal: [0.75, 1.15, 1.45],
        blurb: "Chills an area, slowing everything in it.",
        levels: [
            { cost: 80, dmg: 6, rate: 1.0, range: 2.5, slow: 0.4, slowR: 0.9, slowT: 1.6 },
            { cost: 90, dmg: 10, rate: 0.9, range: 2.75, slow: 0.5, slowR: 1.0, slowT: 1.8 },
            { cost: 150, dmg: 16, rate: 0.8, range: 3.0, slow: 0.6, slowR: 1.15, slowT: 2.0 },
        ],
    },
    storm: {
        id: "storm", name: "Storm Obelisk", key: "4", air: true, css: "#c49bff", crystal: [0.95, 0.55, 1.5],
        blurb: "Lightning leaps between enemies.",
        levels: [
            { cost: 140, dmg: 26, rate: 1.2, range: 3.0, chain: 3 },
            { cost: 160, dmg: 40, rate: 1.08, range: 3.25, chain: 4 },
            { cost: 260, dmg: 60, rate: 0.95, range: 3.5, chain: 6 },
        ],
    },
};
export const TOWER_ORDER = ["archer", "cannon", "frost", "storm"];
export const PRIORITIES = ["first", "last", "strong", "close"];

export const ENEMIES = {
    imp: { name: "Imp", hp: 40, speed: 1.6, armor: 0, bounty: 4, leak: 1, size: 0.45 },
    brute: { name: "Brute", hp: 150, speed: 0.85, armor: 4, bounty: 11, leak: 2, size: 0.75 },
    wisp: { name: "Wisp", hp: 55, speed: 1.35, armor: 0, bounty: 7, leak: 1, size: 0.5, air: true },
    slime: { name: "Slime", hp: 90, speed: 1.0, armor: 0, bounty: 8, leak: 1, size: 0.6, split: "slimeling" },
    slimeling: { name: "Slimeling", hp: 30, speed: 1.25, armor: 0, bounty: 2, leak: 1, size: 0.36 },
    golem: { name: "Golem", hp: 1500, speed: 0.55, armor: 8, bounty: 120, leak: 10, size: 1.3, boss: true },
};
export const ENEMY_CSS = { imp: "#ff6b5b", brute: "#9aa3b5", wisp: "#c48bff", slime: "#7fe08a", slimeling: "#7fe08a", golem: "#ffa04d" };

export const DIFFS = {
    casual: { id: "casual", name: "Casual", lives: 30, gold: 320, hp: 0.75, timer: 25 },
    normal: { id: "normal", name: "Normal", lives: 20, gold: 240, hp: 1.0, timer: 15 },
    heroic: { id: "heroic", name: "Heroic", lives: 10, gold: 240, hp: 1.15, timer: 12 },
};
export const hpScale = (wave) => 1 + 0.07 * wave + 0.013 * wave * wave;
export const SELL_REFUND = 0.7;
