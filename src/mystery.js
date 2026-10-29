import * as THREE from 'three';
import { PLOT, WORLD_HALF, key, plotOf, plotCenter } from './grid.js';

/** What a mystery site can turn out to be, with relative odds. Tune freely. */
export const MYSTERY_POOL = [
  ['capital', 3], // a free city joins you
  ['tarpit', 3],
  ['refinery', 2],
  ['pump', 2],
  ['ruins', 4], // Pre-war Ruins: build next to them to clear and refill your hand
];

/**
 * Sites per distance band, filled from the inside out. A band covers plots whose Chebyshev distance
 * (in plots) from the start lies in [from, to]; each game rolls a random count in [min, max] for it.
 * Ring 19 is the last whose cells (up to ±58) fit inside the world (WORLD_HALF = 60, grid.js).
 */
const LAST_RING = Math.floor((WORLD_HALF - 1) / PLOT); // farthest plot ring whose cells all stay in the world
const SITE_BANDS = [
  { from: 1, to: 1, min: 1, max: 1 }, // one close to the start so the first pieces find something
  { from: 2, to: 4, min: 7, max: 11 },
  { from: 5, to: 9, min: 14, max: 22 },
  { from: 10, to: 14, min: 18, max: 28 },
  { from: 15, to: LAST_RING, min: 20, max: 32 },
];
/** Two site plots must be at least this many plots apart (2 = never touching, even diagonally). */
const MIN_PLOT_GAP = 2;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function pickReveal() {
  let r = Math.random() * MYSTERY_POOL.reduce((s, [, w]) => s + w, 0);
  for (const [terrain, w] of MYSTERY_POOL) {
    r -= w;
    if (r <= 0) return terrain;
  }
  return MYSTERY_POOL[0][0];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "?" texture shared by every marker. */
function questionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2326';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#e8bf68';
  g.stroke();
  g.fillStyle = '#e8bf68';
  g.font = 'bold 84px "Avenir Next", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Mystery sites: "?" markers scattered over the map. Building next to one reveals it
 * as a tile (a free Capital, Pre-war Ruins, a Tar Pit or a special building), decided on reveal.
 */
export class Mysteries {
  sites = new Map(); // cell key -> { x, z, sprite }

  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spriteMat = new THREE.SpriteMaterial({ map: questionTexture(), depthWrite: false });
  }

  /**
   * Scatter fresh sites over the whole world (never in the starting plot): a random number per
   * distance band (SITE_BANDS), at most one per plot, and site plots never touch each other.
   */
  reset() {
    this.group.clear();
    this.sites.clear();
    const ring = (px, pz) => Math.max(Math.abs(px), Math.abs(pz));
    const chosen = [];
    for (const band of SITE_BANDS) {
      const plots = [];
      for (let px = -band.to; px <= band.to; px++)
        for (let pz = -band.to; pz <= band.to; pz++) if (ring(px, pz) >= band.from) plots.push([px, pz]);
      shuffle(plots);
      let left = randInt(band.min, band.max);
      for (const [px, pz] of plots) {
        if (!left) break;
        if (chosen.some(([cx, cz]) => ring(px - cx, pz - cz) < MIN_PLOT_GAP)) continue;
        chosen.push([px, pz]);
        left--;
        const x = plotCenter(px) + Math.floor(Math.random() * PLOT) - 1;
        const z = plotCenter(pz) + Math.floor(Math.random() * PLOT) - 1;
        this.#add(x, z);
      }
    }
  }

  #add(x, z) {
    const sprite = new THREE.Sprite(this.spriteMat);
    sprite.scale.set(0.7, 0.7, 1);
    sprite.position.set(x, 0.6, z);
    sprite.renderOrder = 10; // drawn after the fog-of-war clouds, so the "?" teases through them
    this.group.add(sprite);
    this.sites.set(key(x, z), { x, z, sprite });
  }

  has(x, z) {
    return this.sites.has(key(x, z));
  }

  /** Expansion mode: removes the sites inside plot (px, pz) and returns [{ x, z, terrain }] for each. */
  reveal(px, pz) {
    const out = [];
    for (const [k, s] of this.sites) {
      if (plotOf(s.x) !== px || plotOf(s.z) !== pz) continue;
      this.group.remove(s.sprite);
      this.sites.delete(k);
      out.push({ x: s.x, z: s.z, terrain: pickReveal() });
    }
    return out;
  }

  /** Free placement: removes the sites touching any of `cells` on a side and returns [{ x, z, terrain }] for each. */
  revealAround(cells) {
    const out = [];
    for (const [k, s] of this.sites) {
      if (!cells.some(([x, z]) => Math.abs(x - s.x) + Math.abs(z - s.z) === 1)) continue;
      this.group.remove(s.sprite);
      this.sites.delete(k);
      out.push({ x: s.x, z: s.z, terrain: pickReveal() });
    }
    return out;
  }

  /** Removes the site nearest to any of `cells` (Manhattan) and returns { x, z, terrain }, or null. */
  revealNearest(cells) {
    let best = null;
    let bestD = Infinity;
    for (const [k, s] of this.sites) {
      for (const [x, z] of cells) {
        const d = Math.abs(x - s.x) + Math.abs(z - s.z);
        if (d < bestD) {
          bestD = d;
          best = [k, s];
        }
      }
    }
    if (!best) return null;
    const [k, s] = best;
    this.group.remove(s.sprite);
    this.sites.delete(k);
    return { x: s.x, z: s.z, terrain: pickReveal() };
  }

  update(time) {
    for (const s of this.sites.values()) {
      s.sprite.position.y = 0.6 + Math.sin(time * 2 + s.x * 0.9 + s.z * 0.6) * 0.08;
    }
  }
}
