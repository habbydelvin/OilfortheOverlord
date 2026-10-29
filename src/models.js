import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { recolourSalt } from './saltRecolour.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { findSharedSand, makeSeamless, copySeam } from './seamlessGround.js';

/**
 * Blockout tiles. Maya exports these in centimetres with the mesh pivot
 * up in the air, and tags the atlas as Maya|baseColor, which FBXLoader skips.
 * Fit each one to a single board cell and put Atlas.jpg on the material.
 * Wasteland has no model yet and stays a coloured block.
 */
export const BLOCKOUTS = {
  capital: 'CapitalCity01.fbx',
  settlement: 'Village02City01.fbx',
  farm: 'HydroFarmCity01.fbx',
  pump: 'WaterPump01.fbx',
  station: 'OilStationCity01.fbx',
  refinery: 'RefineryCity01.fbx',
  oasis: 'Oasis.fbx',
  tarpit: 'TarPit01.fbx',
  cliffs: 'Cliff01.fbx',
  ruins: 'Ruins01.fbx',
  crater: 'ToxicCraterCity01.fbx',
  labourcamp: 'LaborCampCity01.fbx',
  // Camps: one model per camp, matched by its tent colour (TERRAINS[key].tent in tiles.js).
  raider: 'Camp04.fbx', // brown (rebels from starvation)
  bandit_raider: 'Camp03.fbx', // red
  bandit_siphon: 'Camp05.fbx', // grey (near-black tent)
  bandit_scav: 'Camp01.fbx', // green (olive tent)
  bandit_smuggle: 'Camp02.fbx', // blue
};

/**
 * Finished models exported from Blender (HiveCity.blend). They have their own
 * embedded textures, so they skip the atlas. Front is already Three.js +z, so
 * they need no yaw. `fit` names the node whose bounds set the cell fit. This
 * keeps orbiting traffic and rising smoke out of the footprint measurement.
 */
const FINISHED = {
  capital: { yaw: 0, fit: 'Capital_HiveCity' },
  refinery: { yaw: 0, fit: 'Refinery_HiveCity' },
  station: { yaw: 0, fit: 'OilStation_HiveCity' },
  farm: { yaw: 0, fit: 'HydroFarm_HiveCity' },
  tarpit: { yaw: 0, fit: 'WasteTar_HiveCity', dust: true }, // dust: strip its floating dust clusters (removeDust)
  pump: { yaw: 0, fit: 'PumpStation_HiveCity' },
  oasis: { yaw: 0, fit: 'WasteOasis_HiveCity' },
  labourcamp: { yaw: 0, fit: 'LaborCamp_HiveCity' },
  // Cliff and Ruins have no _HiveCity group: their 12 × 12 ground plate is the footprint.
  cliffs: { yaw: 0, fit: 'SandCliffs_Ground' },
  ruins: { yaw: 0, fit: 'WasteRuins_Ground' },
  crater: { yaw: 0, fit: 'ToxicCrater_HiveCity' },
  raider: { yaw: 0, fit: 'RaiderCampBrown_HiveCity' },
  bandit_raider: { yaw: 0, fit: 'RaiderCampRed_HiveCity' },
  bandit_siphon: { yaw: 0, fit: 'RaiderCampGray_HiveCity' },
  bandit_scav: { yaw: 0, fit: 'RaiderCampGreen_HiveCity' },
  bandit_smuggle: { yaw: 0, fit: 'RaiderCampBlue_HiveCity' },
  settlement: { yaw: 0, fit: 'Village02_HiveCity' },
};

const MODEL_URL = '/models/blockouts/';
// Bump when a model file is re-exported under the same name, so browsers drop the cached copy.
const MODEL_VERSION = '20261028-1553';
const ATLAS_URL = '/models/Atlas.jpg?v=20261026-1640';
// Footprints measure about 96 × 97 cm. One board cell is 1 unit across.
const CELL = 1; // full cell: the seam between tiles is TILE.gap, applied live by applyTileGap (tiles.js)

export function hasBlockout(terrain) {
  return Object.prototype.hasOwnProperty.call(BLOCKOUTS, terrain);
}

// Default camera sits on +z. Negative yaw turns the Maya blockouts toward screen-left.
// ground: the model's own ground height. Blender scenes stand on y = 0, and parts sunk below it
// (an oil stain, a well shaft) must not lift the tile. Without it, the lowest point goes on the cell.
function fitToCell(root, { yaw = -Math.PI / 2, fit = null, ground = null } = {}) {
  root.rotation.y = yaw;
  root.scale.set(1, 1, 1);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const box = footprintBox(root) ?? new THREE.Box3().setFromObject((fit && root.getObjectByName(fit)) || root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1e-4);
  const scale = CELL / span;
  root.scale.setScalar(scale);
  root.userData.fit = { sx: scale, sz: scale, cx: center.x, cz: center.z, w: 1, h: 1 };
  // Base on the cell (y = 0), footprint centred. Measured after the yaw,
  // so the Maya pivot offset does not leave the building in the air.
  const base = ground ?? box.min.y;
  root.position.set(-center.x * scale, -base * scale, -center.z * scale);
}

function applyAtlas(root, atlas) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const previous = obj.material;
    const material = new THREE.MeshStandardMaterial({
      name: previous?.name || 'blockingAtlas01',
      map: atlas,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
    });
    obj.material = material;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

/**
 * FBXLoader builds Phong materials with a white emissive colour. Rebuild them
 * as PBR materials that keep the embedded maps, so they match the rest of the
 * board under the same lights. Only lit windows keep their glow. Values follow
 * the unpainted resin look in HIVE_CITY_STYLE_GUIDE.md (roughness about 0.7).
 * Untextured see-through materials (refinery smoke) keep their own colour and
 * opacity, and do not write depth, so overlapping puffs blend instead of cutting holes.
 */
function toStandard(root) {
  const cache = new Map();
  const convert = (previous) => {
    if (!previous || previous.isMeshStandardMaterial) return previous;
    if (cache.has(previous)) return cache.get(previous);
    const glows = Boolean(previous.emissiveMap) && previous.emissiveIntensity > 0;
    const seeThrough = previous.transparent && previous.opacity < 1;
    const material = new THREE.MeshStandardMaterial({
      name: previous.name,
      map: previous.map ?? null,
      normalMap: previous.normalMap ?? null,
      color: previous.map ? 0xffffff : previous.color.clone(),
      roughness: seeThrough ? 1 : 0.7,
      metalness: 0,
      transparent: seeThrough,
      opacity: seeThrough ? previous.opacity : 1,
      depthWrite: !seeThrough,
      emissive: glows ? 0xffffff : 0x000000,
      emissiveMap: glows ? previous.emissiveMap : null,
      // Blender exports strength 6. Without bloom, anything above about 2 clips to flat white.
      emissiveIntensity: glows ? Math.min(previous.emissiveIntensity, 2) : 0,
    });
    for (const map of [material.map, material.emissiveMap]) {
      if (map) map.colorSpace = THREE.SRGBColorSpace;
    }
    for (const map of [material.map, material.normalMap, material.emissiveMap]) {
      if (map) map.anisotropy = 8;
    }
    previous.dispose();
    cache.set(previous, material);
    return material;
  };
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.material = Array.isArray(obj.material) ? obj.material.map(convert) : convert(obj.material);
    const solid = [obj.material].flat().every((m) => !m.transparent);
    // Smoke would cast hard, fully opaque shadows, so only solid parts cast them.
    obj.castShadow = solid;
    obj.receiveShadow = solid;
  });
}

/**
 * Blender bakes a key on every object in the scene. Keep only the tracks that
 * actually move (the traffic ships), so each frame does not resample about
 * 85 static tracks.
 */
function movingTracksOnly(clip) {
  const tracks = clip.tracks.filter((track) => {
    const { values } = track;
    const n = track.getValueSize();
    for (let i = n; i < values.length; i++) {
      if (Math.abs(values[i] - values[i % n]) > 1e-5) return true;
    }
    return false;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Draw-call reduction. The finished city models arrive as meshes whose geometry is cut into many
 * material groups (FBXLoader starts a new group at every material change): the Capital is 37 meshes
 * but 853 draws, and twice that with the shadow pass, for every placed copy. Re-bucket every
 * static, opaque triangle by material and bake one mesh per material in the model root's space
 * (the Capital drops to ~20 draws). Animated nodes (and everything under them), skinned meshes and
 * meshes with see-through parts (sorted per object) are left alone.
 * Returns { before, after } draw counts.
 */
const KEEP_ATTRS = ['position', 'normal', 'uv'];

/** Copy the vertices referenced by `index` (a slice of src's vertices) into a compact indexed geometry. */
function compactPart(src, index, attrs, matrix) {
  const n = src.attributes.position.count;
  const remap = new Int32Array(n).fill(-1);
  const order = [];
  const outIndex = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    if (remap[v] < 0) {
      remap[v] = order.length;
      order.push(v);
    }
    outIndex[i] = remap[v];
  }
  // A mirrored transform flips the winding once baked: swap two corners to keep faces outward.
  if (matrix.determinant() < 0) {
    for (let i = 0; i + 2 < outIndex.length; i += 3) [outIndex[i + 1], outIndex[i + 2]] = [outIndex[i + 2], outIndex[i + 1]];
  }
  const g = new THREE.BufferGeometry();
  for (const k of attrs) {
    const a = src.attributes[k];
    const size = a.itemSize;
    const out = new Float32Array(order.length * size);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(order[i], c);
    g.setAttribute(k, new THREE.BufferAttribute(out, size));
  }
  g.setIndex(new THREE.BufferAttribute(outIndex, 1));
  g.applyMatrix4(matrix);
  return g;
}

/** Rewrite the index so every material's triangles are contiguous: one group (one draw) per material. */
function regroupByMaterial(g) {
  if (g.groups.length < 2) return;
  const total = g.index ? g.index.count : g.attributes.position.count;
  const src = g.index ? g.index.array : null;
  const byMat = new Map();
  for (const grp of g.groups) {
    const list = byMat.get(grp.materialIndex) ?? [];
    list.push(grp);
    byMat.set(grp.materialIndex, list);
  }
  if (byMat.size === g.groups.length) return; // already one run per material
  const out = new Uint32Array(g.groups.reduce((n, grp) => n + Math.max(0, Math.min(total, grp.start + grp.count) - grp.start), 0));
  const groups = [];
  let k = 0;
  for (const [materialIndex, list] of byMat) {
    const start = k;
    for (const grp of list) {
      const end = Math.min(total, grp.start + grp.count);
      for (let i = grp.start; i < end; i++) out[k++] = src ? src[i] : i;
    }
    groups.push({ start, count: k - start, materialIndex });
  }
  g.setIndex(new THREE.BufferAttribute(out, 1));
  g.clearGroups();
  for (const grp of groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
}

export function mergeStaticMeshes(root) {
  const animated = new Set();
  for (const clip of root.animations ?? []) {
    for (const track of clip.tracks) animated.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  }
  const isAnimated = (obj) => {
    for (let o = obj; o && o !== root; o = o.parent) if (animated.has(o.name) || animated.has(o.uuid)) return true;
    return false;
  };

  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(); // signature -> { material, cast, receive, attrs, parts: [{ src, index, matrix }] }
  const consumed = [];
  let before = 0;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const g = obj.geometry;
    const mats = [obj.material].flat();
    const groups = Array.isArray(obj.material) && g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    before += groups.length;
    if (obj.isSkinnedMesh || obj.isInstancedMesh || obj.morphTargetInfluences || !obj.visible || isAnimated(obj)) return;
    if (!g.attributes.position || mats.some((m) => !m || m.transparent)) return;
    const attrs = Object.keys(g.attributes).filter((k) => KEEP_ATTRS.includes(k)).sort();
    const matrix = new THREE.Matrix4().multiplyMatrices(toRoot, obj.matrixWorld);
    const total = g.index ? g.index.count : g.attributes.position.count;
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0];
      if (!m) continue;
      const startI = grp.start;
      const endI = Math.min(total, grp.start + grp.count);
      if (endI <= startI) continue;
      const index = g.index ? g.index.array.subarray(startI, endI) : Uint32Array.from({ length: endI - startI }, (_, i) => startI + i);
      const sig = `${m.uuid}|${obj.castShadow}|${obj.receiveShadow}|${attrs.join(',')}`;
      let b = buckets.get(sig);
      if (!b) buckets.set(sig, (b = { material: m, cast: obj.castShadow, receive: obj.receiveShadow, attrs, parts: [] }));
      b.parts.push({ src: g, index, matrix });
    }
    consumed.push(obj);
  });

  for (const b of buckets.values()) {
    const geos = b.parts.map(({ src, index, matrix }) => compactPart(src, index, b.attrs, matrix));
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    if (!geometry) throw new Error('mergeStaticMeshes: incompatible parts');
    const mesh = new THREE.Mesh(geometry, b.material);
    mesh.name = `merged:${b.material.name || 'material'}`;
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    root.add(mesh);
  }
  for (const obj of consumed) {
    obj.removeFromParent();
    obj.geometry.dispose();
  }
  // Meshes that must stay separate (the animated traffic ships: 52 groups each) still get their
  // groups sorted and joined by material, so each draws once per material instead of once per run.
  const regrouped = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || !Array.isArray(obj.material) || regrouped.has(obj.geometry)) return;
    regroupByMaterial(obj.geometry);
    regrouped.add(obj.geometry);
  });
  // Drop the empty transform nodes left behind (keeps clone(true) cheap); animated ones stay.
  const prune = (obj) => {
    for (const c of [...obj.children]) prune(c);
    if (obj !== root && !obj.isMesh && !obj.children.length && !animated.has(obj.name) && !obj.isLight && !obj.isCamera) obj.removeFromParent();
  };
  prune(root);
  let after = 0;
  root.traverse((o) => o.isMesh && (after += Array.isArray(o.material) ? o.geometry.groups.length || 1 : 1));
  return { before, after };
}

/** Bytes downloaded across all model files, for a loading bar. Totals appear as each download starts. */
export const loadProgress = { loaded: 0, total: 0 };
const fileBytes = new Map(); // file -> [loaded, total]
function trackBytes(file, e) {
  if (!e.lengthComputable) return;
  fileBytes.set(file, [e.loaded, e.total]);
  let loaded = 0;
  let total = 0;
  for (const [l, t] of fileBytes.values()) {
    loaded += l;
    total += t;
  }
  Object.assign(loadProgress, { loaded, total });
}

/** Loads every blockout once. Rejects only if the atlas or a file is missing. */
/**
 * The board's sand plane (scene.js, GROUND.y = -0.05) is see-through so it can fade out at the edges, which puts
 * it in three.js's transparent pass, drawn after every solid object. Anything sunk below it (the Toxic Crater's
 * pit and liquid) would be painted over with sand. Those parts move to the transparent pass too, still fully
 * opaque and writing depth, and draw right after the plane (renderOrder -0.5: the plane is -1, the rest 0+).
 */
const BOARD_GROUND_Y = -0.05;
function drawAfterGround(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const swap = new Map();
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = [o.material].flat();
    if (mats.every((m) => m.transparent)) return; // smoke and fumes already draw after the plane
    if (box.setFromObject(o).min.y >= BOARD_GROUND_Y - 1e-3) return;
    const lift = (m) => {
      if (m.transparent) return m;
      if (!swap.has(m)) {
        const c = copySeam(m, m.clone());
        c.transparent = true;
        c.depthWrite = true;
        swap.set(m, c);
      }
      return swap.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(lift) : lift(o.material);
    o.renderOrder = -0.5;
    n++;
  });
  return n;
}


// ---------- Wasteland pieces ----------
/**
 * One finished model per Wasteland piece shape (keys of SHAPES in pieces.js). Each model spans its whole
 * piece, authored at 12 Blender units per cell in the shape's default orientation, so it can be laid over
 * the piece's cells and turned with it. File: Waste<Name>City01.fbx, footprint node: Waste<Name>_HiveCity.
 */
export const WASTE_PIECES = {
  mono: 'Single',
  domino: 'Pair',
  i3: 'Line3',
  v3: 'Corner',
  i4: 'I',
  o: 'O',
  t: 'T',
  s: 'S',
  z: 'Z',
  l: 'L',
  j: 'J',
};
const BLENDER_CELL = 12;

/** Scale a piece model to its cells (keeping the seam at its outer edge) and centre its footprint on the origin. */
function fitPiece(raw, base) {
  raw.position.set(0, 0, 0);
  raw.rotation.set(0, 0, 0);
  raw.scale.set(1, 1, 1);
  raw.updateMatrixWorld(true);
  const box = footprintBox(raw) ?? new THREE.Box3().setFromObject(base);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const w = Math.max(1, Math.round(size.x / BLENDER_CELL));
  const h = Math.max(1, Math.round(size.z / BLENDER_CELL));
  const sx = w / size.x;
  const sz = h / size.z;
  raw.userData.fit = { sx, sz, cx: center.x, cz: center.z, w, h };
  raw.scale.set(sx, (sx + sz) / 2, sz);
  // Blender ground is y = 0 (pits and the worm sink below it and must not lift the piece).
  raw.position.set(-center.x * sx, 0, -center.z * sz);
}

/** Resolves once the texture's image has arrived (FBXLoader hands textures back before their images load). */
function imageReady(texture, timeout = 30000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      const img = texture.image;
      if ((img && img.width && (img.complete === undefined || img.complete)) || performance.now() - start > timeout) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}


/**
 * The Wasteland piece files and the Tar Pit carry animated dust clusters (Waste<Name>_Dust and its _DustNN_NN
 * parts) that read as floating chunks over the board. Remove them. Returns the names of every removed node
 * (for the tracks).
 */
const DUST_NAME = /_Dust(\d|$)/;
function removeDust(raw, name) {
  const roots = [];
  raw.traverse((obj) => {
    if (obj !== raw && DUST_NAME.test(obj.name) && !DUST_NAME.test(obj.parent?.name ?? '')) roots.push(obj);
  });
  const removed = new Set();
  let clusters = 0;
  for (const root of roots) {
    root.traverse((o) => {
      removed.add(o.name);
      if (/_Dust\d+_01$/.test(o.name)) clusters++;
      if (o.isMesh) o.geometry.dispose();
    });
    root.removeFromParent();
  }
  if (roots.length) console.info(`[models] ${name}: removed ${clusters} dust clusters`);
  return removed;
}

/**
 * Most tiles have a thin dark frame (<Name>_SandTrim) around the edge of their ground. Side by side on the board
 * it outlines every cell, so it's removed: the tiles' ground meets its neighbours directly.
 */
const TRIM_NAME = /_SandTrim$/;
function removeTrim(raw) {
  const isTrim = (m) => TRIM_NAME.test(m?.name ?? '');
  const meshes = [];
  raw.traverse((o) => o.isMesh && (TRIM_NAME.test(o.name) || [o.material].flat().some(isTrim)) && meshes.push(o));
  for (const o of meshes) {
    const mats = [o.material].flat();
    if (TRIM_NAME.test(o.name) || mats.every(isTrim)) {
      o.removeFromParent();
      o.geometry.dispose();
      continue;
    }
    // A mesh mixing the trim with other materials: drop just the trim's triangles.
    const g = o.geometry;
    g.groups = g.groups.filter((grp) => !isTrim(mats[grp.materialIndex]));
  }
  return meshes.length;
}


/** Average colour of a texture's image, in linear RGB (the space material colours multiply in). */
function averageLinear(texture) {
  const img = texture?.image;
  if (!img?.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 64, 64);
  const px = ctx.getImageData(0, 0, 64, 64).data;
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const sum = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += toLinear(px[i + c] / 255);
  return sum.map((v) => v / (px.length / 4));
}

/**
 * Salt becomes sand-coloured. The white salt flats are painted into each piece's own ground texture, so that
 * texture is recoloured as it loads: pale, grey (unsaturated) pixels take the ground's average sand colour,
 * scaled by their own brightness so the crack pattern stays as darker sand. The small Waste<Name>_Salt part
 * is tinted to the same sand colour. Grounds with almost no salt are left alone (grey pebbles stay grey).
 */
async function matchSaltToSand(raw, name) {
  const ground = raw.getObjectByName(`Waste${name}_Ground`);
  const groundMap = [ground?.material].flat()[0]?.map;
  if (!groundMap?.image?.width) return;
  const { ref, share } = (await recolourInWorker(groundMap)) ?? recolourOnMainThread(groundMap);
  if (!ref) return;
  // The separate salt part: tinted so its texture averages out at the same sand colour (linear RGB).
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const sandLin = ref.map(toLinear);
  const parts = [];
  raw.traverse((obj) => obj.isMesh && obj.name === `Waste${name}_Salt` && parts.push(obj));
  for (const obj of parts) {
    for (const m of [obj.material].flat()) await decodeImage(m.map?.image);
    const recolour = (m) => {
      const salt = averageLinear(m.map);
      if (!salt) return m;
      const tinted = m.clone();
      tinted.color.setRGB(...sandLin.map((v, c) => Math.min(1, v / Math.max(salt[c], 1e-4))));
      return tinted;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(recolour) : recolour(obj.material);
  }
  if (share > 0.02) console.info(`Wasteland ${name}: salt recoloured to sand (${Math.round(share * 100)}% of the ground).`);
}

/** The recolour on the main thread (a blocking ~0.5 s per ground): only when the worker can't be used. */
function recolourOnMainThread(groundMap) {
  const img = groundMap.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = recolourSalt(data.data);
  if (result.share > 0.02) {
    ctx.putImageData(data, 0, 0);
    groundMap.image = canvas;
    if (img instanceof ImageBitmap) groundMap.flipY = false; // drawn as it was: already flipped
    groundMap.needsUpdate = true;
  }
  return result;
}

// ---------- off-main-thread image work ----------
let saltWorker = null; // null: not started yet; false: unavailable
const saltJobs = new Map(); // job id -> resolve
let saltJobId = 0;

function startSaltWorker() {
  try {
    const worker = new Worker(new URL('./saltWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      saltJobs.get(data.id)?.(data);
      saltJobs.delete(data.id);
    };
    worker.onerror = (e) => {
      console.warn('[models] salt worker failed; recolouring on the main thread', e.message);
      saltWorker = false;
      for (const resolve of saltJobs.values()) resolve(null);
      saltJobs.clear();
    };
    return worker;
  } catch {
    return false;
  }
}

/**
 * A texture's image as an ImageBitmap, decoded (and resized) by the browser off the main thread from the image
 * file kept by releaseImageBlobs. ImageBitmaps upload as they are, so it is flipped here as WebGL would and the
 * texture's flipY is turned off (useBitmap). Null when the file isn't kept or the browser can't.
 */
async function textureBitmap(t, resize = {}) {
  const blob = t.userData.sourceBlob;
  if (!blob || typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, {
      imageOrientation: t.flipY ? 'flipY' : 'from-image',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      ...resize,
    });
  } catch {
    return null;
  }
}

function useBitmap(t, bitmap) {
  t.image = bitmap;
  t.flipY = false;
  t.needsUpdate = true;
}

/** matchSaltToSand's pixel work in the worker. Resolves to { ref, share } (texture updated), or null to fall back. */
async function recolourInWorker(groundMap) {
  if (saltWorker === null) saltWorker = startSaltWorker();
  if (!saltWorker) return null;
  const shrunk = groundMap.image instanceof ImageBitmap; // already a flipped bitmap (see shrink)
  const bitmap = shrunk ? groundMap.image : await textureBitmap(groundMap);
  if (!bitmap || !saltWorker) return null;
  const result = await new Promise((resolve) => {
    const id = ++saltJobId;
    saltJobs.set(id, resolve);
    // A bitmap the texture still uses is copied; a fresh one is handed over.
    saltWorker.postMessage({ id, bitmap }, shrunk ? [] : [bitmap]);
  });
  if (!result) return null;
  if (result.share > 0.02) {
    if (shrunk) groundMap.image.close();
    useBitmap(groundMap, result.bitmap);
  } else result.bitmap.close();
  return { ref: result.ref, share: result.share };
}

// =====================================================================================================
// Loading pipeline
// -----------------------------------------------------------------------------------------------------
// Prepare (per model): FBX -> PBR materials, moving animation tracks only, Wasteland dust removed, the
// footprint stored on the root (the static merge removes the footprint node), images loaded and their
// embedded file copies freed, textures larger than MAX_TEXTURE shrunk, identical textures shared across
// all models, salt recoloured, static parts merged per material.
// Finish: shadow flags, no shadow pass for flat parts inside a tile, animated parts batched into one
// draw per material, cell fit, below-ground parts drawn after the sand plane.
// Phases: 'core' gates the game start; 'waste' (the pieces) then 'extra' (the other buildings and tiles)
// load in the background, one file at a time. Tiles placed before their model lands show stand-ins that
// main.js upgrades in place (adoptBlockouts / adoptWastePieces).
// =====================================================================================================

/** Models needed before the game can start: the Capital and the opening hand's buildings. */
export const CORE_MODELS = ['capital', 'settlement', 'farm', 'station'];
export const BUNDLES = {
  core: CORE_MODELS,
  waste: Object.keys(WASTE_PIECES).map((shape) => `waste-${shape}`),
  extra: Object.keys(BLOCKOUTS).filter((k) => FINISHED[k] && !CORE_MODELS.includes(k)),
};
export const MAX_TEXTURE = 2048; // larger textures are never shown at full size at game zoom

/** What a model key needs: its FBX file, and how it is fitted (building cell or Wasteland piece). */
function modelSpec(key) {
  if (key.startsWith('waste-')) {
    const shape = key.slice(6);
    const name = WASTE_PIECES[shape];
    return { key, shape, piece: name, file: `Waste${name}City01.fbx`, base: `Waste${name}_HiveCity` };
  }
  return { key, file: BLOCKOUTS[key], finished: FINISHED[key], base: FINISHED[key]?.fit };
}

/** Stored footprint (root space) as a Box3, or null. */
function footprintBox(root) {
  const f = root.userData.footprint;
  return f ? new THREE.Box3(new THREE.Vector3(...f.min), new THREE.Vector3(...f.max)) : null;
}

/**
 * Measured in the same root state the fit leaves it in (fitToCell keeps the root's own X rotation and resets the
 * rest; fitPiece resets everything). Some files (Cliff, Ruins) carry Blender's axis rotation and the object's
 * position on the root itself, so measuring before that reset would put the footprint off to the side.
 */
function storeFootprint(root, baseName, piece) {
  root.position.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  if (piece) root.rotation.set(0, 0, 0);
  else root.rotation.y = 0;
  root.updateMatrixWorld(true);
  const base = (baseName && root.getObjectByName(baseName)) || root;
  const box = new THREE.Box3().setFromObject(base);
  root.userData.footprint = { min: box.min.toArray(), max: box.max.toArray() };
}

function textureSlots(roots) {
  const slots = [];
  for (const root of roots) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k]) slots.push([m, k]);
    });
  }
  return slots;
}

/**
 * FBXLoader hands each embedded image to the browser as a blob URL and never frees it, so every image file
 * stays in memory twice. With all the models that ran browsers out of blob space (ERR_BLOB_OUT_OF_MEMORY)
 * and textures went missing. Once an image has decoded, its blob is no longer needed.
 * Before freeing it, the image file's bytes are hashed (crypto.subtle works off the main thread): textures
 * embedded twice have the same file, so findTwin can match them without reading any pixels. Textures in
 * `keep` and oversized ones keep their file (as a Blob) for the off-main-thread work in prepareFromFbx.
 */
async function releaseImageBlobs(root, keep = new Set()) {
  const textures = [...new Set(textureSlots([root]).map(([m, k]) => m[k]))];
  await Promise.all(textures.map((t) => imageReady(t)));
  await Promise.all(
    textures.map(async (t) => {
      const src = t.image?.src;
      if (typeof src !== 'string' || !src.startsWith('blob:')) return;
      try {
        const bytes = await (await fetch(src)).arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        t.userData.sourceHash = `${bytes.byteLength}:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
        // Kept until the bundle is prepared: shrink and the salt recolour decode it off the main thread.
        if (keep.has(t) || Math.max(t.image.width, t.image.height) > MAX_TEXTURE) t.userData.sourceBlob = new Blob([bytes]);
      } catch {
        // no hash: findTwin falls back to comparing pixels
      }
      URL.revokeObjectURL(src);
    }),
  );
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Background loading runs during play (the intro dialogue, the first turns), on the same thread as the game.
 * Long steps are cut into slices: breathe() hands control back to the browser once a slice has run ~8ms, so
 * frames keep coming. Cheap when there is time left in the slice.
 */
let sliceStart = performance.now();
export async function breathe(budget = 8) {
  if (performance.now() - sliceStart < budget) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  sliceStart = performance.now();
}

/** Decode an image off the main thread, so drawing or uploading it later doesn't decode it in one blocking go. */
export async function decodeImage(img) {
  if (img && typeof img.decode === 'function') await img.decode().catch(() => {});
}

async function loadFbx(loader, spec, track) {
  const raw = await loader.loadAsync(`${MODEL_URL}${spec.file}?v=${MODEL_VERSION}`, track ? (e) => trackBytes(spec.file, e) : undefined);
  const removed = spec.piece || spec.finished?.dust ? removeDust(raw, spec.piece ?? spec.key) : new Set();
  removeTrim(raw);
  toStandard(raw);
  // Object3D.clone copies `animations`, so every tile copy can play them.
  raw.animations = raw.animations
    .map(movingTracksOnly)
    .map((clip) => {
      const tracks = clip.tracks.filter((t) => !removed.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
      return tracks.length === clip.tracks.length ? clip : new THREE.AnimationClip(clip.name, clip.duration, tracks);
    })
    .filter((clip) => clip.tracks.length);
  storeFootprint(raw, spec.base, Boolean(spec.piece));
  const groundMap = spec.piece ? [raw.getObjectByName(`Waste${spec.piece}_Ground`)?.material].flat()[0]?.map : null;
  await releaseImageBlobs(raw, new Set(groundMap ? [groundMap] : []));
  raw.name = spec.key;
  return raw;
}

/**
 * FBX files -> prepared models (Map key -> root, untransformed). `parallel` downloads them all at once
 * (behind the loading screen); otherwise one file at a time with a pause, so it can run during play.
 */
async function prepareFromFbx(keys, { track = false, parallel = false } = {}) {
  const loader = new FBXLoader();
  const specs = keys.map(modelSpec);
  const roots = new Map();
  if (parallel) (await Promise.all(specs.map((s) => loadFbx(loader, s, track)))).forEach((r, i) => roots.set(specs[i].key, r));
  else {
    for (const s of specs) {
      roots.set(s.key, await loadFbx(loader, s, track));
      await pause(30);
    }
  }
  const { textures, merged, shrunk } = await prepareTextures([...roots.values()]);
  console.info(`[models] ${keys.length} models from FBX: ${textures} textures, ${merged} shared, ${shrunk} shrunk to ${MAX_TEXTURE}`);
  for (const s of specs) {
    await breathe();
    const root = roots.get(s.key);
    if (s.piece) await matchSaltToSand(root, s.piece); // before the merge: it finds the ground by name
    // ?nomerge in the URL keeps the original meshes (for A/B checks).
    if (!new URLSearchParams(location.search).has('nomerge')) {
      try {
        const { before, after } = mergeStaticMeshes(root);
        console.info(`[models] ${s.key}: ${before} draws -> ${after}`);
      } catch (e) {
        console.warn(`[models] ${s.key}: merge skipped`, e);
      }
    }
  }
  for (const [m, k] of textureSlots([...roots.values()])) delete m[k].userData.sourceBlob;
  return roots;
}

/**
 * Every distinct texture across all loaded models, so a texture repeated in several files is uploaded once.
 * A small thumbnail only shortlists candidates; two textures merge only if their full-size pixels are exactly
 * equal (true repeats are the same file embedded twice). Thumbnails alone are not enough: two different,
 * mostly flat normal maps can look identical once shrunk, and a thumbnail can skip palette columns.
 */
const textureRegistry = new Map(); // shortlist key -> [texture, ...]
let scratchCtx = null;

function scratch(w, h) {
  scratchCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  scratchCtx.canvas.width = w;
  scratchCtx.canvas.height = h;
  scratchCtx.imageSmoothingQuality = 'high';
  return scratchCtx;
}

function shortlistKey(t) {
  const img = t.image;
  const ctx = scratch(16, 16);
  ctx.drawImage(img, 0, 0, 16, 16);
  const px = ctx.getImageData(0, 0, 16, 16).data;
  let hash = 2166136261;
  for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 16777619);
  return [img.width, img.height, t.colorSpace, t.flipY, t.wrapS, t.wrapT, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, hash >>> 0].join('|');
}

function fullPixels(img) {
  const ctx = scratch(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height).data;
}

function samePixels(a, b) {
  const pa = fullPixels(a.image);
  const pb = fullPixels(b.image);
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
  return true;
}

/** Sampling settings that must match too for two textures to be interchangeable. */
const samplerKey = (t) => [t.colorSpace, t.flipY, t.wrapS, t.wrapT, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y].join('|');
const hashRegistry = new Map(); // file hash + sampler -> texture

/** The texture already registered from the same image file (same bytes, same sampling), or null (and this one is registered). */
function findFileTwin(t) {
  const key = `${t.userData.sourceHash}|${samplerKey(t)}`;
  const twin = hashRegistry.get(key);
  if (twin && twin !== t) return twin;
  hashRegistry.set(key, t);
  return null;
}

/** The texture already registered with exactly these pixels, or null (and this one is registered). */
function findTwin(t) {
  const key = shortlistKey(t);
  const list = textureRegistry.get(key) ?? [];
  for (const other of list) if (other !== t && samePixels(t, other)) return other;
  list.push(t);
  textureRegistry.set(key, list);
  return null;
}

/**
 * Larger than MAX_TEXTURE: redraw at MAX_TEXTURE (the GPU would only ever sample a smaller mip level).
 * Decoded and resampled by the browser off the main thread from the kept image file; a canvas otherwise.
 */
async function shrink(t) {
  const img = t.image;
  const k = MAX_TEXTURE / Math.max(img.width, img.height);
  if (k >= 1) return false;
  const width = Math.round(img.width * k);
  const height = Math.round(img.height * k);
  const bitmap = await textureBitmap(t, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  if (bitmap) {
    useBitmap(t, bitmap);
    return true;
  }
  await decodeImage(img);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  t.image = canvas;
  t.needsUpdate = true;
  return true;
}

/** Shrink oversized textures and share identical ones across every model loaded so far. */
async function prepareTextures(roots) {
  const slots = textureSlots(roots);
  const unique = [...new Set(slots.map(([m, k]) => m[k]))];
  await Promise.all(unique.map((t) => imageReady(t)));
  let shrunk = 0;
  const use = new Map();
  for (const t of unique) {
    await breathe();
    if (!t.image?.width) {
      use.set(t, t);
      continue;
    }
    if (t.userData.sourceHash) {
      // Same file embedded twice: share it, and only the one kept is shrunk.
      const twin = findFileTwin(t);
      if (twin) {
        use.set(t, twin);
        continue;
      }
      if (await shrink(t)) shrunk++;
      use.set(t, t);
      continue;
    }
    if (await shrink(t)) shrunk++;
    use.set(t, findTwin(t) ?? t);
  }
  for (const [m, k] of slots) {
    const u = use.get(m[k]);
    if (u && u !== m[k]) {
      m[k] = u;
      m.needsUpdate = true;
    }
  }
  let merged = 0;
  for (const [t, u] of use) {
    if (t === u) continue;
    t.dispose();
    merged++;
  }
  return { textures: unique.length, merged, shrunk };
}

// ---------- finish (every model) ----------
function animatedNames(root) {
  const names = new Set();
  for (const clip of root.animations ?? []) for (const t of clip.tracks) names.add(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
  return names;
}

/**
 * Flat parts lying on the ground inside a tile (roads, water, tar pools) have nothing under them to shade, so
 * they skip the shadow pass. Parts reaching the tile's edge keep it (their shadow can fall on the sand beside
 * the tile), and so does every part of a model with anything below ground (a ground plate shades the hole).
 */
function skipFlatShadows(root) {
  root.updateMatrixWorld(true);
  const animated = animatedNames(root);
  const boxes = [];
  let bottom = Infinity;
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const b = new THREE.Box3().setFromObject(o);
    boxes.push([o, b]);
    bottom = Math.min(bottom, b.min.y);
  });
  const fp = footprintBox(root);
  if (!fp) return 0;
  const span = Math.max(fp.max.x - fp.min.x, fp.max.z - fp.min.z);
  if (bottom < -span * 0.008) return 0;
  const inner = fp.clone().expandByVector(new THREE.Vector3(-span * 0.02, 0, -span * 0.02));
  let n = 0;
  for (const [o, b] of boxes) {
    if (!o.castShadow || animated.has(o.name)) continue;
    const flat = b.max.y - b.min.y < span * 0.012 && b.min.y <= bottom + span * 0.004;
    const inside = b.min.x >= inner.min.x && b.max.x <= inner.max.x && b.min.z >= inner.min.z && b.max.z <= inner.max.z;
    if (flat && inside) {
      o.castShadow = false;
      n++;
    }
  }
  return n;
}

const BATCH_ATTRS = ['position', 'normal', 'uv'];

/**
 * Animated parts sharing one material (smoke puffs, flames, tar bubbles...) become a single skinned mesh: each
 * part stays in the scene as an invisible "bone" that the animation keeps moving, and the merged mesh follows
 * the bones exactly. One draw per material instead of one per part. Returns the number of draws saved.
 */
function batchAnimatedParts(root) {
  const animated = animatedNames(root);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.children.length || !animated.has(o.name)) return;
    const g = o.geometry;
    if (!g.attributes.position || !g.attributes.normal) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  let saved = 0;
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const attrs = BATCH_ATTRS.filter((a) => parts.every((p) => p.geometry.attributes[a]));
    const indexed = parts.every((p) => p.geometry.index);
    const geos = parts.map((p, i) => {
      const src = indexed ? p.geometry : p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
      const g = new THREE.BufferGeometry();
      for (const a of attrs) g.setAttribute(a, src.attributes[a].clone());
      if (indexed) g.setIndex(src.index.clone());
      const n = src.attributes.position.count;
      const skinIndex = new Uint16Array(n * 4);
      const skinWeight = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) {
        skinIndex[v * 4] = i;
        skinWeight[v * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      return g;
    });
    const geometry = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!geometry) continue;
    const first = parts[0];
    const mesh = new THREE.SkinnedMesh(geometry, first.material);
    mesh.name = `batched:${first.material.name || 'material'}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = false; // its bounds move with the bones
    root.add(mesh);
    // Bind matrix and bone inverses are identity, so each vertex lands at part.matrixWorld × its own local
    // position: exactly where the part drew itself before.
    mesh.bind(new THREE.Skeleton(parts, parts.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    for (const p of parts) p.visible = false;
    saved += parts.length - 1;
  }
  return saved;
}

function finishModel(root, spec) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = 8;
  });
  const flat = skipFlatShadows(root);
  const batched = batchAnimatedParts(root);
  if (flat || batched) console.info(`[models] ${spec.key}: ${flat} flat parts skip shadows, ${batched} animated draws batched`);
  // Still in the state storeFootprint measured it in, so the footprint lines up with the parts.
  const fp = footprintBox(root);
  if (fp) {
    const size = fp.getSize(new THREE.Vector3());
    const grid = spec.piece ? [Math.max(1, Math.round(size.x / BLENDER_CELL)), Math.max(1, Math.round(size.z / BLENDER_CELL))] : [1, 1];
    makeSeamless(root, fp, grid);
  }
  if (spec.piece) {
    fitPiece(root, root);
    root.name = `waste-${spec.shape}`;
  } else {
    fitToCell(root, { ground: 0, ...spec.finished });
    const sunk = drawAfterGround(root);
    if (sunk) console.info(`[models] ${spec.key}: ${sunk} below-ground parts drawn after the sand plane`);
    root.name = spec.key;
  }
  return root;
}

/** One bundle of models, prepared and finished, ready to clone (Map key -> root). */
export async function loadBundle(bundle, { track = false, parallel = false } = {}) {
  const keys = BUNDLES[bundle];
  const roots = await prepareFromFbx(keys, { track, parallel });
  findSharedSand(roots.values());
  for (const key of keys) {
    await breathe();
    finishModel(roots.get(key), modelSpec(key));
  }
  return roots;
}

/** Any remaining Maya blockouts (atlas-textured; none are in use at the moment). */
async function loadAtlasBlockouts() {
  const keys = Object.keys(BLOCKOUTS).filter((k) => !FINISHED[k]);
  if (!keys.length) return new Map();
  const atlas = await new THREE.TextureLoader().loadAsync(ATLAS_URL);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = true;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.anisotropy = 8;
  const loader = new FBXLoader();
  const raws = await Promise.all(keys.map((k) => loader.loadAsync(`${MODEL_URL}${BLOCKOUTS[k]}?v=${MODEL_VERSION}`, (e) => trackBytes(BLOCKOUTS[k], e))));
  return new Map(
    raws.map((raw, i) => {
      applyAtlas(raw, atlas);
      raw.animations = [];
      fitToCell(raw);
      raw.name = keys[i];
      return [keys[i], raw];
    }),
  );
}

/** Everything the game needs before it starts: the core buildings (and any Maya blockouts). */
export async function loadCoreModels() {
  const [core, blockouts] = await Promise.all([loadBundle('core', { track: true, parallel: true }), loadAtlasBlockouts()]);
  return new Map([...core, ...blockouts]);
}

/** Every building model at once, for pages that want them all (capital-test). */
export async function loadBlockouts() {
  const all = await loadCoreModels();
  for (const [k, v] of await loadBundle('extra')) all.set(k, v);
  return all;
}
