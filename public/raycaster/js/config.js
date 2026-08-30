// config.js
// All tunable game constants and the level map live here.
// To expand the game later (new levels, new wall types, etc.)
// this is the first file to touch.

const CONFIG = {
  // 0 = empty floor, any other number = a wall type (used to pick a texture).
  // Redesigned to be spacious: wall clusters (pillars) are spread out with
  // several empty cells between them, instead of 1-wide maze corridors.
  MAP: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 2, 2, 0, 0, 0, 1],
    [1, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 2, 2, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 3, 3, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 1],
    [1, 0, 0, 3, 3, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],

  CELL_SIZE: 64,        // world units per map cell
  PLAYER_RADIUS: 10,    // collision radius, in world units

  FOV: Math.PI / 3,     // field of view (60 degrees)
  MAX_DEPTH: 25,          // max ray travel distance, in cells (map is bigger now)

  MOVE_SPEED: 3,          // cells per second
  ROT_SPEED: 2.5,         // radians per second (keyboard turning)
  MOUSE_SENSITIVITY: 0.0025, // radians per pixel of mouse movement

  // Pixel step size used when casting the floor. Bigger = faster/blockier,
  // smaller = sharper/slower. 4 is a good phone-friendly default.
  FLOOR_STEP: 4,
};
