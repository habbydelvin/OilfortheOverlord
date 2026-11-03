import { DIRS, hexesAround } from './grid.js';

/** Oil a Military Factory spends each season it works. */
export const FACTORY_OIL = 3;
/** Oil Work Overtime spends to add one season of progress. */
export const OVERTIME_OIL = 2;
/** Oil an Intercept Network spends to stop one incoming hit. */
/**
 * Intercept Network tuning, read live (combat-test.html's debug panel changes it; saved to localStorage).
 * range: cells covered in the attack phase · chance: one shot stops a strike · oil: cost per shot.
 */
export const INTERCEPT_DEFAULTS = { range: 2, chance: 0.65, oil: 2 };
const INTERCEPT_KEY = 'oto.intercept';
export const INTERCEPT = { ...INTERCEPT_DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(INTERCEPT_KEY) ?? '{}');
  delete saved.oil; // the shot cost is a design value now (2): an old saved 3 no longer overrides it
  Object.assign(INTERCEPT, saved);
} catch {
  /* keep defaults */
}
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
  const recipe = nbs.some((n) => n.terrain === 'missilelab' && !idleAt(idleKeys, n));
  const warhead = nbs.some((n) => n.terrain === 'warhead' && !idleAt(idleKeys, n));
  return { count: 1 + (recipe ? 1 : 0), kind: warhead ? 'missile2' : 'missile' };
}

/** Intercept Networks adjacent to a cell, in placement order. */
export function interceptorsBeside(grid, x, z) {
  return near(grid, x, z).filter((n) => n.terrain === 'intercept');
}

/** How far (in cells) an Intercept Network covers in the attack phase. */
export const INTERCEPT_RANGE = 2;

/** Intercept Networks within `range` cells of (x, z), nearest first. */
export function interceptorsNear(grid, x, z, range = INTERCEPT.range) {
  const out = [];
  for (const [cx, cz] of hexesAround(x, z, range)) {
    const c = grid.get(cx, cz);
    if (c?.terrain === 'intercept') out.push(c);
  }
  return out;
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
