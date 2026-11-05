// Year events and the Unexploded Missile discovery.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { EVENTS } = await import('../src/events.js');
const { MYSTERY_POOL, SILO_FIRE_CHANCE, siloFires } = await import('../src/mystery.js');

test('Show of Force is gone from the yearly events', () => {
  assert.equal('showOfForce' in EVENTS, false);
});

test('an Unexploded Missile is still a discovery, and fires half the time', () => {
  assert.ok(MYSTERY_POOL.some(([t]) => t === 'missile'));
  assert.equal(SILO_FIRE_CHANCE, 0.5);
  assert.equal(siloFires(() => 0.49), true, 'fires');
  assert.equal(siloFires(() => 0.5), false, 'recovered');
  assert.equal(siloFires(() => 0.99), false, 'recovered');
});
