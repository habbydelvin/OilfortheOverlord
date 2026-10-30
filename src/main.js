import './ui.css';
import './theme.css';
import './themeShine.js';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { getMusicVolume, initMusic, MUSIC_VOLUME_DEFAULT, MUSIC_VOLUME_MAX, onMusicVolume, setMusicVolume, startMusic } from './music.js';
import { bindCardHover, boom, buzz, confirm, coin, deny, doom, food, getSfxVolume, setSfxVolume, SFX_VOLUME_DEFAULT, SFX_VOLUME_MAX, shuffle, thud, tick, unlockSfx, whenSfxRunning } from './sfx.js';
import { CameraRig } from './controls.js';
import { Grid, DIRS, key as plotKey } from './grid.js';
import { FogOfWar, FOG_PARAMS, FOG_DEFAULTS, loadFogConfig, saveFogConfig, clearFogConfig } from './fogOfWar.js';
import { TileFactory, TERRAINS, ACTIONS, SHOP_ITEMS, BASIC_SHOP, BANDIT_KEYS, isCamp, cardDef, cardText, hex, ICONS, isBuilding, iconize, shapeGridHTML, snapHTML, cardArtHTML } from './tiles.js';
import { hasBlockout, loadProgress, breathe, decodeImage } from './models.js';
import { Frontier } from './frontier.js';
import { Placement } from './placement.js';
import { Hand, pieceCost } from './hand.js';
import { copySeam } from './seamlessGround.js';
import { NeonTiles } from './neonGlow.js';
import { setupLegend } from './legend.js';
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
import { Traffic } from './traffic.js';
import { ZoomIcons, ICON_PARAMS, ICON_DEFAULTS, loadIconConfig, saveIconConfig, clearIconConfig } from './zoomIcons.js';
import { Perf } from './perfOverlay.js';
import { GFX_PARAMS, GFX_DEFAULTS, loadGfxConfig, saveGfxConfig, clearGfxConfig, applyGfx } from './graphics.js';
import { playRebelScene, playBanditScene, LEADER_COSTS } from './leaders.js';
import { MissileStrike, MISSILE_PARAMS, MISSILE_DEFAULTS, loadMissileConfig, saveMissileConfig, clearMissileConfig } from './missiles.js';
import { Tutorial, TUTORIAL_QUOTA, TUTORIAL_STRIKES, TUTORIAL_SITE, TUTORIAL_KEY, tutorialDone, markTutorialDone } from './tutorial.js';
import { L, both, isZh, toggleLang, onLangChange, applyStatic, textOf, retranslate } from './i18n.js';

applyStatic(); // the page's own text in the saved language

const HAND_SIZE = 5;
const SEED_TERRAIN = 'capital';

// ---------- setup ----------
const { renderer, scene, camera, sun, followTarget } = createScene(document.getElementById('app'));
initMusic(); // background track downloads now; it starts with the game, once sound is allowed
onMusicVolume((volume) => {
  audioCfg.music = volume;
  const input = document.querySelector('#debug input[data-s="audio"][data-k="music"]');
  if (!input || document.activeElement === input) return;
  input.value = String(volume);
  const val = document.querySelector('#debug [data-v="audio.music"]');
  if (val) val.textContent = String(volume);
  input.closest('.dbg-row')?.classList.toggle('changed', volume !== AUDIO_DEFAULTS.music);
});
const perf = new Perf(renderer); // '-' toggles the overlay
const rig = new CameraRig(camera, renderer.domElement);
const START_DISTANCE = rig.goalDistance;
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
const traffic = new Traffic(scene); // ships flying between the tiles
const neonTiles = new NeonTiles(scene); // boosted buildings' tiles glow
setupLegend(document.getElementById('btnLegend'), document.getElementById('legend')); // icon legend window
const payoutCfg = loadPayoutConfig();
const payout = new Payout(camera, document.getElementById('floaters'), payoutCfg);
const audioCfg = { music: getMusicVolume(), sfx: getSfxVolume() };
const AUDIO_DEFAULTS = { music: MUSIC_VOLUME_DEFAULT, sfx: SFX_VOLUME_DEFAULT };
const AUDIO_PARAMS = [
  { group: 'Audio' },
  { key: 'music', label: 'Music', min: 0, max: MUSIC_VOLUME_MAX, step: 1, hint: '100 is full level, 200 is twice as loud. Same control as the corner slider.' },
  { key: 'sfx', label: 'SFX', min: 0, max: SFX_VOLUME_MAX, step: 1, hint: '100 is the old quiet level. 300 is the default.' },
];
bindCardHover(document.getElementById('shopCards'));
bindCardHover(document.getElementById('pickCards'));

const debug = createDebugPanel(document.getElementById('debug'), document.getElementById('btnDebug'), payoutCfg, {
  audio: {
    params: AUDIO_PARAMS,
    defaults: AUDIO_DEFAULTS,
    cfg: audioCfg,
    save: () => {},
    clear: () => {
      localStorage.removeItem('oto.music');
      localStorage.removeItem('oto.sfx');
    },
    onChange: (p) => {
      if (!p || p.key === 'music') setMusicVolume(audioCfg.music);
      if (!p || p.key === 'sfx') setSfxVolume(audioCfg.sfx);
    },
  },
  onPlay: () => previewPayout(),
  expansionMode: () => grid.expansionMode,
  onExpansionMode: (on) => (tutorialBlocks() ? undefined : setExpansionMode(on)),
  onSkipYear: (met) => (tutorialBlocks() ? 'Not during the tutorial' : debugSkipYear(met)),
  onPerf: () => perf.setOpen(!perf.enabled),
  onResetTutorial: () => {
    localStorage.removeItem(TUTORIAL_KEY); // next reload starts with the tutorial again
    resetIsland({ tutorial: true });
    return 'Tutorial reset: Year 0 started';
  },
  onMissiles: () => (tutorialBlocks() ? 'Not during the tutorial' : previewMissileStrike()),
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

// ---------- Year 0 tutorial (tutorial.js) ----------
const tutorial = new Tutorial({
  root: document.getElementById('coach'),
  scene,
  camera,
  hand,
  api: {
    deal: (list) => {
      hand.dealScripted(list);
      updateHUD();
    },
    /** This season if it ended now: oil made, and the stockpile it would leave. */
    forecast: () => {
      const e = economyNow();
      return { oil: e.oil, after: turn.stockpile + e.oil, quota: turn.quota };
    },
    setFreeRerolls: (n) => {
      turn.freeRerolls = n;
      updateHUD();
    },
    focus: (x, z) => rig.focus(x, z),
    skip: () => skipTutorial(),
  },
});
// While it runs, only the card, cells and buttons the advisor asks for respond.
hand.guard = (action, piece) => !busy() && tutorial.allows(action, piece);
hand.onBlocked = () => tutorial.nudge();
placement.guard = (cells, piece) => tutorial.placeGuard(cells, piece);
/** Debug tools and shortcuts are off during the tutorial (it has to stay on script). */
/** True while something owns the screen (dialogue, missiles, shop, payout): nothing can be picked or placed. */
const busy = () => eventOpen || striking || shopOpen || payout.active || turn.over;
const tutorialBlocks = () => {
  if (!tutorial.active) return false;
  tutorial.nudge();
  return true;
};

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
function eventText(key, choiceIdx = -1, year = turn.round, info = eventInfo()) {
  const { ev, p, choice, mods } = eventSetup(key, choiceIdx, year);
  const e = previewEconomy(mods);
  return choice ? `${choice.label}: ${choice.text(p, e, info)}` : ev.text(p, e, info);
}

/** What the board offers year events right now (for their text and whether they can be drawn). */
function eventInfo() {
  const cells = [...grid.cells.values()];
  return {
    quota: turn.quota,
    camps: cells.filter((c) => isCamp(c.terrain)).length,
    settlements: cells.filter((c) => c.terrain === 'settlement').length,
    buildings: cells.filter((c) => isBuilding(c.terrain) && c.terrain !== 'capital').length,
    sites: mysteries.sites.size,
    open: emptyEdgeCells().length,
    cliffs: Math.round(SCALE.earthquakeCliffs),
  };
}

/** Empty cells next to your land (never a "?" site), as [x, z]. */
const emptyEdgeCells = () =>
  [...grid.openKeys()].map((k) => k.split(',').map(Number)).filter(([x, z]) => !mysteries.has(x, z));
const shuffled = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Cards in every hand this year (a Black Market Caravan can add one). */
const handSize = () => HAND_SIZE + (turn.event?.mods?.handBonus ?? 0);
/** Shop price this visit (a Black Market Caravan can halve it). */
const shopPrice = (price) => Math.max(1, Math.round(price * (turn.shopMult ?? 1)));

/** What a camp kind does: its percentage, plus what all camps of that kind take right now. */
function campEffect(kind) {
  const e = economyNow();
  const d = TERRAINS[kind].stats.drain;
  const all = (e.camps[d] ?? 0) > 1 ? L(' (all camps)', '（所有营地合计）') : '';
  if (d === 'slots') return L(`-${P(SCALE.campSlots)} worker slots, -${e.rebelManpower} now${all}`, `人力 -${P(SCALE.campSlots)}，当前 -${e.rebelManpower} 人力${all}`);
  if (d === 'banditSlots') return L(`-${SCALE.banditSlots} worker slots`, `-${SCALE.banditSlots} 人力`);
  if (d === 'oil') return L(`-${SCALE.banditOil} oil each season`, `每季 -${SCALE.banditOil} 石油`);
  if (d === 'food') return L(`-${SCALE.banditFood} food each season`, `每季 -${SCALE.banditFood} 食物`);
  return L(`steals ${SCALE.banditStockpile} barrels from the stockpile each season`, `每季从石油库存偷走 ${SCALE.banditStockpile} 桶`);
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
  shadeIdle(); // a stand-in swapped for its model takes over the grey
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
    if (!quiet) toast(L('Nothing for the Overlord to nuke', '没有可供霸主轰炸的目标'));
    return null;
  }
  const { x, z } = targets[Math.floor(Math.random() * targets.length)];
  const lost = TERRAINS[grid.get(x, z).terrain].name;
  addTile(x, z, 'crater');
  grid.get(x, z).onRuins = false; // the ruins are gone too
  if (!quiet) toast(L('The Overlord is displeased: a Toxic Crater forms', '霸主很不满意：一处毒坑出现了'), 'bad');
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
  names = names.map(retranslate); // tile names as they were when destroyed: in the current language
  const WORDS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  if (isZh()) {
    const ZH = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
    const zh = [...counts].map(([n, k]) => (k === 1 ? n : `${ZH[k] ?? k}处${n}`));
    return zh.length < 2 ? zh[0] ?? '' : `${zh.slice(0, -1).join('、')}和${zh.at(-1)}`;
  }
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
async function playMissileStrike(targets, { convert = true, restoreCamera = true, follow = false, prelude = null } = {}) {
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
  if (follow) {
    // Ground launch: close up on the launch cell, then the camera rides along with the missile.
    const from = targets[0].from;
    followDist = FOLLOW_CLOSE;
    followCamera(new THREE.Vector3(from.x, 0, from.z), FOLLOW_CLOSE, 5);
    await wait(0.6);
    if (run !== runId) return lost;
    await prelude?.();
    if (run !== runId) return lost;
  } else {
    strikeCamera(targets);
    await wait(missileCfg.camLead);
    if (run !== runId) return lost;
  }
  await missiles.fire(targets, {
    onMove: follow
      ? (pos, t, u) => {
          if (run !== runId) return;
          // Pull back as it climbs, and by the end far enough that the target is in the shot.
          // (Never zooms back in: the impact is seen from as far out as the flight got.)
          const reach = Math.hypot(t.x - pos.x, t.z - pos.z);
          followDist = Math.max(followDist, FOLLOW_CLOSE + pos.y * 1.1 + reach * 0.6 * u);
          followCamera(pos, followDist, 7);
        }
      : undefined,
    onImpact: ({ x, z }) => {
      if (run !== runId) return;
      boom();
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

/** Closest zoom for the ground-launch close-up. */
const FOLLOW_CLOSE = 9;
let followDist = FOLLOW_CLOSE;
const camDir = new THREE.Vector3();
/**
 * Point the camera at a world position (may be in the air) with the HUD hidden: the look-at point is the
 * ground point that puts `pos` in the middle of the screen (sliding along the view direction by its height).
 */
function followCamera(pos, distance, rate) {
  const dist = THREE.MathUtils.clamp(distance, rig.minDistance, rig.maxDistance);
  rig.posRate = rate;
  rig.zoomRate = rate * 0.8;
  rig.goalDistance = dist;
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  camDir.normalize();
  const along = pos.y / Math.tan(rig.pitch); // a point at height y sits over the ground this far ahead
  const view = camera.view?.enabled ? camera.view : { offsetX: 0, offsetY: 0 };
  rig.goal.set(pos.x, 0, pos.z).addScaledVector(camDir, along).add(rig.screenShift(view.offsetX, view.offsetY, dist));
}

/**
 * A missile launches from the ground at `spot` and hits `target` (Show of Force's ruins, and an
 * Unexploded Missile). Resolves with the names of the tiles lost, or null if the run was reset meanwhile.
 */
async function groundStrike(spot, target, lostText = (l) => L(`The silo's missile destroyed your ${l}`, `发射井的导弹摧毁了你的${l}`)) {
  const run = runId;
  eventOpen = true; // locked from the moment it is called, through the lead-in
  hand.select(-1);
  await wait(0.3);
  if (run !== runId) return null;
  // The missile stands upright on the spot; the camera closes in, it shakes, then launches and is followed.
  const standing = missiles.showUpright(spot.x, spot.z);
  const prelude = async () => {
    standing.rumble();
    shake.amount = Math.min(shake.amount + 0.3, 1.2);
    await wait(1.2);
    standing.remove();
    boom();
    dust.burst(spot.x, spot.z, 1.6);
  };
  const lost = await playMissileStrike([{ ...target, from: spot, flight: 2.6, accel: 1.1 }], { follow: true, prelude });
  standing.remove();
  if (run !== runId) return null;
  eventOpen = false;
  reportStrike(lost);
  updateHUD();
  if (lost.length) toast(() => lostText(listLost(lost)), 'bad', 2600);
  return lost;
}

/** The building (never the Capital) nearest to (x, z), ties broken at random; null if there is none. */
function nearestBuilding(x, z) {
  const pool = [...grid.cells.values()].filter((c) => isBuilding(c.terrain) && c.terrain !== 'capital');
  if (!pool.length) return null;
  const d = (c) => Math.abs(c.x - x) + Math.abs(c.z - z);
  const best = Math.min(...pool.map(d));
  const near = pool.filter((c) => d(c) === best);
  const c = near[Math.floor(Math.random() * near.length)];
  return { x: c.x, z: c.z };
}

/**
 * A "?" site was an Unexploded Missile: it launches from the site into `target` (default: the nearest
 * building). The site stays empty ground. Notifies the tutorial once it has landed.
 */
function unexplodedMissile(site, target = nearestBuilding(site.x, site.z)) {
  dust.burst(site.x, site.z, 1.4);
  shake.amount = Math.min(shake.amount + 0.6, 1.2);
  if (!target) {
    // A dud: it stands up, wobbles, and falls over.
    const run = runId;
    const dud = missiles.showUpright(site.x, site.z);
    toast(L('Uncovered an Unexploded Missile... it fizzled into the sand', '发现一枚未爆导弹……它在沙地里哑火了'), 'good', 2400);
    setTimeout(() => run === runId && dud.topple(), 900);
    setTimeout(() => {
      dud.remove();
      if (run === runId) dust.burst(site.x, site.z, 1);
    }, 2600);
    return;
  }
  eventOpen = true;
  hand.select(-1);
  toast(L('Uncovered an Unexploded Missile!', '发现一枚未爆导弹！'), 'bad', 2400);
  groundStrike({ x: site.x, z: site.z }, target, (l) => L(`The unexploded missile destroyed your ${l}`, `未爆导弹摧毁了你的${l}`)).then((lost) => {
    if (lost && tutorial.active) tutorial.notify('missile');
  });
}

/** Reveals: real tiles drop in; missiles launch. `delay(i)` staggers the drops. Returns the tiles found. */
function landReveals(found, delay) {
  const tiles = found.filter((f) => f.terrain !== 'missile');
  tiles.forEach(({ x, z, terrain }, i) => addTile(x, z, terrain, delay(i)));
  for (const m of found.filter((f) => f.terrain === 'missile')) unexplodedMissile(m, m.target);
  return tiles;
}

/** Report line once the missiles have landed. */
function reportStrike(lost) {
  if (!lost.length) return;
  $('report').innerHTML += L(
    `<br /><span class="bad">Missile strike: your ${listLost(lost)} ${lost.length === 1 ? 'is now a Toxic Crater' : 'are now Toxic Craters'}.</span>`,
    `<br /><span class="bad">导弹打击：你的${listLost(lost)}已化为毒坑。</span>`,
  );
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
    if (lost.length) toast(() => L(`The Overlord's missiles destroyed your ${listLost(lost)}`, `霸主的导弹摧毁了你的${listLost(lost)}`), 'bad', 2600);
  });
  return `Missile strike: ${targets.length} missile${targets.length === 1 ? '' : 's'}`;
}

/**
 * Debug (console: tileIsland.debugRandomStrike()): a strike on random spots anywhere on the island, built on or
 * empty (the Capital only if Game Debug → Missiles → "Include the Capital" is on). Uses the preview's missile
 * count and its "Leave craters" setting.
 */
function debugRandomStrike() {
  if (tutorialBlocks()) return;
  if (turn.over) return toast(L('Game over: restart first', '游戏已结束：请先重新开始'));
  if (striking || shopOpen || eventOpen || payout.active) return toast(L('Finish the current screen first', '请先完成当前界面'));
  const cells = [...grid.cells.values()];
  const xs = cells.map((c) => c.x);
  const zs = cells.map((c) => c.z);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...zs) - 1, Math.max(...zs) + 1];
  const cap = mainCapital();
  const n = Math.max(1, Math.round(missileCfg.previewCount));
  const targets = [];
  const used = new Set();
  for (let tries = 0; targets.length < n && tries < 500; tries++) {
    const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1));
    const z = z0 + Math.floor(Math.random() * (z1 - z0 + 1));
    const k = plotKey(x, z);
    if (used.has(k) || (cap && x === cap.x && z === cap.z && missileCfg.previewCapital !== 'yes')) continue;
    used.add(k);
    targets.push({ x, z });
  }
  const run = runId;
  playMissileStrike(targets, { convert: missileCfg.previewCraters === 'yes' }).then((lost) => {
    if (run !== runId) return;
    eventOpen = false;
    updateHUD();
    if (lost.length) toast(() => L(`The Overlord's missiles destroyed your ${listLost(lost)}`, `霸主的导弹摧毁了你的${listLost(lost)}`), 'bad', 2600);
  });
}
// ---------- language (bottom left, above the music) ----------
// The button shows the language it switches to. Switching redraws what's on screen in the new language.
const showLangButton = () => ($('btnLang').textContent = isZh() ? 'EN' : '中文');
showLangButton();
/**
 * Next turn / Reroll hand: their label is the button's own first text node (every <span> in a .btn is styled as the
 * small sub-label), so only that text is swapped. English puts back the page's original text exactly.
 */
function labelMainButtons() {
  for (const [id, zh] of [
    ['btnNext', '下一回合'],
    ['btnReroll', '重抽手牌'],
  ]) {
    const node = $(id).firstChild;
    node.enText ??= node.nodeValue;
    node.nodeValue = isZh() ? node.enText.replace(node.enText.trim(), zh) : node.enText;
  }
}
labelMainButtons();
$('btnLang').addEventListener('click', () => {
  $('btnLang').blur(); // so Enter (end turn) does not fire it again
  toggleLang();
});
onLangChange(() => {
  showLangButton();
  labelMainButtons();
  updateHUD();
  hand.render();
  for (const btn of ruinBtns.values()) labelRuinBtn(btn);
  inspected = null; // the hovered tile's card is redrawn next frame
  if ($('toast').classList.contains('show')) $('toast').textContent = textOf(toastMsg);
});

// ---------- Pre-war Ruins ----------
/** Ruins can be cleared once a building stands on a side next to them (and, in expansion mode, they're in your territory). */
function canClearRuins(c) {
  return (
    !tutorial.active &&
    c.terrain === 'ruins' &&
    grid.allowed(c.x, c.z) &&
    DIRS.some(([dx, dz]) => isBuilding(grid.get(c.x + dx, c.z + dz)?.terrain))
  );
}

/** Clearing ruins empties the cell and tops the hand up to HAND_SIZE with random draws (unlocked cards only). */
function clearRuins(x, z) {
  const c = grid.get(x, z);
  if (!c || !canClearRuins(c) || turn.over || payout.active || shopOpen || eventOpen) return;
  removeMesh(c.mesh);
  grid.cells.delete(`${x},${z}`);
  const drawn = hand.refill(handSize());
  placement.cell = null;
  frontier.rebuild(grid);
  updateHUD();
  toast(
    drawn
      ? L(`Ruins cleared: salvaged ${drawn} new piece${drawn === 1 ? '' : 's'}`, `遗迹已清理：回收了 ${drawn} 个新板块`)
      : L('Ruins cleared (hand already full)', '遗迹已清理（手牌已满）'),
    'good',
  );
}

const ruinBtns = new Map(); // cell key -> button
const ruinV = new THREE.Vector3();
function labelRuinBtn(btn) {
  btn.textContent = L('Clear ruins', '清理遗迹');
  btn.title = L('Clear these ruins: refill your hand to 5 with random pieces', '清理这些遗迹：用随机板块把手牌补到 5 张');
}
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
      labelRuinBtn(btn);
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
      thud(Boolean(a.cells));
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
let toastMsg = ''; // a string or a function returning one: redrawn if the language changes while it shows
function toast(msg, kind = '', ms = 1600, sound = true) {
  const el = $('toast');
  toastMsg = msg;
  el.textContent = textOf(msg);
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), ms);
  if (!sound) return;
  if (kind === 'bad') deny();
  else if (kind === 'good') tick(true);
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

/**
 * Idle buildings (not enough workers) go fully grey, the building and the ground plate it stands on, and their
 * animation freezes (TileFactory.update skips tiles marked userData.idle).
 * The grey is a shader patch: each material gets one grey twin (made on first use, shared by every idle tile,
 * same textures), so no per-tile copies. A per-draw uniform on the shared material can't do it: three.js only
 * re-uploads a standard material's uniforms when the material changes between draws.
 */
const greyTwin = new Map(); // material -> its grey twin
const greyOrigin = new Map(); // grey twin -> material
const GREY_GLSL = '#include <color_fragment>\n  diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * 0.6;';
function greyOf(m) {
  if (greyOrigin.has(m)) return m;
  let g = greyTwin.get(m);
  if (!g) {
    g = copySeam(m, m.clone()); // keeps the seamless-ground patch, which a clone loses
    const before = g.onBeforeCompile;
    const key = g.customProgramCacheKey?.call(g) ?? '';
    g.onBeforeCompile = (shader, renderer) => {
      before?.call(g, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', GREY_GLSL);
    };
    g.customProgramCacheKey = () => `${key}|idle-grey`;
    if (g.emissive) g.emissiveIntensity = 0; // lit windows go dark
    greyTwin.set(m, g);
    greyOrigin.set(g, m);
  }
  return g;
}
const colourOf = (m) => greyOrigin.get(m) ?? m;
function setGrey(mesh, on) {
  if (Boolean(mesh.userData.idle) === on) return;
  mesh.userData.idle = on;
  const swap = on ? greyOf : colourOf;
  mesh.traverse((o) => {
    if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
function shadeIdle(e = economyNow()) {
  const idle = new Set();
  for (const p of e.perCell) if (p.idle) idle.add(`${p.x},${p.z}`);
  for (const cell of grid.cells.values()) if (cell.mesh) setGrey(cell.mesh, idle.has(`${cell.x},${cell.z}`));
  neonTiles.refresh(grid); // boosted buildings' tiles glow (not idle ones)
  zoomIcons.setBoosts(e.boosts); // the boosters' "+n" map icons
}

function updateHUD() {
  const n = grid.size;
  const quota = turn.quota;
  const left = yearLength() - 1 - turn.season;
  $('seasonLabel').textContent = L(
    `${turn.round === 0 ? 'Year 0 (tutorial)' : `Year ${turn.round}`} · ${SEASONS[turn.season]} · Tribute ${left ? `in ${left} season${left === 1 ? '' : 's'}` : `due this ${SEASONS[turn.season]}`}`,
    `${turn.round === 0 ? '第 0 年（教程）' : `第 ${turn.round} 年`} · ${SEASONS[turn.season]} · ${left ? `${left} 季后缴纳贡品` : '本季缴纳贡品'}`,
  );
  const ev = turn.event;
  $('eventLabel').classList.toggle('hidden', !ev);
  if (ev) {
    // Hover card: what the event does and how long it lasts.
    $('eventLabel').innerHTML =
      `${L('Year event: ', '年度事件：')}<b>${ev.name}</b>` +
      `<div class="event-tip">` +
      `<div class="event-tip-kind">${KIND_LABEL[ev.kind]}</div>` +
      `<div class="event-tip-name">${ev.name}</div>` +
      `<div class="event-tip-text">${iconize(ev.summary)}</div>` +
      `<div class="event-tip-foot">${L(`Lasts until this year's tribute (after ${SEASONS[yearLength() - 1]}).`, `持续到今年缴纳贡品（${SEASONS[yearLength() - 1]}季之后）。`)}</div>` +
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
      `${L('Target: ', '目标：')}<b>${t.label}</b>` +
      `<div class="event-tip">` +
      `<div class="event-tip-kind">${L('Tribute target', '贡品目标')}</div>` +
      `<div class="event-tip-name">${t.label} · ${L(`${Math.round(t.mult * 100)}% of ${turn.quotaBase}`, `${turn.quotaBase} 的 ${Math.round(t.mult * 100)}%`)}</div>` +
      `<div class="event-tip-text">${L(`Tribute this year: ${turn.quota} oil.`, `今年贡品：${turn.quota} 石油。`)}<br />${r ? `${L('Reward if met: ', '达成奖励：')}${iconize(r.text)}` : L('No reward.', '无奖励。')}</div>` +
      `<div class="event-tip-foot">${
        turn.lowStreak >= LOW_STREAK_LIMIT
          ? L('Next year the Overlord forces a High target.', '明年霸主将强制设定高目标。')
          : turn.lowStreak
            ? L(`Low targets in a row: ${turn.lowStreak} of ${LOW_STREAK_LIMIT}.`, `已连续选择低目标：${turn.lowStreak} / ${LOW_STREAK_LIMIT}。`)
            : L('Rewards are lost if the tribute is missed.', '若未缴足贡品，奖励作废。')
      }</div>` +
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
  $('resMpD').textContent = e.idle ? L(`(${e.idle} idle)`, `(${e.idle} 闲置)`) : '';
  $('resMpD').className = e.idle ? 'down' : '';
  shadeIdle(e);
  // Oil: big number = the stockpile (the Overlord takes it all after Winter), small = this season's yield.
  $('resOilD').textContent = `(+${e.oil})`;
  $('resOilD').className = e.oil > 0 ? 'up' : '';

  // Food stores: excess food banked for lean seasons (capacity from the Capitals).
  showStore(turn.food, e.foodCap);

  $('btnReroll').classList.toggle('hidden', hand.isEmpty);
  $('btnReroll').classList.toggle('disabled', !turn.freeRerolls && turn.stockpile < rerollCost());
  $('btnRerollSub').innerHTML = turn.freeRerolls ? L(`free ×${turn.freeRerolls}`, `免费 ×${turn.freeRerolls}`) : `-${rerollCost()}${ICONS.oil}`;
  // Greyed out while Wasteland that still fits must be placed (endTurn refuses then, with a toast).
  const blocking = hand.placeableForced.length;
  $('btnNext').classList.toggle('disabled', blocking > 0);
  $('btnNextSub').textContent =
    turn.season === yearLength() - 1
      ? L(`collect oil, pay ${quota} tribute`, `采油，缴纳 ${quota} 桶贡品`)
      : '';
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

  const nm = (t) => TERRAINS[t].name; // Chinese labels use the tile names
  if (kind === 'food') {
    add(L(`Hydro-farms ×${c('farm')}`, `${nm('farm')} ×${c('farm')}`), 2 * c('farm'));
    add(L(`Pump bonus ×${e.bonus.pumpFarms}`, `${nm('pump')}加成 ×${e.bonus.pumpFarms}`), 2 * e.bonus.pumpFarms);
    add(L(`Oasis bonus ×${e.bonus.oasisFarms}`, `${nm('oasis')}加成 ×${e.bonus.oasisFarms}`), 3 * e.bonus.oasisFarms);
    add(L('Capital doubles', `${nm('capital')}翻倍`), e.bonus.capitalFood);
    if (turn.event) add(turn.event.name, e.eventFood);
    if (e.droughtFood)
      note(L(`Drought: pumps and oases give nothing (-${e.droughtFood} food)`, `干旱：${nm('pump')}和${nm('oasis')}没有产出（-${e.droughtFood} 食物）`));
    total(L('Grown', '产出'), Math.round(e.foodGrown));
    add(L('Capital eats', `${nm('capital')}消耗`), -3 * c('capital'));
    add(L(`Settlements ×${c('settlement')}`, `${nm('settlement')} ×${c('settlement')}`), -2 * c('settlement'));
    add(L(`Population ×${e.population}`, `人口 ×${e.population}`), -e.popFood);
    if (turn.event) add(turn.event.name, -e.eventUpkeep - e.mods.foodUpkeep);
    add(L('Toxic craters', nm('crater')), -e.craterFood);
    add(L(`Scavenger camps ×${c('bandit_scav')}`, `${nm('bandit_scav')} ×${c('bandit_scav')}`), -e.banditFood);
    total(L('Balance', '结余'), signed(Math.round(e.foodBalance)));
    if (e.foodBalance < 0) {
      note(
        e.fed < 1
          ? L(`Store can't cover it: people go hungry, stations run at ${pct(e.fed)}`, `粮仓不够填补：人们在挨饿，${nm('station')}只能以 ${pct(e.fed)} 运转`)
          : L(`Shortfall covered from the store (${e.foodStore})`, `缺口由粮仓补足（${e.foodStore}）`),
      );
    }
    note(L(`Stores ${e.foodStore} → ${e.storeAfter} / ${e.foodCap}`, `粮仓 ${e.foodStore} → ${e.storeAfter} / ${e.foodCap}`));
    if (e.foodWasted) note(L(`${e.foodWasted} food wasted (stores full)`, `浪费了 ${e.foodWasted} 食物（粮仓已满）`));
    if (rebelsRise(e)) note(L('Stores empty: rebels will rise', '粮仓已空：叛军即将起事'));
  } else if (kind === 'mp') {
    add(L('Capital', nm('capital')), 4 * c('capital'));
    add(L(`Settlements ×${c('settlement')}`, `${nm('settlement')} ×${c('settlement')}`), 2 * c('settlement'));
    add(L('Built on ruins', `建在${nm('ruins')}上`), e.bonus.ruins);
    add(L('Labour camps', nm('labourcamp')), e.bonus.labourCamps);
    add(L('Taxed settlements', `被征税的${nm('settlement')}`), e.taxSlots);
    add(L(`Population`, '人口'), e.population);
    add(L('Toxic craters', nm('crater')), -e.craterManpower);
    add(L(`Raider camps ×${c('raider') + c('bandit_raider')}`, `${nm('raider')} ×${c('raider') + c('bandit_raider')}`), -e.raiderManpower);
    if (turn.event) add(turn.event.name, e.eventCap + e.mods.capDelta);
    total(L('Worker slots', '人力总数'), e.cap);
    add(L(`Hydro-farms ×${c('farm')}`, `${nm('farm')} ×${c('farm')}`), -c('farm'));
    add(L(`Stations ×${c('station')}`, `${nm('station')} ×${c('station')}`), -c('station'));
    add(L(`Refineries ×${c('refinery')}`, `${nm('refinery')} ×${c('refinery')}`), -c('refinery'));
    total(e.idle ? L('Idle', '闲置') : L('Free', '空闲'), e.idle ? e.idle : e.free);
    note(
      e.idle
        ? L(
            `Not enough workers: your ${e.idle} newest building${e.idle === 1 ? '' : 's'} sit idle and produce nothing`,
            `人力不足：你最新建造的 ${e.idle} 座建筑处于闲置，没有任何产出`,
          )
        : L('Each farm, station and refinery needs 1 worker. Housing raises the cap.', '每座农场、采油站和炼油厂各需 1 人力。住房能提高上限。'),
    );
  } else {
    add(L(`Stations ×${c('station')}`, `${nm('station')} ×${c('station')}`), 2 * c('station'));
    add(L(`Tar pit bonus ×${e.bonus.tarpitStations}`, `${nm('tarpit')}加成 ×${e.bonus.tarpitStations}`), 2 * e.bonus.tarpitStations);
    add(L('Capital doubles', `${nm('capital')}翻倍`), e.bonus.capitalCrude);
    if (turn.event) add(turn.event.name, e.eventCrude);
    add(
      L(`Refineries (${e.refineryLinks} adjacent station${e.refineryLinks === 1 ? '' : 's'})`, `${nm('refinery')}（${e.refineryLinks} 座相邻${nm('station')}）`),
      e.refineryCrude,
    );
    total(L('Crude', '原油'), e.crude);
    mul(L('Hunger', '饥饿'), e.fed);
    add(L('Settlement tax', `${nm('settlement')}税收`), e.taxOil);
    add(L(`Siphoner camps ×${c('bandit_siphon')}`, `${nm('bandit_siphon')} ×${c('bandit_siphon')}`), -e.oilStolen);
    total(L('This season', '本季'), signed(e.oil));
    const theft = Math.min(turn.stockpile + e.oil, e.stockpileTheft);
    add(L(`Smuggler dens ×${c('bandit_smuggle')}`, `${nm('bandit_smuggle')} ×${c('bandit_smuggle')}`), -theft);
    note(
      L(
        `Stockpile ${turn.stockpile} → ${turn.stockpile + e.oil - theft} / ${turn.quota} tribute`,
        `石油库存 ${turn.stockpile} → ${turn.stockpile + e.oil - theft} / 贡品 ${turn.quota}`,
      ),
    );
    note(L(`The Overlord takes all of it after ${SEASONS[yearLength() - 1]}.`, `${SEASONS[yearLength() - 1]}季结束后，霸主会全部拿走。`));
  }
  return rows;
}

function renderResTip(e = economyNow()) {
  const rows = breakdown(tipKind, e);
  $('resTip').innerHTML =
    `<div class="title">${L('How this season adds up', '本季收支明细')}</div>` +
    (rows.length ? '' : `<div class="row note">${L('Nothing yet', '暂无')}</div>`) +
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
    notes.push(
      L(
        `Built on Pre-war Ruins: +${c.terrain === 'settlement' ? 2 : 1} worker slot${c.terrain === 'settlement' ? 's' : ''}`,
        `建在${TERRAINS.ruins.name}上：+${c.terrain === 'settlement' ? 2 : 1} 人力`,
      ),
    );
  if (economyNow().perCell.find((p) => p.x === c.x && p.z === c.z)?.idle)
    notes.push(L('Idle: no free workers. Build housing to staff it.', '闲置：没有空闲人力。建造住房来为它配备人手。'));
  if (c.terrain === 'raider')
    notes.push(
      L(
        'Unhappy citizens. Fix the food shortage to drive them off (one camp leaves per fed season), or Send in the Militia.',
        `不满的民众。解决食物短缺即可赶走他们（每个吃饱的季节撤走一座营地），或者${cardDef('militia').name}。`,
      ),
    );
  if (t.bandit)
    notes.push(
      L(
        'Bandits drawn by a 3×3 block of Wasteland. They stay until you Send in the Militia.',
        `被 3×3 荒地区域引来的匪徒。在你${cardDef('militia').name}之前，他们不会离开。`,
      ),
    );
  if (isCamp(c.terrain)) notes.push(L(`Right now: ${campEffect(c.terrain)}`, `当前：${campEffect(c.terrain)}`));
  if (t.buildable) notes.push(L('A building can be placed on top of this tile', '可以在这个地块上放置建筑'));
  const KINDS = { building: L('building', '建筑'), land: L('land', '地形'), junk: L('junk', '废料') };
  el.innerHTML = `
    <div class="card-slot"><div class="card-big">
      <div class="art">${cardArtHTML(c.terrain)}</div>
      ${snapHTML(t)}
      <div class="name">${t.name}</div>
      <div class="rule">${cardText(t)}</div>
      <div class="kind">${KINDS[t.category] ?? t.category}</div>
    </div></div>
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
  if (!tutorial.allows('endTurn')) return tutorial.nudge();
  // Wasteland must be placed first, but only if it fits somewhere; if there's no room, the turn can end.
  const blocking = hand.placeableForced.length;
  if (blocking) {
    toast(L(`Place your Wasteland first (${blocking} left in hand)`, `请先放置荒地（手牌中还剩 ${blocking} 张）`), 'bad');
    return;
  }
  hand.select(-1);
  tutorial.notify('endTurn');
  const e = economyNow();
  runPayout(e, () => settleTurn(e));
}

/** Debug (Space): play the payout sequence without ending the turn or changing anything. */
let previewing = false;
function previewPayout() {
  if (tutorialBlocks()) return;
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
    L(`Food stores ${shown} / ${cap}`, `粮仓 ${shown} / ${cap}`) +
    (turn.population ? L(` · population ${turn.population}`, ` · 人口 ${turn.population}`) : '');
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
  $('quotaCount').textContent = L(`${amount} / ${quota} barrels`, `${amount} / ${quota} 桶`);
  $('quotaFill').style.width = `${Math.min(1, amount / quota) * 100}%`;
  $('quotaFill').classList.toggle('met', amount >= quota);
  if (bump) {
    pop($('oilStock'));
    pop($('quotaCount'));
  }
}

/** One blip per hopping tile: oil, food, or a quiet thud when the tile only marks unrest or idle. */
function chimeTile(tile) {
  if (tile.oil) coin();
  if (tile.food) food();
  if (!tile.oil && !tile.food) thud();
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
  confirm();
  payout.start(
    tiles,
    (tile) => {
      chimeTile(tile);
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
    text = L('Raiders made camp on open ground.', '掠夺者在空地上扎了营。');
  } else if (waste.length) {
    ({ x, z } = pick(waste));
    text = L('Raiders made camp in the wasteland.', '掠夺者在荒地中扎了营。');
  } else if (buildings.length) {
    ({ x, z } = pick(buildings));
    const razed = grid.get(x, z).terrain;
    text = both(() => L(`Raiders razed your ${TERRAINS[razed].name} and made camp.`, `掠夺者夷平了你的${TERRAINS[razed].name}，就地扎营。`));
  } else return null;
  addTile(x, z, 'raider');
  grid.get(x, z).onRuins = false;
  // Getters: the camp's text in the current language whenever it's read (a scene may show it after a switch).
  spawnRaider.last = {
    x,
    z,
    get effect() {
      return campEffect('raider');
    },
  };
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
    spawned.push({
      x,
      z,
      kind,
      get name() {
        return TERRAINS[kind].name;
      },
      get effect() {
        return campEffect(kind);
      },
    });
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
  toast(L(`The militia cleared the ${name}`, `民兵清除了${name}`), 'good');
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
    return L(`-${LEADER_COSTS.crushPopulation} population`, `-${LEADER_COSTS.crushPopulation} 人口`);
  }
  const lost = Math.min(turn.food, LEADER_COSTS.crushFoodFallback);
  turn.food -= lost;
  return lost ? L(`-${lost} food`, `-${lost} 食物`) : L('no survivors to spare', '已无幸存者可供牺牲');
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

/** `reason`: a function returning the text, so it can be redrawn after a language switch. */
let gameOverReason = null;
function gameOver(reason) {
  turn.over = true;
  hand.select(-1);
  gameOverReason = reason;
  showGameOver();
  $('gameover').classList.remove('hidden');
  doom();
}

function showGameOver() {
  $('gameoverReason').textContent = typeof gameOverReason === 'function' ? gameOverReason() : (gameOverReason ?? '');
  $('gameoverStats').textContent = L(
    `Survived to ${SEASONS[turn.season]}, year ${turn.round} · ${turn.total} barrels delivered in total`,
    `坚持到第 ${turn.round} 年${SEASONS[turn.season]} · 共上交 ${turn.total} 桶`,
  );
}

function settleTurn(e) {
  // The year ends after Winter, or early as soon as this season's oil meets the quota.
  // Smuggler dens take a share of the stockpile (after this season's oil arrives).
  const stolen = Math.min(turn.stockpile + e.oil, e.stockpileTheft);
  // The tutorial year always runs to Winter (it never meets the quota early anyway).
  const tut = tutorial.active;
  let yearEnds = turn.season >= yearLength() - 1 || (!tut && turn.stockpile + e.oil - stolen >= turn.quota);
  // Text below is built in the current language when shown (functions), so the toast follows a language switch.
  const season = turn.season;
  const round = turn.round;
  const label = () => L(`${SEASONS[season]}, year ${round}`, `第 ${round} 年${SEASONS[season]}`);
  turn.stockpile += e.oil - stolen;
  turn.total += e.oil;
  turn.food = e.storeAfter;

  const sgn = (n) => {
    const r = Math.round(n);
    return r > 0 ? `+${r}` : `${r}`;
  };
  const tag = (n) => `<span class="${Math.round(n) < 0 ? 'bad' : 'good'}">${sgn(n)}</span>`;
  const lines = [
    `<b>${label()}</b>`,
    L(
      `Food ${tag(e.foodBalance)} · Free workers ${e.free}/${e.cap}${e.idle ? ` <span class="bad">(${e.idle} idle)</span>` : ''} · Oil ${tag(e.oil)}`,
      `食物 ${tag(e.foodBalance)} · 空闲人力 ${e.free}/${e.cap}${e.idle ? ` <span class="bad">（${e.idle} 闲置）</span>` : ''} · 石油 ${tag(e.oil)}`,
    ),
  ];
  // The toast: parts that are each one L() sentence (switchable as they are) or a function.
  const msg = [() => L(`${label()}: +${e.oil} oil`, `${label()}：+${e.oil} 石油`)];
  let kind = 'good';
  if (e.foodWasted)
    lines.push(`<span class="bad">${L(`The stores are full: ${e.foodWasted} food spoiled.`, `粮仓已满：${e.foodWasted} 食物腐坏了。`)}</span>`);

  // Bandits already camped: what they took this season.
  if (e.oilStolen)
    lines.push(`<span class="bad">${L(`Siphoners drained ${e.oilStolen} oil from your pipelines.`, `窃油者从你的输油管里抽走了 ${e.oilStolen} 石油。`)}</span>`);
  if (e.banditFood) lines.push(`<span class="bad">${L(`Scavengers stole ${e.banditFood} food.`, `拾荒者偷走了 ${e.banditFood} 食物。`)}</span>`);
  if (stolen) {
    lines.push(`<span class="bad">${L(`Smugglers made off with ${stolen} barrels from the stockpile.`, `走私者从石油库存中卷走了 ${stolen} 桶。`)}</span>`);
    msg.push(L(` · Smugglers stole ${stolen}`, ` · 走私者偷走 ${stolen} 桶`));
    kind = 'bad';
  }
  // A full 3×3 block of Wasteland draws a new bandit camp. (Not in the scripted tutorial.)
  for (const camp of tut ? [] : spawnBandits()) {
    queueScene('bandit', camp);
    lines.push(`<span class="bad">${L(`Bandits settled the wasteland: ${camp.name} (${camp.effect}).`, `匪徒占据了荒地：${camp.name}（${camp.effect}）。`)}</span>`);
    msg.push(() => L(` · Bandits: ${TERRAINS[camp.kind].name}!`, ` · 匪患：${TERRAINS[camp.kind].name}！`));
    kind = 'bad';
  }

  // Rebels: a season with a food surplus drives one camp off; a season that ends with
  // no food at all (net ≤ 0 and empty stores) brings a new camp, in place for the next season.
  if (!tut && Math.round(e.foodBalance) > 0 && departRaider()) {
    lines.push(`<span class="good">${L('Your people are fed: a raider camp packed up and left.', '你的子民吃饱了：一座掠夺者营地拔营离去。')}</span>`);
    msg.push(L(' · Raiders left', ' · 掠夺者已离去'));
  }
  if (!tut && rebelsRise(e)) {
    const raid = spawnRaider();
    if (raid) {
      queueScene('rebel', spawnRaider.last);
      lines.push(
        `<span class="bad">${L(
          `The food ran out and the people turned on you. ${raid} (${spawnRaider.last.effect})`,
          `粮食耗尽，民众反了你。${raid}（${spawnRaider.last.effect}）`,
        )}</span>`,
      );
      msg.push(L(' · Starvation: raiders arrived!', ' · 饥荒：掠夺者来了！'));
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
  // Year 0: next scripted season, or (after Winter) the Overlord's judgement. No quota growth, shop or strikes flow.
  if (tut) {
    $('report').innerHTML = lines.join('<br />');
    if (!yearEnds) {
      turn.season++;
      toast(() => msg.map(textOf).join(''), kind, 3200);
      dealNewHand();
      return;
    }
    const quota = turn.quota;
    const delivered = turn.stockpile;
    turn.stockpile = 0;
    playPredecessorJudgement({ quota, delivered });
    return;
  }
  // Tribute at the end of the year (after Winter, or early once the quota is met).
  let failure = null; // set when the tribute is missed: the Overlord comes to speak instead of the shop
  if (yearEnds) {
    if (turn.season < yearLength() - 1) {
      lines.push(
        `<span class="good">${L(`Quota met in ${SEASONS[turn.season]}: the year ends early.`, `${SEASONS[turn.season]}季便已完成配额：本年提前结束。`)}</span>`,
      );
      msg.push(L(` · Quota met early: skipping to the next year.`, ` · 提前完成配额：直接进入下一年。`));
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
    turn.shopMult = turn.event?.mods?.shopMult ?? 1; // Black Market Caravan: this tribute's shop
    turn.event = null;
    turn.target = null;
    const rise = turn.quotaBase - prevBase;
    if (met) {
      const seized = L(
        `Tribute of ${quota} met. The Overlord seized all ${delivered} barrels.`,
        `${quota} 桶贡品已缴足。霸主收走了全部 ${delivered} 桶。`,
      );
      lines.push(`<span class="good">${seized}</span>`);
      msg.push(' · ', seized);
      if (reward) {
        const extra = reward.grant?.({ turn }) ?? '';
        clampFood();
        const tier = TIERS[target.tier].label;
        lines.push(
          `<span class="good">${L(
            `${tier} target met: reward earned (${iconize(reward.text)}). ${extra}`,
            `已达成${tier}目标：获得奖励（${iconize(reward.text)}）。${extra}`,
          )}</span>`,
        );
        msg.push(() => L(` · Target reward: ${reward.text}`, ` · 目标奖励：${reward.text}`));
      }
    } else {
      if (target?.reward) {
        const tier = TIERS[target.tier].label;
        const lost = iconize(REWARDS[target.reward].text);
        lines.push(
          `<span class="bad">${L(`${tier} target missed: the reward (${lost}) is lost.`, `未达成${tier}目标：奖励（${lost}）作废。`)}</span>`,
        );
      }
      const short = quota - delivered;
      turn.strikes++;
      // The missiles themselves fly during the Overlord's speech (playTributeFailure).
      const count = strikeCount(turn.strikes);
      const launched = () =>
        L(`The Overlord launched ${count} missile${count === 1 ? '' : 's'} at your city.`, `霸主向你的城市发射了 ${count} 枚导弹。`);
      lines.push(`<span class="bad">${L(`Tribute short by ${short}.`, `贡品短缺 ${short} 桶。`)} ${launched()}</span>`);
      msg.push(() => L(` · Tribute short by ${short}! ${launched()}`, ` · 贡品短缺 ${short} 桶！${launched()}`));
      kind = 'bad';
      failure = { quota, delivered, short, missiles: count, nextQuota: turn.quota };
    }
    const greed = delivered > quota ? L("Your excess whetted the Overlord's appetite. ", '你的盈余吊起了霸主的胃口。') : '';
    const next = L(`Next base tribute: ${turn.quota} (+${rise}).`, `下一年基础贡品：${turn.quota}（+${rise}）。`);
    lines.push(`<span class="bad">${greed}${next}</span>`);
    msg.push(' · ', greed, next);
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
        gameOver(() =>
          L(
            "Three tributes missed. The Overlord's missiles have turned your Hive City into a toxic crater.",
            '三次未缴足贡品。霸主的导弹已将你的蜂巢城化为一片毒坑。',
          ),
        );
      } else startNewYear(dealNewHand, { continued: true });
    });
    return;
  }

  if (turn.strikes >= MAX_STRIKES) {
    showStrikes(true);
    gameOver(() =>
      L('Three tributes missed. The Overlord has lost his patience and razed your city.', '三次未缴足贡品。霸主耐心耗尽，夷平了你的城市。'),
    );
    return;
  }

  turn.season = yearEnds ? 0 : turn.season + 1;
  if (yearEnds) turn.round++;
  toast(() => msg.map(textOf).join(''), kind, 3200);
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
  return L(
    `${q} oil (${pct}%) · ${reward ? `reward: ${iconize(REWARDS[reward].text)}` : 'no reward'}`,
    `${q} 石油（${pct}%） · ${reward ? `奖励：${iconize(REWARDS[reward].text)}` : '无奖励'}`,
  );
}

async function playTargetDialogue(offers, { forced, continued, gifted }) {
  const OVERLORD = 'The Overlord';
  dialogue.allowSkip(false); // the player has to hear the terms and name the target
  const pleased = !turn.lastMissed;
  const base = turn.quotaBase;
  dialogue.open({
    kind: forced ? 'pressure' : 'choice',
    kindLabel: L(`Year ${turn.round} · tribute target`, `第 ${turn.round} 年 · 贡品目标`),
    title: forced
      ? L('No More Excuses', '休想再找借口')
      : pleased
        ? L('The Overlord Is Pleased', '霸主很满意')
        : L('A Chance to Redeem Yourself', '将功赎罪的机会'),
    effect: forced
      ? L(
          `${LOW_STREAK_LIMIT} low targets in a row: this year's target is forced to High.`,
          `已连续 ${LOW_STREAK_LIMIT} 次选择低目标：今年被强制定为高目标。`,
        )
      : L(`Base tribute ${base} oil · rewards are paid only if the target is met.`, `基础贡品 ${base} 石油 · 只有达成目标才发放奖励。`),
  });
  let lines;
  let ask;
  if (forced) {
    lines = [
      continued
        ? L(
            `And do not think I have forgotten your ${LOW_STREAK_LIMIT} timid little targets in a row.`,
            `也别以为我忘了你接连 ${LOW_STREAK_LIMIT} 次定下的那些畏畏缩缩的小目标。`,
          )
        : L(
            `${LOW_STREAK_LIMIT} years of timid little targets, Overseer. Did you think I would not notice?`,
            `连续 ${LOW_STREAK_LIMIT} 年都是畏畏缩缩的小目标，总督。你以为我不会察觉吗？`,
          ),
      L('My legions do not march on modest ambitions.', '我的军团可不会为这点微末的野心出征。'),
    ];
    ask = L(
      `This year you will give me ${scaledQuota(base, 'high')} barrels. I am not asking.`,
      `今年你要给我 ${scaledQuota(base, 'high')} 桶。这不是在跟你商量。`,
    );
  } else if (pleased) {
    lines = [
      gifted
        ? L('I trust my gift will serve you well, Overseer.', '相信我的赏赐会让你物尽其用，总督。')
        : L('Your harvest reached my tanks in full. I am... pleased, Overseer.', '你的收成如数灌进了我的油罐。我……很满意，总督。'),
      L(
        `My clerks reckon ${base} barrels for the coming year. But a loyal servant may name his own target.`,
        `我的书记官估算来年需 ${base} 桶。不过，忠仆可以自己定下目标。`,
      ),
    ];
    ask = L(
      'Promise me less and play it safe, or promise me more and be rewarded. Choose.',
      '少许诺些以求稳妥，或多许诺些以博赏赐。选吧。',
    );
  } else {
    lines = [
      continued
        ? L('Still. I have some use for you yet.', '不过，你对我还有点用处。')
        : L('You failed me, and yet here you stand.', '你辜负了我，却还敢站在这里。'),
      L(
        `My clerks reckon ${base} barrels for the coming year. Perhaps you wish to prove them wrong.`,
        `我的书记官估算来年需 ${base} 桶。也许你想证明他们算错了。`,
      ),
    ];
    ask = L(
      'Name your target, Overseer. Promise little and keep your head, or promise more and earn back my favour.',
      '说出你的目标，总督。少许诺，保住你的脑袋；或多许诺，赢回我的恩宠。',
    );
  }
  for (const line of lines) await dialogue.say(OVERLORD, line);
  // Functions: rebuilt in the new language if it changes while the choices are up.
  const options = forced
    ? [{ text: L('As you command, Overlord.', '遵命，霸主。'), tag: () => targetTag(offers[0]) }]
    : offers.map((o) => ({ text: () => `${TIERS[o.tier].label}${L(': ', '：')}${TIERS[o.tier].say}`, tag: () => targetTag(o) }));
  const i = await dialogue.ask(OVERLORD, ask, options);
  const picked = offers[i];
  await dialogue.say(OVERLORD, () =>
    forced ? L('Good. Do not make me regret indulging you all these years.', '很好。别让我后悔这些年对你的纵容。') : TIERS[picked.tier].retort,
  );
  return picked;
}

function applyTarget({ tier, reward }) {
  turn.target = { tier, reward };
  turn.quota = scaledQuota(turn.quotaBase, tier);
  turn.lowStreak = tier === 'low' ? turn.lowStreak + 1 : 0;
  const rewardText = reward ? L(`Reward if met: ${REWARDS[reward].text}.`, `达成奖励：${REWARDS[reward].text}。`) : L('No reward.', '无奖励。');
  const cls = tier === 'low' ? '' : 'good';
  const set = L(
    `Target set: <b>${TIERS[tier].label}</b>, tribute ${turn.quota} oil. `,
    `目标已定：<b>${TIERS[tier].label}</b>，贡品 ${turn.quota} 石油。`,
  );
  $('report').innerHTML = `${$('report').innerHTML}<br /><span class="${cls}">${set}${iconize(rewardText)}</span>`;
  updateHUD();
}

/**
 * Draw this year's event (none in year 1), show it, apply the result, then continue.
 * `continued`: the Overlord is already talking (target dialogue), so the event follows on from it
 * and he leaves at the end either way.
 */
async function startYearEvent(then, { continued = false, force = null } = {}) {
  const key = force ?? drawEvent(turn, { kinds: turn.forceFortune ? ['fortune'] : undefined, info: eventInfo() });
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
  const later = applyYearEvent(key, ev, choice);
  for (const fn of later) await fn(); // e.g. Show of Force: the missile cinematic (board stays locked)
  eventOpen = false;
  await playPendingScenes(); // turned-away refugees: the Rebel Leader speaks
  then();
}

/** After the new-year talk: a reminder of the target just set (toasts are hidden during dialogue). */
function targetToast() {
  const tg = turn.target;
  if (!tg || turn.season !== 0) return;
  const r = tg.reward ? REWARDS[tg.reward] : null;
  const quota = turn.quota;
  toast(
    () => {
      const label = TIERS[tg.tier].label;
      return L(
        `${label} target: ${quota} oil${r ? ` · reward: ${r.text}` : ''}`,
        `${label}目标：${quota} 石油${r ? ` · 奖励：${r.text}` : ''}`,
      );
    },
    'good',
    3200,
  );
}

/** What the Overlord says to move on from the target to the year's event. */
const EVENT_BRIDGE = () => ({
  pressure: L('One more thing, Overseer. My demands have grown this year.', '还有一件事，总督。今年我的胃口更大了。'),
  disaster: L(
    'Before you scurry off. There is news from your city, and you will not like it.',
    '先别急着溜走。你的城里传来了消息，你不会喜欢的。',
  ),
  fortune: L('And before you go: some news that may even please you.', '走之前，还有个消息，说不定会让你高兴。'),
  choice: L('One more thing. A matter for you to decide.', '还有一件事，要由你来定夺。'),
});

/**
 * The Overlord announces the event. His last line comes with your replies: for choice events
 * those are the real options (with their effect in the tag), otherwise flavour that he answers.
 * The dialogue is left open; the caller closes it.
 */
async function playEventDialogue(key, ev, continued = false) {
  const OVERLORD = 'The Overlord';
  dialogue.allowSkip(true);
  // Every text is a function, so it's rebuilt in the new language if the language changes while it's on screen.
  dialogue.open({
    kind: ev.kind,
    kindLabel: () => `${L('Year event', '年度事件')} · ${KIND_LABEL[ev.kind]}`,
    title: () => ev.name,
    effect: () => iconize(ev.choices ? L('Your answer decides what happens.', '你的回答将决定后果。') : eventText(key)),
  });
  const { p } = eventSetup(key);
  const bridge = () => EVENT_BRIDGE()[ev.kind];
  if (continued && bridge()) await dialogue.say(OVERLORD, bridge);
  const lines = () => {
    const evLines = typeof ev.lines === 'function' ? ev.lines(p) : ev.lines;
    return evLines?.length ? evLines : [eventText(key)];
  };
  const n = lines().length;
  for (let k = 0; k < n - 1; k++) await dialogue.say(OVERLORD, () => lines()[k]);
  const options = ev.choices
    ? ev.choices.map((c, ci) => {
        const { mods } = eventSetup(key, ci);
        const info = eventInfo();
        const off = c.disabled?.(info);
        return {
          text: () => ev.choices[ci].say ?? ev.choices[ci].label,
          tag: () => (off ? L('not possible', '无法选择') : iconize(ev.choices[ci].text(p, previewEconomy(mods), info))),
          disabled: off,
        };
      })
    : (ev.replies ?? [{ say: L('Understood.', '明白。') }]).map((r, ri) => ({ text: () => ev.replies?.[ri]?.say ?? L('Understood.', '明白。') }));
  const i = await dialogue.ask(OVERLORD, () => lines()[n - 1], options);
  const retort = () => (ev.choices ? ev.choices[i] : ev.replies?.[i])?.retort;
  if (retort()) await dialogue.say(OVERLORD, retort);
  return ev.choices ? i : -1;
}

function applyYearEvent(key, ev, choiceIdx) {
  const { mods, choice, p } = eventSetup(key, choiceIdx);
  // Mods and text are worked out live from this year's strength (the Scaling sliders apply at once);
  // the board counts in the text are frozen as they were when the event started.
  const round = turn.round;
  const info = eventInfo();
  turn.event = {
    key,
    choiceIdx,
    round,
    get name() {
      return ev.name;
    },
    kind: ev.kind,
    get mods() {
      return eventSetup(key, choiceIdx, round).mods;
    },
    get summary() {
      return eventText(key, choiceIdx, round, info);
    },
  };
  const summary = turn.event.summary;
  // Scales this year's (already target-scaled) quota; next year still grows from turn.quotaBase.
  if (mods.quotaMult) turn.quota = Math.round(turn.quota * mods.quotaMult);
  const later = []; // async follow-ups the caller awaits (cinematics)
  const ctx = {
    turn,
    p,
    info,
    spawnRaider: () => {
      const raid = spawnRaider();
      if (!raid) return null;
      queueScene('rebel', spawnRaider.last);
      const last = spawnRaider.last;
      return {
        text: raid,
        get effect() {
          return last.effect;
        },
      };
    },
    clearAllCamps: () => {
      const camps = [...grid.cells.values()].filter((c) => isCamp(c.terrain));
      camps.forEach((c) => clearCamp(c.x, c.z));
      return camps.length;
    },
    prospect: () => {
      const found = mysteries.revealNearest([...grid.cells.values()].map((c) => [c.x, c.z]));
      if (!found) return '';
      if (found.terrain === 'missile') {
        later.push(async () => unexplodedMissile(found));
        return L('The map led you to an Unexploded Missile.', '地图把你引向了一枚未爆导弹。');
      }
      addTile(found.x, found.z, found.terrain, 0.25);
      frontier.rebuild(grid);
      return both(() => L(`The map led you to a ${TERRAINS[found.terrain].name}.`, `地图把你引向了一处${TERRAINS[found.terrain].name}。`));
    },
    earthquake: () => {
      const cells = shuffled(emptyEdgeCells()).slice(0, Math.round(SCALE.earthquakeCliffs));
      cells.forEach(([x, z], i) => {
        addTile(x, z, 'cliffs', 0.2 + i * 0.15);
        dust.burst(x, z, 1.2);
      });
      shake.amount = Math.min(shake.amount + 0.8, 1.2);
      placement.cell = null;
      frontier.rebuild(grid);
      return cells.length
        ? L(`${cells.length} cell${cells.length === 1 ? '' : 's'} turned into Cliffs.`, `${cells.length} 个格子变成了悬崖。`)
        : '';
    },
    showOfForce: () => {
      // Ruins surface on an empty cell next to your land; a missile from their silo hits a building.
      const [spot] = shuffled(emptyEdgeCells());
      const [target] = pickStrikeTargets(1);
      if (!spot || !target) return '';
      addTile(spot[0], spot[1], 'ruins', 0.1);
      dust.burst(spot[0], spot[1], 1.4);
      frontier.rebuild(grid);
      later.push(() => groundStrike({ x: spot[0], z: spot[1] }, target));
      return L('Pre-war Ruins surfaced, and their missile launched.', '战前遗迹破土而出，其中的导弹随即发射。');
    },
  };
  const extraParts = [ev.apply?.(ctx), choice?.apply?.(ctx)].filter(Boolean);
  const extra = extraParts.join(' ');
  const head = L(`Year event: <b>${ev.name}</b>. `, `年度事件：<b>${ev.name}</b>。`);
  const line = `<span class="${ev.kind === 'fortune' ? 'good' : ev.kind === 'choice' ? '' : 'bad'}">${head}${summary}${extra ? ` ${extra}` : ''}</span>`;
  $('report').innerHTML = `${$('report').innerHTML}<br />${line}`;
  toast(
    () => {
      const picked = choice ? ev.choices[choiceIdx] : null; // read again: in the current language
      const more = extraParts.map(textOf).join(' ');
      return `${ev.name}${picked ? `${L(': ', '：')}${picked.label}` : ''}${more ? ` · ${more}` : ''}`;
    },
    ev.kind === 'fortune' ? 'good' : 'bad',
    3200,
  );
  frontier.rebuild(grid);
  updateHUD();
  return later;
}

function dealNewHand() {
  // The tutorial deals its own scripted hand for the new season.
  if (tutorial.active) {
    tutorial.notify('season');
    updateHUD();
    pop($('oilStock'));
    return;
  }
  // Dust Storm: extra Wasteland dealt on top of the normal hand.
  const waste = turn.event?.mods?.extraWaste ?? 0;
  hand.deal(handSize() + waste, [...turn.pinned, ...Array(waste).fill('wasteland')]);
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
  startYearEvent(updateHUD, { force: debugEvent.force ?? null }).finally(() => (turn.round = round));
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
  $('shopCoins').textContent = L(`${turn.coins} barrel${turn.coins === 1 ? '' : 's'} of excess oil`, `盈余石油 ${turn.coins} 桶`);
  $('shopHint').textContent = turn.coins
    ? L('Bought cards go straight into your hand. Special tiles unlock for good.', '买下的卡牌直接加入手牌。特殊地块将永久解锁。')
    : L('Nothing to spend: only oil above the tribute can be spent here.', '无可花费：只有超出贡品的石油才能在这里使用。');
  const cost = shopRerollCost();
  $('shopRerollCost').textContent = L(`· ${cost} barrel${cost === 1 ? '' : 's'}`, `· ${cost} 桶`);
  $('btnShopReroll').classList.toggle('cant', turn.coins < cost);
  $('shopCards').innerHTML = shopStock.map(([k, price], i) => {
    const t = cardDef(k);
    const inHand = turn.pinned.filter((p) => p === k).length;
    price = shopPrice(price);
    const can = turn.coins >= price && turn.pinned.length < HAND_SIZE;
    return `
      <div class="shop-item">
        <div class="card${can ? '' : ' cant'}${animate ? ' deal' : ''}" data-k="${k}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${0.15 + i * 0.07}s">
          <div class="art">${cardArtHTML(k)}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>
        <div class="price">${L(`${price} barrel${price === 1 ? '' : 's'}`, `${price} 桶`)}${(turn.shopMult ?? 1) !== 1 ? ` <small>${L('black market', '黑市')}</small>` : ''}</div>
        <div class="tag">${BASIC_SHOP.has(k) ? L('Basic', '基础') : unlockTag(k)}${inHand ? L(` · ${inHand} in hand`, ` · 手牌中 ${inHand} 张`) : ''}</div>
      </div>`;
  }).join('');
}

/** A market card's status line: unlocked or not, and whether it's a one-use action. */
function unlockTag(k) {
  return (
    (turn.unlocked.has(k) ? L('Unlocked', '已解锁') : L('Locked', '未解锁')) + (ACTIONS[k] ? L(' · one use', ' · 一次性') : '')
  );
}

function buy(k) {
  const price = shopPrice(SHOP_ITEMS.find(([key]) => key === k)[1]);
  if (turn.coins < price) return toast(L('Not enough excess oil', '盈余石油不足'), 'bad');
  if (turn.pinned.length >= HAND_SIZE) return toast(L('Your next hand is full', '下一手牌已满'), 'bad');
  turn.coins -= price;
  if (!BASIC_SHOP.has(k)) turn.unlocked.add(k); // action cards too: once bought, they can be drawn at random
  turn.pinned.push(k);
  hand.addPinned(k);
  coin();
  renderShop();
}

$('shopCards').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-k]');
  if (card) buy(card.dataset.k);
});
$('btnShopReroll').addEventListener('click', () => {
  const cost = shopRerollCost();
  if (turn.coins < cost) return toast(L('Not enough excess oil to reroll', '盈余石油不足，无法重抽'), 'bad');
  turn.coins -= cost;
  shopRerolls++;
  shuffle();
  stockShop();
  renderShop(true);
});
$('btnShopDone').addEventListener('click', () => {
  shopOpen = false;
  turn.coins = 0; // unspent excess goes to the Overlord
  turn.shopMult = 1; // a black market discount only lasts one visit
  $('shop').classList.add('hidden');
  document.body.classList.remove('shopping');
  startNewYear(dealNewHand);
});

// ---------- free tile pick (target reward) ----------
const PICK_SLOTS = 3;
let pickResolve = null;
let pickOptions = [];

/** Show 3 random market tiles; the clicked one is unlocked and put in the next hand for free. */
function openCardPick() {
  pickOptions = SHOP_ITEMS.filter(([k]) => !BASIC_SHOP.has(k)).sort(() => Math.random() - 0.5).slice(0, PICK_SLOTS);
  eventOpen = true;
  hand.select(-1);
  renderCardPick(true);
  const el = $('cardPick');
  el.classList.remove('hidden', 'opening');
  void el.offsetWidth;
  el.classList.add('opening');
  document.body.classList.add('shopping');
  return new Promise((resolve) => (pickResolve = resolve));
}

function renderCardPick(animate = false) {
  $('pickCards').innerHTML = pickOptions.map(([k], i) => {
    const t = cardDef(k);
    return `
      <div class="shop-item">
        <div class="card${animate ? ' deal' : ''}" data-k="${k}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${0.15 + i * 0.07}s">
          <div class="art">${cardArtHTML(k)}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>
        <div class="tag">${unlockTag(k)}</div>
      </div>`;
  }).join('');
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
  coin();
  toast(
    () => {
      const name = cardDef(k).name;
      return L(`${name} unlocked${inHand ? ' and added to your next hand' : ''}`, `已解锁${name}${inHand ? '，并加入你的下一手牌' : ''}`);
    },
    'good',
    2600,
  );
  closeCardPick();
});

// A language switch while the market, the tile pick or the game-over screen is up: redraw them.
onLangChange(() => {
  if (shopOpen) renderShop();
  if (pickResolve) renderCardPick();
  if (!$('gameover').classList.contains('hidden')) showGameOver();
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

// Dragging a card out of the hand: the ghost follows the pointer (touch keeps sending moves to the card,
// not the canvas, so the pointer is updated from here), and releasing over the board places it as a click would.
const overBoard = (x, y) => document.elementFromPoint(x, y) === renderer.domElement;
hand.onDragMove = (x, y) => {
  pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  pointerInside = overBoard(x, y);
};
// While dragging a card, the mouse wheel rotates the piece (like R / F) instead of zooming the camera.
// Captured on window so it runs before the camera's own wheel handler on the canvas.
let wheelRotateAt = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (!hand.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (Math.abs(e.deltaY) < 1 || now - wheelRotateAt < 120) return; // one turn per notch, not per trackpad tick
    wheelRotateAt = now;
    hand.rotate(e.deltaY > 0 ? 1 : -1);
  },
  { capture: true, passive: false },
);
hand.onDrop = (x, y) => {
  if (!overBoard(x, y)) return; // dropped back on the hand or a panel: nothing placed, the card stays picked
  hand.onDragMove(x, y);
  tryPlace();
};

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
  const tiles = landReveals(found, (i) => 0.25 + i * 0.15);
  if (tiles.length < found.length) return; // a missile: its own toast
  toast(
    () => L(
      `Uncovered ${tiles.map((f) => `a ${TERRAINS[f.terrain].name}`).join(', ')}!`,
      `发现了${tiles.map((f) => TERRAINS[f.terrain].name).join('、')}！`,
    ),
    'good',
    2400,
  );
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
  toast(L('Territory full: pick a plot on the edge to expand', '领土已满：选择边缘的一块区域来扩张'), 'good');
}

function expand(option) {
  grid.unlock(option.px, option.pz);
  expansion.clear();
  fog.setOptions(null);
  // The clouds part; mystery sites in the new plot drop in as real tiles while they clear.
  const clearing = fog.visible ? fog.revealPlot(option.px, option.pz) : 0;
  const found = landReveals(mysteries.reveal(option.px, option.pz), (i) => 0.25 + clearing * 0.5 + i * 0.15);
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  rig.focus(...grid.territoryCenter());
  toast(
    () => found.length
      ? L(
          `Territory expanded · found ${found.map((f) => `a ${TERRAINS[f.terrain].name}`).join(', ')}!`,
          `领土已扩张 · 发现了${found.map((f) => TERRAINS[f.terrain].name).join('、')}！`,
        )
      : L('Territory expanded', '领土已扩张'),
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
  toast(
    on
      ? L('Expansion mode on: fill your territory, then expand (new run)', '扩张模式开启：填满领土后再扩张（新一局）')
      : L('Free placement on: build anywhere next to your land (new run)', '自由放置开启：可在你的土地旁任意建造（新一局）'),
    'good',
    2600,
  );
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
    else toast(L('Territory full: click a highlighted plot to expand', '领土已满：点击高亮的区域来扩张'));
    return;
  }
  const piece = hand.piece;
  if (!piece) {
    if (tutorial.active) return tutorial.nudge();
    toast(hand.isEmpty ? L('Hand used up: press Next turn', '手牌已用完：请按“下一回合”') : L('Pick a piece from your hand', '从手牌中选择一个板块'));
    return;
  }
  const cell = hoveredCell();
  if (!cell) return;
  const cells = placement.cellsAt(cell);
  const result = placement.validate(cells);
  if (!result.ok) {
    placement.reject();
    buzz();
    toast(result.reason, 'bad', 1600, false);
    return;
  }
  if (ACTIONS[piece.terrain]) {
    hand.consume();
    if (piece.terrain === 'spark') spark(cells);
    else if (piece.terrain === 'militia') militia(...cells[0]);
    else if (piece.terrain === 'demolish2') {
      const targets = placement.demolishable(cells);
      targets.forEach(([x, z]) => demolish(x, z, true));
      toast(L(`Demolished ${targets.length} tile${targets.length === 1 ? '' : 's'}`, `拆除了 ${targets.length} 个地块`));
    } else demolish(...cells[0]);
    return;
  }
  const idleBefore = economyNow().idle;
  if (piece.terrain.startsWith('wasteland')) addWastePiece(piece, cells);
  else cells.forEach(([x, z], i) => addTile(x, z, piece.terrain, i * 0.05));
  piecesPlaced++;
  showPlacementCost(piece, cells);
  hand.consume();
  if (!grid.expansionMode) revealMysteries(cells);
  frontier.rebuild(grid);
  updateHUD();
  if (economyNow().idle > idleBefore)
    toast(L('No free workers: this building sits idle until you add housing', '没有空闲人力：这座建筑将一直闲置，直到你建造更多住房'), 'bad', 2400);
  tutorial.notify('placed');
}

/**
 * A building just placed: what it takes floats up from it (workers it needs, or food it eats each season),
 * with the resource icon, in the payout label style. Nothing for tiles that cost nothing.
 */
const costV = new THREE.Vector3();
function showPlacementCost(piece, cells) {
  const { workers, food } = pieceCost(piece);
  const rows = [];
  if (workers) rows.push(`<div class="row neg"><b>-${workers}</b>${ICONS.manpower}</div>`);
  if (food) rows.push(`<div class="row neg"><b>-${food}</b>${ICONS.food}<span>${L('/ season', '/ 季')}</span></div>`);
  if (!rows.length) return;
  const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  costV.set(cx, 0.9, cz).project(camera);
  const el = document.createElement('div');
  el.className = 'cost-pop';
  el.style.left = `${(costV.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-costV.y * 0.5 + 0.5) * window.innerHeight}px`;
  el.innerHTML = `<div class="floater">${rows.join('')}</div>`;
  document.getElementById('floaters').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/**
 * Spark: every staffed "On trigger" tile in the area (farms, stations, refineries) triggers right now, even
 * if it makes 0 (a Refinery with no station beside it). Idle ones don't. Upkeep isn't charged. A tile
 * next to a Capital triggers twice, as in the season payout.
 */
const triggers = (p) => cardDef(p.terrain)?.trigger === 'On trigger' && !p.idle;
function spark(cells) {
  const area = new Set(cells.map(([x, z]) => `${x},${z}`));
  const e = economyNow();
  const fire = (p, extra = {}) => {
    const oil = Math.max(0, p.oil);
    const food = Math.max(0, p.food);
    return { x: p.x, z: p.z, terrain: p.terrain, mesh: payoutMesh(grid.get(p.x, p.z)), oil, food, zero: !oil && !food, triggers: p.triggers, ...extra };
  };
  const hit = e.perCell.filter((p) => area.has(`${p.x},${p.z}`) && triggers(p)).map((p) => fire(p)).flatMap(splitTriggers);
  // A sparked Capital triggers too: it hops, then every staffed producer next to it fires once more
  // (one trigger's worth: its season output divided by how many times it triggers).
  for (const cap of e.perCell.filter((p) => p.terrain === 'capital' && area.has(`${p.x},${p.z}`))) {
    hit.push({ x: cap.x, z: cap.z, mesh: grid.get(cap.x, cap.z).mesh, oil: 0, food: 0, terrain: 'capital' });
    for (const [dx, dz] of DIRS) {
      const n = e.perCell.find((p) => p.x === cap.x + dx && p.z === cap.z + dz);
      if (!n || !triggers(n)) continue;
      const per = n.triggers ?? 1;
      const oil = Math.round(Math.max(0, n.oil) / per);
      const food = Math.round(Math.max(0, n.food) / per);
      hit.push({ ...fire(n), oil, food, zero: !oil && !food, triggers: 1, finale: true }); // chain reaction after the area
    }
  }
  if (!hit.length) {
    toast(L('Spark fizzled: nothing in range produces oil or food', '火花熄灭了：范围内没有能产出石油或食物的地块'), 'bad');
    updateHUD();
    return;
  }
  document.body.classList.add('paying');
  payout.start(
    hit,
    (tile) => {
      chimeTile(tile);
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

/** Demolish: the tile is removed; a building on Pre-war Ruins leaves the ruins behind. `quiet`: no toast. */
function demolish(x, z, quiet = false) {
  const cell = grid.get(x, z);
  // Never a Capital or a camp, whatever called this (camps only go to the Militia, a bribe, or feeding the rebels).
  if (!cell || cell.terrain === 'capital' || isCamp(cell.terrain)) return;
  const name = TERRAINS[cell.terrain].name;
  removeMesh(cell.mesh);
  grid.cells.delete(`${x},${z}`);
  if (cell.onRuins && cell.terrain !== 'ruins') addTile(x, z, 'ruins');
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  if (!quiet) toast(L(`Demolished the ${name}`, `拆除了${name}`));
  updateHUD();
}

rig.onClick = tryPlace;

/**
 * Dev-testing hotkeys (Space, `, -, N, M, P, V, T, X). Off for players; set true to use them again.
 * The Game Debug panel (its button, top left) still has the same tools.
 */
const DEV_HOTKEYS = false;

window.addEventListener('keydown', (e) => {
  if (document.getElementById('loading')) return; // no shortcuts until the island exists
  const k = e.key.toLowerCase();
  const tgt = e.target;
  const dev = DEV_HOTKEYS;
  // Space: replay the payout sequence (debug). Works even with a debug slider focused.
  if (dev && k === ' ' && !tgt.matches?.('select, textarea, input:not([type=range])')) {
    e.preventDefault();
    if (!e.repeat) previewPayout();
    return;
  }
  if (tgt.matches?.('input, select, textarea')) return; // typing in the debug panel
  if (dev && k === '`') {
    debug.toggle();
    return;
  }
  if (dev && k === '-') {
    perf.setOpen(!perf.enabled); // performance overlay
    return;
  }
  if (striking) return; // the missile strike cinematic owns the screen
  if (payout.active) {
    if (k === 'enter') endTurn();
    return; // no placing / rotating / nuking mid-payout
  }
  if (tutorial.active) {
    // On script: Enter presses the advisor's Next; the debug shortcuts are off.
    if (k === 'enter' && tutorial.waitingNext) {
      e.preventDefault();
      if (!e.repeat) tutorial.notify('next');
      return;
    }
    if ('nmpvtx'.includes(k) && k.length === 1) return tutorial.nudge();
  }
  if (k >= '1' && k <= '9' && Number(k) <= hand.cards.length) {
    const i = Number(k) - 1;
    hand.select(hand.selected === i ? -1 : i);
  } else if (k === 'r') hand.rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') hand.rotate(-1);
  else if (k === 'escape') {
    if (helpOpen()) setHelp(false);
    else hand.select(-1);
  }
  else if (k === 'c') rig.focus(...(grid.expansionMode ? grid.territoryCenter() : grid.centroid()));
  else if (dev && k === 'n') nukeRandomTile();
  else if (dev && k === 'm' && !e.repeat) {
    const blocked = turn.over || striking || shopOpen || eventOpen || payout.active;
    const msg = previewMissileStrike();
    if (blocked) toast(msg);
  }
  else if (dev && k === 'p' && !e.repeat) debugShop();
  else if (dev && k === 'v' && !e.repeat) debugEvent();
  else if (dev && k === 't' && !e.repeat) debugTarget(e.shiftKey);
  else if (dev && k === 'x' && !e.repeat) setExpansionMode(!grid.expansionMode);
  else if (k === 'enter') endTurn();
});

$('btnReroll').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (hand.isEmpty || payout.active || turn.over || shopOpen || eventOpen) return;
  if (tutorial.active) {
    if (!tutorial.allows('reroll')) return tutorial.nudge();
    // Scripted: the free reroll always comes up with the Oil Station the Winter step needs.
    turn.freeRerolls = 0;
    shuffle();
    hand.dealScripted([{ terrain: 'station' }, { terrain: 'farm' }]);
    updateHUD();
    tutorial.notify('reroll');
    return;
  }
  if (turn.freeRerolls > 0) {
    // Target reward: free, and doesn't raise the price of the next paid reroll.
    turn.freeRerolls--;
    shuffle();
    hand.reroll();
    updateHUD();
    toast(
      L(
        `Hand rerolled for free (${turn.freeRerolls} free reroll${turn.freeRerolls === 1 ? '' : 's'} left)`,
        `已免费重抽手牌（剩余 ${turn.freeRerolls} 次免费重抽）`,
      ),
      'good',
    );
    return;
  }
  const cost = rerollCost();
  if (turn.stockpile < cost) {
    toast(L(`Not enough oil to reroll (costs ${cost})`, `石油不足，无法重抽（花费 ${cost}）`), 'bad');
    return;
  }
  shuffle();
  hand.reroll();
  turn.rerolls++;
  turn.stockpile -= cost;
  updateHUD();
  toast(L(`Hand rerolled: -${cost} oil (next reroll costs ${rerollCost()})`, `已重抽手牌：-${cost} 石油（下次重抽花费 ${rerollCost()}）`));
});
$('btnNext').addEventListener('click', (e) => {
  e.currentTarget.blur(); // so Space doesn't re-click it
  endTurn();
});

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
$('btnTutorial').addEventListener('click', (e) => {
  e.currentTarget.blur();
  setHelp(false);
  resetIsland({ tutorial: true });
});

// ---------- lifecycle ----------
/**
 * A new run. opts.tutorial: Year 0 (the scripted tutorial) instead of Year 1. opts.intro = false: skip the
 * Year 1 opening scene (the caller plays it later). opts.keepFade: leave the black fade up (tutorial → Year 1).
 * (Also used directly as a click handler, so opts may be an Event: only these exact flags count.)
 */
function resetIsland(opts) {
  const tut = opts?.tutorial === true;
  runId++; // stops a missile strike / failure speech still running
  introRun++; // and an opening scene
  tutorial.stop();
  if (opts?.keepFade !== true) $('fade').classList.remove('on');
  // The tutorial always uses free placement; a normal run goes back to the saved mode.
  grid.expansionMode = !tut && localStorage.getItem(MODE_KEY) === 'expansion';
  missiles.clear();
  striking = false;
  rig.release();
  document.body.classList.remove('striking');
  payout.cancel(); // stop a running payout without settling it
  previewing = false;
  document.body.classList.remove('paying');
  tiles.clear();
  grid.clear();
  traffic.clear();
  neonTiles.clear();
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
    shopMult: 1,
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
  $('report').textContent = L('No seasons played yet.', '尚未度过任何季节。');
  addTile(0, 0, SEED_TERRAIN, 0, true); // the game opens with the Capital already standing
  if (tut) {
    // Year 0: the old Overseer's last year. Two strikes already, one hand-placed "?" (an unexploded missile), scripted hands.
    Object.assign(turn, { round: 0, quota: TUTORIAL_QUOTA, quotaBase: TUTORIAL_QUOTA, strikes: TUTORIAL_STRIKES });
    shownStrikes = TUTORIAL_STRIKES; // already filled: no flare
    mysteries.clear();
    const { x, z, terrain, target } = TUTORIAL_SITE;
    mysteries.placeScripted(x, z, terrain, { target });
    frontier.rebuild(grid);
    tutorial.start();
    hand.dealScripted([{ terrain: 'farm' }, { terrain: 'station' }]);
    rig.focus(0, 0);
    updateHUD();
    playTutorialIntro();
    return;
  }
  mysteries.reset();
  frontier.rebuild(grid);
  // Opening hand: always one of each basic building plus two Wasteland, in random order.
  hand.deal(HAND_SIZE, OPENING_HAND);
  hand.cards.sort(() => Math.random() - 0.5);
  hand.render();
  rig.focus(0, 0);
  updateHUD();
  if (opts?.intro !== false) playIntro();
}

/** Skip tutorial: straight to a normal Year 1, with its opening scene. */
function skipTutorial() {
  markTutorialDone();
  resetIsland();
}

// ---------- Year 0: the tutorial's scenes ----------
/** The Overlord gives the old Overseer his last warning, then the advisor takes over. */
async function playTutorialIntro() {
  const run = runId;
  const live = () => run === runId;
  const overlord = () => 'The Overlord'; // speaker key (portrait); dialogue.js shows the name
  const say = async (text) => live() && dialogue.say(overlord(), text);
  eventOpen = true;
  hand.select(-1);
  dialogue.open({
    kind: 'pressure',
    kindLabel: L('Year 0 · Tutorial', '第 0 年 · 教程'),
    title: L('The Last Warning', '最后通牒'),
    effect: L(
      `Two tributes missed · ${TUTORIAL_QUOTA} barrels due after Winter · one more miss and the city falls`,
      `已两次失职 · 冬季结束后须上缴 ${TUTORIAL_QUOTA} 桶 · 再失职一次，城市就会沦陷`,
    ),
  });
  await say(L('Overseer. Two tributes missed. Two.', '总督。两次未缴贡品。两次。'));
  await say(
    L(
      'My legions march against the technobarbarians of the Wastelands, and my tanks are drinking sand. Because of you.',
      '我的军团正在荒原上征讨技术蛮族，而我的坦克却在喝沙子。都是因为你。',
    ),
  );
  if (!live()) return;
  const i = await dialogue.ask(
    overlord(),
    L(
      `This is your last year. ${TUTORIAL_QUOTA} barrels when Winter ends, or I find an Overseer who can count.`,
      `这是你的最后一年。冬季结束时交出 ${TUTORIAL_QUOTA} 桶，否则我就去找一个会数数的总督。`,
    ),
    [
      { text: L('You will have them, Overlord.', '您会如数得到的，霸主。') },
      { text: L('The wells are drying up...', '油井正在枯竭……') },
      { text: L('I need more time.', '我需要更多时间。') },
    ],
  );
  const retorts = [
    L('I have heard that before. Twice.', '这话我听过。两次。'),
    L(
      'Then build more of them. Your advisor will show you how, since you seem to have forgotten.',
      '那就多建几座。既然你似乎已经忘了怎么做，就让你的顾问教教你。',
    ),
    L('Time is the one thing you have run out of.', '时间，恰恰是你已经用光的东西。'),
  ];
  await say(retorts[i]);
  await say(L('Do not make me come back early.', '别逼我提前回来。'));
  if (!live()) return;
  await dialogue.leave();
  if (!live()) return;
  eventOpen = false;
  tutorial.begin();
}

/**
 * Year 0 ends short (the unexploded missile saw to that): the third strike. The Overlord relieves his Overseer, every
 * tile but the Capital burns, and after a fade to black a new Overseer (the player) starts Year 1.
 */
async function playPredecessorJudgement({ quota, delivered }) {
  const run = runId;
  const live = () => run === runId;
  const overlord = () => 'The Overlord'; // speaker key (portrait); dialogue.js shows the name
  const say = async (text) => live() && dialogue.say(overlord(), text);
  eventOpen = true;
  hand.select(-1);
  turn.strikes = MAX_STRIKES;
  updateHUD();
  dialogue.allowSkip(true);
  dialogue.open({
    kind: 'disaster',
    kindLabel: L(`Tribute missed · strike ${MAX_STRIKES} of ${MAX_STRIKES}`, `贡品未缴 · 失职 ${MAX_STRIKES}/${MAX_STRIKES}`),
    title: L("The Overlord's Judgement", '霸主的审判'),
    effect: L(
      `Short by ${quota - delivered} barrels · the Overseer is relieved of duty`,
      `短缺 ${quota - delivered} 桶 · 总督被解除职务`,
    ),
  });
  await say(L(`${delivered} barrels. I asked for ${quota}.`, `${delivered} 桶。我要的是 ${quota} 桶。`));
  await say(
    L(
      'An old missile? An accident? Three years, Overseer. Three years of accidents.',
      '一枚旧导弹？一场意外？三年了，总督。三年的意外。',
    ),
  );
  if (!live()) return;
  const replies = [
    [
      L('The missile was not my fault!', '那枚导弹不是我的错！'),
      L('Nothing ever is. That is precisely the problem.', '从来都不是你的错。问题恰恰就在这里。'),
    ],
    [
      L('Give me one more year.', '再给我一年。'),
      L('I gave you three. I am not a generous man; I was a patient one.', '我给了你三年。我从不慷慨，只是曾经有耐心。'),
    ],
    [L('...', '……'), L('Nothing to say? For once, you have pleased me.', '无话可说？难得你让我满意了一次。')],
  ];
  const i = await dialogue.ask(overlord(), L('Anything to say for yourself?', '你还有什么要为自己辩解的吗？'), replies.map(([text]) => ({ text })));
  await say(replies[i][1]);
  await say(
    L(
      'The Hive City stays. It is mine, after all. Everything else you built... goes with you.',
      '蜂巢城留下。毕竟它是我的。你建造的其他一切……都随你一起消失。',
    ),
  );
  if (!live()) return;
  await dialogue.leave();
  if (!live()) return;
  const targets = [...grid.cells.values()].filter((c) => c.terrain !== 'capital').map(({ x, z }) => ({ x, z }));
  await playMissileStrike(targets, { restoreCamera: false });
  if (!live()) return;
  await wait(0.6);
  if (!live()) return;
  await fadeToYearOne();
}

/** Fade to black, start a normal Year 1 under it, fade back in on the Overlord meeting his new Overseer. */
async function fadeToYearOne() {
  markTutorialDone();
  const fade = $('fade');
  fade.querySelector('.fade-text').innerHTML = L(
    'Some weeks later<br /><small>A new Overseer arrives at the Hive City</small>',
    '数周之后<br /><small>一位新总督抵达蜂巢城</small>',
  );
  fade.classList.add('on');
  const run = runId;
  await wait(3.2);
  if (run !== runId) return;
  resetIsland({ intro: false, keepFade: true });
  // Under the black: the camera snaps back from the strike's wide shot to the normal view.
  rig.goalDistance = rig.distance = START_DISTANCE;
  rig.target.copy(rig.goal);
  const next = runId;
  await wait(0.6);
  if (next !== runId) return;
  fade.classList.remove('on');
  await wait(0.9);
  if (next !== runId) return;
  playIntro();
}

/**
 * A missed tribute: the Overlord comes to speak. What he says depends on how many strikes are
 * left: a warning, a last warning, and on the third miss his judgement (the game over follows).
 * Mid-speech he launches the missiles (1, 3, then 5): the dialogue steps aside for the strike,
 * then he comes back to gloat. On the final strike one of them hits the Capital.
 */
async function playTributeFailure({ quota, delivered, short, missiles: count, strikes, final }) {
  const overlord = () => 'The Overlord'; // speaker key (portrait); dialogue.js shows the name
  const run = runId;
  const live = () => run === runId;
  const say = async (text) => live() && text && dialogue.say(overlord(), text);
  const left = MAX_STRIKES - strikes;
  const many = () =>
    L(
      ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][count] ?? String(count),
      ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][count] ?? String(count),
    );
  eventOpen = true;
  hand.select(-1);
  const banner = {
    kind: 'disaster',
    kindLabel: L(`Tribute missed · strike ${strikes} of ${MAX_STRIKES}`, `贡品未缴 · 失职 ${strikes}/${MAX_STRIKES}`),
    title: final
      ? L("The Overlord's Judgement", '霸主的审判')
      : strikes === MAX_STRIKES - 1
        ? L('Last Warning', '最后警告')
        : L('The Overlord Is Displeased', '霸主很不满'),
    effect: final
      ? L(
          `Short by ${short} barrels · ${count} missile${count === 1 ? '' : 's'} · the Hive City falls`,
          `短缺 ${short} 桶 · ${count} 枚导弹 · 蜂巢城沦陷`,
        )
      : L(
          `Short by ${short} barrels · ${count} missile${count === 1 ? '' : 's'} · no market this year · ${left} more miss${left === 1 ? '' : 'es'} and the city falls`,
          `短缺 ${short} 桶 · ${count} 枚导弹 · 今年没有市场 · 再失职 ${left} 次，城市就会沦陷`,
        ),
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
    await say(L('Three times.', '三次了。'));
    await say(
      L(
        `${delivered} barrels, when I asked for ${quota}. Three years, three failures.`,
        `我要 ${quota} 桶，你只交了 ${delivered} 桶。三年，三次失败。`,
      ),
    );
    await say(
      L(
        'I gave you a city, its workers and my patience. You squandered all three.',
        '我给了你一座城市、城里的劳工，还有我的耐心。你把这三样全都挥霍光了。',
      ),
    );
    if (!live()) return;
    const replies = [
      [L('I did everything I could.', '我已经尽力了。'), L('Then everything was not enough. Launch them all.', '那你的尽力还远远不够。全部发射。')],
      [L('The wastes will take you too, one day.', '总有一天，荒原也会吞没你。'), L('Perhaps. But not today. Burn it.', '也许吧。但不是今天。烧了它。')],
      [L('Please...', '求求您……'), L('Begging. How fitting. Burn it to the sand.', '乞求。真是恰如其分。把它烧成一片沙地。')],
    ];
    const i = await dialogue.ask(overlord(), L('Do you have any last words, Overseer?', '还有什么遗言吗，总督？'), replies.map(([text]) => ({ text })));
    await say(replies[i][1]);
    await say(() => L(`${many()} missiles, Overseer. Watch your city burn.`, `${many()}枚导弹，总督。看着你的城市燃烧吧。`));
    await strike(pickStrikeTargets(count, true), { restoreCamera: false });
    if (live()) eventOpen = false;
    return;
  }

  let script;
  if (left === 1) {
    script = {
      lines: [
        () => L('Again. You have failed me again.', '又一次。你又一次让我失望了。'),
        () =>
          L(
            `${delivered} barrels. My generals no longer say your name; they just call you "the shortfall".`,
            `${delivered} 桶。我的将军们已经不提你的名字了，他们直接叫你“亏空”。`,
          ),
      ],
      launch: () =>
        L(`${many()} missile${count === 1 ? '' : 's'} this time. Look to the sky, Overseer.`, `这次是${many()}枚导弹。抬头看看天空吧，总督。`),
      ask: () =>
        L(
          'This is your last warning. Fail me once more, and I will raze the Hive City to the sand.',
          '这是最后的警告。再让我失望一次，我就把蜂巢城夷为沙地。',
        ),
      replies: () => [
        [L("You'll have your oil. All of it.", '您会得到您的石油。一滴不少。'), L('Words. Bring me barrels.', '空话。把油桶给我拿来。')],
        [L('Give me more time.', '再给我一些时间。'), L('Time is the one thing I have stopped giving you.', '时间，正是我不会再给你的东西。')],
        [L('Then do it now.', '那就现在动手吧。'), L('Ha! No. I want to watch you try first.', '哈！不。我要先看着你挣扎一番。')],
      ],
    };
  } else {
    script = {
      lines: [
        () => L(`Short. ${delivered} barrels, when I asked for ${quota}.`, `不够。我要 ${quota} 桶，你只交了 ${delivered} 桶。`),
        () =>
          L(
            'My tanks sat idle in the dunes while the technobarbarians laughed. Because of you, Overseer.',
            '我的坦克在沙丘里趴窝，技术蛮族在一旁嘲笑。都是因为你，总督。',
          ),
      ],
      launch: () =>
        count === 1
          ? L('Perhaps a demonstration will focus your mind. One missile. Watch the sky.', '也许一次示范能让你集中精神。一枚导弹。看好天空。')
          : L(`Perhaps a demonstration will focus your mind. ${many()} missiles. Watch the sky.`, `也许一次示范能让你集中精神。${many()}枚导弹。看好天空。`),
      ask: () =>
        L('There will be no market for you this year. Fail me twice more and your city burns.', '今年不会为你开放市场。再失败两次，你的城市就会化为火海。'),
      replies: () => [
        [L("It won't happen again.", '不会再有下次了。'), L("See that it doesn't.", '最好如此。')],
        [L('The wells ran dry.', '油井干涸了。'), L('Then dig new ones. With your bare hands, if you must.', '那就挖新的。必要的话，用你的双手去挖。')],
        [L('...', '……'), L('Silence will not fill my tanks.', '沉默填不满我的油箱。')],
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
  await say(() =>
    lost.length
      ? L(
          `I have left a reminder where your ${listLost(lost)} used to stand.`,
          `我在你的${listLost(lost)}原本矗立的地方，留下了一点纪念。`,
        )
      : L(
          'You have nothing standing worth one of my missiles. Remember that. I will.',
          '你连一座值得我浪费一枚导弹的建筑都没有。记住这一点。我会记住的。',
        ),
  );
  if (!live()) return;
  const replies = script.replies();
  const i = await dialogue.ask(overlord(), script.ask, replies.map((_, k) => ({ text: () => script.replies()[k][0] })));
  await say(() => script.replies()[i][1]);
  // Not the end: he stays on and moves straight on to next year's target (startNewYear).
}

/** Opening scene: the Overlord appoints you Overseer of the Hive City, then leaves you to it. */
let introRun = 0;
async function playIntro() {
  const run = ++introRun; // a reset mid-intro cancels the old one
  const overlord = () => 'The Overlord'; // speaker key (portrait); dialogue.js shows the name
  const say = async (text) => run === introRun && dialogue.say(overlord(), text);
  eventOpen = true;
  hand.select(-1);
  dialogue.open({
    kind: 'pressure',
    kindLabel: L('A new Overseer', '新任总督'),
    title: L('The Hive City', '蜂巢城'),
    effect: L('Year 1 · Spring', '第 1 年 · 春'),
  });
  await say(L('So. You are the new Overseer of the Hive City.', '那么。你就是蜂巢城的新任总督。'));
  await say(L('Your predecessor... disappointed me. I trust you will not.', '你的前任……让我失望了。我相信你不会。'));
  await say(
    L(
      'My legions march against the technobarbarians of the Wastelands. Scrap-eaters. Machine-worshippers. Vermin.',
      '我的军团正在荒原上征讨技术蛮族。啃废铁的家伙。机器崇拜者。害虫。',
    ),
  );
  await say(
    L(
      'War is thirsty work. My tanks, my airships, my engines of conquest: all of them drink oil.',
      '战争是件口渴的差事。我的坦克、我的飞艇、我的征服机器：全都要喝石油。',
    ),
  );
  if (run !== introRun) return;
  const i = await dialogue.ask(overlord(), L('You will send me a constant supply. Every year. Without fail.', '你要源源不断地向我供油。每一年。绝不可断。'), [
    { text: L('The oil will flow, Overlord.', '石油会源源不断，霸主。') },
    { text: L('And if the wells run dry?', '如果油井干涸了呢？') },
    { text: L('What do I get in return?', '那我能得到什么回报？') },
  ]);
  const retorts = [
    L('Of course it will.', '当然会。'),
    L('Then you will dig deeper. With your hands, if you must.', '那你就挖得更深。必要的话，用你的双手。'),
    L('You get to keep your city. And your head.', '你可以保住你的城市。还有你的脑袋。'),
  ];
  await say(retorts[i]);
  await say(L('Good luck, Overseer. You will need it.', '祝你好运，总督。你会需要它的。'));
  if (run !== introRun) return;
  await dialogue.leave();
  if (run !== introRun) return;
  eventOpen = false;
  toast(L(`First tribute: ${turn.quota} barrels, due after Winter`, `首次贡品：${turn.quota} 桶，冬季结束后上缴`), 'bad', 3200);
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
  perf.begin('ships');
  traffic.update(dt, grid);
  neonTiles.update(dt, time);
  perf.end('ships');
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
  if (busy() && hand.selected >= 0 && !payout.active) hand.select(-1);
  placement.update(expansion.active || busy() ? null : cell, dt, time);
  perf.end('placement');
  tutorial.update(time);

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

/** Every texture the models use, once each. */
function modelTextures(models) {
  const set = new Set();
  for (const model of models?.values() ?? []) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      for (const m of [obj.material].flat()) for (const tex of [m.map, m.normalMap, m.emissiveMap]) if (tex) set.add(tex);
    });
  }
  return set;
}

/** Send every model texture to the GPU now, so the first landing doesn't stutter while ~60 MB uploads. */
function warmUpModels(models = factory.models) {
  for (const tex of modelTextures(models)) renderer.initTexture(tex);
}

/**
 * The same for models that arrive during play, without freezing it: each image is decoded off the main thread
 * first, the uploads are spread over frames, then the shaders compile in the background (compileAsync), so the
 * first tile of each kind lands without a hitch.
 */
async function warmUpModelsGradually(models) {
  for (const tex of modelTextures(models)) {
    await decodeImage(tex.image);
    renderer.initTexture(tex);
    await breathe();
  }
  for (const model of models.values()) {
    try {
      await renderer.compileAsync(model, camera, scene);
    } catch {
      // compiles on first draw instead
    }
    await breathe();
  }
}

// Start once the models are in, so the Capital lands as the real city rather than a
// stand-in block that swaps a second later. factory.ready also resolves if loading
// fails (the game then runs on coloured blocks).
factory.ready.then(() => {
  clearInterval(loadTimer);
  $('loadingFill').style.width = '100%';
  warmUpModels();
  // Sound has to be allowed before the opening hand is dealt, or that whoosh is skipped.
  // When the browser blocks autoplay, the loading screen stays up for one click or key.
  let started = false;
  let swallowNextClick = false;
  const go = () => {
    const sound = unlockSfx();
    startMusic();
    if (started || !sound) return sound;
    started = true;
    resetIsland({ tutorial: !tutorialDone() }); // first visit: Year 0, the tutorial
    last = performance.now();
    requestAnimationFrame(frame);
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 700);
    if (swallowNextClick) {
      swallowNextClick = false;
      // The click that unlocks sound would otherwise land on the new dialogue and skip the typewriter.
      const swallow = (click) => {
        click.stopPropagation();
        click.preventDefault();
        window.removeEventListener('click', swallow, true);
      };
      window.addEventListener('click', swallow, true);
    }
    return true;
  };
  if (go()) return;
  // data-en / data-zh: applyStatic() swaps it if the language changes on the loading screen.
  Object.assign($('loadingHint').dataset, { en: 'Click to begin', zh: '点击开始' });
  $('loadingHint').textContent = L('Click to begin', '点击开始');
  const onGesture = (e) => {
    if (e.type === 'pointerdown') swallowNextClick = true;
    if (go()) {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    }
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  // resume() often reports "running" on a later turn, still from the same click.
  whenSfxRunning().then(() => {
    if (!go()) return;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  });
});

// The Wasteland piece models (about 330 MB) load after the buildings, while the intro plays.
factory.piecesReady.then(async (pieces) => {
  if (!pieces) return;
  await warmUpModelsGradually(pieces);
  adoptWastePieces();
});

// The remaining buildings and tiles load last; any already placed swap their stand-ins for the real models.
factory.extrasReady.then(async (extras) => {
  if (!extras) return;
  await warmUpModelsGradually(extras);
  adoptBlockouts();
});

// Handy for debugging in the console.
window.tileIsland = { tutorial, resetIsland, debugRandomStrike, traffic, addWastePiece, debugEvent, dealNewHand, debugShop, EVENTS, perf, renderer, grid, hand, placement, rig, expansion, mysteries, fog, turn, dialogue, missiles, missileCfg, previewMissileStrike, playMissileStrike, economy: economyNow, addTile, spawnBandits, settleTurn, spawnRaider, queueScene, playPendingScenes };
