import * as THREE from 'three';
import { SHAPES, pieceOffsets, ROTATIONS } from './pieces.js';
import { DIRS, hexToWorld, hexDistance } from './grid.js';
import { hexPlane, hexOutline } from './hexGeometry.js';
import { L, onLangChange } from './i18n.js';
import { NEON } from './neonGlow.js';

/**
 * The tutorial, without any text. On a first game, Year 1's first Spring is guided once the Overlord's opening scene
 * is over: a spotlight on the tribute, then a ghost hand drags each card of the opening hand onto the board (the
 * Farm and the Station onto the glowing cells next to the Capital, where "×2" pops), short spotlights show workers
 * and food, the Wasteland is laid as a path to the nearest "?" site (which uncovers it), and the hand taps Next turn. From then on the game is free, and a few things get a one-time wordless
 * hint the first time they come up (HINTS): rotating a piece, "?" sites, food running out, rerolling, Next turn.
 *
 * main.js owns the game; it calls allows() before every player action, notify() when something happens,
 * and update() every frame. The tutorial calls back into main.js only through the `api` object.
 */

// Versioned: bumping it (v4, v5...) makes every player get the guided Spring once more on the next release.
export const TUTORIAL_KEY = 'oto.tutorialDone.v3';
/** The one-time hints already shown (a JSON list of HINTS ids). */
export const HINTS_KEY = 'oto.hintsSeen.v1';

export const tutorialDone = () => localStorage.getItem(TUTORIAL_KEY) === '1';
export const markTutorialDone = () => localStorage.setItem(TUTORIAL_KEY, '1');

const TRIBUTE = '#top .bar, #quotaCount';
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const BOOST = { farm: css(NEON.farm), station: css(NEON.station) };

/**
 * The guided Spring. Each step:
 *   wait     what moves it on: place, endTurn, time (a spotlight that moves on by itself after `ms`), end
 *   target   spotlight: CSS selector(s) for the HUD, 'capital' (the free cells next to the Capital glow) or 'site'
 *            (the nearest "?" site; the step is skipped when there's none to lead to)
 *   dim      darken everything but the target; alarm: (api) => true makes the spotlight pulse red
 *   terrain  place steps: the card to play ('wasteland' matches any Wasteland)
 *   cells    place steps: 'capital' (only the free cells next to the Capital), 'site' (the Wasteland card laid
 *            toward the "?" site: touching it if it can reach, otherwise as close as it gets), or none (anywhere)
 *   pop      place steps: a badge that pops over the tile once placed ({ text, colour })
 */
const STEPS = [
  { wait: 'time', ms: 2600, dim: true, target: TRIBUTE },
  { wait: 'time', ms: 2800, target: 'capital', focus: [0, 0] },
  { wait: 'place', terrain: 'farm', cells: 'capital', pop: { text: '×2', colour: BOOST.farm } },
  { wait: 'place', terrain: 'station', cells: 'capital', pop: { text: '×2', colour: BOOST.station } },
  { wait: 'place', terrain: 'settlement' },
  { wait: 'time', ms: 2000, dim: true, target: '#panel .res.mp' },
  { wait: 'time', ms: 2200, dim: true, target: '#panel .res.food', alarm: (api) => api.economy().foodBalance < 0 },
  { wait: 'time', ms: 3400, target: 'site' }, // longer: the camera pans over to it first
  { wait: 'place', terrain: 'wasteland', cells: 'site' },
  { wait: 'place', terrain: 'wasteland', cells: 'site' },
  { wait: 'endTurn', target: '#btnNext' },
  { wait: 'end' },
];

const matches = (step, terrain) =>
  step.terrain === 'wasteland' ? terrain?.startsWith('wasteland') : terrain === step.terrain;
const keyOf = (cells) => cells.map(([x, z]) => `${x},${z}`).join('|');
const setKey = (cells) => keyOf(cells).split('|').sort().join('|'); // the same cells in any order

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

// Rotate: the R key, or the right mouse button, turns the piece.
const ROTATE_ICONS = `
  <span class="coach-key">R</span>
  <svg class="coach-turn" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20 3v6h-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <svg class="coach-mouse" viewBox="0 0 24 34" aria-hidden="true"><rect x="2" y="2" width="20" height="30" rx="10" fill="#1d2326" stroke="#e8d9b8" stroke-width="2"/><path d="M12 2v12M2 14h20" stroke="#e8d9b8" stroke-width="2"/><path d="M13 3.2a9 9 0 0 1 7.8 9.8H13z" fill="#ffb347"/></svg>`;

const SKIP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l9 7-9 7zM13 5l9 7-9 7z" fill="currentColor"/><rect x="21" y="5" width="2.4" height="14" fill="currentColor"/></svg>`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export class Tutorial {
  active = false; // the guided Spring is on (from the reset until its Next turn)
  index = -1; // -1: the opening scene is still playing

  /** api: { grid, placement, mysteries, economy(), stores(), cursor(), focus(x, z), skip() } */
  constructor({ root, scene, camera, hand, api }) {
    this.root = root;
    this.camera = camera;
    this.hand = hand;
    this.api = api;
    root.innerHTML = `
      <div class="coach-ring hidden"></div>
      <div class="coach-hand hidden"><img class="coach-hand-card" alt="" />${GLOVE}<span class="coach-tap"></span></div>
      <div class="coach-rotate hidden">${ROTATE_ICONS}</div>
      <button type="button" class="coach-skip hidden">${SKIP_ICON}</button>`;
    this.ring = root.querySelector('.coach-ring');
    this.handEl = root.querySelector('.coach-hand');
    this.cardEl = root.querySelector('.coach-hand-card');
    this.tapEl = root.querySelector('.coach-tap');
    this.rotateEl = root.querySelector('.coach-rotate');
    this.skipBtn = root.querySelector('.coach-skip');
    this.skipBtn.addEventListener('click', () => this.api.skip());
    this.skipBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.#labels();
    onLangChange(() => this.#labels());

    // Glowing cells on the board.
    this.marks = new THREE.Group();
    this.marks.visible = false;
    scene.add(this.marks);
    this.markGeo = hexPlane(0.92);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xe8bf68, transparent: true, opacity: 0.5, depthWrite: false });
    this.edgeGeo = hexOutline(0.98);
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true });
    this.marksKey = '';
    this.v = new THREE.Vector3();
    this.pops = []; // badges over just-placed buildings: { el, cells, age }
    this.elapsed = 0; // seconds the current step (or hint) has been on screen, not counting dialogues, payouts...
    this.loop = 0; // seconds into the ghost hand's loop
    this.handKey = ''; // what the hand is showing: a new target restarts its loop
    this.last = null;
    this.flash = 0; // a refused move: the marks flash brighter for a moment
    this.cells = null; // the current place step's allowed cells (null: anywhere)
    this.hint = null; // the one-time hint on screen: { id, until, ... }
    this.idle = 0; // seconds with an empty hand (the Next turn hint)
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]'));
    } catch {
      this.seen = new Set();
    }
  }

  /** No visible text: the skip button only has a name for screen readers. */
  #labels() {
    this.skipBtn.setAttribute('aria-label', L('Skip tutorial', '跳过教程'));
  }

  get step() {
    return this.index >= 0 ? STEPS[this.index] : null;
  }

  /** A new run with the guided Spring: gate everything until begin() (after the opening scene). */
  start() {
    this.active = true;
    this.index = -1;
    this.seen.clear(); // a replayed tutorial shows the hints again too
    localStorage.removeItem(HINTS_KEY);
  }

  /** The opening scene is over: the guiding starts. */
  begin() {
    if (!this.active) return;
    this.#go(0);
  }

  stop() {
    this.active = false;
    this.index = -1;
    this.hint = null;
    for (const p of this.pops) p.el.remove();
    this.pops = [];
  }

  /** May the player do this right now? action: select | rotate | place | endTurn | reroll (anything else: no). */
  allows(action, payload) {
    if (!this.active) return true;
    const s = this.step;
    if (!s) return false;
    if (action === 'select') return s.wait === 'place' && matches(s, payload?.terrain) && (!this.plan || payload === this.plan.piece);
    if (action === 'rotate') return s.wait === 'place';
    if (action === 'place')
      return s.wait === 'place' && matches(s, payload.piece?.terrain) && (!this.cells || payload.cells.every(([x, z]) => this.cells.some((c) => c[0] === x && c[1] === z)));
    if (action === 'endTurn') return s.wait === 'endTurn';
    return false;
  }

  /** Placement rule while guiding: only the glowing cells (null = no objection; no message, they flash). */
  placeGuard(cells, piece) {
    if (!this.active || !piece) return null;
    if (this.allows('place', { cells, piece })) return null;
    this.nudge();
    return { ok: false, reason: '' };
  }

  /** Something happened in the game: placed (with the cells it covers) | endTurn. */
  notify(event, cells = null) {
    if (event === 'placed' && this.hint?.endsOnPlace) this.hint.until = 0;
    const s = this.step;
    if (!this.active || !s) return;
    const done = (s.wait === 'place' && event === 'placed') || s.wait === event;
    if (!done) return;
    if (s.pop && cells) this.#pop(cells, s.pop);
    this.#go(this.index + 1);
  }

  /** The player tried something not allowed yet: the hand shows it again and the target flashes. */
  nudge() {
    if (!this.step) return;
    this.loop = 0;
    this.flash = 0.5;
    for (const el of [this.handEl, this.ring]) {
      el.classList.remove('nudge');
      void el.offsetWidth;
      el.classList.add('nudge');
    }
  }

  #go(i) {
    this.index = Math.min(i, STEPS.length - 1);
    const s = this.step;
    this.elapsed = 0;
    this.loop = 0;
    if (s.wait === 'end') {
      markTutorialDone();
      this.stop();
      return;
    }
    this.cells = s.cells === 'capital' ? this.#aroundCapital() : null;
    if (s.cells === 'capital' && !this.cells.length) this.cells = null; // nowhere next to it: anywhere will do
    this.plan = null;
    if (s.target === 'site' || s.cells === 'site') {
      // The site to lead to: the nearest one. Once uncovered, the rest of the Wasteland goes anywhere.
      if (s.target === 'site') this.site = this.#nearestSite();
      else if (this.site && !this.api.mysteries.has(...this.site)) this.site = null;
      if (s.target === 'site' && !this.site) return this.#go(this.index + 1);
      if (s.cells === 'site' && this.site && this.api.mysteries.has(...this.site)) {
        this.plan = this.#pathPlan(this.site);
        this.cells = this.plan?.cells ?? null;
      }
      if (this.site) {
        this.api.mysteries.spare(...this.site);
        const w = hexToWorld(...this.site);
        this.api.focus(w.x / 2, w.z / 2); // between the Capital and the site
      }
    }
    if (s.focus) this.api.focus(...s.focus);
  }

  /** The "?" site nearest the Capital (free placement only: in expansion mode sites open with their plot). */
  #nearestSite() {
    const { grid, mysteries } = this.api;
    if (grid.expansionMode) return null;
    let best = null;
    for (const s of mysteries.sites.values()) if (!best || hexDistance(s.x, s.z) < hexDistance(...best)) best = [s.x, s.z];
    return best;
  }

  /**
   * Where a Wasteland card of the hand goes to lead toward the site: every rotation and spot it could legally take,
   * scored by how close it gets (touching it uncovers it), then by not needing a turn and leaving the Capital's
   * sides free. { piece, rot, anchor (the cell the pointer goes to), cells } or null.
   */
  #pathPlan([sx, sz]) {
    const { grid, mysteries } = this.api;
    const free = (x, z) => !grid.has(x, z) && grid.allowed(x, z) && !mysteries.has(x, z);
    let best = null;
    for (const piece of this.hand.cards) {
      if (!piece.terrain.startsWith('wasteland') || !SHAPES[piece.shape]) continue;
      for (let rot = 0; rot < ROTATIONS; rot++) {
        const offsets = pieceOffsets({ shape: piece.shape, rot });
        for (let ax = sx - 5; ax <= sx + 5; ax++) {
          for (let az = sz - 5; az <= sz + 5; az++) {
            const cells = offsets.map(([ox, oz]) => [ax + ox, az + oz]);
            if (!cells.every(([x, z]) => free(x, z)) || !cells.some(([x, z]) => grid.touchesIsland(x, z))) continue;
            const reach = Math.min(...cells.map(([x, z]) => hexDistance(x, z, sx, sz)));
            const sides = cells.filter(([x, z]) => hexDistance(x, z) === 1).length;
            const score = reach * 10 + (rot === (piece.rot ?? 0) ? 0 : 1) + sides * 3;
            if (!best || score < best.score) best = { score, piece, rot, anchor: [ax, az], cells };
          }
        }
      }
    }
    return best;
  }

  /** The free cells you could build on next to the Capital. */
  #aroundCapital() {
    const { grid, mysteries } = this.api;
    return DIRS.map(([dx, dz]) => [dx, dz]).filter(([x, z]) => !grid.has(x, z) && grid.allowed(x, z) && !mysteries.has(x, z));
  }

  /** A free cell touching the land, away from the Capital (where the hand suggests an anywhere card goes). */
  #suggestCell() {
    const { grid, mysteries } = this.api;
    let best = null;
    let bestD = -1;
    for (const c of grid.cells.values()) {
      for (const [dx, dz] of DIRS) {
        const x = c.x + dx;
        const z = c.z + dz;
        if (grid.has(x, z) || !grid.allowed(x, z) || mysteries.has(x, z)) continue;
        const d = hexDistance(x, z) + (DIRS.some(([a, b]) => a === x && b === z) ? -5 : 0); // keep the Capital's sides free
        if (d > bestD || (d === bestD && x + z < best[0] + best[1])) {
          best = [x, z];
          bestD = d;
        }
      }
    }
    return best;
  }

  /** A badge ("×2") that rises over the cells and fades. */
  #pop(cells, { text, colour }) {
    const el = document.createElement('div');
    el.className = 'coach-pop';
    el.textContent = text;
    el.style.setProperty('--pop', colour);
    this.root.append(el);
    this.pops.push({ el, cells, age: 0 });
  }

  /** Screen position of a point on the board. */
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

  /** Screen rectangle around the HUD elements of a selector, or null. */
  #hudRect(selector) {
    const rects = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /** Every frame: the guided step or a hint decides what to show; the spotlight, hand, icons and badges follow. */
  update(time) {
    const dt = this.last === null ? 0 : Math.min(0.1, time - this.last);
    this.last = time;
    this.#updatePops(dt);
    const blocked = document.body.matches(BOARD_BLOCKED);
    this.skipBtn.classList.toggle('hidden', !(this.active && this.step && !blocked));
    this.flash = Math.max(0, this.flash - dt);
    let view = null;
    if (!blocked) view = this.active ? this.#guide(dt) : this.#hints(dt);
    this.#draw(view ?? {}, time, dt);
  }

  /** The guided Spring: what the current step shows (and moving on when it's done by itself). */
  #guide(dt) {
    const s = this.step;
    if (!s || s.wait === 'end') return null;
    this.elapsed += dt;
    if (s.wait === 'time' && this.elapsed * 1000 >= s.ms) {
      this.#go(this.index + 1);
      return null;
    }
    if (s.wait === 'place') {
      // The card isn't in the hand (or the Wasteland fits nowhere): nothing to guide, move on.
      const i = this.plan ? this.hand.cards.indexOf(this.plan.piece) : this.hand.cards.findIndex((p) => matches(s, p.terrain));
      const stuck = s.terrain === 'wasteland' && !this.hand.placeableForced.some((p) => matches(s, p.terrain));
      if (i < 0 || stuck) {
        this.#go(this.index + 1);
        return null;
      }
      const to = this.plan?.anchor ?? this.cells?.[0] ?? this.#suggestCell();
      const held = this.hand.piece && matches(s, this.hand.piece.terrain);
      const view = { marks: this.cells };
      if (!to) return view;
      // Held the wrong way round for the glowing cells: R / right-click.
      const turned = held && this.plan && setKey(pieceOffsets(this.hand.piece)) !== setKey(pieceOffsets({ shape: this.plan.piece.shape, rot: this.plan.rot }));
      if (turned) view.rotate = to;
      else if (!held) view.hand = { drag: i, to };
      else if (!this.hand.dragging && this.cells) view.hand = { tap: this.#cellsCentre([to]), key: `cell${to}` };
      return view;
    }
    const onBoard = s.target === 'capital' || s.target === 'site';
    const target = onBoard ? null : s.target;
    const view = { marks: s.target === 'capital' ? this.#aroundCapital() : s.target === 'site' ? [this.site] : null };
    if (target) view.ring = { selector: target, dim: s.dim, alarm: s.alarm?.(this.api) };
    else if (s.dim) view.ring = { dim: true };
    if (s.wait === 'endTurn') view.hand = { tapOn: target };
    return view;
  }

  /** One-time hints in free play: the first that comes up is shown for a while, then never again. */
  #hints(dt) {
    if (!tutorialDone()) return null;
    const h = this.hint;
    if (h) {
      h.until -= dt;
      if (h.until > 0 && !h.over?.()) return h.view();
      this.hint = null;
      return null;
    }
    this.idle = this.hand.isEmpty ? this.idle + dt : 0;
    this.check = (this.check ?? 0) - dt;
    if (this.check > 0) return null;
    this.check = 0.25;
    for (const [id, make] of Object.entries(HINTS)) {
      if (this.seen.has(id)) continue;
      const hint = make(this);
      if (!hint) continue;
      this.seen.add(id);
      localStorage.setItem(HINTS_KEY, JSON.stringify([...this.seen]));
      this.hint = { id, ...hint };
      this.loop = 0;
      return this.hint.view();
    }
    return null;
  }

  /** Draws a view: { marks: cells, ring: { selector, dim, alarm }, hand: { drag: cardIndex, to } | { tap: [x, y] } | { tapOn: selector }, rotate: [x, z] }. */
  #draw(view, time, dt) {
    // Glowing cells
    const key = view.marks ? keyOf(view.marks) : '';
    if (key !== this.marksKey) {
      this.marksKey = key;
      this.marks.clear();
      for (const [x, z] of view.marks ?? []) {
        const w = hexToWorld(x, z);
        const plate = new THREE.Mesh(this.markGeo, this.markMat);
        plate.position.set(w.x, 0.03, w.z);
        plate.renderOrder = 5;
        const edge = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
        edge.position.set(w.x, 0.04, w.z);
        this.marks.add(plate, edge);
      }
    }
    this.marks.visible = this.marks.children.length > 0;
    if (this.marks.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      this.markMat.opacity = Math.min(0.95, 0.25 + 0.35 * pulse + this.flash * 1.2);
      this.edgeMat.opacity = 0.6 + 0.4 * pulse;
    }

    // Spotlight on the HUD
    const r = view.ring;
    const hud = r?.selector ? this.#hudRect(r.selector) : null;
    this.ring.classList.toggle('hidden', !r || (!hud && !r.dim));
    if (r) {
      this.ring.classList.toggle('dim', Boolean(r.dim));
      this.ring.classList.toggle('alarm', Boolean(r.alarm));
      this.ring.classList.toggle('empty', !hud);
      if (hud) {
        const pad = 8;
        const st = this.ring.style;
        st.left = `${(hud.left - pad).toFixed(1)}px`;
        st.top = `${(hud.top - pad).toFixed(1)}px`;
        st.width = `${(hud.width + pad * 2).toFixed(1)}px`;
        st.height = `${(hud.height + pad * 2).toFixed(1)}px`;
      }
    }

    // The ghost hand
    this.loop += dt;
    let pose = null;
    const h = view.hand;
    if (h) {
      const handKey = h.key ?? JSON.stringify(h);
      if (handKey !== this.handKey) {
        this.handKey = handKey;
        this.loop = 0;
      }
      if (h.drag !== undefined) {
        const card = document.querySelector(`#hand .card[data-i="${h.drag}"]`);
        if (card) {
          const cr = card.getBoundingClientRect();
          const from = [cr.left + cr.width / 2, cr.top + Math.min(cr.height * 0.45, (window.innerHeight - cr.top) * 0.5)];
          pose = this.#dragPose(from, this.#cellsCentre([h.to]));
          const img = card.querySelector('img');
          if (img && this.cardEl.getAttribute('src') !== img.getAttribute('src')) this.cardEl.src = img.src;
        }
      } else if (h.tap) pose = this.#tapPose(h.tap);
      else if (h.tapOn) {
        const b = this.#hudRect(h.tapOn);
        if (b) pose = this.#tapPose([b.left + b.width * 0.5, b.top + b.height * 0.55]);
      }
    } else this.handKey = '';
    const el = this.handEl;
    el.classList.toggle('hidden', !pose);
    if (pose) {
      const tf = `translate(${(pose.x - HAND_TIP[0]).toFixed(1)}px, ${(pose.y - HAND_TIP[1]).toFixed(1)}px) scale(${pose.scale.toFixed(3)})`;
      if (el._tf !== tf) el.style.transform = el._tf = tf;
      el.style.opacity = pose.opacity.toFixed(3);
      this.cardEl.style.opacity = (pose.card ?? 0).toFixed(3);
      this.tapEl.style.opacity = (pose.tap ?? 0).toFixed(3);
      this.tapEl.style.transform = `scale(${(0.4 + (1 - (pose.tap ?? 0)) * 1.2).toFixed(3)})`;
    }

    // Rotate icons over a cell
    this.rotateEl.classList.toggle('hidden', !view.rotate);
    if (view.rotate) {
      const r = hexToWorld(view.rotate[0], view.rotate[1]);
      const [x, y] = this.#screen(r.x, 0.6, r.z);
      const ro = this.rotateEl;
      const tf = `translate(${Math.round(x - ro.offsetWidth / 2)}px, ${Math.round(y - ro.offsetHeight - 24)}px)`;
      if (ro._tf !== tf) ro.style.transform = ro._tf = tf;
    }
  }

  /** Press on the card, carry it over to the cell, let go; then a short pause. */
  #dragPose(from, to) {
    const t = this.loop % 3.1;
    const lerp = (k) => [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
    if (t < 0.3) return { x: from[0], y: from[1], scale: 1.15 - 0.15 * (t / 0.3), opacity: t / 0.3 };
    if (t < 0.5) return { x: from[0], y: from[1], scale: 1 - 0.12 * ((t - 0.3) / 0.2), opacity: 1, card: (t - 0.3) / 0.2 };
    if (t < 1.8) {
      const [x, y] = lerp(ease((t - 0.5) / 1.3));
      return { x, y, scale: 0.88, opacity: 1, card: 1 };
    }
    if (t < 2.0) return { x: to[0], y: to[1], scale: 0.88 + 0.12 * ((t - 1.8) / 0.2), opacity: 1, card: 1 - (t - 1.8) / 0.2, tap: 1 - (t - 1.8) / 0.2 };
    if (t < 2.4) return { x: to[0], y: to[1], scale: 1, opacity: 1 - (t - 2.0) / 0.4 };
    return null;
  }

  /** Two presses on the spot, then a short pause. */
  #tapPose([x, y]) {
    const t = this.loop % 2.2;
    const press = (a) => clamp01(1 - Math.abs(t - a) / 0.12); // 1 at the press
    const p = Math.max(press(0.5), press(1.0));
    const opacity = t < 0.25 ? t / 0.25 : t < 1.4 ? 1 : t < 1.7 ? 1 - (t - 1.4) / 0.3 : 0;
    if (!opacity) return null;
    const ring = (a) => (t > a && t < a + 0.4 ? 1 - (t - a) / 0.4 : 0);
    return { x, y, scale: 1 - 0.14 * p, opacity, tap: Math.max(ring(0.5), ring(1.0)) };
  }

  #updatePops(dt) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      if (p.age > 1.9) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const [x, y] = this.#cellsCentre(p.cells, 0.7);
      const rise = ease(clamp01(p.age / 1.9)) * 40;
      const grow = p.age < 0.25 ? 0.4 + 0.8 * (p.age / 0.25) : p.age < 0.4 ? 1.2 - 0.2 * ((p.age - 0.25) / 0.15) : 1;
      p.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - rise)}px) translate(-50%, -50%) scale(${grow.toFixed(3)})`;
      p.el.style.opacity = (p.age > 1.4 ? 1 - (p.age - 1.4) / 0.5 : 1).toFixed(3);
    }
  }
}

/**
 * The one-time hints, checked in this order a few times a second during free play. Each returns null (not now) or
 * { until: seconds on screen, view(): what to draw (see #draw), over(): true to end it early, endsOnPlace }.
 */
const HINTS = {
  // Holding a piece of 2+ cells: R / right-click turns it (over the cell under the pointer).
  rotate(t) {
    const piece = t.hand.piece;
    if (!piece || (SHAPES[piece.shape]?.cells.length ?? 1) < 2 || !t.api.cursor()) return null;
    const rot = piece.rot;
    return { until: 4, view: () => ({ rotate: t.api.cursor() ?? [0, 0] }), over: () => t.hand.piece !== piece || piece.rot !== rot };
  },
  // A "?" site you can reach: the free cells next to it that touch your land glow while you hold a card.
  mystery(t) {
    const { grid, mysteries } = t.api;
    if (!t.hand.piece || grid.expansionMode) return null;
    const cells = [];
    for (const s of mysteries.sites.values()) {
      for (const [dx, dz] of DIRS) {
        const x = s.x + dx;
        const z = s.z + dz;
        if (grid.has(x, z) || !grid.allowed(x, z) || mysteries.has(x, z)) continue;
        if (DIRS.some(([a, b]) => grid.has(x + a, z + b))) cells.push([x, z]);
      }
    }
    if (!cells.length) return null;
    return { until: 6, endsOnPlace: true, view: () => ({ marks: cells }), over: () => !t.hand.piece };
  },
  // The stores will run dry this season: the food row pulses red.
  food(t) {
    const e = t.api.economy();
    if (!(e.foodBalance < 0 && t.api.stores() + e.foodBalance < 0)) return null;
    return { until: 2.6, view: () => ({ ring: { selector: '#panel .res.food', alarm: true } }) };
  },
  // A hand with no Oil Station (and a reroll you can afford): the hand taps Reroll.
  reroll(t) {
    const btn = document.getElementById('btnReroll');
    const cards = t.hand.cards;
    if (cards.length < 3 || t.hand.piece || cards.some((p) => p.terrain === 'station') || !btn || btn.disabled || btn.classList.contains('disabled'))
      return null;
    return { until: 4.4, view: () => ({ hand: { tapOn: '#btnReroll' }, ring: { selector: '#btnReroll' } }), over: () => t.hand.piece };
  },
  // Every card played and nothing happening for a while: the hand taps Next turn.
  next(t) {
    if (t.idle < 6) return null;
    return { until: 4.4, view: () => ({ hand: { tapOn: '#btnNext' }, ring: { selector: '#btnNext' } }), over: () => !t.hand.isEmpty };
  },
};
