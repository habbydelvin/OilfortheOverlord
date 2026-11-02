import { FOG_QUALITY_NAMES } from './fogOfWar.js';
import { TILE, applyTileGap } from './tiles.js';
import { CURVE } from './curvature.js';
import { CRT_DEFAULTS } from './crtPass.js';

/**
 * Graphics settings (Game Debug panel → Graphics), saved to localStorage.
 *   fogQuality: Low / Medium / High / Ultra (see FOG_QUALITY)
 *   resolution: render pixel ratio cap. "Auto" = device pixel ratio, capped at 2.
 *   shadows: shadow map quality.
 *   crtScreen: Shader (the CRT post-process, crtPass.js), Light (only the HTML screen layers, crt.js) or Off (default;
 *   also the CRT button in Game Debug); crt*: its tuning.
 *   mapShape: Planet (the small-planet bend, curvature.js) or Flat (the map as before); planetRadius: its radius.
 */
export const GFX = {
  fogQuality: 'Medium',
  resolution: '1',
  shadows: 'Low',
  tileGap: 0, // seam between tiles; 0 = seamless world
  mapShape: 'Planet',
  crtScreen: 'Off',
  crtBloom: CRT_DEFAULTS.bloom,
  crtCurve: CRT_DEFAULTS.curve,
  crtMask: CRT_DEFAULTS.mask,
  crtLine: CRT_DEFAULTS.lineSize,
  crtContrast: CRT_DEFAULTS.contrast,
  crtFringe: CRT_DEFAULTS.fringe,
  planetRadius: 40,
};

export const GFX_PARAMS = [
  { group: 'Graphics' },
  { key: 'fogQuality', label: 'Fog quality', type: 'select', options: FOG_QUALITY_NAMES, hint: 'Ultra = the original fog; lower = fewer/smaller billows' },
  { key: 'resolution', label: 'Resolution', type: 'select', options: ['Auto', '2', '1.5', '1', '0.75'], hint: 'pixel ratio; 1 is much cheaper on Retina screens' },
  { key: 'shadows', label: 'Shadows', type: 'select', options: ['High', 'Low', 'Off'], hint: 'High = 2048² shadow map, Low = 1024²' },
  { key: 'tileGap', label: 'Tile gap', min: 0, max: 0.08, step: 0.005, hint: '0 = seamless world; 0.03 = the old seam between tiles' },
  { key: 'crtScreen', label: 'CRT screen', type: 'select', options: ['Shader', 'Light', 'Off'], hint: 'Shader: a real CRT pass (beam scanlines, slot mask, glow, bend); Light: cheap overlay only; Off' },
  { key: 'crtBloom', label: 'CRT glow', min: 0, max: 1, step: 0.05, hint: 'around bright parts; 0 skips its passes (Shader)' },
  { key: 'crtCurve', label: 'CRT bend', min: 0, max: 0.15, step: 0.005, hint: "the tube's barrel bend (Shader)" },
  { key: 'crtMask', label: 'CRT mask', min: 0, max: 0.8, step: 0.05, hint: 'slot mask strength (Shader)' },
  { key: 'crtLine', label: 'CRT scanline size', min: 2, max: 6, step: 0.5, hint: 'CSS px per scanline (Shader)' },
  { key: 'crtContrast', label: 'CRT contrast', min: 1, max: 3, step: 0.05, hint: '(Shader)' },
  { key: 'crtFringe', label: 'CRT colour fringe', min: 0, max: 3, step: 0.1, hint: 'red / blue drift at the edges, px (Shader)' },
  { key: 'mapShape', label: 'Map shape', type: 'select', options: ['Planet', 'Flat'], hint: 'Planet: the world bends like a small planet; Flat: the map as before' },
  { key: 'planetRadius', label: 'Planet curve (radius)', min: 5, max: 150, step: 5, hint: 'in cells: smaller = rounder (Map shape: Planet)' },
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
export function applyGfx(cfg, { renderer, scene, sun, fog, crt }) {
  fog.setQuality(cfg.fogQuality);
  CURVE.radius = cfg.mapShape === 'Planet' ? cfg.planetRadius : 0;
  document.body.classList.toggle('crt-off', cfg.crtScreen === 'Off');
  document.body.classList.toggle('crt-shader', cfg.crtScreen === 'Shader');
  if (crt) {
    crt.enabled = cfg.crtScreen === 'Shader';
    Object.assign(crt.cfg, {
      bloom: cfg.crtBloom,
      curve: cfg.crtCurve,
      mask: cfg.crtMask,
      lineSize: cfg.crtLine,
      contrast: cfg.crtContrast,
      fringe: cfg.crtFringe,
    });
  }

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
