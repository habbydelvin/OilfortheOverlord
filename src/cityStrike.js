import { pieceOf } from './pieces.js';

/**
 * Foreign-city strike. Prototype uses the current 3D hive board: K puts the
 * season hand away, draws missiles into it, and playing one flies out of the
 * card onto a building. Later this same API opens a 3D other-city scene.
 */
let stock = [];

/** Stock kinds: 'missile', 'missile2' (warhead) and 'decoy'; anything else is a plain missile. */
const normKind = (kind) => (kind === 'missile2' || kind === 'decoy' ? kind : 'missile');
/** Decoys ride along. Only attacking missiles take a silo slot. */
const attacking = (kind) => kind !== 'decoy';

/**
 * Put a finished missile in the silo. An attacking missile past `cap` is refused.
 * A decoy never takes a slot, so it is stored even when the magazines are full.
 */
export function addMissile(kind = 'missile', cap = Infinity) {
  const k = normKind(kind);
  if (attacking(k) && stock.filter(attacking).length >= cap) return false;
  stock.push(k);
  return true;
}

/** Attacking missiles in the silo. Decoys are not included. */
export function missileCount() {
  return stock.filter(attacking).length;
}

/** Everything in the silo, decoys included. */
export function ammoCount() {
  return stock.length;
}

export function missileKinds() {
  return [...stock];
}

export function resetMissiles() {
  stock = [];
  queue = [];
}

/** The silo and the aimed strikes, for the saved game (saveGame.js), and back. */
export const missileState = () => ({ stock: [...stock], queue: queue.map((q) => ({ ...q, at: [...q.at] })) });
export function setMissileState(s) {
  stock = [...(s?.stock ?? [])];
  queue = (s?.queue ?? []).map((q) => ({ ...q, at: [...q.at] }));
}

/** Drop the newest attacking missiles when magazine capacity falls. Decoys stay. */
export function trimMissiles(cap) {
  let n = stock.filter(attacking).length;
  for (let i = stock.length - 1; i >= 0 && n > cap; i--) {
    if (!attacking(stock[i])) continue;
    stock.splice(i, 1);
    n--;
  }
  return n;
}

/** Pull up to `n` missiles out of stock as playable strike cards (same piece shape as the season hand). */
export function drawStrikeHand(n = stock.length) {
  const take = stock.splice(0, Math.max(0, n));
  const pieces = take.map((kind) => pieceOf(kind));
  if (take.length > 2) pieces.unshift(pieceOf('salvo'));
  return pieces;
}

/** Spend one missile of this kind from stock. Returns false if none. */
export function spendMissile(kind = 'missile') {
  const i = stock.indexOf(kind);
  if (i < 0) return false;
  stock.splice(i, 1);
  return true;
}

/** Put unspent strike cards back into stock (leaving the attack screen). */
export function returnStrikeHand(pieces) {
  for (const p of pieces) {
    if (p.terrain === 'salvo') continue;
    stock.push(normKind(p.terrain));
  }
}

// ---------- strikes queued on rival cities (fired in the attack phase, after the season is scored) ----------
let queue = []; // { to, at: [x, z], kind }

/** Aim one missile of `kind` from stock at cell `at` of city `to`. False if there's none in stock. */
export function queueStrike(to, at, kind = 'missile') {
  if (!spendMissile(kind)) return false;
  queue.push({ to, at: [...at], kind });
  return true;
}

/** Aim a missile card already drawn out of stock (played from the hand) at cell `at` of city `to`. */
export function queueDrawn(to, at, kind = 'missile', size = 1, extra = {}) {
  queue.push({ to, at: [...at], kind: normKind(kind), size: kind === 'decoy' ? 0 : size, ...extra });
}

/**
 * Take back the queued strike at `at` on `to`. Returns its kind (or null). toStock: the missile goes back to the
 * silo; otherwise the caller hands it back as a card.
 */
export function unqueueStrike(to, at, toStock = true) {
  const i = queue.findIndex((q) => q.to === to && q.at[0] === at[0] && q.at[1] === at[1]);
  if (i < 0) return null;
  const { kind } = queue[i];
  if (toStock) stock.push(kind);
  queue.splice(i, 1);
  return kind;
}

export const queuedStrikes = (to = null) => queue.filter((q) => to === null || q.to === to);

/** The attack phase takes the whole queue. */
export function takeQueue() {
  const q = queue;
  queue = [];
  return q;
}

/** Cancel everything queued (or only on `to`): the missiles go back. */
export function clearQueue(to = null) {
  for (const q of queue) if (to === null || q.to === to) stock.push(q.kind);
  queue = queue.filter((q) => to !== null && q.to !== to);
}

let uiOpen = null;

/** main.js registers the overlay: `bindCityStrikeUi((opts) => Promise)`. */
export function bindCityStrikeUi(fn) {
  uiOpen = fn;
}

/** The old in-board strike screen (no longer bound to a key; kept for the debug tools). */
export async function openCityStrike(opts = {}) {
  if (!uiOpen) return null;
  return uiOpen({ cities: opts.cities ?? [], draw: opts.draw });
}
