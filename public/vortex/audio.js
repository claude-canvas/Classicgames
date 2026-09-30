// Tiny WebAudio synth for Vortex: an engine drone that climbs with speed, plus blips.
let ctx = null, master = null, drone = null, muted = false;

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

    // engine: two detuned saws through a low-pass
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300; lp.Q.value = 6;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = "sawtooth";
    o1.frequency.value = 55; o2.frequency.value = 55.6;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
    o1.start(); o2.start();
    drone = { g, lp, o1, o2 };
}

// speed01: 0..1, on: whether the engine should be audible
export function engine(speed01, on) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 48 + speed01 * 40;
    drone.o1.frequency.setTargetAtTime(f, t, 0.2);
    drone.o2.frequency.setTargetAtTime(f * 1.012, t, 0.2);
    drone.lp.frequency.setTargetAtTime(260 + speed01 * 900, t, 0.2);
    drone.g.gain.setTargetAtTime(on ? 0.055 : 0, t, 0.25);
}

function tone(freq, dur, type = "triangle", vol = 0.2, slide = 0, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
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

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export function orb(streak) {
    const step = SCALE[Math.min(streak, SCALE.length - 1)];
    tone(523.25 * Math.pow(2, step / 12), 0.16, "triangle", 0.16);
    tone(1046.5 * Math.pow(2, step / 12), 0.1, "sine", 0.05, 0, 0.03);
}
export function nearMiss() { noise(0.22, "highpass", 2400, 0.25); tone(880, 0.12, "sine", 0.05, 1.5); }
export function hit() { noise(0.45, "lowpass", 900, 0.9); tone(160, 0.5, "square", 0.12, 0.3); }
export function shield() { [660, 880, 1320].forEach((f, i) => tone(f, 0.25, "sine", 0.12, 0, i * 0.06)); }
export function shieldBreak() { noise(0.3, "bandpass", 1500, 0.6); tone(990, 0.3, "sine", 0.1, 0.5); }
export function zone() { [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.35, "triangle", 0.1, 0, i * 0.09)); }
export function crash() { noise(1.2, "lowpass", 600, 1.0); tone(110, 1.1, "sawtooth", 0.15, 0.25); }
