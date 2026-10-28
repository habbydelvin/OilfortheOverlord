import * as THREE from 'three';
import { BILLOW_SHADE } from './fogOfWar.js';

/**
 * The Overlord's missile strike (a missed tribute). Missiles streak in from his side of the
 * world, from off screen, and dive onto their targets. Each impact: a flash, a shockwave
 * ring, a fireball, and a toxic mushroom cloud that rolls up over the tile. The crater swap
 * happens a moment after impact (onCover), once the cloud hides the tile.
 *
 * All the tuning lives in MISSILE (Game Debug panel → Missiles, saved to localStorage).
 */

export const MISSILE = {
  // strike
  count1: 1, // missiles on the 1st missed tribute
  count2: 3,
  count3: 5, // the final strike (one of them hits the Capital)
  bearing: 25, // where the Overlord's lands lie: 0 = top of the screen (−z), 90 = right (+x)
  startDistance: 34, // launch point: distance out from the target along the bearing
  startHeight: 26, // launch point: height
  spread: 4, // launch points scatter sideways by up to this much (they still share one direction)
  arc: 0.35, // how much the path bows upward before the dive (0 = straight line)
  flightTime: 1.3, // seconds from the screen edge to impact
  accel: 1.4, // >1: speeds up all the way down
  stagger: 0.5, // seconds between launches
  missileScale: 0.45,
  exhaustSize: 1, // engine glow + flame (× missile size)
  // trail
  trailRate: 55, // smoke puffs per second per missile
  trailLife: 2.65,
  trailSize: 0.4, // puff size when fully spread
  trailStartSize: 0.08, // puff size as it leaves the engine
  trailWidth: 1, // sideways drift of the trail puffs
  trailColor: '#d8d0c0',
  exhaustColor: '#ffb04a',
  // explosion
  cloudScale: 1,
  cloudHeight: 4.5, // mushroom head height (× scale)
  cloudLife: 4, // seconds until the cloud has faded
  cloudDensity: 1, // puff count multiplier
  coverDelay: 0.3, // seconds after impact before the crater swaps in (under the cloud)
  flashSize: 4.5,
  flashIntensity: 80, // point light at the impact
  shockRadius: 3.5,
  shake: 1.1,
  fireColor: '#ff8a2b',
  smokeColor: '#7d8c43', // toxic green
  smokeColor2: '#5d5a4a', // dirty grey
  capRadius: 1, // mushroom cap ring width (× cloud size)
  stemWidth: 1, // mushroom stem width
  surgeRadius: 1, // ground ring of dust
  fireballSize: 1,
  coverSize: 1, // low cloud over the tile (hides the crater swap)
  cloudPuffScale: 1.9, // billow size vs. the old sprite puffs (the billow's soft edge eats into it)
  cloudShading: 1, // fog billow look: lit tops / shaded undersides (fog = 1)
  cloudLump: 1, // lumpy rims (fog = 1)
  cloudGrain: 0.18, // grain (fog = 0.18)
  cloudShadeVar: 0.25, // two-tone variation between puffs
  // camera
  camRate: 2.6, // camera ease speed during the strike (normal play is 16)
  camLead: 1.2, // seconds for the camera to reach the Capital before the first launch
  camMinDistance: 16,
  camFit: 1, // zoom-out factor to fit every target around the Capital
  camLower: 0.08, // Capital this far below screen centre (share of screen height), room for the clouds
  holdAfter: 2, // seconds to watch the clouds after the last impact
  // preview (M)
  previewCount: 3,
  previewCapital: 'no',
  previewCraters: 'yes',
};

export const MISSILE_PARAMS = [
  { group: 'Missiles · strike' },
  { key: 'count1', label: '1st miss: missiles', min: 1, max: 12, step: 1 },
  { key: 'count2', label: '2nd miss: missiles', min: 1, max: 12, step: 1 },
  { key: 'count3', label: '3rd miss: missiles', min: 1, max: 12, step: 1, hint: 'one always hits the Capital' },
  { key: 'bearing', label: 'Overlord direction (°)', min: 0, max: 359, step: 1, hint: '0 = top of the screen, 90 = right (camera unrotated)' },
  { key: 'startDistance', label: 'Launch distance', min: 8, max: 90, step: 1 },
  { key: 'startHeight', label: 'Launch height', min: 4, max: 70, step: 1 },
  { key: 'spread', label: 'Launch spread', min: 0, max: 15, step: 0.5 },
  { key: 'arc', label: 'Path arc', min: 0, max: 1.5, step: 0.05 },
  { key: 'flightTime', label: 'Flight time (s)', min: 0.3, max: 5, step: 0.05 },
  { key: 'accel', label: 'Acceleration', min: 0.5, max: 3, step: 0.05, hint: '1 = constant speed, higher = faster at the end' },
  { key: 'stagger', label: 'Launch interval (s)', min: 0, max: 2, step: 0.05 },
  { key: 'missileScale', label: 'Missile size', min: 0.1, max: 4, step: 0.05 },
  { key: 'exhaustSize', label: 'Exhaust glow size', min: 0, max: 4, step: 0.05 },

  { group: 'Missiles · trail' },
  { key: 'trailRate', label: 'Trail puffs / s', min: 0, max: 150, step: 1 },
  { key: 'trailLife', label: 'Trail life (s)', min: 0.1, max: 4, step: 0.05 },
  { key: 'trailSize', label: 'Trail puff size (end)', min: 0.02, max: 2, step: 0.01 },
  { key: 'trailStartSize', label: 'Trail puff size (start)', min: 0.01, max: 1, step: 0.01 },
  { key: 'trailWidth', label: 'Trail spread', min: 0, max: 4, step: 0.05 },
  { key: 'trailColor', label: 'Trail colour', type: 'color' },
  { key: 'exhaustColor', label: 'Exhaust colour', type: 'color' },

  { group: 'Missiles · explosion' },
  { key: 'cloudScale', label: 'Cloud size', min: 0.3, max: 3, step: 0.05 },
  { key: 'cloudHeight', label: 'Mushroom height', min: 0.5, max: 8, step: 0.1 },
  { key: 'cloudLife', label: 'Cloud life (s)', min: 0.8, max: 10, step: 0.1 },
  { key: 'cloudDensity', label: 'Cloud density', min: 0.2, max: 3, step: 0.05, hint: 'puff count multiplier (cost)' },
  { key: 'coverDelay', label: 'Crater swap delay (s)', min: 0, max: 2, step: 0.02, hint: 'after impact, once the cloud hides the tile' },
  { key: 'flashSize', label: 'Flash size', min: 0, max: 12, step: 0.1 },
  { key: 'flashIntensity', label: 'Flash light', min: 0, max: 300, step: 1 },
  { key: 'shockRadius', label: 'Shockwave radius', min: 0, max: 10, step: 0.1 },
  { key: 'shake', label: 'Camera shake', min: 0, max: 1.2, step: 0.05 },
  { key: 'fireColor', label: 'Fire colour', type: 'color' },
  { key: 'smokeColor', label: 'Smoke colour', type: 'color' },
  { key: 'smokeColor2', label: 'Smoke colour 2', type: 'color' },
  { key: 'capRadius', label: 'Cap width', min: 0.2, max: 3, step: 0.05 },
  { key: 'stemWidth', label: 'Stem width', min: 0.2, max: 4, step: 0.05 },
  { key: 'surgeRadius', label: 'Ground surge radius', min: 0, max: 3, step: 0.05 },
  { key: 'fireballSize', label: 'Fireball size', min: 0, max: 3, step: 0.05 },
  { key: 'coverSize', label: 'Tile cover size', min: 0.3, max: 3, step: 0.05, hint: 'too small and the crater swap shows' },
  { key: 'cloudPuffScale', label: 'Cloud puff size', min: 0.5, max: 4, step: 0.05 },
  { key: 'cloudShading', label: 'Cloud shading', min: 0, max: 2, step: 0.05, hint: 'fog billow lighting (fog = 1)' },
  { key: 'cloudLump', label: 'Cloud lumpiness', min: 0, max: 2.5, step: 0.05, hint: 'fog = 1' },
  { key: 'cloudGrain', label: 'Cloud grain', min: 0, max: 0.6, step: 0.01, hint: 'fog = 0.18' },
  { key: 'cloudShadeVar', label: 'Cloud two-tone', min: 0, max: 0.6, step: 0.01 },

  { group: 'Missiles · camera' },
  { key: 'camRate', label: 'Camera ease speed', min: 0.3, max: 16, step: 0.1 },
  { key: 'camLead', label: 'Camera lead time (s)', min: 0, max: 4, step: 0.05 },
  { key: 'camMinDistance', label: 'Min zoom distance', min: 6, max: 48, step: 0.5 },
  { key: 'camFit', label: 'Fit targets factor', min: 0.3, max: 3, step: 0.05 },
  { key: 'camLower', label: 'Capital below centre', min: -0.3, max: 0.4, step: 0.01, hint: 'share of the screen height' },
  { key: 'holdAfter', label: 'Hold after last hit (s)', min: 0, max: 6, step: 0.1 },

  { group: 'Missiles · preview (M)' },
  { key: 'previewCount', label: 'Missiles', min: 1, max: 12, step: 1 },
  { key: 'previewCapital', label: 'Include the Capital', type: 'select', options: ['no', 'yes'] },
  { key: 'previewCraters', label: 'Leave craters', type: 'select', options: ['yes', 'no'] },
];

export const MISSILE_DEFAULTS = Object.fromEntries(MISSILE_PARAMS.filter((p) => p.key).map((p) => [p.key, MISSILE[p.key]]));
const STORAGE_KEY = 'oto.missileConfig';

export function loadMissileConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  for (const k of Object.keys(MISSILE_DEFAULTS)) if (typeof saved[k] === typeof MISSILE_DEFAULTS[k]) MISSILE[k] = saved[k];
  return MISSILE;
}

export function saveMissileConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.keys(MISSILE_DEFAULTS).map((k) => [k, cfg[k]]))));
}

export function clearMissileConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------- textures ----------
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

/** Lumpy smoke puff (a few overlapping soft blobs). */
function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const blobs = [
    [0.5, 0.5, 0.42],
    [0.36, 0.42, 0.26],
    [0.64, 0.4, 0.25],
    [0.42, 0.64, 0.26],
    [0.63, 0.62, 0.23],
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round glow for fire, flashes and the exhaust. */
function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- pooled sprites ----------
/**
 * A pool of sprites that grow, change colour and fade over their life. A puff either drifts
 * on its own velocity, or follows an `anchor` (its blast places it each frame: the mushroom).
 */
class Puffs {
  #free = [];
  #live = [];
  count = 0;

  constructor(parent, map, { additive = false, max = 800 } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.map = map;
    this.additive = additive;
    this.max = max;
  }

  get live() {
    return this.#live.length;
  }

  #take() {
    if (this.#free.length) return this.#free.pop();
    if (this.count >= this.max) return null;
    this.count++;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.map,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        fog: false,
        blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    sprite.visible = false;
    sprite.renderOrder = 10; // after the fog-of-war clouds, so the strike shows over them
    this.group.add(sprite);
    return { sprite, vel: new THREE.Vector3(), c0: new THREE.Color(), c1: new THREE.Color() };
  }

  spawn(o) {
    const p = this.#take();
    if (!p) return null;
    p.sprite.position.copy(o.pos ?? ZERO);
    p.vel.copy(o.vel ?? ZERO);
    p.drag = o.drag ?? 0;
    p.lift = o.lift ?? 0;
    p.size0 = o.size0;
    p.size1 = o.size1 ?? o.size0;
    p.life = o.life;
    p.age = -(o.delay ?? 0);
    p.c0.set(o.color0);
    p.c1.set(o.color1 ?? o.color0);
    p.colorTime = o.colorTime ?? 1;
    p.peak = o.opacity ?? 1;
    p.fadeIn = o.fadeIn ?? 0.06;
    p.fadeStart = o.fadeStart ?? 0;
    p.fadePow = o.fadePow ?? 1.4;
    p.spin = o.spin ?? rand(-0.6, 0.6);
    p.anchor = o.anchor ?? null;
    const m = p.sprite.material;
    m.rotation = Math.random() * Math.PI * 2;
    m.opacity = 0;
    p.sprite.visible = false;
    this.#live.push(p);
    return p;
  }

  update(dt) {
    for (let i = this.#live.length - 1; i >= 0; i--) {
      const p = this.#live[i];
      p.age += dt;
      if (p.age < 0) continue;
      const t = p.age / p.life;
      if (t >= 1) {
        this.#recycle(i);
        continue;
      }
      p.sprite.visible = true;
      if (p.anchor) p.anchor.blast.place(p);
      else {
        if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.vel.y += p.lift * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
      }
      const g = 1 - (1 - t) * (1 - t);
      p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * g);
      const m = p.sprite.material;
      m.color.copy(p.c0).lerp(p.c1, smooth(Math.min(1, t / p.colorTime)));
      m.rotation += p.spin * dt;
      const fin = Math.min(1, p.age / p.fadeIn);
      const fout = t < p.fadeStart ? 1 : Math.pow(1 - (t - p.fadeStart) / (1 - p.fadeStart), p.fadePow);
      m.opacity = p.peak * fin * fout;
    }
  }

  #recycle(i) {
    const p = this.#live[i];
    p.sprite.visible = false;
    p.anchor = null;
    this.#live.splice(i, 1);
    this.#free.push(p);
  }

  clear() {
    for (let i = this.#live.length - 1; i >= 0; i--) this.#recycle(i);
  }
}

// ---------- mushroom cloud puffs (the fog's billow look) ----------
const cloudVertex = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, seed, rotation
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha, vSeed, vUp, vHeight;
varying vec3 vColor;
varying vec4 vRim;
void main() {
  vUv = uv;
  vAlpha = iData.y;
  vSeed = iData.z;
  vHeight = iPos.y;
  vColor = iColor;
  vRim = vec4(cos(vSeed * 17.0), sin(vSeed * 17.0), cos(vSeed * 11.0), sin(vSeed * 11.0));
  if (vAlpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.w), s = sin(iData.w);
  vec2 offset = mat2(c, s, -s, c) * position.xy;
  vUp = offset.y * 2.0;
  mv.xy += offset * iData.x; // camera-facing billboard
  gl_Position = projectionMatrix * mv;
}`;

const cloudFragment = /* glsl */ `
${BILLOW_SHADE}
uniform float uShading, uLump, uGrain, uShadeVar;
varying vec2 vUv;
varying float vAlpha, vSeed, vUp, vHeight;
varying vec3 vColor;
varying vec4 vRim;
void main() {
  vec4 b = billowShade(vUv, vColor * (1.0 - uShadeVar), vColor, vSeed, vUp, vHeight, vRim, uShading, uLump, uGrain);
  float alpha = b.a * vAlpha;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(b.rgb, alpha);
  #include <colorspace_fragment>
}`;

/**
 * Same API as Puffs, drawn as one instanced mesh with the fog-of-war billow shader. Puffs are
 * sorted back to front each frame so the overlapping billows blend correctly.
 */
class CloudPuffs {
  #free = [];
  #live = [];

  constructor(parent, camera, cfg, max = 1200) {
    this.camera = camera;
    this.cfg = cfg;
    this.max = max;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iData', this.aData);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    this.uniforms = { uShading: { value: 1 }, uLump: { value: 1 }, uGrain: { value: 0.18 }, uShadeVar: { value: 0.25 } };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: cloudVertex, fragmentShader: cloudFragment, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10; // over the fog-of-war clouds
    parent.add(this.mesh);
    for (let i = 0; i < max; i++) this.#free.push({ sprite: { position: new THREE.Vector3() }, vel: new THREE.Vector3(), c0: new THREE.Color(), c1: new THREE.Color(), color: new THREE.Color() });
  }

  spawn(o) {
    const p = this.#free.pop();
    if (!p) return null;
    p.sprite.position.copy(o.pos ?? ZERO);
    p.vel.copy(o.vel ?? ZERO);
    p.size0 = o.size0;
    p.size1 = o.size1 ?? o.size0;
    p.life = o.life;
    p.age = -(o.delay ?? 0);
    p.c0.set(o.color0);
    p.c1.set(o.color1 ?? o.color0);
    p.colorTime = o.colorTime ?? 1;
    p.peak = o.opacity ?? 1;
    p.fadeIn = o.fadeIn ?? 0.06;
    p.fadeStart = o.fadeStart ?? 0;
    p.fadePow = o.fadePow ?? 1.4;
    p.spin = o.spin ?? rand(-0.6, 0.6);
    p.rot = Math.random() * Math.PI * 2;
    p.seed = Math.random();
    p.anchor = o.anchor ?? null;
    p.alpha = 0;
    p.size = p.size0;
    this.#live.push(p);
    return p;
  }

  update(dt) {
    const c = this.cfg;
    this.uniforms.uShading.value = c.cloudShading;
    this.uniforms.uLump.value = c.cloudLump;
    this.uniforms.uGrain.value = c.cloudGrain;
    this.uniforms.uShadeVar.value = c.cloudShadeVar;
    for (let i = this.#live.length - 1; i >= 0; i--) {
      const p = this.#live[i];
      p.age += dt;
      p.alpha = 0;
      if (p.age < 0) continue;
      const t = p.age / p.life;
      if (t >= 1) {
        p.anchor = null;
        this.#live.splice(i, 1);
        this.#free.push(p);
        continue;
      }
      if (p.anchor) p.anchor.blast.place(p);
      else p.sprite.position.addScaledVector(p.vel, dt);
      const g = 1 - (1 - t) * (1 - t);
      p.size = p.size0 + (p.size1 - p.size0) * g;
      p.color.copy(p.c0).lerp(p.c1, smooth(Math.min(1, t / p.colorTime)));
      p.rot += p.spin * dt;
      const fin = Math.min(1, p.age / p.fadeIn);
      const fout = t < p.fadeStart ? 1 : Math.pow(1 - (t - p.fadeStart) / (1 - p.fadeStart), p.fadePow);
      p.alpha = p.peak * fin * fout;
    }
    // Back to front.
    const cam = this.camera.position;
    for (const p of this.#live) p.d = p.sprite.position.distanceToSquared(cam);
    this.#live.sort((a, b) => b.d - a.d);
    const P = this.aPos.array;
    const D = this.aData.array;
    const C = this.aColor.array;
    let n = 0;
    for (const p of this.#live) {
      if (p.alpha <= 0) continue;
      const q = p.sprite.position;
      P[n * 3] = q.x;
      P[n * 3 + 1] = q.y;
      P[n * 3 + 2] = q.z;
      D[n * 4] = p.size * this.cfg.cloudPuffScale;
      D[n * 4 + 1] = p.alpha;
      D[n * 4 + 2] = p.seed;
      D[n * 4 + 3] = p.rot;
      C[n * 3] = p.color.r;
      C[n * 3 + 1] = p.color.g;
      C[n * 3 + 2] = p.color.b;
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) {
      for (const a of [this.aPos, this.aData, this.aColor]) a.needsUpdate = true;
    }
  }

  clear() {
    for (const p of this.#live) {
      p.anchor = null;
      this.#free.push(p);
    }
    this.#live.length = 0;
    this.mesh.geometry.instanceCount = 0;
  }
}

// ---------- the mushroom cloud ----------
/** One detonation. Its anchored puffs are placed from its age each frame. */
class Blast {
  constructor(x, z, cfg) {
    this.x = x;
    this.z = z;
    this.age = 0;
    this.S = cfg.cloudScale;
    this.H = cfg.cloudHeight * this.S;
    this.R = 1.05 * this.S * cfg.capRadius; // cap ring radius
    this.B = 1.7 * this.S * cfg.surgeRadius; // base surge radius
    this.life = cfg.cloudLife + 0.6;
    this.cap = cfg.capRadius;
    this.stem = cfg.stemWidth;
  }

  head(a) {
    return this.H * (1 - Math.exp(-a * 1.6));
  }

  place(p) {
    const a = this.age;
    const A = p.anchor;
    const P = p.sprite.position;
    const { x, z, S } = this;
    switch (A.kind) {
      case 'cap': {
        // Rolling torus: the ring widens and each puff circles the tube (the vortex roll).
        const ring = this.R * (1 - Math.exp(-a * 1.4)) * A.rho;
        const tube = S * 0.42 * this.cap * (1 - Math.exp(-a * 2.2));
        const th = A.theta + a * 0.22;
        const ph = A.phi + a * A.roll;
        const rad = ring + tube * Math.cos(ph);
        P.set(x + Math.cos(th) * rad, 0.15 + this.head(a) + tube * Math.sin(ph) * 0.75 + A.dy, z + Math.sin(th) * rad);
        break;
      }
      case 'stem': {
        const h = this.head(a) * A.f * 0.95;
        const w = S * (0.14 + 0.24 * (1 - A.f)) * A.rho * this.stem;
        const th = A.theta + a * 0.5;
        P.set(x + Math.cos(th) * w, 0.1 + h, z + Math.sin(th) * w);
        break;
      }
      case 'base': {
        const r = this.B * (1 - Math.exp(-a * 2.4)) * A.rho;
        P.set(x + Math.cos(A.theta) * r, 0.12 + A.dy + a * 0.05, z + Math.sin(A.theta) * r);
        break;
      }
      case 'cover':
        P.set(x + A.ox, A.oy + a * 0.12, z + A.oz);
        break;
      case 'fire': {
        const k = 1 + a * 0.8;
        P.set(x + A.ox * k, 0.15 + this.head(a) * A.f + A.oy, z + A.oz * k);
        break;
      }
    }
  }
}

// ---------- the missile ----------
function buildMissileTemplate() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3d3b36, metalness: 0.6, roughness: 0.45, fog: false });
  const red = new THREE.MeshStandardMaterial({ color: 0x9e2a1c, metalness: 0.3, roughness: 0.5, fog: false });
  const brass = new THREE.MeshStandardMaterial({ color: 0xcdb46a, metalness: 0.7, roughness: 0.35, fog: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 12), metal);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 12), red);
  nose.position.y = 0.45;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.04, 12), brass);
  band.position.y = 0.26;
  g.add(body, nose, band);
  const finGeo = new THREE.BoxGeometry(0.012, 0.17, 0.12);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, red);
    const a = (i * Math.PI) / 2;
    fin.position.set(Math.cos(a) * 0.1, -0.27, Math.sin(a) * 0.1);
    fin.rotation.y = -a;
    g.add(fin);
  }
  return g;
}

/** Quadratic Bézier point and tangent. */
function bezier(out, p0, p1, p2, u) {
  const v = 1 - u;
  return out.set(0, 0, 0).addScaledVector(p0, v * v).addScaledVector(p1, 2 * v * u).addScaledVector(p2, u * u);
}
function bezierTangent(out, p0, p1, p2, u) {
  return out
    .set(0, 0, 0)
    .addScaledVector(p1.clone().sub(p0), 2 * (1 - u))
    .addScaledVector(p2.clone().sub(p1), 2 * u)
    .normalize();
}

export class MissileStrike {
  #missiles = [];
  #blasts = [];
  #rings = [];
  #timers = [];
  #jobs = [];
  #lightLevel = 0;

  constructor(scene, camera, cfg = MISSILE) {
    this.scene = scene;
    this.camera = camera;
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.group.name = 'missiles';
    scene.add(this.group);
    const puff = puffTexture();
    this.glow = glowTexture();
    this.smoke = new Puffs(this.group, puff, { max: 1400 });
    this.cloud = new CloudPuffs(this.group, camera, cfg);
    this.flames = new Puffs(this.group, this.glow, { additive: true, max: 500 });
    this.template = buildMissileTemplate();
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
    // One light, always in the scene (intensity 0 at rest) so adding it never recompiles shaders.
    this.light = new THREE.PointLight(0xffa040, 0, 12, 1.6);
    this.light.position.set(0, -50, 0);
    scene.add(this.light);
  }

  /** True while missiles are flying or clouds are still up. */
  get busy() {
    return this.#missiles.length > 0 || this.#blasts.length > 0 || this.#timers.length > 0;
  }

  /**
   * Launch one missile at each target ({ x, z }, in order, one every `stagger` s).
   * hooks.onImpact(target, i) fires at detonation, hooks.onCover(target, i) once the cloud
   * hides the tile. Resolves after the last onCover.
   */
  fire(targets, hooks = {}) {
    const c = this.cfg;
    return new Promise((resolve) => {
      if (!targets.length) return resolve();
      const job = { left: targets.length, resolve, hooks };
      this.#jobs.push(job);
      targets.forEach((t, i) => {
        this.#missiles.push({ target: t, i, job, age: -(i * c.stagger + (i ? rand(0, c.stagger * 0.3) : 0)), mesh: null, trailAcc: 0 });
      });
    });
  }

  /**
   * Launch point: out along the Overlord's bearing (distance/height/spread set the approach angle),
   * pulled in to just past the screen edge, so the whole flight is on screen and the missile
   * enters from the edge rather than spending most of its flight out of view.
   */
  #launchPath(m) {
    const c = this.cfg;
    // Launched from the ground (a silo in Pre-war Ruins): a tall lob from the launch cell.
    if (m.target.from) {
      const start = new THREE.Vector3(m.target.from.x, 0.3, m.target.from.z);
      const end = new THREE.Vector3(m.target.x, 0, m.target.z);
      const len = start.distanceTo(end);
      m.p0 = start;
      m.p1 = start.clone().lerp(end, 0.5).addScaledVector(UP, Math.max(5, len * 1.4));
      m.p2 = end;
      return;
    }
    const b = THREE.MathUtils.degToRad(c.bearing);
    const dir = new THREE.Vector3(Math.sin(b), 0, -Math.cos(b));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const end = new THREE.Vector3(m.target.x, 0, m.target.z);
    const offset = dir
      .clone()
      .multiplyScalar(c.startDistance)
      .addScaledVector(UP, c.startHeight)
      .addScaledVector(side, rand(-c.spread, c.spread));
    const ndc = new THREE.Vector3();
    const off = (k) => {
      ndc.copy(end).addScaledVector(offset, k).project(this.camera);
      return ndc.z > 1 || Math.abs(ndc.x) > 1.02 || Math.abs(ndc.y) > 1.02;
    };
    // Smallest share of the offset that is off screen (binary search), plus a margin for the trail.
    let k = 1;
    if (off(1)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (off(mid)) hi = mid;
        else lo = mid;
      }
      k = Math.min(1, hi * 1.12 + 0.02);
    } else {
      while (!off(k) && k < 8) k *= 1.3; // a very short launch distance: push it out instead
    }
    const start = end.clone().addScaledVector(offset, k);
    const len = start.distanceTo(end);
    const ctrl = start.clone().lerp(end, 0.5).addScaledVector(UP, c.arc * len * 0.25);
    m.p0 = start;
    m.p1 = ctrl;
    m.p2 = end;
  }

  #spawnMissile(m) {
    this.#launchPath(m);
    const mesh = this.template.clone();
    mesh.scale.setScalar(this.cfg.missileScale);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color: this.cfg.exhaustColor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    );
    glow.position.y = -0.45;
    glow.renderOrder = 10;
    glow.scale.setScalar(0.45 * this.cfg.exhaustSize);
    mesh.add(glow);
    m.glow = glow;
    mesh.position.copy(m.p0);
    this.group.add(mesh);
    m.mesh = mesh;
  }

  #tmp = new THREE.Vector3();
  #dir = new THREE.Vector3();
  #tail = new THREE.Vector3();

  update(dt) {
    const c = this.cfg;
    // Timers (crater swaps after impact).
    for (let i = this.#timers.length - 1; i >= 0; i--) {
      const t = this.#timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.#timers.splice(i, 1);
        t.fn();
      }
    }

    // Missiles in flight.
    for (let i = this.#missiles.length - 1; i >= 0; i--) {
      const m = this.#missiles[i];
      m.age += dt;
      if (m.age < 0) continue;
      if (!m.mesh) this.#spawnMissile(m);
      const u = Math.min(1, Math.pow(m.age / c.flightTime, c.accel));
      const prev = this.#tmp.copy(m.mesh.position);
      bezier(m.mesh.position, m.p0, m.p1, m.p2, u);
      bezierTangent(this.#dir, m.p0, m.p1, m.p2, Math.min(u, 0.999));
      m.mesh.quaternion.setFromUnitVectors(UP, this.#dir);
      m.glow.scale.setScalar((0.4 + Math.random() * 0.15) * c.exhaustSize);
      // Trail: puffs spaced along the segment covered this frame, so fast missiles leave no gaps.
      m.trailAcc += c.trailRate * dt;
      const n = Math.floor(m.trailAcc);
      m.trailAcc -= n;
      const s = c.missileScale;
      for (let k = 0; k < n; k++) {
        const f = (k + Math.random()) / n;
        this.#tail.copy(prev).lerp(m.mesh.position, f).addScaledVector(this.#dir, -0.45 * s);
        this.smoke.spawn({
          pos: this.#tail,
          vel: new THREE.Vector3(rand(-0.25, 0.25) * c.trailWidth, rand(0, 0.3) * c.trailWidth, rand(-0.25, 0.25) * c.trailWidth),
          drag: 1.5,
          lift: 0.15,
          size0: c.trailStartSize,
          size1: c.trailSize * rand(0.8, 1.25),
          life: c.trailLife * rand(0.75, 1.15),
          color0: '#fff1d0',
          color1: c.trailColor,
          colorTime: 0.12,
          opacity: rand(0.55, 0.8),
          fadeIn: 0.03,
          fadeStart: 0.1,
        });
      }
      this.flames.spawn({
        pos: this.#tail.copy(m.mesh.position).addScaledVector(this.#dir, -0.5 * s),
        size0: 0.32 * s * c.exhaustSize,
        size1: 0.1 * s * c.exhaustSize,
        life: 0.14,
        color0: c.exhaustColor,
        color1: '#ff4010',
        opacity: 0.9,
        fadeIn: 0.01,
      });
      if (u >= 1) {
        this.group.remove(m.mesh);
        m.glow.material.dispose();
        this.#missiles.splice(i, 1);
        this.#detonate(m);
      }
    }

    // Blasts, rings, the flash light.
    for (let i = this.#blasts.length - 1; i >= 0; i--) {
      const b = this.#blasts[i];
      b.age += dt;
      if (b.age > b.life) this.#blasts.splice(i, 1);
    }
    for (let i = this.#rings.length - 1; i >= 0; i--) {
      const r = this.#rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.group.remove(r.mesh);
        r.mesh.material.dispose();
        this.#rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(0.2 + (r.radius - 0.2) * (1 - Math.pow(1 - t, 3)));
      r.mesh.material.opacity = 0.65 * Math.pow(1 - t, 1.5);
    }
    this.#lightLevel *= Math.exp(-7 * dt);
    this.light.intensity = this.#lightLevel < 0.002 ? 0 : c.flashIntensity * this.#lightLevel;

    this.smoke.update(dt);
    this.cloud.update(dt);
    this.flames.update(dt);
  }

  #detonate(m) {
    const c = this.cfg;
    const { x, z } = m.target;
    const blast = new Blast(x, z, c);
    this.#blasts.push(blast);
    const S = blast.S;
    const dens = c.cloudDensity;
    const smokeOf = () => (Math.random() < 0.6 ? c.smokeColor : c.smokeColor2);
    const at = (kind, extra) => ({ blast, kind, ...extra });

    // Flash.
    this.flames.spawn({ pos: new THREE.Vector3(x, 0.6, z), size0: 0.6 * S, size1: c.flashSize * S, life: 0.45, color0: '#ffffff', color1: c.fireColor, colorTime: 0.5, fadeIn: 0.01, fadePow: 2 });
    this.light.position.set(x, 1.4, z);
    this.#lightLevel = 1;

    // Shockwave along the ground.
    if (c.shockRadius > 0) {
      const mesh = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffcf8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
      );
      mesh.position.set(x, 0.06, z);
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.#rings.push({ mesh, age: 0, life: 0.75, radius: c.shockRadius * S });
    }

    // Cover: dense, low puffs right over the tile (its sides too), so the crater swap is hidden.
    // At least the tile's own size, whatever the cloud scale.
    const C = Math.max(1, S);
    const toCam = new THREE.Vector3(this.camera.position.x - x, 0, this.camera.position.z - z).normalize();
    for (let i = 0; i < Math.max(6, Math.round(12 * dens)); i++) {
      const lean = rand(0.05, 0.4); // lean toward the camera, so the tile's near side is covered too
      this.cloud.spawn({
        anchor: at('cover', { ox: rand(-0.3, 0.3) + toCam.x * lean, oy: rand(0.05, 0.7) * C, oz: rand(-0.3, 0.3) + toCam.z * lean }),
        size0: 1.1 * C * c.coverSize,
        size1: 1.6 * C * c.coverSize,
        life: c.coverDelay + rand(1.3, 1.8),
        color0: c.fireColor,
        color1: smokeOf(),
        colorTime: 0.3,
        fadeIn: 0.03,
        fadeStart: 0.45,
      });
    }

    // Fireball glow rising into the head.
    for (let i = 0; i < Math.round(9 * dens); i++) {
      this.flames.spawn({
        anchor: at('fire', { f: rand(0.55, 1), ox: rand(-0.3, 0.3) * S, oy: rand(-0.2, 0.3) * S, oz: rand(-0.3, 0.3) * S }),
        size0: 0.5 * S * c.fireballSize,
        size1: 1.5 * S * c.fireballSize,
        life: rand(0.8, 1.3),
        color0: '#fff1c0',
        color1: c.fireColor,
        colorTime: 0.4,
        opacity: 0.85,
        fadeStart: 0.2,
      });
    }

    // Stem.
    const stem = Math.round(16 * dens);
    for (let i = 0; i < stem; i++) {
      const f = (i + Math.random()) / stem;
      this.cloud.spawn({
        anchor: at('stem', { f, rho: rand(0.2, 1), theta: rand(0, Math.PI * 2) }),
        delay: f * 0.15,
        size0: 0.3 * S,
        size1: (0.55 + 0.35 * (1 - f)) * S,
        life: c.cloudLife * rand(0.65, 0.85),
        color0: c.fireColor,
        color1: smokeOf(),
        colorTime: 0.15,
        opacity: rand(0.8, 1),
        fadeStart: 0.45,
      });
    }

    // Cap: a rolling ring of puffs.
    const cap = Math.round(28 * dens);
    for (let i = 0; i < cap; i++) {
      this.cloud.spawn({
        anchor: at('cap', {
          theta: (i / cap) * Math.PI * 2 + rand(-0.15, 0.15),
          phi: rand(0, Math.PI * 2),
          rho: rand(0.55, 1),
          roll: rand(0.8, 1.6),
          dy: rand(-0.15, 0.2) * S,
        }),
        delay: rand(0, 0.12),
        size0: 0.35 * S,
        size1: rand(0.9, 1.3) * S,
        life: c.cloudLife * rand(0.85, 1),
        color0: c.fireColor,
        color1: smokeOf(),
        colorTime: 0.22,
        opacity: rand(0.85, 1),
        fadeStart: 0.55,
      });
    }

    // Base surge: a ring of dust rolling out along the ground.
    const base = Math.round(18 * dens);
    for (let i = 0; i < base; i++) {
      this.cloud.spawn({
        anchor: at('base', { theta: (i / base) * Math.PI * 2 + rand(-0.2, 0.2), rho: rand(0.6, 1), dy: rand(0, 0.25) * S }),
        size0: 0.3 * S,
        size1: rand(0.8, 1.2) * S,
        life: c.cloudLife * rand(0.45, 0.65),
        color0: '#d9b98a',
        color1: c.smokeColor2,
        colorTime: 0.5,
        opacity: 0.85,
        fadeStart: 0.35,
      });
    }

    m.job.hooks.onImpact?.(m.target, m.i);
    this.#timers.push({
      t: c.coverDelay,
      fn: () => {
        m.job.hooks.onCover?.(m.target, m.i);
        if (--m.job.left === 0) this.#finish(m.job);
      },
    });
  }

  #finish(job) {
    const i = this.#jobs.indexOf(job);
    if (i >= 0) this.#jobs.splice(i, 1);
    job.resolve();
  }

  /** Remove everything at once (island reset). Pending fire() promises resolve. */
  clear() {
    for (const m of this.#missiles) if (m.mesh) this.group.remove(m.mesh);
    for (const r of this.#rings) {
      this.group.remove(r.mesh);
      r.mesh.material.dispose();
    }
    this.#missiles.length = 0;
    this.#rings.length = 0;
    this.#blasts.length = 0;
    this.#timers.length = 0;
    this.smoke.clear();
    this.cloud.clear();
    this.flames.clear();
    this.#lightLevel = 0;
    this.light.intensity = 0;
    for (const job of [...this.#jobs]) this.#finish(job);
  }
}
