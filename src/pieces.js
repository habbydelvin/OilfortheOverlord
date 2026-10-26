import { TERRAIN_KEYS } from './tiles.js';

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
const TOTAL_WEIGHT = SHAPE_KEYS.reduce((s, k) => s + SHAPES[k].weight, 0);

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

export function randomPiece() {
  let r = Math.random() * TOTAL_WEIGHT;
  let shape = SHAPE_KEYS[0];
  for (const k of SHAPE_KEYS) {
    r -= SHAPES[k].weight;
    if (r <= 0) {
      shape = k;
      break;
    }
  }
  const terrain = TERRAIN_KEYS[Math.floor(Math.random() * TERRAIN_KEYS.length)];
  return { id: nextId++, shape, terrain, rot: Math.floor(Math.random() * 4) };
}
