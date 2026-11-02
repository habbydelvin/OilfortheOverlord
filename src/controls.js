import * as THREE from 'three';
import { WORLD_HALF } from './grid.js';

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const DRAG_THRESHOLD = 5; // px before a press becomes a pan instead of a click

/** How long a pause is before a scroll-out gesture starts over. */
export const WHEEL_GAP = 600;
/** One mouse detent. Two of these reach CameraRig.OVERSCROLL. */
const WHEEL_NOTCH = 180;
/** Events closer than this are one trackpad swipe, not separate notches. */
const WHEEL_STREAM = 45;

/**
 * Signed wheel amount for the "past the zoom stop" gesture. A mouse detent is one notch even when
 * the browser reports a tiny pixel delta. A fast stream keeps its real delta, capped, so one swipe
 * still has to travel a little.
 */
export function wheelUnits(e, lastAt = 0) {
  const sign = Math.sign(e.deltaY);
  if (!sign) return 0;
  const mag = Math.abs(e.deltaY);
  const detent = e.deltaMode !== 0 || (mag < 40 && Math.abs(e.wheelDelta || 0) >= 100);
  if (detent || performance.now() - lastAt > WHEEL_STREAM) return sign * WHEEL_NOTCH * (e.deltaMode === 2 ? 3 : 1);
  return sign * Math.min(mag, 120);
}

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
  bounds = WORLD_HALF; // the look-at point stays inside the world
  keys = new Set();
  drag = null;
  onClick = null;
  /** Cinematics: no player input moves the camera while locked. */
  locked = false;
  /** Ease speeds toward goal / goalDistance (cinematics slow these down). */
  posRate = 16;
  zoomRate = 10;
  static POS_RATE = 16;
  static ZOOM_RATE = 10;

  /** Back to normal play: unlocked, normal ease speeds. */
  release() {
    this.locked = false;
    this.posRate = CameraRig.POS_RATE;
    this.zoomRate = CameraRig.ZOOM_RATE;
  }

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

  /**
   * World offset for the look-at point that moves the view by (dx, dy) screen px at `distance`
   * (the same as dragging the board by that much).
   */
  screenShift(dx, dy, distance = this.goalDistance) {
    const h = this.dom.clientHeight || 1;
    const worldPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
    return new THREE.Vector3()
      .addScaledVector(this.#right(), -dx * worldPerPx)
      .addScaledVector(this.#forward(), (dy * worldPerPx) / Math.sin(this.pitch));
  }

  #rightV = new THREE.Vector3();
  #forwardV = new THREE.Vector3();

  #right() {
    return this.#rightV.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  #forward() {
    return this.#forwardV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
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
    if (this.locked) return;
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
    if (this.locked) return;
    const now = performance.now();
    const units = wheelUnits(e, this.#wheelAt);
    this.#wheelAt = now;
    // Already zoomed out: more scroll-out climbs past max into the clouds. Past COMMIT the globe opens and the
    // climb finishes by itself. Below it, a pause drains slowly (scrolling again resumes); only a deliberate
    // scroll back in cancels, so a stray reversed momentum tick does not.
    if (this.onZoomPastMax && (this.#over > 0 || (e.deltaY > 0 && this.goalDistance >= this.maxDistance - 1e-3))) {
      this.#overAt = now;
      if (e.deltaY < 0) {
        this.#back += Math.abs(units);
        if (this.#back < WHEEL_NOTCH * 1.2) return;
        this.#over = 0;
        this.overscroll = 0;
        this.#back = 0;
      } else {
        this.#back = 0;
        this.#over = Math.min(CameraRig.OVERSCROLL, this.#over + Math.abs(units));
        this.overscroll = this.#over / CameraRig.OVERSCROLL;
        if (this.overscroll >= CameraRig.COMMIT && !this.#committed) {
          this.#committed = true;
          this.onZoomPastMax();
        }
        return;
      }
    }
    this.goalDistance = THREE.MathUtils.clamp(
      this.goalDistance * Math.exp(e.deltaY * 0.0015),
      this.minDistance,
      this.maxDistance,
    );
  };

  /** Wheel units past max zoom that count as "zoom out further". */
  static OVERSCROLL = 360; // two notches or one flick fills it
  /** Past this share of OVERSCROLL the switch is committed. */
  static COMMIT = 0.6; // about two notches

  /** Drop any overscroll (after a view switch). */
  resetOverscroll() {
    this.#over = 0;
    this.#back = 0;
    this.overscroll = 0;
    this.#stretch = 0;
    this.#committed = false;
  }
  /** 0–1 build-up of the current overscroll (for the stretch). */
  overscroll = 0;
  onZoomPastMax = null;
  /** Eased overscroll, 0–1 (drives the stretch and the edge clouds). */
  get stretch() {
    return this.#stretch;
  }
  #over = 0;
  #back = 0;
  #committed = false;
  #overAt = 0;
  #wheelAt = 0;
  #stretch = 0;

  #onKeyDown = (e) => {
    if (e.target.matches?.('input, select, textarea')) return; // debug panel sliders use arrow keys
    if (e.repeat && (e.key === 'q' || e.key === 'e')) return;
    if (this.locked) return;
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
    if ((fx || fz) && !this.locked) {
      const speed = this.distance * 0.9 * dt;
      this.goal.addScaledVector(this.#right(), fx * speed);
      this.goal.addScaledVector(this.#forward(), fz * speed);
      this.#clamp();
    }

    this.target.lerp(this.goal, dt ? damp(this.posRate, dt) : 1);
    this.distance += (this.goalDistance - this.distance) * (dt ? damp(this.zoomRate, dt) : 1);
    this.yaw += (this.goalYaw - this.yaw) * (dt ? damp(9, dt) : 1);

    // Overscroll stretch: eases toward the build-up, which drains once the wheel stops.
    if (this.#committed) {
      // Committed: keep climbing into the clouds on its own.
      this.#over = Math.min(CameraRig.OVERSCROLL, this.#over + (dt * CameraRig.OVERSCROLL) / 0.6);
      this.overscroll = this.#over / CameraRig.OVERSCROLL;
    } else if (this.#over > 0 && performance.now() - this.#overAt > WHEEL_GAP) {
      this.#over = Math.max(0, this.#over - (dt * CameraRig.OVERSCROLL) / 1.5);
      this.overscroll = this.#over / CameraRig.OVERSCROLL;
    }
    this.#stretch += (this.overscroll - this.#stretch) * (dt ? damp(12, dt) : 1);
    // Past max the camera keeps climbing (up to ~2.2× max) into the cloud layer.
    const dist = this.distance * (1 + 1.2 * this.#stretch * this.#stretch);

    const horiz = Math.cos(this.pitch) * dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(this.pitch) * dist,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target);
  }
}
