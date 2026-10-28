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
  openDuration: 1.2, // free placement: seconds for fog to clear around a landed tile
  openRadius: 1, // free placement: cells uncovered around each landed tile
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

/**
 * Fog quality presets. Cost is roughly (billow count) for the vertex work and
 * (layers × (size ÷ spacing)²) for the overdraw (the big one on high-DPI screens).
 *   layers: which FOG.layers are drawn · step: spacing multiplier (fewer billows)
 *   size: billow size multiplier (less overlap) · alpha: makes up for the dropped layers
 *   scale: fog render resolution in device pixels per CSS pixel (0 = draw straight into the frame).
 *     The clouds are soft, so on a Retina screen (pixel ratio 2) drawing them at 1 looks the same
 *     and shades 4× fewer pixels. Skipped when it wouldn't be lower than the screen's own ratio.
 */
export const FOG_QUALITY = {
  Low: { layers: [0], step: 1.6, size: 0.85, alpha: 1.3, scale: 0.6 },
  Medium: { layers: [0, 2], step: 1.3, size: 0.9, alpha: 1.12, scale: 0.75 },
  High: { layers: [0, 1, 2], step: 1.15, size: 0.92, alpha: 1, scale: 1 },
  Ultra: { layers: [0, 1, 2], step: 1, size: 1, alpha: 1, scale: 0 }, // the original look, full resolution
};
export const FOG_QUALITY_NAMES = Object.keys(FOG_QUALITY);

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
  { key: 'openRadius', label: 'Free mode: uncover radius (cells)', min: 0, max: 4, step: 1 },
  { key: 'openDuration', label: 'Free mode: uncover time (s)', min: 0.1, max: 4, step: 0.05 },
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

// Billows are generated in the shader: no per-instance attributes. Instance k is lattice cell
// (k / uN, k % uN) of a uN × uN window that wraps around the look-at point; its jitter, size and
// motion come from a hash of the *world* cell it lands on. So the clouds are anchored to the
// world, and the window can grow/shrink with the zoom (only the instance count changes) without
// any billow popping.
// Offscreen, three.js writes linear colour; encode to sRGB here so the clouds blend with each
// other in the same space as when drawn straight to the screen (keeps the look identical).
const RT_ENCODE = /* glsl */ `
  #ifdef FOG_RT
  gl_FragColor.rgb = sRGBTransferOETF(gl_FragColor).rgb;
  #endif`;

const billowVertex = /* glsl */ `
#include <fog_pars_vertex>
${maskSample}
uniform float uTime, uFadeRadius, uDrift, uBreathing;
uniform vec2 uCenter;
uniform float uStep;    // lattice spacing of this layer
uniform float uN;       // lattice cells per side of the wrapping window
uniform vec4 uLayer;    // y, size (world units, before seed variation), alpha, layer index
uniform float uPart, uPartSpread, uPartHalf;
uniform vec2 uPartOrigin;
uniform vec4 uGusts[${GUSTS}]; // x, z, age (s), -  (age < 0 = idle)
uniform float uGustRadius, uGustPush, uGustDuration, uErodeFloor;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vUp;
varying float vHeight;
varying vec4 vRim; // cos/sin of the two rim phase offsets (saves an atan per pixel)

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rand3(uvec3 v) { return vec3(pcg3d(v)) * (1.0 / 4294967296.0); }

void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); } // off-screen: costs no fill

void main() {
  vUv = uv;
  // Wrap this lattice point around the look-at point, then find the world cell it lands on.
  float n = uN;
  float W = n * uStep;
  float id = float(gl_InstanceID);
  float gi = floor(id / n);
  vec2 lattice = (vec2(gi, id - gi * n) + 0.5) * uStep;
  vec2 rel0 = mod(lattice - uCenter + 0.5 * W, W) - 0.5 * W;
  vec2 cellF = floor((uCenter + rel0) / uStep + 0.001);
  uvec3 key = uvec3(ivec2(cellF) + 32768, int(uLayer.w));
  vec3 r1 = rand3(key);
  vec3 r2 = rand3(key + uvec3(0u, 0u, 16u));
  float r3 = rand3(key + uvec3(0u, 0u, 32u)).x;
  float seed = r1.z;

  vec2 anchor = (cellF + 0.5 + (r1.xy - 0.5) * 0.9) * uStep;
  vec2 rel = anchor - uCenter;
  float radial = 1.0 - smoothstep(0.4 * uFadeRadius, uFadeRadius, length(rel));
  float alpha = uLayer.z * (0.85 + r3 * 0.3);
  if (radial * alpha < 0.003) { cull(); return; } // outside the view: skip all texture reads

  // Thickness only ever goes down from m.g (gusts thin it), and fade <= smoothstep(m.r): if either
  // already kills the billow, stop after one texture read.
  vec2 m = maskAt(anchor);
  if (alpha * radial * m.g < 0.003 || m.r <= 0.55) { cull(); return; }

  float height = uLayer.x + (r2.x - 0.5) * 0.25;
  float size0 = uLayer.y * (0.8 + seed * 0.4);
  float phase = r2.y * 6.2831853;
  float speed = 0.08 + seed * 0.08;
  float drift = uStep * (0.12 + seed * 0.15);
  float spin = r2.z * 6.2831853;
  vSeed = seed;
  vHeight = height;
  vRim = vec4(cos(seed * 17.0), sin(seed * 17.0), cos(seed * 11.0), sin(seed * 11.0));

  float a = phase + uTime * speed;
  vec3 pos = vec3(anchor.x, height, anchor.y);
  pos.x += cos(a) * drift * uDrift;
  pos.z += sin(a) * drift * uDrift;
  pos.y += sin(a * 1.7) * 0.05 * uDrift;

  // Locked-ness at the billow and at its ground footprint as seen from the camera, so raised
  // billows on the far side of the territory don't hang over your own tiles.
  vec2 toCam = cameraPosition.xz - anchor;
  float tl = length(toCam);
  vec2 foot = anchor + (tl > 0.001 ? toCam / tl : vec2(0.0)) * height * 0.65;
  float footR = maskAt(foot).r;
  // uMargin + the billow's own radius: its whole puff stays off open land.
  float clear = uMargin + size0 * 0.3;
  float fade = 0.0;
  if (footR > 0.55 || uPart >= 0.0) fade = smoothstep(0.55, 1.0, min(lockedNear(anchor, clear), footR));

  // Parting: inside the plot being unlocked, billows clear outward from its middle.
  if (uPart >= 0.0) {
    vec2 d = anchor - uPartOrigin;
    float r = max(abs(d.x), abs(d.y)) / uPartHalf;
    if (r <= 1.0) {
      // Jitter the clearing front per billow, so it isn't a hard square.
      float pf = smoothstep(uPart - 0.3, uPart, min(1.0, r + (seed - 0.5) * 0.25));
      // Ignore the footprint here (it may fall on the plot itself) but keep the soft open edge.
      fade = min(pf, smoothstep(0.55, 1.0, lockedNear(anchor, clear)));
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

  vAlpha = min(1.0, alpha * fade * thickness * radial);
  if (vAlpha < 0.003) { cull(); return; }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float ang = spin + uTime * 0.05 * (seed - 0.5);
  float c = cos(ang);
  float s = sin(ang);
  float size = size0 * (1.0 + uBreathing * sin(a * 2.3)) * mix(0.6, 1.0, fade);
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
varying vec4 vRim;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r >= 1.0) discard; // the rim never reaches past r = 1: skip the quad's corners
  // rim = 0.8 + 0.12 sin(3a + 17 seed) + 0.08 sin(5a - 11 seed), with the multiple-angle
  // formulas instead of atan (vRim holds the cos/sin of the seed phases).
  vec2 cs = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  float c = cs.x, s = cs.y;
  float c2 = c * c, s2 = s * s;
  float s3a = s * (3.0 - 4.0 * s2);
  float c3a = c * (4.0 * c2 - 3.0);
  float s5a = s * (16.0 * s2 * s2 - 20.0 * s2 + 5.0);
  float c5a = c * (16.0 * c2 * c2 - 20.0 * c2 + 5.0);
  float rim = 0.8 + 0.12 * (s3a * vRim.x + c3a * vRim.y) + 0.08 * (s5a * vRim.z - c5a * vRim.w);
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
  ${RT_ENCODE}
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
  // Cheapest rejections first: outside the view radius (no texture reads), then open or thin
  // ground (one read). Only fog-covered pixels pay for the 9-read soft border.
  float radial = 1.0 - smoothstep(0.4 * uFadeRadius, uFadeRadius, length(vWorld - uCenter));
  if (radial * uOpacity < 0.004) discard;
  vec2 m = maskAt(vWorld);
  float n = sin(vWorld.x * 0.9 + uTime * 0.25) * sin(vWorld.y * 1.1 - uTime * 0.2)
    + 0.5 * sin((vWorld.x + vWorld.y) * 2.1 + uTime * 0.15);
  float edge0 = 0.5 + 0.1 * n;
  if (m.r <= edge0 || uOpacity * m.g * radial * (0.9 + 0.08 * n) < 0.004) discard;
  float locked = smoothstep(edge0, 0.98, lockedNear(vWorld, uMargin * 0.5)); // wavy, soft edge at the territory border
  if (uPart >= 0.0) {
    vec2 d = vWorld - uPartOrigin;
    float r = max(abs(d.x), abs(d.y)) / uPartHalf;
    // Wavy clearing front rather than a hard square.
    if (r <= 1.0) locked = min(locked, smoothstep(uPart - 0.3, uPart, min(1.0, r + 0.05 * n
      + 0.08 * sin(vWorld.x * 4.1 + vWorld.y * 1.3) * sin(vWorld.y * 3.7 - vWorld.x * 0.9))));
  }
  float alpha = uOpacity * locked * m.g * radial * (0.9 + 0.08 * n);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
  ${RT_ENCODE}
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
    this.wear = new Float32Array(MASK * MASK).fill(1);
    this.lockedTarget = new Float32Array(MASK * MASK).fill(1); // cells easing open (free placement)
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
    // Unit plane, scaled every frame to just cover the visible fade radius.
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), veilMat);
    this.veil.position.y = 0.02;
    this.veil.renderOrder = 1;
    this.veil.frustumCulled = false;
    this.group.add(this.veil);

    // Billows: one instanced quad mesh per layer, drawn bottom-up. Uniforms shared by every
    // layer live in `bu` (the materials hold references to the same { value } objects).
    const bu = {
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
    };
    this.billowUniforms = bu;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.meshes = settings.layers.map((layer, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...shared,
          ...bu,
          uStep: { value: 1 },
          uN: { value: 1 },
          uLayer: { value: new THREE.Vector4() },
        },
        vertexShader: billowVertex,
        fragmentShader: billowFragment,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: true,
      });
      // No per-instance attributes: the shader builds each billow from gl_InstanceID.
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute('position', quad.getAttribute('position'));
      geo.setAttribute('uv', quad.getAttribute('uv'));
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2 + i;
      mesh.frustumCulled = false; // the shader moves every billow
      this.group.add(mesh);
      return mesh;
    });
    this.count = 0; // billows dispatched last frame (all layers)
    this.setQuality(settings.quality ?? 'High');
  }

  /** Fog quality preset (see FOG_QUALITY). */
  setQuality(name) {
    this.quality = FOG_QUALITY[name] ? name : 'High';
    this.applySettings();
    this.#applyMode();
  }

  // ---------- reduced-resolution rendering ----------

  offscreen = false;

  /**
   * Enables the presets' reduced-resolution path. `occluders` are the scene objects whose depth
   * must still hide the fog (the placed tiles, the ghost). Call render(camera) every frame
   * before the main renderer.render(scene, camera).
   */
  attachRenderer(renderer, scene, occluders) {
    this.renderer = renderer;
    this.scene = scene;
    this.occluders = occluders;
    this.fogScene = new THREE.Scene();
    this.fogScene.fog = scene.fog; // same object, so the distance fade stays in sync
    // Depth-only pass of the occluders. Its `children` is pointed at the real objects just for
    // that render (they keep their real parent, so their world matrices are unaffected).
    this.depthScene = new THREE.Scene();
    this.depthScene.matrixWorldAutoUpdate = false;
    this.depthScene.overrideMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
    this.target.texture.generateMipmaps = false;
    // Full-screen quad that lays the (premultiplied) fog image over the frame at the fog's
    // place in the draw order (after the ground and tiles, before the "?" sprites and outlines).
    this.composite = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tFog: { value: this.target.texture } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D tFog; varying vec2 vUv; void main() { gl_FragColor = texture2D(tFog, vUv); }',
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.composite.name = 'fogComposite';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = 1;
    this.composite.visible = false;
    scene.add(this.composite);
    this.#applyMode();
  }

  /** Effective fog pixel ratio, or 0 when drawing straight into the frame. */
  get renderScale() {
    const q = FOG_QUALITY[this.quality];
    if (!this.renderer || !q.scale || q.scale >= this.renderer.getPixelRatio()) return 0;
    return q.scale;
  }

  #applyMode() {
    if (!this.renderer) return;
    const offscreen = this.renderScale > 0;
    if (offscreen === this.offscreen && this.group.parent) return;
    this.offscreen = offscreen;
    (offscreen ? this.fogScene : this.scene).add(this.group);
    for (const m of [this.veil.material, ...this.meshes.map((mesh) => mesh.material)]) {
      if (offscreen) m.defines.FOG_RT = '';
      else delete m.defines.FOG_RT;
      m.needsUpdate = true;
    }
    if (!offscreen) this.composite.visible = false;
  }

  /** Draw the fog into its reduced-resolution target (no-op when drawing straight into the frame). */
  render(camera) {
    if (!this.renderer) return;
    this.#applyMode(); // follows pixel-ratio changes
    if (!this.offscreen || !this.group.visible) {
      this.composite.visible = false;
      return;
    }
    const r = this.renderer;
    const scale = this.renderScale;
    const w = Math.max(1, Math.round(window.innerWidth * scale));
    const h = Math.max(1, Math.round(window.innerHeight * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear ??= new THREE.Color());
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.autoClear = false;
    this.depthScene.children = this.occluders;
    r.render(this.depthScene, camera);
    this.depthScene.children = [];
    r.render(this.fogScene, camera);
    r.autoClear = prevAuto;
    r.setClearColor(this._clear, prevAlpha);
    r.setRenderTarget(prevTarget);
    this.composite.visible = true;
  }

  /** Per-layer lattice spacing / size / alpha from the settings and the quality preset. */
  #layout() {
    const q = FOG_QUALITY[this.quality];
    const { step, sizeRatio } = this.s;
    this.meshes.forEach((mesh, i) => {
      const layer = this.s.layers[i];
      const on = q.layers.includes(i);
      mesh.visible = on && this.billowsOn;
      const sp = step * q.step * layer.spacing;
      mesh.material.uniforms.uStep.value = sp;
      mesh.material.uniforms.uLayer.value.set(layer.y, sp * sizeRatio * q.size * layer.size, layer.alpha * q.alpha, i);
    });
    this.veil.visible = this.veilOn;
  }

  billowsOn = true;
  veilOn = true;

  /** Debug A/B: show or hide the billows / the ground veil. */
  setParts({ billows = this.billowsOn, veil = this.veilOn } = {}) {
    this.billowsOn = billows;
    this.veilOn = veil;
    this.#layout();
  }

  /** Push the current settings into the shaders. (`rebuild` is kept for callers; layout is always live now.) */
  applySettings(_rebuild = false) {
    const s = this.s;
    const color = new THREE.Color(s.color);
    const vu = this.veil.material.uniforms;
    this.uniforms.uMargin.value = s.margin;
    vu.uOpacity.value = s.veilOpacity;
    vu.uColor.value.copy(color).multiplyScalar(s.veilShade);
    const bu = this.billowUniforms;
    bu.uDrift.value = s.drift;
    bu.uBreathing.value = s.breathing;
    bu.uPartSpread.value = s.revealSpread;
    bu.uColorA.value.copy(color).multiplyScalar(1 - s.shade);
    bu.uColorB.value.copy(color);
    bu.uGustRadius.value = s.gustRadius;
    bu.uGustPush.value = s.gustPush;
    bu.uGustDuration.value = s.gustDuration;
    bu.uErodeFloor.value = s.erodeFloor;
    this.#layout();
    this.#refreshThickness();
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
    this.thickBusy = true; // update() eases thick toward the new targets
  }

  // ---------- public API ----------

  get visible() {
    return this.group.visible;
  }

  setVisible(on) {
    this.group.visible = on;
    if (!on && this.composite) this.composite.visible = false;
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
    this.lockedTarget.fill(1);
    for (const k of grid.plots) this.#plotCells(k, (i) => (this.locked[i] = this.lockedTarget[i] = 0));
    this.lockedBusy = false;
    this.thickBusy = false;
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

  /**
   * Free placement: uncover every cell within `radius` (Chebyshev) of cell (x, z). The fog eases
   * away over `openDuration` seconds; uncovered land stays uncovered.
   */
  openAround(x, z, radius = 1) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const i = this.#index(x + dx, z + dz);
        if (i >= 0) this.lockedTarget[i] = 0;
      }
    }
    this.lockedBusy = true;
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
    // Size the wrapping billow window (and the veil) to the visible radius: everything past
    // uFadeRadius is invisible anyway. W/2 must exceed R + half a cell so no visible cell is missed.
    const R = u.uFadeRadius.value;
    const veilSize = 2 * R + 2;
    this.veil.scale.set(veilSize, 1, veilSize);
    this.veil.position.x = target.x;
    this.veil.position.z = target.z;
    let count = 0;
    for (const mesh of this.meshes) {
      const sp = mesh.material.uniforms.uStep.value;
      const n = Math.ceil((2 * R) / sp) + 2;
      mesh.material.uniforms.uN.value = n;
      mesh.geometry.instanceCount = n * n;
      if (mesh.visible) count += n * n;
    }
    this.count = count;

    // Landing gusts age out (in place: no per-frame allocation).
    const slots = this.billowUniforms.uGusts.value;
    let live = 0;
    for (const g of this.gusts) if ((g.age += dt) < this.s.gustDuration) this.gusts[live++] = g;
    this.gusts.length = live;
    for (let i = 0; i < slots.length; i++) {
      const g = this.gusts[i];
      slots[i].set(g ? g.x : 0, g ? g.z : 0, g ? g.age : -1, 0);
    }

    // Ease thickness toward its targets (only while something is still moving).
    if (this.thickBusy) {
      const stepMax = dt * this.s.thicknessRate;
      let moving = false;
      for (let i = 0; i < this.thick.length; i++) {
        const d = this.thickTarget[i] - this.thick[i];
        if (d === 0) continue;
        this.thick[i] += Math.abs(d) <= stepMax ? d : Math.sign(d) * stepMax;
        moving = true;
      }
      if (moving) this.dirty = true;
      else this.thickBusy = false;
    }

    // Free placement: cells easing open.
    if (this.lockedBusy) {
      const openStep = dt / this.s.openDuration;
      let moving = false;
      for (let i = 0; i < this.locked.length; i++) {
        if (this.lockedTarget[i] >= this.locked[i]) continue;
        this.locked[i] = Math.max(this.lockedTarget[i], this.locked[i] - openStep);
        moving = true;
      }
      if (moving) this.dirty = true;
      else this.lockedBusy = false;
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
      for (let i = 0, j = 0; i < this.locked.length; i++, j += 4) {
        data[j] = (this.locked[i] * 255 + 0.5) | 0;
        data[j + 1] = (this.thick[i] * 255 + 0.5) | 0;
        data[j + 3] = 255;
      }
      this.mask.needsUpdate = true;
      this.uploads = (this.uploads ?? 0) + 1;
      this.dirty = false;
    }
  }
}
