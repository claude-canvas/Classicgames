# SARATOGA GP — design document

A three-lap race around **Suzuka** (2001 layout) in a 1960 **Chrysler Saratoga**, against five AI Saratogas. Both
models are third-party downloads:
- the car from `low-poly-car-chrysler-saratoga-1960.zip`;
- the track from `suzuka-circuit-2001-layout.zip`.

The game is rendered with the arcade's **Space.js** (through `GameSpace.js`), plus the textured shaders and the
post chain from Forest Rally.

## 1. The race
- **Grid and start:** six cars line up behind the start line on the pit straight. The player starts 5th, so there
  is someone to chase. Five red lights come on one by one, then go out: GO.
- **Length and finish:** 1, 3 (default) or 5 laps, chosen on the menu and remembered. Positions come from progress along the racing line. When you finish, a results
  card shows your place, total time, best lap and the full order, plus **Race again**.
- **Penalties:** none. Cutting the track is slow on its own (grass and gravel drag).

| Input | Action |
|---|---|
| W / ↑ | accelerate |
| S / ↓ | brake, then reverse |
| A D / ← → | steer |
| Space | handbrake |
| C | chase view / bonnet view (remembered) |
| R | back onto the track, at the racing line where you are |
| M | sound on / off |
| H | hide or show help |
| Enter | start / race again |

Touch: ◀ ▶ on the left, GAS and BRAKE on the right, CAM at the top.

## 2. Assets (built offline by `tools/build.mjs`)
The source files are too heavy for a browser: 95 MB of track with 79 MB of PNGs, and 4K car textures. A Node script
writes slim GLBs. Images are resized and re-encoded in headless Chrome, through canvas `toDataURL`. JPEG is used for
opaque images and PNG for images with alpha; images with alpha get `alphaMode: MASK`.
- **`assets/suzuka.glb`:** every primitive, with the three nodes' rotation baked in and primitives merged per
  material. Road, kerb, grass and gravel textures are capped at 1024 px and everything else at 512.
  Materials with no texture (trees, shrubs) get a colour by name.
- **`assets/saratoga.glb`:** the car, converted from the OBJ (cm → m), with four primitives (body, glass and two
  tyre objects).
  - Each tyre object is split by side into four wheels, every wheel's vertices made relative to its own centre so
    it can spin and steer.
  - Body texture 1024 (JPEG); glass is RGBA with its opacity map in alpha; tyres 512.
- **`assets/line.json`:** the racing line, sampled every 4 m. It is the "groove" strip (the rubbered-in line)
  walked into a closed loop of 5.84 km. The real 2001 layout is 5.859 km, so 1 unit = 1 m.
  - The race runs toward −y on the pit straight, so the first corner is the downhill right-hander, Turn 1.
  - Per sample: x, y, z. At load, `makeLine` adds the free width to the left and right (asphalt, clear of walls),
    the curvature, and a speed profile per AI.
- **Decals:** the groove and skid-mark overlays keep their alpha and are drawn blended.
- **Trees:** the tree and shrub cards arrived without textures. They get a tree drawn on a canvas at load
  (alpha-tested), and `TREE_SHADOW` gets a soft blob. A procedural shader version was too slow, because of
  per-pixel noise over large overlapping cards.

## 3. World and rendering
- **Loading:** `gltex.js` (from Forest Rally) loads both GLBs into material groups.
  - Material classes by name: road-like ground (road, kerbs, grass, gravel, pit road), barriers (guardrail, tyre
    wall, walls, fences), sky / unlit, and everything else as scenery.
  - Cut-out materials (alpha) are alpha-tested.
- **Shading:** textured, lit by sun and hemisphere, with distance fog.
- **The cars:**
  - GPU-skinned: bone 0 is the body, bones 1–4 the wheels.
  - The body uses a car-paint mode (sun specular plus a sky reflection), tinted per car with `uTint`; glass is
    alpha-blended.
  - A soft contact shadow sits under each car.
- **Culling:** at load, each material's triangles are reordered into 100 m tiles, each with a bounding sphere. A
  frame draws only the tiles in the view frustum, merging neighbouring ranges.
  - The whole circuit is about 1 M vertices; a typical view is 60–350 k.
  - Small detail (marshals, poles, lights, signs, crews, skid marks, numbered props) is drawn within 300 m, and
    everything else within 1.2 km. Cars beyond 120 m skip their wheels and glass.
- **Post:** bloom only, using the lean post chain from Forest Rally v2.3 (god rays skipped, light depth of field).
  Adaptive resolution is kept.
- **Sky:** the procedural sky quad.

## 4. Collision (from the model's own triangles)
- **Ground:**
  - The track surfaces (road, kerbs, grass, gravel, pit road) count either facing. Other solid structures count
    only up-facing, so a bridge's underside is never a floor. Trees, poles and people are not ground.
  - Only triangles within about 45 m of the racing line are kept.
  - Bucketed in 2 m cells and queried by exact height, nearest at or below the car (+0.6 m step), so the bridge
    crossover works.
  - The ground material is stored per triangle: grass and gravel add drag.
- **Walls:**
  - Steep triangles of every material that is not a track surface: guardrails, tyre walls, concrete walls, fences,
    the pit wall, buildings, poles and trees.
  - Skid marks and the groove are excluded.
  - Sampled into 0.5 m cells, each keeping separate height intervals (the Forest Rally v2.4 scheme).
  - A car is blocked by a wall interval between 0.3 m and 1.4 m above its wheels.
- **Car vs car:** each car is two circles (front and rear). Overlaps are pushed apart along the contact normal,
  with a speed exchange.

## 5. Driving (`car.js`)
An arcade bicycle model:
- **Speed:** top 62 m/s (about 223 km/h); acceleration tapers toward top speed; brakes 22 m/s²; reverse −8 m/s.
- **Steering:** the lock shrinks with speed; turn rate capped at 1.6 rad/s; turn-in eases with `dt * 5`.
- **Grip and steering:**
  - The steering lock is grip-limited (`maxSteer`): the turn rate never exceeds grip / speed. Grip is 18 m/s² on
    asphalt and kerbs, 9 on grass and 6 on gravel, averaged over the four wheels, so one wheel on the grass costs a
    quarter.
  - The handbrake loosens the rear.
  - Off road, extra drag, also averaged per wheel: grass about −35 % top speed, gravel about −60 %.
- **Height and tilt:** the height comes from the four wheel contacts; pitch and roll from their differences.
  Wheels spin with speed, and the front wheels steer.
- **Walls:**
  - The footprint is checked on a grid of points. A blocked move slides along the wall (the move turned up to
    ±1.45 rad), then pivots, then stops only when head-on (the Forest Rally v2.4 response).
  - Wall hits cost speed in proportion to the impact angle, and play a crunch sound.

## 6. AI
Each AI car steers by **pure pursuit**: the curvature that reaches the target point becomes a steering angle, as a
share of the grip-limited lock. (Proportional steering on the heading error turned in too late and ran wide into
the gravel.) The target point is set by:
- a lookahead of 9 m plus 0.35 s × speed;
- a lateral offset of its own (it drifts back toward the line in corners);
- a nudge away from any car close ahead.

**Target speed:**
- comes from the line's curvature: v = √(a_lat · R), with a_lat = 12.6–14.4 m/s² by skill (below the 18 m/s²
  grip), followed by a backward braking pass;
- the AI brakes when it is over target, fully from 3 m/s over.

**Result** (fast-forwarded races): every car stays within 2.5–5 m of the line, with 1–3 s off the asphalt per lap
(kerb-riding). Laps take about 2:20–2:32 by skill.

The AI uses the same `stepCar`, so it obeys the same walls and surfaces. If one is stuck for 2 s, it is put back on
the line.

**Rubber band:** small. An AI more than 150 m ahead of the player loses 4 % grip; one more than 150 m behind gains
4 %.

## 7. Camera
- **Chase:** 9 m behind and 3 m up, looking 4 m ahead. The yaw trails smoothly; no zoom.
- **Bonnet:** the eye just above the dashboard, looking along the car, following pitch and heading directly.
- The camera is kept above the ground.

## 8. HUD
- **Top left:** position (P3 / 6), lap (2 / 3) and the timers (current lap, last lap, best lap).
- **Top right:** a minimap drawn from the racing line, with a dot for each car (yours highlighted).
- **Bottom right:** a speedometer (km/h), with "WRONG WAY" shown when you drive against the line.
- **Middle:** the start lights, and the results card at the end.

## 9. Sound (Web Audio, synthesised)
- **Engine:** two detuned oscillators through a low-pass filter. The pitch follows a simple 4-gear rev model.
- **Tyres and impacts:** noise bursts for tyre squeal and wall crunches; beeps for the start lights.

## 10. Files
| File | Contents |
|---|---|
| `index.html` | page, HUD, menus |
| `GameSpace.js` | Space subclass with normal + UV attributes (from Forest Rally) |
| `mesh.js`, `post.js` | geometry helpers, post chain (from Forest Rally) |
| `shaders.js` | scene shaders (Forest Rally's, plus car paint and `uTint`) |
| `gltex.js` | textured GLB loader (from Forest Rally) |
| `collide.js` | ground and wall maps |
| `car.js` | car physics and pose |
| `ai.js` | racing line helpers, AI driver, progress and positions |
| `main.js` | loading, race flow, camera, render, HUD, sound |
| `tools/build.mjs` | the offline asset builder (Node + headless Chrome) |
| `assets/*` | built assets |

## 11. Notes
- **Third-party assets:** Suzuka is a real circuit and the track model has its real sponsor branding. Like Forest
  Rally, the game is for local use and is not listed on the arcade home page.
- **Debug:**
  - `?auto`: the player's car drives itself.
  - `?prof` and `__prof()`: frame timings.
  - `__race()`: state, cars, drawn vertices.
  - `__ff(seconds)`: fast-forwards the race without rendering; about 3 s for a full 3-lap race.
  - `__probe(x, y)`: ground surfaces with their material names.
  - `__fit`, `__player`, `__line`, `__world`, `__groups`.
- **v1 (2026-10-26):** first version.
