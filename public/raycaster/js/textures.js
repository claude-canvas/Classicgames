// textures.js
// Procedurally paints wall and floor textures onto small offscreen canvases
// at load time. Generated in-code (not downloaded) so the game has zero
// network dependency and no image licensing to worry about.
//
// To add a new wall texture: write a makeXxx(size) function that returns a
// canvas, then add it to wallTextures under a new map number, and use that
// number in CONFIG.MAP.

const Textures = (() => {
  function createCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }

  function addNoise(ctx, size, amount, alpha) {
    for (let i = 0; i < amount; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const s = 1 + Math.random() * 2;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, s, s);
    }
  }

  function makeBrick(size) {
    const canvas = createCanvas(size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#9a4030';
    ctx.fillRect(0, 0, size, size);

    const rows = 4;
    const brickH = size / rows;
    const brickW = size / 2;
    ctx.strokeStyle = '#4a1f14';
    ctx.lineWidth = 2;

    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let col = -1; col < 3; col++) {
        ctx.strokeRect(col * brickW + offset, row * brickH, brickW, brickH);
      }
    }

    addNoise(ctx, size, 220, 0.06);
    return canvas;
  }

  function makeStone(size) {
    const canvas = createCanvas(size);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#6b7b8a');
    grad.addColorStop(1, '#414d59');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const cell = size / 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }

    addNoise(ctx, size, 180, 0.06);
    return canvas;
  }

  function makeWood(size) {
    const canvas = createCanvas(size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7a4b28';
    ctx.fillRect(0, 0, size, size);

    const planks = 4;
    const plankW = size / planks;
    for (let i = 0; i < planks; i++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.moveTo(i * plankW, 0);
      ctx.lineTo(i * plankW, size);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      for (let g = 0; g < 5; g++) {
        const gx = i * plankW + Math.random() * plankW;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx + (Math.random() - 0.5) * 4, size);
        ctx.stroke();
      }
    }

    addNoise(ctx, size, 140, 0.05);
    return canvas;
  }

  function makeFloor(size) {
    const canvas = createCanvas(size);
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    ctx.fillStyle = '#8a8272';
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
    ctx.fillStyle = '#6e6656';
    ctx.fillRect(half, 0, half, half);
    ctx.fillRect(0, half, half, half);

    addNoise(ctx, size, 160, 0.05);
    return canvas;
  }

  const TEX_SIZE = 64; // must stay a power of two (used for fast bitmasking)

  const wallTextures = {
    1: makeBrick(TEX_SIZE),
    2: makeStone(TEX_SIZE),
    3: makeWood(TEX_SIZE),
  };

  const floorCanvas = makeFloor(TEX_SIZE);
  const floorImageData = floorCanvas
    .getContext('2d')
    .getImageData(0, 0, TEX_SIZE, TEX_SIZE);

  function sampleFloor(tx, ty) {
    const idx = (ty * TEX_SIZE + tx) * 4;
    const d = floorImageData.data;
    return [d[idx], d[idx + 1], d[idx + 2]];
  }

  return {
    wallTextures,
    floorSize: TEX_SIZE,
    sampleFloor,
  };
})();
