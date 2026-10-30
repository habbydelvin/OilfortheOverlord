/**
 * Neon tiles: the tile under a boosted building (one next to tiles that boost it, economy.js rules) lights up like
 * a ring of gas flame, kept square: a white-hot line along the tile's edges with a halo in the building's colour,
 * a curtain of light rising from the edges and fading upward in flickering streaks, and narrow flames shooting up
 * from the edges, all rippling around the tile: bands of light run along the ground's edges and a wave runs around the edge, lifting
 * the curtain and flames as it passes. Each boosting neighbour makes it glow more (brighter, a wider halo, a taller curtain and flames).
 * The building itself keeps its own colours; idle (greyed) buildings don't glow.
 *  - Hydro-farm (green): Water Pump, Oasis, Capital
 *  - Oil Station (purple): Tar Pit, Capital, Refinery (one that's staffed)
 *  - Settlement (orange): Labour Camp
 */
import * as THREE from 'three';

export const NEON = {
  farm: 0x39ff6a,
  station: 0xb44dff,
  settlement: 0xff8a2a,
};
const BOOSTERS = {
  farm: ['pump', 'oasis', 'capital'],
  station: ['tarpit', 'capital', 'refinery'],
  settlement: ['labourcamp'],
};
/**
 * Glow by number of boosting neighbours (index 1-4): overall opacity; the ground halo's reach into the tile (share
 * of the tile), strength and faint fill; the curtain's height (world units) and how high the flames climb in it.
 */
const LEVELS = [
  null,
  { opacity: 0.675, reach: 0.035, halo: 0.55, fill: 0.03, height: 0.3, flame: 0.55 },
  { opacity: 0.8, reach: 0.055, halo: 0.65, fill: 0.05, height: 0.38, flame: 0.7 },
  { opacity: 0.9, reach: 0.075, halo: 0.75, fill: 0.07, height: 0.46, flame: 0.85 },
  { opacity: 1, reach: 0.095, halo: 0.85, fill: 0.09, height: 0.55, flame: 1 },
];
const HALF = 0.49; // a hair inside the cell, so neighbouring glows don't overlap
const LIFT = 0.006; // just above the tile's ground
const FADE = 3; // how quickly the glow follows a change (per second)
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Boosting neighbours of a building cell (0 for buildings without a neon colour). */
export function neonLevel(grid, cell) {
  const kinds = BOOSTERS[cell.terrain];
  if (!kinds) return 0;
  let n = 0;
  for (const [dx, dz] of DIRS) {
    const near = grid.get(cell.x + dx, cell.z + dz);
    // An idle booster (a Refinery without workers) boosts nothing.
    if (kinds.includes(near?.terrain) && !near.mesh?.userData.idle) n++;
  }
  return Math.min(n, LEVELS.length - 1);
}

// ---------- shaders ----------
const VERT = /* glsl */ `
  attribute float aSide;
  varying vec2 vUv;
  varying float vSide;
  void main() {
    vUv = uv;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Ripples circle the tile, flowing right along its front edge (as the board camera first sees it): bands of light
// on the ground along the edges (bands around the tile, laps per second), and the wave lifting the curtain and
// flames (crests around the tile, laps per second).
const RIPPLE = { bands: 8, speed: 0.22 };
const WAVE = { crests: 3, speed: 0.4 };
// The curtain's streaks of light flow sideways around the tile, constantly (noise units per second; ~72 per lap).
const STREAK_SPEED = 7;

const COMMON = /* glsl */ `
  #define RIPPLE_BANDS ${RIPPLE.bands.toFixed(2)}
  #define RIPPLE_SPEED ${RIPPLE.speed.toFixed(2)}
  #define WAVE_CRESTS ${WAVE.crests.toFixed(2)}
  #define WAVE_SPEED ${WAVE.speed.toFixed(2)}
  #define STREAK_SPEED ${STREAK_SPEED.toFixed(2)}
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSide;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

// The ground: a white-hot line along the edges, a halo in the colour fading inward, a faint fill, and bands of light
// running around the tile along its edges.
const GROUND_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uReach;
  uniform float uHalo;
  uniform float uFill;
  void main() {
    float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float core = 1.0 - smoothstep(0.004, 0.016, d);
    float flicker = 0.88 + 0.12 * noise(vec2(d * 40.0 + uTime * 0.9, vUv.x * 9.0 + vUv.y * 7.0));
    float halo = exp(-max(0.0, d - 0.012) / uReach) * uHalo * flicker;
    // Where this point is around the tile's edge (0-1, the same path as the curtain's wave), from its nearest edge.
    float along;
    if (d == 1.0 - vUv.y) along = vUv.x;               // back edge
    else if (d == 1.0 - vUv.x) along = 1.0 + (1.0 - vUv.y); // right edge
    else if (d == vUv.y) along = 2.0 + (1.0 - vUv.x);  // front edge
    else along = 3.0 + vUv.y;                           // left edge
    along *= 0.25;
    float ripple = pow(0.5 + 0.5 * sin(6.2832 * (along * RIPPLE_BANDS + uTime * RIPPLE_SPEED)), 6.0) * exp(-d / 0.14);
    float a = clamp(max(core, halo) + uFill + ripple * uHalo * 1.1, 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.75 + ripple * 0.3), a * uOpacity);
    #include <colorspace_fragment>
  }`;

// The curtain on each edge (uv.x along the edge, uv.y up): light fading upward in streaks that flow sideways around
// the tile, and three
// narrow flames per side that taper to a point and rise and fall at their own pace. A wave runs around the tile:
// where its crest passes, the curtain swells taller and brighter and the flames leap higher.
const CURTAIN_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uFlame;
  float wave(float along) { // along: 0-1 around the tile's edge
    return 0.5 + 0.5 * sin(6.2832 * (along * WAVE_CRESTS + uTime * WAVE_SPEED));
  }
  void main() {
    float h = vUv.y;
    float along = (vSide + vUv.x) * 0.25; // 0-1 around the tile, unbroken at the corners
    float w0 = wave(along);
    // Streaks of light flowing sideways around the tile at a steady pace (rightward along the front edge), with a
    // little slow change in shape as they go.
    float n1 = noise(vec2(along * 72.0 + uTime * STREAK_SPEED, uTime * 0.25));
    float n2 = noise(vec2(along * 172.0 + uTime * STREAK_SPEED * 1.6, 5.0 + uTime * 0.35));
    float streaks = 0.12 + 0.88 * pow(n1 * 0.65 + n2 * 0.35, 1.6) * 1.5;
    float wall = pow(max(0.0, 1.0 - h / (0.5 + 0.5 * w0)), 3.0) * streaks * (0.3 + 0.22 * w0); // still low: the building shows through it
    float flame = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float c = 0.12 + 0.76 * fract(sin((vSide * 3.0 + fi) * 12.9898 + 4.1) * 43758.5453);
      float top = uFlame * (0.55 + 0.45 * sin(uTime * (1.6 + fi * 0.55) + vSide * 2.1 + fi * 4.0)) * (0.55 + 0.45 * wave((vSide + c) * 0.25));
      float w = 0.026 * (1.0 - smoothstep(0.0, top, h)) + 0.002;
      float f = exp(-pow((vUv.x - c) / w, 2.0)) * (1.0 - smoothstep(top * 0.55, top, h));
      flame = max(flame, f);
    }
    float a = clamp(wall + flame, 0.0, 1.0) * uOpacity;
    vec3 col = mix(uColor, vec3(1.0), flame * 0.5 + pow(1.0 - h, 10.0) * 0.45);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

/** Flat square on the tile (uv 0-1 across it). */
function groundGeometry() {
  const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2);
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0), 1));
  return g;
}

/** Four 1-high walls standing on the square's edges (uv.x along the edge, uv.y up; aSide = which edge). */
function curtainGeometry() {
  const corners = [
    [-HALF, -HALF],
    [HALF, -HALF],
    [HALF, HALF],
    [-HALF, HALF],
  ];
  const position = [];
  const uv = [];
  const side = [];
  const index = [];
  for (let s = 0; s < 4; s++) {
    const [x0, z0] = corners[s];
    const [x1, z1] = corners[(s + 1) % 4];
    const base = s * 4;
    position.push(x0, 0, z0, x1, 0, z1, x1, 1, z1, x0, 1, z0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    side.push(s, s, s, s);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(index);
  return g;
}

function neonMaterial(fragmentShader, colour, extra) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(colour) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      ...extra,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class NeonTiles {
  #tiles = new Map(); // tile holder -> { group, ground, curtain, level, target, opacity }

  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'neon tiles';
    scene.add(this.group);
    this.groundGeo = groundGeometry();
    this.curtainGeo = curtainGeometry();
  }

  /** Recount boosts (call when the board or its economy changes). */
  refresh(grid) {
    const live = new Set();
    for (const cell of grid.cells.values()) {
      const colour = NEON[cell.terrain];
      if (!colour || !cell.mesh) continue;
      const level = cell.mesh.userData.idle ? 0 : neonLevel(grid, cell);
      let tile = this.#tiles.get(cell.mesh);
      if (!tile && level) tile = this.#create(cell.mesh, cell.terrain, colour);
      if (!tile) continue;
      tile.target = level ? LEVELS[level].opacity : 0;
      if (level && tile.level !== level) this.#setLevel(tile, level);
      live.add(cell.mesh);
    }
    for (const [holder, tile] of this.#tiles) if (!live.has(holder)) tile.target = 0; // removed or replaced: fade out
  }

  #create(holder, terrain, colour) {
    const group = new THREE.Group();
    group.name = `neon:${terrain}`;
    const ground = new THREE.Mesh(
      this.groundGeo,
      neonMaterial(GROUND_FRAG, colour, { uReach: { value: 0.05 }, uHalo: { value: 0.6 }, uFill: { value: 0.05 } }),
    );
    const curtain = new THREE.Mesh(this.curtainGeo, neonMaterial(CURTAIN_FRAG, colour, { uFlame: { value: 0.7 } }));
    ground.renderOrder = 1;
    curtain.renderOrder = 2;
    group.add(ground, curtain);
    this.group.add(group);
    const tile = { group, ground, curtain, level: 0, target: 0, opacity: 0, phase: Math.random() * 100 };
    this.#tiles.set(holder, tile);
    return tile;
  }

  #setLevel(tile, level) {
    const L = LEVELS[level];
    tile.level = level;
    const g = tile.ground.material.uniforms;
    g.uReach.value = L.reach;
    g.uHalo.value = L.halo;
    g.uFill.value = L.fill;
    tile.curtain.material.uniforms.uFlame.value = L.flame;
    tile.curtain.scale.y = L.height;
  }

  /** Every frame: fade toward the target, follow the tile (it drops in), animate the flames. */
  update(dt, time) {
    const k = Math.min(1, dt * FADE);
    for (const [holder, tile] of this.#tiles) {
      tile.opacity += (tile.target - tile.opacity) * k;
      if (tile.target === 0 && tile.opacity < 0.003) {
        this.#dispose(tile);
        this.#tiles.delete(holder);
        continue;
      }
      tile.group.position.set(holder.position.x, holder.position.y + LIFT, holder.position.z);
      tile.group.visible = holder.visible;
      for (const mesh of [tile.ground, tile.curtain]) {
        mesh.material.uniforms.uOpacity.value = tile.opacity;
        mesh.material.uniforms.uTime.value = time + tile.phase;
      }
    }
  }

  #dispose(tile) {
    this.group.remove(tile.group);
    tile.ground.material.dispose();
    tile.curtain.material.dispose();
  }

  /** Remove every glow at once (a new game). */
  clear() {
    for (const tile of this.#tiles.values()) this.#dispose(tile);
    this.#tiles.clear();
  }
}
