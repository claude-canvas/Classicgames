// Lumen Links sound (Web Audio, all synthesized): the putter's tock, the ball's soft roll, wall clicks, mushroom
// boings, the cup's rattle-and-drop, splashes, crickets and a gentle music-box waltz.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const WALTZ = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Lumen Links: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.4; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.25; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.4 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const rs = ctx.createBufferSource(); rs.buffer = this.noise; rs.loop = true; this.rollF = ctx.createBiquadFilter(); this.rollF.type = "lowpass"; this.rollF.frequency.value = 300; this.rollG = ctx.createGain(); this.rollG.gain.value = 0; rs.connect(this.rollF).connect(this.rollG).connect(this.sfx); rs.start();
    this.step = 0; this.next = ctx.currentTime + 0.5; this.crT = ctx.currentTime + 2;
    this.timer = setInterval(() => this.tick(), 100);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.4 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  box(n, t, v, dest = this.mus) { const ctx = this.ctx; for (const [m, a] of [[1, 1], [3, 0.25], [5.4, 0.08]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = midi(n) * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / m); o.connect(g).connect(dest); o.start(t); o.stop(t + 1.7); } }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    if (this.music > 0) while (this.next < ctx.currentTime + 0.25) {
      const t = this.next, beat = this.step % 3, bar = Math.floor(this.step / 3), ch = WALTZ[bar % 4];
      if (beat === 0) this.box(ch[0] - 12, t, 0.06); else this.box(ch[beat] , t, 0.035);
      if (beat === 0 || Math.random() < 0.4) this.box(ch[Math.floor(Math.random() * 3)] + 12 + (Math.random() < 0.3 ? 2 : 0), t + (beat === 2 ? 0.2 : 0), 0.04);
      this.step++; this.next += 0.48;
    }
    if (ctx.currentTime > this.crT) { this.crT = ctx.currentTime + 0.8 + Math.random() * 2.5; this.cricket(); }
  }
  cricket() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, f = 4300 + Math.random() * 500; for (let i = 0; i < 3; i++) { const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.06; o.frequency.value = f; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.006, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.035); o.connect(g).connect(this.master); o.start(s); o.stop(s + 0.04); } }
  roll(v) { if (!this.ctx) return; const t = this.ctx.currentTime; this.rollG.gain.setTargetAtTime(Math.min(0.12, v * 0.05), t, 0.05); this.rollF.frequency.setTargetAtTime(200 + v * 300, t, 0.05); }
  putt(p) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05); g.gain.setValueAtTime(0.15 + p * 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.09); }
  click(s = 1) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 1400 + Math.random() * 400; g.gain.setValueAtTime(Math.min(0.2, 0.04 + s * 0.05), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.05); }
  boing() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.12); o.frequency.exponentialRampToValueAtTime(400, t + 0.3); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.36); }
  cup() { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < 4; i++) setTimeout(() => this.click(1.5 - i * 0.3), i * 70); [72, 76, 79, 84].forEach((n, i) => this.box(n, t + 0.35 + i * 0.1, 0.08, this.sfx)); }
  splash() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.4); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 0.55); }
  fanfare(good) { if (!this.ok) return; const t = this.ctx.currentTime; (good ? [72, 76, 79, 84, 88, 91] : [72, 71, 67]).forEach((n, i) => this.box(n, t + i * 0.11, 0.09, this.sfx)); }
  ui() { if (!this.ok) return; this.box(84, this.ctx.currentTime, 0.05, this.sfx); }
}
