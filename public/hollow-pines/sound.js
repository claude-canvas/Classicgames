// The Hollow Pines — sound (DESIGN.md §3), all synthesised with Web Audio.
export const sound = {
  ctx: null, out: null, noise: null, on: true, beatT: 0, fear: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.out = c.createGain(); this.out.gain.value = 0.8;
    // a compressor keeps the screams from clipping
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6; this.out.connect(comp).connect(c.destination);
    const nb = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), d = nb.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = b * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = b * 8 + (Math.random() * 2 - 1) * 0.15; } this.noise = nb;
    // the drone: three detuned low sines, slowly beating
    this.dg = c.createGain(); this.dg.gain.value = 0.11; this.dg.connect(this.out);
    for (const f of [41.2, 41.9, 61.7]) { const o = c.createOscillator(); o.frequency.value = f; const g = c.createGain(); g.gain.value = f > 60 ? 0.4 : 1; o.connect(g).connect(this.dg); o.start(); }
    // wind in the canopy
    const w = c.createBufferSource(); w.buffer = nb; w.loop = true; this.wf = c.createBiquadFilter(); this.wf.type = "bandpass"; this.wf.frequency.value = 350; this.wf.Q.value = 0.7;
    this.wg = c.createGain(); this.wg.gain.value = 0.06; w.connect(this.wf).connect(this.wg).connect(this.out); w.start();
    // the cross: a soft choir pad, silent until raised
    this.cg = c.createGain(); this.cg.gain.value = 0; this.cg.connect(this.out);
    for (const f of [261.6, 329.6, 392, 523.3, 659.3]) for (const dt of [-3, 3]) { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = dt; const g = c.createGain(); g.gain.value = 0.025; o.connect(g).connect(this.cg); o.start(); }
  },
  mute() { this.on = !this.on; if (this.out) this.out.gain.value = this.on ? 0.8 : 0; return this.on; },
  // every frame: fear sets the heartbeat and the drone; the cross pad follows the raised cross
  update(dt, fear, crossUp) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.wf.frequency.setTargetAtTime(280 + Math.sin(t * 0.11) * 120, t, 0.6); this.wg.gain.setTargetAtTime(0.04 + Math.max(0, Math.sin(t * 0.17)) * 0.05, t, 1);
    this.dg.gain.setTargetAtTime(0.08 + fear * 0.12, t, 0.5);
    this.cg.gain.setTargetAtTime(crossUp ? 0.9 : 0, t, 0.25);
    if (fear > 0.12 && (this.beatT -= dt) <= 0) { const bpm = 62 + fear * 90; this.beatT = 60 / bpm; this.heart(0.15 + fear * 0.45); }
  },
  noiseBurst(len, vol, f0, f1, q = 1, type = "bandpass", at = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random() * 2); s.stop(t + len + 0.05);
  },
  tone(f, len, vol, type = "sine", at = 0, glide = 1, vib = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + len);
    if (vib) { const l = this.ctx.createOscillator(), lg = this.ctx.createGain(); l.frequency.value = 5.5; lg.gain.value = f * vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + len + 0.1); }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, len * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + len + 0.1); return o;
  },
  heart(v) { this.tone(52, 0.16, v, "sine", 0, 0.7); this.tone(48, 0.14, v * 0.7, "sine", 0.17, 0.7); },
  step(run) { this.noiseBurst(0.09, run ? 0.07 : 0.045, 1800, 600, 0.8, "bandpass"); },
  breath() { this.noiseBurst(0.5, 0.05, 900, 500, 1.5, "bandpass"); this.noiseBurst(0.4, 0.04, 700, 1000, 1.5, "bandpass", 0.6); },
  snap() { this.noiseBurst(0.06, 0.35, 3000, 1500, 0.6, "highpass"); this.tone(180, 0.08, 0.1, "square", 0, 0.5); },
  // a voice-like wail: a sawtooth with vibrato through two vowel formants
  wail(vol = 0.12, len = 2.4, f = 420) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(), l = this.ctx.createOscillator(), lg = this.ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.35, t + len * 0.4); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
    l.frequency.value = 6; lg.gain.value = f * 0.03; l.connect(lg).connect(o.frequency);
    const f1 = this.ctx.createBiquadFilter(), f2 = this.ctx.createBiquadFilter(); f1.type = f2.type = "bandpass"; f1.frequency.value = 750; f2.frequency.value = 1250; f1.Q.value = f2.Q.value = 7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(this.out); o.start(t); l.start(t); o.stop(t + len + 0.1); l.stop(t + len + 0.1);
  },
  whisper() { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) this.noiseBurst(0.18 + Math.random() * 0.2, 0.05, 2400 + Math.random() * 1500, 1800 + Math.random() * 900, 6, "bandpass", i * 0.22 + Math.random() * 0.1); },
  giggle() { for (let i = 0; i < 5; i++) this.tone(900 + Math.random() * 200, 0.09, 0.025, "triangle", i * 0.12, 1.25, 0.02); },
  footstepsBehind() { for (let i = 0; i < 4; i++) this.noiseBurst(0.09, 0.03, 1200, 500, 0.8, "bandpass", 0.25 + i * 0.55); },
  vanish() { this.noiseBurst(0.9, 0.12, 400, 3000, 2, "bandpass"); this.tone(1400, 0.7, 0.03, "sine", 0.05, 0.4); },
  huntScream() { this.wail(0.2, 3.2, 380); this.noiseBurst(2.5, 0.08, 600, 200, 1, "lowpass"); },
  burn() { this.wail(0.22, 1.6, 620); this.noiseBurst(1.4, 0.15, 3000, 800, 0.7, "bandpass"); },
  // the jumpscare: the loudest thing in the game
  scare() { this.noiseBurst(1.4, 0.9, 4000, 900, 0.5, "bandpass"); this.tone(1650, 1.2, 0.35, "sawtooth", 0, 0.45, 0.05); this.tone(1230, 1.2, 0.3, "square", 0.02, 0.5, 0.07); this.tone(70, 0.8, 0.6, "sine", 0, 0.4); },
  banish() { this.wail(0.25, 3.5, 700); for (let i = 0; i < 6; i++) this.tone(523.3 * [1, 1.25, 1.5, 2, 2.5, 3][i], 3.5, 0.05, "sine", 0.6 + i * 0.15); },
  pickup() { for (let i = 0; i < 4; i++) this.tone([392, 523.3, 659.3, 784][i], 2.2, 0.06, "sine", i * 0.12); },
  flick() { this.noiseBurst(0.03, 0.05, 5000, 3000, 2, "bandpass"); },
};
