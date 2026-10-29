# Frost Stone — design & hand-off document

> Curling on a frozen alpine lake at night under the aurora. Slide polished granite stones down a lantern-lit
> sheet of ice, choose their curl, and sweep to carry them into the house. You play against a CPU skip over four
> ends.
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/frost-stone/`; do not edit outside it.

## 1. Rules (simplified real curling)
- **Sheet:** 4.75 m wide.
  - The thrower releases at y = 0.
  - The far hog line is at y = 30.
  - The house (target) is centred on the button at y = 36. Its rings have radii 1.83, 1.22 and 0.61 m, plus a
    0.15 m button.
  - The back line is at y = 37.83.
- **An end:** each side throws 4 stones, alternating; the side that did not score last throws first.
- **Scoring an end:** only one side scores. Count your stones in the house that are closer to the button than the
  opponent's closest stone.
- **Removed stones:** a stone that stops short of the far hog line, touches a side boundary, or passes the back
  line is removed.
- **Match:** four ends; the highest total wins. A tied match goes to one extra end.

## 2. Throw (three steps)
1. **Aim:** drag left/right, or use the arrow keys, to set the line. A dotted guide shows the start of the path.
2. **Curl:** tap ↺ or ↻, or press Q/E. An in-turn makes the stone curl right and an out-turn makes it curl left.
3. **Weight:** press and hold. A power meter rises and falls; release to throw. The meter has zones: guard,
   draw, takeout.
- **Sweep:** after release, hold the mouse or Space to sweep in front of the stone. Sweeping lowers friction
  (−25 %, so the stone carries further) and straightens the curl (−40 %). The camera follows the stone.

## 3. Physics (`physics.js`, pure, shared by the AI)
- **Stone:** radius 0.145 m.
- **Friction:** deceleration 0.105 m/s² on fresh pebble, 0.079 m/s² while swept.
- **Curl:** lateral acceleration `a = 0.0175 · spin / (v + 0.35)`, so the stone curls more as it slows down, as
  real stones do. Sweeping scales it by 0.6.
- **Collisions:** stone-to-stone with equal masses and restitution 0.9. A small rotational kick from the
  collision is ignored.
- **Stepping:** fixed 1/240 s steps.
- **Initial speed:** a draw to the button needs about 2.6 m/s, a takeout about 3.3–3.8 m/s.

## 4. CPU skip (`ai.js`)
- **Candidates:**
  - draws to the button and to the four quadrants;
  - guards;
  - takeouts of each opponent stone in or near the house;
  - raises (bumping its own stone).
- **Search:** each candidate tries both spins with an aim and weight search, every candidate is simulated with
  the real physics, and the end state is scored:
  - +10 for its own shot stone;
  - +4 for each extra counting stone;
  - −8 for each counting opponent stone;
  - guards in front of the house are valued more when the CPU is ahead.
- **Difficulty:** Gentle, Steady or Sharp, which set how much Gaussian noise is added to aim and weight.

## 5. Presentation
- **Ice:** reflective, showing the sky and the aurora. The stones and lanterns are mirrored into it (they are
  drawn flipped below the surface, and the ice is blended over them). There is a pebble sparkle, the house rings
  are painted under the ice, and swept paths leave a glossy streak.
- **Stones:** polished speckled granite with a red or yellow handle and a striking band. They cast soft contact
  shadows.
- **Setting:**
  - a frozen lake ringed by snowy pines;
  - two rows of paper lanterns on posts along the sheet;
  - a wooden warming hut with lit windows near the house;
  - layered snowy mountains under a starry sky;
  - **animated aurora curtains** (green and violet, done in the shader);
  - falling snow;
  - ice shavings kicked up while sweeping.
- **Camera:**
  - behind the hack while aiming;
  - follows the stone during delivery;
  - drops to a low top-down view over the house when the stones settle;
  - a scoring overlay highlights the counting stones.
- **Audio:**
  - the stone rumbling along the ice, with its pitch rising with speed;
  - a granite clack on collisions;
  - brush strokes while sweeping;
  - wind, and a soft aurora hum;
  - chimes for points.

## 6. UI
- **Title:** logo, Play vs CPU (difficulty) and Practice (throw freely, no opponent).
- **HUD:**
  - scoreboard by end;
  - stones left per side as handle icons;
  - whose turn it is;
  - throw step prompts;
  - power meter with zones;
  - curl buttons;
  - Sweep button on touch.
- **End summary:** an overlay of who scored and how many. **Match result:** a win or loss modal.
- **Settings:** sound, music and the aim guide. Progress (wins) is saved as `froststone.save`.

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` · `shaders.js` · `physics.js` · `ai.js` ·
`scene.js` · `audio.js` · `main.js`

## 8. Debug
- `?auto`: both sides are played by the AI.
- `window.__curl()` returns the current state.

## 9. Progress log

- v1 (2026-10-19): complete and playable.
  - Match vs the CPU skip (3 difficulties, computed in a module worker), Practice, end scoring with the hammer
    rule, and an extra end on a tie.
  - Mirrored world under blended ice, aurora sky, lanterns as point lights, hut, pines, mountains, snowfall,
    brooms while sweeping, and a house minimap.
  - Stones travel 1.9× real time on the player's throws and 2.6× on the CPU's (real stones take about 25 s).
  - The weight meter is non-linear, so the DRAW zone is wide: zones HOG/GUARD/DRAW/HEAVY/TAKEOUT map to
    2.3–3.85 m/s.
  - Aim guide setting: off / curl (path at draw weight) / full (path at the current weight).
  - Shader note: only the sky and the ice reflection call `skyCol` (with the aurora); everything else uses
    `skyLite`. Inlining the aurora everywhere made ANGLE compile for about 6 s.
  - Debug: `?auto` (AI vs AI), `?play&mode=practice`, `__curl()` (state, plus `log` of each throw's outcome).
