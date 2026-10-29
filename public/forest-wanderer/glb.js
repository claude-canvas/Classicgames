// Echoes of the Hollow — a small glTF 2.0 binary (.glb) reader for the Space.js renderer (DESIGN.md §4).
// Space.js draws vertex-coloured triangles, so each primitive is flattened to world-space triangles and its base
// colour (factor × texture sampled at each vertex's UV) is baked into the vertex colours. That suits low-poly models
// whose textures are colour palettes. glTF is Y-up; the game is Z-up, so (x, y, z) → (x, −z, y).
// Supported: triangle primitives, indexed or not, node TRS / matrix hierarchies, POSITION, NORMAL, TEXCOORD_0,
// COLOR_0, embedded or external PNG/JPEG base-colour textures. Not supported: Draco / meshopt compression, skins.

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function mat4mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0], [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0, 2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1];
}
async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob), c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
}

// returns { tris: Float32Array (x,y,z per vertex, Z-up), cols: Float32Array (r,g,b), nrms: Float32Array, n, min, max }
export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer(), dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${url} is not a .glb (glTF binary) file`);
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, len);
    off += 8 + len;
  }
  if (!json) throw new Error(`${url}: no JSON chunk`);
  if ((json.extensionsRequired || []).length) throw new Error(`${url} needs ${json.extensionsRequired.join(", ")} (export without compression)`);
  const base = new URL(url, location.href);
  const bufferData = await Promise.all((json.buffers || []).map(async (b, i) => (b.uri ? new Uint8Array(await (await fetch(new URL(b.uri, base))).arrayBuffer()) : i === 0 ? bin : null)));
  const view = (bvi) => { const bv = json.bufferViews[bvi], b = bufferData[bv.buffer || 0]; return { bytes: b, off: b.byteOffset + (bv.byteOffset || 0), stride: bv.byteStride || 0, len: bv.byteLength }; };
  const accessor = (ai) => {
    const a = json.accessors[ai], n = NC[a.type], T = CT[a.componentType], out = new Float32Array(a.count * n);
    if (a.bufferView === undefined) return { data: out, n };
    const v = view(a.bufferView), es = T.BYTES_PER_ELEMENT, stride = v.stride || es * n, start = v.off + (a.byteOffset || 0), d = new DataView(v.bytes.buffer);
    const rd = { 5126: (o) => d.getFloat32(o, true), 5125: (o) => d.getUint32(o, true), 5123: (o) => d.getUint16(o, true), 5122: (o) => d.getInt16(o, true), 5121: (o) => d.getUint8(o), 5120: (o) => d.getInt8(o) }[a.componentType];
    const norm = a.normalized ? NORM[a.componentType] : 1;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = rd(start + i * stride + k * es) / norm;
    return { data: out, n };
  };
  // textures (decoded once)
  const images = await Promise.all((json.images || []).map(async (im) => {
    try {
      if (im.bufferView !== undefined) { const v = view(im.bufferView); return await decodeImage(new Blob([v.bytes.slice(v.off - v.bytes.byteOffset, v.off - v.bytes.byteOffset + v.len)], { type: im.mimeType || "image/png" })); }
      if (im.uri) return await decodeImage(await (await fetch(new URL(im.uri, base))).blob());
    } catch (e) { console.warn("glb: texture not decoded", e); }
    return null;
  }));
  const sample = (img, u, v) => { let x = Math.floor((u - Math.floor(u)) * img.w), y = Math.floor((v - Math.floor(v)) * img.h); x = Math.min(img.w - 1, Math.max(0, x)); y = Math.min(img.h - 1, Math.max(0, y)); const o = (y * img.w + x) * 4; return [img.d[o] / 255, img.d[o + 1] / 255, img.d[o + 2] / 255]; };
  const tris = [], cols = [], nrms = [];
  const walk = (ni, parent) => {
    const node = json.nodes[ni], M = mat4mul(parent, trs(node));
    if (node.mesh !== undefined) for (const pr of json.meshes[node.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const P = accessor(pr.attributes.POSITION).data, N = pr.attributes.NORMAL !== undefined ? accessor(pr.attributes.NORMAL).data : null;
      const UV = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0).data : null, C0 = pr.attributes.COLOR_0 !== undefined ? accessor(pr.attributes.COLOR_0) : null;
      const mat = pr.material !== undefined ? json.materials[pr.material] : null, pbr = mat?.pbrMetallicRoughness || {}, fac = pbr.baseColorFactor || [1, 1, 1, 1];
      const tex = pbr.baseColorTexture ? images[json.textures[pbr.baseColorTexture.index].source] : null;
      const idx = pr.indices !== undefined ? accessor(pr.indices).data : null, count = idx ? idx.length : P.length / 3;
      for (let t = 0; t < count; t++) {
        const i = idx ? idx[t] : t, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const wx = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz = M[2] * x + M[6] * y + M[10] * z + M[14];
        tris.push(wx, -wz, wy);
        if (N) { const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]; let nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c; const l = Math.hypot(nx, ny, nz) || 1; nrms.push(nx / l, -nz / l, ny / l); } else nrms.push(0, 0, 0);
        let col = [fac[0], fac[1], fac[2]];
        if (tex && UV) { const s = sample(tex, UV[i * 2], UV[i * 2 + 1]); col = [col[0] * s[0], col[1] * s[1], col[2] * s[2]]; }
        if (C0) { const n = C0.n; col = [col[0] * C0.data[i * n], col[1] * C0.data[i * n + 1], col[2] * C0.data[i * n + 2]]; }
        cols.push(col[0], col[1], col[2]);
      }
    }
    for (const c of node.children || []) walk(c, M);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene || 0];
  for (const ni of scene ? scene.nodes : json.nodes.map((_, i) => i)) walk(ni, I);
  const n = tris.length / 3, min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], tris[i * 3 + k]); max[k] = Math.max(max[k], tris[i * 3 + k]); }
  return { tris: new Float32Array(tris), cols: new Float32Array(cols), nrms: new Float32Array(nrms), n, min, max };
}

// collision for an arbitrary environment model: per 0.5 m cell, the walkable surface heights (up-facing triangles)
// and the vertical extents of steep surfaces (walls, trunks, rocks). ground(x, y, z) picks the highest walkable
// surface not more than a step above z; blocked(x, y, feet) is true where a steep surface rises past knee height.
export function buildCollision(model, res = 0.5) {
  const { tris, n, min, max } = model, W = Math.ceil((max[0] - min[0]) / res) + 2, H = Math.ceil((max[1] - min[1]) / res) + 2;
  const walkL = Array.from({ length: W * H }, () => []), steepL = Array.from({ length: W * H }, () => []);
  for (let t = 0; t + 2 < n; t += 3) {
    const a = t * 3, b = a + 3, c = a + 6;
    const ux = tris[b] - tris[a], uy = tris[b + 1] - tris[a + 1], uz = tris[b + 2] - tris[a + 2], vx = tris[c] - tris[a], vy = tris[c + 1] - tris[a + 1], vz = tris[c + 2] - tris[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue; nx /= l; ny /= l; nz /= l;
    const walkable = Math.abs(nz) > 0.6;
    const x0 = Math.min(tris[a], tris[b], tris[c]), x1 = Math.max(tris[a], tris[b], tris[c]), y0 = Math.min(tris[a + 1], tris[b + 1], tris[c + 1]), y1 = Math.max(tris[a + 1], tris[b + 1], tris[c + 1]);
    const zlo = Math.min(tris[a + 2], tris[b + 2], tris[c + 2]), zhi = Math.max(tris[a + 2], tris[b + 2], tris[c + 2]);
    const i0 = Math.floor((x0 - min[0]) / res), i1 = Math.floor((x1 - min[0]) / res), j0 = Math.floor((y0 - min[1]) / res), j1 = Math.floor((y1 - min[1]) / res);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = min[0] + (i + 0.5) * res, py = min[1] + (j + 0.5) * res;
      if (walkable) {
        // barycentric height at the cell centre (skip if the centre is outside the triangle)
        const d = ux * vy - uy * vx; if (Math.abs(d) < 1e-12) continue;
        const wx = px - tris[a], wy = py - tris[a + 1], s = (wx * vy - wy * vx) / d, r = (ux * wy - uy * wx) / d;
        if (s < -0.05 || r < -0.05 || s + r > 1.05) continue;
        walkL[j * W + i].push(tris[a + 2] + s * uz + r * vz);
      } else steepL[j * W + i].push(zlo, zhi);
    }
  }
  const cell = (x, y) => { const i = Math.floor((x - min[0]) / res), j = Math.floor((y - min[1]) / res); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  return {
    min, max,
    ground(x, y, z) { const k = cell(x, y); if (k < 0) return null; let best = null; for (const h of walkL[k]) if (h <= z + 0.6 && (best === null || h > best)) best = h; return best; },
    blocked(x, y, feet) { const k = cell(x, y); if (k < 0) return true; const L = steepL[k]; for (let i = 0; i < L.length; i += 2) if (L[i + 1] > feet + 0.45 && L[i] < feet + 1.7) return true; return false; },
  };
}
