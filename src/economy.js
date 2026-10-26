import { DIRS } from './grid.js';
import { TERRAINS } from './tiles.js';

/** Workers each building needs to run. */
const WORKERS = { farm: 1, station: 1, refinery: 2 };

/**
 * Calculates one season of the economy from the current grid.
 *
 * Order (single pass, no loops):
 *  1. Manpower: supplied (capital, settlements, ruins bonus, crater penalty) vs employed (farms, stations, refineries)
 *     minus manpower spent on rerolls. Short of workers -> staffing < 1, spare workers -> oil boost.
 *  2. Food: farms grow (scaled by staffing), capital/settlements eat. Not enough food -> fed < 1.
 *  3. Oil: crude × refinery multiplier × boost × staffing × fed.
 *  4. Food store: spare food is banked; a shortfall is covered from the store before `fed` drops.
 *     Each time the store reaches growthCost(population), it converts into +1 population.
 *
 * state: { population, foodStore } carried between seasons. Population adds +1 manpower each.
 */
export function computeEconomy(grid, rerollsSpent = 0, state = {}) {
  const population = state.population ?? 0;
  const foodStore = state.foodStore ?? 0;
  const neighbours = (x, z) => DIRS.map(([dx, dz]) => grid.get(x + dx, z + dz)?.terrain);

  let supplied = 0;
  let employed = 0;
  let craterManpower = 0;
  let farmFood = 0;
  let foodEaten = 0;
  let craterFood = 0;
  let crude = 0;
  let refineryLinks = 0;
  const counts = {};
  // Bonus counts for the HUD breakdown tooltips.
  const bonus = { ruins: 0, pumpFarms: 0, oasisFarms: 0, tarpitStations: 0 };
  // What each tile contributes, for the end-of-turn payout animation.
  const perCell = [];

  for (const cell of grid.cells.values()) {
    const t = cell.terrain;
    const stats = TERRAINS[t].stats;
    const near = neighbours(cell.x, cell.z);
    counts[t] = (counts[t] ?? 0) + 1;
    const per = { x: cell.x, z: cell.z, terrain: t, food: 0, manpower: 0, oil: 0, rawFood: 0, rawCrude: 0 };
    perCell.push(per);

    // Upkeep / output shared by most buildings.
    if (stats.manpower > 0) {
      supplied += stats.manpower;
      per.manpower += stats.manpower;
    }
    if (stats.food < 0) {
      foodEaten += -stats.food;
      per.food += stats.food;
    }
    employed += WORKERS[t] ?? 0;
    per.manpower -= WORKERS[t] ?? 0;

    // Ruins under any building: +1 manpower, +1 more for a settlement.
    if (cell.onRuins && TERRAINS[t].category === 'building') {
      const ruins = 1 + (t === 'settlement' ? stats.ruinsBonusManpower : 0);
      supplied += ruins;
      per.manpower += ruins;
      bonus.ruins += ruins;
    }

    if (t === 'farm') {
      const pump = near.includes('pump');
      const oasis = near.includes('oasis');
      if (pump) bonus.pumpFarms++;
      if (oasis) bonus.oasisFarms++;
      per.rawFood = 2 + (pump ? 2 : 0) + (oasis ? 3 : 0);
      farmFood += per.rawFood;
    } else if (t === 'station') {
      const tarpit = near.includes('tarpit');
      if (tarpit) bonus.tarpitStations++;
      per.rawCrude = 2 + (tarpit ? 2 : 0);
      crude += per.rawCrude;
    } else if (t === 'refinery') {
      refineryLinks += near.filter((n) => n === 'station').length;
    } else if (t === 'crater') {
      const victims = near.filter((n) => n === 'farm' || n === 'settlement').length;
      craterManpower += victims;
      craterFood += victims;
      per.manpower -= victims;
      per.food -= victims;
    }
  }

  // Rerolls are paid out of the manpower pool itself, before anyone is put to work.
  supplied = Math.max(0, supplied + population - craterManpower - rerollsSpent);
  const spare = supplied - employed;
  const staffing = spare >= 0 ? 1 : employed > 0 ? Math.max(0, employed + spare) / employed : 1;
  const boost = 1 + 0.1 * Math.max(0, spare);

  const foodGrown = farmFood * staffing;
  const totalEaten = foodEaten + craterFood;
  const foodBalance = foodGrown - totalEaten;
  // The store covers a shortfall first; only what it can't cover starves the city.
  const fed = totalEaten > 0 ? Math.min(1, (foodGrown + foodStore) / totalEaten) : 1;

  // Bank spare food (whole numbers), then convert full growth costs into population.
  let storeAfter = Math.max(0, foodStore + Math.round(foodBalance));
  let popGrowth = 0;
  while (storeAfter >= growthCost(population + popGrowth)) {
    storeAfter -= growthCost(population + popGrowth);
    popGrowth++;
  }

  const refineryMult = 1 + 0.5 * refineryLinks;
  const oil = Math.round(crude * refineryMult * boost * staffing * fed);

  // Per-tile: farms grow at the staffing rate; final oil is shared out over stations by their crude
  // (largest remainder, so the per-tile numbers add up exactly to the total).
  shareOut(perCell, 'rawCrude', 'oil', oil);
  // Grown food (after upkeep was already counted) rounded so the tiles add up to the shown balance.
  const upkeep = perCell.reduce((s, p) => s + p.food, 0);
  shareOut(perCell, 'rawFood', 'food', Math.round(foodBalance) - upkeep);
  for (const per of perCell) {
    delete per.rawFood;
    delete per.rawCrude;
  }

  return {
    perCell,
    supplied,
    employed,
    rerollsSpent,
    craterManpower,
    spare,
    staffing,
    boost,
    foodGrown,
    foodEaten: totalEaten,
    craterFood,
    foodBalance,
    fed,
    population,
    foodStore,
    storeAfter,
    popGrowth,
    nextGrowthCost: growthCost(population + popGrowth),
    crude,
    refineryMult,
    refineryLinks,
    oil,
    counts,
    bonus,
  };
}

/**
 * Adds `total` (whole number) to `outKey` across the cells, in proportion to `weightKey`,
 * using largest remainders so the parts add up exactly.
 */
function shareOut(cells, weightKey, outKey, total) {
  const items = cells.filter((c) => c[weightKey] > 0);
  const weight = items.reduce((s, c) => s + c[weightKey], 0);
  if (!items.length || weight <= 0 || total <= 0) return;
  let given = 0;
  const parts = items.map((c) => {
    const exact = (total * c[weightKey]) / weight;
    const base = Math.floor(exact);
    given += base;
    return { c, base, rem: exact - base };
  });
  parts.sort((a, b) => b.rem - a.rem);
  for (let i = 0; given < total; i = (i + 1) % parts.length, given++) parts[i].base++;
  for (const p of parts) p.c[outKey] += p.base;
}

/** Food needed for the next population point when you already have `population` (10, 15, 20, …). */
export function growthCost(population) {
  return 10 + 5 * population;
}

/** Tribute quota for the first year. */
export const FIRST_QUOTA = 24;
/** The quota always grows by this much per year, even if you only just meet it (or miss it). */
const QUOTA_GROWTH = 1.1;
/** Each barrel delivered above the quota raises the next quota by this much. */
const EXCESS_FACTOR = 0.75;

/**
 * Next year's quota: the Overlord's greed grows with what you hand over.
 * A shortfall counts as zero excess (the quota still grows by QUOTA_GROWTH).
 */
export function nextQuota(quota, delivered) {
  return Math.round(quota * QUOTA_GROWTH + Math.max(0, delivered - quota) * EXCESS_FACTOR);
}

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
