import * as THREE from 'three';

const TILE_H = 0.62; // cap + soil height, used to squash from the bottom

const RES = {
  food: { word: 'food', color: '#9be36f' },
  manpower: { word: 'manpower', color: '#f0b27a' },
  oil: { word: 'oil', color: '#ffb347' },
  population: { word: 'population', color: '#8fe0ff' },
};

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** Tile hop: squash, launch, fall, land squish. Phases are fractions of cfg.hopDuration. */
function hop(t, c) {
  const d = c.hopDuration;
  const a = d * 0.19; // anticipation
  const r = d * 0.29; // rise
  const f = d * 0.29; // fall
  const l = d * 0.23; // land squish
  const sqX = 1 + (1 - c.squash) * 0.6; // bulge sideways when squashed
  const stX = 1 - (c.stretch - 1) * 0.45; // thin out when stretched
  if (t < a) {
    const p = easeOut(t / a);
    return { y: 0, sy: lerp(1, c.squash, p), sx: lerp(1, sqX, p) };
  }
  t -= a;
  if (t < r) {
    const p = easeOut(t / r);
    return { y: c.hopHeight * p, sy: lerp(c.squash, c.stretch, p), sx: lerp(sqX, stX, p) };
  }
  t -= r;
  if (t < f) {
    const p = t / f;
    return { y: c.hopHeight * (1 - easeIn(p)), sy: lerp(c.stretch, 1, p), sx: lerp(stX, 1, p) };
  }
  t -= f;
  const s = Math.sin(Math.min(t / l, 1) * Math.PI) * c.landSquish;
  return { y: 0, sy: 1 - s, sx: 1 + s * 0.5 };
}

const dist = (t) => Math.abs(t.x) + Math.abs(t.z);
function ordered(tiles, order) {
  const out = [...tiles];
  if (order === 'sweep') return out.sort((a, b) => a.x - b.x || a.z - b.z);
  if (order === 'random') {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  return out.sort((a, b) => dist(a) - dist(b) || a.x - b.x); // ripple / together
}

/**
 * End-of-turn payout: tiles hop one after another and each one flashes the resources it
 * produced above itself. All timing and shape values come from `cfg` (see payoutConfig.js),
 * which is read live so the debug panel can tweak it.
 */
export class Payout {
  items = [];
  time = 0;
  done = null;

  constructor(camera, layer, cfg) {
    this.camera = camera;
    this.layer = layer;
    this.cfg = cfg;
    this.v = new THREE.Vector3();
  }

  get active() {
    return this.items.length > 0;
  }

  /**
   * tiles: [{ mesh, x, z, food, manpower, oil }]
   * onFire(tile): called when a tile pops (e.g. to tick counters)
   * onDone(): called after the last label fades
   */
  start(tiles, onFire, onDone) {
    this.clear();
    const c = this.cfg;
    // `finale` tiles (e.g. population growth) always go last, after a short beat.
    const finale = tiles.filter((t) => t.finale);
    tiles = ordered(
      tiles.filter((t) => !t.finale),
      c.order,
    );
    const stagger = c.order === 'together' || !tiles.length ? 0 : Math.min(c.stagger, c.maxRipple / tiles.length);
    const finaleAt = (tiles.length ? (tiles.length - 1) * stagger : 0) + c.hopDuration;
    tiles = [...tiles, ...finale];
    this.layer.style.setProperty('--floater-size', `${c.labelSize}px`);
    this.time = 0;
    this.onFire = onFire;
    this.done = onDone;
    tiles.forEach((tile, i) => {
      const rows = ['population', 'oil', 'food', 'manpower']
        .filter((r) => tile[r])
        .map(
          (r) =>
            `<div class="row${tile[r] < 0 ? ' neg' : ''}" style="--c:${RES[r].color}">` +
            `<b>${tile[r] > 0 ? '+' : ''}${tile[r]}</b><span>${RES[r].word}</span></div>`,
        )
        .join('');
      let el = null;
      if (rows) {
        el = document.createElement('div');
        el.className = 'floater';
        el.innerHTML = rows;
        el.style.opacity = 0;
        this.layer.appendChild(el);
      }
      this.items.push({ tile, el, start: tile.finale ? finaleAt : i * stagger, fired: false });
    });
    if (!this.items.length) this.#finish();
  }

  /** Jump straight to the end. */
  skip() {
    if (!this.active) return;
    for (const it of this.items) if (!it.fired) this.onFire?.(it.tile);
    this.#finish();
  }

  /** Stop without calling onDone. */
  cancel() {
    this.done = null;
    this.clear();
  }

  clear() {
    for (const it of this.items) {
      it.el?.remove();
      it.tile.mesh.position.y = 0;
      it.tile.mesh.scale.set(1, 1, 1);
    }
    this.items = [];
  }

  #finish() {
    this.clear();
    const done = this.done;
    this.done = null;
    done?.();
  }

  update(dt) {
    if (!this.active) return;
    const c = this.cfg;
    this.time += dt;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let alive = false;

    for (const it of this.items) {
      const t = this.time - it.start;
      if (t < 0) {
        alive = true;
        continue;
      }

      // Tile hop (pivot at the bottom so squashes look grounded).
      const m = it.tile.mesh;
      if (t < c.hopDuration) {
        const { y, sx, sy } = hop(t, c);
        m.scale.set(sx, sy, sx);
        m.position.y = y + TILE_H * (sy - 1);
        alive = true;
      } else {
        m.scale.set(1, 1, 1);
        m.position.y = 0;
      }

      if (!it.fired && t >= c.labelDelay) {
        it.fired = true;
        this.onFire?.(it.tile);
      }

      // Floating label: punch in, drift up, fade out.
      if (it.el) {
        const a = t - c.labelDelay;
        if (a < 0) {
          alive = true;
          continue;
        }
        if (a < c.labelLife) alive = true;
        const p = Math.min(a / c.labelLife, 1);
        const pt = c.labelPopTime;
        const scale =
          a < pt
            ? lerp(0.2, 1, easeOutBack(a / pt)) * c.labelPop
            : lerp(c.labelPop, 1, Math.min((a - pt) / 0.2, 1));
        const rise = c.labelStartY + c.labelRise * easeOut(p);
        this.v.set(it.tile.x, rise, it.tile.z).project(this.camera);
        const px = (this.v.x * 0.5 + 0.5) * w;
        const py = (-this.v.y * 0.5 + 0.5) * h;
        const wobTime = pt * 1.8;
        const wobble = a < wobTime ? Math.sin(a * 40) * (1 - a / wobTime) * c.labelWobble : 0;
        it.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%) scale(${scale}) rotate(${wobble}deg)`;
        const fs = Math.min(c.fadeStart, 0.999);
        it.el.style.opacity = p > fs ? 1 - (p - fs) / (1 - fs) : 1;
      }
    }

    if (!alive) this.#finish();
  }
}
