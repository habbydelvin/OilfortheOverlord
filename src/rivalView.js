import * as THREE from 'three';
import { createGround, createLights } from './scene.js';

const BG = 0x000000;

/**
 * A second scene for rival cities. The frame loop renders this instead of the player scene, so fog,
 * ghosts, traffic and map icons never appear here. Lighting stays fixed: followTarget only moves the
 * player scene's sun, fog and ground.
 */
export function createRivalView({ renderer, factory, rig }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 22, 60);

  const { sun } = createLights(scene);
  const ground = createGround(renderer);
  scene.add(ground);

  let root = new THREE.Group();
  scene.add(root);
  let active = false;
  let saved = null;

  function clearRoot() {
    scene.remove(root);
    root = new THREE.Group();
    scene.add(root);
  }

  /** Drop the previous clones and build this rival again. Shared geometries stay with the factory. */
  function build(rival) {
    clearRoot();
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    for (const cell of rival.grid.cells.values()) {
      const mesh = factory.create(cell.terrain);
      mesh.position.set(cell.x, 0, cell.z);
      root.add(mesh);
      minX = Math.min(minX, cell.x);
      maxX = Math.max(maxX, cell.x);
      minZ = Math.min(minZ, cell.z);
      maxZ = Math.max(maxZ, cell.z);
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
    return { cx, cz, half, reach };
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

  /** Put the board camera back on the exact rig state from before the visit. */
  function exit() {
    clearRoot();
    active = false;
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
    build,
    enter,
    exit,
  };
}
