// Velvet Break sound (Web Audio, nothing to download): ball clacks scaled by impact, cushion thumps, pocket
// drops with a rattle, the cue strike, crowd-less lounge ambience — a soft walking bass and electric-piano chords.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PROG = [[50, [62, 65, 69, 72]], [55, [62, 65, 67, 71]], [48, [60, 64, 67, 71]], [57, [61, 64, 67, 69]]];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; this.last = {}; }
    init() { try { this._init(); } catch (e) { console.warn("Velvet Break: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.8;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.22; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.mus = ctx.createGain(); this.mus.gain.value = 0.11 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        this.beat = 0; this.next = ctx.currentTime + 0.4;
        this.timer = setInterval(() => this.band(), 250);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05); }
    setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.11 * v, this.ctx.currentTime, 0.1); }
    get ok() { return !!this.ctx && this.volume > 0; }

    band() {
        const ctx = this.ctx, spb = 60 / 84;
        while (this.next < ctx.currentTime + 0.6) {
            const t = this.next, bar = Math.floor(this.beat / 4) % PROG.length, [root, chord] = PROG[bar], b = this.beat % 4;
            const walk = [0, 7, 12, 10][b] + (b === 3 ? -1 : 0);
            this.tone(midi(root - 12 + walk), t, 0.35, spb * 0.9, "triangle", this.mus, 600);
            if (b === 0 || (b === 2 && Math.random() < 0.6)) for (const n of chord) this.epiano(midi(n), t + (b ? spb * 0.5 : 0), 0.06);
            if (Math.random() < 0.5) this.brush(t + spb * 0.5);
            this.beat++; this.next += spb;
        }
    }
    tone(f, t, v, d, type, dest, lp) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
        o.type = type; o.frequency.value = f; fl.type = "lowpass"; fl.frequency.value = lp;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(fl).connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
    }
    epiano(f, t, v) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2, 0.25], [3.5, 0.05]]) {
            const o = ctx.createOscillator(), g = ctx.createGain(), trem = ctx.createOscillator(), tg = ctx.createGain();
            o.frequency.value = f * m; trem.frequency.value = 5; tg.gain.value = v * a * 0.25; trem.connect(tg).connect(g.gain);
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / m);
            o.connect(g).connect(this.mus); o.start(t); trem.start(t); o.stop(t + 2.5); trem.stop(t + 2.5);
        }
    }
    brush(t) {
        const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 5000;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        s.connect(f).connect(g).connect(this.mus); s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
    }
    hit(f0, v, d, q = 4) {
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + d);
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + d + 0.02);
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = f0 * 2.2; f.Q.value = q;
        g2.gain.setValueAtTime(v * 0.8, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.6);
        s.connect(f).connect(g2).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + d);
    }
    clack(speed) { if (!this.ok || !this.gate("clack", 25)) return; const v = Math.min(0.45, speed / 40); if (v > 0.01) this.hit(1900 + Math.random() * 400, v, 0.05, 6); }
    rail(speed) { if (!this.ok || !this.gate("rail", 40)) return; const v = Math.min(0.35, speed / 45); if (v > 0.01) this.hit(140, v, 0.12, 1); }
    pot() { if (!this.ok) return; this.hit(110, 0.3, 0.25, 1); const t = this.ctx.currentTime; for (let i = 0; i < 4; i++) setTimeout(() => this.ok && this.hit(900 - i * 120, 0.08, 0.05, 5), 140 + i * 80); }
    strike(p) { if (!this.ok) return; this.hit(700, 0.15 + p * 0.25, 0.07, 3); }
    gate(n, ms) { const t = performance.now(); if (t - (this.last[n] || 0) < ms) return false; this.last[n] = t; return true; }
    chime(good) { if (!this.ok) return; const t = this.ctx.currentTime; (good ? [72, 76, 79] : [64, 60]).forEach((n, i) => this.epianoSfx(midi(n), t + i * 0.09)); }
    epianoSfx(f, t) { const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.3); }
    win() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.epianoSfx(midi(n), t + i * 0.1)); }
    click() { if (this.ok) this.hit(1400, 0.04, 0.03, 8); }
}
