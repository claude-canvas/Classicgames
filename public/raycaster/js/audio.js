// audio.js
// Procedural sound engine — everything here is synthesized with the Web
// Audio API at runtime, so there are no audio files to load or license.
// Two pieces: a low ambient dungeon drone that starts once, and short
// noise-burst "footstep" thuds triggered by player movement.

const AudioEngine = (() => {
  let ctx = null;
  let ambientGain = null;
  let started = false;
  let strideAccumulator = 0;

  const STRIDE_LENGTH = 0.55; // cells per footstep

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  // Must be called from a user gesture (click/tap) — browsers block audio
  // until then. Starts the ambient drone; safe to call more than once.
  function start() {
    if (started) return;
    started = true;
    const c = ensureContext();

    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.value = 55;
    osc2.frequency.value = 58; // slightly detuned for a low beating hum

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;

    ambientGain = c.createGain();
    ambientGain.gain.value = 0.05;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(ambientGain);
    ambientGain.connect(c.destination);

    osc1.start();
    osc2.start();

    // Slow LFO breathing the ambient volume so it doesn't feel static.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.1;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(ambientGain.gain);
    lfo.start();
  }

  // A single procedurally generated footstep thud (filtered noise burst).
  function footstep() {
    if (!ctx) return;
    const c = ctx;
    const bufferSize = Math.floor(c.sampleRate * 0.08);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = c.createBufferSource();
    noise.buffer = buffer;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    const gain = c.createGain();
    gain.gain.value = 0.18;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    noise.start();
  }

  // Call once per frame with how far (in cells) the player moved that
  // frame. Fires a footstep every STRIDE_LENGTH cells of travel.
  function reportMovement(distanceThisFrame) {
    if (!started || !distanceThisFrame) return;
    strideAccumulator += distanceThisFrame;
    if (strideAccumulator >= STRIDE_LENGTH) {
      strideAccumulator = 0;
      footstep();
    }
  }

  return { start, reportMovement };
})();
