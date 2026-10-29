# Storm Beacon — design & hand-off document

> You are the lighthouse keeper on a storm-lashed headland. Ships come out of the dark toward the harbour, and
> the reefs between are invisible to them. Sweep the great beam across the heaving sea: a ship caught in the
> light finds its bearings and steers for the safe channel. A ship left in the dark drifts with the storm onto the
> rocks. Use the fog horn to hold ships back, read the lightning, and bring every crew home.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/storm-beacon/`; do not edit outside it.

## 1. Core loop
- Each **night** sends a number of ships, which spawn over time at the horizon (y ≈ 650–900, x ±500). They head
  for the harbour mouth (around x = −170, y = 60) through a route of channel buoys.
- **Blind and lit ships:**
  - Each ship carries a **bearing error**: a heading offset that random-walks and grows while the ship is
    *unlit*.
  - The storm **current** sets the whole sea drifting sideways (`night.current`).
  - A ship inside the beam cone is **lit**. Its bearing error decays fast, and it steers for its next waypoint.
    The light also persists as "confidence" for a few seconds after the beam moves away.
- **Wrecks:**
  - **Reefs** are clusters of rocks (circles of radius r). A ship that enters one is **wrecked**: it lists, sinks
    and burns flares, and you lose one of 3 lives (life rings).
  - Reefs are visible only faintly: their breaking surf, the lightning flashes, and the beam.
- **Saving:** a ship that passes the harbour mouth is *saved* and scores points. A fast arrival with a high
  bearing error does not lose points, so saving is all that matters. The combo grows with consecutive saves.
- **Fog horn:** press Space or the HORN button. Every ship within 380 m of the lighthouse slows to a crawl for
  4 s; the cooldown is 9 s. The horn is used to triage when two ships need light at once.
- **The beam:**
  - The mouse or finger points at a spot on the sea. The heavy lens turns toward it with a limited angular speed
    and acceleration, which gives it inertia.
  - The beam's reach is 40–700 m. Its cone is 5° wide.
  - While the keeper holds the mouse button, or the FOCUS button, the beam narrows to 3° and reaches further, with
    a stronger effect.
- **Lightning:** strikes at random intervals. The whole sea lights for about 0.25 s, revealing the reefs, and
  thunder follows.
- **End of night:** when all ships are resolved. You win the night if wrecks < 3. Stars: 3 for no wrecks, 2 for
  1 wreck, 1 for 2.

## 2. Nights (`levels.js`)
| # | Name | Ships | Storm | Current | Notes |
|---|------|------:|-------|---------|-------|
| 1 | Squall | 5 | light | weak | One ship at a time; the tutorial. |
| 2 | Gale Warning | 8 | moderate | east | Two ships overlap. |
| 3 | The Narrows | 10 | moderate | west | A reef field splits the approach. |
| 4 | Fishing Fleet | 14 | strong | east | Small fast boats in groups. |
| 5 | Black Squall | 16 | violent | gusting | Rain cuts the beam's reach and lightning is frequent. |

## 3. Sea & weather (`shaders.js`, `scene.js`)
- **Waves:**
  - The ocean is a big static grid displaced **in the vertex shader** by 5 Gerstner waves, with the amplitude
    set by `uStorm`.
  - Normals are computed analytically and passed to the fragment shader.
  - Foam forms on the crests and around the reefs, where it is more noise-driven.
  - The water picks up reflections from the beam and the town lights, and a sub-surface glow where the beam hits.
- **The beam:**
  - An additive volumetric cone mesh, rebuilt each frame. It gets brighter near the lens and carries
    noise-modulated rain sparkle.
  - The fragment shader also adds a spotlight: the uniforms `uBeamPos`, `uBeamDir` and `uBeamCos` light the sea,
    the ships and the rocks inside the cone.
- **Sky:** a dark churning cloud deck done in the shader with fbm and moving clouds. The underside is lit by the
  lightning (`uFlash`) and the beam's sweep.
- **Rain:** about 900 streaks around the camera, slanting with the wind.
- **Spray:** spray bursts where waves hit the rocks.
- **Lightning:** a forked bolt mesh is generated per strike and flashes white, with `uFlash` on the whole scene
  plus a post-process flash.

## 4. World
- **The headland:**
  - The lighthouse sits on a rocky headland at the origin, with the cliff top at z = 22.
  - The tower is 28 m tall, white with red bands, tapering, with a gallery railing and a lantern room. The lens
    is a rotating glass prism.
  - A keeper's cottage with warm windows stands on the cliff.
- **The harbour town** lies to the west, around x = −220. It has a breakwater, a pier with lamps, a jumble of
  houses with lit windows, and a church.
- **Channel buoys:** blinking red (port side) and green (starboard) buoys mark the safe channel. Their lights
  bob with the waves.
- **Reefs:** jagged rock clusters breaking the surface, ringed with foam.
- **Ships:**
  - fishing boats, small and fast;
  - coasters, medium;
  - a schooner with sails;
  - a steamer, slow and big, with a smokestack.
- **Ship details:**
  - each has nav lights (red to port, green to starboard), a white masthead light and lit portholes;
  - each pitches and rolls on the waves (the wave height is sampled from the same Gerstner sum on the CPU);
  - wrecked ships list, sink and fire red distress flares.

## 5. Camera
- Behind and above the lantern room, looking out to sea (third person, with the lighthouse in the bottom of the
  frame).
- The camera eases toward the beam's direction so the action stays framed, with slight shake in strong gusts.
- `C` toggles a high overview of the whole bay.

## 6. UI
- **Title:** logo over the storm with the lighthouse sweeping, Play, Nights (a grid of cards) and Settings.
- **HUD:**
  - the night name;
  - ships saved / total;
  - 3 life rings;
  - the horn cooldown dial;
  - off-screen ship indicators at the screen edge. These pulse red when a ship is near a reef.
- **Popups:** "Saved +100", "Wrecked!" and combo popups.
- **End-of-night card:** stars, saved and wrecked counts, score, next night.
- **Settings:** sound, music, rain density.
- **Save:** `stormbeacon.save` (stars, best, unlocked).

## 7. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue from lantern-bow) · `shaders.js` ·
`waves.js` (the CPU Gerstner sum shared with ship motion) · `scene.js` · `ships.js` · `levels.js` · `audio.js` ·
`main.js`

## 8. Debug
- `?auto`: the beam bot sweeps to the ship at most risk.
- `?night=N` starts on night N.
- `window.__storm()` returns the current state.

## 9. Progress log
- v1 (2026-10-19): complete and playable.
  - 5 nights: a Gerstner sea in the vertex shader, a spotlight beam (both as a shader light and as a volumetric
    cone), lightning bolts and flashes, rain that glitters in the beam, reef surf rings, ship models (fishing,
    coaster, schooner, steamer), wrecks with flares, buoys, the harbour town, the horn, edge markers and the bot.
  - **Balance:**
    - It was checked headless (scratchpad `sbsim.mjs`): with no light, most ships wreck; a simple beam bot without
      the horn saves almost all of nights 1–3 and loses about 3 on nights 4–5.
    - Nights 4–5 therefore get 4 lives.
    - Blind drift is `0.42·storm` rad/√s, and confidence decays over about 9 s.
  - **Shader note:** `skyCol` (fbm clouds) is used only by the sky and the sea reflection; fog and the small
    reflections use `skyLite`, which keeps the shader compile time down.
  - Debug: `?auto&speed=3`, `?night=N`.
