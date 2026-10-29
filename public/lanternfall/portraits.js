// Lanternfall dialogue portraits: little SVG faces drawn from each character's palette (DESIGN.md §3).
import { CAST } from "./chars.js";

const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(",")})`;
export function portrait(id, mood = "") {
  const s = CAST[id];
  if (!s) return "";
  const parts = [];
  const bg = s.shadow || id === "vesper" || id === "morrow" ? ["#2a1033", "#0d0612"] : ["#fff4dc", "#e6c79a"];
  parts.push(`<defs><radialGradient id="g${id}" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient></defs><rect width="120" height="120" rx="60" fill="url(#g${id})"/>`);
  if (s.fox) {
    const O = "#f2801f";
    parts.push(`<path d="M28 44 L38 10 L54 36 Z M92 44 L82 10 L66 36 Z" fill="${O}"/><path d="M33 38 L39 18 L49 34 Z M87 38 L81 18 L71 34 Z" fill="#3a241a"/>`);
    parts.push(`<ellipse cx="60" cy="62" rx="36" ry="32" fill="${O}"/><path d="M30 70 Q60 108 90 70 Q60 84 30 70 Z" fill="#fbf3e6"/><ellipse cx="60" cy="80" rx="6" ry="4.5" fill="#2a1a14"/>`);
    parts.push(eyes(46, 74, 58, "#2a1a14", mood));
    parts.push(`<rect x="0" y="104" width="120" height="16" fill="${O}"/>`);
    return svg(parts);
  }
  const skin = rgb(s.skin), coat = rgb(s.coat), hair = s.hair ? rgb(s.hair.col) : null;
  // shoulders
  parts.push(`<path d="M14 120 Q20 90 60 88 Q100 90 106 120 Z" fill="${coat}"/>`);
  if (s.cloak) parts.push(`<path d="M10 120 Q14 96 34 90 L28 120 Z M110 120 Q106 96 86 90 L92 120 Z" fill="${rgb(s.cloak)}"/>`);
  if (s.hat?.style === "knight") {
    const h = rgb(s.hat.col);
    parts.push(`<ellipse cx="60" cy="56" rx="36" ry="38" fill="${h}"/><rect x="30" y="54" width="60" height="7" rx="3" fill="${rgb(s.glow, 0.7)}"/><path d="M60 18 Q66 4 80 2" stroke="#5a1033" stroke-width="5" fill="none"/>`);
    return svg(parts);
  }
  if (s.shadow) { parts.push(`<ellipse cx="60" cy="58" rx="34" ry="34" fill="#140b1a"/><ellipse cx="47" cy="58" rx="7" ry="4" fill="${rgb(s.glow, 0.6)}"/><ellipse cx="73" cy="58" rx="7" ry="4" fill="${rgb(s.glow, 0.6)}"/>`); return svg(parts); }
  if (hair && s.hair.style === "long") parts.push(`<path d="M24 52 Q24 100 40 104 L80 104 Q96 100 96 52 Z" fill="${hair}"/>`);
  if (hair && s.hair.style === "braid") parts.push(`<path d="M86 60 Q96 84 88 104" stroke="${hair}" stroke-width="12" fill="none" stroke-linecap="round"/>`);
  if (hair && s.hair.style === "pigtails") parts.push(`<ellipse cx="22" cy="68" rx="10" ry="16" fill="${hair}"/><ellipse cx="98" cy="68" rx="10" ry="16" fill="${hair}"/>`);
  parts.push(`<ellipse cx="60" cy="60" rx="33" ry="32" fill="${skin}"/><ellipse cx="27" cy="62" rx="5" ry="7" fill="${skin}"/><ellipse cx="93" cy="62" rx="5" ry="7" fill="${skin}"/>`);
  if (s.beard) parts.push(`<path d="M32 66 Q36 ${s.hair?.col[0] > 0.8 ? 104 : 94} 60 ${s.hair?.col[0] > 0.8 ? 108 : 96} Q84 ${s.hair?.col[0] > 0.8 ? 104 : 94} 88 66 Q74 80 60 80 Q46 80 32 66 Z" fill="${rgb(s.beard)}"/>`);
  parts.push(eyes(47, 73, 60, s.glow ? rgb(s.eye, 1.4) : "#1d1820", mood, !!s.glow));
  parts.push(`<ellipse cx="38" cy="72" rx="6" ry="3.5" fill="#ff8f8f" opacity=".55"/><ellipse cx="82" cy="72" rx="6" ry="3.5" fill="#ff8f8f" opacity=".55"/>`);
  const mouth = mood === "sad" ? "M53 80 Q60 75 67 80" : mood === "angry" ? "M52 79 L68 79" : mood === "shock" ? "" : "M53 77 Q60 83 67 77";
  if (mouth) parts.push(`<path d="${mouth}" stroke="#6a2a2a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`); else parts.push(`<ellipse cx="60" cy="80" rx="4" ry="5" fill="#6a2a2a"/>`);
  if (hair && s.hair.style !== "bald") parts.push(`<path d="M26 58 Q28 24 60 24 Q92 24 94 58 Q84 40 60 42 Q40 40 26 58 Z" fill="${hair}"/>`);
  if (hair && s.hair.style === "bun") parts.push(`<circle cx="60" cy="22" r="11" fill="${hair}"/>`);
  const T = s.hat;
  if (T) {
    const h = rgb(T.col);
    if (T.style === "wizard") parts.push(`<path d="M18 42 Q60 30 102 42 Q60 50 18 42 Z" fill="${h}"/><path d="M34 40 Q50 -6 92 2 Q70 10 84 40 Z" fill="${h}"/><path d="M28 41 Q60 34 92 41" stroke="#d8b14c" stroke-width="4" fill="none"/>`);
    if (T.style === "helmet") parts.push(`<path d="M24 52 Q24 18 60 18 Q96 18 96 52 Z" fill="${h}"/><rect x="57" y="44" width="6" height="20" rx="2" fill="${h}"/><path d="M60 18 Q50 4 38 6" stroke="#c22" stroke-width="7" fill="none" stroke-linecap="round"/>`);
    if (T.style === "scarf") parts.push(`<path d="M24 60 Q24 20 60 20 Q96 20 96 60 Q90 40 60 38 Q30 40 24 60 Z" fill="${h}"/><path d="M90 56 Q100 80 92 100" stroke="${h}" stroke-width="9" fill="none"/>`);
    if (T.style === "widebrim") parts.push(`<ellipse cx="60" cy="38" rx="50" ry="9" fill="${h}"/><path d="M36 38 Q38 14 60 14 Q82 14 84 38 Z" fill="${h}"/>`);
    if (T.style === "baker") parts.push(`<path d="M30 40 Q22 10 44 14 Q52 0 70 8 Q94 4 90 40 Z" fill="${h}"/>`);
    if (T.style === "crown") parts.push(`<path d="M28 34 L34 6 L42 28 L50 0 L58 26 L66 0 L74 28 L84 6 L92 34 Z" fill="${h}"/><circle cx="60" cy="30" r="3.5" fill="${rgb(s.glow, 0.7)}"/>`);
  }
  return svg(parts);
}
function eyes(x0, x1, y, col, mood, glow = false) {
  const close = mood === "happy";
  const e = (x) => close ? `<path d="M${x - 6} ${y} Q${x} ${y - 6} ${x + 6} ${y}" stroke="${col}" stroke-width="3" fill="none" stroke-linecap="round"/>` :
    `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="${mood === "shock" ? 7.5 : 6.5}" fill="${col}"/>${glow ? "" : `<circle cx="${x + 2}" cy="${y - 2.5}" r="2" fill="#fff"/>`}`;
  const brow = mood === "angry" ? `<path d="M${x0 - 7} ${y - 12} L${x0 + 6} ${y - 8} M${x1 + 7} ${y - 12} L${x1 - 6} ${y - 8}" stroke="${glow ? col : "#3a2a24"}" stroke-width="3" stroke-linecap="round"/>` : mood === "sad" ? `<path d="M${x0 - 7} ${y - 9} L${x0 + 6} ${y - 12} M${x1 + 7} ${y - 9} L${x1 - 6} ${y - 12}" stroke="#3a2a24" stroke-width="3" stroke-linecap="round"/>` : "";
  return e(x0) + e(x1) + brow;
}
const svg = (parts) => `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
