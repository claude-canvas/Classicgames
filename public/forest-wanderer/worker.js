// Echoes of the Hollow world builder thread: builds a chapter's map, bakes its shadow map, then streams 25 m tiles back
// nearest-first from the start point as transferable vertex arrays (DESIGN.md §3).
import { buildMap } from "./maps.js";
import { buildTile, buildFar, bakeShade, NT, TILE } from "./world.js";
import { HALF } from "./maps.js";

onmessage = (e) => {
  const { ch, start, token } = e.data;
  const S = buildMap(ch);
  const order = [];
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) order.push([i, j, Math.hypot(-HALF + (i + 0.5) * TILE - start[0], -HALF + (j + 0.5) * TILE - start[1])]);
  order.sort((a, b) => a[2] - b[2]);
  const far = buildFar(S), fo = far.O, fa = far.A;
  const fpos = new Float32Array((fo.n + fa.n) * 4), fcol = new Float32Array((fo.n + fa.n) * 4);
  fpos.set(fo.pos.subarray(0, fo.n * 4)); fcol.set(fo.col.subarray(0, fo.n * 4)); fpos.set(fa.pos.subarray(0, fa.n * 4), fo.n * 4); fcol.set(fa.col.subarray(0, fa.n * 4), fo.n * 4);
  postMessage({ type: "far", token, pos: fpos, col: fcol, O: [0, fo.n], A: [fo.n, fa.n] }, [fpos.buffer, fcol.buffer]);
  order.forEach(([i, j], k) => {
    if (k === 4) { const sh = bakeShade(S); postMessage({ type: "shade", token, ...sh }, [sh.data.buffer]); }
    const t = buildTile(S, i, j);
    postMessage({ type: "tile", token, ...t }, [t.pos.buffer, t.col.buffer, t.nrm.buffer]);
  });
  postMessage({ type: "done", token });
};
