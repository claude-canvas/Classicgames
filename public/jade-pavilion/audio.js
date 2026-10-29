// Tea-house sound for Jade Pavilion (Web Audio, nothing to download).
// Tile clacks (noise burst + body tone), pentatonic guzheng-style plucks for matches that climb with the combo,
// a soft thud for mismatches, a gong for the win and a sparse ambient of plucks over a faint breeze.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
    constructor() {
        this.ctx = null;
        this.volume = 0.8;
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.8;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 2.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.35; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // a faint breeze
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 500; g.gain.value = 0.012;
        s.connect(f).connect(g).connect(this.master); s.start();
        this.next = ctx.currentTime + 1.5;
        this.timer = setInterval(() => this.ambient(), 400);
    }
    setVolume(v) {
        this.volume = v;
        if (this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05);
    }
    get ok() { return !!this.ctx && this.volume > 0; }

    ambient() {
        const t0 = this.ctx.currentTime;
        while (this.next < t0 + 0.6) {
            if (Math.random() < 0.35) this.pluck(midi(62 + PENTA[Math.floor(Math.random() * 5)] + (Math.random() < 0.3 ? 12 : 0)), this.next, 0.035, true);
            this.next += 1.1 + Math.random() * 1.4;
        }
    }
    pluck(freq, t, vol, amb = false) {
        const ctx = this.ctx;
        for (const [m, v] of [[1, 1], [2, 0.5], [3, 0.22], [4.02, 0.1]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, t + (amb ? 2.6 : 1.8) / m);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 2.8);
        }
    }
    clack(level = 1, t = this.ctx?.currentTime) {
        if (!this.ok) return;
        const ctx = this.ctx;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 2600 + Math.random() * 900; f.Q.value = 2.5;
        g.gain.setValueAtTime(0.32 * level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + 0.08);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.setValueAtTime(950 + Math.random() * 200, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.05);
        og.gain.setValueAtTime(0.12 * level, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.08);
    }
    select() { this.clack(0.7); }
    match(combo) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, k = Math.min(combo, 8) - 1;
        const base = 67 + PENTA[k % 5] + 12 * Math.floor(k / 5);
        this.clack(1, t);
        this.pluck(midi(base), t + 0.03, 0.11);
        this.pluck(midi(base + 7), t + 0.13, 0.08);
        if (combo > 2) this.pluck(midi(base + 12), t + 0.23, 0.06);
    }
    mismatch() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
        g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.3);
    }
    blocked() { if (this.ok) { this.clack(0.35); this.pluck(midi(50), this.ctx.currentTime, 0.04); } }
    hint() { if (this.ok) { const t = this.ctx.currentTime; this.pluck(midi(81), t, 0.06); this.pluck(midi(88), t + 0.12, 0.05); } }
    shuffle() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        for (let i = 0; i < 18; i++) this.clack(0.35 + Math.random() * 0.4, t + i * 0.035 + Math.random() * 0.02);
    }
    deal(n) {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        for (let i = 0; i < Math.min(n, 30); i++) this.clack(0.25 + Math.random() * 0.3, t + i * 0.05 + Math.random() * 0.03);
    }
    win() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime;
        for (const [m, v, d] of [[1, 0.3, 5], [1.48, 0.14, 4], [2.02, 0.1, 3.5], [2.74, 0.06, 3], [3.9, 0.03, 2]]) {    // gong
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 98 * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + d + 0.1);
        }
        [62, 64, 67, 69, 74, 76, 79, 81, 86].forEach((n, i) => this.pluck(midi(n), t + 0.4 + i * 0.11, 0.08));
    }
    lose() { if (this.ok) { const t = this.ctx.currentTime; [69, 67, 64, 62].forEach((n, i) => this.pluck(midi(n), t + i * 0.18, 0.06)); } }
}
