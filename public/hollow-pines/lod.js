// Last Light — level of detail (DESIGN.md §3): trees far from the camera are drawn as impostors (two crossed quads
// carrying a picture of the tree, rendered once at load), near ones as full meshes. Also the drawn forest-floor detail
// texture that the flat ground texture is mixed with at mouse scale.

// a tree = its branches and foliage instances. Instanced trees (the ring) share a mesh and differ by matrix; the
// others (young pines, the big pines) are unique meshes already in world position, all with the identity matrix, so
// they pair up by name ("…_branches…" with "…_foliage…")
export function groupTrees(F) {
  const map = new Map();
  for (const it of F.instances) {
    if (!["ring", "young", "hero"].includes(it.kind)) continue;
    const key = it.kind === "ring" ? Array.from(it.m, (v) => v.toFixed(3)).join(",") : it.mesh.name.replace(/_(branches|foliage)/, "");
    if (!map.has(key)) map.set(key, { kind: it.kind, parts: [], m: it.m });
    map.get(key).parts.push(it);
  }
  const trees = [...map.values()];
  for (const T of trees) {
    // world box of the tree (from its parts' spheres) and its type: ring trees by mesh, young pines share one picture
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of T.parts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.c[a] - p.r); mx[a] = Math.max(mx[a], p.c[a] + p.r); }
    T.c = mn.map((v, a) => (v + mx[a]) / 2); T.r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    T.type = T.kind === "ring" ? T.parts.map((p) => p.mesh.name).sort().join("|") : T.kind === "young" ? "young" : null;
    for (const p of T.parts) p.tree = T;
    T.lod = "full";
  }
  return trees;
}

// bake one picture per impostor type: the type's meshes drawn from the side into a 256 × 512 texture with alpha.
// draw(parts, bake) renders the given instances' meshes at identity with the current camera. Returns per type
// { tex, local box, k (camera scale), D (distance) } so the quads can be sized to match the picture exactly.
export function bakeImpostors(gl, space, U, trees, draw) {
  const types = new Map();
  for (const T of trees) if (T.type && !types.has(T.type)) types.set(T.type, T);
  // the young-pine picture comes from a mid-sized seedling
  const young = trees.filter((t) => t.type === "young").sort((a, b) => a.r - b.r);
  if (young.length) types.set("young", young[Math.floor(young.length * 0.6)]);
  const W = 256, H = 512, out = new Map();
  const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
  for (const [type, T] of types) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // the parts' local box (they share one mesh frame)
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of T.parts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.mesh.min[a]); mx[a] = Math.max(mx[a], p.mesh.max[a]); }
    const c = mn.map((v, a) => (v + mx[a]) / 2), h = mx[2] - mn[2], w = Math.max(mx[0] - mn[0], mx[1] - mn[1]), D = 300, asp = W / H;
    const k = Math.min(D / (asp * h * 0.52), D / (w * 0.52));
    space.magnifier = 1.6 * k; space.lookAt(c[0], c[1] - D, c[2], c[0], c[1], c[2]);
    gl.uniform1f(U.aspect, asp); gl.uniform3f(U.veriables, space.zShifter, space.magnifier, 0); space.applyCamera();
    draw(T.parts);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // the picture spans 2·D/k across and 2·D/(k·asp) up, centred on c
    out.set(type, { tex, c, halfW: D / k, halfH: D / (k * asp), mnz: mn[2], h });
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb);
  return out;
}

// impostor geometry per type: two crossed quads per tree in world space (pos xyz, colour, normal, uv), trees in order
export function impostorGeometry(gl, trees, pics) {
  const geo = new Map();
  for (const [type, P] of pics) {
    const list = trees.filter((t) => t.type === type), pos = [], col = [], nrm = [], uv = [];
    list.forEach((T, i) => {
      const M = T.m, sc = Math.hypot(M[0], M[4], M[8]);
      // young pines share one picture: scale it to this tree's height
      let s = 1, base = P.mnz;
      if (type === "young") { const me = T.parts[0].mesh; let mz = Infinity, xz = -Infinity; for (const p of T.parts) { mz = Math.min(mz, p.mesh.min[2]); xz = Math.max(xz, p.mesh.max[2]); } s = (xz - mz) / P.h; base = mz;   // scale by the pictured tree's real height (not the picture's, which is wider for bushy trees) void me; }
      const L = (x, y, z) => [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]];
      const cz = base + (P.c[2] - P.mnz) * s, hw = P.halfW * s, hh = P.halfH * s;
      // centred on this tree's own box (in its mesh frame: the identity for world-placed meshes)
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; for (const p of T.parts) { bx0 = Math.min(bx0, p.mesh.min[0]); bx1 = Math.max(bx1, p.mesh.max[0]); by0 = Math.min(by0, p.mesh.min[1]); by1 = Math.max(by1, p.mesh.max[1]); }
      const ccx = type === "young" ? (bx0 + bx1) / 2 : P.c[0], ccy = type === "young" ? (by0 + by1) / 2 : P.c[1];
      for (const [ax, ay] of [[1, 0], [0, 1]]) {
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => L(ccx + ax * u * hw, ccy + ay * u * hw, cz + v * hh));
        const t = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const j of [0, 1, 2, 0, 2, 3]) { pos.push(...q[j]); col.push(255, 255, 255, 0); nrm.push(0, 0, 127, 0); uv.push(...t[j]); }
      }
      T.imp = { type, first: i * 12, count: 12 };
    });
    const b = (typed) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o); gl.bufferData(gl.ARRAY_BUFFER, typed, gl.STATIC_DRAW); return o; };
    geo.set(type, { tex: P.tex, list, pb: b(new Float32Array(pos)), cb: b(new Uint8Array(col)), nb: b(new Int8Array(nrm)), ub: b(new Float32Array(uv)) });
  }
  return geo;
}

// the forest floor up close: dark soil, fallen pine needles, moss and pebbles (tiles seamlessly)
export function drawFloor() {
  const S = 512, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  g.fillStyle = "#4a3626"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 3, k = rnd(); g.fillStyle = k < 0.5 ? `rgba(30,20,14,${0.25 + rnd() * 0.3})` : `rgba(120,95,70,${0.15 + rnd() * 0.25})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  // moss patches
  for (let i = 0; i < 26; i++) { const x = rnd() * S, y = rnd() * S, R = 18 + rnd() * 50, G = 90 + rnd() * 50; wrap(() => { const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, `rgba(${Math.round(G * 0.75)},${Math.round(G)},${Math.round(G * 0.35)},0.75)`); gr.addColorStop(1, "rgba(60,80,30,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); }); }
  // pebbles
  for (let i = 0; i < 70; i++) { const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 5, l = 110 + rnd() * 70; wrap(() => { g.fillStyle = `rgb(${l},${l - 6},${l - 14})`; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, 7); g.fill(); g.fillStyle = "rgba(255,240,220,0.18)"; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.3, 0, 0, 7); g.fill(); }); }
  // fallen pine needles: long thin strokes in rust, tan and brown, in little clusters
  g.lineCap = "round";
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, L = 14 + rnd() * 26, t = rnd();
    const col = t < 0.4 ? [178, 98, 52] : t < 0.75 ? [196, 150, 96] : [110, 72, 44], k = 0.75 + rnd() * 0.45;
    wrap(() => { g.strokeStyle = `rgba(${Math.round(col[0] * k)},${Math.round(col[1] * k)},${Math.round(col[2] * k)},0.9)`; g.lineWidth = 1.1 + rnd() * 0.9; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (rnd() - 0.5) * 4, y + Math.sin(a) * L * 0.5 + (rnd() - 0.5) * 4, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); });
  }
  return c;
}
