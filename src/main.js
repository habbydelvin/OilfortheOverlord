import { RELEASE } from './release.js'; // first: clears dev tuning before any settings load
import { updateCurve, flattenCurve, intersectGround } from './curvature.js'; // early: bends every material made after it (small planet)
import './ui.css';
import './theme.css';
import './themeShine.js';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createInstancer } from './instancer.js';
import { createTitleScreen } from './titleScreen.js';
import { createSandPlanet } from './sandPlanet.js';
import { createShadowCache } from './shadowCache.js';
import { getMusicVolume, initMusic, MUSIC_VOLUME_DEFAULT, MUSIC_VOLUME_MAX, onMusicVolume, setMusicVolume, setMusicMuffled, startMusic } from './music.js';
import { barrel, latch, bindCardHover, boom, buzz, confirm, coin, demolition, deny, doom, food, getSfxVolume, setSfxVolume, SFX_VOLUME_DEFAULT, SFX_VOLUME_MAX, shuffle, thud, tick, unlockSfx, whenSfxRunning, ciws, wasteThud, buildThud, zoomWhoosh } from './sfx.js';
import { createCombatAudio } from './combatAudio.js';
import { CameraRig } from './controls.js';
import { Grid, DIRS, inWorld, key as plotKey, hexToWorld, worldToHex, hexDistance, cellsCentre, cellSeed, hexesAround } from './grid.js';
import { FogOfWar, FOG_PARAMS, FOG_DEFAULTS, loadFogConfig, saveFogConfig, clearFogConfig } from './fogOfWar.js';
import { preloadCardArt } from './tiles.js';
import { TileFactory, TERRAINS, ACTIONS, SHOP_ITEMS, BASIC_SHOP, BLACK_MARKET, BLACK_MARKET_RESOURCE, MILITARY, shopReady, BANDIT_KEYS, isCamp, cardDef, cardText, hex, ICONS, isBuilding, iconize, shapeGridHTML, snapHTML, cardArtHTML } from './tiles.js';
import { hasBlockout, loadProgress, breathe, decodeImage, PAD_MISSILE } from './models.js';
import { Frontier } from './frontier.js';
import { Placement, GHOST_LAYER, PREVIEW_PARAMS, PREVIEW_DEFAULTS, loadPreviewConfig, savePreviewConfig, clearPreviewConfig } from './placement.js';
import { Hand, pieceCost } from './hand.js';
import { copySeam, isSeamless } from './seamlessGround.js';
import { NeonTiles, createGlow, LIFT } from './neonGlow.js';
import { BarrelGauge, OilFlights } from './barrelGauge.js';
import { SeasonClock } from './seasonClock.js';
import { setupCrt } from './crt.js';
import { CrtPass } from './crtPass.js';
import { BoostHints } from './boostHints.js';
import { setupLegend } from './legend.js';
import { Mysteries, siloFires } from './mystery.js';
import { Expansion } from './expansion.js';
import { Dust } from './dust.js';
import { computeEconomy, computeEconomyIf, foodCapOf, FIRST_QUOTA, nextQuota, SEASONS, rebelsRise, seasonParts, WORKERS } from './economy.js';
import { FACTORY_OIL, INTERCEPT_OIL, factoryYield, interceptorsBeside, isPlayerMissile, isMissileAmmo, missileCapacity, blastExtra, isMilitaryLab, labOilCost, BASE_MISSILE_CAP, MAGAZINE_CAP } from './arsenal.js';
import { pieceOf, pieceOffsets } from './pieces.js';
import { findCiws } from './interceptMesh.js';
import { queueDrawn, addMissile, missileCount, ammoCount, missileKinds, trimMissiles, resetMissiles, openCityStrike, drawStrikeHand, returnStrikeHand, bindCityStrikeUi, queueStrike, unqueueStrike, queuedStrikes, takeQueue, clearQueue } from './cityStrike.js';
import { CAPITAL_HP, resolve as resolveWar, applyToRival, footprint, spreadFrom } from './war.js';
import { chooseStrikes, noteAttacks, idleOf } from './rivalAI.js';
import { INTERCEPT, INTERCEPT_DEFAULTS, INTERCEPT_PARAMS, saveIntercept, clearIntercept, DECOY, BOOST, isBoosted } from './arsenal.js';
import { Payout, tileHop } from './payout.js';
import { PayoutHud } from './payoutHud.js';
import { payoutPulse } from './payoutAnimations.js';
import { EVENTS, KIND_LABEL, drawEvent } from './events.js';
import { Dialogue } from './dialogue.js';
import { TIERS, TIER_ORDER, REWARDS, LOW_STREAK_LIMIT, rollReward, scaledQuota } from './targets.js';
import { loadPayoutConfig } from './payoutConfig.js';
import { createDebugPanel } from './debugPanel.js';
import { CameraShake, SHAKE_PARAMS, SHAKE_DEFAULTS, loadShakeConfig, saveShakeConfig, clearShakeConfig } from './cameraShake.js';
import { SCALE, SCALE_PARAMS, SCALE_DEFAULTS, loadScaleConfig, saveScaleConfig, clearScaleConfig, eventPct, P } from './scalingConfig.js';
import { Traffic } from './traffic.js';
import { LOD, buildLods, setLod, wantLod, lodStats } from './lod.js';
import { ZoomIcons, MAP_ICONS, ICON_PARAMS, ICON_DEFAULTS, loadIconConfig, saveIconConfig, clearIconConfig } from './zoomIcons.js';
import { Perf } from './perfOverlay.js';
import { GFX_PARAMS, GFX_DEFAULTS, loadGfxConfig, saveGfxConfig, clearGfxConfig, applyGfx } from './graphics.js';
import { playRebelScene, playBanditScene, LEADER_COSTS } from './leaders.js';
import { MissileStrike, MISSILE_PARAMS, MISSILE_DEFAULTS, MISSILE_TAIL, loadMissileConfig, saveMissileConfig, clearMissileConfig } from './missiles.js';
import { Tutorial, TUTORIAL_KEY, OPENING, tutorialDone, markTutorialDone } from './tutorial.js';
import { L, both, isZh, toggleLang, onLangChange, applyStatic, textOf, retranslate } from './i18n.js';
import { createRivals, advanceRivals, rivalStats, PLAYER_NODE } from './rivals.js';
import { createRivalView } from './rivalView.js';
import { createGlobeView, GLOBE_RADIUS, GLOBE_PARAMS, GLOBE_DEFAULTS, loadGlobeConfig, saveGlobeConfig, clearGlobeConfig } from './globeView.js';
import { createCloudTransition } from './cloudTransition.js';

applyStatic(); // the page's own text in the saved language

const HAND_SIZE = 5;
const SEED_TERRAIN = 'capital';

// ---------- setup ----------
const { renderer, scene, camera, sun, followTarget, setBoardFraming } = createScene(document.getElementById('app'));
// The CRT post-process (Graphics → CRT screen: Shader); the glass is #crt's area. HTML over the 3D view follows its bend.
const crtPass = new CrtPass(renderer, document.getElementById('crt'));
crtPass.hookProjection(camera);
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
/** The camera before any shake: on-screen labels over the board project with it, so they hold still while the world shakes. */
const steadyCam = camera.clone();
function syncSteadyCam() {
  steadyCam.copy(camera);
  steadyCam.updateMatrixWorld(true);
}
const grid = new Grid();
const factory = new TileFactory();
/** 'board' | 'globe' | 'rival'. Off the board, placement and the hand stay shut. */
let view = 'board';
let rivals = [];
let rivalShown = null;
let globe;
// Rival cities get their own fog of war, with the board's fog settings and quality (read on the first visit).
const rivalView = createRivalView({ renderer, factory, rig, fogSettings: () => fogCfg, fogQuality: () => gfxCfg.fogQuality, keepMaxZoom: true });
const tiles = new THREE.Group();
scene.add(tiles);
const instancer = createInstancer(tiles, scene);
const shadowCache = createShadowCache(sun);
const interceptCover = new THREE.Group();
scene.add(interceptCover);
const INTERCEPT_GLOW = 0x4cc8ff;
const BOOST_GLOW = 0xffc84a; // Launch Accelerator's reach
let interceptCoverKey = '';
let interceptCoverGlows = [];
const previewCfg = loadPreviewConfig(); // Game Debug → Placement preview
const frontier = new Frontier(scene, previewCfg);
const placement = new Placement(scene, grid, factory, previewCfg);
const mysteries = new Mysteries(scene);
const dust = new Dust(scene);
const expansion = new Expansion(scene);
// Clouds over locked plots in expansion mode; they part when a plot is unlocked.
const fogCfg = loadFogConfig(); // saved Game Debug slider values
const globeCfg = loadGlobeConfig(); // globe tuning (city size, spread), same panel
const fog = new FogOfWar(scene, fogCfg);
// Reduced-resolution fog (quality presets); the placed tiles still hide the fog behind them.
fog.attachRenderer(renderer, scene, [tiles, instancer.group]);
const missileCfg = loadMissileConfig(); // Game Debug → Missiles
// Recorded combat sounds (public/audio/combat-test). Until they have loaded, the synthesised sounds below play instead.
const combatAudio = createCombatAudio();
/** The recorded sound once loaded, else the old synthesised one. */
const snd = (recorded, fallback) => (combatAudio.ready ? recorded() : fallback?.());
const explode = (size) => snd(() => combatAudio.explosion(size), boom);
const launchSnd = () => snd(() => combatAudio.launch(), boom);
const gunSnd = (dur) => snd(() => combatAudio.gunBurst(dur), () => ciws(dur));
/** A whoosh that peaks when this missile lands or is shot down. Null until the recordings are loaded. */
function missileWhoosh(t) {
  if (!combatAudio.ready) return null;
  const now = typeof t.clock === 'function' ? t.clock() : 0;
  const end = (t.killAt ?? (t.t0 ?? 0) + (t.flight ?? missileCfg.followFlight)) - now;
  return end > 0.2 ? combatAudio.incoming(end) : null;
}
const missiles = new MissileStrike(scene, camera, missileCfg);
const shakeCfg = loadShakeConfig(); // Game Debug → Missile camera shake
const camShake = new CameraShake(camera, shakeCfg); // missile strikes only; tiles etc. use the small `shake` jolt
const gfxCfg = loadGfxConfig();
const applyGraphics = () => applyGfx(gfxCfg, { renderer, scene, sun, fog, crt: crtPass });
applyGraphics();
// Debug: territory expansion mode (the old fill-your-plot-then-expand rules), saved across reloads.
const MODE_KEY = 'oftoMode';
grid.expansionMode = localStorage.getItem(MODE_KEY) === 'expansion';
placement.mysteries = mysteries; // "?" cells can't be built on, only next to (free-placement mode)
const dialogue = new Dialogue(document.getElementById('dialogue'));
const scaleCfg = loadScaleConfig(); // Game Debug → Scaling (events and camps)
const iconCfg = loadIconConfig(); // Game Debug → Map icons
const zoomIcons = new ZoomIcons(document.getElementById('mapIcons'), camera, rig, iconCfg);
const traffic = new Traffic(scene); // ships flying between the tiles
const trafficInstances = createInstancer(traffic.group, scene); // ships use the same model on every route
const neonTiles = new NeonTiles(scene); // boosted buildings' tiles glow
const boostHints = new BoostHints(scene); // outlines where the hovered / placed card would be boosted
setupLegend(document.getElementById('btnLegend'), document.getElementById('legend')); // icon legend window
const payoutCfg = loadPayoutConfig();
const payout = new Payout(steadyCam, document.getElementById('floaters'), payoutCfg);
// On the War Map the tile labels (+oil, +food, ...) all rise above Hive City instead of their board tiles.
payout.anchor = () => (view === 'globe' ? globe?.screenOf('player') : null);
const audioCfg = { music: getMusicVolume(), sfx: getSfxVolume() };
const AUDIO_DEFAULTS = { music: MUSIC_VOLUME_DEFAULT, sfx: SFX_VOLUME_DEFAULT };
const AUDIO_PARAMS = [
  { group: 'Audio' },
  { key: 'music', label: 'Music', min: 0, max: MUSIC_VOLUME_MAX, step: 1, hint: '100 is full level, 200 is twice as loud. Same control as the corner slider.' },
  { key: 'sfx', label: 'SFX', min: 0, max: SFX_VOLUME_MAX, step: 1, hint: '100 is the old quiet level. 300 is the default.' },
];
bindCardHover(document.getElementById('shopCards'));
bindCardHover(document.getElementById('pickCards'));

const debug = RELEASE
  ? { toggle() {}, refresh() {}, refreshMode() {} } // release: no Game Debug panel
  : createDebugPanel(document.getElementById('debug'), document.getElementById('btnDebug'), payoutCfg, {
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
      if (!p || p.key === 'sfx') {
        setSfxVolume(audioCfg.sfx);
        combatAudio.syncMaster();
      }
    },
  },
  onPlay: () => previewPayout(),
  expansionMode: () => grid.expansionMode,
  onExpansionMode: (on) => (tutorialBlocks() ? undefined : setExpansionMode(on)),
  onSkipYear: (met) => (tutorialBlocks() ? 'Not during the tutorial' : debugSkipYear(met)),
  giveKeys: [...Object.keys(TERRAINS).filter((k) => k !== 'capital' && !/^wasteland[2-4]$/.test(k)), ...Object.keys(ACTIONS)],
  onGiveTile: (k) => {
    if (!k) return 'Pick a tile';
    hand.addPinned(k);
    updateHUD();
    return `Added ${k}`;
  },
  onGiveMissile: (kind = 'missile') => {
    if (view === 'rival' && rivalShown && rivalShown.alive !== false && !attackLive) {
      if (!rivalHand) {
        addMissile(kind);
        openRivalHand(rivalShown);
      } else {
        hand.cards.push(pieceOf(kind));
        const ammo = hand.cards.filter((p) => isMissileAmmo(p.terrain)).length;
        if (ammo > 2 && !hand.cards.some((p) => p.terrain === 'salvo')) hand.cards.unshift(pieceOf('salvo'));
        hand.render();
      }
    } else addMissile(kind);
    updateHUD();
    updateAimBar();
    return `Added ${kind}`;
  },
  onPerf: () => perf.setOpen(!perf.enabled),
  onResetTutorial: () => {
    localStorage.removeItem(TUTORIAL_KEY); // next reload starts with the tutorial again
    resetIsland({ tutorial: true }); // (its lessons start over too)
    return 'Tutorial reset: guided first Spring started';
  },
  onMissiles: () => (tutorialBlocks() ? 'Not during the tutorial' : previewMissileStrike()),
  onShake: () => {
    camShake.add(missileCfg.shake);
    return 'Shake: one missile impact';
  },
  crtOn: () => gfxCfg.crtScreen !== 'Off',
  onCrt: () => {
    gfxCfg.crtScreen = gfxCfg.crtScreen === 'Off' ? 'Shader' : 'Off';
    saveGfxConfig(gfxCfg);
    applyGraphics();
    return `CRT effect: ${gfxCfg.crtScreen === 'Off' ? 'off' : 'on'}`;
  },
  preview: {
    params: PREVIEW_PARAMS,
    defaults: PREVIEW_DEFAULTS,
    cfg: previewCfg,
    save: savePreviewConfig,
    clear: clearPreviewConfig,
  },
  shake: {
    params: SHAKE_PARAMS,
    defaults: SHAKE_DEFAULTS,
    cfg: shakeCfg,
    save: saveShakeConfig,
    clear: clearShakeConfig,
  },
  missiles: {
    params: MISSILE_PARAMS,
    defaults: MISSILE_DEFAULTS,
    cfg: missileCfg,
    save: saveMissileConfig,
    clear: clearMissileConfig,
    onChange: () => {
      hand.render();
      if (hand.piece) placement.setPiece(hand.piece);
    },
  },
  intercept: {
    params: INTERCEPT_PARAMS,
    defaults: INTERCEPT_DEFAULTS,
    cfg: INTERCEPT,
    save: saveIntercept,
    clear: clearIntercept,
    onChange: () => {
      interceptCoverKey = '';
    },
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
    onChange: (p) => {
      fog.applySettings(!p || p.layout); // null = reset all
      rivalView.fog?.applySettings(!p || p.layout);
    },
  },
  globe: {
    params: GLOBE_PARAMS,
    defaults: GLOBE_DEFAULTS,
    cfg: globeCfg,
    save: saveGlobeConfig,
    clear: clearGlobeConfig,
    onChange: (p) => (!p || p.layout) && globe?.relayout(), // null = reset all
  },
});
const hand = new Hand(document.getElementById('hand'), HAND_SIZE, (piece) => placement.setPiece(piece), grid);
hand.perf = perf;

const $ = (id) => document.getElementById(id);
// The tribute gauge (barrels that fill with oil) and the oil flying into it at payout.
const gauge = new BarrelGauge($('quotaBarrels'));
const payoutHud = new PayoutHud(drawOil, drawStore);
const seasonClock = new SeasonClock($('seasonClock'), latch); // the four-season dial right of the tribute plate
setupCrt($('crt')); // the old CRT monitor the world is seen through
const oilFlights = new OilFlights(document.body, gauge, (value) => {
  if (value <= payoutHud.oilAmount(gauge.amount)) return; // includes arrivals already queued this frame
  showOil(value, true);
  barrel(Math.min(1, value / Math.max(1, turn.quota)));
});
const anims = [];
let piecesPlaced = 0;
/** The held card and cell the HUD's forecast was worked out for (null: work it out again). */
let forecastKey = null;

// Turn state: a turn is a season, a round is four seasons, tribute after Winter.
/** Food in the store at the start, so a bad first year isn't an instant loss. */
const STARTING_FOOD = 5;
const turn = { bmCooldown: 0, bmMet: false, strikes: 0, round: 1, season: 0, stockpile: 0, rerolls: 0, event: null, metStreak: 0, lastMissed: false, unlocked: new Set(), pinned: [], coins: 0, total: 0, food: STARTING_FOOD, population: 0, quota: FIRST_QUOTA, capitalHp: CAPITAL_HP, ...freshTargetState() };

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

// ---------- Tutorial (tutorial.js): the guided first Spring, then one-time hints ----------
const tutorial = new Tutorial({
  root: document.getElementById('coach'),
  scene,
  camera: steadyCam,
  hand,
  factory,
  api: {
    grid,
    placement,
    mysteries,
    /** This season if it ended now (food and oil), and the food in the stores. */
    economy: () => economyNow(),
    /** The same, as if `cells` were built as `terrain` (a forecast: nothing changes). */
    economyIf: (terrain, cells) => economyIf(terrain, cells),
    stores: () => turn.food,
    /** The season (0 Spring), and the season the tribute is due in. */
    season: () => turn.season,
    tributeSeason: () => yearLength() - 1,
    /** The board cell under the pointer, or null. */
    cursor: () => hoveredCell(),
    focus: (x, z) => rig.focus(x, z),
    /** Frame the city for the first payout: all of it where it fits, else the Capital and the buildings around it. */
    frameCity: () => {
      const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 300;
      const narrow = window.innerWidth - panel < 600; // (a phone: the city is wider than the board area)
      rig.focus(...(narrow ? [0, 0] : grid.centroid()));
      rig.goalDistance = homeDistance();
    },
    skip: () => skipTutorial(),
    /** 'touch' or 'mouse': the input last used (demonstrations follow it). */
    modality: () => modality,
    isAction: (terrain) => Boolean(ACTIONS[terrain]),
    /** A reroll is possible now (free, or the oil for it). */
    canReroll: () => !hand.isEmpty && (turn.freeRerolls > 0 || turn.stockpile >= rerollCost()),
    /** This card could do something somewhere right now. */
    canPlay: (piece) => canPlay(piece),
    /** The Black Market walkthrough: this card's price taken off your oil, as a ghost (null: none). */
    ghostPrice: (i) => ghostPrice(i),
    /** Which screen is up ('board' | 'globe' | 'rival'), and whether a switch or the globe's flight is under way. */
    view: () => view,
    moving: () => switching || (view === 'globe' && globe.flying), // (the attack phase alone doesn't count)
    /** On the War Map: fly to a city ('player' is Hive City), when its label can't be pointed at. */
    visit: (id) => globe.visit(id),
    rivalIds: () => rivals.map((r) => r.id),
    /** The planet is in view (the guided zoom-out): the season clock's latch. */
    reveal: () => latch(),
    /** The guided Spring's free missile: into the silo. */
    giveMissile: () => {
      tryStoreMissile('missile');
      updateHUD();
    },
    /** Missiles in the silo; strikes aimed this season (anywhere, or at the rival city on screen). */
    missiles: () => missileCount(),
    aimed: () => queuedStrikes().length,
    aimedHere: () => Boolean(rivalShown && queuedStrikes(rivalShown.id).length),
    /** In a rival city: the building of theirs a missile card is shown going to, or null. */
    rivalTarget: () => rivalTarget(),
    /** From Next turn until every missile has landed (the attack phase). */
    attacking: () => warPending || attackLive,
    /** Pre-war Ruins on the board: { cell, clearable } for the nearest (clearable ones first), or null. */
    ruins: () => {
      let best = null;
      for (const c of grid.cells.values()) {
        if (c.terrain !== 'ruins') continue;
        const r = { cell: [c.x, c.z], clearable: canClearRuins(c), d: hexDistance(c.x, c.z) };
        if (!best || (r.clearable && !best.clearable) || (r.clearable === best.clearable && r.d < best.d)) best = r;
      }
      return best;
    },
    /** The rival city on screen (its id), or null. */
    rivalShownId: () => (view === 'rival' ? (rivalShown?.id ?? null) : null),
    /** The first strike's flight, held in the air for you to follow (the city it's aimed at), or null. */
    following: () => following?.to ?? null,
    /** Let a held flight go (the lesson put aside). */
    letGo: () => (following = null),
    /** A Missile Magazine stands on the board; the cell of one (for the lesson to point at), or null. */
    magazineAt: () => {
      const c = [...grid.cells.values()].find((x) => x.terrain === 'magazine');
      return c ? [c.x, c.z] : null;
    },
    /** A season is settling (from Next turn until the new hand: payout, attack phase, scenes). */
    settling: () => turnRunning || warPending || attackLive || eventOpen || payout.active,
    /** The Smuggler is at the gates, and there's oil for something in the Crawler. */
    marketReady: () => bmWait() <= 0 && !turn.over && turn.stockpile >= bmCheapest(),
    /** Show the Black Market plate (the market hint pops it in, then points at it). */
    revealMarket: () => revealBlackMarket(),
    /**
     * The Smuggler's hold while it's on screen (not his dialogue), else null: the aisle open (null: the two crates),
     * the cards you can afford in each aisle (their indexes), and whether anything was bought this visit.
     */
    market: () => {
      if (!blackMarketOpen || $('blackMarket').classList.contains('hidden') || document.body.classList.contains('dialogue')) return null;
      const affordable = (id) => bmStock[id].flatMap(([, price, sold], i) => (!sold && turn.stockpile >= price ? [i] : []));
      return {
        aisle: bmCategory,
        affordable: { military: affordable('military'), resource: affordable('resource') },
        bought: Object.values(bmStock).some((items) => items.some((it) => it[2])),
      };
    },
  },
});
// While the guided opening runs, only what it allows responds (tutorial.allows).
// In a rival city with the missile hand out, missile cards can be picked (and dragged onto a tile to aim them).
hand.guard = (action, piece) =>
  (view === 'rival' && rivalHand && isPlayerMissile(piece?.terrain) && !screenBusy()) || (!busy() && tutorial.allows(action, piece));
// A parked card (the guided opening's Wasteland, waiting for the Farm and the Station) shakes; the one to play hops.
hand.onBlocked = (piece) => {
  if (tutorial.active && tutorial.parks(piece)) tutorial.rejected({ code: 'parked' }, piece);
};
hand.parked = (piece) => tutorial.parks(piece);
hand.onRotate = (piece) => {
  tutorial.notify('rotated', { piece });
  updateRotateButton();
};
{
  const setPiece = hand.onChange;
  hand.onChange = (piece) => {
    setPiece(piece);
    if (piece) tutorial.notify('selected', { piece });
    updateRotateButton();
  };
}
// The tutorial's placement rule, as an answer only: hovering a cell never sets off its feedback.
placement.guard = (cells, piece) => tutorial.check(cells, piece);

/** The input in use: touch or mouse (pen counts as touch). Demonstrations show the matching gesture. */
let modality = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
window.addEventListener(
  'pointerdown',
  (e) => {
    modality = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    document.body.classList.toggle('touch', modality === 'touch');
  },
  { capture: true },
);
document.body.classList.toggle('touch', modality === 'touch');

/**
 * The camera distance the city opens at: 15 on a wide screen; a little further out when the board area (left of the
 * panel) is narrow, so the Capital and its six neighbours fit.
 */
function homeDistance() {
  const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 300;
  const board = Math.max(160, window.innerWidth - panel);
  // ...but no further than where the map icons start to replace the models (zoomIcons fadeNear): the opening is
  // about seeing the buildings themselves. The tutorial pans to anything it points at that's off screen.
  return THREE.MathUtils.clamp(15 * Math.max(1, 560 / board), rig.minDistance, Math.min(rig.maxDistance, iconCfg.fadeNear));
}

/** The economy as if `cells` were built as `terrain` (forecasts only). */
const economyIf = (terrain, cells) =>
  computeEconomyIf(grid, { mods: turn.event?.mods, population: turn.population, foodStore: turn.food }, terrain, cells);

/** Whether a card could do anything right now: a tile somewhere legal, an action with something to act on. */
function canPlay(piece) {
  const keep = placement.piece;
  placement.piece = piece;
  try {
    const offs = ACTIONS[piece.terrain] ? [[0, 0]] : pieceOffsets(piece);
    const cells = ACTIONS[piece.terrain] ? [...grid.cells.values()].map((c) => [c.x, c.z]) : [...grid.openKeys()].map((k) => k.split(',').map(Number));
    for (const [x, z] of cells.slice(0, 400)) if (placement.validate(offs.map(([a, b]) => [x + a, z + b])).ok) return true;
    return false;
  } finally {
    placement.piece = keep;
  }
}
/** Debug tools and shortcuts are off during the tutorial (it has to stay on script). */
/** True while something owns the screen (dialogue, missiles, shop, payout). */
const screenBusy = () => eventOpen || striking || shopOpen || blackMarketOpen || payout.active || turn.over;
/** The War Map stays shut while the screen is busy, and during the tutorial (except on its own trip to the planet). */
/** Only the payout is running (no screen up): the War Map may open, the season keeps paying out there. */
const onlyPaying = () => payout.active && !(eventOpen || striking || shopOpen || blackMarketOpen || turn.over || previewing);
const mapBlocked = () => (screenBusy() && !attackLive && !onlyPaying()) || (tutorial.active && !tutorial.allows('globe'));
/** Also true off the board, so the hand, the ghost and placement ignore the War Map and rival cities. (Not the
    tutorial: its guard decides which cards it lets through.) */
const busy = () => screenBusy() || view !== 'board';
const tutorialBlocks = () => {
  if (!tutorial.active) return false;
  tutorial.rejected({ code: 'early' });
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

/** What a camp kind does: its flat amount, plus (for Rebel Camps) what all of them take right now. */
function campEffect(kind) {
  const e = economyNow();
  const d = TERRAINS[kind].stats.drain;
  const all = (e.camps[d] ?? 0) > 1 ? L(' (all camps)', '（所有营地合计）') : '';
  if (d === 'slots') return L(`-${SCALE.rebelSlots} worker slots each, -${e.rebelManpower} now${all}`, `每个营地人力 -${SCALE.rebelSlots}，当前 -${e.rebelManpower} 人力${all}`);
  if (d === 'banditSlots') return L(`-${SCALE.banditSlots} worker slots`, `-${SCALE.banditSlots} 人力`);
  if (d === 'oil') return L(`-${SCALE.banditOil} oil`, `-${SCALE.banditOil} 石油`);
  return L(`-${SCALE.banditFood} food`, `-${SCALE.banditFood} 食物`);
}

/** Keeps the food store within what the Capitals can hold (after rewards, Spark, lost Capitals…). */
const clampFood = () => (turn.food = Math.max(0, Math.min(turn.food, foodCapOf(grid))));

// Tiles that can't be drawn yet: no Cliffs during the first round.
/** Guaranteed opening hand (shuffled). Extra slots, if HAND_SIZE grows, are drawn at random. */
const OPENING_HAND = ['farm', 'settlement', 'station', 'wasteland', 'wasteland'];

// The opening hand (first season, rerolls included) only has the basics: Wasteland, stations, farms, settlements.
const OPENING_TILES = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4', 'station', 'farm', 'settlement'];
/** `?alltiles=1`: every tile unlocked, first hand is one of each, then the run plays as normal. */
const ALL_TILES = new URLSearchParams(location.search).has('alltiles');
const allPlaceableKeys = () => [
  ...Object.keys(TERRAINS).filter((k) => k !== 'capital' && !/^wasteland[2-4]$/.test(k)),
  ...Object.keys(ACTIONS),
];
hand.excluded = () => {
  if (ALL_TILES) return [];
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
 * bare: an empty holder. Wasteland no longer uses one (each cell drops on its own).
 */
function addTile(x, z, terrain, delay = 0, instant = false, { bare = false, rot = 0 } = {}) {
  // Mix wasteland shades per cell so a wasteland piece doesn't look like one flat slab.
  if (WASTELAND_VARIANTS.includes(terrain)) {
    terrain = WASTELAND_VARIANTS[Math.floor(Math.random() * WASTELAND_VARIANTS.length)];
  }
  const old = grid.get(x, z);
  const onRuins = old?.terrain === 'ruins' || (old?.onRuins ?? false);
  if (old) removeMesh(old.mesh);

  const mesh = factory.create(terrain, { bare, rot, seed: cellSeed(x, z) });
  mesh.userData.rot = rot; // kept for the stand-in -> model swap (factory.upgrade)
  const w = hexToWorld(x, z);
  mesh.position.set(w.x, 0, w.z);
  mesh.visible = instant;
  tiles.add(mesh);
  grid.set(x, z, {
    terrain,
    mesh,
    onRuins,
    missileProgress: terrain === 'milfactory' ? 0 : undefined,
    missileReady: terrain === 'milfactory' ? false : undefined,
    buildProgress: isMilitaryLab(terrain) ? 0 : undefined,
    built: isMilitaryLab(terrain) ? false : undefined,
    buildHalted: isMilitaryLab(terrain) ? false : undefined,
  });
  if (!instant) anims.push({ mesh, t: -delay, landed: false, waste: terrain.startsWith('wasteland'), build: isBuilding(terrain) });
}

/** Swap any flat stand-in that now has a loaded blockout, including one still falling. */
function adoptBlockouts() {
  for (const cell of grid.cells.values()) {
    if (!hasBlockout(cell.terrain)) continue;
    const previous = cell.mesh;
    const next = factory.upgrade(previous, cell.terrain);
    if (next === previous) continue;
    const anim = anims.find((a) => a.mesh === previous);
    if (anim) {
      releaseGround(anim);
      anim.mesh = next;
    }
    cell.mesh = next;
    if (cell.terrain === 'milfactory') setPadMissile(cell, cell.missileReady);
  }
  shadeIdle(); // a stand-in swapped for its model takes over the grey
  if (hand.piece) placement.setPiece(hand.piece);
}

factory.ready.then(adoptBlockouts);

function removeMesh(mesh) {
  tiles.remove(mesh);
  const i = anims.findIndex((a) => a.mesh === mesh);
  if (i >= 0) {
    releaseGround(anims[i]);
    anims.splice(i, 1);
  }
  const piece = mesh.userData.piece;
  if (piece && !piece.broken) breakWastePiece(piece, mesh);
}

// ---------- Wasteland pieces ----------
/** Gap before the next hex of a Wasteland piece starts falling. The fall itself is DROP.fall (0.24s). */
const WASTE_DROP_GAP = 0.08;

/**
 * A Wasteland piece lands as separate hexes, one after another, each with its own rock thud.
 * Every cell still points at the piece record: { shape, rot, cells: keys, lead, group: null, broken },
 * so covering one cell still breaks the rest. The drag preview stays one connected shape.
 * Before the piece models have loaded, the cells get coloured blocks and adoptWastePieces upgrades them later.
 */
/** Drop order: the hex that touches land you already have, then outward. Shape order can start on the dangling end. */
function wasteDropOrder(cells) {
  const neighbours = (x, z) => DIRS.reduce((n, [dx, dz]) => n + (grid.has(x + dx, z + dz) ? 1 : 0), 0);
  const rooted = cells.filter(([x, z]) => grid.has(x, z) || grid.touchesIsland(x, z));
  let anchor = cells[0];
  let best = -1;
  for (const cell of rooted.length ? rooted : cells) {
    const n = neighbours(...cell);
    if (n > best) {
      best = n;
      anchor = cell;
    }
  }
  const index = new Map(cells.map((c, i) => [plotKey(...c), i]));
  const rest = cells.filter((c) => c !== anchor);
  rest.sort((a, b) => hexDistance(...anchor, ...a) - hexDistance(...anchor, ...b) || index.get(plotKey(...a)) - index.get(plotKey(...b)));
  return [anchor, ...rest];
}

function addWastePiece(piece, cells) {
  const [lx, lz] = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const rec = { shape: piece.shape, rot: piece.rot, seed: piece.id, cells: cells.map(([x, z]) => plotKey(x, z)), lead: plotKey(lx, lz), group: null, broken: false };
  const mid = cellsCentre(cells);
  wasteDropOrder(cells).forEach(([x, z], i) => {
    addTile(x, z, piece.terrain, i * WASTE_DROP_GAP, false);
    const cell = grid.get(x, z);
    cell.mesh.userData.piece = rec;
    const w = hexToWorld(x, z);
    factory.fillWastePart(cell.mesh, cell.terrain, rec, [w.x - mid.x, w.z - mid.z], cellSeed(x, z));
  });
}

/**
 * A cell of the piece was removed or replaced: the whole-piece model goes, and each cell left shows its own part of
 * it, just where it was (so the rest of the piece looks the same).
 */
function breakWastePiece(rec, removed) {
  rec.broken = true;
  if (rec.group) {
    tiles.remove(rec.group);
    const i = anims.findIndex((a) => a.mesh === rec.group);
    if (i >= 0) {
      releaseGround(anims[i]);
      anims.splice(i, 1);
    }
  }
  for (const k of rec.cells) {
    const c = grid.cells.get(k);
    if (!c || c.mesh === removed || c.mesh.userData.piece !== rec) continue;
    if (rec.group) fillLeftover(c, rec); // (without a model the cells already show blocks)
    c.mesh.visible = true;
  }
}

/** A cell left of a broken Wasteland piece: its part of the piece's model (factory.fillWastePart). */
function fillLeftover(c, rec) {
  const mid = cellsCentre(rec.cells.map((k) => k.split(',').map(Number)));
  const w = hexToWorld(c.x, c.z);
  factory.fillWastePart(c.mesh, c.terrain, rec, [w.x - mid.x, w.z - mid.z], cellSeed(c.x, c.z));
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
      if (done.has(rec)) continue;
      done.add(rec);
      // Stay separate hexes. Each one takes the look it had in the piece, once the models exist.
      const mid = cellsCentre(rec.cells.map((k) => k.split(',').map(Number)));
      for (const k of rec.cells) {
        const c = grid.cells.get(k);
        if (!c || c.mesh.userData.blockout) continue;
        const w = hexToWorld(c.x, c.z);
        factory.fillWastePart(c.mesh, c.terrain, rec, [w.x - mid.x, w.z - mid.z], cellSeed(c.x, c.z));
      }
    } else if (!cell.mesh.userData.blockout) {
      if (rec) fillLeftover(cell, rec); // broken before the models came: its part of the piece all the same
      else factory.fillWaste(cell.mesh, cell.terrain, cellSeed(cell.x, cell.z));
    }
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
/** Black Market: open from the click until the Smuggler has left (dialogue and stall). Stock: [[key, price, sold]]. */
let blackMarketOpen = false;
let bmStock = { military: [], resource: [] }; // each aisle: [[key, price, sold]]
let bmCategory = null; // null: choosing an aisle
/** True while the attack phase's missiles are in the air: you can look around (board, War Map, rivals) but not play. */
let attackLive = false;
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** Missiles for the nth missed tribute (Game Debug → Missiles: 1, 3, 5). */
const strikeCount = (strikes) => Math.max(1, Math.round(missileCfg[`count${Math.min(Math.max(strikes, 1), 3)}`]));

/** The Hive City the strike centres on: the Capital nearest the middle (a mystery can add more). */
function mainCapital() {
  const caps = [...grid.cells.values()].filter((c) => c.terrain === 'capital');
  return caps.sort((a, b) => hexDistance(a.x, a.z) - hexDistance(b.x, b.z))[0] ?? null;
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

/** Spend 3 oil at an unused adjacent Intercept Network to save this tile from one incoming hit. */
function tryIntercept(x, z, used) {
  const nets = interceptorsBeside(grid, x, z).filter((n) => !used.has(`${n.x},${n.z}`));
  if (!nets.length || turn.stockpile < INTERCEPT_OIL) return false;
  turn.stockpile -= INTERCEPT_OIL;
  used.add(`${nets[0].x},${nets[0].z}`);
  showOil(turn.stockpile, true);
  return true;
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
  const c = mainCapital() ?? { x: 0, z: 0 };
  const cap = hexToWorld(c.x, c.z);
  const reach = Math.max(0, ...targets.map((t) => {
    const w = hexToWorld(t.x, t.z);
    return Math.hypot(w.x - cap.x, w.z - cap.z);
  }));
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
async function playMissileStrike(targets, { convert = true, restoreCamera = true, follow = false, prelude = null, onCover = null, holdAfter = null, skipLead = false, trackCamera = true, free = false } = {}) {
  const run = runId;
  const lost = [];
  const interceptUsed = new Set();
  if (!targets.length) return lost;
  const prevEvent = eventOpen;
  // free: no cinematic at all (the attack phase). The camera, HUD and keys stay yours; the missiles come in
  // from just off the edge of whatever you're looking at.
  if (free) {
    restoreCamera = false;
    trackCamera = false;
    skipLead = true;
  } else {
    striking = true;
    eventOpen = true;
    hand.select(-1);
    if (previewing) cancelPreview();
    document.body.classList.add('striking');
    rig.locked = true;
  }
  const saved = { goal: rig.goal.clone(), distance: rig.goalDistance };
  const endStrike = (prev) => !free && endCinematic(prev);
  if (follow) {
    // Ground launch: close up on the launch cell, then the camera rides along with the missile.
    const from = targets[0].from;
    followDist = FOLLOW_CLOSE;
    const f = hexToWorld(from.x, from.z);
    followCamera(new THREE.Vector3(f.x, 0, f.z), FOLLOW_CLOSE, 5);
    await wait(0.6);
    if (run !== runId) {
      endStrike(prevEvent);
      return lost;
    }
    await prelude?.();
    if (run !== runId) {
      endStrike(prevEvent);
      return lost;
    }
  } else if (!skipLead) {
    strikeCamera(targets);
    await wait(missileCfg.camLead);
    if (run !== runId) {
      endStrike(prevEvent);
      return lost;
    }
  }
  // The camera tracks the missiles in flight: one is followed, centred all the way down; several are framed
  // together (every missile in the air and the targets still to be hit), reframing as they come down.
  const flying = new Map(); // target -> { pos, u }
  const pending = new Set(targets);
  const track = (pos, t, u) => {
    if (run !== runId) return;
    const f = flying.get(t);
    if (f) {
      f.pos.copy(pos);
      f.u = u;
    } else flying.set(t, { pos: pos.clone(), u });
    if (targets.length === 1) {
      // Pull back as it climbs, and by the end far enough that the target is in the shot.
      // (Never zooms back in: the impact is seen from as far out as the flight got.)
      const tw = hexToWorld(t.x, t.z);
      const reach = Math.hypot(tw.x - pos.x, tw.z - pos.z);
      if (!follow) followDist = Math.max(followDist, missileCfg.camMinDistance * 0.6);
      followDist = Math.max(followDist, FOLLOW_CLOSE + pos.y * 1.1 + reach * 0.6 * u);
      followCamera(pos, followDist, missileCfg.camFollowRate);
    } else
      frameStrike([
        ...[...flying.values()].map((m) => m.pos),
        ...[...pending].map((p) => {
          const w = hexToWorld(p.x, p.z);
          return new THREE.Vector3(w.x, 0, w.z);
        }),
      ]);
  };
  followDist = follow ? followDist : FOLLOW_CLOSE;
  // From the sky, the Overlord's missiles fly a little slower so the camera can keep up (ground launches set their own).
  // Missiles fly in world space: each target's cell (grid coordinates) becomes its world position for the flight,
  // and rides along as `cell` for the crater, dust and fog.
  const toWorld = (c) => {
    const w = hexToWorld(c.x, c.z);
    return { x: w.x, z: w.z };
  };
  const tracked = targets.map((t) => ({
    ...t,
    ...toWorld(t),
    cell: { x: t.x, z: t.z },
    from: t.from ? (t.from.world ? t.from : toWorld(t.from)) : undefined, // world: already a world point (hand card, silo)
    flight: t.from || t.flight ? t.flight : missileCfg.followFlight,
  }));
  const original = new Map(tracked.map((t, i) => [t, targets[i]]));
  const whoosh = new Map(tracked.map((t) => [t, missileWhoosh(t)]));
  await missiles.fire(tracked, {
    onMove: (pos, t, u) => {
      if (trackCamera) track(pos, original.get(t), u);
      fireDefences(t, u);
    },
    onIntercept: (hit) => {
      if (run !== runId) return;
      whoosh.get(hit)?.stop(0.25);
      explode('small');
      flying.delete(original.get(hit));
      pending.delete(original.get(hit));
    },
    onImpact: (hit) => {
      if (run !== runId) return;
      flying.delete(original.get(hit));
      pending.delete(original.get(hit));
      whoosh.get(hit)?.stop(0.12);
      explode(hit.harmless ? 'small' : 'large');
      const { x, z } = hit.cell;
      dust.burst(x, z, hit.harmless ? 0.7 : 1.8);
      fog.disturb(x, z);
      camShake.add(missileCfg.shake * (hit.harmless ? 0.3 : 1));
    },
    onCover: (hit) => {
      if (run !== runId) return;
      // x/z on the target are world units after the hex bend; the cell is the hex the crater belongs to.
      const { x, z } = hit.cell ?? hit;
      if (onCover) {
        onCover({ x, z }, original.get(hit));
        return;
      }
      if (!convert) return;
      if (tryIntercept(x, z, interceptUsed)) return;
      const name = craterAt(x, z);
      if (name) lost.push(name);
    },
  });
  if (run !== runId) {
    endStrike(prevEvent);
    return lost;
  }
  await wait(holdAfter ?? missileCfg.holdAfter);
  if (run !== runId) {
    endStrike(prevEvent);
    return lost;
  }
  if (restoreCamera) {
    rig.goal.copy(saved.goal);
    rig.goalDistance = saved.distance;
    await wait(0.7);
    if (run !== runId) {
      endStrike(prevEvent);
      return lost;
    }
  }
  endStrike(prevEvent);
  return lost;
}

/**
 * An attack-phase strike on your board (target.shots from war.js): each Intercept Network that fires opens up
 * with its CIWS turret as the missile comes down; a successful one shoots it out of the sky.
 */
const CIWS_START = 0.22;
const CIWS_GAP = 0.14;
function fireDefences(t, u) {
  // A simulated strike's guns play from setDefence. This list is the older cinematic path.
  if (typeof t.clock === 'function') return;
  const shots = t.shots;
  if (!shots?.length) return;
  t.fired ??= 0;
  while (t.fired < shots.length && u >= CIWS_START + CIWS_GAP * t.fired) {
    const shot = shots[t.fired++];
    const pad = hexToWorld(shot.x, shot.z);
    missiles.fireCIWS(findCiws(grid.get(shot.x, shot.z)?.mesh), new THREE.Vector3(pad.x, 0.35, pad.z), () => missiles.position(t), {
      success: shot.success,
      onFire: (dur) => gunSnd(dur),
      onKill: () => {
        if (missiles.destroy(t)) {
          camShake.add(missileCfg.shake * 0.35);
          explode('small');
        }
      },
    });
  }
}

function endCinematic(prevEvent) {
  document.body.classList.remove('striking');
  striking = false;
  eventOpen = prevEvent;
  rig.release();
}

/**
 * Several missiles in the air: one shot that shows them all (each point where it sits on screen: its ground point
 * along the view direction), centred on them and zoomed out to fit, easing at the tracking speed.
 */
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
  // A wider margin than strikeCamera: missiles in the air shouldn't hug the screen edge.
  const dist = THREE.MathUtils.clamp(Math.max(missileCfg.camMinDistance, (reach + 2.5) * 2.8 * missileCfg.camFit), rig.minDistance, rig.maxDistance);
  const rate = missileCfg.camFollowRate * 0.35; // a wide shot moves more calmly
  rig.posRate = rate;
  rig.zoomRate = rate * 0.8;
  rig.goalDistance = dist;
  const view = camera.view?.enabled ? camera.view : { offsetX: 0, offsetY: 0 };
  rig.goal.set((x0 + x1) / 2, 0, (z0 + z1) / 2).add(rig.screenShift(view.offsetX, view.offsetY, dist));
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
 * A missile launches from the ground at `spot` and hits `target` (the old Missile Magazine of a "?" site). silo: a Missile Magazine cell on the spot, which opens and fires it (otherwise the
 * missile stands upright on the spot). Resolves with the names of the tiles lost, or null if the run was reset meanwhile.
 */
async function groundStrike(spot, target, lostText = (l) => L(`The silo's missile destroyed your ${l}`, `发射井的导弹摧毁了你的${l}`), silo = null) {
  const run = runId;
  eventOpen = true; // locked from the moment it is called, through the lead-in
  hand.select(-1);
  await wait(0.3);
  if (run !== runId) return null;
  // The camera closes in on the spot; the missile rises (out of the silo, or standing up and shaking), launches and
  // is followed.
  const t = { ...target, from: spot, flight: 2.6, accel: 1.1 };
  let standing = null;
  let prelude;
  if (silo) {
    prelude = async () => {
      const from = await siloLaunch(silo, 1, (f) => f);
      if (from) t.from = from; // on from the silo's mouth
    };
  } else {
    const at = hexToWorld(spot.x, spot.z); // missiles.js works in world positions
    standing = missiles.showUpright(at.x, at.z);
    prelude = async () => {
      standing.rumble();
      camShake.add(0.3);
      await wait(1.2);
      standing.remove();
      launchSnd();
      dust.burst(spot.x, spot.z, 1.6);
    };
  }
  const lost = await playMissileStrike([t], { follow: true, prelude });
  standing?.remove();
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
  const d = (c) => hexDistance(c.x, c.z, x, z);
  const best = Math.min(...pool.map(d));
  const near = pool.filter((c) => d(c) === best);
  const c = near[Math.floor(Math.random() * near.length)];
  return { x: c.x, z: c.z };
}

/**
 * A "?" site was an old Missile Magazine with a missile still in it (an Unexploded Missile). The magazine surfaces on
 * the site and stays there, a working one like one you build. A coin flip (siloFires) decides the rest: it opens and
 * fires at `target` (default: your nearest building), or its missile is recovered into your stockpile. Firing with
 * nothing to hit, the missile gets stuck in the silo's mouth and a second later blows up there, harming nothing.
 */
async function unexplodedMissile(site, target = nearestBuilding(site.x, site.z), fires = siloFires()) {
  if (!fires) return recoveredMissile(site);
  const run = runId;
  if (target) {
    eventOpen = true; // locked through the magazine's landing, then the strike
    hand.select(-1);
  }
  addTile(site.x, site.z, 'magazine', 0.1);
  dust.burst(site.x, site.z, 1.4);
  camShake.add(0.6);
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  shadeIdle();
  updateHUD();
  toast(
    target
      ? L('Uncovered an old Missile Magazine, and its missile launched!', '发现一座旧储弹仓，里面的导弹发射了！')
      : L('Uncovered an old Missile Magazine... its missile blew up in the silo', '发现一座旧储弹仓……里面的导弹在发射井里炸了'),
    target ? 'bad' : 'good',
    2400,
  );
  await wait(0.9); // it lands
  if (run !== runId) return;
  const cell = grid.get(site.x, site.z);
  // (its model may not have loaded yet: the missile then stands on the site as before)
  const silo = cell?.terrain === 'magazine' && !cell.mesh.userData.launching && factory.canCue(cell.mesh, 'Launch') ? cell : null;
  if (target) {
    groundStrike({ x: site.x, z: site.z }, target, (l) => L(`The old magazine's missile destroyed your ${l}`, `旧储弹仓的导弹摧毁了你的${l}`), silo);
  } else if (silo) siloDud(silo);
  else uprightDud(site);
}

/**
 * The silo held fire: the magazine surfaces with its missile intact and it goes into your stockpile. If the stockpile
 * is full, the missile waits in this magazine (cell.heldMissile) and moves in once there is room (storeHeldMissiles).
 */
function recoveredMissile(site) {
  addTile(site.x, site.z, 'magazine', 0.1);
  dust.burst(site.x, site.z, 1.4);
  frontier.rebuild(grid);
  placement.cell = null; // force ghost revalidation
  const cell = grid.get(site.x, site.z);
  if (cell) cell.heldMissile = true;
  const stored = storeHeldMissiles();
  shadeIdle();
  updateHUD();
  toast(
    stored
      ? L('Uncovered an old Missile Magazine. Its missile is yours: +1 missile', '发现一座旧储弹仓。里面的导弹归你了：+1 导弹')
      : L('Uncovered an old Missile Magazine. Its missile waits inside until you have room', '发现一座旧储弹仓。导弹暂存其中，等你有空位再入库'),
    'good',
    2600,
  );
}

/** Missiles recovered from old silos, waiting for room: into the stockpile while it has space. Returns how many moved. */
function storeHeldMissiles() {
  let moved = 0;
  for (const cell of grid.cells.values()) {
    if (!cell.heldMissile) continue;
    if (cell.terrain !== 'magazine') {
      delete cell.heldMissile; // the magazine was destroyed: its missile went with it
      continue;
    }
    if (!tryStoreMissile('missile')) break;
    delete cell.heldMissile;
    moved++;
  }
  return moved;
}

/** How long a missile with nothing to hit sits in place before it blows up (seconds). */
const DUD_HOLD = 1;

/** A magazine's missile with nothing to hit: it rises into the silo's mouth, sits there, and blows up in place. */
function siloDud(cell) {
  const mesh = cell.mesh;
  mesh.userData.launching = true;
  return factory.cue(mesh, 'Launch', {
    speed: SILO_SPEED,
    cutAt: SILO_STUCK,
    hide: SILO_PARTS,
    hold: DUD_HOLD,
    cut: () => camShake.add(0.15),
    onResume: () => {
      const missile = mesh.getObjectByName(SILO_PARTS[0]);
      dudBurst(missile ? missile.getWorldPosition(new THREE.Vector3()).add(DUD_MIDDLE) : null, cell);
    },
    onEnd: () => (mesh.userData.launching = false),
  });
}

/** The same with no magazine model to fire it (not loaded yet): it stands up on the site, shakes, and blows up. */
function uprightDud(site) {
  const run = runId;
  const at = hexToWorld(site.x, site.z); // missiles.js works in world positions
  const dud = missiles.showUpright(at.x, at.z);
  dud.rumble();
  setTimeout(() => {
    dud.remove();
    if (run === runId) dudBurst(new THREE.Vector3(at.x, 0.35, at.z), site);
  }, (0.5 + DUD_HOLD) * 1000); // (it takes half a second to stand up)
}

const DUD_MIDDLE = new THREE.Vector3(0, 0.15, 0); // from a magazine missile's tail to its middle (world units)

/** A missile blowing up where it is: flash, fire and smoke, a jolt; nothing around it is harmed. */
function dudBurst(pos, cell) {
  if (pos) missiles.airBurst(pos, true);
  boom();
  camShake.add(0.5);
  dust.burst(cell.x, cell.z, 1.4);
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

/**
 * Debug (M): play a strike right now (Game Debug → Missiles · preview). `convert`: the hit tiles become craters;
 * `capital`: one may hit the Capital (defaults: the preview's settings).
 */
function previewMissileStrike({ convert = missileCfg.previewCraters === 'yes', capital = missileCfg.previewCapital === 'yes' } = {}) {
  if (turn.over) return 'Game over: restart first';
  if (striking || shopOpen || eventOpen || payout.active) return 'Finish the current screen first';
  const n = Math.max(1, Math.round(missileCfg.previewCount));
  const targets = pickStrikeTargets(n, capital);
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
  playMissileStrike(targets, { convert }).then((lost) => {
    if (run !== runId) return;
    eventOpen = false;
    reportStrike(lost);
    updateHUD();
    if (lost.length) toast(() => L(`The Overlord's missiles destroyed your ${listLost(lost)}`, `霸主的导弹摧毁了你的${listLost(lost)}`), 'bad', 2600);
  });
  return `Missile strike: ${targets.length} missile${targets.length === 1 ? '' : 's'}`;
}

// Bottom left: a missile strike at will, on random buildings (never the Capital), which become Toxic Craters.
// As many missiles as Game Debug → Missiles · preview sets (3 by default).
$('btnMissile').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  btn.blur();
  const busyNow = turn.over || striking || shopOpen || eventOpen || payout.active || tutorial.active || view !== 'board';
  if (busyNow) {
    btn.classList.remove('refused');
    void btn.offsetWidth;
    btn.classList.add('refused');
    return;
  }
  previewMissileStrike({ convert: true, capital: false });
});

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
    ['btnHive', '返回蜂巢城'],
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
  if (view === 'rival' && rivalShown) fillRivalBar(rivalShown);
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
  tutorial.notify('ruinsCleared');
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
    const w = hexToWorld(c.x, c.z);
    ruinV.set(w.x, 0.55, w.z).project(steadyCam);
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

const factoryBars = new Map();
const factoryBarV = new THREE.Vector3();
/**
 * The highest points of a tile's model (smoke aside), in its holder's own space: what a label above it has to clear
 * on screen. A few dozen vertices off the top, so projecting them each frame costs next to nothing.
 */
const _topBox = new THREE.Box3();
const _topV = new THREE.Vector3();
function topPoints(holder) {
  if (holder.userData.topPts) return holder.userData.topPts;
  holder.updateMatrixWorld(true);
  const toHolder = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  let maxY = 0.9;
  holder.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry) return;
    for (let q = o; q && q !== holder; q = q.parent) if (/Smoke|Steam/.test(q.name)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const y = _topBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).max.y;
    _topV.set(0, y, 0).applyMatrix4(toHolder);
    if (_topV.y > maxY) maxY = _topV.y;
  });
  holder.userData.topPts = [new THREE.Vector3(0, maxY, 0)];
  return holder.userData.topPts;
}
const FACTORY_FILL_MS = 450;
const FACTORY_HOP = 0.5;
const factoryFloaters = [];
const factoryHops = [];
const factoryJobs = [];
const factoryPaid = [];
const labsPaid = [];
let labOilPool = 0;

function previewFactoryBar(x, z) {
  const c = grid.get(x, z);
  if (!c) return;
  const k = `${x},${z}`;
  let rec = factoryBars.get(k);
  if (!rec) {
    rec = { el: null, filled: -1, need: 0, preview: null };
    factoryBars.set(k, rec);
  }
  rec.preview = Math.min(yearLength(), ((c.terrain === 'milfactory' ? c.missileProgress : c.buildProgress) ?? 0) + 1);
}

function hopFactory(cell) {
  const mesh = cell.mesh ? payoutMesh(cell) : null;
  if (!mesh) return Promise.resolve();
  return new Promise((resolve) => factoryHops.push({ mesh, t: 0, done: resolve }));
}

function updateFactoryHops(dt) {
  const c = payoutCfg;
  for (let i = factoryHops.length - 1; i >= 0; i--) {
    const h = factoryHops[i];
    h.t += dt;
    if (h.t >= FACTORY_HOP) {
      h.mesh.scale.set(1, 1, 1);
      h.mesh.position.y = 0;
      factoryHops.splice(i, 1);
      h.done();
    } else {
      const { y, sx, sy } = tileHop(h.t, { ...c, hopDuration: FACTORY_HOP });
      h.mesh.scale.set(sx, sy, sx);
      h.mesh.position.y = y;
    }
  }
}

/** Fill the pip, hop the factory, then bump the silo if the bar is full. */
async function chargeOneFactory(cell) {
  const idle = idleKeySet();
  const need = yearLength();
  const run = runId;
  if ((cell.missileProgress ?? 0) >= need) {
    if (run !== runId) return { count: 0 };
    return finishFactoryMissile(cell, idle);
  }
  // A new missile starts: the finished one on the pad sinks back into the ground.
  if (cell.missileReady) setPadMissile(cell, false, { animate: view === 'board' });
  // Its oil is paid out of the gauge: a red "-N oil" over the factory, and barrels fly from the gauge into it.
  // The pip fills as they land.
  spawnFactoryFloater(cell, `<div class="row neg" style="--c:#ff5a44"><b>-${FACTORY_OIL}</b>${ICONS.oil}</div>`);
  await flyOilToFactory(cell, FACTORY_OIL);
  if (run !== runId) return { count: 0 };
  previewFactoryBar(cell.x, cell.z);
  await wait(FACTORY_FILL_MS / 2000);
  if (run !== runId) return { count: 0 };
  thud();
  await hopFactory(cell);
  if (run !== runId) return { count: 0 };
  factoryPaid.push(cell);
  cell.missileProgress = (cell.missileProgress ?? 0) + 1;
  if (cell.missileProgress >= need) return finishFactoryMissile(cell, idle);
  const rec = factoryBars.get(`${cell.x},${cell.z}`);
  if (rec) rec.preview = null;
  return { count: 0 };
}

function oilPoolForLabs(e = economyNow()) {
  let oil = turn.stockpile + e.oil;
  const need = yearLength();
  for (const c of grid.cells.values()) {
    if (c.terrain !== 'milfactory') continue;
    if ((c.missileProgress ?? 0) >= need) continue;
    oil -= FACTORY_OIL;
  }
  return oil;
}

/** One season of construction on a Recipe Lab or Warhead Institute. Finished labs stop paying oil. */
async function chargeOneLab(cell) {
  if (cell.built) return;
  const need = yearLength();
  const cost = labOilCost(cell.terrain);
  const run = runId;
  if (labOilPool < cost) {
    cell.buildHalted = true;
    return;
  }
  labOilPool -= cost;
  cell.buildHalted = false;
  spawnFactoryFloater(cell, `<div class="row neg" style="--c:#ff5a44"><b>-${cost}</b>${ICONS.oil}</div>`);
  await flyOilToFactory(cell, cost);
  if (run !== runId) return;
  previewFactoryBar(cell.x, cell.z);
  await wait(FACTORY_FILL_MS / 2000);
  if (run !== runId) return;
  thud();
  await hopFactory(cell);
  if (run !== runId) return;
  labsPaid.push(cell);
  cell.buildProgress = (cell.buildProgress ?? 0) + 1;
  if (cell.buildProgress >= need) {
    cell.built = true;
    dropLabBar(cell);
    toast(
      cell.terrain === 'warhead'
        ? L('Warhead Institute finished: missiles hit +1 tile', '弹头研究所建设完成：导弹多打 1 格')
        : cell.terrain === 'booster'
          ? L('Launch Accelerator finished: nearby launches fly faster', '发射加速器建设完成：附近发射的导弹飞得更快')
          : L('Recipe Lab finished: neighbouring factories produce +1 Missile', '配方改良所建设完成：相邻工厂产量 +1'),
      'good',
    );
    return;
  }
  const rec = factoryBars.get(`${cell.x},${cell.z}`);
  if (rec) rec.preview = null;
}

async function finishFactoryMissile(cell, idle) {
  const run = runId;
  const y = factoryYield(grid, cell, idle);
  const room = Math.max(0, currentMissileCap(idle) - missileCount());
  const n = Math.min(y.count, room);
  if (n <= 0) return { ...y, count: 0, stuck: true };
  await playMissileMade(cell, n, y.kind);
  if (run !== runId) return { count: 0 };
  cell.missileProgress = 0;
  const rec = factoryBars.get(`${cell.x},${cell.z}`);
  if (rec) rec.preview = null;
  updateHUD();
  return { ...y, count: n };
}

/**
 * A staffed Decoy Builder does a season of work (its oil comes out of the season's yield, economy.js); every
 * DECOY.seasons it banks a Decoy. Decoys do not take a missile slot. animate: rise from the tile.
 */
async function chargeDecoyWorks(cell, animate = true) {
  const run = runId;
  const idle = idleKeySet();
  if (idle.has(`${cell.x},${cell.z}`)) return { decoy: true, count: 0, idle: true };
  cell.decoyProgress = Math.min(DECOY.seasons, (cell.decoyProgress ?? 0) + 1);
  if (cell.decoyProgress < DECOY.seasons) return { decoy: true, count: 0 };
  if (animate) {
    await hopFactory(cell);
    if (run !== runId) return { decoy: true, count: 0 };
    await playMissileMade(cell, 1, 'decoy');
    if (run !== runId) return { decoy: true, count: 0 };
  } else if (!tryStoreMissile('decoy')) return { decoy: true, count: 0, stuck: true };
  cell.decoyProgress = 0;
  updateHUD();
  return { decoy: true, count: 1 };
}

function dockMissile(kind) {
  if (!tryStoreMissile(kind)) return;
  updateHUD();
  const el = $('resMissile');
  if (el) pop(el);
  const row = el?.closest('.res');
  if (row) {
    row.classList.remove('made');
    void row.offsetWidth;
    row.classList.add('made');
  }
  latch();
}

/**
 * A finished missile goes into the silo. On a Military Factory the missile first rises out of the ground onto its
 * launch pad (it stays there until the factory starts its next one); then, for each missile, its icon flies from
 * the factory up into the Missiles row, which pops as it lands. A Decoy Builder has no pad: only the icons fly.
 * No launch: a missile in the air means an attack, and this one goes nowhere.
 */
async function playMissileMade(cell, n, kind) {
  const run = runId;
  const pad = cell.terrain === 'milfactory';
  if (view !== 'board') {
    if (pad) setPadMissile(cell, true);
    for (let i = 0; i < n; i++) {
      if (run !== runId) return;
      dockMissile(kind);
      await wait(0.15);
    }
    return;
  }
  const icon = document.querySelector('#panel .res.missile .ico')?.outerHTML ?? '';
  spawnFactoryFloater(cell, `<div class="row" style="--c:#ff8a2a"><b>+${n}</b>${icon}</div>`);
  if (pad) await setPadMissile(cell, true, { animate: true });
  else hopFactory(cell);
  if (run !== runId) return;
  const flights = [];
  for (let i = 0; i < n; i++) {
    flights.push(
      flyMissileToHud(cell, i * 0.18).then(() => {
        if (run === runId) dockMissile(kind);
      }),
    );
  }
  await Promise.all(flights);
}

const PAD_RISE = 0.6; // s, out of the ground (with a little overshoot)
const PAD_SINK = 0.35; // s, back down
const padAnims = []; // { node, from, to, t, dur, rise, done }

/**
 * Show or hide a Military Factory's launch-pad missile (models.js PAD_MISSILE). animate: it rises out of the
 * ground (dust, a little shake) or sinks back. Resolves when done.
 */
function setPadMissile(cell, on, { animate = false } = {}) {
  cell.missileReady = on;
  const node = cell.mesh?.getObjectByName(PAD_MISSILE);
  if (!node) return Promise.resolve();
  node.userData.restY ??= node.position.y;
  node.userData.depth ??= padMissileDepth(node);
  const rest = node.userData.restY;
  const down = rest - node.userData.depth;
  for (let i = padAnims.length - 1; i >= 0; i--) {
    if (padAnims[i].node !== node) continue;
    padAnims[i].done();
    padAnims.splice(i, 1);
  }
  if (!animate) {
    node.visible = on;
    node.position.y = rest;
    return Promise.resolve();
  }
  if (!on && !node.visible) return Promise.resolve();
  node.visible = true;
  const from = on ? down : node.position.y;
  node.position.y = from;
  if (on) {
    dust.burst(cell.x, cell.z, 0.9);
    camShake.add(0.12);
    thud();
  }
  return new Promise((done) => padAnims.push({ node, from, to: on ? rest : down, t: 0, dur: on ? PAD_RISE : PAD_SINK, rise: on, done }));
}

/** How far (in the node's parent units) the pad missile must sink to be fully under the pad. */
function padMissileDepth(node) {
  const box = new THREE.Box3();
  node.updateMatrixWorld(true);
  for (const c of node.children) if (c.geometry) {
    c.geometry.computeBoundingBox();
    box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrix));
  }
  return box.isEmpty() ? 5 : (box.max.y - box.min.y) * 1.05;
}

function updatePadMissiles(dt) {
  for (let i = padAnims.length - 1; i >= 0; i--) {
    const a = padAnims[i];
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const e = a.rise ? padEaseOutBack(k) : k * k;
    a.node.position.y = a.from + (a.to - a.from) * e;
    if (k < 1) continue;
    a.node.position.y = a.to;
    if (!a.rise) a.node.visible = false;
    padAnims.splice(i, 1);
    a.done();
  }
}

function padEaseOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** The missile icon flies from a factory (its pad missile's tip, if any) up into the Missiles row. */
function flyMissileToHud(cell, delay = 0) {
  const target = document.querySelector('#panel .res.missile .ico');
  if (!target || !camera) return wait(delay + 0.15);
  const node = cell.mesh?.getObjectByName(PAD_MISSILE);
  const p = new THREE.Vector3();
  if (node?.visible) new THREE.Box3().setFromObject(node).getCenter(p);
  else {
    const w = hexToWorld(cell.x, cell.z);
    p.set(w.x, 1, w.z);
  }
  const v = p.project(steadyCam);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth - 13;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight - 13;
  const r = target.getBoundingClientRect();
  const tx = r.left + r.width / 2 - 13;
  const ty = r.top + r.height / 2 - 13;
  const mx = (sx + tx) / 2;
  const my = Math.min(sy, ty) - 70;
  const el = document.createElement('div');
  el.className = 'oil-flight missile-flight';
  el.innerHTML = target.outerHTML;
  document.body.appendChild(el);
  const dur = 850;
  const anim = el.animate(
    [
      { transform: `translate(${sx}px,${sy}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${sx}px,${sy - 30}px) scale(1.3)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${mx}px,${my}px) scale(1.15)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${tx}px,${ty}px) scale(0.8)`, opacity: 1 },
    ],
    { duration: dur, delay: delay * 1000, easing: 'ease-in-out', fill: 'both' },
  );
  return anim.finished.catch(() => {}).then(() => el.remove());
}

function spawnFactoryFloater(cell, html) {
  const layer = $('floaters');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'floater';
  el.innerHTML = html;
  layer.appendChild(el);
  factoryFloaters.push({ el, x: cell.x, z: cell.z, t: 0 });
}

/** Barrels fly from the oil gauge down into a factory (board only). Resolves when the last one lands. */
function flyOilToFactory(cell, oil) {
  const dur = FACTORY_FILL_MS * 1.6;
  if (view !== 'board') return wait(dur / 1000);
  const src = $('quotaBarrels').getBoundingClientRect();
  const w = hexToWorld(cell.x, cell.z);
  const v = new THREE.Vector3(w.x, 0.5, w.z).project(steadyCam);
  const tx = (v.x * 0.5 + 0.5) * window.innerWidth - 13;
  const ty = (-v.y * 0.5 + 0.5) * window.innerHeight - 13;
  const n = Math.max(1, Math.min(4, oil));
  const flights = [];
  for (let k = 0; k < n; k++) {
    const el = document.createElement('div');
    el.className = 'oil-flight';
    el.innerHTML = ICONS.oil;
    document.body.appendChild(el);
    const sx = src.left + src.width * (0.25 + 0.5 * Math.random()) - 13;
    const sy = src.top + src.height / 2 - 13;
    const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 80;
    const my = Math.min(sy, ty) - 40;
    const anim = el.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.8)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.6)`, opacity: 1 },
      ],
      { duration: dur, delay: k * 90, easing: 'ease-in', fill: 'both' },
    );
    flights.push(anim.finished.then(() => el.remove(), () => el.remove()));
  }
  return Promise.all(flights);
}

function updateFactoryFloaters(dt) {
  const c = payoutCfg;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const v = factoryBarV;
  for (let i = factoryFloaters.length - 1; i >= 0; i--) {
    const f = factoryFloaters[i];
    f.t += dt;
    if (f.t >= c.labelLife) {
      f.el.remove();
      factoryFloaters.splice(i, 1);
      continue;
    }
    const p = Math.min(f.t / c.labelLife, 1);
    const pt = c.labelPopTime;
    const easeOut = (t) => 1 - (1 - t) ** 3;
    const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
    const scale = f.t < pt ? (0.2 + 0.8 * easeOutBack(Math.min(f.t / pt, 1))) * c.labelPop : 1;
    const rise = c.labelStartY + c.labelRise * easeOut(p);
    const pos = hexToWorld(f.x, f.z);
    v.set(pos.x, rise, pos.z).project(steadyCam);
    const px = (v.x * 0.5 + 0.5) * w;
    const py = (-v.y * 0.5 + 0.5) * h;
    f.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%) scale(${scale})`;
    const fs = Math.min(c.fadeStart, 0.999);
    f.el.style.opacity = p > fs ? 1 - (p - fs) / (1 - fs) : 1;
  }
}

function updateInterceptCover(time) {
  interceptCover.visible = view === 'board' && !busy();
  if (!interceptCover.visible) {
    if (interceptCoverKey) {
      interceptCoverKey = '';
      for (const g of interceptCoverGlows) g.dispose();
      interceptCoverGlows = [];
    }
    return;
  }
  const h = rig.isDragging ? null : hoveredCell();
  let ox = null;
  let oz = null;
  let invalid = false;
  // Intercept Network: its coverage ring. Launch Accelerator: the cells whose launchers it speeds up.
  const RANGED = { intercept: () => INTERCEPT.range, booster: () => BOOST.radius };
  let ranged = null;
  if (RANGED[hand.piece?.terrain] && h) {
    ranged = hand.piece.terrain;
    ox = h[0];
    oz = h[1];
    invalid = placement.result && !placement.result.ok;
  } else if (!hand.piece && h) {
    const cell = grid.get(h[0], h[1]);
    if (RANGED[cell?.terrain]) {
      ranged = cell.terrain;
      ox = cell.x;
      oz = cell.z;
    }
  }
  const radius = ranged ? RANGED[ranged]() : 0;
  const k = ox == null ? '' : `${ranged},${ox},${oz},${radius},${invalid ? 'bad' : 'ok'}`;
  if (k !== interceptCoverKey) {
    interceptCoverKey = k;
    for (const g of interceptCoverGlows) g.dispose();
    interceptCoverGlows = [];
    if (ox != null) {
      for (const [x, z] of hexesAround(ox, oz, radius)) {
        const glow = createGlow(invalid ? 0xff4a4a : ranged === 'booster' ? BOOST_GLOW : INTERCEPT_GLOW, 'intercept cover');
        glow.setLevel(1);
        const w = hexToWorld(x, z);
        glow.group.position.set(w.x, LIFT, w.z);
        interceptCover.add(glow.group);
        interceptCoverGlows.push(glow);
      }
    }
  }
  for (const g of interceptCoverGlows) g.paint(0.7, time);
}

function updateFactoryBars() {
  const layer = $('factoryBars');
  if (!layer) return;
  if (view !== 'board') {
    layer.style.visibility = 'hidden';
    return;
  }
  layer.style.visibility = '';
  const need = yearLength();
  const live = new Set();
  for (const c of grid.cells.values()) {
    if (c.terrain !== 'milfactory' && !(isMilitaryLab(c.terrain) && !c.built)) continue;
    const k = `${c.x},${c.z}`;
    live.add(k);
    let rec = factoryBars.get(k);
    if (!rec?.el) {
      const el = document.createElement('div');
      el.className = 'factory-bar';
      layer.appendChild(el);
      rec = rec ? Object.assign(rec, { el }) : { el, filled: -1, need: 0, preview: null };
      factoryBars.set(k, rec);
    }
    const filled = rec.preview ?? (c.terrain === 'milfactory' ? c.missileProgress : c.buildProgress) ?? 0;
    if (rec.need !== need || rec.el.querySelectorAll('i').length !== need) {
      rec.need = need;
      const halt = rec.el.querySelector('.halt-label');
      rec.el.innerHTML = Array.from({ length: need }, () => '<i></i>').join('');
      if (halt) rec.el.prepend(halt);
      rec.filled = -1;
    }
    rec.el.classList.toggle('halted', Boolean(c.buildHalted));
    let tag = rec.el.querySelector('.halt-label');
    if (c.buildHalted) {
      if (!tag) {
        tag = document.createElement('b');
        tag.className = 'halt-label';
        rec.el.prepend(tag);
      }
      const haltText = L('Construction stopped', '停止建设');
      if (tag.textContent !== haltText) tag.textContent = haltText;
    } else if (tag) tag.remove();
    if (rec.filled !== filled) {
      const prev = rec.filled;
      rec.filled = filled;
      rec.el.classList.toggle('snap', filled === 0 && prev === need);
      [...rec.el.querySelectorAll('i')].forEach((pip, i) => pip.classList.toggle('on', i < filled));
    }
    // Centred over its cell, just above the factory as it shows on screen (the highest of its top points).
    if (rec.mesh !== c.mesh) {
      rec.mesh = c.mesh;
      rec.top = topPoints(c.mesh);
    }
    const w = hexToWorld(c.x, c.z);
    factoryBarV.set(w.x, 0, w.z).project(steadyCam);
    const px = (factoryBarV.x * 0.5 + 0.5) * window.innerWidth;
    let top = factoryBarV.y;
    for (const p of rec.top) top = Math.max(top, factoryBarV.copy(p).applyMatrix4(c.mesh.matrixWorld).project(steadyCam).y);
    const py = (-top * 0.5 + 0.5) * window.innerHeight;
    const tf = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, calc(-100% - 4px))`;
    if (rec.el._tf !== tf) rec.el.style.transform = rec.el._tf = tf;
  }
  for (const [k, rec] of factoryBars) {
    if (live.has(k)) continue;
    rec.el.remove();
    factoryBars.delete(k);
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

/**
 * A falling tile's ground plate (its sand and painted ground) casts no shadow until it lands: from up high that shadow
 * fell far from the tile, a dark hexagonal slab sliding over the sand. The building on it keeps its shadow.
 * Returns the parts turned off, to turn back on at the impact.
 */
function hideFallingPlates(mesh) {
  const plates = [];
  mesh.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    if (![o.material].flat().some((m) => isSeamless(m)) && !isGroundMesh(o)) return;
    o.castShadow = false;
    plates.push(o);
  });
  return plates;
}

const groundInv = new THREE.Matrix4();

/** Flat plates that sit on the sand. The landing squash must not scale these, or their edge flickers against the ground. */
function groundPlates(root) {
  const plates = [];
  root.traverse((o) => {
    if (!o.isMesh || o === root) return;
    const seamless = [o.material].flat().some((m) => m && isSeamless(m));
    if (o.userData.ground || isGroundMesh(o) || seamless) plates.push(o);
  });
  return plates;
}

/**
 * Keep each ground plate at the transform it has when the tile is at rest.
 * The matrix is written directly: the squash scale differs on each axis, so splitting it back into
 * position, rotation and scale shears a rotated plate and the sand crawls.
 */
function holdGround(a) {
  const mesh = a.mesh;
  if (!a.groundHold) {
    const savedScale = mesh.scale.clone();
    const savedY = mesh.position.y;
    mesh.scale.set(1, 1, 1);
    mesh.position.y = 0;
    mesh.updateMatrixWorld(true);
    a.groundHold = groundPlates(mesh).map((o) => ({
      o,
      world: o.matrixWorld.clone(),
      pos: o.position.clone(),
      quat: o.quaternion.clone(),
      scale: o.scale.clone(),
      auto: o.matrixAutoUpdate,
    }));
    mesh.scale.copy(savedScale);
    mesh.position.y = savedY;
  }
  if (!a.groundHold.length) return;
  mesh.updateMatrixWorld(true);
  for (const p of a.groundHold) {
    groundInv.copy(p.o.parent.matrixWorld).invert();
    p.o.matrix.copy(groundInv).multiply(p.world);
    p.o.matrixAutoUpdate = false;
    p.o.matrixWorldNeedsUpdate = true;
  }
}

function releaseGround(a) {
  if (!a.groundHold) return;
  for (const p of a.groundHold) {
    p.o.position.copy(p.pos);
    p.o.quaternion.copy(p.quat);
    p.o.scale.copy(p.scale);
    p.o.matrixAutoUpdate = p.auto;
    p.o.matrixWorldNeedsUpdate = true;
  }
  a.groundHold = null;
}

function updateDropAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.t < 0) continue;
    a.mesh.visible = true;
    if (a.t < DROP.fall) {
      if (!a.plates) a.plates = hideFallingPlates(a.mesh);
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
      for (const o of a.plates ?? []) o.castShadow = true; // on the ground again: the plate's shadow is its own edge
      if (a.cells || a.waste) wasteThud();
      else if (a.build) buildThud();
      else thud();
      // The cells it landed on: a whole Wasteland piece knows its cells, a single tile's is under its position.
      const cells = a.cells ?? [worldToHex(a.mesh.position.x, a.mesh.position.z)];
      for (const [cx, cz] of cells) {
        // Dust under each cell (a little less per cell for a whole piece).
        dust.burst(cx, cz, a.cells ? 0.8 : 1);
        // Free placement: the land around the new tile is uncovered (expansion mode uncovers whole plots).
        if (!grid.expansionMode) fog.openAround(cx, cz, fogCfg.openRadius);
      }
      // The impact blows back and thins the clouds nearby (once, from the middle of what landed).
      const [mx, mz] = worldToHex(a.mesh.position.x, a.mesh.position.z);
      fog.disturb(mx, mz);
      shake.amount = Math.min(shake.amount + 0.7, 1.2);
    }
    // Damped spring around rest: flat on impact, a little tall on the way back, then still.
    const k = DROP.squash * Math.exp(-DROP.wobbleDamp * u) * Math.cos(DROP.wobbleRate * u);
    a.mesh.scale.set(1 + k * 0.45, 1 - k, 1 + k * 0.45);
    const bounce = u < 0.16 ? Math.sin((u / 0.16) * Math.PI) * DROP.rebound : 0;
    a.mesh.position.y = Math.max(0, bounce);
    holdGround(a);
    if (u >= DROP.settle) {
      releaseGround(a);
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
const BUILD_REVEAL_GLSL = `#include <color_fragment>
  float n = fract(sin(dot(vBuildPos.xz * 11.3 + vBuildPos.y * 7.1, vec2(127.1, 311.7))) * 43758.5453);
  n = mix(n, fract(sin(dot(vBuildPos.xy * 19.0, vec2(269.5, 183.3))) * 43758.5453), 0.4);
  float painted = smoothstep(n - 0.1, n + 0.16, uDissolve);
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 unfinished = vec3(0.16, 0.15, 0.13) + lum * 0.12;
  diffuseColor.rgb = mix(unfinished, diffuseColor.rgb, painted);`;
const BUILD_U = { uDissolve: { value: 0 } };
const BUILD_GROUND = /Ground|GroundTrim|FrontApron|Foundation|Plinth|Hex|Sand|Soil|Dirt|CargoPad/i;
const BUILD_FX = /Smoke|Steam|Dust/i;
const _partSize = new THREE.Vector3();

function isGroundMesh(o) {
  if (BUILD_GROUND.test(o.name)) return true;
  if (!o.geometry) return false;
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  o.geometry.boundingBox.getSize(_partSize);
  const span = Math.max(_partSize.x, _partSize.z);
  return span > 0.7 && _partSize.y < span * 0.12;
}

function assignBuildParts(root) {
  const body = [];
  const ground = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (BUILD_FX.test(o.name)) return;
    const rec = { o };
    if (isGroundMesh(o)) ground.push(rec);
    else body.push(rec);
  });
  const first = 1 / Math.max(2, yearLength());
  for (const rec of body) rec.o.userData.buildPart = first * 0.5;
  for (const rec of ground) rec.o.userData.buildPart = 2;
}

const buildPatchCache = new WeakMap();

function patchBuildReveal(mat) {
  const hit = buildPatchCache.get(mat);
  if (hit) return hit;
  const c = mat.clone();
  if (c.emissive) c.emissiveIntensity = 0;
  const prev = c.onBeforeCompile;
  const key = c.customProgramCacheKey?.call(c) ?? '';
  c.onBeforeCompile = (shader, renderer) => {
    prev?.call(c, shader, renderer);
    shader.uniforms.uDissolve = BUILD_U.uDissolve;
    shader.vertexShader = `varying vec3 vBuildPos;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vBuildPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    if (!shader.vertexShader.includes('vBuildPos =')) {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'void main() {\n  vBuildPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    }
    shader.fragmentShader = `varying vec3 vBuildPos;\nuniform float uDissolve;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      BUILD_REVEAL_GLSL,
    );
  };
  c.customProgramCacheKey = () => `${key}|build-reveal-dissolve`;
  c.needsUpdate = true;
  buildPatchCache.set(mat, c);
  return c;
}

function ensureBuildReveal(cell) {
  const mesh = cell.mesh;
  if (!mesh) return null;
  if (mesh.userData.buildState) return mesh.userData.buildState;
  assignBuildParts(mesh);
  const state = { uBuild: { value: 0 }, orig: new Map(), draw: new Map() };
  mesh.traverse((o) => {
    if (!o.isMesh || !o.material || BUILD_FX.test(o.name)) return;
    state.orig.set(o, o.material);
    state.draw.set(o, o.onBeforeRender);
    o.userData.buildDissolve = 0;
    o.material = Array.isArray(o.material) ? o.material.map(patchBuildReveal) : patchBuildReveal(o.material);
    o.onBeforeRender = () => {
      BUILD_U.uDissolve.value = o.userData.buildDissolve ?? 0;
    };
  });
  mesh.userData.buildState = state;
  return state;
}

function clearBuildReveal(cell) {
  const mesh = cell.mesh;
  const state = mesh?.userData.buildState;
  if (!state) return;
  for (const [o, mat] of state.orig) {
    if (o.material) o.material = mat;
    o.onBeforeRender = state.draw.get(o) ?? null;
  }
  delete mesh.userData.buildState;
}

function dropLabBar(cell) {
  const k = `${cell.x},${cell.z}`;
  const rec = factoryBars.get(k);
  if (!rec) return;
  rec.el?.remove();
  factoryBars.delete(k);
}

function updateBuildReveal(dt) {
  const need = yearLength();
  const step = dt * 1.4;
  for (const cell of grid.cells.values()) {
    if (!isMilitaryLab(cell.terrain) || !cell.mesh) continue;
    if (anims.some((a) => a.mesh === cell.mesh && !a.landed)) continue;
    const state = cell.built ? cell.mesh.userData.buildState : ensureBuildReveal(cell);
    if (!state) continue;
    const rec = factoryBars.get(`${cell.x},${cell.z}`);
    const filled = rec?.preview ?? cell.buildProgress ?? 0;
    const progress = cell.built ? 2 : Math.max(0, Math.min(1, filled / need));
    let pending = false;
    cell.mesh.traverse((o) => {
      if (o.userData.buildPart == null) return;
      const goal = progress + 0.001 >= o.userData.buildPart ? 1 : 0;
      const d = o.userData.buildDissolve ?? 0;
      const next = d + Math.sign(goal - d) * Math.min(Math.abs(goal - d), step);
      o.userData.buildDissolve = next;
      if (goal > 0 && next < 0.995) pending = true;
    });
    if (cell.built && !pending) clearBuildReveal(cell);
  }
}
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
  const need = yearLength();
  for (const cell of grid.cells.values()) {
    if (!cell.mesh) continue;
    if (isMilitaryLab(cell.terrain) && (!cell.built || cell.mesh.userData.buildState)) {
      setGrey(cell.mesh, false);
      const falling = anims.some((a) => a.mesh === cell.mesh && !a.landed);
      if (!cell.built && !falling) ensureBuildReveal(cell);
      continue;
    }
    const blocked =
      cell.terrain === 'milfactory' && (cell.missileProgress ?? 0) >= need && missileHandCount() >= currentMissileCap();
    setGrey(cell.mesh, idle.has(`${cell.x},${cell.z}`) || blocked);
  }
  neonTiles.refresh(grid); // boosted buildings' tiles glow (not idle ones)
  zoomIcons.setBoosts(e.boosts); // tutorial: a booster started adding something
  zoomIcons.setYields(e.yields); // zoomed-out hover: the card's season line
}

function missileHandCount() {
  const inHand = strikeOpen ? hand.cards.filter((p) => p.terrain === 'missile' || p.terrain === 'missile2').length : 0;
  return missileCount() + inHand;
}

function idleKeySet(e = economyNow()) {
  return new Set((e.perCell ?? []).filter((p) => p.idle).map((p) => `${p.x},${p.z}`));
}

function currentMissileCap(idle) {
  return missileCapacity(grid, idle ?? idleKeySet());
}

const flyV = new THREE.Vector3();

function tryStoreMissile(kind) {
  return addMissile(kind, currentMissileCap());
}

/**
 * Hand over a finished factory's missiles. If the magazine is full the last
 * progress pip stays lit and the silo count does not go up.
 */
function deliverFactory(cell, idle) {
  const y = factoryYield(grid, cell, idle);
  let delivered = 0;
  for (let i = 0; i < y.count; i++) {
    if (!tryStoreMissile(y.kind)) break;
    delivered++;
  }
  if (delivered === 0) return { ...y, count: 0, stuck: true };
  cell.missileProgress = 0;
  setPadMissile(cell, true);
  const rec = factoryBars.get(`${cell.x},${cell.z}`);
  if (rec) rec.preview = null;
  return { ...y, count: delivered };
}

/** Pay oil and advance each Military Factory. Completing a year adds Missile cards. */
function runFactories() {
  const idle = idleKeySet();
  const need = yearLength();
  const made = [];
  for (const cell of grid.cells.values()) {
    if (cell.terrain !== 'milfactory') continue;
    if ((cell.missileProgress ?? 0) >= need) {
      made.push(deliverFactory(cell, idle));
      continue;
    }
    if (turn.stockpile < FACTORY_OIL) {
      made.push({ unpaid: true });
      continue;
    }
    turn.stockpile -= FACTORY_OIL;
    if (cell.missileReady) setPadMissile(cell, false);
    cell.missileProgress = (cell.missileProgress ?? 0) + 1;
    const rec = factoryBars.get(`${cell.x},${cell.z}`);
    if (rec) rec.preview = null;
    if (cell.missileProgress < need) continue;
    made.push(deliverFactory(cell, idle));
  }
  for (const cell of grid.cells.values()) {
    if (!isMilitaryLab(cell.terrain) || cell.built) continue;
    const cost = labOilCost(cell.terrain);
    if (turn.stockpile < cost) {
      cell.buildHalted = true;
      continue;
    }
    cell.buildHalted = false;
    turn.stockpile -= cost;
    cell.buildProgress = (cell.buildProgress ?? 0) + 1;
    if (cell.buildProgress >= need) {
      cell.built = true;
      dropLabBar(cell);
    }
  }
  return made;
}

function updateHUD() {
  const n = grid.size;
  const hpEl = $('capitalHp');
  if (hpEl) hpEl.innerHTML = Array.from({ length: CAPITAL_HP }, (_, i) => `<i class="${i < turn.capitalHp ? '' : 'lost'}"></i>`).join('');
  const quota = turn.quota;
  const left = yearLength() - 1 - turn.season;
  $('seasonLabel').textContent = L(
    `Year ${turn.round} · ${SEASONS[turn.season]} · Tribute ${left ? `in ${left} season${left === 1 ? '' : 's'}` : `due this ${SEASONS[turn.season]}`}`,
    `第 ${turn.round} 年 · ${SEASONS[turn.season]} · ${left ? `${left} 季后缴纳贡品` : '本季缴纳贡品'}`,
  );
  seasonClock.set(turn.season, yearLength() - 1);
  updateBlackMarketButton();
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
  forecastKey = null; // the board changed: the forecast (if a card is held) is worked out again
  renderRack(e, null);
  shadeIdle(e);
  // Oil: big number = the stockpile (the Overlord takes it all after Winter), small = this season's yield.
  const oilUpkeep = (e.factoryOil || 0) + (e.labOil || 0);
  $('resOilD').textContent = oilUpkeep ? `(+${e.oil} −${oilUpkeep})` : `(+${e.oil})`;
  $('resOilD').className = e.oil > 0 ? 'up' : '';
  const cap = currentMissileCap(idleKeySet(e));
  trimMissiles(cap);
  storeHeldMissiles(); // recovered silo missiles move in once there's room
  const missiles = missileHandCount();
  if ($('resMissile')) {
    $('resMissile').textContent = `${missiles} / ${cap}`;
    $('resMissile').classList.toggle('neg', missiles >= cap);
    const factories = [...grid.cells.values()].filter((c) => c.terrain === 'milfactory');
    const need = yearLength();
    const finishing = factories.filter((c) => (c.missileProgress ?? 0) + 1 >= need).length;
    const working = factories.length;
    const room = Math.max(0, cap - missiles);
    const d = $('resMissileD');
    if (finishing && room) {
      d.textContent = `(+${Math.min(finishing, room)})`;
      d.className = 'up';
    } else if (working) {
      d.textContent = L(working === 1 ? '(1 factory)' : `(${working} factories)`, working === 1 ? '(1 座工厂)' : `(${working} 座工厂)`);
      d.className = '';
    } else {
      d.textContent = '';
      d.className = '';
    }
  }

  // Food stores: excess food banked for lean seasons (capacity from the Capitals).
  showStore(turn.food, e.foodCap);

  $('btnReroll').classList.toggle('hidden', hand.isEmpty);
  $('btnReroll').classList.toggle('disabled', !turn.freeRerolls && turn.stockpile < rerollCost());
  $('btnRerollSub').innerHTML = turn.freeRerolls ? L(`free ×${turn.freeRerolls}`, `免费 ×${turn.freeRerolls}`) : `-${rerollCost()}${ICONS.oil}`;
  // Greyed out while Wasteland that still fits must be placed (endTurn refuses then, with a toast).
  const blocking = hand.placeableForced.length;
  $('btnNext').classList.toggle('disabled', blocking > 0);
  $('btnNext').title = blocking > 0 ? L(`Clear your hand first: ${blocking} Wasteland left to place`, `请先清空手牌：还有 ${blocking} 张荒地要放置`) : '';
  $('btnNextSub').textContent =
    turn.season === yearLength() - 1
      ? L(`collect oil, pay ${quota} tribute`, `采油，缴纳 ${quota} 桶贡品`)
      : '';
  if (tipKind) renderResTip(e);
}

/** Each reroll costs 1 more barrel than the last this year (1, 2, 3, …). A new year starts again at 1. */
const rerollCost = () => turn.rerolls + 1;

// ---------- resource breakdown tooltips ----------
let tipKind = null; // 'food' | 'mp' | 'oil' | 'missile' while a resource row is hovered

/**
 * Oil the stockpile will actually hand to factories and unfinished labs this season.
 * Factories whose year bar is already full do not pay again. Labs are reserved against every
 * factory that still owes oil, then paid only while the stockpile can cover the next one.
 */
function militaryOilDue(e) {
  const need = yearLength();
  let purse = turn.stockpile + e.oil;
  let factoryDue = 0;
  let factoryPaidN = 0;
  let factorySkipped = 0;
  const labs = { missilelab: 0, warhead: 0, booster: 0 };
  let labSkipped = 0;
  const unfinished = [];
  for (const cell of grid.cells.values()) {
    if (cell.terrain === 'milfactory') {
      if ((cell.missileProgress ?? 0) >= need) continue;
      factoryDue++;
      if (purse >= FACTORY_OIL) {
        purse -= FACTORY_OIL;
        factoryPaidN++;
      } else factorySkipped++;
    } else if (isMilitaryLab(cell.terrain) && !cell.built) unfinished.push(cell);
  }
  let labPool = turn.stockpile + e.oil - factoryDue * FACTORY_OIL;
  for (const cell of unfinished) {
    const cost = labOilCost(cell.terrain);
    if (labPool < cost || purse < cost) {
      labSkipped++;
      continue;
    }
    labPool -= cost;
    purse -= cost;
    labs[cell.terrain]++;
  }
  return { purse, factoryPaidN, factorySkipped, labs, labSkipped };
}

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
    add(L(`Rebel & raider camps ×${c('raider') + c('bandit_raider')}`, `${nm('raider')} ×${c('raider') + c('bandit_raider')}`), -e.raiderManpower);
    if (turn.event) add(turn.event.name, e.eventCap + e.mods.capDelta);
    total(L('Worker slots', '人力总数'), e.cap);
    add(L(`Hydro-farms ×${c('farm')}`, `${nm('farm')} ×${c('farm')}`), -c('farm'));
    add(L(`Stations ×${c('station')}`, `${nm('station')} ×${c('station')}`), -c('station'));
    add(L(`Refineries ×${c('refinery')}`, `${nm('refinery')} ×${c('refinery')}`), -c('refinery'));
    add(L(`Magazines ×${c('magazine')}`, `${nm('magazine')} ×${c('magazine')}`), -2 * c('magazine'));
    total(e.idle ? L('Idle', '闲置') : L('Free', '空闲'), e.idle ? e.idle : e.free);
    note(
      e.idle
        ? L(
            `Not enough workers: your ${e.idle} newest building${e.idle === 1 ? '' : 's'} sit idle and produce nothing`,
            `人力不足：你最新建造的 ${e.idle} 座建筑处于闲置，没有任何产出`,
          )
        : L('Farms, stations and refineries need 1 worker; Magazines need 2. Housing raises the cap.', '农场、采油站和炼油厂各需 1 人力；储弹仓需 2。住房能提高上限。'),
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
    add(L(`Intercept Networks ×${c('intercept')}`, `${nm('intercept')} ×${c('intercept')}`), -(e.interceptOil ?? 0));
    const decoyN = (e.perCell ?? []).filter((p) => p.terrain === 'decoyworks' && !p.idle).length;
    add(L(`Decoy Builders ×${decoyN}`, `${nm('decoyworks')} ×${decoyN}`), -(e.decoyOil ?? 0));
    total(L('This season', '本季'), signed(e.oil));
    const due = militaryOilDue(e);
    add(L(`Military Factories ×${due.factoryPaidN}`, `${nm('milfactory')} ×${due.factoryPaidN}`), -(due.factoryPaidN * FACTORY_OIL));
    add(L(`Recipe Labs ×${due.labs.missilelab}`, `${nm('missilelab')} ×${due.labs.missilelab}`), -(due.labs.missilelab * labOilCost('missilelab')));
    add(L(`Warhead Institutes ×${due.labs.warhead}`, `${nm('warhead')} ×${due.labs.warhead}`), -(due.labs.warhead * labOilCost('warhead')));
    add(L(`Launch Accelerators ×${due.labs.booster}`, `${nm('booster')} ×${due.labs.booster}`), -(due.labs.booster * labOilCost('booster')));
    const held = due.factorySkipped + due.labSkipped;
    if (held) {
      note(
        L(
          held === 1 ? 'Not enough oil: 1 building sits still' : `Not enough oil: ${held} buildings sit still`,
          `石油不足：${held} 座建筑停工`,
        ),
      );
    }
    note(
      L(
        `Stockpile ${turn.stockpile} → ${due.purse} / ${turn.quota} tribute`,
        `石油库存 ${turn.stockpile} → ${due.purse} / 贡品 ${turn.quota}`,
      ),
    );
    note(L(`The Overlord takes all of it after ${SEASONS[yearLength() - 1]}.`, `${SEASONS[yearLength() - 1]}季结束后，霸主会全部拿走。`));
  }
  return rows;
}

/** Capacity and what is building a missile. The Missiles row used to fall through into the oil lines. */
function missileBreakdown(e) {
  const rows = [];
  const add = (label, v) => v && rows.push([label, signed(v), v < 0 ? 'add bad' : 'add']);
  const total = (label, v) => rows.push([label, v, 'total']);
  const note = (text) => rows.push([text, '', 'note']);
  const nm = (t) => TERRAINS[t].name;
  const idle = idleKeySet(e);
  const cap = missileCapacity(grid, idle);
  add(L('Hive City', '蜂巢城'), BASE_MISSILE_CAP);
  const magazines = [...grid.cells.values()].filter((c) => c.terrain === 'magazine');
  const idleMags = magazines.filter((c) => idle.has(`${c.x},${c.z}`)).length;
  const staffedMags = magazines.length - idleMags;
  add(L(`Magazines ×${staffedMags}`, `${nm('magazine')} ×${staffedMags}`), staffedMags * MAGAZINE_CAP);
  total(L('Capacity', '容量'), cap);
  if (idleMags) {
    note(
      L(
        idleMags === 1 ? '1 idle Magazine adds no capacity' : `${idleMags} idle Magazines add no capacity`,
        `${idleMags} 座闲置${nm('magazine')}不增加容量`,
      ),
    );
  }
  const loaded = missileHandCount();
  const inHand = strikeOpen ? hand.cards.filter((p) => p.terrain === 'missile' || p.terrain === 'missile2').length : 0;
  note(
    inHand
      ? L(`${loaded} / ${cap} loaded (${inHand} in the strike hand)`, `${loaded} / ${cap} 已装填（${inHand} 在袭击手牌中）`)
      : L(`${loaded} / ${cap} loaded`, `${loaded} / ${cap} 已装填`),
  );

  const need = yearLength();
  const factories = [...grid.cells.values()].filter((c) => c.terrain === 'milfactory');
  let room = Math.max(0, cap - loaded);
  let coming = 0;
  let waiting = false;
  if (!factories.length) note(L('No Military Factory is building missiles.', '没有军事工厂在生产导弹。'));
  for (const cell of factories) {
    const y = factoryYield(grid, cell, idle);
    const extra = y.count - 1;
    const labEn = extra > 0 ? ` · Recipe Lab +${extra}` : '';
    const labZh = extra > 0 ? ` · ${nm('missilelab')} +${extra}` : '';
    const pips = cell.missileProgress ?? 0;
    const fills = pips < need && pips + 1 >= need;
    if (pips >= need || fills) {
      const n = Math.min(y.count, room);
      room -= n;
      coming += n;
      if (n > 0) add(L(`Military Factory finishes${labEn}`, `${nm('milfactory')}本季完成${labZh}`), n);
      if (n < y.count) waiting = true;
    } else {
      note(L(`Military Factory ${pips}/${need}${labEn}`, `${nm('milfactory')} ${pips}/${need}${labZh}`));
    }
  }
  if (waiting) note(L('Magazine full: the missile waits.', '弹仓已满：导弹等候空位。'));
  if (coming) total(L('This season', '本季'), `+${coming}`);
  const decoyN = (e.perCell ?? []).filter((p) => p.terrain === 'decoyworks' && !p.idle).length;
  if (decoyN) {
    note(
      L(
        `Decoy Builders ×${decoyN} make decoys. Decoys do not use a slot.`,
        `${nm('decoyworks')} ×${decoyN} 生产诱饵。诱饵不占弹仓。`,
      ),
    );
  }
  return rows;
}

function renderResTip(e = economyNow()) {
  const rows = tipKind === 'missile' ? missileBreakdown(e) : breakdown(tipKind, e);
  const title = tipKind === 'missile' ? L('Missiles', '导弹') : L('How this season adds up', '本季收支明细');
  $('resTip').innerHTML =
    `<div class="title">${title}</div>` +
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
let inspectKey = '';

const AMOUNT_WORD = { food: ['food', '食物'], oil: ['oil', '石油'], manpower: ['manpower', '人力'] };
const GRANT_NAME = { farm: ['Hydro-farm', '水培农场'], station: ['Oil Station', '采油站'] };
/** "+8 food" / "+8 食物", already split for L(). */
function amountWords(n, res) {
  const sign = n > 0 ? '+' : '';
  const [en, zh] = AMOUNT_WORD[res];
  return { en: `${sign}${n} ${en}`, zh: `${sign}${n} ${zh}` };
}
function effectText(mod) {
  switch (mod.id) {
    case 'pump':
      return { en: 'Water Pump +2 food', zh: '水泵站 +2 食物' };
    case 'oasis':
      return { en: 'Oasis +3 food', zh: '绿洲 +3 食物' };
    case 'tarpit':
      return { en: 'Tar Pit +2 oil', zh: '焦油坑 +2 石油' };
    case 'twice':
      return { en: 'Capital: trigger +1', zh: '首都：触发+1' };
    case 'drought':
      return { en: 'Drought: Water Pumps and Oases give nothing', zh: '干旱：水泵站和绿洲没有产出' };
    case 'disabled':
      return { en: 'Inactive', zh: '失效' };
    case 'missilelab':
      return { en: 'Missile Recipe Lab +1 Missile', zh: '导弹配方改良所 +1 导弹' };
    case 'labour':
      return { en: 'Settlement +2 manpower', zh: '定居点 +2 人力' };
    case 'labourFull':
      return { en: 'All 6 sides Settlements +4 manpower', zh: '六面皆为定居点 +4 人力' };
    case 'crater':
      return { en: `${mod.n} adjacent Farms or Settlements`, zh: `相邻农场或定居点 ×${mod.n}` };
    case 'event': {
      const pct = `${mod.pct > 0 ? '+' : ''}${Math.round(mod.pct * 100)}%`;
      const [en, zh] = AMOUNT_WORD[mod.res];
      return { en: `Year event ${pct} ${en}`, zh: `年事件 ${pct} ${zh}` };
    }
    case 'hunger':
      return { en: `Hunger ×${Math.round(mod.fed * 100)}%`, zh: `饥饿 ×${Math.round(mod.fed * 100)}%` };
    case 'station':
      return { en: `Oil Station +${mod.oil} oil`, zh: `采油站 +${mod.oil} 石油` };
    default:
      return null;
  }
}
function grantText(g) {
  const names = GRANT_NAME[g.terrain];
  if (!names) return null;
  const res = g.food ? 'food' : g.oil ? 'oil' : null;
  if (!res) return null;
  const a = amountWords(g[res], res);
  return { en: `${names[0]} ${a.en}`, zh: `${names[1]} ${a.zh}` };
}
/** Final line: what this placed tile yields or spends if Next turn settled right now. */
function seasonText(per) {
  const t = per.terrain;
  if (per.idle && (t === 'farm' || t === 'station' || t === 'refinery')) return { en: 'This season: idle', zh: '本季结算：闲置' };
  const parts = seasonParts(per).map((p) => amountWords(p.n, p.res));
  if (!parts.length) return null;
  if (t === 'pump' || t === 'oasis' || t === 'tarpit') {
    return { en: `Adds ${parts[0].en} this season`, zh: `本季加成 ${parts[0].zh}` };
  }
  return { en: `This season ${parts.map((p) => p.en).join(', ')}`, zh: `本季结算 ${parts.map((p) => p.zh).join('，')}` };
}
/** Neighbour effects under the card's own rule, then this season's settled yield. Empty when nothing changes by place. */
function placedCardExtra(per) {
  if (!per) return '';
  const rows = [];
  for (const mod of per.mods ?? []) {
    const text = effectText(mod);
    if (text) rows.push(`<div class="fx">${iconize(L(text.en, text.zh))}</div>`);
  }
  for (const g of per.grants ?? []) {
    const text = grantText(g);
    if (text) rows.push(`<div class="fx">${iconize(L(text.en, text.zh))}</div>`);
  }
  const total = seasonText(per);
  if (total) rows.push(`<div class="total">${iconize(L(total.en, total.zh))}</div>`);
  return rows.join('');
}
function inspectKeyOf(c, per) {
  const mods = (per?.mods ?? []).map((m) => `${m.id}:${m.oil ?? ''}:${m.n ?? ''}:${m.pct ?? ''}:${m.fed ?? ''}`).join(',');
  const grants = (per?.grants ?? []).map((g) => `${g.terrain}:${g.food ?? 0}:${g.oil ?? 0}`).join(',');
  return `${c.x},${c.z},${c.terrain},${isZh() ? 1 : 0},${c.onRuins ? 1 : 0},${c.missileProgress ?? ''},${c.decoyProgress ?? ''},${c.buildProgress ?? ''},${c.built ? 1 : 0},${c.buildHalted ? 1 : 0},${c.terrain === 'magazine' || c.terrain === 'decoyworks' ? Number(isBoosted(grid, c.x, c.z)) : ''}|${mods}|${grants}|${per?.outFood}|${per?.outOil}|${per?.outManpower}|${per?.food}|${per?.oil}|${per?.idle ? 1 : 0}`;
}
/** Shrink the rules until they sit under the picture. The name keeps its size unless it overflows the header. */
function fitInspectCard(root) {
  const card = root.querySelector('.card-big');
  const copy = root.querySelector('.copy');
  const rule = root.querySelector('.rule');
  const name = root.querySelector('.name');
  if (!card || !copy || !rule) return;
  const w = card.getBoundingClientRect().width;
  if (w < 8 || copy.clientHeight < 8) return;
  const apply = (s) => {
    rule.style.fontSize = `${w * 0.064 * s}px`;
  };
  let scale = 1;
  apply(scale);
  const overflows = () => copy.scrollHeight > copy.clientHeight + 1 || rule.scrollWidth > rule.clientWidth + 1;
  while (overflows() && scale > 0.46) {
    scale *= 0.92;
    apply(scale);
  }
  if (!name) return;
  name.style.fontSize = '';
  let ns = 1;
  const nameOverflow = () => name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1;
  while (nameOverflow() && ns > 0.55) {
    ns *= 0.92;
    name.style.fontSize = `${w * 0.088 * ns}px`;
  }
}
new ResizeObserver(() => {
  const el = $('inspect');
  if (!el.classList.contains('hidden')) fitInspectCard(el);
}).observe($('inspect'));

function updateInspect(cell) {
  // (Not during the guided opening: the tutorial shows what a building does on the board itself.)
  const c = cell && !tutorial.guiding ? grid.get(cell[0], cell[1]) : null;
  const el = $('inspect');
  if (!c) {
    inspectKey = '';
    inspected = null;
    el.classList.add('hidden');
    return;
  }
  const per = economyNow().perCell.find((p) => p.x === c.x && p.z === c.z);
  const key = inspectKeyOf(c, per);
  if (key === inspectKey) return;
  inspectKey = key;
  inspected = c;
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
  if (per?.idle) notes.push(L('Idle: no free workers. Build housing to staff it.', '闲置：没有空闲人力。建造住房来为它配备人手。'));
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
        'Bandits drawn by a cluster of 7 Wasteland. They stay until you Send in the Militia.',
        `被 7 格荒地群引来的匪徒。在你${cardDef('militia').name}之前，他们不会离开。`,
      ),
    );
  if (isCamp(c.terrain)) notes.push(L(`Right now: ${campEffect(c.terrain)}`, `当前：${campEffect(c.terrain)}`));
  if (c.terrain === 'milfactory') {
    const need = yearLength();
    const have = c.missileProgress ?? 0;
    notes.push(L(`Missile progress ${have} / ${need} seasons`, `导弹进度 ${have} / ${need} 季`));
  }
  if (isMilitaryLab(c.terrain)) {
    const need = yearLength();
    notes.push(
      c.built
        ? L('Construction finished: bonus is permanent', '建设完成：加成为永久')
        : c.buildHalted
          ? L(`Construction stopped (no oil) ${c.buildProgress ?? 0} / ${need}`, `停止建设（没有石油） ${c.buildProgress ?? 0} / ${need}`)
          : L(`Under construction ${c.buildProgress ?? 0} / ${need}`, `建设中 ${c.buildProgress ?? 0} / ${need}`),
    );
  }
  if (c.terrain === 'magazine') {
    const cap = currentMissileCap();
    notes.push(L(`Silo ${missileHandCount()} / ${cap}`, `弹库 ${missileHandCount()} / ${cap}`));
  }
  if (c.terrain === 'decoyworks' && DECOY.seasons > 1) {
    const have = c.decoyProgress ?? 0;
    notes.push(L(`Decoy progress ${have} / ${DECOY.seasons} seasons`, `诱饵弹进度 ${have} / ${DECOY.seasons} 季`));
  }
  if (c.terrain === 'magazine' || c.terrain === 'decoyworks') {
    if (isBoosted(grid, c.x, c.z, idleKeySet()))
      notes.push(L('Next to a Launch Accelerator: its launches fly faster', '靠近发射加速器：从这里发射的导弹飞得更快'));
  }
  if (t.buildable) notes.push(L('A building can be placed on top of this tile', '可以在这个地块上放置建筑'));
  el.innerHTML = `
    <div class="card-slot"><div class="card-big">
      <div class="name">${t.name}</div>
      <div class="art">${cardArtHTML(c.terrain)}</div>
      ${snapHTML(t)}
      <div class="copy">
        <div class="rule">${cardText(t)}${placedCardExtra(per)}</div>
      </div>
    </div></div>
    ${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
  el.classList.remove('hidden');
  fitInspectCard(el);
}

const buildHoverV = new THREE.Vector3();
function updateBuildHover(cell) {
  const el = $('buildHover');
  if (!el) return;
  const c = cell ? grid.get(cell[0], cell[1]) : null;
  const show = view === 'board' && c && isMilitaryLab(c.terrain) && !c.built && !c.buildHalted && c.mesh;
  if (!show) {
    el.classList.add('hidden');
    return;
  }
  const need = yearLength();
  const text = c.buildHalted
    ? L(`Construction stopped ${c.buildProgress ?? 0} / ${need}`, `停止建设 ${c.buildProgress ?? 0} / ${need}`)
    : L(`Under construction ${c.buildProgress ?? 0} / ${need}`, `建设中 ${c.buildProgress ?? 0} / ${need}`);
  el.classList.toggle('halted', Boolean(c.buildHalted));
  if (el.textContent !== text) el.textContent = text;
  el.classList.remove('hidden');
  const w = hexToWorld(c.x, c.z);
  buildHoverV.set(w.x, 0, w.z).project(steadyCam);
  const px = (buildHoverV.x * 0.5 + 0.5) * window.innerWidth;
  let top = buildHoverV.y;
  const rec = factoryBars.get(`${c.x},${c.z}`);
  const pts = rec?.top ?? (c.mesh ? topPoints(c.mesh) : []);
  for (const p of pts) top = Math.max(top, buildHoverV.copy(p).applyMatrix4(c.mesh.matrixWorld).project(steadyCam).y);
  const py = (-top * 0.5 + 0.5) * window.innerHeight;
  el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, calc(-100% - 28px))`;
}

// ---------- turns ----------
/** Next turn: tiles hop and flash what they produce, then the turn is settled. */
function endTurn() {
  // Turns can be ended from the board, the War Map or a rival city: the missiles fly wherever you are, and you
  // can scroll out (or dive into a city) to follow them while they're in the air.
  if (switching) return;
  if (turn.over || shopOpen || blackMarketOpen || eventOpen || strikeOpen || warPending) return;
  // The season is wrapping up (last barrels, factories, the trip home): a click only hurries it along,
  // it never starts a second turn on the same season.
  if (turnRunning && !payout.active) {
    if (document.body.classList.contains('homeward')) return toast(L("Return to Hive City to gather the season's oil", '返回蜂巢城以收集本季石油'));
    payoutHud.batch(() => oilFlights.finish());
    return;
  }
  if (payout.active) {
    if (previewing) cancelPreview();
    else {
      payoutHud.batch(() => {
        oilFlights.finish();
        payout.skip(); // pressing again fast-forwards
      });
      return;
    }
  }
  if (!tutorial.allows('endTurn')) return tutorial.rejected({ code: 'early' });
  // Wasteland must be placed first, but only if it fits somewhere; if there's no room, the turn can end.
  // (The latch: the Wasteland cards hop and the button shakes; the guided opening shows only that.)
  const blocking = hand.placeableForced.length;
  if (blocking) {
    tutorial.rejected({ code: 'mandatory' });
    if (!tutorial.active) toast(L(`Place your Wasteland first (${blocking} left in hand)`, `请先放置荒地（手牌中还剩 ${blocking} 张）`), 'bad');
    return;
  }
  hand.select(-1);
  tutorial.notify('endTurn');
  // Combat first: every city's missiles fly, then the season is scored on what's left standing.
  const run = runId;
  warPending = true;
  setTurnRunning(true);
  runAttackPhase().then(async (over) => {
    warPending = false;
    if (run !== runId) return;
    if (over) return setTurnRunning(false);
    if (!(await untilHome(run))) return;
    const e = economyNow();
    runPayout(e, () => finishSeasonFx(e));
  });
}
/**
 * A season's oil is only gathered at Hive City, so nobody loses track of it: ended (or watched) from the War Map or a
 * rival city, the attack plays out where you are, then the season waits until you've come home. Meanwhile the way
 * home glows (body.homeward: "◀ War Map", "Return to Hive"). Resolves false if the run was reset in the meantime.
 */
async function untilHome(run) {
  if (view === 'board' && !switching) return true;
  document.body.classList.add('homeward');
  while ((view !== 'board' || switching) && run === runId) await wait(0.1);
  document.body.classList.remove('homeward');
  return run === runId;
}

/** True from End Turn until the attack phase has finished (a second press does nothing). */
let warPending = false;
/** True from End Turn until the season is settled (new hand dealt, or the shop / a scene has taken over). */
let turnRunning = false;
let settledSeason = null; // guard: one settle per season
function setTurnRunning(on) {
  turnRunning = on;
  $('btnNext').classList.toggle('running', on);
  if (on) $('btnNext').title = L('Season in progress…', '季节结算中…');
  else updateHUD();
}

/** Oil has landed: wait out factory fill/hop/bump, then wrap the year. */
function finishSeasonFx(e) {
  const key = `${turn.round}:${turn.season}`;
  if (settledSeason === key) return; // never settle the same season twice
  settledSeason = key;
  const jobs = factoryJobs.splice(0);
  Promise.all(jobs.length ? jobs : [Promise.resolve([])]).then((factoryWork) => {
    turn.stockpile += e.oil;
    turn.total += e.oil;
    for (const cell of factoryPaid.splice(0)) {
      if (turn.stockpile >= FACTORY_OIL) turn.stockpile -= FACTORY_OIL;
    }
    for (const cell of labsPaid.splice(0)) {
      const cost = labOilCost(cell.terrain);
      if (turn.stockpile >= cost) turn.stockpile -= cost;
    }
    showOil(turn.stockpile);
    document.body.classList.remove('paying');
    // (Its oil is already in the stockpile: paid, for the season's summary.)
    settleTurn({ ...e, oil: 0, paid: e.oil, factoryWork: factoryWork.flat().filter(Boolean) });
    // From here the shop, scenes or the new hand hold the screen themselves.
    setTurnRunning(false);
  });
}

/** Debug (Space): play the payout sequence without ending the turn or changing anything. */
let previewing = false;
function previewPayout() {
  if (tutorialBlocks()) return;
  if (payout.active) {
    if (!previewing) {
      payoutHud.batch(() => {
        oilFlights.finish();
        payout.skip(); // a real turn is playing: just finish it
      });
      return;
    }
    cancelPreview(); // restart the preview
  }
  previewing = true;
  runPayout(economyNow(), cancelPreview);
}

function cancelPreview() {
  payout.cancel();
  oilFlights.clear();
  previewing = false;
  document.body.classList.remove('paying');
  updateHUD(); // undo the counter / bar filling
}

/** Draw the food store bar (clamped to the capacity; glows when full, red when empty). */
function showStore(amount, cap, bumpIt = false) {
  payoutHud.showStore(amount, cap, bumpIt);
}

function drawStore(amount, cap, bumpIt = false) {
  const shown = Math.max(0, Math.min(cap, Math.round(amount)));
  $('popFill').style.width = `${cap ? Math.min(1, shown / cap) * 100 : 0}%`;
  $('popFill').classList.toggle('full', cap > 0 && shown >= cap);
  $('popFill').classList.toggle('empty', amount <= 0);
  $('popText').textContent =
    L(`Food stores ${shown} / ${cap}`, `粮仓 ${shown} / ${cap}`) +
    (turn.population ? L(` · population ${turn.population}`, ` · 人口 ${turn.population}`) : '');
  if (bumpIt) {
    $('popText').style.display = 'inline-block'; // same formatting as the former .bump class
    payoutPulse($('popText'), 'food');
  }
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/** Show an oil amount in the stockpile counter and the quota bar at the top. */
/** While the first tribute is carried off (tutorial.tribute): the gauge still shows what was delivered, of what. */
let tributeHeld = null; // { amount, quota }
function showOil(amount, bump = false) {
  payoutHud.showOil(tributeHeld?.amount ?? amount, bump);
}

function drawOil(amount, bump = false) {
  if (tributeHeld) amount = tributeHeld.amount;
  const quota = tributeHeld?.quota ?? turn.quota;
  $('oilStock').textContent = amount;
  $('resOil').textContent = amount;
  $('quotaCount').textContent = L(`${amount} / ${quota} barrels`, `${amount} / ${quota} 桶`);
  gauge.show(amount, quota, bump);
  if (bump) {
    payoutPulse($('oilStock'), 'oil');
    payoutPulse($('quotaCount'), 'quota');
  }
}

/** One blip per hopping tile: oil, food, or a quiet thud when the tile only marks unrest or idle. */
function chimeTile(tile) {
  if (tile.oil) coin();
  if (tile.food) food();
  if (!tile.oil && !tile.food) thud();
}

function runPayout(e, onDone) {
  // Boosters (Water Pump, Oasis, Tar Pit) show what they add over themselves: their share comes off the building
  // they boost, so the totals are unchanged.
  const parts = new Map(e.perCell.map((p) => [`${p.x},${p.z}`, { ...p }]));
  for (const s of e.shares) {
    const from = parts.get(s.from);
    const to = parts.get(s.to);
    if (!from || !to) continue;
    for (const r of ['food', 'oil']) {
      if (!s[r]) continue;
      from[r] -= s[r];
      to[r] += s[r];
    }
  }
  const tiles = [...parts.values()]
    .filter((p) => p.terrain !== 'milfactory' && !isMilitaryLab(p.terrain) && (p.food || p.idle || p.oil || EFFECT_TILES.has(p.terrain)))
    .map((p) => ({ ...p, mesh: payoutMesh(grid.get(p.x, p.z)) }))
    .flatMap(splitTriggers);
  if (!previewing) {
    labOilPool = oilPoolForLabs(e);
    for (const c of grid.cells.values()) {
      if (c.terrain === 'milfactory') factoryJobs.push(chargeOneFactory(c));
      else if (c.terrain === 'decoyworks') factoryJobs.push(chargeDecoyWorks(c));
      else if (isMilitaryLab(c.terrain) && !c.built) factoryJobs.push(chargeOneLab(c));
    }
  }

  // Oil fills the quota bar; food fills the store bar (up to its capacity).
  let shown = turn.stockpile;
  let store = turn.food;
  document.body.classList.add('paying');
  confirm();
  payout.start(
    tiles,
    (tile) => {
      chimeTile(tile);
      const fromGlobe = tile.oil > 0 && view === 'globe' ? globe.screenOf('player') : null;
      if (fromGlobe) {
        // On the War Map: the labels rise above Hive City (payout.anchor) and the gauge fills
        // on its own (no flying barrels), at the board's pace.
        shown += tile.oil;
        showOil(shown, true);
        barrel(Math.min(1, shown / Math.max(1, turn.quota)));
      } else if (tile.oil > 0 && view !== 'board') {
        // In a rival city (or Hive City round the far side of the planet): straight into the gauge.
        shown += tile.oil;
        showOil(shown, true);
        barrel(Math.min(1, shown / Math.max(1, turn.quota)));
      } else if (tile.oil > 0) {
        // The oil flies up into the gauge; each barrel fills it as it lands.
        const w = hexToWorld(tile.x, tile.z);
        tileV.set(w.x, 0.6, w.z).project(steadyCam);
        oilFlights.launch([(tileV.x * 0.5 + 0.5) * window.innerWidth, (-tileV.y * 0.5 + 0.5) * window.innerHeight], tile.oil, shown);
        shown += tile.oil;
      } else if (tile.oil) {
        shown += tile.oil;
        showOil(shown, true);
      }
      if (tile.food) {
        store = Math.max(0, Math.min(e.foodCap, store + tile.food));
        showStore(store, e.foodCap, true);
      }
    },
    () => {
      oilFlights.whenIdle(async () => {
        // Watched from the War Map (or a rival city): fly back to Hive City for the rest of the season.
        const run = runId;
        await backToHive();
        if (run !== runId) return;
        document.body.classList.remove('paying');
        onDone();
      });
    },
  );
}
const tileV = new THREE.Vector3();


/** Back to the board from the War Map or a rival city (the season's wrap-up needs it). Resolves once there. */
async function backToHive() {
  for (let i = 0; i < 80 && (switching || (view === 'globe' && globe.busy)); i++) await wait(0.1);
  if (view === 'globe') await closeGlobe();
  else if (view === 'rival') {
    await swapView(() => {
      closeRivalHand();
      rivalView.exit();
      rivalShown = null;
      document.body.classList.remove('rival-view');
      setBoardFraming(true);
      view = 'board';
      rig.release();
      rig.resetOverscroll();
    });
  }
  for (let i = 0; i < 40 && switching; i++) await wait(0.1);
}

/**
 * A tile triggered more than once (once more per Capital next to it) hops once per trigger, each showing one
 * trigger's share, instead of once with the combined total. The shares add up exactly to the total.
 */
function splitTriggers(p) {
  const n = p.triggers ?? 1;
  if (n < 2) return [p];
  const out = [];
  let oil = p.oil;
  let food = p.food;
  for (let i = 0; i < n; i++) {
    const left = n - i;
    const o = Math.ceil(oil / left);
    const f = Math.ceil(food / left);
    out.push({ ...p, oil: o, food: f });
    oil -= o;
    food -= f;
  }
  return out;
}

/** Tiles that hop even without a number of their own (they boost their neighbours). */
const EFFECT_TILES = new Set(['pump', 'oasis', 'tarpit', 'refinery', 'raider', ...BANDIT_KEYS]);


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

/** Chance that each full cluster of 7 Wasteland draws a bandit camp at the end of a season. */
const BANDIT_CHANCE = 1;
/** Centre cells of every full cluster of 7 Wasteland on the board: a Wasteland cell with Wasteland on all 6 sides. */
function findWasteBlocks() {
  const waste = (x, z) => grid.get(x, z)?.terrain.startsWith('wasteland');
  const out = [];
  for (const c of grid.cells.values()) {
    if (waste(c.x, c.z) && DIRS.every(([dx, dz]) => waste(c.x + dx, c.z + dz))) out.push([c.x, c.z]);
  }
  return out;
}

/**
 * End of season: each full cluster of 7 Wasteland may turn its centre into a random bandit camp.
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
  $('gameoverTitle').textContent = L('The city has fallen', '城市已陷落'); // victory() retitles it
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
  // The year ends on its last season. Oil past the quota stays in the stockpile until then.
  let yearEnds = turn.season >= yearLength() - 1;
  // Text below is built in the current language when shown (functions), so the toast follows a language switch.
  const season = turn.season;
  const round = turn.round;
  const label = () => L(`${SEASONS[season]}, year ${round}`, `第 ${round} 年${SEASONS[season]}`);
  turn.stockpile += e.oil;
  turn.total += e.oil;
  turn.food = e.storeAfter;
  const factoryWork = e.factoryWork ?? [];
  const earned = e.paid ?? e.oil; // what the season made (the payout may have banked it already)

  const sgn = (n) => {
    const r = Math.round(n);
    return r > 0 ? `+${r}` : `${r}`;
  };
  const tag = (n) => `<span class="${Math.round(n) < 0 ? 'bad' : 'good'}">${sgn(n)}</span>`;
  const lines = [
    `<b>${label()}</b>`,
    L(
      `Food ${tag(e.foodBalance)} · Free workers ${e.free}/${e.cap}${e.idle ? ` <span class="bad">(${e.idle} idle)</span>` : ''} · Oil ${tag(earned)}`,
      `食物 ${tag(e.foodBalance)} · 空闲人力 ${e.free}/${e.cap}${e.idle ? ` <span class="bad">（${e.idle} 闲置）</span>` : ''} · 石油 ${tag(earned)}`,
    ),
  ];
  // The toast: parts that are each one L() sentence (switchable as they are) or a function.
  const msg = [() => L(`${label()}: +${earned} oil`, `${label()}：+${earned} 石油`)];
  let kind = 'good';
  if (e.foodWasted)
    lines.push(`<span class="bad">${L(`The stores are full: ${e.foodWasted} food spoiled.`, `粮仓已满：${e.foodWasted} 食物腐坏了。`)}</span>`);
  const missilesMade = factoryWork.filter((w) => w.count && !w.decoy).reduce((s, w) => s + w.count, 0);
  if (missilesMade)
    lines.push(
      `<span class="good">${L(`Military Factory produced ${missilesMade} missile${missilesMade === 1 ? '' : 's'}.`, `军事工厂生产了 ${missilesMade} 枚导弹。`)}</span>`,
    );
  const decoysMade = factoryWork.filter((w) => w.count && w.decoy).reduce((s, w) => s + w.count, 0);
  if (decoysMade) lines.push(`<span class="good">${L(`Decoy Builder produced ${decoysMade} decoy${decoysMade === 1 ? '' : 's'}.`, `诱饵弹建造厂生产了 ${decoysMade} 枚诱饵弹。`)}</span>`);
  if (factoryWork.some((w) => w.decoy && w.stuck)) lines.push(`<span class="bad">${L('A Decoy Builder is waiting: the silo is full.', '诱饵弹建造厂在等待：导弹仓已满。')}</span>`);
  if (factoryWork.some((w) => w.unpaid))
    lines.push(`<span class="bad">${L('A Military Factory had no oil and sat idle.', '一座军事工厂没有石油，未能开工。')}</span>`);
  if ([...grid.cells.values()].some((c) => isMilitaryLab(c.terrain) && !c.built && c.buildHalted))
    lines.push(`<span class="bad">${L('Construction stopped: no oil.', '停止建设：没有石油。')}</span>`);

  // Bandits already camped: what they took this season.
  if (e.oilStolen)
    lines.push(`<span class="bad">${L(`Siphoners drained ${e.oilStolen} oil from your pipelines.`, `窃油者从你的输油管里抽走了 ${e.oilStolen} 石油。`)}</span>`);
  if (e.banditFood) lines.push(`<span class="bad">${L(`Scavengers stole ${e.banditFood} food.`, `拾荒者偷走了 ${e.banditFood} 食物。`)}</span>`);
  // A full cluster of 7 Wasteland draws a new bandit camp.
  for (const camp of spawnBandits()) {
    queueScene('bandit', camp);
    lines.push(`<span class="bad">${L(`Bandits settled the wasteland: ${camp.name} (${camp.effect}).`, `匪徒占据了荒地：${camp.name}（${camp.effect}）。`)}</span>`);
    msg.push(() => L(` · Bandits: ${TERRAINS[camp.kind].name}!`, ` · 匪患：${TERRAINS[camp.kind].name}！`));
    kind = 'bad';
  }

  // Rebels: a season with a food surplus drives one camp off; a season that ends with
  // no food at all (net ≤ 0 and empty stores) brings a new camp, in place for the next season.
  if (Math.round(e.foodBalance) > 0 && departRaider()) {
    lines.push(`<span class="good">${L('Your people are fed: a rebel camp packed up and left.', '你的子民吃饱了：一座叛军营地拔营离去。')}</span>`);
    msg.push(L(' · Raiders left', ' · 掠夺者已离去'));
  }
  if (rebelsRise(e)) {
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
      yearEnds = turn.season >= yearLength() - 1;
      finishSettle();
    });
    return;
  }
  finishSettle();

  function finishSettle() {
  // Tribute at the end of the year, on its last season.
  let failure = null; // set when the tribute is missed: the Overlord comes to speak instead of the shop
  const delivered0 = turn.stockpile;
  const quota0 = turn.quota;
  if (yearEnds) {
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

  // (The attack phase already played at End Turn, before the payout.)
  // The first tribute met: the oil leaves the gauge for the Overlord, then the new target, before the shop.
  if (yearEnds && !failure && tutorial.lessons.open('tribute')) {
    const run = runId;
    tributeHeld = { amount: delivered0, quota: quota0 }; // the full gauge the barrels leave from
    showOil(0);
    tutorial.tribute().then(() => {
      tributeHeld = null;
      if (run !== runId) return;
      updateHUD();
      tutorial.newTarget();
      afterWar();
    });
    return;
  }
  afterWar();

  function afterWar() {
  // Missed tribute: no shop this year. The Overlord comes in person; on the last strike he razes the city.
  if (failure) {
    const final = turn.strikes >= MAX_STRIKES;
    if (!final) {
      turn.season = 0;
      turn.round++;
      tickBlackMarket();
      growRivals();
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
  tickBlackMarket();
  growRivals();
  if (!tutorial.active) toast(() => msg.map(textOf).join(''), kind, 3200); // (the guided opening shows the payout itself)
  // A new year opens with the shop; the hand is dealt when it closes.
  if (turn.season === 0) {
    updateHUD();
    openShop();
  } else dealNewHand();
  }
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
  turn.rerolls = 0; // the year's first paid hand reroll costs 1 again
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
  for (const fn of later) await fn(); // e.g. Prospectors' Unexploded Missile: the missile cinematic (board stays locked)
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
        return L('The map led you to an old Missile Magazine.', '地图把你引向了一座旧储弹仓。');
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
  // Dust Storm: extra Wasteland dealt on top of the normal hand.
  const waste = turn.event?.mods?.extraWaste ?? 0;
  hand.deal(handSize() + waste, [...turn.pinned, ...lessonCards(), ...Array(waste).fill('wasteland')]);
  // The guided opening's hand to play on your own: one Wasteland at most, so the Farm decision isn't crowded out.
  if (tutorial.active) {
    let seen = 0;
    hand.cards = hand.cards.map((p) => (p.terrain.startsWith('wasteland') && !p.pinned && ++seen > 1 ? pieceOf(seen % 2 ? 'station' : 'farm') : p));
    hand.render();
  }
  turn.pinned = [];
  holdingPurchases = false;
  updateHUD();
  pop($('oilStock'));
  tutorial.notify('dealt');
}

/**
 * A tutorial run deals the cards its lessons need, when they need them: the guided opening's card to place on your
 * own, then (once) a Settlement when the workers are about to run out, with a Farm if the food couldn't carry it.
 */
function lessonCards() {
  if (!turn.guided) return [];
  if (tutorial.active) return [OPENING.next];
  const cards = [];
  const e = economyNow();
  // The military lesson, from Autumn of the first year: a Missile Magazine card (kept until it's placed). Its missile
  // comes loaded in it, so the first strike has somewhere to come from.
  const magazine = magazineDue(); // (handed over once this hand is played out: offerMagazine)
  // Housing, once, when the workers are about to run out (the Magazine needs two): a Settlement, and a Farm if the
  // food couldn't carry it.
  const need = magazine ? WORKERS.magazine : 1;
  if (tutorial.lessons.open('workers') && !turn.housingDealt && (e.free <= need || e.idle)) {
    turn.housingDealt = true;
    cards.push('settlement');
    if (Math.round(e.foodBalance) - 2 < 1) cards.push('farm');
  }
  return cards;
}

const hasMagazine = () => [...grid.cells.values()].some((c) => c.terrain === 'magazine');
/** A tutorial run's military lesson is due (from Autumn of the first year) and its Magazine not yet given. */
const magazineDue = () =>
  turn.guided && !turn.gifted && tutorial.lessons.open('war') && (turn.round > 1 || turn.season >= 2) && !hasMagazine() && !hand.cards.some((p) => p.terrain === 'magazine');

/**
 * The military lesson's Missile Magazine comes as an extra card once the season's hand is played out (no Wasteland
 * left to place, and the hand empty or left alone a while), so Next turn is free when the lesson gets to it.
 */
let magazineCheck = 0;
function offerMagazine(dt) {
  magazineCheck -= dt;
  if (magazineCheck > 0) return;
  magazineCheck = 0.5;
  if (!magazineDue() || tutorial.active || view !== 'board' || screenBusy() || turnRunning || warPending) return;
  if (hand.placeableForced.length || hand.piece || hand.dragging) return;
  if (!hand.isEmpty && tutorial.clock - tutorial.lastInput < 5) return;
  hand.addPinned('magazine');
}

/**
 * A tutorial run's Missile Magazine is down: its missile loads into it (a missile rises from it into the Missiles
 * row). That's the one the military lesson fires.
 */
function loadGiftMissile(cell) {
  if (!turn.guided || turn.gifted) return;
  turn.gifted = true;
  if (!tryStoreMissile('missile')) return;
  updateHUD();
  tutorial.missileIn(cell);
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
  const pool = SHOP_ITEMS.filter(([k]) => shopReady(k, turn.unlocked));
  shopStock = [...pool].sort(() => Math.random() - 0.5).slice(0, SHOP_SLOTS);
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
/** Drop a Military Factory next to the Capital if the board has none. */
function debugEnsureFactory() {
  const have = [...grid.cells.values()].filter((c) => c.terrain === 'milfactory');
  if (have.length) return { cells: have, placed: false };
  const cap = mainCapital() ?? { x: 0, z: 0 };
  const ok = (x, z) => inWorld(x, z) && grid.get(x, z)?.terrain !== 'capital';
  let spot = null;
  for (const [dx, dz] of DIRS) {
    const x = cap.x + dx;
    const z = cap.z + dz;
    if (ok(x, z) && !grid.has(x, z)) {
      spot = [x, z];
      break;
    }
  }
  if (!spot) {
    for (const [dx, dz] of DIRS) {
      const x = cap.x + dx;
      const z = cap.z + dz;
      const t = grid.get(x, z)?.terrain;
      if (ok(x, z) && t && !isBuilding(t)) {
        spot = [x, z];
        break;
      }
    }
  }
  const [x, z] = spot ?? [cap.x + 1, cap.z];
  addTile(x, z, 'milfactory');
  shadeIdle();
  updateHUD();
  return { cells: [grid.get(x, z)], placed: true };
}

/** J: put a factory on the board, then play the season settle so a missile is produced. */
function debugMissileSettle() {
  if (turn.over || striking || shopOpen || eventOpen || payout.active) {
    return L('Finish the current screen first', '请先结束当前界面');
  }
  const { cells, placed } = debugEnsureFactory();
  for (const c of cells) c.missileProgress = yearLength() - 1;
  turn.stockpile = Math.max(turn.stockpile, FACTORY_OIL * Math.max(1, cells.length));
  const go = () => {
    hand.select(-1);
    const e = economyNow();
    runPayout(e, () => finishSeasonFx(e));
  };
  if (placed) setTimeout(go, (DROP.fall + 0.2) * 1000);
  else go();
  return placed
    ? L('Military Factory placed · settling', '已放下军事工厂 · 开始结算')
    : L('Settling Military Factory', '正在结算军事工厂');
}

function debugSkipYear(met, surplus = 0) {
  if (turn.over) return 'Game over: restart first';
  if (shopOpen || eventOpen || payout.active) return 'Finish the current screen first';
  if (previewing) cancelPreview();
  hand.select(-1);
  turn.season = yearLength() - 1;
  turn.stockpile = met ? turn.quota : 0;
  const factoryWork = runFactories();
  for (const c of [...grid.cells.values()].filter((c) => c.terrain === 'decoyworks')) {
    // (no animation: chargeDecoyWorks resolves at once when animate is off)
    chargeDecoyWorks(c, false).then((w) => w.count && updateHUD());
  }
  settleTurn({ ...economyNow(), oil: 0, factoryWork });
  if (met && surplus && shopOpen) {
    turn.coins = surplus;
    renderShop();
  }
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

let strikeOpen = false;
let savedSeasonHand = [];
let strikeDone = null;

function openStrikeScreen(opts = {}) {
  if (strikeOpen || shopOpen || payout.active || striking || turn.over || eventOpen) {
    toast(L('Finish the current screen first', '请先结束当前界面'), 'bad');
    return Promise.resolve(null);
  }
  savedSeasonHand = hand.snapshot();
  const drawn = drawStrikeHand(opts.draw ?? ammoCount());
  strikeOpen = true;
  hand.replaceHand(drawn);
  updateHUD();
  toast(
    drawn.length
      ? L('Air strike: missiles drawn. Click a building to fire. Esc or L to leave.', '空袭：导弹已抽出。点建筑开火。Esc 或 L 离开。')
      : L('Air strike: silo empty. Esc or L to leave.', '空袭：弹库是空的。Esc 或 L 离开。'),
    'good',
  );
  return new Promise((resolve) => {
    strikeDone = resolve;
  });
}

function closeStrikeScreen(result = null) {
  if (!strikeOpen) return;
  returnStrikeHand(hand.cards.filter((p) => isPlayerMissile(p.terrain)));
  strikeOpen = false;
  hand.replaceHand(savedSeasonHand);
  savedSeasonHand = [];
  updateHUD();
  const done = strikeDone;
  strikeDone = null;
  done?.(result);
}

bindCityStrikeUi(openStrikeScreen);

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

// ---------- the Black Market: the Smuggler sells military cards for oil from the stockpile, once a year ----------
const BM_MARKUP = 2; // oil per barrel of the market price
const BM_SLOTS = 3;
/** Oil for the cheapest card the Smuggler might bring (what the tutorial's Black Market hint waits for). */
const bmCheapest = () =>
  Math.min(...SHOP_ITEMS.filter(([k]) => (BLACK_MARKET.has(k) || BLACK_MARKET_RESOURCE.has(k)) && shopReady(k, turn.unlocked)).map(([, p]) => p * BM_MARKUP));
const BM_SPEAKER = 'The Smuggler';

/** Seasons until the Smuggler comes back (one full year from a visit). */
function tickBlackMarket() {
  if (turn.bmCooldown > 0) turn.bmCooldown--;
}

$('btnBlackMarket').querySelector('.bm-icon').innerHTML = MAP_ICONS.crate;

/** The first season of each year the Smuggler stays away: there's no oil to spend yet. Opens on season 2. */
const bmYearStart = () => turn.season === 0;
/** Seasons until the Black Market can be visited (its cooldown, or the wait out of a year's first season). */
const bmWait = () => Math.max(turn.bmCooldown, bmYearStart() ? 1 : 0);

function knewMarket() {
  const r = tutorial.lessons.get('market');
  return r.done || r.dismissed || r.shown > 0;
}

/** The plate stays hidden until the Smuggler is introduced (the market hint, or a later fallback). */
let bmRevealed = false;
function revealBlackMarket(animate = true) {
  if (bmRevealed) return;
  bmRevealed = true;
  const btn = $('btnBlackMarket');
  btn.classList.remove('unseen');
  if (animate) {
    btn.classList.remove('arriving');
    void btn.offsetWidth;
    btn.classList.add('arriving');
  }
}

function updateBlackMarketButton() {
  const btn = $('btnBlackMarket');
  if (!bmRevealed && !bmYearStart() && bmWait() <= 0 && (knewMarket() || turn.round >= 2)) revealBlackMarket(true);
  btn.classList.toggle('unseen', !bmRevealed);
  const wait = bmWait();
  btn.classList.toggle('cooling', wait > 0);
  btn.classList.toggle('ready', wait <= 0 && bmRevealed);
  $('bmWait').classList.toggle('hidden', wait <= 0);
  $('bmWait').textContent = L(`${wait} season${wait === 1 ? '' : 's'}`, `${wait} 季`);
  btn.title = wait > 0
    ? L(`Black Market: the Smuggler is back in ${wait} season${wait === 1 ? '' : 's'}`, `黑市：走私贩将在 ${wait} 季后回来`)
    : L('Black Market: military cards for oil', '黑市：用石油购买军事卡牌');
}

// First visit: a field report announces the Dune Crawler at the gates, then the Smuggler reports in to the Overseer.
const BM_ARRIVAL = [
  () => L("Sorry to interrupt, Overseer. There's a Dune Crawler at the gates. Huge thing, armoured, no markings, no colours. I don't like the look of it.", '抱歉打扰，总督。城门外来了一辆沙丘爬行车。个头很大，装甲厚重，没有标识，也没挂旗。我不太喜欢它的样子。'),
  () => L("Its crew are asking to see you personally. I've had the guards hold them at the outer wall. Shall I bring them in?", '车上的人要求亲自见您。我已经让卫兵把他们拦在外墙了。要我带他们进来吗？'),
];
const BM_INTRO = [
  () => L('*salutes* Overseer. An honour. Forgive the size of the Crawler. Business has been good.', '*敬礼* 总督。荣幸之至。请原谅这辆爬行车的块头，最近生意不错。'),
  () => L("They call me the Smuggler. I run cargo across the dunes, the kind the Overlord's convoys don't carry and his ledgers don't list.", '大家叫我走私贩。我在沙丘间跑货，跑的是霸主的车队不运、账本上也不记的那种。'),
  () => L('Two aisles in the hold. Military: factories, interceptors, warheads, magazines. Everything a city needs to bite back.', '货舱分两排。军事：军工厂、拦截网、弹头、弹药库。一座城反咬一口所需的一切。'),
  () => L('And Resource: pumps, refineries, oases, labour camps. The things that keep the oil flowing.', '还有资源：油泵、炼油厂、绿洲、劳工营。让石油源源不断的东西。'),
  () => L("Payment in oil, from your stockpile. And yes, double the Overlord's price. Discretion costs extra.", '用石油付款，直接从你的储备里扣。没错，是霸主价格的两倍。保密可是要另算的。'),
];
const BM_ASK_FIRST = () => L('The Crawler makes this run once a year, Overseer. Shall I open the hold?', '这辆爬行车一年只跑一趟，总督。要我打开货舱吗？');
// Later visits: a one-line report, then a fresh greeting.
const BM_RETURNS = [
  () => L('Your friend with the Crawler is back, Overseer. Parked at the gates as if he owns them.', '您那位开爬行车的朋友又来了，总督。就停在城门口，好像城门是他家的。'),
  () => L("Dust on the horizon. That'll be the Smuggler again, I'd bet my stamp on it.", '地平线上扬起沙尘了。肯定又是那个走私贩，我拿我的印章打赌。'),
  () => L("The gate guard's on the line. That Crawler's back, and asking for you by name.", '守门卫兵来电话了。那辆爬行车又回来了，点名要见您。'),
];
const BM_GREETINGS = [
  () => L("*salutes* Overseer. The convoy was light this year, but I kept the good stuff for you.", '*敬礼* 总督。今年车队货不多，但好东西我给你留着。'),
  () => L("Overseer. Quick, before the Overlord's patrol swings round. What do you need?", '总督。快点，霸主的巡逻队要绕回来了。你要什么？'),
  () => L("Fresh crates, barely scorched. Oil first, questions never.", '新到的货箱，只烧焦了一点。先付油，别多问。'),
  () => L("Rivals have been buying. If you want to keep up, you'd better buy too.", '你的对手们一直在买。想不落后，最好也买点。'),
  () => L("The Overlord's men searched my truck twice this season. Found nothing. Want to see why?", '霸主的人这季搜了我的车两次，什么也没找到。想知道为什么吗？'),
  () => L("Missiles don't build themselves. Well, the factories do. But you need the factories.", '导弹不会自己造出来。好吧，工厂会造。但你得先有工厂。'),
];
const BM_FAREWELLS = [
  () => L("*salutes* A pleasure, Overseer. You never saw the Crawler.", '*敬礼* 合作愉快，总督。您从没见过这辆爬行车。'),
  () => L("Same time next year. Try to still be standing.", '明年同一时间。尽量别倒下。'),
  () => L("Keep your head down, and your interceptors up.", '低调做人，拦截网可要立着。'),
];
const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];

async function openBlackMarket() {
  if (blackMarketOpen) return;
  if (turn.bmCooldown <= 0 && bmYearStart()) return toast(L('The Smuggler arrives next season, once the oil is flowing.', '走私贩下一季才来，等石油流动起来再说。'), 'bad');
  if (turn.bmCooldown > 0) return toast(L(`The Smuggler is gone. Back in ${turn.bmCooldown} season${turn.bmCooldown === 1 ? '' : 's'}.`, `走私贩已离开，${turn.bmCooldown} 季后回来。`), 'bad');
  if (view !== 'board') return toast(L('Return to Hive City first', '请先返回蜂巢城'));
  if (screenBusy() || strikeOpen || warPending || previewing) return toast(L('Finish the current screen first', '请先完成当前界面'));
  if (!tutorial.allows('market')) return tutorial.rejected({ code: 'early' });
  const run = runId;
  blackMarketOpen = true;
  tutorial.notify('market');
  hand.select(-1);
  dialogue.open({ kind: 'choice', kindLabel: () => L('Black Market', '黑市'), title: () => L('A Dune Crawler at the gates', '城门外的沙丘爬行车') });
  // The field report first (the Dune Crawler at the gates), then the Smuggler himself.
  for (const line of turn.bmMet ? [pickLine(BM_RETURNS)] : BM_ARRIVAL) {
    await dialogue.say('Field Report', line);
    if (run !== runId) return;
  }
  if (!turn.bmMet) {
    for (const line of BM_INTRO) {
      await dialogue.say(BM_SPEAKER, line);
      if (run !== runId) return;
    }
  }
  const choice = await dialogue.ask(BM_SPEAKER, turn.bmMet ? pickLine(BM_GREETINGS) : BM_ASK_FIRST, [
    { text: () => L('Show me the goods.', '让我看看货。') },
    { text: () => L('Not today.', '今天不用了。') },
  ]);
  if (run !== runId) return;
  turn.bmMet = true;
  if (choice !== 0) {
    await dialogue.say(BM_SPEAKER, () => L("As you wish, Overseer. The Crawler stays at the gates a while... for now.", '遵命，总督。爬行车会在城门外再停一阵……暂时。'));
    if (run !== runId) return;
    await dialogue.leave();
    blackMarketOpen = false; // no sale, no cooldown
    return;
  }
  await dialogue.leave();
  if (run !== runId) return;
  // The visit counts: the Smuggler won't be back for a year, bought or not.
  turn.bmCooldown = yearLength();
  updateBlackMarketButton();
  // Both aisles are stocked once per visit: browsing back and forth never rerolls them.
  const roll = (set) =>
    SHOP_ITEMS.filter(([k]) => set.has(k) && shopReady(k, turn.unlocked))
      .sort(() => Math.random() - 0.5)
      .slice(0, BM_SLOTS)
      .map(([k, price]) => [k, price * BM_MARKUP, false]);
  bmStock = { military: roll(BLACK_MARKET), resource: roll(BLACK_MARKET_RESOURCE) };
  bmCategory = null;
  renderBlackMarket(true);
  const el = $('blackMarket');
  el.classList.remove('hidden', 'opening');
  void el.offsetWidth;
  el.classList.add('opening');
  document.body.classList.add('shopping');
}

const BM_AISLES = {
  military: {
    icon: () => MAP_ICONS.missile,
    name: () => L('Military', '军事'),
    blurb: () => L('Weapons, defences and war production', '武器、防御与军工生产'),
    list: () => L('Factories · Interceptors · Warheads · Magazines · Militia', '军工厂 · 拦截网 · 弹头 · 弹药库 · 民兵'),
    hint: () => L('Military cards, paid in oil from your stockpile at double the price. Bought cards go straight into your hand and unlock for good.', '军事卡牌，用储备石油按双倍价格支付。买下的卡牌直接加入手牌，并永久解锁。'),
    empty: () => L('Nothing in this crate today, Overseer.', '这只箱子今天是空的，总督。'),
  },
  resource: {
    icon: () => ICONS.oil,
    name: () => L('Resource', '资源'),
    blurb: () => L('Oil, food, labour and the tools to run them', '石油、粮食、劳力及其配套工具'),
    list: () => L('Pumps · Refineries · Oases · Labour Camps · Demolition', '油泵 · 炼油厂 · 绿洲 · 劳工营 · 拆除'),
    hint: () => L('Resource cards, paid in oil from your stockpile at double the price. Bought cards go straight into your hand and unlock for good.', '资源卡牌，用储备石油按双倍价格支付。买下的卡牌直接加入手牌，并永久解锁。'),
    empty: () => L('Nothing in this crate today, Overseer.', '这只箱子今天是空的，总督。'),
  },
};

function renderBlackMarket(animate = false) {
  $('bmOil').textContent = L(`${turn.stockpile} oil in the stockpile`, `储备石油 ${turn.stockpile}`);
  $('btnBmBack').classList.toggle('hidden', !bmCategory);
  if (!bmCategory) {
    // First the aisle: two crates in the Crawler's hold.
    $('bmHint').textContent = L('The hold has two aisles. Pick one to see what the Smuggler brought.', '货舱分两排。选一排，看看走私贩带了什么。');
    $('bmCards').innerHTML = Object.entries(BM_AISLES).map(([id, a], i) => {
      const left = bmStock[id].filter((it) => !it[2]).length;
      return `
        <button class="bm-aisle${animate ? ' deal' : ''}" data-cat="${id}" style="animation-delay:${0.15 + i * 0.1}s">
          <span class="bm-aisle-icon">${a.icon()}</span>
          <span class="bm-aisle-name">${a.name()}</span>
          <span class="bm-aisle-blurb">${a.blurb()}</span>
          <span class="bm-aisle-list">${a.list()}</span>
          <span class="bm-aisle-count">${L(`${left} offer${left === 1 ? '' : 's'}`, `${left} 件货`)}</span>
        </button>`;
    }).join('');
    return;
  }
  const aisle = BM_AISLES[bmCategory];
  $('bmHint').textContent = aisle.hint();
  $('bmCards').innerHTML = bmStock[bmCategory].map(([k, price, sold], i) => {
    const t = cardDef(k);
    const can = !sold && turn.stockpile >= price;
    return `
      <div class="shop-item">
        <div class="card${can ? '' : ' cant'}${animate ? ' deal' : ''}" data-k="${k}" data-i="${i}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${0.15 + i * 0.07}s">
          <div class="art">${cardArtHTML(k)}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>
        <div class="price">${sold ? L('Sold', '已售') : L(`${price} oil`, `${price} 石油`)}<small>${L(`black market ×${BM_MARKUP}`, `黑市 ×${BM_MARKUP}`)}</small></div>
        <div class="tag">${unlockTag(k)}</div>
      </div>`;
  }).join('') || `<p>${aisle.empty()}</p>`;
}

$('bmCards').addEventListener('click', (e) => {
  if (!blackMarketOpen) return;
  const pick = e.target.closest('.bm-aisle[data-cat]');
  if (pick) {
    pick.blur();
    bmCategory = pick.dataset.cat;
    tick();
    renderBlackMarket(true);
    return;
  }
  const card = e.target.closest('.card[data-i]');
  if (!card || !bmCategory) return;
  const item = bmStock[bmCategory][Number(card.dataset.i)];
  const [k, price, sold] = item;
  if (sold) return;
  if (turn.stockpile < price) return deny();
  turn.stockpile -= price;
  item[2] = true;
  turn.unlocked.add(k);
  hand.addPinned(k); // kept through the next deal until played
  ghostPrice(null);
  tutorial.notify('purchased');
  showOil(turn.stockpile, true);
  coin();
  renderBlackMarket();
  updateHUD();
});

$('btnBmBack').addEventListener('click', (e) => {
  e.currentTarget.blur();
  bmCategory = null;
  tick();
  renderBlackMarket(true);
});

/** `farewell` false (a reset): close at once, no parting line. */
async function closeBlackMarket(farewell = true) {
  const wasOpen = !$('blackMarket').classList.contains('hidden');
  $('blackMarket').classList.add('hidden');
  if (!shopOpen) document.body.classList.remove('shopping');
  if (!farewell) {
    blackMarketOpen = false;
    return;
  }
  if (!wasOpen) return;
  const run = runId;
  dialogue.open();
  await dialogue.say(BM_SPEAKER, pickLine(BM_FAREWELLS));
  if (run !== runId) return;
  await dialogue.leave();
  blackMarketOpen = false;
  updateHUD();
}

$('btnBlackMarket').addEventListener('click', (e) => {
  e.currentTarget.blur();
  openBlackMarket();
});
$('btnBmLeave').addEventListener('click', (e) => {
  e.currentTarget.blur();
  closeBlackMarket();
});
onLangChange(() => blackMarketOpen && !$('blackMarket').classList.contains('hidden') && renderBlackMarket());


/** Show 3 random market tiles; the clicked one is unlocked and put in the next hand for free. */
function openCardPick() {
  pickOptions = SHOP_ITEMS.filter(([k]) => !BASIC_SHOP.has(k) && shopReady(k, turn.unlocked)).sort(() => Math.random() - 0.5).slice(0, PICK_SLOTS);
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
const hit = new THREE.Vector3();

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  // A touch has no hover before it presses: where it lands is where it points.
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = true;
  if (e.button === 2) hand.rotate(1);
});

// Dragging a card out of the hand: the ghost follows the pointer (touch keeps sending moves to the card,
// not the canvas, so the pointer is updated from here), and releasing over the board places it as a click would.
const overBoard = (x, y) => document.elementFromPoint(x, y) === renderer.domElement;
hand.onDragMove = (x, y) => {
  pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  pointerInside = overBoard(x, y);
};
// While dragging a card (left button held), a right click rotates the piece. A second button pressed during a
// drag is a "chorded" press: browsers send no pointerdown for it, only mousedown, so it is caught here.
window.addEventListener(
  'mousedown',
  (e) => {
    if (e.button !== 2 || !hand.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    hand.rotate(1);
  },
  { capture: true },
);
window.addEventListener('contextmenu', (e) => hand.dragging && e.preventDefault(), { capture: true });
hand.onDrop = (x, y) => {
  if (!overBoard(x, y)) return;
  if (view === 'rival') {
    // A missile card dragged onto a rival tile: the rocket flies out of the card onto it.
    hand.onDragMove(x, y);
    dropMissileOnRival();
    return;
  } // dropped back on the hand or a panel: nothing placed, the card stays picked
  hand.onDragMove(x, y);
  tryPlace();
};

const warped = new THREE.Vector2();
function hoveredCell() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(crtPass.warp(warped.copy(pointer)), camera); // the CRT's bend: what shows under the pointer
  if (!intersectGround(raycaster.ray, hit)) return null; // on the bent (small-planet) ground
  return worldToHex(hit.x, hit.z);
}

// ---------- mystery sites ----------
/** "?" sites touching the newly placed cells turn into their tiles. */
function revealMysteries(cells) {
  const found = mysteries.revealAround(cells);
  if (!found.length) return;
  tutorial.notify('revealed', { found });
  const tiles = landReveals(found, (i) => 0.25 + i * 0.15);
  if (tiles.length < found.length) return; // a missile: its own toast
  if (tutorial.active) return; // the guided opening shows the find itself (no caption)
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
  if (view !== 'board') return;
  if (turn.over || shopOpen || eventOpen) return;
  if (payout.active) {
    payoutHud.batch(() => payout.skip()); // clicking the board during the payout fast-forwards it
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
    if (tutorial.active) return tutorial.rejected({ code: 'early' });
    toast(
      strikeOpen
        ? L('Pick a missile, then click a building', '选出导弹，再点一座建筑')
        : hand.isEmpty
          ? L('Hand used up: press Next turn', '手牌已用完：请按“下一回合”')
          : L('Pick a piece from your hand', '从手牌中选择一个板块'),
    );
    return;
  }
  if (strikeOpen && !isPlayerMissile(piece.terrain)) {
    toast(L('Air strike: only missiles', '空袭中只能打出导弹'), 'bad');
    return;
  }
  const cell = hoveredCell();
  if (!cell) return;
  const cells = placement.cellsAt(cell);
  const result = placement.validate(cells);
  if (!result.ok) {
    placement.reject();
    buzz();
    // Shown where the problem is (crosses on what's in the way, a broken link, the cells to use); the guided opening
    // refuses without words.
    tutorial.rejected(result, piece, cells);
    if (result.reason && !tutorial.active) toast(result.reason, 'bad', 1600, false);
    return;
  }
  if (ACTIONS[piece.terrain]) {

    const played = piece.terrain;
    const fromHand = isPlayerMissile(played) ? worldFromHandCard() : null;
    hand.consume();
    if (played === 'spark') spark(cells);
    else if (played === 'militia') militia(...cells[0]);
    else if (played === 'missile' || played === 'missile2') firePlayerMissile(cells, fromHand);
    else if (played === 'salvo') {
      const ammo = missileAmmoInHand();
      const fan = spreadFrom(grid, cells[0], ammo.length);
      fan.forEach(([x, z]) => craterAt(x, z));
      const used = new Set(ammo.slice(0, fan.length));
      hand.cards = hand.cards.filter((p) => !used.has(p));
      hand.render();
      updateHUD();
    }
    else if (played === 'overtime') workOvertime(...cells[0]);
    else if (piece.terrain === 'demolish2') {
      const targets = placement.demolishable(cells);
      targets.forEach(([x, z]) => demolish(x, z, true));
      demolition(true);
      toast(L(`Demolished ${targets.length} tile${targets.length === 1 ? '' : 's'}`, `拆除了 ${targets.length} 个地块`));
    } else {
      demolish(...cells[0]);
      demolition();
    }
    return;
  }
  const before = economyNow();
  const idleBefore = before.idle;
  if (piece.terrain.startsWith('wasteland')) addWastePiece(piece, cells);
  else cells.forEach(([x, z], i) => addTile(x, z, piece.terrain, i * 0.05, false, { rot: piece.rot }));
  piecesPlaced++;
  if (!tutorial.active) showPlacementCost(piece, cells); // (the guided opening shows the cost with its own tokens)
  hand.consume();
  if (!grid.expansionMode) revealMysteries(cells);
  frontier.rebuild(grid);
  updateHUD();
  if (economyNow().idle > idleBefore && !tutorial.active)
    toast(L('No free workers: this building sits idle until you add housing', '没有空闲人力：这座建筑将一直闲置，直到你建造更多住房'), 'bad', 2400);
  tutorial.notify('placed', { terrain: piece.terrain, cells, before });
  if (piece.terrain === 'magazine') loadGiftMissile(cells[0]);
  if (piece.terrain === 'milfactory' && !turn.seenMilFactory && !tutorial.active) {
    turn.seenMilFactory = true;
    playMilFactoryScene();
  }
}

/** The first Military Factory goes up: the Overlord takes notice, and dangles a promotion. Once per run. */
async function playMilFactoryScene() {
  const run = runId;
  await wait(0.9); // let the building land first
  if (run !== runId) return;
  const prevEvent = eventOpen;
  eventOpen = true;
  hand.select(-1);
  const rivalCount = rivals.filter((r) => r.alive !== false).length;
  dialogue.open({ kind: 'fortune', kindLabel: () => L('Field Report', '前线报告'), title: () => L('The first Military Factory', '第一座军工厂') });
  const lines = [
    ['Field Report', () => L("The Military Factory's up and running, Overseer. I've seen the schedule: our first missile should be ready in about a year.", '军工厂已经开工了，总督。我看过进度表：第一枚导弹大约一年后就能造好。')],
    ['The Overlord', () => L('A missile factory. So my Overseer has grown teeth.', '一座导弹工厂。看来我的总督长出獠牙了。')],
    ['The Overlord', () => L(`Look at the War Map. ${rivalCount} cities squat on my sands, pumping oil that should be mine.`, `看看战争地图。${rivalCount} 座城市盘踞在我的沙漠上，抽着本该属于我的石油。`)],
    ['The Overlord', () => L('Wipe them off it, every last one, and I may find you something grander than a Hive City to run.', '把它们从地图上抹掉，一座不留，我或许会给你一个比蜂巢城更宏伟的位置。')],
    ['The Overlord', () => L('Call it a promotion. Just never forget whose oil pays for those missiles.', '就当是一次晋升吧。只是永远别忘了，这些导弹是用谁的石油造的。')],
  ];
  for (const [who, line] of lines) {
    await dialogue.say(who, line);
    if (run !== runId) return;
  }
  await dialogue.leave();
  if (run !== runId) return;
  eventOpen = prevEvent;
  updateHUD();
}

/**
 * A building just placed: what it takes floats up from it (workers it needs, or food it eats each season),
 * with the resource icon, in the payout label style. Nothing for tiles that cost nothing.
 */
const costV = new THREE.Vector3();
/** World point under the selected hand card, so a missile can launch out of the card. */
function worldFromHandCard() {
  const el = document.querySelector('#hand .card.selected') ?? document.querySelector('#hand .card');
  const r = el?.getBoundingClientRect();
  const sx = r ? r.left + r.width / 2 : window.innerWidth * 0.38;
  const sy = r ? r.top + r.height * 0.38 : window.innerHeight * 0.82;
  flyV.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1, 0.32);
  flyV.unproject(camera);
  return { x: flyV.x, y: flyV.y, z: flyV.z, world: true };
}

/** The Missile Magazine a player missile launches from: the nearest to its target that isn't already launching. */
/** Missile Magazines that can fire now: built (their model loaded, with its Launch clip) and not mid-launch. */
const readySilos = () =>
  [...grid.cells.values()].filter((c) => c.terrain === 'magazine' && c.mesh && !c.mesh.userData.launching && factory.canCue(c.mesh, 'Launch'));

/** The Missile Magazine a player missile launches from: the nearest to its target. */
function launchSilo(aim) {
  let best = null;
  let bestD = Infinity;
  for (const c of readySilos()) {
    const d = hexDistance(c.x, c.z, aim.x, aim.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// The magazine's Launch clip (seconds): the petals are open by SILO_RELOAD; the missile reaches the silo's mouth at
// SILO_CUT, and the flight takes over from there (the model's own missile and flame vanish; its launch smoke plays
// on, and the petals close). A magazine firing several jumps back from SILO_AGAIN to SILO_RELOAD: the next one rises.
// A missile that won't launch (nothing to hit) stops at SILO_STUCK: risen into the mouth, before its flame lights.
const SILO_CUT = 3;
const SILO_STUCK = 2.5;
const SILO_AGAIN = 3.6;
const SILO_RELOAD = 1.5;
const SILO_SPEED = 1.6;
const SILO_PARTS = ['MissileMagazine_Missile', 'MissileMagazine_Flame'];
const siloV = new THREE.Vector3();
const siloS = new THREE.Vector3();

/**
 * A Missile Magazine fires `count` missiles, one after another: it opens and raises each to the silo's mouth, where
 * launch(from, i) takes over. from: the world point there, carrying a copy of the magazine's missile as the flight's
 * body (missiles.js). Resolves at the last launch (null: the model can't, see readySilos).
 */
function siloLaunch(cell, count, launch) {
  const mesh = cell.mesh;
  mesh.userData.launching = true;
  return factory.cue(mesh, 'Launch', {
    speed: SILO_SPEED,
    cutAt: SILO_CUT,
    hide: SILO_PARTS,
    repeat: count - 1,
    repeatFrom: SILO_AGAIN,
    repeatAt: SILO_RELOAD,
    onEnd: () => (mesh.userData.launching = false),
    cut: (i) => {
      const missile = mesh.getObjectByName(SILO_PARTS[0]);
      if (!missile) return null;
      launchSnd();
      dust.burst(cell.x, cell.z, 1.2);
      camShake.add(0.25);
      return launch(siloFrom(missile), i);
    },
  });
}

/** Where the magazine's missile stands, as a flight start: its tail lined up with the flight missile's. */
function siloFrom(missile) {
  missile.getWorldPosition(siloV);
  const copy = missile.clone();
  copy.position.set(0, -MISSILE_TAIL, 0);
  copy.quaternion.identity();
  copy.scale.setScalar(missile.parent.getWorldScale(siloS).y / missileCfg.missileScale); // (its own scale is 1 here)
  copy.traverse((o) => (o.visible = true));
  const body = new THREE.Group().add(copy);
  return { x: siloV.x, y: siloV.y + MISSILE_TAIL * missileCfg.missileScale, z: siloV.z, world: true, silo: true, body };
}

/** The magazine opens and raises its missile; resolves with the flight's start at the silo's mouth. */
function launchFromSilo(cell) {
  // Keep the launch on screen: if the magazine is out of view, look between it and the board's middle.
  const w = hexToWorld(cell.x, cell.z);
  siloV.set(w.x, 0, w.z).project(steadyCam);
  if (Math.abs(siloV.x) > 0.85 || Math.abs(siloV.y) > 0.8) rig.focus(w.x / 2 + rig.target.x / 2, w.z / 2 + rig.target.z / 2);
  return siloLaunch(cell, 1, (from) => from);
}

/**
 * The attack phase opens on your board: the Missile Magazines open and fire the season's aimed missiles up out of
 * the city (each its share, one after another), before the War Map shows them fly. No magazine: nothing to show.
 */
const SALVO_CLOSE = 8; // camera distance on one magazine
/**
 * strikes: the player's resolved strikes (war.js: each has its launcher cell, boosted flag and kind). Each launcher
 * fires its own: a Magazine through its Launch clip, a Decoy Builder straight off its roof.
 */
async function launchSalvo(strikes) {
  if (!strikes.length) return;
  const run = runId;
  // No camera move, no UI change: the magazines fire wherever you're looking, while the countdown runs.
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  camDir.normalize();
  const flights = [];
  const fireAway = (from, s) => {
    const side = (Math.random() - 0.5) * 4;
    const lean = { x: camDir.x * 5 - camDir.z * side, z: camDir.z * 5 + camDir.x * side }; // off over the horizon
    const boosted = !!s?.boosted;
    flights.push(missiles.fire([{ x: from.x, z: from.z, from, away: true, lean, flight: boosted ? 1.6 * BOOST.flight : 1.6, accel: 1.9, boosted, harmless: !!s?.decoy }]));
  };
  // Group by launcher cell (war.js assignLaunchers).
  const groups = new Map();
  for (const s of strikes) {
    if (!s.launcher) continue;
    const k = `${s.launcher.x},${s.launcher.z}`;
    if (!groups.has(k)) groups.set(k, { x: s.launcher.x, z: s.launcher.z, list: [] });
    groups.get(k).list.push(s);
  }
  const ready = new Set(readySilos().map((c) => `${c.x},${c.z}`));
  const jobs = [];
  for (const [k, g] of groups) {
    const cell = grid.get(g.x, g.z);
    if (!cell?.mesh) continue;
    if (cell.terrain === 'magazine' && ready.has(k)) {
      // Every magazine fires together (a hair apart), each then reloading for its next missile.
      jobs.push(wait(Math.random() * 0.12).then(() => run === runId && siloLaunch(cell, g.list.length, (from, i) => fireAway(from, g.list[i]))));
    } else if (cell.terrain === 'decoyworks') {
      const w = hexToWorld(cell.x, cell.z);
      jobs.push(
        (async () => {
          for (const s of g.list) {
            await wait(0.1 + Math.random() * 0.25);
            if (run !== runId) return;
            dust.burst(cell.x, cell.z, 0.8);
            launchSnd();
            fireAway({ x: w.x, y: 0.55, z: w.z, world: true }, s);
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
  await Promise.all(flights);
}

async function firePlayerMissile(cells, fromHand = null) {
  const size = blastExtra(grid, idleKeySet());
  const origin = cells[0];
  const hits = placement.missileable(footprint('missile', origin, size, grid));
  if (!hits.length) return;
  const aim = {
    x: Math.round(hits.reduce((s, [x]) => s + x, 0) / hits.length),
    z: Math.round(hits.reduce((s, [, z]) => s + z, 0) / hits.length),
    from: fromHand ?? worldFromHandCard(),
    flight: 1.55,
    accel: 1.25,
  };
  const run = runId;
  // With a Missile Magazine built, the missile comes out of its silo instead of out of the card.
  const silo = launchSilo(aim);
  if (silo) {
    const mouth = await launchFromSilo(silo);
    if (run !== runId) return;
    if (mouth) Object.assign(aim, { from: mouth, flight: 1.9, accel: 1.2 });
  }
  await playMissileStrike([aim], {
    convert: false,
    follow: false,
    skipLead: true,
    trackCamera: false,
    holdAfter: 0.9,
    onCover: () => {
      const size = blastExtra(grid, idleKeySet());
      for (const [x, z] of footprint('missile', origin, size, grid)) {
        const t = grid.get(x, z)?.terrain;
        if (t === 'capital') continue;
        if (t) craterAt(x, z);
        else if (inWorld(x, z)) addTile(x, z, 'crater');
      }
    },
  });
  if (run !== runId) return;
  toast(
    L(`Missile left ${hits.length} crater${hits.length === 1 ? '' : 's'}`, `导弹留下了 ${hits.length} 个弹坑`),
    'good',
  );
  updateHUD();
}

async function workOvertime(x, z) {
  const cell = grid.get(x, z);
  const need = yearLength();
  const idle = idleKeySet();
  if ((cell.missileProgress ?? 0) < need) cell.missileProgress = (cell.missileProgress ?? 0) + 1;
  if (cell.missileProgress >= need) {
    const y = await finishFactoryMissile(cell, idle);
    if (!y.stuck) toast(L(y.count > 1 ? 'Rush order finished missiles' : 'Rush order finished a missile', '赶工令造出了导弹'), 'good');
  } else {
    toast(L(`Factory progress ${cell.missileProgress} / ${need}`, `工厂进度 ${cell.missileProgress} / ${need}`), 'good');
  }
  updateHUD();
}

function showPlacementCost(piece, cells) {
  const { workers, food, oil } = pieceCost(piece);
  const rows = [];
  if (workers) rows.push(`<div class="row neg"><b>-${workers}</b>${ICONS.manpower}</div>`);
  if (food) rows.push(`<div class="row neg"><b>-${food}</b>${ICONS.food}<span>${L('/ season', '/ 季')}</span></div>`);
  if (oil && piece.terrain === 'milfactory') rows.push(`<div class="row neg" style="--c:#ff5a44"><b>-${oil}</b>${ICONS.oil}<span>${L('/ season', '/ 季')}</span></div>`);
  if (!rows.length) return;
  const world = cells.map(([x, z]) => hexToWorld(x, z));
  const cx = world.reduce((s, w) => s + w.x, 0) / cells.length;
  const cz = world.reduce((s, w) => s + w.z, 0) / cells.length;
  costV.set(cx, 0.9, cz).project(steadyCam);
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
const triggers = (p) => cardDef(p.terrain)?.trigger === 'On trigger' && !p.idle && p.terrain !== 'milfactory';
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

function playerBuildingCount() {
  let count = 0;
  for (const cell of grid.cells.values()) if (isBuilding(cell.terrain)) count++;
  return count;
}

// ---------- war: aiming at a rival city, then the attack phase ----------
// Visiting a rival with missiles in the silo swaps the season hand for missile cards (as the strike screen did):
// pick a card and drag it onto one of their tiles to aim it. Leaving the city puts unplayed cards back.
// Aiming only marks the target (a reticle and flight path stay on it): everything aimed fires after End Turn.
let rivalHand = null; // the season hand, saved while the missile cards are out
let aimHover = null;
let aimAt = null; // a salvo's cell under the cursor: its reticle centres there

const aimPiece = () => (view === 'rival' && rivalHand && isPlayerMissile(hand.piece?.terrain) ? hand.piece : null);

function openRivalHand(rival) {
  if (rivalHand || rival.alive === false || turn.over || attackLive || !ammoCount()) return;
  rivalHand = hand.snapshot();
  hand.replaceHand(drawStrikeHand(ammoCount()));
  document.body.classList.add('rival-hand');
}

function closeRivalHand() {
  if (!rivalHand) return;
  returnStrikeHand(hand.cards.filter((p) => isPlayerMissile(p.terrain)));
  hand.replaceHand(rivalHand);
  rivalHand = null;
  aimHover = null;
  aimAt = null;
  document.body.classList.remove('rival-hand');
  updateHUD();
}

function updateAimBar() {
  const rival = rivalShown;
  $('btnRivalAttack').classList.add('hidden'); // aiming starts from the hand now
  $('btnRivalKind').classList.add('hidden');
  const q = rival ? queuedStrikes(rival.id).length : 0;
  const cards = rivalHand ? hand.cards.filter((p) => isPlayerMissile(p.terrain)).length : 0;
  $('rivalAim').classList.toggle('hidden', !rival || rival.alive === false || (!q && !cards));
  $('rivalQueue').textContent = L(`${q} aimed · ${cards} in hand · fires after End Turn`, `已瞄准 ${q} · 手牌 ${cards} · 结束回合后发射`);
  const aimed = rival ? queuedStrikes(rival.id) : [];
  const aimedCells = aimed.map((s) => s.cells ?? footprint(s.kind, s.at, s.size, rival.grid));
  rivalView.setMarkers(aimedCells, aimHover, aimAt);
  // A salvo shows one flight path per missile in it.
  const fan = aimPiece()?.terrain === 'salvo';
  rivalView.setArcs(aimHover ? (fan ? aimHover.map((c) => [c]) : [aimHover]) : [], rival ? homeBearing(rival) : null, aimedCells.flat(), fan ? null : aimAt);
  // What's aimed keeps its reticle and path until End Turn fires it: one per card played (a salvo's tiles together).
  // One per missile, so a salvo keeps every flight path.
  const groups = aimed.map((q, i) => ({ key: `${q.card ?? plotKey(q.at[0], q.at[1])}|${i}`, cells: aimedCells[i], at: q.at }));
  rivalView.setAimed(groups, rival ? homeBearing(rival) : null);
  globe?.setQueued(queuedStrikes().map((s) => ({ from: 'player', to: s.to })));
}

/** Which way Hive City lies from a rival on the War Map (unit vector in the rival city's ground plane). */
function homeBearing(rival) {
  const dx = PLAYER_NODE.x - rival.def.map.x;
  const dz = PLAYER_NODE.y - rival.def.map.y;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** Old name kept for the callers that cancel aiming (leaving a city, a reset). */
function setAiming(on) {
  if (!on) closeRivalHand();
  updateAimBar();
}

/** Cell under the pointer in the rival city (no CRT warp: the rival scene is drawn straight to the screen). */
function rivalCell() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(pointer, camera);
  if (!intersectGround(raycaster.ray, hit)) return null;
  return worldToHex(hit.x, hit.z);
}

/** Click an already-aimed tile to take that missile back. Aiming is drop-the-card only. */
function takeBackAim() {
  const rival = rivalShown;
  const c = rivalCell();
  if (!rival || !c || view !== 'rival' || rival.alive === false) return;
  const back = unqueueStrike(rival.id, [c[0], c[1]], !rivalHand);
  if (!back) return;
  if (rivalHand) {
    hand.cards.push(pieceOf(back));
    hand.render();
  }
  tick();
  updateAimBar();
  updateHUD();
}

let aimCardSeq = 0;

/** Drag a missile card onto a rival tile: lock the aim (red tiles + path). It fires after End Turn. */
function dropMissileOnRival() {
  const rival = rivalShown;
  const c = rivalCell();
  if (!rival || !c || view !== 'rival' || rival.alive === false) return;
  const piece = aimPiece();
  if (!piece) return;
  const at = [c[0], c[1]];
  if (!rival.grid.has(at[0], at[1])) return toast(L('Aim at one of their tiles', '请瞄准对方的地块'), 'bad');
  const before = queuedStrikes(rival.id).length;
  if (piece.terrain === 'salvo') aimSalvo(rival, at);
  else {
    const size = blastExtra(grid, idleKeySet());
    const taken = new Set();
    for (const s of queuedStrikes(rival.id)) {
      for (const [x, z] of s.cells ?? footprint(s.kind, s.at, s.size, rival.grid)) taken.add(plotKey(x, z));
    }
    const cells = footprint(piece.terrain, at, size, rival.grid, taken);
    queueDrawn(rival.id, at, piece.terrain, size, { cells, card: `card${++aimCardSeq}`, centre: at });
    hand.consume();
  }
  const aimedNow = queuedStrikes(rival.id).length;
  confirm();
  if (aimedNow > before) tutorial.notify('aimed', { salvo: piece.terrain === 'salvo' });
  updateAimBar();
  updateHUD();
}

/**
 * The rival tile the tutorial shows a missile card going to: one a card can be dropped on (in view, not under the hand
 * or a panel) and not aimed at already, preferably one of their buildings (the Capital only failing others), nearest a
 * spot a little above the middle of the screen, so the drag from the hand reads clearly. Null outside a rival city.
 */
const targetV = new THREE.Vector3();
function rivalTarget() {
  const r = rivalShown;
  if (!r || view !== 'rival' || r.alive === false) return null;
  const taken = new Set();
  for (const q of queuedStrikes(r.id)) for (const [x, z] of q.cells ?? [q.at]) taken.add(plotKey(x, z));
  const W = window.innerWidth;
  const H = window.innerHeight;
  let best = null;
  let bestScore = Infinity;
  for (const c of r.grid.cells.values()) {
    if (taken.has(plotKey(c.x, c.z))) continue;
    const w = hexToWorld(c.x, c.z);
    targetV.set(w.x, 0.05, w.z).project(steadyCam);
    const x = (targetV.x * 0.5 + 0.5) * W;
    const y = (-targetV.y * 0.5 + 0.5) * H;
    const reachable = targetV.z < 1 && x > 0 && y > 0 && x < W && y < H && overBoard(x, y);
    // Each rank outweighs any distance on screen: a building in reach always beats the rest.
    const kind = isBuilding(c.terrain) ? (c.terrain === 'capital' ? 2000 : 0) : 4000;
    const score = (reachable ? 0 : 10000) + kind + Math.hypot(x - W / 2, y - H * 0.42);
    if (score < bestScore) {
      bestScore = score;
      best = [c.x, c.z];
    }
  }
  return best;
}

$('btnRivalClear').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (!rivalShown) return;
  const back = queuedStrikes(rivalShown.id).map((q) => q.kind);
  clearQueue(rivalShown.id);
  if (rivalHand) {
    // Back into the hand as cards (clearQueue put them in the silo).
    hand.cards.push(...drawStrikeHand(back.length));
    hand.render();
  }
  updateAimBar();
  updateHUD();
});

// A click on an aimed tile takes that missile back (a drag still turns the camera). Aiming is a card drop.
let aimDown = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  aimDown = view === 'rival' && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!aimDown || e.button !== 0 || Math.hypot(e.clientX - aimDown.x, e.clientY - aimDown.y) > 6) return;
  aimDown = null;
  takeBackAim();
});

function missileAmmoInHand() {
  return hand.cards.filter((p) => isMissileAmmo(p.terrain));
}

/** Play the Salvo card: every missile in hand fans onto tiles around `at`. */
function aimSalvo(rival, at) {
  const ammo = missileAmmoInHand();
  if (!ammo.length) return toast(L('No missiles to fan out', '没有可铺开的导弹'), 'bad');
  const cells = spreadFrom(rival.grid, at, ammo.length);
  if (!cells.length) return toast(L('Aim at one of their tiles', '请瞄准对方的地块'), 'bad');
  const size = blastExtra(grid, idleKeySet());
  const taken = new Set();
  const card = `card${++aimCardSeq}`;
  for (let i = 0; i < cells.length; i++) {
    const blast = footprint(ammo[i].terrain, cells[i], size, rival.grid, taken);
    for (const [x, z] of blast) taken.add(plotKey(x, z));
    queueDrawn(rival.id, cells[i], ammo[i].terrain, size, { cells: blast, card, centre: at });
  }
  const used = new Set(ammo.slice(0, cells.length));
  hand.cards = hand.cards.filter((p) => p.terrain !== 'salvo' && !used.has(p));
  hand.selected = -1;
  hand.render();
}

/** Per frame in a rival city: the hover ring follows the pointer while a missile card is picked. */
function updateAimHover() {
  const piece = aimPiece();
  const c = piece ? rivalCell() : null;
  let next = null;
  if (c && piece.terrain === 'salvo') next = spreadFrom(rivalShown.grid, [c[0], c[1]], missileAmmoInHand().length);
  else if (c) {
    const taken = new Set();
    for (const s of queuedStrikes(rivalShown.id)) {
      for (const [x, z] of s.cells ?? footprint(s.kind, s.at, s.size, rivalShown.grid)) taken.add(plotKey(x, z));
    }
    next = footprint(piece.terrain, [c[0], c[1]], blastExtra(grid, idleKeySet()), rivalShown.grid, taken);
  }
  const at = c ? [c[0], c[1]] : null;
  if (JSON.stringify(next) === JSON.stringify(aimHover) && JSON.stringify(at) === JSON.stringify(aimAt)) return;
  aimHover = next;
  aimAt = at;
  updateAimBar();
}

/** Every city at the start of the attack phase, in war.js's shape. */
function warCities() {
  return [
    { id: 'player', grid, oil: turn.stockpile, hp: turn.capitalHp, alive: turn.capitalHp > 0, buildings: playerBuildingCount(), idle: idleKeySet() },
    ...rivals.filter((r) => r.alive !== false).map((r) => ({ id: r.id, grid: r.grid, oil: r.oil ?? 0, hp: r.capitalHp ?? CAPITAL_HP, alive: true, buildings: r.stats?.buildings ?? 0, idle: idleOf(r) })),
  ];
}

const cityName = (id) => {
  if (id === 'player') return L('Hive City', '蜂巢城');
  const r = rivals.find((x) => x.id === id);
  return r ? L(r.def.name, r.def.zh) : id;
};

/** The results panel: who fired at whom, what got through, what fell. Resolves on Continue. */
function showWarReport(strikes) {
  const groups = new Map();
  for (const s of strikes) {
    const k = `${s.from}>${s.to}`;
    if (!groups.has(k)) groups.set(k, { from: s.from, to: s.to, fired: 0, stopped: 0, hits: 0, lost: [], capital: null, eliminated: false, decoys: 0, drew: 0 });
    const g = groups.get(k);
    if (s.decoy) {
      g.decoys++;
      g.drew += s.drew ?? 0;
      continue;
    }
    g.fired++;
    if (s.hit) g.hits++;
    else if (!s.fizzled) g.stopped++;
    g.lost.push(...s.lost.map((l) => TERRAINS[l.terrain]?.name ?? l.name));
    if (s.capital !== null) g.capital = s.capital;
    if (s.eliminated) g.eliminated = true;
  }
  const rows = [...groups.values()].map((g) => {
    const mine = g.to === 'player';
    const cls = mine ? (g.hits ? 'bad' : 'good') : g.from === 'player' ? (g.hits ? 'good' : 'bad') : '';
    const lost = g.lost.length ? L(` · lost: ${g.lost.join(', ')}`, ` · 损失：${g.lost.join('、')}`) : '';
    const cap = g.capital !== null ? L(` · Capital ${g.capital}/${CAPITAL_HP}`, ` · 首都 ${g.capital}/${CAPITAL_HP}`) : '';
    const fell = g.eliminated ? L(` · <b>${cityName(g.to)} has fallen!</b>`, ` · <b>${cityName(g.to)}已陷落！</b>`) : '';
    const dec = g.decoys ? L(` · ${g.decoys} decoy${g.decoys === 1 ? '' : 's'} drew ${g.drew} kill${g.drew === 1 ? '' : 's'}`, ` · ${g.decoys} 枚诱饵弹吸引了 ${g.drew} 次击落`) : '';
    return `<div class="${cls}">${cityName(g.from)} → ${cityName(g.to)}: ${L(`${g.fired} fired, ${g.stopped} intercepted, ${g.hits} hit`, `发射 ${g.fired}，拦截 ${g.stopped}，命中 ${g.hits}`)}${dec}${cap}${lost}${fell}</div>`;
  });
  const el = $('warReport');
  el.innerHTML = `${rows.join('')}<button class="btn gold" id="btnWarDone">${L('Continue', '继续')}</button>`;
  el.classList.remove('hidden');
  $('btnWarSkip').classList.add('hidden');
  return new Promise((done) =>
    $('btnWarDone').addEventListener('click', () => {
      el.classList.add('hidden');
      done();
    }),
  );
}

$('btnWarSkip').addEventListener('click', (e) => {
  e.currentTarget.blur();
  globe.skipAttack();
});

// ---------- the attack phase, live: each strike lands when its countdown runs out ----------
let landing = []; // strikes still playing in a city view: the phase waits for them
let rivalMissiles = null; // our missiles coming down on a rival city (its own scene), made with the rival view

/** Craters from one strike written onto a rival's grid (applyToRival writes the same again at the end). */
function craterRival(r, rec) {
  if (!rec.hit || !rec.lost.length) return;
  for (const c of rec.lost) r.grid.set(c.x, c.z, { terrain: 'crater' });
  const hitCells = new Set(rec.lost.map((c) => `${c.x},${c.z}`));
  r.pieces = (r.pieces ?? []).filter((p) => !p.cells.some(([x, z]) => hitCells.has(`${x},${z}`)));
  r.version = (r.version ?? 0) + 1;
  if (rivalShown === r) rivalView.refresh();
}

/** Our missile into the rival city on screen: their interceptors' flak meets it (or misses) on the way down. */
function playRivalStrike(r, rec) {
  rivalMissiles ??= new MissileStrike(rivalView.scene, camera, missileCfg);
  const w = hexToWorld(rec.at[0], rec.at[1]);
  // Their networks' fire is the simulated defence (setDefence in frame()); the missile flies the simulated path.
  const target = { x: w.x, z: w.z, ...simFlight(rec) };
  const whoosh = missileWhoosh(target);
  return rivalMissiles.fire([target], {
    onIntercept: () => {
      whoosh?.stop(0.25);
      explode('small');
    },
    onImpact: (t) => {
      whoosh?.stop(0.12);
      explode(t?.harmless ? 'small' : 'large');
      if (view === 'rival') camShake.add(missileCfg.shake * (t?.harmless ? 0.3 : 1));
    },
    onCover: () => craterRival(r, rec),
  });
}

/** The simulated flight of a strike (war.js / interceptSim.js), on the War Map clock. */
let warSims = new Map(); // city id -> simulateDefence() result, for the phase in the air
const warClock = () => globe?.warTime() ?? null;
const simFlight = (rec) => ({
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
  // A decoy: it splits at splitAt and its fakes (already simulated) fly the rest.
  splitAt: rec.decoy ? rec.splitAt : null,
  fakes: rec.decoy
    ? rec.fakes.map((f) => {
        const w = hexToWorld(f.at[0], f.at[1]);
        return { x: w.x, z: w.z, cell: { x: f.at[0], z: f.at[1] }, path: f.path, t0: f.t0, flight: f.flight, accel: f.accel, killAt: f.killed ? f.killAt : null, void: !!f.void, harmless: true, fake: true };
      })
    : null,
});

/** The city on screen shows its networks' simulated fire (turrets turning, the stream, the rounds). */
function syncDefence() {
  const board = attackLive && view === 'board' ? warSims.get('player') : null;
  missiles.setDefence(board ?? null, warClock, (i) => findCiws(grid.get(board.turrets[i].x, board.turrets[i].z)?.mesh), (d) => gunSnd(d));
  if (rivalMissiles) {
    const sim = attackLive && view === 'rival' && rivalShown ? warSims.get(rivalShown.id) : null;
    rivalMissiles.setDefence(sim || null, warClock, (i) => findCiws(rivalShown?.grid.get(sim?.turrets[i].x, sim?.turrets[i].z)?.mesh), (d) => gunSnd(d));
  }
  else if (attackLive && view === 'rival' && rivalShown && warSims.get(rivalShown.id)) rivalMissiles = new MissileStrike(rivalView.scene, camera, missileCfg);
}

/** A flight's countdown ran out: play it in the city on screen, or settle it quietly if that city isn't shown. */
const played = new Set(); // strikes already playing in a city view (started at approach)
/** A flight is a missile's flight time from landing: if its city is on screen, the missile sets off now. */
function approach(rec, flight = missileCfg.followFlight) {
  if (rec.fizzled || played.has(rec)) return;
  if (rec.to === 'player' && view === 'board') {
    played.add(rec);
    landing.push(
      playMissileStrike([{ x: rec.at[0], z: rec.at[1], ...simFlight(rec) }], {
        free: true,
        onCover: (_cell, t) => {
          for (const c of t?.rec?.lost ?? []) craterAt(c.x, c.z);
        },
      }),
    );
    return;
  }
  const r = rivals.find((x) => x.id === rec.to);
  if (r && view === 'rival' && rivalShown === r) {
    played.add(rec);
    landing.push(playRivalStrike(r, rec));
  }
}

/**
 * Just arrived in a city mid attack phase (scrolled in from the planet): any missile already on its final
 * approach to it comes in now, timed to land when its countdown runs out, so it never lands unseen or late.
 */
function joinFlights() {
  if (!attackLive) return;
  for (const f of globe.inFlight()) if (f.approached) approach(f.s, Math.max(0.6, f.eta));
}

function arrive(rec) {
  // A decoy that wasn't watched leaves nothing behind (its fakes are harmless).
  if (rec.fizzled || played.has(rec) || rec.decoy) return;
  if (rec.to === 'player') {
    if (view === 'board') {
      landing.push(
        playMissileStrike([{ x: rec.at[0], z: rec.at[1], ...simFlight(rec) }], {
          free: true,
          onCover: (_cell, t) => {
            for (const c of t?.rec?.lost ?? []) craterAt(c.x, c.z);
          },
        }),
      );
    } else {
      for (const c of rec.lost) craterAt(c.x, c.z);
      toast(
        rec.hit
          ? L(`Hive City hit${rec.lost.length ? `: lost ${listLost(rec.lost.map((c) => TERRAINS[c.terrain]?.name ?? c.name))}` : ''}`, `蜂巢城被击中${rec.lost.length ? `：损失${listLost(rec.lost.map((c) => TERRAINS[c.terrain]?.name ?? c.name))}` : ''}`)
          : L('A missile on Hive City was intercepted', '一枚射向蜂巢城的导弹被拦截'),
        rec.hit ? 'bad' : '',
      );
    }
    return;
  }
  const r = rivals.find((x) => x.id === rec.to);
  if (!r) return;
  if (view === 'rival' && rivalShown === r) landing.push(playRivalStrike(r, rec));
  else craterRival(r, rec);
}

/** The phase in one line (instead of the old report popup). */
function toastWarSummary(all) {
  const res = all.filter((s) => !s.decoy);
  const mine = res.filter((s) => s.from === 'player');
  const at = res.filter((s) => s.to === 'player' && !s.fizzled);
  const parts = [];
  const myDecoys = all.filter((s) => s.decoy && s.from === 'player');
  if (myDecoys.length) {
    const drew = myDecoys.reduce((n, s) => n + (s.drew ?? 0), 0);
    parts.push(L(`Decoys drew ${drew} kill${drew === 1 ? '' : 's'}`, `诱饵弹吸引了 ${drew} 次击落`));
  }
  if (mine.length) parts.push(L(`Your missiles: ${mine.filter((s) => s.hit).length}/${mine.length} hit`, `你的导弹：命中 ${mine.filter((s) => s.hit).length}/${mine.length}`));
  if (at.length) parts.push(L(`Incoming: ${at.filter((s) => s.hit).length}/${at.length} got through`, `来袭：${at.filter((s) => s.hit).length}/${at.length} 命中`));
  const fell = res.filter((s) => s.eliminated && s.to !== 'player').map((s) => cityName(s.to));
  if (fell.length) parts.push(L(`${fell.join(', ')} fell`, `${fell.join('、')}陷落`));
  if (parts.length) toast(parts.join(' · '));
}

/** The countdown: when the missiles in the air reach the city in view, and every other target. */
const warTimer = $('warTimer');
function updateWarTimer() {
  const flights = globe?.arrivals() ?? [];
  if (!flights.length) {
    warTimer.classList.add('hidden');
    return;
  }
  const here = view === 'rival' ? rivalShown?.id : view === 'board' ? 'player' : null;
  const by = new Map();
  for (const f of flights) {
    const g = by.get(f.to) ?? { n: 0, eta: Infinity, mine: 0 };
    g.n++;
    g.eta = Math.min(g.eta, f.eta);
    if (f.from === 'player') g.mine++;
    by.set(f.to, g);
  }
  const fmt = (t) => `${t.toFixed(1)}s`;
  const tone = (to, g) => (to === 'player' ? 'bad' : g.mine ? 'good' : '');
  const sorted = [...by].sort((a, b) => a[1].eta - b[1].eta);
  // The headline: what lands on the city in view, or else whatever lands next (in its colour, like the list below).
  const head = here ? (by.has(here) ? here : sorted[0][0]) : null;
  const lines = [];
  if (head) {
    const g = by.get(head);
    const text = L(`${g.n} missile${g.n === 1 ? '' : 's'} arriving at ${cityName(head)} in ${fmt(g.eta)}`, `${g.n} 枚导弹将在 ${fmt(g.eta)} 后抵达${cityName(head)}`);
    lines.push(`<b class="${head === here ? '' : tone(head, g)}">${text}</b>`);
  } else lines.push(`<b>${L(`Missiles in the air: ${flights.length}`, `空中导弹：${flights.length}`)}</b>`);
  for (const [to, g] of sorted) {
    if (to === head) continue;
    lines.push(`<span class="${tone(to, g)}">${cityName(to)}: ${g.n} · ${fmt(g.eta)}</span>`);
  }
  warTimer.innerHTML = lines.join('');
  warTimer.classList.remove('hidden');
}

/**
 * After the season is scored: the player's aimed strikes and the rivals' choices fly together on the War Map,
 * then the player's board takes its hits. Resolves true if the run ended (Capital lost, or every rival gone).
 */
async function runAttackPhase() {
  const run = runId;
  const cities = warCities();
  globe.setQueued([]); // the aimed arcs become real flights now
  const mine = takeQueue()
    .filter((q) => rivals.find((r) => r.id === q.to)?.alive !== false)
    .map((q) => ({ from: 'player', to: q.to, at: q.at, kind: q.kind, size: q.size, cells: q.cells }));
  const theirs = rivals.filter((r) => r.alive !== false).flatMap((r) => chooseStrikes(r, cities, { round: turn.round, chance: INTERCEPT.chance, playerArmed: [...MILITARY].some((k) => turn.unlocked.has(k)) }));
  const strikes = [...mine, ...theirs];
  if (!strikes.length) return false;
  setAiming(false);
  const { strikes: res, results, sims } = resolveWar(strikes, cities, Math.random);
  warSims = sims;

  // Every city's missiles leave at once. You stay where you are (no camera takeover): the countdown shows when
  // each lands, and a strike plays in whichever city you're looking at when its countdown runs out (arrive()).
  eventOpen = true; // no card play while they're in the air; looking around is still allowed (attackLive)
  attackLive = true;
  hand.select(-1);
  landing = [];
  played.clear();
  warTimer.classList.remove('hidden');
  // The air-raid siren follows missiles aimed at Hive City, from launch until the last one is down.
  if (res.some((s) => s.to === 'player' && !s.fizzled)) snd(() => combatAudio.sirenOn(), buzz);
  const phase = globe.playAttack(res, rivals);
  // Everyone fires at once: on Hive City your magazines open and the salvo climbs away as the countdown starts.
  // The first strike while the military lesson is open: launched from home, it waits in the air for you to follow it.
  const follow = view === 'board' && mine.length > 0 && readySilos().length > 0 && tutorial.lessons.open('war');
  if (view === 'board' && mine.length) launchSalvo(res.filter((s) => s.from === 'player'));
  if (follow) holdForFollow(run, mine[0].to);
  // The first time missiles fly each way, the Field Report briefs you with everything frozen in the air.
  const briefed = await briefAttack(mine, theirs);
  if (run !== runId) {
    combatAudio.endAttack();
    return true;
  }
  if (!briefed.incoming) announceIncoming(theirs);
  await phase;
  await Promise.all(landing);
  combatAudio.endAttack();
  attackLive = false;
  warTimer.classList.add('hidden');
  if (run !== runId) return true;

  // The real state, now every strike has landed.
  for (const r of rivals) {
    applyToRival(r, results.get(r.id));
    noteAttacks(r, res);
    r.stats = rivalStats(r.grid, r);
    if (rivalShown === r) {
      rivalView.refresh();
      fillRivalBar(r);
    }
  }
  const me = results.get('player');
  turn.stockpile = Math.max(0, turn.stockpile - (me?.oilSpent ?? 0));
  turn.capitalHp = Math.max(0, turn.capitalHp - (me?.hpLost ?? 0));
  globe.renderLabels();
  eventOpen = false;
  updateHUD();
  toastWarSummary(res);
  tutorial.notify('attackDone', { mine: mine.length });

  if (turn.capitalHp <= 0) {
    gameOver(() => L('Rival missiles have levelled your Capital. Hive City has fallen.', '敌方导弹夷平了你的首都。蜂巢城已陷落。'));
    return true;
  }
  if (rivals.every((r) => r.alive === false)) {
    victory();
    return true;
  }
  return false;
}

/**
 * The first strike, followed (the military lesson): launched from Hive City, the flight is held on the War Map while
 * the Magazine fires, then let go until it's about mid-way, and held there until you've followed it into the city
 * it's aimed at, where it comes down. So both ends are seen: the launch, and the impact. It lets go anyway after a
 * while (or if the run is reset), so nothing waits forever.
 */
let following = null; // { to } while a flight waits for you
const FOLLOW_ETA = 3.4; // seconds left when it's held (more than the 2.2 s the incoming flight takes)
const FOLLOW_SPEED = 0.3; // its pace on the War Map while you follow it (3.4 s of flight: about 11 s to dive in)
async function holdForFollow(run, to) {
  const hold = (on) => run === runId && globe.pauseAttack(on);
  const mineInAir = () => globe.inFlight().find((f) => f.s.from === 'player' && f.s.to === to);
  // The Magazine opens and the missile climbs away: nothing moves on the War Map meanwhile.
  const t0 = performance.now();
  while (run === runId && performance.now() - t0 < (SILO_CUT / SILO_SPEED + 1.4) * 1000) {
    hold(true);
    await wait(0.1);
  }
  if (run !== runId) return;
  // On to about mid-way...
  hold(false);
  for (let i = 0; i < 300 && run === runId; i++) {
    const f = mineInAir();
    if (!f || f.eta <= FOLLOW_ETA) break;
    await wait(0.05);
  }
  if (run !== runId || !mineInAir()) return;
  // ...and held there until you're in that city (a dialogue unpausing it doesn't count: re-held every tick).
  // Held while you're still home; once you're out on the War Map it flies on, slowly, so you can watch it and dive
  // into its city in time; there (or if you never come) it's back to full speed.
  following = { to };
  // (Wall time: the wait is for the player, not for the frames. Arriving there ends it; skipping the lesson too.)
  const t1 = performance.now();
  while (run === runId && following && mineInAir()) {
    const there = view === 'rival' && rivalShown?.id === to && !switching;
    if (there || performance.now() - t1 > 90000) break;
    hold(view === 'board');
    if (view !== 'board') globe.setAttackSpeed(FOLLOW_SPEED);
    await wait(0.1);
  }
  following = null;
  hold(false);
  if (run === runId) globe.setAttackSpeed(1);
}

/** Incoming! A banner naming who is firing at Hive City, before the missiles fly. */
async function briefAttack(mine, theirs) {
  const at = theirs.filter((x) => x.to === 'player');
  // The military lesson is still being taught: it shows the launch itself (countdown, flight, impact), so no briefing
  // on top of it. (Those who know it get the Field Report once, as before.)
  if (mine.length && !turn.seenLaunch && tutorial.lessons.open('war')) turn.seenLaunch = true;
  const launch = mine.length > 0 && !turn.seenLaunch;
  const incoming = at.length > 0 && !turn.seenIncoming;
  if (!launch && !incoming) return { launch, incoming };
  const run = runId;
  const etaTo = (pred) => Math.ceil(Math.min(...globe.arrivals().filter(pred).map((f) => f.eta), 99));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  globe.pauseAttack(true);
  const lines = [];
  if (launch) {
    turn.seenLaunch = true;
    const targets = [...new Set(mine.map((s) => s.to))].map(cityName).join(L(', ', '、'));
    const eta = etaTo((f) => f.from === 'player');
    lines.push(
      () => L(`That's it, Overseer, they're away. ${plural(mine.length, 'warhead')}, heading for ${targets}.`, `发射了，总督，它们已经出发。${mine.length} 枚弹头，正飞向${targets}。`),
      () => L(`About ${eta} seconds until they land. Their Intercept Networks will try to shoot some down, so don't count on every one.`, `大约 ${eta} 秒后落地。对方的拦截网会设法击落一部分，所以别指望每一枚都能命中。`),
    );
    // Only worth saying when you aren't watching one of their cities already.
    if (view !== 'rival')
      lines.push(() => L("If you'd like to watch, zoom out to the War Map and dive into their city. I'll keep the coffee warm.", '想亲眼看的话，就缩放到战争地图，再进入对方城市。咖啡我给您热着。'));
  }
  if (incoming) {
    turn.seenIncoming = true;
    const from = [...new Set(at.map((x) => x.from))].map(cityName).join(L(', ', '、'));
    const eta = etaTo((f) => f.to === 'player');
    const nets = [...grid.cells.values()].some((c) => c.terrain === 'intercept');
    lines.push(
      () => L(`Overseer! Radar's just lit up. ${from} has fired ${plural(at.length, 'missile')} at us.`, `总督！雷达刚刚亮了。${from}朝我们发射了 ${at.length} 枚导弹。`),
      () => L(`The first one lands in about ${eta} seconds. I've put the countdown at the top of your screen.`, `第一枚大约 ${eta} 秒后落地。我已经把倒计时放在您屏幕顶部了。`),
      nets
        ? () => L('Our Intercept Networks are tracking them. The gun crews will bring down what they can.', '我们的拦截网正在追踪它们。炮手们会尽量把它们打下来。')
        : () => L("We've no Intercept Networks, Overseer. I'm sorry. Everything they fired is going to land.", '我们没有拦截网，总督。很抱歉。他们打来的每一枚都会落地。'),
      () => L("You can stay and watch them come in, or step back to the War Map. Your call. I'll be right here.", '您可以留下来看着它们落下，也可以退回战争地图。由您决定。我就在这儿。'),
    );
  }
  dialogue.open({ kind: 'pressure', kindLabel: () => L('Field Report', '前线报告'), title: () => (incoming ? L('Incoming missiles', '导弹来袭') : L('First strike', '首次打击')) });
  for (const line of lines) {
    await dialogue.say('Field Report', line);
    if (run !== runId) return { launch, incoming };
  }
  await dialogue.leave();
  globe.pauseAttack(false);
  return { launch, incoming };
}

async function announceIncoming(strikes) {
  const at = strikes.filter((x) => x.to === 'player');
  if (!at.length) return;
  const from = [...new Set(at.map((x) => x.from))].map(cityName).join(L(', ', '、'));
  // A toast, not a banner: nothing stops you looking around while they fly.
  toast(L(`Incoming! ${from} launched ${at.length} missile${at.length === 1 ? '' : 's'} at Hive City`, `导弹来袭！${from}向蜂巢城发射了 ${at.length} 枚导弹`), 'bad', 2600);
}

/** Every rival city has fallen and the tribute still flows: the run is won. */
function victory() {
  gameOver(() =>
    L(
      `Every rival city-state lies in ruins. The Overlord's oil flows from Hive City alone. Victory in year ${turn.round}.`,
      `所有敌对城邦皆成废墟。霸主的石油只从蜂巢城流出。第 ${turn.round} 年获胜。`,
    ),
  );
  $('gameoverTitle').textContent = L('Victory', '胜利');
}

/**
 * A season has passed: each rival plays its next hand (rivalAI.js), one rival per task so the season change
 * doesn't stall a frame. A reset in the middle drops the rest (the rivals array is replaced).
 */
function growRivals() {
  const list = rivals;
  const at = { round: turn.round, season: turn.season, playerMissiles: missileCount() };
  list.forEach((rival, i) =>
    setTimeout(() => {
      if (list !== rivals) return;
      advanceRivals([rival], { ...at, yearLength: yearLength() }, list);
      if (rivalShown === rival) {
        rivalView.refresh();
        fillRivalBar(rival);
      }
    }, 30 * (i + 1)),
  );
}

function fillRivalBar(rival) {
  rivalShown = rival;
  updateAimBar();
  $('rivalTitle').textContent = `${L(rival.def.name, rival.def.zh)} · ${L(rival.def.personalityName, rival.def.personalityZh)}`;
  $('rivalStats').textContent = L(
    `${rival.alive === false ? 'DESTROYED · ' : ''}Capital ${rival.capitalHp ?? CAPITAL_HP}/${CAPITAL_HP} · ${rival.stats.buildings} buildings · ${rival.stats.oil} oil · ${rival.stats.missiles} missiles · ${rival.stats.interceptors} interceptors`,
    `${rival.alive === false ? '已摧毁 · ' : ''}首都 ${rival.capitalHp ?? CAPITAL_HP}/${CAPITAL_HP} · ${rival.stats.buildings} 座建筑 · ${rival.stats.oil} 石油 · ${rival.stats.missiles} 枚导弹 · ${rival.stats.interceptors} 座拦截网`,
  );
}

/** Back to the board from either the globe or a rival city. Safe during a reset. */
function resetView() {
  if (view === 'rival') {
    closeRivalHand();
    rivalView.exit();
  }
  if (view !== 'board') setBoardFraming(true);
  globe?.exit();
  view = 'board';
  rivalShown = null;
  rig.locked = false;
  rig.resetOverscroll();
  viewRun++; // drops a fade that is still running
  switching = false;
  clouds.reset();
  document.body.classList.remove('globe-view', 'rival-view');
  setMusicMuffled(false);
}

// ---------- view switches (board ⇄ globe ⇄ rival city) ----------
// Scroll out past max zoom on the board or in a rival city to see the hex planet; click a city on it to fly in.
const clouds = createCloudTransition($('viewClouds'));
let switching = false;
let viewRun = 0;
let boardReturnDistance = null;

const fade = (on) => (on ? clouds.cover() : clouds.uncover());

/** Clouds roll in, the view swaps behind them, they part. A reset in the middle wins. */
async function swapView(change) {
  if (switching) return;
  switching = true;
  const run = viewRun;
  await fade(true);
  if (run !== viewRun) return;
  change();
  await fade(false);
  if (run === viewRun) switching = false;
}

function openGlobe() {
  if (switching || view === 'globe') return;
  if (view === 'board') {
    if (mapBlocked()) return;
    boardReturnDistance = rig.goalDistance;
    hand.select(-1);
  }
  const from = view === 'rival' ? rivalShown?.id : 'player';
  rig.locked = true;
  zoomWhoosh(false);
  setMusicMuffled(true);
  swapView(() => {
    if (view === 'rival') {
      setAiming(false);
      rivalView.exit();
      rivalShown = null;
      document.body.classList.remove('rival-view');
    }
    setBoardFraming(false);
    view = 'globe';
    tutorial.notify('globe');
    document.body.classList.add('globe-view');
    globe.enter(rivals, from);
    globe.setQueued(queuedStrikes().map((s) => ({ from: 'player', to: s.to })));
  });
}

/** Globe → board, after the fly-in onto Hive City. The board camera comes back pulled out, then settles in. */
function closeGlobe() {
  if (view !== 'globe' || switching) return Promise.resolve();
  zoomWhoosh(true);
  setMusicMuffled(false);
  return swapView(() => {
    globe.exit();
    document.body.classList.remove('globe-view');
    setBoardFraming(true);
    view = 'board';
    rig.release();
    rig.distance = rig.maxDistance;
    rig.resetOverscroll();
    rig.goalDistance = Math.min(boardReturnDistance ?? rig.maxDistance, rig.maxDistance * 0.5);
    joinFlights();
  });
}

function enterRival(id) {
  const rival = rivals.find((entry) => entry.id === id);
  if (!rival || view !== 'globe' || switching) return;
  zoomWhoosh(true);
  setMusicMuffled(false);
  swapView(() => {
    globe.exit();
    document.body.classList.remove('globe-view');
    document.body.classList.add('rival-view');
    setBoardFraming(false);
    rivalView.enter(rival);
    openRivalHand(rival);
    // Arrive pulled out a little, then settle on the city.
    const settle = rig.goalDistance;
    rig.distance = rig.maxDistance;
    rig.goalDistance = settle;
    fillRivalBar(rival);
    view = 'rival';
    rig.release();
    rig.resetOverscroll();
    joinFlights();
  });
}

function leaveRival() {
  if (view === 'rival') openGlobe();
}

/** Rival city or War Map → Hive City. */
function returnToHive() {
  if (view === 'globe') return closeGlobe();
  if (view !== 'rival' || switching) return Promise.resolve();
  return swapView(() => {
    setAiming(false);
    rivalView.exit();
    rivalShown = null;
    document.body.classList.remove('rival-view');
    setBoardFraming(true);
    view = 'board';
    rig.release();
    rig.distance = rig.maxDistance;
    rig.resetOverscroll();
    rig.goalDistance = Math.min(boardReturnDistance ?? rig.maxDistance, rig.maxDistance * 0.5);
    joinFlights();
  });
}

/** From the globe, the Esc / G way home: fly onto Hive City first. */
function globeHome() {
  if (view === 'globe' && !switching && !globe.flying) globe.visit('player'); // also mid attack phase
}

globe = createGlobeView({
  renderer,
  root: $('globeUI'),
  painted: true, // painted like the main screen's planet, hex lines on it (sandPlanet.js createPaintedGlobe)
  factory,
  playerBuildings: playerBuildingCount,
  playerHp: () => turn.capitalHp,
  onVisit: (id) => (id === 'player' ? closeGlobe() : enterRival(id)),
  onDive: (k) => {
    if (!switching) clouds.setPeek(k);
  },
  freeDuringWar: true, // look around (board, planet, rival cities) while the missiles are in the air
  onArrive: (s) => arrive(s),
  onApproach: (s) => approach(s),
  approachLead: () => missileCfg.followFlight,
});
// ---------- main screen ----------
// Its own planet, apart from the War Map's: its own scene, camera and look (no hex grid, finer sand), so nothing
// done here reaches the in-game planet. Its labels live in a detached element (the main screen shows none).
const titleGlobeUI = document.createElement('div');
titleGlobeUI.innerHTML = '<div class="globe-title"></div><div id="globeLabels"></div><div id="globeCard" class="hidden"></div>';
const titleGlobe = createGlobeView({
  renderer,
  root: titleGlobeUI,
  factory,
  playerBuildings: () => 0,
  playerHp: () => 5,
  onVisit: () => {},
});
// Its planet is painted, not the hex world (sandPlanet.js); the star, nebula and moon stay from the War Map scene.
titleGlobe.setLook({ hidePlanet: true });
const titlePlanet = createSandPlanet(GLOBE_RADIUS);
titleGlobe.scene.add(titlePlanet.group);
const titleScreen = createTitleScreen({
  root: $('title'),
  scene: titleGlobe.scene,
  camera: titleGlobe.camera,
  getModel: () => factory.models?.get('mothership'),
  onStart: startFromTitle,
  onOptions: () => debug.toggle(), // every Game Debug option, for now
});

/** The main screen: the planet from mid distance, the menu over it. */
function showTitle() {
  view = 'title';
  setBoardFraming(false);
  titleGlobe.enter([], 'player'); // pulls back from just above the planet to its usual distance
  titleScreen.show();
}

/** Start: a new game from the very beginning, the full tutorial included. */
function startFromTitle() {
  if (switching) return;
  swapView(() => {
    titleScreen.hide();
    titleGlobe.exit();
    localStorage.removeItem(TUTORIAL_KEY);
    resetIsland({ tutorial: true }); // back on the board (resetView), lessons start over
  });
}

rig.onZoomPastMax = () => {
  if (view === 'board' || view === 'rival') openGlobe();
  if (!switching) rig.resetOverscroll(); // refused (another screen is up)
};
$('btnRivalBack').addEventListener('click', (e) => {
  e.currentTarget.blur();
  leaveRival();
});

/**
 * Dev-testing hotkeys (Space, `, N, M, P, V, T, X). Off for players; set true to use them again.
 * `-` still opens the performance overlay in dev builds. The Game Debug panel still has the same tools.
 */
const DEV_HOTKEYS = false && !RELEASE; // never in the release build

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
  if (view === 'title') return; // the main screen: only its menu
  if (k === 'g' && !e.repeat) {
    if (view === 'globe') globeHome();
    else openGlobe();
    return;
  }
  if (!RELEASE && k === '-' && !e.repeat) {
    perf.setOpen(!perf.enabled); // performance overlay
    return;
  }
  if (k === 'escape' && view === 'rival') {
    leaveRival();
    return;
  }
  if (k === 'escape' && view === 'globe') {
    globeHome();
    return;
  }
  if (view !== 'board') {
    if (k === 'enter') endTurn(); // end the turn / skip the payout from the War Map too
    return;
  }
  if (dev && k === '`') {
    debug.toggle();
    return;
  }
  if (striking) return; // the missile strike cinematic owns the screen
  if (strikeOpen) {
    if (k === 'escape' || k === 'l') closeStrikeScreen();
    else if (k >= '1' && k <= '9' && Number(k) <= hand.cards.length) {
      const i = Number(k) - 1;
      hand.select(hand.selected === i ? -1 : i);
    }
    return;
  }
  if (payout.active) {
    if (k === 'enter') endTurn();
    return; // no placing / rotating / nuking mid-payout
  }
  // The guided Spring stays on track: the debug shortcuts are off.
  if (tutorial.active && 'nmpvtx'.includes(k) && k.length === 1) return tutorial.rejected({ code: 'early' });
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
  else if (!RELEASE && k === 'j' && !e.repeat) {
    if (tutorial.active) return tutorial.rejected({ code: 'early' });
    const msg = debugMissileSettle();
    toast(msg, msg.includes('Finish') || msg.includes('请先') ? 'bad' : 'good');
  }
  else if (k === 'enter') endTurn();
});

$('btnReroll').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (hand.isEmpty || payout.active || turn.over || shopOpen || eventOpen || strikeOpen) return;
  if (!tutorial.allows('reroll')) return tutorial.rejected({ code: 'early' }); // the guided opening plays its hand
  if (turn.freeRerolls > 0) {
    // Target reward: free, and doesn't raise the price of the next paid reroll.
    turn.freeRerolls--;
    shuffle();
    hand.reroll();
    tutorial.notify('rerolled');
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
  tutorial.notify('rerolled');
  updateHUD();
  toast(L(`Hand rerolled: -${cost} oil (next reroll costs ${rerollCost()})`, `已重抽手牌：-${cost} 石油（下次重抽花费 ${rerollCost()}）`));
});
$('btnHive').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (view === 'rival') returnToHive();
  else closeGlobe();
});
$('btnNext').addEventListener('click', (e) => {
  e.currentTarget.blur(); // so Space doesn't re-click it
  endTurn();
});

// ---------- what a card would do, before it's placed (a forecast: nothing is earned or spent) ----------
/**
 * While a card is held over a cell it can go on: the economy with it in place, shown as hollow tokens over the cell
 * (tutorial.js), ghost slots in the worker rack and the new food / oil figures beside the HUD's. Same calculation as
 * the season itself (computeEconomyIf), so the forecast is what the season will pay.
 */
function updateForecast(cell) {
  const piece = hand.piece;
  const ok = Boolean(piece && cell && view === 'board' && placement.result?.ok && !ACTIONS[piece.terrain] && !piece.terrain.startsWith('wasteland'));
  const key = ok ? `${piece.id}:${piece.rot}:${cell}:${grid.size}:${turn.season}:${turn.food}` : '';
  if (key === forecastKey) return;
  forecastKey = key;
  if (!ok) {
    tutorial.forecast(null);
    renderForecastHUD(null);
    return;
  }
  const cells = placement.cellsAt(cell);
  const before = economyNow();
  const after = economyIf(piece.terrain, cells);
  tutorial.forecast(cells, piece.terrain, before, after);
  renderForecastHUD(before, after);
}

function renderForecastHUD(before, after = null) {
  const sign = (n) => `${n > 0 ? '+' : ''}${Math.round(n)}`;
  const food = after && Math.round(after.foodBalance) !== Math.round(before.foodBalance);
  $('resFoodF').textContent = food ? `→ ${sign(after.foodBalance)}` : '';
  $('resFoodF').classList.toggle('neg', Boolean(food && Math.round(after.foodBalance) < 0));
  const oil = after && after.oil !== before.oil;
  $('resOilF').textContent = oil ? `→ (+${after.oil})` : '';
  renderRack(before ?? economyNow(), after);
}

/**
 * The worker rack under Manpower: a slot per worker the city can staff. Filled = in use, hollow = free, dashed red =
 * a building with no one to run it. With a forecast (`f`): the slots it adds, takes or fills show as ghosts.
 */
function renderRack(e, f = null) {
  const el = $('mpRack');
  if (!el) return;
  const src = f ?? e;
  const slots = [];
  const n = Math.max(src.cap, e.cap);
  for (let i = 0; i < n; i++) {
    const exists = i < src.cap;
    const on = exists && i < src.used;
    let cls = on ? 'on' : 'free';
    if (f) {
      if (!exists) cls = 'lost ghost';
      else if (i >= e.cap || (on && i >= e.used)) cls += ' ghost';
    }
    slots.push(cls);
  }
  const missing = Math.max(0, src.needed - src.used);
  const nowMissing = Math.max(0, e.needed - e.used);
  for (let i = 0; i < missing; i++) slots.push(`missing${f && i >= nowMissing ? ' ghost' : ''}`);
  const shown = slots.slice(0, 40);
  const html = shown.map((c) => `<i class="${c}"></i>`).join('');
  if (el._html !== html) {
    el.innerHTML = el._html = html;
    el.classList.toggle('dense', shown.length > 18);
  }
}

/** The Black Market walkthrough: card i's price coming off the oil you have, as a ghost (null: none). */
function ghostPrice(i) {
  let g = $('bmGhost');
  const item = i === null || i === undefined || !bmCategory ? null : bmStock[bmCategory]?.[i];
  if (!item) {
    g?.remove();
    return;
  }
  if (!g) {
    g = document.createElement('div');
    g.id = 'bmGhost';
    g.className = 'coach-ghost-price';
    $('bmOil').insertAdjacentElement('afterend', g);
  }
  const html = `<b>−${item[1]}</b>${ICONS.oil}<span>→ ${Math.max(0, turn.stockpile - item[1])}</span>`;
  if (g._html !== html) g.innerHTML = g._html = html;
}

/** The rotate button over the board: there while a piece of 2+ cells is held (touch has no R key). */
function updateRotateButton() {
  const p = hand.piece;
  const multi = Boolean(p && (ACTIONS[p.terrain] ? ACTIONS[p.terrain].size : pieceOffsets(p).length > 1)); // (the Wrecking Crew's area turns too)
  $('btnRotate').classList.toggle('hidden', !multi || view !== 'board');
}

/** Back to Hive City: the button shows once the camera has wandered off the city. */
let recenterCheck = 0;
function updateRecenter(dt) {
  recenterCheck -= dt;
  if (recenterCheck > 0) return;
  recenterCheck = 0.4;
  const [cx, cz] = grid.expansionMode ? grid.territoryCenter() : grid.centroid();
  const reach = 5 + Math.sqrt(grid.size) * 0.9;
  const far = Math.hypot(rig.target.x - cx, rig.target.z - cz) > reach;
  $('btnRecenter').classList.toggle('hidden', view !== 'board' || !far || hand.dragging);
}

$('btnWarMap').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (!tutorial.allows('globe')) return tutorial.rejected({ code: 'early' });
  openGlobe();
});
$('btnRotate').addEventListener('click', (e) => {
  e.currentTarget.blur();
  hand.rotate(1);
});
$('btnRecenter').addEventListener('click', (e) => {
  e.currentTarget.blur();
  rig.focus(...(grid.expansionMode ? grid.territoryCenter() : grid.centroid()));
});
// The Controls panel's "show me again": a demonstration on the city as it is (nothing changes).
for (const b of document.querySelectorAll('[data-demo]')) {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    setHelp(false);
    tutorial.demo(b.dataset.demo);
  });
}

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
// Bottom left: restart the game into the tutorial.
$('btnReplayTutorial').addEventListener('click', (e) => {
  e.currentTarget.blur();
  setHelp(false);
  resetIsland({ tutorial: true });
});

// ---------- lifecycle ----------
/**
 * A new run. opts.tutorial: guide the first Spring (the tutorial; also on a first visit). opts.intro = false: skip
 * the Year 1 opening scene. (Also used directly as a click handler, so opts may be an Event: only these exact flags count.)
 */
function resetIsland(opts) {
  const tut = opts?.tutorial === true || !tutorialDone();
  resetView();
  rivals = createRivals((Math.random() * 0x100000000) >>> 0);
  runId++; // stops a missile strike / failure speech still running
  combatAudio.endAttack(); // a reset must not leave the siren wailing
  introRun++; // and an opening scene
  tutorial.stop();
  grid.expansionMode = localStorage.getItem(MODE_KEY) === 'expansion';
  missiles.clear();
  striking = false;
  rig.release();
  document.body.classList.remove('striking');
  payout.cancel(); // stop a running payout without settling it
  oilFlights.clear();
  previewing = false;
  document.body.classList.remove('paying');
  tiles.clear();
  grid.clear();
  traffic.clear();
  neonTiles.clear();
  anims.length = 0;
  dust.clear();
  shake.amount = 0;
  camShake.reset();
  expansion.clear();
  fog.reset(grid);
  piecesPlaced = 0;
  if (strikeOpen) closeStrikeScreen();
  resetMissiles(); // and any aimed strikes
  tributeHeld = null;
  following = null;
  warPending = false;
  setTurnRunning(false);
  settledSeason = null;
  attackLive = false;
  landing = [];
  for (const h of factoryHops) {
    h.mesh.scale.set(1, 1, 1);
    h.mesh.position.y = 0;
    h.done();
  }
  factoryHops.length = 0;
  factoryJobs.length = 0;
  factoryPaid.length = 0;
  labsPaid.length = 0;
  for (const f of factoryFloaters) f.el.remove();
  factoryFloaters.length = 0;
  setAiming(false);
  $('warUI').classList.add('hidden');
  $('warReport').classList.add('hidden');
  $('warAlert').classList.add('hidden');
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
    capitalHp: CAPITAL_HP,
    over: false,
    strikes: 0,
    unlocked: new Set(),
    seenRebels: false, // first-contact scenes, once per run
    seenBandits: false,
    seenMilFactory: false,
    seenLaunch: false, // first-strike Field Report briefings, once per run
    seenIncoming: false,
    pinned: [],
    coins: 0,
    shopMult: 1,
    bmCooldown: 0,
    bmMet: false,
    guided: tut && !ALL_TILES, // a tutorial run: its opening is authored, and a few lessons get their cards dealt
    gifted: false, // (tutorial run) the free missile for the military lesson
    ...freshTargetState(),
  });
  shopOpen = false;
  bmRevealed = false;
  $('btnBlackMarket').classList.add('unseen');
  $('btnBlackMarket').classList.remove('arriving');
  closeBlackMarket(false);
  eventOpen = false;
  pendingScenes.length = 0;
  closeCardPick(false);
  dialogue.close();
  $('shop').classList.add('hidden');
  document.body.classList.remove('shopping');
  $('gameover').classList.add('hidden');
  $('report').textContent = L('No seasons played yet.', '尚未度过任何季节。');
  addTile(0, 0, SEED_TERRAIN, 0, true); // the game opens with the Capital already standing
  mysteries.reset();
  // The guided opening's first discovery: one "?" site three steps out, always a Water Pump (and none nearer).
  if (turn.guided && !grid.expansionMode) mysteries.plant(...OPENING.site.at, OPENING.site.terrain);
  frontier.rebuild(grid);
  if (ALL_TILES) {
    for (const [k] of SHOP_ITEMS) turn.unlocked.add(k);
    turn.freeRerolls = 20;
    turn.stockpile = Math.max(turn.stockpile, 30);
    hand.deal(HAND_SIZE);
  } else if (turn.guided) {
    // The guided opening's hand, in order: a Farm, an Oil Station and two Wasteland pieces (no Settlement yet:
    // the Capital's workers are enough for now; housing comes when they run out).
    hand.replaceHand(OPENING.hand);
  } else {
    // Opening hand: always one of each basic building plus two Wasteland, in random order.
    hand.deal(HAND_SIZE, OPENING_HAND);
    hand.cards.sort(() => Math.random() - 0.5);
  }
  hand.render();
  rig.focus(0, 0);
  rig.distance = rig.goalDistance = homeDistance(); // the city fits the board area, whatever the screen
  updateHUD();
  if (ALL_TILES) {
    skipTutorial();
    tutorial.begin();
  } else if (turn.guided) {
    // The commission (wordless, a few seconds) replaces the spoken opening; the first card is usable at once.
    tutorial.start();
    tutorial.begin();
  } else if (opts?.intro !== false) playIntro();
  if (ALL_TILES || (!tut && knewMarket())) revealBlackMarket(false);
}

/** Skip tutorial: the guiding stops and Spring carries on as a normal season. */
function skipTutorial() {
  markTutorialDone();
  tutorial.stop();
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
  // A first game: the tutorial shows the tribute (wordless) and guides the Spring instead of this toast.
  if (tutorial.active) tutorial.begin();
  else toast(L(`First tribute: ${turn.quota} barrels, due after Winter`, `首次贡品：${turn.quota} 桶，冬季结束后上缴`), 'bad', 3200);
}

/**
 * The placement ghost, on top of everything (the fog of war included): its own pass over the finished frame,
 * with the depth cleared so only the ghost's own parts hide each other. Same lights; shadows reuse this frame's map.
 */
function renderGhost() {
  if (!placement.blocks.visible && !placement.feet.visible) return;
  const bg = scene.background;
  const autoClear = renderer.autoClear;
  const shadows = renderer.shadowMap.autoUpdate;
  scene.background = null;
  renderer.autoClear = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.clearDepth();
  camera.layers.set(GHOST_LAYER);
  renderer.render(scene, camera);
  camera.layers.set(0);
  scene.background = bg;
  renderer.autoClear = autoClear;
  renderer.shadowMap.autoUpdate = shadows;
}

/**
 * Zoomed out (the map icons fully in), buildings draw their light copies (lod.js); close up, the full models.
 * Each scene keeps its own state; while light, it is swept again now and then for tiles placed or rebuilt since.
 */
const lodState = new WeakMap(); // scene root -> { on, sweep }
const LOD_DISTANCE_KEY = 'oto.lodDistance';
LOD.distance = Number(localStorage.getItem(LOD_DISTANCE_KEY)) || LOD.distance; // Performance overlay slider, kept across reloads
const lodDistance = () => LOD.distance;
// Light copies for buildings only: land tiles (pits, pools, cliffs, ruins, camps) are mostly ground, where a simplified
// shape opens gaps in the sand and the fog, and they hold few triangles anyway.
const lodKeys = (key) => TERRAINS[key]?.category === 'building';
function updateLod(root, dt) {
  let st = lodState.get(root);
  if (!st) lodState.set(root, (st = { on: false, sweep: 0 }));
  const on = wantLod(rig.distance, lodDistance(), st.on);
  st.sweep -= dt;
  if (on === st.on && (!on || st.sweep > 0)) return;
  st.sweep = 0.5;
  st.on = on;
  setLod(root, on);
}

let last = performance.now();
function updatePayoutFx(dt) {
  payoutHud.batch(() => {
    payout.update(dt);
    updateFactoryHops(dt);
    updatePadMissiles(dt);
    updateFactoryFloaters(dt);
    oilFlights.update(dt);
  });
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = now / 1000;
  perf.frameBegin(now);
  if (view !== 'board') shadowCache.invalidate();
  if (view === 'title') {
    // The main screen: the planet scene (War Map) with the title ship, nothing of the board.
    perf.begin('render (cpu)');
    flattenCurve();
    titleGlobe.update(dt);
    titlePlanet.update(dt);
    titleScreen.update(dt);
    titleGlobe.render();
    perf.end('render (cpu)');
    perf.frameEnd();
    requestAnimationFrame(frame);
    return;
  }

  perf.begin('camera');
  rig.update(dt);
  if (!switching && view !== 'globe') clouds.setPeek(rig.stretch ** 0.8 * 0.92);
  // The attack phase keeps time wherever you're looking: flights on the planet, strikes in every city.
  if (view !== 'globe') globe.tickWar(dt);
  if (view !== 'board') {
    missiles.update(dt);
    dust.update(dt);
  }
  syncDefence();
  rivalMissiles?.update(dt);
  updateWarTimer();
  if (view !== 'board') {
    // The payout keeps paying out wherever you're looking (on the board it runs after the render, below).
    updatePayoutFx(dt);
  }
  if (view === 'globe') {
    perf.end('camera');
    perf.begin('render (cpu)');
    perf.gpuBegin();
    flattenCurve(); // the War Map has its own hex-planet bend; the board's map shape never applies here
    globe.update(dt);
    globe.render();
    tutorial.update(time); // the guided trip to the planet points at cities here
    perf.gpuEnd();
    perf.end('render (cpu)');
    perf.frameEnd();
    requestAnimationFrame(frame);
    return;
  }
  if (view === 'rival') {
    perf.end('camera');
    perf.begin('tile anims');
    factory.update(dt, rivalView.scene);
    perf.end('tile anims');
    perf.begin('render (cpu)');
    perf.gpuBegin();
    updateCurve(camera, rig.target); // rival cities follow the Graphics map shape (Flat / Planet), like the board
    syncSteadyCam();
    camShake.update(dt, rig.distance);
    rivalView.update(dt, camera); // fog and targeting animations; render() owns the depth/colour passes
    updateAimHover();
    updateLod(rivalView.scene, dt);
    rivalView.render(camera);
    tutorial.update(time); // the guided trip: back to the War Map from here
    perf.gpuEnd();
    perf.end('render (cpu)');
    perf.frameEnd();
    requestAnimationFrame(frame);
    return;
  }
  followTarget(rig.target, rig.distance, dt);
  perf.end('camera');
  perf.begin('drops+shake');
  updateDropAnims(dt);
  syncSteadyCam();
  applyShake(dt);
  camShake.update(dt, rig.distance); // missile strikes only
  perf.end('drops+shake');
  perf.begin('dust');
  dust.update(dt);
  perf.end('dust');
  perf.begin('missiles');
  missiles.update(dt);
  perf.end('missiles');
  perf.begin('tile anims');
  factory.update(dt, scene);
  perf.end('tile anims');
  perf.begin('ships');
  traffic.update(dt, grid);
  neonTiles.update(dt, time);
  // Outlines where the card being placed (or hovered) would be boosted.
  const placing = hand.piece;
  // (Not while the guided opening teaches a placement: its own outlines show the spot, one signal at a time.)
  boostHints.update(dt, time, grid, tutorial.guiding ? null : ((placing ?? hand.hoveredPiece)?.terrain ?? null), Boolean(placing), placing && !rig.isDragging ? hoveredCell() : null, placing && placement.result && !placement.result.ok);
  perf.end('ships');
  perf.begin('frontier+mysteries');
  frontier.update(dt, time);
  mysteries.update(time);
  perf.end('frontier+mysteries');
  perf.begin('ruin buttons');
  updateRuinButtons();
  updateFactoryBars();
  updateBuildReveal(dt);
  perf.end('ruin buttons');
  updateInterceptCover(time);
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
  updateBuildHover(cell);
  perf.end('inspect');
  perf.begin('placement');
  // Hide the ghost while choosing a plot or while the payout plays.
  if (busy() && hand.selected >= 0 && !payout.active) hand.select(-1);
  placement.update(expansion.active || busy() ? null : cell, dt, time);
  updateForecast(expansion.active || busy() ? null : cell);
  offerMagazine(dt);
  updateRecenter(dt);
  perf.end('placement');
  tutorial.update(time);

  perf.begin('render (cpu)');
  perf.gpuBegin();
  updateCurve(camera, rig.target); // the small-planet bend, around where the camera looks
  updateLod(scene, dt);
  scene.updateMatrixWorld(); // once for culling, fog depth and shadow inspection, including when shadows are off
  shadowCache.update(scene, camera, renderer, true);
  try {
    instancer.begin(camera, true);
    trafficInstances.begin(camera, true);
    fog.render(camera); // the same batches also hide the fog behind buildings
    crtPass.begin();
    renderer.render(scene, camera); // the sun's pass uses these batches too
    renderGhost();
    crtPass.end(time);
  } finally {
    instancer.end(); // picking, animation and material swaps always see the original objects
    trafficInstances.end();
  }
  perf.gpuEnd();
  perf.end('render (cpu)');
  // Anchor icons to the picture just drawn: current camera, planet bend and CRT projection (including camera shake).
  // DOM changes still reach the same browser paint; updating earlier used the preceding frame's projection state.
  perf.begin('map icons');
  zoomIcons.update(grid, cell);
  perf.end('map icons');
  perf.begin('payout');
  updatePayoutFx(dt); // after render so labels use this frame's camera
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
perf.counter('batched parts / draws', () => {
  const batches = view === 'rival' ? [rivalView.instancer] : [instancer, trafficInstances];
  return `${batches.reduce((n, b) => n + b.stats.parts, 0)} / ${batches.reduce((n, b) => n + b.stats.batches, 0)}`;
});
perf.counter('instance transforms uploaded', () => view === 'rival' ? rivalView.instancer.stats.uploads : instancer.stats.uploads + trafficInstances.stats.uploads);
perf.counter('LOD triangles (full → light)', () => `${Math.round(lodStats.before).toLocaleString()} → ${Math.round(lodStats.after).toLocaleString()} in ${lodStats.meshes} meshes`);
perf.toggle({ label: 'LOD models', options: ['Auto', 'On', 'Off'], get: () => LOD.mode, set: (v) => (LOD.mode = v) });
// Where Auto switches to the light models (camera distance).
perf.toggle({
  label: 'LOD distance',
  range: [6, 48, 0.5],
  get: () => lodDistance(),
  set: (v) => {
    LOD.distance = v;
    localStorage.setItem(LOD_DISTANCE_KEY, String(v));
  },
});
perf.counter('camera distance', () => rig.distance.toFixed(1));
perf.counter('sun shadow', () => shadowCache.stats.updated ? 'updated' : 'reused');
perf.toggle({ label: 'Instanced buildings', get: () => instancer.enabled, set: (on) => { instancer.enabled = rivalView.instancer.enabled = trafficInstances.enabled = on; shadowCache.invalidate(); } });
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

/** Compile the construction dissolve shader once the extra models are in, so the first drop doesn't hitch. */
async function prewarmBuildReveal() {
  for (const terrain of ['missilelab', 'warhead']) {
    let mesh;
    try {
      mesh = factory.create(terrain);
    } catch {
      continue;
    }
    const cell = { mesh, terrain, built: false };
    ensureBuildReveal(cell);
    try {
      await renderer.compileAsync(mesh, camera, scene);
    } catch {
      renderer.compile(mesh, camera, scene);
    } finally {
      clearBuildReveal(cell);
    }
  }
}

/**
 * The same for models that arrive during play, without freezing it: each image is decoded off the main thread
 * first, the uploads are spread over frames, then the shaders compile in the background (compileAsync), so the
 * first tile of each kind lands without a hitch.
 */
async function warmUpModelsGradually(models) {
  // At most one upload per frame, so two big textures never land in the same frame.
  const nextFrame = () => new Promise((resolve) => {
    requestAnimationFrame(resolve);
    setTimeout(resolve, 100); // a hidden tab doesn't draw frames: keep going slowly
  });
  for (const tex of modelTextures(models)) {
    await decodeImage(tex.image);
    renderer.initTexture(tex);
    await nextFrame();
  }
  for (const model of models.values()) {
    try {
      await instancer.warm(model, renderer, camera, (m) => [m, greyOf(m)], fog.depthScene.overrideMaterial);
    } catch {
      // compiles on first draw instead
    }
    await breathe();
  }
}

// Start once the models are in, so the Capital lands as the real city rather than a
// stand-in block that swaps a second later. factory.ready also resolves if loading
// fails (the game then runs on coloured blocks).
factory.ready.then(async () => {
  setTimeout(preloadCardArt, 0); // decode the card pictures in the background, so showing cards never waits
  clearInterval(loadTimer);
  $('loadingFill').style.width = '100%';
  warmUpModels();
  // Core model shaders finish behind the loading screen, including the instanced and idle-grey variants.
  for (const model of [...factory.models.values()]) {
    try {
      await instancer.warm(model, renderer, camera, (m) => [m, greyOf(m)], fog.depthScene.overrideMaterial);
    } catch {
      // A shader unsupported by this device gets the usual renderer diagnostics on first draw.
    }
  }
  buildLods(factory.models, lodKeys).catch((e) => console.warn('[lod] skipped', e)); // in the background
  // Sound has to be allowed before the opening hand is dealt, or that whoosh is skipped.
  // When the browser blocks autoplay, the loading screen stays up for one click or key.
  let started = false;
  let swallowNextClick = false;
  const go = () => {
    const sound = unlockSfx();
    combatAudio.unlock();
    startMusic();
    if (started || !sound) return sound;
    started = true;
    showTitle(); // the main screen; Start begins the game
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

// The Wasteland piece models load after the core buildings, while the intro plays (by shape: a list per shape).
factory.piecesReady.then(async (pieces) => {
  if (!pieces) return;
  await warmUpModelsGradually(new Map([...pieces.values()].flat().map((root, i) => [i, root])));
  adoptWastePieces();
  rivalView.refresh(true); // a rival city on screen swaps its blocks for the piece models too
});

// The remaining buildings and tiles load last; any already placed swap their stand-ins for the real models.
factory.extrasReady.then(async (extras) => {
  if (!extras) return;
  await warmUpModelsGradually(extras);
  adoptBlockouts();
  buildLods(extras, lodKeys).catch((e) => console.warn('[lod] skipped', e));
  rivalView.refresh(true);
  await prewarmBuildReveal();
});

// Release build: players get no Game Debug button, no tile library link (library.html isn't built), no cheats.
if (RELEASE) for (const id of ['debugDock', 'libraryLink']) document.getElementById(id)?.remove();

// Handy for debugging in the console (dev builds only).
if (!RELEASE) window.tileIsland = { titleScreen, lod: { LOD, lodStats, setLod }, instancer, shadowCache, tutorial, shadeIdle, resetIsland, debugRandomStrike, traffic, addWastePiece, debugEvent, dealNewHand, debugShop, EVENTS, perf, renderer, grid, hand, placement, rig, expansion, mysteries, fog, turn, dialogue, missiles, missileCfg, previewMissileStrike, playMissileStrike, economy: economyNow, addTile, spawnBandits, settleTurn, spawnRaider, queueScene, playPendingScenes, openCityStrike, drawStrikeHand, missileCount, _t: { openGlobe, globeCfg, clear: () => (eventOpen = false), war: { addMissile, queueDrawn, updateAimBar, runAttackPhase, rivals: () => rivals } } };
