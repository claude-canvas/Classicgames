// Neon Velocity sound (Web Audio, all synthesized): turbine engine that climbs with speed, rival ships passing
// (doppler-ish), drift hiss, turbo whoosh, wall scrapes, countdown beeps and a 132-bpm synthwave score.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Neon Velocity: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.35 * this.music; this.mus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // engine: two detuned saws + a sine sub through a filter
    this.eng = []; this.engF = ctx.createBiquadFilter(); this.engF.type = "lowpass"; this.engF.frequency.value = 600; this.engG = ctx.createGain(); this.engG.gain.value = 0;
    for (const [type, det] of [["sawtooth", 1], ["sawtooth", 1.007], ["sine", 0.5]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = 60 * det; o.det = det; o.connect(this.engF); o.start(); this.eng.push(o); }
    this.engF.connect(this.engG).connect(this.sfx);
    const loop = (f, q, type) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = 0; s.connect(F).connect(G).connect(this.sfx); s.start(); return [F, G]; };
    [this.windF, this.windG] = loop(800, 0.6, "bandpass"); [this.driftF, this.driftG] = loop(3200, 2, "bandpass"); [this.boostF, this.boostG] = loop(1500, 0.8, "bandpass");
    this.step = 0; this.next = ctx.currentTime + 0.2; this.timer = setInterval(() => this.tick(), 50);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.35 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  tone(f, t, d, v, type = "square", dest = this.mus, cut = 3000) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = type; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = cut; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.02); }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    const sp = 60 / 132 / 4;
    while (this.next < ctx.currentTime + 0.12) {
      const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4, root = [45, 41, 48, 43][bar];
      if (s % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.1); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g).connect(this.mus); o.start(t); o.stop(t + 0.2); }
      if (s % 8 === 4) { const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 2000; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); n.connect(f).connect(g).connect(this.mus); n.start(t, Math.random()); n.stop(t + 0.16); }
      if (s % 2 === 1) { const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; f.type = "highpass"; f.frequency.value = 8000; g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); n.connect(f).connect(g).connect(this.mus); n.start(t, Math.random()); n.stop(t + 0.05); }
      this.tone(midi(root - 12 + (s % 2 ? 12 : 0)), t, sp * 0.9, 0.09, "sawtooth", this.mus, 700);
      this.tone(midi(root + 12 + [0, 7, 12, 15, 19, 15, 12, 7][s % 8]), t, sp * 0.8, 0.025, "square", this.mus, 2500);
      this.step++; this.next += sp;
    }
  }
  update(v, drift, boost) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1.3, v / 96);
    for (const o of this.eng) o.frequency.setTargetAtTime((55 + k * 160) * o.det, t, 0.05);
    this.engF.frequency.setTargetAtTime(400 + k * 2200, t, 0.05); this.engG.gain.setTargetAtTime(0.05 + k * 0.06, t, 0.1);
    this.windG.gain.setTargetAtTime(k * 0.06, t, 0.1); this.windF.frequency.setTargetAtTime(500 + k * 1500, t, 0.1);
    this.driftG.gain.setTargetAtTime(drift * 0.07, t, 0.05); this.boostG.gain.setTargetAtTime(boost ? 0.14 : 0, t, 0.08);
  }
  turbo(l) { if (!this.ok) return; const t = this.ctx.currentTime; [72, 76, 79, 84].slice(0, l + 1).forEach((n, i) => this.tone(midi(n), t + i * 0.05, 0.2, 0.06, "square", this.sfx)); }
  wall(h) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 900; g.gain.setValueAtTime(Math.min(0.4, 0.08 + h * 0.015), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.32); }
  bump() { if (!this.ok) return; this.tone(90, this.ctx.currentTime, 0.15, 0.15, "sine", this.sfx); }
  beep(go) { if (!this.ok) return; this.tone(go ? 1320 : 660, this.ctx.currentTime, go ? 0.6 : 0.25, 0.12, "square", this.sfx); }
  lap() { if (!this.ok) return; const t = this.ctx.currentTime; [76, 81, 88].forEach((n, i) => this.tone(midi(n), t + i * 0.08, 0.3, 0.08, "triangle", this.sfx)); }
  finish(p) { if (!this.ok) return; const t = this.ctx.currentTime; (p === 1 ? [72, 76, 79, 84, 88, 91] : [72, 76, 79, 76]).forEach((n, i) => this.tone(midi(n), t + i * 0.12, 0.6, 0.08, "square", this.sfx)); }
}
