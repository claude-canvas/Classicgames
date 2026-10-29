# FOREST RALLY — design document

Drive a little toy rally car around a forest kart track. The track is a third-party model
(`assets/forest_r02.glb`, from `kartrider-forest-r02.zip`), loaded and rendered with the arcade's **Space.js** (via
`GameSpace.js`) plus textured shaders and the post chain.

This is a free drive. There are no laps, timing or opponents yet.

## 1. Controls
| Input | Action |
|---|---|
| W / ↑ | accelerate |
| S / ↓ | brake, then reverse |
| A D / ← → | steer |
| Space | handbrake (slides the rear) |
| C | driver's view / chase view (remembered) |
| R | back to the start line |
| H | hide or show the help panel |

Touch: ◀ ▶ steering on the left, GO and BRAKE on the right, CAM at the top right.

The camera is a fixed chase camera. On purpose, it has no zoom and no automatic pull-in.

## 2. The model (`gltex.js`)
The file is glTF 2.0 binary.
- **Size:** 1,043 primitives, about 23.5k triangles, 64 materials, 64 embedded PNG textures.
- **Units:** the root node is scaled ×0.001, so the track is roughly 385 × 385 m.
- **Required extension:** `KHR_texture_transform`. The loader applies it to the UVs at load time.

**Loader:**
- Flattens the scene graph into world-space triangles grouped by material, converting Y-up to Z-up:
  (x, y, z) → (x, −z, y).
- Per vertex it keeps the normal, the UV, and the colour (base colour factor × `COLOR_0`, the model's baked
  shading).
- Textures are redrawn onto power-of-two canvases, so WebGL 1 can mipmap and repeat them; anisotropic filtering is
  used when available.

**Material classes** (by name and alpha mode, in `main.js`):
| Class | Materials | Treatment |
|---|---|---|
| sky | `skydome_F` | unlit |
| solid | opaque materials | lit |
| cut-out | BLEND/MASK foliage, fences, grass, flowers | alpha-tested at 0.42 |
| water | `F_water`, `F_sea`, `F_waterfall` | scrolling UVs, sky reflection and glint |
| blend | `shadow00/01`, `F_light`, `waterdrop` | drawn last with alpha blending, no depth writes |

## 3. Rendering (`shaders.js`)
- **Program:** one program with Space.js's `pos` / `col` attributes, plus `nrm` and `uv` (extra attribute slots
  managed by `GameSpace.js`).
- **Map shading:** texture × vertex colour × (hemisphere ambient + sun), with light distance fog.
- **The car:** GPU-skinned through the bone uniforms: bone 0 is the body, bones 1–4 the wheels. It has soft
  shading with a warm rim and a contact shadow drawn with multiply blending.
- **Post:** `post.js` adds bloom and a gentle depth of field.

## 4. Collision
Both maps come from the model's own triangles via `buildCollision`:
- **`col`:** all solid surfaces plus fences. Used for walls.
  - Its steep triangles (fences, cliffs, trunks, rocks, cabins, signs) are sampled into 0.25 m cells.
  - Each cell keeps **separate height intervals**, taken from the part of each triangle inside it. A kerb at road
    level and a bridge or rock overhang above it stay two thin bands instead of one solid wall from road to roof.
  - The driving surfaces themselves (`F_road*`, `roadstart`, `bridge_set`, `tilegrass`) are never walls. Their
    steep bits are only seams, deck edges and undersides, and the wheels-on-the-road rule already bounds them.
- **`road`:** only the drivable surfaces (`F_road*`, `F_roadstart01`, `bridge_set`, `tunnel`). Up-facing triangles
  only (a tunnel ceiling or the bridge's underside is not a floor), bucketed in 1 m cells and queried by exact
  barycentric height.

## 5. The car (`car.js`)
- **Model:** a toy rally car, authored at 1 m and scaled to 0.75 m (`SC`).
  - Rounded red body, glass cabin, white stripes, bumpers, head and tail lights, spoiler and aerial.
  - A little yellow driver's helmet.
  - Four wheels with tyres and spoked rims.
  - Its small size keeps the wide road roomy and the tree canopy far overhead.
- **Driving** (arcade bicycle model):
  - Top speed 13 m/s; reverse −4.5 m/s.
  - Acceleration falls off toward top speed; braking is 16 m/s².
  - Steering is rate-limited: the lock is min(0.55, atan(2.1 · wheelbase / |v|)), so the car never turns faster
    than 2.1 rad/s (it used to reach about 7.5), and the wheel turns in gradually. yaw = v · tan(steer) / wheelbase.
  - The handbrake adds yaw and rear slip.
  - The speedometer shows 2× real km/h, for a toy-scale feel.
- **Staying on the road** (`fitsPose`): every step, all four wheel contact points (spread ×1.05) must be over a
  road triangle within 0.45 m of the car's height and clear of walls, and a 3 × 4 grid over the body must be clear
  too. If a move fails, the car tries, in order:
  1. **Slide:** the same move turned 0.2 to 1.45 rad either side, nearest first, shortened by the cosine. Speed
     bleeds off with the deflection, and the heading turns toward the free direction. This works along a fence
     at any angle.
  2. **Pivot:** with the pedal down, it pivots toward the side that frees the way (2 rad/s).
  3. **Turn while moving:** the move along a turned direction with the car turned to match. This gets it out of a
     pocket on the outside of a bend.
  4. **Stop:** only when truly head-on, with a small bounce.
  - Physics runs in sub-steps of at most 0.12 m, so it never tunnels through a gap.
- **Sitting on the road:** the height is the average of the four wheel heights; pitch and roll come from their
  differences. Front wheels steer and all wheels spin with speed.
- **Spawn:** on the road at the start line, facing the longest *drivable* run. Drivable means road surface and
  clear of fence or wall bands. The road texture has grass margins, so the road mesh runs past the fences.
- **Collision response:**
  - Head-on, the car stops with a tiny bounce, with no sign-flipping jitter.
  - Sliding along an edge turns it toward the free direction, but only while driving forward.
  - A car already in an invalid spot is allowed to move out.
  - Held against something with the pedal down for 3 s, it returns to a good spot at least 3 m back along its
    trail, so holding the pedal doesn't drive it straight back in.

## 6. Camera
- **Chase** (default): a fixed 2.5 m behind and 0.95 m above the car, looking 1.4 m ahead of it. The yaw trails the
  car's heading smoothly, and the camera is kept above the ground under it.
- **Driver's view** (C): the eye sits just in front of the helmet and follows the car's heading and pitch directly,
  looking 6 m ahead, so the bonnet shows at the bottom of the screen. The helmet and aerial are built as one vertex
  range at the end of the body and skipped in this view. Depth of field is off.
- Neither view zooms.

## 7. Files
| File | Contents |
|---|---|
| `index.html` | page and HUD (speedometer) |
| `GameSpace.js` | Space subclass with normal + UV attributes |
| `mesh.js` | geometry helpers |
| `post.js` | post chain |
| `shaders.js` | scene shaders |
| `gltex.js` | textured GLB loader |
| `car.js` | car model, physics, matrices |
| `main.js` | game loop, collision, camera, sound |
| `assets/forest_r02.glb` | the track model |

## 8. Debug
- `?auto` drives the car along the longest clear run of road.
- `window.__rally()` returns the state, including whether the car is on the road, the view and the render size.
- `?prof` adds `window.__prof()`: smoothed ms for physics, render submission and the whole frame interval.

## 9. Notes
- **Third-party assets:** the track is a game asset with third-party branding (KartRider and the "Pleasant Goat
  and Big Big Wolf" signage). It is meant for local use. It is not listed on the arcade home page.
- **v1 (2026-10-24):** walking racer.
- **v2 (2026-10-25):** replaced by the toy car with road-only driving and a fixed chase camera.
- **v2.4 (2026-10-26):** proper road boundaries; no more blocks in the middle of the road. Causes found with the
  `__topo` map and `__scan`:
  - **Merged height bands:** one [min, max] band per cell merged kerbs with overhangs into a solid wall. Each cell
    now keeps separate intervals.
  - **Road meshes as walls:** the road, bridge and grass meshes' own steep faces counted as walls. They no longer do.
  - **Ceilings as road:** downward-facing triangles counted as road, so the tunnel ceiling (1 m up) made wheels
    "jump" and fail. Only up-facing triangles count now.
  - **Coarse cells:** 0.5 m wall cells turned diagonal fences into steps poking into the road. Cells are now 0.25 m.
  - **Axis-only sliding:** sliding along x or y alone stopped dead on diagonal fences. Replaced by the
    slide → pivot → turn-while-moving search.
  - **Reset loop:** the jam reset reused a spot just before the jam. It now goes at least 3 m back.
  - **Result:** holding only W, with no steering, the car follows the fences from the start line through the
    junctions, the plaza, the tunnel and the top section, and stays on the road.
  - **Debug:** `__topo(cx, cy, mpp, size, zTop)` (top-down map of road and blockers), `__scan()`, `__cell(x, y)`,
    `__fit(x, y, h)`.
- **v2.3 (2026-10-25):** lag, steering and the driver's view.
  - **Lag:** measured at 1920×1080, the CPU work was under 1 ms a frame but the frame rate was 34 fps, so it is
    GPU fill rate. Fixes:
    - no MSAA on the canvas (the scene renders into a non-MSAA framebuffer anyway);
    - the god-ray passes are skipped while `sunK` is 0;
    - depth of field uses 12 taps and is lighter;
    - **adaptive resolution** (`adaptRes`): when 2 s average more than 19 ms per frame, the pixel cap drops ×0.75
      (down to 0.9 million pixels). It climbs back ×1.15 after 8 s of steady frames, but never to a size that
      was too slow.
    - **Result:** 55–60 fps at 1080p in the same test.
  - **Steering:** rate-limited to 2.1 rad/s with a gentler turn-in; the autopilot now slows down for bends.
  - **Driver's view** (C / CAM).
  - **Car wall band:** now 0.35–0.5 m above the road (it was 0.8). The stone bridge's underside, 0.57 m up, had
    been blocking the road beneath it.
  - **Debug:** `?prof`, `__prof` and `__car`.
- **v2.2 (2026-10-25):** verified in headless Chrome.
  - **Toy-car obstacle band:** the car is blocked only by steep surfaces 0.35–0.8 m above the road (0.5 m since v2.3), so overhead
    banners and low road seams no longer count as walls.
  - **Footprint wall check:** a 3 × 4 grid, so the car can't slip a fence rail between its axles.
  - **Car scale:** 0.75 (0.75 m long), for the narrow 2–3 m fenced corridor.
  - **Autopilot:** fixed a steering sign error, widened the search to ±1.6 rad, added corridor centring and a
    reverse-out.
  - **Results:**
    - `?auto` drives around the track at about 10 m/s, always on the road;
    - manual W / A / D / S accelerate, steer, brake and reverse (to −4 m/s) correctly.
  - **Debug:** `__runs`, `__why`, `__dbg`, `__wheels` and `__spawn`.
- **v2.1 (2026-10-25):** fixed the car stuck at the start. The spawn faced a fence, and head-on collisions flipped
  the speed sign every step, so the heading spun forever. Spawn and autopilot now use the drivable test, and
  collisions stop cleanly.
