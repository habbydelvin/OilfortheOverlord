import { pieceOf, randomPiece, rotateCells, shapeFits, SHAPES } from './pieces.js';
import { ACTIONS, ICONS, TERRAINS, cardDef, cardText, hex } from './tiles.js';
import { WORKERS } from './economy.js';

const CELL_PX = 20;

const MP_ICON = ICONS.manpower;
const FOOD_ICON = ICONS.food;

/**
 * Cost badge for a piece (per tile × tiles in the piece): worker buildings show the manpower they need,
 * housing shows the food it eats each season, everything else is a free 0 manpower.
 */
function costBadge(p, t) {
  const n = SHAPES[p.shape].cells.length;
  const workers = (WORKERS[p.terrain] ?? 0) * n;
  if (workers) return `<div class="badge" title="manpower needed">-${workers}${MP_ICON}</div>`;
  const food = Math.min(0, t.stats?.food ?? 0) * n;
  if (food) return `<div class="badge" title="food eaten each season">${food}${FOOD_ICON}</div>`;
  return `<div class="badge free" title="no manpower needed">0${MP_ICON}</div>`;
}

/** Wasteland has to be placed: it can't be rerolled away or left in hand at the end of a turn. */
// Everything that isn't Wasteland (tiles and action cards), so a pinned Wasteland slot draws only Wasteland.
const ALL_BUT_WASTELAND = [...Object.keys(TERRAINS), ...Object.keys(ACTIONS)].filter((k) => !k.startsWith('wasteland'));

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
      const card = e.target.closest('.card');
      if (!card) return;
      const i = Number(card.dataset.i);
      this.select(this.selected === i ? -1 : i);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.rotate(1);
    });
    this.deal();
  }

  get piece() {
    return this.cards[this.selected] ?? null;
  }

  select(i) {
    this.selected = i >= 0 && i < this.cards.length ? i : -1;
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
    const fixed = pinned.slice(0, count).map((t) => {
      if (t === 'wasteland') return randomPiece(this.grid, ALL_BUT_WASTELAND);
      return { ...pieceOf(t), pinned: true };
    });
    this.cards = [...fixed, ...Array.from({ length: count - fixed.length }, () => randomPiece(this.grid, exclude))];
    this.fresh = new Set(this.cards.map((_, i) => i));
    this.selected = -1;
    this.render();
    this.onChange?.(null);
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
    this.render();
    this.onChange?.(null);
  }

  rotate(dir) {
    const p = this.piece;
    if (!p) return;
    p.rot = (p.rot + dir + 4) % 4;
    this.render();
    this.onChange?.(p);
  }

  #shapeHTML(piece, color, edge) {
    const cells = rotateCells(SHAPES[piece.shape].cells, piece.rot);
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    const squares = cells
      .map(
        ([x, z]) =>
          `<i style="left:${x * CELL_PX}px;top:${z * CELL_PX}px;background:${color};box-shadow:inset 0 -4px 0 ${edge}"></i>`,
      )
      .join('');
    return `<div class="shape" style="width:${w * CELL_PX}px;height:${h * CELL_PX}px">${squares}</div>`;
  }

  render() {
    this.el.innerHTML = this.cards
      .map((p, i) => {
        const t = cardDef(p.terrain);
        const cls = [
          'card',
          t.category === 'junk' ? 'junk' : '',
          t.category === 'action' ? 'action' : '',
          i === this.selected ? 'selected' : '',
          this.fresh.has(i) ? 'deal' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `
        <div class="${cls}" data-i="${i}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${i * 50}ms">
          ${costBadge(p, t)}
          <div class="hotkey">${i + 1}</div>
          <div class="art">${t.symbol ? `<div class="symbol">${t.symbol}</div>` : this.#shapeHTML(p, hex(t.top), hex(t.edge))}</div>
          <div class="name">${t.name}</div>
          <div class="rule">${cardText(t)}</div>
        </div>`;
      })
      .join('');
    this.fresh.clear();
  }
}
