import * as THREE from 'three';
import { ICONS } from './tiles.js';

/**
 * Map icons: when the camera zooms out, a resource icon floats over each tile
 * (food / oil / manpower, a crown on the Capital, a ruin over Pre-war Ruins).
 * They fade out as you zoom back in. Tunable in Game Debug → Map icons.
 */
export const ICON_DEFAULTS = {
  fadeNear: 16, // camera distance where icons start to appear
  fadeFar: 24, // camera distance where icons are fully visible
  maxOpacity: 1,
  size: 26, // px
  height: 0.6, // world units above the tile
  scaleWithZoom: 0, // 0 = constant px size, 1 = shrinks with distance
};

export const ICON_PARAMS = [
  { group: 'Map icons (zoomed out)' },
  { key: 'fadeNear', label: 'Start fading in at', min: 6, max: 48, step: 0.5, hint: 'camera distance; closer = hidden' },
  { key: 'fadeFar', label: 'Fully visible at', min: 6, max: 48, step: 0.5, hint: 'camera distance' },
  { key: 'maxOpacity', label: 'Max opacity', min: 0, max: 1, step: 0.01 },
  { key: 'size', label: 'Icon size (px)', min: 10, max: 64, step: 1 },
  { key: 'height', label: 'Height above tile', min: 0, max: 3, step: 0.05 },
  { key: 'scaleWithZoom', label: 'Shrink with zoom', min: 0, max: 1, step: 0.01, hint: '0 = fixed px size' },
];

const STORAGE_KEY = 'oto.iconConfig';
export function loadIconConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const cfg = { ...ICON_DEFAULTS };
  for (const k of Object.keys(cfg)) if (k in saved) cfg[k] = saved[k];
  return cfg;
}
export const saveIconConfig = (cfg) => localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
export const clearIconConfig = () => localStorage.removeItem(STORAGE_KEY);

const CROWN =
  '<svg class="ico map-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#f2c94c" stroke="#1c1c1c" stroke-width="1.6" stroke-linejoin="round"/><circle cx="3" cy="8" r="1.6" fill="#f2c94c" stroke="#1c1c1c" stroke-width="1.2"/><circle cx="12" cy="5" r="1.6" fill="#f2c94c" stroke="#1c1c1c" stroke-width="1.2"/><circle cx="21" cy="8" r="1.6" fill="#f2c94c" stroke="#1c1c1c" stroke-width="1.2"/></svg>';

const RUINS =
  '<svg class="ico map-ruins" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#1c1c1c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 50V25h4v-4M7 25h3l3 3-4 3v3h4v-3h5v4h5v4l2 5v6z" fill="#8f8794"/>' +
  '<path d="M31 50V23l5 1v-2l4-1v2l3-2v-3l3 1v-3l4-1-1-3h11v40z" fill="#c9c3c9"/>' +
  '<path d="M36 28h3v4h-3zM44 28h3v4h-3zM52 28h3v4h-3zM36 38h3v4h-3zM44 38h3v4h-3zM52 38h3v4h-3zM53 18h3v4h-3zM9 40h3v4H9zM17 40h3v4h-3z"/>' +
  '<path d="M1 50h62"/></svg>';

/** Icon HTML for a terrain, or null if it gets none. */
function iconFor(terrain) {
  switch (terrain) {
    case 'farm':
      return ICONS.food;
    case 'station':
    case 'refinery':
      return ICONS.oil;
    case 'settlement':
    case 'labourcamp':
      return ICONS.manpower;
    case 'capital':
      return CROWN;
    case 'ruins':
      return RUINS;
    default:
      return null;
  }
}

export class ZoomIcons {
  constructor(layer, camera, rig, cfg) {
    this.layer = layer;
    this.camera = camera;
    this.rig = rig;
    this.cfg = cfg;
    this.els = new Map(); // cell key -> { el, terrain }
    this.v = new THREE.Vector3();
  }

  update(grid) {
    const c = this.cfg;
    const near = Math.min(c.fadeNear, c.fadeFar);
    const far = Math.max(c.fadeNear, c.fadeFar);
    const d = this.rig.distance;
    const t = far > near ? THREE.MathUtils.clamp((d - near) / (far - near), 0, 1) : d >= far ? 1 : 0;
    const alpha = t * c.maxOpacity;
    // The fade applies per icon (--map-fade), except Pre-war Ruins: always shown, blinking, at any zoom.
    const op = alpha.toFixed(3);
    if (this.layer._op !== op) this.layer.style.setProperty('--map-fade', (this.layer._op = op));
    const hidden = alpha <= 0; // then only the ruins are projected

    const scale = 1 - c.scaleWithZoom + c.scaleWithZoom * (far / Math.max(d, 0.001));
    const size = `${(c.size * scale).toFixed(1)}px`;
    if (this.layer._size !== size) this.layer.style.setProperty('--map-ico', (this.layer._size = size));

    const w = window.innerWidth;
    const h = window.innerHeight;
    const live = new Set();
    for (const cell of grid.cells.values()) {
      const html = iconFor(cell.terrain);
      if (!html || (hidden && cell.terrain !== 'ruins')) continue;
      const k = `${cell.x},${cell.z}`;
      live.add(k);
      let rec = this.els.get(k);
      if (!rec || rec.terrain !== cell.terrain) {
        rec?.el.remove();
        const el = document.createElement('div');
        el.className = cell.terrain === 'ruins' ? 'map-icon map-icon-ruins' : 'map-icon';
        el.innerHTML = html;
        this.layer.appendChild(el);
        rec = { el, terrain: cell.terrain };
        this.els.set(k, rec);
      }
      // An idle building (no workers, greyed out on the board) shows a greyed-out icon too.
      const idle = cell.mesh?.userData.idle === true;
      if (rec.el._idle !== idle) rec.el.classList.toggle('idle', (rec.el._idle = idle));
      this.v.set(cell.x, c.height, cell.z).project(this.camera);
      const px = (this.v.x * 0.5 + 0.5) * w;
      const py = (-this.v.y * 0.5 + 0.5) * h;
      const tf = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
      if (rec.el._tf !== tf) rec.el.style.transform = rec.el._tf = tf;
    }
    for (const [k, rec] of this.els) {
      if (live.has(k)) continue;
      rec.el.remove();
      this.els.delete(k);
    }
  }
}
