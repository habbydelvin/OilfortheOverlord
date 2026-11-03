import { DIRS, key, hexesAround } from './grid.js';
import { TERRAINS, isBuilding } from './tiles.js';
import { INTERCEPT, interceptorsNear } from './arsenal.js';
import { MISSILE } from './missiles.js';

/**
 * The attack phase: every city's queued strikes resolved together, after the season is scored. No rendering here:
 * resolve() decides every result up front and returns them for the War Map playback (globeView.playAttack) and
 * for the board (main.js applies the player's craters with its own cinematic).
 *
 * Rules, the same for every city:
 *  - Blast is the aimed tile plus `size` extra neighbouring tiles (debug blast + Warhead Institutes).
 *  - Each Intercept Network within INTERCEPT_RANGE (2) of the footprint gets one shot per attack phase: INTERCEPT_OIL from the
 *    defender's stockpile, INTERCEPT_CHANCE to stop the whole strike. A miss lets the next unused network try.
 *  - A hit turns the tiles into Toxic Craters. A hit on the Capital costs it HP (1, or 2 for a warhead) instead;
 *    at 0 the city is eliminated.
 */

export const CAPITAL_HP = 5;
/** Rivals hold their fire at the player before this year (the tutorial and first year stay calm). */
export const GRACE_ROUNDS = 1;

export function footprint(kind, [x, z], size, grid, taken) {
  const extra = size ?? (kind === 'missile2' ? 1 : 0);
  const n = Math.max(1, 1 + extra);
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

/** BFS from `origin` over tiles that exist on `grid`, up to `n` cells (a salvo fan). */
export function spreadFrom(grid, origin, n) {
  const out = [];
  const seen = new Set();
  const q = [origin];
  while (q.length && out.length < n) {
    const [x, z] = q.shift();
    const k = key(x, z);
    if (seen.has(k)) continue;
    seen.add(k);
    if (grid.has(x, z)) out.push([x, z]);
    for (const [dx, dz] of DIRS) q.push([x + dx, z + dz]);
  }
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
    cities.map((c) => [c.id, { oil: c.oil, hp: c.hp, alive: c.alive, used: new Set(), dead: new Set(), result: { oilSpent: 0, hpLost: 0, craters: [], eliminated: false } }]),
  );
  // Launch order: round robin over the attackers, so no one city's whole salvo lands first.
  const queues = new Map();
  for (const s of strikes) {
    if (!queues.has(s.from)) queues.set(s.from, []);
    queues.get(s.from).push(s);
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

  const out = [];
  for (const s of order) {
    const def = byId.get(s.to);
    const st = state.get(s.to);
    const rec = { ...s, cells: s.cells ?? footprint(s.kind, s.at, s.size, st.grid), shots: [], hit: false, lost: [], capital: null, eliminated: false };
    out.push(rec);
    // Every missile is already in the air: one whose own city falls this phase still lands.
    if (!def || !st || !st.alive) {
      rec.fizzled = true; // the target already fell this phase
      continue;
    }
    const grid = def.grid;
    const tileAt = (x, z) => {
      if (st.dead.has(key(x, z))) return 'crater';
      return grid.get(x, z)?.terrain;
    };

    // Interception: every unused live network next to the footprint, in turn, while the oil lasts.
    const nets = [];
    for (const [x, z] of rec.cells) {
      for (const n of interceptorsNear(grid, x, z)) {
        const k = key(n.x, n.z);
        if (st.used.has(k) || st.dead.has(k) || nets.some((m) => m.k === k)) continue;
        nets.push({ k, x: n.x, z: n.z });
      }
    }
    let stopped = false;
    for (const n of nets) {
      if (st.oil < INTERCEPT.oil) break;
      st.oil -= INTERCEPT.oil;
      st.result.oilSpent += INTERCEPT.oil;
      st.used.add(n.k);
      const success = rng() < INTERCEPT.chance;
      rec.shots.push({ x: n.x, z: n.z, success });
      if (success) {
        stopped = true;
        break;
      }
    }
    if (stopped) continue;

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
  return { strikes: out, results };
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
