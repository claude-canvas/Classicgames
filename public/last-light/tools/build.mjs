// Last Light — offline asset builder (DESIGN.md §2). Node 22 + local Chrome (headless, for image resizing).
// usage: node tools/build.mjs <ponderosa_stand_sketchfab.glb>
// writes assets/forest.json (meshes, instances, materials), assets/forest.bin (geometry), assets/tex_*.{jpg,png}
// Geometry is converted to Z-up ((x, y, z) → (x, −z, y)) and instance matrices to match (C · M · C⁻¹).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [src] = process.argv.slice(2);
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "assets");
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ headless Chrome as an image resizer
async function startChrome() {
  const port = 9700 + Math.floor(Math.random() * 100);
  const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", `--user-data-dir=${process.env.TEMP}/ll-build-${port}`, "about:blank"], { stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.evaluate", { expression: `window.resize = async (src, max, png) => {
    const im = await createImageBitmap(await (await fetch(src)).blob()), k = Math.min(1, max / Math.max(im.width, im.height));
    const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k)), c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(im, 0, 0, w, h); const url = c.toDataURL(png ? "image/png" : "image/jpeg", 0.88); return url.slice(url.indexOf(",") + 1);
  }; 1` });
  const resize = async (buf, mime, max, png) => {
    const r = await send("Runtime.evaluate", { expression: `resize(${JSON.stringify(`data:${mime};base64,${Buffer.from(buf).toString("base64")}`)}, ${max}, ${png})`, awaitPromise: true, returnByValue: true });
    if (!r.result?.result?.value) throw new Error("resize failed"); return Buffer.from(r.result.result.value, "base64");
  };
  return { resize, close: () => { ws.close(); proc.kill(); } };
}

// ------------------------------------------------------------------ GLB reading
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const b = fs.readFileSync(src); let off = 12, J = null, bin = null;
while (off < b.length) { const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4); if (type === 0x4e4f534a) J = JSON.parse(b.toString("utf8", off + 8, off + 8 + len)); else if (type === 0x004e4942) bin = b.subarray(off + 8, off + 8 + len); off += 8 + len; }
const acc = (ai) => {
  const a = J.accessors[ai], n = NC[a.type], bv = J.bufferViews[a.bufferView], es = SIZE[a.componentType], stride = bv.byteStride || es * n, start = (bv.byteOffset || 0) + (a.byteOffset || 0), ct = a.componentType, norm = a.normalized ? NORM[ct] : 1, out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) { const o = start + i * stride + k * es; out[i * n + k] = (ct === 5126 ? bin.readFloatLE(o) : ct === 5125 ? bin.readUInt32LE(o) : ct === 5123 ? bin.readUInt16LE(o) : ct === 5121 ? bin[o] : ct === 5122 ? bin.readInt16LE(o) : bin.readInt8(o)) / norm; }
  return { d: out, n };
};
const mul = (a, c) => { const o = new Array(16); for (let col = 0; col < 4; col++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * c[col * 4 + k]; o[col * 4 + r] = s; } return o; };
const trs = (n) => { if (n.matrix) return n.matrix; const [tx, ty, tz] = n.translation || [0, 0, 0], [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1]; const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz; return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0, 2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, tx, ty, tz, 1]; };
// Y-up → Z-up as a column-major matrix: (x, y, z) → (x, −z, y), and its inverse
const C = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1], Ci = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

// ------------------------------------------------------------------ meshes
const chunks = []; let boff = 0;
const put = (typed) => { const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (buf.length % 4)) % 4; chunks.push(buf, Buffer.alloc(pad)); const o = boff; boff += buf.length + pad; return o; };
const meshes = J.meshes.map((m) => {
  if (m.primitives.length !== 1) throw new Error("expected one primitive per mesh: " + m.name);
  const pr = m.primitives[0], P = acc(pr.attributes.POSITION).d, N = pr.attributes.NORMAL !== undefined ? acc(pr.attributes.NORMAL).d : null;
  const T = pr.attributes.TEXCOORD_0 !== undefined ? acc(pr.attributes.TEXCOORD_0).d : null, CO = pr.attributes.COLOR_0 !== undefined ? acc(pr.attributes.COLOR_0) : null;
  const I = pr.indices !== undefined ? acc(pr.indices).d : Float64Array.from({ length: P.length / 3 }, (_, i) => i), nv = P.length / 3;
  const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 4), uv = new Float32Array(nv * 2), col = new Uint8Array(nv * 4), idx = Uint32Array.from(I);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = -P[i * 3 + 2], z = P[i * 3 + 1]; pos.set([x, y, z], i * 3);
    if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x; if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y; if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
    if (N) { nrm[i * 4] = Math.round(N[i * 3] * 127); nrm[i * 4 + 1] = Math.round(-N[i * 3 + 2] * 127); nrm[i * 4 + 2] = Math.round(N[i * 3 + 1] * 127); }
    if (T) { uv[i * 2] = T[i * 2]; uv[i * 2 + 1] = T[i * 2 + 1]; }
    if (CO) { for (let k = 0; k < 3; k++) col[i * 4 + k] = Math.round(Math.min(1, CO.d[i * CO.n + k]) * 255); } else col.fill(255, i * 4, i * 4 + 3);
    col[i * 4 + 3] = 0;
  }
  return { name: m.name, mat: pr.material, nv, ni: idx.length, min: mn.map((v) => +v.toFixed(3)), max: mx.map((v) => +v.toFixed(3)), o: { pos: put(pos), nrm: put(nrm), uv: put(uv), col: put(col), idx: put(idx) } };
});

// ------------------------------------------------------------------ instances (Z-up world matrices, row-major 3×4)
const instances = [];
const walk = (ni, M) => {
  const n = J.nodes[ni], W = mul(M, trs(n));
  if (n.mesh !== undefined) { const Z = mul(mul(C, W), Ci); instances.push({ mesh: n.mesh, m: [Z[0], Z[4], Z[8], Z[12], Z[1], Z[5], Z[9], Z[13], Z[2], Z[6], Z[10], Z[14]].map((v) => +v.toFixed(5)) }); }
  for (const c of n.children || []) walk(c, W);
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const r of J.scenes[J.scene || 0].nodes) walk(r, I4);

// ------------------------------------------------------------------ materials and textures
const chrome = await startChrome();
const SIZES = { foliage: 1024, ground: 2048, grass: 512, bark: 512 };
const materials = [];
for (const m of J.materials) {
  const t = m.pbrMetallicRoughness?.baseColorTexture; let image = null;
  if (t) {
    const im = J.images[J.textures[t.index].source], bv = J.bufferViews[im.bufferView], data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const alpha = m.alphaMode === "MASK" || m.alphaMode === "BLEND", key = /leaves|foliage/i.test(m.name) ? "foliage" : /ground/i.test(m.name) ? "ground" : /grass/i.test(m.name) ? "grass" : "bark";
    image = `tex_${materials.length}.${alpha ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(OUT, image), await chrome.resize(data, im.mimeType, SIZES[key], alpha));
  }
  materials.push({ name: m.name, image, alpha: m.alphaMode === "MASK" ? "cut" : m.alphaMode === "BLEND" ? "blend" : "solid", cutoff: m.alphaCutoff ?? 0.5, factor: m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1], doubleSided: !!m.doubleSided });
}
chrome.close();

fs.writeFileSync(path.join(OUT, "forest.bin"), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, "forest.json"), JSON.stringify({ meshes, instances, materials }));
const imgBytes = materials.filter((m) => m.image).reduce((s, m) => s + fs.statSync(path.join(OUT, m.image)).size, 0);
console.log(`forest: ${meshes.length} meshes, ${instances.length} instances, ${(boff / 1e6).toFixed(1)} MB geometry, ${(imgBytes / 1e6).toFixed(1)} MB textures`);
process.exit(0);
