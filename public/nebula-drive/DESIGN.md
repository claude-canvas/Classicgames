# Nebula Drive — design & hand-off document

> A rhythm game on a glowing four-lane highway that curves through a nebula. Gems ride the beat toward you;
> hit D F J K (or tap the lanes) as each gem crosses the strike line, and hold through the long trails. Every
> song is composed and synthesized live in the browser, so its note chart is generated from the very same
> score: perfectly in sync, with no audio files.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/nebula-drive/`; do not edit outside it.

## 1. Music & charts (`music.js`)
- **Song recipe** (seeded): `bpm`, key, scale, a 4-chord progression, drum pattern, arpeggio style, a melody
  generated per bar from chord tones plus passing tones with motif repetition (bars 1–2 repeat with variation in
  3–4), and a 3-section form: intro (8 bars), verse (16), chorus (16), outro (4).
- **Synth:** Web Audio, scheduled ahead with a lookahead timer:
  - kick, snare and hats;
  - a sawtooth bass;
  - a supersaw pad;
  - a pluck lead for the melody;
  - an arpeggio.
- **Chart:**
  - Built from the same event list. Melody notes map to lanes by pitch, relative to a moving pitch window, so
    phrases feel like they climb across the lanes.
  - Long melody notes (≥ 1 beat) become **holds**.
  - Kick drum accents add notes in sparse sections.
  - Difficulty filters the density: Easy has quarter notes on strong beats only and max 1 note at a time;
    Normal has eighths; Hard has everything plus chords (2 lanes) on accents.
- **Clock:** the song time is `audioCtx.currentTime − start`. If audio is unavailable or suspended, a
  `performance.now()` clock runs instead. A calibration offset is set in settings (±150 ms).

## 2. Gameplay (`main.js`)
- **Lanes:** 4 lanes. Gems spawn 2.2 s ahead, at a speed setting of 1–5, and travel along the highway to the strike
  line.
- **Judgement:** |Δt| ≤ 45 ms Perfect, ≤ 90 Great, ≤ 140 Good, otherwise Miss (when a gem passes or a press hits
  nothing nearby).
- **Holds:** press within the window and keep it held until the tail. Releasing early breaks the hold, and points
  stop.
- **Scoring:**
  - Perfect 300, Great 200, Good 100, and hold ticks 20 per beat;
  - a combo multiplier ×1 / ×2 / ×3 / ×4 at 10 / 25 / 50 combo;
  - **Overdrive:** a meter fills on Perfects; pressing Space doubles the score for 8 beats and the highway turns
    gold.
- **Energy bar:** misses drain it and hits refill it. A song fails when it empties; "No-fail" is in settings.
- **Results:** a grade (S/A/B/C/D) from accuracy, max combo, and counts per judgement. The best per song ×
  difficulty is saved in `nebuladrive.save`.

## 3. Presentation
- **Highway:**
  - a dark glassy road with glowing lane dividers and neon edges in the song's palette;
  - it curves gently (a sine-based path) and pulses on every beat.
- **Gems:** faceted crystals in lane colours (pink, amber, cyan, violet), each with a soft halo. Hold trails are
  ribbons.
- **Strike line:** four receptor rings that flash on press, plus hit bursts (sparks and a shockwave ring) coloured
  by judgement.
- **Space:**
  - a nebula skybox (fbm clouds in the song's palette);
  - star streaks that speed with the tempo;
  - big ringed planets drifting past;
  - beat-synced rings ("gates") flying toward the camera on downbeats;
  - asteroid silhouettes.
- **Camera:** behind and above the strike line, with a sway on beats and a kick on chorus entry.

## 4. UI
- **Title:** logo, a song list (name, bpm, length, best grade per difficulty), difficulty, Play and Settings
  (volume, music, offset, note speed, no-fail).
- **HUD:** score, combo, multiplier, overdrive meter, energy, song progress, judgement popups.
- **Results card.**

## 5. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `music.js` · `main.js`

## 6. Debug
- `?auto`: the bot hits every note Perfect.
- `?song=N&diff=easy|normal|hard`
- `window.__beats()` returns the current state.

## 7. Progress log
- v1 (2026-10-19): complete and playable.
  - **Tracks:** 5 composed tracks of 70–98 s (Ignition 108 bpm, Solar Wind 120, Event Horizon 128, Quasar Bloom
    136, Supernova 150).
  - **Charts:** Easy, Normal and Hard, with 0.9–2.9 notes per second, holds and chords. Test with scratchpad
    `ndtest.mjs`.
  - **Features:** autoplay demo on the title, overdrive, energy/no-fail, grades, beat gates, planets and
    asteroids, star streaks, and the road curve with camera roll (`GameSpace.roll`, copied from canyon-glide).
  - **Debug:** `?mute` skips audio init. In headless Chrome the audio thread starves, so the audio clock runs
    slow; that is a headless-only artefact. The game holds a steady 59–60 fps.
  - **Hit timing:** judged against `songTime()` (audio clock minus the start minus the offset).
