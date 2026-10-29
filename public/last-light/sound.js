// Last Light — sound (DESIGN.md §7), all synthesised with Web Audio: a wind bed, birdsong that gives way to crickets as
// night comes, chimes for fireflies and lit caps, the owl's wings and screech, and soft footsteps.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
export const sound = {
  ctx: null, on: true, out: null, noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC(); this.out = c.createGain(); this.out.gain.value = 0.6; this.out.connect(c.destination);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6; } this.noise = nb;
    // wind: brown noise through a slowly wandering band-pass
    const w = c.createBufferSource(); w.buffer = nb; w.loop = true; this.wf = c.createBiquadFilter(); this.wf.type = "bandpass"; this.wf.frequency.value = 400; this.wf.Q.value = 0.6;
    this.wg = c.createGain(); this.wg.gain.value = 0.06; w.connect(this.wf).connect(this.wg).connect(this.out); w.start();
    this.cri = 0; this.bird = 2;
  },
  mute() { this.on = !this.on; if (this.out) this.out.gain.value = this.on ? 0.6 : 0; return this.on; },
  // called every frame: wind sways, birds at golden hour, crickets after dusk
  ambience(dt, dayT) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.wf.frequency.setTargetAtTime(300 + Math.sin(t * 0.13) * 140 + Math.sin(t * 0.37) * 60, t, 0.5);
    this.wg.gain.setTargetAtTime(0.05 + Math.max(0, Math.sin(t * 0.21)) * 0.04, t, 0.8);
    if ((this.bird -= dt) < 0 && dayT < 0.55) { this.bird = 2 + Math.random() * 5; this.chirp(); }
    if ((this.cri -= dt) < 0 && dayT > 0.45) { this.cri = 0.35 + Math.random() * 0.5; if (Math.random() < Math.min(1, (dayT - 0.45) * 2.5)) this.cricket(); }
  },
  tone(f, len, vol, type = "sine", at = 0, glide = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + len + 0.05);
  },
  chirp() { const n = 2 + Math.floor(Math.random() * 4), f = 2600 + Math.random() * 1600; for (let i = 0; i < n; i++) this.tone(f * (1 + (Math.random() - 0.5) * 0.15), 0.07, 0.02, "sine", i * 0.11, 1.35); },
  cricket() { const f = 4200 + Math.random() * 500; for (let i = 0; i < 3; i++) this.tone(f, 0.035, 0.012, "triangle", i * 0.05); },
  collect(n) { const f = PENTA[Math.min(PENTA.length - 1, n + 1)]; this.tone(f, 0.5, 0.06, "sine"); this.tone(f * 2, 0.3, 0.02, "sine", 0.02); },
  deposit(k) { this.tone(PENTA[k % PENTA.length] / 2, 0.35, 0.05, "triangle"); },
  lit() { [0, 2, 4, 5, 7].forEach((k, i) => { this.tone(PENTA[k], 1.2, 0.07, "sine", i * 0.09); this.tone(PENTA[k] * 2, 0.8, 0.02, "sine", i * 0.09 + 0.02); }); },
  whoosh() { if (!this.ctx) return; const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.8); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1); s.connect(f).connect(g).connect(this.out); s.start(t); s.stop(t + 1.2); },
  screech() { this.tone(1900, 0.6, 0.05, "sawtooth", 0, 0.55); this.tone(2300, 0.5, 0.03, "square", 0.05, 0.6); },
  step() { if (!this.ctx) return; const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(); s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 2500; g.gain.setValueAtTime(0.012, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + 0.05); },
  win() { [0, 2, 4, 7, 5, 4, 2, 4].forEach((k, i) => this.tone(PENTA[k], 1.6, 0.06, "sine", i * 0.28)); },
};
