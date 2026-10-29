import { pieceOf, randomPiece, rotateCells, shapeFits, SHAPES } from './pieces.js';
import { ACTIONS, ICONS, TERRAINS, cardDef, cardText, hex, shapeGridHTML, snapHTML, cardArtHTML } from './tiles.js';
import { WORKERS } from './economy.js';
import { bindCardHover, chirp, deal as dealSfx, tick } from './sfx.js';
import { L } from './i18n.js';

const MP_ICON = ICONS.manpower;
const FOOD_ICON = ICONS.food;

/**
 * Cost badge for a piece (per tile × tiles in the piece): worker buildings show the manpower they need,
 * housing shows the food it eats each season, everything else is a free 0 manpower.
 */
function costBadge(p, t) {
  const c = pieceCost(p);
  if (c.workers) return `<div class="badge" title="${L('manpower needed', '所需人力')}">-${c.workers}${MP_ICON}</div>`;
  if (c.food) return `<div class="badge" title="${L('food eaten each season', '每季消耗的食物')}">-${c.food}${FOOD_ICON}</div>`;
  return `<div class="badge free" title="${L('no manpower needed', '无需人力')}">0${MP_ICON}</div>`;
}

/** What a piece takes (per tile × tiles): workers it needs, or food it eats each season. Same as its card badge. */
export function pieceCost(p) {
  const n = SHAPES[p.shape]?.cells.length ?? 1;
  const t = TERRAINS[p.terrain];
  return { workers: (WORKERS[p.terrain] ?? 0) * n, food: -Math.min(0, t?.stats?.food ?? 0) * n };
}

/** Wasteland has to be placed: it can't be rerolled away or left in hand at the end of a turn. */
// Everything that isn't Wasteland (tiles and action cards), so a pinned Wasteland slot draws only Wasteland.
const ALL_BUT_WASTELAND = [...Object.keys(TERRAINS), ...Object.keys(ACTIONS)].filter((k) => !k.startsWith('wasteland'));

/** Pointer travel (px) before pressing a card becomes dragging it. */
const DRAG_PX = 8;

export const isForced = (piece) => piece.terrain.startsWith('wasteland');

/** The row of piece cards along the bottom of the screen. */
export class Hand {
  cards = [];
  selected = -1;
  fresh = new Set(); // slots that should play the deal-in animation

  /** grid: used so Wasteland shapes only come in sizes that fit the free space. */
  constructor(el, size, onChange, grid = null) {
    this.grid = grid;
    this.el = el;
    this.size = size;
    this.onChange = onChange;
    el.addEventListener('click', (e) => {
      if (this.#justDragged) {
        this.#justDragged = false; // the click that ends a drag must not toggle the card off
        return;
      }
      const card = e.target.closest('.card');
      if (!card || card.dataset.i === undefined) return;
      const i = Number(card.dataset.i);
      this.select(this.selected === i ? -1 : i);
    });
    // The card's snapshot <img> would start the browser's own image drag and cancel the pointer events.
    el.addEventListener('dragstart', (e) => e.preventDefault());
    // Drag and drop: press a card and move past DRAG_PX to pick it up; releasing places it (onDrop).
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const card = e.target.closest('.card');
      if (!card || card.dataset.i === undefined) return;
      this.#press = { i: Number(card.dataset.i), x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.#press;
      if (!p || p.id !== e.pointerId) return;
      if (!this.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_PX) {
        if (this.selected !== p.i) this.select(p.i);
        if (this.selected !== p.i) {
          this.#press = null; // the card can't be picked right now (tutorial)
          return;
        }
        this.dragging = true;
        document.body.classList.add('dragging-card');
        this.render();
      }
      if (this.dragging) this.onDragMove?.(e.clientX, e.clientY);
    });
    const end = (e, drop) => {
      const p = this.#press;
      if (!p || p.id !== e.pointerId) return;
      this.#press = null;
      if (!this.dragging) return;
      this.dragging = false;
      this.#justDragged = true;
      setTimeout(() => (this.#justDragged = false), 0); // no click follows when released off the hand
      document.body.classList.remove('dragging-card');
      this.render();
      if (drop) this.onDrop?.(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', (e) => end(e, true));
    window.addEventListener('pointercancel', (e) => end(e, false));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.rotate(1);
    });
    bindCardHover(el);
    this.deal();
  }

  /** True while a card is being dragged out of the hand. */
  dragging = false;
  #press = null;
  #justDragged = false;

  get piece() {
    return this.cards[this.selected] ?? null;
  }

  /** Optional gate (the tutorial): guard('select' | 'rotate', piece) returns false to refuse. */
  guard = null;

  select(i) {
    const next = i >= 0 && i < this.cards.length ? i : -1;
    if (next >= 0 && next !== this.selected && this.guard && !this.guard('select', this.cards[next])) {
      this.onBlocked?.();
      return;
    }
    if (next !== this.selected) tick(next >= 0);
    this.selected = next;
    this.render();
    this.onChange?.(this.piece);
  }

  get isEmpty() {
    return this.cards.length === 0;
  }

  /** Deal a fresh hand of `count` pieces (start of a turn). */
  /**
   * pinned: tile keys guaranteed in the hand (shop purchases, the opening hand).
   * Pinned Wasteland still gets a random shape that fits.
   */
  deal(count = this.size, pinned = []) {
    const exclude = this.excluded?.() ?? [];
    // Pinned cards (bought in the shop) are guaranteed; the rest of the hand is random.
    // Pinned cards already showing in the hand (bought in the shop) stay put instead of being dealt again.
    const kept = this.cards.filter((p) => p.pinned);
    const reused = new Set();
    const fixed = pinned.slice(0, count).map((t) => {
      const old = kept.find((p) => p.terrain === t && !reused.has(p));
      if (old) {
        reused.add(old);
        return old;
      }
      if (t === 'wasteland') return randomPiece(this.grid, ALL_BUT_WASTELAND);
      return { ...pieceOf(t), pinned: true };
    });
    this.cards = [...fixed, ...Array.from({ length: count - fixed.length }, () => randomPiece(this.grid, exclude))];
    this.fresh = new Set(this.cards.map((_, i) => i).filter((i) => !reused.has(this.cards[i])));
    this.selected = -1;
    this.leaveAs = 'discard'; // the old hand slides away
    this.render();
    this.onChange?.(null);
    dealSfx();
  }

  /**
   * Deal an exact hand (the tutorial): [{ terrain, shape = 'mono', rot = 0 }]. No randomness at all,
   * so every player sees the same cards, shapes and rotations.
   */
  dealScripted(list) {
    this.cards = list.map(({ terrain, shape = 'mono', rot = 0 }) => ({ ...pieceOf(terrain), shape, rot }));
    this.fresh = new Set(this.cards.map((_, i) => i));
    this.selected = -1;
    this.leaveAs = 'discard';
    this.render();
    this.onChange?.(null);
    dealSfx();
  }

  /** Empty the hand (the shop opens with an empty hand that fills as cards are bought). */
  clear() {
    this.cards = [];
    this.selected = -1;
    this.leaveAs = 'discard';
    this.render();
    this.onChange?.(null);
  }

  /** Deal one pinned card into the hand (a shop purchase or a free tile pick). */
  addPinned(terrain) {
    this.cards.push({ ...pieceOf(terrain), pinned: true });
    this.fresh.add(this.cards.length - 1);
    this.render();
  }

  /** Cards that must be placed before the turn can end (Wasteland). */
  get forced() {
    return this.cards.filter(isForced);
  }

  /** Redraw every card still in hand, Wasteland included; bought (pinned) cards are kept. */
  reroll() {
    const pinned = this.cards.filter((p) => p.pinned).map((p) => p.terrain);
    this.deal(this.cards.length, pinned);
  }

  /** Wasteland cards that still fit somewhere: these block the end of the turn. */
  get placeableForced() {
    return this.forced.filter((p) => !this.grid || shapeFits(this.grid, p.shape));
  }

  /** Use up the selected card. No replacement until next turn. */
  /** Top the hand up to `count` with pure-luck draws (ignores shop locks). */
  refill(count) {
    const start = this.cards.length;
    while (this.cards.length < count) this.cards.push(randomPiece(this.grid, []));
    for (let i = start; i < this.cards.length; i++) this.fresh.add(i);
    this.render();
    return this.cards.length - start;
  }

  consume() {
    if (this.selected < 0) return;
    this.cards.splice(this.selected, 1);
    this.selected = -1;
    this.leaveAs = 'play'; // the used card pops and vanishes
    this.render();
    this.onChange?.(null);
  }

  rotate(dir) {
    const p = this.piece;
    if (!p) return;
    if (this.guard && !this.guard('rotate', p)) return;
    p.rot = (p.rot + dir + 4) % 4;
    this.render();
    this.onChange?.(p);
    chirp();
  }

  /**
   * Cards keep their DOM element between renders (keyed by piece id), so their springs carry on:
   * nothing jumps when a card is selected, rotated, used up, or the hand is sorted.
   */
  render() {
    this.#ensureMotion();
    const live = new Set();
    this.cards.forEach((p, i) => {
      live.add(p.id);
      let c = this.#els.get(p.id);
      if (!c) {
        c = this.#spawn(p, i);
        this.#els.set(p.id, c);
      }
      const t = cardDef(p.terrain);
      const selected = i === this.selected;
      c.el.className = ['card', t.category === 'junk' ? 'junk' : '', t.category === 'action' ? 'action' : '', selected ? 'selected' : '', selected && this.dragging ? 'dragging' : '']
        .filter(Boolean)
        .join(' ');
      c.el.dataset.i = i;
      c.el.style.setProperty('--top', hex(t.top));
      c.el.style.setProperty('--edge', hex(t.edge));
      const html = `
          ${costBadge(p, t)}
          <div class="hotkey">${i + 1}</div>
          <div class="art">${cardArtHTML(p.terrain, rotateCells(SHAPES[p.shape].cells, p.rot))}</div>
          ${snapHTML(t)}
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
          <div class="shine"></div>`;
      if (html !== c.html) {
        c.el.innerHTML = html;
        c.html = html;
      }
      // Juice: picking a card makes it pop and wobble; dropping it gives a smaller bump.
      if (selected && !c.selected) this.#kick(c, 4.5, 1);
      else if (!selected && c.selected) this.#kick(c, -1.5, 0.4);
      c.selected = selected;
      c.index = i;
    });
    for (const [id, c] of this.#els) {
      if (live.has(id)) continue;
      this.#els.delete(id);
      c.leaving = this.leaveAs ?? 'discard';
      c.age = 0;
      c.el.classList.add('leaving');
      delete c.el.dataset.i;
      this.#gone.push(c);
    }
    this.leaveAs = null;
    this.fresh.clear();
  }

  // ---------- card motion (Balatro-style) ----------
  #els = new Map(); // piece id -> card state
  #gone = []; // cards animating out
  #mouse = null; // pointer position in hand coordinates
  #hover = null; // card state under the pointer
  #time = 0;
  #last = 0;
  #calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  #ensureMotion() {
    if (this.#last) return;
    this.#last = performance.now();
    window.addEventListener('pointermove', (e) => {
      const r = this.el.getBoundingClientRect();
      this.#mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    document.addEventListener('pointerleave', () => (this.#mouse = null));
    window.addEventListener('blur', () => (this.#mouse = null));
    const loop = (now) => {
      const dt = Math.min((now - this.#last) / 1000, 0.05);
      this.#last = now;
      this.perf?.begin('hand (cards)');
      this.#step(dt);
      this.perf?.end('hand (cards)');
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** New card: starts off to the right (the draw pile side), tilted, and flies into its slot after a stagger. */
  #spawn(p, i) {
    const el = document.createElement('div');
    this.el.appendChild(el);
    const W = this.el.clientWidth || 1000;
    const spring = (x) => ({ x, v: 0 });
    return {
      el,
      html: '',
      index: i,
      selected: false,
      wait: 0.06 + i * 0.07, // seconds before it is dealt
      phase: Math.random() * Math.PI * 2,
      x: spring(W + 120),
      y: spring(180),
      rot: spring(28),
      scale: spring(0.85),
      tx: spring(0),
      ty: spring(0),
      lift: 0,
    };
  }

  #kick(c, scaleV, wobble) {
    c.scale.v += scaleV;
    c.rot.v += (Math.random() < 0.5 ? -1 : 1) * 70 * wobble;
  }

  /** Resting slot of card i in an n-card fan: x of its left edge, y offset, in-plane rotation (deg). */
  #slot(i, n, W, cw) {
    const mid = (n - 1) / 2;
    const room = Math.max(cw, W - 60);
    const spacing = n > 1 ? Math.min(cw + 8, (room - cw) / (n - 1)) : 0;
    const d = i - mid;
    return { x: W / 2 + d * spacing - cw / 2, y: d * d * 7, rot: d * 4 };
  }

  #step(dt) {
    this.#time += dt;
    const time = this.#time;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const n = this.cards.length;
    const first = this.#els.values().next().value;
    const cw = first?.el.offsetWidth || 165;
    const ch = first?.el.offsetHeight || 300;
    const blocked = document.body.matches('.paying, .dialogue, .shopping');

    // Hover: tested against the resting slots, so a card lifting away from the pointer does not flicker.
    let hover = null;
    const m = this.#mouse;
    if (m && !blocked && m.y < H + 20 && m.y > -60) {
      let best = Infinity;
      for (const c of this.#els.values()) {
        const s = this.#slot(c.index, n, W, cw);
        const top = H - ch + s.y - (c.selected ? 40 : 0);
        const cx = s.x + cw / 2;
        const dx = Math.abs(m.x - cx);
        if (dx < cw / 2 && m.y > top && dx < best) {
          best = dx;
          hover = c;
        }
      }
    }
    if (hover && hover !== this.#hover) this.#kick(hover, 1.6, 0.25);
    this.#hover = hover;

    const idle = this.#calm ? 0 : 1;
    for (const c of this.#els.values()) {
      if (c.wait > 0) {
        c.wait -= dt;
        c.el.style.opacity = c.wait > 0 ? '0' : '';
        if (c.wait > 0) continue;
      }
      const s = this.#slot(c.index, n, W, cw);
      const hovered = c === hover;
      const lift = (c.selected ? 40 : 0) + (hovered ? 22 : 0);
      let tx = Math.sin(time * 0.9 + c.phase) * 3 * idle;
      let ty = Math.cos(time * 0.7 + c.phase * 1.3) * 4 * idle;
      if (hovered) {
        // Lean away from the pointer: the corner under it dips back.
        const nx = Math.max(-1, Math.min(1, (m.x - (s.x + cw / 2)) / (cw / 2)));
        const ny = Math.max(-1, Math.min(1, (m.y - (H - ch / 2 + s.y - lift)) / (ch / 2)));
        tx = -ny * 16;
        ty = nx * 16;
      }
      const targetY = H - ch + s.y - lift + Math.sin(time * 1.4 + c.phase) * 3 * idle;
      const targetRot = (hovered || c.selected ? s.rot * 0.3 : s.rot) + Math.sin(time * 1.1 + c.phase) * 0.9 * idle;
      const targetScale = hovered ? 1.08 : c.selected ? 1.05 : 1;
      this.#spring(c.x, s.x, 170, 19, dt);
      this.#spring(c.y, targetY, 170, 19, dt);
      this.#spring(c.rot, targetRot, 190, 15, dt);
      this.#spring(c.scale, targetScale, 320, 17, dt);
      this.#spring(c.tx, tx, 160, 15, dt);
      this.#spring(c.ty, ty, 160, 15, dt);
      c.lift = lift;
      c.el.style.zIndex = hovered ? 50 : c.selected ? 40 : 10 + c.index;
      this.#paint(c, hovered);
    }

    // Leaving cards: a played card pops and shrinks away; a discarded hand drops out of view.
    for (let k = this.#gone.length - 1; k >= 0; k--) {
      const c = this.#gone[k];
      c.age += dt;
      const t = c.age;
      if (c.leaving === 'play') {
        this.#spring(c.scale, t < 0.07 ? 1.25 : 0.2, 420, 20, dt);
        this.#spring(c.y, c.y.x - 40, 60, 10, dt);
        c.el.style.opacity = String(Math.max(0, 1 - Math.max(0, t - 0.08) / 0.2));
      } else {
        this.#spring(c.y, H + 160, 90, 14, dt);
        this.#spring(c.rot, c.rot.x + (c.phase > Math.PI ? 25 : -25), 40, 10, dt);
        c.el.style.opacity = String(Math.max(0, 1 - t / 0.35));
      }
      this.#paint(c, false);
      if (t > 0.4) {
        c.el.remove();
        this.#gone.splice(k, 1);
      }
    }
  }

  #spring(s, target, k, d, dt) {
    s.v += (k * (target - s.x) - d * s.v) * dt;
    s.x += s.v * dt;
  }

  #paint(c, hovered) {
    const st = c.el.style;
    st.transform =
      `translate3d(${c.x.x.toFixed(1)}px, ${c.y.x.toFixed(1)}px, 0) rotate(${c.rot.x.toFixed(2)}deg) ` +
      `perspective(700px) rotateX(${c.tx.x.toFixed(2)}deg) rotateY(${c.ty.x.toFixed(2)}deg) scale(${c.scale.x.toFixed(3)})`;
    // Shadow falls further away as the card lifts, and slides opposite to the tilt.
    st.setProperty('--sx', `${(-c.ty.x * 0.5).toFixed(1)}px`);
    st.setProperty('--sy', `${(6 + c.lift * 0.25 + c.tx.x * 0.4).toFixed(1)}px`);
    // Sheen sweeps across the frame with the tilt (and drifts slowly at rest).
    st.setProperty('--shine', `${(50 + c.ty.x * 4 - c.tx.x * 2 + Math.sin(this.#time * 0.5 + c.phase) * 18).toFixed(1)}%`);
    st.setProperty('--shine-a', hovered ? '1' : '0.45');
  }
}
