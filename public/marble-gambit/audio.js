// Marble Gambit sound (Web Audio, nothing to download): stone-on-stone clicks for moves, a heavier knock for
// captures, a soft chime for check, chords at the end of the game, and a sparse Satie-like piano over a
// distant fountain murmur.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PROG = [[43, [59, 62, 66]], [45, [57, 61, 64]], [43, [59, 62, 66]], [38, [57, 62, 66]]];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.5; }
    init() { try { this._init(); } catch (e) { console.warn("Marble Gambit: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.8;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.45; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.verb);
        this.mus = ctx.createGain(); this.mus.gain.value = 0.5 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; s.loop = true; f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.6; g.gain.value = 0.012;
        s.connect(f).connect(g).connect(this.master); s.start();
        this.beat = 0; this.next = ctx.currentTime + 1;
        this.timer = setInterval(() => this.piano(), 300);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05); }
    setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1); }
    get ok() { return !!this.ctx && this.volume > 0; }
    note(f, t, v, dest = this.mus, d = 3) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2, 0.32], [3, 0.12], [4.02, 0.05]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = f * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d / m);
            o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
        }
    }
    piano() {
        const ctx = this.ctx, spb = 0.95;
        while (this.next < ctx.currentTime + 0.8) {
            const bar = Math.floor(this.beat / 3) % PROG.length, b = this.beat % 3, [root, ch] = PROG[bar];
            if (b === 0) this.note(midi(root), this.next, 0.06);
            else this.note(midi(ch[(b + bar) % 3] + (Math.random() < 0.25 ? 12 : 0)), this.next, 0.04);
            if (b === 2 && Math.random() < 0.35) this.note(midi(ch[0] + 12 + [0, 2, 4][Math.floor(Math.random() * 3)]), this.next + spb * 0.5, 0.035);
            this.beat++; this.next += spb;
        }
    }
    click(t0 = 0, heavy = 0) {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime + t0;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = heavy ? 1300 : 2600; f.Q.value = 3;
        g.gain.setValueAtTime(0.35 + heavy * 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + heavy * 0.05);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.12);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.setValueAtTime(heavy ? 420 : 900, t); o.frequency.exponentialRampToValueAtTime(heavy ? 160 : 500, t + 0.06);
        og.gain.setValueAtTime(0.18, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.1);
    }
    move() { this.click(); }
    capture() { this.click(0, 1); this.click(0.06, 0); }
    castle() { this.click(); this.click(0.14); }
    check() { if (this.ok) { const t = this.ctx.currentTime; this.note(midi(81), t, 0.08, this.sfx, 1.2); this.note(midi(76), t + 0.08, 0.06, this.sfx, 1.2); } }
    select() { if (this.ok) this.note(midi(86), this.ctx.currentTime, 0.025, this.sfx, 0.4); }
    illegal() { if (this.ok) this.note(midi(48), this.ctx.currentTime, 0.06, this.sfx, 0.5); }
    win() { if (!this.ok) return; const t = this.ctx.currentTime; [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.note(midi(n), t + i * 0.12, 0.08, this.sfx, 2.5)); }
    lose() { if (!this.ok) return; const t = this.ctx.currentTime; [69, 65, 62, 57].forEach((n, i) => this.note(midi(n), t + i * 0.25, 0.07, this.sfx, 2.5)); }
    draw() { if (!this.ok) return; const t = this.ctx.currentTime; [62, 66, 69, 74].forEach((n) => this.note(midi(n), t, 0.05, this.sfx, 3)); }
}
