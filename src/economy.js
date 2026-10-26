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
 */
export function computeEconomy(grid, rerollsSpent = 0) {
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
      const bonus = 1 + (t === 'settlement' ? stats.ruinsBonusManpower : 0);
      supplied += bonus;
      per.manpower += bonus;
    }

    if (t === 'farm') {
      per.rawFood = 2 + (near.includes('pump') ? 2 : 0) + (near.includes('oasis') ? 3 : 0);
      farmFood += per.rawFood;
    } else if (t === 'station') {
      per.rawCrude = 2 + (near.includes('tarpit') ? 2 : 0);
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

  supplied = Math.max(0, supplied - craterManpower);
  const spare = supplied - employed - rerollsSpent;
  const staffing = spare >= 0 ? 1 : employed > 0 ? Math.max(0, employed + spare) / employed : 1;
  const boost = 1 + 0.1 * Math.max(0, spare);

  const foodGrown = farmFood * staffing;
  const totalEaten = foodEaten + craterFood;
  const foodBalance = foodGrown - totalEaten;
  const fed = totalEaten > 0 ? Math.min(1, foodGrown / totalEaten) : 1;

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
    crude,
    refineryMult,
    oil,
    counts,
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

/** Tribute quota per round (placeholder curve from the proposal, then ×1.45 per round). */
const QUOTAS = [24, 36, 54, 80, 120, 175];
export function quotaFor(round) {
  if (round <= QUOTAS.length) return QUOTAS[round - 1];
  return Math.round(QUOTAS[QUOTAS.length - 1] * Math.pow(1.45, round - QUOTAS.length));
}

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
