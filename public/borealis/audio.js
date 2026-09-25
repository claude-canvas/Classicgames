// Procedural soundtrack and effects for Borealis - no audio files needed.
// A slow Dm - Bb - F - C arpeggio with pad, soft kick and hats; the kick drives the visual beat.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 100;
const STEP = 60 / BPM / 4;
const CHORDS = [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]];
const BASS = [38, 34, 41, 36];
const ARP = [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1];
const EMBER_NOTES = [74, 77, 79, 81, 84, 86, 89, 91, 93, 96];

export class Sound {
    constructor(muted = false) {
        this.ctx = null;
        this.muted = muted;
        this.kicks = [];
        this.timer = null;
    }

    _init() {
        if (this.ctx) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        const c = (this.ctx = new AC());
        this.master = c.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(c.destination);
        this.music = c.createGain();
        this.music.gain.value = 0.5;
        this.music.connect(this.master);
        this.sfx = c.createGain();
        this.sfx.gain.value = 0.7;
        this.sfx.connect(this.master);

        // feedback echo for the arpeggio
        const d = c.createDelay(1.0), fb = c.createGain(), wet = c.createGain(), lp = c.createBiquadFilter();
        d.delayTime.value = STEP * 3;
        fb.gain.value = 0.32;
        wet.gain.value = 0.28;
        lp.type = "lowpass";
        lp.frequency.value = 2200;
        this.echo = c.createGain();
        this.echo.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(this.master);

        const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        return true;
    }

    start() {
        if (!this._init()) return;
        this.ctx.resume();
        if (!this.timer) {
            this.step = 0;
            this.next = this.ctx.currentTime + 0.1;
            this.timer = setInterval(() => this._tick(), 30);
        }
    }
    suspend() { if (this.ctx) this.ctx.suspend(); }
    resume() { if (this.ctx) this.ctx.resume(); }
    setMuted(m) {
        this.muted = m;
        if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.04);
    }

    // 1 right on a kick, decaying towards 0 - used to pulse lights with the music
    beat() {
        if (!this.ctx || this.ctx.state !== "running") return 0;
        const now = this.ctx.currentTime;
        let last = -1;
        for (const k of this.kicks) if (k <= now && k > last) last = k;
        return last < 0 ? 0 : Math.exp(-(now - last) * 5);
    }

    _tick() {
        const c = this.ctx;
        if (c.state !== "running") return;
        if (this.next < c.currentTime - 0.05) this.next = c.currentTime + 0.05; // skip what a throttled tab missed
        while (this.next < c.currentTime + 0.14) {
            this._step(this.step, this.next);
            this.next += STEP;
            this.step++;
        }
    }

    _step(s, t) {
        const bar = (s >> 4) % 4, i = s % 16, ch = CHORDS[bar];
        const k = ARP[i];
        const note = k === 3 ? ch[0] + 12 : ch[k];
        this._tone(midi(note + 12), t, 0.05, 0.24, "triangle", this.music, 2600, true);
        if (i === 0) for (const n of ch) this._pad(midi(n - 12), t, STEP * 16);
        if (i % 4 === 0) this._kick(t);
        if (i === 0 || i === 7 || i === 10) this._tone(midi(BASS[bar]), t, 0.2, 0.45, "sine", this.music, 800, false);
        if (i % 4 === 2) this._noise(t, 0.05, 0.035, "highpass", 7000, this.music);
    }

    _tone(freq, t, vol, dur, type, dest, cutoff, echo) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
        o.type = type;
        o.frequency.value = freq;
        f.type = "lowpass";
        f.frequency.value = cutoff;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f); f.connect(g); g.connect(dest);
        if (echo) g.connect(this.echo);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    _pad(freq, t, dur) {
        const c = this.ctx;
        for (const det of [-7, 7]) {
            const o = c.createOscillator(), g = c.createGain();
            o.type = "sine";
            o.frequency.value = freq;
            o.detune.value = det;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.03, t + 0.6);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(this.music);
            o.start(t);
            o.stop(t + dur + 0.05);
        }
    }

    _kick(t) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g); g.connect(this.music);
        o.start(t);
        o.stop(t + 0.3);
        this.kicks.push(t);
        if (this.kicks.length > 8) this.kicks.shift();
    }

    _noise(t, dur, vol, type, freq, dest) {
        const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        src.buffer = this.noiseBuf;
        f.type = type;
        f.frequency.value = freq;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(dest);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    _sweep(type, f0, f1, dur, vol) {
        const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
        o.connect(g); g.connect(this.sfx);
        o.start(t);
        o.stop(t + dur + 0.1);
    }

    // ------------------------------------------------------------------ effects
    ember(streak) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const n = EMBER_NOTES[Math.min(Math.max(streak, 1) - 1, EMBER_NOTES.length - 1)];
        this._tone(midi(n), t, 0.16, 0.25, "sine", this.sfx, 6000, true);
        this._tone(midi(n + 7), t + 0.05, 0.08, 0.22, "sine", this.sfx, 6000, false);
    }
    jump() { if (this.ctx) this._sweep("triangle", 260, 620, 0.16, 0.12); }
    land() { if (this.ctx) this._noise(this.ctx.currentTime, 0.12, 0.08, "lowpass", 500, this.sfx); }
    near() { if (this.ctx) this._tone(midi(98), this.ctx.currentTime, 0.05, 0.08, "sine", this.sfx, 8000, false); }
    hit() {
        if (!this.ctx) return;
        this._noise(this.ctx.currentTime, 0.35, 0.45, "lowpass", 900, this.sfx);
        this._sweep("sine", 140, 40, 0.3, 0.3);
    }
    shield() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        [81, 86, 93].forEach((n, i) => this._tone(midi(n), t + i * 0.06, 0.12, 0.3, "sine", this.sfx, 8000, true));
    }
    shieldBreak() {
        if (!this.ctx) return;
        this._noise(this.ctx.currentTime, 0.25, 0.2, "highpass", 3000, this.sfx);
        this._sweep("sine", 900, 300, 0.25, 0.12);
    }
    over() { if (this.ctx) this._sweep("sine", 440, 90, 1.1, 0.18); }
}
