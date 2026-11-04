import { hexToWorld, hexDistance } from './grid.js';
import { INTERCEPT, DECOY, BOOST } from './arsenal.js';

/**
 * Intercept Networks, simulated for real: no dice. Each incoming missile has hidden HP; each network is a turret
 * that turns at a fixed speed, locks onto ONE missile (only missiles aimed inside its range ring, and only while
 * that missile is within its gun reach in the sky), fires a single stream of rounds led at where the missile is
 * going, and moves on to a new target only once that one is down (or has landed). Rounds that pass within
 * hitRadius of a missile deal `damage`; at 0 HP it bursts in the air.
 *
 * It's deterministic (fixed step, seeded rng), so war.js runs it instantly to decide the phase and a city view
 * replays the recorded timeline (turret aim, every round, every kill) in sync with the War Map clock.
 *
 * Time: seconds from the start of the attack phase (globeView's war.t).
 */
export const SIM_DT = 1 / 60;
/** Fraction of the launch offset kept (the old screen-edge pull-in): the path the city view flies. */
const PULL = 0.45;
const UP = [0, 1, 0];

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bezier path a missile flies into (x, z) world: p0 launch, p1 control, p2 impact. cfg: MISSILE (bearing, ...). */
export function missilePath(wx, wz, cfg, rng) {
  const b = ((cfg.bearing ?? 25) * Math.PI) / 180;
  const dir = [Math.sin(b), 0, -Math.cos(b)];
  const side = [-dir[2], 0, dir[0]];
  const s = (rng() * 2 - 1) * (cfg.spread ?? 4);
  const off = [0, 1, 2].map((i) => (dir[i] * (cfg.startDistance ?? 34) + UP[i] * (cfg.startHeight ?? 26) + side[i] * s) * PULL);
  const p2 = [wx, 0, wz];
  const p0 = [wx + off[0], off[1], wz + off[2]];
  const len = Math.hypot(...off);
  const p1 = [(p0[0] + p2[0]) / 2, p0[1] / 2 + (cfg.arc ?? 0.35) * len * 0.25, (p0[2] + p2[2]) / 2];
  return { p0, p1, p2 };
}

export function bez(path, u, out = [0, 0, 0]) {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  for (let i = 0; i < 3; i++) out[i] = a * path.p0[i] + b * path.p1[i] + c * path.p2[i];
  return out;
}

/**
 * Evasive weaving (Launch Accelerator): a side-to-side swing across the flight path, zero at launch and at impact
 * (it still lands on its aim), so the turrets' lead (aimed off its velocity) points where it was going.
 * makeWeave: the swing for a path; weaveAt adds its offset at `age` seconds, path share `u`, into `out`.
 */
export function makeWeave(path, rng, amp = BOOST.weave, freq = BOOST.weaveFreq) {
  if (!(amp > 0)) return null;
  const dx = path.p2[0] - path.p0[0];
  const dz = path.p2[2] - path.p0[2];
  const len = Math.hypot(dx, dz) || 1;
  return { amp, freq, phase: rng() * Math.PI * 2, side: [-dz / len, 0, dx / len] };
}
export function weaveAt(w, age, u, out) {
  if (!w) return out;
  const s = w.amp * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.sin(2 * Math.PI * w.freq * age + w.phase);
  out[0] += w.side[0] * s;
  out[2] += w.side[2] * s;
  return out;
}

/** Missile HP by kind. */
export const missileHp = (kind) => (kind === 'missile2' ? INTERCEPT.hpWarhead : kind === 'decoy' ? DECOY.hp : INTERCEPT.hpMissile);

/** Phase time at which a decoy (t0, flight, accel) splits. */
export const splitTime = (m) => m.t0 + m.flight * Math.pow(DECOY.splitAt, 1 / (m.accel || 1));

/**
 * A decoy's fakes: each leaves the decoy's position at the split, carrying on along its heading, and dives onto a
 * cell within DECOY.spread of the aim. Returns [{ path, t0, flight, accel, at, cells, hp, fake: true }].
 */
export function decoyFakes(m, rng, cfg = DECOY) {
  const ts = splitTime(m);
  const u0 = cfg.splitAt;
  const p0 = bez(m.path, u0);
  // The decoy's velocity at the split (world units per second).
  const du = 1e-3;
  const p1a = bez(m.path, Math.min(1, u0 + du));
  // u = (age / flight)^accel, so du/dt = accel / flight · u^((accel - 1) / accel).
  const dudt = (m.accel / m.flight) * Math.pow(u0, (m.accel - 1) / m.accel);
  const v = [0, 1, 2].map((i) => ((p1a[i] - p0[i]) / du) * dudt);
  const left = Math.max(0.3, m.t0 + m.flight - ts);
  const out = [];
  for (let j = 0; j < cfg.fakes; j++) {
    const a = rng() * Math.PI * 2;
    const r = (0.6 + rng() * 0.4) * cfg.spread;
    // A cell around the aim (axial offset by angle and radius, rounded).
    const fx = Math.round(Math.cos(a) * r - (Math.sin(a) * r) / Math.sqrt(3));
    const fz = Math.round((2 * Math.sin(a) * r) / Math.sqrt(3));
    const at = [m.at[0] + fx, m.at[1] + fz];
    const w = hexToWorld(at[0], at[1]);
    const flight = left * (0.85 + rng() * 0.35);
    const p2 = [w.x, 0, w.z];
    const c1 = [0, 1, 2].map((i) => p0[i] + (v[i] * flight) / 2);
    c1[1] = Math.max(0.6, c1[1]);
    out.push({ path: { p0: [...p0], p1: c1, p2 }, t0: ts, flight, accel: 1, at, cells: [at], hp: cfg.fakeHp, fake: true });
  }
  return out;
}

/**
 * Simulate one city's defence.
 * missiles: [{ id, cells: [[x, z]...] (footprint), at: [x, z], path, t0, flight, accel, hp }]
 * turrets: [{ x, z }] (Intercept Network cells, in placement order)
 * Returns { missiles: Map(id -> { killed, tKill, pos, by }), turrets: [{ x, z, pos, aim: Float32Array (yaw,pitch per
 *   step), fire: Uint8Array }], rounds: [{ t, turret, pos, vel, life, hit }], t0, steps }.
 */
export function simulateDefence(missiles, turrets, rng, p = INTERCEPT) {
  const ms = missiles.map((m) => ({ ...m, hp: m.hp, dead: false, landed: false, pos: [0, 0, 0], prev: null, vel: [0, 0, 0], out: { killed: false, tKill: null, pos: null, by: null, split: false, void: false } }));
  // Decoys (endAt: they split then) and their fakes (parent: only fly if the decoy lived to split).
  const byId = new Map(ms.map((m) => [m.id, m]));
  for (const m of ms) if (m.parent != null) m.parentM = byId.get(m.parent) ?? null;
  const ts = turrets.map((c) => {
    const w = hexToWorld(c.x, c.z);
    return { x: c.x, z: c.z, pos: [w.x, 0.35, w.z], yaw: 0, pitch: 0.3, target: null, acc: 0, alive: true };
  });
  const result = { missiles: new Map(ms.map((m) => [m.id, m.out])), turrets: [], rounds: [], t0: 0, steps: 0 };
  if (!ms.length) return result;
  const t0 = Math.min(...ms.map((m) => m.t0));
  const tEnd = Math.max(...ms.map((m) => m.t0 + m.flight)) + 0.05;
  const steps = Math.ceil((tEnd - t0) / SIM_DT) + 1;
  result.t0 = t0;
  result.steps = steps;
  const aims = ts.map(() => new Float32Array(steps * 2));
  const fires = ts.map(() => new Uint8Array(steps));
  const live = []; // rounds in flight
  const ring = p.range;
  const reach2 = p.reach * p.reach;
  const covers = (t, m) => m.cells.some(([x, z]) => hexDistance(x, z, t.x, t.z) <= ring);
  const tmp = [0, 0, 0];

  for (let s = 0; s < steps; s++) {
    const t = t0 + s * SIM_DT;
    // Missiles move.
    for (const m of ms) {
      if (m.dead || m.landed) continue;
      const age = t - m.t0;
      if (age < 0) continue;
      if (m.parentM && !m.parentM.out.split) {
        // Its decoy was shot down before splitting: this fake never existed.
        m.landed = true;
        m.out.void = true;
        continue;
      }
      if (m.endAt != null && t >= m.endAt) {
        // A decoy splits into its fakes.
        m.landed = true;
        m.out.split = true;
        continue;
      }
      const u = Math.min(1, Math.pow(age / m.flight, m.accel));
      bez(m.path, u, m.pos);
      weaveAt(m.weave, age, u, m.pos);
      if (m.prev) for (let i = 0; i < 3; i++) m.vel[i] = (m.pos[i] - m.prev[i]) / SIM_DT;
      m.prev = [...m.pos];
      if (u >= 1) {
        m.landed = true;
        // Landing on a network takes it out for the rest of the phase (fakes and decoys are harmless).
        if (!m.harmless) for (const tr of ts) if (m.cells.some(([x, z]) => x === tr.x && z === tr.z)) tr.alive = false;
      }
    }
    // Turrets: keep the target while it's alive and in reach, else pick the one landing soonest.
    ts.forEach((tr, ti) => {
      const inReach = (m) => {
        const dx = m.pos[0] - tr.pos[0];
        const dy = m.pos[1] - tr.pos[1];
        const dz = m.pos[2] - tr.pos[2];
        return dx * dx + dy * dy + dz * dz <= reach2;
      };
      const ok = (m) => m && !m.dead && !m.landed && t >= m.t0 && m.prev && covers(tr, m) && inReach(m);
      if (!tr.alive) tr.target = null;
      else if (!ok(tr.target)) {
        tr.target = null;
        let best = Infinity;
        for (const m of ms) {
          const land = m.t0 + m.flight;
          if (ok(m) && land < best) {
            best = land;
            tr.target = m;
          }
        }
      }
      let firing = 0;
      if (tr.target) {
        const m = tr.target;
        // Lead: where it will be when a round gets there (two passes).
        let lx = m.pos[0];
        let ly = m.pos[1];
        let lz = m.pos[2];
        for (let k = 0; k < 2; k++) {
          const fl = Math.hypot(lx - tr.pos[0], ly - tr.pos[1], lz - tr.pos[2]) / p.roundSpeed;
          lx = m.pos[0] + m.vel[0] * fl;
          ly = m.pos[1] + m.vel[1] * fl;
          lz = m.pos[2] + m.vel[2] * fl;
        }
        const dx = lx - tr.pos[0];
        const dy = ly - tr.pos[1];
        const dz = lz - tr.pos[2];
        const wantYaw = Math.atan2(dx, dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        const step = p.turnSpeed * SIM_DT;
        let dy0 = Math.atan2(Math.sin(wantYaw - tr.yaw), Math.cos(wantYaw - tr.yaw));
        tr.yaw += Math.max(-step, Math.min(step, dy0));
        tr.pitch += Math.max(-step, Math.min(step, wantPitch - tr.pitch));
        dy0 = Math.atan2(Math.sin(wantYaw - tr.yaw), Math.cos(wantYaw - tr.yaw));
        // Fire only once lined up: one stream, along the barrels (plus spread).
        if (Math.abs(dy0) < 0.06 && Math.abs(wantPitch - tr.pitch) < 0.06) {
          firing = 1;
          tr.acc += p.rate * SIM_DT;
          for (; tr.acc >= 1; tr.acc--) {
            const yaw = tr.yaw + (rng() * 2 - 1) * p.spread;
            const pitch = tr.pitch + (rng() * 2 - 1) * p.spread;
            const cp = Math.cos(pitch);
            const vel = [Math.sin(yaw) * cp * p.roundSpeed, Math.sin(pitch) * p.roundSpeed, Math.cos(yaw) * cp * p.roundSpeed];
            const life = Math.sqrt(reach2) / p.roundSpeed + 0.15;
            const r = { t, turret: ti, pos: [...tr.pos], vel, life, hit: false };
            result.rounds.push(r);
            live.push({ r, age: 0, p: [...tr.pos] });
          }
        }
      } else tr.acc = 0;
      aims[ti][s * 2] = tr.yaw;
      aims[ti][s * 2 + 1] = tr.pitch;
      fires[ti][s] = firing;
    });
    // Rounds fly; one that passes close to a missile hits it.
    const hr2 = p.hitRadius * p.hitRadius;
    for (let i = live.length - 1; i >= 0; i--) {
      const L = live[i];
      const a = [...L.p];
      for (let k = 0; k < 3; k++) L.p[k] += L.r.vel[k] * SIM_DT;
      L.age += SIM_DT;
      let hit = null;
      for (const m of ms) {
        if (m.dead || m.landed || !m.prev) continue;
        // Closest approach of the segment a -> L.p to the missile.
        const ab = [L.p[0] - a[0], L.p[1] - a[1], L.p[2] - a[2]];
        const am = [m.pos[0] - a[0], m.pos[1] - a[1], m.pos[2] - a[2]];
        const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
        const k = Math.max(0, Math.min(1, (am[0] * ab[0] + am[1] * ab[1] + am[2] * ab[2]) / len2));
        for (let j = 0; j < 3; j++) tmp[j] = a[j] + ab[j] * k - m.pos[j];
        if (tmp[0] * tmp[0] + tmp[1] * tmp[1] + tmp[2] * tmp[2] <= hr2) {
          hit = m;
          break;
        }
      }
      if (hit) {
        L.r.hit = true;
        L.r.life = L.age;
        hit.hp -= p.damage;
        if (hit.hp <= 0) {
          hit.dead = true;
          hit.out.killed = true;
          hit.out.tKill = t;
          hit.out.pos = [...hit.pos];
          hit.out.by = ts[L.r.turret] ? { x: ts[L.r.turret].x, z: ts[L.r.turret].z } : null;
        }
        live.splice(i, 1);
      } else if (L.age >= L.r.life) live.splice(i, 1);
    }
  }
  result.turrets = ts.map((tr, i) => ({ x: tr.x, z: tr.z, pos: tr.pos, aim: aims[i], fire: fires[i] }));
  return result;
}

/** A turret's aim (yaw, pitch) and whether it's firing at phase time t. */
export function turretAt(sim, ti, t) {
  const tr = sim.turrets[ti];
  const s = Math.max(0, Math.min(sim.steps - 1, Math.floor((t - sim.t0) / SIM_DT)));
  return { yaw: tr.aim[s * 2], pitch: tr.aim[s * 2 + 1], firing: t >= sim.t0 && t <= sim.t0 + sim.steps * SIM_DT && tr.fire[s] === 1 };
}

/**
 * Rough odds a missile aimed at (x, z) gets through `grid`'s networks (for the rival AI's planning): each covering
 * network brings a share of a kill; more networks, worse odds. decoys: decoys flying in alongside; each one (and its
 * fakes) soaks up part of the networks' fire.
 */
export function throughEstimate(grid, x, z, kind = 'missile', decoys = 0) {
  let nets = 0;
  for (const c of grid.cells.values()) if (c.terrain === 'intercept' && hexDistance(c.x, c.z, x, z) <= INTERCEPT.range) nets++;
  const perNet = Math.min(0.85, (INTERCEPT.rate * INTERCEPT.hitChanceEst * INTERCEPT.damage * 0.9) / missileHp(kind));
  const soak = 1 + decoys * 0.15 * (1 + DECOY.fakes);
  return (1 - perNet) ** (nets / soak);
}
