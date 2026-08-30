// raycaster.js
// Core DDA (Digital Differential Analysis) raycasting algorithm.
// This is the classic Wolfenstein-3D-style technique: walk each ray
// through the grid one cell boundary at a time until it hits a wall.

class Raycaster {
  constructor(map, cellSize) {
    this.map = map;
    this.cellSize = cellSize;
  }

  // Casts a single ray from (px, py) at the given angle.
  // Returns { distance, wallType, side } where distance is in *cells*
  // (perpendicular distance, not yet fisheye-corrected) and side is
  // 0 for a vertical (east/west-facing) wall hit, 1 for horizontal.
  castRay(px, py, angle) {
    const map = this.map;
    const cellSize = this.cellSize;

    const rayDirX = Math.cos(angle);
    const rayDirY = Math.sin(angle);

    let mapX = Math.floor(px / cellSize);
    let mapY = Math.floor(py / cellSize);

    const deltaDistX = Math.abs(rayDirX) < 1e-9 ? 1e30 : Math.abs(1 / rayDirX);
    const deltaDistY = Math.abs(rayDirY) < 1e-9 ? 1e30 : Math.abs(1 / rayDirY);

    let stepX, sideDistX;
    let stepY, sideDistY;

    const cellPX = px / cellSize;
    const cellPY = py / cellSize;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (cellPX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - cellPX) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (cellPY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - cellPY) * deltaDistY;
    }

    let hit = false;
    let side = 0;
    let wallType = 1;
    let steps = 0;
    const maxSteps = CONFIG.MAX_DEPTH * 4;

    while (!hit && steps < maxSteps) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (mapY < 0 || mapY >= map.length || mapX < 0 || mapX >= map[0].length) {
        hit = true;
        wallType = 1;
        break;
      }

      if (map[mapY][mapX] !== 0) {
        hit = true;
        wallType = map[mapY][mapX];
      }

      steps++;
    }

    const perpDist = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;

    return {
      distance: Math.max(perpDist, 0.0001),
      wallType,
      side,
    };
  }

  // Casts a full fan of rays across the player's field of view.
  // Applies fisheye correction so straight walls render straight.
  castAll(player, numRays, fov) {
    const results = [];
    const startAngle = player.angle - fov / 2;
    const angleStep = fov / numRays;

    for (let i = 0; i < numRays; i++) {
      const rayAngle = startAngle + i * angleStep;
      const res = this.castRay(player.x, player.y, rayAngle);
      res.distance *= Math.cos(rayAngle - player.angle);
      results.push(res);
    }

    return results;
  }
}
