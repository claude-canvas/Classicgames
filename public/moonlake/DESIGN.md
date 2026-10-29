# Moonlake — design & hand-off document

> A calm 3D fishing game on a mountain lake that drifts from sunset through a starry night to dawn.
> Cast from an old wooden dock, watch the bobber, strike on the bite and play the fish on a tension gauge.
> Fill a 15-species journal — some fish only rise at night, in the reeds, or for a glowing lure.
> Built on the arcade's own `Space.js`. Everything lives in `public/moonlake/`; do not edit outside it.

## 1. Loop
1. **Cast** — press and hold on the water: a ring charges distance toward the pointer; release to cast.
2. **Wait** — fish (dark shadows under the surface) notice the lure if it suits them; they circle, nibble
   (small bobber dips) and **bite** (bobber plunges, splash, "!" + sound).
3. **Strike** — click / Space within ~0.7 s of the bite, or the fish spits the hook.
4. **Fight** — hold to reel, release to give line. Keep **tension** in the green band: above the red line for
   0.6 s snaps the line; slack for 2.2 s lets the fish escape. Reeling in the band drains the fish's
   **stamina** and brings it in; a tired fish pulls less. Distance 0 → caught.
5. **Catch card** — the fish turns slowly on a 3D trophy card with species, weight, rarity and records.

## 2. Fish (`fish.js`)
15 species, each with zone (shallows · reeds · rocks · deep), time (dusk · night · dawn · any), favourite lure,
weight range, rarity (common · uncommon · rare · legendary), fight (power, stamina, erratic) and a parametric
3D model (length, depth, colours top/flank/belly, pattern: spots · stripes · patches · glow).
The lake keeps ~8 swimming fish chosen by zone/time weights; new ones spawn as others are caught or wander off.

## 3. Lures
Spinner (start) · Fly (unlocks at 4 species) · Glow Lure (unlocks at 8). Each species likes one lure (×2.5
interest), tolerates others (×1) — except glow-only species, which ignore anything else.

## 4. Time of day
One full cycle ≈ 8 minutes: dusk → night → dawn → day-ish dusk again. Sky, sun/moon, fog, water colour,
fireflies (night), mist (dawn) and which species appear all follow the clock (shown as an arc in the HUD).

## 5. Presentation
- Water: animated wave normals, sky reflection with the moon/sun path, ripple rings, fish shadows (multiply).
- Shore: reeds, lily pads with flowers, rocks, pines on hills, distant mountains; a lantern on the dock.
- First-person rod in the corner that bends with tension; the line sags or goes taut.
- Catch: the fish leaps out of the water in a splash, then the trophy card.

## 6. UI
Title · HUD: clock arc, lure chip (change lure), journal button with completion %, catch counter, contextual
hint line, bite "!" pop, **fight gauge** (curved tension meter with green band and red line, fish stamina,
line distance) · Modals: catch card (3D fish rendered live behind a framed card), journal (15 cards, silhouettes
until caught, best weight, times caught, where/when hints), lure picker, settings, how to play.

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` · `shaders.js` · `fish.js` (species + model) ·
`lake.js` (scene) · `audio.js` · `main.js`.

## 8. Debug
`?autoplay` (casts, strikes and reels by itself) · `?time=0.4` (clock 0..1) · `?speed=4` · `window.__lake()`.

## 9. Progress log
- v1: implemented in full: clock keyframes (sky/sun/moon/fog), living fish population by zone/time/lure,
  cast → nibble → bite → strike → tension fight → leap → catch card with the live 3D fish in the card window,
  journal, lures unlocking at 4/8 species, fireflies, dawn mist, ambience that follows the clock.
- Verified in headless Chrome (GPU, 60 fps): title at dusk, night autoplay landing fish (3 in ~40 s at ×3),
  catch card (`?keepcard`), dawn.
