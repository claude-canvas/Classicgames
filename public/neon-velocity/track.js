// Neon Velocity track (DESIGN.md §2): a closed Catmull-Rom skyway sampled into frames every STEP metres.
// Track space: s = distance along the centre line, x = lateral offset (+ right), h = height above the road.

export const HALF = 11, STEP = 2;
const CP = [[0, 0, 20], [350, -20, 20], [620, 60, 32], [760, 260, 48], [700, 480, 62], [500, 560, 55], [330, 500, 40], [200, 620, 28], [260, 820, 22], [480, 900, 30], [620, 1060, 50], [420, 1200, 64], [120, 1150, 55], [-80, 980, 40], [-180, 760, 28], [-120, 520, 18], [-260, 330, 24], [-220, 120, 22]];
const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (a) => Math.hypot(a[0], a[1], a[2]), nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// dense polyline → resample by arc length
const dense = [];
for (let i = 0; i < CP.length; i++) { const p0 = CP[(i - 1 + CP.length) % CP.length], p1 = CP[i], p2 = CP[(i + 1) % CP.length], p3 = CP[(i + 2) % CP.length]; for (let k = 0; k < 60; k++) dense.push(cr(p0, p1, p2, p3, k / 60)); }
const cum = [0]; for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + len(sub(dense[i % dense.length], dense[i - 1])));
export const LENGTH = cum[cum.length - 1];
const N = Math.floor(LENGTH / STEP);
export const F = [];
{
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / N) * LENGTH; while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = dense[j], b = dense[(j + 1) % dense.length];
    F.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] });
  }
  for (let i = 0; i < N; i++) { const a = F[(i - 1 + N) % N].p, b = F[(i + 1) % N].p; F[i].t = nrm(sub(b, a)); }
  // curvature in the horizontal plane (signed, + = turning right), smoothed
  const raw = F.map((f, i) => { const t0 = F[(i - 2 + N) % N].t, t1 = F[(i + 2) % N].t, r = nrm(cross(f.t, [0, 0, 1])); return dot(sub(t1, t0), r) / (4 * (LENGTH / N)); });
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -12; k <= 12; k++) s += raw[(i + k + N) % N]; F[i].k = s / 25; }
  for (let i = 0; i < N; i++) {
    const f = F[i], r0 = nrm(cross(f.t, [0, 0, 1])), u0 = cross(r0, f.t);
    const b = Math.max(-0.38, Math.min(0.38, f.k * 70)); f.bank = b;
    const c = Math.cos(b), sn = Math.sin(b);
    f.u = nrm([u0[0] * c + r0[0] * sn, u0[1] * c + r0[1] * sn, u0[2] * c + r0[2] * sn]);
    f.r = nrm([r0[0] * c - u0[0] * sn, r0[1] * c - u0[1] * sn, r0[2] * c - u0[2] * sn]);
  }
}
export const wrapS = (s) => ((s % LENGTH) + LENGTH) % LENGTH;
// interpolated frame at s
export function frame(s) {
  s = wrapS(s); const fi = s / (LENGTH / N), i = Math.floor(fi) % N, j = (i + 1) % N, t = fi - Math.floor(fi), A = F[i], B = F[j];
  const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return { p: L(A.p, B.p), t: nrm(L(A.t, B.t)), r: nrm(L(A.r, B.r)), u: nrm(L(A.u, B.u)), k: A.k + (B.k - A.k) * t, bank: A.bank + (B.bank - A.bank) * t };
}
export function toWorld(s, x, h = 0) { const f = frame(s); return [f.p[0] + f.r[0] * x + f.u[0] * h, f.p[1] + f.r[1] * x + f.u[1] * h, f.p[2] + f.r[2] * x + f.u[2] * h]; }
export const kAt = (s) => frame(s).k;
// boost pads [s, x0, x1]
export const PADS = [[420, -8, -2], [900, 2, 8], [1500, -3, 3], [2100, -8, -2], [2700, 2, 8], [3300, -3, 3]].filter((p) => p[0] < LENGTH - 60);
// holo arches
export const ARCHES = []; for (let s = 150; s < LENGTH - 50; s += 230) ARCHES.push(s);
