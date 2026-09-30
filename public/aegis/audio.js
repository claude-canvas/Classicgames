// WebAudio for Aegis: a soft space pad, laser zaps and explosions. No audio files needed.
let ctx = null, master = null, pad = null, muted = false;

export function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}
export function isMuted() { return muted; }

export function unlock() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // ambient pad: a slow, filtered fifth with a breathing low-pass
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 2;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 350;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    for (const f of [55, 82.4, 110.3, 164.8]) {
        const o = ctx.createOscillator();
        o.type = "triangle"; o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 12;
        o.connect(lp); o.start();
    }
    lp.connect(g); g.connect(master);
    pad = g;
}

export function ambience(on) {
    if (!ctx) return;
    pad.gain.setTargetAtTime(on ? 0.05 : 0.02, ctx.currentTime, 1.2);
}

function tone(freq, dur, type = "sine", vol = 0.2, slide = 0, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, type, freq, vol, sweep = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t);
}

export function zap(combo) {
    const p = Math.pow(2, Math.min(combo, 12) / 12);
    tone(1500 * p, 0.14, "sawtooth", 0.07, 0.2);
    tone(900 * p, 0.1, "square", 0.03, 0.4);
}
export function tink() { tone(2400, 0.06, "square", 0.04, 0.6); }
export function boom(big) { noise(big ? 0.7 : 0.4, "lowpass", big ? 900 : 1600, big ? 0.8 : 0.5, 0.3); tone(big ? 90 : 140, 0.4, "sine", 0.25, 0.4); }
export function impact() { noise(1.1, "lowpass", 700, 1.0, 0.2); tone(60, 1.0, "sine", 0.4, 0.5); }
export function cityLost() { [392, 311, 262, 196].forEach((f, i) => tone(f, 0.45, "triangle", 0.12, 0.98, i * 0.16)); }
export function wave() { [262, 330, 392, 523].forEach((f, i) => tone(f, 0.5, "triangle", 0.09, 0, i * 0.1)); }
export function repair() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, "sine", 0.1, 0, i * 0.07)); }
export function charged() { tone(880, 0.25, "sine", 0.08); tone(1320, 0.35, "sine", 0.06, 0, 0.08); }
export function nova() { noise(1.4, "bandpass", 300, 0.9, 12); [196, 294, 392, 587].forEach((f) => tone(f, 1.4, "triangle", 0.07, 1.5)); }
