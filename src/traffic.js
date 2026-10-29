/**
 * Ship traffic between tiles. Every Settlement, Hydro-farm and Refinery on the board owns its ship (taken out of
 * the model's baked loop by models.js, see SHIPS). Each ship rests on its home pad, then flies a job: it lifts
 * off, cruises on its own height lane along a gentle curve (bending around the Capital's tower), hovers over the
 * stop to unload, and flies home to land on its pad again.
 *  - Hydro-farm: food to Settlements and the Capital.
 *  - Refinery: a tanker run, crude from an Oil Station, then fuel to the Capital.
 *  - Settlement: workers out to the farms, stations, pumps, the Refinery and Labour Camps.
 * Stops are picked fresh every trip from what is on the board, nearer ones more often. A ship whose stop is
 * removed turns for home; one whose home is destroyed climbs away and is gone. The Capital's own sky traffic
 * keeps its baked loop.
 */
import * as THREE from 'three';
import { SHIPS, SHIP_SCALE } from './models.js';

const JOBS = {
  farm: { stops: [['settlement', 'capital']], lane: 0.7, speed: 0.85 },
  refinery: { stops: [['station'], ['capital']], lane: 0.82, speed: 0.65 },
  settlement: { stops: [['farm', 'station', 'pump', 'refinery', 'labourcamp']], lane: 0.76, speed: 0.95 },
};
const RANGE = 7; // farthest stop, in cells
const CLIMB = 0.45; // lift-off and landing speed (cells per second)
const CAPITAL_CLEAR = 0.85; // routes keep this far from the Capital's tower (its centre)
const SYNC_EVERY = 0.5; // seconds between checks of the board for new or lost ships

const FWD = new THREE.Vector3(0, -1, 0); // the ship models' nose is their local -Y
const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);
const rand = (a, b) => a + Math.random() * (b - a);
const yawOf = (v) => Math.atan2(v.x, v.z);
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** True while the object is still part of the scene (not removed, replaced or nuked). */
function inScene(obj) {
  let o = obj;
  while (o.parent) o = o.parent;
  return o.isScene === true;
}

export class Traffic {
  ships = new Set();
  #sinceSync = SYNC_EVERY;
  #tops = new Map(); // terrain -> roof height above its tile (measured once)
  #m = new THREE.Matrix4();
  #v = new THREE.Vector3();
  #q = new THREE.Quaternion();
  #s = new THREE.Vector3();

  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ship traffic';
    scene.add(this.group);
  }

  /** Remove every ship at once (a new game). */
  clear() {
    for (const ship of this.ships) this.group.remove(ship.mesh);
    this.ships.clear();
  }

  update(dt, grid) {
    this.#sinceSync += dt;
    if (this.#sinceSync >= SYNC_EVERY) {
      this.#sinceSync = 0;
      this.#sync(grid);
    }
    for (const ship of this.ships) this.#step(ship, dt, grid);
  }

  // ---------- who flies ----------
  #sync(grid) {
    const homes = new Set();
    for (const cell of grid.cells.values()) {
      if (!JOBS[cell.terrain] || !SHIPS.has(cell.terrain) || !cell.mesh.userData.blockout) continue;
      homes.add(cell.mesh);
    }
    const flying = new Set();
    for (const ship of this.ships) {
      flying.add(ship.home);
      if (!homes.has(ship.home) && ship.phase !== 'leave') this.#leave(ship);
    }
    for (const cell of grid.cells.values()) if (homes.has(cell.mesh) && !flying.has(cell.mesh)) this.#spawn(cell);
  }

  #spawn(cell) {
    const spec = SHIPS.get(cell.terrain);
    const model = cell.mesh.children.find((c) => c.name === cell.terrain);
    if (!model) return;
    cell.mesh.updateMatrixWorld(true);
    const mesh = new THREE.Mesh(spec.geometry, spec.material);
    mesh.name = `ship:${cell.terrain}`;
    mesh.castShadow = spec.castShadow;
    mesh.receiveShadow = spec.receiveShadow;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    // Which local axis is the ship's "up" when parked (the nose is -Y): flight orientations are built from it.
    const restQ = new THREE.Quaternion();
    spec.rel.decompose(new THREE.Vector3(), restQ, new THREE.Vector3());
    let upLocal = null;
    let best = -Infinity;
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      const y = axis.clone().applyQuaternion(restQ).y;
      if (y > best) [best, upLocal] = [y, axis];
    }
    const side = new THREE.Vector3().crossVectors(FWD, upLocal);
    const ship = {
      terrain: cell.terrain,
      job: JOBS[cell.terrain],
      home: cell.mesh,
      homeCell: [cell.x, cell.z],
      model,
      rel: spec.rel,
      mesh,
      localInv: new THREE.Matrix4().makeBasis(FWD, upLocal, side).transpose(),
      lane: JOBS[cell.terrain].lane + rand(-0.05, 0.05),
      phase: 'docked',
      timer: rand(0.5, 6), // first departures spread out
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      yaw: 0,
      bank: 0,
      legs: [],
      leg: null,
      t: 0,
      fade: 1,
    };
    this.#dock(ship);
    this.ships.add(ship);
  }

  // ---------- poses ----------
  /** The parked pose on the home pad (it moves with the tile while it drops in). */
  #dockPose(ship, pos, quat, scale) {
    this.#m.multiplyMatrices(ship.model.matrixWorld, ship.rel);
    this.#m.decompose(pos, quat, scale);
    scale.multiplyScalar(SHIP_SCALE);
  }

  #dock(ship) {
    ship.phase = 'docked';
    ship.legs = [];
    ship.leg = null;
    this.#dockPose(ship, ship.pos, ship.quat, ship.scale);
    ship.yaw = yawOf(FWD.clone().applyQuaternion(ship.quat));
    ship.bank = 0;
  }

  /** Orientation for heading `yaw` and roll `bank`, in the ship model's own axes. */
  #flightQuat(ship, yaw, bank, out) {
    const d = this.#v.set(Math.sin(yaw), 0, Math.cos(yaw));
    const u = new THREE.Vector3(0, 1, 0).applyAxisAngle(d, bank);
    const s = new THREE.Vector3().crossVectors(d, u);
    this.#m.makeBasis(d, u, s).multiply(ship.localInv);
    return out.setFromRotationMatrix(this.#m);
  }

  // ---------- planning ----------
  /** Where a ship hovers to unload over a tile: just above its roof, nudged toward where the ship comes from. */
  #stopPoint(cell, from) {
    const centre = cell.mesh.getWorldPosition(new THREE.Vector3());
    const toward = new THREE.Vector3(from.x - centre.x, 0, from.z - centre.z);
    if (toward.lengthSq() < 1e-6) toward.set(1, 0, 0);
    toward.normalize();
    if (cell.terrain === 'capital') return centre.addScaledVector(toward, 0.62).setY(0.55); // at the city's edge
    return centre.addScaledVector(toward, 0.15).setY(centre.y + this.#top(cell) + 0.2);
  }

  /** Roof height of a tile's model above its cell, measured once per kind (stand-ins aren't kept: their model is coming). */
  #top(cell) {
    if (this.#tops.has(cell.terrain)) return this.#tops.get(cell.terrain);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    cell.mesh.updateMatrixWorld(true);
    cell.mesh.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh && o.visible) box.union(tmp.setFromObject(o));
    });
    if (!cell.mesh.userData.blockout) return 0.45;
    const top = box.isEmpty() ? 0.3 : Math.min(1, box.max.y - cell.mesh.getWorldPosition(this.#v).y);
    this.#tops.set(cell.terrain, top);
    return top;
  }

  /** A random stop of one of these kinds within range, nearer ones more likely. */
  #pick(grid, kinds, near, exclude) {
    const options = [];
    let total = 0;
    for (const cell of grid.cells.values()) {
      if (!kinds.includes(cell.terrain) || exclude.includes(cell.mesh) || !cell.mesh.visible || !inScene(cell.mesh)) continue;
      const d = Math.hypot(cell.x - near[0], cell.z - near[1]);
      if (d > RANGE || d < 0.5) continue;
      const w = 1 / (1 + d);
      options.push([cell, w]);
      total += w;
    }
    let r = Math.random() * total;
    for (const [cell, w] of options) if ((r -= w) <= 0) return cell;
    return null;
  }

  /** The stops of the next trip, then home. With nowhere to go, a short hop out over the land nearby. */
  #plan(ship, grid) {
    const legs = [];
    let at = ship.homeCell;
    let from = ship.pos.clone();
    const visited = [ship.home];
    for (const kinds of ship.job.stops) {
      const cell = this.#pick(grid, kinds, at, visited);
      if (!cell) continue;
      const point = this.#stopPoint(cell, from);
      legs.push({ to: point, cell, kind: 'stop' });
      visited.push(cell.mesh);
      at = [cell.x, cell.z];
      from = point;
    }
    if (!legs.length) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.9, 1.6);
      legs.push({ to: ship.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)).setY(0.55), cell: null, kind: 'stop' });
    }
    legs.push({ to: null, cell: null, kind: 'home' });
    ship.legs = legs;
  }

  /** Start the next leg from where the ship is: lift to its lane, cruise, come down. */
  #startLeg(ship, grid) {
    const leg = ship.legs.shift();
    if (!leg) return this.#dock(ship);
    const end = leg.kind === 'home' ? this.#homePoint(ship) : leg.to;
    const A = new THREE.Vector3(ship.pos.x, ship.lane, ship.pos.z);
    const B = new THREE.Vector3(end.x, ship.lane, end.z);
    leg.start = ship.pos.clone();
    leg.A = A;
    leg.B = B;
    leg.curve = this.#route(A, B, grid);
    leg.length = leg.curve.getLength();
    leg.upTime = Math.max(0.8, Math.abs(ship.lane - ship.pos.y) / CLIMB);
    leg.downTime = Math.max(0.8, Math.abs(ship.lane - end.y) / CLIMB);
    leg.startYaw = ship.yaw;
    ship.leg = leg;
    ship.phase = 'up';
    ship.t = 0;
  }

  #homePoint(ship) {
    const p = new THREE.Vector3();
    this.#dockPose(ship, p, this.#q, this.#s);
    return p;
  }

  /** A gentle curve from A to B on the lane, bent to one side, and well around any Capital in the way. */
  #route(A, B, grid) {
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = Math.hypot(dir.x, dir.z);
    if (len < 0.05) return new THREE.LineCurve3(A.clone(), B.clone().add(new THREE.Vector3(0.001, 0, 0)));
    const perp = new THREE.Vector3(-dir.z / len, 0, dir.x / len);
    let bend = rand(-0.15, 0.15) * len;
    for (const cell of grid.cells.values()) {
      if (cell.terrain !== 'capital') continue;
      const c = cell.mesh.getWorldPosition(new THREE.Vector3());
      const t = THREE.MathUtils.clamp(((c.x - A.x) * dir.x + (c.z - A.z) * dir.z) / (len * len), 0, 1);
      if (t <= 0.05 || t >= 0.95) continue;
      const px = A.x + dir.x * t - c.x;
      const pz = A.z + dir.z * t - c.z;
      const d = Math.hypot(px, pz);
      if (d >= CAPITAL_CLEAR) continue;
      const side = px * perp.x + pz * perp.z >= 0 ? 1 : -1;
      bend = (side * (CAPITAL_CLEAR - d + 0.15)) / 0.75; // a cubic's middle moves 3/4 of its control points' offset
    }
    const c1 = A.clone().addScaledVector(dir, 1 / 3).addScaledVector(perp, bend);
    const c2 = A.clone().addScaledVector(dir, 2 / 3).addScaledVector(perp, bend);
    c1.y = c2.y = A.y;
    return new THREE.CubicBezierCurve3(A.clone(), c1, c2, B.clone());
  }

  #leave(ship) {
    ship.phase = 'leave';
    ship.t = 0;
  }

  // ---------- flying ----------
  #step(ship, dt, grid) {
    const { mesh } = ship;
    if (ship.phase !== 'leave' && !inScene(ship.home)) this.#leave(ship);
    ship.t += dt;
    switch (ship.phase) {
      case 'docked': {
        this.#dockPose(ship, ship.pos, ship.quat, ship.scale);
        mesh.visible = ship.home.visible;
        ship.timer -= dt;
        if (ship.timer <= 0 && ship.home.visible) {
          this.#plan(ship, grid);
          this.#startLeg(ship, grid);
        }
        break;
      }
      case 'up': {
        const leg = ship.leg;
        const k = Math.min(1, ship.t / leg.upTime);
        ship.pos.lerpVectors(leg.start, leg.A, ease(k));
        const target = yawOf(leg.curve.getTangent(0));
        ship.yaw = leg.startYaw + angleTo(leg.startYaw, target) * ease(k);
        this.#flightQuat(ship, ship.yaw, 0, this.#q);
        // Off the pad: from the exact parked pose into flight attitude over the first part of the climb.
        ship.quat.slerp(this.#q, Math.min(1, k * 2.5));
        if (k >= 1) {
          ship.phase = 'cruise';
          ship.t = 0;
        }
        break;
      }
      case 'cruise': {
        const leg = ship.leg;
        if (leg.cell && !inScene(leg.cell.mesh)) {
          // The stop is gone: straight home from here.
          ship.legs = [{ to: null, cell: null, kind: 'home' }];
          this.#startLeg(ship, grid);
          break;
        }
        const u = Math.min(1, (ship.t * ship.job.speed) / leg.length);
        leg.curve.getPointAt(u, ship.pos);
        const yaw = yawOf(leg.curve.getTangentAt(u));
        const turn = angleTo(ship.yaw, yaw);
        ship.yaw = yaw;
        // Bank into turns, settling smoothly.
        const want = THREE.MathUtils.clamp((-turn / Math.max(dt, 1e-3)) * 0.35, -0.45, 0.45);
        ship.bank += (want - ship.bank) * Math.min(1, dt * 4);
        this.#flightQuat(ship, ship.yaw, ship.bank, ship.quat);
        if (u >= 1) {
          ship.phase = 'down';
          ship.t = 0;
          leg.end = leg.kind === 'home' ? this.#homePoint(ship) : leg.to.clone();
          leg.downYaw = ship.yaw;
        }
        break;
      }
      case 'down': {
        const leg = ship.leg;
        const k = Math.min(1, ship.t / leg.downTime);
        if (leg.kind === 'home') leg.end = this.#homePoint(ship);
        ship.pos.lerpVectors(leg.B, leg.end, ease(k));
        ship.bank *= 1 - Math.min(1, dt * 4);
        if (leg.kind === 'home') {
          // Turn to the parked heading, then settle into the exact parked pose on the pad.
          this.#dockPose(ship, this.#v, this.#q, this.#s);
          const restYaw = yawOf(FWD.clone().applyQuaternion(this.#q));
          ship.yaw = leg.downYaw + angleTo(leg.downYaw, restYaw) * ease(Math.min(1, k * 1.4));
          this.#flightQuat(ship, ship.yaw, ship.bank, ship.quat);
          ship.quat.slerp(this.#q, Math.max(0, (k - 0.6) / 0.4));
        } else this.#flightQuat(ship, ship.yaw, ship.bank, ship.quat);
        if (k >= 1) {
          if (leg.kind === 'home') {
            this.#dock(ship);
            ship.timer = rand(3, 9);
          } else {
            ship.phase = 'visit';
            ship.t = 0;
            ship.timer = rand(1.6, 3);
            leg.hover = ship.pos.clone();
          }
        }
        break;
      }
      case 'visit': {
        // Hover over the stop to unload, bobbing gently.
        ship.pos.copy(ship.leg.hover);
        ship.pos.y += Math.sin(ship.t * 2.2) * 0.012;
        this.#flightQuat(ship, ship.yaw, Math.sin(ship.t * 1.3) * 0.04, ship.quat);
        if (ship.t >= ship.timer) this.#startLeg(ship, grid);
        break;
      }
      case 'leave': {
        // Home destroyed: climb away along its heading and fade out of sight.
        ship.pos.x += Math.sin(ship.yaw) * dt * 0.8;
        ship.pos.z += Math.cos(ship.yaw) * dt * 0.8;
        ship.pos.y += dt * 0.5;
        ship.fade = Math.max(0, 1 - ship.t / 2.5);
        this.#flightQuat(ship, ship.yaw, 0, ship.quat);
        if (ship.fade <= 0) {
          this.group.remove(mesh);
          this.ships.delete(ship);
          return;
        }
        break;
      }
    }
    this.#s.copy(ship.scale).multiplyScalar(ship.fade);
    mesh.matrix.compose(ship.pos, ship.quat, this.#s);
    mesh.matrixWorldNeedsUpdate = true;
  }
}
