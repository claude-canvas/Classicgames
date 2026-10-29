// Classic Race 3D sound: an engine whose pitch follows the speed, a whoosh as cars flash past, a bright chime for a
// near miss, a crash with scraping metal, and countdown beeps. Web Audio only, nothing to download.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("classicrace3d.muted") === "1"; } catch { }
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16;
        this.master.connect(comp).connect(ctx.destination);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // engine: two detuned saws through a low-pass, plus road rumble noise
        this.eng = ctx.createGain(); this.eng.gain.value = 0;
        this.engF = ctx.createBiquadFilter(); this.engF.type = "lowpass"; this.engF.frequency.value = 500; this.engF.Q.value = 3;
        this.oscs = [0, 7].map((d) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 60; o.detune.value = d; o.connect(this.engF); o.start(); return o; });
        const sub = ctx.createOscillator(); sub.type = "square"; sub.frequency.value = 30; const sg = ctx.createGain(); sg.gain.value = 0.25; sub.connect(sg).connect(this.engF); sub.start(); this.sub = sub;
        const rum = ctx.createBufferSource(); rum.buffer = this.noise; rum.loop = true; const rf = ctx.createBiquadFilter(); rf.type = "lowpass"; rf.frequency.value = 260; this.rumG = ctx.createGain(); this.rumG.gain.value = 0;
        rum.connect(rf).connect(this.rumG).connect(this.master); rum.start();
        this.engF.connect(this.eng).connect(this.master);
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("classicrace3d.muted", this.muted ? "1" : "0"); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
        return this.muted;
    }
    get ok() { return !!this.ctx && !this.muted && this.ctx.state === "running"; }
    engine(on, speed01, steer) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, f = 55 + speed01 * 95;
        for (const o of this.oscs) o.frequency.setTargetAtTime(f, t, 0.08);
        this.sub.frequency.setTargetAtTime(f / 2, t, 0.08);
        this.engF.frequency.setTargetAtTime(380 + speed01 * 900 + Math.abs(steer) * 120, t, 0.1);
        this.eng.gain.setTargetAtTime(on ? 0.11 : 0, t, 0.15);
        this.rumG.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.06 : 0, t, 0.2);
    }
    whoosh(v = 1) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.2;
        f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22 * v, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.42);
    }
    pluck(freq, t, v, dur = 0.5) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "triangle"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
    }
    nearMiss(n) { if (this.ok) { const t = this.ctx.currentTime; [76, 83, 88].forEach((m, i) => this.pluck(midi(m + Math.min(n, 6)), t + i * 0.05, 0.12)); } }
    milestone() { if (this.ok) { const t = this.ctx.currentTime; [72, 76, 79, 84].forEach((m, i) => this.pluck(midi(m), t + i * 0.07, 0.12, 0.7)); } }
    beep(hi) { if (this.ok) this.pluck(hi ? 1320 : 880, this.ctx.currentTime, 0.18, hi ? 0.5 : 0.25); }
    crash() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "lowpass"; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
        g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 0.92);
        const o = this.ctx.createOscillator(), g2 = this.ctx.createGain();
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
        g2.gain.setValueAtTime(0.6, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g2).connect(this.sfx); o.start(t); o.stop(t + 0.5);
        for (let i = 0; i < 4; i++) this.pluck(1800 + Math.random() * 1500, t + 0.05 + i * 0.07, 0.05, 0.2);
    }
    ui() { if (this.ok) this.pluck(midi(84), this.ctx.currentTime, 0.06, 0.3); }
}
