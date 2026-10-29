// Paper Brook world builder (runs off the main thread): builds the brook chunk by chunk and streams each one back as
// transferable vertex arrays, and bakes the dapple map, so the page never freezes while the world is made.
// main.js posts { start: chunk index }; chunks are built nearest-first from there (the shade map after the first 3).
import { buildChunk, NCHUNK, TREES, LANTERNS, WINDOWS, CHIMNEYS } from "./scene.js";
import { bakeShade } from "./shade.js";

onmessage = (e) => {
  const start = e.data.start | 0, rank = (c) => (c < start - 1 ? 1000 : 0) + Math.abs(c - start);
  const order = Array.from({ length: NCHUNK }, (_, i) => i).sort((a, b) => rank(a) - rank(b));
  let nl = 0, nw = 0, nc = 0;
  order.forEach((ci, k) => {
    if (k === 3) { const map = bakeShade(TREES); postMessage({ type: "shade", x0: map.x0, y0: map.y0, W: map.W, H: map.H, data: map.data }, [map.data.buffer]); }
    const c = buildChunk(ci);
    c.type = "chunk"; c.lanterns = LANTERNS.slice(nl); c.windows = WINDOWS.slice(nw); c.chimneys = CHIMNEYS.slice(nc);
    nl = LANTERNS.length; nw = WINDOWS.length; nc = CHIMNEYS.length;
    postMessage(c, [c.pos.buffer, c.col.buffer]);
  });
  postMessage({ type: "done" });
};
