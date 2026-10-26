import { largestFittingShape, randomPiece, rotateCells, shapeFits, SHAPES } from './pieces.js';
import { TERRAINS, hex } from './tiles.js';

const CELL_PX = 20;

/** Wasteland has to be placed: it can't be rerolled away or left in hand at the end of a turn. */
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
  deal(count = this.size) {
    const exclude = this.excluded?.() ?? [];
    this.cards = Array.from({ length: count }, () => randomPiece(this.grid, exclude));
    this.fresh = new Set(this.cards.map((_, i) => i));
    this.selected = -1;
    this.render();
    this.onChange?.(null);
  }

  /** Cards that must be placed before the turn can end (Wasteland). */
  get forced() {
    return this.cards.filter(isForced);
  }

  /** Redraw every card still in hand, Wasteland included (same number of cards). */
  reroll() {
    this.deal(this.cards.length);
  }

  /**
   * Keep Wasteland cards placeable as the free space shrinks: a shape that no longer fits is
   * shrunk to the biggest shape that does; only if not even one cell fits is the card dropped.
   * Call only when the territory isn't full (a full territory should be expanded first).
   */
  fitForced() {
    const out = { shrunk: 0, discarded: 0 };
    if (!this.grid) return out;
    const kept = [];
    this.cards.forEach((p, i) => {
      if (!isForced(p) || shapeFits(this.grid, p.shape)) return kept.push(p);
      const shape = largestFittingShape(this.grid, SHAPES[p.shape].cells.length);
      if (!shape) return out.discarded++;
      p.shape = shape;
      this.fresh.add(kept.length);
      kept.push(p);
      out.shrunk++;
    });
    if (out.shrunk || out.discarded) {
      const sel = this.piece;
      this.cards = kept;
      this.selected = sel ? kept.indexOf(sel) : -1;
      this.render();
      this.onChange?.(this.piece);
    }
    return out;
  }

  /** Use up the selected card. No replacement until next turn. */
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
        const t = TERRAINS[p.terrain];
        const cls = [
          'card',
          t.category === 'junk' ? 'junk' : '',
          i === this.selected ? 'selected' : '',
          this.fresh.has(i) ? 'deal' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `
        <div class="${cls}" data-i="${i}" style="--top:${hex(t.top)};--edge:${hex(t.edge)};animation-delay:${i * 50}ms">
          <div class="badge" title="tiles in piece">${SHAPES[p.shape].cells.length}</div>
          <div class="hotkey">${i + 1}</div>
          <div class="art">${this.#shapeHTML(p, hex(t.top), hex(t.edge))}</div>
          <div class="name">${t.name}</div>
          <div class="rule">${t.rule}</div>
        </div>`;
      })
      .join('');
    this.fresh.clear();
  }
}
