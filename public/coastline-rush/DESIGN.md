# Coastline Rush — design & hand-off document

> Sports-car racing on a winding cliff-top highway around a tropical island at sunset. Eight cars race three
> laps. The road climbs over headlands, dives to the beach, sweeps past a lighthouse, palm groves and a harbour
> village. The ocean glitters gold below.
>
> Throw the car into hairpins with the handbrake, hold the slide for a nitro charge, and fight seven CPU drivers
> for the win.
>
> Built on the arcade's own `Space.js`. Everything lives in `public/coastline-rush/`. The architecture is shared
> with `neon-velocity`: a track spline, track-space physics at 120 Hz with interpolation, and a track-space camera.

## 1. Controls
| Key | Action |
|---|---|
| ← / → | Steer |
| A / D | Handbrake drift left / right (the rear steps out; holding charges nitro) |
| W | Throttle |
| S | Brake / reverse |
| Space | Fire nitro (charges come from drifting and from each lap) |
| C | Camera (chase / bumper) |
| Esc | Pause |

## 2. Track (`track.js`)
- **Shape:** a closed Catmull-Rom loop around an island, about 3.6 km. Elevation runs 4–42 m, with crests that
  unload the car, a beach straight and a hairpin section. Banking is mild (≤ 8°).
- **Width:** half-width 7.5 m.
- **Curbs:** red/white curbs are painted where |curvature| is high.

## 3. Car physics (`physics.js`)
- **Base model:** the neon-velocity track-space model, retuned for cars:
  - VMAX 74 m/s (266 km/h), nitro 92 m/s;
  - stronger drag, so it feels like a heavier car;
  - acceleration falls off with speed, with automatic "gears": the engine pitch saws at each shift;
  - grip 8 when gripping and 1.6 while the handbrake drifts;
  - the drift keeps more momentum and charges nitro (3 levels);
  - nitro is fired with Space, or automatically as a mini-turbo when the drift ends.
- **Crests:** on a crest the car goes light, so grip drops briefly and it hops.
- **Off the tarmac:** the grass/sand shoulder beyond |x| > 7.5 slows the car and throws dust; the guard rail sits
  at 9.5.
- **Contact:** car-to-car contact in track space.

## 4. CPU drivers (`ai.js`)
- Racing line plus overtaking, from neon-velocity.
- Corner speed is set by a car-like lateral limit (≈ 30 m/s²); they handbrake into hairpins.
- Skill per driver, light rubber-banding, and 3 difficulties.

## 5. Presentation
- **World:**
  - island terrain: grassy hills inland, rocky cliffs and beaches at the shore;
  - the ocean: an animated normal-mapped surface with sun glitter, foam lines at the shore and a sunset
    reflection;
  - palms that sway, guard rails, warm road lamps that turn on, a lighthouse with a sweeping beam, harbour houses
    with lit windows, sailboats.
- **Sky:** a low sun on the horizon, a gradient from orange through pink to violet, and clouds lit from below.
- **Cars:** glossy sports-car bodies (6 liveries, metallic flakes and env reflection), dark glass, spinning wheels
  with rims, glowing head- and tail-lights, brake lights that flare on braking, and nitro flames.
- **FX:** tyre smoke while drifting, dust off the road, sparks on rail scrapes, a nitro screen pulse and speed
  streaks.
- **Camera:** a low chase cam smoothed in track space, rolling slightly into the turns, with an FOV kick on
  nitro.

## 6. UI
Title, difficulty, HUD (position, lap, time, standings, minimap, speedometer with gear, nitro meter), countdown,
results board, best time saved in `coastlinerush.save`.

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` · `shaders.js` · `track.js` · `physics.js` ·
`ai.js` · `scene.js` · `audio.js` · `main.js`

## 8. Debug
- `?auto`: the player's car is AI-driven.
- `?race` skips the title.
- `window.__race()` returns the current state.

## 9. Progress log
- v1 (2026-10-19): complete and playable.
  - **Track:** 3.65 km, minimum radius 38 m.
  - **CPU race:** checked headless with scratchpad `crtest.mjs`. All 8 CPU cars finish 3 laps at about 190 km/h
    average (~68 s laps), with few bumps.
  - **Bugs fixed while tuning:**
    - The AI's racing line sign was reversed: it aimed for the outside of corners and pinned itself to the rail.
      It now uses `+kAhead·900`.
    - The crest test was inverted (it lightened the car in dips).
    - Road feed-forward was raised to 0.95.
  - **Terrain:** shaped around the road. The island side is hills via a loop point-in-polygon test; the sea side
    falls to −14 m.
  - **Scenery:** an ocean grid carrying depth for shore foam, lamps, palms, a lighthouse with a sweeping beam, a
    harbour village and sailboats.
  - Verified the keyboard controls with simulated key events. 60 fps at 1280×720 headless.
