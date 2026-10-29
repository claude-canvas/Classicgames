# Neon Velocity — design & hand-off document

> A futuristic anti-gravity racer. Eight hover-ships race three laps around a banked neon skyway that loops
> through a night megacity: over glowing towers, under holo-arches, through tunnels of light. You race seven
> CPU pilots. Drift through the corners to charge a turbo, hit boost pads, and slipstream rivals.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/neon-velocity/`; do not edit outside it.

## 1. Controls (as requested)
| Key | Action |
|---|---|
| ← / → | Steer left / right |
| A / D | Extra drift left / right: a sharper yaw with reduced grip, which charges the drift turbo |
| W | Accelerate |
| S | Brake |
| Space | Fire stored turbo (it also fires automatically when a drift ends with a full charge level) |
| C | Toggle the camera (chase / close) |
| Esc | Pause |

On touch: left/right halves to steer, plus on-screen accelerate, brake and drift buttons.

## 2. Track (`track.js`)
- **Spline:** a closed Catmull-Rom spline through ~16 control points, about 3.1 km long.
  - It has elevation changes (hills, a dive, a raised spiral section).
  - Banking comes from curvature (up to 22°).
- **Frames:** sampled every 2 m into frames `{p, t (tangent), r (right), u (up), k (signed curvature), bank}`.
  Everything (cars, AI, scenery) uses track coordinates `(s, x)`: s = arc length, x = lateral offset (half
  width 11 m).
- **Features:** boost pads (chevron strips, +35 % speed for 1.2 s), a start line, and checkpoints (laps are counted
  by s wrapping).

## 3. Ship physics (`physics.js`, 120 Hz fixed step with render interpolation, so motion is "butter-smooth")
- **State:** in track space, `s`, `x`, heading relative to the track `psi`, and the ship-frame velocity
  `(u` forward, `w` lateral`)`, plus `yawRate`.
- **Throttle (W):** `u += accel · (1 − u/vmax)`. Drag always applies. **Brake (S):** strong deceleration.
- **Steering (← →):** the yaw rate eases toward `steer · yawMax(speed)` with a critically damped response, so
  there is no jitter.
- **Drift (A/D):**
  - adds yaw in that direction and drops lateral grip from 7 to 1.4;
  - the ship's velocity lags behind its nose, so it slides;
  - while drifting at speed, `driftCharge` builds: blue at level 1, orange at 2, pink at 3;
  - releasing the drift fires a mini-turbo of matching strength.
- **Track coupling:** `ds/dt = (u cosψ − w sinψ)/(1 − x·k)`, `dx/dt = u sinψ + w cosψ`, `dψ/dt = yawRate − k·ds/dt`.
- **Walls:** a soft spring wall at |x| > 10. It reflects the lateral velocity at 30 %, scrubs speed and nudges
  ψ toward the tangent, with sparks and a screen shake.
- **Ship-to-ship:** circle collisions in (s, x) with momentum exchange.
- **Slipstream:** a ship within 25 m directly behind another gains +6 % top speed.
- **Hover feel:** a visual bob plus pitch and roll from acceleration and steering. Roll eases toward the bank
  plus the turn.

## 4. CPU pilots (`ai.js`)
- **Line:** each pilot follows a racing line, `x_target(s)` = toward the inside of upcoming curvature, plus a
  personal offset and overtaking: they steer around a slower ship ahead.
- **Speed:** a target speed from the curvature look-ahead (`v ≤ √(aLat/|k|)`).
- **Drifting:** they drift in tight corners (and get turbo).
- **Skill:** a per-pilot top-speed factor of 0.93–1.0 plus mild rubber-banding (±4 %) to keep the pack close.
- **Names and colours:** 7 neon liveries.

## 5. Presentation
- **Skyway:**
  - a dark glass road with glowing lane lines, edge light strips and scrolling chevrons on boost pads;
  - translucent barrier walls with neon rails;
  - support pylons dropping into the city.
- **City:** procedural towers with lit window grids and neon crowns, holo-arches over the track (every ~200 m),
  floating billboard panels, a fog-hazed skyline and a huge ringed planet in a violet-to-teal sky with stars.
- **Ships:** sleek wedge hulls with fins, a canopy, team-colour neon underglow, twin engine flares and light
  ribbons trailing; the turbo turns the flare blue-white.
- **FX:** speed streak particles, wall sparks, the boost FOV kick and screen pulse, and the drift spark colour
  showing the charge level.
- **Camera:**
  - chase camera: spring-smoothed position, look-ahead along the track, roll with bank plus steering;
  - FOV widens with speed.

## 6. UI
- **Title:** logo over a flyby of the CPU race, with Race (3 laps, 8 ships), Difficulty (Rookie/Pro/Elite) and
  Settings.
- **HUD:** position x/8, lap x/3, lap timer and best, a speed gauge (km/h), the drift and turbo meter, a minimap
  with all ships, a countdown 3-2-1-GO, and a "wrong way" warning.
- **Results:** the finish order with times. The best race time is saved in `neonvelocity.save`.

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` (with camera roll) `mesh.js` `post.js` · `shaders.js` · `track.js` ·
`physics.js` · `ai.js` · `scene.js` · `audio.js` · `main.js`

## 8. Debug
- `?auto`: the player's ship is AI-driven.
- `window.__race()` returns the current state.

## 9. Progress log
- v1 (2026-10-19): complete and playable.
  - **Track:** 4.4 km, minimum radius 56 m.
  - **CPU race:** checked headless with scratchpad `nvtest.mjs`. All 8 CPU ships finish 3 laps at about 310 km/h
    average (~50 s laps).
  - **Lap counting:** ships start behind the line, so the first crossing sets lap 1, and lap > 3 means finished.
  - **Steering feel:** smoothed digital steer (6/s), road feed-forward (0.8·k·v) and a psi-centring assist, with a
    critically damped yaw. The physics is fixed at 120 Hz with render interpolation, and the camera is smoothed in
    track space.
  - **Turbo:** drift charge levels 1–3 fire a turbo on release; one stored turbo is gained per lap (Space).
  - **Performance:** 300 towers. 60 fps at 1280×720 headless (it was 20 with 520 towers, fill-bound).
  - Verified the keyboard controls with simulated key events (W accelerates, → + D drifts right).
