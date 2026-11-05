import test from 'node:test';
import assert from 'node:assert/strict';
import { PayoutHud } from '../src/payoutHud.js';

test('a burst of out-of-order oil arrivals keeps the high-water mark and paints once', () => {
  let shown = 10;
  const paints = [];
  const accepted = [];
  const hud = new PayoutHud((amount, bump) => {
    shown = amount;
    paints.push([amount, bump]);
  }, () => {});
  hud.batch(() => {
    for (const amount of [12, 11, 16, 14, 20, 19]) {
      if (amount <= hud.oilAmount(shown)) continue;
      accepted.push(amount); // sounds and arrival bookkeeping still happen individually
      hud.showOil(amount, true);
    }
    assert.equal(shown, 10, 'DOM has not been updated mid-frame');
    assert.equal(hud.oilAmount(shown), 20, 'later arrivals see the queued total');
  });
  assert.deepEqual(accepted, [12, 16, 20]);
  assert.deepEqual(paints, [[20, true]]);
  assert.equal(shown, 20);
});

test('food keeps per-tile clamping, and oil costs are not discarded when painting is batched', () => {
  const oil = [];
  const food = [];
  const hud = new PayoutHud((...args) => oil.push(args), (...args) => food.push(args));
  hud.batch(() => {
    let store = 29;
    for (const delta of [5, -7, 2]) {
      store = Math.max(0, Math.min(30, store + delta));
      hud.showStore(store, 30, true);
    }
    hud.showOil(40, true);
    hud.showOil(34, true);
    assert.equal(hud.oilAmount(0), 34);
  });
  assert.deepEqual(food, [[25, 30, true]]);
  assert.deepEqual(oil, [[34, true]]);
});

test('nested fast-forward and settlement flush once; ordinary updates remain immediate', () => {
  const paints = [];
  const hud = new PayoutHud((...args) => paints.push(args), () => {});
  hud.batch(() => {
    hud.showOil(10, true);
    hud.batch(() => hud.showOil(30, true));
    hud.showOil(28); // final settlement, including costs
    assert.equal(paints.length, 0);
  });
  assert.deepEqual(paints, [[28, true]]);
  hud.showOil(0);
  assert.deepEqual(paints, [[28, true], [0, false]]);
  assert.equal(hud.oilAmount(0), 0, 'no stale queued amount after a reset');
});

test('an interrupted batch does not leave future HUD updates stuck in a queue', () => {
  const paints = [];
  const hud = new PayoutHud((amount) => paints.push(amount), () => {});
  assert.throws(() => hud.batch(() => {
    hud.showOil(12);
    throw new Error('interrupted');
  }), /interrupted/);
  hud.showOil(7);
  assert.deepEqual(paints, [12, 7]);
});
