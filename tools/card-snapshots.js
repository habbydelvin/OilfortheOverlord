/**
 * Card snapshots: a close-up of each tile model from the front, slightly raised, on a transparent background,
 * at the exact shape of the card's picture slot (src/ui.css .card .snap: 0.74 × 0.5 of the card width).
 * Same models (the game's loaders), lighting, tone mapping and colour output as the game (src/scene.js).
 * Animated parts (smoke, fire, traffic) are frozen a moment into their loop so they look natural.
 *
 * Open /tools/card-snapshots.html on the dev server, wait for the renders, then "Download all" and put the
 * files in public/cards/snapshots/. The cards pick them up through SNAPSHOTS in src/tiles.js.
 */
import * as THREE from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import { loadBlockouts, loadBundle, SHIPS, SHIP_SCALE } from '/src/models.js';

const WIDTH = 740; // 1.48 : 1, the picture slot; sharp on the largest cards at 2× pixel density
const HEIGHT = 500;
const ELEVATION = 12; // degrees above the horizon: a low front view that still shows a little of the top
const FOV = 24; // narrow, so buildings do not look distorted
const MARGIN = 0.02; // empty border around the building (share of the frame): a little room for the cards' parallax shift
const CLOSE_UP = 1; // share of the building's size kept in frame (1 = the whole building, < 1 = a close-up)
const POSE_TIME = 1.5; // seconds into the animation loop
const MIN_FRAME = 0.55; // land tiles: the framed area is at least this share of the tile wide, so they keep their context
const MIN_FRAME_BUILDING = 0.2; // buildings fill the picture, however small

/**
 * Land tiles keep their ground (it is their picture: the oasis pool, the tar pit, the crater...). Every other card
 * shows the building alone, without its ground tile (see hideGround).
 */
const KEEP_GROUND = new Set(['oasis', 'tarpit', 'cliffs', 'ruins', 'crater', 'waste-mono']);
const GROUND_PART = /(_Sand|Ground|_SandTrim|_Pad\d+|_AshScorch)$/; // the ground plate's materials (see seamlessGround.js)
/**
 * Per-card camera overrides: elevation (degrees), closeUp (share of the building kept), focus (aim height, 0-1),
 * margin, tile (seen from above, the tile's width fills the picture edge to edge, instead of what stands on it).
 */
const VIEWS = {
  // Wasteland: the sand seen from straight above, close up (its original card picture).
  wasteland: { elevation: 90, closeUp: 0.55, margin: 0 },
  // Tar Pit and Oasis: like the Wasteland, the whole tile seen from straight above.
  tarpit: { elevation: 90, tile: true, margin: 0 },
  oasis: { elevation: 90, tile: true, margin: 0 },
  // The crater's glowing pool sits below its rim: look down into it a little more.
  crater: { elevation: 28 },
};

/** Card key -> model key. The four Wasteland cards share the single-cell Wasteland piece. */
const SNAPSHOT_MODELS = {
  capital: 'capital',
  settlement: 'settlement',
  farm: 'farm',
  pump: 'pump',
  station: 'station',
  refinery: 'refinery',
  oasis: 'oasis',
  tarpit: 'tarpit',
  labourcamp: 'labourcamp',
  cliffs: 'cliffs',
  ruins: 'ruins',
  crater: 'crater',
  raider: 'raider',
  bandit_raider: 'bandit_raider',
  bandit_siphon: 'bandit_siphon',
  bandit_scav: 'bandit_scav',
  wasteland: 'waste-mono',
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT);
renderer.setClearColor(0x000000, 0); // transparent background
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2622, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 60 });
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(7, 16, 5); // the game's sun direction
const camera = new THREE.PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.01, 100);

/**
 * What to frame: the model's standing, still parts (buildings, tents, rocks, trees), not the flat ground plate
 * they stand on, so small buildings fill the picture instead of a big empty plate. Animated smoke, fire and
 * traffic are left out too (they would throw the framing off). Never narrower than MIN_FRAME of the tile.
 */
function contentBounds(root, minFrame = MIN_FRAME) {
  const animated = new Set();
  for (const clip of root.animations ?? []) for (const t of clip.tracks) animated.add(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
  root.updateMatrixWorld(true);
  const all = new THREE.Box3();
  const standing = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.isSkinnedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (animated.has(p.name)) return;
    b.setFromObject(o);
    all.union(b);
    const flat = b.max.y - b.min.y < 0.03 && b.max.y < 0.05; // ground plates, roads, water, decals
    if (!flat) standing.union(b);
  });
  const box = standing.isEmpty() ? all : standing;
  box.min.y = Math.min(box.min.y, 0); // keep the ground line in the picture
  const c = box.getCenter(new THREE.Vector3());
  for (const k of ['x', 'z']) {
    if (box.max[k] - box.min[k] < minFrame) {
      box.min[k] = c[k] - minFrame / 2;
      box.max[k] = c[k] + minFrame / 2;
    }
  }
  return box;
}

/**
 * Hides anything hanging below the tile (a crater's pit, a tar pool) when seen from this low angle: an invisible
 * wall just in front of the tile, below ground level, that writes depth but no colour. In the game the camera is
 * high enough that the underside never shows. Looking down into a pit is unaffected (those sight lines enter the
 * pit from above the ground, behind the wall).
 */
const skirt = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2), new THREE.MeshBasicMaterial({ colorWrite: false }));
skirt.position.set(0, -0.998, 0.505); // top edge a hair above the ground line, so nothing peeks under the tile
skirt.renderOrder = -10;
scene.add(skirt);

/** Camera distance (bisection) at which every corner of the box sits inside the frame, minus the margin. */
function frame(box, elevation = ELEVATION, margin = MARGIN) {
  const center = box.getCenter(new THREE.Vector3());
  const e = THREE.MathUtils.degToRad(elevation);
  const dir = new THREE.Vector3(0, Math.sin(e), Math.cos(e));
  // Looking straight down, "up" on screen is the far side of the tile (as in the game: its front at the bottom).
  camera.up.set(0, 1, 0);
  if (elevation > 80) camera.up.set(0, 0, -1);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const fits = (d) => {
    camera.position.copy(center).addScaledVector(dir, d);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    return corners.every((c) => {
      const v = c.clone().project(camera);
      return Math.abs(v.x) <= 1 - margin * 2 && Math.abs(v.y) <= 1 - margin * 2 && v.z < 1;
    });
  };
  let lo = 0.2;
  let hi = 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  return center;
}

/** The model's ship (flown by traffic.js in the game), parked on its home pad as it rests between trips. */
function parkShip(model, key) {
  const spec = SHIPS.get(key);
  if (!spec) return;
  const ship = new THREE.Mesh(spec.geometry, spec.material);
  ship.matrixAutoUpdate = false;
  ship.matrix.copy(spec.rel).multiply(new THREE.Matrix4().makeScale(SHIP_SCALE, SHIP_SCALE, SHIP_SCALE));
  ship.castShadow = spec.castShadow;
  model.add(ship);
}

/** The building alone: hide its ground plate (sand, painted ground, trim, pads, scorch) and flat decals (roads). */
function hideGround(root) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const ground = [o.material].flat().every((m) => GROUND_PART.test(m?.name ?? ''));
    b.setFromObject(o);
    const flat = b.max.y - b.min.y < 0.03 && b.max.y < 0.05;
    if (ground || flat) o.visible = false;
  });
}

function snapshot(source, view = {}, key = '') {
  const model = cloneModel(source);
  parkShip(model, key);
  const building = !KEEP_GROUND.has(key);
  if (building) hideGround(model);
  // Freeze the animation a moment into its loop.
  if (model.animations.length) {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of model.animations) mixer.clipAction(clip).play();
    mixer.update(POSE_TIME);
  }
  scene.add(model);
  // Close-up: frame only the middle of the building, so it overflows the picture and its detail fills the slot.
  // tile: the tile's width fills the picture from edge to edge (trimmed a little top and bottom), like the Wasteland's.
  const tileHalf = 0.47;
  const box = view.tile
    ? new THREE.Box3(new THREE.Vector3(-tileHalf, 0, -tileHalf / (WIDTH / HEIGHT)), new THREE.Vector3(tileHalf, 0.02, tileHalf / (WIDTH / HEIGHT)))
    : contentBounds(model, building ? MIN_FRAME_BUILDING : MIN_FRAME);
  const mid = box.getCenter(new THREE.Vector3());
  if (view.focus !== undefined) mid.y = box.min.y + (box.max.y - box.min.y) * view.focus; // aim lower or higher
  const half = box.getSize(new THREE.Vector3()).multiplyScalar((view.closeUp ?? CLOSE_UP) / 2);
  box.set(mid.clone().sub(half), mid.clone().add(half));
  const center = frame(box, view.elevation, view.margin);
  sun.position.copy(center).add(SUN_OFFSET);
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.92); // keeps the alpha channel
  scene.remove(model);
  return url;
}

const status = document.getElementById('status');
const grid = document.getElementById('grid');
const button = document.getElementById('download');
const results = {};

const [buildings, pieces] = await Promise.all([loadBlockouts(), loadBundle('waste')]);
status.textContent = 'Rendering…';
for (const [key, modelKey] of Object.entries(SNAPSHOT_MODELS)) {
  const source = buildings.get(modelKey) ?? pieces.get(modelKey);
  if (!source) {
    console.warn(`No model for ${key} (${modelKey})`);
    continue;
  }
  results[key] = snapshot(source, VIEWS[key], modelKey);
  const fig = document.createElement('figure');
  fig.innerHTML = `<img src="${results[key]}" alt="${key}"><figcaption>${key}.webp</figcaption>`;
  grid.appendChild(fig);
  await new Promise((r) => setTimeout(r, 0)); // let the page show progress
}
status.textContent = `${Object.keys(results).length} snapshots rendered (${WIDTH} × ${HEIGHT}).`;
button.disabled = false;
button.addEventListener('click', () => {
  for (const [key, url] of Object.entries(results)) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key}.webp`;
    a.click();
  }
});
window.__snapshots = results; // for scripted runs
