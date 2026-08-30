// renderer.js
// Turns raycast results into pixels: a textured floor (via floor-casting),
// texture-mapped wall strips (real per-column texture sampling using the
// DDA hit offset), a flickering torchlight vignette, and a minimap.

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

  // bobOffset shifts the horizon up/down a few pixels to simulate a
  // walking camera bob. flicker (-0.05..0.1 roughly) darkens/lightens
  // the torchlight vignette frame to frame.
  draw(rays, player, map, bobOffset = 0, flicker = 0) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const horizon = h / 2 + bobOffset;

    // Ceiling (kept flat — a texture here adds little at this camera angle)
    ctx.fillStyle = '#3a3a52';
    ctx.fillRect(0, 0, w, horizon);

    // Floor, textured via floor-casting
    this.drawFloor(player, w, h, horizon);

    // Walls, texture-mapped per column
    this.drawWalls(rays, w, horizon);

    // Torch flicker vignette
    this.drawVignette(w, h, flicker);

    this.drawMinimap(player, map);
  }

  drawWalls(rays, w, horizon) {
    const ctx = this.ctx;
    const numRays = rays.length;
    const stripWidth = w / numRays;

    for (let i = 0; i < numRays; i++) {
      const ray = rays[i];
      const dist = ray.distance;
      const wallHeight = Math.min(horizon * 6, (horizon * 2) / dist);

      const texture = Textures.wallTextures[ray.wallType] || Textures.wallTextures[1];
      let texX = Math.floor(ray.wallX * texture.width);
      if (texX < 0) texX = 0;
      if (texX >= texture.width) texX = texture.width - 1;

      const x = i * stripWidth;
      const y = horizon - wallHeight / 2;

      ctx.drawImage(texture, texX, 0, 1, texture.height, x, y, stripWidth + 1, wallHeight);

      // Distance fog + a touch of extra shade on one wall orientation so
      // corners read as 3D, applied as a translucent overlay on top of
      // the texture strip.
      const fog = Math.min(0.85, dist / CONFIG.MAX_DEPTH);
      const sideShade = ray.side === 1 ? 0.25 : 0;
      const alpha = Math.min(0.9, fog + sideShade);
      if (alpha > 0.02) {
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.fillRect(x, y, stripWidth + 1, wallHeight);
      }
    }
  }

  drawFloor(player, w, h, horizon) {
    const ctx = this.ctx;
    const step = CONFIG.FLOOR_STEP;
    const texSize = Textures.floorSize;
    const fov = CONFIG.FOV;

    const rayDirX0 = Math.cos(player.angle - fov / 2);
    const rayDirY0 = Math.sin(player.angle - fov / 2);
    const rayDirX1 = Math.cos(player.angle + fov / 2);
    const rayDirY1 = Math.sin(player.angle + fov / 2);

    const posXCells = player.x / CONFIG.CELL_SIZE;
    const posYCells = player.y / CONFIG.CELL_SIZE;

    const numCols = Math.max(1, Math.floor(w / step));
    const startY = Math.max(0, Math.floor(horizon));

    for (let y = startY; y < h; y += step) {
      const p = y - horizon || 1;
      const rowDistance = horizon / p;

      const floorStepX = (rowDistance * (rayDirX1 - rayDirX0)) / numCols;
      const floorStepY = (rowDistance * (rayDirY1 - rayDirY0)) / numCols;

      let floorX = posXCells + rowDistance * rayDirX0;
      let floorY = posYCells + rowDistance * rayDirY0;

      const fog = Math.max(0, Math.min(0.85, rowDistance / CONFIG.MAX_DEPTH));
      const shade = 1 - fog;

      for (let x = 0; x < w; x += step) {
        const cellX = Math.floor(floorX);
        const cellY = Math.floor(floorY);
        const tx = Math.floor((floorX - cellX) * texSize) & (texSize - 1);
        const ty = Math.floor((floorY - cellY) * texSize) & (texSize - 1);

        const [r, g, b] = Textures.sampleFloor(tx, ty);
        ctx.fillStyle = `rgb(${Math.floor(r * shade)},${Math.floor(g * shade)},${Math.floor(b * shade)})`;
        ctx.fillRect(x, y, step, step);

        floorX += floorStepX;
        floorY += floorStepY;
      }
    }
  }

  // A soft radial darkening toward the screen edges that flickers subtly
  // frame to frame, like the scene is lit by an unsteady torch.
  drawVignette(w, h, flicker) {
    const ctx = this.ctx;
    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.max(w, h) * 0.75;
    const darkness = Math.max(0, Math.min(0.75, 0.55 + flicker));

    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.15, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${darkness})`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
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
