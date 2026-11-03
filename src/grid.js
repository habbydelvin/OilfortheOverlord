/**
 * The board: pointy-top hexagons in axial coordinates. A cell is (x, z): x runs along a row (to the right on screen),
 * z counts rows (down the screen at the default camera). Rows are offset by half a cell, so cell (x, z) sits at
 * world position hexToWorld(x, z); neighbouring cells are 1 world unit apart (flat side to flat side).
 *
 * Grid coordinates are only ever integers (cell keys, adjacency, pieces); anything placed in the 3D scene or projected
 * to the screen converts them with hexToWorld first.
 */
export const key = (x, z) => `${x},${z}`;

/** The 6 neighbours: right, left, down-right, up-left, up-right, down-left. */
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

/** Hexagon size: centre to corner (the flat-to-flat width is 1). */
export const HEX_RADIUS = 1 / Math.sqrt(3);
const ROW = Math.sqrt(3) / 2; // world distance between two rows

/** World position (x, z) of the centre of cell (x, z). Linear: a cell offset converts the same way. */
export function hexToWorld(x, z) {
  return { x: x + z / 2, z: z * ROW };
}

/** A number of its own for every cell (the same each time): which look a lone Wasteland cell gets. */
export function cellSeed(x, z) {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

/** World position (x, z) of the middle of a group of cells (a Wasteland piece's model is centred there). */
export function cellsCentre(cells) {
  let x = 0;
  let z = 0;
  for (const [cx, cz] of cells) {
    const w = hexToWorld(cx, cz);
    x += w.x / cells.length;
    z += w.z / cells.length;
  }
  return { x, z };
}

/** The cell containing world point (wx, wz). */
export function worldToHex(wx, wz) {
  const z = wz / ROW;
  return hexRound(wx - z / 2, z);
}

/** Round fractional axial coordinates to the nearest cell. */
export function hexRound(fx, fz) {
  const fy = -fx - fz;
  let x = Math.round(fx);
  let z = Math.round(fz);
  const y = Math.round(fy);
  const dx = Math.abs(x - fx);
  const dz = Math.abs(z - fz);
  const dy = Math.abs(y - fy);
  if (dx > dz && dx > dy) x = -z - y;
  else if (dz > dy) z = -x - y;
  return [x + 0, z + 0]; // + 0: no -0 keys
}

/** Steps between two cells. */
export function hexDistance(x0, z0, x1 = 0, z1 = 0) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  return (Math.abs(dx) + Math.abs(dz) + Math.abs(dx + dz)) / 2;
}

/** Every cell within `radius` steps of (x, z), the centre first. */
export function hexesAround(x, z, radius = 1) {
  const out = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = Math.max(-radius, -dx - radius); dz <= Math.min(radius, -dx + radius); dz++) out.push([x + dx, z + dz]);
  }
  return out.sort((a, b) => hexDistance(x, z, ...a) - hexDistance(x, z, ...b));
}

/**
 * Turn a cell offset `steps` sixths of a turn clockwise as seen from above (on screen: right -> down-right -> ...).
 */
export function rotateHex([x, z], steps) {
  let q = x;
  let r = z;
  for (let i = 0; i < (((steps % 6) + 6) % 6); i++) [q, r] = [-r, q + r];
  return [q + 0, r + 0];
}

/**
 * Plots: 7-cell "flowers" (a cell and its 6 neighbours) that tile the board. Plot (0, 0) is the Capital and its ring.
 * Plot coordinates are themselves a hex lattice: plot (a, b) is centred on cell a·(2, 1) + b·(-1, 3), and
 * neighbouring plots are 3 steps apart. PLOT is that spacing (for "how many plots fit in the world").
 * Free placement (default): plots only spread mystery sites; pieces go anywhere touching your land.
 * Expansion mode (debug toggle): placement is limited to unlocked plots, and a full territory offers neighbouring
 * plots to unlock.
 */
export const PLOT = 3;
/** Centre cell of plot (a, b). */
export const plotCenter = (a, b) => [2 * a - b, a + 3 * b];
/** The plot (a, b) containing cell (x, z). */
export function plotOf(x, z) {
  const fa = (3 * x + z) / 7;
  const fb = (2 * z - x) / 7;
  for (const a of [Math.floor(fa), Math.ceil(fa)]) {
    for (const b of [Math.floor(fb), Math.ceil(fb)]) {
      const [cx, cz] = plotCenter(a, b);
      if (hexDistance(x, z, cx, cz) <= 1) return [a + 0, b + 0];
    }
  }
  return [Math.round(fa) + 0, Math.round(fb) + 0]; // not reached: every cell is in a plot
}
/** The 7 cells of plot (a, b), its centre first. */
export const plotCells = (a, b) => hexesAround(...plotCenter(a, b), 1);
/** Steps between two plots, in plots. */
export const plotDistance = (a0, b0, a1 = 0, b1 = 0) => hexDistance(a0, b0, a1, b1);
/** The 6 plots around plot (a, b): its lattice neighbours. */
export const PLOT_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

/** Edge of the world: no cell more than WORLD_HALF steps from the Capital, and the camera stops there too. */
export const WORLD_HALF = 60;
export const inWorld = (x, z) => hexDistance(x, z) <= WORLD_HALF;

/** Sparse hex grid. Each cell stores { x, z, terrain, mesh, onRuins }. */
export class Grid {
  cells = new Map();
  plots = new Set([key(0, 0)]);
  expansionMode = false;

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

  /** Cells a piece may use right now: inside the world, and inside the territory in expansion mode. */
  allowed(x, z) {
    return inWorld(x, z) && (!this.expansionMode || this.inTerritory(x, z));
  }

  /** Empty cells you can build on: inside the territory (expansion mode) or next to your land. */
  openKeys() {
    return this.expansionMode ? this.emptyTerritoryKeys() : this.frontierKeys();
  }

  // ---------- territory (expansion mode) ----------

  /** True if the cell lies inside an unlocked plot. */
  inTerritory(x, z) {
    return this.plots.has(key(...plotOf(x, z)));
  }

  unlock(a, b) {
    this.plots.add(key(a, b));
  }

  /** Empty cells inside the territory. */
  emptyTerritoryKeys() {
    const out = new Set();
    for (const k of this.plots) {
      for (const [x, z] of plotCells(...k.split(',').map(Number))) if (!this.has(x, z)) out.add(key(x, z));
    }
    return out;
  }

  /** Runs every frame in expansion mode: stops at the first empty cell, builds no Set. */
  isFull() {
    for (const k of this.plots) {
      for (const [x, z] of plotCells(...k.split(',').map(Number))) if (!this.has(x, z)) return false;
    }
    return true;
  }

  /** Locked plots sharing a side with the territory: the expansion choices. */
  expansionOptions() {
    const out = new Set();
    for (const k of this.plots) {
      const [a, b] = k.split(',').map(Number);
      for (const [da, db] of PLOT_DIRS) {
        const n = key(a + da, b + db);
        if (!this.plots.has(n)) out.add(n);
      }
    }
    return out;
  }

  /** World position [x, z] of the middle of the territory (for the camera). */
  territoryCenter() {
    let sx = 0;
    let sz = 0;
    for (const k of this.plots) {
      const w = hexToWorld(...plotCenter(...k.split(',').map(Number)));
      sx += w.x;
      sz += w.z;
    }
    return [sx / this.plots.size, sz / this.plots.size];
  }

  // ---------- free placement ----------

  /** Empty cells that touch your land on a side: everywhere a piece can attach. */
  frontierKeys() {
    const out = new Set();
    for (const { x, z } of this.cells.values()) {
      for (const [dx, dz] of DIRS) {
        if (!this.has(x + dx, z + dz) && inWorld(x + dx, z + dz)) out.add(key(x + dx, z + dz));
      }
    }
    return out;
  }

  // ---------- adjacency ----------

  /** True if an empty cell touches the island on any side. */
  touchesIsland(x, z) {
    return DIRS.some(([dx, dz]) => this.has(x + dx, z + dz));
  }

  /** World position [x, z] of the middle of your land (for the camera). */
  centroid() {
    let sx = 0;
    let sz = 0;
    for (const { x, z } of this.cells.values()) {
      const w = hexToWorld(x, z);
      sx += w.x;
      sz += w.z;
    }
    const n = this.cells.size || 1;
    return [sx / n, sz / n];
  }
}
