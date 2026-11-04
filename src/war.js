import { DIRS, key, hexesAround, hexToWorld } from './grid.js';
import { simulateDefence, missilePath, missileHp, mulberry, splitTime, decoyFakes, makeWeave } from './interceptSim.js';
import { TERRAINS, isBuilding } from './tiles.js';
import { MISSILE } from './missiles.js';
import { assignLaunchers, BOOST } from './arsenal.js';

/**
 * The attack phase: every city's queued strikes resolved together, after the season is scored. No rendering here:
 * resolve() decides every result up front and returns them for the War Map playback (globeView.playAttack) and
 * for the board (main.js applies the player's craters with its own cinematic).
 *
 * Rules, the same for every city:
 *  - Blast is the aimed tile plus `size` extra neighbouring tiles (staffed Warhead Institutes; the debug blast slider is combat-test only).
 *  - Intercept Networks are simulated (interceptSim.js): turrets turn, fire one stream each, and missiles with hidden
 *    HP burst when the rounds wear them down. Upkeep is paid in the season's oil (economy.js), not per shot.
 *  - A hit turns the tiles into Toxic Craters. A hit on the Capital costs it HP (1, or 2 for a warhead) instead;
 *    at 0 the city is eliminated.
 */

export const CAPITAL_HP = 5;
/**
 * War Map clock. A city fires in volleys: one missile per Missile Magazine at once (at least one launcher), the
 * next volley VOLLEY_GAP later as the magazines reload. Each missile lands about TRAVEL seconds after it leaves.
 */
export const TRAVEL = 6;
export const VOLLEY_GAP = 1.2;
const LAUNCH_JITTER = 0.12; // a volley leaves within this (not in lockstep)
const TRAVEL_JITTER = 0.6; // flight times differ a little, so a volley doesn't land as one
/** Rivals hold their fire at the player before this year (the tutorial and first year stay calm). */
export const GRACE_ROUNDS = 1;

export function footprint(kind, [x, z], size, grid, taken) {
  const extra = kind === 'decoy' ? 0 : (size ?? (kind === 'missile2' ? 1 : 0)); // a decoy marks just its aim
  const n = 1 + Math.max(0, extra);
  const around = hexesAround(x, z, 5);
  if (!grid || n <= 1) return around.slice(0, n);
  const origin = around[0];
  const rest = around.slice(1);
  const marked = (cx, cz) => taken?.has(key(cx, cz));
  const rank = ([cx, cz]) => {
    const t = grid.get(cx, cz)?.terrain;
    if (t && isBuilding(t) && !marked(cx, cz)) return 0;
    if (t && isBuilding(t)) return 1;
    if (t) return 2;
    return 3;
  };
  rest.sort((a, b) => rank(a) - rank(b));
  return [origin, ...rest].slice(0, n);
}

/**
 * BFS from `origin` over tiles that exist on `grid`, `n` cells (a salvo fan). It only spreads through the city's own
 * tiles, so it always ends; with more missiles than tiles, the rest stack on the same tiles again (nearest first).
 */
export function spreadFrom(grid, origin, n) {
  const out = [];
  const seen = new Set();
  const q = [origin];
  while (q.length && out.length < n && seen.size < 4000) {
    const [x, z] = q.shift();
    const k = key(x, z);
    if (seen.has(k)) continue;
    seen.add(k);
    const onGrid = grid.has(x, z);
    if (onGrid) out.push([x, z]);
    // Spread only from city tiles (and from the aimed cell itself, in case it's off the city).
    if (onGrid || out.length === 0) for (const [dx, dz] of DIRS) q.push([x + dx, z + dz]);
  }
  const unique = out.length;
  for (let i = 0; unique && out.length < n; i++) out.push([...out[i % unique]]);
  return out;
}

/**
 * city: { id, grid, oil, hp, alive }. `oil` and `hp` are read here and written back by the caller from the
 * results (results.get(id): { oilSpent, hpLost, craters: [{ x, z, terrain }], eliminated }).
 * strikes: [{ from, to, at: [x, z], kind }]. rng: () => 0..1.
 */
export function resolve(strikes, cities, rng = Math.random) {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const state = new Map(
    cities.map((c) => [c.id, { oil: c.oil, hp: c.hp, alive: c.alive, used: new Map(), dead: new Set(), result: { oilSpent: 0, hpLost: 0, craters: [], eliminated: false } }]),
  );
  // Launch order: round robin over the attackers, so no one city's whole salvo lands first.
  const queues = new Map();
  for (const s of strikes) {
    if (!queues.has(s.from)) queues.set(s.from, []);
    queues.get(s.from).push(s);
  }
  // Where each strike launches from (Magazines, Decoy Works; next to a Launch Accelerator first).
  const launchAt = new Map();
  for (const [from, q] of queues) {
    const city = byId.get(from);
    assignLaunchers(city?.grid, q, city?.idle).forEach((l, i) => launchAt.set(q[i], l));
  }
  const order = [];
  for (let more = true; more; ) {
    more = false;
    for (const q of queues.values()) {
      if (!q.length) continue;
      order.push(q.shift());
      more = true;
    }
  }

  // Every missile's real flight: launch, path, landing time on the War Map clock (globeView plays the same times).
  const flight = MISSILE.followFlight ?? 2.2;
  const accel = MISSILE.accel ?? 1.4;
  const launchers = new Map(); // attacker id -> magazines (launch slots per volley)
  const fired = new Map(); // launcher (or attacker, counted mode) -> missiles launched so far
  // city.magazines overrides the count on its grid (the combat test's table).
  for (const c of cities) launchers.set(c.id, Math.max(1, c.magazines ?? [...c.grid.cells.values()].filter((t) => t.terrain === 'magazine').length));
  const out = order.map((s, i) => {
    const st = state.get(s.to);
    const def = byId.get(s.to);
    const cells = s.cells ?? footprint(s.kind, s.at, s.size, def?.grid);
    const w = hexToWorld(s.at[0], s.at[1]);
    const launcher = launchAt.get(s) ?? null;
    const boosted = !!(launcher?.boosted || s.boosted);
    const travel = TRAVEL * (boosted ? BOOST.travel : 1);
    const dive = flight * (boosted ? BOOST.flight : 1);
    // Each launcher (Magazine, Decoy Works) fires its own strikes one per volley, so decoys from a Decoy Works go
    // up alongside the magazines' first volley instead of taking their slots. city.magazines (the combat test's
    // table) keeps the old shared count.
    const byCount = (byId.get(s.from)?.magazines != null || !launcher) && s.kind !== 'decoy';
    const lk = launcher ? `${s.from}|${launcher.x},${launcher.z}` : null;
    const rk = `${s.from}|real`;
    const slot = byCount ? Math.floor((fired.get(rk) ?? 0) / (launchers.get(s.from) ?? 1)) : (fired.get(lk) ?? 0);
    if (byCount) fired.set(rk, (fired.get(rk) ?? 0) + 1);
    else if (lk) fired.set(lk, (fired.get(lk) ?? 0) + 1);
    const launch = slot * VOLLEY_GAP + rng() * LAUNCH_JITTER;
    const land = launch + travel + rng() * TRAVEL_JITTER;
    const decoy = s.kind === 'decoy';
    const rec = { ...s, cells, shots: [], hit: false, lost: [], capital: null, eliminated: false, launch, land, t0: land - dive, flight: dive, accel, path: missilePath(w.x, w.z, MISSILE, rng), hp: missileHp(s.kind), id: i, launcher, boosted, _st: st };
    // A boosted missile weaves on its way down (its fakes, after a split, fly straight).
    if (boosted) rec.weave = makeWeave(rec.path, rng);
    if (decoy) {
      // It splits short of the target: its fakes fly the rest, all harmless.
      rec.decoy = true;
      rec.harmless = true;
      rec.splitAt = splitTime(rec);
      rec.endAt = rec.splitAt;
      rec.fakes = decoyFakes(rec, rng).map((f, j) => ({ ...f, id: `${i}.${j}`, parent: i, harmless: true, kind: 'fake', to: s.to, from: s.from }));
    }
    return rec;
  });

  // Each city's Intercept Networks fight the missiles coming at it, for real (interceptSim.js).
  const sims = new Map();
  for (const c of cities) {
    const incoming = out.filter((r) => r.to === c.id);
    if (!incoming.length || !c.alive) continue;
    const nets = [...c.grid.cells.values()].filter((t) => t.terrain === 'intercept').map((t) => ({ x: t.x, z: t.z }));
    const fakes = incoming.flatMap((r) => r.fakes ?? []);
    const sim = simulateDefence([...incoming, ...fakes], nets, mulberry(Math.floor(rng() * 4294967296)));
    sims.set(c.id, sim);
    for (const r of [...incoming, ...fakes]) {
      const o = sim.missiles.get(r.id);
      if (o?.void) r.void = true;
      if (!o?.killed) continue;
      r.killed = true;
      r.killAt = o.tKill;
      r.killPos = o.pos;
      if (o.by) r.shots?.push({ x: o.by.x, z: o.by.z, success: true });
    }
    // Rounds each decoy drew (its own and its fakes'), for the war report.
    for (const r of incoming) if (r.decoy) r.drew = (r.killed ? 1 : 0) + r.fakes.filter((f) => f.killed).length;
  }

  // Then the landings, in the order they touch down.
  for (const rec of [...out].sort((a, b) => a.land - b.land)) {
    const st = rec._st;
    delete rec._st;
    const def = byId.get(rec.to);
    // Every missile is already in the air: one whose own city falls this phase still lands.
    if (!def || !st || !st.alive) {
      rec.fizzled = true; // the target already fell this phase
      continue;
    }
    const s = rec;
    const grid = def.grid;
    const tileAt = (x, z) => {
      if (st.dead.has(key(x, z))) return 'crater';
      return grid.get(x, z)?.terrain;
    };
    if (rec.killed || rec.decoy) continue;

    rec.hit = true;
    let capitalHit = false;
    for (const [x, z] of rec.cells) {
      const t = tileAt(x, z);
      if (!t || t === 'crater') continue;
      if (t === 'capital') {
        capitalHit = true;
        continue;
      }
      st.dead.add(key(x, z));
      rec.lost.push({ x, z, terrain: t, name: TERRAINS[t]?.name ?? t });
      st.result.craters.push({ x, z, terrain: t });
    }
    if (capitalHit) {
      const dmg = s.power ?? MISSILE.damage ?? 1;
      st.hp = Math.max(0, st.hp - dmg);
      st.result.hpLost += dmg;
      rec.capital = st.hp;
      if (st.hp <= 0) {
        st.alive = false;
        st.result.eliminated = true;
        rec.eliminated = true;
      }
    }
  }

  const results = new Map([...state].map(([id, s]) => [id, s.result]));
  return { strikes: out, results, sims };
}

/** Write a resolved phase back onto a rival: craters on its grid, oil spent, HP, elimination. */
export function applyToRival(rival, result) {
  if (!result) return;
  for (const c of result.craters) rival.grid.set(c.x, c.z, { terrain: 'crater' });
  // Its Wasteland piece models no longer cover a cratered cell: drop those pieces to single tiles.
  if (result.craters.length) {
    const hit = new Set(result.craters.map((c) => key(c.x, c.z)));
    rival.pieces = (rival.pieces ?? []).filter((p) => !p.cells.some(([x, z]) => hit.has(key(x, z))));
  }
  rival.oil = Math.max(0, (rival.oil ?? 0) - result.oilSpent);
  rival.capitalHp = Math.max(0, (rival.capitalHp ?? CAPITAL_HP) - result.hpLost);
  if (result.eliminated) rival.alive = false;
  rival.version = (rival.version ?? 0) + 1;
}
