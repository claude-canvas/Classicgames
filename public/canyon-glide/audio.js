// Canyon Glide sound (Web Audio, all synthesized): wind that rises with airspeed, paper flutter at high speed, ring
// chimes that climb with the chain, a thermal "whoomph", boosts, near-miss whooshes, the crash crumple, and a warm
// desert score of plucked strings over a drone.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 67, 69];   // D dorian-ish

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Canyon Glide: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 3.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.45; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.3; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.45 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loop = (f, type, q, dest) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = 0; s.connect(F).connect(G).connect(dest); s.start(0, Math.random()); return [F, G]; };
    [this.windF, this.windG] = loop(500, "bandpass", 0.7, this.master);
    [this.flutF, this.flutG] = loop(1800, "bandpass", 4, this.sfx);
    this.strings = {};
    for (const n of SCALE.concat(SCALE.map((x) => x + 12))) {
      const f = midi(n), N = Math.round(ctx.sampleRate / f), L = Math.floor(ctx.sampleRate * 2.4), b = ctx.createBuffer(1, L, ctx.sampleRate), d = b.getChannelData(0);
      const ring = new Float32Array(N); for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
      for (let i = 0; i < L; i++) { const k = i % N, nx = (k + 1) % N; d[i] = ring[k]; ring[k] = (ring[k] + ring[nx]) * 0.498; }
      this.strings[n] = b;
    }
    for (const [n, v] of [[38, 0.05], [45, 0.03]]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(n); lp.type = "lowpass"; lp.frequency.value = 300; g.gain.value = v; o.connect(lp).connect(g).connect(this.mus); o.start(); }
    this.next = ctx.currentTime + 0.5; this.step = 0;
    this.timer = setInterval(() => this.tick(), 100);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.45 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  pluck(n, t, v, dest = this.mus) { const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); s.buffer = this.strings[n] || this.strings[62]; lp.type = "lowpass"; lp.frequency.value = 3000; g.gain.value = v; s.connect(lp).connect(g).connect(dest); s.start(t); }
  tick() {
    const ctx = this.ctx; if (!ctx || this.music <= 0) return;
    while (this.next < ctx.currentTime + 0.25) {
      const t = this.next, k = this.step % 8;
      if (k === 0 || Math.random() < 0.45) this.pluck(SCALE[(this.step * 3 + Math.floor(Math.random() * 4)) % SCALE.length] + (k === 0 ? 0 : 12), t, 0.12 + Math.random() * 0.06);
      this.step++; this.next += 0.32 + (k === 7 ? 0.32 : 0);
    }
  }
  fly(v, brake) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1, v / 50);
    this.windG.gain.setTargetAtTime(0.03 + k * 0.16 + (brake ? 0.05 : 0), t, 0.1); this.windF.frequency.setTargetAtTime(300 + k * 1200, t, 0.1);
    this.flutG.gain.setTargetAtTime(Math.max(0, k - 0.5) * 0.08 * (0.6 + 0.4 * Math.sin(t * 40)), t, 0.03); this.flutF.frequency.setTargetAtTime(1200 + k * 1500, t, 0.1);
  }
  ring(chain) { if (!this.ok) return; const t = this.ctx.currentTime, n = SCALE[Math.min(SCALE.length - 1, chain % 12)] + 12; this.pluck(n, t, 0.35, this.sfx); this.pluck(n + 7 > 81 ? n : n + 7, t + 0.07, 0.2, this.sfx); }
  gate() { if (!this.ok) return; const t = this.ctx.currentTime; [62, 66, 69, 74].forEach((n, i) => this.pluck(n, t + i * 0.06, 0.3, this.sfx)); this.whoosh(0.3); }
  whoosh(v = 0.15) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.25); f.frequency.exponentialRampToValueAtTime(500, t + 0.6); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.75); }
  thermal() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.8); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.3); }
  crash() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime; for (let i = 0; i < 8; i++) { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), st = t + i * 0.035; s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 2; g.gain.setValueAtTime(0.3, st); g.gain.exponentialRampToValueAtTime(0.001, st + 0.08); s.connect(f).connect(g).connect(this.sfx); s.start(st, Math.random()); s.stop(st + 0.1); } [57, 53, 50].forEach((n, i) => this.pluck(n, t + 0.3 + i * 0.2, 0.3, this.sfx)); }
  click() { if (!this.ok) return; this.pluck(74, this.ctx.currentTime, 0.2, this.sfx); }
}
