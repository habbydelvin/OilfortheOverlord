import * as THREE from 'three';

/** Placeholder terrains: flat colours only, detail comes later. */
export const TERRAINS = {
  meadow: { name: 'Meadow', top: 0x93ad5c, edge: 0x6c8742 },
  field: { name: 'Field', top: 0xcfa75b, edge: 0x9f7d3d },
  forest: { name: 'Forest', top: 0x3f6a3c, edge: 0x2c4c2c },
  village: { name: 'Village', top: 0xb5835c, edge: 0x875f40 },
  water: { name: 'Water', top: 0x4d8aa6, edge: 0x376a81 },
};
export const TERRAIN_KEYS = Object.keys(TERRAINS);

export const TILE = {
  gap: 0.03, // tiny seam so individual tiles stay readable
  capH: 0.12, // coloured terrain layer
  soilH: 0.5, // dark earth underneath
};

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Builds tile meshes (terrain cap + soil block) sharing geometry and materials. */
export class TileFactory {
  constructor() {
    const s = 1 - TILE.gap;
    this.capGeo = new THREE.BoxGeometry(s, TILE.capH, s).translate(0, -TILE.capH / 2, 0);
    this.soilGeo = new THREE.BoxGeometry(s, TILE.soilH, s).translate(0, -TILE.capH - TILE.soilH / 2, 0);
    this.soilMat = new THREE.MeshStandardMaterial({ color: 0x3b302a, roughness: 1 });
    this.capMats = {};
    for (const [k, t] of Object.entries(TERRAINS)) {
      const top = new THREE.MeshStandardMaterial({ color: t.top, roughness: 0.95 });
      const edge = new THREE.MeshStandardMaterial({ color: t.edge, roughness: 0.95 });
      // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
      this.capMats[k] = [edge, edge, top, edge, edge, edge];
    }
  }

  create(terrain) {
    const group = new THREE.Group();
    const soil = new THREE.Mesh(this.soilGeo, this.soilMat);
    const cap = new THREE.Mesh(this.capGeo, this.capMats[terrain]);
    for (const m of [soil, cap]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    group.add(soil, cap);
    return group;
  }
}
