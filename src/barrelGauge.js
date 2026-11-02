/**
 * The tribute gauge: a row of barrels at the top that fill with oil (one barrel per barrel of quota, or several per
 * barrel once the quota is past MAX_BARRELS). At payout, oil flies from each producing tile into the next barrel to
 * fill (OilFlights), and only fills it on arrival: a slosh, a flash, and a knock that rises as the tribute fills.
 */
import { ICONS } from './tiles.js';

const MAX_BARRELS = 20;
const FLIGHT = 0.7; // seconds from the tile to the barrel
const STAGGER = 0.07; // between barrels from the same tile
const MAX_PER_TILE = 6; // a big producer sends its oil in this many barrels at most

export class BarrelGauge {
  quota = 0;
  amount = 0;
  per = 1; // barrels of oil per gauge barrel

  constructor(el) {
    this.el = el;
    this.slots = [];
  }

  /** The gauge barrel that the `n`th barrel of oil (1-based) goes into. */
  slotFor(n) {
    const i = Math.max(0, Math.min(this.slots.length - 1, Math.ceil(n / this.per) - 1));
    return this.slots[i]?.el ?? this.el;
  }

  /** Show `amount` barrels of `quota`. `hit`: the barrels that just got oil slosh and flash. */
  show(amount, quota, hit = false) {
    if (quota !== this.quota) this.#build(quota);
    const before = this.amount;
    this.amount = amount;
    this.slots.forEach((s, i) => {
      const from = i * this.per;
      const cap = Math.min(this.per, quota - from);
      const level = Math.max(0, Math.min(1, (amount - from) / cap));
      if (level === s.level) return;
      const filled = level === 1 && s.level < 1;
      s.level = level;
      s.oil.style.height = `${(level * 100).toFixed(1)}%`;
      s.el.classList.toggle('full', level === 1);
      if (hit && amount > before) {
        restart(s.el, 'hit');
        if (filled) restart(s.el, 'filled');
      }
    });
    this.el.classList.toggle('met', amount >= quota && quota > 0);
  }

  #build(quota) {
    this.quota = quota;
    this.per = quota <= MAX_BARRELS ? 1 : Math.ceil(quota / MAX_BARRELS);
    const n = Math.max(1, Math.ceil(quota / this.per));
    this.el.innerHTML = '';
    this.slots = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'qb';
      el.innerHTML = '<div class="qb-body"><div class="qb-oil"></div></div>';
      this.el.append(el);
      this.slots.push({ el, oil: el.querySelector('.qb-oil'), level: -1 });
    }
    this.amount = 0;
  }
}

/** Retrigger a one-shot CSS animation class. */
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/**
 * Oil barrels flying from the board to the gauge. launch() sends a tile's oil; each barrel adds its share to the
 * gauge when it lands (onLand(amountShownNow, slotElement)).
 */
export class OilFlights {
  #flights = [];

  constructor(layer, gauge, onLand) {
    this.layer = layer;
    this.gauge = gauge;
    this.onLand = onLand;
  }

  get active() {
    return this.#flights.length > 0;
  }

  /**
   * A tile at screen point `from` made `oil` barrels, taking the shown total from `start` to `start + oil`.
   * Split into up to MAX_PER_TILE flying barrels; each lands on the gauge barrel its share fills.
   */
  launch(from, oil, start) {
    const n = Math.max(1, Math.min(MAX_PER_TILE, Math.round(oil)));
    let total = start;
    for (let k = 0; k < n; k++) {
      const share = Math.floor(oil / n) + (k < oil % n ? 1 : 0);
      if (!share) continue;
      total += share;
      const el = document.createElement('div');
      el.className = 'oil-flight';
      el.innerHTML = ICONS.oil;
      el.style.opacity = '0';
      this.layer.append(el);
      this.#flights.push({ el, from, value: total, age: -k * STAGGER, side: (k % 2 ? 1 : -1) * (20 + k * 9) });
    }
  }

  /** Every frame. */
  update(dt) {
    for (let i = this.#flights.length - 1; i >= 0; i--) {
      const f = this.#flights[i];
      f.age += dt;
      if (f.age < 0) continue;
      // Aim at the barrel this share fills, read every frame (the HUD may move).
      const r = this.gauge.slotFor(f.value).getBoundingClientRect();
      const to = [r.left + r.width / 2, r.top + r.height / 2];
      const t = Math.min(1, f.age / FLIGHT);
      if (t >= 1) {
        f.el.remove();
        this.#flights.splice(i, 1);
        this.onLand(f.value);
        continue;
      }
      // An arc: up and a little sideways first, then a dive into the barrel (accelerating).
      const e = t * t * (3 - 2 * t) * 0.35 + t * t * 0.65;
      const [x0, y0] = f.from;
      const cx = (x0 + to[0]) / 2 + f.side;
      const cy = Math.min(y0, to[1]) - 90;
      const x = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e * e * to[0];
      const y = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e * e * to[1];
      const s = 1.25 - 0.55 * t;
      f.el.style.opacity = String(Math.min(1, t * 6));
      f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)}) rotate(${(t * 200 * Math.sign(f.side)).toFixed(0)}deg)`;
    }
  }

  /** Land everything now (the payout was skipped). */
  finish() {
    for (const f of this.#flights) {
      f.el.remove();
      this.onLand(f.value);
    }
    this.#flights = [];
  }

  /** Drop everything without landing it (a reset). */
  clear() {
    for (const f of this.#flights) f.el.remove();
    this.#flights = [];
  }
}
