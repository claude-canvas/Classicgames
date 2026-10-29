// Lantern Bow sound (Web Audio, all synthesized). Koto plucks are Karplus–Strong strings in the Japanese 'in'
// scale; a breathy shakuhachi-like flute drifts over them. Bow creak, string twang, thunk, gong, lanterns, fireworks.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const IN = [52, 53, 57, 59, 60, 64, 65, 69, 71, 72, 76];

export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; this.night = 0; }
  init() { try { this._init(); } catch (e) { console.warn("Lantern Bow: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.45; this.verb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); const sv = ctx.createGain(); sv.gain.value = 0.3; this.sfx.connect(sv).connect(this.verb);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // koto strings (Karplus–Strong), one buffer per scale note
    this.koto = {};
    for (const n of IN) {
      const f = midi(n), N = Math.round(ctx.sampleRate / f), L = Math.floor(ctx.sampleRate * 2.6), b = ctx.createBuffer(1, L, ctx.sampleRate), d = b.getChannelData(0);
      const ring = new Float32Array(N); for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
      for (let i = 0; i < L; i++) { const k = i % N, nx = (k + 1) % N; d[i] = ring[k]; ring[k] = (ring[k] + ring[nx]) * 0.4985; }
      this.koto[n] = b;
    }
    // wind bed
    const ws = ctx.createBufferSource(); ws.buffer = this.noise; ws.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = "bandpass"; this.windF.frequency.value = 400; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.02; ws.connect(this.windF).connect(this.windG).connect(this.master); ws.start();
    // bow creak (continuous while drawing)
    const cs = ctx.createBufferSource(); cs.buffer = this.noise; cs.loop = true;
    this.creakF = ctx.createBiquadFilter(); this.creakF.type = "bandpass"; this.creakF.frequency.value = 300; this.creakF.Q.value = 12;
    this.creakG = ctx.createGain(); this.creakG.gain.value = 0; cs.connect(this.creakF).connect(this.creakG).connect(this.sfx); cs.start();
    this.beat = 0; this.next = ctx.currentTime + 0.8; this.phrase = 0;
    this.timer = setInterval(() => this.tick(), 120);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  pluck(n, t, v = 0.3, dest = this.mus) {
    const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    s.buffer = this.koto[n] || this.koto[64]; lp.type = "lowpass"; lp.frequency.value = 3200;
    g.gain.value = v; s.connect(lp).connect(g).connect(dest); s.start(t);
  }
  flute(f, t, d, v = 0.05) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    o.type = "sine"; o.frequency.value = f; vib.frequency.value = 5; vg.gain.value = f * 0.012; vib.connect(vg).connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.35); g.gain.setValueAtTime(v, t + d - 0.4); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(g).connect(this.mus); o.start(t); o.stop(t + d + 0.1); vib.start(t); vib.stop(t + d + 0.1);
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise; nf.type = "bandpass"; nf.frequency.value = f * 2; nf.Q.value = 3; ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(v * 0.6, t + 0.1); ng.gain.linearRampToValueAtTime(0, t + d);
    n.connect(nf).connect(ng).connect(this.mus); n.start(t, Math.random()); n.stop(t + d + 0.1);
  }
  tick() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.windF.frequency.setTargetAtTime(320 + 200 * Math.sin(t * 0.21) + 80 * Math.sin(t * 0.53), t, 0.5);
    // ambience: evening birds by day, crickets at night
    if (this.ok && Math.random() < (this.night > 0.5 ? 0.5 : 0.08)) {
      if (this.night > 0.5) for (let i = 0; i < 3; i++) this.tone(4200 + Math.random() * 300, t + i * 0.06, 0.03, 0.008);
      else { const f = 2600 + Math.random() * 1600; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(f * (1 + i * 0.08), t + i * 0.11, 0.07, 0.012, f * 1.3); }
    }
    while (this.next < t + 0.5) {
      const spb = 0.62, b = this.beat % 16;
      if ([0, 3, 6, 8, 11, 14].includes(b) && Math.random() < 0.85) {
        const idx = (this.phrase * 3 + b) % IN.length, n = IN[Math.min(IN.length - 1, idx)];
        this.pluck(n, this.next, 0.22); if (b === 0) this.pluck(n - 12 >= 52 ? n - 12 : n, this.next, 0.18);
        if (Math.random() < 0.25) this.pluck(IN[(idx + 2) % IN.length], this.next + spb * 0.5, 0.12);
      }
      if (b === 4 && this.phrase % 2 === 1) this.flute(midi(IN[(this.phrase + 5) % IN.length] + 12), this.next, spb * 6, 0.035);
      this.beat++; this.next += spb; if (this.beat % 16 === 0) this.phrase++;
    }
  }
  tone(f, t, d, v, f2) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(this.master); o.start(t); o.stop(t + d + 0.02); }
  burst(t, f, q, v, d, type = "bandpass", dest = this.sfx) {
    const ctx = this.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + d + 0.05); return fl;
  }
  draw(k) { if (!this.ctx) return; const t = this.ctx.currentTime; this.creakG.gain.setTargetAtTime(this.ok ? k * 0.12 * (0.6 + Math.random() * 0.4) : 0, t, 0.05); this.creakF.frequency.setTargetAtTime(180 + k * 260, t, 0.05); }
  release(power) {
    this.draw(0); if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.pluck(40 + 12, t, 0.5 * power, this.sfx);                // the string
    const f = this.burst(t, 1800, 1.2, 0.25 * power, 0.35); f.frequency.exponentialRampToValueAtTime(500, t + 0.35);   // whoosh
    this.burst(t, 120, 1, 0.4, 0.06, "lowpass");
  }
  thunk(rings) { if (!this.ok) return; const t = this.ctx.currentTime; this.burst(t, 180, 1, 0.9, 0.12, "lowpass"); this.burst(t, 2400, 2, 0.25, 0.08); if (rings) [0, 4, 7].forEach((k, i) => this.pluck(IN[5 + i] , t + 0.05 + i * 0.07, 0.25, this.sfx)); }
  miss() { if (!this.ok) return; const t = this.ctx.currentTime; this.burst(t, 400, 0.8, 0.3, 0.15, "lowpass"); }
  gong() {
    if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime;
    for (const [m, a, d] of [[1, 1, 6], [1.48, 0.6, 4.5], [2.04, 0.45, 3.5], [2.76, 0.3, 2.6], [3.6, 0.2, 2], [0.5, 0.5, 7]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(110 * m, t); o.frequency.exponentialRampToValueAtTime(110 * m * 0.985, t + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.sfx); o.start(t); o.stop(t + d + 0.1);
    }
    this.burst(t, 900, 0.7, 0.4, 0.3);
  }
  pop() { if (!this.ok) return; const t = this.ctx.currentTime; this.burst(t, 900, 1, 0.5, 0.18); for (let i = 0; i < 8; i++) this.burst(t + 0.05 + Math.random() * 0.5, 2500 + Math.random() * 3000, 6, 0.05, 0.03); this.pluck(IN[8], t, 0.2, this.sfx); }
  launch() { if (!this.ok) return; const t = this.ctx.currentTime, f = this.burst(t, 600, 2, 0.06, 2.0); f.frequency.exponentialRampToValueAtTime(2400, t + 2); }
  boom(dist = 1) {
    if (!this.ok) return; const t = this.ctx.currentTime + 0.25 * dist;
    this.burst(t, 90, 0.7, 0.8, 1.6, "lowpass"); this.burst(t, 400, 0.5, 0.3, 0.5, "lowpass");
    for (let i = 0; i < 26; i++) this.burst(t + 0.4 + Math.random() * 1.4, 3000 + Math.random() * 4000, 8, 0.035, 0.025);
  }
  combo(n) { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < Math.min(4, n); i++) this.pluck(IN[6 + i], t + i * 0.06, 0.18, this.sfx); }
  star(i) { if (!this.ok) return; const t = this.ctx.currentTime; this.pluck(IN[7 + i], t, 0.4, this.sfx); this.pluck(IN[4 + i], t, 0.3, this.sfx); }
  click() { if (!this.ok) return; this.burst(this.ctx.currentTime, 3000, 3, 0.08, 0.03); }
}
