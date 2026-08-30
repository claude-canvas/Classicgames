// config.js
// All tunable game constants and the level map live here.
// To expand the game later (new levels, new wall types, textures, etc.)
// this is the first file to touch.

const CONFIG = {
  // 0 = empty floor, any other number = a wall type (used to pick a color/texture)
  MAP: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 2, 2, 2, 0, 1, 1, 1, 0, 3, 3, 3, 0, 1],
    [1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1],
    [1, 0, 2, 0, 1, 1, 1, 0, 1, 1, 3, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1, 0, 2, 2, 2, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 2, 0, 2, 1, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    [1, 0, 1, 0, 3, 3, 3, 3, 3, 3, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 1, 1, 3, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],

  CELL_SIZE: 64,        // world units per map cell
  PLAYER_RADIUS: 10,    // collision radius, in world units

  FOV: Math.PI / 3,     // field of view (60 degrees)
  MAX_DEPTH: 20,         // max ray travel distance, in cells

  MOVE_SPEED: 3,         // cells per second
  ROT_SPEED: 2.5,        // radians per second

  // Flat wall colors by map value. Swap these for texture lookups later
  // (e.g. WALL_TEXTURES[wallType] = an Image) without touching the renderer's
  // overall structure.
  WALL_COLORS: {
    1: { r: 170, g: 60, b: 60 },   // red brick
    2: { r: 60, g: 120, b: 170 }, // blue stone
    3: { r: 60, g: 170, b: 90 },  // green metal
  },
};
