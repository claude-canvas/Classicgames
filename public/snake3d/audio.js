// Snake 3D sound: a soft tick on each turn, a juicy pluck for every fruit (the pitch climbs a scale as the
// snake grows), a sparkling arpeggio for golden fruit, and a crunch with a falling tone on a crash.
// Web Audio only, nothing to download.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("snake3d.muted") === "1"; } catch { }
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.3; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("snake3d.muted", this.muted ? "1" : "0"); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
        return this.muted;
    }
    get ok() { return !!this.ctx && !this.muted && this.ctx.state === "running"; }

    pluck(freq, t, v, dur = 0.8) {
        const ctx = this.ctx;
        for (const [m, a, d] of [[1, 1, 1], [2, 0.3, 0.6], [3, 0.1, 0.35]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * d);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur * d + 0.05);
        }
    }
    turn() {
        if (!this.ok) return;
        const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.04);
        g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.06);
    }
    eat(n) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, i = n % SCALE.length, base = 67 + SCALE[i] - (i > 6 ? 12 : 0);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();       // "gulp"
        o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.07);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.1);
        this.pluck(midi(base), t + 0.03, 0.15, 0.7);
        this.pluck(midi(base + 7), t + 0.09, 0.08, 0.6);
    }
    golden() { if (this.ok) { const t = this.ctx.currentTime; [72, 76, 79, 84, 88, 91].forEach((n, i) => this.pluck(midi(n), t + i * 0.05, 0.1, 0.9)); } }
    spawnGolden() { if (this.ok) { const t = this.ctx.currentTime; [84, 91, 96].forEach((n, i) => this.pluck(midi(n), t + i * 0.07, 0.05, 0.6)); } }
    crash() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 1400;
        g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 0.32);
        const o = this.ctx.createOscillator(), g2 = this.ctx.createGain();
        o.type = "triangle"; o.frequency.setValueAtTime(330, t + 0.05); o.frequency.exponentialRampToValueAtTime(80, t + 0.8);
        g2.gain.setValueAtTime(0.14, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
        o.connect(g2).connect(this.sfx); o.start(t + 0.05); o.stop(t + 0.9);
    }
    pop(i) { if (this.ok && i % 3 === 0) this.pluck(midi(60 + (i % 12)), this.ctx.currentTime, 0.03, 0.2); }
    best() { if (this.ok) { const t = this.ctx.currentTime; [72, 76, 79, 84, 88].forEach((n, i) => this.pluck(midi(n), t + i * 0.08, 0.12)); } }
    ui() { if (this.ok) this.pluck(midi(84), this.ctx.currentTime, 0.06, 0.3); }
}
