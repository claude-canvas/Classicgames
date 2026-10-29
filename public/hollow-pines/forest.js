// Last Light — the instanced forest (DESIGN.md §2–3): loading assets/forest.{json,bin}, GPU buffers per unique mesh,
// view culling per instance (and per 8 m tile for the big single meshes: ground and grass), and drawing.
// An instance draw sets uInst = 1 and its 3×4 matrix in bone 0, so one shader serves every mesh.

const TILE = 8, LITE_AREA = 0.0025;

// kinds by mesh name: hero (the three big pines), young (pine seedlings), ring (far trees), grass, ground, log, rock
export function kindOf(name) {
  if (/terrain/i.test(name)) return "ground";
  if (/grass/i.test(name)) return "grass";
  if (/Cylinder/i.test(name)) return "log";
  if (/Icosphere/i.test(name)) return "rock";
  if (/_far/i.test(name)) return "ring";
  if (/seedling/i.test(name)) return "young";
  return "hero";
}

export async function loadForest(gl, onProgress = () => { }) {
  const uint = gl.getExtension("OES_element_index_uint");
  if (!uint) throw new Error("this browser's WebGL lacks 32-bit indices (OES_element_index_uint)");
  const json = await (await fetch("assets/forest.json")).json();
  const res = await fetch("assets/forest.bin"), total = +res.headers.get("content-length") || 0;
  let bin;
  if (total && res.body) { const r = res.body.getReader(), parts = []; let got = 0; for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); got += value.length; onProgress((got / total) * 0.85); } bin = new Uint8Array(got); let o = 0; for (const p of parts) { bin.set(p, o); o += p.length; } }
  else bin = new Uint8Array(await res.arrayBuffer());
  const B = bin.buffer;
  // textures
  const materials = await Promise.all(json.materials.map(async (m, i) => {
    let tex = null;
    if (m.image) {
      const img = await createImageBitmap(await (await fetch("assets/" + m.image)).blob());
      const pot = (v) => 1 << Math.ceil(Math.log2(v)), c = document.createElement("canvas"); c.width = pot(img.width); c.height = pot(img.height); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const an = gl.getExtension("EXT_texture_filter_anisotropic"); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    }
    const mode = /leaves|foliage/i.test(m.name) ? 3 : /grass/i.test(m.name) ? 4 : 0;
    return { ...m, tex, mode, i };
  }));
  onProgress(0.9);
  const vbuf = (typed) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, typed, gl.STATIC_DRAW); return b; };
  const meshes = json.meshes.map((m) => {
    const pos = new Float32Array(B, m.o.pos, m.nv * 3), idx = new Uint32Array(B, m.o.idx, m.ni);
    // untextured materials (logs, rocks) carry a linear base colour: fold it into the vertex colours (as sRGB)
    let col = new Uint8Array(B, m.o.col, m.nv * 4); const mat = materials[m.mat];
    if (!mat.tex && mat.factor.some((v, i) => i < 3 && v !== 1)) { const f = mat.factor.slice(0, 3).map((v) => Math.pow(v, 1 / 2.2)); col = col.slice(); for (let i = 0; i < m.nv; i++) for (let k = 0; k < 3; k++) col[i * 4 + k] = Math.round(col[i * 4 + k] * f[k]); }
    return { ...m, kind: kindOf(m.name), pos, idxCPU: idx, pb: vbuf(pos), nb: vbuf(new Int8Array(B, m.o.nrm, m.nv * 4)), ub: vbuf(new Float32Array(B, m.o.uv, m.nv * 2)), cb: vbuf(col), ib: null, tiles: null };
  });
  // instances: world bounding spheres from the mesh boxes
  const instances = json.instances.map((it) => {
    const M = it.m, me = meshes[it.mesh], c = [(me.min[0] + me.max[0]) / 2, (me.min[1] + me.max[1]) / 2, (me.min[2] + me.max[2]) / 2];
    const sc = Math.max(Math.hypot(M[0], M[4], M[8]), Math.hypot(M[1], M[5], M[9]), Math.hypot(M[2], M[6], M[10]));
    const w = [M[0] * c[0] + M[1] * c[1] + M[2] * c[2] + M[3], M[4] * c[0] + M[5] * c[1] + M[6] * c[2] + M[7], M[8] * c[0] + M[9] * c[1] + M[10] * c[2] + M[11]];
    const r = (Math.hypot(me.max[0] - me.min[0], me.max[1] - me.min[1], me.max[2] - me.min[2]) / 2) * sc;
    const base = M[11] + me.min[2] * M[10], height = (me.max[2] - me.min[2]) * sc;
    return { mesh: me, m: new Float32Array(M), c: w, r, base, height, kind: me.kind };
  });
  // big single meshes: reorder their triangles into 8 m tiles (in world space), drawn per visible tile
  for (const me of meshes) {
    const inst = instances.filter((i) => i.mesh === me);
    if (inst.length === 1 && (me.kind === "grass" || me.kind === "ground")) {
      const M = inst[0].m, P = me.pos, I = me.idxCPU, nt = I.length / 3, key = new Int32Array(nt), order = new Uint32Array(nt);
      const wx = (i) => M[0] * P[i * 3] + M[1] * P[i * 3 + 1] + M[2] * P[i * 3 + 2] + M[3], wy = (i) => M[4] * P[i * 3] + M[5] * P[i * 3 + 1] + M[6] * P[i * 3 + 2] + M[7], wz = (i) => M[8] * P[i * 3] + M[9] * P[i * 3 + 1] + M[10] * P[i * 3 + 2] + M[11];
      for (let t = 0; t < nt; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; key[t] = (Math.floor((wy(a) + wy(b) + wy(c)) / 3 / TILE) + 100) * 1000 + Math.floor((wx(a) + wx(b) + wx(c)) / 3 / TILE) + 100; order[t] = t; }
      order.sort((a, b) => key[a] - key[b]);
      const out = new Uint32Array(I.length), tiles = []; let cur = null;
      for (let k = 0; k < nt; k++) {
        const t = order[k];
        if (!cur || cur.key !== key[t]) { cur = { key: key[t], first: k * 3, count: 0, mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] }; tiles.push(cur); }
        for (let j = 0; j < 3; j++) { const v = I[t * 3 + j]; out[k * 3 + j] = v; const p = [wx(v), wy(v), wz(v)]; for (let a = 0; a < 3; a++) { if (p[a] < cur.mn[a]) cur.mn[a] = p[a]; if (p[a] > cur.mx[a]) cur.mx[a] = p[a]; } }
        cur.count += 3;
      }
      for (const T of tiles) { T.c = T.mn.map((v, a) => (v + T.mx[a]) / 2); T.r = Math.hypot(T.mx[0] - T.mn[0], T.mx[1] - T.mn[1], T.mx[2] - T.mn[2]) / 2; }
      me.idxCPU = out; me.tiles = tiles;
    }
    me.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, me.idxCPU, gl.STATIC_DRAW);
    // branch meshes of the near pines: a lite index list without the twigs (triangles under LITE_AREA m², except
    // within 1.2 m of the base, where the mouse sees the trunk up close) — most of the trees' triangles are twigs
    if ((me.kind === "hero" || me.kind === "young") && /branches/i.test(me.name)) {
      const P = me.pos, I = me.idxCPU, keep = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        if (area >= LITE_AREA || Math.min(P[a + 2], P[b + 2], P[c + 2]) < me.min[2] + 1.2) keep.push(I[t], I[t + 1], I[t + 2]);
      }
      me.lite = { ib: gl.createBuffer(), ni: keep.length };
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, me.lite.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(keep), gl.STATIC_DRAW);
    }
  }
  onProgress(1);
  return { meshes, instances, materials, json };
}

// world-space triangles of the given kinds (for collision), with the mesh kind per list
export function worldTriangles(F, kinds) {
  const lists = [];
  for (const it of F.instances) {
    if (!kinds.includes(it.kind)) continue;
    const me = it.mesh, M = it.m, P = me.pos, I = me.idxCPU, out = new Float32Array(I.length * 3);
    for (let k = 0; k < I.length; k++) { const i = I[k], x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; out[k * 3] = M[0] * x + M[1] * y + M[2] * z + M[3]; out[k * 3 + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; out[k * 3 + 2] = M[8] * x + M[9] * y + M[10] * z + M[11]; }
    lists.push({ kind: it.kind, name: me.name, pos: out });
  }
  return lists;
}
