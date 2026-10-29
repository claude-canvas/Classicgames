# Wisp Siege — design & hand-off document

> Tower defense on a floating isle at night. A winding path of glowing stone leads to the Crystal Heart, and
> shadow creatures come up it in waves: wisps, moth swarms, stone golems and wraith shades. Raise lamp towers on
> the grass beside the path, upgrade them, and keep the Heart alive through 15 waves.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/wisp-siege/`; do not edit outside it.

## 1. Rules (`game.js`, pure; the renderer and the headless test both drive it)
- **Map:** a 14×9 tile grid. The path is a polyline of tile centres (`MAPS[0].path`). Towers can be placed on any
  non-path tile that is not marked rock.
- **Enemies** follow the path at their speed. Reaching the Heart costs lives: 1, or 5 for the boss.
  | Type | HP | Speed (tiles/s) | Armor | Gold | Notes |
  |---|---:|---:|---:|---:|---|
  | wisp | 30 | 1.6 | 0 | 4 | |
  | moth | 12 | 2.2 | 0 | 2 | Spawns in swarms. |
  | golem | 160 | 0.7 | 4 | 12 | Armor is subtracted from each hit, min 1. |
  | shade | 70 | 1.3 | 0 | 8 | Immune to slow. |
  | boss | 1600 | 0.55 | 6 | 120 | Waves 10 and 15. |
- HP scales ×1.12 per wave.
- **Towers:**
  | Tower | Cost | Range (tiles) | Attack | Upgrades |
  |---|---:|---:|---|---|
  | Arc Lamp | 60 | 2.6 | A continuous beam, 22 dps, on the first enemy in range (the furthest along the path). | Each level ×1.6 dps, +0.3 range. |
  | Mortar | 90 | 3.4 | A shell every 1.6 s: 40 damage, splash 0.9 tiles. | Each level ×1.55 damage. |
  | Frost Bell | 70 | 2.0 | An aura that slows to 55 % speed (40 % at level 3) and chimes for 4 damage every 1 s. | |
  | Tesla Spire | 120 | 2.8 | A bolt every 0.9 s for 30 damage that chains to 3 targets (5 at level 3). | |
- **Upgrades:** 2 upgrades per tower; the cost is 70 % then 110 % of the base. Selling returns 70 % of what was spent.
- **Economy:** 220 starting gold, kill bounties, and +20 gold per wave cleared plus a 15 % interest bonus on banked
  gold (capped at 40).
- **Waves:** 15 scripted waves (`WAVES`), each a list of `[type, count, gap]` groups. "Call early" gives bonus
  gold for the remaining wait.
- **Lives:** 20. The run is won after wave 15 and lost at 0 lives.

## 2. Presentation
- **Island:** grass tiles (with flowers and moss) and a glowing cobbled path that pulses toward the Heart. The
  rocky underside floats over a sea of clouds under a starry violet sky with two moons.
- **Heart:** a big faceted crystal on a plinth that pulses. It cracks visibly as lives drop.
- **Towers:**
  - Arc Lamp: a brass lamp post with a lens whose warm beam latches onto targets.
  - Mortar: a stone barrel that lobs glowing shells in arcs with splashes.
  - Frost Bell: a blue bell shrine whose frost ring shimmers.
  - Tesla Spire: a copper coil that throws violet chain lightning.
  - Upgrade level shows as rings and extra glow.
- **Enemies:**
  - wisps are floating flames with trails;
  - moths flutter;
  - golems are lumbering rock with glowing cracks;
  - shades are dark translucent wraiths;
  - the boss is a giant shadow beast.
  - All show HP bars, and all burst into motes on death.
- **Camera:** an orbit around the island (drag, wheel), tilted 55°.
- **Build menu:** a radial menu on the clicked tile, with a range preview ring.

## 3. UI
- **HUD:** wave n/15, lives, gold, Next-wave button (or "Call early"), speed ×1/×2, and the selected tower panel
  (stats, upgrade, sell).
- **End cards:** Victory or Defeat, with the waves survived. The best result is saved in `wispsiege.save`.

## 4. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `game.js` · `scene.js` ·
`audio.js` · `main.js`

## 5. Debug
- `?auto`: a heuristic builder plays.
- `?wave=N` starts on wave N.
- `window.__siege()` returns the current state.

## 6. Progress log
- v1 (2026-10-19): complete and playable.
  - **Balance:** checked headless with scratchpad `wstest.mjs`. With HP ×1.2 per wave, the heuristic `autoBuild`
    wins with 15/20 lives and building nothing loses at wave 2.
  - **Shaders:** reused from prism-garden (night sky, moss, glass). The canvas pixel budget is capped at 1.8 MP
    (fill-bound at full DPR), and 6 point lights are used.
  - **Title:** runs an autoplay demo.
