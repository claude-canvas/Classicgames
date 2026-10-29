# GOLDEN HARE — design document

A bow hunt for rabbits through a sunlit pine forest at sunrise. It uses the same downloaded ponderosa forest model as
Last Light and The Hollow Pines, seen in first person at human scale (eye height 1.62 m), so the pines, grass and
rocks read as whole shapes.

## Story (light)
Old Maud's vegetable patch at the forest's edge has been stripped bare again. At first light you take her late
husband's bow into the pines, where the rabbits come out to graze in the dew. Somewhere out there is the one the
village talks about: the **Golden Hare**, quick as a sunbeam and never caught.

## 1. Play
- **Controls:**
  - Look: mouse, with pointer lock. Move: WASD. Sneak: C or Ctrl (slow and quiet). Run: Shift (loud).
  - **Bow:** hold the left mouse button to draw (it takes about 0.8 s to full draw; holding past 3 s makes your aim
    shake), and release to shoot.
  - **Arrows:** walk over a spent arrow to pick it back up. R refills the quiver at your satchel at the start spot.
- **The morning:**
  - A hunt lasts **4 minutes**, from sunrise to mid-morning, while the sun climbs and the mist burns off.
  - The quiver holds **12 arrows**.
- **Rabbits:**
  - Up to **10** are about the clearing at once. More hop in from the forest edge as they are taken.
  - **States:** graze (nibbling, the odd hop), alert (sits up, ears high, looks at you), flee (a fast zigzag away for
    a few seconds), hide (still in long grass).
  - **Noise:** they notice you by noise and sight. Running is heard within 18 m, walking within 9 m, sneaking within
    3.5 m, and a loosed arrow landing nearby startles them too. A rabbit already alert bolts if you keep coming.
- **The Golden Hare:**
  - It appears once, about two minutes in, for 40 s. Hard to approach, very fast.
  - A ring of light and a chime mark it.
- **Scoring:**
  - A hit is 100 points, plus 8 per metre of distance. A running rabbit adds 60%. The Golden Hare is worth 1,000.
  - Misses cost nothing but the arrow.
  - Rank at the end: Novice, Forager, Hunter, Marksman or Legend of the Pines. Best score is remembered.
- **No gore:** a hit rabbit tumbles in a puff of fluff and glittering motes, and is bagged.

## 2. Look
- **Sunrise:**
  - A low warm sun behind the tall pines, with god rays (the post chain's rays pass) through the canopy.
  - A rose-gold horizon over a blue zenith, and light mist that thins as the morning goes on.
- **Air:** drifting pollen motes and dandelion seeds that sparkle in the sunbeams. Grass and needles glow when
  backlit.
- **Rabbits:**
  - Smooth, rounded models (high-segment blobs): a soft brown-grey coat with a cream belly, a white cotton tail,
    long ears with a pink inner ear, glossy eyes with a highlight, and a twitching nose.
  - The Golden Hare is gold, with a shimmer.
- **The bow:** a recurve in the lower right of the view, with a string, an arrow on the string and a leather grip.
  It draws back, and the field of view narrows a little at full draw.
- **Post:** bloom, a warm golden grade, a light vignette, fine grain, and a soft depth of field on the far trees.

## 3. Sound (Web Audio, synthesised)
- **Morning:** birdsong (varied chirps and a song thrush), wind in the pines, and a soft pad.
- **The bow:** a creak while drawing, a twang, then the arrow's whistle and its thunk into earth or wood.
- **Rabbits:** a soft thump on a hit, a rustle as one bolts, and a golden chime for the hare.

## 4. Files
| File | Contents |
|---|---|
| engine | `GameSpace.js`, `mesh.js`, `post.js`, `forest.js`, `lod.js`, `world.js`, `nav.js`, `shaders.js` (from The Hollow Pines) |
| `bunny.js` | rabbit model (skinned), poses, behaviour |
| `bow.js` | bow and arrow models, arrow flight |
| `sound.js` | morning audio |
| `main.js` | first-person controller, the hunt, scoring, HUD, auto mode |

## 5. Development
- **`?dev`:** live reload. **`?auto`:** a bot hunts, stalking, aiming with a ballistic solve and shooting.
- **Debug:** `__gh()` (state) and `__ff(seconds)` (fast-forward).

## 6. Notes
- **Third-party model:** the forest is the same downloaded model as the other pine games.
- **v1 (2026-10-29):** first version.
  - **Arrows:** one that hits a rabbit drops where it fell and can be picked up again (within 1.2 m).
  - **The bot:** it refills at the satchel when no spent arrow is reachable, and leaves a rabbit alone for 20 s after
    three misses (usually a trunk in the way).
  - **Tested** in fast-forwarded hunts: the whole morning plays out, the Golden Hare appears at 115 s and has been
    caught, and the end card shows the rank and stats. A typical view draws 180–260 k indices at 40–57 fps.
- **v1.1 (2026-10-29): wind, and no more pop-in.**
  - **Wind** (vertex shader, `uSway` = tree flag and ground height):
    - A slow gust field drifts across the forest. Each tree bends with height (pow(h, 1.3) · 0.014 m: about 15 cm at
      the top of a 6 m pine, 0.5 m on a 15 m one), with a sideways wobble.
    - Branches, needles and the tree's impostor share the same bend, so needles never drift off their branches.
    - Needles add a small fast flutter; grass blades bend from root to tip.
  - **The trees that "grew":** young pines shared one impostor picture, scaled by the picture's height rather than
    the tree's. Bushy pines (wider than half their height) were pictured too small, so they jumped taller on
    switching to the full mesh.
    - Every young pine now has its own baked picture (64 of them), placed exactly as baked.
    - The same scaling bug is fixed in Last Light and The Hollow Pines.
  - **Popping:**
    - Full meshes and impostors cross-fade over a 3 m band, with complementary screen-door dither (`uDither`).
    - Impostors dissolve between 135 and 150 m, and grass, rocks, logs and ground dissolve over the last 7 m of their
      draw distance, instead of cutting off.
  - **Impostor shading:** a canopy-like normal and +32% albedo (`uImp`), so the picture matches the sunlit full tree.
  - **Debug:** `?nowind`, `?nodither`, `?noimp`, `?noyoung`, `?near`; `__LOD`, `__trees()`, `__imps()`.
  - **Not measured:** frame rate. During this session the test GPU (Intel Iris Xe) ran several times slower than
    before, even for unchanged games, so the timings could not be trusted.
