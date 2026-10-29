// Wisp Siege island (DESIGN.md §2): grass and path tiles, rocks, the rocky underside, distant islets.
import { MAT, tube, blob, limb, mulberry32, vnoise, mixc } from "./mesh.js";
import { W, H, PATH_TILES, ROCKS, PATH } from "./game.js";

export const tw = (x, y) => [x - W / 2 + 0.5, y - H / 2 + 0.5];
export const HEART = tw(...PATH[PATH.length - 1]);

export function buildIsland(O, A) {
  const rnd = mulberry32(5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [cx, cy] = tw(x, y), path = PATH_TILES.has(x + "," + y), s = 0.49, z = path ? -0.04 : (vnoise(x * 0.7, y * 0.7, 2) - 0.5) * 0.06;
    if (path) {
      // cobbles
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const px = cx - 0.33 + i * 0.33, py = cy - 0.33 + j * 0.33, h = 0.13; O.quad([px - h, py - h, z], [px + h, py - h, z], [px + h, py + h, z], [px - h, py + h, z], mixc([0.5, 0.44, 0.4], [0.62, 0.55, 0.48], rnd()), MAT.MATTE); }
      O.quad([cx - 0.5, cy - 0.5, z - 0.03], [cx + 0.5, cy - 0.5, z - 0.03], [cx + 0.5, cy + 0.5, z - 0.03], [cx - 0.5, cy + 0.5, z - 0.03], [0.32, 0.18, 0.07], MAT.EMIT);
    } else {
      O.quad([cx - s, cy - s, z, 0], [cx + s, cy - s, z, 0], [cx + s, cy + s, z, 0], [cx - s, cy + s, z, 0], mixc([0.16, 0.34, 0.14], [0.22, 0.4, 0.16], rnd()), MAT.MOSS);
      if (rnd() < 0.3) for (let k = 0; k < 4; k++) { const gx = cx + (rnd() - 0.5) * 0.8, gy = cy + (rnd() - 0.5) * 0.8; limb(O, [gx, gy, z], [gx, gy, z + 0.1 + rnd() * 0.08], 0.012, 0.002, [0.3, 0.5, 0.2], MAT.MOSS, 3); }
      if (rnd() < 0.12) { const fx = cx + (rnd() - 0.5) * 0.7, fy = cy + (rnd() - 0.5) * 0.7, c = [[1, 0.5, 0.7], [0.6, 0.6, 1], [1, 0.9, 0.5]][Math.floor(rnd() * 3)]; A.sprite(fx, fy, z + 0.06, 0.04, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4); }
    }
    // island edge
    for (let d = 0; d < 4; d++) {
      const nx = x + [0, 1, 0, -1][d], ny = y + [1, 0, -1, 0][d]; if (nx >= 0 && ny >= 0 && nx < W && ny < H) continue;
      const ex = [0, 0.5, 0, -0.5][d], ey = [0.5, 0, -0.5, 0][d], tx = Math.abs(ey) > 0 ? 0.5 : 0, ty = Math.abs(ex) > 0 ? 0.5 : 0;
      O.quad([cx + ex - tx, cy + ey - ty, z], [cx + ex + tx, cy + ey + ty, z], [cx + ex * 1.15 + tx, cy + ey * 1.15 + ty, -0.8], [cx + ex * 1.15 - tx, cy + ey * 1.15 - ty, -0.8], [0.28, 0.24, 0.3], MAT.MATTE);
    }
  }
  for (const [x, y] of ROCKS) { const [cx, cy] = tw(x, y); blob(O, [cx, cy, 0.15], 0.4, 0.34, 0.32, [0.38, 0.36, 0.42], MAT.MATTE, 8, 5, (i, j) => 0.85 + 0.3 * vnoise(i * 1.3 + x, j + y, 3)); blob(O, [cx + 0.05, cy, 0.4], 0.28, 0.24, 0.08, [0.2, 0.36, 0.16], MAT.MOSS, 7, 3); }
  // underside
  const N = 30;
  for (let j = 0; j < 6; j++) for (let i = 0; i < N; i++) {
    const P = (ii, jj) => { const a = (ii / N) * Math.PI * 2, t = jj / 6, k = (1 - Math.pow(t, 0.8) * 0.9) * (0.88 + 0.24 * vnoise(Math.cos(a) * 2, Math.sin(a) * 2 + jj, 7)); return [Math.cos(a) * W * 0.6 * k, Math.sin(a) * H * 0.62 * k, -0.7 - t * 7]; };
    O.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), mixc([0.28, 0.23, 0.3], [0.17, 0.14, 0.2], j / 6), MAT.MATTE);
  }
  // heart plinth
  tube(O, HEART[0], HEART[1], 8, 0.45, -0.05, 0.38, 0.3, [0.5, 0.48, 0.55], MAT.MATTE);
  // distant islets
  for (let k = 0; k < 12; k++) { const a = rnd() * Math.PI * 2, d = 30 + rnd() * 60, x = Math.cos(a) * d, y = Math.sin(a) * d, z = -8 + rnd() * 16, s = 1 + rnd() * 3.5; blob(O, [x, y, z], s, s * 0.9, s * 0.25, [0.2, 0.3, 0.2], MAT.MOSS, 9, 4); tube(O, x, y, 9, s * 0.9, z - 0.2, 0, z - s * 2.2, [0.22, 0.2, 0.26], MAT.MATTE, rnd() * 6); }
}
