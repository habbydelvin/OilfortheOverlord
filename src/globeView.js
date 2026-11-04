import * as THREE from 'three';
import { createGlobeBend } from './globeBend.js';
import { WHEEL_GAP, wheelUnits } from './controls.js';
import { L, onLangChange } from './i18n.js';
import { PLAYER_NODE } from './rivals.js';
import { buildMissileTemplate, glowTexture as missileGlow } from './missiles.js';
import { SAND, sandTexture } from './seamlessGround.js';
import { FOG, BILLOW_SHADE } from './fogOfWar.js';

/**
 * The war map as a hex planet (globe-plan.md). One flat, repeating plane of pointy-top hexes, bent into a ball in
 * the vertex shader. Every tile is a true hexagon and there are no pentagons, because the plane is never really
 * closed: the far side of the ball (where the wrapped plane folds over itself) stays hidden behind the opaque core.
 *
 * Own scene and own camera. The camera never moves sideways; dragging scrolls the plane, the wheel moves the camera
 * in and out. main.js owns the view flag; this module reports a visit after its fly-in finishes.
 */

const SQ3 = Math.sqrt(3);
const HEX = 1; // corner radius of a cell
const COLS = 24;
const ROWS = 28; // even, so the row stagger repeats across the wrap
const PERIOD = new THREE.Vector2(COLS * SQ3 * HEX, ROWS * 1.5 * HEX);
const RADIUS = PERIOD.x / (2 * Math.PI); // one full spin = one period

const FOV = 38;
const D_DEFAULT = RADIUS * 4.1;
const D_MIN = RADIUS * 2.6;
const D_MAX = RADIUS * 5.2;
const D_CLOSE = RADIUS + 2.2; // fly-in / zoom-out end, just above the surface
const DIVE = 360; // committed at 60% (about two notches) // wheel units past D_MIN, over a city, to scroll all the way down into it

const BG = 0x07090a;
const TILE = new THREE.Color('#ffffff'); // multiplies the sand texture: white = the sand as on the board
const CORE = 0x2b241b;

/**
 * Tileable value noise on the wrapping plane: lattice cells wrap every `cells` steps across one period, so the
 * pattern repeats exactly with the planet and never shows a seam. fbm doubles the cell count per octave.
 */
const PERIODIC_NOISE = /* glsl */ `
float pnHash(vec2 i) {
  return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
}
float pnoise(vec2 q, vec2 cells) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pnHash(mod(i, cells));
  float b = pnHash(mod(i + vec2(1.0, 0.0), cells));
  float c = pnHash(mod(i + vec2(0.0, 1.0), cells));
  float d = pnHash(mod(i + vec2(1.0, 1.0), cells));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// t: plane position / period (0..1 per wrap). base: lattice cells across one period on the first octave.
float pfbm(vec2 t, float base, vec2 seed) {
  float sum = 0.0;
  float amp = 0.5;
  float n = base;
  for (int o = 0; o < 5; o++) {
    sum += amp * pnoise((t + seed) * n, vec2(n));
    n *= 2.0;
    amp *= 0.5;
  }
  return sum / 0.96875;
}
// Domain-warped fbm: warps with two more periodic fields first, so regions get organic, swirled edges.
float pwarp(vec2 t, float base, vec2 seed) {
  vec2 w = vec2(pfbm(t, base, seed + 3.1), pfbm(t, base, seed + 7.7)) - 0.5;
  return pfbm(t + w * (0.9 / base), base, seed);
}
`;

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Pointy-top hexagon tile: a finely subdivided cap (the shader carves terrain into it and bends it onto the ball)
 * plus a deep skirt. Indexed, so the cap's shared vertices are shaded once. Cap normals come from the shader.
 */
const HEX_SUB = 8; // cap subdivisions per edge
const HEX_TOP = 0.93; // cap corner radius (× HEX); the shader scales it out to close the grid gaps
function hexGeometry() {
  const top = HEX_TOP * HEX;
  const foot = 0.97 * HEX;
  const depth = -0.75; // deep enough to stay under the deepest crater
  const R = HEX_SUB;
  const corner = (i, rad) => {
    const a = THREE.MathUtils.degToRad(60 * i - 30);
    return new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad);
  };
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const capIndex = new Map();
  const capVertex = (x, z) => {
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    if (capIndex.has(key)) return capIndex.get(key);
    const r = Math.hypot(x, z) / top;
    const k = 1 - 0.1 * THREE.MathUtils.smoothstep(r, 0.7, 1); // soft bevel toward the rim
    pos.push(x, 0, z);
    nrm.push(0, 1, 0);
    col.push(k, k, k);
    capIndex.set(key, pos.length / 3 - 1);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < 6; i++) {
    const A = corner(i, top);
    const B = corner(i + 1, top);
    const P = (a, b) => capVertex((A.x * a + B.x * b) / R, (A.y * a + B.y * b) / R);
    for (let a = 0; a < R; a++) {
      for (let b = 0; b < R - a; b++) {
        idx.push(P(a, b), P(a, b + 1), P(a + 1, b));
        if (a + b < R - 1) idx.push(P(a + 1, b), P(a, b + 1), P(a + 1, b + 1));
      }
    }
    // Skirt: same edge subdivisions as the cap, so the carved rim and the wall meet without cracks.
    const side = A.clone().add(B).normalize();
    for (let k = 0; k < R; k++) {
      const t0 = A.clone().lerp(B, k / R);
      const t1 = A.clone().lerp(B, (k + 1) / R);
      const base = pos.length / 3;
      for (const [p, y, c] of [
        [t0, 0, 0.7],
        [t1, 0, 0.7],
        [t0.clone().multiplyScalar(foot / top), depth, 0.45],
        [t1.clone().multiplyScalar(foot / top), depth, 0.45],
      ]) {
        pos.push(p.x, y, p.y);
        nrm.push(side.x, 0, side.y);
        col.push(c, c, c);
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); // replaced in the shader
  g.setIndex(idx);
  return g;
}

/**
 * Terrain carved into the tiles (vertex shader). Heights are a function of
 * the plane position, so neighbouring hexes agree along their shared edge and formations run across the grid.
 */
const MAX_CITIES = 8;
const HEIGHT_RES = 1024; // baked height map texels across one wrap of the plane
// Reading the baked height map: Terrain depth, the crater-floor clamp, and the per-pixel slope normal.
const HEIGHT_READ_GLSL = /* glsl */ `
uniform sampler2D uHeightMap;
uniform float uTerrainDepth;
float heightAt(vec2 t) { return max(texture2D(uHeightMap, t).r * uTerrainDepth, -0.6); }
`;
const TERRAIN_GLSL = /* glsl */ `
uniform float uTerrainScale, uCraters, uRegionScale;
uniform vec2 uCities[${MAX_CITIES}];
uniform int uCityCount;
vec2 tWrap(vec2 d) { return d - uGlobePeriod * floor(d / uGlobePeriod + 0.5); }
float cityDist(vec2 p) {
  float m = 1e3;
  for (int i = 0; i < ${MAX_CITIES}; i++) {
    if (i >= uCityCount) break;
    m = min(m, length(tWrap(p - uCities[i])));
  }
  return m;
}
// Craters: at most one per lattice cell (n cells per period, so they wrap), a bowl with a raised rim.
float craters(vec2 t, float n) {
  vec2 q = t * n;
  vec2 i = floor(q);
  vec2 f = fract(q);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = mod(i + vec2(x, y), vec2(n));
      if (pnHash(c + 17.3) > uCraters) continue;
      vec2 o = vec2(pnHash(c + 3.1), pnHash(c + 9.7));
      float r = 0.14 + 0.26 * pnHash(c + 5.5);
      float d = length(vec2(x, y) + o - f) / r;
      float bowl = d < 1.0 ? (d * d - 1.0) * 0.55 : 0.0;
      float rim = exp(-pow((d - 1.0) * 3.0, 2.0)) * 0.3;
      h += (bowl + rim) * (0.6 + r);
    }
  }
  return h;
}
// Noise only tiles across the wrap with a whole number of cells per period.
float wrapN(float n) { return max(1.0, floor(n + 0.5)); }
float terrainHeight(vec2 p) {
  vec2 t = p / uGlobePeriod;
  float s = uTerrainScale;
  // Ridged ranges on the pale highlands (same field as the ground colour, so peaks sit on light rock).
  float high = smoothstep(0.5, 0.68, pwarp(t, uRegionScale, vec2(0.13, 0.71)));
  float rn = pfbm(t, wrapN(5.0 * s), vec2(0.21, 0.67));
  float ridge = 1.0 - abs(rn * 2.0 - 1.0);
  float h = ridge * ridge * ridge * high * 0.9;
  // Winding canyons through the lowlands.
  float cn = pfbm(t, wrapN(3.0 * s), vec2(0.77, 0.19));
  float low = 1.0 - smoothstep(0.35, 0.5, pwarp(t, uRegionScale, vec2(0.13, 0.71)));
  h -= (1.0 - smoothstep(0.0, 0.03, abs(cn - 0.5))) * 0.4 * (0.35 + 0.65 * low);
  // Rolling ground everywhere, and craters.
  h += (pfbm(t, wrapN(14.0 * s), vec2(0.5, 0.5)) - 0.5) * 0.3;
  h += craters(t, wrapN(14.0 * s));
  // Cities stand on level ground.
  h *= smoothstep(0.75, 1.7, cityDist(p));
  return h; // unscaled: Terrain depth is applied where the baked map is read

}
`;


function cellCenter(c, r, out = new THREE.Vector2()) {
  return out.set(SQ3 * HEX * (c + 0.5 * (r & 1)) - PERIOD.x / 2, 1.5 * HEX * r - PERIOD.y / 2);
}

/** Globe tuning (Game Debug panel, "Globe" section). Read live every frame; `layout` ones re-place the cities. */
export const GLOBE = {
  cityScale: 0.65, // Hive City capital size (a board cell is 1 unit; a hex here is ~1.7 across)
  hoverScale: 1.1, // extra size on the hovered city
  hoverLift: 0.12, // how far the hovered city rises off its hex
  labelNorth: 0, // name label: this far toward the top of the screen from the city...
  labelHeight: 1.6, // ...and this high over the hex
  orbitRadius: 2.86, // moon orbit, × planet radius
  orbitTilt: 15, // degrees the near side drops below the equator (0 = a flat line across the face)
  orbitRoll: 8, // degrees the ellipse is turned on screen (positive lifts the right limb)
  orbitSpeed: 0.06, // radians per second, moon only
  sunSize: 0.7, // sun disc radius (plane units)
  sunGlow: 8, // sun glow sprite size
  moonSize: 0.9,
  moonGlow: 3,
  moonSpin: 0.15, // moon's own spin, radians per second
  spread: 27, // plane units per 100 war-table units (the planet is ~42 around)
  minGap: 8, // cities are pushed apart until at least this far from each other (plane units)
  gridLine: 0.005, // hex grid line thickness: share of a hex's width left open between tiles (0 = none)
  terrainDepth: 0.68, // how deep the craters and canyons cut and how high the ridges rise (0 = flat tiles)
  terrainScale: 1.55, // formation size (bigger = more, smaller formations)
  craters: 0, // share of the lattice with a crater
  regionStrength: 0.95, // large light / dark / grey regions over the sand (0 = plain sand)
  regionScale: 3, // region size: lattice cells around the planet (smaller = bigger regions)
  clouds: 'On',
  cloudOpacity: 0.5,
  cloudCover: 0.45, // share of the sky with cloud
  cloudScale: 5, // cloud size (smaller = bigger banks)
  cloudPuff: 1, // self-shadowing on the cloud puffs (0 = flat)
  cloudCityClear: 1.6, // clouds part this far round each city (plane units; a hex is ~1.7 across; 0 = off)
  cloudSpeed: 0.004, // drift, planet wraps per second
  cloudHeight: 0.3, // above the tiles
  atmoColor: '#6fc3e6', // thin rim of air round the planet
  atmoThickness: 0.06, // × planet radius
  atmoStrength: 1.2,
  nebula: 0.9, // reddish nebula behind the stars (0 = none)
  sandScale: 2.3, // plane units per sand texture repeat (the board: 4 units per repeat; a hex is ~1.7 across)
  fog: 'Off', // debug: 'Off' hides the planet's fog of war
  fogPerHex: 4, // billows over each hidden hex (more = thicker, costlier)
  fogBillowSize: 2.9, // billow size (plane units; a hex is ~1.7 across)
  fogOpacity: 0.13,
  fogHeight: 0.13, // how far the banks float above the tiles
  fogCityClear: 0, // extra rings of hexes uncovered around each city (0 = only the city's own hex)
};
export const GLOBE_PARAMS = [
  { group: 'Globe · cities' },
  { key: 'cityScale', label: 'City size', min: 0.3, max: 4, step: 0.05 },
  { key: 'hoverScale', label: 'Hovered city size ×', min: 1, max: 1.6, step: 0.01 },
  { key: 'hoverLift', label: 'Hovered city lift', min: 0, max: 1, step: 0.01 },
  { key: 'labelNorth', label: 'Name offset (up screen)', min: -1, max: 3, step: 0.05 },
  { key: 'labelHeight', label: 'Name height', min: 0, max: 5, step: 0.05 },
  { key: 'spread', label: 'City spread', min: 8, max: 60, step: 1, layout: true, hint: 'how far apart the war-table positions land' },
  { key: 'minGap', label: 'Min gap between cities', min: 0, max: 20, step: 0.5, layout: true, hint: 'plane units; ~21 is the far side of the planet' },
  { group: 'Globe · sun & moon' },
  { key: 'orbitRadius', label: 'Moon distance (× planet)', min: 1.02, max: 8, step: 0.02, hint: 'how far the moon orbits from the planet' },
  { key: 'orbitTilt', label: 'Near-side drop (°)', min: 0, max: 80, step: 1, hint: 'how far the front of the orbit sags below the middle. 0 is a flat line across the face' },
  { key: 'orbitRoll', label: 'Orbit roll (°)', min: -90, max: 90, step: 1, hint: 'positive lifts the right side of the path' },
  { key: 'orbitSpeed', label: 'Orbit speed', min: 0, max: 0.5, step: 0.005 },
  { key: 'sunSize', label: 'Sun size', min: 0.1, max: 3, step: 0.05 },
  { key: 'sunGlow', label: 'Sun glow size', min: 0, max: 20, step: 0.1 },
  { key: 'moonSize', label: 'Moon size', min: 0.1, max: 2, step: 0.05 },
  { key: 'moonSpin', label: 'Moon spin speed', min: 0, max: 1, step: 0.01, hint: 'radians per second' },
  { key: 'moonGlow', label: 'Moon glow size', min: 0, max: 10, step: 0.1 },
  { group: 'Globe · ground & fog' },
  { key: 'fog', label: 'Planet fog', type: 'select', options: ['On', 'Off'], hint: 'debug: hide the fog of war on the planet map' },
  { key: 'gridLine', label: 'Hex grid line thickness', min: 0, max: 0.2, step: 0.005, hint: 'gap between hex tiles; 0 = no lines' },
  { key: 'sandScale', label: 'Sand texture scale', min: 0.5, max: 16, step: 0.1, hint: 'plane units per texture repeat' },
  { key: 'terrainDepth', label: 'Terrain depth', min: 0, max: 1, step: 0.01, hint: 'craters, canyons and ridges carved into the tiles; 0 = flat' },
  { key: 'terrainScale', label: 'Terrain detail', min: 0.4, max: 3, step: 0.05, hint: 'bigger = more, smaller formations' },
  { key: 'craters', label: 'Crater amount', min: 0, max: 1, step: 0.01 },
  { key: 'regionStrength', label: 'Ground region contrast', min: 0, max: 2, step: 0.05, hint: 'light highlands, dark lowlands, grey flats' },
  { key: 'regionScale', label: 'Ground region size', min: 1, max: 8, step: 1, hint: 'smaller = bigger regions' },
  { key: 'fogPerHex', label: 'Billows per hidden hex', min: 0, max: 5, step: 1, layout: true, hint: '0 = no fog' },
  { key: 'fogBillowSize', label: 'Billow size', min: 0.5, max: 6, step: 0.05 },
  { key: 'fogOpacity', label: 'Fog opacity', min: 0, max: 1, step: 0.01 },
  { key: 'fogHeight', label: 'Fog height', min: 0, max: 3, step: 0.05 },
  { key: 'fogCityClear', label: 'Uncovered rings around cities', min: 0, max: 4, step: 1, layout: true, hint: '0 = only the city hex' },
  { group: 'Globe · clouds & sky' },
  { key: 'clouds', label: 'Clouds', type: 'select', options: ['On', 'Off'] },
  { key: 'cloudOpacity', label: 'Cloud opacity', min: 0, max: 1, step: 0.01 },
  { key: 'cloudCover', label: 'Cloud cover', min: 0, max: 1, step: 0.01 },
  { key: 'cloudScale', label: 'Cloud size', min: 1, max: 10, step: 1, hint: 'smaller = bigger banks' },
  { key: 'cloudPuff', label: 'Cloud fluffiness', min: 0, max: 2, step: 0.05, hint: 'shading on the puffs; 0 = flat' },
  { key: 'cloudCityClear', label: 'Clear sky round cities', min: 0, max: 5, step: 0.1, hint: 'clouds part round each city; 0 = off' },
  { key: 'cloudSpeed', label: 'Cloud drift', min: 0, max: 0.03, step: 0.0005 },
  { key: 'cloudHeight', label: 'Cloud height', min: 0.1, max: 3, step: 0.05 },
  { key: 'atmoColor', label: 'Atmosphere colour', type: 'color' },
  { key: 'atmoThickness', label: 'Atmosphere thickness (× planet)', min: 0.01, max: 0.3, step: 0.005 },
  { key: 'atmoStrength', label: 'Atmosphere brightness', min: 0, max: 3, step: 0.05 },
  { key: 'nebula', label: 'Nebula brightness', min: 0, max: 2, step: 0.05, hint: '0 = plain black space' },
];
export const GLOBE_DEFAULTS = { ...GLOBE };
const GLOBE_STORAGE_KEY = 'oto.globeConfig';
export function loadGlobeConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(GLOBE_STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  for (const k of Object.keys(GLOBE_DEFAULTS)) if (typeof saved[k] === typeof GLOBE_DEFAULTS[k]) GLOBE[k] = saved[k];
  // That exact trio was the old silhouette ring (the moon ran around the outline). Drop it so the
  // face-crossing path is what shows. Any other saved orbit is left alone.
  if (saved.orbitRadius === 1.25 && saved.orbitTilt === 0 && saved.orbitRoll === -18) {
    GLOBE.orbitRadius = GLOBE_DEFAULTS.orbitRadius;
    GLOBE.orbitTilt = GLOBE_DEFAULTS.orbitTilt;
    GLOBE.orbitRoll = GLOBE_DEFAULTS.orbitRoll;
  }
  return GLOBE;
}
export function saveGlobeConfig(cfg) {
  localStorage.setItem(GLOBE_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.keys(GLOBE_DEFAULTS).map((k) => [k, cfg[k]]))));
}
export function clearGlobeConfig() {
  localStorage.removeItem(GLOBE_STORAGE_KEY);
}

/** freeDuringWar: cities can still be visited mid attack phase (the playback keeps running: call tickWar). */
export function createGlobeView({ renderer, root, factory, playerBuildings, playerHp = () => 5, onVisit, onDive = () => {}, freeDuringWar = false, onArrive = null, onApproach = null, approachLead = () => 0 }) {
  const dom = renderer.domElement;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);

  const bend = createGlobeBend({ radius: RADIUS, period: PERIOD });

  // Light comes from upper left, a little in front, so the limb falls into shade.
  scene.add(new THREE.HemisphereLight(0xf2ead8, 0x2a2420, 1.15));
  const key = new THREE.DirectionalLight(0xfff0d6, 2.4);
  key.position.set(-0.55, 0.6, 1).multiplyScalar(50);
  scene.add(key);

  // Stars.
  {
    const pts = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(150 + rnd() * 60);
      if (v.z > 40) v.z = -v.z; // keep them behind the planet
      pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfb7a4, size: 0.7, transparent: true, opacity: 0.55, depthWrite: false })));
  }

  // Nebula: dim reddish dust on a huge sphere behind the stars (3D value noise on the view direction).
  const nebulaMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uStrength: { value: GLOBE.nebula }, uBg: { value: new THREE.Color(BG) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uBg;
      varying vec3 vDir;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), u.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), u.x), u.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), u.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
      }
      float f3(vec3 p) {
        float s = 0.0, a = 0.5;
        for (int o = 0; o < 5; o++) { s += a * n3(p); p *= 2.03; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = vDir * 2.2;
        float warp = f3(d + 5.3);
        float n = f3(d + warp * 1.6);
        float dust = smoothstep(0.42, 0.85, n);
        float dark = smoothstep(0.55, 0.8, f3(d * 2.0 + 11.0)); // darker lanes through the glow
        vec3 col = mix(vec3(0.16, 0.05, 0.03), vec3(0.42, 0.17, 0.09), smoothstep(0.6, 0.95, n));
        col *= dust * (1.0 - 0.6 * dark);
        gl_FragColor = vec4(uBg + col * uStrength, 1.0);
      }`,
  });
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), nebulaMat);
  nebula.renderOrder = -10;
  scene.add(nebula);

  // Opaque core: shows through the gaps as the hex lines, and hides the folded far side of the plane.
  const core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 0.7, 64, 48), new THREE.MeshStandardMaterial({ color: CORE, roughness: 1 }));
  scene.add(core);

  // Atmosphere: a thin, crisp rim of air just outside the planet. Unit sphere, scaled live (atmoThickness).
  const atmoMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(GLOBE.atmoColor) },
      uStrength: { value: GLOBE.atmoStrength },
      uInner: { value: 1 / (1 + GLOBE.atmoThickness) }, // planet radius / shell radius
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength, uInner;
      varying vec3 vWorld;
      void main() {
        // How close the view ray passes to the planet's centre, as a share of the shell radius: 1 at the outer
        // edge, uInner where it grazes the ground. Light builds up from the outside in and peaks at the limb.
        vec3 rd = normalize(vWorld - cameraPosition);
        float shellR = length(vWorld);
        float tc = -dot(cameraPosition, rd);
        float miss = length(cameraPosition + rd * tc) / shellR;
        float k = clamp((1.0 - miss) / (1.0 - uInner), 0.0, 1.0);
        float glow = miss > uInner ? pow(k, 1.6) : 0.12 + 0.5 * pow(miss / uInner, 8.0); // over the face: faint haze
        float lit = 0.55 + 0.45 * clamp(dot(normalize(vWorld), normalize(vec3(-0.55, 0.6, 1.0))) + 0.4, 0.0, 1.0);
        gl_FragColor = vec4(uColor * glow * lit * uStrength, 1.0);
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), atmoMat);
  atmo.renderOrder = 4;
  scene.add(atmo);

  // ---------- sun and moon ----------
  // The sun is a fixed disc in the sky behind the planet. The moon's circle is almost edge-on: the near half
  // crosses the face and sags below the middle, the far half passes behind the planet. Depth testing hides
  // whichever of them is on the far side. Neither moves the key light.
  function glowTexture(stops) {
    const n = 128;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const glowMat = (map) => new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const sun = new THREE.Group();
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c8 })));
  const sunGlow = new THREE.Sprite(
    glowMat(glowTexture([[0, 'rgba(255,236,180,1)'], [0.12, 'rgba(255,214,130,0.85)'], [0.35, 'rgba(255,160,60,0.28)'], [1, 'rgba(255,120,30,0)']])),
  );
  sun.add(sunGlow);
  const moon = new THREE.Group();
  {
    // NASA moon colour map (via the three.js examples), wrapped round the sphere.
    const map = new THREE.TextureLoader().load('/textures/moon.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    moon.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.35, roughness: 1 })));
  }
  const moonGlow = new THREE.Sprite(glowMat(glowTexture([[0, 'rgba(210,225,255,0.7)'], [0.3, 'rgba(170,190,235,0.25)'], [1, 'rgba(140,160,220,0)']])));
  moon.add(moonGlow);
  scene.add(sun, moon);
  let orbitAngle = 1.15; // starts on the near arc, right of center and below the middle
  // Camera sits on +Z looking toward the origin, so screen right is +X and screen up is +Y.
  // angle 0 is the right limb. angle π/2 is the near side (+Z, toward the camera) and sits low.
  // Check, roll 0: angle π/2 → (0, -r sin tilt, +r cos tilt). angle 0, roll > 0 → y = r sin roll (right limb lifts).
  const orbitPos = (angle, out) => {
    const r = RADIUS * GLOBE.orbitRadius;
    const tilt = THREE.MathUtils.degToRad(GLOBE.orbitTilt);
    const roll = THREE.MathUtils.degToRad(GLOBE.orbitRoll);
    const x = Math.cos(angle) * r;
    const y = -Math.sin(angle) * r * Math.sin(tilt);
    const z = Math.sin(angle) * r * Math.cos(tilt);
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    return out.set(x * c - y * s, x * s + y * c, z);
  };
  function updateSky(dt) {
    orbitAngle += dt * GLOBE.orbitSpeed;
    // Behind the planet (camera is on +Z), up and to the side so the disc sits in the sky past the limb.
    sun.position.set(-RADIUS * 1.6, RADIUS * 1.15, -RADIUS * 1.4);
    // The moon circles the view centre: dragging scrolls the planet under the fixed camera, but the
    // orbit stays put around the middle of the screen, however the globe is turned.
    orbitPos(orbitAngle, moon.position);
    sun.children[0].scale.setScalar(GLOBE.sunSize);
    sunGlow.scale.setScalar(Math.max(1e-3, GLOBE.sunGlow));
    moon.children[0].scale.setScalar(GLOBE.moonSize);
    moonGlow.scale.setScalar(Math.max(1e-3, GLOBE.moonGlow));
    moon.children[0].rotation.y += dt * GLOBE.moonSpin;
  }

  // ---------- hex tiles ----------
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({ c, r, p: cellCenter(c, r) });
  // The board's desert sand (seamlessGround.js), sampled at plane-space UVs so it runs on unbroken from hex to hex
  // and scrolls with the planet. Vertex colours keep the bevel shading; instance colours tint the city hexes.
  const sand = sandTexture();
  sand.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // ---------- baked terrain height ----------
  // terrainHeight() is rendered once into a tileable texture (one wrap of the plane), then read by the tiles:
  // the vertices for the shape, every pixel for the slope lighting, so detail stays crisp at any Terrain detail.
  const heightRT = new THREE.WebGLRenderTarget(HEIGHT_RES, HEIGHT_RES, {
    type: THREE.HalfFloatType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const terrainUniforms = {
    uHeightMap: { value: heightRT.texture },
    uTerrainDepth: { value: GLOBE.terrainDepth },
    uTerrainScale: { value: GLOBE.terrainScale },
    uCraters: { value: GLOBE.craters },
    uCities: { value: Array.from({ length: MAX_CITIES }, () => new THREE.Vector2()) },
    uCityCount: { value: 0 },
  };
  const bakeMat = new THREE.ShaderMaterial({
    uniforms: {
      uGlobePeriod: { value: PERIOD.clone() },
      uRegionScale: { value: Math.round(GLOBE.regionScale) },
      ...terrainUniforms,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uGlobePeriod;
      varying vec2 vUv;
      ${PERIODIC_NOISE}
      ${TERRAIN_GLSL}
      void main() {
        gl_FragColor = vec4(terrainHeight(vUv * uGlobePeriod), 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  bakeMat.userData.flat = true; // never the board's map-shape bend
  const bakeScene = new THREE.Scene();
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat);
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let bakedKey = '';
  /** Re-bake the height map when a terrain setting or a city moved. */
  function bakeTerrain() {
    const u = terrainUniforms;
    const key = [GLOBE.terrainScale, GLOBE.craters, Math.round(GLOBE.regionScale), u.uCityCount.value, ...u.uCities.value.flatMap((c) => [c.x, c.y])].join();
    if (key === bakedKey) return;
    bakedKey = key;
    u.uTerrainScale.value = GLOBE.terrainScale;
    u.uCraters.value = GLOBE.craters;
    bakeMat.uniforms.uRegionScale.value = Math.round(GLOBE.regionScale);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(heightRT);
    renderer.render(bakeScene, bakeCam);
    renderer.setRenderTarget(prev);
  }

  const tileMat = bend.patch(
    new THREE.MeshStandardMaterial({ map: sand, color: SAND.tint, vertexColors: true, roughness: SAND.roughness, metalness: 0 }),
  );
  {
    const bendCompile = tileMat.onBeforeCompile;
    tileMat.onBeforeCompile = (shader) => {
      bendCompile(shader);
      shader.uniforms.uSandRepeat = { value: GLOBE.sandScale };
      shader.uniforms.uHexScale = { value: (1 - GLOBE.gridLine) / 0.93 };
      shader.uniforms.uRegionStrength = { value: GLOBE.regionStrength };
      shader.uniforms.uRegionScale = { value: Math.round(GLOBE.regionScale) };
      Object.assign(shader.uniforms, terrainUniforms);
      tileMat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSandRepeat;\nuniform float uHexScale;')
        .replace('void main() {', `${HEIGHT_READ_GLSL}\nvarying vec3 vTuV, vTvV, vUpV;\nvarying float vCap;\nvoid main() {\n  float tH = 0.0;`)
        // Height and slope normal of the carved cap (the skirt's top edge follows the rim's height).
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          if (position.y > -0.01) {
            mat4 tm = modelMatrix;
            #ifdef USE_INSTANCING
              tm = modelMatrix * instanceMatrix;
            #endif
            vec2 pp = (tm * vec4(position.x * uHexScale, 0.0, position.z * uHexScale, 1.0)).xz;
            tH = heightAt(pp / uGlobePeriod);
          }`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= uHexScale;\ntransformed.y += tH;')
        // The bent tangent frame in view space, for the per-pixel slope normal (cap only; the skirt keeps its own).
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vTuV = normalize(mat3(viewMatrix) * globeTu);
          vTvV = normalize(mat3(viewMatrix) * globeTv);
          vUpV = normalize(mat3(viewMatrix) * globeUp);
          vCap = objectNormal.y > 0.5 ? 1.0 : 0.0;`,
        )
        .replace('#include <common>', '#include <common>\nvarying vec2 vRegion;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMapUv = globePlane.xz / uSandRepeat;\nvRegion = globePlane.xz / uGlobePeriod;');
      // Large regions across the planet: pale dusty highlands, dark rust lowlands, greyish salt flats.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vRegion;\nvarying vec3 vTuV, vTvV, vUpV;\nvarying float vCap;\nuniform float uRegionStrength, uRegionScale;\nuniform vec2 uGlobePeriod;\n${PERIODIC_NOISE}\n${HEIGHT_READ_GLSL}`)
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          if (vCap > 0.5 && uTerrainDepth > 0.0) {
            // Slope from the neighbouring texels, in height per plane unit; lit steeper than it is so relief reads.
            vec2 px = vec2(1.0 / ${HEIGHT_RES}.0);
            float gx = (heightAt(vRegion + vec2(px.x, 0.0)) - heightAt(vRegion - vec2(px.x, 0.0))) / (2.0 * px.x * uGlobePeriod.x);
            float gz = (heightAt(vRegion + vec2(0.0, px.y)) - heightAt(vRegion - vec2(0.0, px.y))) / (2.0 * px.y * uGlobePeriod.y);
            normal = normalize(vUpV - 2.2 * (gx * vTuV + gz * vTvV));
          }`,
        )

        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float land = pwarp(vRegion, uRegionScale, vec2(0.13, 0.71));
            float salt = pwarp(vRegion, uRegionScale * 2.0, vec2(0.57, 0.29));
            vec3 tint = mix(vec3(0.36, 0.27, 0.23), vec3(0.95, 0.9, 0.86), smoothstep(0.38, 0.54, land));
            tint = mix(tint, vec3(1.25, 1.17, 1.05), smoothstep(0.56, 0.7, land));
            vec3 c = diffuseColor.rgb * tint;
            float lum = dot(c, vec3(0.299, 0.587, 0.114));
            c = mix(c, vec3(lum) * vec3(1.02, 1.02, 1.05) * 1.12, smoothstep(0.58, 0.68, salt) * 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, c, uRegionStrength);
            // Crater floors and canyon beds a shade darker, ridge tops a little lighter.
            if (uTerrainDepth > 0.0) {
              float hn = heightAt(vRegion) / uTerrainDepth;
              diffuseColor.rgb *= mix(0.78, 1.1, smoothstep(-0.3, 0.3, hn));
            }
          }`,
        );
    };
    tileMat.customProgramCacheKey = () => 'globe-bend-sand';
  }
  const tiles = new THREE.InstancedMesh(hexGeometry(), tileMat, cells.length);
  tiles.frustumCulled = false;
  const baseColors = [];
  {
    const m = new THREE.Matrix4();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    cells.forEach((cell, i) => {
      m.makeTranslation(cell.p.x, 0, cell.p.y);
      tiles.setMatrixAt(i, m);
      const color = TILE.clone().multiplyScalar(0.94 + rnd() * 0.08);
      baseColors.push(color);
      tiles.setColorAt(i, color);
    });
  }
  scene.add(tiles);

  // ---------- clouds ----------
  // Thin drifting wisps on a shell just above the tiles. Each pixel is unbent back to its place on the wrapping
  // plane, so the clouds scroll with the planet; the pattern is tileable, so they wrap without a seam.
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...bend.uniforms,
      uTime: { value: 0 },
      uOpacity: { value: GLOBE.cloudOpacity },
      uCover: { value: GLOBE.cloudCover },
      uScale: { value: GLOBE.cloudScale },
      uSpeed: { value: GLOBE.cloudSpeed },
      uPuff: { value: GLOBE.cloudPuff },
      uClear: { value: GLOBE.cloudCityClear },
      uCities: terrainUniforms.uCities, // shared: the same city positions as the terrain
      uCityCount: terrainUniforms.uCityCount,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlobeRadius;
      uniform vec2 uGlobeScroll, uGlobePeriod;
      uniform float uTime, uOpacity, uCover, uScale, uSpeed;
      varying vec3 vWorld;
      uniform float uPuff, uClear;
      uniform vec2 uCities[${MAX_CITIES}];
      uniform int uCityCount;
      ${PERIODIC_NOISE}
      // Distance (plane units, wrapped) to the nearest city.
      float cloudCityDist(vec2 p) {
        float m = 1e3;
        for (int i = 0; i < ${MAX_CITIES}; i++) {
          if (i >= uCityCount) break;
          vec2 d = p - uCities[i];
          d -= uGlobePeriod * floor(d / uGlobePeriod + 0.5);
          m = min(m, length(d));
        }
        return m;
      }
      float cloudDensity(vec2 t, float edge) {
        float bank = pwarp(t, uScale, vec2(0.41, 0.83));
        // Billow noise (|2n-1|) folds into rounded lumps; centred on 0 so it scallops edges without adding cover.
        float p1 = abs(pfbm(t, uScale * 3.0, vec2(0.9, 0.2)) * 2.0 - 1.0);
        float p2 = abs(pfbm(t, uScale * 8.0, vec2(0.3, 0.6)) * 2.0 - 1.0);
        float puffs = (p1 * 0.6 + p2 * 0.4) - 0.3;
        return clamp((bank + puffs * 0.45 - edge) * 4.0, 0.0, 1.0);
      }
      void main() {
        vec3 n = normalize(vWorld);
        float th = acos(clamp(n.z, -1.0, 1.0));
        float s = sin(th);
        vec2 dir = s > 1e-4 ? vec2(n.x, -n.y) / s : vec2(0.0);
        vec2 plane = uGlobeScroll + dir * th * uGlobeRadius;
        vec2 t = plane / uGlobePeriod + vec2(1.0, 0.35) * uTime * uSpeed;
        // Billowy density: large warped banks, then puffs (billow noise: rounded lumps) scalloping their edges.
        float edge = mix(0.72, 0.36, uCover); // cover 0 leaves clear sky, cover 1 a full overcast
        float dens = cloudDensity(t, edge);
        // Part round the cities so their towers stay in view; a ragged edge from the puff noise.
        if (uClear > 0.0) {
          float cd = cloudCityDist(plane) + (pfbm(t, uScale * 8.0, vec2(0.6, 0.1)) - 0.5) * uClear * 0.6;
          dens *= smoothstep(uClear * 0.6, uClear * 1.3, cd);
        }
        // Self-shadow: step toward the sun across the plane. Puffs facing it catch light, the far sides go grey.
        vec2 sunStep = normalize(vec2(-0.55, -0.6)) * (0.02 / uScale);
        float toward = cloudDensity(t + sunStep, edge) + 0.6 * cloudDensity(t + sunStep * 2.5, edge);
        float shade = clamp(0.75 - (toward / 1.6 - dens) * uPuff * 2.2, 0.0, 1.0); // > dens toward the sun: in shadow
        float lit = clamp(dot(n, normalize(vec3(-0.55, 0.6, 1.0))) * 0.6 + 0.55, 0.25, 1.0);
        vec3 dark = vec3(0.55, 0.5, 0.46);
        vec3 bright = vec3(1.0, 0.96, 0.9);
        vec3 col = mix(dark, bright, shade) * mix(0.55, 1.0, lit);
        // Thin edges glow a little (light passing through), thick centres stay solid.
        col += vec3(0.08, 0.06, 0.04) * (1.0 - smoothstep(0.0, 0.5, dens)) * lit;
        float a = smoothstep(0.0, 0.5, dens);
        // Fade toward the limb, where the shell would pile up into a solid band.
        float facing = dot(n, normalize(cameraPosition - vWorld));
        // Nothing past the planet's own outline: clouds there would float off the edge of the ball.
        vec3 rd = normalize(vWorld - cameraPosition);
        float miss = length(cameraPosition - rd * dot(cameraPosition, rd)) / uGlobeRadius;
        // Only the near half of the shell, solid right up to the limb (no fade that lets the ground show through).
        if (facing <= 0.0) discard;
        a *= uOpacity * smoothstep(1.0, 0.985, miss);
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), cloudMat);
  clouds.renderOrder = 3; // over the fog billows
  scene.add(clouds);

  // ---------- fog of war ----------
  // The board's fog-of-war billows (same shading and colour, fogOfWar.js) blanketing every hex but the cities'.
  // Camera-facing quads anchored on the plane and bent onto the ball in the vertex shader; the core hides the ones
  // past the limb. Rebuilt whenever the cities are placed.
  const fogColA = new THREE.Color();
  const fogColB = new THREE.Color();
  const fogMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...bend.uniforms,
      uTime: { value: 0 },
      uSize: { value: GLOBE.fogBillowSize },
      uHeight: { value: GLOBE.fogHeight },
      uOpacity: { value: GLOBE.fogOpacity },
      uColorA: { value: fogColA },
      uColorB: { value: fogColB },
    },
    vertexShader: /* glsl */ `
      ${bend.glsl}
      uniform float uTime, uSize, uHeight;
      attribute vec4 aBillow; // plane x, plane z, seed, alpha
      varying vec2 vUv;
      varying float vSeed, vUp, vAlpha, vHeight;
      varying vec4 vRim;
      void main() {
        vUv = uv;
        float seed = aBillow.z;
        float a = seed * 40.0 + uTime * (0.08 + seed * 0.08);
        vec2 p = aBillow.xy + vec2(cos(a), sin(a)) * 0.25;
        float h = uHeight * (0.6 + seed * 0.8);
        vec3 world = globeBend(globeRel(p, aBillow.xy), h);
        // Fade out toward the limb so quads don't stand up off the horizon.
        float facing = normalize(world).z;
        vAlpha = aBillow.w * smoothstep(0.08, 0.35, facing);
        vSeed = seed;
        vHeight = 0.45 + seed;
        vRim = vec4(cos(seed * 17.0), sin(seed * 17.0), cos(seed * 11.0), sin(seed * 11.0));
        float ang = seed * 6.2831853 + uTime * 0.05 * (seed - 0.5);
        vec2 off = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * position.xy;
        vUp = off.y * 2.0;
        float size = uSize * (0.8 + seed * 0.4) * (1.0 + 0.08 * sin(a * 2.3));
        vec4 mv = viewMatrix * vec4(world, 1.0);
        mv.xy += off * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${BILLOW_SHADE}
      uniform vec3 uColorA, uColorB;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed, vUp, vAlpha, vHeight;
      varying vec4 vRim;
      void main() {
        vec4 b = billowShade(vUv, uColorA, uColorB, vSeed, vUp, vHeight, vRim, 1.0, 1.0, 0.18);
        float alpha = b.a * vAlpha * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(b.rgb, alpha);
        #include <colorspace_fragment>
      }`,
  });
  let fogMesh = null;

  /**
   * Fog of war over the whole planet: billows on every hex except the cities' own (plus GLOBE.fogCityClear rings
   * around them). `avoid`: the cities' plane positions.
   */
  function buildFog(avoid) {
    if (fogMesh) {
      scene.remove(fogMesh);
      fogMesh.geometry.dispose();
      fogMesh = null;
    }
    const per = Math.round(GLOBE.fogPerHex);
    if (!per) return;
    let seed = 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const d = new THREE.Vector2();
    // Hex centres are SQ3 apart: anything under (rings + 0.5) steps from a city is that city's ring.
    const clear = (Math.round(GLOBE.fogCityClear) + 0.5) * SQ3 * HEX;
    const data = [];
    for (const cell of cells) {
      const near = Math.min(...avoid.map((a) => bend.wrapDelta(cell.p.x, cell.p.y, a, d).length()));
      if (near < clear) continue;
      // Thinner on the hexes right next to an uncovered one, so the clearing has a soft edge.
      const edge = Math.min(1, 0.6 + (near - clear) / (SQ3 * HEX * 1.5));
      for (let i = 0; i < per; i++) {
        const j = 0.45 * HEX;
        data.push(cell.p.x + (rnd() - 0.5) * 2 * j, cell.p.y + (rnd() - 0.5) * 2 * j, rnd(), (0.75 + 0.25 * rnd()) * edge);
      }
    }
    if (!data.length) return;
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.setAttribute('aBillow', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    geo.instanceCount = data.length / 4;
    fogMesh = new THREE.Mesh(geo, fogMat);
    fogMesh.frustumCulled = false;
    fogMesh.renderOrder = 2;
    scene.add(fogMesh);
  }

  // ---------- nodes ----------
  const nodeRoot = new THREE.Group();
  scene.add(nodeRoot);
  // Each city is a Hive City capital model standing on its hex. The model's materials are shared with the
  // board, so it isn't bent in the shader: its holder is placed on the sphere every frame (placeNode).

  let nodes = []; // { id, color, cell, p, group, lift, el, rival }
  let rivals = [];
  const labelsEl = root.querySelector('#globeLabels');
  const cardEl = root.querySelector('#globeCard');

  function nearestCell(x, z, taken) {
    let best = -1;
    let bestD = Infinity;
    const d = new THREE.Vector2();
    cells.forEach((cell, i) => {
      if (taken.has(i)) return;
      const dist = bend.wrapDelta(cell.p.x, cell.p.y, new THREE.Vector2(x, z), d).lengthSq();
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    return best;
  }

  function clearNodes() {
    nodeRoot.clear();
    for (const n of nodes) tiles.setColorAt(n.cell, baseColors[n.cell]);
    tiles.instanceColor.needsUpdate = true;
    nodes = [];
    labelsEl.innerHTML = '';
  }

  /**
   * Push cities apart (on the wrapping plane) until every pair is at least GLOBE.minGap apart, keeping their
   * war-table directions. Hive City (index 0) stays put. The gap is capped below half the planet.
   */
  function spreadOut(pts) {
    const gap = Math.min(GLOBE.minGap, Math.min(PERIOD.x, PERIOD.y) * 0.48);
    const d = new THREE.Vector2();
    for (let iter = 0; iter < 80; iter++) {
      let moved = false;
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
          bend.wrapDelta(pts[b].x, pts[b].y, pts[a], d);
          let len = d.length();
          if (len >= gap) continue;
          if (len < 1e-4) {
            d.set(Math.cos(b * 2.4), Math.sin(b * 2.4)); // same spot: pick a direction
            len = 1e-4;
          } else d.divideScalar(len);
          const push = gap - len;
          if (a === 0) pts[b].addScaledVector(d, push);
          else {
            pts[a].addScaledVector(d, -push / 2);
            pts[b].addScaledVector(d, push / 2);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return pts;
  }

  /** What the attack playback has shown landing on each city so far (id -> { hp, dead }), until the phase ends. */
  const warShown = new Map();
  function applyShown(n) {
    const seen = warShown.get(n.id);
    if (!seen) return;
    if (seen.hp !== undefined) n.hpShown = seen.hp;
    if (seen.dead && !n.deadShown) {
      n.deadShown = true;
      n.group.clear();
      n.group.add(factory.create('crater'));
    }
  }

  /** Where every city sits on the planet ({ id, p, color }), without building anything (works with the planet shut). */
  function layout(list = rivals) {
    const defs = [{ id: 'player', map: PLAYER_NODE, color: PLAYER_NODE.color }, ...list.map((r) => ({ id: r.id, map: r.def.map, color: r.def.color }))];
    const spots = spreadOut(defs.map((def) => new THREE.Vector2(((def.map.x - 50) / 100) * GLOBE.spread, ((def.map.y - 50) / 100) * GLOBE.spread)));
    const taken = new Set();
    return defs.map((def, i) => {
      const cell = nearestCell(spots[i].x, spots[i].y, taken);
      taken.add(cell);
      return { id: def.id, p: cells[cell].p.clone(), color: new THREE.Color(def.color) };
    });
  }

  function buildNodes() {
    clearNodes();
    const defs = [
      { id: 'player', map: PLAYER_NODE, color: PLAYER_NODE.color, rival: null },
      ...rivals.map((rival) => ({ id: rival.id, map: rival.def.map, color: rival.def.color, rival })),
    ];
    const spots = spreadOut(defs.map((def) => new THREE.Vector2(((def.map.x - 50) / 100) * GLOBE.spread, ((def.map.y - 50) / 100) * GLOBE.spread)));
    const taken = new Set();
    for (const [i, def] of defs.entries()) {
      const cell = nearestCell(spots[i].x, spots[i].y, taken);
      taken.add(cell);
      const p = cells[cell].p.clone();
      const color = new THREE.Color(def.color);

      const group = new THREE.Group();
      group.matrixAutoUpdate = false; // placeNode sets the matrix
      group.add(factory.create(def.rival?.alive === false ? 'crater' : 'capital')); // a fallen city: its crater
      nodeRoot.add(group);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'globe-node';
      el.dataset.globeNode = def.id;
      el.style.setProperty('--node', def.color);
      labelsEl.appendChild(el);
      nodes.push({ id: def.id, color, cell, p, group, lift: 0, el, rival: def.rival });
      applyShown(nodes.at(-1));
    }
    tiles.instanceColor.needsUpdate = true;
    // City positions, so the terrain stays level under them.
    const cityU = terrainUniforms.uCities.value;
    terrainUniforms.uCityCount.value = Math.min(nodes.length, MAX_CITIES);
    nodes.slice(0, MAX_CITIES).forEach((n, i) => cityU[i].copy(n.p));
    buildFog(nodes.map((n) => n.p));
    renderLabels();
  }

  function renderLabels() {
    for (const n of nodes) {
      const name = n.rival ? L(n.rival.def.name, n.rival.def.zh) : L('Hive City', '蜂巢城');
      // Home gets a crown over its name.
      // hpShown / deadShown: what the attack playback has reached so far (the real state updates after it).
      const hp = n.hpShown ?? (n.rival ? (n.rival.capitalHp ?? 5) : playerHp());
      const dead = n.deadShown || (n.rival ? n.rival.alive === false : hp <= 0);
      const pips = dead ? L('Destroyed', '已摧毁') : '■'.repeat(hp) + '□'.repeat(Math.max(0, 5 - hp));
      n.el.innerHTML = `<i></i>${n.rival ? '' : '<b class="globe-crown" aria-hidden="true">♛</b>'}<span>${name}</span><b class="globe-hp">${pips}</b>`;
      n.el.classList.toggle('home', !n.rival);
      n.el.classList.toggle('dead', dead);
    }
    root.querySelector('.globe-title').textContent = L('War Map', '战争地图');
  }

  onLangChange(() => {
    if (active) {
      renderLabels();
      if (hovered) showCard(hovered);
    }
  });

  // ---------- state ----------
  let active = false;
  let distance = D_DEFAULT;
  let goalDistance = D_DEFAULT;
  let anim = null; // { t, dur, from: {scroll, d}, to: {scroll, d}, ease, done }
  let hovered = null;
  let hoverFromLabel = null;
  const velocity = new THREE.Vector2();
  const pointer = { x: 0, y: 0, inside: false };
  let drag = null;
  let over = 0;
  let dive = null; // { n, from, k (target 0–1), shown (eased), at }
  let overAt = 0;
  let wheelAt = 0;

  const size = new THREE.Vector2();
  function fit() {
    renderer.getSize(size);
    const aspect = size.x / Math.max(1, size.y);
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  }

  function worldPerPx() {
    return (2 * (distance - RADIUS) * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(1, size.y);
  }

  function setScroll(x, z) {
    const s = bend.scroll();
    s.set(x - PERIOD.x * Math.floor(x / PERIOD.x + 0.5), z - PERIOD.y * Math.floor(z / PERIOD.y + 0.5));
  }

  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.Sphere(new THREE.Vector3(), RADIUS);
  const hitP = new THREE.Vector3();
  const tmp2 = new THREE.Vector2();

  /** Node under a screen point (inverse bend, then nearest node cell on the plane). */
  function pick(clientX, clientY, radius = 0.95 * HEX) {
    const plane = planeAt(clientX, clientY, tmp2);
    if (!plane) return null;
    let best = null;
    let bestD = radius;
    for (const n of nodes) {
      const d = bend.wrapDelta(n.p.x, n.p.y, plane).length();
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Absolute plane point under a screen point, or null off the planet. */
  function planeAt(clientX, clientY, out = new THREE.Vector2()) {
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectSphere(sphere, hitP)) return null;
    return bend.unbend(hitP, out);
  }

  function showCard(n) {
    const rival = n.rival;
    const name = rival ? L(rival.def.name, rival.def.zh) : L('Hive City', '蜂巢城');
    const leader = rival ? L(rival.def.leader, rival.def.leaderZh) : L('Overseer', '总督');
    const personality = rival ? L(rival.def.personalityName, rival.def.personalityZh) : '—';
    const buildings = rival ? rival.stats.buildings : playerBuildings();
    cardEl.innerHTML = `
      <div class="globe-card-name">${name}</div>
      <div><span>${L('Leader', '领袖')}</span><b>${leader}</b></div>
      <div><span>${L('Personality', '性情')}</span><b>${personality}</b></div>
      <div><span>${L('Buildings', '建筑')}</span><b>${buildings}</b></div>
      ${rival ? `<div><span>${L('Missiles', '导弹')}</span><b>${rival.stats.missiles ?? 0}</b></div>
      <div><span>${L('Interceptors', '拦截网')}</span><b>${rival.stats.interceptors ?? 0}</b></div>` : ''}
      <div><span>${L('Tension', '紧张度')}</span><b>—</b></div>
      <div class="globe-card-hint">${rival ? L('Click to visit', '点击访问') : L('Click to return', '点击返回')}</div>`;
    cardEl.classList.remove('hidden');
  }

  function setHovered(n) {
    if (n === hovered) return;
    hovered = n;
    dom.style.cursor = n ? 'pointer' : '';
    for (const node of nodes) node.el.classList.toggle('hover', node === n);
    if (n) showCard(n);
    else cardEl.classList.add('hidden');
  }

  // ---------- input ----------
  const usable = () => active && !anim && !visiting;

  dom.addEventListener('pointerdown', (e) => {
    if (!usable() || dive || e.button !== 0) return;
    drag = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    velocity.set(0, 0);
  });
  window.addEventListener('pointermove', (e) => {
    if (!active) return;
    const rect = dom.getBoundingClientRect();
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = e.target === dom && e.clientX >= rect.left && e.clientX <= rect.right;
    if (!drag || anim) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      dom.style.cursor = 'grabbing';
    }
    if (drag.moved) {
      const now = performance.now();
      const dt = Math.max(1, now - drag.t) / 1000;
      const k = worldPerPx();
      const dx = -(e.clientX - drag.x) * k;
      const dz = -(e.clientY - drag.y) * k;
      const s = bend.scroll();
      setScroll(s.x + dx, s.y + dz);
      velocity.lerp(new THREE.Vector2(dx / dt, dz / dt), 0.5);
      drag.t = now;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.button !== 0) return;
    const d = drag;
    drag = null;
    dom.style.cursor = hovered ? 'pointer' : '';
    if (!active || anim) return;
    if (d.moved) {
      if (performance.now() - d.t > 80) velocity.set(0, 0); // held still before letting go
      return;
    }
    const n = pick(e.clientX, e.clientY);
    if (n) visit(n.id);
  });
  dom.addEventListener(
    'wheel',
    (e) => {
      if (!usable()) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const next = THREE.MathUtils.clamp(goalDistance * Math.exp(dy * 0.0012), D_MIN, D_MAX);
      // Zoomed in fully: scrolling in further dives toward the city under the cursor (scrubbed, reversible).
      // Mid attack phase the dive into a city would stop the playback (unless the page keeps it ticking).
      if (dive || (dy < 0 && goalDistance <= D_MIN + 1e-3 && (!war || freeDuringWar))) {
        const now = performance.now();
        const units = wheelUnits(e, wheelAt);
        wheelAt = now;
        if (!dive) {
          const n = hoverFromLabel ?? pick(e.clientX, e.clientY, 1.6 * HEX);
          if (!n) return;
          dive = { n, from: bend.scroll().clone(), k: 0, shown: 0, at: now };
        }
        if (units > 0 && dive.k < 0.6) {
          dive.back = (dive.back ?? 0) + units;
          if (dive.back < 216) return; // one stray tick does not cancel
        } else dive.back = 0;
        if (dive.k < 0.6) dive.k = THREE.MathUtils.clamp(dive.k - units / DIVE, 0, 1);
        dive.at = now;
        return;
      }
      over = 0;
      goalDistance = next;
      // Zoom about the cursor: the plane point under it stays under it while the distance eases.

    },
    { passive: false },
  );

  labelsEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-globe-node]');
    if (el && usable()) visit(el.dataset.globeNode);
  });
  labelsEl.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-globe-node]');
    if (!el) return;
    hoverFromLabel = nodes.find((n) => n.id === el.dataset.globeNode) ?? null;
  });
  labelsEl.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-globe-node]');
    if (!el || el.contains(e.relatedTarget)) return;
    hoverFromLabel = null;
  });
  // Wheel over a label still zooms the globe.
  labelsEl.addEventListener('wheel', (e) => dom.dispatchEvent(new WheelEvent('wheel', e)), { passive: true });

  // ---------- animation ----------
  function animate(toScroll, toDistance, dur, ease) {
    const s = bend.scroll();
    const delta = bend.wrapDelta(toScroll.x, toScroll.y);
    return new Promise((done) => {
      anim = { t: 0, dur, from: s.clone(), delta, d0: distance, d1: toDistance, ease, done };
    });
  }

  let visiting = false;
  /** Fly down onto a node, then report it. main.js fades and swaps the view. */
  async function visit(id) {
    if (war && !freeDuringWar) return; // no flying off mid attack phase
    const n = nodes.find((node) => node.id === id);
    if (n?.rival && n.rival.alive === false) return; // nothing left to visit
    if (!n || visiting || dive || !active) return;
    drag = null;
    velocity.set(0, 0);
    setHovered(null);
    // Same dive as scrolling in (clouds roll in during the fly-down), timed by how far there is to go.
    const pan = bend.wrapDelta(n.p.x, n.p.y).length();
    const zoom = THREE.MathUtils.clamp((distance - D_MIN) / (D_MAX - D_MIN), 0, 1);
    const dur = THREE.MathUtils.clamp(0.6 + 0.35 * zoom + 0.04 * pan, 0.6, 1.2);
    dive = { n, from: bend.scroll().clone(), d0: distance, k: 0, shown: 0, at: performance.now(), auto: dur };
  }

  // ---------- frame ----------
  const proj = new THREE.Vector3();
  const world = new THREE.Vector3();
  const limb = () => RADIUS / distance; // cos θ of the visible edge

  // Stand a city's capital on the sphere: same tangent frame as the shader bend (plane x → Tu, height → up,
  // plane z → Tv), so it sits upright on its hex facing the same way as the tiles.
  const tu = new THREE.Vector3();
  const tv = new THREE.Vector3();
  const up = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const rel = new THREE.Vector2();
  function placeNode(n) {
    bend.wrapDelta(n.p.x, n.p.y, undefined, rel);
    bend.bend(rel.x, rel.y, 0, p0);
    tu.copy(bend.bend(rel.x + 0.02, rel.y, 0, tu)).sub(p0).normalize();
    tv.copy(bend.bend(rel.x, rel.y + 0.02, 0, tv)).sub(p0).normalize();
    up.copy(p0).normalize();
    bend.bend(rel.x, rel.y, n.lift, p0);
    const s = GLOBE.cityScale * (n.scale ?? 1);
    n.group.matrix.makeBasis(tu.multiplyScalar(s), up.multiplyScalar(s), tv.multiplyScalar(s)).setPosition(p0);
    n.group.matrixWorldNeedsUpdate = true;
    n.group.visible = (n.scale ?? 1) > 0.01;
  }

  function update(dt) {
    if (!active) return;
    fit();
    // Live tuning: sand scale, fog look (colour and shading follow the board fog's settings).
    const sandShader = tileMat.userData.shader;
    if (sandShader) {
      sandShader.uniforms.uSandRepeat.value = GLOBE.sandScale;
      sandShader.uniforms.uHexScale.value = (1 - GLOBE.gridLine) / 0.93; // tile tops are 0.93 of a hex
      sandShader.uniforms.uRegionStrength.value = GLOBE.regionStrength;
      sandShader.uniforms.uRegionScale.value = Math.round(GLOBE.regionScale);
    }
    {
      terrainUniforms.uTerrainDepth.value = GLOBE.terrainDepth;
      bakeTerrain(); // only re-renders when a setting or a city changed
    }
    if (fogMesh) fogMesh.visible = GLOBE.fog !== 'Off';
    clouds.visible = GLOBE.clouds !== 'Off' && GLOBE.cloudOpacity > 0;
    clouds.scale.setScalar(RADIUS + GLOBE.cloudHeight);
    const cu = cloudMat.uniforms;
    cu.uTime.value = performance.now() / 1000;
    cu.uOpacity.value = GLOBE.cloudOpacity;
    cu.uCover.value = GLOBE.cloudCover;
    cu.uScale.value = Math.round(GLOBE.cloudScale);
    cu.uSpeed.value = GLOBE.cloudSpeed;
    cu.uPuff.value = GLOBE.cloudPuff;
    cu.uClear.value = GLOBE.cloudCityClear;
    atmo.scale.setScalar(RADIUS * (1 + GLOBE.atmoThickness));
    atmoMat.uniforms.uColor.value.set(GLOBE.atmoColor);
    atmoMat.uniforms.uStrength.value = GLOBE.atmoStrength;
    atmoMat.uniforms.uInner.value = 1 / (1 + GLOBE.atmoThickness);
    nebulaMat.uniforms.uStrength.value = GLOBE.nebula;
    nebula.visible = GLOBE.nebula > 0;
    const fu = fogMat.uniforms;
    fu.uTime.value = performance.now() / 1000;
    fu.uSize.value = GLOBE.fogBillowSize;
    fu.uHeight.value = GLOBE.fogHeight;
    fu.uOpacity.value = GLOBE.fogOpacity;
    fogColB.set(FOG.color);
    fogColA.copy(fogColB).multiplyScalar(1 - FOG.shade);
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / anim.dur);
      const k = anim.ease(anim.t);
      setScroll(anim.from.x + anim.delta.x * k, anim.from.y + anim.delta.y * k);
      distance = goalDistance = anim.d0 + (anim.d1 - anim.d0) * k;
      if (anim.t >= 1) {
        const done = anim.done;
        anim = null;
        done();
      }
    } else if (dive) {
      if (dive.auto) {
        // Clicked: a steady ramp, no drift back.
        dive.k = Math.min(1, dive.k + dt / dive.auto);
        dive.shown = dive.k;
      } else {
        if (dive.k >= 0.6) dive.k = Math.min(1, dive.k + dt / 0.6); // committed: finish the dive
        else if (performance.now() - dive.at > WHEEL_GAP) dive.k = Math.max(0, dive.k - dt / 1.5); // paused early: drift back
        dive.shown += (dive.k - dive.shown) * (1 - Math.exp(-9 * dt));
      }
      const k = dive.shown;
      const d = bend.wrapDelta(dive.n.p.x, dive.n.p.y, dive.from);
      // Clicks ease in only (still moving when the clouds take over); scroll dives keep smoothstep.
      const e = dive.auto ? k * k * (2 - k) : k * k * (3 - 2 * k);
      setScroll(dive.from.x + d.x * e, dive.from.y + d.y * e);
      const d0 = dive.d0 ?? D_MIN;
      distance = goalDistance = d0 + (D_CLOSE - d0) * e;
      onDive(Math.min(1, k * 1.05) ** 1.5);
      if (k > 0.96) {
        const id = dive.n.id;
        dive = null;
        visiting = true;
        setHovered(null);
        onVisit(id);
      } else if (dive.k === 0 && k < 0.005) {
        dive = null;
        distance = goalDistance = D_MIN;
        onDive(0);
      }
    } else {
      distance += (goalDistance - distance) * (1 - Math.exp(-10 * dt));
      if (!drag && velocity.lengthSq() > 1e-4) {
        const s = bend.scroll();
        setScroll(s.x + velocity.x * dt, s.y + velocity.y * dt);
        velocity.multiplyScalar(Math.exp(-4 * dt));
      }
    }
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    updateWar(dt);
    updateOil(dt);
    updateQueued();
    updateSky(dt); // after the scroll for this frame, so the moon turns with the drag

    // Hover: label first, then the planet under the pointer.
    if (!anim && !visiting && !dive) {
      const n = hoverFromLabel ?? (pointer.inside && !drag?.moved ? pick(pointer.x, pointer.y) : null);
      setHovered(n);
    }

    // Labels follow the pin heads. On the far side they stay up, pushed out to stick past the planet's edge.
    const rect = dom.getBoundingClientRect();
    proj.set(0, 0, 0).project(camera);
    const cx = rect.left + ((proj.x + 1) / 2) * rect.width;
    const cy = rect.top + ((1 - proj.y) / 2) * rect.height;
    // Screen radius of the planet's silhouette.
    const rim = (Math.tan(Math.asin(Math.min(1, RADIUS / distance))) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * (rect.height / 2);
    for (const n of nodes) {
      // Pins sink away once their cell is past the horizon, so they don't poke up from the far side.
      const ground = bend.project(n.p.x, n.p.y, 0, world).normalize().z;
      const vis = THREE.MathUtils.smoothstep(ground, limb() - 0.3, limb() - 0.02);
      const size = (n === hovered ? GLOBE.hoverScale : 1) * vis;
      n.scale = THREE.MathUtils.lerp(n.scale ?? size, size, 1 - Math.exp(-12 * dt));
      n.lift = THREE.MathUtils.lerp(n.lift, n === hovered ? GLOBE.hoverLift : 0, 1 - Math.exp(-12 * dt));
      placeNode(n);
      bend.project(n.p.x, n.p.y - GLOBE.labelNorth, GLOBE.labelHeight, world); // name above the capital
      const facing = world.clone().normalize().z;
      proj.copy(world).project(camera);
      let x = rect.left + ((proj.x + 1) / 2) * rect.width;
      let y = rect.top + ((1 - proj.y) / 2) * rect.height;
      const far = facing <= limb() + 0.04;
      if (far) {
        // Behind the planet: out along the same direction from the centre, just past the rim.
        let dx = x - cx;
        let dy = y - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) [dx, dy] = [0, -1];
        else [dx, dy] = [dx / len, dy / len];
        x = cx + dx * (rim + 14);
        y = cy + dy * (rim + 14) + (dy > 0 ? 22 : 0); // labels hang above their point: keep the lower ones clear
      }
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      n.el.classList.toggle('far', far);
      n.el.classList.toggle('off', Boolean(anim) && !n.el.classList.contains('home'));
      if (n === hovered) {
        const left = Math.min(x + 26, rect.right - 230);
        const top = THREE.MathUtils.clamp(y - 20, rect.top + 8, rect.bottom - 190);
        cardEl.style.transform = `translate(${left}px, ${top}px)`;
      }
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  // ---------- attack phase playback ----------
  // Every strike flies at once (staggered launches) on an arc between the two cities; the defender's networks
  // fire up at it; it bursts in the air or lands. Resolved beforehand (war.js): this only shows the results.
  const warRoot = new THREE.Group();
  scene.add(warRoot);
  const headGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const burstGeo = new THREE.SphereGeometry(1, 12, 8);
  let war = null; // { items, t, speed, done }
  const missileModel = buildMissileTemplate();
  const glowTex = missileGlow();
  const UPV = new THREE.Vector3(0, 1, 0);
  const TAN = new THREE.Vector3();

  // Aimed but not yet fired: a dashed arc per strike from its city to the target, redrawn as the globe turns.
  let queued = []; // { from, to, line }
  const queuedMat = new THREE.LineDashedMaterial({ color: 0xffd08a, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85, toneMapped: false });

  /** strikes: [{ from, to }] (one arc per pair and count). Pass [] to clear. */
  function setQueued(strikes) {
    for (const q of queued) {
      warRoot.remove(q.line);
      q.line.geometry.dispose();
    }
    queued = strikes.map((s, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
      const line = new THREE.Line(geo, queuedMat);
      line.frustumCulled = false;
      warRoot.add(line);
      return { from: s.from, to: s.to, line, lift: 1 + 0.08 * i };
    });
  }

  function updateQueued() {
    for (const q of queued) {
      const a = nodes.find((n) => n.id === q.from);
      const b = nodes.find((n) => n.id === q.to);
      q.line.visible = Boolean(a && b) && !war;
      if (!q.line.visible) continue;
      const d = bend.wrapDelta(b.p.x, b.p.y, a.p, new THREE.Vector2());
      const it = { from: a.p, d, H: Math.min(RADIUS * 0.45, 0.8 + 0.28 * d.length()) * q.lift };
      const pa = q.line.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        arcPoint(it, i / (pa.count - 1), P);
        pa.setXYZ(i, P.x, P.y, P.z);
      }
      pa.needsUpdate = true;
      q.line.computeLineDistances();
    }
  }

  /** A small missile (the board's model) with its exhaust glow, for the globe flights. */
  function globeMissile() {
    const m = missileModel.clone();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb04a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    glow.position.y = -0.45;
    glow.scale.setScalar(0.5);
    m.add(glow);
    m.userData.glow = glow;
    return m;
  }
  const P = new THREE.Vector3();
  const Q = new THREE.Vector2();

  // ---------- the season's oil, gushing out of Hive City while the payout runs (pulseOil) ----------
  // Particles live in plane coordinates (x, y, height) so they ride the planet's bend as it turns.
  const oilRoot = new THREE.Group();
  scene.add(oilRoot);
  const oilBits = [];
  const OIL_COLORS = [0xffb347, 0xe8902a, 0xffd27a, 0x8a4a14];
  function pulseOil(amount = 1) {
    if (!active) return; // nothing piles up while the planet is off screen
    const home = nodes.find((n) => n.id === 'player');
    if (!home) return;
    const count = Math.min(40, 6 + Math.round(amount * 3));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.25 + Math.random() * 0.7;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: OIL_COLORS[i % OIL_COLORS.length], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
      );
      oilRoot.add(sprite);
      oilBits.push({ sprite, px: home.p.x, py: home.p.y, h: 0.15, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 2.6 + Math.random() * 2.4, age: -Math.random() * 0.35, life: 1.4 + Math.random() * 0.9, size: 0.35 + Math.random() * 0.4 });
    }
    // A gold ring pulsing out from the city.
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc860, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    oilRoot.add(ring);
    oilBits.push({ sprite: ring, px: home.p.x, py: home.p.y, h: 0.2, vx: 0, vy: 0, vh: 0, age: 0, life: 0.9, size: 1.1, ring: Math.min(3, 1.4 + amount * 0.2) });
  }
  function updateOil(dt) {
    for (let i = oilBits.length - 1; i >= 0; i--) {
      const b = oilBits[i];
      b.age += dt;
      if (b.age < 0) {
        b.sprite.visible = false;
        continue;
      }
      const k = b.age / b.life;
      if (k >= 1) {
        oilRoot.remove(b.sprite);
        b.sprite.material.dispose();
        oilBits.splice(i, 1);
        continue;
      }
      b.sprite.visible = true;
      b.px += b.vx * dt;
      b.py += b.vy * dt;
      b.h += b.vh * dt;
      b.vh -= 3.2 * dt; // a fountain: up, then falling back
      b.h = Math.max(0.05, b.h);
      bend.project(b.px, b.py, b.h, b.sprite.position);
      const s = b.ring ? b.size * (1 + k * b.ring) : b.size * (1 - 0.5 * k);
      b.sprite.scale.setScalar(s);
      b.sprite.material.opacity = (b.ring ? 0.8 : 1) * (1 - k) * Math.min(1, b.age * 10);
    }
  }
  function clearOil() {
    for (const b of oilBits) {
      oilRoot.remove(b.sprite);
      b.sprite.material.dispose();
    }
    oilBits.length = 0;
  }

  /** Plane point + height along a strike's arc at u (0 launch, 1 impact). */
  function arcPoint(it, u, out) {
    const k = Math.sin(Math.PI * Math.min(1, u));
    const h = it.H * k + 0.15;
    const side = (it.bow ?? 0) * k;
    const start = 1 - Math.min(1, u); // the launch offset fades out by the target
    const jx = (it.jit?.x ?? 0) * start;
    const jy = (it.jit?.y ?? 0) * start;
    return bend.project(it.from.x + it.d.x * u + (it.perp?.x ?? 0) * side + jx, it.from.y + it.d.y * u + (it.perp?.y ?? 0) * side + jy, h, out);
  }

  function makeTrail(color) {
    const n = 28;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false }));
    line.frustumCulled = false;
    warRoot.add(line);
    return line;
  }

  function setTrail(line, fn, u0, u1) {
    const a = line.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      fn(u0 + ((u1 - u0) * i) / (a.count - 1), P);
      a.setXYZ(i, P.x, P.y, P.z);
    }
    a.needsUpdate = true;
  }

  function burst(color, size, life) {
    const m = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, depthWrite: false }));
    m.userData = { size, life, age: 0 };
    m.scale.setScalar(0.01);
    warRoot.add(m);
    return m;
  }

  /**
   * Play an attack phase on the globe. strikes: war.js resolve() output. Resolves when everything has landed.
   * speed: 1 normal; skip() jumps ahead.
   */
  function playAttack(strikes, list = null) {
    // Positions come from the layout, not the built nodes: the phase plays (and its countdowns run) from any view,
    // even when the planet has never been opened or was left.
    if (list) rivals = list;
    const spots = layout();
    const nodeOf = (id) => spots.find((n) => n.id === id);
    const items = [];
    strikes.forEach((s, i) => {
      const a = nodeOf(s.from);
      const b = nodeOf(s.to);
      if (!a || !b) return;
      const d = bend.wrapDelta(b.p.x, b.p.y, a.p, new THREE.Vector2());
      const dist = d.length();
      const color = a.color.clone().lerp(new THREE.Color(0xffffff), 0.35);
      const head = globeMissile();
      warRoot.add(head);
      if (s.boosted) head.userData.glow.material.color.set(0x9ad8ff);
      items.push({
        s,
        from: a.p.clone(),
        to: b,
        d,
        // Each flight its own arc: a little higher or lower, bowed off to one side (zero at both ends), leaving from
        // a slightly different spot, so a volley fans out instead of tracing one line.
        H: Math.min(RADIUS * 0.45, 0.8 + 0.28 * dist) * (0.8 + Math.random() * 0.4),
        perp: new THREE.Vector2(-d.y, d.x).divideScalar(dist || 1),
        bow: (Math.random() * 2 - 1) * 0.2 * dist,
        jit: new THREE.Vector2((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12),
        // war.js fixes when each leaves and lands (the city views replay the same clock).
        start: s.launch ?? 0.35 * i,
        dur: s.land != null ? Math.max(1, s.land - (s.launch ?? 0.35 * i)) : 4 + 0.12 * dist,
        head,
        trail: makeTrail(color),
        shots: s.shots.map((shot, k) => ({ ...shot, at: s.killAt != null && s.land != null ? Math.min(0.995, 1 - (s.land - s.killAt) / Math.max(1, s.land - (s.launch ?? 0.35 * i))) : 0.7 + 0.08 * k, line: null, done: false })),
        stopAt: s.shots.findIndex((x) => x.success),
        ended: false,
      });
      // (A decoy flies the War Map as one missile: it splits only when watched in a city view.)
      if (false && s.decoy && s.fakes?.length && s.land != null) { // decoys only split in a city view
        const it = items[items.length - 1];
        const at = (t) => (t - it.start) / it.dur;
        it.uSplit = Math.min(0.99, Math.max(0, at(s.splitAt)));
        it.forks = s.fakes
          .filter((f) => !f.void)
          .map((f) => {
            const fh = globeMissile();
            fh.userData.glow.material.color.set(0xd8e0ff);
            fh.visible = false;
            warRoot.add(fh);
            return {
              arc: { from: it.from, d: it.d.clone().addScaledVector(it.perp, (Math.random() * 2 - 1) * 0.18), H: it.H, perp: it.perp, bow: it.bow + (Math.random() * 2 - 1) * 0.08 * dist, jit: it.jit },
              head: fh,
              trail: makeTrail(0xc8d0e8),
              killU: f.killed && f.killAt != null ? Math.min(1, at(f.killAt)) : null,
              landU: Math.min(1, at(f.t0 + f.flight)),
              done: false,
            };
          });
        for (const f of it.forks) f.trail.visible = false;
      }
    });
    setHovered(null);
    velocity.set(0, 0);
    dive = null;
    goalDistance = D_DEFAULT;
    document.body.classList.add('war-phase');
    return new Promise((done) => {
      if (!items.length) {
        document.body.classList.remove('war-phase');
        done();
        return;
      }
      war = { items, t: 0, speed: 1, done, after: 0 };
    });
  }

  function skipAttack() {
    if (war) war.speed = 8;
  }

  const FP = new THREE.Vector3();
  /** A decoy past its split: the parent's head is gone, its fakes peel off toward the city and burst or fizzle. */
  function updateForks(it, uu, fn) {
    if (!it.split) {
      it.split = true;
      burst(0xd8e0ff, 0.18, 0.45).position.copy(it.head.position);
    }
    it.head.visible = false;
    setTrail(it.trail, fn, Math.max(0, it.uSplit - 0.35), it.uSplit);
    const span = Math.max(1e-3, 1 - it.uSplit);
    for (const f of it.forks) {
      if (f.done) continue;
      const at = (v, out) => {
        const w = Math.min(1, Math.max(0, (v - it.uSplit) / span));
        arcPoint(it, v, FP);
        return arcPoint(f.arc, v, out).lerp(FP, 1 - Math.sqrt(w));
      };
      const end = f.killU ?? f.landU;
      const v = Math.min(uu, end);
      const prev = f.head.position.clone();
      at(v, f.head.position);
      TAN.subVectors(f.head.position, prev);
      if (f.head.visible && TAN.lengthSq() > 1e-12) f.head.quaternion.setFromUnitVectors(UPV, TAN.normalize());
      f.head.visible = true;
      f.trail.visible = true;
      f.head.scale.setScalar(0.24 * THREE.MathUtils.lerp(1, 0.3, v * v));
      setTrail(f.trail, at, Math.max(it.uSplit, v - 0.3), v);
      if (uu >= end) {
        f.done = true;
        f.head.visible = false;
        f.trail.userData = { life: 0.6, age: 0, size: 1 };
        if (f.killU != null) burst(0x9affe0, 0.22, 0.6).position.copy(f.head.position);
        else burst(0xb0b0a0, 0.1, 0.5).position.copy(bend.project(it.to.p.x, it.to.p.y, 0.15, new THREE.Vector3()));
      }
    }
  }

  function updateWar(dt) {
    // Bursts grow and fade on their own, even after the phase.
    for (const m of [...warRoot.children]) {
      const u = m.userData;
      if (u.life === undefined) continue;
      u.age += dt;
      const k = u.age / u.life;
      if (!m.isLine) m.scale.setScalar(u.size * (0.3 + 0.7 * Math.min(1, k * 2))); // lines sit in world space: fade only
      m.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        warRoot.remove(m);
        m.material.dispose();
      }
    }
    if (!war || war.paused) return; // held while a briefing is on screen
    war.t += dt * war.speed;
    let live = 0;
    for (const it of war.items) {
      const u = (war.t - it.start) / it.dur;
      // Close to landing: a city view starts its own missile now so it hits exactly as the countdown reaches 0.
      if (!it.approached && (it.start + it.dur - war.t) / war.speed <= approachLead()) {
        it.approached = true;
        onApproach?.(it.s);
      }
      // Its countdown ran out: the strike lands on the city now (the city view plays it, shown or not).
      if (!it.arrived && u >= 1) {
        it.arrived = true;
        onArrive?.(it.s);
      }
      if (!it.arrived) live++; // the phase lasts until every countdown has run out, even one shot down on the way
      const fn = (v, out) => arcPoint(it, v, out);
      if (it.ended) {
        // The trail drains away from the launch end.
        it.fade = Math.min(1, (it.fade ?? 0) + dt * war.speed * 1.5);
        setTrail(it.trail, fn, Math.min(it.endU, it.fade * it.endU), it.endU);
        it.trail.material.opacity = 0.85 * (1 - it.fade);
        if (it.fade < 1) live++;
        continue;
      }
      live++;
      if (u <= 0) {
        it.head.visible = false;
        it.trail.visible = false;
        continue;
      }
      it.head.visible = it.trail.visible = true;
      const uu = Math.min(1, u);
      arcPoint(it, uu, it.head.position);
      // Nose along the arc; it shrinks as it nears the target city (it's far below, seen from orbit).
      arcPoint(it, Math.min(1, uu + 0.01), TAN);
      TAN.sub(it.head.position);
      if (TAN.lengthSq() > 1e-10) it.head.quaternion.setFromUnitVectors(UPV, TAN.normalize());
      it.head.scale.setScalar(0.34 * THREE.MathUtils.lerp(1, 0.3, uu * uu));
      it.head.userData.glow.scale.setScalar(0.45 + Math.random() * 0.2);
      setTrail(it.trail, fn, Math.max(0, uu - 0.35), uu);
      if (it.forks?.length && uu >= it.uSplit) updateForks(it, uu, fn);
      // Interceptors climb from the target city toward the missile.
      for (const [k, shot] of it.shots.entries()) {
        if (it.stopAt >= 0 && k > it.stopAt) break;
        if (uu < shot.at - 0.12 || shot.done) continue;
        if (!shot.line) shot.line = makeTrail(shot.success ? 0x8affd0 : 0x6ad0b0);
        const v = THREE.MathUtils.clamp((uu - (shot.at - 0.12)) / 0.12, 0, 1);
        const meet = new THREE.Vector3();
        arcPoint(it, shot.at, meet);
        const base = bend.project(it.to.p.x + (shot.x - 0) * 0.04, it.to.p.y + (shot.z - 0) * 0.04, 0.1, new THREE.Vector3());
        const line = shot.line;
        const pa = line.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const f = (v * i) / (pa.count - 1);
          P.lerpVectors(base, meet, f);
          if (!shot.success) P.x += Math.sin(f * 9) * 0.04 * f; // a miss wobbles past
          pa.setXYZ(i, P.x, P.y, P.z);
        }
        pa.needsUpdate = true;
        if (v >= 1) {
          shot.done = true;
          line.userData = { life: 0.6, age: 0, size: 1 };
          if (shot.success) {
            burst(0x9affe0, 0.35, 0.7).position.copy(meet);
            it.ended = true;
            it.endU = shot.at;
            it.head.visible = false;
          } else burst(0x6ad0b0, 0.12, 0.4).position.copy(meet);
        }
      }
      if (it.ended) continue;
      if (u >= 1) {
        it.ended = true;
        it.endU = it.forks?.length ? it.uSplit : 1;
        it.head.visible = false;
        const s = it.s;
        if (s.hit) {
          const ground = bend.project(it.to.p.x, it.to.p.y, 0.15, new THREE.Vector3());
          burst(s.capital !== null ? 0xff3a1a : 0xffa040, s.kind === 'missile2' ? 0.7 : 0.45, 1.1).position.copy(ground);
          // Remembered by city id: the planet may be left and re-entered mid phase (its nodes are rebuilt).
          const seen = warShown.get(s.to) ?? {};
          if (s.eliminated) seen.dead = true;
          if (s.capital !== null) seen.hp = s.capital;
          warShown.set(s.to, seen);
          const node = nodes.find((n) => n.id === s.to);
          if (node) applyShown(node);
          renderLabels();
        }
      }
    }
    // A short beat after the last landing, then hand back.
    if (!live) war.after += dt;
    if (war.after > 0.6) {
      const done = war.done;
      for (const it of war.items) {
        warRoot.remove(it.head, it.trail);
        it.head.userData.glow.material.dispose();
        it.trail.geometry.dispose();
        for (const sh of it.shots) if (sh.line) warRoot.remove(sh.line);
        for (const f of it.forks ?? []) {
          warRoot.remove(f.head, f.trail);
          f.head.userData.glow.material.dispose();
          f.trail.geometry.dispose();
        }
      }
      war = null;
      warShown.clear();
      document.body.classList.remove('war-phase');
      done();
    }
  }

  /** Open centred on `fromId` (the city we came from), starting just above it and pulling back to the planet. */
  function enter(nextRivals, fromId = 'player') {
    rivals = nextRivals;
    buildNodes();
    active = true;
    visiting = false;
    drag = null;
    over = 0;
    dive = null;
    velocity.set(0, 0);
    hovered = null;
    hoverFromLabel = null;
    cardEl.classList.add('hidden');
    root.classList.remove('hidden');
    fit();
    // The city we left sits dead centre; the camera only pulls straight back (no sideways slide).
    const from = nodes.find((n) => n.id === fromId) ?? nodes[0];
    setScroll(from.p.x, from.p.y);
    distance = goalDistance = D_CLOSE;
    animate(from.p, D_DEFAULT, 1.3, easeOut);
  }

  function exit() {
    active = false;
    dive = null;
    anim = null;
    drag = null;
    visiting = false;
    setHovered(null);
    hoverFromLabel = null;
    root.classList.add('hidden');
    dom.style.cursor = '';
    clearOil();
    clearNodes();
  }

  return {
    /** Re-place the cities after a layout setting changed (Game Debug panel). */
    relayout() {
      if (active) buildNodes();
    },
    get active() {
      return active;
    },
    get busy() {
      return Boolean(anim) || visiting || Boolean(war);
    },
    /** The camera is flying (opening pull-back, or a dive into a city): the attack phase alone doesn't count. */
    get flying() {
      return Boolean(anim) || visiting || Boolean(dive);
    },
    /** The countdown and arc progress of every flight still in the air (for a city view joining mid flight). */
    /** The War Map clock (seconds into the attack phase), or null when no phase is playing. */
    warTime() {
      return war ? war.t : null;
    },
    inFlight() {
      if (!war) return [];
      return war.items.filter((it) => !it.arrived).map((it) => ({ s: it.s, eta: Math.max(0, (it.start + it.dur - war.t) / war.speed), approached: Boolean(it.approached) }));
    },
    playAttack,
    /** Keep the attack playback running while the globe isn't shown (the flights land on time). */
    tickWar(dt) {
      if (!active && war) updateWar(dt);
    },
    /** Flights still in the air: [{ to, from, eta (s until impact, playback speed included) }]. */
    arrivals() {
      if (!war) return [];
      return war.items.filter((it) => !it.arrived).map((it) => ({ to: it.s.to, from: it.s.from, eta: Math.max(0, (it.start + it.dur - war.t) / war.speed) }));
    },
    get attacking() {
      return Boolean(war);
    },
    setQueued,
    skipAttack,
    /** The payout pays `amount` oil: it gushes out of Hive City on the planet (only while the planet is shown). */
    pulseOil,
    /** Where a city sits on screen ([x, y] px), or null when the planet isn't shown or it's round the far side. */
    screenOf(id) {
      if (!active) return null;
      const n = nodes.find((m) => m.id === id);
      if (!n) return null;
      const v = bend.project(n.p.x, n.p.y, 0.3, new THREE.Vector3()).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
      const r = dom.getBoundingClientRect();
      return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
    },
    /** Freeze (or resume) the flights in the air, e.g. while a dialogue plays. */
    pauseAttack(on) {
      if (war) war.paused = on;
    },
    renderLabels: () => renderLabels(),
    scene,
    camera,
    enter,
    exit,
    visit,
    update,
    render,
  };
}
