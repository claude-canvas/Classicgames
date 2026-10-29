# Prism Garden — design & hand-off document

> A light-routing puzzle on a floating island garden at night. Crystal obelisks shoot coloured beams of light.
> Rotate bronze mirrors, place half-silvered splitters, and let glass prisms fan white light into red, green and
> blue so that every lotus lantern receives exactly the colour it longs for. When all of them bloom, the island
> wakes in fireflies and the next island drifts in.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/prism-garden/`; do not edit outside it.

## 1. Rules (`logic.js`, pure, shared by the solver)
- **Grid:** each island is a W×H grid of tiles. Some cells are void (no tile); beams cross void freely.
- **Directions:** 0 = north (+y), 1 = east (+x), 2 = south, 3 = west.
- **Colour:** a 3-bit RGB mask (R = 1, G = 2, B = 4). W = 7, Y = R+G, M = R+B, C = G+B.
- **Pieces:**
  - **Emitter** `{t:"emit", d, c}`: fires colour `c` in direction `d`. It blocks beams that hit it. With `rot: true`
    the player can turn it to any of the 4 directions.
  - **Mirror** `{t:"mirror", r}`: r = 0 is "/" (E↔N, W↔S) and r = 1 is "\\" (E↔S, W↔N). It is rotatable unless
    `fixed`.
  - **Splitter** `{t:"split", r}`: a half-silvered pane. The beam passes straight through **and** reflects like a
    mirror of the same orientation.
  - **Prism** `{t:"prism"}`: G continues straight, R turns left (d+3) and B turns right (d+1). Only the
    components present in the input come out.
  - **Filter** `{t:"filter", c}`: passes only `input & c`. Nothing comes out if the result is 0.
  - **Rock** `{t:"rock"}`: blocks.
  - **Target** `{t:"target", c}`: a lotus lantern. It absorbs every beam entering from any side and ORs the
    colours. It is **satisfied when the OR equals `c` exactly**, so a stray extra colour spoils it.
- **Tracing:** a beam is traced from each emitter cell by cell. The state `(x, y, dir, colour)` is memoised so
  loops terminate. Beams pass through each other, so crossing is fine.
- **Inventory:** some islands give spare mirrors or splitters to place on empty tiles. Clicking a placed piece
  rotates it; dragging it back to the tray removes it.
- **Moves:** each rotate or place counts as one move. The solver gives `par`, the minimum number of moves from
  the scrambled start. Stars: ★★★ ≤ par, ★★ ≤ par + 3, ★ when solved.

## 2. Solver (`solver.js`, also used offline to validate levels)
- It searches over each rotatable piece's state and over the cells and orientations for each inventory piece.
- For pieces that start scrambled, the cost of a solution is the number of pieces changed from their start state
  plus the pieces placed.
- Levels are authored as an intended solution plus a scramble; the solver confirms solvability and computes `par`.

## 3. Islands (`levels.js`)
24 islands in 4 groves of 6:
1. **Dawn Grove:** mirrors only, single colours. Teaches rotation.
2. **Mirror Pool:** splitters and placed inventory, several targets per beam.
3. **Prism Hollow:** white light, prisms and filters; exact-colour targets.
4. **Starfall Terrace:** everything together, rotatable emitters, crossing beams, bigger boards.

## 4. Presentation
- **World:**
  - The island is built from stone tiles with mossy edges.
  - A tapering rocky underside hangs below, with roots and small waterfalls spilling off the edge into the void.
  - Distant floating islets drift slowly.
- **Sky:** deep indigo, with a nebula band, twinkling stars, a big pale moon, and slow-drifting cloud wisps below
  the island (sea of clouds).
- **Beams:** additive camera-facing ribbons at a height of 0.55 m in the beam colour.
  - The core is white-hot and the halo is wide.
  - Sparkle motes travel along each beam.
  - Flares sit at reflection points.
  - The beams light the tiles they cross (a light pool on the floor).
- **Pieces:**
  - emitters are crystal obelisks with a pulsing coloured core;
  - mirrors are round bronze mirrors on stone pedestals; they turn with an eased animation and a chime;
  - splitters are tinted glass panes in bronze frames;
  - prisms are tall triangular glass prisms;
  - filters are coloured stained-glass gates;
  - rocks are mossy boulders.
- **Lotus:** pale petals, closed and dim. When satisfied it **blooms**: the petals open, it glows in its colour,
  and a ring of light rises from it. A wrong colour makes it flicker and shiver.
- **Win:** every lotus pulses, fireflies burst, a chord plays, and the island lifts away as the next one rises.
- **Camera:** an orbit around the island (drag to orbit, wheel or pinch to zoom). Tapping a tile selects or
  rotates its piece.

## 5. UI
- **Title:** logo over a slowly orbiting finished island, with Play, Islands (a grid of 24 with stars) and Settings.
- **HUD:**
  - island name;
  - moves and par;
  - Undo, Reset and Hint (the hint highlights one piece that is in the wrong state, according to the solver);
  - an inventory tray with draggable pieces;
  - the colour legend for the targets.
- **Win card:** stars, moves, next.
- **Save:** `prismgarden.save` (stars per island, unlocked).

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `logic.js` ·
`solver.js` · `levels.js` · `scene.js` · `audio.js` · `main.js`

## 7. Debug
- `?level=N` starts on island N.
- `?auto` lets the solver play each island.
- `window.__prism()` returns the current state.

## 8. Progress log
- v1 (2026-10-19): complete and playable.
  - **24 islands, generated and verified:** the levels are not hand-drawn. Scratchpad `pggen.mjs` builds solved
    boards from random beam walks (mirror corners, splitters, prisms, filters, decoys, rocks, corner voids),
    scrambles the rotatable pieces, and keeps a board only if `solver.js` finds it with par in the target range
    for its slot.
  - **Output:** levels.js is written with `par` and an optimal `sol`, which Hint and `?auto` use. To make new
    islands, edit the GROVES params in pggen.mjs and re-run it.
  - **Features:**
    - inventory placement (tap a tray piece, then a tile; right-click a placed piece to take it back), undo,
      reset and hint;
    - stars against par, and the island lifting away on a win;
    - fireflies and lotus blooming;
    - mirror diagonal inlays on the tiles, so orientation is readable edge-on; fixed mirrors are iron-grey.
  - **Verified:** the `?auto` bot solves islands 1–12 at par in a headless run.
