import * as THREE from 'three';
import { PLOT, WORLD_HALF, key, plotOf, plotCenter } from './grid.js';

/** What a mystery site can turn out to be, with relative odds. Tune freely. */
export const MYSTERY_POOL = [
  ['capital', 3], // a free city joins you
  ['tarpit', 3],
  ['refinery', 2],
  ['pump', 2],
  ['ruins', 4], // Pre-war Ruins: build next to them to clear and refill your hand
  ['missile', 1], // Unexploded Missile: not a tile; it launches from the site at your nearest building
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

/**
 * Each mystery site is marked by a subtle god ray: an upright shaft of warm sunlight, made of soft streaks, coming down
 * from the sky through the fog-of-war clouds, with a soft pool where it lands on the fog veil. It sways gently, its
 * streaks drift, and it breathes (swells a little wider and brighter, then settles); it fades out gradually toward the
 * sky. It only adds light (drawn after the clouds), so it never clears the fog: what is below stays hidden.
 * Cheap at any number of sites: every shaft is one instance of a single InstancedMesh, every pool of another (two
 * draw calls in all), all animated on the GPU from one shared time uniform; each site's seed is its position.
 */
const BEAM = {
  height: 12, // world units, from the fog veil up into the sky (fading out well before the top)
  radiusBottom: 0.36,
  radiusTop: 1.2, // wider toward the sky, like sunlight breaking through
  segments: 16, // around the shaft
  lean: [0, 1, 0], // straight up
  rays: 7, // separate streaks of light around the shaft
  strength: 0.4, // shaft brightness (subtle)
  pool: 0.8, // radius of the pool of light on the veil
  poolStrength: 0.3,
  sway: 0.8, // how far the top of the shaft drifts side to side (world units)
  breathe: 1.5, // breathing pace (radians per second: about one breath every 4 s)
  breatheWidth: 0.16, // how much wider the shaft and its pool get at the top of a breath
  breatheLight: 0.32, // how much brighter
  colour: 0xfff0bc,
  max: 256, // most sites at once (the world has about a hundred)
};

const BEAM_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vH;
  varying float vSeed;
  varying float vBreath;
  varying vec2 vUv;
  void main() {
    #ifdef USE_INSTANCING
      mat4 site = modelMatrix * instanceMatrix;
    #else
      mat4 site = modelMatrix;
    #endif
    float seed = dot(site[3].xz, vec2(1.7, 3.1));
    // Breathing: a slow, soft swell (wider, a little brighter) and back, each site at its own phase.
    float breath = 0.5 - 0.5 * cos(uTime * ${BEAM.breathe.toFixed(3)} + seed);
    vec3 p = position;
    p.xz *= 1.0 + ${BEAM.breatheWidth.toFixed(3)} * breath;
    // Sway: the top drifts gently side to side (the base stays put).
    float up = clamp(position.y / ${BEAM.height.toFixed(1)}, 0.0, 1.0);
    p.x += sin(uTime * 0.45 + seed) * ${BEAM.sway.toFixed(2)} * up * up;
    p.z += cos(uTime * 0.37 + seed * 1.3) * ${(BEAM.sway * 0.6).toFixed(2)} * up * up;
    vBreath = breath;
    vec4 world = site * vec4(p, 1.0);
    vNormal = normalize(mat3(site) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vH = uv.y;
    vUv = uv;
    vSeed = seed;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const BEAM_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vH;
  varying float vSeed;
  varying float vBreath;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

// The shaft, god-ray style: separate soft streaks of light along its length (slowly shifting), brighter where it
// faces the camera, fading at its silhouette, at the veil and far up toward the sky.
const SHAFT_FRAG = /* glsl */ `
  ${BEAM_COMMON}
  void main() {
    float core = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0); // a narrow, soft glow
    // Fades from just above the clouds all the way up, so the top of the shaft melts away.
    float fade = smoothstep(0.0, 0.05, vH) * pow(1.0 - vH, 2.6);
    float around = vUv.x * ${BEAM.rays.toFixed(1)} * 6.2832 + vSeed + uTime * 0.35; // the streaks drift around
    float rays = 0.42 + 0.58 * pow(0.5 + 0.5 * sin(around + 1.7 * noise(vec2(vUv.x * 9.0, vSeed))), 1.6); // soft streaks
    float streaks = rays * (0.65 + 0.35 * noise(vec2(vUv.x * 14.0 + vSeed, vH * 5.0 + uTime * 1.3))); // motes drifting down
    float breath = 1.0 - ${BEAM.breatheLight.toFixed(3)} + ${BEAM.breatheLight.toFixed(3)} * vBreath;
    gl_FragColor = vec4(uColor, core * fade * streaks * breath * uStrength);
    #include <colorspace_fragment>
  }`;

// The pool where it lands: a soft round glow on the veil.
const POOL_FRAG = /* glsl */ `
  ${BEAM_COMMON}
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = pow(max(0.0, 1.0 - r), 2.0);
    float breath = 1.0 - ${BEAM.breatheLight.toFixed(3)} + ${BEAM.breatheLight.toFixed(3)} * vBreath;
    gl_FragColor = vec4(uColor, glow * breath * uStrength);
    #include <colorspace_fragment>
  }`;

function beamMaterial(fragmentShader, strength, side) {
  return new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(BEAM.colour) }, uStrength: { value: strength } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
}

/**
 * Mystery sites: shafts of light scattered over the map. Building next to one reveals it
 * as a tile (a free Capital, Pre-war Ruins, a Tar Pit or a special building), decided on reveal.
 */
export class Mysteries {
  sites = new Map(); // cell key -> { x, z }
  #dirty = false; // sites changed: rebuild the instances on the next update

  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shaftMat = beamMaterial(SHAFT_FRAG, BEAM.strength, THREE.FrontSide);
    this.poolMat = beamMaterial(POOL_FRAG, BEAM.poolStrength, THREE.DoubleSide);
    const shaftGeo = new THREE.CylinderGeometry(BEAM.radiusTop, BEAM.radiusBottom, BEAM.height, BEAM.segments, 1, true).translate(0, BEAM.height / 2, 0);
    const poolGeo = new THREE.PlaneGeometry(BEAM.pool * 2, BEAM.pool * 2).rotateX(-Math.PI / 2);
    // Drawn after the fog-of-war clouds (and only adding light), so they shine through them without clearing them.
    this.shafts = new THREE.InstancedMesh(shaftGeo, this.shaftMat, BEAM.max);
    this.pools = new THREE.InstancedMesh(poolGeo, this.poolMat, BEAM.max);
    this.shafts.renderOrder = 11;
    this.pools.renderOrder = 10;
    for (const m of [this.shafts, this.pools]) {
      m.count = 0;
      m.frustumCulled = false; // spread over the whole world; the GPU clips what's off screen
      this.group.add(m);
    }
    this.lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...BEAM.lean).normalize());
  }

  /**
   * Scatter fresh sites over the whole world (never in the starting plot): a random number per
   * distance band (SITE_BANDS), at most one per plot, and site plots never touch each other.
   */
  reset() {
    this.sites.clear();
    this.#dirty = true;
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

  /** Remove every site (the tutorial board starts empty). */
  clear() {
    this.sites.clear();
    this.#dirty = true;
  }

  /**
   * One hand-placed site with a fixed outcome (the tutorial). `extra` rides along on the reveal result,
   * e.g. { silo: { x, z } }: the revealed ruins launch a missile at that cell.
   */
  placeScripted(x, z, terrain, extra = {}) {
    this.#add(x, z);
    Object.assign(this.sites.get(key(x, z)), { forced: terrain, extra });
  }

  /** What a site turns into: its fixed outcome if it has one, otherwise a roll. */
  #outcome(s) {
    return { x: s.x, z: s.z, terrain: s.forced ?? pickReveal(), ...(s.extra ?? {}) };
  }

  #add(x, z) {
    this.sites.set(key(x, z), { x, z });
    this.#dirty = true;
  }

  has(x, z) {
    return this.sites.has(key(x, z));
  }

  /** Expansion mode: removes the sites inside plot (px, pz) and returns [{ x, z, terrain }] for each. */
  reveal(px, pz) {
    const out = [];
    for (const [k, s] of this.sites) {
      if (plotOf(s.x) !== px || plotOf(s.z) !== pz) continue;
      this.#dirty = true;
      this.sites.delete(k);
      out.push(this.#outcome(s));
    }
    return out;
  }

  /** Free placement: removes the sites touching any of `cells` on a side and returns [{ x, z, terrain }] for each. */
  revealAround(cells) {
    const out = [];
    for (const [k, s] of this.sites) {
      if (!cells.some(([x, z]) => Math.abs(x - s.x) + Math.abs(z - s.z) === 1)) continue;
      this.#dirty = true;
      this.sites.delete(k);
      out.push(this.#outcome(s));
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
    this.#dirty = true;
    this.sites.delete(k);
    return this.#outcome(s);
  }

  update(time) {
    this.shaftMat.uniforms.uTime.value = time;
    this.poolMat.uniforms.uTime.value = time;
    if (this.#dirty) this.#rebuild();
  }

  /** One shaft and one pool instance per site (only when sites are added or revealed). */
  #rebuild() {
    this.#dirty = false;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const flat = new THREE.Quaternion();
    let i = 0;
    for (const s of this.sites.values()) {
      if (i >= BEAM.max) break;
      pos.set(s.x, 0.03, s.z);
      this.shafts.setMatrixAt(i, m.compose(pos, this.lean, one));
      this.pools.setMatrixAt(i, m.compose(pos, flat, one));
      i++;
    }
    for (const mesh of [this.shafts, this.pools]) {
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
