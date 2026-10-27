import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * Blockout tiles. Maya exports these in centimetres with the mesh pivot
 * up in the air, and tags the atlas as Maya|baseColor, which FBXLoader skips.
 * Fit each one to a single board cell and put Atlas.jpg on the material.
 * Wasteland has no model yet and stays a coloured block.
 */
export const BLOCKOUTS = {
  capital: 'CapitalCity01.fbx',
  settlement: 'VillageCity01.fbx',
  farm: 'HydroFarm01.fbx',
  pump: 'WaterPump01.fbx',
  station: 'OilStation01.fbx',
  refinery: 'RefineryCity01.fbx',
  oasis: 'Oasis01.fbx',
  tarpit: 'TarPit01.fbx',
  cliffs: 'Cliffs01.fbx',
  ruins: 'PreWarRuins01.fbx',
  crater: 'ToxicCrater01.fbx',
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
  settlement: { yaw: 0, fit: 'Village_HiveCity' },
};

const MODEL_URL = '/models/blockouts/';
// Bump when a model file is re-exported under the same name, so browsers drop the cached copy.
const MODEL_VERSION = '20261027-1729';
const ATLAS_URL = '/models/Atlas.jpg?v=20261026-1640';
// Footprints measure about 96 × 97 cm. One board cell is 1 unit across.
const CELL = 0.97;

export function hasBlockout(terrain) {
  return Object.prototype.hasOwnProperty.call(BLOCKOUTS, terrain);
}

// Default camera sits on +z. Negative yaw turns the Maya blockouts toward screen-left.
function fitToCell(root, { yaw = -Math.PI / 2, fit = null } = {}) {
  root.rotation.y = yaw;
  root.scale.set(1, 1, 1);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const target = (fit && root.getObjectByName(fit)) || root;
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1e-4);
  const scale = CELL / span;
  root.scale.setScalar(scale);
  // Base on the cell (y = 0), footprint centred. Measured after the yaw,
  // so the Maya pivot offset does not leave the building in the air.
  root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
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

/** Loads every blockout once. Rejects only if the atlas or a file is missing. */
export async function loadBlockouts() {
  const loader = new FBXLoader();
  // Wait for the atlas image. The FBX loader does not attach it itself.
  const atlas = await new THREE.TextureLoader().loadAsync(ATLAS_URL);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = true;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.anisotropy = 8;

  const jobs = Object.entries(BLOCKOUTS).map(async ([terrain, file]) => {
    const raw = await loader.loadAsync(`${MODEL_URL}${file}?v=${MODEL_VERSION}`);
    const finished = FINISHED[terrain];
    if (finished) {
      toStandard(raw);
      // Object3D.clone copies `animations`, so every tile copy can play them.
      raw.animations = raw.animations.map(movingTracksOnly).filter((clip) => clip.tracks.length);
      fitToCell(raw, finished);
    } else {
      applyAtlas(raw, atlas);
      raw.animations = [];
      fitToCell(raw);
    }
    raw.name = terrain;
    return [terrain, raw];
  });

  return Promise.all(jobs).then((pairs) => new Map(pairs));
}
