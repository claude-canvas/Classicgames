# THE HOLLOW PINES — design document

## Story
Your little sister **Ellie** walked into the old ponderosa woods at dusk, following a voice, and did not come back.
The village says the woods belong to **Agnes Wren**, the widow who drowned herself in the creek after the chapel
burned with her children inside. She walks the pines at night and takes whoever she finds.

The priest's **holy cross** was carried out of the chapel fire and hidden at one of the old roadside shrines in the
woods. Find it, and when Agnes comes for you, hold it up to her face.

## 1. Play
- **First person**, at night, human scale: eye height 1.65 m. The forest model is used as it was made, so the trees
  read as whole trees.
- **Controls:**
  - Move: WASD. Run: Shift (stamina; you pant when it runs out).
  - Look: mouse, with pointer lock. Click to capture the pointer.
  - **F** toggles the flashlight (its battery drains slowly). **E** or right mouse raises the cross once you hold it.
- **Goal:**
  - **The shrines:** five shrines (stone cairns with guttering candles) stand in the clearing. The cross is at one of
    them, a different one each game. The others hold a hanging rag doll, a child's shoe, and so on.
  - **Searching:** the candles show through the fog from about 20 m, so the shrines are the landmarks you search
    between. Walk up to a shrine to look.
  - **Taking the cross:** at the right shrine, press E. The cross then sits in your hand at the bottom of the screen.
- **Agnes:**
  - **Stalking:** after the first minute she appears between the trees, 15–30 m away, a pale figure standing still.
    If you light her with the flashlight or walk toward her, she is gone. Each time she reappears closer.
  - **Hunts:**
    - Every 60–90 s (sooner as the night goes on), a scream rolls through the woods and she comes.
    - She drifts through trees at a walking-plus pace (1.7 m/s): you can outrun her while your stamina lasts.
    - During a hunt your flashlight flickers, the heartbeat races and the screen tears at the edges.
    - A hunt ends after about 25 s if she has not reached you.
  - **Caught without the cross:** a jumpscare. Her face fills the screen with a screech. You are dead.
  - **With the cross:** raise it (E) while she is in front of you. She cannot come within 2 m of a raised cross. She
    burns, shrieks and pushes, and after 3 s of facing the cross she comes apart in sparks and ash. You win: grey dawn
    light seeps in.
- **Atmosphere events:** footsteps behind you that stop when you stop, a branch snapping, whispers, a child's
  laugh-like trill, a distant scream, the flashlight dying for a second, and a shape crossing between trunks at the
  edge of the light.

## 2. Look
- **Night and fog:** a moonless overcast night with near-black blue fog. Visibility is about 25 m without the light.
- **Flashlight:** a cone light (a spot uniform in the shader) with a soft hot centre, and a faint beam in the fog.
- **Candles:** at the shrines, warm flickering point lights plus glow sprites.
- **Agnes:**
  - A tall, thin, 2 m figure: a torn grey-white gown, long black hair over most of her face, hollow eyes, arms too
    long.
  - Drawn pale and half-transparent, with a fresnel edge and flicker; her eyes glow faintly.
  - Up close she is fully opaque.
- **Post:**
  - Strong film grain and a heavy vignette.
  - A "fear" uniform drives chromatic split, desaturation and edge tearing as she nears.
  - Bloom for the candles.
- **LOD:** the fog hides everything beyond about 35 m. Far trees are impostors (from Last Light), and nothing is drawn
  beyond 60 m, so the forest runs fast at full detail nearby.

## 3. Sound (Web Audio, synthesised)
- **Ambience:** a low drone (detuned sub-sines), with wind in the canopy.
- **Fear:** a heartbeat whose rate follows fear, and whispers (formant-filtered noise).
- **Agnes:** a wail (a sawtooth with vibrato through vowel formants), and the hunt scream.
- **Your body:** footsteps on needles, branch snaps, and breathing when you run.
- **The cross:** a choir-like pad (stacked sines) while it is raised.
- **Jumpscare:** a screech, and a noise burst that is louder than everything else.

## 4. Files
| File | Contents |
|---|---|
| `GameSpace.js`, `mesh.js`, `post.js` | engine (from Last Light); `post.js` adds the fear effects |
| `forest.js`, `lod.js`, `world.js`, `nav.js` | the instanced forest, impostors, collision, navigation (from Last Light) |
| `shaders.js` | night shading with the flashlight spot, candle lights and the ghost material |
| `agnes.js` | the ghost: model, poses, AI (dormant, stalk, hunt, burn, gone) |
| `props.js` | shrines, candles, the cross, dolls |
| `sound.js` | horror audio |
| `main.js` | first-person controller, flashlight, game flow, scares, HUD |

## 5. Development
- **`?dev`:** live reload, as in Last Light.
- **`?auto`:** a bot plays: it searches the shrines, takes the cross, faces Agnes and banishes her.
- **Debug:** `__hp()` and `__ff(seconds)`.

## 6. Tuning notes (v1, 2026-10-27)
- **Levels of detail:**
  - Young pines are full meshes within 8 m, ring trees within 18 m. Twig-free branches are used beyond 3 m.
    Impostors run to 60 m; nothing is drawn beyond that.
  - A typical view draws 160–390 k indices, at 37–60 fps on the test machine (with adaptive resolution).
- **Tree grouping fix (`lod.js`):** the young and big pines are world-placed meshes with identity matrices. Grouping
  them by matrix had merged all of them into one always-full "tree". They now pair up by mesh name. The same fix went
  into Last Light.
- **Agnes:**
  - She has a steady pale inner glow, so her face reads head-on, plus a fresnel edge.
  - Her hair rides the head bone and parts over her face; there are black tears and a stretched mouth.
  - The head leans and twitches only slightly, and she faces you straight for the jumpscare.
- **Start and navigation:**
  - The start is the most open reachable spot near the middle.
  - The nav grid checks a body-width ring (radius 0.35 m). The bot sidesteps when it is wedged.
- **Bot result** (fast-forwarded): it searches the shrines, takes the cross at about 50 s, faces the next hunt,
  raises the cross and banishes Agnes. Without the cross, a hunt catches it (the jumpscare and death card work).

## 7. Notes
- **Third-party model:** the forest is the same downloaded model as Last Light (`pine-forest-at-sunset.zip`, a
  Sketchfab "ponderosa stand").
- **Published (2026-10-27):** on the arcade home page at the user's request.
  - The `seo/games.json` entry (genre Horror, Adventure) and the game count in `seo/config.json` (62).
  - Thumbnails `og/hollow-pines.jpg` and `thumbs/hollow-pines.webp`; `npm run seo` was run.
