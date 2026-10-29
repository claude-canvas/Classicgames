// Flappy 3D sound: a soft wing whoosh on every flap, a bright chime for each pipe passed (the pitch climbs a
// scale as the score grows), a thump and a falling whistle on a crash. Web Audio only, nothing to download.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("flappy3d.muted") === "1"; } catch { }
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.3; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("flappy3d.muted", this.muted ? "1" : "0"); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
        return this.muted;
    }
    get ok() { return !!this.ctx && !this.muted && this.ctx.state === "running"; }

    pluck(freq, t, v, dur = 0.9) {
        const ctx = this.ctx;
        for (const [m, a, d] of [[1, 1, 1], [2, 0.35, 0.6], [3, 0.12, 0.35]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * d);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur * d + 0.05);
        }
    }
    flap() {
        if (!this.ok) return;
        const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.2;
        f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(1900, t + 0.09);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.8); s.stop(t + 0.18);
    }
    score(n) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, i = n % SCALE.length, base = 72 + SCALE[i] - (i > 6 ? 12 : 0);
        this.pluck(midi(base), t, 0.16, 0.7);
        this.pluck(midi(base + 7), t + 0.07, 0.1, 0.6);
        if (n % 10 === 0) [0, 4, 7, 12].forEach((k, j) => this.pluck(midi(base + k + 12), t + 0.14 + j * 0.06, 0.08, 0.8));
    }
    hit() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.24);
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g2 = this.ctx.createGain();
        s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 1200;
        g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        s.connect(f).connect(g2).connect(this.sfx); s.start(t); s.stop(t + 0.26);
    }
    fall() {
        if (!this.ok) return;
        const t = this.ctx.currentTime + 0.12, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.7);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.8);
    }
    best() { if (this.ok) { const t = this.ctx.currentTime; [72, 76, 79, 84, 88].forEach((n, i) => this.pluck(midi(n), t + i * 0.08, 0.12)); } }
    ui() { if (this.ok) this.pluck(midi(84), this.ctx.currentTime, 0.06, 0.3); }
}
