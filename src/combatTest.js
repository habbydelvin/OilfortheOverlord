import { updateCurve } from './curvature.js'; // first: bends every material made after it (Planet map shape)
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid, hexToWorld, worldToHex, hexesAround, hexDistance, key } from './grid.js';
import { INTERCEPT, INTERCEPT_DEFAULTS, saveIntercept, clearIntercept, missileCapacity, DECOY, BOOST, saveDecoy, saveBoost, clearDecoyBoost } from './arsenal.js';
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
import { MissileStrike, MISSILE, MISSILE_DEFAULTS, loadMissileConfig, saveMissileConfig, clearMissileConfig } from './missiles.js';
import { Dust } from './dust.js';
import { CameraShake, loadShakeConfig } from './cameraShake.js';
import { loadGfxConfig, applyGfx } from './graphics.js';
import { CrtPass } from './crtPass.js';
import { CAPITAL_HP, resolve, VOLLEY_GAP } from './war.js';
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
  // Decoy Builder (decoys launch from it) and a Launch Accelerator speeding up everything launched within its radius.
  [3, -3, 'booster'],
  [4, -3, 'decoyworks'],
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

// War state (declared early: the tuning panel reads it on load).
let view = 'home'; // 'home' | 'globe' | 'rival'
/**
 * Test rivals all get a real air defence: RIVAL_NETS Intercept Networks spread around their Capital (on their own
 * tiles, keeping the Capital), so decoys have turrets to fool.
 */
const RIVAL_NETS = 3;
function armRivalDefence(list) {
  for (const r of list) {
    const cells = [...r.grid.cells.values()];
    const cap = cells.find((c) => c.terrain === 'capital') ?? cells[0];
    if (!cap) continue;
    let have = cells.filter((c) => c.terrain === 'intercept').length;
    // Ring 1-2 cells out from the Capital, spaced: skip cells touching a network already placed.
    const spots = cells
      .filter((c) => c.terrain !== 'capital' && c.terrain !== 'intercept')
      .map((c) => ({ c, d: Math.abs(hexDistance(c.x, c.z, cap.x, cap.z) - 2) }))
      .sort((a, b) => a.d - b.d)
      .map((o) => o.c);
    for (const c of spots) {
      if (have >= RIVAL_NETS) break;
      const near = [...r.grid.cells.values()].some((n) => n.terrain === 'intercept' && hexDistance(n.x, n.z, c.x, c.z) < 2);
      if (near) continue;
      r.grid.set(c.x, c.z, { terrain: 'intercept' });
      r.pieces = (r.pieces ?? []).filter((p) => !p.cells.some(([x, z]) => x === c.x && z === c.z));
      have++;
    }
    r.stats = rivalStats(r.grid, r);
    r.version = (r.version ?? 0) + 1;
  }
  return list;
}
let rivals = armRivalDefence(createRivals((Math.random() * 0x100000000) >>> 0));
let shown = null; // rival in view
let decoys = 0; // decoy cards in hand (one per Decoy Builder each turn, plus Add decoy)
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
  { label: 'Missile flight time (s)', min: 0.6, max: 8, step: 0.1, get: () => MISSILE.followFlight ?? 2.2, set: (v) => (MISSILE.followFlight = v), saveMissile: true },
  { label: 'Missile acceleration', min: 0.5, max: 3, step: 0.05, get: () => MISSILE.accel ?? 1.4, set: (v) => (MISSILE.accel = v), saveMissile: true },
  { label: 'Intercept range ring (cells)', min: 1, max: 8, step: 1, get: () => INTERCEPT.range, set: (v) => (INTERCEPT.range = v), save: true },
  { label: 'Gun reach in the sky (units)', min: 4, max: 30, step: 1, get: () => INTERCEPT.reach, set: (v) => (INTERCEPT.reach = v), save: true },
  { label: 'Upkeep (oil / season)', min: 0, max: 10, step: 1, get: () => INTERCEPT.upkeep, set: (v) => (INTERCEPT.upkeep = v), save: true },
  { label: 'Turret turn speed (rad/s)', min: 0.5, max: 12, step: 0.25, get: () => INTERCEPT.turnSpeed, set: (v) => (INTERCEPT.turnSpeed = v), save: true },
  { label: 'Rounds / s', min: 5, max: 120, step: 1, get: () => INTERCEPT.rate, set: (v) => (INTERCEPT.rate = v), save: true },
  { label: 'Round speed', min: 6, max: 60, step: 1, get: () => INTERCEPT.roundSpeed, set: (v) => (INTERCEPT.roundSpeed = v), save: true },
  { label: 'Spread (rad)', min: 0, max: 0.4, step: 0.01, get: () => INTERCEPT.spread, set: (v) => (INTERCEPT.spread = v), save: true },
  { label: 'Hit radius', min: 0.02, max: 0.5, step: 0.01, get: () => INTERCEPT.hitRadius, set: (v) => (INTERCEPT.hitRadius = v), save: true },
  { label: 'Damage per round', min: 1, max: 5, step: 1, get: () => INTERCEPT.damage, set: (v) => (INTERCEPT.damage = v), save: true },
  { label: 'Missile HP', min: 1, max: 20, step: 1, get: () => INTERCEPT.hpMissile, set: (v) => (INTERCEPT.hpMissile = v), save: true },
  { label: 'Warhead HP', min: 1, max: 30, step: 1, get: () => INTERCEPT.hpWarhead, set: (v) => (INTERCEPT.hpWarhead = v), save: true },
  { label: 'Decoy: fakes per decoy', min: 0, max: 12, step: 1, get: () => DECOY.fakes, set: (v) => (DECOY.fakes = v), saveDecoy: true },
  { label: 'Decoy: split point (lower = splits higher)', min: 0.1, max: 0.95, step: 0.05, get: () => DECOY.splitAt, set: (v) => (DECOY.splitAt = v), saveDecoy: true },
  { label: 'Decoy: HP before split', min: 1, max: 20, step: 1, get: () => DECOY.hp, set: (v) => (DECOY.hp = v), saveDecoy: true },
  { label: 'Decoy: HP per fake', min: 1, max: 10, step: 1, get: () => DECOY.fakeHp, set: (v) => (DECOY.fakeHp = v), saveDecoy: true },
  { label: 'Decoy: fake spread (cells)', min: 0, max: 5, step: 0.5, get: () => DECOY.spread, set: (v) => (DECOY.spread = v), saveDecoy: true },
  { label: 'Accelerator radius (cells)', min: 1, max: 5, step: 1, get: () => BOOST.radius, set: (v) => (BOOST.radius = v), saveBoost: true },
  { label: 'Accelerator travel × (lower = faster)', min: 0.2, max: 1, step: 0.05, get: () => BOOST.travel, set: (v) => (BOOST.travel = v), saveBoost: true },
  { label: 'Accelerator dive × (lower = faster)', min: 0.2, max: 1, step: 0.05, get: () => BOOST.flight, set: (v) => (BOOST.flight = v), saveBoost: true },
  { label: 'Evasive weave (units, 0 = off)', min: 0, max: 3, step: 0.05, get: () => BOOST.weave, set: (v) => (BOOST.weave = v), saveBoost: true },
  { label: 'Evasive weave (swings / s)', min: 0.2, max: 4, step: 0.1, get: () => BOOST.weaveFreq, set: (v) => (BOOST.weaveFreq = v), saveBoost: true },
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
      if (sl.saveDecoy) saveDecoy();
      if (sl.saveBoost) saveBoost();
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
  clearMissileConfig();
  clearDecoyBoost();
  Object.assign(MISSILE, MISSILE_DEFAULTS);
  buildTuning();
  drawRings();
  paint();
});
// Tuning as JSON: copy it (to send, or to paste into the code defaults), or paste one back in.
const tuneJson = () => JSON.stringify({ missile: { blast: MISSILE.blast, damage: MISSILE.damage, followFlight: MISSILE.followFlight, accel: MISSILE.accel }, intercept: { ...INTERCEPT }, decoy: { ...DECOY }, boost: { ...BOOST } }, null, 2);
document.getElementById('copyTune').addEventListener('click', async (e) => {
  const json = tuneJson();
  try {
    await navigator.clipboard.writeText(json);
    say('Tuning copied as JSON.');
  } catch {
    window.prompt('Copy the tuning JSON:', json);
  }
  e.currentTarget.blur();
});
document.getElementById('applyTune').addEventListener('click', (e) => {
  e.currentTarget.blur();
  const text = window.prompt('Paste tuning JSON:');
  if (!text) return;
  try {
    const t = JSON.parse(text);
    for (const [k, v] of Object.entries(t.missile ?? {})) if (typeof v === 'number') MISSILE[k] = v;
    for (const [k, v] of Object.entries(t.intercept ?? {})) if (k in INTERCEPT && typeof v === 'number') INTERCEPT[k] = v;
    for (const [k, v] of Object.entries(t.decoy ?? {})) if (k in DECOY && typeof v === 'number') DECOY[k] = v;
    for (const [k, v] of Object.entries(t.boost ?? {})) if (k in BOOST && typeof v === 'number') BOOST[k] = v;
    saveDecoy();
    saveBoost();
    saveMissileConfig(MISSILE);
    saveIntercept();
    buildTuning();
    drawRings();
    paint();
    say('Tuning applied from JSON.');
  } catch (err) {
    say(`Bad tuning JSON: ${err.message}`);
  }
});
document.getElementById('giveMissile').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (busy) return;
  silo++;
  renderHand();
  paint();
});
document.getElementById('giveDecoy').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (busy) return;
  decoys++;
  renderHand();
  paint();
  say('Decoy added to your hand: drag it onto a rival tile (it goes up with your missiles).');
});
// Decoys at Hive City: each rival sends this many more at you next End turn (the Decoys column).
document.getElementById('incomingDecoys').addEventListener('click', (e) => {
  e.currentTarget.blur();
  for (const r of rivals) if (r.alive !== false) decoysIn.set(r.id, (decoysIn.get(r.id) ?? 1) + 1);
  renderIncoming();
  say('Each rival sends one more decoy at Hive City next End turn. Stay in Hive City to watch them split.');
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
  rivals = armRivalDefence(createRivals((Math.random() * 0x100000000) >>> 0));
  queue = [];
  armRivals();
  incoming.clear();
  magazines.clear();
  buildCity();
  renderIncoming(); // after the city: its magazine count comes from the new board
  rearm();
  paint();
});
buildTuning();

function paint() {
  const nets = [...grid.cells.values()].filter((c) => c.terrain === 'intercept').length;
  statusEl.textContent = alive
    ? `Oil ${oil} · Interceptors ${nets} · Capital ${hp}/${CAPITAL_HP} · Missiles in hand ${silo} · Decoys ${decoys} · Aimed ${queue.length}${shown ? ` · In ${shown.def.name} (${shown.capitalHp}/${CAPITAL_HP})` : ''}`
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
// Intercept Networks are simulated (interceptSim.js via war.js); the city on screen replays that defence on the
// War Map clock: turrets turning, one stream each, the rounds, the kills.
let warSims = new Map();
const warClock = () => globe.warTime();
function syncDefence() {
  const home = busy && view === 'home' ? warSims.get('player') : null;
  missiles.setDefence(home ?? null, warClock, (i) => findCiws(meshes.get(key(home.turrets[i].x, home.turrets[i].z))), (d) => ciws(d));
  rivalMissiles.setDefence((busy && view === 'rival' && shown && warSims.get(shown.id)) || null, warClock);
}

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
  if (rec.decoy) return `Decoy: drew ${rec.drew ?? 0} kill${rec.drew === 1 ? '' : 's'}${rec.killed ? ' (shot down before splitting)' : ''}.`;
  const kind = rec.kind === 'missile2' ? 'Warhead' : 'Missile';
  if (rec.fizzled) return `${kind} never arrived.`;
  const shots = rec.shots.map((s) => (s.success ? 'an interceptor shot it down' : 'an interceptor fired and missed'));
  if (!rec.hit) return `${kind} toward the ${aimName}. ${shots.join('. ')}.`;
  const lost = rec.lost.map((c) => c.name).join(', ');
  const tail = rec.capital != null ? ` Capital takes a hit (${rec.capital} left).` : '';
  const wreck = lost ? ` Destroyed: ${lost}.` : ' The ground was empty.';
  return `${kind} toward the ${aimName}. ${shots.length ? shots.join('. ') + '.' : 'No interceptor in range.'}${wreck}${tail}`;
}

/** A resolved strike as a MissileStrike target: its simulated flight, plus a decoy's split and fakes. */
function simTarget(rec) {
  const w = hexToWorld(rec.at[0], rec.at[1]);
  return {
    x: w.x,
    z: w.z,
    cell: { x: rec.at[0], z: rec.at[1] },
    rec,
    path: rec.path,
    t0: rec.t0,
    flight: rec.flight,
    accel: rec.accel,
    killAt: rec.killed ? rec.killAt : null,
    clock: warClock,
    boosted: !!rec.boosted,
    weave: rec.weave ?? null,
    harmless: !!rec.harmless,
    splitAt: rec.decoy ? rec.splitAt : null,
    fakes: rec.decoy
      ? rec.fakes.map((f) => {
          const fw = hexToWorld(f.at[0], f.at[1]);
          return { x: fw.x, z: fw.z, cell: { x: f.at[0], z: f.at[1] }, rec, path: f.path, t0: f.t0, flight: f.flight, accel: f.accel, killAt: f.killed ? f.killAt : null, void: !!f.void, harmless: true, fake: true };
        })
      : null,
  };
}

/** Fly the resolved strikes: the game's missiles, interceptors climbing from their networks to meet them. */
async function play(resolved) {
  const recs = resolved.filter((r) => !r.fizzled);
  if (!recs.length) return;
  // The camera is never touched: the missiles fly into whatever you're looking at.
  if (recs.some((r) => r.shots.length)) buzz();

  const targets = recs.map((rec) => ({ ...simTarget(rec), aimName: nameAt(rec.at[0], rec.at[1]) }));
  const flying = new Map();
  const pending = new Set(targets);

  await missiles.fire(targets, {
    onMove: (pos, t) => flying.set(t, pos.clone()),
    onIntercept: (t) => {
      boom();
      camShake.add(missileCfg.shake * 0.35);
      flying.delete(t);
      pending.delete(t);
      if (!t.rec.decoy) say(describe(t.rec, t.aimName));
      paint();
    },
    onImpact: (t) => {
      flying.delete(t);
      pending.delete(t);
      boom();
      if (t.harmless) dust.burst(t.cell.x, t.cell.z, 0.7);
      else for (const [x, z] of t.rec.cells) dust.burst(x, z, t.rec.kind === 'missile2' ? 1.4 : 1.8);
      fog.disturb(t.cell.x, t.cell.z);
      camShake.add(missileCfg.shake * (t.harmless ? 0.3 : 1));
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
const rivalView = createRivalView({ renderer, factory, rig, fogSettings: () => fogCfg, fogQuality: () => gfxCfg.fogQuality, stackAims: true, keepMaxZoom: true });
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
  return rivalMissiles.fire([simTarget(rec)], {
    onIntercept: () => boom(),
    onImpact: (t) => {
      boom();
      if (view === 'rival') camShake.add(missileCfg.shake * (t?.harmless ? 0.3 : 1));
    },
    onCover: () => craterRival(r, rec),
  });
}

const played = new Set(); // strikes already playing in a city view (started at approach)
/** Hive City's Missile Magazines fire the salvo up and away as the countdown starts (camera untouched). */
function launchSalvo(recs) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize();
  // Each strike goes up from its own launcher (war.js: Magazine, or Decoy Builder for decoys) at its launch time.
  for (const rec of recs) {
    const at = rec.launcher ?? { x: 0, z: 0 };
    const w = hexToWorld(at.x, at.z);
    const side = (Math.random() - 0.5) * 4;
    const from = { x: w.x, y: 0.6, z: w.z };
    setTimeout(() => {
      missiles.fire([{ x: w.x, z: w.z, from, away: true, lean: { x: dir.x * 5 - dir.z * side, z: dir.z * 5 + dir.x * side }, flight: rec.boosted ? 1.6 * BOOST.flight : 1.6, accel: 1.9, boosted: !!rec.boosted, harmless: !!rec.decoy }]);
      dust.burst(at.x, at.z, 0.8);
      boom();
    }, (rec.launch ?? 0) * 1000);
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
  if (rec.decoy) {
    if (rec.to === 'player' && view !== 'home') say(`Hive City (off screen): ${describe(rec)}`);
    else if (rec.from === 'player') say(`Your ${describe(rec)}`);
    return;
  }
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
/** fan: the hover is a salvo: one flight path per missile in it, not one for the lot. */
function drawAims(hover = null, at = null, fan = false) {
  if (!shown) return;
  const mine = queue.filter((q) => q.to === shown.id);
  const aimed = mine.map((q) => q.cells ?? footprint(q.kind, q.at, q.size ?? blastN(), shown.grid));
  rivalView.setMarkers(aimed, hover, at);
  rivalView.setArcs(hover ? (fan ? hover.map((cell) => [cell]) : [hover]) : [], homeBearing(shown), aimed.flat(), fan ? null : at);
  // What's queued keeps its reticle and path until End turn fires it: one per missile (a salvo shows every flight).
  const groups = mine.map((q, i) => ({ key: `${q.card}|${i}`, cells: q.cells ?? footprint(q.kind, q.at, q.size ?? blastN(), shown.grid), at: q.at }));
  rivalView.setAimed(groups, homeBearing(shown));
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
  silo = Math.max(0, missileCapacity(grid) - queue.filter((q) => q.kind !== 'decoy').length);
  decoys = Math.max(decoys, [...grid.cells.values()].filter((c) => c.terrain === 'decoyworks').length);
  renderHand();
}

function handKinds() {
  const kinds = [];
  if (silo + decoys > 2) kinds.push('salvo');
  for (let i = 0; i < silo; i++) kinds.push('missile');
  for (let i = 0; i < decoys; i++) kinds.push('decoy');
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
      drag.kind === 'decoy'
        ? [[c[0], c[1]]]
        : drag.kind === 'salvo'
        ? spreadFrom(shown.grid, c, silo + decoys)
        : footprint(
            'missile',
            c,
            blastN(),
            shown.grid,
            new Set(queue.filter((q) => q.to === shown.id).flatMap((q) => footprint(q.kind, q.at, q.size ?? blastN(), shown.grid)).map(([x, z]) => key(x, z))),
          );
  }
  drawAims(hover, c, drag.kind === 'salvo');
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
  if (kind === 'decoy' && c && shown?.grid.has(c[0], c[1]) && decoys > 0) {
    queue.push({ to: shown.id, at: [c[0], c[1]], kind: 'decoy', size: 0, card: `card${++cardsPlayed}`, cells: [[c[0], c[1]]] });
    decoys--;
  } else if (kind !== 'decoy' && c && shown?.grid.has(c[0], c[1]) && silo > 0) {
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
      // Every missile and decoy in hand fans out from the tile (decoys first, so they lead the volley).
      for (const at of spreadFrom(shown.grid, c, silo + decoys)) {
        if (decoys > 0) {
          queue.push({ to: shown.id, at, kind: 'decoy', size: 0, card, centre: [c[0], c[1]], cells: [at] });
          decoys--;
        } else if (silo > 0) lock(at, [c[0], c[1]]);
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
  const [taken] = queue.splice(i, 1);
  if (taken.kind === 'decoy') decoys++;
  else silo++;
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

// ---------- test setup: how many missiles each rival fires at you, and placing Intercept Networks ----------
const incoming = new Map(); // rival id -> missiles at Hive City each End turn
const decoysIn = new Map(); // rival id -> decoys flying in ahead of them
const boostedIn = new Map(); // rival id -> its strikes count as launched next to a Launch Accelerator
let placingNets = false;

const magazines = new Map(); // city id -> Missile Magazines (launchers per volley), set in the table
const gridMagazines = (g) => [...g.cells.values()].filter((c) => c.terrain === 'magazine').length;

function renderIncoming() {
  const el = document.getElementById('incoming');
  const total = () => rivals.reduce((n, r) => n + (r.alive === false ? 0 : incoming.get(r.id) ?? 0), 0);
  el.innerHTML = `<table class="inc-table"><thead><tr><th>City</th><th>Missiles at you</th><th>Magazines</th><th>Decoys</th><th>Boosted</th></tr></thead><tbody></tbody>
    <tfoot><tr><td>Total</td><td id="incTotal"></td><td></td><td></td><td></td></tr></tfoot></table>`;
  const body = el.querySelector('tbody');
  const num = (value, max, disabled, onChange) => {
    const input = Object.assign(document.createElement('input'), { type: 'number', min: 0, max, step: 1, value, disabled });
    input.addEventListener('input', () => onChange(Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)))));
    const td = document.createElement('td');
    td.append(input);
    return td;
  };
  const check = (value, disabled, onChange) => {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: value, disabled });
    input.addEventListener('change', () => onChange(input.checked));
    const td = document.createElement('td');
    td.append(input);
    return td;
  };
  const row = (id, label, color, dead, missilesTd) => {
    if (!magazines.has(id)) magazines.set(id, id === 'player' ? gridMagazines(grid) : gridMagazines(rivals.find((r) => r.id === id).grid));
    const tr = document.createElement('tr');
    if (dead) tr.className = 'dead';
    const name = Object.assign(document.createElement('td'), { textContent: label + (dead ? ' (destroyed)' : '') });
    name.style.color = color;
    tr.append(name, missilesTd, num(magazines.get(id), 12, dead, (v) => magazines.set(id, v)));
    if (id === 'player') tr.append(document.createElement('td'), document.createElement('td'));
    else tr.append(num(decoysIn.get(id) ?? 1, 12, dead, (v) => decoysIn.set(id, v)), check(!!boostedIn.get(id), dead, (v) => boostedIn.set(id, v)));
    body.append(tr);
  };
  row('player', 'Hive City (you)', '#f0c060', false, Object.assign(document.createElement('td'), { textContent: '—' }));
  for (const r of rivals) {
    if (!incoming.has(r.id)) incoming.set(r.id, RIVAL_MISSILES);
    const dead = r.alive === false;
    row(r.id, r.def.name, r.def.color, dead, num(incoming.get(r.id), 30, dead, (v) => {
      incoming.set(r.id, v);
      el.querySelector('#incTotal').textContent = total();
    }));
  }
  el.querySelector('#incTotal').textContent = total();
}

const netBtn = document.getElementById('placeNets');
function setPlacingNets(on) {
  placingNets = on;
  netBtn.classList.toggle('on', on);
  netBtn.textContent = on ? 'Placing Intercept Networks: ON (click tiles)' : 'Place Intercept Networks';
}
netBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  setPlacingNets(!placingNets);
});

// In Hive City with placing on: a click puts a network on a tile (or empty ground next to the land); clicking a
// network takes it away again. The Capital stays.
let netDown = null;
renderer.domElement.addEventListener('pointerdown', (e) => (netDown = placingNets && view === 'home' && e.button === 0 ? { x: e.clientX, y: e.clientY } : null));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!netDown || busy || view !== 'home' || Math.hypot(e.clientX - netDown.x, e.clientY - netDown.y) > 6) return;
  netDown = null;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!intersectGround(ray.ray, hitP)) return;
  const [x, z] = worldToHex(hitP.x, hitP.z);
  const cell = grid.get(x, z);
  if (cell?.terrain === 'capital') return;
  if (cell?.terrain === 'intercept') place(x, z, 'wasteland1');
  else {
    if (!cell && !grid.touchesIsland(x, z)) return;
    place(x, z, 'intercept');
    fog.openAround(x, z, fogCfg.openRadius ?? 1, true);
  }
  boom();
  drawRings();
  paint();
});

async function runTurn() {
  const cities = [
    { id: 'player', grid, oil: Infinity, hp, alive: true, buildings: playerBuildings(), magazines: magazines.get('player') }, // the test city never runs dry
    ...rivals.filter((r) => r.alive !== false).map((r) => ({ id: r.id, grid: r.grid, oil: r.oil ?? 0, hp: r.capitalHp, alive: true, buildings: r.stats.buildings, magazines: magazines.get(r.id) })),
  ];
  const strikes = [
    ...queue.map((q) => ({ from: 'player', ...q })),
    ...rivals.filter((r) => r.alive !== false).flatMap((r) => chooseStrikes(r, cities, { round: 99, chance: INTERCEPT.chance })),
  ];
  // Testing: what comes at Hive City is set in the Incoming table (per rival), not by their AI.
  for (let i = strikes.length - 1; i >= 0; i--) if (strikes[i].to === 'player') strikes.splice(i, 1);
  const land = [...grid.cells.values()].filter((c) => c.terrain !== 'crater' && c.terrain !== 'capital');
  const pool = land.length ? land : [...grid.cells.values()];
  for (const r of rivals) {
    if (r.alive === false) continue;
    const boosted = !!boostedIn.get(r.id);
    const mine = [];
    for (let n = 0; n < (incoming.get(r.id) ?? 0); n++) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (c) mine.push({ from: r.id, to: 'player', at: [c.x, c.z], kind: 'missile', boosted });
    }
    // Decoys go first, aimed where its first missile is.
    const lead = mine[0]?.at ?? (pool[0] ? [pool[0].x, pool[0].z] : null);
    if (lead) for (let n = 0; n < (decoysIn.get(r.id) ?? 1); n++) strikes.push({ from: r.id, to: 'player', at: [...lead], kind: 'decoy', boosted });
    strikes.push(...mine);
  }
  queue = [];
  if (!strikes.length) {
    say('Nobody fired this turn.');
  } else {
    const { strikes: res, results, sims } = resolve(strikes, cities, rng);
    warSims = sims;
    // Every flight leaves at once; you stay where you are. Each lands when its countdown runs out (arrive()).
    globe.setQueued([]);
    drawAims();
    landing = [];
    played.clear();
    if (view === 'home') launchSalvo(res.filter((s) => s.from === 'player'));
    await globe.playAttack(res, rivals);
    await Promise.all(landing);
    for (const r of rivals) {
      applyToRival(r, results.get(r.id));
      noteAttacks(r, res);
      r.stats = rivalStats(r.grid, r);
    }
    const atMe = res.filter((x) => x.to === 'player' && !x.decoy);
    const decoyRecs = res.filter((x) => x.to === 'player' && x.decoy);
    if (atMe.length || decoyRecs.length)
      say(`Incoming: ${atMe.filter((x) => x.hit).length}/${atMe.length} missiles got through${decoyRecs.length ? ` · ${decoyRecs.length} decoys drew ${decoyRecs.reduce((n, x) => n + (x.drew ?? 0), 0)} kills` : ''}`);
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
  renderIncoming();
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
  syncDefence();
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
    rivalView.render(camera);
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
