// Nebula Drive music (DESIGN.md §1): seeded song composer → event list (in beats) → Web Audio synth + note charts
// generated from the same events, so play and sound can never drift apart.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], major: [0, 2, 4, 5, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10] };
export const SONGS = [
  { name: "Ignition", bpm: 108, root: 57, scale: "minor", prog: [0, 5, 2, 6], seed: 11, pal: [[1.0, 0.3, 0.7], [0.2, 0.8, 1.0], [0.5, 0.2, 0.9]], arp: "updown" },
  { name: "Solar Wind", bpm: 120, root: 50, scale: "dorian", prog: [0, 3, 6, 4], seed: 23, pal: [[1.0, 0.6, 0.2], [1.0, 0.3, 0.4], [0.3, 0.6, 1.0]], arp: "up" },
  { name: "Event Horizon", bpm: 128, root: 54, scale: "minor", prog: [0, 6, 5, 4], seed: 37, pal: [[0.4, 0.3, 1.0], [0.1, 0.9, 0.8], [0.9, 0.2, 0.9]], arp: "broken" },
  { name: "Quasar Bloom", bpm: 136, root: 52, scale: "lydian", prog: [0, 1, 5, 4], seed: 41, pal: [[0.2, 1.0, 0.6], [1.0, 0.8, 0.2], [0.3, 0.5, 1.0]], arp: "up" },
  { name: "Supernova", bpm: 150, root: 48, scale: "phrygian", prog: [0, 1, 5, 6], seed: 59, pal: [[1.0, 0.25, 0.15], [1.0, 0.7, 0.1], [0.8, 0.2, 1.0]], arp: "updown" },
];
const FORM = [["intro", 8], ["verse", 16], ["chorus", 16], ["outro", 4]];
// melody rhythm templates over 2 bars in eighths: 1 = onset, 2 = tie/hold continuation
const RHYTHMS = {
  verse: [[1, 0, 1, 0, 1, 2, 2, 0, 1, 0, 1, 1, 1, 2, 2, 2], [1, 2, 0, 1, 0, 1, 1, 0, 1, 2, 2, 0, 1, 0, 1, 0], [1, 0, 0, 1, 1, 0, 1, 2, 1, 0, 1, 0, 1, 2, 2, 2]],
  chorus: [[1, 1, 0, 1, 1, 0, 1, 1, 1, 2, 2, 2, 1, 1, 1, 0], [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 2, 2, 2], [1, 1, 1, 0, 1, 1, 1, 0, 1, 2, 1, 2, 1, 1, 1, 1]],
  outro: [[1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2]],
};

export function compose(song) {
  const rnd = mulberry32(song.seed), sc = SCALES[song.scale], deg = (d, oct = 0) => song.root + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
  const ev = [], sections = []; let bar = 0;
  for (const [name, bars] of FORM) {
    sections.push({ name, start: bar * 4, end: (bar + bars) * 4 });
    let motif = null;
    for (let b = 0; b < bars; b++, bar++) {
      const t0 = bar * 4, ch = song.prog[bar % 4];
      const chord = [deg(ch), deg(ch + 2), deg(ch + 4)];
      // pad
      if (b % 2 === 0) for (const n of chord) ev.push({ t: t0, kind: "pad", note: n, dur: 8, vel: name === "intro" || name === "outro" ? 0.9 : 0.6 });
      // drums
      if (name !== "outro" || b < 2) {
        for (let q = 0; q < 4; q++) {
          if (name !== "intro" || b >= 4) { if (q === 0 || q === 2 || (name === "chorus" && rnd() < 0.15)) ev.push({ t: t0 + q, kind: "kick", vel: 1 }); if (q === 1 || q === 3) ev.push({ t: t0 + q, kind: "snare", vel: name === "chorus" ? 1 : 0.8 }); }
          for (const e of [0, 0.5]) ev.push({ t: t0 + q + e, kind: "hat", vel: e ? 0.5 : 0.8 });
        }
      }
      // bass: root on beats, octave bounce on offbeats
      if (name !== "intro" || b >= 4) for (let q = 0; q < 8; q++) ev.push({ t: t0 + q * 0.5, kind: "bass", note: deg(ch, -2) + (q % 2 ? 12 : 0), dur: 0.45, vel: 0.9 });
      // arpeggio
      for (let s = 0; s < 8; s++) { const idx = song.arp === "up" ? s % 3 : song.arp === "updown" ? [0, 1, 2, 1][s % 4] : [0, 2, 1, 2][s % 4]; ev.push({ t: t0 + s * 0.5, kind: "arp", note: chord[idx] + 12, dur: 0.4, vel: name === "intro" ? 0.9 : 0.55 }); }
      // melody: two-bar phrases built from a rhythm template, chord tones on strong beats
      if (name !== "intro" && b % 2 === 0) {
        const rhy = RHYTHMS[name === "outro" ? "outro" : name][Math.floor(rnd() * RHYTHMS[name === "outro" ? "outro" : name].length)];
        let d = ch + (name === "chorus" ? 7 : 0) + [0, 2, 4][Math.floor(rnd() * 3)];
        const notes = [];
        for (let i = 0; i < 16; i++) {
          if (rhy[i] !== 1) continue;
          let len = 1; while (i + len < 16 && rhy[i + len] === 2) len++;
          const strong = i % 4 === 0, barCh = song.prog[(bar + Math.floor(i / 8)) % 4];
          if (strong) { const tones = [barCh, barCh + 2, barCh + 4, barCh + 7]; d = tones.reduce((a, c) => (Math.abs(c - d) < Math.abs(a - d) ? c : a), tones[0]); }
          else d += [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)];
          d = Math.max(-2, Math.min(12, d));
          notes.push({ i, len, d });
        }
        // repeat the motif with a twist in the second phrase of every four bars
        if (b % 4 === 0) motif = notes; else if (motif && rnd() < 0.7) { notes.length = 0; for (const m of motif) notes.push({ ...m, d: m.d + (m.i >= 12 ? (rnd() < 0.5 ? 1 : -2) : 0) }); }
        for (const n of notes) ev.push({ t: t0 + n.i * 0.5, kind: "lead", note: deg(n.d, 1), deg: n.d, dur: n.len * 0.5, vel: 0.9 });
      }
    }
  }
  ev.sort((a, b) => a.t - b.t);
  return { song, events: ev, sections, beats: bar * 4, spb: 60 / song.bpm };
}

// ---------------------------------------------------------------- charts
export function makeChart(comp, diff) {
  const spb = comp.spb, out = [];
  const lead = comp.events.filter((e) => e.kind === "lead");
  // lanes from pitch within a sliding window of recent notes
  let lastT = -9, lastLane = -1;
  for (let k = 0; k < lead.length; k++) {
    const e = lead[k];
    const win = lead.slice(Math.max(0, k - 6), k + 6).map((x) => x.deg), lo = Math.min(...win), hi = Math.max(...win);
    let lane = hi > lo ? Math.min(3, Math.floor(((e.deg - lo) / (hi - lo + 0.001)) * 4)) : (k % 4);
    const gap = e.t - lastT;
    if (diff === "easy" && (gap < 1 || e.t % 1 !== 0)) continue;
    if (diff === "normal" && gap < 0.5) continue;
    if (lane === lastLane && gap < 1 && diff !== "hard") lane = (lane + (e.deg % 2 ? 1 : 3)) % 4;
    const hold = e.dur >= (diff === "easy" ? 1.5 : 1);
    out.push({ t: e.t * spb, beat: e.t, lane, dur: hold ? (e.dur - 0.25) * spb : 0 });
    if (diff === "hard" && e.t % 2 === 0 && comp.sections.find((s) => s.name === "chorus" && e.t >= s.start && e.t < s.end)) out.push({ t: e.t * spb, beat: e.t, lane: (lane + 2) % 4, dur: 0 });
    lastT = e.t + (hold ? e.dur : 0); lastLane = lane;
  }
  // the intro has no melody: kicks and arpeggio downbeats give the player something to warm up with
  const intro = comp.sections[0];
  for (const e of comp.events) if (e.t >= intro.start + (diff === "easy" ? 8 : 4) && e.t < intro.end && ((e.kind === "kick") || (diff === "hard" && e.kind === "arp" && e.t % 1 === 0.5))) out.push({ t: e.t * spb, beat: e.t, lane: Math.floor(e.t) % 4, dur: 0 });
  out.sort((a, b) => a.t - b.t || a.lane - b.lane);
  // drop exact duplicates in the same lane
  return out.filter((n, i) => !(i > 0 && out[i - 1].lane === n.lane && Math.abs(out[i - 1].t - n.t) < 0.01));
}

// ---------------------------------------------------------------- synth
export class Synth {
  constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.8; }
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.mus = ctx.createGain(); this.mus.gain.value = this.music; this.mus.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.6; this.sfx.connect(this.master);
    // stereo-ish delay for the lead
    this.dly = ctx.createDelay(1); this.dlyG = ctx.createGain(); this.dlyG.gain.value = 0.3; this.dly.connect(this.dlyG).connect(this.dly); this.dlyG.connect(this.mus);
    const len = Math.floor(ctx.sampleRate * 2.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg).connect(this.mus);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  get ok() { return !!this.ctx && this.ctx.state === "running"; }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  play(comp, startAt) { this.comp = comp; this.start = startAt; this.idx = 0; this.stopTimer(); this.timer = setInterval(() => this.pump(), 25); this.pump(); }
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  stop() { this.stopTimer(); if (this.mus) { const t = this.ctx.currentTime; this.mus.gain.cancelScheduledValues(t); this.mus.gain.setValueAtTime(this.mus.gain.value, t); this.mus.gain.linearRampToValueAtTime(0, t + 0.3); setTimeout(() => this.mus && this.mus.gain.setTargetAtTime(this.music, this.ctx.currentTime, 0.01), 400); } }
  pump() {
    const ctx = this.ctx, c = this.comp; if (!ctx || !c) return;
    const horizon = ctx.currentTime + 0.15;
    while (this.idx < c.events.length) {
      const e = c.events[this.idx], at = this.start + e.t * c.spb;
      if (at > horizon) break;
      if (at > ctx.currentTime - 0.05) this.voice(e, at, c.spb);
      this.idx++;
    }
    if (this.idx >= c.events.length) this.stopTimer();
  }
  voice(e, t, spb) {
    const ctx = this.ctx, out = this.mus;
    const env = (g, a, peak, d) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + d); };
    if (e.kind === "kick") { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); env(g, 0.002, 0.55 * e.vel, 0.3); o.connect(g).connect(out); o.start(t); o.stop(t + 0.32); return; }
    if (e.kind === "snare") { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8; env(g, 0.002, 0.3 * e.vel, 0.2); s.connect(f).connect(g).connect(out); g.connect(this.verb); s.start(t, Math.random() * 0.5); s.stop(t + 0.22); const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 190; env(og, 0.002, 0.15, 0.1); o.connect(og).connect(out); o.start(t); o.stop(t + 0.12); return; }
    if (e.kind === "hat") { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 8000; env(g, 0.001, 0.06 * e.vel, 0.05); s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.06); return; }
    const f0 = midi(e.note), dur = e.dur * spb;
    if (e.kind === "bass") { const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = f0; lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + dur); env(g, 0.005, 0.22 * e.vel, dur + 0.05); o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.1); return; }
    if (e.kind === "pad") { for (const det of [-0.006, 0, 0.007]) { const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = f0 * (1 + det); lp.type = "lowpass"; lp.frequency.value = 1100; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 * e.vel, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(lp).connect(g).connect(out); g.connect(this.verb); o.start(t); o.stop(t + dur + 0.05); } return; }
    if (e.kind === "arp") { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = f0; env(g, 0.003, 0.06 * e.vel, dur); o.connect(g).connect(out); g.connect(this.dly); o.start(t); o.stop(t + dur + 0.05); return; }
    if (e.kind === "lead") { this.dly.delayTime.value = spb * 0.75; for (const [type, mul, v] of [["square", 1, 0.07], ["sawtooth", 1.004, 0.05]]) { const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = type; o.frequency.value = f0 * mul; lp.type = "lowpass"; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(1200, t + Math.min(0.4, dur)); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * e.vel, t + 0.01); g.gain.setValueAtTime(v * e.vel * 0.8, t + Math.max(0.02, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.2); o.connect(lp).connect(g).connect(out); g.connect(this.dly); g.connect(this.verb); o.start(t); o.stop(t + dur + 0.25); } }
  }
  // feedback blips
  hit(j) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = j === 0 ? 1760 : j === 1 ? 1320 : 990; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.09); }
  miss() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.15); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.17); }
  od() { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime; [72, 76, 79, 84].forEach((n, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = midi(n); g.gain.setValueAtTime(0.04, t + i * 0.05); g.gain.exponentialRampToValueAtTime(0.0005, t + i * 0.05 + 0.3); o.connect(g).connect(this.sfx); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.32); }); }
}
