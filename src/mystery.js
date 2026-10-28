import * as THREE from 'three';
import { PLOT, key, plotOf, plotCenter } from './grid.js';

/** What a mystery site can turn out to be, with relative odds. Tune freely. */
export const MYSTERY_POOL = [
  ['capital', 3], // a free city joins you
  ['tarpit', 3],
  ['refinery', 2],
  ['pump', 2],
  ['ruins', 4], // Pre-war Ruins: build next to them to clear and refill your hand
];

/** Sites are scattered over plots up to this many plots from the start (Chebyshev distance). */
const MAX_RING = 4;
/** Total number of sites per game. */
const SITE_COUNT = 10;
/** Two site plots must be at least this many plots apart (2 = never touching, even diagonally). */
const MIN_PLOT_GAP = 2;

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
   * Scatter fresh sites around the starting plot (never in it): at most one per plot, and
   * site plots never touch each other, so they're spread across the map.
   */
  reset() {
    this.group.clear();
    this.sites.clear();
    const ring = (px, pz) => Math.max(Math.abs(px), Math.abs(pz));
    const plots = [];
    for (let px = -MAX_RING; px <= MAX_RING; px++)
      for (let pz = -MAX_RING; pz <= MAX_RING; pz++) if (ring(px, pz) > 0) plots.push([px, pz]);
    shuffle(plots);
    // One site close to the start so the first few pieces can find something.
    plots.sort((a, b) => (ring(...a) === 1 ? 0 : 1) - (ring(...b) === 1 ? 0 : 1));
    const chosen = [];
    for (const [px, pz] of plots) {
      if (chosen.length >= SITE_COUNT) break;
      if (chosen.length && ring(px, pz) === 1) continue; // only one in the first ring
      if (chosen.some(([cx, cz]) => ring(px - cx, pz - cz) < MIN_PLOT_GAP)) continue;
      chosen.push([px, pz]);
      const x = plotCenter(px) + Math.floor(Math.random() * PLOT) - 1;
      const z = plotCenter(pz) + Math.floor(Math.random() * PLOT) - 1;
      this.#add(x, z);
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
