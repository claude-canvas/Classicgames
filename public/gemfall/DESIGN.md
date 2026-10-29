# Gemfall — design & hand-off document

> A 3D match-3 puzzle. Faceted jewels sparkle on a velvet board inside a jeweller's atelier at night.
> Swap neighbours to line up three or more; bigger shapes forge special gems; cascades chain into combos.
> A 30-level journey with goals, limited moves, boosters and stars. Built on the arcade's own `Space.js`.

Everything lives in `public/gemfall/`; the only outside file used is `../Space.js` (imported, never modified).
**Do not edit files outside this folder.**

## 1. Rules
- Board up to 8×8; some levels mask cells out (each column's playable cells are contiguous, so gravity works).
- Swap two orthogonal neighbours. The swap is kept only if it makes a match (or involves a special); otherwise
  the gems swap back.
- Matches: 3+ in a row/column clear. Shapes create specials at the swapped cell (or the run's middle):
  - 4 in a line → **Line gem** (glowing bands) — clears its whole row (horizontal run) or column (vertical run).
  - L / T shape → **Bomb gem** (pulsing core) — clears a 3×3 area (5×5 when combined with another bomb).
  - 5 in a line → **Prism** (a rainbow star, colourless) — swap it with any gem to clear every gem of that colour.
  - Special + special swaps combine (line+line = cross, line+bomb = 3-wide cross, prism+X = convert all of X's colour into X's special and fire them, prism+prism = clear the board).
- Cascades: after gravity, new matches clear automatically; each cascade step raises the multiplier.
- **Frost tiles**: ice under a gem (1 or 2 layers); a match/blast on that cell cracks one layer.
- No moves left → automatic reshuffle (free).

### Scoring
3-match 60 · 4: 120 · 5: 200 · each special-blasted gem 20 · frost layer 40 · cascade multiplier `1 + 0.5·step`.
Leftover moves at the end each fire a random line gem ("Gem rush") for bonus points.

### Goals (per level, any combination)
- Reach a **score**.
- **Collect** N gems of given colours.
- **Clear all frost**.
Stars by score: ★ goal met · ★★ ≥ target₂ · ★★★ ≥ target₃.

### Boosters (per level)
- **Hammer** (2): smash one gem (no move used).
- **Shuffle** (1): rearrange the board.
Hint: after 6 s idle a valid swap gently pulses.

## 2. Levels (`levels.js`)
30 generated from a table: moves, colours (5 → 6), board mask (full, cross, diamond, hourglass, ring...),
goals, frost layout. Progress saved in `localStorage["gemfall.save"]` = `{ stars: {level: n}, best: {level: score}, settings }`.

## 3. Presentation
- Gems: six distinct **shapes** as well as colours (accessible): Ruby (round brilliant), Sapphire
  (emerald-cut rectangle), Emerald (square step cut), Topaz (pear/teardrop), Amethyst (heart / triangular
  trillion), Diamond (tall octahedron). Flat-shaded facets, fake studio environment reflection, fresnel,
  inner glow, sparkle sprites, bloom.
- Board: dark velvet cells in a gold-inlaid lacquer frame; frost tiles are translucent glowing ice.
- Atelier backdrop: deep gradient, soft bokeh lights, a loupe and gold tools on the table edges.
- Animations: swap tween, invalid swap wobble, pop (scale-up + shards), gravity with bounce, specials'
  beams/shockwaves, combo callouts ("Sweet", "Brilliant", "Dazzling", "Legendary").
- Camera mostly top-down (slight tilt), fitted to the screen; portrait works.

## 4. UI (`index.html`)
Title → **Journey map** (winding path of 30 nodes with stars, current node pulsing) → **Level card** (goals,
moves, stars needed, Play) → **HUD** (moves, goal chips with progress, score bar with 3 star ticks, boosters,
pause) → **Result** (stars, score, best, next / retry). Settings: sound volume, hints on/off.

## 5. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine helpers shared by the arcade's newer games)
· `shaders.js` · `gems.js` (gem meshes) · `board.js` (pure rules: matching, specials, gravity, shuffle) ·
`levels.js` · `audio.js` · `main.js` (animation, rendering, input, UI).

## 6. Debug
`?level=12` jump to a level · `?autoplay` the bot takes the best-scoring swap · `window.__gem()` snapshot.

## 7. Progress log
- v1: implemented in full. board.js is pure, so all 30 levels were simulated in Node with a greedy bot
  (6 runs each) to calibrate star thresholds (`SCORE_PER_MOVE` × moves × board-size factor) and goal sizes;
  frost/mixed levels get +6 moves. Early levels: bot wins 6/6; late frost levels are genuinely hard (1–5/6).
- Rendering note: board.js resolves a move instantly, so main.js draws from its own `vis` map (gem → visual
  state) and only removes a gem when its clear step finishes; never draw straight from `board.cells`.
- Verified in headless Chrome (GPU): title, journey, level card, live play with ?autoplay, Gem Rush, result.
