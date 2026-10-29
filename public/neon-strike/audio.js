// Neon Strike sound (Web Audio, all synthesized): ball roll rumble that follows speed, the clatter of pins (many
// short wooden knocks), the pinsetter, a crowd cheer for strikes, and synthwave music (arpeggio, bass, gated pad).

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PROG = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59]];   // Am F G Em

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Neon Strike: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.35; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.3; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.45 * this.music; this.mus.connect(this.master); const mv = ctx.createGain(); mv.gain.value = 0.4; this.mus.connect(mv).connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // rolling rumble
    const rs = ctx.createBufferSource(); rs.buffer = this.noise; rs.loop = true;
    this.rollF = ctx.createBiquadFilter(); this.rollF.type = "lowpass"; this.rollF.frequency.value = 120; this.rollF.Q.value = 2;
    this.rollG = ctx.createGain(); this.rollG.gain.value = 0; rs.connect(this.rollF).connect(this.rollG).connect(this.sfx); rs.start();
    this.sub = ctx.createOscillator(); this.sub.frequency.value = 40; this.subG = ctx.createGain(); this.subG.gain.value = 0; this.sub.connect(this.subG).connect(this.sfx); this.sub.start();
    // crowd murmur bed
    const cs = ctx.createBufferSource(); cs.buffer = this.noise; cs.loop = true; const cf = ctx.createBiquadFilter(); cf.type = "bandpass"; cf.frequency.value = 700; cf.Q.value = 0.8;
    this.crowdG = ctx.createGain(); this.crowdG.gain.value = 0.012; cs.connect(cf).connect(this.crowdG).connect(this.master); cs.start();
    this.step = 0; this.next = ctx.currentTime + 0.3; this.bpm = 100;
    this.timer = setInterval(() => this.tick(), 60);
    this.knockT = 0;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.45 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  synth(f, t, d, v, type = "sawtooth", cut = 1800, dest = this.mus) {
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o2.type = type; o.frequency.value = f; o2.frequency.value = f * 1.006; lp.type = "lowpass"; lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.3), t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(dest); o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    const sp = 60 / this.bpm / 4;
    while (this.next < ctx.currentTime + 0.15) {
      const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4, ch = PROG[bar];
      this.synth(midi(ch[1 + (s % 4)] + 12), t, sp * 0.9, 0.035, "sawtooth", 2600);                      // arpeggio
      if (s % 4 === 0) this.synth(midi(ch[0] - 12), t, sp * 3.5, 0.09, "sawtooth", 500);                 // bass
      if (s % 2 === 1) this.synth(midi(ch[0]), t, sp * 0.7, 0.03, "square", 900);                       // off-beat pluck
      if (s === 0) for (const n of ch.slice(1, 4)) this.synth(midi(n), t, sp * 15, 0.018, "sawtooth", 1200);   // pad
      if (s % 4 === 0) this.kick(t); if (s % 8 === 4) this.snare(t); if (s % 2 === 0) this.hat(t);
      this.step++; this.next += sp;
    }
  }
  kick(t) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g).connect(this.mus); o.start(t); o.stop(t + 0.2); }
  snare(t) { const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1800; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); s.connect(f).connect(g).connect(this.mus); s.start(t, Math.random()); s.stop(t + 0.16); }
  hat(t) { const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 7000; g.gain.setValueAtTime(0.02, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); s.connect(f).connect(g).connect(this.mus); s.start(t, Math.random()); s.stop(t + 0.05); }
  roll(v) { if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1, v / 9); this.rollG.gain.setTargetAtTime(v > 0.1 ? 0.25 + k * 0.3 : 0, t, 0.05); this.rollF.frequency.setTargetAtTime(80 + k * 220, t, 0.05); this.subG.gain.setTargetAtTime(v > 0.1 ? 0.08 + k * 0.08 : 0, t, 0.05); this.sub.frequency.setTargetAtTime(32 + k * 25, t, 0.05); }
  knock(s, slow = 1) {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.knockT < 0.012) return; this.knockT = t;
    const v = Math.min(0.5, 0.06 + s * 0.06), f = 500 + Math.random() * 1100;
    const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = f / slow;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09 * slow); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.1 * slow);
    const n = ctx.createBufferSource(), ng = ctx.createGain(); n.buffer = this.noise; bp.type = "bandpass"; bp.frequency.value = (2000 + Math.random() * 2000) / slow; bp.Q.value = 3;
    ng.gain.setValueAtTime(v * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05 * slow); n.connect(bp).connect(ng).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.06 * slow);
  }
  boom() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.45); }
  cheer(big) {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), v = big ? 0.22 : 0.1;
    s.buffer = this.noise; s.loop = true; f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.6;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.3); g.gain.linearRampToValueAtTime(v * 0.6, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 2.6);
    s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 2.7);
    if (big) [72, 76, 79, 84].forEach((n, i) => this.synth(midi(n), t + i * 0.09, 0.4, 0.06, "square", 3000, this.sfx));
  }
  sweep() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.setValueAtTime(60, t); o.frequency.linearRampToValueAtTime(95, t + 0.6); o.frequency.linearRampToValueAtTime(60, t + 1.6); lp.type = "lowpass"; lp.frequency.value = 400; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 1.7); o.connect(lp).connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.8); }
  gutter() { if (!this.ok) return; const t = this.ctx.currentTime; [64, 60, 57].forEach((n, i) => this.synth(midi(n), t + i * 0.15, 0.3, 0.05, "square", 1500, this.sfx)); }
  click() { if (!this.ok) return; this.synth(midi(84), this.ctx.currentTime, 0.12, 0.05, "square", 3000, this.sfx); }
}
