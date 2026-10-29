// Grand Prix 3D sound: a screaming V6-style engine whose pitch follows the revs (and dips on every upshift), tyre
// squeal while sliding or locking up, rivals' engines doppler-ing past, wall hits, start-light beeps, lap chimes and a
// finish fanfare. Web Audio only, nothing to download.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem("grandprix3d.muted") === "1"; } catch { }
    }
    init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18;
        this.master.connect(comp).connect(ctx.destination);
        this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // engine: saw + square an octave down + a buzzy harmonic, through a resonant low-pass and a soft clipper
        this.eng = ctx.createGain(); this.eng.gain.value = 0;
        this.engF = ctx.createBiquadFilter(); this.engF.type = "lowpass"; this.engF.frequency.value = 1200; this.engF.Q.value = 4;
        const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
        shaper.curve = curve;
        const mk = (type, mul, gain, det = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.detune.value = det; g.gain.value = gain; o.connect(g).connect(shaper); o.start(); return [o, mul]; };
        this.oscs = [mk("sawtooth", 1, 0.5), mk("sawtooth", 1, 0.35, 9), mk("square", 0.5, 0.3), mk("sawtooth", 2, 0.12)];
        shaper.connect(this.engF).connect(this.eng).connect(this.master);
        // tyre squeal: band-passed noise
        const sq = ctx.createBufferSource(); sq.buffer = this.noise; sq.loop = true;
        this.sqF = ctx.createBiquadFilter(); this.sqF.type = "bandpass"; this.sqF.frequency.value = 1900; this.sqF.Q.value = 7;
        this.sqG = ctx.createGain(); this.sqG.gain.value = 0;
        sq.connect(this.sqF).connect(this.sqG).connect(this.master); sq.start();
        // road / gravel rumble
        const rum = ctx.createBufferSource(); rum.buffer = this.noise; rum.loop = true;
        this.rumF = ctx.createBiquadFilter(); this.rumF.type = "lowpass"; this.rumF.frequency.value = 300;
        this.rumG = ctx.createGain(); this.rumG.gain.value = 0;
        rum.connect(this.rumF).connect(this.rumG).connect(this.master); rum.start();
    }
    toggleMute() {
        this.muted = !this.muted;
        try { localStorage.setItem("grandprix3d.muted", this.muted ? "1" : "0"); } catch { }
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
        return this.muted;
    }
    get ok() { return !!this.ctx && !this.muted && this.ctx.state === "running"; }
    // rpm 0..1, load 0..1 (throttle), slip 0..1 (tyre squeal), rough 0..1 (off track)
    engine(on, rpm, load, slip, rough) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, f = 70 + rpm * 230;
        for (const [o, mul] of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
        this.engF.frequency.setTargetAtTime(700 + rpm * 2600 + load * 900, t, 0.05);
        this.eng.gain.setTargetAtTime(on ? 0.07 + load * 0.06 : 0, t, 0.08);
        this.sqG.gain.setTargetAtTime(on ? Math.min(0.16, slip * 0.2) : 0, t, 0.05);
        this.sqF.frequency.setTargetAtTime(1600 + slip * 700, t, 0.1);
        this.rumG.gain.setTargetAtTime(on ? rough * 0.25 : 0, t, 0.08);
        this.rumF.frequency.setTargetAtTime(rough > 0 ? 500 : 300, t, 0.1);
    }
    pass(v = 1) {   // a rival's engine flashing past
        if (!this.ok) return;
        const t = this.ctx.currentTime, o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(190, t + 0.5);
        f.type = "lowpass"; f.frequency.value = 1800;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1 * v, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.65);
    }
    pluck(freq, t, v, dur = 0.5, type = "triangle") {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
    }
    light() { if (this.ok) this.pluck(660, this.ctx.currentTime, 0.14, 0.18, "square"); }
    go() { if (this.ok) { const t = this.ctx.currentTime; this.pluck(1320, t, 0.18, 0.5, "square"); } }
    lap(final) { if (this.ok) { const t = this.ctx.currentTime; (final ? [72, 76, 79, 84, 88] : [76, 83, 88]).forEach((m, i) => this.pluck(midi(m), t + i * 0.08, 0.12, 0.6)); } }
    fastest() { if (this.ok) { const t = this.ctx.currentTime; [79, 83, 86, 91].forEach((m, i) => this.pluck(midi(m), t + i * 0.06, 0.1, 0.5)); } }
    finish(win) {
        if (!this.ok) return;
        const t = this.ctx.currentTime, seq = win ? [67, 72, 76, 79, 84, 79, 84, 88] : [67, 72, 76, 79];
        seq.forEach((m, i) => { this.pluck(midi(m), t + i * 0.12, 0.13, 0.7); this.pluck(midi(m - 12), t + i * 0.12, 0.08, 0.7, "sine"); });
    }
    hit(v = 1) {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        s.buffer = this.noise; f.type = "lowpass"; f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(250, t + 0.4);
        g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.5);
        const o = this.ctx.createOscillator(), g2 = this.ctx.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
        g2.gain.setValueAtTime(0.5 * v, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g2).connect(this.sfx); o.start(t); o.stop(t + 0.32);
    }
    ui() { if (this.ok) this.pluck(midi(84), this.ctx.currentTime, 0.06, 0.3); }
}
