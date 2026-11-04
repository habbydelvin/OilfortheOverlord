import * as THREE from 'three';
import { hexToWorld } from './grid.js';
import { ICONS } from './tiles.js';

/**
 * Map icons: when the camera zooms out, a resource icon floats over each tile
 * (food / oil / manpower / missile, a crown on the Capital, a ruin over Pre-war Ruins).
 * Boosters (Water Pump, Oasis, Tar Pit, Refinery) get their own icon with a live "+n" tag: what they add to their
 * neighbours this season (for the Refinery, the extra oil its multiplier makes).
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

// Boosters: tiles that add to their neighbours' output instead of producing anything themselves.
const WATER =
  '<svg class="ico map-water" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-3.2 4.6-6.6 8.4-6.6 12a6.6 6.6 0 0013.2 0c0-3.6-3.4-7.4-6.6-12z" fill="#4fb3e8" stroke="#1c1c1c" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.9 15.2a3.2 3.2 0 002.8 3.1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/></svg>';

const PALM =
  '<svg class="ico map-palm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.6c3.2-1.7 14.8-1.7 18 0" fill="none" stroke="#4fb3e8" stroke-width="2.4" stroke-linecap="round"/><path d="M12.6 19.2c.4-3.6-.2-7-1.6-10.2" fill="none" stroke="#8a5a32" stroke-width="2" stroke-linecap="round"/><path d="M11 9C9 6 5.5 5.8 3.4 7.6 6 7.8 8.4 8.6 11 9zm0 0c1.4-3.2 4.8-4.4 7.5-3.2-2.4.6-4.9 1.6-7.5 3.2zm0 0c-3-.6-5.9 1-6.7 3.7 2-1.4 4.2-2.5 6.7-3.7zm0 0c3-.4 5.7 1.4 6.3 4.1-1.8-1.7-4-2.9-6.3-4.1z" fill="#6cc04a" stroke="#1c1c1c" stroke-width="1" stroke-linejoin="round"/></svg>';

const TAR =
  '<svg class="ico map-tar" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 15.4c0-2.6 3.4-3.7 5.7-3.2 1.3-2.4 5.5-2.8 7.3-.6 2.6-.4 5.4 1 5.4 3.6 0 2.9-4.3 4.5-9.2 4.5s-9.2-1.4-9.2-4.3z" fill="#2a1f2e" stroke="#c9a86a" stroke-width="1.3" stroke-linejoin="round"/><circle cx="9.6" cy="7.4" r="2" fill="#2a1f2e" stroke="#c9a86a" stroke-width="1.2"/><circle cx="14.8" cy="4.6" r="1.2" fill="#2a1f2e" stroke="#c9a86a" stroke-width="1"/><path d="M7 15.2c1.2-.8 2.6-1 3.8-.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity="0.45"/></svg>';

const REFINERY =
  '<svg class="ico map-refinery" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2.2c-1.5 1.6-2 2.9-1.2 4.2.4-.8 1-1.2 1.6-1.4-.2 1 .2 1.7 1 2 .8-1.4.4-3-1.4-4.8z" fill="#ffb347" stroke="#1c1c1c" stroke-width="0.9" stroke-linejoin="round"/><rect x="8.2" y="7" width="6" height="14" rx="2" fill="#9aa3ab" stroke="#1c1c1c" stroke-width="1.3"/><path d="M8.6 10.6h5.2M8.6 14.4h5.2M8.6 18.2h5.2" stroke="#c0392b" stroke-width="1.5"/><rect x="15.4" y="13" width="5" height="8" rx="1.6" fill="#d0782a" stroke="#1c1c1c" stroke-width="1.3"/><path d="M14.2 16h1.2" stroke="#1c1c1c" stroke-width="1.3"/><path d="M3 21.2h18" stroke="#1c1c1c" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Magazine: a strapped crate (missile storage, not production). */
const CRATE =
  '<svg class="ico map-crate" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 8.4L12 4.6l8.4 3.8v9.4L12 21.6 3.6 17.8z" fill="#c4a46a" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 4.6v17" stroke="#1c1c1c" stroke-width="1.2"/><path d="M3.6 8.4h16.8" stroke="#1c1c1c" stroke-width="1.2"/><path d="M7 10.6h2.4v3.4H7zM14.6 10.6H17v3.4h-2.4z" fill="#8a6a38" stroke="#1c1c1c" stroke-width="0.9"/></svg>';

/** Military Factory: a steel missile (same silhouette as the HUD launch button). */
const MISSILE =
  '<svg class="ico map-missile" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(45 12 12)"><path d="M12 1.6c2 1.6 3.1 4 3.1 6.6v7.6h-6.2V8.2c0-2.6 1.1-5 3.1-6.6z" fill="#c5cdd3" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.1 12.4l-3.2 3.6v2.4l3.2-1.5zM14.9 12.4l3.2 3.6v2.4l-3.2-1.5z" fill="#d0782a" stroke="#1c1c1c" stroke-width="1.1" stroke-linejoin="round"/><path d="M10.2 16.8h3.6l-.5 2.1h-2.6z" fill="#9aa3ab" stroke="#1c1c1c" stroke-width="1.1" stroke-linejoin="round"/><path d="M10.9 19.8h2.2L12 22.4z" fill="#ff8a2a" stroke="#1c1c1c" stroke-width="1" stroke-linejoin="round"/></g></svg>';

/** Decoy Builder: a hollow diamond splitting into three (one decoy, many blips). */
const DECOY =
  '<svg class="ico map-decoy" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l5 6.4-5 6.4-5-6.4z" fill="#d8dcc4" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 18.4l2-2.4 2 2.4-2 2.4zM10 19l2-2.4 2 2.4-2 2.4zM15 18.4l2-2.4 2 2.4-2 2.4z" fill="#b8bea0" stroke="#1c1c1c" stroke-width="1" stroke-linejoin="round"/></svg>';

/** Launch Accelerator: a chevron over speed lines. */
const BOOSTER =
  '<svg class="ico map-booster" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l7-8 7 8h-4l-3-3.4L9 13z" fill="#ffc84a" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 19.5l7-8 7 8h-4l-3-3.4L9 19.5z" fill="#9ad8ff" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/></svg>';

/** Bandit and rebel camps: a red devil's head (horns, ears, eyes, grin), dark outline like the others. */
const DEVIL =
  '<svg class="ico map-devil" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.6 9.4C4 7.6 3.4 5 4 2.6c1.3 1.8 3 3 5 3.6M18.4 9.4c1.6-1.8 2.2-4.4 1.6-6.8-1.3 1.8-3 3-5 3.6" fill="#f2c94c" stroke="#1c1c1c" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 5.4c-4.2 0-7.2 3-7.2 7.2 0 4.6 3.3 8.8 7.2 8.8s7.2-4.2 7.2-8.8c0-4.2-3-7.2-7.2-7.2z" fill="#d23a2a" stroke="#1c1c1c" stroke-width="1.4"/><path d="M7.6 11.4l3 1.4-.2 1.2-2.4-.6zM16.4 11.4l-3 1.4.2 1.2 2.4-.6z" fill="#ffe27a" stroke="#1c1c1c" stroke-width="0.9" stroke-linejoin="round"/><path d="M8.6 16.2c1 1.6 2.2 2.2 3.4 2.2s2.4-.6 3.4-2.2" fill="none" stroke="#1c1c1c" stroke-width="1.4" stroke-linecap="round"/><path d="M10.2 17.4l.5 1M13.8 17.4l-.5 1" stroke="#fff" stroke-width="0.9" stroke-linecap="round"/></svg>';

/** The map icons' drawings, for the icon legend (legend.js). */
export const MAP_ICONS = { crown: CROWN, ruins: RUINS, water: WATER, palm: PALM, tar: TAR, refinery: REFINERY, missile: MISSILE, crate: CRATE, devil: DEVIL, decoy: DECOY, booster: BOOSTER };

/** Booster tiles: their icon and the resource they add to their neighbours (shown as a live "+n" tag). */
const BOOSTERS = {
  pump: { icon: WATER, res: 'food' },
  oasis: { icon: PALM, res: 'food' },
  tarpit: { icon: TAR, res: 'oil' },
  refinery: { icon: REFINERY, res: 'oil' }, // the extra oil its multiplier makes
};

/** Icon HTML for a terrain, or null if it gets none. */
function iconFor(terrain) {
  if (BOOSTERS[terrain]) return BOOSTERS[terrain].icon;
  switch (terrain) {
    case 'farm':
      return ICONS.food;
    case 'station':
      return ICONS.oil;
    case 'milfactory':
      return MISSILE;
    case 'magazine':
      return CRATE;
    case 'decoyworks':
      return DECOY;
    case 'booster':
      return BOOSTER;
    case 'settlement':
    case 'labourcamp':
    case 'missilelab':
    case 'warhead':
      return ICONS.manpower;
    case 'capital':
      return CROWN;
    case 'ruins':
      return RUINS;
    case 'raider': // rebel camp
    case 'bandit_raider':
    case 'bandit_siphon':
    case 'bandit_scav':
      return DEVIL;
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
    this.els = new Map(); // cell key -> { el, terrain, tag }
    this.v = new THREE.Vector3();
    this.boosts = new Map(); // booster cell key -> what it adds this season (computeEconomy's `boosts`)
  }

  /** The boosters' current bonuses, from the latest economy (call whenever it's recalculated). */
  setBoosts(boosts) {
    this.boosts = boosts ?? new Map();
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
        // Boosters carry a "+n" tag with the resource they add (filled in below).
        const booster = BOOSTERS[cell.terrain];
        let tag = null;
        if (booster) {
          el.classList.add('map-icon-boost');
          tag = document.createElement('span');
          tag.className = 'map-boost';
          tag.innerHTML = `<b></b>${ICONS[booster.res]}`;
          el.appendChild(tag);
        }
        this.layer.appendChild(el);
        rec = { el, terrain: cell.terrain, tag };
        this.els.set(k, rec);
      }
      if (rec.tag) {
        const amount = Math.round(this.boosts.get(k) ?? 0);
        if (rec.amount !== amount) {
          rec.amount = amount;
          rec.tag.firstChild.textContent = `+${amount}`;
          rec.el.classList.toggle('unused', amount === 0); // boosting nothing right now: greyed like an idle building
        }
      }
      // An idle building (no workers, greyed out on the board) shows a greyed-out icon too.
      const idle = cell.mesh?.userData.idle === true;
      if (rec.el._idle !== idle) rec.el.classList.toggle('idle', (rec.el._idle = idle));
      const pos = hexToWorld(cell.x, cell.z); // not `w`: that is the screen width used just below
      this.v.set(pos.x, c.height, pos.z).project(this.camera);
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
