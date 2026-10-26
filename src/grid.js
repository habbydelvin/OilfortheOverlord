export const key = (x, z) => `${x},${z}`;
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Territory is made of 3×3 plots. Plot (0,0) covers cells -1..1 on both axes,
 * so the capital at (0,0) sits in the middle of the starting plot.
 */
export const PLOT = 3;
export const plotOf = (v) => Math.floor((v + 1) / PLOT);
export const plotCenter = (p) => p * PLOT;

/** Sparse square grid. Each cell stores { x, z, terrain, mesh, onRuins }. */
export class Grid {
  cells = new Map();
  plots = new Set([key(0, 0)]);

  has(x, z) {
    return this.cells.has(key(x, z));
  }

  get(x, z) {
    return this.cells.get(key(x, z));
  }

  set(x, z, data) {
    this.cells.set(key(x, z), { x, z, ...data });
  }

  clear() {
    this.cells.clear();
    this.plots = new Set([key(0, 0)]);
  }

  get size() {
    return this.cells.size;
  }

  // ---------- territory ----------

  /** True if the cell lies inside an unlocked plot. */
  inTerritory(x, z) {
    return this.plots.has(key(plotOf(x), plotOf(z)));
  }

  get capacity() {
    return this.plots.size * PLOT * PLOT;
  }

  unlock(px, pz) {
    this.plots.add(key(px, pz));
  }

  /** Empty cells inside the territory (where pieces can go). */
  emptyTerritoryKeys() {
    const out = new Set();
    for (const k of this.plots) {
      const [px, pz] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const x = plotCenter(px) + dx;
          const z = plotCenter(pz) + dz;
          if (!this.has(x, z)) out.add(key(x, z));
        }
      }
    }
    return out;
  }

  isFull() {
    return this.emptyTerritoryKeys().size === 0;
  }

  /** Locked plots sharing a side with the territory: the expansion choices. */
  expansionOptions() {
    const out = new Set();
    for (const k of this.plots) {
      const [px, pz] = k.split(',').map(Number);
      for (const [dx, dz] of DIRS) {
        const n = key(px + dx, pz + dz);
        if (!this.plots.has(n)) out.add(n);
      }
    }
    return out;
  }

  territoryCenter() {
    let sx = 0;
    let sz = 0;
    for (const k of this.plots) {
      const [px, pz] = k.split(',').map(Number);
      sx += plotCenter(px);
      sz += plotCenter(pz);
    }
    return [sx / this.plots.size, sz / this.plots.size];
  }

  // ---------- adjacency ----------

  /** True if an empty cell touches the island on any orthogonal side. */
  touchesIsland(x, z) {
    return DIRS.some(([dx, dz]) => this.has(x + dx, z + dz));
  }

  centroid() {
    let sx = 0;
    let sz = 0;
    for (const { x, z } of this.cells.values()) {
      sx += x;
      sz += z;
    }
    const n = this.cells.size || 1;
    return [sx / n, sz / n];
  }
}
