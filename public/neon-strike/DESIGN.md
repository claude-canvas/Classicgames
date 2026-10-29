# Neon Strike — design & hand-off document

> Ten-pin bowling in a synthwave alley after midnight. The lane is mirror-polished, and neon runs along the
> gutters and the ceiling. A big vector-neon sign above the pins lights up with STRIKE, SPARE and SPLIT.
>
> Swipe to throw: the swipe's direction aims, its speed is the ball speed, and its curve is the hook. The pins
> are physically simulated, so they scatter, topple, slide into the pit and take each other down.
>
> Play a full 10-frame game solo or against a CPU bowler.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/neon-strike/`; do not edit outside it.

## 1. Lane & scoring
- **Real dimensions (metres):**
  - lane width 1.054 and length 18.29 from the foul line (y = 0) to the head pin;
  - gutters 0.235 wide;
  - pin spacing 0.3048 in an equilateral triangle;
  - the pit begins 0.86 behind the 10-pin row.
- **Scoring:** standard ten-pin.
  - A **strike** scores 10 + the next 2 rolls; a **spare** scores 10 + the next roll.
  - The **10th frame** gives up to 3 rolls.
  - A perfect game is 300.
- **Rolls:** after roll 1, deadwood (fallen pins) is swept away and the standing pins are re-set exactly where they
  stand. After a strike, or after the second roll, a full rack is set.
- **Split detection:** after roll 1, the head pin is down and the standing pins form two groups separated by a
  missing pin column. When it happens, the sign flashes SPLIT.

## 2. Physics (`physics.js`, fixed step 1/600 s)
- **Ball:**
  - radius 0.109, mass 7 kg;
  - state: position (x, y), velocity, and sidespin `w`, where positive is a hook to the left as seen from the
    bowler, toward the right-hander's pocket.
  - It skids through the **oil** (y < 12 m, μ = 0.04), then grips the dry back end (μ = 0.18).
  - Hook acceleration is `a_x = −k·w·μ(y)·g` while it skids, and the spin converts and decays. This gives the
    real look: straight down the oil, then a hard hook at the break point.
  - Speed losses are small; a typical ball speed is 7–9 m/s.
- **Gutter:** when |x| > 0.527 the ball drops into the gutter, rolls straight to the pit and touches no pins.
- **Pins:**
  - mass 1.53 kg, radius 0.061 at the belly, height 0.38;
  - state: base position, base velocity, tilt angle `θ` and tilt rate, fall direction, spin about the vertical
    axis, and `out` (in the pit).
- **Ball–pin collisions:** elastic with e = 0.75, between circles at belly height. The pin gets linear velocity and
  a tilt impulse in the hit direction.
- **Pin–pin collisions:**
  - A *standing* pin is a disc of r = 0.061.
  - A *tilting or lying* pin is a capsule from its base to its head point (`base + dir·0.38·sinθ`).
  - Capsule-versus-disc contacts push and tilt the struck pin, which is what makes falling pins knock their
    neighbours over.
- **Toppling:**
  - Tilt has a gravity torque: below θ ≈ 9° a pin rocks back upright (damped); beyond that it falls with
    `θ'' = (3g/2h)·sinθ` until it lies at 90°.
  - Lying pins slide with friction 0.35·g and spin.
- **Removal:** a pin is out if its base passes the pit line or falls off the deck sides. Pins count as knocked
  down when θ > 25° or they are out once everything has settled (all speeds below a threshold), or after 4.5 s.
- **Kickbacks:** the side walls of the pin deck reflect pins with e = 0.5, so pins rebounding off the kickback
  plates can take out corner pins.

## 3. Throwing (`main.js`)
- **Position:** drag along the bottom strip (the approach), or press A/D, to move the ball across the foul line
  (x ∈ [−0.45, 0.45]).
- **Swipe:** press, move up the screen and release.
  - *Direction* is the angle of the line from the start point to the end point, clamped to ±3°.
  - *Speed* is the swipe speed in px/s mapped to 5.5–10 m/s.
  - *Hook* is the signed deviation of the swipe's midpoint from the straight start–end line, normalised, which
    gives `w ∈ [−1, 1]`.
  - A live ghost path previews the trajectory while dragging, as the first 8 m only. A full preview at the
    "Easy" setting shows the whole path.
- **Keyboard:** ←/→ aim, Q/E hook, and hold Space for the power meter, releasing to roll.
- **CPU bowler:**
  - targets the 1-3 pocket with a hook, or makes a spare conversion by aiming at the remaining pin cluster with
    a straighter ball;
  - adds Gaussian noise to position, angle, speed and spin;
  - has three skill levels: Rookie, League, Pro.

## 4. Presentation
- **Alley:**
  - a glossy maple lane with boards and a wood-grain shader;
  - arrows and dots inlaid in the lane;
  - a reflective finish: pins and ball are mirrored below the lane, blended by the LANE material alpha;
  - black-light gutters with cyan/magenta neon tubes;
  - neighbouring lanes, with ghost bowlers' balls rolling occasionally;
  - a back wall grid in perspective, and a ceiling of neon tubes;
  - haze in the light.
- **Pins:** glossy white with two red neck stripes, plus a faint neon rim glow.
- **Ball:** swirled urethane, purple/cyan, with a spinning highlight and a light trail.
- **Sign:** a vector-neon sign above the deck. Letters are stroke-font polylines drawn as additive tubes that
  flicker on. STRIKE gets a rainbow chase; SPARE, SPLIT and GUTTER each get their own colour.
- **Impact:** slow motion (×0.3 for 0.9 s) as the ball meets the head pin, a camera push-in, a pin-deck flash and
  sparks.
- **Camera:** behind the bowler → tracking the ball → pin-deck close-up during the crash → back.
- **Audio:**
  - ball roll rumble, rising in pitch with speed;
  - pin clatter: many short wooden knocks, scaled by impact;
  - pinsetter whirr;
  - crowd cheers on strikes;
  - synthwave music: an arpeggio, a bass and a gated pad.

## 5. UI
- **Title:** logo over the alley, with Solo, Vs CPU (difficulty) and Settings (sound, music, aim preview).
- **HUD:** the classic scoresheet (frames 1–10, roll marks X / − and the running total) for each player, whose
  turn it is, the speed of the last roll, and the hook meter.
- **End:** a game summary with the score, strikes and spares, best saved (`neonstrike.save`), and Play again.

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue from lantern-bow) · `shaders.js` ·
`physics.js` · `scoring.js` · `font.js` (stroke font) · `scene.js` · `audio.js` · `main.js`

## 7. Debug
- `?auto`: the CPU plays every roll.
- `window.__bowl()` returns the current state.
- `?seed=N` makes the CPU noise deterministic.

## 8. Progress log
- v1 (2026-10-19): complete and playable.
  - Features: solo and vs-CPU modes (3 skills, computed in a worker), swipe or keyboard throwing, a mirrored lane
    finish, a stroke-font neon sign, slow motion at the rack, the pinsetter sweep animation, a scoresheet, and
    synth audio/music.
  - **Physics tuning:** the hook strength is 0.05 in the oil and 1.6 on the dry back end (`hookAt`).
    - A straight ball at x = ±0.125 strikes.
    - A hook of 0.8 from x ≈ 0.3–0.35 hits the pocket.
    - Leaves are realistic (10-pin, 5-pin, 4-7, splits).
  - **CPU:** it samples 24–26 candidates × 2 jitters with `simulateRoll`, taking about 0.6 s in the worker. The
    average first ball is about 9 pins at League and Pro.
  - Tests: scratchpad `nstest*.mjs`. They check the scoring (a perfect game scores 300; the marks) and the
    physics paths.
