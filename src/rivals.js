import { Grid } from './grid.js';
import { TERRAINS } from './tiles.js';
import { computeEconomy } from './economy.js';
import { dealHand, playHand, fadeTension } from './rivalAI.js';
import { CAPITAL_HP } from './war.js';

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

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Display-only. `computeEconomy` is not written back onto the rival or the player. */
export function rivalStats(grid, rival = null) {
  const counts = {};
  let buildings = 0;
  for (const cell of grid.cells.values()) {
    const category = TERRAINS[cell.terrain]?.category ?? 'other';
    counts[category] = (counts[category] ?? 0) + 1;
    if (category === 'building') buildings++;
  }
  // A full store, so the figure is what the wells would ship rather than a city starving on turn one.
  const oil = Math.round(computeEconomy(grid, { foodStore: 30 }).oilMade ?? 0);
  let interceptors = 0;
  let factories = 0;
  for (const cell of grid.cells.values()) {
    if (cell.terrain === 'intercept') interceptors++;
    if (cell.terrain === 'milfactory') factories++;
  }
  return { counts, buildings, oil, tiles: grid.size, missiles: rival?.missiles?.length ?? 0, hp: rival?.capitalHp ?? CAPITAL_HP, alive: rival?.alive !== false, interceptors, factories, stockpile: rival?.oil ?? 0 };
}

/**
 * The rivals for this run: each opens like the player (a Capital and the same first hand, played at once),
 * then plays one hand every season (advanceRivals). `pieces` keeps each Wasteland piece for its whole-piece model.
 */
export function createRivals(seed) {
  const base = seed >>> 0;
  return RIVALS.map((def, i) => {
    const grid = new Grid();
    grid.set(0, 0, { terrain: 'capital' });
    const rng = mulberry32((base + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const rival = { id: def.id, def, grid, pieces: [], rng, round: 1, season: 0, foodStore: 0, oil: 0, missiles: [], threat: 0, capitalHp: CAPITAL_HP, alive: true, tension: {}, stats: null, version: 0 };
    playHand(rival, dealHand(rival, true));
    rival.stats = rivalStats(grid, rival);
    return rival;
  });
}

/** A season has passed: every rival plays its next hand (`round` is the player's year, for card unlocks). */
export function advanceRivals(rivals, { round, season, playerMissiles = 0, yearLength }, all = rivals) {
  for (const rival of rivals ?? []) {
    if (rival.alive === false) continue; // eliminated: no more turns
    fadeTension(rival);
    // What it has seen the others stockpile: more missiles about, more worth spending on shields.
    rival.threat = all.reduce((n, r) => n + (r === rival ? 0 : r.missiles?.length ?? 0), 0) + (playerMissiles ?? 0);
    rival.round = round;
    rival.yearLength = yearLength ?? 4;
    rival.season = season;
    playHand(rival, dealHand(rival));
    rival.stats = rivalStats(rival.grid, rival);
    rival.version++;
  }
}
