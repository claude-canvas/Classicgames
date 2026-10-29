# Canyon Glide — design & hand-off document

> Fly a paper glider down an endless red-rock canyon at sunset. Dive to gain speed and pull up to trade it for
> height. Ride warm thermals rising off sunlit walls, thread glowing rings and stone arches, and skim the river for
> a speed bonus. Don't touch the rock.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/canyon-glide/`; do not edit outside it.

## 1. Flight model (`flight.js`, pure)
- **Energy glider:**
  - Speed changes with pitch: `dv/dt = −g·sin(pitch) − drag·v²`.
  - Lift keeps the glider aloft above a stall speed of about 9 m/s. Below that it sinks and the nose drops.
  - It turns by banking: `yawRate = g·tan(bank)/v`.
- **Controls:**
  - Mouse or touch drag, as a virtual stick: x sets the target bank, y sets the target pitch. Or WASD/arrows.
  - Space (hold) is **airbrake**, for slowing in tight turns.
  - Tap or Shift for a **flap boost**, which uses a charge. Charges come from rings.
- **Thermals:** columns of rising air (radius 12–25 m, lift 3–7 m/s) sit above sunlit ledges. Gentle shimmering
  motes show them.
- **Collision:** the glider is a sphere of r = 0.8 m tested against the canyon heightfield (SDF-like sampling of
  the walls and floor) and against the arch/rock-spire capsules. A hit ends the run with a paper-crumple burst.
- **The river:** flying below 3 m above the water gives 1.5× score and spray. Touching the water is a crash.

## 2. The canyon (`canyon.js`)
- **Path:** a smooth curve along +y with lateral meanders (sum of sines). The width varies 40–120 m and narrows
  in "slots".
- **Terrain:**
  - Generated in chunks of 120 m.
  - Each chunk is a grid across the canyon: the floor plus two walls rising to mesa tops.
  - Wall heights are 60–140 m.
  - Strata bands appear in the shader.
  - Wall profiles are irregular (terraced ledges, overhangs approximated by steep steps).
- **Features scattered per chunk:**
  - stone **arches** spanning the canyon (fly under or through);
  - free-standing **spires** (hoodoos);
  - **rings** in lines and curves (5 points each, chain bonus);
  - **thermals**;
  - **wind gates**: big ring pairs that give a speed boost;
  - birds circling.
- **Ring buffer:** the 5 nearest chunks are kept. Chunk meshes are rebuilt into the static buffer when a new chunk
  enters.

## 3. Scoring
- distance (1 point per 10 m) × multiplier;
- rings +5, with a chain bonus for consecutive rings without missing one;
- through-arch +25;
- low river skim ×1.5;
- near-miss (within 2.5 m of the rock) +10 with a "whoosh".
- Best distance and score are saved in `canyonglide.save`.
- **Biomes** cycle every 1500 m: Sunset Red → Violet Dusk → Moonlit Blue → Dawn Gold. Lighting and fog colours
  shift with them.

## 4. Presentation
- **Glider:** a folded paper plane: crisp white triangles with fold lines. A vapour trail streams from the wing
  tips at high speed.
- **Sky:** a sunset gradient with a low sun, god-rays (screen-space approximated by additive sprites along the
  sun direction) and drifting cirrus.
- **Canyon:** layered red sandstone with stripes, shadowed walls, warm bounce light, and the river glinting with
  the sun.
- **Atmosphere:** dust motes and distance haze.
- **Camera:** a chase camera behind and above, with banking roll and an FOV kick at speed. Optional cockpit view
  (C).

## 5. UI
- **Title:** logo over a slow flythrough, with Play and Settings.
- **HUD:** distance, score, multiplier, speed bar, boost charges, a ring chain counter, and the biome name toast.
- **Crash card:** distance, score and best, with Retry.

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `flight.js` ·
`canyon.js` · `audio.js` · `main.js`

## 7. Debug
- `?auto`: the autopilot flies down the canyon centreline, threading rings.
- `?god` disables crashes.
- `window.__glide()` returns the current state.

## 8. Progress log
- v1 (2026-10-19): complete and playable.
  - **Streaming:** canyon chunks (120 m) stream into the static buffer, 7 alive at a time.
  - **Features:** rings in sets of 5 (a full set gives +1 flap), arches with a through bonus, hoodoos, thermals
    with rising motes, wind gates, river skim ×1.5, near misses, 4 cycling biomes, camera bank roll
    (`GameSpace.roll`), and the paper-crumple crash.
  - **Tuning:** drag 0.0017 and stall 9 m/s; thermals lift 4.5–8.5 m/s. The autopilot (`?auto`) flies more than
    900 m collecting rings.
  - **Controls:** desktop uses the mouse position relative to screen centre as the stick (dead zone 8 %), click
    or Shift to flap, and Space or right-click for the brake. Touch uses a drag stick from the press point; a
    quick tap flaps.
