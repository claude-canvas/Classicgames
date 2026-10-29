// Forest Rally — textured glTF 2.0 binary (.glb) loader for the Space.js renderer (DESIGN.md §3).
// Flattens the scene graph into world-space triangles grouped by material. Per vertex: position (Z-up), normal, UV
// (with KHR_texture_transform applied) and colour (baseColorFactor × COLOR_0). Embedded PNG/JPEG textures are decoded
// to canvases resized to powers of two, so WebGL 1 can mipmap and repeat them.
// glTF is Y-up; the game is Z-up: (x, y, z) → (x, −z, y).

const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function mat4mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0], [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0, 2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
const pot = (v) => Math.min(2048, 1 << Math.ceil(Math.log2(Math.max(1, v))));

// returns { groups: [{ mat: {name, alphaMode, doubleSided, image, tt}, pos: Float32Array(x,y,z) , nrm, uv, col: Float32Array(r,g,b,a), n }], images: [canvas], min, max }
export async function loadTexturedGLB(url, onProgress = () => { }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get("content-length") || 0;
  let buf;
  if (total && res.body) { const r = res.body.getReader(), parts = []; let got = 0; for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); got += value.length; onProgress(got / total * 0.6); } buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; } buf = buf.buffer; }
  else buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${url} is not a .glb file`);
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len))); else if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, len); off += 8 + len; }
  const unsupported = (json.extensionsRequired || []).filter((e) => e !== "KHR_texture_transform");
  if (unsupported.length) throw new Error(`${url} requires ${unsupported.join(", ")}`);
  const bdv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const accessor = (ai) => {
    const a = json.accessors[ai], n = NC[a.type], out = new Float32Array(a.count * n), bv = json.bufferViews[a.bufferView], es = SIZE[a.componentType];
    const stride = bv.byteStride || es * n, start = (bv.byteOffset || 0) + (a.byteOffset || 0), norm = a.normalized ? NORM[a.componentType] : 1, ct = a.componentType;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const o = start + i * stride + k * es;
      const v = ct === 5126 ? bdv.getFloat32(o, true) : ct === 5125 ? bdv.getUint32(o, true) : ct === 5123 ? bdv.getUint16(o, true) : ct === 5122 ? bdv.getInt16(o, true) : ct === 5121 ? bdv.getUint8(o) : bdv.getInt8(o);
      out[i * n + k] = v / norm;
    }
    return { d: out, n };
  };
  // images → power-of-two canvases
  const images = [];
  for (let i = 0; i < (json.images || []).length; i++) {
    const im = json.images[i];
    try {
      const bv = json.bufferViews[im.bufferView], bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const bmp = await createImageBitmap(new Blob([bytes], { type: im.mimeType || "image/png" }));
      const c = document.createElement("canvas"); c.width = pot(bmp.width); c.height = pot(bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); images.push(c);
    } catch (e) { console.warn("texture", i, "not decoded", e); images.push(null); }
    onProgress(0.6 + (i / json.images.length) * 0.3);
  }
  const mats = (json.materials || []).map((m) => {
    const t = m.pbrMetallicRoughness?.baseColorTexture, tt = t?.extensions?.KHR_texture_transform;
    return { name: m.name || "", alphaMode: m.alphaMode || "OPAQUE", cutoff: m.alphaCutoff ?? 0.5, doubleSided: !!m.doubleSided, factor: m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1], image: t ? json.textures[t.index].source : null, tt: tt ? { off: tt.offset || [0, 0], sc: tt.scale || [1, 1], rot: tt.rotation || 0 } : null };
  });
  const G = new Map();
  const group = (mi) => { if (!G.has(mi)) G.set(mi, { mat: mats[mi] || { name: "default", alphaMode: "OPAQUE", factor: [0.8, 0.8, 0.8, 1], image: null, tt: null }, pos: [], nrm: [], uv: [], col: [] }); return G.get(mi); };
  const walk = (ni, parent) => {
    const node = json.nodes[ni], M = mat4mul(parent, trs(node));
    if (node.mesh !== undefined) for (const pr of json.meshes[node.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const g = group(pr.material ?? -1), m = g.mat, f = m.factor;
      const P = accessor(pr.attributes.POSITION).d, N = pr.attributes.NORMAL !== undefined ? accessor(pr.attributes.NORMAL).d : null;
      const UV = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0).d : null, C = pr.attributes.COLOR_0 !== undefined ? accessor(pr.attributes.COLOR_0) : null;
      const idx = pr.indices !== undefined ? accessor(pr.indices).d : null, count = idx ? idx.length : P.length / 3;
      // normal matrix ≈ upper 3×3 (uniform scales in this kind of scene); renormalised per vertex
      for (let t = 0; t < count; t++) {
        const i = idx ? idx[t] : t, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        g.pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], -(M[2] * x + M[6] * y + M[10] * z + M[14]), M[1] * x + M[5] * y + M[9] * z + M[13]);
        if (N) { const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]; const nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c, l = Math.hypot(nx, ny, nz) || 1; g.nrm.push(nx / l, -nz / l, ny / l); } else g.nrm.push(0, 0, 0);
        let u = UV ? UV[i * 2] : 0, v = UV ? UV[i * 2 + 1] : 0;
        if (m.tt) { const c = Math.cos(m.tt.rot), s = Math.sin(m.tt.rot); const su = u * m.tt.sc[0], sv = v * m.tt.sc[1]; u = c * su + s * sv + m.tt.off[0]; v = -s * su + c * sv + m.tt.off[1]; }
        g.uv.push(u, v);
        let r = f[0], gg = f[1], b = f[2], al = f[3];
        if (C) { const n = C.n, d = C.d; r *= d[i * n]; gg *= d[i * n + 1]; b *= d[i * n + 2]; if (n === 4) al *= d[i * n + 3]; }
        g.col.push(r, gg, b, al);
      }
    }
    for (const c of node.children || []) walk(c, M);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of (json.scenes?.[json.scene || 0]?.nodes) || json.nodes.map((_, i) => i)) walk(ni, I);
  const groups = [...G.values()].map((g) => ({ mat: g.mat, pos: new Float32Array(g.pos), nrm: new Float32Array(g.nrm), uv: new Float32Array(g.uv), col: new Float32Array(g.col), n: g.pos.length / 3 }));
  onProgress(1);
  return { groups, images };
}
