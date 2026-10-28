import './ui.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CameraRig } from './controls.js';
import { Grid, DIRS, key as plotKey } from './grid.js';
import { FogOfWar, FOG_PARAMS, FOG_DEFAULTS, loadFogConfig, saveFogConfig, clearFogConfig } from './fogOfWar.js';
import { TileFactory, TERRAINS, ACTIONS, SHOP_ITEMS, BASIC_SHOP, BANDIT_KEYS, isCamp, cardDef, cardText, hex, ICONS, isBuilding, iconize, shapeGridHTML, snapHTML, cardArtHTML } from './tiles.js';
import { hasBlockout, loadProgress } from './models.js';
import { Frontier } from './frontier.js';
import { Placement } from './placement.js';
import { Hand } from './hand.js';
import { Mysteries } from './mystery.js';
import { Expansion } from './expansion.js';
import { Dust } from './dust.js';
import { computeEconomy, foodCapOf, FIRST_QUOTA, nextQuota, SEASONS } from './economy.js';
import { Payout } from './payout.js';
import { EVENTS, KIND_LABEL, drawEvent } from './events.js';
import { Dialogue } from './dialogue.js';
import { TIERS, TIER_ORDER, REWARDS, LOW_STREAK_LIMIT, rollReward, scaledQuota } from './targets.js';
import { loadPayoutConfig } from './payoutConfig.js';
import { createDebugPanel } from './debugPanel.js';
import { SCALE, SCALE_PARAMS, SCALE_DEFAULTS, loadScaleConfig, saveScaleConfig, clearScaleConfig, eventPct, P } from './scalingConfig.js';
import { ZoomIcons, ICON_PARAMS, ICON_DEFAULTS, loadIconConfig, saveIconConfig, clearIconConfig } from './zoomIcons.js';
import { Perf } from './perfOverlay.js';
import { GFX_PARAMS, GFX_DEFAULTS, loadGfxConfig, saveGfxConfig, clearGfxConfig, applyGfx } from './graphics.js';
import { playRebelScene, playBanditScene, LEADER_COSTS } from './leaders.js';
import { MissileStrike, MISSILE_PARAMS, MISSILE_DEFAULTS, loadMissileConfig, saveMissileConfig, clearMissileConfig } from './missiles.js';

const HAND_SIZE = 5;
const SEED_TERRAIN = 'capital';

// ---------- setup ----------
const { renderer, scene, camera, sun, followTarget } = createScene(document.getElementById('app'));
const perf = new Perf(renderer); // '-' toggles the overlay
const rig = new CameraRig(camera, renderer.domElement);
const grid = new Grid();
const factory = new TileFactory();
const tiles = new THREE.Group();
scene.add(tiles);
const frontier = new Frontier(scene);
const placement = new Placement(scene, grid, factory);
const mysteries = new Mysteries(scene);
const dust = new Dust(scene);
const expansion = new Expansion(scene);
// Clouds over locked plots in expansion mode; they part when a plot is unlocked.
const fogCfg = loadFogConfig(); // saved Game Debug slider values
const fog = new FogOfWar(scene, fogCfg);
// Reduced-resolution fog (quality presets); the placed tiles still hide the fog behind them.
fog.attachRenderer(renderer, scene, [tiles]);
const missileCfg = loadMissileConfig(); // Game Debug → Missiles
const missiles = new MissileStrike(scene, camera, missileCfg);
const gfxCfg = loadGfxConfig();
const applyGraphics = () => applyGfx(gfxCfg, { renderer, scene, sun, fog });
applyGraphics();
// Debug: territory expansion mode (the old fill-the-3×3-then-expand rules), saved across reloads.
const MODE_KEY = 'oftoMode';
grid.expansionMode = localStorage.getItem(MODE_KEY) === 'expansion';
placement.mysteries = mysteries; // "?" cells can't be built on, only next to (free-placement mode)
const dialogue = new Dialogue(document.getElementById('dialogue'));
const scaleCfg = loadScaleConfig(); // Game Debug → Scaling (events and camps)
const iconCfg = loadIconConfig(); // Game Debug → Map icons
const zoomIcons = new ZoomIcons(document.getElementById('mapIcons'), camera, rig, iconCfg);
const payoutCfg = loadPayoutConfig();
const payout = new Payout(camera, document.getElementById('floaters'), payoutCfg);
const debug = createDebugPanel(document.getElementById('debug'), document.getElementById('btnDebug'), payoutCfg, {
  onPlay: () => previewPayout(),
  expansionMode: () => grid.expansionMode,
  onExpansionMode: (on) => setExpansionMode(on),
  onSkipYear: (met) => debugSkipYear(met),
  onPerf: () => perf.setOpen(!perf.enabled),
  onMissiles: () => previewMissileStrike(),
  missiles: {
    params: MISSILE_PARAMS,
    defaults: MISSILE_DEFAULTS,
    cfg: missileCfg,
    save: saveMissileConfig,
    clear: clearMissileConfig,
  },
  gfx: {
    params: GFX_PARAMS,
    defaults: GFX_DEFAULTS,
    cfg: gfxCfg,
    save: saveGfxConfig,
    clear: clearGfxConfig,
    onChange: () => {
      applyGraphics();
      perf.refreshToggles();
    },
  },
  scaling: {
    params: SCALE_PARAMS,
    defaults: SCALE_DEFAULTS,
    cfg: scaleCfg,
    save: saveScaleConfig,
    clear: clearScaleConfig,
    onChange: () => updateHUD(),
  },
  icons: {
    params: ICON_PARAMS,
    defaults: ICON_DEFAULTS,
    cfg: iconCfg,
    save: saveIconConfig,
    clear: clearIconConfig,
  },
  fog: {
    params: FOG_PARAMS,
    defaults: FOG_DEFAULTS,
    cfg: fogCfg,
    save: saveFogConfig,
    clear: clearFogConfig,
    onChange: (p) => fog.applySettings(!p || p.layout), // null = reset all
  },
});
const hand = new Hand(document.getElementById('hand'), HAND_SIZE, (piece) => placement.setPiece(piece), grid);
hand.perf = perf;

const $ = (id) => document.getElementById(id);
const anims = [];
let piecesPlaced = 0;

// Turn state: a turn is a season, a round is four seasons, tribute after Winter.
/** Food in the store at the start, so a bad first year isn't an instant loss. */
const STARTING_FOOD = 5;
const turn = { strikes: 0, round: 1, season: 0, stockpile: 0, rerolls: 0, event: null, metStreak: 0, lastMissed: false, unlocked: new Set(), pinned: [], coins: 0, total: 0, food: STARTING_FOOD, population: 0, quota: FIRST_QUOTA, ...freshTargetState() };

/**
 * Yearly target state (see targets.js).
 *   quotaBase    the un-scaled quota from nextQuota(); next year's quota grows from this
 *   target       this year's { tier, reward } (null in year 1)
 *   lowStreak    Low targets picked in a row (LOW_STREAK_LIMIT forces High)
 *   freeRerolls  hand rerolls that cost no oil (reward)
 *   cardPicks    free 1-of-3 tile picks waiting at the start of the next year (reward)
 *   forceFortune next year's event is good fortune (reward)
 */
function freshTargetState() {
  return { quotaBase: FIRST_QUOTA, target: null, lowStreak: 0, freeRerolls: 0, cardPicks: 0, forceFortune: false };
}

/** This season's economy with the carried-over food store and population. */
const economyNow = () => computeEconomy(grid, { mods: turn.event?.mods, population: turn.population, foodStore: turn.food });
/** A year event's strength this year, its chosen option and the economy mods it gives. */
const resolveMods = (m, p) => (typeof m === 'function' ? m(p) : m ?? {});
function eventSetup(key, choiceIdx = -1, year = turn.round) {
  const ev = EVENTS[key];
  const p = ev.scale ? eventPct(ev.scale, year) : 0;
  const choice = choiceIdx >= 0 ? ev.choices?.[choiceIdx] ?? null : null;
  const mods = { ...resolveMods(ev.mods, p), ...resolveMods(choice?.mods, p) };
  return { ev, p, choice, mods };
}
/** This season's economy if `mods` were the active event (for the "now" numbers in event text). */
const previewEconomy = (mods) => computeEconomy(grid, { mods, population: turn.population, foodStore: turn.food });
/** Effect text for an event (and choice), with this year's percentage and the amount it means right now. */
function eventText(key, choiceIdx = -1, year = turn.round) {
  const { ev, p, choice, mods } = eventSetup(key, choiceIdx, year);
  const e = previewEconomy(mods);
  return choice ? `${choice.label}: ${choice.text(p, e)}` : ev.text(p, e);
}

/** What a camp kind does: its percentage, plus what all camps of that kind take right now. */
function campEffect(kind) {
  const e = economyNow();
  const d = TERRAINS[kind].stats.drain;
  const all = (e.camps[d] ?? 0) > 1 ? ' (all camps)' : '';
  if (d === 'slots') return `-${P(SCALE.campSlots)} worker slots, -${e.raiderManpower} now${all}`;
  if (d === 'oil') return `-${P(SCALE.campOil)} of oil made, -${e.oilStolen} now${all}`;
  if (d === 'food') return `-${P(SCALE.campFood)} of food grown, -${e.banditFood} now${all}`;
  return `steals ${P(e.stockpileTheft)} of the stockpile each season${all}`;
}

/** Keeps the food store within what the Capitals can hold (after rewards, Spark, lost Capitals…). */
const clampFood = () => (turn.food = Math.max(0, Math.min(turn.food, foodCapOf(grid))));

// Tiles that can't be drawn yet: no Cliffs during the first round.
/** Guaranteed opening hand (shuffled). Extra slots, if HAND_SIZE grows, are drawn at random. */
const OPENING_HAND = ['farm', 'settlement', 'station', 'wasteland', 'wasteland'];

// The opening hand (first season, rerolls included) only has the basics: Wasteland, stations, farms, settlements.
const OPENING_TILES = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4', 'station', 'farm', 'settlement'];
hand.excluded = () => {
  if (turn.round === 1 && turn.season === 0)
    return [...Object.keys(TERRAINS), ...Object.keys(ACTIONS)].filter((k) => !OPENING_TILES.includes(k));
  const locked = SHOP_ITEMS.map(([k]) => k).filter((k) => !BASIC_SHOP.has(k) && !turn.unlocked.has(k));
  return [...locked, ...(turn.round === 1 ? ['cliffs'] : [])];
};

// ---------- tiles ----------
const WASTELAND_VARIANTS = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4'];

/**
 * Places a tile, replacing whatever was there (building over Wasteland / Ruins).
 * It stomps down after `delay` seconds; `instant` puts it straight in place instead (the starting Capital).
 * bare: the cell gets an empty holder because a whole-piece Wasteland model covers it (see addWastePiece).
 */
function addTile(x, z, terrain, delay = 0, instant = false, { bare = false } = {}) {
  // Mix wasteland shades per cell so a wasteland piece doesn't look like one flat slab.
  if (WASTELAND_VARIANTS.includes(terrain)) {
    terrain = WASTELAND_VARIANTS[Math.floor(Math.random() * WASTELAND_VARIANTS.length)];
  }
  const old = grid.get(x, z);
  const onRuins = old?.terrain === 'ruins' || (old?.onRuins ?? false);
  if (old) removeMesh(old.mesh);

  const mesh = factory.create(terrain, { bare });
  mesh.position.set(x, 0, z);
  mesh.visible = instant;
  tiles.add(mesh);
  grid.set(x, z, { terrain, mesh, onRuins });
  if (!instant) anims.push({ mesh, t: -delay, landed: false });
}

/** Swap any flat stand-in that now has a loaded blockout, including one still falling. */
function adoptBlockouts() {
  for (const cell of grid.cells.values()) {
    if (!hasBlockout(cell.terrain)) continue;
    const previous = cell.mesh;
    const next = factory.upgrade(previous, cell.terrain);
    if (next === previous) continue;
    const anim = anims.find((a) => a.mesh === previous);
    if (anim) anim.mesh = next;
    cell.mesh = next;
  }
  if (hand.piece) placement.setPiece(hand.piece);
}

factory.ready.then(adoptBlockouts);

function removeMesh(mesh) {
  tiles.remove(mesh);
  const i = anims.findIndex((a) => a.mesh === mesh);
  if (i >= 0) anims.splice(i, 1);
  const piece = mesh.userData.piece;
  if (piece && !piece.broken) breakWastePiece(piece, mesh);
}

// ---------- Wasteland pieces ----------
/**
 * A Wasteland piece lands as one model spanning all its cells (one model per piece shape, turned with the piece).
 * Every cell still gets its own (empty) holder, so the board rules work per cell as before. Each holder points
 * at the piece record: { shape, rot, cells: keys, lead: key of the first cell in reading order, group, broken }.
 * Before the piece models have loaded, the cells get coloured blocks and adoptWastePieces upgrades them later.
 */
function addWastePiece(piece, cells) {
  const [lx, lz] = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const rec = { shape: piece.shape, rot: piece.rot, cells: cells.map(([x, z]) => plotKey(x, z)), lead: plotKey(lx, lz), group: null, broken: false };
  const group = factory.createPiece(piece.shape, piece.rot);
  cells.forEach(([x, z], i) => {
    addTile(x, z, piece.terrain, i * 0.05, Boolean(group), { bare: Boolean(group) });
    grid.get(x, z).mesh.userData.piece = rec;
  });
  if (group) placeWasteGroup(rec, group, true);
}

/** Put a piece's model over its cells; `drop` makes it stomp in like a placed tile, with dust under every cell. */
function placeWasteGroup(rec, group, drop) {
  const pts = rec.cells.map((k) => k.split(',').map(Number));
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  group.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  rec.group = group;
  tiles.add(group);
  if (drop) {
    group.visible = false;
    anims.push({ mesh: group, t: 0, landed: false, cells: pts });
  }
}

/** A cell of the piece was removed or replaced: the whole-piece model goes, the cells left become single Wasteland. */
function breakWastePiece(rec, removed) {
  rec.broken = true;
  if (rec.group) {
    tiles.remove(rec.group);
    const i = anims.findIndex((a) => a.mesh === rec.group);
    if (i >= 0) anims.splice(i, 1);
  }
  for (const k of rec.cells) {
    const c = grid.cells.get(k);
    if (!c || c.mesh === removed || c.mesh.userData.piece !== rec) continue;
    if (rec.group) factory.fillWaste(c.mesh, c.terrain); // (without a model the cells already show blocks)
    c.mesh.visible = true;
  }
}

/** The mesh that hops for a cell in the payout: a whole Wasteland piece hops once, on its first cell. */
function payoutMesh(c) {
  const rec = c.mesh.userData.piece;
  if (rec?.group && !rec.broken && rec.lead === plotKey(c.x, c.z)) return rec.group;
  return c.mesh;
}

/** Once the piece models arrive: Wasteland placed as blocks before then becomes the real models. */
function adoptWastePieces() {
  const done = new Set();
  for (const cell of grid.cells.values()) {
    if (!cell.terrain.startsWith('wasteland')) continue;
    const rec = cell.mesh.userData.piece;
    if (rec && !rec.broken) {
      if (rec.group || done.has(rec)) continue;
      done.add(rec);
      const group = factory.createPiece(rec.shape, rec.rot);
      if (!group) continue;
      for (const k of rec.cells) grid.cells.get(k)?.mesh.clear();
      placeWasteGroup(rec, group, false);
    } else if (!cell.mesh.userData.blockout) factory.fillWaste(cell.mesh, cell.terrain);
  }
  if (hand.piece) placement.setPiece(hand.piece);
}

/** Debug stand-in for the overlord's nuke: turn a random non-capital tile into a Toxic Crater. */
function nukeRandomTile(quiet = false) {
  const targets = [...grid.cells.values()].filter(
    (c) => c.terrain !== 'capital' && c.terrain !== 'crater' && grid.allowed(c.x, c.z),
  );
  if (!targets.length) {
    if (!quiet) toast('Nothing for the Overlord to nuke');
    return null;
  }
  const { x, z } = targets[Math.floor(Math.random() * targets.length)];
  const lost = TERRAINS[grid.get(x, z).terrain].name;
  addTile(x, z, 'crater');
  grid.get(x, z).onRuins = false; // the ruins are gone too
  if (!quiet) toast('The Overlord is displeased: a Toxic Crater forms', 'bad');
  placement.cell = null; // force ghost revalidation
  updateHUD();
  return lost;
}

// ---------- the Overlord's missile strike ----------
/** Bumped by resetIsland, so a strike or failure speech still running stops where it is. */
let runId = 0;
/** True while the strike cinematic plays (camera locked, game keys ignored). */
let striking = false;
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** Missiles for the nth missed tribute (Game Debug → Missiles: 1, 3, 5). */
const strikeCount = (strikes) => Math.max(1, Math.round(missileCfg[`count${Math.min(Math.max(strikes, 1), 3)}`]));

/** The Hive City the strike centres on: the Capital nearest the middle (a mystery can add more). */
function mainCapital() {
  const caps = [...grid.cells.values()].filter((c) => c.terrain === 'capital');
  return caps.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] ?? null;
}

/** Random building cells (never Wasteland or other land). With `capital`, the main Capital is one of them, hit last. */
function pickStrikeTargets(count, capital = false) {
  const cap = capital ? mainCapital() : null;
  const pool = [...grid.cells.values()].filter((c) => isBuilding(c.terrain) && c !== cap && (capital || c.terrain !== 'capital'));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, cap ? count - 1 : count);
  if (cap) picked.push(cap);
  return picked.map(({ x, z }) => ({ x, z }));
}

/** A missile lands: the tile becomes a Toxic Crater (ruins under it are gone too). Returns the tile's name. */
function craterAt(x, z) {
  const cell = grid.get(x, z);
  if (!cell || cell.terrain === 'crater') return null;
  const name = TERRAINS[cell.terrain].name;
  addTile(x, z, 'crater', 0, true);
  grid.get(x, z).onRuins = false;
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  updateHUD();
  return name;
}

/** "Refinery and two Hydro-farms". */
function listLost(names) {
  const WORDS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts].map(([n, k]) => (k === 1 ? n : `${WORDS[k] ?? k} ${n.endsWith('y') ? `${n.slice(0, -1)}ies` : `${n}s`}`));
  return parts.length < 2 ? parts[0] ?? '' : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** Camera for the strike: centred on the Capital, zoomed out to fit every target, easing slowly. */
function strikeCamera(targets) {
  const cap = mainCapital() ?? { x: 0, z: 0 };
  const reach = Math.max(0, ...targets.map((t) => Math.hypot(t.x - cap.x, t.z - cap.z)));
  const fit = (reach + 1.5) * 2.5 * missileCfg.camFit;
  const dist = THREE.MathUtils.clamp(Math.max(missileCfg.camMinDistance, fit), rig.minDistance, rig.maxDistance);
  rig.posRate = missileCfg.camRate;
  rig.zoomRate = missileCfg.camRate * 0.8;
  rig.goalDistance = dist;
  // The view is normally offset for the side panel and hand (scene.js); they slide away during the
  // strike, so shift the look-at point to put the Capital in the true middle of the screen, a little
  // low (camLower) to leave room for the clouds.
  const view = camera.view?.enabled ? camera.view : { offsetX: 0, offsetY: 0 };
  const lower = missileCfg.camLower * (renderer.domElement.clientHeight || window.innerHeight);
  rig.goal.set(cap.x, 0, cap.z).add(rig.screenShift(view.offsetX, view.offsetY + lower, dist));
}

/**
 * The strike cinematic: the UI slides away, the camera eases over to the Capital, then the missiles
 * streak in from the Overlord's side of the world. Each tile turns into a Toxic Crater under its
 * mushroom cloud (unless `convert` is off: a dry-run preview). The caller owns `eventOpen` afterwards.
 * Returns the names of the tiles destroyed.
 */
async function playMissileStrike(targets, { convert = true, restoreCamera = true } = {}) {
  const run = runId;
  const lost = [];
  if (!targets.length) return lost;
  striking = true;
  eventOpen = true;
  hand.select(-1);
  if (previewing) cancelPreview();
  document.body.classList.add('striking');
  const saved = { goal: rig.goal.clone(), distance: rig.goalDistance };
  rig.locked = true;
  strikeCamera(targets);
  await wait(missileCfg.camLead);
  if (run !== runId) return lost;
  await missiles.fire(targets, {
    onImpact: ({ x, z }) => {
      if (run !== runId) return;
      dust.burst(x, z, 1.8);
      fog.disturb(x, z);
      shake.amount = Math.min(shake.amount + missileCfg.shake, 1.2);
    },
    onCover: ({ x, z }) => {
      if (!convert || run !== runId) return;
      const name = craterAt(x, z);
      if (name) lost.push(name);
    },
  });
  if (run !== runId) return lost;
  await wait(missileCfg.holdAfter);
  if (run !== runId) return lost;
  document.body.classList.remove('striking');
  if (restoreCamera) {
    rig.goal.copy(saved.goal);
    rig.goalDistance = saved.distance;
    await wait(0.7);
    if (run !== runId) return lost;
  }
  rig.release();
  striking = false;
  return lost;
}

/** Report line once the missiles have landed. */
function reportStrike(lost) {
  if (!lost.length) return;
  $('report').innerHTML += `<br /><span class="bad">Missile strike: your ${listLost(lost)} ${lost.length === 1 ? 'is now a Toxic Crater' : 'are now Toxic Craters'}.</span>`;
}

/** Debug (M): play a strike right now (Game Debug → Missiles · preview). */
function previewMissileStrike() {
  if (turn.over) return 'Game over: restart first';
  if (striking || shopOpen || eventOpen || payout.active) return 'Finish the current screen first';
  const n = Math.max(1, Math.round(missileCfg.previewCount));
  const targets = pickStrikeTargets(n, missileCfg.previewCapital === 'yes');
  // Not enough buildings yet: the rest land on empty sand near the Capital.
  const cap = mainCapital() ?? { x: 0, z: 0 };
  const used = new Set(targets.map((t) => plotKey(t.x, t.z)));
  for (let tries = 0; targets.length < n && tries < 200; tries++) {
    const x = cap.x + Math.round((Math.random() * 2 - 1) * 4);
    const z = cap.z + Math.round((Math.random() * 2 - 1) * 4);
    if (grid.get(x, z) || used.has(plotKey(x, z))) continue;
    used.add(plotKey(x, z));
    targets.push({ x, z });
  }
  const run = runId;
  playMissileStrike(targets, { convert: missileCfg.previewCraters === 'yes' }).then((lost) => {
    if (run !== runId) return;
    eventOpen = false;
    updateHUD();
    if (lost.length) toast(`The Overlord's missiles destroyed your ${listLost(lost)}`, 'bad', 2600);
  });
  return `Missile strike: ${targets.length} missile${targets.length === 1 ? '' : 's'}`;
}

// ---------- Pre-war Ruins ----------
/** Ruins can be cleared once a building stands on a side next to them (and, in expansion mode, they're in your territory). */
function canClearRuins(c) {
  return (
    c.terrain === 'ruins' &&
    grid.allowed(c.x, c.z) &&
    DIRS.some(([dx, dz]) => isBuilding(grid.get(c.x + dx, c.z + dz)?.terrain))
  );
}

/** Clearing ruins empties the cell and tops the hand up to HAND_SIZE with pure-luck draws. */
function clearRuins(x, z) {
  const c = grid.get(x, z);
  if (!c || !canClearRuins(c) || turn.over || payout.active || shopOpen || eventOpen) return;
  removeMesh(c.mesh);
  grid.cells.delete(`${x},${z}`);
  const drawn = hand.refill(HAND_SIZE);
  placement.cell = null;
  frontier.rebuild(grid);
  updateHUD();
  toast(drawn ? `Ruins cleared: salvaged ${drawn} new piece${drawn === 1 ? '' : 's'}` : 'Ruins cleared (hand already full)', 'good');
}

const ruinBtns = new Map(); // cell key -> button
const ruinV = new THREE.Vector3();
function updateRuinButtons() {
  const layer = $('ruinBtns');
  const live = new Set();
  for (const c of grid.cells.values()) {
    if (!canClearRuins(c)) continue;
    const k = `${c.x},${c.z}`;
    live.add(k);
    let btn = ruinBtns.get(k);
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'ruin-btn';
      btn.textContent = 'Clear ruins';
      btn.title = 'Clear these ruins: refill your hand to 5 with random pieces';
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearRuins(c.x, c.z);
      });
      layer.appendChild(btn);
      ruinBtns.set(k, btn);
    }
    ruinV.set(c.x, 0.55, c.z).project(camera);
    const px = (ruinV.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-ruinV.y * 0.5 + 0.5) * window.innerHeight;
    const tf = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
    if (btn._tf !== tf) btn.style.transform = btn._tf = tf; // skip style writes while the camera is still
  }
  for (const [k, btn] of ruinBtns) {
    if (live.has(k)) continue;
    btn.remove();
    ruinBtns.delete(k);
  }
}

/**
 * Tile drop: a heavy block falling. It speeds up all the way down (no easing
 * out), slams in, squashes hard, and settles with a quick damped wobble while
 * dust rolls out from under it and the camera jolts.
 */
const DROP = {
  height: 2.2, // start height above the board
  fall: 0.24, // seconds in the air
  stretch: 0.07, // tall and thin by the time it hits
  squash: 0.24, // how flat it goes on impact
  wobbleRate: 24, // squash oscillation (rad/s)
  wobbleDamp: 10, // how fast the wobble dies
  rebound: 0.035, // tiny bounce height: heavy things barely leave the ground again
  settle: 0.42, // seconds after impact until the tile is at rest
};

function updateDropAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.t < 0) continue;
    a.mesh.visible = true;
    if (a.t < DROP.fall) {
      // Free fall: y follows gravity (quadratic), so it is fastest at the moment of impact.
      const p = a.t / DROP.fall;
      a.mesh.position.y = DROP.height * (1 - p * p);
      const s = DROP.stretch * p;
      a.mesh.scale.set(1 - s * 0.4, 1 + s, 1 - s * 0.4);
      continue;
    }
    const u = a.t - DROP.fall; // time since impact
    if (!a.landed) {
      a.landed = true;
      const { x, z } = a.mesh.position;
      // A whole Wasteland piece kicks up dust under each of its cells.
      if (a.cells) for (const [cx, cz] of a.cells) dust.burst(cx, cz, 0.8);
      else dust.burst(x, z);
      // Free placement: the land around the new tile is uncovered (expansion mode uncovers whole plots).
      if (!grid.expansionMode) fog.openAround(Math.round(x), Math.round(z), fogCfg.openRadius);
      fog.disturb(Math.round(x), Math.round(z)); // the impact blows back and thins the clouds nearby
      shake.amount = Math.min(shake.amount + 0.7, 1.2);
    }
    // Damped spring around rest: flat on impact, a little tall on the way back, then still.
    const k = DROP.squash * Math.exp(-DROP.wobbleDamp * u) * Math.cos(DROP.wobbleRate * u);
    a.mesh.scale.set(1 + k * 0.45, 1 - k, 1 + k * 0.45);
    const bounce = u < 0.16 ? Math.sin((u / 0.16) * Math.PI) * DROP.rebound : 0;
    a.mesh.position.y = Math.max(0, bounce);
    if (u >= DROP.settle) {
      a.mesh.position.y = 0;
      a.mesh.scale.set(1, 1, 1);
      anims.splice(i, 1);
    }
  }
}

/** Camera jolt on impact. Added after the rig places the camera, so it never builds up. */
const shake = { amount: 0 };
function applyShake(dt) {
  if (shake.amount < 0.001) return;
  // Scales with zoom so it looks the same size on screen at any distance.
  const amp = 0.0045 * rig.distance * shake.amount;
  camera.position.x += (Math.random() * 2 - 1) * amp * 0.5;
  camera.position.y += (Math.random() * 2 - 1) * amp;
  camera.position.z += (Math.random() * 2 - 1) * amp * 0.5;
  shake.amount *= Math.exp(-16 * dt);
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg, kind = '', ms = 1600) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), ms);
}

function pop(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // restart animation
  el.classList.add('pop');
}

/** Big number = current amount, small (±n) = change this season. */
function setRes(id, amount, change) {
  $(id).textContent = Math.round(amount);
  $(id).classList.toggle('neg', Math.round(amount) < 0);
  const d = $(`${id}D`);
  const n = Math.round(change);
  // Only show the bracket when something is used up: if nothing is consumed it just repeats the big number.
  d.textContent = n === Math.round(amount) ? '' : `(${n > 0 ? `+${n}` : n})`;
  d.className = n > 0 ? 'up' : n < 0 ? 'down' : '';
}

function updateHUD() {
  const n = grid.size;
  const quota = turn.quota;
  const left = yearLength() - 1 - turn.season;
  $('seasonLabel').textContent =
    `Round ${turn.round} · ${SEASONS[turn.season]} · tribute ${left ? `in ${left} season${left === 1 ? '' : 's'}` : `due this ${SEASONS[turn.season]}`}`;
  const ev = turn.event;
  $('eventLabel').classList.toggle('hidden', !ev);
  if (ev) {
    // Hover card: what the event does and how long it lasts.
    $('eventLabel').innerHTML =
      `Year event: <b>${ev.name}</b>` +
      `<div class="event-tip">` +
      `<div class="event-tip-kind">${KIND_LABEL[ev.kind]}</div>` +
      `<div class="event-tip-name">${ev.name}</div>` +
      `<div class="event-tip-text">${iconize(ev.summary)}</div>` +
      `<div class="event-tip-foot">Lasts until this year's tribute (after ${SEASONS[yearLength() - 1]}).</div>` +
      `</div>`;
    $('eventLabel').className = `event-label ${ev.kind}`;
    $('eventLabel').removeAttribute('title');
  }
  const tg = turn.target;
  $('targetLabel').classList.toggle('hidden', !tg);
  if (tg) {
    const t = TIERS[tg.tier];
    const r = tg.reward ? REWARDS[tg.reward] : null;
    $('targetLabel').innerHTML =
      `Target: <b>${t.label}</b>` +
      `<div class="event-tip">` +
      `<div class="event-tip-kind">Tribute target</div>` +
      `<div class="event-tip-name">${t.label} · ${Math.round(t.mult * 100)}% of ${turn.quotaBase}</div>` +
      `<div class="event-tip-text">Tribute this year: ${turn.quota} oil.<br />${r ? `Reward if met: ${iconize(r.text)}` : 'No reward.'}</div>` +
      `<div class="event-tip-foot">${turn.lowStreak >= LOW_STREAK_LIMIT ? 'Next year the Overlord forces a High target.' : turn.lowStreak ? `Low targets in a row: ${turn.lowStreak} of ${LOW_STREAK_LIMIT}.` : 'Rewards are lost if the tribute is missed.'}</div>` +
      `</div>`;
    $('targetLabel').className = `event-label target-${tg.tier}`;
  }
  showOil(turn.stockpile);
  showStrikes();

  // Projected economy for this season if the turn ended now.
  const e = economyNow();
  // Food / Manpower: big number = how much you produce, small (±n) = excess or shortfall after upkeep.
  // Food shows the balance (grown minus eaten), which is what actually goes into the store.
  setRes('resFood', e.foodBalance, e.foodBalance);
  // Manpower is a cap: big number = free slots / total slots, small = idle buildings (if any).
  $('resMp').textContent = `${e.free}/${e.cap}`;
  $('resMp').classList.toggle('neg', e.idle > 0);
  $('resMpD').textContent = e.idle ? `(${e.idle} idle)` : '';
  $('resMpD').className = e.idle ? 'down' : '';
  // Oil: big number = the stockpile (the Overlord takes it all after Winter), small = this season's yield.
  $('resOilD').textContent = `(+${e.oil})`;
  $('resOilD').className = e.oil > 0 ? 'up' : '';

  // Food stores: excess food banked for lean seasons (capacity from the Capitals).
  showStore(turn.food, e.foodCap);

  $('btnReroll').classList.toggle('hidden', hand.isEmpty);
  $('btnReroll').classList.toggle('disabled', !turn.freeRerolls && turn.stockpile < rerollCost());
  $('btnRerollSub').innerHTML = turn.freeRerolls ? `free ×${turn.freeRerolls}` : `-${rerollCost()}${ICONS.oil}`;
  $('btnNextSub').textContent =
    turn.season === yearLength() - 1 ? `collect oil, pay ${quota} tribute` : 'collect oil, draw a new hand';
  if (tipKind) renderResTip(e);
}

/** Each reroll costs 1 more barrel of oil than the last (1, 2, 3, …) for the whole run; only a new game resets it. */
const rerollCost = () => turn.rerolls + 1;

// ---------- resource breakdown tooltips ----------
let tipKind = null; // 'food' | 'mp' | 'oil' while a resource row is hovered

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (f) => `${Math.round(f * 100)}%`;
const times = (f) => `×${+f.toFixed(2)}`;

/**
 * Line items for one resource. Each row: [label, value, type]
 * type: 'add' (signed amount), 'mul' (multiplier), 'total' (subtotal line), 'note' (plain text)
 */
function breakdown(kind, e) {
  const c = (t) => e.counts[t] ?? 0;
  const rows = [];
  const add = (label, v) => v && rows.push([label, signed(v), v < 0 ? 'add bad' : 'add']);
  const mul = (label, f) => f !== 1 && rows.push([label, times(f), f < 1 ? 'mul bad' : 'mul']);
  const total = (label, v) => rows.push([label, v, 'total']);
  const note = (text) => rows.push([text, '', 'note']);

  if (kind === 'food') {
    add(`Hydro-farms ×${c('farm')}`, 2 * c('farm'));
    add(`Pump bonus ×${e.bonus.pumpFarms}`, 2 * e.bonus.pumpFarms);
    add(`Oasis bonus ×${e.bonus.oasisFarms}`, 3 * e.bonus.oasisFarms);
    add('Capital doubles', e.bonus.capitalFood);
    if (turn.event) add(turn.event.name, e.eventFood);
    total('Grown', Math.round(e.foodGrown));
    add('Capital eats', -3 * c('capital'));
    add(`Settlements ×${c('settlement')}`, -2 * c('settlement'));
    add(`Population ×${e.population}`, -e.popFood);
    if (turn.event) add(turn.event.name, -e.eventUpkeep - e.mods.foodUpkeep);
    add('Toxic craters', -e.craterFood);
    add(`Scavenger camps ×${c('bandit_scav')}`, -e.banditFood);
    total('Balance', signed(Math.round(e.foodBalance)));
    if (e.foodBalance < 0) {
      note(
        e.fed < 1
          ? `Store can't cover it: people go hungry, stations run at ${pct(e.fed)}`
          : `Shortfall covered from the store (${e.foodStore})`,
      );
    }
    note(`Stores ${e.foodStore} → ${e.storeAfter} / ${e.foodCap}`);
    if (e.foodWasted) note(`${e.foodWasted} food wasted (stores full)`);
    if (rebelsRise(e)) note('Stores empty: rebels will rise');
  } else if (kind === 'mp') {
    add('Capital', 4 * c('capital'));
    add(`Settlements ×${c('settlement')}`, 2 * c('settlement'));
    add('Built on ruins', e.bonus.ruins);
    add('Labour camps', e.bonus.labourCamps);
    add(`Population`, e.population);
    add('Toxic craters', -e.craterManpower);
    add(`Raider camps ×${c('raider') + c('bandit_raider')}`, -e.raiderManpower);
    if (turn.event) add(turn.event.name, e.eventCap + e.mods.capDelta);
    total('Worker slots', e.cap);
    add(`Hydro-farms ×${c('farm')}`, -c('farm'));
    add(`Stations ×${c('station')}`, -c('station'));
    add(`Refineries ×${c('refinery')}`, -c('refinery'));
    total(e.idle ? 'Idle' : 'Free', e.idle ? e.idle : e.free);
    note(
      e.idle
        ? `Not enough workers: your ${e.idle} newest building${e.idle === 1 ? '' : 's'} sit idle and produce nothing`
        : 'Each farm, station and refinery needs 1 worker. Housing raises the cap.',
    );
  } else {
    add(`Stations ×${c('station')}`, 2 * c('station'));
    add(`Tar pit bonus ×${e.bonus.tarpitStations}`, 2 * e.bonus.tarpitStations);
    add('Capital doubles', e.bonus.capitalCrude);
    if (turn.event) add(turn.event.name, e.eventCrude);
    total('Crude', e.crude);
    mul(`Refineries (${e.refineryLinks} station link${e.refineryLinks === 1 ? '' : 's'})`, e.refineryMult);
    mul('Hunger', e.fed);
    add(`Siphoner camps ×${c('bandit_siphon')}`, -e.oilStolen);
    total('This season', signed(e.oil));
    const theft = Math.floor((turn.stockpile + e.oil) * Math.min(1, e.stockpileTheft));
    add(`Smuggler dens ×${c('bandit_smuggle')}`, -theft);
    note(`Stockpile ${turn.stockpile} → ${turn.stockpile + e.oil - theft} / ${turn.quota} tribute`);
    note(`The Overlord takes all of it after ${SEASONS[yearLength() - 1]}.`);
  }
  return rows;
}

const TIP_TITLE = 'How this season adds up';

function renderResTip(e = economyNow()) {
  const rows = breakdown(tipKind, e);
  $('resTip').innerHTML =
    `<div class="title">${TIP_TITLE}</div>` +
    (rows.length ? '' : '<div class="row note">Nothing yet</div>') +
    rows
      .map(([label, value, type]) => `<div class="row ${type}"><span>${label}</span><b>${value}</b></div>`)
      .join('');
}

for (const row of document.querySelectorAll('#panel .res[data-tip]')) {
  row.addEventListener('mouseenter', () => {
    tipKind = row.dataset.tip;
    renderResTip();
    const tip = $('resTip');
    tip.style.setProperty('--c', getComputedStyle(row).getPropertyValue('--c'));
    tip.classList.remove('hidden');
    // Beside the row, kept on screen.
    const r = row.getBoundingClientRect();
    const top = Math.min(r.top, window.innerHeight - tip.offsetHeight - 8);
    tip.style.top = `${Math.max(8, top)}px`;
  });
  row.addEventListener('mouseleave', () => {
    tipKind = null;
    $('resTip').classList.add('hidden');
  });
}

// ---------- hovered tile info ----------
let inspected = null; // cell object currently shown
function updateInspect(cell) {
  const c = cell ? grid.get(cell[0], cell[1]) : null;
  if (c === inspected && c?.terrain === inspected?.terrain) return;
  inspected = c;
  const el = $('inspect');
  if (!c) {
    el.classList.add('hidden');
    return;
  }
  const t = TERRAINS[c.terrain];
  el.style.setProperty('--top', hex(t.top));
  el.style.setProperty('--edge', hex(t.edge));
  const notes = [];
  if (c.onRuins && t.category === 'building')
    notes.push(`Built on Pre-war Ruins: +${c.terrain === 'settlement' ? 2 : 1} worker slot${c.terrain === 'settlement' ? 's' : ''}`);
  if (economyNow().perCell.find((p) => p.x === c.x && p.z === c.z)?.idle)
    notes.push('Idle: no free workers. Build housing to staff it.');
  if (c.terrain === 'raider') notes.push('Unhappy citizens. Fix the food shortage to drive them off (one camp leaves per fed season), or Send in the Militia.');
  if (t.bandit) notes.push('Bandits drawn by a 3×3 block of Wasteland. They stay until you Send in the Militia.');
  if (isCamp(c.terrain)) notes.push(`Right now: ${campEffect(c.terrain)}`);
  if (t.buildable) notes.push('A building can be placed on top of this tile');
  el.innerHTML = `
    <div class="card-big">
      <div class="art">${cardArtHTML(c.terrain)}</div>
      ${snapHTML(t)}
      <div class="name">${t.name}</div>
      <div class="rule">${cardText(t)}</div>
      <div class="kind">${t.category}</div>
    </div>
    ${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
  el.classList.remove('hidden');
}

// ---------- turns ----------
/** Next turn: tiles hop and flash what they produce, then the turn is settled. */
function endTurn() {
  if (turn.over || shopOpen || eventOpen) return;
  if (payout.active) {
    if (previewing) cancelPreview();
    else {
      payout.skip(); // pressing again fast-forwards
      return;
    }
  }
  // Wasteland must be placed first, but only if it fits somewhere; if there's no room, the turn can end.
  const blocking = hand.placeableForced.length;
  if (blocking) {
    toast(`Place your Wasteland first (${blocking} left in hand)`, 'bad');
    return;
  }
  hand.select(-1);
  const e = economyNow();
  runPayout(e, () => settleTurn(e));
}

/** Debug (Space): play the payout sequence without ending the turn or changing anything. */
let previewing = false;
function previewPayout() {
  if (payout.active) {
    if (!previewing) {
      payout.skip(); // a real turn is playing: just finish it
      return;
    }
    cancelPreview(); // restart the preview
  }
  previewing = true;
  runPayout(economyNow(), cancelPreview);
}

function cancelPreview() {
  payout.cancel();
  previewing = false;
  document.body.classList.remove('paying');
  updateHUD(); // undo the counter / bar filling
}

/** Draw the food store bar (clamped to the capacity; glows when full, red when empty). */
function showStore(amount, cap, bumpIt = false) {
  const shown = Math.max(0, Math.min(cap, Math.round(amount)));
  $('popFill').style.width = `${cap ? Math.min(1, shown / cap) * 100 : 0}%`;
  $('popFill').classList.toggle('full', cap > 0 && shown >= cap);
  $('popFill').classList.toggle('empty', amount <= 0);
  $('popText').textContent =
    `Food stores ${shown} / ${cap}` + (turn.population ? ` · population ${turn.population}` : '');
  if (bumpIt) bump($('popText'));
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/** Show an oil amount in the stockpile counter and the quota bar at the top. */
function showOil(amount, bump = false) {
  const quota = turn.quota;
  $('oilStock').textContent = amount;
  $('resOil').textContent = amount;
  $('quotaCount').textContent = `${amount} / ${quota} barrels`;
  $('quotaFill').style.width = `${Math.min(1, amount / quota) * 100}%`;
  $('quotaFill').classList.toggle('met', amount >= quota);
  if (bump) {
    pop($('oilStock'));
    pop($('quotaCount'));
  }
}

function runPayout(e, onDone) {
  const tiles = e.perCell
    .filter((p) => p.food || p.idle || p.oil || EFFECT_TILES.has(p.terrain))
    .map((p) => ({ ...p, mesh: payoutMesh(grid.get(p.x, p.z)) }))
    .flatMap(splitTriggers);

  // Oil fills the quota bar; food fills the store bar (up to its capacity).
  let shown = turn.stockpile;
  let store = turn.food;
  document.body.classList.add('paying');
  payout.start(
    tiles,
    (tile) => {
      if (tile.oil) {
        shown += tile.oil;
        showOil(shown, true);
      }
      if (tile.food) {
        store = Math.max(0, Math.min(e.foodCap, store + tile.food));
        showStore(store, e.foodCap, true);
      }
    },
    () => {
      document.body.classList.remove('paying');
      onDone();
    },
  );
}

/**
 * A tile triggered twice (next to a Capital) hops twice, each time showing one trigger's output,
 * instead of once with the combined total. Upkeep is shown on the first trigger only.
 */
function splitTriggers(p) {
  if (p.triggers !== 2) return [p];
  const half = (v) => Math.ceil(v / 2);
  const first = { ...p, oil: half(p.oil), food: half(p.food) };
  const second = { ...p, oil: p.oil - first.oil, food: p.food - first.food };
  return [first, second];
}

/** Tiles that hop even without a number of their own (they boost their neighbours). */
const EFFECT_TILES = new Set(['pump', 'oasis', 'tarpit', 'refinery', 'raider', ...BANDIT_KEYS]);

/** Rebels rise when a season ends with no food left: nothing gained (net ≤ 0) and the stores empty. */
const rebelsRise = (e) => Math.round(e.foodBalance) <= 0 && e.storeAfter <= 0;

/**
 * A season that ends with no food (net ≤ 0, stores empty) draws raiders. They camp on an empty cell next to your land first, then on a Wasteland,
 * and only raze a building (never the Capital) when there is nowhere else. Returns a report line or null.
 */
function spawnRaider() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const empty = [...grid.openKeys()].filter((k) => !mysteries.has(...k.split(',').map(Number))).map((k) => k.split(',').map(Number));
  const cells = [...grid.cells.values()];
  const waste = cells.filter((c) => c.terrain.startsWith('wasteland'));
  const buildings = cells.filter((c) => TERRAINS[c.terrain].category === 'building' && c.terrain !== 'capital');
  let x, z, text;
  if (empty.length) {
    [x, z] = pick(empty);
    text = 'Raiders made camp on open ground.';
  } else if (waste.length) {
    ({ x, z } = pick(waste));
    text = 'Raiders made camp in the wasteland.';
  } else if (buildings.length) {
    ({ x, z } = pick(buildings));
    text = `Raiders razed your ${TERRAINS[grid.get(x, z).terrain].name} and made camp.`;
  } else return null;
  addTile(x, z, 'raider');
  grid.get(x, z).onRuins = false;
  spawnRaider.last = { x, z, effect: campEffect('raider') };
  placement.cell = null;
  frontier.rebuild(grid);
  return text;
}

/** Chance that each full 3×3 block of Wasteland draws a bandit camp at the end of a season. */
const BANDIT_CHANCE = 1;
/** Centre cells of every exact 3×3 block of Wasteland on the board. */
function findWasteBlocks() {
  const waste = (x, z) => grid.get(x, z)?.terrain.startsWith('wasteland');
  const out = [];
  for (const c of grid.cells.values()) {
    if (!waste(c.x, c.z)) continue;
    let full = true;
    for (let dx = -1; dx <= 1 && full; dx++) for (let dz = -1; dz <= 1 && full; dz++) full = waste(c.x + dx, c.z + dz);
    if (full) out.push([c.x, c.z]);
  }
  return out;
}

/**
 * End of season: each 3×3 block of Wasteland may turn its centre into a random bandit camp.
 * Rechecks after every camp, so one big field doesn't spawn a pile of camps at once.
 * Returns [{ name, effect }] for the report.
 */
function spawnBandits() {
  const spawned = [];
  const skipped = new Set(); // blocks that rolled no camp this season
  for (;;) {
    const blocks = findWasteBlocks().filter(([x, z]) => !skipped.has(`${x},${z}`));
    if (!blocks.length) break;
    const [x, z] = blocks[Math.floor(Math.random() * blocks.length)];
    if (Math.random() >= BANDIT_CHANCE) {
      skipped.add(`${x},${z}`);
      continue;
    }
    const kind = BANDIT_KEYS[Math.floor(Math.random() * BANDIT_KEYS.length)];
    addTile(x, z, kind);
    spawned.push({ x, z, name: TERRAINS[kind].name, effect: campEffect(kind) });
  }
  if (spawned.length) {
    placement.cell = null;
    frontier.rebuild(grid);
  }
  return spawned;
}

/** Send in the Militia: clears one camp, leaving empty ground. */
function militia(x, z) {
  const name = TERRAINS[grid.get(x, z).terrain].name;
  clearCamp(x, z);
  toast(`The militia cleared the ${name}`, 'good');
}

/** Removes a camp (militia, bribe, fed or crushed rebels), leaving empty ground. */
function clearCamp(x, z) {
  const cell = grid.get(x, z);
  if (!cell || !isCamp(cell.terrain)) return;
  removeMesh(cell.mesh);
  grid.cells.delete(`${x},${z}`);
  dust.burst(x, z);
  frontier.rebuild(grid);
  placement.cell = null;
  updateHUD();
}

// ---------- first-contact scenes (once per run) ----------
/** Scenes waiting to play: [{ type: 'rebel' | 'bandit', camp }]. */
const pendingScenes = [];

function queueScene(type, camp) {
  const flag = type === 'rebel' ? 'seenRebels' : 'seenBandits';
  if (turn[flag] || !camp) return;
  turn[flag] = true;
  pendingScenes.push({ type, camp });
}

/** Plays the queued scenes in order (bandits before rebels) and returns their report lines. */
async function playPendingScenes(writeReport = true) {
  const out = [];
  pendingScenes.sort((a, b) => (a.type === 'bandit' ? -1 : 1) - (b.type === 'bandit' ? -1 : 1));
  while (pendingScenes.length) {
    const { type, camp } = pendingScenes.shift();
    eventOpen = true;
    hand.select(-1);
    const ctx = { dialogue, turn, camp, clearCamp, punish: crushRebels, pinMilitia };
    out.push(await (type === 'rebel' ? playRebelScene(ctx) : playBanditScene(ctx)));
    eventOpen = false;
    updateHUD();
  }
  if (writeReport && out.length) $('report').innerHTML = `${$('report').innerHTML}<br />${out.join('<br />')}`;
  return out;
}

/** "Crush them": costs population, or food when there is none. Returns what it cost. */
function crushRebels() {
  shake.amount = Math.min(shake.amount + 0.9, 1.2);
  if (turn.population >= LEADER_COSTS.crushPopulation) {
    turn.population -= LEADER_COSTS.crushPopulation;
    return `-${LEADER_COSTS.crushPopulation} population`;
  }
  const lost = Math.min(turn.food, LEADER_COSTS.crushFoodFallback);
  turn.food -= lost;
  return lost ? `-${lost} food` : 'no survivors to spare';
}

/** "The militia will burn you out": a free Send in the Militia in the next hand. */
function pinMilitia() {
  if (turn.pinned.length >= HAND_SIZE) return false;
  turn.pinned.push('militia');
  return true;
}

/** A fed season drives off the oldest raider camp, leaving the cell empty. True if one left. */
function departRaider() {
  const camp = [...grid.cells.values()].find((c) => c.terrain === 'raider');
  if (!camp) return false;
  removeMesh(camp.mesh);
  grid.cells.delete(`${camp.x},${camp.z}`);
  placement.cell = null;
  frontier.rebuild(grid);
  return true;
}

/** Failed tributes allowed: the third one ends the game. */
const MAX_STRIKES = 3;
let shownStrikes = 0;

/** Fill one circle per failed tribute; a newly filled circle flares. */
function showStrikes() {
  const dots = $('strikes').children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('on', i < turn.strikes);
    if (i < turn.strikes && i >= shownStrikes) bump(dots[i]);
  }
  shownStrikes = turn.strikes;
}

function gameOver(reason) {
  turn.over = true;
  hand.select(-1);
  $('gameoverReason').textContent = reason;
  $('gameoverStats').textContent =
    `Survived to ${SEASONS[turn.season]}, round ${turn.round} · ${turn.total} barrels delivered in total`;
  $('gameover').classList.remove('hidden');
}

function settleTurn(e) {
  // The year ends after Winter, or early as soon as this season's oil meets the quota.
  // Smuggler dens take a share of the stockpile (after this season's oil arrives).
  const stolen = Math.floor((turn.stockpile + e.oil) * Math.min(1, e.stockpileTheft));
  let yearEnds = turn.season >= yearLength() - 1 || turn.stockpile + e.oil - stolen >= turn.quota;
  const label = `${SEASONS[turn.season]}, round ${turn.round}`;
  turn.stockpile += e.oil - stolen;
  turn.total += e.oil;
  turn.food = e.storeAfter;

  const sgn = (n) => {
    const r = Math.round(n);
    return r > 0 ? `+${r}` : `${r}`;
  };
  const tag = (n) => `<span class="${Math.round(n) < 0 ? 'bad' : 'good'}">${sgn(n)}</span>`;
  const lines = [
    `<b>${label}</b>`,
    `Food ${tag(e.foodBalance)} · Free workers ${e.free}/${e.cap}${e.idle ? ` <span class="bad">(${e.idle} idle)</span>` : ''} · Oil ${tag(e.oil)}`,
  ];
  let msg = `${label}: +${e.oil} oil`;
  let kind = 'good';
  if (e.foodWasted) lines.push(`<span class="bad">The stores are full: ${e.foodWasted} food spoiled.</span>`);

  // Bandits already camped: what they took this season.
  if (e.oilStolen) lines.push(`<span class="bad">Siphoners drained ${e.oilStolen} oil from your pipelines.</span>`);
  if (e.banditFood) lines.push(`<span class="bad">Scavengers stole ${e.banditFood} food.</span>`);
  if (stolen) {
    lines.push(`<span class="bad">Smugglers made off with ${stolen} barrels from the stockpile.</span>`);
    msg += ` · Smugglers stole ${stolen}`;
    kind = 'bad';
  }
  // A full 3×3 block of Wasteland draws a new bandit camp.
  for (const camp of spawnBandits()) {
    queueScene('bandit', camp);
    lines.push(`<span class="bad">Bandits settled the wasteland: ${camp.name} (${camp.effect}).</span>`);
    msg += ` · Bandits: ${camp.name}!`;
    kind = 'bad';
  }

  // Rebels: a season with a food surplus drives one camp off; a season that ends with
  // no food at all (net ≤ 0 and empty stores) brings a new camp, in place for the next season.
  if (Math.round(e.foodBalance) > 0 && departRaider()) {
    lines.push('<span class="good">Your people are fed: a raider camp packed up and left.</span>');
    msg += ' · Raiders left';
  }
  if (rebelsRise(e)) {
    const raid = spawnRaider();
    if (raid) {
      queueScene('rebel', spawnRaider.last);
      lines.push(`<span class="bad">The food ran out and the people turned on you. ${raid} (${spawnRaider.last.effect})</span>`);
      msg += ' · Starvation: raiders arrived!';
      kind = 'bad';
    }
  }

  // First bandit / rebel camp this run: their leader speaks before the season wraps up
  // (a bribe or fed rebels change the stockpile and food the tribute sees).
  if (pendingScenes.length) {
    playPendingScenes(false).then((sceneLines) => {
      lines.push(...sceneLines);
      yearEnds = turn.season >= yearLength() - 1 || turn.stockpile >= turn.quota;
      finishSettle();
    });
    return;
  }
  finishSettle();

  function finishSettle() {
  // Tribute at the end of the year (after Winter, or early once the quota is met).
  let failure = null; // set when the tribute is missed: the Overlord comes to speak instead of the shop
  if (yearEnds) {
    if (turn.season < yearLength() - 1) {
      lines.push(`<span class="good">Quota met in ${SEASONS[turn.season]}: the year ends early.</span>`);
      msg += ` · Quota met early: skipping to the next year.`;
    }
    const quota = turn.quota;
    const delivered = turn.stockpile;
    const met = delivered >= quota;
    // This year's target reward: only paid if the (scaled) quota was met.
    const target = turn.target;
    const reward = met && target?.reward ? REWARDS[target.reward] : null;
    // Excess oil is spent in the shop (some events and target rewards multiply it).
    const coinMult = (turn.event?.mods?.coinMult ?? 1) * (reward?.coinMult ?? 1);
    turn.coins = Math.round(Math.max(0, delivered - quota) * coinMult);
    turn.stockpile = 0; // the Overlord takes everything; the new year starts from empty
    // The Overlord's greed grows with what he receives: excess raises next year's quota.
    // The target tier and any event quota change only last the year: next year grows from the base.
    const base = turn.quotaBase;
    const prevBase = base;
    turn.quotaBase = nextQuota(base, base + (delivered - quota));
    turn.quota = turn.quotaBase; // scaled again when the next target is set
    turn.metStreak = met ? turn.metStreak + 1 : 0;
    turn.lastMissed = !met;
    turn.event = null;
    turn.target = null;
    const rise = turn.quotaBase - prevBase;
    if (met) {
      lines.push(`<span class="good">Tribute of ${quota} met. The Overlord seized all ${delivered} barrels.</span>`);
      msg += ` · Tribute of ${quota} met. The Overlord seized all ${delivered} barrels.`;
      if (reward) {
        const extra = reward.grant?.({ turn }) ?? '';
        clampFood();
        lines.push(`<span class="good">${TIERS[target.tier].label} target met: reward earned (${iconize(reward.text)}). ${extra}</span>`);
        msg += ` · Target reward: ${reward.text}`;
      }
    } else {
      if (target?.reward)
        lines.push(`<span class="bad">${TIERS[target.tier].label} target missed: the reward (${iconize(REWARDS[target.reward].text)}) is lost.</span>`);
      const short = quota - delivered;
      turn.strikes++;
      // The missiles themselves fly during the Overlord's speech (playTributeFailure).
      const count = strikeCount(turn.strikes);
      const launched = `The Overlord launched ${count} missile${count === 1 ? '' : 's'} at your city.`;
      lines.push(`<span class="bad">Tribute short by ${short}. ${launched}</span>`);
      msg += ` · Tribute short by ${short}! ${launched}`;
      kind = 'bad';
      failure = { quota, delivered, short, missiles: count, nextQuota: turn.quota };
    }
    const greed = delivered > quota ? "Your excess whetted the Overlord's appetite. " : '';
    lines.push(`<span class="bad">${greed}Next base tribute: ${turn.quota} (+${rise}).</span>`);
    msg += ` · ${greed}Next base tribute: ${turn.quota} (+${rise}).`;
  }

  $('report').innerHTML = lines.join('<br />');

  // Missed tribute: no shop this year. The Overlord comes in person; on the last strike he razes the city.
  if (failure) {
    const final = turn.strikes >= MAX_STRIKES;
    if (!final) {
      turn.season = 0;
      turn.round++;
    }
    turn.coins = 0;
    updateHUD();
    const run = runId;
    playTributeFailure({ ...failure, strikes: turn.strikes, final }).then(() => {
      if (run !== runId) return; // the island was reset mid-speech
      if (final) {
        showStrikes(true);
        gameOver("Three tributes missed. The Overlord's missiles have turned your Hive City into a toxic crater.");
      } else startNewYear(dealNewHand, { continued: true });
    });
    return;
  }

  if (turn.strikes >= MAX_STRIKES) {
    showStrikes(true);
    gameOver('Three tributes missed. The Overlord has lost his patience and razed your city.');
    return;
  }

  turn.season = yearEnds ? 0 : turn.season + 1;
  if (yearEnds) turn.round++;
  toast(msg, kind, 3200);
  // A new year opens with the shop; the hand is dealt when it closes.
  if (turn.season === 0) {
    updateHUD();
    openShop();
  } else dealNewHand();
  }
}

// ---------- year events ----------
/** Seasons before tribute this year (4, or fewer/more under an event). */
const yearLength = () => turn.event?.mods?.yearLength ?? 4;
let eventOpen = false;

/**
 * A new year (year 2 on): any free tile picks earned last year, then the Overlord asks for this
 * year's target, then the year event, then `then` (deal the hand).
 *
 * It plays as one conversation: the dialogue stays up from the target through the event (and, with
 * `continued`, straight on from the failure speech that is already showing), and the Overlord only
 * leaves once he has nothing more to say.
 */
async function startNewYear(then, { continued = false } = {}) {
  eventOpen = true;
  hand.select(-1);
  let talking = continued; // the dialogue is already up
  if (turn.season === 0 && turn.round >= 2) {
    const gifted = turn.cardPicks > 0;
    if (gifted && talking) {
      await dialogue.leave(); // the tile pick has its own screen
      talking = false;
    }
    while (turn.cardPicks > 0) {
      turn.cardPicks--;
      await openCardPick();
    }
    eventOpen = true; // the tile pick clears it when it closes
    await startTarget({ continued: talking, gifted });
    talking = true;
  }
  return startYearEvent(then, { continued: talking });
}

/**
 * The Overlord sets this year's target (forced High after LOW_STREAK_LIMIT Lows in a row).
 * Leaves the dialogue open: the caller closes it (or carries on talking).
 */
async function startTarget({ continued = false, gifted = false } = {}) {
  eventOpen = true;
  hand.select(-1);
  const forced = turn.lowStreak >= LOW_STREAK_LIMIT;
  const offers = (forced ? ['high'] : TIER_ORDER).map((tier) => ({ tier, reward: rollReward(TIERS[tier].pool) }));
  const picked = await playTargetDialogue(offers, { forced, continued, gifted });
  applyTarget(picked);
}

/** Text for one tier option: its quota and (if any) its reward. */
function targetTag({ tier, reward }) {
  const q = scaledQuota(turn.quotaBase, tier);
  const pct = Math.round(TIERS[tier].mult * 100);
  return `${q} oil (${pct}%) · ${reward ? `reward: ${iconize(REWARDS[reward].text)}` : 'no reward'}`;
}

async function playTargetDialogue(offers, { forced, continued, gifted }) {
  const OVERLORD = 'The Overlord';
  const pleased = !turn.lastMissed;
  const base = turn.quotaBase;
  dialogue.open({
    kind: forced ? 'pressure' : 'choice',
    kindLabel: `Year ${turn.round} · tribute target`,
    title: forced ? 'No More Excuses' : pleased ? 'The Overlord Is Pleased' : 'A Chance to Redeem Yourself',
    effect: forced
      ? `${LOW_STREAK_LIMIT} low targets in a row: this year's target is forced to High.`
      : `Base tribute ${base} oil · rewards are paid only if the target is met.`,
  });
  let lines;
  let ask;
  if (forced) {
    lines = [
      continued
        ? `And do not think I have forgotten your ${LOW_STREAK_LIMIT} timid little targets in a row.`
        : `${LOW_STREAK_LIMIT} years of timid little targets, Overseer. Did you think I would not notice?`,
      'My legions do not march on modest ambitions.',
    ];
    ask = `This year you will give me ${scaledQuota(base, 'high')} barrels. I am not asking.`;
  } else if (pleased) {
    lines = [
      gifted ? 'I trust my gift will serve you well, Overseer.' : 'Your harvest reached my tanks in full. I am... pleased, Overseer.',
      `My clerks reckon ${base} barrels for the coming year. But a loyal servant may name his own target.`,
    ];
    ask = 'Promise me less and play it safe, or promise me more and be rewarded. Choose.';
  } else {
    lines = [
      continued ? 'Still. I have some use for you yet.' : 'You failed me, and yet here you stand.',
      `My clerks reckon ${base} barrels for the coming year. Perhaps you wish to prove them wrong.`,
    ];
    ask = 'Name your target, Overseer. Promise little and keep your head, or promise more and earn back my favour.';
  }
  for (const line of lines) await dialogue.say(OVERLORD, line);
  const options = forced
    ? [{ text: 'As you command, Overlord.', tag: targetTag(offers[0]) }]
    : offers.map((o) => ({ text: `${TIERS[o.tier].label}: ${TIERS[o.tier].say}`, tag: targetTag(o) }));
  const i = await dialogue.ask(OVERLORD, ask, options);
  const picked = offers[i];
  await dialogue.say(OVERLORD, forced ? 'Good. Do not make me regret indulging you all these years.' : TIERS[picked.tier].retort);
  return picked;
}

function applyTarget({ tier, reward }) {
  turn.target = { tier, reward };
  turn.quota = scaledQuota(turn.quotaBase, tier);
  turn.lowStreak = tier === 'low' ? turn.lowStreak + 1 : 0;
  const rewardText = reward ? `Reward if met: ${REWARDS[reward].text}.` : 'No reward.';
  const cls = tier === 'low' ? '' : 'good';
  $('report').innerHTML =
    `${$('report').innerHTML}<br /><span class="${cls}">Target set: <b>${TIERS[tier].label}</b>, tribute ${turn.quota} oil. ${iconize(rewardText)}</span>`;
  updateHUD();
}

/**
 * Draw this year's event (none in year 1), show it, apply the result, then continue.
 * `continued`: the Overlord is already talking (target dialogue), so the event follows on from it
 * and he leaves at the end either way.
 */
async function startYearEvent(then, { continued = false } = {}) {
  const key = drawEvent(turn, turn.forceFortune ? { kinds: ['fortune'] } : undefined);
  turn.forceFortune = false;
  if (!key) {
    if (continued) await dialogue.leave();
    eventOpen = false;
    targetToast();
    return then();
  }
  const ev = EVENTS[key];
  eventOpen = true;
  hand.select(-1);
  const choice = await playEventDialogue(key, ev, continued);
  await dialogue.leave();
  eventOpen = false;
  applyYearEvent(key, ev, choice);
  await playPendingScenes(); // turned-away refugees: the Rebel Leader speaks
  then();
}

/** After the new-year talk: a reminder of the target just set (toasts are hidden during dialogue). */
function targetToast() {
  const tg = turn.target;
  if (!tg || turn.season !== 0) return;
  const r = tg.reward ? REWARDS[tg.reward] : null;
  toast(`${TIERS[tg.tier].label} target: ${turn.quota} oil${r ? ` · reward: ${r.text}` : ''}`, 'good', 3200);
}

/** What the Overlord says to move on from the target to the year's event. */
const EVENT_BRIDGE = {
  pressure: 'One more thing, Overseer. My demands have grown this year.',
  disaster: 'Before you scurry off. There is news from your city, and you will not like it.',
  fortune: 'And before you go: some news that may even please you.',
  choice: 'One more thing. A matter for you to decide.',
};

/**
 * The Overlord announces the event. His last line comes with your replies: for choice events
 * those are the real options (with their effect in the tag), otherwise flavour that he answers.
 * The dialogue is left open; the caller closes it.
 */
async function playEventDialogue(key, ev, continued = false) {
  const OVERLORD = 'The Overlord';
  dialogue.open({
    kind: ev.kind,
    kindLabel: `Year event · ${KIND_LABEL[ev.kind]}`,
    title: ev.name,
    effect: iconize(ev.choices ? 'Your answer decides what happens.' : eventText(key)),
  });
  const { p } = eventSetup(key);
  if (continued && EVENT_BRIDGE[ev.kind]) await dialogue.say(OVERLORD, EVENT_BRIDGE[ev.kind]);
  const evLines = typeof ev.lines === 'function' ? ev.lines(p) : ev.lines;
  const lines = evLines?.length ? evLines : [eventText(key)];
  for (const line of lines.slice(0, -1)) await dialogue.say(OVERLORD, line);
  const options = ev.choices
    ? ev.choices.map((c, ci) => {
        const { mods } = eventSetup(key, ci);
        return { text: c.say ?? c.label, tag: iconize(c.text(p, previewEconomy(mods))) };
      })
    : (ev.replies ?? [{ say: 'Understood.' }]).map((r) => ({ text: r.say }));
  const i = await dialogue.ask(OVERLORD, lines[lines.length - 1], options);
  const picked = ev.choices ? ev.choices[i] : ev.replies?.[i];
  if (picked?.retort) await dialogue.say(OVERLORD, picked.retort);
  return ev.choices ? i : -1;
}

function applyYearEvent(key, ev, choiceIdx) {
  const { mods, choice } = eventSetup(key, choiceIdx);
  // Mods and text are worked out live from this year's strength (the Scaling sliders apply at once).
  const round = turn.round;
  turn.event = {
    key,
    choiceIdx,
    round,
    name: ev.name,
    kind: ev.kind,
    get mods() {
      return eventSetup(key, choiceIdx, round).mods;
    },
    get summary() {
      return eventText(key, choiceIdx, round);
    },
  };
  const summary = turn.event.summary;
  // Scales this year's (already target-scaled) quota; next year still grows from turn.quotaBase.
  if (mods.quotaMult) turn.quota = Math.round(turn.quota * mods.quotaMult);
  const ctx = {
    turn,
    spawnRaider: () => {
      const raid = spawnRaider();
      if (!raid) return null;
      queueScene('rebel', spawnRaider.last);
      return { text: raid, effect: spawnRaider.last.effect };
    },
  };
  const extra = [ev.apply?.(ctx), choice?.apply?.(ctx)].filter(Boolean).join(' ');
  const line = `<span class="${ev.kind === 'fortune' ? 'good' : ev.kind === 'choice' ? '' : 'bad'}">Year event: <b>${ev.name}</b>. ${summary}${extra ? ` ${extra}` : ''}</span>`;
  $('report').innerHTML = `${$('report').innerHTML}<br />${line}`;
  toast(`${ev.name}${choice ? `: ${choice.label}` : ''}${extra ? ` · ${extra}` : ''}`, ev.kind === 'fortune' ? 'good' : 'bad', 3200);
  frontier.rebuild(grid);
}

function dealNewHand() {
  hand.deal(HAND_SIZE, turn.pinned);
  turn.pinned = [];
  holdingPurchases = false;
  updateHUD();
  pop($('oilStock'));
}

// ---------- shop (after Winter) ----------
let shopOpen = false;
/** True from the shop opening until the next deal: the hand shows only the cards bought so far. */
let holdingPurchases = false;

/** How many items the shop offers each visit, picked at random from SHOP_ITEMS. */
const SHOP_SLOTS = 5;
let shopStock = [];

/** Shop reroll: the first costs SHOP_REROLL_BASE barrels, each further one in the same visit +1. */
const SHOP_REROLL_BASE = 1;
let shopRerolls = 0;
const shopRerollCost = () => SHOP_REROLL_BASE + shopRerolls;

function stockShop() {
  shopStock = [...SHOP_ITEMS].sort(() => Math.random() - 0.5).slice(0, SHOP_SLOTS);
}

function openShop() {
  shopOpen = true;
  shopRerolls = 0;
  stockShop();
  hand.select(-1);
  // The old hand is gone; bought cards are dealt into the empty hand as they are bought.
  hand.clear();
  turn.pinned.forEach((k) => hand.addPinned(k));
  holdingPurchases = true;
  renderShop(true);
  // Restart the open animation every time.
  const el = $('shop');
  el.classList.remove('hidden', 'opening');
  void el.offsetWidth;
  el.classList.add('opening');
  document.body.classList.add('shopping');
}

/** Debug (V): play a random year event now (it replaces the current one until the next tribute). */
function debugEvent() {
  if (shopOpen || payout.active || turn.over || eventOpen) return;
  const round = turn.round;
  turn.round = Math.max(2, round); // events are never drawn in year 1
  startYearEvent(updateHUD).finally(() => (turn.round = round));
}

/**
 * Debug panel: skip straight to this year's tribute. `met` delivers exactly the quota (shop, then the
 * next year's target dialogue); otherwise nothing is delivered (a strike and the failure speech).
 * The skipped season's own oil is ignored; food and population still tick once.
 */
function debugSkipYear(met) {
  if (turn.over) return 'Game over: restart first';
  if (shopOpen || eventOpen || payout.active) return 'Finish the current screen first';
  if (previewing) cancelPreview();
  hand.select(-1);
  turn.season = yearLength() - 1;
  turn.stockpile = met ? turn.quota : 0;
  settleTurn({ ...economyNow(), oil: 0 });
  return met ? `Skipped year: tribute met` : 'Skipped year: tribute missed';
}

/** Debug (T): set this year's tribute target again (Shift+T: a free tile pick first). */
function debugTarget(withPick = false) {
  if (shopOpen || payout.active || turn.over || eventOpen) return;
  (withPick ? openCardPick() : Promise.resolve())
    .then(() => startTarget({ gifted: withPick }))
    .then(() => dialogue.leave())
    .then(() => {
      eventOpen = false;
      targetToast();
      dealIfPicked();
    });
}
/** After a debug tile pick, deal the pinned tile into the hand so it can be seen. */
function dealIfPicked() {
  if (turn.pinned.length) dealNewHand();
}

/** Debug (P): open the shop now with some spending money. Continue deals a fresh hand. */
const DEBUG_SHOP_COINS = 20;
function debugShop() {
  if (shopOpen || payout.active || turn.over) return;
  turn.coins = DEBUG_SHOP_COINS;
  openShop();
}

function renderShop(animate = false) {
  $('shopCoins').textContent = `${turn.coins} barrel${turn.coins === 1 ? '' : 's'} of excess oil`;
  $('shopHint').textContent = turn.coins
    ? 'Bought cards go straight into your hand. Special tiles unlock for good.'
    : 'Nothing to spend: only oil above the tribute can be spent here.';
  const cost = shopRerollCost();
  $('shopRerollCost').textContent = `· ${cost} barrel${cost === 1 ? '' : 's'}`;
  $('btnShopReroll').classList.toggle('cant', turn.coins < cost);
  $('shopCards').innerHTML = shopStock.map(([k, price], i) => {
    const t = cardDef(k);
    const inHand = turn.pinned.filter((p) => p === k).length;
    const can = turn.coins >= price && turn.pinned.length < HAND_SIZE;
    return `
      <div class="shop-item">
        <div class="card${can ? '' : ' cant'}${animate ? ' deal' : ''}" data-k="${k}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${0.15 + i * 0.07}s">
          <div class="art">${cardArtHTML(k)}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>
        <div class="price">${price} barrels</div>
        <div class="tag">${BASIC_SHOP.has(k) ? 'Basic' : turn.unlocked.has(k) ? 'Unlocked' : 'Locked'}${ACTIONS[k] ? ' · one use' : ''}${inHand ? ` · ${inHand} in hand` : ''}</div>
      </div>`;
  }).join('');
}

function buy(k) {
  const price = SHOP_ITEMS.find(([key]) => key === k)[1];
  if (turn.coins < price) return toast('Not enough excess oil', 'bad');
  if (turn.pinned.length >= HAND_SIZE) return toast('Your next hand is full', 'bad');
  turn.coins -= price;
  if (!BASIC_SHOP.has(k)) turn.unlocked.add(k); // action cards too: once bought, they can be drawn at random
  turn.pinned.push(k);
  hand.addPinned(k);
  renderShop();
}

$('shopCards').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-k]');
  if (card) buy(card.dataset.k);
});
$('btnShopReroll').addEventListener('click', () => {
  const cost = shopRerollCost();
  if (turn.coins < cost) return toast('Not enough excess oil to reroll', 'bad');
  turn.coins -= cost;
  shopRerolls++;
  stockShop();
  renderShop(true);
});
$('btnShopDone').addEventListener('click', () => {
  shopOpen = false;
  turn.coins = 0; // unspent excess goes to the Overlord
  $('shop').classList.add('hidden');
  document.body.classList.remove('shopping');
  startNewYear(dealNewHand);
});

// ---------- free tile pick (target reward) ----------
const PICK_SLOTS = 3;
let pickResolve = null;

/** Show 3 random market tiles; the clicked one is unlocked and put in the next hand for free. */
function openCardPick() {
  const options = SHOP_ITEMS.filter(([k]) => !BASIC_SHOP.has(k)).sort(() => Math.random() - 0.5).slice(0, PICK_SLOTS);
  eventOpen = true;
  hand.select(-1);
  $('pickCards').innerHTML = options.map(([k], i) => {
    const t = cardDef(k);
    return `
      <div class="shop-item">
        <div class="card deal" data-k="${k}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${0.15 + i * 0.07}s">
          <div class="art">${cardArtHTML(k)}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>
        <div class="tag">${turn.unlocked.has(k) ? 'Unlocked' : 'Locked'}${ACTIONS[k] ? ' · one use' : ''}</div>
      </div>`;
  }).join('');
  const el = $('cardPick');
  el.classList.remove('hidden', 'opening');
  void el.offsetWidth;
  el.classList.add('opening');
  document.body.classList.add('shopping');
  return new Promise((resolve) => (pickResolve = resolve));
}

/** `resume` false (a reset) drops the waiting new-year flow instead of continuing it. */
function closeCardPick(resume = true) {
  $('cardPick').classList.add('hidden');
  if (!shopOpen) document.body.classList.remove('shopping');
  const done = pickResolve;
  pickResolve = null;
  eventOpen = false;
  if (resume) done?.();
}

$('pickCards').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-k]');
  if (!card || !pickResolve) return;
  const k = card.dataset.k;
  turn.unlocked.add(k);
  const inHand = turn.pinned.length < HAND_SIZE;
  if (inHand) {
    turn.pinned.push(k);
    if (holdingPurchases) hand.addPinned(k);
  }
  toast(`${cardDef(k).name} unlocked${inHand ? ' and added to your next hand' : ''}`, 'good', 2600);
  closeCardPick();
});

// ---------- input ----------
const pointer = new THREE.Vector2();
let pointerInside = false;
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) hand.rotate(1);
});

function hoveredCell() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(boardPlane, hit)) return null;
  return [Math.round(hit.x), Math.round(hit.z)];
}

// ---------- mystery sites ----------
/** "?" sites touching the newly placed cells turn into their tiles. */
function revealMysteries(cells) {
  const found = mysteries.revealAround(cells);
  if (!found.length) return;
  found.forEach(({ x, z, terrain }, i) => addTile(x, z, terrain, 0.25 + i * 0.15));
  toast(`Uncovered ${found.map((f) => `a ${TERRAINS[f.terrain].name}`).join(', ')}!`, 'good', 2400);
}

// ---------- territory expansion (debug mode) ----------
/**
 * Expansion mode only: offer expansion whenever the territory is full, however it got that way
 * (a placed piece, a raider camp landing in the last slot...). Runs every frame; withdraws the
 * offer if a slot opens up.
 */
function checkExpansion() {
  if (!grid.expansionMode || turn.over || shopOpen || eventOpen || payout.active) return;
  const full = grid.isFull();
  if (!full && expansion.active) {
    expansion.clear();
    fog.setOptions(null);
  }
  if (!full || expansion.active) return;
  expansion.show(grid);
  fog.setOptions(grid.expansionOptions());
  toast('Territory full: pick a plot on the edge to expand', 'good');
}

function expand(option) {
  grid.unlock(option.px, option.pz);
  expansion.clear();
  fog.setOptions(null);
  // The clouds part; mystery sites in the new plot drop in as real tiles while they clear.
  const clearing = fog.visible ? fog.revealPlot(option.px, option.pz) : 0;
  const found = mysteries.reveal(option.px, option.pz);
  found.forEach(({ x, z, terrain }, i) => addTile(x, z, terrain, 0.25 + clearing * 0.5 + i * 0.15));
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  rig.focus(...grid.territoryCenter());
  toast(
    found.length
      ? `Territory expanded · found ${found.map((f) => `a ${TERRAINS[f.terrain].name}`).join(', ')}!`
      : 'Territory expanded',
    'good',
  );
  updateHUD();
}

/** Debug toggle: switch rules and restart the run in the chosen mode. */
function setExpansionMode(on) {
  grid.expansionMode = on;
  localStorage.setItem(MODE_KEY, on ? 'expansion' : 'free');
  debug.refreshMode?.();
  resetIsland();
  toast(on ? 'Expansion mode on: fill your territory, then expand (new run)' : 'Free placement on: build anywhere next to your land (new run)', 'good', 2600);
}

function tryPlace() {
  if (turn.over || shopOpen || eventOpen) return;
  if (payout.active) {
    payout.skip(); // clicking the board during the payout fast-forwards it
    return;
  }
  if (expansion.active) {
    const option = expansion.optionAt(hoveredCell());
    if (option) expand(option);
    else toast('Territory full: click a highlighted plot to expand');
    return;
  }
  const piece = hand.piece;
  if (!piece) {
    toast(hand.isEmpty ? 'Hand used up: press Next turn' : 'Pick a piece from your hand');
    return;
  }
  const cell = hoveredCell();
  if (!cell) return;
  const cells = placement.cellsAt(cell);
  const result = placement.validate(cells);
  if (!result.ok) {
    placement.reject();
    toast(result.reason, 'bad');
    return;
  }
  if (ACTIONS[piece.terrain]) {
    hand.consume();
    if (piece.terrain === 'spark') spark(cells);
    else if (piece.terrain === 'militia') militia(...cells[0]);
    else demolish(...cells[0]);
    return;
  }
  const idleBefore = economyNow().idle;
  if (piece.terrain.startsWith('wasteland')) addWastePiece(piece, cells);
  else cells.forEach(([x, z], i) => addTile(x, z, piece.terrain, i * 0.05));
  piecesPlaced++;
  hand.consume();
  if (!grid.expansionMode) revealMysteries(cells);
  frontier.rebuild(grid);
  updateHUD();
  if (economyNow().idle > idleBefore) toast('No free workers: this building sits idle until you add housing', 'bad', 2400);
}

/** Spark: tiles in the area pay out their oil and food right now (upkeep isn't charged). */
function spark(cells) {
  const area = new Set(cells.map(([x, z]) => `${x},${z}`));
  const e = economyNow();
  const hit = e.perCell
    .filter((p) => area.has(`${p.x},${p.z}`) && (p.oil > 0 || p.food > 0))
    .map((p) => ({ x: p.x, z: p.z, mesh: grid.get(p.x, p.z).mesh, oil: Math.max(0, p.oil), food: Math.max(0, p.food) }));
  // A sparked Capital triggers too: it hops, then every producing building next to it fires once more
  // (one trigger's worth: its season output divided by how many times it triggers).
  for (const cap of e.perCell.filter((p) => p.terrain === 'capital' && area.has(`${p.x},${p.z}`))) {
    hit.push({ x: cap.x, z: cap.z, mesh: grid.get(cap.x, cap.z).mesh, oil: 0, food: 0, terrain: 'capital' });
    for (const [dx, dz] of DIRS) {
      const n = e.perCell.find((p) => p.x === cap.x + dx && p.z === cap.z + dz);
      if (!n || n.idle || (n.oil <= 0 && n.food <= 0)) continue;
      const per = n.triggers ?? 1;
      hit.push({
        x: n.x,
        z: n.z,
        mesh: grid.get(n.x, n.z).mesh,
        oil: Math.round(Math.max(0, n.oil) / per),
        food: Math.round(Math.max(0, n.food) / per),
        finale: true, // after the area pays out, like a chain reaction from the Capital
      });
    }
  }
  if (!hit.length) {
    toast('Spark fizzled: nothing in range produces oil or food', 'bad');
    updateHUD();
    return;
  }
  document.body.classList.add('paying');
  payout.start(
    hit,
    (tile) => {
      if (tile.oil) {
        turn.stockpile += tile.oil;
        turn.total += tile.oil;
        showOil(turn.stockpile, true);
      }
      if (tile.food) {
        turn.food += tile.food;
        clampFood();
        showStore(turn.food, foodCapOf(grid), true);
      }
    },
    () => {
      document.body.classList.remove('paying');
      updateHUD();
    },
  );
}

/** Demolish: the tile is removed; a building on Pre-war Ruins leaves the ruins behind. */
function demolish(x, z) {
  const cell = grid.get(x, z);
  const name = TERRAINS[cell.terrain].name;
  removeMesh(cell.mesh);
  grid.cells.delete(`${x},${z}`);
  if (cell.onRuins && cell.terrain !== 'ruins') addTile(x, z, 'ruins');
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  toast(`Demolished the ${name}`);
  updateHUD();
}

rig.onClick = tryPlace;

window.addEventListener('keydown', (e) => {
  if (document.getElementById('loading')) return; // no shortcuts until the island exists
  const k = e.key.toLowerCase();
  const tgt = e.target;
  // Space: replay the payout sequence (debug). Works even with a debug slider focused.
  if (k === ' ' && !tgt.matches?.('select, textarea, input:not([type=range])')) {
    e.preventDefault();
    if (!e.repeat) previewPayout();
    return;
  }
  if (tgt.matches?.('input, select, textarea')) return; // typing in the debug panel
  if (k === '`') {
    debug.toggle();
    return;
  }
  if (k === '-') {
    perf.setOpen(!perf.enabled); // performance overlay
    return;
  }
  if (striking) return; // the missile strike cinematic owns the screen
  if (payout.active) {
    if (k === 'enter') endTurn();
    return; // no placing / rotating / nuking mid-payout
  }
  if (k >= '1' && k <= String(HAND_SIZE)) {
    const i = Number(k) - 1;
    hand.select(hand.selected === i ? -1 : i);
  } else if (k === 'r') hand.rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') hand.rotate(-1);
  else if (k === 'escape') {
    if (helpOpen()) setHelp(false);
    else hand.select(-1);
  }
  else if (k === 'c') rig.focus(...(grid.expansionMode ? grid.territoryCenter() : grid.centroid()));
  else if (k === 'n') nukeRandomTile();
  else if (k === 'm' && !e.repeat) {
    const msg = previewMissileStrike();
    if (msg.startsWith('Finish') || msg.startsWith('Game over')) toast(msg);
  }
  else if (k === 'p' && !e.repeat) debugShop();
  else if (k === 'v' && !e.repeat) debugEvent();
  else if (k === 't' && !e.repeat) debugTarget(e.shiftKey);
  else if (k === 'x' && !e.repeat) setExpansionMode(!grid.expansionMode);
  else if (k === 'enter') endTurn();
});

$('btnReroll').addEventListener('click', () => {
  if (hand.isEmpty || payout.active || turn.over || shopOpen || eventOpen) return;
  if (turn.freeRerolls > 0) {
    // Target reward: free, and doesn't raise the price of the next paid reroll.
    turn.freeRerolls--;
    hand.reroll();
    updateHUD();
    toast(`Hand rerolled for free (${turn.freeRerolls} free reroll${turn.freeRerolls === 1 ? '' : 's'} left)`, 'good');
    return;
  }
  const cost = rerollCost();
  if (turn.stockpile < cost) {
    toast(`Not enough oil to reroll (costs ${cost})`, 'bad');
    return;
  }
  hand.reroll();
  turn.rerolls++;
  turn.stockpile -= cost;
  updateHUD();
  toast(`Hand rerolled: -${cost} oil (next reroll costs ${rerollCost()})`);
});
$('btnNext').addEventListener('click', (e) => {
  e.currentTarget.blur(); // so Space doesn't re-click it
  endTurn();
});
$('btnReset').addEventListener('click', resetIsland);

// Controls popup: toggled by its button, closed by ✕, Esc or a click elsewhere.
const helpOpen = () => !$('help').classList.contains('hidden');
const setHelp = (open) => $('help').classList.toggle('hidden', !open);
$('btnHelp').addEventListener('click', (e) => {
  e.stopPropagation();
  e.currentTarget.blur();
  setHelp(!helpOpen());
});
$('helpClose').addEventListener('click', () => setHelp(false));
document.addEventListener('pointerdown', (e) => {
  if (helpOpen() && !$('help').contains(e.target) && e.target !== $('btnHelp')) setHelp(false);
});
$('btnRestart').addEventListener('click', resetIsland);

// ---------- lifecycle ----------
function resetIsland() {
  runId++; // stops a missile strike / failure speech still running
  missiles.clear();
  striking = false;
  rig.release();
  document.body.classList.remove('striking');
  payout.cancel(); // stop a running payout without settling it
  previewing = false;
  document.body.classList.remove('paying');
  tiles.clear();
  grid.clear();
  anims.length = 0;
  dust.clear();
  shake.amount = 0;
  expansion.clear();
  fog.reset(grid);
  piecesPlaced = 0;
  Object.assign(turn, {
    round: 1,
    season: 0,
    stockpile: 0,
    rerolls: 0,
    event: null,
    metStreak: 0,
    lastMissed: false,
    total: 0,
    food: STARTING_FOOD,
    population: 0,
    quota: FIRST_QUOTA,
    over: false,
    strikes: 0,
    unlocked: new Set(),
    seenRebels: false, // first-contact scenes, once per run
    seenBandits: false,
    pinned: [],
    coins: 0,
    ...freshTargetState(),
  });
  shopOpen = false;
  eventOpen = false;
  pendingScenes.length = 0;
  closeCardPick(false);
  dialogue.close();
  $('shop').classList.add('hidden');
  document.body.classList.remove('shopping');
  $('gameover').classList.add('hidden');
  $('report').textContent = 'No seasons played yet.';
  addTile(0, 0, SEED_TERRAIN, 0, true); // the game opens with the Capital already standing
  mysteries.reset();
  frontier.rebuild(grid);
  // Opening hand: always one of each basic building plus two Wasteland, in random order.
  hand.deal(HAND_SIZE, OPENING_HAND);
  hand.cards.sort(() => Math.random() - 0.5);
  hand.render();
  rig.focus(0, 0);
  updateHUD();
  playIntro();
}

/**
 * A missed tribute: the Overlord comes to speak. What he says depends on how many strikes are
 * left: a warning, a last warning, and on the third miss his judgement (the game over follows).
 * Mid-speech he launches the missiles (1, 3, then 5): the dialogue steps aside for the strike,
 * then he comes back to gloat. On the final strike one of them hits the Capital.
 */
async function playTributeFailure({ quota, delivered, short, missiles: count, strikes, final }) {
  const OVERLORD = 'The Overlord';
  const run = runId;
  const live = () => run === runId;
  const say = async (text) => live() && text && dialogue.say(OVERLORD, text);
  const left = MAX_STRIKES - strikes;
  const many = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][count] ?? String(count);
  eventOpen = true;
  hand.select(-1);
  const banner = {
    kind: 'disaster',
    kindLabel: `Tribute missed · strike ${strikes} of ${MAX_STRIKES}`,
    title: final ? "The Overlord's Judgement" : strikes === MAX_STRIKES - 1 ? 'Last Warning' : 'The Overlord Is Displeased',
    effect: final
      ? `Short by ${short} barrels · ${count} missile${count === 1 ? '' : 's'} · the Hive City falls`
      : `Short by ${short} barrels · ${count} missile${count === 1 ? '' : 's'} · no market this year · ${left} more miss${left === 1 ? '' : 'es'} and the city falls`,
  };
  dialogue.open(banner);

  /** Dialogue steps aside, the missiles fly, the report notes the damage. */
  const strike = async (targets, opts) => {
    if (!targets.length || !live()) return [];
    await dialogue.leave();
    if (!live()) return [];
    const lost = await playMissileStrike(targets, opts);
    if (live()) reportStrike(lost);
    return lost;
  };

  if (final) {
    await say('Three times.');
    await say(`${delivered} barrels, when I asked for ${quota}. Three years, three failures.`);
    await say('I gave you a city, its workers and my patience. You squandered all three.');
    if (!live()) return;
    const replies = [
      ['I did everything I could.', 'Then everything was not enough. Launch them all.'],
      ['The wastes will take you too, one day.', 'Perhaps. But not today. Burn it.'],
      ['Please...', 'Begging. How fitting. Burn it to the sand.'],
    ];
    const i = await dialogue.ask(OVERLORD, 'Do you have any last words, Overseer?', replies.map(([text]) => ({ text })));
    await say(replies[i][1]);
    await say(`${many} missiles, Overseer. Watch your city burn.`);
    await strike(pickStrikeTargets(count, true), { restoreCamera: false });
    if (live()) eventOpen = false;
    return;
  }

  let script;
  if (left === 1) {
    script = {
      lines: [
        'Again. You have failed me again.',
        `${delivered} barrels. My generals no longer say your name; they just call you "the shortfall".`,
      ],
      launch: `${many} missile${count === 1 ? '' : 's'} this time. Look to the sky, Overseer.`,
      ask: 'This is your last warning. Fail me once more, and I will raze the Hive City to the sand.',
      replies: [
        ["You'll have your oil. All of it.", 'Words. Bring me barrels.'],
        ['Give me more time.', 'Time is the one thing I have stopped giving you.'],
        ['Then do it now.', 'Ha! No. I want to watch you try first.'],
      ],
    };
  } else {
    script = {
      lines: [
        `Short. ${delivered} barrels, when I asked for ${quota}.`,
        'My tanks sat idle in the dunes while the technobarbarians laughed. Because of you, Overseer.',
      ],
      launch: count === 1 ? 'Perhaps a demonstration will focus your mind. One missile. Watch the sky.' : `Perhaps a demonstration will focus your mind. ${many} missiles. Watch the sky.`,
      ask: 'There will be no market for you this year. Fail me twice more and your city burns.',
      replies: [
        ["It won't happen again.", "See that it doesn't."],
        ['The wells ran dry.', 'Then dig new ones. With your bare hands, if you must.'],
        ['...', 'Silence will not fill my tanks.'],
      ],
    };
  }
  for (const line of script.lines) await say(line);
  const targets = pickStrikeTargets(count);
  let lost = [];
  if (targets.length) {
    await say(script.launch);
    lost = await strike(targets);
    if (!live()) return;
    eventOpen = true;
    dialogue.open(banner); // he comes back to gloat
  }
  await say(
    lost.length
      ? `I have left a reminder where your ${listLost(lost)} used to stand.`
      : 'You have nothing standing worth one of my missiles. Remember that. I will.',
  );
  if (!live()) return;
  const i = await dialogue.ask(OVERLORD, script.ask, script.replies.map(([text]) => ({ text })));
  await say(script.replies[i][1]);
  // Not the end: he stays on and moves straight on to next year's target (startNewYear).
}

/** Opening scene: the Overlord appoints you Overseer of the Hive City, then leaves you to it. */
let introRun = 0;
async function playIntro() {
  const run = ++introRun; // a reset mid-intro cancels the old one
  const OVERLORD = 'The Overlord';
  const say = async (text) => run === introRun && dialogue.say(OVERLORD, text);
  eventOpen = true;
  hand.select(-1);
  dialogue.open({ kind: 'pressure', kindLabel: 'A new Overseer', title: 'The Hive City', effect: 'Year 1 · Spring' });
  await say('So. You are the new Overseer of the Hive City.');
  await say('Your predecessor... disappointed me. I trust you will not.');
  await say('My legions march against the technobarbarians of the Wastelands. Scrap-eaters. Machine-worshippers. Vermin.');
  await say('War is thirsty work. My tanks, my airships, my engines of conquest: all of them drink oil.');
  if (run !== introRun) return;
  const i = await dialogue.ask(OVERLORD, 'You will send me a constant supply. Every year. Without fail.', [
    { text: 'The oil will flow, Overlord.' },
    { text: 'And if the wells run dry?' },
    { text: 'What do I get in return?' },
  ]);
  const retorts = [
    'Of course it will.',
    'Then you will dig deeper. With your hands, if you must.',
    'You get to keep your city. And your head.',
  ];
  await say(retorts[i]);
  await say('Good luck, Overseer. You will need it.');
  if (run !== introRun) return;
  await dialogue.leave();
  if (run !== introRun) return;
  eventOpen = false;
  toast(`First tribute: ${turn.quota} barrels, due after Winter`, 'bad', 3200);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = now / 1000;
  perf.frameBegin(now);

  perf.begin('camera');
  rig.update(dt);
  followTarget(rig.target, rig.distance, dt);
  perf.end('camera');
  perf.begin('drops+shake');
  updateDropAnims(dt);
  applyShake(dt);
  perf.end('drops+shake');
  perf.begin('dust');
  dust.update(dt);
  perf.end('dust');
  perf.begin('missiles');
  missiles.update(dt);
  perf.end('missiles');
  perf.begin('tile anims');
  factory.update(dt);
  perf.end('tile anims');
  perf.begin('frontier+mysteries');
  frontier.update(dt, time);
  mysteries.update(time);
  perf.end('frontier+mysteries');
  perf.begin('ruin buttons');
  updateRuinButtons();
  perf.end('ruin buttons');
  perf.begin('map icons');
  zoomIcons.update(grid);
  perf.end('map icons');
  perf.begin('expansion');
  checkExpansion();
  const cell = rig.isDragging ? null : hoveredCell();
  expansion.update(cell, dt, time);
  perf.end('expansion');
  perf.begin('fog update');
  fog.setHover(expansion.hovered ? plotKey(expansion.hovered.px, expansion.hovered.pz) : null);
  fog.update(dt, rig.target, rig.distance);
  perf.end('fog update');
  perf.begin('inspect');
  updateInspect(cell);
  perf.end('inspect');
  perf.begin('placement');
  // Hide the ghost while choosing a plot or while the payout plays.
  placement.update(expansion.active || payout.active ? null : cell, dt, time);
  perf.end('placement');

  perf.begin('render (cpu)');
  perf.gpuBegin();
  fog.render(camera); // offscreen fog pass (High/Medium/Low on high-DPI screens)
  renderer.render(scene, camera);
  perf.gpuEnd();
  perf.end('render (cpu)');
  perf.begin('payout');
  payout.update(dt); // after render so labels use this frame's camera
  perf.end('payout');
  perf.frameEnd();
  requestAnimationFrame(frame);
}

// ---------- performance overlay (-) ----------
// GPU split: each fog draw (veil + billow layers) is bracketed, so GPU time lands in "fog";
// the rest of the frame (shadow pass, buildings, overlays, fog depth pre-pass + composite) is "scene".
for (const obj of [fog.veil, ...fog.meshes]) {
  obj.onBeforeRender = () => perf.gpuMark('fog');
  obj.onAfterRender = () => perf.gpuMark('scene');
}
perf.counter('fog quality', () => fog.quality + (fog.offscreen ? ` @${fog.renderScale}x offscreen` : ' (direct)'));
perf.counter('fog billows', () => (fog.visible ? fog.count.toLocaleString() : 'off'));
perf.counter('fog mask uploads', () => fog.uploads ?? 0);
perf.counter('grid cells', () => grid.cells.size);
perf.toggle({ label: 'Fog', get: () => fog.visible, set: (on) => fog.setVisible(on) });
perf.toggle({ label: 'Fog veil', get: () => fog.veilOn, set: (on) => fog.setParts({ veil: on }) });
perf.toggle({ label: 'Fog billows', get: () => fog.billowsOn, set: (on) => fog.setParts({ billows: on }) });
perf.toggle({ label: 'Shadow pass (off = frozen)', get: () => renderer.shadowMap.autoUpdate, set: (on) => (renderer.shadowMap.autoUpdate = on) });
const gfxToggle = (key, label) =>
  perf.toggle({
    label,
    options: GFX_PARAMS.find((p) => p.key === key).options,
    get: () => gfxCfg[key],
    set: (v) => {
      gfxCfg[key] = v;
      saveGfxConfig(gfxCfg);
      applyGraphics();
      debug.refresh();
    },
  });
gfxToggle('fogQuality', 'Fog quality');
gfxToggle('resolution', 'Resolution');
gfxToggle('shadows', 'Shadows');

// ---------- startup ----------
// Loading bar: bytes of the model files downloaded so far. The FBX files are
// almost all of the download; parsing them after the last byte takes a moment more,
// so the bar stops at 95% until the models are ready.
const loadTimer = setInterval(() => {
  const { loaded, total } = loadProgress;
  if (total) $('loadingFill').style.width = `${Math.round((loaded / total) * 95)}%`;
}, 100);

/** Send every model texture to the GPU now, so the first landing doesn't stutter while ~60 MB uploads. */
function warmUpModels(models = factory.models) {
  for (const model of models?.values() ?? []) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) {
        for (const tex of [m.map, m.normalMap, m.emissiveMap]) if (tex) renderer.initTexture(tex);
      }
    });
  }
}

// Start once the models are in, so the Capital lands as the real city rather than a
// stand-in block that swaps a second later. factory.ready also resolves if loading
// fails (the game then runs on coloured blocks).
factory.ready.then(() => {
  clearInterval(loadTimer);
  $('loadingFill').style.width = '100%';
  warmUpModels();
  resetIsland();
  last = performance.now();
  requestAnimationFrame(frame);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);
});

// The Wasteland piece models (about 330 MB) load after the buildings, while the intro plays.
factory.piecesReady.then((pieces) => {
  if (!pieces) return;
  warmUpModels(pieces);
  adoptWastePieces();
});

// Handy for debugging in the console.
window.tileIsland = { perf, renderer, grid, hand, placement, rig, expansion, mysteries, fog, turn, dialogue, missiles, missileCfg, previewMissileStrike, playMissileStrike, economy: economyNow, addTile, spawnBandits, settleTurn, spawnRaider, queueScene, playPendingScenes };
