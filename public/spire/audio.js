// Tiny WebAudio synth for Spire: a soft evening pad that climbs with the tower, plus chimes for every drop.
let ctx = null, master = null, pad = null, muted = false;

export function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}
export function isMuted() { return muted; }

const CHORDS = [[0, 7, 12, 16], [3, 7, 12, 17], [5, 9, 12, 19], [7, 10, 14, 19], [2, 9, 14, 17]];
const ROOT = 110;

export function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // pad: four detuned sines through a slowly breathing low-pass
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.7;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.11; lfoG.gain.value = 260;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    const oscs = [];
    for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator();
        o.type = i === 3 ? 'triangle' : 'sine';
        o.frequency.value = ROOT * Math.pow(2, CHORDS[0][i] / 12);
        o.detune.value = (i - 1.5) * 5;
        o.connect(lp); o.start();
        oscs.push(o);
    }
    lp.connect(g); g.connect(master);
    pad = { g, oscs };
}

// on: pad audible; alt: slabs stacked so far (the chord changes every 12)
export function padLevel(on, alt) {
    if (!ctx || !pad) return;
    const t = ctx.currentTime;
    const ch = CHORDS[Math.min(Math.floor(alt / 12), CHORDS.length - 1)];
    pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(ROOT * Math.pow(2, ch[i] / 12), t, 1.2));
    pad.g.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.6);
}

function tone(freq, dur, type, vol, slide, when) {
    if (!ctx) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, type, freq, vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

// an ordinary drop: a soft thock
export function place() {
    tone(190, 0.16, 'sine', 0.22, 0.4);
    noise(0.05, 'lowpass', 1400, 0.18);
}
// a perfect drop: a bell that climbs a pentatonic scale with the streak
export function perfect(streak) {
    const f = 523.25 * Math.pow(2, SCALE[Math.min(streak, SCALE.length - 1)] / 12);
    tone(f, 0.5, 'sine', 0.2);
    tone(f * 2, 0.35, 'triangle', 0.06, 0, 0.02);
    tone(f * 3, 0.2, 'sine', 0.03, 0, 0.04);
    tone(190, 0.12, 'sine', 0.12, 0.4);
}
export function cut() { noise(0.28, 'bandpass', 1800, 0.22); }
export function grow() { [784, 988, 1175].forEach((f, i) => tone(f, 0.3, 'triangle', 0.07, 0, i * 0.05)); }
export function fail() {
    noise(0.5, 'lowpass', 700, 0.5);
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 'triangle', 0.12, 0.8, i * 0.12));
}
export function start() { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, 0, i * 0.07)); }
