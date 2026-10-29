// Sky Labyrinth sound (Web Audio, nothing to download): a rolling-marble rumble that follows speed and surface,
// glass clinks on walls, sparkles for gems, a falling whistle, harp glissando at the well, high wind, and an
// airy pad + harp arpeggio that changes key with each isle.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const KEYS = [62, 64, 60, 57];                      // D · E · C · A
const PROG = [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]];
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.8; this.music = 0.5; this.isle = 0; }
    init() { try { this._init(); } catch (e) { console.warn("Sky Labyrinth: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume * 0.8;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.5; this.verb.connect(wet).connect(this.master);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master);
        this.sfxV = ctx.createGain(); this.sfxV.gain.value = 0.35; this.sfx.connect(this.sfxV).connect(this.verb);
        this.mus = ctx.createGain(); this.mus.gain.value = 0.45 * this.music; this.mus.connect(this.master); this.mus.connect(this.verb);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // brown-ish noise for the roll
        this.brown = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const bd = this.brown.getChannelData(0); let last = 0; for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
        // rolling marble
        const rs = ctx.createBufferSource(); rs.buffer = this.brown; rs.loop = true;
        this.rollF = ctx.createBiquadFilter(); this.rollF.type = "bandpass"; this.rollF.frequency.value = 300; this.rollF.Q.value = 0.8;
        this.rollG = ctx.createGain(); this.rollG.gain.value = 0;
        rs.connect(this.rollF).connect(this.rollG).connect(this.sfx); rs.start();
        const rs2 = ctx.createBufferSource(); rs2.buffer = this.noise; rs2.loop = true;
        this.rattleF = ctx.createBiquadFilter(); this.rattleF.type = "bandpass"; this.rattleF.frequency.value = 2500; this.rattleF.Q.value = 2;
        this.rattleG = ctx.createGain(); this.rattleG.gain.value = 0;
        rs2.connect(this.rattleF).connect(this.rattleG).connect(this.sfx); rs2.start();
        // wind
        const ws = ctx.createBufferSource(); ws.buffer = this.noise; ws.loop = true;
        this.windF = ctx.createBiquadFilter(); this.windF.type = "bandpass"; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
        const wg = ctx.createGain(); wg.gain.value = 0.025; ws.connect(this.windF).connect(wg).connect(this.master); ws.start();
        this.beat = 0; this.next = ctx.currentTime + 0.5;
        this.timer = setInterval(() => this.tick(), 200);
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.05); }
    setMusic(v) { this.music = v; if (this.mus) this.mus.gain.setTargetAtTime(0.45 * v, this.ctx.currentTime, 0.1); }
    get ok() { return !!this.ctx && this.volume > 0; }

    tick() {
        const ctx = this.ctx, spb = 0.42;
        this.windF.frequency.setTargetAtTime(380 + 260 * Math.sin(ctx.currentTime * 0.13) + 120 * Math.sin(ctx.currentTime * 0.31), ctx.currentTime, 0.5);
        while (this.next < ctx.currentTime + 0.6) {
            const key = KEYS[this.isle % 4], bar = Math.floor(this.beat / 8) % PROG.length, b = this.beat % 8, ch = PROG[bar];
            if (b === 0) for (const n of ch) this.pad(midi(key - 12 + n), this.next, spb * 8);
            if (b === 0) this.harp(midi(key - 24 + ch[0]), this.next, 0.05, 3);
            if (Math.random() < (b % 2 === 0 ? 0.7 : 0.3)) {
                const p = PENTA[(b * 3 + bar * 2 + Math.floor(Math.random() * 3)) % PENTA.length];
                this.harp(midi(key + p), this.next, 0.03 + Math.random() * 0.015, 2.2);
            }
            this.beat++; this.next += spb;
        }
    }
    pad(f, t, d) {
        const ctx = this.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.5;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.018, t + d * 0.4); g.gain.linearRampToValueAtTime(0, t + d * 1.05);
        for (const det of [-7, 6]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + d * 1.1); }
        lp.connect(g).connect(this.mus);
    }
    harp(f, t, v, d, dest = this.mus) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2, 0.4], [3, 0.15], [4, 0.06]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = m === 1 ? "triangle" : "sine"; o.frequency.value = f * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d / m);
            o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
        }
    }
    bell(f, t, v, d = 1.5) {
        const ctx = this.ctx;
        for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.1]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f * m;
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d / Math.sqrt(m));
            o.connect(g).connect(this.sfx); o.start(t); o.stop(t + d + 0.05);
        }
    }
    burst(t, f, q, v, d, type = "bandpass") {
        const ctx = this.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        s.connect(fl).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + d + 0.05);
        return fl;
    }

    // continuous: speed in u/s, surface "." "~" ":"; z < 0 when falling
    roll(speed, surface, airborne) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, k = airborne ? 0 : Math.min(1, speed / 6);
        const ice = surface === "~", moss = surface === ":";
        this.rollG.gain.setTargetAtTime(this.ok ? k * (moss ? 0.25 : ice ? 0.3 : 0.55) : 0, t, 0.05);
        this.rollF.frequency.setTargetAtTime((moss ? 140 : ice ? 520 : 240) + speed * (ice ? 90 : 45), t, 0.05);
        this.rattleG.gain.setTargetAtTime(this.ok && !moss ? k * k * (ice ? 0.05 : 0.025) : 0, t, 0.05);
        this.rattleF.frequency.setTargetAtTime(ice ? 4200 : 2300 + speed * 120, t, 0.08);
    }
    hit(s) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, v = Math.min(1, s / 5);
        this.burst(t, 3200, 4, 0.15 * v, 0.03);
        this.bell(1900 + Math.random() * 500, t, 0.05 * v, 0.25);
        this.burst(t, 400, 1, 0.25 * v, 0.06, "lowpass");
    }
    gem(i) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, base = 79 + i * 2;
        [0, 4, 7, 12, 16].forEach((n, k) => this.bell(midi(base + n), t + k * 0.055, 0.05, 1.2));
    }
    fall(hole) {
        if (!this.ok) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(1100, t); o.frequency.exponentialRampToValueAtTime(140, t + 1.0);
        g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.1);
        const f = this.burst(t, 900, 0.8, 0.12, 1.0); f.frequency.exponentialRampToValueAtTime(200, t + 1.0);
        if (hole) this.burst(t, 2600, 6, 0.1, 0.05);
    }
    respawn() { if (!this.ok) return; const t = this.ctx.currentTime; [0, 7, 12].forEach((n, k) => this.harp(midi(KEYS[this.isle % 4] + 12 + n), t + k * 0.07, 0.06, 1.2, this.sfx)); }
    check() { if (!this.ok) return; const t = this.ctx.currentTime; this.bell(midi(76), t, 0.07, 2); this.bell(midi(83), t + 0.1, 0.05, 2); }
    bump() { if (!this.ok) return; const t = this.ctx.currentTime; this.bell(820 + Math.random() * 60, t, 0.1, 0.5); this.burst(t, 1500, 2, 0.12, 0.04); }
    boost() {
        if (!this.ok) return;
        const t = this.ctx.currentTime, f = this.burst(t, 600, 1.5, 0.12, 0.45);
        f.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
    }
    switch() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        this.burst(t, 300, 1, 0.4, 0.12, "lowpass");
        for (let i = 0; i < 6; i++) this.burst(t + 0.15 + i * 0.09, 2200, 5, 0.08, 0.03);
        const f = this.burst(t + 0.1, 180, 0.7, 0.18, 1.2); f.frequency.linearRampToValueAtTime(90, t + 1.2);
        this.bell(midi(72), t + 0.05, 0.05, 1.5);
    }
    crack() { if (!this.ok) return; const t = this.ctx.currentTime; for (let i = 0; i < 4; i++) this.burst(t + i * 0.05 + Math.random() * 0.03, 1800 + Math.random() * 1500, 3, 0.07, 0.03); }
    crumble() { if (!this.ok) return; const t = this.ctx.currentTime; this.burst(t, 220, 0.8, 0.25, 0.6, "lowpass"); for (let i = 0; i < 6; i++) this.burst(t + Math.random() * 0.4, 1200 + Math.random() * 2000, 4, 0.05, 0.04); }
    goal() {
        if (!this.ok) return;
        const t = this.ctx.currentTime, key = KEYS[this.isle % 4];
        [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24].forEach((n, k) => this.harp(midi(key + n), t + k * 0.045, 0.06, 2.4, this.sfx));
        [0, 4, 7, 12].forEach((n) => this.bell(midi(key + 12 + n), t + 0.55, 0.04, 3));
    }
    star(i) { if (!this.ok) return; const t = this.ctx.currentTime; this.bell(midi(84 + i * 3), t, 0.07, 1.6); this.harp(midi(72 + i * 4), t, 0.05, 1.5, this.sfx); }
    click() { if (!this.ok) return; const t = this.ctx.currentTime; this.burst(t, 2500, 3, 0.08, 0.03); }
}
