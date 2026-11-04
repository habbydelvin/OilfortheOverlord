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
const opening = () => board([['capital', 0, 0], ['farm', ...OPENING.farm], ['station', ...OPENING.station]]);
const state = { population: 0, foodStore: 5 };

test('the guided opening produces without a deficit or idle workers (no Settlement needed yet)', () => {
  const e = computeEconomy(opening(), state);
  assert.equal(Math.round(e.foodBalance), 1, 'Farm doubled by the Capital: 4 grown, 3 eaten');
  assert.equal(e.oil, 4, 'Station doubled by the Capital');
  assert.equal(e.idle, 0);
  assert.equal(e.cap - e.used, 2, 'two of the Capital’s four workers still free');
  assert.ok(!OPENING.hand.some((p) => p.terrain === 'settlement'), 'no Settlement dealt in the opening');
  // ...which is why: the Settlement there would make a deficit for workers nobody needs.
  const withHousing = computeEconomyIf(opening(), state, 'settlement', [[0, 1]]);
  assert.equal(Math.round(withHousing.foodBalance), -1);
  assert.equal(withHousing.cap - withHousing.used, 4);
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
  assert.equal(seasonsOfFood(computeEconomy(opening(), state)), Infinity);
  assert.equal(seasonsOfFood(computeEconomy(board([['capital', 0, 0]]), { population: 0, foodStore: 3 })), 0);
});

test('the authored Wasteland spots are legal on the opening board; the second needs exactly one 60° turn', () => {
  const g = opening();
  const ok = (cells) => cells.every(([x, z]) => !g.has(x, z)) && cells.some(([x, z]) => g.touchesIsland(x, z));
  const [first, second] = OPENING.waste;
  const fits = (piece, cells) => {
    for (const c of cells) {
      const placed = pieceOffsets(piece).map(([a, b]) => [c[0] + a, c[1] + b]);
      if (placed.map(String).sort().join() === cells.map(String).sort().join()) return true;
    }
    return false;
  };
  assert.ok(ok(first) && ok(second));
  assert.ok(fits(OPENING.hand[2], first), 'the first fits as dealt');
  const dealt = OPENING.hand[3];
  assert.ok(!fits(dealt, second), 'the second does not fit as dealt');
  assert.ok(fits({ ...dealt, rot: (dealt.rot + 1) % 6 }, second), '...one turn does it');
  for (const cells of OPENING.waste) for (const [x, z] of cells) assert.ok(hexDistance(x, z) >= 2, 'Wasteland stays off the Capital’s sides');
});

test('the planted site is never uncovered by the opening, and is within reach afterwards', () => {
  const [sx, sz] = OPENING.site.at;
  const used = [OPENING.farm, OPENING.station, ...OPENING.waste.flat(), ...DIRS];
  for (const [x, z] of used) assert.notEqual(hexDistance(x, z, sx, sz), 1, `${x},${z} touches the site`);
  const g = board([['capital', 0, 0], ['farm', ...OPENING.farm], ['station', ...OPENING.station], ...OPENING.waste.flat().map(([x, z]) => ['wasteland1', x, z])]);
  const reach = DIRS.map(([dx, dz]) => [sx + dx, sz + dz]).filter(([x, z]) => !g.has(x, z) && g.touchesIsland(x, z));
  assert.ok(reach.length > 0, 'a free cell beside it touches the land');
});
