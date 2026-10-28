import { FOG_QUALITY_NAMES } from './fogOfWar.js';
import { TILE, applyTileGap } from './tiles.js';

/**
 * Graphics settings (Game Debug panel → Graphics), saved to localStorage.
 *   fogQuality: Low / Medium / High / Ultra (see FOG_QUALITY)
 *   resolution: render pixel ratio cap. "Auto" = device pixel ratio, capped at 2.
 *   shadows: shadow map quality.
 */
export const GFX = {
  fogQuality: 'Medium',
  resolution: '1',
  shadows: 'Low',
  tileGap: 0, // seam between tiles; 0 = seamless world
};

export const GFX_PARAMS = [
  { group: 'Graphics' },
  { key: 'fogQuality', label: 'Fog quality', type: 'select', options: FOG_QUALITY_NAMES, hint: 'Ultra = the original fog; lower = fewer/smaller billows' },
  { key: 'resolution', label: 'Resolution', type: 'select', options: ['Auto', '2', '1.5', '1', '0.75'], hint: 'pixel ratio; 1 is much cheaper on Retina screens' },
  { key: 'shadows', label: 'Shadows', type: 'select', options: ['High', 'Low', 'Off'], hint: 'High = 2048² shadow map, Low = 1024²' },
  { key: 'tileGap', label: 'Tile gap', min: 0, max: 0.08, step: 0.005, hint: '0 = seamless world; 0.03 = the old seam between tiles' },
];

export const GFX_DEFAULTS = { ...GFX };
const KEY = 'oto.gfx';

export function loadGfxConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const p of GFX_PARAMS) {
      if (!p.key) continue;
      const v = saved[p.key];
      if (p.options ? p.options.includes(v) : typeof v === 'number' && v >= p.min && v <= p.max) GFX[p.key] = v;
    }
  } catch {
    /* keep defaults */
  }
  return GFX;
}

export const saveGfxConfig = (cfg) => localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.keys(GFX_DEFAULTS).map((k) => [k, cfg[k]]))));
export const clearGfxConfig = () => localStorage.removeItem(KEY);

export function pixelRatioFor(resolution) {
  return resolution === 'Auto' ? Math.min(window.devicePixelRatio, 2) : Number(resolution);
}

/** Apply every graphics setting. `sun` is the shadow-casting light. */
export function applyGfx(cfg, { renderer, scene, sun, fog }) {
  fog.setQuality(cfg.fogQuality);

  if (TILE.gap !== cfg.tileGap) {
    TILE.gap = cfg.tileGap;
    applyTileGap(scene); // every placed tile and the ghost; new tiles pick it up as they're made
  }

  const pr = pixelRatioFor(cfg.resolution);
  if (renderer.getPixelRatio() !== pr) {
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  const shadowsOn = cfg.shadows !== 'Off';
  const size = cfg.shadows === 'Low' ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // reallocated at the new size on the next render
  }
  if (renderer.shadowMap.enabled !== shadowsOn) {
    renderer.shadowMap.enabled = shadowsOn;
    // Shadow sampling is compiled into the shaders: rebuild them.
    scene.traverse((o) => {
      if (o.material) for (const m of [o.material].flat()) m.needsUpdate = true;
    });
  }
}
