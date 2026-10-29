// Paper Brook sound (Web Audio, all synthesized): a babbling brook (several wobbling band-passed noise voices whose
// level follows the current), white-water hiss, cascade roar, evening birdsong, crickets by the pool, a soft
// pentatonic kalimba over a slow pad, and the little sounds of a paper boat.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; }
  init() { try { this._init(); } catch (e) { console.warn("Paper Brook: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.3 * this.music; this.mus.connect(this.master);
    // a short reverb for the music and birds
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loop = (f, q, type, dest = this.amb) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = 0; s.connect(F).connect(G).connect(dest); s.start(0, Math.random() * 1.5); return [F, G]; };
    this.babble = [loop(500, 3, "bandpass"), loop(900, 4, "bandpass"), loop(1400, 5, "bandpass"), loop(2300, 6, "bandpass")];
    [this.hissF, this.hissG] = loop(3500, 0.7, "bandpass"); [this.roarF, this.roarG] = loop(300, 0.5, "lowpass");
    [this.windF, this.windG] = loop(400, 0.4, "lowpass");
    this.step = 0; this.next = ctx.currentTime + 0.3; this.bird = ctx.currentTime + 2; this.cricket = 0;
    this.timer = setInterval(() => this.tick(), 60);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.3 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  tone(f, t, d, v, type = "sine", dest = this.mus, cut = 4000, a = 0.004) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = type; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = cut; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05); return g; }
  // kalimba: a sine with a quick inharmonic partial
  pluck(f, t, v, dest = this.mus) { this.tone(f, t, 1.6, v, "sine", dest); this.tone(f * 3.01, t, 0.25, v * 0.35, "sine", dest); const g = this.tone(f, t, 1.6, v * 0.5, "triangle", this.verb, 2500); void g; }
  noiseHit(t, f, q, d, v, type = "bandpass", dest = this.sfx, f2 = 0) { const ctx = this.ctx, n = ctx.createBufferSource(), F = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; F.type = type; F.frequency.setValueAtTime(f, t); if (f2) F.frequency.exponentialRampToValueAtTime(f2, t + d); F.Q.value = q; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); n.connect(F).connect(g).connect(dest); n.start(t, Math.random()); n.stop(t + d + 0.05); }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    // music: 70 bpm eighths, pentatonic kalimba over a pad that changes every 2 bars
    if (this.music > 0) {
      const sp = 60 / 70 / 2, SC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
      while (this.next < now + 0.2) {
        const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4, root = [62, 59, 55, 57][bar];
        if (s === 0) for (const iv of [0, 7, 12, 16]) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = midi(root - 12 + iv) * (1 + (Math.random() - 0.5) * 0.004); lp.type = "lowpass"; lp.frequency.value = 900; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + sp * 16 + 0.6); o.connect(lp).connect(g).connect(this.mus); g.connect(this.verb); o.start(t); o.stop(t + sp * 16 + 0.8); }
        const pat = [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0];
        if (pat[s] && Math.random() < 0.82) { this.walk = Math.max(0, Math.min(SC.length - 1, (this.walk || 4) + Math.floor(Math.random() * 5) - 2)); this.pluck(midi(root + SC[this.walk]), t, 0.06); }
        if (s === 0) this.pluck(midi(root - 12), t, 0.05);
        this.step++; this.next += sp;
      }
    }
    // birds: a phrase every few seconds, and an occasional wood pigeon
    if (now > this.bird) {
      const t = now + 0.05, base = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 5), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null, g = ctx.createGain();
      g.gain.value = 0.5; if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan).connect(this.amb); pan.connect(this.verb); } else g.connect(this.amb);
      if (Math.random() < 0.18) { for (let i = 0; i < 5; i++) { const tt = t + i * 0.42 + (i > 2 ? 0.3 : 0), o = ctx.createOscillator(), gg = ctx.createGain(); o.frequency.setValueAtTime(420, tt); o.frequency.linearRampToValueAtTime(380, tt + 0.3); gg.gain.setValueAtTime(0, tt); gg.gain.linearRampToValueAtTime(i === 1 ? 0.05 : 0.035, tt + 0.08); gg.gain.exponentialRampToValueAtTime(0.0005, tt + 0.38); o.connect(gg).connect(g); o.start(tt); o.stop(tt + 0.4); } }
      else for (let i = 0; i < n; i++) {
        const tt = t + i * (0.09 + Math.random() * 0.08), o = ctx.createOscillator(), gg = ctx.createGain(), f0 = base * (0.85 + Math.random() * 0.3);
        o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.5 : 0.7), tt + 0.07);
        gg.gain.setValueAtTime(0, tt); gg.gain.linearRampToValueAtTime(0.025, tt + 0.01); gg.gain.exponentialRampToValueAtTime(0.0005, tt + 0.09);
        o.connect(gg).connect(g); o.start(tt); o.stop(tt + 0.1);
      }
      this.bird = now + 1.5 + Math.random() * 4;
    }
    // crickets by the pool
    if (this.pool && now > this.cricket) { for (let i = 0; i < 3; i++) this.tone(4300 + Math.random() * 200, now + 0.05 + i * 0.05, 0.035, 0.01, "square", this.amb, 6000); this.cricket = now + 0.35 + Math.random() * 0.5; }
  }
  update(cur, white, casc, pool, on) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = on ? 1 : 0.5;
    this.pool = pool;
    this.babble.forEach(([F, G], i) => { G.gain.setTargetAtTime((0.05 + Math.min(cur, 4) * 0.025) * k * (0.5 + 0.5 * Math.random()), t, 0.08); F.frequency.setTargetAtTime([500, 900, 1400, 2300][i] * (0.8 + Math.random() * 0.4), t, 0.05); });
    this.hissG.gain.setTargetAtTime((white * 0.06 + Math.max(0, cur - 2.5) * 0.02) * k, t, 0.1);
    this.roarG.gain.setTargetAtTime(casc * casc * 0.35 * k, t, 0.2);
    this.windG.gain.setTargetAtTime(0.03 * k, t, 0.5);
  }
  petal(combo, gold) { if (!this.ok) return; const t = this.ctx.currentTime, b = 76 + [0, 2, 4, 7, 9][Math.min(4, combo - 1)]; this.pluck(midi(b), t, 0.09, this.sfx); this.tone(midi(b + 12), t + 0.04, 0.6, 0.03, "sine", this.verb); if (gold) [b + 4, b + 7, b + 12].forEach((n, i) => this.pluck(midi(n), t + 0.07 * (i + 1), 0.06, this.sfx)); }
  puff() { if (!this.ok) return; const t = this.ctx.currentTime; this.noiseHit(t + 0.05, 1400, 0.9, 0.3, 0.1, "bandpass", this.sfx, 500); const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(380, t + 0.05); o.frequency.exponentialRampToValueAtTime(900, t + 0.12); g.gain.setValueAtTime(0.05, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16); o.connect(g).connect(this.sfx); o.start(t + 0.05); o.stop(t + 0.2); }
  hop() { if (!this.ok) return; const t = this.ctx.currentTime; this.noiseHit(t, 2500, 1.5, 0.12, 0.08); this.tone(520, t, 0.15, 0.06, "sine", this.sfx); this.tone(780, t + 0.05, 0.12, 0.04, "sine", this.sfx); }
  whoosh() { if (!this.ok) return; this.noiseHit(this.ctx.currentTime, 600, 0.7, 0.5, 0.12, "bandpass", this.sfx, 2000); }
  splash(k) { if (!this.ok) return; const t = this.ctx.currentTime; this.noiseHit(t, 1800, 0.6, 0.25 + k * 0.3, 0.12 + k * 0.2, "bandpass", this.sfx, 500); this.noiseHit(t + 0.03, 4000, 1, 0.15, 0.05 + k * 0.05, "highpass", this.sfx); for (let i = 0; i < 4; i++) this.tone(900 + Math.random() * 900, t + 0.05 + Math.random() * 0.2, 0.06, 0.02, "sine", this.sfx); }
  bump(k) { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(110, t, 0.18, 0.12 * k, "sine", this.sfx); this.noiseHit(t, 3000, 2, 0.12, 0.08 * k, "bandpass", this.sfx); this.noiseHit(t + 0.02, 6000, 3, 0.08, 0.05, "highpass", this.sfx); }
  lily() { if (!this.ok) return; this.tone(180, this.ctx.currentTime, 0.12, 0.05, "sine", this.sfx); }
  chime() { if (!this.ok) return; const t = this.ctx.currentTime; [74, 78, 81, 86].forEach((n, i) => this.pluck(midi(n), t + i * 0.09, 0.07, this.sfx)); }
  sink() { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < 9; i++) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(), tt = t + i * 0.18 + Math.random() * 0.1, f = 500 - i * 30 + Math.random() * 200; o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.8, tt + 0.06); g.gain.setValueAtTime(0.06, tt); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.08); o.connect(g).connect(this.sfx); o.start(tt); o.stop(tt + 0.1); } [69, 65, 62].forEach((n, i) => this.pluck(midi(n), t + 0.4 + i * 0.3, 0.06, this.sfx)); }
  finish() { if (!this.ok) return; const t = this.ctx.currentTime; [67, 71, 74, 79, 78, 79, 83, 86].forEach((n, i) => this.pluck(midi(n), t + i * 0.16, 0.08, this.sfx)); }
}
