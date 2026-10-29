// Grand Prix 3D circuit: a loop of control points → closed Catmull-Rom spline → smoothed → resampled every STEP m.
// Everything the game needs about the track is precomputed here: centre line, tangents, left normals, signed
// curvature (+ = left turn), the AI racing line (lateral offset) and the AI speed profile.
//
// World: x east, y north, z up. The start line is on the main straight heading north at x = 0.

export const STEP = 2;            // metres between samples
export const HALF = 7;            // half the road width
export const KERB = 1.4;          // kerb width outside the white line
export const WALL = 14;           // barriers from the centre line
export const VMAX = 82;           // m/s top speed (≈ 295 km/h)

// grip of the cars, shared with the physics: lateral acceleration available at speed v (downforce grows with v²)
export const latGrip = (v) => 16 + 0.0042 * v * v;

const CTRL = [
    [0, -200], [0, 100], [0, 350], [12, 430], [100, 445], [230, 380], [250, 280], [195, 200], [255, 115],
    [340, 70], [370, -40], [325, -140], [235, -165], [170, -95], [105, -160], [120, -280], [75, -365], [5, -345],
];

export function buildTrack() {
    // dense Catmull-Rom through the control points
    const n = CTRL.length;
    let pts = [];
    for (let i = 0; i < n; i++) {
        const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
        const m = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
        for (let k = 0; k < m; k++) {
            const t = k / m, t2 = t * t, t3 = t2 * t;
            const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
    }
    // smooth away the spline's uneven curvature
    for (let pass = 0; pass < 60; pass++) {
        const q = pts;
        pts = q.map((p, i) => { const a = q[(i - 1 + q.length) % q.length], b = q[(i + 1) % q.length]; return [p[0] * 0.5 + (a[0] + b[0]) * 0.25, p[1] * 0.5 + (a[1] + b[1]) * 0.25]; });
    }
    // resample at equal arc length
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[pts.length], N = Math.round(total / STEP), step = total / N;
    const px = new Float64Array(N), py = new Float64Array(N);
    for (let i = 0, j = 0; i < N; i++) {
        const s = i * step;
        while (cum[j + 1] < s) j++;
        const a = pts[j], b = pts[(j + 1) % pts.length], t = (s - cum[j]) / (cum[j + 1] - cum[j]);
        px[i] = a[0] + (b[0] - a[0]) * t; py[i] = a[1] + (b[1] - a[1]) * t;
    }
    // rotate so sample 0 is the start line on the main straight
    let start = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const d = Math.hypot(px[i], py[i] - 40); if (d < bd) { bd = d; start = i; } }
    const rx = Float64Array.from({ length: N }, (_, i) => px[(i + start) % N]), ry = Float64Array.from({ length: N }, (_, i) => py[(i + start) % N]);

    const tx = new Float64Array(N), ty = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N), ang = new Float64Array(N), k = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const a = (i - 1 + N) % N, b = (i + 1) % N, dx = rx[b] - rx[a], dy = ry[b] - ry[a], l = Math.hypot(dx, dy);
        tx[i] = dx / l; ty[i] = dy / l; nx[i] = -ty[i]; ny[i] = tx[i]; ang[i] = Math.atan2(ty[i], tx[i]);
    }
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let i = 0; i < N; i++) k[i] = wrap(ang[(i + 1) % N] - ang[(i - 1 + N) % N]) / (2 * step);
    const smooth = (src, r) => {
        const out = new Float64Array(N);
        for (let i = 0; i < N; i++) { let s = 0, w = 0; for (let j = -r; j <= r; j++) { const g = Math.exp(-(j * j) / (r * r * 0.35)); s += src[(i + j + N) % N] * g; w += g; } out[i] = s / w; }
        return out;
    };
    const ks = smooth(k, 14);
    // racing line: towards the inside around the apex, a little wider on the way in and out
    const line = new Float64Array(N);
    for (let i = 0; i < N; i++) line[i] = Math.max(-4.6, Math.min(4.6, ks[i] * 150 - ks[(i + 12) % N] * 40));
    const lineS = smooth(line, 10);
    // AI speed profile: cornering limit, then braking (backwards) and acceleration (forwards) passes
    const vmax = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const kk = Math.abs(ks[i]) * 0.86;            // the racing line is wider than the centre line
        vmax[i] = kk - 0.0042 <= 0 ? VMAX : Math.min(VMAX, Math.sqrt(16 / (kk - 0.0042)));
    }
    for (let rep = 0; rep < 2; rep++) {
        for (let i = N - 1; i >= 0; i--) { const nxt = vmax[(i + 1) % N]; vmax[i] = Math.min(vmax[i], Math.sqrt(nxt * nxt + 2 * 24 * step)); }
        for (let i = 0; i < N; i++) { const prv = vmax[(i - 1 + N) % N]; vmax[i] = Math.min(vmax[i], Math.sqrt(prv * prv + 2 * 12 * step)); }
    }
    return { N, step, L: total, px: rx, py: ry, tx, ty, nx, ny, k, ks, line: lineS, vmax };
}

// nearest sample to (x, y), searching around a hint index (or everywhere without one)
export function locate(T, x, y, hint = -1) {
    let best = 0, bd = Infinity;
    if (hint < 0) { for (let i = 0; i < T.N; i++) { const d = (T.px[i] - x) ** 2 + (T.py[i] - y) ** 2; if (d < bd) { bd = d; best = i; } } }
    else for (let j = -40; j <= 40; j++) { const i = (hint + j + T.N) % T.N, d = (T.px[i] - x) ** 2 + (T.py[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    const dx = x - T.px[best], dy = y - T.py[best];
    let s = best * T.step + dx * T.tx[best] + dy * T.ty[best];
    if (s < 0) s += T.L; if (s >= T.L) s -= T.L;
    return { i: best, s, off: dx * T.nx[best] + dy * T.ny[best] };
}

// point on the track at distance s and lateral offset off (+ = left), with the heading there
export function pointAt(T, s, off) {
    s = ((s % T.L) + T.L) % T.L;
    const f = s / T.step, i = Math.floor(f) % T.N, j = (i + 1) % T.N, t = f - Math.floor(f);
    const x = T.px[i] + (T.px[j] - T.px[i]) * t, y = T.py[i] + (T.py[j] - T.py[i]) * t;
    const nx = T.nx[i] + (T.nx[j] - T.nx[i]) * t, ny = T.ny[i] + (T.ny[j] - T.ny[i]) * t, l = Math.hypot(nx, ny);
    return { x: x + nx / l * off, y: y + ny / l * off, h: Math.atan2(-nx / l, ny / l), i };
}
