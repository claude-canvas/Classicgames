# Models for Echoes of the Hollow

Drop real models here and reload the page. The game finds them automatically.

| File | Used as | What the game does with it |
|---|---|---|
| `forest.glb` | the environment | Centres it on the map and puts its lowest point at ground level. Walkable ground and obstacles come from its own triangles. |
| `villager.glb` | the player | Scales it to 1.75 m tall and turns it to face forward. |

## Getting compatible files
The `.binz` files in `E:\junk\model\…` are Sketchfab's protected viewer-cache data, not model files. The textures
next to them are scrambled as well. They cannot be loaded.

1. Open the model's page on Sketchfab.
2. Check the licence allows downloading. Many models are CC-BY, which requires credit to the author.
3. Click **Download 3D Model**, choose **glTF**, and pick the **.glb** (binary) option if offered.
   - If you get a `.gltf` file plus a `.bin` file and textures instead, open it in Blender and re-export it as
     **glTF Binary (.glb)**.
4. Export **without** Draco or meshopt compression.
5. Rename the files to `forest.glb` / `villager.glb` and place them in this folder.

The status panel at the bottom-right of the game shows which models are in use, and any loading errors.
