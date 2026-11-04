// Lesson record (src/lessons.js): shown is not learnt, the player gets credit unprompted, cooldowns, migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LessonBook, LESSONS_KEY, LEGACY_HINTS_KEY, COOLDOWN, MAX_SHOWS } from '../src/lessons.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('a lesson shown is still open: being displayed is not learning it', () => {
  const book = new LessonBook(memory());
  book.shown('rotate', 0);
  assert.equal(book.learnt('rotate'), false);
  assert.equal(book.open('rotate'), true);
  assert.equal(book.get('rotate').shown, 1);
});

test('doing it without the hint is credited (solo), and learnt for good', () => {
  const store = memory();
  const book = new LessonBook(store);
  book.complete('rotate', false);
  assert.equal(book.learnt('rotate'), true);
  assert.equal(book.get('rotate').solo, 1);
  assert.equal(book.ready('rotate', 1e9), false, 'a learnt lesson never offers itself again');
  assert.equal(new LessonBook(store).learnt('rotate'), true, 'kept across sessions');
});

test('prompted completion is not counted as solo', () => {
  const book = new LessonBook(memory());
  book.complete('war', true);
  assert.equal(book.get('war').solo, 0);
  assert.equal(book.learnt('war'), true);
});

test('an unfinished lesson waits a growing cooldown before it is offered again', () => {
  const book = new LessonBook(memory());
  assert.equal(book.ready('food', 0), true);
  book.shown('food', 10);
  assert.equal(book.ready('food', 10 + COOLDOWN - 1), false);
  assert.equal(book.ready('food', 10 + COOLDOWN), true);
  book.shown('food', 100);
  assert.equal(book.ready('food', 100 + COOLDOWN * 2 - 1), false);
});

test('shown too often without being done: it stops asking (dismissed), as does the skip button', () => {
  const book = new LessonBook(memory());
  for (let i = 0; i < MAX_SHOWS; i++) book.shown('reroll', i * 1000);
  assert.equal(book.get('reroll').dismissed, true);
  assert.equal(book.ready('reroll', 1e9), false);
  book.dismiss('market');
  assert.equal(book.open('market'), false);
});

test('the old "seen" list migrates as shown once (not learnt), renamed ids follow, the old key goes', () => {
  const store = memory({ [LEGACY_HINTS_KEY]: JSON.stringify(['rotate', 'aim', 'zoom', 'next']) });
  const book = new LessonBook(store);
  assert.equal(book.get('rotate').shown, 1);
  assert.equal(book.learnt('rotate'), false);
  assert.equal(book.get('war').shown, 1, 'aim -> war');
  assert.equal(book.get('globe').shown, 1, 'zoom -> globe');
  assert.equal(store.getItem(LEGACY_HINTS_KEY), null);
  assert.ok(store.getItem(LESSONS_KEY));
});

test('reset (a replayed tutorial) starts every lesson over', () => {
  const store = memory();
  const book = new LessonBook(store);
  book.complete('build');
  book.reset();
  assert.equal(book.learnt('build'), false);
  assert.equal(store.getItem(LESSONS_KEY), null);
});
