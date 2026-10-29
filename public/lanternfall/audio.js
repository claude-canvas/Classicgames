// Lanternfall sound (Web Audio, all synthesized): a small adaptive score (village, woods, night, spire, battle,
// boss, dawn moods), ambience per time of day, combat effects and "voice blips" for dialogue (pitch per character).
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MOODS = {
  village: { bpm: 84, root: 62, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], lead: "triangle", pad: 0.025, drums: 0, bass: 1 },
  woods: { bpm: 70, root: 57, scale: [0, 2, 3, 7, 8], chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], lead: "sine", pad: 0.03, drums: 0, bass: 1 },
  night: { bpm: 60, root: 55, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], lead: "sine", pad: 0.03, drums: 0, bass: 0 },
  spire: { bpm: 72, root: 50, scale: [0, 1, 3, 6, 7], chords: [[0, 3, 6], [1, 5, 8], [-2, 1, 5], [0, 3, 7]], lead: "sawtooth", pad: 0.035, drums: 1, bass: 1 },
  battle: { bpm: 132, root: 57, scale: [0, 2, 3, 5, 7], chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]], lead: "square", pad: 0.022, drums: 2, bass: 2 },
  boss: { bpm: 144, root: 52, scale: [0, 1, 3, 5, 7], chords: [[0, 3, 7], [1, 5, 8], [-2, 1, 5], [-1, 3, 6]], lead: "sawtooth", pad: 0.03, drums: 3, bass: 2 },
  dawn: { bpm: 76, root: 64, scale: [0, 2, 4, 7, 9], chords: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]], lead: "triangle", pad: 0.035, drums: 0, bass: 1 },
};
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; this.mood = "village"; this.amb = "day"; }
  init() { try { this._init(); } catch (e) { console.warn("Lanternfall: audio unavailable", e); } }
  _init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; this.master.connect(comp).connect(ctx.destination);
    this.sfxG = ctx.createGain(); this.sfxG.connect(this.master);
    this.musG = ctx.createGain(); this.musG.gain.value = 0.32 * this.music; this.musG.connect(this.master);
    this.ambG = ctx.createGain(); this.ambG.gain.value = 0.7; this.ambG.connect(this.master);
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const loop = (f, q, type) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const F = ctx.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = ctx.createGain(); G.gain.value = 0; s.connect(F).connect(G).connect(this.ambG); s.start(0, Math.random()); return G; };
    this.windG = loop(500, 0.5, "lowpass"); this.waterG = loop(900, 1.2, "bandpass");
    this.step = 0; this.next = ctx.currentTime + 0.3; this.critter = 0;
    this.timer = setInterval(() => this.tick(), 60);
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.musG) this.musG.gain.setTargetAtTime(0.32 * v, this.ctx.currentTime, 0.1); }
  get ok() { return !!this.ctx && this.volume > 0; }
  tone(f, t, d, v, type = "sine", dest = this.musG, cut = 4000, a = 0.005) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = type; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = cut; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05); return g; }
  hit(t, f, q, d, v, type = "bandpass", f2 = 0, dest = this.sfxG) { const ctx = this.ctx, n = ctx.createBufferSource(), F = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = this.noise; F.type = type; F.frequency.setValueAtTime(f, t); if (f2) F.frequency.exponentialRampToValueAtTime(f2, t + d); F.Q.value = q; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); n.connect(F).connect(g).connect(dest); n.start(t, Math.random()); n.stop(t + d + 0.05); }
  setMood(m) { if (m !== this.mood) { this.mood = m; this.step = 0; } }
  setAmb(a) { this.amb = a; }
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime, M = MOODS[this.mood] || MOODS.village;
    if (this.music > 0) {
      const sp = 60 / M.bpm / 2;
      while (this.next < now + 0.2) {
        const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4, ch = M.chords[bar], root = M.root;
        if (s === 0) for (const iv of ch) { const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = midi(root - 12 + iv) * (1 + (Math.random() - 0.5) * 0.004); lp.type = "lowpass"; lp.frequency.value = 1000; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(M.pad, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + sp * 16 + 0.4); o.connect(lp).connect(g).connect(this.musG); g.connect(this.verb); o.start(t); o.stop(t + sp * 16 + 0.6); }
        if (M.bass && (M.bass === 2 ? s % 2 === 0 : s % 8 === 0)) this.tone(midi(root - 24 + ch[0] + (M.bass === 2 && s % 8 === 6 ? 7 : 0)), t, sp * (M.bass === 2 ? 1.8 : 6), 0.1, "sawtooth", this.musG, 380);
        const dens = M.drums >= 2 ? 0.85 : 0.6;
        if ((s % 2 === 0 || M.drums >= 2) && Math.random() < dens) { this.walk = Math.max(0, Math.min(9, (this.walk ?? 5) + Math.floor(Math.random() * 5) - 2)); const n = root + M.scale[this.walk % 5] + Math.floor(this.walk / 5) * 12; const g = this.tone(midi(n), t, M.drums >= 2 ? sp * 0.9 : 1.2, M.drums >= 2 ? 0.035 : 0.05, M.lead, this.musG, M.drums >= 2 ? 2200 : 3000); g.connect(this.verb); }
        if (M.drums) {
          if (s % 4 === 0 || (M.drums >= 2 && s % 8 === 3)) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(M.drums >= 3 ? 0.4 : 0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g).connect(this.musG); o.start(t); o.stop(t + 0.3); }
          if (M.drums >= 2 && s % 8 === 4) this.hit(t, 1800, 0.8, 0.18, 0.18, "bandpass", 0, this.musG);
          if (M.drums >= 2 && s % 2 === 1) this.hit(t, 8000, 1, 0.04, 0.04, "highpass", 0, this.musG);
          if (M.drums === 1 && s === 8) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.8); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2); o.connect(g).connect(this.musG); g.connect(this.verb); o.start(t); o.stop(t + 1.3); }
        }
        this.step++; this.next += sp;
      }
    } else this.next = now + 0.1;
    // ambience: birds by day, crickets and owls at night, wind on the Spire
    const a = this.amb;
    this.windG.gain.setTargetAtTime(a === "spire" ? 0.12 : a === "dusk" ? 0.05 : 0.03, now, 0.5);
    this.waterG.gain.setTargetAtTime(a === "river" ? 0.05 : 0, now, 0.5);
    if (now > this.critter) {
      if (a === "day") { const base = 2600 + Math.random() * 1500, n = 2 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) { const tt = now + i * 0.11, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(base, tt); o.frequency.exponentialRampToValueAtTime(base * 1.4, tt + 0.06); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.02, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.09); o.connect(g).connect(this.ambG); g.connect(this.verb); o.start(tt); o.stop(tt + 0.1); } this.critter = now + 1.5 + Math.random() * 4; }
      else if (a === "night" || a === "river" || a === "dusk") { for (let i = 0; i < 3; i++) this.tone(4200 + Math.random() * 300, now + i * 0.05, 0.035, 0.008, "square", this.ambG, 6000); if (Math.random() < 0.08) [0, 0.5].forEach((d) => this.tone(330, now + d, 0.5, 0.03, "sine", this.verb)); this.critter = now + 0.4 + Math.random() * 0.6; }
      else this.critter = now + 1;
    }
  }
  blip(voice) { if (!this.ok) return; const t = this.ctx.currentTime, f = 220 * voice * (1 + (Math.random() - 0.5) * 0.25); this.tone(f, t, 0.06, 0.04, "triangle", this.sfxG, 2000); }
  sfx(name) {
    if (!this.ok) return; const t = this.ctx.currentTime, S = this.sfxG;
    switch (name) {
      case "swing": this.hit(t, 1200, 0.9, 0.16, 0.12, "bandpass", 3000); break;
      case "swing2": this.hit(t, 600, 0.8, 0.25, 0.18, "bandpass", 1600); break;
      case "hit": this.tone(160, t, 0.12, 0.2, "sine", S); this.hit(t, 2500, 1.5, 0.08, 0.15); break;
      case "hurt": this.tone(120, t, 0.25, 0.25, "sawtooth", S, 500); this.hit(t, 900, 1, 0.15, 0.15); break;
      case "burst": this.hit(t, 400, 0.6, 0.7, 0.3, "bandpass", 3000); [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.03, 0.8, 0.05, "triangle", this.verb)); break;
      case "roll": this.hit(t, 700, 0.8, 0.22, 0.1, "lowpass"); break;
      case "pop": this.tone(500, t, 0.15, 0.1, "sine", S); this.hit(t, 3000, 2, 0.2, 0.08, "bandpass", 600); break;
      case "die": this.tone(200, t, 0.6, 0.15, "sawtooth", S, 600); this.hit(t, 500, 0.7, 0.6, 0.15, "lowpass"); break;
      case "dash": this.hit(t, 900, 1, 0.3, 0.12, "bandpass", 2400); break;
      case "claw": this.hit(t, 3000, 2, 0.12, 0.12); break;
      case "slam": this.tone(60, t, 0.5, 0.4, "sine", S); this.hit(t, 300, 0.6, 0.5, 0.3, "lowpass"); break;
      case "charge": this.hit(t, 400, 0.6, 0.6, 0.2, "bandpass", 1500); break;
      case "wave": this.tone(90, t, 0.8, 0.2, "sawtooth", S, 400); break;
      case "orb": this.tone(700, t, 0.3, 0.05, "sine", S); this.tone(1050, t + 0.03, 0.25, 0.03, "sine", this.verb); break;
      case "summon": [55, 58, 61].forEach((n, i) => this.tone(midi(n), t + i * 0.1, 1.0, 0.07, "sawtooth", this.verb, 900)); break;
      case "shield": this.tone(300, t, 0.5, 0.08, "triangle", this.verb); break;
      case "block": this.tone(900, t, 0.1, 0.08, "square", S, 2000); break;
      case "shatter": for (let i = 0; i < 8; i++) this.tone(1500 + Math.random() * 2500, t + Math.random() * 0.2, 0.3, 0.04, "triangle", this.verb); this.hit(t, 5000, 1, 0.4, 0.2, "highpass"); break;
      case "heal": [67, 71, 74, 79].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.5, 0.05, "sine", this.verb)); break;
      case "item": [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), t + i * 0.08, 0.6, 0.06, "triangle", this.verb)); break;
      case "light": this.hit(t, 800, 0.5, 0.5, 0.12, "bandpass", 2400); [79, 84].forEach((n, i) => this.tone(midi(n), t + 0.1 + i * 0.1, 0.8, 0.05, "sine", this.verb)); break;
      case "omen": [50, 49, 46].forEach((n, i) => this.tone(midi(n), t + i * 0.5, 2, 0.08, "sawtooth", this.verb, 700)); break;
      case "vesper": this.hit(t, 200, 0.5, 1.5, 0.3, "lowpass"); [45, 46, 52].forEach((n) => this.tone(midi(n), t, 2.5, 0.06, "sawtooth", this.verb, 600)); break;
      case "snuff": this.hit(t, 1500, 0.6, 1.0, 0.25, "bandpass", 200); break;
      case "chain": for (let i = 0; i < 6; i++) this.tone(1200 + i * 120, t + i * 0.07, 0.2, 0.05, "square", S, 3000); break;
      case "page": this.hit(t, 4000, 1, 0.2, 0.08, "highpass"); break;
      case "horn": [55, 62].forEach((n) => this.tone(midi(n), t, 1.4, 0.1, "sawtooth", this.verb, 900)); break;
      case "sunrise": [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.15, 3, 0.05, "triangle", this.verb)); break;
      case "step": this.hit(t, 300 + Math.random() * 200, 1, 0.06, 0.04, "lowpass"); break;
      case "ui": this.tone(880, t, 0.08, 0.04, "triangle", S); break;
      case "quest": [76, 81, 88].forEach((n, i) => this.tone(midi(n), t + i * 0.09, 0.5, 0.06, "triangle", this.verb)); break;
      case "down": [64, 60, 57, 52].forEach((n, i) => this.tone(midi(n), t + i * 0.25, 1.2, 0.06, "sine", this.verb)); break;
      default: break;
    }
  }
}
