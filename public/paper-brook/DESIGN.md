# PAPER BROOK — design document

A folded paper boat drifts down a small forest brook at golden hour. The look is taken from a reference still:
- a low camera just above glittering water;
- grassy banks with round stones on one side and a dry-stone wall on the other;
- tall slender trees with the low sun shining through them, and a cottage in the warm haze;
- heavy depth of field, with blurred bokeh highlights on the foreground water and sun shafts through the canopy.

The player steers the boat down the brook from the hollow to the mill pond. Along the way they collect floating
blossom petals and keep the boat dry enough not to sink.

Built on the arcade's **Space.js** (via `GameSpace.js`), with custom shaders and a post chain of bloom, god rays
and depth of field. There are no external assets: all geometry, textures and audio are generated in code.

---

## 1. Controls
| Key | Action |
|---|---|
| ← / → | turn the boat's bow. The current carries the boat, and the heading decides which way it slides across the stream. |
| W / ↑ | **row**: Pip the rower takes a paddle stroke for a short forward push. Uses stamina (`breath` in code), which refills over time. |
| S / ↓ | **drag**: dip the stern to slow down relative to the current, to line up gaps or wait for a twig. |
| Space | **hop**: flick the water so the boat hops (~0.25 m). Clears twigs and floating leaves. 1.1 s cooldown. |
| C | cycle the camera: the low "reference" view, a higher view, and **Pip cam** (a close three-quarter view of the rower). |
| P / Esc | pause |

On touch screens, buttons at the bottom do the same: ◀ ▶ on the left, ROW / SLOW / HOP on the right.

## 2. The brook (`brook.js`)
- **Shape:** an open Catmull-Rom spline in world xy (z is up), sampled every 0.5 m into frames
  `{p, t, r, hw, wz, c, sec}`:
  - `p` is the centre at water level; `t` is the tangent; `r` is right.
  - `hw` is the half width.
  - `wz` is the water level.
  - `c` is the current speed in m/s.
  - `sec` is the section index.
- **Brook space:** `(s, x)`, where s is distance downstream and x is lateral offset (+ right).
- **Length:** ~480 m, about 3½ minutes.
- **Bends:** curves are gentle (radius ≥ 60 m), so the stream-space terrain grid does not fold.
- **Current profile:** `cur(s, x) = c(s)·(1 − 0.55·(x/hw)²)`, plus eddies behind big rocks (§4).
- **Cascades** are steps in `wz`, each 0.3–0.6 m over 1.2 m. The water surface there is steep and frothy.

### Sections
| Section | s range (m) | Half width | Current | Features |
|---|---|---|---|---|
| **The Hollow** | 0–125 | 1.4 m | 1.5 m/s | The reference shot: round stones on the left bank, grassy banks, easy petals. |
| **Stone Channel** | 125–245 | 1.1 m | 2.1 m/s | Dry-stone walls both sides, the cottage, a wooden footbridge, and a sluice drop at the end. |
| **Fern Rapids** | 245–380 | 1.3 m | 3.0 m/s | Many rocks and white water, drifting twigs, two cascades, ferns and mossy boulders. |
| **Willow Pool** | 380–480 | 1.6 m widening to 4.5 m | 0.9 m/s | Lily pads, a gentle whirlpool, lanterns, fireflies. The mill wheel and dock mark the finish. |

Paper lanterns on both banks mark each section start. These are the **checkpoints** (§4).

## 3. Look
### Scale
These match the reference proportions:
- the brook is 2–3 m wide;
- the banks rise about 0.6 m within a metre of the water, then roll up to 3–6 m hills;
- trees are 9–16 m tall and stand 3–40 m from the water;
- the boat is 0.32 m long;
- the camera sits about 1.2 m behind the boat and 0.4 m above the water.

### Rendering
The world is split into **16 m chunks** along s. Each chunk has its own static segments:
- `O`: opaque base (terrain, rocks, trees, walls, houses);
- `G`: grass, drawn only within 70 m;
- `W`: water;
- `A`: additive foam and glow.

Only chunks from s − 20 to s + 190 are drawn. A far backdrop of tree silhouettes is part of each chunk, out to ~70 m.

### Light
- The sun is low (≈7° elevation) and generally ahead (downstream), so the scene is backlit, as in the reference.
- **Dapple map** (`shade.js`): a CPU-baked 8-bit texture over the whole world at 0.5 m per texel. Each tree canopy
  stamps a long shadow capsule along the sun direction, then low-frequency noise breaks it up. All ground, grass,
  water and rock shading multiply sun light by this map, which gives the golden streaks between shade. The game
  samples the *same* array on the CPU: a boat in a sunbeam dries (§4).

### Materials (`col.a`)
| # | Name | Notes |
|---|---|---|
| 0 | MATTE | |
| 1 | PAPER | Translucent backlight; the wet tint comes from vertex colour. |
| 2 | LEAF | Glossy lily pads and leaves. |
| 3 | BG | Sky. |
| 4 | SPRITE | |
| 5 | EMIT | |
| 6 | BOKEH | Camera-facing disc with a bright rim. |
| 7 | ADD | |
| 8 | WATER | See below. |
| 9 | GROUND | Grass, soil and moss by slope. |
| 10 | ROCK | Darkened and glossy below the waterline (`pos.w` = water z). |
| 11 | FOLIAGE | Canopy and bushes; sway, translucency. |
| 12 | GRASS | Blades; sway weighted by `pos.w` (0 at the root, 1 at the tip); golden translucency. |
| 13 | BARK | |
| 14 | WOOD | |
| 15 | FOAM | Additive procedural froth; `vCol.rg` is the local quad uv, `vCol.b` the strength. |

**WATER** data channels:
- `vCol.r` = s.
- `vCol.g` = `round(hw·10)·16 + current`.
- `vCol.b` = tangent angle.
- `pos.w` = x in metres.

The shader computes:
- ripples advected in brook space;
- a sky reflection, occluded by a tree line whose height depends on how sideways the reflected ray points, with
  canopy breakup;
- sun glitter;
- the pebble bed through the shallow water, with refraction and depth tint;
- white water on steep cascade slopes;
- the dapple map.

### Post (`post.js`)
- Scene alpha carries the **circle of confusion**: surfaces write it; the sky writes 1.0 as a sky flag.
- Bloom uses a luminance threshold, at ¼ and ⅛ resolution.
- **God rays:** a ¼-resolution radial blur of the sky-flag pixels toward the projected sun position. Gaps in the
  canopy become shafts.
- **Depth of field:** a 24-tap golden-angle gather whose radius is the pixel's CoC. Bright samples are weighted
  up, so glints turn into bokeh discs.
- **Focus** is on the boat:
  - near blur starts closer than 0.8 × the focus distance;
  - far blur ramps from 3 m to 70 m, up to 0.4.
- Also a warm grade, vignette and grain.

### Life
- grass and canopy sway;
- dust motes that sparkle only inside sunbeams (sampled from the dapple map);
- dragonflies;
- fireflies at the pool;
- drifting leaves;
- the turning mill wheel;
- smoking chimneys;
- explicit foreground bokeh discs on the sun-glitter path.

## 4. Gameplay (`boat.js`)
### Boat state
`{s, x, vs, vx, h (heading rel. stream), w (yaw rate), z, vz, air, wet, breath, hopCd}`

### Motion
- **Target velocity:**
  - downstream: `vs → cur + drive·cos h`;
  - sideways: `vx → (cur·0.75 + drive)·sin h`.
  - Both relax at 1.6/s, which is water drag.
- **Heading:**
  - steering turns at 2.4 rad/s;
  - the current weathervanes the bow back toward downstream at 0.7/s;
  - the heading is clamped to ±1.2.
- **Puff:** `drive += 1.6 m/s`, decaying at 0.9/s, and costs 0.34 breath. Breath refills at 0.22/s.
- **Drag:** the downstream target drops to 45 %.
- **Hop:** `vz = 1.9 m/s`, gravity 9.8. While airborne the boat ignores twigs and steering.

### Collisions
- **Banks and walls:** at `|x| > hw − 0.13` the boat is pushed back, the sideways velocity reflects × 0.3, and it
  spins a little. A hard scrape adds wetness: `wet += 4·impact`.
- **Rocks** are circles `(s, x, r)` in brook space. The boat is pushed out, reflects, and gets a yaw kick.
  `wet += 7 + 6·closing speed`.
- **Twigs** drift at 70 % of the current and rotate. They are capsules. Unless the boat is airborne, a hit adds
  `wet += 10` and a spin.
- **Cascades:** the boat leaves the water and falls.
  - It lands with a splash.
  - Landing with `|h| > 0.45` is a **bad landing**: `wet += 14`.
  - A clean landing gives +50 points.
- **Whirlpool:** a centre plus a radius. It applies a tangential velocity and a slight inward pull. Puffing gets
  the boat out.

### Wetness (0–100)
- **Dries** at −7/s in sunbeams, where the dapple map value is > 0.55.
- **Wets** at +2.5/s in white water.
- **At 100 the boat sinks.** The run restarts at the last checkpoint lantern with 30 wetness and a −100 score
  penalty.
- **Visuals:** the paper greys and darkens as it soaks; at high wetness the boat sits lower and lists.

### Petals and scoring
Petals are pink, white or gold. They float in loose lines, sometimes behind rocks.
- Collecting a petal scores `10 × combo`.
- Combo:
  - +1 per petal within 2.5 s of the last, up to ×5;
  - resets when a hit adds wetness.
- Golden petals are worth 50 and give back breath.

### Finish
The run ends on reaching the mill dock. The results screen shows:
- time;
- petals collected / total;
- final dryness;
- score, including a time bonus and a dryness bonus;
- 1–3 stars.

The best score is saved in localStorage under `paperbrook.save`.

### Difficulty
| Mode | Current | Wetness gain | Twigs |
|---|---|---|---|
| Gentle | ×0.85 | ×0.6 | fewer |
| Brook | ×1 | ×1 | |
| Torrent | ×1.2 | ×1.25 | more |

## 5. Audio (`audio.js`, all synthesized)
- **Water:** several band-passed noise voices with random wobble; level from the current. Rapids add a hiss layer,
  and a cascade roar rises with proximity.
- **Birds:** chirp phrases at random intervals, and an occasional wood pigeon.
- **Music:** a soft pentatonic kalimba / felt-piano at ~70 bpm over a slow pad.
- **Effects:**
  - petal: a bell, rising with combo;
  - splash;
  - paper thud and crinkle;
  - puff: breath noise;
  - hop: a pluck;
  - sink: bubbles;
  - checkpoint: a chime chord;
  - finish melody.

## 6. Files
| File | Contents |
|---|---|
| `DESIGN.md` | this document |
| `index.html` | page and UI |
| `GameSpace.js` | Space subclass (copied) |
| `mesh.js` | geometry helpers |
| `shaders.js` | scene shaders |
| `post.js` | post chain |
| `brook.js` | spline, sections, rocks, cascades, current |
| `shade.js` | dapple-map bake and sampler |
| `scene.js` | chunked static world |
| `boat.js` | boat physics and autopilot |
| `audio.js` | sound |
| `main.js` | loop, camera, dynamic objects, UI |

## 7. Debug
- `?auto`: the autopilot steers, avoiding rocks and twigs and chasing petals.
- `?s=N` starts at s = N.
- `window.__brook()` returns the current state.

## 8. Progress log
- v1 (2026-10-20): initial build.
  - **Loading:** the world (about 3.0M vertices in 34 chunks) is built in `worker.js` and streamed nearest-first;
    each chunk has its own GL buffers. Shaders compile while the worker builds. Chrome's D3D backend takes
    seconds to link the scene shader, so each material branch only fills in albedo, normal, wrap, sun visibility
    and extra light, and the shared `shade()` / `outc()` run once at the end. That cut linking from ~17 s to
    ~5 s.
  - **Adaptive resolution:** the pixel budget drops when the frame rate stays under 48 fps.
- v1.1 (2026-10-20), after user feedback:
  - **Walls:** tall dry-stone walls (`WALLS` / `wallH` in brook.js, with ramped ends). Each wall is built from
    irregular courses of pillow-faced stones in a six-colour palette, with overhanging capstones, trailing ivy
    and fern tufts in the joints. The ROCK shader adds cracks, lichen and a green algae line at the water.
  - **Look:**
    - the light is less golden: a whiter sun, bluer sky and ambient, and a neutral grade;
    - the water is less reflective (Fresnel × 0.78) and teal-clear;
    - more colour: birch (22 %) and autumn (10 %) trees, patchy grass tips and 7 wildflower colours.
  - **Grass:** a dense fringe right at the water's edge, leaning out over walls. Sway is reduced to a gentle
    stir.
  - **Rocks:** a noise-displaced sphere with three fracture planes and a flattened base.
  - **Pip:** the rower in main.js. Each stroke pulls the paddle back on one side, then recovers. W strokes on
    alternating sides; holding a turn paddles on the outside of the turn; the stroke throws splashes and ripple
    rings. When the boat sinks Pip flails; at the finish Pip waves.
  - **Balance:** checked headless with scratchpad `pbsim.mjs`. The autopilot finishes in ~168–222 s depending
    on difficulty, collects ~75 % of petals and never sinks.
- v1.2 (2026-10-20): Pip redesigned to be rounder and cuter.
  - **Design:** a chibi look with a big round head, pear-shaped coat with buttons, squishy knitted hat with rolled
    brim and pompom, shiny eyes with highlights, rosy cheeks, scarf, mitten hands and boots. Pip uses finely
    tessellated blobs and the new SOFT material (16), which has wrapped light, a warm fill and a rim.
  - **Performance:** parts are built once (`buildPip`) and posed with 3×4 matrices (boat → body → head), about
    1 ms per frame. Rebuilding Pip every frame had cost ~20 ms.
  - **Idle acts:** after 1.2 s of calm, every 2.5–6.5 s Pip does one of: peek down into the water, look around,
    scoot along the boat, stretch with a yawn, trail a mitten in the water (ripples), or turn round and wave.
    Pip also blinks and breathes.
  - **Camera:** C now has a third mode, Pip cam. `?cam=N` preselects a camera mode.
