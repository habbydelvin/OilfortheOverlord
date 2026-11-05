// Hand reroll: bought and reward cards (Send in the Militia) are redrawn too; produced Missiles stay.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= {}; // no AudioContext: the deal sound is skipped
const { Hand } = await import('../src/hand.js');
const { pieceOf } = await import('../src/pieces.js');

/** A Hand without its DOM: rendering is a no-op. */
function handOf(cards) {
  const h = Object.create(Hand.prototype);
  h.cards = cards;
  h.selected = -1;
  h.fresh = new Set();
  h.size = 5;
  h.grid = null;
  h.render = () => {};
  return h;
}

test('a bought Send in the Militia is redrawn, not kept', () => {
  const militia = { ...pieceOf('militia'), pinned: true };
  const h = handOf([militia, pieceOf('farm'), pieceOf('station')]);
  assert.equal(h.reroll(), true);
  assert.equal(h.cards.length, 3);
  assert.ok(!h.cards.includes(militia), 'the bought card object is gone');
  assert.ok(h.cards.every((p) => !p.pinned), 'fresh draws are not pinned');
});

test('a hand of only bought cards is still redrawn', () => {
  const bought = [{ ...pieceOf('militia'), pinned: true }, { ...pieceOf('overtime'), pinned: true }];
  const h = handOf([...bought]);
  assert.equal(h.reroll(), true);
  assert.equal(h.cards.length, 2);
  assert.ok(bought.every((p) => !h.cards.includes(p)));
});

test('produced Missiles stay and the hand does not grow', () => {
  const missile = { ...pieceOf('militia'), produced: true }; // any card flagged produced
  const h = handOf([missile, { ...pieceOf('militia'), pinned: true }, pieceOf('farm')]);
  assert.equal(h.rerollable, 2);
  h.reroll();
  assert.equal(h.cards.length, 3);
  assert.equal(h.cards[0], missile);
  assert.equal(h.cards.filter((p) => p.produced).length, 1);
});

test('nothing to redraw: reroll refuses and changes nothing', () => {
  const missile = { ...pieceOf('militia'), produced: true };
  const h = handOf([missile]);
  assert.equal(h.rerollable, 0);
  assert.equal(h.reroll(), false);
  assert.deepEqual(h.cards, [missile]);
  assert.equal(handOf([]).reroll(), false);
});
