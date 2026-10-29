// Gemfall sound (Web Audio, nothing to download): crystal clinks, cascade chimes climbing a pentatonic scale,
// line-gem zaps, bomb thumps, prism shimmer, star dings, fanfares and a soft music-box ambience.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.last = {}; }
    init() { try { this._init(); } catch (e) { console.warn("Gemfall: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.4; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        this.next = ctx.currentTime + 0.5; this.step = 0;
        this.timer = setInterval(() => this.ambient(), 300);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.7, this.ctx.currentTime, 0.05); }
    get ok() { return !!this.ctx && this.volume > 0; }
    gate(n, ms) { const t = performance.now(); if (t - (this.last[n] || 0) < ms) return false; this.last[n] = t; return true; }

    bell(f, t, v, d = 1.4, dest = this.sfx) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2.01, 0.35], [3.02, 0.15], [5.4, 0.06]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d / m);
            o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
        }
    }
    ambient() {
        const t0 = this.ctx.currentTime;
        const seq = [0, 4, 7, 11, 12, 11, 7, 4];
        while (this.next < t0 + 0.6) {
            if (this.step % 16 < 8 || Math.random() < 0.3) this.bell(midi(64 + seq[this.step % 8] + (Math.floor(this.step / 32) % 2 ? -3 : 0)), this.next, 0.018, 1.6);
            this.step++; this.next += 0.42;
        }
    }
    swap() { if (!this.ok) return; const t = this.ctx.currentTime; this.noise1(t, 2400, 0.08, 0.05); }
    noise1(t, f, d, v) {
        const ctx = this.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; fl.type = "bandpass"; fl.frequency.value = f; fl.Q.value = 2;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        s.connect(fl).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
    }
    bad() { if (!this.ok) return; const t = this.ctx.currentTime; for (const f of [220, 196]) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.2); } }
    clear(chain, n) {
        if (!this.ok || !this.gate("clear", 60)) return;
        const t = this.ctx.currentTime, base = 72 + PENTA[Math.min(chain, 9) % 5] + 12 * Math.floor(Math.min(chain, 9) / 5);
        this.bell(midi(base), t, 0.12); this.bell(midi(base + 7), t + 0.05, 0.07);
        if (n > 3) this.bell(midi(base + 12), t + 0.1, 0.06);
        this.noise1(t, 6000, 0.12, 0.04);
    }
    land() { if (this.ok && this.gate("land", 90)) this.noise1(this.ctx.currentTime, 3200, 0.04, 0.035); }
    create() { if (!this.ok) return; const t = this.ctx.currentTime; [84, 88, 91, 96].forEach((n, i) => this.bell(midi(n), t + i * 0.05, 0.06, 1)); }
    line() {
        if (!this.ok || !this.gate("line", 80)) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.35);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3000;
        g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.42);
    }
    bomb() {
        if (!this.ok || !this.gate("bomb", 100)) return;
        const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
        g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.52);
        this.noise1(t, 500, 0.4, 0.2);
    }
    prism() { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < 12; i++) this.bell(midi(76 + PENTA[i % 5] + 12 * Math.floor(i / 5)), t + i * 0.04, 0.05, 1.2); }
    hammer() { if (!this.ok) return; const t = this.ctx.currentTime; this.noise1(t, 1500, 0.2, 0.25); this.bell(midi(60), t, 0.08, 0.6); }
    star(i) { if (this.ok) this.bell(midi(79 + i * 4), this.ctx.currentTime, 0.12, 2); }
    win() { if (!this.ok) return; const t = this.ctx.currentTime; [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => this.bell(midi(n), t + i * 0.11, 0.1, 1.8)); }
    lose() { if (!this.ok) return; const t = this.ctx.currentTime; [76, 72, 69, 64].forEach((n, i) => this.bell(midi(n), t + i * 0.22, 0.08, 1.6)); }
    click() { if (this.ok) this.bell(midi(91), this.ctx.currentTime, 0.04, 0.4); }
}
