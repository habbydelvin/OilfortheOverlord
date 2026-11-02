import * as THREE from 'three';
import { createGlobeBend } from './globeBend.js';
import { WHEEL_GAP, wheelUnits } from './controls.js';
import { L, onLangChange } from './i18n.js';
import { PLAYER_NODE } from './rivals.js';
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

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Pointy-top hexagon tile: a 2-ring cap (so it can curve) plus a short skirt; flat-shaded via explicit normals. */
function hexGeometry() {
  const top = 0.93 * HEX;
  const mid = 0.5 * HEX;
  const foot = 0.97 * HEX;
  const depth = -0.3;
  const corner = (i, r, y = 0) => {
    const a = THREE.MathUtils.degToRad(60 * i - 30);
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  };
  const pos = [];
  const nrm = [];
  const col = [];
  const tri = (a, b, c, n, ca, cb, cc) => {
    const face = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (face.dot(n) < 0) [b, c, cb, cc] = [c, b, cc, cb];
    for (const [p, k] of [
      [a, ca],
      [b, cb],
      [c, cc],
    ]) {
      pos.push(p.x, p.y, p.z);
      nrm.push(n.x, n.y, n.z);
      col.push(k, k, k);
    }
  };
  const up = new THREE.Vector3(0, 1, 0);
  const o = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    const m0 = corner(i, mid);
    const m1 = corner(i + 1, mid);
    const t0 = corner(i, top);
    const t1 = corner(i + 1, top);
    const f0 = corner(i, foot, depth);
    const f1 = corner(i + 1, foot, depth);
    tri(o, m0, m1, up, 1, 0.98, 0.98);
    tri(m0, t0, t1, up, 0.98, 0.86, 0.86);
    tri(m0, t1, m1, up, 0.98, 0.86, 0.98);
    const side = t0.clone().add(t1).setY(0).normalize();
    tri(t0, f0, f1, side, 0.7, 0.45, 0.45);
    tri(t0, f1, t1, side, 0.7, 0.45, 0.7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); // replaced in the shader
  return g;
}

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
  orbitRadius: 1.6, // moon orbit, × planet radius (ends sit just outside the limbs)
  orbitTilt: 15, // degrees the near side drops below the equator (0 = a flat line across the face)
  orbitRoll: 8, // degrees the ellipse is turned on screen (positive lifts the right limb)
  orbitSpeed: 0.06, // radians per second, moon only
  sunSize: 0.7, // sun disc radius (plane units)
  sunGlow: 8, // sun glow sprite size
  moonSize: 0.38,
  moonGlow: 3,
  spread: 27, // plane units per 100 war-table units (the planet is ~42 around)
  minGap: 8, // cities are pushed apart until at least this far from each other (plane units)
  gridLine: 0.005, // hex grid line thickness: share of a hex's width left open between tiles (0 = none)
  sandScale: 4, // plane units per sand texture repeat (the board: 4 units per repeat; a hex is ~1.7 across)
  fog: 'On', // debug: 'Off' hides the planet's fog of war
  fogPerHex: 2, // billows over each hidden hex (more = thicker, costlier)
  fogBillowSize: 2, // billow size (plane units; a hex is ~1.7 across)
  fogOpacity: 0.95,
  fogHeight: 0.5, // how far the banks float above the tiles
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
  { key: 'orbitRadius', label: 'Orbit radius (× planet)', min: 1.02, max: 3.5, step: 0.02 },
  { key: 'orbitTilt', label: 'Near-side drop (°)', min: 0, max: 80, step: 1, hint: 'how far the front of the orbit sags below the middle. 0 is a flat line across the face' },
  { key: 'orbitRoll', label: 'Orbit roll (°)', min: -90, max: 90, step: 1, hint: 'positive lifts the right side of the path' },
  { key: 'orbitSpeed', label: 'Orbit speed', min: 0, max: 0.5, step: 0.005 },
  { key: 'sunSize', label: 'Sun size', min: 0.1, max: 3, step: 0.05 },
  { key: 'sunGlow', label: 'Sun glow size', min: 0, max: 20, step: 0.1 },
  { key: 'moonSize', label: 'Moon size', min: 0.1, max: 2, step: 0.05 },
  { key: 'moonGlow', label: 'Moon glow size', min: 0, max: 10, step: 0.1 },
  { group: 'Globe · ground & fog' },
  { key: 'fog', label: 'Planet fog', type: 'select', options: ['On', 'Off'], hint: 'debug: hide the fog of war on the planet map' },
  { key: 'gridLine', label: 'Hex grid line thickness', min: 0, max: 0.2, step: 0.005, hint: 'gap between hex tiles; 0 = no lines' },
  { key: 'sandScale', label: 'Sand texture scale', min: 0.5, max: 16, step: 0.1, hint: 'plane units per texture repeat' },
  { key: 'fogPerHex', label: 'Billows per hidden hex', min: 0, max: 5, step: 1, layout: true, hint: '0 = no fog' },
  { key: 'fogBillowSize', label: 'Billow size', min: 0.5, max: 6, step: 0.05 },
  { key: 'fogOpacity', label: 'Fog opacity', min: 0, max: 1, step: 0.01 },
  { key: 'fogHeight', label: 'Fog height', min: 0, max: 3, step: 0.05 },
  { key: 'fogCityClear', label: 'Uncovered rings around cities', min: 0, max: 4, step: 1, layout: true, hint: '0 = only the city hex' },
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

export function createGlobeView({ renderer, root, factory, playerBuildings, onVisit, onDive = () => {} }) {
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

  // Opaque core: shows through the gaps as the hex lines, and hides the folded far side of the plane.
  const core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 0.05, 64, 48), new THREE.MeshStandardMaterial({ color: CORE, roughness: 1 }));
  scene.add(core);

  // Atmosphere rim.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.13, 64, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0xe8bf68) } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float rim = pow(clamp(0.78 + dot(vN, vV), 0.0, 1.0), 3.0);
          gl_FragColor = vec4(uColor * rim * 1.4, rim);
        }`,
    }),
  );
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
    // Pale cratered disc: a few darker blotches baked into a small texture.
    const n = 128;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#d9dde2';
    g.fillRect(0, 0, n, n);
    let sd = 5;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(120,128,140,${0.15 + rnd() * 0.3})`;
      g.beginPath();
      g.arc(rnd() * n, rnd() * n, 3 + rnd() * 12, 0, Math.PI * 2);
      g.fill();
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    moon.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ map, emissive: 0x9aa6b8, emissiveMap: map, emissiveIntensity: 0.55, roughness: 1 })));
  }
  const moonGlow = new THREE.Sprite(glowMat(glowTexture([[0, 'rgba(210,225,255,0.7)'], [0.3, 'rgba(170,190,235,0.25)'], [1, 'rgba(140,160,220,0)']])));
  moon.add(moonGlow);
  scene.add(sun, moon);
  let orbitAngle = 1.15; // starts on the near arc, right of center and below the middle
  const moonLocal = new THREE.Vector3();
  const moonPlane = new THREE.Vector2();
  // Inverse of bend() at scroll 0: the moon's place on the planet, so later scrolls carry it along.
  const planetPlane = (point, out) => {
    const len = point.length() || 1;
    const nx = point.x / len;
    const ny = point.y / len;
    const nz = point.z / len;
    const th = Math.acos(THREE.MathUtils.clamp(nz, -1, 1));
    const s = Math.sin(th);
    const arc = th * RADIUS;
    if (s < 1e-5) return out.set(0, 0);
    return out.set((nx / s) * arc, (-ny / s) * arc);
  };
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
    orbitPos(orbitAngle, moonLocal);
    // Dragging scrolls the planet under a fixed camera. The moon is pinned to that same scroll,
    // so it swings with the surface. At scroll 0 this is the identity. A quarter-turn of scroll.x
    // (scroll.x = +RADIUS * π/2) carries a front moon to world -X, the same way a city at the
    // front of the planet moves.
    planetPlane(moonLocal, moonPlane);
    bend.project(moonPlane.x, moonPlane.y, moonLocal.length() - RADIUS, moon.position);
    sun.children[0].scale.setScalar(GLOBE.sunSize);
    sunGlow.scale.setScalar(Math.max(1e-3, GLOBE.sunGlow));
    moon.children[0].scale.setScalar(GLOBE.moonSize);
    moonGlow.scale.setScalar(Math.max(1e-3, GLOBE.moonGlow));
    moon.children[0].rotation.y += dt * 0.05;
  }

  // ---------- hex tiles ----------
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({ c, r, p: cellCenter(c, r) });
  // The board's desert sand (seamlessGround.js), sampled at plane-space UVs so it runs on unbroken from hex to hex
  // and scrolls with the planet. Vertex colours keep the bevel shading; instance colours tint the city hexes.
  const sand = sandTexture();
  sand.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const tileMat = bend.patch(
    new THREE.MeshStandardMaterial({ map: sand, color: SAND.tint, vertexColors: true, roughness: SAND.roughness, metalness: 0 }),
  );
  {
    const bendCompile = tileMat.onBeforeCompile;
    tileMat.onBeforeCompile = (shader) => {
      bendCompile(shader);
      shader.uniforms.uSandRepeat = { value: GLOBE.sandScale };
      shader.uniforms.uHexScale = { value: (1 - GLOBE.gridLine) / 0.93 };
      tileMat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSandRepeat;\nuniform float uHexScale;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= uHexScale;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMapUv = globePlane.xz / uSandRepeat;');
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
      group.add(factory.create('capital'));
      nodeRoot.add(group);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'globe-node';
      el.dataset.globeNode = def.id;
      el.style.setProperty('--node', def.color);
      labelsEl.appendChild(el);
      nodes.push({ id: def.id, color, cell, p, group, lift: 0, el, rival: def.rival });
    }
    tiles.instanceColor.needsUpdate = true;
    buildFog(nodes.map((n) => n.p));
    renderLabels();
  }

  function renderLabels() {
    for (const n of nodes) {
      const name = n.rival ? L(n.rival.def.name, n.rival.def.zh) : L('Hive City', '蜂巢城');
      n.el.innerHTML = `<i></i><span>${name}</span>`;
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
      if (dive || (dy < 0 && goalDistance <= D_MIN + 1e-3)) {
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
    const n = nodes.find((node) => node.id === id);
    if (!n || visiting || !active) return;
    visiting = true;
    drag = null;
    velocity.set(0, 0);
    setHovered(null);
    await animate(n.p, D_CLOSE, 0.75, easeInOut);
    // Stay "visiting" (no hover, drag or card) while the clouds cover the swap; exit() clears it.
    if (active) onVisit(id);
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
    }
    if (fogMesh) fogMesh.visible = GLOBE.fog !== 'Off';
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
      if (dive.k >= 0.6) dive.k = Math.min(1, dive.k + dt / 0.6); // committed: finish the dive
      else if (performance.now() - dive.at > WHEEL_GAP) dive.k = Math.max(0, dive.k - dt / 1.5); // paused early: drift back
      dive.shown += (dive.k - dive.shown) * (1 - Math.exp(-9 * dt));
      const k = dive.shown;
      const d = bend.wrapDelta(dive.n.p.x, dive.n.p.y, dive.from);
      const e = k * k * (3 - 2 * k);
      setScroll(dive.from.x + d.x * e, dive.from.y + d.y * e);
      distance = goalDistance = D_MIN + (D_CLOSE - D_MIN) * e;
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
    updateSky(dt); // after the scroll for this frame, so the moon turns with the drag

    // Hover: label first, then the planet under the pointer.
    if (!anim && !visiting && !dive) {
      const n = hoverFromLabel ?? (pointer.inside && !drag?.moved ? pick(pointer.x, pointer.y) : null);
      setHovered(n);
    }

    // Labels follow the pin heads; hidden on the far side.
    const rect = dom.getBoundingClientRect();
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
      const x = rect.left + ((proj.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - proj.y) / 2) * rect.height;
      const show = facing > limb() + 0.04 && !anim;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      n.el.classList.toggle('off', !show);
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
      return Boolean(anim) || visiting;
    },
    scene,
    camera,
    enter,
    exit,
    visit,
    update,
    render,
  };
}
