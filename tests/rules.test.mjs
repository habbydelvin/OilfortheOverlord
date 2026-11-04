// Rules the tutorial depends on: the authored opening, forecasts equal to the real season, the food consequence.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { computeEconomy, computeEconomyIf, rebelsRise, seasonsOfFood } = await import('../src/economy.js');
const { Grid, hexDistance, DIRS } = await import('../src/grid.js');
const { pieceOffsets } = await import('../src/pieces.js');
const { OPENING } = await import('../src/tutorial.js');

const board = (cells) => {
  const g = new Grid();
  for (const [t, x, z] of cells) g.set(x, z, { terrain: t });
  return g;
};
const producers = () => board([['capital', 0, 0], ['farm', ...OPENING.farm], ['station', ...OPENING.station]]);
const opening = () => board([['capital', 0, 0], ['farm', ...OPENING.farm], ['station', ...OPENING.station], ['settlement', ...OPENING.settlement]]);
const state = { population: 0, foodStore: 5 };

test('the opening’s Farm and Station: doubled by the Capital, no idle workers', () => {
  const e = computeEconomy(producers(), state);
  assert.equal(Math.round(e.foodBalance), 1, 'Farm doubled by the Capital: 4 grown, 3 eaten');
  assert.equal(e.oil, 4, 'Station doubled by the Capital');
  assert.equal(e.idle, 0);
});

test('the opening’s Settlement: +2 worker slots, 2 food a season; the stores carry it, the next Farm fixes it', () => {
  assert.equal(OPENING.hand.filter((p) => p.terrain === 'settlement').length, 1, 'one Settlement in the opening hand');
  const e = computeEconomy(opening(), state);
  assert.equal(e.cap, 6);
  assert.equal(e.cap - e.used, 4);
  assert.equal(Math.round(e.foodBalance), -1, 'a small shortfall...');
  assert.ok(seasonsOfFood(e) > 1, '...that the stores carry (no food alarm in the opening)');
  assert.equal(OPENING.next, 'farm', 'the hand after the payout holds the fix');
  // On your own: beside the Capital (doubled) or beside the found Pump (+2), either puts the food back up.
  const g = opening();
  g.set(...OPENING.site.at, { terrain: OPENING.site.terrain });
  for (const cell of [[0, 1], [3, 2]]) {
    const f = computeEconomyIf(g, state, 'farm', [cell]);
    assert.ok(Math.round(f.foodBalance) > 0, `a Farm at ${cell} feeds the city`);
  }
});

test('a forecast is exactly what placing the card does (farm, settlement, pump)', () => {
  for (const [terrain, cell] of [['farm', [0, 1]], ['settlement', [0, -1]], ['pump', [-2, 0]], ['station', [2, 0]]]) {
    const g = opening();
    const forecast = computeEconomyIf(g, state, terrain, [cell]);
    g.set(...cell, { terrain });
    const real = computeEconomy(g, state);
    for (const k of ['foodBalance', 'oil', 'cap', 'used', 'idle', 'storeAfter']) assert.equal(forecast[k], real[k], `${terrain} ${k}`);
  }
});

test('a forecast changes nothing on the board', () => {
  const g = opening();
  const before = JSON.stringify([...g.cells.keys()]);
  computeEconomyIf(g, state, 'farm', [[0, 1]]);
  assert.equal(JSON.stringify([...g.cells.keys()]), before);
});

test('rebels: net ≤ 0 with the stores empty after, including using up exactly the last of the store', () => {
  assert.equal(rebelsRise({ foodBalance: -3, storeAfter: 0 }), true, 'exactly empties the store');
  assert.equal(rebelsRise({ foodBalance: 0, storeAfter: 0 }), true, 'zero balance, empty store');
  assert.equal(rebelsRise({ foodBalance: -1, storeAfter: 2 }), false);
  assert.equal(rebelsRise({ foodBalance: 1, storeAfter: 0 }), false);
  // The warning looks the same way: this season (0) or how many seasons off.
  const capitalOnly = computeEconomy(board([['capital', 0, 0]]), state); // eats 3 from a store of 5
  assert.equal(capitalOnly.storeAfter, 2);
  assert.equal(seasonsOfFood(capitalOnly), 1);
  assert.equal(seasonsOfFood(computeEconomy(producers(), state)), Infinity, 'a surplus never runs out');
  assert.equal(seasonsOfFood(computeEconomy(opening(), state)), 4, '-1 a season from 5 in store: 4 seasons');
  assert.equal(seasonsOfFood(computeEconomy(board([['capital', 0, 0]]), { population: 0, foodStore: 3 })), 0);
});

test('the authored Wasteland spots are legal in turn; the second needs exactly one 60° turn', () => {
  const g = opening();
  const ok = (cells) => cells.every(([x, z]) => !g.has(x, z)) && cells.some(([x, z]) => g.touchesIsland(x, z));
  const [first, second] = OPENING.waste;
  assert.ok(ok(first), 'the first touches the city');
  for (const [x, z] of first) g.set(x, z, { terrain: 'wasteland1' });
  const fits = (piece, cells) => {
    for (const c of cells) {
      const placed = pieceOffsets(piece).map(([a, b]) => [c[0] + a, c[1] + b]);
      if (placed.map(String).sort().join() === cells.map(String).sort().join()) return true;
    }
    return false;
  };
  assert.ok(ok(second), 'the second touches the first');
  const [dealt1, dealt] = OPENING.hand.filter((p) => p.terrain.startsWith('wasteland'));
  assert.ok(fits(dealt1, first), 'the first fits as dealt');
  assert.ok(!fits(dealt, second), 'the second does not fit as dealt');
  assert.ok(fits({ ...dealt, rot: (dealt.rot + 1) % 6 }, second), '...one turn does it');
  for (const cells of OPENING.waste) for (const [x, z] of cells) assert.ok(hexDistance(x, z) >= 2, 'Wasteland stays off the Capital’s sides');
});

test('the Wasteland path: the second piece (and nothing before it) uncovers the "?" site', () => {
  const [sx, sz] = OPENING.site.at;
  const touches = (cells) => cells.some(([x, z]) => hexDistance(x, z, sx, sz) === 1);
  const before = [[0, 0], OPENING.farm, OPENING.station, OPENING.settlement, ...OPENING.waste[0], ...DIRS];
  assert.ok(!touches(before), 'the buildings, the Capital’s sides and the first piece leave it covered');
  assert.ok(touches(OPENING.waste[1]), 'the second piece reaches it');
  // Each piece attaches to the land laid before it (a path, not a jump).
  let land = [[0, 0], OPENING.farm, OPENING.station, OPENING.settlement];
  for (const piece of OPENING.waste) {
    assert.ok(piece.some(([x, z]) => land.some(([a, b]) => hexDistance(x, z, a, b) === 1)), `${piece} touches the land`);
    land = [...land, ...piece];
  }
});

test('the Settlement’s spot is legal: free, touching the land, off the Capital’s sides (those are for producers)', () => {
  const g = producers();
  const [x, z] = OPENING.settlement;
  assert.ok(!g.has(x, z) && g.touchesIsland(x, z));
  assert.ok(hexDistance(x, z) > 1);
});
