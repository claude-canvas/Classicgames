# Sky Labyrinth — design & hand-off document

> A tilt-maze in the sky. You tilt a carved stone tablet that floats above a sea of sunset clouds and roll a
> glass marble through its corridors, past holes that drop straight into the sky, to a glowing well.
> 24 hand-made levels on four floating isles: Dawn Terrace, Frost Spire, Clockwork Garden and Ember Ruins.
> Built on the arcade's own `Space.js`. Everything lives in `public/sky-labyrinth/`; do not edit outside it.

## 1. Core loop
- **Tilt the board.** Mouse: move the pointer around the board's centre; distance from the centre sets the tilt.
  Touch: drag anywhere like a virtual stick. Lifting the finger levels the board. Keyboard: WASD or the arrow
  keys. On phones there is an optional motion-control setting that uses the device orientation.
- **Physics.** The marble rolls with acceleration `G · sin(tilt)` and has rolling resistance. It bounces off
  walls with restitution 0.35. Physics substeps keep it from tunnelling through walls.
- **Goal.** Reach the golden well (G) and the marble spirals in.
- **Holes (O).** A hole has a lip: near the rim the marble is pulled toward the centre, and once its centre is
  deep enough it drops into the sky. You then respawn at the last checkpoint lantern you touched (c), or at the
  start (S).
- **Gems (\*).** Each level has three floating crystals.
- **Stars, one each for:**
  - ★ finishing the level;
  - ★ collecting all 3 gems;
  - ★ finishing within the par time. Par is measured from a bot run plus a margin; see section 6.
- Falls do not end the run, but they cost time, and so the par star.

## 2. Tiles (`levels.js` ASCII, one char per 1×1 cell)
| char | tile | behaviour |
|---|---|---|
| `#` | wall | stone block, 0.6 high, gold-inlaid top |
| `.` | floor | carved stone tiles |
| ` ` | void | no board: open edge, the marble falls off |
| `S` | start | spawn point (also the default checkpoint) |
| `G` | goal | glowing well |
| `O` | hole | lipped hole into the sky |
| `*` | gem | floating crystal (exactly 3 per level) |
| `c` | checkpoint | lantern; touching it sets your respawn point |
| `~` | ice | almost no friction, glassy blue |
| `:` | moss | heavy friction, slows the marble |
| `> < ^ v` | boost | chevrons push the marble hard in that direction |
| `k` | switch | brass pressure plate; opens every gate on the level for good |
| `=` | gate | brass portcullis; acts as a wall until a switch is pressed, then sinks |
| `b` | bumper | brass post that kicks the marble away |
| `x` | crumble | cracked tile; 0.7 s after the marble first touches it, it falls away. Resets on respawn |

Board local coordinates: cell `(c, r)` is centred at `x = c − (W−1)/2`, `y = (H−1)/2 − r`. The floor is at
`z = 0`, and row 0 is the far side, away from the camera.

## 3. Physics (`physics.js`, pure, shared with the Node bot)
- Marble radius R = 0.26.
- Acceleration: `G = 26 · sin(tilt)` per axis. Maximum tilt is 0.17 rad.
- Rolling resistance: `v −= v · k · dt`, where k is 0.45 on floor, 0.05 on ice and 3.2 on moss.
- Boost tiles add 16 u/s² in their direction. Speed is capped at 11 u/s.
- Collisions:
  - walls and closed gates: circle against AABB;
  - bumpers: circles with a radius of 0.3 that add a 4.5 u/s kick.
- Holes: radius 0.38. Within the hole radius the marble is pulled toward the centre. It falls when its distance
  from the centre is below 0.25.
- `Sim.step(dt, tx, ty)` returns events: `hit{s}`, `gem{i}`, `check{i}`, `switch`, `bump`, `boost`, `fall`,
  `goal`, `crumble{i}`, `respawn`.

## 4. Presentation (WebGL1 via Space.js + custom shaders + bloom)
- The whole tablet is drawn with a model matrix (uniform `uModel`) so it visibly tilts. The scenery and sky
  use the identity matrix.
- Sky (BG shader):
  - the sky has a gradient and a low sun;
  - below the horizon there is an infinite **sea of clouds**: ray–plane intersection plus fbm, lit by the sun
    and with a rim of light.
- Board:
  - The floor shader draws engraved tile patterns in board-local coordinates.
  - **Real shadows:** the floor fragment shader ray-marches a W×H height texture of walls and gates toward the
    sun, which gives crisp, soft-edged wall shadows that move as the board tilts. It also does an analytic
    ray–sphere test for the marble's shadow.
- Marble: glass with Fresnel sky reflection, a sun glint and a coloured cat's-eye swirl that rolls with the ball
  (rotation matrix integrated from velocity). A coloured caustic glow lies on the floor next to it.
- Holes: a gold lip ring and a dark shaft. Goal: a gold well with a column of light and orbiting motes.
- Gems: spinning faceted crystals with glow. Ice: crystalline gloss. Moss: soft green.
- Boosts: animated chevrons. Bumpers: brass posts that flash when hit. Gates: brass bars that sink.
  Crumble tiles: cracks, a shake, then a fall.
- Scenery:
  - distant floating islands with trees and waterfalls;
  - birds gliding;
  - drifting petals or snow or embers, depending on the isle.
- Each isle has its own palette (sky, sun, stone):
  - Dawn: rose and gold;
  - Frost: icy blue morning;
  - Clockwork Garden: golden afternoon;
  - Ember: violet dusk with embers.

## 5. UI
- **Title:** logo, Play (continues at the next unbeaten level), Levels, Settings.
- **Level select:** four isle cards. Each card has 6 level buttons with stars; levels unlock in sequence.
- **HUD:**
  - level name and number;
  - timer, with par shown;
  - three gem slots;
  - fall counter;
  - tilt gimbal widget;
  - pause and restart buttons.
- **Level complete:** stars pop in one by one, then time vs par, gems, falls, and Next / Retry / Levels.
- **Settings:** sound, music, tilt sensitivity, invert, motion controls. Progress is saved in localStorage under
  `skylabyrinth.save`.

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue, same as the other games) ·
`shaders.js` · `levels.js` (maps + palettes) · `physics.js` (sim) · `board.js` (tablet geometry) · `scene.js`
(sky islands) · `audio.js` · `main.js` (loop, input, camera, UI).

Verification: a Node bot (scratchpad `lsim.mjs`, not shipped) runs a fine-grid BFS through all gems to the
goal and steers with a PD controller using the real `physics.js`. Every level must be completed by the bot;
par = bot time × 1.25 + 3 s, rounded.

## 7. Debug
- `?level=N` jumps straight to level N.
- `?bot` lets an autopilot play: main.js carries a small copy of the bot controller.
- `window.__sky()` returns the current state.

## 8. Progress log
- v1 complete: physics, 24 levels, 4 isles, title / level select / HUD / complete / pause / settings, audio.
  - Every level is validated by the Node bot, which collects all 3 gems and reaches the goal. Pars in
    levels.js come from that bot.
  - Verified in headless Chrome: the title, level 2 and level 9 played by the bot, at 60 fps.
- Performance note: the uber-shader took 6.5 s to compile on D3D. It is now about 2.4 s:
  - floor and ice share one shadow march;
  - the height texture is read with explicit LOD (EXT_shader_texture_lod);
  - cloud lighting is cheaper.
  If the shader grows further, split it into one program per material group. Add `?perf` to the URL to log
  the compile time.
- Visual tuning: bloom only from the sun and emissives (cloud bloom washed out everything), a saturation
  boost in tone(), contrasting wall colour per isle, dark hole shafts with a dim cloud window.
