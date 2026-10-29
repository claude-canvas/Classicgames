// Blackmoor sound (Web Audio, all synthesized — DESIGN.md §5). Positional sounds take pan (−1..1), volume
// (0..1) and muffle (0 = clear, 1 = behind walls).

export class Audio {
    constructor() { this.ctx = null; this.volume = 0.85; this.dread = 0; this.hb = 0; }
    init() { try { this._init(); } catch (e) { console.warn("Blackmoor: audio unavailable", e); } }
    _init() {
        if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain(); this.master.gain.value = this.volume;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
        this.master.connect(comp).connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 3.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.55; this.verb.connect(wet).connect(this.master);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        this.brown = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const bd = this.brown.getChannelData(0); let l = 0; for (let i = 0; i < bd.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = l * 3.5; }
        this.dist = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); } this.dist.curve = curve;
        // rain
        this.loop(this.noise, [["highpass", 900, 0.5], ["lowpass", 7000, 0.5]], 0.035);
        // wind
        const wind = this.loop(this.noise, [["bandpass", 420, 0.8]], 0.03); this.windF = wind.f[0];
        // dread drone
        this.drone = ctx.createGain(); this.drone.gain.value = 0.0; this.drone.connect(this.master); this.drone.connect(this.verb);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 160; lp.connect(this.drone); this.droneLP = lp;
        for (const [f, t] of [[41.2, "sine"], [43.65, "sine"], [55, "sawtooth"], [82.4, "triangle"]]) { const o = ctx.createOscillator(); o.type = t; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = t === "sawtooth" ? 0.25 : 0.5; o.connect(g).connect(lp); o.start(); }
        // high eerie tone (only when danger is high)
        this.eerie = ctx.createGain(); this.eerie.gain.value = 0; this.eerie.connect(this.verb);
        for (const f of [1760, 1813]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(this.eerie); o.start(); }
        // generator hum (off until power)
        this.hum = ctx.createGain(); this.hum.gain.value = 0; this.hum.connect(this.master);
        { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 50; const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = 300; o.connect(f2).connect(this.hum); o.start(); }
        this.alarmG = ctx.createGain(); this.alarmG.gain.value = 0; this.alarmG.connect(this.master); this.alarmG.connect(this.verb);
        { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 700; const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 1.6; const lg = ctx.createGain(); lg.gain.value = 160; lfo.connect(lg).connect(o.frequency); const f3 = ctx.createBiquadFilter(); f3.type = "lowpass"; f3.frequency.value = 1500; o.connect(f3).connect(this.alarmG); o.start(); lfo.start(); }
        this.nextBeat = 0;
        this.timer = setInterval(() => this.tick(), 50);
    }
    loop(buf, filters, gain) {
        const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
        let node = s; const fs = [];
        for (const [type, f, q] of filters) { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; node.connect(fl); node = fl; fs.push(fl); }
        const g = ctx.createGain(); g.gain.value = gain; node.connect(g).connect(this.master); s.start(Math.random() * 0.1, Math.random() * 2);
        return { g, f: fs };
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    get ok() { return !!this.ctx && this.volume > 0; }
    // dread 0..1 drives the drone, heartbeat 0..1 the pulse
    tick() {
        const ctx = this.ctx, t = ctx.currentTime;
        this.drone.gain.setTargetAtTime(0.05 + this.dread * 0.28, t, 0.4);
        this.droneLP.frequency.setTargetAtTime(120 + this.dread * 500, t, 0.4);
        this.eerie.gain.setTargetAtTime(this.dread > 0.6 ? (this.dread - 0.6) * 0.012 : 0, t, 0.5);
        this.windF.frequency.setTargetAtTime(300 + 250 * Math.sin(t * 0.17) + 100 * Math.sin(t * 0.41), t, 0.6);
        if (this.hb > 0.05 && t >= this.nextBeat) {
            const rate = 0.95 - this.hb * 0.55, v = 0.15 + this.hb * 0.5;
            this.thump(t, v); this.thump(t + 0.16, v * 0.7);
            this.nextBeat = t + rate;
        } else if (this.hb <= 0.05) this.nextBeat = Math.max(this.nextBeat, t);
    }
    thump(t, v) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.25);
    }
    // a filtered noise burst routed through optional pan / muffle
    burst({ t = 0, f = 800, q = 1, type = "bandpass", v = 0.3, d = 0.1, a = 0.005, pan = 0, muffle = 0, verb = 0.3, buf = this.noise, rate = 1 } = {}) {
        if (!this.ok) return null;
        const ctx = this.ctx, T = ctx.currentTime + t;
        const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(v, T + a); g.gain.exponentialRampToValueAtTime(0.0001, T + a + d);
        let node = s.connect(fl).connect(g);
        if (muffle > 0) { const m = ctx.createBiquadFilter(); m.type = "lowpass"; m.frequency.value = 4000 * (1 - muffle) + 250; node = node.connect(m); }
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); node = node.connect(p); }
        node.connect(this.master);
        if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; node.connect(vg).connect(this.verb); }
        s.start(T, Math.random() * 2); s.stop(T + a + d + 0.05);
        return fl;
    }
    tone({ t = 0, f = 440, f2 = null, type = "sine", v = 0.1, a = 0.01, d = 0.5, pan = 0, verb = 0.4, dest = null } = {}) {
        if (!this.ok) return null;
        const ctx = this.ctx, T = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(f, T); if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + a + d);
        g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(v, T + a); g.gain.exponentialRampToValueAtTime(0.0001, T + a + d);
        let node = o.connect(g);
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
        node.connect(dest || this.master); if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; node.connect(vg).connect(this.verb); }
        o.start(T); o.stop(T + a + d + 0.05);
        return o;
    }

    step(surface, k = 1) {
        const f = surface === "tile" ? 1900 : surface === "wood" ? 650 : surface === "concrete" ? 1100 : 900;
        this.burst({ f, q: 1.2, v: 0.09 * k, d: 0.07, verb: 0.15 });
        this.burst({ f: 140, type: "lowpass", v: 0.16 * k, d: 0.08, verb: 0 });
    }
    monsterStep(pan, vol, muffle) {
        if (vol < 0.01) return;
        this.burst({ f: 220, type: "lowpass", q: 0.7, v: 0.55 * vol, d: 0.16, pan, muffle, verb: 0.4 });
        this.burst({ t: 0.05, f: 1300, q: 3, v: 0.12 * vol, d: 0.28, a: 0.08, pan, muffle, verb: 0.5 });   // drag
    }
    breath(pan, vol, muffle) {
        if (vol < 0.01) return;
        const f = this.burst({ f: 700, q: 2.5, v: 0.12 * vol, d: 0.9, a: 0.45, pan, muffle, verb: 0.5 });
        if (f) f.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 1.2);
    }
    whisper(pan = 0, vol = 0.6) {
        for (let i = 0; i < 7; i++) {
            const f = this.burst({ t: i * 0.13 + Math.random() * 0.05, f: 1800 + Math.random() * 1600, q: 6, v: 0.08 * vol, d: 0.1, a: 0.03, pan: pan + (Math.random() - 0.5) * 0.4, verb: 0.9 });
            if (f) f.frequency.exponentialRampToValueAtTime(900 + Math.random() * 900, this.ctx.currentTime + i * 0.13 + 0.15);
        }
    }
    creak(pan = 0, vol = 0.5, muffle = 0) {
        if (!this.ok) return;
        const ctx = this.ctx, T = ctx.currentTime, o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(90, T); o.frequency.linearRampToValueAtTime(140, T + 0.4); o.frequency.linearRampToValueAtTime(70, T + 0.9);
        fl.type = "bandpass"; fl.frequency.value = 900; fl.Q.value = 9;
        g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.18 * vol, T + 0.1); g.gain.linearRampToValueAtTime(0, T + 0.95);
        let node = o.connect(fl).connect(g);
        if (muffle) { const m = ctx.createBiquadFilter(); m.type = "lowpass"; m.frequency.value = 600; node = node.connect(m); }
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
        node.connect(this.master); node.connect(this.verb);
        o.start(T); o.stop(T + 1);
    }
    slam(pan = 0, vol = 1, muffle = 0.4) {
        this.burst({ f: 120, type: "lowpass", v: 0.9 * vol, d: 0.5, pan, muffle, verb: 1.2, buf: this.brown });
        this.burst({ f: 2200, q: 1, v: 0.25 * vol, d: 0.08, pan, muffle, verb: 1 });
    }
    thunder(vol = 1) {
        this.burst({ f: 3000, type: "lowpass", v: 0.25 * vol, d: 0.3, verb: 0.6 });
        this.burst({ t: 0.1, f: 260, type: "lowpass", v: 0.8 * vol, d: 3.5, a: 0.3, verb: 0.8, buf: this.brown, rate: 0.5 });
    }
    sting(vol = 1) {
        if (!this.ok) return;
        const base = [220, 233.1, 246.9, 311.1, 329.6, 466.2];
        base.forEach((f) => this.tone({ f: f * (Math.random() < 0.5 ? 1 : 2), f2: f * 0.97, type: "sawtooth", v: 0.05 * vol, a: 0.06, d: 2.2, pan: (Math.random() - 0.5) * 0.8, verb: 1 }));
        this.tone({ f: 1480, f2: 1390, type: "sawtooth", v: 0.035 * vol, a: 0.02, d: 1.4, verb: 1 });
        this.burst({ f: 90, type: "lowpass", v: 0.6 * vol, d: 0.8, verb: 0.8, buf: this.brown });
    }
    scream() {
        if (!this.ok) return;
        const ctx = this.ctx, T = ctx.currentTime;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.75, T + 0.03); g.gain.setValueAtTime(0.75, T + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, T + 1.6);
        g.connect(this.dist); this.dist.connect(this.master); this.dist.connect(this.verb);
        for (const [f, ty] of [[520, "sawtooth"], [780, "square"], [1170, "sawtooth"]]) {
            const o = ctx.createOscillator(); o.type = ty; o.frequency.setValueAtTime(f, T); o.frequency.linearRampToValueAtTime(f * 1.6, T + 0.25); o.frequency.linearRampToValueAtTime(f * 1.2, T + 1.5);
            const lfo = ctx.createOscillator(); lfo.frequency.value = 23; const lg = ctx.createGain(); lg.gain.value = f * 0.08; lfo.connect(lg).connect(o.frequency);
            const og = ctx.createGain(); og.gain.value = 0.25; o.connect(og).connect(g); o.start(T); o.stop(T + 1.7); lfo.start(T); lfo.stop(T + 1.7);
        }
        const s = ctx.createBufferSource(); s.buffer = this.noise; const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 2500; nf.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.value = 0.6; s.connect(nf).connect(ng).connect(g); s.start(T); s.stop(T + 1.7);
    }
    roar(pan = 0, vol = 1, muffle = 0) {
        if (!this.ok) return;
        const ctx = this.ctx, T = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(110, T); o.frequency.linearRampToValueAtTime(65, T + 2);
        const am = ctx.createOscillator(); am.frequency.value = 28; const amg = ctx.createGain(); amg.gain.value = 0.5; const g = ctx.createGain(); g.gain.value = 0.5; am.connect(amg).connect(g.gain);
        const env = ctx.createGain(); env.gain.setValueAtTime(0, T); env.gain.linearRampToValueAtTime(0.5 * vol, T + 0.3); env.gain.exponentialRampToValueAtTime(0.0001, T + 2.3);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900 * (1 - muffle * 0.7);
        let node = o.connect(g).connect(lp).connect(env);
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
        node.connect(this.master); node.connect(this.verb);
        o.start(T); o.stop(T + 2.4); am.start(T); am.stop(T + 2.4);
        this.burst({ f: 500, q: 1, v: 0.3 * vol, d: 2, a: 0.3, pan, muffle, verb: 1 });
    }
    crying(pan = 0, vol = 0.4) {
        for (let i = 0; i < 4; i++) { const f = 520 + Math.random() * 80; this.tone({ t: i * 0.9, f, f2: f * 0.75, type: "triangle", v: 0.025 * vol, a: 0.25, d: 0.6, pan, verb: 1.5 }); }
    }
    knock(pan = 0, vol = 0.8, n = 3) { for (let i = 0; i < n; i++) this.burst({ t: i * 0.32, f: 180, type: "lowpass", v: 0.6 * vol, d: 0.12, pan, muffle: 0.3, verb: 0.9, buf: this.brown }); }
    pickup() { this.burst({ f: 3000, q: 2, v: 0.08, d: 0.04, verb: 0.2 }); this.tone({ f: 330, type: "triangle", v: 0.05, d: 0.4, verb: 0.5 }); }
    keys() { for (let i = 0; i < 5; i++) this.tone({ t: i * 0.05 + Math.random() * 0.03, f: 2400 + Math.random() * 1800, v: 0.03, d: 0.15, verb: 0.4 }); }
    click() { this.burst({ f: 3500, q: 3, v: 0.12, d: 0.025, verb: 0 }); }
    locked() { this.burst({ f: 700, q: 4, v: 0.25, d: 0.06, verb: 0.3 }); this.burst({ t: 0.09, f: 650, q: 4, v: 0.2, d: 0.06, verb: 0.3 }); }
    clank() { this.burst({ f: 1600, q: 8, v: 0.3, d: 0.4, verb: 0.8 }); this.burst({ f: 200, type: "lowpass", v: 0.6, d: 0.2, verb: 0.6, buf: this.brown }); }
    paper() { this.burst({ f: 4000, q: 0.7, v: 0.07, d: 0.25, a: 0.05, verb: 0.2 }); }
    lockerIn() { this.burst({ f: 900, q: 6, v: 0.18, d: 0.25, verb: 0.4 }); this.burst({ t: 0.25, f: 300, type: "lowpass", v: 0.3, d: 0.1, verb: 0.3 }); }
    power() {
        if (!this.ok) return;
        const ctx = this.ctx, T = ctx.currentTime;
        this.burst({ f: 300, type: "lowpass", v: 0.6, d: 2.5, a: 1.2, verb: 0.6, buf: this.brown });
        this.hum.gain.setTargetAtTime(0.06, T + 1.5, 0.6);
        this.alarmG.gain.setTargetAtTime(0.035, T + 2.2, 0.2);
        this.tone({ t: 2, f: 60, type: "sawtooth", v: 0.2, a: 0.5, d: 2, verb: 1 });
    }
    lowBattery() { this.tone({ f: 1200, type: "square", v: 0.02, d: 0.08, verb: 0 }); }
    win() { if (!this.ctx) return; this.alarmG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5); this.hum.gain.setTargetAtTime(0, this.ctx.currentTime, 1); this.drone.gain.setTargetAtTime(0, this.ctx.currentTime, 1); }
}
