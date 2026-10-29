// Paper Brook dapple map (DESIGN.md §3): an 8-bit sun-visibility texture over the whole world (0.5 m texels).
// Every tree canopy blob and trunk stamps its long low-sun shadow (an ellipse ~7.7× longer than it is wide); then
// soft noise breaks the result up. The GPU samples it for sunlight on ground, grass, water and stones, and the game
// samples the same array on the CPU so a boat sitting in a sunbeam really is in the sun (and dries).
import { fbm, vnoise, clamp } from "./mesh.js";
import { F, SUN } from "./brook.js";

export const RES = 0.5;
export function bakeShade(trees) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const f of F) { x0 = Math.min(x0, f.p[0]); y0 = Math.min(y0, f.p[1]); x1 = Math.max(x1, f.p[0]); y1 = Math.max(y1, f.p[1]); }
  x0 -= 90; y0 -= 90; x1 += 90; y1 += 90;
  const W = Math.ceil((x1 - x0) / RES), H = Math.ceil((y1 - y0) / RES), A = new Float32Array(W * H).fill(1);
  // leaf-gap noise, evaluated once per texel
  const HOLE = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) HOLE[j * W + i] = clamp((0.72 - vnoise((x0 + i * RES) * 0.9, (y0 + j * RES) * 0.9, 31)) * 3.2, 0, 1);
  const sx = SUN[0] / SUN[2], sy = SUN[1] / SUN[2], dl = Math.hypot(SUN[0], SUN[1]), ax = -SUN[0] / dl, ay = -SUN[1] / dl;
  const stretch = 1 / SUN[2];
  // ellipse centred (cx, cy): semi-axis `a` along the shadow direction, `b` across; opacity op
  const stamp = (cx, cy, a, b, op, holes) => {
    const R = Math.max(a, b), i0 = Math.max(0, Math.floor((cx - R - x0) / RES)), i1 = Math.min(W - 1, Math.ceil((cx + R - x0) / RES));
    const j0 = Math.max(0, Math.floor((cy - R - y0) / RES)), j1 = Math.min(H - 1, Math.ceil((cy + R - y0) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * RES - cx, py = y0 + j * RES - cy, u = (px * ax + py * ay) / a, v = (px * -ay + py * ax) / b, q = u * u + v * v;
      if (q >= 1) continue;
      let o = op * (1 - Math.pow(q, 3));
      if (holes) o *= HOLE[j * W + i];
      A[j * W + i] *= 1 - o;
    }
  };
  for (const T of trees) {
    for (const bl of T.blobs) {
      const h = bl.c[2] - T.gz, cx = bl.c[0] - sx * h, cy = bl.c[1] - sy * h;
      stamp(cx, cy, bl.r * stretch, bl.r * 0.95, 0.68, true);
    }
    // trunk: a chain of narrow stamps from the foot to the crown's shadow
    const L = T.H * stretch * SUN[2] / Math.tan(Math.asin(SUN[2])), n = Math.ceil(L / 1.5);
    for (let k = 0; k <= n; k++) { const t = k / n, h = t * T.H * 0.8; stamp(T.wx - sx * h, T.wy - sy * h, 1.1, Math.max(0.3, T.r0 * 1.4), 0.55, false); }
  }
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i * RES, y = y0 + j * RES;
    let v = A[j * W + i];
    v = v * (0.7 + 0.6 * fbm(x * 0.05, y * 0.05, 77, 3)) - 0.05;
    v = clamp((v - 0.25) * 1.6 + 0.25, 0, 1);
    out[j * W + i] = Math.round(v * 255);
  }
  return sampler({ x0, y0, W, H, data: out });
}
export function sampler(map) {
  const { x0, y0, W, H, data: out } = map;
  map.at = (x, y) => {
    const fx = (x - x0) / RES - 0.5, fy = (y - y0) / RES - 0.5, i = clamp(Math.floor(fx), 0, W - 2), j = clamp(Math.floor(fy), 0, H - 2), tx = clamp(fx - i, 0, 1), ty = clamp(fy - j, 0, 1);
    const a = out[j * W + i], b = out[j * W + i + 1], c = out[(j + 1) * W + i], d = out[(j + 1) * W + i + 1];
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 255;
  };
  return map;
}
