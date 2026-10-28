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
  settlement: 'Village02City01.fbx',
  farm: 'HydroFarmCity01.fbx',
  pump: 'WaterPump01.fbx',
  station: 'OilStationCity01.fbx',
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
  station: { yaw: 0, fit: 'OilStation_HiveCity' },
  farm: { yaw: 0, fit: 'HydroFarm_HiveCity' },
  settlement: { yaw: 0, fit: 'Village02_HiveCity' },
};

const MODEL_URL = '/models/blockouts/';
// Bump when a model file is re-exported under the same name, so browsers drop the cached copy.
const MODEL_VERSION = '20261028-1419';
const ATLAS_URL = '/models/Atlas.jpg?v=20261026-1640';
// Footprints measure about 96 × 97 cm. One board cell is 1 unit across.
const CELL = 0.97;

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
  const target = (fit && root.getObjectByName(fit)) || root;
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 1e-4);
  const scale = CELL / span;
  root.scale.setScalar(scale);
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
export async function loadBlockouts() {
  const loader = new FBXLoader();
  // Wait for the atlas image. The FBX loader does not attach it itself.
  const atlas = await new THREE.TextureLoader().loadAsync(ATLAS_URL);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = true;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.anisotropy = 8;

  const jobs = Object.entries(BLOCKOUTS).map(async ([terrain, file]) => {
    const raw = await loader.loadAsync(`${MODEL_URL}${file}?v=${MODEL_VERSION}`, (e) => trackBytes(file, e));
    const finished = FINISHED[terrain];
    if (finished) {
      toStandard(raw);
      // Object3D.clone copies `animations`, so every tile copy can play them.
      raw.animations = raw.animations.map(movingTracksOnly).filter((clip) => clip.tracks.length);
      fitToCell(raw, { ground: 0, ...finished });
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
const TILE_GAP = 0.03; // same seam as single tiles (CELL = 1 - gap)

/** Scale a piece model to its cells (keeping the seam at its outer edge) and centre its footprint on the origin. */
function fitPiece(raw, base) {
  raw.position.set(0, 0, 0);
  raw.rotation.set(0, 0, 0);
  raw.scale.set(1, 1, 1);
  raw.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(base);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const w = Math.max(1, Math.round(size.x / BLENDER_CELL));
  const h = Math.max(1, Math.round(size.z / BLENDER_CELL));
  const sx = (w - TILE_GAP) / size.x;
  const sz = (h - TILE_GAP) / size.z;
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
 * The piece files each embed their own copy of the shared art (rock, sand, salt, worm skin...). Textures with
 * identical pixels and settings are merged, so each one is decoded onto the GPU once instead of up to 11 times.
 * Pixels are compared through a 32 × 32 thumbnail plus the full size.
 */
async function shareTextures(roots) {
  const slots = [];
  for (const root of roots) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) {
        for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k]) slots.push([m, k]);
      }
    });
  }
  const unique = [...new Set(slots.map(([m, k]) => m[k]))];
  await Promise.all(unique.map((t) => imageReady(t)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const firstBySig = new Map();
  const keep = new Map(); // texture -> texture to use instead
  for (const t of unique) {
    const img = t.image;
    if (!img?.width) {
      keep.set(t, t);
      continue;
    }
    ctx.clearRect(0, 0, 32, 32);
    ctx.drawImage(img, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    let hash = 2166136261;
    for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 16777619);
    const sig = [img.width, img.height, t.colorSpace, t.wrapS, t.wrapT, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, hash >>> 0].join('|');
    const first = firstBySig.get(sig);
    if (first) keep.set(t, first);
    else {
      firstBySig.set(sig, t);
      keep.set(t, t);
    }
  }
  for (const [m, k] of slots) {
    const use = keep.get(m[k]);
    if (use && use !== m[k]) {
      m[k] = use;
      m.needsUpdate = true;
    }
  }
  let merged = 0;
  for (const [t, use] of keep) {
    if (t === use) continue;
    t.dispose();
    merged++;
  }
  return { textures: unique.length, merged };
}

/**
 * Loads every Wasteland piece model, one file at a time with a pause in between, so it can run in the
 * background (each file blocks the page for about a quarter of a second while it parses).
 * Resolves to a Map: shape key -> fitted model.
 */
export async function loadWastePieces() {
  const loader = new FBXLoader();
  const pieces = new Map();
  for (const [shape, name] of Object.entries(WASTE_PIECES)) {
    const raw = await loader.loadAsync(`${MODEL_URL}Waste${name}City01.fbx?v=${MODEL_VERSION}`);
    toStandard(raw);
    raw.animations = raw.animations.map(movingTracksOnly).filter((clip) => clip.tracks.length);
    fitPiece(raw, raw.getObjectByName(`Waste${name}_HiveCity`) ?? raw);
    raw.name = `waste-${shape}`;
    pieces.set(shape, raw);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const { textures, merged } = await shareTextures([...pieces.values()]);
  console.info(`Wasteland pieces: ${pieces.size} models, ${textures - merged} textures (${merged} duplicates shared).`);
  for (const [shape, raw] of pieces) matchSaltToSand(raw, WASTE_PIECES[shape]);
  return pieces;
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
function matchSaltToSand(raw, name) {
  const ground = raw.getObjectByName(`Waste${name}_Ground`);
  const groundMap = [ground?.material].flat()[0]?.map;
  const img = groundMap?.image;
  if (!img?.width) return;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const smooth = (a, b, v) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  // How salty a pixel is: pale and unsaturated. Sand reference: the clearly tan pixels.
  const weight = new Float32Array(px.length / 4);
  const sand = [0, 0, 0];
  let sandN = 0;
  let saltLum = 0;
  let saltW = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const w = (1 - smooth(0.1, 0.22, sat)) * smooth(0.25, 0.45, lum);
    weight[j] = w;
    if (w > 0.5) {
      saltLum += lum;
      saltW++;
    } else if (sat > 0.25) {
      sand[0] += r;
      sand[1] += g;
      sand[2] += b;
      sandN++;
    }
  }
  if (!sandN) return;
  const ref = sand.map((v) => v / sandN);
  const share = saltW / weight.length;
  if (share > 0.02) {
    const meanLum = saltLum / saltW;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const w = weight[j];
      if (w <= 0) continue;
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const k = lum / meanLum;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - w) + Math.min(1, ref[c] * k) * 255 * w);
    }
    ctx.putImageData(data, 0, 0);
    groundMap.image = canvas;
    groundMap.needsUpdate = true;
  }
  // The separate salt part: tinted so its texture averages out at the same sand colour (linear RGB).
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const sandLin = ref.map(toLinear);
  raw.traverse((obj) => {
    if (!obj.isMesh || obj.name !== `Waste${name}_Salt`) return;
    const recolour = (m) => {
      const salt = averageLinear(m.map);
      if (!salt) return m;
      const tinted = m.clone();
      tinted.color.setRGB(...sandLin.map((v, c) => Math.min(1, v / Math.max(salt[c], 1e-4))));
      return tinted;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(recolour) : recolour(obj.material);
  });
  if (share > 0.02) console.info(`Wasteland ${name}: salt recoloured to sand (${Math.round(share * 100)}% of the ground).`);
}
