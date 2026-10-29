// Moonlake sound (Web Audio, nothing to download). Ambience follows the clock: lapping water always, crickets
// and frogs and the odd loon at night, birdsong at dawn; a slow plucked-guitar melody. Effects: cast whoosh,
// plop, nibble ticks, bite splash, reel clicker, line creak, snap, catch fanfare, new-species chime.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [0, 2, 4, 7, 9, 12, 14];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.6; this.night = 0; this.dawn = 0; this.last = {}; }
    init() { try { this._init(); } catch (e) { console.warn("Moonlake: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.8;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 3), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.5; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // lapping water
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 520; g.gain.value = 0.035;
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.23; lg.gain.value = 0.025; lfo.connect(lg).connect(g.gain);
        s.connect(f).connect(g).connect(this.master); s.start(); lfo.start();
        this.next = ctx.currentTime + 0.5; this.step = 0;
        this.timer = setInterval(() => this.tick(), 250);
        // reel clicker
        this.reelGain = ctx.createGain(); this.reelGain.gain.value = 0; this.reelGain.connect(this.sfx);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05); }
    setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
    get ok() { return !!this.ctx && this.volume > 0; }
    gate(n, ms) { const t = performance.now(); if (t - (this.last[n] || 0) < ms) return false; this.last[n] = t; return true; }

    pluck(f, t, v, dest) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2, 0.4], [3, 0.18], [4.1, 0.06]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = f * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 / m);
            o.connect(g).connect(dest || this.sfx); o.start(t); o.stop(t + 2.7);
        }
    }
    tick() {
        const ctx = this.ctx, t0 = ctx.currentTime;
        while (this.next < t0 + 0.7) {
            const t = this.next;
            if (this.step % 4 === 0 || Math.random() < 0.25) this.pluck(midi(55 + SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.2 ? 12 : 0)), t, 0.05, this.mus);
            if (this.step % 16 === 0) this.pluck(midi(43 + [0, 5, 7, 3][(this.step / 16) % 4]), t, 0.05, this.mus);
            this.step++; this.next += 0.85;
        }
        if (Math.random() < 0.35 * this.night) this.cricket(t0 + Math.random() * 0.25);
        if (Math.random() < 0.06 * this.night) this.frog(t0 + Math.random() * 0.25);
        if (Math.random() < 0.012 * this.night) this.loon(t0 + 0.1);
        if (Math.random() < 0.2 * this.dawn) this.bird(t0 + Math.random() * 0.25);
    }
    cricket(t) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
        o.frequency.value = 4300 + Math.random() * 700; am.frequency.value = 42; ag.gain.value = 0.006; am.connect(ag).connect(g.gain);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.006, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.3);
        o.connect(g).connect(this.master); o.start(t); am.start(t); o.stop(t + 0.32); am.stop(t + 0.32);
    }
    frog(t) {
        const ctx = this.ctx;
        for (let k = 0; k < 2; k++) {
            const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
            o.type = "sawtooth"; o.frequency.setValueAtTime(130 + Math.random() * 30, t + k * 0.16); f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 4;
            g.gain.setValueAtTime(0, t + k * 0.16); g.gain.linearRampToValueAtTime(0.05, t + k * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.16 + 0.12);
            o.connect(f).connect(g).connect(this.master); o.start(t + k * 0.16); o.stop(t + k * 0.16 + 0.14);
        }
    }
    loon(t) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
        o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(780, t + 0.8); o.frequency.linearRampToValueAtTime(690, t + 2.2);
        v.frequency.value = 6; vg.gain.value = 9; v.connect(vg).connect(o.frequency);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.3); g.gain.linearRampToValueAtTime(0.03, t + 1.8); g.gain.linearRampToValueAtTime(0, t + 2.4);
        o.connect(g); g.connect(this.verb); g.connect(this.master); o.start(t); v.start(t); o.stop(t + 2.5); v.stop(t + 2.5);
    }
    bird(t) {
        const ctx = this.ctx;
        for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) {
            const o = ctx.createOscillator(), g = ctx.createGain(), b = 2500 + Math.random() * 1500, tt = t + k * 0.11;
            o.frequency.setValueAtTime(b, tt); o.frequency.exponentialRampToValueAtTime(b * 1.3, tt + 0.06);
            g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.014, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
            o.connect(g).connect(this.master); o.start(tt); o.stop(tt + 0.1);
        }
    }
    noiseHit(type, f0, f1, d, v) {
        const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d);
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + d + 0.02);
    }
    cast() { if (this.ok) this.noiseHit("bandpass", 600, 3500, 0.5, 0.12); }
    plop(big = 0) { if (!this.ok) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(600 - big * 250, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.12); g.gain.setValueAtTime(0.18 + big * 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.22); this.noiseHit("bandpass", 1500, 500, 0.25 + big * 0.3, 0.08 + big * 0.15); }
    nibble() { if (this.ok && this.gate("nib", 150)) this.plop(-0.6); }
    bite() { if (!this.ok) return; this.plop(1); this.pluck(midi(84), this.ctx.currentTime, 0.08); }
    reel(rate) {
        if (!this.ctx) return;
        if (rate > 0.05 && this.gate("reel", 70 / Math.max(0.3, rate))) { const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "square"; o.frequency.value = 2200; g.gain.setValueAtTime(this.ok ? 0.015 : 0, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.025); }
    }
    creak(tension) { if (this.ok && tension > 0.8 && this.gate("creak", 380)) { const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(90 + tension * 60, t); g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.26); } }
    splash() { if (this.ok && this.gate("splash", 300)) this.noiseHit("lowpass", 3000, 300, 0.6, 0.18); }
    snap() { if (!this.ok) return; this.noiseHit("highpass", 4000, 8000, 0.12, 0.25); const t = this.ctx.currentTime; [64, 60, 57].forEach((n, i) => this.pluck(midi(n), t + 0.1 + i * 0.16, 0.06)); }
    catch(rarity) { if (!this.ok) return; const t = this.ctx.currentTime; const seq = rarity === "legendary" ? [60, 64, 67, 72, 76, 79, 84, 88] : rarity === "rare" ? [62, 66, 69, 74, 78] : [64, 67, 71, 76]; seq.forEach((n, i) => this.pluck(midi(n), t + i * 0.1, 0.09)); }
    newSpecies() { if (!this.ok) return; const t = this.ctx.currentTime + 0.5; [84, 88, 91, 96].forEach((n, i) => this.pluck(midi(n), t + i * 0.07, 0.05)); }
    click() { if (this.ok) this.pluck(midi(79), this.ctx.currentTime, 0.04); }
}
