import { DIRS, key, hexDistance } from './grid.js';
import { TERRAINS } from './tiles.js';
import { SHAPES, ROTATIONS, rotateCells } from './pieces.js';
import { computeEconomy } from './economy.js';

/**
 * Rival city-states play the same game as the player, one hand per season: the same cards, piece shapes and
 * placement rules (inside the world, on empty cells, touching their land), with Wasteland that has to be placed.
 * No action cards, shop or mystery sites. Every roll comes from the rival's own seeded rng.
 *
 * Placing is greedy: Wasteland first (where it opens the most new room), then the building that adds the most
 * (computeEconomy before and after, weighed by personality), again and again until nothing in hand helps.
 */

export const HAND_SIZE = 5;
/** Same guaranteed opening hand as the player. */
const OPENING_HAND = ['farm', 'settlement', 'station', 'wasteland', 'wasteland'];
const WASTELAND = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4'];
const isWaste = (t) => t.startsWith('wasteland');

/** Shop cards that start locked for the player too; a rival unlocks one each year, in its own order. */
const LOCKED = ['pump', 'oasis', 'tarpit', 'labourcamp', 'refinery'];

/**
 * draw: extra draw weight per card (× the card's normal weight).
 * value: what a point of oil / food balance / spare manpower is worth when choosing where to build.
 * unlocks: the order it "buys" the locked cards, one per year.
 */
export const PERSONAS = {
  hawk: {
    draw: { settlement: 2.5, refinery: 2.5, station: 1.3 },
    value: { oil: 1.2, food: 0.45, manpower: 0.9 },
    unlocks: ['refinery', 'labourcamp', 'tarpit', 'pump', 'oasis'],
  },
  merchant: {
    draw: { station: 2.2, pump: 2, refinery: 1.8, tarpit: 2 },
    value: { oil: 1.4, food: 0.4, manpower: 0.7 },
    unlocks: ['pump', 'tarpit', 'refinery', 'oasis', 'labourcamp'],
  },
  paranoid: {
    draw: { farm: 2.2, settlement: 2, pump: 2, oasis: 2 },
    value: { oil: 0.9, food: 0.8, manpower: 0.9 },
    unlocks: ['pump', 'oasis', 'labourcamp', 'refinery', 'tarpit'],
  },
};

const persona = (rival) => PERSONAS[rival.def.personality] ?? PERSONAS.hawk;

function weighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Cards the rival may draw this season (no action cards; locked cards until it has "bought" them). */
function drawPool(rival) {
  const p = persona(rival);
  const owned = new Set(p.unlocks.slice(0, Math.max(0, rival.round - 1)));
  const out = [];
  for (const [k, def] of Object.entries(TERRAINS)) {
    if (!(def.weight > 0)) continue;
    if (LOCKED.includes(k) && !owned.has(k)) continue;
    if (k === 'cliffs' && rival.round === 1) continue;
    out.push([k, def.weight * (p.draw[k] ?? 1)]);
  }
  return out;
}

function makePiece(rival, terrain) {
  const rng = rival.rng;
  if (!isWaste(terrain)) return { shape: 'mono', terrain, rot: 0 };
  const shape = weighted(rng, Object.entries(SHAPES).map(([k, s]) => [k, s.weight]));
  return { shape, terrain: 'wasteland', rot: Math.floor(rng() * ROTATIONS) };
}

export function dealHand(rival, opening = false) {
  if (opening) return OPENING_HAND.map((t) => makePiece(rival, t));
  const pool = drawPool(rival);
  return Array.from({ length: HAND_SIZE }, () => makePiece(rival, weighted(rival.rng, pool)));
}

// ---------- legal placements ----------

/** The same rules as Placement.validate for a tile piece in free mode. */
export function isLegal(grid, cells) {
  if (cells.some(([x, z]) => !grid.allowed(x, z) || grid.has(x, z))) return false;
  return cells.some(([x, z]) => grid.touchesIsland(x, z));
}

/** Every distinct legal footprint of a shape, in every rotation: [{ rot, cells }]. */
function footprints(grid, shape) {
  const out = [];
  const seen = new Set();
  const open = [...grid.frontierKeys()].map((k) => k.split(',').map(Number));
  const turns = shape === 'mono' ? 1 : ROTATIONS;
  for (let rot = 0; rot < turns; rot++) {
    const cells = rotateCells(SHAPES[shape].cells, rot);
    for (const [ax, az] of open) {
      for (const [cx, cz] of cells) {
        const placed = cells.map(([x, z]) => [ax + x - cx, az + z - cz]);
        const id = `${rot}|${placed.map(([x, z]) => key(x, z)).sort().join(';')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (isLegal(grid, placed)) out.push({ rot, cells: placed });
      }
    }
  }
  return out;
}

// ---------- scoring ----------

/** What the city is worth to this rival right now (one season of the economy), and how many buildings sit idle. */
function worth(rival, grid) {
  const v = persona(rival).value;
  const e = computeEconomy(grid, { foodStore: rival.foodStore });
  const value = v.oil * e.oilMade + v.food * Math.max(-12, Math.min(6, e.foodBalance)) + v.manpower * Math.min(3, Math.max(0, e.free));
  return { value, idle: e.idle, fed: e.fed };
}

const BUILD_BONUS = 0.8;

const CORE = new Set(['capital', 'farm', 'station', 'refinery', 'settlement', 'pump', 'oasis', 'tarpit', 'labourcamp']);

/**
 * Wasteland: open new room at the edge (more frontier), keep the city together, and don't bury the good
 * cells (next to the Capital or next to buildings, where boosts land).
 */
function wasteScore(grid, frontier, cells, rng) {
  const mine = new Set(cells.map(([x, z]) => key(x, z)));
  const added = new Set();
  let gain = 0;
  let buried = 0;
  let dist = 0;
  let hug = 0;
  for (const [x, z] of cells) {
    if (frontier.has(key(x, z))) gain--; // no longer open
    dist += hexDistance(x, z);
    for (const [dx, dz] of DIRS) {
      const n = grid.get(x + dx, z + dz);
      if (n) hug++;
      if (n?.terrain === 'capital') buried += 4;
      else if (n && CORE.has(n.terrain)) buried += 1;
      const k = key(x + dx, z + dz);
      if (!n && !mine.has(k) && !frontier.has(k) && !added.has(k) && grid.allowed(x + dx, z + dz)) {
        added.add(k);
        gain++;
      }
    }
  }
  // Hugging the land (filling bays) and staying close count for more than raw new room, so the city grows as
  // a blob rather than in tendrils.
  return 0.4 * gain + 0.3 * hug - buried - 0.3 * (dist / cells.length) + rng() * 0.6;
}

/**
 * Cells whose neighbours are the same buildings (and the same number of filler tiles) score the same for a
 * building: the economy only looks next door. Saves running computeEconomy for every frontier cell.
 */
function neighbourhood(grid, x, z) {
  let junk = 0;
  const near = [];
  for (const [dx, dz] of DIRS) {
    const n = grid.get(x + dx, z + dz);
    if (!n) continue;
    if (CORE.has(n.terrain)) near.push(key(n.x, n.z));
    else junk += n.terrain === 'crater' ? 100 : 1;
  }
  return `${near.sort().join(';')}|${junk}`;
}

function place(rival, piece, cells) {
  const { grid, rng } = rival;
  for (const [x, z] of cells) {
    const terrain = isWaste(piece.terrain) ? WASTELAND[Math.floor(rng() * WASTELAND.length)] : piece.terrain;
    grid.set(x, z, { terrain });
  }
  if (isWaste(piece.terrain)) rival.pieces.push({ shape: piece.shape, rot: piece.rot, cells: cells.map((c) => [...c]) });
  rival.log?.push({ terrain: piece.terrain, shape: piece.shape, rot: piece.rot, cells });
}

/** Play one hand on the rival's grid. Returns the pieces placed. */
export function playHand(rival, hand) {
  const { grid, rng } = rival;
  let placed = 0;

  // Wasteland has to go down.
  for (const piece of hand.filter((p) => isWaste(p.terrain))) {
    let best = null;
    let bestScore = -Infinity;
    const frontier = grid.frontierKeys();
    for (const f of footprints(grid, piece.shape)) {
      const s = wasteScore(grid, frontier, f.cells, rng);
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    }
    if (!best) continue;
    piece.rot = best.rot;
    place(rival, piece, best.cells);
    placed++;
  }

  // Then the best building, one at a time, while one still pays its way. A building is worth a little on its
  // own (BUILD_BONUS): it grows the city and sets up later boosts, as a player would place it.
  const rest = hand.filter((p) => !isWaste(p.terrain) && p.terrain !== 'cliffs');
  while (rest.length) {
    const base = worth(rival, grid);
    let best = null;
    const open = [...grid.frontierKeys()].map((k) => k.split(',').map(Number)).filter(([x, z]) => isLegal(grid, [[x, z]]));
    const byPlace = open.map(([x, z]) => neighbourhood(grid, x, z));
    rest.forEach((piece, i) => {
      if (rest.findIndex((p) => p.terrain === piece.terrain) !== i) return; // same card twice scores the same
      const cache = new Map();
      open.forEach(([x, z], j) => {
        let gain = cache.get(byPlace[j]);
        if (gain === undefined) {
          grid.set(x, z, { terrain: piece.terrain });
          const after = worth(rival, grid);
          grid.cells.delete(key(x, z));
          // The bonus only for a building that would actually run (no new idle building, nobody starving).
          const runs = after.idle <= base.idle && after.fed >= Math.min(1, base.fed);
          gain = after.value - base.value + (runs ? BUILD_BONUS : 0);
          cache.set(byPlace[j], gain);
        }
        const score = gain - 0.04 * hexDistance(x, z) + rng() * 0.05;
        if (!best || score > best.score) best = { i, x, z, score };
      });
    });
    if (!best || best.score <= 0) break;
    place(rival, rest[best.i], [[best.x, best.z]]);
    rest.splice(best.i, 1);
    placed++;
  }

  // The season's food goes into (or comes out of) the store, as it does for the player.
  rival.foodStore = computeEconomy(grid, { foodStore: rival.foodStore }).storeAfter;
  return placed;
}
