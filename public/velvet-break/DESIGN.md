# Velvet Break — design & hand-off document

> 8-ball pool in 3D: a deep-teal felt table with walnut rails and brass pockets in a midnight lounge lit by a
> low lamp. Real ball physics, rolling numbered balls, an aiming guide with ghost ball and deflection lines,
> pull-back power, cue-ball spin, a CPU opponent (3 levels), local 2-player and practice.
> Built on the arcade's own `Space.js`. Everything lives in `public/velvet-break/`; do not edit outside it.

## 1. Rules (simplified WPA 8-ball)
- 15 balls racked in a triangle, 8 in the middle; the cue ball breaks from the head string.
- Groups (solids 1–7 / stripes 9–15) are assigned by the first legal pot after the break.
- Pot one of your balls legally → shoot again. Otherwise the turn passes.
- **Fouls** → opponent gets **ball in hand** (place the cue ball anywhere free):
  cue ball potted · first ball hit is not your group (or not the 8 when you're on it) · nothing hit at all.
- **Win**: pot the 8 after clearing your group, without fouling. Potting the 8 early or with a foul loses.

## 2. Physics (`physics.js`, pure)
- Units: world = metres × 10. Table playing area 25.4 × 12.7, ball radius 0.286.
- Fixed sub-steps (240 Hz). Rolling deceleration `ROLL = 2.2 u/s²` and a little extra at low speed so
  balls settle. Ball–ball: equal-mass elastic with restitution 0.95. Cushions: line segments (with angled
  pocket jaws), restitution 0.78. Pockets: ball centre within the pocket radius → potted.
- Spin: top/back spin adds a follow/draw impulse along the shot line after the cue ball's first contact;
  side spin skews the cushion rebound and throws a little after contact.
- Visual rotation: each ball keeps an orientation quaternion, rolled by `|v|·dt / r` about `up × v`.

## 3. CPU (`ai.js`)
Ghost-ball aiming: for each own ball × pocket, the cue must hit the ghost position `ball − dir·2r`.
Rejects blocked paths and cut angles > 72°. Scores shots by cut angle and distances, picks the best;
aim noise and power error by difficulty (Easy 3.2°, Normal 1.3°, Hard 0.45°). No pottable shot → a safe
roll into its nearest ball. Ball-in-hand: places the cue ball for its best shot.

## 4. Presentation
- Balls: textured spheres from a canvas atlas (solid colours / white with a colour stripe, number disc),
  glossy clear-coat with lamp reflection; the cue ball has a red dot so spin is visible.
- Table: felt with subtle nap, walnut rails with inlaid diamonds, brass pocket rings, leather pockets.
- Room: dark panelled lounge, a green-glass lamp over the table (key light), bokeh, a sofa silhouette.
- Camera: **Aim view** (low, behind the cue ball, follows the aim) and **Table view** (overhead);
  after a shot it eases to a high ¾ view to watch the balls, then back.
- Aim guide: dotted line to the ghost ball, then the object ball's path and the cue's deflection.

## 5. UI
Title (logo, modes, CPU difficulty, stats) · HUD: two player cards (avatar, name, group, remaining ball icons,
active glow), turn banner, foul toast, power cue (drag down & release; Space to charge), spin ball (drag the
dot), view toggle, pause · Modals: pause, how to play, settings, game over (winner, stats, rematch).

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine helpers) · `shaders.js` ·
`physics.js` (table geometry, simulation) · `rules.js` (8-ball state machine) · `ai.js` · `balls.js`
(atlas + sphere mesh) · `scene.js` (table & room) · `audio.js` · `main.js`.

## 7. Debug
`?mode=cpu|duo|practice` `?cpu=hard` `?autoplay` (CPU plays both sides) `?speed=3` · `window.__pool()`.

## 8. Progress log
- v1: implemented in full. physics.js/rules.js/ai.js are pure: 36 CPU-vs-CPU games were simulated in Node
  (all finished; pots per shot Easy 0.42 · Normal 0.53 · Hard 0.70; ~4.5 s per shot to settle).
- Balls use a packed smooth normal (pos.w + col.b) so they render perfectly round with 12×22 segments.
- Verified in headless Chrome (GPU): title, CPU-vs-CPU autoplay with groups assigned, aim view, HUD.
