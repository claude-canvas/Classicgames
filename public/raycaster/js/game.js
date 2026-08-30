// game.js
// Wires up all the pieces (map, player, input, raycaster, renderer, audio)
// and runs the requestAnimationFrame loop.

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.map = CONFIG.MAP;
    this.cellSize = CONFIG.CELL_SIZE;

    this.player = new Player(1.5 * this.cellSize, 1.5 * this.cellSize, 0);
    this.input = new InputHandler();
    this.raycaster = new Raycaster(this.map, this.cellSize);

    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.renderer = new Renderer(this.ctx, this.canvas.width, this.canvas.height);

    this.lastTime = 0;
    this.flicker = 0;
    this._loop = this._loop.bind(this);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = this.canvas.clientWidth;
    const displayHeight = this.canvas.clientHeight;

    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.renderer) {
      this.renderer.resize(displayWidth, displayHeight);
    }
  }

  start() {
    requestAnimationFrame(this._loop);
  }

  _loop(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05) || 0;
    this.lastTime = timestamp;

    this.player.update(this.input.state, this.map, this.cellSize, dt);

    if (window.AudioEngine) {
      AudioEngine.reportMovement(this.player.lastMoveDist);
    }

    // Mouse-look: apply accumulated horizontal mouse movement, then
    // clear it so it doesn't keep spinning the player next frame.
    if (this.input.mouseDeltaX) {
      this.player.angle = normalizeAngle(
        this.player.angle + this.input.mouseDeltaX * CONFIG.MOUSE_SENSITIVITY
      );
      this.input.mouseDeltaX = 0;
    }

    // Walking head-bob: eases toward zero when standing still, since
    // bobPhase only advances while the player is actually moving.
    const movingFactor = this.player.lastMoveDist > 0 ? 1 : 0.4;
    const bobOffset = Math.sin(this.player.bobPhase) * CONFIG.BOB_AMPLITUDE * movingFactor;

    // Torch flicker: a small clamped random walk, recomputed every frame.
    this.flicker += (Math.random() - 0.5) * 0.05;
    this.flicker = Math.max(-0.05, Math.min(0.1, this.flicker));

    // One ray roughly every 3 display pixels keeps this smooth on phones.
    const numRays = Math.max(60, Math.floor(this.renderer.width / 3));
    const rays = this.raycaster.castAll(this.player, numRays, CONFIG.FOV);

    this.renderer.draw(rays, this.player, this.map, bobOffset, this.flicker);

    requestAnimationFrame(this._loop);
  }
}
