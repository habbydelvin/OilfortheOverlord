/**
 * The saved game (the main screen's Continue): one snapshot in localStorage, written by main.js whenever the game is
 * at rest on the home board (nothing animating, no screen up), so it always holds a moment the game can resume from.
 * It survives closing the browser. A lost game deletes it.
 *
 * This file only stores and reads the data: main.js gathers the snapshot (gatherSave) and rebuilds the game from it
 * (restoreSave). Sets and Maps inside are kept through JSON with small tags.
 */
export const SAVE_KEY = 'oto.save.v1';
const VERSION = 1;

const replacer = (_k, v) => {
  if (v instanceof Set) return { __set: [...v] };
  if (v instanceof Map) return { __map: [...v] };
  return v;
};
const reviver = (_k, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (Array.isArray(v.__set)) return new Set(v.__set);
    if (Array.isArray(v.__map)) return new Map(v.__map);
  }
  return v;
};

/** The snapshot as a string (also used to tell whether anything changed since the last write). */
export const encodeSave = (data) => JSON.stringify({ version: VERSION, savedAt: Date.now(), data }, replacer);

/** Writes an encoded snapshot. Returns false if the browser refused (storage full or blocked). */
export function writeSave(encoded) {
  try {
    localStorage.setItem(SAVE_KEY, encoded);
    return true;
  } catch {
    return false;
  }
}

/** The saved game's data, or null (none, unreadable, or from an older format). */
export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw, reviver);
    return save?.version === VERSION && save.data ? save.data : null;
  } catch {
    return null;
  }
}

export const hasSave = () => readSave() !== null;

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}
