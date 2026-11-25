const PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class Controls {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set(); // teclas pressionadas neste quadro
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = false;
    this.onLockChange = null;
    this.fire = false;
    this.firePressed = false;

    window.addEventListener('keydown', (e) => {
      if (PREVENT.includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (this.enabled && (this.locked || this.dragging)) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    el.addEventListener('mousedown', () => {
      if (!this.enabled) return;
      if (this.locked) { this.fire = true; this.firePressed = true; }
      this.dragging = true;
      if (!this.locked) this.lock();
    });
    window.addEventListener('mouseup', () => { this.dragging = false; this.fire = false; });
    window.addEventListener('wheel', (e) => { if (this.enabled) this.wheel += e.deltaY; }, { passive: true });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  lock() {
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* sem pointer lock: o mouse funciona arrastando */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  endFrame() {
    this.pressed.clear();
    this.firePressed = false;
    this.dx = this.dy = this.wheel = 0;
  }
  clear() {
    this.keys.clear();
    this.endFrame();
    this.dragging = false;
    this.fire = false;
  }
}
