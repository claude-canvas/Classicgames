// Saratoga GP — offline asset builder (DESIGN.md §2). Node 22 + local Chrome (headless, for image resizing).
// usage: node tools/build.mjs <suzuka.glb> <car dir with full/FullBody.obj and textures/> [--flip]
// writes assets/suzuka.glb, assets/saratoga.glb, assets/car.json, assets/line.json
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [trackSrc, carDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FLIP = process.argv.includes("--flip");
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "assets");
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ headless Chrome as an image resizer
async function startChrome() {
  const port = 9800 + Math.floor(Math.random() * 100);
  const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", `--user-data-dir=${process.env.TEMP}/sgp-build-${port}`, "about:blank"], { stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // in the page: decode, draw at the target size (optionally with a separate alpha image), report alpha, encode
  await send("Runtime.evaluate", { expression: `window.resize = async (src, max, alphaSrc, forcePng) => {
    const load = async (s) => { const b = await (await fetch(s)).blob(); return createImageBitmap(b); };
    const im = await load(src), k = Math.min(1, max / Math.max(im.width, im.height));
    const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    g.drawImage(im, 0, 0, w, h);
    if (alphaSrc) { const a = await load(alphaSrc), c2 = document.createElement("canvas"); c2.width = w; c2.height = h; const g2 = c2.getContext("2d"); g2.drawImage(a, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h), m = g2.getImageData(0, 0, w, h).data; for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = m[i]; g.putImageData(d, 0, 0); }
    const px = g.getImageData(0, 0, w, h).data; let alpha = false; for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
    const png = alpha || forcePng, url = c.toDataURL(png ? "image/png" : "image/jpeg", 0.86);
    return { alpha, mime: png ? "image/png" : "image/jpeg", data: url.slice(url.indexOf(",") + 1), w, h };
  }; 1` });
  const resize = async (buf, mime, max, alphaBuf = null, forcePng = false) => {
    const u = (b, m) => `data:${m};base64,${Buffer.from(b).toString("base64")}`;
    const expr = `resize(${JSON.stringify(u(buf, mime))}, ${max}, ${alphaBuf ? JSON.stringify(u(alphaBuf, "image/png")) : "null"}, ${forcePng})`;
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (!r.result?.result?.value) throw new Error("resize failed: " + JSON.stringify(r.result?.exceptionDetails || r).slice(0, 300));
    const v = r.result.result.value; return { ...v, data: Buffer.from(v.data, "base64") };
  };
  return { resize, close: () => { ws.close(); proc.kill(); } };
}

// ------------------------------------------------------------------ GLB read / write
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
function readGLB(file) {
  const b = fs.readFileSync(file); let off = 12, json = null, bin = null;
  while (off < b.length) { const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4); if (type === 0x4e4f534a) json = JSON.parse(b.toString("utf8", off + 8, off + 8 + len)); else if (type === 0x004e4942) bin = b.subarray(off + 8, off + 8 + len); off += 8 + len; }
  const acc = (ai) => {
    const a = json.accessors[ai], n = NC[a.type], bv = json.bufferViews[a.bufferView], es = SIZE[a.componentType], stride = bv.byteStride || es * n, start = (bv.byteOffset || 0) + (a.byteOffset || 0), ct = a.componentType, out = new Float64Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) { const o = start + i * stride + k * es; out[i * n + k] = ct === 5126 ? bin.readFloatLE(o) : ct === 5125 ? bin.readUInt32LE(o) : ct === 5123 ? bin.readUInt16LE(o) : ct === 5121 ? bin[o] : bin.readInt16LE(o); }
    return out;
  };
  const image = (i) => { const im = json.images[i], bv = json.bufferViews[im.bufferView]; return { data: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), mime: im.mimeType, name: im.name }; };
  return { json, acc, image };
}
// prims: [{ name, pos: Float32Array, nrm: Float32Array, uv: Float32Array, idx: Uint32Array, image: index|null, color: [r,g,b,a]|null, alpha: bool }]
function writeGLB(file, prims, images) {
  const chunks = []; let off = 0; const bufferViews = [], accessors = [];
  const add = (typed, target) => { const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); off += b.length + pad; return bufferViews.length - 1; };
  const accessor = (typed, type, ct, target, minmax) => { const n = NC[type], a = { bufferView: add(typed, target), componentType: ct, count: typed.length / n, type }; if (minmax) { const mn = Array(n).fill(Infinity), mx = Array(n).fill(-Infinity); for (let i = 0; i < typed.length; i++) { const k = i % n; mn[k] = Math.min(mn[k], typed[i]); mx[k] = Math.max(mx[k], typed[i]); } a.min = mn; a.max = mx; } accessors.push(a); return accessors.length - 1; };
  const imgs = images.map((im) => ({ bufferView: add(im.data), mimeType: im.mime, name: im.name }));
  const materials = [], primitives = [];
  for (const p of prims) {
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    if (p.image !== null && p.image !== undefined) pbr.baseColorTexture = { index: p.image };
    if (p.color) pbr.baseColorFactor = p.color;
    materials.push({ name: p.name, pbrMetallicRoughness: pbr, ...(p.alpha ? { alphaMode: p.blend ? "BLEND" : "MASK", alphaCutoff: 0.42 } : {}), doubleSided: true });
    primitives.push({ attributes: { POSITION: accessor(p.pos, "VEC3", 5126, 34962, true), NORMAL: accessor(p.nrm, "VEC3", 5126, 34962), TEXCOORD_0: accessor(p.uv, "VEC2", 5126, 34962) }, indices: accessor(p.idx, "SCALAR", 5125, 34963), material: materials.length - 1 });
  }
  const json = { asset: { version: "2.0", generator: "saratoga-gp tools/build.mjs" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: path.basename(file, ".glb") }], meshes: [{ primitives }], materials,
    textures: imgs.map((_, i) => ({ source: i })), images: imgs, accessors, bufferViews, buffers: [{ byteLength: off }] };
  if (!imgs.length) { delete json.textures; delete json.images; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, bin]));
  return 12 + 16 + js.length + bin.length;
}

// ------------------------------------------------------------------ the track
const BIG_TEX = /ROAD|RMBL|GRASS|GRVL|PITROAD|groove|skid|SAND/i, DECAL = /groove|skid/i;
// untextured materials get a colour by name (the source keeps none)
const NAMED_COLOR = [[/TREE_SHADOW/i, [0.12, 0.16, 0.1, 1]], [/TREE/i, [0.2, 0.34, 0.14, 1]], [/SHRUB/i, [0.26, 0.42, 0.17, 1]], [/.*/, [0.72, 0.72, 0.7, 1]]];
async function buildTrack(chrome) {
  const G = readGLB(trackSrc), J = G.json;
  const merged = new Map();   // material index → { pos[], nrm[], uv[], idx[] }
  for (const node of J.nodes) {
    if (node.mesh === undefined) continue;
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const rot = (x, y, z) => { const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z; return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]; };
    for (const pr of J.meshes[node.mesh].primitives) {
      const P = G.acc(pr.attributes.POSITION), N = pr.attributes.NORMAL !== undefined ? G.acc(pr.attributes.NORMAL) : null, T = pr.attributes.TEXCOORD_0 !== undefined ? G.acc(pr.attributes.TEXCOORD_0) : null;
      const I = pr.indices !== undefined ? G.acc(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
      const m = merged.get(pr.material) || merged.set(pr.material, { pos: [], nrm: [], uv: [], idx: [] }).get(pr.material), base = m.pos.length / 3;
      for (let i = 0; i < P.length / 3; i++) {
        m.pos.push(...rot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        m.nrm.push(...(N ? rot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) : [0, 1, 0]));
        m.uv.push(T ? T[i * 2] : 0, T ? T[i * 2 + 1] : 0);
      }
      for (let i = 0; i < I.length; i++) m.idx.push(base + I[i]);
    }
  }
  const images = [], imageMap = new Map(), prims = [];
  let k = 0;
  for (const [mi, m] of merged) {
    const mat = J.materials[mi], name = mat.name || `mat${mi}`, tex = mat.pbrMetallicRoughness?.baseColorTexture;
    let image = null, alpha = false;
    if (tex) {
      const src = J.textures[tex.index].source, max = BIG_TEX.test(name) ? 1024 : 512;
      const key = src + ":" + max;
      if (!imageMap.has(key)) { const im = G.image(src), r = await chrome.resize(im.data, im.mime, max); images.push({ data: r.data, mime: r.mime, name: im.name }); imageMap.set(key, { i: images.length - 1, alpha: r.alpha }); }
      ({ i: image, alpha } = imageMap.get(key));
    }
    const color = tex ? mat.pbrMetallicRoughness?.baseColorFactor || null : NAMED_COLOR.find(([re]) => re.test(name))[1];
    // road-like surfaces stay opaque, except the overlays (rubbered-in groove, skid marks), which are blended decals
    const decal = DECAL.test(name);
    prims.push({ name, pos: Float32Array.from(m.pos), nrm: Float32Array.from(m.nrm), uv: Float32Array.from(m.uv), idx: Uint32Array.from(m.idx), image, color, alpha: alpha && (decal || !BIG_TEX.test(name)), blend: alpha && decal });
    if (++k % 40 === 0) console.log(`  track: ${k}/${merged.size} materials`);
  }
  const size = writeGLB(path.join(OUT, "suzuka.glb"), prims, images);
  console.log("decals:", prims.filter((p) => DECAL.test(p.name)).map((p) => `${p.name} alpha=${!!p.alpha}`).join(", "));
  console.log(`suzuka.glb: ${prims.length} materials, ${images.length} images, ${(size / 1e6).toFixed(1)} MB`);
  return { prims };
}

// ------------------------------------------------------------------ the car (OBJ → GLB, cm → m, wheels split and centred)
async function buildCar(chrome) {
  const lines = fs.readFileSync(path.join(carDir, "full", "FullBody.obj"), "utf8").split(/\r?\n/);
  const V = [], VT = [], VN = [], groups = {}; let cur = null;
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === "v") V.push(p.slice(1, 4).map(Number)); else if (p[0] === "vt") VT.push(p.slice(1, 3).map(Number)); else if (p[0] === "vn") VN.push(p.slice(1, 4).map(Number));
    else if (p[0] === "o") cur = groups[p[1]] = []; else if (p[0] === "f") { const f = p.slice(1).map((q) => q.split("/").map((s) => (s ? +s - 1 : -1))); for (let i = 1; i + 1 < f.length; i++) cur.push([f[0], f[i], f[i + 1]]); }
  }
  // car frame: metres, origin between the axles on the ground; FLIP turns it 180° if the model's front is +Z
  const S = 0.01, sgn = FLIP ? -1 : 1;
  const tireZ = (g) => { let s = 0, n = 0; for (const t of groups[g]) for (const c of t) { s += V[c[0]][2]; n++; } return s / n; };
  const zMid = (tireZ("LowTire") + tireZ("LowTire001")) / 2;
  let yMin = Infinity; for (const g of ["LowTire", "LowTire001"]) for (const t of groups[g]) for (const c of t) yMin = Math.min(yMin, V[c[0]][1]);
  const P = (v) => [sgn * v[0] * S, (v[1] - yMin) * S, sgn * (v[2] - zMid) * S], Nn = (n) => [sgn * n[0], n[1], sgn * n[2]];
  const prim = (name, tris, centre = [0, 0, 0]) => {
    const pos = [], nrm = [], uv = [], idx = [];
    for (const t of tris) {
      // a 180° turn keeps the winding (it is a rotation)
      for (const c of t) { const p = P(V[c[0]]); pos.push(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]); nrm.push(...(c[2] >= 0 ? Nn(VN[c[2]]) : [0, 1, 0])); uv.push(c[1] >= 0 ? VT[c[1]][0] : 0, c[1] >= 0 ? 1 - VT[c[1]][1] : 0); idx.push(idx.length); }
    }
    return { name, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: Float32Array.from(uv), idx: Uint32Array.from(idx) };
  };
  // each tyre object holds an axle's two wheels: split by side, centre each on its own axle point
  const wheels = [];
  for (const g of ["LowTire", "LowTire001"]) for (const side of [-1, 1]) {
    const tris = groups[g].filter((t) => Math.sign(t.reduce((s, c) => s + V[c[0]][0], 0)) === side);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const c of t) { const p = P(V[c[0]]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } }
    const centre = mn.map((v, k) => (v + mx[k]) / 2);
    wheels.push({ tris, centre, radius: (mx[1] - mn[1]) / 2 });
  }
  const tex = (f) => fs.readFileSync(path.join(carDir, "textures", f));
  const body = await chrome.resize(tex("Body_Base_Color.png"), "image/png", 1024);
  const glass = await chrome.resize(tex("Glass_Base_Color.png"), "image/png", 256, tex("Glass_Opacity.png"), true);
  const tire = await chrome.resize(tex("Tire_Base_Color.png"), "image/png", 512);
  const images = [{ ...body, name: "body" }, { ...glass, name: "glass" }, { ...tire, name: "tire" }];
  const prims = [{ ...prim("body", groups.LowBody), image: 0 }, { ...prim("glass", groups.LowGlass), image: 1, alpha: true, blend: true }];
  wheels.forEach((w, i) => prims.push({ ...prim("wheel" + i, w.tris, w.centre), image: 2 }));
  const size = writeGLB(path.join(OUT, "saratoga.glb"), prims, images);
  // wheel centres in game coordinates (Z-up, as gltex converts: (x, y, z) → (x, −z, y))
  const info = { wheels: wheels.map((w) => ({ x: +w.centre[0].toFixed(3), y: +(-w.centre[2]).toFixed(3), z: +w.centre[1].toFixed(3), r: +w.radius.toFixed(3) })) };
  fs.writeFileSync(path.join(OUT, "car.json"), JSON.stringify(info, null, 1));
  console.log(`saratoga.glb: ${(size / 1e6).toFixed(2)} MB`, JSON.stringify(info));
}

// ------------------------------------------------------------------ the racing line (from the groove strip)
function buildLine() {
  const G = readGLB(trackSrc), J = G.json, C = [];
  // groove triangles (rotation baked, then Z-up)
  for (const node of J.nodes) {
    if (node.mesh === undefined) continue;
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const rot = (x, y, z) => { const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z; const r = [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]; return [r[0], -r[2], r[1]]; };
    for (const pr of J.meshes[node.mesh].primitives) {
      if (J.materials[pr.material].name !== "groove") continue;
      const P = G.acc(pr.attributes.POSITION), I = G.acc(pr.indices);
      for (let i = 0; i < I.length; i += 3) { const a = rot(...P.slice(I[i] * 3, I[i] * 3 + 3)), b = rot(...P.slice(I[i + 1] * 3, I[i + 1] * 3 + 3)), c = rot(...P.slice(I[i + 2] * 3, I[i + 2] * 3 + 3)); C.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]); }
    }
  }
  const cell = 5, grid = new Map(), key = (x, y) => Math.floor(x / cell) + "," + Math.floor(y / cell);
  C.forEach((p, i) => { const k = key(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const near = (x, y, r) => { const o = []; for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) for (const i of grid.get(gx + "," + gy) || []) o.push(i); return o; };
  // walk from the middle of the pit straight toward −y (the race direction: Turn 1 is the downhill right-hander)
  const S0 = [480, -470]; let cur = C.reduce((b, p) => (Math.hypot(p[0] - S0[0], p[1] - S0[1]) < Math.hypot(b[0] - S0[0], b[1] - S0[1]) ? p : b)).slice();
  let dir = [0, -1]; const pts = [cur.slice()], STEP = 4;
  for (let it = 0; it < 4000; it++) {
    const ax = cur[0] + dir[0] * STEP, ay = cur[1] + dir[1] * STEP; let sx = 0, sy = 0, sz = 0, n = 0;
    for (const i of near(ax, ay, 5)) { const p = C[i], dx = p[0] - cur[0], dy = p[1] - cur[1], d = Math.hypot(dx, dy); if (d < 1.5 || d > 8 || Math.abs(p[2] - cur[2]) > 1.5 || (dx * dir[0] + dy * dir[1]) / d < 0.8 || Math.hypot(p[0] - ax, p[1] - ay) > 4) continue; sx += p[0]; sy += p[1]; sz += p[2]; n++; }
    if (!n) throw new Error("racing line lost at " + cur.map((v) => v.toFixed(1)));
    const dx = sx / n - cur[0], dy = sy / n - cur[1], l = Math.hypot(dx, dy);
    dir = [dir[0] * 0.3 + (dx / l) * 0.7, dir[1] * 0.3 + (dy / l) * 0.7]; const dl = Math.hypot(...dir); dir = [dir[0] / dl, dir[1] / dl];
    cur = [cur[0] + dir[0] * STEP, cur[1] + dir[1] * STEP, sz / n]; pts.push(cur.slice());
    if (it > 50 && Math.hypot(cur[0] - pts[0][0], cur[1] - pts[0][1]) < STEP * 1.2 && Math.abs(cur[2] - pts[0][2]) < 2) break;
  }
  // smooth (closed loop) and store
  let P2 = pts.slice(0, -1);
  for (let pass = 0; pass < 4; pass++) P2 = P2.map((p, i) => { const a = P2[(i - 1 + P2.length) % P2.length], b = P2[(i + 1) % P2.length]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4, (a[2] + 2 * p[2] + b[2]) / 4]; });
  let len = 0; for (let i = 0; i < P2.length; i++) len += Math.hypot(P2[(i + 1) % P2.length][0] - P2[i][0], P2[(i + 1) % P2.length][1] - P2[i][1]);
  fs.writeFileSync(path.join(OUT, "line.json"), JSON.stringify({ length: +len.toFixed(1), pts: P2.map((p) => p.map((v) => +v.toFixed(2))) }));
  console.log(`line.json: ${P2.length} points, ${len.toFixed(0)} m`);
}

const chrome = await startChrome();
try {
  if (!process.argv.includes("--no-track")) await buildTrack(chrome);
  await buildCar(chrome);
  buildLine();
} finally { chrome.close(); }
process.exit(0);
