import { DIRS } from './grid.js';
import { TERRAINS } from './tiles.js';

/** Workers each building needs to run. */
export const WORKERS = { farm: 1, station: 1, refinery: 1 };

/**
 * Calculates one season of the economy from the current grid.
 *
 * Order:
 *  1. Manpower is a capacity, not a resource: cap = capital + settlements + ruins + population - craters - raider camps (2 each).
 *     Worker buildings (farms, stations, refineries) are staffed in placement order; past the cap the
 *     newest go idle and produce nothing.
 *  2. Food: staffed farms grow, capital/settlements eat. Not enough food -> fed < 1.
 *  3. Oil: crude (staffed stations) × refinery multiplier × fed.
 *  4. Food store: spare food is banked; a shortfall is covered from the store before `fed` drops.
 *     Each time the store reaches growthCost(population), it converts into +1 population.
 *
 * state: { population, foodStore } carried between seasons. Population adds +1 manpower each.
 */
/** Population needed to eat 1 food per season. */
const POP_PER_FOOD = 2;

export function computeEconomy(grid, state = {}) {
  const population = state.population ?? 0;
  const foodStore = state.foodStore ?? 0;
  // Year-event modifiers (see events.js).
  const mods = { farmMult: 1, stationBonus: 0, capDelta: 0, foodUpkeep: 0, ...(state.mods ?? {}) };
  const neighbours = (x, z) => DIRS.map(([dx, dz]) => grid.get(x + dx, z + dz)?.terrain);

  let capBase = 0;
  let craterManpower = 0;
  let raiderManpower = 0;
  let banditOil = 0; // Siphoner camps
  let banditFood = 0; // Scavenger camps
  let stockpileTheft = 0; // Smuggler dens: share of the stockpile taken each season
  let farmFood = 0;
  let foodEaten = 0;
  let craterFood = 0;
  let crude = 0;
  let refineryLinks = 0;
  const counts = {};
  // Bonus counts for the HUD breakdown tooltips.
  const bonus = { labourCamps: 0, ruins: 0, pumpFarms: 0, oasisFarms: 0, tarpitStations: 0, capitalFood: 0, capitalCrude: 0 };
  // What each tile contributes, for the end-of-turn payout animation.
  const perCell = [];

  // Pass 1: worker capacity (housing, ruins, population, minus craters).
  for (const cell of grid.cells.values()) {
    const t = cell.terrain;
    const stats = TERRAINS[t].stats;
    if (stats.manpower > 0) capBase += stats.manpower;
    if (cell.onRuins && TERRAINS[t].category === 'building') {
      const ruins = 1 + (t === 'settlement' ? stats.ruinsBonusManpower : 0);
      capBase += ruins;
      bonus.ruins += ruins;
    }
    if (stats.raiderDrain) raiderManpower += stats.raiderDrain;
    if (stats.oilDrain) banditOil += stats.oilDrain;
    if (stats.foodDrain) banditFood += stats.foodDrain;
    if (stats.stockpileTheft) stockpileTheft += stats.stockpileTheft;
    // Labour Camp: +2 slots if any Settlement is next to it (doesn't stack with more Settlements).
    if (stats.adjacentManpower) {
      const near = neighbours(cell.x, cell.z);
      for (const [n, v] of Object.entries(stats.adjacentManpower)) {
        if (!near.includes(n)) continue;
        capBase += v;
        bonus.labourCamps += v;
      }
    }
    if (t === 'crater') {
      craterManpower += neighbours(cell.x, cell.z).filter((n) => n === 'farm' || n === 'settlement').length;
    }
  }
  const cap = Math.max(0, capBase + population - craterManpower - raiderManpower + mods.capDelta);

  // Staff worker buildings in placement order; the newest past the cap go idle.
  const idleKeys = new Set();
  let used = 0;
  let needed = 0;
  for (const cell of grid.cells.values()) {
    const w = WORKERS[cell.terrain] ?? 0;
    if (!w) continue;
    needed += w;
    if (used + w <= cap) used += w;
    else idleKeys.add(`${cell.x},${cell.z}`);
  }
  const isIdle = (x, z) => idleKeys.has(`${x},${z}`);

  // Pass 2: food and oil.
  for (const cell of grid.cells.values()) {
    const t = cell.terrain;
    const stats = TERRAINS[t].stats;
    const near = neighbours(cell.x, cell.z);
    counts[t] = (counts[t] ?? 0) + 1;
    const per = { x: cell.x, z: cell.z, terrain: t, food: 0, oil: 0, rawFood: 0, rawCrude: 0 };
    perCell.push(per);

    if (stats.food < 0) {
      foodEaten += -stats.food;
      per.food += stats.food;
    }
    // Bandits: per-tile numbers for the payout.
    if (stats.foodDrain) per.food -= stats.foodDrain;

    if (isIdle(cell.x, cell.z)) {
      per.idle = true;
      continue;
    }

    if (t === 'farm') {
      const pump = near.includes('pump');
      const oasis = near.includes('oasis');
      if (pump) bonus.pumpFarms++;
      if (oasis) bonus.oasisFarms++;
      per.rawFood = (2 + (pump ? 2 : 0) + (oasis ? 3 : 0)) * mods.farmMult;
      // A Capital next door triggers the farm twice: double output (doesn't stack with more Capitals).
      if (near.includes('capital')) {
        bonus.capitalFood += per.rawFood;
        per.rawFood *= 2;
        per.triggers = 2;
      }
      farmFood += per.rawFood;
    } else if (t === 'station') {
      const tarpit = near.includes('tarpit');
      if (tarpit) bonus.tarpitStations++;
      per.rawCrude = 2 + (tarpit ? 2 : 0) + mods.stationBonus;
      if (near.includes('capital')) {
        bonus.capitalCrude += per.rawCrude;
        per.rawCrude *= 2;
        per.triggers = 2;
      }
      crude += per.rawCrude;
    } else if (t === 'refinery') {
      // Only staffed stations feed a refinery.
      refineryLinks += DIRS.filter(([dx, dz]) => {
        const n = grid.get(cell.x + dx, cell.z + dz);
        return n?.terrain === 'station' && !isIdle(n.x, n.z);
      }).length;
    } else if (t === 'crater') {
      const victims = near.filter((n) => n === 'farm' || n === 'settlement').length;
      craterFood += victims;
      per.food -= victims;
    }
  }

  const free = cap - used;
  const idle = idleKeys.size;
  const foodGrown = Math.round(farmFood);
  // Citizens eat too: 1 food per 2 population (rounded up).
  const popFood = Math.ceil(population / POP_PER_FOOD);
  const totalEaten = foodEaten + craterFood + popFood + banditFood + mods.foodUpkeep;
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
  const oilMade = Math.round(crude * refineryMult * fed);
  // Siphoners tap the pipelines: taken off this season's oil (never below 0).
  const oilStolen = Math.min(oilMade, banditOil);
  const oil = oilMade - oilStolen;

  // Per-tile: farms grow at the staffing rate; final oil is shared out over stations by their crude
  // (largest remainder, so the per-tile numbers add up exactly to the total).
  shareOut(perCell, 'rawCrude', 'oil', oilMade);
  // Each Siphoner camp shows what it took (up to what was there).
  let siphonLeft = oilStolen;
  for (const per of perCell) {
    const d = TERRAINS[per.terrain].stats.oilDrain;
    if (!d || siphonLeft <= 0) continue;
    per.oil -= Math.min(d, siphonLeft);
    siphonLeft -= Math.min(d, siphonLeft);
  }
  // Grown food (after upkeep was already counted) rounded so the tiles add up to the shown balance.
  const upkeep = perCell.reduce((s, p) => s + p.food, 0);
  shareOut(perCell, 'rawFood', 'food', Math.round(foodBalance) - upkeep);
  for (const per of perCell) {
    delete per.rawFood;
    delete per.rawCrude;
  }

  return {
    perCell,
    cap,
    used,
    needed,
    free,
    idle,
    craterManpower,
    raiderManpower,
    banditFood,
    banditOil,
    oilStolen,
    oilMade,
    stockpileTheft,
    mods,
    foodGrown,
    foodEaten: totalEaten,
    popFood,
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
export const FIRST_QUOTA = 20;
/** Each year the quota is multiplied by this, then QUOTA_STEP is added (20 → 50 → 95 → 163 …). */
const QUOTA_GROWTH = 1.5;
const QUOTA_STEP = 20;
/** After a missed tribute the quota only grows by this much (the strike is the punishment). */
const MISSED_GROWTH = 1.1;
/** Each barrel delivered above the quota raises the next quota by this much. */
const EXCESS_FACTOR = 0.75;

/**
 * Next year's quota: the Overlord's greed grows every year, and faster with what you hand over.
 * A missed tribute only raises it by MISSED_GROWTH.
 */
export function nextQuota(quota, delivered) {
  // Missed: the Overlord asks a little more, not the full jump, so you can catch up.
  if (delivered < quota) return Math.round(quota * MISSED_GROWTH);
  return Math.round(quota * QUOTA_GROWTH + QUOTA_STEP + Math.max(0, delivered - quota) * EXCESS_FACTOR);
}

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
