import { DIRS } from './grid.js';

/** Oil a Military Factory spends each season it works. */
export const FACTORY_OIL = 3;
/** Oil Work Overtime spends to add one season of progress. */
export const OVERTIME_OIL = 2;
/** Oil an Intercept Network spends to stop one incoming hit. */
export const INTERCEPT_OIL = 3;
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
  const recipe = nbs.some((n) => n.terrain === 'missilelab' && !idleAt(idleKeys, n));
  const warhead = nbs.some((n) => n.terrain === 'warhead' && !idleAt(idleKeys, n));
  return { count: 1 + (recipe ? 1 : 0), kind: warhead ? 'missile2' : 'missile' };
}

/** Intercept Networks adjacent to a cell, in placement order. */
export function interceptorsBeside(grid, x, z) {
  return near(grid, x, z).filter((n) => n.terrain === 'intercept');
}

export const isPlayerMissile = (key) => key === 'missile' || key === 'missile2';

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
