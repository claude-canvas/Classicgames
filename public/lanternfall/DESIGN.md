# LANTERNFALL — design document

A story-driven 3D action RPG in four chapters. Mira, a lantern-keeper's apprentice, sets out to rescue her mentor and
bring back the light after the **Hollow King** snuffs out the Last Lantern of Willowmere.

It is built on the arcade's **Space.js** (via `GameSpace.js`) with the rendering tech from Paper Brook:
- custom shaders;
- a baked dapple/shadow map;
- bloom, god rays and depth of field;
- cute rounded "blob" characters, made like Pip.

There are no external assets; all geometry, portraits and audio are generated in code.

---

## 1. Story

**Mira** is a 16-year-old apprentice to **Bram**, the old Lantern Keeper of Willowmere. The valley's lanterns hold
back the Hollow, a creeping dusk that eats colour and warmth.

**The Hollow King, Vesper Ashgrove**, was Bram's first apprentice decades ago. Terrified of the dark, he tried to
bottle the sun itself, and the attempt hollowed him out. Now he gathers every light in the valley into his Spire to
build an eternal lantern that only he will hold.

### Chapter 1 — *The Last Lantern* (Willowmere, sunset)
1. Mira wakes in her cottage and goes to meet Bram at Lantern Hill.
2. Bram sends her to light the three village lamps for the Festival of Lights.
3. On her way she meets the villagers:
   - **Sela**, the healer;
   - **Captain Rook** of the watch;
   - **Hob**, the baker;
   - **Lila**, a curious child.
4. As the last lamp is lit, the sky bruises violet and **shadow wisps** pour in. Mira fights them off at the hill.
5. **Vesper** appears beside the Last Lantern and speaks with Bram ("You taught me to fear the dark, old man"). He
   snuffs the Lantern and takes Bram away in a column of smoke.
6. Sela gives Mira Bram's **Sunstaff**, which unlocks the *Light Burst*. Rook opens the north gate and Mira sets off.

### Chapter 2 — *The Whispering Woods* (dusk, fireflies)
1. Mira finds **Tobi**, a talking fox (cowardly, funny, loyal), tangled in **shadow thorns**. A Light Burst frees
   him, and he becomes her companion and guide.
2. The road to the Spire is sealed. The forest shrine needs three **Sun Shards**, each guarded by shades in a glade.
3. At the shrine **Morrow, the Shadow Knight**, ambushes them. Boss fight.
4. Beaten, Morrow drops a silver locket engraved *"A. Rook"* and flees. Tobi: "Rook… like your captain?"

### Chapter 3 — *The Drowned Mill* (night, full moon)
1. The ferry to the Spire is chained. **Oswin the Ferryman** asks Mira to light the four flood braziers on the
   river islands, reached over stepping planks, while shades prowl.
2. In the ruined mill Mira finds **Bram's journal**, which reveals Vesper was his apprentice and why he broke.
3. Morrow attacks again. Mid-fight **Captain Rook** arrives: Morrow is his lost brother **Aldric**. Breaking his
   shadow armour lets Mira choose to **spare** Aldric or **banish** him. If spared, he joins the final battle.
4. Oswin ferries everyone across the black water.

### Chapter 4 — *The Hollow Spire* (eclipse, storm)
1. A spiral road climbs to the Spire through waves of shades and **brutes**.
2. Mira frees Bram from a cage of dark iron.
3. **Final boss: Vesper.**
   - Phase 1: he raises a shadow shield that only a Light Burst can break.
   - Phase 2: he summons wisps and fires orb volleys.
   - Phase 3: the eclipse beam sweeps the arena.
4. Defeated, Vesper is a frightened old man again. Bram forgives him, and Mira relights the stolen sun.
5. **Dawn** breaks over the valley, then an epilogue and the credits.

## 2. Controls
| Key | Action |
|---|---|
| WASD / arrows | move (camera-relative) |
| Mouse drag, or Q / E | orbit the camera |
| J / left click | staff combo (3 hits; auto-aims at the nearest enemy in front) |
| K / right click | **Light Burst**: radius 4.5 m, 30 damage + stun; breaks shields; burns thorns. Costs 35 light. |
| Space / Shift | dodge roll (0.35 s invulnerable) |
| F | interact / talk |
| H | drink a potion (+45 HP) |
| Enter / Space / click | advance dialogue |
| P / Esc | pause |

Touch: a virtual stick (left half of the screen), plus ATTACK, BURST, ROLL, TALK and POTION buttons.

## 3. Systems
### Story runner (`story.js`)
Each chapter is an **async script**. It awaits helpers on the game API `G`:
- `G.say(lines)`: a dialogue with portraits, typewriter text, choices and voice blips.
- `G.objective(text, target, cond)`: a tracker plus a world beacon and compass.
- `G.reach(p, r)`
- `G.fight(spawns)`: resolves when all enemies are dead. If Mira falls, the fight resets.
- `G.wait(s)`
- `G.cutscene(cam)`

`main.js` polls the pending conditions every frame.

**Checkpoints:** `G.checkpoint(n)` saves `{chapter, cp}`. A reload restarts the chapter script with `G.from = cp`
and skips the earlier beats.

### Combat
- **Mira:** HP 100, light 100 (+4/s, plus motes from foes). Combo damage is 12 / 12 / 22.
- **Enemies:**

| Enemy | HP | Behaviour |
|---|---|---|
| Wisp | 26 | circles, then makes a telegraphed dash |
| Shade | 48 | slow; claw swipe with a wind-up |
| Brute | 130 | ground slam with a red circle telegraph |
| Morrow | 320 (ch2) / 420 (ch3) | three-hit sword chain, charge, shadow wave |
| Vesper | 900 | three phases (§1) |

- **Telegraphs:** every attack shows a red ground decal before it lands.
- **Feel:** hit stop, knockback, damage numbers, particles and screen shake.
- **If Mira falls:** a fade, then she revives at the fight start with full HP, and the fight's foes reset.

### World (`maps.js`, `world.js`, built in `worker.js`)
Each chapter is a 200×200 m heightfield with:
- **pads:** flattened areas;
- **paths:** carved dirt;
- **water:** rivers and ponds with a water plane;
- **props:** cottages, trees, rocks, fences, lamps, well, shrine, ruins, mill, Spire, bridges, planks, cage.

**Rendering:** the world is built in 25 m tiles (O opaque, G grass within 45 m, W water, A additive). A 0.5 m
**walk grid** blocks water, props and steep slopes; bridges and planks unblock their cells.

**Dapple map:** baked per chapter from tree canopies and house footprints along that chapter's sun or moon
direction.

### Characters (`chars.js`)
Chibi blob figures: big head, pear body, limbs as capsules. Parts are built once per character and posed with 3×4
matrices.
- **Animations:**
  - idle breathing and blinking;
  - a walk cycle (legs, arm swing, bob);
  - run;
  - three attack poses;
  - roll;
  - hurt;
  - talk gestures;
  - cast.
- **Roster:** Mira, Bram, Sela, Rook, Hob, Lila, Tobi (a fox: quadruped rig), Oswin, Morrow / Aldric, Vesper (tall,
  robed, thorn crown, violet EMIT eyes), shade and brute (shadow material with glowing eyes), wisp.
- **Portraits:** generated SVG faces, one per character.

### Look per chapter (environment uniforms)
| Chapter | Time | Light | Extras |
|---|---|---|---|
| Ch1 | warm sunset | sun from the west | |
| Ch2 | blue-violet dusk | | fireflies, teal fog |
| Ch3 | night, big moon | moon, stars, warm lamp light | mirrored water |
| Ch4 | eclipse | dark crimson-violet sky, eclipse ring, lightning | |
| Ending | dawn | warm sun | (ch4 map) |

Up to 8 point lights (Mira's lantern, lamps, braziers). Contact shadows under characters use multiply blending.

## 4. Files
| File | Contents |
|---|---|
| `DESIGN.md` | this document |
| `index.html` | page and UI |
| `GameSpace.js` | Space subclass |
| `mesh.js` | geometry helpers |
| `post.js` | post chain |
| `shaders.js` | scene shaders |
| `maps.js` | chapter terrain and props (pure, shared with the worker) |
| `world.js` | static mesh builders |
| `worker.js` | world builder thread |
| `chars.js` | character models and animation |
| `portraits.js` | SVG faces |
| `story.js` | chapter scripts and dialogue |
| `combat.js` | enemies and AI |
| `audio.js` | sound |
| `main.js` | loop, input, camera, UI, story API |

## 5. Debug
- `?ch=N` starts chapter N; `&cp=K` starts from checkpoint K.
- `?auto`: a bot plays, following objectives with A*, fighting, drinking potions and advancing dialogue.
- `window.__rpg()` returns the current state.

## 6. Progress log
- v1 (2026-10-20): initial build.
