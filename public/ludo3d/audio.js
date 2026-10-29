// Ludo 3D sound: a rattle and clacks for the die, a wooden tock for every hop (rising along a move), a boom and
// whoosh when a pawn is captured, a chime when one gets home and a fanfare for the winner. Web Audio only.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("ludo3d.muted") === "1"; } catch { }
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 1.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.25; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("ludo3d.muted", this.muted ? "1" : "0"); } catch { }
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
    knock(t, freq, v) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
        o.type = "triangle"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.06);
        f.type = "bandpass"; f.frequency.value = freq * 1.5; f.Q.value = 2;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.1);
    }
    noiseBurst(t, freq, q, v, dur) {
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
    }
    rattle() {                                                         // dice shaken, then clacks as it lands
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        for (let i = 0; i < 7; i++) this.noiseBurst(t + i * 0.045, 2600 + Math.random() * 1500, 4, 0.12, 0.04);
    }
    clack(v = 1) { if (this.ok) { const t = this.ctx.currentTime; this.knock(t, 900 + Math.random() * 300, 0.2 * v); this.noiseBurst(t, 3000, 3, 0.08 * v, 0.03); } }
    hop(i) { if (this.ok) this.knock(this.ctx.currentTime, 380 + i * 35, 0.22); }
    leave() { if (this.ok) { const t = this.ctx.currentTime; [67, 74, 79].forEach((n, i) => this.pluck(midi(n), t + i * 0.06, 0.1, 0.6)); } }
    capture() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
        g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.42);
        this.noiseBurst(t, 900, 0.7, 0.4, 0.3);
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g2 = this.ctx.createGain();    // whoosh as it flies
        s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.4;
        f.frequency.setValueAtTime(400, t + 0.1); f.frequency.exponentialRampToValueAtTime(2400, t + 0.6); f.frequency.exponentialRampToValueAtTime(600, t + 1.1);
        g2.gain.setValueAtTime(0.0001, t + 0.1); g2.gain.linearRampToValueAtTime(0.18, t + 0.45); g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
        s.connect(f).connect(g2).connect(this.sfx); s.start(t + 0.1); s.stop(t + 1.2);
    }
    thud() { if (this.ok) this.knock(this.ctx.currentTime, 220, 0.3); }
    home() { if (this.ok) { const t = this.ctx.currentTime; [72, 76, 79, 84, 88].forEach((n, i) => this.pluck(midi(n), t + i * 0.07, 0.12, 0.9)); } }
    six() { if (this.ok) { const t = this.ctx.currentTime; [79, 84].forEach((n, i) => this.pluck(midi(n), t + i * 0.08, 0.09, 0.6)); } }
    turn() { if (this.ok) this.pluck(midi(76), this.ctx.currentTime, 0.04, 0.4); }
    win() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [67, 0.6], [72, 0.72], [76, 0.84], [79, 0.96], [84, 1.2]].forEach(([n, d]) => this.pluck(midi(n), t + d, 0.14, 1.2));
    }
    ui() { if (this.ok) this.pluck(midi(84), this.ctx.currentTime, 0.05, 0.3); }
}
