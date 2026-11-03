import * as THREE from 'three';
import { createGround, createLights } from './scene.js';
import { hexToWorld, key, cellsCentre, cellSeed } from './grid.js';
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
  // Target markers while aiming (queued strikes) and the hover ring under the cursor.
  const marks = new THREE.Group();
  marks.renderOrder = 20;
  scene.add(marks);
  const ringGeo = new THREE.RingGeometry(0.32, 0.46, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
  const hoverMat = new THREE.MeshBasicMaterial({ color: 0xffc08a, transparent: true, opacity: 0.7, depthTest: false, toneMapped: false });
  // Aimed strikes: an arc from where Hive City lies (off past the horizon) down onto each target tile.
  const arcs = new THREE.Group();
  scene.add(arcs);
  const arcMat = new THREE.LineDashedMaterial({ color: 0xffb04a, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false, fog: false });
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
      const [sx, sz] = piece.cells[0];
      const group = factory.createPiece(piece.shape, piece.rot, sx * 31 + sz); // the same model every visit
      if (!group) continue; // no model for this shape (yet): its cells get the single tiles below
      const mid = cellsCentre(piece.cells);
      group.position.set(mid.x, 0, mid.z);
      root.add(group);
      for (const [x, z] of piece.cells) covered.add(key(x, z));
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const cell of rival.grid.cells.values()) {
      const bare = covered.has(key(cell.x, cell.z));
      const mesh = factory.create(cell.terrain, { bare, seed: cellSeed(cell.x, cell.z) });
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

  /** Rings over `cells` ([[x, z]] queued targets) and `hover` (cells under the cursor, or null). */
  function setMarkers(cells, hover = null) {
    marks.clear();
    const ring = (x, z, mat, y) => {
      const m = new THREE.Mesh(ringGeo, mat);
      const w = hexToWorld(x, z);
      m.position.set(w.x, y, w.z);
      m.renderOrder = 20;
      marks.add(m);
    };
    for (const [x, z] of cells) ring(x, z, markMat, 0.6);
    for (const [x, z] of hover ?? []) ring(x, z, hoverMat, 0.62);
  }

  /**
   * Arcs for aimed strikes: [[x, z]] target cells, launched from `dir` (unit {x, z}: where Hive City lies from
   * this city on the War Map). They come in over the horizon and dive onto the tile.
   */
  function setArcs(cells, dir) {
    for (const a of arcs.children) a.geometry.dispose();
    arcs.clear();
    if (!dir) return;
    for (const [x, z] of cells) {
      const end = hexToWorld(x, z);
      const p0 = new THREE.Vector3(end.x + dir.x * 22, 9, end.z + dir.z * 22);
      const p2 = new THREE.Vector3(end.x, 0.3, end.z);
      const p1 = p0.clone().lerp(p2, 0.55).add(new THREE.Vector3(0, 6, 0));
      const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), arcMat);
      line.computeLineDistances();
      line.renderOrder = 21;
      line.frustumCulled = false;
      arcs.add(line);
    }
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
    marks.clear();
    setArcs([], null);
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
    get rival() {
      return shown?.rival ?? null;
    },
    build,
    setMarkers,
    setArcs,
    enter,
    exit,
    refresh,
    update,
  };
}
