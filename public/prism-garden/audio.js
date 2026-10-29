// Prism Garden sound (Web Audio, all synthesized): crickets and a soft wind, a faint hum that grows with the beams,
// glassy chimes when a mirror turns (pitch by orientation), lotus bloom chords, and a slow harp-and-pad score in a
// pentatonic mode.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [60, 62, 65, 67, 69, 72, 74, 77, 79, 81];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Prism Garden: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.45; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.45 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ws = ctx.createBufferSource(); ws.buffer = this.noise; ws.loop = true; const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 350; wf.Q.value = 0.5; const wg = ctx.createGain(); wg.gain.value = 0.02; ws.connect(wf).connect(wg).connect(this.master); ws.start();
    // beam hum
    this.humO = ctx.createOscillator(); this.humO.type = "sine"; this.humO.frequency.value = 110; this.humG = ctx.createGain(); this.humG.gain.value = 0;
    const h2 = ctx.createOscillator(); h2.frequency.value = 165.5; h2.connect(this.humG); this.humO.connect(this.humG).connect(this.master); this.humO.start(); h2.start();
    this.next = ctx.currentTime + 0.5; this.step = 0; this.crT = ctx.currentTime + 1;
    this.timer = setInterval(() => this.tick(), 120);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.45 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  bell(f, t, v, dest = this.sfx, dur = 2.5) {
    const ctx = this.ctx;
    for (const [m, a] of [[1, 1], [2.01, 0.4], [3.98, 0.15], [5.2, 0.06]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f * m; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / m); o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.1); }
  }
  harp(n, t, v) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 2400; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4); o.connect(lp).connect(g).connect(this.mus); o.start(t); o.stop(t + 2.5); }
  pad(n, t, d, v) { const ctx = this.ctx; for (const det of [0, 0.004]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(n) * (1 + det); lp.type = "lowpass"; lp.frequency.value = 600; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + d * 0.4); g.gain.linearRampToValueAtTime(0, t + d); o.connect(lp).connect(g).connect(this.mus); o.start(t); o.stop(t + d + 0.1); } }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    if (this.music > 0) while (this.next < ctx.currentTime + 0.3) {
      const t = this.next, k = this.step % 16;
      if (k === 0) { const root = [48, 45, 41, 43][Math.floor(this.step / 16) % 4]; this.pad(root, t, 9, 0.02); this.pad(root + 7, t, 9, 0.014); }
      if (Math.random() < 0.55) this.harp(PENTA[Math.floor(Math.random() * PENTA.length)], t, 0.05 + Math.random() * 0.03);
      this.step++; this.next += 0.55;
    }
    if (ctx.currentTime > this.crT) { this.crT = ctx.currentTime + 0.6 + Math.random() * 2; this.cricket(); }
  }
  cricket() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, f = 4200 + Math.random() * 600; for (let i = 0; i < 3; i++) { const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.07; o.frequency.value = f; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.008, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.04); o.connect(g).connect(this.master); o.start(s); o.stop(s + 0.05); } }
  hum(n) { if (!this.ctx) return; this.humG.gain.setTargetAtTime(Math.min(0.03, n * 0.003), this.ctx.currentTime, 0.3); }
  chime(r) { if (!this.ok) return; this.bell(midi(r ? 79 : 84) * (1 + (Math.random() - 0.5) * 0.01), this.ctx.currentTime, 0.08); }
  place() { if (!this.ok) return; const t = this.ctx.currentTime; this.bell(midi(72), t, 0.08); this.thunk(); }
  thunk() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.16); }
  bloom(n) { if (!this.ok) return; const t = this.ctx.currentTime; [72, 76, 79, 84].slice(0, Math.min(4, 1 + n)).forEach((m, i) => this.bell(midi(m), t + i * 0.08, 0.06)); }
  win() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 64, 67, 72, 76, 79, 84, 88].forEach((m, i) => this.bell(midi(m), t + i * 0.11, 0.07, this.sfx, 3.5)); }
  rise() { if (!this.ok) return; const t = this.ctx.currentTime; [55, 62, 67].forEach((m, i) => this.bell(midi(m), t + i * 0.2, 0.04, this.sfx, 3)); }
  star(i) { if (!this.ok) return; this.bell(midi([84, 88, 91][i]), this.ctx.currentTime, 0.09); }
  click() { if (!this.ok) return; this.bell(midi(96), this.ctx.currentTime, 0.03, this.sfx, 0.4); }
}
