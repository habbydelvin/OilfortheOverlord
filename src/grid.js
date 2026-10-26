export const key = (x, z) => `${x},${z}`;
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Sparse, unbounded square grid. Each cell stores { x, z, terrain, mesh }. */
export class Grid {
  cells = new Map();

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
  }

  get size() {
    return this.cells.size;
  }

  /** True if an empty cell touches the island on any orthogonal side. */
  touchesIsland(x, z) {
    return DIRS.some(([dx, dz]) => this.has(x + dx, z + dz));
  }

  /** All empty cells orthogonally adjacent to the island. */
  frontierKeys() {
    const out = new Set();
    for (const { x, z } of this.cells.values()) {
      for (const [dx, dz] of DIRS) {
        if (!this.has(x + dx, z + dz)) out.add(key(x + dx, z + dz));
      }
    }
    return out;
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
