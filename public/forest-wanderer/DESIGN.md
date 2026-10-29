# ECHOES OF THE HOLLOW — design document

A basic third-person exploration scene: a villager walks, sprints and jumps freely through a forest valley at golden
hour. It is the foundation for a later RPG. There is no combat, quests, inventory or dialogue yet, on purpose.

It runs on the arcade's **Space.js** (via `GameSpace.js`) with the custom shaders and post chain (bloom, god rays,
light depth of field) from Lanternfall and Paper Brook. It has no external libraries.

## 1. Controls
| Input | Action |
|---|---|
| W A S D (or arrows) | move, relative to the camera |
| Shift | sprint |
| Space | jump (0.12 s coyote time, 0.15 s input buffer) |
| Mouse | orbit the camera. Click to capture the pointer, Esc to release, or drag without capturing. |
| Wheel | zoom (2.4–11 m) |
| H | hide or show the help panel |

Touch: a virtual stick on the left (pushing far sprints), drag elsewhere to look, and a JUMP button.

## 2. Player (`main.js`)
- **Speed:** walk 3.4 m/s, sprint 7 m/s.
- **Acceleration:** horizontal velocity eases toward the target at rate 11 on the ground and 2.2 in the air, which
  gives a little air control.
- **Facing:** follows the velocity direction smoothly, at about 11 rad/s.
- **Gravity:** 19 m/s².
  - Jump speed is 6.4 m/s, giving about 1.05 m of height.
  - On landing faster than 4 m/s, the character dips and kicks up dust.
  - While walking downhill the character sticks to the ground within 0.35 m, so it never skips down slopes.
- **Ground:** `groundAt(x, y, z)` returns the procedural terrain height, or the GLB collision's ground.
- **Collision:** `blockedAt` checks the walk grid, which blocks tree trunks, rocks, pillars, the cabin, fences,
  water and steep slopes. The player is a 0.32 m circle that slides along obstacles one axis at a time.
- **Animation:** the villager is a chibi rig from `chars.js` (GPU-skinned, 23 bones, smooth normals).
  - Walk and run cycles; the stride cadence follows the real ground speed.
  - Idle breathing and blinking.
  - Airborne pose: knees tucked, arms out.

## 3. World (`maps.js`, `world.js`, built in `worker.js`)
**The Hollow** is a 200 × 200 m heightfield (z up). It contains:
- a starting clearing with a campfire, logs and a signpost;
- dirt trails to stone ruins with a shrine (NE), a ring of standing stones (NW), an overlook (SE) and south across
  a stream on a log bridge;
- a pond and a hunter's cabin;
- about 1,000 scattered pines, oaks, birches, autumn trees and willows, plus rocks, bushes, grass and flowers.

**Building and drawing:**
- The world is built in 25 m tiles in a worker and streamed nearest-first. Play starts once tiles within 40 m are
  in; the rest appear behind the fog.
- Tiles carry smooth vertex normals (a third vertex attribute), so rounded shapes don't look faceted.
- **Light:** a low afternoon sun with a baked dapple and shadow map from tree crowns, soft banded "storybook"
  diffuse light, and a sky with clouds.
- **Atmosphere:** exponential fog, god rays, glittering dust motes, butterflies, and campfire sparks, smoke and
  point light.

## 4. Camera
- **Orbit:** a third-person orbit camera with yaw, pitch (−0.35 to 1.25 rad) and distance, looking at a point 1.45 m
  above the feet.
- **Spring arm:** marches from the player toward the camera and shortens before terrain, tree trunks, boulders or
  the cabin come between them. It pulls in fast and eases back out.
- **Smoothing:** the target is smoothed. After 2.5 s without mouse input, the camera swings gently behind a
  walking player.

## 5. The supplied Sketchfab assets
The `.binz` files in the supplied folders are not 3D files. They are Sketchfab's viewer-cache downloads, which are
protected and scrambled; the PNG next to the villager is scrambled too. No standard loader (Space.js or otherwise)
can read them, and reverse-engineering that protection is not an option.

**To use the real models:** download them from Sketchfab with the official Download button, choosing the glTF / GLB
format (only if the model's licence allows downloads). Then save them as:
- `assets/forest.glb`: the environment, centred automatically with its lowest point at ground level.
- `assets/villager.glb`: the player, scaled to 1.75 m tall and turned to face forward.

The game probes for these files at start-up (`HEAD` requests) and uses them instead of the stand-ins.
- **Loader:** `glb.js` reads meshes and node hierarchies and bakes base-colour textures into vertex colours, which
  suits low-poly palette models.
- **Forest collision:** `buildCollision` builds walkable ground heights and obstacle extents from the forest
  model's own triangles.
- **Limitations:**
  - An imported villager is drawn rigid, with a walk bob and lean; skinned animations are not played yet.
  - Draco or meshopt-compressed files are rejected with a message, so export them uncompressed.

## 6. Files
| File | Contents |
|---|---|
| `DESIGN.md` | this document |
| `index.html` | page and HUD |
| `GameSpace.js` | Space subclass, including the normal attribute |
| `mesh.js` | geometry helpers, including `smoothNormals` |
| `post.js` | post chain |
| `shaders.js` | scene shaders |
| `maps.js` | the Hollow's terrain and props, plus the walk grid |
| `world.js` | static mesh builders and the shadow-map bake |
| `worker.js` | world builder thread |
| `chars.js` | villager rig |
| `glb.js` | GLB reader and model collision |
| `main.js` | game loop, player, camera, effects, HUD |
| `assets/` | optional `.glb` models (see `assets/README.md`) |

## 7. Debug
- `window.__hollow()` returns the state: position, ground, speed, facing, camera yaw and arm, fps, asset status.

## 8. Progress log
- v1 (2026-10-24): basic scene.
  - **Origin:** first built on Three.js, then switched to Space.js at the user's request.
  - **Engine:** reuses Lanternfall's world, character and shader code.
  - **Checked headless in Chrome with keyboard and mouse events:**
    - walking, sprinting and drag-to-look;
    - the jump arc: ground 5.3 m → peak 6.28 m → back to 5.3 m;
    - blocking at trees and at water's edge.
