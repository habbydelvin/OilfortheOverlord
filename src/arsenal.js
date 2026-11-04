import { DIRS, hexesAround } from './grid.js';

/** Oil a Military Factory spends each season it works. */
export const FACTORY_OIL = 3;
/** Rush Order used to spend oil on play; it is free to play now (shop price is 2 barrels). */
export const OVERTIME_OIL = 2;
/** Oil an Intercept Network spends to stop one incoming hit. */
/**
 * Intercept Network tuning, read live (combat-test.html's debug panel changes it; saved to localStorage).
 * Simulated for real in the attack phase (interceptSim.js).
 */
export const INTERCEPT_DEFAULTS = {
  range: 3, // cells: a network defends missiles aimed inside this ring
  reach: 14, // world units: how far into the sky its gun reaches (3D)
  upkeep: 2, // oil per season per network, to keep it manned (it never runs out of rounds)
  turnSpeed: 4, // rad/s the turret swings
  rate: 40, // rounds per second (one stream)
  roundSpeed: 24, // world units per second
  spread: 0.1, // rad of scatter per round
  hitRadius: 0.12, // a round this close to a missile hits it
  damage: 2, // HP per hit
  hpMissile: 3,
  hpWarhead: 6,
  hitChanceEst: 0.14, // the rival AI's planning guess: share of rounds that hit
};
const INTERCEPT_KEY = 'oto.intercept';
export const INTERCEPT = { ...INTERCEPT_DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(INTERCEPT_KEY) ?? '{}');
  for (const k of Object.keys(saved)) if (!(k in INTERCEPT_DEFAULTS)) delete saved[k]; // old dice-era keys
  Object.assign(INTERCEPT, saved);
} catch {
  /* keep defaults */
}
export const INTERCEPT_PARAMS = [
  { group: 'Intercept' },
  { key: 'range', label: 'Coverage (cells)', min: 1, max: 5, step: 1, hint: '1 = adjacent hexes only' },
  { key: 'chance', label: 'Stop chance', min: 0.1, max: 1, step: 0.05 },
];
export const saveIntercept = () => localStorage.setItem(INTERCEPT_KEY, JSON.stringify(INTERCEPT));
export const clearIntercept = () => {
  localStorage.removeItem(INTERCEPT_KEY);
  Object.assign(INTERCEPT, INTERCEPT_DEFAULTS);
};
export const INTERCEPT_OIL = 2;
/** Chance one Intercept Network shot stops an incoming strike. */
export const INTERCEPT_CHANCE = 0.65;
/** Seasons of paid work to finish one missile (a default year). */
export const FACTORY_SEASONS = 4;
/** Missile slots the city starts with (each staffed Magazine adds one more). */
export const BASE_MISSILE_CAP = 2;
/** Extra slots one staffed Magazine grants. */
export const MAGAZINE_CAP = 1;

const near = (grid, x, z) => DIRS.map(([dx, dz]) => grid.get(x + dx, z + dz)).filter(Boolean);

const idleAt = (idleKeys, cell) => idleKeys?.has(`${cell.x},${cell.z}`);

/** What one staffed Military Factory produces when a year of work completes. */
export function factoryYield(grid, cell, idleKeys) {
  const nbs = near(grid, cell.x, cell.z);
  const labs = nbs.filter((n) => n.terrain === 'missilelab' && !idleAt(idleKeys, n)).length;
  return { count: 1 + labs, kind: 'missile' };
}

/** Staffed Warhead Institutes on this board (each adds one extra hex to a missile). */
export function warheadRadius(grid, idleKeys) {
  let n = 0;
  for (const c of grid.cells.values()) if (c.terrain === 'warhead' && !idleAt(idleKeys, c)) n++;
  return n;
}

/**
 * Extra hexes beyond the aimed tile. Only staffed Warhead Institutes add any.
 * `footprint` always does 1 (the aim) + this. The debug Blast slider is combat-test only.
 */
export function blastExtra(grid, idleKeys) {
  return warheadRadius(grid, idleKeys);
}

/** Intercept Networks adjacent to a cell, in placement order. */
export function interceptorsBeside(grid, x, z) {
  return near(grid, x, z).filter((n) => n.terrain === 'intercept');
}

/** How far (in cells) an Intercept Network covers in the attack phase. */
export const INTERCEPT_RANGE = 1;

/** Intercept Networks within `range` cells of (x, z), nearest first. */
export function interceptorsNear(grid, x, z, range = INTERCEPT.range) {
  const out = [];
  for (const [cx, cz] of hexesAround(x, z, range)) {
    const c = grid.get(cx, cz);
    if (c?.terrain === 'intercept') out.push(c);
  }
  return out;
}

export const isMissileAmmo = (key) => key === 'missile' || key === 'missile2';
export const isPlayerMissile = (key) => isMissileAmmo(key) || key === 'salvo';

/** How many missiles the city can hold: base slots plus each staffed Magazine. */
export function missileCapacity(grid, idleKeys) {
  let n = BASE_MISSILE_CAP;
  if (!grid) return n;
  for (const cell of grid.cells.values()) {
    if (cell.terrain !== 'magazine') continue;
    if (idleAt(idleKeys, cell)) continue;
    n += MAGAZINE_CAP;
  }
  return n;
}
