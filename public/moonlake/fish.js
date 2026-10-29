// The 15 species of Moonlake and their parametric 3D model.
// zone: shallows | reeds | rocks | deep · time: dusk | night | dawn | any · lure: spinner | fly | glow
// weight in kg, len in metres (model scale), fight: power (pull), stamina (seconds of reeling), erratic (0..1)

export const RARITY = { common: { name: "Common", css: "#b9d4c6" }, uncommon: { name: "Uncommon", css: "#7fd0ff" }, rare: { name: "Rare", css: "#d39bff" }, legendary: { name: "Legendary", css: "#ffcf6a" } };

export const SPECIES = [
    { id: "bluegill", name: "Bluegill", rarity: "common", zone: "shallows", time: "any", lure: "fly", w: [0.1, 0.7], len: [0.16, 0.26], depth: 0.62, top: [0.15, 0.3, 0.35], flank: [0.3, 0.55, 0.5], belly: [0.95, 0.55, 0.2], fin: [0.2, 0.35, 0.4], pattern: "stripes", power: 0.35, stamina: 3, erratic: 0.5, desc: "A plucky little sunfish with a sunset belly. Loves flies near the lily pads." },
    { id: "perch", name: "Yellow Perch", rarity: "common", zone: "reeds", time: "any", lure: "spinner", w: [0.2, 1.3], len: [0.2, 0.35], depth: 0.38, top: [0.35, 0.4, 0.15], flank: [0.85, 0.75, 0.25], belly: [0.95, 0.92, 0.8], fin: [0.9, 0.4, 0.15], pattern: "stripes", power: 0.4, stamina: 3.5, erratic: 0.4, desc: "Banded like the reeds it hides in. Bites at almost any hour." },
    { id: "crappie", name: "Speckled Crappie", rarity: "common", zone: "rocks", time: "dusk", lure: "fly", w: [0.2, 1.0], len: [0.2, 0.32], depth: 0.5, top: [0.25, 0.3, 0.28], flank: [0.75, 0.8, 0.78], belly: [0.95, 0.95, 0.92], fin: [0.4, 0.45, 0.4], pattern: "spots", power: 0.38, stamina: 3, erratic: 0.6, desc: "Silver with ink-dot speckles. Gathers around the rocks as the sun goes down." },
    { id: "trout", name: "Rainbow Trout", rarity: "common", zone: "deep", time: "dawn", lure: "spinner", w: [0.5, 4], len: [0.3, 0.6], depth: 0.3, top: [0.25, 0.35, 0.2], flank: [0.8, 0.75, 0.7], belly: [0.98, 0.95, 0.9], fin: [0.75, 0.45, 0.45], pattern: "trout", power: 0.6, stamina: 5, erratic: 0.7, desc: "A rose stripe along a speckled flank. Leaps when hooked — hold steady." },
    { id: "bass", name: "Largemouth Bass", rarity: "common", zone: "reeds", time: "any", lure: "spinner", w: [0.5, 5], len: [0.3, 0.6], depth: 0.4, top: [0.15, 0.28, 0.12], flank: [0.45, 0.58, 0.3], belly: [0.92, 0.92, 0.8], fin: [0.3, 0.4, 0.2], pattern: "lateral", power: 0.65, stamina: 5.5, erratic: 0.5, desc: "The reeds' bully. A big mouth and a stubborn pull." },
    { id: "carp", name: "Golden Carp", rarity: "uncommon", zone: "shallows", time: "any", lure: "fly", w: [1, 9], len: [0.4, 0.8], depth: 0.42, top: [0.55, 0.38, 0.1], flank: [1.0, 0.75, 0.25], belly: [1.0, 0.92, 0.7], fin: [0.9, 0.55, 0.2], pattern: "scales", power: 0.75, stamina: 7, erratic: 0.25, desc: "Polished like an old coin. Slow, heavy and impossibly patient." },
    { id: "pike", name: "Northern Pike", rarity: "uncommon", zone: "reeds", time: "dusk", lure: "spinner", w: [1, 12], len: [0.6, 1.1], depth: 0.2, top: [0.12, 0.22, 0.12], flank: [0.35, 0.5, 0.25], belly: [0.9, 0.9, 0.75], fin: [0.55, 0.35, 0.2], pattern: "pike", power: 0.85, stamina: 6, erratic: 0.8, desc: "An ambush hunter with a mouth full of needles. Strikes like lightning at dusk and dawn." },
    { id: "catfish", name: "Channel Catfish", rarity: "uncommon", zone: "deep", time: "night", lure: "glow", w: [1, 15], len: [0.5, 1.0], depth: 0.25, top: [0.2, 0.22, 0.25], flank: [0.45, 0.48, 0.52], belly: [0.9, 0.9, 0.88], fin: [0.25, 0.26, 0.28], pattern: "whiskers", power: 0.8, stamina: 8, erratic: 0.2, desc: "Feels its way through the dark mud with long whiskers. Follows glowing things." },
    { id: "koi", name: "Dawn Koi", rarity: "uncommon", zone: "shallows", time: "dawn", lure: "fly", w: [1, 6], len: [0.4, 0.7], depth: 0.36, top: [0.98, 0.95, 0.92], flank: [0.98, 0.95, 0.92], belly: [1, 1, 0.98], fin: [1, 0.9, 0.85], pattern: "koi", power: 0.55, stamina: 5, erratic: 0.3, desc: "Someone released it here long ago. It only rises when the sky turns pink." },
    { id: "walleye", name: "Walleye", rarity: "uncommon", zone: "deep", time: "night", lure: "spinner", w: [1, 6], len: [0.4, 0.7], depth: 0.25, top: [0.35, 0.32, 0.15], flank: [0.7, 0.62, 0.3], belly: [0.95, 0.92, 0.85], fin: [0.5, 0.45, 0.25], pattern: "eyes", power: 0.6, stamina: 5, erratic: 0.4, desc: "Its glassy eyes catch the moonlight. Hunts in the dark middle of the lake." },
    { id: "char", name: "Ember Char", rarity: "rare", zone: "rocks", time: "dusk", lure: "fly", w: [1, 7], len: [0.4, 0.75], depth: 0.28, top: [0.2, 0.25, 0.3], flank: [0.95, 0.4, 0.15], belly: [1, 0.55, 0.2], fin: [0.95, 0.85, 0.8], pattern: "spots", power: 0.75, stamina: 6, erratic: 0.6, desc: "A cold-water fish that glows like a coal at sunset." },
    { id: "sturgeon", name: "Lake Sturgeon", rarity: "rare", zone: "deep", time: "night", lure: "glow", w: [10, 45], len: [1.2, 2.0], depth: 0.18, top: [0.28, 0.28, 0.25], flank: [0.45, 0.45, 0.4], belly: [0.85, 0.82, 0.75], fin: [0.3, 0.3, 0.28], pattern: "plates", power: 1.0, stamina: 12, erratic: 0.15, desc: "Older than the dock, older than the town. Bony plates, a shark's tail, and endless strength." },
    { id: "moonfin", name: "Moonfin", rarity: "rare", zone: "deep", time: "night", lure: "glow", glowOnly: true, w: [0.5, 3], len: [0.3, 0.5], depth: 0.45, top: [0.2, 0.4, 0.9], flank: [0.5, 0.8, 1.1], belly: [0.8, 0.95, 1.2], fin: [0.6, 0.9, 1.3], pattern: "glow", power: 0.6, stamina: 5, erratic: 0.7, desc: "Fins like moonlight on water. They say it only exists when nobody is looking." },
    { id: "ghostkoi", name: "Ghost Koi", rarity: "rare", zone: "shallows", time: "night", lure: "glow", glowOnly: true, w: [1, 5], len: [0.4, 0.7], depth: 0.36, top: [0.75, 0.85, 0.95], flank: [0.85, 0.9, 1.0], belly: [0.95, 0.98, 1.0], fin: [0.8, 0.9, 1.1], pattern: "ghost", power: 0.55, stamina: 5, erratic: 0.5, desc: "A pale shape that drifts between the lilies at midnight. Its scales let the moon through." },
    { id: "leviathan", name: "Lake Leviathan", rarity: "legendary", zone: "deep", time: "night", lure: "glow", glowOnly: true, w: [60, 140], len: [2.6, 3.4], depth: 0.13, top: [0.06, 0.08, 0.12], flank: [0.12, 0.15, 0.22], belly: [0.3, 0.35, 0.45], fin: [0.15, 0.2, 0.35], pattern: "runes", power: 1.25, stamina: 16, erratic: 0.5, desc: "The old stories were true. Glowing runes along a body longer than a boat." },
];
export const LURES = {
    spinner: { name: "Spinner", desc: "A flashing silver blade. Bass, perch and trout can't resist it.", unlock: 0, color: [0.85, 0.88, 0.95] },
    fly: { name: "Fly", desc: "A feathered dry fly that sits on the surface. Sunfish and carp rise to it.", unlock: 4, color: [0.9, 0.55, 0.3] },
    glow: { name: "Glow Lure", desc: "A luminous bead for the dark. Some fish only come to light.", unlock: 8, color: [0.4, 1.0, 0.85] },
};

// ------------------------------------------------------------------ the model
import { MAT } from "./mesh.js";
const TAU = Math.PI * 2;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// draw a fish of length `len` at (x, y, z) heading `yaw` (radians, in the X–Y plane), pitched by `pitch`,
// tail-beat phase `beat` (0 = still), roll `roll`; glow scales emissive parts
export function drawFish(M, sp, len, x, y, z, yaw, pitch, beat, roll = 0, glow = 1) {
    const ST = 14, RS = 10;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // local: a along the body (head +), s sideways, u up
    const P = (a, s, u) => {
        const bend = Math.sin(beat - a * 2.2) * 0.13 * Math.pow(1 - (a + 0.5), 1.6);
        s += bend;
        const s2 = s * cr - u * sr, u2 = s * sr + u * cr;
        const a3 = a * cp - u2 * spp, u3 = a * spp + u2 * cp;
        return [x + (a3 * cy - s2 * sy) * len, y + (a3 * sy + s2 * cy) * len, z + u3 * len];
    };
    const emitAll = sp.pattern === "glow" || sp.pattern === "ghost";
    const mat = emitAll ? MAT.EMIT : MAT.FISH;
    const g = emitAll ? glow : 1;
    // body rings from tail (t=0) to snout (t=1)
    const ring = (t) => {
        const a = t - 0.5;
        const prof = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.75) * 1.02)), 0.85);
        const h = sp.depth * 0.5 * prof * (t < 0.12 ? 0.35 + t * 5 : 1), w = h * (sp.pattern === "plates" ? 0.9 : 0.55);
        return { a, h, w };
    };
    const col = (t, ang, i) => {
        const up = Math.sin(ang);                                     // +1 top, -1 belly
        let c = up > 0.25 ? mix(sp.flank, sp.top, (up - 0.25) / 0.75) : mix(sp.flank, sp.belly, Math.min(1, (0.25 - up) / 0.9));
        const p = sp.pattern;
        if (p === "stripes" && Math.sin(t * 34) > 0.35 && up > -0.2) c = c.map((v) => v * 0.55);
        if (p === "spots" && hash(Math.floor(t * 30), i) > 0.82 && up > -0.3) c = sp.id === "char" ? [1, 0.85, 0.75] : c.map((v) => v * 0.25);
        if (p === "trout") { if (Math.abs(up) < 0.18) c = [0.95, 0.4, 0.5]; else if (hash(Math.floor(t * 40), i) > 0.8 && up > 0) c = c.map((v) => v * 0.3); }
        if (p === "lateral" && Math.abs(up) < 0.15) c = c.map((v) => v * 0.35);
        if (p === "pike" && hash(Math.floor(t * 22), i) > 0.7 && up > -0.2) c = [0.85, 0.85, 0.6];
        if (p === "koi" && up > -0.3 && Math.sin(t * 9 + i * 0.7) + Math.sin(t * 4 - i) > 0.6) c = [1, 0.35, 0.08];
        if (p === "scales" && (Math.floor(t * 30) + i) % 2) c = c.map((v) => v * 0.85);
        if (p === "plates" && i % 3 === 0 && up > -0.2) c = [0.65, 0.62, 0.55];
        if (p === "runes" && Math.abs(up) < 0.2 && Math.sin(t * 50) > 0.5) c = [0.3 * glow, 1.0 * glow, 1.1 * glow];
        return c.map((v) => v * g);
    };
    const T = [0, 0.06, 0.14, 0.24, 0.36, 0.48, 0.6, 0.7, 0.79, 0.86, 0.92, 0.96, 0.99, 1];
    for (let k = 0; k < ST - 1; k++) {
        const r0 = ring(T[k]), r1 = ring(T[k + 1]);
        for (let i = 0; i < RS; i++) {
            const a0 = (i / RS) * TAU, a1 = ((i + 1) / RS) * TAU;
            const Q = (r, ang) => P(r.a, Math.cos(ang) * r.w, Math.sin(ang) * r.h);
            const c = col(T[k], (a0 + a1) / 2, i);
            const m2 = sp.pattern === "runes" && Math.abs(Math.sin((a0 + a1) / 2)) < 0.2 && Math.sin(T[k] * 50) > 0.5 ? MAT.EMIT : mat;
            M.quad(Q(r0, a0), Q(r0, a1), Q(r1, a1), Q(r1, a0), c, m2);
        }
    }
    const fin = sp.fin.map((v) => v * g), finMat = emitAll ? MAT.EMIT : MAT.FISH;
    // forked tail
    const tb = Math.sin(beat) * 0.12;
    const tail = sp.pattern === "plates" ? [[-0.5, 0, 0], [-0.72, tb, 0.24], [-0.6, tb, 0.02], [-0.68, tb, -0.12]] : [[-0.48, 0, 0], [-0.66, tb, sp.depth * 0.42], [-0.58, tb, 0], [-0.66, tb, -sp.depth * 0.42]];
    M.tri(P(...tail[0]), P(...tail[1]), P(...tail[2]), fin, finMat);
    M.tri(P(...tail[0]), P(...tail[2]), P(...tail[3]), fin.map((v) => v * 0.85), finMat);
    // dorsal and anal fins
    const r5 = ring(0.5);
    M.tri(P(-0.08, 0, r5.h * 0.95), P(0.14, 0, r5.h * 0.95), P(-0.12, 0, r5.h + sp.depth * 0.32), fin, finMat);
    M.tri(P(-0.28, 0, -ring(0.25).h * 0.9), P(-0.12, 0, -ring(0.4).h * 0.9), P(-0.3, 0, -ring(0.3).h - sp.depth * 0.16), fin.map((v) => v * 0.9), finMat);
    // pectoral fins
    for (const s of [-1, 1]) M.tri(P(0.2, s * ring(0.72).w * 0.9, -ring(0.72).h * 0.3), P(0.08, s * (ring(0.72).w + 0.09), -ring(0.72).h * 0.6), P(0.24, s * ring(0.72).w * 0.9, -ring(0.72).h * 0.7), fin, finMat);
    // eyes (glassy walleye eyes glow a little)
    const er = ring(0.9), ec = sp.pattern === "eyes" ? [1.2 * glow, 1.1 * glow, 0.6 * glow] : [0.02, 0.02, 0.03];
    for (const s of [-1, 1]) {
        const c = P(0.4, s * er.w * 0.86, er.h * 0.25), d = 0.022 * (sp.len[0] < 0.5 ? 1.4 : 1);
        M.quad([c[0] - d * len, c[1], c[2] - d * len], [c[0] + d * len, c[1], c[2] - d * len], [c[0] + d * len, c[1], c[2] + d * len], [c[0] - d * len, c[1], c[2] + d * len], ec, sp.pattern === "eyes" ? MAT.EMIT : MAT.GLOSS);
    }
    if (sp.pattern === "whiskers") for (const s of [-1, 1]) for (const k of [0, 1]) M.tri(P(0.48, s * 0.03, -0.01 - k * 0.02), P(0.48, s * 0.05, 0.0 - k * 0.02), P(0.62, s * (0.16 + k * 0.05), -0.06 - k * 0.04), [0.15, 0.15, 0.16], MAT.FISH);
}

// pick a species for a spot in the lake at a time of day
export function speciesWeights(zone, tod, journal) {
    return SPECIES.map((sp) => {
        const zoneOk = sp.zone === zone ? 1 : sp.zone === "deep" && zone === "rocks" ? 0.25 : 0.06;
        const timeOk = sp.time === "any" || sp.time === tod ? 1 : tod === "day" && sp.time !== "night" ? 0.4 : 0.07;
        if (sp.glowOnly && tod !== "night") return 0;
        const rar = { common: 1, uncommon: 0.45, rare: 0.16, legendary: 0.035 }[sp.rarity];
        return zoneOk * timeOk * rar;
    });
}
