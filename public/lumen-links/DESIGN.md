# Lumen Links — design & hand-off document

> Mini golf on a fairy-lit garden course at dusk. Nine holes wind between lantern-lined stone curbs, through a
> spinning windmill, over ramps and humps, past bouncing mushroom bumpers, around lily-pond hazards and through
> sliding garden gates. Drag back from the ball to aim and set power, then let go.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/lumen-links/`; do not edit outside it.

## 1. Physics (`physics.js`, pure, shared with the bot)
- **The ball:** radius 0.05 m (scaled up visually ×1.2). Its state is x, y, vx and vy; the height comes from the
  hole's height function.
- **Rolling:**
  - rolling resistance 0.55 m/s² on the green, 2.4 in sand, and 0.25 on the "glass" bridges;
  - slope gravity `a = −g·∇h·5/7` (a rolling sphere);
  - fixed step 1/240 s.
- **Walls:** segment lists with the ball's radius, restitution 0.72, and a small tangential loss. Moving walls
  (windmill blades, sliding gates) carry their velocity into the collision.
- **Bumpers:** circles with restitution 1.15 and a min kick speed of 1.5 m/s.
- **Cup:** radius 0.054. Inside the cup radius and slower than 1.3 m/s, the ball drops in. Faster, it lips out:
  it is deflected and keeps rolling.
- **Hazards:** water zones (polygons). The ball sinks and returns to its last resting spot, +1 stroke.
- **Out of bounds:** a ball outside the fairway polygon by more than 0.1 m (when walls have gaps) is treated the
  same as water.
- **Stopping:** the ball rests when its speed < 0.03 and the local slope can't move it.

## 2. Holes (`holes.js`)
Each hole has:
- the fairway outline polygon (walls auto-generated along its edges unless marked open);
- extra walls and obstacles (windmill, gate, bumper, ramp zones);
- a tee, a cup and a par;
- a height function (`slopes`: planar tilts, bumps as Gaussians, ramp rectangles);
- decorations (lanterns, mushrooms, bushes).

The nine holes:
1. **Lantern Lane:** a straight path with a gentle slope. Par 2.
2. **Dogleg Bend:** an L-shape with a bank shot. Par 2.
3. **Mushroom Ring:** bumpers guard the cup on a plateau. Par 3.
4. **The Windmill:** the classic spinning blades in front of a tunnel. Par 3.
5. **Lily Pond:** a water hazard in the middle; go around it or chip over the bridge. Par 3.
6. **Volcano:** the cup sits on top of a hump. Par 3.
7. **Garden Gates:** two sliding gates to time. Par 3.
8. **Switchbacks:** an S-curve down a hillside with banked turns. Par 3.
9. **Starfall Finale:** a ramp jump-gap with a loop-like bowl and the cup in a glowing star. Par 4.

## 3. Bot / validation (`bot.js`)
- Searches shot angle × power with the real physics.
- It picks the shot that ends nearest the cup (or holes it), with a robustness penalty: the shot is evaluated
  with ±1° and ±4 % jitter.
- Used offline to check that every hole is completable within par + 2, and by `?auto` for the attract mode.

## 4. Presentation
- **Course:** the fairway is lush green with mown stripes (a shader on world position) and a darker fringe.
  Curbs are pale stone with mossy tops and strings of warm fairy lights along them (bloom). Paper lanterns sit on
  posts.
- **Obstacles:** the windmill is a wooden tower with fabric sails; mushrooms are glowing caps that pulse when hit;
  the gates are wooden with brass.
- **Water:** lily-pad ponds with reflections of the lights. The ramp bridges are glass.
- **World:** each hole sits on a floating grassy island. The sky is a dusk gradient with stars and a crescent
  moon, and fireflies drift.
- **Ball:** pearl white with a soft glow and a trail. The cup has a flag with a lantern, and the flag lifts when
  the ball is near.
- **Camera:**
  - orbits the ball (drag on empty space to rotate, wheel/pinch to zoom);
  - follows the rolling ball;
  - a flyover of each new hole shows it before the tee shot.

## 5. UI
- **Title:** logo, Play (9 holes), Practice (choose a hole), Settings.
- **HUD:** hole number, par, strokes, power meter while dragging, and a scorecard button.
- **Hole-out popups:** Hole-in-one!, Eagle, Birdie, Par, Bogey.
- **Final scorecard:** total vs par. The best total is saved in `lumenlinks.save`.

## 6. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (engine glue) · `shaders.js` · `physics.js` ·
`holes.js` · `bot.js` · `scene.js` · `audio.js` · `main.js`

## 7. Debug
- `?hole=N` starts on hole N.
- `?auto` lets the bot play.
- `window.__golf()` returns the current state.

## 8. Progress log
- v1 (2026-10-19): complete and playable.
  - 9 holes, validated by the shot-search bot in scratchpad `lltest.mjs`: every hole is completable. The bot finds
    clever bank shots, often holing in 1–2.
  - **Course pieces:** windmill (a blade blocks the tunnel mouth for part of each quarter turn), sliding gates,
    mushroom bumpers (e = 1.15), pond with a glass bridge, volcano hump with a crater cup, sand on Switchbacks,
    pits + bridge on the Finale.
  - **Physics:** ball r = 0.06 (shown ×1.2), cup r = 0.068 with lip-outs above 1.3 m/s, rolling resistance
    0.55 m/s² (sand 2.4), walls e = 0.72.
  - **`?auto`:** the bot plays from `botworker.js` (3° × 22 powers, no robustness pass).
  - **Ball focus:** in practice mode, the camera's title orbit is centred between the tee and the cup.
