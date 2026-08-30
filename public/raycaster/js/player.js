// player.js
// Player position, facing angle, and movement/collision logic.

class Player {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.angle = angle; // radians, 0 = facing +X
    this.moveSpeed = CONFIG.MOVE_SPEED;
    this.rotSpeed = CONFIG.ROT_SPEED;
    this.radius = CONFIG.PLAYER_RADIUS;
  }

  update(input, map, cellSize, dt) {
    // Turning (keyboard)
    if (input.left) this.angle -= this.rotSpeed * dt;
    if (input.right) this.angle += this.rotSpeed * dt;
    this.angle = normalizeAngle(this.angle);

    // Movement (forward/back + strafe), relative to facing direction
    const speed = this.moveSpeed * cellSize * dt;
    let dx = 0;
    let dy = 0;

    if (input.forward) {
      dx += Math.cos(this.angle) * speed;
      dy += Math.sin(this.angle) * speed;
    }
    if (input.backward) {
      dx -= Math.cos(this.angle) * speed;
      dy -= Math.sin(this.angle) * speed;
    }
    if (input.strafeLeft) {
      dx += Math.cos(this.angle - Math.PI / 2) * speed;
      dy += Math.sin(this.angle - Math.PI / 2) * speed;
    }
    if (input.strafeRight) {
      dx += Math.cos(this.angle + Math.PI / 2) * speed;
      dy += Math.sin(this.angle + Math.PI / 2) * speed;
    }

    this.tryMove(dx, dy, map, cellSize);
  }

  // Move on each axis independently so sliding along walls feels smooth.
  tryMove(dx, dy, map, cellSize) {
    const nextX = this.x + dx;
    const nextY = this.y + dy;

    if (!this.collidesAt(nextX, this.y, map, cellSize)) {
      this.x = nextX;
    }
    if (!this.collidesAt(this.x, nextY, map, cellSize)) {
      this.y = nextY;
    }
  }

  collidesAt(x, y, map, cellSize) {
    const r = this.radius;
    const corners = [
      [x - r, y - r],
      [x + r, y - r],
      [x - r, y + r],
      [x + r, y + r],
    ];

    for (const [px, py] of corners) {
      const col = Math.floor(px / cellSize);
      const row = Math.floor(py / cellSize);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) {
        return true;
      }
      if (map[row][col] !== 0) {
        return true;
      }
    }
    return false;
  }
}

function normalizeAngle(angle) {
  const TWO_PI = Math.PI * 2;
  angle = angle % TWO_PI;
  if (angle < 0) angle += TWO_PI;
  return angle;
}
