// Neon Strike scoring (DESIGN.md §1): standard ten-pin. frames = [[r1, r2?, r3?], ...] (pins knocked per roll).
export function frameDone(frames, fi) {
  const f = frames[fi] || [];
  if (fi < 9) return f[0] === 10 || f.length === 2;
  if (f.length === 3) return true;
  if (f.length === 2) return f[0] + f[1] < 10;
  return false;
}
// running totals per frame (null when not yet computable)
export function totals(frames) {
  const rolls = frames.flat(), out = []; let ri = 0, sum = 0;
  for (let fi = 0; fi < 10; fi++) {
    const f = frames[fi]; if (!f || !f.length) { out.push(null); continue; }
    if (fi === 9) { if (!frameDone(frames, 9)) { out.push(null); break; } sum += f.reduce((a, b) => a + b, 0); out.push(sum); break; }
    if (f[0] === 10) { const a = rolls[ri + 1], b = rolls[ri + 2]; ri += 1; if (a === undefined || b === undefined) { out.push(null); continue; } sum += 10 + a + b; }
    else if (f.length === 2 && f[0] + f[1] === 10) { const a = rolls[ri + 2]; ri += 2; if (a === undefined) { out.push(null); continue; } sum += 10 + a; }
    else if (f.length === 2) { sum += f[0] + f[1]; ri += 2; }
    else { out.push(null); ri += f.length; continue; }
    out.push(sum);
  }
  return out;
}
// marks for the scoresheet: "X", "/", "-", digits
export function marks(f, fi) {
  const m = [];
  for (let i = 0; i < f.length; i++) {
    const v = f[i], prev = i > 0 ? f[i - 1] : null;
    // in the 10th a fresh rack follows a strike or a spare
    const fresh = i === 0 || (fi === 9 && (m[i - 1] === "X" || m[i - 1] === "/"));
    if (v === 10 && fresh) m.push("X");
    else if (!fresh && prev + v === 10) m.push("/");
    else m.push(v === 0 ? "-" : String(v));
  }
  return m;
}
export const score = (frames) => { const t = totals(frames).filter((v) => v !== null); return t.length ? t[t.length - 1] : 0; };
