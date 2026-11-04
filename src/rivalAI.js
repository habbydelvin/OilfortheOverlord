import { throughEstimate } from './interceptSim.js';
import { DIRS, key, hexDistance } from './grid.js';
import { TERRAINS, MILITARY } from './tiles.js';
import { SHAPES, ROTATIONS, rotateCells } from './pieces.js';
import { computeEconomy } from './economy.js';
import { FACTORY_OIL, INTERCEPT_OIL, INTERCEPT, factoryYield, interceptorsBeside, interceptorsNear, missileCapacity, blastExtra } from './arsenal.js';
import { hexesAround } from './grid.js';

/**
 * Rival city-states play the same game as the player, one hand per season: the same cards, piece shapes and
 * placement rules (inside the world, on empty cells, touching their land), with Wasteland that has to be placed.
 * No action cards, shop or mystery sites. Every roll comes from the rival's own seeded rng.
 *
 * Placing is greedy: Wasteland first (where it opens the most new room), then the building that adds the most
 * (computeEconomy before and after, weighed by personality), again and again until nothing in hand helps.
 */

export const HAND_SIZE = 5;
/** Same guaranteed opening hand as the player. */
const OPENING_HAND = ['farm', 'settlement', 'station', 'wasteland', 'wasteland'];
const WASTELAND = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4'];
const isWaste = (t) => t.startsWith('wasteland');

/** Shop cards that start locked for the player too; a rival unlocks one each year, in its own order. */
const LOCKED = ['pump', 'oasis', 'tarpit', 'labourcamp', 'refinery', 'milfactory', 'missilelab', 'warhead', 'intercept', 'magazine'];

/**
 * draw: extra draw weight per card (× the card's normal weight).
 * value: what a point of oil / food balance / spare manpower is worth when choosing where to build.
 * unlocks: the order it "buys" the locked cards, one per year.
 * missile / defense: how much it wants to arm (factories, labs, warheads, magazines) and to shield
 * (Intercept Networks). A Hawk arms from year 2; the Synod shields first; the Merchant arms late.
 */
export const PERSONAS = {
  hawk: {
    draw: { settlement: 2.5, refinery: 2.5, station: 1.3, milfactory: 4, missilelab: 4, warhead: 4, magazine: 5 },
    value: { oil: 1.2, food: 0.45, manpower: 0.9 },
    missile: 5,
    defense: 1.2,
    unlocks: ['milfactory', 'refinery', 'magazine', 'missilelab', 'warhead', 'labourcamp', 'intercept', 'tarpit', 'pump', 'oasis'],
  },
  merchant: {
    draw: { station: 2.2, pump: 2, refinery: 1.8, tarpit: 2, intercept: 1.5 },
    value: { oil: 1.4, food: 0.4, manpower: 0.7 },
    missile: 2.5,
    defense: 1.5,
    unlocks: ['pump', 'tarpit', 'refinery', 'intercept', 'milfactory', 'oasis', 'magazine', 'labourcamp', 'missilelab', 'warhead'],
  },
  paranoid: {
    draw: { farm: 2.2, settlement: 2, pump: 2, oasis: 2, intercept: 4, milfactory: 1.5 },
    value: { oil: 0.9, food: 0.8, manpower: 0.9 },
    missile: 3,
    defense: 3.5,
    unlocks: ['intercept', 'pump', 'oasis', 'milfactory', 'labourcamp', 'magazine', 'refinery', 'missilelab', 'tarpit', 'warhead'],
  },
};

const persona = (rival) => PERSONAS[rival.def.personality] ?? PERSONAS.hawk;

function weighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Cards the rival may draw this season (no action cards; locked cards until it has "bought" them). */
function drawPool(rival) {
  const p = persona(rival);
  const owned = new Set(p.unlocks.slice(0, Math.max(0, rival.round - 1)));
  const out = [];
  for (const [k, def] of Object.entries(TERRAINS)) {
    if (!(def.weight > 0)) continue;
    if (LOCKED.includes(k) && !owned.has(k)) continue;
    if (k === 'cliffs' && rival.round === 1) continue;
    out.push([k, def.weight * (p.draw[k] ?? 1)]);
  }
  return out;
}

function makePiece(rival, terrain) {
  const rng = rival.rng;
  if (!isWaste(terrain)) return { shape: 'mono', terrain, rot: 0 };
  const shape = weighted(rng, Object.entries(SHAPES).map(([k, s]) => [k, s.weight]));
  return { shape, terrain: 'wasteland', rot: Math.floor(rng() * ROTATIONS) };
}

export function dealHand(rival, opening = false) {
  if (opening) return OPENING_HAND.map((t) => makePiece(rival, t));
  const pool = drawPool(rival);
  return Array.from({ length: HAND_SIZE }, () => makePiece(rival, weighted(rival.rng, pool)));
}

// ---------- legal placements ----------

/** The same rules as Placement.validate for a tile piece in free mode. */
export function isLegal(grid, cells) {
  if (cells.some(([x, z]) => !grid.allowed(x, z) || grid.has(x, z))) return false;
  return cells.some(([x, z]) => grid.touchesIsland(x, z));
}

/** Every distinct legal footprint of a shape, in every rotation: [{ rot, cells }]. */
function footprints(grid, shape) {
  const out = [];
  const seen = new Set();
  const open = [...grid.frontierKeys()].map((k) => k.split(',').map(Number));
  const turns = shape === 'mono' ? 1 : ROTATIONS;
  for (let rot = 0; rot < turns; rot++) {
    const cells = rotateCells(SHAPES[shape].cells, rot);
    for (const [ax, az] of open) {
      for (const [cx, cz] of cells) {
        const placed = cells.map(([x, z]) => [ax + x - cx, az + z - cz]);
        const id = `${rot}|${placed.map(([x, z]) => key(x, z)).sort().join(';')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (isLegal(grid, placed)) out.push({ rot, cells: placed });
      }
    }
  }
  return out;
}

// ---------- scoring ----------

/** What the city is worth to this rival right now (one season of the economy), and how many buildings sit idle. */
function worth(rival, grid) {
  const v = persona(rival).value;
  const e = computeEconomy(grid, { foodStore: rival.foodStore });
  const value = v.oil * e.oilMade + v.food * Math.max(-12, Math.min(6, e.foodBalance)) + v.manpower * Math.min(3, Math.max(0, e.free));
  return { value, idle: e.idle, fed: e.fed, e };
}

const BUILD_BONUS = 0.8;

const CORE = new Set(['capital', 'farm', 'station', 'refinery', 'settlement', 'pump', 'oasis', 'tarpit', 'labourcamp', ...MILITARY]);

/** Buildings worth shielding most: losing them hurts. */
const PRECIOUS = { capital: 3, refinery: 1.5, milfactory: 1.5, station: 1, farm: 0.6, settlement: 0.6 };

/**
 * What a military building at (x, z) is worth to this rival, beyond the economy (which only sees a factory's
 * oil bill and the workers they take). `threat`: missiles the rival has seen others hold (scales defence).
 */
function militaryValue(rival, grid, terrain, x, z, e) {
  const p = persona(rival);
  const near = DIRS.map(([dx, dz]) => grid.get(x + dx, z + dz)).filter(Boolean);
  const count = (t) => near.filter((n) => n.terrain === t).length;
  const factories = [...grid.cells.values()].filter((c) => c.terrain === 'milfactory').length;
  const surplus = e.oilMade - FACTORY_OIL * factories;
  switch (terrain) {
    case 'milfactory':
      // Only while the oil can pay its bill (and a little to spare); each extra factory a bit less.
      // No more factories than the arsenal can hold: a full magazine leaves them idle and paying for nothing.
      if (surplus < FACTORY_OIL + 2 || factories >= missileCapacity(grid)) return -5;
      return p.missile / (1 + factories) ** 2 + 1.2 * (count('missilelab') + count('warhead'));
    case 'missilelab':
    case 'warhead': {
      // Only next to a factory without one already.
      const lonely = near.filter((n) => n.terrain === 'milfactory' && !DIRS.some(([dx, dz]) => grid.get(n.x + dx, n.z + dz)?.terrain === terrain));
      return lonely.length ? p.missile * 0.7 * lonely.length : -5;
    }
    case 'magazine': {
      const cap = missileCapacity(grid);
      // Room for what the factories will make.
      return factories >= cap - 1 || rival.missiles.length >= cap - 1 ? p.missile * 0.8 : -5;
    }
    case 'intercept': {
      // What it would cover (INTERCEPT_RANGE) that no network covers yet.
      let cover = 0;
      for (const [cx, cz] of hexesAround(x, z, INTERCEPT.range)) {
        const n = grid.get(cx, cz);
        if (n && !interceptorsNear(grid, cx, cz).length) cover += PRECIOUS[n.terrain] ?? 0;
      }
      cover *= 0.45;
      const threat = 1 + Math.min(2, (rival.threat ?? 0) / 4);
      return cover ? p.defense * threat * (0.35 * cover) - 1 : -5;
    }
  }
  return 0;
}

/**
 * Wasteland: open new room at the edge (more frontier), keep the city together, and don't bury the good
 * cells (next to the Capital or next to buildings, where boosts land).
 */
function wasteScore(grid, frontier, cells, rng) {
  const mine = new Set(cells.map(([x, z]) => key(x, z)));
  const added = new Set();
  let gain = 0;
  let buried = 0;
  let dist = 0;
  let hug = 0;
  for (const [x, z] of cells) {
    if (frontier.has(key(x, z))) gain--; // no longer open
    dist += hexDistance(x, z);
    for (const [dx, dz] of DIRS) {
      const n = grid.get(x + dx, z + dz);
      if (n) hug++;
      if (n?.terrain === 'capital') buried += 4;
      else if (n && CORE.has(n.terrain)) buried += 1;
      const k = key(x + dx, z + dz);
      if (!n && !mine.has(k) && !frontier.has(k) && !added.has(k) && grid.allowed(x + dx, z + dz)) {
        added.add(k);
        gain++;
      }
    }
  }
  // Hugging the land (filling bays) and staying close count for more than raw new room, so the city grows as
  // a blob rather than in tendrils.
  return 0.4 * gain + 0.3 * hug - buried - 0.3 * (dist / cells.length) + rng() * 0.6;
}

/**
 * Cells whose neighbours are the same buildings (and the same number of filler tiles) score the same for a
 * building: the economy only looks next door. Saves running computeEconomy for every frontier cell.
 */
function neighbourhood(grid, x, z) {
  let junk = 0;
  const near = [];
  for (const [dx, dz] of DIRS) {
    const n = grid.get(x + dx, z + dz);
    if (!n) continue;
    if (CORE.has(n.terrain)) near.push(key(n.x, n.z));
    else junk += n.terrain === 'crater' ? 100 : 1;
  }
  return `${near.sort().join(';')}|${junk}`;
}

function place(rival, piece, cells) {
  const { grid, rng } = rival;
  for (const [x, z] of cells) {
    const terrain = isWaste(piece.terrain) ? WASTELAND[Math.floor(rng() * WASTELAND.length)] : piece.terrain;
    grid.set(x, z, { terrain });
  }
  if (isWaste(piece.terrain)) rival.pieces.push({ shape: piece.shape, rot: piece.rot, cells: cells.map((c) => [...c]) });
  rival.log?.push({ terrain: piece.terrain, shape: piece.shape, rot: piece.rot, cells });
}

/** Play one hand on the rival's grid. Returns the pieces placed. */
export function playHand(rival, hand) {
  const { grid, rng } = rival;
  let placed = 0;

  // Wasteland has to go down.
  for (const piece of hand.filter((p) => isWaste(p.terrain))) {
    let best = null;
    let bestScore = -Infinity;
    const frontier = grid.frontierKeys();
    for (const f of footprints(grid, piece.shape)) {
      const s = wasteScore(grid, frontier, f.cells, rng);
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    }
    if (!best) continue;
    piece.rot = best.rot;
    place(rival, piece, best.cells);
    placed++;
  }

  // Then the best building, one at a time, while one still pays its way. A building is worth a little on its
  // own (BUILD_BONUS): it grows the city and sets up later boosts, as a player would place it.
  const rest = hand.filter((p) => !isWaste(p.terrain) && p.terrain !== 'cliffs');
  while (rest.length) {
    const base = worth(rival, grid);
    let best = null;
    const open = [...grid.frontierKeys()].map((k) => k.split(',').map(Number)).filter(([x, z]) => isLegal(grid, [[x, z]]));
    const byPlace = open.map(([x, z]) => neighbourhood(grid, x, z));
    rest.forEach((piece, i) => {
      if (rest.findIndex((p) => p.terrain === piece.terrain) !== i) return; // same card twice scores the same
      const cache = new Map();
      open.forEach(([x, z], j) => {
        let gain = cache.get(byPlace[j]);
        if (gain === undefined) {
          grid.set(x, z, { terrain: piece.terrain });
          const after = worth(rival, grid);
          grid.cells.delete(key(x, z));
          // The bonus only for a building that would actually run (no new idle building, nobody starving).
          const runs = after.idle <= base.idle && after.fed >= Math.min(1, base.fed);
          gain = after.value - base.value + (runs ? BUILD_BONUS : 0);
          // Arms and shields: worth their own reasons (the economy only sees their costs). Idle ones are worthless.
          if (MILITARY.has(piece.terrain)) gain += runs ? militaryValue(rival, grid, piece.terrain, x, z, base.e) : -5;
          cache.set(byPlace[j], gain);
        }
        const score = gain - 0.04 * hexDistance(x, z) + rng() * 0.05;
        if (!best || score > best.score) best = { i, x, z, score };
      });
    });
    if (!best || best.score <= 0) break;
    place(rival, rest[best.i], [[best.x, best.z]]);
    rest.splice(best.i, 1);
    placed++;
  }

  // The season's food goes into (or comes out of) the store, and its oil into the stockpile, as for the player.
  const e = computeEconomy(grid, { foodStore: rival.foodStore });
  rival.foodStore = e.storeAfter;
  rival.oil = (rival.oil ?? 0) + e.oil;
  runFactories(rival, e);
  return placed;
}

/**
 * The player's runFactories for a rival: each Military Factory pays FACTORY_OIL a season from the stockpile;
 * after a year of work it hands its missiles (factoryYield) to the arsenal, or waits, full, if there's no room.
 */
export function runFactories(rival, e = computeEconomy(rival.grid, { foodStore: rival.foodStore })) {
  const { grid } = rival;
  const need = rival.yearLength ?? 4;
  const idle = new Set(e.perCell.filter((p) => p.idle).map((p) => `${p.x},${p.z}`));
  const cap = missileCapacity(grid, idle);
  rival.missiles ??= [];
  for (const cell of grid.cells.values()) {
    if (cell.terrain !== 'milfactory') continue;
    if ((cell.missileProgress ?? 0) >= need) {
      const y = factoryYield(grid, cell, idle);
      let made = 0;
      while (made < y.count && rival.missiles.length < cap) {
        rival.missiles.push(y.kind);
        made++;
      }
      if (made) cell.missileProgress = 0;
      continue;
    }
    if (rival.oil < FACTORY_OIL) continue;
    rival.oil -= FACTORY_OIL;
    cell.missileProgress = (cell.missileProgress ?? 0) + 1;
  }
}

/**
 * An incoming hit on the rival's tile (x, z): an unused Intercept Network next to it spends INTERCEPT_OIL to stop
 * it, as the player's tryIntercept does. `used`: network keys already spent this strike. True if stopped.
 */
export function rivalIntercept(rival, x, z, used = new Set()) {
  const nets = interceptorsBeside(rival.grid, x, z).filter((n) => !used.has(`${n.x},${n.z}`));
  if (!nets.length || (rival.oil ?? 0) < INTERCEPT_OIL) return false;
  rival.oil -= INTERCEPT_OIL;
  used.add(`${nets[0].x},${nets[0].z}`);
  return true;
}

// ---------- war: tension and targeting ----------

/**
 * aggression: tension toward everyone it never fades below. retaliate: tension per hit taken from a city.
 * reserve: missiles kept back. capitalOdds: how good the odds must be before it aims at a Capital.
 */
export const WAR = {
  hawk: { aggression: 0.55, retaliate: 0.35, reserve: 0, capitalOdds: 0.3 },
  merchant: { aggression: 0.1, retaliate: 0.3, reserve: 1, capitalOdds: 0.55 },
  paranoid: { aggression: 0.2, retaliate: 0.6, reserve: 1, capitalOdds: 0.45 },
};
const FIRE_AT = 0.6; // tension needed to open fire on a city
const TENSION_FADE = 0.85; // per season

const warOf = (rival) => WAR[rival.def.personality] ?? WAR.hawk;

/** After an attack phase: hits (and attempts) against this rival raise its tension toward the attacker. */
export function noteAttacks(rival, strikes) {
  rival.tension ??= {};
  const w = warOf(rival);
  for (const s of strikes) {
    if (s.to !== rival.id || s.from === rival.id) continue;
    rival.tension[s.from] = (rival.tension[s.from] ?? 0) + (s.hit ? w.retaliate : w.retaliate * 0.5);
  }
}

/** Each season tension eases back toward the rival's own aggression. */
export function fadeTension(rival) {
  rival.tension ??= {};
  const base = warOf(rival).aggression;
  for (const k of Object.keys(rival.tension)) rival.tension[k] = base + (rival.tension[k] - base) * TENSION_FADE;
}

/** Odds a strike on (x, z) gets through: each live network next to it that the defender can pay for gets a shot. */
function throughOdds(city, x, z) {
  return throughEstimate(city.grid, x, z);
}

/**
 * This season's strikes for a rival: [{ from, to, at, kind }], taken out of rival.missiles.
 * cities: every city still standing ({ id, grid, oil, hp, alive, buildings }).
 * playerArmed: the player has unlocked a military building; until then nobody fires on Hive City.
 */
export function chooseStrikes(rival, cities, { round, chance, playerArmed = true }) {
  if (!rival.alive || !rival.missiles?.length) return [];
  rival.tension ??= {};
  const w = warOf(rival);
  const rng = rival.rng;
  const foes = cities.filter((c) => c.alive && c.id !== rival.id && !(c.id === 'player' && !playerArmed));
  if (!foes.length) return [];
  const strongest = Math.max(...foes.map((c) => c.buildings ?? 0), 1);
  let target = null;
  let best = -Infinity;
  for (const c of foes) {
    const t = Math.max(rival.tension[c.id] ?? 0, w.aggression);
    // A leading city draws fire; a wounded Capital invites the finishing blow.
    const score = t + 0.25 * ((c.buildings ?? 0) / strongest) + 0.12 * (5 - (c.hp ?? 5)) + rng() * 0.15;
    if (score > best) {
      best = score;
      target = c;
    }
  }
  if (best < FIRE_AT) return [];

  const count = Math.max(0, rival.missiles.length - w.reserve);
  const out = [];
  const aimed = new Set();
  const cap = [...target.grid.cells.values()].find((c) => c.terrain === 'capital');
  for (let i = 0; i < count; i++) {
    const kind = rival.missiles.shift();
    let at = null;
    if (cap && throughOdds(target, cap.x, cap.z, chance) >= w.capitalOdds) at = [cap.x, cap.z];
    else {
      // Its oil first (it pays for the interceptors), then anything it built; the least defended first.
      let bestCell = null;
      let bestV = -Infinity;
      for (const c of target.grid.cells.values()) {
        const t = TERRAINS[c.terrain];
        if (!t || t.category !== 'building' || c.terrain === 'capital' || aimed.has(key(c.x, c.z))) continue;
        const v = (c.terrain === 'refinery' || c.terrain === 'station' ? 2 : c.terrain === 'intercept' ? 1.6 : 1) * throughOdds(target, c.x, c.z, chance) + rng() * 0.2;
        if (v > bestV) {
          bestV = v;
          bestCell = c;
        }
      }
      if (bestCell) at = [bestCell.x, bestCell.z];
      else if (cap) at = [cap.x, cap.z];
    }
    if (!at) {
      rival.missiles.unshift(kind);
      break;
    }
    aimed.add(key(...at));
    out.push({ from: rival.id, to: target.id, at, kind, size: blastExtra(rival.grid) });
  }
  // Once it opens fire on a city, it stays wary of it.
  rival.tension[target.id] = Math.max(rival.tension[target.id] ?? 0, FIRE_AT);
  return out;
}
