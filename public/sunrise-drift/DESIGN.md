# Sunrise Drift — design & hand-off document

> Pilot a hot-air balloon over a valley of fairy-chimney rock towers at sunrise, among a festival of dozens of
> other balloons.
>
> A balloon cannot be steered. You only choose **altitude**: burn to heat the envelope and climb, vent to sink.
> Each altitude has its own wind, so to reach a target you climb or sink into the layer that is blowing the way
> you want to go.
>
> Drop marker bags on the big cloth targets, then land gently in the landing field before the fuel runs out.
>
> Built on the arcade's own `Space.js` (GameSpace + custom shaders + bloom). Everything lives in
> `public/sunrise-drift/`; do not edit outside it.

## 1. Core loop
1. A flight starts with the balloon tethered on the launch field. The camera orbits it.
2. **Burn:** hold Space or the BURN button.
   - It heats the envelope: the temperature rises about 2.2 °C/s while burning.
   - The envelope cools toward ambient at a rate proportional to the temperature difference.
3. **Lift:**
   - Vertical acceleration is `a = g·(ρ_air/ρ_hot − 1) − m_load·g/m_total`, simplified to
     `a = K·(T − T_eq) − c·vz·|vz|`.
   - Because of thermal lag, the balloon responds with a delay of several seconds, so the player has to plan.
4. **Vent:** hold V or the VENT button. Opening the parachute vent cools the envelope fast and lets the balloon sink.
5. **Wind:**
   - Horizontal velocity eases toward `wind(z)`, the wind for the current altitude.
   - Wind is piecewise by layer, with smooth blending between layers.
   - Each flight defines 4–5 layers, each with a direction, a speed and a slow wobble.
6. **Marker:**
   - Press M or DROP to drop a weighted sandbag with a long ribbon.
   - It falls ballistically and drifts slightly with the low wind.
   - Score depends on the distance from the target's centre: 100 at 0 m, falling to 0 at 60 m.
   - There are 3 markers per target.
7. **Landing:**
   - You must land in the flight's landing field.
   - Vertical speed at touchdown: under 1.2 m/s is a soft landing (bonus); over 3 m/s is a hard bump (penalty).
   - Landing outside the field gives no landing points.
8. **Fuel:** burning uses propane; the gauge shows how much is left. With no fuel left you can only sink.

## 2. Flights (`levels.js`)
1. **First Light:** pre-dawn blue hour. 1 target with simple winds: east at low altitude, north higher up. This is
   the tutorial.
2. **Golden Valley:** sunrise. 2 targets, with a calm layer in the middle.
3. **Chimney Run:** 2 targets among dense rock towers. Collisions with towers make you bounce and lose points.
4. **The Box:** a classic "box" wind, where the low wind goes one way and the high wind the opposite way.
   3 targets laid out on a back-and-forth route.
5. **High Morning:** strong upper winds and 3 far targets with a limited fuel budget.
6. **Lantern Dusk:** evening, with lanterns rising from the villages. 3 targets, then land by the river.

Each flight sets:
- wind layers, targets, the landing field and fuel;
- time of day (sun direction and colours);
- star thresholds (3 stars).

## 3. Wind visualisation
- Each layer is shown by drifting **wind motes**: faint particles tinted per layer and moving with that layer's
  wind. This shows the player the "rivers" of air.
- An **altimeter strip** on the right side of the HUD:
  - layer bands, each with an arrow giving its direction relative to the camera, and its speed;
  - the balloon's altitude marker;
  - the vertical speed (variometer).
- A compass arrow points at the next target, with its distance.

## 4. World (`terrain.js`)
- Heightfield terrain, about 2.4 × 2.4 km:
  - a winding river valley;
  - soft tuff ridges and mesas;
  - patchwork vineyards and fields near the river;
  - a village of cube houses with lit windows;
  - poplar trees along the river.
- **Fairy chimneys:** tall cones of pale rock, each with a darker basalt cap, clustered in the valleys. These are
  the signature look.
- **Valley mist:** a layered fog at low altitude in the morning, which burns off as the sun rises.
- **Festival balloons:**
  - about 30 other balloons with varied striped and checker envelopes, drifting with the same wind layers at
    their own altitudes;
  - each has a burner flicker, and its reflection in the river is skipped;
  - they slowly launch from fields, which gives the world life.
- **Sky:** a sunrise gradient (or dusk), sun disc and glow, high cirrus done in the shader, and a mountain silhouette
  on the horizon.

## 5. Balloon (`balloon.js`)
- **Envelope:** a lathe of 16 gores in the classic teardrop shape, with alternating colour stripes. Each level
  can choose the player's pattern.
- **Glow:** the envelope glows from inside while burning (warm translucency, a strong bloom at dawn).
- **Basket:** wicker, hung on ropes. The burner frame has a blue-white flame when burning, and the flame is also a
  point light.
- **Camera:**
  - an orbit camera around the balloon: drag to rotate, scroll or pinch to zoom;
  - `C` toggles a basket view, first person looking out over the rim.

## 6. Scoring
- Target: 0–100 per target (the best of its markers).
- Landing: soft +60, normal +30, hard +0, outside the field +0.
- Fuel left: +1 per % left.
- Stars come from per-flight thresholds. Best scores and stars are saved in `sunrisedrift.save`.

## 7. UI
- **Title:** logo over a slow flyover of the festival, with Play, Flights (a grid of cards) and Settings.
- **HUD:**
  - task list (targets ✓);
  - fuel gauge;
  - envelope temperature;
  - altimeter and wind strip;
  - compass to the next goal;
  - BURN, VENT and DROP buttons on touch;
  - camera toggle.
- **Overlays:**
  - a "marker" result pop showing the distance and points;
  - a landing result;
  - the flight summary with stars.

## 8. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` (shared engine glue from lantern-bow) ·
`shaders.js` · `terrain.js` · `balloon.js` · `levels.js` · `audio.js` · `main.js`

## 9. Debug
- `?auto`: an autopilot flies the flight. It searches for the altitude whose wind points closest to the target
  and climbs or sinks to it.
- `?flight=N` starts on flight N.
- `window.__drift()` returns the current state.

## 10. Progress log
- v1 (2026-10-19): complete and playable.
  - 6 flights, a festival of 26 AI balloons, wind motes, an altimeter/wind strip, a compass, a marker-impact
    predictor ring, rock-tower collisions, sky lanterns at dusk, and synthesized audio.
  - **Wind veer:** inside each layer the wind turns about ±14° with height (`L.veer`, default 28° across the layer).
    Small altitude changes therefore fine-tune your heading, which is what makes targets hittable.
  - **Target placement:** targets and landing fields were generated from kinematic reference plans (hold
    altitudes for set times), so every flight is feasible. If you change a flight's winds, regenerate its targets
    the same way.
  - **Autopilot:** it re-plans every 2 s by flying a kinematic path for 150 s at each candidate altitude. With it,
    Flight 2 scores 3 stars.
  - **Scoring:** the max is `100·targets + 60 + 50`. Star thresholds are 42 / 62 / 80 % of the max, computed in
    `finish()`; the `stars` field in levels.js is unused.
  - Debug: `?auto&speed=4` and `?flight=N`.
