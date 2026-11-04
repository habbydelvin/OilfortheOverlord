import { DIRS } from './grid.js';
import { TERRAINS } from './tiles.js';
import { SCALE, scaled } from './scalingConfig.js';
import { L } from './i18n.js';
import { FACTORY_OIL, INTERCEPT } from './arsenal.js';

/** Workers each building needs to run. */
export const WORKERS = { farm: 1, station: 1, refinery: 1, missilelab: 2, warhead: 2, magazine: 2 };

/**
 * Calculates one season of the economy from the current grid.
 *
 * Order:
 *  1. Manpower is a capacity, not a resource: cap = capital + settlements + ruins + population - craters - rebel camps / raider hideouts (flat, each).
 *     Worker buildings (farms, stations, refineries) are staffed in placement order; past the cap the
 *     newest go idle and produce nothing.
 *  2. Food: staffed farms grow, capital/settlements eat. Not enough food -> fed < 1.
 *  3. Oil: (crude from staffed stations + refinery oil) × fed. A staffed refinery makes 1× the crude of each
 *     staffed station next to it (TERRAINS.refinery.stats.oilMultiplierPerAdjacent).
 *  4. Food store: spare food is banked (up to FOOD_PER_CAPITAL per Capital, the rest is wasted);
 *     a shortfall is covered from the store before `fed` drops.
 *
 * state: { population, foodStore } carried between seasons. Population adds +1 manpower each.
 *
 * Scaling (see scalingConfig.js): year events give percentages (mods.farmPct, capPct, stationPct,
 * foodUpkeepPct); camps take a flat amount each (slots, oil, food).
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
  const camps = { slots: 0, banditSlots: 0, oil: 0, food: 0 }; // camps per drain kind
  let farmFood = 0;
  let foodEaten = 0;
  let craterFood = 0;
  let droughtFood = 0;
  let crude = 0;
  let refineryLinks = 0;
  let refineryCrude = 0;
  const refineries = [];
  const counts = {};
  // Bonus counts for the HUD breakdown tooltips.
  const bonus = { labourCamps: 0, ruins: 0, pumpFarms: 0, oasisFarms: 0, tarpitStations: 0, capitalFood: 0, capitalCrude: 0 };
  // What each tile contributes, for the end-of-turn payout animation.
  const perCell = [];
  // What each booster (Water Pump, Oasis, Tar Pit) adds to the building next to it: worked out as a share of that
  // building's output, then turned into whole food / oil once the final numbers are known (see `shares` below).
  // A bonus doesn't stack, so a building next to two of the same booster credits only the first one found.
  const credits = []; // { from: building's perCell entry, to: booster cell key, res: 'food' | 'oil', amount (raw) }
  // The same bonus, kept on the booster so a hovered pump/oasis/tar pit can list what it adds this season.
  const grants = []; // { to: booster cell key, terrain: building it boosts, res, amount (raw, scaled later) }
  const credit = (from, booster, res, amount) => {
    for (const [dx, dz] of DIRS) {
      const n = grid.get(from.x + dx, from.z + dz);
      if (n?.terrain !== booster) continue;
      const to = `${n.x},${n.z}`;
      credits.push({ from, to, res, amount });
      grants.push({ to, terrain: from.terrain, res, amount });
      return;
    }
  };

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
    // Labour Camp: +2 slots if any Settlement is next to it (doesn't stack with more Settlements), and +2 more once
    // all six of its neighbours are Settlements.
    if (stats.adjacentManpower || stats.surroundedManpower) {
      const near = neighbours(cell.x, cell.z);
      for (const [n, v] of Object.entries(stats.adjacentManpower ?? {})) {
        if (!near.includes(n)) continue;
        capBase += v;
        bonus.labourCamps += v;
      }
      for (const [n, v] of Object.entries(stats.surroundedManpower ?? {})) {
        if (!near.every((t) => t === n)) continue;
        capBase += v;
        bonus.labourCamps += v;
      }
    }
    if (t === 'crater') {
      craterManpower += neighbours(cell.x, cell.z).filter((n) => n === 'farm' || n === 'settlement').length;
    }
  }
  // Rebel Camps and Raider Hideouts take a flat amount of worker slots each; the year event a share.
  const capGross = capBase + population;
  // Taxed settlements: some of their people flee the work.
  const taxSlots = (mods.settlementSlots ?? 0) * (counts0(grid, 'settlement'));
  const rebelManpower = camps.slots * SCALE.rebelSlots;
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
    // mods: neighbour effects on this tile (inspect card). outFood / outOil: its own yield this season,
    // after those effects, year events and hunger — not the payout's net-balance split.
    const per = { x: cell.x, z: cell.z, terrain: t, food: 0, oil: 0, rawFood: 0, rawCrude: 0, mods: [], outFood: 0, outOil: 0 };
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
      // Each Capital next door triggers the farm once more (1 Capital ×2, 2 Capitals ×3...).
      const caps = near.filter((n) => n === 'capital').length;
      const twice = 1 + caps;
      if (mods.drought) droughtFood += water * twice;
      else {
        if (pump) bonus.pumpFarms++;
        if (oasis) bonus.oasisFarms++;
        if (pump) credit(per, 'pump', 'food', 2 * twice);
        if (oasis) credit(per, 'oasis', 'food', 3 * twice);
      }
      if (mods.drought && (pump || oasis)) per.mods.push({ id: 'drought' });
      else {
        if (pump) per.mods.push({ id: 'pump' });
        if (oasis) per.mods.push({ id: 'oasis' });
      }
      for (let i = 0; i < caps; i++) per.mods.push({ id: 'twice' });
      per.rawFood = 2 + (mods.drought ? 0 : water);
      if (caps) {
        bonus.capitalFood += per.rawFood * caps;
        per.rawFood *= twice;
        per.triggers = twice;
      }
      farmFood += per.rawFood;
    } else if (t === 'station') {
      const tarpit = near.includes('tarpit');
      if (tarpit) bonus.tarpitStations++;
      const caps = near.filter((n) => n === 'capital').length; // each one triggers it once more
      if (tarpit) credit(per, 'tarpit', 'oil', 2 * (1 + caps));
      if (tarpit) per.mods.push({ id: 'tarpit' });
      for (let i = 0; i < caps; i++) per.mods.push({ id: 'twice' });
      per.rawCrude = 2 + (tarpit ? 2 : 0);
      if (caps) {
        bonus.capitalCrude += per.rawCrude * caps;
        per.rawCrude *= 1 + caps;
        per.triggers = 1 + caps;
      }
      crude += per.rawCrude;
    } else if (t === 'refinery') {
      refineries.push(per); // its oil comes from its neighbours' crude, worked out once all stations are known
    } else if (t === 'crater') {
      const victims = near.filter((n) => n === 'farm' || n === 'settlement').length;
      craterFood += victims;
      per.food -= victims;
      if (victims) per.mods.push({ id: 'crater', n: victims });
      per.outManpower = -victims;
    } else if (t === 'milfactory') {
      for (const [dx, dz] of DIRS) {
        const n = grid.get(cell.x + dx, cell.z + dz);
        if (n?.terrain === 'missilelab' && !isIdle(n.x, n.z)) {
          per.mods.push({ id: 'missilelab' });
          break; // one staffed lab is enough: a second one does not add another missile
        }
      }
    } else if (t === 'labourcamp') {
      const n = near.filter((x) => x === 'settlement').length;
      if (n >= 6) per.mods.push({ id: 'labourFull' });
      else if (n > 0) per.mods.push({ id: 'labour' });
      per.outManpower = n >= 6 ? 4 : n > 0 ? 2 : 0;
    }
  }

  // Each credit as a share of its building's output (events, hunger and rounding scale both alike).
  for (const c of credits) {
    const raw = c.res === 'food' ? c.from.rawFood : c.from.rawCrude;
    c.ratio = raw > 0 ? c.amount / raw : 0;
  }

  // Year events: a share of all farm food / station crude, spread over the tiles in proportion.
  const eventFood = Math.max(-farmFood, farmFood > 0 ? scaled(farmFood, mods.farmPct) : 0);
  const eventCrude = Math.max(-crude, crude > 0 ? scaled(crude, mods.stationPct) : 0);
  const foodScale = farmFood > 0 ? (farmFood + eventFood) / farmFood : 1;
  const oilScale = crude > 0 ? (crude + eventCrude) / crude : 1;
  for (const per of perCell) {
    if (eventFood && per.rawFood) {
      per.rawFood *= foodScale;
      per.mods.push({ id: 'event', pct: eventFood / farmFood, res: 'food' });
    }
    if (eventCrude && per.rawCrude) {
      per.rawCrude *= oilScale;
      per.mods.push({ id: 'event', pct: eventCrude / crude, res: 'oil' });
    }
  }
  farmFood += eventFood;
  crude += eventCrude;

  // Refineries make oil of their own: REFINERY_SHARE × the crude of each staffed Oil Station next to them
  // (after the year event, so Oil Boom helps them too). Stations further away are not affected.
  const REFINERY_SHARE = TERRAINS.refinery.stats.oilMultiplierPerAdjacent.station;
  const crudeAt = new Map(perCell.filter((p) => p.terrain === 'station' && p.rawCrude).map((p) => [`${p.x},${p.z}`, p.rawCrude]));
  for (const per of refineries) {
    let fromStations = 0;
    per.links = []; // each adjacent station's crude, so the card can list them
    for (const [dx, dz] of DIRS) {
      const c = crudeAt.get(`${per.x + dx},${per.z + dz}`);
      if (c) {
        fromStations += c;
        per.links.push(c);
        refineryLinks++;
      }
    }
    per.rawCrude = REFINERY_SHARE * fromStations;
    refineryCrude += per.rawCrude;
  }
  crude += refineryCrude;

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

  // Taxed settlements pay oil straight into the season's yield.
  const taxOil = (mods.settlementOil ?? 0) * (counts.settlement ?? 0);
  const oilMade = Math.round(crude * fed) + taxOil;
  // Siphoners tap the pipelines: a share of this season's oil (never below 0).
  const banditOil = camps.oil * SCALE.banditOil;
  const oilStolen = Math.min(oilMade, banditOil);
  const factoryOil = (counts.milfactory ?? 0) * FACTORY_OIL;
  for (const per of perCell) if (per.terrain === 'milfactory') per.oil -= FACTORY_OIL;
  // Intercept Networks are kept manned out of the season's oil (they never run out of rounds in a fight).
  const interceptOil = (counts.intercept ?? 0) * (INTERCEPT.upkeep ?? 0);
  for (const per of perCell) if (per.terrain === 'intercept') per.oil -= INTERCEPT.upkeep ?? 0;
  const oil = oilMade - oilStolen - interceptOil;

  // Per-tile: farms grow at the staffing rate; final oil is shared out over stations by their crude
  // (largest remainder, so the per-tile numbers add up exactly to the total).
  shareOut(perCell, 'rawCrude', 'oil', oilMade);
  // Each Siphoner camp shows its part of what was taken.
  splitOver(perCell, 'oil', 'oil', -oilStolen);
  // Grown food (after upkeep was already counted) rounded so the tiles add up to the shown balance.
  const upkeep = perCell.reduce((s, p) => s + p.food, 0);
  shareOut(perCell, 'rawFood', 'food', Math.round(foodBalance) - upkeep);

  // What each booster adds this season, in whole food / oil: its share of the building it boosts (never more
  // than that building made). The payout shows it over the booster instead of the building (`shares`), and the
  // map icons show the same number (`boosts`). A refinery's is simply the oil it makes itself.
  const shares = []; // { from: building cell key, to: booster cell key, food?, oil? }
  const boosts = new Map(); // booster cell key -> amount
  const left = new Map(); // building's perCell entry -> output not yet given to a booster
  for (const c of credits) {
    const total = Math.max(0, c.from[c.res]);
    const rest = left.get(c.from) ?? total;
    const n = Math.min(rest, Math.round(total * c.ratio));
    left.set(c.from, rest - n);
    if (n <= 0) continue;
    shares.push({ from: `${c.from.x},${c.from.z}`, to: c.to, [c.res]: n });
    boosts.set(c.to, (boosts.get(c.to) ?? 0) + n);
  }
  for (const per of refineries) if (per.oil > 0) boosts.set(`${per.x},${per.z}`, per.oil);

  // Own yield (whole numbers that add up): food grown, and oil after hunger, before tax and theft
  // are spread across the city. The payout below still uses `food` / `oil` for the hop numbers.
  shareOut(perCell, 'rawFood', 'outFood', Math.max(0, foodGrown));
  shareOut(perCell, 'rawCrude', 'outOil', Math.round(Math.max(0, crude) * fed));
  for (const per of refineries) {
    if (!per.links?.length) continue;
    for (const oil of apportion(per.links, per.outOil || 0)) {
      if (oil > 0) per.mods.push({ id: 'station', oil });
    }
  }
  if (fed < 0.999) {
    for (const per of perCell) if (per.terrain === 'station' && per.rawCrude > 0) per.mods.push({ id: 'hunger', fed });
  }
  for (const g of grants) {
    if (g.res === 'food') g.amount *= foodScale;
    if (g.res === 'oil') g.amount *= oilScale * fed;
  }
  const grantsAt = new Map();
  for (const g of grants) {
    const list = grantsAt.get(g.to) ?? [];
    list.push(g);
    grantsAt.set(g.to, list);
  }
  for (const per of perCell) {
    const list = grantsAt.get(`${per.x},${per.z}`);
    if (!list) continue;
    per.grants = list
      .map((g) => ({
        terrain: g.terrain,
        food: g.res === 'food' ? Math.round(g.amount) : 0,
        oil: g.res === 'oil' ? Math.round(g.amount) : 0,
      }))
      .filter((g) => g.food || g.oil);
  }

  for (const per of perCell) {
    delete per.rawFood;
    delete per.rawCrude;
    delete per.links;
  }

  return {
    perCell,
    shares,
    boosts,
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
    factoryOil,
    interceptOil,
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
    refineryCrude: Math.round(refineryCrude * 10) / 10, // before hunger, like crude
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

/** Whole parts of `total` in proportion to `weights`, summing to `total` (0 when there is nothing to split). */
function apportion(weights, total) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  let given = 0;
  const parts = weights.map((w) => {
    const exact = (total * w) / sum;
    const base = Math.floor(exact);
    given += base;
    return { base, rem: exact - base };
  });
  const order = parts.map((p, i) => i).sort((a, b) => parts[b].rem - parts[a].rem);
  for (let n = 0; given < total; n++, given++) parts[order[n % order.length]].base++;
  return parts.map((p) => p.base);
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

/**
 * Tribute quota for the first year. Raised 30% for the hex board: 6 neighbours make about 20% more oil than the
 * old square grid did (measured every year of a 6-year run), plus a little extra so it's tighter than before.
 */
export const FIRST_QUOTA = 26;
/** Each year the quota is multiplied by this, then QUOTA_STEP is added (26 → 65 → 124 → 212 …). */
const QUOTA_GROWTH = 1.5;
const QUOTA_STEP = 26;
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

/** Season names in the current language: SEASONS[i] is read when it's shown, so it follows a language switch. */
const SEASON_NAMES = [
  ['Spring', '春'],
  ['Summer', '夏'],
  ['Autumn', '秋'],
  ['Winter', '冬'],
];
export const SEASONS = SEASON_NAMES.map(([en]) => en);
SEASON_NAMES.forEach(([en, zh], i) => Object.defineProperty(SEASONS, i, { get: () => L(en, zh), enumerable: true }));
