// Meadowhop - a game built on grass.html and projection_library's Space.
// Grass, bunny, butterfly, pond and the fog + cloud-shadow shader come from grass.html; the wind panel is
// replaced by wind that shifts on its own, and a game is added on top: carrots, a burrow, a hawk and days.

import Space from "./Space.js";

// ------------------------------------------------------------------ helpers

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rnd = Math.random;
const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function normalize(v) { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }
function load(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ } }
function fail(msg) { const e = $("err"); e.textContent = msg; e.hidden = false; throw new Error(msg); }

const TOUCH = matchMedia("(pointer: coarse)").matches;
const SKY_DAY = [0.62, 0.78, 0.92], SKY_GOLD = [0.95, 0.77, 0.58], SKY_DUSK = [0.5, 0.4, 0.62];

// season and weather state (read by the pond and grass, so it is defined early)
const SEASONS = [
    { name: "Spring", sky: [0.62, 0.8, 0.95], flowers: 1, ambient: "petal", rain: 0.55 },
    { name: "Summer", sky: [0.56, 0.76, 0.96], flowers: 0.6, ambient: "pollen", rain: 0.25 },
    { name: "Autumn", sky: [0.8, 0.75, 0.68], flowers: 0.12, ambient: "leaf", rain: 0.5 },
    { name: "Winter", sky: [0.8, 0.85, 0.92], flowers: 0, ambient: "snow", rain: 0.45 },
];
let SEASON = SEASONS[0];
const RAIN_MAX = 220;
const RAIN = { on: false, amt: 0, t: 0, dur: 0, next: Infinity, drops: [] };
for (let i = 0; i < RAIN_MAX; i++) RAIN.drops.push({ ox: rnd() * 40, oy: rnd() * 40, z: rnd() * 22, sp: 18 + rnd() * 8 });


const FIELD = 35;          // grass covers [-FIELD, FIELD] in x and y
const GROUND = 36;         // terrain extends a little past the grass
const GROUND_RES = 72;
const SEGMENTS = 3;        // each blade is 3 bendable segments + a tip
const BLADE_CORNERS = 15;  // 5 triangles per blade
const FLOWER_CORNERS = 12; // 4 triangles: two crossed diamonds
const FLOWER_RATE = 0.015;

// ------------------------------------------------------------------ canvas + Space

const canvas = $("view");
let dprScale = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.5 : 2);
let cssW = 1, cssH = 1, aspectFix = [1, 1];
const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" });
if (!gl) fail("WebGL isn't available in this browser.\nOpen the game in Chrome or Firefox with hardware acceleration turned on.");
const space = new Space(gl);

// full-screen canvas; the shader corrects Space's 2:1 assumption with uAspect
function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dprScale);
    canvas.height = Math.round(cssH * dprScale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const a = cssW / cssH;
    aspectFix = a >= 2 ? [2 / a, 1] : a >= 1 ? [1, a / 2] : [1.3, a * 0.65];
    if (shader) { gl.uniform2fv(shader.aspect, new Float32Array(aspectFix)); gl.uniform2f(shader.res, canvas.width, canvas.height); }
}
let shader = null;

// ------------------------------------------------------------------ camera (same conventions as Space.js)

function syncCamera() {
    space.beta = Math.max(0.12, Math.min(1.35, space.beta));
    space.Rc = Math.max(10, Math.min(70, space.Rc));
    const a = space.alpha, b = space.beta, r = space.Rc;
    space.Xc = space.X0 + Math.cos(b) * Math.cos(a) * r;
    space.Yc = space.Y0 + Math.cos(b) * Math.sin(a) * r;
    space.Zc = space.Z0 + Math.sin(b) * r;
    space.updateMyVectors();
}
space.X0 = 0; space.Y0 = 0; space.Z0 = 0;
space.alpha = 1.45;
space.beta = 0.5;
space.Rc = 30;

// ------------------------------------------------------------------ terrain (from grass.html)

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hills(x, y) {
    return 2.6 * Math.sin(x * 0.075 + 0.4) * Math.cos(y * 0.065 - 0.3)
        + 1.1 * Math.sin(x * 0.16 + y * 0.12)
        + 0.5 * Math.cos(x * 0.31 - y * 0.27);
}

const POND = { x: -19, y: 10, r: 7.5, depth: 2.4 };
const POND_BASE = hills(POND.x, POND.y);
const WATER_LEVEL = POND_BASE - 0.4;
const pondRadius = (a) => POND.r * (1 + 0.14 * Math.sin(3 * a + 1) + 0.07 * Math.sin(5 * a - 0.5));

function height(x, y) {
    const dx = x - POND.x, dy = y - POND.y, d = Math.hypot(dx, dy);
    const R = pondRadius(Math.atan2(dy, dx));
    const flat = smoothstep(R, R + 6, d);
    let z = POND_BASE + (hills(x, y) - POND_BASE) * flat;
    if (d < R) z -= POND.depth * (1 - (d / R) * (d / R));
    return z;
}
const nearPond = (x, y) => Math.hypot(x - POND.x, y - POND.y) < POND.r * 1.4;
const isWater = (x, y) => nearPond(x, y) && height(x, y) < WATER_LEVEL + 0.08;
const isReeds = (x, y) => nearPond(x, y) && height(x, y) < WATER_LEVEL + 0.7;

// lushness varies in patches: taller, greener grass in some areas - the hiding places
function lush(x, y) {
    return 0.5 + 0.5 * Math.sin(x * 0.11 + 1.3) * Math.sin(y * 0.09 - 0.7);
}
const coverAt = (x, y) => (isReeds(x, y) ? 1 : lush(x, y));

// the burrow: home, and the only place the hawk can't reach
const BURROW = { x: 15, y: -13, r: 2.2 };
BURROW.z = height(BURROW.x, BURROW.y);
BURROW.yaw = Math.atan2(-BURROW.y, -BURROW.x);     // the entrance faces the middle of the meadow

const LIGHT = normalize([-0.4, 0.3, 0.87]);

// ------------------------------------------------------------------ scene data

let pos, col;
let capacity = 0, groundCorners = 0;
let blades = null, flowers = null;
let tipX, tipY, tipZ;

function buildScene(count) {
    const rand = mulberry32(1337);
    blades = {
        n: count,
        x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count),
        fx: new Float32Array(count), fy: new Float32Array(count),
        len: new Float32Array(count), wid: new Float32Array(count),
        lean: new Float32Array(count), stiff: new Float32Array(count), phase: new Float32Array(count),
        r: new Float32Array(count), g: new Float32Array(count), b: new Float32Array(count),
        reed: new Uint8Array(count),
    };
    // fewer blades on a phone, so each one is a little wider to keep the field full
    const widen = Math.sqrt(12000 / count);
    for (let i = 0; i < count; i++) {
        let x, y;
        do { x = (rand() * 2 - 1) * FIELD; y = (rand() * 2 - 1) * FIELD; }
        while ((nearPond(x, y) && height(x, y) < WATER_LEVEL + 0.12) || Math.hypot(x - BURROW.x, y - BURROW.y) < BURROW.r + 0.9 || clearSpot(x, y));
        const l = lush(x, y);
        const yaw = rand() * Math.PI * 2;
        blades.x[i] = x; blades.y[i] = y; blades.z[i] = height(x, y) - 0.05;
        blades.fx[i] = Math.cos(yaw); blades.fy[i] = Math.sin(yaw);
        blades.len[i] = (1.3 + rand() * 1.4) * (0.55 + 0.85 * l);
        blades.wid[i] = (0.16 + rand() * 0.14) * Math.min(1.6, widen);
        blades.lean[i] = 0.1 + rand() * 0.35;
        blades.stiff[i] = 0.75 + rand() * 0.5;
        blades.phase[i] = rand() * Math.PI * 2;
        const dry = rand() < 0.12 ? 0.5 + rand() * 0.5 : rand() * 0.25;
        const shade = 0.85 + rand() * 0.3;
        blades.r[i] = (0.2 + 0.45 * dry) * shade;
        blades.g[i] = (0.5 + 0.12 * l + 0.05 * dry) * shade;
        blades.b[i] = (0.1 + 0.05 * l) * shade;
        if (isReeds(x, y)) {
            blades.reed[i] = 1;
            blades.len[i] = 3.2 + rand() * 1.8;
            blades.wid[i] = (0.14 + rand() * 0.06) * Math.min(1.4, widen);
            blades.stiff[i] = 1.6 + rand() * 0.6;
            blades.lean[i] = 0.05 + rand() * 0.12;
            blades.r[i] = 0.2 * shade; blades.g[i] = 0.42 * shade; blades.b[i] = 0.14 * shade;
        }
    }
    tipX = new Float32Array(count); tipY = new Float32Array(count); tipZ = new Float32Array(count);

    const FLOWER_COLORS = [[1, 1, 0.95], [1, 0.86, 0.2], [0.72, 0.5, 1], [1, 0.55, 0.75]];
    flowers = [];
    for (let i = 0; i < count; i++) {
        if (blades.reed[i]) {
            if (rand() < 0.3) flowers.push({ blade: i, color: [0.36, 0.22, 0.1], size: 0.3, rank: 0 });
        } else if (rand() < FLOWER_RATE * widen) {
            blades.len[i] *= 1.25;
            flowers.push({ blade: i, color: FLOWER_COLORS[(rand() * FLOWER_COLORS.length) | 0], size: 0.2 + rand() * 0.12, rank: rand() });
        }
    }

    groundCorners = GROUND_RES * GROUND_RES * 6;
    capacity = groundCorners + count * BLADE_CORNERS + flowers.length * FLOWER_CORNERS + CHAR_CORNERS + CARRY_CORNERS
        + BUTTERFLY_CORNERS + POND_CORNERS + CARROT_MAX * CARROT_CORNERS + DECOR_CORNERS + HAWK_CORNERS + PARTICLE_MAX * 6
        + FOX_CORNERS + CLOVER_MAX * CLOVER_CORNERS + (RAIN_MAX + AMBIENT_MAX) * 6 + 2000;
    pos = new Float32Array(capacity * 4);
    col = new Float32Array(capacity * 4);
    applySeason(SEASON);
}

// terrain never moves, so it is written once at the start of the arrays
function writeGround() {
    const step = (2 * GROUND) / GROUND_RES;
    let o = 0;
    const put = (x, y) => {
        const z = height(x, y);
        const e = 0.05;
        const n = normalize([height(x - e, y) - height(x + e, y), height(x, y - e) - height(x, y + e), 2 * e]);
        const l = lush(x, y);
        const light = 0.45 + 0.6 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = 1;
        let c = [0.2 + 0.08 * (1 - l), 0.33 + 0.1 * l, 0.1];
        const bank = smoothstep(WATER_LEVEL + 0.9, WATER_LEVEL + 0.1, z);
        c = c.map((v, k) => v + ([0.52, 0.44, 0.3][k] - v) * bank);
        const under = smoothstep(WATER_LEVEL, WATER_LEVEL - 0.4, z);
        c = c.map((v, k) => v + ([0.24, 0.21, 0.14][k] - v) * under);
        // bare, trodden earth around the burrow
        const dirt = smoothstep(BURROW.r + 2.4, BURROW.r + 0.4, Math.hypot(x - BURROW.x, y - BURROW.y));
        c = c.map((v, k) => v + ([0.4, 0.29, 0.18][k] - v) * dirt);
        const sd = Math.max(smoothstep(4.4, 2.6, Math.hypot(x - SHOP.x, y - SHOP.y)), 0.8 * smoothstep(3.8, 2.2, Math.hypot(x - FIRE.x, y - FIRE.y)));
        c = c.map((v, k) => v + ([0.4, 0.29, 0.18][k] - v) * sd);
        c = seasonGround(c, x, y, z);
        col[o] = c[0] * light; col[o + 1] = c[1] * light; col[o + 2] = c[2] * light; col[o + 3] = 1;
        o += 4;
    };
    for (let i = 0; i < GROUND_RES; i++) {
        for (let j = 0; j < GROUND_RES; j++) {
            const x0 = -GROUND + i * step, y0 = -GROUND + j * step, x1 = x0 + step, y1 = y0 + step;
            put(x0, y0); put(x1, y0); put(x1, y1);
            put(x0, y0); put(x1, y1); put(x0, y1);
        }
    }
}

// ------------------------------------------------------------------ wind that behaves on its own
//
// No sliders: strength drifts on a few slow overlapping waves, random gust events swell and fade on top,
// and the direction wanders and veers a little in each gust. The gust bands roll faster when it's windy.

const W = {
    strength: 0.8, dir: 2.9, speed: 1.6, t: 0,
    seeds: [rnd() * 10, rnd() * 10, rnd() * 10, rnd() * 10],
    gustAmp: 0, gustDur: 1, gustAge: 99, gustVeer: 0, nextGust: 4, boost: 0,
};

function updateWind(dt, time) {
    const [s0, s1, s2, s3] = W.seeds;
    const calm = 0.5 + 0.22 * Math.sin(time * 0.09 + s0) + 0.14 * Math.sin(time * 0.23 + s1) + 0.08 * Math.sin(time * 0.61 + s2);
    W.nextGust -= dt;
    if (W.nextGust <= 0) {
        W.gustAmp = 0.3 + rnd() * (0.5 + W.boost);
        W.gustDur = 2.2 + rnd() * 4;
        W.gustAge = 0;
        W.gustVeer = (rnd() - 0.5) * 0.5;
        W.nextGust = W.gustDur + 3 + rnd() * (11 - W.boost * 6);
    }
    W.gustAge += dt;
    const env = W.gustAge < W.gustDur ? Math.sin((Math.PI * W.gustAge) / W.gustDur) : 0;
    const target = clamp(calm + W.boost * 0.35 + env * W.gustAmp, 0.08, 1.75);
    W.strength += (target - W.strength) * Math.min(1, dt * 1.4);
    W.dir += (0.05 * Math.sin(time * 0.043 + s3) + 0.035 * Math.sin(time * 0.17 + s1) + W.gustVeer * env) * dt;
    W.speed = 0.8 + W.strength * 1.1;
    W.t += dt * W.speed;
}

// Gusts are bands of stronger wind that travel downwind across the field (from grass.html).
function gustAt(s, q, t) {
    const g1 = 0.5 + 0.5 * Math.sin(s * 0.13 - t * 2.3 + 1.6 * Math.sin(q * 0.06 + t * 0.25));
    const g2 = 0.5 + 0.5 * Math.sin(s * 0.04 - t * 0.9 + 0.8 * Math.sin(q * 0.03));
    return 0.55 * g1 * g1 + 0.45 * g2;
}
const gustHere = (x, y) => {
    const dx = Math.cos(W.dir), dy = Math.sin(W.dir);
    return gustAt(x * dx + y * dy, -x * dy + y * dx, W.t);
};

// things that shove grass aside: the bunny's feet and the hawk's wings
const pushers = [];

function writeBlades() {
    const strength = W.strength, t = W.t;
    const wet = 1 - 0.18 * RAIN.amt;
    const dx = Math.cos(W.dir), dy = Math.sin(W.dir);
    const B = blades;
    let o = groundCorners * 4;
    const px = [0, 0, 0, 0], py = [0, 0, 0, 0], pz = [0, 0, 0, 0];
    const halfW = [0.5, 0.36, 0.2];

    for (let i = 0; i < B.n; i++) {
        const x = B.x[i], y = B.y[i];
        const s = x * dx + y * dy;
        const q = -x * dy + y * dx;
        const g = gustAt(s, q, t);
        const flutter = 0.07 * Math.sin(t * 7.5 + B.phase[i]) * (0.3 + g);
        const windBend = (strength * (0.12 + 0.88 * g) + flutter * strength) / B.stiff[i];
        let bx = dx * windBend, by = dy * windBend;
        for (const P of pushers) {
            const ex = x - P.x, ey = y - P.y, d2 = ex * ex + ey * ey;
            if (P.s > 0 && d2 < P.r * P.r) {
                const d = Math.sqrt(d2) + 1e-4;
                const p = P.s * (1 - d / P.r);
                bx += (ex / d) * p; by += (ey / d) * p;
            }
        }
        const bend = Math.hypot(bx, by);
        const ux = bend > 1e-6 ? bx / bend : dx, uy = bend > 1e-6 ? by / bend : dy;
        const segLen = B.len[i] / SEGMENTS;
        const fx = B.fx[i], fy = B.fy[i], lean = B.lean[i];
        px[0] = x; py[0] = y; pz[0] = B.z[i];
        for (let k = 1; k <= SEGMENTS; k++) {
            const h = k / SEGMENTS;
            const a = Math.min(1.45, bend * 1.25 * Math.pow(h, 1.4));
            const sa = Math.sin(a), ca = Math.cos(a);
            const l = lean * h;
            px[k] = px[k - 1] + segLen * (sa * ux + l * fx * ca);
            py[k] = py[k - 1] + segLen * (sa * uy + l * fy * ca);
            pz[k] = pz[k - 1] + segLen * ca;
        }
        tipX[i] = px[SEGMENTS]; tipY[i] = py[SEGMENTS]; tipZ[i] = pz[SEGMENTS];
        const wx = -fy * B.wid[i], wy = fx * B.wid[i];
        const hi = Math.min(1, bend * 0.45);
        const r = B.sr[i] * wet, gg = B.sg[i] * wet, b = B.sb[i] * wet, fr = B.frost[i];
        const vert = (k, side) => {
            const hw = k < SEGMENTS ? halfW[k] * side : 0;
            pos[o] = px[k] + wx * hw; pos[o + 1] = py[k] + wy * hw; pos[o + 2] = pz[k]; pos[o + 3] = 1;
            const h = k / SEGMENTS;
            const shade = 0.42 + 0.7 * h;
            const lift = hi * h * 0.55;
            col[o] = Math.min(1, r * shade + lift * 0.55 + fr * h * h * 0.85);
            col[o + 1] = Math.min(1, gg * shade + lift * 0.5 + fr * h * h * 0.9);
            col[o + 2] = Math.min(1, b * shade + lift * 0.22 + fr * h * h);
            col[o + 3] = 1;
            o += 4;
        };
        vert(0, -1); vert(0, 1); vert(1, 1);
        vert(0, -1); vert(1, 1); vert(1, -1);
        vert(1, -1); vert(1, 1); vert(2, 1);
        vert(1, -1); vert(2, 1); vert(2, -1);
        vert(2, -1); vert(2, 1); vert(3, 0);
    }

    for (const f of flowers) {
        if (f.rank > SEASON.flowers) continue;
        const cx = tipX[f.blade], cy = tipY[f.blade], cz = tipZ[f.blade];
        const s = f.size, [r, g, b] = f.color;
        const quad = (ax, ay) => {
            const pts = [
                [cx - ax * s, cy - ay * s, cz], [cx, cy, cz - s * 0.7], [cx + ax * s, cy + ay * s, cz],
                [cx - ax * s, cy - ay * s, cz], [cx + ax * s, cy + ay * s, cz], [cx, cy, cz + s * 0.7],
            ];
            for (let k = 0; k < 6; k++) {
                const p = pts[k];
                pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2]; pos[o + 3] = 1;
                const c = k === 1 ? 0.75 : 1;
                col[o] = r * c; col[o + 1] = g * c; col[o + 2] = b * c; col[o + 3] = 1;
                o += 4;
            }
        };
        quad(1, 0);
        quad(0, 1);
    }
    return o;
}

// ------------------------------------------------------------------ shared ellipsoid machinery (from grass.html)

function makeSphere(nLon, nLat) {
    const v = [];
    for (let i = 0; i <= nLat; i++) {
        const th = (Math.PI * i) / nLat;
        for (let j = 0; j <= nLon; j++) {
            const ph = (2 * Math.PI * j) / nLon;
            v.push(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
        }
    }
    const idx = [];
    for (let i = 0; i < nLat; i++) {
        for (let j = 0; j < nLon; j++) {
            const a = i * (nLon + 1) + j, b = a + nLon + 1;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return { v: Float32Array.from(v), idx: Uint16Array.from(idx) };
}
const SPHERE_HI = makeSphere(22, 14);
const SPHERE_LO = makeSphere(10, 6);
const SPHERE_TINY = makeSphere(6, 4);

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul(A, B) {
    const R = new Array(9);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            R[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
    return R;
}
const apply = (M, x, y, z) => [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
const cornersOf = (parts) => parts.reduce((n, p) => n + p.mesh.idx.length, 0);

// unit sphere -> radii -> part rotation -> part centre -> squash S -> character rotation G -> world base
function writeEllipsoids(o, parts, G, S, base) {
    for (const p of parts) {
        const { v, idx } = p.mesh;
        const [cr, cg, cb] = p.col;
        for (let k = 0; k < idx.length; k++, o += 4) {
            const q = 3 * idx[k];
            const ux = v[q], uy = v[q + 1], uz = v[q + 2];
            const lp = apply(p.R, ux * p.r[0], uy * p.r[1], uz * p.r[2]);
            const wp = apply(G, (p.c[0] + lp[0]) * S[0], (p.c[1] + lp[1]) * S[1], (p.c[2] + lp[2]) * S[2]);
            pos[o] = base[0] + wp[0]; pos[o + 1] = base[1] + wp[1]; pos[o + 2] = base[2] + wp[2]; pos[o + 3] = 1;
            const nm = p.mesh.n;
            const ln = nm ? apply(p.R, nm[q] / p.r[0], nm[q + 1] / p.r[1], nm[q + 2] / p.r[2]) : apply(p.R, ux / p.r[0], uy / p.r[1], uz / p.r[2]);
            const wn = normalize(apply(G, ln[0] / S[0], ln[1] / S[1], ln[2] / S[2]));
            const d = 0.5 + 0.5 * (wn[0] * LIGHT[0] + wn[1] * LIGHT[1] + wn[2] * LIGHT[2]);
            const shade = p.glow ? 1 : 0.36 + 0.78 * d * d;
            col[o] = Math.min(1, cr * shade); col[o + 1] = Math.min(1, cg * shade); col[o + 2] = Math.min(1, cb * shade); col[o + 3] = 1;
        }
    }
    return o;
}

// ------------------------------------------------------------------ bunny (from grass.html, plus crouching and carrying)

const CHAR_SCALE = 0.95;
const WALK_SPEED = 7;
const JUMP_SPEED = 10;
const GRAVITY = 30;
const CARRY_MAX = 4;           // buffer size; the real limit is carryCap()

const COL = {
    fur: [1.0, 0.74, 0.5], belly: [1.0, 0.93, 0.8], feet: [0.94, 0.6, 0.4], innerEar: [1.0, 0.6, 0.66],
    eye: [0.07, 0.05, 0.08], shine: [1, 1, 1], cheek: [1.0, 0.56, 0.62], nose: [0.86, 0.34, 0.44], tail: [1.0, 0.97, 0.94],
    carrot: [1.0, 0.5, 0.12], leaf: [0.28, 0.62, 0.2],
};

const C = {
    x: BURROW.x - Math.cos(BURROW.yaw) * -3.5, y: BURROW.y - Math.sin(BURROW.yaw) * -3.5, vx: 0, vy: 0, yaw: 0,
    z: 0, vz: 0, hop: 0, phase: 0, walk: 0, ear: 0.15, earV: 0, land: 0, blinkIn: 2, blink: 1, blinkT: 0,
    crouch: 0, carry: 0, dig: 0, digTarget: null,
};

function bunnyParts(time) {
    const w = C.walk, ph = C.phase;
    const parts = [];
    const add = (c, R, r, col, mesh = SPHERE_HI) => parts.push({ c, R, r, col, mesh });
    add([0, 0, 1.25], I3, [1.15, 1.1, 1.2], COL.fur);
    add([0.5, 0, 1.0], I3, [0.72, 0.78, 0.78], COL.belly);
    add([-1.12, Math.sin(time * 7) * 0.08 * (0.4 + w), 0.95], I3, [0.3, 0.3, 0.3], COL.tail, SPHERE_LO);
    add([1.12, 0, 1.4], I3, [0.06, 0.09, 0.06], COL.nose, SPHERE_LO);
    for (const s of [1, -1]) {
        const earR = mul(rotY(-C.ear), rotX(-s * (0.28 + 0.08 * Math.sin(time * 1.7 + s))));
        const pivot = [-0.15, s * 0.42, 2.2];
        const ec = apply(earR, 0, 0, 0.72), ic = apply(earR, 0.08, 0, 0.72);
        add([pivot[0] + ec[0], pivot[1] + ec[1], pivot[2] + ec[2]], earR, [0.16, 0.3, 0.8], COL.fur);
        add([pivot[0] + ic[0], pivot[1] + ic[1], pivot[2] + ic[2]], earR, [0.1, 0.18, 0.6], COL.innerEar);
        add([0.97, s * 0.4, 1.58], I3, [0.12, 0.15, 0.22 * C.blink], COL.eye);
        const shine = C.blink > 0.5 ? 0.055 : 0.0001;
        add([1.07, s * 0.35, 1.66], I3, [shine, shine, shine], COL.shine, SPHERE_LO);
        add([0.84, s * 0.7, 1.32], I3, [0.1, 0.2, 0.13], COL.cheek, SPHERE_LO);
        const armR = mul(rotY(s * Math.sin(ph) * 0.7 * w + (C.dig > 0 ? Math.sin(time * 30) * 0.8 : 0)), rotX(-s * 0.5));
        const ac = apply(armR, 0, 0, -0.22);
        add([0.15 + ac[0], s * 1.0 + ac[1], 1.05 + ac[2]], armR, [0.2, 0.16, 0.3], COL.fur, SPHERE_LO);
        const fx = 0.3 + s * 0.42 * Math.sin(ph) * w;
        const lift = Math.max(0, s * Math.cos(ph)) * 0.28 * w;
        add([fx, s * 0.48, 0.16 + lift], rotY(-s * Math.cos(ph) * 0.4 * w), [0.45, 0.28, 0.18], COL.feet, SPHERE_LO);
    }
    return parts;
}

// carrots carried on the bunny's back, lying crosswise
function carryParts() {
    const parts = [];
    for (let i = 0; i < C.carry; i++) {
        const y = (i - (C.carry - 1) / 2) * 0.34;
        parts.push({ c: [-0.62, y, 2.02 + i * 0.03], R: rotY(1.35), r: [0.1, 0.1, 0.36], col: i < C.gold ? GOLD : COL.carrot, mesh: SPHERE_LO });
        parts.push({ c: [-1.02, y, 2.12 + i * 0.03], R: rotY(1.0), r: [0.05, 0.12, 0.22], col: COL.leaf, mesh: SPHERE_TINY });
    }
    return parts;
}

const CHAR_CORNERS = cornersOf(bunnyParts(0));
const CARRY_CORNERS = CARRY_MAX * (SPHERE_LO.idx.length + SPHERE_TINY.idx.length);

function writeBunny(o, time) {
    const w = C.walk, hopS = Math.abs(Math.sin(C.phase));
    let sz = 1 + w * (0.1 * hopS - 0.12 * Math.pow(1 - hopS, 4))
        + 0.03 * Math.sin(time * 2.4) * (1 - w)
        - 0.3 * C.land
        + Math.max(-0.12, Math.min(0.15, C.vz * 0.012));
    sz *= 1 - 0.36 * C.crouch;                          // pressed flat in the grass while hiding
    const sxy = 1 / Math.sqrt(sz);
    const S = [sxy * CHAR_SCALE, sxy * CHAR_SCALE, sz * CHAR_SCALE];
    const look = (1 - w) * (1 - C.crouch) * 0.35 * Math.sin(time * 0.6) * Math.sin(time * 0.23 + 1);
    const G = mul(rotZ(C.yaw + look), rotY(0.2 * w - 0.02 * C.vz + (C.dig > 0 ? 0.35 : 0)));
    const base = [C.x, C.y, groundAt(C.x, C.y) - 0.05 + C.z + C.hop];
    o = writeEllipsoids(o, bunnyParts(time), G, S, base);
    return writeEllipsoids(o, carryParts(), G, S, base);
}

// ------------------------------------------------------------------ butterfly (from grass.html; now it knows where the carrots are)

const BF_SCALE = 1.0;
const BF_DARK = [0.1, 0.08, 0.12];

function makeWing(root, outline, bands) {
    const RINGS = [0.55, 0.8, 0.9, 0.95, 1.0];
    const SUB = 3;
    const edge = [];
    for (let k = 0; k + 1 < outline.length; k++) {
        for (let s = 0; s < SUB; s++) {
            const f = s / SUB, a = outline[k], b = outline[k + 1];
            edge.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        }
    }
    edge.push(outline[outline.length - 1]);
    const ringPt = (k, j) => {
        const f = RINGS[j], e = edge[k];
        return [root[0] + (e[0] - root[0]) * f, root[1] + (e[1] - root[1]) * f];
    };
    const ringCol = (k, j) => (j === 3 && k % 3 === 1 ? [0.95, 0.95, 0.9] : bands[j + 1]);
    const corners = [];
    const put = (p, c) => corners.push([p[0], p[1], c[0], c[1], c[2]]);
    for (let k = 0; k + 1 < edge.length; k++) {
        put(root, bands[0]); put(ringPt(k, 0), ringCol(k, 0)); put(ringPt(k + 1, 0), ringCol(k + 1, 0));
        for (let j = 0; j + 1 < RINGS.length; j++) {
            const a = ringPt(k, j), b = ringPt(k + 1, j), c = ringPt(k + 1, j + 1), d = ringPt(k, j + 1);
            const ca = ringCol(k, j), cb = ringCol(k + 1, j), cc = ringCol(k + 1, j + 1), cd = ringCol(k, j + 1);
            put(a, ca); put(b, cb); put(c, cc);
            put(a, ca); put(c, cc); put(d, cd);
        }
    }
    return corners;
}

const FORE_WING = makeWing([0, 0.08],
    [[0.2, 0.05], [0.9, 0.6], [1.1, 1.3], [0.8, 1.75], [0.2, 1.65], [-0.15, 0.9], [-0.1, 0.2]],
    [[0.04, 0.1, 0.35], [0.12, 0.5, 1.0], [0.35, 0.85, 1.0], BF_DARK, BF_DARK, BF_DARK]);
const HIND_WING = makeWing([-0.05, 0.06],
    [[0.05, 0.3], [-0.1, 0.9], [-0.45, 1.3], [-0.95, 1.25], [-1.2, 0.8], [-1.0, 0.35], [-0.5, 0.1]],
    [[0.08, 0.06, 0.3], [0.3, 0.35, 1.0], [0.55, 0.75, 1.0], BF_DARK, BF_DARK, BF_DARK]);

function butterflyBody() {
    const parts = [];
    const add = (c, R, r, col, mesh = SPHERE_LO) => parts.push({ c, R, r, col, mesh });
    add([0.1, 0, 0], I3, [0.34, 0.14, 0.14], BF_DARK);
    add([-0.55, 0, -0.03], I3, [0.55, 0.1, 0.1], [0.16, 0.13, 0.2]);
    add([0.5, 0, 0.03], I3, [0.14, 0.13, 0.13], BF_DARK);
    for (const s of [1, -1]) {
        const R = mul(rotZ(s * 0.35), rotY(-0.6));
        const d = apply(R, 1, 0, 0);
        add([0.55 + d[0] * 0.45, s * 0.05 + d[1] * 0.45, 0.06 + d[2] * 0.45], R, [0.45, 0.018, 0.018], BF_DARK);
        add([0.55 + d[0] * 0.92, s * 0.05 + d[1] * 0.92, 0.06 + d[2] * 0.92], I3, [0.05, 0.05, 0.05], BF_DARK);
    }
    return parts;
}
const BF_BODY = butterflyBody();
const BUTTERFLY_CORNERS = cornersOf(BF_BODY) + 2 * (FORE_WING.length + HIND_WING.length);

const BF = {
    x: 6, y: -5, alt: 4, z: 0, heading: rnd() * Math.PI * 2, turn: 0, speed: 5,
    yaw: 0, pitch: 0, roll: 0, phase: 0, glide: 0, target: null,
    seed: [rnd() * 10, rnd() * 10, rnd() * 10, rnd() * 10],
};

function updateButterfly(dt, time) {
    const [s0, s1, s2, s3] = BF.seed;
    let turn = 1.3 * (Math.sin(time * 0.7 + s0) * 0.9 + Math.sin(time * 1.9 + s1) * 0.5 + Math.sin(time * 0.23 + s2) * 0.8);
    const r = Math.hypot(BF.x, BF.y), edge = FIELD - 8;
    if (r > edge) turn += wrapAngle(Math.atan2(-BF.y, -BF.x) - BF.heading) * 2.5 * Math.min(1.5, (r - edge) / 4);
    // guide: drift towards the carrot nearest the bunny and loop around above it
    const T = BF.target;
    if (T) {
        const tx = T.x - BF.x, ty = T.y - BF.y, td = Math.hypot(tx, ty);
        if (td > 2.2) turn += wrapAngle(Math.atan2(ty, tx) - BF.heading) * 1.6 * Math.min(1, (td - 2.2) / 5);
    } else {
        const bx = C.x - BF.x, by = C.y - BF.y, bd = Math.hypot(bx, by);
        if (bd > 16) turn += wrapAngle(Math.atan2(by, bx) - BF.heading) * 0.9 * Math.min(1, (bd - 16) / 10);
    }
    BF.turn += (turn - BF.turn) * Math.min(1, dt * 3);
    BF.heading += BF.turn * dt;
    BF.speed = 4.2 + 1.6 * Math.sin(time * 0.5 + s3);
    // the wind carries it a little
    BF.x += (Math.cos(BF.heading) * BF.speed + Math.cos(W.dir) * W.strength * 0.8) * dt;
    BF.y += (Math.sin(BF.heading) * BF.speed + Math.sin(W.dir) * W.strength * 0.8) * dt;
    const glideTarget = Math.sin(time * 0.37 + s1) > 0.75 ? 1 : 0;
    BF.glide += (glideTarget - BF.glide) * Math.min(1, dt * 4);
    BF.phase += dt * Math.PI * 2 * 7 * (1 - 0.9 * BF.glide);
    const low = T && Math.hypot(T.x - BF.x, T.y - BF.y) < 4 ? 1.6 : 0;
    const targetAlt = 4.3 + 2.0 * Math.sin(time * 0.31 + s2) + 0.8 * Math.sin(time * 0.83 + s0) - 1.2 * BF.glide - low;
    const prevZ = BF.z;
    BF.alt += (targetAlt - BF.alt) * Math.min(1, dt * 1.5);
    BF.z = Math.max(height(BF.x, BF.y), WATER_LEVEL) + BF.alt + 0.16 * Math.sin(BF.phase) * (1 - BF.glide);
    const climb = (BF.z - prevZ) / Math.max(dt, 1e-3);
    BF.yaw = BF.heading;
    BF.pitch = Math.max(-0.5, Math.min(0.5, -0.12 - climb * 0.04));
    BF.roll = Math.max(-0.6, Math.min(0.6, -BF.turn * 0.3));
}

// wings: flat fans hinged along the body (used by the butterfly and the hawk)
function writeWings(o, G, base, scale, fore, hind, foreAng, hindAng) {
    const wing = (corners, ang, s) => {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const n = normalize(apply(G, 0, -s * sa, ca));
        const lit = 0.5 + 0.55 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        for (const [wx, wy, r, g, b] of corners) {
            const lx = wx * scale, ly = s * (0.08 + wy * ca) * scale, lz = (0.04 + wy * sa) * scale;
            const p = apply(G, lx, ly, lz);
            pos[o] = base[0] + p[0]; pos[o + 1] = base[1] + p[1]; pos[o + 2] = base[2] + p[2]; pos[o + 3] = 1;
            col[o] = Math.min(1, r * lit); col[o + 1] = Math.min(1, g * lit); col[o + 2] = Math.min(1, b * lit); col[o + 3] = 1;
            o += 4;
        }
    };
    for (const s of [1, -1]) { wing(fore, foreAng, s); wing(hind, hindAng, s); }
    return o;
}

function writeButterfly(o) {
    const G = mul(rotZ(BF.yaw), mul(rotY(BF.pitch), rotX(BF.roll)));
    const base = [BF.x, BF.y, BF.z];
    o = writeEllipsoids(o, BF_BODY, G, [BF_SCALE, BF_SCALE, BF_SCALE], base);
    const flap = (ph) => 0.1 + 1.05 * (0.5 + 0.5 * Math.sin(ph));
    const foreAng = flap(BF.phase) * (1 - BF.glide) + 0.3 * BF.glide;
    const hindAng = flap(BF.phase - 0.35) * (1 - BF.glide) + 0.25 * BF.glide;
    return writeWings(o, G, base, BF_SCALE, FORE_WING, HIND_WING, foreAng, hindAng);
}

// ------------------------------------------------------------------ pond water + lily pads (from grass.html)

const WATER_RES = 46;
const WATER_XY = (() => {
    const E = POND.r * 1.35, step = (2 * E) / WATER_RES, pts = [];
    const wet = (x, y) => height(x, y) < WATER_LEVEL;
    for (let i = 0; i < WATER_RES; i++) {
        for (let j = 0; j < WATER_RES; j++) {
            const x0 = POND.x - E + i * step, y0 = POND.y - E + j * step, x1 = x0 + step, y1 = y0 + step;
            if (!(wet(x0, y0) || wet(x1, y0) || wet(x1, y1) || wet(x0, y1))) continue;
            pts.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
        }
    }
    return Float32Array.from(pts);
})();
const WATER_DEPTH = WATER_XY.map((_, i, a) => (i % 2 ? 0 : Math.max(0, WATER_LEVEL - height(a[i], a[i + 1]))));

const LILIES = [[-2.2, 1.6, 0.95], [1.9, -2.4, 0.8], [3.0, 1.5, 0.7], [-0.8, -3.3, 0.85], [-3.6, -1.2, 0.6]]
    .map(([dx, dy, r], k) => ({ x: POND.x + dx, y: POND.y + dy, r, flower: k % 2 === 0, turn: k * 1.3 }));
const LILY_GREEN = [0.24, 0.55, 0.2], LILY_PINK = [1.0, 0.62, 0.78], LILY_CORE = [1.0, 0.9, 0.35];

function ripple(x, y, t) {
    // ripples grow a little with the wind
    const k = SEASON.name === "Winter" ? 0.06 : 0.7 + 0.5 * W.strength + RAIN.amt * 1.3;
    const a1 = x * 1.3 + t * 1.7, a2 = y * 1.7 - t * 1.3 + x * 0.4, a3 = (x - y) * 2.3 + t * 2.4;
    const h = (0.035 * Math.sin(a1) + 0.03 * Math.sin(a2) + 0.018 * Math.sin(a3)) * k;
    const dx = (0.035 * 1.3 * Math.cos(a1) + 0.03 * 0.4 * Math.cos(a2) + 0.018 * 2.3 * Math.cos(a3)) * k;
    const dy = (0.03 * 1.7 * Math.cos(a2) - 0.018 * 2.3 * Math.cos(a3)) * k;
    return [h, dx * 3, dy * 3];
}

function lilyParts(time) {
    const parts = [];
    for (const L of LILIES) {
        const z = WATER_LEVEL + ripple(L.x, L.y, time)[0] + 0.03;
        const R = rotZ(L.turn + 0.1 * Math.sin(time * 0.4 + L.turn));
        parts.push({ c: [L.x, L.y, z], R, r: [L.r, L.r * 0.92, 0.04], col: LILY_GREEN, mesh: SPHERE_LO });
        const fr = L.flower ? 1 : 0.0001;
        parts.push({ c: [L.x, L.y, z + 0.12 * fr], R, r: [0.28 * fr, 0.28 * fr, 0.16 * fr], col: LILY_PINK, mesh: SPHERE_LO });
        parts.push({ c: [L.x, L.y, z + 0.24 * fr], R, r: [0.1 * fr, 0.1 * fr, 0.07 * fr], col: LILY_CORE, mesh: SPHERE_LO });
    }
    return parts;
}
const POND_CORNERS = WATER_XY.length / 2 + cornersOf(lilyParts(0));

function writePond(o, time, sky) {
    const SHALLOW = [0.22, 0.5, 0.48], DEEP = [0.04, 0.17, 0.26];
    const ICE = [0.74, 0.84, 0.92], iceAmt = SEASON.name === "Winter" ? 0.75 : 0;
    const REFLECT = mix3([0.72, 0.86, 0.97], sky, 0.5);
    const cx = space.Xc, cy = space.Yc, cz = space.Zc;
    for (let i = 0; i < WATER_XY.length; i += 2, o += 4) {
        const x = WATER_XY[i], y = WATER_XY[i + 1];
        const [h, dx, dy] = ripple(x, y, time);
        const z = WATER_LEVEL + h;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = 1;
        const n = normalize([-dx, -dy, 1]);
        const v = normalize([cx - x, cy - y, cz - z]);
        const nv = Math.max(0, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
        const fresnel = 0.18 + 0.72 * Math.pow(1 - nv, 3);
        const ln = LIGHT[0] * n[0] + LIGHT[1] * n[1] + LIGHT[2] * n[2];
        const rx = 2 * ln * n[0] - LIGHT[0], ry = 2 * ln * n[1] - LIGHT[1], rz = 2 * ln * n[2] - LIGHT[2];
        const spec = 0.9 * Math.pow(Math.max(0, rx * v[0] + ry * v[1] + rz * v[2]), 60);
        const deep = Math.min(1, WATER_DEPTH[i] / 1.8);
        for (let k = 0; k < 3; k++) {
            const base = lerp(SHALLOW[k] + (DEEP[k] - SHALLOW[k]) * deep, ICE[k], iceAmt);
            col[o + k] = Math.min(1, base + (REFLECT[k] - base) * fresnel + spec);
        }
        col[o + 3] = 1;
    }
    return writeEllipsoids(o, lilyParts(time), I3, [1, 1, 1], [0, 0, 0]);
}

// ------------------------------------------------------------------ carrots hidden in the grass
//
// Mostly buried: only the orange shoulder and the leafy top stick out, and the leaves are shorter than
// the grass, so you mostly find them when a gust flattens the grass - or by following the butterfly.

const CARROT_MAX = 22;
const carrots = [];

function carrotParts(k, time) {
    const wind = W.strength * (0.6 + 0.6 * k.gust);
    const parts = [
        { c: [0, 0, -0.08], R: I3, r: [0.19, 0.19, 0.34], col: k.gold ? GOLD : COL.carrot, mesh: SPHERE_TINY },
        { c: [0, 0, 0.22], R: I3, r: [0.14, 0.14, 0.06], col: k.gold ? [1, 0.93, 0.5] : [0.92, 0.44, 0.1], mesh: SPHERE_TINY },
    ];
    for (let j = 0; j < 3; j++) {
        const sway = 0.3 + 0.22 * Math.sin(time * 4 + k.phase + j) * wind + 0.25 * wind;
        const R = mul(rotZ(j * 2.1 + k.phase), rotY(sway));
        const c = apply(R, 0, 0, 0.36);
        parts.push({ c: [c[0], c[1], 0.24 + c[2]], R, r: [0.05, 0.13, 0.4], col: COL.leaf, mesh: SPHERE_TINY });
    }
    return parts;
}
const CARROT_CORNERS = 5 * SPHERE_TINY.idx.length;

function writeCarrots(o, time) {
    for (const k of carrots) {
        const pop = k.dug ? Math.min(1, k.dug) : 0;          // pulled up out of the ground while digging
        o = writeEllipsoids(o, carrotParts(k, time), rotZ(k.yaw), [1, 1, 1], [k.x, k.y, k.z + pop * 0.45]);
    }
    return o;
}

// ------------------------------------------------------------------ burrow

function burrowParts() {
    const DIRT = [0.46, 0.33, 0.2], DARK = [0.07, 0.05, 0.04], STONE = [0.6, 0.58, 0.55], MOSS = [0.34, 0.5, 0.2];
    const parts = [
        { c: [0, 0, 0], R: I3, r: [2.3, 2.1, 1.0], col: DIRT, mesh: SPHERE_HI },
        { c: [1.75, 0, 0.35], R: rotY(-0.35), r: [0.28, 0.72, 0.58], col: DARK, mesh: SPHERE_LO },
        { c: [-0.4, 0.3, 0.85], R: I3, r: [1.1, 1.0, 0.25], col: MOSS, mesh: SPHERE_LO },
    ];
    [[1.9, 0.95, 0.2], [2.05, -0.9, 0.18], [1.35, 1.45, 0.24], [1.45, -1.4, 0.16], [0.4, -1.9, 0.2]].forEach(([x, y, s]) =>
        parts.push({ c: [x, y, 0.08], R: rotZ(x * 3), r: [s * 1.3, s, s * 0.8], col: STONE, mesh: SPHERE_TINY }));
    return parts;
}
const BURROW_PARTS = burrowParts();
const BURROW_CORNERS = cornersOf(BURROW_PARTS);
const writeBurrow = (o) => writeEllipsoids(o, BURROW_PARTS, rotZ(BURROW.yaw), [1, 1, 1], [BURROW.x, BURROW.y, BURROW.z - 0.4]);

// ------------------------------------------------------------------ hawk

const HAWK_SCALE = 1.9;
const H_BROWN = [0.42, 0.28, 0.16], H_DARK = [0.2, 0.13, 0.08], H_CREAM = [0.88, 0.78, 0.62];
const HAWK_WING = makeWing([0, 0.1],
    [[0.35, 0.1], [0.6, 0.8], [0.5, 1.8], [0.1, 2.6], [-0.35, 2.5], [-0.45, 1.4], [-0.3, 0.3]],
    [[0.34, 0.22, 0.13], [0.48, 0.33, 0.2], [0.6, 0.45, 0.3], H_DARK, H_DARK, H_DARK]);
const HAWK_TAILWING = makeWing([-0.4, 0.05],
    [[-0.4, 0.2], [-0.8, 0.45], [-1.3, 0.5], [-1.5, 0.25], [-1.5, 0.05]],
    [[0.34, 0.22, 0.13], [0.55, 0.38, 0.24], [0.75, 0.55, 0.36], H_DARK, H_DARK, H_DARK]);
function hawkBody() {
    const parts = [];
    const add = (c, r, col, R = I3) => parts.push({ c, R, r, col, mesh: SPHERE_LO });
    add([0, 0, 0], [0.95, 0.34, 0.32], H_BROWN);
    add([0.3, 0, -0.1], [0.6, 0.27, 0.22], H_CREAM);
    add([0.98, 0, 0.1], [0.3, 0.25, 0.25], H_DARK);
    add([1.24, 0, 0.03], [0.14, 0.06, 0.07], [0.95, 0.76, 0.22], rotY(0.4));
    for (const s of [1, -1]) add([1.12, s * 0.15, 0.17], [0.05, 0.05, 0.05], [0.95, 0.85, 0.2]);
    return parts;
}
const HAWK_BODY = hawkBody();
const HAWK_CORNERS = cornersOf(HAWK_BODY) + 2 * (HAWK_WING.length + HAWK_TAILWING.length);

const HK = {
    x: -20, y: 20, z: 24, heading: 0, yaw: 0, pitch: 0, roll: 0, phase: 0,
    state: "circle", t: 0, orbit: rnd() * 6, cx: 0, cy: 0, from: null, target: null, flap: 0,
};

function writeHawk(o) {
    const G = mul(rotZ(HK.yaw), mul(rotY(HK.pitch), rotX(HK.roll)));
    const base = [HK.x, HK.y, HK.z];
    const S = [HAWK_SCALE, HAWK_SCALE, HAWK_SCALE];
    o = writeEllipsoids(o, HAWK_BODY, G, S, base);
    const dive = HK.state === "dive";
    const beat = 0.1 + 0.75 * (0.5 + 0.5 * Math.sin(HK.phase));
    const ang = dive ? 0.95 : lerp(0.12, beat, HK.flap);
    return writeWings(o, G, base, HAWK_SCALE, HAWK_WING, HAWK_TAILWING, ang, ang * 0.3);
}

// ------------------------------------------------------------------ particles (dirt, sparkles, feathers)

const PARTICLE_MAX = 260;
const parts = [];

function burst(x, y, z, n, colors, speed = 3, size = 0.12, life = 0.8, grav = 6) {
    for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, u = rnd(), sp = speed * (0.3 + 0.7 * rnd());
        parts.push({ x, y, z, vx: Math.cos(a) * sp * (1 - u * 0.5), vy: Math.sin(a) * sp * (1 - u * 0.5), vz: sp * (0.4 + u),
            life: life * (0.6 + 0.4 * rnd()), max: life, s: size * (0.6 + 0.8 * rnd()), c: colors[i % colors.length], g: grav });
    }
    if (parts.length > PARTICLE_MAX) parts.splice(0, parts.length - PARTICLE_MAX);
}

function updateParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        p.vz -= p.g * dt;
        p.x += (p.vx + Math.cos(W.dir) * W.strength * 0.5) * dt;
        p.y += (p.vy + Math.sin(W.dir) * W.strength * 0.5) * dt;
        p.z += p.vz * dt;
        if (p.life <= 0) parts.splice(i, 1);
    }
}

// camera-facing diamonds
function writeParticles(o) {
    const X = space.xUnitVec, Y = space.yUnitVec;
    for (const p of parts) {
        const s = p.s * Math.min(1, (p.life / p.max) * 1.8);
        const [r, g, b] = p.c;
        const pts = [
            [p.x + Y[0] * s, p.y + Y[1] * s, p.z + Y[2] * s], [p.x + X[0] * s, p.y + X[1] * s, p.z + X[2] * s],
            [p.x - Y[0] * s, p.y - Y[1] * s, p.z - Y[2] * s], [p.x - X[0] * s, p.y - X[1] * s, p.z - X[2] * s],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) {
            pos[o] = pts[k][0]; pos[o + 1] = pts[k][1]; pos[o + 2] = pts[k][2]; pos[o + 3] = 1;
            col[o] = r; col[o + 1] = g; col[o + 2] = b; col[o + 3] = 1;
            o += 4;
        }
    }
    return o;
}

// ------------------------------------------------------------------ shader (grass.html's fog + cloud shadows, plus hawk shadow and dusk)

const GRASS_VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;      // (zShifter, magnifier, unused) - name kept so Space sets it
uniform vec2 uAspect;        // lets the canvas fill any screen instead of a 2:1 box

varying vec4 vcol;
varying float vDepth;
varying vec2 vGround;

const float NEAR = 0.3;
const float FAR = 1600.0;

void main() {
    vcol = col;
    vec3 d = pos.xyz - cPoint;
    float xProj = dot(d, xAxis);
    float yProj = dot(d, yAxis);
    float zProj = dot(d, zAxis);
    vDepth = zProj;
    vGround = pos.xy;
    float mag = veriables.y;
    // Space.js's projection  x / (maxWidth*16), y / (maxWidth*8), maxWidth = z*0.1/magnifier,
    // in homogeneous form so grass behind the camera is clipped instead of mirrored
    gl_Position = vec4(xProj * mag / 1.6 * uAspect.x, yProj * mag / 0.8 * uAspect.y,
                       zProj * (FAR + NEAR) / (FAR - NEAR) - 2.0 * FAR * NEAR / (FAR - NEAR), zProj);
}`;

const GRASS_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec4 vcol;
varying float vDepth;
varying vec2 vGround;

uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float time;
uniform vec4 hawk;           // shadow centre xy, radius, darkness
uniform vec3 tint;           // season, evening and rain light
uniform float outdoor;       // 1 in the meadow, 0 inside Hazel's shop
uniform vec4 fire;           // campfire glow: xy, spread, strength
uniform float filterMode;    // 0 none, 1 warm film, 2 watercolour, 3 storybook
uniform vec2 res;

float noise2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec3 c = vcol.rgb;
    if (outdoor > 0.5) {
        // two slow, crossing waves make soft cloud shadows that drift across the field
        float cloud = sin(vGround.x * 0.07 + time * 0.35) * sin(vGround.y * 0.06 - time * 0.22)
                    + 0.5 * sin((vGround.x + vGround.y) * 0.11 + time * 0.5);
        c *= mix(0.72, 1.06, smoothstep(-0.6, 0.6, cloud));
        float h = 1.0 - smoothstep(hawk.z * 0.3, hawk.z, length(vGround - hawk.xy));
        c *= 1.0 - hawk.w * h;
    }
    float fd = length(vGround - fire.xy);
    c += vec3(1.0, 0.55, 0.2) * fire.w * exp(-fd * fd / fire.z);
    c *= tint;
    float f = smoothstep(fogRange.x, fogRange.y, vDepth);
    c = mix(c, fogColor, f * 0.85);

    vec2 uv = gl_FragCoord.xy / res;
    float vig = smoothstep(0.95, 0.3, length(uv - 0.5));
    if (filterMode > 0.5 && filterMode < 1.5) {
        c = pow(max(c, 0.0), vec3(0.92)) * vec3(1.07, 1.0, 0.86);
        c += (noise2(gl_FragCoord.xy + fract(time) * 91.0) - 0.5) * 0.07;
        c *= 0.8 + 0.2 * vig;
    } else if (filterMode > 1.5 && filterMode < 2.5) {
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, vec3(l), 0.15);
        c = mix(c, floor(c * 7.0 + 0.5) / 7.0, 0.5);
        float paper = noise2(floor(gl_FragCoord.xy / 3.0)) * 0.06 + 0.035 * sin(uv.x * 40.0 + sin(uv.y * 30.0) * 2.0);
        c = c * 0.9 + 0.1 + paper - 0.05;
    } else if (filterMode > 2.5) {
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, 1.25) * 1.04 + 0.02;
        c = mix(c * vec3(0.55, 0.42, 0.35), c, 0.35 + 0.65 * vig);
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

(function setupShader() {
    const make = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    let p;
    try {
        p = gl.createProgram();
        gl.attachShader(p, make(gl.VERTEX_SHADER, GRASS_VERT));
        gl.attachShader(p, make(gl.FRAGMENT_SHADER, GRASS_FRAG));
        gl.bindAttribLocation(p, space.posId, "pos");
        gl.bindAttribLocation(p, space.colId, "col");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    } catch (err) {
        fail("The game's shader didn't compile on this device:\n\n" + err.message);
    }
    const U = (n) => gl.getUniformLocation(p, n);
    Object.assign(space, {
        program: p, cPointLoc: U("cPoint"), vPointLoc: U("vPoint"),
        xAxisLoc: U("xAxis"), yAxisLoc: U("yAxis"), zAxisLoc: U("zAxis"), varsLocation: U("veriables"),
    });
    gl.useProgram(p);
    gl.uniform3fv(space.varsLocation, new Float32Array([space.zShifter, space.magnifier, 0]));
    shader = { aspect: U("uAspect"), fog: U("fogColor"), fogRange: U("fogRange"), time: U("time"), hawk: U("hawk"), tint: U("tint"),
        outdoor: U("outdoor"), fire: U("fire"), filter: U("filterMode"), res: U("res") };
})();
resize();
window.addEventListener("resize", resize);

// ------------------------------------------------------------------ sound: wind, birdsong, effects (all synthesised)

class Sound {
    constructor(muted) { this.ctx = null; this.muted = muted; this.chirpIn = 3; }
    start() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const c = (this.ctx = new AC());
            this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(c.destination);
            const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
            let last = 0;
            for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }   // soft brown noise
            this.noise = buf;
            const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
            this.windLp = c.createBiquadFilter(); this.windLp.type = "lowpass"; this.windLp.frequency.value = 400;
            this.windGain = c.createGain(); this.windGain.gain.value = 0;
            src.connect(this.windLp); this.windLp.connect(this.windGain); this.windGain.connect(this.master);
            src.start();
        }
        this.ctx.resume();
    }
    suspend() { if (this.ctx) this.ctx.suspend(); }
    resume() { if (this.ctx) this.ctx.resume(); }
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); }
    tick(dt, wind, quiet) {
        if (!this.ctx || this.ctx.state !== "running") return;
        const t = this.ctx.currentTime;
        this.windGain.gain.setTargetAtTime(0.05 + wind * 0.16, t, 0.3);
        this.windLp.frequency.setTargetAtTime(250 + wind * 650, t, 0.3);
        this.chirpIn -= dt;
        if (this.chirpIn <= 0) { this.chirpIn = 2.5 + Math.random() * 6; if (!quiet) this.chirp(); }   // birds go quiet when the hawk hunts
    }
    tone(type, f0, f1, dur, vol, delay = 0) {
        const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    hiss(dur, vol, freq, type = "lowpass") {
        const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.noise; f.type = type; f.frequency.value = freq;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    chirp() {
        const base = 2600 + Math.random() * 1400, n = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) this.tone("sine", base, base * (1.2 + Math.random() * 0.3), 0.07, 0.035, i * 0.11);
    }
    on(name, n = 0) {
        if (!this.ctx) return;
        switch (name) {
            case "jump": this.tone("triangle", 320, 620, 0.16, 0.1); break;
            case "dig": this.hiss(0.35, 0.25, 700); break;
            case "pop": this.tone("sine", 720, 360, 0.14, 0.18); this.hiss(0.1, 0.15, 1500); break;
            case "bank": [0, 4, 7, 12].slice(0, 2 + Math.min(2, n)).forEach((s, i) => this.tone("sine", 660 * 2 ** (s / 12), 660 * 2 ** (s / 12) * 1.01, 0.4, 0.12, i * 0.08)); break;
            case "screech": this.tone("sawtooth", 2100, 1300, 0.7, 0.07); this.tone("square", 1900, 1250, 0.6, 0.03, 0.05); break;
            case "dive": this.hiss(0.9, 0.3, 900, "bandpass"); break;
            case "caught": this.hiss(0.5, 0.4, 500); this.tone("sine", 300, 90, 0.5, 0.2); break;
            case "missed": this.tone("sine", 520, 780, 0.25, 0.1); break;
            case "day": [0, 4, 7, 11, 14].forEach((s, i) => this.tone("sine", 523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.6, 0.1, i * 0.1)); break;
            case "over": this.tone("sine", 440, 150, 1.0, 0.14); break;
        }
    }
}
const sound = new Sound(load("meadowhop-muted", "0") === "1");

// ------------------------------------------------------------------ game state

const DAY_LEN = 150;
const STALK = 3.4, DIVE = 0.8, RISE = 2.4;
const best = (() => { try { return JSON.parse(load("meadowhop-best", "null")) || { days: 0, carrots: 0 }; } catch { return { days: 0, carrots: 0 }; } })();

const G = {
    state: "title", paused: false, time: 0, clock: 0, day: 1, target: 5, banked: 0, total: 0, lives: 3,
    hawkIn: 22, shake: 0, status: "", fullWarned: 0,
};
const dayTarget = (d) => Math.min(15, 3 + 2 * d);

function spawnCarrot(nx, ny, spread) {
    for (let tries = 0; tries < 200; tries++) {
        const x = nx === undefined ? (rnd() * 2 - 1) * 31 : nx + (rnd() * 2 - 1) * spread;
        const y = ny === undefined ? (rnd() * 2 - 1) * 31 : ny + (rnd() * 2 - 1) * spread;
        if (Math.abs(x) > 32 || Math.abs(y) > 32 || isReeds(x, y) || isWater(x, y)) continue;
        if (Math.hypot(x - BURROW.x, y - BURROW.y) < 6) continue;
        if (carrots.some((k) => Math.hypot(k.x - x, k.y - y) < 3.5)) continue;
        if (nx === undefined && rnd() > 0.25 + 0.75 * lush(x, y)) continue;   // they like the thick grass
        carrots.push({ x, y, z: height(x, y) - 0.02, yaw: rnd() * 6.28, phase: rnd() * 6.28, dug: 0, gust: 0 });
        return true;
    }
    return false;
}

function startDay(d) {
    G.day = d;
    G.target = dayTarget(d);
    G.banked = owns("partner") ? 1 : 0;              // your partner keeps a carrot for you
    G.clock = 0;
    G.hawkIn = 20;
    G.caughtToday = 0;
    G.shopCooldown = 0;
    G.status = "";
    W.boost = Math.min(0.6, (d - 1) * 0.15);
    const season = seasonOf(d);
    if (season !== SEASON || !blades.sr) applySeason(season);
    carrots.length = 0;
    for (let i = 0; i < Math.min(CARROT_MAX - 1, G.target + 3); i++) spawnCarrot();
    if (d >= 2) spawnGold();
    clovers.length = 0;
    for (let i = 0; i < 2 + (owns("flowers") ? 2 : 0); i++) spawnClover();
    Object.assign(C, { x: BURROW.x + Math.cos(BURROW.yaw) * 3.5, y: BURROW.y + Math.sin(BURROW.yaw) * 3.5, vx: 0, vy: 0, z: 0, vz: 0, carry: 0, gold: 0, dig: 0, digTarget: null, crouch: 0 });
    C.yaw = BURROW.yaw;
    Object.assign(HK, { state: "circle", t: 0, feinted: false });
    Object.assign(FX, { on: false, spawned: false });
    planRain();
    RAIN.amt = 0;
    pickQuest(d);
    parts.length = 0;
    G.state = "play";
    G.paused = false;
    showOnly(null);
    el.hud.classList.add("on");
    el.controls.classList.toggle("on", TOUCH);
    const fresh = d === 1 || seasonOf(d - 1) !== season;
    banner((fresh ? season.name + " has come. " : "") + "Day " + d + ": bring " + G.target + " carrots home before sunset", 3.4);
    updateHud(true);
}

const isHome = () => owns("cottage") ? Math.hypot(C.x - HOME_DOOR[0], C.y - HOME_DOOR[1]) < 2.0 : Math.hypot(C.x - BURROW.x, C.y - BURROW.y) < BURROW.r + 1.1;
const isHidden = () => C.crouch > 0.7 && coverAt(C.x, C.y) > 0.6;
const isSafe = () => isHome() || isHidden();
const multi = () => 1;

function dropCarried() {
    for (let i = 0; i < C.carry - C.gold; i++) spawnCarrot(C.x, C.y, 5);
    if (C.gold) spawnGold();
    C.carry = 0;
    C.gold = 0;
}

function caught(source = "hawk") {
    G.lives--;
    G.caughtToday++;
    const had = C.carry;
    dropCarried();
    G.shake = 1;
    flash();
    sound.on("caught");
    if (navigator.vibrate) navigator.vibrate([90, 50, 140]);
    const cols = source === "fox" ? [[0.9, 0.5, 0.2], [1, 0.95, 0.9]] : [[0.5, 0.35, 0.22], [0.9, 0.82, 0.68], [1, 0.95, 0.9]];
    burst(C.x, C.y, height(C.x, C.y) + 1.5, 26, cols, 4, 0.16, 1.4, 2);
    updateHud(true);
    if (G.lives <= 0) return gameOver(source);
    const who = source === "fox" ? "The fox" : "The hawk";
    banner(had ? who + " caught you, and you dropped your carrots" : who + " caught you", 2.6);
}

function dayComplete() {
    G.state = "dayEnd";
    RAIN.on = false;
    FX.on = false;
    sound.on("day");
    const left = dayLength() - G.clock;
    if (G.caughtToday === 0) questProgress("clean");
    const stars = 1 + (G.caughtToday === 0 ? 1 : 0) + (left >= 30 ? 1 : 0);
    const earned = 3 + stars * 2;
    saveData.clovers += earned;
    persist();
    best.days = Math.max(best.days, G.day);
    best.carrots = Math.max(best.carrots, G.total);
    save("meadowhop-best", JSON.stringify(best));
    $("dayTitle").textContent = "Day " + G.day + " done";
    $("dayStars").textContent = "\u2605".repeat(stars) + "\u2606".repeat(3 - stars);
    $("dayStars").setAttribute("aria-label", stars + " of 3 stars");
    $("dayCarrots").textContent = G.banked + " carrots";
    $("dayLeft").textContent = Math.ceil(left) + " s of daylight left";
    $("dayLives").textContent = G.lives + " of 3";
    $("dayClovers").textContent = "+" + earned + " (you have " + saveData.clovers + ")";
    $("dayQuest").textContent = G.quest ? (G.quest.done ? "Done, +" + G.quest.q.reward + " clovers" : "Not finished") : "";
    const next = seasonOf(G.day + 1);
    $("dayNote").textContent = next !== SEASON ? next.name + " arrives tomorrow." : "Tomorrow needs more carrots, and the hawk grows bolder.";
    $("nextDayBtn").textContent = "Start day " + (G.day + 1);
    el.hud.classList.remove("on");
    el.controls.classList.remove("on");
    showOnly(el.dayEnd);
}

function gameOver(reason) {
    G.state = "over";
    FX.on = false; RAIN.on = false;
    sound.on("over");
    const days = G.day - 1;
    best.days = Math.max(best.days, days);
    best.carrots = Math.max(best.carrots, G.total);
    save("meadowhop-best", JSON.stringify(best));
    $("overTitle").textContent = reason === "hawk" ? "The hawk got you" : reason === "fox" ? "The fox got you" : "The sun has set";
    $("overText").textContent = reason === "fox" ? "Foxes hunt at dusk. Hide in tall grass to break its line of sight, or run for the burrow or the campfire." : reason === "hawk"
        ? "Hide in tall grass or run home when its shadow comes for you."
        : "The burrow was " + (G.target - G.banked) + " carrots short. Follow the butterfly to find them faster.";
    $("overDays").textContent = String(days);
    $("overCarrots").textContent = String(G.total);
    $("overBest").textContent = best.days + (best.days === 1 ? " day, " : " days, ") + best.carrots + " carrots";
    el.hud.classList.remove("on");
    el.controls.classList.remove("on");
    showOnly(el.over);
}

// ------------------------------------------------------------------ input

const keys = new Set();
const KEYMAP = {
    KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
    Space: "j", ShiftLeft: "h", ShiftRight: "h", KeyC: "h",
};
let jumpQueued = false, hideHeld = false;

// capture phase so Space.js's own Z / Q / P debug keys never fire
window.addEventListener("keydown", (e) => {
    if (e.code === "KeyZ" || e.code === "KeyQ" || e.code === "KeyP") { e.stopPropagation(); return; }
    if (e.code === "Escape") { setPaused(!G.paused); return; }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (k === "j" && !e.repeat) jumpQueued = true;
    keys.add(k);
}, true);
window.addEventListener("keyup", (e) => keys.delete(KEYMAP[e.code]));
window.addEventListener("blur", () => { keys.clear(); hideHeld = false; });

// touch: left half = floating joystick, right half = look around. Mouse: drag to look, wheel to zoom.
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let lookDrag = null;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (TOUCH && (G.scene !== "meadow" || (G.state === "play" && e.clientX < cssW * 0.5)) && stick.id === null) {
        Object.assign(stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
        el.stick.style.left = e.clientX + "px";
        el.stick.style.top = e.clientY + "px";
        el.knob.style.transform = "translate(-50%, -50%)";
        el.stick.classList.add("on");
        return;
    }
    if (!lookDrag && G.scene === "meadow") lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, alpha: space.alpha, beta: space.beta };
});
canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === stick.id) {
        let dx = (e.clientX - stick.ox) / 55, dy = (e.clientY - stick.oy) / 55;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        stick.x = dx; stick.y = -dy;
        el.knob.style.transform = "translate(calc(-50% + " + dx * 34 + "px), calc(-50% + " + dy * 34 + "px))";
    } else if (lookDrag && e.pointerId === lookDrag.id) {
        space.alpha = lookDrag.alpha + (e.clientX - lookDrag.x) / 250;
        space.beta = lookDrag.beta + (e.clientY - lookDrag.y) / 250;
        syncCamera();
    }
});
const endPointer = (e) => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; el.stick.classList.remove("on"); }
    if (lookDrag && e.pointerId === lookDrag.id) lookDrag = null;
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("wheel", (e) => { e.preventDefault(); camR = clamp(camR * Math.exp(e.deltaY * 0.0012), 12, 45); }, { passive: false });

// on-screen buttons (hold Hide)
const holdButton = (btn, onDown, onUp) => {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add("down"); onDown(); });
    const up = () => { btn.classList.remove("down"); onUp(); };
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
};

// ------------------------------------------------------------------ update

let time = 0, camR = 22;

function moveInput() {
    // screen directions -> world, using Space's own camera axes (so "right" is always screen-right)
    const f = normalize([space.zUnitVec[0], space.zUnitVec[1], 0]);
    const r = normalize([space.xUnitVec[0], space.xUnitVec[1], 0]);
    let ix = stick.x, iy = stick.y;
    if (keys.has("r")) ix += 1;
    if (keys.has("l")) ix -= 1;
    if (keys.has("f")) iy += 1;
    if (keys.has("b")) iy -= 1;
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    return [r[0] * ix + f[0] * iy, r[1] * ix + f[1] * iy];
}

function updateBunny(dt) {
    const playing = G.state === "play" || G.scene !== "meadow";
    const hide = G.state === "play" && G.scene === "meadow" && (hideHeld || keys.has("h"));
    C.crouch += ((hide ? 1 : 0) - C.crouch) * Math.min(1, dt * 10);
    let mv = playing ? moveInput() : [0, 0];
    if (C.dig > 0) mv = [0, 0];
    if (G.scene === "shop") mv = shopWalk(mv);
    const spd = WALK_SPEED * (1 - 0.62 * C.crouch) * (1 - 0.07 * C.carry);
    const ease = Math.min(1, dt * 10);
    C.vx += (mv[0] * spd - C.vx) * ease;
    C.vy += (mv[1] * spd - C.vy) * ease;
    const lim = FIELD - 2;
    const nx = clamp(C.x + C.vx * dt, -lim, lim), ny = clamp(C.y + C.vy * dt, -lim, lim);
    const blocked = (x, y) => G.scene === "shop" ? shopBlocked(x, y) : G.scene === "house" ? houseBlocked(x, y)
        : isWater(x, y) || (owns("cottage") ? inHouseFoot(x, y) : Math.hypot(x - BURROW.x, y - BURROW.y) < 1.4)
        || Math.hypot(x - SHOP.x, y - SHOP.y) < 2.4 || (owns("campfire") && Math.hypot(x - FIRE.x, y - FIRE.y) < 1.3);   // can't walk through the mound
    if (!blocked(nx, C.y)) C.x = nx; else C.vx = 0;
    if (!blocked(C.x, ny)) C.y = ny; else C.vy = 0;

    const speed = Math.hypot(C.vx, C.vy);
    C.walk += (Math.min(1, speed / WALK_SPEED) - C.walk) * Math.min(1, dt * 8);
    if (speed > 0.3) C.yaw += wrapAngle(Math.atan2(C.vy, C.vx) - C.yaw) * Math.min(1, dt * 10);
    C.phase += dt * 11 * Math.max(C.walk, speed > 0.2 ? 0.3 : 0);
    C.hop = Math.abs(Math.sin(C.phase)) * 0.45 * C.walk * (1 - 0.85 * C.crouch);

    const grounded = C.z <= 0;
    if (jumpQueued && grounded && C.dig <= 0 && C.crouch < 0.5 && playing) { C.vz = JUMP_SPEED; sound.on("jump"); }
    jumpQueued = false;
    C.vz -= GRAVITY * dt;
    C.z += C.vz * dt;
    if (C.z <= 0) {
        if (C.vz < -4) C.land = Math.min(0.9, -C.vz / 14);
        C.z = 0; C.vz = 0;
    }
    C.land *= Math.exp(-dt * 9);

    // ears on a spring: back when running, flat when hiding, fluttering in the wind
    const earTarget = 0.12 + 0.4 * C.walk + 0.1 * Math.cos(2 * C.phase) * C.walk - 0.035 * C.vz + 0.95 * C.crouch
        + 0.06 * W.strength * Math.sin(time * 9);
    C.earV += ((earTarget - C.ear) * 70 - C.earV * 7) * dt;
    C.ear += C.earV * dt;

    C.blinkIn -= dt;
    if (C.blinkIn < 0) { C.blinkIn = 1.8 + Math.random() * 3.2; C.blinkT = 0.14; }
    if (C.blinkT > 0) { C.blinkT -= dt; C.blink = 0.08; } else C.blink = 1;
}

// A smarter hawk. It hunts in several ways:
//  - stalks and dives, aiming where you're running rather than where you are
//  - if you're hidden, it waits right above you and strikes the moment you move
//  - sometimes it pulls up as if giving up, then comes straight back
//  - from day 3, low swoops across the grass: crouch or jump
//  - when you carry a load home it waits over the burrow
//  - it avoids campfire smoke and shelters from rain
const hawkInterval = () => (Math.max(10, 27 - 3 * G.day) + rnd() * 10) * (owns("scarecrow") ? 1.4 : 1);
const hawkWarn = () => STALK + (owns("cottage") ? 1 : 0);
const hawkGrounded = () => RAIN.amt > 0.35;

function startAttack() {
    if (nearFire(C.x, C.y) || isHome()) { G.hawkIn = 3 + rnd() * 3; return; }
    sound.on("screech");
    HK.feinted = false;
    if (G.day >= 3 && rnd() < 0.35) {
        const a = rnd() * TAU2;
        HK.state = "swoop"; HK.t = 0; HK.hitDone = false;
        HK.from = [C.x - Math.cos(a) * 34, C.y - Math.sin(a) * 34];
        HK.target = [C.x + Math.cos(a) * 34, C.y + Math.sin(a) * 34];
        banner("Low swoop! Crouch down or jump", 2.2);
    } else {
        HK.state = "stalk"; HK.t = 0; HK.warn = hawkWarn();
        banner("Hawk! Hide in tall grass or run to the burrow", HK.warn);
    }
}

function startDive() {
    HK.state = "dive"; HK.t = 0;
    HK.from = [HK.x, HK.y, HK.z];
    let lx = C.vx * 0.45, ly = C.vy * 0.45;
    const l = Math.hypot(lx, ly);
    if (l > 3.5) { lx *= 3.5 / l; ly *= 3.5 / l; }
    HK.target = [C.x + lx, C.y + ly, height(C.x, C.y) + 1.2];
    sound.on("dive");
}

function hawkRise(interval) {
    HK.state = "rise"; HK.t = 0;
    const a = rnd() * TAU2;
    HK.from = [HK.x, HK.y, HK.z];
    HK.target = [HK.x + Math.cos(a) * 22, HK.y + Math.sin(a) * 22, 24];
    G.hawkIn = interval;
}

function updateHawk(dt) {
    HK.t += dt;
    const px = HK.x, py = HK.y, pz = HK.z;
    const bz = height(C.x, C.y);
    const hunting = G.state === "play";
    const follow = (tx, ty, tz, rate) => { const k = Math.min(1, dt * rate); HK.x += (tx - HK.x) * k; HK.y += (ty - HK.y) * k; HK.z += (tz - HK.z) * k; };
    if (hunting && hawkGrounded() && HK.state !== "away") { HK.state = "away"; HK.t = 0; }
    switch (HK.state) {
        case "circle": {
            const ambush = C.carry >= 2 && G.day >= 2 && hunting;
            const wx = ambush ? BURROW.x : C.x * 0.6, wy = ambush ? BURROW.y : C.y * 0.6;
            HK.cx += (wx - HK.cx) * dt * 0.15;
            HK.cy += (wy - HK.cy) * dt * 0.15;
            HK.orbit += dt * 0.22;
            const r = ambush ? 10 : 17;
            follow(HK.cx + Math.cos(HK.orbit) * r, HK.cy + Math.sin(HK.orbit) * r, 23 + 2 * Math.sin(time * 0.3), 1.2);
            HK.flap += ((Math.sin(time * 0.45 + 1) > 0.6 ? 1 : 0) - HK.flap) * Math.min(1, dt * 3);
            if (hunting) {
                G.hawkIn -= dt;
                if (ambush && Math.hypot(C.x - BURROW.x, C.y - BURROW.y) < 11 && G.hawkIn > 2) G.hawkIn = 2;
                if (G.hawkIn <= 0) startAttack();
            }
            break;
        }
        case "stalk":
            follow(C.x, C.y, bz + 11, 1.6);
            HK.flap += (1 - HK.flap) * Math.min(1, dt * 3);
            if (HK.t > HK.warn) {
                if (isSafe() || nearFire(C.x, C.y)) { HK.state = "wait"; HK.t = 0; if (hunting) banner("It's circling right above you. Stay hidden", 2.2); }
                else if (!HK.feinted && rnd() < 0.25) { HK.feinted = true; HK.state = "feint"; HK.t = 0; }
                else startDive();
            }
            break;
        case "feint":
            follow(C.x + 9, C.y + 9, bz + 17, 1.4);
            if (HK.t > 1.4) { HK.state = "stalk"; HK.warn = 1.1; HK.t = 0; sound.on("screech"); if (hunting) banner("It's coming back!", 1.2); }
            break;
        case "wait":
            HK.orbit += dt * 1.3;
            follow(C.x + Math.cos(HK.orbit) * 3.5, C.y + Math.sin(HK.orbit) * 3.5, bz + 9, 2);
            HK.flap = 1;
            if (!isSafe() && !nearFire(C.x, C.y)) { HK.state = "stalk"; HK.warn = 0.85; HK.t = 0; if (hunting) banner("It saw you move!", 1); }
            else if (HK.t > 6) {
                if (hunting) { questProgress("hide"); banner("The hawk gave up", 1.6); sound.on("missed"); }
                hawkRise(hawkInterval() * 0.7);
            }
            break;
        case "dive": {
            const e = Math.min(1, HK.t / DIVE), k = e * e;
            HK.x = lerp(HK.from[0], HK.target[0], k); HK.y = lerp(HK.from[1], HK.target[1], k); HK.z = lerp(HK.from[2], HK.target[2], k);
            if (HK.t >= DIVE) {
                const near = Math.hypot(C.x - HK.target[0], C.y - HK.target[1]) < 2.8;
                if (hunting && near && !isSafe() && !nearFire(C.x, C.y)) caught("hawk");
                else if (hunting) {
                    if (near) questProgress("hide");
                    sound.on("missed");
                    banner(isHome() ? "Safe in the burrow" : near ? "Hidden. The hawk missed you" : "Too quick for it", 1.8);
                }
                burst(HK.target[0], HK.target[1], HK.target[2], 12, [[0.5, 0.35, 0.22], [0.8, 0.7, 0.55]], 3, 0.14, 1.6, 1.5);
                hawkRise(hawkInterval());
            }
            break;
        }
        case "swoop": {
            const e = Math.min(1, HK.t / 3.2);
            HK.x = lerp(HK.from[0], HK.target[0], e); HK.y = lerp(HK.from[1], HK.target[1], e);
            HK.z = Math.max(height(HK.x, HK.y), WATER_LEVEL) + 2.3 + (1 - Math.sin(e * Math.PI)) * 6;
            HK.flap = 0.3;
            if (!HK.hitDone && Math.hypot(C.x - HK.x, C.y - HK.y) < 2.0) {
                HK.hitDone = true;
                const ducked = C.crouch > 0.6 && coverAt(C.x, C.y) > 0.3;
                if (hunting && !ducked && C.z < 1.0 && !isHome()) caught("hawk");
                else if (hunting) { sound.on("missed"); banner(C.z >= 1 ? "Jumped clear!" : "Ducked under it!", 1.5); questProgress("hide"); }
            }
            if (e >= 1) hawkRise(hawkInterval());
            break;
        }
        case "rise": {
            const e = Math.min(1, HK.t / RISE), k = 1 - (1 - e) * (1 - e);
            HK.x = lerp(HK.from[0], HK.target[0], k); HK.y = lerp(HK.from[1], HK.target[1], k); HK.z = lerp(HK.from[2], HK.target[2], k);
            HK.flap = 1;
            if (HK.t >= RISE) { HK.state = "circle"; HK.t = 0; HK.orbit = Math.atan2(HK.y - HK.cy, HK.x - HK.cx); }
            break;
        }
        case "away":
            follow(C.x + 60, C.y + 60, 42, 0.5);
            HK.flap = 1;
            if (!hawkGrounded() && HK.t > 3) { HK.state = "circle"; HK.t = 0; HK.orbit = Math.atan2(HK.y - HK.cy, HK.x - HK.cx); G.hawkIn = Math.max(G.hawkIn, 12); }
            break;
    }
    HK.phase += dt * (HK.flap > 0.5 ? 8 : 3);
    const vx = (HK.x - px) / Math.max(dt, 1e-3), vy = (HK.y - py) / Math.max(dt, 1e-3), vz = (HK.z - pz) / Math.max(dt, 1e-3);
    if (Math.hypot(vx, vy) > 0.5) {
        const d = wrapAngle(Math.atan2(vy, vx) - HK.yaw);
        HK.yaw += d * Math.min(1, dt * 4);
        HK.roll = clamp(-d * 1.2, -0.7, 0.7);
    }
    HK.pitch = clamp(-vz * 0.03, -1.0, 0.5);
}

function updateCarrots(dt) {
    let nearest = null, nd = Infinity, guide = null, gd = Infinity;
    for (const k of carrots) {
        k.gust = gustHere(k.x, k.y);
        // strong gusts flatten the grass and carrot tops catch the light; the golden one always sparkles a little
        const glint = k.gust > 0.75 && W.strength > 0.65 && RAIN.amt < 0.5 ? dt * 2.5 : k.gold ? dt * 0.8 : 0;
        if (!k.dug && rnd() < glint) burst(k.x, k.y, k.z + 0.9, 3, k.gold ? [[1, 0.85, 0.3], [1, 1, 0.8]] : [[1, 0.9, 0.5], [1, 1, 0.85]], 0.8, 0.07, 0.6, -0.5);
        const d = Math.hypot(k.x - C.x, k.y - C.y);
        if (!k.dug && d < nd) { nd = d; nearest = k; }
        if (!k.dug && !k.gold && d < gd) { gd = d; guide = k; }
    }
    BF.target = G.state === "play" ? guide : null;           // the butterfly won't give the golden one away
    for (const c of clovers) if (rnd() < dt * (0.35 + (gustHere(c.x, c.y) > 0.75 ? 2 : 0))) burst(c.x, c.y, c.z + 0.5, 2, [[0.5, 1, 0.5], [0.85, 1, 0.8]], 0.6, 0.06, 0.6, -0.4);
    if (G.state !== "play") return;

    for (let i = clovers.length - 1; i >= 0; i--) {
        const c = clovers[i];
        if (Math.hypot(c.x - C.x, c.y - C.y) > 1.3) continue;
        clovers.splice(i, 1);
        saveData.clovers++;
        persist();
        sound.on("clover");
        burst(c.x, c.y, c.z + 0.6, 14, [[0.4, 0.9, 0.4], [0.85, 1, 0.75]], 2.5, 0.1, 0.9, 3);
        banner("Four-leaf clover! You have " + saveData.clovers, 1.6);
        questProgress("clover");
        updateHud(true);
    }

    if (C.dig > 0) {
        C.dig -= dt;
        const k = C.digTarget;
        k.dug = Math.min(1, k.dug + dt / C.digDur);
        if (rnd() < dt * 20) burst(k.x, k.y, k.z + 0.2, 2, [[0.45, 0.32, 0.2], [0.35, 0.25, 0.15]], 2.5, 0.09, 0.5, 9);
        if (C.dig <= 0) {
            carrots.splice(carrots.indexOf(k), 1);
            C.carry++;
            if (k.gold) C.gold++;
            C.digTarget = null;
            sound.on(k.gold ? "clover" : "pop");
            banner(k.gold ? "The golden carrot! It's worth 3" : C.carry >= carryCap() ? "Paws full. Take them to the burrow" : "Carrot! Carrying " + C.carry + " of " + carryCap(), 1.6);
            updateHud(true);
        }
    } else if (nearest && nd < 1.6 && C.z <= 0.05) {
        if (C.carry < carryCap()) {
            C.digDur = 0.55 * (1 - 0.45 * RAIN.amt);              // wet soil digs faster
            C.dig = C.digDur;
            C.digTarget = nearest;
            nearest.dug = 0.001;
            sound.on("dig");
        } else if (time - G.fullWarned > 3) {
            G.fullWarned = time;
            banner("Paws full. Take them to the burrow", 1.8);
        }
    }

    if (isHome() && C.carry > 0) {
        const n = C.carry, value = n - C.gold + C.gold * 3;
        if (n >= carryCap()) questProgress("trip");
        if (C.gold) questProgress("gold");
        G.banked += value; G.total += value; C.carry = 0; C.gold = 0;
        sound.on("bank", n);
        burst(BURROW.x, BURROW.y, BURROW.z + 1.3, 22, [[1, 0.6, 0.2], [1, 0.9, 0.5], [0.4, 0.8, 0.3]], 3, 0.12, 1.0, 5);
        updateHud(true);
        if (G.banked >= G.target) dayComplete();
        else banner("Stored " + value + ". " + (G.target - G.banked) + " more to go", 1.8);
    }
}

function updateCamera(dt) {
    if (G.scene !== "meadow") {
        const f = G.scene === "house" ? { x: 0, y: 1.2 } : SHOP_IN.sel >= 0 ? PEDESTALS[SHOP_IN.sel] : { x: 0, y: 2 };
        const k = Math.min(1, dt * 2.5);
        space.X0 += (lerp(C.x, f.x, 0.55) - space.X0) * k;
        space.Y0 += (lerp(C.y, f.y, 0.55) - space.Y0) * k;
        space.Z0 += (1.3 - space.Z0) * k;
        space.alpha += (-Math.PI / 2 + Math.sin(time * 0.25) * 0.1 - space.alpha) * k;
        space.beta += (0.5 - space.beta) * k;
        space.Rc += ((G.scene === "house" ? 13.5 : SHOP_IN.sel >= 0 ? 10 : 12.5) - space.Rc) * k;
        syncCamera();
        return;
    }
    if (G.state === "title") {
        space.alpha += dt * 0.08;
        space.beta += (0.42 - space.beta) * Math.min(1, dt);
        space.Rc += (30 - space.Rc) * Math.min(1, dt);
    } else {
        space.Rc += (camR - space.Rc) * Math.min(1, dt * 3);
    }
    const k = Math.min(1, dt * 4);
    const sh = G.shake;
    G.shake *= Math.exp(-dt * 5);
    space.X0 += (C.x - space.X0) * k + (rnd() - 0.5) * sh;
    space.Y0 += (C.y - space.Y0) * k + (rnd() - 0.5) * sh;
    space.Z0 += (height(C.x, C.y) + 1.6 - space.Z0) * k + (rnd() - 0.5) * sh * 0.5;
    syncCamera();
}

// sky colour, light tint and how dark it is (for lanterns and windows), from season, time of day and rain
function skyNow() {
    const base = SEASON.sky;
    const f = G.state === "title" ? 0.2 : G.clock / dayLength();
    let sky, tint, dusk = 0;
    if (f < 0.55) { sky = base; tint = [1, 1, 1]; }
    else if (f < 0.8) { const t = (f - 0.55) / 0.25; sky = mix3(base, SKY_GOLD, t); tint = mix3([1, 1, 1], [1.08, 0.94, 0.8], t); dusk = t * 0.5; }
    else { const t = Math.min(1, (f - 0.8) / 0.2); sky = mix3(SKY_GOLD, SKY_DUSK, t); tint = mix3([1.08, 0.94, 0.8], [0.78, 0.7, 0.92], t); dusk = 0.5 + t * 0.5; }
    if (SEASON.name === "Winter") tint = mix3(tint, [0.95, 0.98, 1.06], 0.6);
    if (SEASON.name === "Autumn") tint = mix3(tint, [1.05, 0.97, 0.88], 0.5);
    const r = RAIN.amt;
    sky = mix3(sky, [0.5, 0.54, 0.6], r * 0.7);
    tint = mix3(tint, [0.8, 0.84, 0.9], r * 0.55);
    return [sky, tint, Math.min(1, dusk + r * 0.4)];
}

function step(dt) {
    time += dt;
    syncHomeButtons();
    updateWind(dt, time);
    const inShop = G.scene !== "meadow";
    if (!inShop) {
        if (G.state === "play") {
            G.clock += dt;
            if (G.clock >= dayLength()) return gameOver("sunset");
        }
        updateRain(dt);
    }
    updateBunny(dt);
    if (inShop) (G.scene === "house" ? updateHouse : updateShop)(dt);
    else {
        updateButterfly(dt, time);
        updateHawk(dt);
        updateFox(dt);
        updateCarrots(dt);
        updateHome(dt);
        updateAmbient(dt);
    }
    updateParticles(dt);
    updateCamera(dt);
    sound.tick(dt, inShop ? 0.05 : W.strength, inShop || HK.state !== "circle" || RAIN.amt > 0.3);
    sound.rain(inShop ? 0 : RAIN.amt);
    if (G.state === "play" && !inShop) updateHud(false);
}

// ------------------------------------------------------------------ render

function render() {
    if (G.scene === "shop") return renderShop();
    if (G.scene === "house") return renderHouse();
    const [sky, tint, dusk] = skyNow();
    G.fireVis = lakeFireVisible();
    pushers.length = 0;
    pushers.push({ x: C.x, y: C.y, r: 2.4, s: 2.2 * Math.max(0, 1 - (C.z + C.hop) / 1.2) * (1 - 0.6 * C.crouch) });
    if (HK.state === "dive" || HK.state === "swoop" || (HK.state === "rise" && HK.t < 0.6)) pushers.push({ x: HK.x, y: HK.y, r: 6, s: 3 * Math.max(0, 1 - (HK.z - height(HK.x, HK.y)) / 12) });
    if (FX.on) pushers.push({ x: FX.x, y: FX.y, r: 1.9, s: 1.8 });     // you can see the grass part as the fox comes

    let o = writeBlades();
    o = writeBunny(o, time);
    o = writeButterfly(o);
    o = writePond(o, time, sky);
    o = writeCarrots(o, time);
    o = writeClovers(o);
    o = writeHome(o, time, dusk);
    o = writeHawk(o);
    o = writeFox(o, time);
    o = writeParticles(o);
    o = writeAmbient(o);
    o = writeRain(o);

    const above = HK.z - height(HK.x, HK.y);
    const shadowDark = HK.state === "away" ? 0 : clamp(0.62 - above * 0.018, 0.12, 0.55) * (1 - RAIN.amt * 0.7);
    gl.uniform4f(shader.hawk, HK.x, HK.y, 1.6 + above * 0.1, shadowDark);
    gl.uniform3fv(shader.fog, new Float32Array(sky));
    gl.uniform2f(shader.fogRange, space.Rc + 10 - RAIN.amt * 4, space.Rc + 70 - RAIN.amt * 32);
    gl.uniform1f(shader.time, time);
    gl.uniform3fv(shader.tint, new Float32Array(tint));
    gl.uniform1f(shader.outdoor, 1);
    const flick = 0.9 + 0.1 * Math.sin(time * 11) * Math.sin(time * 7.3);
    gl.uniform4f(shader.fire, FIRE.x, FIRE.y, 20, G.fireVis ? (0.14 + dusk * 0.42) * flick : 0);
    gl.uniform1f(shader.filter, FILTER_IDS[saveData.filter] || 0);
    gl.clearColor(sky[0], sky[1], sky[2], 1);

    space.posArr = pos.subarray(0, o);
    space.colArr = col.subarray(0, o);
    space.totalVert = o / 4;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.reDraw();
}

// ------------------------------------------------------------------ HUD + screens

const el = {
    hud: $("hud"), day: $("hudDay"), banked: $("hudBanked"), carry: $("hudCarry"), sun: $("sunFill"), lives: $("hudLives"),
    windArrow: $("windArrow"), windText: $("windText"), banner: $("banner"), status: $("status"), flash: $("flash"),
    controls: $("controls"), stick: $("stick"), knob: $("knob"), title: $("title"), dayEnd: $("dayEnd"), over: $("over"),
    pause: $("pause"), mute: $("muteBtn"),
};

let bannerTimer = 0;
function banner(text, secs) {
    el.banner.textContent = text;
    el.banner.classList.add("on");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove("on"), secs * 1000);
}
function flash() {
    el.flash.classList.remove("go");
    void el.flash.offsetWidth;
    el.flash.classList.add("go");
}

const hudCache = {};
const setText = (node, key, text) => { if (hudCache[key] !== text) { hudCache[key] = text; node.textContent = text; } };

function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    setText(el.day, "day", "Day " + G.day + " \u00b7 " + SEASON.name);
    setText(el.banked, "banked", G.banked + " / " + G.target);
    const cap = carryCap();
    setText(el.carry, "carry", "\u25C6".repeat(C.gold) + "\u25CF".repeat(C.carry - C.gold) + "\u25CB".repeat(Math.max(0, cap - C.carry)));
    setText(el.lives, "lives", "\u2665".repeat(G.lives) + "\u2661".repeat(Math.max(0, 3 - G.lives)));
    el.lives.setAttribute("aria-label", G.lives + " lives");
    el.sun.style.transform = "scaleX(" + Math.max(0, 1 - G.clock / dayLength()).toFixed(3) + ")";
    setText(el.clovers, "clovers", String(saveData.clovers));
    const Q = G.quest;
    setText(el.quest, "quest", Q ? (Q.done ? "\u2713 " : "") + Q.q.text + (!Q.done && Q.q.need > 1 ? " (" + Q.prog + "/" + Q.q.need + ")" : "") : "");
    el.quest.classList.toggle("done", !!(Q && Q.done));

    const f = normalize([space.zUnitVec[0], space.zUnitVec[1], 0]), r = normalize([space.xUnitVec[0], space.xUnitVec[1], 0]);
    const wx = Math.cos(W.dir), wy = Math.sin(W.dir);
    el.windArrow.style.transform = "rotate(" + Math.atan2(wx * r[0] + wy * r[1], wx * f[0] + wy * f[1]).toFixed(3) + "rad)";
    const weather = RAIN.amt > 0.4 ? (SEASON.name === "Winter" ? "Snow, " : "Rain, ") : "";
    setText(el.windText, "wind", weather + (W.strength < 0.45 ? "calm" : W.strength < 0.85 ? "breezy" : W.strength < 1.2 ? "windy" : "gusty"));

    let status = "";
    const hunting = ["stalk", "dive", "wait", "swoop", "feint"].includes(HK.state);
    const chased = FX.on && FX.state === "chase";
    if (isHome()) status = "Safe in the burrow";
    else if (nearFire(C.x, C.y)) status = "Safe by the campfire";
    else if (isHidden()) status = "Hidden in the tall grass";
    else if (C.crouch > 0.5) status = "Too exposed here. Find taller grass";
    else if (chased) status = "The fox is chasing you. Hide or run home";
    else if (HK.state === "swoop") status = "Crouch or jump!";
    else if (hunting) status = "Hold Hide in tall grass, or run home";
    setText(el.status, "status", status);
    el.status.classList.toggle("alert", (hunting || chased) && !isSafe() && !nearFire(C.x, C.y));
    el.status.classList.toggle("on", status !== "");
}

function showOnly(screen) {
    for (const s of [el.title, el.dayEnd, el.over, el.pause]) {
        const on = s === screen;
        s.classList.toggle("hidden", !on);
        s.inert = !on;
    }
}

function setPaused(p) {
    if (G.state !== "play") return;
    G.paused = p;
    showOnly(p ? el.pause : null);
    if (p) sound.suspend(); else sound.resume();
}

function setMuted(m) {
    sound.setMuted(m);
    save("meadowhop-muted", m ? "1" : "0");
    el.mute.setAttribute("aria-pressed", String(m));
    el.mute.setAttribute("aria-label", m ? "Turn sound on" : "Mute sound");
}

function goFullscreen() {
    const root = document.documentElement;
    if (!TOUCH || document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen({ navigationUI: "hide" })
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {}))
        .catch(() => {});
}

function newGame() {
    sound.start();
    goFullscreen();
    G.lives = 3;
    G.total = 0;
    startDay(1);
}

$("startBtn").addEventListener("click", newGame);
$("againBtn").addEventListener("click", newGame);
$("nextDayBtn").addEventListener("click", () => startDay(G.day + 1));
$("resumeBtn").addEventListener("click", () => setPaused(false));
$("quitBtn").addEventListener("click", () => {
    G.paused = false; G.state = "title"; sound.resume(); FX.on = false; RAIN.on = false; refreshTitle();
    el.hud.classList.remove("on"); el.controls.classList.remove("on");
    showBest(); showOnly(el.title);
});
$("pauseBtn").addEventListener("click", () => setPaused(!G.paused));
el.mute.addEventListener("click", () => setMuted(!sound.muted));
holdButton($("jumpBtn"), () => { jumpQueued = true; }, () => {});
holdButton($("hideBtn"), () => { hideHeld = true; }, () => { hideHeld = false; });

document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (G.state === "play") setPaused(true); else sound.suspend(); }
    else if (!G.paused) sound.resume();
});

function showBest() {
    const b = $("bestLine");
    b.hidden = best.days <= 0 && best.carrots <= 0;
    b.textContent = "Best: " + best.days + (best.days === 1 ? " day" : " days") + ", " + best.carrots + " carrots";
}

// ================================================================== seasons, rain, home, Hazel's shop, fox, quests

G.scene = "meadow";
C.gold = 0;
const TAU2 = Math.PI * 2;
const GOLD = [1.0, 0.8, 0.22];
const wrapSpan = (v, span) => ((v % span) + span) % span - span / 2;

// ------------------------------------------------------------------ save data: clovers and what you own

const saveData = (() => {
    let s = null;
    try { s = JSON.parse(load("meadowhop-save", "null")); } catch { s = null; }
    return Object.assign({ clovers: 0, owned: [], burrow: 0, filter: "none", hud: "classic" }, s || {});
})();
// test mode: open meadow.html?infinite for endless clovers (nothing is saved to your real clover count)
const INFINITE = new URLSearchParams(location.search).has("infinite");
if (INFINITE) saveData.clovers = 9999;
if (saveData.burrow >= 1 && !saveData.owned.includes("cottage")) saveData.owned.push("cottage");
const persist = () => { if (INFINITE) saveData.clovers = 9999; save("meadowhop-save", JSON.stringify(Object.assign({}, saveData, INFINITE ? { clovers: realClovers } : {}))); };
const realClovers = (() => { try { return (JSON.parse(load("meadowhop-save", "null")) || {}).clovers || 0; } catch { return 0; } })();
const owns = (id) => saveData.owned.includes(id);
const carryCap = () => 3 + (owns("cottage") ? 1 : 0);
const dayLength = () => DAY_LEN + (owns("lanterns") ? 20 : 0);

// ------------------------------------------------------------------ places in the meadow

const SHOP = { x: -4, y: -25 };
SHOP.z = height(SHOP.x, SHOP.y);
SHOP.yaw = Math.atan2(-SHOP.y, -SHOP.x);
SHOP.door = [SHOP.x + Math.cos(SHOP.yaw) * 2.9, SHOP.y + Math.sin(SHOP.yaw) * 2.9];
const FIRE = (() => {
    const l = Math.hypot(POND.x, POND.y), ux = -POND.x / l, uy = -POND.y / l;
    for (let r = POND.r; r < POND.r + 15; r += 0.25) {
        const x = POND.x + ux * r, y = POND.y + uy * r;
        if (!isReeds(x, y) && !isWater(x, y)) {
            const fx = POND.x + ux * (r + 3), fy = POND.y + uy * (r + 3);
            return { x: fx, y: fy, z: height(fx, fy), face: Math.atan2(-uy, -ux) };
        }
    }
    return { x: -8, y: 4, z: height(-8, 4), face: 0 };
})();
const SCARE = { x: 1.5, y: -3 };
SCARE.z = height(SCARE.x, SCARE.y);
const LANTERN_SPOTS = [1, 2, 3, 4].map((i) => {
    const a = BURROW.yaw, d = 3.6 + i * 3.4, side = i % 2 ? 1.5 : -1.5;
    const x = BURROW.x + Math.cos(a) * d + Math.cos(a + 1.57) * side, y = BURROW.y + Math.sin(a) * d + Math.sin(a + 1.57) * side;
    return { x, y, z: height(x, y) };
});
function clearSpot(x, y) { return Math.hypot(x - SHOP.x, y - SHOP.y) < 3.4 || Math.hypot(x - FIRE.x, y - FIRE.y) < 3.3; }
const nearFire = (x, y, r = 7) => owns("campfire") && Math.hypot(x - FIRE.x, y - FIRE.y) < r;
function groundAt(x, y) { return G.scene !== "meadow" ? 0.05 : height(x, y); }

// ------------------------------------------------------------------ seasons: two days each

const seasonOf = (day) => SEASONS[Math.floor((day - 1) / 2) % 4];

// recolours every blade for the season (per-blade variety), then the ground
function applySeason(s) {
    SEASON = s;
    const B = blades;
    if (!B) return;
    if (!B.sr || B.sr.length !== B.n) { B.sr = new Float32Array(B.n); B.sg = new Float32Array(B.n); B.sb = new Float32Array(B.n); B.frost = new Float32Array(B.n); }
    const AUT = [[0.78, 0.52, 0.16], [0.82, 0.36, 0.12], [0.62, 0.56, 0.2], [0.7, 0.44, 0.18]];
    for (let i = 0; i < B.n; i++) {
        let r = B.r[i], g = B.g[i], b = B.b[i], frost = 0;
        const v = B.phase[i] / 6.2832;
        if (s.name === "Spring") { r *= 0.9; g *= 1.08; b *= 0.95; }
        else if (s.name === "Summer") { r = r * 1.05 + 0.03; g *= 0.98; b *= 0.85; }
        else if (s.name === "Autumn" && !B.reed[i]) { const a = AUT[(v * 4) | 0]; const t = 0.55 + 0.35 * v; r = lerp(r, a[0], t); g = lerp(g, a[1], t); b = lerp(b, a[2], t); }
        else if (s.name === "Winter") { r = lerp(r, 0.5, 0.5); g = lerp(g, 0.55, 0.5); b = lerp(b, 0.5, 0.5); frost = 0.45 + 0.35 * v; }
        B.sr[i] = r; B.sg[i] = g; B.sb[i] = b; B.frost[i] = frost;
    }
    if (G.scene === "meadow") writeGround();
}
function seasonGround(c, x, y, z) {
    if (SEASON.name === "Autumn") return mix3(c, [0.4, 0.3, 0.14], 0.45);
    if (SEASON.name === "Winter") return mix3(c, [0.86, 0.9, 0.96], z > WATER_LEVEL + 0.3 ? 0.78 : 0.3);
    if (SEASON.name === "Spring") return [c[0] * 0.92, c[1] * 1.08, c[2]];
    return c;
}

// ------------------------------------------------------------------ rain (snow in winter)

function planRain() { RAIN.on = false; RAIN.t = 0; RAIN.next = rnd() < SEASON.rain ? 20 + rnd() * 70 : Infinity; }

function updateRain(dt) {
    if (G.state === "play") {
        if (!RAIN.on) {
            RAIN.next -= dt;
            if (RAIN.next <= 0) {
                RAIN.on = true; RAIN.t = 0; RAIN.dur = 20 + rnd() * 18; RAIN.next = Infinity;
                banner(SEASON.name === "Winter" ? "Snowstorm! The hawk takes shelter" : "Rain! The hawk takes shelter, and wet soil digs faster", 2.8);
            }
        } else {
            RAIN.t += dt;
            if (RAIN.t > RAIN.dur) { RAIN.on = false; RAIN.next = rnd() < 0.35 ? 40 + rnd() * 40 : Infinity; banner("The weather clears", 1.8); }
        }
    } else RAIN.on = false;
    RAIN.amt += ((RAIN.on ? 1 : 0) - RAIN.amt) * Math.min(1, dt * 0.5);
    if (RAIN.amt < 0.01) return;
    const snow = SEASON.name === "Winter";
    for (const d of RAIN.drops) {
        d.z -= d.sp * (snow ? 0.12 : 1) * dt;
        if (d.z < -1) { d.z += 24; d.ox = rnd() * 40; d.oy = rnd() * 40; }
    }
}

// camera-facing diamond
function billboard(o, x, y, z, s, c) {
    const X = space.xUnitVec, Y = space.yUnitVec;
    const P = [[x + Y[0] * s, y + Y[1] * s, z + Y[2] * s], [x + X[0] * s, y + X[1] * s, z + X[2] * s],
        [x - Y[0] * s, y - Y[1] * s, z - Y[2] * s], [x - X[0] * s, y - X[1] * s, z - X[2] * s]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
        pos[o] = P[k][0]; pos[o + 1] = P[k][1]; pos[o + 2] = P[k][2]; pos[o + 3] = 1;
        col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; col[o + 3] = 1;
        o += 4;
    }
    return o;
}

function writeRain(o) {
    const n = Math.min(RAIN_MAX, Math.round(RAIN_MAX * RAIN.amt));
    if (!n) return o;
    const snow = SEASON.name === "Winter";
    const X = space.xUnitVec, wx = Math.cos(W.dir) * W.strength, wy = Math.sin(W.dir) * W.strength;
    for (let i = 0; i < n; i++) {
        const d = RAIN.drops[i];
        const x = space.X0 + wrapSpan(d.ox - wx * d.z * 0.4 - space.X0, 40), y = space.Y0 + wrapSpan(d.oy - wy * d.z * 0.4 - space.Y0, 40);
        const z = space.Z0 - 5 + d.z;
        if (snow) { o = billboard(o, x, y, z, 0.08, [0.95, 0.97, 1]); continue; }
        // a thin streak, tilted by the wind
        const w = 0.022, tx = x - wx * 0.3, ty = y - wy * 0.3, tz = z + 0.9;
        const P = [[x - X[0] * w, y - X[1] * w, z - X[2] * w], [x + X[0] * w, y + X[1] * w, z + X[2] * w],
            [tx + X[0] * w, ty + X[1] * w, tz + X[2] * w], [tx - X[0] * w, ty - X[1] * w, tz - X[2] * w]];
        for (const k of [0, 1, 2, 0, 2, 3]) {
            pos[o] = P[k][0]; pos[o + 1] = P[k][1]; pos[o + 2] = P[k][2]; pos[o + 3] = 1;
            const b = k < 2 ? 0.86 : 0.72;
            col[o] = b * 0.9; col[o + 1] = b * 0.94; col[o + 2] = b; col[o + 3] = 1;
            o += 4;
        }
    }
    return o;
}

// ------------------------------------------------------------------ drifting season particles: petals, pollen, leaves, snow

const AMBIENT_MAX = 70;
const ambient = Array.from({ length: AMBIENT_MAX }, () => ({ ox: rnd() * 44, oy: rnd() * 44, z: rnd() * 12, ph: rnd() * 6.28, s: 0.06 + rnd() * 0.07 }));
const AMBIENT_COL = {
    petal: [[1, 0.75, 0.85], [1, 0.95, 0.97]], pollen: [[1, 0.95, 0.6]],
    leaf: [[0.9, 0.45, 0.12], [0.8, 0.25, 0.1], [0.95, 0.7, 0.2]], snow: [[0.95, 0.97, 1]],
};
function updateAmbient(dt) {
    const k = SEASON.ambient, fall = k === "snow" ? 1.1 : k === "leaf" ? 0.9 : k === "petal" ? 0.6 : 0.12;
    for (const a of ambient) {
        a.z -= fall * dt;
        a.ph += dt;
        a.ox += Math.cos(W.dir) * W.strength * 1.6 * dt;
        a.oy += Math.sin(W.dir) * W.strength * 1.6 * dt;
        if (a.z < -0.5) { a.z += 12; a.ox = rnd() * 44; a.oy = rnd() * 44; }
    }
}
function writeAmbient(o) {
    const k = SEASON.ambient, pal = AMBIENT_COL[k];
    for (let i = 0; i < ambient.length; i++) {
        const a = ambient[i];
        const x = space.X0 + wrapSpan(a.ox - space.X0, 44) + Math.sin(a.ph * 1.3) * 0.6;
        const y = space.Y0 + wrapSpan(a.oy - space.Y0, 44) + Math.cos(a.ph * 1.1) * 0.6;
        o = billboard(o, x, y, space.Z0 - 3 + a.z, a.s * (k === "leaf" ? 1.5 : 1), pal[i % pal.length]);
    }
    return o;
}

// ------------------------------------------------------------------ four-leaf clovers and the golden carrot

const CLOVER_MAX = 6;
const clovers = [];
function cloverParts(k) {
    const P = [{ c: [0, 0, 0.2], R: I3, r: [0.02, 0.02, 0.2], col: [0.3, 0.55, 0.2], mesh: SPHERE_TINY }];
    for (let j = 0; j < 4; j++) {
        const a = j * Math.PI / 2 + k.yaw;
        P.push({ c: [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.4], R: rotZ(a), r: [0.15, 0.1, 0.02], col: [0.25, 0.7, 0.25], mesh: SPHERE_TINY });
    }
    return P;
}
const CLOVER_CORNERS = 5 * SPHERE_TINY.idx.length;
function spawnClover() {
    for (let t = 0; t < 200 && clovers.length < CLOVER_MAX; t++) {
        const x = (rnd() * 2 - 1) * 31, y = (rnd() * 2 - 1) * 31;
        if (isReeds(x, y) || isWater(x, y) || Math.hypot(x - BURROW.x, y - BURROW.y) < 5 || Math.hypot(x - SHOP.x, y - SHOP.y) < 5) continue;
        clovers.push({ x, y, z: height(x, y), yaw: rnd() * 6.28 });
        return;
    }
}
function writeClovers(o) {
    for (const k of clovers) o = writeEllipsoids(o, cloverParts(k), I3, [1, 1, 1], [k.x, k.y, k.z]);
    return o;
}
function spawnGold() {
    for (let t = 0; t < 300; t++) {
        const x = (rnd() * 2 - 1) * 31, y = (rnd() * 2 - 1) * 31;
        if (isReeds(x, y) || isWater(x, y) || lush(x, y) > 0.5) continue;               // out in the open: risky
        if (Math.hypot(x - BURROW.x, y - BURROW.y) < 20 || Math.hypot(x - SHOP.x, y - SHOP.y) < 5) continue;
        carrots.push({ x, y, z: height(x, y) - 0.02, yaw: rnd() * 6.28, phase: rnd() * 6.28, dug: 0, gust: 0, gold: true });
        return;
    }
}

// ------------------------------------------------------------------ the fox: hunts on the ground at dusk

const FX = { on: false, spawned: false, x: 0, y: 0, yaw: 0, speed: 0, phase: 0, state: "prowl", t: 0, lost: 0, lastX: 0, lastY: 0 };

function foxParts(time) {
    const P = [];
    const add = (c, r, col, R = I3) => P.push({ c, R, r, col, mesh: SPHERE_LO });
    const OR = [0.88, 0.42, 0.12], WH = [0.96, 0.92, 0.85], BK = [0.14, 0.1, 0.08];
    const ph = FX.phase, run = Math.min(1, FX.speed / 6), bob = Math.abs(Math.sin(ph)) * 0.12 * run;
    add([0, 0, 0.95 + bob], [0.95, 0.36, 0.4], OR);
    add([0.5, 0, 0.8 + bob], [0.45, 0.28, 0.32], WH);
    add([1.0, 0, 1.28 + bob], [0.36, 0.3, 0.3], OR);
    add([1.35, 0, 1.18 + bob], [0.3, 0.13, 0.13], WH, rotY(0.15));
    add([1.64, 0, 1.2 + bob], [0.06, 0.06, 0.06], BK);
    for (const s of [1, -1]) {
        add([0.95, s * 0.17, 1.62 + bob], [0.08, 0.12, 0.24], OR, rotX(-s * 0.25));
        add([1.2, s * 0.14, 1.38 + bob], [0.05, 0.05, 0.05], BK);
        for (const fb of [1, -1]) {
            const sw = Math.sin(ph + (s * fb > 0 ? 0 : Math.PI)) * 0.5 * run;
            add([fb * 0.55 + Math.sin(sw) * 0.25, s * 0.2, 0.42], [0.09, 0.09, 0.42], BK, rotY(sw));
        }
    }
    const tw = Math.sin(time * 3) * 0.2;
    add([-1.15, 0, 1.05 + bob], [0.75, 0.26, 0.26], OR, mul(rotZ(tw), rotY(-0.45)));
    add([-1.75, -tw * 0.6, 1.35 + bob], [0.26, 0.2, 0.2], WH);
    return P;
}
const FOX_CORNERS = cornersOf(foxParts(0));

const foxSees = () => Math.hypot(C.x - FX.x, C.y - FX.y) < 12 && !isHidden() && !isHome() && !nearFire(C.x, C.y);

function spawnFox() {
    FX.spawned = true;
    for (let t = 0; t < 40; t++) {
        const a = Math.atan2(C.y, C.x) + Math.PI + (rnd() - 0.5) * 1.4;
        const x = Math.cos(a) * 33, y = Math.sin(a) * 33;
        if (isWater(x, y)) continue;
        Object.assign(FX, { on: true, x, y, yaw: a + Math.PI, speed: 0, state: "prowl", t: 0, lost: 0, lastX: C.x, lastY: C.y });
        banner("A fox is prowling at dusk. It can smell you", 2.8);
        sound.on("growl");
        return;
    }
}

function updateFox(dt) {
    if (G.state !== "play") { FX.on = false; return; }
    if (!FX.on && !FX.spawned && G.day >= 2 && G.clock > dayLength() * 0.62) spawnFox();
    if (!FX.on) return;
    FX.t += dt;
    let tx = FX.lastX, ty = FX.lastY, spd = 3.2;
    const dist = Math.hypot(C.x - FX.x, C.y - FX.y);
    if (FX.state === "prowl") {
        if (Math.hypot(FX.x - tx, FX.y - ty) < 2) { FX.lastX = C.x + (rnd() - 0.5) * 14; FX.lastY = C.y + (rnd() - 0.5) * 14; }   // follows your scent, roughly
        if (foxSees()) { FX.state = "chase"; sound.on("growl"); banner("The fox has seen you! Hide or run home", 2); }
    } else if (FX.state === "chase") {
        tx = C.x; ty = C.y; spd = Math.min(8.4, 7.4 + G.day * 0.1);
        if (foxSees()) { FX.lost = 0; FX.lastX = C.x; FX.lastY = C.y; }
        else if ((FX.lost += dt) > 1.4) { FX.state = "sniff"; FX.t = 0; banner("You slipped away. Stay low", 1.6); }
        if (dist < 1.2 && C.z < 0.8) { caught("fox"); FX.state = "leave"; FX.yaw += Math.PI; }
    } else if (FX.state === "sniff") {
        tx = FX.lastX + Math.cos(FX.t * 1.5) * 2.5; ty = FX.lastY + Math.sin(FX.t * 1.5) * 2.5; spd = 2.2;
        if (foxSees() && dist < 7) FX.state = "chase";
        else if (FX.t > 5) { FX.state = "prowl"; FX.lastX = C.x + (rnd() - 0.5) * 16; FX.lastY = C.y + (rnd() - 0.5) * 16; }
    } else {
        tx = FX.x + Math.cos(FX.yaw) * 10; ty = FX.y + Math.sin(FX.yaw) * 10; spd = 6;
        if (Math.abs(FX.x) > FIELD + 3 || Math.abs(FX.y) > FIELD + 3) { FX.on = false; return; }
    }
    // foxes keep away from the campfire
    if (nearFire(FX.x, FX.y, 7.5)) {
        tx = FX.x + (FX.x - FIRE.x) * 3; ty = FX.y + (FX.y - FIRE.y) * 3;
        if (FX.state === "chase") { FX.state = "sniff"; FX.t = 0; }
    }
    const want = Math.atan2(ty - FX.y, tx - FX.x);
    FX.yaw += wrapAngle(want - FX.yaw) * Math.min(1, dt * 5);
    FX.speed += (spd - FX.speed) * Math.min(1, dt * 3);
    const nx = FX.x + Math.cos(FX.yaw) * FX.speed * dt, ny = FX.y + Math.sin(FX.yaw) * FX.speed * dt;
    if (isWater(nx, ny)) FX.yaw += dt * 3;
    else if (FX.state !== "leave") { FX.x = clamp(nx, -FIELD - 2, FIELD + 2); FX.y = clamp(ny, -FIELD - 2, FIELD + 2); }
    else { FX.x = nx; FX.y = ny; }
    FX.phase += dt * FX.speed * 2.2;
}
function writeFox(o, time) {
    if (!FX.on) return o;
    return writeEllipsoids(o, foxParts(time), rotZ(FX.yaw), [1, 1, 1], [FX.x, FX.y, height(FX.x, FX.y) - 0.05]);
}

// ------------------------------------------------------------------ home: the burrow at each level, plus things bought for it

const STONE = [0.6, 0.58, 0.55], WOOD = [0.52, 0.33, 0.17];

function burrowPartsL(level, dusk) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO, glow = false) => P.push({ c, R, r, col, mesh, glow });
    add([0, 0, 0], [2.3, 2.1, 1.0], [0.46, 0.33, 0.2], I3, SPHERE_HI);
    add([-0.4, 0.3, 0.85], [1.1, 1.0, 0.25], SEASON.name === "Winter" ? [0.9, 0.93, 0.97] : [0.34, 0.5, 0.2]);   // moss, or snow
    [[1.9, 0.95, 0.2], [2.05, -0.9, 0.18], [1.35, 1.45, 0.24], [1.45, -1.4, 0.16], [0.4, -1.9, 0.2]].forEach(([x, y, s]) =>
        add([x, y, 0.08], [s * 1.3, s, s * 0.8], STONE, rotZ(x * 3), SPHERE_TINY));
    if (level < 1) add([1.75, 0, 0.35], [0.28, 0.72, 0.58], [0.07, 0.05, 0.04], rotY(-0.35));
    else {
        add([1.86, 0, 0.52], [0.12, 0.66, 0.62], [0.32, 0.5, 0.3], rotY(-0.3));          // round green door
        add([2.02, 0.32, 0.5], [0.06, 0.06, 0.06], [0.95, 0.8, 0.3]);
        add([2.55, 0, 0.06], [0.55, 0.75, 0.07], STONE, I3, SPHERE_TINY);
    }
    if (level >= 2) {
        add([1.2, 1.45, 0.68], [0.3, 0.12, 0.3], [0.3, 0.2, 0.1], rotZ(0.9));
        add([1.26, 1.52, 0.68], [0.24, 0.1, 0.24], mix3([0.95, 0.78, 0.42], [1, 0.92, 0.62], dusk), rotZ(0.9), SPHERE_LO, true);
        add([-0.9, -0.7, 1.05], [0.28, 0.28, 0.35], STONE);
        add([-0.9, -0.7, 1.45], [0.24, 0.24, 0.3], [0.52, 0.5, 0.48]);
        add([-0.9, -0.7, 1.8], [0.2, 0.2, 0.18], [0.3, 0.28, 0.27]);
    }
    if (level >= 3) {
        const posts = [];
        for (let i = 0; i < 10; i++) { const a = 1.3 + i * 0.4; posts.push([Math.cos(a) * 2.95, Math.sin(a) * 2.95]); }
        posts.forEach((p) => add([p[0], p[1], 0.55], [0.08, 0.08, 0.55], WOOD, I3, SPHERE_TINY));
        for (let i = 0; i + 1 < posts.length; i++) {
            const a = posts[i], b = posts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
            add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.75], [len, 0.04, 0.04], WOOD, rotZ(Math.atan2(b[1] - a[1], b[0] - a[0])), SPHERE_TINY);
        }
        add([-3.9, 0, 0.02], [0.9, 1.5, 0.06], [0.3, 0.2, 0.12], I3, SPHERE_TINY);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) add([-4.3 + r * 0.45, -1.05 + c * 0.7, 0.2], [0.12, 0.12, 0.2], [0.3, 0.62, 0.22], rotZ(r + c), SPHERE_TINY);
        add([2.9, -1.6, 0.6], [0.05, 0.05, 0.6], WOOD, I3, SPHERE_TINY);
        add([2.9, -1.6, 1.25], [0.22, 0.14, 0.14], [0.8, 0.2, 0.18]);
    }
    return P;
}

const FLOWERBED = (() => {
    const P = [], cols = [[1, 0.55, 0.75], [1, 0.86, 0.2], [0.72, 0.5, 1], [1, 1, 0.95], [1, 0.42, 0.3]];
    let n = 0;
    for (const y of [-2.7, -2.3, -1.9, -1.5, -1.1, 1.1, 1.5, 1.9, 2.3, 2.7]) {
        const x = 3.45;
        P.push({ c: [x, y, 0.72], R: I3, r: [0.03, 0.03, 0.35], col: [0.3, 0.55, 0.2], mesh: SPHERE_TINY });
        P.push({ c: [x, y, 1.1], R: I3, r: [0.17, 0.17, 0.1], col: cols[n++ % cols.length], mesh: SPHERE_LO });
    }
    return P;
})();

function campfireParts(time) {
    const P = [];
    for (let i = 0; i < 8; i++) { const a = i * 0.785; P.push({ c: [Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0.08], R: rotZ(a), r: [0.16, 0.13, 0.1], col: STONE, mesh: SPHERE_TINY }); }
    for (let k = 0; k < 3; k++) P.push({ c: [0, 0, 0.18], R: mul(rotZ(k * 2.1), rotY(-0.25)), r: [0.5, 0.08, 0.08], col: [0.42, 0.26, 0.13], mesh: SPHERE_LO });
    const f = 0.85 + 0.15 * Math.sin(time * 13) + 0.1 * Math.sin(time * 21 + 1);
    P.push({ c: [0, 0, 0.45 * f], R: I3, r: [0.28, 0.28, 0.45 * f], col: [1, 0.5, 0.1], mesh: SPHERE_LO, glow: true });
    P.push({ c: [0.05, 0, 0.55 * f], R: I3, r: [0.18, 0.18, 0.35 * f], col: [1, 0.78, 0.25], mesh: SPHERE_LO, glow: true });
    P.push({ c: [0, 0.03, 0.66 * f], R: I3, r: [0.09, 0.09, 0.2 * f], col: [1, 0.95, 0.7], mesh: SPHERE_TINY, glow: true });
    return P;
}
function lanternParts(lit) {
    return [
        { c: [0, 0, 0.9], R: I3, r: [0.06, 0.06, 0.9], col: WOOD, mesh: SPHERE_TINY },
        { c: [0, 0, 1.95], R: I3, r: [0.16, 0.16, 0.22], col: mix3([0.55, 0.5, 0.4], [1, 0.86, 0.46], lit), mesh: SPHERE_LO, glow: true },
        { c: [0, 0, 2.2], R: I3, r: [0.2, 0.2, 0.06], col: [0.2, 0.15, 0.1], mesh: SPHERE_TINY },
    ];
}
function scarecrowParts(time) {
    const sway = Math.sin(time * 2.2) * 0.06 * W.strength;
    const SHIRT = [0.72, 0.22, 0.18], STRAW = [0.9, 0.78, 0.42], HAT = [0.3, 0.22, 0.15];
    return [
        { c: [0, 0, 1.1], R: I3, r: [0.06, 0.06, 1.1], col: WOOD, mesh: SPHERE_TINY },
        { c: [0, 0, 1.62], R: I3, r: [0.05, 0.9, 0.05], col: WOOD, mesh: SPHERE_TINY },
        { c: [0, 0, 1.45], R: rotX(sway), r: [0.3, 0.42, 0.42], col: SHIRT, mesh: SPHERE_LO },
        { c: [0, 0.62, 1.58 + sway], R: I3, r: [0.14, 0.3, 0.14], col: SHIRT, mesh: SPHERE_LO },
        { c: [0, -0.62, 1.58 - sway], R: I3, r: [0.14, 0.3, 0.14], col: SHIRT, mesh: SPHERE_LO },
        { c: [0, 0, 2.15], R: I3, r: [0.26, 0.26, 0.28], col: STRAW, mesh: SPHERE_LO },
        { c: [0, 0, 2.38], R: I3, r: [0.42, 0.42, 0.04], col: HAT, mesh: SPHERE_LO },
        { c: [0, 0, 2.52], R: I3, r: [0.22, 0.22, 0.16], col: HAT, mesh: SPHERE_LO },
    ];
}
// Hazel's stump in the meadow: the way into the shop
function stumpParts(dusk) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO, glow = false) => P.push({ c, R, r, col, mesh, glow });
    add([0, 0, 1.0], [2.2, 2.2, 1.6], [0.42, 0.29, 0.18], I3, SPHERE_HI);
    add([0, 0, 2.45], [1.95, 1.95, 0.14], [0.78, 0.62, 0.4]);
    add([0, 0, 2.52], [1.1, 1.1, 0.1], [0.64, 0.48, 0.3]);
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.6; add([Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0.2], [0.8, 0.3, 0.25], [0.38, 0.26, 0.16], rotZ(a)); }
    add([2.12, 0, 0.85], [0.12, 0.6, 0.85], [0.36, 0.55, 0.35], rotY(-0.12));
    add([2.25, 0.3, 0.8], [0.06, 0.06, 0.06], [0.95, 0.8, 0.3]);
    add([1.45, 1.45, 1.6], [0.2, 0.08, 0.2], mix3([0.95, 0.8, 0.45], [1, 0.92, 0.62], dusk), rotZ(0.78), SPHERE_LO, true);
    add([2.9, 1.3, 0.6], [0.05, 0.05, 0.6], WOOD, I3, SPHERE_TINY);
    add([2.9, 1.3, 1.25], [0.06, 0.5, 0.28], [0.92, 0.86, 0.72]);
    add([2.97, 1.3, 1.25], [0.03, 0.14, 0.14], [0.3, 0.72, 0.3], I3, SPHERE_TINY, true);
    add([2.3, -0.9, 1.3], [0.14, 0.14, 0.18], [1, 0.86, 0.46], I3, SPHERE_LO, true);
    [[-1.6, 2.0], [0.8, -2.3], [-2.2, -1.2]].forEach(([x, y]) => {
        add([x, y, 0.25], [0.05, 0.05, 0.25], [0.95, 0.92, 0.85], I3, SPHERE_TINY);
        add([x, y, 0.5], [0.22, 0.22, 0.12], [0.85, 0.2, 0.15]);
    });
    return P;
}

// ------------------------------------------------------------------ box and gable-roof meshes (flat faces, real normals)

function makeBox() {
    const v = [], n = [], idx = [];
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const f of faces) {
        const a = f[0] ? [0, 1, 0] : [1, 0, 0];
        const b = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]];
        const base = v.length / 3;
        for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            v.push(f[0] + a[0] * s + b[0] * t, f[1] + a[1] * s + b[1] * t, f[2] + a[2] * s + b[2] * t);
            n.push(f[0], f[1], f[2]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { v: Float32Array.from(v), n: Float32Array.from(n), idx: Uint16Array.from(idx) };
}
// gable roof: eaves at z=-1 along x=+-1, ridge at x=0 z=+1, running along y
function makeWedge() {
    const v = [], n = [], idx = [];
    const face = (pts, nor) => {
        const base = v.length / 3;
        for (const p of pts) { v.push(...p); n.push(...nor); }
        for (let i = 1; i + 1 < pts.length; i++) idx.push(base, base + i, base + i + 1);
    };
    face([[1, -1, -1], [1, 1, -1], [0, 1, 1], [0, -1, 1]], [2, 0, 1]);
    face([[-1, -1, -1], [-1, 1, -1], [0, 1, 1], [0, -1, 1]], [-2, 0, 1]);
    face([[1, 1, -1], [-1, 1, -1], [0, 1, 1]], [0, 1, 0]);
    face([[1, -1, -1], [-1, -1, -1], [0, -1, 1]], [0, -1, 0]);
    face([[1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1]], [0, 0, -1]);
    return { v: Float32Array.from(v), n: Float32Array.from(n), idx: Uint16Array.from(idx) };
}
const BOX = makeBox(), WEDGE = makeWedge();

// ------------------------------------------------------------------ the cottage (the burrow, bought as a house)

const HOME_DOOR = [BURROW.x + Math.cos(BURROW.yaw) * 3.7, BURROW.y + Math.sin(BURROW.yaw) * 3.7];
function inHouseFoot(x, y) {
    const dx = x - BURROW.x, dy = y - BURROW.y, c = Math.cos(BURROW.yaw), s = Math.sin(BURROW.yaw);
    return Math.abs(dx * c + dy * s) < 3.3 && Math.abs(-dx * s + dy * c) < 2.9;
}
const FLOWER_BOX_COLS = [[1, 0.55, 0.72], [1, 0.86, 0.3], [0.75, 0.55, 1], [1, 0.45, 0.35]];

function cottageParts(dusk) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = BOX, glow = false) => P.push({ c, R, r, col, mesh, glow });
    const winter = SEASON.name === "Winter";
    const PLASTER = [0.96, 0.91, 0.81], BEAM = [0.42, 0.27, 0.16], STONEC = [0.63, 0.6, 0.56], DOORC = [0.3, 0.5, 0.36];
    const ROOF = winter ? [0.9, 0.92, 0.96] : [0.74, 0.35, 0.26], TILE = winter ? [0.8, 0.83, 0.88] : [0.6, 0.27, 0.2];
    const lit = mix3([0.95, 0.78, 0.45], [1, 0.9, 0.6], dusk);
    add([0, 0, 0.05], [3.0, 2.6, 0.55], STONEC);                                   // stone footing
    add([0, 0, 2.2], [2.8, 2.4, 1.6], PLASTER);                                     // walls
    add([0, 0, 4.9], [2.8, 2.4, 1.1], PLASTER, I3, WEDGE);                          // gable ends
    add([0, 0, 4.95], [3.35, 2.9, 1.2], ROOF, I3, WEDGE);                           // roof
    for (const s of [1, -1]) for (const f of [0.28, 0.55, 0.8]) {                   // rows of tiles
        add([s * 3.35 * (1 - f), 0, 3.78 + 2.4 * f], [0.05, 2.93, 0.035], TILE, rotY(s * 0.95));
    }
    add([0, 0, 6.13], [0.18, 3.0, 0.14], TILE);                                    // ridge cap
    for (const sx of [1, -1]) for (const sy of [1, -1]) add([sx * 2.8, sy * 2.4, 2.2], [0.13, 0.13, 1.62], BEAM);
    for (const sx of [1, -1]) add([sx * 2.83, 0, 3.72], [0.08, 2.45, 0.1], BEAM);
    for (const sy of [1, -1]) add([0, sy * 2.43, 3.72], [2.85, 0.08, 0.1], BEAM);
    for (const sx of [1, -1]) add([sx * 1.35, 2.45, 2.2], [1.1, 0.06, 0.07], BEAM, rotY(sx * 0.95));   // braces on the side
    // door with a rounded top, stone step
    add([2.84, 0, 2.48], [0.06, 0.8, 0.72], BEAM, I3, SPHERE_LO);
    for (const s of [1, -1]) add([2.85, s * 0.72, 1.55], [0.07, 0.1, 0.95], BEAM);
    add([2.87, 0, 1.55], [0.08, 0.62, 0.95], DOORC);
    add([2.87, 0, 2.48], [0.08, 0.62, 0.56], DOORC, I3, SPHERE_LO);
    add([3.0, 0.36, 1.6], [0.07, 0.07, 0.07], [0.95, 0.8, 0.32], I3, SPHERE_LO);
    add([3.3, 0, 0.25], [0.4, 0.95, 0.15], STONEC);
    // front windows with flower boxes
    for (const s of [1, -1]) {
        const y = s * 1.78;
        add([2.84, y, 2.35], [0.06, 0.6, 0.62], BEAM);
        add([2.87, y, 2.35], [0.05, 0.48, 0.5], lit, I3, BOX, true);
        add([2.91, y, 2.35], [0.04, 0.045, 0.5], BEAM);
        add([2.91, y, 2.35], [0.04, 0.48, 0.045], BEAM);
        add([3.05, y, 1.62], [0.2, 0.62, 0.14], [0.52, 0.33, 0.18]);
        add([3.1, y, 1.78], [0.16, 0.56, 0.07], [0.3, 0.55, 0.25], I3, SPHERE_LO);
        for (let k = 0; k < 4; k++) add([3.13, y + (k - 1.5) * 0.3, 1.88], [0.12, 0.12, 0.1], FLOWER_BOX_COLS[k], I3, SPHERE_LO);
    }
    // round side window, chimney, lantern, path, pot plant
    add([0.6, 2.42, 2.5], [0.62, 0.05, 0.62], BEAM, I3, SPHERE_LO);
    add([0.6, 2.45, 2.5], [0.5, 0.06, 0.5], lit, I3, SPHERE_LO, true);
    add([-1.4, 1.3, 5.4], [0.42, 0.42, 1.25], STONEC);
    add([-1.4, 1.3, 6.7], [0.52, 0.52, 0.1], [0.45, 0.43, 0.4]);
    add([2.93, -1.0, 3.25], [0.12, 0.04, 0.03], BEAM);
    add([3.02, -1.0, 3.0], [0.15, 0.15, 0.2], [1, 0.86, 0.46], I3, SPHERE_LO, true);
    for (let i = 0; i < 5; i++) add([3.95 + i * 1.05, i % 2 ? 0.25 : -0.2, 0.28], [0.42, 0.34, 0.06], STONEC, rotZ(i), SPHERE_LO);
    add([3.25, 1.05, 0.55], [0.24, 0.24, 0.28], [0.72, 0.4, 0.25], I3, SPHERE_LO);
    add([3.25, 1.05, 1.0], [0.34, 0.34, 0.4], [0.3, 0.56, 0.26], I3, SPHERE_LO);
    return P;
}

// ------------------------------------------------------------------ the lakeside campfire

function lakeFireParts(time) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO, glow = false) => P.push({ c, R, r, col, mesh, glow });
    const LOG = [0.42, 0.27, 0.15], BARK = [0.34, 0.23, 0.14], END = [0.8, 0.64, 0.44];
    for (let i = 0; i < 11; i++) {
        const a = (i * TAU2) / 11, s = 0.15 + 0.05 * ((i * 7) % 3);
        add([Math.cos(a) * 0.98, Math.sin(a) * 0.98, 0.08], [s * 1.3, s, s * 0.85], mix3([0.52, 0.5, 0.47], [0.72, 0.7, 0.66], (i % 3) / 2), rotZ(a), SPHERE_TINY);
    }
    add([0, 0, 0.06], [0.72, 0.72, 0.06], [1, 0.42, 0.12], I3, SPHERE_LO, true);           // ember bed
    for (let k = 0; k < 5; k++) { const b = k * 1.2566; add([Math.cos(b) * 0.2, Math.sin(b) * 0.2, 0.48], [0.08, 0.08, 0.56], LOG, mul(rotZ(b), rotY(-0.5))); }
    const f = 0.85 + 0.15 * Math.sin(time * 13) + 0.1 * Math.sin(time * 21 + 1), g = 0.9 + 0.1 * Math.sin(time * 17 + 2);
    add([0, 0, 0.62 * f], [0.38, 0.38, 0.62 * f], [1, 0.42, 0.08], I3, SPHERE_LO, true);
    add([0.04, 0.02, 0.72 * f], [0.26, 0.26, 0.5 * f], [1, 0.68, 0.18], I3, SPHERE_LO, true);
    add([0, 0.03, 0.72 * g], [0.13, 0.13, 0.32 * g], [1, 0.95, 0.7], I3, SPHERE_TINY, true);
    for (let k = 0; k < 3; k++) {
        const a = time * 2 + k * 2.1, h = 0.95 + 0.35 * Math.sin(time * 9 + k * 2);
        add([Math.cos(a) * 0.16, Math.sin(a) * 0.16, h], [0.07, 0.07, 0.18], [1, 0.78, 0.3], I3, SPHERE_TINY, true);
    }
    for (const s of [1, -1]) {                                                            // log benches
        add([0.2, s * 2.3, 0.32], [1.15, 0.3, 0.3], BARK);
        add([1.35, s * 2.3, 0.32], [0.04, 0.28, 0.28], END, I3, SPHERE_TINY);
        add([-0.95, s * 2.3, 0.32], [0.04, 0.28, 0.28], END, I3, SPHERE_TINY);
    }
    add([-2.2, 0, 0.3], [0.45, 0.45, 0.32], BARK);                                        // stump seat with a kettle and a mug
    add([-2.2, 0, 0.63], [0.42, 0.42, 0.03], END);
    add([-2.2, 0.1, 0.85], [0.2, 0.2, 0.18], [0.25, 0.27, 0.3]);
    add([-2.0, 0.1, 0.9], [0.12, 0.04, 0.04], [0.25, 0.27, 0.3], rotY(-0.6), SPHERE_TINY);
    add([-2.35, -0.2, 0.75], [0.08, 0.08, 0.1], [0.85, 0.3, 0.25], I3, SPHERE_TINY);
    for (const [x, z] of [[-1.35, 0.16], [-1.0, 0.16], [-1.18, 0.44]]) add([x, -1.75, z], [0.16, 0.55, 0.16], LOG);
    add([0.9, -1.9, 0.8], [0.05, 0.05, 0.8], [0.35, 0.24, 0.14], I3, SPHERE_TINY);         // lantern post
    add([0.9, -1.9, 1.7], [0.14, 0.14, 0.18], [1, 0.86, 0.46], I3, SPHERE_LO, true);
    add([0.9, -1.9, 1.92], [0.17, 0.17, 0.05], [0.2, 0.15, 0.1], I3, SPHERE_TINY);
    return P;
}

// drawn only when the bunny is near the lake and the fire is in front of the camera
function lakeFireVisible() {
    if (!owns("campfire") || G.scene !== "meadow") return false;
    if (Math.hypot(C.x - FIRE.x, C.y - FIRE.y) > 26) return false;
    const cb = Math.cos(space.beta);
    const ex = space.X0 + cb * Math.cos(space.alpha) * space.Rc, ey = space.Y0 + cb * Math.sin(space.alpha) * space.Rc, ez = space.Z0 + Math.sin(space.beta) * space.Rc;
    const vx = space.X0 - ex, vy = space.Y0 - ey, vz = space.Z0 - ez, fx = FIRE.x - ex, fy = FIRE.y - ey, fz = FIRE.z + 0.6 - ez;
    return (vx * fx + vy * fy + vz * fz) / (Math.hypot(vx, vy, vz) * Math.hypot(fx, fy, fz) || 1) > 0.45;
}

// ------------------------------------------------------------------ inside the cottage

const HOUSE_IN = { from: "title", saved: null, t: 0, leaving: false, busy: false,
    motes: Array.from({ length: 18 }, () => ({ x: 0.4 + rnd() * 2.2, y: 2.5 + rnd() * 2.5, z: 1 + rnd() * 3.5, ph: rnd() * 6.28 })) };
let HOUSE_STATIC_V = 0;

function buildHouseStatic() {
    const P = [];
    const add = (c, r, col, R = I3, mesh = BOX, glow = false) => P.push({ c, R, r, col, mesh, glow });
    const WOODS = [[0.6, 0.41, 0.24], [0.55, 0.37, 0.21], [0.65, 0.45, 0.27], [0.58, 0.39, 0.23]];
    const PL = [0.94, 0.88, 0.77], WAIN = [0.52, 0.34, 0.2], TRIM = [0.38, 0.25, 0.15], STONEH = [0.63, 0.6, 0.56];
    // plank floor
    add([0, 0.25, -0.06], [7.05, 5.3, 0.03], [0.26, 0.17, 0.1]);
    for (let row = 0; row < 15; row++) {
        const yc = -4.65 + row * 0.7;
        let x = -7 - (row % 3) * 1.1, k = 0;
        while (x < 7) {
            const len = 2.2 + ((row * 7 + k * 3) % 5) * 0.45, a = Math.max(-7, x), b = Math.min(7, x + len);
            if (b - a > 0.2) add([(a + b) / 2, yc, 0], [(b - a) / 2 - 0.03, 0.33, 0.03], WOODS[(row * 3 + k) % 4]);
            x += len; k++;
        }
    }
    add([0, -5.08, -0.2], [7.1, 0.08, 0.2], TRIM);
    // walls: plaster above wood panelling
    add([0, 5.65, 3], [7.3, 0.15, 3], PL);
    for (const s of [1, -1]) add([s * 7.15, 0.25, 3], [0.15, 5.4, 3], PL);
    add([0, 5.47, 0.8], [7, 0.04, 0.8], WAIN);
    for (const s of [1, -1]) add([s * 6.97, 0.25, 0.8], [0.04, 5.2, 0.8], WAIN);
    for (let x = -6.4; x < 6.5; x += 0.8) add([x, 5.42, 0.8], [0.02, 0.02, 0.8], TRIM);
    for (let y = -4.4; y < 5.2; y += 0.8) for (const s of [1, -1]) add([s * 6.92, y, 0.8], [0.02, 0.02, 0.8], TRIM);
    add([0, 5.42, 1.62], [7, 0.07, 0.06], TRIM);
    for (const s of [1, -1]) add([s * 6.92, 0.25, 1.62], [0.07, 5.2, 0.06], TRIM);
    add([0, 5.45, 5.92], [7.2, 0.1, 0.1], TRIM);
    // window with curtains and pot plants
    add([1.5, 5.47, 3.3], [1.25, 0.06, 1.05], TRIM);
    add([1.5, 5.43, 3.3], [1.05, 0.04, 0.88], [0.68, 0.85, 0.98], I3, BOX, true);
    add([1.5, 5.39, 3.3], [0.05, 0.03, 0.88], TRIM);
    add([1.5, 5.39, 3.3], [1.05, 0.03, 0.05], TRIM);
    add([1.5, 5.25, 2.2], [1.4, 0.3, 0.07], TRIM);
    add([1.5, 5.35, 4.62], [1.75, 0.04, 0.04], TRIM);
    for (const x of [0.05, 2.95]) add([x, 5.28, 3.35], [0.3, 0.13, 1.35], [0.84, 0.52, 0.52], I3, SPHERE_LO);
    add([1.0, 5.2, 2.45], [0.18, 0.18, 0.2], [0.72, 0.4, 0.25], I3, SPHERE_LO);
    add([1.0, 5.2, 2.8], [0.25, 0.25, 0.3], [0.33, 0.6, 0.3], I3, SPHERE_LO);
    add([2.1, 5.2, 2.45], [0.18, 0.18, 0.2], [0.72, 0.4, 0.25], I3, SPHERE_LO);
    add([2.1, 5.2, 2.72], [0.2, 0.2, 0.2], [0.35, 0.58, 0.32], I3, SPHERE_LO);
    add([2.1, 5.2, 2.95], [0.12, 0.12, 0.1], [1, 0.6, 0.75], I3, SPHERE_LO);
    // fireplace: stone, arched opening, mantel with candles and a clock, painting above
    add([-4, 5.05, 1.45], [1.55, 0.5, 1.45], STONEH);
    add([-4, 4.53, 0.92], [0.9, 0.05, 0.8], [0.07, 0.05, 0.04]);
    add([-4, 4.52, 1.72], [0.9, 0.05, 0.35], [0.07, 0.05, 0.04], I3, SPHERE_LO);
    for (let i = 0; i < 7; i++) { const a = Math.PI * (i / 6); add([-4 + Math.cos(a) * 1.15, 4.5, 1.72 + Math.sin(a) * 0.55], [0.18, 0.05, 0.13], [0.55, 0.52, 0.49], rotY(-Math.cos(a) * 0.9)); }
    add([-4, 4.2, 0.08], [1.8, 0.6, 0.08], [0.52, 0.5, 0.47]);
    add([-4, 4.45, 2.98], [1.85, 0.4, 0.12], [0.5, 0.32, 0.18]);
    add([-4, 5.2, 4.5], [1.05, 0.35, 1.5], [0.6, 0.57, 0.53]);
    for (const x of [-5.3, -5.0]) {
        add([x, 4.45, 3.3], [0.07, 0.07, 0.22], [1, 0.96, 0.86], I3, SPHERE_LO);
        add([x, 4.45, 3.58], [0.04, 0.04, 0.07], [1, 0.8, 0.3], I3, SPHERE_TINY, true);
    }
    add([-3.0, 4.5, 3.35], [0.28, 0.12, 0.28], [0.45, 0.3, 0.18], I3, SPHERE_LO);
    add([-3.0, 4.38, 3.37], [0.2, 0.02, 0.2], [0.95, 0.92, 0.84], I3, SPHERE_LO);
    add([-4, 4.83, 4.4], [0.72, 0.03, 0.52], TRIM);
    add([-4, 4.8, 4.52], [0.6, 0.02, 0.28], [0.62, 0.78, 0.9]);
    add([-4, 4.8, 4.14], [0.6, 0.02, 0.14], [0.45, 0.62, 0.35]);
    add([-6.1, 4.5, 0.35], [0.45, 0.35, 0.35], [0.6, 0.45, 0.28], I3, SPHERE_LO);
    for (const [x, z] of [[-6.25, 0.7], [-5.95, 0.7], [-6.1, 0.9]]) add([x, 4.5, z], [0.12, 0.42, 0.12], [0.45, 0.29, 0.16], I3, SPHERE_LO);
    // rugs
    add([-3.4, 2.1, 0.05], [2.3, 1.7, 0.02], [0.74, 0.36, 0.3], I3, SPHERE_LO);
    add([-3.4, 2.1, 0.07], [1.7, 1.2, 0.02], [0.93, 0.8, 0.6], I3, SPHERE_LO);
    add([-3.4, 2.1, 0.09], [1.0, 0.7, 0.02], [0.62, 0.7, 0.52], I3, SPHERE_LO);
    add([0, -4.3, 0.04], [1.2, 0.65, 0.03], [0.55, 0.42, 0.26]);
    add([0, -4.3, 0.06], [0.9, 0.12, 0.02], [0.72, 0.3, 0.25]);
    // sofa: wooden base and frame, sage cushions, pillows and a blanket
    const SX = -5.9, SY = 1.3, FAB = [0.56, 0.69, 0.58], WD = [0.56, 0.37, 0.21];
    add([SX, SY, 0.45], [0.95, 2.05, 0.22], WD);
    for (const sx of [1, -1]) for (const sy of [1, -1]) add([SX + sx * 0.8, SY + sy * 1.85, 0.12], [0.1, 0.1, 0.13], [0.4, 0.26, 0.14]);
    add([SX - 0.93, SY, 1.25], [0.07, 2.05, 0.9], WD);
    for (const s of [1, -1]) {
        add([SX + 0.05, SY + s * 0.98, 0.87], [0.85, 0.94, 0.2], FAB);
        add([SX - 0.7, SY + s * 0.98, 1.5], [0.22, 0.94, 0.6], FAB, rotY(-0.12));
        add([SX, SY + s * 2.1, 1.0], [0.95, 0.14, 0.5], WD);
    }
    add([SX - 0.35, SY + 1.55, 1.35], [0.14, 0.36, 0.36], [0.93, 0.73, 0.33], rotZ(0.3), SPHERE_LO);
    add([SX - 0.35, SY - 1.55, 1.35], [0.14, 0.36, 0.36], [0.87, 0.5, 0.52], rotZ(-0.3), SPHERE_LO);
    add([SX + 0.25, SY - 0.75, 1.1], [0.6, 0.55, 0.04], [0.96, 0.91, 0.82], rotZ(0.4));
    // floor lamp by the sofa
    add([-6.1, -1.6, 0.05], [0.3, 0.3, 0.05], [0.3, 0.22, 0.15], I3, SPHERE_LO);
    add([-6.1, -1.6, 1.6], [0.04, 0.04, 1.6], [0.3, 0.22, 0.15]);
    add([-6.1, -1.6, 3.25], [0.4, 0.4, 0.35], [1, 0.88, 0.62], I3, SPHERE_LO, true);
    // round table set for tea
    const TX = 3.8, TY = 1.2;
    add([TX, TY, 0.08], [0.62, 0.62, 0.08], [0.5, 0.32, 0.18], I3, SPHERE_LO);
    add([TX, TY, 0.8], [0.16, 0.16, 0.72], [0.5, 0.32, 0.18]);
    add([TX, TY, 1.5], [1.5, 1.5, 0.06], [0.48, 0.31, 0.18], I3, SPHERE_LO);
    add([TX, TY, 1.55], [1.45, 1.45, 0.08], [0.63, 0.43, 0.25], I3, SPHERE_LO);
    add([TX, TY, 1.64], [1.2, 0.35, 0.012], [0.96, 0.93, 0.87]);
    add([TX, TY + 0.1, 1.9], [0.14, 0.14, 0.26], [0.45, 0.62, 0.8], I3, SPHERE_LO);
    for (let k = 0; k < 5; k++) { const a = k * 1.2566; add([TX + Math.cos(a) * 0.14, TY + 0.1 + Math.sin(a) * 0.14, 2.3], [0.1, 0.1, 0.08], FLOWER_BOX_COLS[k % 4], I3, SPHERE_LO); }
    add([TX - 0.7, TY - 0.3, 1.85], [0.24, 0.24, 0.2], [0.95, 0.93, 0.88], I3, SPHERE_LO);
    add([TX - 0.95, TY - 0.3, 1.9], [0.14, 0.04, 0.04], [0.95, 0.93, 0.88], rotY(-0.6), SPHERE_TINY);
    add([TX - 0.7, TY - 0.3, 2.07], [0.05, 0.05, 0.04], [0.85, 0.45, 0.35], I3, SPHERE_TINY);
    add([TX + 0.5, TY - 0.6, 1.72], [0.1, 0.1, 0.09], [0.85, 0.45, 0.35], I3, SPHERE_LO);
    add([TX + 0.7, TY + 0.5, 1.72], [0.1, 0.1, 0.09], [0.45, 0.6, 0.8], I3, SPHERE_LO);
    add([TX + 0.55, TY + 0.05, 1.7], [0.3, 0.3, 0.09], [0.92, 0.87, 0.77], I3, SPHERE_LO);
    for (let k = 0; k < 3; k++) add([TX + 0.5 + (k - 1) * 0.14, TY + 0.05, 1.83], [0.2, 0.06, 0.06], [1, 0.5, 0.12], rotZ(k), SPHERE_TINY);
    add([TX - 0.35, TY + 0.55, 1.8], [0.05, 0.05, 0.15], [1, 0.97, 0.9], I3, SPHERE_LO);
    add([TX - 0.35, TY + 0.55, 2.0], [0.035, 0.035, 0.06], [1, 0.8, 0.3], I3, SPHERE_TINY, true);
    for (const sx of [2.1, 5.5]) {
        for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; add([sx + Math.cos(a) * 0.33, TY + Math.sin(a) * 0.33, 0.5], [0.05, 0.05, 0.5], [0.45, 0.3, 0.17]); }
        add([sx, TY, 1.05], [0.5, 0.5, 0.08], [0.6, 0.4, 0.23], I3, SPHERE_LO);
        add([sx, TY, 1.13], [0.42, 0.42, 0.06], [0.82, 0.56, 0.5], I3, SPHERE_LO);
    }
    add([TX, TY, 5.3], [0.02, 0.02, 0.7], [0.2, 0.15, 0.1]);
    add([TX, TY, 4.5], [0.45, 0.45, 0.2], [0.96, 0.84, 0.56], I3, SPHERE_LO, true);
    // bookshelf full of books
    const BOOKS = [[0.7, 0.25, 0.22], [0.25, 0.4, 0.6], [0.85, 0.7, 0.35], [0.35, 0.55, 0.35], [0.55, 0.35, 0.55], [0.92, 0.88, 0.8]];
    add([5.4, 5.12, 2.1], [1.25, 0.38, 2.1], [0.4, 0.26, 0.15]);
    add([5.4, 4.76, 2.1], [1.1, 0.02, 1.95], [0.24, 0.16, 0.1]);
    [0.55, 1.45, 2.35, 3.25].forEach((z, si) => {
        add([5.4, 4.85, z], [1.12, 0.3, 0.05], [0.47, 0.31, 0.17]);
        let x = 4.42, k = si * 2;
        while (x < 6.25) {
            const h = 0.26 + ((k * 5) % 4) * 0.035, w = 0.07 + ((k * 3) % 3) * 0.015;
            add([x + w, 4.85, z + 0.05 + h], [w, 0.24, h], BOOKS[k % BOOKS.length]);
            x += w * 2 + 0.02; k++;
            if (k % 7 === 3) x += 0.25;
        }
    });
    // pictures, a big pot plant
    add([6.93, -1.5, 3.4], [0.03, 0.62, 0.46], TRIM);
    add([6.9, -1.5, 3.4], [0.02, 0.5, 0.36], [0.88, 0.72, 0.52]);
    add([6.88, -1.5, 3.35], [0.02, 0.2, 0.14], [0.95, 0.5, 0.55], I3, SPHERE_LO);
    add([6.93, 2.6, 3.5], [0.03, 0.45, 0.45], TRIM, I3, SPHERE_LO);
    add([6.9, 2.6, 3.5], [0.02, 0.36, 0.36], [0.75, 0.85, 0.9], I3, SPHERE_LO);
    add([6.2, -3.6, 0.45], [0.45, 0.45, 0.45], [0.72, 0.4, 0.25], I3, SPHERE_LO);
    for (let k = 0; k < 6; k++) { const a = k * 1.047; add([6.2 + Math.cos(a) * 0.3, -3.6 + Math.sin(a) * 0.3, 1.35 + (k % 2) * 0.35], [0.22, 0.12, 0.55], [0.28 + 0.06 * (k % 2), 0.55, 0.26], mul(rotZ(a), rotY(0.5)), SPHERE_LO); }
    HOUSE_STATIC_V = writeEllipsoids(0, P, I3, [1, 1, 1], [0, 0, 0]) / 4;
}

function hearthParts(time) {
    const f = 0.85 + 0.15 * Math.sin(time * 12) + 0.08 * Math.sin(time * 19 + 1);
    return [
        { c: [0, 0, 0.1], R: rotZ(0.3), r: [0.6, 0.1, 0.1], col: [0.42, 0.26, 0.13], mesh: SPHERE_LO },
        { c: [0, 0, 0.1], R: rotZ(-0.35), r: [0.6, 0.1, 0.1], col: [0.38, 0.24, 0.12], mesh: SPHERE_LO },
        { c: [0, 0, 0.04], R: I3, r: [0.55, 0.2, 0.05], col: [1, 0.42, 0.12], mesh: SPHERE_LO, glow: true },
        { c: [0, 0, 0.45 * f], R: I3, r: [0.42, 0.16, 0.45 * f], col: [1, 0.45, 0.1], mesh: SPHERE_LO, glow: true },
        { c: [0.05, -0.02, 0.52 * f], R: I3, r: [0.27, 0.12, 0.36 * f], col: [1, 0.72, 0.2], mesh: SPHERE_LO, glow: true },
        { c: [0, -0.05, 0.5 * f], R: I3, r: [0.12, 0.08, 0.22 * f], col: [1, 0.95, 0.72], mesh: SPHERE_TINY, glow: true },
    ];
}

const houseBlocked = (x, y) => x < -6.5 || x > 6.5 || y > 4.9 || y < -4.7
    || (x < -4.7 && y > -1.1 && y < 3.7) || (x > -6 && x < -2 && y > 3.9)
    || Math.hypot(x - 3.8, y - 1.2) < 1.7 || Math.hypot(x - 2.1, y - 1.2) < 0.6 || Math.hypot(x - 5.5, y - 1.2) < 0.6
    || (x > 4 && y > 4.4) || Math.hypot(x + 6.1, y + 1.6) < 0.6 || Math.hypot(x - 6.2, y + 3.6) < 0.8;

// ------------------------------------------------------------------ your partner, who lives in the cottage

const PT = { x: -5.75, y: 1.3, z: 1.0, hop: 0, yaw: 0, walk: 0, phase: 0, blink: 1, blinkIn: 2, blinkT: 0, ear: 0.15, t: 0, target: null, sit: true, heartIn: 1 };
const PT_SPOTS = [
    { x: -3.4, y: 3.0, face: Math.PI / 2 },          // warming by the fire
    { x: 1.4, y: 4.0, face: Math.PI / 2 },           // looking out of the window
    { x: 2.0, y: -0.7, face: 0.6 },                  // by the table
    { x: -4.4, y: 1.3, face: Math.PI, sofa: true },  // back to the sofa
];
const CROWN_COLS = [[1, 0.55, 0.72], [1, 0.9, 0.4], [0.78, 0.6, 1], [1, 1, 0.96]];

function updatePartner(dt) {
    if (!owns("partner")) return;
    PT.t += dt;
    PT.blinkIn -= dt;
    if (PT.blinkIn < 0) { PT.blinkIn = 2 + rnd() * 3; PT.blinkT = 0.14; }
    PT.blinkT -= dt;
    PT.blink = PT.blinkT > 0 ? 0.15 : 1;
    const d = Math.hypot(C.x - PT.x, C.y - PT.y);
    let moving = false;
    if (PT.sit) {
        const k = Math.min(1, dt * 5);
        PT.x += (-5.75 - PT.x) * k; PT.y += (1.3 - PT.y) * k; PT.z += (1.0 - PT.z) * k;
        PT.yaw += wrapAngle(0 - PT.yaw) * k;
        PT.hop = d < 3.4 ? Math.abs(Math.sin(time * 5)) * 0.12 : PT.hop * 0.8;
        if (PT.t > 10) { PT.sit = false; PT.t = 0; PT.target = PT_SPOTS[(rnd() * 3) | 0]; }
    } else {
        PT.z += (0 - PT.z) * Math.min(1, dt * 6);
        if (PT.target) {
            const dx = PT.target.x - PT.x, dy = PT.target.y - PT.y, dd = Math.hypot(dx, dy);
            if (dd < 0.2) {
                if (PT.target.sofa) PT.sit = true;
                if (PT.target.face !== undefined) PT.yaw = PT.target.face;
                PT.target = null; PT.t = 0;
            } else {
                PT.x += (dx / dd) * 2.6 * dt; PT.y += (dy / dd) * 2.6 * dt;
                PT.yaw += wrapAngle(Math.atan2(dy, dx) - PT.yaw) * Math.min(1, dt * 8);
                moving = true;
            }
        } else if (d < 3.4) {
            PT.yaw += wrapAngle(Math.atan2(C.y - PT.y, C.x - PT.x) - PT.yaw) * Math.min(1, dt * 5);
            PT.hop = Math.abs(Math.sin(time * 6)) * 0.3;                // happy little hops
        } else if (PT.t > 6) {
            PT.target = PT_SPOTS[(rnd() * 4) | 0]; PT.t = 0;
        } else PT.hop *= 0.85;
    }
    PT.walk += ((moving ? 1 : 0) - PT.walk) * Math.min(1, dt * 6);
    if (moving) { PT.phase += dt * 10; PT.hop = Math.abs(Math.sin(PT.phase)) * 0.35; }
    if (d < 3.2) {
        PT.heartIn -= dt;
        if (PT.heartIn < 0) { PT.heartIn = 1.1; burst(PT.x, PT.y, 3.3 + PT.z, 1, [[1, 0.45, 0.6]], 0.4, 0.14, 1.4, -1.2); }
    }
}

// drawn with the bunny model: white fur, and a flower crown
function writePartner(o, time) {
    const keys = ["x", "y", "z", "hop", "yaw", "walk", "phase", "land", "vz", "crouch", "dig", "carry", "gold", "blink", "ear"];
    const saved = {};
    for (const k of keys) saved[k] = C[k];
    const cols = { fur: COL.fur, belly: COL.belly, feet: COL.feet, tail: COL.tail };
    Object.assign(C, { x: PT.x, y: PT.y, z: PT.z, hop: PT.hop, yaw: PT.yaw, walk: PT.walk, phase: PT.phase, land: 0, vz: 0, crouch: 0, dig: 0, carry: 0, gold: 0, blink: PT.blink, ear: PT.ear });
    Object.assign(COL, { fur: [0.97, 0.95, 0.92], belly: [1, 0.99, 0.97], feet: [0.95, 0.88, 0.85], tail: [1, 1, 1] });
    o = writeBunny(o, time);
    Object.assign(C, saved);
    Object.assign(COL, cols);
    const crown = [];
    for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU2;
        crown.push({ c: [-0.1 + Math.cos(a) * 0.6, Math.sin(a) * 0.62, 2.28], R: I3, r: [0.13, 0.13, 0.1], col: CROWN_COLS[k % 4], mesh: SPHERE_LO });
        crown.push({ c: [-0.1 + Math.cos(a + 0.35) * 0.6, Math.sin(a + 0.35) * 0.62, 2.24], R: rotZ(a), r: [0.1, 0.05, 0.03], col: [0.35, 0.6, 0.3], mesh: SPHERE_TINY });
    }
    const S = [CHAR_SCALE, CHAR_SCALE, CHAR_SCALE];
    return writeEllipsoids(o, crown, rotZ(PT.yaw), S, [PT.x, PT.y, 0.05 + PT.z + PT.hop]);
}

// ------------------------------------------------------------------ going in and out of the cottage

function updateHouse(dt) {
    HOUSE_IN.t += dt;
    updatePartner(dt);
    if (rnd() < dt * 4) burst(-4 + (rnd() - 0.5) * 0.5, 4.35, 0.8, 1, [[1, 0.7, 0.25]], 0.4, 0.04, 0.9, -1.4);
    for (const m of HOUSE_IN.motes) m.ph += dt;
    if (HOUSE_IN.t > 1.5 && !HOUSE_IN.leaving && Math.hypot(C.x, C.y + 4.3) < 0.9) leaveHouse();
}

function renderHouse() {
    let o = HOUSE_STATIC_V * 4;
    o = writeEllipsoids(o, hearthParts(time), I3, [1, 1, 1], [-4, 4.42, 0.16]);
    if (owns("partner")) o = writePartner(o, time);
    o = writeBunny(o, time);
    o = writeParticles(o);
    for (const m of HOUSE_IN.motes) {
        const b = 0.55 + 0.35 * Math.sin(m.ph * 1.7);
        o = billboard(o, m.x + Math.sin(m.ph * 0.3) * 0.4, m.y, m.z + Math.sin(m.ph * 0.5) * 0.3, 0.03, [b, b * 0.97, b * 0.85]);
    }
    const flick = 0.85 + 0.15 * Math.sin(time * 11) * Math.sin(time * 7.3);
    gl.uniform4f(shader.hawk, 0, 0, 1, 0);
    gl.uniform3f(shader.fog, 0.1, 0.07, 0.05);
    gl.uniform2f(shader.fogRange, 60, 120);
    gl.uniform1f(shader.time, time);
    gl.uniform3f(shader.tint, 1.05, 0.97, 0.9);
    gl.uniform1f(shader.outdoor, 0);
    gl.uniform4f(shader.fire, -4, 3.8, 22, 0.2 * flick);
    gl.uniform1f(shader.filter, FILTER_IDS[saveData.filter] || 0);
    gl.clearColor(0.09, 0.07, 0.06, 1);
    space.posArr = pos.subarray(0, o);
    space.colArr = col.subarray(0, o);
    space.totalVert = o / 4;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.reDraw();
}

function enterHouse(from) {
    if (G.scene !== "meadow" || HOUSE_IN.busy || !owns("cottage")) return;
    HOUSE_IN.busy = true;
    el.homeBtn.hidden = true;
    fadeThen(() => {
        HOUSE_IN.busy = false;
        HOUSE_IN.from = from;
        HOUSE_IN.saved = { x: C.x, y: C.y, yaw: C.yaw, alpha: space.alpha, beta: space.beta, Rc: space.Rc };
        G.scene = "house";
        buildHouseStatic();
        Object.assign(C, { x: 0, y: -3.0, vx: 0, vy: 0, z: 0, vz: 0, dig: 0, crouch: 0, digTarget: null });
        C.yaw = Math.PI / 2;
        Object.assign(space, { X0: 0, Y0: 0, Z0: 1.3, alpha: -Math.PI / 2, beta: 0.52, Rc: 13.5 });
        parts.length = 0;
        HOUSE_IN.t = 0; HOUSE_IN.leaving = false;
        stick.id = null; stick.x = stick.y = 0; el.stick.classList.remove("on");
        showOnly(null);
        el.hud.classList.remove("on");
        el.controls.classList.remove("on");
        el.houseUI.hidden = false;
        if (owns("partner")) {
            Object.assign(PT, { x: -5.75, y: 1.3, z: 1.0, sit: false, t: 0, target: { x: 0.9, y: -1.5 } });
            banner("Welcome home!", 2);
        } else banner("Home sweet home", 1.8);
        sound.on("door");
    });
}

function leaveHouse() {
    if (HOUSE_IN.leaving) return;
    HOUSE_IN.leaving = true;
    fadeThen(() => {
        G.scene = "meadow";
        el.houseUI.hidden = true;
        writeGround();
        const s = HOUSE_IN.saved;
        if (HOUSE_IN.from === "play") {
            Object.assign(C, { x: HOME_DOOR[0] + Math.cos(BURROW.yaw) * 1.4, y: HOME_DOOR[1] + Math.sin(BURROW.yaw) * 1.4, vx: 0, vy: 0 });
            C.yaw = BURROW.yaw;
            el.hud.classList.add("on");
            el.controls.classList.toggle("on", TOUCH);
            updateHud(true);
        } else {
            C.x = s.x; C.y = s.y; C.yaw = s.yaw;
            if (HOUSE_IN.from === "dayEnd") showOnly(el.dayEnd);
            else { refreshTitle(); showOnly(el.title); }
        }
        Object.assign(space, { X0: C.x, Y0: C.y, Z0: height(C.x, C.y) + 1.6, alpha: s.alpha, beta: s.beta, Rc: s.Rc });
        syncCamera();
        sound.on("door");
    });
}

function syncHomeButtons() {
    const has = owns("cottage");
    const atDoor = has && G.scene === "meadow" && G.state === "play" && !G.paused && isHome();
    if (el.homeBtn.hidden === atDoor) el.homeBtn.hidden = !atDoor;
    if (el.homeBtnTitle.hidden === has) { el.homeBtnTitle.hidden = !has; el.homeBtnDay.hidden = !has; }
}

Object.assign(el, { homeBtn: $("homeBtn"), homeBtnTitle: $("homeBtnTitle"), homeBtnDay: $("homeBtnDay"), houseUI: $("houseUI") });

function initHouse() {
    el.homeBtn.addEventListener("click", () => enterHouse("play"));
    el.homeBtnTitle.addEventListener("click", () => { sound.start(); enterHouse("title"); });
    el.homeBtnDay.addEventListener("click", () => enterHouse("dayEnd"));
    $("houseLeave").addEventListener("click", leaveHouse);
    addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "e" && !el.homeBtn.hidden) enterHouse("play"); });
}

const DECOR_CORNERS = Math.max(cornersOf(burrowPartsL(3, 0)), cornersOf(cottageParts(0))) + cornersOf(FLOWERBED) + cornersOf(lakeFireParts(0))
    + 4 * cornersOf(lanternParts(0)) + cornersOf(scarecrowParts(0)) + cornersOf(stumpParts(0));

function writeHome(o, time, dusk) {
    const base = [BURROW.x, BURROW.y, BURROW.z - 0.4];
    o = owns("cottage") ? writeEllipsoids(o, cottageParts(dusk), rotZ(BURROW.yaw), [1, 1, 1], [BURROW.x, BURROW.y, BURROW.z - 0.25])
        : writeEllipsoids(o, burrowPartsL(0, dusk), rotZ(BURROW.yaw), [1, 1, 1], base);
    if (owns("flowers")) o = writeEllipsoids(o, FLOWERBED, rotZ(BURROW.yaw), [1, 1, 1], base);
    if (G.fireVis) o = writeEllipsoids(o, lakeFireParts(time), rotZ(FIRE.face), [1, 1, 1], [FIRE.x, FIRE.y, FIRE.z - 0.05]);
    if (owns("lanterns")) {
        const lit = clamp(dusk * 1.4 + RAIN.amt * 0.6, 0.25, 1);
        for (const L of LANTERN_SPOTS) o = writeEllipsoids(o, lanternParts(lit), I3, [1, 1, 1], [L.x, L.y, L.z]);
    }
    if (owns("scarecrow")) o = writeEllipsoids(o, scarecrowParts(time), rotZ(0.6), [1, 1, 1], [SCARE.x, SCARE.y, SCARE.z]);
    return writeEllipsoids(o, stumpParts(dusk), rotZ(SHOP.yaw), [1, 1, 1], [SHOP.x, SHOP.y, SHOP.z - 0.2]);
}

function updateHome(dt) {
    if (G.fireVis) {
        if (rnd() < dt * 6) burst(FIRE.x, FIRE.y, FIRE.z + 0.6, 1, [[1, 0.7, 0.2]], 0.6, 0.05, 0.9, -1.5);
        if (rnd() < dt * 3) burst(FIRE.x, FIRE.y, FIRE.z + 1.0, 1, [[0.55, 0.55, 0.56]], 0.3, 0.22, 2.2, -0.8);
    }
    if (owns("cottage") && rnd() < dt * 2.5) {
        const c = Math.cos(BURROW.yaw), s = Math.sin(BURROW.yaw);
        burst(BURROW.x + c * -1.4 - s * 1.3, BURROW.y + s * -1.4 + c * 1.3, BURROW.z + 6.6, 1, [[0.62, 0.62, 0.64]], 0.25, 0.2, 2.4, -0.7);
    }
    G.shopCooldown = Math.max(0, (G.shopCooldown || 0) - dt);
    if (G.state === "play" && !G.paused && G.shopCooldown <= 0 && Math.hypot(C.x - SHOP.door[0], C.y - SHOP.door[1]) < 1.2) enterShop("play");
}

// ------------------------------------------------------------------ daily quests

const QUESTS = [
    { id: "gold", text: "Bring home the golden carrot", need: 1, reward: 5, ok: (d) => d >= 2 },
    { id: "clover", text: "Find 2 four-leaf clovers", need: 2, reward: 3, ok: () => true },
    { id: "clean", text: "Finish the day without being caught", need: 1, reward: 4, ok: () => true },
    { id: "hide", text: "Stay hidden through 2 hawk attacks", need: 2, reward: 4, ok: () => true },
    { id: "trip", text: "Carry a full load home in one trip", need: 1, reward: 3, ok: () => true },
];
function pickQuest(d) {
    const pool = QUESTS.filter((q) => q.ok(d) && q.id !== G.lastQuest);
    const q = pool[(rnd() * pool.length) | 0];
    G.quest = { q, prog: 0, done: false };
    G.lastQuest = q.id;
}
function questProgress(id, n = 1) {
    const Q = G.quest;
    if (!Q || Q.done || Q.q.id !== id) return;
    Q.prog = Math.min(Q.q.need, Q.prog + n);
    if (Q.prog >= Q.q.need) {
        Q.done = true;
        saveData.clovers += Q.q.reward;
        persist();
        sound.on("quest");
        banner("Quest done: +" + Q.q.reward + " clovers", 2.2);
    }
    updateHud(true);
}

// ------------------------------------------------------------------ Hazel's Hollow: the shop inside the old stump

const ITEMS = [
    { id: "cottage", cat: "home", ped: 0, price: 30, name: "Cottage", desc: "Your burrow becomes a little cottage you can walk inside, with a fireplace, a sofa and a table. Carry 4 carrots at a time." },
    { id: "partner", cat: "home", ped: 0, price: 25, req: "cottage", name: "Partner", desc: "Someone waiting for you at home. They keep a carrot stored for you every morning." },
    { id: "campfire", cat: "home", ped: 1, price: 15, name: "Lakeside campfire", desc: "A cosy fire on the lake shore. Hawks and foxes keep away from its warmth." },
    { id: "lanterns", cat: "home", ped: 2, price: 10, name: "Lantern path", desc: "Lanterns light the way home, giving you 20 more seconds of daylight." },
    { id: "scarecrow", cat: "home", ped: 3, price: 18, name: "Scarecrow", desc: "Stands guard in the meadow, so the hawk hunts less often." },
    { id: "flowers", cat: "home", ped: 4, price: 8, name: "Flower bed", desc: "Flowers around your door, and two extra four-leaf clovers grow each day." },
    { id: "f_warm", cat: "looks", ped: 5, kind: "filter", val: "warm", price: 10, name: "Warm film", desc: "Golden tones and soft film grain." },
    { id: "f_water", cat: "looks", ped: 5, kind: "filter", val: "watercolor", price: 14, name: "Watercolour", desc: "Soft painted colours on textured paper." },
    { id: "f_story", cat: "looks", ped: 5, kind: "filter", val: "storybook", price: 12, name: "Storybook", desc: "Rich colours inside a soft, dreamy frame." },
    { id: "h_wood", cat: "looks", ped: 6, kind: "hud", val: "wood", price: 6, name: "Wooden panels", desc: "Carved wood for every panel and button." },
    { id: "h_frost", cat: "looks", ped: 6, kind: "hud", val: "frost", price: 6, name: "Frosted glass", desc: "Clear, frosty glass panels." },
    { id: "h_paper", cat: "looks", ped: 6, kind: "hud", val: "paper", price: 6, name: "Paper notes", desc: "Cream paper with ink lettering." },
];
const FILTER_IDS = { none: 0, warm: 1, watercolor: 2, storybook: 3 };
const SKIN_COL = { classic: [0.1, 0.11, 0.15], wood: [0.55, 0.36, 0.2], frost: [0.8, 0.9, 0.98], paper: [0.95, 0.9, 0.8] };

const SHOP_R = 9;
const PEDESTALS = [145, 175, 205, 235, 35, 5, -25].map((d) => { const a = (d * Math.PI) / 180; return { x: Math.cos(a) * 5.6, y: Math.sin(a) * 5.6 }; });
const SHOP_IN = { from: "title", saved: null, t: 0, sel: -1, selId: null, tab: "home", walkTo: null, preview: null, cheer: 0, leaving: false,
    flies: Array.from({ length: 22 }, () => ({ a: rnd() * 6.28, r: 2 + rnd() * 5.5, z: 1 + rnd() * 4, ph: rnd() * 6.28 })) };
let SHOP_STATIC_V = 0;

// the room is written straight into the vertex buffer once, when you walk in
function buildShopStatic() {
    let o = 0;
    const put = (p, c) => { pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2]; pos[o + 3] = 1; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; col[o + 3] = 1; o += 4; };
    const quad = (a, b, c, d, ca, cb, cc, cd) => { put(a, ca); put(b, cb); put(c, cc); put(a, ca); put(c, cc); put(d, cd); };
    const glowAt = (x, y, z) => 0.45 + 0.55 * Math.exp(-(x * x + (y - 1) * (y - 1)) / 40) + 0.06 * z;
    const hash = (n) => { const s = Math.sin(n * 91.7) * 43758.5; return s - Math.floor(s); };

    // floor: the cut face of the old tree, growth rings and all
    const RINGS = 14, SEG = 40;
    for (let i = 0; i < RINGS; i++) {
        const r0 = (SHOP_R * i) / RINGS, r1 = (SHOP_R * (i + 1)) / RINGS;
        const base = i === RINGS - 1 ? [0.38, 0.25, 0.15] : i % 2 ? [0.76, 0.58, 0.38] : [0.69, 0.51, 0.32];
        for (let j = 0; j < SEG; j++) {
            const a0 = (j / SEG) * TAU2, a1 = ((j + 1) / SEG) * TAU2;
            const P = (a, r) => { const w = r * (1 + 0.03 * Math.sin(a * 5 + r * 0.7) * (r / SHOP_R)); return [Math.cos(a) * w, Math.sin(a) * w, 0]; };
            const shade = (p) => base.map((v) => v * glowAt(p[0], p[1], 0));
            const p00 = P(a0, r0), p10 = P(a1, r0), p11 = P(a1, r1), p01 = P(a0, r1);
            quad(p00, p10, p11, p01, shade(p00), shade(p10), shade(p11), shade(p01));
        }
    }
    // curved inner wall, open on the camera's side like a doll's house
    const WSEG = 30, a0w = -0.7, a1w = 3.84, H = 7.5;
    for (let j = 0; j < WSEG; j++) {
        const a0 = a0w + ((a1w - a0w) * j) / WSEG, a1 = a0w + ((a1w - a0w) * (j + 1)) / WSEG;
        const grain = 0.85 + 0.3 * hash(j);
        for (let k = 0; k < 4; k++) {
            const z0 = (H * k) / 4, z1 = (H * (k + 1)) / 4;
            const P = (a, z) => [Math.cos(a) * SHOP_R, Math.sin(a) * SHOP_R, z];
            const cz = (z, a) => [0.46, 0.31, 0.19].map((v) => v * grain * (1 - z / 13) * glowAt(Math.cos(a) * 5, Math.sin(a) * 5, z));
            quad(P(a0, z0), P(a1, z0), P(a1, z1), P(a0, z1), cz(z0, a0), cz(z0, a1), cz(z1, a1), cz(z1, a0));
        }
    }
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO, glow = false) => P.push({ c, R, r, col, mesh, glow });
    // round window above the counter, with daylight coming through
    add([0, 8.9, 4.3], [1.32, 0.1, 1.32], [0.3, 0.2, 0.12]);
    add([0, 8.8, 4.3], [1.1, 0.12, 1.1], [0.66, 0.84, 0.98], I3, SPHERE_LO, true);
    add([0, 8.7, 4.3], [1.1, 0.08, 0.06], [0.3, 0.2, 0.12], I3, SPHERE_TINY);
    add([0, 8.7, 4.3], [0.06, 0.08, 1.1], [0.3, 0.2, 0.12], I3, SPHERE_TINY);
    // shelves with jars
    const JARS = [[0.95, 0.65, 0.2], [0.6, 0.15, 0.3], [0.4, 0.6, 0.3], [0.4, 0.5, 0.8]];
    for (const d of [30, 150]) {
        const a = (d * Math.PI) / 180, cx = Math.cos(a) * 8.4, cy = Math.sin(a) * 8.4;
        for (const z of [2.6, 4.0]) {
            add([cx, cy, z], [1.5, 0.35, 0.07], [0.55, 0.37, 0.22], rotZ(a + Math.PI / 2));
            for (let k = 0; k < 4; k++) {
                const t = (k - 1.5) * 0.7, jx = cx + Math.cos(a + Math.PI / 2) * t, jy = cy + Math.sin(a + Math.PI / 2) * t;
                add([jx, jy, z + 0.33], [0.17, 0.17, 0.26], JARS[(k + (z > 3 ? 2 : 0)) % 4], I3, SPHERE_LO, k === 0);
            }
        }
    }
    // counter, with a bell and a jar of clovers
    add([0, 4.9, 0.62], [2.5, 0.65, 0.62], [0.5, 0.32, 0.18], I3, SPHERE_HI);
    add([0, 4.9, 1.26], [2.6, 0.75, 0.08], [0.66, 0.46, 0.28]);
    add([0.9, 4.8, 1.55], [0.22, 0.22, 0.3], [0.5, 0.85, 0.45], I3, SPHERE_LO, true);
    add([-1.2, 4.8, 1.44], [0.16, 0.16, 0.14], [0.95, 0.78, 0.3]);
    // rug, doormat, barrels, potted plants
    add([0, -3.4, 0.03], [2.4, 1.5, 0.03], [0.66, 0.24, 0.2]);
    add([0, -3.4, 0.05], [1.7, 1.0, 0.03], [0.86, 0.62, 0.32]);
    add([0, -7.6, 0.03], [1.0, 0.55, 0.03], [0.55, 0.44, 0.28]);
    for (const d of [62, 118]) { const a = (d * Math.PI) / 180; add([Math.cos(a) * 7.6, Math.sin(a) * 7.6, 0.8], [0.55, 0.55, 0.8], [0.45, 0.3, 0.17]); }
    for (const s of [1, -1]) {
        add([s * 2.7, -7.0, 0.3], [0.3, 0.3, 0.3], [0.72, 0.4, 0.25]);
        add([s * 2.7, -7.0, 0.95], [0.45, 0.45, 0.6], [0.3, 0.55, 0.25]);
    }
    // pedestals: little tree stumps
    for (const p of PEDESTALS) {
        add([p.x, p.y, 0.4], [0.7, 0.7, 0.48], [0.5, 0.34, 0.2]);
        add([p.x, p.y, 0.88], [0.62, 0.62, 0.05], [0.8, 0.64, 0.42]);
    }
    o = writeEllipsoids(o, P, I3, [1, 1, 1], [0, 0, 0]);
    SHOP_STATIC_V = o / 4;
}

const HAZEL_SPIKES = (() => {
    const s = [];
    for (let i = 0; i < 34; i++) {
        const az = Math.PI * (0.55 + 0.9 * ((i * 0.618) % 1)), pol = 0.35 + 1.25 * ((i * 0.377) % 1);
        s.push({ az, pol, d: [Math.sin(pol) * Math.cos(az), Math.sin(pol) * Math.sin(az), Math.cos(pol)] });
    }
    return s;
})();

// Hazel the hedgehog, facing her customers
function hazelParts(time) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO) => P.push({ c, R, r, col, mesh });
    const bob = Math.sin(time * 2) * 0.04 + SHOP_IN.cheer * Math.abs(Math.sin(time * 14)) * 0.25;
    const blink = (time % 4) < 0.12 ? 0.2 : 1;
    const FUR = [0.6, 0.45, 0.32], FACE = [0.9, 0.8, 0.64];
    add([0, 0, 1.05 + bob], [0.85, 0.8, 0.95], FUR, I3, SPHERE_HI);
    add([0.55, 0, 0.95 + bob], [0.45, 0.55, 0.6], FACE);
    add([0.95, 0, 1.25 + bob], [0.32, 0.22, 0.2], FACE, rotY(0.25));
    add([1.24, 0, 1.2 + bob], [0.07, 0.07, 0.07], [0.08, 0.05, 0.05]);
    add([0.62, 0, 0.75 + bob], [0.3, 0.62, 0.55], [0.36, 0.56, 0.42]);
    for (const s of [1, -1]) {
        add([0.9, s * 0.26, 1.48 + bob], [0.06, 0.06, 0.08 * blink], [0.06, 0.04, 0.04]);
        add([0.35, s * 0.5, 1.8 + bob], [0.1, 0.14, 0.12], FUR);
        add([0.8, s * 0.42, 1.2 + bob], [0.08, 0.14, 0.08], [0.95, 0.6, 0.6]);
        const wave = SHOP_IN.cheer > 0 && s > 0 ? 0.9 * Math.sin(time * 12) : 0;
        add([0.6, s * 0.72, 1.0 + bob + (wave ? 0.35 : 0)], [0.14, 0.14, 0.28], FUR, rotX(-s * (0.3 + wave)));
    }
    for (const k of HAZEL_SPIKES) {
        add([k.d[0] * 0.78, k.d[1] * 0.74, 1.05 + bob + k.d[2] * 0.86], [0.07, 0.07, 0.34], [0.28, 0.19, 0.13], mul(rotZ(k.az), rotY(k.pol)), SPHERE_TINY);
    }
    return P;
}

// a little model of each thing for sale, turning on its pedestal
function previewParts(i, time) {
    const P = [];
    const add = (c, r, col, R = I3, mesh = SPHERE_LO, glow = false) => P.push({ c, R, r, col, mesh, glow });
    if (SHOP_IN.sel === i) add([0, 0, -0.1], [0.72, 0.72, 0.02], [1, 0.93, 0.7], I3, SPHERE_LO, true);
    const f = 0.85 + 0.15 * Math.sin(time * 13);
    switch (i) {
        case 0:
            add([0, 0, 0.25], [0.42, 0.36, 0.25], [0.96, 0.91, 0.81], I3, BOX);
            add([0, 0, 0.7], [0.5, 0.44, 0.2], [0.74, 0.35, 0.26], I3, WEDGE);
            add([0.43, 0, 0.18], [0.02, 0.1, 0.16], [0.3, 0.5, 0.36], I3, BOX);
            add([0.43, 0.25, 0.3], [0.02, 0.08, 0.08], [1, 0.86, 0.46], I3, BOX, true);
            add([-0.18, 0.2, 0.86], [0.07, 0.07, 0.14], STONE, I3, BOX);
            if (SHOP_IN.selId === "partner") {
                add([0, -0.09, 1.28], [0.07, 0.13, 0.13], [1, 0.45, 0.58], rotX(0.6), SPHERE_LO, true);
                add([0, 0.09, 1.28], [0.07, 0.13, 0.13], [1, 0.45, 0.58], rotX(-0.6), SPHERE_LO, true);
                add([0, 0, 1.16], [0.07, 0.09, 0.11], [1, 0.45, 0.58], I3, SPHERE_LO, true);
            }
            break;
        case 1:
            for (let k = 0; k < 3; k++) add([0, 0, 0.06], [0.36, 0.06, 0.06], [0.45, 0.28, 0.14], rotZ(k * 2.1));
            add([0, 0, 0.25 * f], [0.16, 0.16, 0.26 * f], [1, 0.5, 0.1], I3, SPHERE_LO, true);
            add([0, 0, 0.32 * f], [0.09, 0.09, 0.18 * f], [1, 0.9, 0.5], I3, SPHERE_TINY, true);
            break;
        case 2:
            add([0, 0, 0.35], [0.04, 0.04, 0.35], WOOD, I3, SPHERE_TINY);
            add([0, 0, 0.78], [0.12, 0.12, 0.15], [1, 0.85, 0.45], I3, SPHERE_LO, true);
            add([0, 0, 0.95], [0.14, 0.14, 0.04], [0.2, 0.15, 0.1], I3, SPHERE_TINY);
            break;
        case 3:
            add([0, 0, 0.45], [0.03, 0.03, 0.45], WOOD, I3, SPHERE_TINY);
            add([0, 0, 0.62], [0.03, 0.35, 0.03], WOOD, I3, SPHERE_TINY);
            add([0, 0, 0.55], [0.14, 0.2, 0.2], [0.72, 0.22, 0.18]);
            add([0, 0, 0.88], [0.13, 0.13, 0.14], [0.9, 0.78, 0.42]);
            add([0, 0, 1.0], [0.2, 0.2, 0.02], [0.3, 0.22, 0.15]);
            add([0, 0, 1.07], [0.1, 0.1, 0.07], [0.3, 0.22, 0.15]);
            break;
        case 4: {
            const cols = [[1, 0.55, 0.75], [1, 0.86, 0.2], [0.72, 0.5, 1], [1, 1, 0.95], [1, 0.42, 0.3]];
            for (let k = 0; k < 5; k++) {
                const a = (k * TAU2) / 5, x = Math.cos(a) * 0.28, y = Math.sin(a) * 0.28;
                add([x, y, 0.2], [0.02, 0.02, 0.2], [0.3, 0.55, 0.2], I3, SPHERE_TINY);
                add([x, y, 0.42], [0.1, 0.1, 0.06], cols[k]);
            }
            break;
        }
        case 5:
            add([0, 0, 0.12], [0.04, 0.04, 0.2], [0.25, 0.2, 0.15], I3, SPHERE_TINY);
            add([0, 0.02, 0.5], [0.42, 0.03, 0.42], [0.25, 0.2, 0.15]);
            add([0, 0, 0.5], [0.36, 0.04, 0.36], [0.7, 0.9, 1], I3, SPHERE_LO, true);
            break;
        case 6: {
            const skin = (SHOP_IN.preview && SHOP_IN.preview.hud) || saveData.hud;
            const c = SKIN_COL[skin] || SKIN_COL.classic;
            add([0, 0, 0.45], [0.46, 0.04, 0.33], c);
            add([0, -0.03, 0.52], [0.3, 0.02, 0.03], skin === "paper" || skin === "frost" ? [0.25, 0.22, 0.2] : [0.85, 0.87, 0.9], I3, SPHERE_TINY, true);
            add([0, -0.03, 0.4], [0.22, 0.02, 0.03], skin === "paper" || skin === "frost" ? [0.25, 0.22, 0.2] : [0.85, 0.87, 0.9], I3, SPHERE_TINY, true);
            break;
        }
    }
    return P;
}

function shopLampParts(time) {
    const P = [];
    [0.55, 1.2, 1.95, 2.6].forEach((a, i) => {
        const x = Math.cos(a) * 6.8, y = Math.sin(a) * 6.8, f = 0.9 + 0.1 * Math.sin(time * 7 + i * 2);
        P.push({ c: [x, y, 6.4], R: I3, r: [0.02, 0.02, 1.1], col: [0.2, 0.15, 0.1], mesh: SPHERE_TINY });
        P.push({ c: [x, y, 5.0], R: I3, r: [0.26, 0.26, 0.32], col: [f, 0.82 * f, 0.45 * f], mesh: SPHERE_LO, glow: true });
        P.push({ c: [x, y, 5.36], R: I3, r: [0.3, 0.3, 0.06], col: [0.2, 0.15, 0.1], mesh: SPHERE_TINY });
    });
    return P;
}

const shopBlocked = (x, y) => Math.hypot(x, y) > 8.3 || (y > 4.0 && y < 5.9 && Math.abs(x) < 2.8)
    || PEDESTALS.some((p) => Math.hypot(x - p.x, y - p.y) < 0.9);

// tap an item: the bunny hops over to its pedestal (any stick or key input takes over again)
function shopWalk(mv) {
    if (Math.hypot(mv[0], mv[1]) > 0.05) { SHOP_IN.walkTo = null; return mv; }
    const t = SHOP_IN.walkTo;
    if (!t) return mv;
    const dx = t.x - C.x, dy = t.y - C.y, d = Math.hypot(dx, dy);
    if (d < 0.35) {
        SHOP_IN.walkTo = null;
        const p = PEDESTALS[SHOP_IN.sel];
        if (p) C.yaw = Math.atan2(p.y - C.y, p.x - C.x);
        return [0, 0];
    }
    const s = Math.min(1, d / 1.2) * 0.8;
    return [(dx / d) * s, (dy / d) * s];
}

function updateShop(dt) {
    SHOP_IN.t += dt;
    SHOP_IN.cheer = Math.max(0, SHOP_IN.cheer - dt * 0.8);
    let near = -1, nd = 1.9;
    PEDESTALS.forEach((p, i) => { const d = Math.hypot(C.x - p.x, C.y - p.y); if (d < nd) { nd = d; near = i; } });
    if (near >= 0 && near !== SHOP_IN.sel && !SHOP_IN.walkTo) selectItem(ITEMS.find((it) => it.ped === near), false);
    if (SHOP_IN.t > 1.5 && Math.hypot(C.x, C.y + 7.6) < 1.0 && !SHOP_IN.leaving) leaveShop();
    for (const f of SHOP_IN.flies) { f.a += dt * 0.15; f.ph += dt; }
}

function renderShop() {
    let o = SHOP_STATIC_V * 4;
    o = writeEllipsoids(o, hazelParts(time), rotZ(-Math.PI / 2), [1, 1, 1], [0, 6.4, 0]);
    PEDESTALS.forEach((p, i) => {
        const lift = SHOP_IN.sel === i ? 0.15 : 0;
        o = writeEllipsoids(o, previewParts(i, time), rotZ(time * 0.7 + i), [1, 1, 1], [p.x, p.y, 1.0 + 0.06 * Math.sin(time * 2 + i) + lift]);
    });
    o = writeEllipsoids(o, shopLampParts(time), I3, [1, 1, 1], [0, 0, 0]);
    o = writeBunny(o, time);
    o = writeParticles(o);
    for (const f of SHOP_IN.flies) {
        const tw = 0.6 + 0.4 * Math.sin(f.ph * 3);
        o = billboard(o, Math.cos(f.a) * f.r, Math.sin(f.a) * f.r, f.z + Math.sin(f.ph) * 0.3, 0.05, [tw, tw * 0.9, tw * 0.5]);
    }
    const filter = FILTER_IDS[(SHOP_IN.preview && SHOP_IN.preview.filter) || saveData.filter] || 0;
    gl.uniform4f(shader.hawk, 0, 0, 1, 0);
    gl.uniform3f(shader.fog, 0.12, 0.08, 0.05);
    gl.uniform2f(shader.fogRange, 60, 120);
    gl.uniform1f(shader.time, time);
    gl.uniform3f(shader.tint, 1.08, 0.97, 0.86);
    gl.uniform1f(shader.outdoor, 0);
    gl.uniform4f(shader.fire, 0, -1, 30, 0.06);
    gl.uniform1f(shader.filter, filter);
    gl.clearColor(0.1, 0.07, 0.05, 1);
    space.posArr = pos.subarray(0, o);
    space.colArr = col.subarray(0, o);
    space.totalVert = o / 4;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    space.reDraw();
}

// ------------------------------------------------------------------ shop UI

function itemState(it) {
    if (it.req && !owns(it.req)) return "locked";
    if (it.id.startsWith("burrow")) {
        const lv = Number(it.id.slice(6));
        return saveData.burrow >= lv ? "owned" : saveData.burrow < lv - 1 ? "locked" : "buy";
    }
    if (it.kind) {
        if (!owns(it.id)) return "buy";
        return (it.kind === "filter" ? saveData.filter : saveData.hud) === it.val ? "inuse" : "use";
    }
    return owns(it.id) ? "owned" : "buy";
}

function hazelSay(text) { el.shopSay.textContent = "\u201C" + text + "\u201D"; }
const applyHudSkin = (v) => { document.body.dataset.skin = v; };

function renderShopUI() {
    el.shopClovers.textContent = String(saveData.clovers);
    $("tabHome").classList.toggle("on", SHOP_IN.tab === "home");
    $("tabLooks").classList.toggle("on", SHOP_IN.tab === "looks");
    $("tabHome").setAttribute("aria-selected", String(SHOP_IN.tab === "home"));
    $("tabLooks").setAttribute("aria-selected", String(SHOP_IN.tab === "looks"));
    el.shopList.textContent = "";
    for (const it of ITEMS.filter((x) => x.cat === SHOP_IN.tab)) {
        const st = itemState(it);
        const row = document.createElement("div");
        row.className = "item" + (SHOP_IN.selId === it.id ? " sel" : "");
        const info = document.createElement("button");
        info.className = "info";
        info.innerHTML = "<b></b><span></span>";
        info.querySelector("b").textContent = it.name;
        info.querySelector("span").textContent = st === "locked" ? "Needs the cottage first." : it.desc;
        info.addEventListener("click", () => selectItem(it, true));
        const btn = document.createElement("button");
        btn.className = "price" + (st === "buy" ? " buy" : "");
        btn.textContent = { buy: "\u2618 " + it.price, owned: "Owned", locked: "Locked", use: "Use", inuse: "In use" }[st];
        btn.disabled = st === "owned" || st === "locked";
        if (st === "buy" && saveData.clovers < it.price) btn.classList.add("short");
        btn.addEventListener("click", () => buyItem(it));
        row.append(info, btn);
        el.shopList.appendChild(row);
    }
}

function selectItem(it, walk) {
    if (!it) return;
    SHOP_IN.tab = it.cat;
    SHOP_IN.sel = it.ped;
    SHOP_IN.selId = it.id;
    const p = PEDESTALS[it.ped], k = 1 - 1.25 / Math.hypot(p.x, p.y);
    if (walk) SHOP_IN.walkTo = { x: p.x * k, y: p.y * k };
    // try looks on before buying them
    SHOP_IN.preview = it.kind === "filter" ? { filter: it.val } : it.kind === "hud" ? { hud: it.val } : null;
    applyHudSkin(it.kind === "hud" ? it.val : saveData.hud);
    hazelSay(it.kind ? "Try it on! That's how " + it.name.toLowerCase() + " looks." : it.desc);
    renderShopUI();
}

function buyItem(it) {
    const st = itemState(it);
    if (st === "buy") {
        if (saveData.clovers < it.price) { hazelSay("You'll need " + (it.price - saveData.clovers) + " more clovers for that one, dear."); selectItem(it, false); return; }
        saveData.clovers -= it.price;
        if (it.id.startsWith("burrow")) saveData.burrow = Number(it.id.slice(6));
        else saveData.owned.push(it.id);
        if (it.kind === "filter") saveData.filter = it.val;
        if (it.kind === "hud") saveData.hud = it.val;
        persist();
        sound.on("buy");
        SHOP_IN.cheer = 1.2;
        const p = PEDESTALS[it.ped];
        burst(p.x, p.y, 1.5, 24, [[1, 0.9, 0.5], [0.5, 0.9, 0.45], [1, 1, 1]], 2.5, 0.09, 1.1, 2);
        hazelSay(["Lovely choice! It'll be waiting for you.", "Wonderful! Enjoy it.", "Thank you, dear. Come again!"][(rnd() * 3) | 0]);
    } else if (st === "use") {
        if (it.kind === "filter") saveData.filter = it.val; else saveData.hud = it.val;
        persist();
    } else if (st === "inuse") {
        if (it.kind === "filter") saveData.filter = "none"; else saveData.hud = "classic";
        persist();
        SHOP_IN.preview = null;
        applyHudSkin(saveData.hud);
    }
    SHOP_IN.selId = it.id;
    renderShopUI();
}

function fadeThen(fn) {
    el.fade.classList.add("on");
    setTimeout(() => { fn(); requestAnimationFrame(() => el.fade.classList.remove("on")); }, 380);
}

function enterShop(from) {
    if (G.scene !== "meadow" || SHOP_IN.busy) return;
    SHOP_IN.busy = true;
    fadeThen(() => {
        SHOP_IN.busy = false;
        SHOP_IN.from = from;
        SHOP_IN.saved = { x: C.x, y: C.y, yaw: C.yaw, alpha: space.alpha, beta: space.beta, Rc: space.Rc };
        G.scene = "shop";
        buildShopStatic();
        Object.assign(C, { x: 0, y: -6.6, vx: 0, vy: 0, z: 0, vz: 0, dig: 0, crouch: 0, digTarget: null });
        C.yaw = Math.PI / 2;
        Object.assign(space, { X0: 0, Y0: -2, Z0: 1.3, alpha: -Math.PI / 2, beta: 0.5, Rc: 12.5 });
        parts.length = 0;
        Object.assign(SHOP_IN, { t: 0, sel: -1, selId: null, walkTo: null, preview: null, leaving: false });
        stick.id = null; stick.x = stick.y = 0; el.stick.classList.remove("on");
        showOnly(null);
        el.hud.classList.remove("on");
        el.controls.classList.remove("on");
        el.shopUI.hidden = false;
        renderShopUI();
        hazelSay(saveData.clovers > 0 ? "Welcome to Hazel's Hollow! You have " + saveData.clovers + " clovers to spend."
            : "Welcome to Hazel's Hollow! Earn clovers in the meadow and come back to spend them.");
        sound.on("door");
    });
}

function leaveShop() {
    if (SHOP_IN.leaving) return;
    SHOP_IN.leaving = true;
    fadeThen(() => {
        G.scene = "meadow";
        el.shopUI.hidden = true;
        SHOP_IN.preview = null;
        applyHudSkin(saveData.hud);
        writeGround();                               // the meadow's ground goes back into the buffer
        const s = SHOP_IN.saved;
        if (SHOP_IN.from === "play") {
            Object.assign(C, { x: SHOP.door[0] + Math.cos(SHOP.yaw) * 2.3, y: SHOP.door[1] + Math.sin(SHOP.yaw) * 2.3, vx: 0, vy: 0 });
            C.yaw = SHOP.yaw;
            G.shopCooldown = 2;
            el.hud.classList.add("on");
            el.controls.classList.toggle("on", TOUCH);
            updateHud(true);
        } else {
            C.x = s.x; C.y = s.y; C.yaw = s.yaw;
            if (SHOP_IN.from === "dayEnd") { $("dayClovers").textContent = "You have " + saveData.clovers; showOnly(el.dayEnd); }
            else { refreshTitle(); showOnly(el.title); }
        }
        Object.assign(space, { X0: C.x, Y0: C.y, Z0: height(C.x, C.y) + 1.6, alpha: s.alpha, beta: s.beta, Rc: s.Rc });
        syncCamera();
        sound.on("door");
    });
}

// ------------------------------------------------------------------ extra sounds

const baseSoundOn = Sound.prototype.on;
Sound.prototype.on = function (name, n = 0) {
    if (!this.ctx) return;
    const up = (steps, base, gap, vol, dur = 0.35) => steps.forEach((s, i) => this.tone("sine", base * 2 ** (s / 12), base * 2 ** (s / 12) * 1.005, dur, vol, i * gap));
    switch (name) {
        case "growl": this.tone("sawtooth", 110, 70, 0.6, 0.08); this.hiss(0.5, 0.14, 300); break;
        case "clover": up([0, 7, 12], 880, 0.06, 0.1, 0.25); break;
        case "buy": up([0, 4, 7, 12, 16], 523, 0.07, 0.11, 0.5); this.hiss(0.2, 0.08, 3000, "highpass"); break;
        case "door": this.tone("triangle", 220, 180, 0.25, 0.1); this.tone("sine", 1320, 1310, 0.5, 0.05, 0.05); break;
        case "quest": up([0, 5, 9, 12], 659, 0.08, 0.1, 0.45); break;
        default: baseSoundOn.call(this, name, n);
    }
};
Sound.prototype.rain = function (amt) {
    if (!this.ctx || this.ctx.state !== "running") return;
    if (!this.rainGain) {
        const c = this.ctx, s = c.createBufferSource();
        s.buffer = this.noise; s.loop = true;
        const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 700;
        this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
        s.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.master);
        s.start();
    }
    this.rainGain.gain.setTargetAtTime(amt * 0.6, this.ctx.currentTime, 0.5);
};

// ------------------------------------------------------------------ wiring

Object.assign(el, {
    fade: $("fade"), shopUI: $("shopUI"), shopList: $("shopList"), shopClovers: $("shopClovers"), shopSay: $("shopSay"),
    clovers: $("hudClovers"), quest: $("hudQuest"),
});

function refreshTitle() {
    showBest();
    $("titleClovers").textContent = String(saveData.clovers);
}

function initExtras() {
    applyHudSkin(saveData.hud);
    refreshTitle();
    $("shopBtnTitle").addEventListener("click", () => { sound.start(); enterShop("title"); });
    $("shopBtnDay").addEventListener("click", () => enterShop("dayEnd"));
    $("shopLeave").addEventListener("click", leaveShop);
    $("tabHome").addEventListener("click", () => { SHOP_IN.tab = "home"; renderShopUI(); });
    $("tabLooks").addEventListener("click", () => { SHOP_IN.tab = "looks"; renderShopUI(); });
}

// ------------------------------------------------------------------ main loop (with automatic quality on phones)

buildScene(TOUCH ? 7000 : 12000);
setMuted(sound.muted);
showBest();
for (let i = 0; i < Math.min(CARROT_MAX, 8); i++) spawnCarrot();   // a few carrots to look at on the title screen
C.yaw = BURROW.yaw;
initExtras();
initHouse();
syncCamera();

let last = performance.now(), perfT = 0, perfN = 0;
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    perfT += dt; perfN++;
    if (perfT > 3) {
        const fps = perfN / perfT;
        perfT = perfN = 0;
        if (fps < 27 && blades.n > 3500 && G.scene === "meadow") buildScene(Math.round(blades.n * 0.7));
        else if (fps < 27 && dprScale > 1) { dprScale = Math.max(1, dprScale - 0.25); resize(); }
    }
    if (!G.paused) step(dt);
    render();
}
requestAnimationFrame(frame);
