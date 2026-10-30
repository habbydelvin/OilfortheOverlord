import * as THREE from 'three';

/**
 * Missile-strike camera shake, "trauma" style: hits add trauma (0..1), which drains linearly. The shake strength is
 * trauma^power, so a hit punches in hard and tails off smoothly. The motion is smooth value noise
 * (direction changes `freq` times a second), not per-frame random jitter, so it reads as a rattle instead
 * of a flicker. On top of that, every hit gives a downward kick on a damped spring: the view drops and
 * bounces back, which sells the weight of the impact.
 *
 * Sizes are in % of the screen height, so the shake looks the same at any zoom.
 * Apply after the camera rig has placed the camera (the rig calls lookAt every frame, so nothing builds up).
 */
export const SHAKE_DEFAULTS = {
  ampX: 5, // max sideways offset (% of screen height)
  ampY: 6, // max vertical offset (% of screen height)
  roll: 2.5, // max roll (degrees)
  freq: 14, // direction changes per second
  recover: 1.2, // trauma drained per second
  power: 1.5, // shake = trauma^power
  kick: 3, // downward kick per unit of hit (% of screen height)
  kickSpring: 260, // kick spring stiffness
  kickDamp: 14, // kick spring damping
};

export const SHAKE_PARAMS = [
  { group: 'Missile camera shake', hint: 'strength per impact is Missiles · Camera shake' },
  { key: 'ampX', label: 'Sideways (% screen)', min: 0, max: 10, step: 0.1 },
  { key: 'ampY', label: 'Vertical (% screen)', min: 0, max: 10, step: 0.1 },
  { key: 'roll', label: 'Roll (deg)', min: 0, max: 8, step: 0.1 },
  { key: 'freq', label: 'Rattle speed', min: 2, max: 40, step: 0.5, hint: 'direction changes per second' },
  { key: 'recover', label: 'Recovery (/s)', min: 0.3, max: 6, step: 0.05, hint: 'higher = shorter shake' },
  { key: 'power', label: 'Falloff power', min: 1, max: 3, step: 0.1, hint: '1 = linear tail, 2-3 = punchy hit, quick fade' },
  { key: 'kick', label: 'Impact kick (% screen)', min: 0, max: 6, step: 0.1, hint: 'the view drops and bounces back' },
  { key: 'kickSpring', label: 'Kick stiffness', min: 50, max: 800, step: 10 },
  { key: 'kickDamp', label: 'Kick damping', min: 2, max: 40, step: 0.5 },
];

const STORAGE_KEY = 'oto.shakeConfig';

export function loadShakeConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const cfg = { ...SHAKE_DEFAULTS };
  for (const k of Object.keys(cfg)) if (k in saved) cfg[k] = saved[k];
  return cfg;
}

export function saveShakeConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearShakeConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth 1D value noise in -1..1; `seed` picks an independent channel. */
function noise(seed, t) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 1013);
  const b = hash(i + 1 + seed * 1013);
  return (a + (b - a) * u) * 2 - 1;
}

export class CameraShake {
  trauma = 0;
  t = 0;
  kickY = 0; // spring offset (screen fraction)
  kickV = 0;
  #right = new THREE.Vector3();
  #up = new THREE.Vector3();

  constructor(camera, cfg) {
    this.camera = camera;
    this.cfg = cfg;
  }

  /** A hit: `amount` 0..1 (missile impact ~1, launch rumble ~0.3). */
  add(amount) {
    if (!(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
    // An undamped spring hit with velocity v peaks at v/ω, so this dips about `kick`% (a bit less with damping).
    this.kickV -= amount * (this.cfg.kick / 100) * Math.sqrt(this.cfg.kickSpring);
  }

  reset() {
    this.trauma = 0;
    this.kickY = 0;
    this.kickV = 0;
  }

  /** `distance`: camera to look-at point, used to turn screen % into world units. */
  update(dt, distance) {
    const c = this.cfg;
    // Kick spring (semi-implicit Euler, sub-stepped so stiff settings stay stable).
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.kickV += (-c.kickSpring * this.kickY - c.kickDamp * this.kickV) * h;
      this.kickY += this.kickV * h;
    }
    if (Math.abs(this.kickY) < 1e-5 && Math.abs(this.kickV) < 1e-4) this.kickY = this.kickV = 0;

    if (this.trauma <= 0 && this.kickY === 0) return;
    this.t += dt;
    const s = Math.pow(this.trauma, c.power);
    this.trauma = Math.max(0, this.trauma - c.recover * dt);

    const cam = this.camera;
    // World units per 100% of screen height at the look-at distance.
    const screen = 2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const nt = this.t * c.freq;
    const x = noise(1, nt) * s * (c.ampX / 100) * screen;
    const y = noise(2, nt) * s * (c.ampY / 100) * screen + this.kickY * screen;
    const r = noise(3, nt) * s * THREE.MathUtils.degToRad(c.roll);

    this.#right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.#up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(this.#right, x).addScaledVector(this.#up, y);
    cam.rotateZ(r);
  }
}
