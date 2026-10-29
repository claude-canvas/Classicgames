# Crystal Keep — design & hand-off document

> Tower defense in a 3D autumn valley at golden hour. Shadow creatures pour out of a violet rift and march
> along the old road toward the Keep's great crystal; you raise crystal-powered towers on the meadow plots
> beside the road. UI-first: build bar, tower inspector, wave preview, speed controls, boss bar, floating
> combat numbers, map gallery, results. Built on the arcade's own `Space.js` — no Three.js, no build step.

Single source of truth for this game. If you are an AI (or human) picking this up, read this file, then the
files in **File map** order. Everything lives in `public/crystal-keep/`; the only outside file used is
`../Space.js`, imported and never modified.

**Rule for this folder: do not edit any file outside `public/crystal-keep/`.**

---

## 1. Core loop
1. Before each wave you see what's coming (enemy icons + counts). Spend gold on towers / upgrades.
2. Call the wave early for bonus gold, or let the countdown run out.
3. Enemies walk the road; towers shoot automatically using each tower's **target priority**.
4. Each enemy that reaches the Keep costs lives. Lose all lives → defeat. Survive every wave → victory.
5. Stars: ★ win · ★★ ≥ 50 % lives left · ★★★ ≥ 90 % lives left. Saved per map × difficulty.

## 2. Map & grid (`maps.js`)
- Grid 18 × 11 cells, cell = 2 world units, Z up, ground z = 0. Cell (i, j): x = (i − 8.5)·2, y = (5 − j)·2.
- Maps are ASCII: `.` buildable meadow, `#` road, `B` bridge (road over water), `~` water, `T` tree,
  `R` rock, `S` spawn rift, `K` the Keep. Routes are found by BFS from every `S` to `K` over road cells.
- Maps: **Amber Vale** (one long switchback, easy), **Riverbend** (crosses the river three times, medium),
  **Twin Gates** (two rifts merging, hard). 20 waves each.

## 3. Towers (`defs.js`) — 3 levels each; sell refunds 70 % of everything spent
| Tower | Cost | Role | L1 → L3 (dmg / rate s / range cells) | Air |
|---|---|---|---|---|
| Archer Spire | 60 | fast single target | 12/0.6/3.2 → 36/0.4/3.7 | yes |
| Ember Cannon | 100 | splash (1.1 cells) | 32/1.6/2.8 → 90/1.3/3.2 | no |
| Frost Crystal | 80 | slows an area (40→60 %) + light damage | 6/1.0/2.5 → 16/0.8/3.0 | yes |
| Storm Obelisk | 140 | chain lightning (3→6 targets) | 26/1.2/3.0 → 60/0.95/3.5 | yes |
Target priority (per tower): **First** (furthest along), **Last**, **Strong** (most HP), **Close**.

## 4. Enemies
| Enemy | HP | Speed (cells/s) | Armor | Bounty | Leak | Notes |
|---|---|---|---|---|---|---|
| Imp | 40 | 1.6 | 0 | 4 | 1 | swarms |
| Brute | 150 | 0.85 | 4 | 11 | 2 | flat armor per hit (min 25 % dmg) |
| Wisp | 55 | 1.35 | 0 | 7 | 1 | **flying** — cannons can't hit |
| Slime | 90 | 1.0 | 0 | 8 | 1 | splits into 2 slimelings (30 HP, bounty 2) |
| Golem | 1500 | 0.55 | 8 | 120 | 10 | boss on waves 10, 15 and 20 (×2 + brute escort) |
HP scales `× (1 + 0.07·wave + 0.013·wave²) × difficulty` (gentle early, steep late). Waves come from
`waveScript()`; every 5th wave is a fast imp swarm (×1.6). With two rifts the swarm is split between them.

## 5. Economy & difficulty
| | Casual | Normal | Heroic |
|---|---|---|---|
| Lives | 30 | 20 | 10 |
| Start gold | 320 | 240 | 240 |
| Enemy HP | ×0.75 | ×1.0 | ×1.15 |
| Wave timer | 25 s | 15 s | 12 s |
Wave clear bonus `10 + 2·wave`. Calling a wave early pays `2 × seconds left`. Twin Gates gives +60 start gold.

## 6. Presentation
- Golden-hour autumn valley: meadow cells (buildable, subtly tiled), cobbled road, river with animated
  water, orange/red/gold trees, rocks, rising hills and distant mountains, warm sun low in the sky.
- The **Keep**: stone tower with a large floating crystal (bloom), pulses red when hit; health ring.
- The **Rift**: swirling violet portal.
- Towers have glowing crystals (cyan archer, ember cannon, ice frost, violet storm) that bloom.
- Enemies are dark creatures with glowing eyes; health bars billboarded in 3D when damaged.
- Projectiles: arrows with trails, arcing cannonballs + explosions, frost bolts + frost rings,
  jagged lightning chains. Floating gold/damage numbers are HTML overlays projected from 3D.
- Camera: ¾ view; drag to turn a little, wheel/pinch to zoom, double-click to reset.

### Materials (shaders.js; same scheme as jade-pavilion)
0 MATTE · 1 GLOSS · 2 WATER (animated normal, sun glint) · 3 BG sky · 4 SPRITE · 5 EMIT · 6 SHADOW (multiply)
· 7 ADD. Alpha = bloom mask (post.js).

## 7. UI (index.html)
- **Title**: logo + crest, map gallery (SVG previews from ASCII), difficulty segmented control, stars per
  map, Play, How to play, Settings.
- **HUD**: lives & gold pills (top-left), wave counter + next-wave preview + Call-wave button with bonus
  (top-centre), speed 1×/2×/3× + pause + settings (top-right), boss bar, build bar (bottom: 4 tower
  cards with icon, cost, hotkey; unaffordable greyed), **tower inspector** (right panel: level pips, stats,
  upgrade with stat deltas, target priority segmented control, sell value).
- Placement: ghost tower + range ring + green/red cell highlight; Esc / right-click cancels.
- Modals: Pause, Settings (volume, show all ranges, damage numbers, auto-call waves), How to play,
  Victory / Defeat with stars and stats.
- Keys: 1–4 build, U upgrade, X sell, Space call wave, F speed, P/Esc pause, Tab cycle priority.

## 8. File map
| File | Responsibility |
|---|---|
| `DESIGN.md` | this document |
| `index.html` | page, CSS, UI markup |
| `GameSpace.js`, `mesh.js`, `post.js` | engine helpers (same as jade-pavilion) |
| `shaders.js` | scene shaders |
| `maps.js` | ASCII maps, parsing, BFS routes, wave scripts, SVG previews |
| `defs.js` | tower / enemy / difficulty definitions |
| `scene.js` | static valley: terrain, road, water, trees, hills, Keep, Rift |
| `models.js` | towers, enemies, projectiles, health bars (per frame) |
| `game.js` | simulation: waves, enemies, towers, targeting, projectiles, economy (no rendering) |
| `audio.js` | Web Audio sfx + ambience |
| `main.js` | rendering, camera, input, UI glue |

## 9. Debug URL parameters
`?map=riverbend` `?diff=heroic` `?autoplay` (bot builds & upgrades) `?speed=4` `?wave=9` (start wave) ·
`window.__keep()` returns a state snapshot.

## 10. Progress log
- v1: design written, then implemented in full (3 maps, 4 towers × 3 levels, 5 enemies + boss, economy,
  difficulties, UI shell, audio, title-screen demo battle).
- **Balance** was tuned with a headless Node simulation (game.js has no rendering): a greedy bot that builds
  on the best-coverage plots and upgrades with spare gold. Final results (3 runs each):
  Casual — flawless on all maps · Normal — wins, 0–3 lives lost (Amber/River), ~half lives lost on Twin Gates ·
  Heroic — wins with 6–9/10 lives on Amber/River, usually loses on Twin Gates (the expert challenge).
  To re-check after changing numbers: copy the bot from `main.js` (`bot.step`) into a Node script that loops
  `game.update(1/30)`.
- Visual pass: haze pushed back, brighter sun, greener plots, per-plot seams (a board-wide underlay hid the
  river), enemies drawn ×1.25–1.6 through a scaling proxy (`Scaled` in models.js), no trees between camera
  and board.
- Portrait screens (aspect < 0.85) turn the camera 90° (`baseYaw`) and look more top-down, so the long side
  of the board runs up the phone; verified at 390×844.
- Testing note: in headless Chrome the first key event only focuses the page; real players click Play first.

### Ideas for later
- Tower specialisations at level 3 (two branches), hero unit, more maps (map editor from ASCII), endless mode,
  achievements. Arcade home-page registration needs edits outside this folder — ask the repo owner.
