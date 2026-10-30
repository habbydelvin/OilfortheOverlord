/**
 * Player release build (`npm run release`, i.e. `vite build --mode release`): no Game Debug panel, no tile
 * library link, no perf overlay, no console cheats, and only the shipped defaults for every tuning value.
 * Vite replaces import.meta.env.MODE at build time, so the dev-only code behind `if (!RELEASE)` is dropped
 * from the release bundle entirely.
 */
export const RELEASE = import.meta.env.MODE === 'release';

/**
 * Tuning saved by the Game Debug panel and the perf overlay. Players can't reach those, so in the release build
 * any leftovers in their browser are cleared, and every value comes from the defaults in code. Player settings
 * (language, music and sound volume, tutorial seen) are kept.
 */
const DEV_KEYS = [
  'oto.debugOpen',
  'oto.perfOpen',
  'oto.gfx',
  'oto.fogConfig',
  'oto.missileConfig',
  'oto.payoutConfig',
  'oto.scaling',
  'oto.iconConfig',
  'oto.shakeConfig',
  'oto.previewConfig',
];

/** Saves from older releases that no longer count: the old tutorial flag (now oto.tutorialDone.v2, tutorial.js). */
const OLD_KEYS = ['oto.tutorialDone'];

if (RELEASE) {
  try {
    for (const k of [...DEV_KEYS, ...OLD_KEYS]) localStorage.removeItem(k);
  } catch {
    /* storage unavailable: the defaults are used anyway */
  }
}
