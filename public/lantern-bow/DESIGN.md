# Lantern Bow — design & hand-off document

> First-person Japanese archery in a hillside garden at dusk. Draw a tall yumi bow, read the wind from the
> banners and drifting cherry petals, and loose arrows at paper targets, a swinging bronze gong and paper sky
> lanterns. Over six stages the day turns from golden hour to a moonlit festival where every lantern you hit
> launches fireworks.
> Built on the arcade's own `Space.js` (GameSpace subclass + custom shaders + bloom). Everything lives in
> `public/lantern-bow/`; do not edit outside it.

## 1. Controls
- **Mouse.** Click the view to capture the pointer, then move the mouse to aim. Hold the left button to draw:
  draw power rises to full in about 1.1 s. Release to loose the arrow. Hold Shift to hold your breath, which
  calms the sway. Esc pauses.
- **Touch.** Press anywhere to start drawing, drag to aim (relative movement), lift to loose. A steady button on
  screen does the same as Shift.
- **Keyboard.** Arrow keys or WASD aim, Space draws (hold) and looses (release).
- **Sway.** Aim drifts with a slow breathing wobble. It grows once you hold full draw for more than 2.5 s, and
  shrinks while you hold your breath (a 3 s meter that refills).

## 2. Ballistics (`physics.js`, pure)
- Launch speed is `v0 = 54 · power^0.75` m/s, with a minimum power of 0.25.
- Forces: gravity 9.81 m/s², plus quadratic drag `k = 0.0016 /m` on the air-relative velocity.
- Wind: an extra crosswind push `a = 0.55 · (wind − v)⊥`, so a 5 m/s crosswind moves an arrow about 0.4 m at
  30 m.
- Sub-steps of 1 ms. Collisions are segment-based against discs (targets, gong), spheres/cylinders (lanterns)
  and the ground.
- Wind changes before every shot, from 0 up to the stage's maximum. You can read it from the HUD arrow, the
  banner streamers and the drift of the petals.

## 3. Targets and scoring
| target | where | points |
|---|---|---|
| **Mato** (1.0 m festival target, 5 rings) | sand bank at 15–35 m | 10 / 8 / 6 / 4 / 2 by ring |
| **Sliding mato** | on rails, gliding left and right | ring score × 1.5 |
| **Gong** (bronze, hanging) | 38 m, swings when hit | 20 |
| **Sky lantern** | released from the garden, rises and drifts with the wind | 15 + 1 per metre of height |
| **Festival lantern** (night) | as above, bursts into fireworks | 25 |

- **Combo:** consecutive hits multiply the score by ×1.0, ×1.25, ×1.5 and then ×2. A miss resets it.
- **Distance bonus:** +1 point per 5 m beyond 20 m.
- **Arrow cam:** a hit at more than 25 m shows the last 0.35 s in slow motion from behind the arrow.

## 4. Stages (`levels.js`)
| # | name | time of day | targets | max wind | arrows | stars (score) |
|---|---|---|---|---|---|---|
| 1 | First Light | golden hour | 3 mato at 15, 22 and 28 m, with the aim guide | 1.5 m/s | 8 | 50 / 90 / 130 |
| 2 | Bronze Voice | golden hour | 2 mato and the gong | 3 m/s | 8 | 60 / 110 / 160 |
| 3 | Gliding Rings | late sun | 2 sliding mato and 1 fixed mato | 3.5 m/s | 10 | 70 / 130 / 190 |
| 4 | Lantern Dusk | dusk | 6 rising sky lanterns and 1 mato | 3 m/s | 10 | 80 / 150 / 220 |
| 5 | Moonrise | night | glowing mato, sliding mato and lanterns, with fireflies | 4 m/s | 12 | 100 / 180 / 260 |
| 6 | Festival of Lights | night | waves of festival lanterns, the gong and a mato; fireworks | 5 m/s | 15 | 150 / 260 / 380 |

Stages unlock in order. Best scores and stars are saved in localStorage under `lanternbow.save`.

## 5. World and presentation
- Coordinates are z-up and in metres. The archer stands at the origin with the range running along +y.
- Archery platform: a wooden deck in the foreground with the edge of a dojo roof overhead.
- The range:
  - a raked lawn;
  - a reflecting pond at 8–18 m;
  - stone tōrō lanterns;
  - cherry trees down both sides, with dense blossom clusters that glow when backlit;
  - a red torii gate behind the targets at about 40 m;
  - nobori banner poles that show the wind;
  - a sand bank (azuchi) with a small roof.
- Beyond the range:
  - layered mountain ridges up to 2 km away, with atmospheric perspective;
  - a snow-capped peak;
  - a pagoda silhouette on a ridge.
- Sky (background shader):
  - a time-of-day gradient with the sun and a halo;
  - lit cloud bands;
  - at night, stars and a moon.
- Water shader: reflects the sky and the lanterns (mirrored sprites), with ripples and Fresnel.
- Lights: at night the lanterns, stone tōrō and targets are point lights (up to 8) in the scene shader.
- Particles:
  - cherry petals drift with the wind;
  - fireflies at night;
  - hit sparks and paper shreds;
  - lantern bursts with embers;
  - fireworks (peony, ring and willow shells) with trails and glow.
- The bow: a tall asymmetric yumi seen in first person. The bow bends and the string pulls back with draw. The
  arrow is nocked, there is a glove hand, and there is a slight camera push-in at full draw.
- **Arrows** in flight have a faint motion trail. Arrows that hit stay stuck in the targets.

## 6. UI
- **Title:** the logo in a brush-style font, Play and Stages.
- **Stage select:** six cards, each with a time-of-day thumbnail gradient and its stars.
- **HUD:**
  - stage name;
  - score with a combo badge;
  - the quiver (arrows left);
  - a wind compass (direction and m/s);
  - a draw power ring around the crosshair, plus the breath meter;
  - the hit popup ("Bullseye +10 ×1.5").
- **Results:** stars, score, accuracy, best combo, Retry / Next.
- **Settings:** sound, music, aim sensitivity, invert Y, aim guide (auto / on / off), arrow cam on or off.

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `physics.js` ·
`levels.js` · `scene.js` (static world) · `bow.js` (first-person bow, arrows) · `fx.js` (particles, fireworks) ·
`audio.js` · `main.js`.

## 8. Debug
- `?stage=N` starts stage N.
- `?auto` plays the stage with an aiming bot.
- `window.__bow()` returns the current state.
- `window.__fw()` launches three test fireworks.

## 9. Progress log
- v1 complete. All six stages are verified in headless Chrome with the auto-aim bot (`?auto`):
  - stage 1: bullseye on the first arrow;
  - stage 6: 7 of 7 lanterns hit, 331 points by arrow 7;
  - arrow cam triggers on hits beyond 25 m;
  - fireworks burst inside the view over the ridges.
  The game runs at 60 fps, with about 431k static vertices built in about 0.2 s.
- Balance: the ballistics give about 1.4 m of drop at 28 m. A 5 m/s crosswind moves the arrow about 0.44 m at 28 m,
  which is about the radius of a target, so reading the wind matters.
- Tuning notes:
  - Blossoms use 10×6 blob clusters (7 per branch). Denser clusters cost a lot of vertices.
  - The bow sits well left of the sight line and is slim (8 mm stave), and the field of view tightens by 22 % at
    full draw.
  - `window.__fw()` launches test fireworks.
