// Deep-sea ambience and sound effects for Tideglow (Web Audio, nothing to download).
// A slow pad whose low-pass opens as the jelly rises, distant whale song, soft pulse whooshes, pentatonic
// plankton chimes that climb with a pickup streak, halo bloom chords, anglerfish growls, a breach splash.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];
const CHORDS = [[38, 45, 50, 53], [41, 48, 53, 57], [43, 50, 55, 58], [45, 52, 57, 61], [46, 53, 58, 62]];

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("tideglow.muted") === "1"; } catch { }
        this.depth = 1;                                  // 1 = sea floor, 0 = surface
        this.streak = 0;
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.6; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

        // the pad bus: low-pass that opens toward the surface
        this.padLP = ctx.createBiquadFilter(); this.padLP.type = "lowpass"; this.padLP.frequency.value = 300; this.padLP.Q.value = 0.7;
        this.padGain = ctx.createGain(); this.padGain.gain.value = 0.16;
        this.padLP.connect(this.padGain); this.padGain.connect(this.master); this.padGain.connect(this.verb);
        // a constant deep rumble of moving water
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 160; g.gain.value = 0.09;
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.05;
        lfo.connect(lg).connect(g.gain);
        s.connect(f).connect(g).connect(this.master); s.start(); lfo.start();
        this.rumble = f;
        this.nextPad = ctx.currentTime + 0.1; this.chord = 0; this.nextWhale = ctx.currentTime + 6;
        this.timer = setInterval(() => this.schedule(), 250);
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("tideglow.muted", this.muted ? "1" : "0"); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.1);
        return this.muted;
    }
    get ok() { return !!this.ctx && !this.muted; }

    setDepth(d) {                                     // 0..1, called every frame
        this.depth = d;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.padLP.frequency.setTargetAtTime(260 + (1 - d) ** 2 * 2600, t, 0.5);
        this.rumble.frequency.setTargetAtTime(120 + (1 - d) * 400, t, 0.5);
    }
    schedule() {
        const ctx = this.ctx, t0 = ctx.currentTime;
        while (this.nextPad < t0 + 0.5) {
            const t = this.nextPad, ch = CHORDS[this.chord % CHORDS.length];
            this.chord += Math.random() < 0.6 ? 1 : 2;
            for (const n of ch) this.padVoice(midi(n + (this.depth < 0.25 ? 12 : 0)), t, 9.5);
            this.nextPad += 8;
        }
        if (t0 > this.nextWhale) { this.whale(t0 + 0.1); this.nextWhale = t0 + 14 + Math.random() * 16; }
    }
    padVoice(freq, t, dur) {
        const ctx = this.ctx;
        for (const det of [-6, 5]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sawtooth"; o.frequency.value = freq; o.detune.value = det;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 3); g.gain.linearRampToValueAtTime(0.05, t + dur - 3); g.gain.linearRampToValueAtTime(0, t + dur);
            o.connect(g).connect(this.padLP); o.start(t); o.stop(t + dur + 0.1);
        }
    }
    whale(t) {
        if (!this.ok) return;
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        const base = 180 + Math.random() * 160;
        o.type = "sine"; f.type = "bandpass"; f.frequency.value = base * 1.5; f.Q.value = 2;
        o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.4 + Math.random() * 0.6), t + 1.4);
        o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 3.2);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 3.4);
        const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5; vg.gain.value = 6;
        vib.connect(vg).connect(o.frequency);
        o.connect(f).connect(g); g.connect(this.verb); g.connect(this.master);
        o.start(t); vib.start(t); o.stop(t + 3.5); vib.stop(t + 3.5);
    }
    bell(freq, t, vol, dur = 2.4) {
        const ctx = this.ctx;
        for (const [m, v] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.1);
        }
    }
    pulse() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.2;
        f.frequency.setValueAtTime(220, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.5);
    }
    plankton() {
        if (!this.ok) return;
        const k = this.streak++;
        const n = 72 + PENTA[k % 5] + 12 * Math.min(2, Math.floor(k / 5));
        this.bell(midi(n), this.ctx.currentTime, 0.07, 1.6);
        clearTimeout(this._st); this._st = setTimeout(() => (this.streak = 0), 1500);
    }
    halo(combo) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, root = 62 + Math.min(combo - 1, 5) * 2;
        [0, 4, 7, 11, 14].forEach((iv, i) => this.bell(midi(root + iv), t + i * 0.07, 0.09, 3.2));
        this.bell(midi(root - 12), t, 0.08, 4);
    }
    missed() { if (this.ok) this.bell(midi(50), this.ctx.currentTime, 0.05, 1.5); }
    zone() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        [57, 64, 69, 71, 76].forEach((n, i) => this.bell(midi(n), t + i * 0.18, 0.06, 4));
    }
    growl() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(48, t + 0.6);
        f.type = "lowpass"; f.frequency.value = 400;
        const am = ctx.createOscillator(), ag = ctx.createGain(); am.frequency.value = 22; ag.gain.value = 0.08;
        am.connect(ag).connect(g.gain);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 0.7);
        o.connect(f).connect(g).connect(this.sfx); o.start(t); am.start(t); o.stop(t + 0.75); am.stop(t + 0.75);
    }
    whoosh() {                                        // barracuda warning: a rising rush
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 3;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 2.3);
    }
    hiss() {                                          // moray about to strike
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 3000;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.65);
        this.bell(220, t + 0.5, 0.06, 0.4);
    }
    hurt() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.35);
        g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.5);
        [61, 60].forEach((n, i) => this.bell(midi(n), t + 0.05 + i * 0.12, 0.05, 1));
    }
    bump() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.22);
    }
    breach() {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 800;
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 1.3);
        [62, 66, 69, 73, 74, 78, 81, 86].forEach((n, i) => this.bell(midi(n), t + 0.25 + i * 0.11, 0.08, 4));
    }
    fade() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        [69, 65, 62, 57, 50].forEach((n, i) => this.bell(midi(n), t + i * 0.3, 0.06, 3));
    }
}
