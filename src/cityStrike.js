import { pieceOf } from './pieces.js';

/**
 * Foreign-city strike. Prototype uses the current 3D hive board: K puts the
 * season hand away, draws missiles into it, and playing one flies out of the
 * card onto a building. Later this same API opens a 3D other-city scene.
 */
let stock = [];

/**
 * Put a finished missile in the silo. When `cap` is already full the last slot
 * stays occupied and the count does not go up.
 */
export function addMissile(kind = 'missile', cap = Infinity) {
  const k = kind === 'missile2' ? 'missile2' : 'missile';
  if (stock.length >= cap) return false;
  stock.push(k);
  return true;
}

export function missileCount() {
  return stock.length;
}

export function missileKinds() {
  return [...stock];
}

export function resetMissiles() {
  stock = [];
}

/** Drop the newest missiles when magazine capacity falls (a Magazine idle or gone). */
export function trimMissiles(cap) {
  if (stock.length > cap) stock.length = Math.max(0, cap);
  return stock.length;
}

/** Pull up to `n` missiles out of stock as playable strike cards (same piece shape as the season hand). */
export function drawStrikeHand(n = stock.length) {
  const take = stock.splice(0, Math.max(0, n));
  return take.map((kind) => pieceOf(kind));
}

/** Spend one missile of this kind from stock. Returns false if none. */
export function spendMissile(kind = 'missile') {
  const i = stock.indexOf(kind);
  if (i < 0) return false;
  stock.splice(i, 1);
  return true;
}

/** Placeholder cities until the other-city map exists. */
export const STRIKE_CITIES = [
  { id: 'rusthaven', name: 'Rusthaven', nameZh: '铁锈港' },
  { id: 'tarwell', name: 'Tarwell', nameZh: '焦油镇' },
  { id: 'saltspire', name: 'Saltspire', nameZh: '盐柱' },
];

/** Put unspent strike cards back into stock (leaving the attack screen). */
export function returnStrikeHand(pieces) {
  for (const p of pieces) stock.push(p.terrain === 'missile2' ? 'missile2' : 'missile');
}

let uiOpen = null;

/** main.js registers the overlay: `bindCityStrikeUi((opts) => Promise)`. */
export function bindCityStrikeUi(fn) {
  uiOpen = fn;
}

/**
 * Enter the other-city attack screen.
 * @param {{ cities?: { id: string, name: string, nameZh?: string }[], draw?: number }} opts
 * @returns {Promise<null | { city, missile }>}
 */
export async function openCityStrike(opts = {}) {
  if (!uiOpen) return null;
  return uiOpen({ cities: opts.cities ?? STRIKE_CITIES, draw: opts.draw });
}
