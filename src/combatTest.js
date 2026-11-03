import { updateCurve } from './curvature.js'; // first: bends every material made after it (Planet map shape)
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid, hexToWorld, worldToHex, hexesAround, key } from './grid.js';
import { INTERCEPT, INTERCEPT_DEFAULTS, saveIntercept, clearIntercept } from './arsenal.js';
import { intersectGround } from './curvature.js';
import { TileFactory, TERRAINS } from './tiles.js';
import { FogOfWar, loadFogConfig } from './fogOfWar.js';
import { MissileStrike, loadMissileConfig } from './missiles.js';
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

const factory = new TileFactory();
const grid = new Grid();
const meshes = new Map();
let oil = 9;
let hp = CAPITAL_HP;
let alive = true;
let busy = false;
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
  const covered = new Map(); // cell key -> hot?
  for (const c of grid.cells.values()) {
    if (c.terrain !== 'intercept') continue;
    const hot = hotNet === key(c.x, c.z);
    const w = hexToWorld(c.x, c.z);
    // Cell centres within range lie inside radius r; the ring sits on the outer edge of the last covered cells.
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
const SLIDERS = [
  { label: 'Intercept range (cells)', min: 1, max: 8, step: 1, get: () => INTERCEPT.range, set: (v) => (INTERCEPT.range = v), save: true },
  { label: 'Hit chance per shot', min: 0, max: 1, step: 0.05, get: () => INTERCEPT.chance, set: (v) => (INTERCEPT.chance = v), save: true },
  { label: 'Oil per shot', min: 0, max: 10, step: 1, get: () => INTERCEPT.oil, set: (v) => (INTERCEPT.oil = v), save: true },
  { label: 'City oil (stockpile)', min: 0, max: 60, step: 1, get: () => oil, set: (v) => (oil = v) },
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
      show();
      drawRings();
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
  buildCity();
  paint();
});
buildTuning();

function paint() {
  const nets = [...grid.cells.values()].filter((c) => c.terrain === 'intercept').length;
  statusEl.textContent = alive
    ? `Oil ${oil} · Interceptors ${nets} · Capital ${hp}/${CAPITAL_HP}`
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


// ---------- strike camera (as the game's playMissileStrike) ----------
const camDir = new THREE.Vector3();
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** Centred on the city, zoomed out to fit every target. */
function strikeCamera(cells) {
  const reach = Math.max(0, ...cells.map(([x, z]) => {
    const w = hexToWorld(x, z);
    return Math.hypot(w.x, w.z);
  }));
  const dist = THREE.MathUtils.clamp(Math.max(missileCfg.camMinDistance, (reach + 1.5) * 2.5 * missileCfg.camFit), rig.minDistance, rig.maxDistance);
  rig.posRate = missileCfg.camRate;
  rig.zoomRate = missileCfg.camRate * 0.8;
  rig.goalDistance = dist;
  const lower = missileCfg.camLower * (renderer.domElement.clientHeight || window.innerHeight);
  rig.goal.set(0, 0, 0).add(rig.screenShift(0, lower, dist));
}

/** Frame every missile in the air and every target still to be hit (each point's ground spot along the view). */
function frameStrike(points) {
  if (!points.length) return;
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  camDir.normalize();
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    const along = p.y / Math.tan(rig.pitch);
    const gx = p.x + camDir.x * along;
    const gz = p.z + camDir.z * along;
    x0 = Math.min(x0, gx);
    x1 = Math.max(x1, gx);
    z0 = Math.min(z0, gz);
    z1 = Math.max(z1, gz);
  }
  const reach = Math.hypot(x1 - x0, z1 - z0) / 2;
  const dist = THREE.MathUtils.clamp(Math.max(missileCfg.camMinDistance, (reach + 2.5) * 2.8 * missileCfg.camFit), rig.minDistance, rig.maxDistance);
  const rate = missileCfg.camFollowRate * 0.35;
  rig.posRate = rate;
  rig.zoomRate = rate * 0.8;
  rig.goalDistance = dist;
  rig.goal.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
}

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

// Any camera input during a strike hands the camera to you for the rest of it (normal ease speeds again).
let userCam = false;
const takeCamera = () => {
  if (!busy || userCam) return;
  userCam = true;
  rig.release();
};
renderer.domElement.addEventListener('pointerdown', takeCamera);
renderer.domElement.addEventListener('wheel', takeCamera, { passive: true });
window.addEventListener('keydown', (e) => ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase()) && takeCamera());

/** Fly the resolved strikes: the game's missiles, interceptors climbing from their networks to meet them. */
async function play(resolved) {
  const recs = resolved.filter((r) => !r.fizzled);
  if (!recs.length) return;
  // The camera is never locked: it frames the strike on its own until you drag, scroll or pan, then it's yours.
  userCam = false;
  strikeCamera(recs.map((r) => r.at));
  await wait(missileCfg.camLead);
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
      if (!userCam) frameStrike([...flying.values(), ...[...pending].map((p) => new THREE.Vector3(p.x, 0, p.z))]);
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
  if (!userCam) {
    rig.goal.set(REST.x, 0, REST.z);
    rig.goalDistance = REST.distance;
  }
  await wait(0.7);
  rig.release();
}

async function nextTurn() {
  if (busy || !alive) return;
  const strikes = pickStrikes();
  if (!strikes.length) {
    say('Nothing left to fire at.');
    return;
  }
  busy = true;
  nextBtn.disabled = true;
  const cityState = { id: 'hive', grid, oil, hp, alive };
  const { strikes: resolved, results } = resolve(strikes, [cityState], rng);
  oil = Math.max(0, oil - (results.get('hive')?.oilSpent ?? 0));
  paint();
  await play(resolved);
  turn += 1;
  busy = false;
  nextBtn.disabled = !alive;
  if (!alive) nextBtn.textContent = 'City fell';
}

nextBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  nextTurn();
});

// Models: the core set first, then the extras swap in for their stand-ins.
factory.ready.then(() => {
  buildCity();
  paint();
  nextBtn.disabled = false;
});
factory.extrasReady?.then(() => {
  for (const cell of [...grid.cells.values()]) place(cell.x, cell.z, cell.terrain);
});

// ---------- frame: the game's order ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
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
