import * as THREE from 'three';
import { createGround, createLights } from './scene.js';
import { hexToWorld, key } from './grid.js';
import { FogOfWar } from './fogOfWar.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

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
  // Target reticles while aiming (First Strike style): two rings of slanted yellow dashes (parallelograms, the inner
  // ring set in the outer ring's gaps) and a wide faint outer circle. Only while aiming: it wraps the picked card's
  // footprint under the cursor (a salvo fan too) and fades out once that strike is aimed.
  const marks = new THREE.Group();
  marks.renderOrder = 20;
  scene.add(marks);
  const markOpts = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false };
  const faintMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, opacity: 0.35, ...markOpts });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, opacity: 0.95, side: THREE.DoubleSide, ...markOpts });
  const MARK_Y = 0.6;
  const DASHES = 7; // per ring
  const DASH_SHARE = 0.5; // share of each slot that is dash
  const DASH_SLANT = 0.07; // radians the outer edge runs ahead of the inner one: the parallelogram lean
  const FADE_TIME = 0.4; // seconds for an aimed reticle to fade out
  const APPEAR_TIME = 0.25; // seconds for the reticle to fade in when a card first goes over a tile
  let hoverMark = null; // { key, cells, g }: the reticle under the cursor
  let markClock = 0;

  /** Unit-radius reticle geometry, scaled per target. */
  const ringPiece = (inner, outer, start = 0, len = Math.PI * 2, segs = 96) =>
    new THREE.RingGeometry(inner, outer, segs, 1, start, len).rotateX(-Math.PI / 2);
  const outerGeo = ringPiece(1.75, 1.77, 0, Math.PI * 2, 128);

  /** One ring of parallelogram dashes between radii r0 and r1, starting at angle `phase`, merged into one geometry. */
  function dashRing(r0, r1, phase) {
    const slot = (Math.PI * 2) / DASHES;
    const len = slot * DASH_SHARE;
    const steps = 6; // the long edges follow the curve
    const pos = [];
    const index = [];
    for (let d = 0; d < DASHES; d++) {
      const a0 = phase + d * slot;
      const base = pos.length / 3;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (len * i) / steps;
        pos.push(Math.cos(a) * r0, 0, -Math.sin(a) * r0);
        pos.push(Math.cos(a + DASH_SLANT) * r1, 0, -Math.sin(a + DASH_SLANT) * r1);
      }
      for (let i = 0; i < steps; i++) {
        const v = base + i * 2;
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    return geo;
  }
  const slot = (Math.PI * 2) / DASHES;
  const innerDashGeo = dashRing(1.0, 1.09, slot / 2);
  const outerDashGeo = dashRing(1.2, 1.29, 0);

  /** One reticle around `cells` ([[x, z]]), with its own materials so it can fade alone. */
  function makeReticle(cells) {
    const pts = cells.map(([x, z]) => hexToWorld(x, z));
    const { x: cx, z: cz } = centreOf(cells);
    const radius = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 0.55;
    const g = new THREE.Group();
    g.position.set(cx, MARK_Y, cz);
    const add = (parent, geo, mat, order) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      parent.add(m);
    };
    const body = new THREE.Group(); // scaled to the target
    body.scale.setScalar(radius);
    const faint = faintMat.clone();
    const dash = dashMat.clone();
    add(body, outerGeo, faint, 20);
    const rotor = new THREE.Group();
    add(rotor, innerDashGeo, dash, 21);
    add(rotor, outerDashGeo, dash, 21);
    body.add(rotor);
    g.add(body);
    faint.opacity = 0;
    dash.opacity = 0;
    g.userData = { rotor, mats: [faint, dash], appear: 0, fade: -1 };
    return g;
  }

  function dropReticle(g) {
    marks.remove(g);
    for (const m of g.userData.mats) m.dispose();
  }

  function animateReticles(dt) {
    markClock += dt;
    for (const g of [...marks.children]) {
      const u = g.userData;
      u.rotor.rotation.y = -markClock * 1.1;
      let k;
      if (u.fade < 0) {
        u.appear = Math.min(1, u.appear + dt / APPEAR_TIME);
        k = u.appear;
      } else {
        u.fade += dt / FADE_TIME;
        if (u.fade >= 1) {
          dropReticle(g);
          continue;
        }
        k = (1 - u.fade) * u.appear;
      }
      u.mats[0].opacity = faintMat.opacity * k;
      u.mats[1].opacity = dashMat.opacity * k;
    }
  }
  // While aiming: a thin unbroken trail from where Hive City lies (off past the horizon) down onto each target tile,
  // as First Strike draws its flight paths. Additive, so its colour ramp is its fade: bright up high, dimmer at the tile.
  const arcs = new THREE.Group();
  scene.add(arcs);
  const ARC_COLOUR = new THREE.Color(0xffe58a); // a paler cousin of the reticle's yellow
  const ARC_POINTS = 64;
  const arcMat = new LineMaterial({
    linewidth: 1.6, // CSS px
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const arcSize = new THREE.Vector2();
  const arcByKey = new Map(); // "x,z;x,z" (the cells it wraps) -> path
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

  /**
   * The aiming reticle. `aimed`: [[[x, z], ...]] one footprint per queued strike; `hover`: the cells the picked card
   * would hit under the cursor, or null. When the hover cells turn up among the aimed ones (the card was just played)
   * the reticle fades out; otherwise a reticle that's no longer wanted goes at once. None over cells already aimed.
   */
  function setMarkers(aimed, hover = null) {
    const done = new Set(aimed.flat().map(([x, z]) => key(x, z)));
    const isAimed = (cells) => cells.every(([x, z]) => done.has(key(x, z)));
    const want = hover?.length && !isAimed(hover) ? hover.map(([x, z]) => key(x, z)).join(';') : null;
    let carry = 0; // moving tile to tile: the new reticle picks up where the old one's fade-in was
    if (hoverMark && hoverMark.key !== want) {
      if (isAimed(hoverMark.cells)) hoverMark.g.userData.fade = 0;
      else {
        carry = hoverMark.g.userData.appear;
        dropReticle(hoverMark.g);
      }
      hoverMark = null;
    }
    if (want && !hoverMark) {
      const g = makeReticle(hover);
      g.userData.appear = carry;
      marks.add(g);
      hoverMark = { key: want, cells: hover, g };
    }
  }

  /** Middle of `cells` ([[x, z]]) on the ground: where the reticle around them sits. */
  function centreOf(cells) {
    const pts = cells.map(([x, z]) => hexToWorld(x, z));
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
  }

  /** One flight path onto the middle of `cells`, coming in from `dir`, with its own material so it can fade alone. */
  function makeArc(cells, dir) {
    const end = centreOf(cells);
    const p0 = new THREE.Vector3(end.x + dir.x * 22, 9, end.z + dir.z * 22);
    const p2 = new THREE.Vector3(end.x, MARK_Y, end.z); // in the reticle's plane, so it meets the reticle's centre
    const p1 = p0.clone().lerp(p2, 0.55).add(new THREE.Vector3(0, 6, 0));
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    const pos = [];
    const col = [];
    for (const [i, p] of curve.getPoints(ARC_POINTS).entries()) {
      const t = i / ARC_POINTS; // 0 at the horizon, 1 at the tile
      const k = THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - 0.65 * t); // still visible where it meets the centre
      pos.push(p.x, p.y, p.z);
      col.push(ARC_COLOUR.r * k, ARC_COLOUR.g * k, ARC_COLOUR.b * k);
    }
    const geo = new LineGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = arcMat.clone();
    mat.opacity = 0;
    const line = new Line2(geo, mat);
    line.renderOrder = 21;
    line.frustumCulled = false;
    line.userData = { appear: 0, fade: -1 };
    return line;
  }

  function dropArc(line) {
    arcs.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }

  /**
   * Flight paths while aiming: one onto the middle of each of `groups` ([[[x, z], ...]], as a reticle wraps them:
   * the picked card's cells under the cursor), coming in from `dir` (unit {x, z}: where Hive City lies from this city
   * on the War Map), or none if `dir` is null. A path whose cells all turn up in `aimed` ([[x, z]], the queued
   * strikes' cells: the card was just played) fades out; any other path that's no longer wanted goes at once.
   */
  function setArcs(groups, dir, aimed = []) {
    const done = new Set(aimed.map(([x, z]) => key(x, z)));
    const isAimed = (cells) => cells.every(([x, z]) => done.has(key(x, z)));
    const want = new Map(
      dir ? groups.filter((cells) => cells?.length && !isAimed(cells)).map((cells) => [cells.map(([x, z]) => key(x, z)).join(';'), cells]) : [],
    );
    let carry = 0; // moving tile to tile: new paths pick up where the old ones' fade-in was
    for (const [k, line] of arcByKey) {
      if (want.has(k)) continue;
      arcByKey.delete(k);
      if (isAimed(k.split(';').map((s) => s.split(',').map(Number)))) line.userData.fade = 0;
      else {
        carry = Math.max(carry, line.userData.appear);
        dropArc(line);
      }
    }
    for (const [k, c] of want) {
      if (arcByKey.has(k)) continue;
      const line = makeArc(c, dir);
      line.userData.appear = carry;
      arcs.add(line);
      arcByKey.set(k, line);
    }
  }

  function animateArcs(dt) {
    renderer.getSize(arcSize);
    for (const line of [...arcs.children]) {
      const u = line.userData;
      line.material.resolution.copy(arcSize);
      let k;
      if (u.fade < 0) {
        u.appear = Math.min(1, u.appear + dt / APPEAR_TIME);
        k = u.appear;
      } else {
        u.fade += dt / FADE_TIME;
        if (u.fade >= 1) {
          dropArc(line);
          continue;
        }
        k = (1 - u.fade) * u.appear;
      }
      line.material.opacity = k;
    }
  }

  /** Per frame while a rival city is shown: the fog follows the camera; its offscreen pass comes before the scene. */
  function update(dt, camera) {
    animateReticles(dt);
    animateArcs(dt);
    if (!active || !fog) return;
    fog.update(dt, rig.target, rig.distance);
    fog.render(camera);
  }

  /** Put the board camera back on the exact rig state from before the visit. */
  function exit() {
    clearRoot();
    for (const g of [...marks.children]) dropReticle(g);
    hoverMark = null;
    for (const line of [...arcs.children]) dropArc(line);
    arcByKey.clear();
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
