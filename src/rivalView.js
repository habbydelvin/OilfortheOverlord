import * as THREE from 'three';
import { createGround, createLights } from './scene.js';
import { hexToWorld, key } from './grid.js';
import { FogOfWar } from './fogOfWar.js';

const BG = 0x000000;

/**
 * A second scene for rival cities. The frame loop renders this instead of the player scene, so ghosts, traffic
 * and map icons never appear here. Lighting stays fixed: followTarget only moves the player scene's sun, fog
 * and ground. The city has its own fog of war (same look as the board's), cleared around its land.
 *
 * fogSettings(): the board's fog settings (shared, so the Game Debug sliders apply here too); read on first visit.
 * fogQuality(): the Graphics fog quality preset.
 */
export function createRivalView({ renderer, factory, rig, fogSettings, fogQuality }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 22, 60);

  const { sun } = createLights(scene);
  const ground = createGround(renderer);
  scene.add(ground);

  // One group for the city's tiles, kept for good: the fog's depth pass holds on to it.
  const root = new THREE.Group();
  scene.add(root);
  let fog = null;
  let active = false;
  let saved = null;
  let shown = null; // { rival, version }

  function ensureFog() {
    if (fog) return fog;
    fog = new FogOfWar(scene, fogSettings());
    fog.attachRenderer(renderer, scene, [root]);
    return fog;
  }

  function clearRoot() {
    root.clear();
  }

  /** Drop the previous clones and build this rival again. Shared geometries stay with the factory. */
  function build(rival) {
    clearRoot();
    // Wasteland pieces: one whole-piece model over the cells (as on the board), each cell an empty holder.
    const covered = new Set();
    for (const piece of rival.pieces ?? []) {
      const group = factory.createPiece(piece.shape, piece.rot);
      if (!group) continue; // no model for this shape (yet): its cells get the single tiles below
      const world = piece.cells.map(([x, z]) => hexToWorld(x, z));
      const xs = world.map((w) => w.x);
      const zs = world.map((w) => w.z);
      group.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
      root.add(group);
      for (const [x, z] of piece.cells) covered.add(key(x, z));
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const cell of rival.grid.cells.values()) {
      const bare = covered.has(key(cell.x, cell.z));
      const mesh = factory.create(cell.terrain, { bare });
      const w = hexToWorld(cell.x, cell.z);
      mesh.position.set(w.x, 0, w.z);
      root.add(mesh);
      minX = Math.min(minX, w.x);
      maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z);
      maxZ = Math.max(maxZ, w.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const half = Math.max(maxX - minX, maxZ - minZ) / 2 + 1.5;
    const reach = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ));
    sun.position.set(cx + 7, 16, cz + 5);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    const extent = Math.max(10, Math.ceil(half * 2));
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
    ground.position.x = cx;
    ground.position.z = cz;
    shown = { rival, version: rival.version ?? 0 };
    return { cx, cz, half, reach };
  }

  /** Clouds over everything but the city and the ring around it, as free placement leaves the board. */
  function coverCity(rival) {
    const f = ensureFog();
    f.setQuality(fogQuality());
    f.applySettings(true);
    f.setVisible(true);
    f.reset(rival.grid);
    const r = fogSettings().openRadius ?? 1;
    for (const cell of rival.grid.cells.values()) f.openAround(cell.x, cell.z, r, true);
  }

  /** Same sand fade as the board, centred on this city. This ground has its own alpha map. */
  function fadeGround(fit) {
    const fade = ground.material.alphaMap;
    const reach = (0.75 * fit) / 240;
    fade.repeat.setScalar(1 / (2 * reach));
    fade.offset.set(0.5 - fade.repeat.x * 0.5, 0.5 - fade.repeat.y * 0.5);
  }

  function enter(rival) {
    const frame = build(rival);
    coverCity(rival);
    if (!saved) {
      saved = {
        goal: rig.goal.clone(),
        goalDistance: rig.goalDistance,
        goalYaw: rig.goalYaw,
        bounds: rig.bounds,
        target: rig.target.clone(),
        distance: rig.distance,
        yaw: rig.yaw,
        minDistance: rig.minDistance,
        maxDistance: rig.maxDistance,
      };
    }
    const fit = THREE.MathUtils.clamp(frame.half * 2.6, 8, 32);
    rig.bounds = frame.reach + 1;
    rig.minDistance = 6;
    rig.maxDistance = Math.max(fit + 4, frame.half * 4);
    rig.goal.set(frame.cx, 0, frame.cz);
    rig.target.copy(rig.goal);
    rig.goalDistance = fit;
    rig.distance = fit;
    scene.fog.near = fit * 0.85;
    scene.fog.far = fit + 36;
    fadeGround(fit);
    active = true;
    return frame;
  }

  /** The shown city grew (a season passed) or its models loaded: rebuild it in place, camera untouched. */
  function refresh(force = false) {
    if (!active || !shown) return;
    const { rival, version } = shown;
    if (!force && version === (rival.version ?? 0)) return;
    build(rival);
    coverCity(rival);
  }

  /** Per frame while a rival city is shown: the fog follows the camera; its offscreen pass comes before the scene. */
  function update(dt, camera) {
    if (!active || !fog) return;
    fog.update(dt, rig.target, rig.distance);
    fog.render(camera);
  }

  /** Put the board camera back on the exact rig state from before the visit. */
  function exit() {
    clearRoot();
    active = false;
    shown = null;
    fog?.setVisible(false);
    if (!saved) return;
    rig.goal.copy(saved.goal);
    rig.goalDistance = saved.goalDistance;
    rig.goalYaw = saved.goalYaw;
    rig.bounds = saved.bounds;
    rig.target.copy(saved.target);
    rig.distance = saved.distance;
    rig.yaw = saved.yaw;
    rig.minDistance = saved.minDistance;
    rig.maxDistance = saved.maxDistance;
    saved = null;
  }

  return {
    get scene() {
      return scene;
    },
    get active() {
      return active;
    },
    get fog() {
      return fog;
    },
    build,
    enter,
    exit,
    refresh,
    update,
  };
}
