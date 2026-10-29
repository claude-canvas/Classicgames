// Wisp Siege sound (Web Audio, all synthesized): lamp hum while beaming, mortar thumps and booms, bell chimes,
// tesla zaps, kill pops, leaks, wave horns, and a slow minor-key night score.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Wisp Siege: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.4; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.3; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.4 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.humO = ctx.createOscillator(); this.humO.type = "sawtooth"; this.humO.frequency.value = 110; const hl = ctx.createBiquadFilter(); hl.type = "lowpass"; hl.frequency.value = 500; this.humG = ctx.createGain(); this.humG.gain.value = 0; this.humO.connect(hl).connect(this.humG).connect(this.sfx); this.humO.start();
    this.next = ctx.currentTime + 0.5; this.step = 0; this.last = {};
    this.timer = setInterval(() => this.tick(), 120);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.4 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  limit(k, ms) { const t = performance.now(); if (this.last[k] && t - this.last[k] < ms) return false; this.last[k] = t; return true; }
  tone(f, t, d, v, type = "sine", dest = this.sfx) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.02); }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    while (this.next < ctx.currentTime + 0.3) {
      const t = this.next, bar = Math.floor(this.step / 8) % 4, root = [45, 41, 43, 40][bar], k = this.step % 8;
      if (k === 0) for (const n of [root - 12, root, root + 7]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 500; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 1); g.gain.linearRampToValueAtTime(0, t + 4.8); o.connect(lp).connect(g).connect(this.mus); o.start(t); o.stop(t + 5); }
      if (Math.random() < 0.5) this.tone(midi(root + 24 + [0, 3, 7, 10, 12][Math.floor(Math.random() * 5)]), t, 1.4, 0.03, "triangle", this.mus);
      this.step++; this.next += 0.6;
    }
  }
  hum(n) { if (!this.ctx) return; this.humG.gain.setTargetAtTime(Math.min(0.05, n * 0.012), this.ctx.currentTime, 0.1); this.humO.frequency.setTargetAtTime(110 + Math.sin(this.ctx.currentTime * 7) * 6, this.ctx.currentTime, 0.05); }
  fire() { if (!this.ok || !this.limit("fire", 80)) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.22); }
  boom() { if (!this.ok || !this.limit("boom", 70)) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 600; g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 0.42); }
  chime() { if (!this.ok || !this.limit("chime", 250)) return; const t = this.ctx.currentTime; this.tone(midi(88), t, 1.2, 0.03); this.tone(midi(95), t, 0.8, 0.015); }
  zap() { if (!this.ok || !this.limit("zap", 90)) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 3500; f.Q.value = 4; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + 0.16); }
  pop() { if (!this.ok || !this.limit("pop", 40)) return; this.tone(600 + Math.random() * 500, this.ctx.currentTime, 0.12, 0.06); }
  leak() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(150, t, 0.5, 0.2, "sawtooth"); this.tone(110, t + 0.1, 0.5, 0.15, "sawtooth"); }
  horn() { if (!this.ok) return; const t = this.ctx.currentTime; for (const n of [45, 52]) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 700; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 1.6); o.connect(lp).connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.7); } }
  build() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 67, 72].forEach((n, i) => this.tone(midi(n), t + i * 0.06, 0.4, 0.06, "triangle")); }
  coin() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(midi(84), t, 0.15, 0.06, "square"); this.tone(midi(91), t + 0.07, 0.25, 0.05, "square"); }
  fanfare(win) { if (!this.ok) return; const t = this.ctx.currentTime; (win ? [60, 64, 67, 72, 76, 79] : [64, 60, 57, 52]).forEach((n, i) => this.tone(midi(n), t + i * 0.14, 0.8, 0.07, "triangle")); }
}
