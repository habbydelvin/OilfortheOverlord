import { TERRAINS, TERRAIN_KEYS } from './tiles.js';

const DRAWABLE = TERRAIN_KEYS.filter((k) => TERRAINS[k].weight > 0);

/** Weighted tile pick. `exclude`: tile keys that can't be drawn right now (e.g. no cliffs in round 1). */
function randomTerrain(exclude = []) {
  const pool = DRAWABLE.filter((k) => !exclude.includes(k));
  let r = Math.random() * pool.reduce((s, k) => s + TERRAINS[k].weight, 0);
  for (const k of pool) {
    r -= TERRAINS[k].weight;
    if (r <= 0) return k;
  }
  return pool[pool.length - 1];
}

/**
 * Piece shapes as [x, z] cells (x = right, z = down on screen at default camera).
 * Weights bias the random draw toward tetrominoes.
 */
export const SHAPES = {
  mono: { name: 'Single', weight: 1, cells: [[0, 0]] },
  domino: { name: 'Pair', weight: 2, cells: [[0, 0], [1, 0]] },
  i3: { name: 'Line 3', weight: 2, cells: [[0, 0], [1, 0], [2, 0]] },
  v3: { name: 'Corner', weight: 2, cells: [[0, 0], [1, 0], [0, 1]] },
  i4: { name: 'I-piece', weight: 3, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  o: { name: 'O-piece', weight: 3, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  t: { name: 'T-piece', weight: 3, cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  s: { name: 'S-piece', weight: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  z: { name: 'Z-piece', weight: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  l: { name: 'L-piece', weight: 3, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  j: { name: 'J-piece', weight: 3, cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
};

const SHAPE_KEYS = Object.keys(SHAPES);

function normalize(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minZ = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, z]) => [x - minX, z - minZ]);
}

/** Rotate clockwise (as seen from above) `rot` quarter turns, normalized to start at 0,0. */
export function rotateCells(cells, rot) {
  let out = cells.map(([x, z]) => [x, z]);
  const turns = ((rot % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) out = out.map(([x, z]) => [-z, x]);
  return normalize(out);
}

/**
 * Cell offsets relative to the pivot cell (the cell nearest the piece's centre),
 * so the cursor sits in the middle of the piece and rotation doesn't jump around.
 */
export function pieceOffsets(piece) {
  const cells = rotateCells(SHAPES[piece.shape].cells, piece.rot);
  const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  let pivot = cells[0];
  let best = Infinity;
  for (const c of cells) {
    const d = (c[0] - cx) ** 2 + (c[1] - cz) ** 2;
    if (d < best - 1e-6) {
      best = d;
      pivot = c;
    }
  }
  return cells.map(([x, z]) => [x - pivot[0], z - pivot[1]]);
}

let nextId = 1;

function randomShape(fits) {
  const keys = fits ? SHAPE_KEYS.filter(fits) : SHAPE_KEYS;
  if (!keys.length) return 'mono';
  let r = Math.random() * keys.reduce((s, k) => s + SHAPES[k].weight, 0);
  for (const k of keys) {
    r -= SHAPES[k].weight;
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

/**
 * True if a junk/land shape can be placed somewhere right now: in some rotation, every cell is
 * empty and inside the territory, and at least one cell touches existing land.
 */
export function shapeFits(grid, shapeKey) {
  const empty = grid.emptyTerritoryKeys();
  if (empty.size < SHAPES[shapeKey].cells.length) return false;
  const free = (x, z) => empty.has(`${x},${z}`);
  for (let rot = 0; rot < 4; rot++) {
    const cells = rotateCells(SHAPES[shapeKey].cells, rot);
    for (const k of empty) {
      const [ax, az] = k.split(',').map(Number);
      // Try each cell of the shape on this empty cell.
      for (const [cx, cz] of cells) {
        const placed = cells.map(([x, z]) => [ax + x - cx, az + z - cz]);
        if (placed.every(([x, z]) => free(x, z)) && placed.some(([x, z]) => grid.touchesIsland(x, z))) return true;
      }
    }
  }
  return false;
}

/**
 * Only Wasteland comes in multi-block shapes; every other tile is a single block.
 * `grid` (optional) limits Wasteland to shapes that fit in the space you have left.
 */
export function randomPiece(grid = null, exclude = []) {
  const terrain = randomTerrain(exclude);
  const shape = terrain.startsWith('wasteland') ? randomShape(grid && ((k) => shapeFits(grid, k))) : 'mono';
  return { id: nextId++, shape, terrain, rot: Math.floor(Math.random() * 4) };
}
