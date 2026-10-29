// Sound for Crystal Keep (Web Audio, nothing to download): an autumn breeze with birdsong and slow lute-like
// plucks, plus effects — bow twang, cannon boom + explosion, frost chime, lightning crackle, coin, build thunk,
// upgrade chime, leak alarm, war horn, fanfares. Rapid-fire sounds are rate-limited so big fights stay musical.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [0, 2, 4, 7, 9, 12];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.last = {}; }
    init() {
        try { this._init(); } catch (e) { console.warn("Crystal Keep: audio unavailable", e); }
    }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.75;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 6;
        this.master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.3; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 420; g.gain.value = 0.018;
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.012; lfo.connect(lg).connect(g.gain);
        s.connect(f).connect(g).connect(this.master); s.start(); lfo.start();
        this.next = ctx.currentTime + 1;
        this.timer = setInterval(() => this.ambient(), 500);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.75, this.ctx.currentTime, 0.05); }
    get ok() { return !!this.ctx && this.volume > 0; }
    gate(name, gap) { const t = performance.now(); if (t - (this.last[name] || 0) < gap) return false; this.last[name] = t; return true; }

    ambient() {
        const t0 = this.ctx.currentTime;
        while (this.next < t0 + 0.8) {
            if (Math.random() < 0.3) this.pluck(midi(57 + SCALE[Math.floor(Math.random() * SCALE.length)]), this.next, 0.03);
            if (Math.random() < 0.12) this.bird(this.next + Math.random());
            this.next += 1.4 + Math.random();
        }
    }
    pluck(freq, t, vol) {
        const ctx = this.ctx;
        for (const [m, v] of [[1, 1], [2, 0.4], [3, 0.15]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = freq * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / m);
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.7);
        }
    }
    bird(t) {
        const ctx = this.ctx;
        for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
            const o = ctx.createOscillator(), g = ctx.createGain(), b = 2600 + Math.random() * 1400, tt = t + k * 0.13;
            o.frequency.setValueAtTime(b, tt); o.frequency.exponentialRampToValueAtTime(b * 1.35, tt + 0.07);
            g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.012, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
            o.connect(g).connect(this.master); o.start(tt); o.stop(tt + 0.12);
        }
    }
    noiseHit(t, type, f0, f1, dur, vol, q = 1) {
        const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = type; f.Q.value = q;
        f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }
    tone(t, type, f0, f1, dur, vol) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
    }
    shoot(type) {
        if (!this.ok || !this.gate(type, type === "archer" ? 70 : 110)) return;
        const t = this.ctx.currentTime;
        if (type === "archer") { this.tone(t, "triangle", 700, 220, 0.09, 0.05); this.noiseHit(t, "highpass", 3000, 1500, 0.06, 0.04); }
        else if (type === "cannon") { this.tone(t, "sine", 120, 40, 0.3, 0.3); this.noiseHit(t, "lowpass", 1200, 200, 0.25, 0.18); }
        else if (type === "frost") { this.pluck(midi(84 + Math.floor(Math.random() * 3) * 2), t, 0.04); }
        else if (type === "storm") { this.noiseHit(t, "bandpass", 5000, 900, 0.22, 0.14, 4); this.tone(t, "sawtooth", 180, 60, 0.15, 0.05); }
    }
    explode() { if (!this.ok || !this.gate("boom", 90)) return; const t = this.ctx.currentTime; this.noiseHit(t, "lowpass", 900, 80, 0.5, 0.25); this.tone(t, "sine", 80, 30, 0.4, 0.2); }
    frost() { if (!this.ok || !this.gate("frosthit", 120)) return; const t = this.ctx.currentTime; this.noiseHit(t, "highpass", 6000, 3000, 0.2, 0.04); }
    kill(boss) { if (!this.ok || !this.gate("kill", 45)) return; const t = this.ctx.currentTime; if (boss) { this.tone(t, "sine", 160, 40, 1.2, 0.35); this.noiseHit(t, "lowpass", 1500, 60, 1.2, 0.3); } else this.tone(t, "square", 520 + Math.random() * 120, 180, 0.08, 0.025); }
    coin() { if (!this.ok || !this.gate("coin", 60)) return; const t = this.ctx.currentTime; this.tone(t, "square", 1320, 1320, 0.05, 0.02); this.tone(t + 0.05, "square", 1760, 1760, 0.08, 0.02); }
    build() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(t, "sine", 200, 90, 0.18, 0.25); this.noiseHit(t, "lowpass", 800, 150, 0.15, 0.12); this.pluck(midi(72), t + 0.08, 0.06); this.pluck(midi(79), t + 0.16, 0.05); }
    upgrade() { if (!this.ok) return; const t = this.ctx.currentTime; [72, 76, 79, 84].forEach((n, i) => this.pluck(midi(n), t + i * 0.07, 0.07)); }
    sell() { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < 4; i++) this.tone(t + i * 0.05, "square", 1500 + i * 120, 1500 + i * 120, 0.04, 0.02); }
    leak() { if (!this.ok || !this.gate("leak", 300)) return; const t = this.ctx.currentTime; this.tone(t, "sawtooth", 330, 220, 0.35, 0.1); this.tone(t + 0.18, "sawtooth", 260, 170, 0.35, 0.1); }
    horn(boss) { if (!this.ok) return; const t = this.ctx.currentTime; const n = boss ? [45, 45, 52] : [50, 57]; n.forEach((m, i) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = midi(m); f.type = "lowpass"; f.frequency.value = 900; g.gain.setValueAtTime(0, t + i * 0.45); g.gain.linearRampToValueAtTime(0.12, t + i * 0.45 + 0.08); g.gain.linearRampToValueAtTime(0, t + i * 0.45 + 0.42); o.connect(f).connect(g).connect(this.sfx); o.start(t + i * 0.45); o.stop(t + i * 0.45 + 0.45); }); }
    cleared() { if (!this.ok) return; const t = this.ctx.currentTime; [67, 71, 74, 79].forEach((n, i) => this.pluck(midi(n), t + i * 0.09, 0.07)); }
    click() { if (!this.ok) return; this.tone(this.ctx.currentTime, "sine", 900, 600, 0.05, 0.05); }
    error() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(t, "square", 200, 150, 0.12, 0.05); this.tone(t + 0.1, "square", 160, 120, 0.15, 0.05); }
    won() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 64, 67, 72, 67, 72, 76, 79, 84].forEach((n, i) => this.pluck(midi(n), t + i * 0.12, 0.09)); }
    lost() { if (!this.ok) return; const t = this.ctx.currentTime; [64, 62, 59, 55, 52].forEach((n, i) => this.pluck(midi(n), t + i * 0.25, 0.08)); }
}
