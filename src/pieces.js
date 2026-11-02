import { ACTIONS, TERRAINS, TERRAIN_KEYS, cardDef } from './tiles.js';
import { hexToWorld, rotateHex } from './grid.js';

/** A piece turns in sixths: 6 rotations. */
export const ROTATIONS = 6;

// Tiles plus action cards with a draw weight.
const DRAWABLE = [...TERRAIN_KEYS, ...Object.keys(ACTIONS)].filter((k) => (cardDef(k).weight ?? 0) > 0);

/** Weighted tile pick. `exclude`: tile keys that can't be drawn right now (e.g. no cliffs in round 1). */
function randomTerrain(exclude = []) {
  const pool = DRAWABLE.filter((k) => !exclude.includes(k));
  let r = Math.random() * pool.reduce((s, k) => s + cardDef(k).weight, 0);
  for (const k of pool) {
    r -= cardDef(k).weight;
    if (r <= 0) return k;
  }
  return pool[pool.length - 1];
}

/**
 * Piece shapes: every shape of 1 to 4 hexagons (as hex cells [x, z], see grid.js). Pieces only turn, they don't flip,
 * so mirror images are shapes of their own. Weights bias the random draw toward the 4-hex shapes, as the old Tetris
 * pieces did (singles 1, pairs 2, triples 4 in all, 4-hex shapes 21 in all).
 */
const W3 = 4 / 3;
const W4 = 2.1;
export const SHAPES = {
  mono: { name: 'Single', weight: 1, cells: [[0, 0]] },
  pair: { name: 'Pair', weight: 2, cells: [[0, 0], [1, 0]] },
  line3: { name: 'Line 3', weight: W3, cells: [[0, 0], [1, 0], [2, 0]] },
  bend3: { name: 'Bend', weight: W3, cells: [[0, 0], [0, 1], [1, 1]] },
  tri3: { name: 'Triangle', weight: W3, cells: [[0, 0], [1, 0], [0, 1]] },
  bar: { name: 'Bar', weight: W4, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  diamond: { name: 'Diamond', weight: W4, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  propeller: { name: 'Propeller', weight: W4, cells: [[1, 0], [1, 1], [2, 1], [0, 2]] },
  arch: { name: 'Arch', weight: W4, cells: [[0, 0], [1, 0], [1, 1], [0, 2]] },
  pistol: { name: 'Pistol', weight: W4, cells: [[0, 0], [1, 0], [0, 1], [0, 2]] },
  pistolM: { name: 'Pistol (mirrored)', weight: W4, cells: [[0, 0], [0, 1], [1, 1], [0, 2]] },
  zigzag: { name: 'Zigzag', weight: W4, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  zigzagM: { name: 'Zigzag (mirrored)', weight: W4, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  hook: { name: 'Hook', weight: W4, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  hookM: { name: 'Hook (mirrored)', weight: W4, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
};

const SHAPE_KEYS = Object.keys(SHAPES);

/** Shift cells so the smallest x and z are 0 (and drop -0). */
function normalize(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minZ = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, z]) => [x - minX + 0, z - minZ + 0]);
}

/** Rotate clockwise (as seen from above) `rot` sixths of a turn, normalized to start at 0,0. */
export function rotateCells(cells, rot) {
  return normalize(cells.map((c) => rotateHex(c, rot)));
}

/**
 * Cell offsets relative to the pivot cell (the cell nearest the piece's centre, measured on the board),
 * so the cursor sits in the middle of the piece and rotation doesn't jump around.
 */
export function pieceOffsets(piece) {
  const cells = rotateCells(SHAPES[piece.shape].cells, piece.rot);
  const world = cells.map(([x, z]) => hexToWorld(x, z));
  const cx = world.reduce((s, w) => s + w.x, 0) / cells.length;
  const cz = world.reduce((s, w) => s + w.z, 0) / cells.length;
  let pivot = cells[0];
  let best = Infinity;
  cells.forEach((c, i) => {
    const d = (world[i].x - cx) ** 2 + (world[i].z - cz) ** 2;
    if (d < best - 1e-6) {
      best = d;
      pivot = c;
    }
  });
  return cells.map(([x, z]) => [x - pivot[0] + 0, z - pivot[1] + 0]);
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
 * empty and at least one cell touches existing land. The board has no edge, so this is almost always true.
 */
export function shapeFits(grid, shapeKey) {
  const free = (x, z) => !grid.has(x, z) && grid.allowed(x, z);
  for (let rot = 0; rot < ROTATIONS; rot++) {
    const cells = rotateCells(SHAPES[shapeKey].cells, rot);
    for (const k of grid.openKeys()) {
      const [ax, az] = k.split(',').map(Number);
      // Try each cell of the shape on this frontier cell.
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
/** A single-tile piece of a given terrain (e.g. a card bought in the shop). */
export function pieceOf(terrain) {
  return { id: nextId++, shape: 'mono', terrain, rot: 0 };
}

export function randomPiece(grid = null, exclude = []) {
  const terrain = randomTerrain(exclude);
  const shape = terrain.startsWith('wasteland') ? randomShape(grid && ((k) => shapeFits(grid, k))) : 'mono';
  return { id: nextId++, shape, terrain, rot: Math.floor(Math.random() * ROTATIONS) };
}
