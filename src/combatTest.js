import { updateCurve } from './curvature.js'; // first: bends every material made after it (Planet map shape)
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid, hexToWorld, worldToHex, hexesAround, key } from './grid.js';
import { INTERCEPT, INTERCEPT_DEFAULTS, saveIntercept, clearIntercept, missileCapacity } from './arsenal.js';
import { intersectGround, flattenCurve } from './curvature.js';
import { createRivals, rivalStats } from './rivals.js';
import { createGlobeView } from './globeView.js';
import { createCloudTransition } from './cloudTransition.js';
import { createRivalView } from './rivalView.js';
import { chooseStrikes, noteAttacks } from './rivalAI.js';
import { applyToRival, footprint, spreadFrom } from './war.js';
import { PLAYER_NODE } from './rivals.js';
import { TileFactory, TERRAINS, cardDef, cardText, hex, snapHTML, cardArtHTML } from './tiles.js';
import { FogOfWar, loadFogConfig } from './fogOfWar.js';
import { MissileStrike, MISSILE, loadMissileConfig, saveMissileConfig } from './missiles.js';
import { Dust } from './dust.js';
import { CameraShake, loadShakeConfig } from './cameraShake.js';
import { loadGfxConfig, applyGfx } from './graphics.js';
import { CrtPass } from './crtPass.js';
import { CAPITAL_HP, resolve } from './war.js';
import { boom, buzz, ciws, unlockSfx } from './sfx.js';
import { findCiws } from './interceptMesh.js';

/**
 * Combat test: the game's own board pipeline (scene, camera rig, fog of war, graphics settings, CRT pass, missile
 * models, mushroom clouds, dust, camera shake) on a prebuilt city, with the attack phase's interceptors shooting
 * incoming missiles down. Saved Game Debug settings (fog, missiles, shake, graphics) apply here too.
 */
const LAYOUT = [
  [0, 0, 'capital'],
  [1, 0, 'farm'],
  [0, -1, 'farm'],
  [1, -1, 'settlement'],
  [2, -1, 'station'],
  [-1, 0, 'refinery'],
  [-1, 1, 'farm'],
  [4, 1, 'pump'],
  [5, 1, 'station'],
  [2, 0, 'intercept'],
  [-2, 0, 'intercept'],
  [0, 2, 'intercept'],
  // The arsenal: silos (Missile Magazines) and the factory that fills them. Every silo starts each turn armed.
  [3, -2, 'magazine'],
  [4, -2, 'magazine'],
  [2, -3, 'milfactory'],
];

const FIRST = [
  { at: [2, -1], kind: 'missile' },
  { at: [-1, 0], kind: 'missile' },
  { at: [4, 1], kind: 'missile2' },
];

// First two interceptor rolls: a stop, then a miss. Later turns use Math.random.
const SCRIPT = [0.2, 0.95];


// Wasteland around the city, as a real board would have.
const WASTE = [[3, -1], [3, 0], [-2, 1], [-1, 2], [1, 1], [2, 1], [3, 1], [-3, 1], [1, -2], [0, -2], [-1, -1], [-2, -1], [2, -2]];

// ---------- the game's scene ----------
const { renderer, scene, camera, sun, followTarget, setBoardFraming } = createScene(document.getElementById('app'));
setBoardFraming(false); // no side panel or hand here: the look-at point is the true centre
const crt = new CrtPass(renderer, document.getElementById('crt'));
crt.hookProjection(camera);
const rig = new CameraRig(camera, renderer.domElement);
const tiles = new THREE.Group();
scene.add(tiles);
const fogCfg = loadFogConfig();
const fog = new FogOfWar(scene, fogCfg);
fog.attachRenderer(renderer, scene, [tiles]);
const gfxCfg = loadGfxConfig();
applyGfx(gfxCfg, { renderer, scene, sun, fog, crt });
const missileCfg = loadMissileConfig();
const missiles = new MissileStrike(scene, camera, missileCfg);
const dust = new Dust(scene);
const camShake = new CameraShake(camera, loadShakeConfig());
window.addEventListener('pointerdown', () => unlockSfx?.(), { once: true });

// CIWS feel (this page only): seconds of fire before a hit brings the missile down, etc.
const CIWS_TUNE = { kill: 0.5, missDur: 0.9 };

// War state (declared early: the tuning panel reads it on load).
let view = 'home'; // 'home' | 'globe' | 'rival'
let rivals = createRivals((Math.random() * 0x100000000) >>> 0);
let shown = null; // rival in view
let silo = 0; // missiles in hand (= armed silo slots: missileCapacity, refilled every turn)
let queue = []; // { to, at, kind }

const factory = new TileFactory();
const grid = new Grid();
const meshes = new Map();
let oil = 9;
let hp = CAPITAL_HP;
let alive = true;
let busy = false; // a turn is resolving (no aiming, no second End turn)
let turn = 0;
let roll = 0;
const rng = () => (roll < SCRIPT.length ? SCRIPT[roll++] : Math.random());

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const nextBtn = document.getElementById('next');

const REST = { x: 0.8, z: 0.2, distance: 17 };
rig.focus?.(REST.x, REST.z);
rig.goal.set(REST.x, 0, REST.z);
rig.target.copy(rig.goal);
rig.goalDistance = rig.distance = REST.distance;

function place(x, z, terrain) {
  const id = key(x, z);
  const old = meshes.get(id);
  if (old) tiles.remove(old);
  const mesh = factory.create(terrain);
  const w = hexToWorld(x, z);
  mesh.position.set(w.x, 0, w.z);
  tiles.add(mesh);
  meshes.set(id, mesh);
  grid.set(x, z, { terrain });
}

function buildCity() {
  for (const m of meshes.values()) tiles.remove(m);
  meshes.clear();
  grid.cells.clear();
  for (const [x, z, terrain] of LAYOUT) place(x, z, terrain);
  for (const [i, [x, z]] of WASTE.entries()) if (!grid.has(x, z)) place(x, z, `wasteland${1 + (i % 4)}`);
  // Fog of war as free placement leaves a board: clear around the land, clouds beyond.
  fog.reset(grid);
  for (const c of grid.cells.values()) fog.openAround(c.x, c.z, fogCfg.openRadius ?? 1, true);
  drawRings();
}

// ---------- range rings: what each Intercept Network covers ----------
// Every network gets a ring at its range and a tint on each covered cell; the one under the cursor (raycast onto
// the ground) is drawn brighter. Toggle with the panel.
const rings = new THREE.Group();
rings.renderOrder = 30;
scene.add(rings);
const ringMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, toneMapped: false, fog: false });
const fillGeo = new THREE.CircleGeometry(0.47, 6).rotateZ(Math.PI / 6).rotateX(-Math.PI / 2);
const fillMat = new THREE.MeshBasicMaterial({ color: 0x6affc0, transparent: true, opacity: 0.12, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
const fillHot = new THREE.MeshBasicMaterial({ color: 0x9affe0, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
let showRings = true;
let hotNet = null;

function ringLine(cx, cz, radius, mat) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * radius, 0.08, cz + Math.sin(a) * radius));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.renderOrder = 30;
  line.frustumCulled = false;
  return line;
}

function drawRings() {
  for (const o of rings.children) o.geometry !== fillGeo && o.geometry.dispose();
  rings.clear();
  if (!showRings) return;
  const r = INTERCEPT.range;
  const covered = new Map();
  for (const c of grid.cells.values()) {
    if (c.terrain !== 'intercept') continue;
    const hot = hotNet === key(c.x, c.z);
    const w = hexToWorld(c.x, c.z);
    rings.add(ringLine(w.x, w.z, r + 0.5, ringMat(hot ? 0xc8ffe8 : 0x6affc0, hot ? 1 : 0.6)));
    for (const [x, z] of hexesAround(c.x, c.z, r)) covered.set(key(x, z), covered.get(key(x, z)) || hot);
  }
  for (const [k, hot] of covered) {
    const [x, z] = k.split(',').map(Number);
    const w = hexToWorld(x, z);
    const m = new THREE.Mesh(fillGeo, hot ? fillHot : fillMat);
    m.position.set(w.x, 0.06, w.z);
    m.renderOrder = 29;
    rings.add(m);
  }
}

// Raycast: the network under the cursor lights up its ring.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitP = new THREE.Vector3();
renderer.domElement.addEventListener('pointermove', (e) => {
  if (view !== 'home') return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  let next = null;
  if (intersectGround(ray.ray, hitP)) {
    const [x, z] = worldToHex(hitP.x, hitP.z);
    if (grid.get(x, z)?.terrain === 'intercept') next = key(x, z);
  }
  if (next !== hotNet) {
    hotNet = next;
    drawRings();
  }
});

// ---------- debug tuning panel ----------
const blastN = () => Math.max(0, (MISSILE.blast ?? 1) - 1);

const SLIDERS = [
  { label: 'Blast tiles', min: 1, max: 7, step: 1, get: () => MISSILE.blast ?? 1, set: (v) => (MISSILE.blast = v), saveMissile: true },
  { label: 'Damage to capital (HP)', min: 1, max: 5, step: 1, get: () => MISSILE.damage ?? 1, set: (v) => (MISSILE.damage = v), saveMissile: true },
  { label: 'Intercept range (cells)', min: 1, max: 8, step: 1, get: () => INTERCEPT.range, set: (v) => (INTERCEPT.range = v), save: true },
  { label: 'Hit chance per shot', min: 0, max: 1, step: 0.05, get: () => INTERCEPT.chance, set: (v) => (INTERCEPT.chance = v), save: true },
  { label: 'Oil per shot', min: 0, max: 10, step: 1, get: () => INTERCEPT.oil, set: (v) => (INTERCEPT.oil = v), save: true },
  { label: 'CIWS rounds / s', min: 5, max: 120, step: 1, get: () => MissileStrike.RATE, set: (v) => (MissileStrike.RATE = v) },
  { label: 'Round speed', min: 6, max: 60, step: 1, get: () => MissileStrike.ROUND_SPEED, set: (v) => (MissileStrike.ROUND_SPEED = v) },
  { label: 'Turret slew (s)', min: 0, max: 1, step: 0.02, get: () => MissileStrike.SLEW, set: (v) => (MissileStrike.SLEW = v) },
  { label: 'Fire before kill (s)', min: 0.1, max: 2, step: 0.05, get: () => CIWS_TUNE.kill, set: (v) => (CIWS_TUNE.kill = v) },
  { label: 'Miss burst length (s)', min: 0.2, max: 2.5, step: 0.05, get: () => CIWS_TUNE.missDur, set: (v) => (CIWS_TUNE.missDur = v) },
];

function buildTuning() {
  const el = document.getElementById('tuning');
  el.innerHTML = '';
  for (const sl of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'tune-row';
    const val = document.createElement('b');
    const input = Object.assign(document.createElement('input'), { type: 'range', min: sl.min, max: sl.max, step: sl.step, value: sl.get() });
    const show = () => (val.textContent = String(+(+sl.get()).toFixed(2)));
    input.addEventListener('input', () => {
      sl.set(Number(input.value));
      if (sl.save) saveIntercept();
      if (sl.saveMissile) saveMissileConfig(MISSILE);
      show();
      drawRings();
      renderHand();
      paint();
    });
    show();
    row.append(Object.assign(document.createElement('span'), { textContent: sl.label }), input, val);
    el.append(row);
  }
}

document.getElementById('showRings').addEventListener('change', (e) => {
  showRings = e.target.checked;
  drawRings();
});
document.getElementById('resetTune').addEventListener('click', () => {
  clearIntercept();
  Object.assign(MissileStrike, { RATE: 40, ROUND_SPEED: 24, SLEW: 0.22 });
  Object.assign(CIWS_TUNE, { kill: 0.5, missDur: 0.9 });
  buildTuning();
  drawRings();
  paint();
});
document.getElementById('giveMissile').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (busy) return;
  silo++;
  renderHand();
  paint();
});
document.getElementById('resetCity').addEventListener('click', () => {
  if (busy) return;
  oil = 9;
  hp = CAPITAL_HP;
  alive = true;
  turn = 0;
  roll = 0;
  nextBtn.textContent = 'Next turn';
  nextBtn.disabled = false;
  logEl.innerHTML = '';
  goHome(true);
  clouds.reset?.();
  rivals = createRivals((Math.random() * 0x100000000) >>> 0);
  queue = [];
  armRivals();
  buildCity();
  rearm();
  paint();
});
buildTuning();

function paint() {
  const nets = [...grid.cells.values()].filter((c) => c.terrain === 'intercept').length;
  statusEl.textContent = alive
    ? `Oil ${oil} · Interceptors ${nets} · Capital ${hp}/${CAPITAL_HP} · Missiles in hand ${silo} · Aimed ${queue.length}${shown ? ` · In ${shown.def.name} (${shown.capitalHp}/${CAPITAL_HP})` : ''}`
    : 'The capital is gone.';
}

function say(text) {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
}

function nameAt(x, z) {
  const t = grid.get(x, z)?.terrain;
  return t && t !== 'crater' ? TERRAINS[t]?.name ?? t : 'empty ground';
}

/** Buildings still worth firing at, capital last. */
function aims() {
  const cells = [...grid.cells.values()].filter((c) => c.terrain !== 'crater' && c.terrain !== 'intercept');
  cells.sort((a, b) => (a.terrain === 'capital') - (b.terrain === 'capital'));
  return cells;
}

function pickStrikes() {
  if (turn === 0) return FIRST.map((s) => ({ from: 'raid', to: 'hive', ...s }));
  const pool = aims().filter((c) => c.terrain !== 'capital');
  const chosen = pool.slice(0, 3);
  if (!chosen.length) {
    const cap = grid.get(0, 0);
    if (cap?.terrain === 'capital') chosen.push(cap);
  }
  return chosen.map((c, i) => ({
    from: 'raid',
    to: 'hive',
    at: [c.x, c.z],
    kind: i === chosen.length - 1 && chosen.length > 1 ? 'missile2' : 'missile',
  }));
}


const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ---------- one attack phase ----------
const SHOT_START = 0.22; // flight progress when the first CIWS turret opens up
const SHOT_GAP = 0.14; // each further turret this much later

function applyHit(rec) {
  for (const cell of rec.lost) {
    place(cell.x, cell.z, 'crater');
    fog.disturb(cell.x, cell.z);
  }
  drawRings();
  if (rec.capital != null) {
    hp = rec.capital;
    if (rec.eliminated) alive = false;
  }
}

function describe(rec, aimName) {
  const kind = rec.kind === 'missile2' ? 'Warhead' : 'Missile';
  if (rec.fizzled) return `${kind} never arrived.`;
  const shots = rec.shots.map((s) => (s.success ? 'an interceptor shot it down' : 'an interceptor fired and missed'));
  if (!rec.hit) return `${kind} toward the ${aimName}. ${shots.join('. ')}.`;
  const lost = rec.lost.map((c) => c.name).join(', ');
  const tail = rec.capital != null ? ` Capital takes a hit (${rec.capital} left).` : '';
  const wreck = lost ? ` Destroyed: ${lost}.` : ' The ground was empty.';
  return `${kind} toward the ${aimName}. ${shots.length ? shots.join('. ') + '.' : 'No interceptor in range.'}${wreck}${tail}`;
}

/** Fly the resolved strikes: the game's missiles, interceptors climbing from their networks to meet them. */
async function play(resolved) {
  const recs = resolved.filter((r) => !r.fizzled);
  if (!recs.length) return;
  // The camera is never touched: the missiles fly into whatever you're looking at.
  if (recs.some((r) => r.shots.length)) buzz();

  const targets = recs.map((rec) => {
    const w = hexToWorld(rec.at[0], rec.at[1]);
    return {
      x: w.x,
      z: w.z,
      cell: { x: rec.at[0], z: rec.at[1] },
      rec,
      aimName: nameAt(rec.at[0], rec.at[1]),
      flight: missileCfg.followFlight, // tracked flight time: room for the defence to act
      mustStop: !rec.hit && rec.shots.some((s) => s.success),
      fired: 0,
    };
  });
  const flying = new Map();
  const pending = new Set(targets);

  await missiles.fire(targets, {
    onMove: (pos, t, u) => {
      flying.set(t, pos.clone());
      // Interceptors leave their pads one after another while the missile comes down.
      const shots = t.rec.shots;
      while (t.fired < shots.length && u >= SHOT_START + SHOT_GAP * t.fired) {
        const shot = shots[t.fired++];
        const pad = hexToWorld(shot.x, shot.z);
        missiles.fireCIWS(findCiws(meshes.get(key(shot.x, shot.z))), new THREE.Vector3(pad.x, 0.35, pad.z), () => missiles.position(t), {
          success: shot.success,
          kill: CIWS_TUNE.kill,
          dur: CIWS_TUNE.missDur,
          onFire: (dur) => ciws(dur),
          onKill: () => {
            if (missiles.destroy(t)) {
              camShake.add(missileCfg.shake * 0.35);
              boom();
            }
          },
        });
      }
    },
    onIntercept: (t) => {
      flying.delete(t);
      pending.delete(t);
      say(describe(t.rec, t.aimName));
      paint();
    },
    onImpact: (t) => {
      flying.delete(t);
      pending.delete(t);
      boom();
      for (const [x, z] of t.rec.cells) dust.burst(x, z, t.rec.kind === 'missile2' ? 1.4 : 1.8);
      fog.disturb(t.cell.x, t.cell.z);
      camShake.add(missileCfg.shake);
    },
    onCover: (t) => {
      // The crater swap happens under the cloud, as on the board.
      if (t.rec.hit) applyHit(t.rec);
      say(describe(t.rec, t.aimName));
      paint();
    },
  });
  await wait(missileCfg.holdAfter);
}

// ---------- the War Map: rivals, aiming, the attack phase ----------
// Zoom out past max (or press War Map) to see the planet; click a rival to enter its city; click its tiles to aim
// (click again to take one back). End turn: every city fires, the flights play on the planet, then the strikes
// on Hive City play here with the CIWS.
const RIVAL_MISSILES = 2; // each rival is handed this many a turn, so they fire back in the test

function armRivals() {
  for (const r of rivals) {
    if (r.alive === false) continue;
    r.missiles.push(...Array(RIVAL_MISSILES).fill('missile'));
    r.oil = Math.max(r.oil ?? 0, 12);
    r.tension.player = Math.max(r.tension.player ?? 0, 1); // they want you
  }
}
armRivals();

const playerBuildings = () => [...grid.cells.values()].filter((c) => TERRAINS[c.terrain]?.category === 'building').length;
const globe = createGlobeView({
  renderer,
  root: document.getElementById('globeUI'),
  factory,
  playerBuildings,
  playerHp: () => hp,
  freeDuringWar: true, // move between the planet and the cities while the missiles are in the air
  onVisit: (id) => (id === 'player' ? goHome() : enterRival(id)),
  onDive: (k) => !switching && clouds.setPeek(k),
  onArrive: (s) => arrive(s),
  onApproach: (s) => approach(s),
  approachLead: () => missileCfg.followFlight,
});
const rivalView = createRivalView({ renderer, factory, rig, fogSettings: () => fogCfg, fogQuality: () => gfxCfg.fogQuality, stackAims: true });
// Our missiles coming down on a rival city, played in its own scene when you're looking at it.
const rivalMissiles = new MissileStrike(rivalView.scene, camera, missileCfg);

// ---------- a flight's countdown ran out: the strike lands now, in view or not (the camera is never moved) ----------
let landing = []; // strikes still playing in a city view: the turn waits for them

/** Craters from one strike written onto a rival's grid (the full phase is applied again at the end: same result). */
function craterRival(r, rec) {
  if (!rec.hit || !rec.lost.length) return;
  for (const c of rec.lost) r.grid.set(c.x, c.z, { terrain: 'crater' });
  const hit = new Set(rec.lost.map((c) => key(c.x, c.z)));
  r.pieces = (r.pieces ?? []).filter((p) => !p.cells.some(([x, z]) => hit.has(key(x, z))));
  r.version = (r.version ?? 0) + 1;
  if (rivalView.rival === r) rivalView.refresh();
}

function playRival(r, rec) {
  const w = hexToWorld(rec.at[0], rec.at[1]);
  const t = { x: w.x, z: w.z, rec, flight: missileCfg.followFlight, fired: 0 };
  return rivalMissiles.fire([t], {
    onMove: (pos, tt, u) => {
      // Their interceptors: a burst of flak that meets it (or misses) on the way down.
      const shots = tt.rec.shots;
      while (tt.fired < shots.length && u >= SHOT_START + SHOT_GAP * tt.fired) {
        const shot = shots[tt.fired++];
        const pad = hexToWorld(shot.x, shot.z);
        rivalMissiles.fireCIWS(null, new THREE.Vector3(pad.x, 0.35, pad.z), () => rivalMissiles.position(tt), {
          success: shot.success,
          kill: CIWS_TUNE.kill,
          dur: CIWS_TUNE.missDur,
          onKill: () => rivalMissiles.destroy(tt) && boom(),
        });
      }
    },
    onImpact: () => {
      boom();
      if (view === 'rival') camShake.add(missileCfg.shake);
    },
    onCover: () => craterRival(r, rec),
  });
}

const played = new Set(); // strikes already playing in a city view (started at approach)
/** Hive City's Missile Magazines fire the salvo up and away as the countdown starts (camera untouched). */
function launchSalvo(count) {
  const silos = [...grid.cells.values()].filter((c) => c.terrain === 'magazine');
  if (!count || !silos.length) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize();
  for (let k = 0; k < count; k++) {
    const c = silos[k % silos.length];
    const w = hexToWorld(c.x, c.z);
    const side = (Math.random() - 0.5) * 4;
    const from = { x: w.x, y: 0.6, z: w.z };
    setTimeout(() => {
      missiles.fire([{ x: w.x, z: w.z, from, away: true, lean: { x: dir.x * 5 - dir.z * side, z: dir.z * 5 + dir.x * side }, flight: 1.6, accel: 1.9 }]);
      boom();
    }, k * 350);
  }
}

function approach(rec) {
  if (rec.fizzled) return;
  if (rec.to === 'player' && view === 'home') {
    played.add(rec);
    landing.push(play([rec]));
    return;
  }
  const r = rivals.find((x) => x.id === rec.to);
  if (r && view === 'rival' && shown === r && rec.from === 'player') {
    played.add(rec);
    landing.push(playRival(r, rec));
  }
}

function arrive(rec) {
  if (rec.fizzled || played.has(rec)) return;
  if (rec.to === 'player') {
    if (view === 'home') landing.push(play([rec]));
    else {
      if (rec.hit) applyHit(rec);
      say(`Hive City (off screen): ${describe(rec, nameAt(rec.at[0], rec.at[1]))}`);
      paint();
    }
    return;
  }
  const r = rivals.find((x) => x.id === rec.to);
  if (!r) return;
  if (view === 'rival' && shown === r && rec.from === 'player') landing.push(playRival(r, rec));
  else craterRival(r, rec);
}
const viewBtn = document.getElementById('viewBtn');

function setView(next) {
  view = next;
  viewBtn.textContent = next === 'home' ? 'War Map' : next === 'globe' ? 'Hive City' : '← War Map';
  document.body.dataset.view = next;
  renderHand();
  paint();
}

// The game's view switches: clouds roll in (continuing from the overscroll / dive peek), the view swaps behind
// them, they part. Scroll out past max (home or a rival) climbs into the clouds and opens the planet; scrolling
// in on a city on the planet dives into it.
const clouds = createCloudTransition(document.getElementById('viewClouds'));
let switching = false;
let swapChain = Promise.resolve();
/** Switches queue up: one asked for while another is running waits its turn instead of being dropped. */
function swapView(change) {
  swapChain = swapChain.then(async () => {
    switching = true;
    await clouds.cover();
    change();
    await clouds.uncover();
    switching = false;
  });
  return swapChain;
}

function openGlobe() {
  if (view === 'globe' || switching) return Promise.resolve();
  const from = view === 'rival' ? shown?.id : 'player';
  rig.locked = true;
  return swapView(() => {
    if (view === 'rival') {
      rivalView.exit();
      shown = null;
    }
    setBoardFraming(false);
    setView('globe');
    globe.enter(rivals, from ?? 'player');
    globe.setQueued(queue.map((q) => ({ from: 'player', to: q.to })));
  });
}

/** Back to Hive City. instant: no clouds (already covered, or a reset). */
function goHome(instant = false) {
  const change = () => {
    if (view === 'rival') rivalView.exit();
    globe.exit();
    shown = null;
    rig.release();
    rig.resetOverscroll();
    rig.goal.set(REST.x, 0, REST.z);
    rig.target.copy(rig.goal);
    // Arrive pulled out, then settle in (as the game does).
    rig.distance = rig.maxDistance;
    rig.goalDistance = REST.distance;
    setView('home');
  };
  if (instant || view === 'home') return change();
  return swapView(() => view !== 'home' && change());
}

function enterRival(id) {
  const r = rivals.find((x) => x.id === id);
  if (!r || r.alive === false) return;
  swapView(() => {
    globe.exit();
    rig.release();
    rig.resetOverscroll();
    rivalView.enter(r);
    const settle = rig.goalDistance;
    rig.distance = rig.maxDistance;
    rig.goalDistance = settle;
    shown = r;
    setView('rival');
    drawAims();
  });
}

/** Which way Hive City lies from a rival on the War Map. */
function homeBearing(r) {
  const dx = PLAYER_NODE.x - r.def.map.x;
  const dz = PLAYER_NODE.y - r.def.map.y;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** `at`: a salvo's cell under the cursor, where its reticle centres. */
function drawAims(hover = null, at = null) {
  if (!shown) return;
  const mine = queue.filter((q) => q.to === shown.id);
  const aimed = mine.map((q) => q.cells ?? footprint(q.kind, q.at, q.size ?? blastN(), shown.grid));
  rivalView.setMarkers(aimed, hover, at);
  rivalView.setArcs(hover ? [hover] : [], homeBearing(shown), aimed.flat(), at);
  // What's queued keeps its reticle and path until End turn fires it: one per card played (a salvo's tiles together).
  const cards = new Map();
  for (const q of mine) {
    const k = q.card;
    if (!cards.has(k)) cards.set(k, { key: k, cells: [], at: q.centre ?? q.at });
    cards.get(k).cells.push(...(q.cells ?? footprint(q.kind, q.at, q.size ?? blastN(), shown.grid)));
  }
  rivalView.setAimed([...cards.values()], homeBearing(shown));
}

rig.onZoomPastMax = () => {
  if ((view === 'home' || view === 'rival') && !switching) openGlobe();
  else rig.resetOverscroll();
};
viewBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (switching) return;
  if (view === 'home' || view === 'rival') openGlobe();
  else goHome();
});

// ---------- the missile hand: one card per armed silo slot; drag a card onto a rival tile to aim it ----------
const handEl = document.getElementById('missileHand');

/** Every silo armed: the hand holds as many missiles as the city can store (base slots + each Magazine). */
function rearm() {
  silo = Math.max(0, missileCapacity(grid) - queue.length);
  renderHand();
}

function handKinds() {
  const kinds = [];
  if (silo > 2) kinds.push('salvo');
  for (let i = 0; i < silo; i++) kinds.push('missile');
  return kinds;
}

function renderHand() {
  handEl.innerHTML = '';
  handEl.classList.toggle('hidden', view !== 'rival' || busy);
  for (const kind of handKinds()) {
    const t = cardDef(kind);
    const c = document.createElement('div');
    c.className = 'card action';
    c.dataset.kind = kind;
    c.style.setProperty('--top', hex(t.top));
    c.style.setProperty('--edge', hex(t.edge));
    c.innerHTML = `<div class="art">${cardArtHTML(kind)}</div>${snapHTML(t)}<div class="name">${t.name}</div><div class="rule">${cardText(t)}</div>`;
    c.addEventListener('pointerdown', startDrag);
    handEl.append(c);
  }
}

/** The cell of the rival city under a screen point, or null. */
function rivalCellAt(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!intersectGround(ray.ray, hitP)) return null;
  return worldToHex(hitP.x, hitP.z);
}

let drag = null;
let cardsPlayed = 0; // names each card played, so its queued tiles share one set of marks
function startDrag(e) {
  if (view !== 'rival' || busy || e.button !== 0) return;
  e.preventDefault();
  const card = e.currentTarget;
  const ghost = card.cloneNode(true);
  ghost.classList.add('ghost');
  document.body.append(ghost);
  card.classList.add('lifted');
  drag = { card, ghost, kind: card.dataset.kind };
  moveDrag(e);
}
function moveDrag(e) {
  if (!drag) return;
  drag.ghost.style.transform = `translate(${e.clientX - 54}px, ${e.clientY - 90}px)`;
  const onCanvas = document.elementFromPoint(e.clientX, e.clientY) === renderer.domElement;
  const c = onCanvas ? rivalCellAt(e.clientX, e.clientY) : null;
  let hover = null;
  if (c && shown?.grid.has(c[0], c[1])) {
    hover =
      drag.kind === 'salvo'
        ? spreadFrom(shown.grid, c, silo)
        : footprint(
            'missile',
            c,
            blastN(),
            shown.grid,
            new Set(queue.filter((q) => q.to === shown.id).flatMap((q) => footprint(q.kind, q.at, q.size ?? blastN(), shown.grid)).map(([x, z]) => key(x, z))),
          );
  }
  drawAims(hover, c);
}
window.addEventListener('pointermove', moveDrag);
window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const { card, ghost, kind } = drag;
  drag = null;
  ghost.remove();
  card.classList.remove('lifted');
  const onCanvas = document.elementFromPoint(e.clientX, e.clientY) === renderer.domElement;
  const c = onCanvas ? rivalCellAt(e.clientX, e.clientY) : null;
  if (c && shown?.grid.has(c[0], c[1]) && silo > 0) {
    // Aimed only: everything queued fires together at End turn. A tile already aimed can take more (they stack).
    const card = `card${++cardsPlayed}`;
    const taken = new Set(
      queue.filter((q) => q.to === shown.id).flatMap((q) => q.cells ?? footprint(q.kind, q.at, q.size ?? blastN(), shown.grid)).map(([x, z]) => key(x, z)),
    );
    const lock = (at, centre) => {
      const cells = footprint('missile', at, blastN(), shown.grid, taken);
      for (const [x, z] of cells) taken.add(key(x, z));
      queue.push({ to: shown.id, at, kind: 'missile', size: blastN(), card, centre, cells });
      silo--;
    };
    if (kind === 'salvo') {
      for (const at of spreadFrom(shown.grid, c, silo)) {
        if (silo <= 0) break;
        lock(at, [c[0], c[1]]);
      }
    } else lock([c[0], c[1]]);
  }
  renderHand();
  drawAims();
  paint();
});

// A click on an aimed tile takes that missile back into the hand.
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = view === 'rival' ? { x: e.clientX, y: e.clientY } : null));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (drag || !downAt || view !== 'rival' || busy || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  const c = rivalCellAt(e.clientX, e.clientY);
  if (!c) return;
  const i = queue.findIndex((q) => q.to === shown.id && q.at[0] === c[0] && q.at[1] === c[1]);
  if (i < 0) return;
  queue.splice(i, 1);
  silo++;
  renderHand();
  drawAims();
  paint();
});

async function nextTurn() {
  if (busy || !alive) return;
  busy = true;
  nextBtn.disabled = true;
  try {
    await runTurn();
  } catch (err) {
    console.error('End turn failed', err);
    say(`End turn failed: ${err?.message ?? err}`);
  } finally {
    busy = false;
    nextBtn.disabled = !alive;
    if (!alive) nextBtn.textContent = 'City fell';
    renderHand();
    paint();
  }
}

async function runTurn() {
  const cities = [
    { id: 'player', grid, oil: Infinity, hp, alive: true, buildings: playerBuildings() }, // the test city never runs dry
    ...rivals.filter((r) => r.alive !== false).map((r) => ({ id: r.id, grid: r.grid, oil: r.oil ?? 0, hp: r.capitalHp, alive: true, buildings: r.stats.buildings })),
  ];
  const strikes = [
    ...queue.map((q) => ({ from: 'player', ...q })),
    ...rivals.filter((r) => r.alive !== false).flatMap((r) => chooseStrikes(r, cities, { round: 99, chance: INTERCEPT.chance })),
  ];
  // Testing: every End Turn is a real attack. A rival that held back (its AI keeps a reserve) still fires at you.
  if (!strikes.some((s) => s.to === 'player')) {
    const shooter = rivals.find((r) => r.alive !== false);
    const pool = [...grid.cells.values()].filter((c) => TERRAINS[c.terrain]?.category === 'building' && c.terrain !== 'capital');
    pool.sort(() => Math.random() - 0.5);
    if (shooter) for (const c of pool.slice(0, RIVAL_MISSILES)) strikes.push({ from: shooter.id, to: 'player', at: [c.x, c.z], kind: 'missile' });
  }
  queue = [];
  if (!strikes.length) {
    say('Nobody fired this turn.');
  } else {
    const { strikes: res, results } = resolve(strikes, cities, rng);
    // Every flight leaves at once; you stay where you are. Each lands when its countdown runs out (arrive()).
    globe.setQueued([]);
    drawAims();
    landing = [];
    played.clear();
    if (view === 'home') launchSalvo(strikes.filter((s) => s.from === 'player').length);
    await globe.playAttack(res, rivals);
    await Promise.all(landing);
    for (const r of rivals) {
      applyToRival(r, results.get(r.id));
      noteAttacks(r, res);
      r.stats = rivalStats(r.grid, r);
    }
    for (const rec of res.filter((x) => x.from === 'player')) {
      const name = rivals.find((r) => r.id === rec.to)?.def.name;
      say(`You → ${name}: ${rec.hit ? `hit${rec.lost.length ? ` (${rec.lost.map((c) => c.name).join(', ')})` : ''}${rec.capital != null ? `, Capital ${rec.capital}/${CAPITAL_HP}` : ''}${rec.eliminated ? ' · DESTROYED' : ''}` : 'intercepted'}`);
    }
    globe.renderLabels();
  }
  armRivals();
  rearm();
  turn += 1;
  if (rivals.every((r) => r.alive === false)) say('Every rival has fallen. Victory.');
  paint();
}

nextBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  nextTurn();
});

// Models: the core set first, then the extras swap in for their stand-ins.
factory.ready.then(() => {
  buildCity();
  rearm();
  paint();
  nextBtn.disabled = false;
});
factory.extrasReady?.then(() => {
  for (const cell of [...grid.cells.values()]) place(cell.x, cell.z, cell.terrain);
});

// ---------- arrival timer: when the missiles in the air reach the city in view ----------
const timerEl = document.getElementById('warTimer');
const nameOf = (id) => (id === 'player' ? 'Hive City' : rivals.find((r) => r.id === id)?.def.name ?? id);
function updateTimer() {
  const flights = globe.arrivals();
  if (!flights.length) {
    timerEl.classList.add('hidden');
    return;
  }
  const here = view === 'rival' ? shown?.id : view === 'home' ? 'player' : null;
  const lines = [];
  // The city in view first (big), then every other target (small).
  const by = new Map();
  for (const f of flights) {
    const g = by.get(f.to) ?? { n: 0, eta: Infinity, mine: 0 };
    g.n++;
    g.eta = Math.min(g.eta, f.eta);
    if (f.from === 'player') g.mine++;
    by.set(f.to, g);
  }
  const fmt = (t) => `${t.toFixed(1)}s`;
  if (here) {
    const g = by.get(here);
    lines.push(g ? `<b>${g.n} missile${g.n === 1 ? '' : 's'} arriving at ${nameOf(here)} in ${fmt(g.eta)}</b>` : `<b>Nothing inbound on ${nameOf(here)}</b>`);
  } else lines.push(`<b>Missiles in the air: ${flights.length}</b>`);
  for (const [to, g] of [...by].sort((a, b) => a[1].eta - b[1].eta)) {
    if (to === here) continue;
    lines.push(`<span class="${to === 'player' ? 'bad' : g.mine ? 'good' : ''}">${nameOf(to)}: ${g.n} in ${fmt(g.eta)}</span>`);
  }
  timerEl.innerHTML = lines.join('');
  timerEl.classList.remove('hidden');
}

// ---------- frame: the game's order ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (view !== 'globe' && !switching) clouds.setPeek(rig.stretch ** 0.8 * 0.92);
  if (view !== 'globe') globe.tickWar(dt); // the flights keep flying while you look at a city
  if (view !== 'home') {
    // Hive City's strike effects keep time too while it's off screen.
    missiles.update(dt);
    dust.update(dt);
  }
  rivalMissiles.update(dt);
  updateTimer();
  if (view === 'globe') {
    factory.update(dt);
    flattenCurve();
    globe.update(dt);
    globe.render();
    requestAnimationFrame(frame);
    return;
  }
  if (view === 'rival') {
    rig.update(dt);
    camShake.update(dt, rig.distance);
    factory.update(dt);
    updateCurve(camera, rig.target);
    rivalView.update(dt, camera);
    renderer.render(rivalView.scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  rig.update(dt);
  followTarget(rig.target, rig.distance, dt);
  camShake.update(dt, rig.distance);
  missiles.update(dt);
  dust.update(dt);
  factory.update(dt);
  fog.update(dt, rig.target, rig.distance);
  updateCurve(camera, rig.target);
  fog.render(camera);
  crt.begin();
  renderer.render(scene, camera);
  crt.end(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
