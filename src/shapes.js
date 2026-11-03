// Wasteland piece shapes, on their own (no imports) so the model loader can match models to them (models.js).

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
