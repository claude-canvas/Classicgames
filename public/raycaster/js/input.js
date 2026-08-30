// input.js
// Reads keyboard and on-screen touch buttons into one shared state object
// that Player.update() consumes each frame.

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

    this._bindKeyboard();
    this._bindTouch();
  }

  _bindKeyboard() {
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
}
