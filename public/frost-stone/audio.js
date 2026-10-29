// Frost Stone sound (Web Audio, all synthesized): stone rumble whose pitch follows speed, granite clacks, brush
// strokes, a wind bed, a slow pad of glassy bells under the aurora, chimes for points.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [43, 50, 55, 58, 62], [45, 52, 57, 61, 64]];   // Dm  Bb  Gm  A

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Frost Stone: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.35; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loop = (f, type, q, g0) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = g0; s.connect(F).connect(G); s.start(); return [F, G]; };
    // wind
    [this.windF, this.windG] = loop(380, "bandpass", 0.5, 0.025); this.windG.connect(this.master);
    // stone rumble: low-passed noise + a sub sine, both follow speed
    [this.rumF, this.rumG] = loop(120, "lowpass", 1.5, 0); this.rumG.connect(this.sfx);
    this.sub = ctx.createOscillator(); this.sub.type = "sine"; this.sub.frequency.value = 42; this.subG = ctx.createGain(); this.subG.gain.value = 0; this.sub.connect(this.subG).connect(this.sfx); this.sub.start();
    // brush
    [this.brF, this.brG] = loop(2400, "bandpass", 1.2, 0); this.brG.connect(this.sfx);
    this.chord = 0; this.next = ctx.currentTime + 0.5;
    this.timer = setInterval(() => this.tick(), 150);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  bell(f, t, v = 0.05, dest = this.mus, dur = 3.5) {
    const ctx = this.ctx;
    for (const [m, a] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
      o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  pad(n, t, d, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "sawtooth"; o2.type = "triangle"; o.frequency.value = midi(n); o2.frequency.value = midi(n) * 1.003; lp.type = "lowpass"; lp.frequency.value = 700;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + d * 0.4); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.mus); o.start(t); o2.start(t); o.stop(t + d + 0.1); o2.stop(t + d + 0.1);
  }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    while (this.next < ctx.currentTime + 0.4) {
      const t = this.next, ch = CHORDS[this.chord % CHORDS.length];
      this.pad(ch[0] - 12, t, 8.5, 0.035); this.pad(ch[2], t, 8.5, 0.018);
      for (let k = 0; k < 5; k++) if (Math.random() < 0.7) this.bell(midi(ch[(Math.random() * ch.length) | 0] + 24), t + k * 1.6 + Math.random() * 0.4, 0.025 + Math.random() * 0.02);
      this.chord++; this.next += 8;
    }
  }
  // continuous: v = fastest stone speed (m/s), sweep 0..1
  update(v, sweep, wind = 0.5) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1, v / 3);
    this.rumG.gain.setTargetAtTime(v > 0.02 ? 0.12 + k * 0.25 : 0, t, 0.08); this.rumF.frequency.setTargetAtTime(90 + k * 260, t, 0.1);
    this.subG.gain.setTargetAtTime(v > 0.02 ? 0.05 + k * 0.08 : 0, t, 0.1); this.sub.frequency.setTargetAtTime(36 + k * 30, t, 0.1);
    this.brG.gain.setTargetAtTime(sweep * (0.18 + 0.12 * Math.abs(Math.sin(t * 15))), t, 0.02);
    this.windG.gain.setTargetAtTime(0.02 + wind * 0.02, t, 0.5); this.windF.frequency.setTargetAtTime(300 + 200 * Math.sin(t * 0.3), t, 0.5);
  }
  clack(s) {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, v = Math.min(1, s / 2.5) * 0.7 + 0.08;
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 2;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.15);
    for (const fr of [880, 1370, 2210]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = fr * (0.97 + Math.random() * 0.06); og.gain.setValueAtTime(v * 0.25, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.18); o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.2); }
  }
  release() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.25); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.35); }
  click() { if (!this.ok) return; this.bell(midi(86), this.ctx.currentTime, 0.04, this.sfx, 0.6); }
  tick2() { if (!this.ok) return; this.bell(midi(93), this.ctx.currentTime, 0.02, this.sfx, 0.25); }
  chime(n) { if (!this.ok) return; const t = this.ctx.currentTime; [74, 78, 81, 86, 90].slice(0, Math.max(1, n + 1)).forEach((m, i) => this.bell(midi(m), t + i * 0.13, 0.07, this.sfx, 2.5)); }
  sad() { if (!this.ok) return; const t = this.ctx.currentTime; [69, 65, 62].forEach((m, i) => this.bell(midi(m), t + i * 0.22, 0.05, this.sfx, 2)); }
  fanfare(win) { if (!this.ok) return; const t = this.ctx.currentTime, seq = win ? [62, 66, 69, 74, 78, 81, 86] : [62, 65, 69, 67, 62]; seq.forEach((m, i) => this.bell(midi(m), t + i * 0.16, 0.08, this.sfx, 3)); }
}
