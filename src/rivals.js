import { Grid } from './grid.js';
import { TERRAINS } from './tiles.js';
import { computeEconomy } from './economy.js';

/** Static rival city-states. Leaders are placeholders. `map` is a point on the war table, 0–100. */
export const RIVALS = [
  {
    id: 'margrave',
    name: 'Iron Margrave',
    zh: '铁边侯',
    leader: 'The Margrave',
    leaderZh: '边侯',
    personality: 'hawk',
    personalityName: 'Hawk',
    personalityZh: '鹰派',
    color: '#a8452a',
    map: { x: 76, y: 28 },
  },
  {
    id: 'syndicate',
    name: 'Brass Syndicate',
    zh: '黄铜商团',
    leader: 'Chairman Vell',
    leaderZh: '维尔主席',
    personality: 'merchant',
    personalityName: 'Merchant',
    personalityZh: '商贾',
    color: '#c4a15a',
    map: { x: 28, y: 76 },
  },
  {
    id: 'synod',
    name: 'Ashen Synod',
    zh: '灰烬议会',
    leader: 'The Ash Abbess',
    leaderZh: '灰修女院长',
    personality: 'paranoid',
    personalityName: 'Paranoid',
    personalityZh: '多疑',
    color: '#6e8494',
    map: { x: 26, y: 30 },
  },
];

/** The player's node on the war table. */
export const PLAYER_NODE = { x: 50, y: 62, color: '#e8bf68' };

/** Hawk: housing and refineries. Merchant: derricks (stations) and pumps. Synod: farms and housing. */
const WEIGHTS = {
  hawk: [
    ['settlement', 5],
    ['refinery', 4],
    ['farm', 1],
    ['station', 1],
  ],
  merchant: [
    ['station', 5],
    ['pump', 3],
    ['settlement', 1],
    ['refinery', 1],
  ],
  paranoid: [
    ['farm', 5],
    ['settlement', 4],
    ['pump', 1],
    ['station', 1],
  ],
};

const LAYOUT_TILES = 24;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTerrain(rng, personality) {
  const table = WEIGHTS[personality] ?? WEIGHTS.hawk;
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [terrain, weight] of table) {
    roll -= weight;
    if (roll <= 0) return terrain;
  }
  return table[0][0];
}

/** Capital at the origin, then buildings on frontier cells. No wasteland: those models live in another bundle. */
export function generateLayout(grid, personality, rng, count = LAYOUT_TILES) {
  grid.set(0, 0, { terrain: 'capital' });
  for (let i = 0; i < count; i++) {
    const open = [...grid.frontierKeys()];
    if (!open.length) break;
    const [x, z] = open[Math.floor(rng() * open.length)].split(',').map(Number);
    grid.set(x, z, { terrain: pickTerrain(rng, personality) });
  }
}

/** Display-only. `computeEconomy` is not written back onto the rival or the player. */
export function rivalStats(grid) {
  const counts = {};
  let buildings = 0;
  for (const cell of grid.cells.values()) {
    const category = TERRAINS[cell.terrain]?.category ?? 'other';
    counts[category] = (counts[category] ?? 0) + 1;
    if (category === 'building') buildings++;
  }
  // A full store, so the figure is what the wells would ship rather than a city starving on turn one.
  const oil = Math.round(computeEconomy(grid, { foodStore: 30 }).oilMade ?? 0);
  return { counts, buildings, oil, tiles: grid.size };
}

/** One layout per rival for this run. Phase 2 replaces the grids with turn-by-turn growth. */
export function createRivals(seed) {
  const base = seed >>> 0;
  return RIVALS.map((def, i) => {
    const grid = new Grid();
    const rng = mulberry32((base + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    generateLayout(grid, def.personality, rng);
    return { id: def.id, def, grid, stats: rivalStats(grid), tension: 0 };
  });
}
