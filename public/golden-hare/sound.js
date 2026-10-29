// Golden Hare — sound (DESIGN.md §3), all synthesised with Web Audio: a morning of birdsong and wind with a soft
// pad, the bow's creak and twang, the arrow's whistle and thunk, rabbits bolting, and the golden hare's chime.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
export const sound = {
  ctx: null, out: null, noise: null, on: true, birdT: 1, songT: 6,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC(); this.out = c.createGain(); this.out.gain.value = 0.7;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; this.out.connect(comp).connect(c.destination);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6; } this.noise = nb;
    // wind in the pines
    const w = c.createBufferSource(); w.buffer = nb; w.loop = true; this.wf = c.createBiquadFilter(); this.wf.type = "bandpass"; this.wf.frequency.value = 500; this.wf.Q.value = 0.5;
    this.wg = c.createGain(); this.wg.gain.value = 0.035; w.connect(this.wf).connect(this.wg).connect(this.out); w.start();
    // a soft, warm pad (a slow major seventh, barely there)
    this.pad = c.createGain(); this.pad.gain.value = 0.0; this.pad.connect(this.out);
    for (const f of [130.8, 196, 246.9, 329.6]) { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; const g = c.createGain(); g.gain.value = 0.018; const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.07 + Math.random() * 0.05; lg.gain.value = 0.012; l.connect(lg).connect(g.gain); o.connect(g).connect(this.pad); o.start(); l.start(); }
    this.pad.gain.setTargetAtTime(1, c.currentTime, 4);
  },
  mute() { this.on = !this.on; if (this.out) this.out.gain.value = this.on ? 0.7 : 0; return this.on; },
  ambience(dt) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.wf.frequency.setTargetAtTime(420 + Math.sin(t * 0.13) * 160, t, 0.8); this.wg.gain.setTargetAtTime(0.025 + Math.max(0, Math.sin(t * 0.19)) * 0.035, t, 1);
    if ((this.birdT -= dt) < 0) { this.birdT = 0.8 + Math.random() * 2.8; this.chirp(); }
    if ((this.songT -= dt) < 0) { this.songT = 7 + Math.random() * 9; this.thrush(); }
  },
  tone(f, len, vol, type = "sine", at = 0, glide = 1, pan = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain(), p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    o.type = type; o.frequency.setValueAtTime(f, t); if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(this.out); } else o.connect(g).connect(this.out);
    o.start(t); o.stop(t + len + 0.05);
  },
  noiseBurst(len, vol, f0, f1, q = 1, type = "bandpass", at = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + len + 0.05);
  },
  chirp() { const n = 2 + Math.floor(Math.random() * 5), f = 2400 + Math.random() * 2200, pan = Math.random() * 2 - 1; for (let i = 0; i < n; i++) this.tone(f * (1 + (Math.random() - 0.5) * 0.2), 0.06 + Math.random() * 0.04, 0.018, "sine", i * 0.09, 1.3 + Math.random() * 0.3, pan); },
  // a song thrush: repeated phrases
  thrush() { const pan = Math.random() * 2 - 1; let at = 0; for (let p = 0; p < 3; p++) { const f = 1800 + Math.random() * 1400, r = 2 + Math.floor(Math.random() * 2); for (let k = 0; k < r; k++) { this.tone(f, 0.11, 0.022, "triangle", at, 1.18, pan); this.tone(f * 1.26, 0.08, 0.016, "sine", at + 0.11, 0.9, pan); at += 0.24; } at += 0.25; } },
  creak(k) { this.noiseBurst(0.12, 0.012 + k * 0.02, 300 + k * 300, 500 + k * 400, 6, "bandpass"); },
  twang(power) { this.tone(110 + power * 40, 0.35, 0.12, "triangle", 0, 0.7); this.noiseBurst(0.08, 0.1, 2500, 900, 1, "bandpass"); this.noiseBurst(0.6, 0.03, 1800, 3500, 3, "bandpass", 0.03); },
  thunk(wood) { this.tone(wood ? 190 : 120, 0.12, 0.12, "sine", 0, 0.5); this.noiseBurst(0.08, wood ? 0.1 : 0.05, wood ? 1500 : 700, 400, 1, "bandpass"); },
  hit(golden) { this.tone(150, 0.15, 0.14, "sine", 0, 0.5); this.noiseBurst(0.25, 0.06, 2000, 600, 0.8, "bandpass"); PENTA.slice(golden ? 0 : 3, golden ? 8 : 6).forEach((f, i) => this.tone(f, golden ? 1.6 : 0.7, golden ? 0.05 : 0.035, "sine", 0.05 + i * (golden ? 0.09 : 0.07))); },
  rustle() { this.noiseBurst(0.35, 0.05, 3500, 1800, 1.5, "bandpass"); this.noiseBurst(0.25, 0.04, 3000, 1500, 1.5, "bandpass", 0.2); },
  chime() { [0, 2, 4, 7].forEach((k, i) => this.tone(PENTA[k] * 2, 2.2, 0.04, "sine", i * 0.18)); },
  step(soft) { this.noiseBurst(0.08, soft ? 0.015 : 0.035, 1600, 700, 0.8, "bandpass"); },
  end() { [0, 2, 4, 5, 7].forEach((k, i) => this.tone(PENTA[k], 2.5, 0.05, "sine", i * 0.22)); },
};
