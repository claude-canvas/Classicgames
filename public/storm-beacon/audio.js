// Storm Beacon sound (Web Audio, all synthesized): wind and rain beds that follow the storm, surf booming on the
// rocks, thunder after each flash, the fog horn, ship bells, a crunch for wrecks, chimes for saves. Music: a slow
// cello-like drone with sparse piano notes in D minor.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const DM = [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 69];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Storm Beacon: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 4.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.35; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); let b = 0; for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; nd[i] = w * 0.5 + b * 4; }
    const loop = (f, type, q, g0, dest) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = g0; s.connect(F).connect(G).connect(dest); s.start(0, Math.random() * 2); return [F, G]; };
    [this.windF, this.windG] = loop(420, "bandpass", 0.6, 0.05, this.master);
    [this.rainF, this.rainG] = loop(5000, "highpass", 0.3, 0.03, this.master);
    [this.seaF, this.seaG] = loop(260, "lowpass", 0.7, 0.08, this.master);
    // drone
    for (const [n, v] of [[38, 0.05], [45, 0.035], [50, 0.02]]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 300; lfo.frequency.value = 0.07 + Math.random() * 0.05; lg.gain.value = v * 0.6; lfo.connect(lg).connect(g.gain); g.gain.value = v; o.connect(lp).connect(g).connect(this.mus); o.start(); lfo.start(); }
    this.next = ctx.currentTime + 2; this.surfT = ctx.currentTime + 1;
    this.timer = setInterval(() => this.tick(), 150);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  piano(n, t, v = 0.06, dest = this.mus) {
    const ctx = this.ctx, f = midi(n);
    for (const [m, a] of [[1, 1], [2, 0.4], [3, 0.15]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = f * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 / m); o.connect(g).connect(dest); o.start(t); o.stop(t + 3.6); }
  }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    if (this.music > 0) while (this.next < ctx.currentTime + 0.3) {
      const t = this.next; if (Math.random() < 0.7) this.piano(DM[Math.floor(Math.random() * DM.length)] + 12, t, 0.04 + Math.random() * 0.03);
      if (Math.random() < 0.25) this.piano(DM[Math.floor(Math.random() * 5)], t + 0.4, 0.03);
      this.next += 1.6 + Math.random() * 2.4;
    }
    if (ctx.currentTime > this.surfT) { this.surfT = ctx.currentTime + 2.5 + Math.random() * 4; this.surf(0.12 + Math.random() * 0.12); }
  }
  update(storm, rain) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.windG.gain.setTargetAtTime(0.03 + storm * 0.08 * (0.7 + 0.3 * Math.sin(t * 0.5) * Math.sin(t * 0.23)), t, 0.4); this.windF.frequency.setTargetAtTime(300 + storm * 300 + Math.sin(t * 0.7) * 120, t, 0.4);
    this.rainG.gain.setTargetAtTime(0.012 + rain * 0.05, t, 0.5); this.seaG.gain.setTargetAtTime(0.06 + storm * 0.08, t, 0.5);
  }
  surf(v) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(200, t + 2); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 2.5); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 2.6); }
  thunder(dist) {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime + dist / 340, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), v = Math.max(0.15, 0.9 - dist / 3000);
    s.buffer = this.noise; f.type = "lowpass"; f.frequency.setValueAtTime(dist < 600 ? 2000 : 600, t); f.frequency.exponentialRampToValueAtTime(90, t + 3); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.05);
    for (let k = 1; k < 5; k++) g.gain.linearRampToValueAtTime(v * (0.4 + Math.random() * 0.6) / k, t + k * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4.5); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 4.6);
  }
  horn() {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, v] of [[92, 0.22], [92.6, 0.18], [184, 0.06]]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 500; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.3); g.gain.setValueAtTime(v, t + 2.2); g.gain.linearRampToValueAtTime(0, t + 3); o.connect(lp).connect(g).connect(this.sfx); o.start(t); o.stop(t + 3.1); }
  }
  bell(v = 0.06) { if (!this.ok) return; const t = this.ctx.currentTime; for (const k of [0, 0.35]) this.piano(81, t + k, v, this.sfx); }
  saved(combo) { if (!this.ok) return; const t = this.ctx.currentTime; [62, 65, 69, 74, 77].slice(0, 2 + Math.min(3, combo)).forEach((n, i) => this.piano(n + 12, t + i * 0.1, 0.12, this.sfx)); }
  wreck() {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = "lowpass"; f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(100, t + 1.2); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 1.7);
    [62, 61, 57].forEach((n, i) => this.piano(n, t + 0.3 + i * 0.3, 0.1, this.sfx));
  }
  click() { if (!this.ok) return; this.piano(86, this.ctx.currentTime, 0.06, this.sfx); }
  star(i) { if (!this.ok) return; this.piano([74, 78, 81][i], this.ctx.currentTime, 0.14, this.sfx); }
}
