# LAST LIGHT — design document

## Story
The sun is going down over the old ponderosa stand. Every evening the **lantern-caps** — glowing mushrooms at the
feet of the great pines — have to be woken with fireflies, so the forest's small creatures can find their way home
in the dark. Tonight the old lamplighter is too ill to go, and the job falls to **Wick**, a harvest mouse no taller
than a pine cone.

Gather the fireflies hiding in the long grass, carry them to the seven lantern-caps, and light the forest before
night falls. Keep to the grass: **Old Hush** the owl hunts the open ground at dusk.

The forest model is about 55 m across where it matters (grass, logs, rocks, young pines), inside a ring of tall
pines 200 m wide. Wick is **9 cm** long, so for him that clearing is a whole country. The grass is a jungle, the
logs are walls, and the rocks are mountains.

## 1. Play
- **Movement:** WASD / arrows, relative to the camera. Shift to scurry, Space to jump. Hold Space while falling to
  glide on a maple seed (a slow, steerable fall). The mouse turns to face where he runs.
- **Fireflies:**
  - 45 fireflies drift low over the grass, the logs and the rock tops. Touch one to collect it.
  - Collected fireflies trail behind Wick in a glowing chain. He can carry 6.
- **Lantern-caps:** seven mushroom clusters at tree roots, beside logs and on a rock. Each needs **3 fireflies**.
  Bring them close and the fireflies fly in. The cap lights with a bloom flash and a chime, and stays lit as a
  beacon (a light pillar plus a glow).
- **The sun:**
  - The day runs from golden hour to night in about **7 minutes**.
  - The sky, sun colour, fog and shadows go from gold to rose, then to blue dusk, and to night with stars.
  - A sun-arc gauge in the HUD shows how much light is left.
- **Old Hush:**
  - From dusk, the owl circles high over the clearing. Its shadow, a dark ellipse, glides over the ground.
  - If the shadow finds Wick in the open, it locks on. Half a second later the owl swoops with a screech and Wick
    drops what he is carrying (the fireflies scatter nearby and can be gathered again).
  - In tall grass, or under a log, Wick is hidden and the shadow drifts away.
- **The end:**
  - **All seven lit before night:** "The forest is lit." The camera rises as the caps glow, fireflies drift up and
    the stars come out.
  - **Night falls first:** a gentler ending that shows how many lights Wick woke. Retry is one key.
  - Best results are remembered: lights, time to spare, and the least time caught.
- **Auto mode (`?auto`):** Wick plays himself. He heads for the nearest firefly while carrying fewer than 3, then for
  the nearest unlit cap. He jumps when blocked and keeps to the grass when the owl is near. Used for the live
  development view and for testing.

## 2. Assets (`tools/build.mjs`, offline)
- **Source:** `ponderosa_stand_sketchfab.glb` (37 MB): 153 unique meshes, 287 tree instances, 7 materials.
- **Output:** `assets/forest.bin` + `assets/forest.json`, a compact instanced format.
  - **Meshes:** each unique mesh is stored once, indexed (Uint32). Positions are float32. Normals are int8 and
    vertex colours (`COLOR_0`) uint8, both normalised. UVs are float32. The source's `COLOR_1` is dropped.
  - **Instances:** every mesh node's world matrix, converted Y-up → Z-up.
  - **Textures:** resized and re-encoded in headless Chrome (bark 512, foliage 1024 with alpha, grass 512 with
    alpha, ground 2048). The unused normal map is dropped.

## 3. Rendering (Space.js through `GameSpace.js`, plus the arcade's shaders and post chain)
- **Instancing:** an instanced mesh's vertices carry `pos.w = 1000` (bone 0). Each draw sets bone 0 to the instance
  matrix, so one shader serves static geometry, instances and the skinned mouse.
- **LOD and culling:**
  - **Full meshes:** the three hero pines, every young pine within about 22 m, rocks, logs, grass and ground. The
    grass and ground are split into 8 m tiles, and only tiles in view are drawn.
  - **Impostors:** distant pines, the 220 ring trees and young pines beyond 22 m, are drawn as two crossed
    alpha-tested quads.
    - Their textures are rendered at load: one per ring-tree type and one shared young-pine impostor, from the
      side, against transparent black, lit like the scene.
    - Each impostor is scaled to its instance's height.
- **Light and colour:** the time of day drives the sun direction and colour, the sky gradient (with the sun disc and
  a horizon glow), the fog colour and density, and the ambient light.
  - God rays through the canopy are on while the sun is up.
  - Bloom brings out the fireflies, the caps and the sun.
  - A gentle depth of field focused on Wick gives a miniature (tilt-shift) look.
- **Glow:** fireflies, lit caps and Wick's lantern are additive sprites. The nearest lit caps and the lantern
  light the scene through the point-light uniform.
- **Night:** stars on the sky quad, a moon, a blue moonlit tint and warm pools of light around the caps.

## 4. World and collision
- **Ground:** the up-facing triangles of the terrain, the rock tops and the log tops, in 1 m buckets and queried by
  exact height. Wick steps up at most 4 cm. Higher ledges need a jump.
- **Walls:** steep faces of rocks, logs and tree trunks (the branches mesh within 1.5 m of the ground), in 0.1 m
  cells with height intervals. Wick is blocked by a wall between 1 and 7 cm above his feet.
- **Cover:** a 0.5 m grid counts the grass blades (`grass_fine`, `grass_lush`) in each cell. A dense cell is "long
  grass", where the owl can't see you. Under a log counts as cover too.
- **Out of bounds:** the clearing is about ±30 m. Beyond 34 m from the centre a soft barrier slows and turns Wick
  back ("The old pines are too dark to wander tonight").

## 5. Wick (procedural, skinned)
Built from blobs, like the arcade's other characters:
- body, head, big ears, whiskers, a long tail (3 bones), four legs and a tiny lantern on a stick;
- a run cycle, an idle (ear twitches and tail sway), a jump, and a glide pose holding a maple seed;
- the lantern glows warmer the more fireflies he carries.

## 6. Camera
- **Third person, low:** 0.55 m behind Wick and 0.28 m up, looking at a point just ahead of him. Drag the mouse (or
  hold Q/E) to orbit.
- **Distance:** fixed, with no automatic zoom. Clearance probes keep the camera from going under the ground or into
  rocks.

## 7. Sound (Web Audio, synthesised)
- **Ambience:** a wind bed with occasional birdsong at golden hour, then crickets after dusk.
- **Fireflies:** a soft chime when one is collected, and a rising arpeggio when a cap lights.
- **The owl:** wing whooshes, and a screech when it swoops.
- **Wick:** pitter-patter footsteps.

## 8. Development
- **`?dev`:** live reload. The page polls the source files' ETags every 1.5 s and reloads when one changes. During
  development a visible Chrome window runs `?auto&dev`, so the user can watch every update.
- **Debug:** `__ll()` (state), `__ff(seconds)` (fast-forward), `?prof`.

## 9. Files
| File | Contents |
|---|---|
| `index.html` | page, HUD, cards |
| `GameSpace.js`, `mesh.js`, `post.js` | from the arcade (Forest Rally / Saratoga GP) |
| `shaders.js` | scene shaders with time of day, sky and stars |
| `forest.js` | loading the instanced forest, LOD, impostors, culling, drawing |
| `world.js` | ground, walls, cover |
| `wick.js` | the mouse: model, bones, animation, movement |
| `life.js` | fireflies, lantern-caps, the owl |
| `main.js` | game flow, camera, sun cycle, HUD, sound, auto mode |
| `tools/build.mjs` | the asset builder |

## 10. Notes
- **Third-party model:** the forest is a downloaded model, kept for local use and not listed on the arcade home page.
- **LOD fix (2026-10-27):**
  - The young and big pines are world-placed meshes with identity matrices. `groupTrees` had merged them all into one
    "tree" that was always drawn in full, so their impostors and twig-free LOD never applied.
  - They now pair up by mesh name (branches with foliage), and the impostors centre on each tree's own box.
  - The twig-free distance now uses each tree's centre.
