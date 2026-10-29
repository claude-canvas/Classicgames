// Lantern Bow particles: hit sparks, paper shreds, lantern embers, fireworks, petals and fireflies (DESIGN.md §5).
import { MAT } from "./mesh.js";

const R = Math.random;
export class FX {
  constructor() { this.p = []; this.shells = []; this.flash = 0; this.lights = []; }
  sparks(at, col, n = 18, sp = 3) { for (let i = 0; i < n; i++) { const v = rnd3(sp); this.p.push({ x: at.slice(), v, life: 0.4 + R() * 0.4, max: 0.8, col, size: 0.03, g: 4, drag: 2, trail: 0.04 }); } }
  shreds(at, col, n = 14) { for (let i = 0; i < n; i++) { const v = rnd3(2); v[1] -= 1.5; v[2] += 1.5; this.p.push({ x: at.slice(), v, life: 1.2 + R() * 0.8, max: 2, col, size: 0.04 + R() * 0.03, g: 2.5, drag: 3, paper: true, rot: R() * 6, spin: (R() - 0.5) * 20 }); } }
  embers(at, n = 40) { for (let i = 0; i < n; i++) { const v = rnd3(2.2); v[2] += 1.2; this.p.push({ x: at.slice(), v, life: 1 + R() * 1.6, max: 2.6, col: [1.0, 0.55 + R() * 0.3, 0.2], size: 0.05 + R() * 0.05, g: -0.4, drag: 1.2, trail: 0.03 }); } this.light(at, [1, 0.6, 0.3], 6, 0.5); }
  light(at, col, k, life) { this.lights.push({ p: at.slice(), col, k, life, max: life }); }
  firework(from, kind = Math.floor(R() * 3)) {
    const PAL = [[1, 0.35, 0.45], [1, 0.8, 0.35], [0.45, 0.8, 1], [0.7, 1, 0.5], [1, 0.55, 0.9], [1, 1, 1]];
    const col = PAL[Math.floor(R() * PAL.length)], col2 = PAL[Math.floor(R() * PAL.length)];
    const target = [from[0] + (R() - 0.5) * 50, from[1] + 50 + R() * 70, 30 + R() * 22];   // bursts low over the mountains, inside the view
    this.shells.push({ x: from.slice(), v: [(target[0] - from[0]) / 2.2, (target[1] - from[1]) / 2.2, (target[2] - from[2]) / 2.2 + 11], t: 0, fuse: 2.2, kind, col, col2 });
  }
  burst(s) {
    const n = s.kind === 2 ? 90 : 130;
    for (let i = 0; i < n; i++) {
      let v;
      if (s.kind === 1) { const a = (i / n) * Math.PI * 2; v = [Math.cos(a) * 16, Math.sin(a) * 4, Math.sin(a) * 16]; }
      else v = rnd3(s.kind === 2 ? 11 : 17, true);
      const willow = s.kind === 2;
      this.p.push({ x: s.x.slice(), v, life: willow ? 2.6 + R() : 1.4 + R() * 0.8, max: willow ? 3.6 : 2.2, col: willow ? [1, 0.75, 0.35] : i % 3 ? s.col : s.col2, size: willow ? 0.5 : 0.6, g: willow ? 3 : 4.5, drag: willow ? 1.4 : 0.9, trail: willow ? 0.28 : 0.12, twinkle: willow || R() < 0.3 });
    }
    this.flash = Math.max(this.flash, 0.7); this.light(s.x, s.col, 60, 0.6); this.booms = (this.booms || 0) + 1;
  }
  update(dt) {
    for (const s of this.shells) { s.t += dt; s.v[2] -= 9.81 * dt * 0.6; for (let k = 0; k < 3; k++) s.x[k] += s.v[k] * dt; if (R() < 0.7) this.p.push({ x: s.x.slice(), v: rnd3(0.6), life: 0.5, max: 0.5, col: [1, 0.7, 0.4], size: 0.25, g: 1, drag: 2 }); }
    for (const s of this.shells) if (s.t >= s.fuse) this.burst(s);
    this.shells = this.shells.filter((s) => s.t < s.fuse);
    for (const q of this.p) {
      q.life -= dt; const d = Math.exp(-q.drag * dt);
      q.v[0] *= d; q.v[1] *= d; q.v[2] = q.v[2] * d - q.g * dt;
      q.x[0] += q.v[0] * dt; q.x[1] += q.v[1] * dt; q.x[2] += q.v[2] * dt;
      if (q.spin) q.rot += q.spin * dt;
      if (q.x[2] < 0 && q.paper) { q.x[2] = 0; q.v = [0, 0, 0]; q.spin = 0; }
    }
    this.p = this.p.filter((q) => q.life > 0);
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }
  draw(A, D, cam) {
    for (const q of this.p) {
      const k = Math.max(0, q.life / q.max), tw = q.twinkle ? (R() < 0.3 ? 0.3 : 1) : 1;
      if (q.paper) {
        const s = q.size, c = Math.cos(q.rot) * s, sn = Math.sin(q.rot) * s;
        D.quad([q.x[0] - c, q.x[1] - sn, q.x[2]], [q.x[0] + sn, q.x[1] - c, q.x[2] + s * 0.6], [q.x[0] + c, q.x[1] + sn, q.x[2]], [q.x[0] - sn, q.x[1] + c, q.x[2] - s * 0.6], q.col, MAT.MATTE);
        continue;
      }
      const b = k * k * tw;
      if (q.trail) streak(A, q.x, [q.x[0] - q.v[0] * q.trail, q.x[1] - q.v[1] * q.trail, q.x[2] - q.v[2] * q.trail], q.size * 0.35, [q.col[0] * b, q.col[1] * b, q.col[2] * b], cam);
      A.sprite(q.x[0], q.x[1], q.x[2], q.size, q.col[0] * b * 0.6, q.col[1] * b * 0.6, q.col[2] * b * 0.6);
    }
  }
}
function rnd3(s, sphere = false) {
  let v; do v = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]; while (v[0] * v[0] + v[1] * v[1] + v[2] * v[2] > 1);
  if (sphere) { const l = Math.hypot(...v) || 1; return v.map((x) => (x / l) * s * (0.85 + R() * 0.15)); }
  return v.map((x) => x * s);
}
// a camera-facing additive line segment
export function streak(A, a, b, w, col, cam) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [a[0] - cam[0], a[1] - cam[1], a[2] - cam[2]];
  let s = [d[1] * v[2] - d[2] * v[1], d[2] * v[0] - d[0] * v[2], d[0] * v[1] - d[1] * v[0]];
  const l = Math.hypot(...s) || 1; s = s.map((x) => (x / l) * w);
  A.quad4([a[0] - s[0], a[1] - s[1], a[2] - s[2]], [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [b[0] + s[0], b[1] + s[1], b[2] + s[2]], [b[0] - s[0], b[1] - s[1], b[2] - s[2]], col, col, [0, 0, 0], [0, 0, 0], MAT.ADD);
}

// ---------------------------------------------------------------- ambient: petals and fireflies
export class Ambient {
  constructor() {
    this.petals = Array.from({ length: 320 }, () => this.newPetal(true));
    this.flies = Array.from({ length: 70 }, () => ({ x: [(R() - 0.5) * 24, 3 + R() * 40, 0.3 + R() * 2.5], ph: R() * 6, sp: 0.3 + R() * 0.5 }));
  }
  newPetal(init) { return { x: [(R() - 0.5) * 34, (init ? R() * 50 : 50) - 2, init ? R() * 9 : 7 + R() * 3], rot: R() * 6, spin: (R() - 0.5) * 6, ph: R() * 6, c: R() < 0.5 ? [1, 0.78, 0.86] : [0.98, 0.86, 0.9] }; }
  update(dt, wind, t) {
    for (const p of this.petals) {
      p.x[0] += (wind[0] * 0.8 + Math.sin(t * 1.3 + p.ph) * 0.3) * dt; p.x[1] += (wind[1] * 0.8 - 0.15) * dt; p.x[2] -= (0.35 + Math.sin(t * 2 + p.ph) * 0.12) * dt; p.rot += p.spin * dt;
      if (p.x[2] < 0 || Math.abs(p.x[0]) > 20 || p.x[1] < -3 || p.x[1] > 52) Object.assign(p, this.newPetal(false), { x: [(R() - 0.5) * 34 - wind[0] * 3, R() * 48, 6 + R() * 4] });
    }
    for (const f of this.flies) { f.x[0] += Math.sin(t * f.sp + f.ph) * 0.3 * dt; f.x[1] += Math.cos(t * f.sp * 0.7 + f.ph) * 0.3 * dt; f.x[2] += Math.sin(t * f.sp * 1.3 + f.ph * 2) * 0.15 * dt; }
  }
  draw(D, A, night, t) {
    for (const p of this.petals) {
      const s = 0.035, c = Math.cos(p.rot) * s, sn = Math.sin(p.rot) * s;
      D.tri([p.x[0] - c, p.x[1] - sn, p.x[2]], [p.x[0] + sn * 0.6, p.x[1] - c * 0.6, p.x[2] + s * 0.5], [p.x[0] + c, p.x[1] + sn, p.x[2] - s * 0.3], p.c, MAT.FOLIAGE);
    }
    if (night > 0.5) for (const f of this.flies) { const b = Math.max(0, Math.sin(t * 2.2 + f.ph * 3)) ** 3 * night; if (b > 0.02) A.sprite(f.x[0], f.x[1], f.x[2], 0.08, 0.5 * b, 0.9 * b, 0.25 * b); }
  }
}
