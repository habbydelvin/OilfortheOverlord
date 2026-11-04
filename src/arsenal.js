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
  rate: 33, // rounds per second (one stream)
  roundSpeed: 24, // world units per second
  spread: 0.33, // rad of scatter per round
  hitRadius: 0.19, // a round this close to a missile hits it
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
/**
 * Decoy tuning (Decoy Works and the Decoy card). A decoy flies like a missile, then near the target splits into
 * `fakes` fake missiles that draw interceptor fire. Neither the decoy nor its fakes do any damage.
 */
export const DECOY_DEFAULTS = {
  seasons: 1, // seasons of paid work per decoy
  oil: 1, // oil a staffed Decoy Works spends each season
  fakes: 3, // fake missiles one decoy splits into
  splitAt: 0.2, // share of the dive (path u) at which it splits: lower = higher in the sky
  hp: 3, // the decoy before the split (it looks like a missile on radar)
  fakeHp: 1, // each fake
  spread: 2, // fakes land within this many cells of the aim
};
const DECOY_KEY = 'oto.decoy';
export const DECOY = { ...DECOY_DEFAULTS };
/**
 * Launch Accelerator tuning: a missile launched from a Magazine or Decoy Works within `radius` cells of a staffed
 * Accelerator flies faster: War Map travel × travel, the final dive × flight (less time in interceptor reach).
 */
export const BOOST_DEFAULTS = {
  radius: 2,
  travel: 0.6,
  flight: 0.6,
  weave: 0.55, // evasive weaving: world units a boosted missile swings side to side (0 = flies straight)
  weaveFreq: 1.5, // swings per second
};
const BOOST_KEY = 'oto.boost';
export const BOOST = { ...BOOST_DEFAULTS };
for (const [obj, defs, k] of [[DECOY, DECOY_DEFAULTS, DECOY_KEY], [BOOST, BOOST_DEFAULTS, BOOST_KEY]]) {
  try {
    const saved = JSON.parse(localStorage.getItem(k) ?? '{}');
    for (const s of Object.keys(saved)) if (!(s in defs)) delete saved[s];
    Object.assign(obj, saved);
  } catch {
    /* keep defaults */
  }
}
export const saveDecoy = () => localStorage.setItem(DECOY_KEY, JSON.stringify(DECOY));
export const saveBoost = () => localStorage.setItem(BOOST_KEY, JSON.stringify(BOOST));
export const clearDecoyBoost = () => {
  localStorage.removeItem(DECOY_KEY);
  localStorage.removeItem(BOOST_KEY);
  Object.assign(DECOY, DECOY_DEFAULTS);
  Object.assign(BOOST, BOOST_DEFAULTS);
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

/** Staffed Launch Accelerators within BOOST.radius of (x, z). */
export function boostersNear(grid, x, z, idleKeys) {
  const out = [];
  for (const [cx, cz] of hexesAround(x, z, BOOST.radius)) {
    const c = grid.get(cx, cz);
    if (c?.terrain === 'booster' && !idleAt(idleKeys, c)) out.push(c);
  }
  return out;
}

/** True if a missile launched from (x, z) gets the Launch Accelerator boost. */
export const isBoosted = (grid, x, z, idleKeys) => boostersNear(grid, x, z, idleKeys).length > 0;

/**
 * Where each of a city's strikes launches from, in order: decoys from Decoy Works (Magazines if it has none), real
 * missiles from Magazines; launchers next to a Launch Accelerator are used first, then round robin. No launcher:
 * the Capital (or the first tile). Returns [{ x, z, boosted }], one per strike.
 */
export function assignLaunchers(grid, strikes, idleKeys) {
  if (!grid) return strikes.map(() => ({ x: 0, z: 0, boosted: false }));
  const cells = [...grid.cells.values()];
  const pool = (terrain) =>
    cells
      .filter((c) => c.terrain === terrain)
      .map((c) => ({ x: c.x, z: c.z, boosted: isBoosted(grid, c.x, c.z, idleKeys) }))
      .sort((a, b) => Number(b.boosted) - Number(a.boosted));
  const mags = pool('magazine');
  const works = pool('decoyworks');
  const home = cells.find((c) => c.terrain === 'capital') ?? cells[0] ?? { x: 0, z: 0 };
  const fallback = [{ x: home.x, z: home.z, boosted: isBoosted(grid, home.x, home.z, idleKeys) }];
  const used = new Map();
  return strikes.map((s) => {
    const list = s.kind === 'decoy' ? (works.length ? works : mags.length ? mags : fallback) : mags.length ? mags : fallback;
    const n = used.get(list) ?? 0;
    used.set(list, n + 1);
    return { ...list[n % list.length] };
  });
}

export const isMissileAmmo = (key) => key === 'missile' || key === 'missile2' || key === 'decoy';
export const isDecoy = (key) => key === 'decoy';
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
