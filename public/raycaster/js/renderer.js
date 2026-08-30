// renderer.js
// Turns raycast results into pixels: ceiling/floor fill, shaded wall
// strips, and a small minimap overlay. Swap the flat-color wall fill
// for a textured one later without touching anything else in the game.

class Renderer {
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  draw(rays, player, map) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Ceiling
    ctx.fillStyle = '#3a3a52';
    ctx.fillRect(0, 0, w, h / 2);
    // Floor
    ctx.fillStyle = '#555555';
    ctx.fillRect(0, h / 2, w, h / 2);

    this.drawWalls(rays, w, h);
    this.drawMinimap(player, map);
  }

  drawWalls(rays, w, h) {
    const ctx = this.ctx;
    const numRays = rays.length;
    const stripWidth = w / numRays;

    for (let i = 0; i < numRays; i++) {
      const ray = rays[i];
      const dist = ray.distance;
      const wallHeight = Math.min(h * 3, h / dist);

      const color = CONFIG.WALL_COLORS[ray.wallType] || CONFIG.WALL_COLORS[1];

      // Fade toward black with distance (simple fog), and darken
      // one wall orientation slightly so edges read as 3D.
      const fogFactor = Math.max(0.15, 1 - dist / CONFIG.MAX_DEPTH);
      const sideFactor = ray.side === 1 ? 0.7 : 1;

      const r = Math.floor(color.r * fogFactor * sideFactor);
      const g = Math.floor(color.g * fogFactor * sideFactor);
      const b = Math.floor(color.b * fogFactor * sideFactor);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const x = i * stripWidth;
      const y = (h - wallHeight) / 2;
      ctx.fillRect(x, y, stripWidth + 1, wallHeight);
    }
  }

  drawMinimap(player, map) {
    const ctx = this.ctx;
    const scale = 4;
    const offsetX = 12;
    const offsetY = 12;

    ctx.globalAlpha = 0.75;

    for (let row = 0; row < map.length; row++) {
      for (let col = 0; col < map[0].length; col++) {
        ctx.fillStyle = map[row][col] !== 0 ? '#e0e0e0' : '#222222';
        ctx.fillRect(offsetX + col * scale, offsetY + row * scale, scale - 1, scale - 1);
      }
    }

    const cellSize = CONFIG.CELL_SIZE;
    const px = offsetX + (player.x / cellSize) * scale;
    const py = offsetY + (player.y / cellSize) * scale;

    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ff4444';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.angle) * 10, py + Math.sin(player.angle) * 10);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }
}
