import * as THREE from 'three';
import { hasBlockout, loadBlockouts } from './models.js';

/**
 * Desert dieselpunk tile set. Flat colours only for now, detail comes later.
 *
 * category:  'building' (part of the economy), 'land' (terrain with an effect), 'junk' (clogs the hand)
 * buildable: true if a building piece may later be placed on top of this tile
 * weight:    relative draw weight in the hand (0 = never drawn)
 * rule:      short text shown on the hand card
 * stats:     data for the future economy pass (not calculated yet)
 */
export const TERRAINS = {
  // ---- buildings ----
  capital: {
    name: 'Capital',
    top: 0x8a8f96,
    edge: 0x5f646b,
    category: 'building',
    buildable: false,
    weight: 0, // only the starting tile
    rule: '-3 food · +4 manpower',
    stats: { food: -3, manpower: 4 },
  },
  settlement: {
    name: 'Settlement',
    top: 0xa0643c,
    edge: 0x74452a,
    category: 'building',
    buildable: false,
    weight: 2,
    rule: '-1 food · +2 manpower',
    stats: { food: -1, manpower: 2, ruinsBonusManpower: 1 },
  },
  farm: {
    name: 'Hydro-farm',
    top: 0x6fae4a,
    edge: 0x4d7f32,
    category: 'building',
    buildable: false,
    weight: 3,
    rule: '-1 manpower · +2 food, +2 by a pump',
    stats: { manpower: -1, food: 2, adjacent: { pump: { food: 2 } } },
  },
  pump: {
    name: 'Water Pump',
    top: 0x3f8fc0,
    edge: 0x2b6890,
    category: 'building',
    buildable: false,
    weight: 1,
    rule: 'No cost · boosts adjacent farms',
    stats: {},
  },
  station: {
    name: 'Oil Station',
    top: 0x3a3a3a,
    edge: 0x222222,
    category: 'building',
    buildable: false,
    weight: 3,
    rule: '-1 manpower · +2 oil',
    stats: { manpower: -1, oil: 2, adjacent: { tarpit: { oil: 2 } } },
  },
  refinery: {
    name: 'Refinery',
    top: 0xd0782a,
    edge: 0x99551b,
    category: 'building',
    buildable: false,
    weight: 1,
    rule: '-2 manpower · +0.5× per adj. station',
    stats: { manpower: -2, oilMultiplierPerAdjacent: { station: 0.5 } },
  },

  // ---- wasteland (4 cosmetic variants, share one draw weight: 4 × 1.34 ≈ 30% of draws) ----
  wasteland1: {
    name: 'Wasteland',
    top: 0xd8bf8a,
    edge: 0xae9564,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'Junk · must be placed · never built on',
    stats: {},
  },
  wasteland2: {
    name: 'Wasteland',
    top: 0xcfb27a,
    edge: 0xa58a56,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'Junk · must be placed · never built on',
    stats: {},
  },
  wasteland3: {
    name: 'Wasteland',
    top: 0xc9a86c,
    edge: 0x9e804a,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'Junk · must be placed · never built on',
    stats: {},
  },
  wasteland4: {
    name: 'Wasteland',
    top: 0xdcc79a,
    edge: 0xb19f72,
    category: 'junk',
    buildable: false,
    weight: 1.34,
    rule: 'Junk · must be placed · never built on',
    stats: {},
  },

  // ---- land ----
  oasis: {
    name: 'Oasis',
    top: 0x3fbfae,
    edge: 0x2a8f82,
    category: 'land',
    buildable: false,
    weight: 0.5,
    rule: 'Adjacent farms +3 food',
    stats: { adjacentBonus: { farm: { food: 3 } } },
  },
  tarpit: {
    name: 'Tar Pit',
    top: 0x2a1f2e,
    edge: 0x170f1a,
    category: 'land',
    buildable: false,
    weight: 0.5,
    rule: 'Adjacent oil stations +2 oil',
    stats: { adjacentBonus: { station: { oil: 2 } } }, // +2 total, not stacked
  },
  cliffs: {
    name: 'Cliffs',
    top: 0x8c4a32,
    edge: 0x633322,
    category: 'junk',
    buildable: false,
    weight: 0.75,
    rule: 'Junk · can never be built on',
    stats: {},
  },
  ruins: {
    name: 'Pre-war Ruins',
    top: 0x9a9284,
    edge: 0x6f685c,
    category: 'land',
    buildable: true,
    weight: 0.75,
    rule: 'Build on: +1 manpower (+2 settlement)',
    stats: { builtOnBonus: { manpower: 1 } }, // permanent, any building
  },
  crater: {
    name: 'Toxic Crater',
    top: 0x9acd32,
    edge: 0x6e9420,
    category: 'junk',
    buildable: false,
    weight: 0, // only created by the overlord
    rule: '-1 manpower, -1 food per adj. farm/settlement',
    stats: { adjacentPenalty: { farm: { manpower: -1, food: -1 }, settlement: { manpower: -1, food: -1 } } },
  },
};
export const TERRAIN_KEYS = Object.keys(TERRAINS);

export const isBuilding = (terrain) => TERRAINS[terrain]?.category === 'building';

export const TILE = {
  gap: 0.03, // tiny seam so individual tiles stay readable
  capH: 0.12, // coloured terrain layer
  soilH: 0.5, // dark earth underneath
};

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Builds tile meshes. Building terrains use the blockout FBX once it has
 * loaded; everything else stays a coloured soil block.
 */
export class TileFactory {
  /** @type {Map<string, THREE.Object3D> | null} */
  models = null;
  ready;

  constructor() {
    const s = 1 - TILE.gap;
    this.capGeo = new THREE.BoxGeometry(s, TILE.capH, s).translate(0, -TILE.capH / 2, 0);
    this.soilGeo = new THREE.BoxGeometry(s, TILE.soilH, s).translate(0, -TILE.capH - TILE.soilH / 2, 0);
    this.soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 });
    this.capMats = {};
    for (const [k, t] of Object.entries(TERRAINS)) {
      const top = new THREE.MeshStandardMaterial({ color: t.top, roughness: 0.95 });
      const edge = new THREE.MeshStandardMaterial({ color: t.edge, roughness: 0.95 });
      // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
      this.capMats[k] = [edge, edge, top, edge, edge, edge];
    }
    this.ready = loadBlockouts()
      .then((models) => {
        this.models = models;
      })
      .catch((error) => {
        console.error('Blockout models failed to load; coloured blocks stay in place.', error);
      });
  }

  /** Flat stand-in used for land, junk, and buildings before the FBX arrives. */
  #block(terrain) {
    const group = new THREE.Group();
    const soil = new THREE.Mesh(this.soilGeo, this.soilMat);
    const cap = new THREE.Mesh(this.capGeo, this.capMats[terrain]);
    for (const mesh of [soil, cap]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(soil, cap);
    return group;
  }

  create(terrain) {
    const source = this.models?.get(terrain);
    if (!source) return this.#block(terrain);
    // The fitted model keeps its own offset. A holder takes the cell position
    // so placing or animating the tile does not undo that fit.
    const holder = new THREE.Group();
    holder.add(source.clone(true));
    holder.userData.blockout = true;
    return holder;
  }

  /** Transparent copy for the placement ghost. Materials are not shared. */
  preview(terrain) {
    const mesh = this.create(terrain);
    mesh.traverse((obj) => {
      if (!obj.isMesh) return;
      const material = obj.material.clone();
      material.transparent = true;
      material.opacity = 0.86;
      material.depthWrite = false;
      material.userData.base = material.color.clone();
      obj.material = material;
      obj.castShadow = true;
    });
    return mesh;
  }

  /** Swap a placed flat block for its blockout, keeping the board transform. */
  upgrade(mesh, terrain) {
    if (!hasBlockout(terrain) || !this.models?.has(terrain)) return mesh;
    if (mesh.userData.blockout) return mesh;
    const next = this.create(terrain);
    next.position.copy(mesh.position);
    next.scale.copy(mesh.scale);
    next.visible = mesh.visible;
    next.userData.blockout = true;
    mesh.parent?.add(next);
    mesh.removeFromParent();
    return next;
  }
}
