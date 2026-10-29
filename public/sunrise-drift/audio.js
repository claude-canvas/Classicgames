// Sunrise Drift sound (Web Audio, all synthesized): the propane burner roar, the parachute vent, wind, birds in the
// morning, distant burners of the festival, marker thumps, chimes. Music: a slow drone with plucked saz-like strings
// in a Hijaz mode.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const HIJAZ = [50, 51, 54, 55, 57, 58, 60, 62, 63, 66, 67, 69];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; this.birds = 1; }
  init() { try { this._init(); } catch (e) { console.warn("Sunrise Drift: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 3.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.25; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loop = (f, type, q, g0, dest) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = g0; s.connect(F).connect(G).connect(dest); s.start(); return [F, G]; };
    [this.windF, this.windG] = loop(500, "bandpass", 0.4, 0.03, this.master);
    // burner: a low roar + a hissing top + a rumbling sub
    [this.roarF, this.roarG] = loop(220, "lowpass", 0.9, 0, this.sfx);
    [this.hissF, this.hissG] = loop(3200, "bandpass", 0.7, 0, this.sfx);
    [this.ventF, this.ventG] = loop(900, "bandpass", 2, 0, this.sfx);
    // saz strings
    this.saz = {};
    for (const n of HIJAZ.concat(HIJAZ.map((x) => x + 12))) {
      const f = midi(n), N = Math.round(ctx.sampleRate / f), L = Math.floor(ctx.sampleRate * 2.2), b = ctx.createBuffer(1, L, ctx.sampleRate), d = b.getChannelData(0);
      const ring = new Float32Array(N); for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
      for (let i = 0; i < L; i++) { const k = i % N, nx = (k + 1) % N; d[i] = ring[k]; ring[k] = (ring[k] + ring[nx]) * 0.4975; }
      this.saz[n] = b;
    }
    // drone
    for (const [n, v] of [[38, 0.05], [45, 0.03], [50, 0.02]]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 380; g.gain.value = v; o.connect(lp).connect(g).connect(this.mus); o.start(); }
    this.next = ctx.currentTime + 1; this.step = 0; this.birdT = ctx.currentTime + 2;
    this.timer = setInterval(() => this.tick(), 120);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  pluck(n, t, v = 0.25, dest = this.mus) { const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); s.buffer = this.saz[n] || this.saz[62]; lp.type = "lowpass"; lp.frequency.value = 2600; g.gain.value = v; s.connect(lp).connect(g).connect(dest); s.start(t); }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    if (this.music > 0) while (this.next < ctx.currentTime + 0.3) {
      const t = this.next, phrase = Math.floor(this.step / 8) % 4, k = this.step % 8;
      if (Math.random() < (k === 0 ? 1 : 0.55)) {
        const base = [0, 2, 4, 3][phrase], i = Math.max(0, Math.min(HIJAZ.length - 1, base + Math.floor(Math.random() * 5)));
        this.pluck(HIJAZ[i] + 12, t, 0.12 + Math.random() * 0.06);
        if (Math.random() < 0.3) this.pluck(HIJAZ[i] + 12, t + 0.09, 0.07);   // a quick double-pluck ornament
      }
      this.step++; this.next += 0.42 + (k === 7 ? 0.5 : 0);
    }
    // morning birds
    if (this.birds > 0 && ctx.currentTime > this.birdT) { this.birdT = ctx.currentTime + 1.5 + Math.random() * 5; this.bird(); }
  }
  bird() {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, f0 = 2400 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) { const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.13; o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), s + 0.07); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.012 * this.birds, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.1); o.connect(g).connect(this.sfx); o.start(s); o.stop(s + 0.12); }
  }
  // continuous state: burner on/off, vent, wind strength 0..1, near (camera close to the burner) 0..1
  update(burn, vent, wind, near = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, b = burn ? 1 : 0;
    this.roarG.gain.setTargetAtTime(b * (0.35 + 0.25 * near), t, burn ? 0.04 : 0.12); this.hissG.gain.setTargetAtTime(b * 0.06 * near, t, 0.05);
    this.roarF.frequency.setTargetAtTime(burn ? 260 + Math.random() * 60 : 120, t, 0.05);
    this.ventG.gain.setTargetAtTime(vent ? 0.06 : 0, t, 0.08);
    this.windG.gain.setTargetAtTime(0.015 + wind * 0.04, t, 0.4); this.windF.frequency.setTargetAtTime(400 + wind * 300 + Math.sin(t * 0.4) * 100, t, 0.4);
  }
  farBurner(v) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 300; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.2); g.gain.setValueAtTime(v, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 1.6); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 1.7); }
  thud() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.2); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.35); }
  whoosh() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.5); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.7); }
  chime(q) { if (!this.ok) return; const t = this.ctx.currentTime, seq = q > 80 ? [62, 66, 69, 74, 78] : q > 40 ? [62, 66, 69] : [62, 63]; seq.forEach((n, i) => this.pluck(n + 12, t + i * 0.1, 0.35, this.sfx)); }
  bump() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 500; g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.45); }
  click() { if (!this.ok) return; this.pluck(74, this.ctx.currentTime, 0.2, this.sfx); }
  star(i) { if (!this.ok) return; this.pluck([69, 74, 78][i] + 12, this.ctx.currentTime, 0.4, this.sfx); }
  fanfare() { if (!this.ok) return; const t = this.ctx.currentTime; [62, 66, 69, 74, 78, 81].forEach((n, i) => this.pluck(n + 12, t + i * 0.12, 0.3, this.sfx)); }
}
