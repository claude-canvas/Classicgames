# Orbit Breaker — design & hand-off document

> A polar take on breakout. A star core burns at the centre of a circular arena, wrapped in shells of crystal
> bricks. Your paddle is a curved blade of light that orbits the outer ring. Keep the ball inside the ring and
> smash the shells apart: crystals shatter into shards, power-ups drift outward for you to catch, and the core
> flares as each wave falls.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/orbit-breaker/`; do not edit outside it.

## 1. Rules (`game.js`, pure)
- **Arena:**
  - The playfield is the disc r ≤ 10, with the paddle orbit at r = 9.3.
  - The ball (r = 0.18) is lost when it passes r = 10.2 outside the paddle.
- **Paddle:**
  - an arc of angular width 0.42 rad (0.7 when Wide);
  - its angle is set by the pointer's angle around the screen centre, or by ←/→ (A/D);
  - its angular speed is limited, so it can't teleport.
- **Paddle bounce:** the outgoing direction = the inward normal rotated by the hit offset × 55°. Ball speed starts
  at 8 u/s and creeps up by 2 % per brick, to a max of 15.
- **Bricks:** annular sectors `[r0, r1] × [a0, a1]`.
  - **Types:** crystal (1 HP), double (2 HP), triple (3 HP), metal (unbreakable), bomb (explodes neighbours
    within 1.6 u) and prism (always drops a power-up).
  - Some layers **rotate** slowly around the core.
- **Collision:** the ball against each sector, using the polar-clamp closest point (2 arcs + 2 radial edges) and
  4 sub-steps per frame. The reflection is about the contact normal.
- **The core:** a sphere of r = 0.9. Hitting it bounces the ball. In boss waves the core has a shield ring of
  metal bricks with gaps.
- **Power-ups:** they drift outward from the broken brick at 2 u/s and are caught on touching the paddle arc.
  - Multi (+2 balls)
  - Wide (12 s)
  - Laser (8 s, the paddle fires bolts inward with Space or by tapping)
  - Slow (8 s, speed ×0.65)
  - Life (+1)
  - Magnet (catch the ball and release it with a click)
- **Lives:** 3. A wave is cleared when no breakable bricks remain.
- **Waves:** 12 generated patterns (rings, spirals, flower petals, checker shells, rotating gates, boss shields).
- **Score:** brick points × the combo, where the combo counts consecutive bricks without touching the paddle.

## 2. Presentation
- **Bricks:** faceted crystal sectors with Fresnel rims and per-type colours. Cracks show as brightness steps for
  the remaining HP. Metal bricks are dark steel.
- **Shatter:** 6–10 shards per brick, plus sparks and a light flash.
- **Core:** a pulsing plasma sphere with a corona. It brightens as the wave thins, and novae on clear.
- **Ring track:** a neon circle with tick marks. The paddle is a glowing curved bar with a light trail.
- **Background:** a nebula with stars and slow galaxies. The camera is tilted so the arena reads as a 3D orrery,
  and it shakes on bombs.
- **Audio:** pentatonic blips for brick hits (pitch rises with the combo), a crystal shatter, a metal clang, a
  bomb boom, a paddle thunk, power-up chimes, and a pulsing synth bed.

## 3. UI
- **Title:** logo over a slow-rotating demo, with Play and Settings (sound, music, sensitivity).
- **HUD:** score, wave, lives (orbs), active power-up timers, combo.
- **Wave-clear banner.** **Game over card:** score and best (`orbitbreaker.save`).

## 4. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `game.js` · `waves.js` ·
`audio.js` · `main.js`

## 5. Debug
- `?auto`: the paddle tracks the most dangerous ball automatically.
- `?wave=N` starts on wave N.
- `window.__orbit()` returns the current state.

## 6. Progress log
- v1 (2026-10-19): complete and playable.
  - 12 waves. Headless check with scratchpad `obtest.mjs`: the auto paddle clears every wave in 35–106 s.
  - **Anti-loop:** a core bounce adds ±0.25 rad of random deflection. This prevents radial ping-pong orbits that
    never hit a brick, which made early waves unclearable.
  - **Auto paddle:** it meets the ball off-centre with a random offset, re-chosen each second.
  - **Features:** spinning layers drag the ball slightly; bombs chain to neighbours within 1.9 u; there are 6
    power-ups (laser bolts fire with Space or a hold); combo scoring; shatter shards; a title demo running wave 4
    on autopilot.
