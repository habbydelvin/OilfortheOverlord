import * as THREE from 'three';

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const DRAG_THRESHOLD = 5; // px before a press becomes a pan instead of a click

/**
 * Top-down strategy camera:
 *  - left/middle drag: pan        - wheel: zoom
 *  - WASD / arrows: pan           - Q / E: rotate 90°
 * A left press that doesn't move becomes a click (forwarded to onClick).
 */
export class CameraRig {
  target = new THREE.Vector3();
  goal = new THREE.Vector3();
  distance = 15;
  goalDistance = 15;
  minDistance = 6;
  maxDistance = 48;
  yaw = 0;
  goalYaw = 0;
  pitch = THREE.MathUtils.degToRad(58);
  bounds = 60;
  keys = new Set();
  drag = null;
  onClick = null;

  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    dom.addEventListener('pointerdown', this.#onDown);
    window.addEventListener('pointermove', this.#onMove);
    window.addEventListener('pointerup', this.#onUp);
    dom.addEventListener('wheel', this.#onWheel, { passive: false });
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    this.update(0);
  }

  get isDragging() {
    return !!this.drag?.moved;
  }

  rotate(dir) {
    this.goalYaw += (dir * Math.PI) / 2;
  }

  focus(x, z) {
    this.goal.set(x, 0, z);
  }

  #right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  #forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  #pan(dx, dy) {
    const h = this.dom.clientHeight || 1;
    const worldPerPx = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
    this.goal.addScaledVector(this.#right(), -dx * worldPerPx);
    this.goal.addScaledVector(this.#forward(), (dy * worldPerPx) / Math.sin(this.pitch));
    this.#clamp();
  }

  #clamp() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -this.bounds, this.bounds);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -this.bounds, this.bounds);
  }

  #onDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    this.drag = { button: e.button, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
  };

  #onMove = (e) => {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_THRESHOLD) {
      d.moved = true;
      this.dom.style.cursor = 'grabbing';
    }
    if (d.moved) this.#pan(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  #onUp = (e) => {
    const d = this.drag;
    if (!d || e.button !== d.button) return;
    if (!d.moved && d.button === 0) this.onClick?.(e);
    this.drag = null;
    this.dom.style.cursor = '';
  };

  #onWheel = (e) => {
    e.preventDefault();
    this.goalDistance = THREE.MathUtils.clamp(
      this.goalDistance * Math.exp(e.deltaY * 0.0015),
      this.minDistance,
      this.maxDistance,
    );
  };

  #onKeyDown = (e) => {
    if (e.target.matches?.('input, select, textarea')) return; // debug panel sliders use arrow keys
    if (e.repeat && (e.key === 'q' || e.key === 'e')) return;
    const k = e.key.toLowerCase();
    if (k === 'q') this.rotate(-1);
    else if (k === 'e') this.rotate(1);
    else this.keys.add(k);
  };

  update(dt) {
    // Keyboard panning (speed scales with zoom).
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz += 1;
    if (k.has('s') || k.has('arrowdown')) fz -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (fx || fz) {
      const speed = this.distance * 0.9 * dt;
      this.goal.addScaledVector(this.#right(), fx * speed);
      this.goal.addScaledVector(this.#forward(), fz * speed);
      this.#clamp();
    }

    this.target.lerp(this.goal, dt ? damp(16, dt) : 1);
    this.distance += (this.goalDistance - this.distance) * (dt ? damp(10, dt) : 1);
    this.yaw += (this.goalYaw - this.yaw) * (dt ? damp(9, dt) : 1);

    const horiz = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target);
  }
}
