// Storm Beacon sea (DESIGN.md §3): a sum of Gerstner waves. The same table drives the vertex shader (GLSL emitted
// from it below) and the CPU sampler used to float the ships, buoys and spray.

// [dirX, dirY, wavelength m, amplitude m at storm = 1]
export const WAVES = [
  [0.22, -1.0, 72, 1.6],
  [0.62, -0.78, 38, 0.85],
  [-0.45, -0.89, 24, 0.5],
  [0.92, -0.38, 14, 0.24],
  [-0.7, -0.62, 8.5, 0.11],
];
const G = 9.81;
const W = WAVES.map(([dx, dy, L, A]) => { const l = Math.hypot(dx, dy), k = (2 * Math.PI) / L; return { dx: dx / l, dy: dy / l, k, A, w: Math.sqrt(G * k), Q: 0.55 }; });

// near the shore and inside the harbour the swell dies down
export function damp(x, y) {
  const s = Math.min(1, Math.max(0, (y - 5) / 90));
  const harbour = x < -150 && x > -300 && y < 85 ? 0.2 : 1;
  return s * s * (3 - 2 * s) * harbour;
}
// surface height and slope at (x, y), time t, storm strength s
export function sea(x, y, t, s) {
  const d = damp(x, y) * s;
  let h = 0, gx = 0, gy = 0;
  for (const v of W) {
    const ph = v.k * (v.dx * x + v.dy * y) - v.w * t, A = v.A * d;
    h += A * Math.sin(ph); const c = A * v.k * Math.cos(ph); gx += v.dx * c; gy += v.dy * c;
  }
  return { h, gx, gy };
}

// GLSL: displaced position + normal for the SEA material
export const GLSL_WAVES = `
float damp(vec2 p) {
    float s = clamp((p.y - 5.0) / 90.0, 0.0, 1.0);
    float harbour = (p.x < -150.0 && p.x > -300.0 && p.y < 85.0) ? 0.2 : 1.0;
    return s * s * (3.0 - 2.0 * s) * harbour;
}
vec3 gerstner(vec2 p, float t, float s, out vec3 nrm, out float crest) {
    float d = damp(p) * s;
    vec3 o = vec3(p, 0.0); vec3 n = vec3(0.0, 0.0, 1.0); crest = 0.0;
${W.map((v) => `    { vec2 D = vec2(${v.dx.toFixed(4)}, ${v.dy.toFixed(4)}); float k = ${v.k.toFixed(5)}, A = ${v.A.toFixed(3)} * d, ph = k * dot(D, p) - ${v.w.toFixed(4)} * t;
      float c = cos(ph), sn = sin(ph); o.xy += ${v.Q.toFixed(2)} * A * D * c; o.z += A * sn; n.xy -= D * k * A * c; n.z -= ${v.Q.toFixed(2)} * k * A * sn; crest += A * sn * k; }`).join("\n")}
    nrm = normalize(n);
    return o;
}`;
