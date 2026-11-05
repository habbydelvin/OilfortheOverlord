import * as THREE from 'three';
import { createGround, createLights } from './scene.js';
import { HEX_RADIUS, hexToWorld, key, cellsCentre, cellSeed } from './grid.js';
import { hexPlane } from './hexGeometry.js';
import { FogOfWar } from './fogOfWar.js';
import { createInstancer } from './instancer.js';
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
 * stackAims: tiles already aimed can be aimed again (combat test): the reticle shows over them too, and setAimed
 * marks how many strikes land on a tile (×2, ×3).
 */
export function createRivalView({ renderer, factory, rig, fogSettings, fogQuality, stackAims = false, keepMaxZoom = false }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 22, 60);

  const { sun } = createLights(scene);
  const ground = createGround(renderer);
  scene.add(ground);

  // One group for the city's tiles, kept for good: the fog's depth pass holds on to it.
  const root = new THREE.Group();
  scene.add(root);
  const instancer = createInstancer(root, scene);
  // Target reticles while aiming (First Strike style): two rings of slanted yellow dashes (parallelograms, the inner
  // ring set in the outer ring's gaps) and a wide faint outer circle. Only while aiming: it wraps the picked card's
  // footprint under the cursor (a salvo fan too) and fades out once that strike is aimed. Each tile it will hit gets a
  // red hex on the ground: the reticle says where you aim, the red tiles what gets hit.
  const marks = new THREE.Group();
  marks.renderOrder = 20;
  scene.add(marks);
  const markOpts = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false };
  const faintMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, opacity: 0.35, ...markOpts });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, opacity: 0.95, side: THREE.DoubleSide, ...markOpts });
  const HIT_COLOUR = 0xb0482e; // a dull brick red, so it marks the tiles without shouting over them
  // The hit tile's border draws over everything (buildings included); its fill stays on the ground, under buildings.
  const hitEdgeMat = new THREE.MeshBasicMaterial({ color: HIT_COLOUR, opacity: 0.7, ...markOpts });
  const hitFillMat = new THREE.MeshBasicMaterial({ color: HIT_COLOUR, opacity: 0.12, ...markOpts, depthTest: true });
  const HIT_Y = 0.06; // just above the tiles' ground
  const MARK_Y = 0.6;
  const DASHES = 7; // per ring
  const DASH_SHARE = 0.5; // share of each slot that is dash
  const DASH_SLANT = 0.07; // radians the outer edge runs ahead of the inner one: the parallelogram lean
  const FADE_TIME = 0.4; // seconds for an aimed reticle to fade out
  const APPEAR_TIME = 0.25; // seconds for the reticle to fade in when a card first goes over a tile
  const GLIDE = 16; // 1/s: how fast the reticle, its tiles and its path catch up when the cursor moves to another tile
  const glide = (dt) => 1 - Math.exp(-GLIDE * dt);
  let hoverMark = null; // { key, cells, g }: the reticle under the cursor
  const aimedMarks = new Map(); // setAimed's key -> { g, line }: reticles and paths kept on queued strikes
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

  const hitEdgeGeo = new THREE.RingGeometry(HEX_RADIUS * 0.8, HEX_RADIUS * 0.9, 6, 1, Math.PI / 2).rotateX(-Math.PI / 2);
  const hitFillGeo = hexPlane(0.8);

  function addMesh(parent, geo, mat, order) {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    m.frustumCulled = false;
    parent.add(m);
  }

  /** One reticle around `cells` ([[x, z]]), centred on cell `at` (or their middle), with its own materials so it can fade alone. */
  function makeReticle(cells, at = null) {
    const g = new THREE.Group();
    const ring = new THREE.Group(); // at the centre, in the reticle's plane
    const body = new THREE.Group(); // scaled to the target
    const faint = faintMat.clone();
    const dash = dashMat.clone();
    addMesh(body, outerGeo, faint, 20);
    const rotor = new THREE.Group();
    addMesh(rotor, innerDashGeo, dash, 21);
    addMesh(rotor, outerDashGeo, dash, 21);
    body.add(rotor);
    ring.add(body);
    g.add(ring);
    const edge = hitEdgeMat.clone();
    const fill = hitFillMat.clone();
    const mats = [
      [faint, faintMat.opacity],
      [dash, dashMat.opacity],
      [edge, hitEdgeMat.opacity],
      [fill, hitFillMat.opacity],
    ];
    for (const [m] of mats) m.opacity = 0;
    g.userData = { ring, body, rotor, mats, edge, fill, tiles: [], goal: null, appear: 0, fade: -1 };
    aimReticle(g, cells, at, true);
    return g;
  }

  /**
   * Point reticle `g` at `cells` (centred as centreOf). `snap`: jump there (a new reticle); otherwise the ring and its
   * red tiles glide over in animateReticles, each tile from the nearest old one (extra tiles start at the centre).
   */
  function aimReticle(g, cells, at, snap) {
    const u = g.userData;
    const pts = cells.map(([x, z]) => hexToWorld(x, z));
    const c = centreOf(cells, at);
    u.goal = { x: c.x, z: c.z, r: Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z))) + 0.55 };
    if (snap) {
      u.ring.position.set(c.x, MARK_Y, c.z);
      u.body.scale.setScalar(u.goal.r);
    }
    const old = u.tiles;
    u.tiles = [];
    for (const p of pts) {
      let best = -1;
      for (let i = 0; i < old.length; i++) {
        if (best < 0 || Math.hypot(old[i].position.x - p.x, old[i].position.z - p.z) < Math.hypot(old[best].position.x - p.x, old[best].position.z - p.z)) best = i;
      }
      let tile;
      if (best >= 0) tile = old.splice(best, 1)[0];
      else {
        tile = new THREE.Group();
        addMesh(tile, hitFillGeo, u.fill, 19);
        addMesh(tile, hitEdgeGeo, u.edge, 19);
        tile.position.set(u.ring.position.x, HIT_Y, u.ring.position.z);
        g.add(tile);
      }
      tile.userData.goal = p;
      if (snap) tile.position.set(p.x, HIT_Y, p.z);
      u.tiles.push(tile);
    }
    for (const t of old) g.remove(t);
  }

  function dropReticle(g) {
    marks.remove(g);
    if (g.userData.stack) g.material.dispose();
    else for (const [m] of g.userData.mats) m.dispose();
  }

  /** Fade-in / fade-out progress of a mark (reticle or stack label): its opacity factor, or -1 once it's gone. */
  function fadeStep(g, dt) {
    const u = g.userData;
    if (u.fade < 0) return (u.appear = Math.min(1, u.appear + dt / APPEAR_TIME));
    u.fade += dt / FADE_TIME;
    if (u.fade < 1) return (1 - u.fade) * u.appear;
    dropReticle(g);
    return -1;
  }

  function animateReticles(dt) {
    markClock += dt;
    const f = glide(dt);
    for (const g of [...marks.children]) {
      const u = g.userData;
      if (u.stack) {
        const k = fadeStep(g, dt);
        if (k >= 0) g.material.opacity = k;
        continue;
      }
      u.rotor.rotation.y = -markClock * 1.1;
      u.ring.position.x += (u.goal.x - u.ring.position.x) * f;
      u.ring.position.z += (u.goal.z - u.ring.position.z) * f;
      u.body.scale.setScalar(u.body.scale.x + (u.goal.r - u.body.scale.x) * f);
      for (const t of u.tiles) {
        t.position.x += (t.userData.goal.x - t.position.x) * f;
        t.position.z += (t.userData.goal.z - t.position.z) * f;
      }
      const k = fadeStep(g, dt);
      if (k >= 0) for (const [m, base] of u.mats) m.opacity = base * k;
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
  const arcByKey = new Map(); // groupKey of the cells it wraps -> path
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
    instancer.end();
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
      cell.mesh = mesh;
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
    // keepMaxZoom: zoom out as far as in your own city before the planet takes over (combat test).
    rig.maxDistance = keepMaxZoom ? Math.max(saved.maxDistance, fit + 4) : Math.max(fit + 4, frame.half * 4);
    rig.goal.set(frame.cx, 0, frame.cz);
    rig.target.copy(rig.goal);
    rig.goalDistance = fit;
    rig.distance = fit;
    scene.fog.near = fit * 0.85;
    scene.fog.far = Math.max(fit, keepMaxZoom ? rig.maxDistance : 0) + 36;
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
   * would hit under the cursor, or null; `at`: the cell under the cursor, to centre on (a salvo fans out unevenly
   * around it), or null for the middle of `hover`. Moving to other cells, the reticle glides there. When the hover
   * cells turn up among the aimed ones (the card was just played) it fades out; with no hover it goes at once. None
   * over cells already aimed.
   */
  function setMarkers(aimed, hover = null, at = null) {
    const done = new Set(aimed.flat().map(([x, z]) => key(x, z)));
    const isAimed = (cells) => cells.every(([x, z]) => done.has(key(x, z)));
    const want = hover?.length && (stackAims || !isAimed(hover)) ? groupKey(hover, at) : null;
    if (hoverMark && hoverMark.key !== want) {
      if (isAimed(hoverMark.cells)) {
        hoverMark.g.userData.fade = 0;
        hoverMark = null;
      } else if (want) {
        aimReticle(hoverMark.g, hover, at, false);
        Object.assign(hoverMark, { key: want, cells: hover });
      } else {
        dropReticle(hoverMark.g);
        hoverMark = null;
      }
    }
    if (want && !hoverMark) {
      const g = makeReticle(hover, at);
      marks.add(g);
      hoverMark = { key: want, cells: hover, g };
    }
  }

  const groupKey = (cells, at) => `${at ? key(at[0], at[1]) : ''}|${cells.map(([x, z]) => key(x, z)).join(';')}`;

  /** Where the reticle around `cells` ([[x, z]]) sits on the ground: on cell `at` if given, else their middle. */
  function centreOf(cells, at = null) {
    if (at) return hexToWorld(at[0], at[1]);
    const pts = cells.map(([x, z]) => hexToWorld(x, z));
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
  }

  /** Points along the flight path onto ground point `end` ({x, z}), coming in from `dir`. */
  function arcPoints(end, dir) {
    const p0 = new THREE.Vector3(end.x + dir.x * 22, 9, end.z + dir.z * 22);
    const p2 = new THREE.Vector3(end.x, MARK_Y, end.z); // in the reticle's plane, so it meets the reticle's centre
    const p1 = p0.clone().lerp(p2, 0.55).add(new THREE.Vector3(0, 6, 0));
    return new THREE.QuadraticBezierCurve3(p0, p1, p2).getPoints(ARC_POINTS);
  }

  /** One flight path onto the centre of the reticle around `cells` (see centreOf), coming in from `dir`, with its own material so it can fade alone. */
  function makeArc(cells, dir, at = null) {
    const end = centreOf(cells, at);
    const pos = [];
    const col = [];
    for (const [i, p] of arcPoints(end, dir).entries()) {
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
    line.userData = { cells, dir, end: { ...end }, goal: { ...end }, appear: 0, fade: -1 };
    return line;
  }

  /** Bend `line` to end at its current `end`, writing its segments in place. */
  function reshapeArc(line) {
    const u = line.userData;
    const pts = arcPoints(u.end, u.dir);
    const buf = line.geometry.attributes.instanceStart.data;
    for (let i = 0; i < ARC_POINTS; i++) {
      pts[i].toArray(buf.array, i * 6);
      pts[i + 1].toArray(buf.array, i * 6 + 3);
    }
    buf.needsUpdate = true;
  }

  function dropArc(line) {
    arcs.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }

  /**
   * Flight paths while aiming: one onto the centre of each of `groups` ([[[x, z], ...]], as a reticle wraps them:
   * the picked card's cells under the cursor; centred on cell `at` if given, as setMarkers), coming in from `dir` (unit {x, z}: where Hive City lies from this city
   * on the War Map), or none if `dir` is null. A path whose cells all turn up in `aimed` ([[x, z]], the queued
   * strikes' cells: the card was just played) fades out; a path no longer wanted glides over to a new one, or goes
   * at once if there's none.
   */
  function setArcs(groups, dir, aimed = [], at = null) {
    const done = new Set(aimed.map(([x, z]) => key(x, z)));
    const isAimed = (cells) => cells.every(([x, z]) => done.has(key(x, z)));
    const want = new Map(dir ? groups.filter((cells) => cells?.length && (stackAims || !isAimed(cells))).map((cells) => [groupKey(cells, at), cells]) : []);
    const spare = [];
    for (const [k, line] of arcByKey) {
      if (want.has(k)) continue;
      arcByKey.delete(k);
      if (isAimed(line.userData.cells)) line.userData.fade = 0;
      else spare.push(line);
    }
    for (const [k, c] of want) {
      if (arcByKey.has(k)) continue;
      let line = spare.pop();
      if (line) Object.assign(line.userData, { cells: c, dir, goal: centreOf(c, at) });
      else arcs.add((line = makeArc(c, dir, at)));
      arcByKey.set(k, line);
    }
    for (const line of spare) dropArc(line);
  }

  /**
   * Queued strikes that fire at End Turn (combat test): each keeps its red tiles and a flight path until it goes, but
   * not the yellow rings (several of those overlapping are a mess): the hover reticle's rings fade out as it's aimed.
   * `groups`: [{ key, cells: [[x, z]], at }] one per played card (a salvo's tiles together, centred on cell `at`, or
   * null for their middle); `dir` as setArcs. New ones fade in, gone ones fade out, changed ones glide.
   */
  function setAimed(groups, dir) {
    const want = new Map(dir ? groups.filter((gr) => gr.cells.length).map((gr) => [gr.key, gr]) : []);
    for (const [k, m] of aimedMarks) {
      if (want.has(k)) continue;
      aimedMarks.delete(k);
      m.g.userData.fade = 0;
      m.line.userData.fade = 0;
    }
    for (const [k, { cells, at }] of want) {
      const m = aimedMarks.get(k);
      if (m) {
        aimReticle(m.g, cells, at, false);
        Object.assign(m.line.userData, { cells, dir, goal: centreOf(cells, at) });
        continue;
      }
      const g = makeReticle(cells, at);
      g.userData.ring.visible = false; // red tiles only
      const line = makeArc(cells, dir, at);
      marks.add(g);
      arcs.add(line);
      aimedMarks.set(k, { g, line });
    }
    setStacks(groups);
  }

  // How many queued strikes land on a tile, over its red hex when it's more than one.
  const stacks = new Map(); // "x,z" -> sprite
  const stackTextures = new Map(); // n -> texture
  function stackTexture(n) {
    if (stackTextures.has(n)) return stackTextures.get(n);
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(40, 12, 6, 0.9)';
    ctx.strokeText(`×${n}`, 64, 34);
    ctx.fillStyle = '#ffd23a';
    ctx.fillText(`×${n}`, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    stackTextures.set(n, tex);
    return tex;
  }

  function setStacks(groups) {
    const count = new Map();
    for (const gr of groups) for (const k of new Set(gr.cells.map(([x, z]) => key(x, z)))) count.set(k, (count.get(k) ?? 0) + 1);
    for (const [k, sprite] of stacks) {
      if ((count.get(k) ?? 0) >= 2) continue;
      sprite.userData.fade = 0;
      stacks.delete(k);
    }
    for (const [k, n] of count) {
      if (!stackAims || n < 2) continue;
      let sprite = stacks.get(k);
      if (!sprite) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ ...markOpts, opacity: 0 }));
        const [x, z] = k.split(',').map(Number);
        const w = hexToWorld(x, z);
        sprite.position.set(w.x, MARK_Y, w.z);
        sprite.scale.set(0.5, 0.25, 1);
        sprite.renderOrder = 22;
        sprite.userData = { appear: 0, fade: -1, stack: true };
        marks.add(sprite);
        stacks.set(k, sprite);
      }
      sprite.material.map = stackTexture(n);
    }
  }

  function animateArcs(dt) {
    renderer.getSize(arcSize);
    const f = glide(dt);
    for (const line of [...arcs.children]) {
      const u = line.userData;
      line.material.resolution.copy(arcSize);
      if (Math.hypot(u.goal.x - u.end.x, u.goal.z - u.end.z) > 1e-3) {
        u.end.x += (u.goal.x - u.end.x) * f;
        u.end.z += (u.goal.z - u.end.z) * f;
        reshapeArc(line);
      }
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

  /** Per frame while a rival city is shown. Rendering owns the temporary batches across all its passes. */
  function update(dt, camera) {
    animateReticles(dt);
    animateArcs(dt);
    if (!active || !fog) return;
    fog.update(dt, rig.target, rig.distance);
  }

  function render(camera) {
    scene.updateMatrixWorld(); // skeleton bind inverses and parents must be current before fog's depth pass
    try {
      instancer.begin(camera, true);
      instancer.revealSources();
      fog?.render(camera);
      instancer.concealSources();
      renderer.render(scene, camera);
    } finally {
      instancer.end();
    }
  }

  /** Put the board camera back on the exact rig state from before the visit. */
  function exit() {
    clearRoot();
    for (const g of [...marks.children]) dropReticle(g);
    hoverMark = null;
    for (const line of [...arcs.children]) dropArc(line);
    arcByKey.clear();
    aimedMarks.clear();
    stacks.clear();
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
    instancer,
    render,
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
    setAimed,
    enter,
    exit,
    refresh,
    update,
  };
}
