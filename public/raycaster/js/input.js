// input.js
// Reads keyboard, on-screen touch buttons, and mouse-look into one shared
// state that Player.update()/Game._loop() consume each frame.

class InputHandler {
  constructor() {
    this.state = {
      forward: false,
      backward: false,
      strafeLeft: false,
      strafeRight: false,
      left: false,
      right: false,
    };

    // Accumulated horizontal mouse movement since it was last consumed.
    // Game._loop() reads this each frame, applies it to the player's
    // angle, then resets it to 0.
    this.mouseDeltaX = 0;
    this.pointerLocked = false;

    this._bindKeyboard();
    this._bindTouch();
    this._bindMouseLook();
  }

  _bindKeyboard() {
    // Classic WASD (plus arrow keys as an alternative), bound at the
    // window level so it works no matter what's focused on the page.
    const keyMap = {
      KeyW: 'forward',
      ArrowUp: 'forward',
      KeyS: 'backward',
      ArrowDown: 'backward',
      KeyA: 'strafeLeft',
      KeyD: 'strafeRight',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };

    window.addEventListener('keydown', (e) => {
      const action = keyMap[e.code];
      if (action) {
        this.state[action] = true;
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      const action = keyMap[e.code];
      if (action) {
        this.state[action] = false;
        e.preventDefault();
      }
    });
  }

  _bindTouch() {
    const bind = (id, action) => {
      const el = document.getElementById(id);
      if (!el) return;

      const on = (e) => {
        e.preventDefault();
        this.state[action] = true;
      };
      const off = (e) => {
        e.preventDefault();
        this.state[action] = false;
      };

      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      // Also support mouse, so it's testable on desktop without a keyboard.
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    };

    bind('btn-forward', 'forward');
    bind('btn-backward', 'backward');
    bind('btn-strafe-left', 'strafeLeft');
    bind('btn-strafe-right', 'strafeRight');
    bind('btn-turn-left', 'left');
    bind('btn-turn-right', 'right');
  }

  // Classic FPS mouse-look: click the canvas to lock the pointer, then
  // horizontal mouse movement turns the player. Esc (or clicking again
  // with the browser's own UI) releases the lock.
  _bindMouseLook() {
    const canvas = document.getElementById('game-canvas');
    const hint = document.getElementById('lock-hint');
    if (!canvas) return;

    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouseDeltaX += e.movementX;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (hint) {
        hint.style.display = this.pointerLocked ? 'none' : 'block';
      }
    });
  }
}
