import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * Blockout buildings. Maya exports these in centimetres with the mesh pivot
 * up in the air, and tags the atlas as Maya|baseColor, which FBXLoader skips.
 * Fit each one to a single board cell and put Atlas.jpg on the material.
 */
export const BLOCKOUTS = {
  capital: 'Capital01.fbx',
  settlement: 'Settlement01.fbx',
  farm: 'HydroFarm01.fbx',
  pump: 'WaterPump01.fbx',
  station: 'OilStation01.fbx',
  refinery: 'Refinary01.fbx',
};

const MODEL_URL = '/models/blockouts/';
const ATLAS_URL = '/models/Atlas.jpg';
// Footprints measure about 96 × 97 cm. One board cell is 1 unit across.
const CELL = 0.97;

export function hasBlockout(terrain) {
  return Object.prototype.hasOwnProperty.call(BLOCKOUTS, terrain);
}

function fitToCell(root) {
  // Default camera sits on +z. Negative yaw turns the model toward screen-left.
  root.rotation.y = -Math.PI / 2;
  root.scale.set(1, 1, 1);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
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
    const raw = await loader.loadAsync(`${MODEL_URL}${file}`);
    applyAtlas(raw, atlas);
    fitToCell(raw);
    raw.name = terrain;
    return [terrain, raw];
  });

  return Promise.all(jobs).then((pairs) => new Map(pairs));
}
