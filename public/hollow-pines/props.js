// The Hollow Pines — the shrines, their offerings and the holy cross (DESIGN.md §1). Static meshes in world space,
// built with mesh.js in Space's vertex format (col.a = material: 0 lit, 1 soft).
import { Mesh, blob, limb, smoothNormals, mulberry32 } from "./mesh.js";

const TAU = Math.PI * 2;
const STONE = [0.36, 0.37, 0.38], MOSS = [0.22, 0.28, 0.16], WOOD = [0.28, 0.2, 0.13], WAX = [0.86, 0.82, 0.7], RAG = [0.55, 0.48, 0.4], DARKWOOD = [0.2, 0.13, 0.08], BRASS = [0.75, 0.6, 0.3];

function box(m, c, hx, hy, hz, col, mat = 0, rz = 0) {
  const cs = Math.cos(rz), sn = Math.sin(rz), P = (a, b, d) => [c[0] + a * hx * cs - b * hy * sn, c[1] + a * hx * sn + b * hy * cs, c[2] + d * hz];
  m.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), col, mat); m.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), col, mat);
  m.quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), col, mat); m.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), col, mat);
  m.quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), col, mat);
}
// the cross: dark wood with brass ends, built upright around (x, y, z) at its foot
export function crossInto(m, x, y, z, s = 1, rz = 0) {
  const cs = Math.cos(rz), sn = Math.sin(rz), R = (a, b, d) => [x + (a * cs - b * sn) * s, y + (a * sn + b * cs) * s, z + d * s];
  box(m, R(0, 0, 0.28), 0.022 * s, 0.018 * s, 0.28 * s, DARKWOOD, 0, rz);
  box(m, R(0, 0, 0.4), 0.15 * s, 0.018 * s, 0.022 * s, DARKWOOD, 0, rz);
  for (const p of [R(0, 0, 0.57), R(-0.16, 0, 0.4), R(0.16, 0, 0.4)]) blob(m, p, 0.022 * s, 0.022 * s, 0.022 * s, BRASS, 1, 6, 4);
}
// a shrine: a cairn of mossy stones, a weathered post, candles (positions returned for the flames), and an offering
export function buildShrine(x, y, z, seed, offering) {
  const m = new Mesh(12000), r = mulberry32(seed), flames = [];
  // the cairn
  let h = z;
  for (let i = 0; i < 5; i++) { const s = 0.28 - i * 0.045, ox = (r() - 0.5) * 0.05, oy = (r() - 0.5) * 0.05; blob(m, [x + ox, y + oy, h + s * 0.45], s, s * (0.8 + r() * 0.3), s * 0.5, i < 2 ? MOSS : STONE, 0, 10, 6, () => 0.85 + r() * 0.25); h += s * 0.85; }
  // the post with a crossbar shelf
  const px = x + 0.42, py = y + 0.05;
  limb(m, [px, py, z - 0.05], [px + 0.02, py, z + 1.25], 0.05, 0.04, WOOD, 0, 6);
  box(m, [px, py, z + 0.95], 0.2, 0.06, 0.018, WOOD);
  // candles: on the cairn top and the shelf
  for (const [cx, cy, cz, hh] of [[x - 0.05, y + 0.04, h, 0.11], [x + 0.07, y - 0.05, h - 0.05, 0.07], [px - 0.12, py, z + 0.97, 0.09], [px + 0.11, py, z + 0.97, 0.06], [x + 0.25, y - 0.22, z, 0.05]]) {
    limb(m, [cx, cy, cz], [cx, cy, cz + hh], 0.018, 0.017, WAX, 1, 8);
    blob(m, [cx, cy, cz + hh * 0.98], 0.019, 0.019, 0.006, [0.75, 0.68, 0.55], 1, 8, 3);
    flames.push([cx, cy, cz + hh + 0.022]);
  }
  // the offering
  let cross = null;
  if (offering === "cross") { cross = [x, y, h]; crossInto(m, x, y, h - 0.02, 1, 0.4); }
  else if (offering === "doll") {
    // a rag doll hanging by the neck from the shelf
    const hx = px + 0.02, hy = py, top = z + 0.95;
    limb(m, [hx, hy, top], [hx, hy, top - 0.22], 0.004, 0.004, [0.6, 0.55, 0.45], 0, 3);
    blob(m, [hx, hy, top - 0.27], 0.05, 0.045, 0.055, RAG, 1, 10, 7);
    blob(m, [hx - 0.018, hy + 0.04, top - 0.26], 0.008, 0.004, 0.008, [0.02, 0.02, 0.02], 1, 4, 3); blob(m, [hx + 0.018, hy + 0.04, top - 0.26], 0.008, 0.004, 0.008, [0.02, 0.02, 0.02], 1, 4, 3);
    limb(m, [hx, hy, top - 0.32], [hx, hy, top - 0.48], 0.035, 0.03, [0.5, 0.25, 0.25], 1, 6);
    for (const s of [-1, 1]) { limb(m, [hx + s * 0.03, hy, top - 0.34], [hx + s * 0.06, hy + 0.01, top - 0.46], 0.012, 0.01, RAG, 1, 4); limb(m, [hx + s * 0.015, hy, top - 0.48], [hx + s * 0.02, hy, top - 0.62], 0.013, 0.011, RAG, 1, 4); }
  } else if (offering === "shoe") {
    // a small child's shoe, muddy, laid at the foot of the cairn
    blob(m, [x - 0.3, y - 0.15, z + 0.03], 0.045, 0.085, 0.035, [0.45, 0.12, 0.1], 0, 10, 6);
    blob(m, [x - 0.3, y - 0.12, z + 0.06], 0.03, 0.03, 0.02, [0.08, 0.05, 0.04], 0, 8, 4);
  } else if (offering === "bones") {
    // a bird's ribcage and skull in a ring of stones
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; blob(m, [x - 0.32 + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, z + 0.02], 0.03, 0.03, 0.02, STONE, 0, 6, 4); }
    blob(m, [x - 0.32, y, z + 0.035], 0.03, 0.045, 0.028, [0.85, 0.82, 0.74], 0, 8, 5);
    for (let i = 0; i < 4; i++) limb(m, [x - 0.36 + i * 0.025, y - 0.06, z + 0.02], [x - 0.36 + i * 0.025, y + 0.04, z + 0.06], 0.004, 0.004, [0.85, 0.82, 0.74], 0, 3);
  } else if (offering === "wreath") {
    // a wreath of black twigs hung on the post
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU, b = a + 0.5; limb(m, [px + Math.cos(a) * 0.13, py - 0.06, z + 0.62 + Math.sin(a) * 0.13], [px + Math.cos(b) * 0.14, py - 0.06, z + 0.62 + Math.sin(b) * 0.14], 0.008, 0.005, [0.1, 0.08, 0.06], 0, 3); }
  }
  return { m, nrm: smoothNormals(m.pos, m.n), flames, cross };
}
// the cross in your hand (camera frame: x right, y forward, z up)
export function buildHeldCross() { const m = new Mesh(4000); crossInto(m, 0, 0, 0, 0.42); limb(m, [0.0, -0.02, 0.04], [0.06, -0.07, -0.12], 0.035, 0.04, [0.62, 0.48, 0.4], 1, 8); blob(m, [0.0, -0.01, 0.07], 0.04, 0.035, 0.045, [0.68, 0.53, 0.44], 1, 8, 6); return { m, nrm: smoothNormals(m.pos, m.n) }; }
