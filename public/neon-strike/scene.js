// Neon Strike alley (DESIGN.md §4): our lane in the middle with neighbours either side, gutters with neon, cappings,
// ball returns, the pin deck and pit, the masking unit that carries the neon sign, a ceiling of neon tubes and
// retro-grid side walls. Things that should mirror in the lane finish are written to R as well.

import { MAT, Mesh, tube, limb, blob, mulberry32, vnoise, mixc } from "./mesh.js";
import { LANE_HALF, GUTTER, HEAD_Y, KICK_X, PIT_Y, SPOTS, PIN_H } from "./physics.js";

export const PITCH = 1.854;                     // lane centre to lane centre
export const LANES = [-2, -1, 0, 1, 2].map((k) => k * PITCH);
export const DECK_END = PIT_Y - 0.86 + 0.6, MASK_Y = PIT_Y + 0.5, CEIL = 4.2;
export const NEON = [[0.1, 0.95, 1.0], [1.0, 0.2, 0.85], [0.55, 0.3, 1.0], [1.0, 0.55, 0.15]];
// static point lights [x, y, z, k, r, g, b]
export const LIGHTS = [
  [0, HEAD_Y + 0.4, 2.0, 3.2, 1, 0.95, 0.9],
  [0, 2.5, 3.6, 1.6, ...NEON[1]], [0, 9, 3.6, 1.6, ...NEON[0]], [0, 15, 3.6, 1.6, ...NEON[2]],
  [-0.85, 5, 0.25, 0.25, ...NEON[0]], [0.85, 5, 0.25, 0.25, ...NEON[1]], [-0.85, 13, 0.25, 0.25, ...NEON[0]], [0.85, 13, 0.25, 0.25, ...NEON[1]],
];

const PIN_PROFILE = [[0, 0], [0.026, 0], [0.04, 0.03], [0.058, 0.09], [0.061, 0.115], [0.055, 0.17], [0.038, 0.225], [0.028, 0.252], [0.026, 0.268], [0.03, 0.3], [0.032, 0.33], [0.028, 0.36], [0.016, 0.376], [0, 0.38]];
export function buildPin(seg = 16) {
  const m = new Mesh(2000);
  for (let j = 0; j < PIN_PROFILE.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, [r0, z0] = PIN_PROFILE[j], [r1, z1] = PIN_PROFILE[j + 1];
    const zm = (z0 + z1) / 2, red = (zm > 0.236 && zm < 0.248) || (zm > 0.272 && zm < 0.284);
    const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
    m.quad(P(r0, a0, z0), P(r0, a1, z0), P(r1, a1, z1), P(r1, a0, z1), red ? [0.85, 0.06, 0.08] : [0.94, 0.93, 0.92], MAT.PIN);
  }
  // the stripes are thin, so add them as separate bands slightly proud of the surface
  for (const [za, zb] of [[0.233, 0.247], [0.27, 0.284]]) for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, r = (z) => { for (let j = 0; j < PIN_PROFILE.length - 1; j++) { const [r0, z0] = PIN_PROFILE[j], [r1, z1] = PIN_PROFILE[j + 1]; if (z >= z0 && z <= z1) return r0 + (r1 - r0) * ((z - z0) / (z1 - z0)) + 0.0012; } return 0.03; };
    m.quad([Math.cos(a0) * r(za), Math.sin(a0) * r(za), za], [Math.cos(a1) * r(za), Math.sin(a1) * r(za), za], [Math.cos(a1) * r(zb), Math.sin(a1) * r(zb), zb], [Math.cos(a0) * r(zb), Math.sin(a0) * r(zb), zb], [0.85, 0.06, 0.08], MAT.PIN);
  }
  return m;
}
export function buildBall(R, colA, colB) {
  const m = new Mesh(4000), NA = 26, NB = 16;
  const col = (x, y, z) => { const n = vnoise(x * 18 + z * 9, y * 18 - z * 7, 3) * 0.6 + vnoise(x * 40 + 5, y * 40 + z * 30, 4) * 0.4; const s = Math.sin(n * 9 + x * 20); return mixc(colA, colB, 0.5 + 0.5 * s); };
  for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) {
    const P = (ii, jj) => { const th = (jj / NB) * Math.PI, ph = (ii / NA) * Math.PI * 2; return [Math.sin(th) * Math.cos(ph) * R, Math.sin(th) * Math.sin(ph) * R, Math.cos(th) * R]; };
    const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j), cc = col(...a);
    m.quad(a, b, c, d, cc, MAT.BALL);
  }
  // finger holes
  for (const [u, v] of [[0.0, 0.0], [0.035, 0.05], [-0.035, 0.05]]) { const th = 0.35 + v * 4, ph = u * 9; const c = [Math.sin(th) * Math.cos(ph) * R * 1.001, Math.sin(th) * Math.sin(ph) * R * 1.001, Math.cos(th) * R * 1.001]; blob(m, c, 0.011, 0.011, 0.011, [0.02, 0.02, 0.03], MAT.MATTE, 6, 3); }
  return m;
}

export function buildScene(O, R, L, A, Sh) {
  const rnd = mulberry32(8);
  const pin = buildPin(10);
  LANES.forEach((cx, li) => {
    const main = li === 2;
    // lane boards, pin deck, approach (LANE material, blended over the mirror image)
    L.quad([cx - LANE_HALF, 0, 0, 1], [cx + LANE_HALF, 0, 0, 1], [cx + LANE_HALF, HEAD_Y - 0.45, 0, 1], [cx - LANE_HALF, HEAD_Y - 0.45, 0, 1], [0.86, 0.66, 0.42], MAT.LANE);
    L.quad([cx - LANE_HALF, HEAD_Y - 0.45, 0, 3], [cx + LANE_HALF, HEAD_Y - 0.45, 0, 3], [cx + LANE_HALF, DECK_END, 0, 3], [cx - LANE_HALF, DECK_END, 0, 3], [0.8, 0.62, 0.4], MAT.LANE);
    L.quad([cx - PITCH / 2, -5, 0, 2], [cx + PITCH / 2, -5, 0, 2], [cx + PITCH / 2, 0, 0, 2], [cx - PITCH / 2, 0, 0, 2], [0.5, 0.36, 0.26], MAT.LANE);
    // foul line
    O.quad([cx - PITCH / 2, -0.015, 0.002], [cx + PITCH / 2, -0.015, 0.002], [cx + PITCH / 2, 0.015, 0.002], [cx - PITCH / 2, 0.015, 0.002], [1.6, 0.15, 0.3], MAT.EMIT);
    // gutters: half pipes
    for (const s of [-1, 1]) {
      const N = 6, x0 = cx + s * LANE_HALF, x1 = cx + s * KICK_X;
      for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N, P = (t, y) => [x0 + (x1 - x0) * t, y, -Math.sin(t * Math.PI) * 0.09];
        O.quad(P(t0, 0), P(t1, 0), P(t1, DECK_END), P(t0, DECK_END), [0.06, 0.05, 0.09], MAT.GLOSS);
      }
      // capping between lanes with a neon strip along it
      const cap0 = cx + s * KICK_X, cap1 = cx + s * PITCH / 2;
      O.quad([cap0, -0.0, 0.02], [cap1, -0.0, 0.02], [cap1, DECK_END, 0.02], [cap0, DECK_END, 0.02], [0.08, 0.06, 0.12], MAT.GLOSS);
      const nc = NEON[(li + (s > 0 ? 1 : 0)) % 2];
      for (const M of [O, R]) M.quad([cap0 + s * 0.01, 0, 0.024], [cap0 + s * 0.03, 0, 0.024], [cap0 + s * 0.03, DECK_END, 0.024], [cap0 + s * 0.01, DECK_END, 0.024], nc.map((v) => v * 1.4), MAT.EMIT);
      // kickback plates
      for (const M of [O, R]) {
        M.quad([cx + s * KICK_X, HEAD_Y - 0.6, 0], [cx + s * KICK_X, MASK_Y, 0], [cx + s * KICK_X, MASK_Y, 0.95], [cx + s * KICK_X, HEAD_Y - 0.6, 0.95], [0.1, 0.07, 0.14], MAT.MATTE);
        M.quad([cx + s * KICK_X * 0.999, HEAD_Y - 0.6, 0.6], [cx + s * KICK_X * 0.999, MASK_Y, 0.6], [cx + s * KICK_X * 0.999, MASK_Y, 0.64], [cx + s * KICK_X * 0.999, HEAD_Y - 0.6, 0.64], nc.map((v) => v * 1.2), MAT.EMIT);
      }
    }
    // pit
    O.quad([cx - KICK_X, DECK_END, -0.35], [cx + KICK_X, DECK_END, -0.35], [cx + KICK_X, MASK_Y, -0.35], [cx - KICK_X, MASK_Y, -0.35], [0.01, 0.01, 0.015], MAT.MATTE);
    O.quad([cx - KICK_X, DECK_END, 0], [cx + KICK_X, DECK_END, 0], [cx + KICK_X, DECK_END, -0.35], [cx - KICK_X, DECK_END, -0.35], [0.02, 0.02, 0.03], MAT.MATTE);
    O.quad([cx - KICK_X, MASK_Y, -0.35], [cx + KICK_X, MASK_Y, -0.35], [cx + KICK_X, MASK_Y, 0.85], [cx - KICK_X, MASK_Y, 0.85], [0.015, 0.01, 0.02], MAT.MATTE);   // pit curtain
    // ball return at the approach between lanes
    if (li < 4) {
      const bx = cx + PITCH / 2;
      for (const M of [O, R]) { blob(M, [bx, -2.2, 0.32], 0.24, 0.55, 0.38, [0.12, 0.1, 0.2], MAT.GLOSS, 12, 6); tube(M, bx, -2.2, 16, 0.2, 0.68, 0.18, 0.72, NEON[li % 3].map((v) => v * 1.3), MAT.EMIT); }
    }
    // neighbours' racks (static, decorative)
    if (!main) for (const [px, py] of SPOTS) putPinStatic(O, R, pin, cx + px, py);
    // overhead neon tube along the lane, and a "lane number" glow
    for (const M of [O, R]) {
      const nc = NEON[li % 3];
      limb(M, [cx, 1, CEIL - 0.25], [cx, HEAD_Y - 1, CEIL - 0.25], 0.025, 0.025, nc.map((v) => v * 1.5), MAT.EMIT, 6);
    }
  });
  // masking unit across all lanes, with a frame of neon around our sign
  for (const M of [O, R]) {
    M.quad([-5, MASK_Y, 0.85], [5, MASK_Y, 0.85], [5, MASK_Y, CEIL], [-5, MASK_Y, CEIL], [0.06, 0.04, 0.1], MAT.MATTE);
    const fr = (x0, z0, x1, z1, c) => { M.quad([x0, MASK_Y - 0.02, z0], [x1, MASK_Y - 0.02, z0], [x1, MASK_Y - 0.02, z0 + 0.03], [x0, MASK_Y - 0.02, z0 + 0.03], c, MAT.EMIT); M.quad([x0, MASK_Y - 0.02, z1 - 0.03], [x1, MASK_Y - 0.02, z1 - 0.03], [x1, MASK_Y - 0.02, z1], [x0, MASK_Y - 0.02, z1], c, MAT.EMIT); };
    fr(-1.75, 1.45, 1.75, 3.35, [1.6, 0.3, 1.4]); fr(-1.68, 1.52, 1.68, 3.28, [0.2, 1.2, 1.6]);
    for (const cx of LANES) if (cx !== 0) fr(cx - 0.6, 1.9, cx + 0.6, 2.9, NEON[Math.abs(Math.round(cx)) % 3].map((v) => v * 0.9));
  }
  // ceiling + cross tubes
  O.quad([-5, -9, CEIL], [5, -9, CEIL], [5, MASK_Y, CEIL], [-5, MASK_Y, CEIL], [0.03, 0.02, 0.05], MAT.MATTE);
  for (let y = -2; y < 20; y += 4) for (const M of [O, R]) limb(M, [-4.6, y, CEIL - 0.08], [4.6, y, CEIL - 0.08], 0.02, 0.02, (y / 4) % 2 ? [1.4, 0.3, 1.2] : [0.3, 1.2, 1.5], MAT.EMIT, 5);
  // side walls with the retro grid
  for (const s of [-1, 1]) for (const M of [O, R]) M.quad([s * 4.9, -9, 0], [s * 4.9, MASK_Y, 0], [s * 4.9, MASK_Y, CEIL], [s * 4.9, -9, CEIL], s < 0 ? [1.0, 0.25, 0.85] : [0.2, 0.8, 1.0], MAT.GRID);
  // floor behind the approach + seating
  O.quad([-5, -9, -0.01], [5, -9, -0.01], [5, -5, -0.01], [-5, -5, -0.01], [0.12, 0.06, 0.2], MAT.FLOOR);
  for (let k = 0; k < 5; k++) { const x = -3.7 + k * PITCH; blob(O, [x, -6.6, 0.25], 0.7, 0.35, 0.25, [0.35, 0.08, 0.3], MAT.GLOSS, 10, 5); blob(O, [x, -7.0, 0.6], 0.7, 0.12, 0.45, [0.35, 0.08, 0.3], MAT.GLOSS, 10, 5); }
  // haze glows near the deck and the ceiling tubes
  A.sprite(0, HEAD_Y + 0.6, 1.4, 1.8, 0.16, 0.12, 0.2);
  for (const cx of LANES) A.sprite(cx, HEAD_Y + 0.4, 1.1, 1.3, 0.05, 0.04, 0.07);
}
function putPinStatic(O, R, pin, x, y) {
  for (const [M, zs] of [[O, 1], [R, -1]]) for (let i = 0; i < pin.n; i++) { const o = i * 4; M.v(x + pin.pos[o], y + pin.pos[o + 1], pin.pos[o + 2] * zs, 1, pin.col[o], pin.col[o + 1], pin.col[o + 2], pin.col[o + 3]); }
}
