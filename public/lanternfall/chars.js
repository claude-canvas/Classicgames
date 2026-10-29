// Lanternfall characters (DESIGN.md §3): round chibi "blob" figures. Rigid parts (body, head, hair, hats) are built
// once per character and posed every frame with 3×4 matrices; limbs are short capsules rebuilt per frame.
// Local frame: feet at z = 0, facing +y, x to the right. A character instance: {spec, x, y, z, face (world yaw of
// +y), anim{...}}. drawChar(M, ch, time) writes world-space triangles into mesh M and returns attachment points.
import { Mesh, MAT, blob, limb, tube, clamp, lerp } from "./mesh.js";

const TAU = Math.PI * 2;
// ------------------------------------------------------------------ matrices (3×4 row-major)
export const MX = {
  mul: (A, B) => [A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  S: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0],
  X: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Y: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Z: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
  ap: (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]],
};
const chain = (...ms) => ms.reduce((a, b) => MX.mul(a, b));
function emit(D, F, m, col = null, matOverride = -1) {
  for (let i = 0; i < m.n; i++) {
    const o = i * 4, x = m.pos[o], y = m.pos[o + 1], z = m.pos[o + 2];
    D.v(F[0] * x + F[1] * y + F[2] * z + F[3], F[4] * x + F[5] * y + F[6] * z + F[7], F[8] * x + F[9] * y + F[10] * z + F[11], 1,
      col ? col[0] : m.col[o], col ? col[1] : m.col[o + 1], col ? col[2] : m.col[o + 2], matOverride >= 0 ? matOverride : m.col[o + 3]);
  }
}
const SPHERE = new Mesh(800); blob(SPHERE, [0, 0, 0], 1, 1, 1, [1, 1, 1], MAT.SOFT, 10, 6);
const SPHERE_LO = new Mesh(300); blob(SPHERE_LO, [0, 0, 0], 1, 1, 1, [1, 1, 1], MAT.SOFT, 6, 4);

// ------------------------------------------------------------------ the cast
export const CAST = {
  mira: { name: "Mira", skin: [1, 0.82, 0.7], hair: { style: "braid", col: [0.62, 0.24, 0.12] }, hat: null, coat: [0.24, 0.5, 0.34], coat2: [0.18, 0.38, 0.26], belt: [0.4, 0.25, 0.14], legs: [0.36, 0.28, 0.22], boots: [0.32, 0.2, 0.12], cloak: [0.3, 0.55, 0.38], weapon: "lantern", voice: 1.25, eye: [0.2, 0.45, 0.3] },
  bram: { name: "Bram", skin: [0.98, 0.8, 0.68], hair: { style: "short", col: [0.92, 0.92, 0.9] }, hat: { style: "wizard", col: [0.22, 0.3, 0.6] }, beard: [0.95, 0.95, 0.93], coat: [0.25, 0.34, 0.66], coat2: [0.2, 0.26, 0.52], belt: [0.75, 0.6, 0.25], legs: [0.3, 0.3, 0.4], boots: [0.25, 0.18, 0.12], skirt: 1, weapon: "staff", voice: 0.72, eye: [0.25, 0.3, 0.4] },
  sela: { name: "Sela", skin: [0.55, 0.36, 0.26], hair: { style: "bun", col: [0.1, 0.07, 0.06] }, hat: { style: "scarf", col: [0.95, 0.93, 0.88] }, coat: [0.2, 0.56, 0.6], coat2: [0.95, 0.92, 0.86], belt: [0.6, 0.35, 0.2], legs: [0.3, 0.3, 0.36], boots: [0.3, 0.2, 0.14], skirt: 1, voice: 1.1, eye: [0.2, 0.12, 0.08] },
  rook: { name: "Captain Rook", skin: [0.94, 0.76, 0.62], hair: { style: "short", col: [0.18, 0.12, 0.08] }, hat: { style: "helmet", col: [0.62, 0.64, 0.68] }, beard: [0.25, 0.16, 0.1], coat: [0.62, 0.14, 0.14], coat2: [0.55, 0.57, 0.6], belt: [0.25, 0.18, 0.12], legs: [0.3, 0.28, 0.3], boots: [0.2, 0.15, 0.12], weapon: "sword", voice: 0.85, eye: [0.3, 0.25, 0.2] },
  hob: { name: "Hob", skin: [0.98, 0.78, 0.66], hair: { style: "bald", col: [0.5, 0.35, 0.2] }, hat: { style: "baker", col: [0.97, 0.97, 0.95] }, coat: [0.95, 0.94, 0.9], coat2: [0.85, 0.55, 0.35], belt: [0.85, 0.55, 0.35], legs: [0.4, 0.32, 0.25], boots: [0.3, 0.2, 0.12], wide: 1.25, voice: 0.8, eye: [0.3, 0.2, 0.1] },
  lila: { name: "Lila", skin: [1, 0.84, 0.74], hair: { style: "pigtails", col: [0.95, 0.78, 0.35] }, hat: null, coat: [0.95, 0.5, 0.6], coat2: [0.98, 0.9, 0.9], belt: [0.95, 0.5, 0.6], legs: [0.95, 0.95, 0.92], boots: [0.7, 0.25, 0.3], scale: 0.78, skirt: 1, voice: 1.5, eye: [0.25, 0.4, 0.7] },
  oswin: { name: "Oswin", skin: [0.9, 0.74, 0.62], hair: { style: "short", col: [0.6, 0.6, 0.6] }, hat: { style: "widebrim", col: [0.25, 0.22, 0.18] }, beard: [0.62, 0.62, 0.6], coat: [0.85, 0.72, 0.25], coat2: [0.7, 0.58, 0.2], belt: [0.25, 0.2, 0.15], legs: [0.25, 0.25, 0.3], boots: [0.15, 0.15, 0.17], skirt: 1, weapon: "pole", voice: 0.75, eye: [0.25, 0.25, 0.3] },
  aldric: { name: "Aldric", skin: [0.9, 0.74, 0.64], hair: { style: "long", col: [0.16, 0.11, 0.08] }, hat: null, coat: [0.22, 0.22, 0.26], coat2: [0.35, 0.36, 0.4], belt: [0.25, 0.18, 0.12], legs: [0.2, 0.2, 0.24], boots: [0.15, 0.13, 0.12], cloak: [0.3, 0.08, 0.1], weapon: "sword", voice: 0.9, eye: [0.3, 0.25, 0.2] },
  morrow: { name: "Morrow", skin: [0.2, 0.18, 0.22], hair: null, hat: { style: "knight", col: [0.16, 0.15, 0.2] }, coat: [0.15, 0.14, 0.18], coat2: [0.24, 0.22, 0.28], belt: [0.35, 0.1, 0.4], legs: [0.12, 0.11, 0.14], boots: [0.1, 0.1, 0.12], cloak: [0.18, 0.04, 0.12], weapon: "darksword", scale: 1.25, metal: 1, voice: 0.6, glow: [1.4, 0.3, 1.6] },
  vesper: { name: "Vesper", skin: [0.8, 0.78, 0.86], hair: { style: "long", col: [0.1, 0.08, 0.12] }, hat: { style: "crown", col: [0.08, 0.06, 0.1] }, coat: [0.12, 0.08, 0.16], coat2: [0.2, 0.1, 0.26], belt: [0.6, 0.2, 0.7], legs: [0.1, 0.08, 0.12], boots: [0.08, 0.06, 0.1], cloak: [0.25, 0.05, 0.3], skirt: 1, scale: 1.45, weapon: "voidstaff", voice: 0.55, glow: [1.6, 0.4, 2.0], eye: [0.7, 0.2, 0.9] },
  shade: { name: "Shade", shadow: 1, coat: [0.1, 0.08, 0.14], coat2: [0.08, 0.06, 0.1], legs: [0.06, 0.05, 0.08], boots: [0.06, 0.05, 0.08], skin: [0.08, 0.06, 0.1], belt: [0.08, 0.06, 0.1], glow: [1.5, 0.4, 1.8], claws: 1, scale: 1.1, voice: 0.5 },
  brute: { name: "Brute", shadow: 1, coat: [0.12, 0.06, 0.1], coat2: [0.1, 0.05, 0.08], legs: [0.07, 0.05, 0.07], boots: [0.07, 0.05, 0.07], skin: [0.08, 0.05, 0.08], belt: [0.08, 0.05, 0.08], glow: [1.9, 0.35, 0.5], claws: 1, scale: 1.75, wide: 1.5, voice: 0.4 },
  tobi: { name: "Tobi", fox: 1, voice: 1.6 },
};

// ------------------------------------------------------------------ build cached parts
function buildParts(spec) {
  const body = new Mesh(5000), head = new Mesh(9000), blink = new Mesh(9000), cloak = new Mesh(1500);
  const S = spec.shadow ? MAT.DARK : MAT.SOFT, W = spec.wide || 1, metal = spec.metal ? MAT.METAL : S;
  // body: pear torso, a trim skirt, belt, buttons (local to the hip pivot at z = 0.5)
  blob(body, [0, 0, 0.27], 0.25 * W, 0.2 * W, 0.3, spec.coat, metal, 17, 11);
  if (spec.skirt) tube(body, 0, 0, 12, 0.27 * W, 0.12, 0.42 * W, -0.48, spec.coat2, S, 0, false);
  else blob(body, [0, 0, 0.06], 0.27 * W, 0.22 * W, 0.13, spec.coat2, S, 17, 8);
  if (!spec.shadow) {
    blob(body, [0, 0, 0.1], 0.265 * W, 0.215 * W, 0.04, spec.belt, S, 17, 6);
    blob(body, [0, 0.21 * W, 0.1], 0.045, 0.02, 0.035, [0.85, 0.7, 0.3], MAT.METAL, 8, 5);
    for (const z of [0.24, 0.36]) blob(body, [0, 0.195 * W, z], 0.022, 0.012, 0.022, spec.coat2, S, 8, 5);
    blob(body, [0, 0, 0.53], 0.16, 0.14, 0.06, spec.coat2, S, 12, 6);
  } else for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; blob(body, [Math.cos(a) * 0.22 * W, Math.sin(a) * 0.17 * W, 0.0], 0.09, 0.09, 0.2, spec.coat2, S, 8, 5); }
  if (spec.metal) for (const sx of [-1, 1]) blob(body, [sx * 0.27, 0, 0.5], 0.13, 0.12, 0.09, spec.coat2, MAT.METAL, 11, 6);
  if (spec.hat?.style === "helmet") for (const sx of [-1, 1]) blob(body, [sx * 0.25, 0, 0.49], 0.11, 0.1, 0.07, [0.6, 0.62, 0.66], MAT.METAL, 11, 6);
  // cloak: a curved sheet behind the shoulders (pivot at the shoulder line)
  if (spec.cloak) {
    const rows = 6, cols = 8, P = [];
    for (let j = 0; j <= rows; j++) { const v = j / rows, row = []; for (let i = 0; i <= cols; i++) { const u = i / cols - 0.5, w = lerp(0.26, 0.42, v) * W, a = u * 2.2; row.push([Math.sin(a) * w, -Math.cos(a) * w * 0.55 - 0.08 - v * 0.08, -v * (spec.scale > 1.3 ? 1.0 : 0.82)]); } P.push(row); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cloak.quad(P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i], spec.cloak, S);
  }
  // head (local to the neck pivot): big round face, hair, hats, eyes
  const face = (m, open) => {
    if (spec.shadow) {
      blob(m, [0, 0, 0.2], 0.22 * W, 0.21 * W, 0.22, spec.skin, S, 16, 11);
      for (const ex of [-0.08, 0.08]) blob(m, [ex * W, 0.19 * W, 0.22], 0.045, 0.02, open ? 0.025 : 0.008, spec.glow, MAT.EMIT, 8, 5);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI - Math.PI; limb(m, [Math.cos(a) * 0.12, Math.sin(a) * 0.12 - 0.05, 0.3], [Math.cos(a) * 0.3, Math.sin(a) * 0.25 - 0.18, 0.55 + (k % 2) * 0.1], 0.06, 0.005, spec.coat, S, 5); }
      return;
    }
    if (spec.hat?.style === "knight") {
      blob(m, [0, 0, 0.24], 0.27, 0.27, 0.28, spec.hat.col, MAT.METAL, 17, 11);
      blob(m, [0, 0.05, 0.12], 0.22, 0.25, 0.12, spec.hat.col, MAT.METAL, 16, 8);
      blob(m, [0, 0.255, 0.27], 0.17, 0.025, 0.02, spec.glow, MAT.EMIT, 11, 5);
      for (let k = 0; k < 5; k++) limb(m, [0, -0.05 + k * 0.05, 0.5], [0, -0.12 + k * 0.06, 0.62 + Math.sin(k) * 0.03], 0.025, 0.004, [0.35, 0.05, 0.2], S, 4);
      return;
    }
    blob(m, [0, 0, 0.27], 0.29, 0.28, 0.28, spec.skin, S, 23, 16);
    for (const ex of [-0.105, 0.105]) {
      blob(m, [ex, 0.255, 0.27], 0.05, 0.025, open ? 0.06 : 0.008, spec.glow ? spec.eye : [0.07, 0.06, 0.08], spec.glow ? MAT.EMIT : S, 12, 8);
      if (open && !spec.glow) { blob(m, [ex, 0.268, 0.26], 0.032, 0.015, 0.038, spec.eye || [0.2, 0.3, 0.4], S, 11, 6); blob(m, [ex + 0.015, 0.28, 0.29], 0.014, 0.008, 0.014, [2, 2, 2], MAT.EMIT, 8, 5); }
      blob(m, [ex * 1.5, 0.235, 0.19], 0.05, 0.02, 0.032, [1, 0.55, 0.55], S, 8, 5);
      if (!spec.glow) blob(m, [ex * 1.05, 0.25, 0.355], 0.05, 0.015, 0.012, spec.hair ? spec.hair.col.map((v) => v * 0.8) : [0.3, 0.2, 0.1], S, 8, 5);
    }
    blob(m, [0, 0.278, 0.215], 0.025, 0.02, 0.018, spec.skin.map((v) => v * 0.92), S, 8, 5);
    blob(m, [0, 0.27, 0.15], 0.035, 0.012, 0.01, [0.55, 0.18, 0.2], S, 8, 5);
    for (const sx of [-1, 1]) blob(m, [sx * 0.285, 0.0, 0.27], 0.04, 0.05, 0.065, spec.skin, S, 8, 5);
    const H = spec.hair;
    if (H && H.style !== "bald") {
      blob(m, [0, -0.04, 0.34], 0.305, 0.3, 0.27, H.col, S, 22, 14, (i, j) => (j > 7 ? 0.0001 : 1));
      blob(m, [0, -0.08, 0.25], 0.3, 0.26, 0.27, H.col, S, 19, 12);
      for (const sx of [-1, 1]) blob(m, [sx * 0.2, 0.16, 0.44], 0.12, 0.08, 0.07, H.col, S, 11, 6);
      if (H.style === "braid") { blob(m, [0, 0.2, 0.47], 0.17, 0.09, 0.06, H.col, S, 11, 6); for (let k = 0; k < 6; k++) blob(m, [0.02 * Math.sin(k), -0.3 - k * 0.025, 0.2 - k * 0.09], 0.06 - k * 0.004, 0.06 - k * 0.004, 0.06, H.col, S, 11, 6); blob(m, [0, -0.43, -0.34], 0.035, 0.035, 0.035, [0.3, 0.6, 0.4], S, 8, 5); }
      if (H.style === "bun") blob(m, [0, -0.15, 0.55], 0.13, 0.13, 0.11, H.col, S, 12, 8);
      if (H.style === "long") blob(m, [0, -0.18, 0.05], 0.27, 0.13, 0.32, H.col, S, 16, 9);
      if (H.style === "pigtails") for (const sx of [-1, 1]) { blob(m, [sx * 0.3, -0.05, 0.3], 0.07, 0.07, 0.07, [0.95, 0.4, 0.5], S, 8, 5); blob(m, [sx * 0.38, -0.05, 0.16], 0.09, 0.08, 0.17, H.col, S, 11, 8); }
    }
    if (spec.beard) { blob(m, [0, 0.17, 0.08], 0.2, 0.13, 0.15 + (spec.hair?.col[0] > 0.8 ? 0.1 : 0), spec.beard, S, 16, 9); blob(m, [0, 0.265, 0.17], 0.12, 0.03, 0.025, spec.beard, S, 11, 5); }
    const T = spec.hat;
    if (T) {
      if (T.style === "wizard") { tube(m, 0, -0.02, 18, 0.48, 0.47, 0.48, 0.5, T.col, S, 0); for (let k = 0; k < 6; k++) { const z0 = 0.5 + k * 0.1, r0 = 0.27 * (1 - k / 6.5), r1 = 0.27 * (1 - (k + 1) / 6.5); tube(m, -0.015 * k * k, -0.02 - 0.012 * k * k, 14, r0, z0, r1 || 0.01, z0 + 0.1, T.col, S, 0, false); } blob(m, [0, -0.02, 0.52], 0.3, 0.3, 0.035, [0.85, 0.7, 0.3], S, 17, 5); }
      if (T.style === "helmet") { blob(m, [0, -0.01, 0.38], 0.31, 0.3, 0.24, T.col, MAT.METAL, 22, 14, (i, j) => (j > 8 ? 0.0001 : 1)); blob(m, [0, -0.01, 0.38], 0.32, 0.31, 0.03, T.col.map((v) => v * 0.8), MAT.METAL, 19, 5); blob(m, [0, 0.3, 0.33], 0.025, 0.02, 0.08, T.col, MAT.METAL, 8, 5); for (let k = 0; k < 6; k++) blob(m, [0, -0.08 - k * 0.04, 0.62 - k * 0.02 + Math.sin(k) * 0.01], 0.04, 0.05, 0.05, [0.8, 0.15, 0.15], S, 8, 5); }
      if (T.style === "scarf") { blob(m, [0, -0.04, 0.33], 0.315, 0.31, 0.29, T.col, S, 22, 14, (i, j) => (j > 8 ? 0.0001 : 1)); blob(m, [0, -0.26, 0.15], 0.08, 0.06, 0.2, T.col, S, 11, 6); }
      if (T.style === "widebrim") { tube(m, 0, 0, 20, 0.55, 0.44, 0.55, 0.46, T.col, S, 0); tube(m, 0, 0, 16, 0.27, 0.46, 0.24, 0.66, T.col, S, 0); }
      if (T.style === "baker") { blob(m, [0, -0.02, 0.6], 0.3, 0.28, 0.2, T.col, S, 17, 11); tube(m, 0, -0.02, 16, 0.27, 0.42, 0.27, 0.55, T.col, S, 0, false); }
      if (T.style === "crown") { tube(m, 0, -0.01, 16, 0.27, 0.48, 0.27, 0.55, T.col, MAT.METAL, 0, false); for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; limb(m, [Math.cos(a) * 0.26, Math.sin(a) * 0.26 - 0.01, 0.52], [Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.78 + (k % 2) * 0.12], 0.04, 0.003, T.col, MAT.METAL, 4); } blob(m, [0, 0.26, 0.52], 0.035, 0.02, 0.035, spec.glow, MAT.EMIT, 8, 5); }
    }
  };
  face(head, true); face(blink, false);
  return { body, head, blink, cloak };
}
function buildFox() {
  const S = MAT.SOFT, O = [0.95, 0.5, 0.15], Wh = [0.98, 0.95, 0.9], Dk = [0.18, 0.12, 0.1];
  const body = new Mesh(4000), head = new Mesh(4000), blink = new Mesh(4000);
  blob(body, [0, 0, 0], 0.17, 0.3, 0.16, O, S, 17, 11);
  blob(body, [0, 0.2, -0.03], 0.12, 0.12, 0.12, Wh, S, 12, 8);
  const face = (m, open) => {
    blob(m, [0, 0, 0], 0.17, 0.16, 0.15, O, S, 17, 11);
    blob(m, [0, 0.16, -0.04], 0.07, 0.12, 0.06, Wh, S, 12, 8);
    blob(m, [0, 0.27, -0.02], 0.025, 0.02, 0.02, Dk, S, 8, 5);
    for (const sx of [-1, 1]) {
      limb(m, [sx * 0.09, -0.02, 0.1], [sx * 0.15, -0.04, 0.3], 0.06, 0.01, O, S, 6); limb(m, [sx * 0.095, 0.0, 0.11], [sx * 0.14, -0.02, 0.26], 0.03, 0.006, Dk, S, 5);
      blob(m, [sx * 0.07, 0.135, 0.03], 0.028, 0.015, open ? 0.032 : 0.006, Dk, S, 11, 6);
      if (open) blob(m, [sx * 0.07 + 0.008, 0.147, 0.045], 0.009, 0.005, 0.009, [2, 2, 2], MAT.EMIT, 8, 5);
      blob(m, [sx * 0.12, 0.08, -0.04], 0.05, 0.05, 0.04, Wh, S, 8, 5);
    }
  };
  face(head, true); face(blink, false);
  return { body, head, blink, fox: 1 };
}
const PARTS = {};
export function parts(id) { return PARTS[id] || (PARTS[id] = CAST[id].fox ? buildFox() : buildParts(CAST[id])); }

// ------------------------------------------------------------------ instances
export function makeChar(id, x, y, z, face = 0) {
  return { id, spec: CAST[id], x, y, z, face, vx: 0, vy: 0, speed: 0, phase: Math.random() * 6, blinkT: 2 + Math.random() * 3, blink: 0, act: null, talk: 0, look: null, t0: Math.random() * 10, hurt: 0, alpha: 1 };
}
// act: {kind: "attack"|"roll"|"cast"|"hurt"|"die"|"wave"|"cheer"|"kneel"|"slam"|"swipe", t, dur, step}
export function setAct(c, kind, dur, extra = {}) { c.act = { kind, t: 0, dur, ...extra }; }
export function stepChar(c, dt) {
  c.phase += dt * (2 + c.speed * 7.5);
  c.blinkT -= dt; if (c.blinkT < 0) { c.blink = 0.13; c.blinkT = 2 + Math.random() * 4; }
  c.blink = Math.max(0, c.blink - dt); c.hurt = Math.max(0, c.hurt - dt);
  if (c.act) { c.act.t += dt; if (c.act.t >= c.act.dur && c.act.kind !== "die" && c.act.kind !== "kneel") c.act = null; }
  if (c.talk > 0) c.talk -= dt;
}
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const TMP = new Mesh(4000);

// ------------------------------------------------------------------ GPU-skinned character meshes
// Every vertex of a character mesh carries pos.w = 1000 + bone; the vertex shader transforms it by uBone[bone]
// (3 rows of a 3×4 matrix). Bones (humanoid): 0 body, 1 head, 2 head (blinking), 3 cloak, 4 weapon,
// 5–14 joints (shoulder R, elbow R, hand R, shoulder L, elbow L, hand L, knee R, knee L, boot R, boot L),
// 15–22 limb capsules (upper arm R, forearm R, upper arm L, forearm L, thigh R, shin R, thigh L, shin L).
// Fox: 0 body, 1 head, 2 blink, 3–8 tail, 9–12 legs, 13–16 paws. A hidden bone is an all-zero matrix.
export const NBONE = 23;
function tag(m, from, bone) { for (let i = from; i < m.n; i++) m.pos[i * 4 + 3] = 1000 + bone; }
function addPart(dst, src, bone) { const from = dst.n; dst.append(src); tag(dst, from, bone); }
function unitBall(m, col, mat, bone, seg = 14, rings = 10) { const f = m.n; blob(m, [0, 0, 0], 1, 1, 1, col, mat, seg, rings); tag(m, f, bone); }
function unitCyl(m, col, mat, bone, seg = 12) { const f = m.n; for (let i = 0; i < seg; i++) { const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU; m.quad([Math.cos(a0), Math.sin(a0), 0], [Math.cos(a1), Math.sin(a1), 0], [Math.cos(a1), Math.sin(a1), 1], [Math.cos(a0), Math.sin(a0), 1], col, mat); } tag(m, f, bone); }
function weaponMesh(spec) {
  const m = new Mesh(2000), S = spec.shadow ? MAT.DARK : MAT.SOFT, w = spec.weapon, out = { m, tip: null };
  if (!w) return out;
  const len = w === "darksword" ? 1.5 : w === "sword" ? 1.0 : w === "pole" ? 2.2 : 1.45;
  const wcol = w === "voidstaff" ? [0.12, 0.08, 0.16] : [0.45, 0.3, 0.17];
  if (w.includes("sword")) { const dark = w === "darksword"; limb(m, [0, 0, -0.15], [0, 0, 0.12], 0.035, 0.035, [0.25, 0.15, 0.1], S, 6); m.quad([-0.16, -0.03, 0.12], [0.16, -0.03, 0.12], [0.16, 0.03, 0.12], [-0.16, 0.03, 0.12], [0.6, 0.5, 0.3], MAT.METAL); const bw = dark ? 0.08 : 0.055, bc = dark ? [0.15, 0.12, 0.2] : [0.82, 0.84, 0.88]; m.tri([-bw, 0, 0.14], [bw, 0, 0.14], [0, 0, len], bc, MAT.METAL); m.tri([bw, 0, 0.14], [-bw, 0, 0.14], [0, 0.002, len], bc, MAT.METAL); if (dark) m.tri([-0.015, 0.006, 0.2], [0.015, 0.006, 0.2], [0, 0.006, len * 0.95], spec.glow, MAT.EMIT); out.tip = [0, 0, len * 0.8]; }
  else {
    limb(m, [0, 0, -0.45], [0, 0, len - 0.45], 0.035, 0.03, wcol, MAT.WOOD, 6);
    const top = len - 0.45;
    if (w === "lantern" || w === "staff") { limb(m, [0, 0, top], [0, 0.12, top + 0.05], 0.025, 0.02, wcol, MAT.WOOD, 4); for (let q = 0; q < 4; q++) { const a = q * TAU / 4; limb(m, [Math.cos(a) * 0.07, 0.12 + Math.sin(a) * 0.07, top - 0.17], [Math.cos(a) * 0.07, 0.12 + Math.sin(a) * 0.07, top - 0.02], 0.01, 0.01, [0.25, 0.22, 0.2], MAT.METAL, 3); } blob(m, [0, 0.12, top - 0.1], 0.06, 0.06, 0.075, [2.4, 1.5, 0.6], MAT.EMIT, 8, 6); out.tip = [0, 0.12, top - 0.1]; }
    else if (w === "voidstaff") { for (let q = 0; q < 5; q++) { const a = q * TAU / 5; limb(m, [0, 0, top - 0.1], [Math.cos(a) * 0.15, Math.sin(a) * 0.15, top + 0.25], 0.025, 0.004, wcol, MAT.METAL, 3); } blob(m, [0, 0, top + 0.12], 0.09, 0.09, 0.09, spec.glow, MAT.EMIT, 10, 6); out.tip = [0, 0, top + 0.12]; }
    else out.tip = [0, 0, top];
  }
  return out;
}
const MESHES = {};
export function charMesh(id) {
  if (MESHES[id]) return MESHES[id];
  const spec = CAST[id], P = parts(id), m = new Mesh(30000), S = spec.shadow ? MAT.DARK : MAT.SOFT;
  if (spec.fox) {
    const O = [0.95, 0.5, 0.15], Dk = [0.18, 0.12, 0.1];
    addPart(m, P.body, 0); addPart(m, P.head, 1); addPart(m, P.blink, 2);
    for (let i = 0; i < 6; i++) unitBall(m, i === 5 ? [0.98, 0.95, 0.9] : O, S, 3 + i, 8, 5);
    for (let i = 0; i < 4; i++) unitCyl(m, O, S, 9 + i, 6);
    for (let i = 0; i < 4; i++) unitBall(m, Dk, S, 13 + i, 6, 4);
    return (MESHES[id] = { m, wpn: null });
  }
  addPart(m, P.body, 0); addPart(m, P.head, 1); addPart(m, P.blink, 2); if (P.cloak.n) addPart(m, P.cloak, 3);
  const W = weaponMesh(spec); if (W.m.n) addPart(m, W.m, 4);
  const hand = spec.metal || spec.shadow ? spec.coat2 : spec.skin;
  for (const [b, col] of [[5, spec.coat], [6, spec.coat], [7, hand], [8, spec.coat], [9, spec.coat], [10, hand], [11, spec.legs], [12, spec.legs], [13, spec.boots], [14, spec.boots]]) unitBall(m, col, b === 7 || b === 10 ? (spec.claws ? MAT.EMIT : S) : S, b);
  if (spec.claws) { /* glowing knuckles: recolour the hand balls */ for (let i = 0; i < m.n; i++) { const b = m.pos[i * 4 + 3] - 1000; if (b === 7 || b === 10) { m.col[i * 4] = spec.glow[0] * 0.35; m.col[i * 4 + 1] = spec.glow[1] * 0.35; m.col[i * 4 + 2] = spec.glow[2] * 0.35; } } }
  for (const [b, col] of [[15, spec.coat], [16, spec.coat], [17, spec.coat], [18, spec.coat], [19, spec.legs], [20, spec.legs], [21, spec.legs], [22, spec.legs]]) unitCyl(m, col, S, b);
  return (MESHES[id] = { m, wpn: W.tip });
}
// bone helpers (write 12 floats)
function setM(B, b, M) { B.set(M, b * 12); }
function zeroM(B, b) { B.fill(0, b * 12, b * 12 + 12); }
function ballM(B, b, root, p, sx, sy = sx, sz = sx) { setM(B, b, chain(root, MX.T(p[0], p[1], p[2]), MX.S(sx, sy, sz))); }
function capM(B, b, root, a, c, r) {
  const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1e-5, w = [d[0] / L, d[1] / L, d[2] / L];
  const up = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; let u = [up[1] * w[2] - up[2] * w[1], up[2] * w[0] - up[0] * w[2], up[0] * w[1] - up[1] * w[0]]; const ul = Math.hypot(...u); u = u.map((v) => v / ul); const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  setM(B, b, MX.mul(root, [u[0] * r, v[0] * r, d[0], a[0], u[1] * r, v[1] * r, d[1], a[1], u[2] * r, v[2] * r, d[2], a[2]]));
}
// pose a character: returns { B: bones, tip, hand, head } in world space
export function poseChar(c, time) {
  const spec = c.spec, sc = spec.scale || 1, B = c.B || (c.B = new Float32Array(NBONE * 12));
  const base = chain(MX.T(c.x, c.y, c.z), MX.Z(c.face - Math.PI / 2), MX.S(sc));
  if (spec.fox) return poseFox(c, time, base, B);
  const act = c.act, at = act ? act.t / act.dur : 0, k = act ? act.kind : "", spd = clamp(c.speed, 0, 1.4);
  const ph = c.phase, sw = Math.sin(ph), cw = Math.cos(ph);
  let bob = Math.abs(sw) * 0.05 * spd + Math.sin(time * 2.2 + c.t0) * 0.008, pitchB = 0.12 * spd, yawB = 0, rollB = 0, headP = Math.sin(time * 0.7 + c.t0) * 0.04, headY = Math.sin(time * 0.37 + c.t0) * 0.12, headR = 0;
  let hR = [0.33, 0.06 + sw * 0.2 * spd, 0.5 - Math.abs(sw) * 0.03], hL = [-0.33, 0.06 - sw * 0.2 * spd, 0.5 - Math.abs(sw) * 0.03];
  let fL = [-0.12, -sw * 0.24 * spd, Math.max(0, cw) * 0.12 * spd], fR = [0.12, sw * 0.24 * spd, Math.max(0, -cw) * 0.12 * spd];
  let wpn = { yaw: 0, pitch: -0.25 }, rootZ = 0, spin = 0, lift = 0, fall = 0;
  if (c.look) headY += clamp(c.look, -1, 1) * 0.6;
  if (c.talk > 0) { headP += Math.sin(time * 9) * 0.05; headR = Math.sin(time * 3) * 0.08; hR = [0.38, 0.22, 0.75 + Math.sin(time * 5) * 0.08]; }
  if (k === "attack" || k === "swipe") {
    const st = act.step || 0, u = ease(at * 1.6);
    if (spec.claws) { const s = st % 2 ? 1 : -1; if (s > 0) hR = [0.3, lerp(-0.1, 0.65, u), lerp(0.95, 0.4, u)]; else hL = [-0.3, lerp(-0.1, 0.65, u), lerp(0.95, 0.4, u)]; pitchB += 0.25 * u; }
    else if (st === 2) { wpn = { yaw: 0, pitch: lerp(1.4, -1.0, u) }; pitchB += lerp(-0.2, 0.35, u); hR = [0.12, lerp(0.05, 0.45, u), lerp(1.05, 0.55, u)]; hL = [-0.1, lerp(0.05, 0.4, u), lerp(1.0, 0.55, u)]; }
    else { const s = st === 0 ? 1 : -1; wpn = { yaw: s * lerp(1.4, -1.5, u), pitch: -1.35 }; yawB = s * lerp(0.6, -0.6, u); hR = [Math.sin(-wpn.yaw) * 0.42, 0.25 + Math.cos(wpn.yaw) * 0.2, 0.62]; hL = [-0.2, 0.3, 0.55]; pitchB += 0.1; }
  }
  if (k === "slam") { hR = [0.25, 0.3, lerp(0.6, 1.35, Math.min(1, at * 2.2)) - (at > 0.55 ? 0.95 : 0)]; hL = [-0.25, 0.3, hR[2]]; pitchB += at > 0.55 ? 0.5 : -0.2; }
  if (k === "cast" || k === "burst") { const u = Math.sin(clamp(at, 0, 1) * Math.PI); hR = [0.2, 0.35, 0.7 + u * 0.55]; hL = [-0.35, 0.3, 0.7 + u * 0.4]; wpn = { yaw: 0, pitch: 0.2 - u * 0.4 }; headP -= u * 0.2; }
  if (k === "roll") { spin = at * TAU; rootZ = -0.25 * Math.sin(at * Math.PI); hR = [0.2, 0.2, 0.4]; hL = [-0.2, 0.2, 0.4]; fL = [-0.1, 0.1, 0.3]; fR = [0.1, 0.1, 0.3]; }
  if (k === "hurt") { pitchB -= 0.35 * Math.sin(at * Math.PI); headP -= 0.3 * Math.sin(at * Math.PI); }
  if (k === "die") fall = ease(at * 1.2);
  if (k === "kneel") { const u = ease(at * 2); rootZ = -0.2 * u; pitchB += 0.35 * u; headP += 0.4 * u; fL = [-0.12, 0.25 * u, 0.0]; fR = [0.12, -0.15 * u, 0.0]; }
  if (k === "wave" || k === "cheer") { hR = [0.32, 0.1, 1.25 + Math.sin(time * 10) * 0.06]; if (k === "cheer") hL = [-0.32, 0.1, 1.25 + Math.cos(time * 10) * 0.06]; headP -= 0.15; if (k === "cheer") bob += Math.abs(Math.sin(time * 8)) * 0.05; }
  if (k === "lift") { lift = ease(at) * 1.6; spin = at * 3; }
  const hip = [0, 0, 0.5 + bob + rootZ + lift];
  let root = base;
  if (fall > 0) root = chain(base, MX.T(0, 0, 0.1), MX.X(-fall * 1.35), MX.T(0, 0, -0.1));
  if (spin) root = chain(root, MX.T(0, 0, 0.5), MX.X(spin), MX.T(0, 0, -0.5));
  const Lbody = chain(MX.T(...hip), MX.Z(yawB), MX.X(-pitchB), MX.Y(rollB));
  const Lhead = chain(Lbody, MX.T(0, 0.02, 0.55), MX.Z(headY), MX.X(-headP), MX.Y(headR));
  const Fb = MX.mul(root, Lbody), Fh = MX.mul(root, Lhead);
  setM(B, 0, Fb);
  if (c.blink > 0) { zeroM(B, 1); setM(B, 2, Fh); } else { setM(B, 1, Fh); zeroM(B, 2); }
  const sway = 0.1 + spd * 0.35 + Math.sin(time * 2.5 + c.t0) * 0.05; setM(B, 3, chain(Fb, MX.T(0, -0.02, 0.5), MX.X(sway)));
  const W = spec.wide || 1, lz = bob + rootZ + lift;
  const shoulder = (sx) => MX.ap(Lbody, [sx * 0.24 * W, 0, 0.42]);
  const arms = [[1, hR, 5, 15], [-1, hL, 8, 17]];
  for (const [sx, hd, jb, cb] of arms) {
    const sh = shoulder(sx), h2 = [hd[0] * W, hd[1], hd[2] + lz], el = [(sh[0] + h2[0]) / 2 + sx * 0.08, (sh[1] + h2[1]) / 2 - 0.05, (sh[2] + h2[2]) / 2 - 0.04];
    ballM(B, jb, root, sh, 0.09); ballM(B, jb + 1, root, el, 0.077); ballM(B, jb + 2, root, h2, spec.claws ? 0.1 : 0.075);
    capM(B, cb, root, sh, el, 0.08); capM(B, cb + 1, root, el, h2, 0.07);
  }
  const legs = !spec.skirt || k === "roll";
  for (const [sx, ft, kb, bb, cb] of [[1, fR, 11, 13, 19], [-1, fL, 12, 14, 21]]) {
    const hp = MX.ap(Lbody, [sx * 0.11 * W, 0, 0.02]), f2 = [ft[0] * W, ft[1], ft[2] + rootZ * 0.5 + lift + 0.06], kn = [(hp[0] + f2[0]) / 2, (hp[1] + f2[1]) / 2 + 0.08, (hp[2] + f2[2]) / 2];
    if (legs) { ballM(B, kb, root, kn, 0.08); capM(B, cb, root, hp, kn, 0.085); capM(B, cb + 1, root, kn, f2, 0.075); ballM(B, bb, root, [f2[0], f2[1] + 0.04, f2[2] - 0.02], 0.1, 0.15, 0.08); }
    else { zeroM(B, kb); zeroM(B, cb); zeroM(B, cb + 1); ballM(B, bb, root, [sx * 0.13, 0.12 + (sx > 0 ? sw : -sw) * 0.08 * spd, 0.05], 0.1, 0.14, 0.07); }
  }
  const out = { B, hand: MX.ap(root, [hR[0] * W, hR[1], hR[2] + lz]), tip: null, head: MX.ap(Fh, [0, 0, 0.3]) };
  if (spec.weapon && k !== "roll" && fall < 0.5) {
    const Wm = chain(root, MX.T(hR[0] * W, hR[1], hR[2] + lz), MX.Z(wpn.yaw), MX.X(wpn.pitch + Math.PI / 2 - 0.3));
    setM(B, 4, Wm); const tip = charMesh(c.id).wpn; if (tip) out.tip = MX.ap(Wm, tip);
  } else zeroM(B, 4);
  return out;
}
function poseFox(c, time, root, B) {
  const spd = clamp(c.speed, 0, 1.4), ph = c.phase, sw = Math.sin(ph), k = c.act?.kind, hop = k === "cheer" ? Math.abs(Math.sin(time * 9)) * 0.15 : 0;
  const bob = Math.abs(sw) * 0.04 * spd + hop;
  const Lb = chain(MX.T(0, 0, 0.36 + bob), MX.X(Math.sin(ph) * 0.05 * spd));
  setM(B, 0, MX.mul(root, Lb));
  const hy = Math.sin(time * 0.5 + c.t0) * 0.25 + (c.look || 0) * 0.5, hp = Math.sin(time * 0.9) * 0.05 + (c.talk > 0 ? Math.sin(time * 10) * 0.08 : 0), tilt = c.talk > 0 ? Math.sin(time * 3) * 0.15 : Math.sin(time * 0.6) * 0.1;
  const Fh = chain(root, Lb, MX.T(0, 0.3, 0.16), MX.Z(hy), MX.X(-hp), MX.Y(tilt));
  if (c.blink > 0) { zeroM(B, 1); setM(B, 2, Fh); } else { setM(B, 1, Fh); zeroM(B, 2); }
  for (let i = 0; i < 6; i++) { const t = (i + 1) / 6, a = Math.sin(time * 3 + i * 0.6) * 0.25 * t + (c.talk > 0 ? Math.sin(time * 12) * 0.2 * t : 0); const q = MX.ap(Lb, [Math.sin(a) * 0.3 * t, -0.28 - t * 0.38, 0.05 + Math.sin(t * 2.4) * 0.25]); const r = 0.09 * Math.sin(t * Math.PI * 0.9) + 0.04; ballM(B, 3 + i, root, q, r); }
  [[0.1, 0.18, 0], [-0.1, 0.18, Math.PI], [0.1, -0.18, Math.PI], [-0.1, -0.18, 0]].forEach(([lx, ly, phs], i) => {
    const top = MX.ap(Lb, [lx, ly, -0.05]), s2 = Math.sin(ph + phs), foot = [lx, ly + s2 * 0.12 * spd, Math.max(0, Math.cos(ph + phs)) * 0.07 * spd + 0.03 + hop];
    capM(B, 9 + i, root, top, foot, 0.045); ballM(B, 13 + i, root, foot, 0.05, 0.065, 0.04);
  });
  for (let b = 17; b < NBONE; b++) zeroM(B, b);
  return { B, hand: MX.ap(root, [0, 0.4, 0.5]), tip: null, head: MX.ap(root, [0, 0.4, 0.75]) };
}
// wisp: a floating shadow orb with spikes (drawn directly)
export function drawWisp(D, A, w, time) {
  const S = MAT.DARK, c = [w.x, w.y, w.z], r = 0.32 + Math.sin(time * 6 + w.t0) * 0.02, flash = w.hurt > 0 ? [2, 1.6, 1.8] : null;
  emit(D, chain(MX.T(...c), MX.S(r)), SPHERE, flash || [0.08, 0.05, 0.1], S);
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + time * 1.5 + w.t0, e = Math.sin(k * 1.7) * 0.6, d = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
    TMP.reset(); limb(TMP, [d[0] * r * 0.8, d[1] * r * 0.8, d[2] * r * 0.8], [d[0] * r * 1.7, d[1] * r * 1.7, d[2] * r * 1.7], 0.06, 0.004, [0.1, 0.06, 0.14], S, 4);
    emit(D, MX.T(...c), TMP, flash);
  }
  const fx = Math.cos(w.face), fy = Math.sin(w.face);
  for (const sx of [-1, 1]) emit(D, chain(MX.T(c[0] + fx * r * 0.85 - fy * sx * 0.1, c[1] + fy * r * 0.85 + fx * sx * 0.1, c[2] + 0.05), MX.S(0.05, 0.05, 0.035)), SPHERE_LO, [1.6, 0.5, 2.0], MAT.EMIT);
  A.sprite(c[0], c[1], c[2], 0.9, 0.12, 0.03, 0.18);
}
