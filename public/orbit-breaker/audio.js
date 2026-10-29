// Orbit Breaker sound (Web Audio, all synthesized): pentatonic blips that climb with the combo, crystal shatter,
// metal clang, bomb boom, paddle thunk, laser zaps, power-up chimes, and a pulsing synthwave bed.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Orbit Breaker: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.35 * this.music; this.mus.connect(this.master);
    this.dly = ctx.createDelay(1); this.dly.delayTime.value = 0.28; const fb = ctx.createGain(); fb.gain.value = 0.3; this.dly.connect(fb).connect(this.dly); fb.connect(this.master); this.sfx.connect(this.dly);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.step = 0; this.next = ctx.currentTime + 0.2; this.timer = setInterval(() => this.tick(), 60);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.35 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  tone(f, t, d, v, type = "square", dest = this.sfx, cut = 4000) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = type; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = cut; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.02); }
  noiseHit(t, d, v, f, q = 1, type = "bandpass") { const ctx = this.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d); s.connect(fl).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02); }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    const spb = 60 / 112 / 4;
    while (this.next < ctx.currentTime + 0.15) {
      const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4, root = [45, 41, 43, 40][bar];
      if (s % 2 === 0) this.tone(midi(root - 12 + (s % 4 ? 12 : 0)), t, spb * 1.6, 0.08, "sawtooth", this.mus, 600);
      if (s % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.1); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(g).connect(this.mus); o.start(t); o.stop(t + 0.16); }
      if (s % 3 === 0) this.tone(midi(root + 24 + PENTA[(this.step * 7) % 5]), t, spb * 0.9, 0.025, "triangle", this.mus);
      this.step++; this.next += spb;
    }
  }
  blip(combo) { if (!this.ok) return; const n = 72 + PENTA[combo % 5] + 12 * Math.min(2, Math.floor(combo / 5)); this.tone(midi(n), this.ctx.currentTime, 0.18, 0.08); }
  shatter() { if (!this.ok) return; const t = this.ctx.currentTime; this.noiseHit(t, 0.25, 0.25, 5000, 2); for (let i = 0; i < 3; i++) this.tone(2000 + Math.random() * 3000, t + i * 0.02, 0.15, 0.03, "sine"); }
  crack() { if (!this.ok) return; this.noiseHit(this.ctx.currentTime, 0.08, 0.15, 3000, 3); }
  clang() { if (!this.ok) return; const t = this.ctx.currentTime; for (const f of [520, 790, 1240]) this.tone(f, t, 0.4, 0.05, "triangle"); }
  boom() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.72); this.noiseHit(t, 0.6, 0.4, 400, 0.7, "lowpass"); }
  paddle() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(220, t, 0.1, 0.12, "sine"); this.tone(330, t, 0.08, 0.05, "square"); }
  laser() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.12); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.14); }
  power() { if (!this.ok) return; const t = this.ctx.currentTime; [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.05, 0.25, 0.06, "triangle")); }
  lost() { if (!this.ok) return; const t = this.ctx.currentTime; [64, 60, 55, 48].forEach((n, i) => this.tone(midi(n), t + i * 0.1, 0.3, 0.08, "sawtooth", this.sfx, 1500)); }
  clear() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.5, 0.07, "square", this.sfx, 3000)); }
  ui() { if (!this.ok) return; this.tone(midi(84), this.ctx.currentTime, 0.1, 0.05); }
}
