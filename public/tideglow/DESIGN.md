# Tideglow — design & hand-off document

> A bioluminescent jellyfish's long rise from a hydrothermal vent at the bottom of an ocean trench to the
> golden evening light at the surface. 3D, built on the arcade's own `Space.js` (Projection 3D) library —
> no Three.js, no build step, no downloads.

This file is the single source of truth for the game. If you are an AI (or human) picking this up, read it
top to bottom, then read the files in the order listed in **File map**. Everything the game needs lives in
this folder (`public/tideglow/`); the only outside file used is the shared `../Space.js`, which is imported,
never modified.

**Rule for this folder: do not edit any file outside `public/tideglow/`.** (The arcade home page,
sitemap, thumbnails etc. are intentionally *not* touched. Registering the game on the home page is a
separate, later task for the repo owner.)

---

## 1. The pitch

You are a small moon jelly, glowing in the dark. The only light in the abyss is yours — and it is slowly
fading. Pulse your bell to swim upward through a winding undersea canyon, eat drifting plankton to keep
your glow alive, bloom the coral halos you pass through, and slip past the anglerfish that hunt by
pretending to be food. The water brightens as you rise: black → indigo → teal → turquoise, until you
break the surface into a sunset.

Why it's unique in this arcade: no other game here is underwater, none is a vertical ascent, and the core
visual idea — *your own creature is the main light source* in a dark 3D world, and the world lights up
around you as you climb — is not used anywhere else.

## 2. Core loop

1. **Pulse** to swim in the direction your bell faces. Each pulse is an impulse; between pulses you slowly
   sink and drift (water drag). Rhythm matters.
2. **Light** is your life. It drains constantly (faster in the deep). Plankton motes refill it. Hazards
   steal it. At 0 the light goes out and the dive ends.
3. **Halos** (glowing coral rings, 16 per dive) are gates you swim *up through*. Each bloom gives light
   and score; blooming halos back-to-back builds a combo.
4. **Zones**: crossing into a new zone is a checkpoint (light topped up to ≥ 60). If your light goes
   out you may *resume from the last checkpoint* (score halved) or start a new dive.
5. **Surface**: reach depth 0 m → breach into the sunset, results card with stars.

### Controls

| Input | Action |
|---|---|
| Mouse / touch: **hold** anywhere | jelly turns toward the pointer and pulses rhythmically |
| Mouse / touch: **tap** | one pulse toward the pointer |
| Keyboard: ←/→ or A/D | tilt the bell |
| Keyboard: Space / ↑ / W | pulse (hold to keep pulsing) |
| P / Esc | pause · M mute |

### Numbers (tunable, in `main.js` → `TUNE`)

- Pulse impulse 3.9 u/s, cooldown 0.5 s, drag `exp(-1.45·dt)`, sink 0.6 u/s². A perfect bot surfaces in
  ~2–2.5 min; a human takes ~3 min.
- Light: 100 max; drain 1.85/s at the sea floor scaling down to 1.25/s at the surface; plankton +1.6;
  halo +10; angler bite −30; puffer sting −18; invulnerable 1.5 s after a hit. Zone checkpoint tops up to 60.
- Score: plankton 10 · halo 100 × combo (combo resets when a halo is missed) · surfacing bonus
  1000 + 10 × light left.
- Stars: ★ surface · ★★ bloom ≥ 11 of 16 halos · ★★★ bloom all 16.

## 3. The world

World units ≈ metres. **Z is up** (Space.js convention), X is left/right, Y goes *into* the screen.
Gameplay happens on the plane **y = 0**; scenery lives at y > 0 (behind) and the canyon walls wrap around
from the sides to the back. The camera sits at y ≈ −24 looking +Y, following the jelly.

The trench runs from **z = −480 (sea floor) to z = 0 (surface)**; cliffs continue above water to z ≈ +7.

| Zone | Depth (m) | Look | Content |
|---|---|---|---|
| The Abyss | 480–360 | near-black violet, basalt | hydrothermal vents (orange emissive cracks, rising embers), tube worms with red plumes, **anglerfish** |
| The Midnight Zone | 360–240 | deep indigo | siphonophore chains (glowing bead strings) drifting behind, marine snow, **anglerfish**, **currents** |
| The Twilight Zone | 240–120 | teal-blue, first god rays | glowing sea fans, **currents**, **pufferfish**, fish schools |
| The Sunlit Reef | 120–0 | turquoise, caustics on rock | colourful coral, swaying kelp, fish schools, **pufferfish**, god rays, Snell's window |
| Surface | 0 | sunset sky + sea | breach, victory |

The canyon is generated per dive from a seed (`world.js`):
- `centerX(z)`, `halfWidth(z)` — smooth sine sums; widens into a vent cavern at the bottom and an open reef
  near the top.
- Wall cross-section is a U: angle θ from −0.5 (right, toward camera) through π/2 (back, y ≈ 9) to π+0.5
  (left). Radial displacement `disp(θ, z)` = value-noise fbm. The θ grid contains exactly 0 and π so the
  y = 0 wall line used for **collision** (`wallRight(z)`, `wallLeft(z)`) matches the mesh.
- A **route** (smooth random offset inside the walls) places halos, plankton clusters and hazards so the
  dive is always passable.

### Hazards
- **Anglerfish** (abyss, midnight): lurk at a wall with a glowing lure dangling into the canyon — the lure
  looks like plankton. If you come within ~5 m of its mouth it telegraphs (eyes flare, 0.55 s) then
  lunges. The bite steals light and knocks you back. Your own glow lights up its body as you approach.
- **Pufferfish** (twilight, reef): patrol side to side; inflate into a spiky ball when you're near.
- **Currents** (midnight, twilight): horizontal bands that push you sideways; shown by streaking particles.
- **Walls**: bounce, no damage.

### Obstacles (v2 — added to make the climb challenging)
Placed in `World.place()` (world.js), drawn in creatures.js, collision/behaviour in `obstacles()` (main.js).
Placement keeps every obstacle clear of halos, anglerfish and currents and of each other (the `taken` z-bands +
`free()` with a pad), so they never stack into an unfair combo. Typical dive: 6–8 curtains, 2–6 outcrops,
1–6 morays, 6–8 barracuda runs. Each type shows a one-time hint (`ui.tip`) the first time it comes near.

| Obstacle | Zones | Behaviour | Damage |
|---|---|---|---|
| **Stinger curtain** | Abyss top → Twilight | glowing siphonophore tentacles hang 4–6.5 m below a stem spanning the canyon; a 5.2–6.5 m gap slides between the walls (`curtainGap`), its edges marked by bright beads | −15 |
| **Urchin outcrop** | Abyss, Twilight, Reef | a rock ledge juts 2–5.5 m from one wall (solid: bounces the jelly), 3–5 spiny urchins on its face sting | −14 |
| **Moray eel** | all zones | hides in a wall hole; when you come within reach its eyes flare yellow + hiss (0.55 s), then it strikes up to 4.6 m across the canyon, holds, retracts; 2.6 s reset | −22 |
| **Barracuda run** | Twilight, Reef | every 4.2–6.4 s a silver shimmer line with chevrons (1.4 s, rising whoosh) warns, then 3–5 barracuda cross the lane at 24 m/s | −20 |

Anglerfish now also lurk in the upper Twilight Zone, notice you from 6.4 m, and puffers inflate from 5.2 m.

## 4. Rendering

All through `GameSpace` (extends `../Space.js`, same pattern as `ripple/` and `skyputt/`): Space provides
the camera basis (`lookAt` → `updateMyVectors` → `xUnitVec/yUnitVec/zUnitVec`) and the attribute
locations; we replace its shader with ours (`shaders.js`).

**Vertex format** (Space's): `pos = vec4(x, y, z, w)`, `col = vec4(r, g, b, material)`.
`w` is free per-material data.

| mat | name | pass | notes |
|---|---|---|---|
| 0 | ROCK / SOLID | opaque | flat-shaded (dFdx/dFdy normals), sun from above fading with depth, caustics in shallow water, up to 8 coloured point lights (the jelly is light 0), depth fog |
| 1 | EMISSIVE | opaque | glowing coral tips, lures, vent cracks, eyes |
| 2 | BACKGROUND | first | full-screen: water gradient + Snell's window + background rays underwater; sunset sky when the camera is above water |
| 3 | SPRITE | additive | soft glow quads, `w = size + corner·100` (corner 0..3) |
| 4 | JELLY | additive | fresnel-rim translucent bell, `w = latitude` (0 top → 1 rim) |
| 5 | SHAFT | additive | god rays, `w = u·2 + v` |
| 6 | KELP | opaque | like ROCK but the vertex shader sways it, `w = sway weight` |
| 7 | SURFACE | opaque | the sea surface (seen from below: bright mirror/Snell's window; from above: sunset reflection) |
| 8 | ADD | additive | plain additive geometry (tentacles, current streaks), fogged |

**Draw order per frame:** background → static opaque → dynamic opaque → static additive → dynamic additive
(blend ONE,ONE, depth test on, depth write off).

**Bloom mask:** the scene shader writes **alpha = "this pixel emits light"** — 0 for lit solids, ~0.55 for
EMIT, luminance-scaled for additive materials (they accumulate it through ONE,ONE blending), and only the
very brightest sky/sun pixels for BG/SURFACE. The bright-pass multiplies colour by that alpha, so brightly
lit reef rock never blooms while the jelly, lures, halos and vents always do. (A plain luminance threshold
was tried first and washed the whole reef out — don't go back to it.)

**Lighting balance:** the jelly's point-light strength is `(0.8 + 4.2·light) · (1 − 0.8·sun)` and its
additive brightness is scaled by `1 − 0.55·sun`, where `sun = exp(z/110)`: it dominates the abyss and is
a subtle accent on the bright reef.

**Post-processing (`post.js`):** scene → offscreen RGBA target (+ depth renderbuffer) → bright-pass →
two blur levels (¼ and ⅛ resolution, separable 9-tap Gaussian) → composite (bloom, gentle underwater
wobble, vignette, grain, fade). If framebuffers are unavailable it falls back to drawing straight to the
screen (the scene shader already tonemaps).

**Buffers:** static scene (walls, floor, vents, coral, kelp, god rays) is built once per dive into Space's
buffers; everything that moves (jelly, tentacles, plankton, halos, creatures, particles) is rebuilt every
frame into GameSpace's dynamic buffers, culled to a z-window around the camera.

## 5. Audio (`audio.js`, Web Audio only)

Deep ambient pad whose filter opens as you rise; distant whale calls; soft pulse "whoosh"; plankton chimes
on a pentatonic scale that climb with a pickup streak; halo bloom chord; anglerfish growl on telegraph;
sting/bite thud; breach splash + bright final chord. Mute persists in `localStorage["tideglow.muted"]`.

## 6. UI (`index.html`)

Title screen (logo, tagline, "Begin the ascent", best score), HUD (light ring, depth gauge with zone
bands + marker, score, halos x/16, combo), zone banners, pause overlay, results card (surfaced / light
went out, stars, score, best, Resume-from-checkpoint / New dive). Home link to `/`. Save data:
`localStorage["tideglow.save"] = { best, bestStars, dives }`.

## 7. File map

| File | Responsibility |
|---|---|
| `DESIGN.md` | this document |
| `index.html` | page, styles, HUD/overlay markup, loads `main.js` as a module |
| `GameSpace.js` | Space subclass: static + dynamic buffers, `lookAt`, `applyCamera`, `bind`, `draw` |
| `mesh.js` | `Mesh` vertex writer + geometry helpers (tube, sphere, ribbons, sprites) |
| `shaders.js` | scene vertex/fragment shaders, `createProgram` |
| `post.js` | bloom/composite pipeline with fallback |
| `world.js` | seeded canyon generation, route, placements, static mesh build, collision helpers |
| `jelly.js` | the jellyfish: physics, tentacle chains, mesh |
| `creatures.js` | anglerfish, pufferfish, fish schools, siphonophores: update + mesh |
| `audio.js` | Web Audio ambience and SFX |
| `main.js` | game state machine, input, update, render loop, HUD |

## 8. Debug / test URL parameters

- `?autoplay` — a simple bot swims the route (for demos and headless screenshots).
- `?z=-200` — start at that height (skip ahead to a zone).
- `?seed=123` — fixed canyon.
- `?title` — with `autoplay`, stay on the title screen.
- `?speed=6` — run 6 simulation steps per frame (fast-forward a whole dive).
- `?drain=20` — multiply light drain (test the death / resume flow).
- `?vh=3.5` — zoom: visible half-height at the play plane (default 12.5).
- `?nopost` — disable the bloom/composite pass.

`window.__tideglow()` returns a state snapshot (`t, state, z, x, light, score, bloomed, eaten, zone, post,
verts, fps`) for automated checks.

**How it was verified:** headless Chrome driven over the DevTools protocol (Node 22's built-in WebSocket),
screenshots per zone, full fast-forwarded autoplay dives on several seeds, and scripted mouse/keyboard input
(Begin → hold-to-swim → P pause/resume → keyboard). Use the real GPU for headless runs
(`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` on Windows): SwiftShader runs at ~1 fps, which
also leaves the fade-in unfinished and makes screenshots look far too dark. Measured: 60 fps at 1280×720
on Intel Iris Xe integrated graphics; ~185k static vertices.

## 9. Status / where to continue

See the **Progress log** below — append to it when you change something.

### Progress log
- v1: design written; full game implemented (all zones, hazards, halos, checkpoints, surface ending,
  bloom post, audio, HUD).
- v1.1 visual pass: added rock *flanks* either side of the U (without them the canyon read as a pillar in
  open water), bloom mask via alpha, jelly light scaled by depth, softer reef encrustation, lichen only below
  215 m (dim emissive renders as black dots), denser reef coral, finer sea-surface waves.
- v1.2 pacing: slower pulse (dive ≈ 2–3 min instead of 50 s), smaller light rewards.
- v2 challenge: four new obstacles (stinger curtains, urchin outcrops, moray eels, barracuda runs), anglers in
  the twilight, faster drain, first-sight hints, labelled damage toasts. The autoplay bot (which knows every
  timing) surfaces on ~4 of 5 seeds with noticeable light loss and dies on the rest — tune `TUNE` /
  placement spacing if it gets too hard.

### Known rough edges
- Some reef coral (table coral, tube sponges) can look like floating blocks where a ledge is steep.
- The result card covers the jelly in the surfaced shot; the camera could frame it lower.
- No home-page tile / thumbnail / SEO block yet (outside this folder — see below).

### Ideas for later
- Daily seed + share code. Photo mode. Second playable creature (comb jelly with rainbow cilia).
- Arcade integration (home-page tile, thumbnail, SEO block) — requires editing files outside this folder,
  so ask the repo owner first.
