import { DIRS } from './grid.js';
import { TERRAINS } from './tiles.js';
import { SCALE, campShare, scaled } from './scalingConfig.js';

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
 *  4. Food store: spare food is banked (up to FOOD_PER_CAPITAL per Capital, the rest is wasted);
 *     a shortfall is covered from the store before `fed` drops.
 *
 * state: { population, foodStore } carried between seasons. Population adds +1 manpower each.
 *
 * Scaling (see scalingConfig.js): year events give percentages (mods.farmPct, capPct, stationPct,
 * foodUpkeepPct); camps take a percentage of the total each (slots, oil made, food grown).
 */
/** Population needed to eat 1 food per season. */
const POP_PER_FOOD = 2;
/** Food each Capital can hold in the stores. */
export const FOOD_PER_CAPITAL = 30;
/** Food store capacity for the current grid. */
export function foodCapOf(grid) {
  let n = 0;
  for (const c of grid.cells.values()) if (c.terrain === 'capital') n++;
  return n * FOOD_PER_CAPITAL;
}

export function computeEconomy(grid, state = {}) {
  const population = state.population ?? 0;
  const foodStore = state.foodStore ?? 0;
  // Year-event modifiers (see events.js).
  const mods = { farmPct: 0, stationPct: 0, capPct: 0, foodUpkeepPct: 0, capDelta: 0, foodUpkeep: 0, ...(state.mods ?? {}) };
  const neighbours = (x, z) => DIRS.map(([dx, dz]) => grid.get(x + dx, z + dz)?.terrain);

  let capBase = 0;
  let craterManpower = 0;
  const camps = { slots: 0, banditSlots: 0, oil: 0, food: 0, stockpile: 0 }; // camps per drain kind
  let farmFood = 0;
  let foodEaten = 0;
  let craterFood = 0;
  let droughtFood = 0;
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
    if (stats.drain) camps[stats.drain]++;
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
  // Rebel camps and the year event take a share of the gross worker slots; Raider Hideouts a flat amount.
  const capGross = capBase + population;
  // Taxed settlements: some of their people flee the work.
  const taxSlots = (mods.settlementSlots ?? 0) * (counts0(grid, 'settlement'));
  const rebelManpower = camps.slots ? scaled(capGross, campShare(camps.slots, SCALE.campSlots)) : 0;
  const hideoutManpower = camps.banditSlots * SCALE.banditSlots;
  const raiderManpower = rebelManpower + hideoutManpower;
  const eventCap = scaled(capGross, mods.capPct);
  const cap = Math.max(0, capGross - craterManpower - raiderManpower + eventCap + taxSlots + mods.capDelta);

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

    if (isIdle(cell.x, cell.z)) {
      per.idle = true;
      continue;
    }

    if (t === 'farm') {
      // Drought: pumps and oases give nothing (what they would have given is kept for the event text).
      const pump = near.includes('pump');
      const oasis = near.includes('oasis');
      const water = (pump ? 2 : 0) + (oasis ? 3 : 0);
      if (mods.drought) droughtFood += water * (near.includes('capital') ? 2 : 1);
      else {
        if (pump) bonus.pumpFarms++;
        if (oasis) bonus.oasisFarms++;
      }
      per.rawFood = 2 + (mods.drought ? 0 : water);
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
      per.rawCrude = 2 + (tarpit ? 2 : 0);
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

  // Year events: a share of all farm food / station crude, spread over the tiles in proportion.
  const eventFood = Math.max(-farmFood, farmFood > 0 ? scaled(farmFood, mods.farmPct) : 0);
  const eventCrude = Math.max(-crude, crude > 0 ? scaled(crude, mods.stationPct) : 0);
  for (const per of perCell) {
    if (eventFood && per.rawFood) per.rawFood *= (farmFood + eventFood) / farmFood;
    if (eventCrude && per.rawCrude) per.rawCrude *= (crude + eventCrude) / crude;
  }
  farmFood += eventFood;
  crude += eventCrude;

  const free = cap - used;
  const idle = idleKeys.size;
  const foodGrown = Math.round(farmFood);
  // Scavengers take a share of the food grown; the event (refugees) adds upkeep as a share too.
  const banditFood = camps.food * SCALE.banditFood;
  const eventUpkeep = scaled(foodGrown, mods.foodUpkeepPct);
  splitOver(perCell, 'food', 'food', -banditFood);
  // Citizens eat too: 1 food per 2 population (rounded up).
  const popFood = Math.ceil(population / POP_PER_FOOD);
  const totalEaten = foodEaten + craterFood + popFood + banditFood + eventUpkeep + mods.foodUpkeep;
  const foodBalance = foodGrown - totalEaten;
  // The store covers a shortfall first; only what it can't cover starves the city.
  const fed = totalEaten > 0 ? Math.min(1, (foodGrown + foodStore) / totalEaten) : 1;

  // Bank spare food (whole numbers) up to the store capacity; anything over it spoils.
  const foodCap = (counts.capital ?? 0) * FOOD_PER_CAPITAL;
  const rawStore = Math.max(0, foodStore + Math.round(foodBalance));
  const storeAfter = Math.min(foodCap, rawStore);
  const foodWasted = rawStore - storeAfter;

  const refineryMult = 1 + 0.5 * refineryLinks;
  // Taxed settlements pay oil straight into the season's yield.
  const taxOil = (mods.settlementOil ?? 0) * (counts.settlement ?? 0);
  const oilMade = Math.round(crude * refineryMult * fed) + taxOil;
  // Siphoners tap the pipelines: a share of this season's oil (never below 0).
  const banditOil = camps.oil * SCALE.banditOil;
  const oilStolen = Math.min(oilMade, banditOil);
  // Smuggler dens: barrels taken from the stockpile each season (flat, per den).
  const stockpileTheft = camps.stockpile * SCALE.banditStockpile;
  const oil = oilMade - oilStolen;

  // Per-tile: farms grow at the staffing rate; final oil is shared out over stations by their crude
  // (largest remainder, so the per-tile numbers add up exactly to the total).
  shareOut(perCell, 'rawCrude', 'oil', oilMade);
  // Each Siphoner camp shows its part of what was taken.
  splitOver(perCell, 'oil', 'oil', -oilStolen);
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
    rebelManpower,
    hideoutManpower,
    banditFood,
    banditOil,
    oilStolen,
    camps,
    capGross,
    eventCap,
    eventFood: Math.round(eventFood),
    eventCrude: Math.round(eventCrude),
    eventUpkeep,
    droughtFood,
    taxOil,
    taxSlots,
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
    foodCap,
    foodWasted,
    crude,
    refineryMult,
    refineryLinks,
    oil,
    counts,
    bonus,
  };
}

function counts0(grid, terrain) {
  let n = 0;
  for (const c of grid.cells.values()) if (c.terrain === terrain) n++;
  return n;
}

/** Adds `amount` (whole, may be negative) evenly over the camp tiles that drain `drain`. */
function splitOver(cells, drain, outKey, amount) {
  const items = cells.filter((c) => TERRAINS[c.terrain].stats.drain === drain);
  if (!items.length || !amount) return;
  const sign = Math.sign(amount);
  const n = Math.abs(amount);
  items.forEach((c, i) => (c[outKey] += sign * (Math.floor(n / items.length) + (i < n % items.length ? 1 : 0))));
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
