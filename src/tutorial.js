import * as THREE from 'three';
import { SHAPES, pieceOffsets, ROTATIONS } from './pieces.js';
import { DIRS, HEX_RADIUS, hexToWorld, hexDistance } from './grid.js';
import { hexPlane, hexOutline } from './hexGeometry.js';
import { L, onLangChange } from './i18n.js';
import { ICONS, TERRAINS } from './tiles.js';
import { WORKERS, seasonsOfFood } from './economy.js';
import { LessonBook } from './lessons.js';

/**
 * The tutorial, without instructional text: it teaches with the game's own art (the cards, the tile models, the gloved
 * hand, the HUD instruments and the payout), one idea at a time, next to where it happens.
 *
 * The guided opening (a first game, or Replay tutorial) is one production loop on the home board:
 *   1. The commission: the Overlord's portrait, the tribute gauge filling (as a ghost) up to its mark, the season clock
 *      sweeping to the tribute season, and a barrel carried to the Overlord. The Farm card is usable at once.
 *   2. Farm, then Oil Station, next to the Capital: the free cells beside it outlined, one suggested (a dotted outline
 *      round a see-through model of the building). Placed, it shows what it does: Capital and building linked across
 *      their shared edge, a worker taking its place, separate hollow output tokens (each Capital beside it triggers it
 *      once more: two tokens next to one Capital).
 *   3. A Settlement: what it gives and costs, before and after it goes down (two worker slots, food every season;
 *      the stores carry the small shortfall until the next Farm).
 *   4. The two Wasteland cards (parked, low and dim, until then) lay a path out to a "?" site (a dotted link shows
 *      where it leads): the first extends the land, the second (one 60° turn) touches the site and uncovers it, a
 *      Water Pump. Any legal spot is fine; the suggestion is the path.
 *   5. Next turn, at home: the season pays out on the board (oil flies into the gauge) and the clock turns.
 *   6. On your own: the next hand holds a Farm (it feeds the Settlement): beside the Capital or beside the Pump. The
 *      coach waits, and only steps in (outlines, then one gesture, then a repeated demonstration) if you hesitate.
 * Help is adaptive throughout: a normal affordance first, then a dotted suggestion, one ghost-hand gesture, and a
 * repeating demonstration only for whoever still needs it. While you're doing it yourself the hand stays away.
 *
 * After that, contextual lessons (HINTS) come up when they matter, and stay open until done (lessons.js): food running
 * out (with the fix in hand), staffing, a reachable "?" site, boosters, rotating, Next turn with spare cards, rerolling,
 * the War Map, missiles (navigate, aim, launch, come home), the Black Market, and the first tribute. Doing something
 * yourself, prompted or not, counts as learning it. The Controls panel can replay each demonstration on your city.
 *
 * main.js owns the game: it asks allows() / check() before player actions (check is pure: no feedback), reports
 * refusals to rejected(), sends notify(event, data), and calls update() every frame. The tutorial reaches back only
 * through `api`.
 */

// Versioned: bumping it (v4, v5...) makes every player get the guided opening once more on the next release.
export const TUTORIAL_KEY = 'oto.tutorialDone.v3';

export const tutorialDone = () => localStorage.getItem(TUTORIAL_KEY) === '1';
export const markTutorialDone = () => localStorage.setItem(TUTORIAL_KEY, '1');

/**
 * The guided opening's authored start, the same for every player (main.js deals the hand and plants the site):
 * cells next to the Capital for the Farm and the Station, one for the Settlement beside the Farm, and a Wasteland path
 * out from the Station to a "?" site that always holds a Water Pump: the first piece fits as dealt, the second needs
 * one 60° turn and is the one that touches the site (nothing before it does). tests/rules.test.mjs checks all this.
 */
export const OPENING = {
  hand: [
    { terrain: 'farm' },
    { terrain: 'station' },
    { terrain: 'settlement' },
    { terrain: 'wasteland1', shape: 'pair', rot: 0 },
    { terrain: 'wasteland1', shape: 'pair', rot: 0 },
  ],
  farm: [-1, 0],
  station: [1, 0],
  settlement: [-2, 0],
  waste: [
    [[2, 0], [3, 0]],
    [[4, 0], [4, 1]],
  ],
  site: { at: [4, 2], terrain: 'pump' },
  /** Pinned into the second hand: the card to place on your own. */
  next: 'farm',
};

const PRODUCERS = new Set(['farm', 'station']);
const RES_OF = { farm: 'food', station: 'oil', pump: 'food', oasis: 'food', tarpit: 'oil', refinery: 'oil' };
const BOOSTERS = { pump: 'farm', oasis: 'farm', tarpit: 'station', refinery: 'station' };

/**
 * The guided opening. Each step:
 *   wait     what completes it: time (an informational beat, input stays open), place (a card of `terrain` placed;
 *            'wasteland' matches any Wasteland, 'producer' a Farm or Station), endTurn, dealt (the next hand is dealt)
 *   build    part of the first build: placing its card early (out of order) counts too
 *   ms       time steps: seconds the beat stays on screen, counted while it's visible
 */
const STEPS = [
  { id: 'commission', wait: 'time', ms: 2700 },
  { id: 'farm', wait: 'place', terrain: 'farm', build: true },
  { id: 'station', wait: 'place', terrain: 'station', build: true },
  { id: 'settlement', wait: 'place', terrain: 'settlement', build: true },
  { id: 'waste', wait: 'place', terrain: 'wasteland', build: true },
  { id: 'waste', wait: 'place', terrain: 'wasteland', build: true },
  { id: 'advance', wait: 'endTurn' },
  { id: 'payout', wait: 'dealt' },
  { id: 'clock', wait: 'time', ms: 1600 },
  { id: 'apply', wait: 'place', terrain: 'producer' },
  { id: 'end', wait: 'end' },
];
const APPLY = STEPS.findIndex((s) => s.id === 'apply');

/** The missile cards a rival city's hand holds (main.js openRivalHand). (The Salvo card, which fans them, is apart.) */
const MISSILE_CARDS = new Set(['missile', 'missile2']);

const matches = (step, terrain) =>
  step.terrain === 'wasteland'
    ? terrain?.startsWith('wasteland')
    : step.terrain === 'producer'
      ? PRODUCERS.has(terrain)
      : terrain === step.terrain;
const keyOf = (cells) => cells.map(([x, z]) => `${x},${z}`).join('|');
const setKey = (cells) => keyOf(cells).split('|').sort().join('|'); // the same cells in any order
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

const BOARD_BLOCKED = '.dialogue, .striking, .paying, .shopping';

// A pointing glove (fingertip at the top left: HAND_TIP), drawn twice: a dark outline pass, then the fill.
const GLOVE = (() => {
  const parts = `
    <rect x="16" y="2" width="13" height="44" rx="6.5"/>
    <rect x="28" y="24" width="12" height="26" rx="6"/>
    <rect x="39" y="28" width="11" height="24" rx="5.5"/>
    <rect x="49" y="33" width="9" height="20" rx="4.5"/>
    <rect x="16" y="36" width="42" height="34" rx="12"/>
    <rect x="2" y="38" width="24" height="11" rx="5.5" transform="rotate(35 14 43)"/>`;
  return `<svg viewBox="-4 -4 72 88" aria-hidden="true">
    <g fill="#1a1410" stroke="#1a1410" stroke-width="7" stroke-linejoin="round">${parts}<rect x="18" y="66" width="38" height="14" rx="3"/></g>
    <g fill="#f4ead6">${parts}</g>
    <rect x="18" y="66" width="38" height="14" rx="3" fill="#c09550"/>
    <path d="M22 70h30M22 75h30" stroke="#8a652b" stroke-width="1.5"/>
  </svg>`;
})();
const HAND_W = 54; // px
const HAND_TIP = [((22.5 + 4) / 72) * HAND_W, ((2 + 4) / 72) * HAND_W]; // fingertip inside the element

/** A hex dial with a pointer that clicks round a sixth of a turn at a time: a piece turns 60° per press. */
const HEX_DIAL = `<svg class="coach-dial" viewBox="-14 -14 28 28" aria-hidden="true">
  <path d="M0-12L10.4-6V6L0 12L-10.4 6V-6z" fill="#1d2326" stroke="#e8d9b8" stroke-width="1.6"/>
  <g class="coach-dial-hand"><path d="M0 0V-9" stroke="#ffb347" stroke-width="2.6" stroke-linecap="round"/><circle r="2.2" fill="#ffb347"/></g>
</svg>`;
// Mouse: the R key or the right button turns the piece; touch: the rotate button (the hand taps it instead).
const ROTATE_ICONS = `
  <span class="coach-key">R</span>
  ${HEX_DIAL}
  <svg class="coach-mouse" viewBox="0 0 24 34" aria-hidden="true"><rect x="2" y="2" width="20" height="30" rx="10" fill="#1d2326" stroke="#e8d9b8" stroke-width="2"/><path d="M12 2v12M2 14h20" stroke="#e8d9b8" stroke-width="2"/><path d="M13 3.2a9 9 0 0 1 7.8 9.8H13z" fill="#ffb347"/></svg>`;

/** The season dial in small: marks a token as "every season" (recurring), not a one-off. */
const CLOCK_GLYPH = `<svg class="coach-clock" viewBox="-10 -10 20 20" aria-hidden="true"><circle r="8.6" fill="#1d2326" stroke="#e8d9b8" stroke-width="1.4"/><path d="M0 0V-8.6M0 0H-8.6" stroke="#e8d9b8" stroke-width="0.8" opacity="0.6"/><path d="M0 0L5 -5" stroke="#ffb347" stroke-width="2" stroke-linecap="round"/></svg>`;
/** A stamped check: done, this stops asking for attention. */
const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="#1d2326" stroke="#9be36f" stroke-width="2"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#9be36f" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** A worker's empty socket: a building with no one to run it. */
const NO_WORKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" fill="none" stroke="#ff8a6a" stroke-width="2" stroke-dasharray="3 2"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" fill="none" stroke="#ff8a6a" stroke-width="2" stroke-dasharray="3 2"/><path d="M3 3l18 18" stroke="#ff5a3c" stroke-width="2.4" stroke-linecap="round"/></svg>`;

// Skip: a hand jumping over a hex (leave this lesson), distinct from Next turn and from the replay arrow.
const SKIP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 19.5l-3.5-2v-4l3.5-2 3.5 2v4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5C6 3 15 2 19 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20.5 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const icon = (res) => ICONS[res === 'workers' ? 'manpower' : res] ?? '';
/** A building's output split over its triggers, as the payout splits it (main.js splitTriggers): one token each. */
function splitParts(total, n) {
  const out = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    const v = Math.ceil(left / (n - i));
    out.push(v);
    left -= v;
  }
  return out;
}

export class Tutorial {
  active = false; // the guided opening is on (from the reset until the card placed on your own)
  index = -1; // -1: not begun yet

  /** api: see main.js (grid, placement, mysteries, economy(), economyIf(), view(), ...) */
  constructor({ root, scene, camera, hand, factory, api }) {
    this.root = root;
    this.scene = scene;
    this.camera = camera;
    this.hand = hand;
    this.factory = factory;
    this.api = api;
    this.lessons = new LessonBook(localStorage);
    root.innerHTML = `
      <svg class="coach-lines" aria-hidden="true"></svg>
      <div class="coach-rings"></div>
      <div class="coach-ring hidden"></div>
      <div class="coach-ghostfill hidden"><i></i><b></b></div>
      <svg class="coach-arc hidden" viewBox="-50 -50 100 100" aria-hidden="true"><circle r="46" pathLength="100"/></svg>
      <div class="coach-tokens"></div>
      <div class="coach-hand hidden"><img class="coach-hand-card" alt="" /><span class="coach-hand-glyph"></span>${GLOVE}<span class="coach-tap"></span></div>
      <div class="coach-rotate hidden">${ROTATE_ICONS}</div>
      <div class="coach-reveal"></div>
      <button type="button" class="coach-skip hidden">${SKIP_ICON}</button>`;
    this.lines = root.querySelector('.coach-lines');
    this.ringsEl = root.querySelector('.coach-rings');
    this.ring = root.querySelector('.coach-ring');
    this.fillEl = root.querySelector('.coach-ghostfill');
    this.arcEl = root.querySelector('.coach-arc');
    this.tokensEl = root.querySelector('.coach-tokens');
    this.handEl = root.querySelector('.coach-hand');
    this.cardEl = root.querySelector('.coach-hand-card');
    this.glyphEl = root.querySelector('.coach-hand-glyph');
    this.tapEl = root.querySelector('.coach-tap');
    this.rotateEl = root.querySelector('.coach-rotate');
    this.revealEl = root.querySelector('.coach-reveal');
    this.skipBtn = root.querySelector('.coach-skip');
    this.skipBtn.addEventListener('click', () => this.#skip());
    this.skipBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.#labels();
    onLangChange(() => this.#labels());

    // Board marks: solid outlines on the legal cells of a lesson, and the suggested spot (dotted outline + a
    // see-through model of the building, with its shared edge to the land it joins).
    this.marks = new THREE.Group();
    this.marks.visible = false;
    scene.add(this.marks);
    this.legalGeo = hexOutline(0.9);
    this.legalMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8, depthWrite: false });
    this.dotMat = new THREE.LineDashedMaterial({ color: 0xffe2a0, transparent: true, dashSize: 0.09, gapSize: 0.07, depthWrite: false });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xfff1c8, transparent: true, depthWrite: false });
    this.fillGeo = hexPlane(0.86);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xe8bf68, transparent: true, opacity: 0.12, depthWrite: false });
    this.marksKey = '';
    this.ghost = null; // the see-through model on the suggested spot
    this.ghostKey = '';

    this.v = new THREE.Vector3();
    this.fx = []; // short demonstrations playing over the board: { kind, age, life, ... }
    this.loop = 0; // seconds into the ghost hand's loop
    this.handKey = '';
    this.last = null;
    this.flash = 0; // a refused move: the legal cells flash for a moment
    this.calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.#resetRun();
  }

  /** Everything that belongs to one run (a replay or a new game starts it again). */
  #resetRun() {
    this.got = new Set(); // opening steps already done (in or out of order)
    this.hint = null; // the lesson on screen: { id, view, over, ... }
    this.replay = null; // a demonstration replayed from the Controls panel
    this.clock = 0; // seconds of visible, unblocked time (timers and assistance run on it)
    this.played = 0; // seconds of free play on the board (lessons' cooldowns)
    this.idle = 0; // seconds with nothing to do but end the turn
    this.nextCheck = 0; // seconds until the lessons are looked over again
    this.lastInput = 0;
    this.struggle = 0; // refusals in the current beat (more help)
    this.beatAt = 0;
    this.gestured = false; // the beat's single gesture has played
    this.sawPlanet = false;
    this.inRival = 0;
    this.aimAt = null;
    this.prevView = 'board';
    this.wasHomeward = false;
    this.heldPiece = null;
    this.heldAt = 0;
    this.flyAt = null;
    this.quietUntil = 0;
    this.framedPath = false;
    this.seasonsPlayed = 0;
    // Every short demonstration still on screen goes, with all its tokens: a reset mid-commission or mid-tribute must
    // not leave a barrel behind on the Overlord's face. Whatever waits on one (the tribute) carries on.
    for (const f of this.fx) {
      f.el?.remove();
      for (const t of f.tokens ?? []) t.remove();
      f.done?.();
    }
    this.fx = [];
    this.tokensEl?.replaceChildren(); // (lesson and forecast tokens too: they're made again as needed)
    this.viewTokens = [];
    this.fcTokens = [];
  }

  /** No visible text: the buttons only have names for screen readers. */
  #labels() {
    this.skipBtn.setAttribute('aria-label', this.active ? L('Skip tutorial', '跳过教程') : L('Skip this hint', '跳过此提示'));
  }

  get step() {
    return this.index >= 0 ? STEPS[this.index] : null;
  }

  /** The guided opening is on and the first build isn't finished (the War Map, reroll and market wait). */
  get guiding() {
    return this.active && this.index >= 0 && this.index < APPLY;
  }

  /** A new run with the guided opening: everything waits for begin(). Its lessons start over too. */
  start() {
    this.active = true;
    this.index = -1;
    this.#resetRun();
    this.lessons.reset();
    this.#labels();
    this.hand.render();
  }

  /** The guiding starts (at once: the commission plays while the first card is already usable). */
  begin() {
    if (!this.active) return;
    this.#go(0);
  }

  stop() {
    this.active = false;
    this.index = -1;
    this.hint = null;
    this.hand.discarding = false;
    document.body.classList.remove('guided');
    this.#labels();
    this.hand.render();
  }

  /** The skip button: leaves the guided opening, or puts the lesson on screen aside for good. */
  #skip() {
    if (this.active) return this.api.skip();
    if (this.hint) {
      this.lessons.dismiss(this.hint.id);
      this.hint.leave?.();
      this.#endHint();
    }
    this.replay = null;
  }

  // ---------- rules (pure: no feedback here) ----------

  /** A card that waits its turn: the Wasteland until the buildings (Farm, Station, Settlement) are down. */
  parks(piece) {
    if (!this.guiding || !piece?.terrain.startsWith('wasteland')) return false;
    return !this.#builtBuildings();
  }

  #builtBuildings() {
    return STEPS.every((s, i) => !(s.build && s.terrain !== 'wasteland') || this.got.has(i));
  }

  #buildDone() {
    return STEPS.every((s, i) => !s.build || this.got.has(i));
  }

  /** May the player do this right now? select | rotate | place | endTurn | globe | reroll | market. */
  allows(action, payload) {
    if (!this.active) return true;
    if (this.index < 0) return false;
    if (action === 'select') return !this.parks(payload);
    if (action === 'rotate' || action === 'place') return true;
    // Next turn waits for the first build; the War Map, reroll and the market wait for the home loop.
    if (action === 'endTurn') return this.index >= APPLY || this.#buildDone();
    return this.index >= APPLY;
  }

  /**
   * placement.guard: the opening's one placement rule, as an answer only (hovering never triggers feedback). During
   * the first build a Farm or a Station goes next to the Capital (while there's room there): that's the lesson.
   */
  check(cells, piece) {
    if (!this.guiding || !piece || !PRODUCERS.has(piece.terrain)) return null;
    const ring = this.#aroundCapital();
    if (!ring.length || cells.every((c) => ring.some((r) => same(r, c)))) return null;
    return { ok: false, reason: '' };
  }

  /**
   * An attempted action was refused (main.js): show what's actually wrong, where it is, and give more help.
   *   tutorial     a Farm / Station away from the Capital: the cells beside it flash
   *   occupied | site | territory | edge   the cells in the way get crosses (the ghost shows them while hovering too)
   *   disconnected the piece doesn't touch your land: a broken link to the nearest land
   *   parked       a parked card was picked: it shakes, the card to play now hops
   *   mandatory    Next turn with Wasteland still to place: the Wasteland cards hop, the button shakes
   *   early        Next turn before the first build: the card to play hops
   */
  rejected(result, piece = null, cells = null) {
    const code = result?.code ?? 'tutorial';
    this.struggle++;
    this.lastInput = this.clock;
    this.gestured = false; // show the gesture again
    this.loop = 0;
    if (code === 'tutorial') this.flash = 0.7;
    if (code === 'parked' && piece) this.hand.shake(piece);
    if (code === 'parked' || code === 'early') {
      const want = this.#wantedCard();
      if (want) this.hand.kick(want);
    }
    if (code === 'mandatory') {
      for (const p of this.hand.placeableForced) this.hand.kick(p);
      this.#shakeEl('#btnNext');
    }
    if (code === 'disconnected' && cells?.length) {
      const near = this.#nearestLand(cells);
      if (near) this.fx.push({ kind: 'broken', from: cells, to: near, age: 0, life: 1.6 });
    }
    if ((code === 'occupied' || code === 'site' || code === 'territory') && result.cells?.length)
      this.fx.push({ kind: 'crosses', cells: result.cells, age: 0, life: 1.2 });
  }

  #shakeEl(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove('coach-shake');
    void el.offsetWidth;
    el.classList.add('coach-shake');
  }

  /**
   * Something happened in the game. Completing a lesson is decided here, from what was done, not from what was shown:
   *   placed { terrain, cells, gain }   a card went down (gain: boost it added, from the economy)
   *   selected { piece } | rotated { piece } | endTurn | dealt | revealed | globe | home | aimed { salvo }
   *   attackDone { mine } | market | purchased | rerolled | input (the player is busy with something)
   */
  notify(event, data = {}) {
    if (event !== 'dealt' && event !== 'attackDone') this.lastInput = this.clock;
    const prompted = (id) => this.hint?.id === id || this.replay?.id === id;
    const done = (id) => {
      const was = this.lessons.learnt(id);
      this.lessons.complete(id, prompted(id));
      if (this.hint?.id === id) this.#endHint(true);
      return !was;
    };
    if (event === 'rotated') done('rotate');
    if (event === 'revealed') {
      done('explore');
      if (this.active) for (const f of data.found ?? []) this.#stamp([[f.x, f.z]]);
    }
    if (event === 'globe') {
      this.sawPlanet = true;
      done('globe');
    }
    if (event === 'home') done('home');
    if (event === 'aimed') {
      if (data.salvo) done('salvo');
    }
    if (event === 'attackDone' && data.mine) done('war');
    if (event === 'market') done('market');
    if (event === 'purchased' && this.api.market()) done('marketTour');
    if (event === 'rerolled') done('reroll');
    if (event === 'ruinsCleared') done('ruins');
    if (event === 'endTurn') {
      if (this.hand.cards.some((p) => !p.terrain.startsWith('wasteland'))) done('next'); // left cards, on purpose
      this.seasonsPlayed++;
    }
    if (event === 'placed') {
      const { terrain, cells, before } = data;
      const after = this.api.economy();
      const boosted = (e) => [...(e?.boosts?.values() ?? [])].reduce((a, n) => a + n, 0);
      if (terrain === 'settlement' && !this.guiding) done('workers'); // (the opening's doesn't: no one needed it yet)
      // A booster that now adds to something, or a producer a booster now adds to: the economy says so.
      if (before && boosted(after) > boosted(before)) done('boost');
      // A shortage on its way, fixed (whether its hint was up or not).
      if (before && !this.guiding && seasonsOfFood(before) <= 1 && seasonsOfFood(after) > 1) done('food');
      this.struggle = 0;
      if (this.active) this.#placedGuided(terrain, cells);
    }
    if (!this.active || this.index < 0) return;
    const s = this.step;
    if (event === 'endTurn' && s.wait === 'endTurn') return this.#go(this.index + 1);
    if (event === 'dealt' && s.wait === 'dealt') return this.#go(this.index + 1);
    // After the first payout, a turn ended without the card on your own: the opening is over either way.
    if (event === 'endTurn' && this.index > STEPS.findIndex((st) => st.id === 'payout')) return this.#finish();
  }

  /** A card placed during the guided opening: credit the first build step it completes (in or out of order). */
  #placedGuided(terrain, cells) {
    const s = this.step;
    if (this.index >= APPLY) {
      if (matches(s, terrain)) {
        this.lessons.complete('build', this.#level() >= 2);
        this.#stamp(cells);
        this.#finish();
      }
      return;
    }
    const i = STEPS.findIndex((st, k) => st.build && !this.got.has(k) && matches(st, terrain));
    if (i < 0) return;
    this.got.add(i);
    if (PRODUCERS.has(terrain)) this.#yield(cells[0], terrain);
    else if (terrain === 'settlement') this.#housing(cells[0]);
    else this.#stamp(cells);
    this.hand.render(); // the Wasteland may unpark
    if (i === this.index || this.got.has(this.index)) this.#go(this.index + 1);
  }

  #finish() {
    markTutorialDone();
    this.stop();
    this.quietUntil = this.clock + 5; // a moment to use what was just learnt before anything else is shown
  }

  // ---------- the guided opening ----------

  #go(i) {
    while (i < STEPS.length - 1 && this.got.has(i)) i++;
    this.index = Math.min(i, STEPS.length - 1);
    const s = this.step;
    this.beatAt = this.clock;
    this.lastInput = this.clock;
    this.struggle = 0;
    this.gestured = false;
    this.loop = 0;
    this.plan = null;
    if (s.wait === 'end') return this.#finish();
    document.body.classList.toggle('guided', this.guiding);
    if (s.id === 'commission') this.fx.push({ kind: 'commission', age: 0, life: s.ms / 1000 });
    if (s.id === 'clock') this.fx.push({ kind: 'ring', selector: '#seasonClock', age: 0, life: 1.6 });
    if (s.id === 'advance') this.api.frameCity?.(); // the payout plays where it can all be seen
    this.hand.render();
  }

  /**
   * The Wasteland beat, once: the view frames the whole city and the "?" site the path leads to; where that doesn't
   * fit (a narrow screen), just the path and the site.
   */
  #framePath() {
    const site = OPENING.site.at;
    if (this.framedPath || !this.api.mysteries.has(...site)) return;
    this.framedPath = true;
    const box = (cells) => {
      const pts = cells.map(([x, z]) => hexToWorld(x, z));
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    };
    const city = box([...[...this.api.grid.cells.values()].map((c) => [c.x, c.z]), site]);
    const path = box([...OPENING.waste.flat(), site]);
    // Pixels per world unit at this zoom, against the board's free area.
    const [ax] = this.#screen(0, 0, 0);
    const [bx] = this.#screen(1, 0, 0);
    const ppu = Math.abs(bx - ax) || 1;
    const safe = this.#safeRect();
    const b = (city.x1 - city.x0 + 1.2) * ppu < safe.right - safe.left ? city : path;
    this.api.focus((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
  }

  /** The level of help for the current beat: 0 nothing extra, 1 suggestion, 2 one gesture, 3 repeated gesture. */
  #level(base = null) {
    const s = this.step;
    const b = base ?? (s?.id === 'farm' && !this.got.size ? 2 : s?.id === 'apply' ? 0 : 1);
    const idle = this.clock - this.lastInput;
    let lv = b;
    if (s?.id === 'apply') lv += (idle > 9 ? 1 : 0) + (idle > 17 ? 1 : 0) + (idle > 27 ? 1 : 0);
    else lv += (idle > 4 ? 1 : 0) + (idle > 10 ? 1 : 0);
    return Math.min(3, lv + Math.min(2, this.struggle));
  }

  /** The card the current step wants (for the hop), or null. */
  #wantedCard() {
    const s = this.step;
    if (!s || s.wait !== 'place') return this.hand.cards.find((p) => !this.parks(p)) ?? null;
    return this.hand.cards.find((p) => matches(s, p.terrain) && !this.parks(p)) ?? null;
  }

  /** What the current step shows. */
  #guide() {
    const s = this.step;
    if (!s || s.wait === 'end') return null;
    const age = this.clock - this.beatAt;
    if (s.wait === 'time') {
      if (age * 1000 >= s.ms) this.#go(this.index + 1);
      // The first card is already live during the commission: it rises (the hand comes once the commission is over).
      return s.id === 'commission' ? { salient: this.#wantedCard() } : null;
    }
    if (s.wait === 'endTurn') {
      // Nothing is in the way: one press on Next turn.
      const lv = this.#level(1);
      return { hand: lv >= 2 ? { tapOn: '#btnNext', once: lv < 3 } : null, ring: { selector: '#btnNext' } };
    }
    if (s.wait === 'dealt') return null; // the payout plays on its own
    if (s.wait === 'place') {
      // One thing at a time: while the last building shows what it does, the next card only glows.
      if (this.fx.some((f) => (f.kind === 'yield' || f.kind === 'housing') && f.age < 2.4)) return { salient: this.#wantedCard() };
      if (s.terrain === 'wasteland') this.#framePath();
      return this.#placeView(s);
    }
    return null;
  }

  /** A place step: legal cells outlined, one spot suggested, and the hand when needed. */
  #placeView(s) {
    const i = this.hand.cards.findIndex((p) => matches(s, p.terrain) && !this.parks(p));
    if (i < 0) {
      // The card isn't in hand (or a Wasteland fits nowhere): nothing to guide here.
      if (s.build) this.got.add(this.index);
      if (s.id === 'apply') return null; // no producer dealt: the step ends with the turn
      this.#go(this.index + 1);
      return null;
    }
    const piece = this.hand.cards[i];
    // A Wasteland that fits nowhere doesn't block the turn (the game's own rule): nothing to place here.
    if (s.terrain === 'wasteland' && !this.hand.placeableForced.includes(piece)) {
      this.got.add(this.index);
      this.#go(this.index + 1);
      return null;
    }
    const plan = this.#plan(s, piece);
    const lv = this.#level();
    const held = this.hand.piece === piece;
    const view = { salient: lv >= 1 ? piece : null };
    if (!plan) return view;
    if (lv >= 1 || held) view.marks = plan.legal;
    // The Wasteland path's destination: a dotted link from the suggested piece to the "?" site it leads to.
    const [sx, sz] = OPENING.site.at;
    if (s.terrain === 'wasteland' && this.api.mysteries.has(sx, sz)) {
      const near = [...plan.cells].sort((a, b) => hexDistance(a[0], a[1], sx, sz) - hexDistance(b[0], b[1], sx, sz))[0];
      view.link = { from: near, to: [sx, sz] };
    }
    // On your own the outlines come first (several right answers); a single suggestion only with more help.
    if ((lv >= 1 || held) && (s.id !== 'apply' || lv >= 2))
      view.suggest = { terrain: piece.terrain, shape: piece.shape, rot: plan.rot, cells: plan.cells, joins: plan.joins };
    // Held the wrong way round for the suggested spot, and over it: the rotation cue (60°, as the piece turns). Any
    // other legal spot is fine as it is, so it only shows there.
    const turned = held && plan.rot !== undefined && setKey(pieceOffsets(piece)) !== setKey(pieceOffsets({ shape: piece.shape, rot: plan.rot }));
    // (Touch has no hover: a tap places at once, so there the cue shows as soon as it's held the wrong way round.)
    const touch = this.api.modality() === 'touch';
    if (turned && !this.hand.dragging && (touch || this.#cursorNear(plan.cells) || (lv >= 2 && !this.api.cursor()))) {
      Object.assign(view, this.rotateCueAt(plan.anchor));
      return view;
    }
    // Doing it yourself (dragging, or holding it over the board): the hand stays away, the suggestion stays.
    const busy = this.hand.dragging || (held && this.api.cursor() && this.api.placement.result?.ok);
    if (busy) return view;
    if (lv < 2) return view;
    const once = lv < 3;
    if (held) view.hand = { tap: this.#cellsCentre([plan.anchor]), key: `cell${plan.anchor}`, once };
    else view.hand = { drag: i, to: plan.anchor, once };
    return view;
  }

  #cursorNear(cells) {
    const c = this.api.cursor();
    return Boolean(c && cells.some((x) => hexDistance(x[0], x[1], c[0], c[1]) <= 1));
  }

  /**
   * Where the step's card goes: { legal, cells, anchor, rot, joins }. Producers: the free cells beside the Capital
   * (the authored one first); Wasteland: its authored footprint if still free, else the best legal spot away from
   * the Capital; on your own: every free cell beside the Capital (several right answers). The whole footprint is
   * checked with the game's own rule (placement.validate is pure).
   */
  #plan(s, piece) {
    if (this.plan?.piece === piece && this.plan.rev === this.api.grid.size) return this.plan;
    let plan = null;
    if (PRODUCERS.has(piece.terrain)) {
      const legal = this.#aroundCapital();
      const want = s.id === 'apply' ? null : OPENING[piece.terrain];
      const at = (want && legal.find((c) => same(c, want))) ?? [...legal].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      // On your own: beside a booster on the board is a right answer too (a Farm by the Pump found in the opening).
      if (s.id === 'apply') legal.push(...this.#besideBoosters(piece).filter((c) => !legal.some((l) => same(l, c))));
      if (at) plan = { legal, cells: [at], anchor: at, rot: undefined, joins: [[0, 0], at] };
      else plan = this.#anywhere(piece);
    } else if (piece.terrain === 'settlement' && this.guiding && this.#legalFor(piece, [OPENING.settlement])) {
      const at = OPENING.settlement;
      plan = { legal: null, cells: [at], anchor: at, rot: undefined, joins: this.#joinFor([at]) };
    } else if (piece.terrain.startsWith('wasteland')) {
      plan = this.#wastePlan(piece);
    } else plan = this.#anywhere(piece);
    if (plan) Object.assign(plan, { piece, rev: this.api.grid.size });
    this.plan = plan;
    return plan;
  }

  /** Free cells where `piece` (a Farm / Station) would stand beside one of its boosters (a Pump, an Oasis...). */
  #besideBoosters(piece) {
    const out = [];
    for (const c of this.api.grid.cells.values()) {
      if (BOOSTERS[c.terrain] !== piece.terrain) continue;
      for (const [dx, dz] of DIRS) {
        const n = [c.x + dx, c.z + dz];
        if (!this.api.grid.has(...n) && this.#legalFor(piece, [n])) out.push(n);
      }
    }
    return out;
  }

  /** A single-cell card anywhere legal (away from the Capital's sides when possible). */
  #anywhere(piece) {
    const at = this.#suggestCell(piece);
    if (!at) return null;
    const join = DIRS.map(([dx, dz]) => [at[0] + dx, at[1] + dz]).find(([x, z]) => this.api.grid.has(x, z));
    return { legal: null, cells: [at], anchor: at, rot: undefined, joins: join ? [join, at] : null };
  }

  /** The Wasteland card's spot: its authored footprint while free, else the best legal one away from the Capital. */
  #wastePlan(piece) {
    const wastes = this.hand.cards.filter((p) => p.terrain.startsWith('wasteland'));
    const slot = Math.max(0, OPENING.waste.length - wastes.length);
    const fixed = this.active ? OPENING.waste[Math.min(slot + wastes.indexOf(piece), OPENING.waste.length - 1)] : null;
    const fits = (cells) => this.#legalFor(piece, cells);
    if (fixed && fits(fixed)) {
      for (let rot = 0; rot < ROTATIONS; rot++) {
        const offs = pieceOffsets({ shape: piece.shape, rot });
        for (const c of fixed) {
          const cells = offs.map(([ox, oz]) => [c[0] + ox, c[1] + oz]);
          if (setKey(cells) === setKey(fixed)) return { legal: null, cells, anchor: c, rot, joins: this.#joinFor(cells) };
        }
      }
    }
    // Any legal spot: touching the land, off the Capital's sides, nearest the middle, no turn if possible.
    let best = null;
    for (let rot = 0; rot < ROTATIONS; rot++) {
      const offs = pieceOffsets({ shape: piece.shape, rot });
      for (const k of this.api.grid.openKeys()) {
        const [ax, az] = k.split(',').map(Number);
        const cells = offs.map(([ox, oz]) => [ax + ox, az + oz]);
        if (!fits(cells)) continue;
        const sides = cells.filter(([x, z]) => hexDistance(x, z) === 1).length;
        const score = sides * 20 + Math.max(...cells.map(([x, z]) => hexDistance(x, z))) * 2 + (rot === piece.rot ? 0 : 1);
        if (!best || score < best.score) best = { score, cells, anchor: [ax, az], rot };
      }
    }
    return best && { legal: null, cells: best.cells, anchor: best.anchor, rot: best.rot, joins: this.#joinFor(best.cells) };
  }

  /** Whether `cells` is a legal spot for `piece` by the game's own rules (and the opening's). */
  #legalFor(piece, cells) {
    const p = this.api.placement;
    const keep = p.piece;
    p.piece = piece; // validate reads the piece's kind only
    const ok = p.validate(cells).ok;
    p.piece = keep;
    return ok;
  }

  #joinFor(cells) {
    for (const c of cells)
      for (const [dx, dz] of DIRS) {
        const n = [c[0] + dx, c[1] + dz];
        if (this.api.grid.has(...n)) return [n, c];
      }
    return null;
  }

  /** The free cells you could build on next to the Capital. */
  #aroundCapital() {
    const { grid, mysteries } = this.api;
    return DIRS.map(([dx, dz]) => [dx, dz]).filter(([x, z]) => !grid.has(x, z) && grid.allowed(x, z) && !mysteries.has(x, z));
  }

  /** A free cell touching the land, off the Capital's sides, near the middle of the view, where a card can go. */
  #suggestCell(piece = null) {
    const { grid, mysteries } = this.api;
    let best = null;
    let bestD = Infinity;
    for (const k of grid.openKeys()) {
      const [x, z] = k.split(',').map(Number);
      if (mysteries.has(x, z)) continue;
      if (piece && !this.#legalFor(piece, [[x, z]])) continue;
      const d = hexDistance(x, z) + (hexDistance(x, z) === 1 ? 6 : 0) + (this.#onScreen([x, z]) ? 0 : 20);
      if (d < bestD) {
        best = [x, z];
        bestD = d;
      }
    }
    return best;
  }

  #nearestLand(cells) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.api.grid.cells.values())
      for (const [x, z] of cells) {
        const d = hexDistance(x, z, c.x, c.z);
        if (d < bestD) {
          bestD = d;
          best = [c.x, c.z];
        }
      }
    return best;
  }

  // ---------- consequences shown next to the action ----------

  /**
   * A Farm / Station just placed: what it does, from the economy itself. A link across the shared edge with the
   * Capital (when it doubles it), a worker taking its place (or an empty socket if there's no one free), then its
   * output as hollow tokens (a forecast: earned at the end of the season), one per trigger, apart.
   */
  #yield(cell, terrain) {
    const e = this.api.economy();
    const per = e.perCell.find((p) => p.x === cell[0] && p.z === cell[1]);
    const res = RES_OF[terrain];
    const total = Math.max(0, per?.[res] ?? 0);
    const n = per?.triggers ?? 1;
    const parts = per?.idle ? [] : splitParts(total, n);
    // Linked to the Capital(s) beside it (each one triggers it once more).
    const capitals = n > 1 ? DIRS.map(([dx, dz]) => [cell[0] + dx, cell[1] + dz]).filter(([x, z]) => this.api.grid.get(x, z)?.terrain === 'capital') : [];
    this.fx.push({ kind: 'yield', cell, res, parts, capitals, idle: Boolean(per?.idle), age: 0, life: 3.4 });
  }

  /**
   * A Settlement just placed: what it does, from the economy. Two worker slots join the rack (solid: they're there
   * now), and the food it eats every season (hollow, with the season dial: it's a recurring cost, not paid yet).
   */
  #housing(cell) {
    const e = this.api.economy();
    const per = e.perCell.find((p) => p.x === cell[0] && p.z === cell[1]);
    const slots = Math.max(0, TERRAINS[per?.terrain]?.stats?.manpower ?? 0); // the Settlement's +2
    this.fx.push({ kind: 'housing', cell, slots, food: per?.food ?? 0, age: 0, life: 3.2 });
  }

  /** Done: a stamped check over the cells, then it stops asking for attention. */
  #stamp(cells) {
    this.fx.push({ kind: 'check', cells, age: 0, life: 1.2 });
  }

  /**
   * The first tribute (main.js awaits it before the shop): the year's oil leaves the gauge for the Overlord, the gauge
   * empties, and the next target is ringed. Resolves when it's over.
   */
  tribute() {
    if (!this.lessons.open('tribute')) return Promise.resolve();
    this.lessons.complete('tribute', true);
    return new Promise((done) => this.fx.push({ kind: 'tribute', age: 0, life: 2.6, done }));
  }

  /** After the tribute: the new (higher) target. */
  newTarget() {
    this.fx.push({ kind: 'ring', selector: '#quotaCount', age: 0, life: 1.8 });
  }

  /** A missile loaded into the Magazine at `cell`: it rises from it into the Missiles row, which lights up. */
  missileIn(cell = null) {
    if (cell) this.fx.push({ kind: 'load', cell, age: 0.5, life: 1.9 });
    this.fx.push({ kind: 'ring', selector: '#panel .res.missile', age: cell ? -0.9 : 0, life: 2.2 });
  }

  // ---------- replays (the Controls panel): a demonstration on your own city, nothing changes ----------

  /** id: place | capital | workers | food | season | rotate | globe */
  demo(id) {
    this.replay = { id, age: 0, life: 4.4 };
    this.loop = 0;
    this.handKey = '';
    if (id === 'capital') {
      const e = this.api.economy();
      const doubled = e.perCell.find((p) => (p.triggers ?? 1) > 1 && !p.idle);
      if (doubled) this.#yield([doubled.x, doubled.z], doubled.terrain);
    }
    if (id === 'workers') {
      const e = this.api.economy();
      for (const p of e.perCell) if (WORKERS[p.terrain]) this.fx.push({ kind: 'socket', cell: [p.x, p.z], idle: Boolean(p.idle), age: -0.15 * this.fx.length, life: 2.6 });
    }
    if (id === 'food') {
      const e = this.api.economy();
      for (const p of e.perCell) {
        if (!p.food) continue;
        this.fx.push({ kind: 'token', cell: [p.x, p.z], res: 'food', n: p.food, age: -0.2 * this.fx.length, life: 2.2 });
      }
    }
  }

  #replayView() {
    const r = this.replay;
    if (!r) return null;
    if (r.id === 'place') {
      const i = this.hand.cards.findIndex((p) => !p.terrain.startsWith('wasteland') && !this.api.isAction?.(p.terrain));
      const k = i >= 0 ? i : this.hand.cards.findIndex((p) => p.terrain.startsWith('wasteland'));
      if (k < 0) return { ring: { selector: '#btnNext' } };
      const piece = this.hand.cards[k];
      const plan = PRODUCERS.has(piece.terrain) ? this.#plan({ id: 'apply' }, piece) : piece.terrain.startsWith('wasteland') ? this.#wastePlan(piece) : this.#anywhere(piece);
      this.plan = null;
      if (!plan) return null;
      return {
        marks: plan.legal,
        suggest: { terrain: piece.terrain, shape: piece.shape, rot: plan.rot, cells: plan.cells, joins: plan.joins },
        hand: { drag: k, to: plan.anchor },
      };
    }
    if (r.id === 'capital') {
      const legal = this.#aroundCapital();
      return { marks: legal, ring: null };
    }
    if (r.id === 'workers') return { ring: { selector: '#panel .res.mp' } };
    if (r.id === 'food') return { ring: { selector: '#panel .res.food' } };
    if (r.id === 'season') return { ring: { selector: '#btnNext' }, hand: { tapOn: '#btnNext' }, rings: ['#seasonClock'] };
    if (r.id === 'rotate') return this.rotateCueAt(this.api.cursor() ?? [0, 1]);
    if (r.id === 'globe') return { hand: { tapOn: '#btnWarMap' }, ring: { selector: '#btnWarMap' } };
    return null;
  }

  // ---------- every frame ----------

  /** Every frame: the guided step, a lesson or a replay decides what to show; the overlays follow. */
  update(time) {
    const raw = this.last === null ? 0 : Math.max(0, time - this.last);
    this.last = time;
    const dt = Math.min(0.1, raw); // animation (smooth even when frames are slow)
    const real = Math.min(0.5, raw); // timers: wall time, so a slow frame rate doesn't stretch a beat into a lock
    const blocked = document.body.matches(BOARD_BLOCKED) && !this.api.market();
    const shown = !blocked && document.visibilityState !== 'hidden';
    if (shown) this.clock += real;
    const v = this.api.view();
    if (v !== 'board') this.sawPlanet = true;
    // Home after a season that waited for you (main.js untilHome): the way home is learnt.
    const homeward = document.body.classList.contains('homeward');
    if (v === 'board' && this.prevView !== 'board' && this.wasHomeward) this.notify('home');
    if (v !== 'board') this.wasHomeward = homeward || (this.wasHomeward && this.api.settling());
    this.prevView = v;
    if (this.hand.piece !== this.heldPiece) {
      this.heldPiece = this.hand.piece;
      this.heldAt = this.clock;
    }
    if (v === 'board' && !this.active && shown) this.played += real;
    this.inRival = v === 'rival' ? this.inRival + real : 0;
    this.flash = Math.max(0, this.flash - dt);
    this.skipBtn.classList.toggle('hidden', !((this.active && this.index >= 0 && !blocked) || (!this.active && (this.hint || this.replay) && !blocked)));

    let view = null;
    if (this.replay) {
      this.replay.age += real;
      if (this.replay.age > this.replay.life) this.replay = null;
      else if (!blocked) view = this.#replayView();
    }
    if (!view && !blocked) view = this.active ? this.#guide() : this.#hints(real);
    this.#updateFx(dt, real);
    this.#draw(view ?? {}, time, dt);
    this.#drawForecast();
  }

  // ---------- contextual lessons ----------

  /** The lesson on screen (or the first that comes up), counted only while it's visible. */
  #hints(real) {
    if (!tutorialDone()) return null;
    const inMarket = Boolean(this.api.market());
    if (inMarket && this.hint && !this.hint.market) this.#endHint();
    const h = this.hint;
    if (h) {
      if (h.over?.()) {
        this.#endHint();
        return null;
      }
      const view = h.view();
      if (view && Object.keys(view).length) {
        h.seen += real;
        // Counted as shown once it has actually been on screen a moment (a hint hidden at once isn't used up).
        if (!h.counted && h.seen > 1) {
          h.counted = true;
          this.lessons.shown(h.id, this.played);
        }
      }
      if (h.seen >= h.until) this.#endHint();
      return view;
    }
    const settling = this.api.settling();
    this.idle = !settling && !inMarket && !this.hand.piece && this.api.view() === 'board' ? this.clock - this.lastInput : 0;
    this.nextCheck -= real;
    if (this.nextCheck > 0 || this.clock < (this.quietUntil ?? 0) || (settling && !document.body.classList.contains('homeward'))) return null;
    this.nextCheck = 0.3;
    for (const [id, lesson] of Object.entries(HINTS)) {
      if (inMarket !== Boolean(lesson.market)) continue;
      if (!this.lessons.ready(id, this.played)) continue;
      const made = lesson.make(this);
      if (!made) continue;
      this.hint = { id, seen: 0, counted: false, market: lesson.market, until: 8, ...made };
      this.loop = 0;
      this.handKey = '';
      this.gestured = false;
      this.lastInput = this.clock;
      return this.hint.view();
    }
    return null;
  }

  #endHint(done = false) {
    if (this.hint && !this.hint.counted && !done && this.hint.seen > 0.3) this.lessons.shown(this.hint.id, this.played);
    if (this.hint) this.quietUntil = this.clock + 4; // one lesson at a time, with a breath between them
    this.hint = null;
    this.hand.discarding = false;
    this.hand.render();
  }

  // ---------- drawing ----------

  #screen(x, y, z) {
    this.v.set(x, y, z).project(this.camera);
    return [(this.v.x * 0.5 + 0.5) * window.innerWidth, (-this.v.y * 0.5 + 0.5) * window.innerHeight];
  }

  #cellsCentre(cells, y = 0.05) {
    const world = cells.map(([x, z]) => hexToWorld(x, z));
    const cx = world.reduce((a, w) => a + w.x, 0) / cells.length;
    const cz = world.reduce((a, w) => a + w.z, 0) / cells.length;
    return this.#screen(cx, y, cz);
  }

  /** The part of the screen the board can be seen in (not under the HUD, the panel or the cards). */
  #safeRect() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const panel = r('#panel');
    const top = r('#top');
    const cards = [...document.querySelectorAll('#hand .card')].map((c) => c.getBoundingClientRect().top).filter((t) => t > H * 0.3);
    return {
      left: 40,
      right: panel && panel.width && panel.left > W * 0.4 ? panel.left - 20 : W - 20,
      top: (top?.bottom ?? 0) + 10,
      bottom: (cards.length ? Math.min(...cards) : H) - 14,
    };
  }

  #onScreen(cell) {
    if (this.api.view() !== 'board') return true;
    const [x, y] = this.#cellsCentre([cell]);
    const s = this.#safeRect();
    return x > s.left && x < s.right && y > s.top && y < s.bottom;
  }

  /** Keep what a lesson points at in view: the camera eases over to it (once per target, not fighting the player). */
  #keepInView(cells) {
    if (!cells?.length || this.api.view() !== 'board' || this.hand.dragging) return;
    const key = keyOf(cells);
    if (this.viewedKey === key) return;
    this.viewedKey = key;
    if (cells.every((c) => this.#onScreen(c))) return;
    const world = cells.map(([x, z]) => hexToWorld(x, z));
    this.api.focus(world.reduce((a, w) => a + w.x, 0) / world.length, world.reduce((a, w) => a + w.z, 0) / world.length);
  }

  /** Screen rectangle around the HUD elements of a selector, or null. */
  #hudRect(selector) {
    const rects = [...document.querySelectorAll(selector)]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width || r.height);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * Draws a view: { marks: legal cells, suggest: { terrain, shape, rot, cells, joins }, salient: piece, ring,
   * rings: [selectors], hand: { drag, to } | { tap: [x, y] } | { tapOn: selector } (once: one gesture only),
   * rotate: [x, z], discard: true, lines: [{ from, to }] }.
   */
  #draw(view, time, dt) {
    const calm = this.calm?.matches;
    if (view.suggest) this.#keepInView(view.suggest.cells);
    this.#drawMarks(view, time);
    this.#drawRings(view);

    // A salient card: the one to play now hops (once) and keeps a glow.
    const sal = view.salient ?? null;
    if (sal !== this.salient) {
      if (sal) this.hand.kick(sal);
      this.salient = sal;
      this.hand.salient = sal;
      this.hand.render();
    }
    this.#drawViewTokens(view.tokens);
    if (this.hand.discarding !== Boolean(view.discard)) {
      this.hand.discarding = Boolean(view.discard);
      this.hand.render();
    }

    // The ghost hand
    this.loop += dt;
    let pose = null;
    const h = view.hand;
    let lineTo = null;
    if (h) {
      const handKey = h.key ?? JSON.stringify({ ...h, once: undefined });
      if (handKey !== this.handKey) {
        this.handKey = handKey;
        this.loop = 0;
      }
      const len = h.drag !== undefined ? 2.2 : 1.5;
      if (h.once && this.loop > len) pose = null; // one gesture, then it rests
      else if (h.drag !== undefined) {
        const card = document.querySelector(`#hand .card[data-i="${h.drag}"]`);
        if (card) {
          const cr = card.getBoundingClientRect();
          const from = [cr.left + cr.width / 2, cr.top + Math.min(cr.height * 0.45, (window.innerHeight - cr.top) * 0.5)];
          const to = this.#cellsCentre([h.to]);
          pose = calm ? this.#stillDrag(from, to) : this.#dragPose(from, to);
          if (calm) lineTo = [from, to];
          // It carries the card's picture, or its symbol for action cards (a missile's ▲).
          const img = card.querySelector('.snap img');
          const glyph = img ? '' : (card.querySelector('.symbol')?.textContent ?? '');
          if (img && this.cardEl.getAttribute('src') !== img.getAttribute('src')) this.cardEl.src = img.src;
          this.cardEl.hidden = !img;
          if (this.glyphEl.textContent !== glyph) this.glyphEl.textContent = glyph;
        }
      } else if (h.tap) pose = calm ? this.#stillTap(h.tap) : this.#tapPose(h.tap);
      else if (h.tapOn) {
        const b = this.#hudRect(h.tapOn);
        if (b) {
          const at = [b.left + b.width * 0.5, b.top + b.height * 0.55];
          pose = calm ? this.#stillTap(at) : this.#tapPose(at);
        }
      }
    } else this.handKey = '';
    const el = this.handEl;
    el.classList.toggle('hidden', !pose);
    if (pose) {
      const tf = `translate(${(pose.x - HAND_TIP[0]).toFixed(1)}px, ${(pose.y - HAND_TIP[1]).toFixed(1)}px) scale(${pose.scale.toFixed(3)})`;
      if (el._tf !== tf) el.style.transform = el._tf = tf;
      el.style.opacity = pose.opacity.toFixed(3);
      this.cardEl.style.opacity = this.glyphEl.style.opacity = (pose.card ?? 0).toFixed(3);
      this.tapEl.style.opacity = (pose.tap ?? 0).toFixed(3);
      this.tapEl.style.transform = `scale(${(0.4 + (1 - (pose.tap ?? 0)) * 1.2).toFixed(3)})`;
    }

    // Rotation: the hex dial (with R and the right button) over the spot.
    this.rotateEl.classList.toggle('hidden', !view.rotate);
    if (view.rotate) {
      const r = hexToWorld(view.rotate[0], view.rotate[1]);
      const [x, y] = this.#screen(r.x, 0.6, r.z);
      const ro = this.rotateEl;
      const tf = `translate(${Math.round(x - ro.offsetWidth / 2)}px, ${Math.round(y - ro.offsetHeight - 24)}px)`;
      if (ro._tf !== tf) ro.style.transform = ro._tf = tf;
    }

    this.#drawLines(view, lineTo);
  }

  /** Forecast tokens a lesson keeps over a cell (hollow: what it would make, nothing earned yet). */
  #drawViewTokens(list) {
    const want = this.api.view() === 'board' ? (list ?? []) : [];
    this.viewTokens ??= [];
    while (this.viewTokens.length > want.length) this.viewTokens.pop().remove();
    want.forEach((tk, i) => {
      let el = this.viewTokens[i];
      const html = `<b>${tk.n > 0 ? '+' : ''}${tk.n}</b>${icon(tk.res)}${CLOCK_GLYPH}`;
      if (!el) {
        el = document.createElement('div');
        this.tokensEl.append(el);
        this.viewTokens.push(el);
      }
      if (el._html !== html) {
        el.innerHTML = el._html = html;
        el.className = `coach-token ghost ${tk.res}${tk.n < 0 ? ' neg' : ''}`;
      }
      const [x, y] = this.#cellsCentre([tk.cell], 1.0);
      this.#at(el, x, y - 18, 1, 1);
    });
  }

  /**
   * While a card is held over a legal cell: what placing it there would do, as hollow tokens over the cell (from the
   * economy with the card in place, so the forecast and the real season can't disagree). main.js calls it every
   * frame (with null when not placing). Nothing is earned or spent by looking.
   */
  forecast(cells, terrain, before, after) {
    const list = [];
    if (cells && after && before) {
      const [x, z] = cells[0];
      const per = after.perCell.find((p) => p.x === x && p.z === z);
      const res = RES_OF[terrain];
      if (per && !per.idle && PRODUCERS.has(terrain)) {
        const total = per[res];
        const parts = splitParts(total, per.triggers ?? 1);
        parts.forEach((n, i) => n && list.push({ cell: [x, z], res, n, dx: parts.length > 1 ? (i - (parts.length - 1) / 2) * 30 : 0 }));
      }
      if (BOOSTERS[terrain]) {
        const d = res === 'food' ? Math.round(after.foodBalance - before.foodBalance) : after.oil - before.oil;
        if (d) list.push({ cell: [x, z], res, n: d });
      }
      if (after.cap !== before.cap) list.push({ cell: [x, z], res: 'workers', n: after.cap - before.cap });
      const eat = Math.round(after.foodBalance - before.foodBalance);
      if (!PRODUCERS.has(terrain) && !BOOSTERS[terrain] && eat) list.push({ cell: [x, z], res: 'food', n: eat, dx: 30 });
      if (per?.idle) list.push({ cell: [x, z], res: 'idle', n: 0 });
    }
    this.forecastList = list;
  }

  #drawForecast() {
    const want = this.api.view() === 'board' ? (this.forecastList ?? []) : [];
    this.fcTokens ??= [];
    while (this.fcTokens.length > want.length) this.fcTokens.pop().remove();
    want.forEach((tk, i) => {
      let el = this.fcTokens[i];
      const html = tk.res === 'idle' ? NO_WORKER : `<b>${tk.n > 0 ? '+' : ''}${tk.n}</b>${icon(tk.res)}${tk.res === 'workers' ? '' : CLOCK_GLYPH}`;
      if (!el) {
        el = document.createElement('div');
        this.tokensEl.append(el);
        this.fcTokens.push(el);
      }
      if (el._html !== html) {
        el.innerHTML = el._html = html;
        el.className = `coach-token ghost ${tk.res}${tk.n < 0 ? ' neg' : ''}${tk.res === 'idle' ? ' socket bad' : ''}`;
      }
      const [x, y] = this.#cellsCentre([tk.cell], 1.1);
      this.#at(el, x + (tk.dx ?? 0) * 2.6, y - 26 - (tk.res === 'workers' ? 30 : 0) - (tk.res === 'idle' ? 30 : 0), 1, 1);
    });
  }

  /** Legal cells (solid outlines), the suggested spot (dotted outline, see-through model, shared edge). */
  #drawMarks(view, time) {
    const legal = this.api.view() === 'board' ? (view.marks ?? []) : [];
    const sug = this.api.view() === 'board' ? view.suggest : null;
    const key = `${keyOf(legal)}#${sug ? `${sug.terrain}:${sug.rot}:${keyOf(sug.cells)}` : ''}`;
    if (key !== this.marksKey) {
      this.marksKey = key;
      this.marks.clear();
      for (const [x, z] of legal) {
        const w = hexToWorld(x, z);
        const rim = new THREE.LineSegments(this.legalGeo, this.legalMat);
        rim.position.set(w.x, 0.035, w.z);
        rim.renderOrder = 5;
        const fill = new THREE.Mesh(this.fillGeo, this.fillMat);
        fill.position.set(w.x, 0.03, w.z);
        fill.renderOrder = 4;
        this.marks.add(fill, rim);
      }
      if (sug) {
        for (const [x, z] of sug.cells) {
          const w = hexToWorld(x, z);
          const dots = new THREE.LineSegments(hexOutline(0.97), this.dotMat);
          dots.computeLineDistances();
          dots.position.set(w.x, 0.045, w.z);
          dots.renderOrder = 6;
          this.marks.add(dots);
        }
        // The shared edge with the land it joins: where it attaches.
        if (sug.joins) {
          const [a, b] = sug.joins;
          const wa = hexToWorld(...a);
          const wb = hexToWorld(...b);
          const mx = (wa.x + wb.x) / 2;
          const mz = (wa.z + wb.z) / 2;
          const len = Math.hypot(wb.x - wa.x, wb.z - wa.z) || 1;
          const px = (-(wb.z - wa.z) / len) * (HEX_RADIUS / 2);
          const pz = ((wb.x - wa.x) / len) * (HEX_RADIUS / 2);
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(mx - px, 0.06, mz - pz), new THREE.Vector3(mx + px, 0.06, mz + pz)]);
          const edge = new THREE.Line(geo, this.edgeMat);
          edge.renderOrder = 7;
          this.marks.add(edge);
        }
      }
      // The see-through model of what goes there.
      const gk = sug ? `${sug.terrain}:${sug.shape}:${sug.rot}:${keyOf(sug.cells)}` : '';
      if (gk !== this.ghostKey) {
        this.ghostKey = gk;
        this.ghost?.removeFromParent();
        this.ghost = null;
        if (sug && this.factory) {
          const g = sug.terrain.startsWith('wasteland')
            ? this.factory.previewPiece(sug.shape, sug.rot ?? 0, 7)
            : this.factory.preview(sug.terrain, 0);
          if (g) {
            g.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = false;
              for (const m of [o.material].flat()) m.opacity = Math.min(m.opacity, 0.42);
            });
            const world = sug.cells.map(([x, z]) => hexToWorld(x, z));
            g.position.set(world.reduce((a, w) => a + w.x, 0) / world.length, 0.02, world.reduce((a, w) => a + w.z, 0) / world.length);
            this.ghost = g;
          }
        }
      }
      if (this.ghost) this.marks.add(this.ghost);
    }
    this.marks.visible = this.marks.children.length > 0;
    if (this.marks.visible) {
      const calm = this.calm?.matches;
      const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);
      this.legalMat.opacity = Math.min(1, 0.55 + 0.25 * pulse + this.flash);
      this.fillMat.opacity = Math.min(0.6, 0.08 + 0.06 * pulse + this.flash * 0.6);
      this.dotMat.opacity = 0.75 + 0.25 * pulse;
      this.edgeMat.opacity = 0.7 + 0.3 * pulse;
      if (this.ghost) this.ghost.position.y = 0.02 + (calm ? 0 : 0.05 * Math.sin(time * 2.2));
    }
  }

  #drawRings(view) {
    const r = view.ring;
    const hud = r?.selector ? this.#hudRect(r.selector) : null;
    this.ring.classList.toggle('hidden', !r || (!hud && !r.dim));
    if (r) {
      this.ring.classList.toggle('dim', Boolean(r.dim));
      this.ring.classList.toggle('alarm', Boolean(r.alarm));
      this.ring.classList.toggle('empty', !hud);
      if (hud) this.#place(this.ring, hud);
    }
    // Extra rings (several targets at once), plus the short-lived ones from demonstrations.
    const sels = [...(view.rings ?? []), ...this.fx.filter((f) => f.kind === 'ring' && f.age >= 0).map((f) => f.selector)];
    const rects = sels.flatMap((s) => [...document.querySelectorAll(s)].map((el) => el.getBoundingClientRect()).filter((b) => b.width));
    while (this.ringsEl.children.length < rects.length) {
      const d = document.createElement('div');
      d.className = 'coach-ring';
      this.ringsEl.append(d);
    }
    [...this.ringsEl.children].forEach((d, i) => {
      d.classList.toggle('hidden', i >= rects.length);
      if (i < rects.length) this.#place(d, rects[i]);
    });
  }

  #place(el, b, pad = 7) {
    const st = el.style;
    st.left = `${(b.left - pad).toFixed(1)}px`;
    st.top = `${(b.top - pad).toFixed(1)}px`;
    st.width = `${(b.width + pad * 2).toFixed(1)}px`;
    st.height = `${(b.height + pad * 2).toFixed(1)}px`;
  }

  /** Links and arrows in screen space (SVG): Capital → building, broken links, the still-hand's path. */
  #drawLines(view, still) {
    const parts = [];
    const onBoard = this.api.view() === 'board';
    for (const f of this.fx) {
      if (f.age < 0 || !onBoard) continue;
      if (f.kind === 'yield' && f.age < 2.4) {
        for (const cap of f.capitals ?? []) {
          const [ax, ay] = this.#cellsCentre([cap], 0.3);
          const [bx, by] = this.#cellsCentre([f.cell], 0.3);
          const k = clamp01(f.age / 0.45);
          const fade = f.age > 1.9 ? 1 - (f.age - 1.9) / 0.5 : 1;
          parts.push(
            `<line x1="${ax}" y1="${ay}" x2="${ax + (bx - ax) * k}" y2="${ay + (by - ay) * k}" class="cl-link" style="opacity:${fade.toFixed(2)}"/>`,
            `<circle cx="${(ax + bx) / 2}" cy="${(ay + by) / 2}" r="${(5 * k).toFixed(1)}" class="cl-joint" style="opacity:${fade.toFixed(2)}"/>`,
          );
        }
      }
      if (f.kind === 'broken') {
        const [ax, ay] = this.#cellsCentre(f.from, 0.1);
        const [bx, by] = this.#cellsCentre([f.to], 0.1);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const gx = (bx - ax) * 0.12;
        const gy = (by - ay) * 0.12;
        const o = (1 - clamp01((f.age - 1.1) / 0.5)).toFixed(2);
        parts.push(
          `<line x1="${ax}" y1="${ay}" x2="${mx - gx}" y2="${my - gy}" class="cl-broken" style="opacity:${o}"/>`,
          `<line x1="${mx + gx}" y1="${my + gy}" x2="${bx}" y2="${by}" class="cl-broken" style="opacity:${o}"/>`,
          `<path d="M${mx - 7} ${my - 9}l5 6-4 3 6 9" class="cl-break" style="opacity:${o}"/>`,
        );
      }
    }
    if (still) {
      const [[ax, ay], [bx, by]] = still;
      parts.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="cl-path"/>`);
    }
    // Where the suggested spot attaches: a bright bar on the shared edge with the land it joins.
    if (view.suggest?.joins && onBoard) {
      const [a, b] = view.suggest.joins;
      const wa = hexToWorld(...a);
      const wb = hexToWorld(...b);
      const len = Math.hypot(wb.x - wa.x, wb.z - wa.z) || 1;
      const px = (-(wb.z - wa.z) / len) * (HEX_RADIUS / 2) * 0.9;
      const pz = ((wb.x - wa.x) / len) * (HEX_RADIUS / 2) * 0.9;
      const mx = (wa.x + wb.x) / 2;
      const mz = (wa.z + wb.z) / 2;
      const [x1, y1] = this.#screen(mx - px, 0.08, mz - pz);
      const [x2, y2] = this.#screen(mx + px, 0.08, mz + pz);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="cl-edge"/>`);
    }
    // A dotted link from a free cell to the "?" site it would uncover.
    if (view.link && onBoard) {
      const [ax, ay] = this.#cellsCentre([view.link.from], 0.1);
      const [bx, by] = this.#cellsCentre([view.link.to], 0.1);
      parts.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="cl-path"/>`, `<circle cx="${bx}" cy="${by}" r="12" class="cl-site"/>`);
    }
    const html = parts.join('');
    if (html !== this.linesHtml) {
      this.lines.innerHTML = html;
      this.linesHtml = html;
    }
  }

  // ---------- short demonstrations (fx) ----------

  #updateFx(dt, real) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += real;
      if (f.age > f.life) {
        f.el?.remove();
        for (const t of f.tokens ?? []) t.remove();
        f.done?.();
        this.fx.splice(i, 1);
        continue;
      }
      if (f.age < 0) continue;
      if (f.kind === 'commission') this.#drawCommission(f);
      else if (f.kind === 'yield') this.#drawYield(f);
      else if (f.kind === 'check') this.#drawStamp(f);
      else if (f.kind === 'tribute') this.#drawTribute(f);
      else if (f.kind === 'socket') this.#drawSocket(f);
      else if (f.kind === 'token') this.#drawToken(f);
      else if (f.kind === 'crosses') this.#drawCrosses(f);
      else if (f.kind === 'load') this.#drawLoad(f);
      else if (f.kind === 'housing') this.#drawHousing(f);
    }
    if (!this.fx.some((f) => f.kind === 'commission' || f.kind === 'tribute')) {
      this.fillEl.classList.add('hidden');
      this.arcEl.classList.add('hidden');
    }
  }

  /** A DOM token on the coach layer (removed with its fx). */
  #token(f, html, cls = '') {
    const el = document.createElement('div');
    el.className = `coach-token ${cls}`;
    el.innerHTML = html;
    this.tokensEl.append(el);
    (f.tokens ??= []).push(el);
    return el;
  }

  #at(el, x, y, scale = 1, opacity = 1) {
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    el.style.opacity = clamp01(opacity).toFixed(3);
  }

  /**
   * The commission: the gauge fills (as a ghost) to its mark, the season clock sweeps to the tribute season, and a
   * barrel goes from the full gauge to the Overlord. Nothing is earned: the fill is hollow and fades.
   */
  #drawCommission(f) {
    const calm = this.calm?.matches;
    const t = f.age;
    const gauge = this.#hudRect('#quotaBarrels');
    if (gauge) {
      this.fillEl.classList.remove('hidden');
      this.#place(this.fillEl, gauge, 2);
      const k = calm ? 1 : ease(clamp01(t / 1.0));
      this.fillEl.style.setProperty('--k', k.toFixed(3));
      this.fillEl.style.opacity = (t > f.life - 0.5 ? (f.life - t) / 0.5 : 1).toFixed(2);
    }
    const clock = this.#hudRect('#seasonClock');
    if (clock) {
      this.arcEl.classList.remove('hidden');
      this.#place(this.arcEl, clock, 4);
      const season = this.api.season?.() ?? 0;
      const due = this.api.tributeSeason?.() ?? 3;
      const span = (((due - season + 4) % 4) || 4) * 25;
      const k = calm ? 1 : ease(clamp01((t - 0.5) / 0.9));
      const c = this.arcEl.querySelector('circle');
      c.style.strokeDasharray = `${(span * k).toFixed(1)} 100`;
      c.style.transform = `rotate(${season * 90 - 90}deg)`;
      this.arcEl.style.opacity = (t > f.life - 0.5 ? (f.life - t) / 0.5 : clamp01((t - 0.4) / 0.2)).toFixed(2);
    }
    // The barrel to the Overlord.
    const portrait = this.#hudRect('#top .top-overlord');
    if (gauge && portrait && t > 1.4) {
      const el = f.barrel ?? (f.barrel = this.#token(f, icon('oil'), 'ghost big'));
      const k = calm ? 1 : ease(clamp01((t - 1.4) / 0.8));
      const x0 = gauge.right - 10;
      const y0 = gauge.top + gauge.height / 2;
      const x1 = portrait.left + portrait.width / 2;
      const y1 = portrait.top + portrait.height / 2;
      this.#at(el, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 30, 1.2 - 0.3 * k, t > f.life - 0.3 ? (f.life - t) / 0.3 : 1);
    }
    if (portrait && t > 2.0 && !f.rang) {
      f.rang = true;
      this.fx.push({ kind: 'ring', selector: '#top .top-overlord', age: 0, life: 0.9 });
    }
  }

  #drawYield(f) {
    if (this.api.view() !== 'board') return;
    const calm = this.calm?.matches;
    const t = f.age;
    const [cx, cy] = this.#cellsCentre([f.cell], 0.9);
    // A worker takes its place (or the socket stays empty: no one free to run it).
    if (t > 0.35) {
      const w = f.worker ?? (f.worker = this.#token(f, f.idle ? NO_WORKER : icon('workers'), f.idle ? 'socket bad' : 'socket'));
      const k = clamp01((t - 0.35) / 0.25);
      this.#at(w, cx - 22, cy - 6, calm ? 1 : 0.6 + 0.4 * k, t > f.life - 0.6 ? (f.life - t) / 0.6 : k);
    }
    // Its output, one hollow token per trigger, apart in time: a forecast, earned when the season ends.
    f.parts.forEach((n, i) => {
      const t0 = 0.8 + i * 0.7;
      if (t < t0 || !n) return;
      const el = (f[`p${i}`] ??= this.#token(f, `<b>+${n}</b>${icon(f.res)}${CLOCK_GLYPH}`, `ghost ${f.res}`));
      const a = t - t0;
      const rise = calm ? 26 : 10 + 30 * ease(clamp01(a / 0.6));
      const fade = t > f.life - 0.5 ? (f.life - t) / 0.5 : clamp01(a / 0.15);
      const spread = (i - (f.parts.length - 1) / 2) * 84; // one token per trigger, side by side
      this.#at(el, cx + 18 + spread, cy - rise, 1, fade);
    });
    if (t > 2.3 && !f.rang) {
      f.rang = true;
      this.fx.push({ kind: 'ring', selector: f.res === 'food' ? '#panel .res.food' : '#panel .res.oil', age: 0, life: 1 });
      this.fx.push({ kind: 'ring', selector: '#panel .res.mp', age: 0, life: 1 });
    }
  }

  #drawStamp(f) {
    if (this.api.view() !== 'board') return;
    const [x, y] = this.#cellsCentre(f.cells, 0.6);
    const el = f.el ?? (f.el = this.#token(f, CHECK, 'check'));
    const k = clamp01(f.age / 0.18);
    this.#at(el, x, y - 16, this.calm?.matches ? 1 : 1.5 - 0.5 * k, f.age > f.life - 0.4 ? (f.life - f.age) / 0.4 : k);
  }

  #drawSocket(f) {
    if (this.api.view() !== 'board') return;
    const [x, y] = this.#cellsCentre([f.cell], 0.9);
    const el = f.el ?? (f.el = this.#token(f, f.idle ? NO_WORKER : icon('workers'), f.idle ? 'socket bad' : 'socket'));
    this.#at(el, x, y - 8, 1, f.age > f.life - 0.5 ? (f.life - f.age) / 0.5 : clamp01(f.age / 0.2));
  }

  #drawToken(f) {
    if (this.api.view() !== 'board') return;
    const [x, y] = this.#cellsCentre([f.cell], 0.9);
    const el = f.el ?? (f.el = this.#token(f, `<b>${f.n > 0 ? '+' : ''}${f.n}</b>${icon(f.res)}${CLOCK_GLYPH}`, `ghost ${f.res}${f.n < 0 ? ' neg' : ''}`));
    const rise = this.calm?.matches ? 18 : 6 + 20 * ease(clamp01(f.age / 0.6));
    this.#at(el, x, y - rise, 1, f.age > f.life - 0.5 ? (f.life - f.age) / 0.5 : clamp01(f.age / 0.2));
  }

  #drawCrosses(f) {
    if (this.api.view() !== 'board') return;
    f.els ??= f.cells.map(() => this.#token(f, '<i class="coach-x"></i>', 'cross'));
    f.cells.forEach((c, i) => {
      const [x, y] = this.#cellsCentre([c], 0.2);
      this.#at(f.els[i], x, y, 1, f.age > f.life - 0.4 ? (f.life - f.age) / 0.4 : 1);
    });
  }

  #drawHousing(f) {
    if (this.api.view() !== 'board') return;
    const calm = this.calm?.matches;
    const t = f.age;
    const [cx, cy] = this.#cellsCentre([f.cell], 0.9);
    const fade = t > f.life - 0.5 ? (f.life - t) / 0.5 : 1;
    if (t > 0.3 && f.slots) {
      const el = (f.w ??= this.#token(f, `<b>+${f.slots}</b>${icon('workers')}`, 'solid workers'));
      this.#at(el, cx - 46, cy - (calm ? 26 : 10 + 16 * ease(clamp01((t - 0.3) / 0.5))), 1, fade * clamp01((t - 0.3) / 0.15));
    }
    if (t > 1.0 && f.food) {
      const el = (f.e ??= this.#token(f, `<b>${f.food}</b>${icon('food')}${CLOCK_GLYPH}`, 'ghost food neg'));
      this.#at(el, cx + 56, cy - (calm ? 26 : 10 + 16 * ease(clamp01((t - 1.0) / 0.5))), 1, fade * clamp01((t - 1.0) / 0.15));
    }
    if (t > 0.5 && !f.rang) {
      f.rang = true;
      this.fx.push({ kind: 'ring', selector: '#panel .res.mp', age: 0, life: 1.1 });
      this.fx.push({ kind: 'ring', selector: '#panel .res.food', age: -0.7, life: 1.1 });
    }
  }

  /** The Magazine's missile: from the building up into the Missiles row (solid: it's real). */
  #drawLoad(f) {
    const row = this.#hudRect('#panel .res.missile .ico');
    if (!row || this.api.view() !== 'board') return;
    const el = f.el ?? (f.el = this.#token(f, document.querySelector('#panel .res.missile .ico')?.outerHTML ?? '', 'solid big missile'));
    const [x0, y0] = this.#cellsCentre([f.cell], 1.2);
    const x1 = row.left + row.width / 2;
    const y1 = row.top + row.height / 2;
    const k = this.calm?.matches ? 1 : ease(clamp01((f.age - 0.5) / 1.1));
    this.#at(el, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 50, 1.3 - 0.4 * k, f.age > f.life - 0.25 ? (f.life - f.age) / 0.25 : clamp01(f.age / 0.2));
  }

  /** The tribute: barrels leave the gauge for the Overlord, one after another; the portrait takes them in. */
  #drawTribute(f) {
    const gauge = this.#hudRect('#quotaBarrels');
    const portrait = this.#hudRect('#top .top-overlord');
    if (!gauge || !portrait) return;
    const calm = this.calm?.matches;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t0 = 0.15 + i * 0.16;
      if (f.age < t0) continue;
      const el = (f[`b${i}`] ??= this.#token(f, icon('oil'), 'solid big'));
      const k = calm ? 1 : ease(clamp01((f.age - t0) / 0.75));
      const x0 = gauge.left + ((i + 0.5) / n) * gauge.width;
      const y0 = gauge.top + gauge.height / 2;
      const x1 = portrait.left + portrait.width / 2;
      const y1 = portrait.top + portrait.height / 2;
      this.#at(el, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 26, 1.1 - 0.5 * k, k >= 1 ? 0 : 1);
    }
    if (!f.rang) {
      f.rang = true;
      this.fx.push({ kind: 'ring', selector: '#top .top-overlord', age: -0.6, life: 1.6 });
    }
  }

  // ---------- the ghost hand's motion ----------

  /** Press on the card, carry it over to the cell, let go; then a short pause. */
  #dragPose(from, to) {
    const t = this.loop % 2.2;
    const lerp = (k) => [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
    if (t < 0.2) return { x: from[0], y: from[1], scale: 1.15 - 0.15 * (t / 0.2), opacity: t / 0.2 };
    if (t < 0.35) return { x: from[0], y: from[1], scale: 1 - 0.12 * ((t - 0.2) / 0.15), opacity: 1, card: (t - 0.2) / 0.15 };
    if (t < 1.15) {
      const [x, y] = lerp(ease((t - 0.35) / 0.8));
      return { x, y, scale: 0.88, opacity: 1, card: 1 };
    }
    if (t < 1.3) return { x: to[0], y: to[1], scale: 0.88 + 0.12 * ((t - 1.15) / 0.15), opacity: 1, card: 1 - (t - 1.15) / 0.15, tap: 1 - (t - 1.15) / 0.15 };
    if (t < 1.6) return { x: to[0], y: to[1], scale: 1, opacity: 1 - (t - 1.3) / 0.3 };
    return null;
  }

  /** One press on the spot (a single click), then a pause. */
  #tapPose([x, y]) {
    const t = this.loop % 1.5;
    const p = clamp01(1 - Math.abs(t - 0.45) / 0.1); // 1 at the press
    const opacity = t < 0.2 ? t / 0.2 : t < 0.95 ? 1 : t < 1.2 ? 1 - (t - 0.95) / 0.25 : 0;
    if (!opacity) return null;
    const ring = t > 0.45 && t < 0.8 ? 1 - (t - 0.45) / 0.35 : 0;
    return { x, y, scale: 1 - 0.14 * p, opacity, tap: ring };
  }

  /** Reduced motion: the drag as two still frames (on the card, then on the cell), with a dotted path between. */
  #stillDrag(from, to) {
    const atCard = this.loop % 2.2 < 1.1;
    const [x, y] = atCard ? from : to;
    return { x, y, scale: 0.9, opacity: 1, card: 1, tap: atCard ? 0 : 0.6 };
  }

  #stillTap([x, y]) {
    return { x, y, scale: 0.92, opacity: 1, tap: 0.6 };
  }
}

// ---------- the contextual lessons ----------

const onBoard = (t) => t.api.view() === 'board';

/**
 * A card of the rival city's hand (`find(piece)`) onto one of their buildings: the hand drags it there until it's
 * played, or picked up (then the player has got it). The target is kept, so the hand doesn't jump as the camera eases.
 */
function aimHint(t, find, played) {
  const card = () => t.hand.cards.findIndex(find);
  if (t.api.view() !== 'rival' || t.inRival < 1.5 || t.hand.piece || card() < 0) return null;
  const to = t.api.rivalTarget();
  if (!to) return null;
  return {
    until: 8,
    view: () => (card() >= 0 && !t.hand.dragging ? { hand: { drag: card(), to } } : {}), // (aiming is drop only)
    over: () => t.api.view() !== 'rival' || card() < 0 || played(),
  };
}

/** The best free cell for a card by the economy's own forecast: { cell, gain, res } (gain over a plain spot), or null. */
const bestCache = new Map();
function bestCell(t, terrain) {
  const res = RES_OF[terrain];
  if (!res) return null;
  const { grid, mysteries } = t.api;
  const key = `${terrain}:${grid.size}:${t.seasonsPlayed}`;
  if (bestCache.has(key)) return bestCache.get(key);
  const base = t.api.economy();
  const score = (e) => (res === 'food' ? Math.round(e.foodBalance) : e.oil);
  let best = null;
  for (const k of grid.openKeys()) {
    const [x, z] = k.split(',').map(Number);
    if (mysteries.has(x, z) || hexDistance(x, z) > 8 || !t.legal({ terrain, shape: 'mono', rot: 0 }, [[x, z]])) continue;
    const s = score(t.api.economyIf(terrain, [[x, z]])) - score(base);
    if (!best || s > best.gain) best = { cell: [x, z], gain: s, res };
  }
  if (bestCache.size > 40) bestCache.clear();
  bestCache.set(key, best);
  return best;
}

/**
 * Each lesson: make(t) returns null (not now) or { until: seconds visible, view(), over() }. The first that comes up,
 * in this order, is shown. Doing it (prompted or not) completes it (Tutorial.notify).
 */
const HINTS = {
  // The season ended away from home: the oil is only gathered at Hive City. The way home, one press at a time.
  home: {
    make(t) {
      if (!document.body.classList.contains('homeward') || t.api.moving()) return null;
      return {
        until: 30,
        view: () => {
          if (t.api.moving()) return {};
          const sel = t.api.view() === 'rival' ? '#btnRivalBack' : '#btnHive';
          return { hand: { tapOn: sel }, ring: { selector: sel } };
        },
        over: () => !document.body.classList.contains('homeward'),
      };
    },
  },
  // The food runs out this season or the next (the same test settlement uses): the food row turns red, and the card
  // that fixes it (a Farm, a Water Pump, an Oasis) is shown where it does the most.
  food: {
    make(t) {
      if (!onBoard(t) || t.hand.dragging) return null;
      const e = t.api.economy();
      if (seasonsOfFood(e) > 1) return null;
      return {
        until: 10,
        view: () => {
          const fix = t.hand.cards.find((p) => ['farm', 'pump', 'oasis'].includes(p.terrain));
          const view = { ring: { selector: '#panel .res.food', alarm: true }, salient: fix ?? null };
          const best = fix && bestCell(t, fix.terrain);
          if (best?.gain > 0) {
            view.suggest = { terrain: fix.terrain, cells: [best.cell], joins: null };
            view.tokens = [{ cell: best.cell, res: 'food', n: best.gain }];
          }
          return view;
        },
        over: () => seasonsOfFood(t.api.economy()) > 1 || !onBoard(t),
      };
    },
  },
  // A worker building that would sit idle (no one free to run it), or one already idle: the worker rack, the empty
  // socket, and a Settlement (if in hand) with what it costs: +2 workers, food every season.
  workers: {
    make(t) {
      if (!onBoard(t)) return null;
      const e = t.api.economy();
      const held = t.hand.piece;
      const need = held && WORKERS[held.terrain] && e.free < WORKERS[held.terrain];
      if (!need && !e.idle) return null;
      return {
        until: 9,
        view: () => {
          const s = t.hand.cards.find((p) => p.terrain === 'settlement');
          const view = { ring: { selector: '#panel .res.mp', alarm: true }, salient: s ?? null };
          if (s && !t.hand.piece) {
            const at = bestSettlement(t);
            if (at) view.suggest = { terrain: 'settlement', cells: [at], joins: null };
          }
          return view;
        },
        over: () => !onBoard(t) || (t.api.economy().idle === 0 && !(t.hand.piece && WORKERS[t.hand.piece.terrain] && t.api.economy().free < WORKERS[t.hand.piece.terrain])),
      };
    },
  },
  // The military lesson, once the home loop is known. A Missile Magazine card first (a tutorial run deals one): its
  // missile loads into it. Then the War Map, a rival (all of them ringed: the cities to conquer), a missile card onto
  // one of their buildings, home again, and Next turn: the Magazine fires. The flight is held in the air (main.js
  // holdForFollow) while the hand leads back out to the War Map and into that city, where it comes down.
  war: {
    make(t) {
      if (!t.lessons.learnt('build') && !t.lessons.get('build').solo && t.seasonsPlayed < 2) return null;
      const card = () => t.hand.cards.findIndex((p) => p.terrain === 'magazine');
      // Missiles: in the silo, or out as cards in a rival city's hand.
      const armed = () => t.api.missiles() > 0 || t.hand.cards.some((p) => MISSILE_CARDS.has(p.terrain));
      const pending = card() >= 0 && !t.api.magazineAt();
      if (!pending && !armed() && !t.api.aimed() && !t.api.attacking()) return null;
      if (t.api.view() === 'board' && t.hand.piece && t.hand.piece.terrain !== 'magazine') return null;
      const tap = (sel) => ({ hand: { tapOn: sel }, ring: { selector: sel } });
      const node = (id) => `.globe-node[data-globe-node="${id}"]:not(.off)`;
      return {
        until: 120,
        view: () => {
          const v = t.api.view();
          if (t.api.moving()) return {};
          // In the air: follow it (the War Map, then the city it's aimed at), or watch the countdown.
          if (t.api.attacking()) {
            const to = t.api.following();
            if (!to) return { ring: { selector: '#warTimer' } };
            if (v === 'board') return { ...tap('#btnWarMap'), rings: ['#warTimer'] };
            if (v === 'rival') return t.api.rivalShownId() === to ? { ring: { selector: '#warTimer' } } : tap('#btnRivalBack');
            // The city it's aimed at; round the far side (nothing to point at), the view flies down to it after a moment.
            if (!document.querySelector(node(to))) return { ...t.flyTo(to), rings: ['#warTimer'] };
            t.flyAt = null;
            return { hand: { tapOn: node(to) }, rings: ['#warTimer'] };
          }
          // The Magazine card: placed like any building (off the Capital's sides, those are for producers).
          if (v === 'board' && card() >= 0 && !t.api.magazineAt()) {
            const p = t.hand.cards[card()];
            const at = bestSettlement(t);
            const view = { salient: p };
            if (at) {
              view.suggest = { terrain: 'magazine', cells: [at], joins: null };
              if (!t.hand.dragging && t.hand.piece !== p) view.hand = { drag: card(), to: at, once: true };
            }
            return view;
          }
          if (v === 'board') return t.api.aimed() ? tap('#btnNext') : { ...tap('#btnWarMap'), rings: ['#panel .res.missile'] };
          if (v === 'globe') {
            // Aimed: home to launch it from the Magazine. Not yet: a rival city (all of them ringed).
            if (t.api.aimed()) return tap('#btnHive');
            const n = rivalNode();
            if (!n) return { ...t.flyTo(t.api.rivalIds()[0]), rings: ['.globe-node:not(.off):not([data-globe-node="player"])'] };
            t.flyAt = null;
            return { hand: { tapOn: n }, rings: ['.globe-node:not(.off):not([data-globe-node="player"])'] };
          }
          // A rival city: aim, then home (the launch is at Hive City).
          if (t.api.aimedHere()) return tap('#btnRivalBack');
          const i = t.hand.cards.findIndex((p) => MISSILE_CARDS.has(p.terrain));
          if (i < 0 || t.inRival < 1.5 || t.hand.dragging) return {};
          t.aimAt ??= t.api.rivalTarget();
          if (!t.aimAt) return {};
          // Aiming is drag-and-drop only (a click on their tiles takes an aim back): the hand drags the card there.
          return { hand: { drag: i, to: t.aimAt } };
        },
        over: () => !(card() >= 0 && !t.api.magazineAt()) && !armed() && !t.api.aimed() && !t.api.attacking(),
        leave: () => t.api.letGo(),
      };
    },
  },
  // The Salvo card dealt among them: the hand drags it onto a building (it fans every missile around it).
  salvo: { make: (t) => aimHint(t, (p) => p.terrain === 'salvo', () => !t.hand.cards.some((p) => p.terrain === 'salvo')) },
  // Holding a piece of 2+ cells for a while without turning it: the 60° dial (or the rotate button, on touch).
  rotate: {
    make(t) {
      const piece = t.hand.piece;
      if (!onBoard(t) || !piece || (SHAPES[piece.shape]?.cells.length ?? 1) < 2 || !t.api.cursor()) return null;
      if (t.clock - t.heldAt < 3) return null; // holding it a while without turning it
      const rot = piece.rot;
      return { until: 5, view: () => t.rotateCueAt(t.api.cursor() ?? [0, 0]), over: () => t.hand.piece !== piece || piece.rot !== rot };
    },
  },
  // A "?" site you can reach from your land: the free cell beside it, and a dotted link to it.
  explore: {
    make(t) {
      if (!onBoard(t) || t.api.grid.expansionMode || t.seasonsPlayed < 1 || !t.hand.cards.length) return null;
      const cell = reachableSite(t);
      if (!cell) return null;
      return {
        until: 8,
        view: () => {
          const c = reachableSite(t);
          return c ? { marks: [c.cell], link: { from: c.cell, to: c.site } } : {};
        },
        over: () => !reachableSite(t),
      };
    },
  },
  // Pre-war Ruins: a building beside them lets you clear them (and the hand refills). Not clearable yet: a building card
  // shown going on a free cell next to them. Clearable: the hand presses their button, once.
  ruins: {
    make(t) {
      if (!onBoard(t) || t.hand.dragging || t.api.settling()) return null;
      const r = t.api.ruins();
      if (!r) return null;
      const card = t.hand.cards.findIndex((p) => !p.terrain.startsWith('wasteland') && !t.api.isAction(p.terrain));
      if (!r.clearable && card < 0) return null;
      return {
        until: 8,
        view: () => {
          const now = t.api.ruins();
          if (!now) return {};
          if (now.clearable) return { hand: { tapOn: '.ruin-btn', once: true }, ring: { selector: '.ruin-btn' } };
          const i = t.hand.cards.findIndex((p) => !p.terrain.startsWith('wasteland') && !t.api.isAction(p.terrain));
          if (i < 0) return {};
          const piece = t.hand.cards[i];
          const at = DIRS.map(([dx, dz]) => [now.cell[0] + dx, now.cell[1] + dz]).find((c) => t.legal(piece, [c]));
          if (!at) return {};
          return { salient: piece, suggest: { terrain: piece.terrain, cells: [at], joins: [now.cell, at] } };
        },
        over: () => !t.api.ruins(),
      };
    },
  },
  // A booster in hand (Water Pump, Oasis, Tar Pit, Refinery), or a producer that a booster on the board would help:
  // the best spot by the economy's own forecast, with the link to what it boosts.
  boost: {
    make(t) {
      if (!onBoard(t) || t.hand.dragging) return null;
      for (const p of t.hand.cards) {
        if (!BOOSTERS[p.terrain] && !(PRODUCERS.has(p.terrain) && hasBoosterOnBoard(t, p.terrain))) continue;
        const best = bestCell(t, p.terrain);
        if (!best || best.gain <= (PRODUCERS.has(p.terrain) ? 4 : 0)) continue;
        return {
          until: 8,
          view: () =>
            t.hand.cards.includes(p)
              ? { salient: p, suggest: { terrain: p.terrain, cells: [best.cell], joins: null }, tokens: [{ cell: best.cell, res: best.res, n: best.gain }] }
              : {},
          over: () => !t.hand.cards.includes(p),
        };
      }
      return null;
    },
  },
  // Every Wasteland down, and nothing happening for a while: Next turn (one press). The cards left over show they'd
  // be discarded: optional cards don't have to be played.
  next: {
    make(t) {
      if (!onBoard(t) || t.idle < 7 || t.hand.placeableForced.length) return null;
      return {
        until: 5,
        view: () => ({ hand: { tapOn: '#btnNext' }, ring: { selector: '#btnNext' }, discard: t.hand.cards.length > 0 }),
        over: () => Boolean(t.hand.piece) || t.hand.placeableForced.length > 0,
      };
    },
  },
  // Stuck: none of the cards in hand can do anything useful now, and a reroll is affordable: the reroll button, with
  // its oil cost leaving the stockpile (as a ghost).
  reroll: {
    make(t) {
      if (!onBoard(t) || t.idle < 10 || !t.api.canReroll()) return null;
      const e = t.api.economy();
      const cards = t.hand.cards.filter((p) => !p.terrain.startsWith('wasteland'));
      if (cards.length < 2) return null;
      const useless = (p) => (WORKERS[p.terrain] && e.free < WORKERS[p.terrain]) || !t.api.canPlay(p);
      if (!cards.every(useless)) return null;
      return {
        until: 5,
        view: () => ({ hand: { tapOn: '#btnReroll' }, ring: { selector: '#btnReroll' }, rings: ['#oilStock'] }),
        over: () => Boolean(t.hand.piece),
      };
    },
  },
  // The War Map never opened after a while of play: its button (it's how the planet and the rivals are reached).
  globe: {
    make(t) {
      if (t.sawPlanet || t.played < 60 || t.hand.piece || !onBoard(t)) return null;
      return { until: 5, view: () => ({ hand: { tapOn: '#btnWarMap' }, ring: { selector: '#btnWarMap' } }), over: () => t.sawPlanet };
    },
  },
  // The Smuggler's Crawler is at the gates, oil to spend, and the home loop well in hand (not right after the first
  // payout, not while the food is short): the plate pops in, then the hand taps it.
  market: {
    make(t) {
      if (!onBoard(t) || t.hand.piece || !t.api.marketReady() || t.seasonsPlayed < 3) return null;
      if (seasonsOfFood(t.api.economy()) <= 2) return null;
      t.api.revealMarket();
      let from = null;
      return {
        until: 6.2,
        view: () => {
          from ??= t.clock;
          const ring = { selector: '#btnBlackMarket' };
          if (t.clock - from < 0.75) return { ring };
          return { hand: { tapOn: '#btnBlackMarket' }, ring };
        },
        over: () => !onBoard(t) || !t.api.marketReady() || Boolean(t.hand.piece),
      };
    },
  },
  // Inside the Smuggler's hold, the first time there's something to afford: your oil (what he takes), an aisle, then
  // the hand looks over the cards you could afford, one by one (without choosing for you), each with its price coming
  // off your oil as a ghost. Buy what you like; once you have, Leave.
  marketTour: {
    market: true,
    make(t) {
      const m = t.api.market();
      if (!m || !(m.affordable.military.length || m.affordable.resource.length)) return null;
      let start = null;
      let boughtAt = null;
      const tap = (selector) => ({ hand: { tapOn: selector }, ring: { selector } });
      return {
        until: 90,
        view: () => {
          const m = t.api.market();
          if (!m) return {};
          start ??= t.clock;
          const age = t.clock - start;
          t.api.ghostPrice?.(null);
          if (age < 2) return { ring: { selector: '#bmOil', dim: true } };
          if (m.bought) {
            boughtAt ??= t.clock;
            return tap('#btnBmLeave');
          }
          const counts = { military: m.affordable.military.length, resource: m.affordable.resource.length };
          if (!m.aisle) return tap(`#bmCards .bm-aisle[data-cat="${counts.resource >= counts.military ? 'resource' : 'military'}"]`);
          const list = m.affordable[m.aisle];
          if (!list.length) return tap('#btnBmBack');
          // Looking them over: the hand rests on each affordable card in turn, its price shown off your oil.
          const i = list[Math.floor((age - 2) / 1.6) % list.length];
          t.api.ghostPrice?.(i);
          const sel = `#bmCards .shop-item:nth-child(${i + 1})`;
          const b = document.querySelector(`${sel} .card`)?.getBoundingClientRect();
          return b ? { hand: { tap: [b.left + b.width / 2, b.top + b.height * 0.4], key: `bm${i}` }, ring: { selector: sel } } : {};
        },
        over: () => !t.api.market() || (boughtAt !== null && t.clock - boughtAt > 4.4),
      };
    },
  },
};

/** The visible rival city on the planet nearest the middle of the screen (its label's selector), or null. */
function rivalNode() {
  let best = null;
  let bestD = Infinity;
  for (const el of document.querySelectorAll('.globe-node:not(.off)')) {
    if (el.dataset.globeNode === 'player') continue;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - window.innerWidth / 2, r.top + r.height / 2 - window.innerHeight / 2);
    if (d < bestD) {
      bestD = d;
      best = el.dataset.globeNode;
    }
  }
  return best ? `.globe-node[data-globe-node="${best}"]` : null;
}

/** A free cell beside a "?" site that touches your land (any card placed there uncovers it), or null. */
function reachableSite(t) {
  const { grid, mysteries } = t.api;
  let best = null;
  for (const s of mysteries.sites.values()) {
    for (const [dx, dz] of DIRS) {
      const x = s.x + dx;
      const z = s.z + dz;
      if (grid.has(x, z) || !grid.allowed(x, z) || mysteries.has(x, z) || !grid.touchesIsland(x, z)) continue;
      const d = hexDistance(x, z);
      if (!best || d < best.d) best = { cell: [x, z], site: [s.x, s.z], d };
    }
  }
  return best;
}

/** A booster on the board that a producer card of this kind could stand next to. */
function hasBoosterOnBoard(t, terrain) {
  for (const c of t.api.grid.cells.values()) if (BOOSTERS[c.terrain] === terrain) return true;
  return false;
}

/** Where a Settlement goes: a free cell touching the land, off the Capital's sides (those are for producers). */
function bestSettlement(t) {
  const { grid, mysteries } = t.api;
  let best = null;
  for (const k of grid.openKeys()) {
    const [x, z] = k.split(',').map(Number);
    if (mysteries.has(x, z) || hexDistance(x, z) <= 1) continue;
    const d = hexDistance(x, z);
    if (!best || d < best.d) best = { cell: [x, z], d };
  }
  return best?.cell ?? null;
}

// Small helpers the lessons call on the tutorial (kept public so the lesson table stays outside the class).
/** Whether `cells` is a legal spot for `piece` by the game's rules (placement.validate is pure). */
Tutorial.prototype.legal = function (piece, cells) {
  const p = this.api.placement;
  const keep = p.piece;
  p.piece = piece;
  const ok = p.validate(cells).ok;
  p.piece = keep;
  return ok;
};
/** Rotation, for the input in use: the 60° dial with R and the right button, or a tap on the rotate button (touch). */
Tutorial.prototype.rotateCueAt = function (cell) {
  if (this.api.modality() === 'touch') return { hand: { tapOn: '#btnRotate' }, ring: { selector: '#btnRotate' } };
  return { rotate: cell };
};
/** A city that isn't on this side of the planet: after a moment the view flies to it (nothing to point at). */
Tutorial.prototype.flyTo = function (id, after = 2.5) {
  this.flyAt ??= this.clock;
  if (this.clock - this.flyAt > after) {
    this.flyAt = null;
    this.api.visit(id);
  }
  return {};
};
