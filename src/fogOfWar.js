import * as THREE from 'three';
import { PLOT, plotCenter } from './grid.js';

/**
 * Expansion-mode fog of war: a Civ V style cloud blanket over every locked plot.
 * When a plot is unlocked its clouds part outward from the middle.
 *
 * Ported from Wayberth's island mist (city-diorama-overview/src/island-mist.js), adapted for:
 *   - a square grid of 3×3 plots instead of island polygons,
 *   - an unbounded map: one wrapping field of billows follows the camera,
 *   - a per-cell mask texture (R = locked, G = thickness) instead of per-island meshes.
 * No textures are needed; all cloud shapes come from the shaders.
 */
export const FOG = {
  color: '#c38f65',
  shade: 0.28, // darker variation between billows, for depth
  veilShade: 0.3, // the veil is the shadowed base the billows sit on
  veilOpacity: 0.96,
  window: 84, // world units of the wrapping billow field (must exceed 2 × the max fade radius)
  step: 0.6, // billow spacing on the lowest layer
  sizeRatio: 2.8, // billow quad size ÷ spacing
  layers: [
    // From the ground up: wider, larger and thinner, so the blanket reads as one volume.
    { spacing: 1, size: 1, alpha: 0.6, y: 0.45 },
    { spacing: 1.3, size: 1.15, alpha: 0.5, y: 0.95 },
    { spacing: 1.65, size: 1.3, alpha: 0.42, y: 1.45 },
  ],
  drift: 3,
  breathing: 0.22,
  optionThickness: 0.82, // clouds over plots offered for expansion
  hoverThickness: 0.2, // ...and over the hovered offer
  thicknessRate: 1, // how fast thickness changes (per second)
  revealDuration: 2.25, // seconds for the clouds to part
  revealSpread: 1.8, // how far billows drift outward as they clear
  margin: 0.2, // gap (world units) kept between the fog and open territory
  fadeRadius: 0.75, // matches the sand's fade-to-black radius (× camera distance)
  // Tile landings: a gust pushes nearby billows back, and the clouds near the land wear thinner.
  gustRadius: 2.3, // world units the shockwave reaches
  gustPush: 0.95, // how far billows get shoved at the impact point
  gustDuration: 2.95, // seconds until the pushed billows have drifted back
  // Set to match the gust, so the cleared clouds stay cleared instead of rolling back in.
  erodeNear: 0.39, // thickness lost per landing on locked cells touching the tile
  erodeFar: 0.25, // ...and one cell further out
  erodeFloor: 0, // clouds never wear thinner than this
};

/** Fog sliders for the Game Debug panel. `layout` ones rebuild the billows. */
export const FOG_PARAMS = [
  { group: 'Fog · look' },
  { key: 'color', label: 'Fog colour', type: 'color', hint: 'try #5a4632 for dark brown smog' },
  { key: 'margin', label: 'Gap from territory', min: 0, max: 2, step: 0.05, hint: 'how far the fog stays back from your plots' },
  { key: 'veilOpacity', label: 'Ground veil opacity', min: 0, max: 1, step: 0.01 },
  { key: 'veilShade', label: 'Ground veil brightness', min: 0.3, max: 1.2, step: 0.01 },
  { key: 'shade', label: 'Billow shading', min: 0, max: 0.6, step: 0.01, hint: 'darker variation between billows' },
  { key: 'step', label: 'Billow spacing', min: 0.5, max: 2, step: 0.05, layout: true, hint: 'lower = denser, more costly' },
  { key: 'sizeRatio', label: 'Billow size', min: 1.5, max: 5, step: 0.1, layout: true },
  { key: 'drift', label: 'Drift', min: 0, max: 3, step: 0.05 },
  { key: 'breathing', label: 'Breathing', min: 0, max: 0.5, step: 0.01 },

  { group: 'Fog · expansion offers' },
  { key: 'optionThickness', label: 'Offer thickness', min: 0, max: 1, step: 0.01 },
  { key: 'hoverThickness', label: 'Hovered offer thickness', min: 0, max: 1, step: 0.01 },
  { key: 'thicknessRate', label: 'Thickness change speed', min: 0.5, max: 10, step: 0.1 },

  { group: 'Fog · unlock' },
  { key: 'revealDuration', label: 'Clearing time (s)', min: 0.3, max: 5, step: 0.05 },
  { key: 'revealSpread', label: 'Parting distance', min: 0, max: 5, step: 0.05 },

  { group: 'Fog · tile landing' },
  { key: 'gustRadius', label: 'Gust radius', min: 0.5, max: 6, step: 0.1 },
  { key: 'gustPush', label: 'Gust push', min: 0, max: 3, step: 0.05 },
  { key: 'gustDuration', label: 'Gust duration (s)', min: 0.3, max: 4, step: 0.05 },
  { key: 'erodeNear', label: 'Thinning: touching cells', min: 0, max: 1, step: 0.01 },
  { key: 'erodeFar', label: 'Thinning: next ring', min: 0, max: 1, step: 0.01 },
  { key: 'erodeFloor', label: 'Thinnest the fog gets', min: 0, max: 1, step: 0.01 },
];

export const FOG_DEFAULTS = Object.fromEntries(FOG_PARAMS.filter((p) => p.key).map((p) => [p.key, FOG[p.key]]));
const FOG_STORAGE_KEY = 'oto.fogConfig';

/** Applies saved slider values onto FOG (call before creating FogOfWar). */
export function loadFogConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(FOG_STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  for (const k of Object.keys(FOG_DEFAULTS)) if (typeof saved[k] === typeof FOG_DEFAULTS[k]) FOG[k] = saved[k];
  return FOG;
}

export function saveFogConfig(cfg) {
  localStorage.setItem(FOG_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.keys(FOG_DEFAULTS).map((k) => [k, cfg[k]]))));
}

export function clearFogConfig() {
  localStorage.removeItem(FOG_STORAGE_KEY);
}

const GUSTS = 6; // simultaneous shockwaves (a 4-cell piece lands as 4)

const MASK = 128; // texels per side, one per cell
const MASK_OFFSET = 64; // cell -64 maps to texel 0

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const maskSample = /* glsl */ `
uniform sampler2D uMask;
uniform float uMaskSize;
uniform float uMaskOffset;
uniform float uMargin;
vec2 maskAt(vec2 p) { return texture2D(uMask, (p + uMaskOffset + 0.5) / uMaskSize).rg; }
// Locked-ness that also needs every point within r to be locked: keeps fog back from open land.
float lockedNear(vec2 p, float r) {
  float l = maskAt(p).r;
  if (r <= 0.0) return l;
  float h = r * 0.7071;
  l = min(l, min(maskAt(p + vec2(r, 0.0)).r, maskAt(p - vec2(r, 0.0)).r));
  l = min(l, min(maskAt(p + vec2(0.0, r)).r, maskAt(p - vec2(0.0, r)).r));
  l = min(l, min(maskAt(p + vec2(h, h)).r, maskAt(p - vec2(h, h)).r));
  l = min(l, min(maskAt(p + vec2(h, -h)).r, maskAt(p - vec2(h, -h)).r));
  return l;
}
`;

const billowVertex = /* glsl */ `
#include <fog_pars_vertex>
${maskSample}
attribute vec3 aAnchor; // x, z inside the wrapping window; y = height
attribute vec4 aMotion; // phase, speed, drift, spin
attribute vec4 aLook;   // size, alpha, seed, -
uniform float uTime, uWindow, uFadeRadius, uDrift, uBreathing;
uniform vec2 uCenter;
uniform float uPart, uPartSpread, uPartHalf;
uniform vec2 uPartOrigin;
uniform vec4 uGusts[${GUSTS}]; // x, z, age (s), -  (age < 0 = idle)
uniform float uGustRadius, uGustPush, uGustDuration, uErodeFloor;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vUp;
varying float vHeight;

void main() {
  vUv = uv;
  vSeed = aLook.z;
  vHeight = aAnchor.y;
  // Wrap the fixed field around the look-at point, so the clouds never run out.
  vec2 rel = mod(aAnchor.xz - uCenter + 0.5 * uWindow, uWindow) - 0.5 * uWindow;
  vec2 anchor = uCenter + rel;

  float a = aMotion.x + uTime * aMotion.y;
  vec3 pos = vec3(anchor.x, aAnchor.y, anchor.y);
  pos.x += cos(a) * aMotion.z * uDrift;
  pos.z += sin(a) * aMotion.z * uDrift;
  pos.y += sin(a * 1.7) * 0.05 * uDrift;

  float radial = 1.0 - smoothstep(0.4 * uFadeRadius, uFadeRadius, length(rel));

  // Locked-ness at the billow and at its ground footprint as seen from the camera, so raised
  // billows on the far side of the territory don't hang over your own tiles.
  vec2 m = maskAt(anchor);
  vec2 toCam = cameraPosition.xz - anchor;
  float tl = length(toCam);
  vec2 foot = anchor + (tl > 0.001 ? toCam / tl : vec2(0.0)) * aAnchor.y * 0.65;
  // uMargin + the billow's own radius: its whole puff stays off open land.
  float clear = uMargin + aLook.x * 0.3;
  float fade = smoothstep(0.55, 1.0, min(lockedNear(anchor, clear), maskAt(foot).r));

  // Parting: inside the plot being unlocked, billows clear outward from its middle.
  if (uPart >= 0.0) {
    vec2 d = anchor - uPartOrigin;
    float r = max(abs(d.x), abs(d.y)) / uPartHalf;
    if (r <= 1.0) {
      // Jitter the clearing front per billow, so it isn't a hard square.
      float pf = smoothstep(uPart - 0.3, uPart, min(1.0, r + (aLook.z - 0.5) * 0.25));
      // Ignore the footprint here (it may fall on the plot itself) but keep the soft open edge.
      fade = min(pf, smoothstep(0.55, 1.0, lockedNear(anchor, uMargin + aLook.x * 0.3)));
      float len = max(length(d), 0.0001);
      pos.xz += d / len * uPartSpread * (1.0 - pf);
    }
  }

  // Tile landings: shove nearby billows outward and thin them. The same thinning is written
  // into the mask (thickness, m.g) by disturb() and eases in there, so by the time the gust
  // ends the mask already holds it: the gust hands over to the mask and nothing returns.
  float thickness = m.g;
  for (int i = 0; i < ${GUSTS}; i++) {
    vec4 g = uGusts[i];
    if (g.z < 0.0) continue;
    vec2 d = anchor - g.xy;
    float dist = length(d);
    float t = g.z / uGustDuration;
    float reach = 1.0 - smoothstep(0.3 * uGustRadius, uGustRadius, dist);
    float burst = smoothstep(0.0, 0.25, t);
    // Hand-over at the end is eased, so any small gust/mask mismatch blends instead of popping.
    float hold = burst * (1.0 - smoothstep(0.75, 1.0, t));
    pos.xz += (dist > 0.0001 ? d / dist : vec2(0.0)) * uGustPush * reach * hold;
    pos.y += 0.25 * reach * hold;
    thickness = min(thickness, max(1.0 - reach * hold, uErodeFloor));
  }

  vAlpha = min(1.0, aLook.y * fade * thickness * radial);
  if (vAlpha < 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off-screen: costs no fill
    return;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float ang = aMotion.w + uTime * 0.05 * (aLook.z - 0.5);
  float c = cos(ang);
  float s = sin(ang);
  float size = aLook.x * (1.0 + uBreathing * sin(a * 2.3)) * mix(0.6, 1.0, fade);
  vec2 offset = mat2(c, s, -s, c) * position.xy;
  vUp = offset.y * 2.0;
  mvPosition.xy += offset * size; // camera-facing billboard
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const billowFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vUp;
varying float vHeight;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float rim = 0.8 + 0.12 * sin(a * 3.0 + vSeed * 17.0) + 0.08 * sin(a * 5.0 - vSeed * 11.0);
  float body = 1.0 - smoothstep(0.25 * rim, rim, r);
  float grain = 0.82 + 0.18 * sin(p.x * 6.5 + vSeed * 23.0) * sin(p.y * 5.5 - vSeed * 13.0);
  float alpha = body * body * grain * vAlpha;
  if (alpha < 0.004) discard;
  vec3 color = mix(uColorA, uColorB, fract(vSeed * 7.13));
  // Lit tops and centres, shaded undersides, so each billow reads as a rounded lump.
  color *= mix(0.66, 1.06, smoothstep(-0.9, 0.6, vUp + 0.35 * (1.0 - r)));
  color *= mix(0.84, 1.0, clamp(vHeight / 1.5, 0.0, 1.0)); // lower layers greyer
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const veilVertex = /* glsl */ `
#include <fog_pars_vertex>
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const veilFragment = /* glsl */ `
#include <fog_pars_fragment>
${maskSample}
uniform vec3 uColor;
uniform float uOpacity, uTime, uFadeRadius;
uniform vec2 uCenter;
uniform float uPart, uPartHalf;
uniform vec2 uPartOrigin;
varying vec2 vWorld;

void main() {
  vec2 m = maskAt(vWorld);
  float n = sin(vWorld.x * 0.9 + uTime * 0.25) * sin(vWorld.y * 1.1 - uTime * 0.2)
    + 0.5 * sin((vWorld.x + vWorld.y) * 2.1 + uTime * 0.15);
  float locked = smoothstep(0.5 + 0.1 * n, 0.98, lockedNear(vWorld, uMargin * 0.5)); // wavy, soft edge at the territory border
  if (uPart >= 0.0) {
    vec2 d = vWorld - uPartOrigin;
    float r = max(abs(d.x), abs(d.y)) / uPartHalf;
    // Wavy clearing front rather than a hard square.
    if (r <= 1.0) locked = min(locked, smoothstep(uPart - 0.3, uPart, min(1.0, r + 0.05 * n
      + 0.08 * sin(vWorld.x * 4.1 + vWorld.y * 1.3) * sin(vWorld.y * 3.7 - vWorld.x * 0.9))));
  }
  float radial = 1.0 - smoothstep(0.4 * uFadeRadius, uFadeRadius, length(vWorld - uCenter));
  float alpha = uOpacity * locked * m.g * radial * (0.9 + 0.08 * n);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class FogOfWar {
  group = new THREE.Group();
  time = 0;
  options = new Set(); // plot keys offered for expansion
  hover = null; // hovered offer's plot key
  reveal = null; // { px, pz, t }

  constructor(scene, settings = FOG) {
    this.s = settings;
    this.group.name = 'fogOfWar';
    scene.add(this.group);

    // Mask: R = locked (1) / open (0), G = cloud thickness. Linear filtering softens the edges.
    this.locked = new Float32Array(MASK * MASK).fill(1);
    this.thick = new Float32Array(MASK * MASK).fill(1);
    this.thickTarget = new Float32Array(MASK * MASK).fill(1);
    this.wear = new Float32Array(MASK * MASK).fill(1); // per-cell thickness cap from tile landings
    this.gusts = []; // { x, z, age }
    this.data = new Uint8Array(MASK * MASK * 4);
    this.mask = new THREE.DataTexture(this.data, MASK, MASK, THREE.RGBAFormat);
    this.mask.magFilter = this.mask.minFilter = THREE.LinearFilter;
    this.mask.wrapS = this.mask.wrapT = THREE.ClampToEdgeWrapping;
    this.mask.generateMipmaps = false;
    this.dirty = true;

    const color = new THREE.Color(settings.color);
    const shared = {
      uMask: { value: this.mask },
      uMaskSize: { value: MASK },
      uMaskOffset: { value: MASK_OFFSET },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uFadeRadius: { value: 20 },
      uPart: { value: -1 },
      uPartHalf: { value: PLOT / 2 },
      uPartOrigin: { value: new THREE.Vector2() },
      uMargin: { value: settings.margin },
    };
    this.uniforms = shared;

    // Ground veil: guarantees full coverage between billows.
    const veilMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uColor: { value: color.clone().multiplyScalar(settings.veilShade) },
        uOpacity: { value: settings.veilOpacity },
      },
      vertexShader: veilVertex,
      fragmentShader: veilFragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(settings.window, settings.window).rotateX(-Math.PI / 2), veilMat);
    this.veil.position.y = 0.02;
    this.veil.renderOrder = 1;
    this.veil.frustumCulled = false;
    this.group.add(this.veil);

    // Billows: one instanced mesh per layer, drawn bottom-up.
    const billowMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uWindow: { value: settings.window },
        uDrift: { value: settings.drift },
        uBreathing: { value: settings.breathing },
        uPartSpread: { value: settings.revealSpread },
        uGusts: { value: Array.from({ length: GUSTS }, () => new THREE.Vector4(0, 0, -1, 0)) },
        uGustRadius: { value: settings.gustRadius },
        uGustPush: { value: settings.gustPush },
        uGustDuration: { value: settings.gustDuration },
        uErodeFloor: { value: settings.erodeFloor },
        uColorA: { value: color.clone().multiplyScalar(1 - settings.shade) },
        uColorB: { value: color.clone() },
      },
      vertexShader: billowVertex,
      fragmentShader: billowFragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    this.billowMat = billowMat;
    this.meshes = settings.layers.map((layer, i) => {
      const mesh = new THREE.Mesh(this.#layerGeometry(layer, i), billowMat);
      mesh.renderOrder = 2 + i;
      mesh.frustumCulled = false; // the shader moves every billow
      this.group.add(mesh);
      return mesh;
    });
    this.count = this.meshes.reduce((n, m) => n + m.geometry.instanceCount, 0);
  }

  #layerGeometry(layer, index) {
    const { window: W, step, sizeRatio } = this.s;
    const n = Math.max(1, Math.round(W / (step * layer.spacing)));
    const s = W / n; // exact divisor of the window, so the field tiles seamlessly
    const rng = mulberry32(0x5eed + index * 977);
    const anchor = new Float32Array(n * n * 3);
    const motion = new Float32Array(n * n * 4);
    const look = new Float32Array(n * n * 4);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++, k++) {
        const seed = rng();
        anchor.set([(i + 0.5 + (rng() - 0.5) * 0.9) * s, layer.y + (rng() - 0.5) * 0.25, (j + 0.5 + (rng() - 0.5) * 0.9) * s], k * 3);
        motion.set([rng() * Math.PI * 2, 0.08 + seed * 0.08, s * (0.12 + seed * 0.15), rng() * Math.PI * 2], k * 4);
        look.set([s * sizeRatio * layer.size * (0.8 + seed * 0.4), layer.alpha * (0.85 + rng() * 0.3), seed, 0], k * 4);
      }
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchor, 3));
    geo.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.instanceCount = n * n;
    return geo;
  }

  /** Push the current settings into the shaders; `rebuild` regenerates the billows (spacing/size). */
  applySettings(rebuild = false) {
    const s = this.s;
    const color = new THREE.Color(s.color);
    const vu = this.veil.material.uniforms;
    this.uniforms.uMargin.value = s.margin;
    vu.uOpacity.value = s.veilOpacity;
    vu.uColor.value.copy(color).multiplyScalar(s.veilShade);
    const bu = this.billowMat.uniforms;
    bu.uDrift.value = s.drift;
    bu.uBreathing.value = s.breathing;
    bu.uPartSpread.value = s.revealSpread;
    bu.uColorA.value.copy(color).multiplyScalar(1 - s.shade);
    bu.uColorB.value.copy(color);
    bu.uGustRadius.value = s.gustRadius;
    bu.uGustPush.value = s.gustPush;
    bu.uGustDuration.value = s.gustDuration;
    bu.uErodeFloor.value = s.erodeFloor;
    this.#refreshThickness();
    if (rebuild) {
      this.meshes.forEach((mesh, i) => {
        mesh.geometry.dispose();
        mesh.geometry = this.#layerGeometry(s.layers[i], i);
      });
      this.count = this.meshes.reduce((n, m) => n + m.geometry.instanceCount, 0);
    }
  }

  // ---------- mask helpers ----------

  #index(x, z) {
    const i = x + MASK_OFFSET;
    const j = z + MASK_OFFSET;
    if (i < 0 || j < 0 || i >= MASK || j >= MASK) return -1;
    return j * MASK + i;
  }

  #plotCells(pk, fn) {
    const [px, pz] = typeof pk === 'string' ? pk.split(',').map(Number) : pk;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const idx = this.#index(plotCenter(px) + dx, plotCenter(pz) + dz);
        if (idx >= 0) fn(idx);
      }
    }
  }

  #refreshThickness() {
    const { optionThickness, hoverThickness } = this.s;
    // Clouds worn thin by nearby landings, never below the floor.
    const floor = this.s.erodeFloor;
    for (let i = 0; i < this.wear.length; i++) this.thickTarget[i] = Math.max(floor, this.wear[i]);
    const cap = (v) => (i) => (this.thickTarget[i] = Math.min(this.thickTarget[i], v));
    for (const k of this.options) this.#plotCells(k, cap(optionThickness));
    if (this.hover && this.options.has(this.hover)) this.#plotCells(this.hover, cap(hoverThickness));
    if (this.reveal) {
      // The plot being revealed keeps whatever thickness it had.
      this.#plotCells([this.reveal.px, this.reveal.pz], (i) => (this.thickTarget[i] = this.thick[i]));
    }
  }

  // ---------- public API ----------

  get visible() {
    return this.group.visible;
  }

  setVisible(on) {
    this.group.visible = on;
  }

  /** Cover everything except the grid's unlocked plots, instantly. */
  reset(grid) {
    this.reveal = null;
    this.uniforms.uPart.value = -1;
    this.options.clear();
    this.hover = null;
    this.locked.fill(1);
    this.thick.fill(1);
    this.thickTarget.fill(1);
    this.wear.fill(1);
    this.gusts.length = 0;
    for (const k of grid.plots) this.#plotCells(k, (i) => (this.locked[i] = 0));
    this.dirty = true;
  }

  /** Thin the clouds over the plots offered for expansion (null clears the offer). */
  setOptions(keys) {
    this.options = new Set(keys ?? []);
    if (!keys) this.hover = null;
    this.#refreshThickness();
  }

  setHover(plotKey) {
    if (plotKey === this.hover) return;
    this.hover = plotKey;
    this.#refreshThickness();
  }

  /**
   * A tile landed at cell (x, z): its impact pushes the nearby clouds away, and they stay away.
   * The gust's thinning is stored permanently in `wear` (same falloff as the shader), and the
   * thickness eases to it while the gust plays, so the end of the gust changes nothing.
   */
  disturb(x, z) {
    if (!this.group.visible) return;
    this.gusts.push({ x, z, age: 0 });
    if (this.gusts.length > GUSTS) this.gusts.shift();
    const { erodeNear, erodeFar, gustRadius } = this.s;
    const r = Math.ceil(gustRadius);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring === 0) continue;
        const i = this.#index(x + dx, z + dz);
        if (i < 0 || this.locked[i] === 0) continue;
        // Match the shader: reach = 1 - smoothstep(0.3R, R, dist).
        const reach = 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dz), 0.3 * gustRadius, gustRadius);
        const eroded = this.wear[i] - (ring === 1 ? erodeNear : ring === 2 ? erodeFar : 0);
        // Stored unclamped (down to 0); the floor is applied in #refreshThickness, so the
        // 'Thinnest the fog gets' slider updates existing worn fog live.
        this.wear[i] = Math.max(0, Math.min(eroded, 1 - reach));
      }
    }
    this.#refreshThickness();
  }

  /** Part the clouds over plot (px, pz). Returns the animation length in seconds. */
  revealPlot(px, pz) {
    if (this.reveal) this.#finishReveal();
    this.reveal = { px, pz, t: 0 };
    this.uniforms.uPartOrigin.value.set(plotCenter(px), plotCenter(pz));
    this.uniforms.uPart.value = 0;
    this.#refreshThickness();
    return this.s.revealDuration;
  }

  #finishReveal() {
    const { px, pz } = this.reveal;
    this.#plotCells([px, pz], (i) => (this.locked[i] = 0));
    this.reveal = null;
    this.uniforms.uPart.value = -1;
    this.#refreshThickness();
    this.dirty = true;
  }

  update(dt, target, distance) {
    if (!this.group.visible) return;
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uCenter.value.set(target.x, target.z);
    u.uFadeRadius.value = this.s.fadeRadius * distance;
    this.veil.position.x = target.x;
    this.veil.position.z = target.z;

    // Landing gusts age out.
    const slots = this.billowMat.uniforms.uGusts.value;
    this.gusts = this.gusts.filter((g) => (g.age += dt) < this.s.gustDuration);
    slots.forEach((v, i) => {
      const g = this.gusts[i];
      v.set(g?.x ?? 0, g?.z ?? 0, g ? g.age : -1, 0);
    });

    // Ease thickness toward its targets.
    const stepMax = dt * this.s.thicknessRate;
    for (let i = 0; i < this.thick.length; i++) {
      const d = this.thickTarget[i] - this.thick[i];
      if (d === 0) continue;
      this.thick[i] += Math.abs(d) <= stepMax ? d : Math.sign(d) * stepMax;
      this.dirty = true;
    }

    // Parting animation; the cells' locked value eases out late, so neighbours soften smoothly.
    if (this.reveal) {
      const r = this.reveal;
      r.t = Math.min(1, r.t + dt / this.s.revealDuration);
      u.uPart.value = 1.3 * (1 - (1 - r.t) ** 2);
      const t = r.t;
      const lockedNow = 1 - THREE.MathUtils.smoothstep(t, 0.45, 0.95);
      this.#plotCells([r.px, r.pz], (i) => (this.locked[i] = lockedNow));
      this.dirty = true;
      if (r.t >= 1) this.#finishReveal();
    }

    if (this.dirty) {
      const data = this.data;
      for (let i = 0; i < this.locked.length; i++) {
        data[i * 4] = Math.round(this.locked[i] * 255);
        data[i * 4 + 1] = Math.round(this.thick[i] * 255);
        data[i * 4 + 3] = 255;
      }
      this.mask.needsUpdate = true;
      this.dirty = false;
    }
  }
}
